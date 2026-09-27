import { describe, expect, it } from 'vitest';
import { Table } from '../table';
import { runNotebook, hoistTopLevel } from '../notebook';
import { normalizeTable, normalizeSummary } from '../normalize';
import { parseCsv } from '../parse';
import type { NumberColumn } from '../types';

const CITIES = Table.from([
  { city: 'Oslo', month: 1, temp: -4 },
  { city: 'Oslo', month: 7, temp: 17 },
  { city: 'Rome', month: 1, temp: 8 },
  { city: 'Rome', month: 7, temp: 25 },
  { city: 'Cairo', month: 1, temp: 14 },
  { city: 'Cairo', month: 7, temp: 28 },
]);

describe('table helper', () => {
  it('reads columns by bracket and col(), and never changes in place', () => {
    const df = CITIES as Table & Record<string, unknown>;
    expect(df['temp']).toEqual([-4, 17, 8, 25, 14, 28]);
    expect(CITIES.col('city')[0]).toBe('Oslo');
    const warm = CITIES.where(r => (r.temp as number) > 10);
    expect(warm.length).toBe(4);
    expect(CITIES.length).toBe(6);
    expect(CITIES.shape).toEqual([6, 3]);
    expect(() => CITIES.col('nope')).toThrow(/No column "nope"/);
  });

  it('where takes an expression string', () => {
    expect(CITIES.where('temp > 10 && city != "Rome"').col('temp')).toEqual([17, 14, 28]);
  });

  it('assign, select, drop, rename', () => {
    const t = CITIES.assign({ f: r => (r.temp as number) * 9 / 5 + 32, one: 1 }).select('city', 'f', 'one').rename({ f: 'fahrenheit' });
    expect(t.columns).toEqual(['city', 'fahrenheit', 'one']);
    expect(t.col('fahrenheit')[0]).toBeCloseTo(24.8);
    expect(t.col('one')).toEqual([1, 1, 1, 1, 1, 1]);
    expect(CITIES.drop('month').columns).toEqual(['city', 'temp']);
  });

  it('sort (stable, descending, missing last), head, tail', () => {
    expect(CITIES.sort('temp', { descending: true }).head(2).col('temp')).toEqual([28, 25]);
    expect(CITIES.sort(['city', 'month']).col('city')).toEqual(['Cairo', 'Cairo', 'Oslo', 'Oslo', 'Rome', 'Rome']);
    expect(Table.from([{ a: 2 }, { a: null }, { a: 1 }]).sort('a').col('a')).toEqual([1, 2, null]);
    expect(CITIES.tail(1).col('temp')).toEqual([28]);
  });

  it('groupby: mean, count, agg, size, sorted by key', () => {
    const g = CITIES.groupby('city').mean('temp');
    expect(g.columns).toEqual(['city', 'temp']);
    expect(g.col('city')).toEqual(['Cairo', 'Oslo', 'Rome']);
    expect(g.col('temp')).toEqual([21, 6.5, 16.5]);
    expect(CITIES.groupby('city', { sort: false }).count('temp').col('city')).toEqual(['Oslo', 'Rome', 'Cairo']);
    const a = CITIES.groupby('month').agg({ temp: 'max', city: v => v.length });
    expect(a.col('temp')).toEqual([14, 28]);
    expect(a.col('city')).toEqual([3, 3]);
    expect(CITIES.groupby('city').size().col('size')).toEqual([2, 2, 2]);
  });

  it('describe, unique, valueCounts', () => {
    const d = CITIES.describe();
    expect(d.col('stat')).toEqual(['count', 'mean', 'std', 'min', '25%', '50%', '75%', 'max']);
    expect(d.columns).toEqual(['stat', 'month', 'temp']);
    expect(d.col('temp')[0]).toBe(6);
    expect(d.col('temp')[3]).toBe(-4);
    expect(CITIES.unique('city')).toEqual(['Oslo', 'Rome', 'Cairo']);
    expect(CITIES.valueCounts('month').col('count')).toEqual([3, 3]);
  });

  it('normalize, dropna, fillna', () => {
    expect(CITIES.normalize('temp').col('temp')).toEqual([0, 21 / 32, 12 / 32, 29 / 32, 18 / 32, 1]);
    const holes = Table.from([{ a: 1, b: null }, { a: null, b: 2 }, { a: 3, b: 4 }]);
    expect(holes.dropna().length).toBe(1);
    expect(holes.dropna('a').length).toBe(2);
    expect(holes.fillna(0).col('b')).toEqual([0, 2, 4]);
    expect(holes.fillna({ a: -1 }).col('a')).toEqual([1, -1, 3]);
  });

  it('sample and kmeans are the same for the same seed', () => {
    expect(CITIES.sample(3, 7).col('temp')).toEqual(CITIES.sample(3, 7).col('temp'));
    expect(CITIES.sample(10, 1).length).toBe(6);
    const pts = Table.from([
      ...Array.from({ length: 20 }, (_, i) => ({ x: 0 + (i % 5) * 0.01, y: 0 + (i % 3) * 0.01 })),
      ...Array.from({ length: 20 }, (_, i) => ({ x: 5 + (i % 5) * 0.01, y: 5 + (i % 3) * 0.01 })),
      ...Array.from({ length: 20 }, (_, i) => ({ x: 0 + (i % 5) * 0.01, y: 9 + (i % 3) * 0.01 })),
    ]);
    const a = pts.kmeans(['x', 'y'], 3, { seed: 4 }).col('cluster');
    const b = pts.kmeans(['x', 'y'], 3, { seed: 4 }).col('cluster');
    expect(a).toEqual(b);
    // Three clear blobs: each blob is one cluster, and the three differ
    const blobs = [a.slice(0, 20), a.slice(20, 40), a.slice(40)];
    for (const bl of blobs) expect(new Set(bl).size).toBe(1);
    expect(new Set(blobs.map(bl => bl[0])).size).toBe(3);
  });

  it('turns into a typed result', () => {
    const r = CITIES.toResult();
    expect(r.rows).toBe(6);
    expect(r.columns.map(c => c.type)).toEqual(['category', 'number', 'number']);
    expect((r.columns[2] as NumberColumn).min).toBe(-4);
  });
});

describe('notebook', () => {
  const input = parseCsv('city,month,temp\nOslo,1,-4\nOslo,7,17\nRome,1,8\nRome,7,25').result;

  it('runs cells top to bottom; top-level names carry; the last value is the dataset', () => {
    const run = runNotebook(input, [
      { id: 'a', code: 'const warm = df.where(r => r.temp > 0)' },
      { id: 'b', code: 'function f(c) { return c * 9 / 5 + 32 }\nwarm.assign({ f: r => f(r.temp) })' },
    ]);
    expect(run.cells.every(c => c.ok)).toBe(true);
    expect(run.result?.kind).toBe('table');
    if (run.result?.kind !== 'table') return;
    expect(run.result.rows).toBe(3);
    expect(run.result.columns.map(c => c.name)).toEqual(['city', 'month', 'temp', 'f']);
  });

  it('`result` wins over the last value; groupby output previews as a table', () => {
    const run = runNotebook(input, [
      { id: 'a', code: 'result = df.groupby("city").mean("temp")' },
      { id: 'b', code: '"not this"' },
    ]);
    expect(run.result?.kind).toBe('table');
    expect(run.cells[0].ok && run.cells[0].preview.kind).toBe('table');
  });

  it('an error stops the run, names the line and keeps no result', () => {
    const run = runNotebook(input, [
      { id: 'a', code: 'x = 1' },
      { id: 'b', code: 'y = 2\nnope.call()' },
      { id: 'c', code: 'x' },
    ]);
    expect(run.result).toBeNull();
    expect(run.cells.length).toBe(2);
    const b = run.cells[1];
    expect(b.ok).toBe(false);
    if (!b.ok) { expect(b.error).toMatch(/nope|undefined/); }
  });

  it('text and JSON results; console.log is captured', () => {
    const run = runNotebook({ kind: 'text', text: 'a b a' }, [{ id: 'a', code: 'console.log(data.length)\ndata.split(" ").length' }]);
    expect(run.result).toEqual({ kind: 'json', value: 3 });
    expect(run.cells[0].logs).toEqual(['5']);
    const words = runNotebook({ kind: 'text', text: 'a b a' }, [{ id: 'a', code: 'data.toUpperCase()' }]);
    expect(words.result).toEqual({ kind: 'text', text: 'A B A' });
    const records = runNotebook({ kind: 'json', value: [1, 2] }, [{ id: 'a', code: 'data.map(v => ({ v, sq: v * v }))' }]);
    expect(records.result?.kind).toBe('table');
  });

  it('no cells: the data as it came in', () => {
    expect(runNotebook(input, []).result).toEqual(Table.fromResult(input).toResult());
  });

  it('hoists only top-level declarations', () => {
    expect(hoistTopLevel('const a = 1\nif (a) {\n  const b = 2\n}\nlet c = a == 1')).toBe('a = 1\nif (a) {\n  const b = 2\n}\nc = a == 1');
  });
});

describe('Normalize 0–1', () => {
  it('maps number columns min…max to 0…1, leaves 0–1 columns and text alone', () => {
    const t = parseCsv('a,b,c,d\n10,0.2,x,5\n20,0.9,y,5\n30,0.5,z,5').result;
    const n = normalizeTable(t);
    expect(n.columns[0].values).toEqual([0, 0.5, 1]);
    expect(n.columns[1].values).toEqual([0.2, 0.9, 0.5]);
    expect(n.columns[2].values).toEqual(['x', 'y', 'z']);
    expect(n.columns[3].values).toEqual([0, 0, 0]); // constant column
    expect(normalizeSummary(t)).toEqual({ mapped: ['a', 'd'], kept: ['b'] });
  });
});

describe('table mistakes', () => {
  it('a name that is neither a method nor a column says so', () => {
    const df = Table.from([{ temp: 1 }]) as unknown as Record<string, unknown>;
    expect(() => df.tmep).toThrow(/no method or column "tmep".*temp/);
    expect(df.then).toBeUndefined();
    const run = runNotebook(Table.from([{ temp: 1 }]).toResult(), [{ id: 'a', code: 'df.gr' }]);
    expect(run.result).toBeNull();
    expect(run.cells[0].ok).toBe(false);
  });
});
