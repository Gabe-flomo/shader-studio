/**
 * combineExamples.ts — Combine's examples (docs/combine.md): five of its presets as the graphs Done leaves, built
 * from ordinary nodes. The products are made by their own builders (a 3D build from a recipe, a 2D build, the
 * built-in photos) and the glue by Combine (combine/build.ts); every node carries a note saying what it does and why.
 *
 * Not in a folder (each holds its curated five): listed with RETIRED_EXAMPLE_KEYS, shown under their nodes (Used in)
 * and opened by key (Sparks trace a star under Ride a Path, Fireflies round a sculpture under Follow surface (3D Scene)). Reopening one in the Scene builder offers "Edit Combined scene".
 */
import type { ExampleGraph } from './exampleIndex';
import type { GraphNode } from '../types/nodeGraph';
import { n } from './graphBuilder';
import { presetGraph } from '../combine/presets';
import { applyCombine } from '../combine/apply';
import { COMBINE_EXAMPLE_INDEX } from './combineExampleIndex';

export const COMBINE_EXAMPLE_KEYS = Object.keys(COMBINE_EXAMPLE_INDEX);

const PRESET_OF: Record<string, string> = {
  combinePhotoInRoom: 'photoInRoom', combinePeopleRings: 'peopleRings', combineSparksTrace: 'sparksTrace', combineFireflies: 'firefliesSculpture', combineTwoLooks: 'twoLooks',
};

/** One example: the preset's products and its glue, ids counted from 1, with the Output. */
function exampleOf(key: string): ExampleGraph {
  let k = 0;
  const nextId = () => `cb${++k}`;
  const output = n('output', 'out', 0, 0, { __comment: 'Output: shows the combined scene (Combine wires the top of its stack here).' });
  const made = presetGraph(PRESET_OF[key], [output], nextId)!;
  const r = applyCombine(made.nodes, made.spec, { nextId });
  const nodes: GraphNode[] = r.nodes;
  // The Output to the right of everything.
  const out = nodes.find(x => x.id === 'out')!;
  out.position = { x: Math.max(...nodes.filter(x => x.id !== 'out').map(x => x.position.x)) + 420, y: 0 };
  return { ...COMBINE_EXAMPLE_INDEX[key], nodes, counter: k + 1 };
}

export function buildCombineExamples(): Record<string, ExampleGraph> {
  return Object.fromEntries(COMBINE_EXAMPLE_KEYS.map(key => [key, exampleOf(key)]));
}
