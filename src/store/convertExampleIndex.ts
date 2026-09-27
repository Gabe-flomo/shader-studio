/**
 * convertExampleIndex.ts — names and descriptions for the Convert folder
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
};

export const CONVERT_EXAMPLE_KEYS = Object.keys(CONVERT_EXAMPLE_INDEX);
