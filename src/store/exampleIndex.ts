/**
 * exampleIndex.ts — everything the UI needs to *list* the example graphs,
 * without loading them.
 *
 * The graphs themselves (exampleGraphs.ts, ~680 KB of source, 1,700 node
 * objects) are only needed when one is picked, so they live in their own
 * chunk behind `loadExampleGraphs()`. This module carries the labels, the
 * folder taxonomy, the default key, and the one graph that has to be
 * available synchronously at startup: the blank starter.
 */
import type { GraphNode } from '../types/nodeGraph';
import type { PlayRecord } from '../types/play';
import { ctp } from '../theme/palette';
import { PLAY_EXAMPLE_INDEX, PLAY_EXAMPLE_KEYS } from './playExampleIndex';
import { LEARN_EXAMPLE_INDEX, LEARN_EXAMPLE_KEYS } from './learnExampleIndex';
import { COMBO_EXAMPLE_INDEX } from './comboExamples';
import { MATRIX_EXAMPLE_INDEX, MATRIX_EXAMPLE_KEYS } from './matrixExamples';

export type ExampleGraph = {
  label: string; nodes: GraphNode[]; counter: number;
  /** One line on what the example teaches, shown in the Examples list */
  description?: string;
  /** A ready-made Play setup (controls + mappings) that loads with the graph. */
  play?: PlayRecord;
};

// A brand-new graph used to be just UV -> Output with nothing wired — a
// black screen with no hint of what to do next. A minimal UV -> Circle SDF
// -> distance -> glow -> Color chain gives every new project a visible,
// recognizable starting point instead.
export const BLANK_GRAPH: ExampleGraph = {
    label: '[ New ]',
    counter: 4,
    nodes: [
      { id: 'n1', type: 'uv', position: { x: 100, y: 240 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
      {
        id: 'n3', type: 'circleSDF', position: { x: 340, y: 240 },
        inputs: {
          position: { type: 'vec2', label: 'Position', connection: { nodeId: 'n1', outputKey: 'uv' } },
          radius:   { type: 'float', label: 'Radius' },
          offset:   { type: 'vec2', label: 'Offset' },
        },
        outputs: { distance: { type: 'float', label: 'Distance' } },
        params: { radius: 0.3, posX: 0.0, posY: 0.0 },
      },
      {
        id: 'n4', type: 'light', position: { x: 580, y: 240 },
        inputs: {
          distance:   { type: 'float', label: 'Distance', connection: { nodeId: 'n3', outputKey: 'distance' } },
          brightness: { type: 'float', label: 'Falloff' },
          tint:       { type: 'vec3', label: 'Tint' },
        },
        outputs: { glow: { type: 'float', label: 'Glow' }, inner: { type: 'float', label: 'Inner' }, tinted: { type: 'vec3', label: 'Tinted' } },
        // White tint, so it starts looking as it always did; pick a colour and the glow takes it.
        params: { mode: 'glow', brightness: 10.0, ringFreq: 8.0, tint: [1, 1, 1], innerFalloff: 8.0 },
      },
      {
        id: 'n2', type: 'output', position: { x: 820, y: 240 },
        // Tinted, not Glow: Glow is a plain brightness, and the Tint colour only reaches the Tinted output.
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'n4', outputKey: 'tinted' } } },
        outputs: {}, params: {},
      },
    ],
  };

/** Key → label for every bundled example (generated from exampleGraphs.ts). */
export const EXAMPLE_INDEX: Record<string, { label: string; description?: string; /** Loads with a Play setup */ play?: boolean }> = {
  blank: { label: BLANK_GRAPH.label },
  fractalRings: { label: "Fractal Rings" },
  raymarchSpheres: { label: "Raymarch Spheres" },
  gravitationalLens: { label: "Gravity Lens" },
  chladniFieldQuickDemo: { label: "Chladni Field (Quick)" },
  chladniModeFreqDemo: { label: "Chladni Mode Frequency" },
  groupCarryRings: { label: "Group: Fractal Rings (Carry)" },
  groupCarryFBM: { label: "Group: FBM Octaves (Carry)" },
  groupCarryDomainWarp: { label: "Group: Domain Warp (Carry)" },
  newtonFractalZ5: { label: "Newton z⁵−1" },
  waveTextureDemo: { label: "Wave Texture" },
  magicTextureDemo: { label: "Magic Texture" },
  waveInterference: { label: "Wave Interference", play: true },
  shapesAndGround3D: { label: "3D: Shapes + Ground" },
  spiralWorld3D: { label: "3D: Spiral World" },
  softMetaballs3D: { label: "3D: Soft Metaballs" },
  neonFloorGrid: { label: "Neon Floor Grid" },
  particleFlowDrift: { label: "Particles: Flow Field" },
  particleRain: { label: "Particles: Rain" },
  motionBlurTrails: { label: "Motion Blur Trails" },
  tiltShiftScene: { label: "Tilt-Shift", description: "Tilt-Shift Blur keeps one horizontal band sharp and blurs away from it, like a miniature. The scene is a perspective floor grid so the depth reads." },
  rayMarchOutputs3D: { label: "3D: Hello Sphere" },
  mlgWiggleTunnel: { label: "MLG: Wiggle Tunnel" },
  sdfPolarRepeat: { label: "3D: Polar Repeat — Radial Symmetry" },
  sdfBend3D: { label: "3D: Bend Deform" },
  sdCrossScene3D: { label: "3D: SD Cross" },
  infinitePillars3D: { label: "3D: Infinite Pillars" },
  gyroidWarped: { label: "3D: Gyroid + Domain Warp" },
  glowMarcher: { label: "3D: Glow Marcher" },
  volAnimatedRepeat: { label: "Volumetric: Animated Repeat" },
  dofOrbitOrbs: { label: "DoF: Orbit Orbs" },
  fresnelSchlickRim: { label: "Fresnel Schlick: Rim Glow", description: "Fresnel (Schlick) takes the Normal and the camera's Ray Dir directly, so the old Negate → Dot pair is gone. Its Reflect Weight scales a rim colour that is added over the lit sphere." },
  refractDirFakeGlass: { label: "Refract Dir: Fake Glass" },
  dofDepthBlur: { label: "Depth of Field: Post-Process Blur" },
  ringGlow: { label: "Ring Glow" },
  glassPhysical: { label: "Glass 3D: Physical" },
  glassMetaballs: { label: "Glass Metaballs" },
  cmykNoise: { label: "CMYK Halftone" },
  giSphereGround: { label: "GI: Sphere & Ground" },
  giBoxFrame: { label: "GI: Box Frame" },
  gridMetaballs: { label: "Grid: Metaballs" },
  gridBreathing: { label: "Grid: Breathing", description: "Animated Cell Center moves each cell's dot on its own phase (seeded by Cell ID); Circle SDF takes that as its centre and SDF Fill paints it." },
  gridDensityWave: { label: "Grid: Density Wave" },
  gridLavaLamp: { label: "Lava Lamp", description: "Metaballs from the Field family: two Gaussian Fields (one follows the mouse, one sits off-centre) are summed and Metaball Threshold turns the sum into a blob mask with a soft edge; Mask picks the two colours. Grid Size sets how big a blob is.", play: true },
  gridNeighborDisplaced: { label: "Grid: Attract", description: "Cell Displace pulls each cell's UV toward the mouse (strongly nearby, barely far away); its Attract Amount colours the dots through Palette." },
  echoTrails: { label: "Echo Trails", description: "Echo layers dimmer copies of earlier frames. A circle orbits (Rotate 2D driven by Time), SDF Glow tints it, and Add Color lays the live glow over the echoes." },
  feedbackSmear: { label: "Feedback Smear", description: "The feedback loop: Previous Frame is sampled through a slightly rotated, shrunk UV, then mixed 92/8 with fresh noise colour. Every frame smears the last one inward." },
  beatGrid: { label: "Beat Grid", description: "Grid Layout cuts the screen into cells; BPM Sync pulses every box on the beat and Audio Input (load a track) pushes them further. Cell Filter strokes every other cell; Palette colours by column with its Scale param.", play: true },
  webcamCmyk: { label: "Webcam CMYK", description: "Video Input (choose a file or the camera) sampled through Pixelate, then CMYK Halftone prints it as four rotated dot screens. Swap the halftone for Grid UV → Luma Radius → Dot Mask for a single-ink version." },
  particleGalaxy: { label: "Particle Galaxy", description: "The particle pipeline: P: Init seeds points on a disc, P: Rotate spins them with differential twist, P: Wave adds a breathing ripple, P: Color by Distance and P: Size shade them, P: Render draws them additively over the FBM nebula below." },
  litStillLife: { label: "Lit Still Life", description: "The full 3D lighting stack. A Scene Group holds a capsule, a cone and a ground plane joined by smooth Union; the March Loop Group finds the surface; SDF AO and Soft Shadow read the scene again; Multi Light combines sun, sky and bounce; Tone Map finishes." },
  spaceAtlas: { label: "Space Atlas", description: "A 2D space node reshapes the plane before any pattern sees it. Möbius Transform (pole animated by Time) feeds Truchet tiles; Scanlines finish it. Swap in Polar, Log-Polar or Kaleidoscope to compare the maps — the card preview shows each one as a checkerboard." },
  publishAndKeyframes: { label: "Publish a Node + Keyframes", description: "An iterated group (3 passes: rotate, tile, circle) is a node in waiting — select it and press ✦ Publish as node to make it one, with Iterations as a slider. SDF Glow's Falloff has a keyframe track (see the Keys tab): 6 → 40 over three seconds, looping." },
  volumeGlowDemo: { label: "Volumetric: Volume Glow", description: "The volumetric loop in two nodes: inside the March Loop Group, Scene Distance → Volume Glow accumulates with +=; after it, Glow to Color turns the sum into a tinted, tanh-limited colour. Shell hollows the sphere into a glowing skin." },
  normalColorDemo: { label: "3D: Normal to Color", description: "The March Loop Group's Normal output goes straight into Normal to Color (−1…1 → 0…1), the standard way to check a surface. Swap the mode to Abs to see the axes folded." },
  crtTv: { label: "CRT TV", description: "CRT Screen bows the tube and snaps the picture to shadow-mask cells; the picture is FBM through a Palette; CRT Mask then lays the staggered RGB grille, pulse and scanlines over it, darkened by the screen's Vignette. After Xor's GM Shaders Mini: CRT." },
  lensBarrel: { label: "Lens Distortion", description: "Lens Distortion bows a grid of boxes: positive k1 is barrel, negative pincushion, and k2 with the opposite sign gives the moustache curve of a wide zoom. Zoom crops the stretched border." },
  neonGlow: { label: "Neon Tube", description: "One SDF Glow makes a neon sign: the Tinted output is the outer halo, the Inner output lights the inside from the edge inward, and adding them gives the tube. Switch Mode to Haze or Bounded to compare falloffs. After the FragCoord Glow article." },
  fcSolar: { label: "Web: Solar", description: "After \"solar\", a community shader from the web (author credit to follow). Circle SDF \u2192 1/max(\u2212d, 10d) glow, dimmed by a per-pixel flicker and slow pulse, tinted, Tone Map Tanh\u00b2 for the golfed-shader roll-off." },
  fcPillars: { label: "Web: Pillars", description: "After \"pillars\", a community shader from the web (author credit to follow). Scrolling UV \u2192 Infinite Repeat (2\u00d72 cells) \u2192 a sqrt(1 \u2212 x\u00b2) cylinder profile that flips sign per column \u2192 sine Palette." },
  fcGradient4: { label: "Web: Gradient 4", description: "After \"gradient 4\", a community shader from the web (author credit to follow). One phase expression (folded cosines + hash grain) into a sine Palette, divided by |cos(x/0.1)| stripes. Noise Float in Hash mode replaces the fract(cos(dot\u2026)) one-liner." },
  fcGrainGradient: { label: "Web: Grain Gradient", description: "After \"grain gradient\", a community shader from the web (author credit to follow). Perlin Noise Float \u2192 Remap \u2192 Rotate 2D spins the canvas; a two-line wave warp; four Mix nodes cycle six colours; two Smoothstep-driven Mix layers; Brightness/Contrast and Grain finish." },
  fcTiling: { label: "Web: Rotating Cross Tiles", description: "After \"tiling\", a community shader from the web (author credit to follow). One group used twice: Rotate 2D \u2192 Infinite Repeat (\u221a10 cells) \u2192 un-rotate \u2192 per-cell spin phase from the Cell ID \u2192 Shape SDF Cross \u2192 Smoothstep. The white and black grids are offset copies; an expression picks whichever is spinning." },
  fcTheScreen: { label: "Web: The Screen", description: "After \"the screen\", a community shader from the web (author credit to follow). A 16-iteration group (the loop cap; the original steps ~127 times): Loop Index \u2192 layer depth \u2192 one projection expression \u2192 window-light expression accumulated with +=. Then a \u2074\u221a tone tail. Shows how a golfed for-loop maps onto an iterated group." },
  fcShield: { label: "Web: Shield", description: "After \"Shield\", a community shader from the web (author credit to follow). 16 zoomed layers in an iterated group (the loop cap; the original uses 100): Spherical (Dome mode) bulges each layer and its Height output shades it; Infinite Repeat with Stagger 0.5 makes the brickwork; an edge-glow expression accumulates; Tone Map Tanh\u00b2." },
  fcMainFrame: { label: "Web: Main Frame", description: "After \"main frame\", a community shader from the web (author credit to follow). Nine layers in an iterated group; each runs a 7-step fold in a Custom Function, then 0.02/l\u00b2 glow \u00d7 a cosine Palette accumulates. Previous Frame sampled through a sine warp, squared and added, gives the feedback smear; Tone Map Tanh." },
  fcAtlantic: { label: "Web: Atlantic", description: "After \"atlantic\", a community shader from the web (author credit to follow). March Camera + Scene Group + March Loop Group. The scene is Scene Pos \u2192 Turbulence 3D (ten sine octaves) \u2192 tilted plane \u2192 a soft step-size expression; the volumetric loop accumulates 1.2/(d\u00b7z); tint and Tone Map Tanh." },
  fcOrb: { label: "Web: Orb", description: "After \"orb\", a community shader from the web (author credit to follow). March Camera orbiting a Scene Group: a gyroid shell (|1.4 + cos\u00b7cos|) intersected with a Sphere 3D. Inside the volumetric March Loop Group a Palette of the x position, divided by the distance, accumulates per step; Tone Map Tanh." },
  fcBitshift: { label: "Web: Bitshift", description: "After \"bitshift\", a community shader from the web (author credit to follow). Split \u2192 two Quantize (1/32) \u2192 Make Vec2 snaps the UV to a coarse grid; one expression for the tan() ripple; \u00d7\u00bc then Posterize (4 levels) reproduces floor(x)/4." },
  fcTrippyNoise: { label: "Web: Trippy Noise", description: "After \"trippy noise\", a community shader from the web (author credit to follow). Rotate 2D \u2192 |uv| \u2192 Polar angle drives a second Rotate; three Noise Floats (value noise, offset \u00b10.333) \u2192 Smoothstep \u2192 RGB tints summed; Vignette, lift, a Texture Input screened in through Blend Modes (an empty image slot changes nothing), and Bloom replaces the threshold \u2192 blur X \u2192 blur Y \u2192 screen passes." },
  comboRepeatCellHash: { label: "Combo: Repeat + Cell ID + Hash", description: "Infinite Repeat (Stagger 0.5) tiles the UV; its Cell ID feeds a Hash Noise Float \u2192 Palette so every brick gets its own colour; Circle SDF on the Cell UV \u2192 SDF Fill. The standard repeat-and-vary recipe. Infinite Repeat again, tiling a 3D dome: Combo: Dome + Repeat + Height." },
  comboTurbulenceGlow: { label: "Combo: Turbulence + SDF + Glow", description: "Turbulence (Xor's sine loop) warps the UV before a Circle SDF; SDF Glow in Simple mode with a Palette tint turns the wobbling distance into light. Swap the SDF for FBM or a Grid to see the warp on anything. The same loop in 3D, warping a plane: Web: Atlantic (Turbulence 3D); the glow-to-colour half again: Combo: Chaos Layers + Glow to Color." },
  comboBloomDots: { label: "Combo: Grid + SDF Fill + Bloom", description: "Grid \u2192 Circle SDF on the Cell UV \u2192 SDF Fill draws bright dots coloured by Cell ID; Bloom (Luma select, Layered kernel \u2014 Xor's bloom article) thresholds, blurs and screens the highlights: the whole threshold \u2192 Blur X \u2192 Blur Y \u2192 screen pass chain in one node. Bloom on a full picture: Web: Trippy Noise; the blur half on its own: Combo: Wave Texture + Blur H/V." },
  comboDomeRepeat: { label: "Combo: Dome + Repeat + Height", description: "Spherical in Dome mode bulges the plane like a hemisphere; Infinite Repeat tiles a Box SDF over it; the Height output shades the dome and masks everything outside the unit circle. Dome mode where it came from: Web: Shield; the Repeat + Cell ID half: Combo: Repeat + Cell ID + Hash." },
  comboChaosStars: { label: "Combo: Chaos Layers + Glow to Color", description: "Chaos Layers (Xor's Efficient Chaos: five golden-angle rotated, shifted, scaled cell grids with parallax) makes a starfield; Glow to Color tints the summed light and its Layer output colours near stars warmer via a Palette. Another float-glow-to-colour chain: Combo: Turbulence + SDF + Glow." },
  colorStopsCycle: { label: "Color: Stops Palette + Colorize", description: "Stops Palette builds a palette from five colour stops (Loop, Smooth) and cycles it with Time on Angle offset; the angle around the centre (Vec2 \u2192 Angle, Scale 1/2\u03c0) runs the stops once around the ring, and Loop makes the join seamless. A ring's SDF Glow is the field, and Colorize paints it with the palette: Colour \u00d7 Field, the job Scale Color used to do. Change a stop's swatch or the Wrap mode to see the cycle change." },
  midiGlowKeys: { label: "MIDI: Keys to Glow", description: "MIDI Input turns a controller into floats \u2014 or the computer keyboard: turn on the keyboard stand-in on the card and play the A\u2013K row. Velocity sets the circle's Radius (Multiply + Add), Gate brightens the SDF Glow while a key is held (Multiply on the Tinted output), Note picks the Palette colour, and CC 1 (the mod wheel) drives Turbulence strength on the UV. The same shape as the Audio Input examples: an outside signal in, floats out, everything else is ordinary nodes." },
  voxelTerrain: { label: "3D: Voxel Terrain", description: "Voxelize snaps the ray position to a 0.5 grid inside the Scene Group; Box 3D on its Cell Pos is one cube per cell and an Expression Block decides which cells are solid from the Cell ID (a wave plus a hash gives the height), and, for empty cells, steps exactly to where the ray leaves the cell (the camera's Ray Dir is wired into the Scene Group as a port) — a voxel traversal inside an ordinary march. Outside, the March Loop Group's Hit Pos goes through a second Voxelize whose Cell ID drives a Palette, so every cube has its own colour; Mix by Hit keeps the sky plain." },
  comboVoxelSpheres: { label: "Combo: Voxelize + Sphere 3D + Hash", description: "Voxelize \u2192 Sphere 3D on the Cell Pos puts one sphere in every 0.6 cell; an Expression Block hashes the Cell ID into the sphere's Radius so sizes vary per cell (some vanish), and Intersect with a Box 3D on the raw position trims the infinite field to a block. Outside the scene, Hit Pos \u2192 Voxelize \u2192 Cell ID \u2192 Palette colours each sphere \u2014 one Cell Size Constant feeds both Voxelize nodes (the scene's through a group port), so the colour grid always matches the geometry. The 3D twin of Combo: Repeat + Cell ID + Hash; the terrain version is 3D: Voxel Terrain." },
  comboBlurDirectional: { label: "Combo: Wave Texture + Blur H/V", description: "A sharp Wave Texture through Gaussian Blur set to Horizontal only, Kawase quality (the four diagonal taps from Intel's fast-blur article): the separable Blur X pass from the blur articles, on its own a streak. Switch Direction to Vertical or Both on the card to compare. Both passes plus threshold and screen in one node: Combo: Grid + SDF Fill + Bloom." },
  // The Play folder: one numbered example per Play technique (playExampleIndex.ts).
  ...PLAY_EXAMPLE_INDEX,
  // The Learn folder: the Book of Shaders course as graphs (learnExampleIndex.ts).
  ...LEARN_EXAMPLE_INDEX,
  // Node Combos built from the definitions (comboExamples.ts): the Grid Pattern → shape → Grid Paint flow, and field sockets.
  ...COMBO_EXAMPLE_INDEX,
  // The Matrices folder (matrixExamples.ts): combining, undoing, lattices, fractals, corner pin, colour.
  ...MATRIX_EXAMPLE_INDEX,
};

// The default graph to load on startup
export const DEFAULT_EXAMPLE = 'fractalRings';

/** Loads the full example set on first use; the module system caches it after that. */
export async function loadExampleGraphs(): Promise<Record<string, ExampleGraph>> {
  const mod = await import('./exampleGraphs');
  return mod.EXAMPLE_GRAPHS;
}

// ── Example folders ──────────────────────────────────────────────────────────
// Groups example keys into categories for the desktop NodePalette's Examples
// browser and the mobile examples picker (App.tsx) — one taxonomy, shared, so
// the two surfaces never drift.
export const EXAMPLE_FOLDERS: Array<{ label: string; color: string; keys: string[] }> = [
  { label: "Play",              color: ctp.pink, keys: PLAY_EXAMPLE_KEYS },
  { label: "Learn",             color: ctp.lavender, keys: LEARN_EXAMPLE_KEYS },
  { label: "Color & Lighting",  color: ctp.peach, keys: ['neonGlow','colorStopsCycle'] },
  { label: "Effects & Lens",    color: ctp.mauve, keys: ['echoTrails','feedbackSmear','crtTv','lensBarrel'] },
  { label: "Space & Texture",   color: ctp.flamingo, keys: ['waveTextureDemo','waveInterference','magicTextureDemo','neonFloorGrid','spaceAtlas'] },
  { label: "Grid",              color: ctp.sky, keys: ['gridNeighborDisplaced','gridMetaballs','gridBreathing','gridDensityWave','gridLavaLamp','beatGrid'] },
  { label: "Matrices",          color: ctp.peach, keys: MATRIX_EXAMPLE_KEYS },
  { label: "Halftone",          color: '#a6e3d5', keys: ['cmykNoise','webcamCmyk'] },
  { label: "Rings",             color: ctp.red, keys: ['fractalRings'] },
  { label: "Iterated Groups",   color: ctp.green, keys: ['groupCarryRings','groupCarryFBM','groupCarryDomainWarp','publishAndKeyframes'] },
  { label: "Fractals",          color: ctp.mauve, keys: ['newtonFractalZ5','gravitationalLens'] },
  { label: "Physics",           color: ctp.teal, keys: ['chladniFieldQuickDemo','chladniModeFreqDemo'] },
  { label: "Particles",         color: ctp.pink, keys: ['particleFlowDrift','particleRain','particleGalaxy'] },
  { label: "Inputs",            color: ctp.teal, keys: ['midiGlowKeys'] },
  { label: "Blur & Lens",       color: ctp.blue, keys: ['motionBlurTrails','tiltShiftScene','dofOrbitOrbs','dofDepthBlur','comboBlurDirectional'] },
  { label: "Functions",         color: ctp.sapphire, keys: ['ringGlow'] },
  { label: "3D Basics",         color: ctp.sky, keys: ['raymarchSpheres','rayMarchOutputs3D','shapesAndGround3D','softMetaballs3D','normalColorDemo'] },
  { label: "3D SDF",            color: ctp.sky, keys: ['sdfPolarRepeat','sdfBend3D','sdCrossScene3D','infinitePillars3D','spiralWorld3D','gyroidWarped','mlgWiggleTunnel','voxelTerrain'] },
  { label: "3D Lighting",       color: '#f9c468', keys: ['fresnelSchlickRim','refractDirFakeGlass','glassPhysical','glassMetaballs','litStillLife'] },
  { label: "GI Lighting",       color: ctp.green, keys: ['giSphereGround','giBoxFrame'] },
  { label: "Volumetric",        color: '#f5a97f', keys: ['glowMarcher','volAnimatedRepeat','volumeGlowDemo'] },
  { label: "From the Internet",    color: ctp.yellow, keys: ['fcTrippyNoise','fcSolar','fcPillars','fcGradient4','fcGrainGradient','fcTiling','fcTheScreen','fcShield','fcMainFrame','fcAtlantic','fcOrb','fcBitshift'] },
  { label: "Node Combos",        color: ctp.flamingo, keys: ['comboChaosStars','comboRepeatCellHash','comboTurbulenceGlow','comboBloomDots','comboDomeRepeat','comboVoxelSpheres','comboGridPaintShapes','comboGridPaintPictures','comboGridPaintGlow','comboGridShapeByWire','comboArrayStars'] },
];
