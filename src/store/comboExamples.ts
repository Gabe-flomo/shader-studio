/**
 * comboExamples.ts — Node Combos built from the node definitions (see
 * graphBuilder.ts). These show the Grid Pattern → your own shape → Grid
 * Paint flow: Grid Pattern hands out a Cell UV that already carries the
 * pattern and the affect point, anything goes in between, Grid Paint
 * brings the distance or colour back and paints it gated by Placed. And the
 * one-wire version: a shape wired into a field socket (Grid Pattern's
 * Shape, the Array node's Shape), with the Cell node for per-cell variation.
 */
import type { ExampleGraph } from './exampleIndex';
import { ctl, n, out, play, time, uv } from './graphBuilder';

export const COMBO_EXAMPLE_INDEX: Record<string, { label: string; description: string; play: true }> = {
  comboGridPaintShapes: {
    label: 'Combo: Grid Pattern + Shapes + Grid Paint', play: true,
    description: 'A shape of your own on the grid: Grid Pattern’s Cell UV → Box SDF ∪ Circle SDF (smooth Union) → Grid Paint. The checkerboard comes from Grid Pattern’s Placed, the mouse spins the cells near it (Cell UV is already rotated), and a Palette of the hashed Cell ID colours each one.',
  },
  comboGridPaintPictures: {
    label: 'Combo: Grid Pattern + FBM per cell', play: true,
    description: 'Colour instead of a distance: Cell UV → FBM → Palette into Grid Paint’s Colour with nothing on Distance, so every placed cell shows its own little picture. Random placement at 70 % density; the mouse hides the cells near it.',
  },
  comboGridShapeByWire: {
    label: 'Combo: Grid Pattern + Shape by wire', play: true,
    description: 'One wire, no Grid Paint: Circle SDF straight into Grid Pattern’s Shape field socket, a Palette into Picture. A Cell node inside the chain hashes each cell’s ID into its own radius and colour. The mouse pulls the circles toward it with Overflow on Neighbours, so a circle dragged past its cell edge carries on into the next cell instead of being cut off.',
  },
  comboArrayStars: {
    label: 'Combo: Array of stars', play: true,
    description: 'The Array node repeats a Star SDF wired into its Shape field socket twelve times on a ring. A Cell node gives each copy its Index: the stars grow around the ring and a rainbow Palette colours them in order. Turn copies makes every star point away from the centre; Time turns the ring.',
  },
  comboGridPaintGlow: {
    label: 'Combo: Grid Pattern + SDF Glow', play: true,
    description: 'Light on a grid: Cell UV → Circle SDF → SDF Glow, its Tinted colour into Grid Paint (colour only) gated by Placed, Tone Map after. Diagonal stripes; the mouse grows the lamps near it because Grid Pattern scales Cell UV.',
  },
};

export function buildComboExamples(): Record<string, ExampleGraph> {
  const out3: Record<string, ExampleGraph> = {};
  const add = (key: string, nodes: ExampleGraph['nodes'], controls: ReturnType<typeof ctl>[], notes: string) => {
    out3[key] = { ...COMBO_EXAMPLE_INDEX[key], counter: 40, nodes, play: play(controls, notes) };
  };

  add('comboGridPaintShapes', [
    uv(),
    n('mouse', 'mouse', 40, 420),
    n('gridPattern', 'gp', 300, 220, { columns: 9, pattern: 'checker', affect: 'spin', affectRadius: 0.9, affectSoftness: 0.9, jitter: 0.0 }, { uv: ['uv', 'uv'], affectPos: ['mouse', 'uv'] }),
    n('boxSDF', 'box', 600, 120, { width: 0.26, height: 0.1 }, { position: ['gp', 'cellUV'] }),
    n('circleSDF', 'circ', 600, 300, { radius: 0.14, posX: 0.0, posY: 0.14 }, { position: ['gp', 'cellUV'] }),
    n('sdfUnion', 'un', 860, 200, { k: 0.08 }, { a: ['box', 'distance'], b: ['circ', 'distance'] }),
    n('noiseFloat', 'hash', 600, 480, { mode: 'hash', scale: 1, speed: 0 }, { uv: ['gp', 'cellID'] }),
    n('palette', 'pal', 860, 480, { preset: '2', scale: 1 }, { value: ['hash', 'value'] }),
    n('gridPaint', 'paint', 1120, 220, { background: [0.06, 0.05, 0.09] }, { distance: ['un', 'dist'], color: ['pal', 'color'], placed: ['gp', 'placed'] }),
    out(['paint', 'color'], 1380),
  ], [ctl('k', 'un::k', 'Blend', 0, 0.3, 0.005), ctl('r', 'gp::affectRadius', 'Mouse radius', 0.1, 3, 0.01), ctl('o', 'paint::strokeWidth', 'Outline', 0, 0.3, 0.005)],
  `**What it shows.** The grid flow with a shape of your own. Grid Pattern only decides the cells: which ones are placed (a checkerboard) and how the mouse affects them (Spin). Its Cell UV comes out already rotated per cell, so the Box SDF and Circle SDF drawn in it turn with the mouse without knowing anything about the grid. Union blends the two into one keyhole shape; Grid Paint brings the distance back and paints it, gated by Placed.

**How it is built.** Grid Pattern → Cell UV → Box SDF and Circle SDF → Union → Grid Paint (Distance). Grid Pattern's Placed → Grid Paint's Placed. Cell ID → Noise Float (Hash) → Palette → Grid Paint's Colour gives each cell its own colour.

**Try.** Raise Outline to paint just the edge. Swap the Union for a Custom Function that takes a vec2 and returns a float: anything that measures a distance in Cell UV works here.`);

  add('comboGridPaintPictures', [
    uv(),
    time(40, 520),
    n('mouse', 'mouse', 40, 420),
    n('gridPattern', 'gp', 300, 220, { columns: 6, pattern: 'random', density: 0.7, affect: 'hide', affectRadius: 0.8, affectSoftness: 0.6 }, { uv: ['uv', 'uv'], affectPos: ['mouse', 'uv'] }),
    n('fbm', 'fbm', 600, 220, { octaves: 4, scale: 2.5, time_scale: 0.2 }, { uv: ['gp', 'cellUV'], time: ['time', 'time'] }),
    n('palette', 'pal', 860, 220, { preset: '7', scale: 1 }, { value: ['fbm', 'value'] }),
    n('gridPaint', 'paint', 1120, 220, { background: [0.04, 0.04, 0.06] }, { color: ['pal', 'color'], placed: ['gp', 'placed'] }),
    out(['paint', 'color'], 1380),
  ], [ctl('d', 'gp::density', 'Density', 0, 1, 0.01), ctl('s', 'fbm::scale', 'Picture scale', 0.5, 8, 0.05), ctl('r', 'gp::affectRadius', 'Mouse radius', 0.1, 3, 0.01)],
  `**What it shows.** Grid Paint with a colour instead of a distance. Nothing is wired into Distance, so every placed cell is filled edge to edge with whatever colour arrives: here an FBM read in Cell UV, so each cell shows its own little cloud, all drifting with Time. Random placement leaves 30 % of the cells empty and the mouse hides the ones near it.

**How it is built.** Grid Pattern → Cell UV → FBM → Palette → Grid Paint (Colour), Placed across. Any picture-making chain fits in the middle: a Texture Input, a Voronoi, another Grid Pattern.

**Try.** Change Density. Set Affect to Shrink: the FBM zooms in near the mouse because Cell UV is scaled.`);

  add('comboGridPaintGlow', [
    uv(),
    n('mouse', 'mouse', 40, 420),
    n('gridPattern', 'gp', 300, 220, { columns: 7, pattern: 'diagonal', affect: 'grow', affectRadius: 1.0, affectSoftness: 0.9, affectAmount: 1.5 }, { uv: ['uv', 'uv'], affectPos: ['mouse', 'uv'] }),
    n('circleSDF', 'circ', 600, 220, { radius: 0.1 }, { position: ['gp', 'cellUV'] }),
    n('light', 'glow', 860, 220, { mode: 'glow', brightness: 14, tint: [1.0, 0.62, 0.3] }, { distance: ['circ', 'distance'] }),
    n('gridPaint', 'paint', 1120, 220, { background: [0.03, 0.03, 0.05] }, { color: ['glow', 'tinted'], placed: ['gp', 'placed'] }),
    n('toneMap', 'tone', 1380, 220, { mode: 'aces' }, { color: ['paint', 'color'] }),
    out(['tone', 'color'], 1640),
  ], [ctl('f', 'glow::brightness', 'Falloff', 2, 40, 0.5), ctl('a', 'gp::affectAmount', 'Grow', 0, 3, 0.01), ctl('r', 'circ::radius', 'Lamp radius', 0.02, 0.4, 0.005)],
  `**What it shows.** Light instead of a fill. Circle SDF in Cell UV goes through SDF Glow, and its Tinted colour goes into Grid Paint's Colour with Distance empty, so the whole cell shows the glow and Placed switches the diagonal stripes on and off. Grow scales Cell UV near the mouse, which makes the lamps there bigger and brighter.

**How it is built.** Grid Pattern → Cell UV → Circle SDF → SDF Glow → Grid Paint (Colour) → Tone Map. Placed across from Grid Pattern.

**Try.** Switch SDF Glow to Rings. Set the pattern to Random. Wire Grid Pattern's Influence into SDF Glow's Falloff through a Remap so the mouse also sharpens the lamps.`);

  add('comboGridShapeByWire', [
    uv(),
    n('mouse', 'mouse', 40, 420),
    n('fieldCell', 'cell', 40, 620),
    n('noiseFloat', 'hash', 300, 620, { mode: 'hash', scale: 1, speed: 0, outMin: 0.16, outMax: 0.4 }, { uv: ['cell', 'cellID'] }),
    n('circleSDF', 'circ', 560, 520, { radius: 0.3 }, { radius: ['hash', 'value'] }),
    n('palette', 'pal', 560, 720, { preset: '3', scale: 1 }, { value: ['hash', 'value'] }),
    n('gridPattern', 'gp', 860, 220, { columns: 8, pattern: 'all', affect: 'pull', affectRadius: 0.9, affectSoftness: 0.8, affectAmount: 0.9, overflow: 'neighbours', background: [0.05, 0.05, 0.08] },
      { uv: ['uv', 'uv'], affectPos: ['mouse', 'uv'], shape: ['circ', 'distance'], picture: ['pal', 'color'] }),
    out(['gp', 'color'], 1140),
  ], [ctl('a', 'gp::affectAmount', 'Pull', 0, 2, 0.01), ctl('r', 'gp::affectRadius', 'Mouse radius', 0.1, 3, 0.01), ctl('s', 'hash::outMax', 'Largest radius', 0.1, 0.8, 0.005)],
  `**What it shows.** A shape of your own on the grid with one wire. Grid Pattern's **Shape** is a field socket (the small ƒ next to its name): it doesn't take Circle SDF's value, it takes Circle SDF's code, and calls it once in every cell, in that cell's coordinates. **Picture** does the same for colour. Inside that chain the **Cell** node is the cell being drawn, so hashing its Cell ID gives every circle its own radius and colour.

**How it is built.** Cell → Noise Float (Hash, Out Min/Max 0.16–0.4) → Circle SDF's Radius → Grid Pattern's Shape. The same hash → Palette → Grid Pattern's Picture. Circle SDF's UV is left empty: inside a field chain an empty UV is the cell's coordinates. Affect is Pull toward the mouse and **Overflow** is Neighbours: each pixel also draws the circles of the eight cells around it, so a circle pulled across a cell border stays whole.

**Try.** Set Overflow back to Clip and pull: the circles are cut at their cell edges. Raise Largest radius past 0.5 so neighbours overlap. Swap Circle SDF for Shape SDF (Heart, Star) without touching anything else.`);

  add('comboArrayStars', [
    time(40, 420),
    n('fieldCell', 'cell', 40, 220),
    n('shapeSDF', 'star', 320, 160, { shape: 'starN', r: 0.06, n_pts: 5, m_pts: 2.5, __inExpr_r: '0.045 + input * 0.009' }, { r: ['cell', 'index'] }),
    n('palette', 'pal', 320, 400, { preset: '1', scale: 1, __inExpr_value: 'input / 12.0' }, { value: ['cell', 'index'] }),
    n('arrayField', 'arr', 620, 220, { layout: 'ring', count: 12, radius: 0.62, combine: 'min', turn: true, antialias: 0.004, background: [0.04, 0.04, 0.07], __inExpr_rotation: 'input * 0.2' },
      { shape: ['star', 'distance'], picture: ['pal', 'color'], rotation: ['time', 'time'] }),
    out(['arr', 'color'], 900),
  ], [ctl('r', 'arr::radius', 'Ring radius', 0.1, 1.2, 0.005), ctl('w', 'arr::sweep', 'Sweep', 0.5, 6.2832, 0.01), ctl('s', 'arr::startAngle', 'Start angle', -3.1416, 3.1416, 0.01)],
  `**What it shows.** The Array node: one shape, N copies. The Star SDF is wired into Array's **Shape** field socket, so Array calls it twelve times, once per copy, in that copy's own coordinates, and combines the twelve distances into one (Union). The **Cell** node inside the star's chain is the copy being drawn: its Index (0 … 11) grows the stars around the ring through an input expression on Radius, and a Palette of the Index colours them in order through **Picture**.

**How it is built.** Cell (Index) → Shape SDF (Star, Radius = 0.045 + index × 0.009) → Array (Ring, 12) Shape. Cell (Index) → Palette → Array Picture. Time → Array Rotation (× 0.2) turns the ring; Turn copies keeps each star pointing outward.

**Try.** Lower Sweep: the stars fan out over an arc from first to last. Switch Layout to Line or Grid. Set Combine to Smooth union and raise Smoothness until the stars melt into one another.`);

  return out3;
}
