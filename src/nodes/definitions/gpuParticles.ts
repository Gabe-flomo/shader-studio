/**
 * Particles — up to 4 million particles simulated on the GPU, lit by point
 * lights and glowing, in the picture's own space (TouchDesigner style). Wire
 * a picture into Over and Color comes out with the particles' light added,
 * before the picture is dithered, so it stays smooth and Finish's bloom sees
 * it; Particles is the light alone and Density how many there are.
 *
 * The node writes no simulation itself: it declares a sampler and, in a
 * comment on it, its settings (a number, or the uniform a slider drives). The
 * engine (play/kit/gpuParticles.js) finds that in the compiled shader in the
 * app (play/gpuParticlesTexture.ts → ShaderCanvas) and in the web runtime,
 * steps and draws the particles before each frame, and binds the result.
 * Sliders stay uniforms, so moving one (or mapping it in Play) never
 * recompiles. See docs/gpu-particles-plan.md.
 */
import type { GraphNode, NodeDefinition } from '../../types/nodeGraph';
import { GP_DEFAULTS, GP_MARK } from '../../play/kit/gpuParticles.js';

/** The node's sampler, named by its slug (as its param uniforms are). */
export function gpuParticlesUniform(slug: string): string {
  return `u_gpup_${slug.replace(/_/g, 'x')}`;
}

const opts = (pairs: [string, string][]) => pairs.map(([value, label]) => ({ value, label }));

export const GpuParticlesNode: NodeDefinition = {
  type: 'gpuParticles',
  label: 'Particles',
  category: 'Particles',
  aliases: ['GPU particles', 'Particle system', 'Glow particles', 'TouchDesigner particles', 'Lights', 'Fireflies', 'Sparks'],
  description: 'Hundreds of thousands of particles (up to 4 million) moving on the GPU: born from an emitter, carried by turbulence, swirl and gravity, coloured over their life and lit by glowing point lights. Wire your picture into Over and Color into the output.',
  inputs: {
    over: { type: 'vec3', label: 'Over', hint: 'The picture the particles light up. Unwired: black.' },
    uv: { type: 'vec2', label: 'UV', hint: 'Where to read the particles (the UV node\'s centred coordinates). Unwired: this pixel. Warp it to bend them.' },
  },
  outputs: {
    color: { type: 'vec3', label: 'Color', hint: 'Over with the particles\' light added (brighter than 1 where they pile up).' },
    particles: { type: 'vec3', label: 'Particles', hint: 'The particles\' light alone, with their glow and the lights\' halos.' },
    density: { type: 'float', label: 'Density', hint: 'Roughly how many particles cover this pixel (0 where there are none).' },
  },
  defaultParams: { ...GP_DEFAULTS, lightColor: [...GP_DEFAULTS.lightColor] },
  paramDefs: {
    count: { label: 'Count', type: 'select', hint: 'How many particles. More is denser and finer; 1M and 4M need a fast GPU.', options: opts([['64k', '64 thousand'], ['256k', '256 thousand'], ['1m', '1 million'], ['4m', '4 million']]) },
    emitter: { label: 'Emitter', type: 'select', hint: 'Where particles are born: a point, a line, a ring, a disc, a sphere\'s shell, a ball or a box.', options: opts([['point', 'Point'], ['line', 'Line'], ['ring', 'Ring'], ['disk', 'Disc'], ['sphere', 'Sphere'], ['ball', 'Ball'], ['box', 'Box']]) },
    emit: { label: 'Emit', type: 'select', hint: 'Stream: a steady flow. Burst: all of them at once, again every life.', options: opts([['stream', 'Stream'], ['burst', 'Burst']]) },
    emitSize: { label: 'Emitter size', type: 'float', min: 0, max: 1.5, step: 0.01, hint: 'How big the emitter is, in picture heights / 2.' },
    life: { label: 'Life', type: 'float', min: 0.2, max: 12, step: 0.1, hint: 'How long a particle lives, in seconds (each one a little more or less).' },
    speed: { label: 'Speed', type: 'float', min: 0, max: 1, step: 0.005, hint: 'How fast particles leave the emitter. Negative sends them inwards.' },
    spread: { label: 'Spread', type: 'float', min: 0, max: 1, step: 0.01, hint: '0: straight out of the emitter (up from a point or line). 1: any direction.' },
    gravity: { label: 'Gravity', type: 'float', min: -1, max: 1, step: 0.01, hint: 'Pulls particles down. Negative makes them rise, like sparks or smoke.' },
    turbulence: { label: 'Turbulence', type: 'float', min: 0, max: 3, step: 0.01, hint: 'Curling currents (curl noise) that carry the particles in wisps.' },
    swirl: { label: 'Swirl', type: 'float', min: -2, max: 2, step: 0.01, hint: 'Spins particles round the emitter. Negative turns the other way.' },
    attract: { label: 'Attract', type: 'float', min: -2, max: 2, step: 0.01, hint: 'Pulls particles towards the attractor (the centre, or the mouse). Negative pushes them away.' },
    drag: { label: 'Drag', type: 'float', min: 0, max: 4, step: 0.01, hint: 'Air resistance: higher slows particles down and calms the motion.' },
    follow: { label: 'Mouse moves', type: 'select', hint: 'What the mouse (or a finger) moves: nothing, the emitter, the attractor or the first light.', options: opts([['none', 'Nothing'], ['emitter', 'Emitter'], ['attractor', 'Attractor'], ['lights', 'A light']]) },
    size: { label: 'Size', type: 'float', min: 0.5, max: 8, step: 0.05, hint: 'Particle size in pixels (of a 720-pixel-high picture). Capped at 8 for 1M and 3 for 4M.' },
    brightness: { label: 'Brightness', type: 'float', min: 0, max: 4, step: 0.01, hint: 'How much light each particle gives. The cloud looks about as bright at every count.' },
    palette: { label: 'Colours', type: 'select', hint: 'The colours a particle runs through.', options: opts([['ember', 'Ember'], ['ice', 'Ice'], ['aurora', 'Aurora'], ['neon', 'Neon'], ['gold', 'Gold'], ['mono', 'Mono'], ['rainbow', 'Rainbow']]) },
    colorBy: { label: 'Colour by', type: 'select', hint: 'What picks a particle\'s colour: its age, its speed (fast ones take the first colour) or its heading.', options: opts([['life', 'Life'], ['speed', 'Speed'], ['heading', 'Heading']]) },
    glow: { label: 'Glow', type: 'float', min: 0, max: 3, step: 0.01, hint: 'A soft bloom round the particles, built in.' },
    lights: { label: 'Lights', type: 'select', hint: 'Point lights among the particles: particles near one brighten and grow. Off lights them all evenly.', options: opts([['0', 'Off'], ['1', '1'], ['2', '2'], ['3', '3'], ['4', '4']]) },
    lightColor: { label: 'Light colour', type: 'vec3color', hint: 'The first light\'s colour; the others are its neighbours on the colour wheel.', showWhen: { param: 'lights', value: ['1', '2', '3', '4'] } },
    lightPower: { label: 'Light power', type: 'float', min: 0, max: 6, step: 0.01, hint: 'How bright the lights are.', showWhen: { param: 'lights', value: ['1', '2', '3', '4'] } },
    lightReach: { label: 'Light reach', type: 'float', min: 0.02, max: 1.5, step: 0.01, hint: 'How far a light reaches before it falls to half.', showWhen: { param: 'lights', value: ['1', '2', '3', '4'] } },
    halo: { label: 'Halo', type: 'float', min: 0, max: 3, step: 0.01, hint: 'A glow drawn round each light itself. 0: the lights show only on the particles.', showWhen: { param: 'lights', value: ['1', '2', '3', '4'] } },
    lightMotion: { label: 'Light motion', type: 'select', hint: 'Orbit: the lights circle the emitter. Still: they stand round it.', options: opts([['orbit', 'Orbit'], ['still', 'Still']]), showWhen: { param: 'lights', value: ['1', '2', '3', '4'] } },
  },
  glslFunction: `vec2 gpp_screen(vec2 uv) { return vec2(uv.x * u_resolution.y / u_resolution.x, uv.y) * 0.5 + 0.5; }`,
  declarationsFor: (node: GraphNode) => {
    // node.id is the slug, and a slider's param is the name of its uniform (patchNodeParamsForUniforms).
    const p: Record<string, unknown> = {};
    for (const key of Object.keys(GP_DEFAULTS)) if (node.params[key] !== undefined) p[key] = node.params[key];
    return [`uniform sampler2D ${gpuParticlesUniform(node.id)}; ${GP_MARK}${JSON.stringify({ p })}`];
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const uv = inputVars.uv ?? 'g_uv';
    const over = inputVars.over ?? 'vec3(0.0)';
    return {
      code: [
        `    vec4 ${id}_s = texture2D(${gpuParticlesUniform(id)}, clamp(gpp_screen(${uv}), 0.0, 1.0));\n`,
        `    vec3 ${id}_particles = max(${id}_s.rgb, vec3(0.0));\n`,
        `    float ${id}_density = max(${id}_s.a, 0.0);\n`,
        `    vec3 ${id}_color = ${over} + ${id}_particles;\n`,
      ].join(''),
      outputVars: { color: `${id}_color`, particles: `${id}_particles`, density: `${id}_density` },
    };
  },
};
