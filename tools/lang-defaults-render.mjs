// lang-defaults-render.mjs — render the language's default sample lines in headless Chrome and record
// their frame stats (docs/playfield-language-plan.md, "Good defaults"; src/lang/__tests__/defaults.test.ts).
//
//   DEFAULTS_OUT=/tmp/x npx vitest run src/lang/__tests__/defaults.test.ts
//   node tools/lang-defaults-render.mjs /tmp/x/lang-defaults.json src/lang/__tests__/goldens/defaults-stats.json
//
// Chrome runs headless (--headless=new, muted), over the DevTools protocol: no window opens. Each
// shader is drawn at 320 × 180 at three times (0.5 s, 1.5 s, 3 s); the stats are the worst of them:
// black = share of pixels with brightness under 0.02, clipped = share with any channel at 255,
// lit = share at brightness 0.25 or more (something to see), mean brightness, spread = standard
// deviation of brightness. Black and clipped are the worst of the three times, lit the least.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [input, output] = process.argv.slice(2);
if (!input || !output) { console.error('usage: node tools/lang-defaults-render.mjs <lang-defaults.json> <stats.json>'); process.exit(1); }
const list = JSON.parse(readFileSync(input, 'utf8'));
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 9500 + Math.floor(Math.random() * 400);
const dir = mkdtempSync(join(tmpdir(), 'lang-defaults-'));
const proc = spawn(CHROME, ['--headless=new', '--mute-audio', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let targets;
for (let i = 0; i < 60; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.length) break; } catch { /* starting */ } await sleep(200); }
const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
let id = 0; const pending = new Map();
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });

const page = (job) => `(() => {
  const job = ${JSON.stringify(job)};
  const W = 320, H = 180;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const gl = c.getContext('webgl2', { preserveDrawingBuffer: true, antialias: false }) || c.getContext('webgl', { preserveDrawingBuffer: true, antialias: false });
  if (!gl) return { error: 'no webgl' };
  const isGl2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
  // three.js-style shaders: give them its prelude (matrices, position, uv).
  const vs = (isGl2 ? '#version 300 es\\n#define attribute in\\n#define varying out\\n' : '') + 'precision highp float;\\nuniform mat4 projectionMatrix; uniform mat4 modelViewMatrix;\\nattribute vec3 position; attribute vec2 uv;\\n' + job.vert;
  const fsPre = isGl2 ? '#version 300 es\\nprecision highp float;\\nprecision highp int;\\n#define varying in\\n#define texture2D texture\\nout highp vec4 pc_fragColor;\\n#define gl_FragColor pc_fragColor\\n' : 'precision highp float;\\n';
  const fs = fsPre + job.frag.replace(/^\\s*#version.*$/m, '').replace(/^\\s*precision .*;$/mg, '');
  const sh = (t, s) => { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x)); return x; };
  try {
    const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    gl.useProgram(p);
    const quad = (name, data, n) => { const loc = gl.getAttribLocation(p, name); if (loc < 0) return; const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, n, gl.FLOAT, false, 0, 0); };
    quad('position', [-1,-1,0, 1,-1,0, -1,1,0, -1,1,0, 1,-1,0, 1,1,0], 3);
    quad('uv', [0,0, 1,0, 0,1, 0,1, 1,0, 1,1], 2);
    const I = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
    const u = n => gl.getUniformLocation(p, n);
    if (u('projectionMatrix')) gl.uniformMatrix4fv(u('projectionMatrix'), false, I);
    if (u('modelViewMatrix')) gl.uniformMatrix4fv(u('modelViewMatrix'), false, I);
    for (const [n, v] of Object.entries(job.uniforms)) { const l = u(n); if (!l) continue; if (typeof v === 'number') gl.uniform1f(l, v); else if (v.length === 2) gl.uniform2f(l, v[0], v[1]); else if (v.length === 3) gl.uniform3f(l, v[0], v[1], v[2]); else if (v.length === 4) gl.uniform4f(l, v[0], v[1], v[2], v[3]); }
    const res = ['u_resolution', 'iResolution', 'u_res']; for (const r of res) if (u(r)) { try { gl.uniform2f(u(r), W, H); } catch { gl.uniform3f(u(r), W, H, 1); } }
    const out = [];
    for (const t of [0.5, 1.5, 3]) {
      for (const n of ['u_time', 'iTime', 'time']) if (u(n)) gl.uniform1f(u(n), t);
      gl.viewport(0, 0, W, H); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); gl.drawArrays(gl.TRIANGLES, 0, 6);
      const px = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
      let black = 0, clipped = 0, lit = 0, sum = 0, sq = 0; const n = W * H;
      for (let i = 0; i < n; i++) {
        const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2];
        const l = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
        if (l < 0.02) black++;
        if (l >= 0.25) lit++;
        if (r >= 255 || g >= 255 || b >= 255) clipped++;
        sum += l; sq += l * l;
      }
      const mean = sum / n;
      out.push({ black: black / n, clipped: clipped / n, lit: lit / n, mean, spread: Math.sqrt(Math.max(0, sq / n - mean * mean)) });
    }
    return {
      black: Math.max(...out.map(o => o.black)), clipped: Math.max(...out.map(o => o.clipped)), lit: Math.min(...out.map(o => o.lit)),
      mean: out.reduce((s, o) => s + o.mean, 0) / out.length, spread: Math.min(...out.map(o => o.spread)),
    };
  } catch (e) { return { error: String(e.message || e).slice(0, 400) }; }
})()`;

const stats = {};
for (const job of list) {
  const r = await send('Runtime.evaluate', { expression: page(job), returnByValue: true });
  const v = r.result?.result?.value ?? { error: JSON.stringify(r.result?.exceptionDetails ?? r).slice(0, 300) };
  const round = x => Math.round(x * 10000) / 10000;
  stats[job.line] = v.error ? { hash: job.hash, error: v.error } : { hash: job.hash, black: round(v.black), clipped: round(v.clipped), lit: round(v.lit), mean: round(v.mean), spread: round(v.spread) };
  console.log(job.line.padEnd(48), v.error ? `ERROR ${v.error}` : `black ${round(v.black)} clipped ${round(v.clipped)} lit ${round(v.lit)} mean ${round(v.mean)} spread ${round(v.spread)}`);
}
writeFileSync(output, `${JSON.stringify(stats, null, 1)}\n`);
ws.close(); proc.kill();
process.exit(0);
