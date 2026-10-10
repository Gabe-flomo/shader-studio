/**
 * trailChannels.ts — the trail's channels as named colour swatches (docs/agent-builder.md "Trail
 * channels"). Pure.
 *
 * A trail field has four channels. In the builder each is a swatch with a name you give it and a
 * colour ("food · yellow"), never a free text box of a channel number: the Smells and Lays chips,
 * the viewport's tint and Under the hood all use the same names and colours. A channel is shown
 * when it is named, read or written, or is a kind's own; up to four. The names are the rule set's
 * `channels`, the colours its `channelColours`.
 */
import { type AgentRuleSet, type ChannelRef, TRAIL_COLOURS, channelColour } from '../agentRules/spec';
import { hoodTrailChannels } from './hood';

/** The colours a channel can take, each with its word. */
export const CHANNEL_PALETTE: ReadonlyArray<{ hex: string; word: string }> = [
  { hex: '#e8a33a', word: 'amber' }, { hex: '#57b6ff', word: 'blue' }, { hex: '#7ad38a', word: 'green' }, { hex: '#c792ea', word: 'violet' },
  { hex: '#f2d14b', word: 'yellow' }, { hex: '#ff6b6b', word: 'red' }, { hex: '#5fe0e0', word: 'cyan' }, { hex: '#ff8ad8', word: 'pink' },
  { hex: '#ff9a3c', word: 'orange' }, { hex: '#e8e8ee', word: 'white' },
];

const rgbOf = (h: string) => { const v = parseInt(h.slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };
/** A colour's word: the nearest of the palette's. */
export function colourWord(hex: string): string {
  const [r, g, b] = rgbOf(hex);
  let best = CHANNEL_PALETTE[0], d = Infinity;
  for (const p of CHANNEL_PALETTE) { const [R, G, B] = rgbOf(p.hex); const e = (R - r) ** 2 + (G - g) ** 2 + (B - b) ** 2; if (e < d) { d = e; best = p; } }
  return best.word;
}

export interface ChannelSwatch {
  index: number;
  /** Its name ('' when not named: shown as "trail 2"). */
  name: string;
  label: string;
  colour: string;
  word: string;
  /** The kinds whose own channel it is ("its trail" for them). */
  ownOf: string[];
  readBy: string[];
  writtenBy: string[];
}

/** Every channel in use (named, read, written, or a kind's own), in order. */
export function channelSwatches(set: AgentRuleSet, o: { velocity?: boolean } = {}): ChannelSwatch[] {
  const users = hoodTrailChannels(set, o);
  return [0, 1, 2, 3].map(i => {
    const name = set.channels[i]?.trim() ?? '';
    const colour = channelColour(set, i);
    const ownOf = set.species.map((s, k) => (k === i ? s.name : '')).filter(Boolean);
    return { index: i, name, label: name || (ownOf.length ? `${ownOf[0]}'s trail` : `trail ${i + 1}`), colour, word: colourWord(colour), ownOf, readBy: users[i].readBy, writtenBy: users[i].writtenBy };
  }).filter(c => c.name || c.readBy.length || c.writtenBy.length || c.ownOf.length);
}

/** The Smells / Lays chips: "its trail · amber", then each channel shown, "food · yellow". */
export function channelChips(set: AgentRuleSet, sp: number): Array<{ value: ChannelRef; label: string; dot: string }> {
  const own = Math.min(3, sp);
  return [
    { value: 'own' as ChannelRef, label: `its trail${set.channels[own]?.trim() ? ` (${set.channels[own].trim()})` : ''} · ${colourWord(channelColour(set, own))}`, dot: channelColour(set, own) },
    // Its own channel is "its trail" already (with one kind, the same channel: shown once).
    ...channelSwatches(set).filter(c => c.index !== own || (c.name && set.species.length > 1)).map(c => ({ value: c.index as ChannelRef, label: `${c.label} · ${c.word}`, dot: c.colour })),
  ];
}

/** A channel renamed (blank: unnamed). */
export function renameChannel(set: AgentRuleSet, i: number, name: string): AgentRuleSet {
  const channels = [0, 1, 2, 3].map(k => (k === i ? name.trim().slice(0, 24) : set.channels[k] ?? ''));
  return { ...set, channels };
}
/** A channel's colour. */
export function recolourChannel(set: AgentRuleSet, i: number, hex: string): AgentRuleSet {
  const channelColours = [0, 1, 2, 3].map(k => (k === i ? hex : set.channelColours?.[k] ?? TRAIL_COLOURS[k]));
  return { ...set, channelColours };
}
/** The next channel nobody uses, named (null: all four are in use). */
export function addChannel(set: AgentRuleSet, name?: string): { set: AgentRuleSet; index: number } | null {
  const shown = new Set(channelSwatches(set).map(c => c.index));
  const i = [0, 1, 2, 3].find(k => !shown.has(k));
  if (i === undefined) return null;
  const taken = new Set(set.channels.map(c => c.trim()));
  return { set: renameChannel(set, i, name ?? ['food', 'home', 'danger', 'path'].find(w => !taken.has(w)) ?? `trail ${i + 1}`), index: i };
}

/**
 * What Fades and Spreads do to a line of trail, in the trail field's own steps (60 a second): its
 * profile across, now and after each of `at` seconds (each 0–1 of the first one's peak). One step
 * blends each cell toward its neighbours' mean by Diffuse, then halves it every Half-life seconds.
 */
export function fadeStrip(halfLife: number, diffuse: number, at: readonly number[] = [0, 0.25, 1], cells = 33): number[][] {
  let v: number[] = Array.from({ length: cells }, (_, i) => (i === (cells >> 1) ? 1 : 0));
  const out: number[][] = [];
  const hl = Math.max(halfLife, 1e-3), d = Math.min(1, Math.max(0, diffuse));
  const decay = Math.pow(0.5, 1 / 60 / hl);
  let t = 0;
  for (const want of at) {
    while (t < want - 1e-9) {
      v = v.map((x, i) => { const m = (v[Math.max(0, i - 1)] + x + v[Math.min(cells - 1, i + 1)]) / 3; return (x + (m - x) * d) * decay; });
      t += 1 / 60;
    }
    out.push(v.slice());
  }
  return out;
}
