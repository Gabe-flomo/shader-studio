/**
 * contextLossCheck — a dev harness (window.__shaderStudioDev.contextLossCheck) that loses and
 * restores the preview's WebGL context the way a hidden tab or a GPU reset does
 * (WEBGL_lose_context), and reports what went wrong afterwards: GL errors (a call on an object
 * of the old context, an extension not enabled on the new one), uncaught errors (a uniform
 * written through `undefined`), and whether the preview came back.
 *
 *   await __shaderStudioDev.contextLossCheck({ example: 'agentRulesSlime' })
 *   → { ok: true, glErrors: [], uncaught: [], recovered: true }
 *
 * While it runs, every call in WATCHED is followed by a getError() on its context (slow: a check
 * only). The browser's own "WebGL: INVALID_OPERATION …" console lines are the same errors.
 */
import { useNodeGraphStore } from '../store/useNodeGraphStore';

const WATCHED = [
  'deleteTexture', 'deleteFramebuffer', 'deleteBuffer', 'deleteProgram', 'deleteShader', 'deleteRenderbuffer', 'deleteQuery', 'deleteVertexArray', 'deleteSync',
  'getQueryParameter', 'getParameter', 'useProgram', 'bindTexture', 'bindFramebuffer', 'bindBuffer', 'bindVertexArray', 'beginQuery',
  'drawArrays', 'drawElements', 'drawArraysInstanced', 'texImage2D', 'texSubImage2D', 'readPixels', 'framebufferTexture2D', 'bufferData', 'getBufferSubData',
] as const;

export interface ContextLossReport {
  ok: boolean;
  /** "deleteTexture 1282 at …" (1282 INVALID_OPERATION, 1280 INVALID_ENUM), one per call site. */
  glErrors: string[];
  uncaught: string[];
  /** The preview's context is live again and the store no longer says it is lost. */
  recovered: boolean;
}

/** The main preview's canvas (ShaderCanvas's renderer: touch-action none, the widest WebGL2 one). */
function previewCanvas(): HTMLCanvasElement | null {
  const all = [...document.querySelectorAll('canvas')].filter(c => c.style.touchAction === 'none' && c.style.display === 'block' && !!c.getContext('webgl2'));
  return all.sort((a, b) => b.width - a.width)[0] ?? null;
}

const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export async function contextLossCheck(o: { example?: string; lostMs?: number; afterMs?: number; loadMs?: number } = {}): Promise<ContextLossReport> {
  const st = useNodeGraphStore.getState();
  if (o.example) {
    await st.loadExampleGraph(o.example);
    useNodeGraphStore.getState().setTimePlaying(true);
    await wait(o.loadMs ?? 3000);
  }
  const canvas = previewCanvas();
  const gl = canvas?.getContext('webgl2') ?? null;
  const lose = gl?.getExtension('WEBGL_lose_context');
  if (!gl || !lose) return { ok: false, glErrors: ['no preview canvas with WEBGL_lose_context'], uncaught: [], recovered: false };

  const glErrors = new Set<string>();
  const uncaught: string[] = [];
  const P = WebGL2RenderingContext.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
  const getError = WebGL2RenderingContext.prototype.getError;
  const originals = new Map<string, (...a: unknown[]) => unknown>();
  for (const name of WATCHED) {
    const orig = P[name];
    originals.set(name, orig);
    P[name] = function (this: WebGL2RenderingContext, ...a: unknown[]) {
      const r = orig.apply(this, a);
      const e = getError.call(this);
      if (e && e !== this.CONTEXT_LOST_WEBGL) {
        const at = (new Error().stack ?? '').split('\n').slice(2, 4).map(s => s.trim()).join(' < ');
        glErrors.add(`${name} ${e} ${at}`);
      }
      return r;
    };
  }
  const onError = (e: ErrorEvent) => uncaught.push(String(e.message));
  window.addEventListener('error', onError);
  try {
    lose.loseContext();
    await wait(o.lostMs ?? 1000);
    lose.restoreContext();
    await wait(o.afterMs ?? 4000);
  } finally {
    for (const [name, orig] of originals) P[name] = orig;
    window.removeEventListener('error', onError);
  }
  const recovered = !gl.isContextLost() && !useNodeGraphStore.getState().glContextLost;
  return { ok: glErrors.size === 0 && uncaught.length === 0 && recovered, glErrors: [...glErrors], uncaught, recovered };
}
