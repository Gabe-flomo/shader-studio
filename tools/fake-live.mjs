#!/usr/bin/env node
/**
 * fake-live.mjs — a stand-in for Ableton Live running the Live connector
 * (tools/live-connector/Playfield), for development and tests. It speaks the
 * same OSC: hello every second, the catalogue of a small set, the "Playfield"
 * rack's macros sweeping, a 120 BPM transport, clip and scene launches, and
 * answers Playfield's commands (ping, catalogue, watch, fire clip/scene, stop
 * all, tap) like the script does.
 *
 *   node tools/fake-live.mjs                     # sends to udp 11101, listens on 11100
 *   node tools/fake-live.mjs --jitter 15 --loss 0.2 --tempo 128 --verbose
 *   node tools/fake-live.mjs --learn-every 5     # "clicks" a parameter every 5 s (Learn)
 *
 * The browser goes through the bridge: `npm run osc-bridge -- --live` beside it.
 * Tests import `FakeLive` and drive it with their own clock (no sockets).
 */
import dgram from 'node:dgram';
import { pathToFileURL } from 'node:url';
import { decodeOsc, encodeOsc, encodeBundle } from '../src/lib/osc/decode.js';

const VERSION = '1.0.0';
const RED = 0xff3b30, BLUE = 0x3b7bff, GREEN = 0x34c759, AMBER = 0xffb020, GREY = 0x8e8e93;

/** The fake set: tracks, their devices and parameters, and scenes. */
function makeSet() {
  const macros = ['Filter sweep', 'Glow', 'Drive', 'Space', 'Macro 5', 'Macro 6', 'Macro 7', 'Macro 8'];
  return {
    name: 'Fake Set',
    tracks: [
      { name: 'Drums', colour: RED, kind: 'track', clips: ['Beat A', 'Beat B', 'Fill'], devices: [
        { name: 'Drum Rack', params: [{ name: 'Device On', min: 0, max: 1, quantized: true, items: ['Off', 'On'], value: 1 }] },
      ] },
      { name: 'Bass', colour: BLUE, kind: 'track', clips: ['Bassline', 'Bassline 2', ''], devices: [
        { name: 'Auto Filter', params: [
          { name: 'Device On', min: 0, max: 1, quantized: true, items: ['Off', 'On'], value: 1 },
          { name: 'Frequency', min: 20, max: 135, value: 80, unit: 'freq' },
          { name: 'Resonance', min: 0, max: 1.25, value: 0.3 },
          { name: 'Filter Type', min: 0, max: 3, quantized: true, items: ['Lowpass', 'Highpass', 'Bandpass', 'Notch'], value: 0 },
        ] },
      ] },
      { name: 'Pad', colour: GREEN, kind: 'track', clips: ['Chords', '', 'Chords 2'], devices: [
        { name: 'Playfield', rack: true, params: [
          { name: 'Device On', min: 0, max: 1, quantized: true, items: ['Off', 'On'], value: 1 },
          ...macros.map((n, i) => ({ name: n, min: 0, max: 127, value: i * 10, macro: true })),
        ] },
      ] },
      { name: 'A-Reverb', colour: AMBER, kind: 'return', clips: [], devices: [{ name: 'Reverb', params: [{ name: 'Decay Time', min: 200, max: 60000, value: 2400 }] }] },
      { name: 'Master', colour: GREY, kind: 'master', clips: [], devices: [] },
    ],
    scenes: [{ name: 'Intro', colour: GREY }, { name: 'Verse', colour: BLUE }, { name: 'Drop', colour: RED }],
  };
}

function display(p, v) {
  if (p.quantized && p.items) return p.items[Math.max(0, Math.min(p.items.length - 1, Math.round(v)))] ?? String(v);
  if (p.unit === 'freq') { const hz = 26 * Math.pow(2, (v - 20) / 10); return hz >= 1000 ? `${(hz / 1000).toFixed(1)} kHz` : `${Math.round(hz)} Hz`; }
  return v.toFixed(2);
}

/**
 * The fake Live. `tick(now)` returns the datagrams due by `now` (ms); `handle(packet, now)`
 * answers a command. Options: tempo, jitterMs (how late each transport send may be), loss
 * (0..1, the chance a transport or param datagram is lost), rand (for tests), playing,
 * transportMs (how often the transport goes out while playing), learnEveryMs.
 */
export class FakeLive {
  constructor(o = {}) {
    this.tempo = o.tempo ?? 120;
    this.jitterMs = o.jitterMs ?? 0;
    this.loss = o.loss ?? 0;
    this.rand = o.rand ?? Math.random;
    this.playing = o.playing ?? true;
    this.transportMs = o.transportMs ?? 40;
    this.learnEveryMs = o.learnEveryMs ?? 0;
    this.set = makeSet();
    this.gen = 1;
    this.counter = 0;
    this.startAt = null;
    this.startBeats = 0;
    this.nextHello = 0;
    this.nextTransport = 0;
    this.nextLearn = this.learnEveryMs || Infinity;
    this.learnIndex = 0;
    this.lastBar = -1;
    this.watched = new Set();
    this.sent = [];
    this.queue = [];
    this.params = [];
    for (const t of this.set.tracks) for (const d of t.devices) for (const p of d.params) {
      this.params.push({ ...p, key: `${t.name} / ${d.name} / ${p.name}`, track: t.name, device: d.name, role: d.rack && p.macro ? 'rack' : '' });
    }
  }

  /** Song time in beats at `now` (Live's own, exact). */
  beatsAt(now) {
    if (this.startAt === null) this.startAt = now;
    return this.playing ? this.startBeats + ((now - this.startAt) * this.tempo) / 60000 : this.startBeats;
  }

  setPlaying(on, now) {
    this.startBeats = this.beatsAt(now);
    this.startAt = now;
    this.playing = on;
    return [this.transport(now)];
  }

  setTempo(bpm, now) {
    this.startBeats = this.beatsAt(now);
    this.startAt = now;
    this.tempo = bpm;
    return [this.transport(now)];
  }

  /** Move the playhead (a loop wrapping, the user clicking the ruler). */
  jump(beats, now) {
    this.startBeats = beats;
    this.startAt = now;
    return [this.transport(now)];
  }

  hello() { return encodeOsc('/pf/hello', [VERSION, '12.4.6', this.set.name, { i: this.gen }]); }

  transport(now) {
    this.counter++;
    return encodeOsc('/pf/transport', [{ i: this.playing ? 1 : 0 }, this.tempo, { d: this.beatsAt(now) }, { i: 4 }, { i: 4 }, { i: this.counter }]);
  }

  /** The catalogue as bundles under 8000 bytes. */
  catalog(now) {
    const msgs = [encodeOsc('/pf/catalog/begin', [{ i: this.gen }, { i: this.params.length }])];
    this.set.tracks.forEach((t, i) => msgs.push(encodeOsc('/pf/catalog/track', [{ i }, t.name, { i: t.colour }, t.kind])));
    this.set.scenes.forEach((s, i) => msgs.push(encodeOsc('/pf/catalog/scene', [{ i }, s.name, { i: s.colour }])));
    for (const p of this.params) {
      msgs.push(encodeOsc('/pf/catalog/param', [p.key, p.track, p.device, p.name, p.min, p.max, { i: p.quantized ? 1 : 0 }, this.value(p, now), (p.items ?? []).join('|'), p.role]));
    }
    msgs.push(encodeOsc('/pf/catalog/end', [{ i: this.gen }]));
    const out = [];
    let batch = [], size = 16;
    for (const m of msgs) {
      if (size + 4 + m.length > 8000 && batch.length) { out.push(encodeBundle(batch)); batch = []; size = 16; }
      batch.push(m); size += 4 + m.length;
    }
    if (batch.length) out.push(encodeBundle(batch));
    return out;
  }

  /** A parameter's value now: rack macros and the filter sweep, the rest stay put. */
  value(p, now) {
    const t = now / 1000;
    if (p.role === 'rack' && p.name === 'Filter sweep') return 63.5 + 63.5 * Math.sin(t * 0.8);
    if (p.role === 'rack' && p.name === 'Glow') return 63.5 + 63.5 * Math.sin(t * 2.1 + 1);
    if (p.name === 'Frequency') return 77.5 + 57.5 * Math.sin(t * 0.5);
    return p.value;
  }

  paramMessage(p, now) {
    const v = this.value(p, now);
    return encodeOsc('/pf/param', [p.key, v, p.min, p.max, display(p, v)]);
  }

  lost() { return this.loss > 0 && this.rand() < this.loss; }

  /** Datagrams due by `now`. */
  tick(now) {
    const out = [];
    if (now >= this.nextHello) { out.push(this.hello()); this.nextHello = now + 1000; }
    if (this.playing && now >= this.nextTransport) {
      // Taken now, delivered up to jitterMs later (Live's main thread, the event loop on our side).
      const late = this.jitterMs ? this.rand() * this.jitterMs : 0;
      this.nextTransport = now + this.transportMs;
      if (!this.lost()) this.queue.push({ at: now + late, packet: this.transport(now) });
      // Parameters that move, at the same rate.
      const moving = this.params.filter(p => (p.role === 'rack' || this.watched.has(p.key)) && this.value(p, now) !== p.value);
      if (moving.length && !this.lost()) out.push(encodeBundle(moving.map(p => this.paramMessage(p, now))));
      // A clip every bar on Drums (triggered a beat early), a scene every 4 bars.
      const beats = this.beatsAt(now), bar = Math.floor(beats / 4);
      if (bar !== this.lastBar) {
        this.lastBar = bar;
        const slot = bar % 2;
        const drums = this.set.tracks[0];
        out.push(encodeOsc('/pf/clip', [{ i: 0 }, drums.name, { i: slot }, 'playing', drums.clips[slot], { i: drums.colour }]));
        out.push(encodeOsc('/pf/clip', [{ i: 0 }, drums.name, { i: 1 - slot }, 'triggered', drums.clips[1 - slot], { i: drums.colour }]));
        if (bar % 4 === 0) { const s = this.set.scenes[(bar / 4) % this.set.scenes.length]; out.push(encodeOsc('/pf/scene', [{ i: (bar / 4) % this.set.scenes.length }, s.name, { i: s.colour }])); }
      }
    }
    if (now >= this.nextLearn) {
      this.nextLearn = now + this.learnEveryMs;
      const p = this.params.filter(x => x.name !== 'Device On')[this.learnIndex++ % (this.params.length - 4)];
      const v = this.value(p, now);
      out.push(encodeOsc('/pf/selected/param', [p.key, p.track, p.device, p.name, v, p.min, p.max, display(p, v)]));
    }
    // Late deliveries (jitter) arrive at their own time.
    const due = this.queue.filter(q => q.at <= now);
    this.queue = this.queue.filter(q => q.at > now);
    return [...out, ...due.map(q => q.packet)];
  }

  /** Answer a command from Playfield, as the script does. */
  handle(packet, now) {
    const out = [];
    for (const m of decodeOsc(packet)) {
      const a = m.args;
      const ack = (ok, detail = '') => out.push(encodeOsc('/pf/ack', [m.address, { i: ok ? 1 : 0 }, detail]));
      switch (m.address) {
        case '/pf/ping': out.push(this.hello()); break;
        case '/pf/catalog/request': out.push(...this.catalog(now)); ack(true); break;
        case '/pf/watch': {
          const next = new Set(a.filter(x => typeof x === 'string'));
          for (const k of next) if (!this.watched.has(k)) { const p = this.params.find(x => x.key === k); if (p) out.push(this.paramMessage(p, now)); }
          this.watched = next;
          ack(true, `${next.size}`);
          break;
        }
        case '/pf/fire/clip': {
          const ti = typeof a[0] === 'number' ? a[0] : this.set.tracks.findIndex(t => t.name === a[0]);
          const t = this.set.tracks[ti];
          const slot = !t ? -1 : typeof a[1] === 'number' ? a[1] : t.clips.indexOf(String(a[1]));
          if (!t || slot < 0 || !t.clips[slot]) { ack(false, 'No such clip'); break; }
          out.push(encodeOsc('/pf/clip', [{ i: ti }, t.name, { i: slot }, 'triggered', t.clips[slot], { i: t.colour }]));
          ack(true);
          break;
        }
        case '/pf/fire/scene': {
          const si = typeof a[0] === 'number' ? a[0] : this.set.scenes.findIndex(s => s.name === a[0]);
          const s = this.set.scenes[si];
          if (!s) { ack(false, 'No such scene'); break; }
          out.push(encodeOsc('/pf/scene', [{ i: si }, s.name, { i: s.colour }]));
          ack(true);
          break;
        }
        case '/pf/scene/next': case '/pf/stop/all': case '/pf/tap': ack(true); break;
        default: ack(false, 'ignored');
      }
      this.sent.push(m);
    }
    return out;
  }
}

// ── CLI ──────────────────────────────────────────────────────────────────────
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const argv = process.argv.slice(2);
  const opt = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : fallback; };
  const verbose = argv.includes('--verbose');
  const toPort = opt('to', 11101), inPort = opt('port', 11100);
  const live = new FakeLive({ tempo: opt('tempo', 120), jitterMs: opt('jitter', 0), loss: opt('loss', 0), learnEveryMs: opt('learn-every', 0) * 1000 });
  const sock = dgram.createSocket('udp4');
  const t0 = Date.now();
  const now = () => Date.now() - t0;
  const send = packets => { for (const p of packets) sock.send(p, toPort, '127.0.0.1'); };
  sock.on('message', packet => {
    if (verbose) for (const m of decodeOsc(packet)) console.log(`[fake-live] ← ${m.address} ${JSON.stringify(m.args)}`);
    send(live.handle(packet, now()));
  });
  sock.on('error', e => { console.error(`[fake-live] ${e.message}`); process.exit(1); });
  sock.bind(inPort, '127.0.0.1', () => {
    console.log(`Fake Live (${live.tempo} BPM, “${live.set.name}”): sending to udp://127.0.0.1:${toPort}, commands on ${inPort}. Ctrl+C to stop.`);
    send(live.catalog(0));
    setInterval(() => send(live.tick(now())), 10);
  });
}
