/**
 * cache.ts — answers are kept by (code hash + context hash): the same line in the same surroundings is
 * never asked twice. Memory only (a session), small, least-recently-used first out.
 */

/** FNV-1a, 32 bit, as hex. */
export function hashText(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** The cache key: the code, the context it was asked in, and which kind of answer. */
export const answerKey = (kind: string, code: string, context: string): string => `${kind}:${hashText(code)}:${hashText(context)}`;

export class AnswerCache {
  private m = new Map<string, string>();
  private cap: number;
  constructor(cap = 200) { this.cap = cap; }
  get(k: string): string | undefined {
    const v = this.m.get(k);
    if (v !== undefined) { this.m.delete(k); this.m.set(k, v); }
    return v;
  }
  set(k: string, v: string): void {
    this.m.delete(k); this.m.set(k, v);
    if (this.m.size > this.cap) this.m.delete(this.m.keys().next().value as string);
  }
  has(k: string): boolean { return this.m.has(k); }
  get size(): number { return this.m.size; }
  clear(): void { this.m.clear(); }
}
