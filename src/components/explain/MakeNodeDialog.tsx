/**
 * "Make a node from this": the generalised function, with its inputs to rename and its literals
 * to keep constant or turn into sliders, saved as an Expression Block preset or (through the
 * publish flow) a node in the palette, and optionally used in place of the original.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  buildFunction, descriptionFor, generaliseText, toExprPreset, toPublishNode, explainExpression,
  type GeneraliseContext, type GlslType, type UseQuery,
} from '../../lib/glslPatterns';
import { saveExprPreset } from '../../store/useNodeGraphStore';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Field, TypeSelect } from '../ui/Field';
import { Segmented, Toggle } from '../ui/Choice';
import { toast } from '../ui/toastStore';
import { TYPE_COLORS } from '../NodeGraph/typeColors';
import { lazyWithSuspense, type PropsOf } from '../lazyWithSuspense';
import type { PublishNodeModal as PublishNodeModalT } from '../NodeGraph/PublishNodeModal';
import type { Made, UseHere } from './hosts';
import { checkWire } from '../../lang/typeCheck';

const PublishNodeModal = lazyWithSuspense<PropsOf<typeof PublishNodeModalT>>(() => import('../NodeGraph/PublishNodeModal').then(m => ({ default: m.PublishNodeModal })));

const TYPES: GlslType[] = ['float', 'vec2', 'vec3', 'vec4'];

export interface MakeNodeRequest {
  /** The text the span is in. */
  source: string;
  span: { start: number; end: number };
  ctx: GeneraliseContext;
  useHere?: UseHere;
}

export function MakeNodeDialog({ req, onClose, onFindUses }: { req: MakeNodeRequest; onClose: () => void; onFindUses?: (q: UseQuery, title: string) => void }) {
  const tk = useTokens();
  const [asWritten, setAsWritten] = useState(false);
  const g = useMemo(() => generaliseText(req.source, { ...req.ctx, plain: asWritten }, req.span), [req, asWritten]);
  const idiomAvailable = useMemo(() => {
    const r = generaliseText(req.source, req.ctx, req.span);
    return !('error' in r) && !!r.idiom;
  }, [req]);
  const [names, setNames] = useState<Record<number, string>>({});
  const [constant, setConstant] = useState<Record<number, boolean>>({});
  const [types, setTypes] = useState<Record<number, GlslType>>({});
  const [fnName, setFnName] = useState<string | null>(null);
  const [label, setLabel] = useState<string | null>(null);
  const [desc, setDesc] = useState<string | null>(null);
  const [target, setTarget] = useState<'preset' | 'node'>('preset');
  const [useHere, setUseHere] = useState(false);
  const [publishing, setPublishing] = useState(false);
  // A different reading (idiom / as written) has different inputs: start the choices over
  useEffect(() => { setNames({}); setConstant({}); setTypes({}); setFnName(null); setLabel(null); setDesc(null); }, [asWritten]);

  if ('error' in g) {
    return (
      <Modal title="Make a node" icon="nodes" onClose={onClose} width={520}>
        <div style={{ padding: 20, color: tk.text.secondary }}>This part doesn’t read as one expression: {g.error}</div>
      </Modal>
    );
  }
  const choices = { names, constant, types, fnName: fnName ?? undefined };
  const built = buildFunction(g, choices);
  const description = desc ?? descriptionFor(g, choices);
  const name = label ?? g.label;
  // An input retyped so the value it stands for can't be wired into it (a vec3 into a float): refused, with the fix.
  const typeIssues = g.inputs.flatMap((inp, i) => {
    const chosen = types[i];
    if (!chosen || chosen === inp.type || inp.typeGuessed) return [];
    const r = checkWire(inp.type, chosen, { from: `${inp.source} (input ${i + 1})`, to: `a ${chosen} input` });
    return r.ok ? [] : [{ i, from: inp.type, message: r.message }];
  });
  const blocked = typeIssues.length ? `Can't use it here: ${typeIssues[0].message}` : req.useHere ? req.useHere.blocked(built) : null;
  const explained = explainExpression(req.source.slice(req.span.start, req.span.end), req.ctx);

  const finishHere = (made: Made) => {
    if (useHere && req.useHere && !blocked) {
      req.useHere.apply(built, made);
      toast.success('Used here too', { message: `The original now reads ${built.fnName}.` });
    }
  };
  const save = async () => {
    if (built.errors.length) return;
    if (target === 'preset') {
      const preset = toExprPreset(g, built, name, description);
      const r = await saveExprPreset(preset);
      if (r && 'ok' in r && r.ok === false) { toast.error('Couldn’t save the preset'); return; }
      toast.success(`Saved “${preset.label}” to Expression Blocks`, { message: 'Find it in the sidebar’s Expressions, or search for it.' });
      finishHere({ kind: 'preset', preset });
      onClose();
    } else {
      setPublishing(true);
    }
  };

  const cell: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8 };
  const sectionLabel = (t: string, meta?: string) => (
    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginTop: 4 }}>
      <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: tk.text.faint }}>{t}</span>
      {meta && <span style={{ fontSize: 11.5, color: tk.text.faint }}>{meta}</span>}
    </div>
  );

  if (publishing) {
    return (
      <PublishNodeModal source={{ kind: 'node', node: toPublishNode(g, built, name, description) }} detached initialDescription={description}
        onPublished={id => { if (id) finishHere({ kind: 'userNode', id }); }}
        onClose={onClose} />
    );
  }

  return (
    <Modal title="Make a node" subtitle={g.idiom ? `${g.idiom.name} · ${built.params.length} input${built.params.length === 1 ? '' : 's'}` : `${built.params.length} input${built.params.length === 1 ? '' : 's'} → ${built.outputType}`}
      icon="nodes" onClose={onClose} width={760} height={680}
      footer={(
        <>
          {onFindUses && (
            <Button variant="ghost" icon="search" data-make-action="find-uses" onClick={() => onFindUses(g.idiom && !asWritten ? { idiomId: g.idiom.id } : { pattern: built.pattern }, g.idiom && !asWritten ? g.idiom.name : built.fnName)}>Where else is this used?</Button>
          )}
          <span style={{ flex: 1 }} />
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" data-make-action="save" disabled={built.errors.length > 0} onClick={save}>{target === 'preset' ? 'Save preset' : 'Next: publish…'}</Button>
        </>
      )}>
      <div data-make-node="" style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ font: `500 12px/1.5 ${fontFamily.mono}`, color: tk.text.secondary, background: tk.bg.subtle, borderRadius: radius.md, padding: '8px 10px', overflowWrap: 'anywhere' }}>{g.original}</div>
        {explained.ok && <div style={{ font: `500 12.5px/1.45 ${fontFamily.ui}`, color: tk.text.secondary }}>{explained.sentence}</div>}
        {idiomAvailable && (
          <Segmented<'idiom' | 'written'> size="sm" ariaLabel="Read it as" value={asWritten ? 'written' : 'idiom'} onChange={v => setAsWritten(v === 'written')}
            options={[{ value: 'idiom', label: 'As the idiom (named inputs)' }, { value: 'written', label: 'As written (every name and number)' }]} />
        )}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {sectionLabel('Name')}
            <Field value={name} onChange={e => setLabel(e.target.value)} aria-label="Node name" autoFocus />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {sectionLabel('Function', 'in code')}
            <Field mono value={fnName ?? g.fnName} onChange={e => setFnName(e.target.value)} aria-label="Function name" invalid={built.errors.some(e => e.includes('function name') || e.includes(`“${built.fnName}”`))} />
          </label>
        </div>

        {sectionLabel('Inputs', 'rename them; numbers can stay constant or become sliders')}
        <div data-make-inputs="" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {g.inputs.map((inp, i) => {
            const isConst = inp.canBeConstant ? (constant[i] ?? inp.constant) : false;
            const nm = names[i] ?? inp.name;
            return (
              <div key={i} data-make-input={inp.name} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.1fr) 104px minmax(0, 1fr) 150px', gap: 8, alignItems: 'center', opacity: isConst ? 0.6 : 1 }}>
                <Field mono value={nm} disabled={isConst} onChange={e => setNames(s => ({ ...s, [i]: e.target.value }))} aria-label={`Input ${i + 1} name`}
                  leading={<span style={{ width: 9, height: 9, borderRadius: '50%', background: TYPE_COLORS[types[i] ?? inp.type] ?? tk.text.faint, flexShrink: 0 }} />} />
                {inp.kind === 'literal' || inp.defaultVec
                  ? <span style={{ font: `500 12px ${fontFamily.mono}`, color: tk.text.muted, paddingLeft: 4 }}>{types[i] ?? inp.type}</span>
                  : <TypeSelect value={types[i] ?? inp.type} options={TYPES} onChange={t => setTypes(s => ({ ...s, [i]: t as GlslType }))} ariaLabel={`Input ${i + 1} type`} height={30} />}
                <span title={inp.typeGuessed ? 'The type is a guess from the name; change it if it’s wrong' : `Stands for ${inp.source} in the original`}
                  style={{ font: `500 11.5px ${fontFamily.mono}`, color: tk.text.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  = {inp.source}{inp.typeGuessed ? ' (type guessed)' : ''}
                </span>
                {inp.canBeConstant
                  ? <Toggle checked={!isConst} onChange={on => setConstant(s => ({ ...s, [i]: !on }))} label={isConst ? 'Constant' : inp.kind === 'literal' ? 'Slider' : 'Input'} />
                  : <span style={{ fontSize: 11.5, color: tk.text.faint }}>{inp.kind === 'free' ? 'from the code' : 'from the idiom'}</span>}
              </div>
            );
          })}
          {g.inputs.length === 0 && <span style={{ fontSize: 12, color: tk.text.muted }}>No inputs: it is the same everywhere.</span>}
          {typeIssues.map(t => (
            <div key={t.i} data-type-error style={{ display: 'flex', alignItems: 'center', gap: 8, font: `500 12px ${fontFamily.ui}`, color: tk.status.warningText, background: alpha(tk.status.danger, 0.06), borderRadius: radius.md, padding: '6px 10px' }}>
              <span style={{ flex: 1 }}>{t.message}</span>
              <Button size="sm" variant="secondary" onClick={() => setTypes(s => { const n = { ...s }; delete n[t.i]; return n; })}>Keep it {t.from}</Button>
            </div>
          ))}
        </div>

        {sectionLabel('Function', `returns ${built.outputType}${g.outputTypeGuessed ? ' (guessed)' : ''}`)}
        <pre data-make-code="" style={{ margin: 0, font: `500 12px/1.55 ${fontFamily.mono}`, color: tk.text.primary, background: tk.bg.subtle, borderRadius: radius.md, padding: '8px 10px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{built.code}</pre>
        {built.errors.length > 0 && <div style={{ font: `500 12px ${fontFamily.ui}`, color: tk.status.warningText, background: alpha(tk.status.danger, 0.06), borderRadius: radius.md, padding: '6px 10px' }}>{built.errors.join(' ')}</div>}

        {sectionLabel('Description', 'from the explanation')}
        <textarea aria-label="Description" value={description} onChange={e => setDesc(e.target.value)} rows={2}
          style={{ resize: 'vertical', border: 0, outline: 'none', borderRadius: radius.md, padding: '7px 9px', background: tk.bg.field, color: tk.text.primary, font: `12.5px/1.45 ${fontFamily.ui}` }} />

        {sectionLabel('Save as')}
        <div style={cell}>
          <Segmented<'preset' | 'node'> size="sm" ariaLabel="Save as" value={target} onChange={setTarget}
            options={[{ value: 'preset', label: 'Expression Block preset' }, { value: 'node', label: 'A node in the palette' }]} />
        </div>
        <span style={{ fontSize: 12, color: tk.text.muted }}>
          {target === 'preset' ? 'Adds it to Expression Blocks in the sidebar: an editable block, sliders included.' : 'Opens the publish dialog: a node type of its own, in the node browser and search, under My Nodes.'}
        </span>
        {req.useHere && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <Toggle checked={useHere && !blocked} disabled={!!blocked} onChange={setUseHere} label="Use it here too" />
            <span style={{ fontSize: 12, color: blocked ? tk.status.warningText : tk.text.muted }}>{blocked ?? req.useHere.label}</span>
          </div>
        )}
      </div>
    </Modal>
  );
}
