/**
 * Packing table columns into a data texture's float array (see dataGlsl.ts):
 * four columns per texel (RGBA), row i at texel i, lines of DATA_TEX_WIDTH.
 * Number columns go in as they are; a category column goes in as the index
 * of each value in order of first appearance (0, 1, 2…); missing values and
 * "other" columns are 0.
 */
import { DATA_TEX_WIDTH } from './dataGlsl';
import type { Column, TableResult } from './types';

/** Texture size for `rows` rows. */
export function texSize(rows: number): { width: number; height: number } {
  const n = Math.max(1, rows);
  return { width: Math.min(n, DATA_TEX_WIDTH), height: Math.ceil(n / DATA_TEX_WIDTH) };
}

/** A column as numbers for the shader. */
export function columnNumbers(c: Column | undefined, rows: number): Float32Array {
  const out = new Float32Array(rows);
  if (!c) return out;
  if (c.type === 'number') {
    for (let i = 0; i < rows; i++) { const v = c.values[i]; out[i] = v === null || v === undefined ? 0 : v; }
  } else if (c.type === 'category') {
    const codes = new Map<string, number>();
    for (let i = 0; i < rows; i++) {
      const v = c.values[i];
      if (v === null || v === undefined) continue;
      let k = codes.get(v);
      if (k === undefined) { k = codes.size; codes.set(v, k); }
      out[i] = k;
    }
  }
  return out;
}

/** The RGBA float data for up to four named columns of a table (a missing column reads 0). */
export function packColumns(t: TableResult | null, columns: readonly string[]): { data: Float32Array; width: number; height: number; rows: number } {
  const rows = t ? t.rows : 0;
  const { width, height } = texSize(rows);
  const data = new Float32Array(width * height * 4);
  if (!t) return { data, width, height, rows };
  columns.slice(0, 4).forEach((name, ch) => {
    const vals = columnNumbers(t.columns.find(c => c.name === name), rows);
    for (let i = 0; i < rows; i++) data[i * 4 + ch] = vals[i];
  });
  return { data, width, height, rows };
}
