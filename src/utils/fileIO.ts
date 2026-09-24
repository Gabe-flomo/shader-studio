/**
 * fileIO.ts — Save / Open project files
 *
 * When running inside Tauri, uses native OS Save/Open dialogs via
 * @tauri-apps/plugin-dialog and @tauri-apps/plugin-fs.
 *
 * When running as a web app (GitHub Pages / npm run dev), falls back to the
 * classic browser download-link / hidden-file-input approach.
 */

// ─── Result type ──────────────────────────────────────────────────────────────

/**
 * Outcome of a user-facing file / storage operation. Failures carry a message
 * a UI can show verbatim; `cancelled` marks the user backing out of a dialog,
 * which a UI should treat as a no-op rather than an error.
 */
export type FileResult =
  | { ok: true }
  | { ok: false; error: string; cancelled?: boolean };

export const CANCELLED: FileResult = { ok: false, error: 'Cancelled', cancelled: true };

/** Human-readable message for an unknown thrown value. */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message || e.name;
  if (typeof e === 'string') return e;
  try { return JSON.stringify(e); } catch { return String(e); }
}

/**
 * Is this a localStorage quota error? Browsers disagree on the name/code, so
 * check all the common spellings.
 */
export function isQuotaError(e: unknown): boolean {
  if (!(e instanceof DOMException)) return false;
  return e.name === 'QuotaExceededError' ||
    e.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    e.code === 22 || e.code === 1014;
}

/**
 * localStorage.setItem that reports failure instead of throwing. Quota
 * exhaustion (or storage being disabled in a private window) is the usual
 * cause; the message says so because "QuotaExceededError" alone means little
 * to a user.
 */
export function safeSetItem(key: string, value: string, what = 'data'): FileResult {
  try {
    localStorage.setItem(key, value);
    return { ok: true };
  } catch (e) {
    const error = isQuotaError(e)
      ? `Could not save ${what}: browser storage is full. Delete some saved graphs or presets and try again.`
      : `Could not save ${what} to browser storage: ${errorMessage(e)}`;
    console.error('[fileIO] localStorage.setItem failed', key, e);
    return { ok: false, error };
  }
}

// Detect Tauri: the __TAURI_INTERNALS__ global is injected by the Tauri runtime.
const isTauri = (): boolean =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

// ─── Save ─────────────────────────────────────────────────────────────────────

/**
 * Save `content` to a file chosen by the user.
 * - Tauri: native OS Save dialog, writes file to chosen path.
 * - Web:   triggers a browser download with the suggested filename.
 *
 * Never throws: a rejected dialog or failed write comes back as
 * `{ ok: false, error }`, and backing out of the dialog as `cancelled`.
 */
export async function saveTextFile(
  content: string,
  suggestedName = 'shader-graph.json',
): Promise<FileResult> {
  if (isTauri()) {
    try {
      // Dynamic import so the web bundle never fails on these imports
      const { save } = await import('@tauri-apps/plugin-dialog');
      const { writeTextFile } = await import('@tauri-apps/plugin-fs');

      const path = await save({
        defaultPath: suggestedName,
        filters: [{ name: 'Shader Graph', extensions: ['json'] }],
      });

      if (!path) return CANCELLED;
      await writeTextFile(path, content);
      return { ok: true };
    } catch (e) {
      console.error('[fileIO] saveTextFile failed', e);
      return { ok: false, error: `Could not save "${suggestedName}": ${errorMessage(e)}` };
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
    return { ok: true };
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
 * No-op on web. Rejects (with the plugin-fs error) when the write fails —
 * callers await it and report.
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
 * Returns `null` if the user cancels. Rejects with a descriptive Error when
 * the dialog or the read itself fails — a cancel and a failure are different
 * outcomes and callers should be able to tell them apart.
 */
export async function openTextFile(
  accept = '.json',
): Promise<string | null> {
  if (isTauri()) {
    let path: string | string[] | null;
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      path = await open({
        multiple: false,
        filters: [{ name: 'Shader Graph', extensions: ['json'] }],
      });
    } catch (e) {
      console.error('[fileIO] open dialog failed', e);
      throw new Error(`Could not open the file dialog: ${errorMessage(e)}`);
    }

    if (typeof path !== 'string') return null;
    try {
      const { readTextFile } = await import('@tauri-apps/plugin-fs');
      return await readTextFile(path);
    } catch (e) {
      console.error('[fileIO] readTextFile failed', path, e);
      throw new Error(`Could not read "${path}": ${errorMessage(e)}`);
    }
  } else {
    // Browser fallback: hidden file input. input.click() opens the OS
    // picker asynchronously — removing the input right after calling it
    // (the old code did) detaches it from the DOM before the user has
    // actually picked a file, and mobile Safari then silently drops the
    // 'change' event instead of firing it on a detached element. Keep the
    // input mounted until a handler actually resolves the promise.
    return new Promise<string | null>((resolve, reject) => {
      const input = Object.assign(document.createElement('input'), {
        type: 'file',
        accept,
        style: 'display:none',
      });
      const cleanup = () => { input.remove(); };
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) { cleanup(); return resolve(null); }
        const reader = new FileReader();
        reader.onload = () => { cleanup(); resolve(reader.result as string); };
        reader.onerror = () => {
          cleanup();
          console.error('[fileIO] FileReader failed', file.name, reader.error);
          reject(new Error(`Could not read "${file.name}": ${reader.error?.message || 'unknown read error'}`));
        };
        reader.readAsText(file);
      };
      input.oncancel = () => { cleanup(); resolve(null); };
      document.body.appendChild(input);
      input.click();
    });
  }
}
