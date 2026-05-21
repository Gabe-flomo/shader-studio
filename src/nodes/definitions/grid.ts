import type { NodeDefinition, GraphNode } from '../../types/nodeGraph';
import { p } from './helpers';

// Grid — aspect-corrected UV-space grid. Takes a UV input and a column count,
// exposes cell-local data needed for any grid-based pattern or effect.
export const GridLayoutNode: NodeDefinition = {
  type: 'gridLayout',
  label: 'Grid',
  category: 'Grid',
  description: 'Divides UV space into an aspect-corrected grid. Outputs cell UV [-0.5,0.5], dist to center, cell ID, grid pos, cell size, and aspect ratio.',
  inputs: {
    uv:      { type: 'vec2',  label: 'UV' },
    columns: { type: 'float', label: 'Columns' },
  },
  outputs: {
    cellUV:         { type: 'vec2',  label: 'Cell UV' },
    dist_to_center: { type: 'float', label: 'Dist to Center' },
    cellID:         { type: 'vec2',  label: 'Cell ID' },
    grid_pos:       { type: 'vec2',  label: 'Grid Pos' },
    cell_size:      { type: 'float', label: 'Cell Size' },
    aspect_ratio:   { type: 'float', label: 'Aspect Ratio' },
  },
  defaultParams: { columns: 10.0 },
  paramDefs: {
    columns: { label: 'Columns', type: 'float', min: 1.0, max: 80.0, step: 1.0 },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id   = node.id;
    const uv   = inputVars.uv      || 'g_uv';
    const cols = inputVars.columns || p(node.params.columns, 10.0);
    return {
      code: [
        `    float ${id}_asp  = u_resolution.x / u_resolution.y;\n`,
        `    float ${id}_cell = ${id}_asp / ${cols};\n`,
        `    vec2  ${id}_gp   = ${uv} / ${id}_cell;\n`,
        `    vec2  ${id}_cid  = floor(${id}_gp);\n`,
        `    vec2  ${id}_cuv  = fract(${id}_gp) - 0.5;\n`,
        `    vec2  ${id}_ctr  = ${id}_cid + 0.5;\n`,
        `    float ${id}_dtc  = length(${id}_ctr);\n`,
      ].join(''),
      outputVars: {
        cellUV:         `${id}_cuv`,
        dist_to_center: `${id}_dtc`,
        cellID:         `${id}_cid`,
        grid_pos:       `${id}_gp`,
        cell_size:      `${id}_cell`,
        aspect_ratio:   `${id}_asp`,
      },
    };
  },
};

// Neighbor Dist — minimum distance to the nearest dot center across a 3×3 (or 5×5)
// neighborhood of cells. Solves boundary clipping when a dot's radius or displacement
// pushes it past ±0.5 from the cell center. Use in place of length(cellUV) whenever
// per-cell displacement is involved.
export const NeighborDistNode: NodeDefinition = {
  type: 'neighborDist',
  label: 'Neighbor Dist',
  category: 'Grid',
  description: 'Minimum distance to the nearest dot center across a 3×3 neighborhood. Fixes boundary clipping when dot radius or displacement exceeds the cell edge.',
  inputs: {
    cellUV:       { type: 'vec2', label: 'Cell UV' },
    displacement: { type: 'vec2', label: 'Displacement' },
  },
  outputs: {
    minDist: { type: 'float', label: 'Min Dist' },
  },
  defaultParams: { neighborhood_size: 1, initial_dist: 999.0 },
  paramDefs: {
    neighborhood_size: { label: 'Neighborhood Size', type: 'float', min: 1, max: 2, step: 1 },
    initial_dist:      { label: 'Initial Dist',      type: 'float', min: 10, max: 9999, step: 1 },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id   = node.id;
    const cuv  = inputVars.cellUV       || 'vec2(0.0)';
    const disp = inputVars.displacement || 'vec2(0.0)';
    const init = p(node.params.initial_dist, 999.0);
    const n    = typeof node.params.neighborhood_size === 'number'
      ? Math.round(node.params.neighborhood_size as number)
      : 1;
    const fv = (v: number) => v >= 0 ? `${v}.0` : `-${Math.abs(v)}.0`;

    const lines: string[] = [
      `    vec2  ${id}_sh = ${cuv} - (${disp});\n`,
      `    float ${id}_md = ${init};\n`,
    ];
    for (let dy = -n; dy <= n; dy++) {
      for (let dx = -n; dx <= n; dx++) {
        lines.push(`    ${id}_md = min(${id}_md, length(${id}_sh - vec2(${fv(dx)}, ${fv(dy)})));\n`);
      }
    }
    return {
      code: lines.join(''),
      outputVars: { minDist: `${id}_md` },
    };
  },
};
