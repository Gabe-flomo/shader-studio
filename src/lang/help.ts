/**
 * help.ts — the language's help, organised like documentation (docs/playfield-language.md,
 * "Help in the app"): every word of a dialect in a section (Modes, Combine, Shapes, Warps,
 * Settings, Camera, Colours, Output for a 3D scene), each section with a short plain description,
 * each entry with what it is and means, its settings with their types and ranges, and an example
 * line. Built from the registry (registry.ts), so it can't drift from what the parser reads; the
 * longer explanations are written here.
 *
 *  - helpSections(d): the sections of a dialect, in order, with their entries.
 *  - helpAt(d, text, offset): what the word at `offset` of a line is (a head, a setting, a value)
 *    and its help, with the alternatives a popover offers (other modes, a setting's choices…).
 *  - hoverIntent(): when a word's help opens (after a moment's hover) and closes (not while the
 *    pointer is inside it).
 *
 * Pure: no React, no store.
 */
import { entriesFor, type Dialect, type Entry, type ParamSpec } from './registry';
import { COLOUR_NAMES, COLOUR_TABLE } from './colours';
import { OUTPUTS, PALETTES } from '../sceneBuilder/output';
import { SHAPE_BY_KIND, shapeDims } from '../sceneBuilder/spec';
// The dialects' words register themselves on import.
import './dialects/grid';
import './dialects/agents';

// ── Types ───────────────────────────────────────────────────────────────────

export interface HelpParam {
  key: string;
  aliases: string[];
  /** The kind of value, in words: "number", "3 numbers (x, y, z)", "colour", "angle (degrees)"… */
  type: string;
  /** "0.01 to 5", where there is one. */
  range?: string;
  def?: string;
  hint: string;
  /** The words it takes, for a choice (and the colours, for a colour). */
  options?: string[];
  /** May be written bare, first. */
  primary?: boolean;
}

export interface HelpEntry {
  id: string;
  /** The canonical word. */
  word: string;
  aliases: string[];
  section: string;
  /** A name for it ("Box frame"). */
  title: string;
  /** One line. */
  summary: string;
  /** What it is and means, in a few sentences. */
  more: string;
  params: HelpParam[];
  flags: string[];
  /** A line to try. */
  example: string;
  /** How it is written: `box [size] width= height= …`. */
  signature: string;
}

export interface HelpSection {
  id: string;
  title: string;
  /** What the section is about, plainly. */
  blurb: string;
  entries: HelpEntry[];
}

export type HelpDialect = Dialect;

// ── Value types ─────────────────────────────────────────────────────────────

const TYPE_WORDS: Record<ParamSpec['type'], string> = {
  number: 'number', count: 'whole number', angle: 'angle (degrees)', time: 'time (seconds)', vec2: '2 numbers (x, y)',
  vec3: '3 numbers (x, y, z)', colour: 'colour', choice: 'one of a list', list: 'list of numbers', flag: 'flag (on when written)',
  code: 'code (one line of GLSL)', name: 'name', place: 'place', ref: 'a node', range: 'range (a..b)',
};

/** A setting's kind of value, in words. */
export function typeLabel(p: Pick<ParamSpec, 'type' | 'options'>): string {
  if (p.type === 'choice' && p.options?.length) return p.options.length <= 6 ? `one of ${p.options.join(', ')}` : 'one of a list';
  if (p.type === 'vec3') return '3 numbers (x, y, z); one number fills all three';
  return TYPE_WORDS[p.type] ?? p.type;
}

/** What a setting without its own words is for, by key, else by type. */
const TYPE_HINTS: Record<string, string> = {
  at: 'Where its centre is: (x, y, z).', rot: 'How it is turned: degrees about x, then y, then z.', shine: '0 matt … 1 glossy.', name: 'A name of your own, for the tree and notes.',
  ':colour': 'A colour name, #rrggbb, or (r, g, b) from 0 to 1.', ':vec3': 'Three numbers (x, y, z), or one for all three.', ':name': 'A name; quote it when it has spaces.',
  ':flag': 'Written on its own to turn it on.', ':code': 'One line of GLSL.',
};

const fmt = (n: number) => String(Math.round(n * 1000) / 1000);
const defText = (d: unknown): string | undefined =>
  d === undefined ? undefined : Array.isArray(d) ? `(${d.map(x => fmt(Number(x))).join(', ')})` : typeof d === 'number' ? fmt(d) : String(d);

function helpParam(p: ParamSpec): HelpParam {
  const range = p.min !== undefined && p.max !== undefined ? `${fmt(p.min)} to ${fmt(p.max)}${p.type === 'angle' ? '°' : ''}`
    : p.rand?.kind === 'num' ? `usually ${fmt(p.rand.lo)} to ${fmt(p.rand.hi)}` : undefined;
  const options = p.options ? [...p.options] : p.type === 'colour' ? [...COLOUR_NAMES] : undefined;
  const hint = [p.label && p.label !== p.key ? p.label : '', p.hint ?? ''].filter(Boolean).join(': ') || TYPE_HINTS[p.key] || TYPE_HINTS[`:${p.type}`] || typeLabel(p);
  return { key: p.key, aliases: p.aliases ?? [], type: typeLabel(p), ...(range ? { range } : {}), ...(defText(p.def) !== undefined ? { def: defText(p.def) } : {}), hint, ...(options ? { options } : {}), ...(p.primary ? { primary: true } : {}) };
}

const signatureOf = (e: Entry, params: ParamSpec[]) =>
  [e.kind === 'combine' ? `${e.words[0]}(a, b)` : e.words[0], ...params.map(p => (p.primary ? `[${p.key}]` : `${p.key}=`)), ...(e.flags ?? []).slice(0, 4).map(f => `[${f}]`)].join(' ');

// ── The longer explanations ─────────────────────────────────────────────────

const MORE: Record<string, string> = {
  'scene:surface': 'Solid objects lit by a sun and a sky, with soft shadows and ambient occlusion. It is the default: a recipe with no mode is a surface scene. It has no settings of its own; light it with sun, sky, bounce, shadows and ao.',
  'scene:volumetric': 'The ray doesn\'t stop at a surface: it keeps going and gathers light from inside the shapes, like glowing gas or neon smoke. density is how much glow each step adds, falloff how fast it fades away from the surface, shell a bright skin at the surface, exposure the overall brightness and tint its colour.',
  'scene:glass': 'Shapes bend the light that passes through them, like clear glass. ior is how strongly light bends (1 is air, 1.5 window glass), dispersion splits the colours into rainbows at the edges, tint colours the glass. In the other modes, the glass flag on a shape makes only that shape glass.',
  'scene:gi': 'Surfaces lit by one bounce of light from their neighbours (global illumination): colours bleed onto nearby surfaces. bounce is its strength, metal and rough the material, spec the highlights. Slower than surface.',
  'combine:union': 'Puts shapes together: wherever any of them is, there is a surface, and the nearer one wins. The scene\'s clauses are joined by a union already, so you write union( ) only to keep items together under one @warp or name.',
  'combine:smooth-union': 'Like union, but the shapes melt into each other where they meet, like drops of liquid. k is how wide the melted joint is: 0 a sharp seam, 0.5 a wide blend.',
  'combine:subtract': 'Cuts every later shape out of the first one: subtract(box, sphere) is a box with a ball-shaped bite out of it.',
  'combine:smooth-subtract': 'A subtract whose cut edges are rounded over k.',
  'combine:intersect': 'Keeps only the part where all the shapes overlap: intersect(box, sphere) is a cube with rounded corners.',
  'combine:smooth-intersect': 'An intersect with rounded edges where the shapes\' surfaces meet; k is how round.',
  'scene:sun': 'The main light. dir points from the scene toward the sun as (x, y, z): (1, 2, 1) is high up and to the right. color tints it.',
  'scene:sky': 'Soft light from above that fills in the shadows; its colour tints the shady sides.',
  'scene:bounce': 'Light reflected up from the ground onto the undersides of things.',
  'scene:shadows': 'How sharp the sun\'s shadows are: 8 is soft, 32 hard. off turns them off, which is faster.',
  'scene:ao': 'Ambient occlusion darkens creases and corners where light hardly reaches. The step is how far it looks; off turns it off.',
  'scene:fog': 'Far things fade into fog. 0.1 is a light haze, 0.5 thick. color sets the fog\'s colour.',
  'scene:background': 'What is behind the shapes: one colour, or top= and bottom= for a gradient from the top of the picture to the bottom.',
  'scene:tone': 'Tone mapping squeezes bright light into what the screen can show. aces is filmic, agx soft and neutral; none leaves the values as they are.',
  'scene:quality': 'How carefully the rays march. steps: more is slower but finds thin parts; dist: how far they go; step: a scale on every step (lower for warped shapes, or auto to work it out); jitter breaks up banding; warp: a safety level for warps (off, auto, careful, high).',
  'scene:camera': 'The orbit camera looks at the middle of the scene. dist is how far away it stands, angle where round it stands and elev how high (degrees), orbit turns it slowly (degrees a second), zoom is the lens, flatten 0 perspective … 1 isometric, and x, y, z move the point it looks at. The projection is a word: perspective (far things smaller), orthographic (parallel rays, no change of size with distance) or reverse (far things bigger, like a Byzantine icon; reverse= is its strength 0 … 1, converge= where the rays meet).',
  'scene:texture': 'A picture the scene reads, by name: texture pond, then texture=pond on a shape (its surface, read in the shape\'s own space so it moves and repeats with it) or background picture=pond. Picking a picture in the builder writes its node= and aspect=; one typed without a node gets an empty Texture node on Build, ready for a picture.',
  'scene:output': 'What the picture shows: the lit picture (the default), or one of the march\'s measurements for checking and colouring (depth, normal, hit, steps…), as grey or through a palette.',
  'scene:colour-by': 'Colours the scene by a measurement (depth, height, distance…) through a palette instead of lighting it: colour by depth palette=sunset.',
  'scene:random': 'A leading random draws every setting the line leaves unset from its interesting range; random as a value draws that one setting (random(0.2..2) or random(red, teal) for your own range). The recipe shows what was drawn, with Keep these and Roll again.',
  'scene:seed': 'seed=42 (or a word) makes random values repeat: the same seed draws the same scene.',
  'scene:custom': 'A shape written as GLSL: custom(length(p) - 0.5). p is the point being measured; the code returns its distance to the surface.',
  'scene:custom-warp': 'A warp written as GLSL: it changes p, the point being measured, before the shapes see it.',
  'colours:color': 'Every shape has a colour. Write a name (gold, teal, orange…), a hex code (#ff8844) or three numbers from 0 to 1 for red, green and blue: (0.9, 0.5, 0.3).',
  'colours:shine': 'How glossy the surface is: 0 is matt like chalk, 1 shiny like plastic.',
  'colours:glass': 'Written after a shape, makes it glass: it bends the light behind it. Any render mode, any number of shapes.',
  'colours:names': 'The colour words the language knows. Use them anywhere a colour goes: color=gold, sky teal, fog 0.3 color=navy.',
  'colours:palettes': 'The palettes for colour by and output … palette=: cosine palettes and colour ramps.',
};

/** Section blurbs, by dialect. */
const SECTIONS: Record<string, Array<{ id: string; title: string; blurb: string }>> = {
  scene: [
    { id: 'modes', title: 'Modes', blurb: 'Ways of rendering the 3D space: lit surfaces, glowing gas, glass, or light that bounces. A recipe has one, written first.' },
    { id: 'combine', title: 'Combine', blurb: 'How shapes go together: joined, melted into each other, cut out of each other, or only where they overlap.' },
    { id: 'shapes', title: 'Shapes', blurb: 'The things in the scene. Each is a word with its size, then where it is (at=), how it is turned (rot=) and its colour.' },
    { id: 'warps', title: 'Warps', blurb: 'Bend, twist, repeat or mirror space. On its own a warp bends the whole scene; after a shape with @ (box @twist(2)) only that shape.' },
    { id: 'settings', title: 'Settings', blurb: 'Light and air: the sun, the sky, shadows, fog, the background, tone mapping, and how carefully the rays march.' },
    { id: 'camera', title: 'Camera', blurb: 'Where you look from, and whether it moves.' },
    { id: 'colours', title: 'Colours', blurb: 'How to write a colour, and a shape\'s surface: its colour, its shine and glass.' },
    { id: 'output', title: 'Output', blurb: 'What the picture shows: the lit picture, or depth, normals, steps… as grey or through a palette.' },
  ],
  picture: [
    { id: 'shapes', title: 'Shapes', blurb: 'What a 2D picture starts from: a shape (its distance field) or a pattern like noise.' },
    { id: 'shape-it', title: 'Shape it', blurb: 'Turn a shape into something you see: a glow, rings, an outline, a soft edge, a mask.' },
    { id: 'warps', title: 'Warps', blurb: 'Bend, repeat and mirror the space the shapes are drawn in: swirl, twist, polar, repeat, kaleidoscope.' },
    { id: 'combine', title: 'Combine', blurb: 'Put two things together: shapes melted into each other, colours mixed or blended.' },
    { id: 'colours', title: 'Colours', blurb: 'Colour it: through a palette, by a driver (the length of the space, the angle, time…), or mixed with a colour.' },
    { id: 'passes', title: 'Passes', blurb: 'Draw it into a texture so later steps can read around each pixel: trails, blur, flow.' },
    { id: 'finish', title: 'Finish', blurb: 'The last touches on the whole picture: tone mapping, a grade, brightness, grain.' },
    { id: 'edits', title: 'Edits', blurb: 'Verbs that change the graph you have: create, connect, set, insert, delete, rename, group…' },
  ],
  edit: [
    { id: 'edits', title: 'Edits', blurb: 'Verbs that change the graph you have: create, connect, set, insert, delete, rename, group…' },
    { id: 'combine', title: 'Combine', blurb: 'Put two things together with a new node.' },
  ],
  pass: [
    { id: 'passes', title: 'Passes', blurb: 'Draw it into a texture so later steps can read around each pixel: trails, blur, flow.' },
  ],
  grid: [
    { id: 'types', title: 'Rule types', blurb: 'The kinds of rule a grid can follow: count neighbours, step through stages, flow smoothly, match patterns or move 2×2 blocks.' },
    { id: 'presets', title: 'Presets', blurb: 'Famous rules by name: write one and the grid follows it (life, brians-brain, mitosis, falling-sand…).' },
    { id: 'custom', title: 'Custom rules', blurb: 'Your own rules, cell by cell: a 3×3 pattern and what the middle becomes, or a 2×2 block before and after.' },
    { id: 'settings', title: 'Settings', blurb: 'How the grid runs: its rule numbers, the board size, speed, how it starts, and the mouse brush.' },
    { id: 'colours', title: 'Colours', blurb: 'The colour of each state, the afterglow and old cells.' },
  ],
  agents: [
    { id: 'rules', title: 'Rule sets', blurb: 'The walkers and their rules: a rule set, its species and their states, and rules written as when … do ….' },
    { id: 'conditions', title: 'Conditions', blurb: 'What a rule checks before it acts (the part after when): near a trail, a chance, age, a memory, a mask.' },
    { id: 'actions', title: 'Actions', blurb: 'What a rule does (the part after do): turn, wander, leave a trail, change state, spawn, flock.' },
    { id: 'settings', title: 'Settings', blurb: 'How the walkers sense and remember: the sensors, the flow field, trail channels, masks, memories.' },
    { id: 'colours', title: 'Colours', blurb: 'How the walkers are coloured: by state, or by a memory.' },
  ],
};

/** The section an entry belongs to, by dialect. */
function sectionOf(d: Dialect, e: Entry): string {
  switch (d) {
    case 'scene':
      if (e.kind === 'header') return 'modes';
      if (e.kind === 'combine') return 'combine';
      if (e.kind === 'maker') return 'shapes';
      if (e.kind === 'step') return 'warps';
      if (e.kind === 'output') return 'output';
      return e.id === 'scene:camera' ? 'camera' : 'settings';
    case 'picture':
      if (e.dialects.includes('edit') && e.kind === 'verb') return 'edits';
      if (e.kind === 'maker') return 'shapes';
      if (e.kind === 'combine') return e.stage === 'colour' ? 'colours' : e.id === 'edit:group' ? 'edits' : 'combine';
      if (e.kind === 'output') return 'colours';
      if (e.stage === 'space') return 'warps';
      if (e.stage === 'colour') return 'colours';
      if (e.stage === 'pass') return 'passes';
      if (e.stage === 'post') return 'finish';
      return 'shape-it';
    case 'edit': return e.kind === 'combine' && e.id !== 'edit:group' ? 'combine' : 'edits';
    case 'pass': return 'passes';
    case 'grid':
      if (e.id.startsWith('grid:type:')) return 'types';
      if (e.id.startsWith('grid:preset:')) return 'presets';
      if (e.id === 'grid:stencil' || e.id === 'grid:block') return 'custom';
      if (e.id === 'grid:colours') return 'colours';
      return 'settings';
    case 'agents':
      if (e.kind === 'condition') return 'conditions';
      if (e.kind === 'action') return e.id === 'agents:mem' ? 'settings' : 'actions';
      if (e.stage === 'colour') return 'colours';
      if (e.kind === 'header' || e.id === 'agents:species') return 'rules';
      return 'settings';
  }
}

/** A shape's example: its dimensions written the new way, so the line teaches them. */
function exampleOf(d: Dialect, e: Entry): string {
  if (d === 'scene' && e.id.startsWith('scene:shape:')) {
    const def = SHAPE_BY_KIND[e.words[0]];
    const dims = def ? shapeDims(def) : null;
    if (dims?.vector) return `surface · ${e.words[0]} width=0.3 height=0.6 depth=0.3 color=orange`;
    if (dims) return `surface · ${e.words[0]} size=0.4 color=teal`;
    const p = e.params.find(x => x.primary);
    return `surface · ${e.words[0]}${p && typeof p.def === 'number' ? ` ${p.key}=${fmt(p.def)}` : ''} color=gold`;
  }
  if (d === 'scene' && e.id.startsWith('scene:warp:')) return `box @${e.words[0]}(${e.params.filter(p => p.primary && typeof p.def === 'number').map(p => fmt(p.def as number)).join(' ')}) · sphere r=0.4`;
  return e.examples[0] ?? e.words[0];
}

function moreOf(d: Dialect, e: Entry, params: HelpParam[]): string {
  if (MORE[e.id]) return MORE[e.id];
  if (d === 'scene' && e.id.startsWith('scene:shape:')) {
    const def = SHAPE_BY_KIND[e.words[0]];
    const dims = def ? shapeDims(def) : null;
    const sz = dims?.vector ? ' Its size is linked: size=0.5 sets the width, height and depth together; width=, height= and depth= set one each.'
      : dims ? ' size=0.5 sets its radius and height together; radius= sets the radius (width= and depth= too), height= the height. The old r= and h= still read.' : '';
    const own = params.filter(p => !['at', 'rot', 'color', 'shine', 'name', 'width', 'height', 'depth'].includes(p.key) && !(dims && !dims.vector && (p.key === 'size' || p.key === 'radius')));
    return `${e.summary}${sz}${own.length ? ` Its own settings: ${own.map(p => p.key).join(', ')}.` : ''} Like every shape it takes at= (where), rot= (turned, degrees), color=, shine=, glass and name=.`;
  }
  if (d === 'scene' && e.id.startsWith('scene:warp:')) return `${e.summary} Written as its own clause it bends the whole scene; after a shape with @ (box @${e.words[0]}(…)) only that shape. Several warps apply in the order written.`;
  return [e.summary, e.hint].filter(Boolean).join(' ');
}

// ── Sections ────────────────────────────────────────────────────────────────

/** The settings an entry takes (a grid preset takes the dialect's shared settings). */
function paramsOf(d: Dialect, e: Entry): ParamSpec[] {
  if (e.params.length || e.kind !== 'header') return e.params;
  return entriesFor(d).find(x => x.id === `${d}:settings`)?.params ?? [];
}

function entryOf(d: Dialect, e: Entry): HelpEntry {
  const ps = paramsOf(d, e);
  const params = ps.map(helpParam);
  const labelled = /^(scene:shape:|scene:warp:|grid:preset:)/.test(e.id) && /:\s/.test(e.summary);
  const title = labelled ? e.summary.split(/:\s/)[0] : (e.words[0][0].toUpperCase() + e.words[0].slice(1)).replace(/-/g, ' ');
  return {
    id: e.id, word: e.kind === 'output' && e.id === 'picture:colour-by' ? 'colour by' : e.words[0], aliases: [...e.words.slice(1), ...Object.keys(e.deprecated ?? {})],
    section: sectionOf(d, e), title, summary: e.summary, more: moreOf(d, e, params), params, flags: e.flags ?? [], example: exampleOf(d, e), signature: signatureOf(e, ps),
  };
}

/** The entries a scene has that the registry doesn't hold as heads: colours, colour by, random. */
function sceneExtras(): HelpEntry[] {
  const colourParam: HelpParam = { key: 'color', aliases: ['colour', 'c'], type: 'colour', hint: 'A name, #rrggbb or (r, g, b) from 0 to 1.', options: [...COLOUR_NAMES] };
  const mk = (id: string, word: string, section: string, title: string, summary: string, params: HelpParam[], example: string, aliases: string[] = []): HelpEntry => ({
    id, word, aliases, section, title, summary, more: MORE[id] ?? summary, params, flags: [], example, signature: [word, ...params.map(p => (p.primary ? `[${p.key}]` : `${p.key}=`))].join(' '),
  });
  return [
    mk('colours:color', 'color', 'colours', 'Colour', 'A shape\'s colour: a name, a hex code or (r, g, b).', [{ ...colourParam, primary: true }], 'surface · sphere color=gold · box at=(1,0,0) color=#3fa7d6', ['colour', 'c']),
    mk('colours:shine', 'shine', 'colours', 'Shine', 'How glossy a shape is: 0 matt … 1 shiny.', [{ key: 'shine', aliases: ['gloss'], type: 'number', range: '0 to 1', hint: '0 matt … 1 glossy.', primary: true }], 'surface · sphere color=red shine=0.8', ['gloss']),
    mk('colours:glass', 'glass', 'colours', 'Glass (a shape)', 'Makes one shape glass, in any mode.', [], 'surface · sphere glass · plane'),
    mk('colours:names', 'colour names', 'colours', 'Colour names', `${COLOUR_NAMES.length} colour words: ${COLOUR_NAMES.slice(0, 8).join(', ')}…`, [{ key: 'name', aliases: [], type: 'colour', hint: 'Any of these words where a colour goes.', options: [...COLOUR_NAMES] }], 'surface · torus color=teal · background navy'),
    mk('scene:colour-by', 'colour by', 'output', 'Colour by', 'Colours the scene by a measurement through a palette.', [
      { key: 'by', aliases: [], type: `one of ${OUTPUTS.filter(o => o.value === 'float').map(o => o.words[0]).join(', ')}`, hint: 'What runs along the palette.', options: OUTPUTS.filter(o => o.show !== 'picture').map(o => o.words[0]), primary: true },
      { key: 'palette', aliases: ['ramp'], type: 'one of a list', hint: 'Which palette.', options: PALETTES.map(p => p.key) },
    ], 'surface · torus · colour by depth palette=sunset', ['color by']),
    mk('colours:palettes', 'palette', 'output', 'Palettes', `${PALETTES.length} palettes: ${PALETTES.slice(0, 6).map(p => p.key).join(', ')}…`, [{ key: 'palette', aliases: ['ramp'], type: 'one of a list', hint: 'Cosine palettes and colour ramps.', options: PALETTES.map(p => p.key), primary: true }], 'surface · sphere · output height palette=sunset', ['ramp']),
    mk('scene:random', 'random', 'settings', 'Random', 'Draw a value (or every unset value) from its interesting range.', [], 'random surface · box · twist'),
    mk('scene:seed', 'seed', 'settings', 'Seed', 'Repeats the random values: the same seed draws the same scene.', [{ key: 'seed', aliases: [], type: 'whole number or a word', hint: 'Any number or word.', primary: true }], 'random surface · torus · seed=42'),
    mk('scene:custom', 'custom', 'shapes', 'Custom shape', 'A shape written as one line of GLSL distance code.', [{ key: 'code', aliases: [], type: 'code (one line of GLSL)', hint: 'The distance from p to the surface.', primary: true }], 'surface · custom(length(p) - 0.5)'),
    mk('scene:custom-warp', 'custom-warp', 'warps', 'Custom warp', 'A warp written as one line of GLSL that changes p.', [{ key: 'code', aliases: [], type: 'code (one line of GLSL)', hint: 'Changes p, the point being measured.', primary: true }], 'surface · box · custom-warp(p.xz *= 1.5)'),
  ];
}

const cache = new Map<string, HelpSection[]>();

/** A dialect's help: its sections in order, each with its entries. Every word of the dialect is in one. */
export function helpSections(d: Dialect): HelpSection[] {
  const hit = cache.get(d);
  if (hit) return hit;
  const raw = d === 'picture' ? [...entriesFor('picture'), ...entriesFor('edit').filter(e => !e.dialects.includes('picture'))] : entriesFor(d);
  const seen = new Set<string>();
  const entries: HelpEntry[] = [];
  for (const e of raw) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    entries.push(entryOf(d, e));
  }
  if (d === 'scene') entries.push(...sceneExtras());
  if (d === 'grid') entries.push({
    id: 'grid:grid', word: 'grid', aliases: [], section: 'types', title: 'Grid', summary: 'Starts a Grid Rules line; needed only where a preset\'s name is also another word (grid swirl, grid ripples).',
    more: 'A line that starts with grid is a Grid Rules line: a rule type or a preset follows, then its settings. Most presets are read without it; write it where the name means something else too (swirl is also a 2D step).',
    params: [], flags: [], example: 'grid swirl board=480', signature: 'grid <preset> key=…',
  });
  const out = (SECTIONS[d] ?? []).map(s => ({ ...s, entries: entries.filter(e => e.section === s.id) })).filter(s => s.entries.length);
  cache.set(d, out);
  return out;
}

/** Every entry of a dialect. */
export const helpEntries = (d: Dialect): HelpEntry[] => helpSections(d).flatMap(s => s.entries);

/** The entry a word names (canonical, alias, old word). */
export function helpEntry(d: Dialect, word: string): HelpEntry | null {
  const w = word.toLowerCase();
  const all = helpEntries(d);
  return all.find(e => e.word === w) ?? all.find(e => e.aliases.includes(w)) ?? null;
}

// ── What is under the pointer ───────────────────────────────────────────────

export interface Alternative { text: string; label?: string; swatch?: [number, number, number] }

export interface HelpAt {
  /** The word's span in the text. */
  from: number;
  to: number;
  word: string;
  /** A head (an entry), a setting's key, or a value. */
  kind: 'entry' | 'param' | 'value';
  entry: HelpEntry;
  param?: HelpParam;
  /** What can go in the word's place: the other words of its section, or the setting's choices. */
  alternatives: Alternative[];
}

const WORD = /[A-Za-z0-9_.#-]/;
const SEP = /[·•|;\n]/;

/** The span of the word at `offset` (letters, digits, -, _, ., #), or null on a space or a bracket. */
export function wordAt(text: string, offset: number): { from: number; to: number } | null {
  if (offset < 0 || offset > text.length) return null;
  let a = offset, b = offset;
  if (!WORD.test(text[a] ?? '') && a > 0 && WORD.test(text[a - 1])) { a--; b--; }
  if (!WORD.test(text[a] ?? '')) return null;
  while (a > 0 && WORD.test(text[a - 1])) a--;
  while (b < text.length && WORD.test(text[b])) b++;
  return { from: a, to: b };
}

/**
 * The head a word at `from` belongs to: back over balanced brackets to the start of its clause, an
 * open bracket or a comma; the first word there (or, right after `name(`, that name).
 */
function headBefore(text: string, from: number): string | null {
  let i = from - 1, depth = 0;
  for (; i >= 0; i--) {
    const ch = text[i];
    if (ch === ')') depth++;
    else if (ch === '(') { if (depth === 0) break; depth--; }
    else if (depth === 0 && (ch === ',' || ch === '@' || SEP.test(ch))) break;
  }
  const seg = text.slice(i + 1, from);
  const first = /^\s*(?:(?:random|grid)\s+)*([A-Za-z][\w-]*)/.exec(seg)?.[1];
  if (first && /[A-Za-z]/.test(first[0])) return first;
  if (text[i] === '(') return /@?([A-Za-z][\w-]*)\s*$/.exec(text.slice(0, i))?.[1] ?? null;
  return null;
}

const swatch = (w: string) => (COLOUR_TABLE as Record<string, [number, number, number]>)[w.toLowerCase()];
const altWords = (ws: readonly string[], not: string): Alternative[] => ws.filter(w => w !== not).map(w => ({ text: w, ...(swatch(w) ? { swatch: swatch(w) } : {}) }));

function paramOfEntry(e: HelpEntry, key: string): HelpParam | undefined {
  const k = key.toLowerCase();
  return e.params.find(p => p.key === key) ?? e.params.find(p => p.key.toLowerCase() === k || p.aliases.includes(k));
}

/** The help for the word at `offset` of a line in dialect `d`: a head, a setting or a value. */
export function helpAt(d: Dialect, text: string, offset: number): HelpAt | null {
  const span = wordAt(text, offset);
  if (!span) return null;
  const word = text.slice(span.from, span.to);
  const after = text.slice(span.to).match(/^\s*(\S)?/)?.[1];
  const beforeM = /([A-Za-z][\w-]*)\s*([*+]?=)\s*$/.exec(text.slice(0, span.from));
  const headWord = headBefore(text, span.from);
  const head = headWord ? helpEntry(d, headWord) : null;
  // `key=`: the setting.
  if (after === '=' && head) {
    const p = paramOfEntry(head, word);
    if (p) return { ...span, word, kind: 'param', entry: head, param: p, alternatives: [] };
  }
  // `key=value`: the value, with its choices.
  if (beforeM && head) {
    const p = paramOfEntry(head, beforeM[1]);
    if (p) return { ...span, word, kind: 'value', entry: head, param: p, alternatives: altWords(p.options ?? [], word) };
  }
  if (/^[\d.#-]/.test(word)) {
    // A bare number after a head: its primary setting.
    const p = head?.params.find(x => x.primary);
    return head && p ? { ...span, word, kind: 'value', entry: head, param: p, alternatives: altWords(p.options ?? [], word) } : null;
  }
  // A flag or a bare choice of the head (`glass` after a shape, `shadows off`, `output depth`).
  const isHead = headWord?.toLowerCase() === word.toLowerCase() && text.slice(0, span.from).trimEnd().slice(-1) !== ',';
  if (head && !isHead) {
    if (head.flags.includes(word.toLowerCase())) {
      const flag = helpEntries(d).find(e => e.section === 'colours' && e.word === word.toLowerCase());
      if (flag) return { ...span, word, kind: 'entry', entry: flag, alternatives: [] };
    }
    const p = head.params.find(x => x.options?.includes(word.toLowerCase()));
    if (p) return { ...span, word, kind: 'value', entry: head, param: p, alternatives: altWords(p.options!, word.toLowerCase()) };
    if (swatch(word)) {
      const cp = head.params.find(x => x.type === 'colour') ?? head.params.find(x => x.primary);
      if (cp) return { ...span, word, kind: 'value', entry: head, param: cp, alternatives: altWords(COLOUR_NAMES, word.toLowerCase()) };
    }
  }
  // `colour by …` is its own head (colour alone is a shape's colour).
  const byNext = /^\s+by\b/i.test(text.slice(span.to)) && /^colou?r$/i.test(word);
  const e = (byNext ? helpEntries(d).find(x => x.word === 'colour by') : null) ?? helpEntry(d, word);
  if (!e) return null;
  const sameSection = helpEntries(d).filter(x => x.section === e.section && x.id !== e.id && !x.word.includes(' ')).map(x => x.word);
  return { ...span, word, kind: 'entry', entry: e, alternatives: altWords(sameSection, e.word) };
}

// ── Hover intent ────────────────────────────────────────────────────────────

/** How long the pointer rests on a word before its help opens. */
export const HOVER_DELAY_MS = 550;
/** How long the help stays after the pointer leaves the word (time to move into it). */
export const HOVER_GRACE_MS = 300;

export interface HoverIntent<T> {
  /** The pointer is over a word (`key` tells words apart). */
  over(key: string, target: T): void;
  /** The pointer left the words. */
  out(): void;
  /** The pointer went into the open help: it stays open. */
  enterPopover(): void;
  leavePopover(): void;
  /** Close now (Escape, a pick, typing). */
  close(): void;
  /** The key of the open help, if any. */
  readonly openKey: string | null;
  dispose(): void;
}

/**
 * When a word's help opens and closes: it opens once the pointer has rested on one word for
 * `delay` (moving to another word starts again), stays while the pointer is on that word or
 * inside the help, and closes `grace` after it leaves both, so the pointer can travel from the
 * word into the help to scroll it or pick something.
 */
export function hoverIntent<T>(opts: { delay?: number; grace?: number; onOpen: (target: T, key: string) => void; onClose: () => void }): HoverIntent<T> {
  const delay = opts.delay ?? HOVER_DELAY_MS, grace = opts.grace ?? HOVER_GRACE_MS;
  let openTimer: ReturnType<typeof setTimeout> | null = null;
  let closeTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingKey: string | null = null;
  let openKey: string | null = null;
  let inPopover = false;
  const clearOpen = () => { if (openTimer) clearTimeout(openTimer); openTimer = null; pendingKey = null; };
  const clearClose = () => { if (closeTimer) clearTimeout(closeTimer); closeTimer = null; };
  const shut = () => { clearClose(); inPopover = false; if (openKey !== null) { openKey = null; opts.onClose(); } };
  const doClose = () => { clearOpen(); shut(); };
  // The grace ends: the open help goes, but a word being rested on still opens.
  const scheduleClose = () => { clearClose(); if (openKey !== null) closeTimer = setTimeout(() => { closeTimer = null; if (!inPopover) shut(); }, grace); };
  return {
    over(key, target) {
      if (key === openKey) { clearClose(); clearOpen(); return; }
      if (key === pendingKey) return;
      clearOpen();
      if (openKey !== null) scheduleClose();
      pendingKey = key;
      openTimer = setTimeout(() => { openTimer = null; pendingKey = null; clearClose(); inPopover = false; openKey = key; opts.onOpen(target, key); }, delay);
    },
    out() { clearOpen(); scheduleClose(); },
    enterPopover() { inPopover = true; clearClose(); clearOpen(); },
    leavePopover() { inPopover = false; scheduleClose(); },
    close: doClose,
    get openKey() { return openKey; },
    dispose() { clearOpen(); clearClose(); },
  };
}

// ── Plain sentences for the Do… bar ─────────────────────────────────────────

const firstSentence = (s: string) => {
  const m = /^(.+?[.!?])(\s|$)/.exec(s.trim());
  return (m ? m[1] : s.trim()).replace(/\.$/, '');
};
const lowerFirst = (s: string) => (/^[A-Z](?![A-Z0-9])/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);
const article = (w: string) => (/^[aeiou]/i.test(w) ? 'an' : 'a');

/**
 * A suggestion as a plain sentence of what taking it will do ("adds a new circle", "wires an output
 * into an input"), for the Do… bar's list.
 */
export function plainSentence(c: { label: string; kind: string; detail: string; group?: string }): string {
  const d = c.detail.trim();
  switch (c.kind) {
    case 'shape':
      if (/^(A|An|The)\s/.test(d)) return `adds ${lowerFirst(firstSentence(d))}`;
      if (d.length > 28) return `adds ${article(c.label)} ${c.label}: ${lowerFirst(firstSentence(d))}`;
      return `adds ${article(c.label)} ${c.label}${d && !d.startsWith('→') && d.toLowerCase() !== c.label ? ` (${d.replace(/^→\s*/, '')})` : d.startsWith('→') ? ` (${d.replace(/^→\s*/, '')})` : ''}`;
    case 'param': {
      if (!d) return `sets ${c.label}`;
      if (!d.toLowerCase().startsWith(c.label.toLowerCase()) || /[\w-]/.test(d[c.label.length] ?? '')) return `sets ${c.label} (${lowerFirst(d)})`;
      const rest = d.slice(c.label.length).trim();
      return `sets ${c.label}${rest ? (rest.startsWith(':') ? rest : ` ${rest}`) : ''}`;
    }
    case 'colour': return `the colour ${c.label}`;
    case 'value': return c.group && d && !/\bhere\b/.test(d) ? `adds ${article(d)} ${d} node` : lowerFirst(firstSentence(d));
    default: return lowerFirst(firstSentence(d));
  }
}
