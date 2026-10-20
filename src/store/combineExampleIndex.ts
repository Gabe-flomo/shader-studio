/**
 * combineExampleIndex.ts — the names and lines of Combine's examples (combineExamples.ts builds them), apart so the
 * example index can list them without loading the builders.
 */
export const COMBINE_EXAMPLE_INDEX: Record<string, { label: string; description: string }> = {
  combinePhotoInRoom: {
    label: 'Combine: a photo in a room',
    description: 'Combine\'s Place in, on a card: the built-in Room and cat photo stands in a small 3D scene (a floor, a ball, a block) as a Picture Card. The card is its own little Scene Group, marched through the scene\'s camera; Compare on the two March Loops\' distances shows it only where it is nearer, so the ball passes in front of it. Reopen it in the Scene builder to move the card or change how it joins.',
  },
  combinePeopleRings: {
    label: 'Combine: people → rings',
    description: 'Combine\'s Replace mask with, one fill for all: Segment finds the person in the built-in Walkway cat photo, Blob Track follows them as a blob, and Blob Space draws a 2D kaleidoscope (a 2D Scene Builder build, through its Fill field) fitted to the blob and cut to the person\'s shape. Select lays it over the photo.',
  },
};
