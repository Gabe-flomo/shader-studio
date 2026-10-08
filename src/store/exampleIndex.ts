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
import type { SourceCredit } from '../types/credit';
import type { DatasetsRecord } from '../data/types';
import { ctp } from '../theme/palette';
import { PLAY_EXAMPLE_INDEX, PLAY_EXAMPLE_KEYS } from './playExampleIndex';
import { LEARN_COLOR_KEYS, LEARN_CURVES_KEYS, LEARN_EXAMPLE_INDEX, LEARN_EXAMPLE_KEYS, LEARN_GRID_KEYS, LEARN_MOVED_INDEX } from './learnExampleIndex';
import { LEARN3D_EXAMPLE_INDEX, LEARN3D_EXAMPLE_KEYS } from './learn3dExampleIndex';
import { CURVED_EXAMPLE_INDEX, CURVED_EXAMPLE_KEYS } from './curvedSpaceExampleIndex';
import { REPEAT_SCENE_EXAMPLE_INDEX, REPEAT_SCENE_EXAMPLE_KEYS } from './repeatSceneExampleIndex';
import { COMBO_EXAMPLE_INDEX } from './comboExamples';
import { MATRIX_EXAMPLE_INDEX, MATRIX_EXAMPLE_KEYS } from './matrixExamples';
import { DATA_EXAMPLE_INDEX, DATA_EXAMPLE_KEYS } from './dataExampleIndex';
import { GRID_EXAMPLE_INDEX, GRID_EXAMPLE_KEYS } from './gridExamples';
import { PASS_EXAMPLE_INDEX, PASS_EXAMPLE_KEYS } from './passExamples';
import { AGENT_EXAMPLE_INDEX, AGENT_EXAMPLE_KEYS, AGENT_RULE_INDEX } from './agentExamples';
import { AGENT_SHADER_EXAMPLE_INDEX, AGENT_SHADER_EXAMPLE_KEYS } from './agentShaderExamples';
import { AGENT_3D_EXAMPLE_INDEX, AGENT_3D_EXAMPLE_KEYS } from './agentExamples3d';
import { SIM_AGENT_EXAMPLE_INDEX, SIM_AGENT_EXAMPLE_KEYS } from './agentExamplesSim';
import { CONVERT_EXAMPLE_INDEX, CONVERT_EXAMPLE_KEYS } from './convertExampleIndex';
import { BAKE_EXAMPLE_INDEX } from './bakeExamples';
import { TIME_CUBE_EXAMPLE_INDEX, TIME_CUBE_EXAMPLE_KEYS } from './timeCubeExamples';
import { FRAME_STACK_EXAMPLE_INDEX, FRAME_STACK_EXAMPLE_KEYS } from './frameStackExamples';
import { FOURD_EXAMPLE_INDEX, FOURD_EXAMPLE_KEYS } from './fourDExamples';
import { TEXTURE_TOOL_EXAMPLE_INDEX, TEXTURE_TOOL_EXAMPLE_KEYS } from './textureToolExamples';
import { SIM_GRID_EXAMPLE_INDEX } from './simGridExamples';
import { GRID_RULES_EXAMPLE_INDEX, simGridsFolderKeys } from './gridRulesExampleIndex';
import { AGENT_RULE_EXAMPLE_INDEX, AGENT_RULE_EXAMPLE_KEYS } from './agentRuleExamples';
import { SCENE_BUILDER_EXAMPLE_INDEX, SCENE_BUILDER_EXAMPLE_KEYS } from './sceneBuilderExampleIndex';
import { SCENE_BUILDER_2D_EXAMPLE_INDEX, SCENE_BUILDER_2D_EXAMPLE_KEYS } from './sceneBuilder2dExampleIndex';

export type ExampleGraph = {
  label: string; nodes: GraphNode[]; counter: number;
  /** One line on what the example teaches, shown in the Examples list */
  description?: string;
  /** A ready-made Play setup (controls + mappings) that loads with the graph. */
  play?: PlayRecord;
  /** Where it comes from (a book chapter, an article): shown under its name in the lists. */
  source?: SourceCredit;
  /** Datasets the graph's Data nodes read (src/data/types.ts), loaded with it. */
  datasets?: DatasetsRecord;
  /**
   * Pictures for nodes' image slots, loaded with the graph: `${nodeId}::${slot}` (or a Texture Input's id) → a data URL
   * (a bundled `?inline` asset), as if picked with the card's Load image.
   */
  images?: Record<string, string>;
};

/** What an example list shows for one example, without loading it. */
export type ExampleIndexEntry = {
  label: string; description?: string;
  /** Loads with a Play setup */
  play?: boolean;
  /** Where it comes from, shown as a credit line under the name. */
  source?: SourceCredit;
};

/** One of Xor's GM Shaders articles (mini.gmshaders.com), credited where an example follows it. */
const xor = (title: string, slug: string): SourceCredit => ({ title, author: 'Xor', url: `https://mini.gmshaders.com/p/${slug}` });

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
export const EXAMPLE_INDEX: Record<string, ExampleIndexEntry> = {
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
  particleFlowDrift: { label: "Particles: Flow Field", description: "A Particles node in a flow field: an FBM noise wired into Flow (Around) steers a quarter of a million particles along its contours, drawn as fine streaks coloured by their heading." },
  particleRain: { label: "Particles: Rain", description: "A Particles node as rain: a line emitter at the top (through its Emitter socket), gravity and a little wind, and Thread drawing each drop as a falling streak." },
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
  gridBreathing: { label: "Grid: Breathing", description: "A centred dot in every cell that wobbles and breathes. Animated Cell Center (Grid Size 1) gives each dot's centre in cells, Circle SDF measures it from Grid Pos, Wave Radius ripples the radius out from the middle." },
  gridDensityWave: { label: "Grid: Density Wave" },
  gridLavaLamp: { label: "Lava Lamp", description: "Metaballs from the Field family: two Gaussian Fields (one follows the mouse, one sits off-centre) are summed and Metaball Threshold turns the sum into a blob mask with a soft edge; Mask picks the two colours. Grid Size sets how big a blob is.", play: true },
  gridNeighborDisplaced: { label: "Grid: Attract", description: "Cell Displace pulls each cell's UV toward the mouse (strongly nearby, barely far away); its Attract Amount colours the dots through Palette." },
  echoTrails: { label: "Echo Trails", description: "Echo layers dimmer copies of earlier frames. A circle orbits (Rotate 2D driven by Time), SDF Glow tints it, and Add Color lays the live glow over the echoes." },
  feedbackSmear: { label: "Feedback Smear", description: "The feedback loop: Previous Frame is sampled through a slightly rotated, shrunk UV, then mixed 92/8 with fresh noise colour. Every frame smears the last one inward." },
  beatGrid: { label: "Beat Grid", description: "Grid Layout cuts the screen into cells; BPM Sync pulses every box on the beat and Audio Input (load a track) pushes them further. Cell Filter strokes every other cell; Palette colours by column with its Scale param.", play: true },
  webcamCmyk: { label: "Webcam CMYK", description: "Video Input (choose a file or the camera) sampled through Pixelate, then CMYK Halftone prints it as four rotated dot screens. Swap the halftone for Grid UV → Luma Radius → Dot Mask for a single-ink version." },
  particlesRoundShape: { label: "Particles round a Shape", description: "A Particles node talking to a 2D shader: a Circle SDF wired into Obstacle parts a breeze of particles round it, and an FBM noise wired into Flow swirls them along its contours." },
  particlesIn3dScene: { label: "Particles in a 3D Scene", description: "A Particles node inside a raymarched scene: the March Camera's rays give it the same camera and the March Loop's distance hides the particles behind the sphere." },
  particleSoundField: { label: "Particles: Sound Field", description: "A still field of particles that sound ripples through: rings travel out with the sound and every hit fires a shockwave. Load a song on the Audio Input card; a steady beat stands in until then." },
  particleChladniSand: { label: "Particles: Chladni Sand", description: "Sand on a vibrating square plate: the sound picks the plate's modes and the sand gathers on the still lines between them, morphing from figure to figure. Load a song on the Audio Input card; a stand-in beat steps through figures until then." },
  particleStarOutline: { label: "Particles: Star Outline", description: "A star's SDF turned into a Flow ridge along its outline: particles born everywhere climb to it and run round it as glowing threads." },
  particleFlowIntoShape: { label: "Particles: Currents into a Heart", description: "Flow is an FBM noise plus a slope into a heart's SDF: particles ride the noise's currents in from everywhere and fill the heart." },
  particleCymatics3d: { label: "Particles: Cymatics in 3D", description: "A round singing plate lying flat in 3D: sand on its rings and spokes, seen by a slowly circling camera. The sound picks the modes; a stand-in beat steps through figures until a song plays." },
  particleDustInAir: { label: "Particles: Dust in Air", description: "The Dust in air preset: weightless motes drifting in 3D, lit by one warm light and blurred by a shallow focus, over a dim shaft of light." },
  particleEmbers: { label: "Particles: Embers", description: "The Embers preset on a line at the bottom of the picture: sparks rise, curl and fade from yellow to red, lit by two orbiting lights." },
  particleImageDissolve: { label: "Particles: Image Dissolve", description: "The Image dissolve preset: a photo made of particles that blows away on the wind and forms again, every twelve seconds." },
  inkInWater: { label: "Ink in Water", description: "A Particles node in its Ink look: a million particles curl through 3D currents into dark cores and hair-fine threads on white paper, seen through a drifting camera with a shallow focus." },
  particleGalaxy: { label: "Particle Galaxy", description: "A Particles node: a quarter of a million particles born on a ring, swirled round the centre while it pulls them in, curled by turbulence, coloured by their speed and lit by two orbiting lights, over an FBM nebula." },
  litStillLife: { label: "Lit Still Life", description: "The full 3D lighting stack. A Scene Group holds a capsule, a cone and a ground plane joined by smooth Union; the March Loop Group finds the surface; SDF AO and Soft Shadow read the scene again; Multi Light combines sun, sky and bounce; Tone Map finishes." },
  spaceAtlas: { label: "Space Atlas", description: "A 2D space node reshapes the plane before any pattern sees it. Möbius Transform (pole animated by Time) feeds Truchet tiles; Scanlines finish it. Swap in Polar, Log-Polar or Kaleidoscope to compare the maps — the card preview shows each one as a checkerboard." },
  publishAndKeyframes: { label: "Publish a Node + Keyframes", description: "An iterated group (3 passes: rotate, tile, circle) is a node in waiting — select it and press ✦ Publish as node to make it one, with Iterations as a slider. SDF Glow's Falloff has a keyframe track (see the Keys tab): 6 → 40 over three seconds, looping." },
  volumeGlowDemo: { label: "Volumetric: Volume Glow", description: "The volumetric loop in two nodes: inside the March Loop Group, Scene Distance → Volume Glow accumulates with +=; after it, Glow to Color turns the sum into a tinted, tanh-limited colour. Shell hollows the sphere into a glowing skin." },
  normalColorDemo: { label: "3D: Normal to Color", description: "The March Loop Group's Normal output goes straight into Normal to Color (−1…1 → 0…1), the standard way to check a surface. Swap the mode to Abs to see the axes folded." },
  crtTv: { label: "CRT TV", source: xor("GM Shaders Mini: CRT", "gm-shaders-mini-crt"), description: "CRT Screen bows the tube and snaps the picture to shadow-mask cells; the picture is FBM through a Palette; CRT Mask then lays the staggered RGB grille, pulse and scanlines over it, darkened by the screen's Vignette. After Xor's GM Shaders Mini: CRT." },
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
  comboTurbulenceGlow: { label: "Combo: Turbulence + SDF + Glow", source: xor("Turbulence", "turbulence"), description: "Turbulence (Xor's sine loop) warps the UV before a Circle SDF; SDF Glow in Simple mode with a Palette tint turns the wobbling distance into light. Swap the SDF for FBM or a Grid to see the warp on anything. The same loop in 3D, warping a plane: Web: Atlantic (Turbulence 3D); the glow-to-colour half again: Combo: Chaos Layers + Glow to Color." },
  comboBloomDots: { label: "Combo: Grid + SDF Fill + Bloom", source: xor("GM Shaders Mini: Bloom", "gm-shaders-mini-bloom"), description: "Grid \u2192 Circle SDF on the Cell UV \u2192 SDF Fill draws bright dots coloured by Cell ID; Bloom (Luma select, Layered kernel \u2014 Xor's bloom article) thresholds, blurs and screens the highlights: the whole threshold \u2192 Blur X \u2192 Blur Y \u2192 screen pass chain in one node. Bloom on a full picture: Web: Trippy Noise; the blur half on its own: Combo: Wave Texture + Blur H/V." },
  comboDomeRepeat: { label: "Combo: Dome + Repeat + Height", description: "Spherical in Dome mode bulges the plane like a hemisphere; Infinite Repeat tiles a Box SDF over it; the Height output shades the dome and masks everything outside the unit circle. Dome mode where it came from: Web: Shield; the Repeat + Cell ID half: Combo: Repeat + Cell ID + Hash." },
  comboChaosStars: { label: "Combo: Chaos Layers + Glow to Color", source: xor("Efficient Chaos", "chaos"), description: "Chaos Layers (Xor's Efficient Chaos: five golden-angle rotated, shifted, scaled cell grids with parallax) makes a starfield; Glow to Color tints the summed light and its Layer output colours near stars warmer via a Palette. Another float-glow-to-colour chain: Combo: Turbulence + SDF + Glow." },
  colorStopsCycle: { label: "Color: Stops Palette + Colorize", description: "Stops Palette builds a palette from five colour stops (Loop, Smooth) and cycles it with Time on Angle offset; the angle around the centre (Vec2 \u2192 Angle, Scale 1/2\u03c0) runs the stops once around the ring, and Loop makes the join seamless. A ring's SDF Glow is the field, and Colorize paints it with the palette: Colour \u00d7 Field, the job Scale Color used to do. Change a stop's swatch or the Wrap mode to see the cycle change." },
  midiGlowKeys: { label: "MIDI: Keys to Glow", description: "MIDI Input turns a controller into floats \u2014 or the computer keyboard: turn on the keyboard stand-in on the card and play the A\u2013K row. Velocity sets the circle's Radius (Multiply + Add), Gate brightens the SDF Glow while a key is held (Multiply on the Tinted output), Note picks the Palette colour, and CC 1 (the mod wheel) drives Turbulence strength on the UV. The same shape as the Audio Input examples: an outside signal in, floats out, everything else is ordinary nodes." },
  voxelTerrain: { label: "3D: Voxel Terrain", description: "Voxelize snaps the ray position to a 0.5 grid inside the Scene Group; Box 3D on its Cell Pos is one cube per cell and an Expression Block decides which cells are solid from the Cell ID (a wave plus a hash gives the height), and, for empty cells, steps exactly to where the ray leaves the cell (the camera's Ray Dir is wired into the Scene Group as a port) — a voxel traversal inside an ordinary march. Outside, the March Loop Group's Hit Pos goes through a second Voxelize whose Cell ID drives a Palette, so every cube has its own colour; Mix by Hit keeps the sky plain." },
  comboVoxelSpheres: { label: "Combo: Voxelize + Sphere 3D + Hash", description: "Voxelize \u2192 Sphere 3D on the Cell Pos puts one sphere in every 0.6 cell; an Expression Block hashes the Cell ID into the sphere's Radius so sizes vary per cell (some vanish), and Intersect with a Box 3D on the raw position trims the infinite field to a block. Outside the scene, Hit Pos \u2192 Voxelize \u2192 Cell ID \u2192 Palette colours each sphere \u2014 one Cell Size Constant feeds both Voxelize nodes (the scene's through a group port), so the colour grid always matches the geometry. The 3D twin of Combo: Repeat + Cell ID + Hash; the terrain version is 3D: Voxel Terrain." },
  comboBlurDirectional: { label: "Combo: Wave Texture + Blur H/V", description: "A sharp Wave Texture through Gaussian Blur set to Horizontal only, Kawase quality (the four diagonal taps from Intel's fast-blur article): the separable Blur X pass from the blur articles, on its own a streak. Switch Direction to Vertical or Both on the card to compare. Both passes plus threshold and screen in one node: Combo: Grid + SDF Fill + Bloom." },
  // The Play folder: one numbered example per Play technique (playExampleIndex.ts).
  ...PLAY_EXAMPLE_INDEX,
  // The Learn folder: the Book of Shaders course as graphs (learnExampleIndex.ts).
  ...LEARN_EXAMPLE_INDEX,
  // Earlier Learn lessons the Book doesn't cover, now in Curves & Shapes, Color & Lighting and Grid.
  ...LEARN_MOVED_INDEX,
  // The Learn 3D folder: ray marching one idea at a time (learn3dExampleIndex.ts).
  ...LEARN3D_EXAMPLE_INDEX,
  // The Curved space folder: spherical and hyperbolic views, reverse perspective (curvedSpaceExampleIndex.ts).
  ...CURVED_EXAMPLE_INDEX,
  ...REPEAT_SCENE_EXAMPLE_INDEX,
  // Node Combos built from the definitions (comboExamples.ts): the Grid Pattern → shape → Grid Paint flow, and field sockets.
  ...COMBO_EXAMPLE_INDEX,
  // The Matrices folder (matrixExamples.ts): combining, undoing, lattices, fractals, corner pin, colour.
  ...MATRIX_EXAMPLE_INDEX,
  // The Data folder (dataExamples.ts): graphs that read a bundled dataset through the Data node.
  ...DATA_EXAMPLE_INDEX,
  // The numbered Grid tour (gridExamples.ts): every way to build a grid, and the controls over it.
  ...GRID_EXAMPLE_INDEX,
  // Pass nodes, render to texture (passExamples.ts).
  ...PASS_EXAMPLE_INDEX,
  // The Agents group: slime mold and walkers built from nodes (agentExamples.ts).
  ...AGENT_EXAMPLE_INDEX,
  // Agents with shaders: the Agents group plugged into ordinary nodes and your own shaders (agentShaderExamples.ts).
  ...AGENT_SHADER_EXAMPLE_INDEX,
  // Agents in 3D: Space 3D, the camera, a volume trail, Collide (3D scene) (agentExamples3d.ts).
  ...AGENT_3D_EXAMPLE_INDEX,
  // Simulations: agents: classic agent-based models as custom rules from ordinary nodes (agentExamplesSim.ts).
  ...SIM_AGENT_EXAMPLE_INDEX,
  // The Slime mold rule as a Script layer, with a Play setup (agentSketchExamples.ts).
  ...Object.fromEntries(Object.entries(AGENT_RULE_INDEX).map(([k, v]) => [k, { ...v, play: true }])),
  // The Convert folder (convertExampleIndex.ts, graphs in convertExamples.ts): what the Convert page makes of its Soft circle, as written and optimised.
  ...CONVERT_EXAMPLE_INDEX,
  // Bake (bakeExamples.ts, docs/bake.md): a heavy scene to freeze into a video, live effects on top.
  ...BAKE_EXAMPLE_INDEX,
  // Time cube (timeCubeExamples.ts, docs/time-cube.md): a video as a box of time, a colour key, slit-scan.
  ...TIME_CUBE_EXAMPLE_INDEX,
  // Frame stack (frameStackExamples.ts, docs/frame-stack.md): a video's frames as cards to arrange.
  ...FRAME_STACK_EXAMPLE_INDEX,
  // 4D (fourDExamples.ts, docs/4d.md): a tesseract and a hypersphere, seen as 3D slices.
  ...FOURD_EXAMPLE_INDEX,
  // Texture tools (textureToolExamples.ts, docs/texture-tools.md): Mask, Levels, Flow, Neighbours, Change, Outline, Fade, Read.
  ...TEXTURE_TOOL_EXAMPLE_INDEX,
  // The 3D: Scene Builder folder (sceneBuilderExamples.ts): graphs the 3D Scene Builder made from its templates.
  ...SCENE_BUILDER_EXAMPLE_INDEX,
  ...SCENE_BUILDER_2D_EXAMPLE_INDEX,
  // Simulations: grids (simGridExamples.ts, docs/simulations-grids.md): cellular automata from a Pass and its Previous.
  ...SIM_GRID_EXAMPLE_INDEX,
  // Grid Rules (gridRulesExamples.ts, docs/grid-rules.md): the same simulations as one node each.
  ...GRID_RULES_EXAMPLE_INDEX,
  // Agents: rules (agentRuleExamples.ts, docs/agent-rules.md): the Agent Rules templates, behaviour as When … Do … lines.
  ...AGENT_RULE_EXAMPLE_INDEX,
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
  { label: "Learn 3D",          color: ctp.lavender, keys: LEARN3D_EXAMPLE_KEYS },
  { label: "Curved space",      color: ctp.lavender, keys: CURVED_EXAMPLE_KEYS },
  { label: "Curves & Shapes",   color: ctp.lavender, keys: LEARN_CURVES_KEYS },
  { label: "Color & Lighting",  color: ctp.peach, keys: [...LEARN_COLOR_KEYS, 'neonGlow','colorStopsCycle'] },
  { label: "Passes",            color: ctp.maroon, keys: PASS_EXAMPLE_KEYS },
  { label: "Texture tools",     color: ctp.flamingo, keys: TEXTURE_TOOL_EXAMPLE_KEYS },
  { label: "Simulation",        color: ctp.green, keys: AGENT_EXAMPLE_KEYS },
  { label: "Simulations: grids", color: ctp.green, keys: simGridsFolderKeys() },
  { label: "Agents: rules",     color: ctp.green, keys: AGENT_RULE_EXAMPLE_KEYS },
  { label: "Agents with shaders", color: ctp.green, keys: AGENT_SHADER_EXAMPLE_KEYS },
  { label: "Agents in 3D",      color: ctp.green, keys: AGENT_3D_EXAMPLE_KEYS },
  { label: "Simulations: agents", color: ctp.green, keys: SIM_AGENT_EXAMPLE_KEYS },
  { label: "Effects & Lens",    color: ctp.mauve, keys: ['echoTrails','feedbackSmear','crtTv','lensBarrel'] },
  { label: "Space & Texture",   color: ctp.flamingo, keys: ['waveTextureDemo','waveInterference','magicTextureDemo','neonFloorGrid','spaceAtlas'] },
  { label: "Grid",              color: ctp.sky, keys: [...GRID_EXAMPLE_KEYS, ...LEARN_GRID_KEYS, 'gridNeighborDisplaced','gridMetaballs','gridBreathing','gridDensityWave','gridLavaLamp','beatGrid'] },
  { label: "Matrices",          color: ctp.peach, keys: MATRIX_EXAMPLE_KEYS },
  { label: "Data",              color: ctp.teal, keys: DATA_EXAMPLE_KEYS },
  { label: "Halftone",          color: '#a6e3d5', keys: ['cmykNoise','webcamCmyk'] },
  { label: "Rings",             color: ctp.red, keys: ['fractalRings'] },
  { label: "Iterated Groups",   color: ctp.green, keys: ['groupCarryRings','groupCarryFBM','groupCarryDomainWarp','publishAndKeyframes'] },
  { label: "Fractals",          color: ctp.mauve, keys: ['newtonFractalZ5','gravitationalLens'] },
  { label: "Physics",           color: ctp.teal, keys: ['chladniFieldQuickDemo','chladniModeFreqDemo'] },
  { label: "Particles",         color: ctp.pink, keys: ['particlesRoundShape','particlesIn3dScene','particleSoundField','particleChladniSand','particleCymatics3d','particleStarOutline','particleFlowIntoShape','inkInWater','particleImageDissolve','particleDustInAir','particleEmbers','particleFlowDrift','particleRain','particleGalaxy'] },
  { label: "Inputs",            color: ctp.teal, keys: ['midiGlowKeys'] },
  { label: "Blur & Lens",       color: ctp.blue, keys: ['motionBlurTrails','tiltShiftScene','dofOrbitOrbs','dofDepthBlur','comboBlurDirectional'] },
  { label: "Functions",         color: ctp.sapphire, keys: ['ringGlow'] },
  { label: "3D Basics",         color: ctp.sky, keys: ['raymarchSpheres','rayMarchOutputs3D','shapesAndGround3D','softMetaballs3D','normalColorDemo'] },
  { label: "3D SDF",            color: ctp.sky, keys: [...REPEAT_SCENE_EXAMPLE_KEYS, 'sdfPolarRepeat','sdfBend3D','sdCrossScene3D','infinitePillars3D','spiralWorld3D','gyroidWarped','bakeHeavyScene','mlgWiggleTunnel','voxelTerrain'] },
  { label: "3D Lighting",       color: '#f9c468', keys: ['fresnelSchlickRim','refractDirFakeGlass','glassPhysical','glassMetaballs','litStillLife'] },
  { label: "GI Lighting",       color: ctp.green, keys: ['giSphereGround','giBoxFrame'] },
  { label: "3D: Scene Builder", color: ctp.sky, keys: SCENE_BUILDER_EXAMPLE_KEYS },
  { label: "2D: Scene Builder", color: ctp.pink, keys: SCENE_BUILDER_2D_EXAMPLE_KEYS },
  { label: "Volumetric",        color: '#f5a97f', keys: ['glowMarcher','volAnimatedRepeat','volumeGlowDemo'] },
  { label: "Time Cube",         color: '#f5a97f', keys: TIME_CUBE_EXAMPLE_KEYS },
  { label: "4D",                color: '#b4a0ff', keys: FOURD_EXAMPLE_KEYS },
  { label: "Frame Stack",       color: '#f5a97f', keys: FRAME_STACK_EXAMPLE_KEYS },
  { label: "From the Internet",    color: ctp.yellow, keys: ['fcTrippyNoise','fcSolar','fcPillars','fcGradient4','fcGrainGradient','fcTiling','fcTheScreen','fcShield','fcMainFrame','fcAtlantic','fcOrb','fcBitshift'] },
  { label: "Convert",            color: ctp.yellow, keys: CONVERT_EXAMPLE_KEYS },
  { label: "Node Combos",        color: ctp.flamingo, keys: ['comboChaosStars','comboRepeatCellHash','comboTurbulenceGlow','comboBloomDots','comboDomeRepeat','comboVoxelSpheres','comboGridPaintShapes','comboGridPaintPictures','comboGridPaintGlow','comboGridShapeByWire','comboArrayStars','comboGridGroupFlower','comboArrayGroupMoons'] },
];
