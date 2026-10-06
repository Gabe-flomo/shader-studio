/**
 * ClipEditor — trims a video before it feeds the node tree (lib/media/clip.ts):
 * a preview player (play / pause, scrub, frame step, loop the selection), a
 * Photos-style trimmer along a filmstrip (yellow In / Out handles, the rest
 * dimmed, drag the middle to slide, pinch or ctrl-scroll to zoom), ticks at
 * the exact frames that will be sampled, several kept segments played one
 * after another (reorder, reverse, the jumps drawn under the strip), a speed
 * ramp, and a crop / rotate / flip with the resulting first, middle and last
 * frames.
 *
 * Controlled: `value` + `onChange`. The host passes `plan` (the sample times
 * its node would take from `value`) to draw the ticks. Only the Time Cube uses
 * it now (components/timeCube/TimeCubeClipModal.tsx). Video Input, the Video
 * layer and Bake could adopt it: each would map ClipSettings onto its own
 * playback (segments → a play list, xf → a draw transform) and pass no plan.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import {
  FULL_CROP, MAX_SEGMENTS, MIN_CROP, cleanCrop, drawClipFrame, isIdentity,
  type ClipCrop, type ClipSettings, type ClipSegment, type ClipTransform, type PlannedSegment,
} from '../../lib/media/clip';
import { openVideoReader, type FrameReader } from '../../lib/timeCube/frames';

/** Where the editor's frames come from: a video file, or a picture painted at any time (a built-in clip). */
export type ClipFrameSource =
  | { kind: 'video'; blob: Blob }
  | { kind: 'painted'; paint: (g: CanvasRenderingContext2D, t: number, x: number, y: number, w: number, h: number) => void };

export interface ClipMeta { width: number; height: number; duration: number }

/** The frames the host would sample from the current value: drawn as ticks on the strip. */
export interface ClipPreviewPlan { times: number[]; segments: PlannedSegment[]; frames: number; every: number }

const YELLOW = '#ffc53d';
const STRIP_THUMBS = 28;
const TICK_H = 16, STRIP_H = 58, JUMP_H = 26;
const TL_H = TICK_H + STRIP_H + JUMP_H;
const HANDLE_W = 12;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const fmt = (t: number) => `${t.toFixed(2)} s`;

/** Segments with explicit outs (an out at or before its in: the end of the video). */
export function explicitSegments(segs: readonly ClipSegment[], duration: number): ClipSegment[] {
  const out = segs.map(s => {
    const a = clamp(s.in, 0, Math.max(0, duration - 0.05));
    const b = s.out > a ? Math.min(s.out, duration) : duration;
    return { in: a, out: Math.max(b, Math.min(duration, a + 0.05)), ...(s.reverse ? { reverse: true } : {}) };
  });
  return out.length ? out : [{ in: 0, out: duration }];
}

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

export function ClipEditor({ source, meta, value, onChange, plan, side, fps = 30 }: {
  source: ClipFrameSource;
  meta: ClipMeta;
  value: ClipSettings;
  onChange: (v: ClipSettings) => void;
  plan?: ClipPreviewPlan | null;
  /** Extra controls for the side panel (the host's frame budget). */
  side?: ReactNode;
  /** Frames a second, for frame stepping and the frame readout (a browser does not say). */
  fps?: number;
}) {
  const tk = useTokens();
  const dur = Math.max(0.05, meta.duration);
  const minLen = Math.min(dur, 2 / fps);
  const segs = value.segments;
  const [active, setActive] = useState(0);
  const act = Math.min(active, segs.length - 1);
  const [t, setT] = useState(() => segs[0]?.in ?? 0);
  const tRef = useRef(t);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(true);
  const [cropMode, setCropMode] = useState(false);
  const [view, setView] = useState({ z: 1, t0: 0 });
  const valueRef = useRef(value);
  valueRef.current = value;

  // ── Sources: a <video> for the player, a reader for thumbnails ──
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [frameTick, setFrameTick] = useState(0);
  useEffect(() => {
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

  // Filmstrip: thumbnails along the whole video.
  const aspect = meta.width / Math.max(1, meta.height);
  const strip = useMemo(() => {
    const c = document.createElement('canvas');
    c.height = STRIP_H * 2; c.width = Math.round(STRIP_THUMBS * c.height * aspect);
    return c;
  }, [aspect]);
  const [stripTick, setStripTick] = useState(0);
  useEffect(() => {
    if (!readerOk) return;
    const g = strip.getContext('2d');
    if (!g) return;
    g.fillStyle = '#111'; g.fillRect(0, 0, strip.width, strip.height);
    const ctl = new AbortController(), tw = strip.width / STRIP_THUMBS;
    for (let i = 0; i < STRIP_THUMBS; i++) {
      void enqueue(async r => {
        if (ctl.signal.aborted) return;
        await r.draw(((i + 0.5) / STRIP_THUMBS) * dur, g, Math.round(i * tw), 0, Math.ceil(tw), strip.height, ctl.signal);
        if (i % 4 === 3 || i === STRIP_THUMBS - 1) setStripTick(n => n + 1);
      });
    }
    return () => ctl.abort();
  }, [readerOk, strip, dur, enqueue]);

  // Result: the first, middle and last sampled frames, cropped / rotated / flipped.
  const resultRefs = [useRef<HTMLCanvasElement>(null), useRef<HTMLCanvasElement>(null), useRef<HTMLCanvasElement>(null)];
  const pick = plan && plan.times.length ? [plan.times[0], plan.times[Math.floor((plan.times.length - 1) / 2)], plan.times[plan.times.length - 1]] : null;
  const outAspect = (() => {
    const w = meta.width * value.xf.crop.w, h = meta.height * value.xf.crop.h;
    return value.xf.rotate % 180 ? h / w : w / h;
  })();
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

  // ── Player ──
  const seek = useCallback((time: number) => {
    const v = clamp(time, 0, dur - 1e-3);
    tRef.current = v; setT(v);
    const el = videoRef.current;
    if (el && Math.abs(el.currentTime - v) > 1e-4) el.currentTime = v;
  }, [dur]);
  const playSeg = useRef(0);
  const togglePlay = useCallback(() => {
    setPlaying(p => {
      const next = !p;
      const el = videoRef.current;
      if (next) {
        const list = valueRef.current.segments;
        if (loop) {
          const k = list.findIndex(s => tRef.current >= s.in && tRef.current < s.out - 1e-3);
          playSeg.current = k >= 0 ? k : 0;
          if (k < 0) seek(list[0].in);
        } else if (tRef.current >= dur - 2 / fps) seek(0);
        void el?.play().catch(() => {});
      } else el?.pause();
      return next;
    });
  }, [loop, dur, fps, seek]);
  useEffect(() => {
    if (!playing) return;
    let raf = 0, last = performance.now();
    const tick = (now: number) => {
      const el = videoRef.current;
      let time = el ? el.currentTime : tRef.current + (now - last) / 1000;
      last = now;
      const list = valueRef.current.segments;
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
  }, [playing, loop, dur]);
  useEffect(() => () => videoRef.current?.pause(), []);
  const step = useCallback((n: number) => {
    if (playing) { setPlaying(false); videoRef.current?.pause(); }
    seek(Math.round(tRef.current * fps + n) / fps + 1e-4);
  }, [playing, fps, seek]);

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
  const vd = dur / view.z;
  const tl = useFitCanvas(useCallback((g, W) => {
    const X = (time: number) => ((time - view.t0) / vd) * W;
    g.clearRect(0, 0, W, TL_H);
    // Filmstrip: the visible part of the whole-video strip.
    const sx = (view.t0 / dur) * strip.width, sw = (vd / dur) * strip.width;
    g.save();
    g.beginPath(); g.roundRect(0, TICK_H, W, STRIP_H, 6); g.clip();
    g.drawImage(strip, sx, 0, sw, strip.height, 0, TICK_H, W, STRIP_H);
    // Dim what no segment keeps.
    const kept = segs.map(s => [s.in, s.out] as const).sort((a, b) => a[0] - b[0]);
    g.fillStyle = 'rgba(8,8,12,0.62)';
    let from = 0;
    for (const [a, b] of kept) { if (a > from) g.fillRect(X(from), TICK_H, X(a) - X(from), STRIP_H); from = Math.max(from, b); }
    if (from < dur) g.fillRect(X(from), TICK_H, X(dur) - X(from) + 1, STRIP_H);
    g.restore();
    // Segments: yellow frames, the active one with handles; a number (and ◀ when reversed).
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
      const label = `${i + 1}${s.reverse ? ' ◀' : ''}`;
      g.font = `700 11px ${fontFamily.ui}`;
      const lw = g.measureText(label).width + 10, lx = x0 + (on ? HANDLE_W + 3 : 4);
      g.fillStyle = on ? YELLOW : 'rgba(0,0,0,0.6)';
      g.beginPath(); g.roundRect(lx, TICK_H + 4, lw, 16, 4); g.fill();
      g.fillStyle = on ? '#2a2000' : '#fff';
      g.fillText(label, lx + 5, TICK_H + 16);
    }
    // Ticks: the frames that will be sampled.
    if (plan) {
      for (const p of plan.segments) {
        const on = segs[act] && Math.abs(p.in - segs[act].in) < 1e-6 && Math.abs(p.out - segs[act].out) < 1e-6;
        g.fillStyle = on ? YELLOW : tk.text.faint;
        for (let j = p.first; j < p.first + p.frames; j++) {
          const x = X(plan.times[j]);
          if (x < -1 || x > W + 1) continue;
          g.fillRect(Math.round(x) - 0.5, 3, 1, TICK_H - 6);
        }
      }
      // Jumps: from where one segment stops playing to where the next starts.
      g.strokeStyle = tk.accent.base; g.fillStyle = tk.accent.base; g.lineWidth = 1.5;
      for (let k = 0; k + 1 < plan.segments.length; k++) {
        const a = plan.segments[k], b = plan.segments[k + 1];
        if (!a.frames || !b.frames) continue;
        const xa = X(a.reverse ? a.in : a.out), xb = X(b.reverse ? b.out : b.in);
        const y0 = TICK_H + STRIP_H + 2, dip = Math.min(JUMP_H - 6, 8 + Math.abs(xb - xa) * 0.08);
        g.beginPath(); g.moveTo(xa, y0); g.bezierCurveTo(xa, y0 + dip, xb, y0 + dip, xb, y0 + 3); g.stroke();
        g.beginPath(); g.moveTo(xb, y0 + 1); g.lineTo(xb - 4, y0 + 7); g.lineTo(xb + 4, y0 + 7); g.closePath(); g.fill();
      }
    }
    // Playhead.
    const px = X(t);
    g.fillStyle = '#fff'; g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 1;
    g.fillRect(px - 1, TICK_H - 4, 2, STRIP_H + 8); g.strokeRect(px - 1.5, TICK_H - 4.5, 3, STRIP_H + 9);
  }, [view.t0, vd, dur, strip, segs, act, plan, t, tk.accent.base, tk.text.faint, stripTick])); // eslint-disable-line react-hooks/exhaustive-deps
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
  const hitTimeline = (clientX: number, clientY: number): Drag => {
    const r = tl.ref.current!.getBoundingClientRect();
    const x = clientX - r.left, y = clientY - r.top, W = r.width;
    const X = (time: number) => ((time - view.t0) / vd) * W;
    const time = tlTime(clientX);
    if (y >= TICK_H - 4 && y <= TICK_H + STRIP_H + 4) {
      const order = [act, ...segs.map((_, i) => i).filter(i => i !== act)];
      for (const i of order) {
        const s = segs[i], x0 = X(s.in), x1 = X(s.out);
        const grab = i === act ? HANDLE_W + 2 : 6;
        if (x >= x0 - 4 && x <= x0 + grab) return { kind: 'in', seg: i, t0: time, a: s.in, b: s.out };
        if (x >= x1 - grab && x <= x1 + 4) return { kind: 'out', seg: i, t0: time, a: s.in, b: s.out };
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
    const d = hitTimeline(e.clientX, e.clientY);
    drag.current = d;
    if (d.kind !== 'scrub' && d.kind !== 'crop') setActive(d.seg);
    if (d.kind === 'scrub') { if (playing) togglePlay(); seek(tlTime(e.clientX)); }
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

  // ── Preview, with the crop ──
  const frameRect = (W: number, H: number) => {
    const s = Math.min(W / meta.width, H / meta.height);
    const w = meta.width * s, h = meta.height * s;
    return { x: (W - w) / 2, y: (H - h) / 2, w, h };
  };
  const crop = value.xf.crop;
  const showCrop = cropMode || crop.w < 1 || crop.h < 1;
  const pv = useFitCanvas(useCallback((g, W, H) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    const r = frameRect(W, H);
    const el = videoRef.current;
    if (source.kind === 'video') { if (el && el.readyState >= 2) g.drawImage(el, r.x, r.y, r.w, r.h); }
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
  }, [source, t, showCrop, cropMode, crop.x, crop.y, crop.w, crop.h, frameTick, meta.width, meta.height])); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { pv.paint(); }, [pv]);

  const onPvDown = (e: React.PointerEvent) => {
    if (!cropMode) { togglePlay(); return; }
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
  const onKey = (e: React.KeyboardEvent) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if ([' ', 'ArrowLeft', 'ArrowRight', 'i', 'I', 'o', 'O'].includes(e.key)) e.stopPropagation();
    if (e.key === ' ') { e.preventDefault(); togglePlay(); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); step((e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 10 : 1)); }
    else if (e.key === 'i' || e.key === 'I') { const s = segs[act]; patchSeg(act, { in: clamp(tRef.current, 0, s.out - minLen) }); }
    else if (e.key === 'o' || e.key === 'O') { const s = segs[act]; patchSeg(act, { out: clamp(tRef.current, s.in + minLen, dur) }); }
  };

  // ── Layout ──
  const small: CSSProperties = { fontSize: 11.5, color: tk.text.muted, fontVariantNumeric: 'tabular-nums' };
  const label: CSSProperties = { font: `600 10.5px ${fontFamily.ui}`, letterSpacing: '0.04em', textTransform: 'uppercase', color: tk.text.faint };
  const btn = (on = false): CSSProperties => ({
    height: 28, padding: '0 9px', border: `1px solid ${on ? tk.accent.base : tk.border.default}`, borderRadius: radius.sm, cursor: 'pointer',
    background: on ? tk.bg.selected : tk.bg.panel, color: on ? tk.accent.text : tk.text.secondary, font: `500 12px ${fontFamily.ui}`, whiteSpace: 'nowrap',
  });
  const mini: CSSProperties = { ...btn(), height: 22, padding: '0 6px', fontSize: 11 };
  const seg = <V extends string>(v: V, opts: [V, string][], set: (v: V) => void) => (
    <div style={{ display: 'flex', background: tk.bg.field, borderRadius: radius.sm, padding: 2, gap: 2 }}>
      {opts.map(([k, l]) => (
        <button key={k} type="button" onClick={() => set(k)} style={{
          flex: 1, height: 24, border: 0, borderRadius: 4, cursor: 'pointer', font: `500 11.5px ${fontFamily.ui}`,
          background: v === k ? tk.bg.panel : 'transparent', color: v === k ? tk.text.primary : tk.text.muted, boxShadow: v === k ? tk.shadow.float : 'none',
        }}>{l}</button>
      ))}
    </div>
  );
  const kept = segs.reduce((a, s) => a + Math.max(0, s.out - s.in), 0);
  const frameNo = Math.floor(t * fps + 1e-6);
  // The result thumbnails fit a 92 × 72 box, whatever the shape after crop and rotation.
  const resW = Math.round(Math.min(92, 72 * outAspect)), resH = Math.round(resW / Math.max(0.05, outAspect));

  return (
    <div tabIndex={0} onKeyDown={onKey} style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, outline: 'none', font: `12.5px ${fontFamily.ui}` }}>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 14, padding: '14px 16px 0', flexWrap: 'wrap', overflow: 'auto' }}>
        {/* Preview + transport */}
        <div style={{ flex: '1 1 420px', minWidth: 280, minHeight: 220, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <canvas ref={pv.ref} onPointerDown={onPvDown} onPointerMove={onPvMove} onPointerUp={() => { drag.current = null; }}
            style={{ flex: 1, minHeight: 0, width: '100%', borderRadius: radius.md, background: '#000', cursor: cropMode ? 'move' : 'pointer', touchAction: 'none' }}
            aria-label="Preview: click to play or pause" />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <button type="button" style={btn()} onClick={() => step(-1)} title="Back a frame (←)">◀︎|</button>
            <button type="button" style={{ ...btn(playing), minWidth: 64 }} onClick={togglePlay} title="Play / pause (space)">{playing ? '❚❚ Pause' : '▶ Play'}</button>
            <button type="button" style={btn()} onClick={() => step(1)} title="Forward a frame (→)">|▶︎</button>
            <button type="button" style={btn(loop)} onClick={() => setLoop(v => !v)} title="Play only the kept segments, in order, round and round">⟲ Loop selection</button>
            <span style={{ ...small, marginLeft: 'auto', color: tk.text.secondary }}>{fmt(t)} / {fmt(dur)} · frame {frameNo}</span>
          </div>
        </div>

        {/* Side panel */}
        <div style={{ flex: '0 1 300px', minWidth: 250, maxHeight: '100%', display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto', paddingBottom: 6 }}>
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
                    <span style={{ color: tk.text.faint }}>{p ? ` · ${p.frames} fr` : ''}</span>
                  </span>
                  <button type="button" style={{ ...mini, ...(s.reverse ? { borderColor: tk.accent.base, color: tk.accent.text, background: tk.bg.selected } : {}) }} title="Play this segment backwards"
                    onClick={e => { e.stopPropagation(); patchSeg(i, { reverse: !s.reverse }); }}>⇄</button>
                  <button type="button" style={mini} disabled={i === 0} title="Earlier in the order" onClick={e => { e.stopPropagation(); moveSegment(i, -1); }}>↑</button>
                  <button type="button" style={mini} disabled={i === segs.length - 1} title="Later in the order" onClick={e => { e.stopPropagation(); moveSegment(i, 1); }}>↓</button>
                  <button type="button" style={mini} disabled={segs.length <= 1} title="Remove this segment" onClick={e => { e.stopPropagation(); removeSegment(i); }}>×</button>
                </div>
              );
            })}
            {segs.length > 1 && (
              <>
                <span style={small}>Frames per segment</span>
                {seg(value.distribute, [['proportional', 'By length'], ['equal', 'Equal']], v => onChange({ ...valueRef.current, distribute: v }))}
              </>
            )}
          </div>

          {side}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={label}>Speed ramp</span>
            {seg(value.ramp, [['none', 'Even'], ['easeIn', 'Ease in'], ['easeOut', 'Ease out']], v => onChange({ ...valueRef.current, ramp: v }))}
            <span style={small}>{value.ramp === 'none' ? 'Frames evenly spaced through each segment.' : value.ramp === 'easeIn' ? 'Frames bunch up at the start of each segment: it starts slow.' : 'Frames bunch up at the end of each segment: it slows down.'}</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={label}>Frame</span>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button type="button" style={btn(cropMode)} onClick={() => setCropMode(v => !v)} title="Drag the rectangle on the preview">Crop</button>
              <button type="button" style={btn(value.xf.rotate !== 0)} onClick={() => setXf({ rotate: (((value.xf.rotate + 90) % 360) as ClipTransform['rotate']) })} title="Turn 90° clockwise">⟳ {value.xf.rotate}°</button>
              <button type="button" style={btn(value.xf.flipX)} onClick={() => setXf({ flipX: !value.xf.flipX })} title="Mirror left to right">⇋ Flip</button>
              <button type="button" style={btn(value.xf.flipY)} onClick={() => setXf({ flipY: !value.xf.flipY })} title="Mirror top to bottom">⇵ Flip</button>
              {!isIdentity(value.xf) && <button type="button" style={btn()} onClick={() => { setXf({ crop: { ...FULL_CROP }, rotate: 0, flipX: false, flipY: false }); setCropMode(false); }}>Reset</button>}
            </div>
          </div>

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
      </div>

      {/* Trimmer */}
      <div style={{ padding: '10px 16px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <b style={{ fontSize: 12.5, color: tk.text.primary, fontVariantNumeric: 'tabular-nums' }}>
            {plan ? `${plan.frames} frames · one every ${plan.every < 1 ? `${plan.every.toFixed(plan.every < 0.1 ? 3 : 2)} s` : `${plan.every.toFixed(2)} s`}` : ''}
          </b>
          <span style={small}>{`kept ${kept.toFixed(2)} s of ${dur.toFixed(2)} s${segs.length > 1 ? ` · ${segs.length} segments, ${segs.length - 1} jump${segs.length > 2 ? 's' : ''}` : ''}`}</span>
          <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={small}>Zoom {view.z < 10 ? view.z.toFixed(1) : Math.round(view.z)}×</span>
            <button type="button" style={mini} onClick={() => zoomAt(1 / 1.6, view.t0 + vd / 2)} title="Zoom out (pinch, or ctrl + scroll)">−</button>
            <button type="button" style={mini} onClick={() => zoomAt(1.6, clamp(t, view.t0, view.t0 + vd))} title="Zoom in round the playhead (pinch, or ctrl + scroll)">+</button>
            <button type="button" style={mini} onClick={() => { const s = segs[act]; const len = s.out - s.in; const z = clamp(dur / (len * 1.25), 1, 1e4); setView({ z, t0: clamp(s.in - len * 0.125, 0, dur - dur / z) }); }} title="Zoom to the active segment">Fit segment</button>
            <button type="button" style={mini} onClick={() => setView({ z: 1, t0: 0 })}>All</button>
          </span>
        </div>
        <canvas ref={tl.ref} onPointerDown={onTlDown} onPointerMove={onTlMove} onPointerUp={onTlUp} onPointerCancel={onTlUp}
          onPointerLeave={() => { if (!drag.current) setCursor('default'); }}
          style={{ width: '100%', height: TL_H, display: 'block', cursor, touchAction: 'none' }}
          aria-label="Timeline: drag the yellow handles to trim, the middle to slide; ctrl + scroll or pinch to zoom" />
        <span style={{ ...small, fontSize: 10.5, color: tk.text.faint }}>
          Ticks: the frames that will be sampled. Arrows: the jumps between segments. Space plays, ← → step a frame (shift: ten), I / O set the active segment's In / Out.
        </span>
      </div>
    </div>
  );
}
