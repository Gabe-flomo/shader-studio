/**
 * piecesExampleIndex.ts — names and descriptions for the Pieces examples (graphs in piecesExamples.ts,
 * docs/pieces.md), apart so the examples browser can list them without loading the graphs.
 */

const ROWS: Array<[string, string, string]> = [
  ['piecesScatterReturn', 'Pieces: scatter and return', 'A photo rebuilt from 32 pieces across, each the photo\'s colour at its home. A noise field moves them and an LFO on Amount scatters the picture and brings it back together. Play: scatter, size, swirl size, pace.'],
  ['piecesBallAction', 'Pieces: ball action', 'CC Ball Action on a shader: a moving kaleidoscope (Shader Texture) rebuilt from 110 glowing balls across, a little scattered and wobbling (Instability), with bursts of Scatter from an LFO. Play: balls across, size, instability, glow, bursts.'],
  ['piecesBallsDepth', 'Balls: scattered in depth', 'A photo as balls on their own grid that break up towards and away from the camera (Scatter depth on an LFO), with depth of field to raise (Focus, Blur). Play: depth scatter, blur, focus, look around.'],
  ['piecesBalls3D', 'Balls: a picture in 3D', 'CC Ball Action in a March Loop: a photo as a grid of balls (Repeat Scene), each coloured from its home and lifted towards the camera by the brightness there, with a wave rolling through them. Play: lift, ball size, look around, look from above.'],
];
export const PIECES_EXAMPLE_KEYS = ROWS.map(r => r[0]);
export const PIECES_EXAMPLE_INDEX: Record<string, { label: string; description: string; play: true }> = Object.fromEntries(
  ROWS.map(([key, label, description]) => [key, { label, description, play: true as const }]),
);
