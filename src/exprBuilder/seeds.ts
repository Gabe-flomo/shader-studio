/**
 * seeds.ts — what an Expression Builder chain starts from (docs/expression-builder-plan.md §3):
 * UV (2D), a world position (3D), time (1D) or a plain variable of a type. A seed is an object, not
 * a choice of three, so phase 4 can seed from a socket: it carries the type, the role, the
 * dimension and the context the moves are looked up with. Types only from the catalogue, so the
 * Builders menu can import this without the catalogue's code.
 */
import type { Role } from '../lib/glslPatterns';
import type { Dimension, Feed, Into } from './moves';

export type SeedType = 'float' | 'vec2' | 'vec3';
export type SeedKind = 'uv' | 'world' | 'time' | 'variable' | 'socket';

export interface ExprSeed {
  kind: SeedKind;
  /** The block's input the chain starts from (`uv`, `p`, `t`, `v`). */
  name: string;
  type: SeedType;
  /** What it stands for; 'unknown' takes moves of any role. */
  role: Role;
  dimension: Dimension;
  /** Shown in the chain's first row and in the block's note. */
  label: string;
  /** Context the moves are narrowed and ranked by (a socket seed brings its graph's, phase 4). */
  feeds?: Feed[];
  into?: Into[];
  techniques?: string[];
  /** Phase 4: the socket it was taken from; the output wires the block there. */
  from?: { nodeId: string; outputKey: string };
}

export const UV_SEED: ExprSeed = { kind: 'uv', name: 'uv', type: 'vec2', role: 'space', dimension: '2d', label: 'UV', feeds: ['uv', 'fragCoord'] };
export const WORLD_SEED: ExprSeed = { kind: 'world', name: 'p', type: 'vec3', role: 'space', dimension: '3d-world', label: 'World position', feeds: ['position'] };
export const TIME_SEED: ExprSeed = { kind: 'time', name: 't', type: 'float', role: 'time', dimension: '1d-time', label: 'Time', feeds: ['time'] };

/** A plain variable of a type, left as an input of the block (wire anything into it). */
export function variableSeed(type: SeedType): ExprSeed {
  return {
    kind: 'variable', name: 'v', type, role: 'unknown', label: `A ${type} variable`,
    dimension: type === 'vec3' ? '3d-world' : '2d',
  };
}

export const SEEDS: readonly ExprSeed[] = [UV_SEED, WORLD_SEED, TIME_SEED];
