/**
 * learn3dExampleIndex.ts — names and one-line descriptions for the Learn 3D
 * folder: ray marching taught one idea at a time, in the order you would
 * learn it. Kept apart from the graphs (learn3dExamples.ts) so the examples
 * browser can list them without loading every graph up front.
 */

// [key, title, description], in learning order. The number comes from the position.
const ROWS: Array<[string, string, string]> = [
  ['learn3dCamera',  'The camera: one ray per pixel', 'March Camera turns every pixel into a ray: an origin (where the camera sits) and a direction. The direction, painted as colour, is different for every pixel.'],
  ['learn3dDistance','A sphere is a distance',        'A 3D shape is a function that says how far any point is from its surface. A flat slice through a sphere\'s distance field: blue inside, orange outside, white on the surface.'],
  ['learn3dMarch',   'The march: counting steps',     'The March Loop walks each ray forward by the scene\'s distance until it lands on the surface. Painted by how many steps each pixel took: the edges of the sphere are the hard part.'],
  ['learn3dLight',   'Hit, normal and light',         'Where a ray stops, the loop reports Hit (did it touch?) and Normal (which way the surface faces). Normal against a sun direction is lighting.'],
  ['learn3dCombine', 'Combining shapes',              'Inside the Scene Group a sphere and a box meet in a Union; its blend radius melts them together like putty. Whatever reaches Scene Output is the scene.'],
  ['learn3dOrbit',   'Moving the camera',             'The object stays still and the camera circles it: Time drives the camera\'s angle. The colours are the surface normals, fixed to the world, so you can see which side you are on.'],
  ['learn3dVolume',  'Glow: through the shape',       'The same sphere two ways: on the left the loop stops at the surface; on the right it walks straight through in volumetric mode, adding a little glow at every step.'],
  ['learn3dGI',      'GI lighting vs the plain loop', 'The same scene through the plain March Loop (left, one light, no shadows) and the GI Lit March Loop (right: shadows, sky light, bounce light and reflections).'],
  ['learn3dVolumeSwitch', 'Glow from the Volumetric switch', 'An ordinary torus scene with the March Loop\'s Volumetric switch turned on: the switch built Scene Distance, Volume Glow and Glow to Color itself, each with a note. Turn it off and they go away.'],
];

export const LEARN3D_EXAMPLE_KEYS: string[] = ROWS.map(r => r[0]);

export const LEARN3D_EXAMPLE_INDEX: Record<string, { label: string; description: string; play: true }> = Object.fromEntries(
  ROWS.map(([key, title, description], i) => [key, { label: `3D ${i + 1} · ${title}`, description, play: true as const }]),
);
