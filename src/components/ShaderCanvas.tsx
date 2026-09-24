import { useRef, useEffect } from 'react';
import * as THREE from 'three';
import { useNodeGraphStore } from '../store/useNodeGraphStore';
import { drawScopeCanvas, vectorValueRegistry, floatValueRegistry } from '../lib/scopeRegistry';
import { audioEngine } from '../lib/audioEngine';
import { audioSpectrumRegistry, drawSpectrumCanvas } from '../lib/audioSpectrumRegistry';
import { videoEngine } from '../lib/videoEngine';
import { renderKeepAlive } from '../lib/renderKeepAlive';
import { emitTimeTick, hasTimeTickListeners } from '../lib/timeTick';
import { getBreakpoint, isMobile } from '../hooks/useBreakpoint';

export type CanvasHandle = { canvas: HTMLCanvasElement };

// ── GPU particle geometry initialization by shape ─────────────────────────────
function buildParticleGeometry(count: number, shape: number): { positions: Float32Array; normDists: Float32Array } {
  const positions = new Float32Array(count * 3);
  const normDists = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    let x = 0, y = 0, z = 0, nd = 1;
    switch (shape) {
      case 0: { // Sphere — on surface
        const theta = Math.random() * Math.PI * 2;
        const phi   = Math.acos(2 * Math.random() - 1);
        x = Math.sin(phi) * Math.cos(theta);
        y = Math.sin(phi) * Math.sin(theta);
        z = Math.cos(phi);
        nd = 1.0;
        break;
      }
      case 1: { // Ball — uniform in volume
        const theta = Math.random() * Math.PI * 2;
        const phi   = Math.acos(2 * Math.random() - 1);
        const r     = Math.cbrt(Math.random());
        x = r * Math.sin(phi) * Math.cos(theta); y = r * Math.sin(phi) * Math.sin(theta); z = r * Math.cos(phi);
        nd = r;
        break;
      }
      case 2: { // Box — uniform in [-1,1]³
        x = Math.random() * 2 - 1; y = Math.random() * 2 - 1; z = Math.random() * 2 - 1;
        nd = Math.min(1, Math.sqrt(x * x + y * y + z * z) / Math.sqrt(3));
        break;
      }
      case 3: { // Disk — flat in XZ, uniform area
        const angle = Math.random() * Math.PI * 2;
        const r     = Math.sqrt(Math.random());
        x = r * Math.cos(angle); z = r * Math.sin(angle); y = 0;
        nd = r;
        break;
      }
      case 4: { // Ring — thin ring in XZ at radius ≈1
        const angle = Math.random() * Math.PI * 2;
        const r     = 0.85 + Math.random() * 0.3;
        x = r * Math.cos(angle); z = r * Math.sin(angle); y = (Math.random() - 0.5) * 0.1;
        nd = Math.min(r, 1);
        break;
      }
      case 5: { // Spiral — Archimedean spiral in XZ
        const t     = i / count;
        const angle = t * Math.PI * 2 * 4;
        x = t * Math.cos(angle); z = t * Math.sin(angle); y = (t - 0.5) * 0.3;
        nd = t;
        break;
      }
    }
    positions[i * 3] = x; positions[i * 3 + 1] = y; positions[i * 3 + 2] = z;
    normDists[i] = nd;
  }

  return { positions, normDists };
}

/** Handle returned to ExportModal for offline frame rendering + pixel readback */
export interface OfflineRenderHandle {
  /** Render the shader at an exact time value into the dedicated export RT */
  renderAtTime: (time: number) => void;
  /** Read pixels from the last renderAtTime call into `out` (RGBA, top-down) */
  readPixels: (out: Uint8Array, width: number, height: number) => void;
  /** Pixel dimensions of the export render target */
  width: number;
  height: number;
  /**
   * Render the live canvas at `scale`× its CSS size (1 = normal preview).
   * Used for high-resolution export: the canvas's drawing buffer, u_resolution
   * and every internal RT are resized so the shader is actually evaluated at
   * the higher resolution rather than upscaled. Returns the drawing-buffer
   * size the GPU actually allocated — browsers silently clamp oversized
   * buffers, so callers should compare it against what they asked for.
   */
  setRenderScale: (scale: number) => { width: number; height: number };
}

// Font texture: 16×16 grid of ASCII chars (codes 0-255), 64×64 px per cell.
// Built once at module load and shared across all ShaderCanvas instances.
function buildFontTexture(): THREE.CanvasTexture {
  const GRID = 16, CELL = 64, SIZE = GRID * CELL;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE; canvas.height = SIZE;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.fillStyle = '#fff';
  ctx.font = `bold 52px monospace`;
  ctx.textBaseline = 'top';
  for (let code = 32; code < 127; code++) {
    const col = code % GRID, row = Math.floor(code / GRID);
    ctx.fillText(String.fromCharCode(code), col * CELL + 6, row * CELL + 6);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}
const FONT_TEXTURE = buildFontTexture();

// Minimal fallback shaders so Three.js doesn't throw on first render
const FALLBACK_VERTEX = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 1.0);
}`.trim();

const FALLBACK_FRAGMENT = `
precision mediump float;
void main() {
  gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
}`.trim();

// Dithering blit: samples a float RT and adds triangular dither noise before 8-bit quantization
const BLIT_FRAG = `
precision mediump float;
uniform sampler2D tInput;
uniform float u_seed;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
void main() {
  vec4 c = texture2D(tInput, vUv);
  vec2 px = gl_FragCoord.xy + u_seed * 137.0;
  float r1 = hash(px);
  float r2 = hash(px + vec2(0.5, 0.0));
  float d = (r1 + r2 - 1.0) / 255.0;
  gl_FragColor = vec4(clamp(c.rgb + d, 0.0, 1.0), c.a);
}`.trim();

// Intercept WebGL shader compile errors from Three.js
// Reading COMPILE_STATUS right after compileShader() blocks until the driver
// has finished compiling — which defeats KHR_parallel_shader_compile. So the
// wrapper only records the shader, and the per-frame flush polls
// COMPLETION_STATUS_KHR and reads the log once the compile is actually done.
function captureGlslErrors(gl: WebGLRenderingContext | WebGL2RenderingContext): { flush: () => string[]; failedSource: () => string | null } {
  const errors: string[] = [];
  // Source of the last shader that failed: error line numbers point into it
  let lastFailedSource: string | null = null;
  const pending: WebGLShader[] = [];
  const parallel = gl.getExtension('KHR_parallel_shader_compile') as { COMPLETION_STATUS_KHR: number } | null;
  const origCompile = gl.compileShader.bind(gl);
  (gl as unknown as Record<string, unknown>).compileShader = (shader: WebGLShader) => {
    origCompile(shader);
    pending.push(shader);
  };
  const flush = () => {
    for (let i = pending.length - 1; i >= 0; i--) {
      const sh = pending[i];
      // Three.js deletes shader objects once their program linked — nothing to report.
      if (!gl.isShader(sh)) { pending.splice(i, 1); continue; }
      if (parallel && !gl.getShaderParameter(sh, parallel.COMPLETION_STATUS_KHR)) continue;
      pending.splice(i, 1);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(sh);
        // ANGLE terminates the log with a NUL byte; drop it along with blank lines.
        if (log) errors.push(...log.split('\n').map(l => l.replace(/\0/g, '')).filter(l => l.trim()));
        lastFailedSource = gl.getShaderSource(sh);
      }
    }
    if (errors.length === 0) return NO_ERRORS;
    const copy = [...errors];
    errors.length = 0;
    return copy;
  };
  return { flush, failedSource: () => lastFailedSource };
}
const NO_ERRORS: string[] = [];

// Frame scheduling (see the render loop in the boot effect): after this many
// consecutive frames with nothing to draw, stop asking for animation frames.
const IDLE_FRAMES_BEFORE_STOP = 10;
// Scope / eye-preview probes sample every N rendered frames (the scope buffer
// holds 200 samples, so 20 Hz is plenty) instead of one GPU readback per
// probe per frame.
const PROBE_SAMPLE_EVERY = 3;

const HIST_BINS = 48;

export interface HistogramData {
  luma: Float32Array;
  r: Float32Array;
  g: Float32Array;
  b: Float32Array;
  fps: number;
}

interface Props {
  /** Called with the WebGL canvas element once Three.js is initialized */
  onCanvasReady?: (canvas: HTMLCanvasElement) => void;
  /**
   * Called once with an OfflineRenderHandle for FFmpeg frame-by-frame encoding.
   * Uses a dedicated WebGLRenderTarget — completely isolated from the live canvas.
   */
  onRegisterOfflineRender?: (handle: OfflineRenderHandle) => void;
  /** Called every ~6 frames with per-channel histogram data when active */
  onHistogram?: (data: HistogramData) => void;
}
export { HIST_BINS };

export default function ShaderCanvas({ onCanvasReady, onRegisterOfflineRender, onHistogram }: Props = {}) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const materialRef = useRef<THREE.ShaderMaterial | null>(null);
  // Installed by the boot effect: compiles (vs, fs) off to the side and swaps it in. Resolves false if superseded.
  const swapShaderRef = useRef<((vs: string, fs: string) => Promise<boolean>) | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const particleSceneRef  = useRef<THREE.Scene | null>(null);
  const perspCameraRef    = useRef<THREE.PerspectiveCamera | null>(null);
  const gpuParticlesRef   = useRef<Map<string, THREE.Points>>(new Map());
  const animFrameRef = useRef<number>(0);
  // The frame loop's requestRender, for effects outside the setup effect
  const requestRenderRef = useRef<() => void>(() => {});
  const rtRef = useRef<THREE.WebGLRenderTarget | null>(null);
  // Ping-pong render targets for stateful shaders (PrevFrame node)
  const pingPongA   = useRef<THREE.WebGLRenderTarget | null>(null);
  const pingPongB   = useRef<THREE.WebGLRenderTarget | null>(null);
  const pingPongIdx = useRef<0 | 1>(0);  // 0 = A is read target, B is write; 1 = vice versa
  // Ref mirrors for stateful flag so rAF loop sees latest without re-boot
  const isStatefulRef = useRef(false);
  // Track mouse pixel position in canvas — null when mouse is not over canvas
  const mousePosRef = useRef<{ x: number; y: number } | null>(null);
  // Ref mirror for onHistogram so rAF loop sees latest without re-boot
  const onHistogramRef = useRef(onHistogram);
  useEffect(() => { onHistogramRef.current = onHistogram; }, [onHistogram]);
  // Ref mirror for hasTimeNode so the rAF loop always sees the latest value
  const hasTimeNodeRef = useRef(false);
  // Does the compiled shader read u_time at all? If not, a playing clock
  // changes nothing on screen and the loop can idle.
  const usesTimeRef    = useRef(false);
  // Audio / video input node ids, kept in sync with nodesRef so the frame
  // loop doesn't filter the whole node list every frame.
  const audioIdsRef    = useRef<string[]>([]);
  const videoIdsRef    = useRef<string[]>([]);

  const vertexShader       = useNodeGraphStore((state) => state.vertexShader);
  const fragmentShader     = useNodeGraphStore((state) => state.fragmentShader);
  const rawGlslShader      = useNodeGraphStore((state) => state.rawGlslShader);
  const activeFragmentShader = rawGlslShader ?? fragmentShader;
  const paramUniforms      = useNodeGraphStore((state) => state.paramUniforms);
  const textureUniforms    = useNodeGraphStore((state) => state.textureUniforms);
  const nodeTextures       = useNodeGraphStore((state) => state.nodeTextures);
  const videoUniforms      = useNodeGraphStore((state) => state.videoUniforms);
  const videoTextures      = useNodeGraphStore((state) => state.videoTextures);
  const isStateful         = useNodeGraphStore((state) => state.isStateful);
  const particleSystems    = useNodeGraphStore((state) => state.particleSystems);
  const setGlslErrors      = useNodeGraphStore((state) => state.setGlslErrors);
  const setPixelSample     = useNodeGraphStore((state) => state.setPixelSample);
  const setCurrentTime     = useNodeGraphStore((state) => state.setCurrentTime);
  const timePlaying        = useNodeGraphStore((state) => state.timePlaying);
  // Ref mirror so the rAF loop sees the latest play/pause state without re-boot
  const timePlayingRef = useRef(true);
  useEffect(() => { timePlayingRef.current = timePlaying; }, [timePlaying]);
  const setNodeProbeValues = useNodeGraphStore((state) => state.setNodeProbeValues);
  // (scope probe values are written directly to canvas via scopeRegistry — no React state)
  // Only broadcast currentTime when a Time node is in the graph — avoids 10fps
  // re-renders of all NodeComponents on graphs that don't use time at all.
  const hasTimeNode        = useNodeGraphStore((state) => state.nodes.some(n => n.type === 'time'));
  // Node probe: ref-mirrors updated by a separate effect so the rAF loop sees latest
  const selectedNodeIdRef   = useRef<string | null>(null);
  const previewNodeIdRef    = useRef<string | null>(null);
  const nodeOutputVarMapRef = useRef<Map<string, Record<string, string>>>(new Map());
  const nodesRef            = useRef<import('../types/nodeGraph').GraphNode[]>([]);
  // O(1) node lookup — kept in sync with nodesRef
  const nodeMapRef          = useRef<Map<string, import('../types/nodeGraph').GraphNode>>(new Map());
  // Scope node IDs — avoids O(n) filter every frame
  const scopeIdsRef         = useRef<Set<string>>(new Set());
  // Ref-mirrored shaders so the rAF loop sees updates without re-running effects
  const fragmentShaderRef   = useRef<string>('');
  const vertexShaderRef     = useRef<string>('');

  // Boot Three.js once
  useEffect(() => {
    const container = canvasRef.current!;

    // The preview is one full-screen quad, but its fragment shader can be very heavy (raymarching,
    // fractals). Desktop/tablet ask for the fast GPU: with 'default', dual-GPU Macs can land on the
    // integrated one, where a heavy shader misses the frame budget and vsync halves it to 30 fps.
    // Phones keep 'low-power' for battery.
    const renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: isMobile(getBreakpoint(window.innerWidth)) ? 'low-power' : 'high-performance',
    });
    renderer.setSize(1, 1);
    // Drawing buffer = CSS size × renderScale. Normally 1; raised only while
    // exporting at 2×/4× (see OfflineRenderHandle.setRenderScale).
    let renderScale = 1;
    let cssW = 1;
    let cssH = 1;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;
    onCanvasReady?.(renderer.domElement);

    // ── Frame scheduling ─────────────────────────────────────────────────────
    // The loop draws only when something changed (needsRender) or something is
    // moving (see `dynamic` in animate). Once nothing has needed drawing for
    // IDLE_FRAMES_BEFORE_STOP frames it stops requesting animation frames
    // altogether — a stopped rAF is what lets a phone GPU clock down — and any
    // trigger below starts it again.
    let needsRender = true;
    let loopRunning = false;
    let idleFrames = 0;
    let canvasVisible = true;
    const scheduleFrame = () => {
      loopRunning = true;
      animFrameRef.current = requestAnimationFrame(animate);
    };
    const requestRender = () => {
      needsRender = true;
      if (!loopRunning) scheduleFrame();
    };
    requestRenderRef.current = requestRender;
    // Every store write is a user action (Phase 1 removed the idle ones), so
    // any of them may have changed what the canvas should show.
    const unsubRender = useNodeGraphStore.subscribe(() => requestRender());
    // Hidden container (another page is showing) → treat like a hidden tab.
    const io = typeof IntersectionObserver !== 'undefined'
      ? new IntersectionObserver(entries => {
          canvasVisible = entries[0]?.isIntersecting ?? true;
          if (canvasVisible) requestRender();
        })
      : null;
    io?.observe(container);

    // Enable parallel shader compilation — keeps previous frame rendering while new shader compiles
    const gl = renderer.getContext();
    gl.getExtension('KHR_parallel_shader_compile');
    const { flush: flushGlErrors, failedSource: glFailedSource } = captureGlslErrors(gl);

    // Half-float RT support check — eliminates 8-bit quantization banding in dark areas
    const supportsHalfFloat = renderer.capabilities.isWebGL2 ||
      (!!gl.getExtension('OES_texture_half_float') && !!gl.getExtension('EXT_color_buffer_half_float'));
    const RT_TYPE = supportsHalfFloat ? THREE.HalfFloatType : THREE.UnsignedByteType;

    // Blit scene: renders a float RT to screen with triangular dithering
    const blitScene = new THREE.Scene();
    const blitGeo   = new THREE.PlaneGeometry(2, 2);
    const blitMat   = new THREE.ShaderMaterial({
      vertexShader:   FALLBACK_VERTEX,
      fragmentShader: BLIT_FRAG,
      uniforms: { tInput: { value: null }, u_seed: { value: 0 } },
      depthTest: false, depthWrite: false,
    });
    blitScene.add(new THREE.Mesh(blitGeo, blitMat));

    // Float intermediate RT — shader renders here, blit with dithering goes to screen
    const floatRt = new THREE.WebGLRenderTarget(1, 1, {
      type: RT_TYPE, format: THREE.RGBAFormat, depthBuffer: false,
    });

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    camera.position.z = 1;

    const geometry = new THREE.PlaneGeometry(2, 2);
    const { vertexShader: vs, fragmentShader: fs, rawGlslShader: rawFs, paramUniforms: pu, textureUniforms: tu, audioUniforms: au, videoUniforms: vu } = useNodeGraphStore.getState();
    const activeFs = rawFs ?? fs;
    const initialUniforms: Record<string, { value: unknown }> = {
      u_time:        { value: 0 },
      u_resolution:  { value: new THREE.Vector2(1, 1) },
      u_mouse:       { value: new THREE.Vector2(0, 0) },
      u_prevFrame:   { value: null },
      u_fontTexture: { value: FONT_TEXTURE },
    };
    for (const [name, value] of Object.entries(pu))  initialUniforms[name] = { value };
    for (const name of Object.keys(tu))              initialUniforms[name] = { value: null };
    for (const name of Object.keys(au))              initialUniforms[name] = { value: 0 };
    for (const name of Object.keys(vu))              initialUniforms[name] = { value: null };
    // `let`: the shader-change effect swaps in a freshly compiled material
    // (see swapShaderRef below); everything in this closure reads `material`
    // and so follows the swap. The uniforms object is shared across swaps.
    let material = new THREE.ShaderMaterial({
      vertexShader: vs || FALLBACK_VERTEX,
      fragmentShader: activeFs || FALLBACK_FRAGMENT,
      uniforms: initialUniforms,
    });
    materialRef.current = material;

    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);
    sceneRef.current = scene;

    // ── Asynchronous recompile ───────────────────────────────────────────────
    // Setting needsUpdate on the live material made the next render() link the
    // new program synchronously and stall that frame. Instead a new material
    // with the same uniforms is compiled off to the side (compileAsync polls
    // KHR_parallel_shader_compile, so the previous program keeps drawing) and
    // swapped in when ready. A compile superseded by a newer one is dropped.
    const compileScene = new THREE.Scene();
    const compileMesh = new THREE.Mesh(geometry, material);
    compileScene.add(compileMesh);
    let compileGeneration = 0;
    swapShaderRef.current = async (vsSrc, fsSrc) => {
      if (material.vertexShader === vsSrc && material.fragmentShader === fsSrc) return true;
      const gen = ++compileGeneration;
      const next = new THREE.ShaderMaterial({ vertexShader: vsSrc, fragmentShader: fsSrc, uniforms: material.uniforms });
      compileMesh.material = next;
      try {
        await renderer.compileAsync(compileScene, camera);
      } catch (e) {
        // Link/compile errors surface through captureGlslErrors on the next frame.
        console.warn('[ShaderCanvas] compileAsync rejected', e);
      }
      if (gen !== compileGeneration) { next.dispose(); return false; }
      const prev = material;
      material = next;
      mesh.material = next;
      materialRef.current = next;
      prev.dispose();
      requestRender();
      return true;
    };

    // ── 3D particle scene + perspective camera ────────────────────────────────
    const particleScene = new THREE.Scene();
    particleSceneRef.current = particleScene;
    const perspCamera = new THREE.PerspectiveCamera(60, 1, 0.01, 100);
    perspCamera.position.z = 3;
    perspCameraRef.current = perspCamera;

    // Register offline render handle for FFmpeg export.
    // Uses a dedicated WebGLRenderTarget — completely isolated from the live
    // display canvas so resize events and double-buffering can't corrupt readback.
    //
    // The RT is created lazily on first renderAtTime() so it's always sized to
    // the actual canvas size (ResizeObserver fires after the first layout tick,
    // but the setup effect runs before that).
    if (onRegisterOfflineRender) {
      let exportRT: THREE.WebGLRenderTarget | null = null;
      let exportReadbackRT: THREE.WebGLRenderTarget | null = null;
      let exportW = 0;
      let exportH = 0;

      // Create (or re-create) the RTs at the current renderer size.
      // exportRT is half-float for quality; exportReadbackRT is 8-bit for Uint8 readback.
      const ensureRT = () => {
        const w = renderer.domElement.width  || 1;
        const h = renderer.domElement.height || 1;
        if (!exportRT || exportW !== w || exportH !== h) {
          exportRT?.dispose();
          exportReadbackRT?.dispose();
          exportRT = new THREE.WebGLRenderTarget(w, h, {
            type: RT_TYPE, format: THREE.RGBAFormat, depthBuffer: false,
          });
          exportReadbackRT = new THREE.WebGLRenderTarget(w, h, {
            type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: false,
          });
          exportW = w;
          exportH = h;
        }
      };

      const handle: OfflineRenderHandle = {
        get width()  { ensureRT(); return exportW; },
        get height() { ensureRT(); return exportH; },
        setRenderScale: (scale: number) => {
          // Free export RTs sized for the previous scale — at 4× they can be
          // hundreds of MB, which matters on mobile GPUs.
          exportRT?.dispose(); exportRT = null;
          exportReadbackRT?.dispose(); exportReadbackRT = null;
          exportW = 0; exportH = 0;
          renderScale = scale;
          applySize();
          return { width: gl.drawingBufferWidth, height: gl.drawingBufferHeight };
        },
        renderAtTime: (time: number) => {
          material.uniforms.u_time.value = time;
          renderer.setRenderTarget(exportRT);
          renderer.render(scene, camera);
          // Blit with dithering into 8-bit readback RT
          blitMat.uniforms.tInput.value = exportRT!.texture;
          blitMat.uniforms.u_seed.value = time * 100.0;
          renderer.setRenderTarget(exportReadbackRT);
          renderer.render(blitScene, camera);
          renderer.setRenderTarget(null);
        },
        readPixels: (out: Uint8Array, width: number, height: number) => {
          if (!exportReadbackRT) return;
          renderer.readRenderTargetPixels(exportReadbackRT, 0, 0, width, height, out);
          // Flip Y: Three.js RenderTarget is bottom-up; FFmpeg rawvideo expects top-down
          const rowBytes = width * 4;
          const tmp = new Uint8Array(rowBytes);
          for (let y = 0; y < Math.floor(height / 2); y++) {
            const top = y * rowBytes;
            const bot = (height - 1 - y) * rowBytes;
            tmp.set(out.subarray(top, top + rowBytes));
            out.copyWithin(top, bot, bot + rowBytes);
            out.set(tmp, bot);
          }
        },
      };

      onRegisterOfflineRender(handle);

      // Clean up RTs when renderer is torn down
      const origDispose = renderer.dispose.bind(renderer);
      renderer.dispose = () => { exportRT?.dispose(); exportReadbackRT?.dispose(); origDispose(); };
    }

    // Render target for pixel readback — sized with the canvas, resized in ResizeObserver
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.UnsignedByteType });
    rtRef.current = rt;

    // Small fixed-size RT for histogram sampling (64×36 ≈ 2304 pixels, never resized)
    const histRt = new THREE.WebGLRenderTarget(64, 36, { type: THREE.UnsignedByteType });
    const histBuf = new Uint8Array(64 * 36 * 4);

    // ── Node probe: isolated scene + 1×1 RT ──────────────────────────────────
    // Completely separate from `scene` so probe renders never appear on-screen.
    const probeScene  = new THREE.Scene();
    const probeGeo    = new THREE.PlaneGeometry(2, 2);
    const probeDummy  = new THREE.ShaderMaterial({ vertexShader: FALLBACK_VERTEX, fragmentShader: FALLBACK_FRAGMENT });
    const probeMesh   = new THREE.Mesh(probeGeo, probeDummy);
    probeScene.add(probeMesh);
    const probeRT     = new THREE.WebGLRenderTarget(1, 1, { type: THREE.UnsignedByteType, depthBuffer: false });
    const probeBuf    = new Uint8Array(4);

    // Probe programs compile off-thread as well: a freshly built probe material
    // goes through compileAsync and is skipped until ready, so selecting a node
    // with N outputs no longer links N programs synchronously in one frame.
    const readyProbeMats = new WeakSet<THREE.ShaderMaterial>();
    const compilingProbeMats = new WeakSet<THREE.ShaderMaterial>();
    const probeCompileScene = new THREE.Scene();
    const probeCompileMesh = new THREE.Mesh(probeGeo, probeDummy);
    probeCompileScene.add(probeCompileMesh);
    const probeReady = (pm: THREE.ShaderMaterial): boolean => {
      if (readyProbeMats.has(pm)) return true;
      if (!compilingProbeMats.has(pm)) {
        compilingProbeMats.add(pm);
        probeCompileMesh.material = pm;
        renderer.compileAsync(probeCompileScene, camera).then(
          () => { readyProbeMats.add(pm); requestRender(); },
          () => { readyProbeMats.add(pm); },
        );
      }
      return false;
    };
    let lastProbedNodeId: string | null = null;
    let lastProbeFs: string | null = null;   // invalidate cache when shader recompiles
    const probeMatCache = new Map<string, THREE.ShaderMaterial>();
    const scopeMatCache = new Map<string, THREE.ShaderMaterial>();
    let lastScopeFs: string | null = null;
    const previewScopeMatCache = new Map<string, THREE.ShaderMaterial>();
    let lastPreviewScopeFs: string | null = null;

    // Build a 1-px probe shader: insert a new gl_FragColor at the very end of main()
    // using lastIndexOf('}') so it works even when nodes compile after the output node's
    // gl_FragColor (i.e. when the scope node isn't connected to the Output node).
    const buildProbeShader = (fs: string, varName: string, varType: string): string => {
      let packed: string;
      switch (varType) {
        case 'float': packed = `vec4(${varName}, ${varName}, ${varName}, 1.0)`; break;
        case 'vec2':  packed = `vec4(${varName}, 0.0, 1.0)`; break;
        case 'vec3':  packed = `vec4(${varName}, 1.0)`; break;
        case 'vec4':  packed = varName; break;
        default:      packed = `vec4(0.0)`; break;
      }
      const end = fs.lastIndexOf('}');
      return fs.slice(0, end) + `  gl_FragColor = ${packed};\n}`;
    };

    // Build a scope probe shader: normalizes float to [0,1] via min/max, inserted at end of main()
    const buildScopeProbeShader = (fs: string, varName: string, minVal: number, maxVal: number): string => {
      const range = (maxVal - minVal) || 1.0;
      const end = fs.lastIndexOf('}');
      return fs.slice(0, end) + `  gl_FragColor = vec4((${varName} - ${minVal.toFixed(6)}) / ${range.toFixed(6)}, 0.0, 0.0, 1.0);\n}`;
    };

    // Build a vec2/vec3 probe shader: encodes each component as v*0.5+0.5 so [-1,1] maps to [0,1]
    const buildVecProbeShader = (fs: string, varName: string, varType: string): string => {
      let packed: string;
      if (varType === 'vec2')  packed = `vec4(${varName}.x * 0.5 + 0.5, ${varName}.y * 0.5 + 0.5, 0.0, 1.0)`;
      else if (varType === 'vec3') packed = `vec4(${varName}.x * 0.5 + 0.5, ${varName}.y * 0.5 + 0.5, ${varName}.z * 0.5 + 0.5, 1.0)`;
      else packed = `vec4(${varName} * 0.5 + 0.5, 1.0)`;
      const end = fs.lastIndexOf('}');
      return fs.slice(0, end) + `  gl_FragColor = ${packed};\n}`;
    };

    // 2-channel high-precision float probe: packs float in R (high byte) + G (low byte)
    // over range [-rangeHalf, +rangeHalf]. Precision ≈ 2*rangeHalf / 65536.
    const buildHighPrecFloatProbeShader = (fs: string, varName: string, rangeHalf: number): string => {
      const r = rangeHalf.toFixed(1), d = (rangeHalf * 2).toFixed(1);
      const end = fs.lastIndexOf('}');
      return fs.slice(0, end) +
        `  float hpn = clamp((${varName} + ${r}) / ${d}, 0.0, 1.0);\n` +
        `  gl_FragColor = vec4(floor(hpn * 255.0) / 255.0, fract(hpn * 255.0), 0.0, 1.0);\n}`;
    };

    // Simple vec2 probe: R=x_norm, G=y_norm, B=0, A=1.0 — A MUST stay 1.0 to avoid premultiplied alpha corruption
    const buildSimpleVec2ProbeShader = (fs: string, varName: string, rangeHalf: number): string => {
      const r = rangeHalf.toFixed(1), d = (rangeHalf * 2).toFixed(1);
      const end = fs.lastIndexOf('}');
      return fs.slice(0, end) +
        `  float hpnx = clamp((${varName}.x + ${r}) / ${d}, 0.0, 1.0);\n` +
        `  float hpny = clamp((${varName}.y + ${r}) / ${d}, 0.0, 1.0);\n` +
        `  gl_FragColor = vec4(hpnx, hpny, 0.0, 1.0);\n}`;
    };

    // CSS size is floored so the drawing buffer at render scale N is exactly
    // N× the 1× buffer — the export modal predicts output size that way.
    const applySize = () => {
      renderer.setPixelRatio(renderScale);
      renderer.setSize(cssW, cssH);
      const w = renderer.domElement.width;
      const h = renderer.domElement.height;
      material.uniforms.u_resolution.value.set(w, h);
      rt.setSize(w, h);
      floatRt.setSize(w, h);
      perspCamera.aspect = w / h;
      perspCamera.updateProjectionMatrix();
      // Resize ping-pong RTs and reset state
      if (pingPongA.current) { pingPongA.current.dispose(); pingPongA.current = null; }
      if (pingPongB.current) { pingPongB.current.dispose(); pingPongB.current = null; }
      pingPongIdx.current = 0;
      if (material.uniforms.u_prevFrame) material.uniforms.u_prevFrame.value = null;
      requestRender();
    };

    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      if (width < 1 || height < 1) return;
      cssW = Math.floor(width);
      cssH = Math.floor(height);
      applySize();
    });
    ro.observe(container);

    // ── WebGL context loss / restore ─────────────────────────────────────────
    // The GPU can drop our context under memory pressure (4× exports on
    // mobile), after a driver reset, or when the tab is backgrounded on some
    // devices. Without preventDefault() on 'webglcontextlost' the browser
    // never fires 'webglcontextrestored', so the canvas would stay black
    // for good. Three.js already re-initialises its own GL state on restore
    // and lazily re-uploads textures/buffers; what's left for us is our
    // sized resources (render targets, ping-pong buffers, u_resolution) —
    // applySize() rebuilds exactly those, so restore goes through it rather
    // than duplicating that logic here.
    //
    // NOTE: no stopPropagation() — ExportModal listens for 'webglcontextlost'
    // on this same canvas during an export to abort with a GPU-memory error.
    let glContextLost = false;
    const handleContextLost = (e: Event) => {
      e.preventDefault();
      glContextLost = true;
      console.error('[ShaderCanvas] WebGL context lost — rendering paused until the browser restores it');
      useNodeGraphStore.getState().setGlContextLost(true);
    };
    const handleContextRestored = () => {
      glContextLost = false;
      console.warn('[ShaderCanvas] WebGL context restored — rebuilding GPU resources');
      // Stale render targets / ping-pong buffers are disposed and re-created at
      // the current CSS size × renderScale; shader programs rebuild on the
      // next render because Three.js reset its program cache.
      applySize();
      material.needsUpdate = true;
      lastRafTime = null; // don't count the lost interval as one giant dt
      useNodeGraphStore.getState().setGlContextLost(false);
      requestRender();
    };
    renderer.domElement.addEventListener('webglcontextlost', handleContextLost);
    renderer.domElement.addEventListener('webglcontextrestored', handleContextRestored);

    // Helper to lazily create ping-pong targets at current canvas size
    const ensurePingPong = () => {
      const w = renderer.domElement.width  || 1;
      const h = renderer.domElement.height || 1;
      if (!pingPongA.current) {
        const opts = { type: RT_TYPE, format: THREE.RGBAFormat, depthBuffer: false };
        pingPongA.current = new THREE.WebGLRenderTarget(w, h, opts);
        pingPongB.current = new THREE.WebGLRenderTarget(w, h, opts);
        // Clear both to black
        renderer.setRenderTarget(pingPongA.current); renderer.clear();
        renderer.setRenderTarget(pingPongB.current); renderer.clear();
        renderer.setRenderTarget(null);
      }
    };

    // Manual virtual-time accumulator (replaces THREE.Clock) so playback can be
    // paused without resetting to 0 — THREE.Clock.start() always zeroes
    // elapsedTime, so there's no clean way to "resume" with it.
    let virtualTime = 0;
    let lastRafTime: number | null = null;
    let frameCount = 0;
    const SAMPLE_EVERY = 6; // sample every 6 frames (~10fps if running at 60fps)
    // FPS tracking for histogram overlay
    let fpsFrameCount = 0;
    let fpsLastTime = 0;
    let currentFps = 0;
    // Per-node Uint8Array buffers for audio FFT data — allocated once, reused each frame
    const audioFreqBuffers = new Map<string, Uint8Array>();
    // Mouse pixel sample + histogram readback state. Reads are asynchronous
    // (PIXEL_PACK_BUFFER + fence) on WebGL2 so the CPU never blocks on the GPU;
    // a sample in flight simply skips the next one. Buffers are allocated once.
    const isWebGL2 = renderer.capabilities.isWebGL2;
    const readPixels = (target: THREE.WebGLRenderTarget, x: number, y: number, w: number, h: number, buf: Uint8Array): Promise<void> => {
      if (isWebGL2) {
        return renderer.readRenderTargetPixelsAsync(target, x, y, w, h, buf).then(
          () => undefined,
          () => { renderer.readRenderTargetPixels(target, x, y, w, h, buf); },
        );
      }
      renderer.readRenderTargetPixels(target, x, y, w, h, buf);
      return Promise.resolve();
    };
    const pixelBuf = new Uint8Array(4);
    let pixelReadPending = false;
    let histReadPending = false;
    // Two histogram bin sets, alternated, so the set handed to React last time
    // isn't overwritten while it may still be rendering.
    const histSets = [0, 1].map(() => ({
      luma: new Float32Array(HIST_BINS), r: new Float32Array(HIST_BINS),
      g: new Float32Array(HIST_BINS), b: new Float32Array(HIST_BINS),
    }));
    let histSetIdx = 0;

    function animate(now: number = 0) {
      // Skip entirely when the browser tab is not visible or the canvas is
      // hidden behind another page. Still track lastRafTime so the next
      // visible frame doesn't see a huge dt jump. Keep ticking cheaply so we
      // notice when it comes back.
      if (document.hidden || !canvasVisible) { lastRafTime = now; scheduleFrame(); return; }
      // While the WebGL context is lost every GL call is a no-op (and the
      // readbacks below would return garbage), so idle until it's restored.
      if (glContextLost) { lastRafTime = now; scheduleFrame(); return; }

      // FPS counter — updated every second
      fpsFrameCount++;
      if (fpsLastTime === 0) fpsLastTime = now;
      const fpsElapsed = now - fpsLastTime;
      if (fpsElapsed >= 1000) {
        currentFps = Math.round(fpsFrameCount * 1000 / fpsElapsed);
        fpsFrameCount = 0;
        fpsLastTime = now;
      }

      if (lastRafTime === null) lastRafTime = now;
      const dt = Math.max(0, (now - lastRafTime) / 1000);
      lastRafTime = now;
      if (timePlayingRef.current) virtualTime += dt;
      const elapsed = virtualTime;
      material.uniforms.u_time.value = elapsed;
      // Clock followers (time readouts, keyframe playheads) get every frame: a listener call is
      // cheap, and throttling it made the readout visibly choppy once frames were throttled.
      if (hasTimeTickListeners()) emitTimeTick(elapsed);

      // ── GPU particle tick: just keep u_time in sync ────────────────────────
      for (const [, points] of gpuParticlesRef.current) {
        const psMat = points.material as THREE.ShaderMaterial;
        if (psMat.uniforms.u_time) psMat.uniforms.u_time.value = elapsed;
      }

      // ── Audio engine tick: push amplitude uniforms + draw live spectrum ──
      const audioAmps = audioEngine.tick();
      for (const [uName, amp] of audioAmps) {
        if (material.uniforms[uName]) {
          material.uniforms[uName].value = amp;
        }
      }
      // Draw live spectrum into any open AudioInputModal canvases
      for (const audioId of audioIdsRef.current) {
        if (!audioSpectrumRegistry.has(audioId)) continue;
        const n = nodeMapRef.current.get(audioId);
        if (!n) continue;
        const analyser = audioEngine.getAnalyser(n.id);
        if (!analyser) continue;
        let freqBuf = audioFreqBuffers.get(n.id);
        if (!freqBuf || freqBuf.length !== analyser.frequencyBinCount) {
          freqBuf = new Uint8Array(analyser.frequencyBinCount);
          audioFreqBuffers.set(n.id, freqBuf);
        }
        analyser.getByteFrequencyData(freqBuf as Uint8Array<ArrayBuffer>);
        const freqCenter = typeof n.params.freq_center === 'number' ? n.params.freq_center : 200;
        const freqRange  = typeof n.params.freq_range  === 'number' ? n.params.freq_range  : 200;
        const mode       = (n.params.mode as string) ?? 'band';
        drawSpectrumCanvas(n.id, freqBuf as Uint8Array<ArrayBuffer>, analyser.context.sampleRate, analyser.fftSize, freqCenter, freqRange, mode);
      }

      // ── Do we need to draw this frame? ─────────────────────────────────────
      // Something is moving if the clock is running and the picture depends on
      // it (u_time, particles, audio, video, feedback, scopes, the eye preview),
      // or a recording holds a lease. Otherwise draw only when asked to.
      const playing = timePlayingRef.current;
      const videoActive = videoIdsRef.current.some(id => videoEngine.isPlaying(id));
      const dynamic = renderKeepAlive.active() || (playing && (
        usesTimeRef.current || hasTimeNodeRef.current || gpuParticlesRef.current.size > 0 ||
        audioAmps.size > 0 || videoActive || isStatefulRef.current ||
        scopeIdsRef.current.size > 0 || previewNodeIdRef.current !== null
      ));
      const doRender = dynamic || needsRender;
      if (doRender) {
        needsRender = false;
        idleFrames = 0;
        if (isStatefulRef.current) {
          // Ping-pong: render to write RT, blit to screen with dithering
          ensurePingPong();
          const rtA = pingPongA.current!;
          const rtB = pingPongB.current!;
          const readRT  = pingPongIdx.current === 0 ? rtA : rtB;
          const writeRT = pingPongIdx.current === 0 ? rtB : rtA;
          if (material.uniforms.u_prevFrame) {
            material.uniforms.u_prevFrame.value = readRT.texture;
          }
          renderer.setRenderTarget(writeRT);
          renderer.render(scene, camera);
          blitMat.uniforms.tInput.value = writeRT.texture;
          blitMat.uniforms.u_seed.value = frameCount * 1.618;
          renderer.setRenderTarget(null);
          renderer.render(blitScene, camera);
          pingPongIdx.current = pingPongIdx.current === 0 ? 1 : 0;
        } else {
          renderer.setRenderTarget(floatRt);
          renderer.render(scene, camera);
          blitMat.uniforms.tInput.value = floatRt.texture;
          blitMat.uniforms.u_seed.value = frameCount * 1.618;
          renderer.setRenderTarget(null);
          renderer.render(blitScene, camera);
        }

        // ── GPU particles: render additively on top of the blitted background ──
        if (gpuParticlesRef.current.size > 0) {
          renderer.autoClear = false;
          renderer.render(particleScene, perspCamera);
          renderer.autoClear = true;
        }

        // Check for GLSL errors after first few renders
        const newErrors = flushGlErrors();
        if (newErrors.length > 0) {
          setGlslErrors(newErrors, glFailedSource());
        }

        // Throttled updates every N frames while animating. A frame drawn on
        // demand (slider, hover, recompile) may be the only one for a while, so
        // it always samples — otherwise the readouts would show the old picture.
        frameCount++;
        const sampleFrame = frameCount % SAMPLE_EVERY === 0 || !dynamic;
        if (sampleFrame) {
          // Only broadcast time to the store (triggers a re-render in every
          // NodeComponent) when the graph actually has a Time node. The
          // keyframe editor's scrubber/playhead needs current time regardless
          // of that, so it also gets a cheap DOM CustomEvent — no store
          // update, so no wasted re-renders on graphs that don't listen.
          if (hasTimeNodeRef.current) {
            setCurrentTime(material.uniforms.u_time.value);
          }
          const mp = mousePosRef.current;
          if (mp === null) {
            // Mouse not over canvas — hide the overlay
            setPixelSample(null);
          } else {
            const rtW = rt.width;
            const rtH = rt.height;
            if (rtW > 0 && rtH > 0 && !pixelReadPending) {
              renderer.setRenderTarget(rt);
              renderer.render(scene, camera);
              renderer.setRenderTarget(null);

              // WebGL Y-axis is flipped relative to DOM (0 = bottom)
              const px = Math.max(0, Math.min(rtW - 1, Math.round(mp.x)));
              const py = Math.max(0, Math.min(rtH - 1, Math.round(rtH - 1 - mp.y)));
              pixelReadPending = true;
              readPixels(rt, px, py, 1, 1, pixelBuf).then(() => {
                pixelReadPending = false;
                setPixelSample([pixelBuf[0], pixelBuf[1], pixelBuf[2], pixelBuf[3]]);
              });
            }
          }

          // Histogram sampling — every SAMPLE_EVERY frames (~10fps at 60fps)
          if (onHistogramRef.current && !histReadPending) {
            renderer.setRenderTarget(histRt);
            renderer.render(scene, camera);
            renderer.setRenderTarget(null);
            histReadPending = true;
            const fpsAtSample = currentFps;
            readPixels(histRt, 0, 0, 64, 36, histBuf).then(() => {
              histReadPending = false;
              const cb = onHistogramRef.current;
              if (!cb) return;
              const set = histSets[histSetIdx];
              histSetIdx ^= 1;
              const { luma, r: rBins, g: gBins, b: bBins } = set;
              luma.fill(0); rBins.fill(0); gBins.fill(0); bBins.fill(0);
              for (let i = 0; i < histBuf.length; i += 4) {
                const rv = histBuf[i] / 255, gv = histBuf[i + 1] / 255, bv = histBuf[i + 2] / 255;
                const l = 0.299 * rv + 0.587 * gv + 0.114 * bv;
                luma[Math.min(HIST_BINS - 1, (l  * HIST_BINS) | 0)]++;
                rBins[Math.min(HIST_BINS - 1, (rv * HIST_BINS) | 0)]++;
                gBins[Math.min(HIST_BINS - 1, (gv * HIST_BINS) | 0)]++;
                bBins[Math.min(HIST_BINS - 1, (bv * HIST_BINS) | 0)]++;
              }
              const total = 64 * 36;
              for (let i = 0; i < HIST_BINS; i++) {
                luma[i] /= total; rBins[i] /= total; gBins[i] /= total; bBins[i] /= total;
              }
              cb({ luma, r: rBins, g: gBins, b: bBins, fps: fpsAtSample });
            });
          }

          // ── Node probe: sample selected node's output vars ──────────────────
          const selId = selectedNodeIdRef.current;
          if (selId) {
            const outputVars = nodeOutputVarMapRef.current.get(selId);
            const selNode    = nodeMapRef.current.get(selId);
            const curFs      = fragmentShaderRef.current;
            const curVs      = vertexShaderRef.current;

            if (outputVars && selNode && curFs && curVs) {
              // If shader recompiled since last probe, stale materials must be rebuilt
              if (lastProbeFs !== curFs) {
                probeMatCache.forEach(m => m.dispose());
                probeMatCache.clear();
                lastProbeFs = curFs;
              }
              // If selected node changed, also clear cache (different set of varNames)
              if (lastProbedNodeId !== selId) {
                probeMatCache.forEach(m => m.dispose());
                probeMatCache.clear();
                lastProbedNodeId = selId;
              }

              const probeResults: Record<string, number[]> = {};

              for (const [outKey, varName] of Object.entries(outputVars)) {
                const outSocket = selNode.outputs[outKey];
                const varType   = outSocket?.type ?? 'float';

                // Get or build a probe material for this variable
                let pm = probeMatCache.get(varName);
                if (!pm) {
                  const probeFs = buildProbeShader(curFs, varName, varType);
                  pm = new THREE.ShaderMaterial({
                    vertexShader: curVs,
                    fragmentShader: probeFs,
                    uniforms: {
                      u_time:       { value: 0 },
                      u_resolution: { value: new THREE.Vector2(1, 1) },
                      u_mouse:      { value: new THREE.Vector2(0, 0) },
                    },
                  });
                  probeMatCache.set(varName, pm);
                }
                if (!probeReady(pm)) continue; // still compiling — probe it next sample
                // Keep uniforms in sync with the live material
                pm.uniforms.u_time.value = material.uniforms.u_time.value;
                pm.uniforms.u_resolution.value = material.uniforms.u_resolution.value;
                pm.uniforms.u_mouse.value = material.uniforms.u_mouse.value;

                // Render into the isolated probe scene (never touches the main scene)
                probeMesh.material = pm;
                renderer.setRenderTarget(probeRT);
                renderer.render(probeScene, camera);
                renderer.setRenderTarget(null);
                renderer.readRenderTargetPixels(probeRT, 0, 0, 1, 1, probeBuf);

                // Decode 0–255 → 0–1 float per component
                const numComponents = varType === 'float' ? 1 : varType === 'vec2' ? 2 : varType === 'vec3' ? 3 : 4;
                const vals: number[] = [];
                for (let c = 0; c < numComponents; c++) vals.push(probeBuf[c] / 255);
                probeResults[outKey] = vals;
              }

              // Restore dummy material so probeScene is clean
              probeMesh.material = probeDummy;
              setNodeProbeValues(probeResults);
            }
          } else if (lastProbedNodeId !== null) {
            // Node deselected — clear probe state
            probeMatCache.forEach(m => m.dispose());
            probeMatCache.clear();
            lastProbedNodeId = null;
            setNodeProbeValues(null);
          }

        }

        // ── Scope + LFO nodes: sample every PROBE_SAMPLE_EVERY frames, draw waveform directly to canvas ──
        const scopeIds = scopeIdsRef.current;
        if (scopeIds.size > 0 && (frameCount % PROBE_SAMPLE_EVERY === 0 || !dynamic)) {
          const curScopeFs = fragmentShaderRef.current;
          const curScopeVs = vertexShaderRef.current;
          if (curScopeFs && curScopeVs) {
            if (lastScopeFs !== curScopeFs) {
              scopeMatCache.forEach(m => m.dispose());
              scopeMatCache.clear();
              lastScopeFs = curScopeFs;
            }
            for (const scopeId of scopeIds) {
              const scopeNode = nodeMapRef.current.get(scopeId);
              if (!scopeNode) continue;
              const outputVars = nodeOutputVarMapRef.current.get(scopeNode.id);
              if (!outputVars?.value) continue;
              const varName = outputVars.value;
              // Scope node uses min/max params; LFO nodes derive range from offset ± amplitude
              let scopeMin: number;
              let scopeMax: number;
              if (scopeNode.type === 'scope') {
                scopeMin = typeof scopeNode.params.min === 'number' ? scopeNode.params.min : -1.0;
                scopeMax = typeof scopeNode.params.max === 'number' ? scopeNode.params.max : 1.0;
              } else {
                const amp = typeof scopeNode.params.amplitude === 'number' ? scopeNode.params.amplitude : 1.0;
                const off = typeof scopeNode.params.offset    === 'number' ? scopeNode.params.offset    : 0.0;
                scopeMin = off - amp;
                scopeMax = off + amp;
              }
              // Cache key includes min/max so probe shader is rebuilt when range changes
              const cacheKey = `${varName}::${scopeMin}::${scopeMax}`;
              let pm = scopeMatCache.get(cacheKey);
              if (!pm) {
                const probeFs = buildScopeProbeShader(curScopeFs, varName, scopeMin, scopeMax);
                const clonedUniforms: Record<string, { value: unknown }> = {};
                for (const [k, u] of Object.entries(material.uniforms)) {
                  clonedUniforms[k] = { value: u.value };
                }
                pm = new THREE.ShaderMaterial({
                  vertexShader: curScopeVs,
                  fragmentShader: probeFs,
                  uniforms: clonedUniforms,
                });
                scopeMatCache.set(cacheKey, pm);
              }
              if (!probeReady(pm)) continue; // still compiling — sample it next time
              for (const [k, u] of Object.entries(material.uniforms)) {
                if (pm.uniforms[k]) pm.uniforms[k].value = u.value;
              }
              probeMesh.material = pm;
              renderer.setRenderTarget(probeRT);
              renderer.render(probeScene, camera);
              renderer.setRenderTarget(null);
              renderer.readRenderTargetPixels(probeRT, 0, 0, 1, 1, probeBuf);
              // Draw directly to the registered canvas — no React state, no re-render
              drawScopeCanvas(scopeNode.id, probeBuf[0] / 255, scopeMin, scopeMax);
            }
            probeMesh.material = probeDummy;
          }
        }

        // ── Preview scope: waveform + upstream probes when 👁 is active (throttled like scopes) ──
        const previewId = previewNodeIdRef.current;
        if (previewId && (frameCount % PROBE_SAMPLE_EVERY === 0 || !dynamic)) {
          const previewNode = nodeMapRef.current.get(previewId);
          if (previewNode) {
            const curFs = fragmentShaderRef.current;
            const curVs = vertexShaderRef.current;
            if (curFs && curVs) {
              if (lastPreviewScopeFs !== curFs) {
                previewScopeMatCache.forEach(m => m.dispose());
                previewScopeMatCache.clear();
                lastPreviewScopeFs = curFs;
              }
              const HP_RANGE = 100;
              const VEC2_RANGE = 10;

              // Own float output: waveform scope + HP precise value
              const floatOutputKey = Object.entries(previewNode.outputs).find(([, s]) => s.type === 'float')?.[0];
              if (floatOutputKey) {
                const outputVars = nodeOutputVarMapRef.current.get(previewId);
                const varName    = outputVars?.[floatOutputKey];
                if (varName) {
                  const cacheKey = `${varName}::-1::1`;
                  let pm = previewScopeMatCache.get(cacheKey);
                  if (!pm) {
                    const probeFs = buildScopeProbeShader(curFs, varName, -1, 1);
                    const clonedUniforms: Record<string, { value: unknown }> = {};
                    for (const [k, u] of Object.entries(material.uniforms)) clonedUniforms[k] = { value: u.value };
                    pm = new THREE.ShaderMaterial({ vertexShader: curVs, fragmentShader: probeFs, uniforms: clonedUniforms });
                    previewScopeMatCache.set(cacheKey, pm);
                  }
                  for (const [k, u] of Object.entries(material.uniforms)) {
                    if (pm.uniforms[k]) pm.uniforms[k].value = u.value;
                  }
                  probeMesh.material = pm;
                  renderer.setRenderTarget(probeRT);
                  renderer.render(probeScene, camera);
                  renderer.setRenderTarget(null);
                  renderer.readRenderTargetPixels(probeRT, 0, 0, 1, 1, probeBuf);
                  drawScopeCanvas(`__preview__${previewId}`, probeBuf[0] / 255, -1, 1);

                  const hpCacheKey = `hp::${varName}`;
                  let hpm = previewScopeMatCache.get(hpCacheKey);
                  if (!hpm) {
                    const hpProbeFs = buildHighPrecFloatProbeShader(curFs, varName, HP_RANGE);
                    const hpUniforms: Record<string, { value: unknown }> = {};
                    for (const [k, u] of Object.entries(material.uniforms)) hpUniforms[k] = { value: u.value };
                    hpm = new THREE.ShaderMaterial({ vertexShader: curVs, fragmentShader: hpProbeFs, uniforms: hpUniforms });
                    previewScopeMatCache.set(hpCacheKey, hpm);
                  }
                  for (const [k, u] of Object.entries(material.uniforms)) {
                    if (hpm.uniforms[k]) hpm.uniforms[k].value = u.value;
                  }
                  probeMesh.material = hpm;
                  renderer.setRenderTarget(probeRT);
                  renderer.render(probeScene, camera);
                  renderer.setRenderTarget(null);
                  renderer.readRenderTargetPixels(probeRT, 0, 0, 1, 1, probeBuf);
                  const hpNorm = probeBuf[0] / 255 + probeBuf[1] / 255 / 255;
                  floatValueRegistry.set(`__preview__${previewId}`, hpNorm * HP_RANGE * 2 - HP_RANGE);
                }
              }

              // Upstream input probes — runs for ALL node types regardless of own output type.
              // Key format: `__preview__${nodeId}:${outputKey}` prevents collision when multiple
              // inputs connect to different outputs of the same upstream node.
              for (const inputSocket of Object.values(previewNode.inputs)) {
                if (!inputSocket.connection) continue;
                const { nodeId: upId, outputKey: upKey } = inputSocket.connection;
                const upNode = nodeMapRef.current.get(upId);
                if (!upNode) continue;
                const upType = upNode.outputs[upKey]?.type;
                if (!upType) continue;
                const upVarName = nodeOutputVarMapRef.current.get(upId)?.[upKey];
                if (!upVarName) continue;

                const probeKey = `__preview__${upId}:${upKey}`;

                if (upType === 'float') {
                  const upCacheKey = `hp::${upVarName}`;
                  let upm = previewScopeMatCache.get(upCacheKey);
                  if (!upm) {
                    const upProbeFs = buildHighPrecFloatProbeShader(curFs, upVarName, HP_RANGE);
                    const upUniforms: Record<string, { value: unknown }> = {};
                    for (const [k, u] of Object.entries(material.uniforms)) upUniforms[k] = { value: u.value };
                    upm = new THREE.ShaderMaterial({ vertexShader: curVs, fragmentShader: upProbeFs, uniforms: upUniforms });
                    previewScopeMatCache.set(upCacheKey, upm);
                  }
                  for (const [k, u] of Object.entries(material.uniforms)) {
                    if (upm.uniforms[k]) upm.uniforms[k].value = u.value;
                  }
                  probeMesh.material = upm;
                  renderer.setRenderTarget(probeRT);
                  renderer.render(probeScene, camera);
                  renderer.setRenderTarget(null);
                  renderer.readRenderTargetPixels(probeRT, 0, 0, 1, 1, probeBuf);
                  const upHpNorm = probeBuf[0] / 255 + probeBuf[1] / 255 / 255;
                  drawScopeCanvas(probeKey, upHpNorm, -HP_RANGE, HP_RANGE);
                } else if (upType === 'vec2') {
                  // R=x_norm, G=y_norm, B=0, A=1.0 — A must be 1.0 to avoid premultiplied alpha corruption
                  const upCacheKey = `sv2::${upVarName}`;
                  let upm = previewScopeMatCache.get(upCacheKey);
                  if (!upm) {
                    const upProbeFs = buildSimpleVec2ProbeShader(curFs, upVarName, VEC2_RANGE);
                    const upUniforms: Record<string, { value: unknown }> = {};
                    for (const [k, u] of Object.entries(material.uniforms)) upUniforms[k] = { value: u.value };
                    upm = new THREE.ShaderMaterial({ vertexShader: curVs, fragmentShader: upProbeFs, uniforms: upUniforms });
                    previewScopeMatCache.set(upCacheKey, upm);
                  }
                  for (const [k, u] of Object.entries(material.uniforms)) {
                    if (upm.uniforms[k]) upm.uniforms[k].value = u.value;
                  }
                  probeMesh.material = upm;
                  renderer.setRenderTarget(probeRT);
                  renderer.render(probeScene, camera);
                  renderer.setRenderTarget(null);
                  renderer.readRenderTargetPixels(probeRT, 0, 0, 1, 1, probeBuf);
                  vectorValueRegistry.set(probeKey, [
                    probeBuf[0] / 255 * VEC2_RANGE * 2 - VEC2_RANGE,
                    probeBuf[1] / 255 * VEC2_RANGE * 2 - VEC2_RANGE,
                  ]);
                } else if (upType === 'vec3') {
                  // 1 byte per component, range ±1 (sufficient for color/normal vectors)
                  const upCacheKey = `v3::${upVarName}`;
                  let upm = previewScopeMatCache.get(upCacheKey);
                  if (!upm) {
                    const upProbeFs = buildVecProbeShader(curFs, upVarName, 'vec3');
                    const upUniforms: Record<string, { value: unknown }> = {};
                    for (const [k, u] of Object.entries(material.uniforms)) upUniforms[k] = { value: u.value };
                    upm = new THREE.ShaderMaterial({ vertexShader: curVs, fragmentShader: upProbeFs, uniforms: upUniforms });
                    previewScopeMatCache.set(upCacheKey, upm);
                  }
                  for (const [k, u] of Object.entries(material.uniforms)) {
                    if (upm.uniforms[k]) upm.uniforms[k].value = u.value;
                  }
                  probeMesh.material = upm;
                  renderer.setRenderTarget(probeRT);
                  renderer.render(probeScene, camera);
                  renderer.setRenderTarget(null);
                  renderer.readRenderTargetPixels(probeRT, 0, 0, 1, 1, probeBuf);
                  vectorValueRegistry.set(probeKey, [
                    probeBuf[0] / 255 * 2 - 1,
                    probeBuf[1] / 255 * 2 - 1,
                    probeBuf[2] / 255 * 2 - 1,
                  ]);
                }
              }

              // Own vec2/vec3 outputs — probe each so vizzes can read them.
              // Key: `__preview__${previewId}:${outputKey}` (parallel to upstream probe keys).
              for (const [outKey, outSocket] of Object.entries(previewNode.outputs)) {
                if (outSocket.type !== 'vec2' && outSocket.type !== 'vec3') continue;
                const ownVarName = nodeOutputVarMapRef.current.get(previewId)?.[outKey];
                if (!ownVarName) continue;
                const ownProbeKey = `__preview__${previewId}:${outKey}`;

                if (outSocket.type === 'vec2') {
                  const ownCacheKey = `sv2::${ownVarName}`;
                  let opm = previewScopeMatCache.get(ownCacheKey);
                  if (!opm) {
                    const ownProbeFs = buildSimpleVec2ProbeShader(curFs, ownVarName, VEC2_RANGE);
                    const ownUniforms: Record<string, { value: unknown }> = {};
                    for (const [k, u] of Object.entries(material.uniforms)) ownUniforms[k] = { value: u.value };
                    opm = new THREE.ShaderMaterial({ vertexShader: curVs, fragmentShader: ownProbeFs, uniforms: ownUniforms });
                    previewScopeMatCache.set(ownCacheKey, opm);
                  }
                  for (const [k, u] of Object.entries(material.uniforms)) {
                    if (opm.uniforms[k]) opm.uniforms[k].value = u.value;
                  }
                  probeMesh.material = opm;
                  renderer.setRenderTarget(probeRT);
                  renderer.render(probeScene, camera);
                  renderer.setRenderTarget(null);
                  renderer.readRenderTargetPixels(probeRT, 0, 0, 1, 1, probeBuf);
                  vectorValueRegistry.set(ownProbeKey, [
                    probeBuf[0] / 255 * VEC2_RANGE * 2 - VEC2_RANGE,
                    probeBuf[1] / 255 * VEC2_RANGE * 2 - VEC2_RANGE,
                  ]);
                } else {
                  const ownCacheKey = `v3::${ownVarName}`;
                  let opm = previewScopeMatCache.get(ownCacheKey);
                  if (!opm) {
                    const ownProbeFs = buildVecProbeShader(curFs, ownVarName, 'vec3');
                    const ownUniforms: Record<string, { value: unknown }> = {};
                    for (const [k, u] of Object.entries(material.uniforms)) ownUniforms[k] = { value: u.value };
                    opm = new THREE.ShaderMaterial({ vertexShader: curVs, fragmentShader: ownProbeFs, uniforms: ownUniforms });
                    previewScopeMatCache.set(ownCacheKey, opm);
                  }
                  for (const [k, u] of Object.entries(material.uniforms)) {
                    if (opm.uniforms[k]) opm.uniforms[k].value = u.value;
                  }
                  probeMesh.material = opm;
                  renderer.setRenderTarget(probeRT);
                  renderer.render(probeScene, camera);
                  renderer.setRenderTarget(null);
                  renderer.readRenderTargetPixels(probeRT, 0, 0, 1, 1, probeBuf);
                  vectorValueRegistry.set(ownProbeKey, [
                    probeBuf[0] / 255 * 2 - 1,
                    probeBuf[1] / 255 * 2 - 1,
                    probeBuf[2] / 255 * 2 - 1,
                  ]);
                }
              }

              probeMesh.material = probeDummy;
            }
          }
        }
      } else {
        idleFrames++;
        // Nothing to redraw, but the clock still runs while playing: keep the time readout (and
        // anything following it) current without drawing.
        if (playing && ++frameCount % SAMPLE_EVERY === 0) {
          if (hasTimeNodeRef.current) setCurrentTime(material.uniforms.u_time.value);
        }
      }

      // Keep the loop alive while something is moving, was just drawn, or the clock is running
      // (a frame with nothing to draw is cheap); otherwise, after a short idle run, stop
      // requesting frames until a trigger asks again. Stopping while playing froze the clock:
      // it only advanced when some store write woke the loop, then jumped.
      if (dynamic || needsRender || playing || idleFrames < IDLE_FRAMES_BEFORE_STOP) scheduleFrame();
      else {
        loopRunning = false;
        lastRafTime = null; // the next start counts from its own first frame, not across the stop
      }
    }
    scheduleFrame();

    const handleMouseMove = (e: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      // Drawing-buffer pixels, so u_mouse matches gl_FragCoord at any render scale
      const x = (e.clientX - rect.left) * renderScale;
      const y = (e.clientY - rect.top) * renderScale;
      // Update u_mouse uniform (WebGL coords: 0 = bottom-left)
      material.uniforms.u_mouse.value.set(x, rect.height * renderScale - y);
      // Track for pixel readback (DOM coords: 0 = top-left)
      mousePosRef.current = { x, y };
      requestRender(); // u_mouse changed, and the pixel readout wants a sample
    };
    const handleMouseLeave = () => {
      mousePosRef.current = null;
      requestRender(); // clears the pixel readout
    };
    renderer.domElement.addEventListener('mousemove', handleMouseMove);
    renderer.domElement.addEventListener('mouseleave', handleMouseLeave);

    // Reset time to 0 when 'reset-time' is fired (e.g. from Time node button)
    const handleResetTime = () => {
      virtualTime = 0;
      lastRafTime = null;
      material.uniforms.u_time.value = 0;
      requestRender();
    };
    window.addEventListener('reset-time', handleResetTime);

    // Seek to an arbitrary time when 'seek-time' is fired (e.g. from the
    // keyframe editor jumping the preview to the selected keyframe's moment).
    const handleSeekTime = (e: Event) => {
      const t = (e as CustomEvent<{ time: number }>).detail?.time;
      if (typeof t !== 'number') return;
      virtualTime = t;
      lastRafTime = null;
      material.uniforms.u_time.value = t;
      requestRender();
    };
    window.addEventListener('seek-time', handleSeekTime);

    // Nudge time by a relative amount when 'step-time' is fired (the global
    // Left/Right-arrow hotkeys) — clamped at 0 so "step backward" can't go
    // negative.
    const handleStepTime = (e: Event) => {
      const delta = (e as CustomEvent<{ delta: number }>).detail?.delta;
      if (typeof delta !== 'number') return;
      virtualTime = Math.max(0, virtualTime + delta);
      lastRafTime = null;
      material.uniforms.u_time.value = virtualTime;
      requestRender();
    };
    window.addEventListener('step-time', handleStepTime);

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      loopRunning = false;
      unsubRender();
      io?.disconnect();
      ro.disconnect();
      renderer.domElement.removeEventListener('webglcontextlost', handleContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', handleContextRestored);
      if (glContextLost) useNodeGraphStore.getState().setGlContextLost(false);
      renderer.domElement.removeEventListener('mousemove', handleMouseMove);
      renderer.domElement.removeEventListener('mouseleave', handleMouseLeave);
      window.removeEventListener('reset-time', handleResetTime);
      window.removeEventListener('seek-time', handleSeekTime);
      window.removeEventListener('step-time', handleStepTime);
      rt.dispose();
      floatRt.dispose();
      histRt.dispose();
      blitGeo.dispose();
      blitMat.dispose();
      probeRT.dispose();
      probeGeo.dispose();
      probeDummy.dispose();
      probeMatCache.forEach(m => m.dispose());
      scopeMatCache.forEach(m => m.dispose());
      previewScopeMatCache.forEach(m => m.dispose());
      pingPongA.current?.dispose();
      pingPongB.current?.dispose();
      // Dispose all GPU particle systems
      for (const [, points] of gpuParticlesRef.current) {
        points.geometry.dispose();
        (points.material as THREE.ShaderMaterial).dispose();
        particleScene.remove(points);
      }
      gpuParticlesRef.current.clear();
      particleSceneRef.current = null;
      perspCameraRef.current   = null;
      sceneRef.current = null;
      const loseCtx = renderer.getContext().getExtension('WEBGL_lose_context');
      loseCtx?.loseContext();
      renderer.dispose();
      container.removeChild(renderer.domElement);
    };
  }, []);

  // Keep refs in sync so the rAF loop always sees the latest value without
  // needing to restart the animation loop on every graph change.
  useEffect(() => { hasTimeNodeRef.current = hasTimeNode; }, [hasTimeNode]);
  useEffect(() => {
    isStatefulRef.current = isStateful;
    // When switching to stateful, ensure u_prevFrame uniform exists on the material
    const mat = materialRef.current;
    if (mat && isStateful && !mat.uniforms.u_prevFrame) {
      mat.uniforms.u_prevFrame = { value: null };
    }
    // When switching to non-stateful, reset ping-pong state
    if (!isStateful) {
      pingPongIdx.current = 0;
    }
  }, [isStateful]);

  // Sync probe refs from store so the rAF loop sees updates without re-running the effect
  useEffect(() => {
    const SCOPE_LIKE = new Set(['scope', 'sineLFO', 'squareLFO', 'sawtoothLFO', 'triangleLFO']);
    const syncNodes = (nodes: import('../types/nodeGraph').GraphNode[]) => {
      nodesRef.current  = nodes;
      nodeMapRef.current = new Map(nodes.map(n => [n.id, n]));
      scopeIdsRef.current = new Set(nodes.filter(n => SCOPE_LIKE.has(n.type)).map(n => n.id));
      audioIdsRef.current = nodes.filter(n => n.type === 'audioInput').map(n => n.id);
      videoIdsRef.current = nodes.filter(n => n.type === 'videoInput').map(n => n.id);
    };
    // This fires on *every* store write, including the ~10 Hz frame-loop
    // writes above, so rebuilding the node Map/Set is gated on the `nodes`
    // reference actually changing.
    const unsub = useNodeGraphStore.subscribe(state => {
      selectedNodeIdRef.current   = state.selectedNodeId;
      previewNodeIdRef.current    = state.previewNodeId;
      nodeOutputVarMapRef.current = state.nodeOutputVarMap;
      if (state.nodes !== nodesRef.current) syncNodes(state.nodes);
    });
    // Initialize immediately
    const s = useNodeGraphStore.getState();
    selectedNodeIdRef.current   = s.selectedNodeId;
    previewNodeIdRef.current    = s.previewNodeId;
    nodeOutputVarMapRef.current = s.nodeOutputVarMap;
    syncNodes(s.nodes);
    return unsub;
  }, []);

  // Update shader when compiled output changes — flush old errors first.
  // Also registers all param uniforms so THREE knows about them from the start.
  useEffect(() => {
    if (!materialRef.current || !vertexShader || !activeFragmentShader || !swapShaderRef.current) return;
    setGlslErrors([]);
    // Every shader *declares* u_time in its preamble; what matters is whether
    // the body reads it (a Time node, keyframe curves, rotate(..., u_time)…).
    usesTimeRef.current = /\bu_time\b/.test(activeFragmentShader.replace(/uniform\s+float\s+u_time\s*;/g, ''));
    // Register uniforms on the shared uniforms object — the new program is
    // compiled against it, and the old one ignores names it doesn't declare.
    const mat = materialRef.current;
    for (const [name, value] of Object.entries(paramUniforms)) {
      if (mat.uniforms[name]) {
        mat.uniforms[name].value = value;
      } else {
        mat.uniforms[name] = { value };
      }
    }
    // Always keep the font texture bound after recompile
    if (!mat.uniforms.u_fontTexture) mat.uniforms.u_fontTexture = { value: FONT_TEXTURE };
    else mat.uniforms.u_fontTexture.value = FONT_TEXTURE;
    // Register sampler2D texture uniforms (initial value null — filled by texture effect)
    const currentTextureUniforms = useNodeGraphStore.getState().textureUniforms;
    for (const uniformName of Object.keys(currentTextureUniforms)) {
      if (!mat.uniforms[uniformName]) {
        mat.uniforms[uniformName] = { value: null };
      }
    }
    // Register float audio uniforms (initial value 0 — updated each rAF frame)
    const currentAudioUniforms = useNodeGraphStore.getState().audioUniforms;
    for (const uniformName of Object.keys(currentAudioUniforms)) {
      if (!mat.uniforms[uniformName]) {
        mat.uniforms[uniformName] = { value: 0 };
      }
    }
    // Register sampler2D video uniforms (initial value null — filled by video effect)
    const currentVideoUniforms = useNodeGraphStore.getState().videoUniforms;
    for (const uniformName of Object.keys(currentVideoUniforms)) {
      if (!mat.uniforms[uniformName]) {
        mat.uniforms[uniformName] = { value: null };
      }
    }
    swapShaderRef.current(vertexShader, activeFragmentShader).then(swapped => {
      if (!swapped) return; // superseded by a newer shader
      // Only now is this the live program: probe programs are built from these
      // refs, so they must not point at source that isn't drawing yet.
      fragmentShaderRef.current = activeFragmentShader;
      vertexShaderRef.current = vertexShader;
      // On structural recompile, reset ping-pong state to prevent stale frame
      // bleed — after the swap, so the old program never draws into cleared history.
      if (pingPongA.current && pingPongB.current) {
        const r = rendererRef.current;
        if (r) {
          r.setRenderTarget(pingPongA.current); r.clear();
          r.setRenderTarget(pingPongB.current); r.clear();
          r.setRenderTarget(null);
        }
        pingPongIdx.current = 0;
      }
    });
  }, [vertexShader, activeFragmentShader]); // eslint-disable-line react-hooks/exhaustive-deps

  // Bind sampler2D texture uniforms — runs when textureUniforms or nodeTextures change.
  useEffect(() => {
    const mat = materialRef.current;
    if (!mat) return;
    for (const [uniformName, nodeId] of Object.entries(textureUniforms)) {
      const tex = nodeTextures[nodeId] ?? null;
      if (mat.uniforms[uniformName]) {
        mat.uniforms[uniformName].value = tex;
      } else {
        mat.uniforms[uniformName] = { value: tex };
      }
    }
  }, [textureUniforms, nodeTextures]);

  // Bind VideoTexture uniforms — runs when videoUniforms or videoTextures change.
  useEffect(() => {
    const mat = materialRef.current;
    if (!mat) return;
    for (const [uniformName, nodeId] of Object.entries(videoUniforms)) {
      const tex = videoTextures[nodeId] ?? null;
      if (mat.uniforms[uniformName]) {
        mat.uniforms[uniformName].value = tex;
      } else {
        mat.uniforms[uniformName] = { value: tex };
      }
    }
  }, [videoUniforms, videoTextures]);

  // Sync GPU particle systems: create/remove THREE.Points whenever store.particleSystems changes.
  // Geometry is rebuilt from shape each time (shapes/counts only change on recompile, not slider moves).
  useEffect(() => {
    const pScene = particleSceneRef.current;
    if (!pScene) return;

    const existing = gpuParticlesRef.current;
    const incoming = new Set(particleSystems.map(p => p.nodeId));

    // Remove stale particle systems
    for (const [nodeId, points] of existing) {
      if (!incoming.has(nodeId)) {
        pScene.remove(points);
        points.geometry.dispose();
        (points.material as THREE.ShaderMaterial).dispose();
        existing.delete(nodeId);
      }
    }

    for (const psData of particleSystems) {
      const { nodeId, vertexShader, fragmentShader, count, shape, paramUniforms: pUniforms } = psData;

      // Always recreate on topology change (new shaders, possibly different count/shape)
      if (existing.has(nodeId)) {
        const old = existing.get(nodeId)!;
        pScene.remove(old);
        old.geometry.dispose();
        (old.material as THREE.ShaderMaterial).dispose();
        existing.delete(nodeId);
      }

      const { positions, normDists } = buildParticleGeometry(count, shape);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position',    new THREE.BufferAttribute(positions, 3, false));
      geo.setAttribute('a_normDist',  new THREE.BufferAttribute(normDists, 1, false));

      // Build initial uniforms from paramUniforms + u_time
      const uniforms: Record<string, { value: number }> = { u_time: { value: 0 } };
      for (const [name, value] of Object.entries(pUniforms)) {
        uniforms[name] = { value };
      }

      const mat = new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms,
        transparent: true,
        depthTest:   false,
        depthWrite:  false,
        blending:    THREE.AdditiveBlending,
      });

      const points = new THREE.Points(geo, mat);
      pScene.add(points);
      existing.set(nodeId, points);
    }
  }, [particleSystems]); // eslint-disable-line react-hooks/exhaustive-deps

  // Hot-update param uniform values without recompiling — runs only when paramUniforms
  // changes but fragmentShader has NOT changed (slider fast-path).
  // Also syncs particle material uniforms since particle paramUniforms are merged in.
  useEffect(() => {
    const mat = materialRef.current;
    if (mat) {
      for (const [name, value] of Object.entries(paramUniforms)) {
        if (mat.uniforms[name]) mat.uniforms[name].value = value;
      }
    }
    for (const [, points] of gpuParticlesRef.current) {
      const pMat = points.material as THREE.ShaderMaterial;
      for (const [name, value] of Object.entries(paramUniforms)) {
        if (pMat.uniforms[name]) pMat.uniforms[name].value = value;
      }
    }
    // The store write already asked for a frame, but that frame can run before this effect (a
    // pointer-driven slider commits at a lower priority than a native range input) and draw the
    // old value. Ask again now that the new values are on the material.
    requestRenderRef.current();
  }, [paramUniforms]);

  return (
    <div
      ref={canvasRef}
      style={{ width: '100%', height: '100%', background: '#000', position: 'relative', overflow: 'hidden' }}
    />
  );
}
