/**
 * ClipEditor — the app's video viewer and editor (docs/clip-editor.md): a
 * preview player (play / pause, scrub, frame step, loop the selection), a
 * Photos-style trimmer along a filmstrip (yellow In / Out handles, the rest
 * dimmed, drag the middle to slide, pinch or ctrl-scroll to zoom), several
 * kept segments played one after another (reorder, reverse, the jumps drawn
 * under the strip), and a crop / rotate / flip with the resulting first,
 * middle and last frames.
 *
 * One component for every host: `host` picks its capabilities (CLIP_CAPS in
 * lib/media/clip.ts), so the Time Cube gets its sample ticks, ramp and frame
 * budget, a playback host (Video Input, a Video layer, a Baked node, the
 * Background) gets playback speed and loop, and a viewer (the Library, Files)
 * just plays and scrubs.
 *
 * Source / Result: Source plays the video itself; Result plays exactly what
 * the host will show. For the Time Cube that is the sampled frames in cube
 * order (`sequence`) at a chosen rate, the current tick lit; for a playback
 * host it is the playlist (segments, reversed ones backwards, at its speed,
 * looping or not) followed the way the host follows it (play/kit/clipPlay.js
 * cpFollow), with the crop / rotate / flip applied. The choice is remembered
 * per host.
 *
 * Controlled: `value` + `onChange`. The filmstrip's thumbnails are made once
 * per video and kept (visible ones first), so the editor opens at once on a
 * long video and opens again instantly.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import {
  CLIP_CAPS, FULL_CROP, MAX_SEGMENTS, MIN_CROP, cleanCrop, clipOutputSize, drawClipFrame, isIdentity, isPlaybackHost, playbackFrames, resolveSegments,
  type ClipCaps, type ClipCrop, type ClipHost, type ClipSettings, type ClipSegment, type ClipTransform, type PlannedSegment,
} from '../../lib/media/clip';
import { cpAt, cpFollow, cpLength } from '../../play/kit/clipPlay.js';
import { openVideoReader, type FrameReader } from '../../lib/timeCube/frames';
import { STRIP_H, STRIP_THUMBS, coarsePointer, rememberMode, rememberedMode, stripFor, thumbOrder, trimHandleGrab, type ClipPreviewMode } from './clipEditorParts';

/** Where the editor's frames come from: a video file, or a picture painted at any time (a built-in clip). */
export type ClipFrameSource =
  | { kind: 'video'; blob: Blob }
  | { kind: 'painted'; paint: (g: CanvasRenderingContext2D, t: number, x: number, y: number, w: number, h: number) => void };

export interface ClipMeta { width: number; height: number; duration: number }

/** The frames the host would sample from the current value: drawn as ticks on the strip. */
export interface ClipPreviewPlan { times: number[]; segments: PlannedSegment[]; frames: number; every: number }


const YELLOW = '#ffc53d';
const TICK_H = 16, JUMP_H = 26;
const TL_H = TICK_H + STRIP_H + JUMP_H;
const HANDLE_W = 12;
const SPEEDS = [0.25, 0.5, 1, 1.5, 2];
/** Time Cube Result rates: frames a second, or 0 for "match": the cube's frames over the kept seconds. */
const CUBE_RATES = [12, 24, 30, 0];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const fmt = (t: number) => `${t.toFixed(2)} s`;




function paintedReader(paint: Extract<ClipFrameSource, { kind: 'painted' }>['paint'], meta: ClipMeta): FrameReader {
  const scratch = document.createElement('canvas');
  return {
    async draw(t, g, x, y, w, h, _signal, xf) {
      if (!xf || isIdentity(xf)) { paint(g, t, x, y, w, h); return; }
      const k = Math.min(3, Math.max(1, Math.max(w, h) / Math.min(xf.crop.w * meta.width, xf.crop.h * meta.height)));
      const sw = Math.round(meta.width * k), sh = Math.round(meta.height * k);
      if (scratch.width !== sw || scratch.height !== sh) { scratch.width = sw; scratch.height = sh; }
      const sg = scratch.getContext('2d');
      if (!sg) return;
      paint(sg, t, 0, 0, sw, sh);
      drawClipFrame(g, scratch, sw, sh, xf, x, y, w, h);
    },
    close: () => { scratch.width = 0; },
  };
}

/** A canvas sized to its box (device pixels), redrawn by `draw` whenever its size or `deps` change. */
function useFitCanvas(draw: (g: CanvasRenderingContext2D, w: number, h: number) => void) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ro = new ResizeObserver(() => setSize({ w: c.clientWidth, h: c.clientHeight }));
    ro.observe(c);
    setSize({ w: c.clientWidth, h: c.clientHeight });
    return () => ro.disconnect();
  }, []);
  const paint = useCallback(() => {
    const c = ref.current;
    if (!c || !size.w || !size.h) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.round(size.w * dpr), H = Math.round(size.h * dpr);
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const g = c.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(g, size.w, size.h);
  }, [draw, size.w, size.h]);
  return { ref, size, paint };
}

type Drag =
  | { kind: 'in' | 'out' | 'move'; seg: number; t0: number; a: number; b: number }
  | { kind: 'scrub' }
  | { kind: 'crop'; part: 'move' | 'tl' | 'tr' | 'bl' | 'br'; x0: number; y0: number; crop: ClipCrop };

export function ClipEditor({ source, meta, value, onChange, plan, side, fps = 30, host = 'timeCube', caps: capsIn, sequence, cubeRate }: {
  source: ClipFrameSource;
  meta: ClipMeta;
  value: ClipSettings;
  onChange: (v: ClipSettings) => void;
  plan?: ClipPreviewPlan | null;
  /** Extra controls for the side panel (the host's frame budget). */
  side?: ReactNode;
  /** Frames a second, for frame stepping and the frame readout (a browser does not say). */
  fps?: number;
  /** Who opened it: picks the controls (CLIP_CAPS). */
  host?: ClipHost;
  /** Override the host's capabilities (tests, a host that turns one off). */
  caps?: Partial<ClipCaps>;
  /** Time Cube: the sampled times in cube order (lib/media/clip.ts cubeSequence), what Result steps through. */
  sequence?: number[] | null;
  /** Time Cube: Result's frames a second when "match" is picked (its frames over the kept seconds). */
  cubeRate?: number;
}) {
  const tk = useTokens();
  const caps: ClipCaps = { ...CLIP_CAPS[host], ...capsIn };
  const playback = isPlaybackHost(host);
  const dur = Math.max(0.05, meta.duration);
  const minLen = Math.min(dur, 2 / fps);
  const segs = caps.edit ? value.segments : [{ in: 0, out: dur }];
  const [active, setActive] = useState(0);
  const act = Math.min(active, segs.length - 1);
  const [t, setT] = useState(() => (caps.edit ? segs[0]?.in ?? 0 : 0));
  const tRef = useRef(t);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(caps.edit);
  const [cropMode, setCropMode] = useState(false);
  const [view, setView] = useState({ z: 1, t0: 0 });
  const valueRef = useRef(value);
  valueRef.current = value;
  const [mode, setModeRaw] = useState<ClipPreviewMode>(() => (caps.edit ? rememberedMode(host) : 'source'));
  const result = mode === 'result' && caps.edit;
  const [rate, setRate] = useState(12);

  // ── Sources: a <video> for the player, a reader for thumbnails ──
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [frameTick, setFrameTick] = useState(0);
  useEffect(() => {
    held.current = null;
    if (source.kind !== 'video') return;
    const url = URL.createObjectURL(source.blob);
    const el = document.createElement('video');
    el.muted = true; el.playsInline = true; el.preload = 'auto'; el.src = url;
    const bump = () => setFrameTick(n => n + 1);
    el.addEventListener('seeked', bump); el.addEventListener('loadeddata', bump);
    videoRef.current = el;
    el.currentTime = tRef.current;
    return () => { el.pause(); el.removeAttribute('src'); el.load(); URL.revokeObjectURL(url); videoRef.current = null; };
  }, [source]);

  const readerRef = useRef<FrameReader | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const [readerOk, setReaderOk] = useState(0);
  useEffect(() => {
    let live = true, r: FrameReader | null = null;
    (async () => {
      r = source.kind === 'video' ? await openVideoReader(source.blob).catch(() => null) : paintedReader(source.paint, meta);
      if (!live) { r?.close(); return; }
      readerRef.current = r; setReaderOk(n => n + 1);
    })();
    return () => { live = false; const cur = readerRef.current; readerRef.current = null; queue.current = queue.current.then(() => cur?.close()); };
  }, [source, meta]);
  /** Readers seek one frame at a time: their jobs run in turn. */
  const enqueue = useCallback(<T,>(job: (r: FrameReader) => Promise<T>) => {
    const next = queue.current.then(() => (readerRef.current ? job(readerRef.current) : undefined)).catch(() => undefined);
    queue.current = next;
    return next;
  }, []);

  // Filmstrip: thumbnails along the whole video, kept per video (made once), the visible ones first.
  const aspect = meta.width / Math.max(1, meta.height);
  const stripKey: object = source.kind === 'video' ? source.blob : source.paint;
  const strip = useMemo(() => stripFor(stripKey, aspect), [stripKey, aspect]);
  const [stripTick, setStripTick] = useState(0);
  const vd = dur / view.z;
  const viewFrom = view.t0 / dur, viewTo = (view.t0 + vd) / dur;
  useEffect(() => {
    if (!readerOk) return;
    const g = strip.canvas.getContext('2d');
    if (!g) return;
    const ctl = new AbortController(), tw = strip.canvas.width / STRIP_THUMBS;
    const todo = thumbOrder(STRIP_THUMBS, viewFrom, viewTo, strip.done);
    // Let the player and the result frames go first: the strip fills in behind them.
    const timer = setTimeout(() => todo.forEach((i, n) => void enqueue(async r => {
      if (ctl.signal.aborted || strip.done.has(i)) return;
      await r.draw(((i + 0.5) / STRIP_THUMBS) * dur, g, Math.round(i * tw), 0, Math.ceil(tw), strip.canvas.height, ctl.signal);
      strip.done.add(i);
      if (n % 3 === 2 || n === todo.length - 1) setStripTick(k => k + 1);
    })), 60);
    return () => { clearTimeout(timer); ctl.abort(); };
  }, [readerOk, strip, dur, enqueue, viewFrom.toFixed(2), viewTo.toFixed(2)]); // eslint-disable-line react-hooks/exhaustive-deps

  // The playlist a playback host plays from the value (Result).
  const resolved = useMemo(() => resolveSegments(value.segments, dur), [value.segments, dur]);
  const speed = value.speed && value.speed > 0 ? value.speed : 1;
  const hostLoop = value.loop !== false;
  const outLen = cpLength(resolved, speed);
  // Result: the frames the host shows, in its order (the Time Cube's tiles; a playback host's frames at 30 a second).
  const seq = useMemo(() => (sequence ?? (playback ? playbackFrames(value, dur, fps) : plan?.times ?? [])), [sequence, playback, value, dur, fps, plan]);

  // Result thumbnails: the first, middle and last frames the host takes, cropped / rotated / flipped.
  const resultRefs = [useRef<HTMLCanvasElement>(null), useRef<HTMLCanvasElement>(null), useRef<HTMLCanvasElement>(null)];
  const times = plan?.times ?? (playback ? playbackFrames({ ...value, loop: false }, dur, fps) : []);
  const pick = caps.edit && times.length ? [times[0], times[Math.floor((times.length - 1) / 2)], times[times.length - 1]] : null;
  const [ow, oh] = clipOutputSize(meta.width, meta.height, value.xf);
  const outAspect = ow / Math.max(1e-6, oh);
  const pickKey = pick ? pick.map(v => v.toFixed(3)).join(',') : '';
  const xfKey = JSON.stringify(value.xf);
  useEffect(() => {
    if (!readerOk || !pick) return;
    const ctl = new AbortController();
    const timer = setTimeout(() => {
      pick.forEach((time, i) => void enqueue(async r => {
        const c = resultRefs[i].current;
        const g = c?.getContext('2d');
        if (!c || !g || ctl.signal.aborted) return;
        g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
        await r.draw(time, g, 0, 0, c.width, c.height, ctl.signal, valueRef.current.xf);
      }));
    }, 200);
    return () => { clearTimeout(timer); ctl.abort(); };
  }, [readerOk, pickKey, xfKey, outAspect]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Player (Source) ──
  const seek = useCallback((time: number) => {
    const v = clamp(time, 0, dur - 1e-3);
    tRef.current = v; setT(v);
    const el = videoRef.current;
    if (el && Math.abs(el.currentTime - v) > 1e-4) el.currentTime = v;
  }, [dur]);
  const playSeg = useRef(0);
  // ── Result: where it is (a Time Cube's frame index, or a playback host's clock) ──
  const [rIdx, setRIdx] = useState(0);
  const rIdxRef = useRef(0);
  const [rClock, setRClock] = useState(0);
  const rClockRef = useRef(0);
  const goIdx = useCallback((i: number) => {
    const n = seq.length;
    if (!n) return;
    const k = ((i % n) + n) % n;
    rIdxRef.current = k; setRIdx(k);
    seek(seq[k]);
  }, [seq, seek]);
  const goClock = useCallback((c: number) => {
    const v = Math.max(0, c);
    rClockRef.current = v; setRClock(v);
    const at = cpAt(resolved, v, speed, hostLoop);
    tRef.current = at.time; setT(at.time);
    const el = videoRef.current;
    if (el && !el.paused) el.pause();
    if (el && Math.abs(el.currentTime - at.time) > 1e-4) el.currentTime = at.time;
  }, [resolved, speed, hostLoop]);

  const stop = useCallback(() => { setPlaying(false); videoRef.current?.pause(); }, []);
  const setMode = (m: ClipPreviewMode) => {
    stop();
    setModeRaw(m); rememberMode(host, m);
    if (m === 'result') { if (playback) goClock(0); else goIdx(0); }
  };

  const togglePlay = useCallback(() => {
    setPlaying(p => {
      const next = !p;
      const el = videoRef.current;
      if (result) {
        if (!next) el?.pause();
        else if (playback && !hostLoop && rClockRef.current >= outLen - 1e-3) goClock(0);
        return next;
      }
      if (next) {
        const list = caps.edit ? valueRef.current.segments : [];
        if (loop && list.length) {
          const k = list.findIndex(s => tRef.current >= s.in && tRef.current < s.out - 1e-3);
          playSeg.current = k >= 0 ? k : 0;
          if (k < 0) seek(list[0].in);
        } else if (tRef.current >= dur - 2 / fps) seek(0);
        void el?.play().catch(() => {});
      } else el?.pause();
      return next;
    });
  }, [loop, dur, fps, seek, result, playback, hostLoop, outLen, goClock, caps.edit]);

  // Source playback: the video itself (Loop selection: the kept segments, in order, forwards).
  useEffect(() => {
    if (!playing || result) return;
    let raf = 0, last = performance.now();
    const tick = (now: number) => {
      const el = videoRef.current;
      let time = el ? el.currentTime : tRef.current + (now - last) / 1000;
      last = now;
      const list = caps.edit ? valueRef.current.segments : [];
      if (loop && list.length) {
        let k = Math.min(playSeg.current, list.length - 1);
        if (time >= list[k].out || time < list[k].in - 0.5) {
          k = time >= list[k].out ? (k + 1) % list.length : k;
          time = list[k].in;
          if (el) el.currentTime = time;
        }
        playSeg.current = k;
      } else if (time >= dur) {
        time = dur - 1e-3; setPlaying(false); el?.pause();
      }
      tRef.current = time; setT(time);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, loop, dur, result, caps.edit]);

  // Result playback, a playback host: its clock runs, the video follows the playlist as the host's does.
  useEffect(() => {
    if (!playing || !result || !playback) return;
    let raf = 0, last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      let c = rClockRef.current + dt;
      const at = cpAt(resolved, c, speed, hostLoop);
      if (at.done) { c = outLen; setPlaying(false); }
      rClockRef.current = c; setRClock(c);
      const el = videoRef.current;
      cpFollow(el, at, resolved[at.k], speed, !at.done);
      const shown = el && !el.seeking ? el.currentTime : at.time;
      tRef.current = shown; setT(shown);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); videoRef.current?.pause(); };
  }, [playing, result, playback, resolved, speed, hostLoop, outLen]);

  // Result playback, the Time Cube: one sampled frame after another, in cube order, at the chosen rate.
  const stepRate = rate > 0 ? rate : Math.max(0.5, cubeRate ?? 12);
  useEffect(() => {
    if (!playing || !result || playback || !seq.length) return;
    let raf = 0, due = performance.now() + 1000 / stepRate;
    const tick = (now: number) => {
      const el = videoRef.current;
      // Wait for the frame to arrive before the next (a long video seeks slower than the rate asks).
      if (now >= due && !(el && el.seeking)) { due = now + 1000 / stepRate; goIdx(rIdxRef.current + 1); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, result, playback, seq, stepRate, goIdx]);

  useEffect(() => () => videoRef.current?.pause(), []);
  // The value changed under a Result: start it over where it makes sense.
  useEffect(() => { if (result && !playback && rIdxRef.current >= seq.length) goIdx(0); }, [seq, result, playback, goIdx]);

  const step = useCallback((n: number) => {
    if (playing) stop();
    if (result) { if (playback) goClock(Math.round(rClockRef.current * fps + n) / fps); else goIdx(rIdxRef.current + n); return; }
    seek(Math.round(tRef.current * fps + n) / fps + 1e-4);
  }, [playing, stop, result, playback, goClock, goIdx, fps, seek]);

  // ── Changing the clip ──
  const setSegs = (list: ClipSegment[]) => onChange({ ...valueRef.current, segments: list });
  const patchSeg = (i: number, p: Partial<ClipSegment>) => setSegs(valueRef.current.segments.map((s, j) => (j === i ? { ...s, ...p } : s)));
  const setXf = (p: Partial<ClipTransform>) => onChange({ ...valueRef.current, xf: { ...valueRef.current.xf, ...p } });
  const addSegment = () => {
    const list = valueRef.current.segments;
    if (list.length >= MAX_SEGMENTS) return;
    const len = Math.min(dur, Math.max(minLen, dur * 0.15));
    const a = clamp(tRef.current, 0, dur - len);
    const next = [...list.slice(0, act + 1), { in: a, out: a + len }, ...list.slice(act + 1)];
    setSegs(next); setActive(act + 1);
  };
  const removeSegment = (i: number) => {
    const list = valueRef.current.segments;
    if (list.length <= 1) return;
    setSegs(list.filter((_, j) => j !== i)); setActive(Math.max(0, Math.min(i, list.length - 2)));
  };
  const moveSegment = (i: number, d: number) => {
    const list = [...valueRef.current.segments], j = i + d;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    setSegs(list); setActive(j);
  };

  // ── Timeline maths ──
  const tl = useFitCanvas(useCallback((g, W) => {
    const X = (time: number) => ((time - view.t0) / vd) * W;
    g.clearRect(0, 0, W, TL_H);
    // Filmstrip: the visible part of the whole-video strip.
    const sc = strip.canvas;
    const sx = (view.t0 / dur) * sc.width, sw = (vd / dur) * sc.width;
    g.save();
    g.beginPath(); g.roundRect(0, TICK_H, W, STRIP_H, 6); g.clip();
    g.drawImage(sc, sx, 0, sw, sc.height, 0, TICK_H, W, STRIP_H);
    if (caps.trim) {
      // Dim what no segment keeps.
      const kept = segs.map(s => [s.in, s.out] as const).sort((a, b) => a[0] - b[0]);
      g.fillStyle = 'rgba(8,8,12,0.62)';
      let from = 0;
      for (const [a, b] of kept) { if (a > from) g.fillRect(X(from), TICK_H, X(a) - X(from), STRIP_H); from = Math.max(from, b); }
      if (from < dur) g.fillRect(X(from), TICK_H, X(dur) - X(from) + 1, STRIP_H);
    }
    g.restore();
    // Segments: yellow frames, the active one with handles; a number (and ◀ when reversed).
    if (caps.trim) {
      const order = segs.map((_, i) => i).filter(i => i !== act).concat(act);
      for (const i of order) {
        const s = segs[i], x0 = X(s.in), x1 = X(s.out), on = i === act;
        g.strokeStyle = on ? YELLOW : alpha(YELLOW, 0.65);
        g.lineWidth = on ? 3 : 2;
        g.beginPath(); g.roundRect(x0 + 1.5, TICK_H + 1.5, Math.max(2, x1 - x0 - 3), STRIP_H - 3, 5); g.stroke();
        if (on) {
          g.fillStyle = YELLOW;
          for (const [hx, dir] of [[x0, -1], [x1 - HANDLE_W, 1]] as const) {
            g.beginPath(); g.roundRect(hx, TICK_H, HANDLE_W, STRIP_H, dir < 0 ? [6, 0, 0, 6] : [0, 6, 6, 0]); g.fill();
            g.strokeStyle = '#3b2f00'; g.lineWidth = 2;
            const cx = hx + HANDLE_W / 2, cy = TICK_H + STRIP_H / 2;
            g.beginPath(); g.moveTo(cx - dir * 2.5, cy - 6); g.lineTo(cx + dir * 2.5, cy); g.lineTo(cx - dir * 2.5, cy + 6); g.stroke();
          }
        }
        if (segs.length > 1 || s.reverse) {
          const label = `${i + 1}${s.reverse ? ' ◀' : ''}`;
          g.font = `700 11px ${fontFamily.ui}`;
          const lw = g.measureText(label).width + 10, lx = x0 + (on ? HANDLE_W + 3 : 4);
          g.fillStyle = on ? YELLOW : 'rgba(0,0,0,0.6)';
          g.beginPath(); g.roundRect(lx, TICK_H + 4, lw, 16, 4); g.fill();
          g.fillStyle = on ? '#2a2000' : '#fff';
          g.fillText(label, lx + 5, TICK_H + 16);
        }
      }
    }
    // Ticks: the frames that will be sampled.
    if (plan && caps.frameSamples) {
      for (const p of plan.segments) {
        const on = segs[act] && Math.abs(p.in - segs[act].in) < 1e-6 && Math.abs(p.out - segs[act].out) < 1e-6;
        g.fillStyle = on ? YELLOW : tk.text.faint;
        for (let j = p.first; j < p.first + p.frames; j++) {
          const x = X(plan.times[j]);
          if (x < -1 || x > W + 1) continue;
          g.fillRect(Math.round(x) - 0.5, 3, 1, TICK_H - 6);
        }
      }
    }
    // Jumps: from where one segment stops playing to where the next starts.
    const jumps = plan && caps.frameSamples ? plan.segments.filter(p => p.frames > 0) : caps.segments && caps.edit ? resolved : [];
    g.strokeStyle = tk.accent.base; g.fillStyle = tk.accent.base; g.lineWidth = 1.5;
    for (let k = 0; k + 1 < jumps.length; k++) {
      const a = jumps[k], b = jumps[k + 1];
      const xa = X(a.reverse ? a.in : a.out), xb = X(b.reverse ? b.out : b.in);
      const y0 = TICK_H + STRIP_H + 2, dip = Math.min(JUMP_H - 6, 8 + Math.abs(xb - xa) * 0.08);
      g.beginPath(); g.moveTo(xa, y0); g.bezierCurveTo(xa, y0 + dip, xb, y0 + dip, xb, y0 + 3); g.stroke();
      g.beginPath(); g.moveTo(xb, y0 + 1); g.lineTo(xb - 4, y0 + 7); g.lineTo(xb + 4, y0 + 7); g.closePath(); g.fill();
    }
    // Result: the frame showing now, lit on the tick row.
    if (result) {
      const hx = X(t);
      g.fillStyle = YELLOW;
      g.fillRect(Math.round(hx) - 1.5, 0, 3, TICK_H - 1);
    }
    // Playhead.
    const px = X(t);
    g.fillStyle = '#fff'; g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 1;
    g.fillRect(px - 1, TICK_H - 4, 2, STRIP_H + 8); g.strokeRect(px - 1.5, TICK_H - 4.5, 3, STRIP_H + 9);
  }, [view.t0, vd, dur, strip, segs, act, plan, t, tk.accent.base, tk.text.faint, stripTick, caps.trim, caps.frameSamples, caps.segments, caps.edit, resolved, result])); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { tl.paint(); }, [tl]);

  const tlTime = (clientX: number) => {
    const r = tl.ref.current!.getBoundingClientRect();
    return view.t0 + ((clientX - r.left) / r.width) * vd;
  };
  const zoomAt = useCallback((factor: number, at: number) => {
    setView(v => {
      const z = clamp(v.z * factor, 1, Math.max(1, dur * fps / 6));
      const nvd = dur / z, frac = (at - v.t0) / (dur / v.z);
      return { z, t0: clamp(at - frac * nvd, 0, dur - nvd) };
    });
  }, [dur, fps]);

  // Wheel: ctrl / pinch zooms around the cursor, otherwise pans. Not passive: the page must not scroll.
  useEffect(() => {
    const c = tl.ref.current;
    if (!c) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault(); e.stopPropagation();
      const r = c.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.01), view.t0 + ((e.clientX - r.left) / r.width) * vd);
      else { const d = (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) * (vd / r.width); setView(v => ({ ...v, t0: clamp(v.t0 + d, 0, dur - dur / v.z) })); }
    };
    // Safari's trackpad pinch.
    let g0 = 1;
    const onGS = (e: Event) => { e.preventDefault(); g0 = 1; };
    const onGC = (e: Event) => { e.preventDefault(); const s = (e as unknown as { scale: number; clientX: number }).scale; zoomAt(s / g0, view.t0 + vd / 2); g0 = s; };
    c.addEventListener('wheel', onWheel, { passive: false });
    c.addEventListener('gesturestart', onGS); c.addEventListener('gesturechange', onGC);
    return () => { c.removeEventListener('wheel', onWheel); c.removeEventListener('gesturestart', onGS); c.removeEventListener('gesturechange', onGC); };
  }, [tl.ref, zoomAt, view.t0, vd, dur]);

  const drag = useRef<Drag | null>(null);
  const pointers = useRef(new Map<number, number>());
  const pinch = useRef<{ d: number } | null>(null);
  const hitTimeline = (clientX: number, clientY: number, touch = false): Drag => {
    const r = tl.ref.current!.getBoundingClientRect();
    const x = clientX - r.left, y = clientY - r.top, W = r.width;
    const X = (time: number) => ((time - view.t0) / vd) * W;
    const time = tlTime(clientX);
    // A finger is wider than a cursor: the handles take a wider grab, and the whole strip's height counts.
    const { grabIn, outside, slackY } = trimHandleGrab(touch, HANDLE_W);
    if (caps.trim && y >= TICK_H - slackY && y <= TICK_H + STRIP_H + slackY) {
      const order = [act, ...segs.map((_, i) => i).filter(i => i !== act)];
      for (const i of order) {
        const s = segs[i], x0 = X(s.in), x1 = X(s.out);
        const grab = i === act ? grabIn : Math.min(grabIn, touch ? 12 : 6);
        if (x >= x0 - outside && x <= x0 + grab) return { kind: 'in', seg: i, t0: time, a: s.in, b: s.out };
        if (x >= x1 - grab && x <= x1 + outside) return { kind: 'out', seg: i, t0: time, a: s.in, b: s.out };
      }
      for (const i of order) {
        const s = segs[i];
        if (time > s.in && time < s.out && i === act) return { kind: 'move', seg: i, t0: time, a: s.in, b: s.out };
      }
      for (const i of order) { const s = segs[i]; if (time > s.in && time < s.out) return { kind: 'move', seg: i, t0: time, a: s.in, b: s.out }; }
    }
    return { kind: 'scrub' };
  };
  const [cursor, setCursor] = useState('default');
  const onTlDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, e.clientX);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { d: Math.max(10, Math.abs(a - b)) }; drag.current = null; return;
    }
    const d = hitTimeline(e.clientX, e.clientY, e.pointerType !== 'mouse');
    drag.current = d;
    if (d.kind !== 'scrub' && d.kind !== 'crop') setActive(d.seg);
    // Scrubbing shows the source: Result picks up from its start again.
    if (result && d.kind === 'scrub') { stop(); setModeRaw('source'); rememberMode(host, 'source'); }
    if (d.kind === 'scrub') { if (playing && !result) togglePlay(); seek(tlTime(e.clientX)); }
  };
  const onTlMove = (e: React.PointerEvent) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, e.clientX);
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.max(10, Math.abs(a - b));
      zoomAt(d / pinch.current.d, tlTime((a + b) / 2)); pinch.current.d = d; return;
    }
    const d = drag.current;
    if (!d) {
      const h = hitTimeline(e.clientX, e.clientY);
      setCursor(h.kind === 'in' || h.kind === 'out' ? 'ew-resize' : h.kind === 'move' ? 'grab' : 'text');
      return;
    }
    const time = tlTime(e.clientX);
    if (d.kind === 'scrub') { seek(time); return; }
    if (d.kind === 'crop') return;
    if (d.kind === 'in') { const a = clamp(time, 0, d.b - minLen); patchSeg(d.seg, { in: a }); seek(a); }
    else if (d.kind === 'out') { const b = clamp(time, d.a + minLen, dur); patchSeg(d.seg, { out: b }); seek(b - 1 / fps); }
    else { const len = d.b - d.a, a = clamp(d.a + time - d.t0, 0, dur - len); patchSeg(d.seg, { in: a, out: a + len }); setCursor('grabbing'); }
  };
  const onTlUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    drag.current = null;
  };

  // ── Preview, with the crop (Source) or through it (Result) ──
  const frameRect = (W: number, H: number, fw = meta.width, fh = meta.height) => {
    const s = Math.min(W / fw, H / fh);
    const w = fw * s, h = fh * s;
    return { x: (W - w) / 2, y: (H - h) / 2, w, h };
  };
  const crop = value.xf.crop;
  const showCrop = caps.crop && !result && (cropMode || crop.w < 1 || crop.h < 1);
  const scratch = useRef<HTMLCanvasElement | null>(null);
  // The last decoded frame, kept: while the player seeks (a reversed stretch steps back a frame at a
  // time, a jump between segments) the element has no picture, and the preview shows this instead.
  const held = useRef<{ c: HTMLCanvasElement; ok: boolean } | null>(null);
  const heldFrame = (el: HTMLVideoElement | null): HTMLCanvasElement | null => {
    const h = held.current ?? (held.current = { c: document.createElement('canvas'), ok: false });
    if (el && el.readyState >= 2 && !el.seeking && el.videoWidth) {
      if (h.c.width !== el.videoWidth || h.c.height !== el.videoHeight) { h.c.width = el.videoWidth; h.c.height = el.videoHeight; }
      h.c.getContext('2d')?.drawImage(el, 0, 0);
      h.ok = true;
    }
    return h.ok ? h.c : null;
  };
  const pv = useFitCanvas(useCallback((g, W, H) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    const el = videoRef.current;
    if (result) {
      // What the host shows: the frame through the crop / rotate / flip, in its own shape.
      const r = frameRect(W, H, ow, oh);
      if (source.kind === 'video') { const f = heldFrame(el); if (f) drawClipFrame(g, f, f.width, f.height, value.xf, r.x, r.y, r.w, r.h); }
      else {
        const c = scratch.current ?? (scratch.current = document.createElement('canvas'));
        if (c.width !== meta.width || c.height !== meta.height) { c.width = meta.width; c.height = meta.height; }
        const sg = c.getContext('2d');
        if (sg) { source.paint(sg, t, 0, 0, meta.width, meta.height); drawClipFrame(g, c, meta.width, meta.height, value.xf, r.x, r.y, r.w, r.h); }
      }
      return;
    }
    const r = frameRect(W, H);
    if (source.kind === 'video') { const f = heldFrame(el); if (f) g.drawImage(f, r.x, r.y, r.w, r.h); }
    else source.paint(g, t, r.x, r.y, r.w, r.h);
    if (!showCrop) return;
    const cx = r.x + crop.x * r.w, cy = r.y + crop.y * r.h, cw = crop.w * r.w, ch = crop.h * r.h;
    g.fillStyle = 'rgba(0,0,0,0.55)';
    g.fillRect(r.x, r.y, r.w, cy - r.y); g.fillRect(r.x, cy + ch, r.w, r.y + r.h - cy - ch);
    g.fillRect(r.x, cy, cx - r.x, ch); g.fillRect(cx + cw, cy, r.x + r.w - cx - cw, ch);
    g.strokeStyle = cropMode ? YELLOW : alpha(YELLOW, 0.6); g.lineWidth = 2;
    g.strokeRect(cx, cy, cw, ch);
    if (cropMode) {
      g.strokeStyle = alpha('#ffffff', 0.35); g.lineWidth = 1;
      for (const k of [1, 2]) { g.beginPath(); g.moveTo(cx + (cw * k) / 3, cy); g.lineTo(cx + (cw * k) / 3, cy + ch); g.moveTo(cx, cy + (ch * k) / 3); g.lineTo(cx + cw, cy + (ch * k) / 3); g.stroke(); }
      g.fillStyle = YELLOW;
      for (const [hx, hy] of [[cx, cy], [cx + cw, cy], [cx, cy + ch], [cx + cw, cy + ch]]) g.fillRect(hx - 5, hy - 5, 10, 10);
    }
  }, [source, t, showCrop, cropMode, crop.x, crop.y, crop.w, crop.h, frameTick, meta.width, meta.height, result, xfKey, ow, oh])); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { pv.paint(); }, [pv]);

  const onPvDown = (e: React.PointerEvent) => {
    if (!cropMode || result) { togglePlay(); return; }
    const c = pv.ref.current!, b = c.getBoundingClientRect(), r = frameRect(b.width, b.height);
    const x = (e.clientX - b.left - r.x) / r.w, y = (e.clientY - b.top - r.y) / r.h;
    const near = (px: number, py: number) => Math.abs(x - px) * r.w < 12 && Math.abs(y - py) * r.h < 12;
    const part = near(crop.x, crop.y) ? 'tl' : near(crop.x + crop.w, crop.y) ? 'tr' : near(crop.x, crop.y + crop.h) ? 'bl' : near(crop.x + crop.w, crop.y + crop.h) ? 'br'
      : x > crop.x && x < crop.x + crop.w && y > crop.y && y < crop.y + crop.h ? 'move' : null;
    if (!part) return;
    c.setPointerCapture(e.pointerId);
    drag.current = { kind: 'crop', part, x0: x, y0: y, crop: { ...crop } };
  };
  const onPvMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.kind !== 'crop') return;
    const b = pv.ref.current!.getBoundingClientRect(), r = frameRect(b.width, b.height);
    const dx = (e.clientX - b.left - r.x) / r.w - d.x0, dy = (e.clientY - b.top - r.y) / r.h - d.y0;
    const c = d.crop;
    let { x, y, w, h } = c;
    if (d.part === 'move') { x = clamp(c.x + dx, 0, 1 - c.w); y = clamp(c.y + dy, 0, 1 - c.h); }
    else {
      const right = c.x + c.w, bottom = c.y + c.h;
      if (d.part === 'tl' || d.part === 'bl') { x = clamp(c.x + dx, 0, right - MIN_CROP); w = right - x; }
      else w = clamp(c.w + dx, MIN_CROP, 1 - c.x);
      if (d.part === 'tl' || d.part === 'tr') { y = clamp(c.y + dy, 0, bottom - MIN_CROP); h = bottom - y; }
      else h = clamp(c.h + dy, MIN_CROP, 1 - c.y);
    }
    setXf({ crop: cleanCrop({ x, y, w, h }) });
  };

  // ── Keys: space plays, ← → step a frame (shift: ten), I / O set the active segment's ends ──
  const setInAtPlayhead = () => { const s = segs[act]; patchSeg(act, { in: clamp(tRef.current, 0, s.out - minLen) }); };
  const setOutAtPlayhead = () => { const s = segs[act]; patchSeg(act, { out: clamp(tRef.current, s.in + minLen, dur) }); };
  const onKey = (e: React.KeyboardEvent) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if ([' ', 'ArrowLeft', 'ArrowRight', 'i', 'I', 'o', 'O'].includes(e.key)) e.stopPropagation();
    if (e.key === ' ') { e.preventDefault(); togglePlay(); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); step((e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 10 : 1)); }
    else if ((e.key === 'i' || e.key === 'I') && caps.trim) setInAtPlayhead();
    else if ((e.key === 'o' || e.key === 'O') && caps.trim) setOutAtPlayhead();
  };

  // ── Layout ──
  const small: CSSProperties = { fontSize: 11.5, color: tk.text.muted, fontVariantNumeric: 'tabular-nums' };
  const label: CSSProperties = { font: `600 10.5px ${fontFamily.ui}`, letterSpacing: '0.04em', textTransform: 'uppercase', color: tk.text.faint };
  const btn = (on = false): CSSProperties => ({
    height: 28, padding: '0 9px', border: `1px solid ${on ? tk.accent.base : tk.border.default}`, borderRadius: radius.sm, cursor: 'pointer',
    background: on ? tk.bg.selected : tk.bg.panel, color: on ? tk.accent.text : tk.text.secondary, font: `500 12px ${fontFamily.ui}`, whiteSpace: 'nowrap',
  });
  const mini: CSSProperties = { ...btn(), height: 22, padding: '0 6px', fontSize: 11 };
  const seg = <V extends string | number>(v: V, opts: [V, string][], set: (v: V) => void, aria?: string) => (
    <div role="radiogroup" aria-label={aria} style={{ display: 'flex', background: tk.bg.field, borderRadius: radius.sm, padding: 2, gap: 2 }}>
      {opts.map(([k, l]) => (
        <button key={String(k)} type="button" role="radio" aria-checked={v === k} onClick={() => set(k)} style={{
          flex: 1, height: 24, padding: '0 6px', border: 0, borderRadius: 4, cursor: 'pointer', font: `500 11.5px ${fontFamily.ui}`, whiteSpace: 'nowrap',
          background: v === k ? tk.bg.panel : 'transparent', color: v === k ? tk.text.primary : tk.text.muted, boxShadow: v === k ? tk.shadow.float : 'none',
        }}>{l}</button>
      ))}
    </div>
  );
  const kept = segs.reduce((a, s) => a + Math.max(0, s.out - s.in), 0);
  const frameNo = Math.floor(t * fps + 1e-6);
  // The result thumbnails fit a 92 × 72 box, whatever the shape after crop and rotation.
  const resW = Math.round(Math.min(92, 72 * outAspect)), resH = Math.round(resW / Math.max(0.05, outAspect));
  const showSide = caps.edit;
  const showFrame = caps.crop || caps.rotate || caps.flip;
  const curSeg = playback && result ? cpAt(resolved, rClock, speed, hostLoop) : null;

  const readout = !result ? `${fmt(t)} / ${fmt(dur)} · frame ${frameNo}`
    : playback ? `${fmt(rClock)} / ${fmt(outLen)} · source ${fmt(t)}${curSeg && resolved.length > 1 ? ` · segment ${curSeg.k + 1}${curSeg.reverse ? ' ◀' : ''}` : curSeg?.reverse ? ' ◀' : ''}`
      : seq.length ? `frame ${rIdx + 1} / ${seq.length} · source ${fmt(seq[rIdx] ?? t)}` : 'No frames';

  return (
    <div tabIndex={0} onKeyDown={onKey} style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, outline: 'none', font: `12.5px ${fontFamily.ui}` }}>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 14, padding: '14px 16px 0', flexWrap: 'wrap', overflow: 'auto' }}>
        {/* Preview + transport */}
        <div style={{ flex: '1 1 420px', minWidth: 280, minHeight: 220, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* Absolutely placed: a canvas's own size must not push the transport out of the window. */}
          <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
            <canvas ref={pv.ref} onPointerDown={onPvDown} onPointerMove={onPvMove} onPointerUp={() => { drag.current = null; }}
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', borderRadius: radius.md, background: '#000', cursor: cropMode && !result ? 'move' : 'pointer', touchAction: 'none' }}
              aria-label="Preview: click to play or pause" />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {caps.edit && seg<ClipPreviewMode>(mode, [['source', 'Source'], ['result', 'Result']], setMode, 'Preview')}
            <button type="button" style={btn()} onClick={() => step(-1)} title="Back a frame (←)" aria-label="Back a frame">◀︎|</button>
            <button type="button" style={{ ...btn(playing), minWidth: 64 }} onClick={togglePlay} title="Play / pause (space)">{playing ? '❚❚ Pause' : '▶ Play'}</button>
            <button type="button" style={btn()} onClick={() => step(1)} title="Forward a frame (→)" aria-label="Forward a frame">|▶︎</button>
            {!result && caps.trim && <button type="button" style={btn(loop)} onClick={() => setLoop(v => !v)} title="Play only the kept segments, in order, round and round (forwards: Result plays them as the host will)">⟲ Loop selection</button>}
            {result && !playback && seq.length > 0 && seg<number>(rate, CUBE_RATES.map(r => [r, r ? `${r} fps` : 'Match'] as [number, string]), setRate, 'Result frame rate')}
            <span style={{ ...small, marginLeft: 'auto', color: tk.text.secondary }}>{readout}</span>
          </div>
          {result && (
            <span style={{ ...small, fontSize: 10.5, color: tk.text.faint }}>
              {playback
                ? `Result: the clip as it will play${resolved.length > 1 ? ', segments in order' : ''}${resolved.some(s => s.reverse) ? ', reversed ones backwards' : ''}, at ${speed}×, ${hostLoop ? 'looping' : 'once'}${isIdentity(value.xf) ? '' : ', cropped / turned'}.`
                : `Result: the ${seq.length} sampled frames in cube order${rate ? `, ${rate} a second` : ', in the time they span'}${isIdentity(value.xf) ? '' : ', cropped / turned'}. The lit tick is the frame showing.`}
            </span>
          )}
        </div>

        {/* Side panel */}
        {showSide && (
          <div style={{ flex: '0 1 300px', minWidth: 250, maxHeight: '100%', display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto', paddingBottom: 6 }}>
            {caps.segments ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <span style={label}>Segments</span>
                  <button type="button" style={{ ...mini, marginLeft: 'auto' }} onClick={addSegment} disabled={segs.length >= MAX_SEGMENTS} title="Keep another stretch of the video, played after this one">+ Add segment</button>
                </div>
                {segs.map((s, i) => {
                  const p = plan?.segments[i];
                  const on = i === act;
                  return (
                    <div key={i} onClick={() => { setActive(i); seek(s.reverse ? s.out - 1 / fps : s.in); }}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', borderRadius: radius.sm, cursor: 'pointer', background: on ? alpha(YELLOW, 0.16) : tk.bg.field, border: `1px solid ${on ? alpha(YELLOW, 0.8) : 'transparent'}` }}>
                      <b style={{ width: 18, height: 18, borderRadius: 4, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: on ? YELLOW : tk.bg.panel, color: on ? '#2a2000' : tk.text.secondary, fontSize: 11 }}>{i + 1}</b>
                      <span style={{ ...small, color: tk.text.secondary, flex: 1, minWidth: 0 }}>
                        {s.in.toFixed(2)}–{s.out.toFixed(2)} s
                        <span style={{ color: tk.text.faint }}>{p && caps.frameSamples ? ` · ${p.frames} fr` : ''}</span>
                      </span>
                      {caps.reverse && <button type="button" style={{ ...mini, ...(s.reverse ? { borderColor: tk.accent.base, color: tk.accent.text, background: tk.bg.selected } : {}) }} title="Play this segment backwards" aria-pressed={!!s.reverse}
                        onClick={e => { e.stopPropagation(); patchSeg(i, { reverse: !s.reverse }); }}>⇄</button>}
                      <button type="button" style={mini} disabled={i === 0} title="Earlier in the order" onClick={e => { e.stopPropagation(); moveSegment(i, -1); }}>↑</button>
                      <button type="button" style={mini} disabled={i === segs.length - 1} title="Later in the order" onClick={e => { e.stopPropagation(); moveSegment(i, 1); }}>↓</button>
                      <button type="button" style={mini} disabled={segs.length <= 1} title="Remove this segment" onClick={e => { e.stopPropagation(); removeSegment(i); }}>×</button>
                    </div>
                  );
                })}
                {caps.distribute && segs.length > 1 && (
                  <>
                    <span style={small}>Frames per segment</span>
                    {seg(value.distribute, [['proportional', 'By length'], ['equal', 'Equal']], v => onChange({ ...valueRef.current, distribute: v }))}
                  </>
                )}
              </div>
            ) : caps.trim && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={label}>Trim</span>
                <span style={{ ...small, color: tk.text.secondary }}>{`In ${fmt(segs[0].in)} · Out ${fmt(segs[0].out)}`}</span>
                <span style={small}>Drag the yellow handles on the strip, or press I / O at the playhead.</span>
              </div>
            )}

            {side}

            {(caps.speed || caps.loop) && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={label}>Playback</span>
                {caps.speed && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {seg<number>(SPEEDS.includes(speed) ? speed : -1, SPEEDS.map(s => [s, `${s}×`] as [number, string]), v => onChange({ ...valueRef.current, speed: v }), 'Playback speed')}
                    <input type="number" min={0.05} max={8} step={0.05} value={speed} aria-label="Playback speed"
                      onChange={e => { const v = Number(e.target.value); if (Number.isFinite(v) && v > 0) onChange({ ...valueRef.current, speed: clamp(v, 0.05, 8) }); }}
                      style={{ width: 56, height: 26, border: `1px solid ${tk.border.default}`, borderRadius: 6, background: tk.bg.field, color: tk.text.primary, font: `12px ${fontFamily.ui}`, padding: '0 6px' }} />
                  </div>
                )}
                {caps.loop && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, ...small, color: tk.text.secondary, cursor: 'pointer' }}>
                    <input type="checkbox" checked={hostLoop} onChange={e => onChange({ ...valueRef.current, loop: e.target.checked })} />
                    Loop: start over after the last segment
                  </label>
                )}
                <span style={small}>{`Plays ${fmt(outLen)} of clock${hostLoop ? ', round and round' : ', then holds its last frame'}.`}</span>
              </div>
            )}

            {caps.ramp && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={label}>Speed ramp</span>
                {seg(value.ramp, [['none', 'Even'], ['easeIn', 'Ease in'], ['easeOut', 'Ease out']], v => onChange({ ...valueRef.current, ramp: v }))}
                <span style={small}>{value.ramp === 'none' ? 'Frames evenly spaced through each segment.' : value.ramp === 'easeIn' ? 'Frames bunch up at the start of each segment: it starts slow.' : 'Frames bunch up at the end of each segment: it slows down.'}</span>
              </div>
            )}

            {showFrame && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={label}>Frame</span>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {caps.crop && <button type="button" style={btn(cropMode)} onClick={() => { if (result) setMode('source'); setCropMode(v => !v); }} title="Drag the rectangle on the preview" aria-pressed={cropMode}>Crop</button>}
                  {caps.rotate && <button type="button" style={btn(value.xf.rotate !== 0)} onClick={() => setXf({ rotate: (((value.xf.rotate + 90) % 360) as ClipTransform['rotate']) })} title="Turn 90° clockwise">⟳ {value.xf.rotate}°</button>}
                  {caps.flip && <button type="button" style={btn(value.xf.flipX)} onClick={() => setXf({ flipX: !value.xf.flipX })} title="Mirror left to right" aria-pressed={value.xf.flipX}>⇋ Flip</button>}
                  {caps.flip && <button type="button" style={btn(value.xf.flipY)} onClick={() => setXf({ flipY: !value.xf.flipY })} title="Mirror top to bottom" aria-pressed={value.xf.flipY}>⇵ Flip</button>}
                  {!isIdentity(value.xf) && <button type="button" style={btn()} onClick={() => { setXf({ crop: { ...FULL_CROP }, rotate: 0, flipX: false, flipY: false }); setCropMode(false); }}>Reset</button>}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={label}>Result</span>
              <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
                {['First', 'Middle', 'Last'].map((n, i) => (
                  <figure key={n} style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'center' }}>
                    <canvas ref={resultRefs[i]} width={resW * 2} height={resH * 2} style={{ width: resW, height: resH, borderRadius: 4, background: '#000' }} />
                    <figcaption style={{ ...small, fontSize: 10.5 }}>{n}{pick ? ` · ${pick[i].toFixed(2)} s` : ''}</figcaption>
                  </figure>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Trimmer */}
      <div style={{ padding: '10px 16px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <b style={{ fontSize: 12.5, color: tk.text.primary, fontVariantNumeric: 'tabular-nums' }}>
            {plan && caps.frameSamples ? `${plan.frames} frames · one every ${plan.every < 1 ? `${plan.every.toFixed(plan.every < 0.1 ? 3 : 2)} s` : `${plan.every.toFixed(2)} s`}`
              : playback ? `${fmt(outLen)} at ${speed}×` : ''}
          </b>
          <span style={small}>{caps.trim ? `kept ${kept.toFixed(2)} s of ${dur.toFixed(2)} s${segs.length > 1 ? ` · ${segs.length} segments, ${segs.length - 1} jump${segs.length > 2 ? 's' : ''}` : ''}` : `${dur.toFixed(2)} s · ${meta.width}×${meta.height}`}</span>
          <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
            {/* I / O as buttons, for a touch screen (and anyone who'd rather click) */}
            {caps.trim && <button type="button" style={mini} onClick={setInAtPlayhead} title="Start the active segment at the playhead (I)">Set In</button>}
            {caps.trim && <button type="button" style={{ ...mini, marginRight: 6 }} onClick={setOutAtPlayhead} title="End the active segment at the playhead (O)">Set Out</button>}
            <span style={small}>Zoom {view.z < 10 ? view.z.toFixed(1) : Math.round(view.z)}×</span>
            <button type="button" style={mini} onClick={() => zoomAt(1 / 1.6, view.t0 + vd / 2)} title="Zoom out (pinch, or ctrl + scroll)" aria-label="Zoom out">−</button>
            <button type="button" style={mini} onClick={() => zoomAt(1.6, clamp(t, view.t0, view.t0 + vd))} title="Zoom in round the playhead (pinch, or ctrl + scroll)" aria-label="Zoom in">+</button>
            {caps.trim && <button type="button" style={mini} onClick={() => { const s = segs[act]; const len = s.out - s.in; const z = clamp(dur / (len * 1.25), 1, 1e4); setView({ z, t0: clamp(s.in - len * 0.125, 0, dur - dur / z) }); }} title="Zoom to the active segment">Fit segment</button>}
            <button type="button" style={mini} onClick={() => setView({ z: 1, t0: 0 })}>All</button>
          </span>
        </div>
        <canvas ref={tl.ref} onPointerDown={onTlDown} onPointerMove={onTlMove} onPointerUp={onTlUp} onPointerCancel={onTlUp}
          onPointerLeave={() => { if (!drag.current) setCursor('default'); }}
          style={{ width: '100%', height: TL_H, display: 'block', cursor, touchAction: 'none' }}
          aria-label={caps.trim ? 'Timeline: drag the yellow handles to trim, the middle to slide; ctrl + scroll or pinch to zoom' : 'Timeline: click or drag to scrub; ctrl + scroll or pinch to zoom'} />
        <span style={{ ...small, fontSize: 10.5, color: tk.text.faint }}>
          {caps.frameSamples ? 'Ticks: the frames that will be sampled. Arrows: the jumps between segments. ' : caps.segments ? 'Arrows: the jumps between segments. ' : ''}
          {coarsePointer()
            ? `Drag the yellow handles to trim, the middle to slide, two fingers to zoom${caps.trim ? '; Set In / Set Out trim to the playhead' : ''}.`
            : `Space plays, ← → step a frame (shift: ten)${caps.trim ? `, I / O set the active segment's In / Out` : ''}.`}
        </span>
      </div>
    </div>
  );
}
