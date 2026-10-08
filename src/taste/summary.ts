/**
 * summary.ts — your taste in plain words (docs/taste.md "The Taste page"), made from the model with
 * templates: no AI. The same model always gives the same text; two people's models give different text
 * because it is built from their own weights, evidence and stage table.
 *
 *   "You like glowing, high-contrast pictures with exponential falloff and dark, vivid palettes (fairly
 *    sure). In the space stage you usually reach for an Expression Block (sure). You rarely keep layered
 *    noise (fBm) (still learning)."
 *
 * Also: the features grouped by kind (for the "What it learned" lists), confidence words, favourite
 * sources. Pure.
 */
import { FAMILY_BY_ID, TECHNIQUE_BY_ID, type FamilyId } from '../patterns/catalogue';
import { confidence, featureLabel, sourceWeight, stageTops, type TasteModel } from './model';
import { chipSign, chipWanted, type Steering } from './steering';

export type Sureness = 'still learning' | 'fairly sure' | 'sure';

/** How sure, from evidence: under 3 still learning, under 8 fairly sure, else sure. */
export function surenessOf(evidence: number): Sureness {
  return evidence < 3 ? 'still learning' : evidence < 8 ? 'fairly sure' : 'sure';
}

/** How sure the whole model is, from how many signals it learned from. */
export function modelSureness(m: TasteModel): { word: Sureness; signals: number; confidence: number } {
  const signals = Object.values(m.signals).reduce((s, v) => s + (v ?? 0), 0);
  return { word: signals < 5 ? 'still learning' : signals < 20 ? 'fairly sure' : 'sure', signals, confidence: confidence(m) };
}

export type FeatureKind = 'technique' | 'stage' | 'palette' | 'setting' | 'source' | 'look' | 'node' | 'other';

export const KIND_TITLES: Record<FeatureKind, string> = {
  technique: 'Techniques & families', stage: 'Stages', palette: 'Palettes', setting: 'Settings ranges', source: 'Sources', look: 'Image look', node: 'Node types (hashed)', other: 'Other',
};

export function featureKind(key: string): FeatureKind {
  const p = key.split(':')[0];
  if (p === 'tech' || p === 'fam' || p === 'code') return 'technique';
  if (p === 'st') return 'stage';
  if (p === 'pal') return 'palette';
  if (p === 'set') return 'setting';
  if (p === 'src') return 'source';
  if (p === 'img' || p === 'look' || p === 'emb') return 'look';
  if (p === 'nh') return 'node';
  return 'other';
}

/** A feature in words for a list (never null: falls back to the key). */
export function featureName(m: TasteModel | null, key: string, positive = true): string {
  if (key.startsWith('src:')) {
    const id = key.slice(4);
    const label = m?.ratings[id]?.label;
    const [kind, ...rest] = id.split(':');
    return label ?? (rest.length ? `${rest.join(':')} (${kind})` : id);
  }
  if (key.startsWith('st:')) { const [stage, choice] = key.slice(3).split('='); return `${choice} in ${stage}`; }
  if (key === '_bias') return 'anything at all (bias)';
  if (key.startsWith('nh:')) return `node bucket ${key.slice(3)}`;
  return featureLabel(key, positive) ?? key;
}

export interface FeatureRow { key: string; kind: FeatureKind; w: number; n: number; name: string }

/** Every learned feature with a weight, grouped by kind, strongest first (the bias and hashed buckets apart). */
export function learnedRows(m: TasteModel): FeatureRow[] {
  return Object.entries(m.w).filter(([k]) => k !== '_bias')
    .map(([key, w]) => ({ key, kind: featureKind(key), w, n: m.n[key] ?? 0, name: featureName(m, key, w > 0) }))
    .sort((a, b) => Math.abs(b.w) - Math.abs(a.w) || a.key.localeCompare(b.key));
}

/** The top liked and disliked per kind. */
export function groupedLikes(m: TasteModel, k = 5, min = 0.02): Array<{ kind: FeatureKind; likes: FeatureRow[]; dislikes: FeatureRow[] }> {
  const rows = learnedRows(m).filter(r => r.kind !== 'node' && Math.abs(r.w) >= min);
  const kinds: FeatureKind[] = ['technique', 'stage', 'palette', 'setting', 'source', 'look', 'other'];
  return kinds.map(kind => ({
    kind,
    likes: rows.filter(r => r.kind === kind && r.w > 0).slice(0, k),
    dislikes: rows.filter(r => r.kind === kind && r.w < 0).slice(0, k),
  })).filter(g => g.likes.length || g.dislikes.length);
}

/** Favourite sources: rated and learned-about graphs and shaders, by their weight as a Surprise source. */
export function favouriteSources(m: TasteModel, k = 6): Array<{ id: string; label: string; weight: number; rating: number }> {
  const ids = new Set<string>();
  for (const [id, r] of Object.entries(m.ratings)) if (r.kind === 'graph' || r.kind === 'shader' || r.kind === 'example') ids.add(id);
  for (const key of Object.keys(m.w)) if (key.startsWith('src:') && !key.startsWith('src:palette:') && !key.startsWith('src:technique:')) ids.add(key.slice(4));
  return [...ids].map(id => ({ id, label: featureName(m, `src:${id}`), weight: sourceWeight(m, id), rating: m.ratings[id]?.v ?? 0 }))
    .filter(s => s.weight > 1.02).sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id)).slice(0, k);
}

// ── The sentences ────────────────────────────────────────────────────────────

const LOOK_ADJ: Record<string, [string, string]> = {
  'img:contrast': ['high-contrast', 'soft'], 'img:colourful': ['colourful', 'muted'], 'img:detail': ['detailed', 'simple'],
  'img:motion': ['moving', 'still'], 'img:structure': ['symmetric', 'loose'], 'img:novelty': ['unusual', 'familiar'],
  'look:dark': ['dark', ''], 'look:bright': ['bright', ''],
};
const FAMILY_ADJ: Partial<Record<FamilyId, string>> = {
  lightFalloff: 'glowing', lightAccum: 'layered-light', spaceDistort: 'warped', repetition: 'tiled', waves: 'wavy', perCell: 'cellular',
  colourMap: 'colour-mapped', feedback: 'trailing', sdfCombine: 'shapely', noise: 'textured', motion: 'animated', march3d: '3D', agents: 'swarming',
};
const PAL_WORD: Record<string, string> = { 'pal:dark': 'dark', 'pal:light': 'light', 'pal:mid': 'mid-tone', 'pal:vivid': 'vivid', 'pal:muted': 'muted' };

const list = (xs: string[]) => (xs.length <= 1 ? xs[0] ?? '' : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const article = (s: string) => (/^[aeiou]/i.test(s) ? `an ${s}` : `a ${s}`);
const lower = (s: string) => (/^[A-Z][a-z]/.test(s) && !/^[A-Z][a-z]+ [A-Z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const techName = (key: string) => {
  if (key.startsWith('tech:')) return lower(TECHNIQUE_BY_ID.get(key.slice(5))?.name ?? key.slice(5));
  if (key.startsWith('fam:')) return lower(FAMILY_BY_ID.get(key.slice(4) as FamilyId)?.name ?? key.slice(4));
  return featureLabel(key) ?? key;
};

export interface Summary {
  /** The whole paragraph. */
  text: string;
  sentences: Array<{ text: string; sure: Sureness; /** Your steering (not learned: no sureness). */ steer?: boolean }>;
  sure: ReturnType<typeof modelSureness>;
}

/** Your taste in a few sentences, from the model (and, said apart, your steering). */
export function summarise(m: TasteModel, s?: Steering, min = 0.05): Summary {
  const sure = modelSureness(m);
  const sentences: Summary['sentences'] = [];
  const ev = (keys: string[]) => (keys.length ? Math.max(...keys.map(k => m.n[k] ?? 0)) : 0);
  const pos = (pred: (k: string) => boolean, k: number) => Object.entries(m.w).filter(([key, w]) => pred(key) && w >= min).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, k).map(([key]) => key);
  const neg = (pred: (k: string) => boolean, k: number) => Object.entries(m.w).filter(([key, w]) => pred(key) && w <= -min).sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])).slice(0, k).map(([key]) => key);

  // 1. "You like glowing, high-contrast pictures with exponential falloff and dark, vivid palettes."
  const lookKeys = Object.entries(m.w).filter(([k, w]) => k in LOOK_ADJ && Math.abs(w) >= min && LOOK_ADJ[k][w > 0 ? 0 : 1])
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]) || a[0].localeCompare(b[0])).slice(0, 2);
  const famKeys = pos(k => k.startsWith('fam:') && !!FAMILY_ADJ[k.slice(4) as FamilyId], 1);
  const adjs = [...famKeys.map(k => FAMILY_ADJ[k.slice(4) as FamilyId]!), ...lookKeys.map(([k, w]) => LOOK_ADJ[k][w > 0 ? 0 : 1])];
  const techKeys = pos(k => k.startsWith('tech:'), 2);
  const palKeys = pos(k => k.startsWith('pal:'), 2);
  const codeLike = (m.w['code:yes'] ?? 0) >= min ? ['code:yes'] : [];
  if (adjs.length || techKeys.length || palKeys.length) {
    let t = `You like ${adjs.length ? `${adjs.join(', ')} pictures` : 'pictures'}`;
    const withs: string[] = [];
    if (techKeys.length) withs.push(list(techKeys.map(techName)));
    if (palKeys.length) withs.push(`${palKeys.map(k => PAL_WORD[k]).join(', ')} palettes`);
    if (codeLike.length) withs.push('code in the graph');
    if (withs.length) t += ` with ${list(withs)}`;
    sentences.push({ text: `${t}.`, sure: surenessOf(ev([...famKeys, ...lookKeys.map(([k]) => k), ...techKeys, ...palKeys, ...codeLike])) });
  }

  // 2. Stages: "In the space stage you usually reach for an Expression Block."
  const tops = stageTops(m, 2).filter(t => t.share >= 0.45).slice(0, 2);
  for (const [i, t] of tops.entries()) {
    const what = article(lower(t.choice));
    sentences.push({
      text: i === 0 ? `In the ${t.stage} stage you usually reach for ${what}.` : t.share >= 0.99 ? `For ${t.stage}, it’s always been ${what}.` : `For ${t.stage}, it’s mostly ${what} (${Math.round(t.share * 100)}% of the time).`,
      sure: surenessOf(t.count),
    });
  }

  // 3. Settings: "You tend to set falloff high and frequency low."
  const setKeys = pos(k => k.startsWith('set:'), 3);
  if (setKeys.length) {
    const words = setKeys.map(k => { const [name, b] = k.slice(4).split('='); return `${name} ${b === 'hi' ? 'high' : b === 'lo' ? 'low' : 'in the middle'}`; });
    sentences.push({ text: `You tend to set ${list(words)}.`, sure: surenessOf(ev(setKeys)) });
  }

  // 4. Dislikes: "You rarely keep layered noise (fBm)."
  const dis = neg(k => k.startsWith('tech:') || k.startsWith('fam:') || k.startsWith('pal:') || k === 'code:yes', 2);
  if (dis.length) sentences.push({ text: `You rarely keep ${list(dis.map(k => (k.startsWith('pal:') ? `${PAL_WORD[k]} palettes` : techName(k))))}.`, sure: surenessOf(ev(dis)) });

  // 5. Sources.
  const fav = favouriteSources(m, 2);
  if (fav.length) sentences.push({ text: `Your favourite ${fav.length === 1 ? 'source is' : 'sources are'} ${list(fav.map(f => `“${f.label}”`))}.`, sure: surenessOf(Math.max(...fav.map(f => (m.n[`src:${f.id}`] ?? 0) + (f.rating ? 3 : 0)))) });

  // 6. Your steering, said apart.
  if (s) {
    const on = s.chips.filter(c => chipSign(c));
    const want = on.filter(chipWanted).map(c => c.label);
    const not = on.filter(c => !chipWanted(c)).map(c => c.label);
    const banned = Object.entries(s.pins).filter(([, p]) => p === 'ban').map(([k]) => featureName(m, k));
    const parts: string[] = [];
    if (want.length) parts.push(`more ${list(want)}`);
    if (not.length) parts.push(`less ${list(not)}`);
    if (banned.length) parts.push(`never ${list(banned)}`);
    if (parts.length) sentences.push({ text: `You asked for ${list(parts)}.`, sure: 'sure', steer: true });
  }

  if (!sentences.length) {
    const text = sure.signals
      ? `Still learning: ${sure.signals} signal${sure.signals === 1 ? '' : 's'} so far, and nothing stands out yet.`
      : 'Nothing learned yet. Play a few rounds of Evolve, keep or undo surprises, or like and dislike graphs, shaders and palettes.';
    return { text, sentences: [{ text, sure: 'still learning' }], sure };
  }
  return { text: sentences.map(x => (x.steer ? x.text : `${x.text.replace(/\.$/, '')} (${x.sure}).`)).join(' '), sentences, sure };
}
