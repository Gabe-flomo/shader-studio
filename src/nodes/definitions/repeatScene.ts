/**
 * repeatScene.ts — Repeat Scene and Repeat Cell (docs/repeat-scene.md).
 *
 * Repeat Scene takes a whole Scene Group and repeats it in a 3D grid, between the Scene Group
 * and the March Loop. Unlike Repeat 3D (which only folds the position, so the shape is measured
 * once, in its own cell), it can measure the neighbouring cells too, so copies that reach past
 * their cell (overlap, move, vary in size) don't get cut off or torn:
 *
 *   (Each call leaves the nearest copy's cell in g_cell3, so Repeat Cell after the loop can colour by copy.)
 *
 *   - Off: the own cell only (as Repeat 3D).
 *   - Wall cap: own cell, but never step past the cell's wall. Free; fixes tearing when every copy
 *     is different but stays inside its cell.
 *   - Nearest 8: the 8 cells round the corner the point is nearest (not 27): copies may reach up
 *     to half a cell into their neighbours. 8× the scene's cost.
 *   - Nearest 8 + skip (default): the own cell first, the other 7 only when they could be nearer
 *     (the point is closer to a wall than to its own shape, by Overlap). Most steps pay ~1×.
 *
 * The compiler builds it (shaderAssembler.compileRepeatSceneNode): it wraps the scene's function
 * and sets the global `g_cell3` (each copy's cell) before each call, which Repeat Cell reads.
 */
import type { NodeDefinition } from '../../types/nodeGraph';

/** The global the repeated scene's cell lives in while it is measured. */
export const CELL3_GLOBAL = 'g_cell3';
export const CELL3_DECL = `vec3 ${CELL3_GLOBAL} = vec3(0.0);`;

export const RepeatSceneNode: NodeDefinition = {
  type: 'repeatScene', label: 'Repeat Scene', category: '3D Scene',
  description: 'Repeats a whole Scene Group in a 3D grid, and can check the neighbouring cells so copies may overlap or move past their cell without being cut off. Put it between the Scene Group and the March Loop; a Repeat Cell inside the scene makes each copy different.',
  inputs: {
    scene:  { type: 'scene3d', label: 'Scene', hint: 'The scene to repeat: a Scene Group.' },
    ground: { type: 'scene3d', label: 'Not repeated', hint: 'Optional: another Scene Group added once, not repeated (a floor, a centrepiece).' },
  },
  outputs: {
    scene: { type: 'scene3d', label: 'Scene', hint: 'The repeated scene. Wire it into the March Loop\'s Scene.' },
  },
  defaultParams: { cellX: 2.0, cellY: 2.0, cellZ: 2.0, countX: 0, countY: 0, countZ: 0, neighbours: 'skip', overlap: 0.5 },
  paramDefs: {
    cellX: { label: 'Cell X', type: 'float', min: 0.1, max: 20, step: 0.05, hint: 'Width of one cell: the spacing between copies along X.' },
    cellY: { label: 'Cell Y', type: 'float', min: 0.1, max: 20, step: 0.05, hint: 'Spacing along Y. Make it huge to repeat only across a floor.' },
    cellZ: { label: 'Cell Z', type: 'float', min: 0.1, max: 20, step: 0.05, hint: 'Spacing along Z.' },
    countX: { label: 'Copies each side X', type: 'float', min: 0, max: 50, step: 1, hint: 'How many copies each side of the middle along X. 0 = forever.' },
    countY: { label: 'Copies each side Y', type: 'float', min: 0, max: 50, step: 1, hint: 'Along Y. 0 = forever.' },
    countZ: { label: 'Copies each side Z', type: 'float', min: 0, max: 50, step: 1, hint: 'Along Z. 0 = forever.' },
    neighbours: { label: 'Neighbours', type: 'select', options: [
      { value: 'off', label: 'Off: own cell only (fastest)' },
      { value: 'wall', label: 'Wall cap: never step past the cell wall (free)' },
      { value: 'near8', label: 'Nearest 8 cells (8× the cost)' },
      { value: 'skip', label: 'Nearest 8, only when needed (usually ~1–2×)' },
    ], compileTime: true, hint: 'Copies that reach past their cell get cut off unless the neighbouring cells are measured too.',
    help: 'Off measures only the cell the point is in, like Repeat 3D: fine when every copy is the same and stays inside its cell. Wall cap never lets a ray step past the cell\'s wall, so copies that differ per cell don\'t tear (still no overlap). Nearest 8 also measures the 7 cells round the corner the point is nearest, so copies may reach up to half a cell into their neighbours. "Only when needed" measures its own cell first and the other 7 only when they could be nearer: the point is closer to a wall than to its own shape (less Overlap). See docs/repeat-scene.md.' },
    overlap: { label: 'Overlap', type: 'float', min: 0, max: 2, step: 0.01, showWhen: { param: 'neighbours', value: ['skip'] }, hint: 'How far a copy may reach past its cell wall (world units). Too small and overlapping parts flicker; larger is safer and slower.' },
  },
  // Compiled by the assembler (it wraps the scene's function).
  generateGLSL: () => ({ code: '', outputVars: {} }),
};

export const RepeatCellNode: NodeDefinition = {
  type: 'repeatCell', label: 'Repeat Cell', category: '3D Transforms',
  description: 'Inside a Scene Group repeated by Repeat Scene: which copy is being measured. Use Random to vary each copy\'s size, colour, offset or spin. After the March Loop, wire the Repeat Scene and the loop\'s Hit Pos in to get the copy each ray hit (to colour it the same way). Elsewhere it reads 0.',
  inputs: {
    scene: { type: 'scene3d', label: 'Repeat Scene', hint: 'Only after the March Loop: the Repeat Scene, so the copy at Hit Pos can be looked up. Leave empty inside the scene.' },
    pos:   { type: 'vec3',    label: 'Hit Pos', hint: 'Only after the March Loop: the loop\'s Hit Pos.' },
  },
  outputs: {
    cell:   { type: 'vec3',  label: 'Cell',   hint: 'The copy\'s cell: whole numbers, (0, 0, 0) in the middle.' },
    random: { type: 'float', label: 'Random', hint: 'A random 0–1 number per copy, the same every frame.' },
    random3: { type: 'vec3', label: 'Random 3', hint: 'Three random 0–1 numbers per copy (an offset, a colour…).' },
  },
  defaultParams: { seed: 0 },
  paramDefs: {
    seed: { label: 'Seed', type: 'float', min: 0, max: 100, step: 1, hint: 'A different seed gives every copy a different random number.' },
  },
  declarationsFor: () => [CELL3_DECL],
  generateGLSL: (node, inputVars) => {
    const id = node.id;
    const seed = typeof node.params.seed === 'string' ? node.params.seed : `${Number(node.params.seed ?? 0).toFixed(1)}`;
    // After the loop: measure the repeated scene at the hit point, which leaves the nearest copy's cell in the global.
    const look = inputVars.scene && inputVars.pos && !/^MISSING_SCENE/.test(inputVars.scene) ? `    ${inputVars.scene}(${inputVars.pos});\n` : '';
    return {
      code: look + `    vec3  ${id}_cell = ${CELL3_GLOBAL};\n`
        + `    vec3  ${id}_r3   = fract(sin(vec3(dot(${CELL3_GLOBAL} + ${seed}, vec3(127.1, 311.7, 74.7)), dot(${CELL3_GLOBAL} + ${seed}, vec3(269.5, 183.3, 246.1)), dot(${CELL3_GLOBAL} + ${seed}, vec3(113.5, 271.9, 124.6)))) * 43758.5453);\n`,
      outputVars: { cell: `${id}_cell`, random: `${id}_r3.x`, random3: `${id}_r3` },
    };
  },
};
