import { useRef, useEffect } from 'react';
import * as THREE from 'three';
import { useNodeGraphStore } from '../store/useNodeGraphStore';

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
  // Track mouse pixel position in canvas — null when mouse is not over canvas
  const mousePosRef = useRef<{ x: number; y: number } | null>(null);
  // Ref mirror for hasTimeNode so the rAF loop always sees the latest value
  const hasTimeNodeRef = useRef(false);

  const vertexShader       = useNodeGraphStore((state) => state.vertexShader);
  const fragmentShader     = useNodeGraphStore((state) => state.fragmentShader);
  const setGlslErrors      = useNodeGraphStore((state) => state.setGlslErrors);
  const setPixelSample     = useNodeGraphStore((state) => state.setPixelSample);
  const setCurrentTime     = useNodeGraphStore((state) => state.setCurrentTime);
  const setNodeProbeValues = useNodeGraphStore((state) => state.setNodeProbeValues);
  // Only broadcast currentTime when a Time node is in the graph — avoids 10fps
  // re-renders of all NodeComponents on graphs that don't use time at all.
  const hasTimeNode        = useNodeGraphStore((state) => state.nodes.some(n => n.type === 'time'));
  // Node probe: ref-mirrors updated by a separate effect so the rAF loop sees latest
  const selectedNodeIdRef  = useRef<string | null>(null);
  const nodeOutputVarMapRef = useRef<Map<string, Record<string, string>>>(new Map());
  const nodesRef           = useRef<import('../types/nodeGraph').GraphNode[]>([]);

  // Boot Three.js once
  useEffect(() => {
    const container = canvasRef.current!;

    const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
    renderer.setSize(1, 1);
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;
    onCanvasReady?.(renderer.domElement);

    // Intercept WebGL compile errors
    const gl = renderer.getContext();
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
        u_time: { value: 0 },
        u_resolution: { value: new THREE.Vector2(1, 1) },
        u_mouse: { value: new THREE.Vector2(0, 0) },
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

    // Build a 1-px probe shader: full frag shader but gl_FragColor = packed varName
    const buildProbeShader = (fs: string, varName: string, varType: string): string => {
      const stripped = fs.replace(/gl_FragColor\s*=\s*[^;]+;[^}]*\}(\s*)$/, '');
      let packed: string;
      switch (varType) {
        case 'float': packed = `vec4(${varName}, ${varName}, ${varName}, 1.0)`; break;
        case 'vec2':  packed = `vec4(${varName}, 0.0, 1.0)`; break;
        case 'vec3':  packed = `vec4(${varName}, 1.0)`; break;
        case 'vec4':  packed = varName; break;
        default:      packed = `vec4(0.0)`; break;
      }
      return `${stripped}  gl_FragColor = ${packed};\n}`;
    };

    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      if (width === 0 || height === 0) return;
      renderer.setSize(width, height);
      material.uniforms.u_resolution.value.set(width, height);
      rt.setSize(width, height);
    });
    ro.observe(container);

    const clock = new THREE.Clock();
    let frameCount = 0;
    const SAMPLE_EVERY = 6; // sample every 6 frames (~10fps if running at 60fps)

    function animate() {
      animFrameRef.current = requestAnimationFrame(animate);
      material.uniforms.u_time.value = clock.getElapsedTime();
      renderer.render(scene, camera);

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
          const curFs      = useNodeGraphStore.getState().fragmentShader;
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

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      ro.disconnect();
      renderer.domElement.removeEventListener('mousemove', handleMouseMove);
      renderer.domElement.removeEventListener('mouseleave', handleMouseLeave);
      rt.dispose();
      probeRT.dispose();
      probeGeo.dispose();
      probeDummy.dispose();
      probeMatCache.forEach(m => m.dispose());
      renderer.dispose();
      container.removeChild(renderer.domElement);
    };
  }, []);

  // Keep ref in sync so the rAF loop always sees the latest value without
  // needing to restart the animation loop on every graph change.
  useEffect(() => { hasTimeNodeRef.current = hasTimeNode; }, [hasTimeNode]);

  // Sync probe refs from store so the rAF loop sees updates without re-running the effect
  useEffect(() => {
    const unsub = useNodeGraphStore.subscribe(state => {
      selectedNodeIdRef.current  = state.selectedNodeId;
      nodeOutputVarMapRef.current = state.nodeOutputVarMap;
      nodesRef.current           = state.nodes;
    });
    // Initialize immediately
    const s = useNodeGraphStore.getState();
    selectedNodeIdRef.current  = s.selectedNodeId;
    nodeOutputVarMapRef.current = s.nodeOutputVarMap;
    nodesRef.current           = s.nodes;
    return unsub;
  }, []);

  // Update shader when compiled output changes — flush old errors first
  useEffect(() => {
    if (!materialRef.current || !vertexShader || !fragmentShader) return;
    setGlslErrors([]); // clear stale errors before recompile
    materialRef.current.vertexShader = vertexShader;
    materialRef.current.fragmentShader = fragmentShader;
    materialRef.current.needsUpdate = true;
  }, [vertexShader, fragmentShader]);

  return (
    <div
      ref={canvasRef}
      style={{ width: '100%', height: '100%', background: '#000', position: 'relative', overflow: 'hidden' }}
    />
  );
}
