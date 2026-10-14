/**
 * paramMap.ts — which node param a 3D Scene Builder value builds (docs/scene-builder-3d.md, "Play
 * controls from the builder").
 *
 * The builder edits a recipe, not nodes, so its sliders aren't node params. But every number the
 * build writes lands on one node, found by its role (build.ts: `s2` the shape, `s2:at` its place,
 * `camera`, `march:glow`…). `paramTarget` names that role and param for a value of the spec;
 * `liveParam` finds the node in the graph, once the scene is built, so the slider's right-click can
 * offer the node card's Play menu (Add to Play controls).
 *
 * Pure: the graph comes in as nodes.
 */
import type { GraphNode } from '../types/nodeGraph';
import { findBuild } from './apply';
import { SHAPE_BY_KIND, WARP_BY_KIND, findItem, type CameraNumKey, type SceneSpec } from './spec';

/** A value of the spec a slider sets. */
export type SpecPath =
  /** A shape's size setting (`r`, `size`…); `part` picks one of a vector's three. */
  | { at: 'size'; id: string; key: string; part?: 0 | 1 | 2 }
  /** A shape's place or turn, one axis. */
  | { at: 'place'; id: string; what: 'at' | 'rot'; part: 0 | 1 | 2 }
  /** A combine's blend radius (k). */
  | { at: 'k'; id: string }
  /** A modifier's or a whole-scene warp's setting. */
  | { at: 'warp'; itemId: string; warpId: string; key: string; part?: 0 | 1 | 2 }
  | { at: 'camera'; key: CameraNumKey }
  | { at: 'look'; key: LookKey; part?: 0 | 1 | 2 }
  | { at: 'quality'; key: 'steps' | 'maxDist' | 'jitter' | 'voxel' };

export type LookKey = 'glow.density' | 'glow.falloff' | 'glow.shell' | 'glow.exposure' | 'glass.ior' | 'glass.dispersion'
  | 'gi.strength' | 'gi.metal' | 'gi.rough' | 'gi.spec' | 'shadows' | 'ao' | 'fog' | 'sunDir';

export interface ParamTarget { role: string; key: string }

const CAMERA: Record<CameraNumKey, string> = {
  dist: 'camDist', angle: 'camAngle', elev: 'camElevation', orbit: 'rotSpeed', zoom: 'fov', flatten: 'ortho', x: 'targetX', y: 'targetY', z: 'targetZ',
  reverse: 'reverseStrength', converge: 'reverseDist',
};

/** The look's values by render mode: the role of the node that carries each, and its param. */
const LOOK: Record<LookKey, ParamTarget | ((mode: string, part: number) => ParamTarget | null)> = {
  'glow.density': { role: 'march:glow', key: 'density' },
  'glow.falloff': { role: 'march:glow', key: 'falloff' },
  'glow.shell': { role: 'march:glow', key: 'shell' },
  'glow.exposure': { role: 'glowColor', key: 'exposure' },
  'glass.ior': { role: 'march', key: 'ior' },
  'glass.dispersion': { role: 'march', key: 'dispersion' },
  'gi.strength': { role: 'march', key: 'giStrength' },
  'gi.metal': { role: 'march', key: 'metallic' },
  'gi.rough': { role: 'march', key: 'roughness' },
  'gi.spec': { role: 'march', key: 'specStrength' },
  shadows: { role: 'shadow', key: 'k' },
  ao: { role: 'ao', key: 'stepDist' },
  fog: { role: 'fog', key: 'density' },
  // The sun's direction is one Make Vec3 that feeds the shadows and the lights together.
  sunDir: (_mode, part) => ({ role: 'sun', key: ['r', 'g', 'b'][part] }),
};

const QUALITY = { steps: 'maxSteps', maxDist: 'maxDist', jitter: 'jitter', voxel: 'voxelSize' } as const;

/** The role and param a value builds, or null when it builds none of its own (a colour picked in Materials, an angle on a select). */
export function paramTarget(spec: SceneSpec, path: SpecPath): ParamTarget | null {
  switch (path.at) {
    case 'camera': return { role: 'camera', key: CAMERA[path.key] };
    case 'quality': return { role: 'march', key: QUALITY[path.key] };
    case 'look': {
      const t = LOOK[path.key];
      return typeof t === 'function' ? t(spec.look.mode, path.part ?? 0) : t;
    }
    case 'k': return { role: `${path.id}:op1`, key: 'k' };
    case 'place': return { role: `${path.id}:at`, key: path.what === 'at' ? ['x', 'y', 'z'][path.part] : ['rx', 'ry', 'rz'][path.part] };
    case 'size': {
      const hit = findItem(spec, path.id)?.item;
      if (hit?.type !== 'shape') return null;
      const def = SHAPE_BY_KIND[hit.kind];
      const p = def?.params.find(x => x.key === path.key);
      if (!def || !p) return null;
      // Settings with no param of the shape's own: the 4D slice and spin, a field's ball.
      if (path.key === 'w' && def.fourD) return { role: `${path.id}:lift`, key: 'w' };
      if (path.key === 'spin' && def.fourD) return { role: `${path.id}:turn4`, key: 'spin' };
      if (path.key === 'ball' && def.field) return { role: `${path.id}:ball`, key: 'radius' };
      if (!p.param) return null;
      return { role: path.id, key: Array.isArray(p.param) ? p.param[path.part ?? 0] : p.param };
    }
    case 'warp': {
      const it = findItem(spec, path.itemId)?.item;
      const w = it?.warps.find(x => x.id === path.warpId);
      const def = w ? WARP_BY_KIND[w.kind] : undefined;
      if (!w || !def) return null;
      const part = path.part ?? 0;
      // Move, Turn, Rotate and Scale are Transforms (build.ts transformWarp).
      if (w.kind === 'move') return { role: w.id, key: ['x', 'y', 'z'][part] };
      if (w.kind === 'rotate') return { role: w.id, key: ['rx', 'ry', 'rz'][part] };
      if (w.kind === 'turn') return { role: w.id, key: `r${['x', 'y', 'z'].includes(String(w.values.axis)) ? w.values.axis : 'y'}` };
      if (w.kind === 'scale') return { role: w.id, key: 'scale' };
      if (w.kind === 'round') return { role: w.id, key: 'amount' };
      const p = def.params.find(x => x.key === path.key);
      if (!p?.param) return null;
      return { role: w.id, key: Array.isArray(p.param) ? p.param[part] : p.param };
    }
  }
}

/**
 * The node param in the graph that `path` built: the scene must be built (`sceneId` its Scene
 * Group) and the node there with that setting. Otherwise why not, in words for the menu.
 */
export function liveParam(nodes: GraphNode[], sceneId: string | null, spec: SceneSpec, path: SpecPath): { nodeId: string; key: string } | { missing: string } {
  const t = paramTarget(spec, path);
  if (!t) return { missing: 'This setting doesn’t build a node setting of its own, so it can’t be a Play control' };
  const build = sceneId ? findBuild(nodes, sceneId) : null;
  if (!build) return { missing: 'Build the scene first (Done builds it): then this setting is a node’s, and can be a Play control' };
  const hit = build.byRole.get(t.role);
  if (!hit || !(t.key in hit.node.params)) return { missing: 'Not built yet: build the scene again (Done) to make this a Play control' };
  return { nodeId: hit.node.id, key: t.key };
}
