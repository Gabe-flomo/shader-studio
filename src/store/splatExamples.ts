/**
 * splatExamples.ts — an example for the Splat Scene node (docs/splat-scene.md): a generated scan (two interlocking
 * rings of coloured Gaussians: no file) in the 3D: Shapes + Ground scene, turning slowly so the rings pass through
 * the sphere and the box. Built from that example (its nodes copied), so the scene never drifts from it.
 *
 * Every node the example adds carries a comment saying what it is and why.
 */
import type { ExampleGraph } from './exampleIndex';
import type { GraphNode } from '../types/nodeGraph';
import { n } from './graphBuilder';

export const SPLAT_EXAMPLE_INDEX: Record<string, { label: string; description: string }> = {
  splatRingsInScene: {
    label: '3D: Splat scan in a scene',
    description: 'A Splat Scene (a generated scan: two rings of 60 000 coloured Gaussians) seen through the March Camera and put together with the ray-marched shapes by distance: the rings pass through the sphere and the box, hidden where the shapes are in front. Drop your own .ply, .splat or .spz on the Splat Scene card to put a real scan there.',
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
  };
}
