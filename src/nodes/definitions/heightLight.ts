/**
 * Height Light (docs/height-light.md): shades any height map as terrain lit by a sun. Hillshade in a map
 * tool, Bump → Diffuse in Blender, Bevel & Emboss in After Effects, Normal Map + Phong in TouchDesigner.
 *
 * The height is either a texture (a Trail field's Image, a Depth map, a Pass, a picture: one channel, or its
 * brightness) or any float field wired into Height ƒ (noise, an SDF, a Grid Rules wave): the node reads it a
 * little to each side of this pixel, so it knows the slope. From the slope, a normal; from the normal and the
 * sun, a shade. The surface colour runs from Low to High colour by the height (Range sets which heights are low
 * and high), or comes from a wired Colour (a palette, a picture).
 */
import type { GraphNode, NodeDefinition } from '../../types/nodeGraph';
import { fieldFn, p, pv3, withParamSockets } from './helpers';
import { passPxUniform, texUv } from './passes';
import { TEXTURE_TOOLS_CATEGORY } from './textureTools';

const LUMA = 'vec3(0.299, 0.587, 0.114)';
type Channel = '1' | '2' | '3' | '4' | 'bright';
const channelOf = (n: GraphNode): Channel => (['1', '2', '3', '4', 'bright'].includes(String(n.params.channel)) ? String(n.params.channel) as Channel : '1');
const pick = (c: Channel, s: string) => (c === 'bright' ? `dot((${s}).rgb, ${LUMA})` : `(${s}).${'rgba'[Number(c) - 1]}`);

export const HeightLightNode: NodeDefinition = withParamSockets({
  type: 'heightLight',
  label: 'Height Light',
  category: TEXTURE_TOOLS_CATEGORY,
  aliases: ['Hillshade', 'Light a height map', 'Terrain shading', 'Relief', 'Bump', 'Emboss', 'Bevel', 'Normal map', 'Shade height', 'Light the trail', 'Dunes'],
  description: 'Lights a height map like terrain under a sun: a Trail (sand, chips), a Depth map, noise, an SDF, any float field or texture. It finds the slope at each pixel and shades it, the surface coloured from Low to High by height (or by a wired Colour). Color is the lit surface; Shade the light alone; Normal and Slope for your own lighting.',
  inputs: {
    texture: { type: 'texture', label: 'Texture', hint: 'The height as a texture: a Trail field\'s Image, a Depth map, a Pass, a picture. Channel picks which part is the height.' },
    height: { type: 'float', label: 'Height ƒ', field: true, hint: 'The height as any float: noise, an SDF\'s Distance, a wave. Read a little to each side of this pixel for the slope. Wins over Texture.' },
    colour: { type: 'vec3', label: 'Colour', hint: 'The surface\'s own colour (a palette, a picture). Unwired: Low to High colour by height.' },
    uv: { type: 'vec2', label: 'UV', hint: 'Where to read, in picture coordinates. Empty: this pixel.' },
  },
  outputs: {
    color: { type: 'vec3', label: 'Color', hint: 'The surface, lit.' },
    shade: { type: 'float', label: 'Shade', hint: 'The light alone, 0 (facing away from the sun) to 1 (facing it): multiply your own colours by it.' },
    height: { type: 'float', label: 'Height', hint: 'The height here, 0 at Range low, 1 at Range high.' },
    normal: { type: 'vec3', label: 'Normal', hint: 'Which way the surface faces (x across, y up the picture, z out of the screen).' },
    slope: { type: 'vec2', label: 'Slope', hint: 'Which way the height rises, and how fast (picture units).' },
  },
  defaultParams: {
    channel: '1', low: 0, high: 1, relief: 0.08, spacing: 1.5,
    sunAngle: 135, sunHeight: 35, ambient: 0.3,
    lowColour: [0.36, 0.22, 0.12], highColour: [0.96, 0.8, 0.52],
  },
  paramDefs: {
    channel: { label: 'Channel', type: 'select', section: 'Height', hint: 'Which channel of the Texture is the height (a Trail field\'s channels are 1–4), or its brightness.', options: [
      { value: '1', label: 'Channel 1' }, { value: '2', label: 'Channel 2' }, { value: '3', label: 'Channel 3' }, { value: '4', label: 'Channel 4' }, { value: 'bright', label: 'Brightness' },
    ], channelsFrom: ['texture'] },
    low: { label: 'Range low', type: 'float', min: -10, max: 10, step: 0.01, section: 'Height', hint: 'The height that counts as lowest (Low colour, Height 0). Typing beyond the slider widens it.' },
    high: { label: 'Range high', type: 'float', min: -10, max: 10, step: 0.01, section: 'Height', hint: 'The height that counts as highest (High colour, Height 1). A Trail of sand might reach 5 or 10.' },
    relief: { label: 'Relief', type: 'float', min: 0, max: 1, step: 0.001, section: 'Height', hint: 'How tall the highest point stands, in picture units (the picture is 2 tall): more is steeper slopes, deeper shadows.' },
    spacing: { label: 'Spacing', type: 'float', min: 0.5, max: 8, step: 0.25, section: 'Height', hint: 'How far to each side the slope is read, in pixels: wider is smoother, softer light.' },
    sunAngle: { label: 'Sun from', type: 'float', min: 0, max: 360, step: 1, section: 'Sun', hint: 'Which way the light comes from, in degrees: 0 from the right, 90 from the top, 180 from the left.' },
    sunHeight: { label: 'Sun height', type: 'float', min: 1, max: 90, step: 1, section: 'Sun', hint: 'How high the sun is, in degrees: low sun (10–30) rakes across and shows every ripple; 90 is straight overhead.' },
    ambient: { label: 'Ambient', type: 'float', min: 0, max: 1, step: 0.01, section: 'Sun', hint: 'Light that reaches the shadows too (sky light): 0 is black shadows.' },
    lowColour: { label: 'Low colour', type: 'vec3color', section: 'Colour', hint: 'The colour at Range low (unless Colour is wired).' },
    highColour: { label: 'High colour', type: 'vec3color', section: 'Colour', hint: 'The colour at Range high (unless Colour is wired).' },
  },
  generateGLSL: (node: GraphNode, v) => {
    const id = node.id;
    const P = node.params;
    const fn = fieldFn(v.height);
    const tex = v.texture;
    const outs = { color: `${id}_c`, shade: `${id}_s`, height: `${id}_h`, normal: `${id}_n`, slope: `${id}_g` };
    if (!fn && !tex) {
      return {
        code: `    vec3 ${id}_c = vec3(0.0); float ${id}_s = 0.0; float ${id}_h = 0.0; vec3 ${id}_n = vec3(0.0, 0.0, 1.0); vec2 ${id}_g = vec2(0.0);\n`,
        outputVars: outs,
      };
    }
    const lo = p(P.low, 0), hi = p(P.high, 1);
    const norm = (raw: string) => `((${raw} - ${lo}) / max(${hi} - ${lo}, 1e-5))`;
    const lines: string[] = [];
    let at: (dx: string, dy: string) => string;
    if (fn) {
      // A field: read at picture positions, Spacing pixels apart.
      lines.push(
        `    vec2 ${id}_q = ${v.uv ?? 'g_uv'};\n`,
        `    vec2 ${id}_e = vec2(2.0 / u_resolution.y * ${p(P.spacing, 1.5)});\n`,
      );
      at = (dx, dy) => norm(`${fn}(${id}_q + vec2(${dx}, ${dy}) * ${id}_e, vec2(0.0), 1.0, 0.0)`);
    } else {
      // A texture: read Spacing of its own pixels apart; one of its pixels is 2 × px.y picture units tall.
      lines.push(
        `    vec2 ${id}_st = ${texUv(v.uv ?? 'g_uv')};\n`,
        `    vec2 ${id}_px = ${passPxUniform(tex!)} * ${p(P.spacing, 1.5)};\n`,
        `    vec2 ${id}_e = vec2(2.0 * ${id}_px.y);\n`,
      );
      at = (dx, dy) => norm(pick(channelOf(node), `texture2D(${tex}, ${id}_st + vec2(${dx}, ${dy}) * ${id}_px)`));
    }
    const sa = `radians(${p(P.sunAngle, 135)})`, sh = `radians(${p(P.sunHeight, 35)})`;
    lines.push(
      `    float ${id}_h = ${at('0.0', '0.0')};\n`,
      // The slope, in height (× Relief, picture units) per picture unit across and up.
      `    vec2 ${id}_g = vec2(${at('1.0', '0.0')} - ${at('-1.0', '0.0')}, ${at('0.0', '1.0')} - ${at('0.0', '-1.0')}) * ${p(P.relief, 0.08)} / (2.0 * ${id}_e);\n`,
      `    vec3 ${id}_n = normalize(vec3(-${id}_g, 1.0));\n`,
      `    vec3 ${id}_sun = vec3(cos(${sa}) * cos(${sh}), sin(${sa}) * cos(${sh}), sin(${sh}));\n`,
      `    float ${id}_s = clamp(dot(${id}_n, ${id}_sun), 0.0, 1.0);\n`,
      `    vec3 ${id}_surf = ${v.colour ?? `mix(${pv3(P.lowColour, [0.36, 0.22, 0.12])}, ${pv3(P.highColour, [0.96, 0.8, 0.52])}, clamp(${id}_h, 0.0, 1.0))`};\n`,
      `    vec3 ${id}_c = ${id}_surf * (${p(P.ambient, 0.3)} + (1.0 - ${p(P.ambient, 0.3)}) * ${id}_s);\n`,
    );
    return { code: lines.join(''), outputVars: outs };
  },
}, ['low', 'high', 'relief', 'sunAngle', 'sunHeight', 'ambient']);
