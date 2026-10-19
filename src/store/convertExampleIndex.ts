/**
 * convertExampleIndex.ts — names and descriptions for the Convert examples
 * (convertExamples.ts builds the graphs). Kept apart so the examples list
 * doesn't load the stored graphs up front.
 */
export const CONVERT_EXAMPLE_INDEX: Record<string, { label: string; description: string; play: true }> = {
  convertCircle: {
    label: 'Convert: Soft circle, as written', play: true,
    description: 'What the Convert page makes of its Soft circle shader, one card per operation: Pixel Coordinates ÷ Resolution, minus 0.5, Length, Smoothstep, times a Color. Every number in the shader became a slider.',
  },
  convertCircleOptimised: {
    label: 'Convert: Soft circle, optimised', play: true,
    description: 'The same conversion with Optimised on: the run of math cards folded into one Expression Block. The same picture from fewer cards.',
  },
  convertTunnel: {
    label: 'Convert: Warm tunnel, as written', play: true,
    description: 'What the Convert page makes of a twelve-line tunnel shader (its Examples… → Warm tunnel), one card per operation: centred UV, Length and Atan for polar coordinates, 0.35 / r + time for depth, sine rings times cosine spokes, a Mix between two colours and a vignette.',
  },
  convertTunnelOptimised: {
    label: 'Convert: Warm tunnel, optimised', play: true,
    description: 'A twelve-line tunnel shader pasted into the Convert page with Optimised on: the inputs (pixel, resolution, time, two colours) stay as cards you can wire and tweak, and the math is one commented Expression Block you can read line by line against the shader.',
  },
};

export const CONVERT_EXAMPLE_KEYS = Object.keys(CONVERT_EXAMPLE_INDEX);
