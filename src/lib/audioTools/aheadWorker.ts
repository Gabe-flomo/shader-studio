/**
 * aheadWorker.ts — works out a File source's band levels over the whole file (ahead.ts), off the main thread. It keeps
 * each sound it is sent by id until it is told to drop it, so moving a band's range only sends the range.
 */
import { atAnalyseLevels } from '../../play/kit/audioTools.js';

const sounds = new Map<number, Float32Array>();

self.onmessage = (e: MessageEvent<{ drop?: number; req?: number; id?: number; mono?: Float32Array | null; sampleRate?: number; ranges?: Array<{ lo: number; hi: number }>; hop?: number }>) => {
  const m = e.data;
  if (typeof m.drop === 'number') { sounds.delete(m.drop); return; }
  try {
    if (m.mono) sounds.set(m.id!, m.mono);
    const mono = sounds.get(m.id!);
    if (!mono) throw new Error('the sound is gone');
    const curves = atAnalyseLevels(mono, m.sampleRate!, m.ranges!, m.hop!);
    (self as unknown as Worker).postMessage({ req: m.req, curves }, curves.map(c => c.buffer));
  } catch (err) {
    (self as unknown as Worker).postMessage({ req: m.req, error: err instanceof Error ? err.message : String(err) });
  }
};
