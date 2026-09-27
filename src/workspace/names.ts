/**
 * names.ts — file names that work on every file system the workspace folder
 * may sit on (APFS, HFS+, exFAT/FAT32 on a USB drive, NTFS, ext4).
 *
 *   - no / \ : * ? " < > | or control characters (Windows and FAT refuse them)
 *   - no leading dot (a hidden file) and no trailing dot or space (Windows drops them)
 *   - not a reserved Windows device name (CON, PRN, AUX, NUL, COM1…, LPT1…)
 *   - at most ~150 bytes of UTF-8, so a " (conflict, …)" mark and the extension still fit in 255
 *   - Unicode in NFC (macOS may hand names back decomposed)
 *
 * Collisions are checked without case (macOS and Windows see "Foo" and "foo"
 * as one file): the second gets " (2)", the third " (3)"…
 */

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const MAX_BYTES = 150;

function utf8Length(s: string): number {
  let n = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
  }
  return n;
}

/** A label as a file or folder name (without extension). */
export function safeName(label: string, fallback = 'Untitled'): string {
  let s = String(label ?? '').normalize('NFC');
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\u0000-\u001f\u007f]/g, '').replace(/[/\\:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim();
  s = s.replace(/^[.\s]+/, '').replace(/[.\s]+$/, '');
  if (utf8Length(s) > MAX_BYTES) {
    let out = '';
    for (const ch of s) { if (utf8Length(out + ch) > MAX_BYTES) break; out += ch; }
    s = out.replace(/[.\s]+$/, '');
  }
  if (!s) s = fallback;
  if (RESERVED.test(s.split('.')[0])) s = `${s}_`;
  return s;
}

/** Lower case, NFC: how file systems that ignore case compare names. */
export function foldCase(p: string): string {
  return p.normalize('NFC').toLowerCase();
}

/**
 * A free name in a folder: `base`, else `base (2)`, `base (3)`… `taken`
 * holds the folded (foldCase) full paths already used; the chosen one is added.
 */
export function uniqueName(dir: string, base: string, ext: string, taken: Set<string>): string {
  let name = base, n = 2;
  const full = (b: string) => `${dir ? `${dir}/` : ''}${b}${ext}`;
  while (taken.has(foldCase(full(name)))) name = `${base} (${n++})`;
  taken.add(foldCase(full(name)));
  return name;
}

/** Does a stored label still name this file? ("a/b" names "a-b.graph.json" and "a-b (2).graph.json".) */
export function labelMatchesBase(label: string, base: string): boolean {
  const safe = foldCase(safeName(label));
  const b = foldCase(base);
  if (b === safe) return true;
  const m = / \((\d+)\)$/.exec(b);
  return !!m && b.slice(0, m.index) === safe;
}

const CONFLICT_MARK = / \(conflict, \d{4}-\d{2}-\d{2} \d{2}\.\d{2}(?:\.\d{2})?\)(?: \(\d+\))?$/;

/** "2026-09-27 14.05": when a conflict copy was made (no colons: Windows refuses them). */
export function conflictStamp(at: number): string {
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}`;
}

/**
 * The name a file stands for: the name stored in it while that still names
 * the file ("a/b" in "a-b.graph.json"), the same with a conflict copy's mark
 * ("a/b (conflict, …)" for "a-b (conflict, …).graph.json"), else the file's own
 * name (renamed or copied in Finder).
 */
export function nameFor(stored: string | undefined, base: string): string {
  if (stored && labelMatchesBase(stored, base)) return stored;
  const m = CONFLICT_MARK.exec(base);
  if (stored && m && labelMatchesBase(stored, base.slice(0, m.index))) return stored + base.slice(m.index);
  return base;
}

export function isConflictName(base: string): boolean {
  return CONFLICT_MARK.test(base);
}

/** The extensions the workspace uses, longest first, so "x.graph.json" splits as x + .graph.json. */
export const EXTENSIONS = ['.graph.json', '.present.json', '.glsl.json', '.fn.json', '.node.json', '.sketch.json', '.kind.json', '.builder.json', '.builder-group.json', '.palette.json', '.glsl', '.json', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.avif'];

/** A path's folder, name and extension: "graphs/Tests/Foo.graph.json" → ["graphs/Tests", "Foo", ".graph.json"]. */
export function splitPath(path: string): { dir: string; base: string; ext: string } {
  const i = path.lastIndexOf('/');
  const dir = i < 0 ? '' : path.slice(0, i);
  const file = path.slice(i + 1);
  const lower = file.toLowerCase();
  const ext = EXTENSIONS.find(e => lower.endsWith(e) && lower.length > e.length) ?? (/\.[^.]+$/.exec(file)?.[0] ?? '');
  return { dir, base: file.slice(0, file.length - ext.length), ext: file.slice(file.length - ext.length) };
}

/** Where the other side's copy goes in a conflict: "graphs/Foo (conflict, 2026-09-27 14.05).graph.json". */
export function conflictPath(path: string, at: number, taken: Set<string>): string {
  const { dir, base, ext } = splitPath(path);
  const name = uniqueName(dir, `${base} (conflict, ${conflictStamp(at)})`, ext, taken);
  return `${dir ? `${dir}/` : ''}${name}${ext}`;
}
