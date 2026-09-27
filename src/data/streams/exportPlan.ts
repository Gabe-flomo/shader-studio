/**
 * What a website export does with a live dataset, per the stream's own
 * setting (`onExport`):
 *
 *  - freeze: the page carries the last window (the notebook's result as it
 *    stands), and never connects.
 *  - reconnect: the page carries the last window too, so it shows something
 *    at once, plus what it needs to connect to the same feed. It then needs
 *    the network, and the export lists it as such. OSC and the demo feed
 *    can't be reached from a published page: OSC needs this computer's
 *    bridge, and the demo lives in the app, so those are always frozen.
 *
 * Pure: the exporter (and the Present page) call this per dataset.
 */
import type { Dataset, DatasetResult } from '../types';
import type { StreamSource } from './streamHub';

export interface StreamExport {
  /** The result the page starts with. */
  result: DatasetResult | null;
  /** Present when the page connects to the feed itself. */
  connect?: { transport: 'poll' | 'websocket' | 'sse'; address: string; interval: number; mode: StreamSource['mode']; window: number; format?: StreamSource['format'] };
  /** A line for the export's list: what it needs, or what was frozen. */
  note: { what: string; why: string };
}

/** The export plan for one stream dataset. `live` is its result now (the saved one when not connected). */
export function streamExportPlan(d: Dataset, live: DatasetResult | null): StreamExport | null {
  const src = d.source;
  if (src.kind !== 'stream') return null;
  const result = live ?? d.result;
  const reachable = src.transport === 'poll' || src.transport === 'websocket' || src.transport === 'sse';
  if (src.onExport === 'reconnect' && reachable) {
    return {
      result,
      connect: { transport: src.transport as 'poll' | 'websocket' | 'sse', address: src.address, interval: src.interval, mode: src.mode, window: src.window, ...(src.format ? { format: src.format } : {}) },
      note: { what: `“${d.name}” reconnects to its feed`, why: `Needs the network: the page connects to ${src.address} when it opens, and shows the last ${rowsText(result)} until the first message.` },
    };
  }
  const why = src.onExport === 'reconnect'
    ? src.transport === 'osc'
      ? 'OSC comes through this computer’s bridge, which a published page can’t reach, so the page carries the last window instead.'
      : 'The demo feed is made up inside the app, so the page carries the last window instead.'
    : 'The page carries the last window and doesn’t connect.';
  return { result, note: { what: `“${d.name}” is frozen at its last ${rowsText(result)}`, why } };
}

function rowsText(r: DatasetResult | null): string {
  return r && r.kind === 'table' ? `${r.rows.toLocaleString()} row${r.rows === 1 ? '' : 's'}` : 'rows';
}
