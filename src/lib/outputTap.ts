/**
 * outputTap — the render loop's one hook for the output window
 * (src/output/outputHost.ts). Null until an output is opened, so ShaderCanvas
 * pays nothing (and loads nothing) without one.
 */
import type * as THREE from 'three';

export type OutputFrameHook = (time: number, playing: boolean, uniforms: Record<string, THREE.IUniform>, canvas: HTMLCanvasElement) => void;

export const outputTap: { frame: OutputFrameHook | null } = { frame: null };
