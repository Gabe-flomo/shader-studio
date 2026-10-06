/**
 * The latest value field of the node under the eye preview, read back by ShaderCanvas
 * (valuePreviewRunner.ts) and drawn by the eye overlay and the node card. Plain pub/sub, no React
 * state: a readback lands several times a second and only the two pictures need it.
 */
import type { FieldStats, ValueField } from './valueField';

export interface PreviewFrame {
  nodeId: string;
  outputKey: string;
  field: ValueField;
  stats: FieldStats;
  /** Increments per readback. */
  seq: number;
}

export interface PreviewPerf {
  /** GPU submit time of the last value render on the CPU side (ms). */
  renderMs: number;
  /** From the readback request to the data arriving (ms; GPU work + a frame or so of latency). */
  readbackMs: number;
  /** Stats over the field (ms). */
  statsMs: number;
  /** The node card's last paint (ms). */
  cardPaintMs: number;
  /** The eye overlay's last draw (ms). */
  overlayMs: number;
  readbacks: number;
  /** Size of the value target. */
  w: number;
  h: number;
}

let latest: PreviewFrame | null = null;
let seq = 0;
const listeners = new Set<() => void>();
export const previewPerf: PreviewPerf = { renderMs: 0, readbackMs: 0, statsMs: 0, cardPaintMs: 0, overlayMs: 0, readbacks: 0, w: 0, h: 0 };

export const previewBus = {
  get: (): PreviewFrame | null => latest,
  publish(frame: Omit<PreviewFrame, 'seq'>) {
    latest = { ...frame, seq: ++seq };
    for (const fn of listeners) fn();
  },
  clear() {
    if (!latest) return;
    latest = null;
    for (const fn of listeners) fn();
  },
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  },
};

if (typeof window !== 'undefined') (window as unknown as { __previewPerf?: PreviewPerf }).__previewPerf = previewPerf;
