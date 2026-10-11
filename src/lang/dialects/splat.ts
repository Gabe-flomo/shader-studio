/**
 * splat.ts — the Splat builder's recipe (splatBuilder/recipe.ts, "Under the hood") as a Do… bar
 * dialect: a recipe copied from one project pastes into the bar of another and builds there.
 *
 * The recipe is one part a line (`scan …`, `place …`, effects, `world …`, `background …`,
 * `camera …`, `look …`); the bar's one-line form joins them with ` · `. It always starts with
 * `scan`, the word that tells it apart.
 *
 * What a recipe names from its own project degrades instead of failing:
 *  - `scan file=… id=…` of a scan this device's splat library doesn't have (`withScanIn`): built
 *    with the example scan, and a note says to load the file in the Scan section;
 *  - `yours tail=…` (nodes you added on the card): left out, with a note;
 *  - `background picture picture=name`: the picture gets an empty Texture node named after it.
 */
import type { Diagnostic } from '../ast';
import { lineCol } from '../lex';
import { readSplatRecipe, splatRecipe } from '../../splatBuilder/recipe';
import { DEMO_SOURCE, starterSplatScene, type SplatBuilderSpec } from '../../splatBuilder/spec';

/** Is this a Splat builder recipe? Its first part is `scan` (with an example or a file), or it has scan and place. */
export function isSplatRecipe(heads: readonly string[], text: string): boolean {
  if (heads[0] === 'scan' && /\b(example|file|max|sh|sort|res)\s*=/.test(text)) return true;
  return heads.includes('scan') && heads.includes('place');
}

/** The recipe's parts with where each starts: split at new lines and ` · ` (not inside quotes or brackets). */
function parts(text: string): Array<{ text: string; at: number }> {
  const out: Array<{ text: string; at: number }> = [];
  let cur = '', start = 0, depth = 0, quote = false;
  const push = (end: number) => { if (cur.trim()) out.push({ text: cur, at: start }); cur = ''; start = end; };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') quote = !quote;
    if (!quote && ch === '(') depth++;
    if (!quote && ch === ')') depth = Math.max(0, depth - 1);
    if (!quote && (ch === '\n' || ((ch === '·' || ch === '•') && depth === 0))) { push(i + 1); continue; }
    cur += ch;
  }
  push(text.length);
  return out;
}

export interface SplatRead {
  spec: SplatBuilderSpec;
  canonical: string | null;
  errors: Diagnostic[];
  /** What was filled in because the recipe named something from another project. */
  notes: string[];
}

export function readSplat(text: string): SplatRead {
  const ps = parts(text);
  const r = readSplatRecipe(ps.map(p => p.text.trim()).join('\n'), starterSplatScene());
  const errors: Diagnostic[] = [];
  const notes: string[] = [];
  for (const e of r.errors) {
    const m = /^Line (\d+): (.*)$/.exec(e);
    const p = m ? ps[Number(m[1]) - 1] : undefined;
    const msg = m ? m[2] : e;
    if (/isn't loaded here/.test(msg)) { notes.push(`${msg.replace(/: load it in the Scan section\.$/, '')}: built with the example scan. Load the file in the Splat builder's Scan section.`); continue; }
    if (/no nodes of yours/.test(msg)) { notes.push(`${msg.replace(/ \(add them on the Splat Scene card\)\.$/, '')}: left out (they were nodes added by hand in the other project).`); continue; }
    const at = p ? p.at + (p.text.length - p.text.trimStart().length) : 0;
    const end = p ? p.at + p.text.trimEnd().length : text.length;
    const lc = lineCol(text, at);
    errors.push({ message: errors.length ? msg : `This is a Splat builder recipe, but ${msg}`, at, end, line: lc.line, col: lc.col, severity: 'error' });
  }
  const spec = r.spec;
  // A background picture the recipe named (readSplatRecipe gave it a source): an empty Texture node on build.
  const pic = spec.background.kind === 'picture' ? spec.background.picture : null;
  if (pic) notes.push(`The background picture “${pic}” is read from a Texture node named after it: an empty one is made when the project has none.`);
  return { spec, canonical: errors.length ? null : splatRecipe(spec).split('\n').join(' · '), errors, notes };
}

/**
 * The spec with its scan file only when `library` (the ids in this device's splat library) has it;
 * otherwise the example scan, and a note saying which file to load.
 */
export function withScanIn(spec: SplatBuilderSpec, library: ReadonlySet<string>): { spec: SplatBuilderSpec; note: string | null } {
  const src = spec.scan.source;
  if (src.kind !== 'file' || library.has(src.videoId)) return { spec, note: null };
  return {
    spec: { ...spec, scan: { ...spec.scan, source: { ...DEMO_SOURCE } } },
    note: `The scan “${src.fileName}” isn't in this project's splat library: built with the example scan. Load the file in the Splat builder's Scan section.`,
  };
}
