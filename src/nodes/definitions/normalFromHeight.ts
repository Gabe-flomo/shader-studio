/**
 * Normal from Height (docs/normal-from-height.md): turns any height (noise, an SDF, a picture's brightness) into
 * the way the surface faces, and lights it with one lamp (Blinn-Phong: soft light plus a shiny highlight), so flat
 * noise looks embossed, like terrain or like water. Bump → Normal in Blender, Normal Map in TouchDesigner.
 *
 * Height ƒ is a field socket: when the wired chain can be a function of position, the node reads it a little to
 * each side of the point (left and right, below and above, Sample distance apart) for an exact slope. When it
 * can't (the chain reads the previous frame, say), the socket hands over the plain value and the node takes the
 * slope from how the value changes to the next pixel on screen (dFdx / dFdy), which is coarser but always there.
 */
import type { GraphNode, NodeDefinition } from '../../types/nodeGraph';
import { fieldFn, p, pv3, withParamSockets } from './helpers';
import { TEXTURE_TOOLS_CATEGORY } from './textureTools';

type Mode = 'lit' | 'normal' | 'slope';
const modeOf = (n: GraphNode): Mode => (['lit', 'normal', 'slope'].includes(String(n.params.mode)) ? String(n.params.mode) as Mode : 'lit');

export const NormalFromHeightNode: NodeDefinition = withParamSockets({
  type: 'normalFromHeight',
  label: 'Normal from Height',
  category: TEXTURE_TOOLS_CATEGORY,
  aliases: ['Bump map', 'Bump', 'Normal map', 'Height to normal', 'Emboss', 'Embossed', 'Relief', 'Surface normal', 'Lit noise', 'Shiny bumps', 'Specular'],
  description: 'Turns any height (noise, an SDF\'s Distance, a picture\'s brightness) into the way the surface faces, and lights it with one lamp, with a shiny highlight, so flat noise looks embossed, like terrain or like water. Normal and Slope for your own lighting; Shaded is the light alone; Colour is the lit surface, or the normal or slope as colour.',
  inputs: {
    height: { type: 'float', label: 'Height ƒ', field: true, fieldOptional: true, hint: 'The height: noise, an SDF\'s Distance, a picture\'s brightness. Read a little to each side for the exact slope; if the chain can\'t be read elsewhere (it reads the previous frame), the slope comes from the next pixel on screen instead.' },
    uv: { type: 'vec2', label: 'UV', hint: 'Where to read the height, in picture coordinates. Empty: this pixel.' },
    colour: { type: 'vec3', label: 'Colour', hint: 'The surface\'s own colour (a palette, a picture), lit by the lamp. Empty: white.' },
  },
  outputs: {
    normal: { type: 'vec3', label: 'Normal', hint: 'Which way the surface faces, length 1 (x across, y up the picture, z out of the screen).' },
    shaded: { type: 'float', label: 'Shaded', hint: 'The light alone, 0 (dark) to 1 (fully lit, highlight included): multiply your own colours by it.' },
    colour: { type: 'vec3', label: 'Colour', hint: 'What Mode picks: the lit surface, the normal as colour, or the slope as colour.' },
    slope: { type: 'vec2', label: 'Slope', hint: 'Which way the height rises, and how fast (height per picture unit, before Strength).' },
  },
  defaultParams: {
    strength: 0.15, distance: 1, invert: false,
    lightAngle: 135, lightHeight: 40, lightColour: [1, 0.97, 0.9],
    ambient: 0.2, specular: 0.35, shininess: 32, mode: 'lit',
  },
  paramDefs: {
    strength: { label: 'Strength', type: 'float', min: 0, max: 2, step: 0.001, section: 'Surface', hint: 'How deep the bumps are: 0 is flat, more is steeper slopes and stronger shading.' },
    distance: { label: 'Sample distance', type: 'float', min: 0.25, max: 16, step: 0.25, section: 'Surface', hint: 'How far to each side the height is read, in pixels: wider is smoother, softer bumps. Only used when the height can be read elsewhere.' },
    invert: { label: 'Invert', type: 'bool', section: 'Surface', hint: 'Swap high and low: bumps become dents.' },
    lightAngle: { label: 'Light from', type: 'float', min: 0, max: 360, step: 0.5, section: 'Light', hint: 'Which way the light comes from, in degrees: 0 from the right, 90 from the top, 180 from the left.' },
    lightHeight: { label: 'Light height', type: 'float', min: 1, max: 90, step: 0.5, section: 'Light', hint: 'How high the lamp is, in degrees: low (10–30) rakes across and shows every bump; 90 is straight in front.' },
    lightColour: { label: 'Light colour', type: 'vec3color', section: 'Light', hint: 'The lamp\'s colour, for the lit side and the highlight.' },
    ambient: { label: 'Ambient', type: 'float', min: 0, max: 1, step: 0.01, section: 'Light', hint: 'Light that reaches the shadows too: 0 is black shadows.' },
    specular: { label: 'Specular', type: 'float', min: 0, max: 2, step: 0.01, section: 'Light', hint: 'How bright the shiny highlight is: 0 is matt (chalk, sand), 1 is glossy (metal, wet).' },
    shininess: { label: 'Shininess', type: 'float', min: 1, max: 256, step: 1, section: 'Light', hint: 'How small and sharp the highlight is: low is a broad sheen, high a tight sparkle.' },
    mode: { label: 'Mode', type: 'select', section: 'Colour', hint: 'What the Colour output shows.', options: [
      { value: 'lit', label: 'Lit surface' },
      { value: 'normal', label: 'Normal as colour' },
      { value: 'slope', label: 'Slope as colour' },
    ] },
  },
  generateGLSL: (node: GraphNode, v) => {
    const id = node.id;
    const P = node.params;
    const fn = fieldFn(v.height);
    const outs = { normal: `${id}_n`, shaded: `${id}_s`, colour: `${id}_c`, slope: `${id}_g` };
    const lines: string[] = [];
    const invert = P.invert === true || P.invert === 'true';
    const sign = invert ? ' * -1.0' : '';
    if (fn) {
      // A field: read the height on four sides of the point, Sample distance pixels away (one pixel is 2 / height
      // of the canvas in picture units), and take the central differences.
      const at = (dx: string, dy: string) => `${fn}(${id}_q + vec2(${dx}, ${dy}), vec2(0.0), 1.0, 0.0)`;
      lines.push(
        `    vec2 ${id}_q = ${v.uv ?? 'g_uv'};\n`,
        `    float ${id}_e = max(${p(P.distance, 1)}, 0.01) * 2.0 / u_resolution.y;\n`,
        `    vec2 ${id}_g = vec2(${at(`${id}_e`, '0.0')} - ${at(`-${id}_e`, '0.0')}, ${at('0.0', `${id}_e`)} - ${at('0.0', `-${id}_e`)}) / (2.0 * ${id}_e)${sign};\n`,
      );
    } else if (v.height) {
      // A plain value: how it changes to the next pixel on screen, per picture unit.
      lines.push(
        `    float ${id}_h = ${v.height};\n`,
        `    vec2 ${id}_g = vec2(dFdx(${id}_h), dFdy(${id}_h)) * (u_resolution.y * 0.5)${sign};\n`,
      );
    } else {
      lines.push(`    vec2 ${id}_g = vec2(0.0);\n`);
    }
    const amb = `(${p(P.ambient, 0.2)})`, str = `(${p(P.strength, 0.15)})`;
    const la = `radians(${p(P.lightAngle, 135)})`, lh = `radians(${p(P.lightHeight, 40)})`;
    const lc = pv3(P.lightColour, [1, 0.97, 0.9]);
    lines.push(
      `    vec3 ${id}_n = normalize(vec3(-${id}_g * ${str}, 1.0));\n`,
      `    vec3 ${id}_l = vec3(cos(${la}) * cos(${lh}), sin(${la}) * cos(${lh}), sin(${lh}));\n`,
      `    float ${id}_d = max(dot(${id}_n, ${id}_l), 0.0);\n`,
      // Blinn-Phong: the highlight is where the normal points halfway between the lamp and the viewer (straight out).
      `    float ${id}_sp = ${id}_d > 0.0 ? pow(max(dot(${id}_n, normalize(${id}_l + vec3(0.0, 0.0, 1.0))), 0.0), max(${p(P.shininess, 32)}, 1.0)) * (${p(P.specular, 0.35)}) : 0.0;\n`,
      `    float ${id}_s = clamp(${amb} + (1.0 - ${amb}) * ${id}_d + ${id}_sp, 0.0, 1.0);\n`,
    );
    const mode = modeOf(node);
    if (mode === 'normal') lines.push(`    vec3 ${id}_c = ${id}_n * 0.5 + 0.5;\n`);
    else if (mode === 'slope') lines.push(`    vec3 ${id}_c = vec3(clamp(${id}_g * ${str} * 0.5 + 0.5, 0.0, 1.0), 0.5);\n`);
    else lines.push(`    vec3 ${id}_c = ${v.colour ?? 'vec3(1.0)'} * (${amb} + (1.0 - ${amb}) * ${id}_d * ${lc}) + ${lc} * ${id}_sp;\n`);
    return { code: lines.join(''), outputVars: outs };
  },
}, ['strength', 'lightAngle', 'lightHeight', 'ambient', 'specular']);
