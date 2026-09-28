/**
 * A node type's page: what it does, its inputs and outputs with types and
 * hints, a live picture chosen by its output (a plot over x for a number of
 * a number, a field or arrows over the position, a colour), its GLSL folded,
 * the example graphs and saved graphs that use it, and Insert into the
 * current graph.
 */
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { getNodeDefinition } from '../../nodes/definitions';
import { nodeCode } from '../../present/nodeCode';
import { nodeSnippet } from '../../files/nodeVisual';
import { graphsUsingNode } from '../../files/mostUsed';
import { parseJson, walk, type FileNode, type Inventory } from '../../files/inventory';
import { EXAMPLE_INDEX, loadExampleGraphs } from '../../store/exampleIndex';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import type { SnippetContext } from '../../present/snippetHarness';
import type { CodePreview } from '../../types/presentation';
import type { Page } from '../page';
import { askConfirm } from '../ui/dialogStore';
import { toast } from '../ui/toastStore';
import { capsLabel, cardStyle } from './fileUiShared';
import { Folded } from './ItemPage';
import { LinkRow } from './NodeView';
import { Carousel, PosterCard } from './homeUi';
import { useExamplePosters } from './useItemPosters';

const CodePreviewPane = lazy(() => import('../present/CodePreview').then(m => ({ default: m.CodePreviewPane })));
const NO_CONTEXT: SnippetContext = {};

const TYPE_COLOURS: Record<string, string> = {};
const typeTint = (tk: ReturnType<typeof useTokens>, t: string) => TYPE_COLOURS[t] ?? (t === 'float' ? tk.kind.fn : t === 'vec3' || t === 'vec4' ? tk.status.warning : t === 'vec2' ? tk.accent.base : tk.text.muted);

/** Insert a node type into the open graph, to the right of what's there, and show it. */
function insertNodeType(type: string): string | undefined {
  const st = useNodeGraphStore.getState();
  const xs = st.nodes.map(n => n.position.x), ys = st.nodes.map(n => n.position.y);
  const position = { x: xs.length ? Math.max(...xs) + 320 : 0, y: ys.length ? Math.round(ys.reduce((a, b) => a + b, 0) / ys.length) : 0 };
  const id = st.addNode(type, position);
  if (id) useNodeGraphStore.getState().focusNode(id);
  return id;
}

export function NodePage({ type, compact, inv, onOpen, onNavigate }: {
  type: string;
  compact: boolean;
  inv: Inventory;
  onOpen: (id: string) => void;
  onNavigate?: (p: Page) => void;
}) {
  const tk = useTokens();
  const def = useMemo(() => getNodeDefinition(type), [type]);
  const info = useMemo(() => (def ? nodeCode(type) : null), [def, type]);
  const snippet = useMemo(() => (def ? nodeSnippet(type) : null), [def, type]);
  // The preview's settings: the snippet's defaults until changed on this page (per type).
  const [chosen, setChosen] = useState<Record<string, CodePreview>>({});
  const preview = useMemo<CodePreview | undefined>(() => chosen[type] ?? (snippet ? { mode: snippet.kind === 'plot' ? 'plot' : 'field', show: snippet.show, view: snippet.outputType === 'vec2' ? 'grid' : 'color', coords: 'centered' } : undefined), [chosen, type, snippet]);
  const setPreview = (next: CodePreview) => setChosen(c => ({ ...c, [type]: next }));

  // Saved graphs that use it.
  const saved = useMemo(() => {
    const graphs: FileNode[] = [];
    const parsed: unknown[] = [];
    for (const n of walk(inv.sections)) if (n.kind === 'graph' && n.ref?.t === 'key') { graphs.push(n); parsed.push(parseJson(localStorage.getItem(n.ref.key))); }
    return graphsUsingNode(parsed, type).map(u => ({ node: graphs[u.index], count: u.count }));
  }, [inv, type]);

  // Examples that use it (the examples chunk loads on first use); per type, so a page that came before doesn't flash.
  const [examplesBy, setExamplesBy] = useState<Record<string, Array<{ key: string; label: string; count: number }>>>({});
  const examples = examplesBy[type] ?? null;
  useEffect(() => {
    let live = true;
    loadExampleGraphs().then(all => {
      if (!live) return;
      const keys = Object.keys(all);
      const hits = graphsUsingNode(keys.map(k => all[k]), type).map(u => ({ key: keys[u.index], label: all[keys[u.index]].label ?? EXAMPLE_INDEX[keys[u.index]]?.label ?? keys[u.index], count: u.count }));
      setExamplesBy(e => ({ ...e, [type]: hits.sort((a, b) => b.count - a.count).slice(0, 8) }));
    }, () => { if (live) setExamplesBy(e => ({ ...e, [type]: [] })); });
    return () => { live = false; };
  }, [type]);
  const examplePosters = useExamplePosters(useMemo(() => (examples ?? []).map(e => e.key), [examples]));

  const insert = () => {
    const id = insertNodeType(type);
    if (!id) return;
    toast.success(`Added ${def?.label ?? type}`, { message: 'It sits to the right of the graph.', action: { label: 'Show in the Studio', onClick: () => onNavigate?.('studio') } });
  };
  const openExample = async (key: string, label: string) => {
    const st = useNodeGraphStore.getState();
    if (st.graphDirty && !(await askConfirm(`Open the example “${label}”?`, { message: 'The graph open now has changes that aren’t saved; opening another one drops them.', confirmLabel: 'Open', danger: true }))) return;
    await useNodeGraphStore.getState().loadExampleGraph(key);
    onNavigate?.('studio');
  };

  if (!def) {
    return <div style={{ padding: 40, textAlign: 'center', color: tk.text.faint, fontSize: 12.5 }}>No node type called “{type}”.</div>;
  }
  const desc = (Array.isArray(def.description) ? def.description.join(' ') : def.description ?? '').trim();
  const cardPad = compact ? '12px 12px' : '14px 16px';
  const socketRows = (list: Array<{ key: string; label: string; type: string; hint?: string; value?: string }>) => list.map(s => (
    <span key={s.key} style={{ display: 'contents' }}>
      <span style={{ font: `600 10.5px ${fontFamily.mono}`, color: typeTint(tk, s.type), background: alpha(typeTint(tk, s.type), 0.1), borderRadius: 5, padding: '2px 6px', alignSelf: 'start', justifySelf: 'start' }}>{s.type}</span>
      <span style={{ minWidth: 0 }}>
        <span style={{ font: `600 12.5px ${fontFamily.ui}`, color: tk.text.primary }}>{s.label}</span>
        {s.value && <span style={{ fontSize: 11.5, color: tk.text.faint }}> · {s.value}</span>}
        {s.hint && <span style={{ display: 'block', fontSize: 11.5, color: tk.text.muted, lineHeight: 1.4 }}>{s.hint}</span>}
      </span>
    </span>
  ));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? 14 : 18, padding: compact ? '14px 16px 40px' : '22px 28px 48px', maxWidth: 980, width: '100%', boxSizing: 'border-box', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <span style={{ width: compact ? 36 : 42, height: compact ? 36 : 42, borderRadius: 11, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: alpha(tk.accent.base, 0.12), color: tk.accent.base }}><Icon name="nodes" size={19} /></span>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
          <h1 style={{ margin: 0, font: `650 ${compact ? 17 : 20}px ${fontFamily.ui}`, letterSpacing: '-0.015em', color: tk.text.primary }}>{def.label}</h1>
          <span style={{ fontSize: 12, color: tk.text.muted }}>Node · {def.category}{def.subcategory ? ` · ${def.subcategory}` : ''} · <code style={{ font: `11px ${fontFamily.mono}` }}>{def.type}</code></span>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: compact ? -2 : -6, paddingLeft: compact ? 0 : 54 }}>
        <Button size="sm" variant="primary" icon="plus" onClick={insert}>Insert into the current graph</Button>
      </div>

      {desc && <p style={{ margin: 0, font: `13px/1.55 ${fontFamily.ui}`, color: tk.text.secondary, maxWidth: 720 }}>{desc}</p>}

      {snippet && preview ? (
        <div style={{ ...cardStyle(tk), padding: cardPad, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={capsLabel(tk)}>{snippet.kind === 'plot' ? 'Its output over x' : snippet.kind === 'colour' ? 'Its colour over the picture' : 'Its output over the picture'} · its settings are the sliders</span>
          <Suspense fallback={<div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: tk.text.faint }}>Loading the preview…</div>}>
            <CodePreviewPane code={snippet.code} settings={preview} context={NO_CONTEXT} onSettings={setPreview} compact={compact} />
          </Suspense>
        </div>
      ) : (
        <div style={{ padding: '14px 16px', borderRadius: radius.lg, boxShadow: `inset 0 0 0 1px ${tk.border.subtle}`, fontSize: 12, color: tk.text.faint }}>No picture of its own: it works on what a graph gives it (a scene, a field, a texture) or has no output to draw.</div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: compact ? '1fr' : 'minmax(0, 1fr) minmax(0, 1fr)', gap: 12 }}>
        <div style={{ ...cardStyle(tk), padding: cardPad, display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 10, rowGap: 8, alignContent: 'start' }}>
          <span style={{ ...capsLabel(tk), gridColumn: '1 / -1' }}>Inputs · {info?.inputs.length ?? Object.keys(def.inputs).length}</span>
          {socketRows(info?.inputs ?? Object.entries(def.inputs).map(([key, s]) => ({ key, label: s.label, type: s.type, hint: s.hint })))}
          {!Object.keys(def.inputs).length && <span style={{ gridColumn: '1 / -1', fontSize: 12, color: tk.text.faint }}>None: it starts a chain.</span>}
        </div>
        <div style={{ ...cardStyle(tk), padding: cardPad, display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 10, rowGap: 8, alignContent: 'start' }}>
          <span style={{ ...capsLabel(tk), gridColumn: '1 / -1' }}>Outputs · {Object.keys(def.outputs).length}</span>
          {socketRows(info?.outputs ?? Object.entries(def.outputs).map(([key, s]) => ({ key, label: s.label, type: s.type, hint: s.hint })))}
          {info && info.params.length > 0 && <>
            <span style={{ ...capsLabel(tk), gridColumn: '1 / -1', marginTop: 6 }}>Settings · {info.params.length}</span>
            {info.params.map(p => (
              <span key={p.key} style={{ display: 'contents' }}>
                <span style={{ font: `500 11px ${fontFamily.mono}`, color: tk.text.faint, alignSelf: 'start' }}>{p.value || '—'}</span>
                <span><span style={{ font: `600 12.5px ${fontFamily.ui}`, color: tk.text.primary }}>{p.label}</span>{p.range && <span style={{ fontSize: 11.5, color: tk.text.faint }}> · {p.range}</span>}{p.hint && <span style={{ display: 'block', fontSize: 11.5, color: tk.text.muted }}>{p.hint}</span>}</span>
              </span>
            ))}
          </>}
        </div>
      </div>

      {info && (info.functions || info.body) && <Folded title="Its GLSL" text={[info.functions, info.body ? `// In main(), with its default settings:\n${info.body}` : ''].filter(Boolean).join('\n\n')} compact={compact} />}

      <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={{ font: `650 14px ${fontFamily.ui}`, color: tk.text.primary, padding: '0 2px' }}>Examples that use it</span>
        {examples === null ? <span style={{ fontSize: 12, color: tk.text.faint, padding: '0 2px' }}>Looking through the examples…</span>
          : examples.length === 0 ? <span style={{ fontSize: 12, color: tk.text.faint, padding: '0 2px' }}>No example uses it.</span>
          : <Carousel compact={compact} gutter={compact ? 16 : 0}>
            {examples.map(e => <PosterCard key={e.key} title={e.label} sub={`${e.count} ${def.label}${e.count === 1 ? '' : 's'}`} poster={examplePosters[e.key]} icon="graphs" width={compact ? 150 : 172} tint={tk.accent.base} onClick={() => { void openExample(e.key, e.label); }} />)}
          </Carousel>}
      </section>

      <div style={{ ...cardStyle(tk), padding: cardPad, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ ...capsLabel(tk), marginBottom: 4 }}>Your graphs that use it · {saved.length}</span>
        {saved.length === 0 && <span style={{ fontSize: 12, color: tk.text.faint }}>None of your saved graphs uses it yet.</span>}
        {saved.slice(0, 20).map(s => <LinkRow key={s.node.id} label={s.node.label} sub={`${s.count} node${s.count === 1 ? '' : 's'}`} tone="copy" onClick={() => onOpen(s.node.id)} />)}
      </div>
    </div>
  );
}
