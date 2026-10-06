/**
 * builders.ts — the flow each builder window follows (docs/structure-hints.md): the 3D Scene
 * Builder is the 3D flow, Grid Rules the passes flow, Agent Rules the agents flow. For each, a
 * line per stage saying where that stage lives in the builder (or that it happens outside it, in
 * the graph), and which stage an empty section should point to next.
 *
 * Keyed by BuilderWindow's `prefsKey`. Pure data.
 */
import type { FlowId, StageId } from './stages';

export interface BuilderFlow {
  flow: FlowId;
  /** Where each stage is in this builder; a stage without a line happens outside it. */
  lines: Partial<Record<StageId, string>>;
  /** An empty section (EmptyHelp id) → the stage to do next. */
  emptyNext: Record<string, StageId>;
}

export const BUILDER_FLOWS: Record<string, BuilderFlow> = {
  'scene-builder': {
    flow: '3d',
    lines: {
      camera: 'Camera: where you look from and how wide.',
      bend: 'Bend space: twist, repeat or fold the space the shapes sit in.',
      objects: 'Shapes: spheres, boxes, tori, each with a size and a place.',
      combine: 'Combine: union, subtract or intersect groups of shapes.',
      scene: 'The tree: everything joined into one scene.',
      march: 'Quality: how far and how finely each ray steps.',
      light: 'Look: the light, shadows, ambient occlusion and fog.',
      colour: 'Look: each shape’s colour and shine, the background.',
      post: 'In the graph: tone map, grain or a Look after the scene’s output.',
    },
    emptyNext: { tree: 'objects', shapes: 'objects', combine: 'combine', warps: 'bend' },
  },
  'grid-rules': {
    flow: 'pass',
    lines: {
      source: 'Start and run: how the board starts (noise, a picture, a seed).',
      pass: 'Every step reads the board from the step before.',
      rule: 'Rules: how each cell changes from its neighbours.',
      readout: 'What the node shows: the state, age or a value to read out.',
      colour: 'Colours: a colour for each state.',
      post: 'In the graph: glow, blur or grain after the node.',
    },
    emptyNext: {},
  },
  'agent-rules': {
    flow: 'agents',
    lines: {
      sense: 'When: what an agent senses (a trail, a neighbour, a mask).',
      steer: 'Do: turn toward it, away, or at random.',
      move: 'Moving and sensing: how fast and how far each agent moves.',
      deposit: 'Do: leave a mark on a trail channel.',
      trail: 'Trail channels: how marks spread and fade.',
      draw: 'What the picture shows: the agents, a trail, or both.',
      colour: 'Species colours, and in the graph a palette.',
      post: 'In the graph: glow or grain after the picture.',
    },
    emptyNext: { 'empty-rules': 'sense' },
  },
};
