/**
 * links.ts — optional links between saved graphs (Plays included) and
 * presentations. Both stay independent things; a link only says "these go
 * together", so loading one can open (or offer) the other.
 *
 * Stored on both sides, by name (a saved graph and a presentation are both
 * keyed by their name):
 *
 *   saved graph   `shader-studio:<name>`               linkedPresentations?: string[]
 *   presentation  `shader-studio-presentation:<name>`  linkedGraphs?: string[]
 *
 * Absent (or not a list) means none, so records from before need no migration
 * step. Every change goes through this module so the two sides agree: link,
 * unlink, a side deleted (the other stays, only the link goes), a
 * presentation renamed, a library imported under new names. Reads also drop
 * names whose partner is gone (a file deleted in Finder, say), so a stale
 * entry never shows.
 *
 * Examples can't be written to, so their links are declared here
 * (EXAMPLE_PRESENTATION_LINKS): an example → the sample presentation that
 * teaches it. Those are one-way.
 */

export const GRAPH_LINK_FIELD = 'linkedPresentations';
export const PRESENTATION_LINK_FIELD = 'linkedGraphs';
const GRAPH_PREFIX = 'shader-studio:';
/** The same as utils/library's PRESENTATION_KEY_PREFIX (kept here so this module imports nothing). */
const PRESENTATION_KEY_PREFIX = 'shader-studio-presentation:';
/** Fired on window when links change (lists re-read their badges). */
export const LINKS_CHANGED = 'graph-presentation-links-changed';

export interface LinkKV {
  get(key: string): string | null;
  set(key: string, value: string): void;
  /** This is the app's own storage (so the open presentation goes through the Present page). */
  local?: boolean;
}

const localKV: LinkKV = {
  local: true,
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage full: the link just isn't kept */ } },
};

// ── The open presentation ──────────────────────────────────────────────────
// The Present page keeps the open presentation in memory and writes it back a
// moment after each change, so a change to *its* links goes through it (or the
// next save would put the old list back). It registers itself when it loads.

export interface OpenPresentationBridge {
  name(): string | null;
  /** Its links as they are in memory. */
  links(): string[];
  setLinks(links: string[]): void;
}
let bridge: OpenPresentationBridge | null = null;
export function registerOpenPresentation(b: OpenPresentationBridge | null): void { bridge = b; }
/** The presentation open on the Present page (null when none, or the page hasn't loaded). */
export function openPresentationName(): string | null { return bridge?.name() ?? null; }

// ── Reading ────────────────────────────────────────────────────────────────

/** A stored links field as a clean list: strings, trimmed, each once. Anything else is none (old records). */
export function normalizeLinks(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const x of raw) if (typeof x === 'string' && x.trim() && !out.includes(x)) out.push(x);
  return out.slice(0, 32);
}

type Obj = Record<string, unknown>;
const parseObj = (v: string | null): Obj | null => {
  if (v == null) return null;
  try { const o = JSON.parse(v); return o && typeof o === 'object' && !Array.isArray(o) ? o as Obj : null; } catch { return null; }
};

export const graphKey = (name: string) => GRAPH_PREFIX + name;
export const presentationKey = (name: string) => PRESENTATION_KEY_PREFIX + name;
const graphExists = (kv: LinkKV, name: string) => kv.get(graphKey(name)) != null;
const presentationExists = (kv: LinkKV, name: string) => kv.get(presentationKey(name)) != null;

/** The raw list stored on a graph (not checked against what exists). */
function storedGraphLinks(kv: LinkKV, graph: string): string[] {
  return normalizeLinks(parseObj(kv.get(graphKey(graph)))?.[GRAPH_LINK_FIELD]);
}
function storedPresentationLinks(kv: LinkKV, pres: string): string[] {
  return normalizeLinks(parseObj(kv.get(presentationKey(pres)))?.[PRESENTATION_LINK_FIELD]);
}

/** The presentations a saved graph is linked to that are still here. */
export function linkedPresentationsOf(graph: string, kv: LinkKV = localKV): string[] {
  return storedGraphLinks(kv, graph).filter(p => presentationExists(kv, p));
}

/** The saved graphs a presentation is linked to that are still here. */
export function linkedGraphsOf(pres: string, kv: LinkKV = localKV): string[] {
  return presentationLinksNow(kv, pres).filter(g => graphExists(kv, g));
}

// ── Writing ────────────────────────────────────────────────────────────────

const changed = () => { try { window.dispatchEvent(new Event(LINKS_CHANGED)); } catch { /* no window in tests */ } };

/** Write a graph's list (dropped from the record when empty, so it looks as it did before links). */
function writeGraphLinks(kv: LinkKV, graph: string, links: string[]): void {
  const o = parseObj(kv.get(graphKey(graph)));
  if (!o) return;
  const had = normalizeLinks(o[GRAPH_LINK_FIELD]);
  if (had.length === links.length && had.every((x, i) => x === links[i]) && (links.length > 0 || !(GRAPH_LINK_FIELD in o))) return;
  if (links.length) o[GRAPH_LINK_FIELD] = links; else delete o[GRAPH_LINK_FIELD];
  kv.set(graphKey(graph), JSON.stringify(o));
}

function writePresentationLinks(kv: LinkKV, pres: string, links: string[]): void {
  if (kv.local && bridge && bridge.name() === pres) { bridge.setLinks(links); return; }
  const o = parseObj(kv.get(presentationKey(pres)));
  if (!o) return;
  const had = normalizeLinks(o[PRESENTATION_LINK_FIELD]);
  if (had.length === links.length && had.every((x, i) => x === links[i]) && (links.length > 0 || !(PRESENTATION_LINK_FIELD in o))) return;
  if (links.length) o[PRESENTATION_LINK_FIELD] = links; else delete o[PRESENTATION_LINK_FIELD];
  kv.set(presentationKey(pres), JSON.stringify(o));
}

const add = (xs: string[], x: string) => (xs.includes(x) ? xs : [...xs, x]);
const without = (xs: string[], x: string) => xs.filter(y => y !== x);

/** Link a saved graph and a presentation (both must exist). False when one of them doesn't. */
export function link(graph: string, pres: string, kv: LinkKV = localKV): boolean {
  if (!graphExists(kv, graph) || !presentationExists(kv, pres)) return false;
  writeGraphLinks(kv, graph, add(storedGraphLinks(kv, graph).filter(p => presentationExists(kv, p)), pres));
  writePresentationLinks(kv, pres, add(presentationLinksNow(kv, pres).filter(g => graphExists(kv, g)), graph));
  changed();
  return true;
}

export function unlink(graph: string, pres: string, kv: LinkKV = localKV): void {
  writeGraphLinks(kv, graph, without(storedGraphLinks(kv, graph), pres));
  writePresentationLinks(kv, pres, without(presentationLinksNow(kv, pres), graph));
  changed();
}

/** The open presentation's list comes from memory (its stored copy may be a moment behind). */
function presentationLinksNow(kv: LinkKV, pres: string): string[] {
  if (kv.local && bridge && bridge.name() === pres) return normalizeLinks(bridge.links());
  return storedPresentationLinks(kv, pres);
}

/** A saved graph was deleted: its presentations stay, without the link. */
export function graphDeleted(graph: string, kv: LinkKV = localKV, links?: string[]): void {
  const partners = links ?? storedGraphLinks(kv, graph);
  for (const p of partners) if (presentationExists(kv, p)) writePresentationLinks(kv, p, without(presentationLinksNow(kv, p), graph));
  if (partners.length) changed();
}

/** A presentation was deleted: its graphs stay, without the link. */
export function presentationDeleted(pres: string, kv: LinkKV = localKV, links?: string[]): void {
  const partners = links ?? presentationLinksNow(kv, pres);
  for (const g of partners) writeGraphLinks(kv, g, without(storedGraphLinks(kv, g), pres));
  if (partners.length) changed();
}

/** A presentation is now called `to`: its graphs point at the new name. */
export function presentationRenamed(from: string, to: string, kv: LinkKV = localKV): void {
  if (from === to) return;
  const partners = storedPresentationLinks(kv, to);
  for (const g of partners) writeGraphLinks(kv, g, add(without(storedGraphLinks(kv, g), from), to));
  if (partners.length) changed();
}

/** A saved graph is now called `to` (copied under the new name; the old record gone). */
export function graphRenamed(from: string, to: string, kv: LinkKV = localKV): void {
  if (from === to) return;
  const partners = storedGraphLinks(kv, to);
  for (const p of partners) if (presentationExists(kv, p)) writePresentationLinks(kv, p, add(without(presentationLinksNow(kv, p), from), to));
  if (partners.length) changed();
}

/**
 * A presentation came back (Undo of a delete) or arrived with a links list of
 * its own: keep the links whose graph is here, and make those graphs point
 * back at it.
 */
export function reconcilePresentation(pres: string, kv: LinkKV = localKV): void {
  const mine = storedPresentationLinks(kv, pres);
  const kept = mine.filter(g => graphExists(kv, g));
  if (kept.length !== mine.length) writePresentationLinks(kv, pres, kept);
  for (const g of kept) writeGraphLinks(kv, g, add(storedGraphLinks(kv, g), pres));
  if (mine.length) changed();
}

/**
 * After a library, backup or profile import: things that came in under a new
 * name ("Rings (imported)", "Lesson (2)") keep their links to each other. For
 * every graph and presentation written by the import, its links are renamed
 * through the maps (from the name in the import to the name here), links to
 * things that weren't in the import are dropped, and the partners point back.
 *
 * `graphs` / `presentations`: every item of the import → its name here (the
 * same name when it came in as it was, or matched one already here).
 * `written`: the names (here) the import actually wrote.
 */
export function fixImportedLinks(
  kv: LinkKV,
  graphs: ReadonlyMap<string, string>,
  presentations: ReadonlyMap<string, string>,
  written: { graphs: Iterable<string>; presentations: Iterable<string> },
): void {
  for (const g of written.graphs) {
    const links = storedGraphLinks(kv, g).map(p => presentations.get(p)).filter((p): p is string => !!p && presentationExists(kv, p));
    writeGraphLinks(kv, g, [...new Set(links)]);
    for (const p of links) writePresentationLinks(kv, p, add(storedPresentationLinks(kv, p), g));
  }
  for (const p of written.presentations) {
    const links = storedPresentationLinks(kv, p).map(g => graphs.get(g)).filter((g): g is string => !!g && graphExists(kv, g));
    writePresentationLinks(kv, p, [...new Set(links)]);
    for (const g of links) writeGraphLinks(kv, g, add(storedGraphLinks(kv, g), p));
  }
}

// ── Examples ───────────────────────────────────────────────────────────────

/**
 * Bundled examples → the sample presentations (by title, see
 * present/samples.ts) built to teach them. Checked by a test against the
 * examples and samples, so a renamed one can't silently drift.
 */
export const EXAMPLE_PRESENTATION_LINKS: Readonly<Record<string, readonly string[]>> = (() => {
  const out: Record<string, string[]> = {};
  const put = (title: string, keys: string[]) => { for (const k of keys) (out[k] ??= []).push(title); };
  put('Getting started in the Studio', ['learnColour', 'learnUV', 'learnCircle', 'learnLoop']);
  put('Shaders from zero', ['learnUV', 'learnStep', 'learnHSB', 'learnCircle', 'learnRotate', 'learnTiling', 'learnRandomGrid', 'learnNoise', 'learnFBM']);
  put('Ray marching, step by step', ['learn3dCamera', 'learn3dDistance', 'learn3dMarch', 'learn3dLight', 'learn3dCombine', 'learn3dVolume', 'learn3dGI']);
  put('Transforms with matrices', ['matrixWhatItDoes', 'matrixCombineUndo', 'matrixAnyBasis', 'matrixFoldFractal', 'matrixColor']);
  put('Playing a shader', ['playControls', 'playMouse', 'playLfo', 'playKeys', 'playNull', 'playGlowText', 'playTake']);
  put('Sketching over shaders', ['scriptFirst', 'scriptMouse', 'scriptPicture', 'scriptButtons', 'scriptParticles', 'scriptP5', 'scriptGlow']);
  put('Field sockets: one shape, many copies', ['comboGridShapeByWire', 'comboArrayStars', 'comboGridGroupFlower', 'comboArrayGroupMoons', 'comboGridPaintShapes']);
  put('Bring your own GLSL', ['convertCircle', 'convertCircleOptimised']);
  return out;
})();

export function exampleLinks(key: string): readonly string[] {
  return EXAMPLE_PRESENTATION_LINKS[key] ?? [];
}

// ── What happens on load ───────────────────────────────────────────────────

/** When a graph with a linked presentation loads (and a linked presentation opens): ask, open it too, or nothing. */
export type LinkedOpenSetting = 'ask' | 'open' | 'never';
const SETTING_KEY = 'shader-studio:settings:linkedOpen';
export const LINKED_OPEN_SETTING_CHANGED = 'linked-open-setting-changed';

export function linkedOpenSetting(): LinkedOpenSetting {
  try { const v = localStorage.getItem(SETTING_KEY); return v === 'open' || v === 'never' ? v : 'ask'; } catch { return 'ask'; }
}
export function setLinkedOpenSetting(v: LinkedOpenSetting): void {
  try { if (v === 'ask') localStorage.removeItem(SETTING_KEY); else localStorage.setItem(SETTING_KEY, v); } catch { /* a preference */ }
  try { window.dispatchEvent(new Event(LINKED_OPEN_SETTING_CHANGED)); } catch { /* no window */ }
}

export type LinkDecision =
  | { kind: 'none' }
  /** A small notice with a button. */
  | { kind: 'offer'; name: string; others: number }
  /** Do it now (without leaving the page). */
  | { kind: 'open'; name: string; others: number };

/**
 * A graph was loaded: what to do about its presentations. Nothing when it has
 * none, when the setting is Never, or when one of them is already open on the
 * Present page.
 */
export function decideOnGraphLoad(o: { setting: LinkedOpenSetting; linked: readonly string[]; openPresentation: string | null }): LinkDecision {
  if (!o.linked.length || o.setting === 'never') return { kind: 'none' };
  if (o.openPresentation && o.linked.includes(o.openPresentation)) return { kind: 'none' };
  return { kind: o.setting === 'open' ? 'open' : 'offer', name: o.linked[0], others: o.linked.length - 1 };
}

/**
 * A presentation was opened: what to do about its graphs. Nothing when it has
 * none, on Never, or when one of them is the graph open now. "Always" never
 * replaces unsaved work without asking: with unsaved changes it only offers.
 */
export function decideOnPresentationOpen(o: { setting: LinkedOpenSetting; linked: readonly string[]; currentGraph: string | null; graphDirty: boolean }): LinkDecision {
  if (!o.linked.length || o.setting === 'never') return { kind: 'none' };
  if (o.currentGraph && o.linked.includes(o.currentGraph)) return { kind: 'none' };
  const open = o.setting === 'open' && !o.graphDirty;
  return { kind: open ? 'open' : 'offer', name: o.linked[0], others: o.linked.length - 1 };
}
