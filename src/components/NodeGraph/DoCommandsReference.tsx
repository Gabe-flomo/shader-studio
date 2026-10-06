/**
 * DoCommandsReference — the Do… bar's Commands reference (docs/do-bar-commands.md), generated
 * from the registry (lang/commands.ts, lang/vocabulary.ts) so it can't drift from the parser.
 *
 * Every verb with its syntax, slots, words and examples; objects, modifiers, references,
 * connectors and recipes. Searchable. Each example can be tried in the bar on the current graph
 * ("Try"), or shown step by step on a small scratch graph ("Show me how": the nodes, wires and
 * values it makes, and what each new node does in the node's own words).
 *
 * Opened from the "?" in the Do… bar, Keys → Do… bar commands, and More tools.
 */
import { useMemo, useState } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { closeCommandsRef, openDoBar, useCommandsRef } from '../../suggestions/doBarStore';
import { commandReference, searchReference, REFERENCE_SECTIONS, SCRATCH_LABELS, COMMAND_LIMITS, type CommandExample, type ReferenceEntry } from '../../lang/commands';
import { execCommand } from '../../suggestions/doCommands';
import { scratchGraph } from '../../suggestions/doScratch';
import { estimateNodeHeight } from '../../store/graphLayout';
import { getNodeDefinition } from '../../nodes/definitions';

/** The modal (mounted with the canvas). */
export function CommandsReference() {
  const open = useCommandsRef(s => s.open);
  const query = useCommandsRef(s => s.query);
  if (!open) return null;
  return (
    <Modal title="Do… bar commands" subtitle="A small command language: verbs, objects, references, connectors. No AI." icon="book" width={820} height={760} onClose={closeCommandsRef}>
      <CommandsReferenceBody initialQuery={query} onTry={text => { closeCommandsRef(); openDoBar({ text }); }} />
    </Modal>
  );
}

type Kind = ReferenceEntry['kind'] | 'all';

/** The reference itself (also shown on the Keys page). */
export function CommandsReferenceBody({ initialQuery = '', onTry }: { initialQuery?: string; onTry: (text: string) => void }) {
  const tk = useTokens();
  const [q, setQ] = useState(initialQuery);
  const [kind, setKind] = useState<Kind>('all');
  const all = useMemo(() => commandReference(), []);
  const shown = useMemo(() => searchReference(all, q).filter(e => kind === 'all' || e.kind === kind), [all, q, kind]);
  const kinds = Object.keys(REFERENCE_SECTIONS) as ReferenceEntry['kind'][];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 16px 18px' }} data-commands-ref>
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search: connect, palette, “the node before”, recipes…" aria-label="Search the commands" autoFocus data-commands-search
        style={{ height: 32, padding: '0 10px', borderRadius: radius.control, border: `1px solid ${tk.border.default}`, background: tk.bg.subtle, color: tk.text.primary, font: `13px ${fontFamily.ui}` }} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {(['all', ...kinds] as Kind[]).map(k => (
          <button key={k} type="button" onClick={() => setKind(k)}
            style={{ height: 24, padding: '0 9px', borderRadius: 12, border: `1px solid ${k === kind ? tk.accent.base : tk.border.subtle}`, background: k === kind ? alpha(tk.accent.base, 0.12) : 'transparent', color: k === kind ? tk.accent.base : tk.text.secondary, font: `500 11.5px ${fontFamily.ui}`, cursor: 'pointer' }}>
            {k === 'all' ? `All (${all.length})` : k === 'verb' ? 'Edit verbs' : k === 'action' ? 'Build actions' : REFERENCE_SECTIONS[k]}
          </button>
        ))}
      </div>
      {!q && kind === 'all' && <Grammar />}
      {shown.length === 0 && <span style={{ color: tk.text.muted }}>Nothing matches “{q}”.</span>}
      {kinds.filter(k => shown.some(e => e.kind === k)).map(k => (
        <section key={k} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h3 style={{ margin: '8px 0 0', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: tk.text.faint }}>{REFERENCE_SECTIONS[k]}</h3>
          {shown.filter(e => e.kind === k).map(e => <Entry key={e.id} e={e} onTry={onTry} />)}
        </section>
      ))}
      {!q && kind === 'all' && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <h3 style={{ margin: '8px 0 0', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: tk.text.faint }}>Limits</h3>
          {COMMAND_LIMITS.map(l => <span key={l} style={{ color: tk.text.secondary }}>· {l}</span>)}
        </section>
      )}
    </div>
  );
}

function Grammar() {
  const tk = useTokens();
  return (
    <div style={{ padding: '10px 12px', borderRadius: radius.md, background: tk.bg.subtle, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ color: tk.text.secondary, lineHeight: 1.5 }}>
        A sentence is clauses joined by <b>then</b>, a comma, or <b>and</b> before a verb. Each clause is a <b>verb</b> with what it works on, or a build phrase (“circle with a glow”).
        “It” is what the clause before made. Enter runs the whole sentence as one undo step; the preview shows every node, wire and value first.
      </span>
      <code style={{ font: `11.5px ${fontFamily.mono}`, color: tk.text.primary, whiteSpace: 'pre-wrap' }}>
        {'disconnect the current output, add it to the noise, and output the result'}
      </code>
    </div>
  );
}

function Entry({ e, onTry }: { e: ReferenceEntry; onTry: (text: string) => void }) {
  const tk = useTokens();
  return (
    <div style={{ border: `1px solid ${tk.border.subtle}`, borderRadius: radius.md, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 }} data-commands-entry={e.id}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <b style={{ fontSize: 13.5 }}>{e.title}</b>
        {e.words.length > 1 && <span style={{ fontSize: 11.5, color: tk.text.faint }}>{e.words.slice(1, 14).join(' · ')}{e.words.length > 14 ? ' …' : ''}</span>}
      </div>
      <span style={{ color: tk.text.secondary, lineHeight: 1.45 }}>{e.summary}</span>
      {e.syntax.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {e.syntax.map(s => <code key={s} style={{ font: `11.5px ${fontFamily.mono}`, color: tk.text.primary, overflowWrap: 'anywhere' }}>{s}</code>)}
        </div>
      )}
      {e.slots.length > 0 && e.kind !== 'object' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {e.slots.map(s => <span key={s.name} style={{ fontSize: 11.5, color: tk.text.muted }}><b style={{ color: tk.text.secondary }}>{s.name}</b> — {s.what}</span>)}
        </div>
      )}
      {e.examples.map(x => <Example key={x.text + x.on} x={x} onTry={onTry} />)}
    </div>
  );
}

function Example({ x, onTry }: { x: CommandExample; onTry: (text: string) => void }) {
  const tk = useTokens();
  const [how, setHow] = useState(false);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <code style={{ flex: '1 1 260px', minWidth: 0, font: `12px ${fontFamily.mono}`, color: tk.accent.base, overflowWrap: 'anywhere' }}>{x.text}</code>
        <Button size="sm" variant="ghost" onClick={() => onTry(x.text)} title="Open it in the Do… bar on this graph (the preview shows what it would do)">Try</Button>
        <Button size="sm" variant="ghost" onClick={() => setHow(h => !h)} data-show-how>{how ? 'Hide' : 'Show me how'}</Button>
      </div>
      {x.note && <span style={{ fontSize: 11.5, color: tk.text.muted }}>{x.note}</span>}
      {how && <ShowHow x={x} />}
    </div>
  );
}

/** The steps an example makes on its scratch graph, with what each new node does. */
function ShowHow({ x }: { x: CommandExample }) {
  const tk = useTokens();
  const plan = useMemo(() => {
    let k = 0;
    return execCommand(x.text, scratchGraph(x.on), { selected: x.selected ?? [], nextId: () => `how${++k}`, heightOf: estimateNodeHeight });
  }, [x]);
  const newTypes = [...new Set(plan.nodes.filter(nd => !scratchGraph(x.on).some(o => o.id === nd.id)).map(nd => nd.type))];
  return (
    <div style={{ marginLeft: 8, paddingLeft: 10, borderLeft: `2px solid ${alpha(tk.accent.base, 0.4)}`, display: 'flex', flexDirection: 'column', gap: 4 }} data-show-how-steps>
      <span style={{ fontSize: 11.5, color: tk.text.faint }}>On {SCRATCH_LABELS[x.on]}{x.selected ? `, with ${x.selected.length > 1 ? 'two nodes' : 'one node'} selected` : ''}:</span>
      {plan.clauses.filter(c => c.status !== 'ok').map(c => <span key={c.index} style={{ fontSize: 12, color: tk.status.warningText }}>“{c.text}”: {c.message}</span>)}
      {plan.steps.map((s, i) => (
        <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <span style={{ fontSize: 12.5 }}><b style={{ color: tk.accent.base }}>{i + 1}.</b> {s.label}</span>
          {s.adds.length > 0 && <span style={{ fontSize: 11.5, color: tk.text.muted, paddingLeft: 14 }}>adds {s.adds.join(', ')}</span>}
          {s.wires.map(w => <span key={w} style={{ fontSize: 11.5, color: tk.text.muted, paddingLeft: 14, font: `11px ${fontFamily.mono}` }}>+ {w}</span>)}
          {s.unwires.map(w => <span key={w} style={{ fontSize: 11.5, color: tk.text.faint, paddingLeft: 14, font: `11px ${fontFamily.mono}`, textDecoration: 'line-through' }}>{w}</span>)}
          {s.params.map(p => <span key={p} style={{ fontSize: 11.5, color: tk.text.muted, paddingLeft: 14 }}>{p}</span>)}
        </div>
      ))}
      {newTypes.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingTop: 2 }}>
          <span style={{ fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: tk.text.faint }}>What the new nodes do</span>
          {newTypes.map(t => {
            const def = getNodeDefinition(t);
            const d = def?.description;
            const text = Array.isArray(d) ? d.join(' ') : d;
            return <span key={t} style={{ fontSize: 11.5, color: tk.text.secondary }}><b>{def?.label ?? t}</b>{text ? ` — ${String(text).split(/(?<=\.)\s/)[0]}` : ''}</span>;
          })}
        </div>
      )}
    </div>
  );
}
