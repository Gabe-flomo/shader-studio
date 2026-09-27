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
 *
 * Live code blocks are editable there too (a plain text box, without the
 * app's highlighting): the edit runs in that step's canvases of the source.
 * Canvases whose Play reads the camera get Enable camera, and ones with the
 * graph's own songs get Play sound, over the picture.
 *
 * A canvas whose source credits where it comes from (a Learn lesson's
 * chapter of The Book of Shaders) has that as a linked line under it.
 */
import runtimeSource from '../play/runtime/play-runtime.js?raw';
import pageSource from './present-page.js?raw';
import { kitScript, leftBehind, playBundle, playUsesCamera } from '../play/exportHtml';
import { isLiveScript } from './liveScript';
import { C, C_LIGHT, tokenizeLine } from '../components/glslSyntax';
import { tokenizeJsLine } from '../components/code/jsSyntax';
import { resolveCode } from './code';
import { baseValue, mappingsByControl } from './controls';
import { sourceLimits } from './snapshot';
import { aspectRatio, PRESENTATION_FILE_KIND, type Block, type Presentation, type PresentSource } from '../types/presentation';
import type { MarkdownOptions } from './markdown';
import { creditPlace, creditSentence } from '../types/credit';
import { fontFaceCss, stepLook, textVars, typeVars, usedImages, type PresentImage } from '../types/presentationStyle';
import { backdropLayers, declsToCss } from './backdrop';
import { themeAttrs, themeExportCss, themeLook } from '../types/presentTheme';

export interface PresentationHtmlOptions {
  layout: 'slides' | 'scroll';
  math: 'mathml' | 'html';
  /** KaTeX's stylesheet with its fonts inlined, for math: 'html'. */
  katexCss?: string;
  /** Code blocks' live previews as still pictures (present/previewStills.ts), by block id. */
  stills?: Record<string, string>;
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
    for (const l of leftBehind(s.bundle.play, undefined, { graphs: s.bundle.backgroundGraphs ?? {}, datasets: s.bundle.datasets })) if (!/notes/i.test(l.what)) out.push({ what: `${l.what} in “${s.title}”`, why: l.why });
  }
  const previews = p.steps.flatMap(s => s.blocks).filter(b => b.type === 'code' && b.language === 'glsl' && b.preview).length;
  if (previews) out.push({ what: previews === 1 ? 'The code block’s preview' : `The ${previews} code blocks’ previews`, why: 'They go in as still pictures: editing the code and moving its sliders works in Playfield.' });
  // Pictures and fonts embedding couldn't find (withEmbeddedAssets leaves them without src).
  const shown = usedImages(p.style, p.steps);
  for (const img of p.images ?? []) {
    if (shown.has(img.id) && !img.src) out.push({ what: `The image background “${img.name}”`, why: 'It isn’t in this browser’s image backgrounds, so the page shows its small preview, blurred. Relink it in the step’s background settings.' });
  }
  for (const family of new Set((p.fonts ?? []).filter(f => !f.src).map(f => f.family))) {
    out.push({ what: `The font ${family}`, why: 'It isn’t in this browser’s font cache and couldn’t be downloaded, so the page uses the system font.' });
  }
  return out;
}

/** A live code block: a text box whose edit runs in the step's canvases of its source (present-page.js). */
function liveCodeHtml(b: Extract<Block, { type: 'code' }> & { from: { source: string; layerId: string } }, r: ReturnType<typeof resolveCode>): string {
  const lines = Math.max(6, Math.min(24, r.text.split('\n').length + 1));
  return `<figure class="pp-code pp-live" data-source="${esc(b.from.source)}" data-layer="${esc(b.from.layerId)}"><div class="pp-code-head"><b>JS</b><span>${esc(r.from)}</span><em class="pp-live-tag" title="Edit it and the picture on this step runs your version">LIVE</em><button type="button" class="pp-reset"${b.edited !== undefined && b.edited !== r.original ? '' : ' hidden'}>Reset</button><button type="button" class="pp-copy">Copy</button></div><textarea class="pp-edit" rows="${lines}" spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="Script code, live: ${esc(r.from)}">${esc(r.text)}</textarea><div class="pp-status">Change the code: the picture on this step runs your version.</div>${b.caption ? `<figcaption>${esc(b.caption)}</figcaption>` : ''}<textarea class="pp-original" hidden>${esc(r.original ?? '')}</textarea></figure>`;
}

/** Where picked code came from, under it: its note and a linked credit (as CodeCredit in the app). */
function codeCreditHtml(b: Extract<Block, { type: 'code' }>): string {
  const o = b.origin;
  if (!o) return '';
  const note = o.note ? `<p class="pp-code-note">${esc(o.note)}</p>` : '';
  const c = o.credit;
  const credit = c ? `<p class="pp-credit pp-left">${BOOK_SVG}From <a href="${esc(c.url)}" target="_blank" rel="noopener noreferrer" title="${esc(creditSentence(c))}">${esc(c.title)}</a>${creditPlace(c).length ? `, ${esc(creditPlace(c).join(' · '))}` : ''}</p>` : '';
  return note + credit;
}

function codeHtml(b: Extract<Block, { type: 'code' }>, sources: ReadonlyMap<string, PresentSource>, dark = false, stills: Record<string, string> = {}): string {
  const inner = codeFigureHtml(b, sources, dark);
  const still = stills[b.id];
  const credit = codeCreditHtml(b);
  if (!still) return credit ? `<div class="pp-code-wrap">${inner}${credit}</div>` : inner;
  return `<div class="pp-code-wrap"><div class="pp-code-pair">${inner}<figure class="pp-code-still"><img src="${still}" alt="What the code draws" loading="lazy"><figcaption>A still of its live preview: in Playfield you can edit the code and watch it change.</figcaption></figure></div>${credit}</div>`;
}

function codeFigureHtml(b: Extract<Block, { type: 'code' }>, sources: ReadonlyMap<string, PresentSource>, dark = false): string {
  const r = resolveCode(b, sources);
  if (isLiveScript(b) && !r.problem) return liveCodeHtml(b, r);
  const tok = r.language === 'js' ? tokenizeJsLine : tokenizeLine;
  const width = String(r.rows.reduce((m, x) => ('n' in x ? Math.max(m, x.n) : m), 1)).length;
  const body = r.problem
    ? `<div class="pp-code-problem">${esc(r.problem)}</div>`
    : `<pre style="--gw:${width}ch">${r.rows.map(x => ('gap' in x
      ? `<span class="pp-gap"><i>⋯</i>${x.gap} line${x.gap === 1 ? '' : 's'} of other nodes</span>`
      : `<span class="pp-line${x.marked ? ' pp-mark' : ''}"><i>${x.n}</i>${tok(x.text || ' ', dark ? C : C_LIGHT).map(t => `<span style="color:${t.color}">${esc(t.text)}</span>`).join('')}</span>`)).join('')}</pre>`;
  return `<figure class="pp-code"><div class="pp-code-head"><b>${r.language === 'js' ? 'JS' : 'GLSL'}</b><span>${esc(r.from)}</span>${r.problem ? '' : '<button type="button" class="pp-copy">Copy</button>'}</div>${body}${b.caption ? `<figcaption>${esc(b.caption)}</figcaption>` : ''}<textarea hidden>${esc(r.text)}</textarea></figure>`;
}

function canvasHtml(id: string, s: PresentSource | undefined, aspect: number, pointer: boolean, start?: number, paused?: boolean): string {
  if (!s) return `<div class="pp-canvas pp-missing" style="aspect-ratio:${aspect}"><div class="pp-note">Its source was removed.</div></div>`;
  const limits = sourceLimits(s);
  const still = limits.length > 0;
  const poster = s.poster ? ` style="background-image:url(${s.poster})"` : '';
  // Shown while the canvas runs (present-page.js): the camera for the whole page, this canvas's songs.
  const camera = !still && playUsesCamera(s.bundle.play) ? '<button type="button" class="pp-over pp-camera" hidden title="The picture reads your camera. Nothing leaves this computer.">Enable camera</button>' : '';
  const sound = !still && s.bundle.media?.audio?.some(a => a.src) ? '<button type="button" class="pp-over pp-sound" hidden title="Play the song the picture reacts to">Play sound</button>' : '';
  const overs = camera || sound ? `<div class="pp-overs">${camera}${sound}</div>` : '';
  return `<div class="pp-canvas" id="c-${esc(id)}" data-source="${esc(s.id)}" data-pointer="${pointer ? 1 : 0}"${start ? ` data-start="${start}"` : ''}${paused ? ' data-paused="1"' : ''}${still ? ' data-still="1"' : ''} style="aspect-ratio:${aspect};--ar:${aspect}"><div class="pp-host"${poster}></div>${overs}${still ? `<div class="pp-note">Still frame: the web player can’t run ${esc(limits.join(', '))} yet.</div>` : '<div class="pp-note pp-wait">Paused to keep the page light: other canvases are running.</div>'}</div>`;
}

/** The app's book icon (ui/iconPaths.ts), inline. */
const BOOK_SVG = '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="#3a6ff7" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 4.3C6.6 3.2 4.6 2.8 2 2.9v9.5c2.6-.1 4.6.3 6 1.4 1.4-1.1 3.4-1.5 6-1.4V2.9c-2.6-.1-4.6.3-6 1.4z"/><path d="M8 4.3v9.5"/></svg>';

/** "From The Book of Shaders, Ch. 5 · Shaping functions · Step and Smoothstep", linked; empty when the source credits nothing. */
export function creditHtml(s: PresentSource | undefined): string {
  const c = s?.bundle.play.source;
  if (!c) return '';
  const place = creditPlace(c);
  return `<p class="pp-credit">${BOOK_SVG}From <a href="${esc(c.url)}" target="_blank" rel="noopener noreferrer" title="${esc(creditSentence(c))}">${esc(c.title)}</a>${place.length ? `, ${esc(place.join(' · '))}` : ''}</p>`;
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
  const credit = creditHtml(s);
  const canvas = credit ? `<figure class="pp-pic">${canvasHtml(b.id, s, aspectRatio(b.aspect), b.pointer)}${credit}</figure>` : canvasHtml(b.id, s, aspectRatio(b.aspect), b.pointer);
  const panel = `<div class="pp-controls">${rows}${enable ? `<div class="pp-enable">${enable}</div>` : ''}</div>`;
  return b.layout === 'stacked'
    ? `<div class="pp-inter pp-stacked">${text}${canvas}${panel}</div>`
    : `<div class="pp-inter pp-side">${canvas}<div class="pp-side-col">${text}${panel}</div></div>`;
}

function blockHtml(b: Block, sources: ReadonlyMap<string, PresentSource>, render: Render, math: MarkdownOptions['math'], dark = false, stills: Record<string, string> = {}): string {
  switch (b.type) {
    case 'text': return b.markdown.trim() ? `<div class="pp-md">${render(b.markdown, { math })}</div>` : '';
    case 'render': {
      const w = b.width === 'half' ? 50 : b.width === 'third' ? 33.333 : 100;
      const s = sources.get(b.source);
      return `<figure class="pp-render" style="--w:${w}%">${canvasHtml(b.id, s, aspectRatio(b.aspect), b.pointer, b.startTime, b.paused)}${b.caption ? `<figcaption>${esc(b.caption)}</figcaption>` : ''}${creditHtml(s)}</figure>`;
    }
    case 'interactive': return interactiveHtml(b, sources.get(b.source), render, math);
    case 'code': return codeHtml(b, sources, dark, stills);
  }
}

const PAGE_CSS = `
*{box-sizing:border-box}html,body{margin:0}[hidden]{display:none!important}
body{--pp-heading:#1a1b23;--pp-body:#3a3d47;--pp-muted:#6b6f7a;--pp-accent:#2f5fe0;--pp-wash:#f4f5f8;--pp-rule:#e7e8ee;--pp-shadow:none;background:var(--pp-page,#eef0f4);color:#3a3d47;font:16px/1.62 var(--pp-font-body,system-ui,-apple-system,"Segoe UI",Helvetica,Arial,sans-serif);-webkit-text-size-adjust:100%}
.pp-md{overflow-wrap:break-word;min-width:0;color:var(--pp-body);font-size:calc(16px * var(--pp-scale,1));line-height:var(--pp-lh,1.62);text-shadow:var(--pp-shadow)}.pp-md>:first-child{margin-top:0}.pp-md>:last-child{margin-bottom:0}
.pp-md p,.pp-md ul,.pp-md ol,.pp-md pre,.pp-md blockquote,.pp-md table{margin:0 0 .8em}
.pp-md h1,.pp-md h2,.pp-md h3{color:var(--pp-heading);font-family:var(--pp-font-heading,inherit);font-weight:var(--pp-hw,700);line-height:1.25;margin:1.1em 0 .45em;letter-spacing:var(--pp-track,normal)}
.pp-md strong{color:var(--pp-heading)}.pp-md a{color:var(--pp-link,var(--pp-accent))}
.pp-md code{font:.88em var(--pp-font-code,ui-monospace,SFMono-Regular,Menlo,monospace);background:var(--pp-wash);padding:.1em .35em;border-radius:5px;color:var(--pp-heading);text-shadow:none}
.pp-md pre{background:var(--pp-code-bg,var(--pp-wash));padding:10px 12px;border-radius:8px;overflow:auto}.pp-md pre code{background:none;padding:0}
.pp-md blockquote{border-left:3px solid var(--pp-rule);padding-left:.9em;color:var(--pp-muted)}
.pp-md hr{border:0;border-top:1px solid var(--pp-rule)}.pp-md th,.pp-md td{border:1px solid var(--pp-rule);padding:4px 9px}
.pp-md img{max-width:100%}.pp-md math{font-size:1.1em}.pp-md .pp-math-display{display:block;margin:.9em 0;overflow-x:auto}
.pp-md math[display=block]{margin:.2em 0}
.pp-chip{display:inline-flex;align-items:center;gap:4px;margin:0 1px;padding:1px 8px;border-radius:10px;border:0;font:600 .84em system-ui,sans-serif;background:#3a6ff72e;color:var(--pp-accent);cursor:pointer;text-shadow:none}
.pp-chip:hover,.pp-chip.pp-on{background:#3a6ff742;box-shadow:0 0 0 2px #3a6ff740}
.pp-chip-gone{background:#f4f5f8;color:#9a9da8;text-decoration:line-through}
.pp-step{position:relative}
.pp-inner{position:relative;z-index:1;max-width:1100px;margin:0 auto;padding:40px 24px}
.pp-inner>header{display:flex;align-items:baseline;gap:12px;margin-bottom:calc(24px * var(--pp-space,1))}
.pp-inner>header span{color:var(--pp-accent);font:700 12px system-ui,sans-serif;letter-spacing:.06em;flex-shrink:0;text-shadow:var(--pp-shadow)}.pp-inner>header span i{font-style:normal;color:var(--pp-muted);font-weight:500}
.pp-inner>header h2,h1.pp-title{margin:0;color:var(--pp-heading);font-family:var(--pp-font-heading,system-ui,sans-serif);font-weight:var(--pp-hw,700);font-size:calc(28px * var(--pp-scale,1) * var(--pp-title,1));line-height:1.2;letter-spacing:var(--pp-track,-.015em);text-shadow:var(--pp-shadow)}
.pp-bg,.pp-bg>i{position:absolute;inset:0;pointer-events:none}.pp-bg{overflow:hidden;z-index:0}
.slides .pp-bg{animation:pp-fade .35s ease-out}@keyframes pp-fade{from{opacity:0}to{opacity:1}}
@media (prefers-reduced-motion:reduce){.slides .pp-bg{animation:none}}
.scroll .pp-bgwrap{position:sticky;top:0;height:100vh;margin-bottom:-100vh;z-index:0}.scroll .pp-has-bg{clip-path:inset(0)}
.pp-grid{display:grid;gap:calc(28px * var(--pp-space,1)) calc(32px * var(--pp-space,1));align-items:start}.pp-grid.pp-2{grid-template-columns:repeat(2,minmax(0,1fr))}.pp-grid>.pp-wide{grid-column:1/-1}
.pp-grid>*{min-width:0}
figure{margin:0}
.pp-render{display:flex;flex-direction:column;align-items:center;gap:8px}.pp-render>*{width:var(--w);max-width:100%;min-width:min(200px,100%)}
.pp-render figcaption{color:var(--pp-muted);font-size:13.5px;text-align:center;text-shadow:var(--pp-shadow)}
.pp-credit{margin:0;color:var(--pp-muted);font:500 12.5px/1.45 system-ui,sans-serif}.pp-render .pp-credit{text-align:center;margin-top:-4px}
.pp-credit svg{vertical-align:-1px;margin-right:6px}
.pp-credit a{color:var(--pp-accent);font-weight:600;text-decoration:none}.pp-credit a:hover{text-decoration:underline}
.pp-pic{display:flex;flex-direction:column;gap:8px;min-width:0}
.pp-canvas{position:relative;width:100%;border-radius:var(--pp-radius,12px);overflow:hidden;background:#0d0d12}
.slides .pp-render .pp-canvas{max-width:calc(56vh * var(--ar,1.78));margin:0 auto}
.pp-host{position:absolute;inset:0;background-size:cover;background-position:center}
.pp-note{position:absolute;left:10px;right:10px;bottom:10px;padding:7px 10px;border-radius:8px;background:#0b0b10c7;color:#e8e8ef;font:500 12.5px/1.35 system-ui,sans-serif}
.pp-wait{display:none}.pp-waiting .pp-wait{display:block}
.pp-inter.pp-side{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(260px,1fr);gap:28px;align-items:start}
.pp-inter.pp-stacked,.pp-side-col{display:flex;flex-direction:column;gap:16px;min-width:0}
.pp-stacked .pp-controls{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px}
.pp-controls{display:flex;flex-direction:column;gap:10px}
.pp-control{padding:10px 12px 11px;border-radius:var(--pp-radius,12px);background:var(--pp-surface,#fff);border:1px solid var(--pp-rule,#e7e8ee);transition:border-color .15s,box-shadow .15s}
.pp-control.pp-hot{border-color:#3a6ff7;box-shadow:0 0 0 3px #3a6ff72e}
.pp-row{display:flex;align-items:baseline;gap:8px;margin-bottom:6px}.pp-row b{flex:1;color:var(--pp-heading,#1a1b23);font:600 13.5px system-ui,sans-serif}
.pp-value{font:500 12.5px ui-monospace,Menlo,monospace;color:var(--pp-muted,#6b6f7a)}.pp-driven .pp-value{color:#2f5fe0}
.pp-control input[type=range]{width:100%;accent-color:#3a6ff7}.pp-control input[type=color]{width:100%;height:32px;border:0;padding:0;background:none;border-radius:8px}
.pp-hint{margin-top:6px;color:var(--pp-muted,#6b6f7a);font-size:12.5px;line-height:1.4}
.pp-badges{display:flex;flex-wrap:wrap;gap:5px;margin-top:8px}.pp-badges span{padding:2px 8px;border-radius:10px;background:var(--pp-wash,#f4f5f8);color:var(--pp-body,#3a3d47);font:600 11px system-ui,sans-serif}
.pp-driven .pp-badges span{background:#3a6ff724;color:#2f5fe0}
.pp-act,.pp-btn{height:32px;padding:0 12px;border-radius:var(--pp-btn-radius,8px);border:1px solid var(--pp-btn,#1a1b23);background:var(--pp-btn,#1a1b23);color:var(--pp-on-btn,#fff);font:600 12.5px system-ui,sans-serif;cursor:pointer}.pp-act{width:100%}
.pp-btn{background:var(--pp-surface,#fff);color:var(--pp-body,#3a3d47);border-color:var(--pp-rule,#e7e8ee)}.pp-enable{display:flex;gap:8px;flex-wrap:wrap}
.pp-code{border-radius:var(--pp-radius,12px);border:1px solid var(--pp-rule,#e7e8ee);background:var(--pp-code-bg,#fbfbfc);overflow:hidden}
.pp-code-head{display:flex;align-items:center;gap:8px;padding:6px 8px 6px 12px;background:var(--pp-surface,#fff);border-bottom:1px solid var(--pp-rule,#eef0f3);font:500 12px system-ui,sans-serif;color:var(--pp-muted,#6b6f7a)}
.pp-code-head b{font:650 10.5px ui-monospace,Menlo,monospace;letter-spacing:.04em;color:#9a9da8}.pp-code-head span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pp-copy{border:0;background:none;color:var(--pp-body,#3a3d47);font:500 12px system-ui,sans-serif;cursor:pointer;padding:4px 8px;border-radius:6px}.pp-copy:hover{background:#f2f3f6}
.pp-code pre{margin:0;padding:8px 0;max-height:460px;overflow:auto;font:12.5px/1.62 var(--pp-font-code,ui-monospace,SFMono-Regular,Menlo,monospace)}
.pp-line,.pp-gap{display:block;white-space:pre;padding-right:16px}.pp-line i,.pp-gap i{display:inline-block;width:calc(var(--gw) + 26px);padding-right:14px;text-align:right;color:#c3c5cf;font-style:normal;user-select:none}
.pp-mark{background:#3a6ff71f;box-shadow:inset 3px 0 0 #3a6ff7}.pp-mark i{color:#3a6ff7}.pp-gap{color:#9a9da8;font:500 11px system-ui,sans-serif;padding:2px 0}
.pp-code figcaption{padding:7px 12px 8px;border-top:1px solid var(--pp-rule,#eef0f3);color:var(--pp-muted,#6b6f7a);font-size:13px}
.pp-code-problem{padding:14px;color:#8a5d05;font-size:13px}
.pp-code-wrap{display:flex;flex-direction:column;gap:8px}.pp-code-pair{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:14px;align-items:start}.pp-code-pair>.pp-code{min-width:0}
.pp-code-still{margin:0;display:flex;flex-direction:column;gap:6px}.pp-code-still img{display:block;width:100%;height:auto;border-radius:var(--pp-radius,12px);border:1px solid var(--pp-rule,#eef0f3)}.pp-code-still figcaption{color:var(--pp-muted,#6b6f7a);font:500 12px/1.4 system-ui,sans-serif}
.pp-code-note{margin:0;color:var(--pp-muted,#6b6f7a);font:500 12px/1.45 system-ui,sans-serif}.pp-credit.pp-left{text-align:left;margin:0}
.pp-live:focus-within{border-color:#3a6ff7;box-shadow:0 0 0 3px #3a6ff72e}
.pp-live-tag{flex-shrink:0;padding:1px 7px;border-radius:9px;background:#3a6ff724;color:#2f5fe0;font:650 10px system-ui,sans-serif;letter-spacing:.05em;font-style:normal}
.pp-reset{border:0;background:none;color:var(--pp-body,#3a3d47);font:500 12px system-ui,sans-serif;cursor:pointer;padding:4px 8px;border-radius:6px}.pp-reset:hover{background:#f2f3f6}
.pp-edit{display:block;width:100%;min-height:120px;max-height:460px;margin:0;padding:8px 14px;border:0;outline:none;resize:vertical;background:var(--pp-code-bg,#fbfbfc);color:var(--pp-heading,#1a1b23);font:12.5px/1.62 ui-monospace,SFMono-Regular,Menlo,monospace;tab-size:2;white-space:pre;overflow:auto;overflow-wrap:normal}
.pp-status{padding:7px 12px;border-top:1px solid var(--pp-rule,#eef0f3);color:var(--pp-muted,#6b6f7a);font-size:12.5px;line-height:1.45}
.pp-status.pp-ok::before{content:'✓ ';color:#2e8b57}
.pp-status.pp-err{color:#b3261e;background:#fdf1f0;font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;overflow-wrap:anywhere}
.pp-overs{position:absolute;top:10px;right:10px;display:flex;gap:6px;z-index:2}
.pp-over{display:inline-flex;align-items:center;height:28px;padding:0 10px;border:0;border-radius:8px;background:#0b0b10b3;color:#fff;font:600 12px system-ui,sans-serif;cursor:pointer;-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px)}.pp-over:disabled{opacity:.75;cursor:default}
.slides{height:100vh;height:100dvh;display:flex;flex-direction:column;overflow:hidden}
.slides .pp-stage{flex:1;min-height:0;overflow-y:auto}
.slides .pp-step{min-height:100%;display:flex;flex-direction:column;justify-content:center}
.slides .pp-inner{width:100%;padding:44px 56px;max-width:calc(max(var(--pp-col,1068px),1068px) + 112px)}
.slides .pp-inner>header h2{font-size:calc(32px * var(--pp-scale,1) * var(--pp-title,1))}.slides .pp-md{font-size:calc(17px * var(--pp-scale,1))}
.pp-bar{display:flex;align-items:center;gap:10px;padding:10px 16px;background:var(--pp-surface,#fff);border-top:1px solid var(--pp-rule,#e7e8ee)}
.pp-bar>button{width:34px;height:34px;border:0;border-radius:9px;background:none;color:var(--pp-body,#3a3d47);font-size:18px;cursor:pointer}.pp-bar>button:disabled{opacity:.35;cursor:default}
.pp-progress{flex:1;display:flex;gap:4px}.pp-progress button{flex:1;height:18px;padding:0;border:0;background:none;cursor:pointer;display:flex;align-items:center}
.pp-progress button::after{content:'';width:100%;height:4px;border-radius:2px;background:var(--pp-rule,#d7d9e2)}.pp-progress .pp-done::after{background:var(--pp-accent,#3a6ff7);opacity:.55}.pp-progress .pp-now::after{background:var(--pp-accent,#3a6ff7)}
.pp-count{font:600 12px ui-monospace,Menlo,monospace;color:var(--pp-muted,#6b6f7a);min-width:48px;text-align:center}
.scroll .pp-inner{max-width:calc(var(--pp-col,872px) + 48px);padding:calc(56px * var(--pp-space,1)) 24px}.scroll .pp-step:last-of-type .pp-inner{padding-bottom:120px}
.scroll h1.pp-title{margin:0 0 8px;font-size:calc(38px * var(--pp-scale,1) * var(--pp-title,1));line-height:1.15;letter-spacing:var(--pp-track,-.02em)}.pp-count-steps{color:var(--pp-muted);font-size:13px;margin-bottom:40px}
.scroll .pp-rule>.pp-inner{border-top:1px solid var(--pp-rule)}
.pp-scrollbar{position:fixed;top:0;left:0;right:0;height:3px;background:#3a6ff71f;z-index:5}.pp-scrollbar i{display:block;height:100%;width:0;background:var(--pp-accent,#3a6ff7)}
.pp-by{max-width:calc(var(--pp-col,872px) + 48px);margin:0 auto;padding:0 24px 60px;color:#9a9da8;font-size:12px}
[data-pp-num] .pp-inner>header{flex-direction:column;align-items:flex-start;gap:calc(14px * var(--pp-space,1))}
[data-pp-num=pill] .pp-inner>header span{padding:5px 11px;border-radius:999px;background:var(--pp-wash);color:var(--pp-heading);font-size:11px;font-weight:650;letter-spacing:.08em;text-transform:uppercase;text-shadow:none}
[data-pp-num=meta] .pp-inner>header span{color:var(--pp-muted);font:500 13px var(--pp-font-body,system-ui,sans-serif);letter-spacing:0}[data-pp-num=meta] .pp-inner>header span i{color:inherit}
[data-pp-tiles] .pp-render{padding:14px 14px 12px;border-radius:calc(var(--pp-radius,12px) + 4px);background:var(--pp-surface,#fff)}
@media (max-width:767px){.pp-grid.pp-2{grid-template-columns:1fr}.pp-inter.pp-side{grid-template-columns:1fr}.pp-render>*{width:100%}
.slides .pp-step{justify-content:flex-start}.slides .pp-inner{padding:22px 16px 28px}.pp-inner,.scroll .pp-inner{padding:40px 16px}.slides .pp-inner>header h2,.pp-inner>header h2{font-size:calc(22px * var(--pp-scale,1))}.slides .pp-md{font-size:calc(16px * var(--pp-scale,1))}.scroll h1.pp-title{font-size:calc(28px * var(--pp-scale,1))}.scroll .pp-step:first-child .pp-inner{padding-top:26px}}
`;

/** Content column widths the blur falloff is shaped around (the page's reading width in each layout). */
const EXPORT_COLUMN = { slides: 1068, scroll: 872 } as const;

/**
 * The page's look: the fonts' @font-face rules and the typography's variables,
 * each image background once (a class the layers share, so a picture used on
 * many steps, or blurred over itself, is carried once), and each step's
 * background layers and text colours.
 */
export function styleSheet(p: Presentation, layout: 'slides' | 'scroll'): { css: string; looks: ReturnType<typeof stepLook>[]; backdrops: string[]; dark: boolean; attrs: string; column: number } {
  const images = new Map<string, PresentImage>((p.images ?? []).map(i => [i.id, i]));
  const cls = new Map<string, string>();
  const rules: string[] = [];
  const fonts = fontFaceCss(p.fonts ?? []);
  if (fonts) rules.push(fonts);
  const type = typeVars(p.style?.typography);
  // A theme sets its variables on body, with the typography's winning; Classic unchanged keeps the page as it was.
  const theme = themeExportCss(p.style?.theme, type);
  const tv = Object.entries(type).map(([k, v]) => `${k}:${v}`).join(';');
  if (theme.css) rules.push(theme.css);
  else if (tv) rules.push(`:root{${tv}}`);
  const looks = p.steps.map(s => stepLook(p.style, images, s));
  // The reading column the blur's falloff is shaped around: Classic's own until the theme's is changed.
  const tl = themeLook(p.style?.theme, false);
  const column = tl.id === 'classic' && p.style?.theme?.column === undefined ? EXPORT_COLUMN[layout] : layout === 'slides' ? Math.max(tl.column, EXPORT_COLUMN.slides) : tl.column;
  const backdrops = looks.map(look => {
    const bg = look.bg;
    if (!bg) return '';
    const img = bg.kind === 'image' && bg.image ? images.get(bg.image) : undefined;
    // A picture that couldn't be embedded (not in the library) shows its preview, blurred all over.
    const picture = img?.src ?? img?.thumb;
    let imageClass: string | undefined;
    if (img && picture) {
      imageClass = cls.get(img.id);
      if (!imageClass) {
        imageClass = `pp-img${cls.size + 1}`;
        cls.set(img.id, imageClass);
        rules.push(`.${imageClass}{background-image:url("${picture}")}`);
      }
    }
    const shown = img && !img.src ? { ...bg, blur: Math.max(bg.blur ?? 0, 0.6), falloff: 0 } : bg;
    const layers = backdropLayers(shown, { imageClass, matte: img?.avg, tone: look.tone, column });
    if (!layers.length) return '';
    const html = `<div class="pp-bg" aria-hidden="true">${layers.map(l => `<i class="pp-l-${l.name}${imageClass && (l.name === 'base' || l.name === 'blur') ? ` ${imageClass}` : ''}" style="${esc(declsToCss(l.decls))}"></i>`).join('')}</div>`;
    return layout === 'scroll' ? `<div class="pp-bgwrap">${html}</div>` : html;
  });
  return { css: rules.join('\n'), looks, backdrops, dark: theme.dark, attrs: Object.entries(themeAttrs(tl)).map(([k, v]) => ` ${k}="${esc(v)}"`).join(''), column };
}

/** The whole page. `render` is the Markdown renderer (present/markdown.ts), passed in so this stays importable anywhere. */
export function buildPresentationHtml(p: Presentation, render: Render, opts: PresentationHtmlOptions): string {
  const sources = new Map(p.sources.map(s => [s.id, s]));
  const math = opts.math === 'html' ? 'html' : 'mathml';
  const used = new Set(p.steps.flatMap(s => s.blocks.flatMap(b => (b.type === 'render' || b.type === 'interactive' ? [b.source] : []))));
  const bundles = Object.fromEntries(p.sources.filter(s => used.has(s.id)).map(s => [s.id, playBundle(s.bundle)]));
  const total = p.steps.length;
  const style = styleSheet(p, opts.layout);
  // The theme's step number: "02 / 07", an eyebrow pill (the same text), or a byline.
  const numbers = themeLook(p.style?.theme, false).spec.number;
  const steps = p.steps.map((s, i) => {
    const blocks = s.blocks.map(b => {
      const html = blockHtml(b, sources, render, math, style.dark, opts.stills);
      return html ? `<div class="pp-block${b.type === 'interactive' || s.columns === 1 ? ' pp-wide' : ''}">${html}</div>` : '';
    }).join('\n');
    const num = numbers === 'meta' ? `<span>Step ${i + 1}<i> of ${total}</i></span>` : `<span>${String(i + 1).padStart(2, '0')}<i> / ${String(total).padStart(2, '0')}</i></span>`;
    const look = style.looks[i];
    const vars = Object.entries(textVars(look.text)).map(([k, v]) => `${k}:${v}`).join(';');
    const bg = style.backdrops[i];
    const cls = ['pp-step', bg ? 'pp-has-bg' : '', opts.layout === 'scroll' && i > 0 && !bg && !style.backdrops[i - 1] ? 'pp-rule' : ''].filter(Boolean).join(' ');
    const title = opts.layout === 'scroll' && i === 0 ? `<h1 class="pp-title">${esc(p.title)}</h1><div class="pp-count-steps">${total} step${total === 1 ? '' : 's'}</div>` : '';
    return `<section class="${cls}" data-step="${i}"${vars ? ` style="${esc(vars)}"` : ''}${opts.layout === 'slides' && i > 0 ? ' hidden' : ''}>${bg}<div class="pp-inner">${title}<header>${num}${s.title ? `<h2>${esc(s.title)}</h2>` : ''}</header><div class="pp-grid${s.columns === 2 ? ' pp-2' : ''}">${blocks}</div></div></section>`;
  }).join('\n');
  const nav = opts.layout === 'slides'
    ? `<nav class="pp-bar"><button type="button" class="pp-prev" aria-label="Previous step">‹</button><div class="pp-progress">${p.steps.map((s, i) => `<button type="button" aria-label="${i + 1}. ${esc(s.title ?? 'Step')}" title="${i + 1}. ${esc(s.title ?? 'Step')}"></button>`).join('')}</div><span class="pp-count">1 / ${total}</span><button type="button" class="pp-next" aria-label="Next step">›</button></nav>`
    : '<div class="pp-scrollbar"><i></i></div>';
  const body = opts.layout === 'slides'
    ? `<main class="pp-stage">${steps}</main>${nav}`
    : `${nav}<main class="pp-doc">${steps}<p class="pp-by">Made with Playfield.</p></main>`;
  // Copy takes what the block shows: a live block's current edit, or the code as quoted.
  const copy = `document.addEventListener('click',function(e){var b=e.target.closest&&e.target.closest('.pp-copy');if(!b)return;var t=b.closest('.pp-code').querySelector('textarea').value;navigator.clipboard&&navigator.clipboard.writeText(t).then(function(){b.textContent='Copied';setTimeout(function(){b.textContent='Copy'},1400)})});`;
  const scripts = `${kitScript()}${runtimeSource}\n${pageSource}`.replace(/<\/script/gi, '<\\/script');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(p.title)}</title>
<style>${PAGE_CSS}${style.css}${math === 'html' && opts.katexCss ? opts.katexCss : ''}</style>
</head>
<body class="${opts.layout}"${style.attrs}>
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
  // Only the image backgrounds something shows travel.
  if (rest.images) { const used = usedImages(p.style, p.steps); rest.images = rest.images.filter(i => used.has(i.id)); }
  return JSON.stringify({ kind: PRESENTATION_FILE_KIND, ...rest }, null, 1);
}
