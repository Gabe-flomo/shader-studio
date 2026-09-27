/**
 * The dataset as everything else reads it: the frozen result, with
 * Normalize 0–1 applied when it's on. A table shows its columns (type,
 * min…max) and the first 50 rows; text and JSON show their start.
 */
import { useMemo } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Toggle } from '../ui/Choice';
import { typeColour } from './dataUi';
import { cellText } from '../../data/notebook';
import { normalizeSummary, normalizeTable } from '../../data/normalize';
import { datasetBytes, DATASET_WARN_BYTES, formatBytes, type Column, type Dataset } from '../../data/types';

export const PREVIEW_ROWS = 50;

const fmt = (v: number) => cellText(v);

export function ColumnChips({ columns }: { columns: readonly Column[] }) {
  const tk = useTokens();
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {columns.map(c => (
        <span key={c.name} title={c.type === 'number' ? `${c.name}: numbers from ${fmt(c.min)} to ${fmt(c.max)}` : c.type === 'category' ? `${c.name}: text (reads 0, 1, 2… in the shader, by first appearance)` : `${c.name}: lists or objects (scripts only)`}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 26, padding: '0 9px', borderRadius: radius.md - 1, background: tk.bg.panel, boxShadow: `inset 0 0 0 1px ${tk.border.default}`, font: `500 11.5px ${fontFamily.mono}`, color: tk.text.primary, maxWidth: '100%' }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: typeColour(tk, c.type), flexShrink: 0 }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
          <span style={{ color: tk.text.faint, fontWeight: 400, whiteSpace: 'nowrap' }}>
            {c.type === 'number' ? `${fmt(c.min)}…${fmt(c.max)}` : c.type === 'category' ? 'text' : 'other'}
          </span>
        </span>
      ))}
    </div>
  );
}

export function DataPreview({ dataset, onNormalize, compact = false }: { dataset: Dataset; onNormalize: (on: boolean) => void; compact?: boolean }) {
  const tk = useTokens();
  const r = dataset.result;
  const shown = useMemo(() => (r && r.kind === 'table' && dataset.normalize ? normalizeTable(r) : r), [r, dataset.normalize]);
  const bytes = useMemo(() => datasetBytes(dataset), [dataset]);
  const label = (t: string) => <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', color: tk.text.faint, textTransform: 'uppercase' }}>{t}</span>;
  const note = (t: React.ReactNode, colour = tk.text.muted) => <span style={{ fontSize: 11.5, lineHeight: 1.45, color: colour }}>{t}</span>;

  if (!shown) return note('No result yet. Run the notebook to make one.');

  const size = (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 13, fontWeight: 650, color: tk.text.primary }}>
        {shown.kind === 'table' ? `${shown.rows.toLocaleString()} rows × ${shown.columns.length} columns` : shown.kind === 'text' ? `Text · ${shown.text.length.toLocaleString()} characters` : 'A JSON value'}
      </span>
      <span style={{ fontSize: 11.5, color: bytes > DATASET_WARN_BYTES ? tk.status.warningText : tk.text.faint }}>{formatBytes(bytes)} saved with the graph</span>
    </div>
  );
  const big = bytes > DATASET_WARN_BYTES
    ? note(`This dataset is over ${formatBytes(DATASET_WARN_BYTES)}. Saving in the browser may run out of room (it holds about 5 MB for everything): trim it in the notebook, or export the graph as a file.`, tk.status.warningText)
    : null;

  if (shown.kind !== 'table') {
    const text = shown.kind === 'text' ? shown.text : JSON.stringify(shown.value, null, 2) ?? '';
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0 }}>
        {size}
        {big}
        {note(shown.kind === 'text' ? 'Text datasets are read by scripts and (soon) the Data layer. The Data node reads tables: split the text into rows in the notebook to use it here.' : 'JSON that isn’t a list of records is for scripts. Turn it into records in the notebook (data.map(…)) to use it here.')}
        <pre style={{ margin: 0, padding: 10, borderRadius: radius.md, background: tk.bg.panel, boxShadow: `inset 0 0 0 1px ${tk.border.subtle}`, font: `500 11.5px/1.5 ${fontFamily.mono}`, color: tk.text.primary, whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflow: 'auto', maxHeight: 420 }}>
          {text.length > 4000 ? `${text.slice(0, 4000)}…` : text}
        </pre>
      </div>
    );
  }

  const { mapped, kept } = normalizeSummary(r && r.kind === 'table' ? r : shown);
  const rows = Math.min(PREVIEW_ROWS, shown.rows);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
      {size}
      {big}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 12px', borderRadius: radius.lg, background: dataset.normalize ? alpha(tk.accent.base, 0.07) : tk.bg.panel, boxShadow: `inset 0 0 0 1px ${dataset.normalize ? alpha(tk.accent.base, 0.3) : tk.border.subtle}` }}>
        <Toggle checked={dataset.normalize} onChange={onNormalize} label={<span style={{ fontWeight: 600, color: tk.text.primary }}>Normalize 0–1</span>} />
        {note(dataset.normalize
          ? <>Number columns are read from their min…max as 0…1{mapped.length ? <>: <b>{mapped.join(', ')}</b></> : ''}.{kept.length ? <> Already within 0–1, left as they are: {kept.join(', ')}.</> : ''} The table below shows the values as the shader gets them.</>
          : 'Off: the shader gets the values as they are. On: each number column is mapped from its min…max to 0…1 (columns already within 0–1 stay as they are).')}
      </div>
      <div>{label('Columns')}</div>
      <ColumnChips columns={shown.columns} />
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        {label(`First ${rows} rows`)}
        {shown.rows > rows && <span style={{ fontSize: 11, color: tk.text.faint }}>of {shown.rows.toLocaleString()}</span>}
      </div>
      <div style={{ overflow: 'auto', maxHeight: compact ? 360 : undefined, borderRadius: radius.md, boxShadow: `inset 0 0 0 1px ${tk.border.subtle}`, background: tk.bg.panel }}>
        <table style={{ borderCollapse: 'separate', borderSpacing: 0, font: `500 11.5px ${fontFamily.mono}`, color: tk.text.primary, minWidth: '100%' }}>
          <thead>
            <tr>
              <th style={{ position: 'sticky', top: 0, left: 0, zIndex: 2, background: tk.bg.subtle, padding: '6px 8px', textAlign: 'right', color: tk.text.faint, fontWeight: 500, borderBottom: `1px solid ${tk.border.default}` }}>#</th>
              {shown.columns.map(c => (
                <th key={c.name} style={{ position: 'sticky', top: 0, zIndex: 1, background: tk.bg.subtle, padding: '6px 10px', textAlign: c.type === 'number' ? 'right' : 'left', fontWeight: 600, whiteSpace: 'nowrap', borderBottom: `1px solid ${tk.border.default}` }}>
                  <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: typeColour(tk, c.type), marginRight: 6, verticalAlign: 'middle' }} />{c.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }, (_, i) => (
              <tr key={i}>
                <td style={{ position: 'sticky', left: 0, background: tk.bg.subtle, padding: '4px 8px', textAlign: 'right', color: tk.text.faint, borderBottom: `1px solid ${tk.border.subtle}` }}>{i}</td>
                {shown.columns.map(c => {
                  const v = c.values[i];
                  return (
                    <td key={c.name} style={{ padding: '4px 10px', textAlign: c.type === 'number' ? 'right' : 'left', whiteSpace: 'nowrap', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', color: v === null || v === undefined ? tk.text.disabled : tk.text.primary, borderBottom: `1px solid ${tk.border.subtle}` }}>
                      {v === null || v === undefined ? '—' : cellText(v)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
