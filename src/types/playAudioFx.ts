/**
 * playAudioFx.ts — the Play record's audio effects (`play.audioFx`): a chain
 * per sound, what each holds, parsing it from a file, and its control
 * targets. The effects themselves (their numbers, the Web Audio graph) live
 * in the layer kit, play/kit/audioFx.js, so the app, renders and exported
 * pages share them. See docs/audio-effects.md.
 *
 * Chains are keyed by the sound they sit on:
 *   master        everything the app plays, after the per-sound chains
 *   synth         the MIDI tone synth (lib/toneSynth.ts)
 *   layer:<id>    an audio layer's song, or a Video layer's sound
 *   node:<id>     an Audio Input node's song
 */
import { AF_EFFECTS, AF_KINDS, afNewEffect, afNormaliseEffect, type AfEffect, type AfKind, type AfParam } from '../play/kit/audioFx.js';

export type AudioFxKind = AfKind;
export type AudioFxEffect = AfEffect;

export interface AudioFxChain {
  on: boolean;
  effects: AudioFxEffect[];
}

export interface PlayAudioFx {
  /** Chains by the sound they sit on (see the file's comment). */
  chains: Record<string, AudioFxChain>;
  /** What the audio readers (and audio layers, and Audio Input uniforms) hear: after the effects (default) or before. */
  analyse?: 'pre' | 'post';
}

export const AUDIO_FX_KINDS = AF_KINDS;
export const AUDIO_FX_EFFECTS = AF_EFFECTS;
export const MASTER_CHAIN = 'master';
export const SYNTH_CHAIN = 'synth';

/** The chain a layer's sound goes through (an audio layer's song, a Video layer's sound). */
export const layerChainId = (layerId: string) => `layer:${layerId}`;
/** The chain an Audio Input node's song goes through. */
export const nodeChainId = (nodeId: string) => `node:${nodeId}`;

const CHAIN_ID = /^(master|synth|layer:[^\s]+|node:[^\s]+)$/;
export const isChainId = (id: string) => CHAIN_ID.test(id);

// ── Control targets ─────────────────────────────────────────────────────────

export const AUDIO_FX_TARGET_PREFIX = 'audiofx:';

/** Control target for one of an effect's numbers: `audiofx:<chainId>:<effectId>::<key>`. */
export function audioFxTarget(chainId: string, effectId: string, key: string): string {
  return `${AUDIO_FX_TARGET_PREFIX}${chainId}:${effectId}::${key}`;
}

/** Split a target (the effect id is the last `:` part before `::`, since chain ids have colons of their own). */
export function parseAudioFxTarget(target: string): { chainId: string; effectId: string; key: string } | null {
  if (!target.startsWith(AUDIO_FX_TARGET_PREFIX)) return null;
  const rest = target.slice(AUDIO_FX_TARGET_PREFIX.length);
  const i = rest.lastIndexOf('::');
  if (i <= 0) return null;
  const head = rest.slice(0, i);
  const j = head.lastIndexOf(':');
  if (j <= 0 || j === head.length - 1) return null;
  return { chainId: head.slice(0, j), effectId: head.slice(j + 1), key: rest.slice(i + 2) };
}

/** The id the mapping engine keeps an effect's driven numbers under (playEngine.layerValue(audioFxPropId(…), key, base)). */
export function audioFxPropId(chainId: string, effectId: string): string {
  return `${AUDIO_FX_TARGET_PREFIX}${chainId}:${effectId}`;
}

export function audioFxEffect(fx: PlayAudioFx | undefined, chainId: string, effectId: string): AudioFxEffect | undefined {
  return fx?.chains[chainId]?.effects.find(e => e.id === effectId);
}

export function audioFxParam(kind: string, key: string): AfParam | undefined {
  return AF_EFFECTS[kind as AfKind]?.params.find(p => p.key === key);
}

/** A target's number as the record has it, or undefined when it isn't one or its effect is gone. */
export function readAudioFxValue(fx: PlayAudioFx | undefined, target: string): number | undefined {
  const t = parseAudioFxTarget(target);
  if (!t) return undefined;
  const e = audioFxEffect(fx, t.chainId, t.effectId);
  const v = e?.[t.key];
  return typeof v === 'number' ? v : undefined;
}

/** "Echo · Feedback": a target's words, or null when it isn't one or its effect is gone. */
export function audioFxTargetLabel(fx: PlayAudioFx | undefined, target: string): { effect: string; param: string } | null {
  const t = parseAudioFxTarget(target);
  const e = t ? audioFxEffect(fx, t.chainId, t.effectId) : undefined;
  if (!t || !e) return null;
  return { effect: AF_EFFECTS[e.kind].label, param: audioFxParam(e.kind, t.key)?.label ?? t.key };
}

// ── Editing ─────────────────────────────────────────────────────────────────

export function emptyAudioFx(): PlayAudioFx { return { chains: {} }; }
export function emptyChain(): AudioFxChain { return { on: true, effects: [] }; }

let seq = 0;
/** A new effect's id: short, unique in a session, no colons (it sits inside a target). */
export function audioFxId(kind: AudioFxKind): string {
  seq += 1;
  return `${kind}_${Date.now().toString(36)}${seq.toString(36)}`;
}

export function newAudioFxEffect(kind: AudioFxKind, id = audioFxId(kind)): AudioFxEffect {
  return afNewEffect(kind, id);
}

/** Change one chain (made when missing); an emptied chain that is on goes. */
export function patchChain(fx: PlayAudioFx | undefined, chainId: string, fn: (c: AudioFxChain) => AudioFxChain): PlayAudioFx {
  const base = fx ?? emptyAudioFx();
  const next = fn(base.chains[chainId] ?? emptyChain());
  const chains = { ...base.chains };
  if (!next.effects.length && next.on) delete chains[chainId]; else chains[chainId] = next;
  return { ...base, chains };
}

export function patchAudioFxEffect(fx: PlayAudioFx | undefined, chainId: string, effectId: string, change: Record<string, unknown>): PlayAudioFx | undefined {
  if (!fx?.chains[chainId]) return fx;
  return patchChain(fx, chainId, c => ({ ...c, effects: c.effects.map(e => (e.id === effectId ? { ...e, ...change } as AudioFxEffect : e)) }));
}

export function isAudioFxEmpty(fx: PlayAudioFx | undefined): boolean {
  return !fx || (Object.keys(fx.chains).length === 0 && fx.analyse !== 'pre');
}

/** The record as it is saved: undefined when there is nothing in it. */
export function tidyAudioFx(fx: PlayAudioFx | undefined): PlayAudioFx | undefined {
  return isAudioFxEmpty(fx) ? undefined : fx;
}

/** Every effect with its chain, in chain then stack order. */
export function audioFxEffects(fx: PlayAudioFx | undefined): Array<{ chainId: string; effect: AudioFxEffect }> {
  if (!fx) return [];
  return Object.entries(fx.chains).flatMap(([chainId, c]) => c.effects.map(effect => ({ chainId, effect })));
}

// ── Parsing ─────────────────────────────────────────────────────────────────

/**
 * A record's audio effects from a file: unknown chains and kinds dropped,
 * numbers clamped, options defaulted, effect ids made unique. Chains on a
 * layer that isn't in `layerIds` (when given) are dropped. Undefined when
 * nothing is left.
 */
export function parseAudioFx(raw: unknown, layerIds?: ReadonlySet<string>): PlayAudioFx | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as { chains?: unknown; analyse?: unknown };
  const out: PlayAudioFx = { chains: {} };
  if (r.analyse === 'pre') out.analyse = 'pre';
  const seen = new Set<string>();
  if (r.chains && typeof r.chains === 'object' && !Array.isArray(r.chains)) {
    for (const [id, c] of Object.entries(r.chains as Record<string, unknown>)) {
      if (!isChainId(id) || !c || typeof c !== 'object') continue;
      if (layerIds && id.startsWith('layer:') && !layerIds.has(id.slice(6))) continue;
      const list = Array.isArray((c as { effects?: unknown }).effects) ? (c as { effects: unknown[] }).effects : [];
      const effects: AudioFxEffect[] = [];
      list.forEach((x, i) => {
        const e = afNormaliseEffect(x, `fx${i}`);
        if (!e) return;
        let eid = e.id;
        for (let n = 2; seen.has(eid); n++) eid = `${e.id}_${n}`;
        seen.add(eid);
        effects.push({ ...e, id: eid });
      });
      const on = (c as { on?: unknown }).on !== false;
      if (effects.length || !on) out.chains[id] = { on, effects };
    }
  }
  return tidyAudioFx(out);
}

// ── Presets (this device) ───────────────────────────────────────────────────

export interface AudioFxPreset { id: string; name: string; chain: AudioFxChain }
const PRESETS_KEY = 'shader-studio:audioFxPresets';
export const AUDIO_FX_PRESETS_CHANGED = 'audiofx-presets-changed';

export function loadAudioFxPresets(): AudioFxPreset[] {
  try {
    const raw = JSON.parse(localStorage.getItem(PRESETS_KEY) ?? '[]') as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.flatMap(p => {
      if (!p || typeof p !== 'object' || typeof p.name !== 'string' || typeof p.id !== 'string') return [];
      const fx = parseAudioFx({ chains: { master: p.chain } });
      return fx?.chains.master ? [{ id: p.id, name: p.name, chain: fx.chains.master }] : [];
    });
  } catch { return []; }
}

function storePresets(list: AudioFxPreset[]): void {
  try { localStorage.setItem(PRESETS_KEY, JSON.stringify(list)); } catch { /* storage full or off */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(AUDIO_FX_PRESETS_CHANGED));
}

export function saveAudioFxPreset(name: string, chain: AudioFxChain): AudioFxPreset {
  const p: AudioFxPreset = { id: `afp_${Date.now().toString(36)}`, name: name.slice(0, 60), chain: { on: true, effects: chain.effects.map(e => ({ ...e })) } };
  storePresets([...loadAudioFxPresets(), p]);
  return p;
}

export function deleteAudioFxPreset(id: string): void {
  storePresets(loadAudioFxPresets().filter(p => p.id !== id));
}

/** A preset's effects with fresh ids, for a chain. */
export function presetEffects(p: AudioFxPreset): AudioFxEffect[] {
  return p.chain.effects.map(e => ({ ...e, id: audioFxId(e.kind) }));
}
