/**
 * aheadWorker.ts — works out a File source's band curves over the whole file (ahead.ts: what each band's trigger
 * measures, its level and its flatness), off the main thread. It keeps each sound it is sent by id until it is told to
 * drop it, so moving a band's range or changing its Detect only sends the range.
 */
import { atAnalyseFeatures, type AtDetect } from '../../play/kit/audioTools.js';

const sounds = new Map<number, Float32Array>();

self.onmessage = (e: MessageEvent<{ drop?: number; req?: number; id?: number; mono?: Float32Array | null; sampleRate?: number; ranges?: Array<{ lo: number; hi: number; detect?: AtDetect }>; hop?: number }>) => {
  const m = e.data;
  if (typeof m.drop === 'number') { sounds.delete(m.drop); return; }
  try {
    if (m.mono) sounds.set(m.id!, m.mono);
    const mono = sounds.get(m.id!);
    if (!mono) throw new Error('the sound is gone');
    const curves = atAnalyseFeatures(mono, m.sampleRate!, m.ranges!, m.hop!);
    // Each array once (a Level range's value is its level).
    const buffers = new Set<ArrayBuffer>();
    for (const c of curves) for (const a of [c.value, c.level, c.flat, c.aflat, c.arise]) buffers.add(a.buffer as ArrayBuffer);
    (self as unknown as Worker).postMessage({ req: m.req, curves }, [...buffers]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ req: m.req, error: err instanceof Error ? err.message : String(err) });
  }
};
