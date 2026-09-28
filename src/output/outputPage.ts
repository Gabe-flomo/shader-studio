/**
 * outputPage.ts — the output window (output.html): the picture alone, for a
 * projector or a second display, with the projection mapping as its last
 * pass (docs/projection.md).
 *
 * The Play runs here in the website player, in follow mode: the main window
 * sends the Play when its structure changes and each frame's clock, pointer,
 * uniforms, layer numbers and actions (protocol.ts). This page steps the
 * player once per animation frame, then warps its canvases onto the surfaces
 * (warpRenderer.ts). In edit mode the corners, mesh points and mask points
 * can be dragged here, on the projector itself.
 *
 * Keys: H handles on/off · P next test pattern · F full screen ·
 * arrows nudge 1 px (Shift 10) · ⌘Z / Ctrl+Z undo, with Shift redo · Esc
 * leaves edit mode.
 *
 * No framework and no store: this page never touches the app's saved data.
 */
import { ClockFollower, initialOutputState, reduceOutput, takeActions, type DownMsg, type OutputRecord, type OutputState } from './protocol';
import { getRecord, isDesktopApp, outputLink, setDesktopFullscreen } from './transport';
import { WarpRenderer, type WarpSources } from './warpRenderer';
import { arrowStep, drawHandles, handlesOf, hitTest, isOffView, moveHandle, nudge, sameRef, surfaceOf, type HandleRef } from './mappingEdit';
import { FrameLoop } from './frameLoop';
import { defaultProjection, displayProjection, TEST_PATTERNS, type ProjectionRecord } from '../types/projection';

interface PlayMount {
  destroy(): void;
  feed(f: unknown): void;
  step(now: number): void;
  showAlone(ids: string[]): void;
  canvases(): { picture: HTMLCanvasElement; layers: HTMLCanvasElement; finished: HTMLCanvasElement | null; layer(id: string): HTMLCanvasElement | null };
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const host = $<HTMLDivElement>('host');
const warpCanvas = $<HTMLCanvasElement>('warp');
const handleCanvas = $<HTMLCanvasElement>('handles');
const statusBox = $<HTMLDivElement>('status');
const statusText = $<HTMLSpanElement>('status-text');
const hint = $<HTMLDivElement>('hint');

const link = outputLink();
const clock = new ClockFollower();
const warp = new WarpRenderer(warpCanvas);
let state: OutputState = initialOutputState();

let mount: PlayMount | null = null;
let frame: HTMLIFrameElement | null = null;
let mountedRev = -1;
let mountedFor = '';
let fetching = false;

// ── Messages ────────────────────────────────────────────────────────────────

link.onMessage((m: DownMsg) => {
  const before = state;
  // While a handle is held here, our own drag is the truth: an echo of it (or of an older edit) waits.
  if (m.type === 'mapping' && drag) { pendingMapping = m; return; }
  state = reduceOutput(state, m, performance.now());
  if (m.type === 'frame') clock.update(m.t, m.playing, performance.now());
  if (m.type === 'mapping') localProjection = null;
  if (state.record !== before.record && state.record) void mountRecord(state.record);
  if (state.pendingRev !== null && !fetching) void fetchRecord();
  if (m.type === 'bye') showStatus('Playfield closed the output.', 'Close this window, or open the output again from Playfield.');
});
let pendingMapping: DownMsg | null = null;

async function fetchRecord(): Promise<void> {
  fetching = true;
  try {
    const r = await getRecord();
    if (r) state = reduceOutput(state, { type: 'record', record: r }, performance.now());
    if (state.record && state.record.rev !== mountedRev) void mountRecord(state.record);
  } finally { fetching = false; }
}

let lastHello = 0;
function hello(): void { lastHello = performance.now(); link.send({ type: 'hello' }); }
hello();

window.addEventListener('beforeunload', () => link.send({ type: 'closed' }));

// ── The player ──────────────────────────────────────────────────────────────

/**
 * The picture's pixels: as many as this screen has, at the Play's shape (a
 * Play of any shape: the window's), at most 4K. Sized from the screen, so
 * going full screen at the same shape doesn't rebuild it.
 */
function pixelSize(aspect: number | null): { w: number; h: number } {
  const dpr = window.devicePixelRatio || 1;
  const a = aspect ?? window.innerWidth / Math.max(1, window.innerHeight);
  let w = Math.round((window.screen?.width || window.innerWidth) * dpr), h = Math.round((window.screen?.height || window.innerHeight) * dpr);
  if (w / h > a) w = Math.round(h * a); else h = Math.round(w / a);
  const k = Math.min(1, Math.sqrt((3840 * 2160) / (w * h)));
  return { w: Math.max(2, Math.round(w * k)), h: Math.max(2, Math.round(h * k)) };
}

function page(scripts: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:#000;overflow:hidden}#play{width:100%;height:100%}</style></head><body><div id="play"></div><script>${scripts}</script></body></html>`;
}

/** Start the player on a new record; the old one keeps showing until the new one is up. */
async function mountRecord(r: OutputRecord): Promise<void> {
  const size = pixelSize(r.aspect);
  const key = `${r.rev}:${size.w}x${size.h}`;
  if (key === mountedFor) return;
  mountedFor = key;
  const f = document.createElement('iframe');
  f.title = 'Picture';
  f.setAttribute('aria-hidden', 'true');
  f.style.visibility = 'visible';
  const loaded = new Promise<void>(res => f.addEventListener('load', () => res(), { once: true }));
  f.srcdoc = page(r.scripts);
  host.append(f);
  await loaded;
  if (mountedFor !== key) { f.remove(); return; } // a newer record came in meanwhile
  const w = f.contentWindow as (Window & { ShaderStudioPlay?: { mount(el: HTMLElement, b: unknown, o: unknown): PlayMount } }) | null;
  const el = f.contentDocument?.getElementById('play');
  if (!w?.ShaderStudioPlay || !el) { showStatus('The picture didn’t start.', 'Its player failed to load here.'); return; }
  let m: PlayMount;
  try {
    m = w.ShaderStudioPlay.mount(el, r.bundle, { mode: 'player', panel: false, pointer: false, markers: false, follow: r.follow, stillForReducedMotion: false, pixelSize: size, fit: 'contain', maxDpr: 2 });
  } catch (e) { showStatus('The picture didn’t start.', String(e)); return; }
  const old = mount, oldFrame = frame;
  mount = m; frame = f; mountedRev = r.rev;
  fedU = null; fedL = null;
  try { old?.destroy(); } catch { /* already gone */ }
  oldFrame?.remove();
  hideStatus();
  document.title = `${r.title} · Playfield output`;
}

// A different screen (the window moved to another display): the picture's size follows.
let resizeTimer = 0;
window.addEventListener('resize', () => {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => { if (state.record) void mountRecord(state.record); }, 250);
});

// ── The frame ───────────────────────────────────────────────────────────────

let fedU: unknown = null, fedL: unknown = null;
let localProjection: ProjectionRecord | null = null;
const layerCanvases = new Map<string, HTMLCanvasElement>();
let frames = 0;

/** No mapping yet: one surface filling the output (made once, so its id stays put). */
const FALLBACK = defaultProjection();
/** The mapping as drawn and edited here: one that changes nothing shows the picture whole (letterboxed), not stretched. */
function projectionNow(): ProjectionRecord {
  const p = localProjection ?? state.projection ?? FALLBACK;
  const c = mount?.canvases();
  if (!c || !c.picture.height || !warpCanvas.height) return p;
  return displayProjection(p, c.picture.width / c.picture.height, warpCanvas.width / warpCanvas.height);
}

/** A layer-or-group surface's picture: its layers drawn alone, one over another. */
function surfaceLayerImage(id: string, c: ReturnType<PlayMount['canvases']>): HTMLCanvasElement | null {
  const ids = state.layers[id];
  if (!ids || !ids.length) return null;
  let out = layerCanvases.get(id);
  if (!out) { out = document.createElement('canvas'); layerCanvases.set(id, out); }
  if (out.width !== c.picture.width || out.height !== c.picture.height) { out.width = c.picture.width; out.height = c.picture.height; }
  const x = out.getContext('2d')!;
  x.clearRect(0, 0, out.width, out.height);
  for (const lid of ids) { const lc = c.layer(lid); if (lc && lc.width) x.drawImage(lc, 0, 0, out.width, out.height); }
  return out;
}

function loop(now: number): void {
  frames++;
  // A frame went missing (or none yet): ask for everything again, at most twice a second.
  if ((state.needsFull || !state.record) && now - lastHello > 500) hello();
  if (mount) {
    const f = state.follow;
    const taken = takeActions(state);
    state = taken.state;
    mount.feed({
      t: clock.at(now), playing: f.playing, pointer: f.pointer,
      uniforms: f.uniforms !== fedU ? f.uniforms : undefined,
      layers: f.layers !== fedL ? f.layers : undefined,
      actions: taken.actions,
    });
    fedU = f.uniforms; fedL = f.layers;
    mount.showAlone(Object.values(state.layers).flat());
    try { mount.step(now); } catch (e) { console.warn('[output] frame', e); }
  }
  // Size the warp canvas to the window in device pixels.
  const dpr = window.devicePixelRatio || 1;
  const W = Math.max(1, Math.round(window.innerWidth * dpr)), H = Math.max(1, Math.round(window.innerHeight * dpr));
  if (warpCanvas.width !== W || warpCanvas.height !== H) { warpCanvas.width = W; warpCanvas.height = H; }
  if (handleCanvas.width !== W || handleCanvas.height !== H) { handleCanvas.width = W; handleCanvas.height = H; }
  const p = projectionNow();
  const c = mount?.canvases();
  const sources: WarpSources = c
    ? { shader: c.picture, layers: c.layers, finished: c.finished, surfaceLayers: id => surfaceLayerImage(id, c) }
    : { shader: null, layers: null, finished: null };
  warp.render(p, sources, state.ui.pattern, state.ui.edit ? state.ui.selected : null);
  const hx = handleCanvas.getContext('2d')!;
  hx.clearRect(0, 0, W, H);
  if (state.ui.edit) drawHandles(hx, p, state.ui.selected, drag?.ref ?? activeRef, W, H, dpr);
  document.body.classList.toggle('editing', state.ui.edit);
  showHint();
}
// For a look from the console (and the app's own checks): the state and the player.
(window as unknown as { __pfOutput: unknown }).__pfOutput = { state: () => state, mount: () => mount, clock: () => clock.at(performance.now()) };
if (!warp.ok) showStatus('WebGL 2 isn’t available here.', 'The output needs it to draw the mapping.');
// Every animation frame of this window's own; when the browser holds those back (the app has focus and
// this window is counted as background, or the tab is hidden), a timer keeps the picture moving at ~30 fps.
new FrameLoop(loop, { fallbackHz: 30 }).start();

// ── Status back to the main window ─────────────────────────────────────────

setInterval(() => {
  link.send({ type: 'status', status: { width: warpCanvas.width, height: warpCanvas.height, fullscreen: isFullscreen(), fps: frames } });
  frames = 0;
}, 1000);

function isFullscreen(): boolean {
  return !!document.fullscreenElement || (window.innerWidth >= window.screen.width && window.innerHeight >= window.screen.height);
}

function showStatus(title: string, text: string): void {
  statusBox.hidden = false;
  statusBox.querySelector('b')!.textContent = title;
  statusText.textContent = text;
}
function hideStatus(): void { statusBox.hidden = true; }

let hintText = '';
function showHint(): void {
  const t = state.ui.edit
    ? 'Editing · drag corners and points · arrows nudge 1 px (Shift 10) · P test pattern · H hide handles · ⌘Z undo'
    : !isFullscreen() && !isDesktopApp() ? 'Press F or double-click for full screen' : '';
  if (t === hintText) return;
  hintText = t;
  hint.hidden = !t;
  hint.textContent = t;
}

// ── Editing on the output ──────────────────────────────────────────────────

let drag: { ref: HandleRef; start: ProjectionRecord; last: { x: number; y: number }; moved: boolean; relative: boolean } | null = null;
let activeRef: HandleRef | null = null;
let sendQueued = false;

function toUnit(e: PointerEvent): { x: number; y: number } {
  return { x: e.clientX / Math.max(1, window.innerWidth), y: e.clientY / Math.max(1, window.innerHeight) };
}

function queueEdit(): void {
  if (sendQueued) return;
  sendQueued = true;
  requestAnimationFrame(() => { sendQueued = false; if (localProjection) link.send({ type: 'edit', projection: localProjection, commit: false }); });
}

handleCanvas.addEventListener('pointerdown', e => {
  if (!state.ui.edit) return;
  const u = toUnit(e);
  const p = projectionNow();
  const ref = hitTest(p, state.ui.selected, u.x, u.y, window.innerWidth, window.innerHeight);
  activeRef = ref && ref.kind !== 'surface' && ref.kind !== 'maskBody' ? ref : null;
  const sid = surfaceOf(ref);
  if (sid && sid !== state.ui.selected) link.send({ type: 'ui', ui: { selected: sid } });
  if (!ref) return;
  // A handle grabbed at the edge (it lies off the projector) follows the pointer's movement, not its place.
  const spot = handlesOf(p, state.ui.selected).find(h => sameRef(h.ref, ref));
  drag = { ref, start: p, last: u, moved: false, relative: !!spot && isOffView(spot.x, spot.y) };
  handleCanvas.setPointerCapture(e.pointerId);
});
handleCanvas.addEventListener('pointermove', e => {
  if (!drag) return;
  const u = toUnit(e);
  const p = projectionNow();
  localProjection = drag.ref.kind === 'surface' || drag.ref.kind === 'maskBody' || drag.relative
    ? nudge(p, drag.ref, u.x - drag.last.x, u.y - drag.last.y)
    : moveHandle(p, drag.ref, u.x, u.y);
  drag.last = u;
  drag.moved = true;
  queueEdit();
});
const endDrag = () => {
  if (!drag) return;
  const d = drag;
  drag = null;
  if (d.moved && localProjection) link.send({ type: 'edit', projection: localProjection, commit: true });
  if (pendingMapping) { const m = pendingMapping; pendingMapping = null; state = reduceOutput(state, m, performance.now()); }
};
handleCanvas.addEventListener('pointerup', endDrag);
handleCanvas.addEventListener('pointercancel', endDrag);
handleCanvas.addEventListener('dblclick', () => { if (!state.ui.edit) void toggleFullscreen(); });

async function toggleFullscreen(): Promise<void> {
  if (isDesktopApp()) { await setDesktopFullscreen(!isFullscreen()).catch(() => {}); return; }
  if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
  else await document.documentElement.requestFullscreen().catch(() => {});
}

window.addEventListener('keydown', e => {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); link.send({ type: e.shiftKey ? 'redo' : 'undo' }); return; }
  if (mod) return;
  const k = e.key.toLowerCase();
  if (k === 'f') { void toggleFullscreen(); return; }
  if (k === 'h') { link.send({ type: 'ui', ui: { edit: !state.ui.edit } }); return; }
  if (k === 'p') {
    const i = TEST_PATTERNS.findIndex(t => t.id === state.ui.pattern);
    link.send({ type: 'ui', ui: { pattern: TEST_PATTERNS[(i + 1) % TEST_PATTERNS.length].id } });
    return;
  }
  if (e.key === 'Escape' && state.ui.edit) { link.send({ type: 'ui', ui: { edit: false } }); return; }
  if (!state.ui.edit) return;
  // Pixels of the output itself (the projector's), not CSS pixels.
  const step = arrowStep(e.key, e.shiftKey, warpCanvas.width, warpCanvas.height);
  if (!step) return;
  e.preventDefault();
  const p = projectionNow();
  const ref: HandleRef | null = activeRef ?? (state.ui.selected ? { kind: 'surface', surfaceId: state.ui.selected } : null);
  if (!ref) return;
  localProjection = nudge(p, ref, step.dx, step.dy);
  link.send({ type: 'edit', projection: localProjection, commit: true });
});

// Selecting another surface in the app lets go of the handle held here.
let lastSelected: string | null = null;
setInterval(() => { if (state.ui.selected !== lastSelected) { lastSelected = state.ui.selected; if (activeRef && surfaceOf(activeRef) !== lastSelected && activeRef.kind !== 'mask') activeRef = null; } }, 200);
