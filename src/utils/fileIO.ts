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
