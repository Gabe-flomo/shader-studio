/**
 * playMapper.ts — runs the Play page's mappings every frame as an input-bus
 * source. Reads MIDI from midiEngine, the pointer and held keys from its own
 * window listeners, shapes each value (range → curve → range → smoothing) and
 * writes it by `${nodeId}::${paramKey}`. The bus resolves that through the
 * compiler's paramBindings, so a mapping is exactly a slider drag without the
 * store: no undo entry, no recompile, no React.
 *
 * Module singleton, no allocation per frame (mappings are pre-resolved into
 * a flat array when the instrument changes).
 */

import type { InputSource, InputWriter } from './inputBus';
import { midiEngine } from './midiEngine';
import type { PlayInstrument, PlayMapping, PlaySource } from '../types/play';

interface Compiled {
  key: string;
  source: PlaySource;
  inMin: number; inMax: number; outMin: number; outMax: number;
  curve: PlayMapping['curve'];
  smoothMs: number;
  value: number | null; // smoothed state
}

/** Pure shaping step, exported for tests. */
export function shapeValue(raw: number, m: Pick<PlayMapping, 'inMin' | 'inMax' | 'outMin' | 'outMax' | 'curve'>): number {
  const span = m.inMax - m.inMin;
  let t = span === 0 ? 0 : (raw - m.inMin) / span;
  t = Math.max(0, Math.min(1, t));
  if (m.curve === 'exp') t = t * t;
  else if (m.curve === 'log') t = Math.sqrt(t);
  return m.outMin + t * (m.outMax - m.outMin);
}

class PlayMapper implements InputSource {
  private compiled: Compiled[] = [];
  private pointer = { x: 0.5, y: 0.5 };
  private held = new Set<string>();
  private keysEnabled = false;
  private listening = false;

  private onPointer = (e: PointerEvent) => {
    const w = window.innerWidth || 1, h = window.innerHeight || 1;
    this.pointer.x = Math.max(0, Math.min(1, e.clientX / w));
    this.pointer.y = Math.max(0, Math.min(1, 1 - e.clientY / h));
  };
  private onKeyDown = (e: KeyboardEvent) => {
    if (!this.keysEnabled || e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target as HTMLElement | null)?.isContentEditable) return;
    this.held.add(e.code);
  };
  private onKeyUp = (e: KeyboardEvent) => { this.held.delete(e.code); };
  private onBlur = () => { this.held.clear(); };

  setInstrument(play: PlayInstrument): void {
    const prev = new Map(this.compiled.map(c => [c.key + '|' + JSON.stringify(c.source), c.value]));
    this.compiled = play.mappings.filter(m => m.enabled).map(m => ({
      key: `${m.target.nodeId}::${m.target.paramKey}`,
      source: m.source,
      inMin: m.inMin, inMax: m.inMax, outMin: m.outMin, outMax: m.outMax,
      curve: m.curve, smoothMs: m.smoothMs,
      value: prev.get(`${m.target.nodeId}::${m.target.paramKey}|${JSON.stringify(m.source)}`) ?? null,
    }));
    this.ensureListeners();
  }

  /** Key mappings only read the keyboard while the Play page is up. */
  setKeysEnabled(on: boolean): void {
    this.keysEnabled = on;
    if (!on) this.held.clear();
  }

  hasMappings(): boolean {
    return this.compiled.length > 0;
  }

  /** Current pointer position, 0..1 with y up (for the Play page's readouts). */
  pointerPosition(): { x: number; y: number } {
    return this.pointer;
  }

  private ensureListeners(): void {
    if (this.listening || typeof window === 'undefined') return;
    this.listening = true;
    window.addEventListener('pointermove', this.onPointer, { passive: true });
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  private readSource(s: PlaySource): number {
    switch (s.kind) {
      case 'midi': {
        const ch = midiEngine.channelState(s.midiChannel ?? 0);
        switch (s.channel) {
          case 'note':     return ch.lastNote / 127;
          case 'velocity': return ch.lastVelocity / 127;
          case 'gate':     return ch.heldCount > 0 ? 1 : 0;
          case 'bend':     return ch.bend;
          case 'cc':       return ch.cc[(s.cc ?? 1) & 127] / 127;
        }
        return 0;
      }
      case 'mouse': return s.axis === 'x' ? this.pointer.x : this.pointer.y;
      case 'key':   return this.held.has(s.code) ? 1 : 0;
    }
  }

  tickInputs(dt: number, _time: number, write: InputWriter): void {
    for (const c of this.compiled) {
      const target = shapeValue(this.readSource(c.source), c);
      let v = target;
      if (c.smoothMs > 0 && c.value !== null) {
        const alpha = 1 - Math.exp(-(dt * 1000) / c.smoothMs);
        v = c.value + (target - c.value) * alpha;
        if (Math.abs(v - target) < 1e-4) v = target;
      }
      c.value = v;
      write(c.key, v);
    }
  }
}

export const playMapper = new PlayMapper();
