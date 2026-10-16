/**
 * Channel tools (docs/channel-tools.md): reading and shaping the four channels of data without code.
 *
 * Channel: one channel of a texture or of four Channels (a Trail field's, a Data texture's, a Pass's),
 * optionally compared with another (A − B, A ÷ B, the larger, the smaller), then shaped: Raw, 0–1 (a soft
 * exposure curve, as Trail field's Amount), Remap (one range to another), Threshold (a soft cut-off), and
 * Invert. This is the `1.0 - exp(-max(ch.r, 0.0) * k)` line most agent examples wrote by hand.
 */
import type { GraphNode, NodeDefinition } from '../../types/nodeGraph';
import { p, pv3 as pv3Of, withParamSockets } from './helpers';
import { texUv } from './passes';
import { TEXTURE_TOOLS_CATEGORY } from './textureTools';

const LUMA = 'vec3(0.299, 0.587, 0.114)';
const CHANNEL_OPTIONS = [
  { value: '1', label: 'Channel 1' }, { value: '2', label: 'Channel 2' }, { value: '3', label: 'Channel 3' }, { value: '4', label: 'Channel 4' },
  { value: 'bright', label: 'Brightness (1–3)' }, { value: 'sum', label: 'All four, added' }, { value: 'max', label: 'The largest' },
];
type Pick = '1' | '2' | '3' | '4' | 'bright' | 'sum' | 'max';
const pickOf = (v: unknown, fb: Pick): Pick => (CHANNEL_OPTIONS.some(o => o.value === String(v)) ? String(v) as Pick : fb);

/** One channel (or a mix of them) of a vec4 expression. */
export function channelExpr(c: Pick, v: string): string {
  if (c === 'bright') return `dot((${v}).rgb, ${LUMA})`;
  if (c === 'sum') return `dot(${v}, vec4(1.0))`;
  if (c === 'max') return `max(max((${v}).r, (${v}).g), max((${v}).b, (${v}).a))`;
  return `(${v}).${'rgba'[Number(c) - 1]}`;
}

export const ChannelNode: NodeDefinition = withParamSockets({
  type: 'channelPick',
  label: 'Channel',
  category: TEXTURE_TOOLS_CATEGORY,
  aliases: ['Pick channel', 'Channel select', 'Split channels', 'Separate RGBA', 'Read a channel', 'Compare channels', 'Channel math', 'Channel difference', 'Shape a channel'],
  description: 'One channel of a texture or of four Channels (a Trail field, a Data texture, a Pass), as a number you can use: Raw, softly scaled to 0–1, remapped, or cut at a threshold, optionally inverted. Compare sets it against another channel first (A − B, A ÷ B, the larger or smaller): prey scent minus predator scent, food over crowd.',
  inputs: {
    channels: { type: 'vec4', label: 'Channels', hint: 'Four channels: a Trail field\'s Channels, a Data texture read, any vec4. Wins over Texture.' },
    texture: { type: 'texture', label: 'Texture', hint: 'A texture to read at this pixel (a Trail field\'s Texture, a Pass, a picture), when Channels is not wired.' },
    other: { type: 'vec4', label: 'Compare with', hint: 'Where B comes from when comparing: another set of four channels. Empty: the same input as A.' },
    uv: { type: 'vec2', label: 'UV', hint: 'Where to read the Texture, in picture coordinates. Empty: this pixel.' },
  },
  outputs: {
    value: { type: 'float', label: 'Value', hint: 'The channel, shaped.' },
    mask: { type: 'float', label: 'Mask', hint: 'The same, kept between 0 and 1: for Mix, Mask, Colorize.' },
  },
  defaultParams: {
    channel: '1', compare: 'off', channelB: '2', shape: 'soft', exposure: 1, inLow: 0, inHigh: 1, outLow: 0, outHigh: 1, threshold: 0.5, softness: 0.05, invert: false,
  },
  paramDefs: {
    channel: { label: 'Channel', type: 'select', section: 'Read', hint: 'Which channel is A: a Trail field\'s channels are 1–4 (its Channel names say what each holds).', options: CHANNEL_OPTIONS, channelsFrom: ['channels', 'texture'] },
    compare: { label: 'Compare', type: 'select', section: 'Read', hint: 'Set A against another channel, B, before shaping it.', options: [
      { value: 'off', label: 'Off (A alone)' }, { value: 'minus', label: 'A − B' }, { value: 'ratio', label: 'A ÷ B' }, { value: 'larger', label: 'The larger of A, B' }, { value: 'smaller', label: 'The smaller of A, B' },
    ] },
    channelB: { label: 'Channel B', type: 'select', section: 'Read', showWhen: { param: 'compare', value: ['minus', 'ratio', 'larger', 'smaller'] }, hint: 'Which channel is B (of Compare with when it is wired, else of the same input as A).', options: CHANNEL_OPTIONS, channelsFrom: ['other', 'channels', 'texture'] },
    shape: { label: 'Shape', type: 'select', section: 'Shape', hint: 'Raw: the number as it is. 0–1: a soft curve that reaches 1 without clipping (1 − e^(−value × Exposure)), as Trail field\'s Amount. Remap: one range onto another. Threshold: 0 below, 1 above, with a soft edge.', options: [
      { value: 'raw', label: 'Raw' }, { value: 'soft', label: '0–1 (soft)' }, { value: 'remap', label: 'Remap' }, { value: 'threshold', label: 'Threshold' },
    ] },
    exposure: { label: 'Exposure', type: 'float', min: 0, max: 10, step: 0.001, section: 'Shape', showWhen: { param: 'shape', value: 'soft' }, hint: 'How fast it rises to 1: higher shows faint amounts, lower keeps the strong ones apart.' },
    inLow: { label: 'From low', type: 'float', min: -10, max: 10, step: 0.001, section: 'Shape', showWhen: { param: 'shape', value: 'remap' }, hint: 'The value that becomes To low.' },
    inHigh: { label: 'From high', type: 'float', min: -10, max: 10, step: 0.001, section: 'Shape', showWhen: { param: 'shape', value: 'remap' }, hint: 'The value that becomes To high.' },
    outLow: { label: 'To low', type: 'float', min: -10, max: 10, step: 0.001, section: 'Shape', showWhen: { param: 'shape', value: 'remap' }, hint: 'What From low becomes.' },
    outHigh: { label: 'To high', type: 'float', min: -10, max: 10, step: 0.001, section: 'Shape', showWhen: { param: 'shape', value: 'remap' }, hint: 'What From high becomes.' },
    threshold: { label: 'Threshold', type: 'float', min: -10, max: 10, step: 0.001, section: 'Shape', showWhen: { param: 'shape', value: 'threshold' }, hint: 'Where it turns from 0 to 1.' },
    softness: { label: 'Softness', type: 'float', min: 0, max: 5, step: 0.001, section: 'Shape', showWhen: { param: 'shape', value: 'threshold' }, hint: 'How wide the step is (0: hard).' },
    invert: { label: 'Invert', type: 'bool', section: 'Shape', hint: 'Flip it: 1 − value (0–1, Threshold) or the negative (Raw, Remap).' },
  },
  generateGLSL: (node: GraphNode, v) => {
    const id = node.id;
    const P = node.params;
    const src = v.channels ?? (v.texture ? `texture2D(${v.texture}, ${texUv(v.uv ?? 'g_uv')})` : null);
    if (!src) return { code: `    float ${id}_v = 0.0;\n`, outputVars: { value: `${id}_v`, mask: `${id}_v` } };
    const a = channelExpr(pickOf(P.channel, '1'), `${id}_src`);
    const b = channelExpr(pickOf(P.channelB, '2'), v.other ? `(${v.other})` : `${id}_src`);
    const compare = String(P.compare ?? 'off');
    const combined = compare === 'minus' ? `${a} - ${b}`
      : compare === 'ratio' ? `${a} / (abs(${b}) > 1e-6 ? ${b} : 1e-6)`
      : compare === 'larger' ? `max(${a}, ${b})`
      : compare === 'smaller' ? `min(${a}, ${b})`
      : a;
    const shape = String(P.shape ?? 'soft');
    const x = `${id}_x`;
    const shaped = shape === 'raw' ? x
      : shape === 'remap' ? `mix(${p(P.outLow, 0)}, ${p(P.outHigh, 1)}, (${x} - ${p(P.inLow, 0)}) / ${id}_span)`
      : shape === 'threshold' ? `smoothstep(${p(P.threshold, 0.5)} - ${p(P.softness, 0.05)} * 0.5 - 1e-5, ${p(P.threshold, 0.5)} + ${p(P.softness, 0.05)} * 0.5, ${x})`
      : `(1.0 - exp(-max(${x}, 0.0) * ${p(P.exposure, 1)}))`;
    const unit = shape === 'soft' || shape === 'threshold';
    const inverted = P.invert === true ? (unit ? `(1.0 - ${shaped})` : `(-${shaped})`) : shaped;
    return {
      code: [
        `    vec4 ${id}_src = ${src};\n`,
        `    float ${x} = ${combined};\n`,
        shape === 'remap' ? `    float ${id}_span = ${p(P.inHigh, 1)} - ${p(P.inLow, 0)}; ${id}_span = abs(${id}_span) < 1e-6 ? 1e-6 : ${id}_span;\n` : '',
        `    float ${id}_v = ${inverted};\n`,
      ].join(''),
      outputVars: { value: `${id}_v`, mask: `clamp(${id}_v, 0.0, 1.0)` },
    };
  },
}, ['exposure', 'inLow', 'inHigh', 'outLow', 'outHigh', 'threshold', 'softness']);

// ── Shuffle ──────────────────────────────────────────────────────────────────

const FROM_OPTIONS = [
  { value: 'a1', label: 'A · channel 1' }, { value: 'a2', label: 'A · channel 2' }, { value: 'a3', label: 'A · channel 3' }, { value: 'a4', label: 'A · channel 4' },
  { value: 'b1', label: 'B · channel 1' }, { value: 'b2', label: 'B · channel 2' }, { value: 'b3', label: 'B · channel 3' }, { value: 'b4', label: 'B · channel 4' },
  { value: '0', label: '0 (off)' }, { value: '1', label: '1 (full)' },
];
export const SHUFFLE_SLOTS = ['r', 'g', 'b', 'a'] as const;
const fromOf = (v: unknown, fb: string) => (FROM_OPTIONS.some(o => o.value === String(v)) ? String(v) : fb);

export const ShuffleNode: NodeDefinition = {
  type: 'channelShuffle',
  label: 'Shuffle',
  category: TEXTURE_TOOLS_CATEGORY,
  aliases: ['Shuffle channels', 'Reorder channels', 'Swap channels', 'Shift channels', 'Channel mixer', 'Combine channels', 'Merge channels', 'Channels to colour', 'Swizzle'],
  description: 'Builds four new channels (and a colour) from the channels of one or two inputs: put channel 3 in red, channel 1 in green, nothing in blue. After Effects\' Shift Channels, Nuke\'s Shuffle, TouchDesigner\'s Reorder.',
  inputs: {
    a: { type: 'vec4', label: 'A', hint: 'Four channels: a Trail field\'s Channels, a Data texture read, any vec4. Wins over Texture A.' },
    textureA: { type: 'texture', label: 'Texture A', hint: 'Or a texture, read at this pixel.' },
    b: { type: 'vec4', label: 'B', hint: 'A second set of channels to take from (optional).' },
    uv: { type: 'vec2', label: 'UV', hint: 'Where to read Texture A, in picture coordinates. Empty: this pixel.' },
  },
  outputs: {
    color: { type: 'vec3', label: 'Color', hint: 'Red, green and blue as a colour.' },
    channels: { type: 'vec4', label: 'Channels', hint: 'All four new channels.' },
    alpha: { type: 'float', label: 'Alpha', hint: 'The fourth channel.' },
  },
  defaultParams: { r: 'a1', g: 'a2', b: 'a3', a: 'a4' },
  // Set with the card's click grid (NodeInlineViz ShuffleGridViz): which channel goes into each of R, G, B, A.
  paramDefs: {},
  generateGLSL: (node: GraphNode, v) => {
    const id = node.id;
    const A = v.a ?? (v.textureA ? `texture2D(${v.textureA}, ${texUv(v.uv ?? 'g_uv')})` : 'vec4(0.0)');
    const B = v.b ?? 'vec4(0.0)';
    const slot = (k: string, fb: string) => {
      const f = fromOf(node.params[k], fb);
      if (f === '0' || f === '1') return `${f}.0`;
      return `${id}_${f[0]}.${'rgba'[Number(f[1]) - 1]}`;
    };
    return {
      code: [
        `    vec4 ${id}_a = ${A};\n`,
        `    vec4 ${id}_b = ${B};\n`,
        `    vec4 ${id}_o = vec4(${slot('r', 'a1')}, ${slot('g', 'a2')}, ${slot('b', 'a3')}, ${slot('a', 'a4')});\n`,
      ].join(''),
      outputVars: { color: `${id}_o.rgb`, channels: `${id}_o`, alpha: `${id}_o.a` },
    };
  },
};

// ── Channel Colours ──────────────────────────────────────────────────────────

const CC_DEFAULT_COLOURS: [number, number, number][] = [[1, 0.42, 0.3], [0.25, 0.85, 0.75], [0.62, 0.45, 1], [1, 0.85, 0.35]];

export const ChannelColoursNode: NodeDefinition = withParamSockets({
  type: 'channelColours',
  label: 'Channel Colours',
  category: TEXTURE_TOOLS_CATEGORY,
  aliases: ['Colour by channel', 'Color by channel', 'Tint channels', 'Channels to colours', 'Species colours', 'False colour channels', 'Channel mixer colour'],
  description: 'Gives each of four channels its own colour and lays them over a Background: a Trail field\'s species as coral, teal and violet, grass green and scent red, any multi-channel data as a picture. Glow adds the colours (light); Paint lays them over the background like ink; Average treats the first three channels as a colour summed and the fourth as how many (paint mixed by count).',
  inputs: {
    channels: { type: 'vec4', label: 'Channels', hint: 'Four channels: a Trail field\'s Channels, a Data texture read, any vec4. Wins over Texture.' },
    texture: { type: 'texture', label: 'Texture', hint: 'Or a texture, read at this pixel.' },
    background: { type: 'vec3', label: 'Background', hint: 'What is underneath. Empty: Background colour.' },
    uv: { type: 'vec2', label: 'UV', hint: 'Where to read the Texture, in picture coordinates. Empty: this pixel.' },
  },
  outputs: {
    color: { type: 'vec3', label: 'Color', hint: 'The channels in their colours over the background.' },
    coverage: { type: 'float', label: 'Coverage', hint: 'How much of any channel is here, 0–1: a mask of where there is something.' },
  },
  defaultParams: {
    mode: 'glow', background: [0.02, 0.02, 0.03],
    on1: true, colour1: CC_DEFAULT_COLOURS[0], exposure1: 0.5,
    on2: true, colour2: CC_DEFAULT_COLOURS[1], exposure2: 0.5,
    on3: true, colour3: CC_DEFAULT_COLOURS[2], exposure3: 0.5,
    on4: true, colour4: CC_DEFAULT_COLOURS[3], exposure4: 0.5, layers: 0.5,
  },
  paramDefs: {
    mode: { label: 'Mode', type: 'select', hint: 'Glow: the colours add, like light (bright where channels overlap). Paint: each channel lays its colour over what is below it, like ink. Average: channels 1–3 are a colour summed, channel 4 how many (paint mixed by count, as the Painters example lays it).', options: [
      { value: 'glow', label: 'Glow (add)' }, { value: 'paint', label: 'Paint (over)' }, { value: 'average', label: 'Average (colour ÷ count)' },
    ] },
    background: { label: 'Background colour', type: 'vec3color', hint: 'Underneath, when Background is not wired.' },
    layers: { label: 'Cover', type: 'float', min: 0, max: 10, step: 0.001, showWhen: { param: 'mode', value: 'average' }, hint: 'How fast the paint covers the background as layers pile up (1 − e^(−count × Cover)).' },
    ...Object.fromEntries([1, 2, 3, 4].flatMap(i => [
      [`on${i}`, { label: `Channel ${i}`, type: 'bool', section: `Channel ${i}`, showWhen: { param: 'mode', value: ['glow', 'paint'] }, hint: `Show channel ${i}.` }],
      [`colour${i}`, { label: 'Colour', type: 'vec3color', section: `Channel ${i}`, showWhen: { param: 'mode', value: ['glow', 'paint'] }, hint: `Channel ${i}'s colour.` }],
      [`exposure${i}`, { label: 'Exposure', type: 'float', min: 0, max: 10, step: 0.001, section: `Channel ${i}`, showWhen: { param: 'mode', value: ['glow', 'paint'] }, hint: 'How fast this channel reaches full colour (1 − e^(−value × Exposure)): higher shows faint amounts.' }],
    ])),
  },
  generateGLSL: (node: GraphNode, v) => {
    const id = node.id;
    const P = node.params;
    const src = v.channels ?? (v.texture ? `texture2D(${v.texture}, ${texUv(v.uv ?? 'g_uv')})` : 'vec4(0.0)');
    const bg = v.background ?? pv3Of(P.background, [0.02, 0.02, 0.03]);
    const mode = String(P.mode ?? 'glow');
    const lines = [`    vec4 ${id}_s = max(${src}, vec4(0.0));\n`, `    vec3 ${id}_c = ${bg};\n`, `    float ${id}_cov = 0.0;\n`];
    if (mode === 'average') {
      // Channels 1–3 a colour summed over every layer, channel 4 how many layers: the mean colour, covering as layers pile up.
      lines.push(
        `    vec3 ${id}_mean = ${id}_s.rgb / max(${id}_s.a, 1e-4);\n`,
        `    ${id}_cov = 1.0 - exp(-${id}_s.a * ${p(P.layers, 0.5)});\n`,
        `    ${id}_c = mix(${id}_c, ${id}_mean, ${id}_cov);\n`,
      );
    } else {
      [1, 2, 3, 4].forEach(i => {
        if (P[`on${i}`] === false) return;
        const k = `${id}_k${i}`;
        lines.push(`    float ${k} = 1.0 - exp(-${id}_s.${'rgba'[i - 1]} * ${p(P[`exposure${i}`], 0.5)});\n`);
        lines.push(mode === 'paint'
          ? `    ${id}_c = mix(${id}_c, ${pv3Of(P[`colour${i}`], CC_DEFAULT_COLOURS[i - 1])}, ${k});\n`
          : `    ${id}_c += ${pv3Of(P[`colour${i}`], CC_DEFAULT_COLOURS[i - 1])} * ${k};\n`);
        lines.push(`    ${id}_cov = max(${id}_cov, ${k});\n`);
      });
    }
    return { code: lines.join(''), outputVars: { color: `${id}_c`, coverage: `${id}_cov` } };
  },
}, ['exposure1', 'exposure2', 'exposure3', 'exposure4', 'layers', 'colour1', 'colour2', 'colour3', 'colour4']);
