import { getNodeDefinition } from '../../nodes/definitions';

/**
 * Quick adds: new nodes worth offering next to a clicked socket, beside the
 * nodes already on the canvas (see smartConnect.ts).
 *
 * The rules are the combos people reach for again and again:
 *   - a float input is most often driven by Time, an LFO (time through a sine) or a slider;
 *   - a vec2 input is nearly always the UV, sometimes the mouse or a fixed point;
 *   - a vec3 input in a 2D graph is a colour, so Palette / Make Vec3 / Color Ramp;
 *   - a float *output* that is a distance wants an SDF colourer or a glow, any other
 *     float wants turning into a colour;
 *   - a vec2 output is a UV looking for a shape or a noise;
 *   - a vec3 output is a colour looking for a grade or a blend.
 * The socket's label refines the pick (a "Time" input offers BPM Sync, a "Center" input
 * offers the mouse), and so does the node it is on: a Texture tools number goes to colour
 * (Palette, Color Ramp, Mix), a Jump flood distance to Outline (distance), a glow or an
 * outline's light to the layering nodes (Add Colors, Blend Modes), and a texture output to the
 * Texture tools (docs/texture-tools.md). Each rule wires exactly one socket on the new node; the rest keep
 * their defaults so the new node does something visible immediately.
 */
export interface QuickAdd {
  /** Node type to add */
  type: string;
  /** Display label, from the definition */
  label: string;
  /** Socket on the new node to wire (an output when feeding an input, an input otherwise) */
  key: string;
  socketLabel: string;
  type_: string;
  /** Why it is offered, one short clause */
  note: string;
}

export const MAX_QUICK_ADDS = 3;

type Rule = [type: string, key: string, note: string];

const has = (text: string, ...words: string[]) => words.some(w => text.includes(w));

/** Rules for feeding the clicked input. */
function feedRules(type: string, text: string): Rule[] {
  switch (type) {
    case 'float':
      if (has(text, 'time', 'speed', 'phase')) return [['time', 'time', 'the clock'], ['bpmSync', 'phase', 'beat-locked 0–1'], ['lfo', 'value', 'time through a wave']];
      if (has(text, 'angle', 'rot', 'twist', 'spin')) return [['time', 'time', 'keeps turning'], ['lfo', 'value', 'swings back and forth'], ['mouse', 'x', 'follow the pointer']];
      return [['time', 'time', 'animate it'], ['lfo', 'value', 'time through a wave'], ['constant', 'value', 'a slider of its own']];
    case 'vec2':
      if (has(text, 'center', 'centre', 'offset', 'translate', 'shift')) return [['mouse', 'uv', 'follow the pointer'], ['vec2Const', 'val', 'a fixed point'], ['uv', 'uv', 'per-pixel']];
      return [['uv', 'uv', 'the screen'], ['pixelUV', 'uv', 'pixel-square screen'], ['mouse', 'uv', 'follow the pointer']];
    case 'texture':
      return [['pass', 'texture', 'draw a picture into a texture'], ['textureInput', 'texture', 'an image'], ['videoInput', 'texture', 'a video or the camera']];
    case 'vec3':
    case 'vec4':
      if (has(text, 'pos', 'normal', 'dir')) return [];
      return [['colorPicker', 'rgb', 'pick a colour'], ['palette', 'color', 'cosine colours'], ['colorRamp', 'color', 'a gradient of stops']];
    default:
      return [];
  }
}

/** Texture tools whose number outputs are masks or shaped values: colour them first. */
const SHAPED_NUMBER_NODES = new Set(['textureMask', 'textureLevels', 'textureNeighbours', 'textureChange', 'distanceShape']);
/** Nodes whose colour output is light to lay over a picture. */
const LIGHT_NODES = new Set(['distanceShape', 'glowTexture']);

/** Rules for using the clicked output. */
function consumeRules(type: string, text: string, nodeType?: string): Rule[] {
  if (type === 'float' && nodeType === 'jumpFloodTexture') return [['distanceShape', 'distance', 'outline, glow or rings'], ['palette', 'value', 'as a colour'], ['textureLevels', 'value', 'shape the distance']];
  if (type === 'float' && nodeType && SHAPED_NUMBER_NODES.has(nodeType)) return [['palette', 'value', 'as a colour'], ['colorRamp', 't', 'through a gradient'], ['mix', 't', 'blend two things by it']];
  if (type === 'vec3' && nodeType && LIGHT_NODES.has(nodeType)) return [['addColor', 'b', 'add it over a picture'], ['blendModes', 'blend', 'screen it over a picture'], ['brightnessContrast', 'color', 'grade it']];
  switch (type) {
    case 'texture':
      return [['textureMask', 'texture', 'a mask from it'], ['textureLevels', 'texture', 'shape its values'], ['textureFlow', 'texture', 'a flow from its slopes']];
    case 'float':
      if (has(text, 'dist', 'sdf', 'field', 'shape')) return [['sdfFill', 'd', 'fill and stroke'], ['glowLayer', 'd', 'glow around the edge'], ['sdfColorize', 'd', 'inside / outside colours']];
      return [['floatToVec3', 'input', 'as a grey'], ['palette', 'value', 'as a colour'], ['colorRamp', 't', 'through a gradient']];
    case 'vec2':
      return [['circleSDF', 'position', 'a shape in this space'], ['fbm', 'uv', 'noise in this space'], ['gradient', 'uv', 'a gradient across it']];
    case 'vec3':
      return [['brightnessContrast', 'color', 'grade it'], ['vignette', 'color', 'darken the edges'], ['blendModes', 'base', 'blend with another']];
    default:
      return [];
  }
}

export function suggestQuickAdds(opts: {
  /** The clicked socket's type */
  type: string;
  /** 'in' = feed this input, 'out' = use this output */
  dir: 'in' | 'out';
  /** Socket label and key, used to refine the pick */
  label?: string;
  key?: string;
  /** The type of the node the socket is on, which refines the pick too */
  nodeType?: string;
}): QuickAdd[] {
  const text = `${opts.label ?? ''} ${opts.key ?? ''}`.toLowerCase();
  const rules = opts.dir === 'in' ? feedRules(opts.type, text) : consumeRules(opts.type, text, opts.nodeType);
  const out: QuickAdd[] = [];
  for (const [type, key, note] of rules) {
    const def = getNodeDefinition(type);
    if (!def) continue;
    const socket = opts.dir === 'in' ? def.outputs[key] : def.inputs[key];
    if (!socket) continue;
    out.push({ type, label: def.label, key, socketLabel: socket.label, type_: socket.type, note });
    if (out.length >= MAX_QUICK_ADDS) break;
  }
  return out;
}
