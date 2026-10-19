/**
 * liveActions — Playfield → Ableton Live (docs/live-connector-plan.md, phase 6): a rule's
 * "Do in Live" reaction fires (playEngine.onAction) and its command goes to the Live
 * connector: launch a clip or a scene, the next scene, stop all clips, tap the tempo. Live
 * quantises launches to its own grid, so the script's ~100 ms polling doesn't matter.
 */
import { playEngine } from './playEngine';
import { liveClient } from './liveClient';
import { LIVE_ACTION, type LiveDo } from '../types/play';
import type { LiveCommand } from './live/liveProtocol';

/** The connector command for a Live reaction, or null when it's missing what it needs (a clip with no track). */
export function liveCommandOf(d: LiveDo): LiveCommand | null {
  switch (d.cmd) {
    case 'clip': return d.track && d.target ? { cmd: 'clip', track: d.track, clip: d.target } : null;
    case 'scene': return d.target ? { cmd: 'scene', scene: d.target } : null;
    case 'nextScene': return { cmd: 'nextScene' };
    case 'stopAll': return { cmd: 'stopAll' };
    case 'tap': return { cmd: 'tap' };
  }
}

/** "Launch clip “Beat B” on Drums", "Stop all clips". */
export function liveDoText(d: LiveDo): string {
  switch (d.cmd) {
    case 'clip': return `Launch clip ${d.target ? `“${d.target}”` : '(pick one)'}${d.track ? ` on ${d.track}` : ''} · Live`;
    case 'scene': return `Launch scene ${d.target ? `“${d.target}”` : '(pick one)'} · Live`;
    case 'nextScene': return 'Launch the next scene · Live';
    case 'stopAll': return 'Stop all clips · Live';
    case 'tap': return 'Tap tempo · Live';
  }
}

export function startLiveActions(): () => void {
  return playEngine.onAction(a => {
    if (a.do !== LIVE_ACTION || !a.live || !a.enabled) return;
    const c = liveCommandOf(a.live);
    if (c) liveClient.send(c);
  });
}
