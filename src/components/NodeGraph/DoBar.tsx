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
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
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

const WIDTH = 560;

export function DoBar() {
  const open = useDoBar(s => s.open);
  const seq = useDoBar(s => s.seq);
  if (!open) return null;
  return <Bar key={seq} initial={open.text ?? ''} check={open.check} />;
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
  const [panel, setPanel] = useState<'none' | 'teach' | 'taught'>(/^teach\b/i.test(initial) ? 'teach' : 'none');
  const [teachPhrase, setTeachPhrase] = useState(initial.replace(/^teach( the do bar)?\s*/i, ''));
  const [teachError, setTeachError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [caret, setCaret] = useState<number | null>(initial.length);
  const scope = useScope();
  // Type-ahead: the word at the caret from the vocabulary, and the named action's settings.
  const ta = useTypeAhead(text, caret, doBarAssist, (next, at) => {
    setText(next); setCaret(at);
    requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.setSelectionRange(at, at); });
  });
  useSyncExternalStore(subscribeTaught, taughtVersion, taughtVersion);

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 0); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); closeDoBar(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const plan: DoPlan = useMemo(() => (text.trim() ? parseDo(text, scope) : { steps: [], reading: [], unknown: [] }), [text, scope]);
  // The command language (doCommands.ts): every clause, previewed on a copy of the graph.
  const [picks, setPicks] = useState<Record<string, string>>({});
  const cmd: CommandPlan | null = useMemo(() => {
    if (!text.trim() || plan.intent) return null;
    try { return execCommand(text, scope.nodes, { selected: scope.selected, picks, topLevel: scope.topLevel }); } catch { return null; }
  }, [text, scope, picks, plan.intent]);
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
  const reports: ConnectionReport[] = useMemo(() => {
    const wires = check ? [check] : plan.intent === 'check' ? selectionWires(scope.nodes, scope.selected) : [];
    if (!wires.length) return [];
    const t = rankTables();
    return wires.map(w => checkConnection(w, t)).filter((r): r is ConnectionReport => !!r);
  }, [check, plan.intent, scope]);
  useEffect(() => {
    if (plan.intent !== 'teach') return;
    setPanel('teach');
    setTeachPhrase(text.trim().replace(/^teach( the do bar)?\s*/i, ''));
  }, [plan.intent, text]);

  const fallback: Fallback[] = useMemo(() => {
    if (!text.trim() || plan.intent) return [];
    // An output phrase or a type refusal with its fixes is an answer, not a miss.
    if (plan.steps.some(st => st.kind === 'scene-output') || plan.fixes?.length) return [];
    // A phrase read only by guessing at typos ("sine" ≈ "shine") gives way to an idiom of that name.
    const heads = plan.reading.filter(r => /^(do|shape):/.test(r.as));
    const guessed = heads.length > 0 && heads.every(r => r.as.endsWith('(guessed)'));
    const idiomFirst = guessed ? matchIdioms(text, 3) : [];
    if ((heads.length || editing) && !idiomFirst.length) return [];
    const q = text.trim().toLowerCase().replace(/^(add|make|put|a|an)\s+/, '');
    const nodes = getOfferedDefinitions().filter(d => !HIDDEN_TYPES.has(d.type))
      .map(d => ({ d, s: scoreNodeDef(d, q) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 5)
      .map(x => ({ kind: 'node' as const, type: x.d.type, label: x.d.label, detail: x.d.category }));
    const idioms = (idiomFirst.length ? idiomFirst : matchIdioms(text, 3)).map(spec => ({ kind: 'idiom' as const, spec }));
    return idiomFirst.length ? idioms : [...nodes, ...idioms];
  }, [text, plan, editing]);
  useEffect(() => setActive(0), [fallback.length]);
  // Fallback results with a plan: the plan was only a guess at a typo, and an idiom has that name.
  const idiomWins = !editing && plan.steps.length > 0 && fallback.length > 0;
  const showCommand = !!cmd && !idiomWins && cmd.clauses.length > 0 && (editing || cmd.steps.length > 0 || cmd.clauses.some(c => c.status !== 'ok' && fallback.length === 0));

  const run = () => {
    if (plan.intent === 'teach') { teach(); return; }
    if (cmd?.ok && !idiomWins) {
      const ran = useNodeGraphStore.getState().runCommand(text.trim(), picks);
      if (ran.ok) toast.info(`Do: ${text.trim()}`, { message: `${ran.steps.map(st => st.label).join(' → ')}. Undo takes it all back.` });
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
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, Math.max(0, fallback.length - 1))); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(0, a - 1)); }
          }}
          placeholder="Do… e.g. circle with a glow, falloff 8 · repeat 6 times around · tone map it · is this typical?"
          aria-label="Do"
          data-do-input
          style={{ flex: 1, minWidth: 0, border: 0, outline: 'none', background: 'transparent', color: tk.text.primary, font: `14px ${fontFamily.ui}` }}
        />
        <IconButton icon="info" size="sm" label="Commands: every verb, with examples to try" onClick={() => { closeDoBar(); openCommandsRef(); }} data-do-help />
        <IconButton icon="star" size="sm" active={panel === 'taught'} label="Your taught phrases" onClick={() => setPanel(p => (p === 'taught' ? 'none' : 'taught'))} />
        <IconButton icon="close" size="sm" label="Close" shortcut="esc" onClick={closeDoBar} />
      </div>

      {ta.items.length > 0 && <div style={{ padding: '0 8px 6px' }}><AssistList items={ta.items} active={ta.active} onPick={ta.pick} onHover={ta.setActive} /></div>}
      {ta.signature && text.trim() && !plan.steps.some(st => st.kind === 'scene-output') && <div style={{ padding: '0 8px 6px' }}><SignatureLine sig={ta.signature} /></div>}
      <div style={{ overflowY: 'auto', minHeight: 0 }}>
        {/* The plan: what runs on Enter, clause by clause */}
        {showCommand && cmd && section(cmd.ok ? `Enter runs · ${cmd.steps.length} step${cmd.steps.length === 1 ? '' : 's'} · one undo` : pickClause ? 'Pick one, then Enter' : 'Can’t run yet', (
          <CommandPreview cmd={cmd} onPick={(key, id) => setPicks(p => ({ ...p, [key]: id }))} onHoverPick={setHoverPick}
            onSuggest={(clause, s2) => { setText(cmd.clauses.length === 1 ? s2 : cmd.clauses.map(c => (c.index === clause.index ? s2 : c.text)).join(', ')); inputRef.current?.focus(); }} />
        ))}
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

        {/* Taught phrases */}
        {panel === 'taught' && section(`Taught (${taughtMoves().length})`, <TaughtList />)}

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
        {!text.trim() && !check && panel === 'none' && (
          <div style={{ padding: '4px 12px 10px', ...muted }}>
            Shapes, actions and values: “heart at the top left with rings”, “twist the space 0.5”, “glow falloff 4 red”. Edits too: “connect the noise to the output”, “switch the noise to voronoi”, “make the circle bigger”. Chain clauses with “then”: each builds on “it”. The ⓘ lists every command.
          </div>
        )}
      </div>
    </div>,
    document.body,
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
