/**
 * comboExamples.ts — Node Combos built from the node definitions (see
 * graphBuilder.ts). These show the Grid Pattern → your own shape → Grid
 * Paint flow: Grid Pattern hands out a Cell UV that already carries the
 * pattern and the affect point, anything goes in between, Grid Paint
 * brings the distance or colour back and paints it gated by Placed.
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

  return out3;
}
