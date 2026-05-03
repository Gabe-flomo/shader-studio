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
      // ExprBlock: entire glow pipeline in one line
      { id: 'expr_3', type: 'exprNode', position: { x: 540, y: 320 },
        inputs: {
          d: { type: 'float', label: 'd (float)', connection: { nodeId: 'len_2',  outputKey: 'output' } },
          t: { type: 'float', label: 't (float)', connection: { nodeId: 'time_1', outputKey: 'time'   } },
        },
        outputs: { result: { type: 'vec3', label: 'Result (vec3)' } },
        params: { inputs: [{ name: 'd', type: 'float', slider: null }, { name: 't', type: 'float', slider: null }], outputType: 'float', lines: [], result: '0.01 / abs(sin(d * 8.0 + t) / 8.0)', expr: '0.01 / abs(sin(d * 8.0 + t) / 8.0)' } },
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
      // ExprBlock: orbit offset vec2 in one line
      { id: 'expr_2', type: 'exprNode', position: { x: 300, y: 320 },
        inputs: { t: { type: 'float', label: 't (float)', connection: { nodeId: 'time_1', outputKey: 'time' } } },
        outputs: { result: { type: 'vec3', label: 'Result (vec3)' } },
        params: { inputs: [{ name: 't', type: 'float', slider: null }], outputType: 'vec2', lines: [], result: 'vec2(sin(t), cos(t)) * 0.5', expr: 'vec2(sin(t), cos(t)) * 0.5' } },
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

  // ── Animated Palette — glowing circle with palette cycling over time ─────────
  animatedPalette: {
    label: 'Animated Palette',
    counter: 8,
    nodes: [
      { id: 'ap_uv',   type: 'uv',   position: { x: 40, y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'ap_t',    type: 'time', position: { x: 40, y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'ap_cir', type: 'circleSDF', position: { x: 260, y: 180 },
        inputs: {
          position: { type: 'vec2',  label: 'Position', connection: { nodeId: 'ap_uv', outputKey: 'uv' } },
          radius:   { type: 'float', label: 'Radius' },
          offset:   { type: 'vec2',  label: 'Offset' },
        },
        outputs: { distance: { type: 'float', label: 'Distance' } },
        params: { radius: 0.35 },
      },
      {
        id: 'ap_lit', type: 'makeLight', position: { x: 480, y: 180 },
        inputs: {
          distance:   { type: 'float', label: 'Distance',   connection: { nodeId: 'ap_cir', outputKey: 'distance' } },
          brightness: { type: 'float', label: 'Brightness' },
        },
        outputs: { glow: { type: 'float', label: 'Glow' } },
        params: { brightness: 8.0 },
      },
      {
        id: 'ap_pal', type: 'palettePreset', position: { x: 480, y: 360 },
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'ap_t', outputKey: 'time' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { preset: '4' },
      },
      {
        id: 'ap_mul', type: 'multiplyVec3', position: { x: 700, y: 270 },
        inputs: {
          color: { type: 'vec3',  label: 'Color', connection: { nodeId: 'ap_pal', outputKey: 'color' } },
          scale: { type: 'float', label: 'Scale', connection: { nodeId: 'ap_lit', outputKey: 'glow'  } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } },
        params: {},
      },
      {
        id: 'ap_tone', type: 'toneMap', position: { x: 900, y: 270 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'ap_mul', outputKey: 'result' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { mode: 'aces' },
      },
      {
        id: 'ap_out', type: 'output', position: { x: 1100, y: 270 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'ap_tone', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
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

  // ── Tone Map Demo — circle glow → palettePreset → toneMap ACES ──────────────
  toneMapDemo: {
    label: 'Tone Map — ACES',
    counter: 8,
    nodes: [
      { id: 'tm_uv',   type: 'uv',   position: { x: 40,  y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'tm_t',    type: 'time', position: { x: 40,  y: 400 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'tm_cir', type: 'circleSDF', position: { x: 240, y: 180 },
        inputs: {
          position: { type: 'vec2',  label: 'Position', connection: { nodeId: 'tm_uv', outputKey: 'uv' } },
          radius:   { type: 'float', label: 'Radius' },
          offset:   { type: 'vec2',  label: 'Offset' },
        },
        outputs: { distance: { type: 'float', label: 'Distance' } },
        params: { radius: 0.35 },
      },
      {
        id: 'tm_lit', type: 'makeLight', position: { x: 460, y: 180 },
        inputs: {
          distance:   { type: 'float', label: 'Distance',   connection: { nodeId: 'tm_cir', outputKey: 'distance' } },
          brightness: { type: 'float', label: 'Brightness' },
        },
        outputs: { glow: { type: 'float', label: 'Glow' } },
        params: { brightness: 25.0 },
      },
      {
        id: 'tm_pal', type: 'palettePreset', position: { x: 460, y: 360 },
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'tm_t', outputKey: 'time' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { preset: '5' },
      },
      {
        id: 'tm_mul', type: 'multiplyVec3', position: { x: 680, y: 270 },
        inputs: {
          color: { type: 'vec3',  label: 'Color', connection: { nodeId: 'tm_pal', outputKey: 'color' } },
          scale: { type: 'float', label: 'Scale', connection: { nodeId: 'tm_lit', outputKey: 'glow'  } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } },
        params: {},
      },
      {
        id: 'tm_tone', type: 'toneMap', position: { x: 880, y: 270 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'tm_mul', outputKey: 'result' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { mode: 'aces' },
      },
      {
        id: 'tm_out', type: 'output', position: { x: 1080, y: 270 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'tm_tone', outputKey: 'color' } } },
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
      // Orbit offsets via ExprBlock nodes
      { id: 'orbit1_2', type: 'exprNode', position: { x: 280, y: 100 },
        inputs: { t: { type: 'float', label: 't (float)', connection: { nodeId: 'time_1', outputKey: 'time' } } },
        outputs: { result: { type: 'vec3', label: 'Result (vec3)' } },
        params: { inputs: [{ name: 't', type: 'float', slider: null }], outputType: 'vec2', lines: [], result: 'vec2(sin(t * 0.8), cos(t * 0.8)) * 0.4', expr: 'vec2(sin(t * 0.8), cos(t * 0.8)) * 0.4' } },
      { id: 'orbit2_3', type: 'exprNode', position: { x: 280, y: 260 },
        inputs: { t: { type: 'float', label: 't (float)', connection: { nodeId: 'time_1', outputKey: 'time' } } },
        outputs: { result: { type: 'vec3', label: 'Result (vec3)' } },
        params: { inputs: [{ name: 't', type: 'float', slider: null }], outputType: 'vec2', lines: [], result: 'vec2(cos(t * 1.1 + 2.09), sin(t * 1.1 + 2.09)) * 0.35', expr: 'vec2(cos(t * 1.1 + 2.09), sin(t * 1.1 + 2.09)) * 0.35' } },
      { id: 'orbit3_4', type: 'exprNode', position: { x: 280, y: 420 },
        inputs: { t: { type: 'float', label: 't (float)', connection: { nodeId: 'time_1', outputKey: 'time' } } },
        outputs: { result: { type: 'vec3', label: 'Result (vec3)' } },
        params: { inputs: [{ name: 't', type: 'float', slider: null }], outputType: 'vec2', lines: [], result: 'vec2(sin(t * 1.3 + 4.19), cos(t * 1.3 + 4.19)) * 0.3', expr: 'vec2(sin(t * 1.3 + 4.19), cos(t * 1.3 + 4.19)) * 0.3' } },
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

  // ── HSV — animating hue rotation on a glowing circle ────────────────────────
  hsvDemo: {
    label: 'HSV — Hue Rotation',
    counter: 12,
    nodes: [
      { id: 'hv_uv',   type: 'uv',   position: { x: 40,  y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'hv_t',    type: 'time', position: { x: 40,  y: 420 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'hv_cir', type: 'circleSDF', position: { x: 240, y: 180 },
        inputs: {
          position: { type: 'vec2',  label: 'Position', connection: { nodeId: 'hv_uv', outputKey: 'uv' } },
          radius:   { type: 'float', label: 'Radius' },
          offset:   { type: 'vec2',  label: 'Offset' },
        },
        outputs: { distance: { type: 'float', label: 'Distance' } },
        params: { radius: 0.35 },
      },
      {
        id: 'hv_lit', type: 'makeLight', position: { x: 460, y: 180 },
        inputs: {
          distance:   { type: 'float', label: 'Distance',   connection: { nodeId: 'hv_cir', outputKey: 'distance' } },
          brightness: { type: 'float', label: 'Brightness' },
        },
        outputs: { glow: { type: 'float', label: 'Glow' } },
        params: { brightness: 10.0 },
      },
      {
        id: 'hv_pal', type: 'palettePreset', position: { x: 460, y: 360 },
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'hv_lit', outputKey: 'glow' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { preset: '1' },
      },
      {
        id: 'hv_mul', type: 'multiplyVec3', position: { x: 680, y: 270 },
        inputs: {
          color: { type: 'vec3',  label: 'Color', connection: { nodeId: 'hv_pal', outputKey: 'color' } },
          scale: { type: 'float', label: 'Scale', connection: { nodeId: 'hv_lit', outputKey: 'glow'  } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } },
        params: {},
      },
      // RGB → HSV
      { id: 'hv_hsv1', type: 'hsv', position: { x: 880, y: 270 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'hv_mul', outputKey: 'result' } } },
        outputs: { color: { type: 'vec3', label: 'Color' }, h: { type: 'float', label: 'H' }, s: { type: 'float', label: 'S' }, v: { type: 'float', label: 'V' } },
        params: { direction: 'rgb2hsv' } },
      // Add time to hue directly
      { id: 'hv_add', type: 'add', position: { x: 1060, y: 260 },
        inputs: {
          a: { type: 'float', label: 'A', connection: { nodeId: 'hv_hsv1', outputKey: 'h'   } },
          b: { type: 'float', label: 'B', connection: { nodeId: 'hv_t',    outputKey: 'time'} },
        },
        outputs: { result: { type: 'float', label: 'Result' } },
        params: { b: 0.0 } },
      { id: 'hv_frac', type: 'fractRaw', position: { x: 1240, y: 260 },
        inputs: { input: { type: 'float', label: 'Input', connection: { nodeId: 'hv_add', outputKey: 'result' } } },
        outputs: { output: { type: 'float', label: 'Output' } },
        params: {} },
      // Reassemble HSV → RGB
      { id: 'hv_mkv', type: 'makeVec3', position: { x: 1240, y: 400 },
        inputs: {
          r: { type: 'float', label: 'R', connection: { nodeId: 'hv_frac', outputKey: 'output' } },
          g: { type: 'float', label: 'G', connection: { nodeId: 'hv_hsv1', outputKey: 's'     } },
          b: { type: 'float', label: 'B', connection: { nodeId: 'hv_hsv1', outputKey: 'v'     } },
        },
        outputs: { rgb: { type: 'vec3', label: 'RGB' } },
        params: {} },
      { id: 'hv_hsv2', type: 'hsv', position: { x: 1440, y: 340 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'hv_mkv', outputKey: 'rgb' } } },
        outputs: { color: { type: 'vec3', label: 'Color' }, h: { type: 'float', label: 'H' }, s: { type: 'float', label: 'S' }, v: { type: 'float', label: 'V' } },
        params: { direction: 'hsv2rgb' } },
      { id: 'hv_out', type: 'output', position: { x: 1640, y: 270 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'hv_hsv2', outputKey: 'color' } } },
        outputs: {}, params: {} },
    ],
  },

  // ── Posterize — banding effect on a colored glow ─────────────────────────
  posterizeDemo: {
    label: 'Posterize',
    counter: 7,
    nodes: [
      { id: 'po_uv',   type: 'uv',   position: { x: 40,  y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'po_t',    type: 'time', position: { x: 40,  y: 400 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'po_cir', type: 'circleSDF', position: { x: 240, y: 180 },
        inputs: {
          position: { type: 'vec2',  label: 'Position', connection: { nodeId: 'po_uv', outputKey: 'uv' } },
          radius:   { type: 'float', label: 'Radius' },
          offset:   { type: 'vec2',  label: 'Offset' },
        },
        outputs: { distance: { type: 'float', label: 'Distance' } },
        params: { radius: 0.35 },
      },
      {
        id: 'po_lit', type: 'makeLight', position: { x: 460, y: 180 },
        inputs: {
          distance:   { type: 'float', label: 'Distance',   connection: { nodeId: 'po_cir', outputKey: 'distance' } },
          brightness: { type: 'float', label: 'Brightness' },
        },
        outputs: { glow: { type: 'float', label: 'Glow' } },
        params: { brightness: 12.0 },
      },
      {
        id: 'po_pal', type: 'palettePreset', position: { x: 460, y: 360 },
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'po_lit', outputKey: 'glow' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { preset: '2' },
      },
      {
        id: 'po_mul', type: 'multiplyVec3', position: { x: 680, y: 270 },
        inputs: {
          color: { type: 'vec3',  label: 'Color', connection: { nodeId: 'po_pal', outputKey: 'color' } },
          scale: { type: 'float', label: 'Scale', connection: { nodeId: 'po_lit', outputKey: 'glow'  } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } },
        params: {},
      },
      {
        id: 'po_post', type: 'posterize', position: { x: 880, y: 270 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'po_mul', outputKey: 'result' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { levels: 6.0 },
      },
      {
        id: 'po_out', type: 'output', position: { x: 1080, y: 270 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'po_post', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Invert — color inversion on a glowing circle ─────────────────────────
  desaturateDemo: {
    label: 'Desaturate',
    counter: 7,
    nodes: [
      { id: 'ds_uv',   type: 'uv',   position: { x: 40,  y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'ds_t',    type: 'time', position: { x: 40,  y: 400 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'ds_cir', type: 'circleSDF', position: { x: 240, y: 180 },
        inputs: {
          position: { type: 'vec2',  label: 'Position', connection: { nodeId: 'ds_uv', outputKey: 'uv' } },
          radius:   { type: 'float', label: 'Radius' },
          offset:   { type: 'vec2',  label: 'Offset' },
        },
        outputs: { distance: { type: 'float', label: 'Distance' } },
        params: { radius: 0.35 },
      },
      {
        id: 'ds_lit', type: 'makeLight', position: { x: 460, y: 180 },
        inputs: {
          distance:   { type: 'float', label: 'Distance',   connection: { nodeId: 'ds_cir', outputKey: 'distance' } },
          brightness: { type: 'float', label: 'Brightness' },
        },
        outputs: { glow: { type: 'float', label: 'Glow' } },
        params: { brightness: 10.0 },
      },
      {
        id: 'ds_pal', type: 'palettePreset', position: { x: 460, y: 360 },
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'ds_lit', outputKey: 'glow' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { preset: '4' },
      },
      {
        id: 'ds_mul', type: 'multiplyVec3', position: { x: 680, y: 270 },
        inputs: {
          color: { type: 'vec3',  label: 'Color', connection: { nodeId: 'ds_pal', outputKey: 'color' } },
          scale: { type: 'float', label: 'Scale', connection: { nodeId: 'ds_lit', outputKey: 'glow'  } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } },
        params: {},
      },
      {
        id: 'ds_dsat', type: 'desaturate', position: { x: 880, y: 270 },
        inputs: {
          color:  { type: 'vec3',  label: 'Color',  connection: { nodeId: 'ds_mul', outputKey: 'result' } },
          amount: { type: 'float', label: 'Amount' },
        },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { amount: 0.8 },
      },
      {
        id: 'ds_out', type: 'output', position: { x: 1080, y: 270 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'ds_dsat', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
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
                id: 'glow', type: 'exprNode', position: { x: 720, y: 280 },
                inputs:  {
                  d:    { type: 'float', label: 'd (float)',    connection: { nodeId: 'd_val', outputKey: 'result' } },
                  time: { type: 'float', label: 'time (float)', connection: { nodeId: 'time_n', outputKey: 'time' } },
                },
                outputs: { result: { type: 'vec3', label: 'Result (vec3)' } },
                params:  {
                  inputs: [{ name: 'd', type: 'float', slider: null }, { name: 'time', type: 'float', slider: null }],
                  outputType: 'float', lines: [],
                  result: 'pow(0.01 / abs(sin(d * 8.0 + time) / 8.0), 1.2)',
                  expr: 'pow(0.01 / abs(sin(d * 8.0 + time) / 8.0), 1.2)',
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
                id: 'glow', type: 'exprNode', position: { x: 520, y: 180 },
                inputs:  {
                  d:    { type: 'float', label: 'd (float)',    connection: { nodeId: 'len_c',  outputKey: 'output' } },
                  time: { type: 'float', label: 'time (float)', connection: { nodeId: 'time_n', outputKey: 'time'   } },
                },
                outputs: { result: { type: 'vec3', label: 'Result (vec3)' } },
                params:  {
                  inputs: [{ name: 'd', type: 'float', slider: null }, { name: 'time', type: 'float', slider: null }],
                  outputType: 'float', lines: [],
                  result: 'pow(0.01 / abs(sin(d * 6.0 + time) / 6.0), 1.0)',
                  expr: 'pow(0.01 / abs(sin(d * 6.0 + time) / 6.0), 1.0)',
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
                id: 'glow', type: 'exprNode', position: { x: 920, y: 260 },
                inputs:  {
                  d:    { type: 'float', label: 'd (float)',    connection: { nodeId: 'd_val',  outputKey: 'result' } },
                  time: { type: 'float', label: 'time (float)', connection: { nodeId: 'time_n', outputKey: 'time'   } },
                },
                outputs: { result: { type: 'vec3', label: 'Result (vec3)' } },
                params:  {
                  inputs: [{ name: 'd', type: 'float', slider: null }, { name: 'time', type: 'float', slider: null }],
                  outputType: 'float', lines: [],
                  result: 'pow(0.008 / abs(sin(d * 10.0 + time) / 10.0), 1.3)',
                  expr: 'pow(0.008 / abs(sin(d * 10.0 + time) / 10.0), 1.3)',
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
                id: 'amp', type: 'exprNode', position: { x: 320, y: 380 },
                inputs:  { i: { type: 'float', label: 'i (float)', connection: { nodeId: 'loop_i', outputKey: 'i' } } },
                outputs: { result: { type: 'vec3', label: 'Result (vec3)' } },
                params:  {
                  inputs: [{ name: 'i', type: 'float', slider: null }],
                  outputType: 'float', lines: [],
                  result: 'pow(0.5, i)',
                  expr: 'pow(0.5, i)',
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
                id: 'fold_n', type: 'exprNode', position: { x: 120, y: 180 },
                inputs:  { uv: { type: 'vec2', label: 'uv (vec2)' } },
                outputs: { result: { type: 'vec3', label: 'Result (vec3)' } },
                params:  {
                  inputs: [{ name: 'uv', type: 'vec2', slider: null }],
                  outputType: 'vec2', lines: [],
                  result: 'abs(uv * 1.6) - 0.9',
                  expr: 'abs(uv * 1.6) - 0.9',
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
                id: 'glow', type: 'exprNode', position: { x: 520, y: 200 },
                inputs:  {
                  d:    { type: 'float', label: 'd (float)',    connection: { nodeId: 'len_c',  outputKey: 'output' } },
                  time: { type: 'float', label: 'time (float)', connection: { nodeId: 'time_n', outputKey: 'time'   } },
                },
                outputs: { result: { type: 'vec3', label: 'Result (vec3)' } },
                params:  {
                  inputs: [{ name: 'd', type: 'float', slider: null }, { name: 'time', type: 'float', slider: null }],
                  outputType: 'float', lines: [],
                  result: 'pow(0.012 / abs(sin(d * 7.0 + time) / 7.0), 1.1)',
                  expr: 'pow(0.012 / abs(sin(d * 7.0 + time) / 7.0), 1.1)',
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
                id: 'glow', type: 'exprNode', position: { x: 720, y: 280 },
                inputs:  {
                  d:    { type: 'float', label: 'd (float)',    connection: { nodeId: 'd_val',  outputKey: 'result' } },
                  time: { type: 'float', label: 'time (float)', connection: { nodeId: 'time_n', outputKey: 'time'   } },
                },
                outputs: { result: { type: 'vec3', label: 'Result (vec3)' } },
                params:  {
                  inputs: [{ name: 'd', type: 'float', slider: null }, { name: 'time', type: 'float', slider: null }],
                  outputType: 'float', lines: [],
                  result: 'pow(0.01 / abs(sin(d * 8.0 + time) / 8.0), 1.2)',
                  expr: 'pow(0.01 / abs(sin(d * 8.0 + time) / 8.0), 1.2)',
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
                id: 'glow', type: 'exprNode', position: { x: 720, y: 280 },
                inputs:  {
                  d:    { type: 'float', label: 'd (float)',    connection: { nodeId: 'len_c',  outputKey: 'output' } },
                  time: { type: 'float', label: 'time (float)', connection: { nodeId: 'time_n', outputKey: 'time'   } },
                },
                outputs: { result: { type: 'vec3', label: 'Result (vec3)' } },
                params:  {
                  inputs: [{ name: 'd', type: 'float', slider: null }, { name: 'time', type: 'float', slider: null }],
                  outputType: 'float', lines: [],
                  result: 'clamp(0.04 / (abs(sin(d * 6.0 + time) / 6.0) + 0.02), 0.0, 1.0)',
                  expr: 'clamp(0.04 / (abs(sin(d * 6.0 + time) / 6.0) + 0.02), 0.0, 1.0)',
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

  // ── AgX / Filmic Tone Map ─────────────────────────────────────────────────────
  agxToneDemo: {
    label: 'Tone Map — AgX',
    counter: 8,
    nodes: [
      { id: 'ag_uv',   type: 'uv',   position: { x: 40,  y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'ag_t',    type: 'time', position: { x: 40,  y: 400 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'ag_cir', type: 'circleSDF', position: { x: 240, y: 180 },
        inputs: {
          position: { type: 'vec2',  label: 'Position', connection: { nodeId: 'ag_uv', outputKey: 'uv' } },
          radius:   { type: 'float', label: 'Radius' },
          offset:   { type: 'vec2',  label: 'Offset' },
        },
        outputs: { distance: { type: 'float', label: 'Distance' } },
        params: { radius: 0.35 },
      },
      {
        id: 'ag_lit', type: 'makeLight', position: { x: 460, y: 180 },
        inputs: {
          distance:   { type: 'float', label: 'Distance',   connection: { nodeId: 'ag_cir', outputKey: 'distance' } },
          brightness: { type: 'float', label: 'Brightness' },
        },
        outputs: { glow: { type: 'float', label: 'Glow' } },
        params: { brightness: 25.0 },
      },
      {
        id: 'ag_pal', type: 'palettePreset', position: { x: 460, y: 360 },
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'ag_t', outputKey: 'time' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { preset: '3' },
      },
      {
        id: 'ag_mul', type: 'multiplyVec3', position: { x: 680, y: 270 },
        inputs: {
          color: { type: 'vec3',  label: 'Color', connection: { nodeId: 'ag_pal', outputKey: 'color' } },
          scale: { type: 'float', label: 'Scale', connection: { nodeId: 'ag_lit', outputKey: 'glow'  } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } },
        params: {},
      },
      {
        id: 'ag_tone', type: 'toneMap', position: { x: 880, y: 270 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'ag_mul', outputKey: 'result' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { mode: 'agx' },
      },
      {
        id: 'ag_out', type: 'output', position: { x: 1080, y: 270 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'ag_tone', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Luma Grain — shadow-weighted grain (bright areas stay clean) ──────────────
  lumaGrainDemo: {
    label: 'Film Grain',
    counter: 7,
    nodes: [
      { id: 'lg_uv',   type: 'uv',   position: { x: 40,  y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'lg_t',    type: 'time', position: { x: 40,  y: 400 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'lg_cir', type: 'circleSDF', position: { x: 240, y: 180 },
        inputs: {
          position: { type: 'vec2',  label: 'Position', connection: { nodeId: 'lg_uv', outputKey: 'uv' } },
          radius:   { type: 'float', label: 'Radius' },
          offset:   { type: 'vec2',  label: 'Offset' },
        },
        outputs: { distance: { type: 'float', label: 'Distance' } },
        params: { radius: 0.35 },
      },
      {
        id: 'lg_lit', type: 'makeLight', position: { x: 460, y: 180 },
        inputs: {
          distance:   { type: 'float', label: 'Distance',   connection: { nodeId: 'lg_cir', outputKey: 'distance' } },
          brightness: { type: 'float', label: 'Brightness' },
        },
        outputs: { glow: { type: 'float', label: 'Glow' } },
        params: { brightness: 10.0 },
      },
      {
        id: 'lg_pal', type: 'palettePreset', position: { x: 460, y: 360 },
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'lg_lit', outputKey: 'glow' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { preset: '1' },
      },
      {
        id: 'lg_mul', type: 'multiplyVec3', position: { x: 680, y: 270 },
        inputs: {
          color: { type: 'vec3',  label: 'Color', connection: { nodeId: 'lg_pal', outputKey: 'color' } },
          scale: { type: 'float', label: 'Scale', connection: { nodeId: 'lg_lit', outputKey: 'glow'  } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } },
        params: {},
      },
      {
        id: 'lg_grn', type: 'grain', position: { x: 880, y: 270 },
        inputs: {
          color: { type: 'vec3',  label: 'Color',  connection: { nodeId: 'lg_mul', outputKey: 'result' } },
          time:  { type: 'float', label: 'Time',   connection: { nodeId: 'lg_t',   outputKey: 'time'   } },
        },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { strength: 0.08 },
      },
      {
        id: 'lg_out', type: 'output', position: { x: 1080, y: 270 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'lg_grn', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Temporal Grain — time-animated grain, changes each frame ─────────────────
  temporalGrainDemo: {
    label: 'Temporal Grain',
    counter: 7,
    nodes: [
      { id: 'tg_uv',   type: 'uv',   position: { x: 40,  y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'tg_t',    type: 'time', position: { x: 40,  y: 400 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'tg_cir', type: 'circleSDF', position: { x: 240, y: 180 },
        inputs: {
          position: { type: 'vec2',  label: 'Position', connection: { nodeId: 'tg_uv', outputKey: 'uv' } },
          radius:   { type: 'float', label: 'Radius' },
          offset:   { type: 'vec2',  label: 'Offset' },
        },
        outputs: { distance: { type: 'float', label: 'Distance' } },
        params: { radius: 0.35 },
      },
      {
        id: 'tg_lit', type: 'makeLight', position: { x: 460, y: 180 },
        inputs: {
          distance:   { type: 'float', label: 'Distance',   connection: { nodeId: 'tg_cir', outputKey: 'distance' } },
          brightness: { type: 'float', label: 'Brightness' },
        },
        outputs: { glow: { type: 'float', label: 'Glow' } },
        params: { brightness: 10.0 },
      },
      {
        id: 'tg_pal', type: 'palettePreset', position: { x: 460, y: 360 },
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'tg_lit', outputKey: 'glow' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { preset: '2' },
      },
      {
        id: 'tg_mul', type: 'multiplyVec3', position: { x: 680, y: 270 },
        inputs: {
          color: { type: 'vec3',  label: 'Color', connection: { nodeId: 'tg_pal', outputKey: 'color' } },
          scale: { type: 'float', label: 'Scale', connection: { nodeId: 'tg_lit', outputKey: 'glow'  } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } },
        params: {},
      },
      {
        id: 'tg_grn', type: 'grain', position: { x: 880, y: 270 },
        inputs: {
          color: { type: 'vec3',  label: 'Color',  connection: { nodeId: 'tg_mul', outputKey: 'result' } },
          time:  { type: 'float', label: 'Time',   connection: { nodeId: 'tg_t',   outputKey: 'time'   } },
        },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { strength: 0.18 },
      },
      {
        id: 'tg_out', type: 'output', position: { x: 1080, y: 270 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'tg_grn', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Hue Range — isolate / boost a hue band ────────────────────────────────────
  newtonFractalZ5: {
    label: 'Newton z⁵−1',
    counter: 4,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 60, y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 60, y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'newton_2', type: 'newtonFractal', position: { x: 320, y: 140 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: {
          color: { type: 'vec3',  label: 'Color'      },
          iter:  { type: 'float', label: 'Smooth Iter' },
          root:  { type: 'float', label: 'Root Index'  },
        },
        params: { polynomial: 'z5-1', max_iter: 64, zoom: 1.8, center_x: 0.0, center_y: 0.0, palette_preset: '7', shade_power: 2.0, convergence: 0.001 },
      },
      {
        id: 'output_3', type: 'output', position: { x: 660, y: 220 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'newton_2', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Lyapunov Fractal — Markus-Lyapunov style ──────────────────────────────
  colorRampDemo: {
    label: 'Color Ramp',
    counter: 4,
    nodes: [
      { id: 'cr_uv',   type: 'uv',   position: { x: 60, y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      {
        id: 'cr_cir', type: 'circleSDF', position: { x: 260, y: 180 },
        inputs: {
          position: { type: 'vec2',  label: 'Position', connection: { nodeId: 'cr_uv', outputKey: 'uv' } },
          radius:   { type: 'float', label: 'Radius' },
          offset:   { type: 'vec2',  label: 'Offset' },
        },
        outputs: { distance: { type: 'float', label: 'Distance' } },
        params: { radius: 0.35 },
      },
      {
        id: 'cr_rmp', type: 'remap', position: { x: 460, y: 180 },
        inputs: { value: { type: 'float', label: 'Value', connection: { nodeId: 'cr_cir', outputKey: 'distance' } } },
        outputs: { result: { type: 'float', label: 'Result' } },
        params: { inMin: -0.5, inMax: 0.1, outMin: 1.0, outMax: 0.0 },
      },
      {
        id: 'cr_ramp', type: 'colorRamp', position: { x: 660, y: 180 },
        inputs: { t: { type: 'float', label: 't (0-1)', connection: { nodeId: 'cr_rmp', outputKey: 'result' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: {
          numStops: 4,
          stops: [
            { t: 0.0,  r: 0.02, g: 0.02, b: 0.15 },
            { t: 0.33, r: 0.0,  g: 0.4,  b: 0.9  },
            { t: 0.66, r: 0.3,  g: 0.9,  b: 0.5  },
            { t: 1.0,  r: 1.0,  g: 1.0,  b: 0.8  },
          ],
        },
      },
      {
        id: 'cr_out', type: 'output', position: { x: 880, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'cr_ramp', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  blackbodyDemo: {
    label: 'Blackbody',
    counter: 4,
    nodes: [
      { id: 'bb_uv',  type: 'uv',   position: { x: 40, y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      {
        id: 'bb_cir', type: 'circleSDF', position: { x: 240, y: 180 },
        inputs: {
          position: { type: 'vec2',  label: 'Position', connection: { nodeId: 'bb_uv', outputKey: 'uv' } },
          radius:   { type: 'float', label: 'Radius' },
          offset:   { type: 'vec2',  label: 'Offset' },
        },
        outputs: { distance: { type: 'float', label: 'Distance' } },
        params: { radius: 0.4 },
      },
      {
        id: 'bb_rmp', type: 'remap', position: { x: 460, y: 180 },
        inputs: { value: { type: 'float', label: 'Value', connection: { nodeId: 'bb_cir', outputKey: 'distance' } } },
        outputs: { result: { type: 'float', label: 'Result' } },
        params: { inMin: -0.5, inMax: 0.0, outMin: 6500.0, outMax: 500.0 },
      },
      {
        id: 'bb_bb', type: 'blackbody', position: { x: 680, y: 180 },
        inputs: { kelvin: { type: 'float', label: 'Kelvin', connection: { nodeId: 'bb_rmp', outputKey: 'result' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: {},
      },
      {
        id: 'bb_out', type: 'output', position: { x: 880, y: 180 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'bb_bb', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  waveTextureDemo: {
    label: 'Wave Texture',
    counter: 5,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 60, y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 60, y: 360 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'wave_2', type: 'waveTexture', position: { x: 300, y: 200 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { value: { type: 'float', label: 'Value' } },
        params: { mode: 'rings', scale: 8.0, speed: 1.5, distortion: 0.3 },
      },
      {
        id: 'pal_3', type: 'palettePreset', position: { x: 500, y: 200 },
        inputs: { t: { type: 'float', label: 't', connection: { nodeId: 'wave_2', outputKey: 'value' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { preset: '1', scale: 1.0, offset: 0.0 },
      },
      {
        id: 'output_4', type: 'output', position: { x: 700, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'pal_3', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  magicTextureDemo: {
    label: 'Magic Texture',
    counter: 4,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 60, y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 60, y: 360 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'magic_2', type: 'magicTexture', position: { x: 300, y: 200 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { scale: 4.0, depth: 4, distortion: 1.0 },
      },
      {
        id: 'output_3', type: 'output', position: { x: 560, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'magic_2', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  gridDemo: {
    label: 'Grid / Checker',
    counter: 4,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 60, y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 60, y: 360 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'grid_2', type: 'grid', position: { x: 300, y: 180 },
        inputs: {
          uv:    { type: 'vec2',  label: 'UV',    connection: { nodeId: 'uv_0', outputKey: 'uv' } },
          scale: { type: 'float', label: 'Scale'  },
        },
        outputs: { grid: { type: 'float', label: 'Grid Lines' }, checker: { type: 'float', label: 'Checker' }, cellUV: { type: 'vec2', label: 'Cell UV' }, cellID: { type: 'vec2', label: 'Cell ID' } },
        params: { scale: 6.0, lineWidth: 0.04 },
      },
      {
        id: 'mix_3', type: 'mix', position: { x: 500, y: 200 },
        inputs: {
          a:   { type: 'float', label: 'A' },
          b:   { type: 'float', label: 'B' },
          t:   { type: 'float', label: 't', connection: { nodeId: 'grid_2', outputKey: 'checker' } },
        },
        outputs: { result: { type: 'float', label: 'Result' } },
        params: { a: 0.1, b: 0.9, t: 0.5 },
      },
      {
        id: 'add_g', type: 'add', position: { x: 500, y: 310 },
        inputs: {
          a: { type: 'float', label: 'A', connection: { nodeId: 'mix_3', outputKey: 'result' } },
          b: { type: 'float', label: 'B', connection: { nodeId: 'grid_2', outputKey: 'grid' } },
        },
        outputs: { result: { type: 'float', label: 'Result' } },
        params: { b: 0.0 },
      },
      {
        id: 'output_3', type: 'output', position: { x: 700, y: 240 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'add_g', outputKey: 'result' } as never } },
        outputs: {}, params: {},
      },
    ],
  },

  blendModesDemo: {
    label: 'Blend Modes — Screen',
    counter: 11,
    nodes: [
      { id: 'bm_uv',   type: 'uv',   position: { x: 40,  y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'bm_t',    type: 'time', position: { x: 40,  y: 450 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      // Base layer: circle A (left)
      {
        id: 'bm_cirA', type: 'circleSDF', position: { x: 240, y: 120 },
        inputs: {
          position: { type: 'vec2',  label: 'Position', connection: { nodeId: 'bm_uv', outputKey: 'uv' } },
          radius:   { type: 'float', label: 'Radius' },
          offset:   { type: 'vec2',  label: 'Offset' },
        },
        outputs: { distance: { type: 'float', label: 'Distance' } },
        params: { radius: 0.3, posX: -0.3, posY: 0.0 },
      },
      {
        id: 'bm_litA', type: 'makeLight', position: { x: 460, y: 120 },
        inputs: {
          distance:   { type: 'float', label: 'Distance',   connection: { nodeId: 'bm_cirA', outputKey: 'distance' } },
          brightness: { type: 'float', label: 'Brightness' },
        },
        outputs: { glow: { type: 'float', label: 'Glow' } },
        params: { brightness: 8.0 },
      },
      {
        id: 'bm_palA', type: 'palettePreset', position: { x: 680, y: 80 },
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'bm_t', outputKey: 'time' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { preset: '2' },
      },
      {
        id: 'bm_mulA', type: 'multiplyVec3', position: { x: 900, y: 100 },
        inputs: {
          color: { type: 'vec3',  label: 'Color', connection: { nodeId: 'bm_palA', outputKey: 'color' } },
          scale: { type: 'float', label: 'Scale', connection: { nodeId: 'bm_litA', outputKey: 'glow'  } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } },
        params: {},
      },
      // Blend layer: circle B (right)
      {
        id: 'bm_cirB', type: 'circleSDF', position: { x: 240, y: 360 },
        inputs: {
          position: { type: 'vec2',  label: 'Position', connection: { nodeId: 'bm_uv', outputKey: 'uv' } },
          radius:   { type: 'float', label: 'Radius' },
          offset:   { type: 'vec2',  label: 'Offset' },
        },
        outputs: { distance: { type: 'float', label: 'Distance' } },
        params: { radius: 0.3, posX: 0.3, posY: 0.0 },
      },
      {
        id: 'bm_litB', type: 'makeLight', position: { x: 460, y: 360 },
        inputs: {
          distance:   { type: 'float', label: 'Distance',   connection: { nodeId: 'bm_cirB', outputKey: 'distance' } },
          brightness: { type: 'float', label: 'Brightness' },
        },
        outputs: { glow: { type: 'float', label: 'Glow' } },
        params: { brightness: 8.0 },
      },
      {
        id: 'bm_palB', type: 'palettePreset', position: { x: 680, y: 400 },
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'bm_t', outputKey: 'time' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { preset: '5' },
      },
      {
        id: 'bm_mulB', type: 'multiplyVec3', position: { x: 900, y: 380 },
        inputs: {
          color: { type: 'vec3',  label: 'Color', connection: { nodeId: 'bm_palB', outputKey: 'color' } },
          scale: { type: 'float', label: 'Scale', connection: { nodeId: 'bm_litB', outputKey: 'glow'  } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } },
        params: {},
      },
      // Blend A + B with screen mode
      {
        id: 'bm_blend', type: 'blendModes', position: { x: 1120, y: 240 },
        inputs: {
          base:    { type: 'vec3',  label: 'Base',    connection: { nodeId: 'bm_mulA', outputKey: 'result' } },
          blend:   { type: 'vec3',  label: 'Blend',   connection: { nodeId: 'bm_mulB', outputKey: 'result' } },
          opacity: { type: 'float', label: 'Opacity' },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } },
        params: { mode: 'screen', opacity: 1.0 },
      },
      {
        id: 'bm_out', type: 'output', position: { x: 1340, y: 240 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'bm_blend', outputKey: 'result' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Color Ramp: FBM Landscape Colors ─────────────────────────────────────────
  colorRampFBM: {
    label: 'Color Ramp: FBM Terrain',
    counter: 6,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 60, y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 60, y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'fbm_2', type: 'fbm', position: { x: 260, y: 230 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { value: { type: 'float', label: 'Value' } },
        params: { octaves: 6, lacunarity: 2.0, gain: 0.5, scale: 3.0, time_scale: 0.05 },
      },
      {
        id: 'ramp_3', type: 'colorRamp', position: { x: 480, y: 200 },
        inputs: { t: { type: 'float', label: 't', connection: { nodeId: 'fbm_2', outputKey: 'value' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: {
          numStops: 5,
          stops: [
            { t: 0.0,  r: 0.05, g: 0.10, b: 0.35 },  // deep water
            { t: 0.30, r: 0.15, g: 0.45, b: 0.55 },  // shallow water
            { t: 0.45, r: 0.80, g: 0.75, b: 0.50 },  // beach sand
            { t: 0.60, r: 0.20, g: 0.55, b: 0.15 },  // grass
            { t: 1.0,  r: 0.90, g: 0.90, b: 0.95 },  // snow peak
          ],
        },
      },
      {
        id: 'output_4', type: 'output', position: { x: 720, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'ramp_3', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Color Ramp: Wave Interference ─────────────────────────────────────────────
  colorRampWave: {
    label: 'Color Ramp: Wave Rings',
    counter: 6,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 60, y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 60, y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'wave_2', type: 'waveTexture', position: { x: 270, y: 230 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { value: { type: 'float', label: 'Value' } },
        params: { mode: 'rings', scale: 6.0, distortion: 0.5, detail: 4.0, time_scale: 0.3 },
      },
      {
        id: 'ramp_3', type: 'colorRamp', position: { x: 500, y: 200 },
        inputs: { t: { type: 'float', label: 't', connection: { nodeId: 'wave_2', outputKey: 'value' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: {
          numStops: 4,
          stops: [
            { t: 0.0,  r: 0.0,  g: 0.0,  b: 0.15 },
            { t: 0.35, r: 0.0,  g: 0.6,  b: 0.9  },
            { t: 0.65, r: 1.0,  g: 0.9,  b: 0.2  },
            { t: 1.0,  r: 1.0,  g: 1.0,  b: 1.0  },
          ],
        },
      },
      {
        id: 'output_4', type: 'output', position: { x: 740, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'ramp_3', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Blackbody: Fire ────────────────────────────────────────────────────────────
  blackbodyStar: {
    label: 'Blackbody: Star Spectrum',
    counter: 7,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 60, y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      // Extract X coordinate (0–1 horizontal sweep)
      {
        id: 'ex_1', type: 'extractX', position: { x: 260, y: 200 },
        inputs: { input: { type: 'vec2', label: 'Input', connection: { nodeId: 'uv_0', outputKey: 'uv' } } },
        outputs: { x: { type: 'float', label: 'X' } },
        params: {},
      },
      // Remap X (0–1) → temperature (1000 K = red M-star → 30000 K = blue O-star)
      {
        id: 'remap_2', type: 'remap', position: { x: 460, y: 200 },
        inputs: { value: { type: 'float', label: 'Value', connection: { nodeId: 'ex_1', outputKey: 'x' } } },
        outputs: { result: { type: 'float', label: 'Result' } },
        params: { inMin: 0.0, inMax: 1.0, outMin: 1000.0, outMax: 30000.0 },
      },
      // Blackbody color
      {
        id: 'bb_3', type: 'blackbody', position: { x: 660, y: 200 },
        inputs: { kelvin: { type: 'float', label: 'Kelvin', connection: { nodeId: 'remap_2', outputKey: 'result' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: {},
      },
      // Extract Y for vertical vignette (to make a thin strip)
      {
        id: 'ey_4', type: 'extractY', position: { x: 260, y: 360 },
        inputs: { input: { type: 'vec2', label: 'Input', connection: { nodeId: 'uv_0', outputKey: 'uv' } } },
        outputs: { y: { type: 'float', label: 'Y' } },
        params: {},
      },
      // Absolute Y → nearness to center line
      {
        id: 'abs_5', type: 'abs', position: { x: 460, y: 360 },
        inputs: { input: { type: 'float', label: 'Input', connection: { nodeId: 'ey_4', outputKey: 'y' } } },
        outputs: { output: { type: 'float', label: 'Output' } },
        params: {},
      },
      // 1 - abs(y)*3 as band mask
      {
        id: 'sm_6', type: 'smoothstep', position: { x: 660, y: 360 },
        inputs: { t: { type: 'float', label: 't', connection: { nodeId: 'abs_5', outputKey: 'output' } } },
        outputs: { result: { type: 'float', label: 'Result' } },
        params: { edge0: 0.3, edge1: 0.0 },
      },
      // Multiply color by band mask
      {
        id: 'mul_7', type: 'multiplyVec3', position: { x: 860, y: 200 },
        inputs: {
          color:  { type: 'vec3',  label: 'Color',  connection: { nodeId: 'bb_3',  outputKey: 'color'  } },
          scalar: { type: 'float', label: 'Scalar', connection: { nodeId: 'sm_6',  outputKey: 'result' } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } },
        params: {},
      },
      {
        id: 'output_8', type: 'output', position: { x: 1060, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'mul_7', outputKey: 'result' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Wave Texture: Interference ────────────────────────────────────────────────
  waveInterference: {
    label: 'Wave Interference',
    counter: 7,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 60, y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 60, y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      // First wave: concentric rings
      {
        id: 'wA_2', type: 'waveTexture', position: { x: 280, y: 160 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { value: { type: 'float', label: 'Value' } },
        params: { mode: 'rings', scale: 8.0, distortion: 0.2, detail: 2.0, time_scale: 0.5 },
      },
      // Second wave: diagonal bands (offset frequency)
      {
        id: 'wB_3', type: 'waveTexture', position: { x: 280, y: 360 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { value: { type: 'float', label: 'Value' } },
        params: { mode: 'diagonal', scale: 10.0, distortion: 0.15, detail: 2.0, time_scale: -0.4 },
      },
      // Multiply: constructive/destructive interference
      {
        id: 'mul_4', type: 'multiply', position: { x: 500, y: 260 },
        inputs: {
          a: { type: 'float', label: 'A', connection: { nodeId: 'wA_2', outputKey: 'value' } },
          b: { type: 'float', label: 'B', connection: { nodeId: 'wB_3', outputKey: 'value' } },
        },
        outputs: { result: { type: 'float', label: 'Result' } },
        params: {},
      },
      // Colorize
      {
        id: 'pal_5', type: 'palettePreset', position: { x: 700, y: 260 },
        inputs: { t: { type: 'float', label: 't', connection: { nodeId: 'mul_4', outputKey: 'result' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { preset: '4', scale: 1.0, offset: 0.0 },
      },
      {
        id: 'output_6', type: 'output', position: { x: 920, y: 260 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'pal_5', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Wave Texture: Bands ────────────────────────────────────────────────────────
  waveBands: {
    label: 'Wave Bands',
    counter: 5,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 60, y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 60, y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'wave_2', type: 'waveTexture', position: { x: 280, y: 230 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { value: { type: 'float', label: 'Value' } },
        params: { mode: 'bands', scale: 5.0, distortion: 1.2, detail: 3.0, time_scale: 0.6 },
      },
      {
        id: 'pal_3', type: 'palettePreset', position: { x: 500, y: 230 },
        inputs: { t: { type: 'float', label: 't', connection: { nodeId: 'wave_2', outputKey: 'value' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { preset: '6', scale: 1.2, offset: 0.2 },
      },
      {
        id: 'output_4', type: 'output', position: { x: 720, y: 230 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'pal_3', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Grid: Cell Pattern ────────────────────────────────────────────────────────
  gridCellPattern: {
    label: 'Grid: Cell UV Pattern',
    counter: 7,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 60, y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 60, y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      // Grid node: gives us cellUV (vec2 position within cell) + grid (float border)
      {
        id: 'grid_2', type: 'grid', position: { x: 280, y: 200 },
        inputs: { uv: { type: 'vec2', label: 'UV', connection: { nodeId: 'uv_0', outputKey: 'uv' } } },
        outputs: {
          grid:    { type: 'float', label: 'Grid'    },
          checker: { type: 'float', label: 'Checker' },
          cellUV:  { type: 'vec2',  label: 'Cell UV' },
          cellID:  { type: 'vec2',  label: 'Cell ID' },
        },
        params: { scale: 6.0, lineWidth: 0.03 },
      },
      // Length of cellUV (distance from cell corner)
      {
        id: 'len_3', type: 'length', position: { x: 500, y: 240 },
        inputs: { input: { type: 'vec2', label: 'Input', connection: { nodeId: 'grid_2', outputKey: 'cellUV' } } },
        outputs: { output: { type: 'float', label: 'Output' } },
        params: { scale: 1.0 },
      },
      // Animate with time
      {
        id: 'add_4', type: 'add', position: { x: 700, y: 260 },
        inputs: {
          a: { type: 'float', label: 'A', connection: { nodeId: 'len_3',  outputKey: 'output' } },
          b: { type: 'float', label: 'B', connection: { nodeId: 'time_1', outputKey: 'time'   } },
        },
        outputs: { result: { type: 'float', label: 'Result' } },
        params: { b: 0.0 },
      },
      // Colorize
      {
        id: 'pal_5', type: 'palettePreset', position: { x: 900, y: 230 },
        inputs: { t: { type: 'float', label: 't', connection: { nodeId: 'add_4', outputKey: 'result' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { preset: '3', scale: 1.0, offset: 0.0 },
      },
      // Darken grid lines
      {
        id: 'mul_6', type: 'multiplyVec3', position: { x: 1100, y: 200 },
        inputs: {
          color:  { type: 'vec3',  label: 'Color',  connection: { nodeId: 'pal_5',  outputKey: 'color'  } },
          scalar: { type: 'float', label: 'Scalar', connection: { nodeId: 'grid_2', outputKey: 'grid'   } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } },
        params: {},
      },
      {
        id: 'output_7', type: 'output', position: { x: 1300, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'mul_6', outputKey: 'result' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Grid: Checker Animation ────────────────────────────────────────────────────
  gridChecker: {
    label: 'Grid: Checker',
    counter: 5,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 60, y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 60, y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'grid_2', type: 'grid', position: { x: 280, y: 200 },
        inputs: { uv: { type: 'vec2', label: 'UV', connection: { nodeId: 'uv_0', outputKey: 'uv' } } },
        outputs: {
          grid:    { type: 'float', label: 'Grid'    },
          checker: { type: 'float', label: 'Checker' },
          cellUV:  { type: 'vec2',  label: 'Cell UV' },
          cellID:  { type: 'vec2',  label: 'Cell ID' },
        },
        params: { scale: 8.0, lineWidth: 0.02 },
      },
      // Mix two palette colors using the checker output
      {
        id: 'pal_a', type: 'palettePreset', position: { x: 480, y: 140 },
        inputs: { t: { type: 'float', label: 't', connection: { nodeId: 'time_1', outputKey: 'time' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { preset: '2', scale: 0.1, offset: 0.0 },
      },
      {
        id: 'pal_b', type: 'palettePreset', position: { x: 480, y: 360 },
        inputs: { t: { type: 'float', label: 't', connection: { nodeId: 'time_1', outputKey: 'time' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { preset: '5', scale: 0.1, offset: 0.5 },
      },
      {
        id: 'mix_3', type: 'mixVec3', position: { x: 700, y: 230 },
        inputs: {
          a:   { type: 'vec3',  label: 'A',   connection: { nodeId: 'pal_a',  outputKey: 'color'   } },
          b:   { type: 'vec3',  label: 'B',   connection: { nodeId: 'pal_b',  outputKey: 'color'   } },
          fac: { type: 'float', label: 'Fac', connection: { nodeId: 'grid_2', outputKey: 'checker' } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } },
        params: {},
      },
      {
        id: 'output_4', type: 'output', position: { x: 920, y: 230 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'mix_3', outputKey: 'result' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Grid: Magic Cells ─────────────────────────────────────────────────────────
  gridMagic: {
    label: 'Grid: Magic Cells',
    counter: 5,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 60, y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 60, y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      // Grid to get cell UV
      {
        id: 'grid_2', type: 'grid', position: { x: 280, y: 200 },
        inputs: { uv: { type: 'vec2', label: 'UV', connection: { nodeId: 'uv_0', outputKey: 'uv' } } },
        outputs: {
          grid:    { type: 'float', label: 'Grid'    },
          checker: { type: 'float', label: 'Checker' },
          cellUV:  { type: 'vec2',  label: 'Cell UV' },
          cellID:  { type: 'vec2',  label: 'Cell ID' },
        },
        params: { scale: 4.0, lineWidth: 0.04 },
      },
      // Magic texture on per-cell UV
      {
        id: 'magic_3', type: 'magicTexture', position: { x: 500, y: 200 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'grid_2', outputKey: 'cellUV' } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time'   } },
        },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { scale: 2.0, depth: 3, time_scale: 0.2 },
      },
      // Darken grid lines
      {
        id: 'mul_4', type: 'multiplyVec3', position: { x: 720, y: 200 },
        inputs: {
          color:  { type: 'vec3',  label: 'Color',  connection: { nodeId: 'magic_3', outputKey: 'color' } },
          scalar: { type: 'float', label: 'Scalar', connection: { nodeId: 'grid_2',  outputKey: 'grid'  } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } },
        params: {},
      },
      {
        id: 'output_5', type: 'output', position: { x: 940, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'mul_4', outputKey: 'result' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Blend Modes: Overlay Glow ─────────────────────────────────────────────────
  sobelGlow: {
    label: 'Sobel: Edge Glow',
    counter: 8,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 60, y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 60, y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      // FBM as source
      {
        id: 'fbm_2', type: 'fbm', position: { x: 260, y: 230 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { value: { type: 'float', label: 'Value' } },
        params: { octaves: 5, scale: 3.5, gain: 0.5, lacunarity: 2.0, time_scale: 0.15 },
      },
      // Convert to color for Sobel input
      {
        id: 'fv3_3', type: 'floatToVec3', position: { x: 470, y: 230 },
        inputs: { input: { type: 'float', label: 'Input', connection: { nodeId: 'fbm_2', outputKey: 'value' } } },
        outputs: { output: { type: 'vec3', label: 'Output' } },
        params: {},
      },
      // Sobel edge detection
      {
        id: 'sob_4', type: 'sobel', position: { x: 680, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'fv3_3', outputKey: 'output' } } },
        outputs: { edges: { type: 'float', label: 'Edges' }, result: { type: 'vec3', label: 'Result' } },
        params: { strength: 3.0 },
      },
      // Colorize edges with a hot palette
      {
        id: 'pal_5', type: 'palettePreset', position: { x: 880, y: 240 },
        inputs: { t: { type: 'float', label: 't', connection: { nodeId: 'sob_4', outputKey: 'edges' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { preset: '2', scale: 2.0, offset: 0.0 },
      },
      // Blend edges over original
      {
        id: 'mix_6', type: 'mixVec3', position: { x: 1080, y: 200 },
        inputs: {
          a:   { type: 'vec3',  label: 'A (original)', connection: { nodeId: 'fv3_3', outputKey: 'output' } },
          b:   { type: 'vec3',  label: 'B (edges)',    connection: { nodeId: 'pal_5', outputKey: 'color'  } },
          fac: { type: 'float', label: 'Fac',          connection: { nodeId: 'sob_4', outputKey: 'edges'  } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } },
        params: {},
      },
      {
        id: 'output_7', type: 'output', position: { x: 1280, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'mix_6', outputKey: 'result' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Complex Power: Flower Fractal ──────────────────────────────────────────────
  complexPowFlower: {
    label: 'Complex Power Flower',
    counter: 6,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 60, y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 60, y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      // Scale UV for zoom
      {
        id: 'mul_2', type: 'multiplyVec2', position: { x: 260, y: 200 },
        inputs: { vec: { type: 'vec2', label: 'Vec', connection: { nodeId: 'uv_0', outputKey: 'uv' } } },
        outputs: { result: { type: 'vec2', label: 'Result' } },
        params: { scale: 1.8 },
      },
      // Animate power with time
      {
        id: 'add_t', type: 'add', position: { x: 260, y: 360 },
        inputs: { a: { type: 'float', label: 'A', connection: { nodeId: 'time_1', outputKey: 'time' } } },
        outputs: { result: { type: 'float', label: 'Result' } },
        params: { b: 3.0 },
      },
      // Complex power: z^n
      {
        id: 'cpow_3', type: 'complexPow', position: { x: 480, y: 230 },
        inputs: {
          z: { type: 'vec2',  label: 'z', connection: { nodeId: 'mul_2', outputKey: 'result' } },
          n: { type: 'float', label: 'n', connection: { nodeId: 'add_t', outputKey: 'result' } },
        },
        outputs: { result: { type: 'vec2', label: 'Result' } },
        params: { n: 3.0 },
      },
      // Length of result
      {
        id: 'len_4', type: 'length', position: { x: 700, y: 230 },
        inputs: { input: { type: 'vec2', label: 'Input', connection: { nodeId: 'cpow_3', outputKey: 'result' } } },
        outputs: { output: { type: 'float', label: 'Output' } },
        params: { scale: 1.0 },
      },
      // Fract for repeated rings
      {
        id: 'fract_5', type: 'fractRaw', position: { x: 880, y: 230 },
        inputs: { input: { type: 'float', label: 'Input', connection: { nodeId: 'len_4', outputKey: 'output' } } },
        outputs: { output: { type: 'float', label: 'Output' } },
        params: {},
      },
      {
        id: 'pal_6', type: 'palettePreset', position: { x: 1060, y: 200 },
        inputs: { t: { type: 'float', label: 't', connection: { nodeId: 'fract_5', outputKey: 'output' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { preset: '4', scale: 1.0, offset: 0.0 },
      },
      {
        id: 'output_7', type: 'output', position: { x: 1280, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'pal_6', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Luminance: Greyscale & Tint ────────────────────────────────────────────────
  luminanceTint: {
    label: 'Luminance: Grey & Tint',
    counter: 6,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 60, y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 60, y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'fbm_2', type: 'fbm', position: { x: 260, y: 200 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { value: { type: 'float', label: 'Value' } },
        params: { octaves: 4, scale: 3.0, gain: 0.5, lacunarity: 2.0, time_scale: 0.2 },
      },
      {
        id: 'pal_3', type: 'palettePreset', position: { x: 470, y: 200 },
        inputs: { t: { type: 'float', label: 't', connection: { nodeId: 'fbm_2', outputKey: 'value' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { preset: '2', scale: 1.0, offset: 0.0 },
      },
      // Extract luminance (grey value)
      {
        id: 'lum_4', type: 'luminance', position: { x: 680, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'pal_3', outputKey: 'color' } } },
        outputs: { luma: { type: 'float', label: 'Luma' } },
        params: {},
      },
      // Re-colorize with a warm palette using luma as t
      {
        id: 'pal_5', type: 'palettePreset', position: { x: 880, y: 200 },
        inputs: { t: { type: 'float', label: 't', connection: { nodeId: 'lum_4', outputKey: 'luma' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { preset: '8', scale: 1.0, offset: 0.0 },
      },
      {
        id: 'output_6', type: 'output', position: { x: 1080, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'pal_5', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── 3D: Sphere ────────────────────────────────────────────────────────────────
  sphereScene3D: {
    label: '3D: Sphere',
    counter: 5,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 60, y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 60, y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'scene_2', type: 'sceneGroup', position: { x: 300, y: 230 },
        inputs: {},
        outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: 'Sphere Scene',
          subgraph: {
            nodes: [
              {
                id: 'sp_sg', type: 'scenePos', position: { x: 100, y: 150 },
                inputs: {},
                outputs: { pos: { type: 'vec3', label: 'Position' } },
                params: {},
              },
              {
                id: 'sdf_sg', type: 'sphereSDF3D', position: { x: 300, y: 150 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp_sg', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } },
                params: { radius: 0.7 },
              },
            ],
            outputNodeId: 'sdf_sg',
            outputKey: 'dist',
          },
        },
      },
      {
        id: 'ray_3', type: 'rayMarch', position: { x: 560, y: 180 },
        inputs: {
          scene: { type: 'scene3d', label: 'Scene', connection: { nodeId: 'scene_2', outputKey: 'scene' } },
          uv:    { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time:  { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { color: { type: 'vec3', label: 'Color' }, depth: { type: 'float', label: 'Depth' }, normal: { type: 'vec3', label: 'Normal' } },
        params: { camDist: 3.0, fov: 1.5, maxSteps: 64, maxDist: 20.0, lightX: 1.5, lightY: 2.5, lightZ: 3.0, bgR: 0.05, bgG: 0.05, bgB: 0.10, albedoR: 0.4, albedoG: 0.6, albedoB: 1.0 },
      },
      {
        id: 'output_4', type: 'output', position: { x: 820, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'ray_3', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── 3D: Torus ─────────────────────────────────────────────────────────────────
  torusScene3D: {
    label: '3D: Torus',
    counter: 5,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 60, y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 60, y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'scene_2', type: 'sceneGroup', position: { x: 300, y: 230 },
        inputs: {},
        outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: 'Torus Scene',
          subgraph: {
            nodes: [
              {
                id: 'sp_sg', type: 'scenePos', position: { x: 60, y: 150 },
                inputs: {},
                outputs: { pos: { type: 'vec3', label: 'Position' } },
                params: {},
              },
              {
                id: 'time_sg', type: 'time', position: { x: 60, y: 280 },
                inputs: {},
                outputs: { time: { type: 'float', label: 'Time' } },
                params: {},
              },
              // Rotate around Y axis with time
              {
                id: 'rot_sg', type: 'rotate3D', position: { x: 240, y: 200 },
                inputs: {
                  pos:   { type: 'vec3',  label: 'Position', connection: { nodeId: 'sp_sg',   outputKey: 'pos'  } },
                  angle: { type: 'float', label: 'Angle',    connection: { nodeId: 'time_sg', outputKey: 'time' } },
                },
                outputs: { pos: { type: 'vec3', label: 'Rotated Pos' } },
                params: { axis: 'y', angle: 0.0 },
              },
              {
                id: 'torus_sg', type: 'torusSDF3D', position: { x: 440, y: 200 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'rot_sg', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } },
                params: { majorR: 0.55, minorR: 0.22 },
              },
            ],
            outputNodeId: 'torus_sg',
            outputKey: 'dist',
          },
        },
      },
      {
        id: 'ray_3', type: 'rayMarch', position: { x: 560, y: 180 },
        inputs: {
          scene: { type: 'scene3d', label: 'Scene', connection: { nodeId: 'scene_2', outputKey: 'scene' } },
          uv:    { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time:  { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { color: { type: 'vec3', label: 'Color' }, depth: { type: 'float', label: 'Depth' }, normal: { type: 'vec3', label: 'Normal' } },
        params: { camDist: 3.5, fov: 1.5, maxSteps: 80, maxDist: 20.0, lightX: 2.0, lightY: 3.0, lightZ: 2.0, bgR: 0.02, bgG: 0.02, bgB: 0.06, albedoR: 0.9, albedoG: 0.5, albedoB: 0.2 },
      },
      {
        id: 'output_4', type: 'output', position: { x: 820, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'ray_3', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── 3D: Two Shapes (Sphere + Box) ─────────────────────────────────────────────
  twoShapes3D: {
    label: '3D: Sphere + Box',
    counter: 5,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 60, y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 60, y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'scene_2', type: 'sceneGroup', position: { x: 300, y: 230 },
        inputs: {},
        outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: 'Two Shapes',
          subgraph: {
            nodes: [
              {
                id: 'sp_sg', type: 'scenePos', position: { x: 60, y: 180 },
                inputs: {},
                outputs: { pos: { type: 'vec3', label: 'Position' } },
                params: {},
              },
              // Translate left for sphere
              {
                id: 'trA_sg', type: 'translate3D', position: { x: 240, y: 100 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp_sg', outputKey: 'pos' } } },
                outputs: { pos: { type: 'vec3', label: 'Translated Pos' } },
                params: { tx: -0.55, ty: 0.0, tz: 0.0 },
              },
              // Sphere on the left
              {
                id: 'sphA_sg', type: 'sphereSDF3D', position: { x: 420, y: 100 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'trA_sg', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } },
                params: { radius: 0.4 },
              },
              // Translate right for box
              {
                id: 'trB_sg', type: 'translate3D', position: { x: 240, y: 280 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp_sg', outputKey: 'pos' } } },
                outputs: { pos: { type: 'vec3', label: 'Translated Pos' } },
                params: { tx: 0.55, ty: 0.0, tz: 0.0 },
              },
              // Box on the right
              {
                id: 'boxB_sg', type: 'boxSDF3D', position: { x: 420, y: 280 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'trB_sg', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } },
                params: { sizeX: 0.35, sizeY: 0.35, sizeZ: 0.35 },
              },
              // Union: take the minimum distance
              {
                id: 'minD_sg', type: 'minMath', position: { x: 620, y: 190 },
                inputs: {
                  a: { type: 'float', label: 'A', connection: { nodeId: 'sphA_sg', outputKey: 'dist' } },
                  b: { type: 'float', label: 'B', connection: { nodeId: 'boxB_sg', outputKey: 'dist' } },
                },
                outputs: { result: { type: 'float', label: 'Result' } },
                params: {},
              },
            ],
            outputNodeId: 'minD_sg',
            outputKey: 'result',
          },
        },
      },
      {
        id: 'ray_3', type: 'rayMarch', position: { x: 560, y: 180 },
        inputs: {
          scene: { type: 'scene3d', label: 'Scene', connection: { nodeId: 'scene_2', outputKey: 'scene' } },
          uv:    { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time:  { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { color: { type: 'vec3', label: 'Color' }, depth: { type: 'float', label: 'Depth' }, normal: { type: 'vec3', label: 'Normal' } },
        params: { camDist: 3.5, fov: 1.5, maxSteps: 80, maxDist: 20.0, lightX: 2.0, lightY: 3.0, lightZ: 3.0, bgR: 0.03, bgG: 0.03, bgB: 0.06, albedoR: 0.7, albedoG: 0.8, albedoB: 0.9 },
      },
      {
        id: 'output_4', type: 'output', position: { x: 820, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'ray_3', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── 3D: Infinite Boxes (domain repeat) ────────────────────────────────────────
  infiniteBoxes3D: {
    label: '3D: Infinite Boxes',
    counter: 5,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 60, y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 60, y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'scene_2', type: 'sceneGroup', position: { x: 300, y: 230 },
        inputs: {},
        outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: 'Infinite Boxes',
          subgraph: {
            nodes: [
              {
                id: 'sp_sg', type: 'scenePos', position: { x: 60, y: 180 },
                inputs: {},
                outputs: { pos: { type: 'vec3', label: 'Position' } },
                params: {},
              },
              {
                id: 'time_sg', type: 'time', position: { x: 60, y: 300 },
                inputs: {},
                outputs: { time: { type: 'float', label: 'Time' } },
                params: {},
              },
              // Rotate camera-relative by time for interesting view
              {
                id: 'rot_sg', type: 'rotate3D', position: { x: 240, y: 180 },
                inputs: {
                  pos:   { type: 'vec3',  label: 'Position', connection: { nodeId: 'sp_sg',   outputKey: 'pos'  } },
                  angle: { type: 'float', label: 'Angle',    connection: { nodeId: 'time_sg', outputKey: 'time' } },
                },
                outputs: { pos: { type: 'vec3', label: 'Rotated Pos' } },
                params: { axis: 'y', angle: 0.0 },
              },
              // Repeat space with cell size 1.4
              {
                id: 'rep_sg', type: 'repeat3D', position: { x: 440, y: 180 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'rot_sg', outputKey: 'pos' } } },
                outputs: { pos: { type: 'vec3', label: 'Repeated Pos' } },
                params: { cellX: 1.4, cellY: 1.4, cellZ: 1.4 },
              },
              // Small box inside each repeated cell
              {
                id: 'box_sg', type: 'boxSDF3D', position: { x: 640, y: 180 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'rep_sg', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } },
                params: { sizeX: 0.4, sizeY: 0.4, sizeZ: 0.4 },
              },
            ],
            outputNodeId: 'box_sg',
            outputKey: 'dist',
          },
        },
      },
      {
        id: 'ray_3', type: 'rayMarch', position: { x: 560, y: 180 },
        inputs: {
          scene: { type: 'scene3d', label: 'Scene', connection: { nodeId: 'scene_2', outputKey: 'scene' } },
          uv:    { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time:  { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { color: { type: 'vec3', label: 'Color' }, depth: { type: 'float', label: 'Depth' }, normal: { type: 'vec3', label: 'Normal' } },
        params: { camDist: 5.0, fov: 1.5, maxSteps: 96, maxDist: 30.0, lightX: 2.0, lightY: 4.0, lightZ: 3.0, bgR: 0.02, bgG: 0.02, bgB: 0.05, albedoR: 0.5, albedoG: 0.8, albedoB: 0.7 },
      },
      {
        id: 'output_4', type: 'output', position: { x: 820, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'ray_3', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── 3D: Hello Sphere ─────────────────────────────────────────────────────────
  helloSphere3D: {
    label: '3D: Hello Sphere',
    counter: 4,
    nodes: [
      { id: 'ha_uv',   type: 'uv',   position: { x: 50, y: 80  }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'ha_time', type: 'time', position: { x: 50, y: 180 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'ha_scene', type: 'sceneGroup', position: { x: 300, y: 120 },
        inputs: {},
        outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: 'Hello Sphere',
          subgraph: {
            nodes: [
              {
                id: 'ha_sp', type: 'scenePos', position: { x: 80, y: 150 },
                inputs: {},
                outputs: { pos: { type: 'vec3', label: 'Position' } },
                params: {},
              },
              {
                id: 'ha_sdf', type: 'sphereSDF3D', position: { x: 280, y: 150 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'ha_sp', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } },
                params: { radius: 0.5 },
              },
            ],
            outputNodeId: 'ha_sdf',
            outputKey: 'dist',
          },
        },
      },
      {
        id: 'ha_ray', type: 'rayMarch', position: { x: 560, y: 80 },
        inputs: {
          scene: { type: 'scene3d', label: 'Scene', connection: { nodeId: 'ha_scene', outputKey: 'scene' } },
          uv:    { type: 'vec2',   label: 'UV',    connection: { nodeId: 'ha_uv',    outputKey: 'uv'   } },
          time:  { type: 'float',  label: 'Time',  connection: { nodeId: 'ha_time',  outputKey: 'time' } },
        },
        outputs: { color: { type: 'vec3', label: 'Color' }, depth: { type: 'float', label: 'Depth' }, normal: { type: 'vec3', label: 'Normal' }, iter: { type: 'float', label: 'Iter Count' } },
        params: { camDist: 2.5, camAngle: 0.5, camRotSpeed: 0.0, fov: 1.5, maxSteps: 64, maxDist: 20.0, lightX: 1.0, lightY: 2.5, lightZ: 2.0, bgR: 0.65, bgG: 0.75, bgB: 0.85, albedoR: 0.5, albedoG: 0.5, albedoB: 0.55 },
      },
      {
        id: 'ha_out', type: 'output', position: { x: 860, y: 140 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'ha_ray', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── 3D: Shapes + Ground ───────────────────────────────────────────────────────
  shapesAndGround3D: {
    label: '3D: Shapes + Ground',
    counter: 5,
    nodes: [
      { id: 'hb_uv',   type: 'uv',   position: { x: 50, y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'hb_time', type: 'time', position: { x: 50, y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'hb_scene', type: 'sceneGroup', position: { x: 300, y: 230 },
        inputs: {},
        outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: 'Shapes + Ground',
          subgraph: {
            nodes: [
              {
                id: 'hb_sp', type: 'scenePos', position: { x: 60, y: 200 },
                inputs: {},
                outputs: { pos: { type: 'vec3', label: 'Position' } },
                params: {},
              },
              // Sphere translated left
              {
                id: 'hb_trS', type: 'translate3D', position: { x: 240, y: 100 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'hb_sp', outputKey: 'pos' } } },
                outputs: { pos: { type: 'vec3', label: 'Translated Pos' } },
                params: { tx: -0.5, ty: 0.0, tz: 0.0 },
              },
              {
                id: 'hb_sph', type: 'sphereSDF3D', position: { x: 430, y: 100 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'hb_trS', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } },
                params: { radius: 0.35 },
              },
              // Box translated right
              {
                id: 'hb_trB', type: 'translate3D', position: { x: 240, y: 280 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'hb_sp', outputKey: 'pos' } } },
                outputs: { pos: { type: 'vec3', label: 'Translated Pos' } },
                params: { tx: 0.5, ty: 0.0, tz: 0.0 },
              },
              {
                id: 'hb_box', type: 'boxSDF3D', position: { x: 430, y: 280 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'hb_trB', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } },
                params: { sizeX: 0.3, sizeY: 0.3, sizeZ: 0.3 },
              },
              // Ground plane
              {
                id: 'hb_gnd', type: 'planeSDF3D', position: { x: 240, y: 440 },
                inputs: { p: { type: 'vec3', label: 'Position', connection: { nodeId: 'hb_sp', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } },
                params: { height: -0.5 },
              },
              // Smooth min: sphere + box
              {
                id: 'hb_sm1', type: 'smoothMin', position: { x: 620, y: 180 },
                inputs: {
                  a: { type: 'float', label: 'A', connection: { nodeId: 'hb_sph', outputKey: 'dist' } },
                  b: { type: 'float', label: 'B', connection: { nodeId: 'hb_box', outputKey: 'dist' } },
                },
                outputs: { result: { type: 'float', label: 'Result' } },
                params: { k: 0.2 },
              },
              // Min with ground
              {
                id: 'hb_mn2', type: 'minMath', position: { x: 800, y: 310 },
                inputs: {
                  a: { type: 'float', label: 'A', connection: { nodeId: 'hb_sm1', outputKey: 'result' } },
                  b: { type: 'float', label: 'B', connection: { nodeId: 'hb_gnd', outputKey: 'dist'   } },
                },
                outputs: { result: { type: 'float', label: 'Result' } },
                params: {},
              },
            ],
            outputNodeId: 'hb_mn2',
            outputKey: 'result',
          },
        },
      },
      {
        id: 'hb_ray', type: 'rayMarch', position: { x: 560, y: 180 },
        inputs: {
          scene: { type: 'scene3d', label: 'Scene', connection: { nodeId: 'hb_scene', outputKey: 'scene' } },
          uv:    { type: 'vec2',   label: 'UV',    connection: { nodeId: 'hb_uv',    outputKey: 'uv'   } },
          time:  { type: 'float',  label: 'Time',  connection: { nodeId: 'hb_time',  outputKey: 'time' } },
        },
        outputs: { color: { type: 'vec3', label: 'Color' }, depth: { type: 'float', label: 'Depth' }, normal: { type: 'vec3', label: 'Normal' }, iter: { type: 'float', label: 'Iter Count' } },
        params: { camDist: 3.5, camAngle: 0.6, camRotSpeed: 0.0, fov: 1.5, maxSteps: 80, maxDist: 20.0, lightX: 1.5, lightY: 2.5, lightZ: 2.0, bgR: 0.65, bgG: 0.75, bgB: 0.85, albedoR: 0.5, albedoG: 0.5, albedoB: 0.55 },
      },
      {
        id: 'hb_out', type: 'output', position: { x: 820, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'hb_ray', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── 3D: Infinite Falling ──────────────────────────────────────────────────────
  infiniteFalling3D: {
    label: '3D: Infinite Falling',
    counter: 9,
    nodes: [
      { id: 'hc_uv',   type: 'uv',   position: { x: 50, y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'hc_time', type: 'time', position: { x: 50, y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'hc_scene', type: 'sceneGroup', position: { x: 300, y: 230 },
        inputs: {},
        outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: 'Infinite Falling',
          subgraph: {
            nodes: [
              {
                id: 'hc_sp', type: 'scenePos', position: { x: 60, y: 180 },
                inputs: {},
                outputs: { pos: { type: 'vec3', label: 'Position' } },
                params: {},
              },
              {
                id: 'hc_tm', type: 'time', position: { x: 60, y: 300 },
                inputs: {},
                outputs: { time: { type: 'float', label: 'Time' } },
                params: {},
              },
              // Translate Z by time to create flying-forward motion
              {
                id: 'hc_tr', type: 'translate3D', position: { x: 240, y: 200 },
                inputs: {
                  pos: { type: 'vec3',  label: 'Position', connection: { nodeId: 'hc_sp', outputKey: 'pos'  } },
                  tz:  { type: 'float', label: 'Z',        connection: { nodeId: 'hc_tm', outputKey: 'time' } },
                },
                outputs: { pos: { type: 'vec3', label: 'Translated Pos' } },
                params: { tx: 0.0, ty: 0.0, tz: 0.0 },
              },
              // Repeat space
              {
                id: 'hc_rep', type: 'repeat3D', position: { x: 440, y: 200 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'hc_tr', outputKey: 'pos' } } },
                outputs: { pos: { type: 'vec3', label: 'Repeated Pos' } },
                params: { cellX: 1.2, cellY: 1.2, cellZ: 2.5 },
              },
              // Octahedron
              {
                id: 'hc_oct', type: 'octahedronSDF3D', position: { x: 640, y: 200 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'hc_rep', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } },
                params: { size: 0.2 },
              },
            ],
            outputNodeId: 'hc_oct',
            outputKey: 'dist',
          },
        },
      },
      {
        id: 'hc_ray', type: 'rayMarch', position: { x: 560, y: 180 },
        inputs: {
          scene: { type: 'scene3d', label: 'Scene', connection: { nodeId: 'hc_scene', outputKey: 'scene' } },
          uv:    { type: 'vec2',   label: 'UV',    connection: { nodeId: 'hc_uv',    outputKey: 'uv'   } },
          time:  { type: 'float',  label: 'Time',  connection: { nodeId: 'hc_time',  outputKey: 'time' } },
        },
        outputs: { color: { type: 'vec3', label: 'Color' }, depth: { type: 'float', label: 'Depth' }, normal: { type: 'vec3', label: 'Normal' }, iter: { type: 'float', label: 'Iter Count' } },
        params: { camDist: 4.0, camAngle: 0.0, camRotSpeed: 0.0, fov: 1.5, maxSteps: 96, maxDist: 30.0, lightX: 1.0, lightY: 2.0, lightZ: 3.0, bgR: 0.02, bgG: 0.02, bgB: 0.06, albedoR: 0.5, albedoG: 0.8, albedoB: 0.9 },
      },
      // depth + iter → palette coloring
      {
        id: 'hc_mul_iter', type: 'multiply', position: { x: 820, y: 340 },
        inputs: {
          a: { type: 'float', label: 'A', connection: { nodeId: 'hc_ray', outputKey: 'iter'  } },
          b: { type: 'float', label: 'B' },
        },
        outputs: { result: { type: 'float', label: 'Result' } },
        params: { b: 8.0 },
      },
      {
        id: 'hc_add_t', type: 'add', position: { x: 820, y: 240 },
        inputs: {
          a: { type: 'float', label: 'A', connection: { nodeId: 'hc_ray',      outputKey: 'depth'  } },
          b: { type: 'float', label: 'B', connection: { nodeId: 'hc_mul_iter', outputKey: 'result' } },
        },
        outputs: { result: { type: 'float', label: 'Result' } },
        params: {},
      },
      {
        id: 'hc_pal', type: 'palette', position: { x: 1020, y: 240 },
        inputs: {
          t: { type: 'float', label: 'T', connection: { nodeId: 'hc_add_t', outputKey: 'result' } },
          offset_r: { type: 'float', label: 'offset.r' }, offset_g: { type: 'float', label: 'offset.g' }, offset_b: { type: 'float', label: 'offset.b' },
          amplitude_r: { type: 'float', label: 'amplitude.r' }, amplitude_g: { type: 'float', label: 'amplitude.g' }, amplitude_b: { type: 'float', label: 'amplitude.b' },
          freq_r: { type: 'float', label: 'freq.r' }, freq_g: { type: 'float', label: 'freq.g' }, freq_b: { type: 'float', label: 'freq.b' },
          phase_r: { type: 'float', label: 'phase.r' }, phase_g: { type: 'float', label: 'phase.g' }, phase_b: { type: 'float', label: 'phase.b' },
        },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { offset: [0.5,0.5,0.5], amplitude: [0.5,0.5,0.5], freq: [1.0,1.0,1.0], phase: [0.0,0.33,0.67] },
      },
      {
        id: 'hc_out', type: 'output', position: { x: 1260, y: 240 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'hc_pal', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── 3D: Spiral World ──────────────────────────────────────────────────────────
  spiralWorld3D: {
    label: '3D: Spiral World',
    counter: 8,
    nodes: [
      { id: 'hd_uv',   type: 'uv',   position: { x: 50, y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'hd_time', type: 'time', position: { x: 50, y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'hd_scene', type: 'sceneGroup', position: { x: 300, y: 230 },
        inputs: {},
        outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: 'Spiral World',
          subgraph: {
            nodes: [
              {
                id: 'hd_sp', type: 'scenePos', position: { x: 60, y: 200 },
                inputs: {},
                outputs: { pos: { type: 'vec3', label: 'Position' } },
                params: {},
              },
              {
                id: 'hd_tm', type: 'time', position: { x: 60, y: 330 },
                inputs: {},
                outputs: { time: { type: 'float', label: 'Time' } },
                params: {},
              },
              // Translate Z by time
              {
                id: 'hd_tr', type: 'translate3D', position: { x: 240, y: 200 },
                inputs: {
                  pos: { type: 'vec3',  label: 'Position', connection: { nodeId: 'hd_sp', outputKey: 'pos'  } },
                  tz:  { type: 'float', label: 'Z',        connection: { nodeId: 'hd_tm', outputKey: 'time' } },
                },
                outputs: { pos: { type: 'vec3', label: 'Translated Pos' } },
                params: { tx: 0.0, ty: 0.0, tz: 0.0 },
              },
              // Repeat
              {
                id: 'hd_rep', type: 'repeat3D', position: { x: 420, y: 200 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'hd_tr', outputKey: 'pos' } } },
                outputs: { pos: { type: 'vec3', label: 'Repeated Pos' } },
                params: { cellX: 1.5, cellY: 1.5, cellZ: 2.0 },
              },
              // Sin Warp
              {
                id: 'hd_swp', type: 'sinWarp3D', position: { x: 600, y: 180 },
                inputs: {
                  p:    { type: 'vec3',  label: 'Position', connection: { nodeId: 'hd_rep', outputKey: 'pos'  } },
                  time: { type: 'float', label: 'Time',     connection: { nodeId: 'hd_tm',  outputKey: 'time' } },
                },
                outputs: { p: { type: 'vec3', label: 'Warped Position' } },
                params: { distort_axis: 'y', source_axis: 'x', frequency: 2.5, amplitude: 0.1 },
              },
              // Spiral Warp
              {
                id: 'hd_spw', type: 'spiralWarp3D', position: { x: 780, y: 180 },
                inputs: {
                  p:    { type: 'vec3',  label: 'Position', connection: { nodeId: 'hd_swp', outputKey: 'p'    } },
                  time: { type: 'float', label: 'Time',     connection: { nodeId: 'hd_tm',  outputKey: 'time' } },
                },
                outputs: { p: { type: 'vec3', label: 'Spiraled Position' } },
                params: { rotation_plane: 'xy', frequency: 0.4 },
              },
              // Octahedron
              {
                id: 'hd_oct', type: 'octahedronSDF3D', position: { x: 960, y: 200 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'hd_spw', outputKey: 'p' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } },
                params: { size: 0.25 },
              },
            ],
            outputNodeId: 'hd_oct',
            outputKey: 'dist',
          },
        },
      },
      {
        id: 'hd_ray', type: 'rayMarch', position: { x: 560, y: 180 },
        inputs: {
          scene: { type: 'scene3d', label: 'Scene', connection: { nodeId: 'hd_scene', outputKey: 'scene' } },
          uv:    { type: 'vec2',   label: 'UV',    connection: { nodeId: 'hd_uv',    outputKey: 'uv'   } },
          time:  { type: 'float',  label: 'Time',  connection: { nodeId: 'hd_time',  outputKey: 'time' } },
        },
        outputs: { color: { type: 'vec3', label: 'Color' }, depth: { type: 'float', label: 'Depth' }, normal: { type: 'vec3', label: 'Normal' }, iter: { type: 'float', label: 'Iter Count' } },
        params: { camDist: 4.0, camAngle: 0.0, camRotSpeed: 0.0, fov: 1.5, maxSteps: 96, maxDist: 30.0, lightX: 1.5, lightY: 2.0, lightZ: 3.0, bgR: 0.02, bgG: 0.02, bgB: 0.05, albedoR: 0.8, albedoG: 0.5, albedoB: 0.9 },
      },
      // depth + iter → rainbow palette
      {
        id: 'hd_add', type: 'add', position: { x: 820, y: 260 },
        inputs: {
          a: { type: 'float', label: 'A', connection: { nodeId: 'hd_ray', outputKey: 'depth' } },
          b: { type: 'float', label: 'B', connection: { nodeId: 'hd_ray', outputKey: 'iter'  } },
        },
        outputs: { result: { type: 'float', label: 'Result' } },
        params: {},
      },
      {
        id: 'hd_pal', type: 'palette', position: { x: 1020, y: 260 },
        inputs: {
          t: { type: 'float', label: 'T', connection: { nodeId: 'hd_add', outputKey: 'result' } },
          offset_r: { type: 'float', label: 'offset.r' }, offset_g: { type: 'float', label: 'offset.g' }, offset_b: { type: 'float', label: 'offset.b' },
          amplitude_r: { type: 'float', label: 'amplitude.r' }, amplitude_g: { type: 'float', label: 'amplitude.g' }, amplitude_b: { type: 'float', label: 'amplitude.b' },
          freq_r: { type: 'float', label: 'freq.r' }, freq_g: { type: 'float', label: 'freq.g' }, freq_b: { type: 'float', label: 'freq.b' },
          phase_r: { type: 'float', label: 'phase.r' }, phase_g: { type: 'float', label: 'phase.g' }, phase_b: { type: 'float', label: 'phase.b' },
        },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { offset: [0.5,0.5,0.5], amplitude: [0.5,0.5,0.5], freq: [1.0,1.0,1.0], phase: [0.0,0.33,0.67] },
      },
      {
        id: 'hd_out', type: 'output', position: { x: 1260, y: 260 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'hd_pal', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── 3D: Soft Metaballs ────────────────────────────────────────────────────────
  softMetaballs3D: {
    label: '3D: Soft Metaballs',
    counter: 6,
    nodes: [
      { id: 'he_uv',   type: 'uv',   position: { x: 50, y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'he_time', type: 'time', position: { x: 50, y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'he_scene', type: 'sceneGroup', position: { x: 300, y: 230 },
        inputs: {},
        outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: 'Soft Metaballs',
          subgraph: {
            nodes: [
              {
                id: 'he_sp', type: 'scenePos', position: { x: 60, y: 250 },
                inputs: {},
                outputs: { pos: { type: 'vec3', label: 'Position' } },
                params: {},
              },
              {
                id: 'he_tm', type: 'time', position: { x: 60, y: 380 },
                inputs: {},
                outputs: { time: { type: 'float', label: 'Time' } },
                params: {},
              },
              // Sphere A — static center
              {
                id: 'he_sphA', type: 'sphereSDF3D', position: { x: 250, y: 120 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'he_sp', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } },
                params: { radius: 0.35 },
              },
              // Sphere B — rotated around Y by time
              {
                id: 'he_rotB', type: 'rotate3D', position: { x: 250, y: 260 },
                inputs: {
                  pos:   { type: 'vec3',  label: 'Position', connection: { nodeId: 'he_sp', outputKey: 'pos'  } },
                  angle: { type: 'float', label: 'Angle',    connection: { nodeId: 'he_tm', outputKey: 'time' } },
                },
                outputs: { pos: { type: 'vec3', label: 'Rotated Pos' } },
                params: { axis: 'y', angle: 0.0 },
              },
              {
                id: 'he_trB', type: 'translate3D', position: { x: 440, y: 260 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'he_rotB', outputKey: 'pos' } } },
                outputs: { pos: { type: 'vec3', label: 'Translated Pos' } },
                params: { tx: 0.6, ty: 0.0, tz: 0.0 },
              },
              {
                id: 'he_sphB', type: 'sphereSDF3D', position: { x: 620, y: 260 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'he_trB', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } },
                params: { radius: 0.3 },
              },
              // Sphere C — rotated at different speed
              {
                id: 'he_rotC', type: 'rotate3D', position: { x: 250, y: 400 },
                inputs: {
                  pos:   { type: 'vec3',  label: 'Position', connection: { nodeId: 'he_sp', outputKey: 'pos'  } },
                  angle: { type: 'float', label: 'Angle',    connection: { nodeId: 'he_tm', outputKey: 'time' } },
                },
                outputs: { pos: { type: 'vec3', label: 'Rotated Pos' } },
                params: { axis: 'z', angle: 0.0 },
              },
              {
                id: 'he_trC', type: 'translate3D', position: { x: 440, y: 400 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'he_rotC', outputKey: 'pos' } } },
                outputs: { pos: { type: 'vec3', label: 'Translated Pos' } },
                params: { tx: 0.0, ty: 0.55, tz: 0.0 },
              },
              {
                id: 'he_sphC', type: 'sphereSDF3D', position: { x: 620, y: 400 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'he_trC', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } },
                params: { radius: 0.28 },
              },
              // Smooth union A+B
              {
                id: 'he_sm1', type: 'smoothMin', position: { x: 820, y: 190 },
                inputs: {
                  a: { type: 'float', label: 'A', connection: { nodeId: 'he_sphA', outputKey: 'dist' } },
                  b: { type: 'float', label: 'B', connection: { nodeId: 'he_sphB', outputKey: 'dist' } },
                },
                outputs: { result: { type: 'float', label: 'Result' } },
                params: { k: 0.3 },
              },
              // Smooth union (A+B)+C
              {
                id: 'he_sm2', type: 'smoothMin', position: { x: 1000, y: 300 },
                inputs: {
                  a: { type: 'float', label: 'A', connection: { nodeId: 'he_sm1',  outputKey: 'result' } },
                  b: { type: 'float', label: 'B', connection: { nodeId: 'he_sphC', outputKey: 'dist'   } },
                },
                outputs: { result: { type: 'float', label: 'Result' } },
                params: { k: 0.3 },
              },
            ],
            outputNodeId: 'he_sm2',
            outputKey: 'result',
          },
        },
      },
      {
        id: 'he_ray', type: 'rayMarch', position: { x: 560, y: 180 },
        inputs: {
          scene: { type: 'scene3d', label: 'Scene', connection: { nodeId: 'he_scene', outputKey: 'scene' } },
          uv:    { type: 'vec2',   label: 'UV',    connection: { nodeId: 'he_uv',    outputKey: 'uv'   } },
          time:  { type: 'float',  label: 'Time',  connection: { nodeId: 'he_time',  outputKey: 'time' } },
        },
        outputs: { color: { type: 'vec3', label: 'Color' }, depth: { type: 'float', label: 'Depth' }, normal: { type: 'vec3', label: 'Normal' }, iter: { type: 'float', label: 'Iter Count' } },
        params: { camDist: 3.0, camAngle: 0.7, camRotSpeed: 0.0, fov: 1.5, maxSteps: 80, maxDist: 20.0, lightX: 1.5, lightY: 2.5, lightZ: 2.0, bgR: 0.65, bgG: 0.75, bgB: 0.85, albedoR: 0.5, albedoG: 0.5, albedoB: 0.55 },
      },
      // Normal-based coloring: normal * 0.5 + 0.5
      {
        id: 'he_nmul', type: 'multiplyVec3', position: { x: 820, y: 200 },
        inputs: {
          color: { type: 'vec3',  label: 'Color', connection: { nodeId: 'he_ray', outputKey: 'normal' } },
          scale: { type: 'float', label: 'Scale' },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } },
        params: { scale: 0.5 },
      },
      {
        id: 'he_nadd', type: 'addVec3', position: { x: 1020, y: 200 },
        inputs: {
          a: { type: 'vec3', label: 'A', connection: { nodeId: 'he_nmul', outputKey: 'result' } },
          b: { type: 'vec3', label: 'B' },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } },
        params: { bx: 0.5, by: 0.5, bz: 0.5 },
      },
      // Mix lit color with normal color using hit mask
      {
        id: 'he_mix', type: 'mixVec3', position: { x: 1080, y: 340 },
        inputs: {
          a:   { type: 'vec3',  label: 'A',   connection: { nodeId: 'he_ray',  outputKey: 'color'  } },
          b:   { type: 'vec3',  label: 'B',   connection: { nodeId: 'he_nadd', outputKey: 'result' } },
          fac: { type: 'float', label: 'Fac' },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } },
        params: { fac: 0.5 },
      },
      {
        id: 'he_out', type: 'output', position: { x: 1300, y: 340 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'he_mix', outputKey: 'result' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── 3D: Normal Color ──────────────────────────────────────────────────────────
  // Shows RayRender.normal remapped to [0,1] for vivid surface-direction coloring
  normalColor3D: {
    label: '3D: Normal Color',
    counter: 8,
    nodes: [
      { id: 'nc_uv',   type: 'uv',   position: { x: 50, y: 80  }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'nc_time', type: 'time', position: { x: 50, y: 180 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'nc_scene', type: 'sceneGroup', position: { x: 300, y: 130 },
        inputs: {},
        outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: 'Sphere + Box',
          subgraph: {
            nodes: [
              { id: 'nc_sp', type: 'scenePos', position: { x: 60, y: 200 }, inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'nc_trS', type: 'translate3D', position: { x: 240, y: 120 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'nc_sp', outputKey: 'pos' } } },
                outputs: { pos: { type: 'vec3', label: 'Translated Pos' } }, params: { tx: -0.5, ty: 0.0, tz: 0.0 } },
              { id: 'nc_sph', type: 'sphereSDF3D', position: { x: 430, y: 120 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'nc_trS', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { radius: 0.4 } },
              { id: 'nc_trB', type: 'translate3D', position: { x: 240, y: 280 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'nc_sp', outputKey: 'pos' } } },
                outputs: { pos: { type: 'vec3', label: 'Translated Pos' } }, params: { tx: 0.5, ty: 0.1, tz: 0.0 } },
              { id: 'nc_box', type: 'boxSDF3D', position: { x: 430, y: 280 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'nc_trB', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { sizeX: 0.35, sizeY: 0.35, sizeZ: 0.35 } },
              { id: 'nc_gnd', type: 'planeSDF3D', position: { x: 240, y: 420 },
                inputs: { p: { type: 'vec3', label: 'Position', connection: { nodeId: 'nc_sp', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { height: -0.5 } },
              { id: 'nc_sm1', type: 'smoothMin', position: { x: 620, y: 200 },
                inputs: {
                  a: { type: 'float', label: 'A', connection: { nodeId: 'nc_sph', outputKey: 'dist' } },
                  b: { type: 'float', label: 'B', connection: { nodeId: 'nc_box', outputKey: 'dist' } },
                },
                outputs: { result: { type: 'float', label: 'Result' } }, params: { k: 0.15 } },
              { id: 'nc_mn2', type: 'minMath', position: { x: 800, y: 310 },
                inputs: {
                  a: { type: 'float', label: 'A', connection: { nodeId: 'nc_sm1', outputKey: 'result' } },
                  b: { type: 'float', label: 'B', connection: { nodeId: 'nc_gnd', outputKey: 'dist'   } },
                },
                outputs: { result: { type: 'float', label: 'Result' } }, params: {} },
            ],
            outputNodeId: 'nc_mn2',
            outputKey: 'result',
          },
        },
      },
      {
        id: 'nc_ray', type: 'rayMarch', position: { x: 560, y: 100 },
        inputs: {
          scene: { type: 'scene3d', label: 'Scene', connection: { nodeId: 'nc_scene', outputKey: 'scene' } },
          uv:    { type: 'vec2',   label: 'UV',    connection: { nodeId: 'nc_uv',    outputKey: 'uv'   } },
          time:  { type: 'float',  label: 'Time',  connection: { nodeId: 'nc_time',  outputKey: 'time' } },
        },
        outputs: { color: { type: 'vec3', label: 'Color' }, depth: { type: 'float', label: 'Depth' }, normal: { type: 'vec3', label: 'Normal' }, iter: { type: 'float', label: 'Iter Count' } },
        params: { camDist: 3.0, camAngle: 0.6, camRotSpeed: 0.0, fov: 1.5, maxSteps: 80, maxDist: 20.0, lightX: 1.5, lightY: 2.5, lightZ: 2.0, bgR: 0.65, bgG: 0.75, bgB: 0.85, albedoR: 0.5, albedoG: 0.5, albedoB: 0.55 },
      },
      // Normal → * 0.5 + 0.5 → output (remaps -1..1 to 0..1)
      {
        id: 'nc_nmul', type: 'multiplyVec3', position: { x: 820, y: 160 },
        inputs: {
          color: { type: 'vec3',  label: 'Color', connection: { nodeId: 'nc_ray', outputKey: 'normal' } },
          scale: { type: 'float', label: 'Scale' },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } },
        params: { scale: 0.5 },
      },
      {
        id: 'nc_nadd', type: 'addVec3', position: { x: 1020, y: 160 },
        inputs: {
          a: { type: 'vec3', label: 'A', connection: { nodeId: 'nc_nmul', outputKey: 'result' } },
          b: { type: 'vec3', label: 'B' },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } },
        params: { bx: 0.5, by: 0.5, bz: 0.5 },
      },
      {
        id: 'nc_out', type: 'output', position: { x: 1240, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'nc_nadd', outputKey: 'result' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── 3D: Depth + Iter AO ───────────────────────────────────────────────────────
  // The "iter hack" — tiny iter addition gives edge darkening that mimics AO.
  // Depth drives a blue palette; iter*0.015 adds subtle edge detail.
  depthIterAO3D: {
    label: '3D: Depth + Iter AO',
    counter: 10,
    nodes: [
      { id: 'di_uv',   type: 'uv',   position: { x: 50, y: 80  }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'di_time', type: 'time', position: { x: 50, y: 180 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'di_scene', type: 'sceneGroup', position: { x: 300, y: 130 },
        inputs: {},
        outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: 'Torus Scene',
          subgraph: {
            nodes: [
              { id: 'di_sp', type: 'scenePos', position: { x: 60, y: 200 }, inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'di_tm', type: 'time', position: { x: 60, y: 340 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
              { id: 'di_rot', type: 'rotate3D', position: { x: 240, y: 200 },
                inputs: {
                  pos:   { type: 'vec3',  label: 'Position', connection: { nodeId: 'di_sp', outputKey: 'pos'  } },
                  angle: { type: 'float', label: 'Angle',    connection: { nodeId: 'di_tm', outputKey: 'time' } },
                },
                outputs: { pos: { type: 'vec3', label: 'Rotated Pos' } }, params: { axis: 'x', angle: 0.0 } },
              { id: 'di_tor', type: 'torusSDF3D', position: { x: 440, y: 200 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'di_rot', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { r1: 0.45, r2: 0.15 } },
              { id: 'di_gnd', type: 'planeSDF3D', position: { x: 240, y: 380 },
                inputs: { p: { type: 'vec3', label: 'Position', connection: { nodeId: 'di_sp', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { height: -0.6 } },
              { id: 'di_mn', type: 'minMath', position: { x: 630, y: 290 },
                inputs: {
                  a: { type: 'float', label: 'A', connection: { nodeId: 'di_tor', outputKey: 'dist' } },
                  b: { type: 'float', label: 'B', connection: { nodeId: 'di_gnd', outputKey: 'dist' } },
                },
                outputs: { result: { type: 'float', label: 'Result' } }, params: {} },
            ],
            outputNodeId: 'di_mn',
            outputKey: 'result',
          },
        },
      },
      {
        id: 'di_ray', type: 'rayMarch', position: { x: 560, y: 100 },
        inputs: {
          scene: { type: 'scene3d', label: 'Scene', connection: { nodeId: 'di_scene', outputKey: 'scene' } },
          uv:    { type: 'vec2',   label: 'UV',    connection: { nodeId: 'di_uv',    outputKey: 'uv'   } },
          time:  { type: 'float',  label: 'Time',  connection: { nodeId: 'di_time',  outputKey: 'time' } },
        },
        outputs: { color: { type: 'vec3', label: 'Color' }, depth: { type: 'float', label: 'Depth' }, normal: { type: 'vec3', label: 'Normal' }, iter: { type: 'float', label: 'Iter Count' } },
        params: { camDist: 3.0, camAngle: 0.5, camRotSpeed: 0.0, fov: 1.5, maxSteps: 80, maxDist: 20.0, lightX: 1.5, lightY: 2.5, lightZ: 2.0, bgR: 0.65, bgG: 0.75, bgB: 0.85, albedoR: 0.5, albedoG: 0.5, albedoB: 0.55 },
      },
      // iter * 0.015
      {
        id: 'di_imul', type: 'multiply', position: { x: 820, y: 240 },
        inputs: { a: { type: 'float', label: 'A', connection: { nodeId: 'di_ray', outputKey: 'iter' } } },
        outputs: { result: { type: 'float', label: 'Result' } },
        params: { b: 0.015 },
      },
      // depth + iter*0.015
      {
        id: 'di_add', type: 'add', position: { x: 1010, y: 200 },
        inputs: {
          a: { type: 'float', label: 'A', connection: { nodeId: 'di_ray',  outputKey: 'depth' } },
          b: { type: 'float', label: 'B', connection: { nodeId: 'di_imul', outputKey: 'result' } },
        },
        outputs: { result: { type: 'float', label: 'Result' } },
        params: {},
      },
      // palette coloring
      {
        id: 'di_pal', type: 'palettePreset', position: { x: 1200, y: 180 },
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'di_add', outputKey: 'result' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { preset: 'IQ Blue Teal', t: 0.0 },
      },
      {
        id: 'di_out', type: 'output', position: { x: 1420, y: 220 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'di_pal', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Neon Floor Grid — Perspective2D + Light2D ─────────────────────────────
  neonFloorGrid: {
    label: 'Neon Floor Grid',
    counter: 8,
    nodes: [
      { id: 'nfg_uv',  type: 'uv',   position: { x: 40,  y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      // Perspective warp for floor look
      {
        id: 'nfg_persp', type: 'perspective2d', position: { x: 280, y: 160 },
        inputs: { uv: { type: 'vec2', label: 'UV', connection: { nodeId: 'nfg_uv', outputKey: 'uv' } } },
        outputs: { uv: { type: 'vec2', label: 'UV' }, depth: { type: 'float', label: 'Depth' } },
        params: { ratio: 1.5, axis: 'y', flip: 'false' },
      },
      // Scale up UVs for a tight grid
      {
        id: 'nfg_scale', type: 'multiplyVec2', position: { x: 500, y: 160 },
        inputs: { uv: { type: 'vec2', label: 'UV', connection: { nodeId: 'nfg_persp', outputKey: 'uv' } } },
        outputs: { result: { type: 'vec2', label: 'Result' } },
        params: { scale: 8.0 },
      },
      // Grid pattern
      {
        id: 'nfg_grid', type: 'grid', position: { x: 720, y: 160 },
        inputs: { uv: { type: 'vec2', label: 'UV', connection: { nodeId: 'nfg_scale', outputKey: 'result' } } },
        outputs: { grid: { type: 'float', label: 'Grid' } },
        params: { scale: 1.0, lineWidth: 0.04 },
      },
      // Grid to color (dark teal lines)
      {
        id: 'nfg_gridcol', type: 'floatToVec3', position: { x: 900, y: 160 },
        inputs: { input: { type: 'float', label: 'Float', connection: { nodeId: 'nfg_grid', outputKey: 'grid' } } },
        outputs: { rgb: { type: 'vec3', label: 'Color' } },
        params: {},
      },
      // Point light at origin
      {
        id: 'nfg_light', type: 'light2d', position: { x: 280, y: 380 },
        inputs: { uv: { type: 'vec2', label: 'UV', connection: { nodeId: 'nfg_uv', outputKey: 'uv' } } },
        outputs: { light: { type: 'vec3', label: 'Light' }, falloff: { type: 'float', label: 'Falloff' }, dist: { type: 'float', label: 'Dist' } },
        params: { falloff_model: 'squared', intensity: 2.0, radius: 2.0, gamma_correct: 'false', light_pos_x: 0.0, light_pos_y: 0.0, colorR: 0.0, colorG: 1.0, colorB: 1.0 },
      },
      // Multiply grid by light
      {
        id: 'nfg_mul', type: 'multiplyVec3', position: { x: 1100, y: 280 },
        inputs: {
          color: { type: 'vec3', label: 'Color', connection: { nodeId: 'nfg_gridcol', outputKey: 'rgb'   } },
          scale: { type: 'float', label: 'Scale', connection: { nodeId: 'nfg_light',   outputKey: 'falloff' } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } },
        params: {},
      },
      {
        id: 'nfg_out', type: 'output', position: { x: 1340, y: 280 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'nfg_mul', outputKey: 'result' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Spectral Lens — ChromaticAberration V2 in twist mode ─────────────────
  spectralLens: {
    label: 'Spectral Lens',
    counter: 8,
    nodes: [
      { id: 'sl_uv',   type: 'uv',   position: { x: 40,  y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'sl_time', type: 'time', position: { x: 40,  y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      // Chromatic aberration (twist mode, animated)
      {
        id: 'sl_ca', type: 'chromaticAberration', position: { x: 280, y: 260 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'sl_uv',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'sl_time', outputKey: 'time' } },
        },
        outputs: {
          uv_r:   { type: 'vec2', label: 'UV (Red)'   },
          uv_g:   { type: 'vec2', label: 'UV (Green)' },
          uv_b:   { type: 'vec2', label: 'UV (Blue)'  },
          offset: { type: 'vec2', label: 'Offset'     },
        },
        params: { mode: 'twist', strength: 0.04, contrast: 2.0, samples: '10', angle_deg: 0.0, animate: 'true', anim_speed: 0.5 },
      },
      // SDF circle (use uv_r, uv_g, uv_b as separate scene samples — here we use offset to drive a color)
      {
        id: 'sl_len_r', type: 'length', position: { x: 540, y: 120 },
        inputs: { input: { type: 'vec2', label: 'Input', connection: { nodeId: 'sl_ca', outputKey: 'uv_r' } } },
        outputs: { output: { type: 'float', label: 'Output' } },
        params: { scale: 1.0 },
      },
      {
        id: 'sl_len_g', type: 'length', position: { x: 540, y: 260 },
        inputs: { input: { type: 'vec2', label: 'Input', connection: { nodeId: 'sl_ca', outputKey: 'uv_g' } } },
        outputs: { output: { type: 'float', label: 'Output' } },
        params: { scale: 1.0 },
      },
      {
        id: 'sl_len_b', type: 'length', position: { x: 540, y: 400 },
        inputs: { input: { type: 'vec2', label: 'Input', connection: { nodeId: 'sl_ca', outputKey: 'uv_b' } } },
        outputs: { output: { type: 'float', label: 'Output' } },
        params: { scale: 1.0 },
      },
      // Glow rings from each channel (0.01 / |r|)
      {
        id: 'sl_glow_r', type: 'makeLight', position: { x: 760, y: 120 },
        inputs: { distance: { type: 'float', label: 'Distance', connection: { nodeId: 'sl_len_r', outputKey: 'output' } } },
        outputs: { glow: { type: 'float', label: 'Glow' } },
        params: { brightness: 12.0 },
      },
      {
        id: 'sl_glow_g', type: 'makeLight', position: { x: 760, y: 260 },
        inputs: { distance: { type: 'float', label: 'Distance', connection: { nodeId: 'sl_len_g', outputKey: 'output' } } },
        outputs: { glow: { type: 'float', label: 'Glow' } },
        params: { brightness: 12.0 },
      },
      {
        id: 'sl_glow_b', type: 'makeLight', position: { x: 760, y: 400 },
        inputs: { distance: { type: 'float', label: 'Distance', connection: { nodeId: 'sl_len_b', outputKey: 'output' } } },
        outputs: { glow: { type: 'float', label: 'Glow' } },
        params: { brightness: 12.0 },
      },
      // Combine into RGB
      {
        id: 'sl_rgb', type: 'combineRGB', position: { x: 980, y: 260 },
        inputs: {
          r: { type: 'float', label: 'R', connection: { nodeId: 'sl_glow_r', outputKey: 'glow' } },
          g: { type: 'float', label: 'G', connection: { nodeId: 'sl_glow_g', outputKey: 'glow' } },
          b: { type: 'float', label: 'B', connection: { nodeId: 'sl_glow_b', outputKey: 'glow' } },
        },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: {},
      },
      {
        id: 'sl_out', type: 'output', position: { x: 1200, y: 260 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'sl_rgb', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Alpha Layer Demo — AlphaBlend compositing ─────────────────────────────
  alphaLayerDemo: {
    label: 'Alpha Layer Demo',
    counter: 9,
    nodes: [
      { id: 'ald_uv',   type: 'uv',   position: { x: 40,  y: 240 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'ald_time', type: 'time', position: { x: 40,  y: 420 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      // Bottom layer: FBM noise as background color
      {
        id: 'ald_fbm', type: 'fbm', position: { x: 280, y: 160 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'ald_uv',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'ald_time', outputKey: 'time' } },
        },
        outputs: { color: { type: 'vec3', label: 'Color' }, value: { type: 'float', label: 'Value' } },
        params: { octaves: 4, lacunarity: 2.0, gain: 0.5, scale: 3.0, timeScale: 0.1 },
      },
      // Top layer: palette-colored circle
      {
        id: 'ald_circ', type: 'circleSDF', position: { x: 280, y: 400 },
        inputs: { uv: { type: 'vec2', label: 'UV', connection: { nodeId: 'ald_uv', outputKey: 'uv' } } },
        outputs: { sdf: { type: 'float', label: 'SDF' } },
        params: { radius: 0.4, cx: 0.0, cy: 0.0 },
      },
      {
        id: 'ald_pal', type: 'palettePreset', position: { x: 500, y: 400 },
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'ald_time', outputKey: 'time' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { preset: 'IQ Warm Sunset', t: 0.0 },
      },
      // Alpha mask from the circle SDF (1 inside, 0 outside)
      {
        id: 'ald_mask', type: 'smoothstep', position: { x: 500, y: 560 },
        inputs: { x: { type: 'float', label: 'x', connection: { nodeId: 'ald_circ', outputKey: 'sdf' } } },
        outputs: { result: { type: 'float', label: 'Result' } },
        params: { edge0: 0.02, edge1: -0.02 },
      },
      // AlphaBlend: composite circle on top of FBM
      {
        id: 'ald_blend', type: 'alphaBlend', position: { x: 760, y: 320 },
        inputs: {
          bottom:   { type: 'vec3',  label: 'Bottom Color', connection: { nodeId: 'ald_fbm',  outputKey: 'color' } },
          top:      { type: 'vec3',  label: 'Top Color',    connection: { nodeId: 'ald_pal',  outputKey: 'color' } },
          bottom_a: { type: 'float', label: 'Bottom Alpha' },
          top_a:    { type: 'float', label: 'Top Alpha',    connection: { nodeId: 'ald_mask', outputKey: 'result' } },
        },
        outputs: { color: { type: 'vec3', label: 'Color' }, alpha: { type: 'float', label: 'Alpha' } },
        params: { blend_mode: 'corrected' },
      },
      {
        id: 'ald_out', type: 'output', position: { x: 1000, y: 320 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'ald_blend', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Particle: Fountain ───────────────────────────────────────────────────────
  particleFountain: {
    label: 'Particles: Fountain',
    counter: 8,
    nodes: [
      { id: 'pf_uv',   type: 'uv',   position: { x: 40,  y: 200 }, inputs: {}, outputs: { uv:   { type: 'vec2',  label: 'UV'   } }, params: {} },
      { id: 'pf_time', type: 'time', position: { x: 40,  y: 360 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'pf_emit', type: 'particleEmitter', position: { x: 280, y: 260 },
        inputs: {
          position: { type: 'vec2',  label: 'Spawn Position' },
          time:     { type: 'float', label: 'Time',     connection: { nodeId: 'pf_time', outputKey: 'time' } },
          field:    { type: 'vec2',  label: 'Field Dir' },
        },
        outputs: {
          nearest_dist: { type: 'float', label: 'Nearest Dist' },
          nearest_uv:   { type: 'vec2',  label: 'Nearest UV'         },
          nearest_age:  { type: 'float', label: 'Age' },
          density:      { type: 'float', label: 'Density'            },
        },
        params: { max_particles: 70, lifetime: 2.0, speed: 0.4, angle_dir: 90, angle_spread: 0.25, gravity_x: 0.0, gravity_y: 0.8, field_strength: 1.0, despawn_radius: 2.0, seed: 0.0, density_radius: 0.05 },
      },
      {
        id: 'pf_circ', type: 'circleSDF', position: { x: 560, y: 200 },
        inputs: { position: { type: 'vec2', label: 'Position', connection: { nodeId: 'pf_emit', outputKey: 'nearest_uv' } } },
        outputs: { distance: { type: 'float', label: 'Distance' } },
        params: { radius: 0.018, posX: 0.0, posY: 0.0 },
      },
      {
        id: 'pf_pal', type: 'palettePreset', position: { x: 560, y: 360 },
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'pf_emit', outputKey: 'nearest_age' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { preset: '5' },
      },
      {
        id: 'pf_glow', type: 'glowLayer', position: { x: 780, y: 260 },
        inputs: {
          d:         { type: 'float', label: 'SDF',       connection: { nodeId: 'pf_circ', outputKey: 'distance' } },
          color:     { type: 'vec3',  label: 'Color',     connection: { nodeId: 'pf_pal',  outputKey: 'color'    } },
          intensity: { type: 'float', label: 'Intensity' },
          power:     { type: 'float', label: 'Power'     },
        },
        outputs: { result: { type: 'vec3', label: 'Glow' } },
        params: { intensity: 0.006, power: 1.5 },
      },
      {
        id: 'pf_out', type: 'output', position: { x: 1000, y: 276 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'pf_glow', outputKey: 'result' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Particle: Flow Field Drift ────────────────────────────────────────────────
  particleFlowDrift: {
    label: 'Particles: Flow Field',
    counter: 5,
    nodes: [
      { id: 'fd_time', type: 'time', position: { x: 40,  y: 300 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'fd_emit', type: 'particleEmitter', position: { x: 280, y: 280 },
        inputs: {
          position: { type: 'vec2',  label: 'Spawn / Center' },
          time:     { type: 'float', label: 'Time', connection: { nodeId: 'fd_time', outputKey: 'time' } },
          field:    { type: 'vec2',  label: 'Field Dir' },
        },
        outputs: {
          nearest_dist: { type: 'float', label: 'Nearest Dist' },
          nearest_uv:   { type: 'vec2',  label: 'Nearest UV'   },
          nearest_age:  { type: 'float', label: 'Age'           },
          density:      { type: 'float', label: 'Density'       },
        },
        params: {
          flow_mode: 'noise', max_particles: 40, lifetime: 5.0, speed: 0.45,
          noise_type: 'curl', noise_scale: 2.5, noise_speed: 0.25, spawn_radius: 1.8,
          angle_dir: 0, angle_spread: 1.0, gravity_x: 0.0, gravity_y: 0.0,
          field_strength: 1.2, despawn_radius: 2.5, seed: 42.0, density_radius: 0.04,
        },
      },
      {
        id: 'fd_pal', type: 'palettePreset', position: { x: 540, y: 200 },
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'fd_emit', outputKey: 'nearest_age' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { preset: '3' },
      },
      {
        id: 'fd_glow', type: 'glowLayer', position: { x: 540, y: 360 },
        inputs: {
          d:         { type: 'float', label: 'SDF',       connection: { nodeId: 'fd_emit', outputKey: 'nearest_dist' } },
          color:     { type: 'vec3',  label: 'Color',     connection: { nodeId: 'fd_pal',  outputKey: 'color'        } },
          intensity: { type: 'float', label: 'Intensity' },
          power:     { type: 'float', label: 'Power'     },
        },
        outputs: { result: { type: 'vec3', label: 'Glow' } },
        params: { intensity: 0.005, power: 1.3 },
      },
      {
        id: 'fd_out', type: 'output', position: { x: 780, y: 360 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'fd_glow', outputKey: 'result' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Particle: Spiral Vortex ───────────────────────────────────────────────────
  particleSpiralVortex: {
    label: 'Particles: Spiral Vortex',
    counter: 5,
    nodes: [
      { id: 'sv_time', type: 'time', position: { x: 40, y: 300 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'sv_emit', type: 'particleEmitter', position: { x: 280, y: 280 },
        inputs: {
          position: { type: 'vec2',  label: 'Spawn / Center' },
          time:     { type: 'float', label: 'Time', connection: { nodeId: 'sv_time', outputKey: 'time' } },
          field:    { type: 'vec2',  label: 'Field Dir' },
        },
        outputs: {
          nearest_dist: { type: 'float', label: 'Nearest Dist' },
          nearest_uv:   { type: 'vec2',  label: 'Nearest UV'   },
          nearest_age:  { type: 'float', label: 'Age'           },
          density:      { type: 'float', label: 'Density'       },
        },
        params: {
          flow_mode: 'noise', max_particles: 40, lifetime: 6.0, speed: 0.3,
          noise_type: 'curl', noise_scale: 1.5, noise_speed: 0.12, spawn_radius: 1.5,
          angle_dir: 0, angle_spread: 1.0, gravity_x: 0.0, gravity_y: 0.0,
          field_strength: 1.8, despawn_radius: 3.0, seed: 7.0, density_radius: 0.045,
        },
      },
      {
        id: 'sv_pal', type: 'palettePreset', position: { x: 540, y: 200 },
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'sv_emit', outputKey: 'nearest_age' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { preset: '2' },
      },
      {
        id: 'sv_glow', type: 'glowLayer', position: { x: 540, y: 360 },
        inputs: {
          d:         { type: 'float', label: 'SDF',       connection: { nodeId: 'sv_emit', outputKey: 'nearest_dist' } },
          color:     { type: 'vec3',  label: 'Color',     connection: { nodeId: 'sv_pal',  outputKey: 'color'        } },
          intensity: { type: 'float', label: 'Intensity' },
          power:     { type: 'float', label: 'Power'     },
        },
        outputs: { result: { type: 'vec3', label: 'Glow' } },
        params: { intensity: 0.007, power: 1.4 },
      },
      {
        id: 'sv_out', type: 'output', position: { x: 780, y: 360 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'sv_glow', outputKey: 'result' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Particle: Orbit Cloud ─────────────────────────────────────────────────────
  particleOrbitCloud: {
    label: 'Particles: Orbit Cloud',
    counter: 9,
    nodes: [
      { id: 'oc_uv',   type: 'uv',   position: { x: 40,  y: 200 }, inputs: {}, outputs: { uv:   { type: 'vec2',  label: 'UV'   } }, params: {} },
      { id: 'oc_time', type: 'time', position: { x: 40,  y: 360 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'oc_gf', type: 'gravityField', position: { x: 280, y: 200 },
        inputs: {
          uv:        { type: 'vec2',  label: 'UV',            connection: { nodeId: 'oc_uv', outputKey: 'uv' } },
          attractor: { type: 'vec2',  label: 'Attractor Pos' },
          strength:  { type: 'float', label: 'Strength'      },
        },
        outputs: {
          dir:     { type: 'vec2',  label: 'Direction' },
          dist:    { type: 'float', label: 'Distance'  },
          falloff: { type: 'float', label: 'Falloff'   },
        },
        params: { mode: 'orbit', falloff: 'linear', strength: 1.0, min_dist: 0.01 },
      },
      {
        id: 'oc_emit', type: 'particleEmitter', position: { x: 540, y: 280 },
        inputs: {
          position: { type: 'vec2',  label: 'Spawn Position' },
          time:     { type: 'float', label: 'Time',      connection: { nodeId: 'oc_time', outputKey: 'time' } },
          field:    { type: 'vec2',  label: 'Field Dir',  connection: { nodeId: 'oc_gf',   outputKey: 'dir'  } },
        },
        outputs: {
          nearest_dist: { type: 'float', label: 'Nearest Dist' },
          nearest_uv:   { type: 'vec2',  label: 'Nearest UV'         },
          nearest_age:  { type: 'float', label: 'Age' },
          density:      { type: 'float', label: 'Density'            },
        },
        params: {
          flow_mode: 'gravity', max_particles: 80, lifetime: 5.0, speed: 0.0,
          spawn_radius: 1.0, field_strength: 1.5,
          angle_dir: 0, angle_spread: 1.0, gravity_x: 0.0, gravity_y: 0.0,
          despawn_radius: 2.5, seed: 13.0, density_radius: 0.05,
          noise_type: 'curl', noise_scale: 2.0, noise_speed: 0.3,
        },
      },
      {
        id: 'oc_pal', type: 'palettePreset', position: { x: 780, y: 200 },
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'oc_emit', outputKey: 'nearest_age' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { preset: '4' },
      },
      {
        id: 'oc_glow', type: 'glowLayer', position: { x: 780, y: 380 },
        inputs: {
          d:         { type: 'float', label: 'SDF',       connection: { nodeId: 'oc_emit', outputKey: 'nearest_dist' } },
          color:     { type: 'vec3',  label: 'Color',     connection: { nodeId: 'oc_pal',  outputKey: 'color'        } },
          intensity: { type: 'float', label: 'Intensity' },
          power:     { type: 'float', label: 'Power'     },
        },
        outputs: { result: { type: 'vec3', label: 'Glow' } },
        params: { intensity: 0.005, power: 1.6 },
      },
      {
        id: 'oc_out', type: 'output', position: { x: 1020, y: 380 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'oc_glow', outputKey: 'result' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Particle: Rain ─────────────────────────────────────────────────────────
  particleRain: {
    label: 'Particles: Rain',
    counter: 8,
    nodes: [
      { id: 'pr_uv',   type: 'uv',   position: { x: 40, y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'pr_time', type: 'time', position: { x: 40, y: 360 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'pr_emit', type: 'particleEmitter', position: { x: 280, y: 260 },
        inputs: {
          position: { type: 'vec2', label: 'Spawn Position' },
          time:     { type: 'float', label: 'Time', connection: { nodeId: 'pr_time', outputKey: 'time' } },
          field:    { type: 'vec2', label: 'Field Dir' },
        },
        outputs: {
          nearest_dist: { type: 'float', label: 'Nearest Dist' },
          nearest_uv:   { type: 'vec2',  label: 'Nearest UV' },
          nearest_age:  { type: 'float', label: 'Age' },
          density:      { type: 'float', label: 'Density' },
        },
        params: { max_particles: 80, lifetime: 1.8, speed: 0.9, angle_dir: 270, angle_spread: 0.08, gravity_x: 0.0, gravity_y: 0.0, field_strength: 1.0, despawn_radius: 2.5, seed: 5.0, density_radius: 0.04 },
      },
      {
        id: 'pr_circ', type: 'circleSDF', position: { x: 540, y: 200 },
        inputs: { position: { type: 'vec2', label: 'Position', connection: { nodeId: 'pr_emit', outputKey: 'nearest_uv' } } },
        outputs: { distance: { type: 'float', label: 'Distance' } },
        params: { radius: 0.006, posX: 0.0, posY: 0.0 },
      },
      {
        id: 'pr_col', type: 'makeVec3', position: { x: 540, y: 360 },
        inputs: {},
        outputs: { rgb: { type: 'vec3', label: 'RGB' } },
        params: { r: 0.5, g: 0.75, b: 0.95 },
      },
      {
        id: 'pr_glow', type: 'glowLayer', position: { x: 760, y: 270 },
        inputs: {
          d:         { type: 'float', label: 'SDF',   connection: { nodeId: 'pr_circ', outputKey: 'distance' } },
          color:     { type: 'vec3',  label: 'Color', connection: { nodeId: 'pr_col',  outputKey: 'rgb'      } },
          intensity: { type: 'float', label: 'Intensity' },
          power:     { type: 'float', label: 'Power' },
        },
        outputs: { result: { type: 'vec3', label: 'Glow' } },
        params: { intensity: 0.004, power: 1.8 },
      },
      {
        id: 'pr_out', type: 'output', position: { x: 980, y: 286 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'pr_glow', outputKey: 'result' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Particle: Explosion ────────────────────────────────────────────────────
  particleExplosion: {
    label: 'Particles: Explosion',
    counter: 9,
    nodes: [
      { id: 'pe2_uv',   type: 'uv',   position: { x: 40, y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'pe2_time', type: 'time', position: { x: 40, y: 360 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'pe2_emit', type: 'particleEmitter', position: { x: 280, y: 260 },
        inputs: {
          position: { type: 'vec2', label: 'Spawn Position' },
          time:     { type: 'float', label: 'Time', connection: { nodeId: 'pe2_time', outputKey: 'time' } },
          field:    { type: 'vec2', label: 'Field Dir' },
        },
        outputs: {
          nearest_dist: { type: 'float', label: 'Nearest Dist' },
          nearest_uv:   { type: 'vec2',  label: 'Nearest UV' },
          nearest_age:  { type: 'float', label: 'Age' },
          density:      { type: 'float', label: 'Density' },
        },
        params: { max_particles: 60, lifetime: 1.2, speed: 0.6, angle_dir: 0, angle_spread: 1.0, gravity_x: 0.0, gravity_y: 0.0, field_strength: 1.0, despawn_radius: 1.0, seed: 21.0, density_radius: 0.05 },
      },
      {
        id: 'pe2_pal', type: 'palettePreset', position: { x: 540, y: 200 },
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'pe2_emit', outputKey: 'nearest_age' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { preset: '7' },
      },
      {
        id: 'pe2_glow', type: 'glowLayer', position: { x: 760, y: 270 },
        inputs: {
          d:         { type: 'float', label: 'SDF',   connection: { nodeId: 'pe2_emit', outputKey: 'nearest_dist' } },
          color:     { type: 'vec3',  label: 'Color', connection: { nodeId: 'pe2_pal',  outputKey: 'color'        } },
          intensity: { type: 'float', label: 'Intensity' },
          power:     { type: 'float', label: 'Power' },
        },
        outputs: { result: { type: 'vec3', label: 'Glow' } },
        params: { intensity: 0.008, power: 1.2 },
      },
      {
        id: 'pe2_out', type: 'output', position: { x: 980, y: 286 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'pe2_glow', outputKey: 'result' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Particle: Mouse Attractor ──────────────────────────────────────────────
  particleMouseAttract: {
    label: 'Particles: Mouse Attract',
    counter: 9,
    nodes: [
      { id: 'pm_uv',    type: 'uv',    position: { x: 40, y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'pm_time',  type: 'time',  position: { x: 40, y: 360 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      { id: 'pm_mouse', type: 'mouse', position: { x: 40, y: 500 }, inputs: {}, outputs: { position: { type: 'vec2', label: 'Position' }, click: { type: 'float', label: 'Click' } }, params: {} },
      {
        id: 'pm_gf', type: 'gravityField', position: { x: 280, y: 200 },
        inputs: {
          uv:        { type: 'vec2',  label: 'UV',            connection: { nodeId: 'pm_uv',    outputKey: 'uv'       } },
          attractor: { type: 'vec2',  label: 'Attractor Pos', connection: { nodeId: 'pm_mouse', outputKey: 'position' } },
          strength:  { type: 'float', label: 'Strength' },
        },
        outputs: {
          dir:     { type: 'vec2',  label: 'Direction' },
          dist:    { type: 'float', label: 'Distance'  },
          falloff: { type: 'float', label: 'Falloff'   },
        },
        params: { mode: 'attract', falloff: 'squared', strength: 0.8, min_dist: 0.02 },
      },
      {
        id: 'pm_emit', type: 'particleEmitter', position: { x: 540, y: 300 },
        inputs: {
          position: { type: 'vec2',  label: 'Spawn Position' },
          time:     { type: 'float', label: 'Time',      connection: { nodeId: 'pm_time', outputKey: 'time' } },
          field:    { type: 'vec2',  label: 'Field Dir', connection: { nodeId: 'pm_gf',   outputKey: 'dir'  } },
        },
        outputs: {
          nearest_dist: { type: 'float', label: 'Nearest Dist' },
          nearest_uv:   { type: 'vec2',  label: 'Nearest UV' },
          nearest_age:  { type: 'float', label: 'Age' },
          density:      { type: 'float', label: 'Density' },
        },
        params: {
          flow_mode: 'gravity', max_particles: 80, lifetime: 3.0, speed: 0.0,
          spawn_radius: 1.5, field_strength: 1.8,
          angle_dir: 0, angle_spread: 1.0, gravity_x: 0.0, gravity_y: 0.0,
          despawn_radius: 3.0, seed: 3.0, density_radius: 0.05,
          noise_type: 'curl', noise_scale: 2.0, noise_speed: 0.3,
        },
      },
      {
        id: 'pm_pal', type: 'palettePreset', position: { x: 780, y: 220 },
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'pm_emit', outputKey: 'nearest_age' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { preset: '6' },
      },
      {
        id: 'pm_glow', type: 'glowLayer', position: { x: 780, y: 380 },
        inputs: {
          d:         { type: 'float', label: 'SDF',   connection: { nodeId: 'pm_emit', outputKey: 'nearest_dist' } },
          color:     { type: 'vec3',  label: 'Color', connection: { nodeId: 'pm_pal',  outputKey: 'color'        } },
          intensity: { type: 'float', label: 'Intensity' },
          power:     { type: 'float', label: 'Power' },
        },
        outputs: { result: { type: 'vec3', label: 'Glow' } },
        params: { intensity: 0.006, power: 1.4 },
      },
      {
        id: 'pm_out', type: 'output', position: { x: 1020, y: 380 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'pm_glow', outputKey: 'result' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Gaussian Blur Demo ────────────────────────────────────────────────────
  gaussianBlurDemo: {
    label: 'Gaussian Blur',
    counter: 6,
    nodes: [
      { id: 'gb_uv',   type: 'uv',   position: { x: 40,  y: 200 }, inputs: {}, outputs: { uv:   { type: 'vec2',  label: 'UV'   } }, params: {} },
      { id: 'gb_time', type: 'time', position: { x: 40,  y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'gb_fbm', type: 'fbm', position: { x: 280, y: 160 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'gb_uv',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'gb_time', outputKey: 'time' } },
        },
        outputs: { value: { type: 'float', label: 'Value' }, uv: { type: 'vec2', label: 'UV' } },
        params: { octaves: 5, lacunarity: 2.0, gain: 0.5, scale: 1.2, time_scale: 0.05 },
      },
      {
        id: 'gb_pal', type: 'palettePreset', position: { x: 530, y: 160 },
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'gb_fbm', outputKey: 'value' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { preset: '3' },
      },
      {
        id: 'gb_blur', type: 'gaussianBlur', position: { x: 780, y: 160 },
        inputs: {
          color: { type: 'vec3', label: 'Color', connection: { nodeId: 'gb_pal', outputKey: 'color' } },
          uv:    { type: 'vec2', label: 'UV',    connection: { nodeId: 'gb_uv',  outputKey: 'uv'    } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } },
        params: { radius: 5.0, quality: 'standard' },
      },
      {
        id: 'gb_out', type: 'output', position: { x: 1040, y: 160 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'gb_blur', outputKey: 'result' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Motion Blur Trails ────────────────────────────────────────────────────
  motionBlurTrails: {
    label: 'Motion Blur Trails',
    counter: 5,
    nodes: [
      { id: 'mb_uv',   type: 'uv',   position: { x: 40,  y: 200 }, inputs: {}, outputs: { uv:   { type: 'vec2',  label: 'UV'   } }, params: {} },
      { id: 'mb_time', type: 'time', position: { x: 40,  y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'mb_frac', type: 'fractalLoop', position: { x: 310, y: 120 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'mb_uv',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'mb_time', outputKey: 'time' } },
        },
        outputs: { color: { type: 'vec3', label: 'Color' }, uv_final: { type: 'vec2', label: 'UV Final' }, uv0: { type: 'vec2', label: 'UV0' } },
        params: { iterations: 4, fract_scale: 1.5, scale_exp: 1.0, ring_freq: 8.0, glow: 0.01, glow_pow: 1.0, iter_offset: 0.4, time_scale: 0.6, offset: [0.5,0.5,0.5], amplitude: [0.5,0.5,0.5], freq: [1.0,1.0,1.0], phase: [0.0,0.33,0.67] },
      },
      {
        id: 'mb_blur', type: 'motionBlur', position: { x: 700, y: 200 },
        inputs: {
          color: { type: 'vec3', label: 'Color', connection: { nodeId: 'mb_frac', outputKey: 'color' } },
          uv:    { type: 'vec2', label: 'UV',    connection: { nodeId: 'mb_uv',   outputKey: 'uv'    } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } },
        params: { scene_weight: 0.28, history_weight: 0.72, decay_r: 1.0, decay_g: 0.95, decay_b: 0.9 },
      },
      {
        id: 'mb_out', type: 'output', position: { x: 960, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'mb_blur', outputKey: 'result' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Tilt-Shift Miniature ──────────────────────────────────────────────────
  tiltShiftScene: {
    label: 'Tilt-Shift',
    counter: 6,
    nodes: [
      { id: 'ts_uv',   type: 'uv',   position: { x: 40,  y: 200 }, inputs: {}, outputs: { uv:   { type: 'vec2',  label: 'UV'   } }, params: {} },
      { id: 'ts_time', type: 'time', position: { x: 40,  y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'ts_fbm', type: 'fbm', position: { x: 280, y: 160 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'ts_uv',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'ts_time', outputKey: 'time' } },
        },
        outputs: { value: { type: 'float', label: 'Value' }, uv: { type: 'vec2', label: 'UV' } },
        params: { octaves: 6, lacunarity: 2.0, gain: 0.5, scale: 2.0, time_scale: 0.03 },
      },
      {
        id: 'ts_pal', type: 'palettePreset', position: { x: 530, y: 160 },
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'ts_fbm', outputKey: 'value' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { preset: '5' },
      },
      {
        id: 'ts_blur', type: 'tiltShiftBlur', position: { x: 780, y: 160 },
        inputs: {
          color: { type: 'vec3', label: 'Color', connection: { nodeId: 'ts_pal',  outputKey: 'color' } },
          uv:    { type: 'vec2', label: 'UV',    connection: { nodeId: 'ts_uv',   outputKey: 'uv'    } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' }, mask: { type: 'float', label: 'Focus Mask' } },
        params: { focus_center: 0.0, band_width: 0.2, max_blur: 8.0, tilt_angle: 12.0, axis: 'horizontal' },
      },
      {
        id: 'ts_out', type: 'output', position: { x: 1040, y: 160 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'ts_blur', outputKey: 'result' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Lens Blur / Bokeh ─────────────────────────────────────────────────────
  lensBokeh: {
    label: 'Lens Blur Bokeh',
    counter: 7,
    nodes: [
      { id: 'lb_uv',   type: 'uv',   position: { x: 40,  y: 200 }, inputs: {}, outputs: { uv:   { type: 'vec2',  label: 'UV'   } }, params: {} },
      { id: 'lb_time', type: 'time', position: { x: 40,  y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'lb_vor', type: 'voronoi', position: { x: 280, y: 160 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'lb_uv',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'lb_time', outputKey: 'time' } },
        },
        outputs: { dist: { type: 'float', label: 'Distance' }, uv: { type: 'vec2', label: 'UV' } },
        params: { scale: 4.0, jitter: 0.9, time_scale: 0.08 },
      },
      {
        id: 'lb_pal', type: 'palettePreset', position: { x: 530, y: 100 },
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'lb_vor', outputKey: 'dist' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { preset: '8' },
      },
      {
        id: 'lb_glow', type: 'glowLayer', position: { x: 530, y: 280 },
        inputs: {
          d:     { type: 'float', label: 'SDF',   connection: { nodeId: 'lb_vor', outputKey: 'dist' } },
          color: { type: 'vec3',  label: 'Color', connection: { nodeId: 'lb_pal', outputKey: 'color' } },
        },
        outputs: { result: { type: 'vec3', label: 'Glow' } },
        params: { intensity: 0.015, power: 1.2 },
      },
      {
        id: 'lb_lens', type: 'lensBlur', position: { x: 800, y: 200 },
        inputs: {
          color: { type: 'vec3', label: 'Color',       connection: { nodeId: 'lb_glow', outputKey: 'result' } },
          uv:    { type: 'vec2', label: 'UV',          connection: { nodeId: 'lb_uv',   outputKey: 'uv'     } },
          focal_point: { type: 'vec2', label: 'Focal Point' },
        },
        outputs: { result: { type: 'vec3', label: 'Result' }, coc: { type: 'float', label: 'CoC' } },
        params: { focal_length: '85mm', aperture: 'f2', focus_distance: 0.2, bokeh_shape: 'hex', boost: 1.5 },
      },
      {
        id: 'lb_out', type: 'output', position: { x: 1060, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'lb_lens', outputKey: 'result' } } },
        outputs: {}, params: {},
      },
    ],
  },


  // ── Retro Tunnel — polar space + animated ring waves ─────────────────────
  retroTunnel: {
    label: 'Retro Tunnel',
    counter: 6,
    nodes: [
      { id: 'rt_uv',   type: 'uv',   position: { x: 40,  y: 200 }, inputs: {}, outputs: { uv:   { type: 'vec2',  label: 'UV'   } }, params: {} },
      { id: 'rt_time', type: 'time', position: { x: 40,  y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'rt_polar', type: 'polarSpace', position: { x: 260, y: 160 },
        inputs:  { input: { type: 'vec2', label: 'UV', connection: { nodeId: 'rt_uv', outputKey: 'uv' } } },
        outputs: { output: { type: 'vec2', label: 'Polar UV' }, seamless: { type: 'vec2', label: 'Seamless' }, angle: { type: 'float', label: 'Angle' }, radius: { type: 'float', label: 'Radius' } },
        params:  { twist: 0.5, radialScale: 1.0 },
      },
      {
        id: 'rt_wave', type: 'waveTexture', position: { x: 480, y: 160 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'rt_polar', outputKey: 'output' } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'rt_time',  outputKey: 'time'   } },
        },
        outputs: { value: { type: 'float', label: 'Value' } },
        params: { mode: 'rings', scale: 12.0, speed: 2.5, distortion: 0.0 },
      },
      {
        id: 'rt_pal', type: 'palettePreset', position: { x: 700, y: 160 },
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'rt_wave', outputKey: 'value' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { preset: '1' },
      },
      {
        id: 'rt_out', type: 'output', position: { x: 900, y: 180 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'rt_pal', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Barrel + Chroma — barrel distortion chromatic aberration ─────────────
  barrelChroma: {
    label: 'Barrel + Chroma',
    counter: 8,
    nodes: [
      { id: 'bc_uv',   type: 'uv',   position: { x: 40,  y: 200 }, inputs: {}, outputs: { uv:   { type: 'vec2',  label: 'UV'   } }, params: {} },
      { id: 'bc_time', type: 'time', position: { x: 40,  y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'bc_ca', type: 'chromaticAberration', position: { x: 260, y: 240 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'bc_uv',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'bc_time', outputKey: 'time' } },
        },
        outputs: { uv_r: { type: 'vec2', label: 'UV (Red)' }, uv_g: { type: 'vec2', label: 'UV (Green)' }, uv_b: { type: 'vec2', label: 'UV (Blue)' }, offset: { type: 'vec2', label: 'Offset' } },
        params: { mode: 'barrel', strength: 0.035, contrast: 1.2, samples: '8', angle_deg: 0.0, animate: 'false', anim_speed: 0.5 },
      },
      {
        id: 'bc_fr', type: 'fbm', position: { x: 540, y: 80 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'bc_ca',   outputKey: 'uv_r' } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'bc_time', outputKey: 'time' } },
        },
        outputs: { value: { type: 'float', label: 'Value' } },
        params: { octaves: 4, scale: 2.0, gain: 0.5, lacunarity: 2.0, time_scale: 0.1 },
      },
      {
        id: 'bc_fg', type: 'fbm', position: { x: 540, y: 240 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'bc_ca',   outputKey: 'uv_g' } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'bc_time', outputKey: 'time' } },
        },
        outputs: { value: { type: 'float', label: 'Value' } },
        params: { octaves: 4, scale: 2.0, gain: 0.5, lacunarity: 2.0, time_scale: 0.1 },
      },
      {
        id: 'bc_fb', type: 'fbm', position: { x: 540, y: 400 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'bc_ca',   outputKey: 'uv_b' } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'bc_time', outputKey: 'time' } },
        },
        outputs: { value: { type: 'float', label: 'Value' } },
        params: { octaves: 4, scale: 2.0, gain: 0.5, lacunarity: 2.0, time_scale: 0.1 },
      },
      {
        id: 'bc_rgb', type: 'combineRGB', position: { x: 780, y: 240 },
        inputs: {
          r: { type: 'float', label: 'R', connection: { nodeId: 'bc_fr', outputKey: 'value' } },
          g: { type: 'float', label: 'G', connection: { nodeId: 'bc_fg', outputKey: 'value' } },
          b: { type: 'float', label: 'B', connection: { nodeId: 'bc_fb', outputKey: 'value' } },
        },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: {},
      },
      {
        id: 'bc_out', type: 'output', position: { x: 980, y: 240 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'bc_rgb', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── CRT Screen — scanlines + vignette on animated FBM ────────────────────
  crtScreen: {
    label: 'CRT Screen',
    counter: 8,
    nodes: [
      { id: 'crt_uv',   type: 'uv',   position: { x: 60, y: 200 }, inputs: {}, outputs: { uv:   { type: 'vec2',  label: 'UV'   } }, params: {} },
      { id: 'crt_time', type: 'time', position: { x: 60, y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'crt_fbm', type: 'fbm', position: { x: 260, y: 160 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'crt_uv',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'crt_time', outputKey: 'time' } },
        },
        outputs: { value: { type: 'float', label: 'Value' } },
        params: { octaves: 5, scale: 2.5, gain: 0.5, lacunarity: 2.0, time_scale: 0.05 },
      },
      {
        id: 'crt_pal', type: 'palettePreset', position: { x: 480, y: 160 },
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'crt_fbm', outputKey: 'value' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { preset: '7' },
      },
      { id: 'crt_puv', type: 'pixelUV', position: { x: 260, y: 340 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV (0-1)' } }, params: {} },
      {
        id: 'crt_scn', type: 'scanlines', position: { x: 680, y: 160 },
        inputs: {
          color: { type: 'vec3',  label: 'Color', connection: { nodeId: 'crt_pal',  outputKey: 'color' } },
          uv:    { type: 'vec2',  label: 'UV',    connection: { nodeId: 'crt_puv',  outputKey: 'uv'    } },
          time:  { type: 'float', label: 'Time',  connection: { nodeId: 'crt_time', outputKey: 'time'  } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } },
        params: { count: 280.0, intensity: 0.35, scroll: 0.15 },
      },
      {
        id: 'crt_vig', type: 'vignette', position: { x: 900, y: 160 },
        inputs: {
          color: { type: 'vec3', label: 'Color', connection: { nodeId: 'crt_scn', outputKey: 'result' } },
          uv:    { type: 'vec2', label: 'UV',    connection: { nodeId: 'crt_puv', outputKey: 'uv'    } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } },
        params: { radius: 0.6, softness: 0.4, strength: 1.0 },
      },
      {
        id: 'crt_out', type: 'output', position: { x: 1100, y: 180 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'crt_vig', outputKey: 'result' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Mirror Tunnel — infinite tiled repeat + FBM ───────────────────────────
  mirrorTunnel: {
    label: 'Mirror Tunnel',
    counter: 6,
    nodes: [
      { id: 'mt_uv',   type: 'uv',   position: { x: 40, y: 200 }, inputs: {}, outputs: { uv:   { type: 'vec2',  label: 'UV'   } }, params: {} },
      { id: 'mt_time', type: 'time', position: { x: 40, y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'mt_rep', type: 'infiniteRepeatSpace', position: { x: 260, y: 180 },
        inputs:  { input: { type: 'vec2', label: 'UV', connection: { nodeId: 'mt_uv', outputKey: 'uv' } } },
        outputs: { output: { type: 'vec2', label: 'Cell UV' }, cellID: { type: 'vec2', label: 'Cell ID' } },
        params:  { cellX: 0.5, cellY: 0.5 },
      },
      {
        id: 'mt_fbm', type: 'fbm', position: { x: 480, y: 180 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'mt_rep',  outputKey: 'output' } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'mt_time', outputKey: 'time'   } },
        },
        outputs: { value: { type: 'float', label: 'Value' } },
        params: { octaves: 5, scale: 3.0, gain: 0.5, lacunarity: 2.0, time_scale: 0.08 },
      },
      {
        id: 'mt_pal', type: 'palettePreset', position: { x: 700, y: 180 },
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'mt_fbm', outputKey: 'value' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { preset: '4' },
      },
      {
        id: 'mt_out', type: 'output', position: { x: 900, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'mt_pal', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Glitch Effect — animated linear chroma + scanlines ───────────────────
  glitchEffect: {
    label: 'Glitch Effect',
    counter: 10,
    nodes: [
      { id: 'gl_uv',   type: 'uv',   position: { x: 40,  y: 200 }, inputs: {}, outputs: { uv:   { type: 'vec2',  label: 'UV'   } }, params: {} },
      { id: 'gl_time', type: 'time', position: { x: 40,  y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'gl_ca', type: 'chromaticAberration', position: { x: 260, y: 240 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'gl_uv',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'gl_time', outputKey: 'time' } },
        },
        outputs: { uv_r: { type: 'vec2', label: 'UV (Red)' }, uv_g: { type: 'vec2', label: 'UV (Green)' }, uv_b: { type: 'vec2', label: 'UV (Blue)' }, offset: { type: 'vec2', label: 'Offset' } },
        params: { mode: 'linear', strength: 0.055, contrast: 1.5, samples: '8', angle_deg: 15.0, animate: 'true', anim_speed: 1.5 },
      },
      {
        id: 'gl_fr', type: 'fbm', position: { x: 540, y: 80 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'gl_ca',   outputKey: 'uv_r' } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'gl_time', outputKey: 'time' } },
        },
        outputs: { value: { type: 'float', label: 'Value' } },
        params: { octaves: 3, scale: 1.5, gain: 0.5, lacunarity: 2.0, time_scale: 0.3 },
      },
      {
        id: 'gl_fg', type: 'fbm', position: { x: 540, y: 240 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'gl_ca',   outputKey: 'uv_g' } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'gl_time', outputKey: 'time' } },
        },
        outputs: { value: { type: 'float', label: 'Value' } },
        params: { octaves: 3, scale: 1.5, gain: 0.5, lacunarity: 2.0, time_scale: 0.3 },
      },
      {
        id: 'gl_fb', type: 'fbm', position: { x: 540, y: 400 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'gl_ca',   outputKey: 'uv_b' } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'gl_time', outputKey: 'time' } },
        },
        outputs: { value: { type: 'float', label: 'Value' } },
        params: { octaves: 3, scale: 1.5, gain: 0.5, lacunarity: 2.0, time_scale: 0.3 },
      },
      {
        id: 'gl_rgb', type: 'combineRGB', position: { x: 780, y: 240 },
        inputs: {
          r: { type: 'float', label: 'R', connection: { nodeId: 'gl_fr', outputKey: 'value' } },
          g: { type: 'float', label: 'G', connection: { nodeId: 'gl_fg', outputKey: 'value' } },
          b: { type: 'float', label: 'B', connection: { nodeId: 'gl_fb', outputKey: 'value' } },
        },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: {},
      },
      { id: 'gl_puv', type: 'pixelUV', position: { x: 260, y: 460 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV (0-1)' } }, params: {} },
      {
        id: 'gl_scn', type: 'scanlines', position: { x: 980, y: 200 },
        inputs: {
          color: { type: 'vec3',  label: 'Color', connection: { nodeId: 'gl_rgb',  outputKey: 'color' } },
          uv:    { type: 'vec2',  label: 'UV',    connection: { nodeId: 'gl_puv',  outputKey: 'uv'    } },
          time:  { type: 'float', label: 'Time',  connection: { nodeId: 'gl_time', outputKey: 'time'  } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } },
        params: { count: 240.0, intensity: 0.25, scroll: 0.5 },
      },
      {
        id: 'gl_out', type: 'output', position: { x: 1180, y: 220 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'gl_scn', outputKey: 'result' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Weighted Noise Octaves — 4 FBMs at different scales blended by weight ─
  weightedNoiseOctaves: {
    label: 'Weighted Noise Octaves',
    counter: 9,
    nodes: [
      { id: 'wno_uv',   type: 'uv',   position: { x: 60, y: 260 }, inputs: {}, outputs: { uv:   { type: 'vec2',  label: 'UV'   } }, params: {} },
      { id: 'wno_time', type: 'time', position: { x: 60, y: 440 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'wno_f1', type: 'fbm', position: { x: 280, y: 60 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'wno_uv',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'wno_time', outputKey: 'time' } },
        },
        outputs: { value: { type: 'float', label: 'Value' } },
        params: { octaves: 6, scale: 1.0, gain: 0.5, lacunarity: 2.0, time_scale: 0.05 },
      },
      {
        id: 'wno_f2', type: 'fbm', position: { x: 280, y: 200 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'wno_uv',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'wno_time', outputKey: 'time' } },
        },
        outputs: { value: { type: 'float', label: 'Value' } },
        params: { octaves: 4, scale: 4.0, gain: 0.5, lacunarity: 2.0, time_scale: 0.1 },
      },
      {
        id: 'wno_f3', type: 'fbm', position: { x: 280, y: 340 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'wno_uv',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'wno_time', outputKey: 'time' } },
        },
        outputs: { value: { type: 'float', label: 'Value' } },
        params: { octaves: 3, scale: 10.0, gain: 0.5, lacunarity: 2.0, time_scale: 0.2 },
      },
      {
        id: 'wno_f4', type: 'fbm', position: { x: 280, y: 480 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'wno_uv',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'wno_time', outputKey: 'time' } },
        },
        outputs: { value: { type: 'float', label: 'Value' } },
        params: { octaves: 2, scale: 22.0, gain: 0.5, lacunarity: 2.0, time_scale: 0.4 },
      },
      {
        id: 'wno_avg', type: 'weightedAverage', position: { x: 560, y: 280 },
        inputs: {
          a: { type: 'float', label: 'A', connection: { nodeId: 'wno_f1', outputKey: 'value' } },
          b: { type: 'float', label: 'B', connection: { nodeId: 'wno_f2', outputKey: 'value' } },
          c: { type: 'float', label: 'C', connection: { nodeId: 'wno_f3', outputKey: 'value' } },
          d: { type: 'float', label: 'D', connection: { nodeId: 'wno_f4', outputKey: 'value' } },
        },
        outputs: { result: { type: 'float', label: 'Result' }, total_weight: { type: 'float', label: 'Total Weight' } },
        params: { w1: 4.0, w2: 2.0, w3: 1.0, w4: 0.5, inputs_used: '4' },
      },
      {
        id: 'wno_pal', type: 'palettePreset', position: { x: 780, y: 280 },
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'wno_avg', outputKey: 'result' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { preset: '6' },
      },
      {
        id: 'wno_out', type: 'output', position: { x: 980, y: 280 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'wno_pal', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Weighted SDF Blend — 2 circles + ring blended by weight → glow ────────
  weightedSdfBlend: {
    label: 'Weighted SDF Blend',
    counter: 9,
    nodes: [
      { id: 'wsb_uv',   type: 'uv',   position: { x: 60, y: 300 }, inputs: {}, outputs: { uv:   { type: 'vec2',  label: 'UV'   } }, params: {} },
      { id: 'wsb_time', type: 'time', position: { x: 60, y: 460 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'wsb_c1', type: 'circleSDF', position: { x: 280, y: 80 },
        inputs:  { position: { type: 'vec2', label: 'Position', connection: { nodeId: 'wsb_uv', outputKey: 'uv' } } },
        outputs: { distance: { type: 'float', label: 'Distance' } },
        params:  { radius: 0.18, posX: -0.35, posY: 0.0 },
      },
      {
        id: 'wsb_c2', type: 'circleSDF', position: { x: 280, y: 240 },
        inputs:  { position: { type: 'vec2', label: 'Position', connection: { nodeId: 'wsb_uv', outputKey: 'uv' } } },
        outputs: { distance: { type: 'float', label: 'Distance' } },
        params:  { radius: 0.28, posX: 0.12, posY: 0.08 },
      },
      {
        id: 'wsb_ring', type: 'ringSDF', position: { x: 280, y: 400 },
        inputs:  { position: { type: 'vec2', label: 'Position', connection: { nodeId: 'wsb_uv', outputKey: 'uv' } } },
        outputs: { distance: { type: 'float', label: 'Distance' } },
        params:  { radius: 0.42, posX: -0.05, posY: 0.0 },
      },
      {
        id: 'wsb_avg', type: 'weightedAverage', position: { x: 560, y: 260 },
        inputs: {
          a: { type: 'float', label: 'A', connection: { nodeId: 'wsb_c1',   outputKey: 'distance' } },
          b: { type: 'float', label: 'B', connection: { nodeId: 'wsb_c2',   outputKey: 'distance' } },
          c: { type: 'float', label: 'C', connection: { nodeId: 'wsb_ring', outputKey: 'distance' } },
        },
        outputs: { result: { type: 'float', label: 'Result' }, total_weight: { type: 'float', label: 'Total Weight' } },
        params: { w1: 2.0, w2: 1.5, w3: 1.0, w4: 0.0, inputs_used: '3' },
      },
      {
        id: 'wsb_pal', type: 'palettePreset', position: { x: 760, y: 160 },
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'wsb_time', outputKey: 'time' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { preset: '5' },
      },
      {
        id: 'wsb_glow', type: 'glowLayer', position: { x: 760, y: 360 },
        inputs: {
          d:     { type: 'float', label: 'SDF',   connection: { nodeId: 'wsb_avg', outputKey: 'result' } },
          color: { type: 'vec3',  label: 'Color', connection: { nodeId: 'wsb_pal', outputKey: 'color'  } },
        },
        outputs: { result: { type: 'vec3', label: 'Glow' } },
        params: { intensity: 0.012, power: 1.3 },
      },
      {
        id: 'wsb_out', type: 'output', position: { x: 980, y: 360 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'wsb_glow', outputKey: 'result' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── COMBINED ─────────────────────────────────────────────────────────────

  // ── Fractal Glow Blur — fractal rings softened with gaussian bloom ─────────
  fractalGlowBlur: {
    label: 'Fractal + Blur Glow',
    counter: 6,
    nodes: [
      { id: 'fgb_uv',   type: 'uv',   position: { x: 40, y: 200 }, inputs: {}, outputs: { uv:   { type: 'vec2',  label: 'UV'   } }, params: {} },
      { id: 'fgb_time', type: 'time', position: { x: 40, y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'fgb_frac', type: 'fractalLoop', position: { x: 260, y: 200 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'fgb_uv',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'fgb_time', outputKey: 'time' } },
        },
        outputs: { color: { type: 'vec3', label: 'Color' }, uv_final: { type: 'vec2', label: 'UV Final' }, uv0: { type: 'vec2', label: 'UV0' } },
        params: { iterations: 5, fract_scale: 1.7, scale_exp: 1.0, ring_freq: 10.0, glow: 0.012, glow_pow: 1.2, iter_offset: 0.3, time_scale: 0.4, offset: [0.5,0.5,0.5], amplitude: [0.5,0.5,0.5], freq: [1.0,1.0,1.0], phase: [0.0,0.33,0.67] },
      },
      {
        id: 'fgb_blur', type: 'gaussianBlur', position: { x: 560, y: 200 },
        inputs: {
          color: { type: 'vec3', label: 'Color', connection: { nodeId: 'fgb_frac', outputKey: 'color' } },
          uv:    { type: 'vec2', label: 'UV',    connection: { nodeId: 'fgb_uv',   outputKey: 'uv'   } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } },
        params: { radius: 3.0, quality: 'standard' },
      },
      {
        id: 'fgb_tone', type: 'toneMap', position: { x: 800, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'fgb_blur', outputKey: 'result' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { mode: 'aces' },
      },
      {
        id: 'fgb_out', type: 'output', position: { x: 1000, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'fgb_tone', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Neon Ring + Chroma — ring SDF split into RGB channels via CA ───────────
  ray3DVignette: {
    label: '3D Sphere + Vignette',
    counter: 7,
    nodes: [
      { id: 'r3v_uv',   type: 'uv',   position: { x: 60, y: 200 }, inputs: {}, outputs: { uv:   { type: 'vec2',  label: 'UV'   } }, params: {} },
      { id: 'r3v_time', type: 'time', position: { x: 60, y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'r3v_scene', type: 'sceneGroup', position: { x: 280, y: 200 },
        inputs:  {},
        outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params:  {
          label: 'Sphere',
          subgraph: {
            nodes: [
              { id: 'r3v_sp',  type: 'scenePos',    position: { x: 100, y: 150 }, inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'r3v_sdf', type: 'sphereSDF3D', position: { x: 300, y: 150 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'r3v_sp', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { radius: 0.65 } },
            ],
            outputNodeId: 'r3v_sdf',
            outputKey:    'dist',
          },
        },
      },
      {
        id: 'r3v_ray', type: 'rayMarch', position: { x: 540, y: 200 },
        inputs: {
          scene: { type: 'scene3d', label: 'Scene', connection: { nodeId: 'r3v_scene', outputKey: 'scene' } },
          uv:    { type: 'vec2',  label: 'UV',    connection: { nodeId: 'r3v_uv',    outputKey: 'uv'   } },
          time:  { type: 'float', label: 'Time',  connection: { nodeId: 'r3v_time',  outputKey: 'time' } },
        },
        outputs: { color: { type: 'vec3', label: 'Color' }, depth: { type: 'float', label: 'Depth' }, normal: { type: 'vec3', label: 'Normal' } },
        params:  { camDist: 2.8, fov: 1.2, maxSteps: 80, maxDist: 20.0, lightX: 2.0, lightY: 3.0, lightZ: 2.5, bgR: 0.02, bgG: 0.02, bgB: 0.05, albedoR: 0.3, albedoG: 0.7, albedoB: 1.0 },
      },
      { id: 'r3v_puv', type: 'pixelUV', position: { x: 540, y: 380 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV (0-1)' } }, params: {} },
      {
        id: 'r3v_vig', type: 'vignette', position: { x: 780, y: 220 },
        inputs: {
          color: { type: 'vec3', label: 'Color', connection: { nodeId: 'r3v_ray', outputKey: 'color' } },
          uv:    { type: 'vec2', label: 'UV',    connection: { nodeId: 'r3v_puv', outputKey: 'uv'   } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } },
        params:  { radius: 0.7, softness: 0.4, strength: 1.0 },
      },
      {
        id: 'r3v_out', type: 'output', position: { x: 980, y: 220 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'r3v_vig', outputKey: 'result' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Warped 3D View — smooth UV warp fed into raymarched torus ─────────────
  swirlRay3D: {
    label: 'Swirl + 3D Scene',
    counter: 7,
    nodes: [
      { id: 'sw3_uv',   type: 'uv',   position: { x: 60, y: 200 }, inputs: {}, outputs: { uv:   { type: 'vec2',  label: 'UV'   } }, params: {} },
      { id: 'sw3_time', type: 'time', position: { x: 60, y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'sw3_swirl', type: 'swirlSpace', position: { x: 280, y: 180 },
        inputs: {
          input:    { type: 'vec2',  label: 'UV', connection: { nodeId: 'sw3_uv', outputKey: 'uv' } },
          strength: { type: 'float', label: 'Strength' },
          falloff:  { type: 'float', label: 'Falloff'  },
        },
        outputs: { output: { type: 'vec2', label: 'Swirled UV' } },
        params: { strength: 3.0, falloff: 1.2 },
      },
      {
        id: 'sw3_scene', type: 'sceneGroup', position: { x: 280, y: 360 },
        inputs:  {},
        outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params:  {
          label: 'Sphere',
          subgraph: {
            nodes: [
              { id: 'sw3_sp',  type: 'scenePos',    position: { x: 100, y: 150 }, inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'sw3_sdf', type: 'sphereSDF3D', position: { x: 300, y: 150 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sw3_sp', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { radius: 0.7 } },
            ],
            outputNodeId: 'sw3_sdf',
            outputKey:    'dist',
          },
        },
      },
      {
        id: 'sw3_ray', type: 'rayMarch', position: { x: 540, y: 240 },
        inputs: {
          scene: { type: 'scene3d', label: 'Scene',  connection: { nodeId: 'sw3_scene', outputKey: 'scene'  } },
          uv:    { type: 'vec2',  label: 'UV',      connection: { nodeId: 'sw3_swirl', outputKey: 'output' } },
          time:  { type: 'float', label: 'Time',    connection: { nodeId: 'sw3_time',  outputKey: 'time'   } },
        },
        outputs: { color: { type: 'vec3', label: 'Color' }, depth: { type: 'float', label: 'Depth' }, normal: { type: 'vec3', label: 'Normal' } },
        params:  { camDist: 3.0, fov: 1.5, maxSteps: 80, maxDist: 20.0, lightX: 2.0, lightY: 2.5, lightZ: 2.0, bgR: 0.04, bgG: 0.02, bgB: 0.08, albedoR: 0.5, albedoG: 0.3, albedoB: 1.0 },
      },
      {
        id: 'sw3_tone', type: 'toneMap', position: { x: 780, y: 260 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'sw3_ray', outputKey: 'color' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { mode: 'aces' },
      },
      {
        id: 'sw3_out', type: 'output', position: { x: 980, y: 260 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'sw3_tone', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Voronoi Bokeh — voronoi glow field with lens blur depth of field ───────
  kaleido3DBox: {
    label: 'Kaleido + 3D Box',
    counter: 7,
    nodes: [
      { id: 'k3b_uv',   type: 'uv',   position: { x: 60, y: 200 }, inputs: {}, outputs: { uv:   { type: 'vec2',  label: 'UV'   } }, params: {} },
      { id: 'k3b_time', type: 'time', position: { x: 60, y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'k3b_kal', type: 'kaleidoSpace', position: { x: 280, y: 180 },
        inputs: {
          input:    { type: 'vec2',  label: 'UV',       connection: { nodeId: 'k3b_uv', outputKey: 'uv' } },
          segments: { type: 'float', label: 'Segments' },
          rotate:   { type: 'float', label: 'Rotate'   },
        },
        outputs: { output: { type: 'vec2', label: 'Folded UV' } },
        params: { segments: 8.0, rotate: 0.0 },
      },
      {
        id: 'k3b_scene', type: 'sceneGroup', position: { x: 280, y: 360 },
        inputs:  {},
        outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params:  {
          label: 'Box',
          subgraph: {
            nodes: [
              { id: 'k3b_sg',  type: 'scenePos', position: { x: 100, y: 150 }, inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'k3b_box', type: 'boxSDF3D', position: { x: 300, y: 150 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'k3b_sg', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { sizeX: 0.4, sizeY: 0.4, sizeZ: 0.4 } },
            ],
            outputNodeId: 'k3b_box',
            outputKey:    'dist',
          },
        },
      },
      {
        id: 'k3b_ray', type: 'rayMarch', position: { x: 540, y: 240 },
        inputs: {
          scene: { type: 'scene3d', label: 'Scene', connection: { nodeId: 'k3b_scene', outputKey: 'scene'  } },
          uv:    { type: 'vec2',  label: 'UV',    connection: { nodeId: 'k3b_kal',   outputKey: 'output' } },
          time:  { type: 'float', label: 'Time',  connection: { nodeId: 'k3b_time',  outputKey: 'time'   } },
        },
        outputs: { color: { type: 'vec3', label: 'Color' }, depth: { type: 'float', label: 'Depth' }, normal: { type: 'vec3', label: 'Normal' } },
        params:  { camDist: 3.5, fov: 1.5, maxSteps: 64, maxDist: 20.0, lightX: 2.0, lightY: 3.0, lightZ: 2.0, bgR: 0.02, bgG: 0.03, bgB: 0.05, albedoR: 0.8, albedoG: 0.5, albedoB: 0.2 },
      },
      {
        id: 'k3b_tone', type: 'toneMap', position: { x: 780, y: 260 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'k3b_ray', outputKey: 'color' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { mode: 'aces' },
      },
      {
        id: 'k3b_out', type: 'output', position: { x: 980, y: 260 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'k3b_tone', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Sobel Neon Glow — fractal with sobel edge detection + glowing palette ──
  translate3D: {
    label: '3D: Translate',
    counter: 4,
    nodes: [
      { id: 't3d_uv',   type: 'uv',   position: { x: 50, y: 80  }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 't3d_time', type: 'time', position: { x: 50, y: 180 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 't3d_scene', type: 'sceneGroup', position: { x: 300, y: 120 },
        inputs: {},
        outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: '3D: Translate',
          subgraph: {
            nodes: [
              {
                id: 't3d_sp', type: 'scenePos', position: { x: 60, y: 150 },
                inputs: {},
                outputs: { pos: { type: 'vec3', label: 'Position' } },
                params: {},
              },
              {
                id: 't3d_tr', type: 'translate3D', position: { x: 240, y: 150 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 't3d_sp', outputKey: 'pos' } } },
                outputs: { pos: { type: 'vec3', label: 'Translated Pos' } },
                params: { tx: 0.7, ty: 0.0, tz: 0.0 },
              },
              {
                id: 't3d_sdf', type: 'sphereSDF3D', position: { x: 430, y: 150 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 't3d_tr', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } },
                params: { radius: 0.5 },
              },
            ],
            outputNodeId: 't3d_sdf',
            outputKey: 'dist',
          },
        },
      },
      {
        id: 't3d_ray', type: 'rayMarch', position: { x: 560, y: 80 },
        inputs: {
          scene: { type: 'scene3d', label: 'Scene', connection: { nodeId: 't3d_scene', outputKey: 'scene' } },
          uv:    { type: 'vec2',   label: 'UV',    connection: { nodeId: 't3d_uv',    outputKey: 'uv'   } },
          time:  { type: 'float',  label: 'Time',  connection: { nodeId: 't3d_time',  outputKey: 'time' } },
        },
        outputs: { color: { type: 'vec3', label: 'Color' }, dist: { type: 'float', label: 'Dist' }, depth: { type: 'float', label: 'Depth' }, normal: { type: 'vec3', label: 'Normal' }, iter: { type: 'float', label: 'Iter' }, iterCount: { type: 'float', label: 'Iter Count' }, hit: { type: 'float', label: 'Hit' } },
        params: { camDist: 2.5, camAngle: 0.4, camRotSpeed: 0.0, fov: 1.5, maxSteps: 64, maxDist: 20.0, bgR: 0.05, bgG: 0.05, bgB: 0.08 },
      },
      {
        id: 't3d_out', type: 'output', position: { x: 860, y: 140 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 't3d_ray', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── 3D: Rotate — animated spinning box ───────────────────────────────────────
  rotate3D: {
    label: '3D: Rotate',
    counter: 5,
    nodes: [
      { id: 'r3d_uv',   type: 'uv',   position: { x: 50, y: 80  }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'r3d_time', type: 'time', position: { x: 50, y: 180 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'r3d_scene', type: 'sceneGroup', position: { x: 300, y: 120 },
        inputs: {},
        outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: '3D: Rotate',
          subgraph: {
            nodes: [
              {
                id: 'r3d_sp', type: 'scenePos', position: { x: 60, y: 150 },
                inputs: {},
                outputs: { pos: { type: 'vec3', label: 'Position' } },
                params: {},
              },
              {
                id: 'r3d_t', type: 'time', position: { x: 60, y: 280 },
                inputs: {},
                outputs: { time: { type: 'float', label: 'Time' } },
                params: {},
              },
              {
                id: 'r3d_rot', type: 'rotate3D', position: { x: 240, y: 150 },
                inputs: {
                  pos:   { type: 'vec3',  label: 'Position', connection: { nodeId: 'r3d_sp', outputKey: 'pos'  } },
                  angle: { type: 'float', label: 'Angle',    connection: { nodeId: 'r3d_t',  outputKey: 'time' } },
                },
                outputs: { pos: { type: 'vec3', label: 'Rotated Pos' } },
                params: { axis: 'y', angle: 0.0 },
              },
              {
                id: 'r3d_sdf', type: 'boxSDF3D', position: { x: 430, y: 150 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'r3d_rot', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } },
                params: { sizeX: 0.4, sizeY: 0.4, sizeZ: 0.4 },
              },
            ],
            outputNodeId: 'r3d_sdf',
            outputKey: 'dist',
          },
        },
      },
      {
        id: 'r3d_ray', type: 'rayMarch', position: { x: 560, y: 80 },
        inputs: {
          scene: { type: 'scene3d', label: 'Scene', connection: { nodeId: 'r3d_scene', outputKey: 'scene' } },
          uv:    { type: 'vec2',   label: 'UV',    connection: { nodeId: 'r3d_uv',    outputKey: 'uv'   } },
          time:  { type: 'float',  label: 'Time',  connection: { nodeId: 'r3d_time',  outputKey: 'time' } },
        },
        outputs: { color: { type: 'vec3', label: 'Color' }, dist: { type: 'float', label: 'Dist' }, depth: { type: 'float', label: 'Depth' }, normal: { type: 'vec3', label: 'Normal' }, iter: { type: 'float', label: 'Iter' }, iterCount: { type: 'float', label: 'Iter Count' }, hit: { type: 'float', label: 'Hit' } },
        params: { camDist: 2.5, camAngle: 0.3, camRotSpeed: 0.0, fov: 1.5, maxSteps: 64, maxDist: 20.0, bgR: 0.05, bgG: 0.05, bgB: 0.08 },
      },
      {
        id: 'r3d_out', type: 'output', position: { x: 860, y: 140 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'r3d_ray', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── 3D: Fold Symmetry — fold mirrors space, 1 sphere becomes 4 ───────────────
  fold3D: {
    label: '3D: Fold Symmetry',
    counter: 4,
    nodes: [
      { id: 'fd3_uv',   type: 'uv',   position: { x: 50, y: 80  }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'fd3_time', type: 'time', position: { x: 50, y: 180 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'fd3_scene', type: 'sceneGroup', position: { x: 300, y: 120 },
        inputs: {},
        outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: '3D: Fold Symmetry',
          subgraph: {
            nodes: [
              {
                id: 'fd3_sp', type: 'scenePos', position: { x: 60, y: 150 },
                inputs: {},
                outputs: { pos: { type: 'vec3', label: 'Position' } },
                params: {},
              },
              {
                id: 'fd3_fold', type: 'fold3D', position: { x: 240, y: 150 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'fd3_sp', outputKey: 'pos' } } },
                outputs: { pos: { type: 'vec3', label: 'Folded Pos' } },
                params: { foldX: true, foldY: false, foldZ: true },
              },
              {
                id: 'fd3_tr', type: 'translate3D', position: { x: 420, y: 150 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'fd3_fold', outputKey: 'pos' } } },
                outputs: { pos: { type: 'vec3', label: 'Translated Pos' } },
                params: { tx: 0.8, ty: 0.0, tz: 0.8 },
              },
              {
                id: 'fd3_sdf', type: 'sphereSDF3D', position: { x: 610, y: 150 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'fd3_tr', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } },
                params: { radius: 0.3 },
              },
            ],
            outputNodeId: 'fd3_sdf',
            outputKey: 'dist',
          },
        },
      },
      {
        id: 'fd3_ray', type: 'rayMarch', position: { x: 560, y: 80 },
        inputs: {
          scene: { type: 'scene3d', label: 'Scene', connection: { nodeId: 'fd3_scene', outputKey: 'scene' } },
          uv:    { type: 'vec2',   label: 'UV',    connection: { nodeId: 'fd3_uv',    outputKey: 'uv'   } },
          time:  { type: 'float',  label: 'Time',  connection: { nodeId: 'fd3_time',  outputKey: 'time' } },
        },
        outputs: { color: { type: 'vec3', label: 'Color' }, dist: { type: 'float', label: 'Dist' }, depth: { type: 'float', label: 'Depth' }, normal: { type: 'vec3', label: 'Normal' }, iter: { type: 'float', label: 'Iter' }, iterCount: { type: 'float', label: 'Iter Count' }, hit: { type: 'float', label: 'Hit' } },
        params: { camDist: 3.5, camAngle: 0.5, camRotSpeed: 0.0, fov: 1.5, maxSteps: 80, maxDist: 20.0, bgR: 0.04, bgG: 0.04, bgB: 0.08 },
      },
      {
        id: 'fd3_out', type: 'output', position: { x: 860, y: 140 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'fd3_ray', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── 3D: Sin Warp — distort sphere surface into organic wobbling ───────────────
  sinWarp3D: {
    label: '3D: Sin Warp',
    counter: 4,
    nodes: [
      { id: 'sw3_uv',   type: 'uv',   position: { x: 50, y: 80  }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'sw3_time', type: 'time', position: { x: 50, y: 180 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'sw3_scene', type: 'sceneGroup', position: { x: 300, y: 120 },
        inputs: {},
        outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: '3D: Sin Warp',
          subgraph: {
            nodes: [
              {
                id: 'sw3_sp', type: 'scenePos', position: { x: 60, y: 150 },
                inputs: {},
                outputs: { pos: { type: 'vec3', label: 'Position' } },
                params: {},
              },
              {
                id: 'sw3_t', type: 'time', position: { x: 60, y: 280 },
                inputs: {},
                outputs: { time: { type: 'float', label: 'Time' } },
                params: {},
              },
              {
                id: 'sw3_warp', type: 'sinWarp3D', position: { x: 240, y: 150 },
                inputs: {
                  p:    { type: 'vec3',  label: 'Position', connection: { nodeId: 'sw3_sp', outputKey: 'pos'  } },
                  time: { type: 'float', label: 'Time',     connection: { nodeId: 'sw3_t',  outputKey: 'time' } },
                },
                outputs: { p: { type: 'vec3', label: 'Warped Pos' } },
                params: { distort_axis: 'y', source_axis: 'x', frequency: 4.0, amplitude: 0.15 },
              },
              {
                id: 'sw3_sdf', type: 'sphereSDF3D', position: { x: 430, y: 150 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sw3_warp', outputKey: 'p' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } },
                params: { radius: 0.5 },
              },
            ],
            outputNodeId: 'sw3_sdf',
            outputKey: 'dist',
          },
        },
      },
      {
        id: 'sw3_ray', type: 'rayMarch', position: { x: 560, y: 80 },
        inputs: {
          scene: { type: 'scene3d', label: 'Scene', connection: { nodeId: 'sw3_scene', outputKey: 'scene' } },
          uv:    { type: 'vec2',   label: 'UV',    connection: { nodeId: 'sw3_uv',    outputKey: 'uv'   } },
          time:  { type: 'float',  label: 'Time',  connection: { nodeId: 'sw3_time',  outputKey: 'time' } },
        },
        outputs: { color: { type: 'vec3', label: 'Color' }, dist: { type: 'float', label: 'Dist' }, depth: { type: 'float', label: 'Depth' }, normal: { type: 'vec3', label: 'Normal' }, iter: { type: 'float', label: 'Iter' }, iterCount: { type: 'float', label: 'Iter Count' }, hit: { type: 'float', label: 'Hit' } },
        params: { camDist: 2.5, camAngle: 0.4, camRotSpeed: 0.0, fov: 1.5, maxSteps: 64, maxDist: 20.0, bgR: 0.04, bgG: 0.04, bgB: 0.08 },
      },
      {
        id: 'sw3_out', type: 'output', position: { x: 860, y: 140 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'sw3_ray', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── 3D: Repeat / Tile — infinite tiling of one box definition ────────────────
  repeat3D: {
    label: '3D: Repeat / Tile',
    counter: 4,
    nodes: [
      { id: 'rp3_uv',   type: 'uv',   position: { x: 50, y: 80  }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'rp3_time', type: 'time', position: { x: 50, y: 180 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'rp3_scene', type: 'sceneGroup', position: { x: 300, y: 120 },
        inputs: {},
        outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: '3D: Repeat / Tile',
          subgraph: {
            nodes: [
              {
                id: 'rp3_sp', type: 'scenePos', position: { x: 60, y: 150 },
                inputs: {},
                outputs: { pos: { type: 'vec3', label: 'Position' } },
                params: {},
              },
              {
                id: 'rp3_rep', type: 'repeat3D', position: { x: 240, y: 150 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'rp3_sp', outputKey: 'pos' } } },
                outputs: { pos: { type: 'vec3', label: 'Repeated Pos' } },
                params: { cellX: 1.6, cellY: 1.6, cellZ: 1.6 },
              },
              {
                id: 'rp3_box', type: 'boxSDF3D', position: { x: 430, y: 150 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'rp3_rep', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } },
                params: { sizeX: 0.45, sizeY: 0.45, sizeZ: 0.45 },
              },
            ],
            outputNodeId: 'rp3_box',
            outputKey: 'dist',
          },
        },
      },
      {
        id: 'rp3_ray', type: 'rayMarch', position: { x: 560, y: 80 },
        inputs: {
          scene: { type: 'scene3d', label: 'Scene', connection: { nodeId: 'rp3_scene', outputKey: 'scene' } },
          uv:    { type: 'vec2',   label: 'UV',    connection: { nodeId: 'rp3_uv',    outputKey: 'uv'   } },
          time:  { type: 'float',  label: 'Time',  connection: { nodeId: 'rp3_time',  outputKey: 'time' } },
        },
        outputs: { color: { type: 'vec3', label: 'Color' }, dist: { type: 'float', label: 'Dist' }, depth: { type: 'float', label: 'Depth' }, normal: { type: 'vec3', label: 'Normal' }, iter: { type: 'float', label: 'Iter' }, iterCount: { type: 'float', label: 'Iter Count' }, hit: { type: 'float', label: 'Hit' } },
        params: { camDist: 4.0, camAngle: 0.5, camRotSpeed: 0.0, fov: 1.5, maxSteps: 96, maxDist: 30.0, bgR: 0.04, bgG: 0.04, bgB: 0.08 },
      },
      {
        id: 'rp3_out', type: 'output', position: { x: 860, y: 140 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'rp3_ray', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── 3D: Ground Plane — sphere + plane via SDF union (minMath) ────────────────
  planeSDF3D: {
    label: '3D: Ground Plane',
    counter: 4,
    nodes: [
      { id: 'pl3_uv',   type: 'uv',   position: { x: 50, y: 80  }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'pl3_time', type: 'time', position: { x: 50, y: 180 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'pl3_scene', type: 'sceneGroup', position: { x: 300, y: 120 },
        inputs: {},
        outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: '3D: Ground Plane',
          subgraph: {
            nodes: [
              {
                id: 'pl3_sp', type: 'scenePos', position: { x: 60, y: 200 },
                inputs: {},
                outputs: { pos: { type: 'vec3', label: 'Position' } },
                params: {},
              },
              {
                id: 'pl3_tr', type: 'translate3D', position: { x: 240, y: 100 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'pl3_sp', outputKey: 'pos' } } },
                outputs: { pos: { type: 'vec3', label: 'Translated Pos' } },
                params: { tx: 0.0, ty: 0.35, tz: 0.0 },
              },
              {
                id: 'pl3_sdf', type: 'sphereSDF3D', position: { x: 430, y: 100 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'pl3_tr', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } },
                params: { radius: 0.35 },
              },
              {
                id: 'pl3_plane', type: 'planeSDF3D', position: { x: 240, y: 300 },
                inputs: { p: { type: 'vec3', label: 'Position', connection: { nodeId: 'pl3_sp', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } },
                params: { height: -0.35 },
              },
              {
                id: 'pl3_min', type: 'minMath', position: { x: 630, y: 200 },
                inputs: {
                  a: { type: 'float', label: 'A', connection: { nodeId: 'pl3_sdf', outputKey: 'dist' } },
                  b: { type: 'float', label: 'B', connection: { nodeId: 'pl3_plane', outputKey: 'dist' } },
                },
                outputs: { result: { type: 'float', label: 'Result' } },
                params: {},
              },
            ],
            outputNodeId: 'pl3_min',
            outputKey: 'result',
          },
        },
      },
      {
        id: 'pl3_ray', type: 'rayMarch', position: { x: 560, y: 80 },
        inputs: {
          scene: { type: 'scene3d', label: 'Scene', connection: { nodeId: 'pl3_scene', outputKey: 'scene' } },
          uv:    { type: 'vec2',   label: 'UV',    connection: { nodeId: 'pl3_uv',    outputKey: 'uv'   } },
          time:  { type: 'float',  label: 'Time',  connection: { nodeId: 'pl3_time',  outputKey: 'time' } },
        },
        outputs: { color: { type: 'vec3', label: 'Color' }, dist: { type: 'float', label: 'Dist' }, depth: { type: 'float', label: 'Depth' }, normal: { type: 'vec3', label: 'Normal' }, iter: { type: 'float', label: 'Iter' }, iterCount: { type: 'float', label: 'Iter Count' }, hit: { type: 'float', label: 'Hit' } },
        params: { camDist: 3.0, camAngle: 0.3, camRotSpeed: 0.0, fov: 1.5, maxSteps: 80, maxDist: 20.0, bgR: 0.05, bgG: 0.06, bgB: 0.10 },
      },
      {
        id: 'pl3_out', type: 'output', position: { x: 860, y: 140 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'pl3_ray', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── 3D: Ray March Outputs — showcase all rayMarch output sockets ──────────────
  rayMarchOutputs3D: {
    label: '3D: Ray March Outputs',
    counter: 4,
    nodes: [
      { id: 'ro3_uv',   type: 'uv',   position: { x: 50, y: 80  }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'ro3_time', type: 'time', position: { x: 50, y: 180 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'ro3_scene', type: 'sceneGroup', position: { x: 300, y: 120 },
        inputs: {},
        outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: '3D: Ray March Outputs',
          subgraph: {
            nodes: [
              {
                id: 'ro3_sp', type: 'scenePos', position: { x: 80, y: 150 },
                inputs: {},
                outputs: { pos: { type: 'vec3', label: 'Position' } },
                params: {},
              },
              {
                id: 'ro3_sdf', type: 'sphereSDF3D', position: { x: 280, y: 150 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'ro3_sp', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } },
                params: { radius: 0.5 },
              },
            ],
            outputNodeId: 'ro3_sdf',
            outputKey: 'dist',
          },
        },
      },
      {
        id: 'ro3_ray', type: 'rayMarch', position: { x: 560, y: 80 },
        inputs: {
          scene: { type: 'scene3d', label: 'Scene', connection: { nodeId: 'ro3_scene', outputKey: 'scene' } },
          uv:    { type: 'vec2',   label: 'UV',    connection: { nodeId: 'ro3_uv',    outputKey: 'uv'   } },
          time:  { type: 'float',  label: 'Time',  connection: { nodeId: 'ro3_time',  outputKey: 'time' } },
        },
        outputs: { color: { type: 'vec3', label: 'Color' }, dist: { type: 'float', label: 'Dist' }, depth: { type: 'float', label: 'Depth' }, normal: { type: 'vec3', label: 'Normal' }, iter: { type: 'float', label: 'Iter' }, iterCount: { type: 'float', label: 'Iter Count' }, hit: { type: 'float', label: 'Hit' } },
        params: { camDist: 2.5, camAngle: 0.5, camRotSpeed: 0.0, fov: 1.5, maxSteps: 64, maxDist: 20.0, bgR: 0.06, bgG: 0.06, bgB: 0.10 },
      },
      {
        id: 'ro3_out', type: 'output', position: { x: 860, y: 140 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'ro3_ray', outputKey: 'normal' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Motion Blur Fractal — fractal rings with feedback motion blur ──────────
  mlgRepeatGrid: {
    label: 'MLG: Repeat Grid',
    counter: 8,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 60,  y: 100 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 60,  y: 240 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'cam_2', type: 'marchCamera', position: { x: 260, y: 160 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { ro: { type: 'vec3', label: 'Ray Origin' }, rd: { type: 'vec3', label: 'Ray Dir' } },
        params: { camDist: 4.0, camAngle: 0.6, rotSpeed: 0.2, fov: 1.5 },
      },
      {
        id: 'scene_3', type: 'sceneGroup', position: { x: 500, y: 360 },
        inputs: {},
        outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: 'Box Grid',
          subgraph: {
            nodes: [
              { id: 'sp',  type: 'scenePos', position: { x: 60,  y: 140 }, inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'rep', type: 'repeat3D', position: { x: 240, y: 140 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp', outputKey: 'pos' } } },
                outputs: { pos: { type: 'vec3', label: 'Repeated Pos' } }, params: { cellX: 3.0, cellY: 3.0, cellZ: 3.0 } },
              { id: 'sd',  type: 'boxSDF3D', position: { x: 440, y: 140 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'rep', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { sizeX: 0.5, sizeY: 0.5, sizeZ: 0.1 } },
            ],
            inputPorts: [], outputPorts: [],
          },
        },
      },
      {
        id: 'mlg_4', type: 'marchLoopGroup', position: { x: 760, y: 180 },
        inputs: {
          ro:    { type: 'vec3',    label: 'Ray Origin', connection: { nodeId: 'cam_2',   outputKey: 'ro'    } },
          rd:    { type: 'vec3',    label: 'Ray Dir',    connection: { nodeId: 'cam_2',   outputKey: 'rd'    } },
          scene: { type: 'scene3d', label: 'Scene',      connection: { nodeId: 'scene_3', outputKey: 'scene' } },
          uv:   { type: 'vec2',  label: 'UV' },
          time: { type: 'float', label: 'Time' },
        },
        outputs: { color: { type: 'vec3', label: 'Color' }, normal: { type: 'vec3', label: 'Normal' }, dist: { type: 'float', label: 'Dist' }, iter: { type: 'float', label: 'Iter' }, iterCount: { type: 'float', label: 'Iter Count' }, hit: { type: 'float', label: 'Hit' }, depth: { type: 'float', label: 'Depth' }, pos: { type: 'vec3', label: 'Hit Pos' } },
        params: {
          maxSteps: 80, maxDist: 30.0, stepScale: 1.0, bgR: 0.05, bgG: 0.05, bgB: 0.05,
          subgraph: {
            nodes: [
              { id: 'mp', type: 'marchPos',  position: { x: 100, y: 140 }, inputs: {}, outputs: { pos:  { type: 'vec3',  label: 'March Pos'  } }, params: {} },
              { id: 'md', type: 'marchDist', position: { x: 100, y: 260 }, inputs: {}, outputs: { dist: { type: 'float', label: 'March Dist' }, t: { type: 'float', label: 't' } }, params: {} },
              { id: 'marchout', type: 'marchOutput', position: { x: 340, y: 140 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'mp', outputKey: 'pos' } } },
                outputs: {}, params: {} },
            ],
            inputPorts: [], outputPorts: [],
          },
        },
      },
      {
        id: 'output_5', type: 'output', position: { x: 1020, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'mlg_4', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  mlgWiggleTunnel: {
    label: 'MLG: Wiggle Tunnel',
    counter: 11,
    nodes: [
      { id: 'uv_0',    type: 'uv',    position: { x: 60,  y:  80 }, inputs: {}, outputs: { uv:    { type: 'vec2',  label: 'UV'    } }, params: {} },
      { id: 'time_1',  type: 'time',  position: { x: 60,  y: 200 }, inputs: {}, outputs: { time:  { type: 'float', label: 'Time'  } }, params: {} },
      { id: 'mouse_m', type: 'mouse', position: { x: 60,  y: 320 }, inputs: {}, outputs: { mouse: { type: 'vec2', label: 'Mouse' }, x: { type: 'float', label: 'Mouse X' }, y: { type: 'float', label: 'Mouse Y' } }, params: {} },
      {
        id: 'cam_2', type: 'marchCamera', position: { x: 260, y: 140 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { ro: { type: 'vec3', label: 'Ray Origin' }, rd: { type: 'vec3', label: 'Ray Dir' } },
        params: { camDist: 3.0, camAngle: 0.0, rotSpeed: 0.0, fov: 1.5 },
      },
      {
        id: 'scene_3', type: 'sceneGroup', position: { x: 500, y: 400 },
        inputs: {},
        outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: 'Repeated Octahedra',
          subgraph: {
            nodes: [
              { id: 'sp',  type: 'scenePos',       position: { x: 60,  y: 140 }, inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'rep', type: 'repeat3D',        position: { x: 240, y: 140 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp', outputKey: 'pos' } } },
                outputs: { pos: { type: 'vec3', label: 'Repeated Pos' } }, params: { cellX: 1.0, cellY: 1.0, cellZ: 0.25 } },
              { id: 'sd',  type: 'octahedronSDF3D', position: { x: 440, y: 140 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'rep', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { size: 0.125 } },
            ],
            inputPorts: [], outputPorts: [],
          },
        },
      },
      {
        id: 'mlg_4', type: 'marchLoopGroup', position: { x: 760, y: 180 },
        inputs: {
          ro:    { type: 'vec3',    label: 'Ray Origin', connection: { nodeId: 'cam_2',   outputKey: 'ro'    } },
          rd:    { type: 'vec3',    label: 'Ray Dir',    connection: { nodeId: 'cam_2',   outputKey: 'rd'    } },
          scene: { type: 'scene3d', label: 'Scene',      connection: { nodeId: 'scene_3', outputKey: 'scene' } },
          uv:   { type: 'vec2',  label: 'UV' },
          time: { type: 'float', label: 'Time' },
        },
        outputs: { color: { type: 'vec3', label: 'Color' }, normal: { type: 'vec3', label: 'Normal' }, dist: { type: 'float', label: 'Dist' }, iter: { type: 'float', label: 'Iter' }, iterCount: { type: 'float', label: 'Iter Count' }, hit: { type: 'float', label: 'Hit' }, depth: { type: 'float', label: 'Depth' }, pos: { type: 'vec3', label: 'Hit Pos' } },
        params: {
          maxSteps: 80, maxDist: 100.0, stepScale: 1.0, bgR: 0.0, bgG: 0.0, bgB: 0.0,
          subgraph: {
            nodes: [
              { id: 'mp',    type: 'marchPos',  position: { x: 80,  y: 100 }, inputs: {}, outputs: { pos:  { type: 'vec3',  label: 'March Pos'  } }, params: {} },
              { id: 'md',    type: 'marchDist', position: { x: 80,  y: 220 }, inputs: {}, outputs: { dist: { type: 'float', label: 'March Dist' } }, params: {} },
              { id: 'time_b', type: 'time',     position: { x: 80,  y: 340 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time'       } }, params: {} },
              { id: 'mouse_b', type: 'mouse',   position: { x: 80,  y: 460 }, inputs: {}, outputs: { mouse: { type: 'vec2', label: 'Mouse' }, x: { type: 'float', label: 'X' }, y: { type: 'float', label: 'Y' } }, params: {} },
              { id: 'warp', type: 'exprNode', position: { x: 380, y: 220 },
                inputs: {
                  p:    { type: 'vec3',  label: 'p (vec3)',   connection: { nodeId: 'mp',     outputKey: 'pos'  } },
                  t:    { type: 'float', label: 't (float)',  connection: { nodeId: 'md',     outputKey: 'dist' } },
                  time: { type: 'float', label: 'time',       connection: { nodeId: 'time_b', outputKey: 'time' } },
                  mx:   { type: 'float', label: 'mx (mouse x)', connection: { nodeId: 'mouse_b', outputKey: 'x' } },
                  my:   { type: 'float', label: 'my (mouse y)', connection: { nodeId: 'mouse_b', outputKey: 'y' } },
                  a:    { type: 'float', label: 'a (float)' },
                  b:    { type: 'float', label: 'b (float)' },
                },
                outputs: { result: { type: 'vec3', label: 'Result (vec3)' } },
                params: {
                  lines: [
                    { lhs: 'p.xy', op: '=', rhs: 'p.xy * rot2D(t * 0.3 + time * 0.2)' },
                    { lhs: 'p.y', op: '+=', rhs: 'sin(t * (my + 1.0) * 0.5) * 0.35' },
                  ],
                  result: 'p',
                  expr: 'p.xy = p.xy * rot2D(t * 0.3 + time * 0.2); p.y += sin(t * (my + 1.0) * 0.5) * 0.35; p',
                  outputType: 'vec3',
                } },
              { id: 'marchout', type: 'marchOutput', position: { x: 660, y: 220 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'warp', outputKey: 'result' } } },
                outputs: {}, params: {} },
            ],
            inputPorts: [], outputPorts: [],
          },
        },
      },
      {
        id: 'muld_5', type: 'multiply', position: { x: 1020, y: 120 },
        inputs: { a: { type: 'float', label: 'A', connection: { nodeId: 'mlg_4', outputKey: 'dist' } }, b: { type: 'float', label: 'B' } },
        outputs: { result: { type: 'float', label: 'Result' } },
        params: { b: 0.04 },
      },
      {
        id: 'muli_6', type: 'multiply', position: { x: 1020, y: 280 },
        inputs: { a: { type: 'float', label: 'A', connection: { nodeId: 'mlg_4', outputKey: 'iterCount' } }, b: { type: 'float', label: 'B' } },
        outputs: { result: { type: 'float', label: 'Result' } },
        params: { b: 0.005 },
      },
      {
        id: 'add_7', type: 'add', position: { x: 1200, y: 200 },
        inputs: {
          a: { type: 'float', label: 'A', connection: { nodeId: 'muld_5', outputKey: 'result' } },
          b: { type: 'float', label: 'B', connection: { nodeId: 'muli_6', outputKey: 'result' } },
        },
        outputs: { result: { type: 'float', label: 'Result' } },
        params: { b: 0 },
      },
      {
        id: 'pal_8', type: 'palette', position: { x: 1400, y: 180 },
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'add_7', outputKey: 'result' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { offset: [0.5, 0.5, 0.5], amplitude: [0.5, 0.5, 0.5], freq: [1, 1, 1], phase: [0.3, 0.416, 0.557] },
      },
      {
        id: 'output_9', type: 'output', position: { x: 1640, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'pal_8', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  sdfPolarRepeat: {
    label: '3D: Polar Repeat — Radial Symmetry',
    counter: 12,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 60,  y: 100 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 60,  y: 240 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'cam_2', type: 'marchCamera', position: { x: 260, y: 160 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { ro: { type: 'vec3', label: 'Ray Origin' }, rd: { type: 'vec3', label: 'Ray Dir' } },
        params: { camDist: 3.0, camAngle: 0.4, rotSpeed: 0.15, fov: 1.5 },
      },
      {
        id: 'scene_3', type: 'sceneGroup', position: { x: 500, y: 360 },
        inputs: {},
        outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: 'Radial Boxes',
          subgraph: {
            nodes: [
              { id: 'sp', type: 'scenePos', position: { x: 60, y: 180 }, inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'pr', type: 'polarRepeat3D', position: { x: 260, y: 180 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp', outputKey: 'pos' } } },
                outputs: { pos: { type: 'vec3', label: 'Repeated Pos' } }, params: { count: 8.0, axis: 'y' } },
              { id: 'tr', type: 'translate3D', position: { x: 460, y: 180 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'pr', outputKey: 'pos' } } },
                outputs: { pos: { type: 'vec3', label: 'Translated Pos' } }, params: { tx: 0.8, ty: 0.0, tz: 0.0 } },
              { id: 'box', type: 'boxSDF3D', position: { x: 660, y: 180 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'tr', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { sizeX: 0.15, sizeY: 0.3, sizeZ: 0.15 } },
            ],
            inputPorts: [], outputPorts: [],
          },
        },
      },
      {
        id: 'mlg_4', type: 'marchLoopGroup', position: { x: 760, y: 180 },
        inputs: {
          ro:    { type: 'vec3',    label: 'Ray Origin', connection: { nodeId: 'cam_2',   outputKey: 'ro'    } },
          rd:    { type: 'vec3',    label: 'Ray Dir',    connection: { nodeId: 'cam_2',   outputKey: 'rd'    } },
          scene: { type: 'scene3d', label: 'Scene',      connection: { nodeId: 'scene_3', outputKey: 'scene' } },
          uv:   { type: 'vec2',  label: 'UV' },
          time: { type: 'float', label: 'Time' },
        },
        outputs: {
          color: { type: 'vec3', label: 'Color' }, dist: { type: 'float', label: 'Distance' },
          depth: { type: 'float', label: 'Depth' }, normal: { type: 'vec3', label: 'Normal' },
          iter: { type: 'float', label: 'Iter' }, iterCount: { type: 'float', label: 'Iter Count' },
          hit: { type: 'float', label: 'Hit' }, pos: { type: 'vec3', label: 'Hit Pos' },
        },
        params: {
          maxSteps: 80, maxDist: 20.0, stepScale: 1.0,
          bgR: 0.0, bgG: 0.0, bgB: 0.02,
          albedoR: 0.9, albedoG: 0.6, albedoB: 0.3,
          subgraph: {
            nodes: [
              { id: 'mp_b1', type: 'marchPos',    position: { x: 80,  y: 160 }, inputs: {}, outputs: { pos:  { type: 'vec3',  label: 'Position'   } }, params: {} },
              { id: 'marchout_b1', type: 'marchOutput', position: { x: 340, y: 160 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'mp_b1', outputKey: 'pos' } } },
                outputs: {}, params: {} },
            ],
            inputPorts: [], outputPorts: [],
          },
        },
      },
      { id: 'out_5', type: 'output', position: { x: 1100, y: 210 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'mlg_4', outputKey: 'color' } } },
        outputs: {}, params: {} },
    ],
  },

  // ── 3D: Metaballs — Smooth Union Chain ───────────────────────────────────────
  sdfSmoothMetaballs: {
    label: '3D: Metaballs — Smooth Union Chain',
    counter: 22,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 60,  y: 100 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 60,  y: 240 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'cam_2', type: 'marchCamera', position: { x: 260, y: 160 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { ro: { type: 'vec3', label: 'Ray Origin' }, rd: { type: 'vec3', label: 'Ray Dir' } },
        params: { camDist: 3.5, camAngle: 0.5, rotSpeed: 0.2, fov: 1.5 },
      },
      {
        id: 'scene_3', type: 'sceneGroup', position: { x: 500, y: 500 },
        inputs: {},
        outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: 'Metaballs',
          subgraph: {
            nodes: [
              { id: 'sp', type: 'scenePos', position: { x: 60, y: 300 }, inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'time_inn', type: 'time', position: { x: 60, y: 460 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
              // Sphere A — offset by sin(time)
              { id: 'tr_a', type: 'translate3D', position: { x: 260, y: 80 },
                inputs: {
                  pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp', outputKey: 'pos' } },
                  tx:  { type: 'float', label: 'X', connection: { nodeId: 'sin_a', outputKey: 'result' } },
                },
                outputs: { pos: { type: 'vec3', label: 'Translated Pos' } }, params: { tx: 0.0, ty: 0.0, tz: 0.0 } },
              { id: 'sin_a', type: 'sin', position: { x: 60, y: 80 },
                inputs: { a: { type: 'float', label: 'A', connection: { nodeId: 'time_inn', outputKey: 'time' } } },
                outputs: { result: { type: 'float', label: 'Result' } }, params: { scale: 0.7 } },
              { id: 'sph_a', type: 'sphereSDF3D', position: { x: 460, y: 80 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'tr_a', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { radius: 0.25 } },
              // Sphere B — offset by sin(time+1.2)
              { id: 'add_b', type: 'add', position: { x: 60, y: 180 },
                inputs: { a: { type: 'float', label: 'A', connection: { nodeId: 'time_inn', outputKey: 'time' } } },
                outputs: { result: { type: 'float', label: 'Result' } }, params: { b: 1.2 } },
              { id: 'sin_b', type: 'sin', position: { x: 220, y: 180 },
                inputs: { a: { type: 'float', label: 'A', connection: { nodeId: 'add_b', outputKey: 'result' } } },
                outputs: { result: { type: 'float', label: 'Result' } }, params: { scale: 0.6 } },
              { id: 'tr_b', type: 'translate3D', position: { x: 420, y: 180 },
                inputs: {
                  pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp', outputKey: 'pos' } },
                  ty:  { type: 'float', label: 'Y', connection: { nodeId: 'sin_b', outputKey: 'result' } },
                },
                outputs: { pos: { type: 'vec3', label: 'Translated Pos' } }, params: { tx: 0.3, ty: 0.0, tz: 0.0 } },
              { id: 'sph_b', type: 'sphereSDF3D', position: { x: 620, y: 180 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'tr_b', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { radius: 0.25 } },
              // Sphere C — offset by sin(time+2.4)
              { id: 'add_c', type: 'add', position: { x: 60, y: 280 },
                inputs: { a: { type: 'float', label: 'A', connection: { nodeId: 'time_inn', outputKey: 'time' } } },
                outputs: { result: { type: 'float', label: 'Result' } }, params: { b: 2.4 } },
              { id: 'sin_c', type: 'sin', position: { x: 220, y: 280 },
                inputs: { a: { type: 'float', label: 'A', connection: { nodeId: 'add_c', outputKey: 'result' } } },
                outputs: { result: { type: 'float', label: 'Result' } }, params: { scale: 0.65 } },
              { id: 'tr_c', type: 'translate3D', position: { x: 420, y: 280 },
                inputs: {
                  pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp', outputKey: 'pos' } },
                  tx:  { type: 'float', label: 'X', connection: { nodeId: 'sin_c', outputKey: 'result' } },
                },
                outputs: { pos: { type: 'vec3', label: 'Translated Pos' } }, params: { tx: 0.0, ty: 0.3, tz: 0.0 } },
              { id: 'sph_c', type: 'sphereSDF3D', position: { x: 620, y: 280 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'tr_c', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { radius: 0.25 } },
              // Sphere D — fixed offset
              { id: 'tr_d', type: 'translate3D', position: { x: 420, y: 380 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp', outputKey: 'pos' } } },
                outputs: { pos: { type: 'vec3', label: 'Translated Pos' } }, params: { tx: -0.4, ty: -0.3, tz: 0.2 } },
              { id: 'sph_d', type: 'sphereSDF3D', position: { x: 620, y: 380 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'tr_d', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { radius: 0.28 } },
              // Sphere E — fixed offset
              { id: 'tr_e', type: 'translate3D', position: { x: 420, y: 480 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp', outputKey: 'pos' } } },
                outputs: { pos: { type: 'vec3', label: 'Translated Pos' } }, params: { tx: 0.4, ty: -0.2, tz: -0.3 } },
              { id: 'sph_e', type: 'sphereSDF3D', position: { x: 620, y: 480 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'tr_e', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { radius: 0.22 } },
              // Smooth union chain
              { id: 'su1', type: 'sdfSmoothUnion', position: { x: 820, y: 130 },
                inputs: {
                  a: { type: 'float', label: 'A', connection: { nodeId: 'sph_a', outputKey: 'dist' } },
                  b: { type: 'float', label: 'B', connection: { nodeId: 'sph_b', outputKey: 'dist' } },
                },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { k: 0.3 } },
              { id: 'su2', type: 'sdfSmoothUnion', position: { x: 820, y: 280 },
                inputs: {
                  a: { type: 'float', label: 'A', connection: { nodeId: 'su1',   outputKey: 'dist' } },
                  b: { type: 'float', label: 'B', connection: { nodeId: 'sph_c', outputKey: 'dist' } },
                },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { k: 0.3 } },
              { id: 'su3', type: 'sdfSmoothUnion', position: { x: 820, y: 380 },
                inputs: {
                  a: { type: 'float', label: 'A', connection: { nodeId: 'su2',   outputKey: 'dist' } },
                  b: { type: 'float', label: 'B', connection: { nodeId: 'sph_d', outputKey: 'dist' } },
                },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { k: 0.3 } },
              { id: 'su4', type: 'sdfSmoothUnion', position: { x: 820, y: 480 },
                inputs: {
                  a: { type: 'float', label: 'A', connection: { nodeId: 'su3',   outputKey: 'dist' } },
                  b: { type: 'float', label: 'B', connection: { nodeId: 'sph_e', outputKey: 'dist' } },
                },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { k: 0.3 } },
            ],
            inputPorts: [], outputPorts: [],
          },
        },
      },
      {
        id: 'mlg_4', type: 'marchLoopGroup', position: { x: 760, y: 180 },
        inputs: {
          ro:    { type: 'vec3',    label: 'Ray Origin', connection: { nodeId: 'cam_2',   outputKey: 'ro'    } },
          rd:    { type: 'vec3',    label: 'Ray Dir',    connection: { nodeId: 'cam_2',   outputKey: 'rd'    } },
          scene: { type: 'scene3d', label: 'Scene',      connection: { nodeId: 'scene_3', outputKey: 'scene' } },
          uv:   { type: 'vec2',  label: 'UV' },
          time: { type: 'float', label: 'Time' },
        },
        outputs: {
          color: { type: 'vec3', label: 'Color' }, dist: { type: 'float', label: 'Distance' },
          depth: { type: 'float', label: 'Depth' }, normal: { type: 'vec3', label: 'Normal' },
          iter: { type: 'float', label: 'Iter' }, iterCount: { type: 'float', label: 'Iter Count' },
          hit: { type: 'float', label: 'Hit' }, pos: { type: 'vec3', label: 'Hit Pos' },
        },
        params: {
          maxSteps: 80, maxDist: 20.0, stepScale: 0.9,
          bgR: 0.01, bgG: 0.01, bgB: 0.04,
          albedoR: 0.8, albedoG: 0.5, albedoB: 1.0,
          subgraph: {
            nodes: [
              { id: 'mp_b1', type: 'marchPos',    position: { x: 80,  y: 160 }, inputs: {}, outputs: { pos:  { type: 'vec3',  label: 'Position'   } }, params: {} },
              { id: 'marchout_b1', type: 'marchOutput', position: { x: 340, y: 160 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'mp_b1', outputKey: 'pos' } } },
                outputs: {}, params: {} },
            ],
            inputPorts: [], outputPorts: [],
          },
        },
      },
      { id: 'out_5', type: 'output', position: { x: 1100, y: 210 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'mlg_4', outputKey: 'color' } } },
        outputs: {}, params: {} },
    ],
  },

  // ── 3D: Rounded Box ───────────────────────────────────────────────────────────
  sdfBend3D: {
    label: '3D: Bend Deform',
    counter: 7,
    nodes: [
      { id: 'uv_0', type: 'uv', position: { x: 60, y: 100 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 60, y: 240 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'cam_2', type: 'marchCamera', position: { x: 260, y: 160 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { ro: { type: 'vec3', label: 'Ray Origin' }, rd: { type: 'vec3', label: 'Ray Dir' } },
        params: { camDist: 3.5, camAngle: 0.5, rotSpeed: 0.2, fov: 1.5 },
      },
      {
        id: 'scene_3', type: 'sceneGroup', position: { x: 520, y: 400 },
        inputs: {},
        outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: '3D: Bend Deform',
          subgraph: {
            nodes: [
              { id: 'sp', type: 'scenePos', position: { x: 60, y: 200 }, inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'bd', type: 'bend3D', position: { x: 260, y: 200 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp', outputKey: 'pos' } } },
                outputs: { pos: { type: 'vec3', label: 'Bent Pos' } },
                params: { k: 1.5 } },
              { id: 'tor', type: 'torusSDF3D', position: { x: 460, y: 200 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'bd', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } },
                params: { majorR: 0.5, minorR: 0.15 } },
            ],
            inputPorts: [], outputPorts: [],
          },
        },
      },
      {
        id: 'mlg_4', type: 'marchLoopGroup', position: { x: 820, y: 200 },
        inputs: {
          ro:    { type: 'vec3',    label: 'Ray Origin', connection: { nodeId: 'cam_2',   outputKey: 'ro'    } },
          rd:    { type: 'vec3',    label: 'Ray Dir',    connection: { nodeId: 'cam_2',   outputKey: 'rd'    } },
          scene: { type: 'scene3d', label: 'Scene',      connection: { nodeId: 'scene_3', outputKey: 'scene' } },
          uv:   { type: 'vec2',  label: 'UV' },
          time: { type: 'float', label: 'Time' },
        },
        outputs: {
          color: { type: 'vec3', label: 'Color' }, dist: { type: 'float', label: 'Distance' },
          depth: { type: 'float', label: 'Depth' }, normal: { type: 'vec3', label: 'Normal' },
          iter: { type: 'float', label: 'Iter' }, iterCount: { type: 'float', label: 'Iter Count' },
          hit: { type: 'float', label: 'Hit' }, pos: { type: 'vec3', label: 'Hit Pos' },
        },
        params: {
          maxSteps: 80, maxDist: 20.0, stepScale: 1.0,
          bgR: 0.02, bgG: 0.02, bgB: 0.06,
          albedoR: 0.8, albedoG: 0.4, albedoB: 0.9,
          subgraph: {
            nodes: [
              { id: 'mp_b', type: 'marchPos',    position: { x: 80,  y: 160 }, inputs: {}, outputs: { pos:  { type: 'vec3',  label: 'Position' } }, params: {} },
              { id: 'md_b', type: 'marchDist',   position: { x: 80,  y: 300 }, inputs: {}, outputs: { dist: { type: 'float', label: 'Dist'     }, t: { type: 'float', label: 't' } }, params: {} },
              { id: 'mout_b', type: 'marchOutput', position: { x: 340, y: 160 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'mp_b', outputKey: 'pos' } } },
                outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
            ],
            inputPorts: [], outputPorts: [],
          },
        },
      },
      {
        id: 'out_5', type: 'output', position: { x: 1100, y: 230 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'mlg_4', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── 3D: Boolean Intersect ─────────────────────────────────────────────────────
  sdfIntersectDemo: {
    label: '3D: Boolean Intersect',
    counter: 7,
    nodes: [
      { id: 'uv_0', type: 'uv', position: { x: 60, y: 100 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 60, y: 240 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'cam_2', type: 'marchCamera', position: { x: 260, y: 160 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { ro: { type: 'vec3', label: 'Ray Origin' }, rd: { type: 'vec3', label: 'Ray Dir' } },
        params: { camDist: 3.0, camAngle: 0.5, rotSpeed: 0.2, fov: 1.5 },
      },
      {
        id: 'scene_3', type: 'sceneGroup', position: { x: 520, y: 400 },
        inputs: {},
        outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: '3D: Boolean Intersect',
          subgraph: {
            nodes: [
              { id: 'sp', type: 'scenePos', position: { x: 60, y: 200 }, inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'sph', type: 'sphereSDF3D', position: { x: 280, y: 120 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } },
                params: { radius: 0.6 } },
              { id: 'bx', type: 'boxSDF3D', position: { x: 280, y: 280 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } },
                params: { sizeX: 0.5, sizeY: 0.5, sizeZ: 0.5 } },
              { id: 'ix', type: 'sdfIntersect', position: { x: 500, y: 200 },
                inputs: {
                  a: { type: 'float', label: 'A', connection: { nodeId: 'sph', outputKey: 'dist' } },
                  b: { type: 'float', label: 'B', connection: { nodeId: 'bx',  outputKey: 'dist' } },
                },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: {} },
            ],
            inputPorts: [], outputPorts: [],
          },
        },
      },
      {
        id: 'mlg_4', type: 'marchLoopGroup', position: { x: 820, y: 200 },
        inputs: {
          ro:    { type: 'vec3',    label: 'Ray Origin', connection: { nodeId: 'cam_2',   outputKey: 'ro'    } },
          rd:    { type: 'vec3',    label: 'Ray Dir',    connection: { nodeId: 'cam_2',   outputKey: 'rd'    } },
          scene: { type: 'scene3d', label: 'Scene',      connection: { nodeId: 'scene_3', outputKey: 'scene' } },
          uv:   { type: 'vec2',  label: 'UV' },
          time: { type: 'float', label: 'Time' },
        },
        outputs: {
          color: { type: 'vec3', label: 'Color' }, dist: { type: 'float', label: 'Distance' },
          depth: { type: 'float', label: 'Depth' }, normal: { type: 'vec3', label: 'Normal' },
          iter: { type: 'float', label: 'Iter' }, iterCount: { type: 'float', label: 'Iter Count' },
          hit: { type: 'float', label: 'Hit' }, pos: { type: 'vec3', label: 'Hit Pos' },
        },
        params: {
          maxSteps: 80, maxDist: 20.0, stepScale: 1.0,
          bgR: 0.02, bgG: 0.02, bgB: 0.06,
          albedoR: 0.3, albedoG: 0.6, albedoB: 1.0,
          subgraph: {
            nodes: [
              { id: 'mp_b', type: 'marchPos',    position: { x: 80,  y: 160 }, inputs: {}, outputs: { pos:  { type: 'vec3',  label: 'Position' } }, params: {} },
              { id: 'md_b', type: 'marchDist',   position: { x: 80,  y: 300 }, inputs: {}, outputs: { dist: { type: 'float', label: 'Dist'     }, t: { type: 'float', label: 't' } }, params: {} },
              { id: 'mout_b', type: 'marchOutput', position: { x: 340, y: 160 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'mp_b', outputKey: 'pos' } } },
                outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
            ],
            inputPorts: [], outputPorts: [],
          },
        },
      },
      {
        id: 'out_5', type: 'output', position: { x: 1100, y: 230 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'mlg_4', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },


  // ── 2D: Mirrored Tiles ────────────────────────────────────────────────────────
  mirroredTileRepeat: {
    label: '2D: Mirrored Tiles',
    counter: 5,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 80, y: 240 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      {
        id: 'rep_1', type: 'mirroredRepeat2D', position: { x: 290, y: 200 },
        inputs: {
          input: { type: 'vec2', label: 'UV', connection: { nodeId: 'uv_0', outputKey: 'uv' } },
        },
        outputs: {
          output: { type: 'vec2', label: 'Cell UV' },
          cellID: { type: 'vec2', label: 'Cell ID' },
        },
        params: { cellX: 0.38, cellY: 0.38 },
      },
      {
        id: 'circ_2', type: 'circleSDF', position: { x: 510, y: 200 },
        inputs: {
          position: { type: 'vec2', label: 'Position', connection: { nodeId: 'rep_1', outputKey: 'output' } },
        },
        outputs: { distance: { type: 'float', label: 'Distance' } },
        params: { radius: 0.13, posX: 0.0, posY: 0.0 },
      },
      {
        id: 'col_3', type: 'sdfColorize', position: { x: 730, y: 200 },
        inputs: {
          d: { type: 'float', label: 'SDF', connection: { nodeId: 'circ_2', outputKey: 'distance' } },
        },
        outputs: { result: { type: 'vec3', label: 'Color' } },
        params: { edge: 0.008 },
      },
      {
        id: 'out_4', type: 'output', position: { x: 950, y: 240 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'col_3', outputKey: 'result' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── 2D: Angular Repeat (flower / gear) ────────────────────────────────────────
  angularFlowerRepeat: {
    label: '2D: Angular Repeat',
    counter: 6,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 80, y: 240 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 80, y: 400 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      // Slowly rotate UV so the flower spins (time drives angle directly — ~1 rad/sec)
      {
        id: 'rot_2', type: 'rotate2d', position: { x: 280, y: 280 },
        inputs: {
          input: { type: 'vec2',  label: 'Input', connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          angle: { type: 'float', label: 'Angle', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { output: { type: 'vec2', label: 'Output' } },
        params: {},
      },
      {
        id: 'ang_3', type: 'angularRepeat2D', position: { x: 490, y: 200 },
        inputs: {
          input: { type: 'vec2', label: 'UV', connection: { nodeId: 'rot_2', outputKey: 'output' } },
        },
        outputs: {
          output:   { type: 'vec2',  label: 'Sector UV' },
          sectorID: { type: 'float', label: 'Sector ID' },
        },
        params: { count: 7.0 },
      },
      // Circle offset from origin in sector space → appears 7× around ring
      {
        id: 'circ_4', type: 'circleSDF', position: { x: 710, y: 200 },
        inputs: {
          position: { type: 'vec2', label: 'Position', connection: { nodeId: 'ang_3', outputKey: 'output' } },
        },
        outputs: { distance: { type: 'float', label: 'Distance' } },
        params: { radius: 0.13, posX: 0.42, posY: 0.0 },
      },
      {
        id: 'col_5', type: 'sdfColorize', position: { x: 930, y: 200 },
        inputs: {
          d: { type: 'float', label: 'SDF', connection: { nodeId: 'circ_4', outputKey: 'distance' } },
        },
        outputs: { result: { type: 'vec3', label: 'Color' } },
        params: { edge: 0.008 },
      },
      {
        id: 'out_6', type: 'output', position: { x: 1150, y: 240 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'col_5', outputKey: 'result' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── 3D: Menger Sponge ─────────────────────────────────────────────────────────
  angularGearRepeat: {
    label: '2D: Angular Gear',
    counter: 5,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 80, y: 240 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 80, y: 400 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'ang_2', type: 'angularRepeat2D', position: { x: 310, y: 200 },
        inputs: {
          input: { type: 'vec2', label: 'UV', connection: { nodeId: 'uv_0', outputKey: 'uv' } },
        },
        outputs: {
          output:   { type: 'vec2',  label: 'Sector UV' },
          sectorID: { type: 'float', label: 'Sector ID' },
        },
        params: { count: 10.0 },
      },
      // Offset box SDF in sector space → 10 "teeth" around the ring
      {
        id: 'box_3', type: 'boxSDF', position: { x: 530, y: 200 },
        inputs: {
          position: { type: 'vec2', label: 'Position', connection: { nodeId: 'ang_2', outputKey: 'output' } },
        },
        outputs: { distance: { type: 'float', label: 'Distance' } },
        params: { width: 0.08, height: 0.15, posX: 0.38, posY: 0.0 },
      },
      {
        id: 'col_4', type: 'sdfColorize', position: { x: 760, y: 200 },
        inputs: {
          d: { type: 'float', label: 'SDF', connection: { nodeId: 'box_3', outputKey: 'distance' } },
        },
        outputs: { result: { type: 'vec3', label: 'Color' } },
        params: { edge: 0.006 },
      },
      {
        id: 'out_5', type: 'output', position: { x: 980, y: 240 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'col_4', outputKey: 'result' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── 2D: Limited Repeat Grid ───────────────────────────────────────────────────
  // Finite grid of circles — demonstrates limited/finite domain repetition
  limitedRepeatGrid: {
    label: '2D: Limited Grid',
    counter: 5,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 80, y: 240 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      {
        id: 'rep_1', type: 'limitedRepeat2D', position: { x: 290, y: 200 },
        inputs: {
          input: { type: 'vec2', label: 'UV', connection: { nodeId: 'uv_0', outputKey: 'uv' } },
        },
        outputs: {
          output: { type: 'vec2', label: 'Cell UV' },
          cellID: { type: 'vec2', label: 'Cell ID' },
        },
        params: { cellX: 0.26, cellY: 0.26, countX: 7.0, countY: 5.0 },
      },
      {
        id: 'circ_2', type: 'circleSDF', position: { x: 510, y: 200 },
        inputs: {
          position: { type: 'vec2', label: 'Position', connection: { nodeId: 'rep_1', outputKey: 'output' } },
        },
        outputs: { distance: { type: 'float', label: 'Distance' } },
        params: { radius: 0.09, posX: 0.0, posY: 0.0 },
      },
      {
        id: 'col_3', type: 'sdfColorize', position: { x: 730, y: 200 },
        inputs: {
          d: { type: 'float', label: 'SDF', connection: { nodeId: 'circ_2', outputKey: 'distance' } },
        },
        outputs: { result: { type: 'vec3', label: 'Color' } },
        params: { edge: 0.008 },
      },
      {
        id: 'out_4', type: 'output', position: { x: 950, y: 240 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'col_3', outputKey: 'result' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── 3D: SD Cross Scene ────────────────────────────────────────────────────────
  // SD Cross as a standalone shape — the building block of the Menger Sponge
  sdCrossScene3D: {
    label: '3D: SD Cross',
    counter: 5,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 60, y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 60, y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'scene_2', type: 'sceneGroup', position: { x: 310, y: 230 },
        inputs: {},
        outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: 'Cross Scene',
          subgraph: {
            nodes: [
              { id: 'sp_sg',   type: 'scenePos', position: { x: 60, y: 180 }, inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'time_sg', type: 'time',     position: { x: 60, y: 340 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time'     } }, params: {} },
              {
                id: 'rot_sg', type: 'rotate3D', position: { x: 260, y: 240 },
                inputs: {
                  pos:  { type: 'vec3',  label: 'Position', connection: { nodeId: 'sp_sg',   outputKey: 'pos'  } },
                  time: { type: 'float', label: 'Time',     connection: { nodeId: 'time_sg', outputKey: 'time' } },
                },
                outputs: { pos: { type: 'vec3', label: 'Rotated Pos' } },
                params: { rx: 0.3, ry: 0.5, rz: 0.1, speed: 0.4 },
              },
              {
                id: 'cross_sg', type: 'sdCross3D', position: { x: 460, y: 240 },
                inputs: {
                  pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'rot_sg', outputKey: 'pos' } },
                },
                outputs: { dist: { type: 'float', label: 'Distance' } },
                params: { size: 0.28 },
              },
            ],
            outputNodeId: 'cross_sg',
            outputKey: 'dist',
          },
        },
      },
      {
        id: 'ray_3', type: 'rayMarch', position: { x: 580, y: 180 },
        inputs: {
          scene: { type: 'scene3d', label: 'Scene', connection: { nodeId: 'scene_2', outputKey: 'scene' } },
          uv:    { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time:  { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { color: { type: 'vec3', label: 'Color' }, depth: { type: 'float', label: 'Depth' }, normal: { type: 'vec3', label: 'Normal' } },
        params: { camDist: 3.0, fov: 1.5, maxSteps: 80, maxDist: 20.0, lightX: 2.0, lightY: 3.0, lightZ: 2.0, bgR: 0.03, bgG: 0.03, bgB: 0.06, albedoR: 0.3, albedoG: 0.7, albedoB: 0.9 },
      },
      {
        id: 'out_4', type: 'output', position: { x: 860, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'ray_3', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── 3D: Infinite Pillars ──────────────────────────────────────────────────────
  // mirroredRepeat3D repeating a cylinder infinitely in the XZ plane
  infinitePillars3D: {
    label: '3D: Infinite Pillars',
    counter: 5,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 60, y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 60, y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'scene_2', type: 'sceneGroup', position: { x: 310, y: 230 },
        inputs: {},
        outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: 'Pillars Scene',
          subgraph: {
            nodes: [
              { id: 'sp_sg', type: 'scenePos', position: { x: 60, y: 180 }, inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              {
                id: 'rep_sg', type: 'mirroredRepeat3D', position: { x: 260, y: 180 },
                inputs: {
                  pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp_sg', outputKey: 'pos' } },
                },
                outputs: {
                  pos:    { type: 'vec3', label: 'Mirrored Pos' },
                  cellID: { type: 'vec3', label: 'Cell ID' },
                },
                // Large cellY so columns don't repeat vertically
                params: { cellX: 2.0, cellY: 50.0, cellZ: 2.0 },
              },
              {
                id: 'cyl_sg', type: 'cylinderSDF3D', position: { x: 470, y: 180 },
                inputs: {
                  pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'rep_sg', outputKey: 'pos' } },
                },
                outputs: { dist: { type: 'float', label: 'Distance' } },
                params: { r: 0.22, height: 3.0 },
              },
            ],
            outputNodeId: 'cyl_sg',
            outputKey: 'dist',
          },
        },
      },
      {
        id: 'ray_3', type: 'rayMarch', position: { x: 580, y: 180 },
        inputs: {
          scene: { type: 'scene3d', label: 'Scene', connection: { nodeId: 'scene_2', outputKey: 'scene' } },
          uv:    { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time:  { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { color: { type: 'vec3', label: 'Color' }, depth: { type: 'float', label: 'Depth' }, normal: { type: 'vec3', label: 'Normal' } },
        params: { camDist: 2.5, fov: 1.4, maxSteps: 100, maxDist: 25.0, lightX: 1.5, lightY: 4.0, lightZ: 2.0, bgR: 0.05, bgG: 0.04, bgB: 0.08, albedoR: 0.7, albedoG: 0.65, albedoB: 0.5 },
      },
      {
        id: 'out_4', type: 'output', position: { x: 860, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'ray_3', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ADVANCED LIGHTING & FRACTAL EXAMPLES — Phases 1–4
  // ═══════════════════════════════════════════════════════════════════════════

  // ── 3D Lighting: SDF Ambient Occlusion ────────────────────────────────────
  // SdfAo steps along the normal and compares expected vs actual SDF distance.
  // Wire: scene_3 + mlg_4.pos/normal/hit → ao_5 → scale MLG color by AO.
  aoSphere: {
    label: '3D Lighting: AO Sphere',
    counter: 9,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 60,  y: 200 }, inputs: {}, outputs: { uv:   { type: 'vec2',  label: 'UV'   } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 60,  y: 360 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'cam_2', type: 'marchCamera', position: { x: 260, y: 280 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { ro: { type: 'vec3', label: 'Ray Origin' }, rd: { type: 'vec3', label: 'Ray Dir' } },
        params: { camDist: 3.0, camAngle: 0.5, rotSpeed: 0.2, fov: 1.5 },
      },
      {
        id: 'scene_3', type: 'sceneGroup', position: { x: 520, y: 440 },
        inputs: {}, outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: 'Sphere',
          subgraph: {
            nodes: [
              { id: 'sp_sg',  type: 'scenePos',    position: { x: 80,  y: 180 }, inputs: {}, outputs: { pos:  { type: 'vec3',  label: 'Position' } }, params: {} },
              { id: 'sdf_sg', type: 'sphereSDF3D', position: { x: 280, y: 180 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp_sg', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { radius: 0.7 } },
            ],
            inputPorts: [], outputPorts: [],
          },
        },
      },
      {
        id: 'mlg_4', type: 'marchLoopGroup', position: { x: 780, y: 220 },
        inputs: {
          ro:    { type: 'vec3',    label: 'Ray Origin', connection: { nodeId: 'cam_2',   outputKey: 'ro'    } },
          rd:    { type: 'vec3',    label: 'Ray Dir',    connection: { nodeId: 'cam_2',   outputKey: 'rd'    } },
          scene: { type: 'scene3d', label: 'Scene',      connection: { nodeId: 'scene_3', outputKey: 'scene' } },
          uv: { type: 'vec2', label: 'UV' }, time: { type: 'float', label: 'Time' },
        },
        outputs: {
          color: { type: 'vec3', label: 'Color' }, dist: { type: 'float', label: 'Distance' },
          depth: { type: 'float', label: 'Depth' }, normal: { type: 'vec3', label: 'Normal' },
          iter: { type: 'float', label: 'Iter' }, iterCount: { type: 'float', label: 'Iter Count' },
          hit: { type: 'float', label: 'Hit' }, pos: { type: 'vec3', label: 'Hit Pos' },
        },
        params: {
          maxSteps: 80, maxDist: 20.0, stepScale: 1.0,
          bgR: 0.05, bgG: 0.07, bgB: 0.12,
          albedoR: 0.9, albedoG: 0.5, albedoB: 0.2,
          subgraph: {
            nodes: [
              { id: 'mp_sg', type: 'marchPos',    position: { x: 80,  y: 160 }, inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'mo_sg', type: 'marchOutput', position: { x: 280, y: 160 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'mp_sg', outputKey: 'pos' } } },
                outputs: {}, params: {} },
            ],
            inputPorts: [], outputPorts: [],
          },
        },
      },
      {
        id: 'ao_5', type: 'sdfAo', position: { x: 1060, y: 200 },
        inputs: {
          scene:  { type: 'scene3d', label: 'Scene',   connection: { nodeId: 'scene_3', outputKey: 'scene'  } },
          pos:    { type: 'vec3',    label: 'Hit Pos', connection: { nodeId: 'mlg_4',   outputKey: 'pos'    } },
          normal: { type: 'vec3',    label: 'Normal',  connection: { nodeId: 'mlg_4',   outputKey: 'normal' } },
          hit:    { type: 'float',   label: 'Hit',     connection: { nodeId: 'mlg_4',   outputKey: 'hit'    } },
        },
        outputs: { ao: { type: 'float', label: 'AO' } }, params: { stepDist: 0.05 },
      },
      {
        id: 'mul_6', type: 'multiplyVec3', position: { x: 1280, y: 200 },
        inputs: {
          color: { type: 'vec3',  label: 'Color', connection: { nodeId: 'mlg_4', outputKey: 'color' } },
          scale: { type: 'float', label: 'Scale', connection: { nodeId: 'ao_5',  outputKey: 'ao'    } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } }, params: { scale: 1.0 },
      },
      {
        id: 'out_7', type: 'output', position: { x: 1500, y: 220 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'mul_6', outputKey: 'result' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── 3D Lighting: Soft Shadow ───────────────────────────────────────────────
  // Secondary shadow ray cast from hit point toward light; k controls penumbra.
  // k=8 → soft film shadows; k=32 → crisp theater spotlight.
  conditionalCircle: {
    label: 'Conditionals / Hard Circle',
    counter: 7,
    nodes: [
      { id: 'uv_0', type: 'uv', position: { x: 40, y: 280 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'len_1', type: 'length', position: { x: 240, y: 280 },
        inputs: { input: { type: 'vec2', label: 'Input', connection: { nodeId: 'uv_0', outputKey: 'uv' } }, scale: { type: 'float', label: 'Scale' } },
        outputs: { output: { type: 'float', label: 'Output' } }, params: { scale: 1.0 } },
      { id: 'cmp_2', type: 'compare', position: { x: 460, y: 280 },
        inputs: {
          a: { type: 'float', label: 'A', connection: { nodeId: 'len_1', outputKey: 'output' } },
          b: { type: 'float', label: 'B' },
        },
        outputs: { mask: { type: 'float', label: 'Mask' } },
        params: { operator: '<', smoothing: 0.0, b: 0.4 } },
      { id: 'white_3', type: 'makeVec3', position: { x: 460, y: 100 },
        inputs: { r: { type: 'float', label: 'R' }, g: { type: 'float', label: 'G' }, b: { type: 'float', label: 'B' } },
        outputs: { rgb: { type: 'vec3', label: 'RGB' } },
        params: { r: 1.0, g: 1.0, b: 1.0 } },
      { id: 'black_4', type: 'makeVec3', position: { x: 460, y: 460 },
        inputs: { r: { type: 'float', label: 'R' }, g: { type: 'float', label: 'G' }, b: { type: 'float', label: 'B' } },
        outputs: { rgb: { type: 'vec3', label: 'RGB' } },
        params: { r: 0.0, g: 0.0, b: 0.05 } },
      { id: 'sel_5', type: 'select', position: { x: 700, y: 280 },
        inputs: {
          mask:    { type: 'float', label: 'Mask',     connection: { nodeId: 'cmp_2',   outputKey: 'mask' } },
          ifTrue:  { type: 'vec3',  label: 'If True',  connection: { nodeId: 'white_3', outputKey: 'rgb'  } },
          ifFalse: { type: 'vec3',  label: 'If False', connection: { nodeId: 'black_4', outputKey: 'rgb'  } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } },
        params: { outputType: 'vec3' } },
      { id: 'out_6', type: 'output', position: { x: 940, y: 280 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'sel_5', outputKey: 'result' } } },
        outputs: {}, params: {} },
    ],
  },

  // ── Conditionals: Soft Glow Ring ────────────────────────────────────────────
  conditionalGlowRing: {
    label: 'Conditionals / Soft Glow Ring',
    counter: 7,
    nodes: [
      { id: 'uv_0', type: 'uv', position: { x: 40, y: 280 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'len_1', type: 'length', position: { x: 240, y: 280 },
        inputs: { input: { type: 'vec2', label: 'Input', connection: { nodeId: 'uv_0', outputKey: 'uv' } }, scale: { type: 'float', label: 'Scale' } },
        outputs: { output: { type: 'float', label: 'Output' } }, params: { scale: 1.0 } },
      { id: 'cmp_2', type: 'compare', position: { x: 460, y: 280 },
        inputs: {
          a: { type: 'float', label: 'A', connection: { nodeId: 'len_1', outputKey: 'output' } },
          b: { type: 'float', label: 'B' },
        },
        outputs: { mask: { type: 'float', label: 'Mask' } },
        params: { operator: '<', smoothing: 0.12, b: 0.38 } },
      { id: 'glow_3', type: 'makeVec3', position: { x: 460, y: 80 },
        inputs: { r: { type: 'float', label: 'R' }, g: { type: 'float', label: 'G' }, b: { type: 'float', label: 'B' } },
        outputs: { rgb: { type: 'vec3', label: 'RGB' } },
        params: { r: 0.1, g: 0.6, b: 1.0 } },
      { id: 'bg_4', type: 'makeVec3', position: { x: 460, y: 460 },
        inputs: { r: { type: 'float', label: 'R' }, g: { type: 'float', label: 'G' }, b: { type: 'float', label: 'B' } },
        outputs: { rgb: { type: 'vec3', label: 'RGB' } },
        params: { r: 0.02, g: 0.02, b: 0.08 } },
      { id: 'sel_5', type: 'select', position: { x: 700, y: 280 },
        inputs: {
          mask:    { type: 'float', label: 'Mask',     connection: { nodeId: 'cmp_2',  outputKey: 'mask' } },
          ifTrue:  { type: 'vec3',  label: 'If True',  connection: { nodeId: 'glow_3', outputKey: 'rgb'  } },
          ifFalse: { type: 'vec3',  label: 'If False', connection: { nodeId: 'bg_4',   outputKey: 'rgb'  } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } },
        params: { outputType: 'vec3' } },
      { id: 'out_6', type: 'output', position: { x: 940, y: 280 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'sel_5', outputKey: 'result' } } },
        outputs: {}, params: {} },
    ],
  },

  // ── Conditionals: Animated Threshold ────────────────────────────────────────
  conditionalAnimThreshold: {
    label: 'Conditionals / Animated Threshold',
    counter: 9,
    nodes: [
      { id: 'uv_0', type: 'uv', position: { x: 40, y: 280 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 40, y: 480 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      { id: 'noise_2', type: 'noiseFloat', position: { x: 260, y: 280 },
        inputs: { uv: { type: 'vec2', label: 'UV', connection: { nodeId: 'uv_0', outputKey: 'uv' } }, time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } } },
        outputs: { value: { type: 'float', label: 'Value' } },
        params: { scale: 3.0, speed: 0.4, type: 'simplex' } },
      { id: 'sin_3', type: 'sin', position: { x: 260, y: 480 },
        inputs: { input: { type: 'float', label: 'Input', connection: { nodeId: 'time_1', outputKey: 'time' } }, freq: { type: 'float', label: 'Freq' }, amp: { type: 'float', label: 'Amp' } },
        outputs: { output: { type: 'float', label: 'Output' } },
        params: { freq: 0.5, amp: 0.35, offset: 0.5 } },
      { id: 'cmp_4', type: 'compare', position: { x: 500, y: 280 },
        inputs: {
          a: { type: 'float', label: 'A', connection: { nodeId: 'noise_2', outputKey: 'value' } },
          b: { type: 'float', label: 'B', connection: { nodeId: 'sin_3',   outputKey: 'output' } },
        },
        outputs: { mask: { type: 'float', label: 'Mask' } },
        params: { operator: '>', smoothing: 0.08 } },
      { id: 'colA_5', type: 'makeVec3', position: { x: 500, y: 80 },
        inputs: { r: { type: 'float', label: 'R' }, g: { type: 'float', label: 'G' }, b: { type: 'float', label: 'B' } },
        outputs: { rgb: { type: 'vec3', label: 'RGB' } },
        params: { r: 1.0, g: 0.6, b: 0.1 } },
      { id: 'colB_6', type: 'makeVec3', position: { x: 500, y: 480 },
        inputs: { r: { type: 'float', label: 'R' }, g: { type: 'float', label: 'G' }, b: { type: 'float', label: 'B' } },
        outputs: { rgb: { type: 'vec3', label: 'RGB' } },
        params: { r: 0.05, g: 0.1, b: 0.3 } },
      { id: 'sel_7', type: 'select', position: { x: 740, y: 280 },
        inputs: {
          mask:    { type: 'float', label: 'Mask',     connection: { nodeId: 'cmp_4',  outputKey: 'mask' } },
          ifTrue:  { type: 'vec3',  label: 'If True',  connection: { nodeId: 'colA_5', outputKey: 'rgb'  } },
          ifFalse: { type: 'vec3',  label: 'If False', connection: { nodeId: 'colB_6', outputKey: 'rgb'  } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } },
        params: { outputType: 'vec3' } },
      { id: 'out_8', type: 'output', position: { x: 980, y: 280 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'sel_7', outputKey: 'result' } } },
        outputs: {}, params: {} },
    ],
  },

  // ── Conditionals: Brightness Gate (palette + luminance) ─────────────────────
  conditionalBrightnessGate: {
    label: 'Conditionals / Brightness Gate',
    counter: 9,
    nodes: [
      { id: 'uv_0', type: 'uv', position: { x: 40, y: 280 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 40, y: 480 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      { id: 'noise_2', type: 'noiseFloat', position: { x: 260, y: 280 },
        inputs: { uv: { type: 'vec2', label: 'UV', connection: { nodeId: 'uv_0', outputKey: 'uv' } }, time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } } },
        outputs: { value: { type: 'float', label: 'Value' } },
        params: { scale: 4.0, speed: 0.2, type: 'simplex' } },
      { id: 'pal_3', type: 'palette', position: { x: 500, y: 280 },
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'noise_2', outputKey: 'value' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { offset: [0.5, 0.5, 0.5], amplitude: [0.5, 0.5, 0.5], freq: [1.0, 1.0, 1.0], phase: [0.0, 0.33, 0.67] } },
      { id: 'lum_4', type: 'luminance', position: { x: 740, y: 280 },
        inputs: { color: { type: 'vec3', label: 'RGB', connection: { nodeId: 'pal_3', outputKey: 'color' } } },
        outputs: { luma: { type: 'float', label: 'Luma' } }, params: {} },
      { id: 'cmp_5', type: 'compare', position: { x: 960, y: 280 },
        inputs: {
          a: { type: 'float', label: 'A', connection: { nodeId: 'lum_4', outputKey: 'luma' } },
          b: { type: 'float', label: 'B' },
        },
        outputs: { mask: { type: 'float', label: 'Mask' } },
        params: { operator: '>', smoothing: 0.05, b: 0.5 } },
      { id: 'sel_6', type: 'select', position: { x: 1180, y: 280 },
        inputs: {
          mask:    { type: 'float', label: 'Mask',     connection: { nodeId: 'cmp_5',  outputKey: 'mask'  } },
          ifTrue:  { type: 'vec3',  label: 'If True',  connection: { nodeId: 'pal_3',  outputKey: 'color' } },
          ifFalse: { type: 'vec3',  label: 'If False' },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } },
        params: { outputType: 'vec3' } },
      { id: 'out_7', type: 'output', position: { x: 1420, y: 280 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'sel_6', outputKey: 'result' } } },
        outputs: {}, params: {} },
    ],
  },

  // ── Conditionals: Approximate Match (≈) ────────────────────────────────────
  conditionalApproxMatch: {
    label: 'Conditionals / Approx Match',
    counter: 9,
    nodes: [
      { id: 'uv_0', type: 'uv', position: { x: 40, y: 280 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 40, y: 480 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      { id: 'len_2', type: 'length', position: { x: 240, y: 280 },
        inputs: { input: { type: 'vec2', label: 'Input', connection: { nodeId: 'uv_0', outputKey: 'uv' } }, scale: { type: 'float', label: 'Scale' } },
        outputs: { output: { type: 'float', label: 'Output' } }, params: { scale: 1.0 } },
      { id: 'sin_3', type: 'sin', position: { x: 240, y: 480 },
        inputs: { input: { type: 'float', label: 'Input', connection: { nodeId: 'time_1', outputKey: 'time' } }, freq: { type: 'float', label: 'Freq' }, amp: { type: 'float', label: 'Amp' } },
        outputs: { output: { type: 'float', label: 'Output' } },
        params: { freq: 0.8, amp: 0.28, offset: 0.45 } },
      { id: 'mod_4', type: 'mod', position: { x: 460, y: 280 },
        inputs: { input: { type: 'float', label: 'Input', connection: { nodeId: 'len_2', outputKey: 'output' } }, period: { type: 'float', label: 'Period' } },
        outputs: { output: { type: 'float', label: 'Output' } },
        params: { period: 0.18 } },
      { id: 'cmp_5', type: 'compare', position: { x: 680, y: 280 },
        inputs: {
          a: { type: 'float', label: 'A', connection: { nodeId: 'mod_4',  outputKey: 'output' } },
          b: { type: 'float', label: 'B', connection: { nodeId: 'sin_3',  outputKey: 'output' } },
        },
        outputs: { mask: { type: 'float', label: 'Mask' } },
        params: { operator: '≈', smoothing: 0.06 } },
      { id: 'ring_6', type: 'makeVec3', position: { x: 680, y: 80 },
        inputs: { r: { type: 'float', label: 'R' }, g: { type: 'float', label: 'G' }, b: { type: 'float', label: 'B' } },
        outputs: { rgb: { type: 'vec3', label: 'RGB' } },
        params: { r: 0.9, g: 0.95, b: 1.0 } },
      { id: 'sel_7', type: 'select', position: { x: 920, y: 280 },
        inputs: {
          mask:    { type: 'float', label: 'Mask',     connection: { nodeId: 'cmp_5',  outputKey: 'mask' } },
          ifTrue:  { type: 'vec3',  label: 'If True',  connection: { nodeId: 'ring_6', outputKey: 'rgb'  } },
          ifFalse: { type: 'vec3',  label: 'If False' },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } },
        params: { outputType: 'vec3' } },
      { id: 'out_8', type: 'output', position: { x: 1160, y: 280 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'sel_7', outputKey: 'result' } } },
        outputs: {}, params: {} },
    ],
  },


  // ── MLG: Sphere Inversion Space Warp ─────────────────────────────────────────
  // Sphere inversion applied to the march ray at every step — the entire world
  // gets mapped inside-out. Objects near the inversion radius appear infinitely far;
  // objects far away collapse toward the center.
  sphereInversion3D: {
    label: 'MLG: Sphere Inversion',
    counter: 7,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 60, y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 60, y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'cam_2', type: 'marchCamera', position: { x: 280, y: 280 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { ro: { type: 'vec3', label: 'Ray Origin' }, rd: { type: 'vec3', label: 'Ray Dir' } },
        params: { camDist: 3.5, camAngle: 0.5, rotSpeed: 0.2, fov: 1.5 },
      },
      {
        id: 'scene_3', type: 'sceneGroup', position: { x: 540, y: 460 },
        inputs: {},
        outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: 'Torus',
          subgraph: {
            nodes: [
              { id: 'sp_sg', type: 'scenePos', position: { x: 60, y: 150 },
                inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'sdf_sg', type: 'torusSDF3D', position: { x: 280, y: 150 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp_sg', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } },
                params: { majorR: 0.6, minorR: 0.18 } },
            ],
            inputPorts: [], outputPorts: [],
          },
        },
      },
      {
        id: 'mlg_4', type: 'marchLoopGroup', position: { x: 820, y: 220 },
        inputs: {
          ro:    { type: 'vec3',    label: 'Ray Origin', connection: { nodeId: 'cam_2',   outputKey: 'ro'    } },
          rd:    { type: 'vec3',    label: 'Ray Dir',    connection: { nodeId: 'cam_2',   outputKey: 'rd'    } },
          scene: { type: 'scene3d', label: 'Scene',      connection: { nodeId: 'scene_3', outputKey: 'scene' } },
          uv: { type: 'vec2', label: 'UV' }, time: { type: 'float', label: 'Time' },
        },
        outputs: {
          color: { type: 'vec3', label: 'Color' }, dist: { type: 'float', label: 'Distance' },
          depth: { type: 'float', label: 'Depth' }, normal: { type: 'vec3', label: 'Normal' },
          iter: { type: 'float', label: 'Iter' }, iterCount: { type: 'float', label: 'Iter Count' },
          hit: { type: 'float', label: 'Hit' }, pos: { type: 'vec3', label: 'Hit Pos' },
        },
        params: {
          maxSteps: 100, maxDist: 20.0, stepScale: 1.0,
          bgR: 0.02, bgG: 0.02, bgB: 0.08,
          albedoR: 0.6, albedoG: 0.8, albedoB: 1.0,
          subgraph: {
            nodes: [
              { id: 'mp_b', type: 'marchPos',  position: { x: 80,  y: 160 },
                inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'inv_b', type: 'sphereInvert3D', position: { x: 300, y: 160 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'mp_b', outputKey: 'pos' } } },
                outputs: { pos: { type: 'vec3', label: 'Inverted Pos' } },
                params: { radius: 1.2 } },
              { id: 'mo_b', type: 'marchOutput', position: { x: 520, y: 160 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'inv_b', outputKey: 'pos' } } },
                outputs: {}, params: {} },
            ],
            inputPorts: [], outputPorts: [],
          },
        },
      },
      {
        id: 'out_5', type: 'output', position: { x: 1100, y: 260 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'mlg_4', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── MLG: Octahedral Kaleidoscope Space Warp ───────────────────────────────────
  // Kaleidoscope folding on the march ray — every step the ray position is mirror-
  // folded into one octant. Creates infinite reflective fractal symmetry across
  // the whole scene, not just one object.
  kaleidoscopeBox3D: {
    label: 'MLG: Kaleidoscope (Oct)',
    counter: 7,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 60, y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 60, y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'cam_2', type: 'marchCamera', position: { x: 280, y: 280 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { ro: { type: 'vec3', label: 'Ray Origin' }, rd: { type: 'vec3', label: 'Ray Dir' } },
        params: { camDist: 3.0, camAngle: 0.5, rotSpeed: 0.2, fov: 1.5 },
      },
      {
        id: 'scene_3', type: 'sceneGroup', position: { x: 540, y: 460 },
        inputs: {},
        outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: 'Box',
          subgraph: {
            nodes: [
              { id: 'sp_sg', type: 'scenePos', position: { x: 60, y: 150 },
                inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'sdf_sg', type: 'boxSDF3D', position: { x: 280, y: 150 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp_sg', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } },
                params: { sizeX: 0.3, sizeY: 0.3, sizeZ: 0.3 } },
            ],
            inputPorts: [], outputPorts: [],
          },
        },
      },
      {
        id: 'mlg_4', type: 'marchLoopGroup', position: { x: 820, y: 220 },
        inputs: {
          ro:    { type: 'vec3',    label: 'Ray Origin', connection: { nodeId: 'cam_2',   outputKey: 'ro'    } },
          rd:    { type: 'vec3',    label: 'Ray Dir',    connection: { nodeId: 'cam_2',   outputKey: 'rd'    } },
          scene: { type: 'scene3d', label: 'Scene',      connection: { nodeId: 'scene_3', outputKey: 'scene' } },
          uv: { type: 'vec2', label: 'UV' }, time: { type: 'float', label: 'Time' },
        },
        outputs: {
          color: { type: 'vec3', label: 'Color' }, dist: { type: 'float', label: 'Distance' },
          depth: { type: 'float', label: 'Depth' }, normal: { type: 'vec3', label: 'Normal' },
          iter: { type: 'float', label: 'Iter' }, iterCount: { type: 'float', label: 'Iter Count' },
          hit: { type: 'float', label: 'Hit' }, pos: { type: 'vec3', label: 'Hit Pos' },
        },
        params: {
          maxSteps: 100, maxDist: 20.0, stepScale: 1.0,
          bgR: 0.03, bgG: 0.02, bgB: 0.06,
          albedoR: 1.0, albedoG: 0.6, albedoB: 0.3,
          subgraph: {
            nodes: [
              { id: 'mp_b', type: 'marchPos',  position: { x: 80,  y: 160 },
                inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'kali_b', type: 'kaleidoscope3D', position: { x: 300, y: 160 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'mp_b', outputKey: 'pos' } } },
                outputs: { pos: { type: 'vec3', label: 'Folded Pos' } },
                params: { symmetry: 'oct', iterations: '3' } },
              { id: 'mo_b', type: 'marchOutput', position: { x: 520, y: 160 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'kali_b', outputKey: 'pos' } } },
                outputs: {}, params: {} },
            ],
            inputPorts: [], outputPorts: [],
          },
        },
      },
      {
        id: 'out_5', type: 'output', position: { x: 1100, y: 260 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'mlg_4', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── MLG: Icosahedral Kaleidoscope Space Warp ──────────────────────────────────
  // Golden-ratio mirror planes folded into the march ray. 4 iterations creates
  // deep fractal icosahedral symmetry — 60-fold, filling all of space.
  icoKaleidoscope3D: {
    label: 'MLG: Kaleidoscope (Icos)',
    counter: 7,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 60, y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 60, y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'cam_2', type: 'marchCamera', position: { x: 280, y: 280 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { ro: { type: 'vec3', label: 'Ray Origin' }, rd: { type: 'vec3', label: 'Ray Dir' } },
        params: { camDist: 3.0, camAngle: 0.5, rotSpeed: 0.15, fov: 1.5 },
      },
      {
        id: 'scene_3', type: 'sceneGroup', position: { x: 540, y: 460 },
        inputs: {},
        outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: 'Sphere',
          subgraph: {
            nodes: [
              { id: 'sp_sg', type: 'scenePos', position: { x: 60, y: 150 },
                inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'sdf_sg', type: 'sphereSDF3D', position: { x: 280, y: 150 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp_sg', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } },
                params: { radius: 0.3 } },
            ],
            inputPorts: [], outputPorts: [],
          },
        },
      },
      {
        id: 'mlg_4', type: 'marchLoopGroup', position: { x: 820, y: 220 },
        inputs: {
          ro:    { type: 'vec3',    label: 'Ray Origin', connection: { nodeId: 'cam_2',   outputKey: 'ro'    } },
          rd:    { type: 'vec3',    label: 'Ray Dir',    connection: { nodeId: 'cam_2',   outputKey: 'rd'    } },
          scene: { type: 'scene3d', label: 'Scene',      connection: { nodeId: 'scene_3', outputKey: 'scene' } },
          uv: { type: 'vec2', label: 'UV' }, time: { type: 'float', label: 'Time' },
        },
        outputs: {
          color: { type: 'vec3', label: 'Color' }, dist: { type: 'float', label: 'Distance' },
          depth: { type: 'float', label: 'Depth' }, normal: { type: 'vec3', label: 'Normal' },
          iter: { type: 'float', label: 'Iter' }, iterCount: { type: 'float', label: 'Iter Count' },
          hit: { type: 'float', label: 'Hit' }, pos: { type: 'vec3', label: 'Hit Pos' },
        },
        params: {
          maxSteps: 120, maxDist: 20.0, stepScale: 1.0,
          bgR: 0.02, bgG: 0.04, bgB: 0.06,
          albedoR: 0.4, albedoG: 1.0, albedoB: 0.7,
          subgraph: {
            nodes: [
              { id: 'mp_b', type: 'marchPos',  position: { x: 80,  y: 160 },
                inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'kali_b', type: 'kaleidoscope3D', position: { x: 300, y: 160 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'mp_b', outputKey: 'pos' } } },
                outputs: { pos: { type: 'vec3', label: 'Folded Pos' } },
                params: { symmetry: 'icos', iterations: '4' } },
              { id: 'mo_b', type: 'marchOutput', position: { x: 520, y: 160 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'kali_b', outputKey: 'pos' } } },
                outputs: {}, params: {} },
            ],
            inputPorts: [], outputPorts: [],
          },
        },
      },
      {
        id: 'out_5', type: 'output', position: { x: 1100, y: 260 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'mlg_4', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── MLG: Möbius Conformal Space Warp ─────────────────────────────────────────
  // Blaschke factor applied to the xz plane of the ray at every march step.
  // The conformal map warps the entire scene — geometry close to the focal point
  // (cx,cy) gets compressed while the opposite side stretches.
  mobiusWarp3D: {
    label: 'MLG: Möbius Space Warp',
    counter: 7,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 60, y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 60, y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'cam_2', type: 'marchCamera', position: { x: 280, y: 280 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { ro: { type: 'vec3', label: 'Ray Origin' }, rd: { type: 'vec3', label: 'Ray Dir' } },
        params: { camDist: 3.5, camAngle: 0.5, rotSpeed: 0.2, fov: 1.5 },
      },
      {
        id: 'scene_3', type: 'sceneGroup', position: { x: 540, y: 460 },
        inputs: {},
        outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: 'Torus',
          subgraph: {
            nodes: [
              { id: 'sp_sg', type: 'scenePos', position: { x: 60, y: 150 },
                inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'sdf_sg', type: 'torusSDF3D', position: { x: 280, y: 150 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp_sg', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } },
                params: { majorR: 0.55, minorR: 0.2 } },
            ],
            inputPorts: [], outputPorts: [],
          },
        },
      },
      {
        id: 'mlg_4', type: 'marchLoopGroup', position: { x: 820, y: 220 },
        inputs: {
          ro:    { type: 'vec3',    label: 'Ray Origin', connection: { nodeId: 'cam_2',   outputKey: 'ro'    } },
          rd:    { type: 'vec3',    label: 'Ray Dir',    connection: { nodeId: 'cam_2',   outputKey: 'rd'    } },
          scene: { type: 'scene3d', label: 'Scene',      connection: { nodeId: 'scene_3', outputKey: 'scene' } },
          uv: { type: 'vec2', label: 'UV' }, time: { type: 'float', label: 'Time' },
        },
        outputs: {
          color: { type: 'vec3', label: 'Color' }, dist: { type: 'float', label: 'Distance' },
          depth: { type: 'float', label: 'Depth' }, normal: { type: 'vec3', label: 'Normal' },
          iter: { type: 'float', label: 'Iter' }, iterCount: { type: 'float', label: 'Iter Count' },
          hit: { type: 'float', label: 'Hit' }, pos: { type: 'vec3', label: 'Hit Pos' },
        },
        params: {
          maxSteps: 100, maxDist: 20.0, stepScale: 1.0,
          bgR: 0.03, bgG: 0.02, bgB: 0.06,
          albedoR: 0.9, albedoG: 0.5, albedoB: 0.8,
          subgraph: {
            nodes: [
              { id: 'mp_b', type: 'marchPos',  position: { x: 80,  y: 160 },
                inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'mob_b', type: 'mobiusWarp3D', position: { x: 300, y: 160 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'mp_b', outputKey: 'pos' } } },
                outputs: { pos: { type: 'vec3', label: 'Möbius Pos' } },
                params: { cx: 0.45, cy: 0.0, scale: 1.0, plane: 'xz' } },
              { id: 'mo_b', type: 'marchOutput', position: { x: 520, y: 160 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'mob_b', outputKey: 'pos' } } },
                outputs: {}, params: {} },
            ],
            inputPorts: [], outputPorts: [],
          },
        },
      },
      {
        id: 'out_5', type: 'output', position: { x: 1100, y: 260 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'mlg_4', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── MLG: Log-Polar Zoom Space Warp ────────────────────────────────────────────
  // Log-radial tiling on the march ray. Each step the ray's distance from the
  // origin is tiled in log space — the same geometry repeats at every power-of-e
  // zoom level, creating an infinite zoom self-similar world.
  logPolarZoom3D: {
    label: 'MLG: Log-Polar Zoom',
    counter: 7,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 60, y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 60, y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'cam_2', type: 'marchCamera', position: { x: 280, y: 280 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { ro: { type: 'vec3', label: 'Ray Origin' }, rd: { type: 'vec3', label: 'Ray Dir' } },
        params: { camDist: 3.0, camAngle: 0.5, rotSpeed: 0.2, fov: 1.5 },
      },
      {
        id: 'scene_3', type: 'sceneGroup', position: { x: 540, y: 460 },
        inputs: {},
        outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: 'Sphere',
          subgraph: {
            nodes: [
              { id: 'sp_sg', type: 'scenePos', position: { x: 60, y: 150 },
                inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'sdf_sg', type: 'sphereSDF3D', position: { x: 280, y: 150 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp_sg', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } },
                params: { radius: 0.35 } },
            ],
            inputPorts: [], outputPorts: [],
          },
        },
      },
      {
        id: 'mlg_4', type: 'marchLoopGroup', position: { x: 820, y: 220 },
        inputs: {
          ro:    { type: 'vec3',    label: 'Ray Origin', connection: { nodeId: 'cam_2',   outputKey: 'ro'    } },
          rd:    { type: 'vec3',    label: 'Ray Dir',    connection: { nodeId: 'cam_2',   outputKey: 'rd'    } },
          scene: { type: 'scene3d', label: 'Scene',      connection: { nodeId: 'scene_3', outputKey: 'scene' } },
          uv: { type: 'vec2', label: 'UV' }, time: { type: 'float', label: 'Time' },
        },
        outputs: {
          color: { type: 'vec3', label: 'Color' }, dist: { type: 'float', label: 'Distance' },
          depth: { type: 'float', label: 'Depth' }, normal: { type: 'vec3', label: 'Normal' },
          iter: { type: 'float', label: 'Iter' }, iterCount: { type: 'float', label: 'Iter Count' },
          hit: { type: 'float', label: 'Hit' }, pos: { type: 'vec3', label: 'Hit Pos' },
        },
        params: {
          maxSteps: 120, maxDist: 20.0, stepScale: 1.0,
          bgR: 0.02, bgG: 0.03, bgB: 0.06,
          albedoR: 0.3, albedoG: 0.7, albedoB: 1.0,
          subgraph: {
            nodes: [
              { id: 'mp_b', type: 'marchPos',  position: { x: 80,  y: 160 },
                inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'lp_b', type: 'logPolarWarp3D', position: { x: 300, y: 160 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'mp_b', outputKey: 'pos' } } },
                outputs: { pos: { type: 'vec3', label: 'Log-Polar Pos' } },
                params: { scale: 1.5, tile: 1.2, spiral: 0.3 } },
              { id: 'mo_b', type: 'marchOutput', position: { x: 520, y: 160 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'lp_b', outputKey: 'pos' } } },
                outputs: {}, params: {} },
            ],
            inputPorts: [], outputPorts: [],
          },
        },
      },
      {
        id: 'out_5', type: 'output', position: { x: 1100, y: 260 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'mlg_4', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── MLG: Helix Space Warp ─────────────────────────────────────────────────────
  // Helix domain warp on the march ray. The ray's xz angle is offset by its y
  // height, twisting all of space into a helical corridor. Any geometry you put
  // in the scene gets wound around the helix axis.
  helixWarp3D: {
    label: 'MLG: Helix Space Warp',
    counter: 7,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 60, y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 60, y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'cam_2', type: 'marchCamera', position: { x: 280, y: 280 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { ro: { type: 'vec3', label: 'Ray Origin' }, rd: { type: 'vec3', label: 'Ray Dir' } },
        params: { camDist: 3.5, camAngle: 0.4, rotSpeed: 0.15, fov: 1.5 },
      },
      {
        id: 'scene_3', type: 'sceneGroup', position: { x: 540, y: 460 },
        inputs: {},
        outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: 'Box',
          subgraph: {
            nodes: [
              { id: 'sp_sg', type: 'scenePos', position: { x: 60, y: 150 },
                inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'sdf_sg', type: 'boxSDF3D', position: { x: 280, y: 150 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp_sg', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } },
                params: { sizeX: 0.25, sizeY: 0.5, sizeZ: 0.25 } },
            ],
            inputPorts: [], outputPorts: [],
          },
        },
      },
      {
        id: 'mlg_4', type: 'marchLoopGroup', position: { x: 820, y: 220 },
        inputs: {
          ro:    { type: 'vec3',    label: 'Ray Origin', connection: { nodeId: 'cam_2',   outputKey: 'ro'    } },
          rd:    { type: 'vec3',    label: 'Ray Dir',    connection: { nodeId: 'cam_2',   outputKey: 'rd'    } },
          scene: { type: 'scene3d', label: 'Scene',      connection: { nodeId: 'scene_3', outputKey: 'scene' } },
          uv: { type: 'vec2', label: 'UV' }, time: { type: 'float', label: 'Time' },
        },
        outputs: {
          color: { type: 'vec3', label: 'Color' }, dist: { type: 'float', label: 'Distance' },
          depth: { type: 'float', label: 'Depth' }, normal: { type: 'vec3', label: 'Normal' },
          iter: { type: 'float', label: 'Iter' }, iterCount: { type: 'float', label: 'Iter Count' },
          hit: { type: 'float', label: 'Hit' }, pos: { type: 'vec3', label: 'Hit Pos' },
        },
        params: {
          maxSteps: 100, maxDist: 20.0, stepScale: 1.0,
          bgR: 0.03, bgG: 0.03, bgB: 0.05,
          albedoR: 0.8, albedoG: 0.6, albedoB: 1.0,
          subgraph: {
            nodes: [
              { id: 'mp_b', type: 'marchPos',  position: { x: 80,  y: 160 },
                inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'hx_b', type: 'helixWarp3D', position: { x: 300, y: 160 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'mp_b', outputKey: 'pos' } } },
                outputs: { pos: { type: 'vec3', label: 'Helix Pos' } },
                params: { rate: 1.2, pitch: 1.4 } },
              { id: 'mo_b', type: 'marchOutput', position: { x: 520, y: 160 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'hx_b', outputKey: 'pos' } } },
                outputs: {}, params: {} },
            ],
            inputPorts: [], outputPorts: [],
          },
        },
      },
      {
        id: 'out_5', type: 'output', position: { x: 1100, y: 260 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'mlg_4', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── MLG: Shear + Kaleidoscope Space Warp ─────────────────────────────────────
  // Shear applied first (skewing the coordinate frame asymmetrically), then
  // tetrahedral kaleidoscope folds. Combining them in the march body warps all
  // of space with a non-symmetric fractal structure.
  shearKaleidoscope3D: {
    label: 'MLG: Shear + Kaleido',
    counter: 7,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 60, y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 60, y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'cam_2', type: 'marchCamera', position: { x: 280, y: 280 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { ro: { type: 'vec3', label: 'Ray Origin' }, rd: { type: 'vec3', label: 'Ray Dir' } },
        params: { camDist: 3.2, camAngle: 0.5, rotSpeed: 0.2, fov: 1.5 },
      },
      {
        id: 'scene_3', type: 'sceneGroup', position: { x: 540, y: 460 },
        inputs: {},
        outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: 'Torus',
          subgraph: {
            nodes: [
              { id: 'sp_sg', type: 'scenePos', position: { x: 60, y: 150 },
                inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'sdf_sg', type: 'torusSDF3D', position: { x: 280, y: 150 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp_sg', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } },
                params: { majorR: 0.45, minorR: 0.15 } },
            ],
            inputPorts: [], outputPorts: [],
          },
        },
      },
      {
        id: 'mlg_4', type: 'marchLoopGroup', position: { x: 820, y: 220 },
        inputs: {
          ro:    { type: 'vec3',    label: 'Ray Origin', connection: { nodeId: 'cam_2',   outputKey: 'ro'    } },
          rd:    { type: 'vec3',    label: 'Ray Dir',    connection: { nodeId: 'cam_2',   outputKey: 'rd'    } },
          scene: { type: 'scene3d', label: 'Scene',      connection: { nodeId: 'scene_3', outputKey: 'scene' } },
          uv: { type: 'vec2', label: 'UV' }, time: { type: 'float', label: 'Time' },
        },
        outputs: {
          color: { type: 'vec3', label: 'Color' }, dist: { type: 'float', label: 'Distance' },
          depth: { type: 'float', label: 'Depth' }, normal: { type: 'vec3', label: 'Normal' },
          iter: { type: 'float', label: 'Iter' }, iterCount: { type: 'float', label: 'Iter Count' },
          hit: { type: 'float', label: 'Hit' }, pos: { type: 'vec3', label: 'Hit Pos' },
        },
        params: {
          maxSteps: 120, maxDist: 20.0, stepScale: 1.0,
          bgR: 0.02, bgG: 0.03, bgB: 0.06,
          albedoR: 1.0, albedoG: 0.8, albedoB: 0.3,
          subgraph: {
            nodes: [
              { id: 'mp_b', type: 'marchPos',  position: { x: 80,  y: 160 },
                inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'sh_b', type: 'shear3D', position: { x: 280, y: 160 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'mp_b', outputKey: 'pos' } } },
                outputs: { pos: { type: 'vec3', label: 'Sheared Pos' } },
                params: { sxy: 0.4, sxz: 0.2, syz: 0.0 } },
              { id: 'kali_b', type: 'kaleidoscope3D', position: { x: 480, y: 160 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sh_b', outputKey: 'pos' } } },
                outputs: { pos: { type: 'vec3', label: 'Folded Pos' } },
                params: { symmetry: 'tet', iterations: '3' } },
              { id: 'mo_b', type: 'marchOutput', position: { x: 680, y: 160 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'kali_b', outputKey: 'pos' } } },
                outputs: {}, params: {} },
            ],
            inputPorts: [], outputPorts: [],
          },
        },
      },
      {
        id: 'out_5', type: 'output', position: { x: 1100, y: 260 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'mlg_4', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── MLG: Möbius + Inversion Space Warp ───────────────────────────────────────
  // Two conformal maps composed in the march body: Möbius (Blaschke) on the xy
  // plane followed by sphere inversion. The compound map creates a highly non-
  // trivial distortion of all space — expect interesting limit-set geometry.
  mobiusInversionStack3D: {
    label: 'MLG: Möbius + Inversion',
    counter: 7,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 60, y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 60, y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'cam_2', type: 'marchCamera', position: { x: 280, y: 280 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { ro: { type: 'vec3', label: 'Ray Origin' }, rd: { type: 'vec3', label: 'Ray Dir' } },
        params: { camDist: 3.5, camAngle: 0.5, rotSpeed: 0.2, fov: 1.5 },
      },
      {
        id: 'scene_3', type: 'sceneGroup', position: { x: 540, y: 460 },
        inputs: {},
        outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: 'Sphere',
          subgraph: {
            nodes: [
              { id: 'sp_sg', type: 'scenePos', position: { x: 60, y: 150 },
                inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'sdf_sg', type: 'sphereSDF3D', position: { x: 280, y: 150 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp_sg', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } },
                params: { radius: 0.4 } },
            ],
            inputPorts: [], outputPorts: [],
          },
        },
      },
      {
        id: 'mlg_4', type: 'marchLoopGroup', position: { x: 820, y: 220 },
        inputs: {
          ro:    { type: 'vec3',    label: 'Ray Origin', connection: { nodeId: 'cam_2',   outputKey: 'ro'    } },
          rd:    { type: 'vec3',    label: 'Ray Dir',    connection: { nodeId: 'cam_2',   outputKey: 'rd'    } },
          scene: { type: 'scene3d', label: 'Scene',      connection: { nodeId: 'scene_3', outputKey: 'scene' } },
          uv: { type: 'vec2', label: 'UV' }, time: { type: 'float', label: 'Time' },
        },
        outputs: {
          color: { type: 'vec3', label: 'Color' }, dist: { type: 'float', label: 'Distance' },
          depth: { type: 'float', label: 'Depth' }, normal: { type: 'vec3', label: 'Normal' },
          iter: { type: 'float', label: 'Iter' }, iterCount: { type: 'float', label: 'Iter Count' },
          hit: { type: 'float', label: 'Hit' }, pos: { type: 'vec3', label: 'Hit Pos' },
        },
        params: {
          maxSteps: 120, maxDist: 20.0, stepScale: 1.0,
          bgR: 0.03, bgG: 0.02, bgB: 0.07,
          albedoR: 0.7, albedoG: 0.4, albedoB: 1.0,
          subgraph: {
            nodes: [
              { id: 'mp_b', type: 'marchPos',  position: { x: 80,  y: 160 },
                inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'mob_b', type: 'mobiusWarp3D', position: { x: 280, y: 160 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'mp_b', outputKey: 'pos' } } },
                outputs: { pos: { type: 'vec3', label: 'Möbius Pos' } },
                params: { cx: 0.35, cy: 0.1, scale: 1.0, plane: 'xy' } },
              { id: 'inv_b', type: 'sphereInvert3D', position: { x: 480, y: 160 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'mob_b', outputKey: 'pos' } } },
                outputs: { pos: { type: 'vec3', label: 'Inverted Pos' } },
                params: { radius: 0.9 } },
              { id: 'mo_b', type: 'marchOutput', position: { x: 680, y: 160 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'inv_b', outputKey: 'pos' } } },
                outputs: {}, params: {} },
            ],
            inputPorts: [], outputPorts: [],
          },
        },
      },
      {
        id: 'out_5', type: 'output', position: { x: 1100, y: 260 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'mlg_4', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Gyroid Shell ─────────────────────────────────────────────────────────────
  gyroidWarped: {
    label: '3D: Gyroid + Domain Warp',
    counter: 6,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 60,  y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 60,  y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'cam_2', type: 'marchCamera', position: { x: 280, y: 280 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { ro: { type: 'vec3', label: 'Ray Origin' }, rd: { type: 'vec3', label: 'Ray Dir' } },
        params: { camDist: 2.5, camAngle: 0.5, rotSpeed: 0.2, fov: 1.5 },
      },
      {
        id: 'scene_3', type: 'sceneGroup', position: { x: 560, y: 460 },
        inputs: {},
        outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: 'Warped Gyroid',
          subgraph: {
            nodes: [
              { id: 'sp_sg', type: 'scenePos',     position: { x: 60,  y: 150 }, inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'tm_sg', type: 'time',          position: { x: 60,  y: 280 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
              { id: 'dw_sg', type: 'domainWarp3D',  position: { x: 260, y: 190 },
                inputs: {
                  pos:  { type: 'vec3',  label: 'Position', connection: { nodeId: 'sp_sg', outputKey: 'pos'  } },
                  time: { type: 'float', label: 'Time',     connection: { nodeId: 'tm_sg', outputKey: 'time' } },
                },
                outputs: { pos: { type: 'vec3', label: 'Warped Position' } },
                params: { strength: 0.25, scale: 1.2, octaves: 3, gain: 0.5, lacunarity: 2.0 } },
              { id: 'gy_sg', type: 'gyroidField',   position: { x: 480, y: 190 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'dw_sg', outputKey: 'pos' } } },
                outputs: { density: { type: 'float', label: 'Density' }, surface: { type: 'float', label: 'Surface' } },
                params: { frequency: 3.5, thickness: 0.05 } },
            ],
            outputNodeId: 'gy_sg', outputKey: 'surface',
            inputPorts: [], outputPorts: [],
          },
        },
      },
      {
        id: 'mlg_4', type: 'marchLoopGroup', position: { x: 820, y: 220 },
        inputs: {
          ro:    { type: 'vec3',    label: 'Ray Origin', connection: { nodeId: 'cam_2',   outputKey: 'ro'    } },
          rd:    { type: 'vec3',    label: 'Ray Dir',    connection: { nodeId: 'cam_2',   outputKey: 'rd'    } },
          scene: { type: 'scene3d', label: 'Scene',      connection: { nodeId: 'scene_3', outputKey: 'scene' } },
          uv:    { type: 'vec2',  label: 'UV' },
          time:  { type: 'float', label: 'Time' },
        },
        outputs: {
          color: { type: 'vec3', label: 'Color' }, dist: { type: 'float', label: 'Distance' },
          depth: { type: 'float', label: 'Depth' }, normal: { type: 'vec3', label: 'Normal' },
          iter: { type: 'float', label: 'Iter' }, iterCount: { type: 'float', label: 'Iter Count' },
          hit: { type: 'float', label: 'Hit' }, pos: { type: 'vec3', label: 'Hit Pos' },
        },
        params: {
          maxSteps: 96, maxDist: 10.0, stepScale: 1.0,
          bgR: 0.02, bgG: 0.02, bgB: 0.08,
          albedoR: 0.9, albedoG: 0.5, albedoB: 0.3,
          subgraph: {
            nodes: [
              { id: 'mp_gw', type: 'marchPos',    position: { x: 80,  y: 160 }, inputs: {}, outputs: { pos:  { type: 'vec3',  label: 'Position'   } }, params: {} },
              { id: 'mo_gw', type: 'marchOutput', position: { x: 340, y: 160 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'mp_gw', outputKey: 'pos' } } },
                outputs: {}, params: {} },
            ],
            inputPorts: [], outputPorts: [],
          },
        },
      },
      {
        id: 'output_5', type: 'output', position: { x: 1100, y: 260 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'mlg_4', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Schwarz-P Shell ───────────────────────────────────────────────────────────
  mirrorFoldSpheres: {
    label: '3D: Mirror Fold Spheres',
    counter: 6,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 60,  y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 60,  y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'cam_2', type: 'marchCamera', position: { x: 280, y: 280 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { ro: { type: 'vec3', label: 'Ray Origin' }, rd: { type: 'vec3', label: 'Ray Dir' } },
        params: { camDist: 3.0, camAngle: 0.5, rotSpeed: 0.2, fov: 1.5 },
      },
      {
        id: 'scene_3', type: 'sceneGroup', position: { x: 560, y: 460 },
        inputs: {},
        outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: 'Fold + Sphere',
          subgraph: {
            nodes: [
              { id: 'sp_sg', type: 'scenePos',    position: { x: 60,  y: 150 }, inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'mf_sg', type: 'mirrorFold3D', position: { x: 240, y: 150 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp_sg', outputKey: 'pos' } } },
                outputs: { pos: { type: 'vec3', label: 'Folded Position' } },
                params: { foldX: true, foldY: true, foldZ: true, offsetX: 0.0, offsetY: 0.0, offsetZ: 0.0 } },
              { id: 'sdf_sg', type: 'sphereSDF3D', position: { x: 440, y: 150 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'mf_sg', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } },
                params: { radius: 0.35 } },
            ],
            outputNodeId: 'sdf_sg', outputKey: 'dist',
            inputPorts: [], outputPorts: [],
          },
        },
      },
      {
        id: 'mlg_4', type: 'marchLoopGroup', position: { x: 820, y: 220 },
        inputs: {
          ro:    { type: 'vec3',    label: 'Ray Origin', connection: { nodeId: 'cam_2',   outputKey: 'ro'    } },
          rd:    { type: 'vec3',    label: 'Ray Dir',    connection: { nodeId: 'cam_2',   outputKey: 'rd'    } },
          scene: { type: 'scene3d', label: 'Scene',      connection: { nodeId: 'scene_3', outputKey: 'scene' } },
          uv:    { type: 'vec2',  label: 'UV' },
          time:  { type: 'float', label: 'Time' },
        },
        outputs: {
          color: { type: 'vec3', label: 'Color' }, dist: { type: 'float', label: 'Distance' },
          depth: { type: 'float', label: 'Depth' }, normal: { type: 'vec3', label: 'Normal' },
          iter: { type: 'float', label: 'Iter' }, iterCount: { type: 'float', label: 'Iter Count' },
          hit: { type: 'float', label: 'Hit' }, pos: { type: 'vec3', label: 'Hit Pos' },
        },
        params: {
          maxSteps: 80, maxDist: 15.0, stepScale: 1.0,
          bgR: 0.02, bgG: 0.02, bgB: 0.06,
          albedoR: 0.5, albedoG: 0.7, albedoB: 1.0,
          subgraph: {
            nodes: [
              { id: 'mp_ms', type: 'marchPos',    position: { x: 80,  y: 160 }, inputs: {}, outputs: { pos:  { type: 'vec3',  label: 'Position'   } }, params: {} },
              { id: 'mo_ms', type: 'marchOutput', position: { x: 340, y: 160 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'mp_ms', outputKey: 'pos' } } },
                outputs: {}, params: {} },
            ],
            inputPorts: [], outputPorts: [],
          },
        },
      },
      {
        id: 'output_5', type: 'output', position: { x: 1100, y: 260 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'mlg_4', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Mirror Fold: Offset Box Grid ──────────────────────────────────────────────
  mirrorFoldBoxes: {
    label: '3D: Mirror Fold Boxes',
    counter: 6,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 60,  y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 60,  y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'cam_2', type: 'marchCamera', position: { x: 280, y: 280 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { ro: { type: 'vec3', label: 'Ray Origin' }, rd: { type: 'vec3', label: 'Ray Dir' } },
        params: { camDist: 3.5, camAngle: 0.5, rotSpeed: 0.2, fov: 1.5 },
      },
      {
        id: 'scene_3', type: 'sceneGroup', position: { x: 560, y: 460 },
        inputs: {},
        outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: 'Fold + Box',
          subgraph: {
            nodes: [
              { id: 'sp_sg', type: 'scenePos',    position: { x: 60,  y: 150 }, inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'mf_sg', type: 'mirrorFold3D', position: { x: 240, y: 150 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp_sg', outputKey: 'pos' } } },
                outputs: { pos: { type: 'vec3', label: 'Folded Position' } },
                params: { foldX: true, foldY: false, foldZ: true, offsetX: 0.6, offsetY: 0.0, offsetZ: 0.6 } },
              { id: 'sdf_sg', type: 'boxSDF3D',    position: { x: 440, y: 150 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'mf_sg', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } },
                params: { sizeX: 0.3, sizeY: 0.6, sizeZ: 0.3 } },
            ],
            outputNodeId: 'sdf_sg', outputKey: 'dist',
            inputPorts: [], outputPorts: [],
          },
        },
      },
      {
        id: 'mlg_4', type: 'marchLoopGroup', position: { x: 820, y: 220 },
        inputs: {
          ro:    { type: 'vec3',    label: 'Ray Origin', connection: { nodeId: 'cam_2',   outputKey: 'ro'    } },
          rd:    { type: 'vec3',    label: 'Ray Dir',    connection: { nodeId: 'cam_2',   outputKey: 'rd'    } },
          scene: { type: 'scene3d', label: 'Scene',      connection: { nodeId: 'scene_3', outputKey: 'scene' } },
          uv:    { type: 'vec2',  label: 'UV' },
          time:  { type: 'float', label: 'Time' },
        },
        outputs: {
          color: { type: 'vec3', label: 'Color' }, dist: { type: 'float', label: 'Distance' },
          depth: { type: 'float', label: 'Depth' }, normal: { type: 'vec3', label: 'Normal' },
          iter: { type: 'float', label: 'Iter' }, iterCount: { type: 'float', label: 'Iter Count' },
          hit: { type: 'float', label: 'Hit' }, pos: { type: 'vec3', label: 'Hit Pos' },
        },
        params: {
          maxSteps: 80, maxDist: 15.0, stepScale: 1.0,
          bgR: 0.03, bgG: 0.02, bgB: 0.05,
          albedoR: 1.0, albedoG: 0.6, albedoB: 0.3,
          subgraph: {
            nodes: [
              { id: 'mp_mb', type: 'marchPos',    position: { x: 80,  y: 160 }, inputs: {}, outputs: { pos:  { type: 'vec3',  label: 'Position'   } }, params: {} },
              { id: 'mo_mb', type: 'marchOutput', position: { x: 340, y: 160 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'mp_mb', outputKey: 'pos' } } },
                outputs: {}, params: {} },
            ],
            inputPorts: [], outputPorts: [],
          },
        },
      },
      {
        id: 'output_5', type: 'output', position: { x: 1100, y: 260 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'mlg_4', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Vec3 Swizzle: Palette Color Rotation ─────────────────────────────────────
  vec3SwizzlePalette: {
    label: 'Vec3 Swizzle: Color Cycle',
    counter: 6,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 60,  y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 60,  y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'len_2', type: 'length', position: { x: 240, y: 220 },
        inputs: { input: { type: 'vec2', label: 'Input', connection: { nodeId: 'uv_0', outputKey: 'uv' } } },
        outputs: { output: { type: 'float', label: 'Output' } },
        params: {},
      },
      {
        id: 'add_3', type: 'add', position: { x: 400, y: 280 },
        inputs: {
          a: { type: 'float', label: 'A', connection: { nodeId: 'len_2',  outputKey: 'output' } },
          b: { type: 'float', label: 'B', connection: { nodeId: 'time_1', outputKey: 'time'   } },
        },
        outputs: { output: { type: 'float', label: 'Output' } },
        params: {},
      },
      {
        id: 'pal_4', type: 'palettePreset', position: { x: 580, y: 200 },
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'add_3', outputKey: 'output' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { preset: 'rainbow', speed: 0.4 },
      },
      {
        id: 'sw_5', type: 'vec3Swizzle', position: { x: 780, y: 200 },
        inputs: { input: { type: 'vec3', label: 'Input', connection: { nodeId: 'pal_4', outputKey: 'color' } } },
        outputs: { output: { type: 'vec3', label: 'Output' } },
        params: { mode: 'yzx' },
      },
      {
        id: 'output_5', type: 'output', position: { x: 960, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'sw_5', outputKey: 'output' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Vec2 Swizzle: UV Axis Reflection ─────────────────────────────────────────
  vec2SwizzleUV: {
    label: 'Vec2 Swizzle: UV Reflection',
    counter: 6,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 60,  y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 60,  y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'sw_2', type: 'vec2Swizzle', position: { x: 240, y: 200 },
        inputs: { input: { type: 'vec2', label: 'Input', connection: { nodeId: 'uv_0', outputKey: 'uv' } } },
        outputs: { output: { type: 'vec2', label: 'Output' } },
        params: { mode: 'yx' },
      },
      {
        id: 'fbm_3', type: 'fbm', position: { x: 420, y: 200 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'sw_2',   outputKey: 'output' } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time'   } },
        },
        outputs: { value: { type: 'float', label: 'Value' } },
        params: { octaves: 5, lacunarity: 2.0, gain: 0.5, scale: 3.0, timeScale: 0.3 },
      },
      {
        id: 'fv3_4', type: 'floatToVec3', position: { x: 620, y: 200 },
        inputs: { input: { type: 'float', label: 'Input', connection: { nodeId: 'fbm_3', outputKey: 'value' } } },
        outputs: { output: { type: 'vec3', label: 'Output' } },
        params: {},
      },
      {
        id: 'output_5', type: 'output', position: { x: 820, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'fv3_4', outputKey: 'output' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Domain Warp: Turbulent Sphere ─────────────────────────────────────────────
  domainWarpSphere: {
    label: '3D: Domain Warp Sphere',
    counter: 6,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 60,  y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 60,  y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'cam_2', type: 'marchCamera', position: { x: 280, y: 280 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { ro: { type: 'vec3', label: 'Ray Origin' }, rd: { type: 'vec3', label: 'Ray Dir' } },
        params: { camDist: 3.0, camAngle: 0.5, rotSpeed: 0.2, fov: 1.5 },
      },
      {
        id: 'scene_3', type: 'sceneGroup', position: { x: 560, y: 460 },
        inputs: {},
        outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: 'Warped Sphere',
          subgraph: {
            nodes: [
              { id: 'sp_sg',  type: 'scenePos',    position: { x: 60,  y: 150 }, inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'tm_sg',  type: 'time',         position: { x: 60,  y: 280 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
              { id: 'dw_sg',  type: 'domainWarp3D', position: { x: 260, y: 190 },
                inputs: {
                  pos:  { type: 'vec3',  label: 'Position', connection: { nodeId: 'sp_sg', outputKey: 'pos'  } },
                  time: { type: 'float', label: 'Time',     connection: { nodeId: 'tm_sg', outputKey: 'time' } },
                },
                outputs: { pos: { type: 'vec3', label: 'Warped Position' } },
                params: { strength: 0.4, scale: 1.5, octaves: 4, gain: 0.5, lacunarity: 2.0 } },
              { id: 'sdf_sg', type: 'sphereSDF3D',  position: { x: 460, y: 190 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'dw_sg', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } },
                params: { radius: 0.6 } },
            ],
            outputNodeId: 'sdf_sg', outputKey: 'dist',
            inputPorts: [], outputPorts: [],
          },
        },
      },
      {
        id: 'mlg_4', type: 'marchLoopGroup', position: { x: 820, y: 220 },
        inputs: {
          ro:    { type: 'vec3',    label: 'Ray Origin', connection: { nodeId: 'cam_2',   outputKey: 'ro'    } },
          rd:    { type: 'vec3',    label: 'Ray Dir',    connection: { nodeId: 'cam_2',   outputKey: 'rd'    } },
          scene: { type: 'scene3d', label: 'Scene',      connection: { nodeId: 'scene_3', outputKey: 'scene' } },
          uv:    { type: 'vec2',  label: 'UV' },
          time:  { type: 'float', label: 'Time' },
        },
        outputs: {
          color: { type: 'vec3', label: 'Color' }, dist: { type: 'float', label: 'Distance' },
          depth: { type: 'float', label: 'Depth' }, normal: { type: 'vec3', label: 'Normal' },
          iter: { type: 'float', label: 'Iter' }, iterCount: { type: 'float', label: 'Iter Count' },
          hit: { type: 'float', label: 'Hit' }, pos: { type: 'vec3', label: 'Hit Pos' },
        },
        params: {
          maxSteps: 80, maxDist: 15.0, stepScale: 1.0,
          bgR: 0.02, bgG: 0.02, bgB: 0.06,
          albedoR: 0.7, albedoG: 0.4, albedoB: 0.9,
          subgraph: {
            nodes: [
              { id: 'mp_ds', type: 'marchPos',    position: { x: 80,  y: 160 }, inputs: {}, outputs: { pos:  { type: 'vec3',  label: 'Position'   } }, params: {} },
              { id: 'mo_ds', type: 'marchOutput', position: { x: 340, y: 160 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'mp_ds', outputKey: 'pos' } } },
                outputs: {}, params: {} },
            ],
            inputPorts: [], outputPorts: [],
          },
        },
      },
      {
        id: 'output_5', type: 'output', position: { x: 1100, y: 260 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'mlg_4', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Swizzle: Diagonal Symmetric Noise ────────────────────────────────────────
  // Average fbm(uv) + fbm(uv.yx) → result is symmetric across the diagonal axis.
  // Classic use of vec2Swizzle to "transpose" the domain before sampling.
  swizzle3DNormalMap: {
    label: '3D: Swizzle Normal Colors',
    counter: 10,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 60,  y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 60,  y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'cam_2', type: 'marchCamera', position: { x: 280, y: 280 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { ro: { type: 'vec3', label: 'Ray Origin' }, rd: { type: 'vec3', label: 'Ray Dir' } },
        params: { camDist: 3.0, camAngle: 0.5, rotSpeed: 0.2, fov: 1.5 },
      },
      {
        id: 'scene_3', type: 'sceneGroup', position: { x: 560, y: 460 },
        inputs: {},
        outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: 'Sphere',
          subgraph: {
            nodes: [
              { id: 'sp_inn', type: 'scenePos',    position: { x: 80,  y: 150 }, inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'sd_inn', type: 'sphereSDF3D', position: { x: 280, y: 150 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp_inn', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { radius: 0.8 } },
            ],
            outputNodeId: 'sd_inn', outputKey: 'dist',
            inputPorts: [], outputPorts: [],
          },
        },
      },
      {
        id: 'mlg_4', type: 'marchLoopGroup', position: { x: 820, y: 220 },
        inputs: {
          ro:    { type: 'vec3',    label: 'Ray Origin', connection: { nodeId: 'cam_2',   outputKey: 'ro'    } },
          rd:    { type: 'vec3',    label: 'Ray Dir',    connection: { nodeId: 'cam_2',   outputKey: 'rd'    } },
          scene: { type: 'scene3d', label: 'Scene',      connection: { nodeId: 'scene_3', outputKey: 'scene' } },
          uv: { type: 'vec2', label: 'UV' }, time: { type: 'float', label: 'Time' },
        },
        outputs: {
          color: { type: 'vec3', label: 'Color' }, normal: { type: 'vec3', label: 'Normal' },
          pos: { type: 'vec3', label: 'Hit Pos' }, dist: { type: 'float', label: 'Distance' },
          depth: { type: 'float', label: 'Depth' }, iter: { type: 'float', label: 'Iter' },
          iterCount: { type: 'float', label: 'Iter Count' }, hit: { type: 'float', label: 'Hit' },
        },
        params: {
          maxSteps: 64, maxDist: 12.0, stepScale: 1.0,
          bgR: 0.02, bgG: 0.02, bgB: 0.04,
          albedoR: 0.5, albedoG: 0.5, albedoB: 0.5,
          subgraph: {
            nodes: [
              { id: 'mp_nm', type: 'marchPos',    position: { x: 80,  y: 160 }, inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'mo_nm', type: 'marchOutput', position: { x: 340, y: 160 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'mp_nm', outputKey: 'pos' } } },
                outputs: {}, params: {} },
            ],
            inputPorts: [], outputPorts: [],
          },
        },
      },
      // remap normal from [-1,1] → [0,1]: n * 0.5 + 0.5
      {
        id: 'mul_5', type: 'multiplyVec3', position: { x: 1080, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'mlg_4', outputKey: 'normal' } } },
        outputs: { result: { type: 'vec3', label: 'Result' } },
        params: { scale: 0.5 },
      },
      {
        id: 'mkv_6', type: 'makeVec3', position: { x: 1080, y: 320 },
        inputs: {}, outputs: { rgb: { type: 'vec3', label: 'RGB' } },
        params: { r: 0.5, g: 0.5, b: 0.5 },
      },
      {
        id: 'add_7', type: 'addVec3', position: { x: 1240, y: 260 },
        inputs: {
          a: { type: 'vec3', label: 'A', connection: { nodeId: 'mul_5', outputKey: 'result' } },
          b: { type: 'vec3', label: 'B', connection: { nodeId: 'mkv_6', outputKey: 'rgb'    } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } },
        params: {},
      },
      // swizzle .zxy — depth becomes red, X green, Y blue
      {
        id: 'sw_8', type: 'vec3Swizzle', position: { x: 1400, y: 260 },
        inputs: { input: { type: 'vec3', label: 'Input', connection: { nodeId: 'add_7', outputKey: 'result' } } },
        outputs: { output: { type: 'vec3', label: 'Output' } },
        params: { mode: 'zxy' },
      },
      {
        id: 'output_9', type: 'output', position: { x: 1580, y: 260 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'sw_8', outputKey: 'output' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── 3D Swizzle: Hit Position as Color ────────────────────────────────────────
  // Map the 3D hit position directly to RGB, then apply .yzx swizzle so the
  // dominant XYZ axes drive different color channels.  Works great on complex
  // surfaces like the gyroid where position varies across all three axes.
  swizzle3DPosGradient: {
    label: '3D: Swizzle Position Gradient',
    counter: 10,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 60,  y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 60,  y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'cam_2', type: 'marchCamera', position: { x: 280, y: 280 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { ro: { type: 'vec3', label: 'Ray Origin' }, rd: { type: 'vec3', label: 'Ray Dir' } },
        params: { camDist: 2.5, camAngle: 0.5, rotSpeed: 0.15, fov: 1.5 },
      },
      {
        id: 'scene_3', type: 'sceneGroup', position: { x: 560, y: 460 },
        inputs: {},
        outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: 'Gyroid',
          subgraph: {
            nodes: [
              { id: 'sp_inn', type: 'scenePos',    position: { x: 80,  y: 150 }, inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'gy_inn', type: 'gyroidField', position: { x: 280, y: 150 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp_inn', outputKey: 'pos' } } },
                outputs: { density: { type: 'float', label: 'Density' }, surface: { type: 'float', label: 'Surface' } },
                params: { frequency: 3.0, thickness: 0.04 } },
            ],
            outputNodeId: 'gy_inn', outputKey: 'surface',
            inputPorts: [], outputPorts: [],
          },
        },
      },
      {
        id: 'mlg_4', type: 'marchLoopGroup', position: { x: 820, y: 220 },
        inputs: {
          ro:    { type: 'vec3',    label: 'Ray Origin', connection: { nodeId: 'cam_2',   outputKey: 'ro'    } },
          rd:    { type: 'vec3',    label: 'Ray Dir',    connection: { nodeId: 'cam_2',   outputKey: 'rd'    } },
          scene: { type: 'scene3d', label: 'Scene',      connection: { nodeId: 'scene_3', outputKey: 'scene' } },
          uv: { type: 'vec2', label: 'UV' }, time: { type: 'float', label: 'Time' },
        },
        outputs: {
          color: { type: 'vec3', label: 'Color' }, normal: { type: 'vec3', label: 'Normal' },
          pos: { type: 'vec3', label: 'Hit Pos' }, dist: { type: 'float', label: 'Distance' },
          depth: { type: 'float', label: 'Depth' }, iter: { type: 'float', label: 'Iter' },
          iterCount: { type: 'float', label: 'Iter Count' }, hit: { type: 'float', label: 'Hit' },
        },
        params: {
          maxSteps: 96, maxDist: 10.0, stepScale: 1.0,
          bgR: 0.02, bgG: 0.02, bgB: 0.05,
          albedoR: 0.5, albedoG: 0.5, albedoB: 0.5,
          subgraph: {
            nodes: [
              { id: 'mp_pg', type: 'marchPos',    position: { x: 80,  y: 160 }, inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'mo_pg', type: 'marchOutput', position: { x: 340, y: 160 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'mp_pg', outputKey: 'pos' } } },
                outputs: {}, params: {} },
            ],
            inputPorts: [], outputPorts: [],
          },
        },
      },
      // scale pos to [~0, 0.5] range, then offset to center
      {
        id: 'mul_5', type: 'multiplyVec3', position: { x: 1080, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'mlg_4', outputKey: 'pos' } } },
        outputs: { result: { type: 'vec3', label: 'Result' } },
        params: { scale: 0.5 },
      },
      {
        id: 'mkv_6', type: 'makeVec3', position: { x: 1080, y: 320 },
        inputs: {}, outputs: { rgb: { type: 'vec3', label: 'RGB' } },
        params: { r: 0.5, g: 0.5, b: 0.5 },
      },
      {
        id: 'add_7', type: 'addVec3', position: { x: 1240, y: 260 },
        inputs: {
          a: { type: 'vec3', label: 'A', connection: { nodeId: 'mul_5', outputKey: 'result' } },
          b: { type: 'vec3', label: 'B', connection: { nodeId: 'mkv_6', outputKey: 'rgb'    } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } },
        params: {},
      },
      // .yzx — X drives blue, Y drives red, Z drives green
      {
        id: 'sw_8', type: 'vec3Swizzle', position: { x: 1400, y: 260 },
        inputs: { input: { type: 'vec3', label: 'Input', connection: { nodeId: 'add_7', outputKey: 'result' } } },
        outputs: { output: { type: 'vec3', label: 'Output' } },
        params: { mode: 'yzx' },
      },
      {
        id: 'output_9', type: 'output', position: { x: 1580, y: 260 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'sw_8', outputKey: 'output' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Glow Marcher — volumetric glow via per-step 1/d accumulation ─────────────
  glowMarcher: {
    label: '3D: Glow Marcher',
    counter: 6,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 60,  y: 200 }, inputs: {}, outputs: { uv:   { type: 'vec2',  label: 'UV'   } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 60,  y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'cam_2', type: 'marchCamera', position: { x: 280, y: 280 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { ro: { type: 'vec3', label: 'Ray Origin' }, rd: { type: 'vec3', label: 'Ray Dir' } },
        params: { camDist: 2.5, camAngle: 0.5, rotSpeed: 0.15, fov: 1.5 },
      },
      {
        id: 'scene_3', type: 'sceneGroup', position: { x: 560, y: 460 },
        inputs:  {},
        outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: 'Sphere',
          subgraph: {
            nodes: [
              { id: 'sp_s3', type: 'scenePos',    position: { x: 80,  y: 150 }, inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'sdf_s3', type: 'sphereSDF3D', position: { x: 300, y: 150 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp_s3', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { radius: 0.5 } },
            ],
            outputNodeId: 'sdf_s3', outputKey: 'dist',
            inputPorts: [], outputPorts: [],
          },
        },
      },
      {
        // Body subgraph: marchPos → marchSceneDist (samples scene each step) →
        // divide(1/d) with assignOp '+=' (accumulates 1/d over all march steps)
        id: 'mlg_4', type: 'marchLoopGroup', position: { x: 820, y: 220 },
        inputs: {
          ro:    { type: 'vec3',    label: 'Ray Origin', connection: { nodeId: 'cam_2',   outputKey: 'ro'    } },
          rd:    { type: 'vec3',    label: 'Ray Dir',    connection: { nodeId: 'cam_2',   outputKey: 'rd'    } },
          scene: { type: 'scene3d', label: 'Scene',      connection: { nodeId: 'scene_3', outputKey: 'scene' } },
          uv:    { type: 'vec2',  label: 'UV' },
          time:  { type: 'float', label: 'Time' },
        },
        outputs: {
          color:     { type: 'vec3',  label: 'Color' },
          dist:      { type: 'float', label: 'Distance' },
          depth:     { type: 'float', label: 'Depth' },
          normal:    { type: 'vec3',  label: 'Normal' },
          iter:      { type: 'float', label: 'Iter' },
          iterCount: { type: 'float', label: 'Iter Count' },
          hit:       { type: 'float', label: 'Hit' },
          pos:       { type: 'vec3',  label: 'Hit Pos' },
          acc0:      { type: 'float', label: 'Glow' },
        },
        params: {
          maxSteps: 96, maxDist: 8.0, stepScale: 1.0,
          volumetric: true, passthrough: 0.1,
          bgR: 0.0, bgG: 0.0, bgB: 0.0,
          albedoR: 0.3, albedoG: 0.5, albedoB: 1.0,
          subgraph: {
            nodes: [
              { id: 'mp_gm',  type: 'marchPos',       position: { x: 80,  y: 160 }, inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              // marchSceneDist: in volumetric mode returns max(sdf, passthrough) so 1/vol is always finite
              { id: 'msd_gm', type: 'marchSceneDist', position: { x: 300, y: 160 },
                inputs:  { pos: { type: 'vec3',  label: 'Position', connection: { nodeId: 'mp_gm', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } },
                params: {} },
              // divide 1/vol — accumulates glow via assignOp +=
              { id: 'div_gm', type: 'divide',          position: { x: 520, y: 160 },
                inputs: {
                  a: { type: 'float', label: 'A', defaultValue: 1 },
                  b: { type: 'float', label: 'B', connection: { nodeId: 'msd_gm', outputKey: 'dist' } },
                },
                outputs: { result: { type: 'float', label: 'Result' } },
                params: {},
                assignOp: '+=' as const,
              },
            ],
            inputPorts: [], outputPorts: [],
          },
        },
      },
      // Scale raw glow sum → tanh compress to 0-1
      // b=0.012: tuned for sphere r=0.5 at camDist=2.5 — center ray accumulates ~120, tanh(1.44)≈0.89
      { id: 'scale_5', type: 'multiply', position: { x: 1100, y: 360 },
        inputs: { a: { type: 'float', label: 'A', connection: { nodeId: 'mlg_4', outputKey: 'acc0' } } },
        outputs: { result: { type: 'float', label: 'Result' } },
        params: { b: 0.012 } },
      { id: 'tanh_6', type: 'tanh', position: { x: 1100, y: 480 },
        inputs: { input: { type: 'float', label: 'Input', connection: { nodeId: 'scale_5', outputKey: 'result' } } },
        outputs: { output: { type: 'float', label: 'Output' } },
        params: {} },
      // Warm orange glow color
      { id: 'gclr_7', type: 'makeVec3', position: { x: 1280, y: 400 },
        inputs: {}, outputs: { rgb: { type: 'vec3', label: 'RGB' } },
        params: { r: 1.0, g: 0.55, b: 0.15 } },
      // Scale glow color by intensity
      { id: 'gmul_8', type: 'multiplyVec3', position: { x: 1460, y: 360 },
        inputs: {
          color: { type: 'vec3',  label: 'Color', connection: { nodeId: 'gclr_7', outputKey: 'rgb'    } },
          scale: { type: 'float', label: 'Scale', connection: { nodeId: 'tanh_6', outputKey: 'output' } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } },
        params: { scale: 1.0 } },
      // Add glow on top of the base render
      { id: 'add_9', type: 'addVec3', position: { x: 1640, y: 260 },
        inputs: {
          a: { type: 'vec3', label: 'A', connection: { nodeId: 'mlg_4', outputKey: 'color'  } },
          b: { type: 'vec3', label: 'B', connection: { nodeId: 'gmul_8', outputKey: 'result' } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } },
        params: {} },
      { id: 'output_10', type: 'output', position: { x: 1820, y: 260 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'add_9', outputKey: 'result' } } },
        outputs: {}, params: {} },
    ],
  },

  // ─── Volumetric examples ──────────────────────────────────────────────────────

  volHollowShell: {
    label: 'Volumetric: Hollow Shell',
    counter: 20,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 60,  y: 200 }, inputs: {}, outputs: { uv:   { type: 'vec2',  label: 'UV'   } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 60,  y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'cam_2', type: 'marchCamera', position: { x: 280, y: 280 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { ro: { type: 'vec3', label: 'Ray Origin' }, rd: { type: 'vec3', label: 'Ray Dir' } },
        params: { camDist: 2.5, camAngle: 0.5, rotSpeed: 0.2, fov: 1.4 },
      },
      {
        id: 'scene_3', type: 'sceneGroup', position: { x: 560, y: 460 },
        inputs: {}, outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: 'Shell',
          subgraph: {
            nodes: [
              { id: 'sp_s3',  type: 'scenePos',    position: { x: 80,  y: 150 }, inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'sdf_s3', type: 'sphereSDF3D', position: { x: 300, y: 150 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp_s3', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { radius: 0.5 } },
            ],
            outputNodeId: 'sdf_s3', outputKey: 'dist', inputPorts: [], outputPorts: [],
          },
        },
      },
      {
        id: 'mlg_4', type: 'marchLoopGroup', position: { x: 820, y: 280 },
        inputs: {
          ro:    { type: 'vec3',    label: 'Ray Origin', connection: { nodeId: 'cam_2',   outputKey: 'ro'    } },
          rd:    { type: 'vec3',    label: 'Ray Dir',    connection: { nodeId: 'cam_2',   outputKey: 'rd'    } },
          scene: { type: 'scene3d', label: 'Scene',      connection: { nodeId: 'scene_3', outputKey: 'scene' } },
          uv:    { type: 'vec2',  label: 'UV' },
          time:  { type: 'float', label: 'Time' },
        },
        outputs: {
          color: { type: 'vec3',  label: 'Color' },
          dist:  { type: 'float', label: 'Distance' },
          depth: { type: 'float', label: 'Depth' },
          normal: { type: 'vec3', label: 'Normal' },
          iter:  { type: 'float', label: 'Iter' },
          iterCount: { type: 'float', label: 'Iter Count' },
          hit:   { type: 'float', label: 'Hit' },
          pos:   { type: 'vec3',  label: 'Hit Pos' },
          acc0:  { type: 'float', label: 'Glow' },
        },
        params: {
          maxSteps: 96, maxDist: 6.0, stepScale: 1.0,
          volumetric: true, passthrough: 0.08,
          bgR: 0.0, bgG: 0.0, bgB: 0.0,
          albedoR: 0.9, albedoG: 0.9, albedoB: 0.9,
          subgraph: {
            nodes: [
              { id: 'mp_v',  type: 'marchPos',       position: { x: 80,  y: 160 }, inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'msd_v', type: 'marchSceneDist', position: { x: 300, y: 160 },
                inputs:  { pos: { type: 'vec3',  label: 'Position', connection: { nodeId: 'mp_v', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' }, rawDist: { type: 'float', label: 'Raw Distance (unclipped)' } },
                params: {} },
              // abs(rawDist): creates hollow shell — rays accumulate max near surface on both entry and exit
              { id: 'abs_v', type: 'abs', position: { x: 480, y: 160 },
                inputs:  { input: { type: 'float', label: 'Input', connection: { nodeId: 'msd_v', outputKey: 'rawDist' } } },
                outputs: { output: { type: 'float', label: 'Output' } },
                params: {} },
              { id: 'clamp_v', type: 'max', position: { x: 650, y: 160 },
                inputs: {
                  a: { type: 'float', label: 'A', connection: { nodeId: 'abs_v', outputKey: 'output' } },
                  b: { type: 'float', label: 'B', defaultValue: 0.08 },
                },
                outputs: { result: { type: 'float', label: 'Result' } }, params: {} },
              { id: 'div_v', type: 'divide', position: { x: 820, y: 160 },
                inputs: {
                  a: { type: 'float', label: 'A', defaultValue: 1 },
                  b: { type: 'float', label: 'B', connection: { nodeId: 'clamp_v', outputKey: 'result' } },
                },
                outputs: { result: { type: 'float', label: 'Result' } },
                params: {}, assignOp: '+=' as const },
            ],
            inputPorts: [], outputPorts: [],
          },
        },
      },
      { id: 'scale_5', type: 'multiply', position: { x: 1100, y: 340 },
        inputs: { a: { type: 'float', label: 'A', connection: { nodeId: 'mlg_4', outputKey: 'acc0' } } },
        outputs: { result: { type: 'float', label: 'Result' } },
        params: { b: 0.018 } },
      { id: 'tanh_6', type: 'tanh', position: { x: 1100, y: 460 },
        inputs: { input: { type: 'float', label: 'Input', connection: { nodeId: 'scale_5', outputKey: 'result' } } },
        outputs: { output: { type: 'float', label: 'Output' } }, params: {} },
      { id: 'gclr_7', type: 'makeVec3', position: { x: 1280, y: 360 },
        inputs: {}, outputs: { rgb: { type: 'vec3', label: 'RGB' } },
        params: { r: 1.0, g: 0.95, b: 0.7 } },
      { id: 'gmul_8', type: 'multiplyVec3', position: { x: 1460, y: 340 },
        inputs: {
          color: { type: 'vec3',  label: 'Color', connection: { nodeId: 'gclr_7', outputKey: 'rgb'    } },
          scale: { type: 'float', label: 'Scale', connection: { nodeId: 'tanh_6', outputKey: 'output' } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } }, params: { scale: 1.0 } },
      { id: 'output_9', type: 'output', position: { x: 1640, y: 280 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'gmul_8', outputKey: 'result' } } },
        outputs: {}, params: {} },
    ],
  },

  volTorus: {
    label: 'Volumetric: Glowing Torus',
    counter: 20,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 60,  y: 200 }, inputs: {}, outputs: { uv:   { type: 'vec2',  label: 'UV'   } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 60,  y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'cam_2', type: 'marchCamera', position: { x: 280, y: 280 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { ro: { type: 'vec3', label: 'Ray Origin' }, rd: { type: 'vec3', label: 'Ray Dir' } },
        params: { camDist: 2.5, camAngle: 0.4, rotSpeed: 0.25, fov: 1.3, elevAngle: 0.3 },
      },
      {
        id: 'scene_3', type: 'sceneGroup', position: { x: 560, y: 460 },
        inputs: {}, outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: 'Torus',
          subgraph: {
            nodes: [
              { id: 'sp_s3',  type: 'scenePos',    position: { x: 80,  y: 150 }, inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'tor_s3', type: 'torusSDF3D', position: { x: 300, y: 150 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp_s3', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { majorR: 0.55, minorR: 0.18 } },
            ],
            outputNodeId: 'tor_s3', outputKey: 'dist', inputPorts: [], outputPorts: [],
          },
        },
      },
      {
        id: 'mlg_4', type: 'marchLoopGroup', position: { x: 820, y: 280 },
        inputs: {
          ro:    { type: 'vec3',    label: 'Ray Origin', connection: { nodeId: 'cam_2',   outputKey: 'ro'    } },
          rd:    { type: 'vec3',    label: 'Ray Dir',    connection: { nodeId: 'cam_2',   outputKey: 'rd'    } },
          scene: { type: 'scene3d', label: 'Scene',      connection: { nodeId: 'scene_3', outputKey: 'scene' } },
          uv:    { type: 'vec2',  label: 'UV' },
          time:  { type: 'float', label: 'Time' },
        },
        outputs: {
          color: { type: 'vec3',  label: 'Color' },
          dist:  { type: 'float', label: 'Distance' },
          depth: { type: 'float', label: 'Depth' },
          normal: { type: 'vec3', label: 'Normal' },
          iter:  { type: 'float', label: 'Iter' },
          iterCount: { type: 'float', label: 'Iter Count' },
          hit:   { type: 'float', label: 'Hit' },
          pos:   { type: 'vec3',  label: 'Hit Pos' },
          acc0:  { type: 'float', label: 'Glow' },
        },
        params: {
          maxSteps: 96, maxDist: 6.0, stepScale: 1.0,
          volumetric: true, passthrough: 0.05,
          bgR: 0.0, bgG: 0.0, bgB: 0.0,
          albedoR: 0.2, albedoG: 0.8, albedoB: 1.0,
          subgraph: {
            nodes: [
              { id: 'mp_t',  type: 'marchPos',       position: { x: 80,  y: 160 }, inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'msd_t', type: 'marchSceneDist', position: { x: 300, y: 160 },
                inputs:  { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'mp_t', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' }, rawDist: { type: 'float', label: 'Raw Distance (unclipped)' } },
                params: {} },
              { id: 'div_t', type: 'divide', position: { x: 500, y: 160 },
                inputs: {
                  a: { type: 'float', label: 'A', defaultValue: 1 },
                  b: { type: 'float', label: 'B', connection: { nodeId: 'msd_t', outputKey: 'dist' } },
                },
                outputs: { result: { type: 'float', label: 'Result' } },
                params: {}, assignOp: '+=' as const },
            ],
            inputPorts: [], outputPorts: [],
          },
        },
      },
      { id: 'scale_5', type: 'multiply', position: { x: 1100, y: 340 },
        inputs: { a: { type: 'float', label: 'A', connection: { nodeId: 'mlg_4', outputKey: 'acc0' } } },
        outputs: { result: { type: 'float', label: 'Result' } },
        params: { b: 0.015 } },
      { id: 'tanh_6', type: 'tanh', position: { x: 1100, y: 460 },
        inputs: { input: { type: 'float', label: 'Input', connection: { nodeId: 'scale_5', outputKey: 'result' } } },
        outputs: { output: { type: 'float', label: 'Output' } }, params: {} },
      { id: 'gclr_7', type: 'makeVec3', position: { x: 1280, y: 360 },
        inputs: {}, outputs: { rgb: { type: 'vec3', label: 'RGB' } },
        params: { r: 0.2, g: 0.7, b: 1.0 } },
      { id: 'gmul_8', type: 'multiplyVec3', position: { x: 1460, y: 340 },
        inputs: {
          color: { type: 'vec3',  label: 'Color', connection: { nodeId: 'gclr_7', outputKey: 'rgb'    } },
          scale: { type: 'float', label: 'Scale', connection: { nodeId: 'tanh_6', outputKey: 'output' } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } }, params: { scale: 1.0 } },
      { id: 'output_9', type: 'output', position: { x: 1640, y: 280 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'gmul_8', outputKey: 'result' } } },
        outputs: {}, params: {} },
    ],
  },

  volRepeatLattice: {
    label: 'Volumetric: Repeat Lattice',
    counter: 20,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 60,  y: 200 }, inputs: {}, outputs: { uv:   { type: 'vec2',  label: 'UV'   } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 60,  y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'cam_2', type: 'marchCamera', position: { x: 280, y: 280 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { ro: { type: 'vec3', label: 'Ray Origin' }, rd: { type: 'vec3', label: 'Ray Dir' } },
        params: { camDist: 4.0, camAngle: 0.6, rotSpeed: 0.12, fov: 1.3 },
      },
      {
        id: 'scene_3', type: 'sceneGroup', position: { x: 560, y: 460 },
        inputs: {}, outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: 'Lattice',
          subgraph: {
            nodes: [
              { id: 'sp_s3',  type: 'scenePos',         position: { x: 80,  y: 150 }, inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'rep_s3', type: 'mirroredRepeat3D',  position: { x: 260, y: 150 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp_s3', outputKey: 'pos' } } },
                outputs: { pos: { type: 'vec3', label: 'Mirrored Pos' }, cellID: { type: 'vec3', label: 'Cell ID' } },
                params: { cellX: 2.0, cellY: 2.0, cellZ: 2.0 } },
              { id: 'sdf_s3', type: 'sphereSDF3D', position: { x: 480, y: 150 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'rep_s3', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { radius: 0.22 } },
            ],
            outputNodeId: 'sdf_s3', outputKey: 'dist', inputPorts: [], outputPorts: [],
          },
        },
      },
      {
        id: 'mlg_4', type: 'marchLoopGroup', position: { x: 820, y: 280 },
        inputs: {
          ro:    { type: 'vec3',    label: 'Ray Origin', connection: { nodeId: 'cam_2',   outputKey: 'ro'    } },
          rd:    { type: 'vec3',    label: 'Ray Dir',    connection: { nodeId: 'cam_2',   outputKey: 'rd'    } },
          scene: { type: 'scene3d', label: 'Scene',      connection: { nodeId: 'scene_3', outputKey: 'scene' } },
          uv:    { type: 'vec2',  label: 'UV' },
          time:  { type: 'float', label: 'Time' },
        },
        outputs: {
          color: { type: 'vec3',  label: 'Color' },
          dist:  { type: 'float', label: 'Distance' },
          depth: { type: 'float', label: 'Depth' },
          normal: { type: 'vec3', label: 'Normal' },
          iter:  { type: 'float', label: 'Iter' },
          iterCount: { type: 'float', label: 'Iter Count' },
          hit:   { type: 'float', label: 'Hit' },
          pos:   { type: 'vec3',  label: 'Hit Pos' },
          acc0:  { type: 'float', label: 'Glow' },
        },
        params: {
          maxSteps: 128, maxDist: 14.0, stepScale: 1.0,
          volumetric: true, passthrough: 0.12,
          bgR: 0.0, bgG: 0.0, bgB: 0.0,
          albedoR: 1.0, albedoG: 0.4, albedoB: 0.1,
          subgraph: {
            nodes: [
              { id: 'mp_r',  type: 'marchPos',       position: { x: 80,  y: 160 }, inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'msd_r', type: 'marchSceneDist', position: { x: 300, y: 160 },
                inputs:  { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'mp_r', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' }, rawDist: { type: 'float', label: 'Raw Distance (unclipped)' } },
                params: {} },
              { id: 'div_r', type: 'divide', position: { x: 500, y: 160 },
                inputs: {
                  a: { type: 'float', label: 'A', defaultValue: 1 },
                  b: { type: 'float', label: 'B', connection: { nodeId: 'msd_r', outputKey: 'dist' } },
                },
                outputs: { result: { type: 'float', label: 'Result' } },
                params: {}, assignOp: '+=' as const },
            ],
            inputPorts: [], outputPorts: [],
          },
        },
      },
      // b=0.0015: lattice rays pass through N spheres so accumulation is N× higher than single sphere
      { id: 'scale_5', type: 'multiply', position: { x: 1100, y: 340 },
        inputs: { a: { type: 'float', label: 'A', connection: { nodeId: 'mlg_4', outputKey: 'acc0' } } },
        outputs: { result: { type: 'float', label: 'Result' } },
        params: { b: 0.0015 } },
      { id: 'tanh_6', type: 'tanh', position: { x: 1100, y: 460 },
        inputs: { input: { type: 'float', label: 'Input', connection: { nodeId: 'scale_5', outputKey: 'result' } } },
        outputs: { output: { type: 'float', label: 'Output' } }, params: {} },
      { id: 'gclr_7', type: 'makeVec3', position: { x: 1280, y: 360 },
        inputs: {}, outputs: { rgb: { type: 'vec3', label: 'RGB' } },
        params: { r: 1.0, g: 0.35, b: 0.05 } },
      { id: 'gmul_8', type: 'multiplyVec3', position: { x: 1460, y: 340 },
        inputs: {
          color: { type: 'vec3',  label: 'Color', connection: { nodeId: 'gclr_7', outputKey: 'rgb'    } },
          scale: { type: 'float', label: 'Scale', connection: { nodeId: 'tanh_6', outputKey: 'output' } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } }, params: { scale: 1.0 } },
      { id: 'output_9', type: 'output', position: { x: 1640, y: 280 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'gmul_8', outputKey: 'result' } } },
        outputs: {}, params: {} },
    ],
  },

  volOctahedron: {
    label: 'Volumetric: Octahedron',
    counter: 20,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 60,  y: 200 }, inputs: {}, outputs: { uv:   { type: 'vec2',  label: 'UV'   } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 60,  y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'cam_2', type: 'marchCamera', position: { x: 280, y: 280 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { ro: { type: 'vec3', label: 'Ray Origin' }, rd: { type: 'vec3', label: 'Ray Dir' } },
        params: { camDist: 3.0, camAngle: 0.5, rotSpeed: 0.25, fov: 1.3 },
      },
      {
        id: 'scene_3', type: 'sceneGroup', position: { x: 560, y: 460 },
        inputs: {}, outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: 'Octa',
          subgraph: {
            nodes: [
              { id: 'sp_s3',  type: 'scenePos',       position: { x: 80,  y: 150 }, inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'oct_s3', type: 'octahedronSDF3D', position: { x: 300, y: 150 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp_s3', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { size: 0.7 } },
            ],
            outputNodeId: 'oct_s3', outputKey: 'dist', inputPorts: [], outputPorts: [],
          },
        },
      },
      {
        // Hollow octahedron: abs(rawDist) concentrates glow at the faces, leaving interior dark
        id: 'mlg_4', type: 'marchLoopGroup', position: { x: 820, y: 280 },
        inputs: {
          ro:    { type: 'vec3',    label: 'Ray Origin', connection: { nodeId: 'cam_2',   outputKey: 'ro'    } },
          rd:    { type: 'vec3',    label: 'Ray Dir',    connection: { nodeId: 'cam_2',   outputKey: 'rd'    } },
          scene: { type: 'scene3d', label: 'Scene',      connection: { nodeId: 'scene_3', outputKey: 'scene' } },
          uv:    { type: 'vec2',  label: 'UV' },
          time:  { type: 'float', label: 'Time' },
        },
        outputs: {
          color: { type: 'vec3',  label: 'Color' },
          dist:  { type: 'float', label: 'Distance' },
          depth: { type: 'float', label: 'Depth' },
          normal: { type: 'vec3', label: 'Normal' },
          iter:  { type: 'float', label: 'Iter' },
          iterCount: { type: 'float', label: 'Iter Count' },
          hit:   { type: 'float', label: 'Hit' },
          pos:   { type: 'vec3',  label: 'Hit Pos' },
          acc0:  { type: 'float', label: 'Glow' },
        },
        params: {
          maxSteps: 96, maxDist: 8.0, stepScale: 1.0,
          volumetric: true, passthrough: 0.1,
          bgR: 0.0, bgG: 0.0, bgB: 0.0,
          albedoR: 1.0, albedoG: 0.8, albedoB: 0.2,
          subgraph: {
            nodes: [
              { id: 'mp_o',  type: 'marchPos',       position: { x: 80,  y: 160 }, inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'msd_o', type: 'marchSceneDist', position: { x: 300, y: 160 },
                inputs:  { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'mp_o', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' }, rawDist: { type: 'float', label: 'Raw Distance (unclipped)' } },
                params: {} },
              { id: 'abs_o', type: 'abs', position: { x: 480, y: 160 },
                inputs:  { input: { type: 'float', label: 'Input', connection: { nodeId: 'msd_o', outputKey: 'rawDist' } } },
                outputs: { output: { type: 'float', label: 'Output' } }, params: {} },
              { id: 'clamp_o', type: 'max', position: { x: 650, y: 160 },
                inputs: {
                  a: { type: 'float', label: 'A', connection: { nodeId: 'abs_o', outputKey: 'output' } },
                  b: { type: 'float', label: 'B', defaultValue: 0.1 },
                },
                outputs: { result: { type: 'float', label: 'Result' } }, params: {} },
              { id: 'div_o', type: 'divide', position: { x: 820, y: 160 },
                inputs: {
                  a: { type: 'float', label: 'A', defaultValue: 1 },
                  b: { type: 'float', label: 'B', connection: { nodeId: 'clamp_o', outputKey: 'result' } },
                },
                outputs: { result: { type: 'float', label: 'Result' } },
                params: {}, assignOp: '+=' as const },
            ],
            inputPorts: [], outputPorts: [],
          },
        },
      },
      { id: 'scale_5', type: 'multiply', position: { x: 1100, y: 340 },
        inputs: { a: { type: 'float', label: 'A', connection: { nodeId: 'mlg_4', outputKey: 'acc0' } } },
        outputs: { result: { type: 'float', label: 'Result' } },
        params: { b: 0.008 } },
      { id: 'tanh_6', type: 'tanh', position: { x: 1100, y: 460 },
        inputs: { input: { type: 'float', label: 'Input', connection: { nodeId: 'scale_5', outputKey: 'result' } } },
        outputs: { output: { type: 'float', label: 'Output' } }, params: {} },
      { id: 'gclr_7', type: 'makeVec3', position: { x: 1280, y: 360 },
        inputs: {}, outputs: { rgb: { type: 'vec3', label: 'RGB' } },
        params: { r: 1.0, g: 0.85, b: 0.2 } },
      { id: 'gmul_8', type: 'multiplyVec3', position: { x: 1460, y: 340 },
        inputs: {
          color: { type: 'vec3',  label: 'Color', connection: { nodeId: 'gclr_7', outputKey: 'rgb'    } },
          scale: { type: 'float', label: 'Scale', connection: { nodeId: 'tanh_6', outputKey: 'output' } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } }, params: { scale: 1.0 } },
      { id: 'output_9', type: 'output', position: { x: 1640, y: 280 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'gmul_8', outputKey: 'result' } } },
        outputs: {}, params: {} },
    ],
  },

  volAnimatedRepeat: {
    label: 'Volumetric: Animated Repeat',
    counter: 30,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 40,  y: 522 }, inputs: {}, outputs: { uv:   { type: 'vec2',  label: 'UV'   } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 40,  y: 424 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'cam_2', type: 'marchCamera', position: { x: 380, y: 60 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { ro: { type: 'vec3', label: 'Ray Origin' }, rd: { type: 'vec3', label: 'Ray Dir' } },
        params: { camDist: 3.15, camAngle: 5.4, rotSpeed: 0.0, fov: 1.25 },
      },
      {
        id: 'scene_3', type: 'sceneGroup', position: { x: 380, y: 448 },
        inputs: {}, outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: 'Repeated Spheres',
          subgraph: {
            nodes: [
              { id: 'sp_inn',   type: 'scenePos',   position: { x: 40,  y: 180 }, inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'time_inn', type: 'time',        position: { x: 40,  y: 278 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
              // Animate translation along Z over time for flowing scroll effect
              { id: 'multz_inn', type: 'multiply', position: { x: 380, y: 60 },
                inputs: { a: { type: 'float', label: 'A', connection: { nodeId: 'time_inn', outputKey: 'time' } } },
                outputs: { result: { type: 'float', label: 'Result' } },
                params: { b: -0.4 } },
              { id: 'tr_inn', type: 'translate3D', position: { x: 720, y: 60 },
                inputs: {
                  pos: { type: 'vec3',  label: 'Position', connection: { nodeId: 'sp_inn',   outputKey: 'pos'    } },
                  tz:  { type: 'float', label: 'Z',        connection: { nodeId: 'multz_inn', outputKey: 'result' } },
                },
                outputs: { pos: { type: 'vec3', label: 'Translated Pos' } },
                params: { tx: -0.43, ty: -0.28, tz: 0 } },
              // Dense X repeat, sparse Y/Z — creates layered sheets of spheres
              { id: 'rep_inn', type: 'repeat3D', position: { x: 1060, y: 60 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'tr_inn', outputKey: 'pos' } } },
                outputs: { pos: { type: 'vec3', label: 'Repeated Pos' } },
                params: { cellX: 0.5, cellY: 2.5, cellZ: 1.6 } },
              // Animated sphere radius: cos(sin(time)) oscillation
              { id: 'sin_inn', type: 'sin', position: { x: 680, y: 330 },
                inputs: { input: { type: 'float', label: 'Input', connection: { nodeId: 'time_inn', outputKey: 'time' } } },
                outputs: { output: { type: 'float', label: 'Output' } },
                params: { freq: 0.89, amp: 0.4 } },
              { id: 'cos_inn', type: 'cos', position: { x: 980, y: 330 },
                inputs: { input: { type: 'float', label: 'Input', connection: { nodeId: 'sin_inn', outputKey: 'output' } } },
                outputs: { output: { type: 'float', label: 'Output' } },
                params: { freq: 1.66, amp: 0.1 } },
              { id: 'sdf_inn', type: 'sphereSDF3D', position: { x: 1380, y: 60 },
                inputs: {
                  pos:    { type: 'vec3',  label: 'Position', connection: { nodeId: 'rep_inn', outputKey: 'pos'    } },
                  radius: { type: 'float', label: 'Radius',   connection: { nodeId: 'cos_inn', outputKey: 'output' } },
                },
                outputs: { dist: { type: 'float', label: 'Distance' } },
                params: { radius: 0.1 } },
            ],
            outputNodeId: 'sdf_inn', outputKey: 'dist', inputPorts: [], outputPorts: [],
          },
        },
      },
      {
        id: 'mlg_4', type: 'marchLoopGroup', position: { x: 720, y: 60 },
        inputs: {
          ro:    { type: 'vec3',    label: 'Ray Origin', connection: { nodeId: 'cam_2',   outputKey: 'ro'    } },
          rd:    { type: 'vec3',    label: 'Ray Dir',    connection: { nodeId: 'cam_2',   outputKey: 'rd'    } },
          scene: { type: 'scene3d', label: 'Scene',      connection: { nodeId: 'scene_3', outputKey: 'scene' } },
          uv:    { type: 'vec2',  label: 'UV' },
          time:  { type: 'float', label: 'Time' },
        },
        outputs: {
          color: { type: 'vec3',  label: 'Color' }, dist:  { type: 'float', label: 'Distance' },
          depth: { type: 'float', label: 'Depth' }, normal: { type: 'vec3', label: 'Normal' },
          iter:  { type: 'float', label: 'Iter' },  iterCount: { type: 'float', label: 'Iter Count' },
          hit:   { type: 'float', label: 'Hit' },   pos: { type: 'vec3', label: 'Hit Pos' },
          acc0:  { type: 'float', label: 'Glow' },
        },
        params: {
          maxSteps: 150, maxDist: 20.0, stepScale: 1.0,
          volumetric: true, passthrough: 0.12,
          bgR: 0.0, bgG: 0.0, bgB: 0.0,
          albedoR: 0.5, albedoG: 0.5, albedoB: 0.5,
          subgraph: {
            nodes: [
              { id: 'mp_b',   type: 'marchPos', position: { x: 60,  y: 160 }, inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'time_b', type: 'time',     position: { x: 60,  y: 300 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
              // sinWarp warps the march path for organic look (same params as original body)
              { id: 'swarp_b', type: 'sinWarp3D', position: { x: 300, y: 160 },
                inputs: {
                  p:    { type: 'vec3',  label: 'Position', connection: { nodeId: 'mp_b',   outputKey: 'pos'  } },
                  time: { type: 'float', label: 'Time',     connection: { nodeId: 'time_b', outputKey: 'time' } },
                },
                outputs: { p: { type: 'vec3', label: 'Warped Position' } },
                params: { distort_axis: 'z', source_axis: 'z', frequency: 2.21, amplitude: 0.49 } },
              { id: 'msd_b', type: 'marchSceneDist', position: { x: 560, y: 160 },
                inputs:  { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'swarp_b', outputKey: 'p' } } },
                outputs: { dist: { type: 'float', label: 'Distance' }, rawDist: { type: 'float', label: 'Raw Distance (unclipped)' } },
                params: {} },
              { id: 'abs_b', type: 'abs', position: { x: 740, y: 160 },
                inputs:  { input: { type: 'float', label: 'Input', connection: { nodeId: 'msd_b', outputKey: 'rawDist' } } },
                outputs: { output: { type: 'float', label: 'Output' } }, params: {} },
              { id: 'clamp_b', type: 'max', position: { x: 900, y: 160 },
                inputs: {
                  a: { type: 'float', label: 'A', connection: { nodeId: 'abs_b', outputKey: 'output' } },
                  b: { type: 'float', label: 'B', defaultValue: 0.12 },
                },
                outputs: { result: { type: 'float', label: 'Result' } }, params: {} },
              { id: 'div_b', type: 'divide', position: { x: 1060, y: 160 },
                inputs: {
                  a: { type: 'float', label: 'A', defaultValue: 1 },
                  b: { type: 'float', label: 'B', connection: { nodeId: 'clamp_b', outputKey: 'result' } },
                },
                outputs: { result: { type: 'float', label: 'Result' } },
                params: {}, assignOp: '+=' as const },
            ],
            inputPorts: [], outputPorts: [],
          },
        },
      },
      // glow → [0,1] for palette input
      { id: 'scale_5', type: 'multiply', position: { x: 1060, y: 60 },
        inputs: { a: { type: 'float', label: 'A', connection: { nodeId: 'mlg_4', outputKey: 'acc0' } } },
        outputs: { result: { type: 'float', label: 'Result' } },
        params: { b: 0.004 } },
      { id: 'tanh_6', type: 'tanh', position: { x: 1060, y: 180 },
        inputs: { input: { type: 'float', label: 'Input', connection: { nodeId: 'scale_5', outputKey: 'result' } } },
        outputs: { output: { type: 'float', label: 'Output' } }, params: {} },
      // IQ cosine palette — same params as the original graph
      { id: 'pal_7', type: 'palette', position: { x: 1400, y: 60 },
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'tanh_6', outputKey: 'output' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { offset: [0.5, 0.5, 0.5], amplitude: [0.5, 0.5, 0.5], freq: [1, 1, 1], phase: [0.3, 0.416, 0.557] } },
      // Post-processing chain from original: chromaShift → grain → toneMap
      { id: 'chroma_8', type: 'chromaShift', position: { x: 1760, y: 60 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'pal_7', outputKey: 'color' } },
                  uv: { type: 'vec2', label: 'UV' }, time: { type: 'float', label: 'Time' } },
        outputs: { result: { type: 'vec3', label: 'Result' } },
        params: { mode: 'linear', strength: 0.08, contrast: 2.05, angle_deg: 0, animate: 'false', anim_speed: 0.4 } },
      { id: 'grain_9', type: 'grain', position: { x: 2100, y: 60 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'chroma_8', outputKey: 'result' } },
                  uv: { type: 'vec2', label: 'UV' },
                  seed: { type: 'float', label: 'Seed', connection: { nodeId: 'time_1', outputKey: 'time' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { mode: 'basic', amount: 0.185, scale: 1, seed: 0 } },
      { id: 'tone_10', type: 'toneMap', position: { x: 2440, y: 60 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'grain_9', outputKey: 'color' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { mode: 'tanh' } },
      { id: 'out_11', type: 'output', position: { x: 2780, y: 60 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'tone_10', outputKey: 'color' } } },
        outputs: {}, params: {} },
    ],
  },

  // ── Shaper: Logistic Sigmoid Glow ────────────────────────────────────────────
  // Circle SDF distance → logisticSigmoid creates a crisp threshold instead of
  // soft falloff → multiply palette by sharpened brightness.
  shaperLogisticGlow: {
    label: 'Shaper: Logistic Sigmoid Glow',
    counter: 8,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 40, y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 40, y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'circle_2', type: 'circleSDF', position: { x: 280, y: 180 },
        inputs: { position: { type: 'vec2', label: 'Position', connection: { nodeId: 'uv_0', outputKey: 'uv' } } },
        outputs: { distance: { type: 'float', label: 'Distance' } },
        params: { radius: 0.35, posX: 0.0, posY: 0.0 },
      },
      // negate + remap distance so that 0 = edge, 1 = inside
      { id: 'neg_3', type: 'negate', position: { x: 460, y: 180 },
        inputs: { input: { type: 'float', label: 'Input', connection: { nodeId: 'circle_2', outputKey: 'distance' } } },
        outputs: { output: { type: 'float', label: 'Output' } }, params: {} },
      { id: 'add_4', type: 'add', position: { x: 620, y: 180 },
        inputs: { a: { type: 'float', label: 'A', connection: { nodeId: 'neg_3', outputKey: 'output' } } },
        outputs: { result: { type: 'float', label: 'Result' } },
        params: { b: 0.5 } },
      // logisticSigmoid sharpens the falloff into a crisp ring/fill
      { id: 'sig_5', type: 'logisticSigmoid', position: { x: 800, y: 180 },
        inputs: { x: { type: 'float', label: 'x', connection: { nodeId: 'add_4', outputKey: 'result' } } },
        outputs: { y: { type: 'float', label: 'y' } },
        params: { a: 0.92, bipolar: false } },
      { id: 'pal_6', type: 'palettePreset', position: { x: 800, y: 360 },
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'time_1', outputKey: 'time' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { preset: '4', speed: 0.4 } },
      { id: 'mul_7', type: 'multiplyVec3', position: { x: 1040, y: 260 },
        inputs: {
          color: { type: 'vec3',  label: 'Color', connection: { nodeId: 'pal_6', outputKey: 'color'  } },
          scale: { type: 'float', label: 'Scale', connection: { nodeId: 'sig_5', outputKey: 'y'      } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } }, params: {} },
      { id: 'out_8', type: 'output', position: { x: 1240, y: 260 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'mul_7', outputKey: 'result' } } },
        outputs: {}, params: {} },
    ],
  },

  // ── Shaper: Exp Ease Pulsing Ring ─────────────────────────────────────────────
  // Time → sin oscillation → expEase shapes the pulse envelope so it eases in/out
  // → drives ring radius for a breathing circle.
  shaperExpEasePulse: {
    label: 'Shaper: Exp Ease Pulse',
    counter: 9,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 40, y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 40, y: 400 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      // sin → [−1,1] → shift to [0,1]
      { id: 'sin_2', type: 'sin', position: { x: 240, y: 400 },
        inputs: { input: { type: 'float', label: 'Input', connection: { nodeId: 'time_1', outputKey: 'time' } } },
        outputs: { output: { type: 'float', label: 'Output' } },
        params: { freq: 0.8, amp: 0.5 } },
      { id: 'shift_3', type: 'add', position: { x: 420, y: 400 },
        inputs: { a: { type: 'float', label: 'A', connection: { nodeId: 'sin_2', outputKey: 'output' } } },
        outputs: { result: { type: 'float', label: 'Result' } },
        params: { b: 0.5 } },
      // expEase shapes the pulse — try a=0 for ease-in, a=1 for ease-out
      { id: 'ease_4', type: 'expEase', position: { x: 600, y: 400 },
        inputs: { x: { type: 'float', label: 'x', connection: { nodeId: 'shift_3', outputKey: 'result' } } },
        outputs: { y: { type: 'float', label: 'y' } },
        params: { a: 0.15, bipolar: false } },
      // remap [0,1] → radius range [0.1, 0.55]
      { id: 'scl_5', type: 'multiply', position: { x: 780, y: 400 },
        inputs: { a: { type: 'float', label: 'A', connection: { nodeId: 'ease_4', outputKey: 'y' } } },
        outputs: { result: { type: 'float', label: 'Result' } },
        params: { b: 0.45 } },
      { id: 'rad_6', type: 'add', position: { x: 940, y: 400 },
        inputs: { a: { type: 'float', label: 'A', connection: { nodeId: 'scl_5', outputKey: 'result' } } },
        outputs: { result: { type: 'float', label: 'Result' } },
        params: { b: 0.1 } },
      { id: 'circle_7', type: 'circleSDF', position: { x: 640, y: 180 },
        inputs: {
          position: { type: 'vec2',  label: 'Position', connection: { nodeId: 'uv_0',  outputKey: 'uv'     } },
          radius:   { type: 'float', label: 'Radius',   connection: { nodeId: 'rad_6', outputKey: 'result' } },
        },
        outputs: { distance: { type: 'float', label: 'Distance' } },
        params: { radius: 0.3, posX: 0.0, posY: 0.0 } },
      { id: 'light_8', type: 'makeLight', position: { x: 900, y: 180 },
        inputs: { distance: { type: 'float', label: 'Distance', connection: { nodeId: 'circle_7', outputKey: 'distance' } } },
        outputs: { glow: { type: 'float', label: 'Glow' } },
        params: { brightness: 8.0 } },
      { id: 'pal_9', type: 'palettePreset', position: { x: 900, y: 300 },
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'time_1', outputKey: 'time' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { preset: 'neon', speed: 0.3 } },
      { id: 'mul_10', type: 'multiplyVec3', position: { x: 1120, y: 220 },
        inputs: {
          color: { type: 'vec3',  label: 'Color', connection: { nodeId: 'pal_9',   outputKey: 'color' } },
          scale: { type: 'float', label: 'Scale', connection: { nodeId: 'light_8', outputKey: 'glow'  } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } }, params: {} },
      { id: 'tone_11', type: 'toneMap', position: { x: 1300, y: 220 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'mul_10', outputKey: 'result' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { mode: 'aces' } },
      { id: 'out_12', type: 'output', position: { x: 1480, y: 220 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'tone_11', outputKey: 'color' } } },
        outputs: {}, params: {} },
    ],
  },

  // ── Shaper: Exp Sigmoid FBM Contrast ─────────────────────────────────────────
  // FBM noise → doubleExpSigmoid crushes midtones and boosts contrast at a/b
  // → palette coloring for punchy terrain-style visuals.
  shaperSigmoidFBM: {
    label: 'Shaper: Sigmoid FBM Contrast',
    counter: 7,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 40, y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 40, y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      { id: 'fbm_2', type: 'fbm', position: { x: 280, y: 180 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { value: { type: 'float', label: 'Value' } },
        params: { octaves: 5, lacunarity: 2.0, gain: 0.5, scale: 2.5, time_scale: 0.15 } },
      // doubleExpSigmoid with high sharpness creates bold banded contrast
      { id: 'sig_3', type: 'doubleExpSigmoid', position: { x: 520, y: 180 },
        inputs: { x: { type: 'float', label: 'x', connection: { nodeId: 'fbm_2', outputKey: 'value' } } },
        outputs: { y: { type: 'float', label: 'y' } },
        params: { a: 0.78, bipolar: false } },
      { id: 'pal_4', type: 'palette', position: { x: 760, y: 180 },
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'sig_3', outputKey: 'y' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { offset: [0.5,0.5,0.5], amplitude: [0.5,0.5,0.5], freq: [1.0,1.0,1.0], phase: [0.0,0.33,0.67] } },
      { id: 'tone_5', type: 'toneMap', position: { x: 1000, y: 180 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'pal_4', outputKey: 'color' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { mode: 'aces' } },
      { id: 'out_6', type: 'output', position: { x: 1200, y: 180 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'tone_5', outputKey: 'color' } } },
        outputs: {}, params: {} },
    ],
  },

  // ── Shaper: Circular Ease Dome ────────────────────────────────────────────────
  // UV length → circularEaseOut creates a smooth radial dome falloff (quarter
  // circle arc) → palette coloring.  Flip to circularEaseIn for an inverse.
  shaperCircularDome: {
    label: 'Shaper: Circular Ease Dome',
    counter: 7,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 40, y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 40, y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      // length gives radial distance from center, scaled to [0,1]
      { id: 'len_2', type: 'length', position: { x: 260, y: 200 },
        inputs: { input: { type: 'vec2', label: 'Input', connection: { nodeId: 'uv_0', outputKey: 'uv' } } },
        outputs: { output: { type: 'float', label: 'Output' } },
        params: { scale: 1.0 } },
      // clamp to [0,1] before the shaper
      { id: 'clamp_3', type: 'clamp', position: { x: 440, y: 200 },
        inputs: { input: { type: 'float', label: 'Input', connection: { nodeId: 'len_2', outputKey: 'output' } } },
        outputs: { output: { type: 'float', label: 'Output' } },
        params: { min: 0.0, max: 1.0 } },
      // circularEaseOut: smooth quarter-circle dome — 1 at center, 0 at edge
      { id: 'ease_4', type: 'circularEaseOut', position: { x: 620, y: 200 },
        inputs: { x: { type: 'float', label: 'x', connection: { nodeId: 'clamp_3', outputKey: 'output' } } },
        outputs: { y: { type: 'float', label: 'y' } },
        params: { bipolar: false } },
      // invert so center is dark, edge is bright
      { id: 'neg_5', type: 'negate', position: { x: 800, y: 200 },
        inputs: { input: { type: 'float', label: 'Input', connection: { nodeId: 'ease_4', outputKey: 'y' } } },
        outputs: { output: { type: 'float', label: 'Output' } }, params: {} },
      { id: 'add_6', type: 'add', position: { x: 960, y: 200 },
        inputs: { a: { type: 'float', label: 'A', connection: { nodeId: 'neg_5', outputKey: 'output' } } },
        outputs: { result: { type: 'float', label: 'Result' } },
        params: { b: 1.0 } },
      { id: 'pal_7', type: 'palette', position: { x: 1140, y: 180 },
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'add_6', outputKey: 'result' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { offset: [0.5,0.5,0.5], amplitude: [0.5,0.5,0.5], freq: [1.0,1.0,1.0], phase: [0.263,0.416,0.557] } },
      { id: 'out_8', type: 'output', position: { x: 1360, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'pal_7', outputKey: 'color' } } },
        outputs: {}, params: {} },
    ],
  },

  // ── Shaper: Quad Bezier Radial ─────────────────────────────────────────────────
  // Radial distance → quadBezierShaper remaps the falloff with a single control
  // point — drag A/B in the bezier editor to reshape the gradient completely.
  shaperBezierRadial: {
    label: 'Shaper: Bezier Radial Gradient',
    counter: 7,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 40, y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 40, y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      { id: 'len_2', type: 'length', position: { x: 260, y: 200 },
        inputs: { input: { type: 'vec2', label: 'Input', connection: { nodeId: 'uv_0', outputKey: 'uv' } } },
        outputs: { output: { type: 'float', label: 'Output' } },
        params: { scale: 1.0 } },
      { id: 'clamp_3', type: 'clamp', position: { x: 440, y: 200 },
        inputs: { input: { type: 'float', label: 'Input', connection: { nodeId: 'len_2', outputKey: 'output' } } },
        outputs: { output: { type: 'float', label: 'Output' } },
        params: { min: 0.0, max: 1.0 } },
      // quadBezierShaper — single control point bends the gradient arc
      { id: 'bez_4', type: 'quadBezierShaper', position: { x: 620, y: 200 },
        inputs: { x: { type: 'float', label: 'x', connection: { nodeId: 'clamp_3', outputKey: 'output' } } },
        outputs: { y: { type: 'float', label: 'y' } },
        params: { a: 0.2, b: 0.85, bipolar: false } },
      // animate palette with time for lively color cycling
      { id: 'addT_5', type: 'add', position: { x: 800, y: 360 },
        inputs: { a: { type: 'float', label: 'A', connection: { nodeId: 'bez_4', outputKey: 'y' } },
                  b: { type: 'float', label: 'B', connection: { nodeId: 'time_1', outputKey: 'time' } } },
        outputs: { result: { type: 'float', label: 'Result' } }, params: {} },
      { id: 'pal_6', type: 'palette', position: { x: 1000, y: 200 },
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'addT_5', outputKey: 'result' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { offset: [0.5,0.5,0.5], amplitude: [0.5,0.5,0.5], freq: [1.0,1.0,1.0], phase: [0.0,0.33,0.67] } },
      { id: 'out_7', type: 'output', position: { x: 1200, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'pal_6', outputKey: 'color' } } },
        outputs: {}, params: {} },
    ],
  },

  // ── Transform Vec: Polar UV Remap ─────────────────────────────────────────────
  // transformVec converts cartesian UV to polar (radius, angle) using per-component
  // GLSL expressions.  FBM fed this polar UV produces concentric + angular bands.
  transformVecPolar: {
    label: 'Transform Vec: Polar Remap',
    counter: 7,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 40, y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 40, y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      // Transform UV → (radius, normalised angle)
      { id: 'tv_2', type: 'transformVec', position: { x: 280, y: 200 },
        inputs: { v: { type: 'vec2', label: 'Vec', connection: { nodeId: 'uv_0', outputKey: 'uv' } } },
        outputs: {
          x: { type: 'float', label: 'X' }, y: { type: 'float', label: 'Y' },
          result: { type: 'vec2', label: 'Result' },
        },
        params: { outputType: 'vec2', exprX: 'sqrt(x*x+y*y)', exprY: 'atan(y,x)/6.2832+0.5' } },
      // scale the polar UV for FBM — high scale gives dense rings
      { id: 'fbm_3', type: 'fbm', position: { x: 540, y: 180 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'tv_2',   outputKey: 'result' } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time'   } },
        },
        outputs: { value: { type: 'float', label: 'Value' } },
        params: { octaves: 4, lacunarity: 2.0, gain: 0.55, scale: 3.0, time_scale: 0.1 } },
      { id: 'pal_4', type: 'palette', position: { x: 800, y: 180 },
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'fbm_3', outputKey: 'value' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { offset: [0.5,0.5,0.5], amplitude: [0.5,0.5,0.5], freq: [1.0,1.0,1.0], phase: [0.0,0.33,0.67] } },
      { id: 'tone_5', type: 'toneMap', position: { x: 1040, y: 180 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'pal_4', outputKey: 'color' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { mode: 'aces' } },
      { id: 'out_6', type: 'output', position: { x: 1240, y: 180 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'tone_5', outputKey: 'color' } } },
        outputs: {}, params: {} },
    ],
  },

  // ── Transform Vec: Mirror Fold ────────────────────────────────────────────────
  // transformVec folds UV into the positive quadrant (abs) and recenters,
  // creating 4-fold symmetry.  FBM then fills the folded space.
  transformVecMirrorFold: {
    label: 'Transform Vec: Mirror Fold',
    counter: 7,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 40, y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 40, y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      // fold: abs(x) makes the negative half a mirror of the positive
      { id: 'tv_2', type: 'transformVec', position: { x: 280, y: 200 },
        inputs: { v: { type: 'vec2', label: 'Vec', connection: { nodeId: 'uv_0', outputKey: 'uv' } } },
        outputs: {
          x: { type: 'float', label: 'X' }, y: { type: 'float', label: 'Y' },
          result: { type: 'vec2', label: 'Result' },
        },
        params: { outputType: 'vec2', exprX: 'abs(x)', exprY: 'abs(y)' } },
      { id: 'fbm_3', type: 'fbm', position: { x: 520, y: 180 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'tv_2',   outputKey: 'result' } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time'   } },
        },
        outputs: { value: { type: 'float', label: 'Value' } },
        params: { octaves: 5, lacunarity: 2.2, gain: 0.5, scale: 3.5, time_scale: 0.08 } },
      // boost contrast with exp sigmoid before coloring
      { id: 'sig_4', type: 'doubleExpSeat', position: { x: 760, y: 180 },
        inputs: { x: { type: 'float', label: 'x', connection: { nodeId: 'fbm_3', outputKey: 'value' } } },
        outputs: { y: { type: 'float', label: 'y' } },
        params: { a: 0.62, bipolar: false } },
      { id: 'pal_5', type: 'palette', position: { x: 960, y: 180 },
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'sig_4', outputKey: 'y' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { offset: [0.5,0.5,0.5], amplitude: [0.5,0.5,0.5], freq: [1.0,1.0,1.0], phase: [0.0,0.33,0.67] } },
      { id: 'tone_6', type: 'toneMap', position: { x: 1160, y: 180 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'pal_5', outputKey: 'color' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { mode: 'aces' } },
      { id: 'out_7', type: 'output', position: { x: 1360, y: 180 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'tone_6', outputKey: 'color' } } },
        outputs: {}, params: {} },
    ],
  },

  // ── Transform Vec: Component Rotate ──────────────────────────────────────────
  // transformVec swaps and negates components — equivalent to a 90° UV rotation
  // — then applies fractal loop.  Shows component arithmetic in exprX/Y.
  transformVecRotate90: {
    label: 'Transform Vec: 90° UV Rotate',
    counter: 5,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 40, y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 40, y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      // rotate 90°: (x,y) → (-y, x)
      { id: 'tv_2', type: 'transformVec', position: { x: 280, y: 200 },
        inputs: { v: { type: 'vec2', label: 'Vec', connection: { nodeId: 'uv_0', outputKey: 'uv' } } },
        outputs: {
          x: { type: 'float', label: 'X' }, y: { type: 'float', label: 'Y' },
          result: { type: 'vec2', label: 'Result' },
        },
        params: { outputType: 'vec2', exprX: '-y', exprY: 'x' } },
      { id: 'fractal_3', type: 'fractalLoop', position: { x: 540, y: 100 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'tv_2',   outputKey: 'result' } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time'   } },
        },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { iterations: 4, fract_scale: 1.5, scale_exp: 1.0, ring_freq: 8.0, glow: 0.01, glow_pow: 1.0, iter_offset: 0.4, time_scale: 0.4, offset: [0.5,0.5,0.5], amplitude: [0.5,0.5,0.5], freq: [1.0,1.0,1.0], phase: [0.0,0.33,0.67] } },
      { id: 'out_4', type: 'output', position: { x: 820, y: 160 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'fractal_3', outputKey: 'color' } } },
        outputs: {}, params: {} },
    ],
  },

  // ── Vectorized Sin: 2D Wave Field ─────────────────────────────────────────────
  // sin applied component-wise to vec2 UV — both axes oscillate independently,
  // producing a 2D wave grid.  The two component outputs drive FBM then palette.
  vecSinWaveField: {
    label: 'Vec Sin: 2D Wave Field',
    counter: 10,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 40, y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 40, y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      // scale UV before sin for more oscillations
      { id: 'scl_2', type: 'multiply', position: { x: 240, y: 200 },
        inputs: { a: { type: 'float', label: 'A' } },
        outputs: { result: { type: 'float', label: 'Result' } },
        params: { b: 5.0 } },
      // vec2 sin — both x and y components shaped simultaneously
      { id: 'sinx_3', type: 'sin', position: { x: 240, y: 180 },
        inputs: { input: { type: 'float', label: 'Input', connection: { nodeId: 'uv_0', outputKey: 'uv' } } },
        outputs: { output: { type: 'float', label: 'Output' } },
        params: { freq: 5.0, amp: 1.0 } },
      // length of the vec2 sin result → scalar brightness
      { id: 'len_4', type: 'length', position: { x: 460, y: 180 },
        inputs: { input: { type: 'vec2', label: 'Input', connection: { nodeId: 'sinx_3', outputKey: 'output' } } },
        outputs: { output: { type: 'float', label: 'Output' } },
        params: { scale: 1.0 } },
      // add time for animated wave drift
      { id: 'addT_5', type: 'add', position: { x: 640, y: 180 },
        inputs: {
          a: { type: 'float', label: 'A', connection: { nodeId: 'len_4',  outputKey: 'output' } },
          b: { type: 'float', label: 'B', connection: { nodeId: 'time_1', outputKey: 'time'   } },
        },
        outputs: { result: { type: 'float', label: 'Result' } }, params: {} },
      { id: 'pal_6', type: 'palette', position: { x: 820, y: 160 },
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'addT_5', outputKey: 'result' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { offset: [0.5,0.5,0.5], amplitude: [0.5,0.5,0.5], freq: [1.0,1.0,1.0], phase: [0.0,0.33,0.67] } },
      { id: 'grain_7', type: 'grain', position: { x: 1020, y: 160 },
        inputs: {
          color: { type: 'vec3',  label: 'Color', connection: { nodeId: 'pal_6',  outputKey: 'color' } },
          uv:    { type: 'vec2',  label: 'UV',    connection: { nodeId: 'uv_0',   outputKey: 'uv'    } },
          seed:  { type: 'float', label: 'Seed',  connection: { nodeId: 'time_1', outputKey: 'time'  } },
        },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { mode: 'basic', amount: 0.06, scale: 1, seed: 0 } },
      { id: 'tone_8', type: 'toneMap', position: { x: 1220, y: 160 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'grain_7', outputKey: 'color' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { mode: 'aces' } },
      { id: 'out_9', type: 'output', position: { x: 1420, y: 160 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'tone_8', outputKey: 'color' } } },
        outputs: {}, params: {} },
    ],
  },

  // ─── Depth of Field examples ─────────────────────────────────────────────────

  dofOrbitOrbs: {
    label: 'DoF: Orbit Orbs',
    counter: 20,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 60,  y: 180 }, inputs: {}, outputs: { uv:   { type: 'vec2',  label: 'UV'   } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 60,  y: 340 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'cam_2', type: 'marchCamera', position: { x: 280, y: 260 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { ro: { type: 'vec3', label: 'Ray Origin' }, rd: { type: 'vec3', label: 'Ray Dir' } },
        params: { camDist: 5.0, camAngle: 0.4, camElevation: 0.25, rotSpeed: 0.09, fov: 1.3, aperture: 0.08, focalDist: 4.5 },
      },
      {
        id: 'scene_3', type: 'sceneGroup', position: { x: 560, y: 420 },
        inputs: {}, outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: 'Three Orbs',
          subgraph: {
            nodes: [
              { id: 'sp', type: 'scenePos', position: { x: 60, y: 160 }, inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              // Orb A — at origin (in focus)
              { id: 'sdf_a', type: 'sphereSDF3D', position: { x: 260, y: 80 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { radius: 0.5 } },
              // Orb B — shifted (blurred, different depth when camera orbits)
              { id: 'ofs_b', type: 'makeVec3', position: { x: 60, y: 280 }, inputs: {}, outputs: { rgb: { type: 'vec3', label: 'RGB' } }, params: { r: -2.0, g: 0.0, b: -1.5 } },
              { id: 'pos_b', type: 'addVec3', position: { x: 260, y: 280 },
                inputs: { a: { type: 'vec3', label: 'A', connection: { nodeId: 'sp', outputKey: 'pos' } }, b: { type: 'vec3', label: 'B', connection: { nodeId: 'ofs_b', outputKey: 'rgb' } } },
                outputs: { result: { type: 'vec3', label: 'Result' } }, params: {} },
              { id: 'sdf_b', type: 'sphereSDF3D', position: { x: 440, y: 280 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'pos_b', outputKey: 'result' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { radius: 0.4 } },
              // Orb C — opposite side
              { id: 'ofs_c', type: 'makeVec3', position: { x: 60, y: 420 }, inputs: {}, outputs: { rgb: { type: 'vec3', label: 'RGB' } }, params: { r: 2.0, g: 0.3, b: 1.5 } },
              { id: 'pos_c', type: 'addVec3', position: { x: 260, y: 420 },
                inputs: { a: { type: 'vec3', label: 'A', connection: { nodeId: 'sp', outputKey: 'pos' } }, b: { type: 'vec3', label: 'B', connection: { nodeId: 'ofs_c', outputKey: 'rgb' } } },
                outputs: { result: { type: 'vec3', label: 'Result' } }, params: {} },
              { id: 'sdf_c', type: 'sphereSDF3D', position: { x: 440, y: 420 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'pos_c', outputKey: 'result' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { radius: 0.35 } },
              // Combine
              { id: 'mn1', type: 'minMath', position: { x: 620, y: 160 },
                inputs: { a: { type: 'float', label: 'A', connection: { nodeId: 'sdf_a', outputKey: 'dist' } }, b: { type: 'float', label: 'B', connection: { nodeId: 'sdf_b', outputKey: 'dist' } } },
                outputs: { result: { type: 'float', label: 'Result' } }, params: {} },
              { id: 'mn2', type: 'minMath', position: { x: 620, y: 320 },
                inputs: { a: { type: 'float', label: 'A', connection: { nodeId: 'mn1', outputKey: 'result' } }, b: { type: 'float', label: 'B', connection: { nodeId: 'sdf_c', outputKey: 'dist' } } },
                outputs: { result: { type: 'float', label: 'Result' } }, params: {} },
            ],
            outputNodeId: 'mn2', outputKey: 'result', inputPorts: [], outputPorts: [],
          },
        },
      },
      {
        id: 'mlg_4', type: 'marchLoopGroup', position: { x: 840, y: 200 },
        inputs: {
          ro:    { type: 'vec3',    label: 'Ray Origin', connection: { nodeId: 'cam_2',   outputKey: 'ro'    } },
          rd:    { type: 'vec3',    label: 'Ray Dir',    connection: { nodeId: 'cam_2',   outputKey: 'rd'    } },
          scene: { type: 'scene3d', label: 'Scene',      connection: { nodeId: 'scene_3', outputKey: 'scene' } },
          uv:    { type: 'vec2',  label: 'UV' },
          time:  { type: 'float', label: 'Time' },
        },
        outputs: { color: { type: 'vec3', label: 'Color' }, dist: { type: 'float', label: 'Distance' }, depth: { type: 'float', label: 'Depth' }, normal: { type: 'vec3', label: 'Normal' }, iter: { type: 'float', label: 'Iter' }, iterCount: { type: 'float', label: 'Iter Count' }, hit: { type: 'float', label: 'Hit' }, pos: { type: 'vec3', label: 'Hit Pos' } },
        params: { maxSteps: 80, maxDist: 20.0, stepScale: 1.0, volumetric: false, passthrough: 0.1, jitter: 0.0, bgR: 0.06, bgG: 0.06, bgB: 0.10, albedoR: 0.8, albedoG: 0.85, albedoB: 1.0, subgraph: { nodes: [], inputPorts: [], outputPorts: [] } },
      },
      { id: 'tone_5', type: 'toneMap', position: { x: 1080, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'mlg_4', outputKey: 'color' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } }, params: { mode: 'aces' } },
      { id: 'out_6', type: 'output', position: { x: 1280, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'tone_5', outputKey: 'color' } } },
        outputs: {}, params: {} },
    ],
  },

  dofForwardDepth: {
    label: 'DoF: Forward Depth',
    counter: 15,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 60,  y: 180 }, inputs: {}, outputs: { uv:   { type: 'vec2',  label: 'UV'   } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 60,  y: 340 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'cam_2', type: 'forwardCamera', position: { x: 280, y: 260 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { ro: { type: 'vec3', label: 'Ray Origin' }, rd: { type: 'vec3', label: 'Ray Dir' } },
        params: { camDist: 4.5, fov: 1.0, aperture: 0.12, focalDist: 4.0 },
      },
      {
        id: 'scene_3', type: 'sceneGroup', position: { x: 560, y: 420 },
        inputs: {}, outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: 'Depth Row',
          subgraph: {
            nodes: [
              { id: 'sp', type: 'scenePos', position: { x: 60, y: 200 }, inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              // Near sphere (closest to camera, most blur) at (0, 0, 2)
              { id: 'ofs_n', type: 'makeVec3', position: { x: 60, y: 80 }, inputs: {}, outputs: { rgb: { type: 'vec3', label: 'RGB' } }, params: { r: 0.0, g: 0.0, b: -2.0 } },
              { id: 'pn', type: 'addVec3', position: { x: 260, y: 80 },
                inputs: { a: { type: 'vec3', label: 'A', connection: { nodeId: 'sp', outputKey: 'pos' } }, b: { type: 'vec3', label: 'B', connection: { nodeId: 'ofs_n', outputKey: 'rgb' } } },
                outputs: { result: { type: 'vec3', label: 'Result' } }, params: {} },
              { id: 'sn', type: 'sphereSDF3D', position: { x: 440, y: 80 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'pn', outputKey: 'result' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { radius: 0.4 } },
              // Mid sphere (in focus) at (0, 0, 0)
              { id: 'sm', type: 'sphereSDF3D', position: { x: 260, y: 220 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { radius: 0.45 } },
              // Far sphere at (0, 0, -2.5)
              { id: 'ofs_f', type: 'makeVec3', position: { x: 60, y: 360 }, inputs: {}, outputs: { rgb: { type: 'vec3', label: 'RGB' } }, params: { r: 0.0, g: 0.0, b: 2.5 } },
              { id: 'pf', type: 'addVec3', position: { x: 260, y: 360 },
                inputs: { a: { type: 'vec3', label: 'A', connection: { nodeId: 'sp', outputKey: 'pos' } }, b: { type: 'vec3', label: 'B', connection: { nodeId: 'ofs_f', outputKey: 'rgb' } } },
                outputs: { result: { type: 'vec3', label: 'Result' } }, params: {} },
              { id: 'sf', type: 'sphereSDF3D', position: { x: 440, y: 360 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'pf', outputKey: 'result' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { radius: 0.4 } },
              { id: 'mn1', type: 'minMath', position: { x: 620, y: 140 },
                inputs: { a: { type: 'float', label: 'A', connection: { nodeId: 'sn', outputKey: 'dist' } }, b: { type: 'float', label: 'B', connection: { nodeId: 'sm', outputKey: 'dist' } } },
                outputs: { result: { type: 'float', label: 'Result' } }, params: {} },
              { id: 'mn2', type: 'minMath', position: { x: 620, y: 300 },
                inputs: { a: { type: 'float', label: 'A', connection: { nodeId: 'mn1', outputKey: 'result' } }, b: { type: 'float', label: 'B', connection: { nodeId: 'sf', outputKey: 'dist' } } },
                outputs: { result: { type: 'float', label: 'Result' } }, params: {} },
            ],
            outputNodeId: 'mn2', outputKey: 'result', inputPorts: [], outputPorts: [],
          },
        },
      },
      {
        id: 'mlg_4', type: 'marchLoopGroup', position: { x: 840, y: 200 },
        inputs: {
          ro:    { type: 'vec3',    label: 'Ray Origin', connection: { nodeId: 'cam_2',   outputKey: 'ro'    } },
          rd:    { type: 'vec3',    label: 'Ray Dir',    connection: { nodeId: 'cam_2',   outputKey: 'rd'    } },
          scene: { type: 'scene3d', label: 'Scene',      connection: { nodeId: 'scene_3', outputKey: 'scene' } },
          uv:    { type: 'vec2',  label: 'UV' },
          time:  { type: 'float', label: 'Time' },
        },
        outputs: { color: { type: 'vec3', label: 'Color' }, dist: { type: 'float', label: 'Distance' }, depth: { type: 'float', label: 'Depth' }, normal: { type: 'vec3', label: 'Normal' }, iter: { type: 'float', label: 'Iter' }, iterCount: { type: 'float', label: 'Iter Count' }, hit: { type: 'float', label: 'Hit' }, pos: { type: 'vec3', label: 'Hit Pos' } },
        params: { maxSteps: 80, maxDist: 12.0, stepScale: 1.0, volumetric: false, passthrough: 0.1, jitter: 0.0, bgR: 0.04, bgG: 0.04, bgB: 0.08, albedoR: 0.9, albedoG: 0.85, albedoB: 0.7, subgraph: { nodes: [], inputPorts: [], outputPorts: [] } },
      },
      { id: 'tone_5', type: 'toneMap', position: { x: 1080, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'mlg_4', outputKey: 'color' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } }, params: { mode: 'aces' } },
      { id: 'out_6', type: 'output', position: { x: 1280, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'tone_5', outputKey: 'color' } } },
        outputs: {}, params: {} },
    ],
  },

  // ─── Jitter examples ─────────────────────────────────────────────────────────

  jitterFogSphere: {
    label: 'Jitter: Smooth Volumetric Fog',
    counter: 15,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 60,  y: 180 }, inputs: {}, outputs: { uv:   { type: 'vec2',  label: 'UV'   } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 60,  y: 340 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'cam_2', type: 'marchCamera', position: { x: 280, y: 260 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { ro: { type: 'vec3', label: 'Ray Origin' }, rd: { type: 'vec3', label: 'Ray Dir' } },
        params: { camDist: 3.0, camAngle: 0.5, rotSpeed: 0.1, fov: 1.4, aperture: 0.0, focalDist: 3.0 },
      },
      {
        id: 'scene_3', type: 'sceneGroup', position: { x: 560, y: 400 },
        inputs: {}, outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: 'Sphere',
          subgraph: {
            nodes: [
              { id: 'sp', type: 'scenePos', position: { x: 80, y: 150 }, inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'sdf', type: 'sphereSDF3D', position: { x: 280, y: 150 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { radius: 0.6 } },
            ],
            outputNodeId: 'sdf', outputKey: 'dist', inputPorts: [], outputPorts: [],
          },
        },
      },
      {
        id: 'mlg_4', type: 'marchLoopGroup', position: { x: 820, y: 220 },
        inputs: {
          ro:    { type: 'vec3',    label: 'Ray Origin', connection: { nodeId: 'cam_2',   outputKey: 'ro'    } },
          rd:    { type: 'vec3',    label: 'Ray Dir',    connection: { nodeId: 'cam_2',   outputKey: 'rd'    } },
          scene: { type: 'scene3d', label: 'Scene',      connection: { nodeId: 'scene_3', outputKey: 'scene' } },
          uv:    { type: 'vec2',  label: 'UV' },
          time:  { type: 'float', label: 'Time' },
        },
        outputs: { color: { type: 'vec3', label: 'Color' }, dist: { type: 'float', label: 'Distance' }, depth: { type: 'float', label: 'Depth' }, normal: { type: 'vec3', label: 'Normal' }, iter: { type: 'float', label: 'Iter' }, iterCount: { type: 'float', label: 'Iter Count' }, hit: { type: 'float', label: 'Hit' }, pos: { type: 'vec3', label: 'Hit Pos' }, acc0: { type: 'float', label: 'Glow' } },
        params: {
          maxSteps: 80, maxDist: 8.0, stepScale: 1.0, volumetric: true, passthrough: 0.1, jitter: 1.0,
          bgR: 0.02, bgG: 0.02, bgB: 0.06,
          albedoR: 0.3, albedoG: 0.7, albedoB: 1.0,
          subgraph: {
            nodes: [
              { id: 'mp', type: 'marchPos', position: { x: 80, y: 160 }, inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'msd', type: 'marchSceneDist', position: { x: 300, y: 160 },
                inputs:  { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'mp', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: {} },
              { id: 'div', type: 'divide', position: { x: 500, y: 160 },
                inputs: { a: { type: 'float', label: 'A', defaultValue: 1 }, b: { type: 'float', label: 'B', connection: { nodeId: 'msd', outputKey: 'dist' } } },
                outputs: { result: { type: 'float', label: 'Result' } }, params: {}, assignOp: '+=' as const },
            ],
            inputPorts: [], outputPorts: [],
          },
        },
      },
      { id: 'scl_5', type: 'multiply', position: { x: 1080, y: 300 },
        inputs: { a: { type: 'float', label: 'A', connection: { nodeId: 'mlg_4', outputKey: 'acc0' } } },
        outputs: { result: { type: 'float', label: 'Result' } }, params: { b: 0.015 } },
      { id: 'tanh_6', type: 'tanh', position: { x: 1080, y: 420 },
        inputs: { input: { type: 'float', label: 'Input', connection: { nodeId: 'scl_5', outputKey: 'result' } } },
        outputs: { output: { type: 'float', label: 'Output' } }, params: {} },
      { id: 'clr_7', type: 'makeVec3', position: { x: 1260, y: 360 }, inputs: {}, outputs: { rgb: { type: 'vec3', label: 'RGB' } }, params: { r: 0.3, g: 0.75, b: 1.0 } },
      { id: 'mul_8', type: 'multiplyVec3', position: { x: 1440, y: 320 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'clr_7', outputKey: 'rgb' } }, scale: { type: 'float', label: 'Scale', connection: { nodeId: 'tanh_6', outputKey: 'output' } } },
        outputs: { result: { type: 'vec3', label: 'Result' } }, params: { scale: 1.0 } },
      { id: 'tone_9', type: 'toneMap', position: { x: 1620, y: 320 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'mul_8', outputKey: 'result' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } }, params: { mode: 'aces' } },
      { id: 'out_10', type: 'output', position: { x: 1820, y: 320 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'tone_9', outputKey: 'color' } } },
        outputs: {}, params: {} },
    ],
  },

  jitterTorusCloud: {
    label: 'Jitter: Torus Cloud',
    counter: 15,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 60,  y: 180 }, inputs: {}, outputs: { uv:   { type: 'vec2',  label: 'UV'   } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 60,  y: 340 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'cam_2', type: 'marchCamera', position: { x: 280, y: 260 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { ro: { type: 'vec3', label: 'Ray Origin' }, rd: { type: 'vec3', label: 'Ray Dir' } },
        params: { camDist: 3.5, camAngle: 0.4, camElevation: 0.3, rotSpeed: 0.08, fov: 1.4, aperture: 0.0, focalDist: 3.5 },
      },
      {
        id: 'scene_3', type: 'sceneGroup', position: { x: 560, y: 400 },
        inputs: {}, outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: 'Torus',
          subgraph: {
            nodes: [
              { id: 'sp', type: 'scenePos', position: { x: 80, y: 150 }, inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'sdf', type: 'torusSDF3D', position: { x: 280, y: 150 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { R: 0.6, r: 0.25 } },
            ],
            outputNodeId: 'sdf', outputKey: 'dist', inputPorts: [], outputPorts: [],
          },
        },
      },
      {
        id: 'mlg_4', type: 'marchLoopGroup', position: { x: 820, y: 220 },
        inputs: {
          ro:    { type: 'vec3',    label: 'Ray Origin', connection: { nodeId: 'cam_2',   outputKey: 'ro'    } },
          rd:    { type: 'vec3',    label: 'Ray Dir',    connection: { nodeId: 'cam_2',   outputKey: 'rd'    } },
          scene: { type: 'scene3d', label: 'Scene',      connection: { nodeId: 'scene_3', outputKey: 'scene' } },
          uv:    { type: 'vec2',  label: 'UV' },
          time:  { type: 'float', label: 'Time' },
        },
        outputs: { color: { type: 'vec3', label: 'Color' }, dist: { type: 'float', label: 'Distance' }, depth: { type: 'float', label: 'Depth' }, normal: { type: 'vec3', label: 'Normal' }, iter: { type: 'float', label: 'Iter' }, iterCount: { type: 'float', label: 'Iter Count' }, hit: { type: 'float', label: 'Hit' }, pos: { type: 'vec3', label: 'Hit Pos' }, acc0: { type: 'float', label: 'Glow' } },
        params: {
          maxSteps: 96, maxDist: 10.0, stepScale: 1.0, volumetric: true, passthrough: 0.08, jitter: 1.0,
          bgR: 0.03, bgG: 0.01, bgB: 0.05,
          albedoR: 1.0, albedoG: 0.5, albedoB: 0.1,
          subgraph: {
            nodes: [
              { id: 'mp', type: 'marchPos', position: { x: 80, y: 160 }, inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'msd', type: 'marchSceneDist', position: { x: 300, y: 160 },
                inputs:  { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'mp', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: {} },
              { id: 'div', type: 'divide', position: { x: 500, y: 160 },
                inputs: { a: { type: 'float', label: 'A', defaultValue: 1 }, b: { type: 'float', label: 'B', connection: { nodeId: 'msd', outputKey: 'dist' } } },
                outputs: { result: { type: 'float', label: 'Result' } }, params: {}, assignOp: '+=' as const },
            ],
            inputPorts: [], outputPorts: [],
          },
        },
      },
      { id: 'scl_5', type: 'multiply', position: { x: 1080, y: 300 },
        inputs: { a: { type: 'float', label: 'A', connection: { nodeId: 'mlg_4', outputKey: 'acc0' } } },
        outputs: { result: { type: 'float', label: 'Result' } }, params: { b: 0.01 } },
      { id: 'tanh_6', type: 'tanh', position: { x: 1080, y: 420 },
        inputs: { input: { type: 'float', label: 'Input', connection: { nodeId: 'scl_5', outputKey: 'result' } } },
        outputs: { output: { type: 'float', label: 'Output' } }, params: {} },
      { id: 'clr_7', type: 'makeVec3', position: { x: 1260, y: 360 }, inputs: {}, outputs: { rgb: { type: 'vec3', label: 'RGB' } }, params: { r: 1.0, g: 0.45, b: 0.15 } },
      { id: 'mul_8', type: 'multiplyVec3', position: { x: 1440, y: 320 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'clr_7', outputKey: 'rgb' } }, scale: { type: 'float', label: 'Scale', connection: { nodeId: 'tanh_6', outputKey: 'output' } } },
        outputs: { result: { type: 'vec3', label: 'Result' } }, params: { scale: 1.0 } },
      { id: 'tone_9', type: 'toneMap', position: { x: 1620, y: 320 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'mul_8', outputKey: 'result' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } }, params: { mode: 'aces' } },
      { id: 'out_10', type: 'output', position: { x: 1820, y: 320 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'tone_9', outputKey: 'color' } } },
        outputs: {}, params: {} },
    ],
  },

  // ─── Phase HG examples ───────────────────────────────────────────────────────

  phaseHGForwardCloud: {
    label: 'Phase HG: Forward Scatter Cloud',
    counter: 20,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 60,  y: 180 }, inputs: {}, outputs: { uv:   { type: 'vec2',  label: 'UV'   } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 60,  y: 340 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'cam_2', type: 'marchCamera', position: { x: 280, y: 260 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { ro: { type: 'vec3', label: 'Ray Origin' }, rd: { type: 'vec3', label: 'Ray Dir' } },
        params: { camDist: 3.5, camAngle: 0.6, camElevation: 0.15, rotSpeed: 0.12, fov: 1.4, aperture: 0.0, focalDist: 3.5 },
      },
      {
        id: 'scene_3', type: 'sceneGroup', position: { x: 560, y: 400 },
        inputs: {}, outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: 'Cloud Sphere',
          subgraph: {
            nodes: [
              { id: 'sp', type: 'scenePos', position: { x: 80, y: 150 }, inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'sdf', type: 'sphereSDF3D', position: { x: 280, y: 150 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { radius: 0.65 } },
            ],
            outputNodeId: 'sdf', outputKey: 'dist', inputPorts: [], outputPorts: [],
          },
        },
      },
      {
        id: 'mlg_4', type: 'marchLoopGroup', position: { x: 820, y: 220 },
        inputs: {
          ro:    { type: 'vec3',    label: 'Ray Origin', connection: { nodeId: 'cam_2',   outputKey: 'ro'    } },
          rd:    { type: 'vec3',    label: 'Ray Dir',    connection: { nodeId: 'cam_2',   outputKey: 'rd'    } },
          scene: { type: 'scene3d', label: 'Scene',      connection: { nodeId: 'scene_3', outputKey: 'scene' } },
          uv:    { type: 'vec2',  label: 'UV' },
          time:  { type: 'float', label: 'Time' },
        },
        outputs: { color: { type: 'vec3', label: 'Color' }, dist: { type: 'float', label: 'Distance' }, depth: { type: 'float', label: 'Depth' }, normal: { type: 'vec3', label: 'Normal' }, iter: { type: 'float', label: 'Iter' }, iterCount: { type: 'float', label: 'Iter Count' }, hit: { type: 'float', label: 'Hit' }, pos: { type: 'vec3', label: 'Hit Pos' }, acc0: { type: 'float', label: 'Glow' } },
        params: {
          maxSteps: 96, maxDist: 8.0, stepScale: 1.0, volumetric: true, passthrough: 0.08, jitter: 1.0,
          bgR: 0.02, bgG: 0.03, bgB: 0.08,
          albedoR: 0.9, albedoG: 0.95, albedoB: 1.0,
          subgraph: {
            nodes: [
              // Group inputs → rd and marchPos
              { id: 'mli', type: 'marchLoopInputs', position: { x: 60, y: 200 },
                inputs: {}, outputs: { ro: { type: 'vec3', label: 'Ray Origin' }, rd: { type: 'vec3', label: 'Ray Dir' }, marchPos: { type: 'vec3', label: 'March Pos' }, marchDist: { type: 'float', label: 'March Dist' } }, params: {} },
              // Sample scene distance for density
              { id: 'msd', type: 'marchSceneDist', position: { x: 280, y: 200 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'mli', outputKey: 'marchPos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: {} },
              // Light direction (normalized ~(0.5, 0.8, 0.3))
              { id: 'ldir', type: 'makeVec3', position: { x: 60, y: 80 }, inputs: {}, outputs: { rgb: { type: 'vec3', label: 'RGB' } }, params: { r: 0.51, g: 0.81, b: 0.29 } },
              // Negate rd (vec3) to get -rd = view direction
              { id: 'neg_rd', type: 'multiplyVec3', position: { x: 280, y: 80 },
                inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'mli', outputKey: 'rd' } }, scale: { type: 'float', label: 'Scale' } },
                outputs: { result: { type: 'vec3', label: 'Result' } }, params: { scale: -1.0 } },
              // cos(theta) = dot(-rd, lightDir)
              { id: 'cosT', type: 'dot', position: { x: 460, y: 80 },
                inputs: { a: { type: 'vec3', label: 'A', connection: { nodeId: 'neg_rd', outputKey: 'result' } }, b: { type: 'vec3', label: 'B', connection: { nodeId: 'ldir', outputKey: 'rgb' } } },
                outputs: { result: { type: 'float', label: 'Result' } }, params: {} },
              // Phase HG — forward scattering g=0.85 (bright toward light source)
              { id: 'phg', type: 'phaseHG', position: { x: 640, y: 80 },
                inputs: { cosTheta: { type: 'float', label: 'cos(θ)', connection: { nodeId: 'cosT', outputKey: 'result' } } },
                outputs: { phase: { type: 'float', label: 'Phase' } }, params: { g: 0.85 } },
              // Density = 1/vol
              { id: 'inv', type: 'divide', position: { x: 460, y: 240 },
                inputs: { a: { type: 'float', label: 'A', defaultValue: 1 }, b: { type: 'float', label: 'B', connection: { nodeId: 'msd', outputKey: 'dist' } } },
                outputs: { result: { type: 'float', label: 'Result' } }, params: {} },
              // Weighted contribution = phase × density → accumulate
              { id: 'wt', type: 'multiply', position: { x: 820, y: 160 },
                inputs: { a: { type: 'float', label: 'A', connection: { nodeId: 'phg', outputKey: 'phase' } }, b: { type: 'float', label: 'B', connection: { nodeId: 'inv', outputKey: 'result' } } },
                outputs: { result: { type: 'float', label: 'Result' } }, params: { b: 1.0 }, assignOp: '+=' as const },
            ],
            inputPorts: [], outputPorts: [],
          },
        },
      },
      // Scale + tanh compress
      { id: 'scl_5', type: 'multiply', position: { x: 1100, y: 300 },
        inputs: { a: { type: 'float', label: 'A', connection: { nodeId: 'mlg_4', outputKey: 'acc0' } } },
        outputs: { result: { type: 'float', label: 'Result' } }, params: { b: 0.04 } },
      { id: 'tanh_6', type: 'tanh', position: { x: 1100, y: 420 },
        inputs: { input: { type: 'float', label: 'Input', connection: { nodeId: 'scl_5', outputKey: 'result' } } },
        outputs: { output: { type: 'float', label: 'Output' } }, params: {} },
      // Soft white-blue cloud color
      { id: 'clr_7', type: 'makeVec3', position: { x: 1280, y: 360 }, inputs: {}, outputs: { rgb: { type: 'vec3', label: 'RGB' } }, params: { r: 0.9, g: 0.95, b: 1.0 } },
      { id: 'mul_8', type: 'multiplyVec3', position: { x: 1460, y: 320 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'clr_7', outputKey: 'rgb' } }, scale: { type: 'float', label: 'Scale', connection: { nodeId: 'tanh_6', outputKey: 'output' } } },
        outputs: { result: { type: 'vec3', label: 'Result' } }, params: { scale: 1.0 } },
      { id: 'tone_9', type: 'toneMap', position: { x: 1640, y: 320 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'mul_8', outputKey: 'result' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } }, params: { mode: 'aces' } },
      { id: 'out_10', type: 'output', position: { x: 1840, y: 320 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'tone_9', outputKey: 'color' } } },
        outputs: {}, params: {} },
    ],
  },

  phaseHGBacklit: {
    label: 'Phase HG: Backlit Haze',
    counter: 20,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 60,  y: 180 }, inputs: {}, outputs: { uv:   { type: 'vec2',  label: 'UV'   } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 60,  y: 340 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'cam_2', type: 'marchCamera', position: { x: 280, y: 260 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { ro: { type: 'vec3', label: 'Ray Origin' }, rd: { type: 'vec3', label: 'Ray Dir' } },
        params: { camDist: 4.0, camAngle: 0.3, camElevation: 0.1, rotSpeed: 0.1, fov: 1.3, aperture: 0.0, focalDist: 4.0 },
      },
      {
        id: 'scene_3', type: 'sceneGroup', position: { x: 560, y: 400 },
        inputs: {}, outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: 'Haze Volume',
          subgraph: {
            nodes: [
              { id: 'sp', type: 'scenePos', position: { x: 80, y: 150 }, inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'sdf', type: 'torusSDF3D', position: { x: 280, y: 150 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { R: 0.7, r: 0.3 } },
            ],
            outputNodeId: 'sdf', outputKey: 'dist', inputPorts: [], outputPorts: [],
          },
        },
      },
      {
        id: 'mlg_4', type: 'marchLoopGroup', position: { x: 820, y: 220 },
        inputs: {
          ro:    { type: 'vec3',    label: 'Ray Origin', connection: { nodeId: 'cam_2',   outputKey: 'ro'    } },
          rd:    { type: 'vec3',    label: 'Ray Dir',    connection: { nodeId: 'cam_2',   outputKey: 'rd'    } },
          scene: { type: 'scene3d', label: 'Scene',      connection: { nodeId: 'scene_3', outputKey: 'scene' } },
          uv:    { type: 'vec2',  label: 'UV' },
          time:  { type: 'float', label: 'Time' },
        },
        outputs: { color: { type: 'vec3', label: 'Color' }, dist: { type: 'float', label: 'Distance' }, depth: { type: 'float', label: 'Depth' }, normal: { type: 'vec3', label: 'Normal' }, iter: { type: 'float', label: 'Iter' }, iterCount: { type: 'float', label: 'Iter Count' }, hit: { type: 'float', label: 'Hit' }, pos: { type: 'vec3', label: 'Hit Pos' }, acc0: { type: 'float', label: 'Glow' } },
        params: {
          maxSteps: 96, maxDist: 10.0, stepScale: 1.0, volumetric: true, passthrough: 0.1, jitter: 1.0,
          bgR: 0.05, bgG: 0.02, bgB: 0.08,
          albedoR: 0.8, albedoG: 0.4, albedoB: 1.0,
          subgraph: {
            nodes: [
              { id: 'mli', type: 'marchLoopInputs', position: { x: 60, y: 200 },
                inputs: {}, outputs: { ro: { type: 'vec3', label: 'Ray Origin' }, rd: { type: 'vec3', label: 'Ray Dir' }, marchPos: { type: 'vec3', label: 'March Pos' }, marchDist: { type: 'float', label: 'March Dist' } }, params: {} },
              { id: 'msd', type: 'marchSceneDist', position: { x: 280, y: 200 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'mli', outputKey: 'marchPos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: {} },
              // Light comes from behind-below — g=-0.4 means back-scattering glows when lit from front
              { id: 'ldir', type: 'makeVec3', position: { x: 60, y: 80 }, inputs: {}, outputs: { rgb: { type: 'vec3', label: 'RGB' } }, params: { r: 0.0, g: 0.6, b: 0.8 } },
              { id: 'neg_rd', type: 'multiplyVec3', position: { x: 280, y: 80 },
                inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'mli', outputKey: 'rd' } }, scale: { type: 'float', label: 'Scale' } },
                outputs: { result: { type: 'vec3', label: 'Result' } }, params: { scale: -1.0 } },
              { id: 'cosT', type: 'dot', position: { x: 460, y: 80 },
                inputs: { a: { type: 'vec3', label: 'A', connection: { nodeId: 'neg_rd', outputKey: 'result' } }, b: { type: 'vec3', label: 'B', connection: { nodeId: 'ldir', outputKey: 'rgb' } } },
                outputs: { result: { type: 'float', label: 'Result' } }, params: {} },
              // g=-0.5: back-scattering — bright when light is between volume and eye
              { id: 'phg', type: 'phaseHG', position: { x: 640, y: 80 },
                inputs: { cosTheta: { type: 'float', label: 'cos(θ)', connection: { nodeId: 'cosT', outputKey: 'result' } } },
                outputs: { phase: { type: 'float', label: 'Phase' } }, params: { g: -0.5 } },
              { id: 'inv', type: 'divide', position: { x: 460, y: 240 },
                inputs: { a: { type: 'float', label: 'A', defaultValue: 1 }, b: { type: 'float', label: 'B', connection: { nodeId: 'msd', outputKey: 'dist' } } },
                outputs: { result: { type: 'float', label: 'Result' } }, params: {} },
              { id: 'wt', type: 'multiply', position: { x: 820, y: 160 },
                inputs: { a: { type: 'float', label: 'A', connection: { nodeId: 'phg', outputKey: 'phase' } }, b: { type: 'float', label: 'B', connection: { nodeId: 'inv', outputKey: 'result' } } },
                outputs: { result: { type: 'float', label: 'Result' } }, params: { b: 1.0 }, assignOp: '+=' as const },
            ],
            inputPorts: [], outputPorts: [],
          },
        },
      },
      { id: 'scl_5', type: 'multiply', position: { x: 1100, y: 300 },
        inputs: { a: { type: 'float', label: 'A', connection: { nodeId: 'mlg_4', outputKey: 'acc0' } } },
        outputs: { result: { type: 'float', label: 'Result' } }, params: { b: 0.05 } },
      { id: 'tanh_6', type: 'tanh', position: { x: 1100, y: 420 },
        inputs: { input: { type: 'float', label: 'Input', connection: { nodeId: 'scl_5', outputKey: 'result' } } },
        outputs: { output: { type: 'float', label: 'Output' } }, params: {} },
      { id: 'clr_7', type: 'makeVec3', position: { x: 1280, y: 360 }, inputs: {}, outputs: { rgb: { type: 'vec3', label: 'RGB' } }, params: { r: 0.7, g: 0.4, b: 1.0 } },
      { id: 'mul_8', type: 'multiplyVec3', position: { x: 1460, y: 320 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'clr_7', outputKey: 'rgb' } }, scale: { type: 'float', label: 'Scale', connection: { nodeId: 'tanh_6', outputKey: 'output' } } },
        outputs: { result: { type: 'vec3', label: 'Result' } }, params: { scale: 1.0 } },
      { id: 'tone_9', type: 'toneMap', position: { x: 1640, y: 320 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'mul_8', outputKey: 'result' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } }, params: { mode: 'aces' } },
      { id: 'out_10', type: 'output', position: { x: 1840, y: 320 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'tone_9', outputKey: 'color' } } },
        outputs: {}, params: {} },
    ],
  },

  // ─── Fresnel Schlick examples ────────────────────────────────────────────────

  fresnelSchlickRim: {
    label: 'Fresnel Schlick: Rim Glow',
    counter: 15,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 60,  y: 180 }, inputs: {}, outputs: { uv:   { type: 'vec2',  label: 'UV'   } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 60,  y: 340 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'cam_2', type: 'marchCamera', position: { x: 280, y: 260 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { ro: { type: 'vec3', label: 'Ray Origin' }, rd: { type: 'vec3', label: 'Ray Dir' } },
        params: { camDist: 3.5, camAngle: 0.5, camElevation: 0.2, rotSpeed: 0.1, fov: 1.4, aperture: 0.0, focalDist: 3.5 },
      },
      {
        id: 'scene_3', type: 'sceneGroup', position: { x: 560, y: 400 },
        inputs: {}, outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: 'Sphere',
          subgraph: {
            nodes: [
              { id: 'sp', type: 'scenePos', position: { x: 80, y: 150 }, inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'sdf', type: 'sphereSDF3D', position: { x: 280, y: 150 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { radius: 0.7 } },
            ],
            outputNodeId: 'sdf', outputKey: 'dist', inputPorts: [], outputPorts: [],
          },
        },
      },
      {
        id: 'mlg_4', type: 'marchLoopGroup', position: { x: 820, y: 200 },
        inputs: {
          ro:    { type: 'vec3',    label: 'Ray Origin', connection: { nodeId: 'cam_2',   outputKey: 'ro'    } },
          rd:    { type: 'vec3',    label: 'Ray Dir',    connection: { nodeId: 'cam_2',   outputKey: 'rd'    } },
          scene: { type: 'scene3d', label: 'Scene',      connection: { nodeId: 'scene_3', outputKey: 'scene' } },
          uv:    { type: 'vec2',  label: 'UV' },
          time:  { type: 'float', label: 'Time' },
        },
        outputs: { color: { type: 'vec3', label: 'Color' }, dist: { type: 'float', label: 'Distance' }, depth: { type: 'float', label: 'Depth' }, normal: { type: 'vec3', label: 'Normal' }, iter: { type: 'float', label: 'Iter' }, iterCount: { type: 'float', label: 'Iter Count' }, hit: { type: 'float', label: 'Hit' }, pos: { type: 'vec3', label: 'Hit Pos' } },
        params: { maxSteps: 80, maxDist: 12.0, stepScale: 1.0, volumetric: false, passthrough: 0.1, jitter: 0.0, bgR: 0.02, bgG: 0.02, bgB: 0.05, albedoR: 0.1, albedoG: 0.12, albedoB: 0.2, subgraph: { nodes: [], inputPorts: [], outputPorts: [] } },
      },
      // Negate rd to get view direction
      { id: 'neg_5', type: 'multiplyVec3', position: { x: 1080, y: 140 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'cam_2', outputKey: 'rd' } }, scale: { type: 'float', label: 'Scale' } },
        outputs: { result: { type: 'vec3', label: 'Result' } }, params: { scale: -1.0 } },
      // cosTheta = dot(-rd, normal)
      { id: 'dot_6', type: 'dot', position: { x: 1260, y: 140 },
        inputs: { a: { type: 'vec3', label: 'A', connection: { nodeId: 'neg_5', outputKey: 'result' } }, b: { type: 'vec3', label: 'B', connection: { nodeId: 'mlg_4', outputKey: 'normal' } } },
        outputs: { result: { type: 'float', label: 'Result' } }, params: {} },
      // Fresnel Schlick — IOR 1.8 for strong rim
      { id: 'frs_7', type: 'fresnelSchlick', position: { x: 1440, y: 140 },
        inputs: { cosTheta: { type: 'float', label: 'cos(θ)', connection: { nodeId: 'dot_6', outputKey: 'result' } } },
        outputs: { reflectW: { type: 'float', label: 'Reflect Weight' }, refractW: { type: 'float', label: 'Refract Weight' } }, params: { ior: 1.8 } },
      // Rim color (electric cyan)
      { id: 'rim_8', type: 'makeVec3', position: { x: 1440, y: 300 }, inputs: {}, outputs: { rgb: { type: 'vec3', label: 'RGB' } }, params: { r: 0.2, g: 0.8, b: 1.0 } },
      // Scale rim by Fresnel reflectW
      { id: 'scl_9', type: 'multiplyVec3', position: { x: 1620, y: 240 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'rim_8', outputKey: 'rgb' } }, scale: { type: 'float', label: 'Scale', connection: { nodeId: 'frs_7', outputKey: 'reflectW' } } },
        outputs: { result: { type: 'vec3', label: 'Result' } }, params: { scale: 1.0 } },
      // Add rim on top of base dark surface color
      { id: 'add_10', type: 'addVec3', position: { x: 1800, y: 220 },
        inputs: { a: { type: 'vec3', label: 'A', connection: { nodeId: 'mlg_4', outputKey: 'color' } }, b: { type: 'vec3', label: 'B', connection: { nodeId: 'scl_9', outputKey: 'result' } } },
        outputs: { result: { type: 'vec3', label: 'Result' } }, params: {} },
      { id: 'tone_11', type: 'toneMap', position: { x: 1980, y: 220 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'add_10', outputKey: 'result' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } }, params: { mode: 'aces' } },
      { id: 'out_12', type: 'output', position: { x: 2160, y: 220 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'tone_11', outputKey: 'color' } } },
        outputs: {}, params: {} },
    ],
  },

  fresnelSchlickTwoTone: {
    label: 'Fresnel Schlick: Two-Tone Surface',
    counter: 15,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 60,  y: 180 }, inputs: {}, outputs: { uv:   { type: 'vec2',  label: 'UV'   } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 60,  y: 340 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'cam_2', type: 'marchCamera', position: { x: 280, y: 260 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { ro: { type: 'vec3', label: 'Ray Origin' }, rd: { type: 'vec3', label: 'Ray Dir' } },
        params: { camDist: 3.5, camAngle: 0.5, camElevation: 0.2, rotSpeed: 0.09, fov: 1.4, aperture: 0.0, focalDist: 3.5 },
      },
      {
        id: 'scene_3', type: 'sceneGroup', position: { x: 560, y: 400 },
        inputs: {}, outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: 'Torus',
          subgraph: {
            nodes: [
              { id: 'sp', type: 'scenePos', position: { x: 80, y: 150 }, inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'sdf', type: 'torusSDF3D', position: { x: 280, y: 150 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { R: 0.65, r: 0.25 } },
            ],
            outputNodeId: 'sdf', outputKey: 'dist', inputPorts: [], outputPorts: [],
          },
        },
      },
      {
        id: 'mlg_4', type: 'marchLoopGroup', position: { x: 820, y: 200 },
        inputs: {
          ro:    { type: 'vec3',    label: 'Ray Origin', connection: { nodeId: 'cam_2',   outputKey: 'ro'    } },
          rd:    { type: 'vec3',    label: 'Ray Dir',    connection: { nodeId: 'cam_2',   outputKey: 'rd'    } },
          scene: { type: 'scene3d', label: 'Scene',      connection: { nodeId: 'scene_3', outputKey: 'scene' } },
          uv:    { type: 'vec2',  label: 'UV' },
          time:  { type: 'float', label: 'Time' },
        },
        outputs: { color: { type: 'vec3', label: 'Color' }, dist: { type: 'float', label: 'Distance' }, depth: { type: 'float', label: 'Depth' }, normal: { type: 'vec3', label: 'Normal' }, iter: { type: 'float', label: 'Iter' }, iterCount: { type: 'float', label: 'Iter Count' }, hit: { type: 'float', label: 'Hit' }, pos: { type: 'vec3', label: 'Hit Pos' } },
        params: { maxSteps: 80, maxDist: 12.0, stepScale: 1.0, volumetric: false, passthrough: 0.1, jitter: 0.0, bgR: 0.03, bgG: 0.02, bgB: 0.06, albedoR: 0.3, albedoG: 0.1, albedoB: 0.6, subgraph: { nodes: [], inputPorts: [], outputPorts: [] } },
      },
      { id: 'neg_5', type: 'multiplyVec3', position: { x: 1080, y: 120 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'cam_2', outputKey: 'rd' } }, scale: { type: 'float', label: 'Scale' } },
        outputs: { result: { type: 'vec3', label: 'Result' } }, params: { scale: -1.0 } },
      { id: 'dot_6', type: 'dot', position: { x: 1260, y: 120 },
        inputs: { a: { type: 'vec3', label: 'A', connection: { nodeId: 'neg_5', outputKey: 'result' } }, b: { type: 'vec3', label: 'B', connection: { nodeId: 'mlg_4', outputKey: 'normal' } } },
        outputs: { result: { type: 'float', label: 'Result' } }, params: {} },
      { id: 'frs_7', type: 'fresnelSchlick', position: { x: 1440, y: 120 },
        inputs: { cosTheta: { type: 'float', label: 'cos(θ)', connection: { nodeId: 'dot_6', outputKey: 'result' } } },
        outputs: { reflectW: { type: 'float', label: 'Reflect Weight' }, refractW: { type: 'float', label: 'Refract Weight' } }, params: { ior: 2.0 } },
      // Core color (warm amber — seen face-on)
      { id: 'core_8', type: 'makeVec3', position: { x: 1440, y: 300 }, inputs: {}, outputs: { rgb: { type: 'vec3', label: 'RGB' } }, params: { r: 1.0, g: 0.6, b: 0.1 } },
      // Edge color (cool indigo — seen at grazing angle)
      { id: 'edge_9', type: 'makeVec3', position: { x: 1440, y: 420 }, inputs: {}, outputs: { rgb: { type: 'vec3', label: 'RGB' } }, params: { r: 0.1, g: 0.3, b: 1.0 } },
      // Mix: refractW drives core, reflectW drives edge
      { id: 'mix_10', type: 'mixVec3', position: { x: 1640, y: 340 },
        inputs: { a: { type: 'vec3', label: 'A', connection: { nodeId: 'core_8', outputKey: 'rgb' } }, b: { type: 'vec3', label: 'B', connection: { nodeId: 'edge_9', outputKey: 'rgb' } }, t: { type: 'float', label: 'T', connection: { nodeId: 'frs_7', outputKey: 'reflectW' } } },
        outputs: { result: { type: 'vec3', label: 'Result' } }, params: { t: 0.5 } },
      // Apply hit mask so background stays dark
      { id: 'hit_11', type: 'multiplyVec3', position: { x: 1820, y: 300 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'mix_10', outputKey: 'result' } }, scale: { type: 'float', label: 'Scale', connection: { nodeId: 'mlg_4', outputKey: 'hit' } } },
        outputs: { result: { type: 'vec3', label: 'Result' } }, params: { scale: 1.0 } },
      { id: 'tone_12', type: 'toneMap', position: { x: 2000, y: 300 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'hit_11', outputKey: 'result' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } }, params: { mode: 'aces' } },
      { id: 'out_13', type: 'output', position: { x: 2180, y: 300 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'tone_12', outputKey: 'color' } } },
        outputs: {}, params: {} },
    ],
  },

  // ─── Refract Dir examples ────────────────────────────────────────────────────

  refractDirFakeGlass: {
    label: 'Refract Dir: Fake Glass',
    counter: 15,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 60,  y: 180 }, inputs: {}, outputs: { uv:   { type: 'vec2',  label: 'UV'   } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 60,  y: 340 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'cam_2', type: 'marchCamera', position: { x: 280, y: 260 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { ro: { type: 'vec3', label: 'Ray Origin' }, rd: { type: 'vec3', label: 'Ray Dir' } },
        params: { camDist: 3.5, camAngle: 0.5, camElevation: 0.2, rotSpeed: 0.1, fov: 1.4, aperture: 0.0, focalDist: 3.5 },
      },
      {
        id: 'scene_3', type: 'sceneGroup', position: { x: 560, y: 400 },
        inputs: {}, outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: 'Glass Sphere',
          subgraph: {
            nodes: [
              { id: 'sp', type: 'scenePos', position: { x: 80, y: 150 }, inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'sdf', type: 'sphereSDF3D', position: { x: 280, y: 150 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { radius: 0.7 } },
            ],
            outputNodeId: 'sdf', outputKey: 'dist', inputPorts: [], outputPorts: [],
          },
        },
      },
      {
        id: 'mlg_4', type: 'marchLoopGroup', position: { x: 820, y: 200 },
        inputs: {
          ro:    { type: 'vec3',    label: 'Ray Origin', connection: { nodeId: 'cam_2',   outputKey: 'ro'    } },
          rd:    { type: 'vec3',    label: 'Ray Dir',    connection: { nodeId: 'cam_2',   outputKey: 'rd'    } },
          scene: { type: 'scene3d', label: 'Scene',      connection: { nodeId: 'scene_3', outputKey: 'scene' } },
          uv:    { type: 'vec2',  label: 'UV' },
          time:  { type: 'float', label: 'Time' },
        },
        outputs: { color: { type: 'vec3', label: 'Color' }, dist: { type: 'float', label: 'Distance' }, depth: { type: 'float', label: 'Depth' }, normal: { type: 'vec3', label: 'Normal' }, iter: { type: 'float', label: 'Iter' }, iterCount: { type: 'float', label: 'Iter Count' }, hit: { type: 'float', label: 'Hit' }, pos: { type: 'vec3', label: 'Hit Pos' } },
        params: { maxSteps: 80, maxDist: 12.0, stepScale: 1.0, volumetric: false, passthrough: 0.1, jitter: 0.0, bgR: 0.04, bgG: 0.04, bgB: 0.08, albedoR: 0.2, albedoG: 0.2, albedoB: 0.3, subgraph: { nodes: [], inputPorts: [], outputPorts: [] } },
      },
      // Refract the ray through the glass sphere
      { id: 'rfr_5', type: 'refractDir', position: { x: 1080, y: 200 },
        inputs: { incident: { type: 'vec3', label: 'Incident', connection: { nodeId: 'cam_2', outputKey: 'rd' } }, normal: { type: 'vec3', label: 'Normal', connection: { nodeId: 'mlg_4', outputKey: 'normal' } } },
        outputs: { refracted: { type: 'vec3', label: 'Refracted' }, tir: { type: 'float', label: 'TIR' } }, params: { ior1: 1.0, ior2: 1.45 } },
      // Extract y component of refracted direction → varies from -1 (down) to +1 (up) inside glass
      { id: 'spl_6', type: 'splitVec3', position: { x: 1280, y: 200 },
        inputs: { v: { type: 'vec3', label: 'V', connection: { nodeId: 'rfr_5', outputKey: 'refracted' } } },
        outputs: { x: { type: 'float', label: 'X' }, y: { type: 'float', label: 'Y' }, z: { type: 'float', label: 'Z' } }, params: {} },
      // Remap y from [-1,1] to [0,1] for palette
      { id: 'rmp_7', type: 'remap', position: { x: 1460, y: 200 },
        inputs: { value: { type: 'float', label: 'Value', connection: { nodeId: 'spl_6', outputKey: 'y' } } },
        outputs: { result: { type: 'float', label: 'Result' } }, params: { inMin: -1.0, inMax: 1.0, outMin: 0.0, outMax: 1.0 } },
      // Palette maps refracted direction angle to color
      { id: 'pal_8', type: 'palette', position: { x: 1640, y: 200 },
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'rmp_7', outputKey: 'result' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { offset_r: 0.5, offset_g: 0.5, offset_b: 0.5, amplitude_r: 0.5, amplitude_g: 0.5, amplitude_b: 0.5, freq_r: 1.0, freq_g: 0.8, freq_b: 1.2, phase_r: 0.0, phase_g: 0.2, phase_b: 0.5 } },
      // Only show refraction color on hit, dark background otherwise
      { id: 'msk_9', type: 'multiplyVec3', position: { x: 1820, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'pal_8', outputKey: 'color' } }, scale: { type: 'float', label: 'Scale', connection: { nodeId: 'mlg_4', outputKey: 'hit' } } },
        outputs: { result: { type: 'vec3', label: 'Result' } }, params: { scale: 1.0 } },
      { id: 'tone_10', type: 'toneMap', position: { x: 2000, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'msk_9', outputKey: 'result' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } }, params: { mode: 'aces' } },
      { id: 'out_11', type: 'output', position: { x: 2180, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'tone_10', outputKey: 'color' } } },
        outputs: {}, params: {} },
    ],
  },

  refractDirDispersion: {
    label: 'Refract Dir: Chromatic Dispersion',
    counter: 20,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 60,  y: 180 }, inputs: {}, outputs: { uv:   { type: 'vec2',  label: 'UV'   } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 60,  y: 340 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'cam_2', type: 'marchCamera', position: { x: 280, y: 260 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { ro: { type: 'vec3', label: 'Ray Origin' }, rd: { type: 'vec3', label: 'Ray Dir' } },
        params: { camDist: 3.5, camAngle: 0.4, camElevation: 0.2, rotSpeed: 0.1, fov: 1.4, aperture: 0.0, focalDist: 3.5 },
      },
      {
        id: 'scene_3', type: 'sceneGroup', position: { x: 560, y: 400 },
        inputs: {}, outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: 'Prism Sphere',
          subgraph: {
            nodes: [
              { id: 'sp', type: 'scenePos', position: { x: 80, y: 150 }, inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'sdf', type: 'sphereSDF3D', position: { x: 280, y: 150 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { radius: 0.7 } },
            ],
            outputNodeId: 'sdf', outputKey: 'dist', inputPorts: [], outputPorts: [],
          },
        },
      },
      {
        id: 'mlg_4', type: 'marchLoopGroup', position: { x: 820, y: 200 },
        inputs: {
          ro:    { type: 'vec3',    label: 'Ray Origin', connection: { nodeId: 'cam_2',   outputKey: 'ro'    } },
          rd:    { type: 'vec3',    label: 'Ray Dir',    connection: { nodeId: 'cam_2',   outputKey: 'rd'    } },
          scene: { type: 'scene3d', label: 'Scene',      connection: { nodeId: 'scene_3', outputKey: 'scene' } },
          uv:    { type: 'vec2',  label: 'UV' },
          time:  { type: 'float', label: 'Time' },
        },
        outputs: { color: { type: 'vec3', label: 'Color' }, dist: { type: 'float', label: 'Distance' }, depth: { type: 'float', label: 'Depth' }, normal: { type: 'vec3', label: 'Normal' }, iter: { type: 'float', label: 'Iter' }, iterCount: { type: 'float', label: 'Iter Count' }, hit: { type: 'float', label: 'Hit' }, pos: { type: 'vec3', label: 'Hit Pos' } },
        params: { maxSteps: 80, maxDist: 12.0, stepScale: 1.0, volumetric: false, passthrough: 0.1, jitter: 0.0, bgR: 0.04, bgG: 0.03, bgB: 0.08, albedoR: 0.15, albedoG: 0.15, albedoB: 0.2, subgraph: { nodes: [], inputPorts: [], outputPorts: [] } },
      },
      // Three refractDir nodes — slightly different IOR per R/G/B channel (dispersion)
      { id: 'rfr_r', type: 'refractDir', position: { x: 1080, y: 100 },
        inputs: { incident: { type: 'vec3', label: 'Incident', connection: { nodeId: 'cam_2', outputKey: 'rd' } }, normal: { type: 'vec3', label: 'Normal', connection: { nodeId: 'mlg_4', outputKey: 'normal' } } },
        outputs: { refracted: { type: 'vec3', label: 'Refracted' }, tir: { type: 'float', label: 'TIR' } }, params: { ior1: 1.0, ior2: 1.43 } },
      { id: 'rfr_g', type: 'refractDir', position: { x: 1080, y: 240 },
        inputs: { incident: { type: 'vec3', label: 'Incident', connection: { nodeId: 'cam_2', outputKey: 'rd' } }, normal: { type: 'vec3', label: 'Normal', connection: { nodeId: 'mlg_4', outputKey: 'normal' } } },
        outputs: { refracted: { type: 'vec3', label: 'Refracted' }, tir: { type: 'float', label: 'TIR' } }, params: { ior1: 1.0, ior2: 1.50 } },
      { id: 'rfr_b', type: 'refractDir', position: { x: 1080, y: 380 },
        inputs: { incident: { type: 'vec3', label: 'Incident', connection: { nodeId: 'cam_2', outputKey: 'rd' } }, normal: { type: 'vec3', label: 'Normal', connection: { nodeId: 'mlg_4', outputKey: 'normal' } } },
        outputs: { refracted: { type: 'vec3', label: 'Refracted' }, tir: { type: 'float', label: 'TIR' } }, params: { ior1: 1.0, ior2: 1.58 } },
      // Extract y from each (vertical dispersion component)
      { id: 'spl_r', type: 'splitVec3', position: { x: 1300, y: 100 },
        inputs: { v: { type: 'vec3', label: 'V', connection: { nodeId: 'rfr_r', outputKey: 'refracted' } } },
        outputs: { x: { type: 'float', label: 'X' }, y: { type: 'float', label: 'Y' }, z: { type: 'float', label: 'Z' } }, params: {} },
      { id: 'spl_g', type: 'splitVec3', position: { x: 1300, y: 240 },
        inputs: { v: { type: 'vec3', label: 'V', connection: { nodeId: 'rfr_g', outputKey: 'refracted' } } },
        outputs: { x: { type: 'float', label: 'X' }, y: { type: 'float', label: 'Y' }, z: { type: 'float', label: 'Z' } }, params: {} },
      { id: 'spl_b', type: 'splitVec3', position: { x: 1300, y: 380 },
        inputs: { v: { type: 'vec3', label: 'V', connection: { nodeId: 'rfr_b', outputKey: 'refracted' } } },
        outputs: { x: { type: 'float', label: 'X' }, y: { type: 'float', label: 'Y' }, z: { type: 'float', label: 'Z' } }, params: {} },
      // Remap each y from [-1,1] to [0,1]
      { id: 'rmp_r', type: 'remap', position: { x: 1480, y: 100 },
        inputs: { value: { type: 'float', label: 'Value', connection: { nodeId: 'spl_r', outputKey: 'y' } } },
        outputs: { result: { type: 'float', label: 'Result' } }, params: { inMin: -1.0, inMax: 1.0, outMin: 0.0, outMax: 1.0 } },
      { id: 'rmp_g', type: 'remap', position: { x: 1480, y: 240 },
        inputs: { value: { type: 'float', label: 'Value', connection: { nodeId: 'spl_g', outputKey: 'y' } } },
        outputs: { result: { type: 'float', label: 'Result' } }, params: { inMin: -1.0, inMax: 1.0, outMin: 0.0, outMax: 1.0 } },
      { id: 'rmp_b', type: 'remap', position: { x: 1480, y: 380 },
        inputs: { value: { type: 'float', label: 'Value', connection: { nodeId: 'spl_b', outputKey: 'y' } } },
        outputs: { result: { type: 'float', label: 'Result' } }, params: { inMin: -1.0, inMax: 1.0, outMin: 0.0, outMax: 1.0 } },
      // Build dispersion color: multiply each remapped scalar by a channel mask vec3
      { id: 'r_mask', type: 'makeVec3', position: { x: 1860, y: 460 }, inputs: {}, outputs: { rgb: { type: 'vec3', label: 'RGB' } }, params: { r: 1.0, g: 0.0, b: 0.0 } },
      { id: 'g_mask', type: 'makeVec3', position: { x: 2000, y: 460 }, inputs: {}, outputs: { rgb: { type: 'vec3', label: 'RGB' } }, params: { r: 0.0, g: 1.0, b: 0.0 } },
      { id: 'b_mask', type: 'makeVec3', position: { x: 2140, y: 460 }, inputs: {}, outputs: { rgb: { type: 'vec3', label: 'RGB' } }, params: { r: 0.0, g: 0.0, b: 1.0 } },
      { id: 'ch_r', type: 'multiplyVec3', position: { x: 1860, y: 560 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'r_mask', outputKey: 'rgb' } }, scale: { type: 'float', label: 'Scale', connection: { nodeId: 'rmp_r', outputKey: 'result' } } },
        outputs: { result: { type: 'vec3', label: 'Result' } }, params: { scale: 1.0 } },
      { id: 'ch_g', type: 'multiplyVec3', position: { x: 2000, y: 560 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'g_mask', outputKey: 'rgb' } }, scale: { type: 'float', label: 'Scale', connection: { nodeId: 'rmp_g', outputKey: 'result' } } },
        outputs: { result: { type: 'vec3', label: 'Result' } }, params: { scale: 1.0 } },
      { id: 'ch_b', type: 'multiplyVec3', position: { x: 2140, y: 560 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'b_mask', outputKey: 'rgb' } }, scale: { type: 'float', label: 'Scale', connection: { nodeId: 'rmp_b', outputKey: 'result' } } },
        outputs: { result: { type: 'vec3', label: 'Result' } }, params: { scale: 1.0 } },
      { id: 'sum_rg', type: 'addVec3', position: { x: 2060, y: 640 },
        inputs: { a: { type: 'vec3', label: 'A', connection: { nodeId: 'ch_r', outputKey: 'result' } }, b: { type: 'vec3', label: 'B', connection: { nodeId: 'ch_g', outputKey: 'result' } } },
        outputs: { result: { type: 'vec3', label: 'Result' } }, params: {} },
      { id: 'sum_rgb', type: 'addVec3', position: { x: 2220, y: 600 },
        inputs: { a: { type: 'vec3', label: 'A', connection: { nodeId: 'sum_rg', outputKey: 'result' } }, b: { type: 'vec3', label: 'B', connection: { nodeId: 'ch_b', outputKey: 'result' } } },
        outputs: { result: { type: 'vec3', label: 'Result' } }, params: {} },
      // Hit mask
      { id: 'msk_15', type: 'multiplyVec3', position: { x: 2400, y: 560 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'sum_rgb', outputKey: 'result' } }, scale: { type: 'float', label: 'Scale', connection: { nodeId: 'mlg_4', outputKey: 'hit' } } },
        outputs: { result: { type: 'vec3', label: 'Result' } }, params: { scale: 1.0 } },
      { id: 'tone_16', type: 'toneMap', position: { x: 2580, y: 560 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'msk_15', outputKey: 'result' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } }, params: { mode: 'aces' } },
      { id: 'out_17', type: 'output', position: { x: 2760, y: 560 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'tone_16', outputKey: 'color' } } },
        outputs: {}, params: {} },
    ],
  },

  // ── Depth of Field (post-process) ──────────────────────────────────────────
  // Camera at distance 6. Three spheres placed via translate3D (pos→SDF order):
  //   Near  (t≈2.5): translate( 2.0, 0.6, 3.0)  — right, close, blurry
  //   Mid   (t≈5.4): translate( 0,   0,   0   )  — center, in-focus
  //   Far   (t≈10.6): translate(-2.5, -0.4, -5.0) — left, deep, blurry
  // focalDist=5.5 keeps the center sphere sharp.
  dofDepthBlur: {
    label: 'Depth of Field: Post-Process Blur',
    counter: 20,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 60,  y: 180 }, inputs: {}, outputs: { uv:   { type: 'vec2',  label: 'UV'   } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 60,  y: 340 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'cam_2', type: 'marchCamera', position: { x: 280, y: 260 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { ro: { type: 'vec3', label: 'Ray Origin' }, rd: { type: 'vec3', label: 'Ray Dir' } },
        params: { camDist: 6.0, camAngle: 0.15, camElevation: 0.08, rotSpeed: 0.06, fov: 1.1, aperture: 0.0, focalDist: 5.5, lensSpeed: 0.0 },
      },
      {
        id: 'scene_3', type: 'sceneGroup', position: { x: 560, y: 400 },
        inputs: {}, outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: 'Three Spheres',
          subgraph: {
            nodes: [
              { id: 'sp', type: 'scenePos', position: { x: 60, y: 240 }, inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              // Near sphere: translate then SDF
              { id: 'tr_a', type: 'translate3D', position: { x: 240, y: 80 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp', outputKey: 'pos' } } },
                outputs: { pos: { type: 'vec3', label: 'Translated Pos' } }, params: { tx: 2.0, ty: 0.6, tz: 3.0 } },
              { id: 'sdf_a', type: 'sphereSDF3D', position: { x: 440, y: 80 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'tr_a', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { radius: 0.45 } },
              // Mid sphere: at origin (no translate)
              { id: 'sdf_b', type: 'sphereSDF3D', position: { x: 440, y: 240 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { radius: 0.65 } },
              // Far sphere: translate then SDF
              { id: 'tr_c', type: 'translate3D', position: { x: 240, y: 400 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp', outputKey: 'pos' } } },
                outputs: { pos: { type: 'vec3', label: 'Translated Pos' } }, params: { tx: -2.5, ty: -0.4, tz: -5.0 } },
              { id: 'sdf_c', type: 'sphereSDF3D', position: { x: 440, y: 400 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'tr_c', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { radius: 0.85 } },
              // Union all three
              { id: 'u_ab', type: 'sdfUnion', position: { x: 640, y: 160 },
                inputs: {
                  a: { type: 'float', label: 'A', connection: { nodeId: 'sdf_a', outputKey: 'dist' } },
                  b: { type: 'float', label: 'B', connection: { nodeId: 'sdf_b', outputKey: 'dist' } },
                },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: {} },
              { id: 'u_abc', type: 'sdfUnion', position: { x: 640, y: 320 },
                inputs: {
                  a: { type: 'float', label: 'A', connection: { nodeId: 'u_ab',  outputKey: 'dist' } },
                  b: { type: 'float', label: 'B', connection: { nodeId: 'sdf_c', outputKey: 'dist' } },
                },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: {} },
            ],
            outputNodeId: 'u_abc', outputKey: 'dist', inputPorts: [], outputPorts: [],
          },
        },
      },
      {
        id: 'mlg_4', type: 'marchLoopGroup', position: { x: 840, y: 240 },
        inputs: {
          ro:    { type: 'vec3',    label: 'Ray Origin', connection: { nodeId: 'cam_2',   outputKey: 'ro'    } },
          rd:    { type: 'vec3',    label: 'Ray Dir',    connection: { nodeId: 'cam_2',   outputKey: 'rd'    } },
          scene: { type: 'scene3d', label: 'Scene',      connection: { nodeId: 'scene_3', outputKey: 'scene' } },
          uv:    { type: 'vec2',  label: 'UV' },
          time:  { type: 'float', label: 'Time' },
        },
        outputs: {
          color: { type: 'vec3', label: 'Color' }, dist: { type: 'float', label: 'Distance' },
          normal: { type: 'vec3', label: 'Normal' }, hit: { type: 'float', label: 'Hit' },
        },
        params: {
          maxSteps: 80, maxDist: 22.0, stepScale: 1.0, volumetric: false, passthrough: 0.1, jitter: 0.0,
          bgR: 0.03, bgG: 0.03, bgB: 0.05, albedoR: 0.88, albedoG: 0.90, albedoB: 0.96,
          subgraph: { nodes: [], inputPorts: [], outputPorts: [] },
        },
      },
      // Tone map first so prevFrame holds a clean image for the blur to sample
      { id: 'tone_5', type: 'toneMap', position: { x: 1100, y: 240 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'mlg_4', outputKey: 'color' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } }, params: { mode: 'aces' } },
      // Post-process DoF: center sphere (t≈5.4) stays sharp, others blur out
      { id: 'dof_6', type: 'depthOfField', position: { x: 1300, y: 240 },
        inputs: {
          color: { type: 'vec3',  label: 'Color', connection: { nodeId: 'tone_5', outputKey: 'color' } },
          uv:    { type: 'vec2',  label: 'UV',    connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          dist:  { type: 'float', label: 'Dist',  connection: { nodeId: 'mlg_4',  outputKey: 'dist' } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' }, coc: { type: 'float', label: 'CoC' } },
        params: { focalDist: 5.5, focalRange: 1.2, maxBlur: 10.0, bokehShape: 'disc' } },
      { id: 'out_7', type: 'output', position: { x: 1520, y: 240 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'dof_6', outputKey: 'result' } } },
        outputs: {}, params: {} },
    ],
  },

  // ── Spherical Fold Fractal ────────────────────────────────────────────────
  ringGlow: {
    label: 'Ring Glow',
    counter: 3,
    nodes: [
      { id: 'rg_uv',   type: 'uv',   position: { x: 40, y: 160 }, inputs: {}, outputs: { uv:   { type: 'vec2',  label: 'UV'   } }, params: {} },
      { id: 'rg_time', type: 'time', position: { x: 40, y: 320 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'rg_fn', type: 'customFn', position: { x: 280, y: 160 },
        inputs: {
          uv:   { type: 'vec2',  label: 'uv',   connection: { nodeId: 'rg_uv',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'time', connection: { nodeId: 'rg_time', outputKey: 'time' } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } },
        params: {
          label: 'Ring Glow',
          inputs: [{ name: 'uv', type: 'vec2', slider: null }, { name: 'time', type: 'float', slider: null }],
          outputType: 'vec3',
          body: 'vec2 p = uv * 1.2;\nfloat l = length(p) - 1.0;\nvec3 col = 0.5 + tanh(0.1 / max(l * 10.0, -l) - sin(l + p.y * max(1.0, -l * 10.0) + time + vec3(0.0, 1.0, 2.0))) / 2.0;\nreturn col;',
          glslFunctions: '',
        },
      },
      {
        id: 'rg_out', type: 'output', position: { x: 540, y: 160 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'rg_fn', outputKey: 'result' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Sphere Face Light (XorDev) ───────────────────────────────────────────
  // analytical sphere surface — mix axis-aligned normal with cos-time axis
  sphereFaceLight: {
    label: 'Sphere Face Light',
    counter: 3,
    nodes: [
      { id: 'sf_uv',   type: 'uv',   position: { x: 40, y: 160 }, inputs: {}, outputs: { uv:   { type: 'vec2',  label: 'UV'   } }, params: {} },
      { id: 'sf_time', type: 'time', position: { x: 40, y: 320 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'sf_fn', type: 'customFn', position: { x: 280, y: 160 },
        inputs: {
          uv:   { type: 'vec2',  label: 'uv',   connection: { nodeId: 'sf_uv',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'time', connection: { nodeId: 'sf_time', outputKey: 'time' } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } },
        params: {
          label: 'Sphere Face Light',
          inputs: [{ name: 'uv', type: 'vec2', slider: null }, { name: 'time', type: 'float', slider: null }],
          outputType: 'vec3',
          body: 'vec3 p = vec3(uv, 0.0);\nvec3 s = vec3(sqrt(max(0.5 - dot(uv, uv), 0.0)), uv);\nvec3 a = cos(time + vec3(0.0, 11.0, -time));\nvec3 col = 0.1 / abs(mix(a * dot(a, s), s, 0.8) - 0.6 * cross(a, s)) / (1.0 + dot(uv, uv));\nreturn tanh(col + length(col / 5.0));',
          glslFunctions: '',
        },
      },
      {
        id: 'sf_out', type: 'output', position: { x: 540, y: 160 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'sf_fn', outputKey: 'result' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── 3D Fractals: Mandelbox Orbit Palette ──────────────────────────────────
  // Re-evaluates mandelboxDE at the hit position (outside the march) to sample
  // the orbit trap float, which drives a palette. Classic orbit-trap coloring
  // without a monolith node — fully composable.
  matrixAnisotropicScale: {
    label: 'Matrix: Anisotropic Scale',
    counter: 17,
    nodes: [
      { id: 'uv_1',   type: 'uv',   position: { x: 60,  y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_2', type: 'time', position: { x: 60,  y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      // sx = sin(t*0.7) + 1.5
      { id: 'mulx_3', type: 'multiply', position: { x: 260, y: 320 },
        inputs: { a: { type: 'float', label: 'A', connection: { nodeId: 'time_2', outputKey: 'time' } } },
        outputs: { result: { type: 'float', label: 'Result' } }, params: { b: 0.7 } },
      { id: 'sinx_4', type: 'sin', position: { x: 460, y: 280 },
        inputs: { input: { type: 'float', label: 'Input', connection: { nodeId: 'mulx_3', outputKey: 'result' } } },
        outputs: { output: { type: 'float', label: 'Output' } }, params: {} },
      { id: 'addx_5', type: 'add', position: { x: 660, y: 260 },
        inputs: { a: { type: 'float', label: 'A', connection: { nodeId: 'sinx_4', outputKey: 'output' } } },
        outputs: { result: { type: 'float', label: 'Result' } }, params: { b: 1.5 } },
      // sy = sin(t*1.3) + 1.5
      { id: 'muly_6', type: 'multiply', position: { x: 260, y: 480 },
        inputs: { a: { type: 'float', label: 'A', connection: { nodeId: 'time_2', outputKey: 'time' } } },
        outputs: { result: { type: 'float', label: 'Result' } }, params: { b: 1.3 } },
      { id: 'siny_7', type: 'sin', position: { x: 460, y: 480 },
        inputs: { input: { type: 'float', label: 'Input', connection: { nodeId: 'muly_6', outputKey: 'result' } } },
        outputs: { output: { type: 'float', label: 'Output' } }, params: {} },
      { id: 'addy_8', type: 'add', position: { x: 660, y: 480 },
        inputs: { a: { type: 'float', label: 'A', connection: { nodeId: 'siny_7', outputKey: 'output' } } },
        outputs: { result: { type: 'float', label: 'Result' } }, params: { b: 1.5 } },
      // mat2 columns: col0=[sx,0], col1=[0,sy]
      { id: 'zero_9', type: 'constant', position: { x: 460, y: 640 }, inputs: {}, outputs: { value: { type: 'float', label: 'Value' } }, params: { value: 0.0 } },
      { id: 'col0_10', type: 'makeVec2', position: { x: 860, y: 240 },
        inputs: { x: { type: 'float', label: 'X', connection: { nodeId: 'addx_5', outputKey: 'result' } }, y: { type: 'float', label: 'Y', connection: { nodeId: 'zero_9', outputKey: 'value' } } },
        outputs: { xy: { type: 'vec2', label: 'XY' } }, params: {} },
      { id: 'col1_11', type: 'makeVec2', position: { x: 860, y: 460 },
        inputs: { x: { type: 'float', label: 'X', connection: { nodeId: 'zero_9', outputKey: 'value' } }, y: { type: 'float', label: 'Y', connection: { nodeId: 'addy_8', outputKey: 'result' } } },
        outputs: { xy: { type: 'vec2', label: 'XY' } }, params: {} },
      { id: 'mat_12', type: 'mat2Construct', position: { x: 1060, y: 340 },
        inputs: { v0: { type: 'vec2', label: 'Vec 0', connection: { nodeId: 'col0_10', outputKey: 'xy' } }, v1: { type: 'vec2', label: 'Vec 1', connection: { nodeId: 'col1_11', outputKey: 'xy' } } },
        outputs: { mat: { type: 'mat2', label: 'Mat2' } }, params: { mode: 'cols' } },
      { id: 'xform_13', type: 'mat2MulVec', position: { x: 1260, y: 280 },
        inputs: { mat: { type: 'mat2', label: 'Mat2', connection: { nodeId: 'mat_12', outputKey: 'mat' } }, vec: { type: 'vec2', label: 'Vec2', connection: { nodeId: 'uv_1', outputKey: 'uv' } } },
        outputs: { output: { type: 'vec2', label: 'Vec2 out' } }, params: {} },
      { id: 'fract_14', type: 'fract', position: { x: 1460, y: 240 },
        inputs: { input: { type: 'vec2', label: 'Input', connection: { nodeId: 'xform_13', outputKey: 'output' } }, scale: { type: 'float', label: 'Scale' } },
        outputs: { output: { type: 'vec2', label: 'Output' } }, params: { scale: 4.0 } },
      { id: 'circle_15', type: 'circleSDF', position: { x: 1660, y: 200 },
        inputs: { position: { type: 'vec2', label: 'Position', connection: { nodeId: 'fract_14', outputKey: 'output' } }, radius: { type: 'float', label: 'Radius' }, offset: { type: 'vec2', label: 'Offset' } },
        outputs: { distance: { type: 'float', label: 'Distance' } }, params: { radius: 0.28 } },
      { id: 'colorize_16', type: 'sdfColorize', position: { x: 1860, y: 200 },
        inputs: { d: { type: 'float', label: 'SDF', connection: { nodeId: 'circle_15', outputKey: 'distance' } }, inside: { type: 'vec3', label: 'Inside Color' }, outside: { type: 'vec3', label: 'Outside Color' }, edge: { type: 'float', label: 'Edge Softness' } },
        outputs: { result: { type: 'vec3', label: 'Color' } }, params: { edge: 0.02, inside: [0.2, 0.9, 0.5], outside: [0.04, 0.02, 0.06] } },
      { id: 'output_17', type: 'output', position: { x: 2080, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'colorize_16', outputKey: 'result' } } },
        outputs: {}, params: {} },
    ],
  },

  // ── Matrix: Shear ─────────────────────────────────────────────────────────
  // Off-diagonal mat2: col1=[sin(t)*0.7, 1]. Grid slants left/right over time.
  // Shows how the off-diagonal controls shear — distinct from both scale and rotation.
  matrixShear: {
    label: 'Matrix: Shear',
    counter: 14,
    nodes: [
      { id: 'uv_1',   type: 'uv',   position: { x: 60,  y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_2', type: 'time', position: { x: 60,  y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      // shear amount = sin(t) * 0.7
      { id: 'sin_3', type: 'sin', position: { x: 260, y: 340 },
        inputs: { input: { type: 'float', label: 'Input', connection: { nodeId: 'time_2', outputKey: 'time' } } },
        outputs: { output: { type: 'float', label: 'Output' } }, params: {} },
      { id: 'mul_4', type: 'multiply', position: { x: 460, y: 320 },
        inputs: { a: { type: 'float', label: 'A', connection: { nodeId: 'sin_3', outputKey: 'output' } } },
        outputs: { result: { type: 'float', label: 'Result' } }, params: { b: 0.7 } },
      // mat2 columns: col0=[1,0], col1=[shear,1]
      { id: 'one_5',  type: 'constant', position: { x: 260, y: 500 }, inputs: {}, outputs: { value: { type: 'float', label: 'Value' } }, params: { value: 1.0 } },
      { id: 'zero_6', type: 'constant', position: { x: 260, y: 620 }, inputs: {}, outputs: { value: { type: 'float', label: 'Value' } }, params: { value: 0.0 } },
      { id: 'col0_7', type: 'makeVec2', position: { x: 660, y: 460 },
        inputs: { x: { type: 'float', label: 'X', connection: { nodeId: 'one_5',  outputKey: 'value' } }, y: { type: 'float', label: 'Y', connection: { nodeId: 'zero_6', outputKey: 'value' } } },
        outputs: { xy: { type: 'vec2', label: 'XY' } }, params: {} },
      { id: 'col1_8', type: 'makeVec2', position: { x: 660, y: 600 },
        inputs: { x: { type: 'float', label: 'X', connection: { nodeId: 'mul_4',  outputKey: 'result' } }, y: { type: 'float', label: 'Y', connection: { nodeId: 'one_5',  outputKey: 'value'  } } },
        outputs: { xy: { type: 'vec2', label: 'XY' } }, params: {} },
      { id: 'mat_9', type: 'mat2Construct', position: { x: 880, y: 520 },
        inputs: { v0: { type: 'vec2', label: 'Vec 0', connection: { nodeId: 'col0_7', outputKey: 'xy' } }, v1: { type: 'vec2', label: 'Vec 1', connection: { nodeId: 'col1_8', outputKey: 'xy' } } },
        outputs: { mat: { type: 'mat2', label: 'Mat2' } }, params: { mode: 'cols' } },
      { id: 'xform_10', type: 'mat2MulVec', position: { x: 1080, y: 300 },
        inputs: { mat: { type: 'mat2', label: 'Mat2', connection: { nodeId: 'mat_9', outputKey: 'mat' } }, vec: { type: 'vec2', label: 'Vec2', connection: { nodeId: 'uv_1', outputKey: 'uv' } } },
        outputs: { output: { type: 'vec2', label: 'Vec2 out' } }, params: {} },
      { id: 'fract_11', type: 'fract', position: { x: 1280, y: 260 },
        inputs: { input: { type: 'vec2', label: 'Input', connection: { nodeId: 'xform_10', outputKey: 'output' } }, scale: { type: 'float', label: 'Scale' } },
        outputs: { output: { type: 'vec2', label: 'Output' } }, params: { scale: 4.0 } },
      { id: 'circle_12', type: 'circleSDF', position: { x: 1480, y: 220 },
        inputs: { position: { type: 'vec2', label: 'Position', connection: { nodeId: 'fract_11', outputKey: 'output' } }, radius: { type: 'float', label: 'Radius' }, offset: { type: 'vec2', label: 'Offset' } },
        outputs: { distance: { type: 'float', label: 'Distance' } }, params: { radius: 0.28 } },
      { id: 'colorize_13', type: 'sdfColorize', position: { x: 1680, y: 220 },
        inputs: { d: { type: 'float', label: 'SDF', connection: { nodeId: 'circle_12', outputKey: 'distance' } }, inside: { type: 'vec3', label: 'Inside Color' }, outside: { type: 'vec3', label: 'Outside Color' }, edge: { type: 'float', label: 'Edge Softness' } },
        outputs: { result: { type: 'vec3', label: 'Color' } }, params: { edge: 0.02, inside: [0.95, 0.4, 0.1], outside: [0.04, 0.02, 0.08] } },
      { id: 'output_14', type: 'output', position: { x: 1900, y: 220 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'colorize_13', outputKey: 'result' } } },
        outputs: {}, params: {} },
    ],
  },

  // ── Matrix: 3D Dual-Axis Rotation ─────────────────────────────────────────
  // Two mat2s applied to p.xz and p.yz inside a scene — each at a different speed.
  // Creates compound 3D tumble from two independent 2D rotations on a torus.
  matrixXZYZ: {
    label: 'Matrix: 3D Dual-Axis Rotation',
    counter: 5,
    nodes: [
      { id: 'uv_1',   type: 'uv',   position: { x: 60, y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_2', type: 'time', position: { x: 60, y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'scene_3', type: 'sceneGroup', position: { x: 300, y: 230 },
        inputs: {},
        outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: 'Dual-Axis Torus',
          subgraph: {
            nodes: [
              { id: 'sp',    type: 'scenePos',  position: { x: 60,   y: 100 }, inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'tsg',   type: 'time',      position: { x: 60,   y: 260 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
              { id: 'split', type: 'splitVec3', position: { x: 240,  y: 100 },
                inputs: { v: { type: 'vec3', label: 'Vec3', connection: { nodeId: 'sp', outputKey: 'pos' } } },
                outputs: { x: { type: 'float', label: 'X' }, y: { type: 'float', label: 'Y' }, z: { type: 'float', label: 'Z' } }, params: {} },
              // XZ rotation (around Y axis) at speed 0.5
              { id: 'mtx',   type: 'multiply',  position: { x: 240,  y: 260 },
                inputs: { a: { type: 'float', label: 'A', connection: { nodeId: 'tsg', outputKey: 'time' } } },
                outputs: { result: { type: 'float', label: 'Result' } }, params: { b: 0.5 } },
              { id: 'cxz',   type: 'cos',       position: { x: 420,  y: 220 },
                inputs: { input: { type: 'float', label: 'Input', connection: { nodeId: 'mtx', outputKey: 'result' } } },
                outputs: { output: { type: 'float', label: 'Output' } }, params: {} },
              { id: 'sxz',   type: 'sin',       position: { x: 420,  y: 320 },
                inputs: { input: { type: 'float', label: 'Input', connection: { nodeId: 'mtx', outputKey: 'result' } } },
                outputs: { output: { type: 'float', label: 'Output' } }, params: {} },
              { id: 'nxz',   type: 'negate',    position: { x: 600,  y: 320 },
                inputs: { input: { type: 'float', label: 'Input', connection: { nodeId: 'sxz', outputKey: 'output' } } },
                outputs: { output: { type: 'float', label: 'Output' } }, params: {} },
              { id: 'c0xz',  type: 'makeVec2',  position: { x: 780,  y: 200 },
                inputs: { x: { type: 'float', label: 'X', connection: { nodeId: 'cxz', outputKey: 'output' } }, y: { type: 'float', label: 'Y', connection: { nodeId: 'sxz', outputKey: 'output' } } },
                outputs: { xy: { type: 'vec2', label: 'XY' } }, params: {} },
              { id: 'c1xz',  type: 'makeVec2',  position: { x: 780,  y: 340 },
                inputs: { x: { type: 'float', label: 'X', connection: { nodeId: 'nxz', outputKey: 'output' } }, y: { type: 'float', label: 'Y', connection: { nodeId: 'cxz', outputKey: 'output' } } },
                outputs: { xy: { type: 'vec2', label: 'XY' } }, params: {} },
              { id: 'mxz',   type: 'mat2Construct', position: { x: 980, y: 260 },
                inputs: { v0: { type: 'vec2', label: 'Vec 0', connection: { nodeId: 'c0xz', outputKey: 'xy' } }, v1: { type: 'vec2', label: 'Vec 1', connection: { nodeId: 'c1xz', outputKey: 'xy' } } },
                outputs: { mat: { type: 'mat2', label: 'Mat2' } }, params: { mode: 'cols' } },
              { id: 'pxz',   type: 'makeVec2',  position: { x: 440,  y: 100 },
                inputs: { x: { type: 'float', label: 'X', connection: { nodeId: 'split', outputKey: 'x' } }, y: { type: 'float', label: 'Y', connection: { nodeId: 'split', outputKey: 'z' } } },
                outputs: { xy: { type: 'vec2', label: 'XY' } }, params: {} },
              { id: 'rxz',   type: 'mat2MulVec', position: { x: 1180, y: 160 },
                inputs: { mat: { type: 'mat2', label: 'Mat2', connection: { nodeId: 'mxz', outputKey: 'mat' } }, vec: { type: 'vec2', label: 'Vec2', connection: { nodeId: 'pxz', outputKey: 'xy' } } },
                outputs: { output: { type: 'vec2', label: 'Vec2 out' } }, params: {} },
              { id: 'srxz',  type: 'splitVec2', position: { x: 1380, y: 160 },
                inputs: { v: { type: 'vec2', label: 'Vec2', connection: { nodeId: 'rxz', outputKey: 'output' } } },
                outputs: { x: { type: 'float', label: 'X' }, y: { type: 'float', label: 'Y' } }, params: {} },
              // YZ rotation (around X axis) at speed 0.3
              { id: 'mty',   type: 'multiply',  position: { x: 240,  y: 440 },
                inputs: { a: { type: 'float', label: 'A', connection: { nodeId: 'tsg', outputKey: 'time' } } },
                outputs: { result: { type: 'float', label: 'Result' } }, params: { b: 0.3 } },
              { id: 'cyz',   type: 'cos',       position: { x: 420,  y: 480 },
                inputs: { input: { type: 'float', label: 'Input', connection: { nodeId: 'mty', outputKey: 'result' } } },
                outputs: { output: { type: 'float', label: 'Output' } }, params: {} },
              { id: 'syz',   type: 'sin',       position: { x: 420,  y: 580 },
                inputs: { input: { type: 'float', label: 'Input', connection: { nodeId: 'mty', outputKey: 'result' } } },
                outputs: { output: { type: 'float', label: 'Output' } }, params: {} },
              { id: 'nyz',   type: 'negate',    position: { x: 600,  y: 580 },
                inputs: { input: { type: 'float', label: 'Input', connection: { nodeId: 'syz', outputKey: 'output' } } },
                outputs: { output: { type: 'float', label: 'Output' } }, params: {} },
              { id: 'c0yz',  type: 'makeVec2',  position: { x: 780,  y: 480 },
                inputs: { x: { type: 'float', label: 'X', connection: { nodeId: 'cyz', outputKey: 'output' } }, y: { type: 'float', label: 'Y', connection: { nodeId: 'syz', outputKey: 'output' } } },
                outputs: { xy: { type: 'vec2', label: 'XY' } }, params: {} },
              { id: 'c1yz',  type: 'makeVec2',  position: { x: 780,  y: 600 },
                inputs: { x: { type: 'float', label: 'X', connection: { nodeId: 'nyz', outputKey: 'output' } }, y: { type: 'float', label: 'Y', connection: { nodeId: 'cyz', outputKey: 'output' } } },
                outputs: { xy: { type: 'vec2', label: 'XY' } }, params: {} },
              { id: 'myz',   type: 'mat2Construct', position: { x: 980, y: 540 },
                inputs: { v0: { type: 'vec2', label: 'Vec 0', connection: { nodeId: 'c0yz', outputKey: 'xy' } }, v1: { type: 'vec2', label: 'Vec 1', connection: { nodeId: 'c1yz', outputKey: 'xy' } } },
                outputs: { mat: { type: 'mat2', label: 'Mat2' } }, params: { mode: 'cols' } },
              { id: 'pyz',   type: 'makeVec2',  position: { x: 1180, y: 440 },
                inputs: { x: { type: 'float', label: 'X', connection: { nodeId: 'split', outputKey: 'y' } }, y: { type: 'float', label: 'Y', connection: { nodeId: 'srxz', outputKey: 'y' } } },
                outputs: { xy: { type: 'vec2', label: 'XY' } }, params: {} },
              { id: 'ryz',   type: 'mat2MulVec', position: { x: 1380, y: 440 },
                inputs: { mat: { type: 'mat2', label: 'Mat2', connection: { nodeId: 'myz', outputKey: 'mat' } }, vec: { type: 'vec2', label: 'Vec2', connection: { nodeId: 'pyz', outputKey: 'xy' } } },
                outputs: { output: { type: 'vec2', label: 'Vec2 out' } }, params: {} },
              { id: 'sryz',  type: 'splitVec2', position: { x: 1580, y: 440 },
                inputs: { v: { type: 'vec2', label: 'Vec2', connection: { nodeId: 'ryz', outputKey: 'output' } } },
                outputs: { x: { type: 'float', label: 'X' }, y: { type: 'float', label: 'Y' } }, params: {} },
              // Reconstruct: [newX, newY, finalZ]
              { id: 'newp',  type: 'makeVec3',  position: { x: 1780, y: 300 },
                inputs: { r: { type: 'float', label: 'R', connection: { nodeId: 'srxz', outputKey: 'x' } }, g: { type: 'float', label: 'G', connection: { nodeId: 'sryz', outputKey: 'x' } }, b: { type: 'float', label: 'B', connection: { nodeId: 'sryz', outputKey: 'y' } } },
                outputs: { rgb: { type: 'vec3', label: 'RGB' } }, params: {} },
              { id: 'torus', type: 'torusSDF3D', position: { x: 1980, y: 300 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'newp', outputKey: 'rgb' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { majorR: 0.55, minorR: 0.2 } },
            ],
            outputNodeId: 'torus',
            outputKey: 'dist',
          },
        },
      },
      {
        id: 'ray_4', type: 'rayMarch', position: { x: 600, y: 180 },
        inputs: {
          scene: { type: 'scene3d', label: 'Scene', connection: { nodeId: 'scene_3', outputKey: 'scene' } },
          uv:    { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_1',   outputKey: 'uv'   } },
          time:  { type: 'float', label: 'Time', connection: { nodeId: 'time_2', outputKey: 'time' } },
        },
        outputs: { color: { type: 'vec3', label: 'Color' }, depth: { type: 'float', label: 'Depth' }, normal: { type: 'vec3', label: 'Normal' } },
        params: { camDist: 3.0, fov: 1.5, maxSteps: 80, maxDist: 20.0, lightX: 2.0, lightY: 3.0, lightZ: 2.0, bgR: 0.02, bgG: 0.02, bgB: 0.08, albedoR: 0.3, albedoG: 0.7, albedoB: 1.0 },
      },
      {
        id: 'output_5', type: 'output', position: { x: 860, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'ray_4', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Matrix: RGB Color Grade ────────────────────────────────────────────────
  // mat3 rotation in RGB space — mixes color channels over time.
  // Shows how matrices work on any vec3, not just position.
  matrixColorGrade: {
    label: 'Matrix: RGB Color Grade',
    counter: 15,
    nodes: [
      { id: 'uv_1',   type: 'uv',   position: { x: 60,  y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_2', type: 'time', position: { x: 60,  y: 420 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      { id: 'cos_3', type: 'cos', position: { x: 260, y: 340 },
        inputs: { input: { type: 'float', label: 'Input', connection: { nodeId: 'time_2', outputKey: 'time' } } },
        outputs: { output: { type: 'float', label: 'Output' } }, params: {} },
      { id: 'sin_4', type: 'sin', position: { x: 260, y: 480 },
        inputs: { input: { type: 'float', label: 'Input', connection: { nodeId: 'time_2', outputKey: 'time' } } },
        outputs: { output: { type: 'float', label: 'Output' } }, params: {} },
      { id: 'neg_5', type: 'negate', position: { x: 460, y: 480 },
        inputs: { input: { type: 'float', label: 'Input', connection: { nodeId: 'sin_4', outputKey: 'output' } } },
        outputs: { output: { type: 'float', label: 'Output' } }, params: {} },
      { id: 'zero_6', type: 'constant', position: { x: 460, y: 620 }, inputs: {}, outputs: { value: { type: 'float', label: 'Value' } }, params: { value: 0.0 } },
      { id: 'one_7',  type: 'constant', position: { x: 460, y: 720 }, inputs: {}, outputs: { value: { type: 'float', label: 'Value' } }, params: { value: 1.0 } },
      { id: 'col0_8', type: 'makeVec3', position: { x: 660, y: 320 },
        inputs: { r: { type: 'float', label: 'R', connection: { nodeId: 'cos_3',  outputKey: 'output' } }, g: { type: 'float', label: 'G', connection: { nodeId: 'sin_4',  outputKey: 'output' } }, b: { type: 'float', label: 'B', connection: { nodeId: 'zero_6', outputKey: 'value'  } } },
        outputs: { rgb: { type: 'vec3', label: 'RGB' } }, params: {} },
      { id: 'col1_9', type: 'makeVec3', position: { x: 660, y: 480 },
        inputs: { r: { type: 'float', label: 'R', connection: { nodeId: 'neg_5',  outputKey: 'output' } }, g: { type: 'float', label: 'G', connection: { nodeId: 'cos_3',  outputKey: 'output' } }, b: { type: 'float', label: 'B', connection: { nodeId: 'zero_6', outputKey: 'value'  } } },
        outputs: { rgb: { type: 'vec3', label: 'RGB' } }, params: {} },
      { id: 'col2_10', type: 'makeVec3', position: { x: 660, y: 640 },
        inputs: { r: { type: 'float', label: 'R', connection: { nodeId: 'zero_6', outputKey: 'value'  } }, g: { type: 'float', label: 'G', connection: { nodeId: 'zero_6', outputKey: 'value'  } }, b: { type: 'float', label: 'B', connection: { nodeId: 'one_7',  outputKey: 'value'  } } },
        outputs: { rgb: { type: 'vec3', label: 'RGB' } }, params: {} },
      { id: 'mat_11', type: 'mat3Construct', position: { x: 880, y: 460 },
        inputs: { v0: { type: 'vec3', label: 'Vec 0', connection: { nodeId: 'col0_8',  outputKey: 'rgb' } }, v1: { type: 'vec3', label: 'Vec 1', connection: { nodeId: 'col1_9',  outputKey: 'rgb' } }, v2: { type: 'vec3', label: 'Vec 2', connection: { nodeId: 'col2_10', outputKey: 'rgb' } } },
        outputs: { mat: { type: 'mat3', label: 'Mat3' } }, params: { mode: 'cols' } },
      { id: 'len_12', type: 'length', position: { x: 260, y: 180 },
        inputs: { input: { type: 'vec2', label: 'Input', connection: { nodeId: 'uv_1', outputKey: 'uv' } } },
        outputs: { output: { type: 'float', label: 'Output' } }, params: { scale: 1.0 } },
      { id: 'pal_13', type: 'palettePreset', position: { x: 460, y: 160 },
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'len_12', outputKey: 'output' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } }, params: { preset: '3' } },
      { id: 'grade_14', type: 'mat3MulVec', position: { x: 1100, y: 340 },
        inputs: { mat: { type: 'mat3', label: 'Mat3', connection: { nodeId: 'mat_11', outputKey: 'mat' } }, vec: { type: 'vec3', label: 'Vec3', connection: { nodeId: 'pal_13', outputKey: 'color' } } },
        outputs: { output: { type: 'vec3', label: 'Vec3 out' } }, params: {} },
      { id: 'output_15', type: 'output', position: { x: 1320, y: 340 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'grade_14', outputKey: 'output' } } },
        outputs: {}, params: {} },
    ],
  },

  // ── Color Grade: Hue Rotate ───────────────────────────────────────────────
  // Cosine palette driven by radial distance, hue rotated by time.
  // Makes the entire image cycle through all hues — clearest demo of the node.
  cgHueRotate: {
    label: 'Color Grade: Hue Rotate',
    counter: 6,
    nodes: [
      { id: 'uv_1',   type: 'uv',   position: { x: 60,  y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_2', type: 'time', position: { x: 60,  y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      { id: 'len_3', type: 'length', position: { x: 260, y: 200 },
        inputs: { input: { type: 'vec2', label: 'Input', connection: { nodeId: 'uv_1', outputKey: 'uv' } } },
        outputs: { output: { type: 'float', label: 'Output' } }, params: { scale: 1.0 } },
      { id: 'pal_4', type: 'palettePreset', position: { x: 460, y: 200 },
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'len_3', outputKey: 'output' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } }, params: { preset: '1' } },
      { id: 'rot_5', type: 'hueRotate', position: { x: 660, y: 240 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'pal_4', outputKey: 'color' } }, angle: { type: 'float', label: 'Angle', connection: { nodeId: 'time_2', outputKey: 'time' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } }, params: { angle: 0.0 } },
      { id: 'out_6', type: 'output', position: { x: 880, y: 240 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'rot_5', outputKey: 'color' } } },
        outputs: {}, params: {} },
    ],
  },

  // ── Color Grade: Lift/Gamma/Gain ──────────────────────────────────────────
  // Split-toning: blue lift in shadows, warm gain in highlights.
  // Shows how vec3 params let you tint each tonal range independently.
  cgLiftGammaGain: {
    label: 'Color Grade: Lift / Gamma / Gain',
    counter: 8,
    nodes: [
      { id: 'uv_1',   type: 'uv',   position: { x: 60,  y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_2', type: 'time', position: { x: 60,  y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      { id: 'len_3', type: 'length', position: { x: 260, y: 200 },
        inputs: { input: { type: 'vec2', label: 'Input', connection: { nodeId: 'uv_1', outputKey: 'uv' } } },
        outputs: { output: { type: 'float', label: 'Output' } }, params: { scale: 1.0 } },
      { id: 'mul_4', type: 'multiply', position: { x: 260, y: 360 },
        inputs: { a: { type: 'float', label: 'A', connection: { nodeId: 'time_2', outputKey: 'time' } } },
        outputs: { result: { type: 'float', label: 'Result' } }, params: { b: 0.4 } },
      { id: 'add_5', type: 'add', position: { x: 460, y: 280 },
        inputs: { a: { type: 'float', label: 'A', connection: { nodeId: 'len_3', outputKey: 'output' } }, b: { type: 'float', label: 'B', connection: { nodeId: 'mul_4', outputKey: 'result' } } },
        outputs: { result: { type: 'float', label: 'Result' } }, params: { b: 0.0 } },
      { id: 'pal_6', type: 'palettePreset', position: { x: 660, y: 240 },
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'add_5', outputKey: 'result' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } }, params: { preset: '0' } },
      { id: 'lgg_7', type: 'liftGammaGain', position: { x: 880, y: 240 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'pal_6', outputKey: 'color' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { lift: [-0.04, -0.01, 0.10], gamma: [1.0, 1.0, 1.0], gain: [1.15, 0.95, 0.80] } },
      { id: 'out_8', type: 'output', position: { x: 1100, y: 240 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'lgg_7', outputKey: 'color' } } },
        outputs: {}, params: {} },
    ],
  },

  // ── Color Grade: Full Chain ───────────────────────────────────────────────
  // Saturate → Shadows/Highlights → Tone Curve chained in series.
  // Shows how each grading node stacks — change one to see its isolated effect.
  cgChain: {
    label: 'Color Grade: Full Chain',
    counter: 10,
    nodes: [
      { id: 'uv_1',   type: 'uv',   position: { x: 60,  y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_2', type: 'time', position: { x: 60,  y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      { id: 'len_3', type: 'length', position: { x: 260, y: 200 },
        inputs: { input: { type: 'vec2', label: 'Input', connection: { nodeId: 'uv_1', outputKey: 'uv' } } },
        outputs: { output: { type: 'float', label: 'Output' } }, params: { scale: 1.0 } },
      { id: 'mul_4', type: 'multiply', position: { x: 260, y: 360 },
        inputs: { a: { type: 'float', label: 'A', connection: { nodeId: 'time_2', outputKey: 'time' } } },
        outputs: { result: { type: 'float', label: 'Result' } }, params: { b: 0.3 } },
      { id: 'add_5', type: 'add', position: { x: 460, y: 280 },
        inputs: { a: { type: 'float', label: 'A', connection: { nodeId: 'len_3', outputKey: 'output' } }, b: { type: 'float', label: 'B', connection: { nodeId: 'mul_4', outputKey: 'result' } } },
        outputs: { result: { type: 'float', label: 'Result' } }, params: { b: 0.0 } },
      { id: 'pal_6', type: 'palettePreset', position: { x: 660, y: 240 },
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'add_5', outputKey: 'result' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } }, params: { preset: '4' } },
      { id: 'sat_7', type: 'colorSaturation', position: { x: 880, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'pal_6', outputKey: 'color' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } }, params: { amount: 1.8 } },
      { id: 'shhi_8', type: 'shadowsHighlights', position: { x: 1100, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'sat_7', outputKey: 'color' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } }, params: { shadows: -0.12, highlights: 0.08, pivot: 0.5 } },
      { id: 'tone_9', type: 'toneCurve', position: { x: 1320, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'shhi_8', outputKey: 'color' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } }, params: { blacks: 0.0, whites: 1.0, strength: 0.65 } },
      { id: 'out_10', type: 'output', position: { x: 1540, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'tone_9', outputKey: 'color' } } },
        outputs: {}, params: {} },
    ],
  },

  // ── Glass 3D (upgraded) ──────────────────────────────────────────────────────
  glassPhysical: {
    label: 'Glass 3D: Physical',
    counter: 8,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 60,  y: 180 }, inputs: {}, outputs: { uv:   { type: 'vec2',  label: 'UV'   } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 60,  y: 340 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'cam_2', type: 'marchCamera', position: { x: 280, y: 260 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { ro: { type: 'vec3', label: 'Ray Origin' }, rd: { type: 'vec3', label: 'Ray Dir' } },
        params: { camDist: 3.2, camAngle: 0.4, camElevation: 0.25, rotSpeed: 0.12, fov: 1.4, aperture: 0.0, focalDist: 3.2 },
      },
      {
        id: 'scene_3', type: 'sceneGroup', position: { x: 560, y: 400 },
        inputs: {}, outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: 'Glass Orb',
          subgraph: {
            nodes: [
              { id: 'sp', type: 'scenePos', position: { x: 80, y: 150 }, inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'sdf', type: 'sphereSDF3D', position: { x: 280, y: 150 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { radius: 0.8 } },
            ],
            outputNodeId: 'sdf', outputKey: 'dist', inputPorts: [], outputPorts: [],
          },
        },
      },
      {
        id: 'mlg_4', type: 'marchLoopGroup', position: { x: 820, y: 200 },
        inputs: {
          ro:    { type: 'vec3',    label: 'Ray Origin', connection: { nodeId: 'cam_2',   outputKey: 'ro'    } },
          rd:    { type: 'vec3',    label: 'Ray Dir',    connection: { nodeId: 'cam_2',   outputKey: 'rd'    } },
          scene: { type: 'scene3d', label: 'Scene',      connection: { nodeId: 'scene_3', outputKey: 'scene' } },
          uv:    { type: 'vec2',  label: 'UV' },
          time:  { type: 'float', label: 'Time' },
        },
        outputs: { color: { type: 'vec3', label: 'Color' }, dist: { type: 'float', label: 'Distance' }, depth: { type: 'float', label: 'Depth' }, normal: { type: 'vec3', label: 'Normal' }, iter: { type: 'float', label: 'Iter' }, iterCount: { type: 'float', label: 'Iter Count' }, hit: { type: 'float', label: 'Hit' }, pos: { type: 'vec3', label: 'Hit Pos' } },
        params: { maxSteps: 80, maxDist: 12.0, stepScale: 1.0, volumetric: false, passthrough: 0.1, jitter: 0.0, bgR: 0.04, bgG: 0.05, bgB: 0.14, albedoR: 0.2, albedoG: 0.2, albedoB: 0.3, subgraph: { nodes: [], inputPorts: [], outputPorts: [] } },
      },
      {
        id: 'glass_5', type: 'glass3d', position: { x: 1100, y: 200 },
        inputs: {
          rayDir:    { type: 'vec3',  label: 'Ray Dir',    connection: { nodeId: 'cam_2', outputKey: 'rd'     } },
          normal:    { type: 'vec3',  label: 'Normal',     connection: { nodeId: 'mlg_4', outputKey: 'normal' } },
          hit:       { type: 'float', label: 'Hit',        connection: { nodeId: 'mlg_4', outputKey: 'hit'    } },
          bgColor:   { type: 'vec3',  label: 'Background' },
          tintColor: { type: 'vec3',  label: 'Tint'       },
          lightDir:  { type: 'vec3',  label: 'Light Dir'  },
        },
        outputs: { color: { type: 'vec3', label: 'Glass Color' } },
        params: { ior: 1.5, fresnelPow: 3.5, dispersion: 0.06, samples: 8.0, shininess: 80.0, diffuseness: 0.45, saturation: 1.8 },
      },
      { id: 'tone_6', type: 'toneMap', position: { x: 1340, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'glass_5', outputKey: 'color' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } }, params: { mode: 'aces' } },
      { id: 'out_7', type: 'output', position: { x: 1560, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'tone_6', outputKey: 'color' } } },
        outputs: {}, params: {} },
    ],
  },

  // ── Spectral Dispersion (rygcbv 6-channel) ───────────────────────────────────
  spectralPrism: {
    label: 'Spectral Prism (rygcbv)',
    counter: 8,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 60,  y: 180 }, inputs: {}, outputs: { uv:   { type: 'vec2',  label: 'UV'   } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 60,  y: 340 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'cam_2', type: 'marchCamera', position: { x: 280, y: 260 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { ro: { type: 'vec3', label: 'Ray Origin' }, rd: { type: 'vec3', label: 'Ray Dir' } },
        params: { camDist: 3.5, camAngle: 0.3, camElevation: 0.3, rotSpeed: 0.08, fov: 1.4, aperture: 0.0, focalDist: 3.5 },
      },
      {
        id: 'scene_3', type: 'sceneGroup', position: { x: 560, y: 400 },
        inputs: {}, outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: 'Prism Torus',
          subgraph: {
            nodes: [
              { id: 'sp', type: 'scenePos', position: { x: 80, y: 150 }, inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'sdf', type: 'torusSDF3D', position: { x: 280, y: 150 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { R: 0.55, r: 0.28 } },
            ],
            outputNodeId: 'sdf', outputKey: 'dist', inputPorts: [], outputPorts: [],
          },
        },
      },
      {
        id: 'mlg_4', type: 'marchLoopGroup', position: { x: 820, y: 200 },
        inputs: {
          ro:    { type: 'vec3',    label: 'Ray Origin', connection: { nodeId: 'cam_2',   outputKey: 'ro'    } },
          rd:    { type: 'vec3',    label: 'Ray Dir',    connection: { nodeId: 'cam_2',   outputKey: 'rd'    } },
          scene: { type: 'scene3d', label: 'Scene',      connection: { nodeId: 'scene_3', outputKey: 'scene' } },
          uv:    { type: 'vec2',  label: 'UV' },
          time:  { type: 'float', label: 'Time' },
        },
        outputs: { color: { type: 'vec3', label: 'Color' }, dist: { type: 'float', label: 'Distance' }, depth: { type: 'float', label: 'Depth' }, normal: { type: 'vec3', label: 'Normal' }, iter: { type: 'float', label: 'Iter' }, iterCount: { type: 'float', label: 'Iter Count' }, hit: { type: 'float', label: 'Hit' }, pos: { type: 'vec3', label: 'Hit Pos' } },
        params: { maxSteps: 100, maxDist: 12.0, stepScale: 1.0, volumetric: false, passthrough: 0.1, jitter: 0.0, bgR: 0.03, bgG: 0.03, bgB: 0.08, albedoR: 0.15, albedoG: 0.15, albedoB: 0.2, subgraph: { nodes: [], inputPorts: [], outputPorts: [] } },
      },
      {
        id: 'spec_5', type: 'spectralDispersion', position: { x: 1100, y: 200 },
        inputs: {
          rayDir:  { type: 'vec3',  label: 'Ray Dir',    connection: { nodeId: 'cam_2', outputKey: 'rd'     } },
          normal:  { type: 'vec3',  label: 'Normal',     connection: { nodeId: 'mlg_4', outputKey: 'normal' } },
          hit:     { type: 'float', label: 'Hit',        connection: { nodeId: 'mlg_4', outputKey: 'hit'    } },
          bgColor: { type: 'vec3',  label: 'Background' },
        },
        outputs: { color: { type: 'vec3', label: 'Dispersed Color' } },
        params: {
          iorR: 1.505, iorY: 1.514, iorG: 1.519,
          iorC: 1.525, iorB: 1.531, iorV: 1.538,
          saturation: 2.4,
        },
      },
      { id: 'tone_6', type: 'toneMap', position: { x: 1340, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'spec_5', outputKey: 'color' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } }, params: { mode: 'aces' } },
      { id: 'out_7', type: 'output', position: { x: 1560, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'tone_6', outputKey: 'color' } } },
        outputs: {}, params: {} },
    ],
  },

  // ── Blinn-Phong Lit Sphere ────────────────────────────────────────────────────
  blinnPhongSphere: {
    label: 'Blinn-Phong: Lit Sphere',
    counter: 10,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 60,  y: 180 }, inputs: {}, outputs: { uv:   { type: 'vec2',  label: 'UV'   } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 60,  y: 340 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'cam_2', type: 'marchCamera', position: { x: 280, y: 260 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { ro: { type: 'vec3', label: 'Ray Origin' }, rd: { type: 'vec3', label: 'Ray Dir' } },
        params: { camDist: 3.0, camAngle: 0.3, camElevation: 0.2, rotSpeed: 0.1, fov: 1.4, aperture: 0.0, focalDist: 3.0 },
      },
      {
        id: 'scene_3', type: 'sceneGroup', position: { x: 560, y: 400 },
        inputs: {}, outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: 'Lit Sphere',
          subgraph: {
            nodes: [
              { id: 'sp', type: 'scenePos', position: { x: 80, y: 150 }, inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'sdf', type: 'sphereSDF3D', position: { x: 280, y: 150 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { radius: 0.9 } },
            ],
            outputNodeId: 'sdf', outputKey: 'dist', inputPorts: [], outputPorts: [],
          },
        },
      },
      {
        id: 'mlg_4', type: 'marchLoopGroup', position: { x: 820, y: 200 },
        inputs: {
          ro:    { type: 'vec3',    label: 'Ray Origin', connection: { nodeId: 'cam_2',   outputKey: 'ro'    } },
          rd:    { type: 'vec3',    label: 'Ray Dir',    connection: { nodeId: 'cam_2',   outputKey: 'rd'    } },
          scene: { type: 'scene3d', label: 'Scene',      connection: { nodeId: 'scene_3', outputKey: 'scene' } },
          uv:    { type: 'vec2',  label: 'UV' },
          time:  { type: 'float', label: 'Time' },
        },
        outputs: { color: { type: 'vec3', label: 'Color' }, dist: { type: 'float', label: 'Distance' }, depth: { type: 'float', label: 'Depth' }, normal: { type: 'vec3', label: 'Normal' }, iter: { type: 'float', label: 'Iter' }, iterCount: { type: 'float', label: 'Iter Count' }, hit: { type: 'float', label: 'Hit' }, pos: { type: 'vec3', label: 'Hit Pos' } },
        params: { maxSteps: 80, maxDist: 12.0, stepScale: 1.0, volumetric: false, passthrough: 0.1, jitter: 0.0, bgR: 0.02, bgG: 0.02, bgB: 0.04, albedoR: 0.3, albedoG: 0.5, albedoB: 0.9, subgraph: { nodes: [], inputPorts: [], outputPorts: [] } },
      },
      {
        id: 'bp_5', type: 'blinnPhong', position: { x: 1080, y: 200 },
        inputs: {
          normal:   { type: 'vec3', label: 'Normal',    connection: { nodeId: 'mlg_4', outputKey: 'normal' } },
          viewDir:  { type: 'vec3', label: 'View Dir',  connection: { nodeId: 'cam_2', outputKey: 'rd'     } },
          lightDir: { type: 'vec3', label: 'Light Dir' },
        },
        outputs: { light: { type: 'float', label: 'Light' } },
        params: { shininess: 72.0, diffuseness: 0.75, lightX: 0.8, lightY: 1.4, lightZ: 0.6 },
      },
      // Multiply surface albedo by Blinn-Phong light value
      { id: 'mul_6', type: 'multiplyVec3', position: { x: 1280, y: 200 },
        inputs: {
          color: { type: 'vec3',  label: 'Color', connection: { nodeId: 'mlg_4', outputKey: 'color' } },
          scale: { type: 'float', label: 'Scale', connection: { nodeId: 'bp_5',  outputKey: 'light' } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } }, params: { scale: 1.0 } },
      // Mask by hit so background stays dark
      { id: 'msk_7', type: 'multiplyVec3', position: { x: 1460, y: 200 },
        inputs: {
          color: { type: 'vec3',  label: 'Color', connection: { nodeId: 'mul_6', outputKey: 'result' } },
          scale: { type: 'float', label: 'Scale', connection: { nodeId: 'mlg_4', outputKey: 'hit'    } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } }, params: { scale: 1.0 } },
      { id: 'tone_8', type: 'toneMap', position: { x: 1640, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'msk_7', outputKey: 'result' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } }, params: { mode: 'aces' } },
      { id: 'out_9', type: 'output', position: { x: 1860, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'tone_8', outputKey: 'color' } } },
        outputs: {}, params: {} },
    ],
  },

  // ── Glass Metaballs ───────────────────────────────────────────────────────────
  glassMetaballs: {
    label: 'Glass Metaballs',
    counter: 8,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 60,  y: 180 }, inputs: {}, outputs: { uv:   { type: 'vec2',  label: 'UV'   } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 60,  y: 340 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'cam_2', type: 'marchCamera', position: { x: 280, y: 260 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { ro: { type: 'vec3', label: 'Ray Origin' }, rd: { type: 'vec3', label: 'Ray Dir' } },
        params: { camDist: 3.0, camAngle: 0.3, camElevation: 0.2, rotSpeed: 0.09, fov: 1.4, aperture: 0.0, focalDist: 3.0 },
      },
      {
        id: 'scene_3', type: 'sceneGroup', position: { x: 560, y: 400 },
        inputs: {}, outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: 'Blob Cluster',
          subgraph: {
            nodes: [
              { id: 'sp', type: 'scenePos', position: { x: 80, y: 200 }, inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'tr1', type: 'translate3D', position: { x: 260, y: 80 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp', outputKey: 'pos' } } },
                outputs: { pos: { type: 'vec3', label: 'Translated Pos' } }, params: { tx: -0.55, ty: 0.0, tz: 0.0 } },
              { id: 's1', type: 'sphereSDF3D', position: { x: 460, y: 80 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'tr1', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { radius: 0.52 } },
              { id: 'tr2', type: 'translate3D', position: { x: 260, y: 220 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp', outputKey: 'pos' } } },
                outputs: { pos: { type: 'vec3', label: 'Translated Pos' } }, params: { tx: 0.55, ty: 0.0, tz: 0.0 } },
              { id: 's2', type: 'sphereSDF3D', position: { x: 460, y: 220 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'tr2', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { radius: 0.52 } },
              { id: 'tr3', type: 'translate3D', position: { x: 260, y: 360 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp', outputKey: 'pos' } } },
                outputs: { pos: { type: 'vec3', label: 'Translated Pos' } }, params: { tx: 0.0, ty: 0.72, tz: 0.0 } },
              { id: 's3', type: 'sphereSDF3D', position: { x: 460, y: 360 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'tr3', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { radius: 0.48 } },
              { id: 'sm12', type: 'sdfSmoothUnion', position: { x: 660, y: 150 },
                inputs: {
                  a: { type: 'float', label: 'A', connection: { nodeId: 's1', outputKey: 'dist' } },
                  b: { type: 'float', label: 'B', connection: { nodeId: 's2', outputKey: 'dist' } },
                },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { k: 0.4 } },
              { id: 'sm123', type: 'sdfSmoothUnion', position: { x: 860, y: 260 },
                inputs: {
                  a: { type: 'float', label: 'A', connection: { nodeId: 'sm12', outputKey: 'dist' } },
                  b: { type: 'float', label: 'B', connection: { nodeId: 's3',   outputKey: 'dist' } },
                },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { k: 0.35 } },
            ],
            outputNodeId: 'sm123', outputKey: 'dist', inputPorts: [], outputPorts: [],
          },
        },
      },
      {
        id: 'mlg_4', type: 'marchLoopGroup', position: { x: 820, y: 200 },
        inputs: {
          ro:    { type: 'vec3',    label: 'Ray Origin', connection: { nodeId: 'cam_2',   outputKey: 'ro'    } },
          rd:    { type: 'vec3',    label: 'Ray Dir',    connection: { nodeId: 'cam_2',   outputKey: 'rd'    } },
          scene: { type: 'scene3d', label: 'Scene',      connection: { nodeId: 'scene_3', outputKey: 'scene' } },
          uv:    { type: 'vec2',  label: 'UV' },
          time:  { type: 'float', label: 'Time' },
        },
        outputs: { color: { type: 'vec3', label: 'Color' }, dist: { type: 'float', label: 'Distance' }, depth: { type: 'float', label: 'Depth' }, normal: { type: 'vec3', label: 'Normal' }, iter: { type: 'float', label: 'Iter' }, iterCount: { type: 'float', label: 'Iter Count' }, hit: { type: 'float', label: 'Hit' }, pos: { type: 'vec3', label: 'Hit Pos' } },
        params: { maxSteps: 80, maxDist: 12.0, stepScale: 1.0, volumetric: false, passthrough: 0.1, jitter: 0.0, bgR: 0.04, bgG: 0.05, bgB: 0.14, albedoR: 0.2, albedoG: 0.2, albedoB: 0.3, subgraph: { nodes: [], inputPorts: [], outputPorts: [] } },
      },
      {
        id: 'glass_5', type: 'glass3d', position: { x: 1100, y: 200 },
        inputs: {
          rayDir:    { type: 'vec3',  label: 'Ray Dir',    connection: { nodeId: 'cam_2', outputKey: 'rd'     } },
          normal:    { type: 'vec3',  label: 'Normal',     connection: { nodeId: 'mlg_4', outputKey: 'normal' } },
          hit:       { type: 'float', label: 'Hit',        connection: { nodeId: 'mlg_4', outputKey: 'hit'    } },
          bgColor:   { type: 'vec3',  label: 'Background' },
          tintColor: { type: 'vec3',  label: 'Tint'       },
          lightDir:  { type: 'vec3',  label: 'Light Dir'  },
        },
        outputs: { color: { type: 'vec3', label: 'Glass Color' } },
        params: { ior: 1.45, fresnelPow: 3.0, dispersion: 0.09, samples: 8.0, shininess: 60.0, diffuseness: 0.35, saturation: 2.2 },
      },
      { id: 'tone_6', type: 'toneMap', position: { x: 1340, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'glass_5', outputKey: 'color' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } }, params: { mode: 'aces' } },
      { id: 'out_7', type: 'output', position: { x: 1560, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'tone_6', outputKey: 'color' } } },
        outputs: {}, params: {} },
    ],
  },

  // ── Glass Rounded Box ─────────────────────────────────────────────────────────
  glassRoundBox: {
    label: 'Glass Rounded Box',
    counter: 8,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 60,  y: 180 }, inputs: {}, outputs: { uv:   { type: 'vec2',  label: 'UV'   } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 60,  y: 340 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'cam_2', type: 'marchCamera', position: { x: 280, y: 260 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { ro: { type: 'vec3', label: 'Ray Origin' }, rd: { type: 'vec3', label: 'Ray Dir' } },
        params: { camDist: 3.2, camAngle: 0.6, camElevation: 0.35, rotSpeed: 0.07, fov: 1.3, aperture: 0.0, focalDist: 3.2 },
      },
      {
        id: 'scene_3', type: 'sceneGroup', position: { x: 560, y: 400 },
        inputs: {}, outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: 'Round Box',
          subgraph: {
            nodes: [
              { id: 'sp', type: 'scenePos', position: { x: 80, y: 160 }, inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'box', type: 'boxSDF3D', position: { x: 280, y: 160 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { sizeX: 0.65, sizeY: 0.65, sizeZ: 0.65 } },
              { id: 'rnd', type: 'sdfRound', position: { x: 480, y: 160 },
                inputs: { dist: { type: 'float', label: 'Distance', connection: { nodeId: 'box', outputKey: 'dist' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { r: 0.12 } },
            ],
            outputNodeId: 'rnd', outputKey: 'dist', inputPorts: [], outputPorts: [],
          },
        },
      },
      {
        id: 'mlg_4', type: 'marchLoopGroup', position: { x: 820, y: 200 },
        inputs: {
          ro:    { type: 'vec3',    label: 'Ray Origin', connection: { nodeId: 'cam_2',   outputKey: 'ro'    } },
          rd:    { type: 'vec3',    label: 'Ray Dir',    connection: { nodeId: 'cam_2',   outputKey: 'rd'    } },
          scene: { type: 'scene3d', label: 'Scene',      connection: { nodeId: 'scene_3', outputKey: 'scene' } },
          uv:    { type: 'vec2',  label: 'UV' },
          time:  { type: 'float', label: 'Time' },
        },
        outputs: { color: { type: 'vec3', label: 'Color' }, dist: { type: 'float', label: 'Distance' }, depth: { type: 'float', label: 'Depth' }, normal: { type: 'vec3', label: 'Normal' }, iter: { type: 'float', label: 'Iter' }, iterCount: { type: 'float', label: 'Iter Count' }, hit: { type: 'float', label: 'Hit' }, pos: { type: 'vec3', label: 'Hit Pos' } },
        params: { maxSteps: 80, maxDist: 12.0, stepScale: 1.0, volumetric: false, passthrough: 0.1, jitter: 0.0, bgR: 0.04, bgG: 0.05, bgB: 0.14, albedoR: 0.2, albedoG: 0.2, albedoB: 0.3, subgraph: { nodes: [], inputPorts: [], outputPorts: [] } },
      },
      {
        id: 'glass_5', type: 'glass3d', position: { x: 1100, y: 200 },
        inputs: {
          rayDir:    { type: 'vec3',  label: 'Ray Dir',    connection: { nodeId: 'cam_2', outputKey: 'rd'     } },
          normal:    { type: 'vec3',  label: 'Normal',     connection: { nodeId: 'mlg_4', outputKey: 'normal' } },
          hit:       { type: 'float', label: 'Hit',        connection: { nodeId: 'mlg_4', outputKey: 'hit'    } },
          bgColor:   { type: 'vec3',  label: 'Background' },
          tintColor: { type: 'vec3',  label: 'Tint'       },
          lightDir:  { type: 'vec3',  label: 'Light Dir'  },
        },
        outputs: { color: { type: 'vec3', label: 'Glass Color' } },
        params: { ior: 1.6, fresnelPow: 4.0, dispersion: 0.05, samples: 6.0, shininess: 120.0, diffuseness: 0.5, saturation: 1.6 },
      },
      { id: 'tone_6', type: 'toneMap', position: { x: 1340, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'glass_5', outputKey: 'color' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } }, params: { mode: 'aces' } },
      { id: 'out_7', type: 'output', position: { x: 1560, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'tone_6', outputKey: 'color' } } },
        outputs: {}, params: {} },
    ],
  },

  // ── Glass Orb Trio (Spectral) ─────────────────────────────────────────────────
  glassOrbTrio: {
    label: 'Glass Orb Trio (Spectral)',
    counter: 8,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 60,  y: 180 }, inputs: {}, outputs: { uv:   { type: 'vec2',  label: 'UV'   } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 60,  y: 340 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'cam_2', type: 'marchCamera', position: { x: 280, y: 260 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { ro: { type: 'vec3', label: 'Ray Origin' }, rd: { type: 'vec3', label: 'Ray Dir' } },
        params: { camDist: 4.0, camAngle: 0.2, camElevation: 0.15, rotSpeed: 0.06, fov: 1.3, aperture: 0.0, focalDist: 4.0 },
      },
      {
        id: 'scene_3', type: 'sceneGroup', position: { x: 560, y: 400 },
        inputs: {}, outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: 'Orb Trio',
          subgraph: {
            nodes: [
              { id: 'sp', type: 'scenePos', position: { x: 80, y: 200 }, inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'tr1', type: 'translate3D', position: { x: 260, y: 80 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp', outputKey: 'pos' } } },
                outputs: { pos: { type: 'vec3', label: 'Translated Pos' } }, params: { tx: -0.65, ty: -0.3, tz: 0.0 } },
              { id: 's1', type: 'sphereSDF3D', position: { x: 460, y: 80 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'tr1', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { radius: 0.42 } },
              { id: 'tr2', type: 'translate3D', position: { x: 260, y: 220 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp', outputKey: 'pos' } } },
                outputs: { pos: { type: 'vec3', label: 'Translated Pos' } }, params: { tx: 0.65, ty: -0.3, tz: 0.0 } },
              { id: 's2', type: 'sphereSDF3D', position: { x: 460, y: 220 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'tr2', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { radius: 0.42 } },
              { id: 'tr3', type: 'translate3D', position: { x: 260, y: 360 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp', outputKey: 'pos' } } },
                outputs: { pos: { type: 'vec3', label: 'Translated Pos' } }, params: { tx: 0.0, ty: 0.58, tz: 0.0 } },
              { id: 's3', type: 'sphereSDF3D', position: { x: 460, y: 360 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'tr3', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { radius: 0.42 } },
              { id: 'u12', type: 'sdfUnion', position: { x: 660, y: 150 },
                inputs: {
                  a: { type: 'float', label: 'A', connection: { nodeId: 's1', outputKey: 'dist' } },
                  b: { type: 'float', label: 'B', connection: { nodeId: 's2', outputKey: 'dist' } },
                },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: {} },
              { id: 'u123', type: 'sdfUnion', position: { x: 860, y: 260 },
                inputs: {
                  a: { type: 'float', label: 'A', connection: { nodeId: 'u12', outputKey: 'dist' } },
                  b: { type: 'float', label: 'B', connection: { nodeId: 's3',  outputKey: 'dist' } },
                },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: {} },
            ],
            outputNodeId: 'u123', outputKey: 'dist', inputPorts: [], outputPorts: [],
          },
        },
      },
      {
        id: 'mlg_4', type: 'marchLoopGroup', position: { x: 820, y: 200 },
        inputs: {
          ro:    { type: 'vec3',    label: 'Ray Origin', connection: { nodeId: 'cam_2',   outputKey: 'ro'    } },
          rd:    { type: 'vec3',    label: 'Ray Dir',    connection: { nodeId: 'cam_2',   outputKey: 'rd'    } },
          scene: { type: 'scene3d', label: 'Scene',      connection: { nodeId: 'scene_3', outputKey: 'scene' } },
          uv:    { type: 'vec2',  label: 'UV' },
          time:  { type: 'float', label: 'Time' },
        },
        outputs: { color: { type: 'vec3', label: 'Color' }, dist: { type: 'float', label: 'Distance' }, depth: { type: 'float', label: 'Depth' }, normal: { type: 'vec3', label: 'Normal' }, iter: { type: 'float', label: 'Iter' }, iterCount: { type: 'float', label: 'Iter Count' }, hit: { type: 'float', label: 'Hit' }, pos: { type: 'vec3', label: 'Hit Pos' } },
        params: { maxSteps: 80, maxDist: 12.0, stepScale: 1.0, volumetric: false, passthrough: 0.1, jitter: 0.0, bgR: 0.04, bgG: 0.05, bgB: 0.14, albedoR: 0.2, albedoG: 0.2, albedoB: 0.3, subgraph: { nodes: [], inputPorts: [], outputPorts: [] } },
      },
      {
        id: 'spec_5', type: 'spectralDispersion', position: { x: 1100, y: 200 },
        inputs: {
          rayDir:  { type: 'vec3',  label: 'Ray Dir',    connection: { nodeId: 'cam_2', outputKey: 'rd'     } },
          normal:  { type: 'vec3',  label: 'Normal',     connection: { nodeId: 'mlg_4', outputKey: 'normal' } },
          hit:     { type: 'float', label: 'Hit',        connection: { nodeId: 'mlg_4', outputKey: 'hit'    } },
          bgColor: { type: 'vec3',  label: 'Background' },
        },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { iorR: 1.505, iorY: 1.514, iorG: 1.519, iorC: 1.525, iorB: 1.531, iorV: 1.538, saturation: 2.8 },
      },
      { id: 'tone_6', type: 'toneMap', position: { x: 1340, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'spec_5', outputKey: 'color' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } }, params: { mode: 'aces' } },
      { id: 'out_7', type: 'output', position: { x: 1560, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'tone_6', outputKey: 'color' } } },
        outputs: {}, params: {} },
    ],
  },

  // ── Glass Lava Blob ───────────────────────────────────────────────────────────
  glassLavaBlob: {
    label: 'Glass Lava Blob',
    counter: 8,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 60,  y: 180 }, inputs: {}, outputs: { uv:   { type: 'vec2',  label: 'UV'   } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 60,  y: 340 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'cam_2', type: 'marchCamera', position: { x: 280, y: 260 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { ro: { type: 'vec3', label: 'Ray Origin' }, rd: { type: 'vec3', label: 'Ray Dir' } },
        params: { camDist: 3.5, camAngle: 0.4, camElevation: 0.1, rotSpeed: 0.05, fov: 1.4, aperture: 0.0, focalDist: 3.5 },
      },
      {
        id: 'scene_3', type: 'sceneGroup', position: { x: 560, y: 400 },
        inputs: {}, outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: 'Lava Blob',
          subgraph: {
            nodes: [
              { id: 'sp', type: 'scenePos', position: { x: 60, y: 280 }, inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'tr1', type: 'translate3D', position: { x: 240, y: 60 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp', outputKey: 'pos' } } },
                outputs: { pos: { type: 'vec3', label: 'Translated Pos' } }, params: { tx: -0.55, ty: 0.2, tz: 0.1 } },
              { id: 's1', type: 'sphereSDF3D', position: { x: 440, y: 60 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'tr1', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { radius: 0.42 } },
              { id: 'tr2', type: 'translate3D', position: { x: 240, y: 180 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp', outputKey: 'pos' } } },
                outputs: { pos: { type: 'vec3', label: 'Translated Pos' } }, params: { tx: 0.55, ty: -0.1, tz: 0.0 } },
              { id: 's2', type: 'sphereSDF3D', position: { x: 440, y: 180 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'tr2', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { radius: 0.40 } },
              { id: 'tr3', type: 'translate3D', position: { x: 240, y: 300 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp', outputKey: 'pos' } } },
                outputs: { pos: { type: 'vec3', label: 'Translated Pos' } }, params: { tx: 0.0, ty: 0.65, tz: 0.0 } },
              { id: 's3', type: 'sphereSDF3D', position: { x: 440, y: 300 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'tr3', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { radius: 0.38 } },
              { id: 'tr4', type: 'translate3D', position: { x: 240, y: 420 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp', outputKey: 'pos' } } },
                outputs: { pos: { type: 'vec3', label: 'Translated Pos' } }, params: { tx: -0.25, ty: -0.55, tz: -0.1 } },
              { id: 's4', type: 'sphereSDF3D', position: { x: 440, y: 420 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'tr4', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { radius: 0.40 } },
              { id: 'tr5', type: 'translate3D', position: { x: 240, y: 540 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp', outputKey: 'pos' } } },
                outputs: { pos: { type: 'vec3', label: 'Translated Pos' } }, params: { tx: 0.35, ty: 0.45, tz: 0.25 } },
              { id: 's5', type: 'sphereSDF3D', position: { x: 440, y: 540 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'tr5', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { radius: 0.36 } },
              { id: 'sm12', type: 'sdfSmoothUnion', position: { x: 640, y: 120 },
                inputs: {
                  a: { type: 'float', label: 'A', connection: { nodeId: 's1', outputKey: 'dist' } },
                  b: { type: 'float', label: 'B', connection: { nodeId: 's2', outputKey: 'dist' } },
                },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { k: 0.5 } },
              { id: 'sm123', type: 'sdfSmoothUnion', position: { x: 840, y: 210 },
                inputs: {
                  a: { type: 'float', label: 'A', connection: { nodeId: 'sm12', outputKey: 'dist' } },
                  b: { type: 'float', label: 'B', connection: { nodeId: 's3',   outputKey: 'dist' } },
                },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { k: 0.48 } },
              { id: 'sm1234', type: 'sdfSmoothUnion', position: { x: 1040, y: 310 },
                inputs: {
                  a: { type: 'float', label: 'A', connection: { nodeId: 'sm123', outputKey: 'dist' } },
                  b: { type: 'float', label: 'B', connection: { nodeId: 's4',    outputKey: 'dist' } },
                },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { k: 0.45 } },
              { id: 'sm12345', type: 'sdfSmoothUnion', position: { x: 1240, y: 400 },
                inputs: {
                  a: { type: 'float', label: 'A', connection: { nodeId: 'sm1234', outputKey: 'dist' } },
                  b: { type: 'float', label: 'B', connection: { nodeId: 's5',     outputKey: 'dist' } },
                },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { k: 0.42 } },
            ],
            outputNodeId: 'sm12345', outputKey: 'dist', inputPorts: [], outputPorts: [],
          },
        },
      },
      {
        id: 'mlg_4', type: 'marchLoopGroup', position: { x: 820, y: 200 },
        inputs: {
          ro:    { type: 'vec3',    label: 'Ray Origin', connection: { nodeId: 'cam_2',   outputKey: 'ro'    } },
          rd:    { type: 'vec3',    label: 'Ray Dir',    connection: { nodeId: 'cam_2',   outputKey: 'rd'    } },
          scene: { type: 'scene3d', label: 'Scene',      connection: { nodeId: 'scene_3', outputKey: 'scene' } },
          uv:    { type: 'vec2',  label: 'UV' },
          time:  { type: 'float', label: 'Time' },
        },
        outputs: { color: { type: 'vec3', label: 'Color' }, dist: { type: 'float', label: 'Distance' }, depth: { type: 'float', label: 'Depth' }, normal: { type: 'vec3', label: 'Normal' }, iter: { type: 'float', label: 'Iter' }, iterCount: { type: 'float', label: 'Iter Count' }, hit: { type: 'float', label: 'Hit' }, pos: { type: 'vec3', label: 'Hit Pos' } },
        params: { maxSteps: 80, maxDist: 12.0, stepScale: 1.0, volumetric: false, passthrough: 0.1, jitter: 0.0, bgR: 0.04, bgG: 0.05, bgB: 0.14, albedoR: 0.2, albedoG: 0.2, albedoB: 0.3, subgraph: { nodes: [], inputPorts: [], outputPorts: [] } },
      },
      {
        id: 'glass_5', type: 'glass3d', position: { x: 1100, y: 200 },
        inputs: {
          rayDir:    { type: 'vec3',  label: 'Ray Dir',    connection: { nodeId: 'cam_2', outputKey: 'rd'     } },
          normal:    { type: 'vec3',  label: 'Normal',     connection: { nodeId: 'mlg_4', outputKey: 'normal' } },
          hit:       { type: 'float', label: 'Hit',        connection: { nodeId: 'mlg_4', outputKey: 'hit'    } },
          bgColor:   { type: 'vec3',  label: 'Background' },
          tintColor: { type: 'vec3',  label: 'Tint'       },
          lightDir:  { type: 'vec3',  label: 'Light Dir'  },
        },
        outputs: { color: { type: 'vec3', label: 'Glass Color' } },
        params: { ior: 1.4, fresnelPow: 2.5, dispersion: 0.1, samples: 10.0, shininess: 40.0, diffuseness: 0.3, saturation: 2.6 },
      },
      { id: 'tone_6', type: 'toneMap', position: { x: 1340, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'glass_5', outputKey: 'color' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } }, params: { mode: 'aces' } },
      { id: 'out_7', type: 'output', position: { x: 1560, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'tone_6', outputKey: 'color' } } },
        outputs: {}, params: {} },
    ],
  },

  // ── Halftone Noise — FBM luma drives dot size, palette colors the dots ──────
  halftoneNoise: {
    label: 'Halftone Noise',
    counter: 10,
    nodes: [
      { id: 'uv_0',     type: 'uv',           position: { x: 60,   y: 280 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1',   type: 'time',          position: { x: 60,   y: 460 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      { id: 'fbm_2',    type: 'fbm',           position: { x: 280,  y: 280 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { value: { type: 'float', label: 'Value' }, uv: { type: 'vec2', label: 'UV (pass-through)' } },
        params: { octaves: 4, lacunarity: 2.0, gain: 0.5, scale: 1.2, time_scale: 0.25 } },
      { id: 'f2v_3',    type: 'floatToVec3',   position: { x: 490,  y: 280 },
        inputs: { input: { type: 'float', label: 'Float', connection: { nodeId: 'fbm_2', outputKey: 'value' } } },
        outputs: { rgb: { type: 'vec3', label: 'Color' } }, params: {} },
      { id: 'lrad_4',   type: 'lumaRadius',    position: { x: 700,  y: 280 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'f2v_3', outputKey: 'rgb' } } },
        outputs: { radius: { type: 'float', label: 'Radius' }, luma: { type: 'float', label: 'Luma' } },
        params: { baseRadius: 0.44, minScale: 0.05, maxScale: 0.92 } },
      { id: 'guv_5',    type: 'gridUV',        position: { x: 280,  y: 100 },
        inputs: { uv: { type: 'vec2', label: 'UV', connection: { nodeId: 'uv_0', outputKey: 'uv' } } },
        outputs: { cellUV: { type: 'vec2', label: 'Cell UV' }, cellIndex: { type: 'vec2', label: 'Cell Index' } },
        params: { scale: 16, stagger: 0 } },
      { id: 'dot_6',    type: 'dotMask',       position: { x: 890,  y: 180 },
        inputs: {
          cellUV: { type: 'vec2',  label: 'Cell UV', connection: { nodeId: 'guv_5',  outputKey: 'cellUV' } },
          radius: { type: 'float', label: 'Radius',  connection: { nodeId: 'lrad_4', outputKey: 'radius' } },
        },
        outputs: { mask: { type: 'float', label: 'Mask' } },
        params: { radius: 0.38, softness: 0.01 } },
      { id: 'pal_7',    type: 'palette',       position: { x: 490,  y: 480 },
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'fbm_2', outputKey: 'value' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { offset: [0.5, 0.5, 0.5], amplitude: [0.5, 0.5, 0.5], freq: [1.0, 1.0, 1.0], phase: [0.0, 0.33, 0.67] } },
      { id: 'mul_8',    type: 'multiplyVec3',  position: { x: 1090, y: 280 },
        inputs: {
          color: { type: 'vec3',  label: 'Color', connection: { nodeId: 'pal_7', outputKey: 'color' } },
          scale: { type: 'float', label: 'Scale', connection: { nodeId: 'dot_6', outputKey: 'mask'  } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } }, params: {} },
      { id: 'out_9',    type: 'output',        position: { x: 1300, y: 280 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'mul_8', outputKey: 'result' } } },
        outputs: {}, params: {} },
    ],
  },

  // ── CMYK Halftone — palette noise run through 4-channel CMYK dots ────────
  cmykNoise: {
    label: 'CMYK Halftone',
    counter: 6,
    nodes: [
      { id: 'uv_0',    type: 'uv',          position: { x: 60,  y: 240 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1',  type: 'time',         position: { x: 60,  y: 420 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      { id: 'fbm_2',   type: 'fbm',          position: { x: 280, y: 240 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { value: { type: 'float', label: 'Value' }, uv: { type: 'vec2', label: 'UV (pass-through)' } },
        params: { octaves: 4, lacunarity: 2.0, gain: 0.5, scale: 1.5, time_scale: 0.18 } },
      { id: 'pal_3',   type: 'palette',      position: { x: 490, y: 240 },
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'fbm_2', outputKey: 'value' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { offset: [0.5, 0.5, 0.5], amplitude: [0.5, 0.5, 0.5], freq: [1.0, 1.0, 1.0], phase: [0.0, 0.1, 0.2] } },
      { id: 'cmyk_4',  type: 'cmykHalftone', position: { x: 720, y: 240 },
        inputs: {
          color: { type: 'vec3', label: 'Color', connection: { nodeId: 'pal_3', outputKey: 'color' } },
          uv:    { type: 'vec2', label: 'UV',    connection: { nodeId: 'uv_0',  outputKey: 'uv'   } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } },
        params: { gridSize: 24, dotRadius: 0.48, softness: 0.01, paperColor: [0.97, 0.95, 0.90], angleC: 15, angleM: 75, angleY: 0, angleK: 45 } },
      { id: 'out_5',   type: 'output',       position: { x: 960, y: 240 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'cmyk_4', outputKey: 'result' } } },
        outputs: {}, params: {} },
    ],
  },

  // ── Ring Halftone — FBM luma drives ring radius via sdfMask + ringSDF ───────
  ringHalftone: {
    label: 'Ring Halftone',
    counter: 11,
    nodes: [
      { id: 'uv_0',   type: 'uv',          position: { x: 60,   y: 280 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time',         position: { x: 60,   y: 480 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      { id: 'fbm_2',  type: 'fbm',          position: { x: 280,  y: 280 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { value: { type: 'float', label: 'Value' }, uv: { type: 'vec2', label: 'UV (pass-through)' } },
        params: { octaves: 4, lacunarity: 2.0, gain: 0.5, scale: 1.2, time_scale: 0.2 } },
      { id: 'f2v_3',  type: 'floatToVec3',  position: { x: 490,  y: 280 },
        inputs: { input: { type: 'float', label: 'Float', connection: { nodeId: 'fbm_2', outputKey: 'value' } } },
        outputs: { rgb: { type: 'vec3', label: 'Color' } }, params: {} },
      { id: 'lrad_4', type: 'lumaRadius',   position: { x: 680,  y: 280 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'f2v_3', outputKey: 'rgb' } } },
        outputs: { radius: { type: 'float', label: 'Radius' }, luma: { type: 'float', label: 'Luma' } },
        params: { baseRadius: 0.28, minScale: 0.04, maxScale: 0.88 } },
      { id: 'guv_5',  type: 'gridUV',       position: { x: 280,  y: 100 },
        inputs: { uv: { type: 'vec2', label: 'UV', connection: { nodeId: 'uv_0', outputKey: 'uv' } } },
        outputs: { cellUV: { type: 'vec2', label: 'Cell UV' }, cellIndex: { type: 'vec2', label: 'Cell Index' } },
        params: { scale: 10, stagger: 1 } },
      { id: 'ring_6', type: 'ringSDF',      position: { x: 870,  y: 180 },
        inputs: {
          position: { type: 'vec2',  label: 'Position', connection: { nodeId: 'guv_5',  outputKey: 'cellUV' } },
          radius:   { type: 'float', label: 'Radius',   connection: { nodeId: 'lrad_4', outputKey: 'radius' } },
        },
        outputs: { distance: { type: 'float', label: 'Distance' } },
        params: { radius: 0.25, posX: 0.5, posY: 0.5 } },
      { id: 'sdmk_7', type: 'sdfMask',      position: { x: 1070, y: 180 },
        inputs: { sdf: { type: 'float', label: 'SDF', connection: { nodeId: 'ring_6', outputKey: 'distance' } } },
        outputs: { mask: { type: 'float', label: 'Mask' } },
        params: { threshold: 0.04, softness: 0.01 } },
      { id: 'pal_8',  type: 'palette',      position: { x: 490,  y: 480 },
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'fbm_2', outputKey: 'value' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { offset: [0.5, 0.5, 0.5], amplitude: [0.5, 0.5, 0.5], freq: [1.0, 1.0, 1.0], phase: [0.0, 0.33, 0.67] } },
      { id: 'mul_9',  type: 'multiplyVec3', position: { x: 1240, y: 280 },
        inputs: {
          color: { type: 'vec3',  label: 'Color', connection: { nodeId: 'pal_8',  outputKey: 'color' } },
          scale: { type: 'float', label: 'Scale', connection: { nodeId: 'sdmk_7', outputKey: 'mask'  } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } }, params: {} },
      { id: 'out_10', type: 'output',       position: { x: 1440, y: 280 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'mul_9', outputKey: 'result' } } },
        outputs: {}, params: {} },
    ],
  },

  // ── GPU Particle Pipeline Examples ───────────────────────────────────────────

  gpuParticleGalaxy: {
    label: 'GPU Particles: Galaxy',
    counter: 7,
    nodes: [
      { id: 'gal_v3',   type: 'vec3Const', position: { x: 60, y: 340 },
        inputs: {}, outputs: { val: { type: 'vec3', label: 'Vec3' } }, params: { x: 0, y: 0, z: 0 } },
      { id: 'gal_out',  type: 'output',    position: { x: 280, y: 340 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'gal_v3', outputKey: 'val' } } },
        outputs: {}, params: {} },
      { id: 'gal_init', type: 'pInit',     position: { x: 60, y: 120 },
        inputs: {}, outputs: { particles: { type: 'particle', label: 'Particles' } },
        params: { shape: 0, count: 5000, radius: 1.2 } },
      { id: 'gal_rot',  type: 'pRotate',   position: { x: 300, y: 120 },
        inputs: { particles: { type: 'particle', label: 'Particles', connection: { nodeId: 'gal_init', outputKey: 'particles' } } },
        outputs: { particles: { type: 'particle', label: 'Particles' } },
        params: { axis: 1, rotSpeed: 0.25, rotVariance: 3.5, twirl: 0.8 } },
      { id: 'gal_col',  type: 'pColorDist', position: { x: 540, y: 120 },
        inputs: { particles: { type: 'particle', label: 'Particles', connection: { nodeId: 'gal_rot', outputKey: 'particles' } } },
        outputs: { particles: { type: 'particle', label: 'Particles' } },
        params: { colorCenterR: 1.0, colorCenterG: 0.75, colorCenterB: 0.35, colorEdgeR: 0.25, colorEdgeG: 0.45, colorEdgeB: 1.0, mixPow: 0.6 } },
      { id: 'gal_sz',   type: 'pSize',     position: { x: 780, y: 120 },
        inputs: { particles: { type: 'particle', label: 'Particles', connection: { nodeId: 'gal_col', outputKey: 'particles' } } },
        outputs: { particles: { type: 'particle', label: 'Particles' } },
        params: { sizeBase: 15.0, sizeByDist: 12.0, sizeAttenuation: true } },
      { id: 'gal_rend', type: 'pRender',   position: { x: 1020, y: 120 },
        inputs: { particles: { type: 'particle', label: 'Particles', connection: { nodeId: 'gal_sz', outputKey: 'particles' } } },
        outputs: {}, params: { opacity: 1.0, softness: 4.0 } },
    ],
  },

  gpuParticleBreathingBall: {
    label: 'GPU Particles: Breathing Ball',
    counter: 6,
    nodes: [
      { id: 'bb_v3',   type: 'vec3Const', position: { x: 60, y: 340 },
        inputs: {}, outputs: { val: { type: 'vec3', label: 'Vec3' } }, params: { x: 0, y: 0, z: 0 } },
      { id: 'bb_out',  type: 'output',    position: { x: 280, y: 340 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'bb_v3', outputKey: 'val' } } },
        outputs: {}, params: {} },
      { id: 'bb_init', type: 'pInit',     position: { x: 60, y: 120 },
        inputs: {}, outputs: { particles: { type: 'particle', label: 'Particles' } },
        params: { shape: 1, count: 4000, radius: 1.0 } },
      { id: 'bb_wav',  type: 'pWave',     position: { x: 300, y: 120 },
        inputs: { particles: { type: 'particle', label: 'Particles', connection: { nodeId: 'bb_init', outputKey: 'particles' } } },
        outputs: { particles: { type: 'particle', label: 'Particles' } },
        params: { waveAmp: 0.25, waveFreq: 2.5, waveSpeed: 1.2, waveAxis: 0 } },
      { id: 'bb_col',  type: 'pColorDist', position: { x: 540, y: 120 },
        inputs: { particles: { type: 'particle', label: 'Particles', connection: { nodeId: 'bb_wav', outputKey: 'particles' } } },
        outputs: { particles: { type: 'particle', label: 'Particles' } },
        params: { colorCenterR: 0.3, colorCenterG: 0.9, colorCenterB: 1.0, colorEdgeR: 0.6, colorEdgeG: 0.2, colorEdgeB: 1.0, mixPow: 0.4 } },
      { id: 'bb_rend', type: 'pRender',   position: { x: 780, y: 120 },
        inputs: { particles: { type: 'particle', label: 'Particles', connection: { nodeId: 'bb_col', outputKey: 'particles' } } },
        outputs: {}, params: { opacity: 0.9, softness: 5.0 } },
    ],
  },

  gpuParticleSpiralNebula: {
    label: 'GPU Particles: Spiral Nebula',
    counter: 8,
    nodes: [
      { id: 'sn_v3',   type: 'vec3Const', position: { x: 60, y: 340 },
        inputs: {}, outputs: { val: { type: 'vec3', label: 'Vec3' } }, params: { x: 0.02, y: 0.0, z: 0.05 } },
      { id: 'sn_out',  type: 'output',    position: { x: 280, y: 340 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'sn_v3', outputKey: 'val' } } },
        outputs: {}, params: {} },
      { id: 'sn_init', type: 'pInit',     position: { x: 60, y: 120 },
        inputs: {}, outputs: { particles: { type: 'particle', label: 'Particles' } },
        params: { shape: 5, count: 6000, radius: 1.4 } },
      { id: 'sn_rot',  type: 'pRotate',   position: { x: 300, y: 120 },
        inputs: { particles: { type: 'particle', label: 'Particles', connection: { nodeId: 'sn_init', outputKey: 'particles' } } },
        outputs: { particles: { type: 'particle', label: 'Particles' } },
        params: { axis: 1, rotSpeed: 0.2, rotVariance: 4.0, twirl: 1.5 } },
      { id: 'sn_wav',  type: 'pWave',     position: { x: 540, y: 120 },
        inputs: { particles: { type: 'particle', label: 'Particles', connection: { nodeId: 'sn_rot', outputKey: 'particles' } } },
        outputs: { particles: { type: 'particle', label: 'Particles' } },
        params: { waveAmp: 0.08, waveFreq: 6.0, waveSpeed: 2.0, waveAxis: 2 } },
      { id: 'sn_col',  type: 'pColorDist', position: { x: 780, y: 120 },
        inputs: { particles: { type: 'particle', label: 'Particles', connection: { nodeId: 'sn_wav', outputKey: 'particles' } } },
        outputs: { particles: { type: 'particle', label: 'Particles' } },
        params: { colorCenterR: 1.0, colorCenterG: 0.82, colorCenterB: 0.3, colorEdgeR: 1.0, colorEdgeG: 0.3, colorEdgeB: 0.7, mixPow: 0.7 } },
      { id: 'sn_sz',   type: 'pSize',     position: { x: 1020, y: 120 },
        inputs: { particles: { type: 'particle', label: 'Particles', connection: { nodeId: 'sn_col', outputKey: 'particles' } } },
        outputs: { particles: { type: 'particle', label: 'Particles' } },
        params: { sizeBase: 12.0, sizeByDist: 8.0, sizeAttenuation: true } },
      { id: 'sn_rend', type: 'pRender',   position: { x: 1260, y: 120 },
        inputs: { particles: { type: 'particle', label: 'Particles', connection: { nodeId: 'sn_sz', outputKey: 'particles' } } },
        outputs: {}, params: { opacity: 1.0, softness: 3.0 } },
    ],
  },

  gpuParticleRingVortex: {
    label: 'GPU Particles: Ring Vortex',
    counter: 6,
    nodes: [
      { id: 'rv_v3',   type: 'vec3Const', position: { x: 60, y: 340 },
        inputs: {}, outputs: { val: { type: 'vec3', label: 'Vec3' } }, params: { x: 0, y: 0, z: 0 } },
      { id: 'rv_out',  type: 'output',    position: { x: 280, y: 340 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'rv_v3', outputKey: 'val' } } },
        outputs: {}, params: {} },
      { id: 'rv_init', type: 'pInit',     position: { x: 60, y: 120 },
        inputs: {}, outputs: { particles: { type: 'particle', label: 'Particles' } },
        params: { shape: 4, count: 3000, radius: 1.3 } },
      { id: 'rv_rot',  type: 'pRotate',   position: { x: 300, y: 120 },
        inputs: { particles: { type: 'particle', label: 'Particles', connection: { nodeId: 'rv_init', outputKey: 'particles' } } },
        outputs: { particles: { type: 'particle', label: 'Particles' } },
        params: { axis: 1, rotSpeed: 0.6, rotVariance: 0.5, twirl: 3.0 } },
      { id: 'rv_wav',  type: 'pWave',     position: { x: 540, y: 120 },
        inputs: { particles: { type: 'particle', label: 'Particles', connection: { nodeId: 'rv_rot', outputKey: 'particles' } } },
        outputs: { particles: { type: 'particle', label: 'Particles' } },
        params: { waveAmp: 0.2, waveFreq: 10.0, waveSpeed: 2.5, waveAxis: 1 } },
      { id: 'rv_rend', type: 'pRender',   position: { x: 780, y: 120 },
        inputs: { particles: { type: 'particle', label: 'Particles', connection: { nodeId: 'rv_wav', outputKey: 'particles' } } },
        outputs: {}, params: { opacity: 1.0, softness: 2.5 } },
    ],
  },

  // ── Glass Scene: Orb + Pillars ────────────────────────────────────────────────
  glassSceneOrbPillars: {
    label: 'Glass Scene: Orb + Pillars',
    counter: 9,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 60,  y: 180 }, inputs: {}, outputs: { uv:   { type: 'vec2',  label: 'UV'   } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 60,  y: 340 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'cam_2', type: 'marchCamera', position: { x: 280, y: 260 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { ro: { type: 'vec3', label: 'Ray Origin' }, rd: { type: 'vec3', label: 'Ray Dir' } },
        params: { camDist: 3.5, camAngle: 0.4, camElevation: 0.25, rotSpeed: 0.07, fov: 1.4, aperture: 0.0, focalDist: 3.5 },
      },
      {
        id: 'fg_3', type: 'sceneGroup', position: { x: 560, y: 160 },
        inputs: {}, outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: 'Glass Orb',
          subgraph: {
            nodes: [
              { id: 'sp', type: 'scenePos', position: { x: 80,  y: 150 }, inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'sdf', type: 'sphereSDF3D', position: { x: 280, y: 150 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { radius: 0.65 } },
            ],
            outputNodeId: 'sdf', outputKey: 'dist', inputPorts: [], outputPorts: [],
          },
        },
      },
      {
        id: 'bg_4', type: 'sceneGroup', position: { x: 560, y: 400 },
        inputs: {}, outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: 'Pillars',
          subgraph: {
            nodes: [
              { id: 'sp',   type: 'scenePos',    position: { x: 80,  y: 200 }, inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'tr1',  type: 'translate3D',  position: { x: 280, y: 100 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp', outputKey: 'pos' } } },
                outputs: { pos: { type: 'vec3', label: 'Position' } }, params: { tx: -1.1, ty: 0.0, tz: 0.0 } },
              { id: 'p1',   type: 'boxSDF3D',     position: { x: 480, y: 100 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'tr1', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { bx: 0.18, by: 1.8, bz: 0.18 } },
              { id: 'tr2',  type: 'translate3D',  position: { x: 280, y: 300 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp', outputKey: 'pos' } } },
                outputs: { pos: { type: 'vec3', label: 'Position' } }, params: { tx: 1.1, ty: 0.0, tz: 0.0 } },
              { id: 'p2',   type: 'boxSDF3D',     position: { x: 480, y: 300 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'tr2', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { bx: 0.18, by: 1.8, bz: 0.18 } },
              { id: 'u1',   type: 'sdfUnion',     position: { x: 680, y: 200 },
                inputs: {
                  a: { type: 'float', label: 'A', connection: { nodeId: 'p1', outputKey: 'dist' } },
                  b: { type: 'float', label: 'B', connection: { nodeId: 'p2', outputKey: 'dist' } },
                },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: {} },
            ],
            outputNodeId: 'u1', outputKey: 'dist', inputPorts: [], outputPorts: [],
          },
        },
      },
      {
        id: 'gs_5', type: 'glassScene', position: { x: 900, y: 280 },
        inputs: {
          ro:         { type: 'vec3',    label: 'Ray Origin', connection: { nodeId: 'cam_2', outputKey: 'ro'    } },
          rd:         { type: 'vec3',    label: 'Ray Dir',    connection: { nodeId: 'cam_2', outputKey: 'rd'    } },
          foreground: { type: 'scene3d', label: 'Glass Geo',  connection: { nodeId: 'fg_3',  outputKey: 'scene' } },
          background: { type: 'scene3d', label: 'Background', connection: { nodeId: 'bg_4',  outputKey: 'scene' } },
          bgAlbedo:   { type: 'vec3',    label: 'BG Color'   },
          tintColor:  { type: 'vec3',    label: 'Glass Tint' },
          lightDir:   { type: 'vec3',    label: 'Light Dir'  },
        },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { ior: 1.5, fresnelPow: 3.5, dispersion: 0.05, shininess: 100.0, diffuseness: 0.55, saturation: 1.7 },
      },
      { id: 'tone_6', type: 'toneMap', position: { x: 1140, y: 280 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'gs_5', outputKey: 'color' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } }, params: { mode: 'aces' } },
      { id: 'out_7', type: 'output', position: { x: 1360, y: 280 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'tone_6', outputKey: 'color' } } },
        outputs: {}, params: {} },
    ],
  },

  // ── Glass Scene: Torus + Smooth Blobs ────────────────────────────────────────
  glassSceneTorusBlobs: {
    label: 'Glass Scene: Torus + Blobs',
    counter: 9,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 60,  y: 180 }, inputs: {}, outputs: { uv:   { type: 'vec2',  label: 'UV'   } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 60,  y: 340 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'cam_2', type: 'marchCamera', position: { x: 280, y: 260 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { ro: { type: 'vec3', label: 'Ray Origin' }, rd: { type: 'vec3', label: 'Ray Dir' } },
        params: { camDist: 4.0, camAngle: 0.5, camElevation: 0.35, rotSpeed: 0.06, fov: 1.4, aperture: 0.0, focalDist: 4.0 },
      },
      {
        id: 'fg_3', type: 'sceneGroup', position: { x: 560, y: 160 },
        inputs: {}, outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: 'Glass Torus',
          subgraph: {
            nodes: [
              { id: 'sp',  type: 'scenePos',   position: { x: 80,  y: 150 }, inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'sdf', type: 'torusSDF3D', position: { x: 280, y: 150 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { R: 0.65, r: 0.22 } },
            ],
            outputNodeId: 'sdf', outputKey: 'dist', inputPorts: [], outputPorts: [],
          },
        },
      },
      {
        id: 'bg_4', type: 'sceneGroup', position: { x: 560, y: 400 },
        inputs: {}, outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: 'Smooth Blobs',
          subgraph: {
            nodes: [
              { id: 'sp',  type: 'scenePos',       position: { x: 80,  y: 250 }, inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 's1',  type: 'sphereSDF3D',     position: { x: 280, y: 100 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { radius: 0.38 } },
              { id: 'tr2', type: 'translate3D',     position: { x: 280, y: 250 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp', outputKey: 'pos' } } },
                outputs: { pos: { type: 'vec3', label: 'Position' } }, params: { tx: 0.85, ty: -0.3, tz: 0.4 } },
              { id: 's2',  type: 'sphereSDF3D',     position: { x: 480, y: 250 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'tr2', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { radius: 0.3 } },
              { id: 'tr3', type: 'translate3D',     position: { x: 280, y: 400 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp', outputKey: 'pos' } } },
                outputs: { pos: { type: 'vec3', label: 'Position' } }, params: { tx: -0.7, ty: 0.2, tz: 0.3 } },
              { id: 's3',  type: 'sphereSDF3D',     position: { x: 480, y: 400 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'tr3', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { radius: 0.26 } },
              { id: 'u1',  type: 'sdfSmoothUnion',  position: { x: 680, y: 175 },
                inputs: {
                  a: { type: 'float', label: 'A', connection: { nodeId: 's1', outputKey: 'dist' } },
                  b: { type: 'float', label: 'B', connection: { nodeId: 's2', outputKey: 'dist' } },
                },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { k: 0.35 } },
              { id: 'u2',  type: 'sdfSmoothUnion',  position: { x: 880, y: 290 },
                inputs: {
                  a: { type: 'float', label: 'A', connection: { nodeId: 'u1', outputKey: 'dist' } },
                  b: { type: 'float', label: 'B', connection: { nodeId: 's3', outputKey: 'dist' } },
                },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { k: 0.3 } },
            ],
            outputNodeId: 'u2', outputKey: 'dist', inputPorts: [], outputPorts: [],
          },
        },
      },
      {
        id: 'gs_5', type: 'glassScene', position: { x: 900, y: 280 },
        inputs: {
          ro:         { type: 'vec3',    label: 'Ray Origin', connection: { nodeId: 'cam_2', outputKey: 'ro'    } },
          rd:         { type: 'vec3',    label: 'Ray Dir',    connection: { nodeId: 'cam_2', outputKey: 'rd'    } },
          foreground: { type: 'scene3d', label: 'Glass Geo',  connection: { nodeId: 'fg_3',  outputKey: 'scene' } },
          background: { type: 'scene3d', label: 'Background', connection: { nodeId: 'bg_4',  outputKey: 'scene' } },
          bgAlbedo:   { type: 'vec3',    label: 'BG Color'   },
          tintColor:  { type: 'vec3',    label: 'Glass Tint' },
          lightDir:   { type: 'vec3',    label: 'Light Dir'  },
        },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { ior: 1.48, fresnelPow: 4.0, dispersion: 0.06, shininess: 90.0, diffuseness: 0.5, saturation: 1.8 },
      },
      { id: 'tone_6', type: 'toneMap', position: { x: 1140, y: 280 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'gs_5', outputKey: 'color' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } }, params: { mode: 'aces' } },
      { id: 'out_7', type: 'output', position: { x: 1360, y: 280 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'tone_6', outputKey: 'color' } } },
        outputs: {}, params: {} },
    ],
  },

  // ── Glass Scene: Lens Void ────────────────────────────────────────────────────
  // ── Glass 3D: Iridescent Rim ─────────────────────────────────────────────────
  glassIridescentRim: {
    label: 'Glass: Iridescent Rim',
    counter: 10,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 60,  y: 180 }, inputs: {}, outputs: { uv:   { type: 'vec2',  label: 'UV'   } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 60,  y: 340 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'cam_2', type: 'marchCamera', position: { x: 280, y: 260 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { ro: { type: 'vec3', label: 'Ray Origin' }, rd: { type: 'vec3', label: 'Ray Dir' } },
        params: { camDist: 3.0, camAngle: 0.4, camElevation: 0.2, rotSpeed: 0.1, fov: 1.4, aperture: 0.0, focalDist: 3.0 },
      },
      {
        id: 'scene_3', type: 'sceneGroup', position: { x: 560, y: 340 },
        inputs: {}, outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: 'Glass Orb',
          subgraph: {
            nodes: [
              { id: 'sp',  type: 'scenePos',    position: { x: 80,  y: 150 }, inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'sdf', type: 'sphereSDF3D', position: { x: 280, y: 150 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { radius: 0.8 } },
            ],
            outputNodeId: 'sdf', outputKey: 'dist', inputPorts: [], outputPorts: [],
          },
        },
      },
      {
        id: 'mlg_4', type: 'marchLoopGroup', position: { x: 820, y: 220 },
        inputs: {
          ro:    { type: 'vec3',    label: 'Ray Origin', connection: { nodeId: 'cam_2',   outputKey: 'ro'    } },
          rd:    { type: 'vec3',    label: 'Ray Dir',    connection: { nodeId: 'cam_2',   outputKey: 'rd'    } },
          scene: { type: 'scene3d', label: 'Scene',      connection: { nodeId: 'scene_3', outputKey: 'scene' } },
          uv: { type: 'vec2', label: 'UV' }, time: { type: 'float', label: 'Time' },
        },
        outputs: { color: { type: 'vec3', label: 'Color' }, dist: { type: 'float', label: 'Distance' }, depth: { type: 'float', label: 'Depth' }, normal: { type: 'vec3', label: 'Normal' }, iter: { type: 'float', label: 'Iter' }, iterCount: { type: 'float', label: 'Iter Count' }, hit: { type: 'float', label: 'Hit' }, pos: { type: 'vec3', label: 'Hit Pos' } },
        params: { maxSteps: 80, maxDist: 12.0, stepScale: 1.0, volumetric: false, passthrough: 0.1, jitter: 0.0, bgR: 0.03, bgG: 0.04, bgB: 0.12, albedoR: 0.15, albedoG: 0.15, albedoB: 0.25, subgraph: { nodes: [], inputPorts: [], outputPorts: [] } },
      },
      {
        id: 'glass_5', type: 'glass3d', position: { x: 1080, y: 220 },
        inputs: {
          rayDir:    { type: 'vec3',  label: 'Ray Dir',    connection: { nodeId: 'cam_2',   outputKey: 'rd'     } },
          normal:    { type: 'vec3',  label: 'Normal',     connection: { nodeId: 'mlg_4',   outputKey: 'normal' } },
          hit:       { type: 'float', label: 'Hit',        connection: { nodeId: 'mlg_4',   outputKey: 'hit'    } },
          bgColor: { type: 'vec3', label: 'Background' }, tintColor: { type: 'vec3', label: 'Tint' }, lightDir: { type: 'vec3', label: 'Light Dir' },
        },
        outputs: { color: { type: 'vec3', label: 'Glass Color' }, fresnel: { type: 'float', label: 'Fresnel' }, refractedColor: { type: 'vec3', label: 'Refracted' }, reflectedColor: { type: 'vec3', label: 'Reflected' } },
        params: { ior: 1.5, fresnelPow: 3.0, dispersion: 0.04, samples: 8.0, shininess: 80.0, diffuseness: 0.4, saturation: 1.8 },
      },
      // Palette driven by fresnel → iridescent rim colors
      {
        id: 'pal_6', type: 'palette', position: { x: 1080, y: 400 },
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'glass_5', outputKey: 'fresnel' } }, offset_r: { type: 'float', label: 'offset.r' }, offset_g: { type: 'float', label: 'offset.g' }, offset_b: { type: 'float', label: 'offset.b' }, amplitude_r: { type: 'float', label: 'amplitude.r' }, amplitude_g: { type: 'float', label: 'amplitude.g' }, amplitude_b: { type: 'float', label: 'amplitude.b' }, freq_r: { type: 'float', label: 'freq.r' }, freq_g: { type: 'float', label: 'freq.g' }, freq_b: { type: 'float', label: 'freq.b' }, phase_r: { type: 'float', label: 'phase.r' }, phase_g: { type: 'float', label: 'phase.g' }, phase_b: { type: 'float', label: 'phase.b' } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { offset: [0.5,0.5,0.5], amplitude: [0.5,0.5,0.5], freq: [1.0,1.0,1.0], phase: [0.0, 0.333, 0.667] },
      },
      // Scale palette by fresnel so it only shows at the rim
      {
        id: 'mul_7', type: 'multiplyVec3', position: { x: 1300, y: 400 },
        inputs: {
          color: { type: 'vec3',  label: 'Color', connection: { nodeId: 'pal_6',   outputKey: 'color'   } },
          scale: { type: 'float', label: 'Scale', connection: { nodeId: 'glass_5', outputKey: 'fresnel' } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } }, params: {},
      },
      // Add iridescent rim on top of refracted color
      {
        id: 'add_8', type: 'addVec3', position: { x: 1300, y: 260 },
        inputs: {
          a: { type: 'vec3', label: 'A', connection: { nodeId: 'glass_5', outputKey: 'refractedColor' } },
          b: { type: 'vec3', label: 'B', connection: { nodeId: 'mul_7',   outputKey: 'result'         } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } }, params: {},
      },
      { id: 'tone_9', type: 'toneMap', position: { x: 1520, y: 260 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'add_8', outputKey: 'result' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } }, params: { mode: 'aces' } },
      { id: 'out_10', type: 'output', position: { x: 1740, y: 260 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'tone_9', outputKey: 'color' } } },
        outputs: {}, params: {} },
    ],
  },

  // ── Glass 3D: Hue-Rotated Reflection ─────────────────────────────────────────
  glassTintedReflection: {
    label: 'Glass: Tinted Reflection',
    counter: 10,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 60,  y: 180 }, inputs: {}, outputs: { uv:   { type: 'vec2',  label: 'UV'   } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 60,  y: 340 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'cam_2', type: 'marchCamera', position: { x: 280, y: 260 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { ro: { type: 'vec3', label: 'Ray Origin' }, rd: { type: 'vec3', label: 'Ray Dir' } },
        params: { camDist: 3.5, camAngle: 0.3, camElevation: 0.25, rotSpeed: 0.08, fov: 1.4, aperture: 0.0, focalDist: 3.5 },
      },
      {
        id: 'scene_3', type: 'sceneGroup', position: { x: 560, y: 340 },
        inputs: {}, outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: 'Glass Torus',
          subgraph: {
            nodes: [
              { id: 'sp',  type: 'scenePos',   position: { x: 80,  y: 150 }, inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'sdf', type: 'torusSDF3D', position: { x: 280, y: 150 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { R: 0.65, r: 0.25 } },
            ],
            outputNodeId: 'sdf', outputKey: 'dist', inputPorts: [], outputPorts: [],
          },
        },
      },
      {
        id: 'mlg_4', type: 'marchLoopGroup', position: { x: 820, y: 220 },
        inputs: {
          ro:    { type: 'vec3',    label: 'Ray Origin', connection: { nodeId: 'cam_2',   outputKey: 'ro'    } },
          rd:    { type: 'vec3',    label: 'Ray Dir',    connection: { nodeId: 'cam_2',   outputKey: 'rd'    } },
          scene: { type: 'scene3d', label: 'Scene',      connection: { nodeId: 'scene_3', outputKey: 'scene' } },
          uv: { type: 'vec2', label: 'UV' }, time: { type: 'float', label: 'Time' },
        },
        outputs: { color: { type: 'vec3', label: 'Color' }, dist: { type: 'float', label: 'Distance' }, depth: { type: 'float', label: 'Depth' }, normal: { type: 'vec3', label: 'Normal' }, iter: { type: 'float', label: 'Iter' }, iterCount: { type: 'float', label: 'Iter Count' }, hit: { type: 'float', label: 'Hit' }, pos: { type: 'vec3', label: 'Hit Pos' } },
        params: { maxSteps: 80, maxDist: 12.0, stepScale: 1.0, volumetric: false, passthrough: 0.1, jitter: 0.0, bgR: 0.04, bgG: 0.04, bgB: 0.10, albedoR: 0.2, albedoG: 0.2, albedoB: 0.3, subgraph: { nodes: [], inputPorts: [], outputPorts: [] } },
      },
      {
        id: 'glass_5', type: 'glass3d', position: { x: 1080, y: 220 },
        inputs: {
          rayDir:    { type: 'vec3',  label: 'Ray Dir',    connection: { nodeId: 'cam_2',   outputKey: 'rd'     } },
          normal:    { type: 'vec3',  label: 'Normal',     connection: { nodeId: 'mlg_4',   outputKey: 'normal' } },
          hit:       { type: 'float', label: 'Hit',        connection: { nodeId: 'mlg_4',   outputKey: 'hit'    } },
          bgColor: { type: 'vec3', label: 'Background' }, tintColor: { type: 'vec3', label: 'Tint' }, lightDir: { type: 'vec3', label: 'Light Dir' },
        },
        outputs: { color: { type: 'vec3', label: 'Glass Color' }, fresnel: { type: 'float', label: 'Fresnel' }, refractedColor: { type: 'vec3', label: 'Refracted' }, reflectedColor: { type: 'vec3', label: 'Reflected' } },
        params: { ior: 1.48, fresnelPow: 3.5, dispersion: 0.05, samples: 8.0, shininess: 90.0, diffuseness: 0.4, saturation: 1.6 },
      },
      // Hue-rotate the reflected color to a warm gold/amber
      {
        id: 'rot_6', type: 'hueRotate', position: { x: 1080, y: 400 },
        inputs: {
          color: { type: 'vec3',  label: 'Color', connection: { nodeId: 'glass_5', outputKey: 'reflectedColor' } },
          angle: { type: 'float', label: 'Angle' },
        },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { angle: 0.9 },
      },
      // Manually blend refracted + hue-rotated reflected using fresnel
      {
        id: 'mix_7', type: 'mixVec3', position: { x: 1300, y: 300 },
        inputs: {
          a:   { type: 'vec3',  label: 'A',   connection: { nodeId: 'glass_5', outputKey: 'refractedColor' } },
          b:   { type: 'vec3',  label: 'B',   connection: { nodeId: 'rot_6',   outputKey: 'color'          } },
          fac: { type: 'float', label: 'Fac', connection: { nodeId: 'glass_5', outputKey: 'fresnel'        } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } }, params: {},
      },
      { id: 'tone_8', type: 'toneMap', position: { x: 1520, y: 300 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'mix_7', outputKey: 'result' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } }, params: { mode: 'aces' } },
      { id: 'out_9', type: 'output', position: { x: 1740, y: 300 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'tone_8', outputKey: 'color' } } },
        outputs: {}, params: {} },
    ],
  },

  // ── Glass 3D: Flat Blend (decouple from physics) ──────────────────────────────
  glassFlatBlend: {
    label: 'Glass: Flat Blend',
    counter: 10,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 60,  y: 180 }, inputs: {}, outputs: { uv:   { type: 'vec2',  label: 'UV'   } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 60,  y: 340 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'cam_2', type: 'marchCamera', position: { x: 280, y: 260 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { ro: { type: 'vec3', label: 'Ray Origin' }, rd: { type: 'vec3', label: 'Ray Dir' } },
        params: { camDist: 3.2, camAngle: 0.3, camElevation: 0.2, rotSpeed: 0.09, fov: 1.4, aperture: 0.0, focalDist: 3.2 },
      },
      {
        id: 'scene_3', type: 'sceneGroup', position: { x: 560, y: 340 },
        inputs: {}, outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: 'Glass Box',
          subgraph: {
            nodes: [
              { id: 'sp',  type: 'scenePos',         position: { x: 80,  y: 150 }, inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'sdf', type: 'roundedBoxSDF3D',   position: { x: 280, y: 150 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { bx: 0.55, by: 0.55, bz: 0.55, r: 0.1 } },
            ],
            outputNodeId: 'sdf', outputKey: 'dist', inputPorts: [], outputPorts: [],
          },
        },
      },
      {
        id: 'mlg_4', type: 'marchLoopGroup', position: { x: 820, y: 220 },
        inputs: {
          ro:    { type: 'vec3',    label: 'Ray Origin', connection: { nodeId: 'cam_2',   outputKey: 'ro'    } },
          rd:    { type: 'vec3',    label: 'Ray Dir',    connection: { nodeId: 'cam_2',   outputKey: 'rd'    } },
          scene: { type: 'scene3d', label: 'Scene',      connection: { nodeId: 'scene_3', outputKey: 'scene' } },
          uv: { type: 'vec2', label: 'UV' }, time: { type: 'float', label: 'Time' },
        },
        outputs: { color: { type: 'vec3', label: 'Color' }, dist: { type: 'float', label: 'Distance' }, depth: { type: 'float', label: 'Depth' }, normal: { type: 'vec3', label: 'Normal' }, iter: { type: 'float', label: 'Iter' }, iterCount: { type: 'float', label: 'Iter Count' }, hit: { type: 'float', label: 'Hit' }, pos: { type: 'vec3', label: 'Hit Pos' } },
        params: { maxSteps: 80, maxDist: 12.0, stepScale: 1.0, volumetric: false, passthrough: 0.1, jitter: 0.0, bgR: 0.04, bgG: 0.05, bgB: 0.14, albedoR: 0.2, albedoG: 0.2, albedoB: 0.3, subgraph: { nodes: [], inputPorts: [], outputPorts: [] } },
      },
      {
        id: 'glass_5', type: 'glass3d', position: { x: 1080, y: 220 },
        inputs: {
          rayDir:    { type: 'vec3',  label: 'Ray Dir',    connection: { nodeId: 'cam_2', outputKey: 'rd'     } },
          normal:    { type: 'vec3',  label: 'Normal',     connection: { nodeId: 'mlg_4', outputKey: 'normal' } },
          hit:       { type: 'float', label: 'Hit',        connection: { nodeId: 'mlg_4', outputKey: 'hit'    } },
          bgColor: { type: 'vec3', label: 'Background' }, tintColor: { type: 'vec3', label: 'Tint' }, lightDir: { type: 'vec3', label: 'Light Dir' },
        },
        outputs: { color: { type: 'vec3', label: 'Glass Color' }, fresnel: { type: 'float', label: 'Fresnel' }, refractedColor: { type: 'vec3', label: 'Refracted' }, reflectedColor: { type: 'vec3', label: 'Reflected' } },
        params: { ior: 1.5, fresnelPow: 3.0, dispersion: 0.06, samples: 8.0, shininess: 64.0, diffuseness: 0.4, saturation: 2.0 },
      },
      // Mix refracted + reflected at a flat 0.25 ratio — ignores physics, looks more transparent
      {
        id: 'mix_6', type: 'mixVec3', position: { x: 1300, y: 220 },
        inputs: {
          a:   { type: 'vec3',  label: 'A',   connection: { nodeId: 'glass_5', outputKey: 'refractedColor' } },
          b:   { type: 'vec3',  label: 'B',   connection: { nodeId: 'glass_5', outputKey: 'reflectedColor' } },
          fac: { type: 'float', label: 'Fac' },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } },
        params: { fac: 0.25 },
      },
      // Palette on fresnel for a faint iridescent overlay
      {
        id: 'pal_7', type: 'palette', position: { x: 1080, y: 420 },
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'glass_5', outputKey: 'fresnel' } }, offset_r: { type: 'float', label: 'offset.r' }, offset_g: { type: 'float', label: 'offset.g' }, offset_b: { type: 'float', label: 'offset.b' }, amplitude_r: { type: 'float', label: 'amplitude.r' }, amplitude_g: { type: 'float', label: 'amplitude.g' }, amplitude_b: { type: 'float', label: 'amplitude.b' }, freq_r: { type: 'float', label: 'freq.r' }, freq_g: { type: 'float', label: 'freq.g' }, freq_b: { type: 'float', label: 'freq.b' }, phase_r: { type: 'float', label: 'phase.r' }, phase_g: { type: 'float', label: 'phase.g' }, phase_b: { type: 'float', label: 'phase.b' } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { offset: [0.5,0.5,0.5], amplitude: [0.4,0.4,0.4], freq: [2.0,2.0,2.0], phase: [0.0,0.5,1.0] },
      },
      {
        id: 'mul_8', type: 'multiplyVec3', position: { x: 1300, y: 420 },
        inputs: {
          color: { type: 'vec3',  label: 'Color', connection: { nodeId: 'pal_7',   outputKey: 'color'   } },
          scale: { type: 'float', label: 'Scale', connection: { nodeId: 'glass_5', outputKey: 'fresnel' } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } }, params: {},
      },
      {
        id: 'add_9', type: 'addVec3', position: { x: 1520, y: 310 },
        inputs: {
          a: { type: 'vec3', label: 'A', connection: { nodeId: 'mix_6', outputKey: 'result' } },
          b: { type: 'vec3', label: 'B', connection: { nodeId: 'mul_8', outputKey: 'result' } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } }, params: {},
      },
      { id: 'tone_10', type: 'toneMap', position: { x: 1740, y: 310 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'add_9', outputKey: 'result' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } }, params: { mode: 'aces' } },
      { id: 'out_11', type: 'output', position: { x: 1960, y: 310 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'tone_10', outputKey: 'color' } } },
        outputs: {}, params: {} },
    ],
  },

  glassSceneLensVoid: {
    label: 'Glass Scene: Lens + Void',
    counter: 9,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 60,  y: 180 }, inputs: {}, outputs: { uv:   { type: 'vec2',  label: 'UV'   } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 60,  y: 340 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'cam_2', type: 'marchCamera', position: { x: 280, y: 260 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { ro: { type: 'vec3', label: 'Ray Origin' }, rd: { type: 'vec3', label: 'Ray Dir' } },
        params: { camDist: 3.8, camAngle: 0.3, camElevation: 0.2, rotSpeed: 0.05, fov: 1.4, aperture: 0.0, focalDist: 3.8 },
      },
      {
        id: 'fg_3', type: 'sceneGroup', position: { x: 560, y: 160 },
        inputs: {}, outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: 'Glass Lens',
          subgraph: {
            nodes: [
              { id: 'sp',  type: 'scenePos',         position: { x: 80,  y: 150 }, inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'sdf', type: 'roundedBoxSDF3D',   position: { x: 280, y: 150 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { bx: 0.9, by: 0.14, bz: 0.9, r: 0.14 } },
            ],
            outputNodeId: 'sdf', outputKey: 'dist', inputPorts: [], outputPorts: [],
          },
        },
      },
      {
        id: 'bg_4', type: 'sceneGroup', position: { x: 560, y: 400 },
        inputs: {}, outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: 'Torus + Sphere',
          subgraph: {
            nodes: [
              { id: 'sp',  type: 'scenePos',      position: { x: 80,  y: 200 }, inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'tr1', type: 'translate3D',   position: { x: 280, y: 100 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp', outputKey: 'pos' } } },
                outputs: { pos: { type: 'vec3', label: 'Position' } }, params: { tx: 0.0, ty: -0.5, tz: 0.0 } },
              { id: 'tor', type: 'torusSDF3D',    position: { x: 480, y: 100 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'tr1', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { R: 0.7, r: 0.18 } },
              { id: 'tr2', type: 'translate3D',   position: { x: 280, y: 320 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp', outputKey: 'pos' } } },
                outputs: { pos: { type: 'vec3', label: 'Position' } }, params: { tx: 0.0, ty: 0.5, tz: 0.0 } },
              { id: 'sph', type: 'sphereSDF3D',   position: { x: 480, y: 320 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'tr2', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { radius: 0.32 } },
              { id: 'u1',  type: 'sdfUnion',      position: { x: 680, y: 210 },
                inputs: {
                  a: { type: 'float', label: 'A', connection: { nodeId: 'tor', outputKey: 'dist' } },
                  b: { type: 'float', label: 'B', connection: { nodeId: 'sph', outputKey: 'dist' } },
                },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: {} },
            ],
            outputNodeId: 'u1', outputKey: 'dist', inputPorts: [], outputPorts: [],
          },
        },
      },
      {
        id: 'gs_5', type: 'glassScene', position: { x: 900, y: 280 },
        inputs: {
          ro:         { type: 'vec3',    label: 'Ray Origin', connection: { nodeId: 'cam_2', outputKey: 'ro'    } },
          rd:         { type: 'vec3',    label: 'Ray Dir',    connection: { nodeId: 'cam_2', outputKey: 'rd'    } },
          foreground: { type: 'scene3d', label: 'Glass Geo',  connection: { nodeId: 'fg_3',  outputKey: 'scene' } },
          background: { type: 'scene3d', label: 'Background', connection: { nodeId: 'bg_4',  outputKey: 'scene' } },
          bgAlbedo:   { type: 'vec3',    label: 'BG Color'   },
          tintColor:  { type: 'vec3',    label: 'Glass Tint' },
          lightDir:   { type: 'vec3',    label: 'Light Dir'  },
        },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { ior: 1.55, fresnelPow: 3.0, dispersion: 0.08, shininess: 120.0, diffuseness: 0.45, saturation: 2.0 },
      },
      { id: 'tone_6', type: 'toneMap', position: { x: 1140, y: 280 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'gs_5', outputKey: 'color' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } }, params: { mode: 'aces' } },
      { id: 'out_7', type: 'output', position: { x: 1360, y: 280 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'tone_6', outputKey: 'color' } } },
        outputs: {}, params: {} },
    ],
  },

};

// The default graph to load on startup
export const DEFAULT_EXAMPLE = 'fractalRings';
