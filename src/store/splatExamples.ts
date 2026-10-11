/**
 * splatExamples.ts — examples for the Splat Scene node (docs/splat-scene.md):
 *  - a generated scan (two interlocking rings of coloured Gaussians: no file) in the 3D: Shapes + Ground scene, turning
 *    slowly so the rings pass through the sphere and the box. Built from that example (its nodes copied), so the scene
 *    never drifts from it;
 *  - per-splat modifiers on a generated ball: a custom chain (Splat Attributes → Expression Block → Set Splat) and two
 *    recipes (Explode on an LFO, a wobble);
 *  - the graph of the Play example "Splats: a scan dissolving" (playExamples.ts): a Dissolve whose Amount Play sweeps.
 *
 * Every node the examples add carries a comment saying what it is and why.
 */
import type { ExampleGraph } from './exampleIndex';
import type { GraphNode } from '../types/nodeGraph';
import { n } from './graphBuilder';
import { expr } from './agentExampleKit';

export const SPLAT_EXAMPLE_INDEX: Record<string, { label: string; description: string }> = {
  splatRingsInScene: {
    label: '3D: Splat scan in a scene',
    description: 'A Splat Scene (a generated scan: two rings of 60 000 coloured Gaussians) seen through the March Camera and put together with the ray-marched shapes by distance: the rings pass through the sphere and the box, hidden where the shapes are in front. Drop your own .ply, .splat or .spz on the Splat Scene card to put a real scan there.',
  },
  splatModifiersBall: {
    label: '3D: Splat modifiers',
    description: 'Every splat of a generated scan changed by nodes before it is drawn: Splat Attributes → an Expression Block colours it by height → Set Splat, then Splat Explode (its Amount breathing on an LFO) and a wobble. The chain runs once per splat, in the Splat Scene\'s Modifier.',
  },
};

export const SPLAT_EXAMPLE_KEYS = Object.keys(SPLAT_EXAMPLE_INDEX);

const note = (...lines: string[]) => ({ __comment: lines.join('\n') });

export function buildSplatExamples(all: Record<string, ExampleGraph>): Record<string, ExampleGraph> {
  const src = all.shapesAndGround3D;
  if (!src?.nodes) return {};
  const nodes = JSON.parse(JSON.stringify(src.nodes)) as GraphNode[];
  const out = nodes.find(x => x.type === 'output');
  const loop = nodes.find(x => x.type === 'marchLoopGroup');
  const cam = nodes.find(x => x.type === 'marchCamera');
  const time = nodes.find(x => x.type === 'time');
  if (!out || !loop || !cam || !time) return {};
  const x0 = (loop.position?.x ?? 900) + 440, y0 = (loop.position?.y ?? 200) + 40;
  const added: GraphNode[] = [
    n('multiply', 'splatTurn', x0 - 420, y0 + 520, { b: 12, ...note('Time × 12: the scan\'s turn in degrees, 12 a second.', 'Why: the rings sweep through the sphere and the box, so you can see which is in front where.') }, { a: [time.id, 'time'] }),
    n('makeVec3', 'splatRot', x0 - 140, y0 + 520, { r: 0, g: 0, b: 0, ...note('Make Vec3: the turn as Rotation (X, Y, Z in degrees): only Y moves.', 'Why: Rotation on the Splat Scene takes a vec3; wired, it replaces the Rotation sliders, and the scan turns on the GPU with no re-sort until it has turned a little.') }, { g: ['splatTurn', 'result'] }),
    n('splatScene', 'splatScan', x0, y0, {
      demo: 'rings', demoCount: 60000, scale: 0.9,
      ...note(
        'Splat Scene: a Gaussian splat scan, here a generated one (two interlocking rings of 60 000 splats). Drop a .ply, .splat or .spz from Polycam, Luma, Scaniverse or Postshot on this card to use a real scan.',
        'Ray Origin and Ray Dir are the March Camera\'s, so the scan is seen through the same camera as the shapes. Scene, Scene distance and Scene hit are the March Loop\'s: at each pixel the nearer one wins.',
        'Fit to the scene sets Position and Scale for a real scan, which is usually metres across and off-centre.',
      ),
    }, { ro: [cam.id, 'ro'], rd: [cam.id, 'rd'], scene: [loop.id, 'color'], dist: [loop.id, 'dist'], hit: [loop.id, 'hit'], rotation: ['splatRot', 'rgb'] }),
  ];
  out.position = { x: x0 + 460, y: y0 };
  out.inputs = { ...out.inputs, color: { ...out.inputs.color, connection: { nodeId: 'splatScan', outputKey: 'color' } } };
  return {
    splatRingsInScene: {
      ...SPLAT_EXAMPLE_INDEX.splatRingsInScene,
      counter: (src.counter ?? 0) + 10,
      nodes: [...nodes, ...added],
    },
    splatModifiersBall: { ...SPLAT_EXAMPLE_INDEX.splatModifiersBall, counter: 20, nodes: splatModifiersNodes() },
  };
}

/** A slow turn for a scan: Time × `speed` degrees a second round Y, as the Splat Scene's Rotation. */
function turn(prefix: string, x: number, y: number, speed: number): GraphNode[] {
  return [
    n('time', `${prefix}Time`, x, y, note('Time: the clock, in seconds.')),
    n('multiply', `${prefix}Turn`, x + 300, y, { b: speed, ...note(`Time × ${speed}: the scan's turn in degrees, ${speed} a second.`, 'Why: turning shows the scan (and what the modifiers do to it) from every side.') }, { a: [`${prefix}Time`, 'time'] }),
    n('makeVec3', `${prefix}Rot`, x + 600, y, { r: 0, g: 0, b: 0, ...note('Make Vec3: the turn as the Splat Scene\'s Rotation (X, Y, Z in degrees): only Y moves.') }, { g: [`${prefix}Turn`, 'result'] }),
  ];
}

/**
 * The Studio example: a custom chain (Splat Attributes → an Expression Block → Set Splat) and two recipes (Explode,
 * its Amount on an LFO wired into its param socket; Wave as a wobble), into the Splat Scene's Modifier.
 */
export function splatModifiersNodes(): GraphNode[] {
  const attrs = n('splatAttributes', 'smAttr', 0, 0, note(
    'Splat Attributes: one splat as numbers. "In the scan" is where it sits in the scan (scene units, +Y up), so whatever reads it sticks to the scan as it turns; Color is its own colour.',
    'Why: the start of a chain of ordinary nodes that runs once for every splat.',
  ));
  const heat = expr('smHeat', 420, 0, {
    label: 'Colour by height',
    inputs: [{ name: 'p', type: 'vec3' }, { name: 'c', type: 'vec3' }],
    // h: 0 at the bottom of the ball, 1 at the top. The result keeps 40% of the splat's own colour.
    lines: [['float h', 'clamp(p.y * 0.6 + 0.5, 0.0, 1.0)']],
    result: 'mix(c, mix(vec3(0.15, 0.45, 1.0), vec3(1.0, 0.45, 0.15), h), 0.6)',
    outputType: 'vec3',
    wires: { p: ['smAttr', 'local'], c: ['smAttr', 'color'] },
    note: [
      'Colour by height (an Expression Block): blue at the bottom of the scan, orange at the top, mixed 60/40 with each splat\'s own colour.',
      'h: the splat\'s height in the scan (y), from about −0.85 to 0.85, turned into 0–1.',
      'Result: a blue→orange ramp by h, mixed over the splat\'s colour c by 0.6. Try: 1.0 instead of 0.6 for the pure ramp.',
    ],
  });
  const set = n('splatSet', 'smSet', 840, 0, note(
    'Set Splat: the Expression Block\'s colour becomes the splat\'s colour. Its other sockets are unwired, so position, opacity and size stay as they were.',
  ), { color: ['smHeat', 'result'] });
  const pulse = n('lfo', 'smPulse', 840, 360, { waveform: 'sine', freq: 0.12, amplitude: 0.5, offset: 0.5, ...note(
    'LFO: a slow sine from 0 to 1, once every eight seconds.',
    'Why: wired into Explode\'s Amount socket, it blows the scan apart and brings it home again, over and over.',
  ) });
  const explode = n('splatExplode', 'smExplode', 1260, 0, { distance: 1.1, scatter: 0.45, stagger: 0.6, spin: 0.35, ...note(
    'Splat Explode: blows the splats out from the centre (each a little after the last: Stagger 0.6), turning as they go (Spin).',
    'Its Amount comes from the LFO (the socket beside the slider). The engine sorts the splats by where they have moved to, so they still blend far to near.',
  ) }, { splat: ['smSet', 'splat'] });
  explode.inputs.__param_amount = { type: 'float', label: 'Amount', connection: { nodeId: 'smPulse', outputKey: 'value' } };
  const wave = n('splatWave', 'smWave', 1680, 0, { mode: 'wobble', amplitude: 0.025, frequency: 4, speed: 0.7, ...note(
    'Splat Wave, Wobble: every splat drifts a little through slow noise, so the surface shimmers even at rest.',
    'Try: Kind Wave and Amplitude 0.08 for ripples running across the scan; Twist for a spiral.',
  ) }, { splat: ['smExplode', 'splat'] });
  return [
    attrs, heat, set, pulse, explode, wave,
    ...turn('sm', 1260, 600, 10),
    n('splatScene', 'smScan', 2100, 0, {
      demo: 'blob', demoCount: 150000,
      ...note(
        'Splat Scene: a generated scan (a lumpy ball of 150 000 splats; drop a .ply, .splat or .spz here for a real one).',
        'Its Modifier takes the chain: Set Splat → Explode → Wave, applied in that order to every splat before it is drawn.',
        'Unwired Ray Origin / Ray Dir: a camera 3 back, looking at the middle.',
      ),
    }, { modifier: ['smWave', 'splat'], rotation: ['smRot', 'rgb'] }),
    n('output', 'smOut', 2520, 0, {}, { color: ['smScan', 'color'] }),
  ];
}

/** The Play example's ids (playExamples.ts points its controls at them). */
export const SPLAT_PLAY = { dissolve: 'sdDissolve', scan: 'sdScan' } as const;

/**
 * The Play example (docs/depth-and-splats-plan.md phase 3, "a scan dissolving by noise, driven from Play"): a
 * generated scan turning slowly, its Modifier a Splat Dissolve whose Amount Play sweeps.
 */
export function splatDissolvePlayNodes(): GraphNode[] {
  return [
    n('splatDissolve', SPLAT_PLAY.dissolve, 0, 0, {
      amount: 0.35, scale: 1.6, evolve: 0.08, softness: 0.08, edge: 0.06, edgeColor: [1, 0.5, 0.15], glow: 5, mode: 'both', drift: 0.3,
      ...note(
        'Splat Dissolve: a threshold (Amount) sweeps through noise in the scan; splats below it fade and shrink away and drift up, and the band round it glows orange.',
        'Amount is a Play control, swept by an LFO; Edge glow follows the mouse. Noise scale 1.6 dissolves in patches about a third of the ball across.',
      ),
    }),
    ...turn('sd', 0, 420, 8),
    n('splatScene', SPLAT_PLAY.scan, 420, 0, {
      demo: 'blob', demoCount: 200000,
      ...note(
        'Splat Scene: a generated scan (a lumpy ball of 200 000 splats). Drop a .ply, .splat or .spz on this card to dissolve your own.',
        'Its Modifier is the Dissolve: it runs once for every splat before they are drawn.',
      ),
    }, { modifier: [SPLAT_PLAY.dissolve, 'splat'], rotation: ['sdRot', 'rgb'] }),
    n('output', 'sdOut', 840, 0, {}, { color: [SPLAT_PLAY.scan, 'color'] }),
  ];
}
