/**
 * Pad Grid — the Play page's pad grid (a Push or Launchpad's pads, or the
 * on-screen grid) as the shader sees it: per cell, a level (held, latched or
 * decaying after a hit), the hit's velocity, the pad's pressure and whether
 * it is held; and where the last pad landed.
 *
 * The grid's size, how pads line up with its cells and how a cell answers a
 * hit are set on the Play page (Mappings → Pad grid); the node only reads.
 * The cells tile the picture: column 0 at the left, row 0 at the bottom, so
 * the node gives each pixel its cell, its offset from the cell's centre in
 * UV units, and the cell's size, ready for a Circle SDF per cell.
 *
 * The uniforms are shared by every Pad Grid node; the app (lib/padGrid.ts →
 * ShaderCanvas) and the web runtime bind them. With no pad grid set up every
 * cell reads 0 and the whole picture is one cell.
 */
import type { GraphNode, NodeDefinition } from '../../types/nodeGraph';

export const PAD_GRID_GLSL = `uniform sampler2D u_padGrid;
uniform vec2 u_padGridSize;
uniform vec4 u_padLast;
vec2 spg_size() { return max(u_padGridSize, vec2(1.0)); }
vec2 spg_cellSize() { return vec2(2.0 * u_resolution.x / u_resolution.y, 2.0) / spg_size(); }
vec2 spg_cellAt(vec2 uv) {
  vec2 s = vec2(uv.x * u_resolution.y / u_resolution.x, uv.y) * 0.5 + 0.5;
  return floor(clamp(s, 0.0, 0.99999) * spg_size());
}
vec4 spg_read(vec2 cell) {
  vec2 c = floor(cell + 0.5);
  if (u_padGridSize.x < 1.0 || c.x < 0.0 || c.y < 0.0 || c.x >= u_padGridSize.x || c.y >= u_padGridSize.y) return vec4(0.0);
  return texture2D(u_padGrid, (c + 0.5) / u_padGridSize);
}
vec2 spg_local(vec2 uv, vec2 cell) {
  vec2 origin = vec2(-u_resolution.x / u_resolution.y, -1.0);
  return uv - (origin + (floor(cell + 0.5) + 0.5) * spg_cellSize());
}`;

export const PadGridNode: NodeDefinition = {
  type: 'padGrid',
  label: 'Pad Grid',
  category: 'Sources',
  aliases: ['Launchpad', 'Push', 'MIDI pads', 'Pad matrix', 'Grid controller'],
  description: 'The Play page\'s pad grid (Push, Launchpad, or the on-screen pads): each cell\'s Level (held, latched or fading after a hit), Velocity, Pressure and Held, and where the last pad landed. The cells tile the picture (column 0 left, row 0 bottom); Local and Cell Size place a shape in each cell. Set the grid up on the Play page: Mappings → Pad grid.',
  inputs: {
    uv: { type: 'vec2', label: 'UV', hint: 'Where to read (the UV node\'s centred coordinates). Unwired: this pixel.' },
    cell: { type: 'vec2', label: 'Cell', hint: 'Read this cell (column, row) instead of the one under UV: wire a Grid\'s or a Cell node\'s Cell ID.' },
  },
  outputs: {
    level: { type: 'float', label: 'Level', hint: 'The cell\'s level, 0–1: lit while held (Hold), toggled (Latch) or fading after each hit (Decay), scaled by velocity unless that is off.' },
    velocity: { type: 'float', label: 'Velocity', hint: 'How hard the cell\'s pad was last hit, 0–1.' },
    pressure: { type: 'float', label: 'Pressure', hint: 'Aftertouch on the cell\'s pad while held, 0–1.' },
    held: { type: 'float', label: 'Held', hint: '1 while the cell\'s pad is held.' },
    cellID: { type: 'vec2', label: 'Cell ID', hint: 'The cell: column and row, whole numbers.' },
    local: { type: 'vec2', label: 'Local', hint: 'This pixel\'s offset from the cell\'s centre, in UV units: wire it into a Circle SDF\'s UV.' },
    cellSize: { type: 'vec2', label: 'Cell Size', hint: 'A cell\'s width and height in UV units.' },
    lastPad: { type: 'vec2', label: 'Last Pad', hint: 'The cell the last pad hit landed on (column, row); −1 before any.' },
    lastVelocity: { type: 'float', label: 'Last Velocity', hint: 'How hard the last pad was hit.' },
  },
  defaultParams: {},
  glslFunction: PAD_GRID_GLSL,
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const uv = inputVars.uv ?? 'g_uv';
    const cell = inputVars.cell ? `floor(${inputVars.cell} + 0.5)` : `spg_cellAt(${uv})`;
    return {
      code: [
        `    vec2 ${id}_cell = ${cell};\n`,
        `    vec4 ${id}_s = spg_read(${id}_cell);\n`,
        `    vec2 ${id}_local = spg_local(${uv}, ${id}_cell);\n`,
        `    vec2 ${id}_size = spg_cellSize();\n`,
        `    vec2 ${id}_last = u_padLast.xy;\n`,
        `    float ${id}_lastVel = u_padLast.z;\n`,
      ].join(''),
      outputVars: {
        level: `${id}_s.r`, velocity: `${id}_s.g`, pressure: `${id}_s.b`, held: `${id}_s.a`,
        cellID: `${id}_cell`, local: `${id}_local`, cellSize: `${id}_size`, lastPad: `${id}_last`, lastVelocity: `${id}_lastVel`,
      },
    };
  },
};
