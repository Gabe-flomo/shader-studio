/**
 * liveClient.ts — Ableton Live through the Live connector (docs/live-connector-plan.md).
 *
 * The connector is a Remote Script inside Live that speaks OSC over UDP on 127.0.0.1. The
 * desktop app listens for it natively (src-tauri `live_start`, `live-packet` events) and sends
 * commands back (`live_send`). A browser tab can't open UDP sockets, so it goes through the
 * bridge started with `npm run osc-bridge -- --live` (WebSocket on LIVE_BRIDGE_WS_PORT, which
 * also forwards our commands to the script).
 *
 * This keeps the connection (only while something wants it), the set's picture (LiveState:
 * catalogue, values, transport), the parameters to stream (`watch`), and a listener list for
 * Learn, clip and scene triggers. When the script appears (or the set changes) it asks for the
 * catalogue and re-sends the watch list; nothing to reconnect, since UDP has no connection.
 */
import { decodeOsc, encodeOsc } from './osc/decode.js';
import { commandMessage, LiveState, LIVE_BRIDGE_WS_PORT, type LiveCommand, type LiveEvent, type LiveMessage } from './live/liveProtocol';

export type LiveStatus = 'off' | 'waiting' | 'connected' | 'lost' | 'error';
export type LiveMode = 'native' | 'bridge';

const isTauri = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
const LATENCY_KEY = 'shader-studio:live:latencyMs';

class LiveClient {
  state = new LiveState();
  private readonly nativeMode = isTauri();
  private status: LiveStatus = 'off';
  private error = '';
  private reasons = new Set<string>();
  private listeners = new Set<(e: LiveEvent) => void>();
  private changeListeners = new Set<() => void>();
  private version = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private unlistenNative: (() => void) | null = null;
  private ws: WebSocket | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private watched: string[] = [];
  private watchTimer: ReturnType<typeof setTimeout> | null = null;
  private latencyMs: number = (() => {
    try { const v = Number(localStorage.getItem(LATENCY_KEY)); return Number.isFinite(v) ? Math.max(-200, Math.min(500, v)) : 0; } catch { return 0; }
  })();
  /** Test hook: where commands go instead of the network. */
  sendHook: ((address: string, args: unknown[]) => void) | null = null;
  now: () => number = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  getMode(): LiveMode { return this.nativeMode ? 'native' : 'bridge'; }
  getStatus(): LiveStatus { return this.status; }
  getError(): string { return this.error; }
  /** Bumps on every change the UI shows (status, catalogue, selected device): for useSyncExternalStore. */
  getVersion(): number { return this.version; }
  isConnected(): boolean { return this.status === 'connected'; }

  /** The user's audio output delay (ms): the followed beat runs this much later so flashes land on the heard kick. */
  getLatency(): number { return this.latencyMs; }
  setLatency(ms: number): void {
    this.latencyMs = Math.max(-200, Math.min(500, Math.round(ms) || 0));
    try { localStorage.setItem(LATENCY_KEY, String(this.latencyMs)); } catch { /* preference only */ }
    this.changed();
  }

  /** Song position in beats now, with the latency offset (0 before Live's transport is heard). */
  beats(now = this.now()): number { return this.state.follower.beatsAt(now - this.latencyMs); }
  barPhase(now = this.now()): number { return this.state.follower.barPhase(now - this.latencyMs); }
  /** Is Live's transport known (connected and heard)? Follow Live falls back to Playfield's own clock otherwise. */
  hasTransport(): boolean { return this.status === 'connected' && this.state.follower.ready(); }

  /** Listen while any reason wants it (`'record'`: the setup uses Live; `'ui'`: a picker or guide is open). */
  want(reason: string, on: boolean): void {
    const before = this.reasons.size > 0;
    if (on) this.reasons.add(reason); else this.reasons.delete(reason);
    const after = this.reasons.size > 0;
    if (after && !before) this.open();
    else if (!after && before) this.close();
  }

  onEvent(cb: (e: LiveEvent) => void): () => void {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }

  onChange(cb: () => void): () => void {
    this.changeListeners.add(cb);
    return () => { this.changeListeners.delete(cb); };
  }

  /** The parameters to stream besides the Playfield rack and the selected device (sent once things settle). */
  watch(keys: readonly string[]): void {
    const next = [...new Set(keys)].sort();
    if (next.join('\n') === this.watched.join('\n')) return;
    this.watched = next;
    if (this.watchTimer) clearTimeout(this.watchTimer);
    this.watchTimer = setTimeout(() => { this.watchTimer = null; this.send({ cmd: 'watch', keys: this.watched }); }, 50);
  }

  /** Playfield → Live (Do actions). Quietly nothing when not connected. */
  send(c: LiveCommand): void {
    const m = commandMessage(c);
    if (this.sendHook) { this.sendHook(m.address, m.args); return; }
    if (this.nativeMode) {
      if (!this.unlistenNative) return;
      const packet = encodeOsc(m.address, m.args);
      void import('@tauri-apps/api/core').then(({ invoke }) => invoke('live_send', { packet: [...packet] })).catch(() => { /* not running */ });
      return;
    }
    const ws = this.ws;
    if (ws && ws.readyState === 1) {
      // The bridge encodes it ({ i } stays an int; a plain number goes as a float).
      try { ws.send(JSON.stringify({ a: m.address, v: m.args })); } catch { /* closing */ }
    }
  }

  /** Feed a decoded message (from the listener, the bridge, or tests). */
  inject(m: LiveMessage, now = this.now()): void {
    const e = this.state.apply(m, now);
    if (!e) return;
    if (e.type === 'hello') {
      if (this.status !== 'connected') this.setStatus('connected');
      if (e.fresh || e.hello.gen !== this.state.catalogGen) {
        // A new script or set (or a changed one): its catalogue, and what we stream.
        if (e.fresh || !this.catalogAsked || now - this.catalogAsked > 2000) { this.catalogAsked = now; this.send({ cmd: 'catalog' }); }
        if (e.fresh) this.send({ cmd: 'watch', keys: this.watched });
      }
      if (e.fresh) this.changed();
    } else if (e.type === 'bye') {
      this.setStatus('lost');
    } else if (e.type === 'catalog' || e.type === 'selectedDevice' || e.type === 'track' || e.type === 'sends') {
      this.changed();
    }
    for (const l of this.listeners) l(e);
  }
  private catalogAsked = 0;

  private changed(): void {
    this.version++;
    for (const l of this.changeListeners) l();
  }

  private setStatus(s: LiveStatus): void {
    if (s === this.status) return;
    this.status = s;
    this.changed();
  }

  private open(): void {
    this.setStatus('waiting');
    // Tests: no network, no timers (messages come through inject, commands go to the hook).
    if (this.sendHook) return;
    // Heartbeat: "not heard from" after a few seconds of silence; a ping now and then so the script answers at once.
    if (!this.timer) {
      this.timer = setInterval(() => {
        const now = this.now();
        if (this.status === 'connected' && !this.state.connected(now)) this.setStatus('lost');
        if (this.status !== 'connected') this.send({ cmd: 'ping' });
      }, 1000);
    }
    if (this.nativeMode) void this.openNative(); else this.openBridge();
  }

  private async openNative(): Promise<void> {
    if (this.unlistenNative) return;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const { listen } = await import('@tauri-apps/api/event');
      const unlisten = await listen<number[]>('live-packet', e => {
        const now = this.now();
        for (const m of decodeOsc(new Uint8Array(e.payload))) {
          this.inject({ address: m.address, args: m.args.filter((x): x is number | string | boolean => x !== null) }, now);
        }
      });
      await invoke('live_start');
      if (!this.reasons.size) { unlisten(); void invoke('live_stop'); return; }
      this.unlistenNative = unlisten;
      this.error = '';
      this.send({ cmd: 'ping' });
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
      this.setStatus('error');
    }
  }

  private openBridge(): void {
    if (this.ws || typeof WebSocket === 'undefined') return;
    let ws: WebSocket;
    try { ws = new WebSocket(`ws://127.0.0.1:${LIVE_BRIDGE_WS_PORT}`); } catch { this.bridgeDown(); return; }
    this.ws = ws;
    ws.onopen = () => { this.error = ''; this.send({ cmd: 'ping' }); };
    ws.onmessage = e => {
      try {
        const d = JSON.parse(String(e.data)) as { a?: unknown; v?: unknown };
        if (typeof d.a !== 'string') return;
        const args = Array.isArray(d.v) ? d.v.filter(x => typeof x === 'number' || typeof x === 'string' || typeof x === 'boolean') : [];
        this.inject({ address: d.a, args });
      } catch { /* not ours */ }
    };
    ws.onclose = () => { this.ws = null; if (this.reasons.size) this.bridgeDown(); };
    ws.onerror = () => { /* onclose follows */ };
  }

  private bridgeDown(): void {
    this.error = 'No bridge running: start it with npm run osc-bridge -- --live';
    if (this.status === 'connected') this.setStatus('lost');
    else this.setStatus('error');
    if (this.retry) clearTimeout(this.retry);
    this.retry = setTimeout(() => { this.retry = null; if (this.reasons.size) this.openBridge(); }, 3000);
  }

  private close(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (this.retry) { clearTimeout(this.retry); this.retry = null; }
    if (this.unlistenNative) {
      this.unlistenNative();
      this.unlistenNative = null;
      void import('@tauri-apps/api/core').then(({ invoke }) => invoke('live_stop')).catch(() => { /* app closing */ });
    }
    const ws = this.ws;
    this.ws = null;
    if (ws) { ws.onclose = null; try { ws.close(); } catch { /* already closed */ } }
    this.setStatus('off');
  }

  /** Tests: forget everything. */
  resetForTests(): void {
    this.close();
    this.reasons.clear();
    this.watched = [];
    this.catalogAsked = 0;
    this.state = new LiveState();
  }
}

export const liveClient = new LiveClient();
