/**
 * exampleNotes3d.ts — node notes for the 3D lighting and material examples that were written before every example
 * carried notes (examples curation, 2026-10-19). Applied to the graphs when they are built (exampleGraphs.ts), by node
 * id, inside groups too; a node that already has a note keeps it.
 */
import type { GraphNode } from '../types/nodeGraph';
import type { ExampleGraph } from './exampleIndex';

const NOTES: Record<string, Record<string, string>> = {
  litStillLife: {
    uv: 'UV: where each pixel is on the picture, for the camera.',
    t: 'Time: turns the camera slowly round the still life.',
    cam: 'March Camera: 4 units from the middle, a little above it (Elevation 0.35), circling at Rot Speed 0.1. Each pixel gets a ray: Ray Origin (the camera) and Ray Dir.',
    scene: 'Scene Group (Still Life): the shapes as one distance: a capsule and a cone melted together, standing on a ground plane. The same Scene goes to the March Loop (to find the surface) and to SDF AO and Soft Shadow (to measure it again for the light).',
    sp: 'Scene Pos: the point being measured.',
    cap: 'Capsule SDF 3D: an upright pill, 0.5 tall and 0.25 thick, in the middle.',
    tr: 'Transform: moves the cone to (0.9, −0.3, 0.2), beside the capsule and resting lower.',
    cone: 'Cone SDF 3D: a cone 0.9 tall, at the moved point.',
    pl: 'Plane 3D: the ground, at y = −0.75, for the shapes to stand on and to catch their shadows.',
    u1: 'Union, blend 0.1: the capsule and the cone, melted a little where they meet.',
    u2: 'Union, blend 0: the pair and the ground, a hard join so the shapes sit on it with a crisp contact.',
    so: 'Scene Output: the still life\'s distance.',
    mlg: 'March Loop Group: walks each ray into the scene until it touches a surface. Its Hit Pos, Normal and Hit go to the light; its own Color is not used.',
    mli: 'Group Inputs: the ray at this step.',
    mlo: 'Group Output: the point handed to the scene, unwarped.',
    ao: 'SDF Ambient Occlusion: steps out along the surface normal (0.06 at a time) and measures how much of the scene is close by: dark in the crease where the cone meets the capsule and where both meet the ground.',
    sh: 'Soft Shadow: a second ray from the hit point toward the sun; how close it passes to the shapes makes the penumbra (k 16: fairly sharp, softening with distance).',
    base: 'Make Vec3: the surface colour, a warm clay (0.85, 0.75, 0.6), the same for every shape.',
    lit: 'Multi Light: the clay lit three ways: a warm sun from the upper right (darkened by Soft Shadow), a cool sky from above (darkened by AO), and a faint warm bounce from below. Where the ray missed, black.',
    tone: 'Tone Map (ACES): the sunlit side goes over 1; ACES rolls it off like film so it keeps its colour.',
    out: 'Output: the lit still life.',
  },
  giSphereGround: {
    gsg_uv: 'UV: where each pixel is on the picture, for the camera.',
    gsg_time: 'Time: circles the camera (Rot Speed 0.3), and moves the noise of the bounce light from frame to frame so it averages out.',
    gsg_cam: 'March Camera: 3.5 from the middle, a little above, circling. Its Ray Origin and Ray Dir go into the GI loop.',
    gsg_scene: 'Scene Group (Sphere on Ground): a ball resting on a floor, the simplest scene that shows everything GI adds: a soft shadow under the ball, the floor\'s light bouncing up onto its underside, and the sky in its top.',
    gsg_sp: 'Scene Pos: the point being measured.',
    gsg_sdf: 'Sphere SDF 3D: a ball of radius 0.72 in the middle.',
    gsg_pln: 'Plane 3D: the floor at y = −0.75, so the ball just touches it.',
    gsg_uni: 'Union: the ball or the floor, whichever is nearer.',
    gsg_gi: 'GI Lit March Group: the ray marcher with its own lighting. For each hit it measures ambient occlusion, a soft shadow toward the light (Light X/Y/Z, warm, strength 1.2), a sky dome (blue above, warm ground colour below), one random bounce ray for indirect light (GI Strength 0.45) and one reflection ray (Spec Strength 0.3, Roughness 0.45). All in one pass, a little noisy, as the bounce is one random ray per pixel.',
    gsg_tone: 'Tone Map (ACES): rolls off the highlights.',
    gsg_out: 'Output: the lit scene.',
  },
  glassMetaballs: {
    uv_0: 'UV: where each pixel is on the picture, for the camera.',
    time_1: 'Time: turns the camera slowly.',
    cam_2: 'March Camera: 3 from the middle, nearly level, circling slowly. Its Ray Dir also goes to Glass 3D, which bends it.',
    scene_3: 'Scene Group (Blob Cluster): three spheres melted into one smooth blob, the shape the glass is made of.',
    sp: 'Scene Pos: the point being measured.',
    tr1: 'Transform: moves the first sphere 0.55 to the left.',
    s1: 'Sphere SDF 3D: the left sphere, radius 0.52.',
    tr2: 'Transform: moves the second sphere 0.55 to the right.',
    s2: 'Sphere SDF 3D: the right sphere, radius 0.52.',
    tr3: 'Transform: moves the third sphere up 0.72, over the other two.',
    s3: 'Sphere SDF 3D: the top sphere, radius 0.48.',
    sm12: 'Union, blend 0.4: the left and right spheres melted into one with a wide, soft waist.',
    sm123: 'Union, blend 0.35: the top sphere melted on, so the three read as one drop of glass.',
    mlg_4: 'March Loop Group: finds where each ray meets the blob; its Normal and Hit go to Glass 3D. Background deep blue, which is what the glass shows through it.',
    glass_5: 'Glass 3D: the blob as glass. It bends the camera ray through the surface (IOR 1.45, like crown glass), splits it a little into colours (Dispersion 0.09, 8 samples: the rainbow fringes), adds a Fresnel edge (brighter where the surface turns away) and a sharp highlight (Shininess 60). Saturation 2.2 deepens the colours it picks up.',
    tone_6: 'Tone Map (ACES): rolls off the bright highlights so they keep their colour.',
    out_7: 'Output: the glass blob.',
  },
  volAnimatedRepeat: {
    uv_0: 'UV: where each pixel is on the picture, for the camera.',
    time_1: 'Time: the grain\'s seed, so the grain changes every frame.',
    cam_2: 'March Camera: 3.15 from the middle, fixed (Rot Speed 0), looking into the rows of glowing balls.',
    scene_3: 'Scene Group (Repeated Spheres): small spheres repeated through space, sliding along and breathing in size over time. In a volumetric march this is not a surface but a density: the closer a step is to a sphere, the more light it adds.',
    sp_inn: 'Scene Pos: the point being measured.',
    time_inn: 'Time, inside the scene: drives the slide and the breathing.',
    multz_inn: 'Multiply: Time × −0.4, the speed the rows slide along z (into the offset below).',
    rep_inn: 'Repeat 3D: one sphere in every 0.5 × 2.5 × 1.6 cell, so the single sphere becomes rows of them.',
    sin_inn: 'Sin: a slow wave from Time (frequency 0.89, size 0.4).',
    cos_inn: 'Cos of that wave (frequency 1.66, size 0.1): the radius, so the spheres breathe in and out in an uneven rhythm.',
    sdf_inn: 'Sphere SDF 3D: one ball per cell, its radius from the breathing.',
    mli: 'Group Inputs: this step\'s point along the ray.',
    time_b: 'Time, in the loop body: moves the warp.',
    swarp_b: 'Sin Warp 3D: ripples space along z as the ray goes (frequency 2.21, size 0.49), so the rows wave like seaweed.',
    msd_b: 'Scene Distance: the distance to the nearest sphere from the warped point, at this step.',
    abs_b: 'Abs: the distance without its sign, so the inside of a sphere glows like the outside near its skin.',
    clamp_b: 'Max: keeps the distance above a small floor, so the division below never blows up.',
    div_b: 'Divide (+=): adds 1 ÷ distance at every step: a little light far from the spheres, a lot close to them. The loop\'s first accumulator (acc0) is the sum along the whole ray.',
    scale_5: 'Multiply: the summed light × 0.004, down to a useful range.',
    tanh_6: 'Tanh: squeezes it smoothly into 0 to 1, so dense places saturate softly instead of clipping.',
    pal_7: 'Palette: the Wiggle Tunnel\'s colours (phase 0.3, 0.416, 0.557): faint glow navy and blue, dense glow cream and orange.',
    grain_9: 'Grain: film grain, changing every frame (seeded by Time), to break up the smooth glow.',
    tone_10: 'Tone Map (Tanh): a soft roll-off for the brightest glow.',
    out_11: 'Output: the glowing rows.',
  },
};

/** Gives every listed node its note (a node with a note already keeps it), inside groups too. */
export function addExampleNotes3d(graphs: Record<string, ExampleGraph>): void {
  const walk = (nodes: GraphNode[], notes: Record<string, string>) => {
    for (const nd of nodes) {
      if (notes[nd.id] && !nd.params.__comment) nd.params = { ...nd.params, __comment: notes[nd.id] };
      const sg = nd.params.subgraph as { nodes?: GraphNode[] } | undefined;
      if (sg?.nodes) walk(sg.nodes, notes);
    }
  };
  for (const [key, notes] of Object.entries(NOTES)) if (graphs[key]) walk(graphs[key].nodes, notes);
}
