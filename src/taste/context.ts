/**
 * context.ts — the steering context box, read locally (docs/taste.md "Steering"). Free text such as "I like
 * dark minimal pieces with lots of motion, no fBm, more code" becomes chips: a phrase, the taste features
 * it means, and a sign. No AI: the Playfield language's word matching (src/lang/vocabulary.ts: tokens,
 * longest phrase first, a small edit distance for longer words), over
 *
 *   - a small synonym table (dark / bright, minimal / busy, moving / still, vivid / muted, code-heavy…);
 *   - the patterns catalogue (src/patterns/catalogue.ts): every technique and family by name;
 *   - the Do bar's action words (glow, warp, repeat, trails…) as the families they make;
 *   - settings words with high / low ("high falloff", "slow speed");
 *   - shape words (circle, box, ring…) as their node types.
 *
 * "no", "not", "less", "without", "avoid"… flip the next phrase. Pure.
 *
 * By look: while the image model is on (`byLook`), words the vocabulary doesn't know ("underwater",
 * "stained glass") and look words ("neon", "dark") become chips the image model scores, by image–text
 * similarity (look.ts). Runs of such words make one phrase ("neon city"). Only what neither can use (short
 * tokens, numbers) is listed as not understood.
 */
import { ACTIONS, FILLER, matchAt, PARAMS, SHAPES, tokenize } from '../lang/vocabulary';
import { FAMILIES, TECHNIQUES, type FamilyId } from '../patterns/catalogue';
import { COMMON_SETTINGS, nodeBucket } from './features';
import type { Chip, Steering } from './steering';

interface Entry { id: string; words: string[]; label: string; features: string[]; sign?: 1 | -1; /** A word you can see in a picture: by look, it joins a look phrase. */ visual?: boolean }

/** The synonym table: plain words for the look features. */
export const SYNONYMS: Entry[] = [
  { id: 'syn:dark', words: ['dark', 'darker', 'moody', 'night', 'shadowy', 'black', 'gloomy', 'dim'], label: 'dark pictures and palettes', features: ['look:dark', 'pal:dark'], visual: true },
  { id: 'syn:bright', words: ['bright', 'brighter', 'light', 'luminous', 'airy', 'white', 'sunny'], label: 'bright pictures and palettes', features: ['look:bright', 'pal:light'], visual: true },
  { id: 'syn:minimal', words: ['minimal', 'minimalist', 'simple', 'clean', 'sparse', 'plain', 'bare'], label: 'simple shapes (less detail)', features: ['img:detail'], sign: -1, visual: true },
  { id: 'syn:busy', words: ['busy', 'detailed', 'intricate', 'complex', 'dense', 'rich', 'detail', 'details', 'maximal'], label: 'fine detail', features: ['img:detail'], visual: true },
  { id: 'syn:moving', words: ['motion', 'moving', 'movement', 'animated', 'animation', 'dynamic', 'lively', 'flowing', 'kinetic'], label: 'lots of motion', features: ['img:motion'] },
  { id: 'syn:still', words: ['still', 'static', 'calm', 'slow', 'frozen', 'stillness', 'quiet'], label: 'stillness (less motion)', features: ['img:motion'], sign: -1 },
  { id: 'syn:vivid', words: ['vivid', 'saturated', 'colourful', 'colorful', 'vibrant', 'neon', 'bold colours', 'bold colors'], label: 'vivid colour', features: ['pal:vivid', 'img:colourful'], visual: true },
  { id: 'syn:muted', words: ['muted', 'pastel', 'pastels', 'desaturated', 'subtle', 'washed out', 'monochrome', 'grey', 'gray'], label: 'muted colour', features: ['pal:muted'], visual: true },
  { id: 'syn:contrast', words: ['contrast', 'high contrast', 'contrasty', 'punchy', 'crisp', 'sharp'], label: 'high contrast', features: ['img:contrast'], visual: true },
  { id: 'syn:soft', words: ['low contrast', 'gentle', 'hazy', 'dreamy', 'misty'], label: 'low contrast', features: ['img:contrast'], sign: -1, visual: true },
  { id: 'syn:symmetric', words: ['symmetric', 'symmetrical', 'symmetry', 'balanced', 'geometric', 'ordered'], label: 'symmetry', features: ['img:structure'], visual: true },
  { id: 'syn:asymmetric', words: ['asymmetric', 'asymmetrical', 'chaotic', 'messy', 'irregular'], label: 'asymmetry', features: ['img:structure'], sign: -1, visual: true },
  { id: 'syn:novel', words: ['new', 'novel', 'experimental', 'unusual', 'weird', 'strange', 'surprising', 'different'], label: 'new looks', features: ['img:novelty'] },
  { id: 'syn:familiar', words: ['familiar', 'classic', 'traditional', 'safe'], label: 'familiar looks', features: ['img:novelty'], sign: -1 },
  { id: 'syn:code', words: ['code', 'coding', 'code heavy', 'code-heavy', 'glsl', 'expressions', 'expression blocks', 'shader code', 'custom code', 'custom functions'], label: 'code blocks', features: ['code:yes'] },
  { id: 'syn:nodes', words: ['node based', 'node-based', 'no-code', 'nocode', 'plain nodes', 'visual nodes'], label: 'plain nodes (no code)', features: ['code:no'] },
  { id: 'syn:3d', words: ['3d', 'three dimensional', 'raymarched', 'raymarching', 'ray marched', 'volumetric', 'depth'], label: 'ray-marched 3D', features: ['fam:march3d'], visual: true },
  { id: 'syn:particles', words: ['particles', 'particle', 'agents', 'swarm', 'flocking', 'slime'], label: 'agents & particles', features: ['fam:agents'], visual: true },
  { id: 'syn:noise', words: ['noise', 'noisy', 'texture', 'textured', 'grainy noise'], label: 'noise & texture', features: ['fam:noise'], visual: true },
  { id: 'syn:organic', words: ['organic', 'fluid', 'liquid', 'wobbly', 'warped'], label: 'space distortion', features: ['fam:spaceDistort'], visual: true },
  { id: 'syn:glow', words: ['glow', 'glowing', 'glowy', 'luminous glow', 'halo', 'light falloff'], label: 'glowing light falloff', features: ['fam:lightFalloff'], visual: true },
  { id: 'syn:tiles', words: ['tiles', 'tiled', 'tiling', 'repeating', 'repetition', 'pattern', 'patterns', 'grid', 'grids'], label: 'repetition & tiling', features: ['fam:repetition'], visual: true },
  { id: 'syn:waves', words: ['waves', 'wavy', 'ripples', 'interference', 'stripes', 'bands'], label: 'waves & interference', features: ['fam:waves'], visual: true },
  { id: 'syn:trails', words: ['trails', 'feedback', 'echoes', 'smear', 'smeary'], label: 'feedback & trails', features: ['fam:feedback'], visual: true },
  { id: 'syn:blobs', words: ['blobs', 'blobby', 'metaballs', 'gooey', 'goo'], label: 'smooth union (blobs)', features: ['tech:sdf-smooth'], visual: true },
];

/** The Do bar's actions (src/lang) as the families they bring in. */
const ACTION_FAMILY: Partial<Record<string, FamilyId>> = {
  glow: 'lightFalloff', rings: 'waves', warp: 'spaceDistort', swirl: 'spaceDistort', twist: 'spaceDistort', polar: 'spaceDistort',
  mirror: 'spaceDistort', repeat: 'repetition', 'repeat-around': 'repetition', palette: 'colourMap', 'tone-map': 'colourMap', grade: 'colourMap',
  blend: 'sdfCombine', outline: 'sdfCombine', onion: 'sdfCombine', trails: 'feedback', flow: 'spaceDistort',
};

const plainName = (s: string) => s.toLowerCase().replace(/[()·&→/]/g, ' ').replace(/\s+/g, ' ').trim();

/** Every entry the parser knows, in priority order (on a tie of length, the first wins). */
function entries(): Entry[] {
  const out: Entry[] = [...SYNONYMS];
  for (const t of TECHNIQUES) {
    const words = new Set<string>([plainName(t.name), plainName(t.name.replace(/\(.*\)/, '')), t.id.replace(/-/g, ' ')]);
    const paren = /\(([^)]+)\)/.exec(t.name)?.[1];
    if (paren && /^[a-z][a-z\s-]*$/i.test(paren)) words.add(plainName(paren));
    out.push({ id: `tech:${t.id}`, words: [...words].filter(Boolean), label: t.name, features: [`tech:${t.id}`] });
  }
  for (const f of FAMILIES) {
    const words = new Set<string>([plainName(f.name), plainName(f.name.split('&')[0]), f.id.toLowerCase()]);
    out.push({ id: `fam:${f.id}`, words: [...words].filter(Boolean), label: f.name, features: [`fam:${f.id}`] });
  }
  for (const a of ACTIONS) {
    const fam = ACTION_FAMILY[a.id];
    if (fam) out.push({ id: `fam:${fam}`, words: a.words.filter(w => w !== 'noise' && w !== 'code' && !isFiller(w)), label: FAMILIES.find(f => f.id === fam)?.name ?? fam, features: [`fam:${fam}`] });
  }
  for (const sh of SHAPES) {
    const t = sh.node2d?.type ?? sh.node3d?.type;
    if (t) out.push({ id: `shape:${sh.id}`, words: sh.words.filter(w => !isFiller(w)), label: `${sh.words[0]}s`, features: [nodeBucket(t)] });
  }
  return out;
}
let cached: Entry[] | null = null;
const ENTRIES = () => (cached ??= entries());

const NEGATE = new Set(['no', 'not', 'without', 'less', 'avoid', 'never', 'hate', 'dislike', 'dont', 'don', 'fewer', 'anti', 'nothing', 'none', 'stop', 'skip', 'nor', 'minus']);
const EXTRA_FILLER = new Set([
  'i', 'like', 'love', 'want', 'prefer', 'enjoy', 'pieces', 'piece', 'pictures', 'picture', 'things', 'stuff', 'style', 'styles', 'looks', 'look', 'images', 'image',
  'art', 'work', 'works', 'shaders', 'shader', 'graphs', 'graph', 'lots', 'lot', 'plenty', 'much', 'many', 'loads', 'heavy', 'heavier', 'kind', 'sort', 'really', 'quite',
  'mostly', 'usually', 'often', 'always', 'something', 'anything', 'that', 'which', 'are', 'am', 'my', 'mine', 'or', 'but', 'so', 'too', 'also', 'just', 'way', 'ways', 't', 's',
  'use', 'using', 'used', 'feel', 'feeling', 'vibe', 'vibes', 'please', 'pls', 'have', 'has', 'like', 'over', 'where', 'from', 'as', 'all', 'any', 'only', 'very',
]);
const isFiller = (t: string) => FILLER.has(t) || EXTRA_FILLER.has(t) || /^[\d.]+$/.test(t);

const HIGH = new Set(['high', 'higher', 'big', 'bigger', 'large', 'larger', 'strong', 'stronger', 'fast', 'faster', 'tight', 'tighter', 'max', 'huge']);
const LOW = new Set(['low', 'lower', 'small', 'smaller', 'weak', 'weaker', 'slow', 'slower', 'loose', 'looser', 'min', 'tiny']);
const SETTING_WORDS: Array<{ id: string; words: string[] }> = (() => {
  const known = new Set<string>(COMMON_SETTINGS);
  const out = new Map<string, Set<string>>();
  for (const s of COMMON_SETTINGS) out.set(s === 'freq' ? 'frequency' : s === 'repeat' ? 'repeats' : s, new Set([s]));
  for (const [k, words] of Object.entries(PARAMS)) {
    const key = known.has(k) ? k : null;
    if (key) for (const w of words) if (w.length > 2 && !HIGH.has(w) && !LOW.has(w)) out.get(key)?.add(w);
  }
  return [...out.entries()].map(([id, ws]) => ({ id, words: [...ws] }));
})();

export interface ContextParse { chips: Chip[]; unknown: string[] }
export interface ContextOptions { /** The image model is on: unknown and look words become chips by look. */ byLook?: boolean }

/** Where punctuation was (by look only). */
const BREAK = 'zzbreakzz';
/** A word the image model can take: three or more letters. */
const lookable = (t: string) => /^[a-z][a-z'-]{2,}$/.test(t);

/** Read the context box: the chips it understood (in order, one per meaning) and the words it didn't. */
export function parseContext(text: string, o: ContextOptions = {}): ContextParse {
  // Punctuation ends a look phrase ("underwater, dark" is two); the vocabulary reads straight through it.
  const toks = tokenize(text.replace(/n['’]t\b/gi, ' not').replace(/[,;:!?()\n]+|\.(?=\s|$)/g, o.byLook ? ` ${BREAK} ` : ' '));
  const chips: Chip[] = [];
  const unknown: string[] = [];
  let negate = false;
  const push = (c: Chip) => {
    const at = chips.findIndex(x => x.id === c.id);
    if (at >= 0) chips.splice(at, 1);
    chips.push(c);
  };
  // By look: the current run of look words (one phrase), and whether "no" came before it.
  let run: string[] = [];
  let runNeg = false;
  const flush = () => {
    if (!run.length) return;
    const phrase = run.join(' ');
    push({ id: `text:${phrase}`, phrase, label: phrase, features: [], sign: runNeg ? -1 : 1, ...(runNeg ? { negated: true } : {}), look: phrase });
    run = []; runNeg = false;
  };
  const addToRun = (words: string[]) => { if (!run.length) runNeg = negate; run.push(...words); };
  for (let i = 0; i < toks.length;) {
    const t = toks[i];
    if (t === BREAK) { flush(); i++; continue; }
    if (NEGATE.has(t)) { flush(); negate = true; i++; continue; }
    if (t === 'more' || t === 'lots' || t === 'plenty') { flush(); i++; continue; }
    // A setting with high / low on either side: "high falloff", "speed slow".
    const lvl = HIGH.has(t) ? 'hi' : LOW.has(t) ? 'lo' : null;
    const setAt = (j: number) => SETTING_WORDS.find(s => s.words.includes(toks[j] ?? ''));
    if (lvl && setAt(i + 1)) {
      flush();
      const s = setAt(i + 1)!;
      const sign = negate ? -1 : 1;
      push({ id: `set:${s.id}=${lvl}`, phrase: `${t} ${toks[i + 1]}`, label: `${lvl === 'hi' ? 'high' : 'low'} ${s.id}`, features: [`set:${s.id}=${lvl}`], sign, ...(negate ? { negated: true } : {}) });
      negate = false; i += 2; continue;
    }
    if (setAt(i) && (HIGH.has(toks[i + 1] ?? '') || LOW.has(toks[i + 1] ?? ''))) {
      flush();
      const s = setAt(i)!, l = HIGH.has(toks[i + 1]) ? 'hi' : 'lo';
      push({ id: `set:${s.id}=${l}`, phrase: `${t} ${toks[i + 1]}`, label: `${l === 'hi' ? 'high' : 'low'} ${s.id}`, features: [`set:${s.id}=${l}`], sign: negate ? -1 : 1, ...(negate ? { negated: true } : {}) });
      negate = false; i += 2; continue;
    }
    const m = matchAt(toks, i, ENTRIES());
    if (m && !(m.fuzzy && isFiller(t))) {
      const e = m.entry;
      const words = toks.slice(i, i + m.length);
      // A look word joins the look phrase (by look); anything else ends it.
      if (o.byLook && e.visual) addToRun(words); else flush();
      const sign = ((e.sign ?? 1) * (negate ? -1 : 1)) as 1 | -1;
      push({ id: e.id, phrase: words.join(' '), label: e.label, features: e.features, sign, ...(negate ? { negated: true } : {}) });
      negate = false; i += m.length; continue;
    }
    if (o.byLook && lookable(t) && !isFiller(t)) { addToRun([t]); negate = false; i++; continue; }
    flush();
    if (!isFiller(t) && !unknown.includes(t)) unknown.push(t);
    i++;
  }
  flush();
  return { chips, unknown };
}

/** New context text: parsed again, keeping your flips and removals of chips that are still there. */
export function withContext(s: Steering, text: string, o: ContextOptions = {}): Steering {
  const p = parseContext(text, o);
  const old = new Map(s.chips.map(c => [`${c.id}:${c.sign}`, c]));
  const chips = p.chips.map(c => {
    const o = old.get(`${c.id}:${c.sign}`);
    return o ? { ...c, ...(o.flipped ? { flipped: true } : {}), ...(o.off ? { off: true } : {}) } : c;
  });
  return { ...s, context: text, chips, unknown: p.unknown };
}
