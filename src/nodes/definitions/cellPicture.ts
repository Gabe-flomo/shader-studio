import type { NodeDefinition, GraphNode } from '../../types/nodeGraph';
import { p } from './helpers';

/**
 * Cell Picture and Cell Pattern — the Grid builder's picture modes and draw modes as plain nodes
 * (docs/grid-builder.md, "Pictures in pieces" and "Draw modes"), for grids built by hand.
 *
 * Cell Picture: where a picture is read so a grid's shapes carry it. Wire a Grid's (or Grid
 * Pattern's) Cell Center, Cell UV and Cell Size, and wire the result into a Texture's or Sample
 * (texture)'s UV:
 *   - Mask: the pixel's own point (the picture stays put; the shapes are windows onto it);
 *   - Matte: colour: the cell's centre (one flat colour a cell: a mosaic);
 *   - Matte: piece: the centre plus Cell UV × Cell Size (the cell's own piece, which follows Cell
 *     UV: Grid Pattern's Cell UV is already grown, pulled and spun, so the piece goes with it).
 *
 * Cell Pattern: which cell of a drawing a cell shows. Cell ID in, Source ID out: Repeat (every
 * Period cells from Offset, each row of tiles shifted by Shift: bricks), Mirror X / Y / both
 * (across Centre), Rotate 4 (the quarter below-left of Centre turned four times). Read a per-cell
 * value (a hash, a Cell Filter, a Pad Grid's cell) at Source ID and one drawn cell is copied
 * everywhere the pattern says. The same sums as the Grid builder's gs_cell (gridScene/glsl.ts).
 */
export const CellPictureNode: NodeDefinition = {
  type: 'cellPicture',
  label: 'Cell Picture',
  category: 'Grid',
  aliases: ['Matte', 'Picture in pieces', 'Mosaic', 'Cell mask'],
  description: 'Where to read a picture so a grid\'s shapes carry it: Mask (the picture stays put, the shapes are windows onto it), Matte: colour (the cell\'s centre: one colour a cell) or Matte: piece (the cell\'s own piece, moving, turning and growing with its Cell UV). Wire a Grid\'s or Grid Pattern\'s Cell Center, Cell UV and Cell Size, and the UV out into a Texture\'s or Sample (texture)\'s UV.',
  inputs: {
    uv: { type: 'vec2', label: 'UV', hint: 'The pixel\'s point (the UV node). Mask reads the picture here.' },
    cellCenter: { type: 'vec2', label: 'Cell Center', hint: 'The cell\'s centre in UV units: Grid\'s or Grid Pattern\'s Cell Center.' },
    cellUV: { type: 'vec2', label: 'Cell UV', hint: 'The point in the cell, −0.5…0.5: Grid\'s Cell UV, or Grid Pattern\'s (already moved, grown and spun with its shape).' },
    cellSize: { type: 'float', label: 'Cell Size', hint: 'A cell\'s size in UV units: Grid\'s or Grid Pattern\'s Cell Size.' },
  },
  outputs: {
    uv: { type: 'vec2', label: 'UV', hint: 'Where to read the picture: wire into a Texture\'s or Sample (texture)\'s UV.' },
  },
  defaultParams: { mode: 'piece', cellSize: 0.2 },
  paramDefs: {
    mode: { label: 'Mode', type: 'select', hint: 'Mask: the picture stays put. Matte: colour: one colour a cell, from its centre. Matte: piece: each cell carries its own piece wherever its shape goes.', options: [
      { value: 'mask', label: 'Mask' },
      { value: 'matte', label: 'Matte: colour' },
      { value: 'piece', label: 'Matte: piece' },
    ] },
    cellSize: { label: 'Cell Size', type: 'float', min: 0.01, max: 2, step: 0.005, hint: 'Used when Cell Size is not wired.' },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const uv = inputVars.uv ?? 'g_uv';
    const cc = inputVars.cellCenter ?? 'vec2(0.0)';
    const cu = inputVars.cellUV ?? 'vec2(0.0)';
    const size = inputVars.cellSize ?? p(node.params.cellSize, 0.2);
    const mode = node.params.mode === 'mask' || node.params.mode === 'matte' ? node.params.mode : 'piece';
    const expr = mode === 'mask' ? uv : mode === 'matte' ? cc : `${cc} + ${cu} * ${size}`;
    return { code: `    vec2 ${id}_uv = ${expr};\n`, outputVars: { uv: `${id}_uv` } };
  },
};

export const CELL_PATTERN_MODES = ['repeat', 'mirrorX', 'mirrorY', 'mirrorXY', 'rotate4'] as const;

export const CellPatternNode: NodeDefinition = {
  type: 'cellPattern',
  label: 'Cell Pattern',
  category: 'Grid',
  aliases: ['Cell repeat', 'Cell mirror', 'Kaleidoscope cells', 'Tile cells', 'Stamp'],
  description: 'Which cell of a drawing each cell shows: Repeat (every Period cells from Offset; Shift slides each row of tiles, for bricks), Mirror X / Y / both across Centre, or Rotate 4 (a quarter turned round Centre four times). Cell ID in (Grid, Grid Pattern, a Cell node), Source ID out: read anything per cell at Source ID and one drawn cell is copied everywhere the pattern says. Is Source is 1 in the cells that are their own source (the tile you draw in).',
  inputs: {
    cellID: { type: 'vec2', label: 'Cell ID', hint: 'The cell: Grid\'s or Grid Pattern\'s Cell ID, or a Cell node\'s inside a field chain.' },
  },
  outputs: {
    sourceID: { type: 'vec2', label: 'Source ID', hint: 'The cell of the drawing this cell shows.' },
    isSource: { type: 'float', label: 'Is Source', hint: '1 where the cell shows itself (the tile, half or quarter you draw in), 0 in the copies.' },
  },
  defaultParams: { mode: 'repeat', periodX: 2, periodY: 2, offsetX: 0, offsetY: 0, shift: 0, centreX: 0, centreY: 0 },
  paramDefs: {
    mode: { label: 'Mode', type: 'select', hint: 'Repeat a tile; mirror across Centre; or turn a quarter round it.', options: [
      { value: 'repeat', label: 'Repeat' },
      { value: 'mirrorX', label: 'Mirror X' },
      { value: 'mirrorY', label: 'Mirror Y' },
      { value: 'mirrorXY', label: 'Mirror both' },
      { value: 'rotate4', label: 'Rotate 4' },
    ] },
    periodX: { label: 'Period X', type: 'float', min: 1, max: 32, step: 1, showWhen: { param: 'mode', value: 'repeat' }, hint: 'The tile repeats every this many cells across.' },
    periodY: { label: 'Period Y', type: 'float', min: 1, max: 32, step: 1, showWhen: { param: 'mode', value: 'repeat' }, hint: '…and down.' },
    offsetX: { label: 'Offset X', type: 'float', min: -32, max: 32, step: 1, showWhen: { param: 'mode', value: 'repeat' }, hint: 'Where the tile starts (a Cell ID).' },
    offsetY: { label: 'Offset Y', type: 'float', min: -32, max: 32, step: 1, showWhen: { param: 'mode', value: 'repeat' } },
    shift: { label: 'Shift', type: 'float', min: -8, max: 8, step: 1, showWhen: { param: 'mode', value: 'repeat' }, hint: 'Each row of tiles slides this many cells across: bricks and staggers.' },
    centreX: { label: 'Centre X', type: 'float', min: -32, max: 32, step: 0.5, showWhen: { param: 'mode', value: ['mirrorX', 'mirrorY', 'mirrorXY', 'rotate4'] }, hint: 'The line (or point) it mirrors or turns round, in cells: 0 is the edge between cells −1 and 0 (the middle of a Grid).' },
    centreY: { label: 'Centre Y', type: 'float', min: -32, max: 32, step: 0.5, showWhen: { param: 'mode', value: ['mirrorX', 'mirrorY', 'mirrorXY', 'rotate4'] } },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const c = inputVars.cellID ?? 'vec2(0.0)';
    const mode = (CELL_PATTERN_MODES as readonly string[]).includes(node.params.mode as string) ? node.params.mode as string : 'repeat';
    const lines = [`    vec2 ${id}_h = floor(${c} + 0.5);`, `    vec2 ${id}_s = ${id}_h;`];
    // Mirror and turn round a centre in cells: positions measured from it (a cell's centre is +0.5).
    const ctr = `vec2(${p(node.params.centreX, 0)}, ${p(node.params.centreY, 0)})`;
    switch (mode) {
      case 'repeat':
        lines.push(
          `    vec2 ${id}_per = max(floor(vec2(${p(node.params.periodX, 2)}, ${p(node.params.periodY, 2)}) + 0.5), vec2(1.0));`,
          `    vec2 ${id}_o = floor(vec2(${p(node.params.offsetX, 0)}, ${p(node.params.offsetY, 0)}) + 0.5);`,
          `    vec2 ${id}_r = ${id}_h - ${id}_o;`,
          `    ${id}_r.x -= floor(${p(node.params.shift, 0)} + 0.5) * floor(${id}_r.y / ${id}_per.y);`,
          `    ${id}_s = ${id}_o + ${id}_r - ${id}_per * floor(${id}_r / ${id}_per);`,
        );
        break;
      case 'mirrorX': case 'mirrorY': case 'mirrorXY': {
        lines.push(`    vec2 ${id}_d = ${id}_h + 0.5 - ${ctr};`);
        if (mode !== 'mirrorY') lines.push(`    ${id}_d.x = -abs(${id}_d.x);`);
        if (mode !== 'mirrorX') lines.push(`    ${id}_d.y = -abs(${id}_d.y);`);
        lines.push(`    ${id}_s = floor(${ctr} + ${id}_d);`);
        break;
      }
      case 'rotate4':
        lines.push(
          `    vec2 ${id}_d = ${id}_h + 0.5 - ${ctr};`,
          `    for (int ${id}_k = 0; ${id}_k < 4; ${id}_k++) { if (${id}_d.x < 0.0 && ${id}_d.y <= 0.0) break; ${id}_d = vec2(${id}_d.y, -${id}_d.x); }`,
          `    ${id}_s = floor(${ctr} + ${id}_d);`,
        );
        break;
    }
    lines.push(`    float ${id}_is = step(max(abs(${id}_s.x - ${id}_h.x), abs(${id}_s.y - ${id}_h.y)), 0.5);`);
    return { code: lines.join('\n') + '\n', outputVars: { sourceID: `${id}_s`, isSource: `${id}_is` } };
  },
};
