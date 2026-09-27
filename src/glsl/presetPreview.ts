/**
 * A saved Custom Function preset as a preview shader, for its thumbnail in
 * the Functions library.
 *
 * The preset's body runs inside a wrapper function (`pv_preset`) over its
 * inputs, after its helper block. Each input is fed the way the discovery
 * preview fed it when the function was found (the bindings saved with it);
 * a preset saved from a node has none, so the roles are guessed the same way
 * discovery guesses them: from the helper the body calls when it is a plain
 * call (`fbm(p)`), otherwise from the body itself. The result is painted by
 * its role, so a distance shows as a signed field and a colour as colour.
 *
 * `thumbnailKey` is what the thumbnail cache keys on: everything that changes
 * the picture (inputs, output, body, helpers, bindings, size) and nothing
 * that doesn't (the name, the comment, when it was saved).
 */
import type { CustomFnPreset } from '../types/customFnPreset';
import { discoverInSource, type DiscoveredFn } from './discover';
import { defaultBinding, previewSource, type Binding } from './previewShader';
import { inferParamRoles, inferReturnRole, type ParamRole, type RoleMemory, type ValueRole } from './roles';

export type PresetLike = Pick<CustomFnPreset, 'inputs' | 'outputType' | 'body' | 'glslFunctions' | 'preview'>;

const PREVIEWABLE = new Set(['float', 'vec2', 'vec3', 'vec4']);

/** The body as a function body: a lone expression is returned; a block keeps its own returns. */
function wrapperBody(body: string, outputType: string): string {
  const t = body.trim().replace(/;\s*$/, '');
  const statements = t.split(';').length;
  if (!t.includes('\n') && statements === 1 && !/\breturn\b/.test(t)) return `  return ${t};`;
  const zero = outputType === 'float' ? '0.0' : `${outputType}(0.0)`;
  return `  ${body.trim()}${/[;}]\s*$/.test(body.trim()) ? '' : ';'}\n  return ${zero};`;
}

/** The helper a plain-call body calls, found in the helper block, with the body's arguments in parameter order. */
function calledHelper(p: PresetLike): DiscoveredFn | null {
  const m = /^\s*(?:return\s+)?([A-Za-z_]\w*)\s*\(([^;]*)\)\s*;?\s*$/.exec(p.body);
  if (!m) return null;
  const args = m[2].split(',').map(a => a.trim()).filter(Boolean);
  if (args.length !== p.inputs.length || args.some((a, i) => a !== p.inputs[i].name)) return null;
  const fns = discoverInSource({ id: 'preset', name: 'preset', code: p.glslFunctions });
  return fns.filter(f => f.name === m[1] && f.params.length === args.length).pop() ?? null;
}

/** The roles and return role the thumbnail uses: saved with the preset, or guessed. */
export function presetRoles(p: PresetLike, memory: RoleMemory = {}): { roles: ParamRole[]; returnRole: ValueRole; bindings: Binding[] } {
  const helper = calledHelper(p);
  const wrapper: DiscoveredFn = {
    id: 'preset', sourceId: 'preset', sourceName: 'preset', name: 'pv_preset', returnType: p.outputType,
    params: p.inputs.map(i => ({ name: i.name, type: i.type, qualifier: 'in' as const })),
    signature: '', text: `${p.outputType} pv_preset() {\n${p.body}\n}`, start: 0, end: 0, startLine: 1, endLine: 1,
    calls: [], dependencies: [], level: 0, globals: [], defines: [], consts: [], shadertoy: [], selfContained: true, callSites: [],
  };
  // The helper's own parameter names and body say more than the call does (roles go by position).
  const fn = helper ?? wrapper;
  const guessed = inferParamRoles(fn, memory);
  const roles = guessed.map((r, i) => {
    const saved = p.preview?.roles?.[i];
    return saved ? { ...r, role: saved, confidence: 1, because: [] } : r;
  });
  const returnRole = p.preview?.returnRole ?? inferReturnRole(helper ?? wrapper).role;
  const saved = p.preview?.bindings;
  const bindings = roles.map((r, i) => (saved && saved.length === roles.length ? saved[i] : defaultBinding(r)));
  return { roles, returnRole, bindings };
}

/** The thumbnail's fragment shader, or null when the preset can't be drawn on its own. */
export function presetPreviewShader(p: PresetLike, memory: RoleMemory = {}): string | null {
  if (!PREVIEWABLE.has(p.outputType)) return null;
  if (p.inputs.some(i => !PREVIEWABLE.has(i.type) || !/^[A-Za-z_]\w*$/.test(i.name))) return null;
  const { roles, returnRole, bindings } = presetRoles(p, memory);
  const params = p.inputs.map(i => `${i.type} ${i.name}`).join(', ');
  const helpers = `${p.glslFunctions.trim()}\n\n${p.outputType} pv_preset(${params}) {\n${wrapperBody(p.body, p.outputType)}\n}`;
  // A still picture: time runs across it, left to right, so a function of time shows its range instead of one moment.
  return previewSource(helpers, 'pv_preset', p.outputType, p.inputs, roles, returnRole, bindings, { sweepTime: true });
}

function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return (h >>> 0).toString(36);
}

/** Bump when the thumbnail shader changes, so no cached picture from an older one is shown. */
const THUMB_VERSION = 2;

/** The thumbnail cache key: what the picture depends on, and nothing else. */
export function thumbnailKey(p: PresetLike, size: number): string {
  const parts = JSON.stringify([THUMB_VERSION, size, p.outputType, p.inputs.map(i => [i.name, i.type]), p.body.trim(), p.glslFunctions.trim(), p.preview ?? null]);
  return `fn${THUMB_VERSION}_${size}_${djb2(parts)}_${parts.length.toString(36)}`;
}
