/**
 * readableView — the Generated code panel's Readable / Exact switch (docs/readable-code.md).
 * The choice lasts for the browser session; the GPU check makes sure a Readable program the
 * driver rejects (while Exact compiles) falls back to Exact with a note.
 */
const KEY = 'codePanel_view';
export type CodeView = 'exact' | 'readable';

export function loadCodeView(): CodeView {
  try { return sessionStorage.getItem(KEY) === 'readable' ? 'readable' : 'exact'; } catch { return 'exact'; }
}
export function saveCodeView(v: CodeView): void {
  try { sessionStorage.setItem(KEY, v); } catch { /* storage blocked: the switch still works for this panel */ }
}

let gl: WebGLRenderingContext | WebGL2RenderingContext | null | undefined;
const verdicts = new Map<string, boolean | null>();

/** Does this fragment shader compile on this GPU? null when there is no WebGL to ask. Remembered per source. */
export function fragmentCompiles(src: string): boolean | null {
  const hit = verdicts.get(src);
  if (hit !== undefined) return hit;
  let ok: boolean | null = null;
  try {
    if (gl === undefined) {
      const c = typeof document !== 'undefined' ? document.createElement('canvas') : null;
      gl = (c?.getContext('webgl2') ?? c?.getContext('webgl') ?? null) as WebGLRenderingContext | WebGL2RenderingContext | null;
    }
    if (gl) {
      const sh = gl.createShader(gl.FRAGMENT_SHADER);
      if (sh) {
        gl.shaderSource(sh, src);
        gl.compileShader(sh);
        ok = !!gl.getShaderParameter(sh, gl.COMPILE_STATUS);
        gl.deleteShader(sh);
      }
    }
  } catch { ok = null; }
  if (verdicts.size > 64) verdicts.clear();
  verdicts.set(src, ok);
  return ok;
}
