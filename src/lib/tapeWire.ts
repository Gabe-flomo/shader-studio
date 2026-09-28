/**
 * tapeWire.ts — joins the tape (lib/tape.ts) to the app, once, with the
 * Audio engine's wiring: the record (each recording an undo step), notes
 * into racks through the host (as the tape's, so they aren't recorded
 * again), rack controls through the Play engine's overrides, the host's live
 * input, the metronome's click, notices, and the lanes' previews.
 */
import { tape } from './tape';
import { audioEngineHost } from './audioEngineHost';
import { audioEngine } from './audioEngine';
import { playEngine } from './playEngine';
import { refreshPreviews } from './tapePreview';
import { useNodeGraphStore } from '../store/useNodeGraphStore';
import { toast } from '../components/ui/toastStore';

let wired = false;

/**
 * A short click (1.6 kHz on the bar's first beat, 1 kHz on the others), 30 ms,
 * straight to the speakers: the performer hears it, recordings don't. Only
 * while the metronome is on (off by default).
 */
export function metronomeClick(accent: boolean): void {
  let ctx: AudioContext;
  try { ctx = audioEngine.context(); } catch { return; }
  if (ctx.state === 'suspended') void ctx.resume();
  const t = ctx.currentTime + 0.005;
  const osc = ctx.createOscillator(), g = ctx.createGain();
  osc.type = 'square';
  osc.frequency.value = accent ? 1600 : 1000;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(accent ? 0.18 : 0.12, t + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
  osc.connect(g).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 0.04);
  osc.onended = () => { try { g.disconnect(); } catch { /* gone */ } };
}

export function wireTape(): void {
  if (wired) return;
  wired = true;
  tape.configure({
    now: () => performance.now(),
    play: () => useNodeGraphStore.getState().play,
    commit: (fn, label) => useNodeGraphStore.getState().setPlay(fn, { label }),
    send: (rack, bytes) => audioEngineHost.input(rack, bytes, true),
    override: (id, key, v) => playEngine.setOverride(id, key, v),
    driven: (id, key) => playEngine.drivenValue(id, key),
    click: metronomeClick,
    setTimePlaying: playing => useNodeGraphStore.getState().setTimePlaying(playing),
    notice: (title, message) => toast.info(title, message ? { message } : undefined),
    every: fn => { const id = setInterval(fn, 8); return () => clearInterval(id); },
    onInput: fn => audioEngineHost.onInput(fn),
    recorded: racks => refreshPreviews(useNodeGraphStore.getState().play, racks),
  });
  // Another setup opened, or the tape undone away: stop cleanly.
  let last = useNodeGraphStore.getState().play;
  useNodeGraphStore.subscribe(s => {
    if (s.play === last) return;
    const racksGone = (last.audioEngine?.racks.length ?? 0) > 0 && !s.play.audioEngine?.racks.length;
    last = s.play;
    if (racksGone && tape.running()) tape.stop();
  });
}
