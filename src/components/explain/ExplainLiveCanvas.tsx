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
 */
import { useEffect, useRef, useState } from 'react';
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
}

export function ExplainLiveCanvas({ program, values, sel, size, rowKey }: ExplainLiveCanvasProps) {
  const tk = useTokens();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rangeRef = useRef<HTMLSpanElement>(null);
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
    const t0 = performance.now();
    const st = useNodeGraphStore.getState();
    const clockStart = st.currentTime ?? 0;
    const clockRuns = st.timePlaying !== false;
    renderer.debug.onShaderError = () => { failed = true; };

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
      u.u_time.value = clockStart + (clockRuns ? (now - t0) / 1000 : 0);
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

    const lost = (e: Event) => { e.preventDefault(); };
    canvas.addEventListener('webglcontextlost', lost);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      canvas.removeEventListener('webglcontextlost', lost);
      drawNow.current = () => {};
      if (mesh) scene.remove(mesh);
      material?.dispose();
      geometry.dispose();
      rangeTarget.dispose();
      // Give the context back: the view is closing, the main canvas takes the GPU again
      renderer.dispose();
      renderer.forceContextLoss();
    };
  }, [size]);

  useEffect(() => { drawNow.current(); }, [program, values, sel]);

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
    </div>
  );
}
