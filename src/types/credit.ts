/**
 * credit.ts — where an example comes from: a book chapter, an article, a
 * shader by someone else. The examples lists show it under the name, the Play
 * page's Notes card shows it linked, and a Present block of that example
 * carries it as a caption (in exported pages too).
 *
 * It lives in two places: on the example's index entry (so lists can show it
 * without loading the graph) and on its Play record (PlayRecord.source), so it
 * travels with a saved copy, a play file and a presentation snapshot.
 */

export interface SourceCredit {
  /** The work: "The Book of Shaders", "GM Shaders Mini: CRT". */
  title: string;
  /** Who made it. */
  author?: string;
  /** Where to read it: an https:// address. */
  url: string;
  /** A book's chapter number. */
  chapter?: number;
  /** That chapter's title. */
  chapterTitle?: string;
  /** The most specific heading inside it the example follows. */
  section?: string;
}

const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);

/** A credit read from a file, or undefined when it isn't one (an address must be https). */
export function parseSourceCredit(v: unknown): SourceCredit | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const r = v as Record<string, unknown>;
  const title = str(r.title, 160), url = str(r.url, 500);
  if (!title || !url || !/^https:\/\/[^\s"'<>]+$/.test(url)) return undefined;
  const out: SourceCredit = { title, url };
  const author = str(r.author, 160), chapterTitle = str(r.chapterTitle, 160), section = str(r.section, 160);
  if (author) out.author = author;
  if (typeof r.chapter === 'number' && Number.isInteger(r.chapter) && r.chapter > 0 && r.chapter < 1000) out.chapter = r.chapter;
  if (chapterTitle) out.chapterTitle = chapterTitle;
  if (section) out.section = section;
  return out;
}

/**
 * The pieces after the title, most general first: "Ch. 5 · Shaping functions",
 * then the section when there is one. Lists use the last two; the Notes card
 * all of them.
 */
export function creditPlace(s: SourceCredit): string[] {
  const out: string[] = [];
  if (s.chapter !== undefined) out.push(s.chapterTitle ? `Ch. ${s.chapter} · ${s.chapterTitle}` : `Ch. ${s.chapter}`);
  else if (s.chapterTitle) out.push(s.chapterTitle);
  if (s.section && s.section !== s.chapterTitle) out.push(s.section);
  return out;
}

/**
 * One short line for lists: "The Book of Shaders · Ch. 5 · Step and Smoothstep".
 * `compact` (a narrow sidebar) leaves the work's title to the tooltip when
 * there is a chapter to show instead: "Ch. 5 · Step and Smoothstep".
 */
export function creditShort(s: SourceCredit, compact = false): string {
  const where = s.section && s.section !== s.chapterTitle ? s.section : s.chapterTitle;
  const chapter = s.chapter !== undefined ? `Ch. ${s.chapter}` : undefined;
  return [compact && (chapter || where) ? undefined : s.title, chapter, where].filter(Boolean).join(' · ');
}

/** The whole credit as a sentence, for tooltips and screen readers. */
export function creditSentence(s: SourceCredit): string {
  const parts = [s.author ? `${s.title} by ${s.author}` : s.title];
  if (s.chapter !== undefined) parts.push(`chapter ${s.chapter}${s.chapterTitle ? `, ${s.chapterTitle}` : ''}`);
  else if (s.chapterTitle) parts.push(s.chapterTitle);
  if (s.section && s.section !== s.chapterTitle) parts.push(`section “${s.section}”`);
  return `From ${parts.join(', ')}`;
}

/** The address without https://, for showing. */
export const creditHost = (s: SourceCredit) => s.url.replace(/^https:\/\//, '').replace(/\/$/, '');
