/**
 * passExamplesTexture.ts — Passes 10 (docs/texture-builder.md): a Shader Texture, a node holding
 * its own little shader graph drawn into a texture, is the food of the Grow toward a picture slime.
 * Listed in the Passes folder after Passes 9.
 *
 * Every node carries a plain-language comment saying what it does and why it is there; an
 * Expression Block's comment explains each named line.
 */
import type { ExampleGraph } from './exampleIndex';
import type { GraphNode } from '../types/nodeGraph';
import { n, play } from './graphBuilder';
import { expr, note } from './agentExampleKit';
import { growPictureNodes } from './agentExamplesP3';

export const PASS_EXAMPLE_INDEX_TEXTURE: Record<string, { label: string; description: string; play: true }> = {
  passShaderTextureFood: {
    label: 'Passes 10 · A Shader Texture feeds the slime', play: true,
    description: 'A Shader Texture makes a new texture from a graph of its own: rings of noisy light, drawn once into a 512 × 512 texture and kept (Update: On change). It is the slime\'s food: walkers are born on the bright rings and smell them through their trail, so the veins grow into rings. Open the Shader Texture to change its graph; the texture is drawn again only when you do.',
  },
};

/** The Shader Texture: UV → noise → rings, into Texture Output. Inner ids are its own. */
function ringsTexture(x: number, y: number): GraphNode {
  const uv = n('uv', 'stUv', 0, 160, note(['UV: this texel\'s place in the texture: −1 to 1 across its own square, whatever the picture\'s shape.']));
  const noise = n('fbm', 'stNoise', 300, 300, { scale: 2.5, octaves: 4, ...note([
    'Fractal noise read at UV, 0 to 1. It wobbles the rings below so they aren\'t perfect circles.',
    'Time isn\'t wired, so the texture is drawn once and costs nothing per frame after that.',
  ]) }, { uv: ['stUv', 'uv'] });
  const rings = expr('stRings', 600, 160, {
    label: 'Rings of food',
    inputs: [{ name: 'uv', type: 'vec2' }, { name: 'n', type: 'float' }, { name: 'count', type: 'float', slider: { min: 2, max: 40 } }],
    values: { count: 14 },
    lines: [
      ['float d', 'length(uv)'],
      ['float wave', '0.5 + 0.5 * sin(d * count + n * 7.0)'],
      ['float ring', 'pow(wave, 6.0) * smoothstep(1.05, 0.7, d)'],
    ],
    result: 'mix(vec3(0.25, 0.65, 1.0), vec3(1.0, 0.75, 0.35), n) * ring * 1.6',
    outputType: 'vec3',
    wires: { uv: ['stUv', 'uv'], n: ['stNoise', 'value'] },
    note: [
      'Rings of food (an Expression Block): bright rings round the centre, bent by the noise, coloured blue to amber.',
      'd: how far this texel is from the centre.',
      'wave: a ripple outward, Count ripples across, shifted by the noise so the rings wander.',
      'ring: the ripple squeezed into thin bright lines (power 6), fading out towards the corners.',
      'Result: the rings in a colour picked by the noise. Bright parts are food for the slime.',
    ],
  });
  const out = n('shaderTextureOutput', 'stOut', 900, 160, { _groupOriginal: true, ...note(['Texture Output: what is wired here is drawn into the texture.']) }, { color: ['stRings', 'result'] });
  return n('shaderTexture', 'stFood', x, y, {
    label: 'Food rings', size: '512', update: 'change', wrap: 'clamp', starter: 'custom',
    subgraph: { nodes: [uv, noise, rings, out], inputPorts: [], outputPorts: [] },
    ...note([
      'Shader Texture: a texture made by its own graph (double-click to open it: UV → noise → rings → Texture Output).',
      'Resolution 512 × 512, Update On change: drawn once, and again only when you change something inside. Its Color feeds Food and the look.',
    ]),
  });
}

export function buildPassExamplesTexture(): Record<string, ExampleGraph> {
  const nodes = growPictureNodes(0, 200).filter(nd => !['gpUv', 'gpMoon', 'gpTex', 'gpPic'].includes(nd.id));
  const byId = new Map(nodes.map(nd => [nd.id, nd]));
  const set = (id: string, input: string, from: [string, string]) => {
    const nd = byId.get(id)!;
    nd.inputs = { ...nd.inputs, [input]: { ...nd.inputs[input], connection: { nodeId: from[0], outputKey: from[1] } } };
  };
  const renote = (id: string, text: string[]) => { const nd = byId.get(id)!; nd.params = { ...nd.params, ...note(text) }; };
  const food = byId.get('gpFood')!;
  const tex = ringsTexture(food.position.x - 420, food.position.y);
  set('gpFood', 'c', ['stFood', 'color']);
  set('gpLook', 'c', ['stFood', 'color']);
  renote('gpFood', [
    'Food (an Expression Block): how much there is to eat here: the Shader Texture\'s rings.',
    'bright: the texture\'s brightness here. Result: bright² × 2, so the bright rings feed far more than the dark gaps.',
    'It goes into Emit\'s Where ƒ (walkers are born on the rings) and, through Food to trail, into the Trail field.',
  ]);
  renote('gpLook', [
    'Veins in the rings\' colours (an Expression Block): the slime is coloured by the texture it feeds on.',
    'tint: the texture\'s hue at full brightness, mixed with a warm white so dark parts still show.',
    'bright: the texture\'s brightness here. veins: the trail\'s Amount in that tint, brighter on the rings.',
    'Result: the veins over a faint ghost of the rings (5%).',
  ]);
  renote('gpEmit', ['Emit, Shape Field: every walker is born where Food (wired into Where ƒ) is above Threshold (0.15): on the Shader Texture\'s rings.']);
  return {
    passShaderTextureFood: {
      ...PASS_EXAMPLE_INDEX_TEXTURE.passShaderTextureFood,
      counter: 60,
      nodes: [...nodes, tex],
      play: play([], `**What it shows.** A **Shader Texture**: a node that makes a new texture from a shader graph of its own, here the food of a slime. "Load a texture" is the Texture node; "Create a new texture" is this.

**How it is built.** Inside *Food rings* (double-click it): UV → Fractal noise → *Rings of food* → Texture Output, drawn into a 512 × 512 texture. Its Color goes into Food, which feeds Emit (walkers are born on the rings) and the Trail field's Add (the rings always smell), and into the look. It is drawn once and kept: Update On change draws it again only when something inside changes.

**Try.** Open *Food rings* and change Count on *Rings of food*: the texture is drawn again and the slime regrows along the new rings. On its card, Start from Stripes or Circles for other food, or set Update to Every frame and wire Time into the noise for moving food.`),
    },
  };
}
