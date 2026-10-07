/**
 * complete.ts — type-ahead and parameter hints for the no-AI text fields (docs/suggestions.md,
 * "Type-ahead"): the Scene Builder's recipe, the Do… bar, the Agent Rules pickers and the Grid
 * Rules text fields.
 *
 *  - rankCompletions orders candidates for what has been typed: the name itself first (exact,
 *    then prefix), then an alias's prefix, then a word inside the name ("union" in smooth-union),
 *    then letters in order ("circ" → cylinder), then a near typo. Shorter names win ties.
 *  - recipeAssist reads the recipe round the caret: at the start of a clause it offers clause
 *    words (shapes, combines, warps, modes, settings, outputs), after `@` warps, inside a combine's
 *    brackets shapes, after a keyword its settings; and it gives the clause's signature
 *    (`sphere r=0.5 at=(x,y,z) …`) with the next setting to fill marked.
 *  - doBarAssist does the same for the Do… bar's last word, from the shared vocabulary.
 *
 * Pure: no React, no store.
 */
import { getNodeDefinition } from '../nodes/definitions';
import { SHAPES as SCENE_SHAPES, SHAPE_BY_KIND, WARPS, WARP_BY_KIND, TONE_MODES, type ParamDef } from '../sceneBuilder/spec';
import { RECIPE_WORDS } from '../sceneBuilder/recipe';
import { OUTPUTS, PALETTES } from '../sceneBuilder/output';
import { ACTIONS, SHAPES as WORD_SHAPES, editDistance, fuzzBudget } from './vocabulary';
import { moveById } from '../suggestions/moves';

export type CompletionKind = 'shape' | 'warp' | 'combine' | 'mode' | 'setting' | 'output' | 'palette' | 'colour' | 'param' | 'action' | 'condition' | 'value';

export interface Completion {
  /** The name shown (and inserted unless `insert` says otherwise). */
  label: string;
  insert: string;
  kind: CompletionKind;
  /** One line: what it is ("Circle SDF", "a ball"). */
  detail: string;
  /** Its parameters, as it would be written: `sphere r=0.5 at=(x,y,z)`. */
  signature?: string;
  /** Other words that find it. */
  words?: string[];
  /** Taking it replaces the whole field (a whole phrase), not just the word being typed. */
  replaceAll?: boolean;
}

// ── Ranking ─────────────────────────────────────────────────────────────────

/** How well `query` finds `name` (0: not at all). */
export function matchScore(query: string, name: string): number {
  const q = query.toLowerCase(), w = name.toLowerCase();
  if (!q) return 1;
  if (w === q) return 1000;
  if (w.startsWith(q)) return 900 - (w.length - q.length);
  const parts = w.split(/[\s\-_]+/);
  if (parts.some(p => p.startsWith(q))) return 700 - (w.length - q.length);
  if (w.includes(q)) return 500 - (w.length - q.length);
  // Letters in order: "circ" → c·yl·i·nde·r.
  let j = 0, gaps = 0, last = -1;
  for (let k = 0; k < w.length && j < q.length; k++) if (w[k] === q[j]) { if (last >= 0 && k > last + 1) gaps++; last = k; j++; }
  if (j === q.length && q.length >= 2 && w[0] === q[0]) return 300 - gaps * 10 - (w.length - q.length);
  const budget = fuzzBudget(q);
  if (budget && editDistance(q, w.slice(0, Math.max(q.length, Math.min(w.length, q.length + 1))), budget) <= budget) return 150;
  // Loosely alike: same first letter and most of the letters in order ("circ" ~ cylinder).
  if (q.length >= 3 && w[0] === q[0] && lcs(q, w) >= Math.ceil(q.length * 0.75)) return 100 - (w.length - q.length);
  return 0;
}

/** Longest common subsequence length. */
function lcs(a: string, b: string): number {
  let prev = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const cur = [0];
    for (let j = 1; j <= b.length; j++) cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    prev = cur;
  }
  return prev[b.length];
}

/** Candidates for `query`, best first (a candidate's own label beats its aliases). */
export function rankCompletions<T extends { label: string; words?: string[] }>(query: string, items: readonly T[], limit = 8): T[] {
  const scored = items.map((it, i) => {
    const own = matchScore(query, it.label);
    const alias = Math.max(0, ...(it.words ?? []).map(w => matchScore(query, w) - 100));
    return { it, i, s: Math.max(own, alias) };
  }).filter(x => x.s > 0);
  scored.sort((a, b) => b.s - a.s || a.it.label.length - b.it.label.length || a.i - b.i);
  const seen = new Set<string>();
  const out: T[] = [];
  for (const x of scored) { if (seen.has(x.it.label)) continue; seen.add(x.it.label); out.push(x.it); if (out.length >= limit) break; }
  return out;
}

// ── The recipe's words ──────────────────────────────────────────────────────

const v3 = (v: number | number[]) => (Array.isArray(v) ? `(${v.join(',')})` : String(v));
const paramText = (p: ParamDef) => `${p.key}=${v3(p.def as number)}`;
const SHAPE_COMMON = [
  { key: 'at', label: 'Position', hint: 'Where its centre is: (x, y, z).', text: 'at=(x,y,z)' },
  { key: 'rot', label: 'Rotation', hint: 'Degrees about X, then Y, then Z.', text: 'rot=(x,y,z)' },
  { key: 'color', label: 'Colour', hint: 'A name, #rrggbb or (r, g, b).', text: 'color=…' },
  { key: 'shine', label: 'Shine', hint: '0 matt … 1 glossy.', text: 'shine=0…1' },
  { key: 'glass', label: 'Glass', hint: 'In Glass mode: made of glass.', text: 'glass' },
  { key: 'name', label: 'Name', hint: 'A name for notes and the tree.', text: 'name=…' },
];

export interface SignatureParam { key: string; label: string; hint: string; text: string }
export interface Signature { head: string; detail: string; params: SignatureParam[]; /** The param the caret is on (or the next to fill); -1: none. */ active: number }

const OPS = ['union', 'smooth-union', 'subtract', 'smooth-subtract', 'intersect', 'smooth-intersect'];
const OP_DETAIL: Record<string, string> = {
  union: 'join: the nearer surface wins', 'smooth-union': 'melt together over k', subtract: 'cut the rest out of the first', 'smooth-subtract': 'a softened cut',
  intersect: 'only where all overlap', 'smooth-intersect': 'a rounded overlap',
};
const MODE_DETAIL: Record<string, string> = { surface: 'lit surfaces with shadows', volumetric: 'see-through glowing gas', glass: 'refracting glass', gi: 'one bounce of light' };

const SETTINGS: Record<string, { detail: string; params: SignatureParam[] }> = {
  sun: { detail: 'the sun\'s direction and colour', params: [{ key: 'dir', label: 'Direction', hint: 'Toward the sun.', text: 'dir=(x,y,z)' }, { key: 'color', label: 'Colour', hint: 'Its colour.', text: 'color=…' }] },
  sky: { detail: 'light from above', params: [{ key: '', label: 'Colour', hint: 'A colour.', text: '(r,g,b)' }] },
  bounce: { detail: 'light from below', params: [{ key: '', label: 'Colour', hint: 'A colour.', text: '(r,g,b)' }] },
  shadows: { detail: 'soft shadows: hardness or off', params: [{ key: '', label: 'Hardness', hint: '8 soft … 32 hard, or off.', text: '16 | off' }] },
  ao: { detail: 'ambient occlusion: step or off', params: [{ key: '', label: 'Step', hint: '0.06, or off.', text: '0.06 | off' }] },
  fog: { detail: 'distance fades into fog', params: [{ key: '', label: 'Density', hint: '0 clear.', text: '0.3' }, { key: 'color', label: 'Colour', hint: 'Fog colour.', text: 'color=…' }] },
  background: { detail: 'the background colour or gradient', params: [{ key: 'top', label: 'Top', hint: 'A colour.', text: 'top=…' }, { key: 'bottom', label: 'Bottom', hint: 'A colour.', text: 'bottom=…' }] },
  tone: { detail: 'tone map', params: [{ key: '', label: 'Mode', hint: TONE_MODES.join(', '), text: TONE_MODES.join('|') }] },
  camera: { detail: 'the orbit camera', params: ['dist', 'angle', 'elev', 'orbit', 'zoom', 'flatten', 'x', 'y', 'z'].map(k => ({ key: k, label: k, hint: k === 'dist' ? 'How far away.' : k === 'orbit' ? 'Degrees a second round the point.' : k === 'flatten' ? '0 perspective … 1 isometric.' : 'A number.', text: `${k}=…` })) },
  quality: { detail: 'the march\'s steps and limits', params: ['steps', 'dist', 'step', 'jitter'].map(k => ({ key: k, label: k, hint: k === 'step' ? 'Step scale, or auto.' : 'A number.', text: `${k}=…` })) },
  output: { detail: 'what the scene shows: depth, normal, hit…', params: [{ key: '', label: 'Show', hint: OUTPUTS.map(o => o.words[0]).join(', '), text: OUTPUTS.map(o => o.words[0]).join('|') }, { key: 'palette', label: 'Palette', hint: PALETTES.map(p => p.key).join(', '), text: 'palette …' }] },
  colour: { detail: 'colour the space through a palette', params: [{ key: 'by', label: 'By', hint: 'by depth, height, normal, distance, position…', text: 'by depth' }, { key: 'palette', label: 'Palette', hint: PALETTES.map(p => p.key).join(', '), text: 'palette=sunset' }] },
};

/** Every word a recipe clause can start with. */
export function recipeClauseWords(): Completion[] {
  const out: Completion[] = [];
  for (const s of SCENE_SHAPES) out.push({ label: s.kind, insert: s.kind, kind: 'shape', detail: `${s.label}: ${s.blurb}`, signature: `${s.kind} ${s.params.map(paramText).join(' ')} at=(x,y,z)`, words: s.aliases });
  for (const op of OPS) out.push({ label: op, insert: `${op}(`, kind: 'combine', detail: OP_DETAIL[op], signature: `${op}(shape, shape…)${op.startsWith('smooth') ? ' k=0.3' : ''}` });
  for (const w of WARPS) {
    // D8: the noise warp is written `warp`.
    const word = w.kind === 'noise' ? 'warp' : w.kind;
    out.push({ label: word, insert: word, kind: 'warp', detail: `${w.label}: ${w.blurb}`, signature: `${word} ${[...(w.axes ? [w.axes.def] : []), ...w.params.map(paramText)].join(' ')}`, words: [...w.aliases.filter(a => a !== word), ...(word !== w.kind ? [w.kind] : [])] });
  }
  for (const m of Object.keys(MODE_DETAIL)) out.push({ label: m, insert: m, kind: 'mode', detail: `render mode: ${MODE_DETAIL[m]}` });
  for (const [k, s] of Object.entries(SETTINGS)) out.push({ label: k === 'colour' ? 'colour by' : k, insert: k === 'colour' ? 'colour by ' : k, kind: k === 'output' || k === 'colour' ? 'output' : 'setting', detail: s.detail, signature: `${k} ${s.params.map(p => p.text).join(' ')}` });
  return out;
}

/** The settings a clause head takes, as signature params. */
export function signatureFor(head: string): Signature | null {
  const w = head.toLowerCase();
  const shapeKind = RECIPE_WORDS.shapes[w];
  if (shapeKind) {
    const s = SHAPE_BY_KIND[shapeKind];
    return { head: s.kind, detail: `${s.label}: ${s.blurb}`, params: [...s.params.map(p => ({ key: p.key, label: p.label, hint: p.hint ?? `${p.label}, ${p.min} to ${p.max}${p.deg ? '°' : ''}.`, text: paramText(p) })), ...SHAPE_COMMON], active: -1 };
  }
  const warpKind = RECIPE_WORDS.warps[w];
  if (warpKind) {
    const d = WARP_BY_KIND[warpKind];
    const ps: SignatureParam[] = [];
    if (d.axes) ps.push({ key: d.axes.key, label: d.axes.label, hint: d.axes.kind === 'flags' ? 'Letters from xyz, like xz.' : `One of ${d.axes.options.join(', ')}.`, text: `${d.axes.key}=${d.axes.def}` });
    ps.push(...d.params.map(p => ({ key: p.key, label: p.label, hint: p.hint ?? `${p.label}, ${p.min} to ${p.max}.`, text: paramText(p) })));
    if (d.select) ps.push({ key: d.select.key, label: d.select.label, hint: `One of ${d.select.options.join(', ')}.`, text: `${d.select.key}=${d.select.def}` });
    return { head: d.kind === 'noise' ? 'warp' : d.kind, detail: `${d.label}: ${d.blurb}`, params: ps, active: -1 };
  }
  if (RECIPE_WORDS.ops[w]) return { head: w, detail: OP_DETAIL[w] ?? 'a combine group', params: [{ key: '(', label: 'Items', hint: 'Shapes and combines, separated by commas.', text: '(shape, shape…)' }, { key: 'k', label: 'Blend radius', hint: 'How wide the smooth join is.', text: 'k=0.3' }, { key: 'name', label: 'Name', hint: 'A name for the group.', text: 'name=…' }], active: -1 };
  const setting = SETTINGS[w === 'color' ? 'colour' : w === 'show' ? 'output' : w === 'shadow' ? 'shadows' : w === 'bg' ? 'background' : w === 'cam' ? 'camera' : w];
  if (setting) return { head: w, detail: setting.detail, params: setting.params, active: -1 };
  return null;
}

export interface Assist {
  items: Completion[];
  /** The span the chosen item replaces. */
  from: number;
  to: number;
  signature: Signature | null;
}

/** Type-ahead and signature help for the recipe at `caret`. */
export function recipeAssist(text: string, caret: number): Assist {
  const before = text.slice(0, caret);
  const wordM = /[A-Za-z_][A-Za-z0-9_-]*$/.exec(before);
  const word = wordM ? wordM[0] : '';
  const from = caret - word.length;
  let to = caret;
  while (to < text.length && /[A-Za-z0-9_-]/.test(text[to])) to++;
  const clauseStart = Math.max(...['\n', '·', '•', '|', ';'].map(s => before.lastIndexOf(s))) + 1;
  const clause = before.slice(clauseStart, from);
  const head = /^\s*([A-Za-z_][A-Za-z0-9_-]*)/.exec(clause)?.[1] ?? null;
  // Where are we? After @, inside a combine's brackets, or after `key=`.
  const tail = clause.replace(/\s+$/, '');
  const afterAt = /@\s*$/.test(clause);
  const depth = [...clause].reduce((d, ch) => d + (ch === '(' ? 1 : ch === ')' ? -1 : 0), 0);
  const itemSlot = depth > 0 && /[(,]\s*$/.test(clause) && !!head && !!RECIPE_WORDS.ops[head.toLowerCase()];
  const keyM = /([A-Za-z_]+)=\s*$/.exec(clause);
  // Inside a combine's brackets, the item being written is the head.
  const innerHead = depth > 0 ? /[(,@]\s*([A-Za-z_][A-Za-z0-9_-]*)[^(),@]*$/.exec(clause)?.[1] ?? null : null;
  let items: Completion[] = [];
  let sigHead = innerHead ?? head;
  if (!head || (tail === '' && !afterAt)) {
    items = rankCompletions(word, recipeClauseWords(), 10);
    sigHead = word && items[0] && matchScore(word, items[0].label) >= 1000 ? items[0].label : null;
  } else if (afterAt) {
    items = rankCompletions(word, recipeClauseWords().filter(c => c.kind === 'warp'), 8).map(c => ({ ...c, insert: `${c.label}(` }));
  } else if (itemSlot) {
    items = rankCompletions(word, recipeClauseWords().filter(c => c.kind === 'shape' || c.kind === 'combine'), 8);
    // The item being written inside the brackets, for the signature.
    sigHead = word || head;
  } else if (keyM) {
    const key = keyM[1].toLowerCase();
    // Any setting can be drawn at random (lang/random.ts).
    const randomItems = word && 'random'.startsWith(word.toLowerCase()) && word.toLowerCase() !== 'random'
      ? [{ label: 'random', insert: 'random', kind: 'value' as const, detail: 'a value from its interesting range (random(0.2..2), random(red, teal) for your own)' }] : [];
    if (key === 'color' || key === 'colour' || key === 'tint' || key === 'top' || key === 'bottom') {
      items = rankCompletions(word, Object.entries(RECIPE_WORDS.colours).map(([nm, c]) => ({ label: nm, insert: nm, kind: 'colour' as const, detail: `(${c.join(', ')})` })), 8);
    } else if (key === 'palette' || key === 'ramp') {
      items = rankCompletions(word, PALETTES.map(p => ({ label: p.key, insert: p.key, kind: 'palette' as const, detail: `${p.label} (${p.kind === 'palette' ? 'Palette' : 'Color Ramp'})` })), 8);
    }
    items = [...items, ...randomItems];
  } else {
    const h = (innerHead ?? head).toLowerCase();
    const lastWord = /([A-Za-z_]+)\s*$/.exec(tail)?.[1]?.toLowerCase();
    if (h === 'output' || h === 'show' || ((h === 'colour' || h === 'color') && lastWord === 'by')) {
      items = rankCompletions(word, OUTPUTS.map(o => ({ label: o.words[0], insert: o.words[0], kind: 'output' as const, detail: o.blurb, words: o.words.slice(1) })), 10);
    } else if ((h === 'colour' || h === 'color') && !/\bby\b/.test(tail)) {
      items = [{ label: 'by', insert: 'by', kind: 'param', detail: 'colour by depth, height, normal…' }];
    } else if (lastWord === 'palette' || lastWord === 'ramp') {
      items = rankCompletions(word, PALETTES.map(p => ({ label: p.key, insert: p.key, kind: 'palette' as const, detail: `${p.label} (${p.kind === 'palette' ? 'Palette' : 'Color Ramp'})` })), 12);
    } else if (h === 'tone') {
      items = rankCompletions(word, TONE_MODES.map(m => ({ label: m, insert: m, kind: 'value' as const, detail: 'tone map mode' })), 8);
    } else {
      const sig = signatureFor(h);
      if (sig) {
        const given = new Set([...clause.matchAll(/([A-Za-z_]+)=/g)].map(m => m[1].toLowerCase()));
        items = rankCompletions(word, sig.params.filter(p => p.key && p.key !== '(' && !given.has(p.key.toLowerCase())).map(p => ({ label: p.key, insert: p.key === 'glass' ? 'glass' : `${p.key}=`, kind: 'param' as const, detail: `${p.label}: ${p.hint}`, signature: p.text })), 10);
        if ((h === 'output' || h === 'show' || h === 'colour' || h === 'color') && !items.length) items = [];
      }
    }
  }
  // Signature help: the head's settings, the one being typed (or the next to fill) marked.
  let signature: Signature | null = sigHead ? signatureFor(sigHead) : null;
  if (signature) {
    const given = new Set([...clause.matchAll(/([A-Za-z_]+)=/g)].map(m => m[1].toLowerCase()));
    const typing = keyM ? keyM[1].toLowerCase() : word.toLowerCase();
    let active = signature.params.findIndex(p => p.key && p.key.toLowerCase() === typing);
    if (active < 0) active = signature.params.findIndex(p => p.key && p.key !== '(' && !given.has(p.key.toLowerCase()));
    signature = { ...signature, active };
  }
  // Nothing to say when the word is already complete and the only match.
  if (items.length === 1 && items[0].label === word) items = [];
  return { items, from, to, signature };
}

// ── The Do… bar ─────────────────────────────────────────────────────────────

const DO_OUTPUT_PHRASES: Completion[] = [
  { label: 'output the depth', insert: 'output the depth', kind: 'output', detail: 'a 3D scene shows its depth (grey)', words: ['depth', 'show the depth'] },
  { label: 'show the normals', insert: 'show the normals', kind: 'output', detail: 'a 3D scene shows which way surfaces face', words: ['normals', 'show normals'] },
  { label: 'colour it by distance with a palette', insert: 'colour it by distance with a palette', kind: 'output', detail: 'a 3D scene through a palette', words: ['colour by', 'color by', 'colour it by'] },
  { label: 'show the picture', insert: 'show the picture', kind: 'output', detail: 'a 3D scene back to its lit picture', words: ['picture'] },
];

/** All the Do… bar's head words: 2D/3D shapes (with the node they make) and actions (with their settings). */
export function doBarWords(): Completion[] {
  const out: Completion[] = [];
  for (const s of WORD_SHAPES) {
    const d2 = s.node2d ? getNodeDefinition(s.node2d.type)?.label : undefined;
    const d3 = s.node3d ? getNodeDefinition(s.node3d.type)?.label : undefined;
    const name = s.words[0];
    out.push({
      label: name, insert: name, kind: 'shape', words: s.words.slice(1),
      detail: d2 ? `→ ${d2}${s.node2d?.params?.shape ? ` (${s.node2d.params.shape})` : ''}` : `3D: ${d3 ?? s.id} (Scene Builder)`,
      signature: d2 ? `${name}${s.node2d?.size ? ` ${s.node2d.size}=…` : ''} in the middle | top left…` : `${s.sceneKind ?? s.id} in the 3D Scene Builder`,
    });
  }
  for (const a of ACTIONS) {
    const move = moveById(a.id);
    out.push({
      label: a.words[0], insert: a.words[0], kind: 'action', words: a.words.slice(1),
      detail: move ? `${move.label}${move.why ? `: ${move.why}` : ''}` : a.id,
      signature: `${a.words[0]}${(move?.args ?? []).map(x => ` ${x.kind === 'colour' ? 'colour' : `${x.label.toLowerCase()} ${x.default}`}`).join('')}`,
    });
  }
  return out;
}

/** Type-ahead for the Do… bar's last word, and the settings of the action it names. */
export function doBarAssist(text: string, caret = text.length): Assist {
  const before = text.slice(0, caret);
  const m = /[A-Za-z][A-Za-z-]*$/.exec(before);
  const word = m ? m[0] : '';
  const from = caret - word.length;
  const all = doBarWords();
  const typed = before.trim().toLowerCase();
  // Whole phrases ("output the depth") while what is typed is the start of one.
  const phrases = typed.length >= 3 ? DO_OUTPUT_PHRASES.filter(p => p.label.startsWith(typed) && p.label !== typed).map(p => ({ ...p, replaceAll: true })) : [];
  const items = [...phrases, ...(word.length >= 3 ? rankCompletions(word, all, 8).filter(c => c.label !== word) : [])].slice(0, 8);
  // Signature: the last action named before the caret.
  const words = before.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  let signature: Signature | null = null;
  for (let i = words.length - 1; i >= 0 && !signature; i--) {
    const a = ACTIONS.find(x => x.words.includes(words[i]));
    const move = a ? moveById(a.id) : undefined;
    if (a && move) signature = { head: a.words[0], detail: move.label, params: (move.args ?? []).map(x => ({ key: x.name, label: x.label, hint: x.kind === 'colour' ? 'A colour word or #hex.' : `Default ${x.default}.`, text: `${x.label.toLowerCase()} ${Array.isArray(x.default) ? 'colour' : x.default}` })), active: 0 };
  }
  return { items, from, to: caret, signature };
}

/**
 * Type-ahead for a field over a fixed set of words (the Grid Rules custom update's names and
 * functions): the word at the caret is completed. `whole` replaces the whole field instead (the
 * B/S rule text, completed from the presets).
 */
export function wordAssist(text: string, caret: number, words: readonly Completion[], whole = false): Assist {
  if (whole) {
    const q = text.trim();
    const items = q && !words.some(w => w.insert.toLowerCase() === q.toLowerCase()) ? rankCompletions(q, words, 8) : [];
    return { items, from: 0, to: text.length, signature: null };
  }
  const m = /[A-Za-z_][A-Za-z0-9_]*$/.exec(text.slice(0, caret));
  const word = m ? m[0] : '';
  let to = caret;
  while (to < text.length && /[A-Za-z0-9_]/.test(text[to])) to++;
  const items = word ? rankCompletions(word, words, 8).filter(c => c.label !== word) : [];
  return { items, from: caret - word.length, to, signature: null };
}

/** Type-ahead over a fixed list (the Agent Rules pickers): label, words and hint. */
export function pickerAssist<T extends { label: string; words?: string[] }>(query: string, items: readonly T[], limit = 12): T[] {
  return query.trim() ? rankCompletions(query.trim(), items, limit) : items.slice(0, limit);
}
