/**
 * How a dataset reaches the shader.
 *
 * A Data node's columns travel as float textures: RGBA32F, one row per texel,
 * four columns per texture, rows laid out left to right in lines of
 * DATA_TEX_WIDTH texels (row i is texel (i % 1024, i / 1024)). A texture's
 * uniform is named after the dataset and the columns it holds,
 * `u_ds_<dataset>_<hash of the columns>`, so two nodes reading the same
 * columns share one texture and the shader never depends on the dataset's
 * values or even its column order: a new result re-uploads the texture and
 * never recompiles. The row count is `u_ds_<dataset>_n`, a uniform too, so a
 * table can grow (a live stream) without a recompile.
 *
 * The declarations sit in the node's GLSL helpers with a comment naming the
 * columns (`// data-columns <dataset> <col>,<col>`), which is how the preview
 * finds what to upload: dataBindingsFromShader() reads them back from the
 * compiled shader, whatever path compiled the node (top level, a group, a
 * field function).
 */
export const DATA_TEX_WIDTH = 1024;

/** Texel fetch for row i of a data texture. */
export const DS_FETCH_GLSL = `// data-helper
vec4 dsFetch(sampler2D t, int i) {
    return texelFetch(t, ivec2(i - (i / ${DATA_TEX_WIDTH}) * ${DATA_TEX_WIDTH}, i / ${DATA_TEX_WIDTH}), 0);
}`;

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

export const dataCountUniform = (dataset: string) => `u_ds_${dataset}_n`;
export const dataTexUniform = (dataset: string, columns: readonly string[]) => `u_ds_${dataset}_${fnv(columns.join('\u0001'))}`;

export interface TexSlot { uniform: string; columns: string[] }
export interface ColumnRef { tex: number; channel: 'x' | 'y' | 'z' | 'w' }

/** The textures a set of columns needs (four per texture, in order) and where each column sits. */
export function layoutColumns(dataset: string, columns: readonly string[]): { textures: TexSlot[]; where: Map<string, ColumnRef> } {
  const uniq = [...new Set(columns)];
  const textures: TexSlot[] = [];
  const where = new Map<string, ColumnRef>();
  for (let i = 0; i < uniq.length; i += 4) {
    const cols = uniq.slice(i, i + 4);
    textures.push({ uniform: dataTexUniform(dataset, cols), columns: cols });
    cols.forEach((c, j) => where.set(c, { tex: textures.length - 1, channel: 'xyzw'[j] as ColumnRef['channel'] }));
  }
  return { textures, where };
}

/** The GLSL helper block for a dataset's textures: uniform declarations (with their columns) and dsFetch. */
export function dataUniformBlock(dataset: string, textures: readonly TexSlot[]): string[] {
  return [
    `uniform float ${dataCountUniform(dataset)}; // data-count ${dataset}`,
    ...textures.map(t => `uniform sampler2D ${t.uniform}; // data-columns ${dataset} ${t.columns.map(c => encodeURIComponent(c)).join(',')}`),
    DS_FETCH_GLSL,
  ];
}

export interface DataBindings {
  textures: Array<{ uniform: string; dataset: string; columns: string[] }>;
  counts: Array<{ uniform: string; dataset: string }>;
}

/** Which data textures and row counts a compiled shader declares (see the header). */
export function dataBindingsFromShader(fs: string): DataBindings {
  const textures: DataBindings['textures'] = [];
  const counts: DataBindings['counts'] = [];
  const seen = new Set<string>();
  for (const m of fs.matchAll(/uniform\s+sampler2D\s+(u_ds_\w+)\s*;\s*\/\/\s*data-columns\s+([a-z][a-z0-9]*)\s+(\S*)/g)) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    textures.push({ uniform: m[1], dataset: m[2], columns: m[3] ? m[3].split(',').map(c => decodeURIComponent(c)) : [] });
  }
  for (const m of fs.matchAll(/uniform\s+float\s+(u_ds_\w+_n)\s*;\s*\/\/\s*data-count\s+([a-z][a-z0-9]*)/g)) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    counts.push({ uniform: m[1], dataset: m[2] });
  }
  return { textures, counts };
}

/** Blocks that declare data uniforms go first among the helpers, so functions anywhere (a Custom Function) can call the row helpers. */
export function dataBlocksFirst(blocks: string[]): string[] {
  const isData = (b: string) => /\/\/ data-(columns|count|helper)\b/.test(b);
  return [...blocks.filter(isData), ...blocks.filter(b => !isData(b))];
}
