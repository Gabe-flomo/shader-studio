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

// Wave Radius — animates a radius value with a sine wave driven by distance + time.
// Pairs with Grid and NeighborDist to create pulsing, radial, or wave dot patterns.
export const WaveRadiusNode: NodeDefinition = {
  type: 'waveRadius',
  label: 'Wave Radius',
  category: 'Grid',
  description: 'Outputs a time-animated radius: sin((distance − time) × speed × freq) × amp + base. Wire dist_to_center from Grid for a radial wave, or leave distance unconnected for uniform pulsing.',
  inputs: {
    distance: { type: 'float', label: 'Distance' },
  },
  outputs: {
    wave_radius: { type: 'float', label: 'Wave Radius' },
  },
  defaultParams: { speed: 0.52, freq: 3.24, amp: 0.19, base: 0.25 },
  paramDefs: {
    speed: { label: 'Speed',     type: 'float', min: 0.0,  max: 5.0,  step: 0.01 },
    freq:  { label: 'Frequency', type: 'float', min: 0.1,  max: 20.0, step: 0.01 },
    amp:   { label: 'Amplitude', type: 'float', min: 0.0,  max: 0.5,  step: 0.005 },
    base:  { label: 'Base',      type: 'float', min: 0.0,  max: 1.0,  step: 0.005 },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id   = node.id;
    const dist = inputVars.distance || '0.0';
    const spd  = p(node.params.speed, 0.52);
    const frq  = p(node.params.freq,  3.24);
    const amp  = p(node.params.amp,   0.19);
    const base = p(node.params.base,  0.25);
    return {
      code: `    float ${id}_wr = sin((${dist} - u_time * ${spd}) * ${frq}) * ${amp} + ${base};\n`,
      outputVars: { wave_radius: `${id}_wr` },
    };
  },
};

// Grid 3D — uniform cubic lattice. Same outputs as the 2D grid but in three dimensions.
// Intended for raymarching: pos is the current ray position p.
export const Grid3DNode: NodeDefinition = {
  type: 'grid3d',
  label: 'Grid 3D',
  category: 'Grid',
  description: 'Divides 3D space into a cubic lattice. Outputs cell UV (offset from center), cell ID, cell center, cell size, grid pos, and distance to grid origin.',
  inputs: {
    pos:     { type: 'vec3',  label: 'Pos' },
    columns: { type: 'float', label: 'Columns' },
    aspect:  { type: 'float', label: 'Aspect' },
  },
  outputs: {
    cellUV:       { type: 'vec3',  label: 'Cell UV' },
    cellID:       { type: 'vec3',  label: 'Cell ID' },
    cellCenter:   { type: 'vec3',  label: 'Cell Center' },
    cellSize:     { type: 'float', label: 'Cell Size' },
    gridPos:      { type: 'vec3',  label: 'Grid Pos' },
    distToOrigin: { type: 'float', label: 'Dist to Origin' },
  },
  defaultParams: { columns: 10.0, uniform_scale: 1.0 },
  paramDefs: {
    columns:       { label: 'Columns',       type: 'float', min: 1.0,  max: 100.0, step: 1.0 },
    uniform_scale: { label: 'Scale',         type: 'float', min: 0.1,  max: 10.0,  step: 0.1 },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id    = node.id;
    const pos   = inputVars.pos     || 'vec3(0.0)';
    const cols  = inputVars.columns || p(node.params.columns, 10.0);
    const asp   = inputVars.aspect  || '(u_resolution.x / u_resolution.y)';
    const scale = p(node.params.uniform_scale, 1.0);
    return {
      code: [
        `    float ${id}_cell = ${asp} / max(${cols}, 0.0001);\n`,
        `    vec3  ${id}_gp   = (${pos}) * ${scale} / ${id}_cell;\n`,
        `    vec3  ${id}_cid  = floor(${id}_gp);\n`,
        `    vec3  ${id}_cuv  = fract(${id}_gp) - 0.5;\n`,
        `    vec3  ${id}_ctr  = ${id}_cid + 0.5;\n`,
        `    float ${id}_dto  = length(${id}_ctr);\n`,
      ].join(''),
      outputVars: {
        cellUV:       `${id}_cuv`,
        cellID:       `${id}_cid`,
        cellCenter:   `${id}_ctr`,
        cellSize:     `${id}_cell`,
        gridPos:      `${id}_gp`,
        distToOrigin: `${id}_dto`,
      },
    };
  },
};

// Neighbor Dist — minimum distance to the nearest dot center across a 3×3 (or 5×5)
// neighborhood of cells. Solves boundary clipping when a dot's radius or displacement
// pushes it past ±0.5 from the cell center.
//
// Two modes:
//   • cellID connected  — per-neighbor hash displacement (correct for scattered dots)
//   • displacement only — uniform displacement for all neighbors (legacy / uniform shift)
export const NeighborDistNode: NodeDefinition = {
  type: 'neighborDist',
  label: 'Neighbor Dist',
  category: 'Grid',
  description: 'Minimum distance to the nearest dot center across a 3×3 neighborhood. Connect cellID for per-cell hash displacement (fixes clipping on scattered dots). Connect displacement for a uniform shift.',
  inputs: {
    uv:           { type: 'vec2',  label: 'UV' },
    cellID:       { type: 'vec2',  label: 'Cell ID' },
    displacement: { type: 'vec2',  label: 'Displacement' },
    dispScale:    { type: 'float', label: 'Disp Scale' },
  },
  outputs: {
    minDist: { type: 'float', label: 'Min Dist' },
  },
  defaultParams: { neighborhood_size: 1, dispScale: 0.35 },
  paramDefs: {
    dispScale: { label: 'Disp Scale', type: 'float', min: 0, max: 0.5, step: 0.005 },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id    = node.id;
    const cuv   = inputVars.uv           || 'vec2(0.0)';
    const cid   = inputVars.cellID;
    const disp  = inputVars.displacement || 'vec2(0.0)';
    const init  = '9.0'; // anything > max neighbor distance (~2.8 for 5×5) works
    const scale = inputVars.dispScale || p(node.params.dispScale, 0.35);
    const n     = typeof node.params.neighborhood_size === 'number'
      ? Math.round(node.params.neighborhood_size as number)
      : 1;
    const fv = (v: number) => v >= 0 ? `${v}.0` : `-${Math.abs(v)}.0`;

    // Displacement connected → uniform mode (explicit always wins).
    // Only cellID connected, no displacement → per-neighbor hash mode.
    const useHash = cid && !inputVars.displacement;

    const lines: string[] = [`    float ${id}_md = ${init};\n`];

    if (useHash) {
      // Per-neighbor hash: each cell gets its own displacement from its cell ID
      for (let dy = -n; dy <= n; dy++) {
        for (let dx = -n; dx <= n; dx++) {
          const off = `vec2(${fv(dx)}, ${fv(dy)})`;
          lines.push(
            `    { vec2 ${id}_nc = ${cid} + ${off};` +
            ` vec2 ${id}_nh = sin(vec2(dot(${id}_nc, vec2(127.1,311.7)), dot(${id}_nc, vec2(269.5,183.3)))) * 43758.5453;` +
            ` vec2 ${id}_nd = (fract(${id}_nh) - 0.5) * ${scale};` +
            ` ${id}_md = min(${id}_md, length(${cuv} - ${off} - ${id}_nd)); }\n`
          );
        }
      }
    } else {
      // Uniform displacement: same shift applied when checking all neighbors
      lines.push(`    vec2 ${id}_sh = ${cuv} - (${disp});\n`);
      for (let dy = -n; dy <= n; dy++) {
        for (let dx = -n; dx <= n; dx++) {
          lines.push(`    ${id}_md = min(${id}_md, length(${id}_sh - vec2(${fv(dx)}, ${fv(dy)})));\n`);
        }
      }
    }

    return {
      code: lines.join(''),
      outputVars: { minDist: `${id}_md` },
    };
  },
};

// Neighbor Dist 3D — minimum distance to the nearest shape center across a 3×3×3 (or 5×5×5)
// neighborhood of cells. 3D equivalent of NeighborDistNode — prevents clipping when a 3D SDF
// primitive extends past its cell boundary into adjacent cells.
export const NeighborDist3DNode: NodeDefinition = {
  type: 'neighborDist3d',
  label: 'Neighbor Dist 3D',
  category: 'Grid',
  description: 'Minimum distance to the nearest shape center across a 3×3×3 neighborhood. Prevents clipping when a 3D SDF extends past its cell boundary. Feed cellUV from Grid 3D.',
  inputs: {
    cellUV:       { type: 'vec3',  label: 'Cell UV' },
    displacement: { type: 'vec3',  label: 'Displacement' },
  },
  outputs: {
    minDist: { type: 'float', label: 'Min Dist' },
  },
  defaultParams: { neighborhood_size: 1 },
  paramDefs: {
    neighborhood_size: { label: 'Neighborhood', type: 'float', min: 1, max: 2, step: 1 },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id   = node.id;
    const cuv  = inputVars.cellUV       || 'vec3(0.0)';
    const disp = inputVars.displacement || 'vec3(0.0)';
    const n    = typeof node.params.neighborhood_size === 'number'
      ? Math.round(node.params.neighborhood_size as number)
      : 1;
    const fv   = (v: number) => v >= 0 ? `${v}.0` : `-${Math.abs(v)}.0`;

    const lines: string[] = [
      `    vec3  ${id}_sh = (${cuv}) - (${disp});\n`,
      `    float ${id}_md = 9.0;\n`,
    ];

    for (let dz = -n; dz <= n; dz++) {
      for (let dy = -n; dy <= n; dy++) {
        for (let dx = -n; dx <= n; dx++) {
          lines.push(`    ${id}_md = min(${id}_md, length(${id}_sh - vec3(${fv(dx)}, ${fv(dy)}, ${fv(dz)})));\n`);
        }
      }
    }

    return {
      code: lines.join(''),
      outputVars: { minDist: `${id}_md` },
    };
  },
};
