/** Types for fetch-image-model.mjs (vite.config.ts uses it in a Tauri build). */
export interface ModelFile { path: string; bytes: number }
export function modelConfig(): { repo: string; revision: string; files: ModelFile[] };
export function cacheDir(repo: string): string;
export function missingFiles(): ModelFile[];
export function fetchImageModel(log?: (s: string) => void): Promise<string>;
