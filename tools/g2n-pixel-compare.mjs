// g2n-pixel-compare.mjs — render two fragment shaders headlessly and compare their pixels.
// Part of the GLSL → node graph experiment (docs/glsl-to-nodes.md):
//   npx vite-node tools/g2n-roundtrip.ts src/glslToGraph/__tests__/corpus /tmp/g2n-out
//   node tools/g2n-pixel-compare.mjs /tmp/g2n-out
// Usage: node pixelCompare.mjs a.frag b.frag   (prints max/mean abs error in 0..255 and PSNR)
// Both shaders get: precision, uniform vec2 u_resolution, uniform float u_time, uniform vec2 u_mouse.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { readFileSync } from 'node:fs';

export async function compareShaders(fragA, fragB, { size = 96, time = 1.5, mouse = [0.3, 0.6], browser: b, vertex = null, uniforms = {} } = {}) {
  const browser = b ?? await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage();
  await page.setContent('<canvas id=c></canvas>');
  const out = await page.evaluate(({ fragA, fragB, size, time, mouse, vertex, uniforms }) => {
    const c = document.getElementById('c'); c.width = size; c.height = size;
    const gl = c.getContext('webgl', { preserveDrawingBuffer: true, antialias: false, premultipliedAlpha: false });
    if (!gl) return { error: 'no webgl' };
    // The app's vertex shader (it feeds vUv); the plain one when a shader doesn't need it.
    const VS = vertex ? 'attribute vec2 p;\n' + vertex.replace(/attribute vec3 position;?/, 'attribute vec2 p;').replace(/attribute vec2 uv;?/, '').replace(/vUv\s*=\s*uv;/, 'vUv = p * 0.5 + 0.5;').replace(/vec4\(\s*position\s*,\s*1\.0\s*\)/, 'vec4(p, 0.0, 1.0)').replace(/projectionMatrix\s*\*\s*modelViewMatrix\s*\*\s*/, '') : 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }';
    const compile = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const render = (frag) => {
      const prog = gl.createProgram();
      gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, frag)); gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
      gl.useProgram(prog);
      const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      const u = n => gl.getUniformLocation(prog, n);
      if (u('u_resolution')) gl.uniform2f(u('u_resolution'), size, size);
      if (u('u_time')) gl.uniform1f(u('u_time'), time);
      if (u('u_mouse')) gl.uniform2f(u('u_mouse'), mouse[0], mouse[1]);
      for (const [n, v] of Object.entries(uniforms)) { const l = u(n); if (!l) continue; if (typeof v === 'number') gl.uniform1f(l, v); else if (v.length === 2) gl.uniform2f(l, v[0], v[1]); else if (v.length === 3) gl.uniform3f(l, v[0], v[1], v[2]); else if (v.length === 4) gl.uniform4f(l, v[0], v[1], v[2], v[3]); }
      gl.disable(gl.DITHER); gl.viewport(0, 0, size, size); gl.drawArrays(gl.TRIANGLES, 0, 3);
      const px = new Uint8Array(size * size * 4); gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, px); return Array.from(px);
    };
    try {
      const A = render(fragA), B = render(fragB);
      let max = 0, sum = 0, sq = 0, n = 0, bad = 0;
      for (let i = 0; i < A.length; i++) { if (i % 4 === 3) continue; const d = Math.abs(A[i] - B[i]); if (d > max) max = d; sum += d; sq += d * d; n++; if (d > 8) bad++; }
      const mse = sq / n; const psnr = mse === 0 ? Infinity : 10 * Math.log10(255 * 255 / mse);
      return { max, mean: +(sum / n).toFixed(3), psnr: +psnr.toFixed(1), badPct: +(100 * bad / n).toFixed(2) };
    } catch (e) { return { error: String(e.message || e) }; }
  }, { fragA, fragB, size, time, mouse, vertex, uniforms });
  await page.close();
  if (!b) await browser.close();
  return out;
}

if (process.argv[1] && /pixel-?[cC]ompare\.mjs$/.test(process.argv[1]) && process.argv.length >= 3) {
  const { readdirSync, statSync } = await import('node:fs');
  const a = process.argv[2];
  if (statSync(a).isDirectory()) {
    // Batch: every <name>.orig.frag vs <name>.graph.frag in the directory, with <name>.vert.
    const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
    for (const f of readdirSync(a).filter(f => f.endsWith('.orig.frag')).sort()) {
      const name = f.replace('.orig.frag', '');
      const vert = readFileSync(`${a}/${name}.vert`, 'utf8');
      let uniforms = {}; try { uniforms = JSON.parse(readFileSync(`${a}/${name}.uniforms.json`, 'utf8')); } catch {}
      const r = await compareShaders(readFileSync(`${a}/${f}`, 'utf8'), readFileSync(`${a}/${name}.graph.frag`, 'utf8'), { browser, vertex: vert, uniforms });
      console.log(name.padEnd(12), JSON.stringify(r));
    }
    await browser.close();
  } else {
    const r = await compareShaders(readFileSync(a, 'utf8'), readFileSync(process.argv[3], 'utf8'), { vertex: process.argv[4] ? readFileSync(process.argv[4], 'utf8') : null });
    console.log(JSON.stringify(r));
  }
}
