/**
 * linkedUi.ts — open the "From a linked folder" picker from anywhere and get
 * the answer back (a promise), like openBackgrounds:
 *
 *   openLinkedPicker({ filter, title?, mode? }) → LinkedPick | null
 *     mode 'file' (default): pick one file the picker takes (`filter`).
 *     mode 'folder': pick a folder; the answer has its files that take `filter`
 *     (a drum kit's "Load a folder onto pads").
 *
 * <LinkedPickerHost /> (mounted once, next to the BackgroundsHost) renders it;
 * its code loads on first use. Every picker in the app uses this one window,
 * so linked folders look and work the same wherever an asset is chosen.
 */
import { create } from 'zustand';
import type { LinkedEntry } from '../../files/linkedFolders';
import type { LinkedFilter } from '../../files/linkedRefs';

export type LinkedPick =
  | { kind: 'file'; ref: string; folderId: string; entry: LinkedEntry }
  | { kind: 'folder'; folderId: string; dir: string; files: LinkedEntry[] };

export interface LinkedPickerRequest {
  key: number;
  filter: LinkedFilter;
  title?: string;
  mode: 'file' | 'folder';
  /** Start in this folder (a relink starts where the file was). */
  folderId?: string;
  dir?: string;
  resolve: (p: LinkedPick | null) => void;
}

export const useLinkedPickerUi = create<{ stack: LinkedPickerRequest[] }>(() => ({ stack: [] }));
let seq = 0;

export function openLinkedPicker(o: { filter: LinkedFilter; title?: string; mode?: 'file' | 'folder'; folderId?: string; dir?: string }): Promise<LinkedPick | null> {
  return new Promise(resolve => useLinkedPickerUi.setState(s => ({ stack: [...s.stack, { key: ++seq, mode: 'file', ...o, resolve }] })));
}

export function closeLinkedPicker(key: number): void {
  useLinkedPickerUi.setState(s => ({ stack: s.stack.filter(r => r.key !== key) }));
}

/** A file's size in words. */
export const sizeWords = (b: number) => (b >= 1024 * 1024 ? `${(b / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
/** Seconds as m:ss.s under a minute's precision. */
export const lengthWords = (s: number) => { const m = Math.floor(s / 60), r = s - m * 60; return m ? `${m}:${r < 10 ? '0' : ''}${r.toFixed(0)}` : `${r.toFixed(r < 10 ? 2 : 1)} s`; };

export const FILTER_WORDS: Record<LinkedFilter, { one: string; many: string; a: string }> = {
  any: { one: 'file', many: 'files', a: 'a file' },
  image: { one: 'image', many: 'images', a: 'an image' },
  video: { one: 'video', many: 'videos', a: 'a video' },
  audio: { one: 'sound', many: 'sounds', a: 'a sound' },
  font: { one: 'font', many: 'fonts', a: 'a font' },
};
