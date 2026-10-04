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

export function buildBakeExamples(all: Record<string, ExampleGraph>): Record<string, ExampleGraph> {
  const src = all.gyroidWarped;
  if (!src?.nodes) return {};
  const nodes = JSON.parse(JSON.stringify(src.nodes)) as GraphNode[];
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
