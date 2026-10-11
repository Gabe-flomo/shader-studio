/**
 * scene2d.ts — the 2D Scene Builder's recipe as a Do… bar dialect (sceneBuilder2d/recipe.ts is the
 * language; this is how the bar tells it apart and reads it).
 *
 * A 2D recipe shares most of its words with the 2D picture (circle, glow, polar-repeat…) and a few
 * with the 3D scene (tone, background, `@` modifiers), so the bar picks it by what only it has:
 *  - words no other dialect has: `combine-blocks`, `space-block`, `fn-shape`, `picture-mode=`,
 *    `mask-cut=`, `mask-invert`, and the 2D motions and ring as `@` modifiers (`@orbit(…)`,
 *    `@pulse(…)`, `@bob(…)`, `@spin(…)`, `@ring(…)`: no 3D warp has those names);
 *  - or by reading: a line another dialect can't read that reads cleanly as a 2D recipe.
 * A line that reads cleanly as a 3D scene recipe stays a 3D scene, and a plain picture line stays
 * a picture, so nothing the bar read before changes.
 */
import type { Diagnostic } from '../ast';
import { lineCol } from '../lex';
import { WARPS } from '../../sceneBuilder/spec';
import { parseRecipe2D, printRecipe2D } from '../../sceneBuilder2d/recipe';
import type { Scene2D } from '../../sceneBuilder2d/spec';

/** Clause heads only the 2D Scene Builder's recipe has. */
const HEADS_2D = new Set(['combine-blocks', 'space-block', 'fn-shape']);

/** The 2D motions and ring that no 3D warp shares a name with. */
const MODS_2D = ['orbit', 'bob', 'spin', 'pulse', 'ring', 'array', 'radial']
  .filter(w => !WARPS.some(d => d.kind === w || d.aliases.includes(w)));
const MOD_RE = new RegExp(`@\\s*(${MODS_2D.join('|')})\\s*\\(`, 'i');
const KEY_RE = /(^|[\s(])(picture-mode|pic-mode|mask-cut)\s*=|(^|[\s(])mask-invert\b/i;

/** Does the text use a word only a 2D Scene Builder recipe has? Returns the word, or null. */
export function scene2dMarker(text: string, heads: readonly string[]): string | null {
  const h = heads.find(x => HEADS_2D.has(x));
  if (h) return h;
  const m = MOD_RE.exec(text);
  if (m) return `@${m[1].toLowerCase()}`;
  const k = KEY_RE.exec(text);
  if (k) return (k[2] ?? 'mask-invert').toLowerCase();
  return null;
}

/** Does the text read as a 2D recipe with no mistakes? */
export const reads2dCleanly = (text: string) => parseRecipe2D(text).errors.length === 0;

export interface Scene2DRead {
  scene: Scene2D;
  canonical: string | null;
  errors: Diagnostic[];
  hints: Diagnostic[];
}

/** Read a 2D recipe for the bar: its mistakes say what kind of recipe it is. */
export function readScene2D(text: string): Scene2DRead {
  const r = parseRecipe2D(text);
  const errors: Diagnostic[] = r.errors.map((e, i) => ({
    message: i === 0 ? `This is a 2D Scene Builder recipe, but ${lowerFirst(e.message)}` : e.message,
    at: e.from, end: e.to, line: e.line, col: e.col, severity: 'error',
  }));
  const at0 = lineCol(text, 0);
  const hints: Diagnostic[] = r.warnings.map(w => ({ message: w, at: 0, end: 0, line: at0.line, col: at0.col, severity: 'hint' }));
  return { scene: r.scene, canonical: errors.length ? null : printRecipe2D(r.scene), errors, hints };
}

const lowerFirst = (s: string) => (/^[A-Z][a-z]/.test(s) && !/^(I|I'm|I've)\b/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);
