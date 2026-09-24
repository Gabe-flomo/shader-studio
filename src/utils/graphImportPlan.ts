/**
 * graphImportPlan.ts — turn a pile of picked files into saved graphs + folders.
 *
 * Works for a multi-file pick, a folder pick (browser `webkitdirectory` or a
 * Tauri directory), and the ZIP layout `exportBackupZip` writes
 * (`backup_<date>/graphs/[Folder]/name.json`). Pure: the store applies the plan.
 */

export interface PickedFile {
  /** Path relative to what was picked, with `/` separators (e.g. `Rings/fractal rings.json`). */
  path: string;
  content: string;
}

export interface PlannedGraph {
  name: string;
  /** Folder label, or null for the root of Saved Graphs. Nested dirs join with ` / `. */
  folder: string | null;
  payload: string;
}

export interface GraphImportPlan {
  graphs: PlannedGraph[];
  /** Files skipped and why (not JSON, not a graph, unreadable). */
  skipped: Array<{ path: string; reason: string }>;
}

/** Directory names that only describe the export, never a folder the user made. */
const STRUCTURAL_DIRS = new Set(['graphs', 'presets', 'functions', 'nodes']);

export function planGraphImport(files: PickedFile[], existingNames: string[]): GraphImportPlan {
  const graphs: PlannedGraph[] = [];
  const skipped: GraphImportPlan['skipped'] = [];
  const taken = new Set(existingNames);

  // Strip a common leading directory (the picked folder itself, or backup_<date>).
  const parts = files.map(f => f.path.split('/').filter(Boolean));
  const commonRoot = parts.length > 1 && parts.every(p => p.length > 1 && p[0] === parts[0][0]) ? 1
    : parts.length === 1 && parts[0].length > 1 ? 1 : 0;

  files.forEach((f, i) => {
    const segs = parts[i].slice(commonRoot);
    const file = segs[segs.length - 1] ?? f.path;
    if (!/\.json$/i.test(file)) { skipped.push({ path: f.path, reason: 'not a .json file' }); return; }
    let parsed: unknown;
    try { parsed = JSON.parse(f.content); } catch { skipped.push({ path: f.path, reason: 'not valid JSON' }); return; }
    if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { nodes?: unknown }).nodes)) {
      skipped.push({ path: f.path, reason: 'not a graph (no nodes array)' });
      return;
    }
    // Backup zips carry presets/functions beside graphs; only graphs belong here.
    const dirs = segs.slice(0, -1);
    if (dirs.length && STRUCTURAL_DIRS.has(dirs[0].toLowerCase()) && dirs[0].toLowerCase() !== 'graphs') {
      skipped.push({ path: f.path, reason: `${dirs[0]} are not graphs` });
      return;
    }
    const folderDirs = dirs.filter((d, idx) => !(idx === 0 && d.toLowerCase() === 'graphs'));
    const folder = folderDirs.length ? folderDirs.join(' / ') : null;

    let name = file.replace(/\.json$/i, '').trim() || 'graph';
    // A graph exported by the app may carry its own name; the file name wins for predictability.
    if (taken.has(name)) {
      let n = 2;
      while (taken.has(`${name} ${n}`)) n++;
      name = `${name} ${n}`;
    }
    taken.add(name);
    graphs.push({ name, folder, payload: f.content });
  });

  return { graphs, skipped };
}

/** Largest w×h box with the given ratio that fits inside outer. */
export function fitAspect(outerW: number, outerH: number, ratio: number): { width: number; height: number } {
  if (outerW <= 0 || outerH <= 0 || !(ratio > 0)) return { width: Math.max(0, outerW), height: Math.max(0, outerH) };
  const byWidth = { width: outerW, height: outerW / ratio };
  if (byWidth.height <= outerH) return { width: Math.floor(byWidth.width), height: Math.floor(byWidth.height) };
  return { width: Math.floor(outerH * ratio), height: Math.floor(outerH) };
}

export type PreviewAspect = 'free' | '1:1' | '16:9' | '9:16' | '4:3' | '3:4' | '4:5' | '21:9';
export const PREVIEW_ASPECTS: ReadonlyArray<{ id: PreviewAspect; label: string; ratio: number | null; hint: string }> = [
  { id: 'free',  label: 'Free',  ratio: null,   hint: 'Fill the preview panel' },
  { id: '1:1',   label: '1:1',   ratio: 1,      hint: 'Square' },
  { id: '16:9',  label: '16:9',  ratio: 16 / 9, hint: 'Landscape video' },
  { id: '9:16',  label: '9:16',  ratio: 9 / 16, hint: 'Portrait video, phones' },
  { id: '4:3',   label: '4:3',   ratio: 4 / 3,  hint: 'Classic landscape' },
  { id: '3:4',   label: '3:4',   ratio: 3 / 4,  hint: 'Classic portrait' },
  { id: '4:5',   label: '4:5',   ratio: 4 / 5,  hint: 'Social feed portrait' },
  { id: '21:9',  label: '21:9',  ratio: 21 / 9, hint: 'Ultra-wide' },
];
