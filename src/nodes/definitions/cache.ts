/**
 * Cache and Cache Read (docs/cache-node.md): the last frames of any texture kept on the GPU, read back by how
 * long ago, like TouchDesigner's Cache TOP and Cache Select TOP. Time Machine (a per-pixel delay from a map)
 * is the Delay map input.
 *
 * The recording runs outside the shader (lib/cache/engine.ts): just before the picture draws (after the Passes),
 * the wired texture is copied into the next tile of an atlas, `u_cache_<slug>` (the store's nodeTextures[id]),
 * a grid of `frames` tiles. The engine writes which tile is newest and how many are filled into two floats,
 * `u_cache_<slug>_head` and `_filled` (registered as live uniforms, set on the material each frame). The grid
 * and frame count are compile-time defines, so Cache Read can find them from the sampler's name alone.
 *
 * The node writes one comment naming the texture wired into it (CACHE_SOURCE_MARK), as the Depth node does.
 */
import type { GraphNode, NodeDefinition } from '../../types/nodeGraph';
import { p, withParamSockets } from './helpers';
import { texUv } from './passes';
import { TEXTURE_TOOLS_CATEGORY } from './textureTools';

export const CACHE_TYPE = 'cache';
export const CACHE_READ_TYPE = 'cacheRead';
/** `// cache-source <cache sampler> <wired sampler>`: what the engine records (lib/cache/engine.ts). */
export const CACHE_SOURCE_MARK = '// cache-source ';
export const CACHE_FRAMES = [8, 16, 32, 64, 128] as const;
export const CACHE_SIZES = [128, 192, 256, 384, 512] as const;

export const cacheSampler = (slug: string): string => `u_cache_${slug}`;
export const isCacheSampler = (name: string | undefined): boolean => !!name && /^u_cache_\w+$/.test(name) && !/_(head|filled)$/.test(name);

export const cacheFramesOf = (node: GraphNode): number => {
  const n = Number(node.params.frames);
  return (CACHE_FRAMES as readonly number[]).includes(n) ? n : 32;
};
export const cacheSizeOf = (node: GraphNode): number => {
  const n = Number(node.params.size);
  return (CACHE_SIZES as readonly number[]).includes(n) ? n : 256;
};

/** The atlas grid for a frame count: about square, columns first. */
export function cacheGrid(frames: number): { cols: number; rows: number } {
  const cols = Math.ceil(Math.sqrt(frames));
  return { cols, rows: Math.ceil(frames / cols) };
}

/**
 * Reading a cache (pure, mirrors the GLSL): the tile `delay` frames back from the newest, `head`, wrapping round
 * the `frames` tiles, never further back than what is filled. Smooth blends the two tiles a fractional delay
 * falls between; otherwise it rounds.
 */
export function cacheTiles(delay: number, head: number, filled: number, frames: number, smooth: boolean): { a: number; b: number; t: number } | null {
  if (filled < 1) return null;
  const d = Math.max(0, Math.min(filled - 1, delay));
  const d0 = smooth ? Math.floor(d) : Math.round(d);
  const tile = (k: number) => (((head - k) % frames) + frames) % frames;
  if (!smooth || d0 + 1 > filled - 1) return { a: tile(d0), b: tile(d0), t: 0 };
  return { a: tile(d0), b: tile(d0 + 1), t: d - d0 };
}

/** Shared reading helpers: one tile of the atlas (kept inside it, so blending never bleeds), and a delayed read. */
export const CACHE_GLSL = `vec4 cache_tile(sampler2D s, vec2 st, float k, vec2 grid) {
  vec2 px = grid / vec2(textureSize(s, 0));
  vec2 inner = clamp(st, px * 0.5, 1.0 - px * 0.5);
  return textureLod(s, (vec2(mod(k, grid.x), floor(k / grid.x)) + inner) / grid, 0.0);
}
vec4 cache_read(sampler2D s, vec2 st, float delay, float head, float filled, float frames, vec2 grid, float smoothRead) {
  if (filled < 0.5) return vec4(0.0);
  float d = clamp(delay, 0.0, filled - 1.0);
  float d0 = smoothRead > 0.5 ? floor(d) : floor(d + 0.5);
  vec4 a = cache_tile(s, st, mod(head - d0 + frames, frames), grid);
  if (smoothRead < 0.5 || d0 + 1.0 > filled - 1.0) return a;
  return mix(a, cache_tile(s, st, mod(head - d0 - 1.0 + frames, frames), grid), d - d0);
}`;

/** The GLSL that reads `S` at this pixel, `delay` frames back plus the map (0–1) × Map reach × the frames. */
function readCode(id: string, S: string, uvVar: string, delay: string, map: string | undefined, reach: string, smooth: boolean): string {
  const lines = [
    `    vec2 ${id}_st = clamp(${texUv(uvVar)}, 0.0, 1.0);\n`,
    `    float ${id}_d = ${delay}${map ? ` + clamp(${map}, 0.0, 1.0) * ${reach} * (${S}_frames - 1.0)` : ''};\n`,
    `    vec4 ${id}_c = cache_read(${S}, ${id}_st, ${id}_d, ${S}_head, ${S}_filled, ${S}_frames, ${S}_grid, ${smooth ? '1.0' : '0.0'});\n`,
  ];
  return lines.join('');
}

const RECORD = 'Record';
const READ = 'Read';

export const CacheNode: NodeDefinition = withParamSockets({
  type: CACHE_TYPE,
  label: 'Cache',
  category: TEXTURE_TOOLS_CATEGORY,
  aliases: ['Cache TOP', 'Time delay', 'Frame buffer', 'Frame delay', 'Time Machine', 'Freeze frame', 'Loop frames', 'Video delay', 'History'],
  description: 'Keeps the last frames of any texture on the GPU and reads them back by how long ago: a time delay (Delay frames back), a freeze (Record off), a loop (wire an LFO into Delay), or Time Machine (a Delay map: each pixel from its own moment, a grey picture or gradient saying how far back). Wire a Video Input, the camera, a Pass, a Data Texture. Cache Read reads more delays from the same frames.',
  inputs: {
    texture: { type: 'texture', label: 'Texture', hint: 'What to record: a Video Input (or the camera), Texture Input, Baked, a Pass, a Shader Texture or a Data Texture.' },
    delayMap: { type: 'float', label: 'Delay map', hint: 'Time Machine: 0–1 at each pixel, how far back to read it (times Map reach of the frames), on top of Delay. Wire a gradient, noise, a Depth or a mask.' },
    uv: { type: 'vec2', label: 'UV', hint: 'Where to read the frames, in picture coordinates. Empty: this pixel.' },
  },
  outputs: {
    color: { type: 'vec3', label: 'Color', hint: 'The recorded picture, Delay frames back (and the Delay map\'s more).' },
    alpha: { type: 'float', label: 'Alpha', hint: 'Its alpha.' },
    cache: { type: 'texture', label: 'Cache', hint: 'The recorded frames, for Cache Read nodes: read other delays from the same frames without recording them again.' },
  },
  defaultParams: { frames: '32', size: '256', record: true, every: 1, delay: 0, reach: 1, smooth: true },
  paramDefs: {
    frames: { label: 'Frames', type: 'select', section: RECORD, hint: 'How many frames are kept (the longest delay). Each costs a frame of GPU memory at Frame size.', options: CACHE_FRAMES.map(n => ({ value: String(n), label: `${n} frames` })) },
    size: { label: 'Frame size', type: 'select', section: RECORD, hint: 'Each frame\'s width in pixels (its height follows the picture\'s shape). Smaller keeps more frames cheaply; it is lowered if the frames wouldn\'t fit a 4096 px texture.', options: CACHE_SIZES.map(n => ({ value: String(n), label: `${n} px` })) },
    record: { label: 'Record', type: 'bool', section: RECORD, hint: 'Off: stops recording and keeps the frames it has (a freeze, or a loop to play through with Delay).' },
    every: { label: 'Every', type: 'int', min: 1, max: 30, step: 1, section: RECORD, hint: 'Records one frame every this many: 2 keeps twice as long a history in the same frames, steppier.' },
    delay: { label: 'Delay', type: 'float', min: 0, max: 127, step: 0.01, section: READ, hint: 'How many recorded frames back to read: 0 is the newest. Beyond what is recorded it reads the oldest. Wire an LFO or a Time to loop through them.' },
    reach: { label: 'Map reach', type: 'float', min: 0, max: 1, step: 0.01, section: READ, hint: 'With a Delay map: how much of the cache a map value of 1 reaches back (1: all the frames).' },
    smooth: { label: 'Smooth', type: 'bool', section: READ, hint: 'Blends the two frames a fractional delay falls between, so slow delays glide instead of stepping.' },
  },
  glslFunctions: [CACHE_GLSL],
  declarationsFor: (node: GraphNode) => {
    const S = cacheSampler(node.id), F = cacheFramesOf(node), { cols, rows } = cacheGrid(F);
    return [`#define ${S}_frames ${F}.0`, `#define ${S}_grid vec2(${cols}.0, ${rows}.0)`];
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id, S = cacheSampler(id), P = node.params;
    const code = [
      // What the engine records (lib/cache/engine.ts); empty: nothing.
      `    ${CACHE_SOURCE_MARK}${S} ${inputVars.texture ?? 'none'}\n`,
      readCode(id, S, inputVars.uv ?? 'g_uv', p(P.delay, 0), inputVars.delayMap, p(P.reach, 1), P.smooth !== false),
    ].join('');
    return { code, outputVars: { color: `${id}_c.rgb`, alpha: `${id}_c.a`, cache: S } };
  },
}, ['delay', 'reach']);

export const CacheReadNode: NodeDefinition = withParamSockets({
  type: CACHE_READ_TYPE,
  label: 'Cache Read',
  category: TEXTURE_TOOLS_CATEGORY,
  aliases: ['Cache Select', 'Cache Select TOP', 'Read cache', 'Delay tap'],
  description: 'Reads a Cache\'s frames at another delay, without recording them again (TouchDesigner\'s Cache Select): several Cache Reads off one Cache make staggered copies, trails of frames, or a split screen of the past.',
  inputs: {
    cache: { type: 'texture', label: 'Cache', hint: 'A Cache node\'s Cache output.' },
    delayMap: { type: 'float', label: 'Delay map', hint: 'Time Machine: 0–1 at each pixel, how far back (times Map reach of the frames), on top of Delay.' },
    uv: { type: 'vec2', label: 'UV', hint: 'Where to read the frames, in picture coordinates. Empty: this pixel.' },
  },
  outputs: {
    color: { type: 'vec3', label: 'Color', hint: 'The cached picture, Delay frames back.' },
    alpha: { type: 'float', label: 'Alpha', hint: 'Its alpha.' },
  },
  defaultParams: { delay: 8, reach: 1, smooth: true },
  paramDefs: {
    delay: { label: 'Delay', type: 'float', min: 0, max: 127, step: 0.01, hint: 'How many recorded frames back to read: 0 is the newest.' },
    reach: { label: 'Map reach', type: 'float', min: 0, max: 1, step: 0.01, hint: 'With a Delay map: how much of the cache a map value of 1 reaches back.' },
    smooth: { label: 'Smooth', type: 'bool', hint: 'Blends the two frames a fractional delay falls between.' },
  },
  glslFunctions: [CACHE_GLSL],
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id, P = node.params, S = inputVars.cache;
    // Only a Cache's frames can be read (its grid and head come with its sampler's name).
    if (!isCacheSampler(S)) return { code: `    vec4 ${id}_c = vec4(0.0);\n`, outputVars: { color: `${id}_c.rgb`, alpha: `${id}_c.a` } };
    return {
      code: readCode(id, S!, inputVars.uv ?? 'g_uv', p(P.delay, 8), inputVars.delayMap, p(P.reach, 1), P.smooth !== false),
      outputVars: { color: `${id}_c.rgb`, alpha: `${id}_c.a` },
    };
  },
}, ['delay', 'reach']);
