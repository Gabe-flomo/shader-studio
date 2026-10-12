/**
 * surprise.ts — the Time Cube builder's Surprise me (docs/timecube-builder.md): a look from a seed, built on one of
 * the presets and varied inside ranges that read well on any footage. The same seed always gives the same scene; your
 * video and its clip stay. Pure.
 *
 *   - a box of time (about two times in three) or a stack of cards;
 *   - box: how see-through the past is, a feather, the shape, a rim glow and pastel sides from one hue, sometimes
 *     highlighted frames or a colour key, a tilted slice now and then; the camera at a pleasant angle;
 *   - cards: a layout (stack, fan, ring, helix, grid), sometimes a morph to another, the scan's lift, borders,
 *     sometimes highlights or a scatter; a lens;
 *   - an LFO sweeping the slice or the scan most of the time; a calm background, light or dark.
 */
import { darkBackground, harmoniousPalette, lightBackground, makeRng, type Rng } from '../lib/surprise';
import { withPreset, TC_PRESETS } from './presets';
import type { TimeCubeSpec } from './spec';

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const v3 = (c: readonly number[]) => [r3(c[0]), r3(c[1]), r3(c[2])];

function cube(rng: Rng, s: TimeCubeSpec, light: boolean) {
  const [rim, from, to] = harmoniousPalette(rng, 3, { light: [0.6, 0.8] });
  const v = s.view;
  Object.assign(v, {
    before: r3(rng.float(0.05, 0.45)), after: r3(rng.float(0.6, 1)), timeFeather: rng.chance(0.6) ? r3(rng.float(4, 24)) : 0,
    roundness: r3(rng.float(0, 0.6)), feather: r3(rng.float(0, 0.3)), bulge: rng.chance(0.25) ? r3(rng.float(0.05, 0.3)) : 0,
    rimStrength: r3(rng.float(0.1, 0.8)), rimWidth: r3(rng.float(0.03, 0.15)), rimColor: v3(rim),
    tintAmount: rng.chance(0.45) ? r3(rng.float(0.3, 0.9)) : 0, tintFrom: v3(from), tintTo: v3(to), tintAlong: rng.pick(['diagonal', 'time', 'height']),
    depth: r3(rng.float(0.8, 2.4)), axis: rng.weighted([['z', 4], ['x', 1], ['y', 1]] as const),
    tiltX: rng.chance(0.2) ? r3(rng.float(-35, 35)) : 0,
    camAngle: r3(rng.float(0.3, 1.1) * rng.sign()), camElevation: r3(rng.float(0.15, 0.6)), rotSpeed: rng.chance(0.6) ? r3(rng.float(0.05, 0.2) * rng.sign()) : 0,
    ortho: rng.chance(0.25) ? 1 : 0, shadow: light ? r3(rng.float(0.05, 0.2)) : 0,
  });
  if (rng.chance(0.3)) {
    Object.assign(v, { highlights: true, hlCount: rng.int(3, 8), hlSpacing: rng.int(6, 16), hlThickness: r3(rng.float(1, 2.5)), hlOpacity: 0.9, hlEdge: 0.8, hlColor: v3(rim), hlOthers: r3(rng.float(0.3, 0.7)) });
    if (rng.chance(0.6)) Object.assign(v, { motion: true, motionAt: 'highlights', motionWidth: 2.5, liftUp: r3(rng.float(0.1, 0.25)) });
  } else v.highlights = false;
  if (rng.chance(0.2)) Object.assign(v, { keyMode: 'hue', keyColor: [0.85, 0.12, 0.12], keyTolerance: 0.08, keyOpacity: 0.9, othersOpacity: r3(rng.float(0.2, 0.6)), othersGrey: r3(rng.float(0.5, 1)) });
  else v.keyMode = 'off';
}

const LAYOUTS = ['stack', 'fan', 'ring', 'helix', 'grid'] as const;

function stack(rng: Rng, s: TimeCubeSpec, light: boolean) {
  const [accent] = harmoniousPalette(rng, 1, { light: light ? [0.35, 0.5] : [0.55, 0.75] });
  const layout = rng.pick(LAYOUTS);
  const st = s.stack;
  Object.assign(st, {
    layout, layoutB: rng.chance(0.25) ? rng.pick(LAYOUTS.filter(l => l !== layout)) : 'none',
    cards: rng.int(16, 48), spacing: r3(rng.float(0.08, 0.25)),
    radius: r3(rng.float(1, 2.2)), twist: r3(rng.float(0, 1)), turns: r3(rng.float(1, 3)), fanAngle: r3(rng.float(60, 160)),
    corner: r3(rng.float(0, 0.3)), border: r3(rng.float(0, 0.05)), borderColor: light ? [1, 1, 1] : [0.95, 0.95, 0.95], shading: r3(rng.float(0.1, 0.4)),
    lift: r3(rng.float(0.1, 0.4)), pull: r3(rng.float(0, 0.3)), gap: r3(rng.float(0, 4)), falloff: r3(rng.float(0, 3)),
    hlCount: rng.chance(0.3) ? rng.int(2, 5) : 0, hlEvery: rng.int(4, 10), hlColor: v3(accent), hlLift: 0.2, hlOutline: 0.6,
    spread: rng.chance(0.2) ? r3(rng.float(0.1, 0.4)) : 0,
    projection: rng.chance(0.35) ? 'ortho' : 'persp', camAngle: r3(rng.float(0.3, 1.2) * rng.sign()), camElevation: r3(rng.float(0.2, 0.62)),
    rotSpeed: rng.chance(0.5) ? r3(rng.float(0.05, 0.15) * rng.sign()) : 0,
  });
}

/** A scene from `seed` over `spec` (your video and clip stay). */
export function surpriseTimeCube(seed: number, spec: TimeCubeSpec): TimeCubeSpec {
  const rng = makeRng(seed);
  const display = rng.chance(0.65) ? 'cube' : 'stack';
  const base = rng.pick(TC_PRESETS.filter(p => p.display === display));
  const s = withPreset(spec, base.key);
  const light = rng.chance(0.3);
  const bg = v3(light ? lightBackground(rng) : darkBackground(rng));
  if (display === 'cube') { cube(rng, s, light); s.view.background = bg; } else { stack(rng, s, light); s.stack.background = bg; }
  const sweep = rng.chance(0.8);
  s.drive = sweep
    ? { on: true, target: display === 'cube' ? 'slice' : 'scan', waveform: rng.pick(['triangle', 'sawtooth', 'sine'] as const), freq: r3(rng.logFloat(0.03, 0.12)), offset: 0.5, amplitude: r3(rng.float(0.3, 0.48)) }
    : { ...s.drive, on: false };
  return s;
}
