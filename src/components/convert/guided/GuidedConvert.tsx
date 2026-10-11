/**
 * Guided Convert (docs/guided-convert.md): the Convert page's step-by-step mode. You select lines of the
 * shader, turn them into nodes, choose what becomes a slider, group what belongs together; the part not
 * converted yet runs as one Custom Function, so the graph draws the shader at every step.
 *
 *   left     the shader, tinted by the step each line became; under it, the selection's panel
 *   right    the Studio canvas, read-only (scratch mode, as the automatic page), each step's cards
 *            outlined in its colour; the check (original | as nodes) floats over it
 *   bottom   the step strip: the steps, % converted, undo / redo, group, the next cut, finish
 *
 * Everything shown is rebuilt from (shader, steps) by lib/guidedConvert; undo drops a step.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useNodeGraphStore } from '../../../store/useNodeGraphStore';
import { analyse, scopeUnits, unitsForLines, type Analysis, type HelperFn } from '../../../lib/guidedConvert/analyse';
import { buildGuided, hueOf, slidersOf, stableKeys, SHARED_TYPES, type GuidedBuild } from '../../../lib/guidedConvert/build';
import { defaultChip, helperOwners, openedHelpers, type ChipChoice, type ConvertMode, type ConvertStep, type GroupStep, type HelperStep, type Step } from '../../../lib/guidedConvert/stage';
import { offersFor, recognisedChoices, type Offer } from '../../../lib/guidedConvert/offers';
import type { GraphNode } from '../../../types/nodeGraph';
import { describeUnits, guidedReducer, initialGuided, needsMakes, suggestNext } from '../../../lib/guidedConvert/session';
import { probeShader } from '../../../lib/guidedConvert/probe';
import { learnGraph, textSignature } from '../../../suggestions/learning';
import { useThemeMode, useTokens } from '../../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../../theme/tokens';
import { Button, IconButton } from '../../ui/Button';
import { Callout } from '../../ui/Callout';
import { Segmented } from '../../ui/Choice';
import { Field } from '../../ui/Field';
import { Icon } from '../../ui/Icon';
import { Modal } from '../../ui/Modal';
import { toast } from '../../ui/toastStore';
import { NodeGraph } from '../../NodeGraph/NodeGraph';
import { getView } from '../../NodeGraph/socketRegistry';
import { RenderPair, type PairDiff } from '../RenderPair';
import { wrapOriginal } from '../wrapOriginal';
import { GuidedCode, type LineTint } from './GuidedCode';
import { CanvasTints, type CardTint } from './CanvasTints';
import { ProbeView } from './ProbeView';

const MODES: { value: ConvertMode; label: string; title: string }[] = [
  { value: 'nodes', label: 'Nodes', title: 'Split into library nodes (an Expression Block only where no node fits)' },
  { value: 'blocks', label: 'Expression', title: 'Split, then fold the math into Expression Blocks (sliders kept)' },
  { value: 'function', label: 'One function', title: 'Keep the lines as written, in one Custom Function' },
];
const CHIP_TITLE: Record<ChipChoice, string> = { slider: 'A slider (click: an input)', input: 'An input socket, fed from a named constant (click: fixed)', fixed: 'Fixed, as written (click: a slider)' };
const CHIP_ICON: Record<ChipChoice, 'sliders' | 'link' | 'lock'> = { slider: 'sliders', input: 'link', fixed: 'lock' };

let stepSeq = 0;
const newId = (p: string) => `${p}${Date.now().toString(36)}${(++stepSeq).toString(36)}`;

/** A name for a step from what it is: the value it makes, the helper it calls. */
function defaultName(a: Analysis, units: readonly number[], fn?: string): string {
  const us = units.map(i => scopeUnits(a, fn)[i]);
  if (fn && us.some(u => u.ast.type === 'return_statement')) return `${fn} result`;
  const call = a.helpers.find(h => us.some(u => new RegExp(`\\b${h.name}\\s*\\(`).test(u.text)));
  if (call) return call.name;
  const made = us.flatMap(u => u.decls.map(d => d.name));
  if (made.length) return made[made.length - 1];
  if (us.some(u => u.writes.has('gl_FragColor'))) return 'colour';
  const w = [...(us[us.length - 1]?.writes ?? [])][0];
  return w ?? 'step';
}

/** Where the canvas starts: the whole graph, at a readable zoom. */
function fitSoon(): () => void {
  const t = setTimeout(() => {
    const { _fitViewCallback, _setViewCallback, nodes } = useNodeGraphStore.getState();
    _fitViewCallback?.();
    if (getView().zoom >= 0.45 || !_setViewCallback || !nodes.length) return;
    const z = 0.55, minX = Math.min(...nodes.map(n => n.position.x)), minY = Math.min(...nodes.map(n => n.position.y));
    _setViewCallback({ x: 40 - minX * z, y: 150 - minY * z }, z);
  }, 90);
  return () => clearTimeout(t);
}

export function GuidedConvert({ source, onExit, onMaterialized }: { source: string; onExit: () => void; onMaterialized: () => void }) {
  const tk = useTokens();
  const dark = useThemeMode() === 'dark';
  const analysis = useMemo(() => analyse(source), [source]);
  const [session, dispatch] = useReducer(guidedReducer, source, initialGuided);
  const { steps } = session;

  if (!analysis.ok) {
    return (
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: tk.bg.panel }}>
        <div style={{ maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Callout tone="warning" title="Guided needs a shader it can read">{analysis.error}{analysis.line ? ` (line ${analysis.line})` : ''}</Callout>
          <div><Button variant="primary" onClick={onExit}>Back to the editor</Button></div>
        </div>
      </div>
    );
  }
  return <GuidedInner a={analysis} steps={steps} dispatch={dispatch} redoCount={session.redo.length} onExit={onExit} onMaterialized={onMaterialized} tk={tk} dark={dark} />;
}

type Tk = ReturnType<typeof useTokens>;

function GuidedInner({ a, steps, dispatch, redoCount, onExit, onMaterialized, tk, dark }: {
  a: Analysis; steps: Step[]; dispatch: React.Dispatch<Parameters<typeof guidedReducer>[1]>; redoCount: number;
  onExit: () => void; onMaterialized: () => void; tk: Tk; dark: boolean;
}) {
  const setScratchNodes = useNodeGraphStore(s => s.setScratchNodes);
  const endScratch = useNodeGraphStore(s => s.endScratch);
  const build = useMemo(() => buildGuided(a, steps), [a, steps]);
  // A step is only added once it builds, so a failed build here means the shader changed under the steps.
  const good: GuidedBuild | null = build.ok ? build : null;

  // ── The canvas: the graph at this step, in scratch mode ─────────────────────
  const shape = useRef('');
  useEffect(() => {
    if (!good) return;
    setScratchNodes(good.nodes, good.controls);
    const s = good.nodes.map(n => n.id).join('|');
    if (s !== shape.current) { shape.current = s; return fitSoon(); }
  }, [good, setScratchNodes]);
  useEffect(() => () => endScratch(false), [endScratch]);

  // ── The check: the original against the graph, on one clock ────────────────
  const original = useMemo(() => wrapOriginal(a.source).code, [a.source]);
  const graphFrag = good?.compiled?.fragmentShader ?? null;
  const uniforms = useMemo(() => good?.compiled?.paramUniforms ?? {}, [good]);
  const originalUniforms = useMemo(() => Object.fromEntries((good?.report.uniforms ?? []).map(u => [u.name, u.value])), [good]);
  const [diff, setDiff] = useState<PairDiff | null>(null);
  const isSame = (d: PairDiff | null) => (d && !('error' in d) ? d.max <= 2 && d.badPct < 0.1 : null);
  const same = isSame(diff);
  // Each step remembers what the check said right after it.
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const lastId = useRef('start');
  useEffect(() => { lastId.current = steps[steps.length - 1]?.id ?? 'start'; }, [steps]);
  const onDiff = useCallback((d: PairDiff | null) => {
    setDiff(d);
    const s = isSame(d);
    if (s !== null) setChecks(c => (c[lastId.current] === s ? c : { ...c, [lastId.current]: s }));
  }, []);

  // ── Owners, colours ─────────────────────────────────────────────────────────
  const owners = useMemo(() => {
    const m = new Map<number, string>();
    for (const s of steps) if (s.kind === 'convert') for (const u of s.units) if (!m.has(u)) m.set(u, s.id);
    return m;
  }, [steps]);
  const opened = useMemo(() => openedHelpers(steps), [steps]);
  const ownersIn = useMemo(() => new Map([...opened].map(fn => [fn, helperOwners(steps, fn)])), [opened, steps]);
  const stepOf = useCallback((id: string) => steps.find(s => s.id === id) as ConvertStep | HelperStep | undefined, [steps]);
  const groupOf = useMemo(() => {
    const m = new Map<string, GroupStep>();
    for (const s of steps) if (s.kind === 'group') for (const id of s.members) m.set(id, s);
    return m;
  }, [steps]);
  const [active, setActive] = useState<string | null>(null);
  const tints = useMemo(() => {
    const m = new Map<number, LineTint>();
    for (const u of a.units) {
      const o = owners.get(u.index); if (!o) continue;
      const hue = hueOf(steps, o); if (hue === null) continue;
      const step = stepOf(o)!;
      const g = groupOf.get(o);
      const label = step.kind === 'helper' ? `Calls ${step.fn}(): a copy of its group` : `${step.name}${g ? ` (in ${g.name})` : ''}`;
      for (let l = u.lines[0]; l <= u.lines[1]; l++) m.set(l, { hue, label, active: active === o || (!!g && active === g.id) });
    }
    // An opened helper: its header in the helper step's colour, its body lines in the colour of the step that converted them.
    for (const s of steps) {
      if (s.kind !== 'helper') continue;
      const h = a.helpers.find(x => x.name === s.fn); const hue = hueOf(steps, s.id);
      if (!h || hue === null) continue;
      m.set(h.lines[0], { hue, label: `${s.fn}() is a group: select lines inside it to convert them`, active: active === s.id });
      for (const u of h.units) {
        const o = ownersIn.get(s.fn)?.get(u.index); const uh = o ? hueOf(steps, o) : null;
        if (!o || uh === null) continue;
        for (let l = u.lines[0]; l <= u.lines[1]; l++) m.set(l, { hue: uh, label: `${stepOf(o)!.name} (in ${s.fn}())`, active: active === o });
      }
    }
    return m;
  }, [a, owners, ownersIn, steps, stepOf, groupOf, active]);
  const allNodes = useMemo(() => {
    const m = new Map<string, GraphNode>();
    const walk = (list: readonly GraphNode[]) => { for (const n of list) { m.set(n.id, n); const sg = n.params.subgraph as { nodes: GraphNode[] } | undefined; if (sg) walk(sg.nodes); } };
    walk(good?.nodes ?? []);
    return m;
  }, [good]);
  const firstOfOwner = useMemo(() => {
    const seen = new Set<string>(); const first = new Set<string>();
    for (const n of good?.nodes ?? []) { const o = good!.owner.get(n.id); if (o && !seen.has(o) && !SHARED_TYPES.has(n.type)) { seen.add(o); first.add(n.id); } }
    return first;
  }, [good]);
  const tintOf = useCallback((id: string): CardTint | null => {
    if (!good) return null;
    const o = good.owner.get(id);
    const node = allNodes.get(id);
    if (!o || !node || SHARED_TYPES.has(node.type)) return null;
    if (o.startsWith('rest:')) return { hue: null, label: firstOfOwner.has(id) ? 'Not converted yet' : '', dashed: true };
    const g = steps.find(s => s.id === o && s.kind === 'group') as GroupStep | undefined;
    if (g) return { hue: hueOf(steps, g.members[0]), label: firstOfOwner.has(id) ? g.name : '', active: active === g.id };
    const hue = hueOf(steps, o);
    if (hue === null) return null;
    const s = stepOf(o)!;
    return { hue, label: firstOfOwner.has(id) ? s.name : '', active: active === o };
  }, [good, steps, active, firstOfOwner, allNodes, stepOf]);

  // ── Selection ───────────────────────────────────────────────────────────────
  const [drag, setDrag] = useState<[number, number] | null>(null);
  /** The selection: statements of main() (or of an opened helper's body, `fn`); `via` when it was made inside a helper not opened yet. */
  const [sel, setSel] = useState<{ units: number[]; via?: string; fn?: string } | null>(null);
  const [mode, setMode] = useState<ConvertMode>('nodes');
  const [name, setName] = useState('');
  const [chips, setChips] = useState<Record<string, ChipChoice>>({});
  /** Recognised patterns turned down (kept as a plain block), by id. */
  const [plain, setPlain] = useState<ReadonlySet<string>>(() => new Set());
  const taken = useMemo(() => new Set(owners.keys()), [owners]);
  const openInfo = useMemo(() => ({ has: (fn: string) => opened.has(fn), taken: (fn: string) => new Set(ownersIn.get(fn)?.keys() ?? []) }), [opened, ownersIn]);
  const choose = useCallback((units: number[], via?: string, fn?: string) => {
    setSel(units.length || via ? { units, ...(via ? { via } : {}), ...(fn ? { fn } : {}) } : null);
    setName(units.length ? defaultName(a, units, fn) : '');
    setChips({});
    setPlain(new Set());
    if (fn && mode === 'blocks') setMode('nodes');
  }, [a, mode]);
  const onSelect = useCallback((range: [number, number] | null, done: boolean) => {
    setDrag(range);
    if (!done || !range) return;
    const r = unitsForLines(a, range[0], range[1], taken, openInfo);
    if (!r.units.length && !r.via) {
      const lo = Math.min(...range), hi = Math.max(...range);
      const already = a.units.some(u => owners.has(u.index) && u.lines[1] >= lo && u.lines[0] <= hi) || (!!r.fn && (a.helpers.find(h => h.name === r.fn)?.units ?? []).some(u => u.lines[1] >= lo && u.lines[0] <= hi));
      if (already) toast.info('Converted already', { message: 'Those lines are nodes now. Undo a step to change how they were cut.' });
      setDrag(null); setSel(null); return;
    }
    setDrag(null);
    choose(r.units, r.via, r.fn);
  }, [a, taken, owners, choose, openInfo]);
  const selUnits = useMemo(() => (sel ? sel.units.map(i => scopeUnits(a, sel.fn)[i]) : []), [a, sel]);
  const snapped = useMemo(() => {
    const s = new Set<number>();
    for (const u of selUnits) for (let l = u.lines[0]; l <= u.lines[1]; l++) s.add(l);
    return s;
  }, [selUnits]);
  // The draft as cut (what the recognised patterns are offered against), then with their choices.
  const cut: ConvertStep | null = useMemo(() => (sel?.units.length ? { kind: 'convert', id: 'draft', units: sel.units, mode, name: 'draft', chips, ...(sel.fn ? { fn: sel.fn } : {}) } : null), [sel, mode, chips]);
  const offers: Offer[] = useMemo(() => (cut && cut.mode === 'nodes' ? offersFor(a, steps, cut) : []), [a, steps, cut]);
  const draft: ConvertStep | null = useMemo(() => (cut && sel ? { ...cut, name: name.trim() || defaultName(a, sel.units, sel.fn), ...(offers.length ? { recognised: recognisedChoices(offers, plain) } : {}) } : null), [cut, sel, name, a, offers, plain]);
  const draftBuild = useMemo(() => (draft ? buildGuided(a, [...steps, draft]) : null), [a, steps, draft]);
  const probe = useMemo(() => (sel?.units.length && !sel.fn ? probeShader(a, sel.units) : null), [a, sel]);
  const probeCode = useMemo(() => (probe ? wrapOriginal(probe.code).code : null), [probe]);
  const io = useMemo(() => (sel?.units.length && !sel.fn ? needsMakes(a, sel.units) : null), [a, sel]);
  const literals = useMemo(() => {
    // A number a library node takes the place of isn't a chip any more.
    const gone = new Set(offers.filter(o => o.ok).flatMap(o => o.rec.swallowed));
    return selUnits.flatMap(u => u.literals).filter(l => !gone.has(l.id));
  }, [selUnits, offers]);
  const draftCounts = useMemo(() => {
    if (!draftBuild?.ok) return null;
    const mine: GraphNode[] = [];
    const walk = (list: readonly GraphNode[]) => { for (const n of list) { if (draftBuild.owner.get(n.id) === 'draft' && !SHARED_TYPES.has(n.type)) mine.push(n); const sg = n.params.subgraph as { nodes: GraphNode[] } | undefined; if (sg) walk(sg.nodes); } };
    walk(draftBuild.nodes);
    const fns = mine.filter(n => n.type === 'customFn').length, blocks = mine.filter(n => n.type === 'exprNode').length;
    return { nodes: mine.length - fns - blocks, fns, blocks };
  }, [draftBuild]);

  const make = () => {
    if (!draft || !draftBuild?.ok) return;
    const step: ConvertStep = { ...draft, id: newId('s') };
    dispatch({ type: 'add', step });
    setSel(null); setActive(null);
  };

  // ── Helpers as groups ───────────────────────────────────────────────────────
  /** Open a helper as a group (its free callers converted with it, so the group shows where it is used); `whole` converts its body too. */
  const openHelper = (h: HelperFn, whole: boolean) => {
    const free = h.callers.filter(i => !owners.has(i));
    let step: HelperStep = { kind: 'helper', id: newId('h'), fn: h.name, name: `${h.name}()`, callers: free };
    let b = buildGuided(a, [...steps, step]);
    if (!b.ok && free.length) { step = { ...step, callers: [] }; b = buildGuided(a, [...steps, step]); }
    if (!b.ok) { toast.error(`${h.name}() can’t open as a group`, { message: b.error }); return; }
    const add: Step[] = [step];
    if (whole && h.units.length) {
      const body: ConvertStep = { kind: 'convert', id: newId('s'), units: h.units.map(u => u.index), mode: 'nodes', name: `${h.name} body`, chips: {}, fn: h.name };
      const o = offersFor(a, [...steps, step], body);
      const withRec: ConvertStep = { ...body, ...(o.length ? { recognised: recognisedChoices(o, new Set()) } : {}) };
      if (buildGuided(a, [...steps, step, withRec]).ok) add.push(withRec);
      else toast.info(`${h.name}() opened`, { message: 'Its body can’t become nodes in one go: select its lines to convert them step by step.' });
    }
    dispatch({ type: 'addMany', steps: add });
    setSel(null); setActive(step.id);
  };

  // ── Next cut ────────────────────────────────────────────────────────────────
  const [skipped, setSkipped] = useState<number[]>([]);
  const next = useMemo(() => {
    const skip: ConvertStep[] = skipped.length ? [{ kind: 'convert', id: '__skip', units: skipped, mode: 'nodes', name: '', chips: {} }] : [];
    return suggestNext(a, [...steps, ...skip]) ?? (skipped.length ? suggestNext(a, steps) : null);
  }, [a, steps, skipped]);
  const nextHint = useMemo(() => {
    if (!next) return null;
    const b = buildGuided(a, [...steps, { kind: 'convert', id: 'hint', units: next.units, mode: 'nodes', name: '', chips: {} }]);
    if (!b.ok) return 'keep it with the lines around it';
    const mine = b.nodes.filter(n => b.owner.get(n.id) === 'hint' && !SHARED_TYPES.has(n.type));
    const fns = mine.filter(n => n.type === 'customFn').length;
    const nodes = mine.length - fns;
    return [nodes ? `${nodes} ${nodes === 1 ? 'node' : 'nodes'}` : '', fns ? `${fns} kept as ${fns === 1 ? 'a function' : 'functions'}` : ''].filter(Boolean).join(', ') || 'no new nodes';
  }, [a, steps, next]);

  // ── Groups ──────────────────────────────────────────────────────────────────
  const [picking, setPicking] = useState<Set<string> | null>(null);
  const [groupDialog, setGroupDialog] = useState<{ members: string[] } | null>(null);
  const convertSteps = steps.filter((s): s is ConvertStep => s.kind === 'convert' && !s.fn);
  const groupable = convertSteps.filter(s => !groupOf.has(s.id));

  // ── Finish ──────────────────────────────────────────────────────────────────
  const free = a.units.filter(u => !u.setup && !owners.has(u.index)).map(u => u.index);
  const convertRest = () => {
    if (!free.length) return;
    const step: ConvertStep = { kind: 'convert', id: newId('s'), units: free, mode: 'nodes', name: 'the rest', chips: {} };
    const b = buildGuided(a, [...steps, step]);
    if (!b.ok) { toast.error('The rest can’t become nodes in one go', { message: b.error }); return; }
    dispatch({ type: 'add', step });
  };
  const materialize = () => {
    if (!good?.compiled) return;
    const placed = useNodeGraphStore.getState().nodes;
    endScratch(true);
    const sig = textSignature(a.source);
    learnGraph(`convert:${sig}`, 'imported', placed, sig);
    toast.success(`${placed.length} nodes placed`, { message: free.length ? 'What you didn’t convert is a Custom Function marked “Not converted yet”.' : 'Every line became nodes.' });
    onMaterialized();
  };

  // ── Keys ────────────────────────────────────────────────────────────────────
  const onKey = (e: React.KeyboardEvent) => {
    const typing = (e.target as HTMLElement).closest('input, textarea');
    if (e.key === 'Escape') { setSel(null); setDrag(null); setPicking(null); return; }
    if (typing) return;
    if (e.key === 'Enter' && draftBuild?.ok) { e.preventDefault(); make(); return; }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.stopPropagation(); dispatch({ type: e.shiftKey ? 'redo' : 'undo' }); }
  };
  const root = useRef<HTMLDivElement>(null);
  // The strip shows the newest step.
  const stripRow = useRef<HTMLDivElement>(null);
  useEffect(() => { const el = stripRow.current; if (el) el.scrollTo({ left: el.scrollWidth, behavior: 'smooth' }); }, [steps.length]);

  const share = good?.share ?? { done: 0, total: 1 };
  const pct = Math.round((100 * share.done) / Math.max(1, share.total));
  const caps = { color: tk.text.faint, font: `600 10.5px ${fontFamily.ui}`, letterSpacing: '0.06em', textTransform: 'uppercase' as const };

  const stepTint = (id: string) => { const h = hueOf(steps, id); return h === null ? tk.text.faint : `hsl(${h}, 70%, ${dark ? 58 : 48}%)`; };

  return (
    <div ref={root} tabIndex={-1} onKeyDownCapture={onKey} onMouseDown={e => { if (!(e.target as HTMLElement).closest('input, textarea, button')) root.current?.focus({ preventScroll: true }); }}
      style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: tk.bg.panel, color: tk.text.primary, font: `12.5px ${fontFamily.ui}`, outline: 'none' }}>
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {/* Left: the code */}
        <div style={{ width: 'clamp(360px, 36%, 560px)', flexShrink: 0, display: 'flex', flexDirection: 'column', borderRight: `1px solid ${tk.border.default}`, minWidth: 0 }}>
          <div style={{ height: 52, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10, padding: '0 10px 0 16px', borderBottom: `1px solid ${tk.border.subtle}` }}>
            <span style={{ fontWeight: 650, fontSize: 13.5 }}>Your shader</span>
            <span style={{ color: tk.text.muted, fontSize: 12 }}>select lines to convert</span>
            <span style={{ flex: 1 }} />
            <Button size="sm" variant="ghost" icon="edit" onClick={onExit} title="Back to the automatic page, where the shader can be edited (the steps here are dropped)">Edit</Button>
          </div>
          <GuidedCode source={a.source} tints={tints} selected={drag} snapped={snapped} onSelect={onSelect} focusLine={selUnits.length ? selUnits[0].lines[0] : null} />
          {sel && (
            <SelectionPanel a={a} tk={tk} sel={sel} mode={mode} setMode={setMode} name={name} setName={setName} chips={chips} setChips={setChips}
              literals={literals} probeCode={probeCode} probeName={probe ? `${probe.name} · ${probe.type}` : null} io={io} counts={draftCounts}
              offers={offers} plain={plain} setPlain={setPlain} helper={sel.via ? a.helpers.find(h => h.name === sel.via) ?? null : null} onOpenHelper={openHelper}
              error={draftBuild && !draftBuild.ok ? draftBuild.error : null} onMake={make} onClose={() => setSel(null)} />
          )}
        </div>

        {/* Right: the canvas, with the check over it */}
        <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
          <NodeGraph redesignToolbar locked />
          <CanvasTints tintOf={tintOf} />
          <div style={{ position: 'absolute', top: 66, right: 16, zIndex: 20, padding: '10px 12px', borderRadius: radius.lg, background: tk.bg.panel, boxShadow: tk.shadow.float, display: 'flex', flexDirection: 'column', gap: 8, width: 'max-content', maxWidth: 'calc(100% - 32px)' }}>
            <RenderPair original={original} graph={graphFrag} uniforms={uniforms} originalUniforms={originalUniforms} onDiff={onDiff} size={96} labels={['Your shader', 'The graph']} />
            <div data-guided-check style={{ display: 'flex', alignItems: 'center', gap: 6, font: `600 12.5px ${fontFamily.ui}`, color: same === null ? tk.text.faint : same ? tk.status.success : tk.status.warningText }}>
              {diff && 'error' in diff ? <><Icon name="warning" size={14} />{diff.side === 'original' ? 'Your shader doesn’t compile here' : 'The graph doesn’t compile'}</>
                : same === null ? 'Comparing…' : <><Icon name={same ? 'check' : 'warning'} size={14} />{same ? 'Same picture' : 'Differs'}</>}
              {diff && !('error' in diff) && <span style={{ color: tk.text.muted, font: `500 11px ${fontFamily.mono}` }}>max {diff.max}/255</span>}
            </div>
            {same === false && <div style={{ maxWidth: 210, color: tk.text.muted, fontSize: 11.5, lineHeight: 1.4 }}>This step changed the picture. Undo it, or try the lines as one function.</div>}
          </div>
          {!good && <div style={{ position: 'absolute', left: 16, bottom: 16, zIndex: 20, maxWidth: 420 }}><Callout tone="warning" title="These steps don’t fit this shader">{build.ok ? '' : build.error}</Callout></div>}
          {good?.compileErrors.length ? <div style={{ position: 'absolute', left: 16, bottom: 16, zIndex: 20, maxWidth: 420 }}><Callout tone="warning" title="The graph doesn’t compile" details={good.compileErrors.join('\n')}>Undo the last step.</Callout></div> : null}
          {good?.notes.length ? <div style={{ position: 'absolute', left: 16, bottom: 16, zIndex: 20, maxWidth: 420 }}><Callout tone="warning" title="Not grouped">{good.notes.join(' · ')}</Callout></div> : null}
        </div>
      </div>

      {/* Bottom: the step strip */}
      <div data-guided-strip style={{ flexShrink: 0, borderTop: `1px solid ${tk.border.default}`, background: tk.bg.subtle, padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <span style={caps}>Steps</span>
          <IconButton icon="undo" label="Undo the last step (⌘Z)" size="sm" disabled={!steps.length} onClick={() => dispatch({ type: 'undo' })} />
          <IconButton icon="redo" label="Redo (⇧⌘Z)" size="sm" disabled={!redoCount} onClick={() => dispatch({ type: 'redo' })} />
          <div ref={stripRow} style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6, overflowX: 'auto', padding: '2px 0' }}>
            <StepChip tk={tk} label="Start" title="Back to the start: the whole shader as one function" active={false} colour={tk.text.faint} check={checks.start} onClick={() => { if (steps.length) dispatch({ type: 'back', to: 0 }); }} />
            {steps.map((s, i) => {
              const isGroup = s.kind === 'group';
              const colour = isGroup ? stepTint(s.members[0]) : stepTint(s.id);
              const label = isGroup ? `▣ ${s.name}` : s.kind === 'helper' ? `▣ ${s.name}` : s.fn ? `${s.fn}: ${s.name}` : `${s.name}`;
              const sub = isGroup ? `${s.members.length} steps` : s.kind === 'helper' ? 'opened as a group' : s.mode === 'function' ? 'function' : s.mode === 'blocks' ? 'expression' : null;
              const pickable = !isGroup && picking && groupable.some(g => g.id === s.id);
              return (
                <StepChip key={s.id} tk={tk} label={label} sub={sub} colour={colour} active={active === s.id} check={checks[s.id]}
                  picked={pickable ? picking!.has(s.id) : undefined}
                  title={pickable ? 'Tick to put it in the group' : `Step ${i + 1}. Click to show its lines and nodes; double-click to go back to just after it`}
                  onClick={() => {
                    if (pickable) { setPicking(p => { const n = new Set(p); if (n.has(s.id)) n.delete(s.id); else n.add(s.id); return n; }); return; }
                    setActive(a0 => (a0 === s.id ? null : s.id));
                  }}
                  onDoubleClick={() => dispatch({ type: 'back', to: i + 1 })} />
              );
            })}
          </div>
          {picking ? (
            <>
              <Button size="sm" variant="ghost" onClick={() => setPicking(null)}>Cancel</Button>
              <Button size="sm" variant="primary" icon="layers" disabled={picking.size < 1} onClick={() => { setGroupDialog({ members: convertSteps.filter(s => picking.has(s.id)).map(s => s.id) }); setPicking(null); }}>Group {picking.size || ''}</Button>
            </>
          ) : (
            <Button size="sm" variant="secondary" icon="layers" disabled={!groupable.length} onClick={() => setPicking(new Set(active && groupable.some(g => g.id === active) ? [active] : []))} title="Put steps together in a group: tick them in the strip">Group…</Button>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }} title={`${share.done} of ${share.total} lines of main() converted`}>
            <div style={{ width: 120, height: 6, borderRadius: 3, background: tk.bg.field, overflow: 'hidden' }}><div style={{ width: `${pct}%`, height: '100%', background: tk.accent.base }} /></div>
            <span data-guided-pct style={{ font: `600 12px ${fontFamily.ui}`, color: tk.text.secondary, whiteSpace: 'nowrap' }}>{pct}% converted</span>
          </div>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            {next ? (
              <>
                <span style={{ color: tk.text.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
                  Next: <b style={{ color: tk.text.primary }}>lines {next.lines[0]}{next.lines[1] !== next.lines[0] ? `–${next.lines[1]}` : ''}</b>, {next.label}{nextHint ? <span style={{ color: tk.text.faint }}> → {nextHint}</span> : null}
                </span>
                <Button size="sm" variant="secondary" onClick={() => choose(next.units)} title="Select these lines">Select</Button>
                <Button size="sm" variant="ghost" onClick={() => setSkipped(s => [...s, ...next.units])} title="Suggest something else">Skip</Button>
              </>
            ) : <span style={{ color: tk.text.muted }}>{free.length ? '' : 'Every line is converted.'}</span>}
          </div>
          {free.length > 0 && <Button size="sm" variant="ghost" icon="spark" onClick={convertRest} title="Turn everything not converted yet into nodes, the automatic way">Convert the rest</Button>}
          <Button size="sm" variant="primary" icon="nodes" disabled={!good?.compiled} onClick={materialize} title={free.length ? 'Keep this graph (what isn’t converted stays one Custom Function) and open the Studio' : 'Keep this graph and open the Studio'}>Materialize</Button>
        </div>
      </div>

      {groupDialog && good && (
        <GroupDialog a={a} steps={steps} build={good} members={groupDialog.members} onClose={() => setGroupDialog(null)}
          onCreate={g => { dispatch({ type: 'add', step: g }); setGroupDialog(null); setActive(g.id); }} />
      )}
    </div>
  );
}

function StepChip({ tk, label, sub, colour, active, check, picked, title, onClick, onDoubleClick }: {
  tk: Tk; label: string; sub?: string | null; colour: string; active: boolean; check?: boolean; picked?: boolean; title: string; onClick: () => void; onDoubleClick?: () => void;
}) {
  return (
    <button type="button" title={title} onClick={onClick} onDoubleClick={onDoubleClick}
      style={{
        height: 30, flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 7, padding: '0 10px', borderRadius: radius.md, cursor: 'pointer',
        border: 0, background: active ? alpha(tk.accent.base, 0.14) : tk.bg.panel, boxShadow: `inset 0 0 0 1px ${active ? tk.accent.base : tk.border.default}`,
        color: tk.text.primary, font: `600 12px ${fontFamily.ui}`, whiteSpace: 'nowrap',
      }}>
      {picked !== undefined && <span style={{ width: 14, height: 14, borderRadius: 4, boxShadow: `inset 0 0 0 1.5px ${tk.border.strong ?? tk.border.default}`, background: picked ? tk.accent.base : 'transparent', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>{picked && <Icon name="check" size={11} />}</span>}
      <span style={{ width: 9, height: 9, borderRadius: '50%', background: colour, flexShrink: 0 }} />
      {label}
      {sub && <span style={{ color: tk.text.faint, fontWeight: 500 }}>{sub}</span>}
      {check !== undefined && <span title={check ? 'Same picture after this step' : 'The picture differed after this step'} style={{ color: check ? tk.status.success : tk.status.warningText, display: 'inline-flex' }}><Icon name={check ? 'check' : 'warning'} size={12} /></span>}
    </button>
  );
}

function SelectionPanel({ a, tk, sel, mode, setMode, name, setName, chips, setChips, literals, probeCode, probeName, io, counts, offers, plain, setPlain, helper, onOpenHelper, error, onMake, onClose }: {
  a: Analysis; tk: Tk; sel: { units: number[]; via?: string; fn?: string }; mode: ConvertMode; setMode: (m: ConvertMode) => void; name: string; setName: (n: string) => void;
  chips: Record<string, ChipChoice>; setChips: (f: (c: Record<string, ChipChoice>) => Record<string, ChipChoice>) => void;
  literals: Analysis['units'][number]['literals']; probeCode: string | null; probeName: string | null; io: { needs: string[]; makes: string[] } | null;
  counts: { nodes: number; fns: number; blocks: number } | null;
  offers: Offer[]; plain: ReadonlySet<string>; setPlain: (s: ReadonlySet<string>) => void;
  /** The helper the selection was made inside, when it isn't opened yet. */
  helper: HelperFn | null; onOpenHelper: (h: HelperFn, whole: boolean) => void;
  error: string | null; onMake: () => void; onClose: () => void;
}) {
  const units = scopeUnits(a, sel.fn);
  const us = sel.units.map(i => units[i]);
  const lines = us.length ? [us[0].lines[0], Math.max(...us.map(u => u.lines[1]))] : helper ? helper.lines : [0, 0];
  const modes = sel.fn ? MODES.filter(m => m.value !== 'blocks') : MODES;
  const choiceOf = (id: string, fixedByDefault: boolean) => chips[id] ?? defaultChip(mode, fixedByDefault);
  const cycle = (c: ChipChoice): ChipChoice => (mode === 'function' ? (c === 'slider' ? 'input' : c === 'input' ? 'fixed' : 'slider') : c === 'fixed' ? 'slider' : 'fixed');
  const caps = { color: tk.text.faint, font: `600 10.5px ${fontFamily.ui}`, letterSpacing: '0.06em', textTransform: 'uppercase' as const, marginBottom: 5 };
  const chip = (text: string) => <span style={{ padding: '1px 6px', borderRadius: 5, background: tk.bg.field, font: `500 11.5px ${fontFamily.mono}`, color: tk.text.primary }}>{text}</span>;
  const made = counts ? [counts.nodes ? `${counts.nodes} ${counts.nodes === 1 ? 'node' : 'nodes'}` : '', counts.blocks ? `${counts.blocks} ${counts.blocks === 1 ? 'block' : 'blocks'}` : '', counts.fns ? `${counts.fns} ${counts.fns === 1 ? 'function' : 'functions'}` : ''].filter(Boolean).join(' · ') : '';
  return (
    <div data-guided-selection style={{ flexShrink: 0, maxHeight: '58%', overflowY: 'auto', borderTop: `1px solid ${tk.border.default}`, background: tk.bg.subtle, padding: '10px 14px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <b style={{ fontSize: 13 }}>Lines {lines[0]}{lines[1] !== lines[0] ? `–${lines[1]}` : ''}</b>
        <span style={{ color: tk.text.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sel.fn ? `in ${sel.fn}(), its group` : sel.via ? (sel.units.length ? `the lines that call ${sel.via}()` : `inside ${sel.via}()`) : describeUnits(a, sel.units)}</span>
        <span style={{ flex: 1 }} />
        <IconButton icon="close" label="Clear the selection (Esc)" size="sm" onClick={onClose} />
      </div>
      {helper && (
        <div data-guided-helper style={{ padding: '8px 10px', borderRadius: radius.md, background: tk.bg.panel, boxShadow: `inset 0 0 0 1px ${tk.border.default}`, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontWeight: 650 }}>{helper.name}() as a group of its own</div>
          {helper.openable === true ? (
            <>
              <div style={{ color: tk.text.muted, fontSize: 11.5, lineHeight: 1.45 }}>
                Its parameters ({helper.params.map(p => p.name).join(', ') || 'none'}) become the group’s inputs and its value the output; every converted call is a copy of the group{helper.callers.length ? ` (called on line${helper.callers.length === 1 ? '' : 's'} ${helper.callers.map(i => a.units[i].lines[0]).join(', ')})` : ''}. Convert the body all at once, or open it and select its lines step by step.
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <Button size="sm" variant="primary" icon="layers" onClick={() => onOpenHelper(helper, true)} title="Open it as a group and turn its whole body into nodes">Convert this function</Button>
                <Button size="sm" variant="secondary" onClick={() => onOpenHelper(helper, false)} title="Open it as a group; its body stays one Custom Function inside it until you convert its lines">Open as a group</Button>
              </div>
            </>
          ) : <div style={{ color: tk.text.muted, fontSize: 11.5 }}>Can’t open as a group: {helper.openable}. Its calls stay Custom Functions.</div>}
        </div>
      )}
      {sel.units.length > 0 && <div>
        <div style={caps}>Make it into</div>
        <Segmented size="sm" ariaLabel="Make the selection into" value={mode} onChange={setMode} options={modes.map(m => ({ value: m.value, label: m.label }))} />
        <div style={{ color: tk.text.faint, fontSize: 11.5, marginTop: 4 }}>{MODES.find(m => m.value === mode)!.title}</div>
      </div>}
      {offers.length > 0 && (
        <div data-guided-recognised>
          <div style={caps}>Recognised</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {offers.map(o => (
              <div key={o.rec.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: o.ok ? tk.text.primary : tk.text.muted }} title={`${o.rec.code} (line ${o.rec.line})`}>
                <Icon name={o.ok ? 'spark' : 'info'} size={13} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  {o.rec.what} → <b>{o.ok && plain.has(o.rec.id) ? 'a plain block' : o.rec.node}</b>
                  <span style={{ color: tk.text.faint }}> · line {o.rec.line}</span>
                  {!o.ok && o.why && <span style={{ display: 'block', color: tk.text.faint, fontSize: 11 }}>Kept as written: {o.why}</span>}
                </span>
                {o.ok && (
                  <Segmented size="sm" ariaLabel={`${o.rec.what} as`} value={plain.has(o.rec.id) ? 'block' : 'node'}
                    onChange={v => { const n = new Set(plain); if (v === 'block') n.add(o.rec.id); else n.delete(o.rec.id); setPlain(n); }}
                    options={[{ value: 'node', label: 'Node' }, { value: 'block', label: 'Block' }]} />
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {sel.units.length > 0 && <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        {probeCode !== null && <div>
          <ProbeView shader={probeCode} size={104} />
          {probeName && <div style={{ color: tk.text.faint, font: `500 10.5px ${fontFamily.mono}`, marginTop: 4, maxWidth: 104, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{probeName}</div>}
        </div>}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div>
            <div style={caps}>Name</div>
            <Field height={30} value={name} onChange={e => setName(e.target.value)} placeholder="what this part does" />
          </div>
          <div style={{ color: tk.text.muted, fontSize: 11.5, lineHeight: 1.6 }}>
            {io?.needs.length ? <div>Needs {io.needs.map((n, i) => <span key={n}>{i ? ' ' : ''}{chip(n)}</span>)}</div> : null}
            {io?.makes.length ? <div>Makes {io.makes.map((n, i) => <span key={n}>{i ? ' ' : ''}{chip(n)}</span>)}</div> : null}
          </div>
        </div>
      </div>}
      {literals.length > 0 && (
        <div>
          <div style={caps}>Numbers <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}>· click to switch</span></div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {literals.map(l => {
              const c = choiceOf(l.id, l.fixedByDefault);
              return (
                <button key={l.id} type="button" data-chip={c} title={`${l.name} = ${l.raw} (line ${l.line}). ${CHIP_TITLE[c]}`}
                  onClick={() => setChips(prev => ({ ...prev, [l.id]: cycle(c) }))}
                  style={{ height: 26, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0 8px', borderRadius: 13, border: 0, cursor: 'pointer',
                    background: c === 'fixed' ? tk.bg.field : alpha(tk.accent.base, c === 'slider' ? 0.16 : 0.1), boxShadow: c === 'input' ? `inset 0 0 0 1px ${tk.accent.base}` : 'none', color: c === 'fixed' ? tk.text.muted : tk.text.primary, font: `500 11.5px ${fontFamily.mono}` }}>
                  <Icon name={CHIP_ICON[c]} size={12} />{l.raw}<span style={{ color: tk.text.faint, fontFamily: fontFamily.ui }}>{l.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
      {error ? <Callout tone="warning" title="Can’t make this cut">{error}</Callout> : null}
      {sel.units.length > 0 && <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ flex: 1, color: tk.text.muted, fontSize: 11.5 }}>{made ? `Becomes ${made}` : ''}</span>
        <Button size="sm" variant="primary" icon="nodes" disabled={!!error} onClick={onMake} title="Turn the selection into nodes (↵)">Make nodes</Button>
      </div>}
    </div>
  );
}

function GroupDialog({ a, steps, build, members, onClose, onCreate }: { a: Analysis; steps: Step[]; build: GuidedBuild; members: string[]; onClose: () => void; onCreate: (g: GroupStep) => void }) {
  const tk = useTokens();
  const names = members.map(id => (steps.find(s => s.id === id) as ConvertStep).name);
  const [name, setName] = useState(names.length === 1 ? names[0] : names.join(' + '));
  const keys = useMemo(() => stableKeys(build.nodes, build.owner), [build]);
  const sliders = useMemo(() => {
    const set = new Set(members);
    return slidersOf(build.nodes.filter(n => set.has(build.owner.get(n.id) ?? '') && !SHARED_TYPES.has(n.type)), keys);
  }, [build, keys, members]);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const draft: GroupStep = useMemo(() => ({ kind: 'group', id: 'gdraft', name: name.trim() || 'Group', members, hidden: [...hidden] }), [name, members, hidden]);
  const trial = useMemo(() => buildGuided(a, [...steps, draft]), [a, steps, draft]);
  const groupNode = trial.ok ? trial.nodes.find(n => trial.owner.get(n.id) === 'gdraft' && n.type === 'group') : undefined;
  const problem = !trial.ok ? trial.error : trial.notes.find(n => n.includes(`“${draft.name}”`)) ?? null;
  const ports = (o: Record<string, { label?: string; type: string }>) => Object.entries(o).filter(([k]) => !k.startsWith('ps_')).map(([k, s]) => `${s.label ?? k}`);
  const caps = { color: tk.text.faint, font: `600 10.5px ${fontFamily.ui}`, letterSpacing: '0.06em', textTransform: 'uppercase' as const, margin: '12px 0 6px' };
  return (
    <Modal title="Group" subtitle={names.join(', ')} icon="layers" onClose={onClose} width={460}
      footer={<><span style={{ flex: 1 }} /><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!!problem || !groupNode} onClick={() => onCreate({ ...draft, id: newId('g') })}>Group</Button></>}>
      <div style={caps}>Name</div>
      <Field value={name} onChange={e => setName(e.target.value)} autoFocus />
      {groupNode && (
        <>
          <div style={caps}>Inputs and outputs</div>
          <div style={{ color: tk.text.muted, fontSize: 12, lineHeight: 1.6 }}>
            <div>In: {ports(groupNode.inputs as never).join(', ') || 'nothing'}</div>
            <div>Out: {ports(groupNode.outputs as never).join(', ') || 'nothing'}</div>
            <div style={{ color: tk.text.faint }}>The wires that cross the group. Rename them on the card once the graph is materialized.</div>
          </div>
        </>
      )}
      <div style={caps}>Sliders on the card</div>
      {sliders.length ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 260, overflowY: 'auto' }}>
          {sliders.map(s => (
            <label key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 2px', cursor: 'pointer' }}>
              <input type="checkbox" checked={!hidden.has(s.key)} onChange={() => setHidden(h => { const n = new Set(h); if (n.has(s.key)) n.delete(s.key); else n.add(s.key); return n; })} />
              <span style={{ fontWeight: 600 }}>{s.label}</span>
              <span style={{ color: tk.text.faint }}>{s.node}</span>
              <span style={{ marginLeft: 'auto', font: `500 11.5px ${fontFamily.mono}`, color: tk.text.muted }}>{Number(s.value.toFixed(3))}</span>
            </label>
          ))}
        </div>
      ) : <div style={{ color: tk.text.muted, fontSize: 12 }}>No sliders inside.</div>}
      {problem && <div style={{ marginTop: 10 }}><Callout tone="warning" title="Can’t group these">{problem}</Callout></div>}
    </Modal>
  );
}
