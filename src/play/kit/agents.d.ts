/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Types for agents.js (the Agents layer's simulation). The kit is plain
 * JavaScript shared with the website runtime, and its state is built
 * dynamically, so these stay permissive; the rule table is typed because the
 * app builds its editor and numeric properties from it.
 */
export interface AgRuleParam { key: string; label: string; min: number; max: number; value: number; hint: string; step?: number }
export interface AgRuleDef { label: string; hint: string; target?: boolean; neighbours?: boolean; modes?: string[]; params: AgRuleParam[] }
export const AG_MAX: number;
export const AG_GROUPS: number;
export const AG_STEP: number;
export const AG_READS: string[];
export const AG_RULES: Record<string, AgRuleDef>;
export const AG_RULE_TYPES: string[];
export const AG_TARGETS: string[];
export const AG_CHANNELS: string[];
export const AG_PRESETS: Record<string, { label: string; hint: string; set: Record<string, unknown>; rules: Array<[string, Record<string, unknown>]> }>;
export function agPresetLayer(name: string, old: any): Record<string, unknown> | null;
export function agCounts(l: any): number[];
export const agNoise: any;
export const agHashBuild: any;
export const agHashQuery: any;
export const agCreate: any;
export const agReset: any;
export const agScatter: any;
export const agStep: any;
export const agElements: any;
export const agElement: any;
export const agDraw: any;
