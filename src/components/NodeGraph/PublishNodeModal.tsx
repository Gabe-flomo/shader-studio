/**
 * PublishNodeModal — turn a group node into a first-class node type.
 *
 * The group's ports become the node's sockets (float inputs can carry a
 * slider default), and any float slider inside the group can be promoted to
 * a live param. Everything else is baked into the flattened GLSL function.
 */
import { useMemo, useState } from 'react';
import type { GraphNode, DataType } from '../../types/nodeGraph';
import { USER_NODE_DEFAULT_CATEGORY } from '../../types/userNode';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { getAllCategories } from '../../nodes/definitions';
import { collectParamCandidates, keyFromLabel, type ParamCandidate } from '../../nodes/userNodes/paramCandidates';
import { findUnsupportedNode } from '../../compiler/flattenSubgraph';
import { sourceSubgraph, type PublishPortSpec, type PublishParamSpec, type PublishSource } from '../../nodes/userNodes/publishUserNode';
import { getUserNode } from '../../nodes/userNodes/userNodeRegistry';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Field } from '../ui/Field';
import { Select } from '../ui/Select';
import { Toggle } from '../ui/Choice';
import { Callout } from '../ui/Callout';
import { NumberInput } from './NumberInput';
import { TYPE_COLORS } from './typeColors';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { toast } from '../ui/toastStore';

interface Props {
  /** A group node on the canvas, or a subgraph prepared from a whole graph. */
  source: PublishSource;
  onClose: () => void;
  /** Called with the new definition id after a successful publish. */
  onPublished?: (id: string) => void;
}

interface PortRow {
  portKey: string;
  type: DataType;
  label: string;
  slider: boolean;
  min: number;
  max: number;
  default: number;
}

interface ParamRow extends ParamCandidate {
  enabled: boolean;
  label: string;
  min: number;
  max: number;
  default: number;
}

function TypeDot({ type }: { type: string }) {
  const tk = useTokens();
  return <span style={{ width: 9, height: 9, borderRadius: '50%', flexShrink: 0, background: TYPE_COLORS[type] ?? tk.text.faint }} />;
}

export function PublishNodeModal({ source, onClose, onPublished }: Props) {
  const tk = useTokens();
  const publishUserNode = useNodeGraphStore(s => s.publishUserNode);
  const { subgraph, label: sourceLabel } = sourceSubgraph(source);
  const groupNode: GraphNode | null = source.kind === 'group' ? source.node : null;

  // A group placed from "Edit source" remembers which definition it came from,
  // so publishing again updates that node type instead of creating a new one.
  const sourceId = typeof groupNode?.params.__userNodeId === 'string' ? groupNode.params.__userNodeId : undefined;
  const existing = sourceId ? getUserNode(sourceId) : undefined;

  const [label, setLabel] = useState(existing?.label ?? sourceLabel ?? 'My Node');
  const [category, setCategory] = useState(existing?.category ?? USER_NODE_DEFAULT_CATEGORY);
  const [description, setDescription] = useState(existing?.description ?? '');
  const [replace, setReplace] = useState(!!existing);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const categories = useMemo(() => {
    const all = new Set(getAllCategories());
    all.add(USER_NODE_DEFAULT_CATEGORY);
    if (existing) all.add(existing.category);
    return Array.from(all).sort((a, b) => (a === USER_NODE_DEFAULT_CATEGORY ? -1 : b === USER_NODE_DEFAULT_CATEGORY ? 1 : a.localeCompare(b)));
  }, [existing]);

  const [inputs, setInputs] = useState<PortRow[]>(() =>
    (subgraph?.inputPorts ?? []).map(p => {
      const prev = existing?.inputs.find(i => i.label === p.label && i.type === p.type);
      return {
        portKey: p.key, type: p.type, label: p.label,
        slider: !!prev?.slider,
        min: prev?.slider?.min ?? 0, max: prev?.slider?.max ?? 1, default: prev?.slider?.default ?? 0,
      };
    }),
  );
  const [outputs, setOutputs] = useState<PortRow[]>(() =>
    (subgraph?.outputPorts ?? []).map(p => ({ portKey: p.key, type: p.type, label: p.label, slider: false, min: 0, max: 1, default: 0 })),
  );
  const [params, setParams] = useState<ParamRow[]>(() =>
    (subgraph ? collectParamCandidates(subgraph) : []).map(c => {
      const prev = existing?.params.find(p => p.sourcePath === c.sourcePath);
      return { ...c, enabled: !!prev, label: prev?.label ?? c.paramLabel, min: prev?.min ?? c.min, max: prev?.max ?? c.max, default: prev?.default ?? c.value };
    }),
  );

  const unsupported = useMemo(() => (subgraph ? findUnsupportedNode(subgraph) : null), [subgraph]);
  const enabledParams = params.filter(p => p.enabled);

  const signaturePreview = useMemo(() => {
    const taken = new Set<string>();
    const args = [
      ...inputs.map(i => `${i.type} ${keyFromLabel(i.label, taken, 'input')}`),
      ...enabledParams.map(p => `float ${keyFromLabel(p.label, taken, p.paramKey)}`),
    ];
    const ret = outputs[0]?.type ?? 'void';
    return `${ret} ${label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_') || 'node'}(${args.join(', ')})`;
  }, [inputs, enabledParams, outputs, label]);

  const updateInput = (i: number, patch: Partial<PortRow>) => setInputs(rows => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const updateOutput = (i: number, patch: Partial<PortRow>) => setOutputs(rows => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const updateParam = (i: number, patch: Partial<ParamRow>) => setParams(rows => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const publish = async () => {
    if (busy) return;
    setError(null);
    const taken = new Set<string>();
    const inputSpecs: PublishPortSpec[] = inputs.map(i => ({
      portKey: i.portKey, type: i.type, label: i.label.trim() || i.portKey,
      key: keyFromLabel(i.label, taken, 'input'),
      slider: i.type === 'float' && i.slider ? { min: i.min, max: i.max, default: i.default } : null,
    }));
    const paramSpecs: PublishParamSpec[] = enabledParams.map(p => ({
      sourcePath: p.sourcePath, label: p.label.trim() || p.paramLabel,
      key: keyFromLabel(p.label, taken, p.paramKey),
      min: p.min, max: p.max, step: p.step, default: p.default, hint: p.hint,
    }));
    const outputSpecs: PublishPortSpec[] = outputs.map(o => ({
      portKey: o.portKey, type: o.type, label: o.label.trim() || o.portKey,
      key: keyFromLabel(o.label, taken, 'output'),
    }));
    setBusy(true);
    const result = await publishUserNode(groupNode ? groupNode.id : source, {
      label, category, description,
      inputs: inputSpecs, outputs: outputSpecs, params: paramSpecs,
      existingId: replace && existing ? existing.id : undefined,
    });
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    toast.success(replace && existing ? `Updated "${label.trim()}"` : `Published "${label.trim()}"`, { message: 'Find it under Nodes → ' + category + ', or search for it.' });
    onPublished?.(existing && replace ? existing.id : '');
    onClose();
  };

  const sectionTitle = (text: string, hint?: string) => (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 6 }}>
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: tk.text.muted }}>{text}</span>
      {hint && <span style={{ fontSize: 11.5, color: tk.text.faint }}>{hint}</span>}
    </div>
  );

  const rowStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 8, minHeight: 36, padding: '4px 10px', borderRadius: radius.md, background: tk.bg.subtle,
  };
  const numStyle: React.CSSProperties = {
    width: 62, height: 28, border: 0, outline: 'none', borderRadius: radius.sm, padding: '0 8px', textAlign: 'right',
    background: tk.bg.field, color: tk.text.primary, font: `500 12px ${fontFamily.mono}`,
  };
  const miniLabel = (t: string) => <span style={{ fontSize: 10.5, color: tk.text.faint, fontFamily: fontFamily.mono }}>{t}</span>;

  const canPublish = !!subgraph && !unsupported && outputs.length > 0 && label.trim().length > 0 && !busy;

  return (
    <Modal
      title={existing ? 'Update node type' : 'Publish as node'}
      subtitle={`From ${source.kind === 'group' ? 'group' : 'graph'} "${sourceLabel}" · ${subgraph?.nodes.length ?? 0} nodes flatten into one GLSL function`}
      icon="spark"
      iconColor={tk.kind.fn}
      width={720}
      onClose={onClose}
      footer={
        <>
          {existing && (
            <Toggle checked={replace} onChange={setReplace} label={`Replace "${existing.label}" (all placed instances update)`} />
          )}
          <span style={{ marginLeft: 'auto' }} />
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon="spark" disabled={!canPublish} onClick={publish}>{busy ? 'Publishing…' : replace && existing ? 'Update node' : 'Publish node'}</Button>
        </>
      }
    >
      <div style={{ padding: '14px 20px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {unsupported && (
          <Callout tone="warning" title="This group can't be published yet">
            “{(typeof unsupported.node.params.label === 'string' && unsupported.node.params.label) || unsupported.node.type}” {unsupported.reason}. Remove it from the group or feed that value in through an input port.
          </Callout>
        )}
        {outputs.length === 0 && !unsupported && (
          <Callout tone="warning" title="No output port">A node needs at least one output. Expose an output on the group first.</Callout>
        )}
        {error && <Callout title="Couldn't publish" details={error} onDismiss={() => setError(null)}>The group compiled with an error. The details show what the compiler said.</Callout>}

        {/* Identity */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 180px', gap: 8 }}>
          <Field autoFocus aria-label="Node name" placeholder="Node name" value={label} onChange={e => setLabel(e.target.value)} />
          <Select ariaLabel="Category" height={34} value={category} onChange={setCategory} options={categories.map(c => ({ value: c, label: c }))} />
        </div>
        <Field aria-label="Description" placeholder="What does it do? (shown in the node browser and search)" value={description} onChange={e => setDescription(e.target.value)} />

        {/* Inputs */}
        {sectionTitle('Inputs', 'group ports become sockets · a float input can carry a slider for when it’s unconnected')}
        {inputs.length === 0 && <div style={{ fontSize: 12, color: tk.text.faint, padding: '2px 10px' }}>No input ports. The node will only read time and UV from the graph.</div>}
        {inputs.map((row, i) => (
          <div key={row.portKey} style={rowStyle}>
            <TypeDot type={row.type} />
            <span style={{ fontFamily: fontFamily.mono, fontSize: 11.5, color: tk.text.muted, width: 38 }}>{row.type}</span>
            <Field aria-label={`Input ${i + 1} label`} height={28} value={row.label} onChange={e => updateInput(i, { label: e.target.value })} style={{ flex: 1 }} />
            {row.type === 'float' && (
              <>
                <Toggle checked={row.slider} onChange={v => updateInput(i, { slider: v })} label="Slider" />
                {row.slider && (
                  <>
                    {miniLabel('min')}<NumberInput value={row.min} onCommit={v => updateInput(i, { min: v })} style={numStyle} />
                    {miniLabel('max')}<NumberInput value={row.max} onCommit={v => updateInput(i, { max: v })} style={numStyle} />
                    {miniLabel('default')}<NumberInput value={row.default} onCommit={v => updateInput(i, { default: v })} style={numStyle} />
                  </>
                )}
              </>
            )}
          </div>
        ))}

        {/* Outputs */}
        {sectionTitle('Outputs', 'the first output is the function’s return value')}
        {outputs.map((row, i) => (
          <div key={row.portKey} style={rowStyle}>
            <TypeDot type={row.type} />
            <span style={{ fontFamily: fontFamily.mono, fontSize: 11.5, color: tk.text.muted, width: 38 }}>{row.type}</span>
            <Field aria-label={`Output ${i + 1} label`} height={28} value={row.label} onChange={e => updateOutput(i, { label: e.target.value })} style={{ flex: 1 }} />
          </div>
        ))}

        {/* Params */}
        {sectionTitle('Sliders', `${enabledParams.length} live · ${params.length - enabledParams.length} baked into the code`)}
        {params.length === 0 && <div style={{ fontSize: 12, color: tk.text.faint, padding: '2px 10px' }}>No sliders inside this group.</div>}
        {params.map((row, i) => (
          <div key={row.sourcePath} style={{ ...rowStyle, opacity: row.enabled ? 1 : 0.7 }}>
            <Toggle checked={row.enabled} onChange={v => updateParam(i, { enabled: v })} />
            <span style={{ fontSize: 11.5, color: tk.text.faint, width: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.groupLabel ? `${row.groupLabel} › ${row.nodeLabel}` : row.nodeLabel}>
              {row.groupLabel ? `${row.groupLabel} › ` : ''}{row.nodeLabel}
            </span>
            {row.enabled ? (
              <>
                <Field aria-label="Slider label" height={28} value={row.label} onChange={e => updateParam(i, { label: e.target.value })} style={{ flex: 1 }} />
                {miniLabel('min')}<NumberInput value={row.min} onCommit={v => updateParam(i, { min: v })} style={numStyle} />
                {miniLabel('max')}<NumberInput value={row.max} onCommit={v => updateParam(i, { max: v })} style={numStyle} />
                {miniLabel('default')}<NumberInput value={row.default} onCommit={v => updateParam(i, { default: v })} style={numStyle} />
              </>
            ) : (
              <span style={{ flex: 1, fontSize: 12, color: tk.text.secondary }}>
                {row.paramLabel} <span style={{ color: tk.text.faint, fontFamily: fontFamily.mono }}>= {row.value}</span>
                <span style={{ color: tk.text.faint }}> · baked</span>
              </span>
            )}
          </div>
        ))}

        {/* Signature preview */}
        <div style={{ marginTop: 4, padding: '10px 12px', borderRadius: radius.md, background: alpha(tk.kind.fn, 0.08), color: tk.text.secondary, font: `12px ${fontFamily.mono}`, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          <span style={{ color: tk.text.faint }}>// emitted once, called per instance{'\n'}</span>{signaturePreview}
        </div>
      </div>
    </Modal>
  );
}
