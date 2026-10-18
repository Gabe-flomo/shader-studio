/**
 * spec.ts — the Time Cube builder's scene (docs/timecube-builder.md): a Time Cube (the video's frames) shown either as
 * a Time Cube View (one box of time) or as a Frame Stack (each frame a card), with, when you want one, an LFO driving
 * one of the display's sockets (the slice, the scan, the spread, the morph…).
 *
 * The builder adds no settings of its own: every control is a param of one of those real nodes, so the spec is simply
 * their params by role. Both displays' params are kept, so switching Cube ⇄ Stack and back keeps what you set.
 *
 * The node cards' own sections (ParamDef.section) are grouped into the builder's sections by SECTION_OF.
 */
import { getNodeDefinition } from '../nodes/definitions';
import type { ParamDef } from '../types/nodeGraph';
import { isParamVisible } from '../compiler/uniformPatcher';

export type Params = Record<string, unknown>;
export type TcDisplay = 'cube' | 'stack';
export type TcRole = 'source' | 'view' | 'stack' | 'drive';
export type TcSection = 'source' | 'shape' | 'time' | 'colour' | 'motion' | 'space' | 'camera' | 'look';

export const TC_SECTIONS: TcSection[] = ['source', 'shape', 'time', 'colour', 'motion', 'space', 'camera', 'look'];

/** The node type of each role. */
export const ROLE_TYPE: Record<TcRole, string> = { source: 'timeCube', view: 'timeCubeView', stack: 'frameStack', drive: 'lfo' };

/** An LFO on one of the display's float sockets. */
export interface TcDrive {
  on: boolean;
  /** The display's input socket it drives (`slice`, `flowTime` on the View; `scan`, `spread`, `morph`, `shuffle` on the Stack). */
  target: string;
  waveform: 'sine' | 'triangle' | 'sawtooth' | 'square';
  /** Rounds a second. */
  freq: number;
  /** The middle of its swing and how far either side. */
  offset: number;
  amplitude: number;
}

export interface TimeCubeSpec {
  v: 1;
  display: TcDisplay;
  source: Params;
  view: Params;
  stack: Params;
  drive: TcDrive;
}

/** What the LFO can drive on each display, with a plain name. */
export const DRIVE_TARGETS: Record<TcDisplay, Array<{ value: string; label: string; param?: string }>> = {
  cube: [{ value: 'slice', label: 'The slice (Offset)', param: 'slice' }, { value: 'flowTime', label: 'The flow (Flow time)', param: 'flowTime' }],
  stack: [
    { value: 'scan', label: 'The scan (Offset)', param: 'scan' }, { value: 'spread', label: 'Scatter (Spread)', param: 'spread' },
    { value: 'morph', label: 'The morph', param: 'morph' }, { value: 'shuffle', label: 'The shuffle', param: 'shuffle' },
  ],
};

/** Keys the builder keeps on nodes for itself, never part of a role's params. */
export const TC_ROLE = '_tcRole';
export const TC_BUILD = '_tcBuild';
export const TC_META = '_tcBuilder';
const OWN_KEYS = new Set(['__comment', TC_ROLE, TC_BUILD, TC_META]);
/** A node's params as the spec keeps them (its notes and the builder's keys taken off). */
export const specParams = (p: Params): Params => Object.fromEntries(Object.entries(p).filter(([k]) => !OWN_KEYS.has(k) && !k.startsWith('_fold')));

export const defaultsOf = (role: TcRole): Params => structuredClone(getNodeDefinition(ROLE_TYPE[role])?.defaultParams ?? {}) as Params;
export const defsOf = (role: TcRole): Record<string, ParamDef> => getNodeDefinition(ROLE_TYPE[role])?.paramDefs ?? {};
export const displayRole = (d: TcDisplay): 'view' | 'stack' => (d === 'cube' ? 'view' : 'stack');

export const defaultDrive = (display: TcDisplay = 'cube'): TcDrive => ({ on: true, target: display === 'cube' ? 'slice' : 'scan', waveform: 'triangle', freq: 0.07, offset: 0.5, amplitude: 0.47 });

/** A new scene: the Ball action clip as a box of time, the slice sweeping (the Time Cube folder's first example). */
export function blankSpec(display: TcDisplay = 'cube'): TimeCubeSpec {
  return { v: 1, display, source: defaultsOf('source'), view: defaultsOf('view'), stack: defaultsOf('stack'), drive: defaultDrive(display) };
}

/** Fill in what an older or partial spec lacks. */
export function normalizeSpec(s: Partial<TimeCubeSpec> | null | undefined): TimeCubeSpec {
  const b = blankSpec(s?.display === 'stack' ? 'stack' : 'cube');
  return {
    v: 1, display: b.display,
    source: { ...b.source, ...(s?.source ?? {}) }, view: { ...b.view, ...(s?.view ?? {}) }, stack: { ...b.stack, ...(s?.stack ?? {}) },
    drive: { ...b.drive, ...(s?.drive ?? {}) },
  };
}

// ── Which builder section each setting is in ─────────────────────────────────

/** The node card's section → the builder's, per role. */
const SECTION_OF: Record<'source' | 'view' | 'stack', Record<string, TcSection>> = {
  source: { Stack: 'source', 'Frames from': 'source', Order: 'source' },
  view: {
    Slice: 'time', Shape: 'shape', Box: 'shape', Glow: 'colour', Look: 'colour', 'Colour key': 'colour', 'Key: everything else': 'colour', 'Key: animate': 'colour',
    Highlights: 'motion', 'Frame motion': 'motion', Repeat: 'space', Copies: 'space', Warp: 'space', Space: 'space', Outline: 'look', Camera: 'camera',
  },
  stack: { Layout: 'shape', Shape: 'shape', Cards: 'shape', Scan: 'time', Playback: 'time', Order: 'time', Scatter: 'motion', Highlights: 'motion', Focus: 'look', Camera: 'camera' },
};
/** Single settings that read better elsewhere than their card section. */
const PARAM_SECTION: Record<'source' | 'view' | 'stack', Record<string, TcSection>> = {
  source: {},
  view: { shadow: 'look', shadowSoftness: 'look', shadowGap: 'look', background: 'look', quality: 'look' },
  stack: { brightness: 'colour', contrast: 'colour', borderColor: 'colour', edgeColor: 'colour', shading: 'colour', hlColor: 'colour', hlTint: 'colour', background: 'look' },
};
/** The card section a setting shows under, renamed where the builder's section says it better. */
const GROUP_NAME: Record<string, string> = { Space: 'Far & fog', Copies: 'Each copy', Look: 'Picture', Playback: 'Playback', Glow: 'Glow & tint', Box: 'Box', Stack: 'Frames', Order: 'Frame order' };

export interface ParamGroup { role: 'source' | 'view' | 'stack'; title: string; keys: string[] }

/**
 * The settings of builder section `section` for `display`, as groups (one per card section, in the card's order).
 * Every param with a section on the card is in exactly one builder section. Pure.
 */
export function groupsFor(section: TcSection, display: TcDisplay): ParamGroup[] {
  const roles: Array<'source' | 'view' | 'stack'> = ['source', displayRole(display)];
  const out: ParamGroup[] = [];
  for (const role of roles) {
    const defs = defsOf(role);
    const byTitle = new Map<string, ParamGroup>();
    for (const [key, pd] of Object.entries(defs)) {
      const card = pd.section ?? 'Settings';
      const s = PARAM_SECTION[role][key] ?? SECTION_OF[role][card];
      if (s !== section) continue;
      // A setting moved out of its card section sits under the builder section's own name.
      const title = PARAM_SECTION[role][key] ? (GROUP_NAME[card] && SECTION_OF[role][card] === s ? GROUP_NAME[card] : sectionTitle(s)) : (GROUP_NAME[card] ?? card);
      let g = byTitle.get(title);
      if (!g) { g = { role, title, keys: [] }; byTitle.set(title, g); out.push(g); }
      g.keys.push(key);
    }
  }
  return out;
}

const TITLES: Record<TcSection, string> = { source: 'Source', shape: 'Shape', time: 'Time', colour: 'Colour', motion: 'Highlights & motion', space: 'Space', camera: 'Camera', look: 'Look' };
export const sectionTitle = (s: TcSection) => TITLES[s];

/** Every param key of a role that some builder section shows (the tests check none is left out). */
export function shownKeys(role: 'source' | 'view' | 'stack'): string[] {
  const display: TcDisplay = role === 'stack' ? 'stack' : 'cube';
  return TC_SECTIONS.flatMap(s => groupsFor(s, display)).filter(g => g.role === role).flatMap(g => g.keys);
}

/** Whether a setting shows now (the card's showWhen). */
export const visibleNow = (pd: ParamDef, params: Params, role: TcRole) => isParamVisible(pd, params, defaultsOf(role));

// ── Summaries (the left nav's one line under each section) ─────────────────

const f2 = (v: unknown) => (typeof v === 'number' ? (Math.round(v * 100) / 100).toString() : String(v ?? ''));
const optLabel = (role: TcRole, key: string, v: unknown) => defsOf(role)[key]?.options?.find(o => o.value === String(v))?.label ?? String(v);
const short = (s: string) => s.replace(/\s*\(.*\)\s*$/, '');

export function sourceName(source: Params): string {
  if (source.source === 'pictures') {
    const n = Array.isArray(source.pictures) ? source.pictures.length : 0;
    return n ? `${n} ${n === 1 ? 'picture' : 'pictures'}` : 'Pictures';
  }
  if (source.source === 'library') return (typeof source.fileName === 'string' && source.fileName) || 'A Library video';
  return source.source === 'ball' ? 'Ball action' : 'Test clip';
}

export function sectionSummary(spec: TimeCubeSpec, s: TcSection): string {
  const v = spec.view, st = spec.stack, cube = spec.display === 'cube';
  switch (s) {
    case 'source': if (spec.source.source === 'pictures') return `${sourceName(spec.source)} · ${short(optLabel('source', 'pictureFit', spec.source.pictureFit ?? 'cover')).toLowerCase()}`;
      return `${sourceName(spec.source)} · ${spec.source.spacing === 'step' ? `every ${f2(spec.source.step)} s` : `${f2(spec.source.frames)} frames`}${spec.source.combine !== 'pick' ? ` · ${short(optLabel('source', 'combine', spec.source.combine))}` : ''}`;
    case 'shape': return cube ? `Box · ${short(optLabel('view', 'axis', v.axis))} · round ${f2(v.roundness)}` : `Cards · ${optLabel('stack', 'layout', st.layout)} · ${f2(st.cards)} cards`;
    case 'time': {
      const what = short(DRIVE_TARGETS[spec.display].find(t => t.value === spec.drive.target)?.label ?? spec.drive.target);
      const drive = spec.drive.on ? ` · LFO on ${what.charAt(0).toLowerCase()}${what.slice(1)}` : '';
      return cube ? `${short(optLabel('view', 'timeMode', v.timeMode))}${drive}` : `${short(optLabel('stack', 'playback', st.playback))}${drive}`;
    }
    case 'colour': return cube ? (v.keyMode && v.keyMode !== 'off' ? `Key: ${short(optLabel('view', 'keyMode', v.keyMode))}` : `Rim ${f2(v.rimStrength)} · tint ${f2(v.tintAmount)}`) : `Contrast ${f2(st.contrast)} · border ${f2(st.border)}`;
    case 'motion': return cube ? [v.highlights ? `${f2(v.hlCount)} highlights` : 'No highlights', v.motion ? 'frames move' : ''].filter(Boolean).join(' · ')
      : [Number(st.hlCount) > 0 ? `${f2(st.hlCount)} highlights` : 'No highlights', Number(st.spread) > 0 ? `spread ${f2(st.spread)}` : ''].filter(Boolean).join(' · ');
    case 'space': {
      if (!cube) return 'The box only (Cube)';
      const parts = [
        v.repeat === true ? `repeat ${short(optLabel('view', 'repAxes', v.repAxes)).toLowerCase()}${Number(v.repCount) > 0 ? ` · ${f2(v.repCount)} each side` : ''}` : '',
        typeof v.warp === 'string' && v.warp !== 'off' ? short(optLabel('view', 'warp', v.warp)).toLowerCase() : '',
      ].filter(Boolean);
      return parts.length ? parts.join(' · ') : 'One box, no warp';
    }
    case 'camera': {
      const p = cube ? v : st;
      const lens = cube ? (Number(v.ortho) >= 0.99 ? 'flat' : 'perspective') : short(optLabel('stack', 'projection', st.projection)).toLowerCase();
      return `${lens} · ${Number(p.rotSpeed) ? `orbit ${f2(p.rotSpeed)}` : 'still'}`;
    }
    case 'look': return cube ? `Outline ${short(optLabel('view', 'outline', v.outline)).toLowerCase()} · ${short(optLabel('view', 'quality', v.quality))}` : `Focus ${short(optLabel('stack', 'dof', st.dof)).toLowerCase()}`;
  }
}
