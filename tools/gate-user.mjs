#!/usr/bin/env node
/**
 * Add, replace or remove a sign-in gate user (docs/sign-in-gate.md).
 *
 *   npm run gate:user -- <username> <free|pro>     asks for the password (not echoed)
 *   echo 'the password' | npm run gate:user -- <username> <free|pro>
 *   npm run gate:remove -- <username>
 *   npm run gate:user -- --list
 *
 * Writes src/auth/gateUsers.json with a salted PBKDF2-SHA256 hash. The
 * password itself is never written anywhere. Rebuild (or let the dev server
 * reload) for the change to reach the app.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FILE = fileURLToPath(new URL('../src/auth/gateUsers.json', import.meta.url));
const ITERATIONS = 150_000;
const HASH_BYTES = 32;
const b64 = bytes => Buffer.from(bytes).toString('base64');

async function hashPassword(password, salt, iterations) {
  const { subtle } = globalThis.crypto;
  const key = await subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: Buffer.from(salt, 'base64'), iterations }, key, HASH_BYTES * 8);
  return b64(new Uint8Array(bits));
}

function readUsers() {
  try {
    const data = JSON.parse(readFileSync(FILE, 'utf8'));
    return Array.isArray(data.users) ? data.users : [];
  } catch {
    return [];
  }
}

function writeUsers(users) {
  writeFileSync(FILE, JSON.stringify({ users }, null, 2) + '\n');
}

/** A hidden prompt on a terminal; otherwise the first line of stdin. */
function readPassword(prompt) {
  const { stdin, stderr } = process;
  if (!stdin.isTTY) {
    return new Promise((resolve, reject) => {
      let data = '';
      stdin.setEncoding('utf8');
      stdin.on('data', c => { data += c; });
      stdin.on('end', () => resolve(data.split(/\r?\n/)[0] ?? ''));
      stdin.on('error', reject);
    });
  }
  return new Promise(resolve => {
    stderr.write(prompt);
    let value = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = chunk => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n' || ch === '\u0004') {
          stdin.setRawMode(false); stdin.pause(); stdin.off('data', onData);
          stderr.write('\n');
          resolve(value);
          return;
        }
        if (ch === '\u0003') { stdin.setRawMode(false); stderr.write('\n'); process.exit(130); }
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

const [mode, ...args] = process.argv.slice(2);

if (mode === 'remove') {
  const name = (args[0] ?? '').trim();
  if (!name) fail('Usage: npm run gate:remove -- <username>');
  const users = readUsers();
  const kept = users.filter(u => String(u.username).toLowerCase() !== name.toLowerCase());
  if (kept.length === users.length) fail(`No user called “${name}”.`);
  writeUsers(kept);
  console.log(`Removed “${name}”. ${kept.length} user${kept.length === 1 ? '' : 's'} left${kept.length === 0 ? ': the gate is off (everyone is Pro)' : ''}.`);
} else if (mode === 'add' && args[0] === '--list') {
  const users = readUsers();
  if (users.length === 0) console.log('No users: the gate is off (everyone is Pro).');
  for (const u of users) console.log(`${u.username}\t${u.plan}`);
} else if (mode === 'add') {
  const [rawName, plan] = args;
  const name = (rawName ?? '').trim();
  if (!name || (plan !== 'free' && plan !== 'pro')) fail('Usage: npm run gate:user -- <username> <free|pro>');
  if (!/^[\w.@+-]{1,64}$/.test(name)) fail('Usernames: letters, digits and . _ @ + - only, up to 64.');
  const password = await readPassword(`Password for ${name}: `);
  if (password.length < 8) fail('Use a password of at least 8 characters.');
  if (process.stdin.isTTY) {
    const again = await readPassword('Again: ');
    if (again !== password) fail('The passwords didn’t match. Nothing changed.');
  }
  const salt = b64(globalThis.crypto.getRandomValues(new Uint8Array(16)));
  const hash = await hashPassword(password, salt, ITERATIONS);
  const users = readUsers();
  const at = users.findIndex(u => String(u.username).toLowerCase() === name.toLowerCase());
  const entry = { username: name, plan, salt, hash, iterations: ITERATIONS };
  if (at >= 0) users[at] = entry; else users.push(entry);
  writeUsers(users);
  console.log(`${at >= 0 ? 'Replaced' : 'Added'} “${name}” (${plan}). ${users.length} user${users.length === 1 ? '' : 's'}: the gate is on.`);
} else {
  fail('Usage: npm run gate:user -- <username> <free|pro>  |  npm run gate:remove -- <username>');
}
