/**
 * dataExport.ts — the datasets a web page (and a Present snapshot) carries:
 * each one's frozen result, with Normalize applied, and its name. Never the
 * notebook or the file it came from: pages stay small and run no kernel.
 *
 * A dataset goes along when something on the page reads it: a Data layer, a
 * data mapping source, a Data node (the shader declares its textures), or a
 * Script layer or sketch whose code names it in quotes (s.data('Sales')).
 * Pure, so the export, Present and the tests share it.
 */
import { dataBindingsFromShader } from '../data/dataGlsl';
import { normalizeTable } from '../data/normalize';
import type { DatasetResult, DatasetsRecord } from '../data/types';
import type { PlayRecord } from '../types/play';
import { streamExportPlan, type StreamExport } from '../data/streams/exportPlan';

/** A live feed a page connects to itself (a stream set to Reconnect): the runtime adds its rows to the carried window. */
export type WebStream = NonNullable<StreamExport['connect']> & { normalize: boolean };

/**
 * A dataset as a page carries it. A live dataset carries its window as it is
 * now; `stream` when the page reconnects to the feed, and `note` (for the
 * export's list) either way.
 */
export interface WebDataset { name: string; result: DatasetResult | null; stream?: WebStream; note?: { what: string; why: string } }
export type WebDatasets = Record<string, WebDataset>;

const quoted = (code: string, name: string) => {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(['"\`])${esc}\\1`, 'i').test(code);
};

/** The ids of the datasets something in the setup (or the shaders) reads. */
export function datasetsUsed(datasets: DatasetsRecord, play: PlayRecord, shaders: readonly string[] = []): string[] {
  const out = new Set<string>();
  for (const l of play.layers) if (l.kind === 'data' && l.dataset && datasets[l.dataset]) out.add(l.dataset);
  for (const m of play.mappings) if (m.source.kind === 'data' && datasets[m.source.dataset]) out.add(m.source.dataset);
  for (const fs of shaders) {
    const b = dataBindingsFromShader(fs);
    for (const t of b.textures) if (datasets[t.dataset]) out.add(t.dataset);
    for (const c of b.counts) if (datasets[c.dataset]) out.add(c.dataset);
  }
  const code: string[] = [];
  for (const l of play.layers) {
    if (l.kind === 'script') code.push(l.code);
    if (l.kind === 'background') for (const s of l.sources) if (s.kind === 'script' && s.code) code.push(s.code);
  }
  const all = code.join('\n');
  if (all.includes('data(')) for (const d of Object.values(datasets)) if (quoted(all, d.id) || quoted(all, d.name)) out.add(d.id);
  return [...out].sort();
}

/**
 * The datasets a page needs, as it carries them: the result readers see
 * (Normalize applied) and the name. `live` gives a stream's result now (its
 * window isn't saved on every message); a stream's own export setting says
 * whether the page reconnects or keeps that window (streams/exportPlan.ts).
 */
export function datasetsForWeb(datasets: DatasetsRecord, play: PlayRecord, shaders: readonly string[] = [], opts: { live?: (id: string) => DatasetResult | null } = {}): WebDatasets {
  const out: WebDatasets = {};
  for (const id of datasetsUsed(datasets, play, shaders)) {
    const d = datasets[id];
    const plan = d.source.kind === 'stream' ? streamExportPlan(d, opts.live?.(id) ?? null) : null;
    const r = plan ? plan.result : d.result;
    out[id] = {
      // A stream the page reconnects to carries its window raw: the page adds rows to it, then normalizes.
      name: d.name, result: r && r.kind === 'table' && d.normalize && !plan?.connect ? normalizeTable(r) : r,
      ...(plan?.connect ? { stream: { ...plan.connect, normalize: d.normalize } } : {}),
      ...(plan ? { note: plan.note } : {}),
    };
  }
  return out;
}

/** What a page's datasets add to it, for the export dialogs. */
export function datasetsCarried(datasets: WebDatasets | undefined): { what: string; bytes: number }[] {
  return Object.values(datasets ?? {}).filter(d => d.result).map(d => ({ what: `Dataset “${d.name}” (its result)`, bytes: JSON.stringify(d.result).length }));
}
