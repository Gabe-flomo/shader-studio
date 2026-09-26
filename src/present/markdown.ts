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

function renderMath(tex: string, display: boolean, opts: MarkdownOptions): string {
  try {
    return katex.renderToString(tex, { displayMode: display, throwOnError: false, output: opts.math === 'mathml' ? 'mathml' : 'htmlAndMathml', strict: 'ignore', trust: false });
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
