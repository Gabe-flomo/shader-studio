/**
 * outputHost.ts — the main window's side of the output window
 * (docs/projection.md).
 *
 * Opens the output (a second Tauri window on the chosen display, or a popup
 * in the browser), sends it the Play as the web player takes it whenever the
 * Play's structure changes, streams each frame's clock, pointer, uniforms,
 * layer numbers and actions (only what changed), keeps the projection mapping
 * and the edit state in step both ways, and holds the mapping's undo.
 *
 * The picture it mirrors is the app's own (ShaderCanvas calls `frame` every
 * frame), or a Present canvas the Stage is showing (`showSnapshot`).
 */
import { create } from 'zustand';
import type * as THREE from 'three';
import { useNodeGraphStore } from '../store/useNodeGraphStore';
import { playEngine } from '../lib/playEngine';
import { playBundle, runtimeScript, type PlayHtmlInput } from '../play/exportHtml';
import { loadThreeSource, playUses3D, threeSource } from '../play/threeSource';
import { finishHosts, finishPropId } from '../types/playFinish';
import { groupLayerIds } from '../types/layerGroups';
import { can, requireFeature } from '../lib/plan';
import { outputTap } from '../lib/outputTap';
import { toast } from '../components/ui/toastStore';
import type { PlayRecord } from '../types/play';
import { defaultProjection, type ProjectionRecord } from '../types/projection';
import { DEFAULT_UI, FrameEncoder, type DownMsg, type OutAction, type OutputRecord, type OutputStatus, type OutputUi, type UpMsg, type ValueMap } from './protocol';
import { MappingHistory } from './mappingEdit';
import { closeDesktopOutput, isDesktopApp, listMonitors, mainLink, openDesktopOutput, putRecord, setDesktopFullscreen, type Link, type Monitor } from './transport';

// ── State the UI shows ──────────────────────────────────────────────────────

export interface DisplayChoice { name: string; fullscreen: boolean }
const DISPLAY_KEY = 'playfield:output-display';

function loadDisplay(): DisplayChoice {
  try {
    const r = JSON.parse(localStorage.getItem(DISPLAY_KEY) ?? 'null') as Partial<DisplayChoice> | null;
    return { name: typeof r?.name === 'string' ? r.name : '', fullscreen: r?.fullscreen !== false };
  } catch { return { name: '', fullscreen: true }; }
}

export type OutputSource = 'app' | 'snapshot';

interface OutputState {
  /** The output window is (meant to be) open. */
  open: boolean;
  /** It has said hello and is showing the picture. */
  connected: boolean;
  status: OutputStatus | null;
  monitors: Monitor[];
  display: DisplayChoice;
  ui: OutputUi;
  /** What the output shows: the app's picture, or the Stage's Present snapshot. */
  source: OutputSource;
  /** What the output can't show (camera, pad grid…), for the panel. */
  notes: string[];
}

export const useOutput = create<OutputState>(() => ({
  open: false, connected: false, status: null, monitors: [], display: loadDisplay(), ui: { ...DEFAULT_UI }, source: 'app', notes: [],
}));

// ── The link ────────────────────────────────────────────────────────────────

let link: Link<DownMsg, UpMsg> | null = null;
let popup: Window | null = null;
const encoder = new FrameEncoder();
export const mappingHistory = new MappingHistory();
let recordRev = 0;
let lastRecord: OutputRecord | null = null;

function send(msg: DownMsg): void { link?.send(msg); }

function ensureLink(): void {
  if (link) return;
  link = mainLink();
  link.onMessage(onUp);
  outputTap.frame = outputFrame;
  startWatching();
}

function onUp(m: UpMsg): void {
  switch (m.type) {
    case 'hello':
      useOutput.setState({ connected: true });
      encoder.forceFull();
      if (lastRecord) void deliverRecord(lastRecord); else scheduleRecord(0);
      sendMapping();
      send({ type: 'ui', ui: useOutput.getState().ui });
      break;
    case 'edit': applyEdit(m.projection, m.commit); break;
    case 'ui': setOutputUi(m.ui); break;
    case 'undo': undoMapping(); break;
    case 'redo': redoMapping(); break;
    case 'status': useOutput.setState({ status: m.status, connected: true, open: true }); break;
    case 'closed': useOutput.setState({ open: false, connected: false, status: null }); popup = null; break;
  }
}

// ── Opening and closing ─────────────────────────────────────────────────────

export async function refreshMonitors(): Promise<Monitor[]> {
  const monitors = await listMonitors().catch(() => [] as Monitor[]);
  useOutput.setState({ monitors });
  return monitors;
}

export function setDisplayChoice(patch: Partial<DisplayChoice>): void {
  const display = { ...useOutput.getState().display, ...patch };
  useOutput.setState({ display });
  try { localStorage.setItem(DISPLAY_KEY, JSON.stringify(display)); } catch { /* not remembered */ }
}

/** The display to use: the remembered one by name, else the first that isn't the main screen. */
export function pickMonitor(monitors: Monitor[], name: string): Monitor | null {
  return monitors.find(m => m.name === name) ?? monitors.find(m => !m.primary) ?? monitors[0] ?? null;
}

function outputUrl(): string {
  return new URL(`${import.meta.env.BASE_URL}output.html`, window.location.href).href;
}

/** Open the output window (Pro). From a click: the browser only allows a popup then. */
export async function openOutput(): Promise<void> {
  if (!requireFeature('play.output')) return;
  ensureLink();
  const { display } = useOutput.getState();
  if (isDesktopApp()) {
    const monitors = await refreshMonitors();
    const m = pickMonitor(monitors, display.name);
    try {
      await openDesktopOutput(m ? m.index : null, display.fullscreen);
      useOutput.setState({ open: true });
    } catch (e) {
      toast.error('The output window didn’t open', { message: String(e) });
    }
    return;
  }
  // The browser: a popup (placed on the chosen screen when Chrome lets us see the screens).
  const monitors = useOutput.getState().monitors;
  const m = monitors.length ? pickMonitor(monitors, display.name) : null;
  const w = m ? Math.round(m.width / m.scale) : 1280, h = m ? Math.round(m.height / m.scale) : 720;
  const features = `popup=yes,width=${Math.min(w, 1920)},height=${Math.min(h, 1080)}${m ? `,left=${m.x},top=${m.y}` : ''}`;
  if (popup && !popup.closed) { popup.focus(); useOutput.setState({ open: true }); return; }
  popup = window.open(outputUrl(), 'playfield-output', features);
  if (!popup) { toast.error('The browser blocked the output window', { message: 'Allow pop-ups for this site, then try again.' }); return; }
  useOutput.setState({ open: true });
}

export async function closeOutput(): Promise<void> {
  send({ type: 'bye' });
  if (isDesktopApp()) await closeDesktopOutput().catch(() => {});
  else if (popup && !popup.closed) popup.close();
  popup = null;
  useOutput.setState({ open: false, connected: false, status: null });
}

export async function setOutputFullscreen(on: boolean): Promise<void> {
  setDisplayChoice({ fullscreen: on });
  if (isDesktopApp()) await setDesktopFullscreen(on).catch(() => {});
  // The browser: only the popup itself can go full screen (a click or F there).
}

/** Move the open output to another display (desktop). */
export async function moveOutputTo(name: string): Promise<void> {
  setDisplayChoice({ name });
  if (!useOutput.getState().open || !isDesktopApp()) return;
  const m = pickMonitor(useOutput.getState().monitors, name);
  await openDesktopOutput(m ? m.index : null, useOutput.getState().display.fullscreen).catch(() => {});
}

export function setOutputUi(patch: Partial<OutputUi>): void {
  const ui = { ...useOutput.getState().ui, ...patch };
  useOutput.setState({ ui });
  send({ type: 'ui', ui });
}

// ── The mapping ─────────────────────────────────────────────────────────────

/** What the output shows with no mapping saved: one surface filling it (made once, so its id stays put). */
const NO_MAPPING = defaultProjection();
export function currentProjection(): ProjectionRecord {
  return useNodeGraphStore.getState().play.projection ?? NO_MAPPING;
}

/** Set the mapping (Pro). `before`: the mapping as it was, for undo (a finished drag or a setting). */
export function setProjection(next: ProjectionRecord, before?: ProjectionRecord): void {
  if (!can('play.projection')) return;
  if (before) mappingHistory.push(before);
  useNodeGraphStore.getState().setPlay(p => ({ ...p, projection: next }), false);
}

let dragBase: ProjectionRecord | null = null;
function applyEdit(next: ProjectionRecord, commit: boolean): void {
  if (!dragBase) dragBase = currentProjection();
  setProjection(next, commit ? dragBase : undefined);
  if (commit) dragBase = null;
}

export function undoMapping(): void {
  const prev = mappingHistory.undo(currentProjection());
  if (prev) useNodeGraphStore.getState().setPlay(p => ({ ...p, projection: prev }), false);
}
export function redoMapping(): void {
  const next = mappingHistory.redo(currentProjection());
  if (next) useNodeGraphStore.getState().setPlay(p => ({ ...p, projection: next }), false);
}

/** Which layers each layer-or-group surface shows alone. */
export function surfaceLayers(play: PlayRecord, p: ProjectionRecord): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const s of p.surfaces) {
    if (s.source.kind === 'layer') out[s.id] = play.layers.some(l => l.id === (s.source as { id: string }).id) ? [s.source.id] : [];
    else if (s.source.kind === 'group') out[s.id] = groupLayerIds(play, s.source.id);
  }
  return out;
}

function sendMapping(): void {
  const play = snapshotPlay ?? useNodeGraphStore.getState().play;
  const projection = currentProjection();
  send({ type: 'mapping', projection, layers: surfaceLayers(play, projection) });
}

// ── The record: the Play as the web player takes it ────────────────────────

/** Things only the app can do, that the output (the web player, fed from here) leaves out. */
function outputNotes(play: PlayRecord): string[] {
  const n: string[] = [];
  if (play.layers.some(l => l.kind === 'camera' || ((l.kind === 'particles' || l.kind === 'glyphs' || l.kind === 'contours' || l.kind === 'motion') && (l as { readFrom?: string }).readFrom === 'camera'))) n.push('Camera layers: the output has no camera of its own, so they stay dark there.');
  if (play.padGrid) n.push('The pad grid’s cells come from your controller here; the output shows them at rest.');
  return n;
}

function aspectOf(bundle: ReturnType<typeof playBundle>): number | null {
  return bundle.aspect && typeof bundle.aspect.ratio === 'number' ? bundle.aspect.ratio : null;
}

async function recordFor(input: PlayHtmlInput, follow: boolean): Promise<OutputRecord> {
  if (playUses3D(input.play) && !threeSource()) await loadThreeSource().catch(() => '');
  const bundle = playBundle(input);
  return { rev: ++recordRev, title: input.title, bundle, scripts: runtimeScript(input.play), aspect: aspectOf(bundle), follow, notes: outputNotes(input.play) };
}

async function deliverRecord(r: OutputRecord): Promise<void> {
  lastRecord = r;
  useOutput.setState({ notes: r.notes ?? [] });
  if (isDesktopApp()) {
    // Too big for an event: the app keeps it and the output fetches it.
    try { await putRecord(r); send({ type: 'recordReady', rev: r.rev }); } catch (e) { console.warn('[output] record', e); }
  } else send({ type: 'record', record: r });
}

let recordTimer = 0;
function scheduleRecord(delay = 300): void {
  window.clearTimeout(recordTimer);
  recordTimer = window.setTimeout(() => { void buildAppRecord(); }, delay);
}

let lastSig = '';
async function buildAppRecord(): Promise<void> {
  if (!link || useOutput.getState().source !== 'app') return;
  const st = useNodeGraphStore.getState();
  const sig = structureSig(st.play) + '\u0000' + st.fragmentShader;
  if (sig === lastSig && lastRecord) return;
  lastSig = sig;
  const { input } = st.playWebInput(st.currentGraph?.name ?? 'Playfield');
  encoder.forceFull();
  await deliverRecord(await recordFor(input, true));
}

/**
 * The Play's structure: everything the web player is built from, less what
 * the frames carry anyway (the layers' and Finish effects' plain numbers) and
 * what it never reads (the mapping, takes, notes, the credit). A slider moving
 * a layer changes no structure, so the output isn't rebuilt under it.
 */
export function structureSig(play: PlayRecord): string {
  const strip = (o: object) => {
    const c: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) if (typeof v !== 'number') c[k] = v;
    return c;
  };
  const rest: Record<string, unknown> = { ...play, projection: 0, takes: 0, notes: 0, source: 0 };
  rest.layers = play.layers.map(strip);
  if (play.finish) rest.finish = { ...play.finish, effects: play.finish.effects.map(strip), compare: play.finish.compare ? strip(play.finish.compare) : undefined };
  return JSON.stringify(rest);
}

// Watch the store: a new shader, a new structure or new media → a new record; a new mapping → send it.
let watching = false;
function startWatching(): void {
  if (watching) return;
  watching = true;
  let prev = useNodeGraphStore.getState();
  useNodeGraphStore.subscribe(st => {
    const p = prev;
    prev = st;
    if (!link) return;
    if (st.play.projection !== p.play.projection || (snapshotPlay === null && st.play.layers !== p.play.layers)) sendMapping();
    if (useOutput.getState().source !== 'app') return;
    if (st.play !== p.play || st.fragmentShader !== p.fragmentShader || st.previewAspect !== p.previewAspect || st.paramBindings !== p.paramBindings
      || st.textureUniforms !== p.textureUniforms || st.nodeTextures !== p.nodeTextures || st.videoUniforms !== p.videoUniforms || st.isStateful !== p.isStateful
      || st.echoConfig !== p.echoConfig || st.datasets !== p.datasets) {
      // Only media, aspect or passes changing: always rebuild; the play or shader: only when the structure did.
      if (st.previewAspect !== p.previewAspect || st.nodeTextures !== p.nodeTextures || st.videoUniforms !== p.videoUniforms || st.textureUniforms !== p.textureUniforms || st.datasets !== p.datasets) lastSig = '';
      scheduleRecord();
    }
  });
  useOutput.subscribe((s, p) => { if (s.ui !== p.ui) send({ type: 'ui', ui: s.ui }); });
  playEngine.onAction(a => { if (link && useOutput.getState().connected && useOutput.getState().source === 'app') pendingActions.push({ do: a.do, layerId: a.layerId, amount: a.amount }); });
}

// ── Frames from the app's own picture ──────────────────────────────────────

const pendingActions: OutAction[] = [];
/** Uniforms the player works out itself, or can't take (samplers). */
const SKIP_UNIFORMS = /^(u_time|u_resolution|u_mouse|u_prevFrame|u_echo\d|u_padGrid\w*|u_padLast|u_layers\w*|u_fontTexture)$/;
type Uniforms = Record<string, THREE.IUniform>;
let uniformList: [string, THREE.IUniform][] = [];
let uniformSrc: Uniforms | null = null;
let layerKeys: [string, string, number][] = [];
let layerKeysOf: PlayRecord | null = null;
let lastFrameAt = 0;

function readValue(v: unknown): number | number[] | null {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (!v || typeof v !== 'object') return null;
  if (Array.isArray(v)) return v.every(x => typeof x === 'number') ? v.slice() : null;
  const o = v as { isColor?: boolean; r: number; g: number; b: number; x: number; y: number; z?: number; w?: number; isVector2?: boolean; isVector3?: boolean; isVector4?: boolean };
  if (o.isColor) return [o.r, o.g, o.b];
  if (o.isVector4) return [o.x, o.y, o.z!, o.w!];
  if (o.isVector3) return [o.x, o.y, o.z!];
  if (o.isVector2) return [o.x, o.y];
  return null;
}

/** Every plain number of every layer and Finish effect, as `<id>::<key>` → its base value in the record. */
function layerKeyList(play: PlayRecord): [string, string, number][] {
  const out: [string, string, number][] = [];
  for (const l of play.layers) for (const [k, v] of Object.entries(l)) if (typeof v === 'number') out.push([l.id, k, v]);
  for (const e of finishHosts(play.finish)) for (const [k, v] of Object.entries(e)) if (typeof v === 'number') out.push([finishPropId(e.id), k, v]);
  return out;
}

/**
 * Called by ShaderCanvas every animation frame: the clock, whether it runs,
 * the material's uniforms and the canvas. Sends a frame (at most ~60 a
 * second) when an output is listening and shows the app's picture.
 */
export function outputFrame(t: number, playing: boolean, uniforms: Uniforms, canvas: HTMLCanvasElement): void {
  if (!link || snapshotPlay !== null) return;
  const s = useOutput.getState();
  if (!s.connected || s.source !== 'app') return;
  const now = performance.now();
  if (now - lastFrameAt < 14) return;
  lastFrameAt = now;
  if (uniforms !== uniformSrc) {
    uniformSrc = uniforms;
    uniformList = Object.entries(uniforms).filter(([n, u]) => !SKIP_UNIFORMS.test(n) && readValue(u.value) !== null);
  }
  const u: ValueMap = {};
  for (const [n, un] of uniformList) { const v = readValue(un.value); if (v !== null) u[n] = v; }
  const play = useNodeGraphStore.getState().play;
  if (play !== layerKeysOf) { layerKeysOf = play; layerKeys = layerKeyList(play); }
  const l: ValueMap = {};
  for (const [id, k, base] of layerKeys) l[`${id}::${k}`] = playEngine.layerValue(id, k, base);
  const mu = uniforms.u_mouse?.value as { x: number; y: number } | undefined;
  const W = Math.max(1, canvas.width), H = Math.max(1, canvas.height);
  const pointer: [number, number, number, number] = mu ? [Math.max(0, Math.min(1, mu.x / W)), Math.max(0, Math.min(1, mu.y / H)), 0, mu.x || mu.y ? 1 : 0] : [0.5, 0.5, 0, 0];
  const actions = pendingActions.splice(0);
  send(encoder.encode(t, playing, u, l, pointer, actions));
}

// ── A Present snapshot on the Stage, to the output ─────────────────────────

let snapshotPlay: PlayRecord | null = null;
let snapshotRaf = 0;

interface FollowSource { feedOut(): { t: number; playing: boolean; pointer: [number, number, number, number]; uniforms: ValueMap; layers: ValueMap } }

/**
 * Show a Present canvas (the Stage's snapshot) on the output instead of the
 * app's picture: the output follows the Stage's Exact page (its clock, its
 * controls, its pointer). Null goes back to the app's picture. A snapshot
 * with someone else's Script layers runs sealed off, where the output can't
 * follow it, so it isn't sent.
 */
export async function showSnapshot(snap: { input: PlayHtmlInput; frame: () => HTMLIFrameElement | null; sandboxed: boolean } | null): Promise<void> {
  cancelAnimationFrame(snapshotRaf);
  if (!snap) {
    if (snapshotPlay === null) return;
    snapshotPlay = null;
    useOutput.setState({ source: 'app' });
    lastSig = '';
    sendMapping();
    scheduleRecord(0);
    return;
  }
  if (!requireFeature('play.output')) return;
  if (snap.sandboxed) {
    toast.warning('This canvas can’t go to the output', { message: 'Its Script layers are someone else’s code, so it runs sealed off from Playfield, where the output can’t follow it.' });
    return;
  }
  ensureLink();
  snapshotPlay = snap.input.play;
  useOutput.setState({ source: 'snapshot' });
  encoder.forceFull();
  await deliverRecord(await recordFor(snap.input, true));
  sendMapping();
  const tick = () => {
    snapshotRaf = requestAnimationFrame(tick);
    if (!useOutput.getState().connected) return;
    let m: FollowSource | undefined;
    try { m = (snap.frame()?.contentWindow as unknown as { __sspMount?: FollowSource } | null)?.__sspMount; } catch { m = undefined; }
    if (!m || typeof m.feedOut !== 'function') return;
    const f = m.feedOut();
    send(encoder.encode(f.t, f.playing, f.uniforms, f.layers, f.pointer));
  };
  snapshotRaf = requestAnimationFrame(tick);
}
