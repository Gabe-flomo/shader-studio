/**
 * convertExamples.ts — what the Convert page makes of the shader it starts
 * with (Examples… → Soft circle), as example graphs: as written (one card per
 * operation) and optimised (the run of math cards folded into an Expression
 * Block). The nodes are the converter's own output, stored in
 * convertExampleNodes.ts so this chunk doesn't carry the GLSL parser; a test
 * converts the shader again and fails if they drift. The "Bring your own
 * GLSL" presentation reads them.
 */
import type { ExampleGraph } from './exampleIndex';
import { colourCtl, ctl, play } from './graphBuilder';
import { SOFT_CIRCLE_AS_WRITTEN, SOFT_CIRCLE_OPTIMISED, WARM_TUNNEL_AS_WRITTEN, WARM_TUNNEL_OPTIMISED } from './convertExampleNodes';
import { CONVERT_EXAMPLE_INDEX } from './convertExampleIndex';
import type { GraphNode } from '../types/nodeGraph';

/** Notes by node type for the converted tunnel (the converter writes none): what each card is in the shader. */
const TUNNEL_NOTES: Record<string, string> = {
  fragCoord: 'Pixel Coordinates: gl_FragCoord.xy, this pixel in pixels from the bottom left.',
  resolution: 'Resolution: u_resolution, the picture\'s size in pixels. Halved and subtracted it centres the picture; dividing by its height makes the frame 1 tall.',
  constants: 'Constants: the shader\'s plain numbers the converter kept as sliders (0.35, how deep the tunnel looks; 1, the base of the vignette).',
  time: 'Time: u_time in seconds. Times 0.4, it moves the rings toward you.',
  colorPicker: 'Color: one of the two colours the shader mixes between (vec3(0.05, 0.04, 0.06), a near-black, and vec3(1.0, 0.72, 0.45), a warm amber). Pick another on the card.',
  exprNode: 'Expression Block: the shader\'s math, folded into one card by Optimised. Its lines follow the code: centred uv; r = length(uv); a = atan(uv.y, uv.x); z = 0.35 / r + time · 0.4 (depth: far toward the middle); rings = (½ + ½ sin(12 z))⁴, sharpened into thin bands; spokes = ½ + ½ cos(6 a + 2 z); fade = smoothstep(0, 0.6, r) so the middle stays dark; Mix from dark to warm by rings × spokes × fade; then × (1 − 0.6 r²) for the vignette.',
  output: 'Output: gl_FragColor.',
};
/** The converted graph with a note on every card: the type's note, or what the operation is. */
function tunnelNotes(nodes: GraphNode[]): GraphNode[] {
  return nodes.map(n => ({ ...n, params: { ...n.params, __comment: (n.params.__comment as string | undefined) ?? TUNNEL_NOTES[n.type] ?? `A ${n.type} card: one operation of the shader, in the order the code does it (Convert page, Examples… → Warm tunnel).` } }));
}

export function buildConvertExamples(): Record<string, ExampleGraph> {
  const notes = (what: string, how: string, tryIt: string) => `**What it shows.** ${what}\n\n**How it is built.** ${how}\n\n**Try.** ${tryIt}`;
  return {
    convertCircle: {
      ...CONVERT_EXAMPLE_INDEX.convertCircle, counter: 20, nodes: structuredClone(SOFT_CIRCLE_AS_WRITTEN),
      play: play([
        ctl('r', 'smoothstep_6::edge1', 'Radius (Edge 1)', 0, 0.7, 0.005),
        ctl('e', 'smoothstep_6::edge0', 'Soft edge (Edge 0)', 0, 0.7, 0.005),
        colourCtl('c', 'colorPicker_8::color', 'Colour'),
      ], notes(
        'The Soft circle from the Convert page, converted as written: each operation in the shader is one card.',
        '`gl_FragCoord.xy / u_resolution.xy` is Pixel Coordinates ÷ Resolution; `length(uv - 0.5)` is Subtract and Length; `smoothstep(0.31, 0.3, d)` is Smoothstep with Edge 0 = 0.31 and Edge 1 = 0.3; `vec3(m) * vec3(1.0, 0.7, 0.3)` is Float → Color, multiplied by a Color card.',
        'Raise Soft edge to 0.6 and the hard rim becomes a glow that fades outward.',
      )),
    },
    convertTunnel: {
      ...CONVERT_EXAMPLE_INDEX.convertTunnel, counter: 40, nodes: tunnelNotes(structuredClone(WARM_TUNNEL_AS_WRITTEN)),
      play: play([colourCtl('warm', 'colorPicker_27::color', 'Warm colour')], notes(
        'The Warm tunnel from the Convert page, converted as written: each operation in the shader is one card, so the graph reads like the code, top to bottom.',
        '`(gl_FragCoord.xy - 0.5 * u_resolution.xy) / u_resolution.y` is Pixel Coordinates, Resolution, Multiply, Subtract and Divide; `length` and `atan` give the polar coordinates; `0.35 / r + u_time * 0.4` is the depth that makes the rings rush toward you.',
        'Compare it with Convert: Warm tunnel, optimised: the same picture, the math folded into one block.',
      )),
    },
    convertTunnelOptimised: {
      ...CONVERT_EXAMPLE_INDEX.convertTunnelOptimised, counter: 40, nodes: tunnelNotes(structuredClone(WARM_TUNNEL_OPTIMISED)),
      play: play([colourCtl('warm', 'colorPicker_27::color', 'Warm colour')], notes(
        'A short tunnel shader pasted into the Convert page with Optimised on. The things you would want to change stay cards (Time, the two colours, the numbers 0.35 and 1 as Constants); everything else is one Expression Block whose lines follow the shader.',
        'The shader (Convert page, Examples… → Warm tunnel): centred UV; `r = length(uv)`, `a = atan(uv.y, uv.x)`; depth `z = 0.35 / r + time * 0.4`; rings `pow(½ + ½ sin(z * 12), 4)` times spokes `cos(a * 6 + z * 2)`, faded near the middle; a Mix from the dark to the warm colour; a vignette `1 − 0.6 r²`.',
        'Change the warm colour (a Play control), or the dark one on its card. Open the block and change 12.0 (ring count) or 6.0 (spoke count). Paste your own shader on the Convert page to get a graph like this one.',
      )),
    },
    convertCircleOptimised: {
      ...CONVERT_EXAMPLE_INDEX.convertCircleOptimised, counter: 20, nodes: structuredClone(SOFT_CIRCLE_OPTIMISED),
      play: play([colourCtl('c', 'colorPicker_8::color', 'Colour')], notes(
        'The Soft circle converted with Optimised on. The run from Divide to Multiply is one Expression Block now; the picture is the same.',
        'Pixel Coordinates, Resolution and the Color card go into one Expression Block, which does the rest in a few lines.',
        'Open the block: every line is one of the cards from the as-written graph.',
      )),
    },
  };
}
