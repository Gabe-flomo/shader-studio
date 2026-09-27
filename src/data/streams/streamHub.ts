/**
 * Live datasets (docs/data-layer-plan.md, milestone 8): one connection per
 * stream dataset, its rolling window of rows, and what readers see.
 *
 * Transports: Poll a URL every N seconds, a WebSocket, Server-Sent Events,
 * OSC (through the desktop app's listener or the browser bridge, the same
 * client Play's OSC mappings use), and a Demo feed made up in the app.
 *
 * Each message becomes rows (messages.ts), added into the window or
 * replacing it (window.ts). The window then goes through the dataset's
 * notebook (skipped when the notebook only shows the data; otherwise run in
 * the worker, at most a few times a second, newest window wins) and into
 * `datasetStore.replaceResult`, so the Data node's textures (and anything
 * else subscribed) update with no shader rebuild.
 *
 * A dropped connection retries with backoff. While a take plays back or
 * renders, the hub is muted: connections keep their windows, but readers get
 * the take's recorded rows instead (takeData.ts); unmuting shows the live
 * window again.
 */
import { datasetStore } from '../datasetStore';
import { runDataset } from '../datasetRun';
import { runNotebook } from '../notebook';
import { oscClient } from '../../lib/oscClient';
import { fetchBytes, CorsError } from '../urlFetch';
import { decodeFetched } from '../urlSource';
import type { DatasetResult, DatasetSource, DatasetsRecord, TableResult } from '../types';
import { backoffDelay, demoRow, RateMeter } from './backoff';
import { flatRows, isPassThrough, messageToRows, newLineState, oscMatches, oscToRow, type LineState, type Row } from './messages';
import { applyRows, csvToTable, tableToCsv, trimTable } from './window';

export type StreamSource = Extract<DatasetSource, { kind: 'stream' }>;
export type StreamState = 'off' | 'connecting' | 'live' | 'paused' | 'retrying' | 'error';

export interface StreamStatus {
  state: StreamState;
  rowsPerSecond: number;
  /** The newest row, and when it came (ms). */
  lastRow: Row | null;
  lastAt: number | null;
  /** Rows in the window now. */
  rows: number;
  error: string | null;
  /** Retrying: when the next attempt is (ms). */
  retryAt: number | null;
}

const OFF: StreamStatus = { state: 'off', rowsPerSecond: 0, lastRow: null, lastAt: null, rows: 0, error: null, retryAt: null };

export { isPassThrough };

/** What a change of source means for a live connection: nothing, new settings, or connect again. */
export function sourceChange(a: StreamSource, b: StreamSource): 'same' | 'settings' | 'reconnect' {
  if (a.transport !== b.transport || a.address !== b.address || a.format !== b.format || (a.transport === 'poll' || a.transport === 'demo' ? a.interval !== b.interval : false)) return 'reconnect';
  if (a.mode !== b.mode || a.window !== b.window) return 'settings';
  return 'same';
}

interface Transport { close(): void }
interface TransportHooks {
  open(): void;
  message(data: unknown): void;
  /** `fatal`: retrying won't help (a refused CORS read, a bad address). */
  fail(error: string, fatal?: boolean): void;
}

function openTransport(src: StreamSource, h: TransportHooks, table: TableResult): Transport {
  switch (src.transport) {
    case 'websocket': {
      let ws: WebSocket;
      try { ws = new WebSocket(src.address); } catch (e) { h.fail(`That isn’t a WebSocket address (ws:// or wss://): ${e instanceof Error ? e.message : String(e)}`, true); return { close() {} }; }
      let opened = false;
      ws.onopen = () => { opened = true; h.open(); };
      ws.onmessage = e => { if (typeof e.data === 'string') h.message(e.data); else if (e.data instanceof Blob) void e.data.text().then(t => h.message(t)); };
      ws.onclose = e => h.fail(opened ? `The connection closed${e.reason ? `: ${e.reason}` : ''}.` : 'Couldn’t connect to the WebSocket.');
      ws.onerror = () => { /* onclose follows */ };
      return { close() { ws.onclose = null; ws.onmessage = null; ws.onopen = null; try { ws.close(); } catch { /* closed */ } } };
    }
    case 'sse': {
      let es: EventSource;
      try { es = new EventSource(src.address); } catch (e) { h.fail(`That isn’t an address events can come from: ${e instanceof Error ? e.message : String(e)}`, true); return { close() {} }; }
      es.onopen = () => h.open();
      es.onmessage = e => h.message(e.data);
      es.onerror = () => {
        // EventSource retries by itself while CONNECTING; CLOSED means it gave up (often CORS or a 404).
        if (es.readyState === EventSource.CLOSED) h.fail('The event stream closed. The server may not allow this page to read it.');
      };
      return { close() { es.close(); } };
    }
    case 'poll': {
      let stopped = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let first = true;
      const tick = async () => {
        if (stopped) return;
        try {
          const got = await fetchBytes(src.address);
          if (stopped) return;
          if (first) { first = false; h.open(); }
          h.message(decodeFetched(got.bytes).text);
        } catch (e) {
          if (stopped) return;
          h.fail(e instanceof Error ? e.message : String(e), e instanceof CorsError);
          return;
        }
        timer = setTimeout(() => { void tick(); }, Math.max(0.5, src.interval) * 1000);
      };
      void tick();
      return { close() { stopped = true; clearTimeout(timer); } };
    }
    case 'osc': {
      const filter = src.address;
      const off = oscClient.subscribe(m => { if (oscMatches(filter, m.address)) h.message([oscToRow(m.address, m.args)]); });
      const offStatus = oscClient.onStatus(s => {
        if (s === 'connected') h.open();
        else if (s === 'error') h.fail(oscClient.getMode() === 'bridge'
          ? `The OSC bridge isn’t running on port ${oscClient.getPort()}. Start it with: node tools/osc-bridge.mjs`
          : oscClient.getError() || 'OSC couldn’t start listening.');
      });
      oscClient.setWanted(true);
      if (oscClient.getStatus() === 'connected') queueMicrotask(() => h.open());
      // The OSC client stays on for Play's mappings; only this stream's listeners go.
      return { close() { off(); offStatus(); } };
    }
    case 'demo': {
      const rate = Math.max(0.5, Math.min(60, src.interval));
      // Carry on from the window it has (a saved one, or before a reconnect), so the trail doesn't jump back to the start.
      const tcol = table.columns.find(c => c.name === 't');
      const start0 = tcol && tcol.type === 'number' && table.rows ? Math.round(tcol.max * rate) + 1 : 0;
      let i = start0;
      const started = Date.now();
      queueMicrotask(() => h.open());
      const timer = setInterval(() => {
        const due = start0 + Math.floor(((Date.now() - started) / 1000) * rate);
        const rows: Row[] = [];
        while (i < due && rows.length < 120) rows.push(demoRow(i++, rate));
        if (rows.length) h.message(rows);
      }, Math.max(16, Math.min(250, 1000 / rate)));
      return { close() { clearInterval(timer); } };
    }
  }
}

class StreamConnection {
  status: StreamStatus = { ...OFF };
  table: TableResult;
  private transport: Transport | null = null;
  private lines: LineState = newLineState();
  private meter = new RateMeter();
  private attempt = 0;
  private retry: ReturnType<typeof setTimeout> | undefined;
  readonly id: string;
  src: StreamSource;
  private hub: StreamHub;

  constructor(hub: StreamHub, id: string, src: StreamSource) {
    this.hub = hub;
    this.id = id;
    this.src = src;
    this.table = trimTable(csvToTable(src.text), src.window);
  }

  private set(patch: Partial<StreamStatus>): void {
    this.status = { ...this.status, ...patch };
    this.hub.notify(this.id);
  }

  connect(): void {
    this.stopTransport();
    this.lines = newLineState();
    this.set({ state: 'connecting', error: null, retryAt: null });
    const t = openTransport(this.src, {
      open: () => { if (this.transport !== t && this.transport !== null) return; this.attempt = 0; if (this.status.state !== 'paused') this.set({ state: 'live', error: null }); },
      message: data => { if (this.transport === t || this.transport === null) this.receive(data); },
      fail: (error, fatal) => { if (this.transport === t || this.transport === null) this.failed(error, !!fatal); },
    }, this.table);
    this.transport = t;
  }

  private receive(data: unknown): void {
    if (this.status.state === 'paused') return;
    const { rows: raw, error } = messageToRows(data, this.lines, this.src.format);
    if (error && !raw.length) { this.set({ error }); return; }
    const rows = flatRows(raw);
    if (!rows.length) return;
    const now = Date.now();
    this.meter.add(now, rows.length);
    const before = this.table;
    this.table = applyRows(this.table, rows, this.src.mode, this.src.window);
    if (this.status.state !== 'live') this.status = { ...this.status, state: 'live', error: null };
    this.status = { ...this.status, lastRow: rows[rows.length - 1], lastAt: now, rows: this.table.rows, rowsPerSecond: this.meter.rate(now), error: null };
    this.hub.incoming(this.id, rows, this.src, before);
    this.hub.notify(this.id);
  }

  private failed(error: string, fatal: boolean): void {
    this.stopTransport();
    if (fatal) { this.set({ state: 'error', error, retryAt: null }); return; }
    const wait = backoffDelay(this.attempt++);
    this.set({ state: 'retrying', error, retryAt: Date.now() + wait });
    this.retry = setTimeout(() => this.connect(), wait);
  }

  pause(): void { if (this.status.state !== 'off') this.set({ state: 'paused' }); }
  resume(): void {
    if (this.status.state !== 'paused') return;
    if (this.transport) this.set({ state: 'live' }); else this.connect();
  }

  /** Settings that don't need a new connection (the window, append or replace). */
  update(src: StreamSource): void {
    const windowShrank = src.window < this.src.window;
    this.src = src;
    if (windowShrank) { this.table = trimTable(this.table, src.window); this.hub.incoming(this.id, [], src, this.table); }
    this.status = { ...this.status, rows: this.table.rows };
    this.hub.notify(this.id);
  }

  rate(): number { return this.meter.rate(Date.now()); }

  private stopTransport(): void {
    clearTimeout(this.retry);
    this.retry = undefined;
    const t = this.transport;
    this.transport = null;
    t?.close();
  }

  close(): void {
    this.stopTransport();
    this.meter.reset();
    this.status = { ...OFF, lastRow: this.status.lastRow, lastAt: this.status.lastAt, rows: this.table.rows };
    this.hub.notify(this.id);
  }
}

/** `before`: the window before these rows (a take starting mid-feed begins from it). */
type RowsListener = (id: string, rows: ReadonlyArray<Row>, src: StreamSource, before: TableResult) => void;

export class StreamHub {
  private conns = new Map<string, StreamConnection>();
  private listeners = new Map<string, Set<() => void>>();
  private rowListeners = new Set<RowsListener>();
  private muted = false;
  private notifyQueued = new Set<string>();
  private notifyTimer: ReturnType<typeof setTimeout> | undefined;
  private runs = new Map<string, { busy: boolean; again: boolean; last: number }>();

  // ── Control ────────────────────────────────────────────────────────────
  connect(id: string): void {
    const d = datasetStore.get(id);
    if (!d || d.source.kind !== 'stream') return;
    let c = this.conns.get(id);
    if (!c) { c = new StreamConnection(this, id, d.source); this.conns.set(id, c); }
    else c.src = d.source;
    c.connect();
  }
  pause(id: string): void { this.conns.get(id)?.pause(); }
  resume(id: string): void { this.conns.get(id)?.resume(); }
  disconnect(id: string): void { this.conns.get(id)?.close(); }
  /** Forget a stream (its dataset was removed). */
  drop(id: string): void { this.conns.get(id)?.close(); this.conns.delete(id); this.runs.delete(id); }
  isConnected(id: string): boolean { const s = this.status(id).state; return s !== 'off' && s !== 'error'; }

  status(id: string): StreamStatus {
    const c = this.conns.get(id);
    if (!c) return OFF;
    // The rate falls to 0 when a feed goes quiet, without a message to say so.
    return c.status.state === 'live' ? { ...c.status, rowsPerSecond: c.rate() } : c.status;
  }

  /** The live window (before the notebook), or null when the stream never connected this session. */
  window(id: string): TableResult | null { return this.conns.get(id)?.table ?? null; }
  /** The live window as CSV, to keep with the dataset. */
  windowCsv(id: string): string | null { const t = this.window(id); return t ? tableToCsv(t) : null; }

  /** Hear about a stream's status (at most about 5 times a second). */
  subscribe(id: string, fn: () => void): () => void {
    let set = this.listeners.get(id);
    if (!set) { set = new Set(); this.listeners.set(id, set); }
    set.add(fn);
    return () => { set!.delete(fn); };
  }

  /** Every message's rows, as they come (takes record them). Not called while muted. */
  onRows(fn: RowsListener): () => void {
    this.rowListeners.add(fn);
    return () => { this.rowListeners.delete(fn); };
  }

  /** Take replay and render: readers get the take's rows (`feed`) instead of the live windows. */
  setMuted(on: boolean): void {
    if (on === this.muted) return;
    this.muted = on;
    if (!on) for (const [id, c] of this.conns) if (c.status.state !== 'off' || c.table.rows) this.publish(id, c.table);
  }
  isMuted(): boolean { return this.muted; }

  /** Put a table in front of readers as a stream's window (take replay). `sync` runs the notebook in place (offline render). */
  feed(id: string, table: TableResult, opts: { sync?: boolean } = {}): void {
    this.publish(id, table, opts.sync);
  }

  // ── Following the saved datasets ───────────────────────────────────────
  /** The graph's datasets changed: drop streams that went, reconnect ones whose feed changed, start auto-connect ones. */
  sync(next: DatasetsRecord, prev: DatasetsRecord): void {
    for (const [id, c] of this.conns) {
      const d = next[id];
      if (!d || d.source.kind !== 'stream') { this.drop(id); continue; }
      if (d === prev[id]) continue;
      const change = sourceChange(c.src, d.source);
      const on = c.status.state !== 'off';
      if (change === 'reconnect') { c.src = d.source; if (on && c.status.state !== 'error') c.connect(); else c.src = d.source; }
      else if (change === 'settings') c.update(d.source);
      else c.src = d.source;
      // A new notebook runs over the live window at once.
      if (prev[id] && prev[id].cells !== d.cells && c.table.rows) this.publish(id, c.table);
    }
    for (const [id, d] of Object.entries(next)) {
      if (d.source.kind !== 'stream' || !d.source.autoConnect || this.conns.has(id)) continue;
      if (prev[id]?.source.kind === 'stream' && (prev[id].source as StreamSource).autoConnect) continue;
      this.connect(id);
    }
  }

  // ── Internals ──────────────────────────────────────────────────────────
  /** A connection's window changed. */
  incoming(id: string, rows: ReadonlyArray<Row>, src: StreamSource, before: TableResult): void {
    if (this.muted) return;
    if (rows.length) for (const fn of this.rowListeners) fn(id, rows, src, before);
    const c = this.conns.get(id);
    if (c) this.publish(id, c.table);
  }

  notify(id: string): void {
    this.notifyQueued.add(id);
    if (this.notifyTimer !== undefined) return;
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = undefined;
      const ids = [...this.notifyQueued];
      this.notifyQueued.clear();
      for (const i of ids) for (const fn of this.listeners.get(i) ?? []) fn();
    }, 200);
  }

  private publish(id: string, table: TableResult, sync = false): void {
    const d = datasetStore.get(id);
    if (!d) return;
    if (isPassThrough(d.cells)) { datasetStore.replaceResult(id, table); return; }
    if (sync) {
      const run = runNotebook(table, d.cells);
      if (run.result) datasetStore.replaceResult(id, run.result);
      return;
    }
    // Through the notebook in the worker: one run at a time, then the newest window.
    let r = this.runs.get(id);
    if (!r) { r = { busy: false, again: false, last: 0 }; this.runs.set(id, r); }
    if (r.busy) { r.again = true; return; }
    r.busy = true;
    const go = async () => {
      const state = r!;
      state.again = false;
      state.last = Date.now();
      const cur = datasetStore.get(id);
      const input = this.muted ? table : this.conns.get(id)?.table ?? table;
      const out = cur ? await runDataset({ text: '', format: 'csv', table: input, cells: cur.cells }) : null;
      const result: DatasetResult | null = out?.run?.result ?? null;
      if (result && (!this.muted || input === table)) datasetStore.replaceResult(id, result);
      if (state.again) {
        const wait = Math.max(0, 200 - (Date.now() - state.last));
        setTimeout(() => { void go(); }, wait);
      } else state.busy = false;
    };
    void go();
  }
}

export const streamHub = new StreamHub();

// Follow the saved datasets (auto-connect, sources edited, datasets removed).
datasetStore.onRecords((next, prev) => streamHub.sync(next, prev));
