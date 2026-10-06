/**
 * doOutputs.ts — two Do… bar extras (docs/suggestions.md):
 *
 *  - OUTPUT PHRASES for a 3D scene: "output the depth", "show the normals", "colour it by
 *    distance with a palette", "colour by height palette fire", "show the picture". A scene the
 *    Scene Builder made is rebuilt with that output (its spec keeps it, so the builder, the recipe
 *    and Describe agree); a hand-made March Loop / GI Lit March gets the same nodes the builder
 *    would add (sceneBuilder/build.ts emitOutput), wired into the Output.
 *  - TYPE FIXES: a step that would wire a vec3 colour into a number socket is refused up front
 *    (lang/typeCheck.ts, the graph's own wire rule), and the fix ("use its brightness
 *    (Luminance)", "take .x") is offered as a ready plan: a convert step, then the move on it.
 *
 * Pure: plans and node lists; doBar.ts calls in.
 */
import type { GraphNode } from '../types/nodeGraph';
import { n } from '../store/graphBuilder';
import { graphOutput } from '../nodes/scene3dDefaults';
import { placeNear } from '../nodes/recipes';
import { cardHeight } from '../store/agentSetup';
import { DEFAULT_PALETTE, OUTPUT_BY_SHOW, OUTPUT_WORDS, PALETTE_BY_KEY, outputProblem, type OutputSpec } from '../sceneBuilder/output';
import { META_KEY, emitOutput, type SceneBuilderMeta } from '../sceneBuilder/build';
import { applyScene } from '../sceneBuilder/apply';
import { tokenize } from '../lang/vocabulary';
import { checkWire, type TypeFix } from '../lang/typeCheck';
import { exprBlock } from './moves';

export type OutputStep = { kind: 'scene-output'; output: OutputSpec; loopId: string; sceneId: string | null; label: string };
export type ConvertStep = { kind: 'convert'; node: string; key: string; via: 'luminance' | 'take-x' | 'length'; label: string };

const RENDERERS = new Set(['marchLoopGroup', 'giLitMarchGroup', 'glassScene']);
const OUTPUT_HEAD = /^(output|show|display|view|render|see|colou?r(\s+(it|the scene|the space|everything))?\s+by)\b/;

/** The renderer the Output shows (else the first), and the builder scene it belongs to. */
function sceneOf(nodes: GraphNode[]): { loop: GraphNode; sceneId: string | null; meta: SceneBuilderMeta | null } | null {
  const byId = new Map(nodes.map(nd => [nd.id, nd]));
  const out = graphOutput(nodes);
  const seen = new Set<string>();
  const stack = out?.inputs.color?.connection ? [out.inputs.color.connection.nodeId] : [];
  let loop: GraphNode | undefined;
  while (stack.length && !loop) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const nd = byId.get(id);
    if (!nd) continue;
    if (RENDERERS.has(nd.type)) { loop = nd; break; }
    for (const s of Object.values(nd.inputs)) if (s.connection) stack.push(s.connection.nodeId);
  }
  loop ??= nodes.find(nd => RENDERERS.has(nd.type));
  if (!loop) return null;
  const sceneNode = byId.get(loop.inputs[loop.type === 'glassScene' ? 'foreground' : 'scene']?.connection?.nodeId ?? '');
  const meta = (sceneNode?.params[META_KEY] as SceneBuilderMeta | undefined) ?? null;
  return { loop, sceneId: meta ? sceneNode!.id : null, meta };
}

/** "output the depth" → { show: 'depth' }; null when the phrase isn't about a 3D output. */
export function readOutputPhrase(text: string): OutputSpec | null {
  const lower = text.trim().toLowerCase();
  if (!OUTPUT_HEAD.test(lower)) return null;
  const toks = tokenize(lower);
  const byPalette = /^colou?r\b/.test(lower) || toks.includes('palette') || toks.includes('ramp');
  let show: OutputSpec['show'] | null = null;
  let palette: string | undefined;
  for (const t of toks) {
    const single = t.endsWith('s') && OUTPUT_WORDS[t.slice(0, -1)] ? t.slice(0, -1) : t;
    if (!show && OUTPUT_WORDS[single] && !['colour', 'color'].includes(single)) show = OUTPUT_WORDS[single];
    if (PALETTE_BY_KEY[t]) palette = t;
  }
  if (!show) return null;
  if (show === 'picture') return { show };
  return byPalette ? { show, palette: palette ?? DEFAULT_PALETTE } : { show };
}

/** A plan for an output phrase, or null when it isn't one. */
export function planOutput(text: string, nodes: GraphNode[]): { steps: OutputStep[]; problem?: string; reading: Array<{ text: string; as: string }> } | null {
  const o = readOutputPhrase(text);
  if (!o) return null;
  const reading = [{ text: text.trim(), as: `3D output: ${o.show}${o.palette ? ` through ${o.palette}` : ''}` }];
  const sc = sceneOf(nodes);
  if (!sc) return { steps: [], reading, problem: 'Outputs are for a 3D scene: build one with the 3D Scene Builder (a March Loop and a Scene Group), then say what it shows.' };
  const mode = sc.loop.type === 'glassScene' ? 'glass' : sc.loop.params.volumetric ? 'volumetric' : sc.loop.type === 'giLitMarchGroup' ? 'gi' : 'surface';
  const problem = outputProblem(mode, o);
  if (problem) return { steps: [], reading, problem };
  const def = OUTPUT_BY_SHOW[o.show];
  const label = o.show === 'picture' ? 'Show the lit picture again' : `Show ${def.label.toLowerCase()}${o.palette ? ` through the ${PALETTE_BY_KEY[o.palette].label} palette` : ''}${sc.sceneId ? ' (rebuilds the Scene Builder scene)' : ''}`;
  return { steps: [{ kind: 'scene-output', output: o, loopId: sc.loop.id, sceneId: sc.sceneId, label }], reading };
}

/** Apply an output step. */
export function runOutputStep(nodes: GraphNode[], step: OutputStep, nextId: () => string, heightOf: (nd: GraphNode) => number = cardHeight): { nodes: GraphNode[]; added: string[]; select: string | null } {
  const sc = sceneOf(nodes);
  if (!sc) return { nodes, added: [], select: null };
  if (sc.sceneId && sc.meta) {
    const spec = structuredClone(sc.meta.spec);
    if (step.output.show === 'picture') delete spec.output; else spec.output = { ...step.output };
    const r = applyScene(nodes, spec, { nextId, sceneId: sc.sceneId });
    return { nodes: r.nodes, added: [], select: r.focusId };
  }
  // A hand-made loop: the builder's output nodes beside it, wired into the Output.
  const out = graphOutput(nodes);
  if (step.output.show === 'picture') {
    if (!out) return { nodes, added: [], select: null };
    return { nodes: nodes.map(nd => (nd.id === out.id ? { ...nd, inputs: { ...nd.inputs, color: { ...nd.inputs.color, connection: { nodeId: sc.loop.id, outputKey: 'color' } } } } : nd)), added: [], select: sc.loop.id };
  }
  const made: GraphNode[] = [];
  const ids = new Map<string, string>();
  const scene = sc.loop.inputs.scene?.connection;
  const sun = sc.loop.inputs.lightDir?.connection ?? null;
  const final = emitOutput({ idFor: role => { if (!ids.has(role)) ids.set(role, nextId()); return ids.get(role)!; }, nodes: made }, step.output, {
    kind: sc.loop.type === 'giLitMarchGroup' ? 'gi' : 'march', loop: sc.loop, scene: scene ? { ...scene } : { nodeId: '', outputKey: 'scene' }, sun: sun ? { ...sun } : null,
    maxDist: Number(sc.loop.params.maxDist ?? 20), camDist: 4,
  });
  made.forEach((nd, i) => { nd.position = { x: sc.loop.position.x + 460 + i * 420, y: sc.loop.position.y + 360 }; });
  const placed = placeNear(nodes, made, heightOf);
  let cur = [...nodes, ...placed];
  if (out) cur = cur.map(nd => (nd.id === out.id ? { ...nd, inputs: { ...nd.inputs, color: { ...nd.inputs.color, connection: { ...final } } } } : nd));
  return { nodes: cur, added: placed.map(nd => nd.id), select: final.nodeId };
}

// ── Type fixes ──────────────────────────────────────────────────────────────

const KIND_TYPE: Record<string, string> = { scalar: 'float', mask: 'float', distance: 'float', colour: 'vec3', space: 'vec2', texture: 'texture' };

/** Can `node`'s output `key` feed a move that works on `kinds`? A refusal with fixes when not. */
export function moveTypeCheck(node: GraphNode, key: string, kinds: string[], moveLabel: string, nodeLabel: string): { message: string; fixes: TypeFix[] } | null {
  const from = node.outputs[key]?.type;
  if (!from) return null;
  const wants = [...new Set(kinds.map(k => KIND_TYPE[k]).filter(Boolean))];
  if (!wants.length || wants.some(t => checkWire(from, t).ok)) return null;
  const r = checkWire(from, wants[0], { from: `${nodeLabel} · ${node.outputs[key].label}`, to: moveLabel, colour: from === 'vec3' || from === 'vec4' });
  return r.ok ? null : { message: r.message, fixes: r.fixes.filter(f => f.id === 'luminance' || f.id === 'take-x' || f.id === 'length') };
}

/** Put the conversion after `node.key`: a Luminance node, or an Expression Block taking .x / its length. Returns the new node. */
export function runConvertStep(nodes: GraphNode[], step: ConvertStep, nextId: () => string, heightOf: (nd: GraphNode) => number = cardHeight): { nodes: GraphNode[]; id: string; key: string } {
  const src = nodes.find(nd => nd.id === step.node)!;
  const type = src.outputs[step.key]?.type ?? 'vec3';
  const id = nextId();
  const x = src.position.x + 440, y = src.position.y + 40;
  const conv = step.via === 'luminance'
    ? n('luminance', id, x, y, { __comment: 'Luminance: the colour\'s brightness, one number (BT.709).\nWhy: the Do… bar\'s type fix: the next step works on a number, not a colour.' }, { color: [step.node, step.key] })
    : exprBlock(id, x, y, {
      label: step.via === 'take-x' ? 'Take .x' : 'Length', inputs: [{ name: 'v', type: type === 'vec2' ? 'vec2' : 'vec3' }], result: step.via === 'take-x' ? 'v.x' : 'length(v)', outputType: 'float',
      wires: { v: [step.node, step.key] }, comment: `${step.via === 'take-x' ? 'Takes the first number (.x)' : 'Takes its length'}.\nWhy: the Do… bar's type fix: the next step works on a number.`,
    });
  const placed = placeNear(nodes, [conv], heightOf);
  return { nodes: [...nodes, ...placed], id, key: 'result' };
}
