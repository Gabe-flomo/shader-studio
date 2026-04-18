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
      { id: 'cExpr_2', type: 'exprNode', position: { x: 280, y: 400 },
        inputs: { t: { type: 'float', label: 't (float)', connection: { nodeId: 'time_1', outputKey: 'time' } } },
        outputs: { result: { type: 'vec3', label: 'Result (vec3)' } },
        params: { inputs: [{ name: 't', type: 'float', slider: null }], outputType: 'vec2', lines: [], result: 'vec2(cos(t * 0.3) * 0.7, sin(t * 0.4) * 0.4)', expr: 'vec2(cos(t * 0.3) * 0.7, sin(t * 0.4) * 0.4)' } },
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
      { id: 'orb1_2', type: 'exprNode', position: { x: 260, y: 100 },
        inputs: { t: { type: 'float', label: 't (float)', connection: { nodeId: 'time_1', outputKey: 'time' } } },
        outputs: { result: { type: 'vec3', label: 'Result (vec3)' } },
        params: { inputs: [{ name: 't', type: 'float', slider: null }], outputType: 'vec2', lines: [], result: 'vec2(cos(t*0.7), sin(t*0.7)) * 0.42', expr: 'vec2(cos(t*0.7), sin(t*0.7)) * 0.42' } },
      { id: 'orb2_3', type: 'exprNode', position: { x: 260, y: 280 },
        inputs: { t: { type: 'float', label: 't (float)', connection: { nodeId: 'time_1', outputKey: 'time' } } },
        outputs: { result: { type: 'vec3', label: 'Result (vec3)' } },
        params: { inputs: [{ name: 't', type: 'float', slider: null }], outputType: 'vec2', lines: [], result: 'vec2(cos(t*1.1+2.09), sin(t*1.1+2.09)) * 0.38', expr: 'vec2(cos(t*1.1+2.09), sin(t*1.1+2.09)) * 0.38' } },
      { id: 'orb3_4', type: 'exprNode', position: { x: 260, y: 460 },
        inputs: { t: { type: 'float', label: 't (float)', connection: { nodeId: 'time_1', outputKey: 'time' } } },
        outputs: { result: { type: 'vec3', label: 'Result (vec3)' } },
        params: { inputs: [{ name: 't', type: 'float', slider: null }], outputType: 'vec2', lines: [], result: 'vec2(cos(t*1.4+4.19), sin(t*1.4+4.19)) * 0.34', expr: 'vec2(cos(t*1.4+4.19), sin(t*1.4+4.19)) * 0.34' } },

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
  invertDemo: {
    label: 'Invert',
    counter: 7,
    nodes: [
      { id: 'iv_uv',   type: 'uv',   position: { x: 40,  y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'iv_t',    type: 'time', position: { x: 40,  y: 400 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'iv_cir', type: 'circleSDF', position: { x: 240, y: 180 },
        inputs: {
          position: { type: 'vec2',  label: 'Position', connection: { nodeId: 'iv_uv', outputKey: 'uv' } },
          radius:   { type: 'float', label: 'Radius' },
          offset:   { type: 'vec2',  label: 'Offset' },
        },
        outputs: { distance: { type: 'float', label: 'Distance' } },
        params: { radius: 0.35 },
      },
      {
        id: 'iv_lit', type: 'makeLight', position: { x: 460, y: 180 },
        inputs: {
          distance:   { type: 'float', label: 'Distance',   connection: { nodeId: 'iv_cir', outputKey: 'distance' } },
          brightness: { type: 'float', label: 'Brightness' },
        },
        outputs: { glow: { type: 'float', label: 'Glow' } },
        params: { brightness: 8.0 },
      },
      {
        id: 'iv_pal', type: 'palettePreset', position: { x: 460, y: 360 },
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'iv_lit', outputKey: 'glow' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { preset: '3' },
      },
      {
        id: 'iv_mul', type: 'multiplyVec3', position: { x: 680, y: 270 },
        inputs: {
          color: { type: 'vec3',  label: 'Color', connection: { nodeId: 'iv_pal', outputKey: 'color' } },
          scale: { type: 'float', label: 'Scale', connection: { nodeId: 'iv_lit', outputKey: 'glow'  } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } },
        params: {},
      },
      {
        id: 'iv_inv', type: 'invert', position: { x: 880, y: 270 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'iv_mul', outputKey: 'result' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: {},
      },
      {
        id: 'iv_out', type: 'output', position: { x: 1080, y: 270 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'iv_inv', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Desaturate — pulling color toward grayscale on a glowing circle ─────────
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
    label: 'Curl Warp',
    counter: 7,
    nodes: [
      { id: 'cw_uv',   type: 'uv',   position: { x: 40,  y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'cw_t',    type: 'time', position: { x: 40,  y: 400 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      // Curl warp displaces UV
      {
        id: 'cw_curl', type: 'curlWarp', position: { x: 260, y: 200 },
        inputs: {
          input: { type: 'vec2',  label: 'UV',   connection: { nodeId: 'cw_uv', outputKey: 'uv'   } },
          time:  { type: 'float', label: 'Time', connection: { nodeId: 'cw_t',  outputKey: 'time' } },
        },
        outputs: { output: { type: 'vec2', label: 'UV out' } },
        params: {},
      },
      // Circle SDF on warped UV
      {
        id: 'cw_cir', type: 'circleSDF', position: { x: 480, y: 180 },
        inputs: {
          position: { type: 'vec2',  label: 'Position', connection: { nodeId: 'cw_curl', outputKey: 'output' } },
          radius:   { type: 'float', label: 'Radius' },
          offset:   { type: 'vec2',  label: 'Offset' },
        },
        outputs: { distance: { type: 'float', label: 'Distance' } },
        params: { radius: 0.3 },
      },
      {
        id: 'cw_lit', type: 'makeLight', position: { x: 700, y: 180 },
        inputs: {
          distance:   { type: 'float', label: 'Distance',   connection: { nodeId: 'cw_cir', outputKey: 'distance' } },
          brightness: { type: 'float', label: 'Brightness' },
        },
        outputs: { glow: { type: 'float', label: 'Glow' } },
        params: { brightness: 15.0 },
      },
      {
        id: 'cw_pal', type: 'palettePreset', position: { x: 700, y: 360 },
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'cw_t', outputKey: 'time' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { preset: '2' },
      },
      {
        id: 'cw_mul', type: 'multiplyVec3', position: { x: 920, y: 270 },
        inputs: {
          color: { type: 'vec3',  label: 'Color', connection: { nodeId: 'cw_pal', outputKey: 'color' } },
          scale: { type: 'float', label: 'Scale', connection: { nodeId: 'cw_lit', outputKey: 'glow'  } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } },
        params: {},
      },
      {
        id: 'cw_out', type: 'output', position: { x: 1120, y: 270 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'cw_mul', outputKey: 'result' } } },
        outputs: {}, params: {},
      },
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
  hueRangeDemo: {
    label: 'Hue Range',
    counter: 7,
    nodes: [
      { id: 'hr_uv',   type: 'uv',   position: { x: 40,  y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'hr_t',    type: 'time', position: { x: 40,  y: 400 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'hr_cir', type: 'circleSDF', position: { x: 240, y: 180 },
        inputs: {
          position: { type: 'vec2',  label: 'Position', connection: { nodeId: 'hr_uv', outputKey: 'uv' } },
          radius:   { type: 'float', label: 'Radius' },
          offset:   { type: 'vec2',  label: 'Offset' },
        },
        outputs: { distance: { type: 'float', label: 'Distance' } },
        params: { radius: 0.35 },
      },
      {
        id: 'hr_lit', type: 'makeLight', position: { x: 460, y: 180 },
        inputs: {
          distance:   { type: 'float', label: 'Distance',   connection: { nodeId: 'hr_cir', outputKey: 'distance' } },
          brightness: { type: 'float', label: 'Brightness' },
        },
        outputs: { glow: { type: 'float', label: 'Glow' } },
        params: { brightness: 10.0 },
      },
      {
        id: 'hr_pal', type: 'palettePreset', position: { x: 460, y: 360 },
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'hr_lit', outputKey: 'glow' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { preset: '1' },
      },
      {
        id: 'hr_mul', type: 'multiplyVec3', position: { x: 680, y: 270 },
        inputs: {
          color: { type: 'vec3',  label: 'Color', connection: { nodeId: 'hr_pal', outputKey: 'color' } },
          scale: { type: 'float', label: 'Scale', connection: { nodeId: 'hr_lit', outputKey: 'glow'  } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } },
        params: {},
      },
      {
        id: 'hr_hr', type: 'hueRange', position: { x: 880, y: 270 },
        inputs: {
          color: { type: 'vec3', label: 'Color', connection: { nodeId: 'hr_mul', outputKey: 'result' } },
        },
        outputs: { color: { type: 'vec3', label: 'Color' }, mask: { type: 'float', label: 'Mask' } },
        params: { hue_center: 0.3, hue_width: 0.15, boost: 3.0 },
      },
      {
        id: 'hr_out', type: 'output', position: { x: 1080, y: 270 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'hr_hr', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },


  // ── Newton Fractal z³-1 ───────────────────────────────────────────────────
  newtonFractalClassic: {
    label: 'Newton z³−1',
    counter: 3,
    nodes: [
      { id: 'uv_0', type: 'uv', position: { x: 60, y: 240 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      {
        id: 'newton_1', type: 'newtonFractal', position: { x: 320, y: 140 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0', outputKey: 'uv' } },
          time: { type: 'float', label: 'Time' },
        },
        outputs: {
          color: { type: 'vec3',  label: 'Color'       },
          iter:  { type: 'float', label: 'Smooth Iter'  },
          root:  { type: 'float', label: 'Root Index'   },
        },
        params: { polynomial: 'z3-1', max_iter: 48, zoom: 1.5, center_x: 0.0, center_y: 0.0, palette_preset: '1', shade_power: 1.5, convergence: 0.001 },
      },
      {
        id: 'output_2', type: 'output', position: { x: 660, y: 220 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'newton_1', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Newton Fractal z⁵-1 animated ────────────────────────────────────────
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
  lyapunovMarkus: {
    label: 'Lyapunov Fractal',
    counter: 3,
    nodes: [
      { id: 'uv_0', type: 'uv', position: { x: 60, y: 240 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      {
        id: 'lyap_1', type: 'lyapunov', position: { x: 320, y: 140 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0', outputKey: 'uv' } },
          time: { type: 'float', label: 'Time' },
        },
        outputs: {
          color:     { type: 'vec3',  label: 'Color'     },
          stability: { type: 'float', label: 'Stability' },
        },
        params: { sequence: 'AB', r_min: 2.0, r_max: 4.0, warmup: 24, iterations: 48, lyap_scale: 1.5 },
      },
      {
        id: 'output_2', type: 'output', position: { x: 640, y: 220 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'lyap_1', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Lyapunov AABB sequence ────────────────────────────────────────────────
  lyapunovAABB: {
    label: 'Lyapunov AABB',
    counter: 3,
    nodes: [
      { id: 'uv_0', type: 'uv', position: { x: 60, y: 240 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      {
        id: 'lyap_1', type: 'lyapunov', position: { x: 320, y: 140 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0', outputKey: 'uv' } },
          time: { type: 'float', label: 'Time' },
        },
        outputs: {
          color:     { type: 'vec3',  label: 'Color'     },
          stability: { type: 'float', label: 'Stability' },
        },
        params: { sequence: 'AABB', r_min: 2.5, r_max: 4.0, warmup: 32, iterations: 64, lyap_scale: 2.0 },
      },
      {
        id: 'output_2', type: 'output', position: { x: 640, y: 220 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'lyap_1', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Apollonian Gasket ─────────────────────────────────────────────────────
  apollonianGasket: {
    label: 'Apollonian Gasket',
    counter: 4,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 60, y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 60, y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'apoll_2', type: 'apollonian', position: { x: 320, y: 140 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: {
          color:    { type: 'vec3',  label: 'Color'    },
          distance: { type: 'float', label: 'Distance' },
          orbit:    { type: 'float', label: 'Orbit'    },
        },
        params: { iterations: 8, scale: 1.3, zoom: 1.0, center_x: 0.0, center_y: 0.0, animate: 0.4, palette_preset: '0', color_scale: 1.0, color_offset: 0.0 },
      },
      {
        id: 'output_3', type: 'output', position: { x: 660, y: 220 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'apoll_2', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Mandelbulb 3D ─────────────────────────────────────────────────────────
  mandelbulbClassic: {
    label: 'Mandelbulb 3D',
    counter: 4,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 60, y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 60, y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'bulb_2', type: 'mandelbulb', position: { x: 320, y: 120 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: {
          color: { type: 'vec3',  label: 'Color' },
          depth: { type: 'float', label: 'Depth' },
          orbit: { type: 'float', label: 'Orbit' },
        },
        params: { power: 8, max_iter: 12, max_steps: 80, max_dist: 5.0, surf_dist: 0.001, cam_dist: 3.5, cam_height: 1.2, cam_speed: 0.2, cam_fov: 1.5, light_x: 2.0, light_y: 4.0, light_z: 2.0, ambient: 0.05, specular: 32.0, ao_steps: 4, palette_preset: '4', bg_preset: '0' },
      },
      {
        id: 'output_3', type: 'output', position: { x: 660, y: 220 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'bulb_2', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Truchet Tiles ─────────────────────────────────────────────────────────
  truchetTiles: {
    label: 'Truchet Tiles',
    counter: 3,
    nodes: [
      { id: 'uv_0', type: 'uv', position: { x: 60, y: 240 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      {
        id: 'truch_1', type: 'truchet', position: { x: 320, y: 140 },
        inputs: {
          uv:      { type: 'vec2',  label: 'UV',      connection: { nodeId: 'uv_0', outputKey: 'uv' } },
          time:    { type: 'float', label: 'Time'    },
          color_a: { type: 'vec3',  label: 'Color A' },
          color_b: { type: 'vec3',  label: 'Color B' },
        },
        outputs: {
          color:    { type: 'vec3',  label: 'Color'    },
          distance: { type: 'float', label: 'Distance' },
          mask:     { type: 'float', label: 'Mask'     },
        },
        params: { scale: 10.0, line_width: 0.08, aa: 0.015, animate: 0.0, color_a: [0.05, 0.05, 0.12], color_b: [0.9, 0.85, 1.0] },
      },
      {
        id: 'output_2', type: 'output', position: { x: 640, y: 220 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'truch_1', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Animated Truchet ─────────────────────────────────────────────────────
  truchetAnimated: {
    label: 'Truchet Animated',
    counter: 4,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 60, y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 60, y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'truch_2', type: 'truchet', position: { x: 320, y: 140 },
        inputs: {
          uv:      { type: 'vec2',  label: 'UV',      connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time:    { type: 'float', label: 'Time',    connection: { nodeId: 'time_1', outputKey: 'time' } },
          color_a: { type: 'vec3',  label: 'Color A' },
          color_b: { type: 'vec3',  label: 'Color B' },
        },
        outputs: {
          color:    { type: 'vec3',  label: 'Color'    },
          distance: { type: 'float', label: 'Distance' },
          mask:     { type: 'float', label: 'Mask'     },
        },
        params: { scale: 8.0, line_width: 0.1, aa: 0.02, animate: 1.0, color_a: [0.08, 0.04, 0.16], color_b: [0.6, 0.9, 1.0] },
      },
      {
        id: 'output_3', type: 'output', position: { x: 640, y: 220 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'truch_2', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Metaballs ─────────────────────────────────────────────────────────────
  metaballsDemo: {
    label: 'Metaballs',
    counter: 4,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 60, y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 60, y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'meta_2', type: 'metaballs', position: { x: 320, y: 140 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
          pos1: { type: 'vec2',  label: 'Pos 1' },
          pos2: { type: 'vec2',  label: 'Pos 2' },
          pos3: { type: 'vec2',  label: 'Pos 3' },
        },
        outputs: {
          color: { type: 'vec3',  label: 'Color' },
          field: { type: 'float', label: 'Field' },
        },
        params: { radius1: 0.25, radius2: 0.2, radius3: 0.18, speed1: 0.7, speed2: 1.1, speed3: 0.5, palette_preset: '4', color_scale: 2.0 },
      },
      {
        id: 'output_3', type: 'output', position: { x: 660, y: 220 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'meta_2', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Lissajous Curve SDF ───────────────────────────────────────────────────
  lissajousDemo: {
    label: 'Lissajous Curve',
    counter: 4,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 60, y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 60, y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'liss_2', type: 'lissajous', position: { x: 320, y: 140 },
        inputs: {
          uv:    { type: 'vec2',  label: 'UV',    connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          delta: { type: 'float', label: 'Delta', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: {
          color:    { type: 'vec3',  label: 'Color'    },
          distance: { type: 'float', label: 'Distance' },
        },
        params: { freq_a: 3.0, freq_b: 2.0, thickness: 0.018, glow_width: 0.06, color_a: [0.1, 0.5, 1.0], color_b: [1.0, 0.3, 0.6] },
      },
      {
        id: 'output_3', type: 'output', position: { x: 660, y: 220 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'liss_2', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Menger Sponge Raymarch ────────────────────────────────────────────────
  mengerSponge: {
    label: 'Menger Sponge',
    counter: 4,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 60, y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 60, y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'rm_2', type: 'raymarch3d', position: { x: 320, y: 140 },
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
          scene: 'menger', max_steps: 100, max_dist: 20.0, surf_dist: 0.002,
          cam_dist: 4.0, cam_height: 1.5, cam_speed: 0.2, cam_fov: 1.5,
          shape_r: 1.0, blend_k: 0.3, repeat_x: 3.0, repeat_z: 3.0,
          cone_angle: 0.4, twist_k: 0.0, round_r: 0.0,
          light_x: 3.0, light_y: 6.0, light_z: 2.0,
          ambient: 0.04, specular: 48.0,
          fog_dist: 14.0, fog_color: [0.08, 0.08, 0.12],
          palette_preset: '5', bg_preset: '8',
          ao_steps: 5, noise_scale: 1.5, noise_strength: 0.0,
        },
      },
      {
        id: 'output_3', type: 'output', position: { x: 660, y: 220 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'rm_2', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Twisted Box Raymarch ──────────────────────────────────────────────────
  twistedBox: {
    label: 'Twisted Box',
    counter: 4,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 60, y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 60, y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'rm_2', type: 'raymarch3d', position: { x: 320, y: 140 },
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
          scene: 'twisted_box', max_steps: 80, max_dist: 20.0, surf_dist: 0.001,
          cam_dist: 4.5, cam_height: 1.5, cam_speed: 0.3, cam_fov: 1.5,
          shape_r: 0.8, blend_k: 0.3, repeat_x: 3.0, repeat_z: 3.0,
          cone_angle: 0.4, twist_k: 2.5, round_r: 0.15,
          light_x: 3.0, light_y: 5.0, light_z: 3.0,
          ambient: 0.05, specular: 32.0,
          fog_dist: 16.0, fog_color: [0.6, 0.65, 0.8],
          palette_preset: '1', bg_preset: '0',
          ao_steps: 5, noise_scale: 1.5, noise_strength: 0.0,
        },
      },
      {
        id: 'output_3', type: 'output', position: { x: 660, y: 220 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'rm_2', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ─── V2 Phase 1 Examples ─────────────────────────────────────────────────────

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

  vignetteDemo: {
    label: 'Vignette',
    counter: 6,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 60, y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 60, y: 360 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'fbm_2', type: 'fbm', position: { x: 260, y: 180 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { value: { type: 'float', label: 'Value' } },
        params: { octaves: 5, lacunarity: 2.0, gain: 0.5, scale: 3.0, time_scale: 0.2, offset_x: 0.0, offset_y: 0.0 },
      },
      {
        id: 'pal_3', type: 'palettePreset', position: { x: 460, y: 180 },
        inputs: { t: { type: 'float', label: 't', connection: { nodeId: 'fbm_2', outputKey: 'value' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { preset: '5', scale: 1.0, offset: 0.0 },
      },
      {
        id: 'pixuv_x', type: 'pixelUV', position: { x: 260, y: 340 },
        inputs: {},
        outputs: { uv: { type: 'vec2', label: 'UV (0-1)' } },
        params: {},
      },
      {
        id: 'vig_4', type: 'vignette', position: { x: 660, y: 200 },
        inputs: {
          color: { type: 'vec3', label: 'Color', connection: { nodeId: 'pal_3', outputKey: 'color' } },
          uv:    { type: 'vec2', label: 'UV (0-1)', connection: { nodeId: 'pixuv_x', outputKey: 'uv' } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } },
        params: { radius: 0.65, softness: 0.45, strength: 1.0 },
      },
      {
        id: 'output_5', type: 'output', position: { x: 880, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'vig_4', outputKey: 'result' } } },
        outputs: {}, params: {},
      },
    ],
  },

  scanlinesDemo: {
    label: 'Scanlines (CRT)',
    counter: 6,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 60, y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 60, y: 360 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'fbm_2', type: 'fbm', position: { x: 260, y: 180 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { value: { type: 'float', label: 'Value' } },
        params: { octaves: 4, lacunarity: 2.0, gain: 0.5, scale: 2.5, time_scale: 0.15 },
      },
      {
        id: 'pal_3', type: 'palettePreset', position: { x: 460, y: 180 },
        inputs: { t: { type: 'float', label: 't', connection: { nodeId: 'fbm_2', outputKey: 'value' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { preset: '6', scale: 1.0, offset: 0.0 },
      },
      {
        id: 'pixuv_x', type: 'pixelUV', position: { x: 260, y: 340 },
        inputs: {},
        outputs: { uv: { type: 'vec2', label: 'UV (0-1)' } },
        params: {},
      },
      {
        id: 'scan_4', type: 'scanlines', position: { x: 660, y: 200 },
        inputs: {
          color: { type: 'vec3', label: 'Color', connection: { nodeId: 'pal_3',  outputKey: 'color' } },
          uv:    { type: 'vec2', label: 'UV (0-1)', connection: { nodeId: 'pixuv_x', outputKey: 'uv' } },
          time:  { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } },
        params: { count: 320.0, intensity: 0.4, scroll: 0.2 },
      },
      {
        id: 'output_5', type: 'output', position: { x: 880, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'scan_4', outputKey: 'result' } } },
        outputs: {}, params: {},
      },
    ],
  },

  sobelDemo: {
    label: 'Sobel Edge Detection',
    counter: 5,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 60, y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 60, y: 360 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'fbm_2', type: 'fbm', position: { x: 260, y: 180 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { value: { type: 'float', label: 'Value' } },
        params: { octaves: 4, lacunarity: 2.0, gain: 0.5, scale: 3.0, time_scale: 0.1 },
      },
      {
        id: 'sobel_3', type: 'sobel', position: { x: 460, y: 180 },
        inputs: {
          value: { type: 'float', label: 'Value', connection: { nodeId: 'fbm_2', outputKey: 'value' } },
          uv:    { type: 'vec2',  label: 'UV',    connection: { nodeId: 'uv_0',  outputKey: 'uv'   } },
        },
        outputs: { edges: { type: 'float', label: 'Edge Strength' }, result: { type: 'vec3', label: 'Edge Color' } },
        params: { strength: 3.0, colorR: 0.4, colorG: 0.9, colorB: 1.0 },
      },
      {
        id: 'output_4', type: 'output', position: { x: 680, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'sobel_3', outputKey: 'result' } } },
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
  blackbodyFire: {
    label: 'Blackbody: Fire',
    counter: 9,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 60, y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 60, y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      // FBM for fire base shape
      {
        id: 'fbm_2', type: 'fbm', position: { x: 260, y: 200 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { value: { type: 'float', label: 'Value' } },
        params: { octaves: 5, lacunarity: 2.0, gain: 0.55, scale: 4.0, time_scale: 0.8, offset_y: -0.5 },
      },
      // Remap FBM to a temperature range (1000 K = red, 6000 K = white-hot)
      {
        id: 'remap_3', type: 'remap', position: { x: 480, y: 200 },
        inputs: { value: { type: 'float', label: 'Value', connection: { nodeId: 'fbm_2', outputKey: 'value' } } },
        outputs: { result: { type: 'float', label: 'Result' } },
        params: { inMin: 0.0, inMax: 1.0, outMin: 800.0, outMax: 5500.0 },
      },
      // Blackbody gives fire colors from dark red → orange → yellow → white
      {
        id: 'bb_4', type: 'blackbody', position: { x: 700, y: 200 },
        inputs: { kelvin: { type: 'float', label: 'Kelvin', connection: { nodeId: 'remap_3', outputKey: 'result' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: {},
      },
      // Extract X (luminance proxy) for alpha mask — dim near edges
      {
        id: 'exX_5', type: 'extractX', position: { x: 260, y: 380 },
        inputs: { input: { type: 'vec2', label: 'Input', connection: { nodeId: 'uv_0', outputKey: 'uv' } } },
        outputs: { x: { type: 'float', label: 'X' } },
        params: {},
      },
      // Square the FBM as a mask (darken borders)
      {
        id: 'pow_6', type: 'pow', position: { x: 480, y: 380 },
        inputs: { base: { type: 'float', label: 'Base', connection: { nodeId: 'fbm_2', outputKey: 'value' } } },
        outputs: { result: { type: 'float', label: 'Result' } },
        params: { exponent: 2.0 },
      },
      // Multiply color by mask
      {
        id: 'mul_7', type: 'multiplyVec3', position: { x: 880, y: 200 },
        inputs: {
          color:  { type: 'vec3',  label: 'Color',  connection: { nodeId: 'bb_4',  outputKey: 'color'  } },
          scalar: { type: 'float', label: 'Scalar', connection: { nodeId: 'pow_6', outputKey: 'result' } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } },
        params: {},
      },
      {
        id: 'output_8', type: 'output', position: { x: 1080, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'mul_7', outputKey: 'result' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Blackbody: Star Temperature Gradient ──────────────────────────────────────
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
  blendOverlayDemo: {
    label: 'Blend Modes — Overlay',
    counter: 11,
    nodes: [
      { id: 'bo_uv',   type: 'uv',   position: { x: 40,  y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'bo_t',    type: 'time', position: { x: 40,  y: 450 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      // Base layer: circle A (left)
      {
        id: 'bo_cirA', type: 'circleSDF', position: { x: 240, y: 120 },
        inputs: {
          position: { type: 'vec2',  label: 'Position', connection: { nodeId: 'bo_uv', outputKey: 'uv' } },
          radius:   { type: 'float', label: 'Radius' },
          offset:   { type: 'vec2',  label: 'Offset' },
        },
        outputs: { distance: { type: 'float', label: 'Distance' } },
        params: { radius: 0.3, posX: -0.3, posY: 0.0 },
      },
      {
        id: 'bo_litA', type: 'makeLight', position: { x: 460, y: 120 },
        inputs: {
          distance:   { type: 'float', label: 'Distance',   connection: { nodeId: 'bo_cirA', outputKey: 'distance' } },
          brightness: { type: 'float', label: 'Brightness' },
        },
        outputs: { glow: { type: 'float', label: 'Glow' } },
        params: { brightness: 8.0 },
      },
      {
        id: 'bo_palA', type: 'palettePreset', position: { x: 680, y: 80 },
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'bo_t', outputKey: 'time' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { preset: '1' },
      },
      {
        id: 'bo_mulA', type: 'multiplyVec3', position: { x: 900, y: 100 },
        inputs: {
          color: { type: 'vec3',  label: 'Color', connection: { nodeId: 'bo_palA', outputKey: 'color' } },
          scale: { type: 'float', label: 'Scale', connection: { nodeId: 'bo_litA', outputKey: 'glow'  } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } },
        params: {},
      },
      // Blend layer: circle B (right)
      {
        id: 'bo_cirB', type: 'circleSDF', position: { x: 240, y: 360 },
        inputs: {
          position: { type: 'vec2',  label: 'Position', connection: { nodeId: 'bo_uv', outputKey: 'uv' } },
          radius:   { type: 'float', label: 'Radius' },
          offset:   { type: 'vec2',  label: 'Offset' },
        },
        outputs: { distance: { type: 'float', label: 'Distance' } },
        params: { radius: 0.3, posX: 0.3, posY: 0.0 },
      },
      {
        id: 'bo_litB', type: 'makeLight', position: { x: 460, y: 360 },
        inputs: {
          distance:   { type: 'float', label: 'Distance',   connection: { nodeId: 'bo_cirB', outputKey: 'distance' } },
          brightness: { type: 'float', label: 'Brightness' },
        },
        outputs: { glow: { type: 'float', label: 'Glow' } },
        params: { brightness: 8.0 },
      },
      {
        id: 'bo_palB', type: 'palettePreset', position: { x: 680, y: 400 },
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'bo_t', outputKey: 'time' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { preset: '3' },
      },
      {
        id: 'bo_mulB', type: 'multiplyVec3', position: { x: 900, y: 380 },
        inputs: {
          color: { type: 'vec3',  label: 'Color', connection: { nodeId: 'bo_palB', outputKey: 'color' } },
          scale: { type: 'float', label: 'Scale', connection: { nodeId: 'bo_litB', outputKey: 'glow'  } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } },
        params: {},
      },
      // Overlay blend
      {
        id: 'bo_blend', type: 'blendModes', position: { x: 1120, y: 240 },
        inputs: {
          base:    { type: 'vec3',  label: 'Base',    connection: { nodeId: 'bo_mulA', outputKey: 'result' } },
          blend:   { type: 'vec3',  label: 'Blend',   connection: { nodeId: 'bo_mulB', outputKey: 'result' } },
          opacity: { type: 'float', label: 'Opacity' },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } },
        params: { mode: 'overlay', opacity: 1.0 },
      },
      {
        id: 'bo_out', type: 'output', position: { x: 1340, y: 240 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'bo_blend', outputKey: 'result' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Blend Modes: Soft Light Painting ──────────────────────────────────────────
  blendSoftLight: {
    label: 'Blend Modes — Soft Light',
    counter: 11,
    nodes: [
      { id: 'bs_uv',   type: 'uv',   position: { x: 40,  y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'bs_t',    type: 'time', position: { x: 40,  y: 450 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      // Base layer: circle A (left)
      {
        id: 'bs_cirA', type: 'circleSDF', position: { x: 240, y: 120 },
        inputs: {
          position: { type: 'vec2',  label: 'Position', connection: { nodeId: 'bs_uv', outputKey: 'uv' } },
          radius:   { type: 'float', label: 'Radius' },
          offset:   { type: 'vec2',  label: 'Offset' },
        },
        outputs: { distance: { type: 'float', label: 'Distance' } },
        params: { radius: 0.3, posX: -0.3, posY: 0.0 },
      },
      {
        id: 'bs_litA', type: 'makeLight', position: { x: 460, y: 120 },
        inputs: {
          distance:   { type: 'float', label: 'Distance',   connection: { nodeId: 'bs_cirA', outputKey: 'distance' } },
          brightness: { type: 'float', label: 'Brightness' },
        },
        outputs: { glow: { type: 'float', label: 'Glow' } },
        params: { brightness: 8.0 },
      },
      {
        id: 'bs_palA', type: 'palettePreset', position: { x: 680, y: 80 },
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'bs_t', outputKey: 'time' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { preset: '4' },
      },
      {
        id: 'bs_mulA', type: 'multiplyVec3', position: { x: 900, y: 100 },
        inputs: {
          color: { type: 'vec3',  label: 'Color', connection: { nodeId: 'bs_palA', outputKey: 'color' } },
          scale: { type: 'float', label: 'Scale', connection: { nodeId: 'bs_litA', outputKey: 'glow'  } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } },
        params: {},
      },
      // Blend layer: circle B (right)
      {
        id: 'bs_cirB', type: 'circleSDF', position: { x: 240, y: 360 },
        inputs: {
          position: { type: 'vec2',  label: 'Position', connection: { nodeId: 'bs_uv', outputKey: 'uv' } },
          radius:   { type: 'float', label: 'Radius' },
          offset:   { type: 'vec2',  label: 'Offset' },
        },
        outputs: { distance: { type: 'float', label: 'Distance' } },
        params: { radius: 0.3, posX: 0.3, posY: 0.0 },
      },
      {
        id: 'bs_litB', type: 'makeLight', position: { x: 460, y: 360 },
        inputs: {
          distance:   { type: 'float', label: 'Distance',   connection: { nodeId: 'bs_cirB', outputKey: 'distance' } },
          brightness: { type: 'float', label: 'Brightness' },
        },
        outputs: { glow: { type: 'float', label: 'Glow' } },
        params: { brightness: 8.0 },
      },
      {
        id: 'bs_palB', type: 'palettePreset', position: { x: 680, y: 400 },
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'bs_t', outputKey: 'time' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { preset: '7' },
      },
      {
        id: 'bs_mulB', type: 'multiplyVec3', position: { x: 900, y: 380 },
        inputs: {
          color: { type: 'vec3',  label: 'Color', connection: { nodeId: 'bs_palB', outputKey: 'color' } },
          scale: { type: 'float', label: 'Scale', connection: { nodeId: 'bs_litB', outputKey: 'glow'  } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } },
        params: {},
      },
      // Soft light blend
      {
        id: 'bs_blend', type: 'blendModes', position: { x: 1120, y: 240 },
        inputs: {
          base:    { type: 'vec3',  label: 'Base',    connection: { nodeId: 'bs_mulA', outputKey: 'result' } },
          blend:   { type: 'vec3',  label: 'Blend',   connection: { nodeId: 'bs_mulB', outputKey: 'result' } },
          opacity: { type: 'float', label: 'Opacity' },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } },
        params: { mode: 'softLight', opacity: 1.0 },
      },
      {
        id: 'bs_out', type: 'output', position: { x: 1340, y: 240 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'bs_blend', outputKey: 'result' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Sobel: Edge Glow ──────────────────────────────────────────────────────────
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
        params: { persistence: 0.72, feedback_gain: 1.0, decay_r: 1.0, decay_g: 0.95, decay_b: 0.9 },
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
  sdfNeonChroma: {
    label: 'Neon Ring + Chroma',
    counter: 12,
    nodes: [
      { id: 'snc_uv',   type: 'uv',   position: { x: 40, y: 280 }, inputs: {}, outputs: { uv:   { type: 'vec2',  label: 'UV'   } }, params: {} },
      { id: 'snc_time', type: 'time', position: { x: 40, y: 460 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'snc_ca', type: 'chromaticAberration', position: { x: 260, y: 300 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'snc_uv',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'snc_time', outputKey: 'time' } },
        },
        outputs: { uv_r: { type: 'vec2', label: 'UV (Red)' }, uv_g: { type: 'vec2', label: 'UV (Green)' }, uv_b: { type: 'vec2', label: 'UV (Blue)' }, offset: { type: 'vec2', label: 'Offset' } },
        params: { mode: 'radial', strength: 0.018, contrast: 1.0, samples: '8', angle_deg: 0.0, animate: 'false', anim_speed: 0.5 },
      },
      {
        id: 'snc_rr', type: 'ringSDF', position: { x: 540, y: 80 },
        inputs:  { position: { type: 'vec2', label: 'Position', connection: { nodeId: 'snc_ca', outputKey: 'uv_r' } } },
        outputs: { distance: { type: 'float', label: 'Distance' } },
        params:  { radius: 0.35, posX: 0.0, posY: 0.0 },
      },
      {
        id: 'snc_rg', type: 'ringSDF', position: { x: 540, y: 240 },
        inputs:  { position: { type: 'vec2', label: 'Position', connection: { nodeId: 'snc_ca', outputKey: 'uv_g' } } },
        outputs: { distance: { type: 'float', label: 'Distance' } },
        params:  { radius: 0.35, posX: 0.0, posY: 0.0 },
      },
      {
        id: 'snc_rb', type: 'ringSDF', position: { x: 540, y: 400 },
        inputs:  { position: { type: 'vec2', label: 'Position', connection: { nodeId: 'snc_ca', outputKey: 'uv_b' } } },
        outputs: { distance: { type: 'float', label: 'Distance' } },
        params:  { radius: 0.35, posX: 0.0, posY: 0.0 },
      },
      {
        id: 'snc_lr', type: 'makeLight', position: { x: 760, y: 80 },
        inputs:  { distance: { type: 'float', label: 'Distance', connection: { nodeId: 'snc_rr', outputKey: 'distance' } } },
        outputs: { glow: { type: 'float', label: 'Glow' } },
        params:  { brightness: 14.0 },
      },
      {
        id: 'snc_lg', type: 'makeLight', position: { x: 760, y: 240 },
        inputs:  { distance: { type: 'float', label: 'Distance', connection: { nodeId: 'snc_rg', outputKey: 'distance' } } },
        outputs: { glow: { type: 'float', label: 'Glow' } },
        params:  { brightness: 14.0 },
      },
      {
        id: 'snc_lb', type: 'makeLight', position: { x: 760, y: 400 },
        inputs:  { distance: { type: 'float', label: 'Distance', connection: { nodeId: 'snc_rb', outputKey: 'distance' } } },
        outputs: { glow: { type: 'float', label: 'Glow' } },
        params:  { brightness: 14.0 },
      },
      {
        id: 'snc_rgb', type: 'combineRGB', position: { x: 980, y: 240 },
        inputs: {
          r: { type: 'float', label: 'R', connection: { nodeId: 'snc_lr', outputKey: 'glow' } },
          g: { type: 'float', label: 'G', connection: { nodeId: 'snc_lg', outputKey: 'glow' } },
          b: { type: 'float', label: 'B', connection: { nodeId: 'snc_lb', outputKey: 'glow' } },
        },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: {},
      },
      {
        id: 'snc_tone', type: 'toneMap', position: { x: 1180, y: 240 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'snc_rgb', outputKey: 'color' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { mode: 'aces' },
      },
      {
        id: 'snc_out', type: 'output', position: { x: 1380, y: 240 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'snc_tone', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── 3D Sphere + Vignette — raymarched sphere with post-process vignette ────
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
  warpedRaymarch: {
    label: 'Warped 3D View',
    counter: 7,
    nodes: [
      { id: 'wr_uv',   type: 'uv',   position: { x: 60, y: 200 }, inputs: {}, outputs: { uv:   { type: 'vec2',  label: 'UV'   } }, params: {} },
      { id: 'wr_time', type: 'time', position: { x: 60, y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'wr_warp', type: 'smoothWarp', position: { x: 280, y: 180 },
        inputs: {
          input: { type: 'vec2',  label: 'UV',   connection: { nodeId: 'wr_uv',   outputKey: 'uv'   } },
          time:  { type: 'float', label: 'Time', connection: { nodeId: 'wr_time', outputKey: 'time' } },
        },
        outputs: { output: { type: 'vec2', label: 'UV out' } },
        params: { strength: 0.12, scale: 3.0, speed: 0.25 },
      },
      {
        id: 'wr_scene', type: 'sceneGroup', position: { x: 280, y: 360 },
        inputs:  {},
        outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params:  {
          label: 'Torus',
          subgraph: {
            nodes: [
              { id: 'wr_sg',  type: 'scenePos',   position: { x: 100, y: 150 }, inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'wr_tor', type: 'torusSDF3D', position: { x: 300, y: 150 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'wr_sg', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { radius: 0.5, tube: 0.2 } },
            ],
            outputNodeId: 'wr_tor',
            outputKey:    'dist',
          },
        },
      },
      {
        id: 'wr_ray', type: 'rayMarch', position: { x: 540, y: 240 },
        inputs: {
          scene: { type: 'scene3d', label: 'Scene', connection: { nodeId: 'wr_scene', outputKey: 'scene'  } },
          uv:    { type: 'vec2',  label: 'UV',    connection: { nodeId: 'wr_warp',  outputKey: 'output' } },
          time:  { type: 'float', label: 'Time',  connection: { nodeId: 'wr_time',  outputKey: 'time'   } },
        },
        outputs: { color: { type: 'vec3', label: 'Color' }, depth: { type: 'float', label: 'Depth' }, normal: { type: 'vec3', label: 'Normal' } },
        params:  { camDist: 3.0, fov: 1.5, maxSteps: 64, maxDist: 20.0, lightX: 1.5, lightY: 2.5, lightZ: 3.0, bgR: 0.03, bgG: 0.02, bgB: 0.06, albedoR: 1.0, albedoG: 0.4, albedoB: 0.2 },
      },
      {
        id: 'wr_tone', type: 'toneMap', position: { x: 780, y: 260 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'wr_ray', outputKey: 'color' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { mode: 'aces' },
      },
      {
        id: 'wr_out', type: 'output', position: { x: 980, y: 260 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'wr_tone', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Noise + Particles — dark FBM field with glowing particle fountain ──────
  noiseParticles: {
    label: 'Noise + Particles',
    counter: 10,
    nodes: [
      { id: 'np_uv',   type: 'uv',   position: { x: 40,  y: 200 }, inputs: {}, outputs: { uv:   { type: 'vec2',  label: 'UV'   } }, params: {} },
      { id: 'np_time', type: 'time', position: { x: 40,  y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'np_fbm', type: 'fbm', position: { x: 260, y: 160 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'np_uv',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'np_time', outputKey: 'time' } },
        },
        outputs: { value: { type: 'float', label: 'Value' } },
        params: { octaves: 4, scale: 2.5, gain: 0.5, lacunarity: 2.0, time_scale: 0.04 },
      },
      {
        id: 'np_bgpal', type: 'palettePreset', position: { x: 480, y: 160 },
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'np_fbm', outputKey: 'value' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { preset: '0', scale: 0.4, offset: 0.0 },
      },
      {
        id: 'np_emit', type: 'particleEmitter', position: { x: 260, y: 360 },
        inputs: {
          time: { type: 'float', label: 'Time', connection: { nodeId: 'np_time', outputKey: 'time' } },
        },
        outputs: { nearest_dist: { type: 'float', label: 'Nearest Dist' }, nearest_uv: { type: 'vec2', label: 'Nearest UV' }, nearest_age: { type: 'float', label: 'Age' }, density: { type: 'float', label: 'Density' } },
        params: { flow_mode: 'fountain', max_particles: 60, lifetime: 2.0, speed: 0.5, angle_dir: 90, angle_spread: 0.3, gravity_x: 0.0, gravity_y: 0.5, field_strength: 0.0, despawn_radius: 2.0, seed: 7.0, density_radius: 0.04 },
      },
      {
        id: 'np_circ', type: 'circleSDF', position: { x: 520, y: 360 },
        inputs:  { position: { type: 'vec2', label: 'Position', connection: { nodeId: 'np_emit', outputKey: 'nearest_uv' } } },
        outputs: { distance: { type: 'float', label: 'Distance' } },
        params:  { radius: 0.016, posX: 0.0, posY: 0.0 },
      },
      {
        id: 'np_ppal', type: 'palettePreset', position: { x: 520, y: 500 },
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'np_emit', outputKey: 'nearest_age' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { preset: '3' },
      },
      {
        id: 'np_glow', type: 'glowLayer', position: { x: 760, y: 400 },
        inputs: {
          d:     { type: 'float', label: 'SDF',   connection: { nodeId: 'np_circ', outputKey: 'distance' } },
          color: { type: 'vec3',  label: 'Color', connection: { nodeId: 'np_ppal', outputKey: 'color'    } },
        },
        outputs: { result: { type: 'vec3', label: 'Glow' } },
        params: { intensity: 0.007, power: 1.4 },
      },
      {
        id: 'np_add', type: 'addColor', position: { x: 980, y: 280 },
        inputs: {
          a: { type: 'vec3', label: 'A', connection: { nodeId: 'np_bgpal', outputKey: 'color'  } },
          b: { type: 'vec3', label: 'B', connection: { nodeId: 'np_glow',  outputKey: 'result' } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } },
        params: { scale: 1.0 },
      },
      {
        id: 'np_out', type: 'output', position: { x: 1180, y: 280 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'np_add', outputKey: 'result' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Tilt-Shift Fractal — fractal rings with tilt-shift miniature blur ──────
  tiltShiftFractal: {
    label: 'Tilt-Shift Fractal',
    counter: 5,
    nodes: [
      { id: 'tsf_uv',   type: 'uv',   position: { x: 40, y: 200 }, inputs: {}, outputs: { uv:   { type: 'vec2',  label: 'UV'   } }, params: {} },
      { id: 'tsf_time', type: 'time', position: { x: 40, y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'tsf_frac', type: 'fractalLoop', position: { x: 260, y: 200 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'tsf_uv',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'tsf_time', outputKey: 'time' } },
        },
        outputs: { color: { type: 'vec3', label: 'Color' }, uv_final: { type: 'vec2', label: 'UV Final' }, uv0: { type: 'vec2', label: 'UV0' } },
        params: { iterations: 6, fract_scale: 1.6, scale_exp: 1.0, ring_freq: 8.0, glow: 0.01, glow_pow: 1.0, iter_offset: 0.35, time_scale: 0.5, offset: [0.5,0.5,0.5], amplitude: [0.5,0.5,0.5], freq: [1.0,1.0,1.0], phase: [0.0,0.33,0.67] },
      },
      {
        id: 'tsf_blur', type: 'tiltShiftBlur', position: { x: 560, y: 200 },
        inputs: {
          color: { type: 'vec3', label: 'Color', connection: { nodeId: 'tsf_frac', outputKey: 'color' } },
          uv:    { type: 'vec2', label: 'UV',    connection: { nodeId: 'tsf_uv',   outputKey: 'uv'   } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' }, mask: { type: 'float', label: 'Focus Mask' } },
        params: { focus_center: 0.0, band_width: 0.15, max_blur: 10.0, tilt_angle: 0.0, axis: 'horizontal' },
      },
      {
        id: 'tsf_out', type: 'output', position: { x: 800, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'tsf_blur', outputKey: 'result' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Swirl + 3D Scene — swirled camera UV into raymarched sphere ────────────
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
  voronoiBokeh: {
    label: 'Voronoi + Bokeh',
    counter: 7,
    nodes: [
      { id: 'vb_uv',   type: 'uv',   position: { x: 40, y: 200 }, inputs: {}, outputs: { uv:   { type: 'vec2',  label: 'UV'   } }, params: {} },
      { id: 'vb_time', type: 'time', position: { x: 40, y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'vb_vor', type: 'voronoi', position: { x: 260, y: 180 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'vb_uv',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'vb_time', outputKey: 'time' } },
        },
        outputs: { dist: { type: 'float', label: 'Distance' }, uv: { type: 'vec2', label: 'UV' } },
        params: { scale: 5.0, jitter: 0.85, time_scale: 0.06 },
      },
      {
        id: 'vb_pal', type: 'palettePreset', position: { x: 480, y: 100 },
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'vb_vor', outputKey: 'dist' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { preset: '9' },
      },
      {
        id: 'vb_glow', type: 'glowLayer', position: { x: 480, y: 280 },
        inputs: {
          d:     { type: 'float', label: 'SDF',   connection: { nodeId: 'vb_vor', outputKey: 'dist'  } },
          color: { type: 'vec3',  label: 'Color', connection: { nodeId: 'vb_pal', outputKey: 'color' } },
        },
        outputs: { result: { type: 'vec3', label: 'Glow' } },
        params: { intensity: 0.014, power: 1.2 },
      },
      {
        id: 'vb_lens', type: 'lensBlur', position: { x: 740, y: 200 },
        inputs: {
          color:       { type: 'vec3', label: 'Color',       connection: { nodeId: 'vb_glow', outputKey: 'result' } },
          uv:          { type: 'vec2', label: 'UV',          connection: { nodeId: 'vb_uv',   outputKey: 'uv'     } },
          focal_point: { type: 'vec2', label: 'Focal Point' },
        },
        outputs: { result: { type: 'vec3', label: 'Result' }, coc: { type: 'float', label: 'CoC' } },
        params: { focal_length: '50mm', aperture: 'f2.8', focus_distance: 0.3, bokeh_shape: 'circle', boost: 1.3 },
      },
      {
        id: 'vb_out', type: 'output', position: { x: 960, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'vb_lens', outputKey: 'result' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Kaleido + 3D Box — kaleidoscoped camera into raymarched box ────────────
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
  sobelNeonGlow: {
    label: 'Sobel Neon Glow',
    counter: 9,
    nodes: [
      { id: 'sng_uv',   type: 'uv',   position: { x: 60, y: 200 }, inputs: {}, outputs: { uv:   { type: 'vec2',  label: 'UV'   } }, params: {} },
      { id: 'sng_time', type: 'time', position: { x: 60, y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'sng_frac', type: 'fractalLoop', position: { x: 280, y: 200 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'sng_uv',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'sng_time', outputKey: 'time' } },
        },
        outputs: { color: { type: 'vec3', label: 'Color' }, uv_final: { type: 'vec2', label: 'UV Final' }, uv0: { type: 'vec2', label: 'UV0' } },
        params: { iterations: 5, fract_scale: 1.6, scale_exp: 1.0, ring_freq: 9.0, glow: 0.01, glow_pow: 1.0, iter_offset: 0.3, time_scale: 0.35, offset: [0.5,0.5,0.5], amplitude: [0.5,0.5,0.5], freq: [1.0,1.0,1.0], phase: [0.0,0.33,0.67] },
      },
      {
        id: 'sng_sob', type: 'sobel', position: { x: 560, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'sng_frac', outputKey: 'color' } } },
        outputs: { edges: { type: 'float', label: 'Edges' }, result: { type: 'vec3', label: 'Result' } },
        params: { strength: 4.0 },
      },
      {
        id: 'sng_epal', type: 'palettePreset', position: { x: 760, y: 280 },
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'sng_sob', outputKey: 'edges' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { preset: '2', scale: 2.0, offset: 0.0 },
      },
      {
        id: 'sng_mix', type: 'mixVec3', position: { x: 980, y: 200 },
        inputs: {
          a:   { type: 'vec3',  label: 'A',   connection: { nodeId: 'sng_frac', outputKey: 'color' } },
          b:   { type: 'vec3',  label: 'B',   connection: { nodeId: 'sng_epal', outputKey: 'color' } },
          fac: { type: 'float', label: 'Fac', connection: { nodeId: 'sng_sob',  outputKey: 'edges' } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } },
        params: {},
      },
      {
        id: 'sng_blur', type: 'gaussianBlur', position: { x: 1180, y: 200 },
        inputs: {
          color: { type: 'vec3', label: 'Color', connection: { nodeId: 'sng_mix', outputKey: 'result' } },
          uv:    { type: 'vec2', label: 'UV',    connection: { nodeId: 'sng_uv',  outputKey: 'uv'    } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } },
        params: { radius: 1.5, quality: 'standard' },
      },
      {
        id: 'sng_tone', type: 'toneMap', position: { x: 1380, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'sng_blur', outputKey: 'result' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { mode: 'aces' },
      },
      {
        id: 'sng_out', type: 'output', position: { x: 1580, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'sng_tone', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── 3D: Translate — offset a sphere from origin ──────────────────────────────
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
  motionFractalBlur: {
    label: 'Motion Blur Fractal',
    counter: 5,
    nodes: [
      { id: 'mfb_uv',   type: 'uv',   position: { x: 40, y: 200 }, inputs: {}, outputs: { uv:   { type: 'vec2',  label: 'UV'   } }, params: {} },
      { id: 'mfb_time', type: 'time', position: { x: 40, y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'mfb_frac', type: 'fractalLoop', position: { x: 260, y: 200 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'mfb_uv',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'mfb_time', outputKey: 'time' } },
        },
        outputs: { color: { type: 'vec3', label: 'Color' }, uv_final: { type: 'vec2', label: 'UV Final' }, uv0: { type: 'vec2', label: 'UV0' } },
        params: { iterations: 5, fract_scale: 1.8, scale_exp: 1.0, ring_freq: 12.0, glow: 0.015, glow_pow: 1.3, iter_offset: 0.4, time_scale: 0.8, offset: [0.5,0.5,0.5], amplitude: [0.5,0.5,0.5], freq: [1.0,1.0,1.0], phase: [0.0,0.33,0.67] },
      },
      {
        id: 'mfb_blur', type: 'motionBlur', position: { x: 560, y: 200 },
        inputs: {
          color: { type: 'vec3', label: 'Color', connection: { nodeId: 'mfb_frac', outputKey: 'color' } },
          uv:    { type: 'vec2', label: 'UV',    connection: { nodeId: 'mfb_uv',   outputKey: 'uv'   } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } },
        params: { persistence: 0.78, feedback_gain: 1.0, decay_r: 1.0, decay_g: 0.96, decay_b: 0.9 },
      },
      {
        id: 'mfb_out', type: 'output', position: { x: 800, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'mfb_blur', outputKey: 'result' } } },
        outputs: {}, params: {},
      },
    ],
  },


  // ── 3D: March Loop — Baseline (sphere, no warp) ─────────────────────────────
  mlgBaseline: {
    label: '3D: March Loop — Baseline Sphere',
    counter: 7,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 60, y: 200 }, inputs: {}, outputs: { uv:   { type: 'vec2',  label: 'UV'   } }, params: {} },
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
        id: 'scene_3', type: 'sceneGroup', position: { x: 560, y: 460 },
        inputs: {},
        outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: 'Sphere',
          subgraph: {
            nodes: [
              { id: 'sp_inn', type: 'scenePos', position: { x: 80, y: 150 }, inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'sdf_inn', type: 'sphereSDF3D', position: { x: 280, y: 150 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp_inn', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { radius: 0.5 } },
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
          bgR: 0.03, bgG: 0.03, bgB: 0.08,
          albedoR: 0.5, albedoG: 0.75, albedoB: 0.9,
          subgraph: {
            nodes: [
              { id: 'mp_b1', type: 'marchPos',  position: { x: 80,  y: 160 }, inputs: {}, outputs: { pos:  { type: 'vec3',  label: 'Position'   } }, params: {} },
              { id: 'md_b1', type: 'marchDist', position: { x: 80,  y: 300 }, inputs: {}, outputs: { dist: { type: 'float', label: 'March Dist' }, t: { type: 'float', label: 't' } }, params: {} },
              { id: 'marchout_b1', type: 'marchOutput', position: { x: 340, y: 160 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'mp_b1', outputKey: 'pos' } } },
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



  // ── 3D: IQ Tunnel — march camera + palette coloring (no diffuse shading) ────
  // Recreates the space-bending tunnel from Jamie Wong / IQ's ray march tutorial.
  // Key ideas:
  //   • MarchCamera with uv + time inputs
  //   • SceneGroup is OUTSIDE the MLG; receives warped pos via MLG architecture
  //   • MLG body: Rotate3D(Z) by marchDist×0.15×cos(time×0.2) → spinning tunnel warp
  //   • SceneGroup: Translate Z by −time×0.4 (forward flight), Repeat3D(1,1,0.25), Octahedron(0.15)
  //   • Coloring: bypass MLG's diffuse output; wire dist×0.04 + iterCount×0.005 → Palette
  mlgIQTunnel: {
    label: '3D: IQ Tunnel (palette + march camera)',
    counter: 11,
    nodes: [
      // ── Sources ──────────────────────────────────────────────────────────────
      { id: 'uv_0',   type: 'uv',   position: { x: 60,  y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 60,  y: 360 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },

      // ── March camera ──────────────────────────────────────────────────────────
      {
        id: 'cam_2', type: 'marchCamera', position: { x: 260, y: 280 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { ro: { type: 'vec3', label: 'Ray Origin' }, rd: { type: 'vec3', label: 'Ray Dir' } },
        params: { camDist: 3.0, camAngle: 0.0, rotSpeed: 0.0, fov: 1.5 },
      },

      // ── Scene Group (outer canvas) ────────────────────────────────────────────
      {
        id: 'scene_3', type: 'sceneGroup', position: { x: 500, y: 440 },
        inputs: {},
        outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: 'Repeated Octahedra',
          subgraph: {
            nodes: [
              { id: 'sp_inn', type: 'scenePos', position: { x: 60, y: 150 },
                inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'time_inn', type: 'time', position: { x: 60, y: 280 },
                inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
              { id: 'multz_inn', type: 'multiply', position: { x: 260, y: 280 },
                inputs: { a: { type: 'float', label: 'A', connection: { nodeId: 'time_inn', outputKey: 'time' } } },
                outputs: { result: { type: 'float', label: 'Result' } },
                params: { b: -0.4 } },
              { id: 'tr_inn', type: 'translate3D', position: { x: 440, y: 150 },
                inputs: {
                  pos: { type: 'vec3',  label: 'Position', connection: { nodeId: 'sp_inn',   outputKey: 'pos'    } },
                  tz:  { type: 'float', label: 'Z',        connection: { nodeId: 'multz_inn', outputKey: 'result' } },
                },
                outputs: { pos: { type: 'vec3', label: 'Translated Pos' } },
                params: { tx: 0.5, ty: 0.5, tz: 0.0 } },
              { id: 'rep_inn', type: 'repeat3D', position: { x: 640, y: 150 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'tr_inn', outputKey: 'pos' } } },
                outputs: { pos: { type: 'vec3', label: 'Repeated Pos' } },
                params: { cellX: 1.0, cellY: 1.0, cellZ: 0.25 } },
              { id: 'oct_inn', type: 'octahedronSDF3D', position: { x: 840, y: 150 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'rep_inn', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } },
                params: { size: 0.15 } },
            ],
            inputPorts: [], outputPorts: [],
          },
        },
      },

      // ── March Loop Group ─────────────────────────────────────────────────────
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
          color:     { type: 'vec3',  label: 'Color'      },
          dist:      { type: 'float', label: 'Distance'   },
          depth:     { type: 'float', label: 'Depth'      },
          normal:    { type: 'vec3',  label: 'Normal'     },
          iter:      { type: 'float', label: 'Iter'       },
          iterCount: { type: 'float', label: 'Iter Count' },
          hit:       { type: 'float', label: 'Hit'        },
          pos:       { type: 'vec3',  label: 'Hit Pos'    },
        },
        params: {
          maxSteps: 150, maxDist: 100.0, stepScale: 0.7,
          bgR: 0.0, bgG: 0.0, bgB: 0.0,
          albedoR: 0.5, albedoG: 0.5, albedoB: 0.5,
          subgraph: {
            nodes: [
              { id: 'mp_b1',   type: 'marchPos',  position: { x: 60,  y: 140 }, inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'md_b1',   type: 'marchDist', position: { x: 60,  y: 300 }, inputs: {}, outputs: { dist: { type: 'float', label: 'March Dist' }, t: { type: 'float', label: 't' } }, params: {} },
              { id: 'time_b1', type: 'time',       position: { x: 60,  y: 440 },
                inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
              { id: 'mulcs_b1', type: 'multiply',  position: { x: 260, y: 440 },
                inputs: { a: { type: 'float', label: 'A', connection: { nodeId: 'time_b1', outputKey: 'time' } } },
                outputs: { result: { type: 'float', label: 'Result' } }, params: { b: 0.2 } },
              { id: 'cos_b1',  type: 'cos',        position: { x: 440, y: 440 },
                inputs: { a: { type: 'float', label: 'A', connection: { nodeId: 'mulcs_b1', outputKey: 'result' } } },
                outputs: { result: { type: 'float', label: 'Result' } }, params: {} },
              { id: 'mulr_b1', type: 'multiply',   position: { x: 260, y: 300 },
                inputs: { a: { type: 'float', label: 'A', connection: { nodeId: 'md_b1', outputKey: 'dist' } } },
                outputs: { result: { type: 'float', label: 'Result' } }, params: { b: 0.15 } },
              { id: 'mula_b1', type: 'multiply',   position: { x: 620, y: 360 },
                inputs: {
                  a: { type: 'float', label: 'A', connection: { nodeId: 'mulr_b1', outputKey: 'result' } },
                  b: { type: 'float', label: 'B', connection: { nodeId: 'cos_b1',  outputKey: 'result' } },
                },
                outputs: { result: { type: 'float', label: 'Result' } }, params: { b: 1.0 } },
              { id: 'rot_b1',  type: 'rotate3D',   position: { x: 620, y: 200 },
                inputs: {
                  pos:   { type: 'vec3',  label: 'Position',    connection: { nodeId: 'mp_b1',   outputKey: 'pos'    } },
                  angle: { type: 'float', label: 'Angle (rad)', connection: { nodeId: 'mula_b1', outputKey: 'result' } },
                },
                outputs: { pos: { type: 'vec3', label: 'Rotated Pos' } },
                params: { axis: 'z', angle: 0.0 } },
              { id: 'marchout_b1', type: 'marchOutput', position: { x: 840, y: 200 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'rot_b1', outputKey: 'pos' } } },
                outputs: {}, params: {} },
            ],
            inputPorts: [], outputPorts: [],
          },
        },
      },

      // ── Palette coloring (bypass MLG diffuse) ────────────────────────────────
      { id: 'muld_6', type: 'multiply', position: { x: 1020, y: 160 },
        inputs: { a: { type: 'float', label: 'A', connection: { nodeId: 'mlg_4', outputKey: 'dist' } } },
        outputs: { result: { type: 'float', label: 'Result' } },
        params: { b: 0.04 } },
      { id: 'muli_7', type: 'multiply', position: { x: 1020, y: 260 },
        inputs: { a: { type: 'float', label: 'A', connection: { nodeId: 'mlg_4', outputKey: 'iterCount' } } },
        outputs: { result: { type: 'float', label: 'Result' } },
        params: { b: 0.005 } },
      { id: 'addp_8', type: 'add', position: { x: 1220, y: 210 },
        inputs: {
          a: { type: 'float', label: 'A', connection: { nodeId: 'muld_6', outputKey: 'result' } },
          b: { type: 'float', label: 'B', connection: { nodeId: 'muli_7', outputKey: 'result' } },
        },
        outputs: { result: { type: 'float', label: 'Result' } }, params: { b: 0.0 } },
      { id: 'pal_9', type: 'palette', position: { x: 1420, y: 180 },
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'addp_8', outputKey: 'result' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { offset: [0.5, 0.5, 0.5], amplitude: [0.5, 0.5, 0.5], freq: [1.0, 1.0, 1.0], phase: [0.3, 0.416, 0.557] } },

      // ── Output ────────────────────────────────────────────────────────────────
      { id: 'out_5', type: 'output', position: { x: 1660, y: 210 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'pal_9', outputKey: 'color' } } },
        outputs: {}, params: {} },
    ],
  },

  mlgSpiralTunnel: {
    label: 'MLG: Spiral Tunnel',
    counter: 10,
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
        params: { camDist: 3.0, camAngle: 0.0, rotSpeed: 0.0, fov: 1.5 },
      },
      {
        id: 'scene_3', type: 'sceneGroup', position: { x: 500, y: 380 },
        inputs: {},
        outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: 'Repeated Octahedra',
          subgraph: {
            nodes: [
              { id: 'sp',  type: 'scenePos',       position: { x: 60,  y: 140 }, inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'rep', type: 'repeat3D',        position: { x: 240, y: 140 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp', outputKey: 'pos' } } },
                outputs: { pos: { type: 'vec3', label: 'Repeated Pos' } }, params: { cellX: 1.2, cellY: 1.2, cellZ: 1.2 } },
              { id: 'sd',  type: 'octahedronSDF3D', position: { x: 440, y: 140 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'rep', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { size: 0.35 } },
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
          maxSteps: 100, maxDist: 30.0, stepScale: 0.85, bgR: 0.0, bgG: 0.0, bgB: 0.0,
          subgraph: {
            nodes: [
              { id: 'mp',   type: 'marchPos',  position: { x: 80,  y: 100 }, inputs: {}, outputs: { pos:  { type: 'vec3',  label: 'March Pos'  } }, params: {} },
              { id: 'md',   type: 'marchDist', position: { x: 80,  y: 220 }, inputs: {}, outputs: { dist: { type: 'float', label: 'March Dist' } }, params: {} },
              { id: 'time_b', type: 'time',    position: { x: 80,  y: 340 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time'       } }, params: {} },
              { id: 'warp', type: 'exprNode', position: { x: 340, y: 160 },
                inputs: {
                  p:    { type: 'vec3',  label: 'p (vec3)',   connection: { nodeId: 'mp',     outputKey: 'pos'  } },
                  t:    { type: 'float', label: 't (float)',  connection: { nodeId: 'md',     outputKey: 'dist' } },
                  time: { type: 'float', label: 'time',       connection: { nodeId: 'time_b', outputKey: 'time' } },
                  mx:   { type: 'float', label: 'mx (mouse x)' },
                  my:   { type: 'float', label: 'my (mouse y)' },
                  a:    { type: 'float', label: 'a (float)' },
                  b:    { type: 'float', label: 'b (float)' },
                },
                outputs: { result: { type: 'vec3', label: 'Result (vec3)' } },
                params: {
                  lines: [
                    { lhs: 'p.xy', op: '=', rhs: 'p.xy * rot2D(t * 0.2 + time * 0.05)' },
                    { lhs: 'p.y', op: '+=', rhs: 'sin(t * 1.5 + time) * 0.3' },
                  ],
                  result: 'p',
                  expr: 'p.xy = p.xy * rot2D(t * 0.2 + time * 0.05); p.y += sin(t * 1.5 + time) * 0.3; p',
                  outputType: 'vec3',
                } },
              { id: 'marchout', type: 'marchOutput', position: { x: 600, y: 160 },
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

  mlgAbsFold: {
    label: 'MLG: Abs Fold',
    counter: 10,
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
        id: 'scene_3', type: 'sceneGroup', position: { x: 500, y: 380 },
        inputs: {},
        outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: 'Sphere',
          subgraph: {
            nodes: [
              { id: 'sp', type: 'scenePos',    position: { x: 80,  y: 140 }, inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'sd', type: 'sphereSDF3D', position: { x: 280, y: 140 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { radius: 0.15 } },
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
          maxSteps: 160, maxDist: 20.0, stepScale: 0.7, bgR: 0.0, bgG: 0.0, bgB: 0.0,
          subgraph: {
            nodes: [
              { id: 'mp',   type: 'marchPos',  position: { x: 80,  y: 120 }, inputs: {}, outputs: { pos:  { type: 'vec3',  label: 'March Pos'  } }, params: {} },
              { id: 'md',   type: 'marchDist', position: { x: 80,  y: 240 }, inputs: {}, outputs: { dist: { type: 'float', label: 'March Dist' } }, params: {} },
              { id: 'time_b', type: 'time',    position: { x: 80,  y: 360 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time'       } }, params: {} },
              { id: 'warp', type: 'exprNode', position: { x: 340, y: 180 },
                inputs: {
                  p:    { type: 'vec3',  label: 'p (vec3)',  connection: { nodeId: 'mp',     outputKey: 'pos'  } },
                  t:    { type: 'float', label: 't (float)', connection: { nodeId: 'md',     outputKey: 'dist' } },
                  time: { type: 'float', label: 'time',      connection: { nodeId: 'time_b', outputKey: 'time' } },
                  mx:   { type: 'float', label: 'mx (mouse x)' },
                  my:   { type: 'float', label: 'my (mouse y)' },
                  a:    { type: 'float', label: 'a (float)' },
                  b:    { type: 'float', label: 'b (float)' },
                },
                outputs: { result: { type: 'vec3', label: 'Result (vec3)' } },
                params: {
                  lines: [
                    { lhs: 'p', op: '=', rhs: 'abs(p) - 0.6' },
                    { lhs: 'p', op: '=', rhs: 'abs(p) - 0.6' },
                    { lhs: 'p.xy', op: '=', rhs: 'p.xy * rot2D(t * 0.1 + time * 0.05)' },
                  ],
                  result: 'p',
                  expr: 'p = abs(p) - 0.6; p = abs(p) - 0.6; p.xy = p.xy * rot2D(t * 0.1 + time * 0.05); p',
                  outputType: 'vec3',
                } },
              { id: 'marchout', type: 'marchOutput', position: { x: 600, y: 180 },
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
        params: { offset: [0.5, 0.5, 0.5], amplitude: [0.5, 0.5, 0.5], freq: [1, 1, 1], phase: [0.0, 0.33, 0.67] },
      },
      {
        id: 'output_9', type: 'output', position: { x: 1640, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'pal_8', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },


  // ── 3D: SDF Boolean Ops — Smooth Union & Subtract ────────────────────────────
  sdfBooleanShowcase: {
    label: '3D: SDF Boolean Ops — Smooth Union & Subtract',
    counter: 16,
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
        params: { camDist: 3.5, camAngle: 0.4, rotSpeed: 0.15, fov: 1.5 },
      },
      {
        id: 'scene_3', type: 'sceneGroup', position: { x: 500, y: 380 },
        inputs: {},
        outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: 'Blobs',
          subgraph: {
            nodes: [
              { id: 'sp', type: 'scenePos', position: { x: 60, y: 200 }, inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'sphere_a', type: 'sphereSDF3D', position: { x: 280, y: 120 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { radius: 0.4 } },
              { id: 'tr_b', type: 'translate3D', position: { x: 280, y: 260 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp', outputKey: 'pos' } } },
                outputs: { pos: { type: 'vec3', label: 'Translated Pos' } }, params: { tx: 0.7, ty: 0.0, tz: 0.0 } },
              { id: 'sphere_b', type: 'sphereSDF3D', position: { x: 480, y: 260 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'tr_b', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { radius: 0.35 } },
              { id: 'su', type: 'sdfSmoothUnion', position: { x: 680, y: 180 },
                inputs: {
                  a: { type: 'float', label: 'A', connection: { nodeId: 'sphere_a', outputKey: 'dist' } },
                  b: { type: 'float', label: 'B', connection: { nodeId: 'sphere_b', outputKey: 'dist' } },
                },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { k: 0.2 } },
              { id: 'tr_c', type: 'translate3D', position: { x: 280, y: 400 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp', outputKey: 'pos' } } },
                outputs: { pos: { type: 'vec3', label: 'Translated Pos' } }, params: { tx: 0.3, ty: 0.5, tz: 0.0 } },
              { id: 'sphere_c', type: 'sphereSDF3D', position: { x: 480, y: 400 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'tr_c', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { radius: 0.25 } },
              { id: 'ss', type: 'sdfSmoothSubtract', position: { x: 880, y: 300 },
                inputs: {
                  cut:  { type: 'float', label: 'Cut',  connection: { nodeId: 'sphere_c', outputKey: 'dist' } },
                  base: { type: 'float', label: 'Base', connection: { nodeId: 'su',       outputKey: 'dist' } },
                },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { k: 0.1 } },
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
          bgR: 0.02, bgG: 0.02, bgB: 0.06,
          albedoR: 0.5, albedoG: 0.75, albedoB: 0.9,
          subgraph: {
            nodes: [
              { id: 'mp_b1', type: 'marchPos',    position: { x: 80,  y: 160 }, inputs: {}, outputs: { pos:  { type: 'vec3',  label: 'Position'   } }, params: {} },
              { id: 'md_b1', type: 'marchDist',   position: { x: 80,  y: 300 }, inputs: {}, outputs: { dist: { type: 'float', label: 'March Dist' }, t: { type: 'float', label: 't' } }, params: {} },
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

  // ── 3D: SDF Onion Shell ───────────────────────────────────────────────────────
  sdfOnionShell: {
    label: '3D: SDF Onion Shell',
    counter: 13,
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
        params: { camDist: 2.5, camAngle: 0.3, rotSpeed: 0.1, fov: 1.5 },
      },
      {
        id: 'scene_3', type: 'sceneGroup', position: { x: 500, y: 360 },
        inputs: {},
        outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: 'Onion Sphere',
          subgraph: {
            nodes: [
              { id: 'sp', type: 'scenePos', position: { x: 60, y: 180 }, inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'sphere', type: 'sphereSDF3D', position: { x: 260, y: 120 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { radius: 0.9 } },
              { id: 'onion', type: 'sdfOnion', position: { x: 460, y: 120 },
                inputs: { dist: { type: 'float', label: 'Distance', connection: { nodeId: 'sphere', outputKey: 'dist' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { r: 0.04 } },
              { id: 'plane', type: 'planeSDF3D', position: { x: 260, y: 280 },
                inputs: { p: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { height: 0.0 } },
              { id: 'intersect', type: 'sdfIntersect', position: { x: 660, y: 200 },
                inputs: {
                  a: { type: 'float', label: 'A', connection: { nodeId: 'onion', outputKey: 'dist' } },
                  b: { type: 'float', label: 'B', connection: { nodeId: 'plane', outputKey: 'dist' } },
                },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: {} },
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
          maxSteps: 100, maxDist: 20.0, stepScale: 0.85,
          bgR: 0.02, bgG: 0.02, bgB: 0.05,
          albedoR: 0.8, albedoG: 0.7, albedoB: 0.5,
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

  // ── 3D: New Primitives Gallery ────────────────────────────────────────────────
  sdfPrimitivesShowcase: {
    label: '3D: New Primitives — Rounded Box / Hex Prism / Pyramid',
    counter: 14,
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
        params: { camDist: 3.0, camAngle: 0.5, rotSpeed: 0.2, fov: 1.5 },
      },
      {
        id: 'scene_3', type: 'sceneGroup', position: { x: 500, y: 380 },
        inputs: {},
        outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: 'Primitives Gallery',
          subgraph: {
            nodes: [
              { id: 'sp', type: 'scenePos', position: { x: 60, y: 260 }, inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              // Rounded Box (center)
              { id: 'rb', type: 'roundedBoxSDF3D', position: { x: 280, y: 140 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { sizeX: 0.3, sizeY: 0.3, sizeZ: 0.3, radius: 0.08 } },
              // Hex Prism (right)
              { id: 'tr_hex', type: 'translate3D', position: { x: 280, y: 280 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp', outputKey: 'pos' } } },
                outputs: { pos: { type: 'vec3', label: 'Translated Pos' } }, params: { tx: 1.4, ty: 0.0, tz: 0.0 } },
              { id: 'hex', type: 'hexPrismSDF3D', position: { x: 480, y: 280 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'tr_hex', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { radius: 0.35, height: 0.2 } },
              // Pyramid (left)
              { id: 'tr_pyr', type: 'translate3D', position: { x: 280, y: 420 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp', outputKey: 'pos' } } },
                outputs: { pos: { type: 'vec3', label: 'Translated Pos' } }, params: { tx: -1.4, ty: 0.0, tz: 0.0 } },
              { id: 'pyr', type: 'pyramidSDF3D', position: { x: 480, y: 420 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'tr_pyr', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { height: 0.7 } },
              // Union all three
              { id: 'u1', type: 'sdfUnion', position: { x: 680, y: 200 },
                inputs: {
                  a: { type: 'float', label: 'A', connection: { nodeId: 'rb',  outputKey: 'dist' } },
                  b: { type: 'float', label: 'B', connection: { nodeId: 'hex', outputKey: 'dist' } },
                },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: {} },
              { id: 'u2', type: 'sdfUnion', position: { x: 880, y: 300 },
                inputs: {
                  a: { type: 'float', label: 'A', connection: { nodeId: 'u1',  outputKey: 'dist' } },
                  b: { type: 'float', label: 'B', connection: { nodeId: 'pyr', outputKey: 'dist' } },
                },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: {} },
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
          bgR: 0.02, bgG: 0.02, bgB: 0.06,
          albedoR: 0.6, albedoG: 0.8, albedoB: 1.0,
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

  // ── 3D: Polar Repeat — Radial Symmetry ───────────────────────────────────────
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
  sdfRoundedBox: {
    label: '3D: Rounded Box',
    counter: 6,
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
          label: '3D: Rounded Box',
          subgraph: {
            nodes: [
              { id: 'sp', type: 'scenePos', position: { x: 60, y: 200 }, inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'rb', type: 'roundedBoxSDF3D', position: { x: 280, y: 200 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } },
                params: { sizeX: 0.35, sizeY: 0.35, sizeZ: 0.35, radius: 0.1 } },
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
          albedoR: 0.5, albedoG: 0.75, albedoB: 0.9,
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

  // ── 3D: Box Frame (Wireframe) ─────────────────────────────────────────────────
  sdfBoxFrame: {
    label: '3D: Box Frame (Wireframe)',
    counter: 6,
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
          label: '3D: Box Frame (Wireframe)',
          subgraph: {
            nodes: [
              { id: 'sp', type: 'scenePos', position: { x: 60, y: 200 }, inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'time_sg', type: 'time', position: { x: 60, y: 360 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
              { id: 'rot', type: 'rotateAxis3D', position: { x: 280, y: 200 },
                inputs: {
                  p:     { type: 'vec3',  label: 'Position', connection: { nodeId: 'sp',      outputKey: 'pos'  } },
                  angle: { type: 'float', label: 'Angle',    connection: { nodeId: 'time_sg', outputKey: 'time' } },
                },
                outputs: { p: { type: 'vec3', label: 'Rotated Pos' } },
                params: { angle: 0.0, ax: 0.5, ay: 1.0, az: 0.0 } },
              { id: 'bf', type: 'boxFrameSDF3D', position: { x: 500, y: 200 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'rot', outputKey: 'p' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } },
                params: { sizeX: 0.5, sizeY: 0.5, sizeZ: 0.5, thickness: 0.05 } },
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
          albedoR: 0.9, albedoG: 0.8, albedoB: 0.5,
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

  // ── 3D: Capped Cone ───────────────────────────────────────────────────────────
  sdfCappedCone: {
    label: '3D: Capped Cone',
    counter: 6,
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
          label: '3D: Capped Cone',
          subgraph: {
            nodes: [
              { id: 'sp', type: 'scenePos', position: { x: 60, y: 200 }, inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'cc', type: 'cappedConeSDF3D', position: { x: 280, y: 200 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } },
                params: { height: 0.6, r1: 0.5, r2: 0.1 } },
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
          albedoR: 0.9, albedoG: 0.5, albedoB: 0.3,
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

  // ── 3D: Hex Prism ─────────────────────────────────────────────────────────────
  sdfHexPrism: {
    label: '3D: Hex Prism',
    counter: 8,
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
          label: '3D: Hex Prism',
          subgraph: {
            nodes: [
              { id: 'sp', type: 'scenePos', position: { x: 60, y: 200 }, inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'hp', type: 'hexPrismSDF3D', position: { x: 280, y: 120 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } },
                params: { height: 0.3, radius: 0.4 } },
              { id: 'pl', type: 'planeSDF3D', position: { x: 280, y: 280 },
                inputs: { p: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } },
                params: { height: -0.6 } },
              { id: 'un', type: 'sdfUnion', position: { x: 500, y: 200 },
                inputs: {
                  a: { type: 'float', label: 'A', connection: { nodeId: 'hp', outputKey: 'dist' } },
                  b: { type: 'float', label: 'B', connection: { nodeId: 'pl', outputKey: 'dist' } },
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
          albedoR: 0.4, albedoG: 0.8, albedoB: 0.6,
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

  // ── 3D: Bend Deform ───────────────────────────────────────────────────────────
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
  mengerSponge3D: {
    label: '3D: Menger Sponge',
    counter: 5,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 60, y: 200 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 60, y: 380 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'scene_2', type: 'sceneGroup', position: { x: 310, y: 230 },
        inputs: {},
        outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: 'Menger Scene',
          subgraph: {
            nodes: [
              {
                id: 'sp_sg', type: 'scenePos', position: { x: 60, y: 180 },
                inputs: {},
                outputs: { pos: { type: 'vec3', label: 'Position' } },
                params: {},
              },
              {
                id: 'time_sg', type: 'time', position: { x: 60, y: 340 },
                inputs: {},
                outputs: { time: { type: 'float', label: 'Time' } },
                params: {},
              },
              // Slowly rotate the sponge on two axes
              {
                id: 'rot_sg', type: 'rotate3D', position: { x: 260, y: 240 },
                inputs: {
                  pos:  { type: 'vec3',  label: 'Position', connection: { nodeId: 'sp_sg',   outputKey: 'pos'  } },
                  time: { type: 'float', label: 'Time',     connection: { nodeId: 'time_sg', outputKey: 'time' } },
                },
                outputs: { pos: { type: 'vec3', label: 'Rotated Pos' } },
                params: { rx: 0.2, ry: 0.4, rz: 0.0, speed: 0.25 },
              },
              {
                id: 'menger_sg', type: 'mengerSponge', position: { x: 460, y: 240 },
                inputs: {
                  pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'rot_sg', outputKey: 'pos' } },
                },
                outputs: { dist: { type: 'float', label: 'Distance' } },
                params: { size: 0.85, iterations: 3 },
              },
            ],
            outputNodeId: 'menger_sg',
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
        params: { camDist: 3.5, fov: 1.5, maxSteps: 120, maxDist: 20.0, lightX: 2.0, lightY: 3.0, lightZ: 2.5, bgR: 0.03, bgG: 0.03, bgB: 0.06, albedoR: 0.55, albedoG: 0.6, albedoB: 0.65 },
      },
      {
        id: 'out_4', type: 'output', position: { x: 860, y: 200 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'ray_3', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── 2D: Angular Repeat — Gear ─────────────────────────────────────────────────
  // Like angularFlowerRepeat but uses a box SDF to make a gear/star shape
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
  softShadowTorus: {
    label: '3D Lighting: Soft Shadow Torus',
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
        params: { camDist: 3.5, camAngle: 0.8, rotSpeed: 0.15, fov: 1.5 },
      },
      {
        id: 'scene_3', type: 'sceneGroup', position: { x: 520, y: 440 },
        inputs: {}, outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: 'Torus',
          subgraph: {
            nodes: [
              { id: 'sp_sg',  type: 'scenePos',   position: { x: 80,  y: 180 }, inputs: {}, outputs: { pos:  { type: 'vec3',  label: 'Position' } }, params: {} },
              { id: 'sdf_sg', type: 'torusSDF3D', position: { x: 280, y: 180 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp_sg', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { majorR: 0.6, minorR: 0.2 } },
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
          maxSteps: 100, maxDist: 20.0, stepScale: 1.0,
          bgR: 0.04, bgG: 0.05, bgB: 0.1,
          albedoR: 0.7, albedoG: 0.8, albedoB: 0.95,
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
        id: 'shad_5', type: 'softShadow', position: { x: 1060, y: 200 },
        inputs: {
          scene:  { type: 'scene3d', label: 'Scene',   connection: { nodeId: 'scene_3', outputKey: 'scene'  } },
          pos:    { type: 'vec3',    label: 'Hit Pos', connection: { nodeId: 'mlg_4',   outputKey: 'pos'    } },
          normal: { type: 'vec3',    label: 'Normal',  connection: { nodeId: 'mlg_4',   outputKey: 'normal' } },
          hit:    { type: 'float',   label: 'Hit',     connection: { nodeId: 'mlg_4',   outputKey: 'hit'    } },
          lightDir: { type: 'vec3', label: 'Light Dir' },
        },
        outputs: { shadow: { type: 'float', label: 'Shadow' } }, params: { k: 12.0, tmax: 20.0 },
      },
      {
        id: 'mul_6', type: 'multiplyVec3', position: { x: 1280, y: 200 },
        inputs: {
          color: { type: 'vec3',  label: 'Color', connection: { nodeId: 'mlg_4',   outputKey: 'color'  } },
          scale: { type: 'float', label: 'Scale', connection: { nodeId: 'shad_5',  outputKey: 'shadow' } },
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

  // ── 3D Lighting: Multi-Light (IQ Outdoor Rig) ─────────────────────────────
  // Sun diffuse + sky dome + bounce light. AO and soft shadow feed the rig.
  // Note: MultiLight already applies gamma (pow 0.4545). Do NOT add ToneMap.
  multiLightScene: {
    label: '3D Lighting: Multi-Light Rig',
    counter: 10,
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
        params: { camDist: 3.0, camAngle: 0.5, rotSpeed: 0.15, fov: 1.5 },
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
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { radius: 0.65 } },
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
          bgR: 0.1, bgG: 0.15, bgB: 0.3,
          albedoR: 0.6, albedoG: 0.55, albedoB: 0.5,
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
        id: 'ao_5', type: 'sdfAo', position: { x: 1060, y: 140 },
        inputs: {
          scene:  { type: 'scene3d', label: 'Scene',   connection: { nodeId: 'scene_3', outputKey: 'scene'  } },
          pos:    { type: 'vec3',    label: 'Hit Pos', connection: { nodeId: 'mlg_4',   outputKey: 'pos'    } },
          normal: { type: 'vec3',    label: 'Normal',  connection: { nodeId: 'mlg_4',   outputKey: 'normal' } },
          hit:    { type: 'float',   label: 'Hit',     connection: { nodeId: 'mlg_4',   outputKey: 'hit'    } },
        },
        outputs: { ao: { type: 'float', label: 'AO' } }, params: { stepDist: 0.04 },
      },
      {
        id: 'shad_6', type: 'softShadow', position: { x: 1060, y: 320 },
        inputs: {
          scene:    { type: 'scene3d', label: 'Scene',     connection: { nodeId: 'scene_3', outputKey: 'scene'  } },
          pos:      { type: 'vec3',    label: 'Hit Pos',   connection: { nodeId: 'mlg_4',   outputKey: 'pos'    } },
          normal:   { type: 'vec3',    label: 'Normal',    connection: { nodeId: 'mlg_4',   outputKey: 'normal' } },
          hit:      { type: 'float',   label: 'Hit',       connection: { nodeId: 'mlg_4',   outputKey: 'hit'    } },
          lightDir: { type: 'vec3',    label: 'Light Dir' },
        },
        outputs: { shadow: { type: 'float', label: 'Shadow' } }, params: { k: 16.0, tmax: 20.0 },
      },
      {
        id: 'ml_7', type: 'multiLight', position: { x: 1300, y: 220 },
        inputs: {
          baseColor: { type: 'vec3',  label: 'Base Color', connection: { nodeId: 'mlg_4',   outputKey: 'color'  } },
          normal:    { type: 'vec3',  label: 'Normal',     connection: { nodeId: 'mlg_4',   outputKey: 'normal' } },
          hit:       { type: 'float', label: 'Hit',        connection: { nodeId: 'mlg_4',   outputKey: 'hit'    } },
          ao:        { type: 'float', label: 'AO',         connection: { nodeId: 'ao_5',    outputKey: 'ao'     } },
          shadow:    { type: 'float', label: 'Shadow',     connection: { nodeId: 'shad_6',  outputKey: 'shadow' } },
          sunDir:    { type: 'vec3',  label: 'Sun Dir' },
        },
        outputs: { color: { type: 'vec3', label: 'Lit Color' } },
        params: { sunDirX: 0.6, sunDirY: 0.7, sunDirZ: 0.4, sunR: 1.0, sunG: 0.9, sunB: 0.7, skyR: 0.25, skyG: 0.4, skyB: 0.7, bounceR: 0.1, bounceG: 0.08, bounceB: 0.05 },
      },
      {
        id: 'out_8', type: 'output', position: { x: 1540, y: 240 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'ml_7', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── 3D Lighting: Fresnel Rim Glow ─────────────────────────────────────────
  // Fresnel factor approaches 1 at grazing/silhouette angles.
  // Wire cam rd as viewDir; scale a blue rim color by fresnel and add to base.
  fresnelGlowSphere: {
    label: '3D Lighting: Fresnel Rim Glow',
    counter: 11,
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
        params: { camDist: 3.0, camAngle: 0.4, rotSpeed: 0.2, fov: 1.5 },
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
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { radius: 0.65 } },
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
          bgR: 0.02, bgG: 0.02, bgB: 0.08,
          albedoR: 0.15, albedoG: 0.15, albedoB: 0.25,
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
        id: 'fr_5', type: 'fresnel3d', position: { x: 1060, y: 200 },
        inputs: {
          normal:  { type: 'vec3', label: 'Normal',   connection: { nodeId: 'mlg_4', outputKey: 'normal' } },
          viewDir: { type: 'vec3', label: 'View Dir', connection: { nodeId: 'cam_2', outputKey: 'rd'     } },
        },
        outputs: { fresnel: { type: 'float', label: 'Fresnel' } }, params: { power: 3.0 },
      },
      {
        id: 'rimC_6', type: 'makeVec3', position: { x: 1060, y: 360 },
        inputs: { r: { type: 'float', label: 'R' }, g: { type: 'float', label: 'G' }, b: { type: 'float', label: 'B' } },
        outputs: { rgb: { type: 'vec3', label: 'RGB' } },
        params: { r: 0.2, g: 0.5, b: 1.0 },
      },
      {
        id: 'scl_7', type: 'multiplyVec3', position: { x: 1280, y: 280 },
        inputs: {
          color: { type: 'vec3',  label: 'Color', connection: { nodeId: 'rimC_6', outputKey: 'rgb'     } },
          scale: { type: 'float', label: 'Scale', connection: { nodeId: 'fr_5',   outputKey: 'fresnel' } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } }, params: { scale: 1.0 },
      },
      {
        id: 'add_8', type: 'addVec3', position: { x: 1480, y: 240 },
        inputs: {
          a: { type: 'vec3', label: 'A', connection: { nodeId: 'mlg_4',  outputKey: 'color'  } },
          b: { type: 'vec3', label: 'B', connection: { nodeId: 'scl_7',  outputKey: 'result' } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } }, params: {},
      },
      {
        id: 'out_9', type: 'output', position: { x: 1700, y: 260 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'add_8', outputKey: 'result' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── 3D Lighting: Fake SSS (Subsurface Scattering) ─────────────────────────
  // Beer's law thickness estimation. Wax/jade/soap look. Connect same SceneGroup.
  // Try setting albedo to pale green or off-white for a jade or soap effect.
  fakeSSSWax: {
    label: '3D Lighting: Fake SSS (Wax)',
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
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { radius: 0.75 } },
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
          bgR: 0.06, bgG: 0.04, bgB: 0.08,
          albedoR: 0.85, albedoG: 0.78, albedoB: 0.7,
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
        id: 'sss_5', type: 'fakeSSS', position: { x: 1060, y: 200 },
        inputs: {
          scene:    { type: 'scene3d', label: 'Scene',     connection: { nodeId: 'scene_3', outputKey: 'scene'  } },
          pos:      { type: 'vec3',    label: 'Hit Pos',   connection: { nodeId: 'mlg_4',   outputKey: 'pos'    } },
          normal:   { type: 'vec3',    label: 'Normal',    connection: { nodeId: 'mlg_4',   outputKey: 'normal' } },
          hit:      { type: 'float',   label: 'Hit',       connection: { nodeId: 'mlg_4',   outputKey: 'hit'    } },
          lightDir: { type: 'vec3',    label: 'Light Dir' },
          sssColor: { type: 'vec3',    label: 'SSS Color' },
        },
        outputs: { sss: { type: 'vec3', label: 'SSS' } },
        params: { strength: 1.5, stepSize: 0.06, sssR: 0.9, sssG: 0.35, sssB: 0.15 },
      },
      {
        id: 'add_6', type: 'addVec3', position: { x: 1280, y: 240 },
        inputs: {
          a: { type: 'vec3', label: 'A', connection: { nodeId: 'mlg_4', outputKey: 'color' } },
          b: { type: 'vec3', label: 'B', connection: { nodeId: 'sss_5', outputKey: 'sss'   } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } }, params: {},
      },
      {
        id: 'out_7', type: 'output', position: { x: 1500, y: 260 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'add_6', outputKey: 'result' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── 3D Lighting: Volumetric Fog ────────────────────────────────────────────
  // Exponential depth fog. Wire depth + hit from MarchLoopGroup.
  // Increase density (try 1.0–3.0) for thick atmosphere; reduce for haze.
  foggyScene: {
    label: '3D Lighting: Volumetric Fog',
    counter: 8,
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
        params: { camDist: 4.0, camAngle: 0.4, rotSpeed: 0.1, fov: 1.5 },
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
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { radius: 0.6 } },
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
          bgR: 0.6, bgG: 0.65, bgB: 0.7,
          albedoR: 0.8, albedoG: 0.4, albedoB: 0.2,
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
        id: 'fog_5', type: 'volumetricFog', position: { x: 1060, y: 220 },
        inputs: {
          color:    { type: 'vec3',  label: 'Color',     connection: { nodeId: 'mlg_4', outputKey: 'color' } },
          depth:    { type: 'float', label: 'Depth',     connection: { nodeId: 'mlg_4', outputKey: 'depth' } },
          hit:      { type: 'float', label: 'Hit',       connection: { nodeId: 'mlg_4', outputKey: 'hit'   } },
          fogColor: { type: 'vec3',  label: 'Fog Color' },
        },
        outputs: { color: { type: 'vec3', label: 'Fogged' } },
        params: { density: 0.8, fogR: 0.65, fogG: 0.7, fogB: 0.75 },
      },
      {
        id: 'out_6', type: 'output', position: { x: 1300, y: 240 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'fog_5', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── 3D Fractals: Mandelbox (MLG) ──────────────────────────────────────────
  // Mandelbox distance estimator. scale ∈ [-3, -0.5] controls shape.
  // iterCount → palette gives rich fractal edge coloring.
  mandelboxMLG: {
    label: '3D Fractals: Mandelbox',
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
        params: { camDist: 4.0, camAngle: 0.5, rotSpeed: 0.1, fov: 1.4 },
      },
      {
        id: 'scene_3', type: 'sceneGroup', position: { x: 520, y: 440 },
        inputs: {}, outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: 'Mandelbox',
          subgraph: {
            nodes: [
              { id: 'sp_sg',   type: 'scenePos',    position: { x: 80,  y: 200 }, inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'mbox_sg', type: 'mandelboxDE', position: { x: 280, y: 200 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp_sg', outputKey: 'pos' } } },
                outputs: { orbit: { type: 'float', label: 'Orbit Trap' }, distance: { type: 'float', label: 'Distance' } },
                params: { iterations: 10, scale: -1.5, foldLimit: 1.0, minR: 0.5, fixedR: 1.0 } },
            ],
            outputNodeId: 'mbox_sg',
            outputKey: 'distance',
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
          maxSteps: 96, maxDist: 20.0, stepScale: 0.7,
          bgR: 0.0, bgG: 0.0, bgB: 0.02,
          albedoR: 0.5, albedoG: 0.5, albedoB: 0.5,
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
        id: 'mul_5', type: 'multiply', position: { x: 1060, y: 240 },
        inputs: { a: { type: 'float', label: 'A', connection: { nodeId: 'mlg_4', outputKey: 'iterCount' } } },
        outputs: { result: { type: 'float', label: 'Result' } }, params: { b: 0.025 },
      },
      {
        id: 'pal_6', type: 'palette', position: { x: 1260, y: 220 },
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'mul_5', outputKey: 'result' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { offset: [0.5, 0.4, 0.3], amplitude: [0.5, 0.4, 0.3], freq: [1.0, 1.0, 1.0], phase: [0.0, 0.2, 0.5] },
      },
      {
        id: 'out_7', type: 'output', position: { x: 1480, y: 240 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'pal_6', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── 3D Fractals: KIFS Tetrahedron (MLG) ───────────────────────────────────
  // Kaleidoscopic IFS tetrahedron. Fold-and-scale repeated in 3D.
  // iterCount → palette reveals crystal-like edge structure.
  kifsTetraMLG: {
    label: '3D Fractals: KIFS Tetrahedron',
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
        params: { camDist: 3.5, camAngle: 0.6, rotSpeed: 0.15, fov: 1.4 },
      },
      {
        id: 'scene_3', type: 'sceneGroup', position: { x: 520, y: 440 },
        inputs: {}, outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: 'KIFS Tetrahedron',
          subgraph: {
            nodes: [
              { id: 'sp_sg',   type: 'scenePos',   position: { x: 80,  y: 200 }, inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'kifs_sg', type: 'kifsTetra',  position: { x: 280, y: 200 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp_sg', outputKey: 'pos' } } },
                outputs: { distance: { type: 'float', label: 'Distance' } },
                params: { iterations: 10, scale: 2.0, offsetX: 1.0, offsetY: 1.0, offsetZ: 1.0 } },
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
          maxSteps: 150, maxDist: 20.0, stepScale: 0.75,
          bgR: 0.0, bgG: 0.01, bgB: 0.03,
          albedoR: 0.5, albedoG: 0.5, albedoB: 0.5,
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
        id: 'mul_5', type: 'multiply', position: { x: 1060, y: 240 },
        inputs: { a: { type: 'float', label: 'A', connection: { nodeId: 'mlg_4', outputKey: 'iterCount' } } },
        outputs: { result: { type: 'float', label: 'Result' } }, params: { b: 0.02 },
      },
      {
        id: 'pal_6', type: 'palette', position: { x: 1260, y: 220 },
        inputs: { t: { type: 'float', label: 'T', connection: { nodeId: 'mul_5', outputKey: 'result' } } },
        outputs: { color: { type: 'vec3', label: 'Color' } },
        params: { offset: [0.5, 0.5, 0.5], amplitude: [0.4, 0.3, 0.5], freq: [1.0, 1.0, 1.0], phase: [0.5, 0.2, 0.0] },
      },
      {
        id: 'out_7', type: 'output', position: { x: 1480, y: 240 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'pal_6', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── 3D Fractals: Menger Sponge (MLG) ──────────────────────────────────────
  // Like mengerSponge3D but using MarchLoopGroup for full output control.
  // MLG outputs: normal, pos, hit are available for post-processing.
  mengerMLG: {
    label: '3D Fractals: Menger Sponge (MLG)',
    counter: 7,
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
        params: { camDist: 3.5, camAngle: 0.5, rotSpeed: 0.2, fov: 1.5 },
      },
      {
        id: 'scene_3', type: 'sceneGroup', position: { x: 520, y: 440 },
        inputs: {}, outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: 'Menger Sponge',
          subgraph: {
            nodes: [
              { id: 'sp_sg',  type: 'scenePos', position: { x: 60, y: 180 }, inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'time_sg', type: 'time',    position: { x: 60, y: 340 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
              { id: 'rot_sg', type: 'rotate3D', position: { x: 260, y: 240 },
                inputs: {
                  pos:  { type: 'vec3',  label: 'Position', connection: { nodeId: 'sp_sg',   outputKey: 'pos'  } },
                  time: { type: 'float', label: 'Time',     connection: { nodeId: 'time_sg', outputKey: 'time' } },
                },
                outputs: { pos: { type: 'vec3', label: 'Rotated Pos' } },
                params: { rx: 0.25, ry: 0.3, rz: 0.0, speed: 0.2 } },
              { id: 'menger_sg', type: 'mengerSponge', position: { x: 460, y: 240 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'rot_sg', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } },
                params: { size: 0.85, iterations: 3 } },
            ],
            outputNodeId: 'menger_sg', outputKey: 'dist',
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
          maxSteps: 150, maxDist: 20.0, stepScale: 0.75,
          bgR: 0.03, bgG: 0.03, bgB: 0.07,
          albedoR: 0.55, albedoG: 0.6, albedoB: 0.65,
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
        id: 'out_5', type: 'output', position: { x: 1060, y: 240 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'mlg_4', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── 3D Fractals: Mandelbulb Orbit Color ───────────────────────────────────
  // Mandelbulb preset node. orbit output is vec3 (multi-component trap).
  // Scale it up and add to the diffuse color for iridescent orbit-trap shading.
  mandelbulbOrbitColor: {
    label: '3D Fractals: Mandelbulb Orbit Trap',
    counter: 7,
    nodes: [
      { id: 'uv_0',   type: 'uv',   position: { x: 60, y: 200 }, inputs: {}, outputs: { uv:   { type: 'vec2',  label: 'UV'   } }, params: {} },
      { id: 'time_1', type: 'time', position: { x: 60, y: 360 }, inputs: {}, outputs: { time: { type: 'float', label: 'Time' } }, params: {} },
      {
        id: 'mb_2', type: 'mandelbulb', position: { x: 280, y: 280 },
        inputs: {
          uv:   { type: 'vec2',  label: 'UV',   connection: { nodeId: 'uv_0',   outputKey: 'uv'   } },
          time: { type: 'float', label: 'Time', connection: { nodeId: 'time_1', outputKey: 'time' } },
        },
        outputs: { color: { type: 'vec3', label: 'Color' }, depth: { type: 'float', label: 'Depth' }, orbit: { type: 'vec3', label: 'Orbit Trap' } },
        params: { power: 8, bailout: 2.0, max_iter: 10, max_steps: 64, max_dist: 5.0, cam_dist: 2.5, cam_height: 0.5, cam_speed: 0.2, cam_fov: 1.5, ambient: 0.05, light_x: 2.0, light_y: 4.0, light_z: 2.0, palette_preset: '3', bg_color: [0.03, 0.02, 0.08] },
      },
      {
        id: 'mul_3', type: 'multiplyVec3', position: { x: 560, y: 380 },
        inputs: {
          color: { type: 'vec3',  label: 'Color', connection: { nodeId: 'mb_2', outputKey: 'orbit' } },
          scale: { type: 'float', label: 'Scale' },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } }, params: { scale: 1.5 },
      },
      {
        id: 'add_4', type: 'addVec3', position: { x: 780, y: 300 },
        inputs: {
          a: { type: 'vec3', label: 'A', connection: { nodeId: 'mb_2', outputKey: 'color'  } },
          b: { type: 'vec3', label: 'B', connection: { nodeId: 'mul_3', outputKey: 'result' } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } }, params: {},
      },
      {
        id: 'out_5', type: 'output', position: { x: 1000, y: 320 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'add_4', outputKey: 'result' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── 3D Lighting: Glass Sphere ──────────────────────────────────────────────
  // Single-refraction glass with chromatic dispersion and Fresnel.
  // Wire cam.rd as rayDir; bgColor defaults to dark sky if unconnected.
  glassSphereScene: {
    label: '3D Lighting: Glass Sphere',
    counter: 8,
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
        params: { camDist: 3.0, camAngle: 0.4, rotSpeed: 0.2, fov: 1.5 },
      },
      {
        id: 'scene_3', type: 'sceneGroup', position: { x: 520, y: 440 },
        inputs: {}, outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: 'Glass Sphere',
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
          bgR: 0.04, bgG: 0.06, bgB: 0.12,
          albedoR: 0.5, albedoG: 0.5, albedoB: 0.5,
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
        id: 'glass_5', type: 'glass3d', position: { x: 1060, y: 220 },
        inputs: {
          rayDir:    { type: 'vec3',  label: 'Ray Dir',    connection: { nodeId: 'cam_2',  outputKey: 'rd'     } },
          normal:    { type: 'vec3',  label: 'Normal',     connection: { nodeId: 'mlg_4',  outputKey: 'normal' } },
          hit:       { type: 'float', label: 'Hit',        connection: { nodeId: 'mlg_4',  outputKey: 'hit'    } },
          bgColor:   { type: 'vec3',  label: 'Background' },
          tintColor: { type: 'vec3',  label: 'Tint' },
        },
        outputs: { color: { type: 'vec3', label: 'Glass Color' } },
        params: { ior: 1.5, fresnelPow: 4.0, dispersion: 0.04, tintR: 0.75, tintG: 0.92, tintB: 1.0 },
      },
      {
        id: 'out_6', type: 'output', position: { x: 1300, y: 240 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'glass_5', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── 3D Fractals: Mandelbox + AO + Multi-Light ─────────────────────────────
  // Mandelbox lit with the full IQ outdoor rig minus fog.
  // AO feeds the multi-light sky contribution; shadow left at default 1.0.
  mandelboxLit: {
    label: '3D Fractals: Mandelbox + Multi-Light',
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
        params: { camDist: 4.5, camAngle: 0.5, rotSpeed: 0.08, fov: 1.4 },
      },
      {
        id: 'scene_3', type: 'sceneGroup', position: { x: 520, y: 440 },
        inputs: {}, outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: 'Mandelbox',
          subgraph: {
            nodes: [
              { id: 'sp_sg',   type: 'scenePos',    position: { x: 80,  y: 200 }, inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'mbox_sg', type: 'mandelboxDE', position: { x: 280, y: 200 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp_sg', outputKey: 'pos' } } },
                outputs: { orbit: { type: 'float', label: 'Orbit Trap' }, distance: { type: 'float', label: 'Distance' } },
                params: { iterations: 10, scale: -2.0, foldLimit: 1.0, minR: 0.5, fixedR: 1.0 } },
            ],
            outputNodeId: 'mbox_sg',
            outputKey: 'distance',
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
          maxSteps: 96, maxDist: 20.0, stepScale: 0.65,
          bgR: 0.08, bgG: 0.1, bgB: 0.18,
          albedoR: 0.55, albedoG: 0.5, albedoB: 0.45,
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
        id: 'ao_5', type: 'sdfAo', position: { x: 1060, y: 180 },
        inputs: {
          scene:  { type: 'scene3d', label: 'Scene',   connection: { nodeId: 'scene_3', outputKey: 'scene'  } },
          pos:    { type: 'vec3',    label: 'Hit Pos', connection: { nodeId: 'mlg_4',   outputKey: 'pos'    } },
          normal: { type: 'vec3',    label: 'Normal',  connection: { nodeId: 'mlg_4',   outputKey: 'normal' } },
          hit:    { type: 'float',   label: 'Hit',     connection: { nodeId: 'mlg_4',   outputKey: 'hit'    } },
        },
        outputs: { ao: { type: 'float', label: 'AO' } }, params: { stepDist: 0.06 },
      },
      {
        id: 'ml_6', type: 'multiLight', position: { x: 1280, y: 220 },
        inputs: {
          baseColor: { type: 'vec3',  label: 'Base Color', connection: { nodeId: 'mlg_4',  outputKey: 'color'  } },
          normal:    { type: 'vec3',  label: 'Normal',     connection: { nodeId: 'mlg_4',  outputKey: 'normal' } },
          hit:       { type: 'float', label: 'Hit',        connection: { nodeId: 'mlg_4',  outputKey: 'hit'    } },
          ao:        { type: 'float', label: 'AO',         connection: { nodeId: 'ao_5',   outputKey: 'ao'     } },
          shadow:    { type: 'float', label: 'Shadow' },
          sunDir:    { type: 'vec3',  label: 'Sun Dir' },
        },
        outputs: { color: { type: 'vec3', label: 'Lit Color' } },
        params: { sunDirX: 0.5, sunDirY: 0.8, sunDirZ: 0.3, sunR: 1.1, sunG: 0.95, sunB: 0.75, skyR: 0.2, skyG: 0.35, skyB: 0.6, bounceR: 0.08, bounceG: 0.07, bounceB: 0.05 },
      },
      {
        id: 'out_7', type: 'output', position: { x: 1520, y: 240 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'ml_6', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── 3D Fractals: KIFS Tetrahedron + Fake SSS ──────────────────────────────
  // Crystal-like fractal with subsurface glow for an alien coral / gem effect.
  // SSS light transmits through thin edges; adjust strength + color to taste.
  kifsTetraSSS: {
    label: '3D Fractals: KIFS Tetra + SSS',
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
        params: { camDist: 3.5, camAngle: 0.5, rotSpeed: 0.15, fov: 1.4 },
      },
      {
        id: 'scene_3', type: 'sceneGroup', position: { x: 520, y: 440 },
        inputs: {}, outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: 'KIFS Tetrahedron',
          subgraph: {
            nodes: [
              { id: 'sp_sg',   type: 'scenePos',  position: { x: 80,  y: 200 }, inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'kifs_sg', type: 'kifsTetra', position: { x: 280, y: 200 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp_sg', outputKey: 'pos' } } },
                outputs: { distance: { type: 'float', label: 'Distance' } },
                params: { iterations: 12, scale: 2.0, offsetX: 1.0, offsetY: 1.0, offsetZ: 1.0 } },
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
          maxSteps: 150, maxDist: 20.0, stepScale: 0.75,
          bgR: 0.0, bgG: 0.02, bgB: 0.05,
          albedoR: 0.3, albedoG: 0.65, albedoB: 0.55,
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
        id: 'sss_5', type: 'fakeSSS', position: { x: 1060, y: 200 },
        inputs: {
          scene:    { type: 'scene3d', label: 'Scene',     connection: { nodeId: 'scene_3', outputKey: 'scene'  } },
          pos:      { type: 'vec3',    label: 'Hit Pos',   connection: { nodeId: 'mlg_4',   outputKey: 'pos'    } },
          normal:   { type: 'vec3',    label: 'Normal',    connection: { nodeId: 'mlg_4',   outputKey: 'normal' } },
          hit:      { type: 'float',   label: 'Hit',       connection: { nodeId: 'mlg_4',   outputKey: 'hit'    } },
          lightDir: { type: 'vec3',    label: 'Light Dir' },
          sssColor: { type: 'vec3',    label: 'SSS Color' },
        },
        outputs: { sss: { type: 'vec3', label: 'SSS' } },
        params: { strength: 2.0, stepSize: 0.04, sssR: 0.2, sssG: 0.9, sssB: 0.6 },
      },
      {
        id: 'add_6', type: 'addVec3', position: { x: 1280, y: 240 },
        inputs: {
          a: { type: 'vec3', label: 'A', connection: { nodeId: 'mlg_4', outputKey: 'color' } },
          b: { type: 'vec3', label: 'B', connection: { nodeId: 'sss_5', outputKey: 'sss'   } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } }, params: {},
      },
      {
        id: 'out_7', type: 'output', position: { x: 1500, y: 260 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'add_6', outputKey: 'result' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── Full Lighting Rig: AO + Shadow + Multi-Light + Fog ────────────────────
  // Complete PBR-ish pipeline: SDF AO → soft shadow → multi-light → depth fog.
  // Sphere + infinite ground plane using sdfUnion.
  fullLightRig: {
    label: '3D Full Rig: AO + Shadow + MultiLight + Fog',
    counter: 11,
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
        params: { camDist: 3.5, camAngle: 0.4, rotSpeed: 0.15, fov: 1.5 },
      },
      {
        id: 'scene_3', type: 'sceneGroup', position: { x: 520, y: 460 },
        inputs: {}, outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: 'Sphere + Ground',
          subgraph: {
            nodes: [
              { id: 'sp_sg',    type: 'scenePos',    position: { x: 60,  y: 180 }, inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'sph_sg',   type: 'sphereSDF3D', position: { x: 260, y: 140 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp_sg', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { radius: 0.6 } },
              { id: 'gnd_sg',   type: 'planeSDF3D',  position: { x: 260, y: 300 },
                inputs: { p:   { type: 'vec3', label: 'Position', connection: { nodeId: 'sp_sg', outputKey: 'pos' } } },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: { height: -0.8 } },
              { id: 'union_sg', type: 'sdfUnion',    position: { x: 460, y: 220 },
                inputs: {
                  a: { type: 'float', label: 'A', connection: { nodeId: 'sph_sg', outputKey: 'dist' } },
                  b: { type: 'float', label: 'B', connection: { nodeId: 'gnd_sg', outputKey: 'dist' } },
                },
                outputs: { dist: { type: 'float', label: 'Distance' } }, params: {} },
            ],
            outputNodeId: 'union_sg', outputKey: 'dist',
            inputPorts: [], outputPorts: [],
          },
        },
      },
      {
        id: 'mlg_4', type: 'marchLoopGroup', position: { x: 800, y: 220 },
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
          maxSteps: 100, maxDist: 30.0, stepScale: 1.0,
          bgR: 0.5, bgG: 0.6, bgB: 0.75,
          albedoR: 0.7, albedoG: 0.6, albedoB: 0.5,
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
        id: 'ao_5', type: 'sdfAo', position: { x: 1080, y: 100 },
        inputs: {
          scene:  { type: 'scene3d', label: 'Scene',   connection: { nodeId: 'scene_3', outputKey: 'scene'  } },
          pos:    { type: 'vec3',    label: 'Hit Pos', connection: { nodeId: 'mlg_4',   outputKey: 'pos'    } },
          normal: { type: 'vec3',    label: 'Normal',  connection: { nodeId: 'mlg_4',   outputKey: 'normal' } },
          hit:    { type: 'float',   label: 'Hit',     connection: { nodeId: 'mlg_4',   outputKey: 'hit'    } },
        },
        outputs: { ao: { type: 'float', label: 'AO' } }, params: { stepDist: 0.05 },
      },
      {
        id: 'shad_6', type: 'softShadow', position: { x: 1080, y: 280 },
        inputs: {
          scene:    { type: 'scene3d', label: 'Scene',     connection: { nodeId: 'scene_3', outputKey: 'scene'  } },
          pos:      { type: 'vec3',    label: 'Hit Pos',   connection: { nodeId: 'mlg_4',   outputKey: 'pos'    } },
          normal:   { type: 'vec3',    label: 'Normal',    connection: { nodeId: 'mlg_4',   outputKey: 'normal' } },
          hit:      { type: 'float',   label: 'Hit',       connection: { nodeId: 'mlg_4',   outputKey: 'hit'    } },
          lightDir: { type: 'vec3',    label: 'Light Dir' },
        },
        outputs: { shadow: { type: 'float', label: 'Shadow' } }, params: { k: 16.0, tmax: 25.0 },
      },
      {
        id: 'ml_7', type: 'multiLight', position: { x: 1320, y: 180 },
        inputs: {
          baseColor: { type: 'vec3',  label: 'Base Color', connection: { nodeId: 'mlg_4',  outputKey: 'color'  } },
          normal:    { type: 'vec3',  label: 'Normal',     connection: { nodeId: 'mlg_4',  outputKey: 'normal' } },
          hit:       { type: 'float', label: 'Hit',        connection: { nodeId: 'mlg_4',  outputKey: 'hit'    } },
          ao:        { type: 'float', label: 'AO',         connection: { nodeId: 'ao_5',   outputKey: 'ao'     } },
          shadow:    { type: 'float', label: 'Shadow',     connection: { nodeId: 'shad_6', outputKey: 'shadow' } },
          sunDir:    { type: 'vec3',  label: 'Sun Dir' },
        },
        outputs: { color: { type: 'vec3', label: 'Lit Color' } },
        params: { sunDirX: 0.6, sunDirY: 0.7, sunDirZ: 0.4, sunR: 1.0, sunG: 0.9, sunB: 0.7, skyR: 0.3, skyG: 0.45, skyB: 0.7, bounceR: 0.1, bounceG: 0.09, bounceB: 0.06 },
      },
      {
        id: 'fog_8', type: 'volumetricFog', position: { x: 1560, y: 200 },
        inputs: {
          color:    { type: 'vec3',  label: 'Color',     connection: { nodeId: 'ml_7',  outputKey: 'color' } },
          depth:    { type: 'float', label: 'Depth',     connection: { nodeId: 'mlg_4', outputKey: 'depth' } },
          hit:      { type: 'float', label: 'Hit',       connection: { nodeId: 'mlg_4', outputKey: 'hit'   } },
          fogColor: { type: 'vec3',  label: 'Fog Color' },
        },
        outputs: { color: { type: 'vec3', label: 'Fogged' } },
        params: { density: 0.4, fogR: 0.55, fogG: 0.65, fogB: 0.8 },
      },
      {
        id: 'out_9', type: 'output', position: { x: 1800, y: 220 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'fog_8', outputKey: 'color' } } },
        outputs: {}, params: {},
      },
    ],
  },

  // ── 3D Fractals: Mandelbox + Fresnel Edge Glow ─────────────────────────────
  // Mandelbox silhouettes lit with blue Fresnel rim light.
  // Dark albedo makes the glow pop against black space.
  mandelboxFresnelGlow: {
    label: '3D Fractals: Mandelbox + Fresnel Glow',
    counter: 11,
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
        params: { camDist: 4.0, camAngle: 0.5, rotSpeed: 0.1, fov: 1.4 },
      },
      {
        id: 'scene_3', type: 'sceneGroup', position: { x: 520, y: 440 },
        inputs: {}, outputs: { scene: { type: 'scene3d', label: 'Scene' } },
        params: {
          label: 'Mandelbox',
          subgraph: {
            nodes: [
              { id: 'sp_sg',   type: 'scenePos',    position: { x: 80,  y: 200 }, inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
              { id: 'mbox_sg', type: 'mandelboxDE', position: { x: 280, y: 200 },
                inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp_sg', outputKey: 'pos' } } },
                outputs: { orbit: { type: 'float', label: 'Orbit Trap' }, distance: { type: 'float', label: 'Distance' } },
                params: { iterations: 10, scale: -1.5, foldLimit: 1.0, minR: 0.5, fixedR: 1.0 } },
            ],
            outputNodeId: 'mbox_sg',
            outputKey: 'distance',
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
          maxSteps: 96, maxDist: 20.0, stepScale: 0.7,
          bgR: 0.0, bgG: 0.0, bgB: 0.02,
          albedoR: 0.1, albedoG: 0.1, albedoB: 0.15,
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
        id: 'fr_5', type: 'fresnel3d', position: { x: 1060, y: 200 },
        inputs: {
          normal:  { type: 'vec3', label: 'Normal',   connection: { nodeId: 'mlg_4', outputKey: 'normal' } },
          viewDir: { type: 'vec3', label: 'View Dir', connection: { nodeId: 'cam_2', outputKey: 'rd'     } },
        },
        outputs: { fresnel: { type: 'float', label: 'Fresnel' } }, params: { power: 2.5 },
      },
      {
        id: 'rimC_6', type: 'makeVec3', position: { x: 1060, y: 380 },
        inputs: { r: { type: 'float', label: 'R' }, g: { type: 'float', label: 'G' }, b: { type: 'float', label: 'B' } },
        outputs: { rgb: { type: 'vec3', label: 'RGB' } },
        params: { r: 0.15, g: 0.4, b: 1.0 },
      },
      {
        id: 'scl_7', type: 'multiplyVec3', position: { x: 1280, y: 290 },
        inputs: {
          color: { type: 'vec3',  label: 'Color', connection: { nodeId: 'rimC_6', outputKey: 'rgb'     } },
          scale: { type: 'float', label: 'Scale', connection: { nodeId: 'fr_5',   outputKey: 'fresnel' } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } }, params: { scale: 1.0 },
      },
      {
        id: 'add_8', type: 'addVec3', position: { x: 1480, y: 240 },
        inputs: {
          a: { type: 'vec3', label: 'A', connection: { nodeId: 'mlg_4',  outputKey: 'color'  } },
          b: { type: 'vec3', label: 'B', connection: { nodeId: 'scl_7',  outputKey: 'result' } },
        },
        outputs: { result: { type: 'vec3', label: 'Result' } }, params: {},
      },
      {
        id: 'out_9', type: 'output', position: { x: 1700, y: 260 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'add_8', outputKey: 'result' } } },
        outputs: {}, params: {},
      },
    ],
  },

};

// The default graph to load on startup
export const DEFAULT_EXAMPLE = 'fractalRings';
