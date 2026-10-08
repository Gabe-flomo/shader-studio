/**
 * repeatSceneExampleIndex.ts — names and descriptions for the Repeat Scene examples (graphs in
 * repeatSceneExamples.ts), apart so the examples browser can list them without loading the graphs.
 */

const ROWS: Array<[string, string, string]> = [
  ['repeatSceneBubbles', 'Repeat Scene: overlapping bubbles', 'Bubbles of random size and place in a repeated grid, reaching into each other\'s cells. Repeat Scene checks the neighbouring cells, so they overlap cleanly instead of being sliced at the cell walls. Play: spacing, overlap allowance, look around.'],
];
export const REPEAT_SCENE_EXAMPLE_KEYS = ROWS.map(r => r[0]);
export const REPEAT_SCENE_EXAMPLE_INDEX: Record<string, { label: string; description: string; play: true }> = Object.fromEntries(
  ROWS.map(([key, label, description]) => [key, { label, description, play: true as const }]),
);

