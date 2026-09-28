/**
 * audioEngineWire.ts — joins the Audio engine host (lib/audioEngineHost.ts)
 * to the rest of the app, once, when the picture's canvas loads it: notes go
 * through the Play overlay (so takes record them and play them back), drum
 * pad hits reach racks that follow them, the browser's sample player plays
 * through the app's Web Audio engine, and sounds come from the Library.
 */
import { audioEngineHost, setEngineSounds, setEngineWebAudio } from './audioEngineHost';
import { audioEngine } from './audioEngine';
import { getVideo } from './backgroundLibrary';
import { playOverlay } from '../play/overlay';
import { rackKeyboard } from './rackKeyboard';
import { setRackKeyboard } from '../types/playAudioEngine';
import { useNodeGraphStore } from '../store/useNodeGraphStore';

let wired = false;

export function wireAudioEngine(): void {
  if (wired) return;
  wired = true;
  audioEngineHost.configure({ act: a => playOverlay.act(a) });
  // Esc, the top bar's pill, leaving Play or removing the rack: the record's toggle follows.
  rackKeyboard.configure({
    release: rackId => useNodeGraphStore.getState().setPlay(p => (p.audioEngine?.racks.some(r => r.id === rackId && r.keyboard) ? { ...p, audioEngine: setRackKeyboard(p.audioEngine, rackId, false) } : p), false),
  });
  playOverlay.onPad(a => audioEngineHost.onPad(a));
  setEngineWebAudio({ ctx: () => audioEngine.context(), connect: n => audioEngine.connectOutside(n) });
  setEngineSounds(async id => {
    const v = await getVideo(id);
    return v ? { blob: v.blob, type: v.type, name: v.name } : null;
  });
}
