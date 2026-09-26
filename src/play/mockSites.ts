/**
 * mockSites.ts — pretend websites for the embed dialog's live preview.
 *
 * Each template is a small, self-contained page with three places a snippet
 * can go, and the embed options pick one:
 *   page    background, whole page: first thing in <body>, the sections turn see-through
 *   hero    background, fills its section: inside the template's hero / banner / card
 *   inline  player: in the flow of the content, like a video would be
 * The preview loads the result in a sandboxed iframe, so what you see is the
 * real snippet running on a page, not a picture of one.
 */
import type { EmbedOptions } from './exportHtml';

export type MockSite = 'landing' | 'blog' | 'portfolio';

export const MOCK_SITES: { id: MockSite; label: string; hint: string }[] = [
  { id: 'landing', label: 'Landing page', hint: 'A product page with a hero, features and a footer' },
  { id: 'blog', label: 'Blog post', hint: 'An article with a banner and body text' },
  { id: 'portfolio', label: 'Portfolio', hint: 'A grid of project cards' },
];

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

const BASE_CSS = `
*{box-sizing:border-box}html,body{margin:0}
body{font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Helvetica,Arial,sans-serif;color:#1b1c22;background:#f6f5f2}
a{color:inherit}
nav{display:flex;align-items:center;gap:22px;padding:18px 40px;font-size:14px}
nav b{font-size:16px;letter-spacing:-.01em;margin-right:auto}
nav .btn{padding:8px 14px}
.btn{display:inline-block;padding:12px 20px;border-radius:999px;background:#1b1c22;color:#fff;text-decoration:none;font-weight:600;font-size:14px}
.btn.light{background:#fff;color:#1b1c22}
.muted{color:#6b6d78}
.wrap{max-width:1040px;margin:0 auto;padding:0 40px}
footer{padding:40px;font-size:13px;color:#6b6d78;border-top:1px solid #0001;margin-top:60px}
/* Whole-page background: sections go see-through so the picture shows behind them. */
body.bgpage{background:#000;color:#f2f2f5}
body.bgpage .panel{background:rgba(12,12,18,.55);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);border:1px solid #ffffff1f;color:#f2f2f5}
body.bgpage .muted{color:#c9cad3}
body.bgpage footer{border-color:#ffffff22;color:#c9cad3}
body.bgpage .btn{background:#fff;color:#111}
@media (max-width:640px){nav{padding:14px 18px;gap:12px}nav a:not(.btn){display:none}.wrap{padding:0 18px}footer{padding:28px 18px}}
`;

function landing(slot: (where: 'hero' | 'inline') => string, title: string): { css: string; body: string } {
  return {
    css: `
.hero{position:relative;min-height:560px;display:flex;align-items:flex-end;padding:0 40px 64px;color:#fff;background:#111;overflow:hidden}
body.bgpage .hero{background:transparent}
.hero .inner{position:relative;max-width:620px}
.hero h1{font-size:64px;line-height:1.02;letter-spacing:-.035em;margin:0 0 16px}
.hero p{font-size:19px;opacity:.9;margin:0 0 26px}
.eyebrow{display:inline-block;font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;padding:5px 10px;border-radius:999px;background:#ffffff26;margin-bottom:18px}
.features{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin-top:56px}
.card{padding:22px;border-radius:18px;background:#fff;box-shadow:0 1px 0 #0000000d}
.card h3{margin:0 0 6px;font-size:17px}
.live{margin-top:56px}.live h2{font-size:30px;letter-spacing:-.02em;margin:0 0 6px}
@media (max-width:640px){.hero{min-height:480px;padding:0 18px 36px}.hero h1{font-size:40px}.features{grid-template-columns:1fr}}
`,
    body: `
<nav class="panel"><b>Lumen</b><a>Product</a><a>Pricing</a><a>Journal</a><a class="btn">Sign up</a></nav>
<section class="hero">${slot('hero')}
  <div class="inner"><span class="eyebrow">New · Spring release</span><h1>${esc(title)}</h1><p>A living picture behind your words. Your headline, buttons and links stay sharp on top.</p><a class="btn light">Get started</a></div>
</section>
<div class="wrap">
  ${slot('inline') ? `<section class="live"><h2>Try it</h2><p class="muted">Move the sliders, press the keys, click the picture.</p>${slot('inline')}</section>` : ''}
  <section class="features">
    <div class="card panel"><h3>Fast</h3><p class="muted">Renders on the visitor’s graphics card and pauses when it scrolls away.</p></div>
    <div class="card panel"><h3>Light</h3><p class="muted">One snippet, no build step, no libraries to load.</p></div>
    <div class="card panel"><h3>Kind</h3><p class="muted">Shows a still frame to anyone who prefers reduced motion.</p></div>
  </section>
</div>
<footer class="panel">© Lumen Studio · Made with Playfield</footer>`,
  };
}

function blog(slot: (where: 'hero' | 'inline') => string, title: string): { css: string; body: string } {
  return {
    css: `
body{background:#fbfaf7}
article{max-width:700px;margin:0 auto;padding:10px 40px 0}
article.panel{border-radius:22px;padding:34px 40px;margin-top:20px}
.banner{position:relative;height:280px;border-radius:18px;overflow:hidden;background:linear-gradient(135deg,#c9b8a6,#8fa3ad);display:flex;align-items:flex-end;padding:22px;color:#fff;margin:22px 0 30px}
body.bgpage .banner{background:transparent}
.banner span{position:relative;font-weight:700;font-size:13px;letter-spacing:.08em;text-transform:uppercase}
h1{font:700 44px/1.1 Georgia,"Times New Roman",serif;letter-spacing:-.02em;margin:8px 0 10px}
.meta{font-size:13px}
article p{font-family:Georgia,"Times New Roman",serif;font-size:18px;line-height:1.7}
.fig{margin:30px 0}.fig figcaption{font-size:13px;margin-top:8px}
@media (max-width:640px){article{padding:6px 18px 0}article.panel{padding:22px 18px;border-radius:0}h1{font-size:32px}.banner{height:200px}}
`,
    body: `
<nav class="panel"><b>Field Notes</b><a>Essays</a><a>About</a><a class="btn">Subscribe</a></nav>
<article class="panel">
  <p class="meta muted">Essay · 6 min read</p>
  <h1>${esc(title)}</h1>
  <p class="muted" style="font-family:inherit;font-size:16px;margin:0">On making pictures you can play like an instrument.</p>
  <div class="banner">${slot('hero')}<span>Issue 12</span></div>
  <p>There is a moment, when a knob finally does what your hand expected, that a picture stops being a picture and becomes something you perform. It listens. It leans when you lean.</p>
  ${slot('inline') ? `<figure class="fig">${slot('inline')}<figcaption class="muted">Play with it: the sliders, the keys and the mouse all do something.</figcaption></figure>` : ''}
  <p>The trick is not more controls but fewer, each one mapped to something that matters: the speed of a drift, the brightness of a bloom, the moment a pulse lands on the beat.</p>
  <p>Start with one. Map it to the thing you reach for most. Then play.</p>
</article>
<footer class="panel">Field Notes · A newsletter about light and code</footer>`,
  };
}

function portfolio(slot: (where: 'hero' | 'inline') => string, title: string): { css: string; body: string } {
  return {
    css: `
body{background:#0f0f12;color:#ececf1}
.muted{color:#9a9ba6}
nav .btn{background:#fff;color:#111}
h1{font-size:54px;letter-spacing:-.035em;line-height:1.02;margin:30px 0 8px}
.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:18px;margin-top:34px}
.tile{position:relative;height:300px;border-radius:20px;overflow:hidden;background:#1d1d24;padding:22px;display:flex;flex-direction:column;justify-content:flex-end}
body.bgpage .tile{background:rgba(20,20,28,.45)}
.tile b{position:relative;font-size:19px}.tile span{position:relative;font-size:13px;opacity:.75}
.t2{background:linear-gradient(135deg,#2a2440,#1d1d24)}.t3{background:linear-gradient(135deg,#1f3a3a,#1d1d24)}.t4{background:linear-gradient(135deg,#3a2a1f,#1d1d24)}
.feature{margin-top:34px}
@media (max-width:640px){h1{font-size:36px}.grid{grid-template-columns:1fr}.tile{height:220px}}
`,
    body: `
<nav class="panel"><b>Ada Moreno</b><a>Work</a><a>Info</a><a class="btn">Contact</a></nav>
<div class="wrap">
  <h1>Selected work</h1>
  <p class="muted">Motion, light and interactive pictures, 2021–2026.</p>
  ${slot('inline') ? `<section class="feature">${slot('inline')}</section>` : ''}
  <div class="grid">
    <div class="tile panel">${slot('hero')}<b>${esc(title)}</b><span>Interactive · 2026</span></div>
    <div class="tile panel t2"><b>Night Garden</b><span>Installation · 2025</span></div>
    <div class="tile panel t3"><b>Tidal</b><span>Title sequence · 2024</span></div>
    <div class="tile panel t4"><b>Ember</b><span>Stage visuals · 2023</span></div>
  </div>
</div>
<footer class="panel">Ada Moreno · Lisbon</footer>`,
  };
}

/** A whole mock page with `snippet` where the options say it goes. */
export function buildMockSite(site: MockSite, snippet: string, options: Pick<EmbedOptions, 'mode' | 'placement'>, title: string): string {
  const where: 'page' | 'hero' | 'inline' = options.mode === 'player' ? 'inline' : options.placement === 'page' ? 'page' : 'hero';
  const slot = (w: 'hero' | 'inline') => (w === where ? snippet : '');
  const t = (site === 'blog' ? blog : site === 'portfolio' ? portfolio : landing)(slot, title || 'Playfield');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · preview</title>
<style>${BASE_CSS}${t.css}</style></head>
<body${where === 'page' ? ' class="bgpage"' : ''}>
${where === 'page' ? snippet : ''}${t.body}
</body></html>`;
}
