/**
 * Typed-in tables: the spreadsheet's edits, pasting blocks from Excel and
 * Google Sheets, and what the notebook reads.
 */
import { describe, expect, it } from 'vitest';
import {
  addColumn, addRows, blankManualTable, cellReads, clearCells, copyBlock, deleteColumn, deleteRows, inferManualType,
  manualToTable, moveColumn, moveRow, parsePasteBlock, pasteBlock, renameColumn, retypeColumn, setCell, tableToManual,
  type ManualTable,
} from '../manualTable';
import { computeDataset } from '../compute';
import { datasetJob } from '../datasetActions';
import { parseDatasetsRecord } from '../types';

const t0 = (): ManualTable => ({
  columns: [{ name: 'city', type: 'text' }, { name: 'temp', type: 'number' }],
  rows: [['Oslo', '4'], ['Rome', '17.5'], ['Cairo', '']],
});

describe('typed-in table edits', () => {
  it('adds, renames, retypes, moves and deletes columns', () => {
    let t = addColumn(t0());
    expect(t.columns.map(c => c.name)).toEqual(['city', 'temp', 'c']);
    expect(t.rows.every(r => r.length === 3 && r[2] === '')).toBe(true);
    t = addColumn(t, 0, { name: 'id', type: 'number' });
    expect(t.columns[0]).toEqual({ name: 'id', type: 'number' });
    expect(t.rows[0]).toEqual(['', 'Oslo', '4', '']);
    t = renameColumn(t, 3, 'temp'); // taken: numbered
    expect(t.columns[3].name).toBe('temp 2');
    expect(renameColumn(t, 3, '   ')).toBe(t); // blank refused
    t = retypeColumn(t, 1, 'category');
    expect(t.columns[1].type).toBe('category');
    expect(t.rows[1][1]).toBe('Rome'); // cells stay as typed
    t = moveColumn(t, 2, 0);
    expect(t.columns.map(c => c.name)).toEqual(['temp', 'id', 'city', 'temp 2']);
    expect(t.rows[1]).toEqual(['17.5', '', 'Rome', '']);
    t = deleteColumn(t, 1);
    expect(t.columns.map(c => c.name)).toEqual(['temp', 'city', 'temp 2']);
    expect(t.rows[0]).toEqual(['4', 'Oslo', '']);
  });

  it('adds, moves and deletes rows; edits and clears cells', () => {
    let t = addRows(t0(), 1, 2);
    expect(t.rows.map(r => r[0])).toEqual(['Oslo', '', '', 'Rome', 'Cairo']);
    t = deleteRows(t, 1, 2);
    expect(t.rows.map(r => r[0])).toEqual(['Oslo', 'Rome', 'Cairo']);
    t = moveRow(t, 2, 0);
    expect(t.rows.map(r => r[0])).toEqual(['Cairo', 'Oslo', 'Rome']);
    t = setCell(t, 0, 1, '35');
    expect(t.rows[0][1]).toBe('35');
    expect(setCell(t, 0, 1, '35')).toBe(t); // no change, same table
    t = clearCells(t, 0, 0, 1, 1);
    expect(t.rows.slice(0, 2)).toEqual([['', ''], ['', '']]);
    expect(t.rows[2]).toEqual(['Rome', '17.5']);
  });

  it('never changes the table it was given (undo keeps the old ones)', () => {
    const a = t0();
    const snapshot = JSON.stringify(a);
    addColumn(a); addRows(a); setCell(a, 0, 0, 'x'); moveRow(a, 0, 1); deleteColumn(a, 0); pasteBlock(a, 0, 0, '1\t2\n3\t4');
    expect(JSON.stringify(a)).toBe(snapshot);
  });

  it('reads numbers per column type: plain, percent, money, dates; bad cells read as empty', () => {
    const t: ManualTable = {
      columns: [{ name: 'n', type: 'number' }, { name: 'label', type: 'text' }],
      rows: [['1,234.5', 'a'], ['45%', 'b'], ['$12.50', ''], ['oops', 'd'], ['', ''], ['', '']],
    };
    const r = manualToTable(t);
    expect(r.rows).toBe(4); // trailing empty rows left out
    const n = r.columns[0];
    expect(n.type).toBe('number');
    expect(n.values).toEqual([1234.5, 0.45, 12.5, null]);
    expect(r.columns[1]).toEqual({ name: 'label', type: 'category', values: ['a', 'b', null, 'd'] });
    expect(cellReads('number', 'oops')).toBe(false);
    expect(cellReads('number', '')).toBe(true);
    expect(cellReads('text', 'oops')).toBe(true);
  });

  it('a text column of numbers stays text; an empty one still reads as text', () => {
    const r = manualToTable({ columns: [{ name: 'zip', type: 'text' }, { name: 'empty', type: 'category' }], rows: [['0150', ''], ['2000', '']] });
    expect(r.columns[0]).toEqual({ name: 'zip', type: 'category', values: ['0150', '2000'] });
    expect(r.columns[1].type).toBe('category');
  });

  it('feeds the notebook like a file would', () => {
    const d = {
      id: 'typed', name: 'Typed', normalize: false, result: null,
      source: { kind: 'manual' as const, ...t0() },
      cells: [{ id: 'a', code: "df.where(r => r.temp !== null).assign({ f: r => r.temp * 9 / 5 + 32 })" }],
    };
    const out = computeDataset(datasetJob(d));
    expect(out.parseError).toBeUndefined();
    const res = out.run?.result;
    expect(res?.kind).toBe('table');
    if (res?.kind !== 'table') return;
    expect(res.columns.find(c => c.name === 'f')?.values).toEqual([39.2, 63.5]);
  });

  it('is saved and checked on load', () => {
    const parsed = parseDatasetsRecord({
      typed: { name: 'T', source: { kind: 'manual', columns: [{ name: 'a', type: 'number' }, { name: 'a', type: 'text' }, { name: 'b', type: 'weird' }], rows: [['1', 'x', 9], 'bad', ['2']] }, cells: [], result: null },
      old: { name: 'Old', source: { kind: 'manual' }, cells: [], result: null },
    });
    expect(parsed.typed.source).toEqual({ kind: 'manual', columns: [{ name: 'a', type: 'number' }, { name: 'b', type: 'text' }], rows: [['1', 'x'], ['', ''], ['2', '']] });
    expect(parsed.old.source).toEqual({ kind: 'manual', columns: [], rows: [] });
  });

  it('round-trips a table result', () => {
    const back = tableToManual(manualToTable(t0()));
    expect(back.columns).toEqual([{ name: 'city', type: 'text' }, { name: 'temp', type: 'number' }]);
    expect(back.rows).toEqual([['Oslo', '4'], ['Rome', '17.5'], ['Cairo', '']]);
  });
});

describe('pasting', () => {
  it('splits Excel / Google Sheets blocks (tabs, quoted cells, CRLF, a trailing newline)', () => {
    expect(parsePasteBlock('a\tb\r\n1\t2\r\n')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parsePasteBlock('"line\none"\tx\n"say ""hi"""\ty')).toEqual([['line\none', 'x'], ['say "hi"', 'y']]);
    expect(parsePasteBlock('1\t2\n3')).toEqual([['1', '2'], ['3', '']]); // ragged rows padded
    expect(parsePasteBlock('x,y,z')).toEqual([['x', 'y', 'z']]); // one CSV line
    expect(parsePasteBlock('one value')).toEqual([['one value']]);
    expect(parsePasteBlock('')).toEqual([]);
  });

  it('infers column types from pasted values', () => {
    expect(inferManualType(['1', '2.5', '', '-3'])).toBe('number');
    expect(inferManualType(['$4', '$5'])).toBe('number');
    expect(inferManualType(['red', 'blue', 'red', 'blue', 'red'])).toBe('category');
    expect(inferManualType(['Ann', 'Bob', 'Cy'])).toBe('text');
  });

  it('into an empty table: a header row becomes the names and every column is typed', () => {
    const res = pasteBlock(blankManualTable(), 0, 0, 'name\tscore\tteam\nAnn\t12\tred\nBob\t7.5\tblue\nCy\t9\tred\nDee\t3\tred\n');
    expect(res.header).toBe(true);
    expect(res.rows).toBe(4);
    expect(res.table.columns).toEqual([{ name: 'name', type: 'text' }, { name: 'score', type: 'number' }, { name: 'team', type: 'category' }]);
    expect(res.table.rows).toEqual([['Ann', '12', 'red'], ['Bob', '7.5', 'blue'], ['Cy', '9', 'red'], ['Dee', '3', 'red']]);
  });

  it('into an empty table without names: keeps the names, types the columns', () => {
    const res = pasteBlock(blankManualTable(), 0, 0, '1\t2\t3\t4\n5\t6\t7\t8');
    expect(res.header).toBe(false);
    expect(res.table.columns.map(c => c.name)).toEqual(['label', 'x', 'y', 'd']);
    expect(res.table.columns.every(c => c.type === 'number')).toBe(true);
    expect(res.table.rows).toEqual([['1', '2', '3', '4'], ['5', '6', '7', '8']]);
  });

  it('at a cell: overwrites and grows the table to fit, typing new columns', () => {
    const res = pasteBlock(t0(), 2, 1, '30\tbusy\n31\tcalm\n32\tbusy');
    expect(res.header).toBe(false);
    expect(res.table.columns.map(c => c.name)).toEqual(['city', 'temp', 'c']);
    expect(res.table.columns[2].type).toBe('text');
    expect(res.table.rows).toEqual([['Oslo', '4', ''], ['Rome', '17.5', ''], ['Cairo', '30', 'busy'], ['', '31', 'calm'], ['', '32', 'busy']]);
    expect(res.rows).toBe(3);
    expect(res.columns).toBe(2);
  });

  it('copies a range as tab-separated text that pastes back the same', () => {
    const t: ManualTable = { columns: [{ name: 'a', type: 'text' }, { name: 'b', type: 'text' }], rows: [['x\ty', 'q"uote'], ['1', '2']] };
    const text = copyBlock(t, 0, 0, 1, 1);
    expect(text).toBe('"x\ty"\t"q""uote"\n1\t2');
    expect(parsePasteBlock(text)).toEqual([['x\ty', 'q"uote'], ['1', '2']]);
  });
});
