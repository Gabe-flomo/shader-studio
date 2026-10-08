/**
 * curvedSpaceExampleIndex.ts — names and descriptions for the Curved space folder
 * (graphs in curvedSpaceExamples.ts). Kept apart so the examples browser can list
 * them without loading every graph up front.
 */

const ROWS: Array<[string, string, string]> = [
  ['curvedSpherical',  'Curved space: spherical world',  'An endless lattice of spheres in a space of positive curvature: the rays bend toward each other, so the far spheres stop shrinking and grow again, and the far side of the world wraps round to meet you. Play: Space curvature, sphere radius, look around.'],
  ['curvedHyperbolic', 'Curved space: hyperbolic tunnel', 'A hall of columns in negative curvature: rays spread faster and faster, so the grove shrinks into a fisheye tunnel. Play: Space curvature, fly along the hall, look around.'],
  ['curvedReverse',    'Curved space: reverse perspective room', 'Identical boxes on a floor under the camera\'s Reverse perspective: the farther rows look bigger. Play: Reverse strength, where the rays converge, camera height.'],
];

export const CURVED_EXAMPLE_KEYS: string[] = ROWS.map(r => r[0]);

export const CURVED_EXAMPLE_INDEX: Record<string, { label: string; description: string; play: true }> = Object.fromEntries(
  ROWS.map(([key, label, description]) => [key, { label, description, play: true as const }]),
);
