/**
 * Data Texture and Read channels (docs/data-texture.md): store data in a texture and read it back
 * as typed values.
 *
 * Data Texture: up to four inputs you define (float, vec2, vec3 or vec4), each written into the
 * channels you pick (r, g, b, a: four in all), stored at the precision you pick (8-bit, half or full
 * 32-bit float), raw or remapped from a range. Its outputs read channels back at this pixel (or
 * wherever Read at says): one channel is a float, two a vec2, three a vec3, four a vec4, whichever
 * channels they are. Texture and Previous are the texture itself and it a frame ago.
 *
 * The compiler opens it (compiler/dataTextureExpand.ts) into
 *
 *   dataTexturePack (`<id>__pack`) ──▶ Pass with the node's own id ──▶ Texture / Previous
 *                                            └──▶ Read channels (`<id>__out<i>`) ──▶ each output's wires
 *
 * so the buffer is an ordinary Pass render target (kept, reset, exported like any Pass), and a read
 * of it that feeds the node itself reads it as it was a frame ago (a simulation: position += velocity).
 *
 * Read channels: the same read for any texture.
 */
import type { DataType, GraphNode, InputSocket, NodeDefinition, OutputSocket } from '../../types/nodeGraph';
import { p } from './helpers';
import { texUv } from './passes';
import { TEXTURE_TOOLS_CATEGORY } from './textureTools';

export const DATA_TEXTURE_TYPE = 'dataTexture';
export const DATA_PACK_TYPE = 'dataTexturePack';
export const READ_CHANNELS_TYPE = 'readChannels';

export type FieldType = 'float' | 'vec2' | 'vec3' | 'vec4';
export interface DataField { name: string; type: FieldType; channels: string }
export interface DataRead { name: string; channels: string }

export const CHANNELS = 'rgba';
export const MAX_FIELDS = 4;
export const FIELD_TYPES: readonly FieldType[] = ['float', 'vec2', 'vec3', 'vec4'];
export const WIDTH: Record<FieldType, number> = { float: 1, vec2: 2, vec3: 3, vec4: 4 };
export const typeForWidth = (n: number): FieldType => FIELD_TYPES[Math.max(1, Math.min(4, n)) - 1];

export const inKey = (i: number) => `in${i}`;
export const outKey = (i: number) => `out${i}`;

const sel = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  (typeof v === 'string' && (allowed as readonly string[]).includes(v) ? v : fallback) as T;

/** Only r g b a, each once, in the order given. */
const cleanChannels = (v: unknown): string => {
  const out: string[] = [];
  for (const ch of String(v ?? '').toLowerCase()) if (CHANNELS.includes(ch) && !out.includes(ch)) out.push(ch);
  return out.join('');
};

export const DEFAULT_FIELDS: DataField[] = [
  { name: 'position', type: 'vec2', channels: 'rg' },
  { name: 'value', type: 'vec2', channels: 'ba' },
];
export const DEFAULT_READS: DataRead[] = [
  { name: 'position', channels: 'rg' },
  { name: 'value', channels: 'ba' },
];

/**
 * The node's inputs, made sound: at most four, each a known type with exactly as many channels as
 * it is wide. Channels it doesn't name (or names twice) are filled from the free ones, so a field
 * always writes somewhere it can, and a later field never overwrites an earlier one.
 */
export function fieldsOf(n: Pick<GraphNode, 'params'>): DataField[] {
  const raw = Array.isArray(n.params.fields) ? (n.params.fields as Partial<DataField>[]) : DEFAULT_FIELDS;
  const used = new Set<string>();
  const out: DataField[] = [];
  for (const f of raw.slice(0, MAX_FIELDS)) {
    const type = sel(f?.type, FIELD_TYPES, 'float');
    const want = WIDTH[type];
    const ch = [...cleanChannels(f?.channels)].filter(c => !used.has(c)).slice(0, want);
    for (const c of CHANNELS) if (ch.length < want && !used.has(c) && !ch.includes(c)) ch.push(c);
    // No room left (the four channels are taken): the field is kept, with what fits.
    ch.forEach(c => used.add(c));
    out.push({ name: String(f?.name ?? '').trim() || `input ${out.length + 1}`, type, channels: ch.join('') });
  }
  return out;
}

/** Fields that couldn't get every channel they need (all four are taken before them). */
export function shortFields(n: Pick<GraphNode, 'params'>): string[] {
  return fieldsOf(n).filter(f => f.channels.length < WIDTH[f.type]).map(f => f.name);
}

/** The node's outputs: at most four, each one to four channels (a channel may repeat: .rr). */
export function readsOf(n: Pick<GraphNode, 'params'>): DataRead[] {
  const raw = Array.isArray(n.params.reads) ? (n.params.reads as Partial<DataRead>[]) : DEFAULT_READS;
  return raw.slice(0, MAX_FIELDS).map((r, i) => {
    const ch = [...String(r?.channels ?? '').toLowerCase()].filter(c => CHANNELS.includes(c)).slice(0, 4).join('') || 'r';
    return { name: String(r?.name ?? '').trim() || `output ${i + 1}`, channels: ch };
  });
}

/** Read channels' one pattern (one to four of r g b a). */
export const readPattern = (n: Pick<GraphNode, 'params'>): string =>
  [...String(n.params.channels ?? 'rg').toLowerCase()].filter(c => CHANNELS.includes(c)).slice(0, 4).join('') || 'r';

// ── Settings ────────────────────────────────────────────────────────────────

export const READ_MODES = ['exact', 'smooth'] as const;

const STORAGE_DEFS: NonNullable<NodeDefinition['paramDefs']> = {
  storage: { label: 'Values', type: 'select', section: 'Storage', hint: 'Raw: stored as they are (full or half float keep any number). Range: Min…Max is squeezed into 0…1 to be stored and stretched back when read, which 8-bit needs (it only keeps 0…1, in 256 steps).', options: [
    { value: 'raw', label: 'Raw' }, { value: 'range', label: 'Range (Min…Max)' },
  ] },
  rangeMin: { label: 'Min', type: 'float', min: -10, max: 10, step: 0.01, section: 'Storage', hint: 'The lowest value stored (Range).', showWhen: { param: 'storage', value: 'range' } },
  rangeMax: { label: 'Max', type: 'float', min: -10, max: 10, step: 0.01, section: 'Storage', hint: 'The highest value stored (Range).', showWhen: { param: 'storage', value: 'range' } },
};

const READ_DEF: NonNullable<NodeDefinition['paramDefs']>[string] = {
  label: 'Read', type: 'select', section: 'Storage', hint: 'Exact: one texel, never blended with its neighbours: what data needs (a blend of two positions is no position). Smooth: blended between texels, for pictures.', options: [
    { value: 'exact', label: 'Exact texel' }, { value: 'smooth', label: 'Smooth (blended)' },
  ],
};

const DATA_DEFAULTS = {
  fields: DEFAULT_FIELDS, reads: DEFAULT_READS,
  format: 'float', read: 'exact', wrap: 'clamp', scale: '1', storage: 'raw', rangeMin: -1, rangeMax: 1,
  // The card's preview (components/NodeGraph/DataTextureView.tsx): never in the shader.
  previewView: 'raw', previewMin: -1, previewMax: 1,
};

const DATA_PARAM_DEFS: NonNullable<NodeDefinition['paramDefs']> = {
  format: { label: 'Precision', type: 'select', section: 'Storage', hint: 'How exactly each value is kept. Full float: exact (positions, velocities). Half float: about 3 digits, enough for colours and glows. 8-bit: 256 steps of 0…1 (use Values: Range), the least memory.', options: [
    { value: 'float', label: 'Full float (32-bit)' }, { value: 'half', label: 'Half float (16-bit)' }, { value: 'byte', label: '8-bit' },
  ] },
  read: READ_DEF,
  ...STORAGE_DEFS,
  scale: { label: 'Size', type: 'select', section: 'Storage', hint: 'The texture\'s size relative to the picture: one texel per pixel at 1.', options: [
    { value: '1', label: '1 (full size)' }, { value: '0.5', label: '½' }, { value: '0.25', label: '¼' }, { value: '0.125', label: '⅛' },
    { value: '0.0625', label: '1/16' }, { value: '0.03125', label: '1/32' },
  ] },
  wrap: { label: 'Edges', type: 'select', section: 'Storage', hint: 'What a read past the edge sees: Clamp the edge texel, Repeat wraps round, Mirror folds back.', options: [
    { value: 'clamp', label: 'Clamp' }, { value: 'repeat', label: 'Repeat' }, { value: 'mirror', label: 'Mirror' },
  ] },
};

// ── Sockets ─────────────────────────────────────────────────────────────────

const AT: InputSocket = { type: 'vec2', label: 'Read at', hint: 'Where the outputs read the texture, in picture coordinates. Leave empty for this pixel.' };

export function dataTextureSockets(n: Pick<GraphNode, 'params'>): { inputs: Record<string, InputSocket>; outputs: Record<string, OutputSocket> } {
  const inputs: Record<string, InputSocket> = {};
  fieldsOf(n).forEach((f, i) => { inputs[inKey(i)] = { type: f.type as DataType, label: f.name, hint: `Written into ${f.channels.split('').join(', ')}.` }; });
  inputs.at = { ...AT };
  const outputs: Record<string, OutputSocket> = {};
  readsOf(n).forEach((r, i) => { outputs[outKey(i)] = { type: typeForWidth(r.channels.length) as DataType, label: r.name }; });
  outputs.texture = { type: 'texture', label: 'Texture', hint: 'The data as a texture: Read channels, Sample (texture), or any texture node.' };
  outputs.previous = { type: 'texture', label: 'Previous', hint: 'The texture as it was a frame ago (for a simulation that reads its own last state).' };
  return { inputs, outputs };
}

/** A Data Texture card's sockets follow its fields and reads; a wire whose type no longer fits is dropped. */
export function retypeDataTexture(n: GraphNode): GraphNode {
  if (n.type === READ_CHANNELS_TYPE) {
    const t = typeForWidth(readPattern(n).length) as DataType;
    if (n.outputs.value?.type === t) return n;
    return { ...n, outputs: { ...n.outputs, value: { ...(n.outputs.value ?? { label: 'Value' }), type: t } } };
  }
  if (n.type !== DATA_TEXTURE_TYPE) return n;
  const { inputs, outputs } = dataTextureSockets(n);
  const nextIn: Record<string, InputSocket> = {};
  for (const [k, s] of Object.entries(inputs)) {
    const old = n.inputs[k];
    nextIn[k] = { ...s, ...(old?.connection && old.type === s.type ? { connection: old.connection } : {}) };
  }
  return { ...n, inputs: nextIn, outputs };
}

// ── GLSL ────────────────────────────────────────────────────────────────────

const rangeOf = (P: Record<string, unknown>) => ({ lo: p(P.rangeMin, -1), hi: p(P.rangeMax, 1) });

/** The texel read: Exact (texelFetch, clamped to the texture) or Smooth (filtered), with the range undone. */
export function readCode(id: string, tex: string | undefined, uv: string | undefined, P: Record<string, unknown>, pattern: string): { code: string; value: string; type: FieldType } {
  const type = typeForWidth(pattern.length);
  if (!tex) return { code: `    ${type} ${id}_v = ${type}(0.0);\n`, value: `${id}_v`, type };
  const st = `${id}_st`;
  let code = `    vec2 ${st} = ${texUv(uv ?? 'g_uv')};\n`;
  if (sel(P.read, READ_MODES, 'exact') === 'exact') {
    code += `    ivec2 ${id}_sz = textureSize(${tex}, 0);\n`
      + `    vec4 ${id}_s = texelFetch(${tex}, clamp(ivec2(floor(${st} * vec2(${id}_sz))), ivec2(0), ${id}_sz - 1), 0);\n`;
  } else {
    code += `    vec4 ${id}_s = texture2D(${tex}, ${st});\n`;
  }
  if (P.storage === 'range') {
    const { lo, hi } = rangeOf(P);
    code += `    ${id}_s = ${id}_s * (${hi} - ${lo}) + ${lo};\n`;
  }
  code += `    ${type} ${id}_v = ${id}_s.${pattern};\n`;
  return { code, value: `${id}_v`, type };
}

/** What the pack writes: every field into its channels (0 where nothing is wired), remapped for Range. */
export function packCode(node: GraphNode, inputVars: Record<string, string>): { code: string; outputVars: Record<string, string> } {
  const id = node.id;
  const fields = fieldsOf(node);
  let code = `    vec4 ${id}_d = vec4(0.0);\n`;
  fields.forEach((f, i) => {
    const v = inputVars[inKey(i)];
    if (!v || !f.channels) return;
    const n = f.channels.length;
    // A field cut short (no channels left) writes the part of it that fits.
    const src = n === WIDTH[f.type] ? `(${v})` : `(${v}).${'xyzw'.slice(0, n)}`;
    code += `    ${id}_d.${f.channels} = ${src};\n`;
  });
  if (node.params.storage === 'range') {
    const { lo, hi } = rangeOf(node.params);
    code += `    ${id}_d = (${id}_d - ${lo}) / max(${hi} - ${lo}, 1e-6);\n`;
  }
  // Alpha unused: kept 1, so the texture shows on its card.
  if (!fields.some(f => f.channels.includes('a'))) code += `    ${id}_d.a = 1.0;\n`;
  return { code, outputVars: { color: `${id}_d.rgb`, alpha: `${id}_d.a` } };
}

// ── Nodes ───────────────────────────────────────────────────────────────────

const defaultSockets = dataTextureSockets({ params: DATA_DEFAULTS });

export const DataTextureNode: NodeDefinition = {
  type: DATA_TEXTURE_TYPE,
  label: 'Data Texture',
  category: TEXTURE_TOOLS_CATEGORY,
  aliases: ['Render target', 'Data buffer', 'Float texture', 'Position texture', 'Store data', 'Write texture', 'GPGPU', 'State texture'],
  description: 'Stores data in a texture of its own and reads it back as typed values. Define up to four inputs (float, vec2, vec3, vec4), pick the channels each writes (r g b a), the precision (full float keeps positions exact) and whether reads are exact or blended. Each output reads the channels you pick: one is a float, two a vec2, three a vec3, four a vec4. A read that feeds the node itself sees last frame, so it can run a simulation.',
  // No fixed inputs: a node's sockets come from its fields (dataTextureSockets, retypeDataTexture), as an
  // Expression Block's do, so loading a saved graph never adds the default fields back.
  inputs: {},
  outputs: defaultSockets.outputs,
  defaultParams: DATA_DEFAULTS,
  paramDefs: DATA_PARAM_DEFS,
  assignable: false,
  // Compiled only when the compiler hasn't opened it (compiler/dataTextureExpand.ts always does in a
  // graph): every output 0, as nothing is stored.
  generateGLSL: (node: GraphNode) => {
    const id = node.id;
    let code = '';
    const outputVars: Record<string, string> = {};
    readsOf(node).forEach((r, i) => {
      const t = typeForWidth(r.channels.length);
      code += `    ${t} ${id}_o${i} = ${t}(0.0);\n`;
      outputVars[outKey(i)] = `${id}_o${i}`;
    });
    return { code, outputVars };
  },
};

/** What a Data Texture writes into its Pass: made by the compiler (compiler/dataTextureExpand.ts), never in a graph. */
export const DataTexturePackNode: NodeDefinition = {
  type: DATA_PACK_TYPE,
  label: 'Data Texture pack',
  category: 'Output',
  description: 'Internal: a Data Texture\'s inputs packed into the four channels of its texture.',
  inputs: {},
  outputs: { color: { type: 'vec3', label: 'Color' }, alpha: { type: 'float', label: 'Alpha' } },
  defaultParams: DATA_DEFAULTS,
  assignable: false,
  generateGLSL: (node: GraphNode, inputVars) => packCode(node, inputVars),
};

export const ReadChannelsNode: NodeDefinition = {
  type: READ_CHANNELS_TYPE,
  label: 'Read channels (texture)',
  category: TEXTURE_TOOLS_CATEGORY,
  aliases: ['Read channels', 'Texture channels', 'Read data', 'Unpack', 'Channels', 'texelFetch'],
  description: 'Reads channels of any texture as a typed value: pick one to four of r g b a, and the output is a float, vec2, vec3 or vec4 to match, whichever channels they are (.rb is a vec2). Exact reads one texel, never blended, for data such as positions; Smooth blends, for pictures.',
  inputs: {
    texture: { type: 'texture', label: 'Texture', hint: 'Any texture: a Data Texture, a Pass, a picture, a video.' },
    uv: { type: 'vec2', label: 'UV', hint: 'Where to read, in picture coordinates. Leave empty for this pixel.' },
  },
  outputs: { value: { type: 'vec2', label: 'Value' } },
  defaultParams: { channels: 'rg', read: 'exact', storage: 'raw', rangeMin: -1, rangeMax: 1 },
  paramDefs: {
    channels: { label: 'Channels', type: 'string', hint: 'One to four of r g b a, in the order you want them: rg, b, rgb, ar… The output is as wide as this.' },
    read: READ_DEF,
    ...STORAGE_DEFS,
  },
  assignable: false,
  generateGLSL: (node: GraphNode, inputVars) => {
    const r = readCode(node.id, inputVars.texture, inputVars.uv, node.params, readPattern(node));
    return { code: r.code, outputVars: { value: r.value } };
  },
};
