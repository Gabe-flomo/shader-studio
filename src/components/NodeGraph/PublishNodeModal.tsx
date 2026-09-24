/**
 * PublishNodeModal — turn a group, a whole graph, or hand-written GLSL into a
 * first-class node type.
 *
 * Ports become the node's sockets (float inputs can carry a slider default),
 * Texture Inputs / sampler2D parameters become image slots, any float slider
 * inside a group can be promoted to a live param, and everything else is baked
 * into the flattened GLSL function. A live preview compiles the node as you
 * edit, using a transient definition that is never listed or saved.
 */
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { GraphNode, DataType } from '../../types/nodeGraph';
import { USER_NODE_DEFAULT_CATEGORY } from '../../types/userNode';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { getAllCategories } from '../../nodes/definitions';
import { collectParamCandidates, keyFromLabel, type ParamCandidate } from '../../nodes/userNodes/paramCandidates';
import { findUnsupportedNode } from '../../compiler/flattenSubgraph';
import {
  sourceSubgraph, describeSource, buildUserNodeDefinition, CODE_RETURN_PORT,
  type PublishPortSpec, type PublishParamSpec, type PublishSource, type PublishTextureSpec, type PublishUserNodeSpec,
} from '../../nodes/userNodes/publishUserNode';
import { getUserNode, setTransientUserNode } from '../../nodes/userNodes/userNodeRegistry';
import { compileGraph } from '../../compiler/graphCompiler';
import { nodePreviewRenderer } from '../../lib/nodePreviewRenderer';
import { Modal } from '../ui/Modal';
import { Button, IconButton } from '../ui/Button';
import { Field } from '../ui/Field';
import { Select } from '../ui/Select';
import { Toggle } from '../ui/Choice';
import { Callout } from '../ui/Callout';
import { CodeField } from '../code/CodeField';
import { buildCompletions } from '../code/glslReference';
import { NumberInput } from './NumberInput';
import { TYPE_COLORS } from './typeColors';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { toast } from '../ui/toastStore';

interface Props {
  /** A group node on the canvas, a subgraph prepared from a whole graph, or GLSL code. */
  source: PublishSource;
  onClose: () => void;
  /** Called with the definition id after a successful publish. */
  onPublished?: (id: string) => void;
  /** Editing an existing node type (re-publish updates it in place). Group sources may also carry `params.__userNodeId`. */
  existingId?: string;
}

interface PortRow {
  portKey: string;
  type: DataType;
  label: string;
  slider: boolean;
  min: number;
  max: number;
  default: number;
  hint: string;
}

interface ParamRow extends ParamCandidate {
  enabled: boolean;
  label: string;
  min: number;
  max: number;
  default: number;
  hint: string;
}

interface TextureRow {
  sourceKey: string;
  label: string;
  hint: string;
}

const PREVIEW_ID = 'un_previewtmp'; // no double underscores: GLSL reserves them
const PREVIEW_SIZE = 144;

function TypeDot({ type }: { type: string }) {
  const tk = useTokens();
  return <span style={{ width: 9, height: 9, borderRadius: '50%', flexShrink: 0, background: TYPE_COLORS[type] ?? tk.text.faint }} />;
}

const STARTER_CODE = `// The entry function's signature is the node:
//   return value → first output · parameters → inputs · out params → more outputs
//   float params can carry a slider · sampler2D params become image slots
vec3 my_node(vec2 uv, float radius) {
    float d = length(uv) - radius;
    float glow = exp(-6.0 * max(d, 0.0));
    return vec3(glow);
}`;

export function PublishNodeModal({ source: initialSource, onClose, onPublished, existingId }: Props) {
  const tk = useTokens();
  const publishUserNode = useNodeGraphStore(s => s.publishUserNode);
  const groupNode: GraphNode | null = initialSource.kind === 'group' ? initialSource.node : null;
  const isCode = initialSource.kind === 'code';

  // A group placed from "Open source" remembers which definition it came from,
  // so publishing again updates that node type instead of creating a new one.
  const sourceId = existingId ?? (typeof groupNode?.params.__userNodeId === 'string' ? groupNode.params.__userNodeId : undefined);
  const existing = sourceId ? getUserNode(sourceId) : undefined;

  // ── Code source: the editor is live; ports re-derive from the parsed signature ──
  const [code, setCode] = useState(initialSource.kind === 'code' ? (initialSource.code || STARTER_CODE) : '');
  const [entry, setEntry] = useState<string | undefined>(initialSource.kind === 'code' ? initialSource.entry : undefined);
  const source: PublishSource = useMemo(
    () => (initialSource.kind === 'code' ? { kind: 'code', code, entry, label: initialSource.label } : initialSource),
    [initialSource, code, entry],
  );
  const { subgraph, label: sourceLabel, iterations: sourceIterations } = sourceSubgraph(source);
  const ports = useMemo(() => describeSource(source), [source]);
  const completions = useMemo(() => buildCompletions(ports.inputs.map(i => ({ name: i.portKey, type: i.type }))), [ports.inputs]);

  const [label, setLabel] = useState(existing?.label ?? (isCode ? (existing ? sourceLabel : 'My Node') : sourceLabel) ?? 'My Node');
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

  // ── Rows. Keyed by portKey so edits survive a re-parse of the code. ──────────
  const freshInput = (p: { portKey: string; type: DataType; label: string }): PortRow => {
    const prev = existing?.inputs.find(i => i.label === p.label && i.type === p.type);
    return {
      portKey: p.portKey, type: p.type, label: p.label,
      slider: !!prev?.slider,
      min: prev?.slider?.min ?? 0, max: prev?.slider?.max ?? 1, default: prev?.slider?.default ?? 0,
      hint: prev?.hint ?? '',
    };
  };
  const freshOutput = (p: { portKey: string; type: DataType; label: string }): PortRow => {
    const prev = existing?.outputs.find(o => o.label === p.label && o.type === p.type);
    return { portKey: p.portKey, type: p.type, label: p.label, slider: false, min: 0, max: 1, default: 0, hint: prev?.hint ?? '' };
  };
  const freshTexture = (t: { sourceKey: string; label: string }): TextureRow => {
    const prev = existing?.textures?.find(x => x.label === t.label);
    return { sourceKey: t.sourceKey, label: t.label, hint: prev?.hint ?? '' };
  };
  const [inputs, setInputs] = useState<PortRow[]>(() => ports.inputs.map(freshInput));
  const [outputs, setOutputs] = useState<PortRow[]>(() => ports.outputs.map(freshOutput));
  const [textures, setTextures] = useState<TextureRow[]>(() => ports.textures.map(freshTexture));
  const [params, setParams] = useState<ParamRow[]>(() =>
    (subgraph ? collectParamCandidates(subgraph) : []).map(c => {
      const prev = existing?.params.find(p => p.sourcePath === c.sourcePath);
      return { ...c, enabled: !!prev, label: prev?.label ?? c.paramLabel, min: prev?.min ?? c.min, max: prev?.max ?? c.max, default: prev?.default ?? c.value, hint: prev?.hint ?? c.hint ?? '' };
    }),
  );
  // Reconcile rows when the parsed signature changes (code mode only).
  const portsSig = JSON.stringify([ports.inputs, ports.outputs, ports.textures]);
  useEffect(() => {
    if (!isCode) return;
    setInputs(prev => ports.inputs.map(p => { const r = prev.find(x => x.portKey === p.portKey); return r ? { ...r, type: p.type } : freshInput(p); }));
    setOutputs(prev => ports.outputs.map(p => { const r = prev.find(x => x.portKey === p.portKey); return r ? { ...r, type: p.type } : freshOutput(p); }));
    setTextures(prev => ports.textures.map(t => prev.find(x => x.sourceKey === t.sourceKey) ?? freshTexture(t)));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- portsSig is the change signal
  }, [portsSig, isCode]);

  const [docOpen, setDocOpen] = useState<Set<string>>(() => new Set());
  const toggleDoc = (k: string) => setDocOpen(prev => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  const unsupported = useMemo(() => (subgraph ? findUnsupportedNode(subgraph) : null), [subgraph]);
  const enabledParams = params.filter(p => p.enabled);

  // Iteration count: only meaningful when a group loops.
  const groupIterates = useMemo(() => {
    if (!subgraph) return false;
    if (sourceIterations > 1) return true;
    const loops = (nodes: GraphNode[]) => nodes.some(n => n.type === 'loopIndex' || n.type === 'loopCarry');
    return loops(subgraph.nodes) || subgraph.nodes.some(n => n.type === 'group' && loops(((n.params.subgraph as { nodes?: GraphNode[] } | undefined)?.nodes) ?? []));
  }, [subgraph, sourceIterations]);
  const [iters, setIters] = useState(() => ({
    enabled: !!existing?.iterations,
    label: existing?.iterations?.label ?? 'Iterations',
    min: existing?.iterations?.min ?? 1,
    max: existing?.iterations?.max ?? Math.min(16, Math.max(8, sourceIterations)),
    default: existing?.iterations?.default ?? sourceIterations,
  }));

  // ── The spec, shared by the preview and the publish button ──────────────────
  const buildSpec = (forPreview: boolean): PublishUserNodeSpec => {
    const taken = new Set<string>();
    const textureSpecs: PublishTextureSpec[] = textures.map(t => ({
      sourceKey: t.sourceKey, label: t.label.trim() || t.sourceKey, key: keyFromLabel(t.label, taken, 'image'), hint: t.hint,
    }));
    const inputSpecs: PublishPortSpec[] = inputs.map(i => ({
      portKey: i.portKey, type: i.type, label: i.label.trim() || i.portKey,
      key: keyFromLabel(i.label, taken, 'input'),
      slider: i.type === 'float' && i.slider ? { min: i.min, max: i.max, default: i.default } : null,
      hint: i.hint,
    }));
    const paramSpecs: PublishParamSpec[] = enabledParams.map(p => ({
      sourcePath: p.sourcePath, label: p.label.trim() || p.paramLabel,
      key: keyFromLabel(p.label, taken, p.paramKey),
      min: p.min, max: p.max, step: p.step, default: p.default, hint: p.hint,
    }));
    const outputSpecs: PublishPortSpec[] = outputs.map(o => ({
      portKey: o.portKey, type: o.type, label: o.label.trim() || (o.portKey === CODE_RETURN_PORT ? 'Result' : o.portKey),
      key: keyFromLabel(o.label, taken, 'output'),
      hint: o.hint,
    }));
    return {
      label: label.trim() || 'Node', category, description,
      inputs: inputSpecs, outputs: outputSpecs, params: paramSpecs, textures: textureSpecs,
      iterations: groupIterates && iters.enabled
        ? { key: keyFromLabel(iters.label, taken, 'iterations'), label: iters.label.trim() || 'Iterations', min: iters.min, max: iters.max, default: iters.default }
        : undefined,
      existingId: forPreview ? PREVIEW_ID : (replace && existing ? existing.id : undefined),
    };
  };

  const signaturePreview = useMemo(() => {
    const taken = new Set<string>();
    const args = [
      ...textures.map(t => `sampler2D ${keyFromLabel(t.label, taken, 'image')}`),
      ...inputs.map(i => `${i.type} ${keyFromLabel(i.label, taken, 'input')}`),
      ...enabledParams.map(p => `float ${keyFromLabel(p.label, taken, p.paramKey)}`),
      ...outputs.slice(1).map(o => `out ${o.type} ${keyFromLabel(o.label, taken, 'output')}`),
    ];
    const ret = outputs[0]?.type ?? 'void';
    const name = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_') || 'node';
    const withIters = groupIterates && iters.enabled;
    const note = withIters ? `\n// one variant per iteration count (${iters.min}–${iters.max}); the slider picks which is compiled` : '';
    return `${ret} ${name}${withIters ? `_i${iters.default}` : ''}(${args.join(', ')})${note}`;
  }, [inputs, enabledParams, outputs, textures, label, groupIterates, iters]);

  // ── Live preview ─────────────────────────────────────────────────────────────
  const [preview, setPreview] = useState<{ url?: string; error?: string; busy: boolean }>({ busy: false });
  const previewGen = useRef(0);
  const previewKey = JSON.stringify([label, inputs, outputs, textures, enabledParams, iters, groupIterates, code, entry]);
  useEffect(() => {
    if (!subgraph && !isCode) return;
    const gen = ++previewGen.current;
    const t = setTimeout(async () => {
      const built = buildUserNodeDefinition(source, buildSpec(true));
      if (gen !== previewGen.current) return;
      if (!built.ok) { setPreview({ error: built.error, busy: false }); return; }
      const def = built.def;
      const primary = def.outputs[0];
      if (!primary || !['float', 'vec2', 'vec3', 'vec4'].includes(primary.type)) { setPreview({ error: 'Preview needs a float or vector output.', busy: false }); return; }
      setTransientUserNode(def);
      const inst: GraphNode = {
        id: 'p', type: def.id, position: { x: 0, y: 0 },
        inputs: Object.fromEntries(def.inputs.map(i => [i.key, { type: i.type, label: i.label }])),
        outputs: Object.fromEntries(def.outputs.map(o => [o.key, { type: o.type, label: o.label }])),
        params: {
          ...Object.fromEntries(def.inputs.filter(i => i.slider).map(i => [i.key, i.slider!.default])),
          ...Object.fromEntries(def.params.map(p => [p.key, p.default])),
          ...(def.iterations ? { [def.iterations.key]: def.iterations.default } : {}),
        },
      };
      const outType = primary.type === 'vec4' ? 'vec4Output' : 'output';
      const out: GraphNode = {
        id: 'o', type: outType, position: { x: 0, y: 0 },
        inputs: { color: { type: primary.type === 'vec4' ? 'vec4' : 'vec3', label: 'Color', connection: { nodeId: 'p', outputKey: primary.key } } },
        outputs: {}, params: {},
      };
      const r = compileGraph({ nodes: [inst, out] });
      if (gen !== previewGen.current) return;
      if (!r.success) { setPreview({ error: (r.errors ?? ['Compile failed']).join('\n'), busy: false }); return; }
      setPreview(p => ({ ...p, busy: true }));
      try {
        const uniforms: Record<string, { value: number }> = { u_time: { value: 1.0 } };
        for (const [k, v] of Object.entries(r.paramUniforms)) uniforms[k] = { value: v };
        const url = await nodePreviewRenderer.renderNodePreview(PREVIEW_ID, r.fragmentShader, uniforms, PREVIEW_SIZE);
        if (gen !== previewGen.current) return;
        nodePreviewRenderer.invalidatePreview(PREVIEW_ID);
        setPreview({ url, busy: false });
      } catch (e) {
        if (gen === previewGen.current) setPreview({ error: e instanceof Error ? e.message : 'Preview failed', busy: false });
      }
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- previewKey is the change signal
  }, [previewKey]);
  useEffect(() => () => setTransientUserNode(null), []);

  const updateInput = (i: number, patch: Partial<PortRow>) => setInputs(rows => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const updateOutput = (i: number, patch: Partial<PortRow>) => setOutputs(rows => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const updateParam = (i: number, patch: Partial<ParamRow>) => setParams(rows => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const updateTexture = (i: number, patch: Partial<TextureRow>) => setTextures(rows => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const publish = async () => {
    if (busy) return;
    setError(null);
    setBusy(true);
    const result = await publishUserNode(groupNode ? groupNode.id : source, buildSpec(false));
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

  const blocked = !!unsupported || !!ports.error;
  const canPublish = (!!subgraph || isCode) && !blocked && outputs.length > 0 && label.trim().length > 0 && !busy;

  const docButton = (k: string, has: boolean) => (
    <IconButton icon="comment" size="sm" label={has ? 'Edit the docstring' : 'Add a docstring (what it expects, its range…)'} active={docOpen.has(k) || has}
      style={has ? { color: tk.kind.fn } : undefined} onClick={() => toggleDoc(k)} />
  );
  const docField = (k: string, value: string, onChange: (v: string) => void) => docOpen.has(k) ? (
    <div style={{ padding: '0 10px 6px 10px', marginTop: -4 }}>
      <Field aria-label="Docstring" height={28} value={value} autoFocus onChange={e => onChange(e.target.value)}
        placeholder="What does it expect? e.g. `0..1` mask, **radians**, or -1..1 coordinates" style={{ background: tk.bg.field }} />
    </div>
  ) : null;

  const sourceWord = initialSource.kind === 'group' ? 'group' : initialSource.kind === 'code' ? 'GLSL' : 'graph';
  const subtitle = isCode
    ? `Hand-written GLSL · ${ports.functions?.length ?? 0} function${(ports.functions?.length ?? 0) === 1 ? '' : 's'}${ports.entry ? ` · entry: ${ports.entry}` : ''}`
    : `From ${sourceWord} "${sourceLabel}" · ${subgraph?.nodes.length ?? 0} nodes flatten into one GLSL function`;

  return (
    <Modal
      title={existing ? 'Update node type' : isCode ? 'Publish GLSL as node' : 'Publish as node'}
      subtitle={subtitle}
      icon={isCode ? 'code' : 'spark'}
      iconColor={tk.kind.fn}
      width={800}
      height={Math.min(760, typeof window !== 'undefined' ? window.innerHeight - 48 : 760)}
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
        {!isCode && outputs.length === 0 && !unsupported && (
          <Callout tone="warning" title="No output port">A node needs at least one output. Expose an output on the group first.</Callout>
        )}
        {error && <Callout title="Couldn't publish" details={error} onDismiss={() => setError(null)}>The node failed to build. The details show what the compiler said.</Callout>}

        {/* Identity + live preview */}
        <div style={{ display: 'grid', gridTemplateColumns: `1fr ${PREVIEW_SIZE}px`, gap: 12, alignItems: 'start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 180px', gap: 8 }}>
              <Field autoFocus={!isCode} aria-label="Node name" placeholder="Node name" value={label} onChange={e => setLabel(e.target.value)} />
              <Select ariaLabel="Category" height={34} value={category} onChange={setCategory} options={categories.map(c => ({ value: c, label: c }))} />
            </div>
            <textarea aria-label="Description" rows={3} value={description} onChange={e => setDescription(e.target.value)}
              placeholder={'What does it do? Shown in the node browser and info panel.\nSupports `code`, **bold** and - bullets.'}
              style={{ resize: 'vertical', minHeight: 76, padding: '8px 10px', border: 0, outline: 'none', borderRadius: radius.control, background: tk.bg.field, color: tk.text.primary, font: `500 12.5px/1.45 ${fontFamily.ui}` }} />
          </div>
          {/* Preview: a render surface, so it keeps its own dark look in both themes */}
          <div title={preview.error ?? 'Live preview of the node with its default values'}
            style={{ width: PREVIEW_SIZE, height: PREVIEW_SIZE, borderRadius: radius.md, overflow: 'hidden', background: '#0b0c10', position: 'relative', flexShrink: 0, boxShadow: `inset 0 0 0 1px ${tk.border.subtle}` }}>
            {preview.url && <img src={preview.url} alt="Node preview" style={{ width: '100%', height: '100%', display: 'block', imageRendering: 'auto', opacity: preview.busy ? 0.6 : 1 }} />}
            {preview.error && (
              <div style={{ position: 'absolute', inset: 0, padding: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', color: '#f38ba8', font: `11px/1.35 ${fontFamily.mono}`, overflow: 'hidden', background: 'rgba(11,12,16,0.85)' }}>
                {preview.error.split('\n')[0].slice(0, 160)}
              </div>
            )}
            {!preview.url && !preview.error && (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6c7086', font: `11px ${fontFamily.ui}` }}>{preview.busy ? 'rendering…' : 'preview'}</div>
            )}
            <span style={{ position: 'absolute', left: 6, bottom: 4, color: 'rgba(255,255,255,0.45)', font: `9.5px ${fontFamily.mono}`, letterSpacing: '0.06em' }}>PREVIEW</span>
          </div>
        </div>

        {/* Code editor */}
        {isCode && (
          <>
            {sectionTitle('GLSL', 'the entry function’s signature is the node')}
            <CodeField value={code} onChange={setCode} completions={completions} title="Functions" minHeight={160} maxHeight={320}
              ariaLabel="Node GLSL" invalid={!!ports.error}
              actions={ports.functions && ports.functions.length > 1 ? (
                <Select ariaLabel="Entry function" height={26} mono value={ports.entry ?? ''} onChange={setEntry}
                  options={ports.functions.map(f => ({ value: f.name, label: `entry: ${f.name}` }))} />
              ) : undefined} />
            {ports.error && <Callout tone="warning" title="Can't read the node from this code yet">{ports.error}</Callout>}
          </>
        )}

        {/* Images */}
        {textures.length > 0 && (
          <>
            {sectionTitle('Images', 'each becomes a sampler2D argument, with an image picker on the node')}
            {textures.map((row, i) => (
              <Fragment key={row.sourceKey}>
              <div style={rowStyle}>
                <span style={{ width: 9, height: 9, borderRadius: 2, flexShrink: 0, background: tk.status.warning }} />
                <span style={{ fontFamily: fontFamily.mono, fontSize: 11.5, color: tk.text.muted, width: 62 }}>sampler2D</span>
                <Field aria-label={`Image ${i + 1} label`} height={28} value={row.label} onChange={e => updateTexture(i, { label: e.target.value })} style={{ flex: 1 }} />
                {docButton(`tex:${i}`, !!row.hint)}
              </div>
              {docField(`tex:${i}`, row.hint, v => updateTexture(i, { hint: v }))}
              </Fragment>
            ))}
          </>
        )}

        {/* Inputs */}
        {sectionTitle('Inputs', isCode ? 'parameters of the entry function · a float can carry a slider for when it’s unconnected' : 'group ports become sockets · a float input can carry a slider for when it’s unconnected')}
        {inputs.length === 0 && <div style={{ fontSize: 12, color: tk.text.faint, padding: '2px 10px' }}>No inputs. The node will only read time and UV from the graph.</div>}
        {inputs.map((row, i) => (
          <Fragment key={row.portKey}>
          <div style={rowStyle}>
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
            {docButton(`in:${i}`, !!row.hint)}
          </div>
          {docField(`in:${i}`, row.hint, v => updateInput(i, { hint: v }))}
          </Fragment>
        ))}

        {/* Outputs */}
        {sectionTitle('Outputs', isCode ? 'the return value, then any out parameters' : 'the first output is the function’s return value')}
        {outputs.map((row, i) => (
          <Fragment key={row.portKey}>
          <div style={rowStyle}>
            <TypeDot type={row.type} />
            <span style={{ fontFamily: fontFamily.mono, fontSize: 11.5, color: tk.text.muted, width: 38 }}>{row.type}</span>
            <Field aria-label={`Output ${i + 1} label`} height={28} value={row.label} onChange={e => updateOutput(i, { label: e.target.value })} style={{ flex: 1 }} />
            {docButton(`out:${i}`, !!row.hint)}
          </div>
          {docField(`out:${i}`, row.hint, v => updateOutput(i, { hint: v }))}
          </Fragment>
        ))}

        {/* Iterations */}
        {groupIterates && (
          <>
            {sectionTitle('Iterations', iters.enabled ? 'a stepped slider on the node · changing it recompiles' : `baked at ${sourceIterations} pass${sourceIterations === 1 ? '' : 'es'}`)}
            <div style={{ ...rowStyle, opacity: iters.enabled ? 1 : 0.7 }}>
              <Toggle checked={iters.enabled} onChange={v => setIters(x => ({ ...x, enabled: v }))} />
              <span style={{ fontSize: 11.5, color: tk.text.faint, width: 130 }}>Loop passes</span>
              {iters.enabled ? (
                <>
                  <Field aria-label="Iterations label" height={28} value={iters.label} onChange={e => setIters(x => ({ ...x, label: e.target.value }))} style={{ flex: 1 }} />
                  {miniLabel('min')}<NumberInput value={iters.min} min={1} max={16} step={1} onCommit={v => setIters(x => ({ ...x, min: Math.max(1, Math.min(16, Math.round(v))) }))} style={numStyle} />
                  {miniLabel('max')}<NumberInput value={iters.max} min={1} max={16} step={1} onCommit={v => setIters(x => ({ ...x, max: Math.max(1, Math.min(16, Math.round(v))) }))} style={numStyle} />
                  {miniLabel('default')}<NumberInput value={iters.default} min={1} max={16} step={1} onCommit={v => setIters(x => ({ ...x, default: Math.max(1, Math.min(16, Math.round(v))) }))} style={numStyle} />
                </>
              ) : (
                <span style={{ flex: 1, fontSize: 12, color: tk.text.secondary }}>
                  Iterations <span style={{ color: tk.text.faint, fontFamily: fontFamily.mono }}>= {sourceIterations}</span><span style={{ color: tk.text.faint }}> · baked</span>
                </span>
              )}
            </div>
          </>
        )}

        {/* Params (groups only) */}
        {!isCode && (
          <>
            {sectionTitle('Sliders', `${enabledParams.length} live · ${params.length - enabledParams.length} baked into the code`)}
            {params.length === 0 && <div style={{ fontSize: 12, color: tk.text.faint, padding: '2px 10px' }}>No sliders inside this group.</div>}
            {params.map((row, i) => (
              <Fragment key={row.sourcePath}>
              <div style={{ ...rowStyle, opacity: row.enabled ? 1 : 0.7 }}>
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
                {row.enabled && docButton(`p:${i}`, !!row.hint)}
              </div>
              {row.enabled && docField(`p:${i}`, row.hint, v => updateParam(i, { hint: v }))}
              </Fragment>
            ))}
          </>
        )}

        {/* Signature preview */}
        <div style={{ marginTop: 4, padding: '10px 12px', borderRadius: radius.md, background: alpha(tk.kind.fn, 0.08), color: tk.text.secondary, font: `12px ${fontFamily.mono}`, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          <span style={{ color: tk.text.faint }}>// emitted once, called per instance{'\n'}</span>{signaturePreview}
        </div>
      </div>
    </Modal>
  );
}
