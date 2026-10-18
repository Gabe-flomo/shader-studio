/**
 * Chromatic Aberration (lens): a lens's colour fringing on a texture, made the way a lens makes it.
 * Spectral (the default) reads the picture at up to 16 taps across the spectrum, each shifted by its
 * wavelength and weighed by a spectral → RGB table that adds up to white, so edges fringe in smooth
 * rainbow gradients instead of three hard-edged copies; Channel split is the clean stylised red/blue
 * split. Lateral (radial from a Centre, growing to the edges, with a per-colour Distortion), Axial (a
 * coloured defocus halo round highlights) or Directional (a prism). Blur softens each colour by how far
 * it moved. One pass; the maths is play/kit/chroma.js, shared with the builders and Play's Finish.
 *
 * The older RGB Split (texture) (chromaTexture) is this node's Channel split with Blur 0 now (NODE_ALIASES).
 * See docs/chromatic-aberration.md.
 */
import type { GraphNode, NodeDefinition } from '../../types/nodeGraph';
import { p, withParamSockets } from './helpers';
import { passPxUniform, texUv } from './passes';
import { CA_BASE_GLSL, CA_GLSL2, CA_TAPS } from '../../play/kit/chroma.js';

/** The sliders a wire can drive (#829). */
export const CA_SOCKETS = ['amount', 'samples', 'blur', 'falloff', 'centerX', 'centerY', 'angle', 'distortion'] as const;

const LOOK_HELP = 'Spectral: the picture read at many taps across the spectrum, red to violet, each shifted by its wavelength and weighed so they add up to white: edges fringe in a smooth rainbow, the way glass bends light. Channel split: red and blue copies pushed apart and green left where it is: a clean, graphic RGB split (an old video signal, a misregistered print).';
const GEOMETRY_HELP = 'Lateral: each colour is magnified a little differently, so the fringes run outward from the Centre and grow toward the edges (how most lenses show it). Axial: each colour focuses at a slightly different depth, so instead of moving, red and violet go soft: a coloured halo round highlights. Directional: every pixel spread the same way, along Angle, like light through a prism.';

const paramDefs: NodeDefinition['paramDefs'] = {
  mode: { label: 'Look', type: 'select', hint: 'Spectral: smooth rainbow fringes (many taps across the spectrum). Channel split: red and blue copies, green still.', help: LOOK_HELP, options: [
    { value: 'spectral', label: 'Spectral' }, { value: 'split', label: 'Channel split' },
  ] },
  geometry: { label: 'Geometry', type: 'select', hint: 'Lateral: outward from the Centre, growing to the edges. Axial: a coloured defocus halo round highlights. Directional: a prism, along Angle.', help: GEOMETRY_HELP, options: [
    { value: 'lateral', label: 'Lateral (lens)' }, { value: 'axial', label: 'Axial (halo)' }, { value: 'directional', label: 'Directional (prism)' },
  ] },
  amount: { label: 'Amount', type: 'float', min: 0, max: 40, step: 0.25, hint: 'How far the colours move, in picture pixels: red one way, blue the other (at the frame\'s top and bottom edge for Lateral; the defocus for Axial). 2–6 is subtle; 20 is broken glass.' },
  samples: { label: 'Samples', type: 'float', min: 3, max: 16, step: 1, showWhen: { param: 'mode', value: 'spectral' }, hint: 'Spectral: taps across the spectrum. More is a smoother rainbow and slower; 12 is plenty below 20 pixels.' },
  blur: { label: 'Blur', type: 'float', min: 0, max: 2, step: 0.01, hint: 'Dispersion blur: each colour softened by how far it moved, so the fringe melts into the picture and green stays sharp. 0 is crisp.' },
  falloff: { label: 'Falloff', type: 'float', min: 0, max: 3, step: 0.05, showWhen: { param: 'geometry', value: 'lateral' }, hint: 'How the fringes grow from the Centre to the edges: 0 the same everywhere, 1 in step with the distance, 2 only near the edges.' },
  centerX: { label: 'Centre X', type: 'float', min: -2, max: 2, step: 0.01, showWhen: { param: 'geometry', value: ['lateral', 'axial'] }, hint: 'The lens\'s centre, across, in picture coordinates (0 the middle). Wire Centre instead to follow a point (Mouse UV).' },
  centerY: { label: 'Centre Y', type: 'float', min: -1, max: 1, step: 0.01, showWhen: { param: 'geometry', value: ['lateral', 'axial'] }, hint: 'The lens\'s centre, up and down (0 the middle, 1 the top).' },
  angle: { label: 'Angle', type: 'float', min: -180, max: 180, step: 1, showWhen: { param: 'geometry', value: 'directional' }, hint: 'Which way red goes, in degrees: 0 right, 90 up. Blue goes the other way.' },
  distortion: { label: 'Distortion', type: 'float', min: -1, max: 1, step: 0.01, hint: 'Bends each colour differently, growing with the square of the distance from the Centre: above 0 red bulges outward and violet in (a barrel per colour), below 0 the other way. 0 is off.' },
};

const defaultParams = { mode: 'spectral', geometry: 'lateral', amount: 4, samples: CA_TAPS, blur: 0.3, falloff: 1, centerX: 0, centerY: 0, angle: 0, distortion: 0 };

export const caModeNum = (v: unknown) => (v === 'split' ? 1 : 0);
export const caGeomNum = (v: unknown) => (v === 'axial' ? 1 : v === 'directional' ? 2 : 0);

export const ChromaLensNode: NodeDefinition = withParamSockets({
  type: 'chromaLens',
  label: 'Chromatic Aberration (lens)',
  category: 'Texture tools',
  aliases: ['Chromatic aberration', 'Chroma', 'Spectral aberration', 'Colour fringe', 'Color fringe', 'Lens fringe', 'Prism', 'Dispersion', 'RGB split', 'RGB shift', 'Rainbow fringe'],
  description: 'A lens\'s colour fringing on a texture (a Pass, a Shader Texture, a picture). Spectral reads the picture at up to 16 taps across the spectrum, each shifted by its wavelength and weighed so they add up to white: smooth rainbow fringes, not three copies. Channel split is the clean red/blue split. Lateral fringes outward from a Centre (growing to the edges); Axial gives highlights a coloured defocus halo; Directional is a prism. Blur softens each colour by how far it moved. Amount is in picture pixels. One pass.',
  inputs: {
    texture: { type: 'texture', label: 'Texture', hint: 'A Pass\'s Texture (or a Shader Texture, a picture). Unwired, this reads black.' },
    uv: { type: 'vec2', label: 'UV', hint: 'Where to read, in picture coordinates. Leave empty for this pixel; wire a warp to bend the read.' },
    center: { type: 'vec2', label: 'Centre', hint: 'The lens\'s centre, in picture coordinates (Mouse UV, a UV-space point). Unwired: Centre X / Y.' },
  },
  outputs: {
    color: { type: 'vec3', label: 'Color', hint: 'The picture with its colours fringed.' },
    alpha: { type: 'float', label: 'Alpha' },
  },
  defaultParams,
  paramDefs,
  glslFunctions: [CA_BASE_GLSL, CA_GLSL2],
  assignable: false,
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const P = node.params;
    const tex = inputVars.texture;
    if (!tex) return { code: `    vec4 ${id}_o = vec4(0.0);\n`, outputVars: { color: `${id}_o.rgb`, alpha: `${id}_o.a` } };
    const centre = inputVars.center ?? `vec2(${p(P.centerX, 0)}, ${p(P.centerY, 0)})`;
    const code = [
      `    vec2 ${id}_uv = ${texUv(inputVars.uv ?? 'g_uv')};\n`,
      `    vec2 ${id}_c = ${texUv(centre)};\n`,
      `    vec4 ${id}_o = caRead(${tex}, ${id}_uv, ${id}_c, ${passPxUniform(tex)}, u_resolution.x / u_resolution.y, ${caModeNum(P.mode)}.0, ${caGeomNum(P.geometry)}.0, ${p(P.amount, 4)}, ${p(P.samples, CA_TAPS)}, ${p(P.blur, 0.3)}, ${p(P.falloff, 1)}, (${p(P.angle, 0)}) * 0.01745329, ${p(P.distortion, 0)}, caIGN(gl_FragCoord.xy));\n`,
    ].join('');
    return { code, outputVars: { color: `${id}_o.rgb`, alpha: `${id}_o.a` } };
  },
}, CA_SOCKETS);
