/**
 * exportPresentation.ts — a presentation as one self-contained web page, and
 * as a file.
 *
 * The page carries the web player and its layer kit once (however many
 * canvases), every source's bundle, the steps as HTML (Markdown and maths
 * already rendered: MathML by default, which modern browsers draw with no
 * fonts; KaTeX's HTML with its stylesheet as an option), and a small script
 * (present-page.js) for the slides or the scroll page, the canvases and the
 * interactive blocks. Sources the player can't run yet show their still with
 * a note, and the export lists them. Pure: same presentation and options,
 * same page.
 */
import runtimeSource from '../play/runtime/play-runtime.js?raw';
import pageSource from './present-page.js?raw';
import { kitScript, leftBehind, playBundle } from '../play/exportHtml';
import { C_LIGHT, tokenizeLine } from '../components/glslSyntax';
import { tokenizeJsLine } from '../components/code/jsSyntax';
import { resolveCode } from './code';
import { baseValue, mappingsByControl } from './controls';
import { sourceLimits } from './snapshot';
import { aspectRatio, PRESENTATION_FILE_KIND, type Block, type Presentation, type PresentSource } from '../types/presentation';
import type { MarkdownOptions } from './markdown';

export interface PresentationHtmlOptions {
  layout: 'slides' | 'scroll';
  math: 'mathml' | 'html';
  /** KaTeX's stylesheet with its fonts inlined, for math: 'html'. */
  katexCss?: string;
}

type Render = (text: string, opts: MarkdownOptions) => string;

/** What the page can't show as it is in the app. */
export interface ExportNote { what: string; why: string }

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
function scriptJson(v: unknown): string {
  return JSON.stringify(v).replace(/<\//g, '<\\/').replace(/<!--/g, '<\\!--').replace(/[\u2028\u2029]/g, c => (c === '\u2028' ? '\\u2028' : '\\u2029'));
}

/** Sources the page uses, and the notes on what it leaves behind. */
export function exportNotes(p: Presentation): ExportNote[] {
  const used = new Set(p.steps.flatMap(s => s.blocks.flatMap(b => (b.type === 'render' || b.type === 'interactive' ? [b.source] : []))));
  const out: ExportNote[] = [];
  for (const s of p.sources) {
    if (!used.has(s.id)) continue;
    const limits = sourceLimits(s);
    if (limits.length) out.push({ what: `“${s.title}” is a still`, why: `The web player can’t run ${limits.join(', ')} yet.` });
    for (const l of leftBehind(s.bundle.play)) if (!/notes/i.test(l.what)) out.push({ what: `${l.what} in “${s.title}”`, why: l.why });
  }
  return out;
}

function codeHtml(b: Extract<Block, { type: 'code' }>, sources: ReadonlyMap<string, PresentSource>): string {
  const r = resolveCode(b, sources);
  const tok = r.language === 'js' ? tokenizeJsLine : tokenizeLine;
  const width = String(r.rows.reduce((m, x) => ('n' in x ? Math.max(m, x.n) : m), 1)).length;
  const body = r.problem
    ? `<div class="pp-code-problem">${esc(r.problem)}</div>`
    : `<pre style="--gw:${width}ch">${r.rows.map(x => ('gap' in x
      ? `<span class="pp-gap"><i>⋯</i>${x.gap} line${x.gap === 1 ? '' : 's'} of other nodes</span>`
      : `<span class="pp-line${x.marked ? ' pp-mark' : ''}"><i>${x.n}</i>${tok(x.text || ' ', C_LIGHT).map(t => `<span style="color:${t.color}">${esc(t.text)}</span>`).join('')}</span>`)).join('')}</pre>`;
  return `<figure class="pp-code"><div class="pp-code-head"><b>${r.language === 'js' ? 'JS' : 'GLSL'}</b><span>${esc(r.from)}</span>${r.problem ? '' : '<button type="button" class="pp-copy">Copy</button>'}</div>${body}${b.caption ? `<figcaption>${esc(b.caption)}</figcaption>` : ''}<textarea hidden>${esc(r.text)}</textarea></figure>`;
}

function canvasHtml(id: string, s: PresentSource | undefined, aspect: number, pointer: boolean, start?: number, paused?: boolean): string {
  if (!s) return `<div class="pp-canvas pp-missing" style="aspect-ratio:${aspect}"><div class="pp-note">Its source was removed.</div></div>`;
  const limits = sourceLimits(s);
  const still = limits.length > 0;
  const poster = s.poster ? ` style="background-image:url(${s.poster})"` : '';
  return `<div class="pp-canvas" id="c-${esc(id)}" data-source="${esc(s.id)}" data-pointer="${pointer ? 1 : 0}"${start ? ` data-start="${start}"` : ''}${paused ? ' data-paused="1"' : ''}${still ? ' data-still="1"' : ''} style="aspect-ratio:${aspect}"><div class="pp-host"${poster}></div>${still ? `<div class="pp-note">Still frame: the web player can’t run ${esc(limits.join(', '))} yet.</div>` : '<div class="pp-note pp-wait">Paused to keep the page light: other canvases are running.</div>'}</div>`;
}

function interactiveHtml(b: Extract<Block, { type: 'interactive' }>, s: PresentSource | undefined, render: Render, math: MarkdownOptions['math']): string {
  if (!s) return '<div class="pp-note">This block’s source was removed.</div>';
  const play = s.bundle.play;
  const maps = mappingsByControl(play);
  const chosen = b.controls.flatMap(ch => { const c = play.controls.find(x => x.id === ch.controlId); return c ? [{ ch, c }] : []; });
  const labels = Object.fromEntries(chosen.map(({ ch, c }) => [c.id, ch.label?.trim() || c.label]));
  const layers = Object.fromEntries(play.layers.map(l => [l.id, l.label]));
  const needs = new Set(chosen.flatMap(({ c }) => [...(maps.get(c.id)?.needs ?? [])]));
  const rows = chosen.map(({ ch, c }) => {
    const v = baseValue(s.bundle, c);
    const words = ch.showMappings ? maps.get(c.id)?.words ?? [] : [];
    const badges = words.length ? `<div class="pp-badges">${words.map(w => `<span>${esc(w)}</span>`).join('')}</div>` : '';
    const hint = ch.hint ? `<div class="pp-hint">${esc(ch.hint)}</div>` : '';
    if (c.kind === 'action') return `<div class="pp-control" data-control="${esc(c.id)}"><button type="button" class="pp-act">${esc(labels[c.id])}</button>${hint}${badges}</div>`;
    if (c.kind === 'color') {
      const hex = '#' + (Array.isArray(v) ? v : [0, 0, 0]).slice(0, 3).map(x => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, '0')).join('');
      return `<div class="pp-control" data-control="${esc(c.id)}"><div class="pp-row"><b>${esc(labels[c.id])}</b></div><input type="color" value="${hex}" aria-label="${esc(labels[c.id])}">${hint}${badges}</div>`;
    }
    const n = typeof v === 'number' ? v : c.min;
    const step = c.step ?? (c.max - c.min) / 400;
    const d = step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3;
    return `<div class="pp-control" data-control="${esc(c.id)}"><div class="pp-row"><b>${esc(labels[c.id])}</b><span class="pp-value">${n.toFixed(d)}</span></div><input type="range" min="${c.min}" max="${c.max}" step="${step}" value="${n}" aria-label="${esc(labels[c.id])}">${hint}${badges}</div>`;
  }).join('');
  const enable = `${needs.has('midi') ? '<button type="button" class="pp-btn pp-enable-midi">Enable MIDI</button>' : ''}${needs.has('audio') ? '<button type="button" class="pp-btn pp-listen">Listen</button>' : ''}`;
  const text = b.markdown.trim() ? `<div class="pp-md">${render(b.markdown, { math, controls: labels, layers })}</div>` : '';
  const canvas = canvasHtml(b.id, s, aspectRatio(b.aspect), b.pointer);
  const panel = `<div class="pp-controls">${rows}${enable ? `<div class="pp-enable">${enable}</div>` : ''}</div>`;
  return b.layout === 'stacked'
    ? `<div class="pp-inter pp-stacked">${text}${canvas}${panel}</div>`
    : `<div class="pp-inter pp-side">${canvas}<div class="pp-side-col">${text}${panel}</div></div>`;
}

function blockHtml(b: Block, sources: ReadonlyMap<string, PresentSource>, render: Render, math: MarkdownOptions['math']): string {
  switch (b.type) {
    case 'text': return b.markdown.trim() ? `<div class="pp-md">${render(b.markdown, { math })}</div>` : '';
    case 'render': {
      const w = b.width === 'half' ? 50 : b.width === 'third' ? 33.333 : 100;
      return `<figure class="pp-render" style="--w:${w}%">${canvasHtml(b.id, sources.get(b.source), aspectRatio(b.aspect), b.pointer, b.startTime, b.paused)}${b.caption ? `<figcaption>${esc(b.caption)}</figcaption>` : ''}</figure>`;
    }
    case 'interactive': return interactiveHtml(b, sources.get(b.source), render, math);
    case 'code': return codeHtml(b, sources);
  }
}

const PAGE_CSS = `
*{box-sizing:border-box}html,body{margin:0}
body{background:#eef0f4;color:#3a3d47;font:16px/1.62 system-ui,-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;-webkit-text-size-adjust:100%}
.pp-md{overflow-wrap:break-word;min-width:0}.pp-md>:first-child{margin-top:0}.pp-md>:last-child{margin-bottom:0}
.pp-md p,.pp-md ul,.pp-md ol,.pp-md pre,.pp-md blockquote,.pp-md table{margin:0 0 .8em}
.pp-md h1,.pp-md h2,.pp-md h3{color:#1a1b23;line-height:1.25;margin:1.1em 0 .45em}
.pp-md strong{color:#1a1b23}.pp-md a{color:#2f5fe0}
.pp-md code{font:.88em ui-monospace,SFMono-Regular,Menlo,monospace;background:#f4f5f8;padding:.1em .35em;border-radius:5px;color:#1a1b23}
.pp-md pre{background:#f4f5f8;padding:10px 12px;border-radius:8px;overflow:auto}.pp-md pre code{background:none;padding:0}
.pp-md blockquote{border-left:3px solid #d7d9e2;padding-left:.9em;color:#6b6f7a}
.pp-md img{max-width:100%}.pp-md math{font-size:1.1em}.pp-md .pp-math-display{display:block;margin:.9em 0;overflow-x:auto}
.pp-md math[display=block]{margin:.2em 0}
.pp-chip{display:inline-flex;align-items:center;gap:4px;margin:0 1px;padding:1px 8px;border-radius:10px;border:0;font:600 .84em system-ui,sans-serif;background:#3a6ff724;color:#2f5fe0;cursor:pointer}
.pp-chip:hover,.pp-chip.pp-on{background:#3a6ff742;box-shadow:0 0 0 2px #3a6ff740}
.pp-chip-gone{background:#f4f5f8;color:#9a9da8;text-decoration:line-through}
.pp-step{max-width:1100px;margin:0 auto;padding:40px 24px}
.pp-step>header{display:flex;align-items:baseline;gap:12px;margin-bottom:24px}
.pp-step>header span{color:#2f5fe0;font:700 12px system-ui,sans-serif;letter-spacing:.06em;flex-shrink:0}.pp-step>header span i{font-style:normal;color:#9a9da8;font-weight:500}
.pp-step>header h2{margin:0;color:#1a1b23;font:700 28px/1.2 system-ui,sans-serif;letter-spacing:-.015em}
.pp-grid{display:grid;gap:28px 32px;align-items:start}.pp-grid.pp-2{grid-template-columns:repeat(2,minmax(0,1fr))}.pp-grid>.pp-wide{grid-column:1/-1}
.pp-grid>*{min-width:0}
figure{margin:0}
.pp-render{display:flex;flex-direction:column;align-items:center;gap:8px}.pp-render>*{width:var(--w);max-width:100%;min-width:min(200px,100%)}
.pp-render figcaption{color:#6b6f7a;font-size:13.5px;text-align:center}
.pp-canvas{position:relative;width:100%;border-radius:12px;overflow:hidden;background:#0d0d12}
.pp-host{position:absolute;inset:0;background-size:cover;background-position:center}
.pp-note{position:absolute;left:10px;right:10px;bottom:10px;padding:7px 10px;border-radius:8px;background:#0b0b10c7;color:#e8e8ef;font:500 12.5px/1.35 system-ui,sans-serif}
.pp-wait{display:none}.pp-waiting .pp-wait{display:block}
.pp-inter.pp-side{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(260px,1fr);gap:28px;align-items:start}
.pp-inter.pp-stacked,.pp-side-col{display:flex;flex-direction:column;gap:16px;min-width:0}
.pp-stacked .pp-controls{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px}
.pp-controls{display:flex;flex-direction:column;gap:10px}
.pp-control{padding:10px 12px 11px;border-radius:12px;background:#fff;border:1px solid #e7e8ee;transition:border-color .15s,box-shadow .15s}
.pp-control.pp-hot{border-color:#3a6ff7;box-shadow:0 0 0 3px #3a6ff72e}
.pp-row{display:flex;align-items:baseline;gap:8px;margin-bottom:6px}.pp-row b{flex:1;color:#1a1b23;font:600 13.5px system-ui,sans-serif}
.pp-value{font:500 12.5px ui-monospace,Menlo,monospace;color:#6b6f7a}.pp-driven .pp-value{color:#2f5fe0}
.pp-control input[type=range]{width:100%;accent-color:#3a6ff7}.pp-control input[type=color]{width:100%;height:32px;border:0;padding:0;background:none;border-radius:8px}
.pp-hint{margin-top:6px;color:#6b6f7a;font-size:12.5px;line-height:1.4}
.pp-badges{display:flex;flex-wrap:wrap;gap:5px;margin-top:8px}.pp-badges span{padding:2px 8px;border-radius:10px;background:#f4f5f8;color:#3a3d47;font:600 11px system-ui,sans-serif}
.pp-driven .pp-badges span{background:#3a6ff724;color:#2f5fe0}
.pp-act,.pp-btn{height:32px;padding:0 12px;border-radius:8px;border:1px solid #1a1b23;background:#1a1b23;color:#fff;font:600 12.5px system-ui,sans-serif;cursor:pointer}.pp-act{width:100%}
.pp-btn{background:#fff;color:#3a3d47;border-color:#e7e8ee}.pp-enable{display:flex;gap:8px;flex-wrap:wrap}
.pp-code{border-radius:12px;border:1px solid #e7e8ee;background:#fbfbfc;overflow:hidden}
.pp-code-head{display:flex;align-items:center;gap:8px;padding:6px 8px 6px 12px;background:#fff;border-bottom:1px solid #eef0f3;font:500 12px system-ui,sans-serif;color:#6b6f7a}
.pp-code-head b{font:650 10.5px ui-monospace,Menlo,monospace;letter-spacing:.04em;color:#9a9da8}.pp-code-head span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pp-copy{border:0;background:none;color:#3a3d47;font:500 12px system-ui,sans-serif;cursor:pointer;padding:4px 8px;border-radius:6px}.pp-copy:hover{background:#f2f3f6}
.pp-code pre{margin:0;padding:8px 0;max-height:460px;overflow:auto;font:12.5px/1.62 ui-monospace,SFMono-Regular,Menlo,monospace}
.pp-line,.pp-gap{display:block;white-space:pre;padding-right:16px}.pp-line i,.pp-gap i{display:inline-block;width:calc(var(--gw) + 26px);padding-right:14px;text-align:right;color:#c3c5cf;font-style:normal;user-select:none}
.pp-mark{background:#3a6ff71f;box-shadow:inset 3px 0 0 #3a6ff7}.pp-mark i{color:#3a6ff7}.pp-gap{color:#9a9da8;font:500 11px system-ui,sans-serif;padding:2px 0}
.pp-code figcaption{padding:7px 12px 8px;border-top:1px solid #eef0f3;color:#6b6f7a;font-size:13px}
.pp-code-problem{padding:14px;color:#8a5d05;font-size:13px}
.slides{height:100vh;height:100dvh;display:flex;flex-direction:column;overflow:hidden}
.slides .pp-stage{flex:1;min-height:0;overflow-y:auto}
.slides .pp-step{min-height:100%;display:flex;flex-direction:column;justify-content:center;padding:44px 56px;max-width:1180px}
.slides .pp-step>header h2{font-size:32px}.slides .pp-md{font-size:17px}
.pp-bar{display:flex;align-items:center;gap:10px;padding:10px 16px;background:#fff;border-top:1px solid #e7e8ee}
.pp-bar>button{width:34px;height:34px;border:0;border-radius:9px;background:none;color:#3a3d47;font-size:18px;cursor:pointer}.pp-bar>button:disabled{opacity:.35;cursor:default}
.pp-progress{flex:1;display:flex;gap:4px}.pp-progress button{flex:1;height:18px;padding:0;border:0;background:none;cursor:pointer;display:flex;align-items:center}
.pp-progress button::after{content:'';width:100%;height:4px;border-radius:2px;background:#d7d9e2}.pp-progress .pp-done::after{background:#3a6ff78c}.pp-progress .pp-now::after{background:#3a6ff7}
.pp-count{font:600 12px ui-monospace,Menlo,monospace;color:#6b6f7a;min-width:48px;text-align:center}
.scroll .pp-doc{max-width:920px;margin:0 auto;padding:56px 0 120px}.scroll h1.pp-title{margin:0 24px 8px;color:#1a1b23;font:760 38px/1.15 system-ui,sans-serif;letter-spacing:-.02em}
.scroll .pp-step{padding:48px 24px 56px;border-bottom:1px solid #e7e8ee}.scroll .pp-step:last-child{border-bottom:0}
.pp-scrollbar{position:fixed;top:0;left:0;right:0;height:3px;background:#3a6ff71f;z-index:5}.pp-scrollbar i{display:block;height:100%;width:0;background:#3a6ff7}
.pp-by{margin:60px 24px 0;color:#9a9da8;font-size:12px}
@media (max-width:767px){.pp-grid.pp-2{grid-template-columns:1fr}.pp-inter.pp-side{grid-template-columns:1fr}.pp-render>*{width:100%}
.slides .pp-step{padding:22px 16px 28px;justify-content:flex-start}.pp-step{padding:26px 16px}.slides .pp-step>header h2,.pp-step>header h2{font-size:22px}.slides .pp-md{font-size:16px}.scroll h1.pp-title{font-size:28px;margin:0 16px 8px}.scroll .pp-doc{padding-top:26px}}
`;

/** The whole page. `render` is the Markdown renderer (present/markdown.ts), passed in so this stays importable anywhere. */
export function buildPresentationHtml(p: Presentation, render: Render, opts: PresentationHtmlOptions): string {
  const sources = new Map(p.sources.map(s => [s.id, s]));
  const math = opts.math === 'html' ? 'html' : 'mathml';
  const used = new Set(p.steps.flatMap(s => s.blocks.flatMap(b => (b.type === 'render' || b.type === 'interactive' ? [b.source] : []))));
  const bundles = Object.fromEntries(p.sources.filter(s => used.has(s.id)).map(s => [s.id, playBundle(s.bundle)]));
  const total = p.steps.length;
  const steps = p.steps.map((s, i) => {
    const blocks = s.blocks.map(b => {
      const html = blockHtml(b, sources, render, math);
      return html ? `<div class="pp-block${b.type === 'interactive' || s.columns === 1 ? ' pp-wide' : ''}">${html}</div>` : '';
    }).join('\n');
    const num = `<span>${String(i + 1).padStart(2, '0')}<i> / ${String(total).padStart(2, '0')}</i></span>`;
    return `<section class="pp-step" data-step="${i}"${opts.layout === 'slides' && i > 0 ? ' hidden' : ''}><header>${num}${s.title ? `<h2>${esc(s.title)}</h2>` : ''}</header><div class="pp-grid${s.columns === 2 ? ' pp-2' : ''}">${blocks}</div></section>`;
  }).join('\n');
  const nav = opts.layout === 'slides'
    ? `<nav class="pp-bar"><button type="button" class="pp-prev" aria-label="Previous step">‹</button><div class="pp-progress">${p.steps.map((s, i) => `<button type="button" aria-label="${i + 1}. ${esc(s.title ?? 'Step')}" title="${i + 1}. ${esc(s.title ?? 'Step')}"></button>`).join('')}</div><span class="pp-count">1 / ${total}</span><button type="button" class="pp-next" aria-label="Next step">›</button></nav>`
    : '<div class="pp-scrollbar"><i></i></div>';
  const body = opts.layout === 'slides'
    ? `<main class="pp-stage">${steps}</main>${nav}`
    : `${nav}<main class="pp-doc"><h1 class="pp-title">${esc(p.title)}</h1>${steps}<p class="pp-by">Made with Playfield.</p></main>`;
  const copy = `document.addEventListener('click',function(e){var b=e.target.closest&&e.target.closest('.pp-copy');if(!b)return;var t=b.closest('.pp-code').querySelector('textarea').value;navigator.clipboard&&navigator.clipboard.writeText(t).then(function(){b.textContent='Copied';setTimeout(function(){b.textContent='Copy'},1400)})});`;
  const scripts = `${kitScript()}${runtimeSource}\n${pageSource}`.replace(/<\/script/gi, '<\\/script');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(p.title)}</title>
<style>${PAGE_CSS}${math === 'html' && opts.katexCss ? opts.katexCss : ''}</style>
</head>
<body class="${opts.layout}">
${body}
<script>window.PP_LAYOUT = ${scriptJson(opts.layout)};
window.PP_SOURCES = ${scriptJson(bundles)};</script>
<script>${scripts}
${copy}</script>
</body>
</html>
`;
}

/** The presentation file: the document with its `kind`, every snapshot inside. */
export function presentationFileJson(p: Presentation): string {
  const { origin: _origin, ...rest } = p;
  void _origin;
  return JSON.stringify({ kind: PRESENTATION_FILE_KIND, ...rest }, null, 1);
}
