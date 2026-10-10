#!/usr/bin/env node
/**
 * fetch-depth-models.mjs — fetch the Depth node's model files (src/depthModel/config.ts) into
 * .cache/depth-models/<repo>/ (docs/depth-node.md).
 *
 * For a local check without the browser's download: the dev server serves them at /depth-models/… and the app
 * reads them with `?depthModel=local`. They aren't committed and aren't bundled with the desktop app (each model is
 * an opt-in download, and Depth Anything V2 Base's licence is non-commercial). Each file's size is checked.
 *
 *   node tools/fetch-depth-models.mjs                 fetch what's missing, every model
 *   node tools/fetch-depth-models.mjs small midas     only the models whose id contains a word
 *   node tools/fetch-depth-models.mjs --check         exit 1 when anything is missing
 */
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Each model's id, repo, revision and files, read from the app's own config (one source of truth). */
export function depthModels() {
  const src = readFileSync(join(root, 'src/depthModel/config.ts'), 'utf8');
  const shared = { DA_FILES: [...(/const DA_FILES[^=]*= \[([\s\S]*?)\];/.exec(src)?.[1] ?? '').matchAll(/\{ path: '([^']+)', bytes: (\d+) \}/g)].map(m => ({ path: m[1], bytes: Number(m[2]) })) };
  const body = /export const DEPTH_MODELS[^=]*= \[([\s\S]*?)\n\];/.exec(src)[1];
  return body.split(/\n  \{\n/).slice(1).map(block => {
    const id = /id: '([^']+)'/.exec(block)[1];
    const repo = /repo: '([^']+)'/.exec(block)[1];
    const revision = /revision: '([^']+)'/.exec(block)[1];
    const own = [...block.matchAll(/\{ path: '([^']+)', bytes: (\d+) \}/g)].map(m => ({ path: m[1], bytes: Number(m[2]) }));
    const files = /files: DA_FILES/.test(block) ? [...shared.DA_FILES, ...own] : own;
    return { id, repo, revision, files };
  });
}

export const cacheDir = (repo) => join(root, '.cache/depth-models', repo);

export function missingFiles(m) {
  const dir = cacheDir(m.repo);
  return m.files.filter(f => { const p = join(dir, f.path); return !existsSync(p) || statSync(p).size !== f.bytes; });
}

export async function fetchDepthModel(m, log = console.log) {
  const dir = cacheDir(m.repo);
  for (const f of missingFiles(m)) {
    const url = `https://huggingface.co/${m.repo}/resolve/${m.revision}/${f.path}`;
    const out = join(dir, f.path);
    mkdirSync(dirname(out), { recursive: true });
    log(`[depth] ${m.id}: ${f.path} (${(f.bytes / 1048576).toFixed(1)} MB)`);
    const res = await fetch(url);
    if (!res.ok || !res.body) throw new Error(`${url}: ${res.status}`);
    await pipeline(Readable.fromWeb(res.body), createWriteStream(`${out}.part`));
    const size = statSync(`${out}.part`).size;
    if (size !== f.bytes) throw new Error(`${f.path}: got ${size} bytes, expected ${f.bytes}`);
    renameSync(`${out}.part`, out);
  }
  return dir;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const words = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const models = depthModels().filter(m => !words.length || words.some(w => m.id.includes(w)));
  if (process.argv.includes('--check')) {
    const miss = models.flatMap(m => missingFiles(m).map(f => `${m.id}/${f.path}`));
    if (miss.length) { console.error(`Missing: ${miss.join(', ')}`); process.exit(1); }
    console.log('The depth models are here.');
  } else {
    (async () => { for (const m of models) console.log(`${m.id} is in ${await fetchDepthModel(m)}`); })().catch(e => { console.error(e); process.exit(1); });
  }
}
