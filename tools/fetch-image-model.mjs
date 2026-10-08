#!/usr/bin/env node
/**
 * fetch-image-model.mjs — fetch the image model's files (src/imageModel/config.ts) into
 * .cache/image-model/<repo>/ for the desktop bundle (docs/taste.md "How things look").
 *
 * The desktop app ships these files inside the app (vite.config.ts copies them to dist/models/ in a Tauri
 * build), so it works offline from the first launch. They aren't committed: a Tauri build runs this when
 * they're missing (once; later builds reuse the cache). Each file's size is checked against the config.
 *
 *   node tools/fetch-image-model.mjs          fetch what's missing
 *   node tools/fetch-image-model.mjs --check  exit 1 when anything is missing
 */
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The model's repo, revision and files, read from the app's own config (one source of truth). */
export function modelConfig() {
  const src = readFileSync(join(root, 'src/imageModel/config.ts'), 'utf8');
  const repo = /repo: '([^']+)'/.exec(src)[1];
  const revision = /revision: '([^']+)'/.exec(src)[1];
  const files = [...src.matchAll(/\{ path: '([^']+)', bytes: (\d+) \}/g)].map(m => ({ path: m[1], bytes: Number(m[2]) }));
  return { repo, revision, files };
}

export const cacheDir = (repo) => join(root, '.cache/image-model', repo);

export function missingFiles() {
  const { repo, files } = modelConfig();
  const dir = cacheDir(repo);
  return files.filter(f => { const p = join(dir, f.path); return !existsSync(p) || statSync(p).size !== f.bytes; });
}

export async function fetchImageModel(log = console.log) {
  const { repo, revision } = modelConfig();
  const dir = cacheDir(repo);
  for (const f of missingFiles()) {
    const url = `https://huggingface.co/${repo}/resolve/${revision}/${f.path}`;
    const out = join(dir, f.path);
    mkdirSync(dirname(out), { recursive: true });
    log(`[image model] ${f.path} (${(f.bytes / 1048576).toFixed(1)} MB)`);
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
  if (process.argv.includes('--check')) {
    const m = missingFiles();
    if (m.length) { console.error(`Missing: ${m.map(f => f.path).join(', ')}`); process.exit(1); }
    console.log('The image model is here.');
  } else {
    fetchImageModel().then(d => console.log(`The image model is in ${d}`), e => { console.error(e); process.exit(1); });
  }
}
