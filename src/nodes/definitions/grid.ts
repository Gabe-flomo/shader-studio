import type { NodeDefinition, GraphNode } from '../../types/nodeGraph';
import { p, f } from './helpers';

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
    cellCenter:     { type: 'vec2',  label: 'Cell Center' },
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
        `    vec2  ${id}_cc   = ${id}_ctr * ${id}_cell;\n`,
      ].join(''),
      outputVars: {
        cellUV:         `${id}_cuv`,
        dist_to_center: `${id}_dtc`,
        cellID:         `${id}_cid`,
        cellCenter:     `${id}_cc`,
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
    const init  = '9.0';
    const scale = inputVars.dispScale || p(node.params.dispScale, 0.35);
    const n     = typeof node.params.neighborhood_size === 'number'
      ? Math.round(node.params.neighborhood_size as number)
      : 1;
    const fv = (v: number) => v >= 0 ? `${v}.0` : `-${Math.abs(v)}.0`;

    const useHash = cid && !inputVars.displacement;

    const lines: string[] = [`    float ${id}_md = ${init};\n`];

    if (useHash) {
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

// Cell Filter — 0/1 mask based on row or column index matching a rule.
export const CellFilterNode: NodeDefinition = {
  type: 'cellFilter',
  label: 'Cell Filter',
  category: 'Grid',
  description: 'Produces a 0/1 mask based on whether the cell row or column matches a rule. Multiply against SDF fill or color to selectively activate cells.',
  inputs: {
    cellID: { type: 'vec2', label: 'Cell ID' },
  },
  outputs: {
    mask:         { type: 'float', label: 'Mask' },
    invertedMask: { type: 'float', label: 'Inv Mask' },
  },
  defaultParams: { axis: '0.0', mode: '1.0', value: 2.0 },
  paramDefs: {
    axis:  { label: 'Axis',  type: 'select', options: [{ value: '0.0', label: 'Row (Y)' }, { value: '1.0', label: 'Col (X)' }] },
    mode:  { label: 'Mode',  type: 'select', options: [{ value: '0.0', label: 'Exact'   }, { value: '1.0', label: 'Modulo'  }] },
    value: { label: 'Value', type: 'float', min: 0, max: 32, step: 1 },
  },
  glslFunction: `float cellFilterFn(vec2 cellID, float axis, float mode, float val) {
    float idx = axis < 0.5 ? cellID.y : cellID.x;
    if (mode < 0.5) {
        return step(0.5, 1.0 - abs(idx - val));
    } else {
        return step(0.5, 1.0 - abs(mod(idx, max(val, 1.0))));
    }
}`,
  generateGLSL: (node: GraphNode, inputVars) => {
    const id   = node.id;
    const cid  = inputVars.cellID ?? 'vec2(0.0)';
    const axis = p(node.params.axis, 0.0);
    const mode = p(node.params.mode, 1.0);
    const val  = p(node.params.value, 2.0);
    return {
      code: `    float ${id}_mask = cellFilterFn(${cid}, ${axis}, ${mode}, ${val});\n` +
            `    float ${id}_inv  = 1.0 - ${id}_mask;\n`,
      outputVars: { mask: `${id}_mask`, invertedMask: `${id}_inv` },
    };
  },
};

// Cell Displace — moves cell UV toward a world-space attractor.
export const CellDisplaceNode: NodeDefinition = {
  type: 'cellDisplace',
  label: 'Cell Displace',
  category: 'Grid',
  description: 'Displaces cell UV toward an attractor in world space. Close cells move a lot, far cells barely move. Returns displaced UV and attract amount 0–1.',
  inputs: {
    cellUV:       { type: 'vec2', label: 'Cell UV' },
    cellCenter:   { type: 'vec2', label: 'Cell Center' },
    attractorPos: { type: 'vec2', label: 'Attractor Pos' },
  },
  outputs: {
    displacedUV:   { type: 'vec2',  label: 'Displaced UV' },
    attractAmount: { type: 'float', label: 'Attract Amount' },
  },
  defaultParams: { radius: 2.5, maxDisplace: 0.35 },
  paramDefs: {
    radius:      { label: 'Radius',       type: 'float', min: 0.1, max: 8.0,  step: 0.05 },
    maxDisplace: { label: 'Max Displace', type: 'float', min: 0.0, max: 0.48, step: 0.005 },
  },
  glslFunction: `vec2 cellDisplaceFn(vec2 cellUV, vec2 cellCenter, vec2 attractor, float radius, float maxDisplace) {
    vec2  delta   = attractor - cellCenter;
    float dist    = length(delta);
    float attract = smoothstep(radius, 0.0, dist);
    vec2  dir     = dist > 0.001 ? normalize(delta) : vec2(0.0);
    return cellUV + dir * attract * maxDisplace;
}`,
  generateGLSL: (node: GraphNode, inputVars) => {
    const id  = node.id;
    const cuv = inputVars.cellUV       ?? 'vec2(0.0)';
    const cc  = inputVars.cellCenter   ?? 'vec2(0.0)';
    const ap  = inputVars.attractorPos ?? 'vec2(0.0)';
    const rad = p(node.params.radius,      2.5);
    const md  = p(node.params.maxDisplace, 0.35);
    return {
      code: `    vec2  ${id}_disp    = cellDisplaceFn(${cuv}, ${cc}, ${ap}, ${rad}, ${md});\n` +
            `    float ${id}_attract = smoothstep(${rad}, 0.0, length(${ap} - ${cc}));\n`,
      outputVars: { displacedUV: `${id}_disp`, attractAmount: `${id}_attract` },
    };
  },
};

// Grid Density Warp — sin-wave warp applied before grid/Fract for non-uniform cell density.
export const GridDensityWarpNode: NodeDefinition = {
  type: 'gridDensityWarp',
  label: 'Grid Density Warp',
  category: 'Grid',
  description: 'Applies a sin-wave warp to UV before grid or Fract, producing non-uniform cell density. Keep amplitude < 1/(2*gridSize) to avoid cell folding.',
  inputs: {
    uv: { type: 'vec2', label: 'UV' },
  },
  outputs: {
    warpedUV: { type: 'vec2', label: 'Warped UV' },
  },
  defaultParams: { amplitude: 0.06, frequency: 2.0, axis: '0.0', animated: false },
  paramDefs: {
    amplitude: { label: 'Amplitude', type: 'float', min: 0.0, max: 0.15, step: 0.001 },
    frequency: { label: 'Frequency', type: 'float', min: 0.5, max: 6.0,  step: 0.1  },
    axis: { label: 'Axis', type: 'select', options: [
      { value: '0.0', label: 'X' },
      { value: '1.0', label: 'Y' },
      { value: '2.0', label: 'Both' },
    ]},
    animated: { label: 'Animated', type: 'bool' },
  },
  glslFunction: `vec2 gridDensityWarpFn(vec2 uv, float amp, float freq, float axis, float t) {
    vec2 warped = uv;
    if (axis < 0.5 || axis > 1.5)
        warped.x += sin(uv.y * freq + t) * amp;
    if (axis > 0.5)
        warped.y += sin(uv.x * freq + t * 0.71) * amp;
    return warped;
}`,
  generateGLSL: (node: GraphNode, inputVars) => {
    const id       = node.id;
    const uv       = inputVars.uv ?? 'g_uv';
    const amp      = p(node.params.amplitude, 0.06);
    const freq     = p(node.params.frequency, 2.0);
    const axis     = p(node.params.axis, 0.0);
    const animated = Boolean(node.params.animated ?? false);
    const t        = animated ? 'u_time' : '0.0';
    return {
      code: `    vec2 ${id}_wuv = gridDensityWarpFn(${uv}, ${amp}, ${freq}, ${axis}, ${t});\n`,
      outputVars: { warpedUV: `${id}_wuv` },
    };
  },
};

// Neighbor Offset 2D — converts flat loop index to 2D (dx,dy) offset for neighborhood iteration.
export const NeighborOffset2dNode: NodeDefinition = {
  type: 'neighborOffset2d',
  label: 'Neighbor Offset 2D',
  category: 'Grid',
  description: 'Converts a flat Loop Index (0 to N²-1) to a 2D (dx,dy) offset. Use inside a looped group with radius=1 (9 iters) or radius=2 (25 iters) to iterate a cell neighborhood.',
  inputs: {
    idx: { type: 'float', label: 'Index' },
  },
  outputs: {
    offset: { type: 'vec2', label: 'Offset' },
  },
  defaultParams: { radius: 1 },
  paramDefs: {
    radius: { label: 'Radius', type: 'select', options: [
      { value: '1', label: '1 (3×3, 9 iters)' },
      { value: '2', label: '2 (5×5, 25 iters)' },
    ]},
  },
  glslFunction: `vec2 neighborOffset2dFn(float idx, float radius) {
    float size = radius * 2.0 + 1.0;
    float row  = floor(idx / size);
    float col  = mod(idx, size);
    return vec2(col, row) - vec2(radius);
}`,
  generateGLSL: (node: GraphNode, inputVars) => {
    const id  = node.id;
    const idx = inputVars.idx ?? '0.0';
    const r   = f(parseFloat(String(node.params.radius ?? '1')));
    return {
      code: `    vec2 ${id}_offset = neighborOffset2dFn(${idx}, ${r});\n`,
      outputVars: { offset: `${id}_offset` },
    };
  },
};

// Animated Cell Center — returns animated dot center position with per-cell phase offset.
export const AnimatedCellCenterNode: NodeDefinition = {
  type: 'animatedCellCenter',
  label: 'Animated Cell Center',
  category: 'Grid',
  description: 'Returns an animated dot center position with per-cell sin oscillation. Phase is seeded by cellID for independent motion per cell.',
  inputs: {
    cellID: { type: 'vec2', label: 'Cell ID' },
  },
  outputs: {
    center: { type: 'vec2', label: 'Center' },
  },
  defaultParams: { gridSize: 8.0, speed: 0.3, amplitude: 0.7 },
  paramDefs: {
    gridSize:  { label: 'Grid Size',  type: 'float', min: 1.0,  max: 24.0, step: 1.0  },
    speed:     { label: 'Speed',      type: 'float', min: 0.0,  max: 1.0,  step: 0.01 },
    amplitude: { label: 'Amplitude',  type: 'float', min: 0.0,  max: 1.5,  step: 0.01 },
  },
  glslFunction: `vec2 animatedCellCenterFn(vec2 cellID, float gridSize, float time, float speed, float amplitude) {
    float phase = cellID.x * 1.618034 + cellID.y * 2.618034;
    vec2 offset = vec2(
        sin(time * speed + phase)          * amplitude / gridSize,
        cos(time * speed * 0.7302 + phase) * amplitude / gridSize
    );
    return (cellID + 0.5) / gridSize + offset;
}`,
  generateGLSL: (node: GraphNode, inputVars) => {
    const id  = node.id;
    const cid = inputVars.cellID ?? 'vec2(0.0)';
    const gs  = p(node.params.gridSize,  8.0);
    const spd = p(node.params.speed,     0.3);
    const amp = p(node.params.amplitude, 0.7);
    return {
      code: `    vec2 ${id}_center = animatedCellCenterFn(${cid}, ${gs}, u_time, ${spd}, ${amp});\n`,
      outputVars: { center: `${id}_center` },
    };
  },
};
