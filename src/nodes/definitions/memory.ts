/**
 * Memory nodes (docs/memory-nodes.md): numbers that remember last frame, TouchDesigner's Lag, Spring, Trigger
 * (ADSR), Timer, Count, Hold and Speed CHOPs. Lag, Spring, Envelope, Timer, Counter, Sample & Hold and Speed.
 *
 * A shader forgets everything between frames, so each keeps its state in the GPU: compiler/memoryExpand.ts opens
 * every top-level memory node into one shared Pass (`__memory`, one full-float texel per node, `__size` square),
 * whose program (the Memory pack) works out each node's next state (a vec4) from last frame's and its inputs, and
 * a Memory read in the node's place reads its texel back. Time steps by `u_frameDt` (0 while paused).
 *
 * Inputs are read once a frame at the picture's centre: wire single values (an LFO, audio, MIDI, Mouse, a Blob
 * Track's Count), not per-pixel pictures. Settings are compile-time (a change recompiles); wire a value into an
 * input to drive it live. Inside a group the nodes don't remember (they pass their input through).
 */
import type { NodeDefinition } from '../../types/nodeGraph';
import { FRAME_DT_UNIFORM } from './textureTools';

export type MemoryKind = 'lag' | 'spring' | 'envelope' | 'timer' | 'counter' | 'sampleHold' | 'speed';
export const MEMORY_KINDS: readonly MemoryKind[] = ['lag', 'spring', 'envelope', 'timer', 'counter', 'sampleHold', 'speed'];
export const MEMORY_PACK_TYPE = 'memoryPack';
export const MEMORY_READ_TYPE = 'memoryRead';
export const MEMORY_CATEGORY = 'Animation';

export const isMemoryType = (type: string): type is MemoryKind => (MEMORY_KINDS as readonly string[]).includes(type);

type P = Record<string, unknown>;
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
/** A GLSL float literal. */
const g = (v: unknown, d: number) => { const n = num(v, d); return Number.isInteger(n) ? `${n}.0` : String(n); };

interface InputSpec { label: string; hint: string; fallback: string }
interface OutputSpec { label: string; hint: string; /** From the state `s` (vec4). */ read: (P: P) => string; /** Without memory (inside a group). */ plain: (I: Record<string, string>) => string }
interface KindSpec {
  label: string;
  aliases: string[];
  description: string;
  inputs: Record<string, InputSpec>;
  outputs: Record<string, OutputSpec>;
  defaultParams: P;
  paramDefs: NonNullable<NodeDefinition['paramDefs']>;
  /** First frame: `s` from the inputs. */
  init: (P: P, I: Record<string, string>) => string;
  /** One frame: `s` (last frame's state) to this frame's, by `dt` seconds. `wired` says which inputs have wires. */
  step: (P: P, I: Record<string, string>, wired: Set<string>) => string;
}

const secs = (label: string, hint: string, max = 10): NonNullable<NodeDefinition['paramDefs']>[string] =>
  ({ label, type: 'float', min: 0, max, step: 0.01, compileTime: true, hint });

export const MEMORY_SPECS: Record<MemoryKind, KindSpec> = {
  lag: {
    label: 'Lag',
    aliases: ['Lag CHOP', 'Smooth', 'Slew', 'Ease to', 'Damp', 'Low-pass value'],
    description: 'Follows its input slowly: jumps become glides. Rise and Fall set how many seconds it takes to get most of the way, separately up and down (fast attack, slow release for audio).',
    inputs: { input: { label: 'Input', hint: 'The value to follow (one number: an LFO, audio, MIDI, Mouse, a count).', fallback: '0.0' } },
    outputs: {
      value: { label: 'Value', hint: 'The smoothed value.', read: () => 's.x', plain: I => I.input },
      velocity: { label: 'Velocity', hint: 'How fast it is moving (per second).', read: () => 's.y', plain: () => '0.0' },
    },
    defaultParams: { rise: 0.3, fall: 0.3 },
    paramDefs: {
      rise: secs('Rise', 'Seconds to rise most of the way (63%) towards a higher input. 0 jumps.'),
      fall: secs('Fall', 'Seconds to fall most of the way towards a lower input. 0 jumps.'),
    },
    init: (_P, I) => `s = vec4(${I.input}, 0.0, 0.0, 1.0);`,
    step: (P, I) => `float x = ${I.input}; float tau = x > s.x ? ${g(P.rise, 0.3)} : ${g(P.fall, 0.3)};
float y = tau <= 0.0 ? x : mix(x, s.x, exp(-dt / tau));
s.y = dt > 0.0 ? (y - s.x) / dt : s.y; s.x = y;`,
  },
  spring: {
    label: 'Spring',
    aliases: ['Spring CHOP', 'Bounce', 'Wobble', 'Overshoot', 'Elastic follow'],
    description: 'Follows its input like a weight on a spring: it overshoots and wobbles into place. Frequency is how fast it swings, Damping how quickly the wobble dies (1 settles with no overshoot).',
    inputs: { input: { label: 'Target', hint: 'Where the spring pulls to (one number).', fallback: '0.0' } },
    outputs: {
      value: { label: 'Value', hint: 'The spring\'s position.', read: () => 's.x', plain: I => I.input },
      velocity: { label: 'Velocity', hint: 'How fast it is moving (per second).', read: () => 's.y', plain: () => '0.0' },
    },
    defaultParams: { frequency: 2, damping: 0.25 },
    paramDefs: {
      frequency: { label: 'Frequency', type: 'float', min: 0.05, max: 20, step: 0.01, compileTime: true, hint: 'Swings a second.' },
      damping: { label: 'Damping', type: 'float', min: 0, max: 2, step: 0.01, compileTime: true, hint: '0 wobbles for ever, 1 settles without overshooting, above 1 creeps.' },
    },
    init: (_P, I) => `s = vec4(${I.input}, 0.0, 0.0, 1.0);`,
    // Eight small steps a frame keep a stiff spring steady at any frame rate.
    step: (P, I) => `float x = ${I.input}; float w = 6.28318 * ${g(P.frequency, 2)}; float h = dt / 8.0;
for (int k = 0; k < 8; k++) { float a = w * w * (x - s.x) - 2.0 * ${g(P.damping, 0.25)} * w * s.y; s.y += a * h; s.x += s.y * h; }`,
  },
  envelope: {
    label: 'Envelope (ADSR)',
    aliases: ['Trigger CHOP', 'ADSR', 'Attack decay sustain release', 'Envelope follower', 'Gate'],
    description: 'Shapes a gate into a rise and fall: Attack up to 1, Decay down to Sustain while the gate is held, Release to 0 when it lets go. Trigger mode needs only a tap: Attack then Decay to 0. Wire a MIDI note, a mouse button, a Compare, a kick.',
    inputs: { gate: { label: 'Gate', hint: 'On while above 0.5 (a key held, a button down, a beat).', fallback: '0.0' } },
    outputs: {
      value: { label: 'Value', hint: 'The envelope, 0–1.', read: () => 's.x', plain: I => `step(0.5, ${I.gate})` },
      active: { label: 'Active', hint: '1 while it is anything but resting at 0.', read: () => 'step(0.5, s.y)', plain: I => `step(0.5, ${I.gate})` },
    },
    defaultParams: { mode: 'gate', attack: 0.05, decay: 0.2, sustain: 0.6, release: 0.6 },
    paramDefs: {
      mode: { label: 'Mode', type: 'select', hint: 'Gate: holds at Sustain while the gate is on. Trigger: each rising edge plays Attack and Decay to 0, however short the tap.', options: [
        { value: 'gate', label: 'Gate (ADSR)' }, { value: 'trigger', label: 'Trigger (AD)' },
      ] },
      attack: secs('Attack', 'Seconds from 0 to 1.', 5),
      decay: secs('Decay', 'Seconds from 1 down to Sustain (to 0 in Trigger).', 5),
      sustain: { label: 'Sustain', type: 'float', min: 0, max: 1, step: 0.01, compileTime: true, showWhen: { param: 'mode', value: 'gate' }, hint: 'The level held while the gate stays on.' },
      release: { ...secs('Release', 'Seconds from where it is to 0 after the gate lets go.', 10), showWhen: { param: 'mode', value: 'gate' } },
    },
    init: () => 's = vec4(0.0, 0.0, 0.0, 1.0);',
    // s.x level, s.y stage (0 rest, 1 attack, 2 decay / sustain, 3 release), s.z last gate.
    step: (P, I) => {
      const trig = P.mode === 'trigger';
      return `float gt = step(0.5, ${I.gate});
if (gt > 0.5 && s.z < 0.5) s.y = 1.0;
${trig ? '' : 'if (gt < 0.5 && (abs(s.y - 1.0) < 0.5 || abs(s.y - 2.0) < 0.5)) s.y = 3.0;\n'}if (abs(s.y - 1.0) < 0.5) { s.x += dt / max(${g(P.attack, 0.05)}, 1e-4); if (s.x >= 1.0) { s.x = 1.0; s.y = 2.0; } }
else if (abs(s.y - 2.0) < 0.5) { float lv = ${trig ? '0.0' : g(P.sustain, 0.6)}; s.x = max(lv, s.x - dt * (1.0 - lv) / max(${g(P.decay, 0.2)}, 1e-4));${trig ? ' if (s.x <= 0.0) s.y = 0.0;' : ''} }
else if (abs(s.y - 3.0) < 0.5) { s.x = max(0.0, s.x - dt / max(${g(P.release, 0.6)}, 1e-4)); if (s.x <= 0.0) s.y = 0.0; }
s.z = gt;`;
    },
  },
  timer: {
    label: 'Timer',
    aliases: ['Timer CHOP', 'Stopwatch', 'Countdown', 'Elapsed time', 'Cue'],
    description: 'Counts seconds while Run is on (always, unwired), from 0 to Length: Fraction goes 0 → 1 and Done turns on at the end; Loop starts it over. Reset (a tap) goes back to 0.',
    inputs: {
      run: { label: 'Run', hint: 'Counts while above 0.5. Unwired: always.', fallback: '1.0' },
      reset: { label: 'Reset', hint: 'Back to 0 on a rising edge (above 0.5).', fallback: '0.0' },
    },
    outputs: {
      seconds: { label: 'Seconds', hint: 'Seconds counted (round each loop).', read: () => 's.x', plain: () => 'u_time' },
      fraction: { label: 'Fraction', hint: 'Seconds ÷ Length, 0–1.', read: P => `clamp(s.x / ${g(P.length, 4)}, 0.0, 1.0)`, plain: () => '0.0' },
      done: { label: 'Done', hint: '1 once Length is reached (without Loop).', read: P => (P.loop === false ? `step(${g(P.length, 4)}, s.x)` : '0.0'), plain: () => '0.0' },
    },
    defaultParams: { length: 4, loop: true },
    paramDefs: {
      length: { label: 'Length', type: 'float', min: 0.05, max: 600, step: 0.05, compileTime: true, hint: 'Seconds from start to end.' },
      loop: { label: 'Loop', type: 'bool', hint: 'Start over at the end (otherwise it stops there and Done turns on).' },
    },
    init: () => 's = vec4(0.0, 0.0, 0.0, 1.0);',
    step: (P, I) => `if (${I.reset} > 0.5 && s.y < 0.5) s.x = 0.0;
if (${I.run} > 0.5) s.x += dt;
${P.loop === false ? `s.x = min(s.x, ${g(P.length, 4)});` : `if (s.x >= ${g(P.length, 4)}) s.x = mod(s.x, ${g(P.length, 4)});`}
s.y = step(0.5, ${I.reset});`,
  },
  counter: {
    label: 'Counter',
    aliases: ['Count CHOP', 'Count', 'Tally', 'Step counter', 'Beat counter'],
    description: 'Adds Step each time Trigger goes above 0.5: count beats, clicks, blobs appearing. Between Min and Max it wraps round or stops; Reset goes back to Min.',
    inputs: {
      trigger: { label: 'Trigger', hint: 'Counts on each rising edge (above 0.5).', fallback: '0.0' },
      reset: { label: 'Reset', hint: 'Back to Min on a rising edge.', fallback: '0.0' },
    },
    outputs: {
      count: { label: 'Count', hint: 'The count.', read: () => 's.x', plain: () => '0.0' },
      fraction: { label: 'Fraction', hint: '(Count − Min) ÷ (Max − Min), 0–1.', read: P => `clamp((s.x - ${g(P.min, 0)}) / max(${g(P.max, 10)} - ${g(P.min, 0)}, 1e-4), 0.0, 1.0)`, plain: () => '0.0' },
    },
    defaultParams: { stepBy: 1, min: 0, max: 10, limit: 'wrap' },
    paramDefs: {
      stepBy: { label: 'Step', type: 'float', min: -10, max: 10, step: 0.01, compileTime: true, hint: 'Added on each trigger (negative counts down).' },
      min: { label: 'Min', type: 'float', min: -1000, max: 1000, step: 1, compileTime: true, hint: 'Where it starts, and where Reset goes.' },
      max: { label: 'Max', type: 'float', min: -1000, max: 1000, step: 1, compileTime: true, hint: 'The top.' },
      limit: { label: 'At the ends', type: 'select', hint: 'Wrap: past Max goes back to Min (and below Min to Max). Stop: holds at the end. Free: keeps counting.', options: [
        { value: 'wrap', label: 'Wrap round' }, { value: 'clamp', label: 'Stop' }, { value: 'none', label: 'Free' },
      ] },
    },
    init: P => `s = vec4(${g(P.min, 0)}, 0.0, 0.0, 1.0);`,
    step: (P, I) => {
      const mn = g(P.min, 0), mx = g(P.max, 10);
      const lim = P.limit === 'clamp' ? `s.x = clamp(s.x, ${mn}, ${mx});` : P.limit === 'none' ? '' : `if (s.x > ${mx} + 1e-4) s.x = ${mn}; else if (s.x < ${mn} - 1e-4) s.x = ${mx};`;
      return `if (${I.reset} > 0.5 && s.z < 0.5) s.x = ${mn};
if (${I.trigger} > 0.5 && s.y < 0.5) { s.x += ${g(P.stepBy, 1)}; ${lim} }
s.y = step(0.5, ${I.trigger}); s.z = step(0.5, ${I.reset});`;
    },
  },
  sampleHold: {
    label: 'Sample & Hold',
    aliases: ['Hold CHOP', 'Hold', 'Latch', 'Freeze value', 'Stepped random'],
    description: 'Keeps a value until told to take a new one: on each rising edge of Trigger, or (unwired) every Every seconds. Wire noise or a random into Value for stepped random jumps.',
    inputs: {
      value: { label: 'Value', hint: 'What to take (one number).', fallback: '0.0' },
      trigger: { label: 'Trigger', hint: 'Takes a new value on each rising edge (above 0.5). Unwired: every Every seconds.', fallback: '0.0' },
    },
    outputs: { value: { label: 'Value', hint: 'The value last taken.', read: () => 's.x', plain: I => I.value } },
    defaultParams: { every: 0.5 },
    paramDefs: { every: { label: 'Every', type: 'float', min: 0.01, max: 60, step: 0.01, compileTime: true, hint: 'With Trigger unwired: seconds between takes.' } },
    init: (_P, I) => `s = vec4(${I.value}, 0.0, 0.0, 1.0);`,
    step: (P, I, wired) => (wired.has('trigger')
      ? `if (${I.trigger} > 0.5 && s.y < 0.5) s.x = ${I.value};
s.y = step(0.5, ${I.trigger});`
      : `s.z += dt; if (s.z >= ${g(P.every, 0.5)}) { s.z = mod(s.z, ${g(P.every, 0.5)}); s.x = ${I.value}; }`),
  },
  speed: {
    label: 'Speed (integrate)',
    aliases: ['Speed CHOP', 'Integrate', 'Accumulate', 'Position from speed', 'Running total'],
    description: 'Adds up its input over time: Rate is how much it grows per second, so a speed becomes a position (a knob that sets how fast something turns, without jumps). Wrap or Stop keeps it between Min and Max; Reset goes back to Min.',
    inputs: {
      rate: { label: 'Rate', hint: 'Growth per second (negative shrinks).', fallback: '1.0' },
      reset: { label: 'Reset', hint: 'Back to Min on a rising edge.', fallback: '0.0' },
    },
    outputs: { value: { label: 'Value', hint: 'The running total.', read: () => 's.x', plain: I => `${I.rate} * u_time` } },
    defaultParams: { limit: 'none', min: 0, max: 1 },
    paramDefs: {
      limit: { label: 'Limit', type: 'select', hint: 'Free: grows for ever. Wrap: round between Min and Max (an angle, a phase). Stop: holds at the ends.', options: [
        { value: 'none', label: 'Free' }, { value: 'wrap', label: 'Wrap round' }, { value: 'clamp', label: 'Stop' },
      ] },
      min: { label: 'Min', type: 'float', min: -1000, max: 1000, step: 0.01, compileTime: true, hint: 'The bottom, and where Reset goes.' },
      max: { label: 'Max', type: 'float', min: -1000, max: 1000, step: 0.01, compileTime: true, showWhen: { param: 'limit', value: ['wrap', 'clamp'] }, hint: 'The top.' },
    },
    init: P => `s = vec4(${g(P.min, 0)}, 0.0, 0.0, 1.0);`,
    step: (P, I) => {
      const mn = g(P.min, 0), mx = g(P.max, 1);
      const lim = P.limit === 'wrap' ? `s.x = ${mn} + mod(s.x - ${mn}, max(${mx} - ${mn}, 1e-4));` : P.limit === 'clamp' ? `s.x = clamp(s.x, ${mn}, ${mx});` : '';
      return `if (${I.reset} > 0.5 && s.y < 0.5) s.x = ${mn};
s.x += ${I.rate} * dt; ${lim}
s.y = step(0.5, ${I.reset});`;
    },
  },
};

/** The inputs of a kind, each as its GLSL (the wire, or the fallback). */
const inputsOf = (kind: MemoryKind, vars: (k: string) => string | undefined): Record<string, string> =>
  Object.fromEntries(Object.entries(MEMORY_SPECS[kind].inputs).map(([k, s]) => [k, vars(k) ?? s.fallback]));

/** One of the user-facing nodes. Its own GLSL is the no-memory fallback (inside a group); expanded, a Memory read takes its place. */
function memoryNode(kind: MemoryKind): NodeDefinition {
  const S = MEMORY_SPECS[kind];
  return {
    type: kind,
    label: S.label,
    category: MEMORY_CATEGORY,
    aliases: S.aliases,
    description: `${S.description} Remembers from frame to frame (one value; inputs are read at the picture's centre).`,
    inputs: Object.fromEntries(Object.entries(S.inputs).map(([k, i]) => [k, { type: 'float' as const, label: i.label, hint: i.hint }])),
    outputs: Object.fromEntries(Object.entries(S.outputs).map(([k, o]) => [k, { type: 'float' as const, label: o.label, hint: o.hint }])),
    defaultParams: S.defaultParams,
    paramDefs: S.paramDefs,
    generateGLSL: (node, inputVars) => {
      const I = inputsOf(kind, k => inputVars[k]);
      const outs = Object.fromEntries(Object.keys(S.outputs).map(k => [k, `${node.id}_${k}`]));
      const code = Object.entries(S.outputs).map(([k, o]) => `    float ${node.id}_${k} = ${o.plain(I)};\n`).join('');
      return { code, outputVars: outs };
    },
  };
}

export const MEMORY_NODES: Record<MemoryKind, NodeDefinition> = Object.fromEntries(MEMORY_KINDS.map(k => [k, memoryNode(k)])) as Record<MemoryKind, NodeDefinition>;

/** A member of the Memory pack: its kind, settings and which of its inputs are wired. */
export interface MemoryMember { kind: MemoryKind; params: P; wired: string[] }
export const packInputKey = (i: number, key: string) => `m${i}_${key}`;

/** Internal: the shared memory Pass's program: each texel (a memory node) its next state from last frame's. */
export const MemoryPackNode: NodeDefinition = {
  type: MEMORY_PACK_TYPE,
  label: 'Memory step',
  category: 'Output',
  description: 'Internal: one frame of every memory node (Lag, Spring, Envelope…), one texel each.',
  inputs: { prev: { type: 'texture', label: 'Last frame' } },
  outputs: { color: { type: 'vec3', label: 'Color' }, alpha: { type: 'float', label: 'Alpha' } },
  defaultParams: {},
  assignable: false,
  declarationsFor: () => [`uniform float ${FRAME_DT_UNIFORM};`],
  generateGLSL: (node, inputVars) => {
    const id = node.id;
    const members = (node.params.__members as MemoryMember[] | undefined) ?? [];
    const prev = inputVars.prev;
    const L: string[] = [
      `    int ${id}_i = int(floor(gl_FragCoord.x));\n`,
      `    vec4 ${id}_s = ${prev ? `texelFetch(${prev}, ivec2(${id}_i, 0), 0)` : 'vec4(0.0)'};\n`,
      `    float ${id}_dt = max(${FRAME_DT_UNIFORM}, 0.0);\n`,
    ];
    members.forEach((m, i) => {
      const S = MEMORY_SPECS[m.kind];
      if (!S) return;
      const wired = new Set(m.wired);
      const I = inputsOf(m.kind, k => (wired.has(k) ? inputVars[packInputKey(i, k)] : undefined));
      const body = [
        `vec4 s = ${id}_s; float dt = ${id}_dt;`,
        `if (s.w < 0.5) { ${S.init(m.params, I)} } else {`,
        ...S.step(m.params, I, wired).split('\n').map(l => `  ${l}`),
        '}',
        `${id}_s = s;`,
      ];
      L.push(`    ${i === 0 ? '' : 'else '}if (${id}_i == ${i}) {\n${body.map(l => `      ${l}\n`).join('')}    }\n`);
    });
    return { code: L.join(''), outputVars: { color: `${id}_s.rgb`, alpha: `${id}_s.a` } };
  },
};

/** Internal: a memory node's outputs, read from its texel of the memory Pass (this frame's, or last frame's). */
export const MemoryReadNode: NodeDefinition = {
  type: MEMORY_READ_TYPE,
  label: 'Memory read',
  category: 'Output',
  description: 'Internal: a memory node\'s outputs, from its texel of the shared memory Pass.',
  inputs: { state: { type: 'texture', label: 'Memory' } },
  outputs: {},
  defaultParams: {},
  assignable: false,
  generateGLSL: (node, inputVars) => {
    const id = node.id;
    const kind = node.params.kind as MemoryKind;
    const S = MEMORY_SPECS[kind];
    const st = inputVars.state;
    const lines = [`    vec4 ${id}_m = ${st ? `texelFetch(${st}, ivec2(${Math.max(0, Math.round(num(node.params.index, 0)))}, 0), 0)` : 'vec4(0.0)'};\n`];
    const outs: Record<string, string> = {};
    for (const [k, o] of Object.entries(S?.outputs ?? {})) {
      lines.push(`    float ${id}_${k} = ${o.read(node.params.memParams as P ?? {}).replace(/\bs\./g, `${id}_m.`)};\n`);
      outs[k] = `${id}_${k}`;
    }
    return { code: lines.join(''), outputVars: outs };
  },
};

/** Plain-JS mirror of one Lag step (tests). */
export const lagStep = (y: number, x: number, dt: number, rise: number, fall: number): number => {
  const tau = x > y ? rise : fall;
  return tau <= 0 ? x : x + (y - x) * Math.exp(-dt / tau);
};

