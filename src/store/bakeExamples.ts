/**
 * bakeExamples.ts — an example for Bake (docs/bake.md): a heavy raymarched
 * scene with live effects after it, ready to bake. Built from the 3D: Gyroid +
 * Domain Warp example (its nodes copied), so the scene never drifts from it.
 *
 * Every node the example adds carries a comment saying what it is and why.
 */
import type { ExampleGraph } from './exampleIndex';
import type { GraphNode } from '../types/nodeGraph';
import { n } from './graphBuilder';

export const BAKE_EXAMPLE_INDEX: Record<string, { label: string; description: string }> = {
  bakeHeavyScene: {
    label: 'Bake: a heavy 3D scene, effects on top',
    description: 'A raymarched gyroid (several milliseconds a frame) with a hue drift, film grain and a vignette after it. Right-click the March Loop Group and choose Bake…: it renders once to a video and plays that instead, and the effects after it keep running live on top. Unbake on the Baked card brings the scene back.',
  },
};

export const BAKE_EXAMPLE_KEYS = Object.keys(BAKE_EXAMPLE_INDEX);

const note = (text: string) => ({ __comment: text });

/** Notes for the nodes copied from 3D: Gyroid + Domain Warp (which has none), by id, inside groups too. */
const GYROID_NOTES: Record<string, string> = {
  uv_0: 'UV: this pixel, centred. The March Camera turns it into a ray.',
  time_1: 'Time: turns the camera round the gyroid (Rot speed on the camera).',
  cam_2: 'March Camera: a ray for every pixel, from 2.5 away, circling the scene slowly (Rot speed 0.2). Its Ray Origin and Ray Dir go to the March Loop.',
  scene_3: 'Scene Group (Warped Gyroid): the shape the March Loop asks about at every step, as one distance.',
  sp_sg: 'Scene Pos: the point the march is asking about.',
  tm_sg: 'Time, inside the scene: it drifts the warp, so the gyroid crawls.',
  dw_sg: 'Domain Warp 3D: pushes the point about with three octaves of noise (Strength 0.25) before the gyroid sees it, so the regular lattice turns organic. This warp is what makes each step expensive.',
  gy_sg: 'Gyroid Field: the triply periodic gyroid surface (sin x cos y + sin y cos z + sin z cos x), Frequency 3.5, thickened into a 0.05 shell: an endless lattice of tunnels.',
  mli: 'March Loop inputs: the ray\'s current point and step, handed to the scene each step.',
  mo_gw: 'March Loop output: what the loop keeps from each step (here only the position).',
};
function annotate(nodes: GraphNode[], notes: Record<string, string>): void {
  for (const x of nodes) {
    if (typeof x.params.__comment !== 'string' && notes[x.id]) x.params = { ...x.params, __comment: notes[x.id] };
    const sg = x.params.subgraph as { nodes?: GraphNode[] } | undefined;
    if (sg?.nodes) annotate(sg.nodes, notes);
  }
}

export function buildBakeExamples(all: Record<string, ExampleGraph>): Record<string, ExampleGraph> {
  const src = all.gyroidWarped;
  if (!src?.nodes) return {};
  const nodes = JSON.parse(JSON.stringify(src.nodes)) as GraphNode[];
  annotate(nodes, GYROID_NOTES);
  const out = nodes.find(x => x.type === 'output');
  const scene = nodes.find(x => x.id === out?.inputs.color?.connection?.nodeId);
  if (!out || !scene) return {};
  scene.params = {
    ...scene.params,
    ...note([
      'The heavy part: a raymarched gyroid, warped, lit and shaded, every pixel marching up to dozens of steps every frame.',
      'Bake it: right-click this card and choose Bake… (or press the record-dot button on the toolbar to bake the whole picture).',
      'It renders once, frame by exact frame, to a video in your Library, and a Baked node plays that in its place, in step with the clock. The effects to the right keep running live on top of it.',
      'Unbake on the Baked card puts this group and its wires back exactly.',
    ].join('\n')),
  };
  const x0 = (scene.position?.x ?? 820) + 460, y0 = scene.position?.y ?? 220;
  const added: GraphNode[] = [
    n('time', 'bakeTime', x0, y0 + 360, note('Time: drives the hue drift and the grain below. These stay live after the bake: only the scene is frozen.')),
    n('multiply', 'bakeHueSpeed', x0 + 260, y0 + 360, { b: 0.35, ...note('Time × 0.35: how fast the hues turn (radians a second).') }, { a: ['bakeTime', 'time'] }),
    n('hueRotate', 'bakeHue', x0, y0, note('Hue Rotate: turns every colour of the scene round the colour wheel, slowly. A cheap effect, so it runs live on top of the baked video.'), { color: [scene.id, 'color'], angle: ['bakeHueSpeed', 'result'] }),
    n('grain', 'bakeGrain', x0 + 380, y0, { mode: 'temporal', amount: 0.06, ...note('Grain (temporal): fresh film grain every frame, wired to Time. Baked into the video it would repeat with the loop; live, it never does.') }, { color: ['bakeHue', 'color'], time: ['bakeTime', 'time'] }),
    n('vignette', 'bakeVignette', x0 + 760, y0, { strength: 0.8, ...note('Vignette: darkens the corners. Change it while the scene is baked and it updates at once: no re-render needed.') }, { color: ['bakeGrain', 'color'] }),
  ];
  out.position = { x: x0 + 1140, y: y0 };
  out.inputs = { ...out.inputs, color: { ...out.inputs.color, connection: { nodeId: 'bakeVignette', outputKey: 'result' } } };
  return {
    bakeHeavyScene: {
      ...BAKE_EXAMPLE_INDEX.bakeHeavyScene,
      counter: (src.counter ?? 0) + 10,
      nodes: [...nodes, ...added],
    },
  };
}
