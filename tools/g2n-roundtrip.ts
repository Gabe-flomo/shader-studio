/**
 * g2n-roundtrip.ts — the GLSL → node graph experiment's test bench.
 *
 *   npx vite-node tools/g2n-roundtrip.ts <dir with .frag files> <out dir>
 *
 * For each shader: convert it to a graph, compile the graph back to GLSL with
 * the app's compiler, and write both shaders (the original wrapped in the
 * same boilerplate) plus the graph and the conversion report. A separate
 * script renders each pair and compares the pixels.
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { glslToGraph, normaliseHostShader } from '../src/glslToGraph';
import { compileGraph } from '../src/compiler/graphCompiler';

const [dir, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });

// The original, rendered the way the app renders: same uniforms, same vUv-based coordinate frame.
const wrapOriginal = (body: string, vertex: string) => {
  const declared = (n: string) => new RegExp(`uniform\\s+\\w+\\s+${n}\\b`).test(body);
  const head = ['precision highp float;', 'varying vec2 vUv;', ...(declared('u_resolution') ? [] : ['uniform vec2 u_resolution;']), ...(declared('u_time') ? [] : ['uniform float u_time;']), ...(declared('u_mouse') ? [] : ['uniform vec2 u_mouse;'])];
  return { vertex, fragment: `${head.join('\n')}\n${body}` };
};

const rows: string[] = [];
for (const f of readdirSync(dir).filter(f => f.endsWith('.frag')).sort()) {
  const name = basename(f, '.frag');
  const src = readFileSync(join(dir, f), 'utf8');
  const t0 = performance.now();
  const r = glslToGraph(src);
  const ms = (performance.now() - t0).toFixed(1);
  const c = compileGraph({ nodes: r.nodes });
  const status = c.success ? 'compiled' : `COMPILE FAILED: ${(c.errors ?? []).join('; ').slice(0, 200)}`;
  const kinds = r.nodes.reduce<Record<string, number>>((m, n) => { m[n.type] = (m[n.type] ?? 0) + 1; return m; }, {});
  const blocks = r.nodes.filter(n => n.type === 'exprNode' || n.type === 'customFn').length;
  const rep = r.report;
  const lines = [`${name}: ${r.nodes.length} nodes (${blocks} code blocks, ${rep.stats.sliders} sliders) in ${ms} ms · ${status}`, `    kinds: ${JSON.stringify(kinds)}`];
  if (rep.unsupported.length) lines.push(`    UNSUPPORTED: ${rep.unsupported.join(' | ')}`);
  for (const b of rep.blocks) lines.push(`    block: ${b.code.replace(/\s+/g, ' ').slice(0, 90)}   ← ${b.why}`);
  for (const g of rep.regions) lines.push(`    region: ${g.code.replace(/\s+/g, ' ').slice(0, 90)}   ← ${g.why}`);
  if (rep.notes.length) lines.push(`    notes: ${rep.notes.join(' | ')}`);
  rows.push(lines.join('\n'));
  writeFileSync(join(out, `${name}.graph.json`), JSON.stringify({ nodes: r.nodes, report: r.report }, null, 1));
  writeFileSync(join(out, `${name}.orig.frag`), wrapOriginal(normaliseHostShader(src), c.vertexShader).fragment);
  writeFileSync(join(out, `${name}.graph.frag`), c.fragmentShader);
  writeFileSync(join(out, `${name}.vert`), c.vertexShader);
  // Sliders are live uniforms: the render needs their values, as the app sets them.
  writeFileSync(join(out, `${name}.uniforms.json`), JSON.stringify(c.paramUniforms));
}
console.log(rows.join('\n'));
