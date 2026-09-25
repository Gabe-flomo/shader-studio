/**
 * oscClient.ts — OSC in the browser, through the bridge (tools/osc-bridge.mjs).
 *
 * Browsers can't open UDP sockets, so a tiny local bridge receives OSC
 * (Ableton's Connection Kit "OSC Send", TouchOSC, Max, TouchDesigner…) and
 * forwards each message as JSON `{ a: address, v: [args] }` over a WebSocket
 * on 127.0.0.1. This module keeps that connection, the latest value per
 * address, and a listener list for Learn and triggers.
 *
 * Only connects while something wants it (`setWanted`), and retries every
 * few seconds while wanted, so a bridge started later is picked up.
 */

export type OscStatus = 'off' | 'connecting' | 'connected' | 'error';
export interface OscMessage { address: string; args: Array<number | string | boolean> }
export type OscListener = (m: OscMessage) => void;

const PORT_KEY = 'shader-studio:osc:port';
export const OSC_DEFAULT_WS_PORT = 9001;
export const OSC_DEFAULT_UDP_PORT = 9000;

class OscClient {
  private ws: WebSocket | null = null;
  private status: OscStatus = 'off';
  private wanted = false;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<OscListener>();
  private statusListeners = new Set<(s: OscStatus) => void>();
  private latest = new Map<string, Array<number | string | boolean>>();
  private port: number = (() => {
    try { const v = parseInt(localStorage.getItem(PORT_KEY) ?? '', 10); return Number.isFinite(v) && v > 0 ? v : OSC_DEFAULT_WS_PORT; } catch { return OSC_DEFAULT_WS_PORT; }
  })();

  getStatus(): OscStatus { return this.status; }
  getPort(): number { return this.port; }

  setPort(port: number): void {
    if (!Number.isFinite(port) || port <= 0 || port === this.port) return;
    this.port = port;
    try { localStorage.setItem(PORT_KEY, String(port)); } catch { /* preference only */ }
    if (this.wanted) { this.close(); this.open(); }
  }

  /** Connect while true; disconnect when nothing needs OSC any more. */
  setWanted(on: boolean): void {
    if (on === this.wanted) return;
    this.wanted = on;
    if (on) this.open(); else this.close();
  }

  onStatus(cb: (s: OscStatus) => void): () => void {
    this.statusListeners.add(cb);
    return () => { this.statusListeners.delete(cb); };
  }

  subscribe(cb: OscListener): () => void {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }

  /** The last args an address carried, or undefined if it has never arrived. */
  value(address: string): Array<number | string | boolean> | undefined {
    return this.latest.get(address);
  }

  /** Every address seen so far (for suggestions in the mappings drawer). */
  addresses(): string[] {
    return [...this.latest.keys()].sort();
  }

  /** Feed a message as if it came from the bridge (tests, and a future Tauri UDP listener). */
  inject(m: OscMessage): void {
    this.latest.set(m.address, m.args);
    for (const l of this.listeners) l(m);
  }

  private setStatus(s: OscStatus): void {
    if (s === this.status) return;
    this.status = s;
    for (const l of this.statusListeners) l(s);
  }

  private open(): void {
    if (this.ws || typeof WebSocket === 'undefined') return;
    this.setStatus('connecting');
    let ws: WebSocket;
    try { ws = new WebSocket(`ws://127.0.0.1:${this.port}`); } catch { this.setStatus('error'); this.scheduleRetry(); return; }
    this.ws = ws;
    ws.onopen = () => this.setStatus('connected');
    ws.onmessage = e => {
      try {
        const d = JSON.parse(String(e.data)) as { a?: unknown; v?: unknown };
        if (typeof d.a !== 'string') return;
        const args = Array.isArray(d.v) ? d.v.filter(x => typeof x === 'number' || typeof x === 'string' || typeof x === 'boolean') : [];
        this.inject({ address: d.a, args });
      } catch { /* not ours */ }
    };
    ws.onclose = () => {
      this.ws = null;
      if (!this.wanted) { this.setStatus('off'); return; }
      this.setStatus('error');
      this.scheduleRetry();
    };
    ws.onerror = () => { /* onclose follows */ };
  }

  private scheduleRetry(): void {
    if (this.retry) clearTimeout(this.retry);
    this.retry = setTimeout(() => { this.retry = null; if (this.wanted) this.open(); }, 3000);
  }

  private close(): void {
    if (this.retry) { clearTimeout(this.retry); this.retry = null; }
    const ws = this.ws;
    this.ws = null;
    if (ws) { ws.onclose = null; try { ws.close(); } catch { /* already closed */ } }
    this.setStatus('off');
  }
}

export const oscClient = new OscClient();

/** First numeric argument (booleans as 0/1), or null. */
export function oscNumber(args: Array<number | string | boolean> | undefined, index = 0): number | null {
  if (!args) return null;
  const v = args[index];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return null;
}
