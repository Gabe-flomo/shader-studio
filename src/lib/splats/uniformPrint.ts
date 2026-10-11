/**
 * uniformPrint.ts — a fingerprint of the uniforms a program reads, so the splat engine can tell when its readbacks
 * can't have changed (engine.ts): the probe's camera numbers, and the moved splats' depths. A still camera over a
 * still scan then reads nothing back and sorts nothing, while a slider that doesn't move it is dragged.
 *
 * Only values are printed. A texture's content can change without the texture changing (a video, a pass, the last
 * frame), so a program that reads one has no fingerprint (null: read every frame, as before), except the textures
 * the caller names as fixed.
 */
const usedCache = new Map<string, string[]>();
const DECL = /\buniform\s+(?:(?:lowp|mediump|highp)\s+)?\w+\s+([^;]+);/g;

/** The uniforms `src` declares and uses (named again after the declaration). Cached per shader text. */
export function usedUniforms(src: string): string[] {
  const hit = usedCache.get(src);
  if (hit) return hit;
  const names = new Set<string>();
  for (const m of src.matchAll(DECL)) {
    for (const part of m[1].split(',')) {
      const name = /^\s*(\w+)/.exec(part)?.[1];
      if (name) names.add(name);
    }
  }
  // Declared only (the shared header declares the whole table): not read, so not printed.
  const words = new Set(src.replace(DECL, ' ').match(/\b[A-Za-z_]\w*\b/g) ?? []);
  const used = [...names].filter(n => words.has(n));
  if (usedCache.size > 32) usedCache.clear();
  usedCache.set(src, used);
  return used;
}

const ids = new WeakMap<object, number>();
let nextId = 1;
const idOf = (o: object) => { let i = ids.get(o); if (!i) { i = nextId++; ids.set(o, i); } return i; };

interface Shaped { isTexture?: boolean; elements?: ArrayLike<number>; x?: number; y?: number; z?: number; w?: number; r?: number; g?: number; b?: number }

/** One value's print, or null for a texture (its content can change unseen). */
function printValue(v: unknown, fixed: ReadonlySet<unknown>): string | null {
  if (v === null || v === undefined) return '_';
  const t = typeof v;
  if (t === 'number' || t === 'boolean' || t === 'string') return String(v);
  if (t !== 'object') return '?';
  if (fixed.has(v)) return `f${idOf(v as object)}`;
  const o = v as Shaped;
  if (o.isTexture) return null;
  if (Array.isArray(v)) {
    const parts: string[] = [];
    for (const x of v) { const p = printValue(x, fixed); if (p === null) return null; parts.push(p); }
    return `[${parts.join(',')}]`;
  }
  if (ArrayBuffer.isView(v)) return `a${Array.prototype.join.call(v as unknown as ArrayLike<number>, ',')}`;
  if (o.elements) return `m${Array.prototype.join.call(o.elements, ',')}`;
  if (typeof o.x === 'number') return `v${o.x},${o.y},${o.z ?? ''},${o.w ?? ''}`;
  if (typeof o.r === 'number') return `c${o.r},${o.g},${o.b}`;
  // Anything else (an object we can't read into): by identity.
  return `o${idOf(v as object)}`;
}

/**
 * The print of `names` in `uniforms`, or null when one of them is a texture not in `fixed` (no print: always read).
 */
export function uniformsPrint(names: readonly string[], uniforms: Record<string, { value: unknown } | undefined>, fixed: ReadonlySet<unknown> = new Set()): string | null {
  let out = '';
  for (const n of names) {
    const p = printValue(uniforms[n]?.value, fixed);
    if (p === null) return null;
    out += `${n}=${p};`;
  }
  return out;
}
