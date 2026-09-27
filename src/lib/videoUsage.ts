/**
 * videoUsage.ts — which Play setups use a kept video (a Video layer names it
 * by `videoId`), for the Library window: say so before deleting one, and
 * find the ones nothing uses. Saved graphs and presentations are read from
 * storage; the open graph's setup (maybe unsaved) is passed in.
 */
import type { PlayLayer } from '../types/play';

export interface VideoUse {
  /** "graph" (a saved graph's Play setup), "presentation" (a Play in one) or "open" (the setup on screen now). */
  kind: 'graph' | 'presentation' | 'open';
  label: string;
  /** How many of its Video layers use it. */
  layers: number;
}

interface ReadKV { keys(): string[]; get(k: string): string | null }

const GRAPH_PREFIX = 'shader-studio:';
const PRESENTATION_PREFIX = 'shader-studio-presentation:';

/** How many times a stored text names this video as a Video layer's file. */
export function countVideoRefs(raw: string, id: string): number {
  if (!id || !raw) return 0;
  return raw.split(`"videoId":${JSON.stringify(id)}`).length - 1;
}

/** Every use of each of these videos, by id. */
export function videoUses(ids: readonly string[], kv: ReadKV, open?: { name: string | null; layers: readonly PlayLayer[] } | null): Map<string, VideoUse[]> {
  const out = new Map<string, VideoUse[]>(ids.map(id => [id, []]));
  if (!ids.length) return out;
  const want = new Set(ids);
  const openName = open?.name ?? null;
  for (const k of kv.keys()) {
    let kind: VideoUse['kind'] | null = null, label = '';
    if (k.startsWith(PRESENTATION_PREFIX)) { kind = 'presentation'; label = k.slice(PRESENTATION_PREFIX.length); }
    else if (k.startsWith(GRAPH_PREFIX) && !k.startsWith('shader-studio:settings') && !k.startsWith('shader-studio:play:')) { kind = 'graph'; label = k.slice(GRAPH_PREFIX.length); }
    if (!kind) continue;
    // The open graph is counted from what's on screen (it may have changed since it was saved).
    if (kind === 'graph' && open && label === openName) continue;
    const raw = kv.get(k);
    if (!raw || !raw.includes('"videoId"')) continue;
    for (const id of want) {
      const n = countVideoRefs(raw, id);
      if (n) out.get(id)!.push({ kind, label, layers: n });
    }
  }
  if (open) {
    for (const l of open.layers) {
      if (l.kind !== 'video' || !want.has(l.videoId)) continue;
      const list = out.get(l.videoId)!;
      const had = list.find(u => u.kind === 'open');
      if (had) had.layers++; else list.unshift({ kind: 'open', label: openName ?? 'The open graph', layers: 1 });
    }
  }
  return out;
}

/** "Used by “Sunset” and the open graph" … for a confirmation. */
export function describeVideoUses(uses: readonly VideoUse[]): string {
  if (!uses.length) return 'Nothing uses it.';
  const names = uses.map(u => (u.kind === 'open' ? `the open graph${u.label && u.label !== 'The open graph' ? ` (“${u.label}”)` : ''}` : u.kind === 'presentation' ? `the presentation “${u.label}”` : `“${u.label}”`));
  const list = names.length <= 3 ? names.join(names.length === 2 ? ' and ' : ', ') : `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`;
  const layers = uses.reduce((n, u) => n + u.layers, 0);
  return `${layers === 1 ? 'A Video layer' : `${layers} Video layers`} in ${list} ${layers === 1 ? 'uses' : 'use'} it.`;
}

/** localStorage as a ReadKV (empty where there's none). */
export const browserKV: ReadKV = {
  keys: () => { try { return Object.keys(localStorage); } catch { return []; } },
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
};
