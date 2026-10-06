/**
 * lookGraph.ts — Look (Finish) effects made of Studio nodes.
 *
 * Two ways in, one result:
 *
 *  - **Node effects**: any node definition that takes a colour and gives a
 *    colour (Hue Rotate, Posterize, Vignette, Tone Map…) is offered under
 *    + Add effect → Nodes. It becomes a one-node graph: the picture's colour
 *    into its colour input, its colour output out.
 *  - **Built effects**: a small graph made in the Look effect editor, with an
 *    inputs node (Picture colour, UV, Centred UV, Time), any number of nodes,
 *    "Picture at" (the picture read at another point) and one Colour output.
 *
 * Either way the graph goes through the Studio's own compiler (the same
 * generateGLSL of every node) and the fragment shader it makes is rewritten
 * into Finish effect code (`vec3 effect(vec2 uv, vec3 color)` plus a
 * `uniform` line per node setting, play/kit/finish.js fnParseCustom). That
 * code is all the renderer, exported websites and offline renders ever see;
 * the graph is kept beside it (FinishEffect.graph) only to edit it again.
 *
 * See docs/finish-stack.md "Effects from nodes".
 */
import type { DataType, GraphNode, NodeDefinition, ParamDef } from '../types/nodeGraph';
import { getNodeDefinition, getNodeDefinitionFor, getOfferedDefinitions } from '../nodes/definitions';
import { instantiateNode } from '../nodes/scene3dDefaults';
import { topologicalSort } from '../compiler/topoSort';
import { generateFragmentShader, pruneUnusedGlslFunctions } from '../compiler/shaderAssembler';
import { coerce, typesCompatible } from '../lib/typesCompatible';
import { paramSliderRange } from '../nodes/sliderRange';
import { getUserNodesVersion, isSealedUserNode } from '../nodes/userNodes/userNodeRegistry';
import { FN_CUSTOM_RESERVED } from './kit/finish.js';
import {
  EFFECT_GRAPH_MAX_NODES, FX_IN_ID, FX_IN_TYPE, FX_OUT_ID, FX_OUT_TYPE, FX_PICTURE_AT_TYPE,
  type EffectGraph, type EffectGraphNode,
} from './lookGraphRecord';
import { newCustomEffect, type FinishEffect } from '../types/playFinish';

export { FX_IN_ID, FX_IN_TYPE, FX_OUT_ID, FX_OUT_TYPE, FX_PICTURE_AT_TYPE };
export type { EffectGraph, EffectGraphNode };

// ── The editor's own nodes ─────────────────────────────────────────────────

interface IoSocket { type: DataType; label: string; hint: string }

/** What the inputs node gives, and the GLSL each is in the effect function. */
export const FX_IN_OUTPUTS: Record<'color' | 'uv' | 'centered' | 'time', IoSocket & { expr: string }> = {
  color: { type: 'vec3', label: 'Picture colour', hint: 'The picture’s colour at this point, after the effects above this one in the stack.', expr: 'fxColor' },
  uv: { type: 'vec2', label: 'UV (0–1)', hint: 'Where this point is on the picture: 0,0 bottom left to 1,1 top right.', expr: 'vUv' },
  centered: { type: 'vec2', label: 'Centred UV', hint: 'The Studio’s coordinates: 0,0 in the middle, −1..1 up and down, wider across. What a node’s UV uses when nothing is wired.', expr: 'g_uv' },
  time: { type: 'float', label: 'Time', hint: 'The clock, in seconds.', expr: 'u_time' },
};
export const FX_OUT_INPUT: IoSocket = { type: 'vec3', label: 'Colour', hint: 'The effect’s colour at this point. Unwired, the picture passes through.' };
export const FX_PICTURE_AT: { inputs: Record<'uv', IoSocket>; outputs: Record<'color', IoSocket> } = {
  inputs: { uv: { type: 'vec2', label: 'UV (0–1)', hint: 'Where to read, 0..1 (unwired: this point).' } },
  outputs: { color: { type: 'vec3', label: 'Colour', hint: 'The picture as it came into the stack, at that point (a neighbour’s colour doesn’t include the effects above).' } },
};

/** The sockets of any node in an effect graph: the editor's own, or a node definition's. */
export function effectNodeSockets(n: Pick<EffectGraphNode, 'type'>): { label: string; inputs: Record<string, { type: DataType; label: string; hint?: string }>; outputs: Record<string, { type: DataType; label: string; hint?: string }> } | null {
  if (n.type === FX_IN_TYPE) return { label: 'Effect inputs', inputs: {}, outputs: FX_IN_OUTPUTS };
  if (n.type === FX_OUT_TYPE) return { label: 'Effect output', inputs: { color: FX_OUT_INPUT }, outputs: {} };
  if (n.type === FX_PICTURE_AT_TYPE) return { label: 'Picture at', ...FX_PICTURE_AT };
  const def = getNodeDefinition(n.type);
  return def ? { label: def.label, inputs: def.inputs, outputs: def.outputs } : null;
}

// ── Which nodes can be in an effect ─────────────────────────────────────────

/** Types a Finish pass has no way to give a node (each with why). */
const NO_TYPES: Partial<Record<DataType, string>> = {
  scene3d: 'it takes a 3D scene',
  spacewarp3d: 'it takes a 3D space warp',
  texture: 'it samples a Pass node’s texture',
  volume: 'it reads a Time Cube’s frames',
};
/** Categories that need something a Finish pass hasn't got. */
const NO_CATEGORIES: Array<[RegExp, string]> = [
  [/^3D/, 'it works on a 3D scene (a ray’s hit, depth or normal)'],
  [/^Particles$/, 'it runs its own particle simulation'],
  [/^Passes$/, 'it renders to or reads a texture of its own'],
  [/^Output$/, 'it is an output'],
  [/^Loops$|^Utility$|^Functions$/, 'it needs the Studio’s graph around it (loops, groups, code nodes)'],
];
/** Single types that read something outside the shader (inputs, textures, other frames). */
const NO_NODE_TYPES: Record<string, string> = {
  mouse: 'it reads the mouse (map a Look setting to the mouse instead)',
  textureInput: 'it reads an image the Studio loads',
  videoInput: 'it reads a video the Studio plays',
  baked: 'it plays a baked video the Studio keeps',
  audioInput: 'it listens to audio in the Studio (map a Look setting to an audio reader instead)',
  midiInput: 'it reads MIDI in the Studio (map a Look setting to MIDI instead)',
  data: 'it reads a dataset',
  playLayers: 'it reads the Play layers (the picture already has them)',
  padGrid: 'it reads the drum pads',
  prevFrame: 'it reads the frame before (use Feedback or Echo in the stack)',
  echo: 'it keeps frames of its own (use Echo in the stack)',
  loopIndex: 'it only means something inside a loop',
  fieldCell: 'it only means something inside a grid’s shape',
  constants: 'its settings are made per card in the Studio',
  scope: 'it only shows a probe in the Studio',
};

/** Why a node can't be in an effect graph, or '' when it can. Decided from what it declares. */
export function effectNodeProblem(def: NodeDefinition): string {
  if (def.deprecated) return 'it is retired';
  if (NO_NODE_TYPES[def.type]) return NO_NODE_TYPES[def.type];
  for (const [re, why] of NO_CATEGORIES) if (re.test(def.category)) return why;
  if (def.textureSlots?.length || def.declarationsFor) return 'it needs a texture or an engine outside the shader';
  if (isSealedUserNode(def.type)) return 'it is sealed (its code can’t go into an effect’s code)';
  for (const s of [...Object.values(def.inputs), ...Object.values(def.outputs)]) {
    const why = NO_TYPES[s.type];
    if (why) return why;
  }
  if (Object.values(def.inputs).some(s => s.field)) return 'it takes a shape or picture as a function (a field socket)';
  return '';
}

const COLOUR_LABEL = /^(rgb )?colou?r( in)?$|^base( colou?r)?$|^bottom colou?r$/i;
const COLOUR_KEY = /^(color|colour|col|rgb|base|bottom)$/i;
const isColourType = (t: DataType) => t === 'vec3' || t === 'vec4';

/** A node's picture-colour input and colour output, when it has both. */
export function colourSockets(def: Pick<NodeDefinition, 'inputs' | 'outputs'>): { input: string; output: string } | null {
  const ins = Object.entries(def.inputs).filter(([, s]) => isColourType(s.type) && !s.field);
  const input = (ins.find(([k]) => COLOUR_KEY.test(k)) ?? ins.find(([, s]) => COLOUR_LABEL.test(s.label.trim())))?.[0];
  const outs = Object.entries(def.outputs).filter(([, s]) => isColourType(s.type));
  const output = (outs.find(([k]) => /^(color|colour|result|rgb)$/i.test(k)) ?? outs.find(([, s]) => /colou?r|result/i.test(s.label)))?.[0];
  return input && output ? { input, output } : null;
}

/** Why a node can't be a Look effect on its own (+ Add effect → Nodes), or '' when it can. */
export function nodeEffectProblem(def: NodeDefinition): string {
  const p = effectNodeProblem(def);
  if (p) return p;
  if (!colourSockets(def)) return 'it doesn’t take a colour and give a colour';
  return compileEffectGraph(nodeEffectGraph(def.type)).error;
}

let nodeEffectsMemo: { version: number; list: NodeDefinition[] } | null = null;
/** Every node that can be added as a Look effect, by category then name. */
export function nodeEffectDefs(): NodeDefinition[] {
  const version = getUserNodesVersion();
  if (nodeEffectsMemo?.version === version) return nodeEffectsMemo.list;
  const list = getOfferedDefinitions().filter(d => !nodeEffectProblem(d)).sort((a, b) => a.category.localeCompare(b.category) || a.label.localeCompare(b.label));
  nodeEffectsMemo = { version, list };
  return list;
}

/** Every node the effect editor's node list offers, by category then name. */
export function effectPaletteDefs(): NodeDefinition[] {
  return getOfferedDefinitions().filter(d => !effectNodeProblem(d)).sort((a, b) => a.category.localeCompare(b.category) || a.label.localeCompare(b.label));
}

// ── Graphs ───────────────────────────────────────────────────────────────────

/** An empty effect: the picture straight through. */
export function emptyEffectGraph(): EffectGraph {
  return { v: 1, nodes: [{ id: FX_OUT_ID, type: FX_OUT_TYPE, x: 520, y: 40, wires: { color: [FX_IN_ID, 'color'] } }] };
}

/** One node as an effect: the picture's colour into its colour input (and the 0..1 UV into a "UV (0-1)" input), its colour out. */
export function nodeEffectGraph(type: string): EffectGraph {
  const def = getNodeDefinition(type);
  const cs = def ? colourSockets(def) : null;
  const wires: Record<string, [string, string]> = {};
  if (def && cs) {
    wires[cs.input] = [FX_IN_ID, 'color'];
    for (const [k, s] of Object.entries(def.inputs)) if (s.type === 'vec2' && /0\s*[-–]\s*1/.test(s.label)) wires[k] = [FX_IN_ID, 'uv'];
  }
  return {
    v: 1, node: type,
    nodes: [
      { id: 'n1', type, x: 250, y: 40, wires },
      { id: FX_OUT_ID, type: FX_OUT_TYPE, x: 560, y: 40, ...(cs ? { wires: { color: ['n1', cs.output] as [string, string] } } : {}) },
    ],
  };
}

/** A fresh id for a node in this graph. */
export function nextEffectNodeId(graph: EffectGraph): string {
  let i = graph.nodes.length + 1;
  while (graph.nodes.some(n => n.id === `n${i}`)) i++;
  return `n${i}`;
}

/** A node of `type` at its defaults, to add to a graph. */
export function newEffectGraphNode(graph: EffectGraph, type: string, x: number, y: number): EffectGraphNode {
  const def = getNodeDefinition(type);
  const params = def?.defaultParams ? JSON.parse(JSON.stringify(def.defaultParams)) as Record<string, unknown> : undefined;
  return { id: nextEffectNodeId(graph), type, x: Math.round(x), y: Math.round(y), ...(params && Object.keys(params).length ? { params } : {}) };
}

/** Can a wire go from this output to this input? */
export function canWire(fromType: DataType, toType: DataType, toNodeType: string): boolean {
  if (toNodeType === FX_OUT_TYPE) return fromType === 'vec3' || fromType === 'vec4' || fromType === 'float';
  return typesCompatible(fromType, toType);
}

// ── Compiling ────────────────────────────────────────────────────────────────

/** A setting of the compiled effect, and the node param it came from. */
export interface EffectBinding { nodeId: string; param: string; colour: boolean }

export interface EffectGraphCompile {
  /** Finish effect code ('' on error). */
  code: string;
  error: string;
  /** Setting name in the code → the node param it stands for. */
  bind: Record<string, EffectBinding>;
}

const GLSL_WORDS = new Set(`attribute const uniform varying layout centroid flat smooth break continue do for while switch case default if else in out inout float int void bool true false invariant discard return mat2 mat3 mat4 mat2x2 mat2x3 mat2x4 mat3x2 mat3x3 mat3x4 mat4x2 mat4x3 mat4x4 vec2 vec3 vec4 ivec2 ivec3 ivec4 bvec2 bvec3 bvec4 uint uvec2 uvec3 uvec4 lowp mediump highp precision sampler2D sampler3D samplerCube sampler2DShadow sampler2DArray struct sample texture input output filter image common partition active asm class union enum typedef template this goto inline noinline volatile public static extern external interface long short double half fixed unsigned superp namespace using
radians degrees sin cos tan asin acos atan sinh cosh tanh asinh acosh atanh pow exp log exp2 log2 sqrt inversesqrt abs sign floor trunc round roundEven ceil fract mod modf min max clamp mix step smoothstep isnan isinf floatBitsToInt floatBitsToUint intBitsToFloat uintBitsToFloat packSnorm2x16 unpackSnorm2x16 packUnorm2x16 unpackUnorm2x16 packHalf2x16 unpackHalf2x16 length distance dot cross normalize faceforward reflect refract matrixCompMult outerProduct transpose determinant inverse lessThan lessThanEqual greaterThan greaterThanEqual equal notEqual any all not textureSize textureLod textureOffset texelFetch textureProj textureGrad dFdx dFdy fwidth main`.split(/\s+/));

/** The identifiers a piece of GLSL uses. */
const identifiers = (text: string): Set<string> => new Set(text.replace(/\/\/.*$/gm, '').match(/\b[A-Za-z_]\w*\b/g) ?? []);

/** A readable, safe setting name for a node param: its key, or the node's name and its key when that's taken. */
function settingName(key: string, nodeType: string, taken: Set<string>): string {
  const clean = (s: string) => s.replace(/[^A-Za-z0-9_]/g, '_').replace(/_{2,}/g, '_').replace(/^_+|_+$/g, '') || 'value';
  const ok = (n: string) => /^[A-Za-z]/.test(n) && !taken.has(n) && !GLSL_WORDS.has(n) && !FN_CUSTOM_RESERVED.includes(n) && !/^(fn|FN_|U_|u[A-Z]|gl_|u_|fx[A-Z]|kf_)/.test(n) && !/^(g_uv|vUv)$/.test(n);
  const base = clean(key);
  if (ok(base)) return base;
  const prefixed = clean(`${nodeType.replace(/[^A-Za-z0-9]/g, '')}_${key}`);
  if (ok(prefixed)) return prefixed;
  for (let i = 2; ; i++) if (ok(`${prefixed}${i}`)) return `${prefixed}${i}`;
}

/** A number as a comment's range writes it: always with a point, so a range of whole numbers isn't read as an integer slider. */
function num(v: number): string {
  if (!Number.isFinite(v)) return '0.0';
  const s = String(Math.round(v * 1e6) / 1e6);
  return /[.eE]/.test(s) ? s : `${s}.0`;
}
const hex = (rgb: number[]) => '#' + rgb.slice(0, 3).map(c => Math.round(Math.max(0, Math.min(1, c)) * 255).toString(16).padStart(2, '0')).join('');
const oneLine = (s: string) => s.replace(/\s+/g, ' ').replace(/\|/g, '/').trim();

/** The graph as the Studio compiler wants it: GraphNodes, the inputs node as pre-resolved outputs. */
function toCompileNodes(graph: EffectGraph): { nodes: GraphNode[]; seeds: Map<string, Record<string, string>>; error: string } {
  const nodes: GraphNode[] = [];
  const seed: Record<string, string> = {};
  const byId = new Map<string, GraphNode>();
  const outType = new Map<string, Record<string, DataType>>();
  const errors: string[] = [];
  const real = graph.nodes.filter(n => n.type !== FX_IN_TYPE);
  if (real.length > EFFECT_GRAPH_MAX_NODES) errors.push(`At most ${EFFECT_GRAPH_MAX_NODES} nodes.`);
  for (const n of real) {
    let gn: GraphNode;
    if (n.type === FX_OUT_TYPE) {
      gn = instantiateNode(n.id, 'output', getNodeDefinition('output')!, { x: n.x, y: n.y });
    } else if (n.type === FX_PICTURE_AT_TYPE) {
      gn = instantiateNode(n.id, 'customFn', getNodeDefinition('customFn')!, { x: n.x, y: n.y }, {
        inputs: [{ name: 'uv', type: 'vec2', slider: null }], outputType: 'vec3', body: 'picture(uv)',
      });
      gn.inputs = { uv: { type: 'vec2', label: 'UV' } };
      gn.outputs = { result: { type: 'vec3', label: 'Colour' } };
    } else {
      const def = getNodeDefinition(n.type);
      if (!def) { errors.push(`“${n.type}” isn’t a node this app knows.`); continue; }
      const problem = effectNodeProblem(def);
      if (problem) { errors.push(`${def.label} can’t be in an effect: ${problem}.`); continue; }
      gn = instantiateNode(n.id, n.type, def, { x: n.x, y: n.y }, n.params ? JSON.parse(JSON.stringify(n.params)) : undefined);
    }
    nodes.push(gn);
    byId.set(n.id, gn);
    const sockets = effectNodeSockets(n);
    outType.set(n.id, Object.fromEntries(Object.entries(sockets?.outputs ?? {}).map(([k, s]) => [k, s.type])));
  }
  // Wires. From the inputs node: a pre-resolved output per (socket, type it lands in), so promotions work as on any wire.
  for (const n of real) {
    const gn = byId.get(n.id);
    if (!gn) continue;
    const wires = { ...(n.wires ?? {}) };
    if (n.type === FX_OUT_TYPE && !wires.color) wires.color = [FX_IN_ID, 'color'];
    if (n.type === FX_PICTURE_AT_TYPE && !wires.uv) wires.uv = [FX_IN_ID, 'uv'];
    for (const [key, [src, outKey]] of Object.entries(wires)) {
      const socket = gn.inputs[key];
      if (!socket) continue; // a socket the node doesn't have any more
      const from = src === FX_IN_ID ? FX_IN_OUTPUTS[outKey as keyof typeof FX_IN_OUTPUTS]?.type : outType.get(src)?.[outKey];
      if (!from) continue;
      let to = socket.type as DataType;
      if (n.type === FX_OUT_TYPE) {
        // The output takes a vec3; a vec4 goes to an RGBA output, a float is grey.
        if (from === 'vec4') { gn.type = 'vec4Output'; gn.inputs = { color: { type: 'vec4', label: 'Color' } }; to = 'vec4'; }
      }
      if (!typesCompatible(from, to)) { errors.push(`A ${from} can’t go into ${effectNodeSockets(n)?.label ?? n.type}’s ${socket.label} (a ${to}).`); continue; }
      if (src === FX_IN_ID) {
        const seedKey = `${outKey}_${to}`;
        seed[seedKey] = coerce(FX_IN_OUTPUTS[outKey as keyof typeof FX_IN_OUTPUTS].expr, from, to) ?? FX_IN_OUTPUTS[outKey as keyof typeof FX_IN_OUTPUTS].expr;
        gn.inputs[key] = { ...gn.inputs[key], connection: { nodeId: FX_IN_ID, outputKey: seedKey } };
      } else {
        if (!byId.has(src)) continue;
        const srcNode = graph.nodes.find(m => m.id === src);
        gn.inputs[key] = { ...gn.inputs[key], connection: { nodeId: src, outputKey: srcNode?.type === FX_PICTURE_AT_TYPE ? 'result' : outKey } };
      }
    }
  }
  return { nodes, seeds: new Map([[FX_IN_ID, seed]]), error: errors.join('\n') };
}

const CODE_HEAD = '// Built from nodes in the Look effect editor (Edit nodes… opens it).\n// Made from the graph: edit the graph, not this code.\n';

/**
 * Compile an effect graph into Finish effect code. Each live node setting
 * (a float slider, a colour) becomes a `uniform` line with its node's range,
 * value, label and hint, so it is a slider and a control target of the effect.
 */
export function compileEffectGraph(graph: EffectGraph): EffectGraphCompile {
  const fail = (error: string): EffectGraphCompile => ({ code: '', error, bind: {} });
  const { nodes, seeds, error } = toCompileNodes(graph);
  if (error) return fail(error);
  let fs: string, paramUniforms: Record<string, number | number[]>, paramBindings: Record<string, string>;
  try {
    const sorted = topologicalSort(nodes);
    ({ fragmentShader: fs, paramUniforms, paramBindings } = generateFragmentShader(sorted, nodes, { seedOutputs: seeds }));
  } catch (e) {
    return fail(e instanceof Error ? e.message.replace(/^Node \S+: /, '') : 'The graph doesn’t compile.');
  }
  const mainAt = fs.lastIndexOf('void main() {');
  if (mainAt < 0) return fail('The graph doesn’t compile.');
  let body = fs.slice(mainAt + 'void main() {'.length, fs.lastIndexOf('}'));
  // The header: helpers and constants stay; declarations the pass makes its own way go.
  const defines: string[] = [];
  let head = fs.slice(0, mainAt).split('\n').filter(line => {
    if (/^\s*(precision|varying)\b/.test(line)) return false;
    if (/^\s*uniform\b[^;]*;\s*$/.test(line)) return false;
    const d = /^\s*#define\s+(PI|TAU)\s+(\S+)\s*$/.exec(line);
    if (d) { defines.push(`const float ${d[1]} = ${d[2]};`); return false; }
    return true;
  }).join('\n');
  head = pruneUnusedGlslFunctions([head], body).join('\n');
  head = defines.filter(d => new RegExp(`\\b${d.split(' ')[2]}\\b`).test(head + body)).join('\n') + '\n' + head;
  head = head.replace(/\/\/ ── Always-available helpers[^\n]*\n|\/\/ ─+\n/g, '').replace(/\n{3,}/g, '\n\n').trim();

  // The node settings: renamed to readable names, declared with their ranges.
  const all = head + '\n' + body;
  const taken = identifiers(all);
  const byUniform = new Map<string, { nodeId: string; param: string }>();
  for (const [k, u] of Object.entries(paramBindings)) { const i = k.lastIndexOf('::'); byUniform.set(u, { nodeId: k.slice(0, i), param: k.slice(i + 2) }); }
  const realCount = graph.nodes.filter(n => n.type !== FX_OUT_TYPE && n.type !== FX_IN_TYPE && n.type !== FX_PICTURE_AT_TYPE).length;
  const decls: string[] = [];
  const bind: Record<string, EffectBinding> = {};
  const renames: Array<[string, string]> = [];
  let numbers = 0;
  for (const [u, value] of Object.entries(paramUniforms)) {
    if (!new RegExp(`\\b${u}\\b`).test(all)) continue; // declared but never read (a wired socket's slider)
    const b = byUniform.get(u);
    const node = b ? nodes.find(n => n.id === b.nodeId) : undefined;
    const def = node ? getNodeDefinitionFor(node) : undefined;
    const pd: ParamDef | undefined = b ? def?.paramDefs?.[b.param] : undefined;
    if (!b || !node || !def || !pd) return fail('A node setting couldn’t be read.');
    const name = settingName(b.param, node.type, taken);
    taken.add(name);
    renames.push([u, name]);
    const label = oneLine(realCount > 1 ? `${pd.label} · ${def.label}` : pd.label);
    const hint = oneLine(pd.hint ?? '');
    if (Array.isArray(value)) {
      if (pd.type === 'vec3color') {
        decls.push(`uniform vec3 ${name}; // color = ${hex(value)} ${label}${hint ? ` | ${hint}` : ''}`);
        bind[name] = { ...b, colour: true };
        numbers += 3;
      } else {
        // A position or direction, not a colour: kept as it is set on the node.
        decls.push(`const vec3 ${name} = vec3(${value.slice(0, 3).map(num).join(', ')});`);
      }
      continue;
    }
    const { min, max } = paramSliderRange(node.params, b.param, pd);
    const lo = Math.min(min, value), hi = Math.max(max, value);
    const step = typeof pd.step === 'number' && pd.step > 0 ? ` step ${num(pd.step)}` : '';
    decls.push(`uniform float ${name}; // ${num(lo)}..${num(hi === lo ? lo + 1 : hi)} = ${num(value)}${step} ${label}${hint ? ` | ${hint}` : ''}`);
    bind[name] = { ...b, colour: false };
    numbers += 1;
  }
  if (numbers > 32) return fail(`The nodes have ${numbers} settings; an effect can have at most 32 numbers (a colour is three).`);
  const rename = (text: string) => {
    let t = text;
    for (const [u, n] of renames) t = t.replace(new RegExp(`\\b${u}\\b`, 'g'), n);
    return t.replace(/\bu_time\b/g, 'time').replace(/\bu_resolution\b/g, 'resolution').replace(/\bgl_FragColor\b/g, 'fxOut');
  };
  head = rename(head);
  body = rename(body);
  // The Studio's blurs and glows read the frame drawn before (u_prevFrame) as the picture around a
  // point; in the Look stack the picture itself is there to read, so they read that.
  const prevRe = /\btexture2D\(\s*u_prevFrame\s*,/g;
  if (prevRe.test(head + body)) {
    head = 'vec4 fxPrev(vec2 q) { return vec4(picture(q), 1.0); }\n' + head.replace(prevRe, 'fxPrev(');
    body = body.replace(prevRe, 'fxPrev(');
  }

  // What a Finish pass can't give: say which.
  const rest = head + '\n' + body;
  const left = [...new Set(rest.match(/\bu_[A-Za-z]\w*/g) ?? [])];
  if (left.length) {
    if (left.includes('u_mouse')) return fail('A node reads the mouse, which a Look effect can’t (map one of its settings to the mouse instead).');
    if (left.some(u => /^u_(audio|midi)/.test(u))) return fail('A node reads audio or MIDI, which a Look effect can’t (map one of its settings to it instead).');
    if (left.some(u => /^u_(tex|vid|fontTexture|prevFrame|echo)/.test(u))) return fail('A node reads a texture or an earlier frame, which a Look effect can’t (Picture at reads the picture).');
    return fail(`A node reads ${left.join(', ')}, which a Look effect can’t give it.`);
  }
  if (/\b(texture2D|sampler2D|samplerCube)\b/.test(rest)) return fail('A node reads a texture, which a Look effect can’t.');
  if (/\bvUv\b/.test(head)) return fail('A node’s helper reads the picture position directly, which a Look effect can’t.');
  const undefs = [...head.matchAll(/^\s*#define\s+([A-Za-z_]\w*)/gm)].map(m => `#undef ${m[1]}`);

  const code = `${CODE_HEAD}${decls.length ? decls.join('\n') + '\n' : ''}\n${head ? head + '\n\n' : ''}vec3 effect(vec2 vUv, vec3 fxColor) {\n  vec4 fxOut = vec4(fxColor, 1.0);\n${body.replace(/\s+$/, '')}\n  return fxOut.rgb;\n}\n${undefs.length ? undefs.join('\n') + '\n' : ''}`;
  if (code.length > 60000) return fail('The compiled effect is too long (over 60,000 characters).');
  return { code, error: '', bind };
}

// ── Effects ──────────────────────────────────────────────────────────────────

/** A name for an effect made from a graph: its node's name for a node effect, else what it's called. */
export function effectGraphName(graph: EffectGraph, fallback = 'Node effect'): string {
  if (graph.node) return getNodeDefinition(graph.node)?.label ?? fallback;
  return fallback;
}

/**
 * The effect a graph makes: code compiled from it, its settings at the
 * nodes' values. With `prev` (the effect being edited), its id, on/off,
 * name, saved-effect link and Where stay.
 */
export function effectFromGraph(graph: EffectGraph, opts: { name?: string; prev?: FinishEffect; id?: string } = {}): { effect: FinishEffect | null; error: string } {
  const r = compileEffectGraph(graph);
  if (r.error) return { effect: null, error: r.error };
  const prev = opts.prev;
  const e = newCustomEffect({ name: opts.name ?? prev?.name ?? effectGraphName(graph), code: r.code, graph, ...(prev?.defId ? { defId: prev.defId } : {}) }, opts.id ?? prev?.id);
  if (prev) {
    e.enabled = prev.enabled;
    if (prev.where) e.where = prev.where;
    if (prev.whereLayer !== undefined) e.whereLayer = prev.whereLayer;
    if (prev.whereInvert) e.whereInvert = true;
  }
  return { effect: e, error: '' };
}

/** A node effect (+ Add effect → Nodes): the node at its defaults between the picture and the output. */
export function nodeEffect(type: string): { effect: FinishEffect | null; error: string } {
  return effectFromGraph(nodeEffectGraph(type));
}

/**
 * The graph with the effect's current settings written back into its nodes'
 * params, so the editor opens on what the stack shows (the stack's sliders
 * may have moved since it was compiled).
 */
export function graphWithEffectValues(graph: EffectGraph, e: FinishEffect): EffectGraph {
  const { bind } = compileEffectGraph(graph);
  const nodes = graph.nodes.map(n => ({ ...n, ...(n.params ? { params: { ...n.params } } : {}) }));
  for (const [name, b] of Object.entries(bind)) {
    const n = nodes.find(m => m.id === b.nodeId);
    if (!n) continue;
    if (b.colour) {
      const rgb = ['r', 'g', 'b'].map(c => e[`${name}.${c}`]);
      if (rgb.every(v => typeof v === 'number')) n.params = { ...(n.params ?? {}), [b.param]: rgb as number[] };
    } else if (typeof e[name] === 'number') {
      n.params = { ...(n.params ?? {}), [b.param]: e[name] as number };
    }
  }
  return { ...graph, nodes };
}
