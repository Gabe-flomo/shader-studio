/**
 * How the Data node uses its dataset: the Use as mode (Values, Points,
 * Keyframes), that mode's settings, the output builder (columns → float, or
 * grouped into vec2/vec3/vec4) and the row helper for GLSL code.
 */
import { useState, type ReactNode } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import type { GraphNode } from '../../types/nodeGraph';
import { Button, IconButton } from '../ui/Button';
import { Segmented, Toggle } from '../ui/Choice';
import { Field } from '../ui/Field';
import { Icon } from '../ui/Icon';
import { Select, type SelectOption } from '../ui/Select';
import { TYPE_COLORS } from '../NodeGraph/typeColors';
import {
  DATA_INTERPS, DATA_MAX_POINTS, dataHelperName, dataMaxPoints, dataMode, dataOutputs, dataPointColumns, dataRadiusColumn, dataRowColumns, dataTimeColumn,
  type DataMode, type DataOutputSpec,
} from '../../nodes/definitions/data';
import { dataCountUniform, DATA_TEX_WIDTH } from '../../data/dataGlsl';
import type { Column } from '../../data/types';
import { suggestGroups } from './dataUi';

const VEC = ['', 'float', 'vec2', 'vec3', 'vec4'];

function nextKey(outs: readonly DataOutputSpec[]): string {
  for (let i = 1; ; i++) if (!outs.some(o => o.key === `o${i}`)) return `o${i}`;
}

export function DataOutputsPanel({ node, columns, onChange }: {
  node: GraphNode;
  /** The dataset's columns (effective result), or none yet. */
  columns: readonly Column[];
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const tk = useTokens();
  const mode = dataMode(node);
  const outs = dataOutputs(node);
  const usable = columns.filter(c => c.type !== 'other');
  const numeric = columns.filter(c => c.type === 'number');
  const colOptions: SelectOption[] = usable.map(c => ({ value: c.name, label: c.type === 'number' ? c.name : `${c.name} (text as 0, 1, 2…)` }));
  const known = new Set(usable.map(c => c.name));

  const label = (t: string) => <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', color: tk.text.faint, textTransform: 'uppercase' }}>{t}</span>;
  const note = (t: ReactNode) => <span style={{ fontSize: 11.5, lineHeight: 1.45, color: tk.text.muted }}>{t}</span>;
  const row = (name: string, control: ReactNode, hint?: ReactNode) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 32 }}>
        <span style={{ width: 96, flexShrink: 0, fontSize: 12, color: tk.text.secondary }}>{name}</span>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8 }}>{control}</div>
      </div>
      {hint && <div style={{ paddingLeft: 106 }}>{note(hint)}</div>}
    </div>
  );
  const section = (children: ReactNode) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 12, borderRadius: radius.lg, background: tk.bg.panel, boxShadow: `inset 0 0 0 1px ${tk.border.subtle}` }}>{children}</div>
  );
  const colSelect = (value: string, onPick: (v: string) => void, aria: string, extra: SelectOption[] = []) => (
    <Select ariaLabel={aria} value={value} onChange={onPick} mono style={{ flex: 1, minWidth: 0, boxShadow: value && !known.has(value) ? `inset 0 0 0 1.5px ${tk.status.danger}` : 'none' }}
      options={[...extra, ...(value && !known.has(value) && !extra.some(e => e.value === value) ? [{ value, label: `${value} (not in the data)` }] : []), ...colOptions]} />
  );

  // ── Output groups (Values, Keyframes) ──
  const setOuts = (next: DataOutputSpec[]) => onChange({ outputs: next });
  const addOutput = (cols?: string[]) => {
    const used = new Set(outs.flatMap(o => o.columns));
    const pick = cols ?? [numeric.find(c => !used.has(c.name))?.name ?? usable[0]?.name].filter((x): x is string => !!x);
    if (!pick.length) return;
    setOuts([...outs, { key: nextKey(outs), columns: pick }]);
  };
  const suggestions = suggestGroups(columns).filter(g => !outs.some(o => o.columns.join() === g.join()));
  const outputsBuilder = section(<>
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
      {label('Outputs')}
      <span style={{ fontSize: 11, color: tk.text.faint }}>1 column → float · 2–4 → vec2–vec4</span>
    </div>
    {outs.length === 0 && note(usable.length ? 'No outputs yet. Add one: each is a socket on the card.' : 'Import data first: its columns become outputs.')}
    {outs.map((o, i) => (
      <div key={o.key} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 0', borderTop: i ? `1px solid ${tk.border.subtle}` : 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, font: `600 11.5px ${fontFamily.mono}`, color: tk.text.primary }}>
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: TYPE_COLORS[VEC[o.columns.length]] }} />{VEC[o.columns.length]}
          </span>
          <span style={{ flex: 1, minWidth: 0, fontSize: 11.5, color: tk.text.faint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>socket “{o.columns.join(', ')}”</span>
          {o.columns.length < 4 && <IconButton size="sm" icon="plus" label="Add a column to this output (makes it a wider vector)" onClick={() => {
            const used = new Set(o.columns);
            const c = numeric.find(x => !used.has(x.name))?.name ?? usable.find(x => !used.has(x.name))?.name;
            if (c) setOuts(outs.map(x => (x.key === o.key ? { ...x, columns: [...x.columns, c] } : x)));
          }} />}
          <IconButton size="sm" icon="trash" tone="danger" label="Remove this output" onClick={() => setOuts(outs.filter(x => x.key !== o.key))} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(2, o.columns.length)}, minmax(0, 1fr))`, gap: 6 }}>
          {o.columns.map((c, j) => (
            <div key={j} style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
              <span style={{ width: 14, flexShrink: 0, font: `600 11px ${fontFamily.mono}`, color: tk.text.faint }}>{o.columns.length > 1 ? 'xyzw'[j] : ''}</span>
              {colSelect(c, v => setOuts(outs.map(x => (x.key === o.key ? { ...x, columns: x.columns.map((y, k) => (k === j ? v : y)) } : x))), `Output ${i + 1}, column ${j + 1}`)}
              {o.columns.length > 1 && <IconButton size="sm" icon="close" label="Take this column out" onClick={() => setOuts(outs.map(x => (x.key === o.key ? { ...x, columns: x.columns.filter((_, k) => k !== j) } : x)))} />}
            </div>
          ))}
        </div>
      </div>
    ))}
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      <Button size="sm" icon="plus" disabled={!usable.length} onClick={() => addOutput()}>Add output</Button>
      {suggestions.map(g => (
        <Button key={g.join()} size="sm" variant="ghost" onClick={() => addOutput(g)} title={`One ${VEC[g.length]} output from ${g.join(', ')}`}>{g.join(', ')} → {VEC[g.length]}</Button>
      ))}
    </div>
  </>);

  // ── Row helper (the data texture, for code) ──
  const rowCols = dataRowColumns(node);
  const name = dataHelperName(node);
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const helper = section(<>
    {label('Row helper for code')}
    {note(<>The columns travel to the shader as a float texture ({'RGBA32F'}, one row per texel, four columns per texture, lines of {DATA_TEX_WIDTH}). Pick up to four columns and any Custom Function or Expression can read row <i>i</i>:</>)}
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6 }}>
      {[0, 1, 2, 3].map(j => (
        <div key={j} style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
          <span style={{ width: 14, flexShrink: 0, font: `600 11px ${fontFamily.mono}`, color: tk.text.faint }}>{'xyzw'[j]}</span>
          {colSelect(rowCols[j] ?? '', v => {
            const next = [...rowCols];
            if (!v) next.splice(j, 1); else next[j] = v;
            onChange({ rowColumns: next.filter(Boolean).slice(0, 4) });
          }, `Row helper column ${j + 1}`, [{ value: '', label: j < rowCols.length ? '(none)' : j === 0 ? 'Choose a column' : 'Add a column' }])}
        </div>
      )).slice(0, Math.min(4, rowCols.length + 1))}
    </div>
    {rowCols.length > 0 && (<>
      {row('Name', <Field mono height={30} value={nameDraft ?? name} aria-label="Row helper name" onChange={e => setNameDraft(e.target.value)}
        onBlur={() => { if (nameDraft !== null) { onChange({ glslName: nameDraft.trim() }); setNameDraft(null); } }}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} style={{ flex: 1 }} />)}
      <pre style={{ margin: 0, padding: '8px 10px', borderRadius: radius.md, background: tk.bg.field, font: `500 11.5px/1.6 ${fontFamily.mono}`, color: tk.text.primary, whiteSpace: 'pre-wrap' }}>
        {`vec4 ${name}(float row)   // ${rowCols.join(', ')}\nfloat ${name}_count()      // rows\n\n// e.g. in a Custom Function:\nvec2 p = ${name}(i).xy;`}
      </pre>
      {note(<>Rows are read as whole numbers (clamped). The row count is also the uniform <code style={{ font: `500 11px ${fontFamily.mono}` }}>{dataCountUniform(String(node.params.dataset || 'id'))}</code>.</>)}
    </>)}
  </>);

  // ── Per-mode settings ──
  let settings: ReactNode = null;
  if (mode === 'values') {
    settings = section(<>
      {label('Reading a row')}
      {note('Index picks the row (0 is the first). Wire Time, a Loop Index or anything else into it, or drag its slider on the card.')}
      {row('Blend', <Toggle checked={node.params.blend !== false} onChange={v => onChange({ blend: v })} label={node.params.blend !== false ? 'Fade between rows' : 'Jump from row to row'} />)}
      {row('Past the end', <Segmented size="sm" value={node.params.edge === 'clamp' ? 'clamp' : 'wrap'} onChange={v => onChange({ edge: v })} options={[{ value: 'wrap', label: 'Wrap' }, { value: 'clamp', label: 'Clamp' }]} />,
        node.params.edge === 'clamp' ? 'Holds the last row.' : 'Starts over after the last row, and blends the last into the first.')}
    </>);
  } else if (mode === 'points') {
    const pts = dataPointColumns(node);
    const radCol = dataRadiusColumn(node);
    settings = section(<>
      {label('Points')}
      {note(<>Each row is a point. For every pixel the node loops over the rows and gives the distance to the nearest one, the nearest row, and the second-nearest distance (for cell edges). At most <b>{dataMaxPoints(node)}</b> rows are read (the cap is {DATA_MAX_POINTS}): every pixel pays for each one.</>)}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 6 }}>
        {[0, 1, 2].map(j => (
          <div key={j} style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
            <span style={{ width: 12, flexShrink: 0, font: `600 11px ${fontFamily.mono}`, color: tk.text.faint }}>{'xyz'[j]}</span>
            {colSelect(pts[j] ?? '', v => {
              const next = [...pts];
              if (!v) next.splice(j, 1); else next[j] = v;
              onChange({ pointColumns: next.filter(Boolean).slice(0, 3) });
            }, `Point ${'xyz'[j]} column`, [{ value: '', label: j === 2 ? '(2D)' : '—' }])}
          </div>
        ))}
      </div>
      {pts.length < 2 && note('Pick an x and a y column (and a z for 3D points).')}
      {row('Shape', <Segmented size="sm" value={node.params.shape === 'path' ? 'path' : 'points'} onChange={v => onChange({ shape: v })} options={[{ value: 'points', label: 'Points' }, { value: 'path', label: 'Path' }]} />,
        node.params.shape === 'path' ? 'The rows joined in order, like a route: the distance is to the nearest segment.' : undefined)}
      {row('Radius', <>
        <Segmented size="sm" value={radCol ? 'column' : 'slider'} onChange={v => onChange({ radiusFrom: v, ...(v === 'column' && !node.params.radiusColumn && numeric[0] ? { radiusColumn: numeric.find(c => !pts.includes(c.name))?.name ?? numeric[0].name } : {}) })} options={[{ value: 'slider', label: 'Slider' }, { value: 'column', label: 'Column' }]} />
        {radCol && colSelect(radCol, v => onChange({ radiusColumn: v }), 'Radius column')}
      </>, radCol ? 'Each point’s own size, from its row.' : 'One size for every point: the Radius slider (or wire) on the card.')}
      {row('Max points', <Field mono height={30} type="number" min={1} max={DATA_MAX_POINTS} value={String(dataMaxPoints(node))} aria-label="Max points"
        onChange={e => { const v = Number(e.target.value); if (Number.isFinite(v) && v >= 1) onChange({ maxPoints: Math.min(DATA_MAX_POINTS, Math.round(v)) }); }} style={{ width: 110 }} />, 'Changing it rebuilds the shader.')}
      {note('Smooth (on the card) blends nearby points into each other.')}
    </>);
  } else {
    const tcol = dataTimeColumn(node);
    settings = section(<>
      {label('Keyframes')}
      {note('Each row is a keyframe. Time (the clock unless you wire something) plays through them; Row and Progress say where it is.')}
      {row('Timing', colSelect(tcol, v => onChange({ timeColumn: v }), 'Time column', [{ value: '', label: 'Evenly over a duration' }]),
        tcol ? `Each row happens at its ${tcol} value (seconds, rows in order).` : 'Rows are spread evenly over Duration (on the card).')}
      {row('Interpolation', <Select ariaLabel="Interpolation" value={typeof node.params.interp === 'string' ? node.params.interp : 'linear'} onChange={v => onChange({ interp: v })} options={DATA_INTERPS.map(o => ({ value: o.value, label: o.label }))} style={{ flex: 1 }} />,
        node.params.interp === 'catmull' ? 'A smooth curve through every row.' : node.params.interp === 'none' ? 'Holds each row until the next one.' : undefined)}
      {row('Ends', <Segmented size="sm" value={node.params.ends === 'pingpong' ? 'pingpong' : node.params.ends === 'hold' ? 'hold' : 'loop'} onChange={v => onChange({ ends: v })} options={[{ value: 'loop', label: 'Loop' }, { value: 'pingpong', label: 'Ping-pong' }, { value: 'hold', label: 'Hold' }]} />)}
      {note('Smoothing (on the card) pulls each row toward its neighbours, softening jumps.')}
    </>);
  }

  const modes: Array<{ value: DataMode; label: string; what: string }> = [
    { value: 'values', label: 'Values', what: 'Index picks a row; columns come out as numbers or vectors.' },
    { value: 'points', label: 'Points', what: 'The rows are points; get the distance to the nearest (a shape).' },
    { value: 'keyframes', label: 'Keyframes', what: 'The rows play back over time.' },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {label('Use as')}
        <Segmented fill value={mode} onChange={v => onChange({ mode: v })} options={modes.map(m => ({ value: m.value, label: m.label }))} ariaLabel="Use the data as" />
        <span style={{ display: 'flex', gap: 6, alignItems: 'flex-start', fontSize: 11.5, lineHeight: 1.45, color: tk.text.muted }}>
          <Icon name="info" size={13} style={{ flexShrink: 0, marginTop: 2, color: tk.text.faint }} />{modes.find(m => m.value === mode)!.what}
        </span>
      </div>
      {settings}
      {mode !== 'points' && outputsBuilder}
      {helper}
      {outs.some(o => o.columns.some(c => !known.has(c))) && usable.length > 0 && (
        <span style={{ fontSize: 11.5, color: tk.status.danger, padding: '6px 10px', borderRadius: radius.md, background: alpha(tk.status.danger, 0.08) }}>
          Some outputs name columns the data doesn’t have any more: they read 0. Pick new ones above.
        </span>
      )}
    </div>
  );
}
