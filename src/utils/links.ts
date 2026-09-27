/**
 * links.ts — web links inside text people write (Play notes, node comments).
 *
 * Two forms become links: Markdown `[words](https://…)` and a bare
 * `https://…` / `http://…` address. Only http(s) addresses are ever links:
 * `javascript:`, `data:`, `file:` and friends stay plain text, so a shared
 * file can't smuggle a script into a click.
 */

/** The longest address kept (anything longer is left as text). */
const MAX_URL = 2000;

/**
 * An address that is safe to open: http:// or https://, a host, no spaces,
 * quotes, angle brackets or control characters. Returns it normalised (as the
 * URL parser writes it), or null.
 */
export function safeHttpUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s || s.length > MAX_URL) return null;
  // Checked on the text itself first: the URL parser would quietly strip tabs and newlines.
  if (!/^https?:\/\//i.test(s)) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\s"'<>`\\\u0000-\u001f\u007f]/.test(s)) return null;
  let u: URL;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (!u.hostname || u.username || u.password) return null;
  return u.href;
}

/** Text typed into an "address" field: adds https:// to "example.com/page", then checks it. */
export function normaliseTypedUrl(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) && !/^https?:\/\//i.test(s)) return null; // another scheme
  return safeHttpUrl(/^https?:\/\//i.test(s) ? s : `https://${s}`);
}

export type LinkSegment = { text: string; url?: undefined } | { text: string; url: string };

// [words](address) | a bare address. The bare form stops at whitespace and brackets.
const LINK_RE = /\[([^\]\n]{1,300})\]\(\s*([^()\s]{1,2000})\s*\)|\bhttps?:\/\/[^\s<>"'`()[\]]+/gi;

/** Trailing punctuation that ends a sentence, not the address. */
function trimTrailing(url: string): string {
  return url.replace(/[.,;:!?]+$/, '');
}

/**
 * The text split into plain runs and links, in order. A Markdown link whose
 * address isn't http(s) stays as its literal text.
 */
export function parseLinks(text: string): LinkSegment[] {
  const out: LinkSegment[] = [];
  const push = (t: string) => {
    if (!t) return;
    const prev = out[out.length - 1];
    if (prev && !prev.url) prev.text += t; else out.push({ text: t });
  };
  let last = 0;
  for (const m of text.matchAll(LINK_RE)) {
    const at = m.index ?? 0;
    push(text.slice(last, at));
    if (m[1] !== undefined) {
      const url = safeHttpUrl(m[2]);
      if (url) out.push({ text: m[1], url });
      else push(m[0]);
      last = at + m[0].length;
    } else {
      const bare = trimTrailing(m[0]);
      const url = safeHttpUrl(bare);
      if (url) out.push({ text: bare.replace(/^https?:\/\//i, '').replace(/\/$/, ''), url });
      else push(bare);
      last = at + bare.length;
    }
  }
  push(text.slice(last));
  return out;
}

/** Does this text contain at least one link? */
export const hasLinks = (text: string) => parseLinks(text).some(s => s.url);

/**
 * Put a Markdown link into a text field's value: the selected words become the
 * link text (or `label`, or the address itself when nothing is selected).
 * Returns the new value and where the selection should go (around the words).
 */
export function insertLink(value: string, start: number, end: number, url: string, label?: string): { value: string; start: number; end: number } {
  const a = Math.max(0, Math.min(start, end, value.length));
  const b = Math.max(a, Math.min(Math.max(start, end), value.length));
  // Brackets inside the words would end the link early.
  const words = (value.slice(a, b) || label || '').replace(/[[\]]/g, '').replace(/\s*\n\s*/g, ' ').trim();
  const insert = words ? `[${words}](${url})` : url;
  const next = value.slice(0, a) + insert + value.slice(b);
  return words ? { value: next, start: a + 1, end: a + 1 + words.length } : { value: next, start: a + insert.length, end: a + insert.length };
}
