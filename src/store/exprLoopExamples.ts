/**
 * exprLoopExamples.ts — Expression Blocks in Loop mode (docs/expression-block.md, "Loop"): an
 * escape-time Julia set, a sum of octaves (fbm) and an iterated fold (Kali). Each block has a
 * Before section (start values), looped lines, sometimes a Break when and an After section, and
 * its Iterations is a live slider on the card.
 *
 * Every node carries a comment saying what it is and why; each block's note explains the loop.
 */
import type { ExampleGraph } from './exampleIndex';
import type { GraphNode } from '../types/nodeGraph';
import type { ExprLoop } from '../nodes/exprLoop';
import { n } from './graphBuilder';

export const EXPR_LOOP_EXAMPLE_INDEX: Record<string, { label: string; description: string }> = {
  loopJulia: {
    label: 'Loop: Julia set (escape time)',
    description: 'One Expression Block in Loop mode: z = z² + c up to 64 times, stopping when z escapes. The pass it escaped on colours the pixel. Drag Iterations on the card: no recompile.',
  },
  loopFbm: {
    label: 'Loop: fbm, a sum of octaves',
    description: 'An Expression Block that adds octaves in a loop: each pass doubles the frequency (a rotated, scaled q) and halves the amplitude. Iterations is the number of octaves.',
  },
  loopKali: {
    label: 'Loop: Kali fold',
    description: 'The Kali set: fold space with abs(z) / dot(z, z) − c, again and again, and keep the closest the orbit came to the origin (an orbit trap). A few lines, a lot of detail.',
  },
};

export const EXPR_LOOP_EXAMPLE_KEYS = Object.keys(EXPR_LOOP_EXAMPLE_INDEX);

const note = (text: string) => ({ __comment: text });
type L = { lhs: string; op: string; rhs: string };
const ln = (lhs: string, op: string, rhs: string): L => ({ lhs, op, rhs });

/** A looped Expression Block reading `uv` (wired) and some slider inputs. */
function loopBlock(id: string, x: number, y: number, o: {
  label: string; comment: string; sliders: Array<{ name: string; value: number; min: number; max: number }>;
  before: L[]; lines: L[]; after?: L[]; breakWhen?: string; result: string; iterations: number; max: number; uvFrom: string;
}): GraphNode {
  const inputs = [{ name: 'uv', type: 'vec2', slider: null }, ...o.sliders.map(s => ({ name: s.name, type: 'float', slider: { min: s.min, max: s.max } }))];
  const loop: ExprLoop = { on: true, max: o.max, before: o.before, after: o.after ?? [], ...(o.breakWhen ? { breakWhen: o.breakWhen } : {}) };
  const base = n('exprNode', id, x, y, {
    inputs, outputType: 'vec3', lines: o.lines, result: o.result, expr: o.result, label: o.label, loop, loopN: o.iterations,
    ...Object.fromEntries(o.sliders.map(s => [s.name, s.value])), ...note(o.comment),
  });
  const sockets: GraphNode['inputs'] = { uv: { type: 'vec2', label: 'uv', connection: { nodeId: o.uvFrom, outputKey: 'uv' } } };
  for (const s of o.sliders) sockets[s.name] = { type: 'float', label: s.name, defaultValue: s.value };
  return { ...base, inputs: sockets, outputs: { result: { type: 'vec3', label: 'Result' } } };
}

/** UV → the block → Output. */
function graph(key: keyof typeof EXPR_LOOP_EXAMPLE_INDEX, block: GraphNode, uvNote: string): ExampleGraph {
  const out = n('output', `${key}_out`, 760, 200, note('The picture: the block’s colour.'));
  out.inputs = { ...out.inputs, color: { ...out.inputs.color, connection: { nodeId: block.id, outputKey: 'result' } } };
  return { ...EXPR_LOOP_EXAMPLE_INDEX[key], counter: 4, nodes: [n('uv', `${key}_uv`, 40, 200, note(uvNote)), block, out] };
}

export function buildExprLoopExamples(): Record<string, ExampleGraph> {
  const julia = loopBlock('loopJulia_block', 300, 160, {
    label: 'Julia escape time', uvFrom: 'loopJulia_uv', iterations: 64, max: 256,
    sliders: [{ name: 'cx', value: -0.8, min: -1.5, max: 1.5 }, { name: 'cy', value: 0.156, min: -1.5, max: 1.5 }],
    comment: [
      'A Julia set by escape time, one Expression Block in Loop mode.',
      'Before the loop: z starts at the pixel (uv, zoomed out a little) and esc, the pass it escaped on, at 0.',
      'Each pass: z = z² + c (complex squaring written out: (x² − y², 2xy)), and esc remembers the pass.',
      'Break when |z|² > 4: once z is that far out it never comes back, so the loop stops early for that pixel.',
      'After the loop: s is how soon it escaped (0..1), and inside is 1 where it never did (drawn black).',
      'c = (cx, cy) picks the set: try (−0.8, 0.156), (0.285, 0.01), (−0.4, 0.6). Iterations is the most passes a pixel gets: more shows finer edges.',
    ].join('\n'),
    before: [ln('vec2 z', '=', 'uv * 1.4'), ln('float esc', '=', '0.0')],
    lines: [ln('z', '=', 'vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + vec2(cx, cy)'), ln('esc', '=', 'fi')],
    breakWhen: 'dot(z, z) > 4.0',
    after: [ln('float s', '=', 'esc / n'), ln('float inside', '=', 'step(dot(z, z), 4.0)')],
    result: '(1.0 - inside) * (0.5 + 0.5 * cos(6.28318 * (s * 2.5 + vec3(0.0, 0.15, 0.3))))',
  });
  const fbm = loopBlock('loopFbm_block', 300, 160, {
    label: 'fbm octaves', uvFrom: 'loopFbm_uv', iterations: 6, max: 16,
    sliders: [{ name: 'gain', value: 0.5, min: 0.2, max: 0.8 }, { name: 'scale', value: 3.0, min: 0.5, max: 8.0 }],
    comment: [
      'Fractal Brownian motion: the same wave added at finer and finer scales (octaves).',
      'Before the loop: q is the pixel at the starting scale, amp the first octave’s strength, sum the total so far.',
      'Each pass adds one octave (a wavy sin of q, drifting with t), then turns and stretches q (the mat2: rotate about 37° and scale ×2) so the next octave is finer and not lined up with this one, and multiplies amp by gain.',
      'Iterations is the number of octaves: 1 is one smooth wave, 6 is rich detail. gain is how much each finer octave keeps (0.5 halves it).',
      'After the loop: sum is about −1..1, mapped to 0..1 for the shade.',
    ].join('\n'),
    before: [ln('vec2 q', '=', 'uv * scale'), ln('float amp', '=', '0.5'), ln('float sum', '=', '0.0')],
    lines: [
      ln('sum', '+=', 'amp * sin(q.x + sin(q.y * 1.7 + t * 0.4) + fi)'),
      ln('q', '=', 'mat2(1.6, 1.2, -1.2, 1.6) * q + vec2(1.7, 9.2)'),
      ln('amp', '*=', 'gain'),
    ],
    after: [ln('float v', '=', '0.5 + 0.5 * sum')],
    result: 'mix(vec3(0.05, 0.08, 0.2), vec3(0.95, 0.8, 0.55), v)',
  });
  const kali = loopBlock('loopKali_block', 300, 160, {
    label: 'Kali fold', uvFrom: 'loopKali_uv', iterations: 14, max: 64,
    sliders: [{ name: 'cx', value: 0.55, min: 0.1, max: 1.2 }, { name: 'cy', value: 0.75, min: 0.1, max: 1.2 }, { name: 'zoom', value: 1.4, min: 0.2, max: 4.0 }],
    comment: [
      'The Kali set: an iterated fold. Each pass mirrors z into the positive quarter (abs), turns it inside out around the unit circle (÷ dot(z, z)) and shifts it by c.',
      'Before the loop: z is the pixel (× zoom), and trap starts far away.',
      'Each pass also keeps trap, the closest z came to the origin: an orbit trap, the usual way to shade this kind of fractal.',
      'After the loop: g turns the trap into a glow (1 at the origin, fading out). Return colours it.',
      'c = (cx, cy) changes the whole structure; small changes give very different pictures. Iterations adds detail until it turns to noise (around 20).',
    ].join('\n'),
    before: [ln('vec2 z', '=', 'uv * zoom'), ln('float trap', '=', '10.0')],
    lines: [ln('z', '=', 'abs(z) / dot(z, z) - vec2(cx, cy)'), ln('trap', '=', 'min(trap, length(z))')],
    after: [ln('float g', '=', 'exp(-trap * 4.0)')],
    result: 'vec3(g * 1.1, g * g * 0.9 + 0.05, sqrt(g) * 0.8)',
  });
  return {
    loopJulia: graph('loopJulia', julia, 'UV: the pixel, (0, 0) in the middle. It is where z starts.'),
    loopFbm: graph('loopFbm', fbm, 'UV: the pixel, (0, 0) in the middle. The first octave is sampled here.'),
    loopKali: graph('loopKali', kali, 'UV: the pixel, (0, 0) in the middle. The fold starts here.'),
  };
}
