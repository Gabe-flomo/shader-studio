/**
 * connectDefaults.ts — what a connection does when nothing else is said
 * (implementation guide 6.4): the likely route, input or reaction for
 * connecting something of one type to something of another, with the words
 * that say what it did. Pure; tested as a table.
 *
 * Types: a number (0..1), a boolean (a level: a key, a gate, a gesture), a
 * position, a signal, and a signal carrying a captured value.
 */

export type ConnectFrom = 'number' | 'boolean' | 'position' | 'signal' | 'signalValue';
export type ConnectTo = 'slider' | 'button' | 'when' | 'do';

/** What a source kind is like, for the When question's default threshold. */
export type SourceFlavour = 'pinch' | 'audio' | 'other';

export type Connection =
  /** A route onto a slider: Add swings `swing` of the range around it; Replace sets it. */
  | { kind: 'route'; mode: 'add' | 'replace'; swing?: number; glideMs?: number; axis?: 'pick' }
  /** Fire a button: on the rise of a level, or as a number crosses `threshold` upward. */
  | { kind: 'fire'; on: 'rise' | 'crossUp'; threshold?: number }
  /** A signal input: a question about a number (below or above, in % of its range), mirroring a level, or a region test. */
  | { kind: 'question'; cmp: 'above' | 'below'; threshold: number; exit: number }
  | { kind: 'mirror'; payload?: boolean }
  | { kind: 'region' }
  /** A reaction on the signal's rise, or a Set from its captured value (or the position it captures). */
  | { kind: 'reaction' }
  | { kind: 'set' }
  /** Nothing sensible: the caller offers the choice instead. */
  | { kind: 'none' };

export function connectDefaults(from: ConnectFrom, to: ConnectTo, flavour: SourceFlavour = 'other'): Connection {
  switch (to) {
    case 'slider':
      if (from === 'number') return { kind: 'route', mode: 'add', swing: 0.5 };
      if (from === 'position') return { kind: 'route', mode: 'replace', axis: 'pick' };
      if (from === 'signalValue') return { kind: 'set' };
      return { kind: 'route', mode: 'replace', glideMs: 120 };
    case 'button':
      if (from === 'number') return { kind: 'fire', on: 'crossUp', threshold: 0.5 };
      if (from === 'position') return { kind: 'none' };
      return { kind: 'fire', on: 'rise' };
    case 'when':
      if (from === 'number') {
        if (flavour === 'pinch') return { kind: 'question', cmp: 'below', threshold: 0.2, exit: 0.3 };
        if (flavour === 'audio') return { kind: 'question', cmp: 'above', threshold: 0.6, exit: 0.5 };
        return { kind: 'question', cmp: 'above', threshold: 0.5, exit: 0.45 };
      }
      if (from === 'position') return { kind: 'region' };
      if (from === 'signalValue') return { kind: 'mirror', payload: true };
      return { kind: 'mirror' };
    case 'do':
      if (from === 'signal') return { kind: 'reaction' };
      if (from === 'signalValue' || from === 'position') return { kind: 'set' };
      return { kind: 'none' };
  }
}

/** What a connection did, in plain words: "Pinch now drives Radius, adding up to 50% of its range". */
export function describeConnection(c: Connection, from: string, to: string): string {
  switch (c.kind) {
    case 'route':
      if (c.axis) return `${from} now moves ${to} (pick X or Y)`;
      return c.mode === 'add'
        ? `${from} now drives ${to}, adding up to ${Math.round((c.swing ?? 1) * 100)}% of its range`
        : `${from} now sets ${to}: off at its low end, on at its high end`;
    case 'fire': return c.on === 'rise' ? `${to} fires each time ${from} starts` : `${to} fires as ${from} crosses ${Math.round((c.threshold ?? 0.5) * 100)}%`;
    case 'question': return `${to} is on while ${from} is ${c.cmp} ${Math.round(c.threshold * 100)}%`;
    case 'mirror': return `${to} is on while ${from} is${c.payload ? ', with its value' : ''}`;
    case 'region': return `${to} is on while ${from} is inside an area`;
    case 'reaction': return `${to} happens each time ${from} fires`;
    case 'set': return `${from} sets ${to}`;
    case 'none': return '';
  }
}
