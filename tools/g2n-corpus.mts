/**
 * g2n-corpus.mts — a folder of shaders through the converter the way the
 * Convert page runs it: glslToGraph, then optimizeGraph (the page's default
 * "Optimised" form), then compileGraph. Writes results.json (one row per
 * shader: refused and why, blocks, regions, compile errors) and pairs.json
 * (the original wrapped as the page wraps it, and the graph's shader) for the
 * pixel check in g2n-corpus-check.mjs.
 *
 *   npx tsx tools/g2n-corpus.mts src/glslToGraph/__tests__/corpus/user /tmp/g2n
 *   node tools/g2n-corpus-check.mjs /tmp/g2n
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { glslToGraph, normaliseHostShader } from '../src/glslToGraph/index.ts';
import { optimizeGraph } from '../src/optimize/optimizeGraph.ts';
import { compileGraph } from '../src/compiler/graphCompiler.ts';

const [dir, out] = process.argv.slice(2);
if (!dir || !out) { console.error('usage: npx tsx tools/g2n-corpus.mts <dir of .glsl/.frag> <out dir>'); process.exit(1); }
mkdirSync(out, { recursive: true });

const results: Record<string, unknown>[] = [];
const pairs: unknown[] = [];
for (const f of readdirSync(dir).filter(f => /\.(glsl|frag)$/.test(f)).sort()) {
  const name = f.replace(/\.(glsl|frag)$/, '');
  const src = readFileSync(join(dir, f), 'utf8');
  try {
    // The original, as ConvertPage's wrapOriginal gives it to the check.
    const body = normaliseHostShader(src).code;
    const declared = (n: string) => new RegExp(`uniform\\s+\\w+\\s+${n}\\b`).test(body);
    const head = ['precision highp float;', 'varying vec2 vUv;', ...(declared('u_resolution') ? [] : ['uniform vec2 u_resolution;']), ...(declared('u_time') ? [] : ['uniform float u_time;']), ...(declared('u_mouse') ? [] : ['uniform vec2 u_mouse;'])];
    const raw = glslToGraph(src);
    let compiled: ReturnType<typeof compileGraph> | null = null;
    if (raw.nodes.length) {
      try { compiled = compileGraph({ nodes: optimizeGraph(raw.nodes, { minChain: 3, keepSliders: true }).nodes }); }
      catch (e) { compiled = { success: false, errors: [`threw: ${(e as Error).message}`] } as ReturnType<typeof compileGraph>; }
    }
    pairs.push({ name, orig: `${head.join('\n')}\n${body}`, graph: compiled?.success ? compiled.fragmentShader : null, uniforms: compiled?.paramUniforms ?? {} });
    results.push({
      name, unsupported: raw.report.unsupported, nodes: raw.nodes.length, loops: raw.report.stats.loops,
      blocks: raw.report.blocks.map(b => b.why), regions: raw.report.regions.map(r => r.why),
      compileOk: compiled?.success ?? null, compileErrors: compiled && !compiled.success ? compiled.errors : undefined,
    });
  } catch (e) {
    results.push({ name, crashed: String((e as Error).stack ?? e).split('\n').slice(0, 6).join('\n') });
  }
}
writeFileSync(join(out, 'results.json'), JSON.stringify(results, null, 1));
writeFileSync(join(out, 'pairs.json'), JSON.stringify(pairs));
console.log(`${results.length} shaders → ${out}/results.json, pairs.json`);
