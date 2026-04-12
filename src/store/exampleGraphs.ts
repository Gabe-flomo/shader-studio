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
        params: { iterations: 4, fract_scale: 1.5, scale_exp: 1.0, ring_freq: 8.0, glow: 0.01, glow_pow: 1.0, iter_offset: 0.4, time_scale: 0.4, offset: [0.5,0.5,0.5], amplitude: [0.5,0.5,0.5], freq: [1.0,1.0,1.0], phase: [0.0,0.33,0.67] },
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
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'paletteT_4', outputKey: 'result' } }, offset_r: { type: 'float', label: 'offset.r' }, offset_g: { type: 'float', label: 'offset.g' }, offset_b: { type: 'float', label: 'offset.b' }, amplitude_r: { type: 'float', label: 'amplitude.r' }, amplitude_g: { type: 'float', label: 'amplitude.g' }, amplitude_b: { type: 'float', label: 'amplitude.b' }, freq_r: { type: 'float', label: 'freq.r' }, freq_g: { type: 'float', label: 'freq.g' }, freq_b: { type: 'float', label: 'freq.b' }, phase_r: { type: 'float', label: 'phase.r' }, phase_g: { type: 'float', label: 'phase.g' }, phase_b: { type: 'float', label: 'phase.b' } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { offset: [0.5,0.5,0.5], amplitude: [0.5,0.5,0.5], freq: [1.0,1.0,1.0], phase: [0.263,0.416,0.557] } },
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
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'time_1', outputKey: 'time' } }, offset_r: { type: 'float', label: 'offset.r' }, offset_g: { type: 'float', label: 'offset.g' }, offset_b: { type: 'float', label: 'offset.b' }, amplitude_r: { type: 'float', label: 'amplitude.r' }, amplitude_g: { type: 'float', label: 'amplitude.g' }, amplitude_b: { type: 'float', label: 'amplitude.b' }, freq_r: { type: 'float', label: 'freq.r' }, freq_g: { type: 'float', label: 'freq.g' }, freq_b: { type: 'float', label: 'freq.b' }, phase_r: { type: 'float', label: 'phase.r' }, phase_g: { type: 'float', label: 'phase.g' }, phase_b: { type: 'float', label: 'phase.b' } },
        outputs: { color: { type: 'vec3', label: 'Color' } }, params: { offset: [0.5,0.5,0.5], amplitude: [0.5,0.5,0.5], freq: [1.0,1.0,1.0], phase: [0.0,0.33,0.67] } },
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
          amplitude_r: { type: 'float', label: 'amplitude.r' }, amplitude_g: { type: 'float', label: 'amplitude.g' }, amplitude_b: { type: 'float', label: 'amplitude.b' },
          freq_r: { type: 'float', label: 'freq.r' }, freq_g: { type: 'float', label: 'freq.g' }, freq_b: { type: 'float', label: 'freq.b' },
          phase_r: { type: 'float', label: 'phase.r' }, phase_g: { type: 'float', label: 'phase.g' }, phase_b: { type: 'float', label: 'phase.b' },
        },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { offset: [0.5,0.5,0.5], amplitude: [0.5,0.5,0.5], freq: [1.0,1.0,1.0], phase: [0.0,0.33,0.67] } },
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
        params: { iterations: 4, fract_scale: 1.5, scale_exp: 1.0, ring_freq: 8.0, glow: 0.01, glow_pow: 1.0, iter_offset: 0.4, time_scale: 0.4, offset: [0.5,0.5,0.5], amplitude: [0.5,0.5,0.5], freq: [1.0,1.0,1.0], phase: [0.0,0.33,0.67] },
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
        params: { iterations: 4, fract_scale: 1.5, scale_exp: 1.0, ring_freq: 8.0, glow: 0.01, glow_pow: 1.0, iter_offset: 0.4, time_scale: 0.4, offset: [0.5,0.5,0.5], amplitude: [0.5,0.5,0.5], freq: [1.0,1.0,1.0], phase: [0.0,0.33,0.67] },
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
        params: { mode: 'mandelbrot', precision: 'standard', power: 2, max_iter: 256, bailout: 256, zoom: 1.0, zoom_exp: 0.0, center_x: -0.5, center_y: 0.0, cx: -0.7269, cy: 0.1889, orbit_trap: 'none', trap_x: 0.0, trap_y: 0.0, trap_r: 0.5, palette_preset: '1', color_scale: 3.0, color_offset: 0.0 },
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
        params: { mode: 'julia', precision: 'standard', power: 2, max_iter: 256, bailout: 256, zoom: 1.5, zoom_exp: 0.0, center_x: 0.0, center_y: 0.0, cx: -0.7269, cy: 0.1889, orbit_trap: 'cross', trap_x: 0.0, trap_y: 0.0, trap_r: 0.5, palette_preset: '7', color_scale: 3.0, color_offset: 0.0 },
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
        params: { mode: 'mandelbrot', precision: 'standard', power: 2, max_iter: 256, bailout: 256, zoom: 1.0, zoom_exp: 0, center_x: -0.5, center_y: 0, orbit_trap: 'none', trap_x: 0, trap_y: 0, trap_r: 0.5, palette_preset: '1', color_scale: 3.0, color_offset: 0 },
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
        params: { mode: 'mandelbrot', precision: 'standard', power: 2, max_iter: 256, bailout: 256, zoom: 1.0, zoom_exp: 0.0, center_x: -0.5, center_y: 0.0, cx: -0.7269, cy: 0.1889, orbit_trap: 'none', trap_x: 0.0, trap_y: 0.0, trap_r: 0.5, palette_preset: '1', color_scale: 3.0, color_offset: 0.0 },
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

  // ── Fractal Rings (Wired Loop) — domain fold iterated via LoopStart/End ──────
  // LoopStart/End carry a vec2 UV. Each iteration applies a domain fold (abs+scale),
  // producing a folded fractal space. The final UV's length drives the palette.
  fractalRingsWired: {
    label: 'Fractal Rings (Wired)',
    counter: 6,
    nodes: [
      {
        id: 'uv_0', type: 'uv', position: { x: 40, y: 240 },
        inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {},
      },
      {
        id: 'time_1', type: 'time', position: { x: 40, y: 420 },
        inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {},
      },
      {
        id: 'start_2', type: 'loopStart', position: { x: 220, y: 220 },
        inputs: { carry: { type: 'vec2', label: 'Initial value', connection: { nodeId: 'uv_0', outputKey: 'uv' } } },
        outputs: { carry: { type: 'vec2', label: 'Carry →' }, iter_index: { type: 'float', label: 'Iter Index' } },
        params: { iterations: 7, carryType: 'vec2' },
      },
      {
        id: 'fold_3', type: 'loopDomainFold', position: { x: 420, y: 200 },
        inputs: { uv: { type: 'vec2', label: 'UV', connection: { nodeId: 'start_2', outputKey: 'carry' } } },
        outputs: { uv: { type: 'vec2', label: 'UV out' } },
        params: { scale: 1.8, offsetX: 0.5, offsetY: 0.3 },
      },
      {
        id: 'end_4', type: 'loopEnd', position: { x: 620, y: 220 },
        inputs: { carry: { type: 'vec2', label: '← Carry in', connection: { nodeId: 'fold_3', outputKey: 'uv' } } },
        outputs: { result: { type: 'vec2', label: 'Result' } },
        params: {},
      },
      // length of folded UV → ring SDF pattern
      {
        id: 'len_5', type: 'length', position: { x: 800, y: 240 },
        inputs: { input: { type: 'vec2', label: 'Input', connection: { nodeId: 'end_4', outputKey: 'result' } } },
        outputs: { output: { type: 'float', label: 'Output' } },
        params: { scale: 1.0 },
      },
      {
        id: 'pal_6', type: 'palettePreset', position: { x: 980, y: 200 },
        inputs: {
          t: { type: 'float', label: 'T', connection: { nodeId: 'len_5', outputKey: 'output' } },
        },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { preset: '2' },
      },
      {
        id: 'out_7', type: 'output', position: { x: 1160, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'pal_6', outputKey: 'color' } } },
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
      // Warped ring — edges jitter with turbulence
      {
        id: 'ring_4', type: 'ringSDF', position: { x: 520, y: 160 },
        inputs: {
          position: { type: 'vec2',  label: 'Position', connection: { nodeId: 'warp_2', outputKey: 'output' } },
        },
        outputs: { distance: { type: 'float', label: 'Distance' } },
        params: { radius: 0.35 },
      },
      // Clean inner circle — no warp, shows contrast
      {
        id: 'circle_5', type: 'circleSDF', position: { x: 520, y: 380 },
        inputs: { position: { type: 'vec2', label: 'Position', connection: { nodeId: 'uv_0', outputKey: 'uv' } } },
        outputs: { distance: { type: 'float', label: 'Distance' } },
        params: { radius: 0.1 },
      },
      // Merge both distances with smooth union
      {
        id: 'smin_6', type: 'smoothMin', position: { x: 740, y: 270 },
        inputs: {
          a: { type: 'float', label: 'A', connection: { nodeId: 'ring_4',   outputKey: 'distance' } },
          b: { type: 'float', label: 'B', connection: { nodeId: 'circle_5', outputKey: 'distance' } },
        },
        outputs: { result: { type: 'float', label: 'Result' } },
        params: { smoothness: 0.04 },
      },
      {
        id: 'light_7', type: 'makeLight', position: { x: 930, y: 270 },
        inputs: { distance: { type: 'float', label: 'Distance', connection: { nodeId: 'smin_6', outputKey: 'result' } } },
        outputs: { glow: { type: 'float', label: 'Glow' } },
        params: { brightness: 22.0 },
      },
      {
        id: 'pal_8', type: 'palettePreset', position: { x: 930, y: 440 },
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'time_1', outputKey: 'time' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { preset: '4' },
      },
      {
        id: 'mul_9', type: 'multiplyVec3', position: { x: 1130, y: 355 },
        inputs: {
          color: { type: 'vec3',  label: 'Color', connection: { nodeId: 'pal_8',   outputKey: 'color' } },
          scale: { type: 'float', label: 'Scale', connection: { nodeId: 'light_7', outputKey: 'glow'  } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } },
        params: {},
      },
      {
        id: 'out_10', type: 'output', position: { x: 1330, y: 355 },
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
        inputs: { position: { type: 'vec2', label: 'Position', connection: { nodeId: 'uv_0', outputKey: 'uv' } }, offset: { type: 'vec2', label: 'Offset', connection: { nodeId: 'orb1_2', outputKey: 'result' } }, radius: { type: 'float', label: 'Radius', connection: { nodeId: 'remap_6', outputKey: 'result' } } },
        outputs: { distance: { type: 'float', label: 'Distance' } }, params: { radius: 0.1 } },
      { id: 'c2_8', type: 'circleSDF', position: { x: 560, y: 280 },
        inputs: { position: { type: 'vec2', label: 'Position', connection: { nodeId: 'uv_0', outputKey: 'uv' } }, offset: { type: 'vec2', label: 'Offset', connection: { nodeId: 'orb2_3', outputKey: 'result' } }, radius: { type: 'float', label: 'Radius', connection: { nodeId: 'remap_6', outputKey: 'result' } } },
        outputs: { distance: { type: 'float', label: 'Distance' } }, params: { radius: 0.1 } },
      { id: 'c3_9', type: 'circleSDF', position: { x: 560, y: 480 },
        inputs: { position: { type: 'vec2', label: 'Position', connection: { nodeId: 'uv_0', outputKey: 'uv' } }, offset: { type: 'vec2', label: 'Offset', connection: { nodeId: 'orb3_4', outputKey: 'result' } }, radius: { type: 'float', label: 'Radius', connection: { nodeId: 'remap_6', outputKey: 'result' } } },
        outputs: { distance: { type: 'float', label: 'Distance' } }, params: { radius: 0.1 } },

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

  // ── Noise Float — per-pixel randomness injected into SDF radius ──────────
  noiseFloatDemo: {
    label: 'Noise Float — Wobbly Circle',
    counter: 8,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 40,  y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 40,  y: 400 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      // Noise float drives the circle radius — edges pulse and wobble per-pixel
      { id: 'noise_2', type: 'noiseFloat', position: { x: 260, y: 180 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { value: { type: 'float', label: 'Value' }, signed: { type: 'float', label: 'Signed' } },
        params: { scale: 6.0, speed: 0.8, mode: 'smooth' } },
      // Remap 0–1 noise to a small radius range so the circle stays visible
      { id: 'remap_3', type: 'remap', position: { x: 480, y: 180 },
        inputs: { value: { type: 'float', label: 'Value', connection: { nodeId: 'noise_2', outputKey: 'value' } } },
        outputs: { result: { type: 'float', label: 'Result' } },
        params: { inMin: 0.0, inMax: 1.0, outMin: 0.18, outMax: 0.38, smooth: 'smoothstep' } },
      // Circle SDF with noise-driven radius
      { id: 'circ_4', type: 'circleSDF', position: { x: 700, y: 200 },
        inputs: {
          position: { type: 'vec2',  label: 'Position', connection: { nodeId: 'uv_0',    outputKey: 'uv'     } },
          radius:   { type: 'float', label: 'Radius',   connection: { nodeId: 'remap_3', outputKey: 'result' } },
        },
        outputs: { distance: { type: 'float', label: 'Distance' } },
        params: { radius: 0.3 } },
      { id: 'light_5', type: 'makeLight', position: { x: 900, y: 200 },
        inputs: { distance: { type: 'float', label: 'Distance', connection: { nodeId: 'circ_4', outputKey: 'distance' } } },
        outputs: { glow: { type: 'float', label: 'Glow' } },
        params: { brightness: 25.0 } },
      { id: 'pal_6', type: 'palettePreset', position: { x: 900, y: 380 },
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'time_1', outputKey: 'time' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { preset: '2' } },
      { id: 'mul_7', type: 'multiplyVec3', position: { x: 1100, y: 290 },
        inputs: {
          color: { type: 'vec3',  label: 'Color', connection: { nodeId: 'pal_6',   outputKey: 'color' } },
          scale: { type: 'float', label: 'Scale', connection: { nodeId: 'light_5', outputKey: 'glow'  } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } }, params: {} },
      { id: 'out_8', type: 'output', position: { x: 1300, y: 290 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'mul_7', outputKey: 'result' } } },
        outputs: {}, params: {} },
    ],
  },

  // ── HSV — time-driven hue rotation ───────────────────────────────────────
  hsvDemo: {
    label: 'HSV — Hue Rotation',
    counter: 10,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 40,  y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 40,  y: 420 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      // FBM for a base texture
      { id: 'fbm_2', type: 'fbm', position: { x: 240, y: 200 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { value: { type: 'float', label: 'Value' }, uv: { type: 'vec2', label: 'UV' } },
        params: { octaves: 4, lacunarity: 2.0, gain: 0.5, scale: 3.0, speed: 0.2 } },
      // Color from palette
      { id: 'pal_3', type: 'palettePreset', position: { x: 460, y: 200 },
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'fbm_2', outputKey: 'value' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { preset: '1' } },
      // RGB → HSV: extract hue/sat/val
      { id: 'hsv_4', type: 'hsv', position: { x: 680, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'pal_3', outputKey: 'color' } } },
        outputs: { color: { type: 'vec3', label: 'Color' }, h: { type: 'float', label: 'H' }, s: { type: 'float', label: 'S' }, v: { type: 'float', label: 'V' } },
        params: { direction: 'rgb2hsv' } },
      // Add time to hue (fract keeps it 0-1)
      { id: 'add_5', type: 'add', position: { x: 880, y: 160 },
        inputs: {
          a: { type: 'float', label: 'A', connection: { nodeId: 'hsv_4',  outputKey: 'h'    } },
          b: { type: 'float', label: 'B', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { result: { type: 'float', label: 'Result' } }, params: { b: 0.0 } },
      { id: 'frac_6', type: 'fractRaw', position: { x: 1060, y: 160 },
        inputs: { input: { type: 'float', label: 'Input', connection: { nodeId: 'add_5', outputKey: 'result' } } },
        outputs: { output: { type: 'float', label: 'Output' } }, params: {} },
      // Back to RGB using rotated hue but same S and V
      { id: 'mkv_7', type: 'makeVec3', position: { x: 1060, y: 320 },
        inputs: {
          r: { type: 'float', label: 'R', connection: { nodeId: 'frac_6', outputKey: 'output' } },
          g: { type: 'float', label: 'G', connection: { nodeId: 'hsv_4',  outputKey: 's'      } },
          b: { type: 'float', label: 'B', connection: { nodeId: 'hsv_4',  outputKey: 'v'      } },
        },
        outputs: { rgb: { type: 'vec3', label: 'RGB' } }, params: {} },
      { id: 'hsv2_8', type: 'hsv', position: { x: 1260, y: 290 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'mkv_7', outputKey: 'rgb' } } },
        outputs: { color: { type: 'vec3', label: 'Color' }, h: { type: 'float', label: 'H' }, s: { type: 'float', label: 'S' }, v: { type: 'float', label: 'V' } },
        params: { direction: 'hsv2rgb' } },
      { id: 'out_9', type: 'output', position: { x: 1460, y: 290 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'hsv2_8', outputKey: 'color' } } },
        outputs: {}, params: {} },
    ],
  },

  // ── Posterize — cel-shading with noise-driven levels ─────────────────────
  posterizeDemo: {
    label: 'Posterize — Cel Shading',
    counter: 9,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 40,  y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 40,  y: 400 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      // Domain warp for an interesting base field
      { id: 'dw_2', type: 'domainWarp', position: { x: 240, y: 200 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { uv: { type: 'vec2', label: 'UV' } },
        params: { strength: 0.4, scale: 2.5, speed: 0.3 } },
      { id: 'fbm_3', type: 'fbm', position: { x: 460, y: 200 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'dw_2',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { value: { type: 'float', label: 'Value' }, uv: { type: 'vec2', label: 'UV' } },
        params: { octaves: 4, lacunarity: 2.2, gain: 0.5, scale: 2.0, speed: 0.0 } },
      // Color from palette
      { id: 'pal_4', type: 'palettePreset', position: { x: 680, y: 200 },
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'fbm_3', outputKey: 'value' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { preset: '0' } },
      // Noise float drives levels — organic dithering between 3–12 bands
      { id: 'noise_5', type: 'noiseFloat', position: { x: 680, y: 380 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { value: { type: 'float', label: 'Value' }, signed: { type: 'float', label: 'Signed' } },
        params: { scale: 1.5, speed: 0.15, mode: 'smooth' } },
      { id: 'remap_6', type: 'remap', position: { x: 880, y: 380 },
        inputs: { value: { type: 'float', label: 'Value', connection: { nodeId: 'noise_5', outputKey: 'value' } } },
        outputs: { result: { type: 'float', label: 'Result' } },
        params: { inMin: 0.0, inMax: 1.0, outMin: 3.0, outMax: 12.0, smooth: 'smoothstep' } },
      // Posterize with noise-driven levels
      { id: 'post_7', type: 'posterize', position: { x: 1060, y: 290 },
        inputs: {
          color:  { type: 'vec3',  label: 'Color',  connection: { nodeId: 'pal_4',   outputKey: 'color'  } },
          levels: { type: 'float', label: 'Levels', connection: { nodeId: 'remap_6', outputKey: 'result' } },
        },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { levels: 6.0 } },
      { id: 'out_8', type: 'output', position: { x: 1260, y: 290 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'post_7', outputKey: 'color' } } },
        outputs: {}, params: {} },
    ],
  },

  // ── Invert — negative space fractal ──────────────────────────────────────
  invertDemo: {
    label: 'Invert — Negative Space',
    counter: 6,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 40,  y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 40,  y: 400 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      // Fractal loop base
      { id: 'fractal_2', type: 'fractalLoop', position: { x: 280, y: 160 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { color: { type: 'vec3', label: 'Color' }, uv_final: { type: 'vec2', label: 'UV Final' }, uv0: { type: 'vec2', label: 'UV0' } },
        params: { iterations: 4, fract_scale: 1.5, scale_exp: 1.0, ring_freq: 8.0, glow: 0.01, glow_pow: 1.0, iter_offset: 0.4, time_scale: 0.4, offset: [0.5,0.5,0.5], amplitude: [0.5,0.5,0.5], freq: [1.0,1.0,1.0], phase: [0.0,0.33,0.67] } },
      // Invert flips dark and light — bright rings become dark, dark gaps become glowing
      { id: 'inv_3', type: 'invert', position: { x: 600, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'fractal_2', outputKey: 'color' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: {} },
      // Desaturate slightly to push toward monochrome
      { id: 'desat_4', type: 'desaturate', position: { x: 800, y: 200 },
        inputs: {
          color:  { type: 'vec3',  label: 'Color',  connection: { nodeId: 'inv_3', outputKey: 'color' } },
        },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { amount: 0.4 } },
      { id: 'out_5', type: 'output', position: { x: 1000, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'desat_4', outputKey: 'color' } } },
        outputs: {}, params: {} },
    ],
  },

  // ── Desaturate — animated saturation pulse ───────────────────────────────
  desaturateDemo: {
    label: 'Desaturate — Saturation Pulse',
    counter: 9,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 40,  y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 40,  y: 420 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      // Voronoi base — colorful cell structure
      { id: 'vor_2', type: 'voronoi', position: { x: 240, y: 200 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { dist: { type: 'float', label: 'Distance' }, uv: { type: 'vec2', label: 'UV' } },
        params: { scale: 5.0, time_scale: 0.3, jitter: 1.0 } },
      { id: 'pal_3', type: 'palettePreset', position: { x: 460, y: 200 },
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'vor_2', outputKey: 'dist' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { preset: '1' } },
      // Multiply by glow from distance
      { id: 'light_4', type: 'makeLight', position: { x: 460, y: 380 },
        inputs: { distance: { type: 'float', label: 'Distance', connection: { nodeId: 'vor_2', outputKey: 'dist' } } },
        outputs: { glow: { type: 'float', label: 'Glow' } },
        params: { brightness: 8.0 } },
      { id: 'mul_5', type: 'multiplyVec3', position: { x: 680, y: 290 },
        inputs: {
          color: { type: 'vec3',  label: 'Color', connection: { nodeId: 'pal_3',   outputKey: 'color' } },
          scale: { type: 'float', label: 'Scale', connection: { nodeId: 'light_4', outputKey: 'glow'  } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } }, params: {} },
      // Sin(time) remapped to 0–1 drives desaturation — color pulses in and out
      { id: 'sin_6', type: 'sin', position: { x: 680, y: 460 },
        inputs: { input: { type: 'float', label: 'Input', connection: { nodeId: 'time_1', outputKey: 'time' } } },
        outputs: { output: { type: 'float', label: 'Output' } }, params: {} },
      { id: 'remap_7', type: 'remap', position: { x: 880, y: 460 },
        inputs: { value: { type: 'float', label: 'Value', connection: { nodeId: 'sin_6', outputKey: 'output' } } },
        outputs: { result: { type: 'float', label: 'Result' } },
        params: { inMin: -1.0, inMax: 1.0, outMin: 0.0, outMax: 1.0, smooth: 'linear' } },
      { id: 'desat_8', type: 'desaturate', position: { x: 880, y: 300 },
        inputs: {
          color:  { type: 'vec3',  label: 'Color',  connection: { nodeId: 'mul_5',  outputKey: 'result' } },
          amount: { type: 'float', label: 'Amount', connection: { nodeId: 'remap_7', outputKey: 'result' } },
        },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { amount: 0.5 } },
      { id: 'out_9', type: 'output', position: { x: 1080, y: 300 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'desat_8', outputKey: 'color' } } },
        outputs: {}, params: {} },
    ],
  },

  // ── Remap — noise → parameter modulation ─────────────────────────────────
  remapDemo: {
    label: 'Remap — Noise-Driven Radius',
    counter: 10,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 40,  y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 40,  y: 420 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      // Three noise floats at different scales/speeds each remap to a ring radius
      { id: 'n1_2', type: 'noiseFloat', position: { x: 240, y: 80 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { value: { type: 'float', label: 'Value' }, signed: { type: 'float', label: 'Signed' } },
        params: { scale: 1.0, speed: 0.3, mode: 'smooth' } },
      { id: 'n2_3', type: 'noiseFloat', position: { x: 240, y: 280 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { value: { type: 'float', label: 'Value' }, signed: { type: 'float', label: 'Signed' } },
        params: { scale: 2.0, speed: 0.5, mode: 'smooth' } },
      { id: 'n3_4', type: 'noiseFloat', position: { x: 240, y: 480 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { value: { type: 'float', label: 'Value' }, signed: { type: 'float', label: 'Signed' } },
        params: { scale: 3.5, speed: 0.9, mode: 'smooth' } },
      // Each remapped to a different radius range
      { id: 'r1_5', type: 'remap', position: { x: 460, y: 80 },
        inputs: { value: { type: 'float', label: 'Value', connection: { nodeId: 'n1_2', outputKey: 'value' } } },
        outputs: { result: { type: 'float', label: 'Result' } },
        params: { inMin: 0.0, inMax: 1.0, outMin: 0.08, outMax: 0.18, smooth: 'smoothstep' } },
      { id: 'r2_6', type: 'remap', position: { x: 460, y: 280 },
        inputs: { value: { type: 'float', label: 'Value', connection: { nodeId: 'n2_3', outputKey: 'value' } } },
        outputs: { result: { type: 'float', label: 'Result' } },
        params: { inMin: 0.0, inMax: 1.0, outMin: 0.22, outMax: 0.34, smooth: 'smoothstep' } },
      { id: 'r3_7', type: 'remap', position: { x: 460, y: 480 },
        inputs: { value: { type: 'float', label: 'Value', connection: { nodeId: 'n3_4', outputKey: 'value' } } },
        outputs: { result: { type: 'float', label: 'Result' } },
        params: { inMin: 0.0, inMax: 1.0, outMin: 0.38, outMax: 0.50, smooth: 'smoothstep' } },
      // Three ring SDFs, one per remapped radius
      { id: 'rg1_8', type: 'ringSDF', position: { x: 680, y: 80 },
        inputs: {
          position: { type: 'vec2',  label: 'Position', connection: { nodeId: 'uv_0', outputKey: 'uv'     } },
          radius:   { type: 'float', label: 'Radius',   connection: { nodeId: 'r1_5', outputKey: 'result' } },
        },
        outputs: { distance: { type: 'float', label: 'Distance' } },
        params: { radius: 0.12 } },
      { id: 'rg2_9', type: 'ringSDF', position: { x: 680, y: 280 },
        inputs: {
          position: { type: 'vec2',  label: 'Position', connection: { nodeId: 'uv_0', outputKey: 'uv'     } },
          radius:   { type: 'float', label: 'Radius',   connection: { nodeId: 'r2_6', outputKey: 'result' } },
        },
        outputs: { distance: { type: 'float', label: 'Distance' } },
        params: { radius: 0.28 } },
      { id: 'rg3_10', type: 'ringSDF', position: { x: 680, y: 480 },
        inputs: {
          position: { type: 'vec2',  label: 'Position', connection: { nodeId: 'uv_0', outputKey: 'uv'      } },
          radius:   { type: 'float', label: 'Radius',   connection: { nodeId: 'r3_7', outputKey: 'result'  } },
        },
        outputs: { distance: { type: 'float', label: 'Distance' } },
        params: { radius: 0.44 } },
      // Smooth-min to merge three rings into one SDF field
      { id: 'sm1_11', type: 'smoothMin', position: { x: 900, y: 160 },
        inputs: {
          a: { type: 'float', label: 'A', connection: { nodeId: 'rg1_8', outputKey: 'distance' } },
          b: { type: 'float', label: 'B', connection: { nodeId: 'rg2_9', outputKey: 'distance' } },
        },
        outputs: { result: { type: 'float', label: 'Result' } }, params: { smoothness: 0.04 } },
      { id: 'sm2_12', type: 'smoothMin', position: { x: 900, y: 380 },
        inputs: {
          a: { type: 'float', label: 'A', connection: { nodeId: 'sm1_11',  outputKey: 'result'   } },
          b: { type: 'float', label: 'B', connection: { nodeId: 'rg3_10',  outputKey: 'distance' } },
        },
        outputs: { result: { type: 'float', label: 'Result' } }, params: { smoothness: 0.04 } },
      { id: 'light_13', type: 'makeLight', position: { x: 1100, y: 290 },
        inputs: { distance: { type: 'float', label: 'Distance', connection: { nodeId: 'sm2_12', outputKey: 'result' } } },
        outputs: { glow: { type: 'float', label: 'Glow' } },
        params: { brightness: 28.0 } },
      { id: 'pal_14', type: 'palettePreset', position: { x: 1100, y: 460 },
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'time_1', outputKey: 'time' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { preset: '2' } },
      { id: 'mul_15', type: 'multiplyVec3', position: { x: 1300, y: 370 },
        inputs: {
          color: { type: 'vec3',  label: 'Color', connection: { nodeId: 'pal_14',   outputKey: 'color' } },
          scale: { type: 'float', label: 'Scale', connection: { nodeId: 'light_13', outputKey: 'glow'  } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } }, params: {} },
      { id: 'out_16', type: 'output', position: { x: 1500, y: 370 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'mul_15', outputKey: 'result' } } },
        outputs: {}, params: {} },
    ],
  },

  // ── Smooth Warp — flowing noise displaces a ring ─────────────────────────
  smoothWarpDemo: {
    label: 'Smooth Warp — Flowing Ring',
    counter: 8,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 40,  y: 180 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 40,  y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      // Smooth warp displaces UV before feeding the ring SDF
      { id: 'warp_2', type: 'smoothWarp', position: { x: 260, y: 180 },
        inputs: {
          input: { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time:  { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { output: { type: 'vec2', label: 'UV out' } },
        params: { strength: 0.18, scale: 3.5, speed: 0.5 } },
      // Ring SDF on warped UV
      { id: 'ring_3', type: 'ringSDF', position: { x: 520, y: 180 },
        inputs: { position: { type: 'vec2', label: 'Position', connection: { nodeId: 'warp_2', outputKey: 'output' } } },
        outputs: { distance: { type: 'float', label: 'Distance' } },
        params: { radius: 0.35 } },
      // Glow
      { id: 'light_4', type: 'makeLight', position: { x: 720, y: 180 },
        inputs: { distance: { type: 'float', label: 'Distance', connection: { nodeId: 'ring_3', outputKey: 'distance' } } },
        outputs: { glow: { type: 'float', label: 'Glow' } },
        params: { brightness: 30.0 } },
      // Palette driven by time
      { id: 'pal_5', type: 'palettePreset', position: { x: 720, y: 360 },
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'time_1', outputKey: 'time' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { preset: '3' } },
      { id: 'mul_6', type: 'multiplyVec3', position: { x: 940, y: 270 },
        inputs: {
          color: { type: 'vec3',  label: 'Color', connection: { nodeId: 'pal_5',   outputKey: 'color' } },
          scale: { type: 'float', label: 'Scale', connection: { nodeId: 'light_4', outputKey: 'glow'  } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } }, params: {} },
      { id: 'out_7', type: 'output', position: { x: 1140, y: 270 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'mul_6', outputKey: 'result' } } },
        outputs: {}, params: {} },
    ],
  },

  // ── Curl Warp — fluid smoke field ─────────────────────────────────────────
  curlWarpDemo: {
    label: 'Curl Warp — Fluid Smoke',
    counter: 7,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 40,  y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 40,  y: 400 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      // Curl warp → feed into FBM for layered smoke look
      { id: 'curl_2', type: 'curlWarp', position: { x: 270, y: 200 },
        inputs: {
          input: { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time:  { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { output: { type: 'vec2', label: 'UV out' } },
        params: { strength: 0.35, scale: 2.5, speed: 0.3 } },
      // FBM over warped UV gives smoke density
      { id: 'fbm_3', type: 'fbm', position: { x: 520, y: 200 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'curl_2', outputKey: 'output' } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time'   } },
        },
        outputs: { value: { type: 'float', label: 'Value' }, uv: { type: 'vec2', label: 'UV' } },
        params: { octaves: 5, lacunarity: 2.0, gain: 0.5, scale: 3.0, speed: 0.0 } },
      // Palette maps density to color
      { id: 'pal_4', type: 'palettePreset', position: { x: 740, y: 340 },
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'fbm_3', outputKey: 'value' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { preset: '5' } },
      { id: 'mul_5', type: 'multiplyVec3', position: { x: 940, y: 270 },
        inputs: {
          color: { type: 'vec3',  label: 'Color', connection: { nodeId: 'pal_4', outputKey: 'color' } },
          scale: { type: 'float', label: 'Scale', connection: { nodeId: 'fbm_3', outputKey: 'value' } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } }, params: {} },
      { id: 'out_6', type: 'output', position: { x: 1140, y: 270 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'mul_5', outputKey: 'result' } } },
        outputs: {}, params: {} },
    ],
  },

  // ── Swirl Warp — spinning vortex with FBM background ─────────────────────
  swirlWarpDemo: {
    label: 'Swirl Warp — Vortex',
    counter: 8,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 40,  y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 40,  y: 400 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      // Swirl warp
      { id: 'swirl_2', type: 'swirlWarp', position: { x: 270, y: 200 },
        inputs: {
          input: { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time:  { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { output: { type: 'vec2', label: 'UV out' } },
        params: { strength: 4.0, falloff: 3.5, cx: 0.0, cy: 0.0, speed: 0.25 } },
      // Multiple concentric rings in the swirled space
      { id: 'ring_3', type: 'ringSDF', position: { x: 500, y: 160 },
        inputs: { position: { type: 'vec2', label: 'Position', connection: { nodeId: 'swirl_2', outputKey: 'output' } } },
        outputs: { distance: { type: 'float', label: 'Distance' } },
        params: { radius: 0.22 } },
      { id: 'ring_4', type: 'ringSDF', position: { x: 500, y: 320 },
        inputs: { position: { type: 'vec2', label: 'Position', connection: { nodeId: 'swirl_2', outputKey: 'output' } } },
        outputs: { distance: { type: 'float', label: 'Distance' } },
        params: { radius: 0.42 } },
      { id: 'smin_rings', type: 'smoothMin', position: { x: 680, y: 240 },
        inputs: {
          a: { type: 'float', label: 'A', connection: { nodeId: 'ring_3', outputKey: 'distance' } },
          b: { type: 'float', label: 'B', connection: { nodeId: 'ring_4', outputKey: 'distance' } },
        },
        outputs: { result: { type: 'float', label: 'Result' } }, params: { smoothness: 0.02 } },
      { id: 'light_5', type: 'makeLight', position: { x: 900, y: 240 },
        inputs: { distance: { type: 'float', label: 'Distance', connection: { nodeId: 'smin_rings', outputKey: 'result' } } },
        outputs: { glow: { type: 'float', label: 'Glow' } },
        params: { brightness: 28.0 } },
      { id: 'pal_6', type: 'palettePreset', position: { x: 900, y: 420 },
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'time_1', outputKey: 'time' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { preset: '1' } },
      { id: 'mul_7', type: 'multiplyVec3', position: { x: 1100, y: 330 },
        inputs: {
          color: { type: 'vec3',  label: 'Color', connection: { nodeId: 'pal_6',   outputKey: 'color' } },
          scale: { type: 'float', label: 'Scale', connection: { nodeId: 'light_5', outputKey: 'glow'  } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } }, params: {} },
      { id: 'out_8', type: 'output', position: { x: 1300, y: 330 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'mul_7', outputKey: 'result' } } },
        outputs: {}, params: {} },
    ],
  },

  // ── Displace — custom warp: noise drives a vec2 displacement ─────────────
  displaceDemo: {
    label: 'Displace — Custom Warp',
    counter: 10,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 40,  y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 40,  y: 400 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      // Two noise floats at different phases build the X and Y components
      { id: 'nx_2', type: 'noiseFloat', position: { x: 270, y: 100 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { value: { type: 'float', label: 'Value' }, signed: { type: 'float', label: 'Signed' } },
        params: { scale: 3.0, speed: 0.4, mode: 'smooth' } },
      { id: 'ny_3', type: 'noiseFloat', position: { x: 270, y: 320 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { value: { type: 'float', label: 'Value' }, signed: { type: 'float', label: 'Signed' } },
        params: { scale: 2.5, speed: 0.6, mode: 'smooth' } },
      // Combine signed noise into a displacement vec2
      { id: 'mkv_4', type: 'makeVec2', position: { x: 510, y: 200 },
        inputs: {
          x: { type: 'float', label: 'X', connection: { nodeId: 'nx_2', outputKey: 'signed' } },
          y: { type: 'float', label: 'Y', connection: { nodeId: 'ny_3', outputKey: 'signed' } },
        },
        outputs: { xy: { type: 'vec2', label: 'XY' } }, params: {} },
      // Displace node wires the vec2 as the warp field
      { id: 'disp_5', type: 'displace', position: { x: 710, y: 200 },
        inputs: {
          input:  { type: 'vec2',  label: 'UV',      connection: { nodeId: 'uv_0',  outputKey: 'uv'  } },
          offset: { type: 'vec2',  label: 'Offset',  connection: { nodeId: 'mkv_4', outputKey: 'xy'  } },
        },
        outputs: { output: { type: 'vec2', label: 'UV out' } },
        params: { amount: 0.2 } },
      // SDF on displaced UV
      { id: 'circ_6', type: 'circleSDF', position: { x: 920, y: 200 },
        inputs: { position: { type: 'vec2', label: 'Position', connection: { nodeId: 'disp_5', outputKey: 'output' } } },
        outputs: { distance: { type: 'float', label: 'Distance' } },
        params: { radius: 0.3 } },
      { id: 'light_7', type: 'makeLight', position: { x: 1100, y: 200 },
        inputs: { distance: { type: 'float', label: 'Distance', connection: { nodeId: 'circ_6', outputKey: 'distance' } } },
        outputs: { glow: { type: 'float', label: 'Glow' } },
        params: { brightness: 20.0 } },
      { id: 'pal_8', type: 'palettePreset', position: { x: 1100, y: 380 },
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'time_1', outputKey: 'time' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { preset: '4' } },
      { id: 'mul_9', type: 'multiplyVec3', position: { x: 1300, y: 290 },
        inputs: {
          color: { type: 'vec3',  label: 'Color', connection: { nodeId: 'pal_8',   outputKey: 'color' } },
          scale: { type: 'float', label: 'Scale', connection: { nodeId: 'light_7', outputKey: 'glow'  } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } }, params: {} },
      { id: 'out_10', type: 'output', position: { x: 1500, y: 290 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'mul_9', outputKey: 'result' } } },
        outputs: {}, params: {} },
    ],
  },


  // ── Sine LFO — oscillating FBM scale driven by a Sine LFO ─────────────────
  sineLFODemo: {
    label: 'Sine LFO',
    counter: 7,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 40,  y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 40,  y: 420 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      // SineLFO oscillates at 0.5Hz, remapped to [1.5, 6] for FBM scale
      { id: 'lfo_2',  type: 'sineLFO', position: { x: 280, y: 420 },
        inputs:  { time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } } },
        outputs: { value: { type: 'float', label: 'Value' } },
        params:  { freq: 0.5, phase: 0.0, amplitude: 1.0, offset: 0.0 } },
      { id: 'remap_3', type: 'remap', position: { x: 520, y: 420 },
        inputs:  { value: { type: 'float', label: 'Value', connection: { nodeId: 'lfo_2', outputKey: 'value' } },
                   inMin: { type: 'float', label: 'In Min' }, inMax: { type: 'float', label: 'In Max' },
                   outMin: { type: 'float', label: 'Out Min' }, outMax: { type: 'float', label: 'Out Max' } },
        outputs: { value: { type: 'float', label: 'Value' } },
        params:  { inMin: -1.0, inMax: 1.0, outMin: 1.5, outMax: 6.0 } },
      { id: 'fbm_4', type: 'fbm', position: { x: 520, y: 200 },
        inputs:  { uv:    { type: 'vec2',  label: 'UV',    connection: { nodeId: 'uv_0',    outputKey: 'uv'    } },
                   time:  { type: 'float', label: 'Time',  connection: { nodeId: 'time_1',  outputKey: 'time'  } },
                   scale: { type: 'float', label: 'Scale', connection: { nodeId: 'remap_3', outputKey: 'value' } } },
        outputs: { value: { type: 'float', label: 'Value' }, uv: { type: 'vec2', label: 'UV (pass-through)' } },
        params:  { octaves: 4, lacunarity: 2.0, gain: 0.5, scale: 3.0, time_scale: 0.1 } },
      { id: 'pal_5', type: 'palettePreset', position: { x: 800, y: 200 },
        inputs:  { t: { type: 'float', label: 'T', connection: { nodeId: 'fbm_4', outputKey: 'value' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params:  { preset: '2' } },
      { id: 'out_6', type: 'output', position: { x: 1060, y: 200 },
        inputs:  { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'pal_5', outputKey: 'color' } } },
        outputs: {}, params: {} },
    ],
  },

  // ── Prev Frame Trails — persistence/motion-blur via PrevFrame ping-pong ────
  // prevColor * 0.95 + newColor * 0.05 = 95% previous frame bleeds into current
  prevFrameTrails: {
    label: 'Prev Frame Trails',
    counter: 10,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 40,  y: 240 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 40,  y: 440 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      // Animated Voronoi generates moving cell content each frame
      { id: 'vor_2', type: 'voronoi', position: { x: 280, y: 160 },
        inputs:  { uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
                   time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } } },
        outputs: { dist: { type: 'float', label: 'Distance' }, uv: { type: 'vec2', label: 'UV (pass-through)' } },
        params:  { scale: 4.0, jitter: 1.0, time_scale: 0.4 } },
      { id: 'pal_3', type: 'palettePreset', position: { x: 540, y: 160 },
        inputs:  { t: { type: 'float', label: 'T', connection: { nodeId: 'vor_2', outputKey: 'dist' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params:  { preset: '1' } },
      // PrevFrame samples the previous rendered output
      { id: 'prev_4', type: 'prevFrame', position: { x: 280, y: 440 },
        inputs:  { uv: { type: 'vec2', label: 'UV', connection: { nodeId: 'uv_0', outputKey: 'uv' } } },
        outputs: { color: { type: 'vec3', label: 'Color' }, alpha: { type: 'float', label: 'Alpha' }, uv: { type: 'vec2', label: 'UV (pass-through)' } },
        params:  {} },
      // prevColor * 0.95
      { id: 'mulPrev_5', type: 'multiplyVec3', position: { x: 800, y: 400 },
        inputs:  { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'prev_4', outputKey: 'color' } },
                   scale: { type: 'float', label: 'Scale' } },
        outputs: { result: { type: 'vec3', label: 'Result' } },
        params:  { scale: 0.95 } },
      // newColor * 0.05
      { id: 'mulNew_6', type: 'multiplyVec3', position: { x: 800, y: 180 },
        inputs:  { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'pal_3', outputKey: 'color' } },
                   scale: { type: 'float', label: 'Scale' } },
        outputs: { result: { type: 'vec3', label: 'Result' } },
        params:  { scale: 0.05 } },
      // prev*0.95 + new*0.05
      { id: 'add_7', type: 'addVec3', position: { x: 1060, y: 280 },
        inputs:  { a: { type: 'vec3', label: 'A', connection: { nodeId: 'mulPrev_5', outputKey: 'result' } },
                   b: { type: 'vec3', label: 'B', connection: { nodeId: 'mulNew_6',  outputKey: 'result' } } },
        outputs: { result: { type: 'vec3', label: 'Result' } },
        params:  {} },
      { id: 'out_8', type: 'output', position: { x: 1300, y: 280 },
        inputs:  { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'add_7', outputKey: 'result' } } },
        outputs: {}, params: {} },
    ],
  },

  // ── Breathing Glow — sineLFO drives circle radius for a pulsing organic effect ─
  breathingGlow: {
    label: 'Breathing Glow',
    counter: 9,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 40,  y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 40,  y: 400 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      // Slow sineLFO: breathes at 0.4 Hz
      { id: 'lfo_2', type: 'sineLFO', position: { x: 280, y: 400 },
        inputs:  { time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } } },
        outputs: { value: { type: 'float', label: 'Value' } },
        params:  { freq: 0.4, phase: 0.0, amplitude: 1.0, offset: 0.0 } },
      // Remap [-1,1] → [0.15, 0.55] for circle radius
      { id: 'remap_3', type: 'remap', position: { x: 520, y: 400 },
        inputs:  { value: { type: 'float', label: 'Value', connection: { nodeId: 'lfo_2', outputKey: 'value' } },
                   inMin: { type: 'float', label: 'In Min' }, inMax: { type: 'float', label: 'In Max' },
                   outMin: { type: 'float', label: 'Out Min' }, outMax: { type: 'float', label: 'Out Max' } },
        outputs: { result: { type: 'float', label: 'Result' } },
        params:  { inMin: -1.0, inMax: 1.0, outMin: 0.15, outMax: 0.55 } },
      // Circle SDF — radius wired from the remapped LFO
      { id: 'circle_4', type: 'circleSDF', position: { x: 280, y: 180 },
        inputs:  { position: { type: 'vec2',  label: 'Position', connection: { nodeId: 'uv_0',    outputKey: 'uv'     } },
                   radius:   { type: 'float', label: 'Radius',   connection: { nodeId: 'remap_3', outputKey: 'result' } },
                   offset:   { type: 'vec2',  label: 'Offset' } },
        outputs: { distance: { type: 'float', label: 'Distance' } },
        params:  { radius: 0.35, posX: 0.0, posY: 0.0 } },
      { id: 'light_5', type: 'makeLight', position: { x: 520, y: 180 },
        inputs:  { distance: { type: 'float', label: 'Distance', connection: { nodeId: 'circle_4', outputKey: 'distance' } },
                   brightness: { type: 'float', label: 'Brightness' } },
        outputs: { glow: { type: 'float', label: 'Glow' } },
        params:  { brightness: 12.0 } },
      { id: 'pal_6', type: 'palettePreset', position: { x: 520, y: 560 },
        inputs:  { t: { type: 'float', label: 'T', connection: { nodeId: 'time_1', outputKey: 'time' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params:  { preset: '0' } },
      { id: 'mul_7', type: 'multiplyVec3', position: { x: 760, y: 280 },
        inputs:  { color: { type: 'vec3',  label: 'Color', connection: { nodeId: 'pal_6',   outputKey: 'color' } },
                   scale: { type: 'float', label: 'Scale', connection: { nodeId: 'light_5', outputKey: 'glow'  } } },
        outputs: { result: { type: 'vec3', label: 'Result' } },
        params:  {} },
      { id: 'tone_8', type: 'toneMap', position: { x: 980, y: 280 },
        inputs:  { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'mul_7', outputKey: 'result' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params:  { mode: 'aces' } },
      { id: 'out_9', type: 'output', position: { x: 1200, y: 280 },
        inputs:  { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'tone_8', outputKey: 'color' } } },
        outputs: {}, params: {} },
    ],
  },

  // ── Warp Dance — triangleLFO animates UV warp amount for flowing noise ────────
  warpDance: {
    label: 'Warp Dance',
    counter: 8,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 40,  y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 40,  y: 400 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      // Slow triangle LFO: 0 → 1 → 0 at 0.2 Hz — controls warp intensity
      { id: 'lfo_2', type: 'triangleLFO', position: { x: 280, y: 400 },
        inputs:  { time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } } },
        outputs: { value: { type: 'float', label: 'Value' } },
        params:  { freq: 0.2, amplitude: 1.0, offset: 0.0 } },
      // Remap [-1,1] → [0, 2.5]: warp amount swells in and out
      { id: 'remap_3', type: 'remap', position: { x: 520, y: 400 },
        inputs:  { value: { type: 'float', label: 'Value', connection: { nodeId: 'lfo_2', outputKey: 'value' } },
                   inMin: { type: 'float', label: 'In Min' }, inMax: { type: 'float', label: 'In Max' },
                   outMin: { type: 'float', label: 'Out Min' }, outMax: { type: 'float', label: 'Out Max' } },
        outputs: { result: { type: 'float', label: 'Result' } },
        params:  { inMin: -1.0, inMax: 1.0, outMin: 0.0, outMax: 2.5 } },
      // Domain warp fed by the LFO amount
      { id: 'warp_4', type: 'domainWarp', position: { x: 280, y: 180 },
        inputs:  { uv:     { type: 'vec2',  label: 'UV',     connection: { nodeId: 'uv_0',    outputKey: 'uv'     } },
                   time:   { type: 'float', label: 'Time',   connection: { nodeId: 'time_1',  outputKey: 'time'   } },
                   amount: { type: 'float', label: 'Amount', connection: { nodeId: 'remap_3', outputKey: 'result' } } },
        outputs: { uv: { type: 'vec2', label: 'Warped UV' } },
        params:  { amount: 1.0, freq: 2.0, time_scale: 0.3 } },
      { id: 'fbm_5', type: 'fbm', position: { x: 560, y: 180 },
        inputs:  { uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'warp_4', outputKey: 'uv'   } },
                   time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } } },
        outputs: { value: { type: 'float', label: 'Value' }, uv: { type: 'vec2', label: 'UV (pass-through)' } },
        params:  { octaves: 5, lacunarity: 2.0, gain: 0.5, scale: 3.0, time_scale: 0.08 } },
      { id: 'pal_6', type: 'palettePreset', position: { x: 800, y: 180 },
        inputs:  { t: { type: 'float', label: 'T', connection: { nodeId: 'fbm_5', outputKey: 'value' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params:  { preset: '3' } },
      { id: 'out_7', type: 'output', position: { x: 1040, y: 200 },
        inputs:  { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'pal_6', outputKey: 'color' } } },
        outputs: {}, params: {} },
    ],
  },

  // ── Square Pulse — squareLFO creates hard on/off brightness pulses on rings ──
  squarePulse: {
    label: 'Square Pulse',
    counter: 8,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 40,  y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 40,  y: 420 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      // Fast square LFO: hard on/off at 2 Hz
      { id: 'lfo_2', type: 'squareLFO', position: { x: 280, y: 420 },
        inputs:  { time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } } },
        outputs: { value: { type: 'float', label: 'Value' } },
        params:  { freq: 2.0, amplitude: 1.0, offset: 0.0 } },
      // Remap square wave [-1,1] → [4, 12] for ring frequency modulation
      { id: 'remap_3', type: 'remap', position: { x: 520, y: 420 },
        inputs:  { value:  { type: 'float', label: 'Value', connection: { nodeId: 'lfo_2', outputKey: 'value' } },
                   inMin:  { type: 'float', label: 'In Min' }, inMax:  { type: 'float', label: 'In Max' },
                   outMin: { type: 'float', label: 'Out Min' }, outMax: { type: 'float', label: 'Out Max' } },
        outputs: { result: { type: 'float', label: 'Result' } },
        params:  { inMin: -1.0, inMax: 1.0, outMin: 4.0, outMax: 12.0 } },
      // Polar space → rings via fract
      { id: 'polar_4', type: 'polarSpace', position: { x: 280, y: 200 },
        inputs:  { uv: { type: 'vec2', label: 'UV', connection: { nodeId: 'uv_0', outputKey: 'uv' } } },
        outputs: { uv: { type: 'vec2', label: 'Polar UV' }, r: { type: 'float', label: 'Radius' }, theta: { type: 'float', label: 'Angle' } },
        params:  {} },
      // Multiply radius by LFO-driven frequency
      { id: 'mul_5', type: 'multiply', position: { x: 520, y: 200 },
        inputs:  { a: { type: 'float', label: 'A', connection: { nodeId: 'polar_4', outputKey: 'r'      } },
                   b: { type: 'float', label: 'B', connection: { nodeId: 'remap_3', outputKey: 'result' } } },
        outputs: { result: { type: 'float', label: 'Result' } },
        params:  {} },
      // fract creates the concentric ring bands
      { id: 'fract_6', type: 'fractRaw', position: { x: 760, y: 200 },
        inputs:  { value: { type: 'float', label: 'Value', connection: { nodeId: 'mul_5', outputKey: 'result' } } },
        outputs: { result: { type: 'float', label: 'Result' } },
        params:  {} },
      { id: 'pal_7', type: 'palettePreset', position: { x: 980, y: 200 },
        inputs:  { t: { type: 'float', label: 'T', connection: { nodeId: 'fract_6', outputKey: 'result' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params:  { preset: '1' } },
      { id: 'out_8', type: 'output', position: { x: 1200, y: 200 },
        inputs:  { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'pal_7', outputKey: 'color' } } },
        outputs: {}, params: {} },
    ],
  },

  // ── Loop: Ripple Warp — UV warped iteratively via LoopRippleStep ─────────────
  // Shows the simplest wired loop: UV in → carry through ripple steps → UV out.
  // The final warped UV drives a palette, giving a layered liquid distortion.
  loopRippleWarp: {
    label: 'Loop: Ripple Warp',
    counter: 6,
    nodes: [
      {
        id: 'uv_0', type: 'uv', position: { x: 40, y: 240 },
        inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {},
      },
      {
        id: 'start_1', type: 'loopStart', position: { x: 220, y: 220 },
        inputs:  { carry: { type: 'vec2', label: 'Initial value', connection: { nodeId: 'uv_0', outputKey: 'uv' } } },
        outputs: { carry: { type: 'vec2', label: 'Carry →' }, iter_index: { type: 'float', label: 'Iter Index' } },
        params:  { iterations: 6, carryType: 'vec2' },
      },
      {
        id: 'ripple_2', type: 'loopRippleStep', position: { x: 430, y: 200 },
        inputs:  { uv: { type: 'vec2', label: 'UV', connection: { nodeId: 'start_1', outputKey: 'carry' } } },
        outputs: { uv: { type: 'vec2', label: 'UV out' } },
        params:  { scale: 3.0, speed: 1.0, strength: 0.12 },
      },
      {
        id: 'end_3', type: 'loopEnd', position: { x: 640, y: 220 },
        inputs:  { carry: { type: 'vec2', label: '← Carry in', connection: { nodeId: 'ripple_2', outputKey: 'uv' } } },
        outputs: { result: { type: 'vec2', label: 'Result' } },
        params:  {},
      },
      // Warped UV → length → palette
      {
        id: 'len_4', type: 'length', position: { x: 820, y: 240 },
        inputs:  { input: { type: 'vec2', label: 'Input', connection: { nodeId: 'end_3', outputKey: 'result' } } },
        outputs: { output: { type: 'float', label: 'Output' } },
        params:  { scale: 1.0 },
      },
      {
        id: 'pal_5', type: 'palettePreset', position: { x: 1000, y: 200 },
        inputs:  { t: { type: 'float', label: 'T', connection: { nodeId: 'len_4', outputKey: 'output' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params:  { preset: '3' },
      },
      {
        id: 'out_6', type: 'output', position: { x: 1200, y: 200 },
        inputs:  { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'pal_5', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Loop: Rotate Spiral — UV rotated + scaled each iteration ─────────────────
  // LoopStart (vec2 UV) → LoopRotateStep (8×) → LoopEnd → length → palette.
  // Produces a tight spiral that unwinds outward. Tweak angle and scale to taste.
  loopRotateSpiral: {
    label: 'Loop: Rotate Spiral',
    counter: 6,
    nodes: [
      {
        id: 'uv_0', type: 'uv', position: { x: 40, y: 240 },
        inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {},
      },
      {
        id: 'start_1', type: 'loopStart', position: { x: 220, y: 220 },
        inputs:  { carry: { type: 'vec2', label: 'Initial value', connection: { nodeId: 'uv_0', outputKey: 'uv' } } },
        outputs: { carry: { type: 'vec2', label: 'Carry →' }, iter_index: { type: 'float', label: 'Iter Index' } },
        params:  { iterations: 8, carryType: 'vec2' },
      },
      {
        id: 'rot_2', type: 'loopRotateStep', position: { x: 430, y: 200 },
        inputs:  { uv: { type: 'vec2', label: 'UV', connection: { nodeId: 'start_1', outputKey: 'carry' } } },
        outputs: { uv: { type: 'vec2', label: 'UV out' } },
        params:  { angle: 0.3, scale: 1.02 },
      },
      {
        id: 'end_3', type: 'loopEnd', position: { x: 640, y: 220 },
        inputs:  { carry: { type: 'vec2', label: '← Carry in', connection: { nodeId: 'rot_2', outputKey: 'uv' } } },
        outputs: { result: { type: 'vec2', label: 'Result' } },
        params:  {},
      },
      {
        id: 'len_4', type: 'length', position: { x: 820, y: 240 },
        inputs:  { input: { type: 'vec2', label: 'Input', connection: { nodeId: 'end_3', outputKey: 'result' } } },
        outputs: { output: { type: 'float', label: 'Output' } },
        params:  { scale: 1.0 },
      },
      {
        id: 'pal_5', type: 'palettePreset', position: { x: 1000, y: 200 },
        inputs:  { t: { type: 'float', label: 'T', connection: { nodeId: 'len_4', outputKey: 'output' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params:  { preset: '1' },
      },
      {
        id: 'out_6', type: 'output', position: { x: 1200, y: 200 },
        inputs:  { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'pal_5', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Loop: Float Accumulate — scalar build-up over iterations ──────────────────
  // Demonstrates float carry: LoopStart (float, no input = starts at 0) →
  // LoopFloatAccumulate (6×) → LoopEnd → palette.
  // The float grows each iteration via sin(carry × scale + time × speed),
  // producing a slowly oscillating scalar that drives palette hue.
  loopFloatDemo: {
    label: 'Loop: Float Accumulate',
    counter: 5,
    nodes: [
      {
        id: 'start_0', type: 'loopStart', position: { x: 80, y: 220 },
        // No carry input — starts at float(0.0)
        inputs:  { carry: { type: 'float', label: 'Initial value' } },
        outputs: { carry: { type: 'float', label: 'Carry →' }, iter_index: { type: 'float', label: 'Iter Index' } },
        params:  { iterations: 6, carryType: 'float' },
      },
      {
        id: 'acc_1', type: 'loopFloatAccumulate', position: { x: 300, y: 200 },
        inputs:  { value: { type: 'float', label: 'Value', connection: { nodeId: 'start_0', outputKey: 'carry' } } },
        outputs: { value: { type: 'float', label: 'Value out' } },
        params:  { scale: 2.0, speed: 1.0, amplitude: 0.15 },
      },
      {
        id: 'end_2', type: 'loopEnd', position: { x: 520, y: 220 },
        inputs:  { carry: { type: 'float', label: '← Carry in', connection: { nodeId: 'acc_1', outputKey: 'value' } } },
        outputs: { result: { type: 'float', label: 'Result' } },
        params:  {},
      },
      {
        id: 'pal_3', type: 'palettePreset', position: { x: 720, y: 200 },
        inputs:  { t: { type: 'float', label: 'T', connection: { nodeId: 'end_2', outputKey: 'result' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params:  { preset: '2' },
      },
      {
        id: 'out_4', type: 'output', position: { x: 940, y: 200 },
        inputs:  { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'pal_3', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Loop: Chained Body — fold then ripple each iteration ─────────────────────
  // Shows that multiple body nodes can be chained inside one loop.
  // Each iteration: DomainFold collapses the space, then RippleStep warps it.
  // The combined effect is much richer than either node alone.
  loopChainedBody: {
    label: 'Loop: Chained Body',
    counter: 7,
    nodes: [
      {
        id: 'uv_0', type: 'uv', position: { x: 40, y: 240 },
        inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {},
      },
      {
        id: 'start_1', type: 'loopStart', position: { x: 220, y: 220 },
        inputs:  { carry: { type: 'vec2', label: 'Initial value', connection: { nodeId: 'uv_0', outputKey: 'uv' } } },
        outputs: { carry: { type: 'vec2', label: 'Carry →' }, iter_index: { type: 'float', label: 'Iter Index' } },
        params:  { iterations: 5, carryType: 'vec2' },
      },
      // Body node 1: fold the domain
      {
        id: 'fold_2', type: 'loopDomainFold', position: { x: 420, y: 180 },
        inputs:  { uv: { type: 'vec2', label: 'UV', connection: { nodeId: 'start_1', outputKey: 'carry' } } },
        outputs: { uv: { type: 'vec2', label: 'UV out' } },
        params:  { scale: 1.8, offsetX: 0.5, offsetY: 0.3 },
      },
      // Body node 2: ripple the folded UV
      {
        id: 'ripple_3', type: 'loopRippleStep', position: { x: 620, y: 200 },
        inputs:  { uv: { type: 'vec2', label: 'UV', connection: { nodeId: 'fold_2', outputKey: 'uv' } } },
        outputs: { uv: { type: 'vec2', label: 'UV out' } },
        params:  { scale: 2.5, speed: 0.8, strength: 0.08 },
      },
      {
        id: 'end_4', type: 'loopEnd', position: { x: 830, y: 220 },
        inputs:  { carry: { type: 'vec2', label: '← Carry in', connection: { nodeId: 'ripple_3', outputKey: 'uv' } } },
        outputs: { result: { type: 'vec2', label: 'Result' } },
        params:  {},
      },
      {
        id: 'len_5', type: 'length', position: { x: 1010, y: 240 },
        inputs:  { input: { type: 'vec2', label: 'Input', connection: { nodeId: 'end_4', outputKey: 'result' } } },
        outputs: { output: { type: 'float', label: 'Output' } },
        params:  { scale: 1.0 },
      },
      {
        id: 'pal_6', type: 'palettePreset', position: { x: 1190, y: 200 },
        inputs:  { t: { type: 'float', label: 'T', connection: { nodeId: 'len_5', outputKey: 'output' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params:  { preset: '4' },
      },
      {
        id: 'out_7', type: 'output', position: { x: 1390, y: 200 },
        inputs:  { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'pal_6', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Fractal Rings (New Loop) — color accumulation via LoopStart/End ──────────
  // Uses LoopColorRingStep with a vec3 carry so color accumulates across iterations.
  // Each iteration folds g_uv by (iter_index + 1) × scale, computes a ring glow,
  // and adds palette color shifted by iter_index — true fractal rings via the
  // wired pair system.  iter_index is auto-injected by the assembler, no wiring needed.
  fractalRingsNewWired: {
    label: 'Fractal Rings (New Loop)',
    counter: 4,
    nodes: [
      {
        id: 'start_0', type: 'loopStart', position: { x: 80, y: 220 },
        inputs: { carry: { type: 'vec3', label: 'Initial value' } },
        outputs: { carry: { type: 'vec3', label: 'Carry →' }, iter_index: { type: 'float', label: 'Iter Index' } },
        params: { iterations: 8, carryType: 'vec3' },
      },
      {
        id: 'step_1', type: 'loopColorRingStep', position: { x: 320, y: 200 },
        inputs:  { color: { type: 'vec3', label: 'Color in', connection: { nodeId: 'start_0', outputKey: 'carry' } } },
        outputs: { color: { type: 'vec3', label: 'Color out' } },
        params: { scale: 1.5, freq: 8.0, glow: 0.01, timeScale: 0.4, phaseStep: 0.4 },
      },
      {
        id: 'end_2', type: 'loopEnd', position: { x: 560, y: 220 },
        inputs:  { carry: { type: 'vec3', label: '← Carry in', connection: { nodeId: 'step_1', outputKey: 'color' } } },
        outputs: { result: { type: 'vec3', label: 'Result' } },
        params: {},
      },
      {
        id: 'out_3', type: 'output', position: { x: 780, y: 220 },
        inputs:  { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'end_2', outputKey: 'result' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Loop: Zoom Tunnel — pure domain-fold zoom, no warp ───────────────────────
  // Each iteration applies fract(uv * 1.8 + offset) - 0.5, doubling spatial
  // frequency.  8 iterations produce a fractal zoom/tunnel without any ripple or
  // rotation.  The slight asymmetric offset (0.3, 0.1) breaks the grid symmetry.
  loopZoomTunnel: {
    label: 'Loop: Zoom Tunnel',
    counter: 7,
    nodes: [
      { id: 'uv_0', type: 'uv', position: { x: 40, y: 240 },
        inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'start_1', type: 'loopStart', position: { x: 220, y: 220 },
        inputs:  { carry: { type: 'vec2', label: 'Initial value', connection: { nodeId: 'uv_0', outputKey: 'uv' } } },
        outputs: { carry: { type: 'vec2', label: 'Carry →' }, iter_index: { type: 'float', label: 'Iter Index' } },
        params:  { iterations: 8, carryType: 'vec2' } },
      { id: 'fold_2', type: 'loopDomainFold', position: { x: 430, y: 200 },
        inputs:  { uv: { type: 'vec2', label: 'UV', connection: { nodeId: 'start_1', outputKey: 'carry' } } },
        outputs: { uv: { type: 'vec2', label: 'UV out' } },
        params:  { scale: 1.8, offsetX: 0.3, offsetY: 0.1 } },
      { id: 'end_3', type: 'loopEnd', position: { x: 640, y: 220 },
        inputs:  { carry: { type: 'vec2', label: '← Carry in', connection: { nodeId: 'fold_2', outputKey: 'uv' } } },
        outputs: { result: { type: 'vec2', label: 'Result' } }, params: {} },
      { id: 'len_4', type: 'length', position: { x: 830, y: 240 },
        inputs:  { input: { type: 'vec2', label: 'Input', connection: { nodeId: 'end_3', outputKey: 'result' } } },
        outputs: { output: { type: 'float', label: 'Output' } }, params: { scale: 1.0 } },
      { id: 'pal_5', type: 'palettePreset', position: { x: 1020, y: 200 },
        inputs:  { t: { type: 'float', label: 'T', connection: { nodeId: 'len_4', outputKey: 'output' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } }, params: { preset: '2' } },
      { id: 'out_6', type: 'output', position: { x: 1220, y: 200 },
        inputs:  { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'pal_5', outputKey: 'color' } } },
        outputs: {}, params: {} },
    ],
  },

  // ── Loop: Animated Spin — Time wired to RotateStep angle ──────────────────────
  // Demonstrates wiring an external value (Time) into a loop body's param socket.
  // Each iteration rotates UV by the current time value, stacking rotations that
  // evolve continuously — the pattern spins and morphs over time.
  loopAnimatedSpin: {
    label: 'Loop: Animated Spin',
    counter: 8,
    nodes: [
      { id: 'uv_0', type: 'uv', position: { x: 40, y: 200 },
        inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 40, y: 400 },
        inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      { id: 'start_2', type: 'loopStart', position: { x: 240, y: 220 },
        inputs:  { carry: { type: 'vec2', label: 'Initial value', connection: { nodeId: 'uv_0', outputKey: 'uv' } } },
        outputs: { carry: { type: 'vec2', label: 'Carry →' }, iter_index: { type: 'float', label: 'Iter Index' } },
        params:  { iterations: 6, carryType: 'vec2' } },
      { id: 'rot_3', type: 'loopRotateStep', position: { x: 460, y: 200 },
        inputs:  {
          uv:    { type: 'vec2',  label: 'UV',    connection: { nodeId: 'start_2', outputKey: 'carry' } },
          angle: { type: 'float', label: 'Angle', connection: { nodeId: 'time_1',  outputKey: 'time'  } },
        },
        outputs: { uv: { type: 'vec2', label: 'UV out' } },
        params:  { angle: 0.3, scale: 0.98 } },
      { id: 'end_4', type: 'loopEnd', position: { x: 680, y: 220 },
        inputs:  { carry: { type: 'vec2', label: '← Carry in', connection: { nodeId: 'rot_3', outputKey: 'uv' } } },
        outputs: { result: { type: 'vec2', label: 'Result' } }, params: {} },
      { id: 'len_5', type: 'length', position: { x: 870, y: 240 },
        inputs:  { input: { type: 'vec2', label: 'Input', connection: { nodeId: 'end_4', outputKey: 'result' } } },
        outputs: { output: { type: 'float', label: 'Output' } }, params: { scale: 1.0 } },
      { id: 'pal_6', type: 'palettePreset', position: { x: 1060, y: 200 },
        inputs:  { t: { type: 'float', label: 'T', connection: { nodeId: 'len_5', outputKey: 'output' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } }, params: { preset: '3' } },
      { id: 'out_7', type: 'output', position: { x: 1260, y: 200 },
        inputs:  { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'pal_6', outputKey: 'color' } } },
        outputs: {}, params: {} },
    ],
  },

  // ── Loop: Two-Stage — RotateStep loop feeds UV into ColorRingStep loop ─────────
  // Shows two chained loops where the first loop's output (warped UV) is fed as the
  // UV source into the second loop's body.  Loop 1: vec2 carry, rotates UV 4×.
  // Loop 2: vec3 carry, renders color rings on the warped UV 6×.
  // The topo-sort correctly orders Loop1End before Loop2 processes its body.
  loopTwoStage: {
    label: 'Loop: Two-Stage',
    counter: 8,
    nodes: [
      { id: 'uv_0', type: 'uv', position: { x: 40, y: 220 },
        inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      // ── Loop 1: rotate UV ──────────────────────────────────────────────────
      { id: 'start1_1', type: 'loopStart', position: { x: 220, y: 200 },
        inputs:  { carry: { type: 'vec2', label: 'Initial value', connection: { nodeId: 'uv_0', outputKey: 'uv' } } },
        outputs: { carry: { type: 'vec2', label: 'Carry →' }, iter_index: { type: 'float', label: 'Iter Index' } },
        params:  { iterations: 4, carryType: 'vec2' } },
      { id: 'rot_2', type: 'loopRotateStep', position: { x: 420, y: 180 },
        inputs:  { uv: { type: 'vec2', label: 'UV', connection: { nodeId: 'start1_1', outputKey: 'carry' } } },
        outputs: { uv: { type: 'vec2', label: 'UV out' } },
        params:  { angle: 0.4, scale: 0.97 } },
      { id: 'end1_3', type: 'loopEnd', position: { x: 620, y: 200 },
        inputs:  { carry: { type: 'vec2', label: '← Carry in', connection: { nodeId: 'rot_2', outputKey: 'uv' } } },
        outputs: { result: { type: 'vec2', label: 'Result' } }, params: {} },
      // ── Loop 2: color rings on warped UV ───────────────────────────────────
      { id: 'start2_4', type: 'loopStart', position: { x: 820, y: 200 },
        inputs:  { carry: { type: 'vec3', label: 'Initial value' } },
        outputs: { carry: { type: 'vec3', label: 'Carry →' }, iter_index: { type: 'float', label: 'Iter Index' } },
        params:  { iterations: 6, carryType: 'vec3' } },
      { id: 'ring_5', type: 'loopColorRingStep', position: { x: 1040, y: 180 },
        inputs:  {
          color: { type: 'vec3', label: 'Color in', connection: { nodeId: 'start2_4', outputKey: 'carry' } },
          uv:    { type: 'vec2', label: 'UV',       connection: { nodeId: 'end1_3',   outputKey: 'result' } },
        },
        outputs: { color: { type: 'vec3', label: 'Color out' } },
        params:  { scale: 1.6, freq: 8.0, glow: 0.006, timeScale: 0.3, phaseStep: 0.5 } },
      { id: 'end2_6', type: 'loopEnd', position: { x: 1280, y: 200 },
        inputs:  { carry: { type: 'vec3', label: '← Carry in', connection: { nodeId: 'ring_5', outputKey: 'color' } } },
        outputs: { result: { type: 'vec3', label: 'Result' } }, params: {} },
      { id: 'out_7', type: 'output', position: { x: 1500, y: 200 },
        inputs:  { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'end2_6', outputKey: 'result' } } },
        outputs: {}, params: {} },
    ],
  },

  // ── Loop: Spatial Float — UV length seeds the float carry ──────────────────────
  // UV distance (length of UV vector) becomes the initial carry value, so every
  // pixel starts its accumulation from a different place.  The FloatAccumulate
  // compounds sin oscillations from that seed, producing concentric patterns that
  // morph over time.  Visually distinct from the uniform float demo.
  loopSpatialFloat: {
    label: 'Loop: Spatial Float',
    counter: 7,
    nodes: [
      { id: 'uv_0', type: 'uv', position: { x: 40, y: 220 },
        inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'len_1', type: 'length', position: { x: 220, y: 220 },
        inputs:  { input: { type: 'vec2', label: 'Input', connection: { nodeId: 'uv_0', outputKey: 'uv' } } },
        outputs: { output: { type: 'float', label: 'Output' } }, params: { scale: 1.0 } },
      { id: 'start_2', type: 'loopStart', position: { x: 420, y: 200 },
        inputs:  { carry: { type: 'float', label: 'Initial value', connection: { nodeId: 'len_1', outputKey: 'output' } } },
        outputs: { carry: { type: 'float', label: 'Carry →' }, iter_index: { type: 'float', label: 'Iter Index' } },
        params:  { iterations: 6, carryType: 'float' } },
      { id: 'acc_3', type: 'loopFloatAccumulate', position: { x: 630, y: 180 },
        inputs:  { value: { type: 'float', label: 'Value', connection: { nodeId: 'start_2', outputKey: 'carry' } } },
        outputs: { value: { type: 'float', label: 'Value out' } },
        params:  { scale: 2.5, speed: 0.6, amplitude: 0.12 } },
      { id: 'end_4', type: 'loopEnd', position: { x: 840, y: 200 },
        inputs:  { carry: { type: 'float', label: '← Carry in', connection: { nodeId: 'acc_3', outputKey: 'value' } } },
        outputs: { result: { type: 'float', label: 'Result' } }, params: {} },
      { id: 'pal_5', type: 'palettePreset', position: { x: 1040, y: 200 },
        inputs:  { t: { type: 'float', label: 'T', connection: { nodeId: 'end_4', outputKey: 'result' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } }, params: { preset: '1' } },
      { id: 'out_6', type: 'output', position: { x: 1240, y: 200 },
        inputs:  { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'pal_5', outputKey: 'color' } } },
        outputs: {}, params: {} },
    ],
  },

  // ── Loop: Dense Rings — 14 iterations of ColorRingStep, tight spacing ──────────
  // More iterations with higher frequency and tighter glow than fractalRingsNewWired.
  // The higher phaseStep shifts palette hue rapidly across iterations producing
  // a dense rainbow ring cloud.
  loopDenseRings: {
    label: 'Loop: Dense Rings',
    counter: 4,
    nodes: [
      { id: 'start_0', type: 'loopStart', position: { x: 80, y: 220 },
        inputs:  { carry: { type: 'vec3', label: 'Initial value' } },
        outputs: { carry: { type: 'vec3', label: 'Carry →' }, iter_index: { type: 'float', label: 'Iter Index' } },
        params:  { iterations: 14, carryType: 'vec3' } },
      { id: 'step_1', type: 'loopColorRingStep', position: { x: 310, y: 200 },
        inputs:  { color: { type: 'vec3', label: 'Color in', connection: { nodeId: 'start_0', outputKey: 'carry' } } },
        outputs: { color: { type: 'vec3', label: 'Color out' } },
        params:  { scale: 2.0, freq: 14.0, glow: 0.003, timeScale: 0.15, phaseStep: 0.9 } },
      { id: 'end_2', type: 'loopEnd', position: { x: 560, y: 220 },
        inputs:  { carry: { type: 'vec3', label: '← Carry in', connection: { nodeId: 'step_1', outputKey: 'color' } } },
        outputs: { result: { type: 'vec3', label: 'Result' } }, params: {} },
      { id: 'out_3', type: 'output', position: { x: 780, y: 220 },
        inputs:  { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'end_2', outputKey: 'result' } } },
        outputs: {}, params: {} },
    ],
  },

  // ── Loop: Iter-Driven Scale — iter_index wired to DomainFold scale ─────────────
  // Each iteration of the fold uses a DIFFERENT scale: iter_index + 1.2 (via an
  // Add node), so early iterations fold loosely and later ones fold tightly.
  // This creates a layered structure that differs fundamentally from a fixed scale.
  loopIterScale: {
    label: 'Loop: Iter-Driven Scale',
    counter: 8,
    nodes: [
      { id: 'uv_0', type: 'uv', position: { x: 40, y: 220 },
        inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'start_1', type: 'loopStart', position: { x: 220, y: 200 },
        inputs:  { carry: { type: 'vec2', label: 'Initial value', connection: { nodeId: 'uv_0', outputKey: 'uv' } } },
        outputs: { carry: { type: 'vec2', label: 'Carry →' }, iter_index: { type: 'float', label: 'Iter Index' } },
        params:  { iterations: 7, carryType: 'vec2' } },
      // Add 1.2 to iter_index so scale goes 1.2, 2.2, 3.2 … each iteration
      { id: 'add_2', type: 'add', position: { x: 420, y: 340 },
        inputs:  { a: { type: 'float', label: 'A', connection: { nodeId: 'start_1', outputKey: 'iter_index' } } },
        outputs: { result: { type: 'float', label: 'Result' } },
        params:  { b: 1.2 } },
      { id: 'fold_3', type: 'loopDomainFold', position: { x: 440, y: 180 },
        inputs:  {
          uv:    { type: 'vec2',  label: 'UV',    connection: { nodeId: 'start_1', outputKey: 'carry'  } },
          scale: { type: 'float', label: 'Scale', connection: { nodeId: 'add_2',   outputKey: 'result' } },
        },
        outputs: { uv: { type: 'vec2', label: 'UV out' } },
        params:  { scale: 1.8, offsetX: 0.2, offsetY: 0.15 } },
      { id: 'end_4', type: 'loopEnd', position: { x: 660, y: 200 },
        inputs:  { carry: { type: 'vec2', label: '← Carry in', connection: { nodeId: 'fold_3', outputKey: 'uv' } } },
        outputs: { result: { type: 'vec2', label: 'Result' } }, params: {} },
      { id: 'len_5', type: 'length', position: { x: 850, y: 240 },
        inputs:  { input: { type: 'vec2', label: 'Input', connection: { nodeId: 'end_4', outputKey: 'result' } } },
        outputs: { output: { type: 'float', label: 'Output' } }, params: { scale: 1.0 } },
      { id: 'pal_6', type: 'palettePreset', position: { x: 1040, y: 200 },
        inputs:  { t: { type: 'float', label: 'T', connection: { nodeId: 'len_5', outputKey: 'output' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } }, params: { preset: '4' } },
      { id: 'out_7', type: 'output', position: { x: 1240, y: 200 },
        inputs:  { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'pal_6', outputKey: 'color' } } },
        outputs: {}, params: {} },
    ],
  },


  // ── Group Carry: Classic IQ Rings — exact recreation of the reference fractal ─────
  // UV carry via carryMode on FractNode (uv = fract(uv * 1.5) - 0.5 each iter)
  // Color accumulates via assignOp += on ScaleColor (finalColor += col * d)
  // Reference: https://www.shadertoy.com/view/mtyGWy
  groupCarryRings: {
    label: 'Group: Fractal Rings (Carry)',
    counter: 3,
    nodes: [
      {
        id: 'uv_0', type: 'uv', position: { x: 40, y: 260 },
        inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {},
      },
      {
        id: 'group_1', type: 'group', position: { x: 240, y: 160 },
        inputs: {
          in_uv:  { type: 'vec2', label: 'UV',  connection: { nodeId: 'uv_0', outputKey: 'uv' } },
          in_uv0: { type: 'vec2', label: 'UV0', connection: { nodeId: 'uv_0', outputKey: 'uv' } },
        },
        outputs: { out_color: { type: 'vec3', label: 'Color' } },
        params: {
          label: 'Ring Iteration',
          iterations: 4,
          subgraph: {
            nodes: [
              // Fract Tile: fract(uv * 1.5) - 0.5
              // carryMode=true → output feeds back as its own input each iteration
              // Group input in_uv initialises the carry on the first iteration
              {
                id: 'fract_n', type: 'fract', position: { x: 120, y: 160 },
                inputs:  { input: { type: 'vec2', label: 'Input' } },
                outputs: { output: { type: 'vec2', label: 'Output' } },
                params:  { scale: 1.5 },
                carryMode: true,
              },
              // Length of carried UV (mutates each iter)
              {
                id: 'len_c', type: 'length', position: { x: 320, y: 200 },
                inputs:  { input: { type: 'vec2', label: 'Input', connection: { nodeId: 'fract_n', outputKey: 'output' } } },
                outputs: { output: { type: 'float', label: 'Output' } },
                params:  { scale: 1.0 },
              },
              // Length of original UV0 (fixed — received via in_uv0 port each iter)
              {
                id: 'len_o', type: 'length', position: { x: 120, y: 340 },
                inputs:  { input: { type: 'vec2', label: 'Input' } },
                outputs: { output: { type: 'float', label: 'Output' } },
                params:  { scale: 1.0 },
              },
              // exp(-length(uv0)) — radial falloff from center
              {
                id: 'exp_n', type: 'exp', position: { x: 320, y: 360 },
                inputs:  { input: { type: 'float', label: 'Input', connection: { nodeId: 'len_o', outputKey: 'output' } } },
                outputs: { output: { type: 'float', label: 'Output' } },
                params:  { scale: -1.0 },
              },
              // d = length(carry_uv) * exp(-length(uv0))
              {
                id: 'd_val', type: 'multiply', position: { x: 520, y: 280 },
                inputs:  {
                  a: { type: 'float', label: 'A', connection: { nodeId: 'len_c', outputKey: 'output' } },
                  b: { type: 'float', label: 'B', connection: { nodeId: 'exp_n', outputKey: 'output' } },
                },
                outputs: { result: { type: 'float', label: 'Result' } },
                params:  {},
              },
              // Loop iteration index
              { id: 'loop_i', type: 'loopIndex', position: { x: 120, y: 460 },
                inputs: {}, outputs: { i: { type: 'float', label: 'i' } }, params: {} },
              // Time
              { id: 'time_n', type: 'time', position: { x: 120, y: 540 },
                inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
              // i * 0.4
              {
                id: 'i_04', type: 'multiply', position: { x: 320, y: 460 },
                inputs:  { a: { type: 'float', label: 'A', connection: { nodeId: 'loop_i', outputKey: 'i' } } },
                outputs: { result: { type: 'float', label: 'Result' } },
                params:  { b: 0.4 },
              },
              // t * 0.4
              {
                id: 't_04', type: 'multiply', position: { x: 320, y: 540 },
                inputs:  { a: { type: 'float', label: 'A', connection: { nodeId: 'time_n', outputKey: 'time' } } },
                outputs: { result: { type: 'float', label: 'Result' } },
                params:  { b: 0.4 },
              },
              // i*0.4 + t*0.4
              {
                id: 'it_add', type: 'add', position: { x: 520, y: 500 },
                inputs:  {
                  a: { type: 'float', label: 'A', connection: { nodeId: 'i_04', outputKey: 'result' } },
                  b: { type: 'float', label: 'B', connection: { nodeId: 't_04', outputKey: 'result' } },
                },
                outputs: { result: { type: 'float', label: 'Result' } },
                params:  {},
              },
              // length(uv0) + i*0.4 + t*0.4  → palette driver
              {
                id: 'pal_t', type: 'add', position: { x: 720, y: 440 },
                inputs:  {
                  a: { type: 'float', label: 'A', connection: { nodeId: 'len_o', outputKey: 'output' } },
                  b: { type: 'float', label: 'B', connection: { nodeId: 'it_add', outputKey: 'result' } },
                },
                outputs: { result: { type: 'float', label: 'Result' } },
                params:  {},
              },
              // Cosine palette
              {
                id: 'palette', type: 'palettePreset', position: { x: 920, y: 400 },
                inputs:  { t: { type: 'float', label: 'T', connection: { nodeId: 'pal_t', outputKey: 'result' } } },
                outputs: { color: { type: 'vec3', label: 'Color' } },
                params:  { preset: '2' },
              },
              // Glow: pow(0.01 / abs(sin(d*8+t)/8), 1.2)
              {
                id: 'glow', type: 'expr', position: { x: 720, y: 280 },
                inputs:  {
                  in0: { type: 'float', label: 'd',    connection: { nodeId: 'd_val', outputKey: 'result' } },
                  in1: { type: 'float', label: 'time', connection: { nodeId: 'time_n', outputKey: 'time' } },
                },
                outputs: { result: { type: 'float', label: 'Result' } },
                params:  {
                  expr: 'pow(0.01 / abs(sin(d * 8.0 + time) / 8.0), 1.2)',
                  outputType: 'float',
                  in0Name: 'd', in1Name: 'time', in2Name: 'in2', in3Name: 'in3',
                },
              },
              // col * d  — assignOp += accumulates color across all 4 iterations
              {
                id: 'col_d', type: 'multiplyVec3', position: { x: 1120, y: 360 },
                inputs:  {
                  color: { type: 'vec3', label: 'Color', connection: { nodeId: 'palette', outputKey: 'color' } },
                  scale: { type: 'float', label: 'Scale', connection: { nodeId: 'glow', outputKey: 'result' } },
                },
                outputs: { result: { type: 'vec3', label: 'Result' } },
                params:  {},
                assignOp: '+=',
              },
            ],
            inputPorts: [
              { key: 'in_uv',  type: 'vec2', label: 'UV',  toNodeId: 'fract_n', toInputKey: 'input'  },
              { key: 'in_uv0', type: 'vec2', label: 'UV0', toNodeId: 'len_o',   toInputKey: 'input'  },
            ],
            outputPorts: [
              { key: 'out_color', type: 'vec3', label: 'Color', fromNodeId: 'col_d', fromOutputKey: 'result' },
            ],
          },
        },
      },
      {
        id: 'out_2', type: 'output', position: { x: 560, y: 220 },
        inputs:  { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'group_1', outputKey: 'out_color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Group Carry: Zoom Rings — simplified carry with tighter fold, no falloff ─────
  // Same UV carry pattern but without the exp(-len) falloff for a different look.
  // Also shows that a single group input is enough when both UV roles are the same.
  groupCarryZoom: {
    label: 'Group: Zoom Rings (Carry)',
    counter: 3,
    nodes: [
      {
        id: 'uv_0', type: 'uv', position: { x: 40, y: 260 },
        inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {},
      },
      {
        id: 'group_1', type: 'group', position: { x: 240, y: 160 },
        inputs: {
          in_uv: { type: 'vec2', label: 'UV', connection: { nodeId: 'uv_0', outputKey: 'uv' } },
        },
        outputs: { out_color: { type: 'vec3', label: 'Color' } },
        params: {
          label: 'Zoom Ring Step',
          iterations: 6,
          subgraph: {
            nodes: [
              // UV carry: fract(uv * 2.0) - 0.5  (tighter fold)
              {
                id: 'fract_n', type: 'fract', position: { x: 120, y: 180 },
                inputs:  { input: { type: 'vec2', label: 'Input' } },
                outputs: { output: { type: 'vec2', label: 'Output' } },
                params:  { scale: 2.0 },
                carryMode: true,
              },
              // d = length(carried UV) — simple, no falloff
              {
                id: 'len_c', type: 'length', position: { x: 320, y: 180 },
                inputs:  { input: { type: 'vec2', label: 'Input', connection: { nodeId: 'fract_n', outputKey: 'output' } } },
                outputs: { output: { type: 'float', label: 'Output' } },
                params:  { scale: 1.0 },
              },
              { id: 'loop_i', type: 'loopIndex', position: { x: 120, y: 340 },
                inputs: {}, outputs: { i: { type: 'float', label: 'i' } }, params: {} },
              { id: 'time_n', type: 'time', position: { x: 120, y: 420 },
                inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
              // i * 0.3
              {
                id: 'i_03', type: 'multiply', position: { x: 320, y: 340 },
                inputs:  { a: { type: 'float', label: 'A', connection: { nodeId: 'loop_i', outputKey: 'i' } } },
                outputs: { result: { type: 'float', label: 'Result' } },
                params:  { b: 0.3 },
              },
              // t * 0.5
              {
                id: 't_05', type: 'multiply', position: { x: 320, y: 420 },
                inputs:  { a: { type: 'float', label: 'A', connection: { nodeId: 'time_n', outputKey: 'time' } } },
                outputs: { result: { type: 'float', label: 'Result' } },
                params:  { b: 0.5 },
              },
              // len + i*0.3 + t*0.5
              {
                id: 'it_add', type: 'add', position: { x: 520, y: 360 },
                inputs:  {
                  a: { type: 'float', label: 'A', connection: { nodeId: 'i_03', outputKey: 'result' } },
                  b: { type: 'float', label: 'B', connection: { nodeId: 't_05', outputKey: 'result' } },
                },
                outputs: { result: { type: 'float', label: 'Result' } },
                params:  {},
              },
              {
                id: 'pal_t', type: 'add', position: { x: 720, y: 280 },
                inputs:  {
                  a: { type: 'float', label: 'A', connection: { nodeId: 'len_c', outputKey: 'output' } },
                  b: { type: 'float', label: 'B', connection: { nodeId: 'it_add', outputKey: 'result' } },
                },
                outputs: { result: { type: 'float', label: 'Result' } },
                params:  {},
              },
              {
                id: 'palette', type: 'palettePreset', position: { x: 920, y: 240 },
                inputs:  { t: { type: 'float', label: 'T', connection: { nodeId: 'pal_t', outputKey: 'result' } } },
                outputs: { color: { type: 'vec3', label: 'Color' } },
                params:  { preset: '4' },
              },
              // Glow with different frequency (6 instead of 8)
              {
                id: 'glow', type: 'expr', position: { x: 520, y: 180 },
                inputs:  {
                  in0: { type: 'float', label: 'd',    connection: { nodeId: 'len_c',  outputKey: 'output' } },
                  in1: { type: 'float', label: 'time', connection: { nodeId: 'time_n', outputKey: 'time'   } },
                },
                outputs: { result: { type: 'float', label: 'Result' } },
                params:  {
                  expr: 'pow(0.01 / abs(sin(d * 6.0 + time) / 6.0), 1.0)',
                  outputType: 'float',
                  in0Name: 'd', in1Name: 'time', in2Name: 'in2', in3Name: 'in3',
                },
              },
              {
                id: 'col_d', type: 'multiplyVec3', position: { x: 1120, y: 220 },
                inputs:  {
                  color: { type: 'vec3', label: 'Color', connection: { nodeId: 'palette', outputKey: 'color' } },
                  scale: { type: 'float', label: 'Scale', connection: { nodeId: 'glow',    outputKey: 'result' } },
                },
                outputs: { result: { type: 'vec3', label: 'Result' } },
                params:  {},
                assignOp: '+=',
              },
            ],
            inputPorts: [
              { key: 'in_uv', type: 'vec2', label: 'UV', toNodeId: 'fract_n', toInputKey: 'input' },
            ],
            outputPorts: [
              { key: 'out_color', type: 'vec3', label: 'Color', fromNodeId: 'col_d', fromOutputKey: 'result' },
            ],
          },
        },
      },
      {
        id: 'out_2', type: 'output', position: { x: 560, y: 220 },
        inputs:  { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'group_1', outputKey: 'out_color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Group Carry: Rotate + Fold — UV carry with rotation each iteration ─────────
  // Rotate2D is the carry node: each iter rotates UV, then Fract folds it.
  // The rotation + fold combo creates spiral, kaleidoscopic fractal rings.
  groupCarryRotate: {
    label: 'Group: Rotate + Fold (Carry)',
    counter: 3,
    nodes: [
      {
        id: 'uv_0', type: 'uv', position: { x: 40, y: 260 },
        inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {},
      },
      {
        id: 'group_1', type: 'group', position: { x: 240, y: 160 },
        inputs: {
          in_uv:  { type: 'vec2', label: 'UV',  connection: { nodeId: 'uv_0', outputKey: 'uv' } },
          in_uv0: { type: 'vec2', label: 'UV0', connection: { nodeId: 'uv_0', outputKey: 'uv' } },
        },
        outputs: { out_color: { type: 'vec3', label: 'Color' } },
        params: {
          label: 'Rotate + Fold',
          iterations: 5,
          subgraph: {
            nodes: [
              // Rotate UV each iteration (carry: output feeds back as input)
              {
                id: 'rot_n', type: 'rotate2d', position: { x: 120, y: 160 },
                inputs:  { uv: { type: 'vec2', label: 'UV' } },
                outputs: { uv: { type: 'vec2', label: 'UV' } },
                params:  { angle: 0.5 },
                carryMode: true,
              },
              // Fold after rotation
              {
                id: 'fract_n', type: 'fract', position: { x: 320, y: 160 },
                inputs:  { input: { type: 'vec2', label: 'Input', connection: { nodeId: 'rot_n', outputKey: 'uv' } } },
                outputs: { output: { type: 'vec2', label: 'Output' } },
                params:  { scale: 1.8 },
              },
              // Length of folded UV → d
              {
                id: 'len_c', type: 'length', position: { x: 520, y: 200 },
                inputs:  { input: { type: 'vec2', label: 'Input', connection: { nodeId: 'fract_n', outputKey: 'output' } } },
                outputs: { output: { type: 'float', label: 'Output' } },
                params:  { scale: 1.0 },
              },
              // Length of original UV (center falloff weight)
              {
                id: 'len_o', type: 'length', position: { x: 120, y: 320 },
                inputs:  { input: { type: 'vec2', label: 'Input' } },
                outputs: { output: { type: 'float', label: 'Output' } },
                params:  { scale: 1.0 },
              },
              // Falloff: exp(-len_o)
              {
                id: 'falloff', type: 'exp', position: { x: 320, y: 340 },
                inputs:  { input: { type: 'float', label: 'Input', connection: { nodeId: 'len_o', outputKey: 'output' } } },
                outputs: { output: { type: 'float', label: 'Output' } },
                params:  { scale: -1.2 },
              },
              // d = len_c * falloff
              {
                id: 'd_val', type: 'multiply', position: { x: 720, y: 260 },
                inputs:  {
                  a: { type: 'float', label: 'A', connection: { nodeId: 'len_c',   outputKey: 'output' } },
                  b: { type: 'float', label: 'B', connection: { nodeId: 'falloff', outputKey: 'output' } },
                },
                outputs: { result: { type: 'float', label: 'Result' } },
                params:  {},
              },
              { id: 'loop_i', type: 'loopIndex', position: { x: 120, y: 460 },
                inputs: {}, outputs: { i: { type: 'float', label: 'i' } }, params: {} },
              { id: 'time_n', type: 'time', position: { x: 120, y: 540 },
                inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
              {
                id: 'i_03', type: 'multiply', position: { x: 320, y: 460 },
                inputs:  { a: { type: 'float', label: 'A', connection: { nodeId: 'loop_i', outputKey: 'i' } } },
                outputs: { result: { type: 'float', label: 'Result' } },
                params:  { b: 0.35 },
              },
              {
                id: 't_04', type: 'multiply', position: { x: 320, y: 540 },
                inputs:  { a: { type: 'float', label: 'A', connection: { nodeId: 'time_n', outputKey: 'time' } } },
                outputs: { result: { type: 'float', label: 'Result' } },
                params:  { b: 0.4 },
              },
              {
                id: 'it_add', type: 'add', position: { x: 520, y: 500 },
                inputs:  {
                  a: { type: 'float', label: 'A', connection: { nodeId: 'i_03', outputKey: 'result' } },
                  b: { type: 'float', label: 'B', connection: { nodeId: 't_04', outputKey: 'result' } },
                },
                outputs: { result: { type: 'float', label: 'Result' } },
                params:  {},
              },
              {
                id: 'pal_t', type: 'add', position: { x: 720, y: 440 },
                inputs:  {
                  a: { type: 'float', label: 'A', connection: { nodeId: 'len_o',  outputKey: 'output' } },
                  b: { type: 'float', label: 'B', connection: { nodeId: 'it_add', outputKey: 'result' } },
                },
                outputs: { result: { type: 'float', label: 'Result' } },
                params:  {},
              },
              {
                id: 'palette', type: 'palettePreset', position: { x: 920, y: 400 },
                inputs:  { t: { type: 'float', label: 'T', connection: { nodeId: 'pal_t', outputKey: 'result' } } },
                outputs: { color: { type: 'vec3', label: 'Color' } },
                params:  { preset: '3' },
              },
              // Glow with tighter frequency for spiral feel
              {
                id: 'glow', type: 'expr', position: { x: 920, y: 260 },
                inputs:  {
                  in0: { type: 'float', label: 'd',    connection: { nodeId: 'd_val',  outputKey: 'result' } },
                  in1: { type: 'float', label: 'time', connection: { nodeId: 'time_n', outputKey: 'time'   } },
                },
                outputs: { result: { type: 'float', label: 'Result' } },
                params:  {
                  expr: 'pow(0.008 / abs(sin(d * 10.0 + time) / 10.0), 1.3)',
                  outputType: 'float',
                  in0Name: 'd', in1Name: 'time', in2Name: 'in2', in3Name: 'in3',
                },
              },
              // Accumulate: col * glow added each iteration
              {
                id: 'col_d', type: 'multiplyVec3', position: { x: 1120, y: 340 },
                inputs:  {
                  color: { type: 'vec3', label: 'Color', connection: { nodeId: 'palette', outputKey: 'color'  } },
                  scale: { type: 'float', label: 'Scale', connection: { nodeId: 'glow',    outputKey: 'result' } },
                },
                outputs: { result: { type: 'vec3', label: 'Result' } },
                params:  {},
                assignOp: '+=',
              },
            ],
            inputPorts: [
              { key: 'in_uv',  type: 'vec2', label: 'UV',  toNodeId: 'rot_n', toInputKey: 'uv'    },
              { key: 'in_uv0', type: 'vec2', label: 'UV0', toNodeId: 'len_o', toInputKey: 'input' },
            ],
            outputPorts: [
              { key: 'out_color', type: 'vec3', label: 'Color', fromNodeId: 'col_d', fromOutputKey: 'result' },
            ],
          },
        },
      },
      {
        id: 'out_2', type: 'output', position: { x: 560, y: 220 },
        inputs:  { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'group_1', outputKey: 'out_color' } } },
        outputs: {}, params: {},
      },
    ],
  },


  // ── Group Carry: FBM Octaves — classic fractal Brownian motion via carry ──────
  // frequency carry: each iter the UV is scaled *2 (doubles resolution).
  // noise value accumulates via assignOp += (with decaying amplitude).
  // Result: hand-rolled FBM entirely within the node graph.
  groupCarryFBM: {
    label: 'Group: FBM Octaves (Carry)',
    counter: 3,
    nodes: [
      {
        id: 'uv_0', type: 'uv', position: { x: 40, y: 260 },
        inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {},
      },
      {
        id: 'time_0', type: 'time', position: { x: 40, y: 340 },
        inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {},
      },
      {
        id: 'group_1', type: 'group', position: { x: 260, y: 160 },
        inputs: {
          in_uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          in_time: { type: 'float', label: 'Time', connection: { nodeId: 'time_0', outputKey: 'time' } },
        },
        outputs: { out_value: { type: 'float', label: 'Value' } },
        params: {
          label: 'FBM Octave',
          iterations: 5,
          subgraph: {
            nodes: [
              // Carry: UV is scaled ×2 each iteration (doubles noise frequency)
              {
                id: 'uv_scale', type: 'multiplyVec2', position: { x: 120, y: 180 },
                inputs:  { v: { type: 'vec2', label: 'Vec2' } },
                outputs: { result: { type: 'vec2', label: 'Result' } },
                params:  { scale: 2.0 },
                carryMode: true,
              },
              // Animated time shift: time * 0.15
              {
                id: 't_shift', type: 'multiply', position: { x: 120, y: 300 },
                inputs:  { a: { type: 'float', label: 'A' } },
                outputs: { result: { type: 'float', label: 'Result' } },
                params:  { b: 0.15 },
              },
              // FBM single-octave: sample at current UV frequency
              {
                id: 'fbm_n', type: 'fbm', position: { x: 320, y: 180 },
                inputs:  {
                  uv:         { type: 'vec2',  label: 'UV',         connection: { nodeId: 'uv_scale', outputKey: 'result' } },
                  time:       { type: 'float', label: 'Time',       connection: { nodeId: 't_shift',  outputKey: 'result' } },
                  scale:      { type: 'float', label: 'Scale'      },
                  time_scale: { type: 'float', label: 'Time Scale' },
                },
                outputs: { value: { type: 'float', label: 'Value' }, uv: { type: 'vec2', label: 'UV (pass-through)' } },
                params:  { octaves: 1, lacunarity: 2.0, gain: 0.5, scale: 1.0, time_scale: 0.0 },
              },
              // Loop index for decaying amplitude: amp = 0.5^i
              {
                id: 'loop_i', type: 'loopIndex', position: { x: 120, y: 420 },
                inputs: {}, outputs: { i: { type: 'float', label: 'i' } }, params: {},
              },
              // amp = pow(0.5, i) — halve amplitude each octave
              {
                id: 'amp', type: 'expr', position: { x: 320, y: 380 },
                inputs:  { in0: { type: 'float', label: 'i', connection: { nodeId: 'loop_i', outputKey: 'i' } } },
                outputs: { result: { type: 'float', label: 'Result' } },
                params:  {
                  expr: 'pow(0.5, i)',
                  outputType: 'float',
                  in0Name: 'i', in1Name: 'in1', in2Name: 'in2', in3Name: 'in3',
                },
              },
              // Weighted octave contribution: noise * amplitude — accumulated via +=
              {
                id: 'weighted', type: 'multiply', position: { x: 520, y: 280 },
                inputs:  {
                  a: { type: 'float', label: 'A', connection: { nodeId: 'fbm_n',  outputKey: 'value'  } },
                  b: { type: 'float', label: 'B', connection: { nodeId: 'amp',    outputKey: 'result' } },
                },
                outputs: { result: { type: 'float', label: 'Result' } },
                params:  {},
                assignOp: '+=',
              },
            ],
            inputPorts: [
              { key: 'in_uv',   type: 'vec2',  label: 'UV',   toNodeId: 'uv_scale', toInputKey: 'v'   },
              { key: 'in_time', type: 'float', label: 'Time', toNodeId: 't_shift',  toInputKey: 'a'   },
            ],
            outputPorts: [
              { key: 'out_value', type: 'float', label: 'Value', fromNodeId: 'weighted', fromOutputKey: 'result' },
            ],
          },
        },
      },
      // Map accumulated FBM value through a palette
      {
        id: 'palette_2', type: 'palettePreset', position: { x: 500, y: 200 },
        inputs:  { t: { type: 'float', label: 'T', connection: { nodeId: 'group_1', outputKey: 'out_value' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params:  { preset: '5' },
      },
      {
        id: 'out_3', type: 'output', position: { x: 720, y: 220 },
        inputs:  { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'palette_2', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Group Carry: Domain Warp — carry UV through successive smooth noise warps ─
  // Each iteration: UV = UV + smoothWarpOffset(UV) — compound distortion stacks up.
  // Color is painted from the final (most-warped) UV via FBM + palette.
  groupCarryDomainWarp: {
    label: 'Group: Domain Warp (Carry)',
    counter: 3,
    nodes: [
      {
        id: 'uv_0', type: 'uv', position: { x: 40, y: 260 },
        inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {},
      },
      {
        id: 'time_0', type: 'time', position: { x: 40, y: 340 },
        inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {},
      },
      {
        id: 'group_1', type: 'group', position: { x: 260, y: 160 },
        inputs: {
          in_uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          in_time: { type: 'float', label: 'Time', connection: { nodeId: 'time_0', outputKey: 'time' } },
        },
        outputs: { out_uv: { type: 'vec2', label: 'UV' } },
        params: {
          label: 'Warp Step',
          iterations: 4,
          subgraph: {
            nodes: [
              // Carry: warped UV feeds back as input each iteration
              {
                id: 'warp_n', type: 'smoothWarp', position: { x: 120, y: 200 },
                inputs:  {
                  input:    { type: 'vec2',  label: 'UV' },
                  time:     { type: 'float', label: 'Time' },
                  strength: { type: 'float', label: 'Strength' },
                },
                outputs: { output: { type: 'vec2', label: 'UV out' } },
                params:  { strength: 0.18, scale: 2.5, speed: 0.3 },
                carryMode: true,
              },
            ],
            inputPorts: [
              { key: 'in_uv',   type: 'vec2',  label: 'UV',   toNodeId: 'warp_n', toInputKey: 'input' },
              { key: 'in_time', type: 'float', label: 'Time', toNodeId: 'warp_n', toInputKey: 'time'  },
            ],
            outputPorts: [
              { key: 'out_uv', type: 'vec2', label: 'UV', fromNodeId: 'warp_n', fromOutputKey: 'output' },
            ],
          },
        },
      },
      // Sample FBM at the fully-warped UV for a turbulent color field
      {
        id: 'fbm_2', type: 'fbm', position: { x: 480, y: 200 },
        inputs:  {
          uv:         { type: 'vec2',  label: 'UV',         connection: { nodeId: 'group_1', outputKey: 'out_uv' } },
          time:       { type: 'float', label: 'Time',       connection: { nodeId: 'time_0',  outputKey: 'time'   } },
          scale:      { type: 'float', label: 'Scale'      },
          time_scale: { type: 'float', label: 'Time Scale' },
        },
        outputs: { value: { type: 'float', label: 'Value' }, uv: { type: 'vec2', label: 'UV (pass-through)' } },
        params:  { octaves: 4, lacunarity: 2.0, gain: 0.5, scale: 2.5, time_scale: 0.05 },
      },
      {
        id: 'palette_3', type: 'palettePreset', position: { x: 700, y: 200 },
        inputs:  { t: { type: 'float', label: 'T', connection: { nodeId: 'fbm_2', outputKey: 'value' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params:  { preset: '1' },
      },
      {
        id: 'out_4', type: 'output', position: { x: 920, y: 220 },
        inputs:  { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'palette_3', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Group Carry: Power Fold — Mandelbox-style abs fold via carry + accumulate ─
  // Each iter: uv = abs(uv * scale) - 1.0  (abs fold + scale + offset).
  // Glow from length of folded UV accumulates with +=, yielding complex SDF rings.
  groupCarryPowerFold: {
    label: 'Group: Power Fold (Carry)',
    counter: 3,
    nodes: [
      {
        id: 'uv_0', type: 'uv', position: { x: 40, y: 260 },
        inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {},
      },
      {
        id: 'group_1', type: 'group', position: { x: 260, y: 160 },
        inputs: {
          in_uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          in_uv0:  { type: 'vec2',  label: 'UV0',  connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
        },
        outputs: { out_color: { type: 'vec3', label: 'Color' } },
        params: {
          label: 'Power Fold',
          iterations: 5,
          subgraph: {
            nodes: [
              // Carry: abs(uv * 1.6) - 0.9  (Mandelbox-style fold)
              {
                id: 'fold_n', type: 'expr', position: { x: 120, y: 180 },
                inputs:  { in0: { type: 'vec2', label: 'uv' } },
                outputs: { result: { type: 'vec2', label: 'Result' } },
                params:  {
                  expr: 'abs(uv * 1.6) - 0.9',
                  outputType: 'vec2',
                  in0Name: 'uv', in1Name: 'in1', in2Name: 'in2', in3Name: 'in3',
                },
                carryMode: true,
              },
              // Length of folded UV
              {
                id: 'len_c', type: 'length', position: { x: 320, y: 200 },
                inputs:  { input: { type: 'vec2', label: 'Input', connection: { nodeId: 'fold_n', outputKey: 'result' } } },
                outputs: { output: { type: 'float', label: 'Output' } },
                params:  { scale: 1.0 },
              },
              // Original UV length for center falloff
              {
                id: 'len_o', type: 'length', position: { x: 120, y: 360 },
                inputs:  { input: { type: 'vec2', label: 'Input' } },
                outputs: { output: { type: 'float', label: 'Output' } },
                params:  { scale: 1.0 },
              },
              { id: 'loop_i', type: 'loopIndex', position: { x: 120, y: 480 },
                inputs: {}, outputs: { i: { type: 'float', label: 'i' } }, params: {} },
              { id: 'time_n', type: 'time', position: { x: 120, y: 560 },
                inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
              // Palette driver: len_o + i*0.45 + time*0.35
              {
                id: 'i_045', type: 'multiply', position: { x: 320, y: 480 },
                inputs:  { a: { type: 'float', label: 'A', connection: { nodeId: 'loop_i', outputKey: 'i'    } } },
                outputs: { result: { type: 'float', label: 'Result' } },
                params:  { b: 0.45 },
              },
              {
                id: 't_035', type: 'multiply', position: { x: 320, y: 560 },
                inputs:  { a: { type: 'float', label: 'A', connection: { nodeId: 'time_n', outputKey: 'time' } } },
                outputs: { result: { type: 'float', label: 'Result' } },
                params:  { b: 0.35 },
              },
              {
                id: 'it_sum', type: 'add', position: { x: 520, y: 520 },
                inputs:  {
                  a: { type: 'float', label: 'A', connection: { nodeId: 'i_045', outputKey: 'result' } },
                  b: { type: 'float', label: 'B', connection: { nodeId: 't_035', outputKey: 'result' } },
                },
                outputs: { result: { type: 'float', label: 'Result' } },
                params:  {},
              },
              {
                id: 'pal_t', type: 'add', position: { x: 720, y: 440 },
                inputs:  {
                  a: { type: 'float', label: 'A', connection: { nodeId: 'len_o',  outputKey: 'output' } },
                  b: { type: 'float', label: 'B', connection: { nodeId: 'it_sum', outputKey: 'result' } },
                },
                outputs: { result: { type: 'float', label: 'Result' } },
                params:  {},
              },
              {
                id: 'palette', type: 'palettePreset', position: { x: 920, y: 400 },
                inputs:  { t: { type: 'float', label: 'T', connection: { nodeId: 'pal_t', outputKey: 'result' } } },
                outputs: { color: { type: 'vec3', label: 'Color' } },
                params:  { preset: '0' },
              },
              // Glow from length of folded UV
              {
                id: 'glow', type: 'expr', position: { x: 520, y: 200 },
                inputs:  {
                  in0: { type: 'float', label: 'd',    connection: { nodeId: 'len_c',  outputKey: 'output' } },
                  in1: { type: 'float', label: 'time', connection: { nodeId: 'time_n', outputKey: 'time'   } },
                },
                outputs: { result: { type: 'float', label: 'Result' } },
                params:  {
                  expr: 'pow(0.012 / abs(sin(d * 7.0 + time) / 7.0), 1.1)',
                  outputType: 'float',
                  in0Name: 'd', in1Name: 'time', in2Name: 'in2', in3Name: 'in3',
                },
              },
              // Accumulate color across all fold iterations
              {
                id: 'col_acc', type: 'multiplyVec3', position: { x: 1120, y: 360 },
                inputs:  {
                  color: { type: 'vec3', label: 'Color', connection: { nodeId: 'palette', outputKey: 'color'  } },
                  scale: { type: 'float', label: 'Scale', connection: { nodeId: 'glow',    outputKey: 'result' } },
                },
                outputs: { result: { type: 'vec3', label: 'Result' } },
                params:  {},
                assignOp: '+=',
              },
            ],
            inputPorts: [
              { key: 'in_uv',  type: 'vec2', label: 'UV',  toNodeId: 'fold_n', toInputKey: 'in0'   },
              { key: 'in_uv0', type: 'vec2', label: 'UV0', toNodeId: 'len_o',  toInputKey: 'input' },
            ],
            outputPorts: [
              { key: 'out_color', type: 'vec3', label: 'Color', fromNodeId: 'col_acc', fromOutputKey: 'result' },
            ],
          },
        },
      },
      {
        id: 'out_5', type: 'output', position: { x: 560, y: 220 },
        inputs:  { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'group_1', outputKey: 'out_color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Group Carry: Additive UV Fold — fract carry with += instead of = ──────────
  // Demonstrates assignOp '+=' on a carry-mode node.
  // Instead of `uv = fract(uv*1.5)-0.5` each iter, we do `uv += fract(uv*1.5)-0.5`.
  // The UV accumulates additively, producing a distinct spatial distortion.
  // Color is also accumulated with +=, same as groupCarryRings.
  groupAdditiveRings: {
    label: 'Group: Additive UV Fold (+=)',
    counter: 3,
    nodes: [
      {
        id: 'uv_0', type: 'uv', position: { x: 40, y: 260 },
        inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {},
      },
      {
        id: 'group_1', type: 'group', position: { x: 240, y: 160 },
        inputs: {
          in_uv:  { type: 'vec2', label: 'UV',  connection: { nodeId: 'uv_0', outputKey: 'uv' } },
          in_uv0: { type: 'vec2', label: 'UV0', connection: { nodeId: 'uv_0', outputKey: 'uv' } },
        },
        outputs: { out_color: { type: 'vec3', label: 'Color' } },
        params: {
          label: 'Additive UV Fold',
          iterations: 4,
          subgraph: {
            nodes: [
              // Additive UV fold: uv += fract(uv * 1.5) - 0.5  (assignOp += on carry)
              {
                id: 'fract_n', type: 'fract', position: { x: 120, y: 160 },
                inputs:  { input: { type: 'vec2', label: 'Input' } },
                outputs: { output: { type: 'vec2', label: 'Output' } },
                params:  { scale: 1.5 },
                carryMode: true,
                assignOp: '+=',
              },
              // Length of accumulated UV
              {
                id: 'len_c', type: 'length', position: { x: 320, y: 200 },
                inputs:  { input: { type: 'vec2', label: 'Input', connection: { nodeId: 'fract_n', outputKey: 'output' } } },
                outputs: { output: { type: 'float', label: 'Output' } },
                params:  { scale: 1.0 },
              },
              // Length of original UV (fixed)
              {
                id: 'len_o', type: 'length', position: { x: 120, y: 340 },
                inputs:  { input: { type: 'vec2', label: 'Input' } },
                outputs: { output: { type: 'float', label: 'Output' } },
                params:  { scale: 1.0 },
              },
              // exp(-len(uv0)) — radial falloff
              {
                id: 'exp_n', type: 'exp', position: { x: 320, y: 360 },
                inputs:  { input: { type: 'float', label: 'Input', connection: { nodeId: 'len_o', outputKey: 'output' } } },
                outputs: { output: { type: 'float', label: 'Output' } },
                params:  { scale: -1.0 },
              },
              // d = len_c * exp_n
              {
                id: 'd_val', type: 'multiply', position: { x: 520, y: 280 },
                inputs:  {
                  a: { type: 'float', label: 'A', connection: { nodeId: 'len_c', outputKey: 'output' } },
                  b: { type: 'float', label: 'B', connection: { nodeId: 'exp_n', outputKey: 'output' } },
                },
                outputs: { result: { type: 'float', label: 'Result' } },
                params:  {},
              },
              { id: 'loop_i', type: 'loopIndex', position: { x: 120, y: 460 },
                inputs: {}, outputs: { i: { type: 'float', label: 'i' } }, params: {} },
              { id: 'time_n', type: 'time', position: { x: 120, y: 540 },
                inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
              {
                id: 'i_04', type: 'multiply', position: { x: 320, y: 460 },
                inputs:  { a: { type: 'float', label: 'A', connection: { nodeId: 'loop_i', outputKey: 'i' } } },
                outputs: { result: { type: 'float', label: 'Result' } },
                params:  { b: 0.4 },
              },
              {
                id: 't_04', type: 'multiply', position: { x: 320, y: 540 },
                inputs:  { a: { type: 'float', label: 'A', connection: { nodeId: 'time_n', outputKey: 'time' } } },
                outputs: { result: { type: 'float', label: 'Result' } },
                params:  { b: 0.4 },
              },
              {
                id: 'it_add', type: 'add', position: { x: 520, y: 500 },
                inputs:  {
                  a: { type: 'float', label: 'A', connection: { nodeId: 'i_04', outputKey: 'result' } },
                  b: { type: 'float', label: 'B', connection: { nodeId: 't_04', outputKey: 'result' } },
                },
                outputs: { result: { type: 'float', label: 'Result' } },
                params:  {},
              },
              {
                id: 'pal_t', type: 'add', position: { x: 720, y: 440 },
                inputs:  {
                  a: { type: 'float', label: 'A', connection: { nodeId: 'len_o',  outputKey: 'output' } },
                  b: { type: 'float', label: 'B', connection: { nodeId: 'it_add', outputKey: 'result' } },
                },
                outputs: { result: { type: 'float', label: 'Result' } },
                params:  {},
              },
              {
                id: 'palette', type: 'palettePreset', position: { x: 920, y: 400 },
                inputs:  { t: { type: 'float', label: 'T', connection: { nodeId: 'pal_t', outputKey: 'result' } } },
                outputs: { color: { type: 'vec3', label: 'Color' } },
                params:  { preset: '3' },
              },
              {
                id: 'glow', type: 'expr', position: { x: 720, y: 280 },
                inputs:  {
                  in0: { type: 'float', label: 'd',    connection: { nodeId: 'd_val',  outputKey: 'result' } },
                  in1: { type: 'float', label: 'time', connection: { nodeId: 'time_n', outputKey: 'time'   } },
                },
                outputs: { result: { type: 'float', label: 'Result' } },
                params:  {
                  expr: 'pow(0.01 / abs(sin(d * 8.0 + time) / 8.0), 1.2)',
                  outputType: 'float',
                  in0Name: 'd', in1Name: 'time', in2Name: 'in2', in3Name: 'in3',
                },
              },
              // col += palette * glow — additive color accumulation
              {
                id: 'col_d', type: 'multiplyVec3', position: { x: 1120, y: 360 },
                inputs:  {
                  color: { type: 'vec3', label: 'Color', connection: { nodeId: 'palette', outputKey: 'color'  } },
                  scale: { type: 'float', label: 'Scale', connection: { nodeId: 'glow',    outputKey: 'result' } },
                },
                outputs: { result: { type: 'vec3', label: 'Result' } },
                params:  {},
                assignOp: '+=',
              },
            ],
            inputPorts: [
              { key: 'in_uv',  type: 'vec2', label: 'UV',  toNodeId: 'fract_n', toInputKey: 'input' },
              { key: 'in_uv0', type: 'vec2', label: 'UV0', toNodeId: 'len_o',   toInputKey: 'input' },
            ],
            outputPorts: [
              { key: 'out_color', type: 'vec3', label: 'Color', fromNodeId: 'col_d', fromOutputKey: 'result' },
            ],
          },
        },
      },
      {
        id: 'out_2', type: 'output', position: { x: 560, y: 220 },
        inputs:  { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'group_1', outputKey: 'out_color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Group Carry: Product Accumulate Rings — *=  color resonance ───────────────
  // Demonstrates assignOp '*=' on a non-carry color node.
  // col_d starts at vec3(1.0) (neutral for *=) and each iteration multiplies by
  // palette * soft_glow.  Only pixels bright across ALL iterations stay lit,
  // creating resonance patterns at ring intersections.
  groupProductRings: {
    label: 'Group: Product Rings (*=)',
    counter: 3,
    nodes: [
      {
        id: 'uv_0', type: 'uv', position: { x: 40, y: 260 },
        inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {},
      },
      {
        id: 'group_1', type: 'group', position: { x: 240, y: 160 },
        inputs: {
          in_uv:  { type: 'vec2', label: 'UV',  connection: { nodeId: 'uv_0', outputKey: 'uv' } },
          in_uv0: { type: 'vec2', label: 'UV0', connection: { nodeId: 'uv_0', outputKey: 'uv' } },
        },
        outputs: { out_color: { type: 'vec3', label: 'Color' } },
        params: {
          label: 'Product Rings',
          iterations: 4,
          subgraph: {
            nodes: [
              // Standard UV carry fold (= operator, no assignOp)
              {
                id: 'fract_n', type: 'fract', position: { x: 120, y: 160 },
                inputs:  { input: { type: 'vec2', label: 'Input' } },
                outputs: { output: { type: 'vec2', label: 'Output' } },
                params:  { scale: 1.5 },
                carryMode: true,
              },
              {
                id: 'len_c', type: 'length', position: { x: 320, y: 200 },
                inputs:  { input: { type: 'vec2', label: 'Input', connection: { nodeId: 'fract_n', outputKey: 'output' } } },
                outputs: { output: { type: 'float', label: 'Output' } },
                params:  { scale: 1.0 },
              },
              {
                id: 'len_o', type: 'length', position: { x: 120, y: 340 },
                inputs:  { input: { type: 'vec2', label: 'Input' } },
                outputs: { output: { type: 'float', label: 'Output' } },
                params:  { scale: 1.0 },
              },
              { id: 'loop_i', type: 'loopIndex', position: { x: 120, y: 460 },
                inputs: {}, outputs: { i: { type: 'float', label: 'i' } }, params: {} },
              { id: 'time_n', type: 'time', position: { x: 120, y: 540 },
                inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
              {
                id: 'i_03', type: 'multiply', position: { x: 320, y: 460 },
                inputs:  { a: { type: 'float', label: 'A', connection: { nodeId: 'loop_i', outputKey: 'i' } } },
                outputs: { result: { type: 'float', label: 'Result' } },
                params:  { b: 0.3 },
              },
              {
                id: 't_02', type: 'multiply', position: { x: 320, y: 540 },
                inputs:  { a: { type: 'float', label: 'A', connection: { nodeId: 'time_n', outputKey: 'time' } } },
                outputs: { result: { type: 'float', label: 'Result' } },
                params:  { b: 0.2 },
              },
              {
                id: 'it_add', type: 'add', position: { x: 520, y: 500 },
                inputs:  {
                  a: { type: 'float', label: 'A', connection: { nodeId: 'i_03', outputKey: 'result' } },
                  b: { type: 'float', label: 'B', connection: { nodeId: 't_02', outputKey: 'result' } },
                },
                outputs: { result: { type: 'float', label: 'Result' } },
                params:  {},
              },
              {
                id: 'pal_t', type: 'add', position: { x: 720, y: 440 },
                inputs:  {
                  a: { type: 'float', label: 'A', connection: { nodeId: 'len_o',  outputKey: 'output' } },
                  b: { type: 'float', label: 'B', connection: { nodeId: 'it_add', outputKey: 'result' } },
                },
                outputs: { result: { type: 'float', label: 'Result' } },
                params:  {},
              },
              {
                id: 'palette', type: 'palettePreset', position: { x: 920, y: 400 },
                inputs:  { t: { type: 'float', label: 'T', connection: { nodeId: 'pal_t', outputKey: 'result' } } },
                outputs: { color: { type: 'vec3', label: 'Color' } },
                params:  { preset: '2' },
              },
              // Soft bounded glow — clamp keeps it in [0, 1] so *=  stays controlled
              {
                id: 'glow', type: 'expr', position: { x: 720, y: 280 },
                inputs:  {
                  in0: { type: 'float', label: 'd',    connection: { nodeId: 'len_c',  outputKey: 'output' } },
                  in1: { type: 'float', label: 'time', connection: { nodeId: 'time_n', outputKey: 'time'   } },
                },
                outputs: { result: { type: 'float', label: 'Result' } },
                params:  {
                  expr: 'clamp(0.04 / (abs(sin(d * 6.0 + time) / 6.0) + 0.02), 0.0, 1.0)',
                  outputType: 'float',
                  in0Name: 'd', in1Name: 'time', in2Name: 'in2', in3Name: 'in3',
                },
              },
              // col *= palette * soft_glow — product accumulation (neutral: vec3(1.0))
              // Only pixels where ALL iterations produce a bright ring remain lit.
              {
                id: 'col_d', type: 'multiplyVec3', position: { x: 1120, y: 360 },
                inputs:  {
                  color: { type: 'vec3', label: 'Color', connection: { nodeId: 'palette', outputKey: 'color'  } },
                  scale: { type: 'float', label: 'Scale', connection: { nodeId: 'glow',    outputKey: 'result' } },
                },
                outputs: { result: { type: 'vec3', label: 'Result' } },
                params:  {},
                assignOp: '*=',
              },
            ],
            inputPorts: [
              { key: 'in_uv',  type: 'vec2', label: 'UV',  toNodeId: 'fract_n', toInputKey: 'input' },
              { key: 'in_uv0', type: 'vec2', label: 'UV0', toNodeId: 'len_o',   toInputKey: 'input' },
            ],
            outputPorts: [
              { key: 'out_color', type: 'vec3', label: 'Color', fromNodeId: 'col_d', fromOutputKey: 'result' },
            ],
          },
        },
      },
      {
        id: 'out_2', type: 'output', position: { x: 560, y: 220 },
        inputs:  { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'group_1', outputKey: 'out_color' } } },
        outputs: {}, params: {},
      },
    ],
  },

};

// The default graph to load on startup
export const DEFAULT_EXAMPLE = 'fractalRings';
