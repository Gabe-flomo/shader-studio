/**
 * aheadWorker.ts — works out a File source's band detector frames over the whole file (ahead.ts:
 * play/kit/audioTools.js atDetAnalyse), off the main thread. It keeps each sound it is sent by id until it is told to
 * drop it, so moving a band's range or changing its preset only sends the spec.
 */
import { atDetAnalyse, type AtDetSpec } from '../../play/kit/audioTools.js';

const sounds = new Map<number, Float32Array>();

self.onmessage = (e: MessageEvent<{ drop?: number; req?: number; id?: number; mono?: Float32Array | null; sampleRate?: number; specs?: AtDetSpec[] }>) => {
  const m = e.data;
  if (typeof m.drop === 'number') { sounds.delete(m.drop); return; }
  try {
    if (m.mono) sounds.set(m.id!, m.mono);
    const mono = sounds.get(m.id!);
    if (!mono) throw new Error('the sound is gone');
    const curves = atDetAnalyse(mono, m.sampleRate!, m.specs!);
    const buffers: ArrayBuffer[] = [];
    for (const c of curves) for (const a of [c.odf, c.edb, c.aflat, c.arise, c.flat, c.bright]) buffers.push(a.buffer as ArrayBuffer);
    (self as unknown as Worker).postMessage({ req: m.req, curves }, buffers);
  } catch (err) {
    (self as unknown as Worker).postMessage({ req: m.req, error: err instanceof Error ? err.message : String(err) });
  }
};
