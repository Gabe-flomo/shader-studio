/**
 * Hand a shader to the Convert page from elsewhere (the GLSL page's Convert
 * button). The page takes it when it mounts, or right away when it is open.
 * `guided` opens it in Guided mode (docs/guided-convert.md) instead of the
 * automatic one.
 */
let pending: string | null = null;
let pendingGuided = false;
const listeners = new Set<(code: string, guided: boolean) => void>();

export function requestConvert(code: string, opts: { guided?: boolean } = {}): void {
  pending = code;
  pendingGuided = !!opts.guided;
  for (const l of listeners) l(code, pendingGuided);
}
export function takeHandoff(): string | null { const c = pending; pending = null; pendingGuided = false; return c; }
/** Is the shader waiting to be taken meant for Guided mode? */
export function handoffIsGuided(): boolean { return pending !== null && pendingGuided; }
export function onHandoff(l: (code: string, guided: boolean) => void): () => void { listeners.add(l); return () => { listeners.delete(l); }; }
