/**
 * Pausing Play's transport (Space) has to pause the layer kit's simulated
 * layers too — particles, agents, bodies, relationships — not just the
 * shader's u_time. ShaderCanvas.tsx and play-runtime.js both do this by
 * passing the kit's per-frame step dt 0 while paused (a single "paused ⇒
 * dt 0", not per-layer changes); this checks the kit itself holds still
 * under dt 0 and picks back up when dt resumes, using an Agents layer (the
 * same stepper particles and bodies share the pattern of) and a null that
 * follows one agent so its reported position stands in for the agent's own.
 */
import { describe, it, expect } from 'vitest';
import { createLayerKit, type KitEnv } from '../kit/kit.js';
import { agPresetLayer } from '../kit/agents.js';
import { defaultLayer, type AgentsLayer, type PlayLayer } from '../../types/playLayers';
import { emptyPlayRecord, type PlayRecord } from '../../types/play';

function fakeCanvas(): HTMLCanvasElement {
  const target: Record<string, unknown> = {
    canvas: null, measureText: (s: string) => ({ width: String(s).length * 6 }),
    getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4).fill(128) }),
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    createLinearGradient: () => ({ addColorStop() {} }), createRadialGradient: () => ({ addColorStop() {} }),
  };
  const ctx: unknown = new Proxy(target, { get(t, k: string) { return k in t ? t[k] : () => {}; }, set(t, k: string, v) { t[k] = v; return true; } });
  return { width: 160, height: 90, getContext: () => ctx } as unknown as HTMLCanvasElement;
}

const layerOf = (preset = 'boids', over: Record<string, unknown> = {}) => {
  const base = defaultLayer('agents', 'a', 'A');
  const out = { ...base, ...agPresetLayer(preset, base), ...over } as Record<string, unknown>;
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out as unknown as AgentsLayer;
};

describe('pausing the transport pauses the layer kit', () => {
  it('dt 0 leaves an agent (read through a following null) exactly where it was; dt resuming moves it again', () => {
    const g = globalThis as { document?: unknown; Path2D?: unknown };
    const had = [g.document, g.Path2D];
    g.document = { createElement: () => fakeCanvas() };
    g.Path2D = class { moveTo() {} lineTo() {} closePath() {} rect() {} arcTo() {} addPath() {} };
    try {
      const kit = createLayerKit();
      kit.reset(5);
      const agents = layerOf('boids', { seed: 5 }) as unknown as PlayLayer;
      const nul = { ...defaultLayer('null', 'n', 'N'), follow: 'agent', followId: 'a', agentIndex: 0, spring: 1, wobble: 0 } as PlayLayer;
      const record: PlayRecord = { ...emptyPlayRecord(), layers: [agents, nul] };
      const at = new Map<string, number>();
      const out = fakeCanvas().getContext('2d')!;
      const env = (time: number, dt: number): KitEnv => ({
        gl: fakeCanvas(), W: 160, H: 90, dpr: 1, time, dt,
        value: (l, k) => at.get(`${l.id}::${k}`) ?? (l as unknown as Record<string, number>)[k],
        pointer: { x: 0.3, y: 0.6, over: true, down: false }, markers: false, editing: false, hidden: false, backdrop: [0, 0, 0], audio: null, camera: null, image: () => null,
        sensor: () => {},
        override: (id, k, v) => { if (v === null) at.delete(`${id}::${k}`); else at.set(`${id}::${k}`, v); },
      } as KitEnv);

      // Playing: 60 frames at 1/60s — the agent (and the null following it) moves.
      let time = 0;
      for (let i = 0; i < 60; i++) { kit.frame(out, record, env(time, 1 / 60)); time += 1 / 60; }
      const runningX = at.get('n::x'), runningY = at.get('n::y');
      expect(runningX).toBeDefined();

      // Paused: the transport stops advancing `time` and hands the kit dt 0 — 30 more frames at the
      // same `time`, dt 0. Nothing should move: this is what ShaderCanvas.tsx's `layerDt` and
      // play-runtime.js's `running ? dt : 0` guard against regressing.
      for (let i = 0; i < 30; i++) kit.frame(out, record, env(time, 0));
      expect(at.get('n::x')).toBe(runningX);
      expect(at.get('n::y')).toBe(runningY);

      // Resumed: `time` and dt move again — the agent picks back up from where it stopped.
      for (let i = 0; i < 60; i++) { kit.frame(out, record, env(time, 1 / 60)); time += 1 / 60; }
      expect(at.get('n::x')).not.toBe(runningX);
    } finally { [g.document, g.Path2D] = had; }
  });
});
