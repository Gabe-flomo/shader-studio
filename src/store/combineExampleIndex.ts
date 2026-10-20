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
  combineSparksTrace: {
    label: 'Combine: sparks trace a star',
    description: 'Combine\'s Follow the shape, Trace: a swarm (an Agent Builder build) rides the outline of a glowing 2D star (a 2D Scene Builder build). The star\'s distance comes into the Agents group through a port, and Ride a Path inside pulls every walker back onto the outline each step, so they follow it as a flowing band. Draw agents\' walkers are laid over the star by their Density. Reopen it in the Scene builder for Cling, Flow along or Orbit, or write Speed as a line.',
  },
  combineFireflies: {
    label: 'Combine: fireflies round a sculpture',
    description: 'Combine\'s Follow the shape in 3D, Orbit: walkers circle a ray-marched torus-and-ball sculpture in a shell just off its surfaces. The Scene Group comes into the Agents group through a Scene port; Follow surface (3D Scene) reads it on a coarse 48³ grid, keeps each walker\'s velocity along the surface, steers it round the up axis and pulls it back to the shell. Draw agents sees them through the scene\'s camera, hidden behind the sculpture.',
  },
  combineTwoLooks: {
    label: 'Combine: two blobs, two looks',
    description: 'Combine\'s Replace mask with, per blob: a Blob Track splits the bright shapes of the built-in Ball action clip into blobs (up to 4) and follows them. One Blob Space per fill picks its blob by order (Fill: One blob): #1, the oldest blob seen now, gets a 2D kaleidoscope through its Fill field; #2 a small 3D scene whose March Camera UV is wired from that Blob Space\'s Local UV, cut round. The other blobs stay as the clip. Two Selects lay the fills over it. Reopen it in the Scene builder to switch Attach by to ID or give the rest a fill.',
  },
};
