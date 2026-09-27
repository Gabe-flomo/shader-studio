#!/usr/bin/env node
/**
 * Sets the app's version to the newest release in src/changelog/releases.ts:
 * package.json, package-lock.json (its root entry) and src-tauri/tauri.conf.json.
 * See docs/release-notes.md.
 *
 *   npm run release:sync            write the version
 *   npm run release:sync -- --check  only report; exits 1 when something is out of date
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const check = process.argv.includes('--check');

const src = readFileSync(root + 'src/changelog/releases.ts', 'utf8');
const ids = [...src.matchAll(/\bid:\s*'(\d+\.\d+\.\d+)'/g)].map(m => m[1]);
if (!ids.length) { console.error('No release ids found in src/changelog/releases.ts'); process.exit(1); }
const cmp = (a, b) => { const pa = a.split('.').map(Number), pb = b.split('.').map(Number); for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i]; return 0; };
const latest = ids.sort(cmp).at(-1);

const files = [
  { path: 'package.json', get: j => j.version, set: j => { j.version = latest; } },
  { path: 'package-lock.json', get: j => j.packages?.['']?.version ?? j.version, set: j => { j.version = latest; if (j.packages?.['']) j.packages[''].version = latest; } },
  { path: 'src-tauri/tauri.conf.json', get: j => j.version, set: j => { j.version = latest; } },
];

let stale = 0;
for (const f of files) {
  const text = readFileSync(root + f.path, 'utf8');
  const json = JSON.parse(text);
  const was = f.get(json);
  if (was === latest) { console.log(`  ${f.path}: ${latest}`); continue; }
  stale++;
  if (check) { console.log(`  ${f.path}: ${was} (should be ${latest})`); continue; }
  f.set(json);
  writeFileSync(root + f.path, JSON.stringify(json, null, 2) + (text.endsWith('\n') ? '\n' : ''));
  console.log(`  ${f.path}: ${was} → ${latest}`);
}
if (check && stale) { console.error(`\n${stale} file(s) don't match the newest release (${latest}). Run: npm run release:sync`); process.exit(1); }
