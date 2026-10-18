/**
 * Show data (docs/show-data.md): a viewer for data, so you can see what a number, a direction or four channels
 * hold before deciding what to do with them. Blender's viewer node and false colour, TouchDesigner's
 * Analyze / Info view.
 *
 * Heat: any number as false colour (the Turbo map, blue → green → yellow → red), Low and High setting which
 * numbers are blue and red; outside them, darker blue or white flags it. Direction: a vector as a hue round the
 * colour wheel (which way it points) and brightness (how long, × Scale). Channels: four channels side by side
 * in a 2 × 2 grid, each as heat (a texture is shown whole in every quarter; Channels, read here, shows the
 * quarter of the picture it falls in).
 */
import type { GraphNode, NodeDefinition } from '../../types/nodeGraph';
import { p, withParamSockets } from './helpers';
import { texUv } from './passes';
import { TEXTURE_TOOLS_CATEGORY } from './textureTools';

/** Google's Turbo colour map (Mikhailov 2019), the polynomial fit: x 0 → 1 runs blue, cyan, green, yellow, red. */
export const TURBO_GLSL = `
vec3 sdTurbo(float x) {
    x = clamp(x, 0.0, 1.0);
    vec4 v4 = vec4(1.0, x, x * x, x * x * x);
    vec2 v2 = v4.zw * v4.z;
    return vec3(
        dot(v4, vec4(0.13572138, 4.61539260, -42.66032258, 132.13108234)) + dot(v2, vec2(-152.94239396, 59.28637943)),
        dot(v4, vec4(0.09140261, 2.19418839, 4.84296658, -14.18503333)) + dot(v2, vec2(4.27729857, 2.82956604)),
        dot(v4, vec4(0.10667330, 12.64194608, -60.58204836, 110.36276771)) + dot(v2, vec2(-89.90310912, 27.34824973)));
}`;

type Mode = 'heat' | 'direction' | 'channels';
/** What it shows: as chosen, or by what is wired (a vector → Direction, four channels or a texture → Channels). */
export function showDataMode(node: GraphNode, v: Record<string, string | undefined>): Mode {
  const m = String(node.params.mode ?? 'auto');
  if (m === 'heat' || m === 'direction' || m === 'channels') return m;
  if (v.vector) return 'direction';
  if (v.channels || v.texture) return 'channels';
  return 'heat';
}

export const ShowDataNode: NodeDefinition = withParamSockets({
  type: 'showData',
  label: 'Show Data',
  category: TEXTURE_TOOLS_CATEGORY,
  aliases: ['Show data', 'Viewer', 'False colour', 'False color', 'Heat map', 'Visualise data', 'Debug view', 'Show values', 'Direction colours', 'Show channels', 'Data view'],
  description: 'Shows what data holds, to look at before using it. Heat: any number as false colour (blue low → red high, Low and High set the range). Direction: a vector as a colour (hue is which way it points, brightness how strong). Channels: a texture or four channels side by side in a 2 × 2 grid, each as heat. Wire it to Output while you look.',
  inputs: {
    value: { type: 'float', label: 'Number', hint: 'Any number: a density, a distance, a channel, noise. Shown as Heat.' },
    vector: { type: 'vec2', label: 'Direction', hint: 'Any vec2: a velocity, a slope, Flow\'s direction. Shown as Direction.' },
    channels: { type: 'vec4', label: 'Channels', hint: 'Four channels (a Trail field\'s Channels): each shown as heat in its own quarter.' },
    texture: { type: 'texture', label: 'Texture', hint: 'A texture: its four channels, each shown whole in its own quarter.' },
    uv: { type: 'vec2', label: 'UV', hint: 'Where to read the Texture, in picture coordinates. Empty: this pixel.' },
  },
  outputs: {
    color: { type: 'vec3', label: 'Color', hint: 'The view: wire it to Output.' },
  },
  defaultParams: { mode: 'auto', low: 0, high: 1, scale: 1, flag: true },
  paramDefs: {
    mode: { label: 'Show', type: 'select', hint: 'Auto: by what is wired (a vector shows Direction, Channels or a Texture shows Channels, a number shows Heat).', options: [
      { value: 'auto', label: 'Auto (by what is wired)' }, { value: 'heat', label: 'Heat (a number)' }, { value: 'direction', label: 'Direction (a vector)' }, { value: 'channels', label: 'Channels (2 × 2)' },
    ] },
    low: { label: 'Low', type: 'float', min: -10, max: 10, step: 0.001, hint: 'The number shown dark blue (Heat, Channels). Typing beyond the slider widens it.' },
    high: { label: 'High', type: 'float', min: -10, max: 10, step: 0.001, hint: 'The number shown red. Raise it if everything is red; a Trail of sand reaches about 9.' },
    scale: { label: 'Scale', type: 'float', min: 0, max: 20, step: 0.01, hint: 'Direction: how long a vector shows at full brightness is 1 ÷ Scale.' },
    flag: { label: 'Flag out of range', type: 'bool', hint: 'Heat: numbers below Low shown darker, above High shown white, so you can tell clipped from just low or high.' },
  },
  glslFunctions: [TURBO_GLSL],
  generateGLSL: (node: GraphNode, v) => {
    const id = node.id;
    const P = node.params;
    const lo = p(P.low, 0), hi = p(P.high, 1);
    const t = (x: string) => `((${x} - ${lo}) / (abs(${hi} - ${lo}) < 1e-6 ? 1e-6 : ${hi} - ${lo}))`;
    const heat = (x: string) => P.flag === false
      ? `sdTurbo(${t(x)})`
      : `(${t(x)} > 1.0 ? vec3(1.0) : ${t(x)} < 0.0 ? sdTurbo(0.0) * 0.4 : sdTurbo(${t(x)}))`;
    const mode = showDataMode(node, v);
    const lines: string[] = [];
    if (mode === 'direction') {
      const vec = v.vector ?? 'vec2(0.0)';
      lines.push(
        `    vec2 ${id}_v = ${vec};\n`,
        // Hue: the angle round the colour wheel (right red, up yellow-green, left cyan, down violet).
        `    vec3 ${id}_hue = 0.5 + 0.5 * cos(atan(${id}_v.y, ${id}_v.x) + vec3(0.0, -2.0943951, 2.0943951));\n`,
        `    vec3 ${id}_c = ${id}_hue * clamp(length(${id}_v) * ${p(P.scale, 1)}, 0.0, 1.0);\n`,
      );
    } else if (mode === 'channels') {
      // 2 × 2: channel 1 top left, 2 top right, 3 bottom left, 4 bottom right.
      lines.push(
        `    vec2 ${id}_st = ${texUv(v.uv ?? 'g_uv')};\n`,
        `    vec2 ${id}_cell = step(vec2(0.5), ${id}_st);\n`,
        `    int ${id}_k = int(${id}_cell.x) + 2 * (1 - int(${id}_cell.y));\n`,
        v.texture && !v.channels
          ? `    vec4 ${id}_s = texture2D(${v.texture}, fract(${id}_st * 2.0));\n`
          : `    vec4 ${id}_s = ${v.channels ?? 'vec4(0.0)'};\n`,
        `    float ${id}_x = ${id}_k == 0 ? ${id}_s.r : ${id}_k == 1 ? ${id}_s.g : ${id}_k == 2 ? ${id}_s.b : ${id}_s.a;\n`,
        `    vec2 ${id}_edge = abs(${id}_st - 0.5);\n`,
        `    vec3 ${id}_c = min(${id}_edge.x, ${id}_edge.y) < 0.002 ? vec3(1.0) : ${heat(`${id}_x`)};\n`,
      );
    } else {
      lines.push(`    vec3 ${id}_c = ${heat(v.value ?? '0.0')};\n`);
    }
    return { code: lines.join(''), outputVars: { color: `${id}_c` } };
  },
}, ['low', 'high']);
