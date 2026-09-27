import { describe, expect, it } from 'vitest';
import { detectHeader, formatFor, parseCsv, parseSourceText, readNumber, sniffDelimiter, splitCsv } from '../parse';
import type { NumberColumn } from '../types';

describe('CSV parsing', () => {
  it('splits quoted fields with escaped quotes, delimiters and line breaks inside', () => {
    const rows = splitCsv('a,b,c\n"x, y","say ""hi""","two\nlines"\r\n1,2,3', ',');
    expect(rows).toEqual([['a', 'b', 'c'], ['x, y', 'say "hi"', 'two\nlines'], ['1', '2', '3']]);
  });

  it('strips a BOM and keeps a last line without a newline', () => {
    const { result } = parseCsv('﻿city,temp\nOslo,4\nRome,18');
    expect(result.columns.map(c => c.name)).toEqual(['city', 'temp']);
    expect(result.rows).toBe(2);
  });

  it('sniffs the delimiter: semicolons, tabs, pipes', () => {
    expect(sniffDelimiter('a;b;c\n1;2;3\n4;5;6')).toBe(';');
    expect(sniffDelimiter('a\tb\n1\t2')).toBe('\t');
    expect(sniffDelimiter('a|b|c\n1|2|3')).toBe('|');
    // Commas inside a semicolon file's numbers don't fool it
    expect(sniffDelimiter('name;value\nx;"1,5"\ny;"2,5"')).toBe(';');
    expect(sniffDelimiter('x,y', 'tsv')).toBe('\t');
  });

  it('detects the header row', () => {
    expect(detectHeader([['x', 'y'], ['1', '2'], ['3', '4']])).toBe(true);
    expect(detectHeader([['1', '2'], ['3', '4']])).toBe(false);
    expect(detectHeader([['name', 'colour'], ['sky', 'blue']])).toBe(true);
    // An empty first cell is data, not a header
    expect(detectHeader([['', '2'], ['3', '4']])).toBe(false);
  });

  it('numbers without a header get c1, c2… names; a forced header wins', () => {
    const { result, info } = parseCsv('1,2\n3,4');
    expect(info.header).toBe(false);
    expect(result.columns.map(c => c.name)).toEqual(['c1', 'c2']);
    const forced = parseCsv('1,2\n3,4', { header: 'yes' });
    expect(forced.result.columns.map(c => c.name)).toEqual(['1', '2']);
    expect(forced.result.rows).toBe(1);
  });

  it('types columns: numbers with thousands, percent, money and dates; text is a category', () => {
    const { result } = parseCsv('n,p,m,d,t\n"1,234.5",45%,$12.50,2024-01-02,red\n7,5%,$3,2024-01-03,blue');
    const byName = Object.fromEntries(result.columns.map(c => [c.name, c]));
    expect(byName.n.type).toBe('number');
    expect(byName.n.values).toEqual([1234.5, 7]);
    expect(byName.p.values).toEqual([0.45, 0.05]);
    expect(byName.m.values).toEqual([12.5, 3]);
    expect(byName.d.type).toBe('number');
    expect((byName.d as NumberColumn).values[1]! - (byName.d as NumberColumn).values[0]!).toBeCloseTo(1); // days
    expect(byName.t.type).toBe('category');
    expect((byName.n as NumberColumn).min).toBe(7);
    expect((byName.n as NumberColumn).max).toBe(1234.5);
  });

  it('missing values are null and do not stop a number column', () => {
    const { result } = parseCsv('a,b\n1,x\n,y\nNA,z\n4,');
    expect(result.columns[0].type).toBe('number');
    expect(result.columns[0].values).toEqual([1, null, null, 4]);
    expect(result.columns[1].values).toEqual(['x', 'y', 'z', null]);
  });

  it('a mix of numbers and words is a category column', () => {
    const { result } = parseCsv('a\n1\ntwo\n3', { header: 'yes' });
    expect(result.columns[0].type).toBe('category');
  });

  it('pads ragged rows, names blank and duplicate headers', () => {
    const { result, info } = parseCsv('x,x,\n1,2,3\n4\n5,6,7,8');
    expect(result.columns.map(c => c.name)).toEqual(['x', 'x 2', 'column 3', 'column 4']);
    expect(result.columns[1].values).toEqual([2, null, 6]);
    expect(info.ragged).toBe(2);
  });

  it('reads plain numbers only when they are numbers', () => {
    expect(readNumber('1e3', 'plain')).toBe(1000);
    expect(readNumber('-0.5', 'plain')).toBe(-0.5);
    expect(readNumber('12abc', 'plain')).toBeNull();
    expect(readNumber('1,5', 'plain')).toBeNull();
    expect(readNumber('-$4.25', 'money')).toBe(-4.25);
    expect(readNumber('2024-02-30', 'date')).toBeNull();
  });
});

describe('JSON and text', () => {
  it('an array of flat records becomes a table, keys in order of first appearance', () => {
    const { result } = parseSourceText(JSON.stringify([{ x: 1, y: 2 }, { y: 3, z: 'a' }]), 'json');
    expect(result.kind).toBe('table');
    if (result.kind !== 'table') return;
    expect(result.columns.map(c => c.name)).toEqual(['x', 'y', 'z']);
    expect(result.columns[0].values).toEqual([1, null]);
    expect(result.columns[2].type).toBe('category');
  });

  it('other JSON stays a value; nested records are not a table', () => {
    expect(parseSourceText('{"a": [1, 2]}', 'json').result).toEqual({ kind: 'json', value: { a: [1, 2] } });
    expect(parseSourceText('[{"a": {"b": 1}}]', 'json').result.kind).toBe('json');
    expect(parseSourceText('[1, 2, 3]', 'json').result.kind).toBe('json');
  });

  it('bad JSON says so', () => {
    expect(() => parseSourceText('{nope', 'json')).toThrow(/doesn't parse/);
  });

  it('text is kept as a string', () => {
    expect(parseSourceText('﻿hello\nworld', 'text').result).toEqual({ kind: 'text', text: 'hello\nworld' });
  });

  it('guesses the format from the name, else the text', () => {
    expect(formatFor('a.CSV', '')).toBe('csv');
    expect(formatFor('a.tsv', '')).toBe('tsv');
    expect(formatFor('a.json', '')).toBe('json');
    expect(formatFor('poem.txt', 'a,b')).toBe('text');
    expect(formatFor('data', '[{"a":1}]')).toBe('json');
    expect(formatFor('data', 'a\tb\n1\t2')).toBe('tsv');
    expect(formatFor('data', 'just words')).toBe('text');
  });
});
