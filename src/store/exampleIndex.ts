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
        },
        outputs: { glow: { type: 'float', label: 'Glow' } },
        params: { mode: 'glow', brightness: 10.0, ringFreq: 8.0 },
      },
      {
        id: 'n2', type: 'output', position: { x: 820, y: 240 },
        inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'n4', outputKey: 'glow' } } },
        outputs: {}, params: {},
      },
    ],
  };

/** Key → label for every bundled example (generated from exampleGraphs.ts). */
export const EXAMPLE_INDEX: Record<string, { label: string; description?: string; /** Loads with a Play setup */ play?: boolean }> = {
  blank: { label: BLANK_GRAPH.label },
  fractalRings: { label: "Fractal Rings" },
  forLoopRings: { label: "For Loop Rings" },
  exprOrbit: { label: "Expr Orbit" },
  shapeShowcase: { label: "Shape Showcase" },
  toneMapDemo: { label: "Tone Map — ACES" },
  glowCircle: { label: "Glowing Circle", description: "The smallest complete graph: UV → Circle SDF → SDF Glow → Tone Map → Output. SDF Glow's Tinted output already carries the colour, so no Palette or Multiply is needed.", play: true },
  fbmLandscape: { label: "FBM Landscape" },
  angularGradient: { label: "Angular Gradient" },
  raymarchSpheres: { label: "Raymarch Spheres" },
  gravitationalLens: { label: "Gravity Lens" },
  chladniFieldQuickDemo: { label: "Chladni Field (Quick)" },
  chladniComposableDemo: { label: "Chladni (Composable)" },
  chladniModeFreqDemo: { label: "Chladni Mode Frequency" },
  noiseFloatDemo: { label: "Noise Float — Wobbly Circle" },
  groupCarryRings: { label: "Group: Fractal Rings (Carry)" },
  groupCarryFBM: { label: "Group: FBM Octaves (Carry)" },
  groupCarryDomainWarp: { label: "Group: Domain Warp (Carry)" },
  lumaGrainDemo: { label: "Film Grain" },
  newtonFractalZ5: { label: "Newton z⁵−1" },
  blackbodyDemo: { label: "Blackbody" },
  waveTextureDemo: { label: "Wave Texture" },
  magicTextureDemo: { label: "Magic Texture" },
  gridDemo: { label: "Grid: Checker" },
  blendModesDemo: { label: "Blend Modes — Screen" },
  colorRampFBM: { label: "Color Ramp: FBM Terrain" },
  waveInterference: { label: "Wave Interference", play: true },
  complexPowFlower: { label: "Complex Power Flower" },
  shapesAndGround3D: { label: "3D: Shapes + Ground" },
  spiralWorld3D: { label: "3D: Spiral World" },
  softMetaballs3D: { label: "3D: Soft Metaballs" },
  depthIterAO3D: { label: "3D: Depth + Iter AO" },
  neonFloorGrid: { label: "Neon Floor Grid" },
  spectralLens: { label: "Spectral Lens" },
  alphaLayerDemo: { label: "Alpha Layer Demo" },
  particleFlowDrift: { label: "Particles: Flow Field" },
  particleOrbitCloud: { label: "Particles: Orbit Cloud" },
  particleRain: { label: "Particles: Rain" },
  motionBlurTrails: { label: "Motion Blur Trails" },
  tiltShiftScene: { label: "Tilt-Shift", description: "Tilt-Shift Blur keeps one horizontal band sharp and blurs away from it, like a miniature. The scene is a perspective floor grid so the depth reads." },
  lensBokeh: { label: "Lens Blur Bokeh" },
  weightedSdfBlend: { label: "Weighted SDF Blend" },
  fractalGlowBlur: { label: "Fractal + Blur Glow" },
  ray3DVignette: { label: "3D Sphere + Vignette" },
  kaleido3DBox: { label: "Kaleido + 3D Box" },
  rotate3D: { label: "3D: Rotate" },
  fold3D: { label: "3D: Fold Symmetry" },
  sinWarp3D: { label: "3D: Sin Warp" },
  repeat3D: { label: "3D: Repeat / Tile" },
  rayMarchOutputs3D: { label: "3D: Hello Sphere" },
  mlgWiggleTunnel: { label: "MLG: Wiggle Tunnel" },
  sdfPolarRepeat: { label: "3D: Polar Repeat — Radial Symmetry" },
  sdfBend3D: { label: "3D: Bend Deform" },
  sdfIntersectDemo: { label: "3D: Boolean Intersect" },
  mirroredTileRepeat: { label: "2D: Mirrored Tiles" },
  angularFlowerRepeat: { label: "2D: Angular Repeat" },
  sdCrossScene3D: { label: "3D: SD Cross" },
  infinitePillars3D: { label: "3D: Infinite Pillars" },
  aoSphere: { label: "3D Lighting: AO Sphere" },
  conditionalCircle: { label: "Conditionals / Hard Circle" },
  conditionalBrightnessGate: { label: "Conditionals / Brightness Gate" },
  conditionalApproxMatch: { label: "Conditionals / Approx Match" },
  gyroidWarped: { label: "3D: Gyroid + Domain Warp" },
  mirrorFoldSpheres: { label: "3D: Mirror Fold Spheres" },
  vec3SwizzlePalette: { label: "Vec3 Swizzle: Color Cycle" },
  vec2SwizzleUV: { label: "Vec2 Swizzle: UV Reflection" },
  glowMarcher: { label: "3D: Glow Marcher" },
  volAnimatedRepeat: { label: "Volumetric: Animated Repeat" },
  dofOrbitOrbs: { label: "DoF: Orbit Orbs" },
  phaseHGForwardCloud: { label: "Phase HG: Forward Scatter Cloud" },
  fresnelSchlickRim: { label: "Fresnel Schlick: Rim Glow" },
  refractDirFakeGlass: { label: "Refract Dir: Fake Glass" },
  dofDepthBlur: { label: "Depth of Field: Post-Process Blur" },
  ringGlow: { label: "Ring Glow" },
  matrixShear: { label: "Matrix: Shear" },
  matrixColorGrade: { label: "Matrix: RGB Color Grade", description: "A mat3 as a colour grade: Mat Const holds the 3×3 mixing matrix and Mat3×Vec3 applies it to every pixel of the palette. Off-diagonal values bleed one channel into another." },
  cgHueRotate: { label: "Color Grade: Hue Rotate" },
  cgChain: { label: "Color Grade: Full Chain" },
  glassPhysical: { label: "Glass 3D: Physical" },
  spectralPrism: { label: "Spectral Prism (rygcbv)" },
  blinnPhongSphere: { label: "Blinn-Phong: Lit Sphere" },
  glassMetaballs: { label: "Glass Metaballs" },
  halftoneNoise: { label: "Halftone Noise" },
  cmykNoise: { label: "CMYK Halftone" },
  ringHalftone: { label: "Ring Halftone" },
  glassSceneOrbPillars: { label: "Glass Scene: Orb + Pillars" },
  glassIridescentRim: { label: "Glass: Iridescent Rim" },
  giSphereGround: { label: "GI: Sphere & Ground" },
  giBoxFrame: { label: "GI: Box Frame" },
  gridBasic: { label: "Grid: Rings" },
  gridWave: { label: "Grid: Wave" },
  gridGravity: { label: "Grid: Gravity" },
  gridMetaballs: { label: "Grid: Metaballs" },
  gridBreathing: { label: "Grid: Breathing", description: "Animated Cell Center moves each cell's dot on its own phase (seeded by Cell ID); Circle SDF takes that as its centre and SDF Fill paints it." },
  gridDensityWave: { label: "Grid: Density Wave" },
  gridLavaLamp: { label: "Lava Lamp", description: "Metaballs from the Field family: two Gaussian Fields (one follows the mouse) are summed and Metaball Threshold turns the sum into a blob mask with a soft edge; Mask picks the two colours.", play: true },
  gridOnionRings: { label: "Grid: Onion Rings" },
  gridIronFilings: { label: "Grid: Iron Filings" },
  gridNeighborDisplaced: { label: "Grid: Attract", description: "Cell Displace pulls each cell's UV toward the mouse (strongly nearby, barely far away); its Attract Amount colours the dots through Palette." },
  echoTrails: { label: "Echo Trails", description: "Echo layers dimmer copies of earlier frames. A circle orbits (Rotate 2D driven by Time), SDF Glow tints it, and Add Color lays the live glow over the echoes." },
  feedbackSmear: { label: "Feedback Smear", description: "The feedback loop: Previous Frame is sampled through a slightly rotated, shrunk UV, then mixed 92/8 with fresh noise colour. Every frame smears the last one inward." },
  beatGrid: { label: "Beat Grid", description: "Grid Layout cuts the screen into cells; BPM Sync pulses every box on the beat and Audio Input (load a track) pushes them further. Cell Filter strokes every other cell; Palette colours by column with its Scale param.", play: true },
  webcamCmyk: { label: "Webcam CMYK", description: "Video Input (choose a file or the camera) sampled through Pixelate, then CMYK Halftone prints it as four rotated dot screens. Swap the halftone for Grid UV → Luma Radius → Dot Mask for a single-ink version." },
  particleGalaxy: { label: "Particle Galaxy", description: "The particle pipeline: P: Init seeds points on a disc, P: Rotate spins them with differential twist, P: Wave adds a breathing ripple, P: Color by Distance and P: Size shade them, P: Render draws them additively over the FBM nebula below." },
  litStillLife: { label: "Lit Still Life", description: "The full 3D lighting stack. A Scene Group holds a capsule, a cone and a ground plane joined by smooth Union; the March Loop Group finds the surface; SDF AO and Soft Shadow read the scene again; Multi Light combines sun, sky and bounce; Tone Map finishes." },
  spaceAtlas: { label: "Space Atlas", description: "A 2D space node reshapes the plane before any pattern sees it. Möbius Transform (pole animated by Time) feeds Truchet tiles; Scanlines finish it. Swap in Polar, Log-Polar or Kaleidoscope to compare the maps — the card preview shows each one as a checkerboard." },
  shaperPlayground: { label: "Shaper Playground", description: "Shapers bend a 0–1 value. Here uv.x becomes the circle's radius after a Logistic Sigmoid, so the shape's outline is the curve itself; Scope graphs the Cubic Bezier version live and Print Float shows the number at the pointer height. Swap the shaper to see the outline change." },
  colorAdjust: { label: "Color Adjust", description: "The Adjust family in one chain: Hue Range boosts one band of hues, Brightness / Contrast, Posterize steps the levels, Saturation pushes the result. Invert drops in anywhere. Reorder the chain to see why order matters." },
  publishAndKeyframes: { label: "Publish a Node + Keyframes", description: "An iterated group (3 passes: rotate, tile, circle) is a node in waiting — select it and press ✦ Publish as node to make it one, with Iterations as a slider. SDF Glow's Falloff has a keyframe track (see the Keys tab): 6 → 40 over three seconds, looping." },
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
  { label: "Basics",            color: ctp.lavender, keys: ['forLoopRings','noiseFloatDemo','alphaLayerDemo','weightedSdfBlend'] },
  { label: "Color & Lighting",  color: ctp.peach, keys: ['glowCircle','blackbodyDemo','blendModesDemo','toneMapDemo','angularGradient','shapeShowcase','fbmLandscape','spectralLens','vec3SwizzlePalette','vec2SwizzleUV','colorRampFBM'] },
  { label: "Color Grading",     color: '#f9a86b', keys: ['cgHueRotate','cgChain','lumaGrainDemo','colorAdjust'] },
  { label: "Effects & Feedback",color: ctp.mauve, keys: ['echoTrails','feedbackSmear'] },
  { label: "Space & Texture",   color: ctp.flamingo, keys: ['waveTextureDemo','waveInterference','magicTextureDemo','gridDemo','mirroredTileRepeat','neonFloorGrid','spaceAtlas'] },
  { label: "Patterns",          color: ctp.green, keys: ['angularFlowerRepeat','complexPowFlower'] },
  { label: "Grid",              color: ctp.sky, keys: ['gridBasic','gridWave','gridNeighborDisplaced','gridGravity','gridMetaballs','gridBreathing','gridDensityWave','gridLavaLamp','gridOnionRings','gridIronFilings','beatGrid'] },
  { label: "Halftone",          color: '#a6e3d5', keys: ['halftoneNoise','cmykNoise','ringHalftone','webcamCmyk'] },
  { label: "Rings",             color: ctp.red, keys: ['fractalRings','exprOrbit'] },
  { label: "Iterated Groups",   color: ctp.green, keys: ['groupCarryRings','groupCarryFBM','groupCarryDomainWarp','publishAndKeyframes'] },
  { label: "Shapers",           color: ctp.yellow, keys: ['shaperPlayground'] },
  { label: "Conditionals",      color: ctp.yellow, keys: ['conditionalCircle','conditionalBrightnessGate','conditionalApproxMatch'] },
  { label: "Fractals",          color: ctp.mauve, keys: ['newtonFractalZ5','gravitationalLens'] },
  { label: "Physics",           color: ctp.teal, keys: ['chladniFieldQuickDemo','chladniComposableDemo','chladniModeFreqDemo'] },
  { label: "Particles",         color: ctp.pink, keys: ['particleFlowDrift','particleOrbitCloud','particleRain','particleGalaxy'] },
  { label: "Blur & Lens",       color: ctp.blue, keys: ['motionBlurTrails','tiltShiftScene','lensBokeh','dofOrbitOrbs','dofDepthBlur','fractalGlowBlur'] },
  { label: "Matrix",            color: '#f5c842', keys: ['matrixShear','matrixColorGrade'] },
  { label: "Functions",         color: ctp.sapphire, keys: ['ringGlow'] },
  { label: "3D Basics",         color: ctp.sky, keys: ['raymarchSpheres','rayMarchOutputs3D','shapesAndGround3D','rotate3D','fold3D','sinWarp3D','repeat3D','softMetaballs3D','depthIterAO3D','ray3DVignette','kaleido3DBox'] },
  { label: "3D SDF",            color: ctp.sky, keys: ['sdfPolarRepeat','sdfBend3D','sdfIntersectDemo','sdCrossScene3D','infinitePillars3D','spiralWorld3D','gyroidWarped','mirrorFoldSpheres','mlgWiggleTunnel'] },
  { label: "3D Lighting",       color: '#f9c468', keys: ['aoSphere','phaseHGForwardCloud','fresnelSchlickRim','refractDirFakeGlass','glassPhysical','spectralPrism','blinnPhongSphere','glassMetaballs','glassSceneOrbPillars','glassIridescentRim','litStillLife'] },
  { label: "GI Lighting",       color: ctp.green, keys: ['giSphereGround','giBoxFrame'] },
  { label: "Volumetric",        color: '#f5a97f', keys: ['glowMarcher','volAnimatedRepeat'] },
];
