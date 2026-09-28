/**
 * The Data layer's editor (types/playLayers.ts DataLayer): a simple viewer's
 * settings. Which dataset (the heavy editing, import and the notebook, stays
 * in the dataset window, which Open brings up), how a table draws (a view
 * and its columns), where (axes, the picture or a region), how text splits,
 * and how the layer steps through rows (Offset, Next, Previous…).
 */
import { useEffect, useState, type ReactNode } from 'react';
import { useNodeGraphStore } from '../../../store/useNodeGraphStore';
import type { DataLayer } from '../../../types/play';
import type { DatasetResult } from '../../../data/types';
import { datasetStore } from '../../../data/datasetStore';
import { dataItemCount, suggestDataColumns } from '../../../play/dataLayer';
import { kdTextItems } from '../../../play/kit/data.js';
import { playEngine } from '../../../lib/playEngine';
import { Button, IconButton } from '../../ui/Button';
import { Field } from '../../ui/Field';
import { Select } from '../../ui/Select';
import { NumberInput } from '../../NodeGraph/NumberInput';
import { lazyWithSuspense, type PropsOf } from '../../lazyWithSuspense';
import type { DataEditor as DataEditorT } from '../../data/DataEditor';
import { BLENDS, BLEND_HINT, type Choice, type FieldKit } from './fields';
import { FontRow } from './rows';
import { Section } from './Section';
import type { EditorContext } from './editors';

const DataEditor = lazyWithSuspense<PropsOf<typeof DataEditorT>>(() => import('../../data/DataEditor').then(m => ({ default: m.DataEditor })));

const VIEWS: Choice[] = [
  { value: 'points', label: 'Points', title: 'A scatter: x and y from two columns' },
  { value: 'path', label: 'Path', title: 'The rows joined in order: a route, a signal' },
  { value: 'bars', label: 'Bars', title: 'A bar per row: a name and a number' },
  { value: 'pie', label: 'Pie', title: 'A slice per row, sized by a number' },
  { value: 'lines', label: 'Lines', title: 'A number across the rows, a line per name' },
];
const VIEW_HINT: Record<string, string> = {
  points: 'Each row is a mark at its X and Y. Size, colour, opacity, rotation and a label can come from other columns.',
  path: 'The rows joined in order, like a route. Trim draws it on: animate it from 0 to 1.',
  bars: 'A bar per row, side by side: its name from one column, its height from another. Bars grow from 0.',
  pie: 'A slice per row, sized by its number, with its name as the label.',
  lines: 'A number across the rows. With a Series column, a line for each of its values (a line per city).',
};
const MATTES: Choice[] = [
  { value: 'over', label: 'Over', title: 'Drawn over the picture with the blend mode' },
  { value: 'reveal', label: 'Reveal', title: 'The picture shows only inside the letters; the colour fills the rest' },
  { value: 'luma', label: 'Luma', title: 'The picture\'s brightness is the text\'s alpha' },
];

/** The dataset window for this layer, and whatever opens it. */
function useDatasetWindow(l: DataLayer, set: (p: Partial<DataLayer>) => void) {
  const [open, setOpen] = useState(false);
  const node = open ? (
    <DataEditor dataset={{ id: l.dataset, onPick: id => set({ dataset: id, ...suggestDataColumns(datasetStore.effective(id), l) }) }} onClose={() => setOpen(false)} />
  ) : null;
  return { open: () => setOpen(true), node };
}

/** The current row, as the layer last drew it (polled while the panel is open). */
function useCurrentRow(id: string): number {
  const [row, setRow] = useState(() => playEngine.sensor(`${id}::row`) ?? 0);
  useEffect(() => {
    const t = window.setInterval(() => { const r = playEngine.sensor(`${id}::row`) ?? 0; setRow(prev => (prev === r ? prev : r)); }, 150);
    return () => window.clearInterval(t);
  }, [id]);
  return row;
}

export function DataLayerEditor({ f, ctx }: { f: FieldKit; ctx: EditorContext }) {
  const l = f.l as DataLayer;
  const set = (p: Partial<DataLayer>) => f.set(p);
  const datasets = useNodeGraphStore(s => s.datasets);
  const ds = l.dataset ? datasets[l.dataset] : undefined;
  // The saved result (what the window just ran), as readers see it: Normalize applied.
  const result: DatasetResult | null = ds ? datasetStore.effective(ds.id) ?? ds.result : null;
  const win = useDatasetWindow(l, set);
  const row = useCurrentRow(l.id);
  const list = Object.values(datasets);
  const n = dataItemCount(l, result);

  // A table picked up by a layer with no columns yet (or ones it doesn't have) gets a start.
  const suggestion = suggestDataColumns(result, l);
  const needs = Object.keys(suggestion).length > 0 && Object.values(suggestion).some(Boolean);
  useEffect(() => { if (needs) f.set(suggestion); }, [needs, l.dataset]); // eslint-disable-line react-hooks/exhaustive-deps

  const columns = result?.kind === 'table' ? result.columns.filter(c => c.type !== 'other') : [];
  const numbers = columns.filter(c => c.type === 'number');
  const col = (label: string, key: keyof DataLayer, opts: { none?: string; onlyNumbers?: boolean; hint?: string } = {}): ReactNode => {
    const from = opts.onlyNumbers ? numbers : columns;
    const value = String(l[key] ?? '');
    return f.row(label, (
      <Select ariaLabel={label} value={value} height={26} style={{ flex: 1, minWidth: 0 }}
        options={[...(opts.none !== undefined || !value ? [{ value: '', label: opts.none ?? 'Choose a column' }] : []), ...(value && !from.some(c => c.name === value) ? [{ value, label: `${value} (missing)` }] : []), ...from.map(c => ({ value: c.name, label: c.name }))]}
        onChange={v => set({ [key]: v } as Partial<DataLayer>)} />
    ), opts.hint);
  };

  // ── Which dataset ────────────────────────────────────────────────────────
  const summary = !ds ? '' : !result ? 'Not run yet: open it and press Run all.'
    : result.kind === 'table' ? `${result.rows.toLocaleString()} rows · ${result.columns.map(c => c.name).join(', ')}`
    : result.kind === 'text' ? `Text · ${n.toLocaleString()} ${l.split === 'lines' ? 'lines' : l.split === 'letters' ? 'letters' : l.split === 'words' ? 'words' : 'chunks'}${l.order !== 'text' ? ' (each once)' : ''}`
    : 'A JSON value: scripts can read it with s.data(); the layer draws tables and text.';
  const datasetSection = (
    <Section kind="data" title="Dataset" primary>
      {f.row('Dataset', list.length ? (
        <>
          <Select ariaLabel="Dataset" value={l.dataset} height={26} style={{ flex: 1, minWidth: 0 }}
            options={[...(ds ? [] : [{ value: l.dataset, label: l.dataset ? `${l.dataset} (missing)` : 'Choose a dataset' }]), ...list.map(d => ({ value: d.id, label: d.name }))]}
            onChange={v => set({ dataset: v, ...suggestDataColumns(datasetStore.effective(v), l) })} />
          <IconButton icon="grid" label={ds ? 'Open the dataset: its file, notebook and table' : 'Import a file or pick a sample'} size="sm" onClick={win.open} />
        </>
      ) : <Button size="sm" icon="import" onClick={win.open}>Import or try a sample…</Button>,
      'The data this layer draws. Datasets belong to the graph file: a Data node in the Studio can read the same one.')}
      {ds && f.note(summary)}
      {ds && f.note(<>Edit the file and the notebook in the dataset window (<button type="button" onClick={win.open} style={{ border: 0, padding: 0, background: 'none', color: f.tk.accent.text, cursor: 'pointer', font: 'inherit' }}>Open</button>); this layer redraws when its result changes.</>)}
      {win.node}
    </Section>
  );

  const stepping = n > 0 && (
    <Section kind="data" title="Stepping" hint="Which rows (or chunks) show. Offset is the current one: a control, a mapping, an LFO or a hand can drive it, and Next, Previous, Random and Go to actions count on from it.">
      {f.seg('Show', 'show', [
        { value: 'all', label: 'All' }, { value: 'range', label: 'Range', title: 'Rows from…to' }, { value: 'window', label: 'Window', title: 'N rows from the current one' },
      ], 'All: every row (text: all of it). Range: the rows from…to. Window: a few rows from the current one, moving as it steps.')}
      {l.show === 'range' && f.props('from', 'to')}
      {l.show === 'window' && f.prop('count')}
      {l.show === 'window' && f.seg('Steps by', 'stepBy', [{ value: 'row', label: 'A row' }, { value: 'window', label: 'A window', title: 'Next shows the next N rows: pages' }], 'Next and Previous move one row, or a whole window at a time (pages).')}
      {f.prop('offset')}
      {f.seg('Change', 'transition', [{ value: 'cut', label: 'Cut' }, { value: 'fade', label: 'Fade' }], 'How the rows that show change when the current one moves.')}
      {l.transition === 'fade' && f.prop('duration')}
      {f.row('Now', (
        <>
          <span style={{ font: `500 11.5px ui-monospace, Menlo, monospace`, color: f.tk.text.secondary, minWidth: 64 }}>{`${Math.min(n, row + 1)} of ${n}`}</span>
          <Button size="sm" onClick={() => ctx.act('prev')}>Previous</Button>
          <Button size="sm" onClick={() => ctx.act('next')}>Next</Button>
        </>
      ), 'The current row (counting from 1). Add an action below (When … → Next row) to step it from a key, a beat or a note.')}
      {f.row('Jump', (
        <>
          <Button size="sm" variant="ghost" onClick={() => ctx.act('shuffle')}>Random</Button>
          <GoTo n={n} style={f.numStyle} onGo={k => ctx.act('goto', k)} />
        </>
      ), 'Random: another row (or page). Go: row N, counting from 1.')}
    </Section>
  );

  // ── Text ─────────────────────────────────────────────────────────────────
  if (result?.kind === 'text') {
    return (
      <>
        {datasetSection}
        <Section kind="data" title="Split" hint="How the text is cut into the chunks the layer steps through.">
          {f.seg('Into', 'split', [
            { value: 'lines', label: 'Lines' }, { value: 'separator', label: 'Separator' }, { value: 'words', label: 'Words' }, { value: 'letters', label: 'Letters' }, { value: 'chunks', label: 'Chunks', title: 'Pieces of a fixed number of characters' },
          ], 'Lines: each line. Separator: split where a character or word appears (\\n is a new line). Words: split on spaces. Letters: each character. Chunks: pieces of N characters.')}
          {l.split === 'separator' && f.row('Separator', <SeparatorField value={l.separator} onCommit={separator => set({ separator })} />)}
          {l.split === 'chunks' && f.row('Size', <NumberInput value={l.chunkSize} min={1} max={10000} step={1} title="Characters per chunk" onCommit={v => set({ chunkSize: Math.max(1, Math.round(v)) })} style={f.numStyle} />, 'Characters per chunk.')}
          {f.seg('Order', 'order', [
            { value: 'text', label: 'As written' }, { value: 'frequency', label: 'Most frequent', title: 'Each chunk once, the most frequent first' }, { value: 'alphabetical', label: 'A to Z', title: 'Each chunk once, in alphabetical order' },
          ], 'As written keeps every chunk in order. Most frequent and A to Z list each chunk once (words are compared without case or the punctuation around them).')}
          {f.toggle('Counts', 'counts', 'Show how often each occurs', 'Writes “sea · 4” after each chunk: how many times it occurs in the whole text.')}
          <TopWords result={result} l={l} />
        </Section>
        {stepping}
        <Section kind="data" title="Text style" hint="The Text layer's style.">
          {f.prop('textSize')}
          {f.colour('Colour', 'textColor')}
          <FontRow f={f} />
          {f.seg('Matte', 'matte', MATTES, 'Over: drawn on top with a blend mode. Reveal: the picture shows only inside the letters. Luma: the picture\'s brightness sets the text\'s transparency.')}
          {l.matte === 'over' && f.select('Blend', 'blend', BLENDS, BLEND_HINT)}
          {l.matte === 'reveal' && f.colour('Backdrop', 'color', 'The colour around the letters.')}
          {f.prop('opacity')}
        </Section>
        <Section kind="data" title="Place">
          {f.seg('Fit', 'fit', [{ value: 'picture', label: 'Picture' }, { value: 'region', label: 'Region' }], 'Picture: centred, as wide as the picture. Region: in a box you move and size on the picture (the text wraps to its width).')}
          {l.fit === 'region' && <>{f.props('x', 'y', 'w', 'h')}{f.note('Drag the box on the picture, or pull its edges.')}</>}
        </Section>
      </>
    );
  }

  if (!result || result.kind !== 'table') {
    return <>{datasetSection}{!list.length && f.note('A Data layer draws a table (points, a path, bars, a pie, lines) or text a word or a line at a time. Bring in a CSV, JSON or text file, or try a sample.')}</>;
  }

  // ── Table ────────────────────────────────────────────────────────────────
  const view = l.view;
  const xy = view === 'points' || view === 'path';
  return (
    <>
      {datasetSection}
      <Section kind="data" title="View">
        {f.seg('View', 'view', VIEWS)}
        {f.note(VIEW_HINT[view])}
        {xy && <>{col('X', 'xCol', { hint: 'The column across.' })}{col('Y', 'yCol', { hint: 'The column up.' })}</>}
        {!xy && col(view === 'lines' ? 'Series' : 'Name', 'categoryCol', { none: view === 'lines' ? 'One line' : 'Row number', hint: view === 'lines' ? 'A line for each of this column\'s values (a line per city). None: one line through every row.' : 'What each bar or slice is called.' })}
        {!xy && col('Value', 'valueCol', { onlyNumbers: true, hint: view === 'pie' ? 'The slice sizes.' : 'The heights.' })}
        {view === 'points' && <>
          {col('Size', 'sizeCol', { none: 'None', hint: 'Bigger values, bigger marks (from Smallest to Largest).' })}
          {col('Opacity', 'opacityCol', { none: 'None', hint: 'Bigger values, more solid marks.' })}
          {col('Rotation', 'rotationCol', { none: 'None', onlyNumbers: true, hint: 'Degrees. Shows on squares and triangles.' })}
        </>}
        {(view === 'points' || view === 'path') && col('Label', 'labelCol', { none: 'None', hint: 'Text next to each point (the first 5,000).' })}
        {col('Caption', 'captionCol', { none: 'None', hint: 'The current row\'s value of this column, written above the view: the month, the city, the stop.' })}
      </Section>
      {view !== 'pie' && (
        <Section kind="data" title="Axes">
          {f.seg('Axes', 'axes', [{ value: 'centred', label: 'Centred', title: '0,0 in the middle; each axis runs −1 to 1' }, { value: 'corner', label: 'Corner', title: '0,0 bottom-left; each axis runs from its smallest value to its largest' }],
            'Centred: 0,0 is the middle and each axis runs −1 to 1. Corner: 0,0 is the bottom-left corner and each axis runs from its smallest value to its largest.')}
          {l.axes === 'centred' && f.seg('Centre on', 'centre', [{ value: 'range', label: 'The middle', title: 'Smallest value at −1, largest at 1' }, { value: 'zero', label: 'Zero', title: 'Symmetric around 0' }],
            'The middle: the smallest value sits at −1 and the largest at 1. Zero: 0 sits in the middle, so positive and negative values mirror.')}
          {xy && f.toggle('Same scale', 'equal', 'Keep the shape', 'A unit across is as long as a unit up, so a map or a route keeps its proportions on any picture shape.')}
          {f.toggle('Lines', 'axisLine', 'Axis lines')}
          {f.toggle('Grid', 'grid', 'Grid lines')}
          {f.toggle('Numbers', 'ticks', 'Tick marks and numbers')}
        </Section>
      )}
      <Section kind="data" title="Place">
        {f.seg('Fit', 'fit', [{ value: 'picture', label: 'Picture' }, { value: 'region', label: 'Region' }], 'Picture: the view fills the picture (with a margin). Region: a box you move and size on the picture.')}
        {l.fit === 'region' && <>{f.props('x', 'y', 'w', 'h')}{f.note('Drag the box on the picture, or pull its edges.')}</>}
      </Section>
      {stepping}
      <Section kind="data" title="Look">
        {view === 'points' && <>
          {f.seg('Mark', 'mark', [{ value: 'dot', label: 'Dot' }, { value: 'square', label: 'Square' }, { value: 'triangle', label: 'Triangle' }])}
          {l.sizeCol ? f.props('sizeMin', 'sizeMax') : f.prop('size')}
        </>}
        {(view === 'path' || view === 'lines') && f.props('lineWidth', 'trim')}
        {f.seg('Colour', 'colour', [
          { value: 'tint', label: 'One' }, { value: 'palette', label: 'Palette', title: 'One column (or the row order) through a palette' }, { value: 'rgb', label: 'RGB', title: 'Three columns as red, green and blue' },
        ], 'One: a single colour. Palette: a column\'s values (or the rows in order) through a palette. RGB: three columns, 0–1 or 0–255.')}
        {l.colour === 'tint' && f.colour('Tint', 'color')}
        {l.colour === 'palette' && <>{f.palette()}{view !== 'lines' && col('By', 'colourCol', { none: 'Row order', hint: 'The column whose values pick the colours.' })}</>}
        {l.colour === 'rgb' && <>{col('Red', 'rCol', { onlyNumbers: true })}{col('Green', 'gCol', { onlyNumbers: true })}{col('Blue', 'bCol', { onlyNumbers: true })}</>}
        {f.toggle('Current', 'highlight', 'Mark the current row', 'With Show all or a range: the current row stands out and the rest dim (a path: a ring on it).')}
        {f.prop('opacity')}
        {f.select('Blend', 'blend', BLENDS, BLEND_HINT)}
      </Section>
      <Section kind="data" title="Labels" on={l.labels} onToggle={labels => set({ labels })} hint="Names, values and axis numbers, in the layer's text style.">
        {f.prop('labelSize')}
        {f.colour('Colour', 'textColor')}
        <FontRow f={f} />
      </Section>
    </>
  );
}

/** A separator typed in; kept on blur or Enter (typing a comma shouldn't redraw on every key). */
function SeparatorField({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  if (value !== seen) { setSeen(value); setDraft(value); }
  const commit = () => { if (draft !== value) onCommit(draft); };
  return <Field value={draft} onChange={e => setDraft(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') commit(); }} placeholder=", or ; or \n" height={26} style={{ width: 110 }} aria-label="Separator" />;
}

/** Go to row N (counting from 1). */
function GoTo({ n, style, onGo }: { n: number; style: React.CSSProperties; onGo: (k: number) => void }) {
  const [k, setK] = useState(1);
  return (
    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
      <NumberInput value={k} min={1} max={n} step={1} title="Row to go to, counting from 1" onCommit={v => setK(Math.max(1, Math.min(n, Math.round(v))))} style={{ ...style, width: 48 }} />
      <Button size="sm" onClick={() => onGo(k)}>Go to row</Button>
    </span>
  );
}

/** The most frequent chunks, for a sense of the text (a few, with their counts). */
function TopWords({ result, l }: { result: DatasetResult; l: DataLayer }) {
  const top = kdTextItems(result, { ...l, order: 'frequency' });
  if (top.items.length < 2) return null;
  const shown = top.items.slice(0, 8).map((w, i) => `${w} ×${top.counts[i]}`).join(' · ');
  return <div style={{ margin: '6px 0 0 68px', color: 'inherit', opacity: 0.7, font: '11px/1.45 Inter, system-ui, sans-serif', overflowWrap: 'anywhere' }}>Most frequent: {shown}</div>;
}
