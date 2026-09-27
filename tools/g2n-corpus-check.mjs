// g2n-corpus-check.mjs — the Convert page's picture check over a g2n-corpus.mts run, in headless Chrome.
//
//   node tools/g2n-corpus-check.mjs <out dir> [webgl1]
//
// Renders each original and graph pair at 168 px, cleared to transparent black before each frame (what a discarded pixel shows), dither off, mouse (0.3, 0.6), at t = 1.5, 4 and 9.25,
// in WebGL2 with the prefix three.js gives a ShaderMaterial (what RenderPair and the app's preview use),
// or in WebGL1 when asked. Same picture: max error ≤ 2/255 and < 0.1 % of values more than 8 off, at every
// time. Prints one line per shader and the totals; writes check.json. CHROME overrides the browser path.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const [outArg, mode] = process.argv.slice(2);
if (!outArg) { console.error('usage: node tools/g2n-corpus-check.mjs <out dir> [webgl1]'); process.exit(1); }
const out = resolve(outArg);
const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const pairs = readFileSync(join(out, 'pairs.json'), 'utf8');

const page = `<!doctype html><meta charset=utf-8><pre id=out>running</pre><script>
const DATA = ${pairs.replace(/<\//g, '<\\/')};
const W2 = ${mode === 'webgl1' ? 'false' : 'true'};
const VS = 'attribute vec2 p; varying vec2 vUv; void main(){ vUv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }';
const VS2 = '#version 300 es\\nin vec2 p; out vec2 vUv; void main(){ vUv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }';
const PREFIX = '#version 300 es\\nprecision highp float;\\nprecision highp int;\\n#define varying in\\nlayout(location = 0) out highp vec4 pc_fragColor;\\n#define gl_FragColor pc_fragColor\\n#define texture2D texture\\n#define textureCube texture\\n';
const size = 168;
function ctx() { const c = document.createElement('canvas'); c.width = c.height = size; const gl = c.getContext(W2 ? 'webgl2' : 'webgl', { preserveDrawingBuffer: true, antialias: false, premultipliedAlpha: false }); const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW); gl.disable(gl.DITHER); return gl; }
function prog(gl, frag) { const cs = (t, s) => { const sh = gl.createShader(t); gl.shaderSource(sh, s); gl.compileShader(sh); if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh)); return sh; }; const p = gl.createProgram(); gl.attachShader(p, cs(gl.VERTEX_SHADER, W2 ? VS2 : VS)); gl.attachShader(p, cs(gl.FRAGMENT_SHADER, W2 ? PREFIX + frag : frag)); gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p)); return p; }
function draw(gl, p, t, U) { gl.useProgram(p); const l = gl.getAttribLocation(p, 'p'); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, 2, gl.FLOAT, false, 0, 0); const u = n => gl.getUniformLocation(p, n); if (u('u_resolution')) gl.uniform2f(u('u_resolution'), size, size); if (u('u_time')) gl.uniform1f(u('u_time'), t); if (u('u_mouse')) gl.uniform2f(u('u_mouse'), 0.3, 0.6); for (const [n, v] of Object.entries(U)) { const q = u(n); if (!q) continue; if (typeof v === 'number') { if (INTS(gl, p).has(n)) gl.uniform1i(q, Math.round(v)); else gl.uniform1f(q, v); } else if (v.length === 2) gl.uniform2f(q, v[0], v[1]); else if (v.length === 3) gl.uniform3f(q, v[0], v[1], v[2]); else gl.uniform4f(q, v[0], v[1], v[2], v[3]); } gl.viewport(0, 0, size, size); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.drawArrays(gl.TRIANGLES, 0, 3); const px = new Uint8Array(size * size * 4); gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; }
/** The program's int and bool uniforms (set with uniform1i). */
function INTS(gl, p) { if (!p.ints) { p.ints = new Set(); const k = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); for (let i = 0; i < k; i++) { const a = gl.getActiveUniform(p, i); if (a.type === gl.INT || a.type === gl.BOOL) p.ints.add(a.name); } } return p.ints; }
const res = [];
for (const d of DATA) {
  const r = { name: d.name }; const A = ctx(), B = ctx(); let pa, pb;
  try { pa = prog(A, d.orig); r.origOk = true; } catch (e) { r.origOk = false; r.origErr = String(e.message).split('\\n').filter(Boolean).slice(0, 2).join(' | '); }
  if (d.graph) { try { pb = prog(B, d.graph); r.graphOk = true; } catch (e) { r.graphOk = false; r.graphErr = String(e.message).split('\\n').filter(Boolean).slice(0, 2).join(' | '); } }
  if (pa && pb) {
    r.diffs = [];
    for (const t of [1.5, 4.0, 9.25]) { const a = draw(A, pa, t, d.origUniforms ?? {}), b = draw(B, pb, t, d.uniforms); let max = 0, bad = 0, n = 0; for (let i = 0; i < a.length; i++) { if ((i & 3) === 3) continue; const x = Math.abs(a[i] - b[i]); if (x > max) max = x; if (x > 8) bad++; n++; } r.diffs.push([max, +(100 * bad / n).toFixed(2)]); }
    r.same = r.diffs.every(x => x[0] <= 2 && x[1] < 0.1);
  }
  A.getExtension('WEBGL_lose_context')?.loseContext(); B.getExtension('WEBGL_lose_context')?.loseContext();
  res.push(r);
}
document.getElementById('out').textContent = 'RESULTS' + JSON.stringify(res) + 'END';
</script>`;
const htmlPath = join(out, 'check.html');
writeFileSync(htmlPath, page);

// --dump-dom prints the page once its script has run; headless Chrome doesn't always exit after, so stop it then.
const html = await new Promise(res => {
  const p = spawn(chrome, ['--headless=new', `--user-data-dir=${join(out, '.chrome')}`, '--ignore-gpu-blocklist', '--virtual-time-budget=600000', '--dump-dom', `file://${htmlPath}`], { stdio: ['ignore', 'pipe', 'ignore'] });
  let buf = '';
  p.stdout.on('data', d => { buf += d; if (buf.includes('</html>')) { p.kill('SIGKILL'); res(buf); } });
  p.on('exit', () => res(buf));
});
const m = /RESULTS(\[.*?)END<\/pre>/s.exec(html);
if (!m) { console.error('no results from Chrome'); process.exit(1); }
const check = JSON.parse(m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
const results = JSON.parse(readFileSync(join(out, 'results.json'), 'utf8'));
const rows = results.map(r => {
  const c = check.find(x => x.name === r.name) ?? {};
  const verdict = r.crashed ? 'crashed' : r.unsupported?.length ? 'refused' : !r.compileOk ? 'graph doesn’t compile' : !c.origOk ? 'original: WebGL error' : !c.graphOk ? 'graph: WebGL error' : c.same ? 'same picture' : 'differs';
  const why = r.crashed ? r.crashed.split('\n')[0] : r.unsupported?.length ? r.unsupported[0] : !r.compileOk ? (r.compileErrors ?? [])[0] : c.origOk === false ? c.origErr : c.graphOk === false ? c.graphErr : JSON.stringify(c.diffs);
  return { name: r.name, verdict, why: `${r.fixups ? `[fix-ups: ${r.fixups.join(', ')}] ` : ''}${why ?? ''}` };
});
writeFileSync(join(out, `check${mode === 'webgl1' ? '-webgl1' : ''}.json`), JSON.stringify(rows, null, 1));
const count = {};
for (const r of rows) { count[r.verdict] = (count[r.verdict] ?? 0) + 1; console.log(`${r.name.padEnd(28)} ${r.verdict.padEnd(22)} ${r.why.slice(0, 120)}`); }
console.log(count);
