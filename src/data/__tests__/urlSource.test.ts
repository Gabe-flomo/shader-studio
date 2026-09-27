/**
 * Datasets from a link: rewriting the links people copy into the files
 * themselves, detecting the format, unzipping, and Kaggle's answers (from
 * fixtures: no network here).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { decodeFetched, detectFormat, looksLikeHtml, ndjsonToArray, normalizeUrl, prepareText, rewriteDataUrl, UnsupportedFormatError, urlFilename } from '../urlSource';
import { CORS_MESSAGE, CorsError, fetchDataUrl } from '../urlFetch';
import { kaggleDownloadUrl, kaggleListUrl, parseKaggleFiles, parseKaggleJson, parseKaggleSlug, readableKaggleFiles } from '../kaggle';
import { parseDatasetsRecord } from '../types';

describe('link rewriting', () => {
  it('GitHub file pages → raw files', () => {
    expect(rewriteDataUrl('https://github.com/owid/co2-data/blob/master/owid-co2-data.csv')).toEqual({
      url: 'https://raw.githubusercontent.com/owid/co2-data/master/owid-co2-data.csv', note: 'GitHub page → its raw file',
    });
    expect(rewriteDataUrl('https://github.com/a/b/raw/main/dir/x.json').url).toBe('https://raw.githubusercontent.com/a/b/main/dir/x.json');
    // A repo page or a raw link stays.
    expect(rewriteDataUrl('https://github.com/a/b').url).toBe('https://github.com/a/b');
    expect(rewriteDataUrl('https://raw.githubusercontent.com/a/b/main/x.csv').note).toBeUndefined();
    expect(rewriteDataUrl('https://gist.github.com/ann/abc123').url).toBe('https://gist.githubusercontent.com/ann/abc123/raw');
  });

  it('Google Sheets → CSV', () => {
    // Published to the web (the HTML page) → its CSV, keeping the sheet.
    expect(rewriteDataUrl('https://docs.google.com/spreadsheets/d/e/2PACX-abc/pubhtml?gid=42&single=true').url)
      .toBe('https://docs.google.com/spreadsheets/d/e/2PACX-abc/pub?output=csv&gid=42&single=true');
    // Already the CSV link: left alone.
    const csv = 'https://docs.google.com/spreadsheets/d/e/2PACX-abc/pub?gid=0&single=true&output=csv';
    expect(rewriteDataUrl(csv)).toEqual({ url: csv });
    // The edit link of a shared sheet → its export, with the tab from the hash.
    const r = rewriteDataUrl('https://docs.google.com/spreadsheets/d/1AbC_dEf/edit#gid=123');
    expect(r.url).toBe('https://docs.google.com/spreadsheets/d/1AbC_dEf/export?format=csv&gid=123');
    expect(r.note).toMatch(/Anyone with the link/);
  });

  it('Hugging Face and Dropbox → downloads; other links pass', () => {
    expect(rewriteDataUrl('https://huggingface.co/datasets/org/name/blob/main/data/train.csv').url).toBe('https://huggingface.co/datasets/org/name/resolve/main/data/train.csv');
    expect(rewriteDataUrl('https://www.dropbox.com/s/xyz/file.csv?dl=0').url).toBe('https://www.dropbox.com/s/xyz/file.csv?dl=1');
    expect(rewriteDataUrl('https://data.example.org/x.csv')).toEqual({ url: 'https://data.example.org/x.csv' });
  });

  it('normalizes what was typed', () => {
    expect(normalizeUrl('  example.com/data.csv ')).toBe('https://example.com/data.csv');
    expect(normalizeUrl('http://localhost:8000/a.json')).toBe('http://localhost:8000/a.json');
    expect(normalizeUrl('ftp://example.com/a')).toBeNull();
    expect(normalizeUrl('not a link')).toBeNull();
    expect(urlFilename('https://x.org/a/b%20c.csv?x=1')).toBe('b c.csv');
    expect(urlFilename('https://docs.google.com/spreadsheets/d/e/1/pub?output=csv')).toBe('Google Sheet.csv');
  });
});

describe('format detection', () => {
  it('from the extension, then the query, then the content type, then the text', () => {
    expect(detectFormat({ url: 'https://x.org/a.csv', contentType: 'text/plain', text: '' })).toBe('csv');
    expect(detectFormat({ url: 'https://x.org/a.geojson', text: '' })).toBe('json');
    expect(detectFormat({ url: 'https://x.org/a.ndjson', text: '' })).toBe('json');
    expect(detectFormat({ url: 'https://docs.google.com/spreadsheets/d/e/1/pub?output=csv', contentType: 'text/html', text: '' })).toBe('csv');
    expect(detectFormat({ url: 'https://api.x.org/latest', contentType: 'application/json; charset=utf-8', text: '' })).toBe('json');
    expect(detectFormat({ url: 'https://api.x.org/latest', contentType: 'application/vnd.api+json', text: '' })).toBe('json');
    expect(detectFormat({ url: 'https://api.x.org/export', contentType: 'text/csv', text: '' })).toBe('csv');
    expect(detectFormat({ url: 'https://api.x.org/q', contentType: 'text/plain', text: 'a\tb\n1\t2\n' })).toBe('tsv');
    expect(detectFormat({ url: 'https://api.x.org/q', contentType: null, text: '[{"a":1}]' })).toBe('json');
    expect(detectFormat({ url: 'https://api.x.org/q', contentType: 'text/plain', text: 'x,y\n1,2\n' })).toBe('csv');
    expect(detectFormat({ url: 'https://api.x.org/poem', contentType: 'text/plain', text: 'Roses are red\nViolets are blue' })).toBe('text');
  });

  it('refuses Parquet and Excel with a plain message', () => {
    expect(() => detectFormat({ url: 'https://x.org/a.parquet', text: '' })).toThrow(UnsupportedFormatError);
    expect(() => detectFormat({ url: 'https://x.org/a.parquet', text: '' })).toThrow(/Parquet/);
    expect(() => detectFormat({ url: 'https://x.org/a.xlsx', text: '' })).toThrow(/Excel/);
    expect(() => detectFormat({ url: 'https://x.org/f', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', text: '' })).toThrow(/Excel/);
  });

  it('spots web pages and newline-delimited JSON', () => {
    expect(looksLikeHtml('<!DOCTYPE html><html>')).toBe(true);
    expect(looksLikeHtml('\n  <html lang="en"><head>')).toBe(true);
    expect(looksLikeHtml('a,b\n1,2')).toBe(false);
    expect(ndjsonToArray('{"a":1}\n{"a":2}\n')).toBe('[{"a":1},{"a":2}]');
    expect(ndjsonToArray('[\n{"a":1},\n{"a":2}\n]')).toBeNull();
    expect(prepareText('{"a":1}\n{"a":2}', 'json')).toBe('[{"a":1},{"a":2}]');
    expect(prepareText('[{"a":1}]', 'json')).toBe('[{"a":1}]');
  });

  it('opens a zip for its data file', () => {
    const zip = zipSync({ 'readme.md': strToU8('# hi'), 'data/cities.csv': strToU8('city,t\nOslo,4\n'), 'other.json': strToU8('[]') });
    const d = decodeFetched(zip);
    expect(d.filename).toBe('cities.csv');
    expect(d.format).toBe('csv');
    expect(d.text).toBe('city,t\nOslo,4\n');
    expect(d.note).toMatch(/1 of 2/);
    expect(decodeFetched(zip, 'other.json').text).toBe('[]');
    expect(() => decodeFetched(zipSync({ 'a.png': new Uint8Array([1]) }))).toThrow(/no CSV/);
    expect(decodeFetched(strToU8('plain,text')).text).toBe('plain,text');
  });

  it('keeps fetched text with its link when saved', () => {
    const parsed = parseDatasetsRecord({
      web: { name: 'Web', source: { kind: 'url', url: 'https://x.org/a.csv', format: 'csv', text: 'a\n1\n', fetchedAt: 5, kaggle: { slug: 'a/b', file: 'c.csv' } }, cells: [], result: null },
      older: { name: 'Older', source: { kind: 'url', url: 'https://x.org/b.json', format: 'json' }, cells: [], result: null },
    });
    expect(parsed.web.source).toEqual({ kind: 'url', url: 'https://x.org/a.csv', format: 'csv', text: 'a\n1\n', fetchedAt: 5, kaggle: { slug: 'a/b', file: 'c.csv' } });
    expect(parsed.older.source).toEqual({ kind: 'url', url: 'https://x.org/b.json', format: 'json', text: '' });
  });
});

describe('fetching in the browser', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('a refused read (CORS) says the desktop app can fetch it', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))));
    const err = await fetchDataUrl('https://example.org/data.csv').catch(e => e);
    expect(err).toBeInstanceOf(CorsError);
    expect(err.message).toBe(CORS_MESSAGE);
    expect(CORS_MESSAGE).toMatch(/desktop app can fetch it/);
  });

  it('rewrites, fetches, detects and refuses web pages', async () => {
    const calls: string[] = [];
    const respond = (body: string, type: string, status = 200) => new Response(body, { status, headers: { 'content-type': type } });
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      calls.push(url);
      if (url.includes('raw.githubusercontent')) return Promise.resolve(respond('x,y\n1,2\n', 'text/plain'));
      if (url.includes('missing')) return Promise.resolve(respond('nope', 'text/plain', 404));
      return Promise.resolve(respond('<!doctype html><html><head></head></html>', 'text/html'));
    }));
    const got = await fetchDataUrl('github.com/a/b/blob/main/pts.csv');
    expect(calls[0]).toBe('https://raw.githubusercontent.com/a/b/main/pts.csv');
    expect(got.format).toBe('csv');
    expect(got.text).toBe('x,y\n1,2\n');
    expect(got.note).toMatch(/GitHub/);
    await expect(fetchDataUrl('https://x.org/missing.csv')).rejects.toThrow(/404/);
    await expect(fetchDataUrl('https://docs.google.com/spreadsheets/d/e/1/pub?output=csv')).rejects.toThrow(/Publish to web/);
    await expect(fetchDataUrl('https://x.org/page')).rejects.toThrow(/web page/);
  });
});

describe('Kaggle', () => {
  it('reads a slug or a dataset page link', () => {
    expect(parseKaggleSlug('zynicide/wine-reviews')).toBe('zynicide/wine-reviews');
    expect(parseKaggleSlug('https://www.kaggle.com/datasets/zynicide/wine-reviews/data')).toBe('zynicide/wine-reviews');
    expect(parseKaggleSlug('just-one-part')).toBeNull();
    expect(parseKaggleSlug('a/b/c')).toBeNull();
    expect(kaggleListUrl('a/b')).toBe('https://www.kaggle.com/api/v1/datasets/list/a/b');
    expect(kaggleDownloadUrl('a/b', 'my file.csv')).toBe('https://www.kaggle.com/api/v1/datasets/download/a/b/my%20file.csv');
  });

  it('lists files from the current answer ({ datasetFiles })', () => {
    const fixture = {
      datasetFiles: [
        { ref: 'winemag-data-130k-v2.csv', datasetRef: 'zynicide/wine-reviews', name: 'winemag-data-130k-v2.csv', creationDate: '2017-11-27', totalBytes: 52_955_000 },
        { ref: 'winemag-data-130k-v2.json', name: 'winemag-data-130k-v2.json', totalBytes: 88_000_000 },
        { ref: 'photo.png', name: 'photo.png', totalBytes: 1200 },
        { nope: true },
      ],
      errorMessage: null,
      nextPageToken: '',
    };
    const files = parseKaggleFiles(fixture);
    expect(files).toEqual([
      { name: 'winemag-data-130k-v2.csv', bytes: 52_955_000 },
      { name: 'winemag-data-130k-v2.json', bytes: 88_000_000 },
      { name: 'photo.png', bytes: 1200 },
    ]);
    const { readable, other } = readableKaggleFiles(files);
    expect(readable.map(f => f.name)).toEqual(['winemag-data-130k-v2.csv', 'winemag-data-130k-v2.json']);
    expect(other.map(f => f.name)).toEqual(['photo.png']);
  });

  it('lists files from the older answer (an array, sizes as text) and passes Kaggle’s errors on', () => {
    expect(parseKaggleFiles([{ name: 'a.csv', size: '1.5 MB' }, { name: 'b.csv', size: '300KB' }, { name: 'c.csv' }])).toEqual([
      { name: 'a.csv', bytes: 1_572_864 }, { name: 'b.csv', bytes: 307_200 }, { name: 'c.csv', bytes: null },
    ]);
    expect(() => parseKaggleFiles({ errorMessage: 'Dataset not found' })).toThrow('Kaggle: Dataset not found');
    expect(() => parseKaggleFiles({ code: 403, message: 'Permission denied' })).toThrow(/Permission denied/);
    expect(() => parseKaggleFiles('what')).toThrow(/doesn’t understand/);
  });

  it('reads kaggle.json', () => {
    expect(parseKaggleJson('{"username":"ann","key":"0123abcd"}')).toEqual({ username: 'ann', key: '0123abcd' });
    expect(parseKaggleJson('{"username":"ann"}')).toBeNull();
    expect(parseKaggleJson('nope')).toBeNull();
  });
});
