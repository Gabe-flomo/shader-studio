/**
 * Data node — reads a dataset (a table imported into the graph file; see
 * src/data/) in the shader. It picks a dataset and a way to use it:
 *
 *  - Values: Index picks a row; chosen columns come out as float or, grouped,
 *    vec2/vec3/vec4. Blend fades between neighbouring rows at a fractional
 *    index; the ends wrap or clamp. Put it in an iterated group with Loop
 *    Index wired to Index to read every row.
 *  - Points: a column group (x, y or x, y, z) is a point cloud; the node
 *    loops over the rows and gives the distance to the nearest point (or, in
 *    Path mode, to the rows joined in order), the nearest row and the
 *    second-nearest distance (for cells).
 *  - Keyframes: rows are keyframes in time (a time column, or evenly over a
 *    Duration); outputs the interpolated columns, the row and the progress.
 *
 * Columns reach the shader as float textures (src/data/dataGlsl.ts), so a
 * changed dataset only re-uploads them; the shader is rebuilt only when the
 * node's own settings change. The card is small; the editor (a window) holds
 * the import, the notebook and the output builder.
 */
import type { DataType, GraphNode, InputSocket, NodeDefinition, OutputSocket } from '../../types/nodeGraph';
import { dataCountUniform, dataUniformBlock, layoutColumns, type ColumnRef } from '../../data/dataGlsl';
import { p } from './helpers';

export type DataMode = 'values' | 'points' | 'keyframes';
export interface DataOutputSpec { key: string; columns: string[] }

export const DATA_MAX_POINTS = 1024;
export const DATA_DEFAULT_MAX_POINTS = 256;

export const DATA_INTERPS = [
  { value: 'none', label: 'None (step)' },
  { value: 'linear', label: 'Linear' },
  { value: 'smooth', label: 'Smooth' },
  { value: 'easeIn', label: 'Ease in' },
  { value: 'easeOut', label: 'Ease out' },
  { value: 'easeInOut', label: 'Ease in-out' },
  { value: 'catmull', label: 'Catmull-Rom' },
] as const;
export type DataInterp = typeof DATA_INTERPS[number]['value'];

const VEC: Record<number, DataType> = { 1: 'float', 2: 'vec2', 3: 'vec3', 4: 'vec4' };

// ── Reading params ──────────────────────────────────────────────────────────

export const dataMode = (n: GraphNode): DataMode => (n.params.mode === 'points' || n.params.mode === 'keyframes' ? n.params.mode : 'values');
export const dataDataset = (n: GraphNode): string => (typeof n.params.dataset === 'string' && /^[a-z][a-z0-9]{0,31}$/.test(n.params.dataset) ? n.params.dataset : '');
const strList = (v: unknown, max: number): string[] => (Array.isArray(v) ? v.filter((c): c is string => typeof c === 'string').slice(0, max) : []);

export function dataOutputs(n: GraphNode): DataOutputSpec[] {
  const raw = Array.isArray(n.params.outputs) ? n.params.outputs : [];
  const out: DataOutputSpec[] = [];
  const keys = new Set<string>();
  for (const o of raw) {
    if (!o || typeof o !== 'object') continue;
    const x = o as Record<string, unknown>;
    const key = typeof x.key === 'string' && /^o\d{1,3}$/.test(x.key) ? x.key : '';
    const columns = strList(x.columns, 4);
    if (!key || keys.has(key) || columns.length === 0) continue;
    keys.add(key);
    out.push({ key, columns });
  }
  return out;
}
export const dataRowColumns = (n: GraphNode) => strList(n.params.rowColumns, 4);
export const dataPointColumns = (n: GraphNode) => strList(n.params.pointColumns, 3);
export const dataRadiusColumn = (n: GraphNode) => (n.params.radiusFrom === 'column' && typeof n.params.radiusColumn === 'string' ? n.params.radiusColumn : '');
export const dataTimeColumn = (n: GraphNode) => (typeof n.params.timeColumn === 'string' ? n.params.timeColumn : '');
export const dataPath = (n: GraphNode) => n.params.shape === 'path';
export function dataMaxPoints(n: GraphNode): number {
  const v = typeof n.params.maxPoints === 'number' ? n.params.maxPoints : DATA_DEFAULT_MAX_POINTS;
  return Math.max(1, Math.min(DATA_MAX_POINTS, Math.round(v)));
}
/** The GLSL name of the row helper, `vec4 <name>(float row)`: the node's own, else data_<dataset>. */
export function dataHelperName(n: GraphNode): string {
  const own = typeof n.params.glslName === 'string' ? n.params.glslName.trim() : '';
  return /^[A-Za-z][A-Za-z0-9]*(_[A-Za-z0-9]+)*$/.test(own) && !own.startsWith('gl_') ? own : `data_${dataDataset(n) || 'none'}`;
}

/** Every column the node reads, in the order the textures pack them. */
export function dataUsedColumns(n: GraphNode): string[] {
  const mode = dataMode(n);
  const cols: string[] = [];
  if (mode === 'points') cols.push(...dataPointColumns(n), ...(dataRadiusColumn(n) ? [dataRadiusColumn(n)] : []));
  else {
    if (mode === 'keyframes' && dataTimeColumn(n)) cols.push(dataTimeColumn(n));
    for (const o of dataOutputs(n)) cols.push(...o.columns);
  }
  cols.push(...dataRowColumns(n));
  return [...new Set(cols)];
}

// ── Sockets ─────────────────────────────────────────────────────────────────

/** The sockets a Data node has for its settings. */
export function dataSockets(n: GraphNode): { inputs: Record<string, InputSocket>; outputs: Record<string, OutputSocket> } {
  const mode = dataMode(n);
  const outputs: Record<string, OutputSocket> = {};
  const inputs: Record<string, InputSocket> = {};
  const groups = () => {
    for (const o of dataOutputs(n)) outputs[o.key] = { type: VEC[o.columns.length], label: o.columns.join(', ') };
  };
  if (mode === 'values') {
    inputs.index = { type: 'float', label: 'Index', hint: 'Which row: 0 is the first. A fraction blends two rows when Blend is on.' };
    groups();
  } else if (mode === 'points') {
    const three = dataPointColumns(n).length === 3;
    inputs.p = { type: three ? 'vec3' : 'vec2', label: 'Position', hint: three ? 'The point to measure from (x, y, z).' : 'The point to measure from; unwired, the canvas UV.' };
    if (!dataRadiusColumn(n)) inputs.radius = { type: 'float', label: 'Radius', hint: 'Size of each point (0 gives the plain distance).' };
    outputs.distance = { type: 'float', label: 'Distance' };
    outputs.nearest = { type: 'float', label: 'Nearest row' };
    outputs.second = { type: 'float', label: 'Second distance' };
  } else {
    inputs.time = { type: 'float', label: 'Time', hint: 'Seconds. Unwired, the clock (u_time).' };
    groups();
    outputs.row = { type: 'float', label: 'Row' };
    outputs.progress = { type: 'float', label: 'Progress' };
  }
  outputs.count = { type: 'float', label: 'Rows' };
  return { inputs, outputs };
}

/**
 * A Data card's sockets follow its params (the store calls this after every
 * param change, like Swizzle's). Wires into inputs that still exist with the
 * same type are kept.
 */
export function retypeDataNode(n: GraphNode): GraphNode {
  const want = dataSockets(n);
  const sameIn = Object.keys(want.inputs).length === Object.keys(n.inputs).length && Object.entries(want.inputs).every(([k, s]) => n.inputs[k]?.type === s.type && n.inputs[k]?.label === s.label);
  const sameOut = Object.keys(want.outputs).length === Object.keys(n.outputs).length && Object.entries(want.outputs).every(([k, s]) => n.outputs[k]?.type === s.type && n.outputs[k]?.label === s.label);
  if (sameIn && sameOut) return n;
  const inputs: Record<string, InputSocket> = {};
  for (const [k, s] of Object.entries(want.inputs)) {
    const old = n.inputs[k];
    inputs[k] = { ...s, ...(old?.connection && old.type === s.type ? { connection: old.connection } : {}) };
  }
  return { ...n, inputs, outputs: want.outputs };
}

// ── GLSL ────────────────────────────────────────────────────────────────────

const DS_SMIN = `// data-helper
float dsSmin(float a, float b, float k) {
    float h = max(k - abs(a - b), 0.0) / max(k, 1e-6);
    return min(a, b) - h * h * k * 0.25;
}`;
const DS_SEGMENT = `// data-helper
float dsSegment(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a, ba = b - a;
    return length(pa - ba * clamp(dot(pa, ba) / max(dot(ba, ba), 1e-12), 0.0, 1.0));
}
float dsSegment(vec3 p, vec3 a, vec3 b) {
    vec3 pa = p - a, ba = b - a;
    return length(pa - ba * clamp(dot(pa, ba) / max(dot(ba, ba), 1e-12), 0.0, 1.0));
}`;
const DS_CATMULL = `// data-helper
vec4 dsCatmull(vec4 p0, vec4 p1, vec4 p2, vec4 p3, float t) {
    float t2 = t * t, t3 = t2 * t;
    return 0.5 * ((2.0 * p1) + (-p0 + p2) * t + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t2 + (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * t3);
}`;

/** `vec2(r0.x, r1.z)`: the columns as a GLSL value, from per-texture row variables `rowVar(tex)`. */
function pickColumns(cols: readonly string[], where: Map<string, ColumnRef>, rowVar: (tex: number) => string): string {
  const parts = cols.map(c => { const w = where.get(c); return w ? `${rowVar(w.tex)}.${w.channel}` : '0.0'; });
  return parts.length === 1 ? parts[0] : `${VEC[parts.length]}(${parts.join(', ')})`;
}

function ease(interp: string, u: string): string {
  switch (interp) {
    case 'none': return `(${u} >= 1.0 ? 1.0 : 0.0)`;
    case 'smooth': return `smoothstep(0.0, 1.0, ${u})`;
    case 'easeIn': return `(${u} * ${u})`;
    case 'easeOut': return `(1.0 - (1.0 - ${u}) * (1.0 - ${u}))`;
    case 'easeInOut': return `(${u} < 0.5 ? 2.0 * ${u} * ${u} : 1.0 - 2.0 * (1.0 - ${u}) * (1.0 - ${u}))`;
    default: return u;
  }
}

/** No dataset (or not enough columns): every output is empty. The visible sliders are still read, so they stay live uniforms. */
function zeroOutputs(n: GraphNode, id: string, inputVars: Record<string, string> = {}): { code: string; outputVars: Record<string, string> } {
  const { outputs } = dataSockets(n);
  const outputVars: Record<string, string> = {};
  const mode = dataMode(n);
  let code = mode === 'values' ? `    float ${id}_index = ${inputVars.index ?? p(n.params.index, 0)};\n` : '';
  for (const [k, s] of Object.entries(outputs)) {
    outputVars[k] = `${id}_${k}`;
    code += `    ${s.type} ${id}_${k} = ${s.type === 'float' ? (k === 'distance' || k === 'second' ? '1e9' : '0.0') : `${s.type}(0.0)`};\n`;
  }
  return { code, outputVars };
}

function helperFunctions(n: GraphNode): string[] {
  const ds = dataDataset(n);
  if (!ds) return [];
  const { textures, where } = layoutColumns(ds, dataUsedColumns(n));
  const out = dataUniformBlock(ds, textures);
  const count = dataCountUniform(ds);
  const rowCols = dataRowColumns(n);
  if (rowCols.length) {
    const name = dataHelperName(n);
    const used = [...new Set(rowCols.map(c => where.get(c)?.tex).filter((t): t is number => t !== undefined))];
    const pad = rowCols.length < 4 ? `, ${Array(4 - rowCols.length).fill('0.0').join(', ')}` : '';
    const value = pickColumns(rowCols, where, t => `r${t}`);
    out.push(`// data-helper
vec4 ${name}(float row) {
    int i = int(clamp(floor(row), 0.0, max(${count} - 1.0, 0.0)));
${used.map(t => `    vec4 r${t} = dsFetch(${textures[t].uniform}, i);\n`).join('')}    return ${rowCols.length === 4 ? value : `vec4(${value}${pad})`};
}
float ${name}_count() { return ${count}; }`);
  }
  const mode = dataMode(n);
  if (mode === 'points') out.push(DS_SMIN, DS_SEGMENT);
  if (mode === 'keyframes') out.push(DS_CATMULL);
  return out;
}

function valuesCode(n: GraphNode, id: string, ds: string, inputVars: Record<string, string>): { code: string; outputVars: Record<string, string> } {
  const { textures, where } = layoutColumns(ds, dataUsedColumns(n));
  const count = dataCountUniform(ds);
  const wrap = n.params.edge !== 'clamp';
  const blend = n.params.blend !== false;
  const index = inputVars.index ?? p(n.params.index, 0);
  const outs = dataOutputs(n);
  const texUsed = [...new Set(outs.flatMap(o => o.columns.map(c => where.get(c)!.tex)))];
  const L: string[] = [
    `    float ${id}_n = max(${count}, 1.0);\n`,
    `    float ${id}_i = ${wrap ? `mod(${index}, ${id}_n)` : `clamp(${index}, 0.0, ${id}_n - 1.0)`};\n`,
    `    float ${id}_f = floor(${id}_i);\n`,
    `    int ${id}_a = int(${id}_f);\n`,
  ];
  if (blend) {
    L.push(`    int ${id}_b = ${wrap ? `int(mod(${id}_f + 1.0, ${id}_n))` : `int(min(${id}_f + 1.0, ${id}_n - 1.0))`};\n`);
    L.push(`    float ${id}_t = ${id}_i - ${id}_f;\n`);
  }
  for (const t of texUsed) {
    const u = textures[t].uniform;
    L.push(blend
      ? `    vec4 ${id}_r${t} = mix(dsFetch(${u}, ${id}_a), dsFetch(${u}, ${id}_b), ${id}_t);\n`
      : `    vec4 ${id}_r${t} = dsFetch(${u}, ${id}_a);\n`);
  }
  const outputVars: Record<string, string> = { count: `${id}_count` };
  for (const o of outs) {
    L.push(`    ${VEC[o.columns.length]} ${id}_${o.key} = ${pickColumns(o.columns, where, t => `${id}_r${t}`)};\n`);
    outputVars[o.key] = `${id}_${o.key}`;
  }
  L.push(`    float ${id}_count = ${count};\n`);
  return { code: L.join(''), outputVars };
}

function pointsCode(n: GraphNode, id: string, ds: string, inputVars: Record<string, string>): { code: string; outputVars: Record<string, string> } {
  const cols = dataPointColumns(n);
  const three = cols.length === 3;
  if (cols.length < 2) return zeroOutputs(n, id, inputVars);
  const { textures, where } = layoutColumns(ds, dataUsedColumns(n));
  const count = dataCountUniform(ds);
  const cap = dataMaxPoints(n);
  const T = three ? 'vec3' : 'vec2';
  const P = inputVars.p ?? (three ? 'vec3(g_uv, 0.0)' : 'g_uv');
  const radCol = dataRadiusColumn(n);
  const texUsed = [...new Set([...cols, ...(radCol ? [radCol] : [])].map(c => where.get(c)!.tex))];
  const radius = radCol ? pickColumns([radCol], where, t => `${id}_r${t}`) : (inputVars.radius ?? p(n.params.radius, 0.02));
  const k = p(n.params.smoothK, 0);
  const path = dataPath(n);
  const L = [
    `    ${T} ${id}_p = ${P};\n`,
    `    float ${id}_distance = 1e9;\n    float ${id}_d1 = 1e9;\n    float ${id}_second = 1e9;\n    float ${id}_nearest = 0.0;\n`,
    `    int ${id}_cnt = int(min(${count}, ${cap}.0));\n`,
    path ? `    ${T} ${id}_prev = ${T}(0.0);\n` : '',
    `    for (int ${id}_k = 0; ${id}_k < ${cap}; ${id}_k++) {\n`,
    `        if (${id}_k >= ${id}_cnt) break;\n`,
    ...texUsed.map(t => `        vec4 ${id}_r${t} = dsFetch(${textures[t].uniform}, ${id}_k);\n`),
    `        ${T} ${id}_q = ${pickColumns(cols, where, t => `${id}_r${t}`)};\n`,
    path
      ? `        if (${id}_k == 0) { ${id}_prev = ${id}_q; continue; }\n        float ${id}_e = dsSegment(${id}_p, ${id}_prev, ${id}_q) - (${radius});\n        ${id}_prev = ${id}_q;\n`
      : `        float ${id}_e = length(${id}_p - ${id}_q) - (${radius});\n`,
    `        ${id}_distance = dsSmin(${id}_distance, ${id}_e, ${k});\n`,
    `        if (${id}_e < ${id}_d1) { ${id}_second = ${id}_d1; ${id}_d1 = ${id}_e; ${id}_nearest = float(${id}_k); }\n`,
    `        else if (${id}_e < ${id}_second) { ${id}_second = ${id}_e; }\n`,
    `    }\n`,
    `    float ${id}_count = ${count};\n`,
  ];
  return { code: L.join(''), outputVars: { distance: `${id}_distance`, nearest: `${id}_nearest`, second: `${id}_second`, count: `${id}_count` } };
}

function keyframesCode(n: GraphNode, id: string, ds: string, inputVars: Record<string, string>): { code: string; outputVars: Record<string, string> } {
  const { textures, where } = layoutColumns(ds, dataUsedColumns(n));
  const count = dataCountUniform(ds);
  const time = inputVars.time ?? 'u_time';
  const tcol = dataTimeColumn(n);
  const tref = tcol ? where.get(tcol) : undefined;
  const ends = n.params.ends === 'pingpong' || n.params.ends === 'hold' ? n.params.ends : 'loop';
  const interp = typeof n.params.interp === 'string' ? n.params.interp : 'linear';
  const smoothing = p(n.params.smoothing, 0);
  const outs = dataOutputs(n);
  const T = (i: string) => (tref ? `dsFetch(${textures[tref.tex].uniform}, ${i}).${tref.channel}` : '');
  const L: string[] = [
    `    int ${id}_last = max(int(${count}) - 1, 0);\n`,
  ];
  if (tref) {
    L.push(`    float ${id}_t0 = ${T('0')};\n`);
    L.push(`    float ${id}_D = max(${T(`${id}_last`)} - ${id}_t0, 1e-4);\n`);
  } else {
    L.push(`    float ${id}_t0 = 0.0;\n`);
    L.push(`    float ${id}_D = max(${p(n.params.duration, 4)}, 1e-4);\n`);
  }
  L.push(`    float ${id}_lt = ${time} - ${id}_t0;\n`);
  L.push(ends === 'loop' ? `    ${id}_lt = mod(${id}_lt, ${id}_D);\n`
    : ends === 'pingpong' ? `    ${id}_lt = ${id}_D - abs(mod(${id}_lt, 2.0 * ${id}_D) - ${id}_D);\n`
    : `    ${id}_lt = clamp(${id}_lt, 0.0, ${id}_D);\n`);
  L.push(`    float ${id}_progress = ${id}_lt / ${id}_D;\n`);
  if (tref) {
    L.push(`    int ${id}_lo = 0;\n    int ${id}_hi = ${id}_last;\n`);
    L.push(`    for (int ${id}_s = 0; ${id}_s < 20; ${id}_s++) {\n        if (${id}_hi - ${id}_lo <= 1) break;\n        int ${id}_m = (${id}_lo + ${id}_hi) / 2;\n        if (${T(`${id}_m`)} - ${id}_t0 <= ${id}_lt) ${id}_lo = ${id}_m; else ${id}_hi = ${id}_m;\n    }\n`);
    L.push(`    int ${id}_a = ${id}_lo;\n    int ${id}_b = min(${id}_a + 1, ${id}_last);\n`);
    L.push(`    float ${id}_ta = ${T(`${id}_a`)} - ${id}_t0;\n    float ${id}_tb = ${T(`${id}_b`)} - ${id}_t0;\n`);
    L.push(`    float ${id}_u = ${id}_tb > ${id}_ta ? clamp((${id}_lt - ${id}_ta) / (${id}_tb - ${id}_ta), 0.0, 1.0) : 0.0;\n`);
  } else {
    L.push(`    float ${id}_f = ${id}_progress * float(${id}_last);\n`);
    L.push(`    int ${id}_a = min(int(floor(${id}_f)), max(${id}_last - 1, 0));\n    int ${id}_b = min(${id}_a + 1, ${id}_last);\n`);
    L.push(`    float ${id}_u = clamp(${id}_f - float(${id}_a), 0.0, 1.0);\n`);
  }
  L.push(`    float ${id}_e = ${ease(interp, `${id}_u`)};\n`);
  L.push(`    int ${id}_am = max(${id}_a - 1, 0);\n    int ${id}_bp = min(${id}_b + 1, ${id}_last);\n`);
  const texUsed = [...new Set(outs.flatMap(o => o.columns.map(c => where.get(c)!.tex)))];
  for (const t of texUsed) {
    const u = textures[t].uniform;
    L.push(`    vec4 ${id}_km${t} = dsFetch(${u}, ${id}_am);\n    vec4 ${id}_k0${t} = dsFetch(${u}, ${id}_a);\n    vec4 ${id}_k1${t} = dsFetch(${u}, ${id}_b);\n    vec4 ${id}_kp${t} = dsFetch(${u}, ${id}_bp);\n`);
    // Smoothing: each key pulled toward the mean of itself and its neighbours.
    L.push(`    vec4 ${id}_s0${t} = mix(${id}_k0${t}, (${id}_km${t} + ${id}_k0${t} + ${id}_k1${t}) / 3.0, ${smoothing});\n`);
    L.push(`    vec4 ${id}_s1${t} = mix(${id}_k1${t}, (${id}_k0${t} + ${id}_k1${t} + ${id}_kp${t}) / 3.0, ${smoothing});\n`);
    L.push(interp === 'catmull'
      ? `    vec4 ${id}_r${t} = dsCatmull(${id}_km${t}, ${id}_s0${t}, ${id}_s1${t}, ${id}_kp${t}, ${id}_u);\n`
      : `    vec4 ${id}_r${t} = mix(${id}_s0${t}, ${id}_s1${t}, ${id}_e);\n`);
  }
  const outputVars: Record<string, string> = { row: `${id}_row`, progress: `${id}_progress`, count: `${id}_count` };
  for (const o of outs) {
    L.push(`    ${VEC[o.columns.length]} ${id}_${o.key} = ${pickColumns(o.columns, where, t => `${id}_r${t}`)};\n`);
    outputVars[o.key] = `${id}_${o.key}`;
  }
  L.push(`    float ${id}_row = float(${id}_a) + ${interp === 'catmull' ? `${id}_u` : `${id}_e`};\n`);
  L.push(`    float ${id}_count = ${count};\n`);
  return { code: L.join(''), outputVars };
}

export const DataNode: NodeDefinition = {
  type: 'data',
  label: 'Data',
  category: 'Sources',
  description: 'Reads a dataset (a CSV, JSON or text file imported into the graph and shaped in a notebook). Values: Index picks a row and chosen columns come out as float or vec2/vec3/vec4. Points: a column group is a point cloud with a distance field. Keyframes: rows play back over time. Open the editor to import data, write the notebook and choose outputs.',
  aliases: ['Dataset', 'CSV', 'Table', 'Spreadsheet'],
  inputs: {
    index: { type: 'float', label: 'Index', hint: 'Which row: 0 is the first. A fraction blends two rows when Blend is on.' },
  },
  outputs: {
    count: { type: 'float', label: 'Rows' },
  },
  defaultParams: {
    dataset: '',
    mode: 'values',
    outputs: [],
    index: 0,
    blend: true,
    edge: 'wrap',
    rowColumns: [],
    glslName: '',
    pointColumns: [],
    shape: 'points',
    radiusFrom: 'slider',
    radius: 0.02,
    radiusColumn: '',
    smoothK: 0,
    maxPoints: DATA_DEFAULT_MAX_POINTS,
    timeColumn: '',
    duration: 4,
    interp: 'linear',
    smoothing: 0,
    ends: 'loop',
  },
  paramDefs: {
    index: { label: 'Index', type: 'float', min: 0, max: 100, step: 0.01, showWhen: { param: 'mode', value: 'values' }, hint: 'Which row: 0 is the first. Wrap starts over after the last row.' },
    blend: { label: 'Blend', type: 'bool', showWhen: { param: 'mode', value: 'values' }, hint: 'A fractional index fades between the two rows it falls between.' },
    edge: { label: 'Ends', type: 'select', showWhen: { param: 'mode', value: 'values' }, hint: 'Past the last row: Wrap starts over, Clamp holds the last row.', options: [
      { value: 'wrap', label: 'Wrap' },
      { value: 'clamp', label: 'Clamp' },
    ] },
    radius: { label: 'Radius', type: 'float', min: 0, max: 0.5, step: 0.001, showWhen: { param: 'mode', value: 'points' }, hint: 'Size of each point.' },
    smoothK: { label: 'Smooth', type: 'float', min: 0, max: 0.5, step: 0.001, showWhen: { param: 'mode', value: 'points' }, hint: 'Blends nearby points into one another (a smooth minimum). 0 keeps them separate.' },
    maxPoints: { label: 'Max points', type: 'float', min: 1, max: DATA_MAX_POINTS, step: 1, compileTime: true, showWhen: { param: 'mode', value: 'points' }, hint: `Rows read per pixel (up to ${DATA_MAX_POINTS}). Every pixel loops over them, so more costs more.` },
    duration: { label: 'Duration', type: 'float', min: 0.1, max: 60, step: 0.1, showWhen: { param: 'mode', value: 'keyframes' }, hint: 'Seconds from the first row to the last, when rows are evenly spaced (no time column).' },
    interp: { label: 'Interpolation', type: 'select', showWhen: { param: 'mode', value: 'keyframes' }, hint: 'How values move from one row to the next.', options: DATA_INTERPS.map(o => ({ value: o.value, label: o.label })) },
    smoothing: { label: 'Smoothing', type: 'float', min: 0, max: 1, step: 0.01, showWhen: { param: 'mode', value: 'keyframes' }, hint: 'Pulls each row toward the average of its neighbours, softening jumps.' },
    ends: { label: 'Ends', type: 'select', showWhen: { param: 'mode', value: 'keyframes' }, hint: 'After the last row: Loop starts over, Ping-pong plays back, Hold stays.', options: [
      { value: 'loop', label: 'Loop' },
      { value: 'pingpong', label: 'Ping-pong' },
      { value: 'hold', label: 'Hold' },
    ] },
  },
  glslFunctionsFor: helperFunctions,
  syncSockets: retypeDataNode,
  generateGLSL: (node, inputVars) => {
    const id = node.id;
    const ds = dataDataset(node);
    if (!ds) return zeroOutputs(node, id, inputVars);
    const mode = dataMode(node);
    if (mode === 'points') return pointsCode(node, id, ds, inputVars);
    if (mode === 'keyframes') return keyframesCode(node, id, ds, inputVars);
    return valuesCode(node, id, ds, inputVars);
  },
};
