/**
 * fileIO.ts — Save / Open project files
 *
 * When running inside Tauri, uses native OS Save/Open dialogs via
 * @tauri-apps/plugin-dialog and @tauri-apps/plugin-fs.
 *
 * When running as a web app (GitHub Pages / npm run dev), falls back to the
 * classic browser download-link / hidden-file-input approach.
 */

// Detect Tauri: the __TAURI_INTERNALS__ global is injected by the Tauri runtime.
const isTauri = (): boolean =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

// ─── Save ─────────────────────────────────────────────────────────────────────

/**
 * Save `content` to a file chosen by the user.
 * - Tauri: native OS Save dialog, writes file to chosen path.
 * - Web:   triggers a browser download with the suggested filename.
 */
export async function saveTextFile(
  content: string,
  suggestedName = 'shader-graph.json',
): Promise<void> {
  if (isTauri()) {
    // Dynamic import so the web bundle never fails on these imports
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');

    const path = await save({
      defaultPath: suggestedName,
      filters: [{ name: 'Shader Graph', extensions: ['json'] }],
    });

    if (path) {
      await writeTextFile(path, content);
    }
  } else {
    // Browser fallback: blob download
    const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
    const a = Object.assign(document.createElement('a'), {
      href: url,
      download: suggestedName,
    });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}

// ─── Directory helpers (Tauri-only) ───────────────────────────────────────────

/**
 * Open a native folder-picker dialog.
 * Returns the chosen directory path, or null if cancelled / running on web.
 */
export async function pickDirectory(): Promise<string | null> {
  if (!isTauri()) return null;
  const { open } = await import('@tauri-apps/plugin-dialog');
  const result = await open({ directory: true, multiple: false });
  return typeof result === 'string' ? result : null;
}

/**
 * Read all `.json` files from a directory.
 * Returns an array of { name, content } objects, or [] on web.
 */
export async function readJsonFilesFromDir(
  dirPath: string,
): Promise<Array<{ name: string; content: string }>> {
  if (!isTauri()) return [];
  const { readDir, readTextFile } = await import('@tauri-apps/plugin-fs');
  const entries = await readDir(dirPath);
  const results: Array<{ name: string; content: string }> = [];
  for (const entry of entries) {
    if (!entry.name?.endsWith('.json')) continue;
    try {
      const content = await readTextFile(`${dirPath}/${entry.name}`);
      results.push({ name: entry.name, content });
    } catch {}
  }
  return results;
}

/**
 * Write text content to an absolute file path.
 * No-op on web.
 */
export async function writeTextFileAtPath(filePath: string, content: string): Promise<void> {
  if (!isTauri()) return;
  const { writeTextFile } = await import('@tauri-apps/plugin-fs');
  await writeTextFile(filePath, content);
}

/**
 * Delete a file at an absolute path.
 * No-op on web or if file doesn't exist.
 */
export async function deleteFileAtPath(filePath: string): Promise<void> {
  if (!isTauri()) return;
  try {
    const { remove } = await import('@tauri-apps/plugin-fs');
    await remove(filePath);
  } catch {}
}

// ─── Open ─────────────────────────────────────────────────────────────────────

/**
 * Let the user pick a file and return its text content.
 * - Tauri: native OS Open dialog, reads file from chosen path.
 * - Web:   hidden <input type="file"> picker.
 * Returns `null` if the user cancels.
 */
export async function openTextFile(
  accept = '.json',
): Promise<string | null> {
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const { readTextFile } = await import('@tauri-apps/plugin-fs');

    const path = await open({
      multiple: false,
      filters: [{ name: 'Shader Graph', extensions: ['json'] }],
    });

    if (typeof path === 'string') {
      return await readTextFile(path);
    }
    return null;
  } else {
    // Browser fallback: hidden file input
    return new Promise<string | null>((resolve) => {
      const input = Object.assign(document.createElement('input'), {
        type: 'file',
        accept,
        style: 'display:none',
      });
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) return resolve(null);
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => resolve(null);
        reader.readAsText(file);
      };
      input.oncancel = () => resolve(null);
      document.body.appendChild(input);
      input.click();
      document.body.removeChild(input);
    });
  }
}
