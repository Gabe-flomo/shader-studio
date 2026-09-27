export type AfKind = 'filter' | 'echo' | 'reverb' | 'distortion' | 'compressor';
export interface AfParam { key: string; label: string; min: number; max: number; step: number; value: number; unit: string; hint: string; hidden: boolean }
export interface AfEffectDef { label: string; icon: string; summary: string; params: AfParam[]; options: Record<string, ReadonlyArray<string | boolean>> }
/** An effect as the chain reads it: its kind, whether it's on, its numbers and options. */
export interface AfEffect { id: string; kind: AfKind; enabled: boolean; [key: string]: unknown }
export interface AfChainRecord { on: boolean; effects: AfEffect[] }

export const AF_SYNC: Readonly<Record<string, number>>;
export const AF_EFFECTS: Readonly<Record<AfKind, AfEffectDef>>;
export const AF_KINDS: readonly AfKind[];
export const AF_SPAN: number;
export const AF_MAX_DELAY: number;
export const AF_TAU: number;
export const AF_HOLD_SOURCE: string;

export function afShownParams(e: { kind: string; [key: string]: unknown }): AfParam[];
export function afNewEffect(kind: AfKind, id: string): AfEffect;
export function afClamp(p: AfParam, v: unknown): number;
export function afNormaliseEffect(raw: unknown, fallbackId: string): AfEffect | null;
export function afShape(kind: string, x: number, bits?: number): number;
export function afCurve(kind: string, bits?: number): Float32Array<ArrayBuffer>;
export function afDriveGain(drive: number): number;
export function afDb(db: number): number;
export function afMix(mix: number): [number, number];
export function afDampHz(damping: number): number;
export function afEchoSeconds(e: { sync?: unknown; bpm?: unknown; time?: unknown }): number;
export function afImpulseData(sampleRate: number, type: string, size: number, decay: number): [Float32Array, Float32Array];
export function afImpulse(ctx: BaseAudioContext, type: string, size: number, decay: number): AudioBuffer;
export function afLoadWorklet(ctx: BaseAudioContext): Promise<boolean>;
export function afWorkletReady(ctx: BaseAudioContext): boolean;
export function afNeedsWorklet(chains: ReadonlyArray<AfChainRecord | null | undefined>): boolean;
export function afSignature(chain: AfChainRecord | null | undefined, workletOk: boolean): string;

export interface AfBuiltEffect { id: string; kind: AfKind; fx: { input: AudioNode; output: AudioNode; vals: Record<string, number>; nodes: AudioNode[] } }
export interface AfChain {
  readonly input: GainNode;
  readonly output: GainNode;
  readonly built: readonly AfBuiltEffect[];
  update(chain: AfChainRecord | null | undefined, valueOf: ((e: AfEffect, key: string) => number) | null, when?: number | null): boolean;
  dispose(): void;
}
export function afCreateChain(ctx: BaseAudioContext): AfChain;
