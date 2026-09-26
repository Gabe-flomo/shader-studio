/**
 * presentation.ts — a Present page document (docs/present-plan.md).
 *
 * A presentation is a title, an ordered list of steps (each a list of
 * blocks), and the Play snapshots its canvases and code read from. It never
 * points at a live graph: each source is a copy taken when it was added (or
 * refreshed), so editing a graph later doesn't change a lesson built on it.
 *
 * Stored as JSON in localStorage (`shader-studio-presentation:<name>`) and
 * in `.present.json` files. `parsePresentation` is the one gate that turns
 * unknown JSON back into a well-formed presentation, dropping what's broken
 * (a block whose source is gone, a malformed step) rather than failing.
 */
import { parsePlayRecord, type PlayRecord } from './play';
import { PREVIEW_ASPECTS, type PreviewAspect } from '../utils/graphImportPlan';
import type { PlayHtmlInput } from '../play/exportHtml';

export const PRESENTATION_FILE_KIND = 'shader-studio-presentation';
export const PRESENTATION_VERSION = 1 as const;

// ── Sources ─────────────────────────────────────────────────────────────────

export type SourceOrigin = { kind: 'saved'; name: string; savedAt: number } | { kind: 'example'; key: string };

/** What a graph uses that decides whether the web runtime can run it (see unsupportedFeatures). */
export interface SourceFeatures {
  textureUniforms: Record<string, string>;
  videoUniforms: Record<string, string>;
  audioUniforms: Record<string, string>;
  liveUniforms: Record<string, string>;
  isStateful: boolean;
  particleSystems: number;
  usesEcho: boolean;
}

/** A node of the source graph that has lines in its shader (for code blocks that quote one). */
export interface SourceNode { id: string; label: string; slug: string }

export interface PresentSource {
  id: string;
  from: SourceOrigin;
  title: string;
  /** What the web export builds its page from: shader, uniform values, bindings, Play record, aspect. */
  bundle: PlayHtmlInput;
  /** The generated GLSL is bundle.fragmentShader; this is its node → slug map, for quoting one node. */
  shader: { nodes: SourceNode[] };
  capturedAt: number;
  /** From unsupportedFeatures() when captured; recomputed from `features` when the page loads. */
  limits: string[];
  features?: SourceFeatures;
  /** A small still of the picture (a JPEG data URL), for lists and for canvases that aren't running. */
  poster?: string;
}

// ── Blocks ──────────────────────────────────────────────────────────────────

export type BlockAspect = '16:9' | '4:3' | '1:1' | '9:16' | { w: number; h: number };
export const BLOCK_ASPECTS = ['16:9', '4:3', '1:1', '9:16'] as const;
export type BlockWidth = 'full' | 'half' | 'third';

export interface TextBlock { type: 'text'; id: string; markdown: string }

export interface RenderBlock {
  type: 'render'; id: string; source: string;
  aspect: BlockAspect;
  width: BlockWidth;
  /** Let the mouse reach the shader (u_mouse, mouse mappings). */
  pointer: boolean;
  caption?: string;
  /** Seconds on the clock at the start. */
  startTime?: number;
  /** Hold the clock at startTime: a still of that moment. */
  paused?: boolean;
}

export interface InteractiveControl { controlId: string; label?: string; hint?: string; showMappings: boolean }

export interface InteractiveBlock {
  type: 'interactive'; id: string; source: string;
  /** Shown beside or above the canvas. `[[control:id]]` becomes a chip that points at that slider. */
  markdown: string;
  controls: InteractiveControl[];
  layout: 'side' | 'stacked';
  aspect: BlockAspect;
  pointer: boolean;
}

export type CodeFrom = { source: string; node?: string } | { source: string; layerId: string };

export interface CodeBlock {
  type: 'code'; id: string;
  language: 'glsl' | 'js';
  /** Typed in. Used when there's no `from`. */
  code?: string;
  /** The source's shader, one node's slice of it, or a Script layer's code. */
  from?: CodeFrom;
  /** 1-based inclusive line ranges to mark. */
  highlightLines?: [number, number][];
  caption?: string;
}

export type Block = TextBlock | RenderBlock | InteractiveBlock | CodeBlock;
export type BlockType = Block['type'];

export interface Step {
  id: string;
  title?: string;
  /** 2: blocks sit side by side in two columns on wide screens (an interactive block always spans both). */
  columns: 1 | 2;
  blocks: Block[];
}

export interface Presentation {
  version: typeof PRESENTATION_VERSION;
  title: string;
  steps: Step[];
  sources: PresentSource[];
  /**
   * 'imported' when it came from a file: its Script layers are someone else's
   * code, so canvases that have them run in a sandboxed frame.
   */
  origin?: 'imported';
  createdAt: number;
  updatedAt: number;
}

// ── Making things ───────────────────────────────────────────────────────────

let seq = 0;
/** A short id, unique within a presentation. */
export function newId(prefix: string): string {
  seq = (seq + 1) % 1296;
  return `${prefix}${Date.now().toString(36).slice(-5)}${seq.toString(36).padStart(2, '0')}${Math.floor(Math.random() * 36 * 36).toString(36).padStart(2, '0')}`;
}

export function emptyPresentation(title: string, now = Date.now()): Presentation {
  return { version: PRESENTATION_VERSION, title, steps: [newStep()], sources: [], createdAt: now, updatedAt: now };
}

export function newStep(title?: string): Step {
  return { id: newId('s'), ...(title ? { title } : {}), columns: 1, blocks: [] };
}

/** A new block of a type, reading from `source` when it needs one. */
export function newBlock(type: BlockType, source?: PresentSource): Block {
  const id = newId('b');
  switch (type) {
    case 'text': return { type, id, markdown: '' };
    case 'render': return { type, id, source: source?.id ?? '', aspect: '16:9', width: 'full', pointer: true };
    case 'interactive': return {
      type, id, source: source?.id ?? '', markdown: '', layout: 'side', aspect: '4:3', pointer: true,
      controls: (source?.bundle.play.controls ?? []).slice(0, 4).map(c => ({ controlId: c.id, showMappings: true })),
    };
    case 'code': return source ? { type, id, language: 'glsl', from: { source: source.id } } : { type, id, language: 'glsl', code: '' };
  }
}

/** A copy with fresh ids (duplicating a block or a step). */
export function cloneBlock(b: Block): Block {
  return { ...structuredClone(b), id: newId('b') };
}
export function cloneStep(s: Step): Step {
  return { ...s, id: newId('s'), blocks: s.blocks.map(cloneBlock) };
}

/** Sources a block reads from. */
export function blockSources(b: Block): string[] {
  if (b.type === 'render' || b.type === 'interactive') return [b.source];
  if (b.type === 'code' && b.from) return [b.from.source];
  return [];
}

export function aspectRatio(a: BlockAspect): number {
  if (typeof a === 'object') return a.w / a.h;
  const [w, h] = a.split(':').map(Number);
  return w / h;
}

// ── Parsing ─────────────────────────────────────────────────────────────────

const MAX_TEXT = 20000;
const MAX_CODE = 40000;
const MAX_STEPS = 200;
const MAX_BLOCKS = 40;
const MAX_POSTER = 400_000;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, max = 400): string | null => (typeof v === 'string' ? v.slice(0, max) : null);
const idOf = (v: unknown): string | null => (typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function parseAspect(v: unknown): BlockAspect {
  if (typeof v === 'string' && (BLOCK_ASPECTS as readonly string[]).includes(v)) return v as BlockAspect;
  if (isObj(v)) {
    const w = num(v.w), h = num(v.h);
    if (w && h && w > 0 && h > 0 && w / h > 0.1 && w / h < 10) return { w, h };
  }
  return '16:9';
}

function stringRecord(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (isObj(v)) for (const [k, x] of Object.entries(v)) if (typeof x === 'string') out[k] = x;
  return out;
}

function parseUniforms(v: unknown): Record<string, number | number[]> {
  const out: Record<string, number | number[]> = {};
  if (!isObj(v)) return out;
  for (const [k, x] of Object.entries(v)) {
    if (typeof x === 'number' && Number.isFinite(x)) out[k] = x;
    else if (Array.isArray(x) && x.length >= 1 && x.length <= 4 && x.every(n => typeof n === 'number' && Number.isFinite(n))) out[k] = x.slice() as number[];
  }
  return out;
}

function parseBundle(v: unknown): PlayHtmlInput | null {
  if (!isObj(v)) return null;
  const fragmentShader = typeof v.fragmentShader === 'string' && v.fragmentShader.length > 0 && v.fragmentShader.length < 2_000_000 ? v.fragmentShader : null;
  if (!fragmentShader) return null;
  const aspect = PREVIEW_ASPECTS.some(a => a.id === v.aspect) ? v.aspect as PreviewAspect : 'free';
  const play: PlayRecord = parsePlayRecord(v.play);
  return { title: str(v.title, 200) ?? 'Play', fragmentShader, uniforms: parseUniforms(v.uniforms), paramBindings: stringRecord(v.paramBindings), play, aspect };
}

function parseFeatures(v: unknown): SourceFeatures | undefined {
  if (!isObj(v)) return undefined;
  return {
    textureUniforms: stringRecord(v.textureUniforms), videoUniforms: stringRecord(v.videoUniforms),
    audioUniforms: stringRecord(v.audioUniforms), liveUniforms: stringRecord(v.liveUniforms),
    isStateful: v.isStateful === true, particleSystems: Math.max(0, Math.round(num(v.particleSystems) ?? 0)), usesEcho: v.usesEcho === true,
  };
}

function parseSource(v: unknown): PresentSource | null {
  if (!isObj(v)) return null;
  const id = idOf(v.id);
  const bundle = parseBundle(v.bundle);
  if (!id || !bundle) return null;
  const f = isObj(v.from) ? v.from : {};
  const from: SourceOrigin = f.kind === 'example' && typeof f.key === 'string'
    ? { kind: 'example', key: f.key.slice(0, 120) }
    : { kind: 'saved', name: str(f.name, 200) ?? bundle.title, savedAt: num(f.savedAt) ?? 0 };
  const nodes: SourceNode[] = [];
  const sh = isObj(v.shader) ? v.shader : {};
  if (Array.isArray(sh.nodes)) for (const n of sh.nodes) {
    if (!isObj(n)) continue;
    const nid = str(n.id, 200), slug = str(n.slug, 200);
    if (nid && slug && /^\w+$/.test(slug)) nodes.push({ id: nid, slug, label: str(n.label, 120) ?? nid });
  }
  const out: PresentSource = {
    id, from, title: str(v.title, 200) ?? bundle.title, bundle, shader: { nodes },
    capturedAt: num(v.capturedAt) ?? 0,
    limits: Array.isArray(v.limits) ? v.limits.filter((x): x is string => typeof x === 'string').map(x => x.slice(0, 120)).slice(0, 20) : [],
  };
  const features = parseFeatures(v.features);
  if (features) out.features = features;
  if (typeof v.poster === 'string' && v.poster.length < MAX_POSTER && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v.poster)) out.poster = v.poster;
  return out;
}

function parseLines(v: unknown): [number, number][] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: [number, number][] = [];
  for (const r of v) {
    if (!Array.isArray(r) || r.length !== 2) continue;
    const a = num(r[0]), b = num(r[1]);
    if (a === null || b === null) continue;
    const lo = Math.max(1, Math.round(Math.min(a, b))), hi = Math.max(1, Math.round(Math.max(a, b)));
    out.push([lo, hi]);
  }
  return out.length ? out.slice(0, 20) : undefined;
}

function parseBlock(v: unknown, sources: ReadonlyMap<string, PresentSource>): Block | null {
  if (!isObj(v)) return null;
  const id = idOf(v.id);
  if (!id) return null;
  switch (v.type) {
    case 'text': return { type: 'text', id, markdown: str(v.markdown, MAX_TEXT) ?? '' };
    case 'render': {
      const source = idOf(v.source);
      if (!source || !sources.has(source)) return null;
      const b: RenderBlock = {
        type: 'render', id, source, aspect: parseAspect(v.aspect),
        width: v.width === 'half' || v.width === 'third' ? v.width : 'full',
        pointer: v.pointer !== false,
      };
      const caption = str(v.caption, 400);
      if (caption) b.caption = caption;
      const t = num(v.startTime);
      if (t !== null && t > 0) b.startTime = Math.min(3600, t);
      if (v.paused === true) b.paused = true;
      return b;
    }
    case 'interactive': {
      const source = idOf(v.source);
      const src = source ? sources.get(source) : undefined;
      if (!source || !src) return null;
      const known = new Set(src.bundle.play.controls.map(c => c.id));
      const seen = new Set<string>();
      const controls: InteractiveControl[] = [];
      if (Array.isArray(v.controls)) for (const c of v.controls) {
        if (!isObj(c)) continue;
        const controlId = str(c.controlId, 100);
        // A control the snapshot no longer has is dropped (Refresh keeps the ones that survive).
        if (!controlId || !known.has(controlId) || seen.has(controlId)) continue;
        seen.add(controlId);
        const ctl: InteractiveControl = { controlId, showMappings: c.showMappings !== false };
        const label = str(c.label, 80), hint = str(c.hint, 300);
        if (label && label.trim()) ctl.label = label;
        if (hint && hint.trim()) ctl.hint = hint;
        controls.push(ctl);
      }
      return {
        type: 'interactive', id, source, markdown: str(v.markdown, MAX_TEXT) ?? '', controls,
        layout: v.layout === 'stacked' ? 'stacked' : 'side', aspect: parseAspect(v.aspect), pointer: v.pointer !== false,
      };
    }
    case 'code': {
      const language = v.language === 'js' ? 'js' : 'glsl';
      const b: CodeBlock = { type: 'code', id, language };
      if (isObj(v.from)) {
        const source = idOf(v.from.source);
        if (source && sources.has(source)) {
          const layerId = str(v.from.layerId, 100);
          const node = str(v.from.node, 200);
          b.from = layerId ? { source, layerId } : node ? { source, node } : { source };
        }
      }
      const code = str(v.code, MAX_CODE);
      if (code !== null) b.code = code;
      if (!b.from && b.code === undefined) return null;
      const lines = parseLines(v.highlightLines);
      if (lines) b.highlightLines = lines;
      const caption = str(v.caption, 400);
      if (caption) b.caption = caption;
      return b;
    }
    default: return null;
  }
}

function parseStep(v: unknown, sources: ReadonlyMap<string, PresentSource>): Step | null {
  if (!isObj(v)) return null;
  const id = idOf(v.id);
  if (!id) return null;
  const blocks: Block[] = [];
  const seen = new Set<string>();
  if (Array.isArray(v.blocks)) for (const raw of v.blocks.slice(0, MAX_BLOCKS * 2)) {
    const b = parseBlock(raw, sources);
    if (b && !seen.has(b.id)) { seen.add(b.id); blocks.push(b); }
  }
  const step: Step = { id, columns: v.columns === 2 ? 2 : 1, blocks: blocks.slice(0, MAX_BLOCKS) };
  const title = str(v.title, 200);
  if (title && title.trim()) step.title = title;
  return step;
}

/**
 * Turn whatever a stored presentation or a `.present.json` file holds into a
 * presentation. Returns null only when there's nothing presentation-shaped at
 * all (not an object, or no steps array); anything malformed inside is
 * dropped. A presentation always has at least one step.
 */
export function parsePresentation(raw: unknown): Presentation | null {
  if (!isObj(raw) || !Array.isArray(raw.steps)) return null;
  const sources: PresentSource[] = [];
  const byId = new Map<string, PresentSource>();
  if (Array.isArray(raw.sources)) for (const s of raw.sources) {
    const p = parseSource(s);
    if (p && !byId.has(p.id)) { byId.set(p.id, p); sources.push(p); }
  }
  const steps: Step[] = [];
  const seen = new Set<string>();
  for (const s of raw.steps.slice(0, MAX_STEPS)) {
    const p = parseStep(s, byId);
    if (p && !seen.has(p.id)) { seen.add(p.id); steps.push(p); }
  }
  if (!steps.length) steps.push(newStep());
  const now = Date.now();
  const out: Presentation = {
    version: PRESENTATION_VERSION,
    title: (str(raw.title, 200) ?? '').trim() || 'Untitled presentation',
    steps, sources,
    createdAt: num(raw.createdAt) ?? now,
    updatedAt: num(raw.updatedAt) ?? now,
  };
  if (raw.origin === 'imported') out.origin = 'imported';
  return out;
}
