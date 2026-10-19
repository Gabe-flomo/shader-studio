/**
 * liveSend.ts — Ableton Live tracks as sound sources, through the Playfield Send plug-in
 * (docs/playfield-send-plan.md). Desktop app only (and Pro: `audio.liveSend`).
 *
 *   plug-in in Live ─shm ring→ src-tauri live_send.rs ─one binary Channel message / 10 ms→ here
 *     ─postMessage (transferred)→ AudioWorkletNode "playfield-receive" (one per used ID; a ~30 ms
 *     cushion absorbs the two clocks' drift) ─→ an Audio Source's probe / effects, Play's readers
 *
 * The worklet's output is never heard: it is kept running through a silent gain to the destination.
 *
 * - **The list**: every instance the app hears from (`live-send-list` events), with status, level
 *   and dropouts.
 * - **Names**: the Live connector reports which track each Pairing ID sits on (`/pf/sends`); without
 *   it, a name set here (kept per ID in this browser); else the plug-in's own name; else "Send 4821".
 *   The names go back to the app, which writes them into each plug-in's window.
 * - **Using one**: `tap(id)` returns the ID's node (made on first use) and marks it in use. IDs not
 *   tapped for two seconds are unsubscribed, so the app stops sending what nobody reads.
 * - **The fake** (`startFakeLiveSends`): the same path fed from a tone generator in the page, for
 *   tests, development in a browser and screenshots.
 */
import { audioEngine } from './audioEngine';
import { liveClient } from './liveClient';
import type { LiveSendPair } from './live/liveProtocol';
import { decodeLiveSendChunk, encodeLiveSendChunk, RECEIVE_SOURCE } from './liveSendChunk';
import { setSendLabeller } from './liveSendNames';

export { sendReaderInput, sendIdOfInput } from './liveSendNames';

export type LiveSendStatus = 'streaming' | 'paused' | 'offline' | 'unreadable';

/** One plug-in instance, as the app lists it (src-tauri InstanceInfo). */
export interface LiveSendInstance {
  key: string;
  id: number;
  /** The plug-in's own name ("" unless set in the plug-in). */
  name: string;
  sampleRate: number;
  status: LiveSendStatus;
  level: number;
  dropouts: number;
  version: string;
  pid: number;
  subscribed: boolean;
}

/** The worklet's buffer, reported twice a second. */
export interface LiveSendBufferStats { fill: number; target: number; drops: number; pads: number; underruns: number }

/** The plug-in version this app ships (crates/pfsend-protocol PLUGIN_VERSION). */
export const PLAYFIELD_SEND_VERSION = '1.0.0';
/** The cushion (ms): the worklet's target buffer. */
export const DEFAULT_CUSHION_MS = 30;
const NAMES_KEY = 'shader-studio:liveSend:names';
const CUSHION_KEY = 'shader-studio:liveSend:cushionMs';
const IDLE_MS = 2000;

const isTauri = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** "1.0.0" < "1.1.0". */
export function olderVersion(a: string, b: string): boolean {
  const pa = a.split('.').map(n => parseInt(n, 10) || 0), pb = b.split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) < (pb[i] ?? 0);
  return false;
}

interface Receiver { node: AudioWorkletNode; analyser: AnalyserNode; sink: GainNode; lastTap: number; stats: LiveSendBufferStats | null }

/** What a fake instance plays. */
export interface FakeSend { id: number; name?: string; track?: string; colour?: number; hz?: number; status?: LiveSendStatus; sampleRate?: number }

class LiveSendClient {
  private instances: LiveSendInstance[] = [];
  private pairs = new Map<number, LiveSendPair>();
  private userNames = new Map<number, string>(this.loadNames());
  private reasons = new Set<string>();
  private listeners = new Set<() => void>();
  private ver = 0;
  private running = false;
  private unlisten: (() => void) | null = null;
  private offLive: (() => void) | null = null;
  private receivers = new Map<number, Receiver>();
  private pending = new Map<number, Promise<void>>();
  private loaded = new WeakMap<BaseAudioContext, Promise<boolean>>();
  private subscribed = '';
  private sweep: ReturnType<typeof setInterval> | null = null;
  private error = '';
  private chunks = 0;
  private fake: { timer: ReturnType<typeof setInterval>; sends: FakeSend[]; phase: Map<number, number>; seq: number; t: number; start: number } | null = null;
  /** Tests: the context to build in (instead of the audio engine's). */
  contextHook: (() => BaseAudioContext) | null = null;
  /** Tests: where subscribe/name calls go instead of the app. */
  invokeHook: ((cmd: string, args: Record<string, unknown>) => void) | null = null;
  now: () => number = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  /** Can this build use it at all? The desktop app (or the fake). */
  available(): boolean { return isTauri() || !!this.fake; }
  isFake(): boolean { return !!this.fake; }
  getError(): string { return this.error; }
  version(): number { return this.ver; }
  list(): readonly LiveSendInstance[] { return this.instances; }
  instance(id: number): LiveSendInstance | undefined { return this.instances.find(i => i.id === id); }
  /** Chunks received so far (tests and the Open ↗ window). */
  chunkCount(): number { return this.chunks; }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }

  private changed(): void {
    this.ver++;
    for (const l of this.listeners) l();
  }

  // ── Names ──────────────────────────────────────────────────────────────────

  /** The Live connector's track for an ID, if it reported one. */
  pair(id: number): LiveSendPair | undefined { return this.pairs.get(id); }

  /** "Drums": the Live track (connector), else the name set here, else the plug-in's, else "Send 4821". */
  label(id: number, fallback = ''): string {
    return this.pairs.get(id)?.track || this.userNames.get(id) || this.instance(id)?.name || fallback || `Send ${id}`;
  }

  /** "Live · Drums". */
  sourceName(id: number, fallback = ''): string { return `Live · ${this.label(id, fallback)}`; }

  /** The track's colour as #rrggbb, when the connector gave one. */
  colour(id: number): string | null {
    const p = this.pairs.get(id);
    return p ? `#${(Math.max(0, Math.round(p.colour)) & 0xffffff).toString(16).padStart(6, '0')}` : null;
  }

  /** Is this ID named by the connector (so the name can't be edited here)? */
  pairedByLive(id: number): boolean { return this.pairs.has(id); }
  userName(id: number): string { return this.userNames.get(id) ?? ''; }

  setUserName(id: number, name: string): void {
    const v = name.trim().slice(0, 60);
    if (v) this.userNames.set(id, v); else this.userNames.delete(id);
    try { localStorage.setItem(NAMES_KEY, JSON.stringify([...this.userNames])); } catch { /* preference only */ }
    this.pushNames();
    this.changed();
  }

  private loadNames(): Array<[number, string]> {
    try {
      const v = JSON.parse(localStorage.getItem(NAMES_KEY) ?? '[]') as unknown;
      return Array.isArray(v) ? v.filter((x): x is [number, string] => Array.isArray(x) && typeof x[0] === 'number' && typeof x[1] === 'string') : [];
    } catch { return []; }
  }

  /** The connector's report (tests call this directly). */
  setPairs(sends: readonly LiveSendPair[]): void {
    this.pairs = new Map(sends.map(s => [s.id, s]));
    this.pushNames();
    this.changed();
  }

  private pushNames(): void {
    const ids = new Set<number>([...this.instances.map(i => i.id), ...this.pairs.keys(), ...this.userNames.keys()]);
    const names = [...ids].map(id => ({ id, label: this.label(id, ''), colour: this.pairs.get(id)?.colour ?? null }))
      .filter(n => n.label && !n.label.startsWith('Send '));
    this.call('live_send_names', { names });
  }

  // ── The buffer setting ─────────────────────────────────────────────────────

  cushionMs(): number {
    try { const v = Number(localStorage.getItem(CUSHION_KEY)); return v >= 10 && v <= 100 ? v : DEFAULT_CUSHION_MS; } catch { return DEFAULT_CUSHION_MS; }
  }

  setCushionMs(ms: number): void {
    const v = Math.max(10, Math.min(100, Math.round(ms) || DEFAULT_CUSHION_MS));
    try { localStorage.setItem(CUSHION_KEY, String(v)); } catch { /* preference only */ }
    for (const r of this.receivers.values()) r.node.port.postMessage({ cushionMs: v });
    this.changed();
  }

  /** The worklet's buffer for an ID (the Open ↗ window's counters). */
  bufferStats(id: number): LiveSendBufferStats | null { return this.receivers.get(id)?.stats ?? null; }

  // ── Connection ─────────────────────────────────────────────────────────────

  /** Listen while any reason wants it (an Audio Source on Live, a reader on a send, a picker open). */
  want(reason: string, on: boolean): void {
    const before = this.reasons.size > 0;
    if (on) this.reasons.add(reason); else this.reasons.delete(reason);
    const after = this.reasons.size > 0;
    if (after && !before) void this.open();
    else if (!after && before) this.close();
  }

  private call(cmd: string, args: Record<string, unknown>): void {
    if (this.invokeHook) { this.invokeHook(cmd, args); return; }
    if (!isTauri() || this.fake) return;
    void import('@tauri-apps/api/core').then(({ invoke }) => invoke(cmd, args)).catch(() => { /* older app */ });
  }

  private async open(): Promise<void> {
    if (this.running) return;
    this.running = true;
    if (!this.sweep) this.sweep = setInterval(() => this.sweepIdle(), 500);
    // The Live connector names the sends (when it's installed and on).
    this.offLive = liveClient.onEvent(e => { if (e.type === 'sends') this.setPairs(e.sends); else if (e.type === 'hello' && e.fresh) liveClient.send({ cmd: 'sends' }); });
    if (liveClient.state.sends.length) this.setPairs(liveClient.state.sends);
    if (this.fake || this.invokeHook || !isTauri()) return;
    liveClient.want('liveSend', true);
    try {
      const { invoke, Channel } = await import('@tauri-apps/api/core');
      const { listen } = await import('@tauri-apps/api/event');
      const channel = new Channel<ArrayBuffer>();
      channel.onmessage = buf => this.onChunk(buf);
      const unlisten = await listen<LiveSendInstance[]>('live-send-list', e => this.setList(e.payload));
      await invoke('live_send_start', { onAudio: channel });
      if (!this.running) { unlisten(); return; }
      this.unlisten = unlisten;
      this.error = '';
      this.setList(await invoke<LiveSendInstance[]>('live_send_list'));
      this.subscribed = '';
      this.resubscribe();
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
      this.changed();
    }
  }

  private close(): void {
    this.running = false;
    if (this.sweep) { clearInterval(this.sweep); this.sweep = null; }
    this.offLive?.(); this.offLive = null;
    if (this.unlisten) {
      this.unlisten(); this.unlisten = null;
      liveClient.want('liveSend', false);
      this.call('live_send_stop', {});
    }
    for (const id of [...this.receivers.keys()]) this.dropReceiver(id);
    this.subscribed = '';
  }

  /** The app's list (tests call it directly). */
  setList(list: readonly LiveSendInstance[]): void {
    const before = this.instances.map(i => `${i.key}:${i.id}:${i.status}:${i.name}`).join('|');
    this.instances = [...list];
    const after = this.instances.map(i => `${i.key}:${i.id}:${i.status}:${i.name}`).join('|');
    if (before !== after) this.pushNames();
    this.changed();
  }

  // ── Audio ──────────────────────────────────────────────────────────────────

  private ctx(): BaseAudioContext { return this.contextHook ? this.contextHook() : audioEngine.context(); }

  private loadWorklet(ctx: BaseAudioContext): Promise<boolean> {
    let p = this.loaded.get(ctx);
    if (!p) {
      p = (async () => {
        try {
          if (!ctx.audioWorklet || typeof Blob === 'undefined' || !URL.createObjectURL) return false;
          const url = URL.createObjectURL(new Blob([RECEIVE_SOURCE], { type: 'application/javascript' }));
          try { await ctx.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
          return true;
        } catch { return false; }
      })();
      this.loaded.set(ctx, p);
    }
    return p;
  }

  /**
   * The node an ID's sound comes out of (stereo), or null while it is being made. Call it every
   * frame while in use: IDs not tapped for two seconds are let go.
   */
  tap(id: number): AudioWorkletNode | null {
    const r = this.receivers.get(id);
    if (r) { r.lastTap = this.now(); return r.node; }
    if (!this.pending.has(id)) this.pending.set(id, this.makeReceiver(id).finally(() => this.pending.delete(id)));
    return null;
  }

  /** An analyser on an ID's sound (Play's readers), or null while it is being made. */
  analyser(id: number): AnalyserNode | null {
    return this.tap(id) ? this.receivers.get(id)!.analyser : null;
  }

  private async makeReceiver(id: number): Promise<void> {
    let ctx: BaseAudioContext;
    try { ctx = this.ctx(); } catch { return; }
    if (!(await this.loadWorklet(ctx))) { this.error = 'This build can’t receive audio (no AudioWorklet).'; this.changed(); return; }
    if (this.receivers.has(id)) return;
    let node: AudioWorkletNode;
    try {
      node = new AudioWorkletNode(ctx, 'playfield-receive', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2], processorOptions: { cushionMs: this.cushionMs() } });
    } catch (e) { this.error = e instanceof Error ? e.message : String(e); this.changed(); return; }
    // Never heard: a silent gain keeps the worklet pulled (WebKit only runs nodes that reach the destination).
    const sink = ctx.createGain();
    sink.gain.value = 0;
    node.connect(sink).connect(ctx.destination);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.6;
    node.connect(analyser);
    const r: Receiver = { node, analyser, sink, lastTap: this.now(), stats: null };
    node.port.onmessage = e => { if (e.data && typeof e.data.fill === 'number') r.stats = e.data as LiveSendBufferStats; };
    this.receivers.set(id, r);
    if ('state' in ctx && (ctx as AudioContext).state === 'suspended') void (ctx as AudioContext).resume?.();
    this.resubscribe();
    this.changed();
  }

  private dropReceiver(id: number): void {
    const r = this.receivers.get(id);
    if (!r) return;
    this.receivers.delete(id);
    try { r.node.port.postMessage('stop'); } catch { /* gone */ }
    for (const n of [r.node, r.sink, r.analyser]) { try { n.disconnect(); } catch { /* gone */ } }
  }

  private sweepIdle(): void {
    const now = this.now();
    let gone = false;
    for (const [id, r] of this.receivers) if (now - r.lastTap > IDLE_MS) { this.dropReceiver(id); gone = true; }
    if (gone) { this.resubscribe(); this.changed(); }
  }

  /** The IDs in use, at the context's rate, to the app (only when they changed). */
  private resubscribe(): void {
    const ids = [...this.receivers.keys()].sort((a, b) => a - b);
    let rate = 48000;
    try { rate = this.ctx().sampleRate; } catch { /* no context yet */ }
    const key = `${ids.join(',')}@${rate}`;
    if (key === this.subscribed) return;
    this.subscribed = key;
    this.call('live_send_subscribe', { ids, rate });
  }

  /** A chunk from the app (or the fake): each part to its ID's worklet, transferred. */
  onChunk(buf: ArrayBuffer): void {
    const c = decodeLiveSendChunk(buf);
    if (!c) return;
    this.chunks++;
    c.header.s.forEach((p, i) => {
      const r = this.receivers.get(p.id);
      const pcm = c.pcm[i];
      if (r && pcm.length) r.node.port.postMessage(pcm, [pcm.buffer]);
    });
  }

  // ── The fake ───────────────────────────────────────────────────────────────

  /**
   * Pretend Playfield Send instances are running (development in a browser, tests, screenshots):
   * the list, the Live connector's names for those with a `track`, and a tone with a beat-shaped
   * swell per instance, encoded and decoded exactly as the app's chunks are. Returns the way to stop.
   */
  startFakeLiveSends(sends: FakeSend[]): () => void {
    this.stopFake();
    const phase = new Map<number, number>();
    const fake = { sends, phase, seq: 0, t: 0, start: this.now(), timer: setInterval(() => this.fakeTick(), 10) };
    this.fake = fake;
    this.setList(sends.map((s, i) => ({
      key: `/pfsend.${4000 + i}.0`, id: s.id, name: s.name ?? '', sampleRate: s.sampleRate ?? 48000, status: s.status ?? 'streaming',
      level: 0.3, dropouts: 0, version: PLAYFIELD_SEND_VERSION, pid: 4000 + i, subscribed: false,
    })));
    const paired = sends.filter(s => s.track);
    this.setPairs(paired.map((s, i) => ({ id: s.id, track: s.track!, colour: s.colour ?? 0xff8a3d, trackIndex: i, kind: 'track' as const })));
    return () => this.stopFake();
  }

  stopFake(): void {
    if (!this.fake) return;
    clearInterval(this.fake.timer);
    this.fake = null;
    this.setList([]);
    this.setPairs([]);
  }

  private fakeTick(): void {
    const f = this.fake;
    if (!f) return;
    let rate = 48000;
    try { rate = this.ctx().sampleRate; } catch { /* none yet */ }
    // Frames due by the wall clock (timers run late), like Live's real-time stream; at most 100 ms at once.
    const n = Math.min(Math.round(rate / 10), Math.round(((this.now() - f.start) / 1000) * rate - f.t * rate));
    if (n <= 0) return;
    const parts: Array<{ id: number; n: number; drop: number }> = [];
    const pcm: Float32Array[] = [];
    for (const s of f.sends) {
      const inst = this.instance(s.id);
      if (s.status && s.status !== 'streaming') continue;
      if (inst) inst.subscribed = this.receivers.has(s.id);
      if (!this.receivers.has(s.id)) continue;
      const hz = s.hz ?? 110;
      let ph = f.phase.get(s.id) ?? 0;
      const out = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) {
        const t = f.t + i / rate;
        const swell = Math.exp(-((t % 0.5) * 8));
        const v = Math.sin(ph) * (0.12 + 0.4 * swell);
        out[i * 2] = v; out[i * 2 + 1] = v * 0.9;
        ph = (ph + (2 * Math.PI * hz) / rate) % (2 * Math.PI);
      }
      f.phase.set(s.id, ph);
      parts.push({ id: s.id, n, drop: 0 });
      pcm.push(out);
    }
    f.t += n / rate;
    // Meters move in the list as the app's do.
    for (const i of this.instances) if (i.status === 'streaming') i.level = 0.12 + 0.3 * Math.exp(-((f.t % 0.5) * 8));
    if (f.seq % 25 === 0) this.changed();
    f.seq++;
    if (parts.length) this.onChunk(encodeLiveSendChunk({ seq: f.seq, rate, s: parts }, pcm));
  }

  /** Tests: forget everything. */
  resetForTests(): void {
    this.stopFake();
    this.close();
    this.reasons.clear();
    this.instances = [];
    this.pairs.clear();
    this.userNames.clear();
    this.chunks = 0;
    this.error = '';
  }
}

export const liveSend = new LiveSendClient();
setSendLabeller(id => liveSend.label(id));

// Development in a browser: `__pfsendFake([{ id: 4821, track: 'Drums' }])` in the console shows the Live tab working.
if (typeof window !== 'undefined' && import.meta.env?.DEV) {
  (window as unknown as { __pfsendFake?: (s?: FakeSend[]) => () => void }).__pfsendFake = (s?: FakeSend[]) =>
    liveSend.startFakeLiveSends(s ?? [{ id: 4821, track: 'Drums', colour: 0xff5a36, hz: 70 }, { id: 1207, track: 'Bass', colour: 0x3d8bff, hz: 55 }, { id: 3310, name: 'Vox bus', hz: 330 }]);
}
