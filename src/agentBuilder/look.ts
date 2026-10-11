/**
 * look.ts — the Agent Builder's Look section for every kind (docs/agent-builder.md "Look"). Pure.
 *
 * How walkers and trails are drawn, mapped onto the nodes that draw them:
 *  - drawn as dots / glow / streaks / ink, size and brightness: Draw agents' Style, Size, Brightness;
 *  - colour by kind, speed, age, heading or one colour: Draw agents' Colour by (kind: the rules'
 *    state colours, Colour by State);
 *  - colour by a trail channel: the rules colour each walker (spec `look`, Finish's colour) and
 *    Draw agents reads it (Colour by Agent); by a memory: phase 4's `colourBy`, the same way;
 *  - the palette: Draw agents' Palette (or Colour A → B);
 *  - the trail's palette: the Stops Palette that shows the trail;
 *  - in 3D the camera: Draw agents' camera (space3d CAMERA_CONTROLS).
 */
import type { GraphNode } from '../types/nodeGraph';
import type { AgentRuleSet, WalkerKind } from '../agentRules/spec';
import { GP_PALETTES } from '../play/kit/gpuParticles.js';
import { channelSwatches } from './trailChannels';
import type { LegendEntry } from './legend';
import { NOUNS } from './legend';

export type ColourBy = 'kind' | 'speed' | 'age' | 'heading' | 'single' | 'trail' | 'memory' | 'own';

export const COLOUR_BY: ReadonlyArray<{ value: ColourBy; label: string; hint: string }> = [
  { value: 'kind', label: 'Kind', hint: 'Each in its kind\'s colour (and its state\'s, when it has states).' },
  { value: 'speed', label: 'Speed', hint: 'Slow at the palette\'s start, fast at its end.' },
  { value: 'age', label: 'Age', hint: 'Newborn at the palette\'s start, old at its end (a share of its life).' },
  { value: 'heading', label: 'Heading', hint: 'Which way it goes, round the palette.' },
  { value: 'single', label: 'One colour', hint: 'All the palette\'s first colour.' },
  { value: 'trail', label: 'A trail', hint: 'How much of a trail channel is where it stands: dim kind colour → the channel\'s colour.' },
  { value: 'memory', label: 'A memory', hint: 'A named memory on a heat map (Memory section).' },
  { value: 'own', label: 'Its own', hint: 'The colour it was born with: a splat scan\'s colours (Born: from a splat scan), kept for its whole life.' },
];

export const STYLES = [{ value: 'points' as const, label: 'Dots' }, { value: 'glow' as const, label: 'Glow' }, { value: 'streaks' as const, label: 'Streaks' }, { value: 'ink' as const, label: 'Ink' }, { value: 'splats' as const, label: 'Splats' }];

/** What the walkers are coloured by now. */
export function colourByOf(set: AgentRuleSet, draw: GraphNode | undefined): ColourBy {
  if (set.colourBy) return 'memory';
  if (set.look?.by === 'trail') return 'trail';
  if (set.look?.by === 'birth') return 'own';
  const c = String(draw?.params.colorBy ?? 'state');
  if (c === 'speed' || c === 'speedFast') return 'speed';
  if (c === 'heading' || c === 'headingRound') return 'heading';
  if (c === 'age') return 'age';
  if (c === 'single') return 'single';
  return 'kind';
}

/** Draw agents' Colour by for a choice (kind, a trail or a memory: the walker's own colour). */
export function drawColourBy(c: ColourBy, was: unknown): string {
  switch (c) {
    case 'speed': return was === 'speedFast' ? 'speedFast' : 'speed';
    case 'heading': return was === 'headingRound' ? 'headingRound' : 'heading';
    case 'age': return 'age';
    case 'single': return 'single';
    case 'kind': return 'state';
    default: return 'agent';
  }
}

/** The rule set for a choice: a trail colour kept or made; a memory's kept; else neither. */
export function setColourBy(set: AgentRuleSet, c: ColourBy): AgentRuleSet {
  const { look: _l, colourBy: _m, ...rest } = set;
  if (c === 'trail') return { ...rest, look: set.look ?? { by: 'trail', channel: (channelSwatches(set)[0]?.index ?? 0) as 0 | 1 | 2 | 3, gain: 1 } };
  if (c === 'memory') return set.colourBy ? set : rest as AgentRuleSet;
  if (c === 'own') return set.look?.by === 'birth' ? set : { ...rest, look: { by: 'birth' } };
  return rest as AgentRuleSet;
}

const hex = (c: number[]) => `#${c.map(v => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('')}`;
/** Draw agents' palette as CSS colours, start to end. */
export function paletteColours(draw: GraphNode | undefined): string[] {
  const p = String(draw?.params.palette ?? 'ab');
  if (p === 'ab') return [hex((draw?.params.colorA as number[]) ?? [1, 0.75, 0.35]), hex((draw?.params.colorB as number[]) ?? [0.25, 0.55, 1])];
  const stops = (GP_PALETTES as Record<string, number[][] | null>)[p];
  return stops ? stops.map(hex) : ['#ff4d4d', '#ffd84d', '#4dff88', '#4dc3ff', '#b84dff'];
}

/** Ready-made trail palettes (a Stops Palette's colours, dark to bright). */
export const TRAIL_PALETTES: ReadonlyArray<{ key: string; label: string; stops: Array<[number, number, number]> }> = [
  { key: 'amber', label: 'Amber', stops: [[0, 0, 0], [0.16, 0.05, 0.01], [0.75, 0.38, 0.05], [1, 0.82, 0.32], [1, 0.98, 0.85]] },
  { key: 'ice', label: 'Ice', stops: [[0, 0, 0], [0.02, 0.06, 0.18], [0.12, 0.35, 0.8], [0.5, 0.82, 1], [0.95, 1, 1]] },
  { key: 'toxic', label: 'Toxic', stops: [[0, 0, 0], [0.03, 0.12, 0.04], [0.15, 0.6, 0.2], [0.65, 1, 0.3], [1, 1, 0.85]] },
  { key: 'rose', label: 'Rose', stops: [[0, 0, 0], [0.18, 0.02, 0.1], [0.75, 0.15, 0.4], [1, 0.6, 0.7], [1, 0.95, 0.95]] },
  { key: 'mono', label: 'Mono', stops: [[0, 0, 0], [0.12, 0.12, 0.13], [0.45, 0.45, 0.48], [0.8, 0.8, 0.82], [1, 1, 1]] },
];

/** A Stops Palette's colours (its `stops` count of color0…). */
export function stopsOf(pal: GraphNode | undefined): Array<[number, number, number]> {
  if (!pal) return [];
  const k = Math.max(2, Math.min(8, Number(pal.params.stops) || 0));
  return Array.from({ length: k }, (_, i) => (pal.params[`color${i}`] as [number, number, number] | undefined) ?? [i / (k - 1), i / (k - 1), i / (k - 1)]);
}
export const cssOf = hex;

const n2 = (v: number) => String(Math.round(v * 100) / 100);

/** The Look legend: how they are drawn and what the colour says, worded from the values. */
export function lookEntries(o: { set: AgentRuleSet; kind: WalkerKind; draw?: GraphNode; d3: boolean; trailStops?: string[] }): LegendEntry[] {
  const n = NOUNS[o.kind];
  const out: LegendEntry[] = [];
  const d = o.draw;
  const by = colourByOf(o.set, d);
  const pal = paletteColours(d);
  if (d) {
    const style = String(d.params.style ?? 'points');
    const size = Number(d.params.size ?? 1.5);
    const what = style === 'glow' ? 'a dot with a soft glow' : style === 'streaks' ? 'a short streak along its motion' : style === 'ink' ? 'dark ink on paper' : 'a soft dot';
    if (style === 'splats') {
      const ss = Number(d.params.splatSize ?? 0.012), st = Number(d.params.stretch ?? 1.5);
      const by2 = String(d.params.sizeBy ?? 'fixed');
      const sized = by2 === 'speed' ? ', bigger the faster it goes' : by2.startsWith('mem') ? `, as big as its memory ${by2.slice(3).toLowerCase()} × ${n2(Number(d.params.memScale ?? 1))}` : '';
      out.push({ id: 'look:style', title: 'Drawn as', colour: pal[pal.length - 1] ?? '#ffffff', numbers: `splats · ${n2(ss)}`, on: true, el: 'look', settings: ['style', 'splatSize', 'stretch', 'opacity'],
        line: `Each ${n.one} is a soft Gaussian splat ${n2(ss)} wide${sized}, ${n2(1 + st)} times as long along its motion at full speed, covering ${Math.round(Number(d.params.opacity ?? 0.6) * 100)}% at its middle: where many overlap they read as a volume.`,
        words: `Each ${n.one} is a soft Gaussian splat${sized ? sized.replace(/ × [^,]*$/, '') : ''}, stretched along its motion: where many overlap they read as a volume.`, demo: { kind: 'look', style, colourBy: by, colours: pal } });
    } else out.push({ id: 'look:style', title: 'Drawn as', colour: pal[pal.length - 1] ?? '#ffffff', numbers: `${style} · ${n2(size)} px`, on: true, el: 'look', settings: ['style', 'dsize', 'brightness'],
      line: `Each ${n.one} is ${what}, ${n2(size)} pixels across, at brightness ${n2(Number(d.params.brightness ?? 0.5))}.`, words: `Each ${n.one} is ${what}, this many pixels across.`, demo: { kind: 'look', style, colourBy: by, colours: pal } });
    const say: Record<ColourBy, string> = {
      kind: `each ${n.one} in its kind's colour${o.set.species.some(s => s.states.length > 1) ? ' (its state\'s, when it changes state)' : ''}`,
      speed: `slow ${n.many} at the palette's start, fast ones at its end (fast is ${n2(Number(d.params.speedRef ?? 0.5))} a second)`,
      age: `newborn ${n.many} at the palette's start, old ones at its end`,
      heading: `the way each goes picks its colour round the palette`,
      single: `every ${n.one} the palette's first colour`,
      own: `each ${n.one} in the colour it was born with (a splat scan's own colours)`,
      trail: o.set.look?.by === 'trail' ? `dim where there is no ${channelSwatches(o.set).find(c => c.index === (o.set.look as { channel: number }).channel)?.label ?? 'trail'}, bright ${channelSwatches(o.set).find(c => c.index === (o.set.look as { channel: number }).channel)?.word ?? ''} where there is plenty (× ${n2((o.set.look as { gain: number }).gain)})` : 'by a trail',
      memory: o.set.colourBy ? `by its memory on a heat map: black at ${n2(o.set.colourBy.lo)}, white at ${n2(o.set.colourBy.hi)}` : 'by a memory',
    };
    out.push({ id: 'look:colour', title: `Colour by ${COLOUR_BY.find(c => c.value === by)!.label.toLowerCase()}`, colour: pal[0] ?? '#ffffff', numbers: by === 'kind' || by === 'trail' || by === 'memory' || by === 'own' ? by : String(d.params.palette ?? 'ab'),
      on: true, el: 'look', settings: ['colourBy', 'palette'], line: `Colour: ${say[by]}.`, words: `${say[by].charAt(0).toUpperCase()}${say[by].slice(1)}.`, demo: { kind: 'look', style: String(d.params.style ?? 'points'), colourBy: by, colours: pal } });
  }
  if (o.trailStops?.length) {
    out.push({ id: 'look:trail', title: 'The trail\'s palette', colour: o.trailStops[Math.floor(o.trailStops.length * 0.7)] ?? '#e8a33a', numbers: `${o.trailStops.length} colours`, on: true, el: 'trailLook', settings: ['trailPalette'],
      line: `The trail is drawn from ${o.trailStops.length > 2 ? 'black where there is none' : 'its first colour'} to its last where it is thickest.`,
      words: `Drawn from ${o.trailStops.length > 2 ? 'black where there is none' : 'its first colour'} to its last where it is thickest.`, demo: { kind: 'look', style: 'trail', colourBy: 'single', colours: o.trailStops } });
  }
  if (o.d3 && d) out.push({ id: 'look:camera', title: 'Camera', colour: '#8aa8ff', numbers: `${n2(Number(d.params.camDist ?? 3.8))} away · ${n2(Number(d.params.rotSpeed ?? 0))}°/s`, on: true, el: 'camera', settings: ['camDist', 'camAngle', 'camElevation', 'rotSpeed', 'fov'],
    line: `Seen from ${n2(Number(d.params.camDist ?? 3.8))} away, ${n2(Number(d.params.camElevation ?? 15))}° above, circling at ${n2(Number(d.params.rotSpeed ?? 0))}° a second.`, words: 'How far away the camera is, and how fast it circles the walkers.', demo: { kind: 'look', style: 'camera', colourBy: by, colours: pal } });
  return out;
}
