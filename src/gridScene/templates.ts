/**
 * templates.ts — the Grid builder's starting points (its presets strip). Each is a whole spec:
 * loading one replaces the form, one undo step.
 */
import { BLOCK_BY_ID, blockFromEntry } from '../sceneBuilder2d/blockLibrary';
import { emptyGridScene, newShape, starterGridScene, type GridSceneSpec } from './spec';

export interface GridTemplate { key: string; label: string; blurb: string; make: () => GridSceneSpec }

const rowsOf = (s: GridSceneSpec, art: string[], id: string, x0 = 0, y0 = 0) =>
  art.forEach((row, j) => [...row].forEach((ch, i) => { if (ch !== '.') s.cells.push({ x: x0 + i, y: y0 + j, s: ch === 'X' ? id : ch }); }));

export const GRID_TEMPLATES: GridTemplate[] = [
  { key: 'hearts', label: 'Pixel heart', blurb: 'A heart of dots bobbing in a wave.', make: starterGridScene },
  {
    key: 'checker', label: 'Checker dance', blurb: 'The checker pattern fills every cell with squares that swap.', make: () => {
      const s = emptyGridScene();
      s.cols = 8; s.rows = 8;
      s.shapes = [newShape('A', { kind: 'square', size: 0.8, color: [1, 0.82, 0.3], spin: 0.15 })];
      s.pattern = { kind: 'checker', target: 'size', amount: 1, freq: 4, speed: 0.4, arms: 3, fill: 'A' };
      s.look.lines = false;
      return s;
    },
  },
  {
    key: 'pond', label: 'Ripple pond', blurb: 'Rings ripple out from the centre through a field of circles.', make: () => {
      const s = emptyGridScene();
      s.cols = 16; s.rows = 16;
      s.shapes = [newShape('A', { kind: 'ring', size: 0.8, color: [0.35, 0.8, 1] })];
      s.pattern = { kind: 'ripple', target: 'size', amount: 0.9, freq: 3, speed: 0.35, arms: 3, fill: 'A' };
      return s;
    },
  },
  {
    key: 'spiral', label: 'Spiral stars', blurb: 'Stars turning with spiral arms.', make: () => {
      const s = emptyGridScene();
      s.cols = 14; s.rows = 14;
      s.shapes = [newShape('A', { kind: 'star', size: 0.85, color: [1, 0.55, 0.75] })];
      s.pattern = { kind: 'spiral', target: 'turn', amount: 0.8, freq: 2, speed: 0.25, arms: 3, fill: 'A' };
      s.look.lines = false;
      return s;
    },
  },
  {
    key: 'traffic', label: 'Traffic', blurb: 'Dots travel along rows; in the middle column they become stars, and swap colours with the blocks they pass.', make: () => {
      const s = emptyGridScene();
      s.shapes = [
        newShape('A', { kind: 'square', size: 0.55, color: [0.5, 1, 0.6], outline: 0.08 }),
        newShape('B', { kind: 'circle', size: 0.5, color: [1, 0.45, 0.7], motion: { path: 'travel', xy: [1, 0], speed: 1, lag: 0 } }),
        newShape('C', { kind: 'star', size: 0.9, color: [1, 0.85, 0.3] }),
      ];
      for (const y of [1, 4, 7]) { s.cells.push({ x: 0, y, s: 'B' }, { x: 5, y, s: 'B' }); }
      for (const [x, y] of [[2, 1], [7, 4], [3, 7], [8, 1]]) s.cells.push({ x, y, s: 'A' });
      s.rules = [
        { id: 'r1', on: true, when: { kind: 'column', a: 'B', x: 5 }, do: { kind: 'become', shape: 'C' } },
        { id: 'r2', on: true, when: { kind: 'sameCell', a: 'B', b: 'A' }, do: { kind: 'swap' } },
      ];
      return s;
    },
  },
  {
    key: 'weave', label: 'Warped weave', blurb: 'Diagonal waves of diamonds on a grid bent by a sine weave.', make: () => {
      const s = emptyGridScene();
      s.cols = 12; s.rows = 12;
      s.shapes = [newShape('A', { kind: 'diamond', size: 0.75, color: [0.75, 0.55, 1] })];
      s.pattern = { kind: 'diagonal', target: 'hue', amount: 0.7, freq: 2, speed: 0.3, arms: 3, fill: 'A' };
      const w = blockFromEntry(BLOCK_BY_ID['sine-weave']);
      s.warps = [w];
      return s;
    },
  },
  {
    key: 'orbit', label: 'Orbiters', blurb: 'A ring of shapes circling their cells, each a little later than the last.', make: () => {
      const s = emptyGridScene();
      s.cols = 9; s.rows = 9;
      s.shapes = [newShape('A', { kind: 'circle', size: 0.45, color: [0.35, 0.8, 1], motion: { path: 'circle', xy: [0.35, 0.35], speed: 0.5, lag: 0.12 } })];
      rowsOf(s, ['..XXXXX..', '.X.....X.', 'X.......X', 'X.......X', 'X.......X', 'X.......X', 'X.......X', '.X.....X.', '..XXXXX..'], 'A');
      return s;
    },
  },
];

export const gridTemplate = (key: string): GridSceneSpec => (GRID_TEMPLATES.find(t => t.key === key) ?? GRID_TEMPLATES[0]).make();
