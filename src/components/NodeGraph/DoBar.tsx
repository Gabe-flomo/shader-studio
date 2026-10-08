/**
 * DoBar — type what to do (docs/suggestions.md): "circle in the middle with a glow, falloff 8",
 * "make it repeat 6 times around", "tone map it". A live preview lists the moves that will run
 * and their values before Enter. No AI: a fixed vocabulary (lang/vocabulary.ts) with synonyms
 * and small typos, shared with the 3D Scene Builder.
 *
 *  - "is this typical?" checks the selected wire or chain against your graphs, imports and the
 *    examples (connectionCheck.ts); a right-click on a wire's + badge opens it for that wire.
 *  - "teach …" saves the selection as a phrase of your own (taught.ts); the Taught list renames,
 *    deletes, exports and imports them.
 *  - Anything else it can't read falls back to node search (your made nodes included) and the
 *    explainer's idioms ("sine hash", "soft circle").
 *
 * ⌘K or the canvas toolbar's Do… button opens it.
 */
import { Component, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ErrorInfo, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Button, IconButton } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { portalGuard } from '../ui/portalGuard';
import { toast } from '../ui/toastStore';
import { useNodeGraphStore, getActiveNodes } from '../../store/useNodeGraphStore';
import { getOfferedDefinitions } from '../../nodes/definitions';
import { scoreNodeDef } from '../../nodes/searchNodes';
import { HIDDEN_TYPES } from './nodeCategoryMeta';
import { spawnPoint } from './spawnPoint';
import { parseDo, type DoPlan } from '../../suggestions/doBar';
import { inTargetStage, STAGE_SEARCH_POINTS } from '../../structure/boost';
import { currentStageTarget } from '../../structure/hintsStore';
import { closeDoBar, openCommandsRef, openDoBar, setDoBarHighlight, useDoBar } from '../../suggestions/doBarStore';
import { execCommand, type CommandPlan, type CmdClause, type CmdStep } from '../../suggestions/doCommands';
import { checkConnection, wiresAmong, type ConnectionReport, type Wire4 } from '../../suggestions/connectionCheck';
import { rankTables } from '../../suggestions';
import { idiomBlock, matchIdioms, type IdiomBlockSpec } from '../../suggestions/idiomBlocks';
import {
  deleteTaught, exportTaught, importTaught, phraseLabel, renameTaught, subscribeTaught, taughtMoves, taughtVersion, teachFromSelection,
} from '../../suggestions/taught';
import type { GraphNode } from '../../types/nodeGraph';
import { doBarAssist } from '../../lang/complete';
import { AssistList, SignatureLine, useTypeAhead } from '../builders/TypeAhead';
import { planBuilderCommand, readBuilderCommand, type BuilderPlan } from '../../builders/doBuilders';
import { runBuilderAction } from '../../builders/open';
import { builderRecipeOf } from '../../builders/recipe';
import { outputClause } from '../../sceneBuilder/output';
import { RecipeCode } from '../sceneBuilder/RecipeCode';
import { readLine, readsCanonically, gridPlan, sceneNodes, agentsNodes, type LineRead } from '../../lang/run';
import { canonicalOf } from '../../lang/dialects/picture';
import { barAssist } from '../../lang/barAssist';
import { wordKindFor } from '../../lang/highlight';
import { freshSeed } from '../../lang/random';
import { readSurpriseCommand, surpriseLine } from '../../lang/surprise';
import { cancelSurprise, keepSurprise, startSurprise, stepSurprise } from '../surprise/inspiredAction';
import { SurpriseStrip, DeepToggle } from '../surprise/SurpriseStrip';
import { useSurpriseCarousel } from '../surprise/inspiredAction';
import { EvolveStrip, EvolveToggle } from '../surprise/EvolveStrip';
import { escapeEvolveSession, focusEvolve, keepEvolveSession, useEvolve } from '../surprise/evolveAction';
import { TastePanel } from '../taste/TastePanel';
import { steeredModel, useTaste } from '../../taste/store';
import { emptyModel, nodeTypeLean, tasteRerank } from '../../taste';
import { normaliseEnd, strength } from '../../suggestions/usage';
import { historyAt, pushHistory, readHistory } from '../../suggestions/doBarHistory';
import type { Assist } from '../../lang/complete';
import { graphToScript } from '../../lang/fromGraph';

const WIDTH = 560;

export function DoBar() {
  const open = useDoBar(s => s.open);
  const seq = useDoBar(s => s.seq);
  if (!open) return null;
  // A throw while the bar renders takes down the bar, never the app (DoBarBoundary).
  return <DoBarBoundary key={seq}><Bar initial={open.text ?? ''} check={open.check} /></DoBarBoundary>;
}

/**
 * Run one reading of the line as you type. The bar re-reads the line on every keystroke, so a
 * throw here (a parser bug on a half-typed word) must not unmount the app: it is logged and the
 * bar shows "couldn't read this line" instead.
 */
function readSafely<T>(what: string, text: string, fn: () => T, fallback: T): { value: T; error: string | null } {
  try {
    return { value: fn(), error: null };
  } catch (e) {
    console.error(`Do… bar: ${what} threw on “${text}”`, e);
    return { value: fallback, error: e instanceof Error ? e.message : String(e) };
  }
}

/** The last guard: a render-time throw in the bar replaces the bar with a short note; the app stays up. */
class DoBarBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('Do… bar crashed while rendering; the bar was closed, the graph is untouched.', error, info.componentStack); }
  render() { return this.state.error ? <DoBarCrashed message={this.state.error.message} /> : this.props.children; }
}

function DoBarCrashed({ message }: { message: string }) {
  const tk = useTokens();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Escape (or ⌘Z) while Surprise candidates are showing: the original graph back.
      const carousel = useSurpriseCarousel.getState().open;
      const evolving = useEvolve.getState().open;
      if ((carousel || evolving) && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.stopPropagation(); if (evolving) escapeEvolveSession(); else cancelSurprise(); return; }
      if (e.key === 'Escape') { e.stopPropagation(); if (evolving) escapeEvolveSession(); if (carousel) cancelSurprise(); closeDoBar(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  return createPortal(
    <div {...portalGuard} role="alert" aria-label="Do…" data-do-bar data-do-crashed onPointerDown={e => e.stopPropagation()}
      style={{
        position: 'fixed', top: 150, left: '50%', transform: 'translateX(-50%)', zIndex: 1000, width: WIDTH, maxWidth: 'calc(100vw - 32px)',
        background: tk.bg.panel, color: tk.text.primary, border: `1px solid ${tk.border.default}`, borderRadius: radius.lg, boxShadow: tk.shadow.popover,
        font: `13px ${fontFamily.ui}`, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8,
      }}>
      <span style={{ fontSize: 12.5, color: tk.status.warningText }}>The Do… bar couldn’t read this line and stopped. Your graph is unchanged.</span>
      <span style={{ fontSize: 11.5, color: tk.text.muted, overflowWrap: 'anywhere' }}>{message}</span>
      <span style={{ display: 'flex', gap: 6 }}>
        <Button size="sm" variant="secondary" icon="edit" onClick={() => openDoBar()}>Start a new line</Button>
        <Button size="sm" variant="ghost" icon="close" onClick={closeDoBar}>Close</Button>
      </span>
    </div>,
    document.body,
  );
}

/** The canvas toolbar's Do… button. */
export function DoBarButton() {
  return <IconButton icon="edit" size="sm" label="Do…: type what to do (circle with a glow, repeat 6 times around, tone map it)" shortcut="⌘K" onClick={() => openDoBar()} />;
}

function useScope(): { nodes: GraphNode[]; selected: string[]; topLevel: boolean } {
  const nodes = useNodeGraphStore(s => s.nodes);
  const path = useNodeGraphStore(s => s.activeGroupPath);
  const selectedIds = useNodeGraphStore(s => s.selectedNodeIds);
  const selectedId = useNodeGraphStore(s => s.selectedNodeId);
  return useMemo(() => {
    const scope = (path.length ? getActiveNodes(nodes, path) : nodes) ?? [];
    // A single click selects through selectedNodeId; the list is for multi-selection.
    const selected = selectedIds.length > 1 ? selectedIds : selectedId ? [selectedId] : selectedIds;
    return { nodes: scope, selected: selected.filter(id => scope.some(n => n.id === id)), topLevel: path.length === 0 };
  }, [nodes, path, selectedIds, selectedId]);
}

/** The wires to check for the selection: among the selected nodes, else into the one selected. */
function selectionWires(nodes: GraphNode[], selected: string[]): Wire4[][] {
  if (selected.length >= 2) {
    const w = wiresAmong(nodes, selected);
    return w.length ? [w] : [];
  }
  const node = nodes.find(n => n.id === selected[0]);
  if (!node) return [];
  const byId = new Map(nodes.map(n => [n.id, n]));
  const into = Object.entries(node.inputs).flatMap(([inKey, i]) => {
    const src = i.connection ? byId.get(i.connection.nodeId) : undefined;
    return src ? [[{ fromType: src.type, outKey: i.connection!.outputKey, toType: node.type, inKey }]] : [];
  });
  const out = nodes.flatMap(n => Object.entries(n.inputs).filter(([, i]) => i.connection?.nodeId === node.id)
    .map(([inKey, i]) => [{ fromType: node.type, outKey: i.connection!.outputKey, toType: n.type, inKey }]));
  return [...into, ...out].slice(0, 3);
}

type Fallback = { kind: 'node'; type: string; label: string; detail: string } | { kind: 'idiom'; spec: IdiomBlockSpec };

function Bar({ initial, check }: { initial: string; check?: Wire4[] }) {
  const tk = useTokens();
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(initial);
  const [panel, setPanel] = useState<'none' | 'teach' | 'taught' | 'script' | 'taste'>(/^teach\b/i.test(initial) ? 'teach' : 'none');
  const [teachPhrase, setTeachPhrase] = useState(initial.replace(/^teach( the do bar)?\s*/i, ''));
  const [teachError, setTeachError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [caret, setCaret] = useState<number | null>(initial.length);
  const scope = useScope();
  // Learned + your steering (src/taste/steering.ts); the Do bar's nudge can be turned off on the Taste page.
  const learnedTaste = useTaste(s => s.model);
  const steering = useTaste(s => s.steering);
  const taste = useMemo(() => (steering.nudge ? steeredModel(learnedTaste, steering) : emptyModel()), [learnedTaste, steering]);
  // Type-ahead: the language's (graph-aware: create, connect, set…), else the plain-English vocabulary's.
  const assist = useMemo(() => {
    const t = rankTables();
    const rank = (a: string, o: string, b: string, i: string) => {
      const f = normaliseEnd(a, o, 'out'), g = normaliseEnd(b, i, 'in');
      return strength(t.table.stat(f.type, f.key, g.type, g.key));
    };
    const none: Assist = { items: [], from: 0, to: 0, signature: null };
    return (tx: string, c: number): Assist => readSafely('type-ahead', tx, () => {
      const lang = barAssist(tx, c, { nodes: scope.nodes, rank });
      // Taste leans lightly on node choices (never past an exact match of the word typed).
      if (lang.items.length > 1) {
        const word = tx.slice(lang.from, lang.to).trim().toLowerCase();
        const typeOf = new Map(getOfferedDefinitions().map(d => [d.label.toLowerCase(), d.type]));
        const lean = (it: { label: string; detail: string }) => { const t = typeOf.get(it.detail.toLowerCase()) ?? typeOf.get(it.label.toLowerCase()); return t ? nodeTypeLean(taste, t) : 0; };
        return { ...lang, items: tasteRerank(lang.items, lean, it => !!word && it.label.toLowerCase() === word) };
      }
      if (lang.items.length || lang.signature) return lang;
      return doBarAssist(tx, c);
    }, none).value;
  }, [scope.nodes, taste]);
  // The seed for `random` while you type (a line's own seed= wins); a new one after each run.
  const [seed, setSeed] = useState(freshSeed);
  const [histIndex, setHistIndex] = useState<number | null>(null);
  const ta = useTypeAhead(text, caret, assist, (next, at) => {
    setText(next); setCaret(at);
    requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.setSelectionRange(at, at); });
  });
  useSyncExternalStore(subscribeTaught, taughtVersion, taughtVersion);

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 0); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Escape (or ⌘Z) while Surprise candidates are showing: the original graph back.
      const carousel = useSurpriseCarousel.getState().open;
      const evolving = useEvolve.getState().open;
      if ((carousel || evolving) && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.stopPropagation(); if (evolving) escapeEvolveSession(); else cancelSurprise(); return; }
      if (e.key === 'Escape') { e.stopPropagation(); if (evolving) escapeEvolveSession(); if (carousel) cancelSurprise(); closeDoBar(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  // Closing the bar any other way keeps the candidate on screen.
  useEffect(() => () => { if (useSurpriseCarousel.getState().open) keepSurprise(); if (useEvolve.getState().open) keepEvolveSession(); }, []);
  const carouselOpen = useSurpriseCarousel(s => s.open);
  const evolveOpen = useEvolve(s => s.open);

  // A builder phrase ("new 3d scene", "edit the rules", "show the recipe") is the whole sentence, read first (builders/doBuilders.ts).
  const rootNodes = useNodeGraphStore(s => s.nodes);
  const builderRead = useMemo(() => readSafely('the builder reading', text, () => {
    const c = readBuilderCommand(text);
    return c ? planBuilderCommand(c, { nodes: rootNodes, selected: scope.selected }) : null;
  }, null as BuilderPlan | null), [text, rootNodes, scope.selected]);
  const builder = builderRead.value;
  // A builder phrase about a built scene's recipe ("show the recipe"): the recipe, coloured.
  const builderRecipe = useMemo(() => readSafely('the builder recipe', text, () => {
    const a = builder?.action;
    if (!a || (a.kind !== 'show-recipe' && a.kind !== 'copy-recipe' && a.kind !== 'edit-scene')) return null;
    const id = a.kind === 'edit-scene' ? a.sceneId : a.nodeId;
    const nd = rootNodes.find(x => x.id === id);
    const r = nd ? builderRecipeOf(nd, []) : null;
    return r?.kind === 'scene' ? r.text : null;
  }, null as string | null).value, [builder, rootNodes, text]);
  // "surprise me [small|large] [2d|3d]": a random line, shown before it runs (lang/surprise.ts).
  const surpriseRead = useMemo(() => readSafely('“surprise me”', text, () => {
    const sp = builder ? null : readSurpriseCommand(text);
    // Plain "surprise me" (maybe with a seed) makes a graph inspired by your graphs and the examples;
    // a size, a dialect or "random line" makes a line of the language, as before.
    const inspired = !!sp && !sp.size && !sp.dialect && !/\b(line|statement)\b/i.test(text);
    return { surprise: sp, made: sp && !inspired ? surpriseLine({ ...sp, seed: sp.seed ?? seed }) : null, inspired: inspired ? { seed: sp!.seed } : null };
  }, { surprise: null, made: null, inspired: null }), [text, builder, seed]);
  const surprise = surpriseRead.value.surprise;
  const surpriseMade = surpriseRead.value.made;
  const surpriseInspired = surpriseRead.value.inspired;
  // The line in the shared language (lang/run.ts): canonical text runs through the same executors as plain English.
  const lineRead = useMemo(() => readSafely('the line reader', text, () => (text.trim() && !builder && !surprise ? readLine(text, { seed }) : null), null as LineRead | null), [text, builder, surprise, seed]);
  const line = lineRead.value;
  const canonicalRun = line && readsCanonically(line) ? line : null;
  const runText = canonicalRun?.dialect === 'picture' ? canonicalRun.picture!.sentence! : text;
  const otherDialect = canonicalRun && canonicalRun.dialect !== 'picture' ? canonicalRun : null;
  const planRead = useMemo(() => {
    const empty: DoPlan = { steps: [], reading: [], unknown: [] };
    return text.trim() && !builder && !otherDialect && !surprise ? readSafely('the phrase reader', runText, () => parseDo(runText, scope), empty) : { value: empty, error: null };
  }, [runText, text, scope, builder, otherDialect, surprise]);
  const plan = planRead.value;
  // The command language (doCommands.ts): every clause, previewed on a copy of the graph.
  const [picks, setPicks] = useState<Record<string, string>>({});
  const cmdRead = useMemo(() => {
    if (!text.trim() || plan.intent || builder || otherDialect || surprise) return { value: null, error: null };
    return readSafely('the command preview', runText, () => execCommand(runText, scope.nodes, { selected: scope.selected, picks, topLevel: scope.topLevel }), null as CommandPlan | null);
  }, [runText, text, scope, picks, plan.intent, builder, otherDialect, surprise]);
  const cmd = cmdRead.value;
  // The canonical line under the bar: what was typed in the language's own words (or ✓ when it already is).
  const canonical = useMemo(() => {
    if (canonicalRun) return canonicalRun.canonical;
    if (!cmd || !(cmd.ok || cmd.steps.length) || plan.intent) return null;
    try { return canonicalOf(text, scope); } catch { return null; }
  }, [canonicalRun, cmd, plan.intent, text, scope]);
  // Mistakes in a line that is meant as canonical (it reads as nothing else).
  const langErrors = line && line.errors.length && !(cmd && (cmd.ok || cmd.steps.length)) && (/[·=→@{]|->/.test(text) || line.dialect !== 'picture' || line.errors.some(e => /mixes a 3D scene/.test(e.message))) ? line.errors : [];
  const editing = !!cmd && !cmd.phrase;
  const pickClause = cmd?.clauses.find(c => c.pick);
  const [hoverPick, setHoverPick] = useState<string | null>(null);
  // Point at nodes on the canvas: a pick's candidates (or the hovered one), else what the steps change.
  useEffect(() => {
    const live = new Set(scope.nodes.map(nd => nd.id));
    const ids = hoverPick ? [hoverPick]
      : pickClause?.pick ? pickClause.pick.options.map(o => o.id)
        : editing ? [...new Set(cmd!.steps.flatMap(st => st.touched))].filter(id => live.has(id)) : [];
    setDoBarHighlight(ids.length ? ids : null);
  }, [cmd, editing, pickClause, hoverPick, scope.nodes]);
  useEffect(() => () => setDoBarHighlight(null), []);
  const reports: ConnectionReport[] = useMemo(() => readSafely('the connection check', text, () => {
    const wires = check ? [check] : plan.intent === 'check' ? selectionWires(scope.nodes, scope.selected) : [];
    if (!wires.length) return [];
    const t = rankTables();
    return wires.map(w => checkConnection(w, t)).filter((r): r is ConnectionReport => !!r);
  }, [] as ConnectionReport[]).value, [check, plan.intent, scope, text]);
  useEffect(() => {
    if (plan.intent !== 'teach') return;
    setPanel('teach');
    setTeachPhrase(text.trim().replace(/^teach( the do bar)?\s*/i, ''));
  }, [plan.intent, text]);

  const fallback: Fallback[] = useMemo(() => readSafely('node search', text, (): Fallback[] => {
    if (!text.trim() || plan.intent || builder || otherDialect || surprise || langErrors.length) return [];
    // An output phrase or a type refusal with its fixes is an answer, not a miss.
    if (plan.steps.some(st => st.kind === 'scene-output') || plan.fixes?.length) return [];
    // A phrase read only by guessing at typos ("sine" ≈ "shine") gives way to an idiom of that name.
    const heads = plan.reading.filter(r => /^(do|shape):/.test(r.as));
    const guessed = heads.length > 0 && heads.every(r => r.as.endsWith('(guessed)'));
    const idiomFirst = guessed ? matchIdioms(text, 3) : [];
    if ((heads.length || editing) && !idiomFirst.length) return [];
    const q = text.trim().toLowerCase().replace(/^(add|make|put|a|an)\s+/, '');
    // The flow strip's next stage leans in a little within a match tier (structure/boost.ts).
    const target = currentStageTarget();
    const nodes = getOfferedDefinitions().filter(d => !HIDDEN_TYPES.has(d.type))
      .map(d => ({ d, s: scoreNodeDef(d, q) })).filter(x => x.s > 0)
      // Taste adds at most 3 points (match tiers are 10+ apart), never to an exact match (120).
      .map(x => ({ ...x, s: x.s + (inTargetStage(x.d.type, target) ? STAGE_SEARCH_POINTS : 0) + (x.s >= 120 ? 0 : 3 * nodeTypeLean(taste, x.d.type)) })).sort((a, b) => b.s - a.s).slice(0, 5)
      .map(x => ({ kind: 'node' as const, type: x.d.type, label: x.d.label, detail: x.d.category }));
    const idioms = (idiomFirst.length ? idiomFirst : matchIdioms(text, 3)).map(spec => ({ kind: 'idiom' as const, spec }));
    return idiomFirst.length ? idioms : [...nodes, ...idioms];
  }, [] as Fallback[]).value, [text, plan, editing, builder, otherDialect, surprise, langErrors.length, taste]);
  // A reading that threw (logged by readSafely): one line in the bar instead of a blank app.
  const readError = builderRead.error ?? surpriseRead.error ?? lineRead.error ?? planRead.error ?? cmdRead.error;
  useEffect(() => setActive(0), [fallback.length]);
  // Fallback results with a plan: the plan was only a guess at a typo, and an idiom has that name.
  const idiomWins = !editing && plan.steps.length > 0 && fallback.length > 0;
  const showCommand = !!cmd && !idiomWins && cmd.clauses.length > 0 && (editing || cmd.steps.length > 0 || cmd.clauses.some(c => c.status !== 'ok' && fallback.length === 0));

  const ranLine = () => { pushHistory(text); setSeed(freshSeed()); setHistIndex(null); };
  const runOther = (r: LineRead) => {
    const st = useNodeGraphStore.getState();
    if (r.dialect === 'grid') {
      const ran = st.runDoPlan(gridPlan(r.grid!, scope.selected[0]), text.trim());
      if (ran.length) toast.info(`Do: ${text.trim()}`, { message: 'Grid Rules added. Undo takes it back.' });
    } else {
      if (st.activeGroupPath.length) st.exitToRoot();
      const nodes = useNodeGraphStore.getState().nodes;
      const nextId = () => useNodeGraphStore.getState().newNodeId();
      if (r.dialect === 'scene') {
        const made = sceneNodes(nodes, r.scene!, nextId, spawnPoint());
        useNodeGraphStore.getState().setNodesRewritten(made.nodes, `Do: ${text.trim()}`);
        useNodeGraphStore.getState().focusNode(made.focusId);
        toast.success('3D scene built', { message: 'Right-click the Scene Group → Edit in Scene Builder to change it. Undo takes it back.' });
      } else if (r.dialect === 'agents') {
        const made = agentsNodes(nodes, r.agents!, nextId, spawnPoint());
        useNodeGraphStore.getState().setNodesRewritten(made.nodes, `Do: ${text.trim()}`);
        useNodeGraphStore.getState().focusNode(made.groupId);
        toast.success('Agents added with these rules', { message: 'Double-click the group to open its rules. Undo takes it back.' });
      }
    }
    ranLine();
    closeDoBar();
  };
  const run = () => {
    if (surpriseMade) { setText(surpriseMade.line); setCaret(surpriseMade.line.length); return; }
    if (surpriseInspired) { pushHistory(text); setText(''); setCaret(0); void startSurprise({ seed: surpriseInspired.seed }); return; }
    if (carouselOpen && !text.trim()) { keepSurprise(); closeDoBar(); return; }
    if (evolveOpen && !text.trim()) { keepEvolveSession(); closeDoBar(); return; }
    if (otherDialect) { runOther(otherDialect); return; }
    if (builder) {
      if (!builder.action) return;
      closeDoBar();
      runBuilderAction(builder.action);
      return;
    }
    if (plan.intent === 'teach') { teach(); return; }
    if (cmd?.ok && !idiomWins) {
      const ran = useNodeGraphStore.getState().runCommand(runText.trim(), picks);
      if (ran.ok) { ranLine(); toast.info(`Do: ${text.trim()}`, { message: `${ran.steps.map(st => st.label).join(' → ')}. Undo takes it all back.` }); }
      else toast.info('Didn’t run', { message: ran.clauses.find(c => c.status !== 'ok')?.message ?? 'The graph changed: try again.' });
      closeDoBar();
      return;
    }
    if (cmd && editing) return;
    const f = fallback[active];
    if (f) pick(f);
  };
  const pick = (f: Fallback) => {
    const st = useNodeGraphStore.getState();
    if (f.kind === 'node') st.addNode(f.type, spawnPoint());
    else st.addBuiltNode(idiomBlock(f.spec, 'idiom', spawnPoint().x, spawnPoint().y), f.spec.idiom.name);
    closeDoBar();
  };
  const teach = () => {
    const r = teachFromSelection(scope.nodes, scope.selected, teachPhrase);
    if (!r.ok) { setTeachError(r.error); return; }
    toast.success(`Taught “${phraseLabel(r.move.phrase)}”`, { message: `Type it in the Do… bar${r.move.slots.length ? ` with ${r.move.slots.map(s => s.name).join(' and ')}` : ''}; the suggestions offer it too.` });
    setTeachError(null);
    setPanel('taught');
    setText('');
  };

  const muted = { fontSize: 11.5, color: tk.text.muted } as const;
  const section = (title: string, body: React.ReactNode) => (
    <div style={{ padding: '8px 12px', borderTop: `1px solid ${tk.border.subtle}`, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', color: tk.text.faint, textTransform: 'uppercase' }}>{title}</span>
      {body}
    </div>
  );

  return createPortal(
    <div {...portalGuard} role="dialog" aria-label="Do…" data-do-bar
      onPointerDown={e => e.stopPropagation()}
      style={{
        position: 'fixed', top: 150, left: '50%', transform: 'translateX(-50%)', zIndex: 1000, width: WIDTH, maxWidth: 'calc(100vw - 32px)',
        background: tk.bg.panel, color: tk.text.primary, border: `1px solid ${tk.border.default}`, borderRadius: radius.lg, boxShadow: tk.shadow.popover,
        font: `13px ${fontFamily.ui}`, overflow: 'hidden', maxHeight: 'calc(100vh - 200px)', display: 'flex', flexDirection: 'column',
      }}>
      <SurpriseStrip />
      <EvolveStrip />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 8px 8px 12px' }}>
        <Icon name="edit" size={15} style={{ color: tk.accent.base }} />
        <input
          ref={inputRef}
          value={text}
          onChange={e => { setText(e.target.value); setCaret(e.target.selectionStart); }}
          onSelect={e => setCaret((e.target as HTMLInputElement).selectionStart)}
          onKeyDown={e => {
            // Tab takes a suggestion, Enter still runs the phrase.
            if (e.key !== 'Enter' && ta.onKeyDown(e)) return;
            if (e.key === 'Enter') { e.preventDefault(); run(); }
            // ← / → step through Surprise candidates while the line is empty.
            if (carouselOpen && !text && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); void stepSurprise(e.key === 'ArrowLeft' ? -1 : 1); return; }
            if (evolveOpen && !text && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); focusEvolve(e.key === 'ArrowLeft' ? 0 : 1); return; }
            // ↑ / ↓ walk what you typed before (history keeps the words you typed) when no list is open.
            if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !fallback.length) {
              const list = readHistory();
              const i = histIndex ?? list.length;
              const next = e.key === 'ArrowUp' ? Math.max(0, i - 1) : Math.min(list.length, i + 1);
              const h = historyAt(list, next);
              if (h !== null || next === list.length) { e.preventDefault(); setHistIndex(next); const v = h ?? ''; setText(v); setCaret(v.length); }
              return;
            }
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, Math.max(0, fallback.length - 1))); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(0, a - 1)); }
          }}
          placeholder="Do… e.g. circle with a glow, falloff 8 · repeat 6 times around · tone map it · is this typical?"
          aria-label="Do"
          data-do-input
          style={{ flex: 1, minWidth: 0, border: 0, outline: 'none', background: 'transparent', color: tk.text.primary, font: `14px ${fontFamily.ui}` }}
        />
        <IconButton icon="dice" size="sm" label="Surprise me: new graphs inspired by 2–3 of your graphs and the examples, to step through with ‹ ›. Enter keeps one (it replaces this graph; Undo brings it back), Escape puts this graph back" data-do-surprise
          onClick={() => { void startSurprise(); requestAnimationFrame(() => inputRef.current?.focus()); }} />
        <DeepToggle />
        <EvolveToggle />
        <IconButton icon="thumbUp" size="sm" active={panel === 'taste'} label="Your taste: what Surprise, Deep and Evolve learned you like (all on this device)" data-do-taste onClick={() => setPanel(p => (p === 'taste' ? 'none' : 'taste'))} />
        <IconButton icon="info" size="sm" label="Commands: every verb, with examples to try" onClick={() => { closeDoBar(); openCommandsRef(); }} data-do-help />
        <IconButton icon="code" size="sm" active={panel === 'script'} label="Show as commands: this graph as Do… lines" data-do-script onClick={() => setPanel(p => (p === 'script' ? 'none' : 'script'))} />
        <IconButton icon="star" size="sm" active={panel === 'taught'} label="Your taught phrases" onClick={() => setPanel(p => (p === 'taught' ? 'none' : 'taught'))} />
        <IconButton icon="close" size="sm" label="Close" shortcut="esc" onClick={closeDoBar} />
      </div>

      {ta.items.length > 0 && <div style={{ padding: '0 8px 6px' }}><AssistList items={ta.items} active={ta.active} onPick={ta.pick} onHover={ta.setActive} /></div>}
      {ta.signature && text.trim() && !plan.steps.some(st => st.kind === 'scene-output') && <div style={{ padding: '0 8px 6px' }}><SignatureLine sig={ta.signature} /></div>}
      <div style={{ overflowY: 'auto', minHeight: 0 }}>
        {/* The line in the language's own words: click to edit it (✓ when you typed it that way) */}
        {canonical && !builder && (
          <button type="button" data-do-canonical title={text.trim() === canonical ? 'You typed the canonical line' : 'The same, in the language\'s own words: click to edit it'}
            onClick={() => { setText(canonical); setCaret(canonical.length); inputRef.current?.focus(); }}
            style={{ display: 'flex', gap: 8, alignItems: 'baseline', width: '100%', padding: '0 12px 6px', border: 0, background: 'transparent', cursor: 'pointer', textAlign: 'left', color: tk.text.muted, font: `11.5px ${fontFamily.ui}` }}>
            <span style={{ color: text.trim() === canonical ? tk.status.success : tk.text.faint, flexShrink: 0 }}>{text.trim() === canonical ? '✓' : '→'}</span>
            <code style={{ font: `11.5px/1.5 ${fontFamily.mono}`, overflowWrap: 'anywhere' }}><RecipeCode text={canonical} errors={[]} wordKind={canonicalRun?.dialect === 'scene' ? undefined : wordKindFor(canonicalRun?.dialect === 'grid' ? 'grid' : canonicalRun?.dialect === 'agents' ? 'agents' : 'picture', 'edit')} /></code>
          </button>
        )}
        {/* What random values became, with a new roll and Keep */}
        {canonicalRun && canonicalRun.resolved.length > 0 && (
          <div data-do-random style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', padding: '0 12px 8px' }}>
            {canonicalRun.resolved.map((x, i) => <span key={i} style={{ font: `11px ${fontFamily.mono}`, padding: '1px 6px', borderRadius: 6, background: tk.bg.hover, color: tk.text.secondary }}>{x.key}={x.from} → <b>{x.to}</b></span>)}
            <Button size="sm" variant="ghost" icon="dice" onClick={() => setSeed(freshSeed())} data-do-reroll>Roll again</Button>
            <Button size="sm" variant="ghost" icon="check" onClick={() => { if (canonicalRun.canonical) { setText(canonicalRun.canonical); setCaret(canonicalRun.canonical.length); } }} title="Write the drawn values into the line">Keep these</Button>
            {!/seed\s*=?\s*\w/i.test(text) && <span style={muted}>seed {canonicalRun.seed}</span>}
          </div>
        )}
        {/* "surprise me": an inspired graph, made on Enter */}
        {surpriseInspired && section('Enter makes it', (
          <span style={muted} data-do-surprise-inspired>
            New graphs inspired by 2–3 of your graphs, GLSL and the examples{surpriseInspired.seed != null ? `, starting with seed ${surpriseInspired.seed}` : ''}, to step through with ‹ ›. Enter keeps one (it replaces this graph); Escape puts this graph back. Add “line” for a random line of the language instead.
          </span>
        ))}
        {/* "surprise me": the line it made */}
        {surpriseMade && section('Enter puts this line in the bar', (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }} data-do-surprise-line>
            <code style={{ font: `12px/1.5 ${fontFamily.mono}`, overflowWrap: 'anywhere' }}><RecipeCode text={surpriseMade.line} errors={[]} wordKind={surpriseMade.dialect === '3d' ? undefined : wordKindFor('picture', 'edit')} /></code>
            <span style={muted}>A {surpriseMade.size} {surpriseMade.dialect === '3d' ? '3D scene' : '2D picture'} · seed {surpriseMade.seed}. Then Enter again runs it; edit it first if you like.</span>
            <span style={{ display: 'flex', gap: 6 }}><Button size="sm" variant="secondary" icon="dice" onClick={() => setSeed(freshSeed())}>Another</Button></span>
          </div>
        ))}
        {/* A line in another dialect: what Enter makes */}
        {otherDialect && section(otherDialect.dialect === 'grid' ? 'Enter adds Grid Rules' : otherDialect.dialect === 'scene' ? 'Enter builds a 3D scene' : 'Enter adds an Agents group with these rules', (
          <span style={muted} data-do-dialect={otherDialect.dialect}>
            {otherDialect.dialect === 'grid' ? 'A Grid Rules node with this rule (beside the selection, or on the Output when the graph is empty). Its editor\'s Recipe tab shows the same line.'
              : otherDialect.dialect === 'scene' ? 'A new Scene Group, march loop and camera, beside what is there, on the Output. Edit it later in the 3D Scene Builder.'
                : 'Emit → Agents (these rules) → Deposit → Trail field → palette, on the Output. Its rules editor\'s Recipe tab shows the same text.'}
          </span>
        ))}
        {/* Mistakes in a canonical line, at their line and column */}
        {langErrors.length > 0 && section('Can’t read that line', (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }} data-do-lang-errors>
            {langErrors.map((e, i) => (
              <span key={i} style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 12, color: tk.status.warningText }}>
                <b style={{ font: `600 11px ${fontFamily.mono}` }}>{e.col}</b>{e.message}
                {e.fixes?.map(f => <Button key={f} size="sm" variant="ghost" onClick={() => { const v = `${text.slice(0, e.at)}${f}${text.slice(e.end)}`; setText(v); setCaret(v.length); }}>{f}</Button>)}
              </span>
            ))}
          </div>
        ))}
        {/* A builder phrase: what Enter opens */}
        {builder && section(builder.action ? 'Enter opens' : 'Can’t open yet', (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }} data-do-builder={builder.id}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
              <Icon name={/scene/.test(builder.id) ? 'cube' : /grid/.test(builder.id) ? 'grid' : /agent/.test(builder.id) ? 'swarm' : 'book'} size={14} style={{ color: tk.accent.base }} />
              <b style={{ fontWeight: 600 }}>{builder.label}</b>
            </span>
            {builder.problem && <span style={{ fontSize: 12, color: tk.status.warningText }}>{builder.problem}</span>}
            {builderRecipe && (
              <code data-do-recipe style={{ font: `11.5px/1.5 ${fontFamily.mono}`, padding: '4px 8px', borderRadius: radius.control, background: tk.bg.subtle, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflowWrap: 'anywhere' }}>
                <RecipeCode text={builderRecipe} errors={[]} />
              </code>
            )}
          </div>
        ))}
        {/* The plan: what runs on Enter, clause by clause */}
        {showCommand && cmd && section(cmd.ok ? `Enter runs · ${cmd.steps.length} step${cmd.steps.length === 1 ? '' : 's'} · one undo` : pickClause ? 'Pick one, then Enter' : 'Can’t run yet', (
          <CommandPreview cmd={cmd} onPick={(key, id) => setPicks(p => ({ ...p, [key]: id }))} onHoverPick={setHoverPick}
            onSuggest={(clause, s2) => { setText(cmd.clauses.length === 1 ? s2 : cmd.clauses.map(c => (c.index === clause.index ? s2 : c.text)).join(', ')); inputRef.current?.focus(); }} />
        ))}
        {/* A 3D output phrase: the recipe clause it writes into the scene */}
        {plan.steps.filter((st): st is Extract<typeof st, { kind: 'scene-output' }> => st.kind === 'scene-output').map((st, i) => (
          <div key={`so${i}`} data-do-recipe style={{ padding: '0 12px 8px', display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 11.5, color: tk.text.muted }}>
            Recipe <code style={{ font: `11.5px ${fontFamily.mono}` }}><RecipeCode text={outputClause(st.output)} errors={[]} /></code>
          </div>
        ))}
        {readError && text.trim() && (
          <div data-do-read-error style={{ padding: '6px 12px 8px', fontSize: 12, color: tk.status.warningText }}>
            Couldn’t read this line. Keep typing, or try other words (the details are in the console).
          </div>
        )}
        {plan.problem && !idiomWins && !showCommand && <div style={{ padding: '6px 12px 8px', fontSize: 12, color: tk.status.warningText }} data-do-problem>{plan.problem}</div>}
        {plan.fixes && plan.fixes.length > 0 && !idiomWins && !editing && (
          <div style={{ padding: '0 12px 8px', display: 'flex', flexWrap: 'wrap', gap: 6 }} data-do-fixes>
            {plan.fixes.map(f => (
              <Button key={f.label} size="sm" variant="secondary" icon="check" data-do-fix={f.label} onClick={() => {
                const ran = useNodeGraphStore.getState().runDoPlan(f.plan, `${text.trim()} (fixed)`);
                if (ran.length) toast.info(`Do: ${text.trim()}`, { message: `${ran.join(' → ')}. Undo takes it all back.` });
                closeDoBar();
              }}>{f.label}</Button>
            ))}
          </div>
        )}
        {(plan.reading.length > 0 || plan.unknown.length > 0) && !plan.intent && !editing && (
          <div style={{ padding: '0 12px 8px', display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {plan.reading.map((r, i) => <span key={i} title={r.as} style={{ fontSize: 11, padding: '1px 6px', borderRadius: 6, background: tk.bg.hover, color: tk.text.secondary }}>{r.text} <span style={{ color: tk.text.faint }}>· {r.as}</span></span>)}
            {plan.unknown.map((w, i) => <span key={`u${i}`} title="Not a word the Do… bar knows" style={{ fontSize: 11, padding: '1px 6px', borderRadius: 6, color: tk.text.faint, textDecoration: 'line-through' }}>{w}</span>)}
          </div>
        )}

        {/* Is this typical? */}
        {(check || plan.intent === 'check') && section('Is this typical?', reports.length ? reports.map((r, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 4 }} data-do-check>
            <b style={{ fontSize: 12.5 }}>{r.what}</b>
            <span style={{ fontSize: 12.5, color: r.rare ? tk.status.warningText : tk.text.secondary }}>{r.message}</span>
            {r.alternatives.map(a => <span key={a} style={{ ...muted, paddingLeft: 10 }}>· {a}</span>)}
            {r.teach && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={muted}>You build this often.</span>
                <Button size="sm" variant="secondary" onClick={() => { setTeachPhrase(r.what.toLowerCase().replace(/ → /g, ' ').replace(/[^a-z0-9 ]/g, '')); setPanel('teach'); }}>Teach this?</Button>
              </span>
            )}
          </div>
        )) : <span style={muted}>Select a wired node, or two or more wired nodes, to check how common their wiring is.</span>)}

        {/* Teach */}
        {panel === 'teach' && section('Teach the Do… bar', (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={muted}>Saves the {scope.selected.length || 'no'} selected node{scope.selected.length === 1 ? '' : 's'} and the wires between them as a phrase. Slots in braces fill settings: “neon edge {'{colour}'} {'{width}'}”.</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <input value={teachPhrase} onChange={e => setTeachPhrase(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); teach(); } }}
                placeholder="neon edge {colour} {width}" aria-label="Phrase to teach" data-teach-phrase
                style={{ flex: 1, minWidth: 0, height: 28, padding: '0 8px', borderRadius: radius.control, border: `1px solid ${tk.border.default}`, background: tk.bg.subtle, color: tk.text.primary, font: `12.5px ${fontFamily.mono}` }} />
              <Button size="sm" variant="primary" onClick={teach} disabled={!scope.selected.length}>Teach</Button>
            </div>
            {teachError && <span style={{ fontSize: 12, color: tk.status.warningText }}>{teachError}</span>}
          </div>
        ))}

        {/* The graph as commands (lang/fromGraph.ts) */}
        {panel === 'script' && section('This graph as commands', <ScriptPanel nodes={scope.nodes} topLevel={scope.topLevel} />)}

        {/* Taught phrases */}
        {panel === 'taught' && section(`Taught (${taughtMoves().length})`, <TaughtList />)}
        {panel === 'taste' && section('Your taste', <TastePanel />)}

        {/* Search fallback */}
        {fallback.length > 0 && section('Not a phrase it knows: add a node', (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {fallback.map((f, i) => (
              <button key={f.kind === 'node' ? f.type : f.spec.idiom.id} type="button" onClick={() => pick(f)} onMouseEnter={() => setActive(i)} data-do-fallback
                style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '4px 6px', border: 0, borderRadius: radius.control, cursor: 'pointer', textAlign: 'left', background: i === active ? tk.bg.hover : 'transparent', color: tk.text.primary, font: `12.5px ${fontFamily.ui}` }}>
                <b style={{ fontWeight: 600 }}>{f.kind === 'node' ? f.label : f.spec.idiom.name}</b>
                <span style={{ fontSize: 11, color: tk.text.muted }}>{f.kind === 'node' ? f.detail : `idiom${f.spec.idiom.use ? ` · ${f.spec.idiom.use}` : ''} · an Expression Block (${f.spec.result})`}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>,
    document.body,
  );
}

/**
 * The level being edited as Do… bar lines (lang/fromGraph.ts graphToScript): what you would type to
 * build it on an empty graph, with `# cannot express` where the language has no words yet. Copy
 * takes the lines; they run one at a time in the bar.
 */
function ScriptPanel({ nodes, topLevel }: { nodes: GraphNode[]; topLevel: boolean }) {
  const tk = useTokens();
  const [copied, setCopied] = useState(false);
  const printed = useMemo(() => { try { return graphToScript(nodes); } catch (e) { return { error: (e as Error).message }; } }, [nodes]);
  if ('error' in printed) return <span style={{ fontSize: 12, color: tk.status.warningText }}>Couldn’t print this graph: {printed.error}</span>;
  const gaps = printed.lines.filter(l => l.form === 'comment').length;
  const copy = async () => {
    try { await navigator.clipboard.writeText(printed.script); setCopied(true); setTimeout(() => setCopied(false), 1400); } catch { /* the text is still selectable */ }
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }} data-do-script-panel>
      <span style={{ fontSize: 11.5, color: tk.text.muted }}>
        {printed.lines.length - gaps} line{printed.lines.length - gaps === 1 ? '' : 's'} build{printed.lines.length - gaps === 1 ? 's' : ''} {topLevel ? 'this graph' : 'this group’s level'} on an empty graph, one line at a time{gaps ? `; ${gaps} thing${gaps === 1 ? '' : 's'} the language can’t say yet (# lines)` : ''}.
      </span>
      <pre style={{ margin: 0, maxHeight: 260, overflow: 'auto', padding: '6px 8px', borderRadius: radius.control, background: tk.bg.subtle, font: `11.5px/1.5 ${fontFamily.mono}`, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {printed.lines.map((l, i) => <div key={i} style={{ color: l.form === 'comment' ? tk.text.faint : tk.text.primary }}>{l.text}</div>)}
      </pre>
      <div style={{ display: 'flex', gap: 6 }}>
        <Button size="sm" variant="secondary" onClick={copy} data-do-script-copy>{copied ? 'Copied' : 'Copy'}</Button>
      </div>
    </div>
  );
}

function TaughtList() {
  const tk = useTokens();
  const list = taughtMoves();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const download = () => {
    const blob = new Blob([exportTaught()], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'taught-phrases.json' });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const upload = () => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.json' });
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      const r = importTaught(await f.text());
      if (r.ok) toast.success(`Imported ${r.count} taught phrase${r.count === 1 ? '' : 's'}`);
      else toast.error('Couldn’t import that file', { message: r.error });
    };
    input.click();
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }} data-taught-list>
      {!list.length && <span style={{ fontSize: 12, color: tk.text.muted }}>None yet. Select some wired nodes and type “teach …”.</span>}
      {list.map(t => (
        <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {editing === t.id ? (
            <input autoFocus value={draft} onChange={e => setDraft(e.target.value)} aria-label="Rename phrase"
              onKeyDown={e => {
                if (e.key === 'Enter') { const r = renameTaught(t.id, draft); if (r.ok) setEditing(null); else toast.info('Not renamed', { message: r.error }); }
                if (e.key === 'Escape') { e.stopPropagation(); setEditing(null); }
              }}
              style={{ flex: 1, height: 26, padding: '0 6px', borderRadius: radius.control, border: `1px solid ${tk.border.default}`, background: tk.bg.subtle, color: tk.text.primary, font: `12px ${fontFamily.mono}` }} />
          ) : (
            <span style={{ flex: 1, minWidth: 0, font: `12px ${fontFamily.mono}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={`${t.nodes.length} node${t.nodes.length === 1 ? '' : 's'}${t.entry ? `, works on ${t.entry.kind}` : ', makes something new'}`}>{t.phrase}</span>
          )}
          <IconButton icon="edit" size="sm" label="Rename" onClick={() => { setEditing(t.id); setDraft(t.phrase); }} />
          <IconButton icon="trash" size="sm" tone="danger" label="Delete" onClick={() => deleteTaught(t.id)} />
        </div>
      ))}
      <div style={{ display: 'flex', gap: 6, paddingTop: 4 }}>
        <Button size="sm" variant="ghost" icon="export" onClick={download} disabled={!list.length}>Export</Button>
        <Button size="sm" variant="ghost" icon="import" onClick={upload}>Import</Button>
      </div>
    </div>
  );
}

/** The steps of a command, numbered across clauses, with the exact nodes, wires and values; a clause it can't read is marked, with "did you mean". */
function CommandPreview({ cmd, onPick, onHoverPick, onSuggest }: {
  cmd: CommandPlan; onPick: (key: string, id: string) => void; onHoverPick: (id: string | null) => void; onSuggest: (clause: CmdClause, text: string) => void;
}) {
  const tk = useTokens();
  let num = 0;
  const many = cmd.clauses.length > 1;
  const detail = (s: CmdStep) => [
    ...(s.adds.length ? [`adds ${s.adds.join(', ')}`] : []),
    ...s.wires.map(w => `+ ${w}`),
    ...s.unwires.map(w => `− ${w}`),
    ...s.params,
    ...s.removes.map(r => `removes ${r}`),
    ...s.notes,
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }} data-do-plan>
      {cmd.clauses.map(c => (
        <div key={c.index} data-do-clause={c.status} style={{
          display: 'flex', flexDirection: 'column', gap: 3,
          ...(c.status !== 'ok' ? { padding: '6px 8px', borderRadius: radius.control, background: alpha(c.status === 'pick' ? tk.accent.base : tk.status.warningText, 0.1) } : {}),
        }}>
          {many && <span style={{ fontSize: 11, color: c.status === 'ok' ? tk.text.faint : tk.status.warningText, fontStyle: 'italic' }}>“{c.text}”</span>}
          {c.steps.map((s, i) => {
            num++;
            return (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <span style={{ width: 18, height: 18, borderRadius: 9, background: alpha(tk.accent.base, 0.14), color: tk.accent.base, fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{num}</span>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                  <span data-do-step>{s.label}</span>
                  {detail(s).map((d, k) => <span key={k} style={{ font: `11px ${fontFamily.mono}`, color: d.startsWith('−') ? tk.text.faint : tk.text.muted, overflowWrap: 'anywhere' }}>{d}</span>)}
                </span>
              </div>
            );
          })}
          {c.status !== 'ok' && <span style={{ fontSize: 12, color: c.status === 'pick' ? tk.text.primary : tk.status.warningText }} data-do-problem>{c.message}</span>}
          {c.pick && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }} data-do-pick>
              {c.pick.options.map((o, k) => (
                <button key={o.id} type="button" onClick={() => { onHoverPick(null); onPick(c.pick!.key, o.id); }} onMouseEnter={() => onHoverPick(o.id)} onMouseLeave={() => onHoverPick(null)}
                  style={{ display: 'flex', gap: 8, padding: '3px 6px', border: 0, borderRadius: radius.control, background: 'transparent', color: tk.text.primary, cursor: 'pointer', textAlign: 'left', font: `12px ${fontFamily.ui}` }}>
                  <b style={{ color: tk.accent.base }}>{k + 1}</b>{o.label}
                </button>
              ))}
            </div>
          )}
          {c.suggestions && c.suggestions.length > 0 && (
            <span style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }} data-do-suggest>
              <span style={{ fontSize: 11.5, color: tk.text.muted }}>Did you mean</span>
              {c.suggestions.map(sg => (
                <button key={sg} type="button" onClick={() => onSuggest(c, sg)}
                  style={{ padding: '1px 7px', borderRadius: 6, border: `1px solid ${tk.border.subtle}`, background: tk.bg.subtle, color: tk.text.primary, cursor: 'pointer', font: `11.5px ${fontFamily.mono}` }}>{sg}</button>
              ))}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
