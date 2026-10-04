/**
 * PianoRoll — a MIDI clip's notes in an Ableton-style piano roll
 * (docs/piano-roll.md). Opens in the device area under the arrangement when
 * a MIDI clip is double-clicked (the Notes/Device switch there):
 *
 *   toolbar     Draw mode, the grid, fold, scale rows, zoom, Functions, Velocity
 *   functions   quantize, transpose, fit to scale, invert, reverse, legato,
 *               stretch, humanize, chop, join, duplicate (folded by default)
 *   keys        click to hear a note (and select its row's notes)
 *   ruler       bars.beats: drag up/down to zoom, sideways to scroll; the clip's
 *               brace on top (drag its ends to trim the clip)
 *   grid        the notes: select, ⇧-select, marquee; drag to move, ⌥-drag to
 *               copy, ⌘ ignores the grid; drag an edge to resize; B draws
 *   velocity    stems: drag, draw (B), type a value (folded by default)
 *
 * Every change is a pure operation (play/pianoRoll.ts) written back with
 * setTrackNotes as one undo step. Perf: the canvases are painted from a ref;
 * a drag paints its preview on an animation frame without re-rendering React,
 * and only the commit at the end touches the store.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useTokens } from '../../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../../theme/tokens';
import { IconButton } from '../../ui/Button';
import { Select } from '../../ui/Select';
import { Segmented, Toggle } from '../../ui/Choice';
import { toast } from '../../ui/toastStore';
import { NOTE_NAMES, SCALES, inScale, scaleOf } from '../../../play/scales';
import { formatLength, formatPosition, parsePosition, scaleBadge } from '../../../play/pianoRollWindow';
import {
  DEFAULT_GRID, GRID_DIVS, chopNotes, deleteNotes, drawVelocityLine, duplicateNotes, fitToScale, gridLabel, gridStep, humanizeNotes, invertNotes, joinNotes, legatoNotes,
  moveNotes, nudgeVelocity, pasteNotes, quantizeNotes, resizeNotes, reverseNotes, rollRows, selectRect, selectionSpan, setVelocity, splitNotes, stepGrid, stretchNotes,
  toggleNotesOff, transposeNotes, type FoldMode, type GridDiv, type GridSetting, type NoteEdit,
} from '../../../play/pianoRoll';
import {
  beatSeconds, emptyArrangement, recordBpm, setTrackNotes, trackClips, trimClip, type ArrClip, type ArrNote, type ArrScale, type PlayArrangement,
} from '../../../types/playArrangement';
import { patchRack, type AeRack } from '../../../types/playAudioEngine';
import { withEngine } from './engineOps';
import { audioEngineHost } from '../../../lib/audioEngineHost';
import { keyboardClaimed } from '../../../lib/keyboardClaim';
import { tape, useTape } from '../../../lib/tape';
import { useNodeGraphStore } from '../../../store/useNodeGraphStore';

/** An edit to the tape that is an undo step (as the lanes' edits are). */
function editArr(fn: (a: PlayArrangement) => PlayArrangement, label: string): void {
  useNodeGraphStore.getState().setPlay(p => ({ ...p, arrangement: fn(p.arrangement ?? emptyArrangement(recordBpm(p.mappings))) }), { label });
}

const KEYS_W = 52;
const RULER_H = 24;
const VEL_H = 64;
const VEL_H_WINDOW = 96;
const PANEL_W = 236;
const EDGE = 6;

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
};
const isBlack = (p: number) => [1, 3, 6, 8, 10].includes(p % 12);
/** Live's names: middle C (60) is C3. */
const noteName = (p: number) => `${NOTE_NAMES[p % 12]}${Math.floor(p / 12) - 2}`;

/** A folded section's open state, remembered per section. */
function useSection(id: string, def = false): [boolean, (v: boolean) => void] {
  const key = `shader-studio:pianoRoll:${id}`;
  const [open, setOpen] = useState(() => { try { const v = localStorage.getItem(key); return v === null ? def : v === '1'; } catch { return def; } });
  const set = useCallback((v: boolean) => { setOpen(v); try { localStorage.setItem(key, v ? '1' : '0'); } catch { /* private window */ } }, [key]);
  return [open, set];
}

function prep(c: HTMLCanvasElement | null, w: number, h: number): CanvasRenderingContext2D | null {
  if (!c || w <= 0 || h <= 0) return null;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
  const g = c.getContext('2d');
  if (!g) return null;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  return g;
}

interface View { t0: number; pps: number; top: number; rowH: number }

type Drag =
  | { kind: 'move'; base: ArrNote[]; sel: number[]; anchor: ArrNote; x0: number; row0: number; copy: boolean; moved: boolean; toggle: number }
  | { kind: 'resize'; base: ArrNote[]; sel: number[]; anchor: ArrNote; edge: 'start' | 'end'; x0: number }
  | { kind: 'marquee'; t0: number; p0: number; t1: number; p1: number; add: number[]; moved: boolean }
  | { kind: 'draw'; base: ArrNote[]; added: ArrNote[]; cells: Set<string> }
  | { kind: 'vel'; base: ArrNote[]; sel: number[]; y0: number }
  | { kind: 'velDraw'; base: ArrNote[]; t0: number; v0: number; line: boolean; set: Map<number, number> }
  | { kind: 'ruler'; x0: number; y0: number; view: View }
  | { kind: 'brace'; edge: 'start' | 'end'; clip: ArrClip; t: number };

export function PianoRoll({ rack, arr, anchor, color, touch, onAnchor, layout = 'panel' }: {
  rack: AeRack; arr: PlayArrangement; anchor: number; color: string; touch: boolean; onAnchor: (t: number) => void;
  /** 'window': the big editor (PianoRollWindow.tsx), with Live's clip panel on the left and the velocity lane open. */
  layout?: 'panel' | 'window';
}) {
  const win = layout === 'window';
  const tk = useTokens();
  const track = arr.tracks[rack.id];
  const notes = useMemo(() => track?.notes ?? [], [track]);
  const clips = useMemo(() => trackClips(track, arr.length), [track, arr.length]);
  const clipIndex = clips.findIndex(c => anchor >= c.t - 1e-6 && anchor < c.t + c.d - 1e-6);
  const clip = clips[clipIndex] as ArrClip | undefined;
  const bpm = arr.bpm;
  const scale = arr.scale?.on ? arr.scale : null;
  const phase = useTape(s => s.phase);
  const live = phase === 'recording' || phase === 'counting';

  const [draw, setDraw] = useState(false);
  const [splitTool, setSplitTool] = useState(false);
  const [grid, setGrid] = useState<GridSetting>(DEFAULT_GRID);
  const [fold, setFold] = useState<FoldMode>('none');
  const [tint, setTint] = useState(true);
  const [fnOpen, setFnOpen] = useSection(win ? 'window-functions' : 'functions');
  const [velOpen, setVelOpen] = useSection(win ? 'window-velocity' : 'velocity', win);
  // The window's clip panel: shown unless the screen is narrow (a phone), then a toolbar chip brings it.
  const [panelOpen, setPanelOpen] = useSection('window-panel', typeof window === 'undefined' || window.innerWidth >= 720);
  const [quant, setQuant] = useState({ amount: 100, ends: false });
  const [human, setHuman] = useState({ amount: 20, seed: 1 });
  const [chop, setChop] = useState(2);
  const [insert, setInsert] = useState<number | null>(null);
  const [cursor, setCursor] = useState('default');
  const rootRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLCanvasElement>(null), keysRef = useRef<HTMLCanvasElement>(null), rulerRef = useRef<HTMLCanvasElement>(null), velRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null), headRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const clipboard = useRef<ArrNote[]>([]);

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: Math.round(el.clientWidth), h: Math.round(el.clientHeight) }));
    ro.observe(el);
    setSize({ w: Math.round(el.clientWidth), h: Math.round(el.clientHeight) });
    return () => ro.disconnect();
  }, []);

  // The selection belongs to the notes it was made on: an edit from elsewhere (undo, a recording) clears it.
  const [selS, setSelS] = useState<{ of: readonly ArrNote[]; sel: number[] }>({ of: notes, sel: [] });
  const sel = selS.of === notes ? selS.sel : EMPTY;
  const setSel = (next: number[], of: readonly ArrNote[] = notes) => setSelS({ of, sel: next });

  const rows = useMemo(() => rollRows(notes, fold, scale), [notes, fold, scale]);
  const rowOf = useMemo(() => new Map(rows.map((p, i) => [p, i])), [rows]);
  const inClip = useCallback((i: number) => !!clip && notes[i] && notes[i].t >= clip.t - 1e-6 && notes[i].t < clip.t + clip.d - 1e-6, [clip, notes]);
  const clipIdx = useMemo(() => notes.map((_, i) => i).filter(inClip), [notes, inClip]);

  /** A view fitted to a time span (the clip by default) and a pitch range (the clip's notes by default) on `rws`. */
  const fitted = useCallback((rws: readonly number[], rowH: number, span?: { t0: number; t1: number; lo?: number; hi?: number }): View | null => {
    if (!clip || !size.w || !size.h) return null;
    // The clip, at least a bar of it (a short clip isn't blown up to fill the roll).
    const a = span?.t0 ?? clip.t, b = span?.t1 ?? clip.t + Math.max(clip.d, beatSeconds(bpm) * 4);
    const pad = (b - a) * 0.04;
    const pps = Math.max(4, Math.min(4000, size.w / Math.max(0.05, b - a + pad * 2)));
    const inside = clipIdx.map(i => notes[i].n);
    const mid = ((span?.lo ?? (inside.length ? Math.min(...inside) : 60)) + (span?.hi ?? (inside.length ? Math.max(...inside) : 72))) / 2;
    let row = 0;
    rws.forEach((p, i) => { if (Math.abs(p - mid) < Math.abs(rws[row] - mid)) row = i; });
    const vis = size.h / rowH;
    return { t0: a - pad, pps, rowH, top: Math.max(0, Math.min(rws.length - vis, row - vis / 2)) };
  }, [clip, size.w, size.h, clipIdx, notes, bpm]);
  // Until it's zoomed or scrolled, the view is the clip fitted.
  const [viewS, setView] = useState<View | null>(null);
  const autoView = useMemo(() => fitted(rows, touch ? 16 : 13), [fitted, rows, touch]);
  const view = viewS ?? autoView;
  const fit = (span?: { t0: number; t1: number; lo?: number; hi?: number }) => setView(fitted(rows, view?.rowH ?? (touch ? 16 : 13), span));
  /** F, G and the Rows switch: the rows change, the time span stays, the notes stay in sight. */
  const changeFold = (f: FoldMode) => {
    setFold(f);
    if (view) setView(fitted(rollRows(notes, f, scale), view.rowH, { t0: view.t0, t1: view.t0 + size.w / view.pps }));
  };
  const step = view ? gridStep(grid, bpm, view.pps) : 0;
  const beat = beatSeconds(bpm);
  const noteLen = step || beat;

  // ── Painting ──────────────────────────────────────────────────────────────

  const preview = useRef<{ notes: readonly ArrNote[]; sel: readonly number[] } | null>(null);
  const marquee = useRef<{ t0: number; t1: number; p0: number; p1: number } | null>(null);
  const velH = win ? VEL_H_WINDOW : VEL_H;
  const S = useRef({ notes, sel, view, rows, rowOf, clip, step, size, tint, scale, insert, color, tk, velOpen, velH });

  const paint = useCallback(() => {
    const s = S.current;
    const v = s.view;
    if (!v) return;
    const { w, h } = s.size;
    const ns = preview.current?.notes ?? s.notes;
    const sl = new Set(preview.current?.sel ?? s.sel);
    const x = (t: number) => (t - v.t0) * v.pps;
    const first = Math.max(0, Math.floor(v.top)), last = Math.min(s.rows.length - 1, Math.ceil(v.top + h / v.rowH));
    const y = (row: number) => (row - v.top) * v.rowH;
    const T = s.tk;
    const bar = beat * 4;
    const tEnd = v.t0 + w / v.pps;
    const editable = (n: ArrNote) => !!s.clip && n.t >= s.clip.t - 1e-6 && n.t < s.clip.t + s.clip.d - 1e-6;

    // The grid: rows (black keys darker, the scale tinted, its root stronger), the clip's span, the time lines.
    const g = prep(gridRef.current, w, h);
    if (g) {
      for (let r = first; r <= last; r++) {
        const p = s.rows[r];
        g.fillStyle = isBlack(p) ? alpha('#000', 0.16) : alpha('#fff', 0.015);
        g.fillRect(0, y(r), w, v.rowH);
        if (s.tint && s.scale && inScale(p, s.scale.name, s.scale.root)) {
          g.fillStyle = alpha(T.accent.base, (p - s.scale.root) % 12 === 0 ? 0.2 : 0.08);
          g.fillRect(0, y(r), w, v.rowH);
        }
        g.fillStyle = alpha(T.text.primary, p % 12 === 0 ? 0.14 : 0.05);
        g.fillRect(0, Math.round(y(r) + v.rowH) - 1, w, 1);
      }
      if (s.step > 0) {
        const k0 = Math.floor(v.t0 / s.step), k1 = Math.ceil(tEnd / s.step);
        for (let k = k0; k <= k1 && k - k0 < 4000; k++) {
          const t = k * s.step, onBar = Math.abs(t / bar - Math.round(t / bar)) < 1e-6, onBeat = Math.abs(t / beat - Math.round(t / beat)) < 1e-6;
          g.fillStyle = alpha(T.text.primary, onBar ? 0.2 : onBeat ? 0.1 : 0.045);
          g.fillRect(Math.round(x(t)), 0, 1, h);
        }
      } else {
        for (let b = Math.max(0, Math.floor(v.t0 / bar)); b * bar <= tEnd; b++) { g.fillStyle = alpha(T.text.primary, 0.2); g.fillRect(Math.round(x(b * bar)), 0, 1, h); }
      }
      if (s.clip) {
        g.fillStyle = alpha('#000', 0.28);
        g.fillRect(0, 0, Math.max(0, x(s.clip.t)), h);
        g.fillRect(x(s.clip.t + s.clip.d), 0, w, h);
      }
      // The notes: velocity as strength, the selection outlined, deactivated ones grey, other clips' faint.
      ns.forEach((n, i) => {
        const r = s.rowOf.get(n.n);
        if (r === undefined || r < first - 1 || r > last + 1) return;
        const a = x(n.t), b = x(n.t + n.d);
        if (b < 0 || a > w) return;
        const mine = editable(n);
        const on = sl.has(i);
        const c = n.off ? T.text.faint : s.color;
        g.globalAlpha = mine ? 1 : 0.3;
        g.fillStyle = alpha(c, n.off ? 0.35 : 0.35 + 0.6 * n.v);
        const ny = y(r) + 1, nh = Math.max(2, v.rowH - 2), nw = Math.max(3, b - a - 1);
        g.beginPath(); g.roundRect(a + 0.5, ny, nw, nh, Math.min(3, nh / 3)); g.fill();
        g.lineWidth = on ? 1.5 : 1;
        g.strokeStyle = on ? T.text.primary : alpha('#000', 0.45);
        g.stroke();
        if (v.rowH >= 13 && nw > 26) {
          g.fillStyle = on ? T.text.primary : alpha('#000', 0.7);
          g.font = `600 9.5px ${fontFamily.ui}`;
          g.textBaseline = 'middle';
          g.fillText(noteName(n.n), a + 4, ny + nh / 2 + 0.5, nw - 6);
        }
        g.globalAlpha = 1;
      });
      const m = marquee.current;
      if (m) {
        const r0 = s.rowOf.get(m.p0) ?? 0, r1 = s.rowOf.get(m.p1) ?? 0;
        const ya = y(Math.min(r0, r1)), yb = y(Math.max(r0, r1) + 1);
        g.fillStyle = alpha(T.accent.base, 0.12); g.strokeStyle = alpha(T.accent.base, 0.8); g.lineWidth = 1;
        g.fillRect(x(Math.min(m.t0, m.t1)), ya, Math.abs(x(m.t1) - x(m.t0)), yb - ya);
        g.strokeRect(x(Math.min(m.t0, m.t1)) + 0.5, ya + 0.5, Math.abs(x(m.t1) - x(m.t0)), yb - ya);
      }
      if (s.insert !== null) { g.fillStyle = alpha(T.text.primary, 0.55); g.fillRect(Math.round(x(s.insert)), 0, 1, h); }
    }

    // The keys: white and black, C's named (and every key when there's room), the scale's keys marked.
    const kg = prep(keysRef.current, KEYS_W, h);
    if (kg) {
      for (let r = first; r <= last; r++) {
        const p = s.rows[r], blk = isBlack(p);
        kg.fillStyle = blk ? '#1d1d22' : '#e9e9ee';
        kg.fillRect(0, y(r), KEYS_W, v.rowH);
        kg.fillStyle = alpha('#000', 0.35);
        kg.fillRect(0, Math.round(y(r) + v.rowH) - 1, KEYS_W, 1);
        if (s.tint && s.scale && inScale(p, s.scale.name, s.scale.root)) {
          kg.fillStyle = (p - s.scale.root) % 12 === 0 ? T.accent.base : alpha(T.accent.base, 0.6);
          kg.fillRect(KEYS_W - 4, y(r) + 1, 3, Math.max(1, v.rowH - 2));
        }
        if (v.rowH >= 9 && (p % 12 === 0 || v.rowH >= 14 || s.rows.length < 128)) {
          kg.fillStyle = blk ? '#c9c9d0' : '#3a3a42';
          kg.font = `${p % 12 === 0 ? 700 : 500} ${Math.min(10, v.rowH - 2)}px ${fontFamily.ui}`;
          kg.textBaseline = 'middle';
          kg.fillText(noteName(p), 5, y(r) + v.rowH / 2 + 0.5);
        }
      }
    }

    // The ruler: bars (and beats when there's room), the clip's brace on top.
    const rg = prep(rulerRef.current, w, RULER_H);
    if (rg) {
      rg.fillStyle = T.bg.field; rg.fillRect(0, 0, w, RULER_H);
      const pxBeat = beat * v.pps;
      const everyBar = Math.max(1, Math.pow(2, Math.ceil(Math.log2(Math.max(1, 40 / (pxBeat * 4))))));
      rg.font = `10px ${fontFamily.mono}`; rg.textBaseline = 'alphabetic';
      for (let b = Math.max(0, Math.floor(v.t0 / bar)); b * bar <= tEnd; b++) {
        const bx = Math.round(x(b * bar));
        if (b % everyBar === 0) { rg.fillStyle = T.border.strong; rg.fillRect(bx, 8, 1, RULER_H - 8); rg.fillStyle = T.text.muted; rg.fillText(String(b + 1), bx + 3, RULER_H - 4); }
        if (pxBeat >= 28) for (let k = 1; k < 4; k++) {
          const tx = Math.round(x(b * bar + k * beat));
          rg.fillStyle = T.border.default; rg.fillRect(tx, RULER_H - 6, 1, 6);
          if (pxBeat >= 48) { rg.fillStyle = T.text.faint; rg.fillText(`${b + 1}.${k + 1}`, tx + 3, RULER_H - 4); }
        }
      }
      if (s.clip) {
        const a = x(s.clip.t), b = x(s.clip.t + s.clip.d);
        rg.fillStyle = alpha(s.color, 0.85);
        rg.fillRect(a, 0, Math.max(2, b - a), 6);
        rg.fillRect(a, 0, 3, 11); rg.fillRect(b - 3, 0, 3, 11);
      }
    }

    // Velocity: a stem per note in the clip (the selection brighter).
    if (s.velOpen) {
      const vg = prep(velRef.current, w, s.velH);
      if (vg) {
        vg.fillStyle = T.bg.field; vg.fillRect(0, 0, w, s.velH);
        vg.fillStyle = alpha(T.text.primary, 0.06);
        for (const f of [0.25, 0.5, 0.75]) vg.fillRect(0, Math.round(s.velH - 4 - f * (s.velH - 10)), w, 1);
        ns.forEach((n, i) => {
          if (!editable(n)) return;
          const sx = x(n.t);
          if (sx < -4 || sx > w + 4) return;
          const on = sl.has(i), top = s.velH - 4 - n.v * (s.velH - 10);
          vg.fillStyle = n.off ? T.text.faint : on ? T.text.primary : alpha(s.color, 0.9);
          vg.fillRect(Math.round(sx), top, on ? 2 : 1.5, s.velH - 4 - top);
          vg.beginPath(); vg.arc(sx + 1, top, on ? 3.5 : 3, 0, Math.PI * 2); vg.fill();
        });
      }
    }
  }, [beat]);

  // What the painters read, kept current; then a paint.
  useLayoutEffect(() => {
    S.current = { notes, sel, view, rows, rowOf, clip, step, size, tint, scale, insert, color, tk, velOpen, velH };
    paint();
  }, [paint, notes, sel, view, rows, rowOf, clip, step, size, tint, scale, insert, color, tk, velOpen, velH]);
  const raf = useRef(0);
  const repaint = () => { if (!raf.current) raf.current = requestAnimationFrame(() => { raf.current = 0; paint(); }); };
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  // The playhead, on its own frame while the tape runs.
  useEffect(() => {
    const el = headRef.current;
    if (!el) return;
    const place = () => { const v = S.current.view; if (!v) return; const px = (tape.position() - v.t0) * v.pps; el.style.transform = `translateX(${px}px)`; el.style.opacity = px < 0 || px > S.current.size.w ? '0' : '0.8'; };
    place();
    if (phase === 'stopped') return;
    let r = 0;
    const loop = () => { place(); r = requestAnimationFrame(loop); };
    r = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(r);
  }, [phase, view, size.w]);

  // ── Geometry ──────────────────────────────────────────────────────────────

  const local = (e: { clientX: number; clientY: number }, el: HTMLElement | null) => { const r = el!.getBoundingClientRect(); return { px: e.clientX - r.left, py: e.clientY - r.top }; };
  const timeAt = (px: number) => (view ? view.t0 + px / view.pps : 0);
  const rowAt = (py: number) => (view ? Math.max(0, Math.min(rows.length - 1, Math.floor(view.top + py / view.rowH))) : 0);
  const hitNote = (px: number, py: number): { i: number; edge: 'start' | 'end' | null } | null => {
    if (!view) return null;
    const p = rows[rowAt(py)];
    for (let k = clipIdx.length - 1; k >= 0; k--) {
      const i = clipIdx[k], n = notes[i];
      if (n.n !== p) continue;
      const a = (n.t - view.t0) * view.pps, b = (n.t + n.d - view.t0) * view.pps;
      if (px < a - 1 || px > Math.max(b, a + 3) + 1) continue;
      const wide = b - a > EDGE * 2.5;
      return { i, edge: wide && px - a < EDGE ? 'start' : wide && b - px < EDGE ? 'end' : null };
    }
    return null;
  };
  /** A drag's time moved so `t0` lands on the grid (⌘: free). */
  const snapDelta = (t0: number, raw: number, free: boolean) => (free || !step ? raw : Math.round((t0 + raw) / step) * step - t0);

  // ── Committing ────────────────────────────────────────────────────────────

  const commit = (e: { notes: readonly ArrNote[]; sel: readonly number[] }, label: string) => {
    let next: number[] = [];
    let made: readonly ArrNote[] = notes;
    editArr(a => {
      const r = setTrackNotes(a, rack.id, e.notes, clipIndex);
      next = e.sel.map(i => r.index[i]).filter(i => i >= 0);
      made = r.arr.tracks[rack.id].notes;
      return r.arr;
    }, `${label} on ${rack.name}`);
    setSel(next, made);
  };
  /** An operation on the selection, or every note in the clip when nothing is selected. */
  const run = (op: (ns: readonly ArrNote[], s: readonly number[]) => NoteEdit, label: string) => {
    if (live) return;
    const s = sel.length ? sel : clipIdx;
    if (!s.length) { toast.info('No notes in this clip'); return; }
    commit(op(notes, s), label);
  };
  const audition = (n: number, ms = 220) => {
    if (live) return;
    audioEngineHost.input(rack.id, [0x90, n, 100]);
    window.setTimeout(() => audioEngineHost.input(rack.id, [0x80, n, 0]), ms);
  };

  // ── The grid's pointer ────────────────────────────────────────────────────

  const drag = useRef<Drag | null>(null);
  const capture = (e: React.PointerEvent, onMove: (ev: PointerEvent) => void, onUp: (ev: PointerEvent) => void) => {
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const up = (ev: PointerEvent) => { el.removeEventListener('pointermove', onMove); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); onUp(ev); };
    el.addEventListener('pointermove', onMove); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  };

  const onGridDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0 || !view || !clip || live) return;
    rootRef.current?.focus({ preventScroll: true });
    const { px, py } = local(e, e.currentTarget);
    const hit = hitNote(px, py);
    const t = timeAt(px);
    if (splitTool) {
      if (hit) commit(splitNotes(notes, sel.includes(hit.i) ? sel : [hit.i], step && !e.metaKey ? Math.round(t / step) * step : t), 'Split notes');
      return;
    }
    if (draw) {
      // Draw mode: a note deletes; empty cells fill with notes a grid step long as you drag.
      if (hit) { commit(deleteNotes(notes, [hit.i]), 'Deleted a note'); return; }
      const d: Drag = { kind: 'draw', base: [...notes], added: [], cells: new Set() };
      const add = (cx: number, cy: number) => {
        const tt = Math.max(clip.t, step ? Math.floor(timeAt(cx) / step) * step : timeAt(cx)), p = rows[rowAt(cy)];
        const key = `${Math.round(tt * 1e4)}:${p}`;
        if (d.cells.has(key)) return;
        d.cells.add(key);
        d.added.push({ t: tt, n: p, v: 0.8, d: noteLen });
        if (d.added.length === 1 || d.added[d.added.length - 2].n !== p) audition(p, 160);
        const all = [...d.base, ...d.added].sort((a, b) => a.t - b.t || a.n - b.n);
        preview.current = { notes: all, sel: d.added.map(x => all.indexOf(x)) };
        repaint();
      };
      add(px, py);
      drag.current = d;
      capture(e, ev => { const q = local(ev, gridRef.current); add(q.px, q.py); }, () => {
        drag.current = null;
        const all = [...d.base, ...d.added];
        preview.current = null;
        commit({ notes: all, sel: d.added.map((_, k) => d.base.length + k) }, d.added.length > 1 ? 'Drew notes' : 'Added a note');
      });
      return;
    }
    if (hit) {
      // A note: select it (⇧ adds or takes away), then drag the selection; its edge resizes.
      const already = sel.includes(hit.i);
      const s = e.shiftKey ? (already ? sel : [...sel, hit.i]) : already ? sel : [hit.i];
      if (!already || !e.shiftKey) setSel(s);
      const n0 = notes[hit.i];
      audition(n0.n);
      if (hit.edge) {
        drag.current = { kind: 'resize', base: [...notes], sel: s, anchor: n0, edge: hit.edge, x0: px };
      } else {
        drag.current = { kind: 'move', base: [...notes], sel: s, anchor: n0, x0: px, row0: rowAt(py), copy: e.altKey, moved: false, toggle: e.shiftKey && already ? hit.i : -1 };
      }
      let lastN = n0.n;
      capture(e, ev => {
        const d = drag.current;
        const q = local(ev, gridRef.current);
        if (!d) return;
        if (d.kind === 'resize') {
          const edgeT = d.edge === 'end' ? d.anchor.t + d.anchor.d : d.anchor.t;
          const dt = snapDelta(edgeT, (q.px - d.x0) / view.pps, ev.metaKey);
          preview.current = resizeNotes(d.base, d.sel, d.edge, dt, Math.min(NOTE_MIN_DRAW, step || NOTE_MIN_DRAW));
        } else if (d.kind === 'move') {
          if (!d.moved && Math.abs(q.px - d.x0) < 3 && rowAt(q.py) === d.row0) return;
          d.moved = true;
          const dt = snapDelta(d.anchor.t, (q.px - d.x0) / view.pps, ev.metaKey);
          const r = rowAt(q.py);
          const dn = rows[r] - rows[d.row0];
          preview.current = moveNotes(d.base, d.sel, dt, dn, d.copy);
          if (rows[r] !== lastN) { lastN = rows[r]; audition(Math.max(0, Math.min(127, n0.n + dn)), 160); }
        }
        repaint();
      }, () => {
        const d = drag.current;
        drag.current = null;
        const p = preview.current;
        preview.current = null;
        if (d?.kind === 'move' && !d.moved) {
          if (d.toggle >= 0) setSel(sel.filter(i => i !== d.toggle));
          repaint();
          return;
        }
        if (p && d) commit(p, d.kind === 'resize' ? 'Resized notes' : d.kind === 'move' && d.copy ? 'Copied notes' : 'Moved notes');
        else repaint();
      });
      return;
    }
    // Empty: the insert marker, and a marquee (⇧ adds to the selection).
    const p0 = rows[rowAt(py)];
    const d: Drag = { kind: 'marquee', t0: t, p0, t1: t, p1: p0, add: e.shiftKey ? sel : [], moved: false };
    drag.current = d;
    capture(e, ev => {
      const q = local(ev, gridRef.current);
      d.t1 = timeAt(q.px); d.p1 = rows[rowAt(q.py)]; d.moved = true;
      marquee.current = { t0: d.t0, t1: d.t1, p0: d.p0, p1: d.p1 };
      const picked = selectRect(notes, d.t0, d.t1, d.p0, d.p1, inClip);
      preview.current = { notes, sel: [...new Set([...d.add, ...picked])] };
      repaint();
    }, () => {
      drag.current = null;
      marquee.current = null;
      const p = preview.current;
      preview.current = null;
      if (d.moved && p) setSel([...p.sel]);
      else { if (!e.shiftKey) setSel([]); setInsert(step ? Math.round(t / step) * step : t); }
      repaint();
    });
  };

  const onGridDouble = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (draw || splitTool || !view || !clip || live) return;
    const { px, py } = local(e, e.currentTarget);
    const hit = hitNote(px, py);
    if (hit) { commit(deleteNotes(notes, [hit.i]), 'Deleted a note'); return; }
    const t = Math.max(clip.t, step && !e.metaKey ? Math.floor(timeAt(px) / step) * step : timeAt(px));
    const n: ArrNote = { t, n: rows[rowAt(py)], v: 0.8, d: noteLen };
    commit({ notes: [...notes, n], sel: [notes.length] }, 'Added a note');
  };

  const onGridHover = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.buttons) return;
    const { px, py } = local(e, e.currentTarget);
    const hit = hitNote(px, py);
    setCursor(splitTool ? (hit ? 'col-resize' : 'default') : draw ? (hit ? 'not-allowed' : 'crosshair') : hit ? (hit.edge ? 'ew-resize' : 'grab') : 'default');
  };

  // Wheel: scroll pitch (⇧ or sideways: time), ⌘/⌃ zooms time around the pointer, ⌥ zooms the rows.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      const v = S.current.view;
      if (!v) return;
      e.preventDefault();
      const r = el.getBoundingClientRect(), px = e.clientX - r.left;
      if (e.metaKey || e.ctrlKey) {
        const f = Math.exp(-e.deltaY * 0.004), pps = Math.max(4, Math.min(4000, v.pps * f)), at = v.t0 + px / v.pps;
        setView({ ...v, pps, t0: at - px / pps });
      } else if (e.altKey) {
        const rowH = Math.max(5, Math.min(30, v.rowH * Math.exp(-e.deltaY * 0.004)));
        setView({ ...v, rowH, top: Math.max(0, Math.min(S.current.rows.length - S.current.size.h / rowH, v.top)) });
      } else {
        const dx = e.shiftKey ? e.deltaY : e.deltaX, dy = e.shiftKey ? 0 : e.deltaY;
        setView({ ...v, t0: v.t0 + dx / v.pps, top: Math.max(0, Math.min(S.current.rows.length - S.current.size.h / v.rowH, v.top + dy / v.rowH)) });
      }
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, []);

  // ── The keys, the ruler, the velocity lane ────────────────────────────────

  const onKeysDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!view) return;
    rootRef.current?.focus({ preventScroll: true });
    let held = rows[rowAt(local(e, e.currentTarget).py)];
    if (!live) audioEngineHost.input(rack.id, [0x90, held, 100]);
    // Clicking a key selects its row's notes in the clip (⇧ adds), as in Live.
    const row = clipIdx.filter(i => notes[i].n === held);
    setSel(e.shiftKey ? [...new Set([...sel, ...row])] : row);
    capture(e, ev => {
      const p = rows[rowAt(local(ev, keysRef.current).py)];
      if (p === held || live) return;
      audioEngineHost.input(rack.id, [0x80, held, 0]);
      held = p;
      audioEngineHost.input(rack.id, [0x90, held, 100]);
    }, () => { if (!live) audioEngineHost.input(rack.id, [0x80, held, 0]); });
  };

  const onRulerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!view) return;
    rootRef.current?.focus({ preventScroll: true });
    const { px, py } = local(e, e.currentTarget);
    if (clip && py <= 11 && !live) {
      const a = (clip.t - view.t0) * view.pps, b = (clip.t + clip.d - view.t0) * view.pps;
      const edge = Math.abs(px - a) <= 6 ? 'start' : Math.abs(px - b) <= 6 ? 'end' : null;
      if (edge) {
        // The brace's ends trim the clip (as on the lane).
        const d: Drag = { kind: 'brace', edge, clip, t: edge === 'start' ? clip.t : clip.t + clip.d };
        drag.current = d;
        capture(e, ev => {
          const t = timeAt(local(ev, rulerRef.current).px);
          d.t = step && !ev.metaKey ? Math.round(t / step) * step : t;
          S.current.clip = edge === 'start' ? { ...clip, t: Math.min(d.t, clip.t + clip.d - 0.05), d: clip.t + clip.d - Math.min(d.t, clip.t + clip.d - 0.05) } : { ...clip, d: Math.max(0.05, d.t - clip.t) };
          paint();
        }, () => {
          drag.current = null;
          const from = edge === 'start' ? d.t : clip.t, to = edge === 'start' ? clip.t + clip.d : d.t;
          if (Math.abs(d.t - (edge === 'start' ? clip.t : clip.t + clip.d)) > 1e-6) {
            editArr(a => trimClip(a, rack.id, clipIndex, from, to), `Trimmed a clip on ${rack.name}`);
            if (edge === 'start') onAnchor(Math.max(0, from));
          } else paint();
        });
        return;
      }
    }
    // Drag down to zoom in (around where you grabbed), sideways to scroll.
    const v0 = view, at = v0.t0 + px / v0.pps;
    capture(e, ev => {
      const q = local(ev, rulerRef.current);
      const pps = Math.max(4, Math.min(4000, v0.pps * Math.exp((q.py - py) * 0.012)));
      setView({ ...v0, pps, t0: at - q.px / pps });
    }, () => {});
  };

  const stemAt = (px: number): number => {
    if (!view) return -1;
    let best = -1, bd = 7;
    for (const i of clipIdx) {
      const d = Math.abs((notes[i].t - view.t0) * view.pps - px) - (sel.includes(i) ? 1 : 0);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  };
  const velAt = (py: number) => Math.max(0.01, Math.min(1, (velH - 4 - py) / (velH - 10)));
  const onVelDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!view || live) return;
    rootRef.current?.focus({ preventScroll: true });
    const { px, py } = local(e, e.currentTarget);
    if (draw) {
      // Draw velocities freehand; ⇧ draws a straight ramp from where you started.
      const d: Drag = { kind: 'velDraw', base: [...notes], t0: timeAt(px), v0: velAt(py), line: e.shiftKey, set: new Map() };
      const paintAt = (qx: number, qy: number) => {
        const t = timeAt(qx), v = velAt(qy);
        if (d.line) {
          const a = Math.min(d.t0, t), b = Math.max(d.t0, t);
          const idx = clipIdx.filter(i => d.base[i].t >= a && d.base[i].t <= b);
          preview.current = drawVelocityLine(d.base, idx, d.t0, d.v0, t, v);
        } else {
          const i = stemAt(qx);
          if (i >= 0) d.set.set(i, v);
          const ns = d.base.map((n, k) => (d.set.has(k) ? { ...n, v: d.set.get(k)! } : n));
          preview.current = { notes: ns, sel };
        }
        repaint();
      };
      paintAt(px, py);
      capture(e, ev => { const q = local(ev, velRef.current); paintAt(q.px, q.py); }, () => {
        const p = preview.current;
        preview.current = null;
        if (p) commit({ notes: [...p.notes], sel }, 'Drew velocities');
      });
      return;
    }
    const i = stemAt(px);
    if (i < 0) { if (!e.shiftKey) setSel([]); return; }
    const s = sel.includes(i) ? sel : e.shiftKey ? [...sel, i] : [i];
    setSel(s);
    const d: Drag = { kind: 'vel', base: [...notes], sel: s, y0: py };
    capture(e, ev => {
      const q = local(ev, velRef.current);
      preview.current = nudgeVelocity(d.base, d.sel, (d.y0 - q.py) / (velH - 10));
      repaint();
    }, () => {
      const p = preview.current;
      preview.current = null;
      if (p) commit(p, 'Changed velocity'); else repaint();
    });
  };

  // ── Keys ──────────────────────────────────────────────────────────────────

  const zoomBy = (f: number) => { if (!view) return; const mid = view.t0 + size.w / view.pps / 2, pps = Math.max(4, Math.min(4000, view.pps * f)); setView({ ...view, pps, t0: mid - size.w / pps / 2 }); };
  const zoomSel = () => { const sp = selectionSpan(notes, sel); if (sp) fit(sp); else fit(); };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (isTyping(e.target) || keyboardClaimed(e.nativeEvent) || live) return;
    const mod = e.metaKey || e.ctrlKey, k = e.key.toLowerCase();
    const done = () => { e.preventDefault(); e.stopPropagation(); };
    const s = sel.filter(i => notes[i]);
    if (mod && !e.altKey) {
      if (k === 'a') { done(); setSel(clipIdx); }
      else if (k === 'd') { done(); run((ns, x) => duplicateNotes(ns, x, step), 'Duplicated notes'); }
      else if (k === 'e') { done(); run((ns, x) => chopNotes(ns, x, chop), 'Chopped notes'); }
      else if (k === 'j') { done(); run(joinNotes, 'Joined notes'); }
      else if (k === 'u' && e.shiftKey) { done(); setFnOpen(true); }
      else if (k === 'u') { done(); run((ns, x) => quantizeNotes(ns, x, step || beat / 4, quant.amount / 100, quant.ends), 'Quantized notes'); }
      else if (k === 'c' && s.length) { done(); clipboard.current = s.map(i => notes[i]); }
      else if (k === 'x' && s.length) { done(); clipboard.current = s.map(i => notes[i]); commit(deleteNotes(notes, s), 'Cut notes'); }
      else if (k === 'v' && clipboard.current.length) { done(); commit(pasteNotes(notes, clipboard.current, insert ?? selectionSpan(notes, s)?.t1 ?? clip?.t ?? 0), 'Pasted notes'); }
      else if (k === '1') { done(); setGrid(g => stepGrid(g, -1)); }
      else if (k === '2') { done(); setGrid(g => stepGrid(g, 1)); }
      else if (k === '3') { done(); setGrid(g => ({ ...g, triplet: !g.triplet })); }
      else if (k === '4') { done(); setGrid(g => (g.div === 'off' ? { ...g, div: 'adaptive' } : { ...g, div: 'off' })); }
      else if ((k === 'arrowleft' || k === 'arrowright') && s.length) { done(); commit(moveNotes(notes, s, (k === 'arrowleft' ? -1 : 1) * 0.01, 0), 'Nudged notes'); }
      return;
    }
    if (e.altKey) return;
    if (k === 'arrowleft' || k === 'arrowright') {
      if (!s.length) return;
      done();
      const by = (k === 'arrowleft' ? -1 : 1) * (step || beat / 4);
      commit(e.shiftKey ? resizeNotes(notes, s, 'end', by, Math.min(NOTE_MIN_DRAW, step || NOTE_MIN_DRAW)) : moveNotes(notes, s, by, 0), e.shiftKey ? 'Resized notes' : 'Moved notes');
    } else if (k === 'arrowup' || k === 'arrowdown') {
      if (!s.length) return;
      done();
      const by = (k === 'arrowdown' ? -1 : 1) * (e.shiftKey ? 12 : 1);
      const ed = transposeNotes(notes, s, by);
      commit(ed, 'Transposed notes');
      if (ed.sel.length) audition(ed.notes[ed.sel[0]].n, 160);
    } else if (k === 'delete' || k === 'backspace') { done(); if (s.length) commit(deleteNotes(notes, s), 'Deleted notes'); } // never the arrangement's clip
    else if (k === 'escape') {
      // Nothing to let go of: Esc goes on (the window closes).
      if (!sel.length && !draw && !splitTool) return;
      done(); setSel([]); setDraw(false); setSplitTool(false);
    }
    else if (k === '0' && s.length) { done(); commit(toggleNotesOff(notes, s), 'Deactivated notes'); }
    else if (k === 'b') { done(); setDraw(d => !d); setSplitTool(false); }
    else if (k === 'e') { done(); setSplitTool(d => !d); setDraw(false); }
    else if (k === 'f') { done(); changeFold(fold === 'notes' ? 'none' : 'notes'); }
    else if (k === 'g') { done(); if (!scale) toast.info('Pick a scale in the transport first'); else changeFold(fold === 'scale' ? 'none' : 'scale'); }
    else if (k === 'k') { done(); setTint(t => !t); }
    else if (k === '+' || k === '=') { done(); zoomBy(1.4); }
    else if (k === '-' || k === '_') { done(); zoomBy(1 / 1.4); }
    else if (k === 'z') { done(); zoomSel(); }
    else if (k === 'x') { done(); fit(); }
  };

  // ── Toolbar ───────────────────────────────────────────────────────────────

  const btnH = touch ? 30 : 24;
  const selNotes = sel.filter(i => notes[i]).map(i => notes[i]);
  const velShown = selNotes.length ? (selNotes.every(n => Math.round(n.v * 127) === Math.round(selNotes[0].v * 127)) ? String(Math.round(selNotes[0].v * 127)) : '') : '';
  const target = sel.length ? `${sel.length} selected` : `all ${clipIdx.length} in the clip`;
  const gridOptions = [{ value: 'adaptive', label: `Adaptive (${gridLabel(step, bpm, grid.triplet)})` }, ...GRID_DIVS.map(d => ({ value: d, label: d })), { value: 'off', label: 'Off' }];
  const bars = clip ? `bars ${Math.floor(clip.t / (beat * 4)) + 1}–${Math.max(Math.floor(clip.t / (beat * 4)) + 1, Math.ceil((clip.t + clip.d) / (beat * 4) - 1e-6))}` : '';

  if (!clip) {
    return <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: tk.text.faint, font: `12px ${fontFamily.ui}`, padding: 16, textAlign: 'center' }}>This clip is gone. Double-click a MIDI clip on a lane to edit its notes.</div>;
  }

  // The note functions: a row under the toolbar (panel), or the clip panel's Notes section (window), where each group gets its own line.
  const gap = win ? <span aria-hidden style={{ flexBasis: '100%', height: 2 }} /> : <Sep />;
  const fitScale = () => scale && run((ns, x) => fitToScale(ns, x, scale), 'Fitted notes to the scale');
  const fnItems = (
    <>
      <Fn label="Quantize" title={`To the grid (${gridLabel(step || beat / 4, bpm, grid.triplet)}), by the amount (⌘U)`} onClick={() => run((ns, x) => quantizeNotes(ns, x, step || beat / 4, quant.amount / 100, quant.ends), 'Quantized notes')} h={btnH} />
      <NumField label="Quantize amount (%)" value={quant.amount} min={0} max={100} suffix="%" onChange={v => setQuant(q => ({ ...q, amount: v }))} h={btnH} />
      <label title="Quantize the ends too" style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><input type="checkbox" checked={quant.ends} onChange={e => setQuant(q => ({ ...q, ends: e.target.checked }))} />Ends</label>
      {gap}
      <Fn label="−12" title="Down an octave" onClick={() => run((ns, x) => transposeNotes(ns, x, -12), 'Transposed notes')} h={btnH} />
      <Fn label="−1" title="Down a semitone" onClick={() => run((ns, x) => transposeNotes(ns, x, -1), 'Transposed notes')} h={btnH} />
      <Fn label="+1" title="Up a semitone" onClick={() => run((ns, x) => transposeNotes(ns, x, 1), 'Transposed notes')} h={btnH} />
      <Fn label="+12" title="Up an octave" onClick={() => run((ns, x) => transposeNotes(ns, x, 12), 'Transposed notes')} h={btnH} />
      {!win && <Fn label="Fit to scale" disabled={!scale} title={scale ? `Each note to the nearest of ${NOTE_NAMES[scale.root]} ${scaleOf(scale.name).name}` : 'Pick a scale in the transport first'} onClick={fitScale} h={btnH} />}
      <Fn label="Invert" title="Upside down: the highest note becomes the lowest" onClick={() => run(invertNotes, 'Inverted notes')} h={btnH} />
      {gap}
      <Fn label="Reverse" title="Backwards in time" onClick={() => run(reverseNotes, 'Reversed notes')} h={btnH} />
      <Fn label="Legato" title="Each note to the start of the next" onClick={() => run(legatoNotes, 'Made notes legato')} h={btnH} />
      <Fn label="×2" title="Twice as long (from the first note)" onClick={() => run((ns, x) => stretchNotes(ns, x, 2), 'Stretched notes')} h={btnH} />
      <Fn label="÷2" title="Half as long (from the first note)" onClick={() => run((ns, x) => stretchNotes(ns, x, 0.5), 'Stretched notes')} h={btnH} />
      {win && gap}
      <Fn label="Humanize" title="Nudge timing and velocity a little; the same seed gives the same result" onClick={() => { run((ns, x) => humanizeNotes(ns, x, { time: (human.amount / 100) * beat / 8, vel: human.amount / 100 * 0.25 }, human.seed), 'Humanized notes'); setHuman(h => ({ ...h, seed: h.seed + 1 })); }} h={btnH} />
      <NumField label="Humanize amount (%)" value={human.amount} min={0} max={100} suffix="%" onChange={v => setHuman(h => ({ ...h, amount: v }))} h={btnH} />
      {gap}
      <Fn label="Chop" title="Each note into equal parts (⌘E)" onClick={() => run((ns, x) => chopNotes(ns, x, chop), 'Chopped notes')} h={btnH} />
      <NumField label="Chop parts" value={chop} min={2} max={64} onChange={setChop} h={btnH} />
      <Fn label="Join" title="Notes of the same pitch into one (⌘J)" onClick={() => run(joinNotes, 'Joined notes')} h={btnH} />
      <Fn label="Duplicate" title="A copy right after (⌘D)" onClick={() => run((ns, x) => duplicateNotes(ns, x, step), 'Duplicated notes')} h={btnH} />
    </>
  );

  const toolbar = (
    <div role="toolbar" aria-label="Piano roll" style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', flexWrap: 'wrap', borderBottom: `1px solid ${tk.border.subtle}` }}>
      {win && <ToolChip on={panelOpen} label="Clip" title={panelOpen ? 'Hide the clip panel' : 'Show the clip panel: the clip, its scale and the note functions'} onClick={() => setPanelOpen(!panelOpen)} h={btnH} />}
      {!win && (
        <>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: color, flexShrink: 0 }} />
          <span style={{ font: `650 12px ${fontFamily.ui}`, color: tk.text.primary, whiteSpace: 'nowrap' }}>{rack.name} · clip {clipIndex + 1}</span>
          <span style={{ font: `11px ${fontFamily.ui}`, color: tk.text.faint, whiteSpace: 'nowrap' }}>{bars}</span>
          <Sep />
        </>
      )}
      <IconButton icon="edit" size="sm" active={draw} aria-pressed={draw} label="Draw mode: click or drag to add notes, click one to delete it (B)" onClick={() => { setDraw(!draw); setSplitTool(false); }} />
      <ToolChip on={splitTool} label="Split" title="Split tool: click a note to split it there (E)" onClick={() => { setSplitTool(!splitTool); setDraw(false); }} h={btnH} />
      <Sep />
      <Select ariaLabel="Grid" value={grid.div} height={btnH} style={{ width: 132 }} options={gridOptions} onChange={v => setGrid(g => ({ ...g, div: v as GridDiv }))} />
      <ToolChip on={grid.triplet} label="3" title="Triplet grid (⌘3)" onClick={() => setGrid(g => ({ ...g, triplet: !g.triplet }))} h={btnH} />
      <Sep />
      <Segmented<FoldMode> size="sm" ariaLabel="Rows" value={fold} onChange={changeFold}
        options={[{ value: 'none', label: 'All' }, { value: 'notes', label: 'Fold', shortcut: 'f' }, { value: 'scale', label: 'Scale', shortcut: 'g', disabled: !scale }]} />
      {!win && <ToolChip on={tint && !!scale} label="K" title={scale ? `Highlight ${NOTE_NAMES[scale.root]} ${scaleOf(scale.name).name} (K)` : 'Pick a scale in the transport to highlight its notes'} onClick={() => setTint(!tint)} h={btnH} />}
      <Sep />
      <IconButton icon="minus" size="sm" label="Zoom out (−)" onClick={() => zoomBy(1 / 1.4)} />
      <IconButton icon="plus" size="sm" label="Zoom in (+)" onClick={() => zoomBy(1.4)} />
      <IconButton icon="fit" size="sm" label="Show the whole clip (X); the selection: Z" onClick={() => fit()} />
      <span style={{ flex: 1 }} />
      <span style={{ font: `11px ${fontFamily.ui}`, color: tk.text.faint, whiteSpace: 'nowrap' }}>{sel.length ? `${sel.length} selected` : `${clipIdx.length} notes`}</span>
      {!win && <ToolChip on={fnOpen} label="Functions" title={fnOpen ? 'Hide the note functions' : 'Quantize, transpose, fit to scale, invert, reverse, legato, stretch, humanize, chop, join, duplicate'} onClick={() => setFnOpen(!fnOpen)} h={btnH} />}
      <ToolChip on={velOpen} label="Velocity" title={velOpen ? 'Hide the velocity lane' : 'Show the velocity lane'} onClick={() => setVelOpen(!velOpen)} h={btnH} />
    </div>
  );

  const editor = (
    <>
      <div style={{ flexShrink: 0, display: 'flex' }}>
        <div style={{ width: KEYS_W, flexShrink: 0, background: tk.bg.field, borderRight: `1px solid ${tk.border.subtle}`, color: tk.text.faint, font: `9.5px ${fontFamily.mono}`, display: 'grid', placeItems: 'center' }}>{gridLabel(step, bpm, grid.triplet)}</div>
        <canvas ref={rulerRef} onPointerDown={onRulerDown} title="Drag down to zoom in, up to zoom out, sideways to scroll; drag the clip brace’s ends to trim it"
          style={{ flex: 1, minWidth: 0, height: RULER_H, display: 'block', cursor: 'ns-resize', touchAction: 'none' }} />
      </div>
      <div style={{ flex: 1, minHeight: 40, display: 'flex' }}>
        <canvas ref={keysRef} onPointerDown={onKeysDown} aria-label="Keys: click to hear a note and select its notes"
          style={{ width: KEYS_W, flexShrink: 0, height: size.h || '100%', display: 'block', cursor: 'pointer', touchAction: 'none' }} />
        <div ref={boxRef} style={{ position: 'relative', flex: 1, minWidth: 0, overflow: 'hidden' }}>
          <canvas ref={gridRef} onPointerDown={onGridDown} onPointerMove={onGridHover} onDoubleClick={onGridDouble}
            aria-label="Notes: click to select (⇧ adds), drag to move (⌥ copies, ⌘ ignores the grid), drag an edge to resize, double-click to add or delete; B draws"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block', cursor, touchAction: 'none' }} />
          <div ref={headRef} aria-hidden style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: 1.5, background: tk.text.primary, opacity: 0, pointerEvents: 'none' }} />
          {clipIdx.length === 0 && <span style={{ position: 'absolute', left: 10, top: 8, color: tk.text.faint, font: `11px ${fontFamily.ui}`, pointerEvents: 'none' }}>No notes yet: double-click to add one, or press B and draw</span>}
        </div>
      </div>
      {velOpen && (
        <div style={{ flexShrink: 0, display: 'flex', borderTop: `1px solid ${tk.border.subtle}` }}>
          <div style={{ width: KEYS_W, flexShrink: 0, boxSizing: 'border-box', padding: '4px 4px', display: 'flex', flexDirection: 'column', gap: 3, background: tk.bg.field, borderRight: `1px solid ${tk.border.subtle}` }}>
            <span style={{ font: `600 9px ${fontFamily.ui}`, color: tk.text.faint, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Vel</span>
            <VelInput value={velShown} disabled={!sel.length} onCommit={v => commit(setVelocity(notes, sel, v / 127), 'Changed velocity')} />
          </div>
          <canvas ref={velRef} onPointerDown={onVelDown} aria-label="Velocity: drag a stem (every selected stem moves together); in Draw mode draw them, ⇧ for a straight ramp"
            style={{ flex: 1, minWidth: 0, height: velH, display: 'block', cursor: draw ? 'crosshair' : 'ns-resize', touchAction: 'none' }} />
        </div>
      )}
    </>
  );

  return (
    <div ref={rootRef} tabIndex={0} onKeyDown={onKeyDown} data-piano-roll={layout} aria-label={`Piano roll: ${rack.name}, clip ${clipIndex + 1}`}
      style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', outline: 'none', background: tk.bg.panel }}>
      {toolbar}
      {win ? (
        <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
          {panelOpen && <ClipPanel rack={rack} arr={arr} clip={clip} clipIndex={clipIndex} color={color} notes={clipIdx.length} live={live} h={btnH}
            tint={tint} onTint={setTint} onAnchor={onAnchor} onFitScale={fitScale} fnOpen={fnOpen} onFnOpen={setFnOpen} target={target} fnItems={fnItems} />}
          <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>{editor}</div>
        </div>
      ) : (
        <>
          {fnOpen && (
            <div aria-label="Note functions" style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', flexWrap: 'wrap', borderBottom: `1px solid ${tk.border.subtle}`, background: tk.bg.subtle, font: `11px ${fontFamily.ui}`, color: tk.text.muted }}>
              <span title="What the functions change">On {target}:</span>
              {fnItems}
            </div>
          )}
          {editor}
        </>
      )}
    </div>
  );
}

/** Settings changes (the scale, the loop) aren't undo steps, as in the transport. */
function setArrSetting(fn: (a: PlayArrangement) => PlayArrangement): void {
  useNodeGraphStore.getState().setPlay(p => ({ ...p, arrangement: fn(p.arrangement ?? emptyArrangement(recordBpm(p.mappings))) }), false);
}

/**
 * The window's clip panel, where Live has it: the clip (start, end, length,
 * the tape's loop), its key (the tape's scale, the highlight, Snap to scale
 * for the clip's rack, Fit to scale) and the note functions.
 */
function ClipPanel({ rack, arr, clip, clipIndex, color, notes, live, h, tint, onTint, onAnchor, onFitScale, fnOpen, onFnOpen, target, fnItems }: {
  rack: AeRack; arr: PlayArrangement; clip: ArrClip; clipIndex: number; color: string; notes: number; live: boolean; h: number;
  tint: boolean; onTint: (v: boolean) => void; onAnchor: (t: number) => void; onFitScale: () => void;
  fnOpen: boolean; onFnOpen: (v: boolean) => void; target: string; fnItems: ReactNode;
}) {
  const tk = useTokens();
  const [scaleOpen, setScaleOpen] = useSection('window-scale', true);
  const bpm = arr.bpm;
  const sc = arr.scale;
  const on = !!sc?.on;
  const key = scaleBadge(sc);
  const setScale = (patch: Partial<ArrScale>) => setArrSetting(a => ({ ...a, scale: { on: true, root: 0, name: 'major', ...a.scale, ...patch } }));
  const trim = (from: number, to: number) => {
    if (live) return;
    editArr(a => trimClip(a, rack.id, clipIndex, from, to), `Trimmed a clip on ${rack.name}`);
    if (Math.abs(from - clip.t) > 1e-6) onAnchor(Math.max(0, from));
  };
  const snap = (v: string) => {
    audioEngineHost.releaseHeld(rack.id);
    useNodeGraphStore.getState().setPlay(p => withEngine(p, patchRack(p.audioEngine, rack.id, { scaleLock: v === 'off' ? undefined : v as AeRack['scaleLock'] })), { label: `Snap to scale on ${rack.name}` });
  };
  const label: CSSProperties = { width: 52, flexShrink: 0, color: tk.text.muted, font: `11px ${fontFamily.ui}` };
  const row: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6 };
  return (
    <div aria-label="Clip" data-clip-panel="" style={{ width: PANEL_W, flexShrink: 0, minHeight: 0, overflowY: 'auto', boxSizing: 'border-box', borderRight: `1px solid ${tk.border.subtle}`, background: tk.bg.subtle, font: `11.5px ${fontFamily.ui}`, color: tk.text.secondary }}>
      <PanelSection title="Clip" open>
        <div style={{ ...row, gap: 7 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: color, flexShrink: 0 }} />
          <b style={{ font: `650 12.5px ${fontFamily.ui}`, color: tk.text.primary, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{rack.name}</b>
          <span style={{ color: tk.text.faint, whiteSpace: 'nowrap' }}>clip {clipIndex + 1}</span>
        </div>
        <div style={row}><span style={label}>Start</span><PosField label="Clip start (bar.beat.sixteenth)" value={clip.t} bpm={bpm} h={h} disabled={live} onCommit={t => trim(t, clip.t + clip.d)} /></div>
        <div style={row}><span style={label}>End</span><PosField label="Clip end (bar.beat.sixteenth)" value={clip.t + clip.d} bpm={bpm} h={h} disabled={live} onCommit={t => trim(clip.t, t)} /></div>
        <div style={row}><span style={label}>Length</span><PosField length label="Clip length (bars.beats.sixteenths)" value={clip.d} bpm={bpm} h={h} disabled={live} onCommit={d => trim(clip.t, clip.t + d)} /></div>
        <Toggle checked={arr.loop} onChange={v => setArrSetting(a => ({ ...a, loop: v }))} label={<span title="The tape loops from its end back to the start (the transport’s Loop)">Loop the tape</span>} />
        <span style={{ color: tk.text.faint }}>{notes} note{notes === 1 ? '' : 's'} · {Math.round(bpm)} BPM</span>
      </PanelSection>
      <PanelSection title="Scale" open={scaleOpen} onToggle={setScaleOpen} summary={key || 'Off'}>
        <div style={row}>
          <Toggle checked={on} onChange={v => (v ? setScale({ on: true }) : setArrSetting(a => (a.scale ? { ...a, scale: { ...a.scale, on: false } } : a)))}
            label={<span title="The tape’s scale (the transport’s Scale): the roll highlights it, Fit to scale and Snap to scale use it">Scale</span>} />
          {key && <span data-scale-badge="" style={{ marginLeft: 'auto', padding: '1px 6px', borderRadius: 999, background: alpha(tk.accent.base, 0.16), color: tk.accent.text, font: `700 10.5px ${fontFamily.ui}` }}>{key}</span>}
        </div>
        <div style={row}>
          <Select ariaLabel="Scale root" value={String(sc?.root ?? 0)} height={h} style={{ width: 62, flexShrink: 0 }} options={NOTE_NAMES.map((n, i) => ({ value: String(i), label: n }))} onChange={v => setScale({ root: Number(v) })} />
          <Select ariaLabel="Scale name" value={sc?.name ?? 'major'} height={h} style={{ flex: 1, minWidth: 0 }} options={SCALES.map(s => ({ value: s.id, label: s.name }))} onChange={v => setScale({ name: v })} />
        </div>
        <Toggle checked={tint && on} disabled={!on} onChange={onTint} label={<span title="Tint the scale’s rows, the root stronger (K)">Highlight scale</span>} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={{ color: tk.text.muted }}>Notes played into {rack.name}</span>
          <Select ariaLabel="Snap played notes to scale" value={rack.scaleLock ?? 'off'} height={h}
            options={[
              { value: 'off', label: 'As played' },
              { value: 'nearest', label: 'Snap to scale' },
              { value: 'up', label: 'Snap to scale, up' },
              { value: 'down', label: 'Snap to scale, down' },
            ]}
            onChange={snap} />
          <span style={{ color: tk.text.faint, font: `10.5px/1.4 ${fontFamily.ui}` }}>
            {rack.scaleLock ? (on ? `Keys, MIDI and pads land in ${key}.` : 'Turn the scale on to snap.') : 'The rack’s “In key” (MIDI in): snap puts what you play in the scale.'}
          </span>
        </div>
        <Fn label="Fit to scale" disabled={!on || live} title={on ? `Each note in the clip (or the selection) to the nearest of ${key}` : 'Turn the scale on first'} onClick={onFitScale} h={h} />
      </PanelSection>
      <PanelSection title="Notes" open={fnOpen} onToggle={onFnOpen} summary="Quantize, transpose, ×2 ÷2…">
        <span style={{ color: tk.text.faint }}>On {target}:</span>
        <div aria-label="Note functions" style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', font: `11px ${fontFamily.ui}`, color: tk.text.muted }}>{fnItems}</div>
      </PanelSection>
    </div>
  );
}

/** A section of the clip panel: a header (a fold when `onToggle`), a one-line summary while folded. */
function PanelSection({ title, open, onToggle, summary, children }: { title: string; open: boolean; onToggle?: (v: boolean) => void; summary?: string; children: ReactNode }) {
  const tk = useTokens();
  const head: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: 0, border: 0, background: 'none', color: tk.text.primary, font: `700 10.5px ${fontFamily.ui}`, letterSpacing: '0.05em', textTransform: 'uppercase', cursor: onToggle ? 'pointer' : 'default', textAlign: 'left' };
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 7, padding: '10px 12px', borderBottom: `1px solid ${tk.border.subtle}` }}>
      {onToggle
        ? (
          <button type="button" aria-expanded={open} onClick={() => onToggle(!open)} style={head}>
            <span aria-hidden style={{ display: 'inline-block', width: 8, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 120ms', color: tk.text.faint }}>▸</span>
            {title}
            {!open && summary && <span style={{ marginLeft: 'auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: tk.text.faint, font: `500 11px ${fontFamily.ui}`, letterSpacing: 0, textTransform: 'none' }}>{summary}</span>}
          </button>
        )
        : <div style={head}>{title}</div>}
      {open && children}
    </section>
  );
}

/** A position or length typed as bars.beats.sixteenths (Live's clip fields). */
function PosField({ label, value, bpm, h, length, disabled, onCommit }: { label: string; value: number; bpm: number; h: number; length?: boolean; disabled?: boolean; onCommit: (t: number) => void }) {
  const tk = useTokens();
  const shown = length ? formatLength(value, bpm) : formatPosition(value, bpm);
  const [text, setText] = useState<string | null>(null);
  const commit = () => {
    if (text !== null && text.trim() !== shown) {
      const t = parsePosition(text, bpm, length);
      if (t !== null && Math.abs(t - value) > 1e-6) onCommit(t);
    }
    setText(null);
  };
  return (
    <input aria-label={label} title={label} disabled={disabled} value={text ?? shown} onChange={e => setText(e.target.value)} onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); else if (e.key === 'Escape') { e.stopPropagation(); setText(null); } }}
      style={{ flex: 1, minWidth: 0, height: h, padding: '0 6px', boxSizing: 'border-box', borderRadius: radius.sm, border: `1px solid ${tk.border.default}`, background: tk.bg.panel, color: tk.text.primary, font: `600 11.5px ${fontFamily.mono}`, opacity: disabled ? 0.5 : 1 }} />
  );
}

/** The shortest note a drag or ⇧-arrow leaves when the grid is finer than it. */
const NOTE_MIN_DRAW = 0.03;
const EMPTY: number[] = [];

function Sep() {
  const tk = useTokens();
  return <span aria-hidden style={{ width: 1, height: 16, background: tk.border.default, flexShrink: 0 }} />;
}

function ToolChip({ on, label, title, onClick, h }: { on: boolean; label: ReactNode; title: string; onClick: () => void; h: number }) {
  const tk = useTokens();
  return (
    <button type="button" aria-pressed={on} title={title} aria-label={title} onClick={onClick}
      style={{ height: h, minWidth: h, padding: '0 7px', borderRadius: radius.sm, border: 0, cursor: 'pointer', flexShrink: 0, font: `600 11px ${fontFamily.ui}`,
        color: on ? tk.accent.base : tk.text.secondary, background: on ? alpha(tk.accent.base, 0.16) : tk.bg.field, boxShadow: `inset 0 0 0 1px ${on ? alpha(tk.accent.base, 0.6) : tk.border.default}` }}>{label}</button>
  );
}

function Fn({ label, title, onClick, disabled, h }: { label: string; title: string; onClick: () => void; disabled?: boolean; h: number }) {
  const tk = useTokens();
  const style: CSSProperties = { height: h, padding: '0 8px', borderRadius: radius.sm, border: 0, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.45 : 1, flexShrink: 0,
    font: `550 11px ${fontFamily.ui}`, color: tk.text.primary, background: tk.bg.field, boxShadow: `inset 0 0 0 1px ${tk.border.default}` };
  return <button type="button" title={title} disabled={disabled} onClick={onClick} style={style}>{label}</button>;
}

function NumField({ label, value, min, max, suffix, onChange, h }: { label: string; value: number; min: number; max: number; suffix?: string; onChange: (v: number) => void; h: number }) {
  const tk = useTokens();
  // null: showing the value; text while typing.
  const [text, setText] = useState<string | null>(null);
  const commit = () => { const v = Math.round(Number(text)); if (text !== null && text.trim() && Number.isFinite(v)) onChange(Math.max(min, Math.min(max, v))); setText(null); };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
      <input aria-label={label} title={label} inputMode="numeric" value={text ?? String(value)} onChange={e => setText(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        style={{ width: 34, height: h, padding: '0 4px', boxSizing: 'border-box', borderRadius: radius.sm, border: `1px solid ${tk.border.default}`, background: tk.bg.panel, color: tk.text.primary, font: `600 11px ${fontFamily.mono}`, textAlign: 'right' }} />
      {suffix}
    </span>
  );
}

function VelInput({ value, disabled, onCommit }: { value: string; disabled: boolean; onCommit: (v: number) => void }) {
  const tk = useTokens();
  const [text, setText] = useState<string | null>(null);
  const commit = () => { const v = Math.round(Number(text)); if (text !== null && text.trim() && Number.isFinite(v) && v >= 1 && v <= 127 && text !== value) onCommit(v); setText(null); };
  return (
    <input aria-label="Velocity of the selected notes (1–127)" title="Velocity of the selected notes (1–127)" inputMode="numeric" disabled={disabled} placeholder={disabled ? '' : '—'}
      value={text ?? value} onChange={e => setText(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      style={{ width: '100%', height: 22, padding: '0 3px', boxSizing: 'border-box', borderRadius: radius.sm, border: `1px solid ${tk.border.default}`, background: tk.bg.panel, color: tk.text.primary, font: `600 11px ${fontFamily.mono}`, textAlign: 'center', opacity: disabled ? 0.5 : 1 }} />
  );
}
