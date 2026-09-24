/**
 * playSources.ts — the mappings drawer's source vocabulary: the flat list a
 * <select> offers, conversion to and from the record's PlaySource shape, and
 * short labels. Pure; shared by the Play page and the control rows.
 */
import type { PlayCurve, PlaySource } from '../types/play';

export type SourceType = 'midi:note' | 'midi:velocity' | 'midi:gate' | 'midi:bend' | 'midi:cc' | 'mouse:x' | 'mouse:y' | 'mouse:down' | 'key';

export const SOURCE_TYPES: { value: SourceType; label: string }[] = [
  { value: 'midi:cc', label: 'MIDI CC' },
  { value: 'midi:note', label: 'MIDI note' },
  { value: 'midi:velocity', label: 'MIDI velocity' },
  { value: 'midi:gate', label: 'MIDI gate' },
  { value: 'midi:bend', label: 'Pitch bend' },
  { value: 'mouse:x', label: 'Mouse X' },
  { value: 'mouse:y', label: 'Mouse Y' },
  { value: 'mouse:down', label: 'Mouse button' },
  { value: 'key', label: 'Keyboard key' },
];

export const CHANNELS = [{ value: '0', label: 'All' }, ...Array.from({ length: 16 }, (_, i) => ({ value: `${i + 1}`, label: `${i + 1}` }))];

export const CURVES: { value: PlayCurve; label: string }[] = [
  { value: 'linear', label: 'Linear' },
  { value: 'exp', label: 'Exp' },
  { value: 'log', label: 'Log' },
];

export const COLOUR_CHANNELS = [
  { value: 'all', label: 'Brightness' },
  { value: '0', label: 'Red' },
  { value: '1', label: 'Green' },
  { value: '2', label: 'Blue' },
];

export function sourceType(s: PlaySource): SourceType {
  if (s.kind === 'midi') return `midi:${s.signal}` as SourceType;
  if (s.kind === 'mouse') return `mouse:${s.axis}` as SourceType;
  return 'key';
}

export function sourceFromType(t: SourceType, prev: PlaySource): PlaySource {
  const channel = prev.kind === 'midi' ? prev.channel : 0;
  switch (t) {
    case 'midi:cc': return { kind: 'midi', signal: 'cc', channel, cc: prev.kind === 'midi' && prev.cc !== undefined ? prev.cc : 1 };
    case 'midi:note': return { kind: 'midi', signal: 'note', channel };
    case 'midi:velocity': return { kind: 'midi', signal: 'velocity', channel };
    case 'midi:gate': return { kind: 'midi', signal: 'gate', channel };
    case 'midi:bend': return { kind: 'midi', signal: 'bend', channel };
    case 'mouse:x': return { kind: 'mouse', axis: 'x' };
    case 'mouse:y': return { kind: 'mouse', axis: 'y' };
    case 'mouse:down': return { kind: 'mouse', axis: 'down' };
    case 'key': return { kind: 'key', code: prev.kind === 'key' ? prev.code : 'Space' };
  }
}

/** Short human name for a source ("CC 74 · ch. 1", "Key D", "Mouse X"). */
export function sourceLabel(s: PlaySource): string {
  if (s.kind === 'mouse') return s.axis === 'down' ? 'Mouse button' : `Mouse ${s.axis.toUpperCase()}`;
  if (s.kind === 'key') return `Key ${keyName(s.code)}`;
  const ch = s.channel === 0 ? '' : ` · ch. ${s.channel}`;
  switch (s.signal) {
    case 'cc': return `CC ${s.cc ?? 1}${ch}`;
    case 'note': return `Note${ch}`;
    case 'velocity': return `Velocity${ch}`;
    case 'gate': return `Gate${ch}`;
    case 'bend': return `Bend${ch}`;
  }
}

export function keyName(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Arrow')) return code.slice(5);
  return code;
}

