import { useRef, useEffect } from 'react';
import * as THREE from 'three';
import { useNodeGraphStore } from '../store/useNodeGraphStore';

export type CanvasHandle = { canvas: HTMLCanvasElement };

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
}

export default function ShaderCanvas({ onCanvasReady }: Props = {}) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const materialRef = useRef<THREE.ShaderMaterial | null>(null);
  const animFrameRef = useRef<number>(0);
  const rtRef = useRef<THREE.WebGLRenderTarget | null>(null);
  // Track mouse pixel position in canvas — null when mouse is not over canvas
  const mousePosRef = useRef<{ x: number; y: number } | null>(null);
  // Ref mirror for hasTimeNode so the rAF loop always sees the latest value
  const hasTimeNodeRef = useRef(false);

  const vertexShader    = useNodeGraphStore((state) => state.vertexShader);
  const fragmentShader  = useNodeGraphStore((state) => state.fragmentShader);
  const setGlslErrors   = useNodeGraphStore((state) => state.setGlslErrors);
  const setPixelSample  = useNodeGraphStore((state) => state.setPixelSample);
  const setCurrentTime  = useNodeGraphStore((state) => state.setCurrentTime);
  // Only broadcast currentTime when a Time node is in the graph — avoids 10fps
  // re-renders of all NodeComponents on graphs that don't use time at all.
  const hasTimeNode     = useNodeGraphStore((state) => state.nodes.some(n => n.type === 'time'));

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

    // Render target for pixel readback — sized with the canvas, resized in ResizeObserver
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.UnsignedByteType });
    rtRef.current = rt;

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
      renderer.dispose();
      container.removeChild(renderer.domElement);
    };
  }, []);

  // Keep ref in sync so the rAF loop always sees the latest value without
  // needing to restart the animation loop on every graph change.
  useEffect(() => { hasTimeNodeRef.current = hasTimeNode; }, [hasTimeNode]);

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
