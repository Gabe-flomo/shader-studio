/**
 * controls.ts — a source's Play controls as an interactive block shows them:
 * their starting values (read from the snapshot's uniforms and layers, the
 * same way the web player reads them) and the mappings that drive them, in
 * words ("Mouse X", "Key K", "LFO 0.2 Hz", "MIDI CC 1").
 */
import { keyName, sourceLabel, triggerLabel } from '../play/playSources';
import { parseLayerTarget, type PlayControl, type PlayMapping, type PlayRecord } from '../types/play';
import { readFinishValue, parseFinishTarget } from '../types/playFinish';
import { readAudioFxValue, parseAudioFxTarget } from '../types/playAudioFx';
import type { PlayHtmlInput } from '../play/exportHtml';

/** The value a control starts at in this bundle (undefined for actions and unknown targets). */
export function baseValue(bundle: PlayHtmlInput, c: PlayControl): number | number[] | undefined {
  if (c.kind === 'action') return undefined;
  if (parseFinishTarget(c.target)) return readFinishValue(bundle.play.finish, c.target);
  if (parseAudioFxTarget(c.target)) return readAudioFxValue(bundle.play.audioFx, c.target);
  const lt = parseLayerTarget(c.target);
  if (lt) {
    const l = bundle.play.layers.find(x => x.id === lt.layerId) as Record<string, unknown> | undefined;
    const v = l?.[lt.key];
    return typeof v === 'number' ? v : undefined;
  }
  const u = bundle.paramBindings[c.target.split('::').slice(-2).join('::')];
  const v = u ? bundle.uniforms[u] : undefined;
  return Array.isArray(v) ? v.slice() : v;
}

const round = (n: number) => Number(n.toFixed(n < 1 ? 2 : 1));

/** One mapping's source, in a few words. */
export function mappingWords(m: PlayMapping, play: PlayRecord): string {
  const s = m.source;
  switch (s.kind) {
    case 'mouse': return s.axis === 'down' ? 'Mouse button' : `Mouse ${s.axis.toUpperCase()}`;
    case 'key': return `Key ${keyName(s.code)}`;
    case 'lfo': return `LFO ${round(s.rate)} Hz`;
    case 'clock': return `Clock ${s.bpm} BPM`;
    case 'noise': return `Noise ${round(s.rate)}/s`;
    case 'midi': return `MIDI ${sourceLabel(s)}`;
    case 'trigger': {
      const t = s.trigger;
      if (t.on === 'reader') return `Sound ${play.audioReaders?.readers.find(r => r.id === t.readerId)?.name ?? 'reader'} hit`;
      return triggerLabel(t, play.layers);
    }
    case 'live': return `Sound ${s.band === 'level' ? 'level' : s.band}`;
    case 'reader': return `Sound ${play.audioReaders?.readers.find(r => r.id === s.readerId)?.name ?? 'reader'}`;
    default: return sourceLabel(s, play.controls, play.layers);
  }
}

/** What needs the visitor to switch something on first. */
export type Needs = 'midi' | 'audio' | 'keys';

export interface ControlMappings { words: string[]; needs: Set<Needs> }

/** The enabled mappings of each control, as words, and what they need turned on. */
export function mappingsByControl(play: PlayRecord): Map<string, ControlMappings> {
  const out = new Map<string, ControlMappings>();
  for (const m of play.mappings) {
    if (!m.enabled) continue;
    const e = out.get(m.controlId) ?? { words: [], needs: new Set<Needs>() };
    const w = mappingWords(m, play);
    if (!e.words.includes(w)) e.words.push(w);
    const s = m.source;
    if (s.kind === 'midi' || (s.kind === 'trigger' && s.trigger.on === 'note')) e.needs.add('midi');
    if (s.kind === 'live' || s.kind === 'reader' || (s.kind === 'trigger' && (s.trigger.on === 'audio' || s.trigger.on === 'reader'))) e.needs.add('audio');
    if (s.kind === 'key' || (s.kind === 'trigger' && s.trigger.on === 'key')) e.needs.add('keys');
    out.set(m.controlId, e);
  }
  return out;
}
