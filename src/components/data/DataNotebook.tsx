/**
 * The notebook half of the Data editor: where the data came from, then the
 * cells. Each cell is JavaScript (CodeField, with the table helper in
 * autocomplete); under it, what its last value was, what it printed, or its
 * error. The editor owns running; this only edits and shows.
 */
import { useRef, type ReactNode } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Button, IconButton } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Select } from '../ui/Select';
import { CodeField } from '../code/CodeField';
import { tokenizeJsLine } from '../code/jsSyntax';
import type { Completion } from '../code/glslReference';
import type { MemberCompletions } from '../code/useCompletion';
import type { CellOutput, ValuePreview } from '../../data/notebook';
import type { ParseInfo } from '../../data/parse';
import { newCellId } from '../../data/datasetActions';
import { formatBytes, type Dataset, type HeaderMode, type NotebookCell } from '../../data/types';

const DELIM_NAME: Record<string, string> = { ',': 'commas', '\t': 'tabs', ';': 'semicolons', '|': 'pipes' };

function MiniTable({ p }: { p: Extract<ValuePreview, { kind: 'table' }> }) {
  const tk = useTokens();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 11.5, color: tk.text.muted }}>
        Table · {p.rows.toLocaleString()} row{p.rows === 1 ? '' : 's'} × {p.columns.length} column{p.columns.length === 1 ? '' : 's'}
      </span>
      <div style={{ overflowX: 'auto', borderRadius: radius.md, boxShadow: `inset 0 0 0 1px ${tk.border.subtle}`, background: tk.bg.panel }}>
        <table style={{ borderCollapse: 'collapse', font: `500 11px ${fontFamily.mono}`, color: tk.text.primary }}>
          <thead>
            <tr>{p.columns.map(c => (
              <th key={c.name} style={{ padding: '4px 10px', textAlign: c.type === 'number' ? 'right' : 'left', whiteSpace: 'nowrap', fontWeight: 600, borderBottom: `1px solid ${tk.border.subtle}`, background: tk.bg.subtle }}>
                {c.name}<span style={{ color: tk.text.faint, fontWeight: 400 }}>{c.type === 'number' ? '' : c.type === 'category' ? ' · text' : ' · other'}</span>
              </th>
            ))}</tr>
          </thead>
          <tbody>
            {p.head.map((row, i) => (
              <tr key={i}>{row.map((v, j) => (
                <td key={j} style={{ padding: '3px 10px', textAlign: p.columns[j].type === 'number' ? 'right' : 'left', whiteSpace: 'nowrap', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', color: v === '' ? tk.text.disabled : tk.text.primary }}>{v === '' ? '—' : v}</td>
              ))}</tr>
            ))}
          </tbody>
        </table>
      </div>
      {p.rows > p.head.length && <span style={{ fontSize: 11, color: tk.text.faint }}>…and {(p.rows - p.head.length).toLocaleString()} more</span>}
    </div>
  );
}

function CellResult({ out, stale }: { out: CellOutput | undefined; stale: boolean }) {
  const tk = useTokens();
  if (!out) {
    return stale ? <span style={{ fontSize: 11.5, color: tk.text.faint }}>Not run: a cell above stopped.</span> : null;
  }
  const logs = out.logs.length > 0 && (
    <pre style={{ margin: 0, padding: '6px 9px', borderRadius: radius.md, background: tk.bg.field, font: `500 11px/1.5 ${fontFamily.mono}`, color: tk.text.secondary, whiteSpace: 'pre-wrap', maxHeight: 140, overflow: 'auto' }}>{out.logs.join('\n')}</pre>
  );
  if (!out.ok) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {logs}
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '8px 10px', borderRadius: radius.md, background: alpha(tk.status.danger, 0.08), boxShadow: `inset 0 0 0 1px ${alpha(tk.status.danger, 0.35)}`, color: tk.status.danger, fontSize: 12, lineHeight: 1.45 }}>
          <Icon name="alert" size={14} style={{ flexShrink: 0, marginTop: 2 }} />
          <span style={{ minWidth: 0, wordBreak: 'break-word' }}>{out.line ? <b>Line {out.line}: </b> : null}{out.error}</span>
        </div>
      </div>
    );
  }
  const p = out.preview;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {logs}
      {p.kind === 'table' && <MiniTable p={p} />}
      {p.kind === 'value' && (
        <pre style={{ margin: 0, padding: '6px 9px', borderRadius: radius.md, background: tk.bg.panel, boxShadow: `inset 0 0 0 1px ${tk.border.subtle}`, font: `500 11.5px/1.5 ${fontFamily.mono}`, color: tk.text.primary, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 180, overflow: 'auto' }}>{p.text}</pre>
      )}
    </div>
  );
}

export function DataNotebook({
  dataset, cellOut, info, parseError, runError, running, completions, onCells, onHeader, onReplaceFile, onRun,
}: {
  dataset: Dataset;
  cellOut: Record<string, CellOutput>;
  info: ParseInfo | null;
  parseError: string | null;
  runError: string | null;
  running: boolean;
  completions: { all: Completion[]; members: MemberCompletions };
  onCells: (cells: NotebookCell[]) => void;
  onHeader: (h: HeaderMode) => void;
  onReplaceFile: () => void;
  onRun: () => void;
}) {
  const tk = useTokens();
  const src = dataset.source;
  const cells = dataset.cells;
  const failedAt = cells.findIndex(c => cellOut[c.id] && !cellOut[c.id].ok);
  const lastRef = useRef<HTMLTextAreaElement | null>(null);

  const setCode = (id: string, code: string) => onCells(cells.map(c => (c.id === id ? { ...c, code } : c)));
  const addCell = () => {
    onCells([...cells, { id: newCellId(), code: '' }]);
    requestAnimationFrame(() => lastRef.current?.focus());
  };
  const move = (i: number, d: -1 | 1) => {
    const next = [...cells];
    const [c] = next.splice(i, 1);
    next.splice(i + d, 0, c);
    onCells(next);
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); onRun(); }
  };

  let sourceLine: ReactNode = null;
  if (src.kind === 'file') {
    const table = src.format === 'csv' || src.format === 'tsv';
    sourceLine = (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '10px 12px', borderRadius: radius.lg, background: tk.bg.panel, boxShadow: `inset 0 0 0 1px ${tk.border.subtle}` }}>
        <span style={{ width: 30, height: 30, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', background: alpha(tk.accent.base, 0.1), color: tk.accent.base, flexShrink: 0 }}><Icon name="import" size={15} /></span>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, flex: 1 }}>
          <span style={{ fontWeight: 600, fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{src.filename}</span>
          <span style={{ fontSize: 11.5, color: tk.text.muted }}>
            {src.format.toUpperCase()} · {formatBytes(src.text.length)}
            {info?.delimiter && table ? ` · split by ${DELIM_NAME[info.delimiter] ?? info.delimiter}` : ''}
            {info?.truncated ? ` · first ${(200_000).toLocaleString()} rows kept` : ''}
            {info?.ragged ? ` · ${info.ragged} short or long row${info.ragged === 1 ? '' : 's'} padded` : ''}
          </span>
        </span>
        {table && (
          <Select ariaLabel="Header row" value={src.header ?? 'auto'} onChange={v => onHeader(v as HeaderMode)} style={{ width: 170 }} options={[
            { value: 'auto', label: info?.header === false ? 'Header: auto (none)' : 'Header: auto' },
            { value: 'yes', label: 'First row is the header' },
            { value: 'no', label: 'No header row' },
          ]} />
        )}
        <Button size="sm" icon="import" onClick={onReplaceFile} title="Load a new version of the file; the notebook stays">Replace file</Button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {sourceLine}
      {parseError && (
        <div style={{ padding: '8px 10px', borderRadius: radius.md, background: alpha(tk.status.danger, 0.08), color: tk.status.danger, fontSize: 12, lineHeight: 1.45 }}>{parseError}</div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', color: tk.text.faint, textTransform: 'uppercase' }}>Notebook</span>
        <span style={{ fontSize: 11.5, color: tk.text.faint, flex: 1, minWidth: 0 }}>
          JavaScript, top to bottom. {src.kind === 'file' && (src.format === 'csv' || src.format === 'tsv') ? <><code style={{ font: `500 11.5px ${fontFamily.mono}` }}>df</code> is the table;</> : <><code style={{ font: `500 11.5px ${fontFamily.mono}` }}>data</code> is the file;</>} the last value (or <code style={{ font: `500 11.5px ${fontFamily.mono}` }}>result</code>) becomes the dataset.
        </span>
      </div>
      {cells.map((c, i) => {
        const out = cellOut[c.id];
        const failed = out && !out.ok;
        return (
          <div key={c.id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <CodeField
              title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <span style={{ font: `600 11px ${fontFamily.mono}`, color: failed ? tk.status.danger : running ? tk.text.faint : out ? tk.status.success : tk.text.faint }}>[{i + 1}]</span>
                <span>Cell {i + 1}</span>
              </span>}
              ariaLabel={`Cell ${i + 1}`}
              value={c.code}
              onChange={code => setCode(c.id, code)}
              completions={completions.all}
              members={completions.members}
              tokenize={tokenizeJsLine}
              autoIndent
              minHeight={44}
              maxHeight={320}
              invalid={!!failed}
              placeholder={i === 0 ? "df.where(r => r.temp > 20)" : 'df.groupby(\'city\').mean(\'temp\')'}
              textareaRef={i === cells.length - 1 ? (el => { lastRef.current = el; }) : undefined}
              onKeyDown={onKeyDown}
              actions={<>
                <IconButton size="sm" icon="chevU" label="Move up" disabled={i === 0} onClick={() => move(i, -1)} />
                <IconButton size="sm" icon="chevD" label="Move down" disabled={i === cells.length - 1} onClick={() => move(i, 1)} />
                <IconButton size="sm" icon="trash" tone="danger" label="Delete cell" onClick={() => onCells(cells.filter(x => x.id !== c.id))} />
              </>}
            />
            <div style={{ paddingLeft: 4 }}>
              <CellResult out={out} stale={failedAt >= 0 && i > failedAt} />
            </div>
          </div>
        );
      })}
      <button type="button" onClick={addCell}
        style={{ height: 38, borderRadius: radius.lg, border: `1.5px dashed ${tk.border.strong}`, background: 'transparent', color: tk.text.muted, font: `500 12.5px ${fontFamily.ui}`, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
        <Icon name="plus" size={14} /> Add cell
      </button>
      {runError && <span style={{ fontSize: 12, color: tk.status.danger }}>{runError}</span>}
    </div>
  );
}
