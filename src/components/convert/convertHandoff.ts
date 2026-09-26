/**
 * Hand a shader to the Convert page from elsewhere (the GLSL page's Convert
 * button). The page takes it when it mounts, or right away when it is open.
 */
let pending: string | null = null;
const listeners = new Set<(code: string) => void>();

export function requestConvert(code: string): void {
  pending = code;
  for (const l of listeners) l(code);
}
export function takeHandoff(): string | null { const c = pending; pending = null; return c; }
export function onHandoff(l: (code: string) => void): () => void { listeners.add(l); return () => { listeners.delete(l); }; }
