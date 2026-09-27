/**
 * layerKinds.ts — a sketch saved as a layer kind of its own (docs/js-layers.md,
 * "Layer kinds"; step 1 of `defineLayer` in docs/playfield-sdk.md).
 *
 * A layer kind is a Script layer's code with a name, an icon and a colour. It
 * shows in Add layer beside the built-in kinds, and a layer made from it is a
 * Script layer that points at it (`kindId`): the kind's declared params are
 * that layer's properties, so controls, mappings, keyframes, the Cloner and
 * the Layers node treat it like any other layer.
 *
 * The definitions travel with the play file (`PlayRecord.layerKinds`), and
 * each layer keeps a copy of the kind's code, so a file whose kind has gone
 * missing still runs: the layer becomes a plain Script layer with that code.
 * `parseLayerKinds` and `syncLayerKinds` are the gates parsePlayRecord uses.
 */
import type { PlayLayer, ScriptLayer, ScriptMode, ScriptParamDef } from './playLayers';
import { isScriptParamDef } from './playLayers';

/** The icons a kind may use (all of them are IconNames; the UI checks that). */
export const LAYER_KIND_ICONS = ['code', 'spark', 'star', 'wave', 'dice', 'hash', 'loop', 'curve', 'grid', 'target', 'grip', 'text', 'eye', 'sun', 'moon', 'sliders', 'overlay', 'layoutCanvas', 'cube'] as const;
export type LayerKindIcon = (typeof LAYER_KIND_ICONS)[number];

/** The colours a kind may use: accent names the theme turns into a light or a dark shade. */
export const LAYER_KIND_COLOURS = ['blue', 'sky', 'teal', 'green', 'yellow', 'peach', 'red', 'pink', 'mauve', 'lavender'] as const;
export type LayerKindColour = (typeof LAYER_KIND_COLOURS)[number];

export interface LayerKindDef {
  /**
   * Stable id layers point at. Saved sketches are `sketch:<slug>-<suffix>`;
   * plugin layers will be namespaced by their plugin (`com.example.ripples:ripple`).
   */
  id: string;
  name: string;
  /** One line for Add layer. Empty: the list says how many controls it has. */
  hint: string;
  icon: LayerKindIcon;
  colour: LayerKindColour;
  /** What the code draws with (a 3D kind makes 3D Script layers). */
  mode: ScriptMode;
  code: string;
  /** The params the code declares, read when it was saved or last edited. */
  paramDefs: ScriptParamDef[];
  /** What a new layer of the kind starts with (each layer can change its own). */
  clear: boolean;
  readPicture: boolean;
  /** Counts edits, so a copy elsewhere can tell it is older. */
  version: number;
}

export const LAYER_KINDS_MAX = 64;
const ID_RE = /^[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]{1,80}$/;

export function isLayerKindId(id: unknown): id is string {
  return typeof id === 'string' && ID_RE.test(id);
}

/** An id for a new kind called `name`. */
export function newLayerKindId(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'sketch';
  return `sketch:${slug}-${Math.random().toString(36).slice(2, 7)}`;
}

/** A kind from a file, or null when it isn't one. Bad icons and colours fall back; bad params are dropped. */
export function parseLayerKind(raw: unknown): LayerKindDef | null {
  if (!raw || typeof raw !== 'object') return null;
  const k = raw as Record<string, unknown>;
  if (!isLayerKindId(k.id) || typeof k.code !== 'string') return null;
  const name = typeof k.name === 'string' && k.name.trim() ? k.name.trim().slice(0, 60) : 'Sketch';
  return {
    id: k.id,
    name,
    hint: typeof k.hint === 'string' ? k.hint.slice(0, 240) : '',
    icon: (LAYER_KIND_ICONS as readonly string[]).includes(k.icon as string) ? k.icon as LayerKindIcon : 'code',
    colour: (LAYER_KIND_COLOURS as readonly string[]).includes(k.colour as string) ? k.colour as LayerKindColour : 'mauve',
    mode: k.mode === '3d' ? '3d' : '2d',
    code: k.code,
    paramDefs: Array.isArray(k.paramDefs) ? k.paramDefs.filter(isScriptParamDef).slice(0, 32).map(d => ({ ...d })) : [],
    clear: k.clear !== false,
    readPicture: k.readPicture === true,
    version: typeof k.version === 'number' && Number.isFinite(k.version) ? Math.max(1, Math.round(k.version)) : 1,
  };
}

/** Every well-formed kind in a list, the first of each id kept. */
export function parseLayerKinds(raw: unknown): LayerKindDef[] {
  if (!Array.isArray(raw)) return [];
  const out: LayerKindDef[] = [];
  const seen = new Set<string>();
  for (const r of raw.slice(0, LAYER_KINDS_MAX)) {
    const k = parseLayerKind(r);
    if (k && !seen.has(k.id)) { seen.add(k.id); out.push(k); }
  }
  return out;
}

/** The kind a layer is made from, when it is a Script layer of a kind the file has. */
export function kindOf(l: PlayLayer, kinds: readonly LayerKindDef[] | undefined): LayerKindDef | null {
  if (l.kind !== 'script' || !l.kindId || !kinds) return null;
  return kinds.find(k => k.id === l.kindId) ?? null;
}

/**
 * Layers matched to the file's kinds: a layer of a kind the file has takes
 * the kind's code and params (the kind is the source of truth); a layer whose
 * kind is missing becomes a plain Script layer with the code it kept.
 */
export function syncLayerKinds(layers: PlayLayer[], kinds: readonly LayerKindDef[]): PlayLayer[] {
  return layers.map(l => {
    if (l.kind !== 'script' || !l.kindId) return l;
    const k = kinds.find(x => x.id === l.kindId);
    if (!k) { const plain = { ...l } as ScriptLayer; delete plain.kindId; return plain; }
    if (l.code === k.code && l.mode === k.mode && sameDefs(l.paramDefs, k.paramDefs)) return l;
    return withKindParams({ ...l, mode: k.mode, code: k.code, paramDefs: k.paramDefs.map(d => ({ ...d })) });
  });
}

/** Every declared slider or toggle gets a value (its declared one) when the layer has none yet. */
export function withKindParams(l: ScriptLayer): ScriptLayer {
  const out = { ...l } as ScriptLayer & Record<string, unknown>;
  for (const d of l.paramDefs) if (d.kind !== 'button' && typeof out[`p_${d.key}`] !== 'number') out[`p_${d.key}`] = d.value;
  return out;
}

function sameDefs(a: readonly ScriptParamDef[], b: readonly ScriptParamDef[]): boolean {
  return a.length === b.length && a.every((d, i) => JSON.stringify(d) === JSON.stringify(b[i]));
}
