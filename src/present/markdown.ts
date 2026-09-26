/**
 * markdown.ts — the Present page's text: Markdown (markdown-it) with maths
 * (KaTeX) and control chips. Loaded only when the page opens, and with it
 * KaTeX's stylesheet and fonts.
 *
 *   $…$            inline maths (not when the $ is followed by a space or
 *                  the closing one by a digit, so "$5 and $6" stays prose)
 *   $$…$$          display maths, on its own lines or inside a paragraph
 *   \$             a dollar sign
 *   [[control:id]] a chip naming a control of the block's Play; the page
 *                  links it to the slider (data-control)
 *   [[layer:id]]   the layer's name
 *
 * Raw HTML in the text is shown as text, never run: a presentation file can
 * come from anyone. Links open in a new tab. Pure: the same text and options
 * give the same HTML.
 */
import markdownIt, { type MarkdownIt, type StateBlock, type StateInline } from 'markdown-it';
import katex from 'katex';
import 'katex/dist/katex.min.css';

export interface MarkdownOptions {
  /** 'html' (KaTeX's HTML + MathML, needs its stylesheet) in the app; 'mathml' (no fonts) for exported pages. */
  math?: 'html' | 'mathml';
  /** Control id → label, for chips. */
  controls?: Readonly<Record<string, string>>;
  /** Layer id → label. */
  layers?: Readonly<Record<string, string>>;
}

interface Env { opts: MarkdownOptions }
const optsOf = (env: unknown): MarkdownOptions => (env as Env | undefined)?.opts ?? {};

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

// ── MathML that Chrome draws right ──────────────────────────────────────────
//
// MathML Core (what Chrome implements) dropped the mathvariant values other
// than "normal": KaTeX writes \mathbf{p} as <mi mathvariant="bold">p</mi>,
// which Chrome draws as a plain italic p. The fix MathML Core asks for is the
// letter itself: Unicode has bold, script, double-struck… alphabets (𝐩, ℝ, 𝓛).
// And ‖p‖ comes out as ∥ (U+2225, "parallel to"), a relation that gets a
// thick space either side: it becomes the fence ‖ (U+2016) with no spacing.

/** Where each style's capital A, small a, digit 0, capital Alpha and small alpha start (0: none). */
const MATH_ALPHABETS: Record<string, [number, number, number, number, number]> = {
  'bold': [0x1d400, 0x1d41a, 0x1d7ce, 0x1d6a8, 0x1d6c2],
  'italic': [0x1d434, 0x1d44e, 0, 0x1d6e2, 0x1d6fc],
  'bold-italic': [0x1d468, 0x1d482, 0, 0x1d71c, 0x1d736],
  'script': [0x1d49c, 0x1d4b6, 0, 0, 0],
  'bold-script': [0x1d4d0, 0x1d4ea, 0, 0, 0],
  'fraktur': [0x1d504, 0x1d51e, 0, 0, 0],
  'double-struck': [0x1d538, 0x1d552, 0x1d7d8, 0, 0],
  'bold-fraktur': [0x1d56c, 0x1d586, 0, 0, 0],
  'sans-serif': [0x1d5a0, 0x1d5ba, 0x1d7e2, 0, 0],
  'bold-sans-serif': [0x1d5d4, 0x1d5ee, 0x1d7ec, 0x1d756, 0x1d770],
  'sans-serif-italic': [0x1d608, 0x1d622, 0, 0, 0],
  'sans-serif-bold-italic': [0x1d63c, 0x1d656, 0, 0x1d790, 0x1d7aa],
  'monospace': [0x1d670, 0x1d68a, 0x1d7f6, 0, 0],
};
/** Letters Unicode had already, so the math alphabets leave holes where they'd be. */
const MATH_HOLES: Record<string, Record<string, string>> = {
  'italic': { h: 'ℎ' },
  'script': { B: 'ℬ', E: 'ℰ', F: 'ℱ', H: 'ℋ', I: 'ℐ', L: 'ℒ', M: 'ℳ', R: 'ℛ', e: 'ℯ', g: 'ℊ', o: 'ℴ' },
  'fraktur': { C: 'ℭ', H: 'ℌ', I: 'ℑ', R: 'ℜ', Z: 'ℨ' },
  'double-struck': { C: 'ℂ', H: 'ℍ', N: 'ℕ', P: 'ℙ', Q: 'ℚ', R: 'ℝ', Z: 'ℤ' },
};

function mathLetters(text: string, variant: string): string | null {
  const a = MATH_ALPHABETS[variant];
  if (!a) return null;
  let out = '';
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    const hole = MATH_HOLES[variant]?.[ch];
    if (hole) out += hole;
    else if (c >= 0x41 && c <= 0x5a) out += String.fromCodePoint(a[0] + c - 0x41);
    else if (c >= 0x61 && c <= 0x7a) out += String.fromCodePoint(a[1] + c - 0x61);
    else if (c >= 0x30 && c <= 0x39 && a[2]) out += String.fromCodePoint(a[2] + c - 0x30);
    else if (c >= 0x391 && c <= 0x3a9 && c !== 0x3a2 && a[3]) out += String.fromCodePoint(a[3] + c - 0x391);
    else if (c >= 0x3b1 && c <= 0x3c9 && a[4]) out += String.fromCodePoint(a[4] + c - 0x3b1);
    else out += ch;
  }
  return out;
}

/** KaTeX's MathML, rewritten for MathML Core: styled letters as Unicode math letters, ‖ as a fence. */
export function mathmlForCore(html: string): string {
  return html
    .replace(/<(mi|mn|mo|mtext)([^>]*?) mathvariant="([a-z-]+)"([^>]*)>([^<]*)<\/\1>/g, (m, tag: string, pre: string, variant: string, post: string, text: string) => {
      if (variant === 'normal') return m;
      const letters = mathLetters(text, variant);
      if (letters === null || letters === text) return m;
      // A single math letter in <mi> is already its own style; "normal" keeps Chrome from italicising it again.
      return `<${tag}${pre}${tag === 'mi' ? ' mathvariant="normal"' : ''}${post}>${letters}</${tag}>`;
    })
    // \| and \lVert (not \parallel, which is a plain <mo>∥</mo> and rightly a relation).
    .replace(/<mo stretchy="false">∥<\/mo>|<mi mathvariant="normal">∥<\/mi>/g, '<mo lspace="0em" rspace="0em" stretchy="false">‖</mo>')
    .replace(/<mo fence="true">∥<\/mo>/g, '<mo fence="true" lspace="0em" rspace="0em">‖</mo>');
}

function renderMath(tex: string, display: boolean, opts: MarkdownOptions): string {
  try {
    const html = katex.renderToString(tex, { displayMode: display, throwOnError: false, output: opts.math === 'mathml' ? 'mathml' : 'htmlAndMathml', strict: 'ignore', trust: false });
    return opts.math === 'mathml' ? mathmlForCore(html) : html;
  } catch {
    return `<code class="pp-math-error">${escapeHtml(tex)}</code>`;
  }
}

function mathInline(state: StateInline, silent: boolean): boolean {
  const src = state.src, start = state.pos;
  if (src.charCodeAt(start) !== 0x24 /* $ */) return false;
  // $$…$$ inside a paragraph: display maths.
  if (src.charCodeAt(start + 1) === 0x24) {
    const end = src.indexOf('$$', start + 2);
    if (end < 0 || end === start + 2) return false;
    if (!silent) { const t = state.push('math_display_inline', 'math', 0); t.content = src.slice(start + 2, end).trim(); t.markup = '$$'; }
    state.pos = end + 2;
    return true;
  }
  const first = src.charCodeAt(start + 1);
  if (Number.isNaN(first) || first === 0x20 || first === 0x09 || first === 0x0a) return false;
  let end = start + 1;
  while ((end = src.indexOf('$', end)) >= 0) {
    if (src.charCodeAt(end - 1) === 0x5c /* \ */) { end++; continue; }
    break;
  }
  if (end < 0 || end === start + 1) return false;
  const before = src.charCodeAt(end - 1);
  if (before === 0x20 || before === 0x09 || before === 0x0a) return false;
  const after = src.charCodeAt(end + 1);
  if (after >= 0x30 && after <= 0x39) return false;
  if (!silent) { const t = state.push('math_inline', 'math', 0); t.content = src.slice(start + 1, end); t.markup = '$'; }
  state.pos = end + 1;
  return true;
}

function mathBlock(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  let pos = state.bMarks[startLine] + state.tShift[startLine];
  let max = state.eMarks[startLine];
  if (state.sCount[startLine] - state.blkIndent >= 4) return false;
  if (pos + 2 > max || state.src.slice(pos, pos + 2) !== '$$') return false;
  pos += 2;
  let first = state.src.slice(pos, max);
  let last = '';
  let next = startLine;
  let found = false;
  if (first.trim().endsWith('$$')) {
    first = first.trim().slice(0, -2);
    found = true;
  }
  if (silent) return true;
  while (!found) {
    next++;
    if (next >= endLine) break;
    pos = state.bMarks[next] + state.tShift[next];
    max = state.eMarks[next];
    if (pos < max && state.sCount[next] < state.blkIndent) break;
    const line = state.src.slice(pos, max);
    if (line.trim().endsWith('$$')) { last = line.trim().slice(0, -2); found = true; }
  }
  if (!found) return false;
  state.line = next + 1;
  const t = state.push('math_display', 'math', 0);
  t.block = true;
  t.content = (first && first.trim() ? `${first}\n` : '') + state.getLines(startLine + 1, next, state.tShift[startLine], true) + (last.trim() ? last : '');
  t.map = [startLine, state.line];
  t.markup = '$$';
  return true;
}

const REF_RE = /^\[\[(control|layer):([A-Za-z0-9_-]+)\]\]/;
function refInline(state: StateInline, silent: boolean): boolean {
  if (state.src.charCodeAt(state.pos) !== 0x5b /* [ */ || state.src.charCodeAt(state.pos + 1) !== 0x5b) return false;
  const m = REF_RE.exec(state.src.slice(state.pos));
  if (!m) return false;
  if (!silent) { const t = state.push('present_ref', '', 0); t.meta = { kind: m[1], id: m[2] }; }
  state.pos += m[0].length;
  return true;
}

let md: MarkdownIt | null = null;
function parser(): MarkdownIt {
  if (md) return md;
  const m = markdownIt({ html: false, linkify: true, typographer: false, breaks: false });
  m.inline.ruler.after('escape', 'math_inline', mathInline);
  m.inline.ruler.before('link', 'present_ref', refInline);
  m.block.ruler.before('fence', 'math_display', mathBlock, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });
  m.renderer.rules.math_inline = (tokens, i, _o, env) => renderMath(tokens[i].content, false, optsOf(env));
  m.renderer.rules.math_display_inline = (tokens, i, _o, env) => `<span class="pp-math-display">${renderMath(tokens[i].content, true, optsOf(env))}</span>`;
  m.renderer.rules.math_display = (tokens, i, _o, env) => `<div class="pp-math-display">${renderMath(tokens[i].content, true, optsOf(env))}</div>\n`;
  m.renderer.rules.present_ref = (tokens, i, _o, env) => {
    const { kind, id } = tokens[i].meta as { kind: 'control' | 'layer'; id: string };
    if (kind === 'layer') {
      const label = optsOf(env).layers?.[id];
      return label ? `<span class="pp-ref">${escapeHtml(label)}</span>` : '<span class="pp-ref pp-ref-gone">a deleted layer</span>';
    }
    const label = optsOf(env).controls?.[id];
    return label
      ? `<button type="button" class="pp-chip" data-control="${escapeHtml(id)}">${escapeHtml(label)}</button>`
      : '<span class="pp-chip pp-chip-gone">a control not in this block</span>';
  };
  // Links leave the page in a new tab.
  const openLink = m.renderer.rules.link_open ?? ((tokens, i, o, _e, self) => self.renderToken(tokens, i, o));
  m.renderer.rules.link_open = (tokens, i, o, env, self) => {
    tokens[i].attrSet('target', '_blank');
    tokens[i].attrSet('rel', 'noopener noreferrer');
    return openLink(tokens, i, o, env, self);
  };
  md = m;
  return m;
}

/** Markdown with maths and chips → HTML. */
export function renderMarkdown(text: string, opts: MarkdownOptions = {}): string {
  const env = { opts } as unknown as Parameters<MarkdownIt['render']>[1];
  return parser().render(text, env);
}

/**
 * Play notes (NotesCard's plain format: "• " bullets, **bold**) as Markdown,
 * to seed a text block from a Play's own notes.
 */
export function notesToMarkdown(notes: string): string {
  return notes.replace(/\r/g, '').split('\n').map(l => l.replace(/^(\s*)•\s+/, '$1- ')).join('\n');
}
