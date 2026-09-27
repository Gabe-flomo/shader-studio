/**
 * build — a p5 project, read and rewritten, as a Script layer.
 *
 * The patch is what a Script layer needs to run the sketch the p5 way:
 * sketch.js and its other tabs, the bundled assets, 2D or 3D, `p5: true`.
 * p5 keeps what was drawn between frames, so the layer does not clear. The
 * report is the counts the import dialog shows.
 */

import type { P5Analysis } from './analyze';
import { assetToRecord, P5_MAIN_FILE, type P5AssetRecord, type P5File, type P5Project } from './project';
import type { P5RewriteResult } from './controls';

/** The Script layer fields an imported sketch sets. */
export interface P5LayerPatch {
  label: string;
  /** sketch.js. */
  code: string;
  /** The other tabs, run before sketch.js in this order. */
  files: P5File[];
  assets: P5AssetRecord[];
  mode: '2d' | '3d';
  p5: true;
  clear: false;
  readPicture: false;
}

/** What the import did, in numbers, for the dialog. */
export interface P5ImportReport {
  files: number;
  assets: number;
  assetsTooBig: number;
  skipped: number;
  supported: number;
  mapped: number;
  stubbed: number;
  unsupported: number;
  /** Unsupported names that stop the sketch (not just warnings). */
  errors: number;
  warnings: number;
  syntaxErrors: number;
  controls: number;
  mode: '2d' | '3d';
  instance: boolean;
}

export interface P5LayerBuild { patch: P5LayerPatch; startAt: Record<string, number>; report: P5ImportReport }

/**
 * The Script layer for a project. `rewrite`: the files after mapDomControls /
 * applyControls (the project's own files when absent). `assets`: records to
 * use instead of the plain ones (saveImagesToLibrary's, matched by name).
 */
export function buildP5Layer(project: P5Project, analysis: P5Analysis, rewrite?: Pick<P5RewriteResult, 'files' | 'startAt' | 'entries'> | null, opts: { assets?: P5AssetRecord[] } = {}): P5LayerBuild {
  const all: P5File[] = rewrite?.files ?? [...project.files.map(f => ({ name: f.name, code: f.code })), { name: P5_MAIN_FILE, code: project.main.code }];
  const main = all.find(f => f.name === P5_MAIN_FILE) ?? { name: P5_MAIN_FILE, code: '' };
  const files = all.filter(f => f.name !== P5_MAIN_FILE).map(f => ({ name: f.name, code: f.code }));
  const given = new Map((opts.assets ?? []).map(a => [a.name, a]));
  const assets = project.assets.filter(a => !a.tooBig).map(a => given.get(a.name) ?? assetToRecord(a));
  const count = (s: string) => analysis.items.filter(i => i.status === s).length;
  const report: P5ImportReport = {
    files: all.length,
    assets: assets.length,
    assetsTooBig: project.assets.filter(a => a.tooBig).length,
    skipped: project.skipped.length,
    supported: count('supported'),
    mapped: count('mapped'),
    stubbed: count('stubbed'),
    unsupported: count('unsupported'),
    errors: analysis.items.filter(i => i.severity === 'error').length,
    warnings: analysis.warnings.length + project.warnings.length + analysis.items.filter(i => i.severity === 'warning').length,
    syntaxErrors: analysis.syntaxErrors.length,
    controls: rewrite?.entries?.length ?? Object.keys(rewrite?.startAt ?? {}).length,
    mode: analysis.mode,
    instance: analysis.instance,
  };
  return {
    patch: { label: project.title, code: main.code, files, assets, mode: analysis.mode, p5: true, clear: false, readPicture: false },
    startAt: { ...(rewrite?.startAt ?? {}) },
    report,
  };
}

/** Two rewrites one after the other (DOM controls, then chosen controls): the second's files, both sets of starts, entries and notes. */
export function combineRewrites(a: P5RewriteResult, b: P5RewriteResult): P5RewriteResult {
  return { files: b.files, startAt: { ...a.startAt, ...b.startAt }, entries: [...a.entries, ...b.entries], notes: [...a.notes, ...b.notes] };
}
