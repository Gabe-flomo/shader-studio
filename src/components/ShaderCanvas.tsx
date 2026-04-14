import { useRef, useEffect } from 'react';
import * as THREE from 'three';
import { useNodeGraphStore } from '../store/useNodeGraphStore';
import { drawScopeCanvas } from '../lib/scopeRegistry';
import { audioEngine } from '../lib/audioEngine';
import { audioSpectrumRegistry, drawSpectrumCanvas } from '../lib/audioSpectrumRegistry';

export type CanvasHandle = { canvas: HTMLCanvasElement };

/** Handle returned to ExportModal for offline frame rendering + pixel readback */
export interface OfflineRenderHandle {
  /** Render the shader at an exact time value into the dedicated export RT */
  renderAtTime: (time: number) => void;
  /** Read pixels from the last renderAtTime call into `out` (RGBA, top-down) */
  readPixels: (out: Uint8Array, width: number, height: number) => void;
  /** Pixel dimensions of the export render target */
  width: number;
  height: number;
}

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

// Intercept WebGL shader compile errors from Three.js
function captureGlslErrors(gl: WebGLRenderingContext | WebGL2RenderingContext): () => string[] {
  const errors: string[] = [];
  const origCompile = gl.compileShader.bind(gl);
  (gl as unknown as Record<string, unknown>).compileShader = (shader: WebGLShader) => {
    origCompile(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader);
      if (log) errors.push(...log.split('\n').filter(l => l.trim()));
    }
  };
  return () => {
    const copy = [...errors];
    errors.length = 0;
    return copy;
  };
}

interface Props {
  /** Called with the WebGL canvas element once Three.js is initialized */
  onCanvasReady?: (canvas: HTMLCanvasElement) => void;
  /**
   * Called once with an OfflineRenderHandle for FFmpeg frame-by-frame encoding.
   * Uses a dedicated WebGLRenderTarget — completely isolated from the live canvas.
   */
  onRegisterOfflineRender?: (handle: OfflineRenderHandle) => void;
}

export default function ShaderCanvas({ onCanvasReady, onRegisterOfflineRender }: Props = {}) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const materialRef = useRef<THREE.ShaderMaterial | null>(null);
  const animFrameRef = useRef<number>(0);
  const rtRef = useRef<THREE.WebGLRenderTarget | null>(null);
  // Ping-pong render targets for stateful shaders (PrevFrame node)
  const pingPongA   = useRef<THREE.WebGLRenderTarget | null>(null);
  const pingPongB   = useRef<THREE.WebGLRenderTarget | null>(null);
  const pingPongIdx = useRef<0 | 1>(0);  // 0 = A is read target, B is write; 1 = vice versa
  // Ref mirrors for stateful flag so rAF loop sees latest without re-boot
  const isStatefulRef = useRef(false);
  // Track mouse pixel position in canvas — null when mouse is not over canvas
  const mousePosRef = useRef<{ x: number; y: number } | null>(null);
  // Ref mirror for hasTimeNode so the rAF loop always sees the latest value
  const hasTimeNodeRef = useRef(false);

  const vertexShader       = useNodeGraphStore((state) => state.vertexShader);
  const fragmentShader     = useNodeGraphStore((state) => state.fragmentShader);
  const rawGlslShader      = useNodeGraphStore((state) => state.rawGlslShader);
  const activeFragmentShader = rawGlslShader ?? fragmentShader;
  const paramUniforms      = useNodeGraphStore((state) => state.paramUniforms);
  const textureUniforms    = useNodeGraphStore((state) => state.textureUniforms);
  const nodeTextures       = useNodeGraphStore((state) => state.nodeTextures);
  const isStateful         = useNodeGraphStore((state) => state.isStateful);
  const setGlslErrors      = useNodeGraphStore((state) => state.setGlslErrors);
  const setPixelSample     = useNodeGraphStore((state) => state.setPixelSample);
  const setCurrentTime     = useNodeGraphStore((state) => state.setCurrentTime);
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

  // Boot Three.js once
  useEffect(() => {
    const container = canvasRef.current!;

    const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
    renderer.setSize(1, 1);
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;
    onCanvasReady?.(renderer.domElement);

    // Enable parallel shader compilation — keeps previous frame rendering while new shader compiles
    const gl = renderer.getContext();
    gl.getExtension('KHR_parallel_shader_compile');
    const flushGlErrors = captureGlslErrors(gl);

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    camera.position.z = 1;

    const geometry = new THREE.PlaneGeometry(2, 2);
    const { vertexShader: vs, fragmentShader: fs } = useNodeGraphStore.getState();
    const material = new THREE.ShaderMaterial({
      vertexShader: vs || FALLBACK_VERTEX,
      fragmentShader: fs || FALLBACK_FRAGMENT,
      uniforms: {
        u_time:       { value: 0 },
        u_resolution: { value: new THREE.Vector2(1, 1) },
        u_mouse:      { value: new THREE.Vector2(0, 0) },
        u_prevFrame:  { value: null },
      },
    });
    materialRef.current = material;

    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    // Register offline render handle for FFmpeg export.
    // Uses a dedicated WebGLRenderTarget — completely isolated from the live
    // display canvas so resize events and double-buffering can't corrupt readback.
    //
    // The RT is created lazily on first renderAtTime() so it's always sized to
    // the actual canvas size (ResizeObserver fires after the first layout tick,
    // but the setup effect runs before that).
    if (onRegisterOfflineRender) {
      let exportRT: THREE.WebGLRenderTarget | null = null;
      let exportW = 0;
      let exportH = 0;

      // Create (or re-create) the RT at the current renderer size.
      // Called once when the ExportModal opens (via the width/height getters),
      // locking in the export dimensions for the duration of the encode.
      const ensureRT = () => {
        const w = renderer.domElement.width  || 1;
        const h = renderer.domElement.height || 1;
        if (!exportRT || exportW !== w || exportH !== h) {
          exportRT?.dispose();
          exportRT = new THREE.WebGLRenderTarget(w, h, {
            type: THREE.UnsignedByteType,
            format: THREE.RGBAFormat,
            depthBuffer: false,
          });
          exportW = w;
          exportH = h;
        }
      };

      const handle: OfflineRenderHandle = {
        // width/height getters read the current renderer size and ensure the RT
        // is sized to match — called by ExportModal to snapshot dimensions before encoding.
        get width()  { ensureRT(); return exportW; },
        get height() { ensureRT(); return exportH; },
        renderAtTime: (time: number) => {
          // RT is already sized correctly (handle.width/height was read first)
          material.uniforms.u_time.value = time;
          renderer.setRenderTarget(exportRT);
          renderer.render(scene, camera);
          renderer.setRenderTarget(null);
        },
        readPixels: (out: Uint8Array, width: number, height: number) => {
          if (!exportRT) return;
          renderer.readRenderTargetPixels(exportRT, 0, 0, width, height, out);
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

      // Clean up RT when renderer is torn down
      const origDispose = renderer.dispose.bind(renderer);
      renderer.dispose = () => { exportRT?.dispose(); origDispose(); };
    }

    // Render target for pixel readback — sized with the canvas, resized in ResizeObserver
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.UnsignedByteType });
    rtRef.current = rt;

    // ── Node probe: isolated scene + 1×1 RT ──────────────────────────────────
    // Completely separate from `scene` so probe renders never appear on-screen.
    const probeScene  = new THREE.Scene();
    const probeGeo    = new THREE.PlaneGeometry(2, 2);
    const probeDummy  = new THREE.ShaderMaterial({ vertexShader: FALLBACK_VERTEX, fragmentShader: FALLBACK_FRAGMENT });
    const probeMesh   = new THREE.Mesh(probeGeo, probeDummy);
    probeScene.add(probeMesh);
    const probeRT     = new THREE.WebGLRenderTarget(1, 1, { type: THREE.UnsignedByteType, depthBuffer: false });
    const probeBuf    = new Uint8Array(4);
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

    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      if (width === 0 || height === 0) return;
      renderer.setSize(width, height);
      material.uniforms.u_resolution.value.set(width, height);
      rt.setSize(width, height);
      // Resize ping-pong RTs and reset state
      if (pingPongA.current) { pingPongA.current.dispose(); pingPongA.current = null; }
      if (pingPongB.current) { pingPongB.current.dispose(); pingPongB.current = null; }
      pingPongIdx.current = 0;
      if (material.uniforms.u_prevFrame) material.uniforms.u_prevFrame.value = null;
    });
    ro.observe(container);

    // Helper to lazily create ping-pong targets at current canvas size
    const ensurePingPong = () => {
      const w = renderer.domElement.width  || 1;
      const h = renderer.domElement.height || 1;
      if (!pingPongA.current) {
        const opts = { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: false };
        pingPongA.current = new THREE.WebGLRenderTarget(w, h, opts);
        pingPongB.current = new THREE.WebGLRenderTarget(w, h, opts);
        // Clear both to black
        renderer.setRenderTarget(pingPongA.current); renderer.clear();
        renderer.setRenderTarget(pingPongB.current); renderer.clear();
        renderer.setRenderTarget(null);
      }
    };

    const clock = new THREE.Clock();
    let frameCount = 0;
    const SAMPLE_EVERY = 6; // sample every 6 frames (~10fps if running at 60fps)
    // Per-node Uint8Array buffers for audio FFT data — allocated once, reused each frame
    const audioFreqBuffers = new Map<string, Uint8Array>();

    // ── Render at 30fps max regardless of display refresh rate ───────────────
    // On 120Hz ProMotion displays, uncapped rAF renders 120fps and spins the fan
    // even on trivial shaders. 30fps halves GPU load vs 60Hz and quarters vs 120Hz.
    const TARGET_FPS = 30;
    const FRAME_MS   = 1000 / TARGET_FPS;   // ~33.3 ms
    let lastFrameTime = 0;

    function animate(now: number = 0) {
      animFrameRef.current = requestAnimationFrame(animate);

      // Skip entirely when the browser tab is not visible
      if (document.hidden) return;

      // FPS gate — skip this callback if not enough wall-clock time has elapsed
      if (now - lastFrameTime < FRAME_MS) return;
      lastFrameTime = now;

      material.uniforms.u_time.value = clock.getElapsedTime();

      // ── Audio engine tick: push amplitude uniforms + draw live spectrum ──
      const audioAmps = audioEngine.tick();
      for (const [uName, amp] of audioAmps) {
        if (material.uniforms[uName]) {
          material.uniforms[uName].value = amp;
        }
      }
      // Draw live spectrum into any open AudioInputModal canvases
      const audioNodes = nodesRef.current.filter(n => n.type === 'audioInput');
      for (const n of audioNodes) {
        if (!audioSpectrumRegistry.has(n.id)) continue;
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

      if (isStatefulRef.current) {
        // Ping-pong: read from one RT, write to the other, then blit to screen
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
        renderer.setRenderTarget(null);
        renderer.render(scene, camera);  // blit to screen
        pingPongIdx.current = pingPongIdx.current === 0 ? 1 : 0;
      } else {
        renderer.render(scene, camera);
      }

      // Check for GLSL errors after first few renders
      const newErrors = flushGlErrors();
      if (newErrors.length > 0) {
        setGlslErrors(newErrors);
      }

      // Throttled updates every N frames
      frameCount++;
      if (frameCount % SAMPLE_EVERY === 0) {
        // Only broadcast time when the graph actually has a Time node
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
          if (rtW > 0 && rtH > 0) {
            renderer.setRenderTarget(rt);
            renderer.render(scene, camera);
            renderer.setRenderTarget(null);

            // WebGL Y-axis is flipped relative to DOM (0 = bottom)
            const px = Math.max(0, Math.min(rtW - 1, Math.round(mp.x)));
            const py = Math.max(0, Math.min(rtH - 1, Math.round(rtH - 1 - mp.y)));
            const buf = new Uint8Array(4);
            renderer.readRenderTargetPixels(rt, px, py, 1, 1, buf);
            setPixelSample([buf[0], buf[1], buf[2], buf[3]]);
          }
        }

        // ── Node probe: sample selected node's output vars ──────────────────
        const selId = selectedNodeIdRef.current;
        if (selId) {
          const outputVars = nodeOutputVarMapRef.current.get(selId);
          const selNode    = nodesRef.current.find(n => n.id === selId);
          const _curFs     = useNodeGraphStore.getState().fragmentShader;
          const curFs      = useNodeGraphStore.getState().rawGlslShader ?? _curFs;
          const curVs      = useNodeGraphStore.getState().vertexShader;

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

      // ── Scope + LFO nodes: sample every frame, draw waveform directly to canvas ──
      const SCOPE_LIKE_TYPES = new Set(['scope', 'sineLFO', 'squareLFO', 'sawtoothLFO', 'triangleLFO']);
      const scopeNodes = nodesRef.current.filter(n => SCOPE_LIKE_TYPES.has(n.type));
      if (scopeNodes.length > 0) {
        const _curScopeFs = useNodeGraphStore.getState().fragmentShader;
        const curScopeFs = useNodeGraphStore.getState().rawGlslShader ?? _curScopeFs;
        const curScopeVs = useNodeGraphStore.getState().vertexShader;
        if (curScopeFs && curScopeVs) {
          if (lastScopeFs !== curScopeFs) {
            scopeMatCache.forEach(m => m.dispose());
            scopeMatCache.clear();
            lastScopeFs = curScopeFs;
          }
          for (const scopeNode of scopeNodes) {
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

      // ── Preview scope: waveform for float-output nodes when 👁 is active ──
      const previewId = previewNodeIdRef.current;
      if (previewId) {
        const previewNode = nodesRef.current.find(n => n.id === previewId);
        const floatOutputKey = previewNode
          ? Object.entries(previewNode.outputs).find(([, s]) => s.type === 'float')?.[0]
          : null;
        if (floatOutputKey) {
          const outputVars = nodeOutputVarMapRef.current.get(previewId);
          const varName    = outputVars?.[floatOutputKey];
          if (varName) {
            const _curFs2 = useNodeGraphStore.getState().fragmentShader;
            const curFs = useNodeGraphStore.getState().rawGlslShader ?? _curFs2;
            const curVs = useNodeGraphStore.getState().vertexShader;
            if (curFs && curVs) {
              if (lastPreviewScopeFs !== curFs) {
                previewScopeMatCache.forEach(m => m.dispose());
                previewScopeMatCache.clear();
                lastPreviewScopeFs = curFs;
              }
              const cacheKey = `${varName}::-1::1`;
              let pm = previewScopeMatCache.get(cacheKey);
              if (!pm) {
                const probeFs = buildScopeProbeShader(curFs, varName, -1, 1);
                const clonedUniforms: Record<string, { value: unknown }> = {};
                for (const [k, u] of Object.entries(material.uniforms)) {
                  clonedUniforms[k] = { value: u.value };
                }
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
              probeMesh.material = probeDummy;
            }
          }
        }
      }
    }
    animate();

    const handleMouseMove = (e: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      // Update u_mouse uniform (WebGL coords: 0 = bottom-left)
      material.uniforms.u_mouse.value.set(x, rect.height - y);
      // Track for pixel readback (DOM coords: 0 = top-left)
      mousePosRef.current = { x, y };
    };
    const handleMouseLeave = () => {
      mousePosRef.current = null;
    };
    renderer.domElement.addEventListener('mousemove', handleMouseMove);
    renderer.domElement.addEventListener('mouseleave', handleMouseLeave);

    // Reset time to 0 when 'reset-time' is fired (e.g. from Time node button)
    const handleResetTime = () => {
      clock.start();
      material.uniforms.u_time.value = 0;
    };
    window.addEventListener('reset-time', handleResetTime);

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      ro.disconnect();
      renderer.domElement.removeEventListener('mousemove', handleMouseMove);
      renderer.domElement.removeEventListener('mouseleave', handleMouseLeave);
      window.removeEventListener('reset-time', handleResetTime);
      rt.dispose();
      probeRT.dispose();
      probeGeo.dispose();
      probeDummy.dispose();
      probeMatCache.forEach(m => m.dispose());
      scopeMatCache.forEach(m => m.dispose());
      previewScopeMatCache.forEach(m => m.dispose());
      pingPongA.current?.dispose();
      pingPongB.current?.dispose();
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
    const unsub = useNodeGraphStore.subscribe(state => {
      selectedNodeIdRef.current   = state.selectedNodeId;
      previewNodeIdRef.current    = state.previewNodeId;
      nodeOutputVarMapRef.current = state.nodeOutputVarMap;
      nodesRef.current            = state.nodes;
    });
    // Initialize immediately
    const s = useNodeGraphStore.getState();
    selectedNodeIdRef.current   = s.selectedNodeId;
    previewNodeIdRef.current    = s.previewNodeId;
    nodeOutputVarMapRef.current = s.nodeOutputVarMap;
    nodesRef.current            = s.nodes;
    return unsub;
  }, []);

  // Update shader when compiled output changes — flush old errors first.
  // Also registers all param uniforms so THREE knows about them from the start.
  useEffect(() => {
    if (!materialRef.current || !vertexShader || !activeFragmentShader) return;
    setGlslErrors([]);
    materialRef.current.vertexShader = vertexShader;
    materialRef.current.fragmentShader = activeFragmentShader;
    // Register param uniforms on the material (initial values from compilation)
    const mat = materialRef.current;
    for (const [name, value] of Object.entries(paramUniforms)) {
      if (mat.uniforms[name]) {
        mat.uniforms[name].value = value;
      } else {
        mat.uniforms[name] = { value };
      }
    }
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
    mat.needsUpdate = true;
    // On structural recompile, reset ping-pong state to prevent stale frame bleed
    if (pingPongA.current && pingPongB.current) {
      const r = rendererRef.current;
      if (r) {
        r.setRenderTarget(pingPongA.current); r.clear();
        r.setRenderTarget(pingPongB.current); r.clear();
        r.setRenderTarget(null);
      }
      pingPongIdx.current = 0;
    }
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

  // Hot-update param uniform values without recompiling — runs only when paramUniforms
  // changes but fragmentShader has NOT changed (slider fast-path).
  useEffect(() => {
    const mat = materialRef.current;
    if (!mat) return;
    for (const [name, value] of Object.entries(paramUniforms)) {
      if (mat.uniforms[name]) {
        mat.uniforms[name].value = value;
      }
      // If the uniform isn't registered yet (e.g. shader just compiled), ignore —
      // the fragmentShader effect above handles registration.
    }
  }, [paramUniforms]);

  return (
    <div
      ref={canvasRef}
      style={{ width: '100%', height: '100%', background: '#000', position: 'relative', overflow: 'hidden' }}
    />
  );
}
