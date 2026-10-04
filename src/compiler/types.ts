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
  /** diffuse, halfLife. */
  params: Record<string, AgentParam>;
  live: boolean;
}

/** A Draw agents node: its group's walkers drawn into a texture each frame. */
export interface AgentDrawProgram {
  nodeId: string;
  slug: string;
  group: string;
  style: 'points' | 'glow' | 'streaks' | 'ink';
  colorBy: 'single' | 'species' | 'speed' | 'heading' | 'age' | 'agent' | 'speedFast' | 'headingRound';
  /** 'ab' (Colour A → B) or a Particles palette's name. */
  palette: string;
  /** Point lights (0–4), how they move, fade with age, brightness per walker or for the crowd. */
  lights: number;
  lightMotion: 'orbit' | 'still';
  fade: boolean;
  scaleBy: 'walker' | 'crowd';
  /** size, brightness, glow, streak, speedRef, colorA, colorB, light settings. */
  params: Record<string, AgentParam | number[]>;
  live: boolean;
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
}

export const VERTEX_SHADER = `varying vec2 vUv;

void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
}`.trim();

/** Opaque graph passed into the compiler. Same shape as NodeGraph. */
export type { NodeGraph };
