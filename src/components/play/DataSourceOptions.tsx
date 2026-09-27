/**
 * The options row of a Data mapping source ("Data · <dataset> · current ·
 * <column>"): which dataset, which column of its current row, and which Data
 * layer's stepping decides the current row.
 */
import type { CSSProperties } from 'react';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { useTokens } from '../../theme/themeStore';
import { fontFamily } from '../../theme/tokens';
import { DATA_ROW_COLUMN, type PlaySource } from '../../types/play';
import { Select } from '../ui/Select';

type DataSource = Extract<PlaySource, { kind: 'data' }>;

export function DataSourceOptions({ source, labelStyle, onChange }: { source: DataSource; labelStyle?: CSSProperties; onChange: (s: PlaySource) => void }) {
  const tk = useTokens();
  const datasets = useNodeGraphStore(s => s.datasets);
  const layers = useNodeGraphStore(s => s.play.layers);
  const list = Object.values(datasets);
  const ds = datasets[source.dataset];
  const result = ds?.result;
  const columns = result?.kind === 'table' ? result.columns.filter(c => c.type !== 'other') : [];
  const readers = layers.filter(l => l.kind === 'data' && l.dataset === source.dataset);
  const label: CSSProperties = labelStyle ?? { color: tk.text.faint, font: `600 10px ${fontFamily.ui}`, textTransform: 'uppercase', width: 52, flexShrink: 0 };
  const hint = (text: string) => <div style={{ margin: '-2px 0 6px 60px', color: tk.text.faint, font: `11px/1.4 ${fontFamily.ui}` }}>{text}</div>;

  if (!list.length) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <span style={label}>Options</span>
        <span style={{ color: tk.text.faint, font: `11px ${fontFamily.ui}` }}>Add a Data layer (Layers → Add layer → Data) or a Data node first.</span>
      </div>
    );
  }
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
        <span style={label}>Options</span>
        <Select ariaLabel="Dataset" value={source.dataset} height={26} style={{ flex: 1, minWidth: 110 }}
          options={[...(ds ? [] : [{ value: source.dataset, label: 'Choose a dataset' }]), ...list.map(d => ({ value: d.id, label: d.name }))]}
          onChange={v => onChange({ ...source, dataset: v, column: datasets[v]?.result?.kind === 'table' && datasets[v].result.columns.some(c => c.name === source.column) ? source.column : DATA_ROW_COLUMN, layerId: '' })} />
        <Select ariaLabel="Column" value={source.column} height={26} style={{ flex: 1, minWidth: 110 }}
          options={[{ value: DATA_ROW_COLUMN, label: 'Row (how far through)' }, ...columns.map(c => ({ value: c.name, label: c.name }))]}
          onChange={v => onChange({ ...source, column: v })} />
        {readers.length > 1 && (
          <Select ariaLabel="Current row from" value={source.layerId} height={26} style={{ flex: 1, minWidth: 110 }}
            options={[{ value: '', label: 'The first Data layer' }, ...readers.map(l => ({ value: l.id, label: l.label }))]}
            onChange={v => onChange({ ...source, layerId: v })} />
        )}
      </div>
      {hint(readers.length
        ? `The value in the current row, 0 to 1 from the column's smallest to its largest. It moves as ${readers.length > 1 ? 'that' : 'the'} Data layer steps (its Offset, Next, Previous…).`
        : 'The value in the current row, 0 to 1 from the column\'s smallest to its largest. Add a Data layer on this dataset to step through the rows; without one it reads the first row.')}
    </>
  );
}
