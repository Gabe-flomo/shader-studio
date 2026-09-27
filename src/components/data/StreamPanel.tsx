/**
 * A live dataset's source panel (docs/data-layer-plan.md, milestone 8): the
 * status chip (connected, rows per second, the last row, an error) with
 * Connect, Pause, Resume and Disconnect, and the feed's settings.
 *
 * Rows go into the dataset as they come (streams/streamHub.ts), through the
 * notebook, to every reader without a shader rebuild. Pausing or
 * disconnecting keeps the window with the graph, so it opens with those rows.
 */
import { useEffect, useState } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Button } from '../ui/Button';
import { Segmented, Toggle } from '../ui/Choice';
import { Field } from '../ui/Field';
import { Icon } from '../ui/Icon';
import { Select } from '../ui/Select';
import { cellText } from '../../data/notebook';
import { isPassThrough, streamHub, type StreamSource, type StreamStatus } from '../../data/streams/streamHub';
import { STREAM_DEFAULTS } from '../../data/datasetActions';
import { datasetStore } from '../../data/datasetStore';
import { DATASET_MAX_ROWS, type Dataset, type DatasetFormat, type DatasetResult, type StreamTransport } from '../../data/types';
import { TRANSPORTS } from './dataUi';

const ADDRESS: Record<StreamTransport, { label: string; placeholder: string }> = {
  poll: { label: 'URL', placeholder: 'https://example.com/latest.json' },
  websocket: { label: 'Address', placeholder: 'wss://example.com/feed' },
  sse: { label: 'URL', placeholder: 'https://example.com/events' },
  osc: { label: 'OSC address', placeholder: '/sensor/*  (blank or * for every message)' },
  demo: { label: '', placeholder: '' },
};

/** The stream's status, and the time it was read at (for "2 s ago"). */
function useStreamStatus(id: string): { status: StreamStatus; now: number } {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => streamHub.subscribe(id, () => setNow(Date.now())), [id]);
  const state = streamHub.status(id).state;
  // Rows per second and "2 s ago" drift without messages: tick while connected.
  useEffect(() => {
    if (state === 'off' || state === 'error') return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [state]);
  return { status: streamHub.status(id), now };
}

function rowText(row: Record<string, unknown> | null): string {
  if (!row) return '';
  return Object.entries(row).slice(0, 8).map(([k, v]) => `${k}: ${cellText(v)}`).join('  ·  ') + (Object.keys(row).length > 8 ? '  …' : '');
}

/** The status chip: a dot, what's happening, and rows per second. */
export function StreamChip({ status, compact = false }: { status: StreamStatus; compact?: boolean }) {
  const tk = useTokens();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { if (status.state !== 'retrying') return; const t = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(t); }, [status.state]);
  const colour = { off: tk.text.faint, connecting: tk.status.warning, live: tk.status.success, paused: tk.text.muted, retrying: tk.status.warning, error: tk.status.danger }[status.state];
  const rate = status.rowsPerSecond;
  const label = {
    off: 'Not connected',
    connecting: 'Connecting…',
    live: rate > 0 ? `Live · ${rate >= 10 ? Math.round(rate) : rate.toFixed(1)} rows/s` : 'Live · waiting for rows',
    paused: 'Paused',
    retrying: `Reconnecting${status.retryAt ? ` in ${Math.max(0, Math.ceil((status.retryAt - now) / 1000))} s` : '…'}`,
    error: 'Stopped',
  }[status.state];
  return (
    <span role="status" style={{ display: 'inline-flex', alignItems: 'center', gap: 7, height: compact ? 24 : 28, padding: '0 10px', borderRadius: 999, background: alpha(colour, 0.12), color: status.state === 'off' ? tk.text.muted : tk.text.primary, font: `600 11.5px ${fontFamily.ui}`, whiteSpace: 'nowrap' }}>
      <span style={{ position: 'relative', width: 8, height: 8, flexShrink: 0 }}>
        <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: colour }} />
        {status.state === 'live' && rate > 0 && <span style={{ position: 'absolute', inset: -3, borderRadius: '50%', border: `1.5px solid ${colour}`, opacity: 0.5, animation: 'dataLivePulse 1.6s ease-out infinite' }} />}
      </span>
      {label}
    </span>
  );
}

if (typeof document !== 'undefined' && !document.getElementById('data-live-pulse')) {
  const st = document.createElement('style');
  st.id = 'data-live-pulse';
  st.textContent = '@keyframes dataLivePulse { 0% { transform: scale(0.6); opacity: 0.7; } 100% { transform: scale(1.6); opacity: 0; } } @media (prefers-reduced-motion: reduce) { [style*="dataLivePulse"] { animation: none !important; } }';
  document.head.appendChild(st);
}

export function StreamPanel({ dataset, onSource, narrow = false }: {
  dataset: Dataset;
  /** Save the source; `result` too when the window is kept (so the graph opens with what readers saw). */
  onSource: (src: StreamSource, result?: DatasetResult | null) => void;
  narrow?: boolean;
}) {
  const tk = useTokens();
  const src = dataset.source as StreamSource;
  const { status, now } = useStreamStatus(dataset.id);
  // What's being typed; the saved value shows when nothing is.
  const [draft, setDraft] = useState<{ address?: string; window?: string; interval?: string }>({});
  const address = draft.address ?? src.address;
  const windowText = draft.window ?? String(src.window);
  const intervalText = draft.interval ?? String(src.interval);
  const setAddress = (v: string) => setDraft(d => ({ ...d, address: v }));
  const setWindowText = (v: string) => setDraft(d => ({ ...d, window: v }));
  const setIntervalText = (v: string) => setDraft(d => ({ ...d, interval: v }));
  const clearDraft = (k: 'address' | 'window' | 'interval') => setDraft(d => { const n = { ...d }; delete n[k]; return n; });
  const [showSettings, setShowSettings] = useState(!src.address && src.transport !== 'demo');

  const on = status.state !== 'off' && status.state !== 'error';
  const set = (patch: Partial<StreamSource>) => onSource({ ...src, ...patch });
  /** Keep the live window with the dataset, so the graph opens with it. */
  const keepWindow = () => { const csv = streamHub.windowCsv(dataset.id); if (csv !== null) onSource({ ...src, text: csv }, datasetStore.result(dataset.id)); };

  const connect = () => {
    if (src.transport !== 'demo' && src.transport !== 'osc' && !address.trim()) { setShowSettings(true); return; }
    if (address.trim() !== src.address) set({ address: address.trim() });
    clearDraft('address');
    // After the store has the new address.
    queueMicrotask(() => streamHub.connect(dataset.id));
  };
  const pause = () => { streamHub.pause(dataset.id); keepWindow(); };
  const disconnect = () => { streamHub.disconnect(dataset.id); keepWindow(); };

  const commitAddress = () => { if (address.trim() !== src.address) set({ address: address.trim() }); clearDraft('address'); };
  const commitWindow = () => {
    const n = Math.round(Number(windowText));
    if (Number.isFinite(n) && n >= 1) set({ window: Math.min(DATASET_MAX_ROWS, n) });
    clearDraft('window');
  };
  const commitInterval = () => {
    const n = Number(intervalText);
    if (Number.isFinite(n) && n > 0) set({ interval: src.transport === 'demo' ? Math.min(60, Math.max(0.5, n)) : Math.min(3600, Math.max(0.5, n)) });
    clearDraft('interval');
  };

  const transport = TRANSPORTS.find(t => t.value === src.transport)!;
  const age = status.lastAt ? Math.max(0, (now - status.lastAt) / 1000) : null;
  const label = (t: string) => <span style={{ fontSize: 11.5, fontWeight: 600, color: tk.text.muted }}>{t}</span>;
  const row = (l: string, control: React.ReactNode, hint?: React.ReactNode) => (
    <div style={{ display: 'grid', gridTemplateColumns: narrow ? '1fr' : '150px 1fr', gap: narrow ? 4 : 12, alignItems: 'center' }}>
      {label(l)}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>{control}{hint && <span style={{ fontSize: 11.5, color: tk.text.faint, lineHeight: 1.45 }}>{hint}</span>}</div>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0, borderRadius: radius.lg, background: tk.bg.panel, boxShadow: `inset 0 0 0 1px ${tk.border.subtle}`, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '10px 12px' }}>
        <span style={{ width: 30, height: 30, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', background: alpha(tk.accent.base, 0.1), color: tk.accent.base, flexShrink: 0 }}><Icon name="live" size={16} /></span>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, flex: 1 }}>
          <span style={{ fontWeight: 600, fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {transport.label}{src.transport !== 'demo' && src.address ? <span style={{ fontWeight: 500, color: tk.text.muted, fontFamily: fontFamily.mono, fontSize: 11.5 }}> · {src.address}</span> : null}
          </span>
          <span style={{ fontSize: 11.5, color: tk.text.muted }}>
            {src.mode === 'append' ? `Keeps the last ${src.window.toLocaleString()} rows` : 'Each message replaces the table'}
            {src.transport === 'poll' ? ` · every ${src.interval} s` : src.transport === 'demo' ? ` · ${src.interval} rows/s` : ''}
          </span>
        </span>
        <StreamChip status={status} />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', width: narrow ? '100%' : undefined, justifyContent: narrow ? 'flex-end' : undefined }}>
          {!on && <Button size="sm" variant="primary" icon="play" onClick={connect}>{status.state === 'error' ? 'Try again' : 'Connect'}</Button>}
          {status.state === 'paused' && <Button size="sm" icon="play" onClick={() => streamHub.resume(dataset.id)}>Resume</Button>}
          {status.state === 'live' && <Button size="sm" icon="pause" onClick={pause} title="Stop taking rows; the connection stays open">Pause</Button>}
          {on && <Button size="sm" variant="ghost" onClick={disconnect}>Disconnect</Button>}
        </div>
      </div>

      {(status.lastRow || status.error) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '0 12px 10px' }}>
          {status.error && (
            <span style={{ display: 'flex', gap: 6, alignItems: 'flex-start', fontSize: 12, color: status.state === 'error' ? tk.status.danger : tk.status.warningText, lineHeight: 1.45 }}>
              <Icon name="alert" size={13} style={{ marginTop: 2, flexShrink: 0 }} />{status.error}
            </span>
          )}
          {status.lastRow && (
            <span style={{ display: 'flex', gap: 8, alignItems: 'baseline', minWidth: 0 }}>
              <span style={{ fontSize: 11, color: tk.text.faint, whiteSpace: 'nowrap' }}>Last row{age !== null ? ` · ${age < 1 ? 'now' : `${Math.round(age)} s ago`}` : ''}</span>
              <span style={{ font: `500 11.5px ${fontFamily.mono}`, color: tk.text.secondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{rowText(status.lastRow)}</span>
            </span>
          )}
        </div>
      )}

      {src.transport === 'demo' && (
        <div style={{ margin: '0 12px 10px', padding: '8px 10px', borderRadius: radius.md, background: tk.bg.field, fontSize: 11.5, color: tk.text.muted, lineHeight: 1.5 }}>
          <b style={{ color: tk.text.secondary }}>Demo stream.</b> Made up inside the app, no network: <code style={{ fontFamily: fontFamily.mono }}>x</code>, <code style={{ fontFamily: fontFamily.mono }}>y</code> wander on a curve, <code style={{ fontFamily: fontFamily.mono }}>level</code> rises and falls, <code style={{ fontFamily: fontFamily.mono }}>kind</code> is calm, busy or peak. To use a real feed, open Settings and pick another transport: the notebook and everything reading this dataset stay as they are.
        </div>
      )}

      <button type="button" onClick={() => setShowSettings(s => !s)} aria-expanded={showSettings}
        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', border: 0, borderTop: `1px solid ${tk.border.subtle}`, background: tk.bg.subtle, color: tk.text.muted, font: `600 11.5px ${fontFamily.ui}`, cursor: 'pointer', textAlign: 'left' }}>
        <Icon name={showSettings ? 'chevD' : 'chevR'} size={13} /> Settings
      </button>
      {showSettings && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '12px 12px 14px', borderTop: `1px solid ${tk.border.subtle}` }}>
          {row('Transport', (
            <Select ariaLabel="Transport" value={src.transport} style={{ width: '100%' }}
              onChange={v => { const t = v as StreamTransport; const d = STREAM_DEFAULTS[t]; set({ transport: t, address: t === 'demo' || t === 'osc' ? d.address : src.transport === 'demo' || src.transport === 'osc' ? '' : src.address, interval: d.interval, mode: d.mode }); }}
              options={TRANSPORTS.map(t => ({ value: t.value, label: t.label }))} />
          ), transport.what)}
          {src.transport !== 'demo' && row(ADDRESS[src.transport].label, (
            <Field aria-label={ADDRESS[src.transport].label} placeholder={ADDRESS[src.transport].placeholder} value={address} mono
              onChange={e => setAddress(e.target.value)} onBlur={commitAddress} onKeyDown={e => { if (e.key === 'Enter') { commitAddress(); connect(); } }} />
          ), src.transport === 'osc'
            ? 'Each message becomes a row: address, value, value2… In the browser this needs the OSC bridge (node tools/osc-bridge.mjs); the desktop app listens by itself.'
            : src.transport === 'poll' ? 'In the browser only sites that allow other pages to read them work; the desktop app can poll any public https link.'
            : src.transport === 'sse' ? 'Each event’s data is a message: a JSON object or array, or CSV lines.'
            : 'Each message: a JSON object (one row), an array of objects, or CSV lines.')}
          {(src.transport === 'poll' || src.transport === 'demo') && row(src.transport === 'poll' ? 'Every' : 'Rows per second', (
            <Field aria-label={src.transport === 'poll' ? 'Seconds between fetches' : 'Rows per second'} value={intervalText} inputMode="decimal" mono style={{ width: 120 }}
              suffix={src.transport === 'poll' ? 's' : '/s'} onChange={e => setIntervalText(e.target.value)} onBlur={commitInterval} onKeyDown={e => { if (e.key === 'Enter') commitInterval(); }} />
          ))}
          {src.transport !== 'demo' && src.transport !== 'osc' && row('Messages are', (
            <Select ariaLabel="Message format" value={src.format ?? 'auto'} style={{ width: '100%' }}
              onChange={v => { const { format: _f, ...rest } = src; void _f; onSource(v === 'auto' ? rest : { ...rest, format: v as DatasetFormat }); }}
              options={[{ value: 'auto', label: 'Worked out from each message' }, { value: 'json', label: 'JSON' }, { value: 'csv', label: 'CSV lines' }, { value: 'tsv', label: 'Tab-separated lines' }, { value: 'text', label: 'Text (one row per line)' }]} />
          ))}
          {row('New rows', (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <Segmented ariaLabel="New rows" value={src.mode} onChange={m => set({ mode: m })} options={[{ value: 'append', label: 'Add to a window' }, { value: 'replace', label: 'Replace the table' }]} />
              {src.mode === 'append' && (
                <Field aria-label="Rows to keep" value={windowText} inputMode="numeric" mono style={{ width: 120 }} suffix="rows"
                  onChange={e => setWindowText(e.target.value)} onBlur={commitWindow} onKeyDown={e => { if (e.key === 'Enter') commitWindow(); }} />
              )}
            </div>
          ), src.mode === 'append' ? 'The newest rows are kept; older ones drop off the top.' : 'Each message is the whole table (a feed that sends its latest state).')}
          {row('On opening', <Toggle checked={src.autoConnect} onChange={v => set({ autoConnect: v })} label="Connect when the graph opens" />)}
          {row('Website export', (
            <div style={{ alignSelf: 'flex-start', maxWidth: '100%' }}><Segmented ariaLabel="Website export" value={src.onExport} onChange={v => set({ onExport: v })} options={[
              { value: 'freeze', label: 'Freeze the last window' },
              { value: 'reconnect', label: 'Reconnect', disabled: src.transport === 'osc' || src.transport === 'demo', title: src.transport === 'osc' ? 'A published page can’t reach the OSC bridge' : src.transport === 'demo' ? 'The demo only runs in the app' : undefined },
            ]} /></div>
          ), src.onExport === 'reconnect' && src.transport !== 'osc' && src.transport !== 'demo'
            ? isPassThrough(dataset.cells)
              ? 'The page connects to the same feed when it opens: it needs the network, and the export lists it.'
              : 'The notebook changes the rows, and pages don’t carry notebooks, so the export keeps the last window instead.'
            : 'The page carries the rows the stream has now, and never connects.')}
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button size="sm" variant="ghost" icon="save" disabled={!streamHub.window(dataset.id)} onClick={keepWindow} title="Save the rows in the window now with the graph">Keep these rows with the graph</Button>
          </div>
        </div>
      )}
    </div>
  );
}
