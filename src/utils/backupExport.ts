/**
 * backupExport.ts
 *
 * Collects saved graphs, group presets, and custom functions from localStorage,
 * respects the in-app folder structure, and bundles everything into a ZIP.
 *
 * ZIP layout:
 *   backup_<date>/
 *     graphs/
 *       [Folder Name]/graph-name.json
 *       graph-name.json              (unfiled)
 *     presets/
 *       [Folder Name]/preset-label.json
 *       preset-label.json
 *     functions/
 *       [Folder Name]/fn-label.json
 *       fn-label.json
 */

import { zipSync, strToU8 } from 'fflate';
import { loadFolders, getMembership } from './assetFolders';
import type { CustomFnPreset } from '../types/customFnPreset';
import type { GroupPreset } from '../types/groupPreset';

// ── Storage key constants (mirrors useNodeGraphStore) ─────────────────────────
const CFP_PREFIX  = 'shader-studio:cfp:';
const GP_PREFIX   = 'shader-studio:gp:';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Sanitise a user-provided label to be a safe filename component. */
function toSafeFilename(label: string): string {
  return label
    .trim()
    .replace(/[/\\:*?"<>|]/g, '-')   // strip forbidden chars
    .replace(/\s+/g, '_')             // spaces → underscores
    .replace(/-{2,}/g, '-')           // collapse double dashes
    .slice(0, 80)                     // cap length
    || 'unnamed';
}

/**
 * Build a lookup: folderId → folderLabel for a given scope.
 */
function folderLabelMap(scopeKey: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const f of loadFolders(scopeKey)) m.set(f.id, f.label);
  return m;
}

// ── Data collectors ───────────────────────────────────────────────────────────

interface ZipEntry {
  /** Path inside the ZIP (e.g. "graphs/My Folder/my-graph.json") */
  path: string;
  content: string;
}

function collectGraphs(basePath: string): ZipEntry[] {
  const membership = getMembership('graphs');
  const folderLabels = folderLabelMap('graphs');
  const entries: ZipEntry[] = [];

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith('shader-studio:')) continue;
    // Skip known non-graph prefixes
    if (key.startsWith(CFP_PREFIX) || key.startsWith(GP_PREFIX) ||
        key.startsWith('shader-studio:ep:') || key.startsWith('shader-studio:tp:') ||
        key.startsWith('shader-studio:settings:')) continue;

    const raw = localStorage.getItem(key);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed?.nodes)) continue; // not a graph
    } catch { continue; }

    const graphName = key.slice('shader-studio:'.length);
    const folderId = membership[graphName];
    const folderLabel = folderId ? folderLabels.get(folderId) : undefined;
    const fileName = toSafeFilename(graphName) + '.json';
    const dir = folderLabel
      ? `${basePath}/${toSafeFilename(folderLabel)}`
      : basePath;

    entries.push({ path: `${dir}/${fileName}`, content: raw });
  }

  return entries;
}

function collectGroupPresets(basePath: string): ZipEntry[] {
  const membership = getMembership('presets:group');
  const folderLabels = folderLabelMap('presets:group');
  const entries: ZipEntry[] = [];

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(GP_PREFIX)) continue;
    const raw = localStorage.getItem(key);
    if (!raw) continue;

    let preset: GroupPreset;
    try { preset = JSON.parse(raw); } catch { continue; }

    const folderId = membership[preset.id];
    const folderLabel = folderId ? folderLabels.get(folderId) : undefined;
    const fileName = toSafeFilename(preset.label) + '.json';
    const dir = folderLabel
      ? `${basePath}/${toSafeFilename(folderLabel)}`
      : basePath;

    entries.push({ path: `${dir}/${fileName}`, content: raw });
  }

  return entries;
}

function collectFunctions(basePath: string): ZipEntry[] {
  const membership = getMembership('functions');
  const folderLabels = folderLabelMap('functions');
  const entries: ZipEntry[] = [];

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(CFP_PREFIX)) continue;
    const raw = localStorage.getItem(key);
    if (!raw) continue;

    let preset: CustomFnPreset;
    try { preset = JSON.parse(raw); } catch { continue; }

    const folderId = membership[preset.id];
    const folderLabel = folderId ? folderLabels.get(folderId) : undefined;
    const fileName = toSafeFilename(preset.label) + '.json';
    const dir = folderLabel
      ? `${basePath}/${toSafeFilename(folderLabel)}`
      : basePath;

    entries.push({ path: `${dir}/${fileName}`, content: raw });
  }

  return entries;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Bundle all saved graphs, group presets, and custom functions into a ZIP
 * and trigger a browser download (or Tauri native save dialog).
 *
 * Returns the number of files included.
 */
export async function exportBackupZip(): Promise<number> {
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  const root = `backup_${dateStr}`;

  const allEntries: ZipEntry[] = [
    ...collectGraphs(`${root}/graphs`),
    ...collectGroupPresets(`${root}/presets`),
    ...collectFunctions(`${root}/functions`),
  ];

  if (allEntries.length === 0) return 0;

  // Build the fflate zip input (Record<path, Uint8Array>)
  const zipInput: Record<string, Uint8Array> = {};
  for (const { path, content } of allEntries) {
    zipInput[path] = strToU8(content);
  }

  const zipped = zipSync(zipInput, { level: 6 });
  const blob = new Blob([zipped.slice().buffer], { type: 'application/zip' });
  const zipName = `shader-studio-backup_${dateStr}.zip`;

  const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  if (isTauri) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { writeFile } = await import('@tauri-apps/plugin-fs');
    const path = await save({
      defaultPath: zipName,
      filters: [{ name: 'ZIP Archive', extensions: ['zip'] }],
    });
    if (path) {
      await writeFile(path, new Uint8Array(zipped));
    }
  } else {
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: zipName });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return allEntries.length;
}
