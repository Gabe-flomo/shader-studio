/**
 * texturePaste.ts — ⌘V / Ctrl+V a picture into the graph (docs/texture-node.md, "Pasting a picture").
 *
 * - **Onto a Texture node** (the card under the pointer, else the selected Texture node):
 *   image data on the clipboard (the browser's Copy Image) is loaded as it is (no fetch, so no
 *   CORS); an image link is fetched as the card's Load does; a page link says it isn't a picture.
 * - **Anywhere else on the canvas:** a new Texture node in view, showing the picture. A link is
 *   fetched first, so a link that fails adds nothing.
 *
 * The node keeps the link as its source (`params._imageUrl`); Copy Image usually brings the
 * picture's address along in its HTML, so a pasted picture keeps it too.
 *
 * The reading (`readClipboardPicture`, `pasteTarget`) is pure; `pasteIntoGraph` does the work.
 */
import type { GraphNode } from '../../types/nodeGraph';

export type ClipboardPicture =
  | { kind: 'image'; blob: Blob; name: string; url?: string }
  | { kind: 'url'; url: string };

/** The part of a DataTransfer this reads (a ClipboardEvent's clipboardData). */
export interface ClipboardLike {
  items?: ArrayLike<{ kind: string; type: string; getAsFile(): File | null }> | null;
  files?: ArrayLike<File> | null;
  getData(type: string): string;
}

const LINK = /^(https?:\/\/\S+|data:image\/[a-z0-9.+-]+[;,]\S+)$/i;

const decodeEntities = (s: string) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

/** The `src` of the first <img> in copied HTML (Copy Image puts one there), when it's a web link. */
export function imageSrcInHtml(html: string): string | undefined {
  const m = /<img\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(html);
  const src = m ? decodeEntities((m[1] ?? m[2] ?? m[3] ?? '').trim()) : '';
  return /^https?:\/\//i.test(src) ? src : undefined;
}

/** A link's file name without its extension ('' when it has none worth keeping). */
export function nameFromUrl(url: string | undefined): string {
  if (!url) return '';
  try {
    const u = new URL(url);
    const last = decodeURIComponent(u.pathname.split('/').pop() ?? '').replace(/\.[a-z0-9]{2,5}$/i, '').slice(0, 120);
    return last && !/^[\d\s_-]+$/.test(last) ? last : u.hostname.replace(/^www\./, '');
  } catch { return ''; }
}

/**
 * What a paste carries that a Texture node can show: image data first (it always loads),
 * else one link (from text/uri-list or the plain text). Null for anything else (plain text,
 * several words, a file that isn't a picture), so the paste goes on as usual.
 */
export function readClipboardPicture(dt: ClipboardLike | null | undefined): ClipboardPicture | null {
  if (!dt) return null;
  const html = (() => { try { return dt.getData('text/html') || ''; } catch { return ''; } })();
  let file: File | null = null;
  for (const it of Array.from(dt.items ?? [])) {
    if (it.kind === 'file' && /^image\//i.test(it.type)) { file = it.getAsFile(); if (file) break; }
  }
  if (!file) file = Array.from(dt.files ?? []).find(f => /^image\//i.test(f.type)) ?? null;
  if (file && file.size > 0) {
    const url = imageSrcInHtml(html);
    const own = file.name && !/^image\.(png|jpe?g|gif|webp|bmp|tiff?)$/i.test(file.name) ? file.name.replace(/\.[a-z0-9]{2,5}$/i, '') : '';
    return { kind: 'image', blob: file, name: own || nameFromUrl(url) || 'Pasted picture', ...(url ? { url } : {}) };
  }
  const get = (t: string) => { try { return dt.getData(t) || ''; } catch { return ''; } };
  const uriList = get('text/uri-list').split(/\r?\n/).map(l => l.trim()).find(l => l && !l.startsWith('#')) ?? '';
  const text = (uriList || get('text/plain')).trim();
  if (LINK.test(text)) return { kind: 'url', url: text };
  // Copied HTML with only a picture in it (some apps put no plain text alongside).
  const fromHtml = imageSrcInHtml(html);
  return fromHtml && !text ? { kind: 'url', url: fromHtml } : null;
}

/**
 * Which Texture node a paste goes to: the card under the pointer, else the one selected node
 * when it's a Texture node; null means "add a new Texture node".
 */
export function pasteTarget(nodes: readonly GraphNode[], hoveredId: string | null, selectedIds: readonly string[], selectedId: string | null): string | null {
  const isTexture = (id: string | null) => !!id && nodes.some(n => n.id === id && (n.type === 'textureInput' || n.type === 'videoInput'));
  if (isTexture(hoveredId)) return hoveredId;
  const sel = selectedIds.length === 1 ? selectedIds[0] : selectedIds.length === 0 ? selectedId : null;
  return isTexture(sel) ? sel : null;
}

/** Whether a paste event belongs to a text field (or other editable thing) rather than the canvas. */
export function isEditableTarget(el: Element | null | undefined): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  const h = el as HTMLElement;
  return !!h.isContentEditable || !!el.closest?.('[contenteditable=""], [contenteditable="true"], .cm-editor, .monaco-editor');
}

// ── Cards that show their own progress ─────────────────────────────────────

type Job = () => Promise<void>;
type CardRunner = (label: string, job: Job) => Promise<void>;
const cards = new Map<string, CardRunner>();

/** A mounted Texture card runs pastes for its node itself, so busy and errors show on it. */
export function onTexturePaste(nodeId: string, run: CardRunner): () => void {
  cards.set(nodeId, run);
  return () => { if (cards.get(nodeId) === run) cards.delete(nodeId); };
}

/** Hand a paste to the node's card (or run it here, with `fallback` reporting the outcome). */
export async function runOnCard(nodeId: string, label: string, job: Job, fallback: (err: unknown) => void): Promise<void> {
  const card = cards.get(nodeId);
  if (card) return card(label, job);
  try { await job(); } catch (e) { fallback(e); }
}
