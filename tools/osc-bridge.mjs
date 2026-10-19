#!/usr/bin/env node
/**
 * osc-bridge.mjs — OSC → WebSocket bridge for Shader Studio's Play page.
 *
 * Browsers can't receive UDP, so this listens for OSC on a UDP port and
 * forwards every message to any open Shader Studio tab over a WebSocket on
 * 127.0.0.1, as JSON `{ "a": "/address", "v": [args] }`. No dependencies.
 *
 *   npm run osc-bridge                         # UDP 9000 in, ws://127.0.0.1:9001 out
 *   node tools/osc-bridge.mjs --udp 8000 --ws 9001
 *   node tools/osc-bridge.mjs --test           # send yourself a test message every second
 *   npm run osc-bridge -- --live               # the Live connector: UDP 11101 in, ws://127.0.0.1:9002,
 *                                              # and the page's commands back to Live on UDP 11100
 *
 * Ableton Live: add Connection Kit's "OSC Send" (Max for Live), host 127.0.0.1,
 * port 9000, map any knob; its address shows up in Shader Studio's Learn.
 * TouchOSC: set the OSC connection's host to this computer, send port 9000.
 */
import dgram from 'node:dgram';
import http from 'node:http';
import crypto from 'node:crypto';
import { decodeOsc, encodeOsc } from '../src/lib/osc/decode.js';

const argv = process.argv.slice(2);
const opt = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : fallback; };
// --live: the Live connector (tools/live-connector): receive from its Remote Script and send the page's commands back.
const LIVE = argv.includes('--live');
const LIVE_OUT_PORT = 11100;
const UDP_PORT = opt('udp', LIVE ? 11101 : 9000);
const WS_PORT = opt('ws', LIVE ? 9002 : 9001);
const HOST = argv.includes('--lan') && !LIVE ? '0.0.0.0' : '127.0.0.1';
const verbose = argv.includes('--verbose');

// ── WebSocket server (RFC 6455, text frames out, close/ping in) ─────────────
const clients = new Set();
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function frame(text) {
  const payload = Buffer.from(text);
  const n = payload.length;
  const head = n < 126 ? Buffer.from([0x81, n])
    : n < 65536 ? Buffer.from([0x81, 126, n >> 8, n & 255])
    : (() => { const b = Buffer.alloc(10); b[0] = 0x81; b[1] = 127; b.writeBigUInt64BE(BigInt(n), 2); return b; })();
  return Buffer.concat([head, payload]);
}

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end(`Shader Studio OSC bridge: OSC in on udp/${UDP_PORT}, WebSocket out on ${WS_PORT}. ${clients.size} tab(s) connected.\n`);
});

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write(['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade', `Sec-WebSocket-Accept: ${accept}`, '', ''].join('\r\n'));
  clients.add(socket);
  console.log(`[bridge] tab connected (${clients.size})`);
  socket.on('data', buf => {
    const op = buf[0] & 0x0f;
    if (op === 0x8) { try { socket.end(Buffer.from([0x88, 0])); } catch { /* gone */ } }
    else if (op === 0x9) { try { socket.write(Buffer.from([0x8a, 0])); } catch { /* gone */ } }
    else if (op === 0x1 && LIVE) for (const text of textFrames(buf)) toLive(text);
  });
  const drop = () => { if (clients.delete(socket)) console.log(`[bridge] tab disconnected (${clients.size})`); };
  socket.on('close', drop);
  socket.on('error', drop);
});

function broadcast(msg) {
  const data = frame(JSON.stringify({ a: msg.address, v: msg.args }));
  for (const c of clients) { try { c.write(data); } catch { clients.delete(c); } }
}

/** The (masked, small) text frames a tab sent in one chunk. */
function textFrames(buf) {
  const out = [];
  let o = 0;
  while (o + 2 <= buf.length) {
    const op = buf[o] & 0x0f;
    let len = buf[o + 1] & 0x7f, at = o + 2;
    if (len === 126) { if (at + 2 > buf.length) break; len = buf.readUInt16BE(at); at += 2; }
    else if (len === 127) break;
    const masked = (buf[o + 1] & 0x80) !== 0;
    const mask = masked ? buf.subarray(at, at + 4) : null;
    if (masked) at += 4;
    if (at + len > buf.length) break;
    const payload = Buffer.from(buf.subarray(at, at + len));
    if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
    if (op === 0x1) out.push(payload.toString('utf8'));
    o = at + len;
  }
  return out;
}

/** A page's command (`{ a, v }`, only /pf/… addresses) to the Live connector. */
const liveOut = LIVE ? dgram.createSocket('udp4') : null;
function toLive(text) {
  try {
    const d = JSON.parse(text);
    if (typeof d.a !== 'string' || !d.a.startsWith('/pf/')) return;
    const args = (Array.isArray(d.v) ? d.v : []).filter(x => typeof x === 'number' || typeof x === 'string' || typeof x === 'boolean' || (x && typeof x === 'object' && Number.isInteger(x.i)));
    if (verbose) console.log(`[live] → ${d.a} ${JSON.stringify(args)}`);
    liveOut?.send(encodeOsc(d.a, args), LIVE_OUT_PORT, '127.0.0.1');
  } catch { /* not ours */ }
}

// ── UDP OSC in ──────────────────────────────────────────────────────────────
const udp = dgram.createSocket('udp4');
udp.on('message', packet => {
  for (const msg of decodeOsc(packet)) {
    if (verbose) console.log(`[osc] ${msg.address} ${JSON.stringify(msg.args)}`);
    broadcast(msg);
  }
});
udp.on('error', e => { console.error(`[bridge] UDP error: ${e.message}`); process.exit(1); });
server.on('error', e => { console.error(`[bridge] WebSocket port ${WS_PORT}: ${e.message}`); process.exit(1); });

udp.bind(UDP_PORT, HOST, () => {
  server.listen(WS_PORT, '127.0.0.1', () => {
    console.log(LIVE ? `Shader Studio OSC bridge: Live connector` : `Shader Studio OSC bridge`);
    if (LIVE) console.log(`  To Live:  udp://127.0.0.1:${LIVE_OUT_PORT}`);
    console.log(`  OSC in:   udp://${HOST}:${UDP_PORT}${HOST === '127.0.0.1' && !LIVE ? '  (add --lan to accept a phone or another computer)' : ''}`);
    console.log(`  Browser:  ws://127.0.0.1:${WS_PORT}`);
    console.log(`  Ctrl+C to stop.${verbose ? '' : ' Add --verbose to print every message.'}`);
    if (argv.includes('--test')) {
      const out = dgram.createSocket('udp4');
      let t = 0;
      setInterval(() => { t += 1; out.send(encodeOsc('/test/sine', [0.5 + 0.5 * Math.sin(t / 2)]), UDP_PORT, '127.0.0.1'); }, 100);
      console.log('  Test: sending /test/sine ten times a second.');
    }
  });
});
