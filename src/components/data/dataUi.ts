/** Small helpers the Data editor's panels share (kept out of the component files for fast refresh). */
import type { Tokens } from '../../theme/tokens';
import type { Column, StreamTransport } from '../../data/types';
import type { DataOutputSpec } from '../../nodes/definitions/data';

/** The dot colour for a column type. */
export function typeColour(tk: Tokens, type: Column['type']): string {
  return type === 'number' ? tk.accent.base : type === 'category' ? tk.kind.expr : tk.text.faint;
}

/** Column groups worth offering from the names alone: x, y (and z); r, g, b; lon, lat. */
export function suggestGroups(columns: readonly Column[]): string[][] {
  const num = new Map(columns.filter(c => c.type === 'number').map(c => [c.name.toLowerCase(), c.name]));
  const out: string[][] = [];
  const tryGroup = (names: string[]) => { const got = names.map(n => num.get(n)); if (got.every(Boolean)) out.push(got as string[]); };
  tryGroup(['x', 'y', 'z']);
  if (!out.length) tryGroup(['x', 'y']);
  tryGroup(['r', 'g', 'b']);
  tryGroup(['red', 'green', 'blue']);
  tryGroup(['lon', 'lat']);
  tryGroup(['longitude', 'latitude']);
  return out;
}

/** The outputs a new Data node starts with: a suggested group, else the first number column. */
export function defaultOutputs(columns: readonly Column[]): DataOutputSpec[] {
  const g = suggestGroups(columns)[0];
  if (g) return [{ key: 'o1', columns: g }];
  const first = columns.find(c => c.type === 'number');
  return first ? [{ key: 'o1', columns: [first.name] }] : [];
}

/** A stream's ways in, as the editor lists them. */
export const TRANSPORTS: { value: StreamTransport; label: string; what: string }[] = [
  { value: 'poll', label: 'Poll a URL', what: 'Fetch a link every few seconds (JSON or CSV).' },
  { value: 'websocket', label: 'WebSocket', what: 'Messages pushed over ws:// or wss://.' },
  { value: 'sse', label: 'Server-Sent Events', what: 'An event stream (text/event-stream).' },
  { value: 'osc', label: 'OSC', what: 'Messages from TouchOSC, Max, Ableton… through the OSC listener.' },
  { value: 'demo', label: 'Demo stream', what: 'Rows made up in the app, no network: for trying things out.' },
];
