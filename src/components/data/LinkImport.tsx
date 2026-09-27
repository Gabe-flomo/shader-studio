/**
 * Datasets from a link (docs/data-layer-plan.md, milestone 7).
 *
 *  - `LinkImport`: paste a link (or pick a Kaggle dataset's file), see what
 *    it reads as, then keep it. The fetched text is saved with the graph,
 *    with the link, so the graph still opens offline.
 *  - `LinkSourceBar`: a kept link's source line in the notebook: where it
 *    came from, when, and Refresh.
 *
 * In a browser tab only sites that allow other pages to read their files
 * work; the desktop app fetches any public https link itself.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Button } from '../ui/Button';
import { Callout } from '../ui/Callout';
import { Segmented } from '../ui/Choice';
import { Field } from '../ui/Field';
import { Icon } from '../ui/Icon';
import { Select } from '../ui/Select';
import { toast } from '../ui/toastStore';
import { openExternal } from '../../utils/openExternal';
import { MiniTable } from './DataNotebook';
import { ColumnChips } from './DataPreview';
import { summarizeResult } from '../../data/notebook';
import { parseSourceText } from '../../data/parse';
import { CorsError, fetchDataUrl, isDesktopApp, type FetchedData } from '../../data/urlFetch';
import { prepareText } from '../../data/urlSource';
import {
  downloadKaggleFile, forgetKaggleCredentials, kaggleAccount, listKaggleFiles, parseKaggleJson, parseKaggleSlug,
  readableKaggleFiles, saveKaggleCredentials, type KaggleAccount, type KaggleFile,
} from '../../data/kaggle';
import { formatBytes, type Dataset, type DatasetFormat, type DatasetSource, type HeaderMode } from '../../data/types';

const FORMAT_OPTIONS: { value: DatasetFormat; label: string }[] = [
  { value: 'csv', label: 'CSV' }, { value: 'tsv', label: 'TSV (tabs)' }, { value: 'json', label: 'JSON' }, { value: 'text', label: 'Text' },
];

const caps = (tk: ReturnType<typeof useTokens>, t: string) => (
  <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', color: tk.text.faint, textTransform: 'uppercase' }}>{t}</span>
);

function errorCallout(err: { message: string; cors: boolean } | null, onDismiss: () => void): ReactNode {
  if (!err) return null;
  return err.cors
    ? <Callout tone="warning" title="The browser can’t read this link" onDismiss={onDismiss}>{err.message} Download the file and drop it here instead, or open this graph in the desktop app.</Callout>
    : <Callout tone="danger" title="Couldn’t bring that in" onDismiss={onDismiss}>{err.message}</Callout>;
}

const toErr = (e: unknown) => ({ message: e instanceof Error ? e.message : String(e), cors: e instanceof CorsError });

/** What fetched text reads as, for the preview. */
function readPreview(text: string, format: DatasetFormat) {
  try {
    const { result, info } = parseSourceText(prepareText(text, format), format);
    return { result, info, error: null as string | null };
  } catch (e) {
    return { result: null, info: {}, error: e instanceof Error ? e.message : String(e) };
  }
}

/** The fetched file, as it reads: format, size, columns, the first rows. */
function FetchedPreview({ fetched, format, onFormat, onKeep, onCancel, narrow }: {
  fetched: FetchedData; format: DatasetFormat; onFormat: (f: DatasetFormat) => void; onKeep: () => void; onCancel: () => void; narrow: boolean;
}) {
  const tk = useTokens();
  const read = useMemo(() => readPreview(fetched.text, format), [fetched.text, format]);
  const preview = read.result ? summarizeResult(read.result, narrow ? 6 : 8) : null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 14, borderRadius: radius.card, background: tk.bg.panel, boxShadow: `inset 0 0 0 1px ${tk.border.default}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ width: 32, height: 32, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', background: alpha(tk.status.success, 0.12), color: tk.status.success, flexShrink: 0 }}><Icon name="check" size={16} /></span>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, flex: 1 }}>
          <b style={{ fontSize: 13, fontWeight: 650, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fetched.filename}</b>
          <span style={{ fontSize: 11.5, color: tk.text.muted }}>
            {formatBytes(fetched.bytes)}{fetched.contentType ? ` · ${fetched.contentType.split(';')[0]}` : ''}
            {read.result?.kind === 'table' ? ` · ${read.result.rows.toLocaleString()} rows × ${read.result.columns.length} columns` : read.result?.kind === 'text' ? ' · text' : read.result?.kind === 'json' ? ' · a JSON value' : ''}
          </span>
        </span>
        <Select ariaLabel="Read as" value={format} onChange={v => onFormat(v as DatasetFormat)} style={{ width: 128 }} options={FORMAT_OPTIONS.map(o => ({ value: o.value, label: `Read as ${o.label}` }))} />
      </div>
      {fetched.note && (
        <span style={{ display: 'flex', gap: 6, alignItems: 'flex-start', fontSize: 11.5, color: tk.text.muted, lineHeight: 1.45 }}>
          <Icon name="info" size={13} style={{ marginTop: 1, color: tk.text.faint }} />{fetched.note}
        </span>
      )}
      {read.error && <Callout tone="danger" title="It doesn’t read as this format">{read.error} Choose another format above.</Callout>}
      {read.result?.kind === 'table' && <ColumnChips columns={read.result.columns} />}
      {preview?.kind === 'table' && <MiniTable p={preview} />}
      {preview?.kind === 'value' && (
        <pre style={{ margin: 0, padding: '8px 10px', borderRadius: radius.md, background: tk.bg.field, font: `500 11.5px/1.5 ${fontFamily.mono}`, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 200, overflow: 'auto' }}>{preview.text}</pre>
      )}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button variant="primary" icon="check" disabled={!read.result} onClick={onKeep}>Keep it</Button>
      </div>
    </div>
  );
}

export function LinkImport({ onKeep, onCancel, narrow = false, initialTab = 'link' }: {
  onKeep: (f: FetchedData, extra?: { kaggle?: { slug: string; file: string } }) => void;
  onCancel: () => void;
  narrow?: boolean;
  initialTab?: 'link' | 'kaggle';
}) {
  const tk = useTokens();
  const desktop = isDesktopApp();
  const [tab, setTab] = useState<'link' | 'kaggle'>(initialTab);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ message: string; cors: boolean } | null>(null);
  const [fetched, setFetched] = useState<{ data: FetchedData; kaggle?: { slug: string; file: string } } | null>(null);
  const [format, setFormat] = useState<DatasetFormat>('csv');

  const got = (data: FetchedData, kaggle?: { slug: string; file: string }) => { setFetched({ data, kaggle }); setFormat(data.format); setErr(null); };

  const fetchLink = async () => {
    if (!url.trim() || busy) return;
    setBusy(true); setErr(null); setFetched(null);
    try { got(await fetchDataUrl(url)); } catch (e) { setErr(toErr(e)); } finally { setBusy(false); }
  };

  const keep = () => {
    if (!fetched) return;
    onKeep({ ...fetched.data, format, text: prepareText(fetched.data.text, format) }, fetched.kaggle ? { kaggle: fetched.kaggle } : undefined);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, width: '100%', maxWidth: 720, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ width: 36, height: 36, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: alpha(tk.accent.base, 0.1), color: tk.accent.base, flexShrink: 0 }}><Icon name="link" size={18} /></span>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
          {!narrow && <b style={{ fontSize: 15 }}>Import from a link</b>}
          <span style={{ fontSize: 12, color: tk.text.muted }}>What comes back is saved in this graph with the link, so it opens offline. Refresh fetches it again.</span>
        </span>
      </div>
      <div style={{ alignSelf: narrow ? 'stretch' : 'flex-start' }}>
        <Segmented fill={narrow} ariaLabel="Where from" value={tab} onChange={v => { setTab(v); setErr(null); setFetched(null); }} options={[{ value: 'link', label: 'A link' }, { value: 'kaggle', label: 'Kaggle' }]} />
      </div>

      {tab === 'link' && (
        <>
          <form onSubmit={e => { e.preventDefault(); void fetchLink(); }} style={{ display: 'flex', gap: 8, flexDirection: narrow ? 'column' : 'row' }}>
            <Field autoFocus aria-label="Link" placeholder="https://… a .csv, .json or .txt, a GitHub file, a published Google Sheet" value={url} onChange={e => setUrl(e.target.value)}
              leading={<Icon name="link" size={15} style={{ color: tk.text.faint }} />} style={{ flex: narrow ? undefined : 1 }} height={36} mono />
            <Button type="submit" variant={fetched ? 'secondary' : 'primary'} disabled={!url.trim() || busy} style={{ height: 36 }}>{busy ? 'Fetching…' : 'Fetch'}</Button>
          </form>
          {errorCallout(err, () => setErr(null))}
          {fetched && <FetchedPreview fetched={fetched.data} format={format} onFormat={setFormat} onKeep={keep} onCancel={() => setFetched(null)} narrow={narrow} />}
          {!fetched && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 14px', borderRadius: radius.lg, background: tk.bg.subtle, boxShadow: `inset 0 0 0 1px ${tk.border.subtle}` }}>
              {caps(tk, 'Works well with')}
              <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: tk.text.secondary, lineHeight: 1.45 }}>
                <li>Direct links to <b>.csv</b>, <b>.tsv</b>, <b>.json</b> and <b>.txt</b> files (a zip is opened for its data file).</li>
                <li><b>GitHub</b> file pages: the raw file is fetched for you.</li>
                <li><b>Google Sheets</b>: File › Share › Publish to web › CSV, then paste that link. A sheet shared with “Anyone with the link” works too.</li>
                <li>Open-data portals and <b>Hugging Face</b> dataset files.</li>
                <li>Not yet: Parquet and Excel files. Look for a CSV download of the same data.</li>
              </ul>
              <span style={{ fontSize: 11.5, color: tk.text.muted, lineHeight: 1.45 }}>
                {desktop
                  ? 'The desktop app fetches the link itself, so any public https link works.'
                  : 'In the browser, only sites that let other pages read their files work (GitHub raw files and published Google Sheets do). The desktop app can fetch any public link.'}
              </span>
            </div>
          )}
        </>
      )}

      {tab === 'kaggle' && <KaggleImport narrow={narrow} onGot={got} fetched={fetched} format={format} onFormat={setFormat} onKeep={keep} onCancelPreview={() => setFetched(null)} />}

      {!fetched && (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={onCancel}>Back</Button>
        </div>
      )}
    </div>
  );
}

function KaggleImport({ narrow, onGot, fetched, format, onFormat, onKeep, onCancelPreview }: {
  narrow: boolean;
  onGot: (d: FetchedData, kaggle: { slug: string; file: string }) => void;
  fetched: { data: FetchedData } | null;
  format: DatasetFormat;
  onFormat: (f: DatasetFormat) => void;
  onKeep: () => void;
  onCancelPreview: () => void;
}) {
  const tk = useTokens();
  const desktop = isDesktopApp();
  const [account, setAccount] = useState<KaggleAccount | null | undefined>(undefined);
  const [user, setUser] = useState('');
  const [key, setKey] = useState('');
  const [slugText, setSlugText] = useState('');
  const [files, setFiles] = useState<{ slug: string; list: KaggleFile[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<{ message: string; cors: boolean } | null>(null);

  useEffect(() => { void kaggleAccount().then(setAccount, () => setAccount(null)); }, []);

  const save = async () => {
    setErr(null);
    try { await saveKaggleCredentials(user, key); setKey(''); setAccount(await kaggleAccount()); toast.success('Kaggle key saved on this machine'); } catch (e) { setErr(toErr(e)); }
  };
  const forget = async () => { await forgetKaggleCredentials().catch(() => {}); setAccount(null); setFiles(null); };
  const loadKaggleJson = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = () => {
      const f = input.files?.[0];
      if (f) void f.text().then(t => { const c = parseKaggleJson(t); if (c) { setUser(c.username); setKey(c.key); } else setErr({ message: 'That isn’t a kaggle.json file (it needs a username and a key).', cors: false }); });
    };
    input.click();
  };

  const slug = parseKaggleSlug(slugText);
  const list = async () => {
    if (!slug) return;
    setBusy('list'); setErr(null); setFiles(null);
    try { setFiles({ slug, list: await listKaggleFiles(slug) }); } catch (e) { setErr(toErr(e)); } finally { setBusy(null); }
  };
  const download = async (file: string) => {
    if (!files) return;
    setBusy(file); setErr(null);
    try { onGot(await downloadKaggleFile(files.slug, file), { slug: files.slug, file }); } catch (e) { setErr(toErr(e)); } finally { setBusy(null); }
  };

  if (fetched) return <FetchedPreview fetched={fetched.data} format={format} onFormat={onFormat} onKeep={onKeep} onCancel={onCancelPreview} narrow={narrow} />;

  const split = files ? readableKaggleFiles(files.list) : null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {!desktop && (
        <Callout tone="info" title="Kaggle works best in the desktop app">
          Kaggle doesn’t let web pages call it, so listing and downloading usually fail in the browser. The desktop app fetches from Kaggle itself and keeps your key in the keychain.
        </Callout>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 14, borderRadius: radius.card, background: tk.bg.panel, boxShadow: `inset 0 0 0 1px ${tk.border.default}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {caps(tk, 'Your Kaggle account')}
          <span style={{ flex: 1 }} />
          {account && <Button size="sm" variant="ghost" onClick={() => { void forget(); }}>Forget</Button>}
        </div>
        {account === undefined ? <span style={{ fontSize: 12, color: tk.text.faint }}>Checking…</span> : account ? (
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: tk.text.secondary }}>
            <Icon name="lock" size={14} style={{ color: tk.status.success }} />
            <span><b>{account.username}</b> · {account.stored === 'keychain' ? 'the key is in this Mac’s keychain' : 'the key is in this browser’s storage'}</span>
          </span>
        ) : (
          <>
            <span style={{ fontSize: 12, color: tk.text.muted, lineHeight: 1.5 }}>
              Your own API key, stored only on this machine. On kaggle.com open <b>Settings</b> › <b>API</b> › <b>Create New Token</b>: it downloads <code style={{ font: `500 11.5px ${fontFamily.mono}` }}>kaggle.json</code>, which you can load here.{' '}
              <a href="https://www.kaggle.com/settings" target="_blank" rel="noopener noreferrer" onClick={e => openExternal('https://www.kaggle.com/settings', e)} style={{ color: tk.accent.text }}>Open Kaggle settings</a>
            </span>
            <div style={{ display: 'flex', gap: 8, flexDirection: narrow ? 'column' : 'row' }}>
              <Field aria-label="Kaggle username" placeholder="Username" value={user} onChange={e => setUser(e.target.value)} autoComplete="off" style={{ flex: narrow ? undefined : 1 }} />
              <Field aria-label="Kaggle API key" placeholder="API key" type="password" value={key} onChange={e => setKey(e.target.value)} autoComplete="off" mono style={{ flex: narrow ? undefined : 1.4 }} />
            </div>
            {!desktop && (
              <span style={{ display: 'flex', gap: 6, alignItems: 'flex-start', fontSize: 11.5, color: tk.status.warningText, lineHeight: 1.45 }}>
                <Icon name="warning" size={13} style={{ marginTop: 1 }} />
                In the browser the key is kept in this browser’s storage, unencrypted, where any code on this site can read it. Use a key you can revoke, or the desktop app (it uses the keychain).
              </span>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <Button size="sm" variant="ghost" icon="import" onClick={loadKaggleJson}>Load kaggle.json…</Button>
              <Button size="sm" variant="primary" disabled={!user.trim() || !key.trim()} onClick={() => { void save(); }}>Save on this machine</Button>
            </div>
          </>
        )}
      </div>

      <form onSubmit={e => { e.preventDefault(); void list(); }} style={{ display: 'flex', gap: 8, flexDirection: narrow ? 'column' : 'row' }}>
        <Field aria-label="Kaggle dataset" placeholder="owner/dataset, or the dataset page’s link" value={slugText} onChange={e => setSlugText(e.target.value)} mono style={{ flex: narrow ? undefined : 1 }} height={36}
          invalid={!!slugText.trim() && !slug} />
        <Button type="submit" variant="primary" disabled={!slug || !account || busy !== null} style={{ height: 36 }}>{busy === 'list' ? 'Listing…' : 'List files'}</Button>
      </form>
      {!account && account !== undefined && <span style={{ fontSize: 11.5, color: tk.text.faint }}>Add your account above to list a dataset’s files.</span>}
      {errorCallout(err, () => setErr(null))}
      {split && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {caps(tk, `${files!.slug} · ${files!.list.length} file${files!.list.length === 1 ? '' : 's'}`)}
          {split.readable.length === 0 && <span style={{ fontSize: 12, color: tk.text.muted }}>No CSV, JSON or text files in this dataset.</span>}
          {split.readable.map(f => (
            <button key={f.name} type="button" disabled={busy !== null} onClick={() => { void download(f.name); }}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: radius.lg, border: 0, textAlign: 'left', cursor: busy ? 'default' : 'pointer', background: tk.bg.panel, boxShadow: `inset 0 0 0 1px ${tk.border.subtle}`, color: tk.text.primary, font: `12.5px ${fontFamily.ui}` }}>
              <Icon name="table" size={16} style={{ color: tk.text.faint }} />
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: fontFamily.mono }}>{f.name}</span>
              <span style={{ fontSize: 11.5, color: tk.text.faint }}>{busy === f.name ? 'Downloading…' : f.bytes !== null ? formatBytes(f.bytes) : ''}</span>
              <Icon name="chevR" size={14} style={{ color: tk.text.faint }} />
            </button>
          ))}
          {split.other.length > 0 && <span style={{ fontSize: 11.5, color: tk.text.faint }}>Also in it, but not readable here: {split.other.map(f => f.name).join(', ')}</span>}
        </div>
      )}
    </div>
  );
}

// ── A kept link, in the notebook ────────────────────────────────────────────

function ago(ms: number): string {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(ms).toLocaleDateString();
}

type UrlSource = Extract<DatasetSource, { kind: 'url' }>;

export function LinkSourceBar({ dataset, delimiterNote, headerDetected, onSource }: {
  dataset: Dataset;
  delimiterNote?: string;
  headerDetected?: boolean;
  /** Save a new source (then the editor reruns the notebook). */
  onSource: (src: UrlSource) => void;
}) {
  const tk = useTokens();
  const src = dataset.source as UrlSource;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ message: string; cors: boolean } | null>(null);
  const table = src.format === 'csv' || src.format === 'tsv';

  const refresh = async () => {
    setBusy(true); setErr(null);
    try {
      const f = src.kaggle ? await downloadKaggleFile(src.kaggle.slug, src.kaggle.file) : await fetchDataUrl(src.url, { format: src.format });
      const same = f.text === src.text;
      onSource({ ...src, text: f.text, fetchedAt: Date.now() });
      toast.success(same ? 'Fetched again: nothing changed' : 'Fetched again', { message: same ? undefined : 'The notebook ran on the new data.' });
    } catch (e) { setErr(toErr(e)); } finally { setBusy(false); }
  };

  let host = src.url;
  try { host = new URL(src.url).host; } catch { /* shown as is */ }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '10px 12px', borderRadius: radius.lg, background: tk.bg.panel, boxShadow: `inset 0 0 0 1px ${tk.border.subtle}` }}>
        <span style={{ width: 30, height: 30, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', background: alpha(tk.accent.base, 0.1), color: tk.accent.base, flexShrink: 0 }}><Icon name="link" size={15} /></span>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, flex: 1 }}>
          <a href={src.url} target="_blank" rel="noopener noreferrer" onClick={e => openExternal(src.url, e)} title={src.url}
            style={{ fontWeight: 600, fontSize: 12.5, color: tk.text.primary, textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {src.kaggle ? `Kaggle · ${src.kaggle.slug} · ${src.kaggle.file}` : `${host} · ${decodeURIComponent(src.url.split('/').pop()?.split('?')[0] ?? '')}`}
          </a>
          <span style={{ fontSize: 11.5, color: tk.text.muted }}>
            {src.format.toUpperCase()} · {formatBytes(src.text.length)}{src.fetchedAt ? ` · fetched ${ago(src.fetchedAt)}` : ''}{delimiterNote ?? ''}
          </span>
        </span>
        {table && (
          <Select ariaLabel="Header row" value={src.header ?? 'auto'} onChange={v => {
            const { header: _h, ...rest } = src; void _h;
            onSource(v === 'auto' ? rest : { ...rest, header: v as HeaderMode });
          }} style={{ width: 170 }} options={[
            { value: 'auto', label: headerDetected === false ? 'Header: auto (none)' : 'Header: auto' },
            { value: 'yes', label: 'First row is the header' },
            { value: 'no', label: 'No header row' },
          ]} />
        )}
        <Button size="sm" icon="reset" disabled={busy} onClick={() => { void refresh(); }} title="Fetch the link again; the notebook stays">{busy ? 'Fetching…' : 'Refresh'}</Button>
      </div>
      {errorCallout(err, () => setErr(null))}
    </div>
  );
}
