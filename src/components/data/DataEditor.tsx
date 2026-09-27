/**
 * The Data node's editor: a window (a sheet on phones), like the expression,
 * function and keyframe editors. Import a file (picker or drop), shape it in
 * the notebook, check the table, choose how the node uses it.
 *
 * The notebook runs in a worker as you type (after a short pause) and on
 * ⌘/Ctrl+Enter; a successful run replaces the dataset's frozen result, which
 * the node's textures follow without a shader rebuild.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import type { GraphNode } from '../../types/nodeGraph';
import { Modal } from '../ui/Modal';
import { Sheet } from '../ui/Sheet';
import { Button, IconButton } from '../ui/Button';
import { Segmented } from '../ui/Choice';
import { Field } from '../ui/Field';
import { Icon } from '../ui/Icon';
import { Menu, type MenuItem } from '../ui/Menu';
import { Select } from '../ui/Select';
import { toast } from '../ui/toastStore';
import { askConfirm, askText } from '../ui/dialogStore';
import { ScriptReferenceList } from '../play/layers/ScriptPanels';
import { DATA_REFERENCE } from '../../data/dataReference';
import { datasetFromText, readDataFile, runDatasetNotebook } from '../../data/datasetActions';
import { SAMPLE_FILES } from '../../data/samples';
import { normalizeTable } from '../../data/normalize';
import type { CellOutput } from '../../data/notebook';
import type { ParseInfo } from '../../data/parse';
import { formatFor } from '../../data/parse';
import type { Dataset, HeaderMode, NotebookCell } from '../../data/types';
import { dataDataset, dataSockets } from '../../nodes/definitions/data';
import { DataNotebook } from './DataNotebook';
import { DataPreview } from './DataPreview';
import { DataOutputsPanel } from './DataOutputsPanel';
import { defaultOutputs } from './dataUi';
import { dataCompletions } from './dataCompletions';

type Side = 'table' | 'outputs' | 'reference';
type PhoneTab = 'notebook' | Side;

const RUN_DELAY_MS = 600;
const ACCEPT = '.csv,.tsv,.tab,.json,.geojson,.txt,.md,text/csv,application/json,text/plain';

function useNarrow(px: number): boolean {
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth < px);
  useEffect(() => {
    const on = () => setNarrow(window.innerWidth < px);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, [px]);
  return narrow;
}

function pickFile(): Promise<File | null> {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = ACCEPT;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

export function DataEditor({ node, onClose }: { node: GraphNode; onClose: () => void }) {
  const tk = useTokens();
  const narrow = useNarrow(820);
  const { datasets, setDataset, updateDataset, removeDataset, updateNodeParams, disconnectOutput } = useNodeGraphStore(useShallow(s => ({
    datasets: s.datasets, setDataset: s.setDataset, updateDataset: s.updateDataset, removeDataset: s.removeDataset,
    updateNodeParams: s.updateNodeParams, disconnectOutput: s.disconnectOutput,
  })));
  const dsId = dataDataset(node);
  const ds: Dataset | undefined = dsId ? datasets[dsId] : undefined;

  const [side, setSide] = useState<Side>('table');
  const [phoneTab, setPhoneTab] = useState<PhoneTab>('notebook');
  const [filter, setFilter] = useState('');
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [dragging, setDragging] = useState(false);

  // ── Running ──────────────────────────────────────────────────────────────
  const [cellOut, setCellOut] = useState<Record<string, CellOutput>>({});
  const [info, setInfo] = useState<ParseInfo | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const runSeq = useRef(0);
  const timer = useRef(0);

  /** Run the dataset's notebook; `write` keeps a successful result as the dataset's. */
  const run = useCallback(async (id: string, write: boolean) => {
    const d = useNodeGraphStore.getState().datasets[id];
    if (!d) return;
    const seq = ++runSeq.current;
    setRunning(true);
    const out = await runDatasetNotebook(d);
    if (seq !== runSeq.current) return;
    setRunning(false);
    setInfo(out.info);
    setParseError(out.parseError ?? null);
    // A failed cell shows its own error; this is for a result that can't be kept (a function, a cycle).
    setRunError(out.run?.error && out.run.cells.every(c => c.ok) ? out.run.error : null);
    setCellOut(Object.fromEntries((out.run?.cells ?? []).map(c => [c.id, c])));
    if (write && out.run?.result) useNodeGraphStore.getState().updateDataset(id, { result: out.run.result, ranAt: Date.now() });
  }, []);
  const scheduleRun = useCallback((id: string) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { void run(id, true); }, RUN_DELAY_MS);
  }, [run]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  // Opening (or switching to) a dataset shows its cells' outputs; a dataset with no result yet gets one.
  useEffect(() => {
    if (!dsId) return;
    const t = window.setTimeout(() => {
      const d = useNodeGraphStore.getState().datasets[dsId];
      if (d) void run(dsId, !d.result);
    }, 0);
    return () => window.clearTimeout(t);
  }, [dsId, run]);

  // ── The node ─────────────────────────────────────────────────────────────
  /** Change the node's settings; wires out of outputs that go away or change type are removed first. */
  const applyNode = useCallback((patch: Record<string, unknown>) => {
    const next = { ...node, params: { ...node.params, ...patch } };
    const want = dataSockets(next).outputs;
    for (const [k, s] of Object.entries(node.outputs)) if (!want[k] || want[k].type !== s.type) disconnectOutput(node.id, k);
    updateNodeParams(node.id, patch, { immediate: true });
  }, [node, updateNodeParams, disconnectOutput]);

  const effective = useMemo(() => (ds?.result?.kind === 'table' ? (ds.normalize ? normalizeTable(ds.result) : ds.result) : null), [ds]);
  const columns = useMemo(() => effective?.columns ?? [], [effective]);
  const completions = useMemo(() => dataCompletions(columns.map(c => c.name)), [columns]);

  // A node picking up its first table gets outputs to start from.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !effective || !dsId) return;
    seeded.current = true;
    const hasAny = Array.isArray(node.params.outputs) && (node.params.outputs as unknown[]).length > 0;
    if (!hasAny && node.params.mode !== 'points') applyNode({ outputs: defaultOutputs(effective.columns) });
  }, [effective, dsId, node.params.outputs, node.params.mode, applyNode]);

  // ── Datasets ─────────────────────────────────────────────────────────────
  const adopt = useCallback((d: Dataset) => {
    setDataset(d);
    seeded.current = false;
    applyNode({ dataset: d.id });
    void run(d.id, true);
    setSide('table');
    setPhoneTab('notebook');
  }, [setDataset, applyNode, run]);

  const importFile = useCallback(async (file: File | null, replace: boolean) => {
    if (!file) return;
    try {
      const { filename, text } = await readDataFile(file);
      if (replace && ds) {
        updateDataset(ds.id, { source: { kind: 'file', format: formatFor(filename, text), filename, text, ...(ds.source.kind === 'file' && ds.source.header ? { header: ds.source.header } : {}) } });
        void run(ds.id, true);
        toast.success(`Replaced with ${filename}`, { message: 'The notebook ran again on the new file.' });
      } else {
        adopt(datasetFromText({ filename, text }, Object.keys(useNodeGraphStore.getState().datasets)));
      }
    } catch (e) {
      toast.error('Couldn’t import that file', { message: e instanceof Error ? e.message : String(e) });
    }
  }, [ds, updateDataset, run, adopt]);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) void importFile(f, false);
  };
  const dropProps = {
    onDragOver: (e: React.DragEvent) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragging(true); } },
    onDragLeave: (e: React.DragEvent) => { if (e.currentTarget === e.target) setDragging(false); },
    onDrop,
  };

  const setCells = (cells: NotebookCell[]) => { if (!ds) return; updateDataset(ds.id, { cells }); scheduleRun(ds.id); };
  const setHeader = (h: HeaderMode) => {
    if (!ds || ds.source.kind !== 'file') return;
    const { header: _drop, ...rest } = ds.source;
    void _drop;
    updateDataset(ds.id, { source: h === 'auto' ? rest : { ...rest, header: h } });
    void run(ds.id, true);
  };
  const rename = async () => {
    if (!ds) return;
    const name = await askText('Rename dataset', { label: 'Name', initial: ds.name, confirmLabel: 'Rename' });
    if (name?.trim()) updateDataset(ds.id, { name: name.trim() });
  };
  const remove = async () => {
    if (!ds) return;
    const users = countUsers(useNodeGraphStore.getState().nodes, ds.id);
    const ok = await askConfirm(`Remove “${ds.name}”?`, { message: `The file, its notebook and its result leave this graph.${users > 1 ? ` ${users} Data nodes read it; they will read nothing.` : ''}`, confirmLabel: 'Remove', danger: true });
    if (!ok) return;
    applyNode({ dataset: '' });
    removeDataset(ds.id);
  };

  const list = Object.values(datasets);
  const openMenu = (e: React.MouseEvent, items: MenuItem[]) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setMenu({ x: r.left, y: r.bottom + 6, items }); };
  const moreMenu = (): MenuItem[] => [
    { label: 'Import another file…', icon: 'import', onSelect: () => { void pickFile().then(f => importFile(f, false)); } },
    { label: 'Replace this file…', icon: 'import', disabled: !ds, onSelect: () => { void pickFile().then(f => importFile(f, true)); } },
    { label: 'Rename dataset…', icon: 'edit', disabled: !ds, onSelect: () => { void rename(); } },
    'separator',
    { label: 'Remove dataset', icon: 'trash', danger: true, disabled: !ds, onSelect: () => { void remove(); } },
  ];

  const summary = ds?.result
    ? ds.result.kind === 'table' ? `${ds.result.rows.toLocaleString()} rows × ${ds.result.columns.length} columns` : ds.result.kind === 'text' ? 'Text' : 'JSON value'
    : 'Not run yet';
  const status = running ? 'Running…' : parseError ? 'The file didn’t read' : Object.values(cellOut).some(c => !c.ok) ? 'A cell stopped: the dataset keeps its last result' : ds ? `Ready · ${summary}${ds.normalize ? ' · normalized' : ''}` : '';

  // ── Pieces ───────────────────────────────────────────────────────────────
  // Only worth showing when there is a choice (the title already names the one there is).
  const datasetPicker = list.length > 1 && (
    <Select ariaLabel="Dataset" value={dsId} onChange={v => { if (v) { seeded.current = false; applyNode({ dataset: v }); } }} style={{ width: narrow ? '100%' : 200 }}
      options={[...(dsId ? [] : [{ value: '', label: 'Choose a dataset' }]), ...list.map(d => ({ value: d.id, label: d.name }))]} />
  );

  const empty = (
    <div {...dropProps} style={{ height: narrow ? undefined : '100%', boxSizing: 'border-box', overflow: 'auto', padding: narrow ? 0 : 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: '100%', maxWidth: 560, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center', padding: '32px 20px', borderRadius: radius.card,
          border: `1.5px dashed ${dragging ? tk.accent.base : tk.border.strong}`, background: dragging ? alpha(tk.accent.base, 0.06) : tk.bg.panel,
        }}>
          <span style={{ width: 44, height: 44, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', background: alpha(tk.accent.base, 0.1), color: tk.accent.base }}><Icon name="import" size={20} /></span>
          <b style={{ fontSize: 15 }}>Bring in a data file</b>
          <span style={{ fontSize: 12.5, color: tk.text.muted, lineHeight: 1.5, maxWidth: 420 }}>
            Drop a CSV, TSV, JSON or text file here, or choose one. It’s saved inside this graph, so it travels with it.
          </span>
          <Button variant="primary" icon="import" onClick={() => { void pickFile().then(f => importFile(f, false)); }}>Choose a file</Button>
        </div>
        {list.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', color: tk.text.faint, textTransform: 'uppercase' }}>In this graph</span>
            {list.map(d => (
              <RowButton key={d.id} icon="grid" title={d.name} detail={d.result?.kind === 'table' ? `${d.result.rows} rows · ${d.result.columns.map(c => c.name).join(', ')}` : d.result?.kind ?? 'not run yet'} onClick={() => { seeded.current = false; applyNode({ dataset: d.id }); }} />
            ))}
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', color: tk.text.faint, textTransform: 'uppercase' }}>Or try a sample</span>
          {SAMPLE_FILES.map(s => (
            <RowButton key={s.filename} icon="star" title={s.name} detail={s.what} onClick={() => adopt(datasetFromText({ filename: s.filename, text: s.text(), format: s.format, name: s.name }, Object.keys(useNodeGraphStore.getState().datasets)))} />
          ))}
        </div>
      </div>
    </div>
  );

  const notebook = ds && (
    <DataNotebook dataset={ds} cellOut={cellOut} info={info} parseError={parseError} runError={runError} running={running} completions={completions}
      onCells={setCells} onHeader={setHeader} onReplaceFile={() => { void pickFile().then(f => importFile(f, true)); }} onRun={() => { window.clearTimeout(timer.current); void run(ds.id, true); }} />
  );
  const preview = ds && <DataPreview dataset={ds} onNormalize={on => updateDataset(ds.id, { normalize: on })} />;
  const outputs = <DataOutputsPanel node={node} columns={columns} onChange={applyNode} />;
  const reference = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Field leading={<Icon name="search" size={15} style={{ color: tk.text.faint }} />} placeholder="Filter the reference…" aria-label="Filter the reference" value={filter} onChange={e => setFilter(e.target.value)} height={30} style={{ background: tk.bg.panel, boxShadow: `inset 0 0 0 1px ${tk.border.default}` }} />
      <ScriptReferenceList query={filter} reference={DATA_REFERENCE} onInsert={text => {
        if (!ds) return;
        const cells = ds.cells.length ? ds.cells : [];
        const last = cells[cells.length - 1];
        setCells(last && !last.code.trim() ? cells.map(c => (c.id === last.id ? { ...c, code: text } : c)) : [...cells, { id: `c${Date.now().toString(36)}`, code: text }]);
      }} />
    </div>
  );

  const runButton = ds && (
    <Button size={narrow ? 'sm' : 'md'} variant="secondary" icon="play" disabled={running} onClick={() => { window.clearTimeout(timer.current); void run(ds.id, true); }} title="Run every cell again (⌘/Ctrl+Enter in a cell)">Run all</Button>
  );

  // ── Phone: a sheet with tabs ─────────────────────────────────────────────
  if (narrow) {
    return (
      <Sheet title={ds ? ds.name : 'Data'} onClose={onClose} maxHeight="92dvh"
        headerExtra={<IconButton icon="more" label="Dataset actions" tooltip={false} onClick={e => openMenu(e, moreMenu())} style={{ width: 40, height: 40 }} />}>
        <div {...dropProps} style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
          {datasetPicker}
          {ds ? (<>
            <Segmented fill value={phoneTab} onChange={setPhoneTab} ariaLabel="Editor section" options={[
              { value: 'notebook', label: 'Notebook' }, { value: 'table', label: 'Table' }, { value: 'outputs', label: 'Outputs' }, { value: 'reference', label: 'Help' },
            ]} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: parseError || Object.values(cellOut).some(c => !c.ok) ? tk.status.danger : tk.text.muted }}>{status}</span>
              {phoneTab === 'notebook' && runButton}
            </div>
            {phoneTab === 'notebook' && notebook}
            {phoneTab === 'table' && preview}
            {phoneTab === 'outputs' && outputs}
            {phoneTab === 'reference' && reference}
          </>) : empty}
        </div>
        {menu && <Menu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      </Sheet>
    );
  }

  // ── Desktop: a window ────────────────────────────────────────────────────
  const tabs = (
    <Segmented size="sm" fill ariaLabel="Side panel" value={side} onChange={setSide} options={[
      { value: 'table', label: 'Table' }, { value: 'outputs', label: 'Outputs' }, { value: 'reference', label: 'Reference' },
    ]} />
  );
  return (
    <Modal
      title="Data"
      subtitle={ds ? `${ds.name} · ${summary}` : 'Import a file to read it in the shader'}
      icon="grid"
      width={1180}
      height={820}
      onClose={onClose}
      headerActions={<>
        {datasetPicker}
        <IconButton icon="more" label="Dataset actions" onClick={e => openMenu(e, moreMenu())} />
      </>}
      footer={ds ? <>
        <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: parseError || Object.values(cellOut).some(c => !c.ok) ? tk.status.danger : tk.text.faint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{status}</span>
        {runButton}
        <Button variant="primary" onClick={onClose}>Done</Button>
      </> : undefined}
    >
      {ds ? (
        <div {...dropProps} style={{ display: 'flex', height: '100%', minHeight: 0, position: 'relative' }}>
          <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: 16 }}>{notebook}</div>
          <div style={{ width: 420, flexShrink: 0, display: 'flex', flexDirection: 'column', minHeight: 0, background: tk.bg.subtle, borderLeft: `1px solid ${tk.border.subtle}` }}>
            <div style={{ padding: '12px 14px 8px' }}>{tabs}</div>
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '4px 14px 16px' }}>
              {side === 'table' && preview}
              {side === 'outputs' && outputs}
              {side === 'reference' && reference}
            </div>
          </div>
          {dragging && <DropVeil />}
        </div>
      ) : empty}
      {menu && <Menu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </Modal>
  );
}

function countUsers(nodes: GraphNode[], id: string): number {
  let n = 0;
  const walk = (list: GraphNode[]) => {
    for (const x of list) {
      if (x.type === 'data' && x.params.dataset === id) n++;
      const sg = x.params.subgraph as { nodes?: GraphNode[] } | undefined;
      if (sg?.nodes) walk(sg.nodes);
    }
  };
  walk(nodes);
  return n;
}

function RowButton({ icon, title, detail, onClick }: { icon: 'grid' | 'star'; title: string; detail: ReactNode; onClick: () => void }) {
  const tk = useTokens();
  const [hover, setHover] = useState(false);
  return (
    <button type="button" onClick={onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: radius.lg, border: 0, textAlign: 'left', cursor: 'pointer', background: hover ? tk.bg.hover : tk.bg.panel, boxShadow: `inset 0 0 0 1px ${tk.border.subtle}`, color: tk.text.primary, font: `12.5px ${fontFamily.ui}` }}>
      <Icon name={icon} size={16} style={{ color: tk.text.faint, flexShrink: 0 }} />
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
        <b style={{ fontWeight: 600 }}>{title}</b>
        <span style={{ fontSize: 11.5, color: tk.text.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{detail}</span>
      </span>
      <Icon name="chevR" size={14} style={{ color: tk.text.faint }} />
    </button>
  );
}

function DropVeil() {
  const tk = useTokens();
  return (
    <div style={{ position: 'absolute', inset: 10, borderRadius: radius.card, border: `2px dashed ${tk.accent.base}`, background: alpha(tk.accent.base, 0.08), display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', color: tk.accent.text, fontWeight: 650, fontSize: 14 }}>
      Drop to import it as a new dataset
    </div>
  );
}
