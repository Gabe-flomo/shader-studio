/**
 * webExport.ts — what an exported page needs to run the Audio nodes (docs/audio-tools.md, "On a web page"): each
 * Audio Source with its sound (a File's data URL, kept by lib/mediaSources.ts when it was loaded; a Video's sampler
 * uniform, whose element the page plays), bands and learned sounds; each effect (Filter, Resonator bank, Spectral) with
 * its place in its chain, whether it is heard and its settings; each listening node's settings (the same
 * listenerSpecOf the app's engine reads); and the shader uniforms and samplers they fill. The page runs them with
 * play/kit/audioTools.js and play/kit/audioChain.js, the app's own code (runtime/play-runtime.js).
 */
import type { GraphNode } from '../../types/nodeGraph';
import type { MediaSource } from '../mediaSources';
import type { PlayAudioTools } from '../../play/exportHtml';
import {
  AUDIO_SOURCE_TYPE, AUDIO_TEXTURE_TYPES, audioSoundsOf, audioSourceKind, audioTextureSize, effectSpecOf, isAudioFxType, listenerSpecOf,
} from '../../nodes/definitions/audioTools';
import { acTextureSize } from '../../play/kit/audioChain.js';
import { bandsOf } from './bands';
import { audioHearing, collectAudioNodes } from './graphWalk';

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export interface AudioToolsWebInput {
  nodes: readonly GraphNode[];
  /** The last compile's live uniforms (uniform → `<id>::<channel>`), samplers (sampler → id) and video samplers (sampler → id). */
  liveUniforms: Readonly<Record<string, string>>;
  textureUniforms: Readonly<Record<string, string>>;
  videoUniforms: Readonly<Record<string, string>>;
  /** The last compile's param uniforms (`<id>::<param>` → uniform): an effect's numbers, which a Play control can move. */
  paramBindings?: Readonly<Record<string, string>>;
  /** The file kept for a node id (lib/mediaSources.ts mediaSource). */
  mediaOf: (nodeId: string) => MediaSource | null;
  labelOf?: (node: GraphNode) => string;
}

/** The Audio nodes for a page, or undefined when the graph has none. */
export function audioToolsForWeb(o: AudioToolsWebInput): PlayAudioTools | undefined {
  const audio = collectAudioNodes(o.nodes);
  if (!audio.length) return undefined;
  const ids = new Set(audio.map(r => r.node.id));
  const label = (n: GraphNode) => o.labelOf?.(n) ?? ((typeof n.params.label === 'string' && n.params.label.trim()) || 'Audio Source');
  const kinds = new Map(audio.filter(r => r.node.type === AUDIO_SOURCE_TYPE).map(r => [r.node.id, audioSourceKind(r.node)]));
  const hearing = audioHearing(audio, id => kinds.get(id) ?? null);
  const sources: PlayAudioTools['sources'] = audio.filter(r => r.node.type === AUDIO_SOURCE_TYPE).map(({ node: n }) => {
    const kind = audioSourceKind(n), P = n.params;
    const m = kind === 'file' ? o.mediaOf(n.id) : null;
    const vid = typeof P.videoNode === 'string' ? P.videoNode : '';
    const video = kind === 'video' && vid ? Object.entries(o.videoUniforms).find(([, id]) => id === vid)?.[0] : undefined;
    return {
      id: n.id, kind, label: label(n), name: m?.name ?? (typeof P._fileName === 'string' ? P._fileName : ''),
      src: m?.dataUrl ?? null, bytes: m?.dataUrl?.length ?? (m?.tooBig ? m.bytes : 0),
      ...(video ? { video } : {}),
      playing: P.playing !== false, loop: P.loop !== false, trimIn: num(P.trimIn, 0), trimOut: num(P.trimOut, 0), gain: Math.max(0, num(P.gain, 1)),
      bands: bandsOf(P),
      // A sound still waiting to be learned matches nothing: it stays out.
      sounds: audioSoundsOf(P).filter(s => s.spec.length > 0),
      // An effect after it is heard instead (the app's rule, graphWalk.ts audioHearing).
      ...(hearing.dryMuted.has(n.id) ? { quiet: true } : {}),
    };
  });
  const effects: NonNullable<PlayAudioTools['effects']> = audio.filter(r => isAudioFxType(r.node.type)).map(({ node: n, sourceId }) => {
    const spec = effectSpecOf(n);
    const drive: Record<string, string> = {};
    for (const [key, u] of Object.entries(o.paramBindings ?? {})) if (key.startsWith(`${n.id}::`)) drive[key.slice(n.id.length + 2)] = u;
    return { id: n.id, upstreamId: sourceId, rootId: hearing.rootOf.get(n.id) ?? null, heard: hearing.heard.has(n.id), spec, ...acTextureSize(spec), drive };
  });
  const listeners: PlayAudioTools['listeners'] = audio.filter(r => r.node.type !== AUDIO_SOURCE_TYPE && !isAudioFxType(r.node.type)).map(({ node: n, sourceId }) => {
    const { w, h } = AUDIO_TEXTURE_TYPES.has(n.type) ? audioTextureSize(n) : { w: 0, h: 0 };
    return { id: n.id, sourceId, spec: listenerSpecOf(n), w, h };
  });
  const uniforms = Object.fromEntries(Object.entries(o.liveUniforms).filter(([, key]) => ids.has(key.slice(0, key.indexOf('::')))));
  const textures = Object.fromEntries(Object.entries(o.textureUniforms).filter(([, id]) => ids.has(id)));
  return { sources, listeners, ...(effects.length ? { effects } : {}), uniforms, textures };
}
