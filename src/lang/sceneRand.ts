/**
 * sceneRand.ts — interesting random ranges for the Scene Builder's settings (random.ts), shared by
 * the recipe parser and the registry. A shape's or warp's setting draws round its default, inside
 * its legal range: half to 1.6 times a positive default, else a sixth of the range either side.
 */
import type { ParamDef } from '../sceneBuilder/spec';
import type { RandSpec } from './random';

export function sceneRand(p: ParamDef): RandSpec {
  const vec = Array.isArray(p.def);
  const d = vec ? (p.def as number[])[0] : (p.def as number);
  const lo = Math.max(p.min, d > 0 ? d * 0.5 : d - (p.max - p.min) / 6);
  const hi = Math.min(p.max, d > 0 ? d * 1.6 : d + (p.max - p.min) / 6);
  const step = p.step >= 1 ? p.step : undefined;
  if (vec) return { kind: 'vec', lo, hi, n: 3 };
  return { kind: 'num', lo, hi, log: lo > 0 && hi / lo > 4, ...(step ? { int: true } : {}) };
}

/** Ranges for the scene's other settings (by clause and key). */
export const SCENE_SETTING_RAND: Readonly<Record<string, RandSpec>> = {
  'shape.at': { kind: 'vec', lo: -0.6, hi: 0.6, n: 3 },
  'shape.rot': { kind: 'vec', lo: -45, hi: 45, n: 3 },
  'shape.color': { kind: 'colour' },
  'shape.shine': { kind: 'num', lo: 0, hi: 0.8 },
  'combine.k': { kind: 'num', lo: 0.1, hi: 0.5 },
  'glass.ior': { kind: 'num', lo: 1.2, hi: 1.7 },
  'glass.dispersion': { kind: 'num', lo: 0, hi: 0.05 },
  'volumetric.density': { kind: 'num', lo: 0.5, hi: 3 },
  'volumetric.falloff': { kind: 'num', lo: 2, hi: 12 },
  'gi.bounce': { kind: 'num', lo: 0.3, hi: 1 },
  'gi.metal': { kind: 'num', lo: 0, hi: 1 },
  'gi.rough': { kind: 'num', lo: 0.1, hi: 0.9 },
  'fog.density': { kind: 'num', lo: 0.05, hi: 0.5 },
  'fog.color': { kind: 'colour' },
  'camera.dist': { kind: 'num', lo: 3, hi: 6 },
  'camera.orbit': { kind: 'num', lo: 0, hi: 15 },
  'camera.elev': { kind: 'num', lo: 5, hi: 35 },
  'camera.angle': { kind: 'num', lo: 0, hi: 360, int: true },
  'shadows.hardness': { kind: 'num', lo: 6, hi: 32, int: true },
  'sky.color': { kind: 'colour' },
  'bounce.color': { kind: 'colour' },
  'background.top': { kind: 'colour' },
  'background.bottom': { kind: 'colour' },
  'sun.color': { kind: 'colour' },
  'tone.mode': { kind: 'choice', options: ['aces', 'agx', 'hable', 'reinhard2', 'tanh', 'oklab'] },
};
