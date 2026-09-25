/**
 * Layers — what the Play page's layers draw, as a texture the shader can use:
 * their colour, their alpha, and a signed distance to them. Wire Distance
 * into SDF Glow and particles, text, brush strokes and falling letters glow;
 * blur, refract or feed back the Color like any texture.
 *
 * The layer kit renders the layers after the shader, so the node reads the
 * previous frame (1/60 s behind). Distance is in the graph's UV units (a
 * picture height is 2), negative inside a shape, like the SDF nodes. Which
 * layers it sees is each layer's "Seen by the Layers node" switch.
 *
 * The uniforms are shared by every Layers node; the app (play/overlay.ts →
 * ShaderCanvas) and the web runtime bind them.
 */
import type { GraphNode, NodeDefinition } from '../../types/nodeGraph';

export const LAYERS_GLSL = `uniform sampler2D u_layers;
uniform sampler2D u_layersField;
uniform vec2 u_layersFieldSize;
vec2 ssl_screen(vec2 uv) { return vec2(uv.x * u_resolution.y / u_resolution.x, uv.y) * 0.5 + 0.5; }
float ssl_decode(vec4 c) { return ((c.r * 255.0 * 256.0 + c.g * 255.0) / 65535.0 - 0.5) * 4.0; }
float ssl_distance(vec2 uv) {
  if (u_layersFieldSize.x < 1.0) return 4.0;
  vec2 s = ssl_screen(uv);
  vec2 p = vec2(s.x, 1.0 - s.y) * u_layersFieldSize - 0.5;
  vec2 i0 = clamp(floor(p), vec2(0.0), u_layersFieldSize - 1.0);
  vec2 i1 = min(i0 + 1.0, u_layersFieldSize - 1.0);
  vec2 f = clamp(p - i0, 0.0, 1.0);
  float a = ssl_decode(texture2D(u_layersField, (vec2(i0.x, i0.y) + 0.5) / u_layersFieldSize));
  float b = ssl_decode(texture2D(u_layersField, (vec2(i1.x, i0.y) + 0.5) / u_layersFieldSize));
  float c = ssl_decode(texture2D(u_layersField, (vec2(i0.x, i1.y) + 0.5) / u_layersFieldSize));
  float d = ssl_decode(texture2D(u_layersField, (vec2(i1.x, i1.y) + 0.5) / u_layersFieldSize));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}`;

export const PlayLayersNode: NodeDefinition = {
  type: 'playLayers',
  label: 'Layers',
  category: 'Sources',
  aliases: ['Play layers', 'Particles texture', 'Overlay', 'Layer distance'],
  description: 'What the Play page\'s layers draw (particles, text, shapes, brush strokes, falling letters…) as a texture: Color, Alpha, and Distance, a signed distance to them in UV units. Wire Distance into SDF Glow to make the layers glow, or use Color and Alpha like any image. It reads the previous frame.',
  inputs: {
    uv: { type: 'vec2', label: 'UV', hint: 'Where to read (the UV node\'s centred coordinates). Unwired: this pixel.' },
  },
  outputs: {
    color: { type: 'vec3', label: 'Color', hint: 'The layers\' colour (not premultiplied).' },
    alpha: { type: 'float', label: 'Alpha', hint: '1 where layers are drawn, 0 where they are not.' },
    distance: { type: 'float', label: 'Distance', hint: 'Signed distance to the layers in UV units: negative inside, 0 on an edge. Feed it to SDF Glow or SDF Fill.' },
  },
  defaultParams: {},
  glslFunction: LAYERS_GLSL,
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const uv = inputVars.uv ?? 'g_uv';
    return {
      code: [
        `    vec4 ${id}_sample = texture2D(u_layers, clamp(ssl_screen(${uv}), 0.0, 1.0));\n`,
        `    vec3 ${id}_color = ${id}_sample.rgb;\n`,
        `    float ${id}_alpha = ${id}_sample.a;\n`,
        `    float ${id}_distance = ssl_distance(${uv});\n`,
      ].join(''),
      outputVars: { color: `${id}_color`, alpha: `${id}_alpha`, distance: `${id}_distance` },
    };
  },
};
