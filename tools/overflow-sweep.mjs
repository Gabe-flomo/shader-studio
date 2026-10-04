#!/usr/bin/env node
/**
 * overflow-sweep.mjs — dev-only layout check: does anything on the Play pages
 * run past its card at a narrow width? (src/dev/overflowCheck.ts does the
 * measuring; this drives a headless, muted Chrome through the examples.)
 *
 *   VITE_GATE=off npx vite --port 5416 --strictPort      # in another terminal
 *   node tools/overflow-sweep.mjs                        # every example below
 *   node tools/overflow-sweep.mjs playMidi playMultiply  # just these
 *
 * For each example it opens Play, visits every rail page, unfolds what's
 * folded, squeezes the panel (and each Inputs column) to 280 and 320px, and
 * lists each element that sticks out or scrolls sideways. Exit code 1 when it
 * finds any. Env: URL (default http://localhost:5416/shader-studio/),
 * CHROME (path to Chrome), CDP_PORT (default 9341).
 */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL_ = process.env.URL ?? 'http://localhost:5416/shader-studio/';
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = Number(process.env.CDP_PORT ?? 9341);
const WIDTHS = [280, 320];
const EXAMPLES = process.argv.slice(2).length ? process.argv.slice(2) : [
  'playMidi', 'playOsc', 'playIncrement', 'playTriggerModes', 'playNull', 'playConditions', 'playPairs', 'playCurves', 'playKeys', 'playLfo',
  'playAudioReaders', 'playPadGrid', 'playTake', 'handPinch', 'playMultiply', 'playEmitAbsorb', 'playShapeTriggers', 'playWalls', 'playForces',
  'playBoids', 'playChase', 'playTextMattes', 'playGlyphs', 'playContours', 'playLens', 'playBrush', 'playCamera', 'playVideoSound', 'playImage',
  'playSensors', 'scriptButtons', 'bgQueue', 'maskReveal', 'dataRoutePath', 'dataCityBars', 'drumPads', 'granulator', 'audioEffects',
  'finishGrade', 'finishScreen', 'finishLooks', 'finishTime', 'finishPrint', 'finishDatamoshEcho', 'finishMotionExtract', 'playAttractor',
];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const wait = ms => `await new Promise(r => setTimeout(r, ${ms}));`;

// Muted, headless: nothing is heard while examples with sound load.
const chrome = spawn(CHROME, [
  '--headless=new', '--mute-audio', '--autoplay-policy=user-gesture-required', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'overflow-sweep-'))}`, '--window-size=1500,1000', '--no-first-run', 'about:blank',
], { stdio: 'ignore' });

let targets = [];
for (let i = 0; i < 60 && !targets.some(t => t.type === 'page'); i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); } catch { /* not up yet */ }
  await sleep(250);
}
const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
let nextId = 0;
const pending = new Map();
ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); pending.get(m.id)?.(m); pending.delete(m.id); });
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++nextId;
  pending.set(id, m => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result)));
  ws.send(JSON.stringify({ id, method, params }));
});
const run = async body => {
  const r = await send('Runtime.evaluate', { expression: `(async () => { ${body} })()`, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};

const hits = [];
try {
  await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: URL_ });
  for (let i = 0; i < 120 && !(await run('return !!window.__shaderStudio && !!window.__shaderStudioDev;').catch(() => false)); i++) await sleep(500);
  for (const ex of EXAMPLES) {
    await run(`const S = window.__shaderStudio; await S.getState().loadExampleGraph('${ex}'); ${wait(500)} S.setState(s => ({ playOpenRequest: s.playOpenRequest + 1 })); ${wait(1200)}`);
    const cats = await run(`return [...document.querySelectorAll('[data-rail-category]')].map(e => e.getAttribute('data-rail-category'));`);
    for (const cat of cats) {
      await run(`document.querySelector('[data-rail-category="${cat}"]')?.click(); ${wait(500)}`);
      const tabs = await run(`return [...document.querySelectorAll('[data-rail-tab]')].map(e => e.getAttribute('data-rail-tab'));`);
      for (const tab of tabs.length ? tabs : ['']) {
        if (tab) await run(`document.querySelector('[data-rail-tab="${tab}"]')?.click(); ${wait(600)}`);
        // Unfold sections, mappings and cards (not menus).
        await run(`for (let pass = 0; pass < 3; pass++) {
          const panel = document.querySelector('[data-split-panel]'); if (!panel) break;
          for (const el of panel.querySelectorAll('button[aria-expanded="false"]:not([aria-haspopup]), button[aria-label^="Expand"]')) { try { el.click(); } catch { /* gone */ } }
          for (const el of [...panel.querySelectorAll('button')].filter(x => x.textContent.trim() === 'Show all')) el.click();
          ${wait(400)}
        }`);
        const found = await run(`const o = await window.__shaderStudioDev.overflow();
          return [...await o.sweepOverflow('[data-split-panel]', ${JSON.stringify(WIDTHS)}), ...await o.sweepOverflow('[data-column]', ${JSON.stringify(WIDTHS)})];`);
        for (const r of found) for (const h of r.hits) hits.push({ ex, page: tab ? `${cat}/${tab}` : cat, width: r.width, ...h });
        console.log(`${ex} ${tab ? `${cat}/${tab}` : cat}: ${found.reduce((n, r) => n + r.hits.length, 0)}`);
      }
    }
  }
} finally {
  ws.close();
  chrome.kill();
}

const seen = new Map();
for (const h of hits) {
  const k = `${h.kind} +${h.by}px ${h.path} «${h.text.slice(0, 30)}»`;
  if (!seen.has(k)) seen.set(k, []);
  seen.get(k).push(`${h.ex}:${h.page}@${h.width}`);
}
console.log(`\n${seen.size} distinct overflow${seen.size === 1 ? '' : 's'}`);
for (const [k, where] of seen) console.log(`${k}\n    ${where.slice(0, 4).join(', ')}${where.length > 4 ? ` … ${where.length} in all` : ''}`);
process.exit(seen.size ? 1 : 0);
