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
import { ctp } from '../theme/palette';

export type ExampleGraph = { label: string; nodes: GraphNode[]; counter: number };

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
export const EXAMPLE_INDEX: Record<string, { label: string }> = {
  blank: { label: BLANK_GRAPH.label },
  fractalRings: { label: "Fractal Rings" },
  forLoopRings: { label: "For Loop Rings" },
  exprOrbit: { label: "Expr Orbit" },
  shapeShowcase: { label: "Shape Showcase" },
  toneMapDemo: { label: "Tone Map — ACES" },
  glowCircle: { label: "Glowing Circle" },
  fbmLandscape: { label: "FBM Landscape" },
  angularGradient: { label: "Angular Gradient" },
  raymarchSpheres: { label: "Raymarch Spheres" },
  gravitationalLens: { label: "Gravity Lens" },
  chladniFieldQuickDemo: { label: "Chladni Field (Quick)" },
  chladniComposableDemo: { label: "Chladni (Composable)" },
  chladniModeFreqDemo: { label: "Chladni Mode Frequency" },
  noiseFloatDemo: { label: "Noise Float — Wobbly Circle" },
  posterizeDemo: { label: "Posterize" },
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
  waveInterference: { label: "Wave Interference" },
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
  tiltShiftScene: { label: "Tilt-Shift" },
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
  matrixColorGrade: { label: "Matrix: RGB Color Grade" },
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
  gridBreathing: { label: "Grid: Breathing" },
  gridDensityWave: { label: "Grid: Density Wave" },
  gridLavaLamp: { label: "Grid: Lava Lamp" },
  gridOnionRings: { label: "Grid: Onion Rings" },
  gridIronFilings: { label: "Grid: Iron Filings" },
  gridNeighborDisplaced: { label: "Grid: Scatter" },
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
  { label: "Basics",           color: ctp.lavender, keys: ['forLoopRings','noiseFloatDemo','alphaLayerDemo','weightedSdfBlend'] },
  { label: "Color & Lighting", color: ctp.peach, keys: ['glowCircle','blackbodyDemo','blendModesDemo','toneMapDemo','angularGradient','shapeShowcase','fbmLandscape','spectralLens','vec3SwizzlePalette','vec2SwizzleUV','colorRampFBM'] },
  { label: "Color Grading",    color: '#f9a86b', keys: ['cgHueRotate','cgChain','lumaGrainDemo','posterizeDemo'] },
  { label: "Space & Texture",  color: ctp.flamingo, keys: ['waveTextureDemo','waveInterference','magicTextureDemo','gridDemo','mirroredTileRepeat','neonFloorGrid'] },
  { label: "Patterns",         color: ctp.green, keys: ['angularFlowerRepeat','complexPowFlower'] },
  { label: "Grid",             color: ctp.sky, keys: ['gridBasic','gridWave','gridNeighborDisplaced','gridGravity','gridMetaballs','gridBreathing','gridDensityWave','gridLavaLamp','gridOnionRings','gridIronFilings'] },
  { label: "Halftone",         color: '#a6e3d5', keys: ['halftoneNoise','cmykNoise','ringHalftone'] },
  { label: "Rings",            color: ctp.red, keys: ['fractalRings','exprOrbit'] },
  { label: "Iterated Groups",  color: ctp.green, keys: ['groupCarryRings','groupCarryFBM','groupCarryDomainWarp'] },
  { label: "Conditionals",     color: ctp.yellow, keys: ['conditionalCircle','conditionalBrightnessGate','conditionalApproxMatch'] },
  { label: "Fractals",         color: ctp.mauve, keys: ['newtonFractalZ5','gravitationalLens'] },
  { label: "Physics",          color: ctp.teal, keys: ['chladniFieldQuickDemo','chladniComposableDemo','chladniModeFreqDemo'] },
  { label: "Particles",        color: ctp.pink, keys: ['particleFlowDrift','particleOrbitCloud','particleRain'] },
  { label: "Blur & Lens",      color: ctp.blue, keys: ['motionBlurTrails','tiltShiftScene','lensBokeh','dofOrbitOrbs','dofDepthBlur','fractalGlowBlur'] },
  { label: "Matrix",           color: '#f5c842', keys: ['matrixShear','matrixColorGrade'] },
  { label: "Functions",        color: ctp.sapphire, keys: ['ringGlow'] },
  { label: "3D Basics",        color: ctp.sky, keys: ['raymarchSpheres','rayMarchOutputs3D','shapesAndGround3D','rotate3D','fold3D','sinWarp3D','repeat3D','softMetaballs3D','depthIterAO3D','ray3DVignette','kaleido3DBox'] },
  { label: "3D SDF",           color: ctp.sky, keys: ['sdfPolarRepeat','sdfBend3D','sdfIntersectDemo','sdCrossScene3D','infinitePillars3D','spiralWorld3D','gyroidWarped','mirrorFoldSpheres','mlgWiggleTunnel'] },
  { label: "3D Lighting",      color: '#f9c468', keys: ['aoSphere','phaseHGForwardCloud','fresnelSchlickRim','refractDirFakeGlass','glassPhysical','spectralPrism','blinnPhongSphere','glassMetaballs','glassSceneOrbPillars','glassIridescentRim'] },
  { label: "GI Lighting",      color: ctp.green, keys: ['giSphereGround','giBoxFrame'] },
  { label: "Volumetric",       color: '#f5a97f', keys: ['glowMarcher','volAnimatedRepeat'] },
];
