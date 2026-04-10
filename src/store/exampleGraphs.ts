import type { GraphNode } from '../types/nodeGraph';

export type ExampleGraph = { label: string; nodes: GraphNode[]; counter: number };

export const EXAMPLE_GRAPHS: Record<string, { label: string; nodes: GraphNode[]; counter: number }> = {

  // ── Blank / New ────────────────────────────────────────────────────────────
  blank: {
    label: '[ New ]',
    counter: 2,
    nodes: [
      { id: 'n1', type: 'uv',     position: { x: 100, y: 240 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'n2', type: 'output', position: { x: 420, y: 240 }, inputs: { color: { type: 'vec3', label: 'Color', connection: undefined } }, outputs: {}, params: {} },
    ],
  },

  // ── Fractal Rings — compound node (quick start) ───────────────────────────
  fractalRings: {
    label: 'Fractal Rings',
    counter: 4,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 40, y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 40, y: 400 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'fractal_2', type: 'fractalLoop', position: { x: 330, y: 60 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { color: { type: 'vec3', label: 'Color' }, uv_final: { type: 'vec2', label: 'UV Final' }, uv0: { type: 'vec2', label: 'UV0' } },
        params: { iterations: 4, fract_scale: 1.5, scale_exp: 1.0, freq: 8.0, glow: 0.01, glow_pow: 1.0, iter_offset: 0.4, time_scale: 0.4, a: [0.5,0.5,0.5], b: [0.5,0.5,0.5], c: [1.0,1.0,1.0], d: [0.0,0.33,0.67] },
      },
      {
        id: 'output_3', type: 'output', position: { x: 760, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'fractal_2', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── For Loop Rings — for loop node with editable body ─────────────────────
  forLoopRings: {
    label: 'For Loop Rings',
    counter: 4,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 40, y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 40, y: 400 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'loop_2', type: 'forLoop', position: { x: 320, y: 140 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { color: { type: 'vec3', label: 'Color' }, uv_final: { type: 'vec2', label: 'UV Final' } },
        params: {
          iterations: 4,
          body: '@uv = fract(@uv * 3.0) - 0.5;\nfloat d = length(@uv) * exp(-length(@uv0));\nfloat t2 = length(@uv0) + @i * 0.4 + @t * 0.4;\nvec3 col = palette(t2, vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.0, 0.33, 0.67));\nfloat g = sin(d * 8.0 + @t) / 8.0;\ng = 0.01 / abs(g);\n@color += col * g;',
        },
      },
      {
        id: 'output_3', type: 'output', position: { x: 720, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'loop_2', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Expr Rings — IQ rings formula in one Expr node ────────────────────────
  exprRings: {
    // palette(d + t*0.4) × Expr("0.01/abs(sin(d*8+t)/8)")
    // Compare to ringsComposed which needs 14 nodes for the same result
    label: 'Expr Rings',
    counter: 8,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 40, y: 240 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 40, y: 440 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      { id: 'len_2', type: 'length', position: { x: 280, y: 240 },
        inputs: { input: { type: 'vec2', label: 'Input', connection: { nodeId: 'uv_0', outputKey: 'uv' } } },
        outputs: { output: { type: 'float', label: 'Output' } }, params: { scale: 1.0 } },
      // Expr: entire glow pipeline in one line
      { id: 'expr_3', type: 'expr', position: { x: 540, y: 320 },
        inputs: {
          in0: { type: 'float', label: 'in0', connection: { nodeId: 'len_2',  outputKey: 'output' } },
          in1: { type: 'float', label: 'in1', connection: { nodeId: 'time_1', outputKey: 'time'   } },
          in2: { type: 'float', label: 'in2' },
          in3: { type: 'float', label: 'in3' },
        },
        outputs: { result: { type: 'float', label: 'Result' } },
        params: { expr: '0.01 / abs(sin(d * 8.0 + t) / 8.0)', outputType: 'float', in0Name: 'd', in1Name: 't', in2Name: 'in2', in3Name: 'in3' } },
      // Palette color
      { id: 'paletteT_4', type: 'add', position: { x: 280, y: 500 },
        inputs: { a: { type: 'float', label: 'A', connection: { nodeId: 'len_2', outputKey: 'output' } }, b: { type: 'float', label: 'B', connection: { nodeId: 'time_1', outputKey: 'time' } } },
        outputs: { result: { type: 'float', label: 'Result' } }, params: { b: 0.4 } },
      { id: 'palette_5', type: 'palette', position: { x: 540, y: 520 },
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'paletteT_4', outputKey: 'result' } }, a_r: { type: 'float', label: 'a.r' }, a_g: { type: 'float', label: 'a.g' }, a_b: { type: 'float', label: 'a.b' }, b_r: { type: 'float', label: 'b.r' }, b_g: { type: 'float', label: 'b.g' }, b_b: { type: 'float', label: 'b.b' }, c_r: { type: 'float', label: 'c.r' }, c_g: { type: 'float', label: 'c.g' }, c_b: { type: 'float', label: 'c.b' }, d_r: { type: 'float', label: 'd.r' }, d_g: { type: 'float', label: 'd.g' }, d_b: { type: 'float', label: 'd.b' } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { a: [0.5,0.5,0.5], b: [0.5,0.5,0.5], c: [1.0,1.0,1.0], d: [0.263,0.416,0.557] } },
      { id: 'mul_6', type: 'multiplyVec3', position: { x: 840, y: 400 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'palette_5', outputKey: 'color' } }, scale: { type: 'float', label: 'Scale', connection: { nodeId: 'expr_3', outputKey: 'result' } } },
        outputs: { result: { type: 'vec3', label: 'Result' } }, params: {} },
      { id: 'output_7', type: 'output', position: { x: 1080, y: 400 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'mul_6', outputKey: 'result' } } },
        outputs: {}, params: {} },
    ],
  },

  // ── Expr Orbit — vec2 offset in one Expr node + palette color ─────────────
  exprOrbit: {
    // Orbit = vec2(sin(t),cos(t))*0.5 in one Expr. Palette colors the glow.
    label: 'Expr Orbit',
    counter: 9,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 40, y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 40, y: 400 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      // Expr: orbit offset vec2 in one line
      { id: 'expr_2', type: 'expr', position: { x: 300, y: 320 },
        inputs: {
          in0: { type: 'float', label: 'in0', connection: { nodeId: 'time_1', outputKey: 'time' } },
          in1: { type: 'float', label: 'in1' }, in2: { type: 'float', label: 'in2' }, in3: { type: 'float', label: 'in3' },
        },
        outputs: { result: { type: 'vec2', label: 'Result' } },
        params: { expr: 'vec2(sin(t), cos(t)) * 0.5', outputType: 'vec2', in0Name: 't', in1Name: 'in1', in2Name: 'in2', in3Name: 'in3' } },
      { id: 'circle_3', type: 'circleSDF', position: { x: 580, y: 220 },
        inputs: {
          position: { type: 'vec2',  label: 'Position', connection: { nodeId: 'uv_0',   outputKey: 'uv'     } },
          radius:   { type: 'float', label: 'Radius' },
          offset:   { type: 'vec2',  label: 'Offset',   connection: { nodeId: 'expr_2', outputKey: 'result' } },
        },
        outputs: { distance: { type: 'float', label: 'Distance' } }, params: { radius: 0.12, posX: 0.0, posY: 0.0 } },
      { id: 'light_4', type: 'makeLight', position: { x: 820, y: 220 },
        inputs: { distance: { type: 'float', label: 'Distance', connection: { nodeId: 'circle_3', outputKey: 'distance' } }, brightness: { type: 'float', label: 'Brightness' } },
        outputs: { glow: { type: 'float', label: 'Glow' } }, params: { brightness: 25.0 } },
      // Palette colored by time
      { id: 'palette_5', type: 'palette', position: { x: 820, y: 420 },
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'time_1', outputKey: 'time' } }, a_r: { type: 'float', label: 'a.r' }, a_g: { type: 'float', label: 'a.g' }, a_b: { type: 'float', label: 'a.b' }, b_r: { type: 'float', label: 'b.r' }, b_g: { type: 'float', label: 'b.g' }, b_b: { type: 'float', label: 'b.b' }, c_r: { type: 'float', label: 'c.r' }, c_g: { type: 'float', label: 'c.g' }, c_b: { type: 'float', label: 'c.b' }, d_r: { type: 'float', label: 'd.r' }, d_g: { type: 'float', label: 'd.g' }, d_b: { type: 'float', label: 'd.b' } },
        outputs: { color: { type: 'vec3', label: 'Color' } }, params: { a: [0.5,0.5,0.5], b: [0.5,0.5,0.5], c: [1.0,1.0,1.0], d: [0.0,0.33,0.67] } },
      { id: 'mul_6', type: 'multiplyVec3', position: { x: 1060, y: 300 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'palette_5', outputKey: 'color' } }, scale: { type: 'float', label: 'Scale', connection: { nodeId: 'light_4', outputKey: 'glow' } } },
        outputs: { result: { type: 'vec3', label: 'Result' } }, params: {} },
      { id: 'output_7', type: 'output', position: { x: 1300, y: 300 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'mul_6', outputKey: 'result' } } },
        outputs: {}, params: {} },
    ],
  },

  // ── Animated Palette — Expr drives all 3 palette channels ────────────────
  animatedPalette: {
    // Expr computes vec3(sin(t), sin(t+2.09), sin(t+4.19))*0.5+0.5 as palette offset A
    // Shows wiring a vec3 Expr output into palette per-channel sockets
    label: 'Animated Palette',
    counter: 8,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 40, y: 300 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 40, y: 500 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      // Radial distance
      { id: 'len_2', type: 'length', position: { x: 280, y: 300 },
        inputs: { input: { type: 'vec2', label: 'Input', connection: { nodeId: 'uv_0', outputKey: 'uv' } } },
        outputs: { output: { type: 'float', label: 'Output' } }, params: { scale: 1.0 } },
      // Expr: animated R offset channel — sin(t)*0.5+0.5
      { id: 'exprR_3', type: 'expr', position: { x: 300, y: 460 },
        inputs: { in0: { type: 'float', label: 'in0', connection: { nodeId: 'time_1', outputKey: 'time' } }, in1: { type: 'float', label: 'in1' }, in2: { type: 'float', label: 'in2' }, in3: { type: 'float', label: 'in3' } },
        outputs: { result: { type: 'float', label: 'Result' } },
        params: { expr: 'sin(t) * 0.5 + 0.5', outputType: 'float', in0Name: 't', in1Name: 'in1', in2Name: 'in2', in3Name: 'in3' } },
      // Expr: G channel — sin(t+2.09)*0.5+0.5
      { id: 'exprG_4', type: 'expr', position: { x: 300, y: 580 },
        inputs: { in0: { type: 'float', label: 'in0', connection: { nodeId: 'time_1', outputKey: 'time' } }, in1: { type: 'float', label: 'in1' }, in2: { type: 'float', label: 'in2' }, in3: { type: 'float', label: 'in3' } },
        outputs: { result: { type: 'float', label: 'Result' } },
        params: { expr: 'sin(t + 2.09) * 0.5 + 0.5', outputType: 'float', in0Name: 't', in1Name: 'in1', in2Name: 'in2', in3Name: 'in3' } },
      // Expr: B channel — sin(t+4.19)*0.5+0.5
      { id: 'exprB_5', type: 'expr', position: { x: 300, y: 700 },
        inputs: { in0: { type: 'float', label: 'in0', connection: { nodeId: 'time_1', outputKey: 'time' } }, in1: { type: 'float', label: 'in1' }, in2: { type: 'float', label: 'in2' }, in3: { type: 'float', label: 'in3' } },
        outputs: { result: { type: 'float', label: 'Result' } },
        params: { expr: 'sin(t + 4.19) * 0.5 + 0.5', outputType: 'float', in0Name: 't', in1Name: 'in1', in2Name: 'in2', in3Name: 'in3' } },
      // Palette with wired a_r/a_g/a_b channels
      { id: 'palette_6', type: 'palette', position: { x: 600, y: 440 },
        inputs: {
          t:   { type: 'float', label: 'T',   connection: { nodeId: 'len_2',   outputKey: 'output' } },
          a_r: { type: 'float', label: 'a.r', connection: { nodeId: 'exprR_3', outputKey: 'result' } },
          a_g: { type: 'float', label: 'a.g', connection: { nodeId: 'exprG_4', outputKey: 'result' } },
          a_b: { type: 'float', label: 'a.b', connection: { nodeId: 'exprB_5', outputKey: 'result' } },
          b_r: { type: 'float', label: 'b.r' }, b_g: { type: 'float', label: 'b.g' }, b_b: { type: 'float', label: 'b.b' },
          c_r: { type: 'float', label: 'c.r' }, c_g: { type: 'float', label: 'c.g' }, c_b: { type: 'float', label: 'c.b' },
          d_r: { type: 'float', label: 'd.r' }, d_g: { type: 'float', label: 'd.g' }, d_b: { type: 'float', label: 'd.b' },
        },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { a: [0.5,0.5,0.5], b: [0.5,0.5,0.5], c: [1.0,1.0,1.0], d: [0.0,0.33,0.67] } },
      { id: 'output_7', type: 'output', position: { x: 900, y: 500 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'palette_6', outputKey: 'color' } } },
        outputs: {}, params: {} },
    ],
  },

  // ── Shape Showcase — circle + palette preset + make light ─────────────────
  shapeShowcase: {
    label: 'Shape Showcase',
    counter: 6,
    nodes: [
      { id: 'uv_0',  type: 'uv',   position: { x: 40,  y: 240 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1',type: 'time', position: { x: 40,  y: 400 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'shape_2', type: 'shapeSDF', position: { x: 280, y: 160 },
        inputs: {
          p:  { type: 'vec2',  label: 'Position',        connection: { nodeId: 'uv_0', outputKey: 'uv' } },
          r:  { type: 'float', label: 'Radius / Size' },
          b:  { type: 'vec2',  label: 'Half-size (box)' },
          a:  { type: 'vec2',  label: 'Point A (segment)' },
          b2: { type: 'vec2',  label: 'Point B (segment)' },
          rf: { type: 'float', label: 'Inner ratio (star)' },
          c:  { type: 'vec2',  label: 'Angle vec (pie)' },
          th: { type: 'float', label: 'Thickness (ring)' },
          n:  { type: 'vec2',  label: 'Normal (ring)' },
        },
        outputs: { distance: { type: 'float', label: 'Distance' } },
        params: { shape: 'hexagon', r: 0.4, rx: 0.3, ry: 0.3, roundness: 0.05, rf: 0.5, cx: 0.866, cy: 0.5, th: 0.05, nx: 0.0, ny: 1.0 },
      },
      {
        id: 'light_3', type: 'makeLight', position: { x: 560, y: 200 },
        inputs: {
          distance:   { type: 'float', label: 'Distance',   connection: { nodeId: 'shape_2',  outputKey: 'distance' } },
          brightness: { type: 'float', label: 'Brightness' },
        },
        outputs: { glow: { type: 'float', label: 'Glow' } },
        params: { brightness: 8.0 },
      },
      {
        id: 'palette_4', type: 'palettePreset', position: { x: 560, y: 380 },
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'time_1', outputKey: 'time' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { preset: '4' },
      },
      {
        id: 'scale_5', type: 'multiplyVec3', position: { x: 760, y: 280 },
        inputs: {
          color: { type: 'vec3',  label: 'Color', connection: { nodeId: 'palette_4', outputKey: 'color' } },
          scale: { type: 'float', label: 'Scale', connection: { nodeId: 'light_3',   outputKey: 'glow'  } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } },
        params: {},
      },
      {
        id: 'output_6', type: 'output', position: { x: 980, y: 300 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'scale_5', outputKey: 'result' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Tone Map Demo — fractalLoop → toneMap → grain ─────────────────────────
  toneMapDemo: {
    label: 'Tone Map Demo',
    counter: 6,
    nodes: [
      { id: 'uv_0',  type: 'uv',   position: { x: 40, y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1',type: 'time', position: { x: 40, y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'fractal_2', type: 'fractalLoop', position: { x: 280, y: 80 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { color: { type: 'vec3', label: 'Color' }, uv_final: { type: 'vec2', label: 'UV Final' }, uv0: { type: 'vec2', label: 'UV0' } },
        params: { iterations: 4, fract_scale: 1.5, scale_exp: 1.0, freq: 8.0, glow: 0.01, glow_pow: 1.0, iter_offset: 0.4, time_scale: 0.4, a: [0.5,0.5,0.5], b: [0.5,0.5,0.5], c: [1.0,1.0,1.0], d: [0.0,0.33,0.67] },
      },
      {
        id: 'tone_3', type: 'toneMap', position: { x: 620, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'fractal_2', outputKey: 'color' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { mode: 'aces' },
      },
      {
        id: 'grain_4', type: 'grain', position: { x: 820, y: 200 },
        inputs: {
          color: { type: 'vec3', label: 'Color', connection: { nodeId: 'tone_3', outputKey: 'color' } },
          uv:    { type: 'vec2', label: 'UV',    connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
        },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { amount: 0.04, seed: 0.0 },
      },
      {
        id: 'output_5', type: 'output', position: { x: 1040, y: 220 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'grain_4', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Glowing Circle — circle SDF + palette preset + grain ──────────────────
  glowCircle: {
    label: 'Glowing Circle',
    counter: 7,
    nodes: [
      { id: 'uv_0',  type: 'uv',   position: { x: 40, y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1',type: 'time', position: { x: 40, y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'circle_2', type: 'circleSDF', position: { x: 280, y: 180 },
        inputs: {
          position: { type: 'vec2',  label: 'Position', connection: { nodeId: 'uv_0', outputKey: 'uv' } },
          radius:   { type: 'float', label: 'Radius' },
          offset:   { type: 'vec2',  label: 'Offset' },
        },
        outputs: { distance: { type: 'float', label: 'Distance' } },
        params: { radius: 0.35, posX: 0.0, posY: 0.0 },
      },
      {
        id: 'light_3', type: 'makeLight', position: { x: 520, y: 200 },
        inputs: {
          distance:   { type: 'float', label: 'Distance',   connection: { nodeId: 'circle_2', outputKey: 'distance' } },
          brightness: { type: 'float', label: 'Brightness' },
        },
        outputs: { glow: { type: 'float', label: 'Glow' } },
        params: { brightness: 10.0 },
      },
      {
        id: 'palette_4', type: 'palettePreset', position: { x: 520, y: 380 },
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'time_1', outputKey: 'time' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { preset: '4' },
      },
      {
        id: 'scale_5', type: 'multiplyVec3', position: { x: 740, y: 280 },
        inputs: {
          color: { type: 'vec3',  label: 'Color', connection: { nodeId: 'palette_4', outputKey: 'color' } },
          scale: { type: 'float', label: 'Scale', connection: { nodeId: 'light_3',   outputKey: 'glow'  } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } },
        params: {},
      },
      {
        id: 'tone_6', type: 'toneMap', position: { x: 940, y: 280 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'scale_5', outputKey: 'result' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { mode: 'aces' },
      },
      {
        id: 'output_7', type: 'output', position: { x: 1160, y: 300 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'tone_6', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── FBM Landscape — FBM noise → palette color ─────────────────────────────
  fbmLandscape: {
    label: 'FBM Landscape',
    counter: 6,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 40, y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 40, y: 400 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'fbm_2', type: 'fbm', position: { x: 280, y: 200 },
        inputs: {
          uv:         { type: 'vec2',  label: 'UV',         connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time:       { type: 'float', label: 'Time',       connection: { nodeId: 'time_1', outputKey: 'time' } },
          scale:      { type: 'float', label: 'Scale'      },
          time_scale: { type: 'float', label: 'Time Scale' },
        },
        outputs: { value: { type: 'float', label: 'Value' }, uv: { type: 'vec2', label: 'UV (pass-through)' } },
        params: { octaves: 5, lacunarity: 2.0, gain: 0.5, scale: 3.0, time_scale: 0.1 },
      },
      {
        id: 'palette_3', type: 'palettePreset', position: { x: 560, y: 200 },
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'fbm_2', outputKey: 'value' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { preset: '4' },
      },
      {
        id: 'tone_4', type: 'toneMap', position: { x: 780, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'palette_3', outputKey: 'color' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { mode: 'aces' },
      },
      {
        id: 'output_5', type: 'output', position: { x: 1000, y: 220 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'tone_4', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Domain Warp Fractal — DomainWarp pre-distorts UV into fractal loop ──────
  domainWarpFractal: {
    label: 'Domain Warp Fractal',
    counter: 5,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 40, y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 40, y: 400 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'warp_2', type: 'domainWarp', position: { x: 280, y: 200 },
        inputs: {
          uv:         { type: 'vec2',  label: 'UV',         connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time:       { type: 'float', label: 'Time',       connection: { nodeId: 'time_1', outputKey: 'time' } },
          strength:   { type: 'float', label: 'Strength'   },
          scale:      { type: 'float', label: 'Scale'      },
          time_scale: { type: 'float', label: 'Anim Speed' },
        },
        outputs: { uv: { type: 'vec2', label: 'Warped UV' }, offset: { type: 'vec2', label: 'Warp Offset' } },
        params: { strength: 0.8, scale: 1.5, octaves: 3, lacunarity: 2.0, gain: 0.5, time_scale: 0.15 },
      },
      {
        id: 'fractal_3', type: 'fractalLoop', position: { x: 560, y: 60 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'warp_2', outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { color: { type: 'vec3', label: 'Color' }, uv_final: { type: 'vec2', label: 'UV Final' }, uv0: { type: 'vec2', label: 'UV0' } },
        params: { iterations: 4, fract_scale: 1.5, scale_exp: 1.0, freq: 8.0, glow: 0.01, glow_pow: 1.0, iter_offset: 0.4, time_scale: 0.4, a: [0.5,0.5,0.5], b: [0.5,0.5,0.5], c: [1.0,1.0,1.0], d: [0.0,0.33,0.67] },
      },
      {
        id: 'output_4', type: 'output', position: { x: 920, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'fractal_3', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Orbitals — 3 orbiting ring SDFs + smooth_min + palette + tonemap ───────
  orbitals: {
    label: 'Orbitals',
    counter: 15,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 40, y: 300 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 40, y: 500 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      // Orbit offsets via Expr nodes
      { id: 'orbit1_2', type: 'expr', position: { x: 280, y: 100 },
        inputs: { in0: { type: 'float', label: 'in0', connection: { nodeId: 'time_1', outputKey: 'time' } }, in1: { type: 'float', label: 'in1' }, in2: { type: 'float', label: 'in2' }, in3: { type: 'float', label: 'in3' } },
        outputs: { result: { type: 'vec2', label: 'Result' } },
        params: { expr: 'vec2(sin(t * 0.8), cos(t * 0.8)) * 0.4', outputType: 'vec2', in0Name: 't', in1Name: 'in1', in2Name: 'in2', in3Name: 'in3' } },
      { id: 'orbit2_3', type: 'expr', position: { x: 280, y: 260 },
        inputs: { in0: { type: 'float', label: 'in0', connection: { nodeId: 'time_1', outputKey: 'time' } }, in1: { type: 'float', label: 'in1' }, in2: { type: 'float', label: 'in2' }, in3: { type: 'float', label: 'in3' } },
        outputs: { result: { type: 'vec2', label: 'Result' } },
        params: { expr: 'vec2(cos(t * 1.1 + 2.09), sin(t * 1.1 + 2.09)) * 0.35', outputType: 'vec2', in0Name: 't', in1Name: 'in1', in2Name: 'in2', in3Name: 'in3' } },
      { id: 'orbit3_4', type: 'expr', position: { x: 280, y: 420 },
        inputs: { in0: { type: 'float', label: 'in0', connection: { nodeId: 'time_1', outputKey: 'time' } }, in1: { type: 'float', label: 'in1' }, in2: { type: 'float', label: 'in2' }, in3: { type: 'float', label: 'in3' } },
        outputs: { result: { type: 'vec2', label: 'Result' } },
        params: { expr: 'vec2(sin(t * 1.3 + 4.19), cos(t * 1.3 + 4.19)) * 0.3', outputType: 'vec2', in0Name: 't', in1Name: 'in1', in2Name: 'in2', in3Name: 'in3' } },
      // Ring SDFs for each orbit
      { id: 'ring1_5', type: 'ringSDF', position: { x: 560, y: 100 },
        inputs: {
          position: { type: 'vec2',  label: 'Position', connection: { nodeId: 'uv_0',     outputKey: 'uv'     } },
          offset:   { type: 'vec2',  label: 'Offset',   connection: { nodeId: 'orbit1_2', outputKey: 'result' } },
          radius:   { type: 'float', label: 'Radius'   },
          thickness:{ type: 'float', label: 'Thickness'},
        },
        outputs: { distance: { type: 'float', label: 'Distance' } },
        params: { radius: 0.12, thickness: 0.02 } },
      { id: 'ring2_6', type: 'ringSDF', position: { x: 560, y: 280 },
        inputs: {
          position: { type: 'vec2',  label: 'Position', connection: { nodeId: 'uv_0',     outputKey: 'uv'     } },
          offset:   { type: 'vec2',  label: 'Offset',   connection: { nodeId: 'orbit2_3', outputKey: 'result' } },
          radius:   { type: 'float', label: 'Radius'   },
          thickness:{ type: 'float', label: 'Thickness'},
        },
        outputs: { distance: { type: 'float', label: 'Distance' } },
        params: { radius: 0.1, thickness: 0.02 } },
      { id: 'ring3_7', type: 'ringSDF', position: { x: 560, y: 460 },
        inputs: {
          position: { type: 'vec2',  label: 'Position', connection: { nodeId: 'uv_0',     outputKey: 'uv'     } },
          offset:   { type: 'vec2',  label: 'Offset',   connection: { nodeId: 'orbit3_4', outputKey: 'result' } },
          radius:   { type: 'float', label: 'Radius'   },
          thickness:{ type: 'float', label: 'Thickness'},
        },
        outputs: { distance: { type: 'float', label: 'Distance' } },
        params: { radius: 0.09, thickness: 0.02 } },
      // Smooth-min merge all 3 distances
      { id: 'smin1_8', type: 'smoothMin', position: { x: 800, y: 180 },
        inputs: {
          a: { type: 'float', label: 'A', connection: { nodeId: 'ring1_5', outputKey: 'distance' } },
          b: { type: 'float', label: 'B', connection: { nodeId: 'ring2_6', outputKey: 'distance' } },
        },
        outputs: { result: { type: 'float', label: 'Result' } },
        params: { smoothness: 0.1 } },
      { id: 'smin2_9', type: 'smoothMin', position: { x: 800, y: 380 },
        inputs: {
          a: { type: 'float', label: 'A', connection: { nodeId: 'smin1_8', outputKey: 'result' } },
          b: { type: 'float', label: 'B', connection: { nodeId: 'ring3_7', outputKey: 'distance' } },
        },
        outputs: { result: { type: 'float', label: 'Result' } },
        params: { smoothness: 0.1 } },
      // MakeLight → PalettePreset colored by time → multiplyVec3 → ToneMap → Output
      { id: 'light_10', type: 'makeLight', position: { x: 1020, y: 280 },
        inputs: {
          distance:   { type: 'float', label: 'Distance',   connection: { nodeId: 'smin2_9', outputKey: 'result' } },
          brightness: { type: 'float', label: 'Brightness' },
        },
        outputs: { glow: { type: 'float', label: 'Glow' } },
        params: { brightness: 30.0 } },
      { id: 'pal_11', type: 'palettePreset', position: { x: 1020, y: 440 },
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'time_1', outputKey: 'time' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { preset: '7' } },
      { id: 'mul_12', type: 'multiplyVec3', position: { x: 1240, y: 340 },
        inputs: {
          color: { type: 'vec3',  label: 'Color', connection: { nodeId: 'pal_11',  outputKey: 'color' } },
          scale: { type: 'float', label: 'Scale', connection: { nodeId: 'light_10', outputKey: 'glow' } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } },
        params: {} },
      { id: 'tone_13', type: 'toneMap', position: { x: 1460, y: 340 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'mul_12', outputKey: 'result' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { mode: 'hable' } },
      { id: 'output_14', type: 'output', position: { x: 1680, y: 360 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'tone_13', outputKey: 'color' } } },
        outputs: {}, params: {} },
    ],
  },

  // ── Mandelbrot Set — classic Mandelbrot with smooth coloring ─────────────
  mandelbrotSet: {
    label: 'Mandelbrot Set',
    counter: 3,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 40, y: 240 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      {
        id: 'mandel_1', type: 'mandelbrot', position: { x: 300, y: 140 },
        inputs: {
          uv:    { type: 'vec2',  label: 'UV',        connection: { nodeId: 'uv_0', outputKey: 'uv' } },
          c_pos: { type: 'vec2',  label: 'c (Julia)'  },
          time:  { type: 'float', label: 'Time'       },
        },
        outputs: {
          color: { type: 'vec3',  label: 'Color'          },
          iter:  { type: 'float', label: 'Smooth Iter'    },
          dist:  { type: 'float', label: 'Distance (SDF)' },
          trap:  { type: 'float', label: 'Orbit Trap'     },
        },
        params: { mode: 'mandelbrot', power: 2, max_iter: 150, bailout: 256, zoom: 1.0, offset_x: -0.5, offset_y: 0.0, cx: -0.7269, cy: 0.1889, orbit_trap: 'none', trap_x: 0.0, trap_y: 0.0, trap_r: 0.5, palette_preset: '1', color_scale: 0.15, color_offset: 0.0 },
      },
      {
        id: 'output_2', type: 'output', position: { x: 640, y: 220 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'mandel_1', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Julia Explorer — animated Julia set with orbit traps ──────────────────
  juliaExplorer: {
    label: 'Julia Explorer',
    counter: 5,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 40, y: 240 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 40, y: 420 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      { id: 'cExpr_2', type: 'expr', position: { x: 280, y: 400 },
        inputs: { in0: { type: 'float', label: 'in0', connection: { nodeId: 'time_1', outputKey: 'time' } }, in1: { type: 'float', label: 'in1' }, in2: { type: 'float', label: 'in2' }, in3: { type: 'float', label: 'in3' } },
        outputs: { result: { type: 'vec2', label: 'Result' } },
        params: { expr: 'vec2(cos(t * 0.3) * 0.7, sin(t * 0.4) * 0.4)', outputType: 'vec2', in0Name: 't', in1Name: 'in1', in2Name: 'in2', in3Name: 'in3' } },
      {
        id: 'julia_3', type: 'mandelbrot', position: { x: 560, y: 140 },
        inputs: {
          uv:    { type: 'vec2',  label: 'UV',        connection: { nodeId: 'uv_0',    outputKey: 'uv'     } },
          c_pos: { type: 'vec2',  label: 'c (Julia)', connection: { nodeId: 'cExpr_2', outputKey: 'result' } },
          time:  { type: 'float', label: 'Time',      connection: { nodeId: 'time_1',  outputKey: 'time'   } },
        },
        outputs: {
          color: { type: 'vec3',  label: 'Color'          },
          iter:  { type: 'float', label: 'Smooth Iter'    },
          dist:  { type: 'float', label: 'Distance (SDF)' },
          trap:  { type: 'float', label: 'Orbit Trap'     },
        },
        params: { mode: 'julia', power: 2, max_iter: 150, bailout: 256, zoom: 1.5, offset_x: 0.0, offset_y: 0.0, cx: -0.7269, cy: 0.1889, orbit_trap: 'cross', trap_x: 0.0, trap_y: 0.0, trap_r: 0.5, palette_preset: '7', color_scale: 0.15, color_offset: 0.0 },
      },
      {
        id: 'output_4', type: 'output', position: { x: 880, y: 220 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'julia_3', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Angular Gradient — recreate Gradients/shader.frag ─────────────────────
  angularGradient: {
    label: 'Angular Gradient',
    counter: 5,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 40, y: 240 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 40, y: 420 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      // Rotate2D: UV rotated by time → animated conic gradient
      {
        id: 'rot_2', type: 'rotate2d', position: { x: 280, y: 240 },
        inputs: {
          input: { type: 'vec2',  label: 'Input', connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          angle: { type: 'float', label: 'Angle', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { output: { type: 'vec2', label: 'Output' } },
        params: { angle: 0.0 },
      },
      // Gradient node in Angular mode
      {
        id: 'grad_3', type: 'gradient', position: { x: 560, y: 200 },
        inputs: {
          uv:       { type: 'vec2',  label: 'UV',       connection: { nodeId: 'rot_2', outputKey: 'output' } },
          color_a:  { type: 'vec3',  label: 'Color A'  },
          color_b:  { type: 'vec3',  label: 'Color B'  },
          t_offset: { type: 'float', label: 'T Offset' },
        },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { mode: 'angular', color_a: [0.05, 0.05, 0.15], color_b: [0.9, 0.6, 0.2], t_offset: 0.0 },
      },
      {
        id: 'output_4', type: 'output', position: { x: 820, y: 240 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'grad_3', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Raymarch Spheres — classic 3D raymarcher ──────────────────────────────
  raymarchSpheres: {
    label: 'Raymarch Spheres',
    counter: 4,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 40, y: 240 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 40, y: 420 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'rm_2', type: 'raymarch3d', position: { x: 290, y: 160 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: {
          color:  { type: 'vec3',  label: 'Color'     },
          depth:  { type: 'float', label: 'Depth'     },
          normal: { type: 'vec3',  label: 'Normal'    },
          occ:    { type: 'float', label: 'Occlusion' },
          fog:    { type: 'float', label: 'Fog Mask'  },
        },
        params: {
          scene: 'spheres', max_steps: 80, max_dist: 30.0, surf_dist: 0.001,
          cam_dist: 5.0, cam_height: 2.0, cam_speed: 0.25, cam_fov: 1.5,
          shape_r: 0.9, blend_k: 0.3, repeat_x: 3.0, repeat_z: 3.0,
          light_x: 3.0, light_y: 6.0, light_z: 3.0,
          ambient: 0.05, specular: 48.0,
          fog_dist: 18.0, fog_color: [0.6, 0.65, 0.8],
          palette_preset: '1', bg_preset: '0',
          ao_steps: 5, noise_scale: 1.5, noise_strength: 0.3,
        },
      },
      {
        id: 'output_3', type: 'output', position: { x: 620, y: 240 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'rm_2', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Chromatic Glitch — chromatic aberration on fractal rings ─────────────
  // CombineRGB takes one vec3 per input socket.
  // combineRGB generates: vec3 result = vec3(r, g, b)
  // Since r/g/b are all vec3 here, this produces a 3-component constructor
  // from 3 full vec3s — GLSL accepts vec3(vec3, ...) as long as component
  // count totals 3. Actually vec3(vec3) is valid (same as identity).
  // Instead we use ExtractX to pull just the .x (red) channel from
  // each fractal's color vec3 so the combineRGB gets 3 true floats.
  // ── Gravitational Lens — lensed Mandelbrot with mouse control ─────────────
  gravitationalLens: {
    label: 'Gravity Lens',
    counter: 6,
    nodes: [
      {
        id: 'uv_1', type: 'uv', position: { x: 40, y: 180 },
        inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {},
      },
      {
        id: 'mouse_2', type: 'mouse', position: { x: 40, y: 360 },
        inputs: {},
        outputs: { uv: { type: 'vec2', label: 'UV' }, x: { type: 'float', label: 'X' }, y: { type: 'float', label: 'Y' } },
        params: {},
      },
      {
        id: 'time_3', type: 'time', position: { x: 40, y: 500 },
        inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {},
      },
      {
        id: 'lens_4', type: 'gravitationalLens', position: { x: 320, y: 280 },
        inputs: {
          uv:          { type: 'vec2',  label: 'UV',           connection: { nodeId: 'uv_1',    outputKey: 'uv'   } },
          lens_center: { type: 'vec2',  label: 'Lens Center',  connection: { nodeId: 'mouse_2', outputKey: 'uv'   } },
          time:        { type: 'float', label: 'Time',         connection: { nodeId: 'time_3',  outputKey: 'time' } },
        },
        outputs: {
          uv_lensed:    { type: 'vec2',  label: 'Lensed UV'         },
          horizon_mask: { type: 'float', label: 'Horizon Mask'      },
          dist:         { type: 'float', label: 'Distance to Lens'  },
        },
        params: { lens_type: 'gravity', strength: 0.002, horizon_radius: 0.083, softening: 0.0001, aspect_correct: 'yes', ripple_freq: 20.0, ripple_speed: 2.0 },
      },
      {
        id: 'mandel_5', type: 'mandelbrot', position: { x: 640, y: 200 },
        inputs: {
          uv:    { type: 'vec2',  label: 'UV',       connection: { nodeId: 'lens_4', outputKey: 'uv_lensed' } },
          c_pos: { type: 'vec2',  label: 'c (Julia)', connection: undefined },
          time:  { type: 'float', label: 'Time',     connection: undefined },
        },
        outputs: {
          color: { type: 'vec3',  label: 'Color'          },
          iter:  { type: 'float', label: 'Smooth Iter'    },
          dist:  { type: 'float', label: 'Distance (SDF)' },
          trap:  { type: 'float', label: 'Orbit Trap'     },
        },
        params: { mode: 'mandelbrot', power: 2, max_iter: 150, bailout: 256, zoom: 1.0, zoom_exp: 0, offset_x: 0, offset_y: 0, orbit_trap: 'none', trap_x: 0, trap_y: 0, trap_r: 0.5, palette_preset: '1', color_scale: 0.3, color_offset: 0 },
      },
      {
        id: 'output_6', type: 'output', position: { x: 940, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'mandel_5', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Tutorial: Glow Shape — circle SDF → glow → colored output (Section 3) ──
  glowShape: {
    label: 'Glow Shape',
    counter: 7,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 40,  y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 40,  y: 420 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      // sin(time) → scale → pulsing radius
      {
        id: 'sin_2', type: 'sin', position: { x: 260, y: 400 },
        inputs: { x: { type: 'float', label: 'X', connection: { nodeId: 'time_1', outputKey: 'time' } } },
        outputs: { result: { type: 'float', label: 'Result' } },
        params: { scale: 0.8 },
      },
      {
        id: 'mul_3', type: 'multiply', position: { x: 440, y: 400 },
        inputs: {
          a: { type: 'float', label: 'A', connection: { nodeId: 'sin_2', outputKey: 'result' } },
          b: { type: 'float', label: 'B' },
        },
        outputs: { result: { type: 'float', label: 'Result' } },
        params: { b: 0.08 },
      },
      // Circle SDF: length(uv) - radius
      {
        id: 'circle_4', type: 'circleSDF', position: { x: 300, y: 200 },
        inputs: {
          uv:     { type: 'vec2',  label: 'UV',     connection: { nodeId: 'uv_0',   outputKey: 'uv'     } },
          radius: { type: 'float', label: 'Radius', connection: { nodeId: 'mul_3',  outputKey: 'result' } },
        },
        outputs: { dist: { type: 'float', label: 'Distance' } },
        params: { radius: 0.25 },
      },
      // MakeLight: glow from distance
      {
        id: 'light_5', type: 'makeLight', position: { x: 560, y: 200 },
        inputs: {
          distance:   { type: 'float', label: 'Distance',   connection: { nodeId: 'circle_4', outputKey: 'dist' } },
          brightness: { type: 'float', label: 'Brightness' },
        },
        outputs: { glow: { type: 'float', label: 'Glow' } },
        params: { brightness: 0.012, falloff: 1.5 },
      },
      // Palette colors the glow
      {
        id: 'pal_6', type: 'palettePreset', position: { x: 760, y: 300 },
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'time_1', outputKey: 'time' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { preset: '5' },
      },
      // Multiply color by glow intensity
      {
        id: 'mulv_7', type: 'multiplyVec3', position: { x: 960, y: 240 },
        inputs: {
          color: { type: 'vec3',  label: 'Color', connection: { nodeId: 'pal_6',   outputKey: 'color' } },
          scale: { type: 'float', label: 'Scale', connection: { nodeId: 'light_5', outputKey: 'glow'  } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } },
        params: {},
      },
      {
        id: 'output_8', type: 'output', position: { x: 1160, y: 260 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'mulv_7', outputKey: 'result' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Tutorial: Mandelbrot Explorer — same as mandelbrotSet but aliased ────────
  mandelbrotExplorer: {
    label: 'Mandelbrot Explorer',
    counter: 3,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 40, y: 240 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      {
        id: 'mandel_1', type: 'mandelbrot', position: { x: 300, y: 140 },
        inputs: {
          uv:    { type: 'vec2',  label: 'UV',        connection: { nodeId: 'uv_0', outputKey: 'uv' } },
          c_pos: { type: 'vec2',  label: 'c (Julia)'  },
          time:  { type: 'float', label: 'Time'       },
        },
        outputs: {
          color: { type: 'vec3',  label: 'Color'          },
          iter:  { type: 'float', label: 'Smooth Iter'    },
          dist:  { type: 'float', label: 'Distance (SDF)' },
          trap:  { type: 'float', label: 'Orbit Trap'     },
        },
        params: { mode: 'mandelbrot', power: 2, max_iter: 150, bailout: 256, zoom: 1.0, offset_x: -0.5, offset_y: 0.0, cx: -0.7269, cy: 0.1889, orbit_trap: 'none', trap_x: 0.0, trap_y: 0.0, trap_r: 0.5, palette_preset: '1', color_scale: 0.15, color_offset: 0.0 },
      },
      {
        id: 'output_2', type: 'output', position: { x: 640, y: 220 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'mandel_1', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Chladni Plate demo ────────────────────────────────────────────────────
  chladniDemo: {
    label: 'Chladni Plate',
    counter: 3,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 40,  y: 240 }, inputs: {}, outputs: { uv: { type: 'vec2',  label: 'UV'   } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 40,  y: 420 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'chl_2', type: 'chladni', position: { x: 300, y: 180 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: {
          density: { type: 'float', label: 'Density'   },
          field:   { type: 'float', label: 'Raw Field'  },
          color:   { type: 'vec3',  label: 'Color'      },
        },
        params: { m: 0.75, n: 1.0, scale: 1.0, line_width: 1.5, aa: 1.0, turbulence: 0.0, turb_speed: 0.5, noise_mode: 'smooth', brightness: 1.0 },
      },
      {
        id: 'output_3', type: 'output', position: { x: 620, y: 220 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'chl_2', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Chladni 3D demo ───────────────────────────────────────────────────────
  chladni3dDemo: {
    label: 'Chladni 3D',
    counter: 3,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 40,  y: 240 }, inputs: {}, outputs: { uv:   { type: 'vec2',  label: 'UV'   } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 40,  y: 420 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'ch3_2', type: 'chladni3d', position: { x: 300, y: 180 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: {
          color: { type: 'vec3',  label: 'Color' },
          alpha: { type: 'float', label: 'Alpha' },
          depth: { type: 'float', label: 'Depth' },
        },
        params: { m: 0.75, n: 1.0, l: 0.5, scale: 1.2, steps: 80, surface_width: 0.08, opacity: 0.92, orbit_speed: 0.3, orbit_pitch: 0.4, cam_dist: 2.2, bg_dark: 0.04, color_mode: 'depth' },
      },
      {
        id: 'output_3', type: 'output', position: { x: 620, y: 220 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'ch3_2', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Chladni 3D Particles demo ─────────────────────────────────────────────
  chladni3dParticlesDemo: {
    label: 'Chladni 3D Particles',
    counter: 3,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 40,  y: 240 }, inputs: {}, outputs: { uv:   { type: 'vec2',  label: 'UV'   } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 40,  y: 420 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'cp_2', type: 'chladni3dParticles', position: { x: 300, y: 180 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: {
          color:   { type: 'vec3',  label: 'Color'   },
          density: { type: 'float', label: 'Density' },
        },
        params: { m: 0.75, n: 1.0, l: 0.5, scale: 1.2, steps: 60, turbulence: 0.18, noise_speed: 0.4, surface_pull: 6.0, brightness: 3.0, orbit_speed: 0.25, orbit_pitch: 0.4, cam_dist: 2.2, noise_mode: 'hash', color_mode: 'field' },
      },
      {
        id: 'output_3', type: 'output', position: { x: 620, y: 220 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'cp_2', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Electron Orbital demo ─────────────────────────────────────────────────
  electronOrbitalDemo: {
    label: 'Electron Orbital (2px)',
    counter: 3,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 40,  y: 240 }, inputs: {}, outputs: { uv: { type: 'vec2',  label: 'UV'   } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 40,  y: 420 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'orb_2', type: 'electronOrbital', position: { x: 300, y: 180 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: {
          density: { type: 'float', label: 'Density |ψ|²' },
          psi:     { type: 'float', label: 'Raw ψ'         },
          color:   { type: 'vec3',  label: 'Color'          },
        },
        // m=1 (2px): Y_1^1 = sinT*cos(phi) — visible in the z=0 equatorial slice.
        // m=0 (2pz): Y_1^0 = cosT = 0 at z=0, so the equatorial cross-section is completely dark.
        params: { n: 2, l: 1, m_q: 1, a0: 0.094, scale: 3.0, slice_z: 0.0, brightness: 5.0, gamma: 0.45, aa: 1.0, edge_soft: 0.6, turbulence: 0.0, turb_speed: 0.3 },
      },
      {
        id: 'output_3', type: 'output', position: { x: 620, y: 220 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'orb_2', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── 3D Orbital volumetric demo ────────────────────────────────────────────
  orbitalVolume3dDemo: {
    label: '3D Orbital (2p)',
    counter: 3,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 40,  y: 240 }, inputs: {}, outputs: { uv: { type: 'vec2',  label: 'UV'   } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 40,  y: 420 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'orb3_2', type: 'orbitalVolume3d', position: { x: 320, y: 180 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: {
          color: { type: 'vec3',  label: 'Color'         },
          alpha: { type: 'float', label: 'Alpha'          },
          depth: { type: 'float', label: 'Density Depth'  },
        },
        params: { n: 2, l: 1, m: 0, a0: 0.5, scale: 0.3, steps: 80, step_size: 0.04, density_scale: 6.0, gamma: 0.4, edge_softness: 0.6, turbulence: 0.0, turb_speed: 0.3, cam_dist: 2.5, cam_speed: 0.2, cam_angle: 0.0, cam_pitch: 0.35, color_a: [0.3, 0.6, 1.0], color_b: [1.0, 0.4, 0.2] },
      },
      {
        id: 'output_3', type: 'output', position: { x: 660, y: 220 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'orb3_2', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Kaleidoscope Noise — KaleidoSpace + FBM ────────────────────────────────
  kaleidoscopeNoise: {
    label: 'Kaleidoscope Noise',
    counter: 6,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 40, y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 40, y: 400 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'kaleido_2', type: 'kaleidoSpace', position: { x: 260, y: 200 },
        inputs: {
          input:    { type: 'vec2',  label: 'UV',       connection: { nodeId: 'uv_0', outputKey: 'uv' } },
          segments: { type: 'float', label: 'Segments' },
          rotate:   { type: 'float', label: 'Rotate' },
        },
        outputs: { output: { type: 'vec2', label: 'Folded UV' } },
        params: { segments: 6.0, rotate: 0.0 },
      },
      {
        id: 'fbm_3', type: 'fbm', position: { x: 500, y: 200 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'kaleido_2', outputKey: 'output' } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1',    outputKey: 'time'   } },
        },
        outputs: { value: { type: 'float', label: 'Value' }, uv: { type: 'vec2', label: 'UV (pass-through)' } },
        params: { octaves: 5, lacunarity: 2.0, gain: 0.5, scale: 2.5, time_scale: 0.3 },
      },
      {
        id: 'palette_4', type: 'palettePreset', position: { x: 720, y: 200 },
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'fbm_3', outputKey: 'value' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { preset: '3' },
      },
      {
        id: 'output_5', type: 'output', position: { x: 940, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'palette_4', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Polar Rings — PolarSpace maps UV to (angle, radius); FBM in polar space → concentric rings ──
  polarRings: {
    label: 'Polar Rings',
    counter: 5,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 40, y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 40, y: 400 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'polar_2', type: 'polarSpace', position: { x: 260, y: 200 },
        inputs: {
          input:       { type: 'vec2',  label: 'UV',           connection: { nodeId: 'uv_0', outputKey: 'uv' } },
          twist:       { type: 'float', label: 'Twist' },
          radialScale: { type: 'float', label: 'Radial Scale' },
        },
        outputs: {
          output:   { type: 'vec2',  label: 'Polar UV' },
          seamless: { type: 'vec2',  label: 'Seamless' },
          angle:    { type: 'float', label: 'Angle' },
          radius:   { type: 'float', label: 'Radius' },
        },
        params: { twist: 1.5, radialScale: 3.0 },
      },
      {
        id: 'fbm_3', type: 'fbm', position: { x: 500, y: 200 },
        inputs: {
          // Use seamless output: angle encoded as (cos,sin) — no wrap discontinuity
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'polar_2', outputKey: 'seamless' } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1',  outputKey: 'time'   } },
        },
        outputs: { value: { type: 'float', label: 'Value' }, uv: { type: 'vec2', label: 'UV (pass-through)' } },
        params: { octaves: 4, lacunarity: 2.5, gain: 0.5, scale: 4.0, time_scale: 0.2 },
      },
      {
        id: 'palette_4', type: 'palettePreset', position: { x: 720, y: 200 },
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'fbm_3', outputKey: 'value' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { preset: '1' },
      },
      {
        id: 'output_5', type: 'output', position: { x: 940, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'palette_4', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Hyperbolic Circles — Poincaré disk space + tiled circles ───────────────
  hyperbolicCircles: {
    label: 'Hyperbolic Circles',
    counter: 6,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 40, y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 40, y: 400 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'hyp_2', type: 'hyperbolicSpace', position: { x: 260, y: 200 },
        inputs: {
          input:     { type: 'vec2',  label: 'UV',        connection: { nodeId: 'uv_0', outputKey: 'uv' } },
          curvature: { type: 'float', label: 'Curvature' },
        },
        outputs: { output: { type: 'vec2', label: 'Hyperbolic UV' } },
        params: { curvature: 0.75 },
      },
      {
        id: 'fract_3', type: 'fract', position: { x: 480, y: 200 },
        inputs: {
          input: { type: 'vec2',  label: 'Input', connection: { nodeId: 'hyp_2', outputKey: 'output' } },
          scale: { type: 'float', label: 'Scale' },
        },
        outputs: { output: { type: 'vec2', label: 'Output' } },
        params: { scale: 4.0 },
      },
      {
        id: 'circle_4', type: 'circleSDF', position: { x: 700, y: 200 },
        inputs: {
          position: { type: 'vec2',  label: 'Position', connection: { nodeId: 'fract_3', outputKey: 'output' } },
          radius:   { type: 'float', label: 'Radius' },
          offset:   { type: 'vec2',  label: 'Offset' },
        },
        outputs: { distance: { type: 'float', label: 'Distance' } },
        params: { radius: 0.3, posX: 0.0, posY: 0.0 },
      },
      {
        id: 'colorize_5', type: 'sdfColorize', position: { x: 920, y: 200 },
        inputs: {
          d:       { type: 'float', label: 'SDF',           connection: { nodeId: 'circle_4', outputKey: 'distance' } },
          inside:  { type: 'vec3',  label: 'Inside Color' },
          outside: { type: 'vec3',  label: 'Outside Color' },
          edge:    { type: 'float', label: 'Edge Softness' },
        },
        outputs: { result: { type: 'vec3', label: 'Color' } },
        params: { edge: 0.015 },
      },
      {
        id: 'output_6', type: 'output', position: { x: 1140, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'colorize_5', outputKey: 'result' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Swirl Voronoi — SwirlSpace vortex warps UV before Voronoi ──────────────
  swirlVoronoi: {
    label: 'Swirl Voronoi',
    counter: 7,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 40, y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 40, y: 400 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'swirl_2', type: 'swirlSpace', position: { x: 260, y: 200 },
        inputs: {
          input:    { type: 'vec2',  label: 'UV',       connection: { nodeId: 'uv_0', outputKey: 'uv' } },
          strength: { type: 'float', label: 'Strength' },
          falloff:  { type: 'float', label: 'Falloff'  },
        },
        outputs: { output: { type: 'vec2', label: 'Swirled UV' } },
        params: { strength: 3.0, falloff: 1.0 },
      },
      {
        id: 'voronoi_3', type: 'voronoi', position: { x: 480, y: 200 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'swirl_2', outputKey: 'output' } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1',  outputKey: 'time'   } },
        },
        outputs: { dist: { type: 'float', label: 'Distance' }, uv: { type: 'vec2', label: 'UV (pass-through)' } },
        params: { scale: 4.0, time_scale: 0.2, jitter: 1.0 },
      },
      {
        id: 'palette_4', type: 'palettePreset', position: { x: 680, y: 340 },
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'voronoi_3', outputKey: 'dist' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { preset: '0' },
      },
      {
        id: 'glowLayer_5', type: 'glowLayer', position: { x: 700, y: 200 },
        inputs: {
          d:         { type: 'float', label: 'SDF',       connection: { nodeId: 'voronoi_3', outputKey: 'dist'  } },
          color:     { type: 'vec3',  label: 'Color',     connection: { nodeId: 'palette_4', outputKey: 'color' } },
          intensity: { type: 'float', label: 'Intensity' },
          power:     { type: 'float', label: 'Power' },
        },
        outputs: { result: { type: 'vec3', label: 'Glow' } },
        params: { intensity: 0.02, power: 1.2 },
      },
      {
        id: 'tonemap_6', type: 'toneMap', position: { x: 940, y: 200 },
        inputs: {
          color:    { type: 'vec3',  label: 'Color',    connection: { nodeId: 'glowLayer_5', outputKey: 'result' } },
          exposure: { type: 'float', label: 'Exposure' },
        },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { exposure: 1.5 },
      },
      {
        id: 'output_7', type: 'output', position: { x: 1160, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'tonemap_6', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Möbius Warp — Möbius transform distorts UV, FBM fills the curved space ─
  mobiusWarp: {
    label: 'Möbius Warp',
    counter: 6,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 40, y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 40, y: 400 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'mobius_2', type: 'mobiusSpace', position: { x: 260, y: 200 },
        inputs: {
          input: { type: 'vec2',  label: 'UV',     connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          poleX: { type: 'float', label: 'Pole X' },
          poleY: { type: 'float', label: 'Pole Y' },
          angle: { type: 'float', label: 'Angle',  connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { output: { type: 'vec2', label: 'Möbius UV' } },
        params: { poleX: 0.5, poleY: 0.0, angle: 0.0 },
      },
      {
        id: 'fbm_3', type: 'fbm', position: { x: 500, y: 200 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'mobius_2', outputKey: 'output' } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1',   outputKey: 'time'   } },
        },
        outputs: { value: { type: 'float', label: 'Value' }, uv: { type: 'vec2', label: 'UV (pass-through)' } },
        params: { octaves: 4, lacunarity: 2.0, gain: 0.5, scale: 2.0, time_scale: 0.15 },
      },
      {
        id: 'palette_4', type: 'palettePreset', position: { x: 720, y: 200 },
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'fbm_3', outputKey: 'value' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { preset: '2' },
      },
      {
        id: 'output_5', type: 'output', position: { x: 940, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'palette_4', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Infinite Repeat — opRepeat tiles space, sdBox drawn in each cell ────────
  infiniteMirror: {
    label: 'Infinite Repeat',
    counter: 5,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 40, y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 40, y: 400 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'repeat_2', type: 'infiniteRepeatSpace', position: { x: 260, y: 200 },
        inputs: {
          input: { type: 'vec2',  label: 'UV',     connection: { nodeId: 'uv_0', outputKey: 'uv' } },
          cellX: { type: 'float', label: 'Cell W' },
          cellY: { type: 'float', label: 'Cell H' },
        },
        outputs: { output: { type: 'vec2', label: 'Cell UV' }, cellID: { type: 'vec2', label: 'Cell ID' } },
        params: { cellX: 0.5, cellY: 0.5 },
      },
      {
        id: 'sdbox_3', type: 'sdBox', position: { x: 500, y: 200 },
        inputs: {
          p: { type: 'vec2', label: 'Point',    connection: { nodeId: 'repeat_2', outputKey: 'output' } },
          b: { type: 'vec2', label: 'Half-size' },
        },
        outputs: { distance: { type: 'float', label: 'Distance' } },
        params: { bx: 0.18, by: 0.18 },
      },
      {
        id: 'outline_4', type: 'sdfOutline', position: { x: 720, y: 180 },
        inputs: {
          d:           { type: 'float', label: 'SDF',          connection: { nodeId: 'sdbox_3', outputKey: 'distance' } },
          fillColor:   { type: 'vec3',  label: 'Fill' },
          strokeColor: { type: 'vec3',  label: 'Stroke' },
          strokeWidth: { type: 'float', label: 'Stroke Width' },
          antialias:   { type: 'float', label: 'AA Width' },
        },
        outputs: { result: { type: 'vec3', label: 'Color' }, alpha: { type: 'float', label: 'Alpha' } },
        params: { strokeWidth: 0.025, antialias: 0.004 },
      },
      {
        id: 'output_5', type: 'output', position: { x: 960, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'outline_4', outputKey: 'result' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Fractal Rings (Group Loop) — ring step iterated via group node ──────────
  // The group carries two values across iterations: vec2 UV and vec3 color.
  // Each pass folds UV with fract, computes a ring glow, and accumulates color.
  fractalRingsGroup: {
    label: 'Fractal Rings (Group)',
    counter: 4,
    nodes: [
      {
        id: 'uv_0', type: 'uv', position: { x: 40, y: 240 },
        inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {},
      },
      {
        id: 'group_1', type: 'group', position: { x: 240, y: 180 },
        inputs: {
          in0: { type: 'vec2', label: 'UV',    connection: { nodeId: 'uv_0', outputKey: 'uv' } },
          // in1 (vec3 color) has no external connection — starts at vec3(0.0)
        },
        outputs: {
          out0: { type: 'vec2', label: 'UV' },
          out1: { type: 'vec3', label: 'Color' },
        },
        params: {
          label: 'Ring Step',
          iterations: 4,
          subgraph: {
            nodes: [
              {
                id: 'ring_a', type: 'loopRingStep',
                position: { x: 100, y: 100 },
                inputs: {
                  uv:    { type: 'vec2', label: 'UV' },
                  color: { type: 'vec3', label: 'Color in' },
                },
                outputs: {
                  uv:    { type: 'vec2', label: 'UV out' },
                  color: { type: 'vec3', label: 'Color out' },
                },
                params: { scale: 1.5, freq: 8.0, glow: 0.01, timeScale: 0.4 },
              },
            ],
            inputPorts: [
              { key: 'in0', type: 'vec2', label: 'UV',    toNodeId: 'ring_a', toInputKey: 'uv'    },
              { key: 'in1', type: 'vec3', label: 'Color', toNodeId: 'ring_a', toInputKey: 'color' },
            ],
            outputPorts: [
              { key: 'out0', type: 'vec2', label: 'UV',    fromNodeId: 'ring_a', fromOutputKey: 'uv'    },
              { key: 'out1', type: 'vec3', label: 'Color', fromNodeId: 'ring_a', fromOutputKey: 'color' },
            ],
          },
        },
      },
      {
        id: 'out_2', type: 'output', position: { x: 520, y: 220 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'group_1', outputKey: 'out1' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Fractal Rings (Wired Loop) — ring step via LoopStart → LoopEnd ──────────
  // The wired loop carries vec2 UV. Ring Step folds each iteration.
  // Color is accumulated by Ring Step using its persistent carry (via wired chain).
  fractalRingsWired: {
    label: 'Fractal Rings (Wired)',
    counter: 5,
    nodes: [
      {
        id: 'uv_0', type: 'uv', position: { x: 40, y: 220 },
        inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {},
      },
      {
        id: 'start_1', type: 'loopStart', position: { x: 220, y: 180 },
        inputs: { carry: { type: 'vec2', label: 'Initial value', connection: { nodeId: 'uv_0', outputKey: 'uv' } } },
        outputs: { carry: { type: 'vec2', label: 'Carry →' } },
        params: { iterations: 4 },
      },
      {
        id: 'ring_2', type: 'loopRingStep', position: { x: 420, y: 160 },
        inputs: {
          uv:    { type: 'vec2', label: 'UV',       connection: { nodeId: 'start_1', outputKey: 'carry' } },
          color: { type: 'vec3', label: 'Color in' },
        },
        outputs: {
          uv:    { type: 'vec2', label: 'UV out' },
          color: { type: 'vec3', label: 'Color out' },
        },
        params: { scale: 1.5, freq: 8.0, glow: 0.01, timeScale: 0.4 },
      },
      {
        id: 'end_3', type: 'loopEnd', position: { x: 660, y: 180 },
        inputs: { carry: { type: 'vec2', label: '← Carry in', connection: { nodeId: 'ring_2', outputKey: 'uv' } } },
        outputs: { result: { type: 'vec2', label: 'Result' } },
        params: { iterations: 4 },
      },
      {
        id: 'len_4', type: 'length', position: { x: 840, y: 200 },
        inputs: { input: { type: 'vec2', label: 'Input', connection: { nodeId: 'end_3', outputKey: 'result' } } },
        outputs: { output: { type: 'float', label: 'Output' } },
        params: { scale: 1.0 },
      },
      {
        id: 'pal_5', type: 'palette', position: { x: 1020, y: 180 },
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'len_4', outputKey: 'output' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { a: [0.5, 0.5, 0.5], b: [0.5, 0.5, 0.5], c: [1.0, 1.0, 1.0], d: [0.0, 0.33, 0.67] },
      },
      {
        id: 'out_6', type: 'output', position: { x: 1220, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'pal_5', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── UV Warp — organic jitter on a specific element ────────────────────────
  // Shows how UV Warp adds grain-like turbulence to just one shape's edges,
  // while a second clean circle remains unaffected.
  uvWarpDemo: {
    label: 'UV Warp — Element Turbulence',
    counter: 10,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 40, y: 300 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 40, y: 500 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      // Warp UV for the jittery ring — only this element gets turbulence
      {
        id: 'warp_2', type: 'uvWarp', position: { x: 260, y: 180 },
        inputs: {
          input: { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time:  { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { output: { type: 'vec2', label: 'UV out' } },
        params: { strength: 0.025, scale: 14.0, speed: 1.2 },
      },
      // Noise float drives glow brightness — wired into brightness socket
      {
        id: 'noise_3', type: 'noiseFloat', position: { x: 260, y: 440 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { value: { type: 'float', label: 'Value (0–1)' }, signed: { type: 'float', label: 'Signed (−1–1)' } },
        params: { scale: 3.0, speed: 0.4, mode: 'smooth' },
      },
      // Warped ring — edges jitter with turbulence
      {
        id: 'ring_4', type: 'ringSDF', position: { x: 520, y: 160 },
        inputs: {
          position:  { type: 'vec2',  label: 'Position',  connection: { nodeId: 'warp_2',  outputKey: 'output' } },
          offset:    { type: 'vec2',  label: 'Offset'   },
          radius:    { type: 'float', label: 'Radius'   },
          thickness: { type: 'float', label: 'Thickness'},
        },
        outputs: { distance: { type: 'float', label: 'Distance' } },
        params: { radius: 0.45, thickness: 0.04 },
      },
      // Clean circle — no warp
      {
        id: 'circle_5', type: 'circleSDF', position: { x: 520, y: 380 },
        inputs: { uv: { type: 'vec2', label: 'UV', connection: { nodeId: 'uv_0', outputKey: 'uv' } } },
        outputs: { distance: { type: 'float', label: 'Distance' } },
        params: { radius: 0.12, x: 0.0, y: 0.0 },
      },
      // Merge both distances
      {
        id: 'smin_6', type: 'smoothMin', position: { x: 760, y: 270 },
        inputs: {
          a: { type: 'float', label: 'A', connection: { nodeId: 'ring_4',   outputKey: 'distance' } },
          b: { type: 'float', label: 'B', connection: { nodeId: 'circle_5', outputKey: 'distance' } },
        },
        outputs: { result: { type: 'float', label: 'Result' } },
        params: { smoothness: 0.05 },
      },
      // Glow — brightness modulated by noise float
      {
        id: 'light_7', type: 'makeLight', position: { x: 960, y: 240 },
        inputs: {
          distance:   { type: 'float', label: 'Distance',   connection: { nodeId: 'smin_6', outputKey: 'result' } },
          brightness: { type: 'float', label: 'Brightness', connection: { nodeId: 'noise_3', outputKey: 'value' } },
        },
        outputs: { glow: { type: 'float', label: 'Glow' } },
        params: { brightness: 20.0 },
      },
      // Palette coloring
      {
        id: 'pal_8', type: 'palettePreset', position: { x: 960, y: 420 },
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'time_1', outputKey: 'time' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { preset: '4' },
      },
      {
        id: 'mul_9', type: 'multiplyVec3', position: { x: 1160, y: 320 },
        inputs: {
          color: { type: 'vec3',  label: 'Color', connection: { nodeId: 'pal_8',   outputKey: 'color' } },
          scale: { type: 'float', label: 'Scale', connection: { nodeId: 'light_7', outputKey: 'glow'  } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } },
        params: {},
      },
      {
        id: 'out_10', type: 'output', position: { x: 1360, y: 320 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'mul_9', outputKey: 'result' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Animation Showcase — time-driven shape animation ─────────────────────
  // Demonstrates: wiring time into sin/cos to animate radius, position, rotation.
  // Three orbiting circles with pulsing glow, palette-colored by angle.
  animationShowcase: {
    label: 'Animation Showcase',
    counter: 14,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 40, y: 400 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 40, y: 600 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },

      // Orbit positions: time → expr → vec2 orbit offsets
      { id: 'orb1_2', type: 'expr', position: { x: 260, y: 100 },
        inputs: { in0: { type: 'float', label: 'in0', connection: { nodeId: 'time_1', outputKey: 'time' } }, in1: { type: 'float', label: 'in1' }, in2: { type: 'float', label: 'in2' }, in3: { type: 'float', label: 'in3' } },
        outputs: { result: { type: 'vec2', label: 'Result' } },
        params: { expr: 'vec2(cos(t*0.7), sin(t*0.7)) * 0.42', outputType: 'vec2', in0Name: 't', in1Name: 'in1', in2Name: 'in2', in3Name: 'in3' } },
      { id: 'orb2_3', type: 'expr', position: { x: 260, y: 280 },
        inputs: { in0: { type: 'float', label: 'in0', connection: { nodeId: 'time_1', outputKey: 'time' } }, in1: { type: 'float', label: 'in1' }, in2: { type: 'float', label: 'in2' }, in3: { type: 'float', label: 'in3' } },
        outputs: { result: { type: 'vec2', label: 'Result' } },
        params: { expr: 'vec2(cos(t*1.1+2.09), sin(t*1.1+2.09)) * 0.38', outputType: 'vec2', in0Name: 't', in1Name: 'in1', in2Name: 'in2', in3Name: 'in3' } },
      { id: 'orb3_4', type: 'expr', position: { x: 260, y: 460 },
        inputs: { in0: { type: 'float', label: 'in0', connection: { nodeId: 'time_1', outputKey: 'time' } }, in1: { type: 'float', label: 'in1' }, in2: { type: 'float', label: 'in2' }, in3: { type: 'float', label: 'in3' } },
        outputs: { result: { type: 'vec2', label: 'Result' } },
        params: { expr: 'vec2(cos(t*1.4+4.19), sin(t*1.4+4.19)) * 0.34', outputType: 'vec2', in0Name: 't', in1Name: 'in1', in2Name: 'in2', in3Name: 'in3' } },

      // Pulsing radius: sin(time) remapped to 0.06–0.14
      { id: 'sinR_5', type: 'sin', position: { x: 260, y: 640 },
        inputs: { input: { type: 'float', label: 'Input', connection: { nodeId: 'time_1', outputKey: 'time' } } },
        outputs: { output: { type: 'float', label: 'Output' } },
        params: { scale: 2.0 } },
      { id: 'remap_6', type: 'remap', position: { x: 460, y: 640 },
        inputs: {
          value:  { type: 'float', label: 'Value',  connection: { nodeId: 'sinR_5', outputKey: 'output' } },
          inMin:  { type: 'float', label: 'In Min'  },
          inMax:  { type: 'float', label: 'In Max'  },
          outMin: { type: 'float', label: 'Out Min' },
          outMax: { type: 'float', label: 'Out Max' },
        },
        outputs: { result: { type: 'float', label: 'Result' } },
        params: { inMin: -1.0, inMax: 1.0, outMin: 0.06, outMax: 0.14, smooth: 'smoothstep' } },

      // SDFs with shared animated radius
      { id: 'c1_7', type: 'circleSDF', position: { x: 560, y: 80 },
        inputs: { uv: { type: 'vec2', label: 'UV', connection: { nodeId: 'uv_0', outputKey: 'uv' } }, offset: { type: 'vec2', label: 'Offset', connection: { nodeId: 'orb1_2', outputKey: 'result' } }, radius: { type: 'float', label: 'Radius', connection: { nodeId: 'remap_6', outputKey: 'result' } } },
        outputs: { distance: { type: 'float', label: 'Distance' } }, params: { radius: 0.1, x: 0.0, y: 0.0 } },
      { id: 'c2_8', type: 'circleSDF', position: { x: 560, y: 280 },
        inputs: { uv: { type: 'vec2', label: 'UV', connection: { nodeId: 'uv_0', outputKey: 'uv' } }, offset: { type: 'vec2', label: 'Offset', connection: { nodeId: 'orb2_3', outputKey: 'result' } }, radius: { type: 'float', label: 'Radius', connection: { nodeId: 'remap_6', outputKey: 'result' } } },
        outputs: { distance: { type: 'float', label: 'Distance' } }, params: { radius: 0.1, x: 0.0, y: 0.0 } },
      { id: 'c3_9', type: 'circleSDF', position: { x: 560, y: 480 },
        inputs: { uv: { type: 'vec2', label: 'UV', connection: { nodeId: 'uv_0', outputKey: 'uv' } }, offset: { type: 'vec2', label: 'Offset', connection: { nodeId: 'orb3_4', outputKey: 'result' } }, radius: { type: 'float', label: 'Radius', connection: { nodeId: 'remap_6', outputKey: 'result' } } },
        outputs: { distance: { type: 'float', label: 'Distance' } }, params: { radius: 0.1, x: 0.0, y: 0.0 } },

      // Merge all three with smooth union
      { id: 'sm1_10', type: 'smoothMin', position: { x: 780, y: 180 },
        inputs: { a: { type: 'float', label: 'A', connection: { nodeId: 'c1_7', outputKey: 'distance' } }, b: { type: 'float', label: 'B', connection: { nodeId: 'c2_8', outputKey: 'distance' } } },
        outputs: { result: { type: 'float', label: 'Result' } }, params: { smoothness: 0.15 } },
      { id: 'sm2_11', type: 'smoothMin', position: { x: 780, y: 400 },
        inputs: { a: { type: 'float', label: 'A', connection: { nodeId: 'sm1_10', outputKey: 'result' } }, b: { type: 'float', label: 'B', connection: { nodeId: 'c3_9', outputKey: 'distance' } } },
        outputs: { result: { type: 'float', label: 'Result' } }, params: { smoothness: 0.15 } },

      // Glow + palette
      { id: 'light_12', type: 'makeLight', position: { x: 980, y: 300 },
        inputs: { distance: { type: 'float', label: 'Distance', connection: { nodeId: 'sm2_11', outputKey: 'result' } }, brightness: { type: 'float', label: 'Brightness' } },
        outputs: { glow: { type: 'float', label: 'Glow' } }, params: { brightness: 25.0 } },
      { id: 'pal_13', type: 'palettePreset', position: { x: 980, y: 480 },
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'time_1', outputKey: 'time' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } }, params: { preset: '2' } },
      { id: 'mul_14', type: 'multiplyVec3', position: { x: 1180, y: 380 },
        inputs: {
          color: { type: 'vec3',  label: 'Color', connection: { nodeId: 'pal_13',  outputKey: 'color' } },
          scale: { type: 'float', label: 'Scale', connection: { nodeId: 'light_12', outputKey: 'glow'  } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } }, params: {} },
      { id: 'out_15', type: 'output', position: { x: 1380, y: 380 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'mul_14', outputKey: 'result' } } },
        outputs: {}, params: {} },
    ],
  },

};

// The default graph to load on startup
export const DEFAULT_EXAMPLE = 'fractalRings';
