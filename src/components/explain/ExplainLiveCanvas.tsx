/**
 * The explain view's big picture (LineExplainView.tsx): a live render of the selected row of a line's
 * build-up, drawn every frame on its own small WebGL context while the view is open. The program
 * (liveRender.ts) holds every row; `sel` picks one with a uniform, so stepping is instant. Animated
 * inputs (the clock) move: u_time runs from the main clock's value when the view opened, while time
 * is playing. The main canvas is held meanwhile (lib/previewHold.ts), so this gets the GPU.
 *
 * The range (a float's black…white, a vec2's red / green) is measured a few times a second from a
 * small float read-back of the raw value, and shown under the picture without a React render.
 * The context is given back when the view closes.
 *
 * When the line moves with time (`timeNames`, see timeNames.ts) the picture gets its own clock:
 * play / pause, a scrubber, a speed, and a filmstrip of the picture at even steps across a span of
 * seconds, so you can see what time does to it at a glance.
 */
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../ui/Icon';
import * as THREE from 'three';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { showValue } from '../../lib/glslPatterns';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { uniformsOf } from './buildUpHost';
import { compsOf, rawRange, type LiveProgram } from './liveRender';

const VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 1.0);
}`.trim();

/** Most pixels on a side (the canvas is drawn at the screen's density up to this). */
const MAX_PX = 900;
/** Side of the float target the range is read back from, and how often. */
const RANGE_PX = 48;
const RANGE_EVERY_MS = 250;
/** Filmstrip: how many frames, and their size. */
const STRIP_FRAMES = 6;
const STRIP_PX = 96;
const SPEEDS = [0.25, 0.5, 1, 2, 4] as const;
const SPANS = [1, 2, 4, 8] as const;

export interface ExplainLiveCanvasProps {
  program: LiveProgram | null;
  /** The program's uniform values (its own and the overrides'), read every frame. */
  values: Record<string, number | number[]>;
  /** The row slot to draw (u_pvSel). */
  sel: number;
  /** CSS pixels on a side. */
  size: number;
  /** The row's key, for tests and the label. */
  rowKey: string;
  /** The names the line reads that move with time; empty or absent: no Time controls. */
  timeNames?: readonly string[];
}

/** The picture's own clock: where it is, whether it runs, how fast. */
interface Clock { t: number; playing: boolean; speed: number }

export function ExplainLiveCanvas({ program, values, sel, size, rowKey, timeNames }: ExplainLiveCanvasProps) {
  const tk = useTokens();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rangeRef = useRef<HTMLSpanElement>(null);
  const timeLabelRef = useRef<HTMLSpanElement>(null);
  const scrubRef = useRef<HTMLInputElement>(null);
  const timed = !!timeNames && timeNames.length > 0;
  // The clock starts where the main one was when the view opened, running if it was
  const clock = useRef<Clock | null>(null);
  if (!clock.current) {
    const st = useNodeGraphStore.getState();
    clock.current = { t: st.currentTime ?? 0, playing: st.timePlaying !== false, speed: 1 };
  }
  const [playing, setPlayingState] = useState(clock.current.playing);
  const [speed, setSpeedState] = useState(clock.current.speed);
  const [span, setSpan] = useState<number>(2);
  const [stripOn, setStripOn] = useState(false);
  const [strip, setStrip] = useState<{ t: number; url: string }[]>([]);
  const snap = useRef<(times: number[]) => string[]>(() => []);
  const [problem, setProblem] = useState<string | null>(null);
  // What the loop reads each frame (no re-creating the renderer when these change)
  const live = useRef({ program, values, sel });
  live.current = { program, values, sel };
  const drawNow = useRef<() => void>(() => {});

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
    } catch {
      setProblem('The picture can’t be drawn here (no WebGL).');
      return;
    }
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    camera.position.z = 1;
    const geometry = new THREE.PlaneGeometry(2, 2);
    const rangeTarget = new THREE.WebGLRenderTarget(RANGE_PX, RANGE_PX, {
      type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false,
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false,
    });
    const readBuf = new Float32Array(RANGE_PX * RANGE_PX * 4);
    let mesh: THREE.Mesh | null = null;
    let material: THREE.ShaderMaterial | null = null;
    let builtKey = '';
    let failed = false;
    let range: [number, number] = [0, 1];
    let lastRange = -Infinity;
    let lastSel = -1;
    let lastNow: number | null = null;
    let lastLabel = -Infinity;
    renderer.debug.onShaderError = () => { failed = true; };
    const stripTarget = new THREE.WebGLRenderTarget(STRIP_PX, STRIP_PX, { depthBuffer: false, stencilBuffer: false, generateMipmaps: false });
    const stripBuf = new Uint8Array(STRIP_PX * STRIP_PX * 4);
    const stripCanvas = document.createElement('canvas');
    stripCanvas.width = stripCanvas.height = STRIP_PX;

    const build = (p: LiveProgram) => {
      if (mesh) { scene.remove(mesh); material?.dispose(); }
      failed = false;
      setProblem(null);
      material = new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: p.fs,
        uniforms: {
          u_time: { value: 0 }, u_resolution: { value: new THREE.Vector2(1, 1) }, u_mouse: { value: new THREE.Vector2(0, 0) },
          ...uniformsOf(live.current.values),
          u_pvSel: { value: 0 }, u_pvRaw: { value: 0 }, u_pvRange: { value: new THREE.Vector2(0, 1) }, u_pvComps: { value: 1 },
        },
      });
      mesh = new THREE.Mesh(geometry, material);
      scene.add(mesh);
      builtKey = p.key;
      lastRange = -Infinity;
    };

    const setUniform = (u: Record<string, THREE.IUniform>, k: string, v: number | number[]) => {
      const cur = u[k];
      if (!cur) { u[k] = uniformsOf({ [k]: v })[k]; return; }
      if (Array.isArray(v) && cur.value && typeof (cur.value as THREE.Vector4).fromArray === 'function') (cur.value as THREE.Vector4).fromArray(v);
      else cur.value = v;
    };

    const draw = (now: number) => {
      const { program: p, values: vals, sel: s } = live.current;
      if (!p) return;
      if (p.key !== builtKey) build(p);
      if (!material || failed) return;
      const u = material.uniforms;
      for (const [k, v] of Object.entries(vals)) setUniform(u, k, v);
      // The picture's clock moves by the frame's time × its speed while playing
      const c = clock.current!;
      if (lastNow !== null && c.playing) c.t += ((now - lastNow) / 1000) * c.speed;
      lastNow = now;
      u.u_time.value = c.t;
      if (now - lastLabel > 100) {
        lastLabel = now;
        if (timeLabelRef.current) timeLabelRef.current.textContent = `${c.t.toFixed(2)} s`;
        const sc = scrubRef.current;
        if (sc && document.activeElement !== sc) sc.value = String(c.t % Number(sc.max || 1));
      }
      u.u_pvSel.value = s;
      const comps = compsOf(p.slotTypes[s] ?? 'float');
      u.u_pvComps.value = comps;
      // The range now and then (and at once after a change of row): the raw value, read back small
      if (s !== lastSel || now - lastRange > RANGE_EVERY_MS) {
        lastSel = s;
        lastRange = now;
        u.u_pvRaw.value = 1;
        (u.u_resolution.value as THREE.Vector2).set(RANGE_PX, RANGE_PX);
        renderer.setRenderTarget(rangeTarget);
        renderer.render(scene, camera);
        renderer.setRenderTarget(null);
        if (!failed) {
          renderer.readRenderTargetPixels(rangeTarget, 0, 0, RANGE_PX, RANGE_PX, readBuf);
          const r = rawRange(readBuf, comps);
          if (r) range = r;
          const el = rangeRef.current;
          if (el) el.textContent = r ? (r[1] - r[0] < 1e-6 ? `the same everywhere: ${showValue(r[0])}` : `${showValue(r[0])} … ${showValue(r[1])}${comps === 1 ? ' (black … white)' : comps === 2 ? ' (x red, y green)' : ''}`) : 'no finite values';
        }
        u.u_pvRaw.value = 0;
      }
      (u.u_pvRange.value as THREE.Vector2).set(range[0], range[1]);
      const w = canvas.width, h = canvas.height;
      (u.u_resolution.value as THREE.Vector2).set(w, h);
      renderer.setViewport(0, 0, w, h);
      renderer.render(scene, camera);
      if (failed) setProblem('This line doesn’t compile yet, so there is nothing to draw.');
    };

    // Sized to the screen's density, up to MAX_PX
    const px = Math.min(MAX_PX, Math.round(size * (window.devicePixelRatio || 1)));
    renderer.setPixelRatio(1);
    renderer.setSize(px, px, false);

    let raf = 0;
    let alive = true;
    const loop = (now: number) => {
      if (!alive) return;
      if (!document.hidden) draw(now);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    // A change (another row, an override, a new program) draws at once, not on the next frame
    drawNow.current = () => { if (alive) draw(performance.now()); };
    drawNow.current();

    // The filmstrip: the selected row at each time, drawn small into a target and read back as images
    snap.current = (times: number[]) => {
      const { program: p, values: vals, sel: s } = live.current;
      if (!alive || !p || failed) return [];
      if (p.key !== builtKey) build(p);
      if (!material) return [];
      const u = material.uniforms;
      for (const [k, v] of Object.entries(vals)) setUniform(u, k, v);
      u.u_pvSel.value = s;
      u.u_pvComps.value = compsOf(p.slotTypes[s] ?? 'float');
      (u.u_pvRange.value as THREE.Vector2).set(range[0], range[1]);
      (u.u_resolution.value as THREE.Vector2).set(STRIP_PX, STRIP_PX);
      const ctx2d = stripCanvas.getContext('2d');
      if (!ctx2d) return [];
      const urls = times.map(t => {
        u.u_time.value = t;
        renderer.setRenderTarget(stripTarget);
        renderer.render(scene, camera);
        renderer.readRenderTargetPixels(stripTarget, 0, 0, STRIP_PX, STRIP_PX, stripBuf);
        // GL rows run bottom-up: flip into the image
        const img = ctx2d.createImageData(STRIP_PX, STRIP_PX);
        for (let y = 0; y < STRIP_PX; y++) img.data.set(stripBuf.subarray((STRIP_PX - 1 - y) * STRIP_PX * 4, (STRIP_PX - y) * STRIP_PX * 4), y * STRIP_PX * 4);
        ctx2d.putImageData(img, 0, 0);
        return stripCanvas.toDataURL('image/png');
      });
      renderer.setRenderTarget(null);
      u.u_time.value = clock.current!.t;
      return urls;
    };

    const lost = (e: Event) => { e.preventDefault(); };
    canvas.addEventListener('webglcontextlost', lost);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      canvas.removeEventListener('webglcontextlost', lost);
      drawNow.current = () => {};
      snap.current = () => [];
      if (mesh) scene.remove(mesh);
      material?.dispose();
      geometry.dispose();
      rangeTarget.dispose();
      stripTarget.dispose();
      // Give the context back: the view is closing, the main canvas takes the GPU again
      renderer.dispose();
      renderer.forceContextLoss();
    };
  }, [size]);

  useEffect(() => { drawNow.current(); }, [program, values, sel]);

  const setPlaying = (on: boolean) => { clock.current!.playing = on; setPlayingState(on); };
  const setSpeed = (v: number) => { clock.current!.speed = v; setSpeedState(v); };
  const scrubTo = (t: number) => { clock.current!.t = t; drawNow.current(); };
  // The filmstrip follows the row, the values and the span (from the clock's time now), a moment after they settle
  useEffect(() => {
    if (!timed || !stripOn || !program) { setStrip([]); return; }
    const id = setTimeout(() => {
      const from = clock.current!.t;
      const times = Array.from({ length: STRIP_FRAMES }, (_, i) => from + (span * i) / (STRIP_FRAMES - 1));
      setStrip(snap.current(times).map((url, i) => ({ t: times[i], url })));
    }, 120);
    return () => clearTimeout(id);
  }, [timed, stripOn, program, values, sel, span]);

  const chip = (on: boolean): React.CSSProperties => ({
    height: 24, padding: '0 8px', border: 0, borderRadius: radius.sm, cursor: 'pointer', font: `600 11px ${fontFamily.mono}`,
    background: on ? tk.bg.selected : tk.bg.field, color: on ? tk.accent.text : tk.text.muted,
  });

  return (
    <div data-explain-live="" data-live-row={rowKey} data-live-sel={sel} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ position: 'relative', width: size, maxWidth: '100%', aspectRatio: '1 / 1', borderRadius: radius.lg, overflow: 'hidden', background: '#0d0d12', border: `1px solid ${tk.border.subtle}` }}>
        <canvas ref={canvasRef} data-explain-live-canvas="" aria-label="The selected step, drawn live" style={{ display: 'block', width: '100%', height: '100%', visibility: program && !problem ? 'visible' : 'hidden' }} />
        {(problem || !program) && (
          <span data-explain-live-problem="" style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, textAlign: 'center', font: `500 12px/1.5 ${fontFamily.ui}`, color: '#a9a9b8' }}>
            {problem ?? 'Nothing to draw for this line yet.'}
          </span>
        )}
      </div>
      <span ref={rangeRef} data-explain-live-range="" style={{ font: `500 11px ${fontFamily.mono}`, color: tk.text.muted, minHeight: 15 }} />
      {timed && (
        <div data-explain-time="" style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 12px', borderRadius: radius.lg, background: tk.bg.subtle, border: `1px solid ${tk.border.subtle}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Icon name="clock" size={13} style={{ color: tk.accent.base }} />
            <span style={{ font: `600 12px ${fontFamily.ui}`, color: tk.text.primary }}>Time</span>
            <span data-explain-time-names="" style={{ flex: 1, minWidth: 0, font: `500 11px ${fontFamily.ui}`, color: tk.text.faint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              this line moves with {timeNames!.join(', ')}
            </span>
            <span ref={timeLabelRef} data-explain-time-now="" style={{ font: `500 11px ${fontFamily.mono}`, color: tk.text.muted }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button type="button" data-explain-time-play="" aria-pressed={playing} aria-label={playing ? 'Pause the picture’s clock' : 'Play the picture’s clock'}
              onClick={() => setPlaying(!playing)}
              style={{ width: 28, height: 28, border: 0, borderRadius: radius.sm, background: tk.bg.field, color: tk.text.primary, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Icon name={playing ? 'pause' : 'play'} size={12} />
            </button>
            {/* Scrub one span's worth of seconds; dragging pauses, so the picture holds where you leave it */}
            <input ref={scrubRef} type="range" data-explain-time-scrub="" aria-label="Scrub the picture’s time" min={0} max={span} step={0.01}
              defaultValue={clock.current!.t % span}
              onPointerDown={() => setPlaying(false)}
              onInput={e => { const base = Math.floor(clock.current!.t / span) * span; scrubTo(base + Number((e.target as HTMLInputElement).value)); }}
              style={{ flex: 1, minWidth: 0, accentColor: tk.accent.base }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
            <span style={{ font: `500 11px ${fontFamily.ui}`, color: tk.text.faint, marginRight: 2 }}>Speed</span>
            {SPEEDS.map(v => (
              <button key={v} type="button" data-explain-time-speed={v} aria-pressed={speed === v} onClick={() => setSpeed(v)} style={chip(speed === v)}>{v}×</button>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
            <button type="button" data-explain-time-strip="" aria-expanded={stripOn} onClick={() => setStripOn(!stripOn)}
              style={{ ...chip(stripOn), display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: fontFamily.ui }}>
              <Icon name={stripOn ? 'chevD' : 'chevR'} size={10} />Over time
            </button>
            {stripOn && SPANS.map(v => (
              <button key={v} type="button" data-explain-time-span={v} aria-pressed={span === v} onClick={() => setSpan(v)} style={chip(span === v)}>{v} s</button>
            ))}
          </div>
          {stripOn && (
            <div data-explain-filmstrip="" style={{ display: 'grid', gridTemplateColumns: `repeat(${STRIP_FRAMES}, minmax(0, 1fr))`, gap: 4 }}>
              {strip.map(f => (
                <button key={f.t} type="button" data-explain-frame={f.t.toFixed(2)} title={`Show the picture at ${f.t.toFixed(2)} s`}
                  onClick={() => { setPlaying(false); scrubTo(f.t); }}
                  style={{ padding: 0, border: 0, background: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'center' }}>
                  <img src={f.url} alt={`At ${f.t.toFixed(2)} s`} style={{ width: '100%', aspectRatio: '1 / 1', borderRadius: radius.sm, display: 'block', imageRendering: 'auto' }} />
                  <span style={{ font: `500 10px ${fontFamily.mono}`, color: tk.text.faint }}>+{(f.t - strip[0].t).toFixed(1)}s</span>
                </button>
              ))}
              {strip.length === 0 && <span style={{ gridColumn: '1 / -1', font: `500 11px ${fontFamily.ui}`, color: tk.text.faint }}>Drawing…</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
