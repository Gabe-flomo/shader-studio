/**
 * surprise.ts — the Splat builder's Surprise me (docs/splat-builder.md): an effect stack and settings that look
 * good together, from a seed. The same seed always gives the same scene. Your scan (and where you put it) stays;
 * a generated scan stays generated. Pure.
 *
 *   - one of a few looks (a reveal, a scatter, a hologram, a painterly grade, a wave), each one to three effects
 *     with settings inside the ranges that read well on a real scan, usually one of them animated;
 *   - a calm background from one hue; now and then the scan stands in a small world;
 *   - the camera at a pleasant angle, turning slowly most of the time; bloom when something glows.
 */
import { darkBackground, harmoniousPalette, makeRng, type Rng } from '../lib/surprise';
import { onFloorPlace, type ScanBox } from './place';
import { animateFor, keepCustom, newEffect, starterSplatScene, type EffectSpec, type SplatBuilderSpec, type Vec3, PROP_KINDS, LIGHTS } from './spec';

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const v3 = (c: readonly number[]): Vec3 => [r3(c[0]), r3(c[1]), r3(c[2])];

type Look = 'reveal' | 'scatter' | 'hologram' | 'grade' | 'wave' | 'cut';
const LOOKS: Array<readonly [Look, number]> = [['reveal', 3], ['scatter', 2], ['hologram', 2], ['grade', 2], ['wave', 2], ['cut', 2]];

function effectsFor(rng: Rng, look: Look, accent: Vec3): EffectSpec[] {
  const id = (i: number) => `e${i}`;
  switch (look) {
    case 'reveal': {
      const d = newEffect('dissolve', id(1), {
        amount: r3(rng.float(0.2, 0.5)), scale: r3(rng.logFloat(0.8, 3)), edge: r3(rng.float(0.04, 0.1)), glow: r3(rng.float(3, 8)),
        drift: r3(rng.float(-0.2, 0.5)), edgeColor: accent, mode: rng.pick(['both', 'fade', 'shrink'] as const),
      });
      if (rng.chance(0.8)) d.animate = animateFor('dissolve', 'amount', r3(rng.float(0.05, 0.12)));
      return rng.chance(0.4) ? [newEffect('color', id(2), { saturation: r3(rng.float(0.9, 1.3)), contrast: r3(rng.float(1, 1.2)) }), d] : [d];
    }
    case 'scatter': {
      const e = newEffect('explode', id(1), { amount: r3(rng.float(0.2, 0.5)), distance: r3(rng.float(0.6, 1.8)), scatter: r3(rng.float(0.1, 0.6)), stagger: r3(rng.float(0.3, 0.8)), spin: r3(rng.float(-0.5, 0.5)) });
      e.animate = animateFor('explode', 'amount', r3(rng.float(0.06, 0.14)));
      const out = [e];
      if (rng.chance(0.5)) out.push(newEffect('wave', id(2), { mode: 'wobble', amplitude: r3(rng.float(0.01, 0.03)), frequency: r3(rng.float(2, 6)), speed: r3(rng.float(0.3, 1)) }));
      return out;
    }
    case 'hologram': {
      const out: EffectSpec[] = [
        newEffect('points', id(1), { dotSize: r3(rng.float(1, 2.2)), solid: r3(rng.float(0.4, 0.9)) }),
        newEffect('color', id(2), { saturation: r3(rng.float(0.3, 0.8)), brightness: r3(rng.float(1.3, 2)), tint: accent, tintAmount: r3(rng.float(0.7, 0.95)) }),
      ];
      if (rng.chance(0.6)) {
        const c = newEffect('crop', id(3), { shape: 'plane', normal: [0, 1, 0], offset: 0.3, softness: 0.02, edge: 0.04, edgeColor: accent, glow: r3(rng.float(3, 7)) });
        c.animate = { param: 'offset', speed: r3(rng.float(0.06, 0.15)), from: -0.9, to: 0.9 };
        out.push(c);
      }
      return out;
    }
    case 'grade': {
      const out = [newEffect('color', id(1), {
        hue: r3(rng.float(-40, 40)), saturation: r3(rng.float(0.7, 1.5)), brightness: r3(rng.float(0.95, 1.25)), contrast: r3(rng.float(0.9, 1.3)),
        tint: accent, tintAmount: r3(rng.float(0, 0.35)),
      })];
      out.push(newEffect('look', id(2), { size: r3(rng.float(0.6, 1.4)), opacity: r3(rng.float(0.8, 1.1)), floor: r3(rng.float(0, 0.3)), keep: r3(rng.float(0.6, 1)) }));
      return out;
    }
    case 'wave': {
      const w = newEffect('wave', id(1), {
        mode: rng.weighted([['wave', 3], ['twist', 1], ['wobble', 1]] as const), amplitude: r3(rng.float(0.03, 0.09)), frequency: r3(rng.float(2, 6)),
        speed: r3(rng.float(0.6, 2)), along: rng.pick(['x', 'y', 'radial'] as const), push: rng.pick(['y', 'out', 'z'] as const),
      });
      if (w.params.mode === 'twist') w.params.amplitude = r3(rng.float(0.1, 0.4));
      return rng.chance(0.5) ? [w, newEffect('color', id(2), { saturation: r3(rng.float(1, 1.4)) })] : [w];
    }
    case 'cut': {
      const c = newEffect('crop', id(1), { shape: rng.weighted([['plane', 3], ['sphere', 1]] as const), normal: [0, 1, 0], offset: 0, softness: r3(rng.float(0.02, 0.08)), edge: r3(rng.float(0.03, 0.08)), edgeColor: accent, glow: r3(rng.float(3, 8)), size: [0.6, 0.6, 0.6] });
      c.animate = c.params.shape === 'plane' ? { param: 'offset', speed: r3(rng.float(0.05, 0.12)), from: -1, to: 1 } : { param: 'offset', speed: r3(rng.float(0.05, 0.12)), from: -0.6, to: 0.6 };
      return [c];
    }
  }
}

/** The generated example ball's box, for when the engine hasn't read the scan yet. */
export const EXAMPLE_BOX: ScanBox = { center: [0, 0, 0], radius: 0.85, coreMin: [-0.85, -0.85, -0.85], coreMax: [0.85, 0.85, 0.85] };

/**
 * A splat scene from `seed`, over `current` (its scan and placement stay; with a world, the scan is stood on its
 * floor, by `box`, the scan's box as the engine read it). Pure: the same seed and box, the same scene.
 */
export function surpriseSplatScene(seed: number, current?: SplatBuilderSpec, box?: ScanBox | null): SplatBuilderSpec {
  const rng = makeRng(seed);
  const s = starterSplatScene();
  if (current) { s.scan = structuredClone(current.scan); s.place = structuredClone(current.place); if (current.textures?.length) s.textures = structuredClone(current.textures); }
  const hue = rng.next();
  const [accent, tint2] = harmoniousPalette(rng, 2, { scheme: 'analogous', sat: [0.6, 0.95], light: [0.55, 0.7] }).map(v3);
  const look = rng.weighted(LOOKS);
  s.effects = keepCustom(effectsFor(rng, look, accent).map((e, i) => ({ ...e, id: `e${i + 1}` })), current?.effects ?? []);

  // Background: dark and calm, from one hue (a gradient most of the time).
  const bg = v3(darkBackground(rng, hue));
  s.background = rng.chance(0.7)
    ? { kind: 'gradient', color: v3(bg.map(c => Math.min(1, c * 1.8 + 0.03))), color2: v3(bg.map(c => c * 0.4)), picture: null }
    : { kind: 'solid', color: bg, color2: bg, picture: null };

  // Now and then a small world: a floor and one or two shapes.
  if (look !== 'hologram' && rng.chance(0.25)) {
    s.world = {
      on: true, floor: { on: true, y: -1, color: v3([0.3, 0.3, 0.32].map(c => c + rng.float(-0.05, 0.08))) }, light: rng.pick(LIGHTS), shadows: true, fog: rng.chance(0.4) ? r3(rng.float(0.01, 0.05)) : 0,
      props: Array.from({ length: rng.int(1, 2) }, (_, i) => ({
        id: `p${i + 1}`, kind: rng.pick(PROP_KINDS), at: [r3(rng.sign() * rng.float(1.1, 1.8)), -0.6, r3(rng.float(-1, 0.3))] as Vec3, size: r3(rng.float(0.25, 0.5)), color: i ? tint2 : accent,
      })),
    };
  }

  // Place → Stand on the floor: the scan's lowest point on the world's floor.
  if (s.world.on && s.world.floor.on) s.place = onFloorPlace(s.place, box ?? EXAMPLE_BOX, s.world.floor.y);

  s.camera = { ...s.camera, dist: r3(rng.float(3.2, 4.4)), angle: r3(rng.float(-50, 50)), elev: r3(rng.float(4, 22)), turntable: rng.chance(0.7) ? r3(rng.float(4, 12)) * (rng.chance(0.3) ? -1 : 1) : 0 };
  const glows = s.effects.some(e => e.kind === 'dissolve' || e.kind === 'crop' || e.kind === 'points');
  s.look = {
    tone: glows ? rng.pick(['aces', 'agx', 'none'] as const) : rng.pick(['none', 'none', 'oklab'] as const),
    bloom: { on: glows || rng.chance(0.2), intensity: r3(rng.float(0.4, 0.9)), threshold: r3(rng.float(0.7, 0.9)), radius: Math.round(rng.float(24, 44)) },
  };
  return s;
}
