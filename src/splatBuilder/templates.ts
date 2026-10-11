/**
 * templates.ts — the Splat builder's starting points (docs/splat-builder.md, "Templates"), each on a generated
 * example scan. Picking one keeps your own scan (and where you put it) when you have loaded one: the template brings
 * its effects, world, camera and look.
 */
import { animateFor, newEffect, starterSplatScene, type SplatBuilderSpec } from './spec';

export interface SplatTemplate { key: string; label: string; blurb: string; make: () => SplatBuilderSpec }

export const SPLAT_TEMPLATES: SplatTemplate[] = [
  {
    key: 'turntable', label: 'Turntable', blurb: 'The scan turning slowly on a soft gradient: the classic way to show one.',
    make: () => {
      const s = starterSplatScene();
      s.camera = { ...s.camera, turntable: 12, elev: 10 };
      s.effects = [newEffect('color', 'e1', { saturation: 1.1, contrast: 1.05 })];
      return s;
    },
  },
  {
    key: 'dissolve', label: 'Dissolve reveal', blurb: 'The scan dissolving through noise and coming back, with a glowing edge.',
    make: () => {
      const s = starterSplatScene();
      const d = newEffect('dissolve', 'e1', { amount: 0.4, scale: 1.6, edge: 0.07, glow: 6, drift: 0.35, edgeColor: [1, 0.5, 0.15] });
      d.animate = animateFor('dissolve', 'amount', 0.08);
      s.effects = [d];
      s.camera = { ...s.camera, turntable: 6 };
      s.background = { ...s.background, kind: 'solid', color: [0.02, 0.02, 0.03] };
      s.look = { tone: 'aces', bloom: { on: true, intensity: 0.7, threshold: 0.8, radius: 36 } };
      return s;
    },
  },
  {
    key: 'exploded', label: 'Exploded view', blurb: 'Blown apart from its middle and brought home again, over and over.',
    make: () => {
      const s = starterSplatScene();
      const e = newEffect('explode', 'e1', { distance: 1.2, scatter: 0.3, stagger: 0.6, spin: 0.3 });
      e.animate = animateFor('explode', 'amount', 0.1);
      s.effects = [e, newEffect('wave', 'e2', { mode: 'wobble', amplitude: 0.02, frequency: 4, speed: 0.6 })];
      s.camera = { ...s.camera, dist: 4.4, turntable: 5 };
      return s;
    },
  },
  {
    key: 'hologram', label: 'Hologram', blurb: 'Points tinted cyan, glowing, with a slow shimmer and a scan line sweeping up.',
    make: () => {
      const s = starterSplatScene();
      const crop = newEffect('crop', 'e3', { shape: 'plane', normal: [0, 1, 0], offset: 0.4, softness: 0.02, edge: 0.04, edgeColor: [0.4, 1, 1], glow: 6 });
      crop.animate = { param: 'offset', speed: 0.12, from: -0.9, to: 0.9 };
      s.effects = [
        newEffect('points', 'e1', { dotSize: 1.4, solid: 0.6 }),
        newEffect('color', 'e2', { saturation: 0.6, brightness: 1.6, tint: [0.3, 0.9, 1], tintAmount: 0.85 }),
        crop,
        newEffect('wave', 'e4', { mode: 'wobble', amplitude: 0.01, frequency: 6, speed: 1 }),
      ];
      s.background = { ...s.background, kind: 'solid', color: [0.01, 0.02, 0.03] };
      s.camera = { ...s.camera, turntable: 8 };
      s.look = { tone: 'none', bloom: { on: true, intensity: 1, threshold: 0.55, radius: 44 } };
      return s;
    },
  },
  {
    key: 'world', label: 'Scan in a scene', blurb: 'The scan standing on a floor with a ball and a pillar, lit by a low sun.',
    make: () => {
      const s = starterSplatScene();
      s.place = { ...s.place, position: [0, -0.15, 0] };
      s.world = {
        on: true, floor: { on: true, y: -1, color: [0.38, 0.36, 0.34] }, light: 'sunset', shadows: true, fog: 0.02,
        props: [
          { id: 'p1', kind: 'sphere', at: [1.4, -0.6, -0.4], size: 0.4, color: [0.85, 0.3, 0.2] },
          { id: 'p2', kind: 'cylinder', at: [-1.3, -0.4, -0.6], size: 0.6, color: [0.75, 0.75, 0.8] },
        ],
      };
      s.background = { ...s.background, kind: 'gradient', color: [0.5, 0.42, 0.55], color2: [0.95, 0.6, 0.4] };
      s.camera = { ...s.camera, dist: 4.6, elev: 14, turntable: 6 };
      return s;
    },
  },
  {
    key: 'cut', label: 'Cut reveal', blurb: 'A glowing plane sweeps up through the scan, building it from the ground.',
    make: () => {
      const s = starterSplatScene();
      const c = newEffect('crop', 'e1', { shape: 'plane', normal: [0, 1, 0], offset: 0, softness: 0.03, edge: 0.05, edgeColor: [1, 0.75, 0.3], glow: 5 });
      c.animate = { param: 'offset', speed: 0.07, from: -1, to: 1 };
      s.effects = [c];
      s.look = { tone: 'aces', bloom: { on: true, intensity: 0.6, threshold: 0.8, radius: 32 } };
      return s;
    },
  },
];

export const splatTemplate = (key: string) => SPLAT_TEMPLATES.find(t => t.key === key);

/** The template over what is being edited: your own scan and where you put it stay. Pure. */
export function withTemplate(current: SplatBuilderSpec, t: SplatTemplate): SplatBuilderSpec {
  const next = t.make();
  if (current.scan.source.kind === 'file') {
    next.scan = structuredClone(current.scan);
    next.place = structuredClone(current.place);
  }
  if (current.textures?.length) next.textures = structuredClone(current.textures);
  return next;
}
