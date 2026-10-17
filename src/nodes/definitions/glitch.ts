/**
 * Glitch (docs/glitch-node.md): two pictures in, two damaged pictures out. A and B are each a texture
 * or a colour (A is / B is on the card, the sockets retype as Shuffle's do); A′ and B′ are colours.
 *
 * The picture is cut into blocks (Blocks rows of them, Block width wide). Each block draws a random
 * number from Random (from ID)'s hash of (block, tick, Seed); the tick steps Rate times a second, so
 * the damage is dealt again. Amount is the share of blocks that are hit.
 *
 *   Swap blocks      in a hit block A′ is B and B′ is A (exactly), elsewhere they pass through.
 *   Channel cross    each channel crosses on its own: some of A's channels come from B and back.
 *   Displace         each one is read pushed (a random way per block) by the other's brightness;
 *                    a colour has nowhere to be pushed, so its hue turns by the other's brightness.
 *   Bit flips        both cut to Bits bits; random bits flip (only bits the other has, if it is wired).
 *   Slice shift      rows of A slide sideways by B's brightness, rows of B by A's, the other way.
 *
 * Amount 0 is the inputs untouched in every mode. Everything is inline GLSL except the shared hash
 * (rfiHash, randomFromId.ts), which the tests provide on the CPU.
 */
import type { GraphNode, NodeDefinition } from '../../types/nodeGraph';
import { p, withParamSockets } from './helpers';
import { texUv } from './passes';
import { RANDOM_FROM_ID_GLSL } from './randomFromId';

export type GlitchMode = 'swap' | 'channels' | 'displace' | 'bits' | 'slices';
export type GlitchInputKind = 'texture' | 'colour';
const MODES: GlitchMode[] = ['swap', 'channels', 'displace', 'bits', 'slices'];
const modeOf = (v: unknown): GlitchMode => (MODES.includes(v as GlitchMode) ? v as GlitchMode : 'swap');
const BIT_OPTIONS = ['1', '2', '3', '4', '5', '6', '8'];
const bitsOf = (v: unknown) => (BIT_OPTIONS.includes(String(v)) ? Number(v) : 4);
const LUMA = 'vec3(0.299, 0.587, 0.114)';

/** A Glitch's A and B sockets follow A is / B is (texture or vec3); a wire that no longer fits comes off. */
export function retypeGlitch(node: GraphNode): GraphNode {
  let inputs: GraphNode['inputs'] | null = null;
  let params: GraphNode['params'] | null = null;
  for (const k of ['a', 'b'] as const) {
    const kind: GlitchInputKind = node.params[`${k}Is`] === 'colour' ? 'colour' : 'texture';
    if (node.params[`${k}Is`] !== kind) { params ??= { ...node.params }; params[`${k}Is`] = kind; }
    const type = kind === 'texture' ? 'texture' : 'vec3';
    const cur = node.inputs[k];
    if (cur?.type === type) continue;
    inputs ??= { ...node.inputs };
    inputs[k] = { ...(cur ?? { label: k.toUpperCase() }), type, connection: undefined };
  }
  return inputs || params ? { ...node, inputs: inputs ?? node.inputs, params: params ?? node.params } : node;
}

export const GlitchNode: NodeDefinition = withParamSockets({
  type: 'glitch',
  label: 'Glitch',
  category: 'Effects',
  aliases: ['Digital glitch', 'Datamosh look', 'Block swap', 'Swap blocks', 'Channel cross', 'Bit crush', 'Bit flip', 'Slice shift', 'Scan glitch', 'Corrupt', 'Databend', 'Two picture glitch', 'Cross glitch'],
  description: 'Two pictures in, two damaged pictures out. The picture is cut into blocks and Amount of them are hit, dealt again Rate times a second: Swap blocks trades A and B in those blocks, Channel cross swaps some of their channels, Displace pushes each by the other\'s brightness, Bit flips cuts them to a few bits and flips some, Slice shift slides rows of each by the other\'s brightness. A and B are each a texture or a colour (A is / B is on the card). Amount 0 leaves both untouched.',
  inputs: {
    a: { type: 'texture', label: 'A', hint: 'The first picture: a texture (a photo, a Pass, a video), or a colour when A is says Colour.' },
    b: { type: 'texture', label: 'B', hint: 'The second picture, mixed into A′ (and A into B′). Empty: black.' },
    uv: { type: 'vec2', label: 'UV', hint: 'Where to read the textures and lay the blocks. Empty: this pixel.' },
    time: { type: 'float', label: 'Time', hint: 'The clock the blocks are dealt by. Empty: the running time.' },
  },
  outputs: {
    outA: { type: 'vec3', label: 'A′', hint: 'A, glitched by B.' },
    outB: { type: 'vec3', label: 'B′', hint: 'B, glitched by A.' },
    hit: { type: 'float', label: 'Hit', hint: '1 in the blocks (or rows, or channels) that were hit, else 0: a mask of the damage.' },
  },
  defaultParams: { aIs: 'texture', bIs: 'texture', mode: 'swap', amount: 0.3, seed: 0, blocks: 12, blockWidth: 1, rate: 4, reach: 0.3, bits: '4' },
  syncSockets: retypeGlitch,
  paramDefs: {
    mode: { label: 'Mode', type: 'select', hint: 'What a hit does. Swap blocks: A and B trade places. Channel cross: some channels come from the other. Displace: each is pushed by the other\'s brightness (a colour turns its hue instead). Bit flips: cut to a few bits, some flipped. Slice shift: rows slide sideways by the other\'s brightness.', options: [
      { value: 'swap', label: 'Swap blocks' }, { value: 'channels', label: 'Channel cross' }, { value: 'displace', label: 'Displace by the other' },
      { value: 'bits', label: 'Bit flips' }, { value: 'slices', label: 'Slice shift' },
    ] },
    aIs: { label: 'A is', type: 'select', hint: 'Texture: A is read at each pixel (and can be pushed). Colour: A is one colour or a colour chain.', options: [{ value: 'texture', label: 'Texture' }, { value: 'colour', label: 'Colour' }] },
    bIs: { label: 'B is', type: 'select', hint: 'Texture or Colour, as for A.', options: [{ value: 'texture', label: 'Texture' }, { value: 'colour', label: 'Colour' }] },
    amount: { label: 'Amount', type: 'float', min: 0, max: 1, step: 0.001, hint: 'The share of blocks hit: 0 none (both pass through untouched), 1 all of them.' },
    seed: { label: 'Seed', type: 'float', min: 0, max: 100, step: 1, hint: 'Another deal of blocks.' },
    blocks: { label: 'Blocks', type: 'float', min: 1, max: 200, step: 0.1, hint: 'How many rows of blocks fit the picture\'s height: more is finer damage.' },
    blockWidth: { label: 'Block width', type: 'float', min: 0.1, max: 40, step: 0.01, hint: 'How wide a block is for its height: 1 square, 8 long bars.' },
    rate: { label: 'Rate', type: 'float', min: 0, max: 60, step: 0.01, hint: 'How many times a second the blocks are dealt again (0: they hold still).' },
    reach: { label: 'Reach', type: 'float', min: 0, max: 2, step: 0.001, showWhen: { param: 'mode', value: ['displace', 'slices'] }, hint: 'How far a push or a slide goes at full brightness, in picture heights ÷ 2. For a colour: how far the hue turns (1 is all the way round).' },
    bits: { label: 'Bits', type: 'select', showWhen: { param: 'mode', value: 'bits' }, hint: 'How many bits each channel is cut to before the flips: 1 is two levels, 8 is almost smooth.', options: BIT_OPTIONS.map(b => ({ value: b, label: `${b} bit${b === '1' ? '' : 's'} (${2 ** Number(b)} levels)` })) },
  },
  glslFunctions: [RANDOM_FROM_ID_GLSL],
  generateGLSL: (node: GraphNode, v) => {
    const id = node.id;
    const P = node.params;
    const tex = (k: 'a' | 'b') => node.inputs[k]?.type === 'texture';
    const read = (k: 'a' | 'b', at: string) => {
      const x = v[k];
      if (!x) return 'vec3(0.0)';
      return tex(k) ? `texture2D(${x}, ${texUv(at)}).rgb` : x;
    };
    const uv = v.uv ?? 'g_uv';
    const amt = p(P.amount, 0.3), seed = p(P.seed, 0), reach = p(P.reach, 0.3);
    const mode = modeOf(P.mode);
    const L = [
      `    vec2 ${id}_uv = ${uv};\n`,
      `    vec2 ${id}_bs = vec2(2.0 / max(${p(P.blocks, 12)}, 1e-3)) * vec2(max(${p(P.blockWidth, 1)}, 1e-3), 1.0);\n`,
      `    vec2 ${id}_cell = floor(${id}_uv / ${id}_bs);\n`,
      `    float ${id}_tick = floor(${v.time ?? 'u_time'} * max(${p(P.rate, 4)}, 0.0));\n`,
      // Slice shift deals per row, the rest per block.
      `    vec3 ${id}_key = vec3(${mode === 'slices' ? '0.0' : `${id}_cell.x`}, ${id}_cell.y, ${id}_tick);\n`,
      `    float ${id}_h = rfiHash(${id}_key, ${seed});\n`,
      `    float ${id}_on = ${id}_h < ${amt} ? 1.0 : 0.0;\n`,
      `    vec3 ${id}_a = ${read('a', `${id}_uv`)};\n`,
      `    vec3 ${id}_b = ${read('b', `${id}_uv`)};\n`,
    ];
    let hit = `${id}_on`;
    // A colour turned round the grey axis by `ang` radians (Rodrigues): the colour fallback for a push.
    const hueTurn = (c: string, ang: string, name: string) => [
      `    float ${name}_c = cos(${ang});\n`,
      `    float ${name}_s = sin(${ang});\n`,
      `    vec3 ${name} = ${c} * ${name}_c + cross(vec3(0.57735), ${c}) * ${name}_s + vec3(0.57735) * dot(vec3(0.57735), ${c}) * (1.0 - ${name}_c);\n`,
    ];
    if (mode === 'swap') {
      L.push(
        `    vec3 ${id}_oa = ${id}_on > 0.5 ? ${id}_b : ${id}_a;\n`,
        `    vec3 ${id}_ob = ${id}_on > 0.5 ? ${id}_a : ${id}_b;\n`,
      );
    } else if (mode === 'channels') {
      L.push(
        `    vec3 ${id}_hc = vec3(rfiHash(${id}_key, ${seed} + 3.0), rfiHash(${id}_key, ${seed} + 5.0), rfiHash(${id}_key, ${seed} + 7.0));\n`,
        `    vec3 ${id}_sw = 1.0 - step(vec3(${amt}), ${id}_hc);\n`,
        `    vec3 ${id}_oa = mix(${id}_a, ${id}_b, ${id}_sw);\n`,
        `    vec3 ${id}_ob = mix(${id}_b, ${id}_a, ${id}_sw);\n`,
      );
      hit = `max(max(${id}_sw.x, ${id}_sw.y), ${id}_sw.z)`;
    } else if (mode === 'displace' || mode === 'slices') {
      if (mode === 'displace') {
        L.push(
          `    float ${id}_ang = 6.2831853 * rfiHash(${id}_key, ${seed} + 11.0);\n`,
          `    vec2 ${id}_dir = vec2(cos(${id}_ang), sin(${id}_ang));\n`,
          `    float ${id}_la = dot(${id}_a, ${LUMA});\n`,
          `    float ${id}_lb = dot(${id}_b, ${LUMA});\n`,
        );
      } else {
        // Each row slides one way or the other, by the other's brightness along the middle of the row.
        const mid = `vec2(${id}_uv.x, (${id}_cell.y + 0.5) * ${id}_bs.y)`;
        L.push(
          `    float ${id}_sg = rfiHash(${id}_key, ${seed} + 13.0) * 2.0 - 1.0;\n`,
          `    vec2 ${id}_dir = vec2(${id}_sg, 0.0);\n`,
          `    float ${id}_la = dot(${read('a', mid)}, ${LUMA});\n`,
          `    float ${id}_lb = dot(${read('b', mid)}, ${LUMA});\n`,
        );
      }
      for (const [k, own, other, sign] of [['a', 'oa', 'lb', '+'], ['b', 'ob', 'la', '-']] as const) {
        if (tex(k)) {
          L.push(`    vec3 ${id}_${own}p = ${read(k, `${id}_uv ${sign} ${id}_dir * ${id}_${other} * ${reach}`)};\n`);
        } else {
          L.push(...hueTurn(`${id}_${k}`, `${sign === '-' ? '-' : ''}6.2831853 * ${reach} * ${id}_${other}`, `${id}_${own}p`));
        }
        L.push(`    vec3 ${id}_${own} = ${id}_on > 0.5 ? ${id}_${own}p : ${id}_${k};\n`);
      }
    } else {
      // Bit flips: both cut to N bits (0 … 2^N − 1). A random mask per block and channel says which bits
      // flip; with the other wired, only the bits the other has set too. Bit i of x is mod(floor(x / 2^i), 2).
      const N = bitsOf(P.bits), top = 2 ** N - 1;
      L.push(
        `    vec3 ${id}_qa = floor(clamp(${id}_a, 0.0, 1.0) * ${top}.0 + 0.5);\n`,
        `    vec3 ${id}_qb = floor(clamp(${id}_b, 0.0, 1.0) * ${top}.0 + 0.5);\n`,
        `    vec3 ${id}_m = floor(vec3(rfiHash(${id}_key, ${seed} + 3.0), rfiHash(${id}_key, ${seed} + 5.0), rfiHash(${id}_key, ${seed} + 7.0)) * ${top + 1}.0);\n`,
        `    vec3 ${id}_ra = vec3(0.0);\n`,
        `    vec3 ${id}_rb = vec3(0.0);\n`,
      );
      for (let i = 0; i < N; i++) {
        const w = `${2 ** i}.0`;
        const bit = (x: string) => `mod(floor(${x} / ${w}), 2.0)`;
        L.push(
          `    vec3 ${id}_a${i} = ${bit(`${id}_qa`)};\n`,
          `    vec3 ${id}_b${i} = ${bit(`${id}_qb`)};\n`,
          `    vec3 ${id}_m${i} = ${bit(`${id}_m`)};\n`,
          `    ${id}_ra += ${w} * abs(${id}_a${i} - ${id}_m${i}${v.b ? ` * ${id}_b${i}` : ''});\n`,
          `    ${id}_rb += ${w} * abs(${id}_b${i} - ${id}_m${i}${v.a ? ` * ${id}_a${i}` : ''});\n`,
        );
      }
      L.push(
        `    vec3 ${id}_oa = ${id}_on > 0.5 ? ${id}_ra / ${top}.0 : ${id}_a;\n`,
        `    vec3 ${id}_ob = ${id}_on > 0.5 ? ${id}_rb / ${top}.0 : ${id}_b;\n`,
      );
    }
    return { code: L.join(''), outputVars: { outA: `${id}_oa`, outB: `${id}_ob`, hit } };
  },
}, ['amount', 'seed', 'blocks', 'blockWidth', 'rate']);
