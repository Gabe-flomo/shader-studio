/**
 * hood.ts — the Agent Builder's "Under the hood" view (docs/agent-builder.md), its pure part: what
 * each state texture's channels hold and how each is coloured, the trail field's channels with what
 * reads and writes them, which channels a builder section uses, and the maps between a texel, a
 * walker's number and a point on the live picture. The GPU side (colour-mapped thumbnails, one
 * walker's read, picking a walker) is lib/agentHoodGpu.ts; the panel is components/agentBuilder/HoodPanel.tsx.
 *
 * The field guide's 2.5 ("Under the hood: walkers live in textures"): each group keeps its walkers
 * in square RGBA32F textures, one texel a walker, walker i at (i mod side, i ÷ side):
 *   2D  A = (pos x, pos y, heading, age)  B = (vel x, vel y, speed, life)
 *   3D  A = (pos x, pos y, pos z, age)    B = (vel x, vel y, vel z, life)  (the heading is the velocity's way)
 *   C = (species, memory x, memory y, own colour packed)  D = its own deposit, one amount a trail channel
 * C and D only when the rule needs per-walker state. Life ≤ 0 is a dead walker (or one not born yet).
 */
import type { AgentRuleSet, ChannelRef } from '../agentRules/spec';

export type Rgb = [number, number, number];
export type HoodTextureId = 'A' | 'B' | 'C' | 'D';
/** How a channel is coloured. */
export type HoodMap = 'gradient' | 'diverge' | 'hue' | 'ramp' | 'soft' | 'life' | 'species' | 'heat' | 'packed' | 'channel';
export type HoodKey =
  | 'posX' | 'posY' | 'posZ' | 'heading' | 'age' | 'velX' | 'velY' | 'velZ' | 'speed' | 'life'
  | 'species' | 'memX' | 'memY' | 'colour' | 'dep0' | 'dep1' | 'dep2' | 'dep3'
  | 'trail0' | 'trail1' | 'trail2' | 'trail3';

export interface HoodChannel {
  key: HoodKey;
  texture: HoodTextureId;
  /** 0–3: R, G, B, A. */
  comp: number;
  label: string;
  map: HoodMap;
  /** The colour map's from–to (heading: 0–2π; species: 0 – kinds − 1). */
  range: [number, number];
  /** The legend's ends, in words ("left", "−1.78"). */
  lo: string;
  hi: string;
  /** Channel / deposit colour (map 'channel'). */
  colour?: Rgb;
  /** One line for the legend's tooltip. */
  note: string;
}

export interface HoodTexture { id: HoodTextureId; title: string; learn: string; channels: HoodChannel[] }

export interface HoodContext {
  d3: boolean;
  /** The group keeps C and D. */
  stateC: boolean;
  /** The picture's width ÷ height (positions run ±aspect across). */
  aspect: number;
  /** Fastest a walker goes, about (the speed ramp's top). */
  speedMax: number;
  /** Seconds a walker lives (0: for ever); the age and life ramps' top. */
  lifeMax: number;
  species: Array<{ name: string; colour: Rgb }>;
  trailColours: Rgb[];
}

/** The trail channels' colours: the builder's Smells / Lays chips (amber, blue, green, violet). */
export const TRAIL_HEX = ['#e8a33a', '#57b6ff', '#7ad38a', '#c792ea'] as const;
export const TRAIL_RGB: Rgb[] = TRAIL_HEX.map(hexRgb);

export function hexRgb(h: string): Rgb {
  const v = parseInt(h.replace('#', ''), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

// ── Colour maps (stops shared by the GLSL and the CSS legends) ──────────────────

/** Piecewise-linear stops of each ramp map (0–1 rgb). */
export const MAP_STOPS: Record<'gradient' | 'ramp' | 'heat' | 'diverge', Rgb[]> = {
  // Position: a cool-to-warm gradient (viridis' stops): left / bottom violet, right / top yellow.
  gradient: ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725'].map(hexRgb),
  // Speed, age, life: a dark-to-bright ramp (inferno's stops).
  ramp: ['#1b0c41', '#4a0c6b', '#932667', '#dd513a', '#fca50a', '#fcffa4'].map(hexRgb),
  // Memory: a heat map, black → red → yellow → white.
  heat: ['#000000', '#7a0000', '#e03b00', '#ffc400', '#ffffff'].map(hexRgb),
  // Velocity: blue going one way, orange the other, dark when still.
  diverge: ['#3b7bff', '#1d3a7a', '#15151c', '#7a3a14', '#ff7a2e'].map(hexRgb),
};

/** A ramp at t (0–1, clamped). */
export function stopsAt(stops: Rgb[], t: number): Rgb {
  const x = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const f = x - i;
  return [0, 1, 2].map(k => stops[i][k] + (stops[i + 1][k] - stops[i][k]) * f) as Rgb;
}

export function hsv(h: number, s: number, v: number): Rgb {
  const f = (n: number) => { const k = (n + h * 6) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return [f(5), f(3), f(1)];
}

const css = (c: Rgb) => `rgb(${c.map(v => Math.round(Math.min(1, Math.max(0, v)) * 255)).join(',')})`;

/** A channel's legend as a CSS background (left = its range's start). */
export function legendCss(ch: HoodChannel, species: Rgb[] = []): string {
  switch (ch.map) {
    case 'gradient': case 'ramp': case 'heat': case 'diverge':
      return `linear-gradient(90deg, ${MAP_STOPS[ch.map].map(css).join(', ')})`;
    case 'soft':
      return `linear-gradient(90deg, ${MAP_STOPS.ramp.map(css).join(', ')})`;
    case 'life':
      return `linear-gradient(90deg, #000 0 10%, ${MAP_STOPS.ramp.map(css).join(', ')})`;
    case 'hue':
      return `linear-gradient(90deg, ${[0, 1, 2, 3, 4, 5, 6].map(i => css(hsv(i / 6, 0.8, 1))).join(', ')})`;
    case 'species': {
      const s = species.length ? species : [[1, 1, 1] as Rgb];
      return `linear-gradient(90deg, ${s.map((c, i) => `${css(c)} ${(i / s.length) * 100}% ${((i + 1) / s.length) * 100}%`).join(', ')})`;
    }
    case 'packed':
      return 'linear-gradient(90deg, #ff4d4d, #ffd84d, #4dff88, #4dc3ff, #b84dff)';
    case 'channel':
      return `linear-gradient(90deg, #000, ${css(ch.colour ?? [1, 1, 1])})`;
  }
}

// ── What each texture holds ──────────────────────────────────────────────────

/** The soft age ramp's scale (s): t = 1 − e^(−age / AGE_SOFT). */
export const AGE_SOFT = 30;

const f2 = (v: number) => String(Math.round(v * 100) / 100).replace('-', '−');

/** The state textures the group has (C and D only with per-walker state), each channel labelled and mapped. */
export function hoodTextures(ctx: HoodContext): HoodTexture[] {
  const a = Math.max(0.1, ctx.aspect);
  const sMax = Math.max(1e-3, ctx.speedMax);
  const ageMax = ctx.lifeMax > 0 ? ctx.lifeMax : 20;
  const ch = (texture: HoodTextureId, comp: number, key: HoodKey, label: string, map: HoodMap, range: [number, number], lo: string, hi: string, note: string, colour?: Rgb): HoodChannel =>
    ({ key, texture, comp, label, map, range, lo, hi, note, ...(colour ? { colour } : {}) });
  const posX = ch('A', 0, 'posX', 'position x', 'gradient', [-a, a], `left ${f2(-a)}`, `right ${f2(a)}`, 'Across the picture, in picture units (−aspect to +aspect).');
  const posY = ch('A', 1, 'posY', 'position y', 'gradient', [-1, 1], 'bottom −1', 'top 1', 'Up the picture, in picture units (−1 to 1).');
  // Walkers that live for ever keep getting older: a soft ramp (half way at AGE_HALF s) never fills up.
  const age = ctx.lifeMax > 0
    ? ch('A', 3, 'age', 'age', 'ramp', [0, ageMax], '0 s', `${f2(ageMax)} s`, 'Seconds since it was born.')
    : ch('A', 3, 'age', 'age', 'soft', [0, AGE_SOFT], '0 s', `older (½ at ${Math.round(AGE_SOFT * Math.LN2)} s)`, 'Seconds since it was born: the colour climbs half way in the first half minute, then ever more slowly.');
  const life = ch('B', 3, 'life', 'life', 'life', [0, ageMax], 'dead', ctx.lifeMax > 0 ? `${f2(ageMax)} s` : 'for ever', 'Seconds it lives (0 or less: dead or not born yet; for ever is drawn green).');
  const vx = ch('B', 0, 'velX', 'velocity x', 'diverge', [-sMax, sMax], `← ${f2(sMax)}`, `${f2(sMax)} →`, 'Its speed across, picture units a second.');
  const vy = ch('B', 1, 'velY', 'velocity y', 'diverge', [-sMax, sMax], `↓ ${f2(sMax)}`, `${f2(sMax)} ↑`, 'Its speed up, picture units a second.');
  const A: HoodChannel[] = ctx.d3
    ? [posX, posY, ch('A', 2, 'posZ', 'position z', 'gradient', [-1, 1], 'back −1', 'front 1', 'Into the box, −1 to 1.'), age]
    : [posX, posY, ch('A', 2, 'heading', 'heading', 'hue', [0, Math.PI * 2], '0°', '360°', 'The way it faces, in radians: one turn round the colour wheel (0° is right, 90° up).'), age];
  const B: HoodChannel[] = ctx.d3
    ? [vx, vy, ch('B', 2, 'velZ', 'velocity z', 'diverge', [-sMax, sMax], `back ${f2(sMax)}`, `front ${f2(sMax)}`, 'Its speed into the box.'), life]
    : [vx, vy, ch('B', 2, 'speed', 'speed', 'ramp', [0, sMax], '0', f2(sMax), 'How fast it goes, picture units a second.'), life];
  const out: HoodTexture[] = [
    { id: 'A', title: ctx.d3 ? 'A · where and how old' : 'A · where, which way, how old', channels: A,
      learn: 'Each pixel is one walker; its four colour channels hold numbers, not colours: where it is, which way it faces, how old it is.' },
    { id: 'B', title: 'B · how it moves, how long it lives', channels: B,
      learn: ctx.d3 ? 'Its velocity in the box, and its life: the heading is the way the velocity points.' : 'Its velocity, its speed, and its life: a walker whose life is 0 or less is dead (black here).' },
  ];
  if (ctx.stateC) {
    const kinds = Math.max(1, ctx.species.length);
    out.push({
      id: 'C', title: 'C · its kind and memory', learn: 'Kept only when the rules need it: which kind it is, two numbers it remembers from step to step, and its own colour packed into one number.',
      channels: [
        ch('C', 0, 'species', 'kind', 'species', [0, kinds - 1], ctx.species[0]?.name ?? 'kind 1', ctx.species[kinds - 1]?.name ?? `kind ${kinds}`, 'Which kind of walker (species), in its chip\'s colour.'),
        ch('C', 1, 'memX', 'memory x', 'heat', [0, 1], '0', '1', 'A number it carries from step to step.'),
        ch('C', 2, 'memY', 'memory y', 'heat', [0, 1], '0', '1', 'The Memory number the rules count with.'),
        ch('C', 3, 'colour', 'own colour', 'packed', [0, 16777215], '8 bits', 'a channel', 'Its own colour, red, green and blue packed 8 bits each into one number.'),
      ],
    });
    out.push({
      id: 'D', title: 'D · what it leaves', learn: 'How much it adds to each of the four trail channels where it lands, every step (times the Deposit\'s Amount).',
      channels: [0, 1, 2, 3].map(i => ch('D', i, `dep${i}` as HoodKey, `deposit ${i + 1}`, 'channel', [0, 1], '0', '1', `What it lays in trail channel ${i + 1}.`, ctx.trailColours[i] ?? TRAIL_RGB[i])),
    });
  }
  return out;
}

// ── The trail field's channels ──────────────────────────────────────────────

export interface HoodTrailChannel { index: number; key: HoodKey; name: string; colour: Rgb; readBy: string[]; writtenBy: string[] }

/** A channel reference's index (its own: the species' channel). */
export function channelIndex(c: ChannelRef | undefined, sp: number): number { return c === undefined || c === 'own' ? Math.min(3, sp) : c; }
const chan = channelIndex;

/**
 * The trail field's four channels: named as the builder names them, in the chips' colours, with the
 * kinds and cards that read them (Senses, an "only when it smells") and write them (Trail / Deposit).
 */
export function hoodTrailChannels(set: AgentRuleSet, o: { velocity?: boolean } = {}): HoodTrailChannel[] {
  const reads: string[][] = [[], [], [], []], writes: string[][] = [[], [], [], []];
  const add = (l: string[][], i: number, s: string) => { if (i >= 0 && i < 4 && !l[i].includes(s)) l[i].push(s); };
  const many = set.species.length > 1;
  set.species.forEach((sp, si) => {
    const who = many ? `${sp.name}: ` : '';
    for (const r of sp.rules) {
      if (r.off) continue;
      for (const c of r.when) {
        if (c.kind === 'sense') add(reads, chan(c.channel, si), `${who}only when it smells`);
        if (c.kind === 'near') add(reads, chan(c.species as ChannelRef, si), `${who}only when near`);
      }
      for (const a of r.do) {
        if (a.kind === 'turn' && a.toward === 'trail') add(reads, chan(a.channel, si), `${who}Senses`);
        if (a.kind === 'align') [0, 1].forEach(i => add(reads, i, `${who}Match the flow`));
        if (a.kind === 'trail') add(writes, chan(a.channel, si), `${who}Trail (Deposit)`);
        if (a.kind === 'spawn') add(writes, 3, `${who}birth marks`);
      }
    }
  });
  const names = o.velocity ? ['velocity x', 'velocity y', 'count', 'channel 4'] : [0, 1, 2, 3].map(i => set.channels[i]?.trim() || `trail ${i + 1}`);
  if (o.velocity) [0, 1, 2].forEach(i => add(writes, i, 'Deposit (velocity)'));
  return [0, 1, 2, 3].map(i => ({ index: i, key: `trail${i}` as HoodKey, name: names[i], colour: TRAIL_RGB[i], readBy: reads[i], writtenBy: writes[i] }));
}

// ── Which channels a section uses ───────────────────────────────────────────

/**
 * The channels a builder section works with, lit in the view: Senses → the trail channels it reads
 * and the heading; Moving → velocity, speed and heading; Born / Life → age and life; a kind chip →
 * the kind (species); and so on. In 3D the heading and speed are the velocity.
 */
export function hoodHighlights(section: string | null, o: { d3: boolean; kindPicked?: boolean; reads?: number[]; writes?: number[] }): Set<HoodKey> {
  const k = new Set<HoodKey>();
  const trails = (l: number[] | undefined) => (l ?? []).forEach(i => k.add(`trail${i}` as HoodKey));
  const heading = () => (o.d3 ? ['velX', 'velY', 'velZ'] as HoodKey[] : ['heading'] as HoodKey[]).forEach(x => k.add(x));
  const velocity = () => (['velX', 'velY', ...(o.d3 ? ['velZ'] : ['speed'])] as HoodKey[]).forEach(x => k.add(x));
  const position = () => (['posX', 'posY', ...(o.d3 ? ['posZ'] : [])] as HoodKey[]).forEach(x => k.add(x));
  switch (section) {
    case 'born': position(); k.add('age'); k.add('life'); break;
    case 'life': k.add('age'); k.add('life'); break;
    case 'senses': heading(); trails(o.reads); break;
    case 'turning': case 'steering': heading(); break;
    case 'moving': case 'forces': velocity(); heading(); break;
    case 'trail': trails(o.writes); (['dep0', 'dep1', 'dep2', 'dep3'] as HoodKey[]).forEach(x => k.add(x)); break;
    case 'neighbours': position(); velocity(); break;
    case 'orbit': position(); heading(); break;
    case 'look': k.add('species'); k.add('colour'); k.add('age'); break;
  }
  if (o.kindPicked) k.add('species');
  return k;
}

// ── Texel ↔ walker ↔ picture ────────────────────────────────────────────────

/** Walker i sits at texel (i mod side, i ÷ side). */
export function texelOf(i: number, side: number): { x: number; y: number } {
  return { x: i % side, y: Math.floor(i / side) };
}
export function indexOf(x: number, y: number, side: number): number { return y * side + x; }
/** The texel under a point of a tile, (u, v) 0–1 from its top left (texel row 0 is the top row). */
export function texelAt(u: number, v: number, side: number): { x: number; y: number } {
  const c = (t: number) => Math.min(side - 1, Math.max(0, Math.floor(t * side)));
  return { x: c(u), y: c(v) };
}
/** A texel's centre in a tile, 0–1 from its top left. */
export function texelCentre(x: number, y: number, side: number): { u: number; v: number } {
  return { u: (x + 0.5) / side, v: (y + 0.5) / side };
}
/** A tile pixel's texel (the thumbnail samples one walker a pixel, at the pixel's centre). */
export function tileSample(px: number, py: number, tile: number, side: number): { x: number; y: number } {
  return { x: Math.floor((px + 0.5) * side / tile), y: Math.floor((py + 0.5) * side / tile) };
}

export interface Rect { x: number; y: number; w: number; h: number }
/** Clip space (the picture, −1…1 both ways, y up) → a point on the shown picture. */
export function ndcToView(r: Rect, ndc: { x: number; y: number }): { x: number; y: number } {
  return { x: r.x + (ndc.x * 0.5 + 0.5) * r.w, y: r.y + (0.5 - ndc.y * 0.5) * r.h };
}
export function viewToNdc(r: Rect, p: { x: number; y: number }): { x: number; y: number } {
  return { x: ((p.x - r.x) / Math.max(1, r.w)) * 2 - 1, y: 1 - ((p.y - r.y) / Math.max(1, r.h)) * 2 };
}
/** A 2D walker's position (picture units: x ±aspect, y ±1) in clip space, as Draw agents puts it. */
export function positionToNdc(p: { x: number; y: number }, aspect: number): { x: number; y: number } {
  return { x: p.x / Math.max(1e-6, aspect), y: p.y };
}

// ── The thumbnails' atlas ───────────────────────────────────────────────────

/** A thumbnail's side in pixels (it samples every side ÷ HOOD_TILE-th walker each way). */
export const HOOD_TILE = 128;

export interface HoodTile { key: HoodKey; x: number; y: number; w: number; h: number }
export interface HoodAtlas { W: number; H: number; tile: number; tiles: HoodTile[] }

/**
 * Where each thumbnail sits in the one texture the GPU draws and reads back (top-left origin):
 * a row a state texture (its R, G, B, A across), then the trail channels in the picture's shape.
 */
export function hoodAtlas(textures: HoodTexture[], trails: number, aspect: number, tile = HOOD_TILE): HoodAtlas {
  const tiles: HoodTile[] = [];
  textures.forEach((t, row) => t.channels.forEach((c, col) => tiles.push({ key: c.key, x: col * tile, y: row * tile, w: tile, h: tile })));
  // The trail in the picture's shape, fitted in a tile.
  const f = trailFit(aspect, tile);
  const th = f.h;
  for (let i = 0; i < trails; i++) tiles.push({ key: `trail${i}` as HoodKey, x: i * tile, y: textures.length * tile, w: f.w, h: f.h });
  return { W: 4 * tile, H: textures.length * tile + (trails ? th : 0), tile, tiles };
}

/** A picture of `aspect` fitted in a `size` square. */
export function trailFit(aspect: number, size: number): { w: number; h: number } {
  const a = Math.max(0.25, Math.min(4, aspect || 1));
  return a >= 1 ? { w: size, h: Math.max(8, Math.round(size / a)) } : { w: Math.max(8, Math.round(size * a)), h: size };
}

/** The map's number in the shader. */
export const MAP_ID: Record<HoodMap, number> = { gradient: 0, diverge: 1, hue: 2, ramp: 3, life: 4, species: 5, heat: 6, packed: 7, channel: 8, soft: 9 };

// ── One walker's numbers ────────────────────────────────────────────────────

export interface HoodReadout {
  index: number;
  texel: { x: number; y: number };
  alive: boolean;
  pos: number[];
  /** Degrees, 0–360 (in 3D: the velocity's direction across the picture). */
  heading: number;
  speed: number;
  age: number;
  /** Seconds (Infinity: for ever; ≤ 0: dead). */
  life: number;
  species: number;
  memory?: [number, number];
  deposit?: number[];
  /** Where it is on the picture (clip space), and whether it is in front of the camera. */
  ndc: { x: number; y: number } | null;
}

/**
 * The probe's read (lib/agentHoodGpu.ts): 5 texels × 4 floats: A, B, C, D at the walker's texel,
 * then where it lands on the picture (clip x, y, 1 when seen, depth).
 */
export function decodeProbe(f: ArrayLike<number>, o: { index: number; side: number; d3: boolean; stateC: boolean; species: number }): HoodReadout {
  const A = [f[0], f[1], f[2], f[3]], B = [f[4], f[5], f[6], f[7]];
  const C = [f[8], f[9], f[10], f[11]], D = [f[12], f[13], f[14], f[15]];
  const heading = o.d3 ? Math.atan2(B[1], B[0]) : A[2];
  const wrapDeg = (r: number) => ((r * 180 / Math.PI) % 360 + 360) % 360;
  const life = B[3] > 1e20 ? Infinity : B[3];
  return {
    index: o.index,
    texel: texelOf(o.index, o.side),
    alive: B[3] > 0,
    pos: o.d3 ? A.slice(0, 3) : A.slice(0, 2),
    heading: wrapDeg(heading),
    speed: o.d3 ? Math.hypot(B[0], B[1], B[2]) : B[2],
    age: A[3],
    life,
    species: o.stateC ? Math.round(C[0]) : o.index % Math.max(1, o.species),
    ...(o.stateC ? { memory: [C[1], C[2]] as [number, number], deposit: D } : {}),
    ndc: f[18] > 0.5 ? { x: f[16], y: f[17] } : null,
  };
}

/** The readout's lines: [label, value]. */
export function readoutLines(r: HoodReadout, speciesNames: string[] = []): Array<[string, string]> {
  const n = (v: number, d = 3) => (Number.isFinite(v) ? String(Math.round(v * 10 ** d) / 10 ** d) : '∞');
  const lines: Array<[string, string]> = [
    ['walker', `no. ${r.index}`],
    ['texel', `${r.texel.x}, ${r.texel.y}`],
    ['position', r.pos.map(v => n(v)).join(', ')],
    ['heading', `${Math.round(r.heading)}°`],
    ['speed', n(r.speed)],
    ['age', `${n(r.age, 2)} s`],
    ['life', !r.alive ? 'dead' : r.life === Infinity ? 'for ever' : `${n(r.life, 2)} s`],
    ['kind', speciesNames[r.species] ?? `kind ${r.species + 1}`],
  ];
  if (r.memory) lines.push(['memory', `${n(r.memory[0])}, ${n(r.memory[1])}`]);
  if (r.deposit) lines.push(['deposit', r.deposit.map(v => n(v, 2)).join(' · ')]);
  return lines;
}

/** The trail thumbnails' brightness: 1 − e^(−gain · amount). */
export const HOOD_TRAIL_GAIN = 0.15;

/** What the GPU draws for each thumbnail of hoodAtlas (in its order): source texture, channel, map, range, colour. */
export function hoodTileSpecs(textures: HoodTexture[], trails: HoodTrailChannel[]): Array<{ source: number; comp: number; map: number; lo: number; hi: number; colour: Rgb }> {
  const src: Record<HoodTextureId, number> = { A: 0, B: 1, C: 2, D: 3 };
  return [
    ...textures.flatMap(t => t.channels.map(c => ({ source: src[c.texture], comp: c.comp, map: MAP_ID[c.map], lo: c.range[0], hi: c.range[1], colour: c.colour ?? [1, 1, 1] as Rgb }))),
    ...trails.map(t => ({ source: 4, comp: t.index, map: MAP_ID.channel, lo: 0, hi: HOOD_TRAIL_GAIN, colour: t.colour })),
  ];
}
