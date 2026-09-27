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
import { SOFT_CIRCLE_AS_WRITTEN, SOFT_CIRCLE_OPTIMISED } from './convertExampleNodes';
import { CONVERT_EXAMPLE_INDEX } from './convertExampleIndex';

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
