import type { NodeGraph } from '../types/nodeGraph';

/**
 * One Pass node's program (compiler/passGraph.ts): drawn into the Pass's own
 * texture before the final picture. Only graphs with a Pass node have these.
 */
export interface PassProgram {
  /** The Pass node's id. */
  nodeId: string;
  /** Its slug: its samplers are u_pass_<slug> and u_passprev_<slug>. */
  slug: string;
  /** Shown in timers and the card: the node's label or "Pass". */
  label: string;
  fragmentShader: string;
  /** Slugs of the passes this program samples this frame (drawn before it). */
  reads: string[];
  /** Slugs of the passes whose previous frame this program samples. */
  readsPrevious: string[];
  /** Size relative to the picture: 1, 0.5, 0.25 or 0.125. */
  scale: number;
  format: 'half' | 'byte';
  filter: 'linear' | 'nearest';
  wrap: 'clamp' | 'repeat' | 'mirror';
  /** Something samples this Pass's Previous output: it keeps a second (ping-pong) texture. */
  previous: boolean;
  /** The final picture needs it, directly or through other passes; a pass nothing reads isn't drawn. */
  live: boolean;
  /** The graph nodes compiled into this program (not counting upstream Pass nodes it samples). */
  nodeIds: string[];
  /**
   * Only in a graph with agents: it samples a Trail or Draw agents (directly or
   * through other passes), so it draws after the agents step; otherwise before.
   */
  afterAgents?: boolean;
  /**
   * A Particles node reads it (its Emit from, or a Flow / Obstacle through it), directly or through
   * other passes: it draws before the particles step, the rest after. Only present when true.
   */
  beforeParticles?: boolean;
  /**
   * Repeat (phase 7): drawn this many times each frame, each draw reading the one before through
   * its Previous (the first, the frame before's last). Only present when above 1.
   */
  repeat?: number;
  /**
   * A Shader Texture (docs/texture-builder.md): a fixed square size in pixels instead of `scale`
   * × the picture. Only present when set.
   */
  size?: number;
  /**
   * A Shader Texture's Update: 'change' draws again only when a uniform its program reads changes
   * (or the program, or its target); 'once' only when the program or its target is new. Absent:
   * every frame, as every other pass.
   */
  update?: 'change' | 'once';
  /** With update 'change': no Time node inside, so the clock alone never draws it again. Only present when true. */
  stillTime?: boolean;
  /**
   * A hidden pass of a Blur or Glow (texture) node (compiler/hiddenBlurs.ts): `nodeId` is that
   * node. Not a Pass node: it doesn't count towards MAX_PASSES and has no card. Only present when true.
   */
  hidden?: boolean;
}

/**
 * A node's settings as the agents engine reads them: a number, or the name of
 * the uniform a slider (Play control, mapping) writes. Read through the shared
 * uniform table each frame, so moving a slider never recompiles.
 */
export type AgentParam = number | string;

/** One Agents group's update shader (compiler/agentGraph.ts, docs/agents-plan.md). */
export interface AgentGroupProgram {
  nodeId: string;
  /** Its slug: state samplers u_agA_<slug> / u_agB_<slug>, u_agStep_<slug>, u_agWin_<slug>. */
  slug: string;
  label: string;
  /** GLSL 3, two outputs (state A and B); runs over the state texture, one fragment per agent. */
  fragmentShader: string;
  /** Side of the state texture: count = side². */
  side: number;
  species: number;
  /** Per-walker state (state C and D: species, memory, colour, its own deposit): four state textures, not two. */
  stateC?: boolean;
  /** More memory (with stateC): a fifth state texture, E = four more numbers a walker keeps (the builder's named memories). */
  stateE?: boolean;
  /** Space 3D: A = (pos.xyz, age), B = (vel.xyz, life); its Deposits fill volumes, its Draws use a camera. */
  space3d?: boolean;
  /**
   * Collide (3D scene) nodes: each one's Scene on the Particles node's 48³ grid, filled every step (before the rule, at the
   * step's clock) by `shader` (a program of the picture's kind) into the sampler sceneGridUniforms(slug).grid; `at` is
   * its centre and reach (x, y, z, Scene size: numbers or the uniforms their sliders write), set in .at.
   */
  grids?: Array<{ nodeId: string; slug: string; shader: string; at: AgentParam[] }>;
  /**
   * Neighbours nodes inside (docs/agents-group.md "Neighbours"): the group builds its grid every step,
   * before the rule, into agentNbUniforms(slug); cells at least the largest `radius` across, as many
   * slots as the largest `max` reads (numbers or the uniforms their sliders write).
   */
  neighbours?: { radius: AgentParam[]; max: AgentParam[] };
  /** stepsPerFrame, seed, preroll. */
  params: Record<string, AgentParam>;
  /**
   * How the birth windows go: everyone at step 0 (fill), `rate` a second, or everyone at step 0 and
   * each again as it dies (respawn: Keep full). `burst` is the head Emit's Burst trigger (0 if none).
   */
  emit: { mode: 'fill' | 'rate' | 'respawn'; rate: AgentParam; burst: AgentParam };
  /** Nodes inside that listen (Sound kick, Chladni): the engine fills their uniforms every step. */
  listeners: AgentListener[];
  /** Slugs of the Trails and Passes its update shader samples. */
  readsTrails: string[];
  readsPasses: string[];
  /** The picture needs it (directly or through a trail, drawing or pass). */
  live: boolean;
  /** Graph nodes compiled into it (inside and outside the group). */
  nodeIds: string[];
  /**
   * Emits giving birth from a splat scan (Shape: Splat scan, docs/splat-scene.md "Agents as splats"): the engine reads
   * each scan (lib/agentScans.ts), thinned to the group's count, into agentScanUniforms(slug) and starts the group over
   * when it arrives. `source` is a library id or a generated scan (`demo:<kind>:<count>`); `flip` turns it over (Up is −Y).
   */
  scans?: Array<{ nodeId: string; slug: string; source: string; flip: boolean }>;
}

/**
 * A Sound kick or Chladni node inside a group (nodes/definitions/agentForces.ts): what it hears
 * (Sound from, Level, Beat) and, for a plate, how its modes are picked. Its uniforms are named by
 * `slug` (listenUniforms).
 */
export interface AgentListener {
  nodeId: string;
  slug: string;
  kind: 'kick' | 'plate';
  soundFrom: string;
  /** A plate: square or round, its modes from N and M or the sound, minus or plus. */
  shape?: 'square' | 'circle';
  modeFrom?: 'manual' | 'sound';
  symmetry?: 'minus' | 'plus';
  /** level, beat, x, y (kick); modeN, modeM, modes, plateFreq, plateWeights, shake (plate). */
  params: Record<string, AgentParam>;
}

/** A Deposit: one group's walkers drawn as points into one Trail, every step. */
export interface AgentDepositProgram {
  nodeId: string;
  slug: string;
  /** Slugs of its group and its Trail. */
  group: string;
  trail: string;
  /** Trail: its species' channel (or its own Deposit with state C). Velocity: (vel × amount, amount, 0). */
  what?: 'trail' | 'velocity';
  params: Record<string, AgentParam>;
}

/** A Trail field: a ping-pong texture that spreads and fades every step. */
export interface AgentTrailProgram {
  nodeId: string;
  slug: string;
  label: string;
  /** A share of the picture, or a fixed number of rows (the aspect follows the picture). */
  scale: number | null;
  rows: number | null;
  edges: 'wrap' | 'clamp';
  /** Its spread: the 3×3 mean or the 5×5 blur. */
  kernel?: 3 | 5;
  /** Velocity deposits go in: negative values are kept. */
  signed?: boolean;
  /**
   * Add / Block wired: the step as a program of its own (GLSL for a ShaderMaterial over the trail's
   * texture; it samples trailStepUniforms(slug).src and reads .step), else the fixed step.
   */
  stepShader?: string;
  /** Slugs of the Passes its step program samples (they draw before the agents). */
  readsPasses?: string[];
  /** Graph nodes compiled into its step program (Show passes). */
  stepNodeIds?: string[];
  /**
   * Filled by a 3D group: a volume of `volume` rows and slices (columns follow the picture), its
   * slices side by side in one texture (kit/agentPlan.js agVolLayout). The picture reads it seen
   * from the front, summed through its depth; Sense inside a 3D group reads it in 3D.
   */
  volume?: number;
  /** diffuse, halfLife. */
  params: Record<string, AgentParam>;
  live: boolean;
}

/** A Draw agents node: its group's walkers drawn into a texture each frame. */
export interface AgentDrawProgram {
  nodeId: string;
  slug: string;
  group: string;
  style: 'points' | 'glow' | 'streaks' | 'ink' | 'splats';
  colorBy: 'single' | 'species' | 'speed' | 'heading' | 'age' | 'agent' | 'speedFast' | 'headingRound';
  /** 'ab' (Colour A → B) or a Particles palette's name. */
  palette: string;
  /** Point lights (0–4), how they move, fade with age, brightness per walker or for the crowd. */
  lights: number;
  lightMotion: 'orbit' | 'still';
  fade: boolean;
  scaleBy: 'walker' | 'crowd';
  /** size, brightness, glow, streak, speedRef, colorA, colorB, light settings (and in 3D the camera). */
  params: Record<string, AgentParam | number[]>;
  live: boolean;
  /** Its group is 3D: drawn through a camera (the built-in orbit, or a scene's: `probe`), with depth of field. */
  space3d?: boolean;
  /** The camera's right is the Particles node's way round (Open as nodes), not the March Camera's. */
  mirror?: boolean;
  /**
   * A ray-marched scene's camera (Camera from and Camera ray wired) and its Depth: small programs of
   * the picture's kind. `camera` is evaluated at g_uv = probe.uniform.xy (it writes Camera from when
   * .z is 0, else Camera ray) into 4 × 1 texels: the origin, then the rays at (0, 0), (0.5, 0) and
   * (0, 0.5); `depth` (Depth wired) writes the scene's distance into .b over the picture at half size.
   */
  probe?: { uniform: string; camera: string; depth?: string };
}

/**
 * A Splat Scene node's probe (compiler/splatGraph.ts): a program of the picture's kind drawn over 8 × 1 texels: the
 * camera's eye and three rays, and the scan's placement, read by its raster pass (lib/splats/engine.ts).
 */
export interface SplatProbeProgram {
  nodeId: string;
  fragmentShader: string;
  paramUniforms: Record<string, number | number[]>;
  textureUniforms: Record<string, string>;
  videoUniforms: Record<string, string>;
  /** The chain wired into its Modifier, as a program over one texel per splat (compiler/splatGraph.ts). */
  modifier?: SplatModifierProgram;
}

/**
 * A Splat Scene's modifier program (docs/splat-scene.md "Per-splat modifiers"): the chain wired into its Modifier, of
 * the picture's kind, drawn over one texel per splat into two targets (centre and size; colour and opacity) that the
 * splat shader reads. Its own uniforms (`uniforms`) are the engine's; the rest are merged into the picture's table.
 */
export interface SplatModifierProgram {
  nodeId: string;
  fragmentShader: string;
  uniforms: { data: string; probe: string; count: string; box?: string };
  paramUniforms: Record<string, number | number[]>;
  paramBindings: Record<string, string>;
  textureUniforms: Record<string, string>;
  videoUniforms: Record<string, string>;
  audioUniforms: Record<string, string>;
  liveUniforms: Record<string, string>;
  /**
   * Does it move splats? Always, or while any of these uniforms is non-zero (Explode's Amount, Wave's Amplitude…).
   * While it does, the engine sorts by the moved positions, read back from the GPU.
   */
  moves: { always: boolean; gates: string[] };
}

/** Everything the agents engine runs for a graph (present only when it has an Agents-family node). */
export interface AgentsSpec {
  groups: AgentGroupProgram[];
  deposits: AgentDepositProgram[];
  trails: AgentTrailProgram[];
  draws: AgentDrawProgram[];
}

export interface CompilationResult {
  vertexShader: string;
  fragmentShader: string;
  success: boolean;
  errors?: string[];
  /** The graph has a loop (compiler/graphLoops.ts): its nodes and the wire that closes it, for the error's fix buttons. */
  loop?: import('./graphLoops').GraphLoop;
  /** Maps nodeId → { outputKey → glslVarName } — used by ShaderCanvas node-probe. */
  nodeOutputVars: Map<string, Record<string, string>>;
  /**
   * Maps uniform name (e.g. "u_p_nodeId_scale") → current value: a number for a
   * float slider, a [r, g, b] array for a vec3 / colour param. Slider and
   * colour-picker changes push new values here instead of triggering a recompile.
   */
  paramUniforms: Record<string, number | number[]>;
  /**
   * Maps `${nodeId}::${paramKey}` (the node's ORIGINAL id, the one the store
   * edits — not its slug) → the uniform name in `paramUniforms`. Absent from
   * this map means the param is baked into the GLSL and changing it needs a
   * recompile. This is the only place uniform names should be looked up from;
   * never rebuild them from the id.
   */
  paramBindings: Record<string, string>;
  /**
   * Maps sampler2D uniform name (e.g. "u_tex_nodeId") → nodeId.
   * ShaderCanvas uses this to bind THREE.Texture objects for TextureInput nodes.
   */
  textureUniforms: Record<string, string>;
  /**
   * Maps float uniform name (e.g. "u_audio_audio_5_0": `u_audio_<slug>_<band>`,
   * see audioUniformNames.ts) → nodeId. ShaderCanvas hands this to the audio
   * engine, which pushes one amplitude per band into these names each frame.
   */
  audioUniforms: Record<string, string>;
  /**
   * Maps float uniform name (e.g. "u_midi_<slug>_note") → `${nodeId}::${channel}`.
   * The input bus (lib/inputBus.ts) writes these every frame from JS-side
   * sources (MIDI now; audio, mouse, keyboard mappings later).
   */
  liveUniforms: Record<string, string>;
  /**
   * Maps sampler2D uniform name (e.g. "u_vid_nodeId") → nodeId.
   * ShaderCanvas uses this to bind THREE.VideoTexture objects for VideoInput nodes.
   */
  videoUniforms: Record<string, string>;
  /**
   * True when any PrevFrame node exists in the graph — ShaderCanvas enables
   * ping-pong render targets when this is set.
   */
  isStateful: boolean;
  /**
   * Echo nodes: how many snapshot frames the preview must keep (`copies`) and
   * how many frames apart they are captured (`delay`). Null when none.
   */
  echo?: { copies: number; delay: number } | null;
  /**
   * Maps nodeId → short GLSL slug (e.g. "node_49" → "cos_49").
   * Used by CodePanel to highlight the lines belonging to a selected node.
   * Absent on validation-failure results.
   */
  nodeSlugMap?: Map<string, string>;
  /** Maps marchLoopGroup nodeId → dynamic acc* output sockets added at compile time.
   *  Store uses this to patch node.outputs so sockets appear on the card. */
  mlgDynamicOutputs?: Map<string, Record<string, { type: string; label: string }>>;
  /**
   * Pass nodes' programs, in drawing order (compiler/passGraph.ts). Present
   * only when the graph has a Pass node; `fragmentShader` is then the final
   * picture's program, which samples them.
   */
  passes?: PassProgram[];
  /** With Pass or Agents programs: the graph nodes compiled into the final picture (Show passes). */
  finalNodeIds?: string[];
  /**
   * The Agents family's programs (compiler/agentGraph.ts). Present only when
   * the graph has an Agents-family node; `fragmentShader` is then the final
   * picture's program, which samples the trails and drawings.
   */
  agents?: AgentsSpec;
  /** Splat Scene nodes' probe programs (compiler/splatGraph.ts). Present only when the graph has one. */
  splats?: SplatProbeProgram[];
}

export const VERTEX_SHADER = `varying vec2 vUv;

void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
}`.trim();

/** Opaque graph passed into the compiler. Same shape as NodeGraph. */
export type { NodeGraph };
