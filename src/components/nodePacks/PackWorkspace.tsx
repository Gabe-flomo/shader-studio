/**
 * PackWorkspace — make a node pack (docs/node-packs.md).
 *
 * The packs you're making on the left; the open one on the right: its
 * details (name, author, version, description, colour and glyph, licence,
 * sealed), its nodes (each a card with its sockets, a thumbnail and what's
 * wrong with it, if anything), the extras that travel with it (the graphs the
 * nodes came from, presentations, GLSL, images, notes) and the export.
 *
 * Nodes come from the node builder (PublishNodeModal): written from scratch,
 * or made from a saved graph, a group in one, a group preset, a Custom
 * Function or an Expression Block; or a node type you've already published.
 * Every edit is saved as you go (nodePacks/projects.ts).
 */
import { loadSavedEffects } from '../../play/finishLibrary';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Button, IconButton } from '../ui/Button';
import { Field } from '../ui/Field';
import { Toggle } from '../ui/Choice';
import { Icon } from '../ui/Icon';
import { Menu, type MenuItem } from '../ui/Menu';
import { toast } from '../ui/toastStore';
import { askConfirm, askText } from '../ui/dialogStore';
import { DocText } from '../ui/DocText';
import type { IconName } from '../ui/iconPaths';
import { ProBadgeFor } from '../account/ProSheet';
import { lazyWithSuspense, type PropsOf } from '../lazyWithSuspense';
import { TYPE_COLORS } from '../NodeGraph/typeColors';
import { requireFeature, useCan } from '../../lib/plan';
import { useNodeGraphStore, loadCustomFns, loadExprPresets, loadGroupPresets } from '../../store/useNodeGraphStore';
import { getUserNode } from '../../nodes/userNodes/userNodeRegistry';
import { useUserNodes, useUserNodesVersion } from '../../nodes/userNodes/useUserNodes';
import { graphToSubgraph } from '../../nodes/userNodes/graphToSubgraph';
import type { PublishSource } from '../../nodes/userNodes/publishUserNode';
import { listImages } from '../../lib/backgroundLibrary';
import { GLSL_KEY } from '../../files/inventory';
import { PRESENTATION_KEY_PREFIX } from '../../utils/library';
import type { UserNodeDefinition } from '../../types/userNode';
import {
  collectDependencies, extraKey, namespaceLabels, packCategory, resolvePackNodes, validatePack, type Issue, type ResolvedNode,
} from '../../nodePacks/assemble';
import { addNode, deleteProject, listProjects, loadProject, moveNode, newProject, PACK_PROJECTS_CHANGED, removeNode, renameNode, saveProject } from '../../nodePacks/projects';
import { customFnSource, exprSource, groupPresetSource, groupsIn } from '../../nodePacks/sources';
import type { PackExtra, PackNodeOrigin, PackProject } from '../../nodePacks/types';
import { appPackEnv, checkPackNode, currentAuthorName, packNodeThumb } from '../../nodePacks/app';
import { existingAuthorKey } from '../../playfile/signing';
import { openPackInBuilder, useBuilderWindow } from './builderWindow';
import { PickerModal, type PickItem } from './PickerModal';
import type { PublishNodeModal as PublishNodeModalT } from '../NodeGraph/PublishNodeModal';
import type { PackExportDialog as PackExportDialogT } from './PackExportDialog';

const PublishNodeModal = lazyWithSuspense<PropsOf<typeof PublishNodeModalT>>(() => import('../NodeGraph/PublishNodeModal').then(m => ({ default: m.PublishNodeModal })));
const PackExportDialog = lazyWithSuspense<PropsOf<typeof PackExportDialogT>>(() => import('./PackExportDialog').then(m => ({ default: m.PackExportDialog })));

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const SWATCHES = ['#7c5cff', '#3b82f6', '#1f9d8a', '#c28a12', '#e0663a', '#d4467d', '#6b7280'];

// ── Hooks ───────────────────────────────────────────────────────────────────

function useProjects(): PackProject[] {
  const [list, setList] = useState(() => listProjects());
  useEffect(() => {
    const on = () => setList(listProjects());
    window.addEventListener(PACK_PROJECTS_CHANGED, on);
    window.addEventListener('storage', on);
    return () => { window.removeEventListener(PACK_PROJECTS_CHANGED, on); window.removeEventListener('storage', on); };
  }, []);
  return list;
}

/** The container's width (the workspace lives in a page, a floating window or a phone sheet). */
function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(1000);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(e => setW(e[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

interface Check { ok: boolean; error?: string; thumb?: string; busy?: boolean }

/** Compile each node (and draw its thumbnail) once per change of its definition. */
function useNodeChecks(resolved: ResolvedNode[]): Map<string, Check> {
  const [checks, setChecks] = useState<Map<string, Check>>(() => new Map());
  const keyOf = (d: UserNodeDefinition) => `${d.id}@${d.savedAt}@${d.functionCode.length}@${!!d.sealed}`;
  const done = useRef(new Map<string, string>());
  const sig = resolved.map(r => (r.def ? keyOf(r.def) : `${r.node.nodeId}@none`)).join('|');
  useEffect(() => {
    let live = true;
    (async () => {
      for (const r of resolved) {
        if (!live || !r.def) continue;
        const k = keyOf(r.def);
        if (done.current.get(r.def.id) === k) continue;
        done.current.set(r.def.id, k);
        const def = r.def;
        setChecks(m => new Map(m).set(def.id, { ok: true, busy: true, thumb: m.get(def.id)?.thumb }));
        const c = await checkPackNode(def);
        const t = c.ok ? await packNodeThumb(def, c) : { url: '' };
        if (!live) return;
        setChecks(m => new Map(m).set(def.id, { ok: c.ok && !t.error, error: c.error ?? t.error, thumb: t.url }));
      }
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sig is the change signal
  }, [sig]);
  return checks;
}

// ── Workspace ───────────────────────────────────────────────────────────────

export function PackWorkspace() {
  const tk = useTokens();
  const canPack = useCan('nodes.pack');
  const projects = useProjects();
  const packId = useBuilderWindow(s => s.packId);
  const [ref, width] = useWidth<HTMLDivElement>();
  const narrow = width < 760;
  const open = packId ? projects.find(p => p.id === packId) ?? null : null;

  // Open the most recent pack when none is chosen.
  useEffect(() => {
    if (!packId && projects.length) openPackInBuilder(projects[0].id);
  }, [packId, projects]);

  const create = async () => {
    if (!requireFeature('nodes.pack')) return;
    const name = await askText('New node pack', { label: 'Name', initial: 'My node pack', confirmLabel: 'Create' });
    if (name === null) return;
    const p = saveProject(newProject(name, { author: currentAuthorName() }));
    openPackInBuilder(p.id);
  };

  const list = (
    <div style={{ display: 'flex', flexDirection: narrow ? 'row' : 'column', gap: 4, padding: narrow ? '8px 10px' : 10, overflowX: narrow ? 'auto' : undefined, flexShrink: 0 }}>
      <Button size="sm" variant={projects.length ? 'secondary' : 'primary'} icon="plus" onClick={() => { void create(); }} style={{ justifyContent: 'flex-start' }}>New node pack<ProBadgeFor feature="nodes.pack" /></Button>
      {projects.map(p => (
        <button key={p.id} type="button" onClick={() => openPackInBuilder(p.id)} aria-pressed={p.id === packId}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', border: 0, borderRadius: radius.md, cursor: 'pointer', textAlign: 'left', flexShrink: 0,
            background: p.id === packId ? tk.bg.selected : 'transparent', color: tk.text.primary, font: `500 12.5px ${fontFamily.ui}`, maxWidth: narrow ? 200 : undefined,
          }}>
          <PackGlyph project={p} size={22} />
          <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
            {!narrow && <span style={{ fontSize: 11, color: tk.text.muted }}>{plural(p.packNodes.length, 'node')} · v{p.version}</span>}
          </span>
        </button>
      ))}
    </div>
  );

  return (
    <div ref={ref} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: narrow ? 'column' : 'row', background: tk.bg.panel }}>
      <div style={{ width: narrow ? '100%' : 230, flexShrink: 0, borderRight: narrow ? 0 : `1px solid ${tk.border.default}`, borderBottom: narrow ? `1px solid ${tk.border.default}` : 0, overflowY: narrow ? undefined : 'auto', background: tk.bg.subtle }}>
        {list}
      </div>
      <div style={{ flex: 1, minWidth: 0, minHeight: 0, overflowY: 'auto' }}>
        {open ? <PackEditor key={open.id} initial={open} narrow={narrow} />
          : <Intro canPack={canPack} onCreate={() => { void create(); }} />}
      </div>
    </div>
  );
}

function Intro({ canPack, onCreate }: { canPack: boolean; onCreate: () => void }) {
  const tk = useTokens();
  return (
    <div style={{ maxWidth: 520, margin: '0 auto', padding: '40px 24px', display: 'flex', flexDirection: 'column', gap: 12, color: tk.text.secondary, fontSize: 13, lineHeight: 1.55 }}>
      <b style={{ fontSize: 17, color: tk.text.primary }}>Node packs</b>
      <span>A node pack is a set of your nodes in one <code>.playfile</code>: signed by you, sealed if you like, with the graphs that show how they’re used, GLSL, presentations, images and notes alongside.</span>
      <span>Write nodes from scratch, or turn saved graphs, groups, Custom Functions and Expression Blocks into nodes. Whoever opens the pack finds its nodes in the node list under the pack’s name, with its examples a click away.</span>
      {!canPack && <span style={{ color: tk.text.muted }}>Making node packs is part of Pro. Opening one is free.</span>}
      <span><Button variant="primary" icon="plus" onClick={onCreate}>New node pack<ProBadgeFor feature="nodes.pack" /></Button></span>
    </div>
  );
}

function PackGlyph({ project, size = 28 }: { project: Pick<PackProject, 'color' | 'icon' | 'name'>; size?: number }) {
  return (
    <span style={{ width: size, height: size, borderRadius: size * 0.3, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: project.color || '#7c5cff', color: '#fff', font: `700 ${Math.round(size * 0.45)}px ${fontFamily.ui}` }}>
      {project.icon.trim() || project.name.trim().slice(0, 1).toUpperCase() || 'P'}
    </span>
  );
}

// ── The open pack ───────────────────────────────────────────────────────────

type Publishing = { source: PublishSource; origin: PackNodeOrigin; existingId?: string; detached?: boolean };
type Picking =
  | { what: 'graph-node' } | { what: 'graph-group' } | { what: 'group-in'; graph: string } | { what: 'group-preset' }
  | { what: 'custom-fn' } | { what: 'expr' } | { what: 'published' }
  | { what: 'extra-graph' } | { what: 'extra-presentation' } | { what: 'extra-glsl' } | { what: 'extra-finish' } | { what: 'extra-background'; items: PickItem[] };

function PackEditor({ initial, narrow }: { initial: PackProject; narrow: boolean }) {
  const tk = useTokens();
  const [p, setP] = useState(initial);
  const [publishing, setPublishing] = useState<Publishing | null>(null);
  const [picking, setPicking] = useState<Picking | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(() => !initial.packNodes.length);
  const [signer, setSigner] = useState<string | null>(null);
  useUserNodesVersion();
  const userNodes = useUserNodes();

  useEffect(() => { void existingAuthorKey().then(k => setSigner(k?.fingerprint ?? '')).catch(() => setSigner('')); }, []);

  // Saved as you go.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const t = setTimeout(() => saveProject(p), 350);
    return () => clearTimeout(t);
  }, [p]);
  // An export (or another window) changed it: take that.
  useEffect(() => {
    const on = () => { const fresh = loadProject(p.id); if (fresh && fresh.updatedAt > p.updatedAt && JSON.stringify(fresh.exports) !== JSON.stringify(p.exports)) setP(fresh); };
    window.addEventListener(PACK_PROJECTS_CHANGED, on);
    return () => window.removeEventListener(PACK_PROJECTS_CHANGED, on);
  }, [p.id, p.updatedAt, p.exports]);

  const update = useCallback((patch: Partial<PackProject> | ((x: PackProject) => PackProject)) => setP(x => (typeof patch === 'function' ? patch(x) : { ...x, ...patch })), []);

  const env = useMemo(() => appPackEnv(), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- userNodes is the registry's change signal
  const resolved = useMemo(() => resolvePackNodes(p, env), [p, env, userNodes]);
  const checks = useNodeChecks(resolved);
  const compiled = useMemo(() => new Map([...checks].filter(([, c]) => !c.busy).map(([k, c]) => [k, { ok: c.ok, error: c.error }])), [checks]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- userNodes is the registry's change signal
  const validation = useMemo(() => validatePack(p, env, compiled), [p, env, compiled, userNodes]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- userNodes is the registry's change signal
  const deps = useMemo(() => collectDependencies(p, env), [p, env, userNodes]);
  const labels = useMemo(() => namespaceLabels(p.packNodes), [p.packNodes]);

  const store = useNodeGraphStore.getState;
  const savedGraphs = () => store().getSavedGraphNames();

  // ── Adding nodes ──
  const addPublished = (id: string, origin: PackNodeOrigin) => {
    const def = getUserNode(id);
    if (!def) return;
    update(x => addNode(x, def, origin));
    toast.success(`Added “${def.label}” to ${p.name}`);
  };
  const afterPublish = (id: string) => {
    const pub = publishing;
    setPublishing(null);
    if (id && pub) addPublished(id, pub.origin);
  };
  const addMenu = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu({
      x: r.left, y: r.bottom + 6, items: [
        { heading: 'Make a node' },
        { label: 'Write a new node (GLSL)…', icon: 'code', hint: 'The node builder, from scratch', onSelect: () => setPublishing({ source: { kind: 'code', code: '', label: 'My Node' }, origin: { kind: 'scratch' } }) },
        { label: 'From a saved graph…', icon: 'graphs', hint: 'What’s wired into its Output becomes the node', onSelect: () => setPicking({ what: 'graph-node' }) },
        { label: 'A group in a saved graph…', icon: 'presets', hint: 'Pick the graph, then the group; choose its inputs and outputs', onSelect: () => setPicking({ what: 'graph-group' }) },
        { label: 'A group preset…', icon: 'presets', onSelect: () => setPicking({ what: 'group-preset' }) },
        { label: 'A Custom Function…', icon: 'fn', onSelect: () => setPicking({ what: 'custom-fn' }) },
        { label: 'An Expression Block…', icon: 'expr', onSelect: () => setPicking({ what: 'expr' }) },
        'separator',
        { label: 'A node you published…', icon: 'spark', hint: 'Already a node type: added as it is', onSelect: () => setPicking({ what: 'published' }) },
      ],
    });
  };
  const extrasMenu = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu({
      x: r.left, y: r.bottom + 6, items: [
        { label: 'A saved graph…', icon: 'graphs', hint: 'An example of the nodes in use', onSelect: () => setPicking({ what: 'extra-graph' }) },
        { label: 'A presentation…', icon: 'slides', onSelect: () => setPicking({ what: 'extra-presentation' }) },
        { label: 'A GLSL shader…', icon: 'code', hint: 'From the GLSL page', onSelect: () => setPicking({ what: 'extra-glsl' }) },
        { label: 'A Finish effect…', icon: 'sliders', hint: 'A custom effect from Your effects (Play → Finish)', onSelect: () => setPicking({ what: 'extra-finish' }) },
        { label: 'A background image…', icon: 'overlay', onSelect: () => { void listImages().then(list => setPicking({ what: 'extra-background', items: list.map(m => ({ id: m.id, label: m.name, detail: `${m.width}×${m.height}`, icon: 'overlay' as IconName, disabled: p.extras.some(x => x.kind === 'background' && x.id === m.id) })) })).catch(() => toast.error('Couldn’t read the backgrounds library')); } },
        { label: 'Notes (markdown)', icon: 'text', hint: 'A readme: what the nodes do, how to use them', onSelect: () => update(x => ({ ...x, extras: [...x.extras, { kind: 'note', id: `note_${Date.now().toString(36)}`, name: x.extras.some(e => e.kind === 'note') ? 'Notes' : 'Read me', text: `# ${x.name}\n\n` }] })) },
      ],
    });
  };
  const addExtra = (e: PackExtra) => update(x => (x.extras.some(y => extraKey(y) === extraKey(e)) ? x : { ...x, extras: [...x.extras, e] }));

  const pickerFor = (pk: Picking): ReactNode => {
    const close = () => setPicking(null);
    const inPack = new Set(p.packNodes.map(n => n.nodeId));
    switch (pk.what) {
      case 'graph-node':
      case 'graph-group':
      case 'extra-graph':
        return <PickerModal title={pk.what === 'extra-graph' ? 'Add a saved graph' : pk.what === 'graph-group' ? 'Which graph is the group in?' : 'Make a node from a saved graph'} icon="graphs"
          items={savedGraphs().map(n => ({ id: n, label: n, icon: 'graphs', tag: store().savedGraphHasPlay(n) ? 'Play' : undefined, disabled: pk.what === 'extra-graph' && p.extras.some(x => x.kind === 'graph' && x.name === n) }))}
          empty="No saved graphs yet: save one in the Studio first." onClose={close}
          onPick={it => {
            if (pk.what === 'extra-graph') { addExtra({ kind: 'graph', name: it.id }); close(); return; }
            if (pk.what === 'graph-group') { setPicking({ what: 'group-in', graph: it.id }); return; }
            const nodes = store().readSavedGraphNodes(it.id);
            if (!nodes) { toast.error(`Couldn’t read “${it.id}”`); return; }
            const r = graphToSubgraph(nodes, { exposeUv: true });
            if (!r.ok) { toast.error(`Can’t make a node from “${it.id}”`, { message: r.error }); return; }
            close();
            setPublishing({ source: { kind: 'subgraph', subgraph: r.subgraph, label: it.id }, origin: { kind: 'graph', graph: it.id } });
          }} />;
      case 'group-in': {
        const nodes = store().readSavedGraphNodes(pk.graph) ?? [];
        const groups = groupsIn(nodes);
        return <PickerModal title={`Groups in “${pk.graph}”`} subtitle="The group’s ports become the node’s sockets" icon="presets"
          items={groups.map(g => ({ id: g.node.id, label: g.path, detail: `${plural(g.nodeCount, 'node')} inside`, icon: 'presets' }))}
          empty="This graph has no groups. Group some nodes in the Studio (select them, then Group), or make a node from the whole graph." onClose={close}
          onPick={it => {
            const g = groups.find(x => x.node.id === it.id)!;
            close();
            setPublishing({ source: { kind: 'group', node: g.node }, origin: { kind: 'graphGroup', graph: pk.graph, groupId: g.node.id, groupLabel: g.label }, detached: true });
          }} />;
      }
      case 'group-preset': {
        const list = loadGroupPresets();
        return <PickerModal title="Make a node from a group preset" icon="presets" items={list.map(g => ({ id: g.id, label: g.label, detail: `${plural(g.subgraph.nodes.length, 'node')} · ${g.subgraph.inputPorts.length} in · ${g.subgraph.outputPorts.length} out`, icon: 'presets' }))}
          empty="No group presets yet." onClose={close}
          onPick={it => { const g = list.find(x => x.id === it.id)!; close(); setPublishing({ source: groupPresetSource(g), origin: { kind: 'groupPreset', presetId: g.id, label: g.label } }); }} />;
      }
      case 'custom-fn': {
        const list = loadCustomFns();
        return <PickerModal title="Make a node from a Custom Function" icon="fn" items={list.map(f => ({ id: f.id, label: f.label, detail: `${f.inputs.map(i => `${i.type} ${i.name}`).join(', ')} → ${f.outputType}`, icon: 'fn' }))}
          empty="No saved Custom Functions yet: save one from a Custom Function node." onClose={close}
          onPick={it => { const f = list.find(x => x.id === it.id)!; close(); setPublishing({ source: customFnSource(f), origin: { kind: 'customFn', presetId: f.id, label: f.label } }); }} />;
      }
      case 'expr': {
        const list = loadExprPresets();
        return <PickerModal title="Make a node from an Expression Block" icon="expr" items={list.map(f => ({ id: f.id, label: f.label, detail: `${f.inputs.map(i => `${i.type} ${i.name}`).join(', ')} → ${f.outputType}`, icon: 'expr' }))}
          empty="No saved Expression Blocks yet: save one from an Expression Block node." onClose={close}
          onPick={it => { const f = list.find(x => x.id === it.id)!; close(); setPublishing({ source: exprSource(f), origin: { kind: 'expr', presetId: f.id, label: f.label } }); }} />;
      }
      case 'published':
        return <PickerModal title="Add a node you published" icon="spark"
          items={userNodes.map(d => ({ id: d.id, label: d.label, detail: `${d.category} · ${d.inputs.length} in · ${d.outputs.length} out`, icon: 'spark', tag: d.sealed ? 'Sealed' : inPack.has(d.id) ? 'In the pack' : undefined, disabled: inPack.has(d.id) }))}
          empty="No published nodes yet." onClose={close}
          onPick={it => { close(); addPublished(it.id, { kind: 'published' }); }} />;
      case 'extra-presentation': {
        const names = localStorageKeys().filter(k => k.startsWith(PRESENTATION_KEY_PREFIX)).map(k => k.slice(PRESENTATION_KEY_PREFIX.length)).sort();
        return <PickerModal title="Add a presentation" icon="slides" items={names.map(n => ({ id: n, label: n, icon: 'slides', disabled: p.extras.some(x => x.kind === 'presentation' && x.name === n) }))}
          empty="No presentations yet." onClose={close} onPick={it => { addExtra({ kind: 'presentation', name: it.id }); close(); }} />;
      }
      case 'extra-glsl': {
        let list: Array<{ id: string; name: string; group?: string }> = [];
        try { list = JSON.parse(localStorage.getItem(GLSL_KEY) ?? '[]'); } catch { /* none */ }
        return <PickerModal title="Add a GLSL shader" icon="code" items={list.map(s => ({ id: s.id, label: s.name, detail: s.group, icon: 'code', disabled: p.extras.some(x => x.kind === 'glsl' && x.id === s.id) }))}
          empty="No shaders on the GLSL page yet." onClose={close} onPick={it => { addExtra({ kind: 'glsl', id: it.id, name: it.label }); close(); }} />;
      }
      case 'extra-finish': {
        const list = loadSavedEffects();
        return <PickerModal title="Add a Finish effect" icon="sliders" items={list.map(fx => ({ id: fx.id, label: fx.name, detail: fx.sealed ? 'Sealed' : `${fx.code.split('\n').length} lines`, icon: 'sliders' as IconName, disabled: p.extras.some(x => x.kind === 'finishEffect' && x.id === fx.id) }))}
          empty="No effects in Your effects yet: write one in Play → Finish → + Add effect → New effect code, then Save to Your effects." onClose={close} onPick={it => { addExtra({ kind: 'finishEffect', id: it.id, name: it.label }); close(); }} />;
      }
      case 'extra-background':
        return <PickerModal title="Add a background image" icon="overlay" items={pk.items} empty="No images in the backgrounds library yet." onClose={close}
          onPick={it => { addExtra({ kind: 'background', id: it.id, name: it.label }); close(); }} />;
    }
  };

  // ── Editing a node's source again ──
  const editNode = (r: ResolvedNode) => {
    const d = r.def;
    if (!d?.source) return;
    if (d.source.kind === 'code') setPublishing({ source: { kind: 'code', code: d.source.code, entry: d.source.entry, label: d.label }, origin: r.node.origin, existingId: d.id });
    else setPublishing({ source: { kind: 'subgraph', subgraph: d.source.subgraph, label: d.label, iterations: d.source.iterations }, origin: r.node.origin, existingId: d.id, detached: true });
  };

  const graphSuggestions = deps.suggestions.filter(s => s.extra.kind === 'graph');
  const issuesAll = [...validation.pack, ...[...validation.nodes.values()].flat(), ...[...validation.extras.values()].flat()];
  const errorCount = issuesAll.filter(i => i.level === 'error').length;
  const pad = narrow ? '12px 12px 24px' : '16px 20px 28px';

  return (
    <div style={{ padding: pad, display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 980 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: narrow ? 'wrap' : 'nowrap' }}>
        <PackGlyph project={p} size={36} />
        <Field aria-label="Pack name" value={p.name} onChange={e => update({ name: e.target.value })} style={{ flex: 1, minWidth: 160, fontSize: 15 }} height={36} />
        <Field aria-label="Version" mono value={p.version} onChange={e => update({ version: e.target.value })} leading={<span style={{ color: tk.text.faint, fontSize: 12 }}>v</span>} style={{ width: 96 }} height={36} />
        <Button variant="primary" icon="export" onClick={() => { if (requireFeature('nodes.pack')) setExporting(true); }}
          title={errorCount ? `${plural(errorCount, 'thing')} to fix first` : 'Build the .playfile: a summary first, then the download'}>
          Export…<ProBadgeFor feature="nodes.pack" />
        </Button>
        <IconButton icon="more" label="More" onClick={e => {
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          setMenu({ x: r.right - 220, y: r.bottom + 6, items: [
            { label: 'Duplicate the pack', icon: 'copy', onSelect: () => { const c = saveProject({ ...newProject(`${p.name} copy`), ...p, id: newProject('x').id, name: `${p.name} copy`, exports: [], version: '1.0.0', createdAt: Date.now() }); openPackInBuilder(c.id); } },
            { label: 'Delete the pack', icon: 'trash', danger: true, hint: 'The pack only: its nodes, graphs and files stay', onSelect: async () => { if (await askConfirm(`Delete the pack “${p.name}”?`, { message: 'Its nodes, graphs and files stay where they are; only the pack goes.', confirmLabel: 'Delete', danger: true })) { deleteProject(p.id); openPackInBuilder(null); } } },
          ] });
        }} />
      </div>
      {p.exports.length > 0 && <span style={{ fontSize: 11.5, color: tk.text.muted, marginTop: -10 }}>Last exported: v{p.exports[p.exports.length - 1].version} · {new Date(p.exports[p.exports.length - 1].at).toLocaleString()} · {plural(p.exports.length, 'export')}</span>}
      {validation.pack.map(i => <IssueLine key={i.text} issue={i} />)}

      {/* Details */}
      <Section title="About the pack" open={detailsOpen} onToggle={() => setDetailsOpen(o => !o)}
        summary={[p.author ? `by ${p.author}` : 'no author', p.sealed ? 'sealed' : 'not sealed', p.licence.trim() ? 'licence' : 'no licence'].join(' · ')}>
        <div style={{ display: 'grid', gridTemplateColumns: narrow ? '1fr' : '1fr 1fr', gap: 12 }}>
          <Labeled label="Author" hint="Your display name, signed into the file">
            <Field aria-label="Author" value={p.author} placeholder="Shown to whoever opens it" onChange={e => update({ author: e.target.value })} />
          </Labeled>
          <Labeled label="Colour and glyph" hint="How the pack looks in lists">
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              {SWATCHES.map(c => <button key={c} type="button" aria-label={`Colour ${c}`} onClick={() => update({ color: c })}
                style={{ width: 22, height: 22, borderRadius: 7, border: 0, cursor: 'pointer', background: c, boxShadow: p.color === c ? `0 0 0 2px ${tk.bg.panel}, 0 0 0 4px ${c}` : 'none' }} />)}
              <Field aria-label="Glyph" value={p.icon} placeholder={p.name.slice(0, 1).toUpperCase()} maxLength={4} onChange={e => update({ icon: e.target.value })} style={{ width: 56 }} height={30} />
            </span>
          </Labeled>
          <Labeled label="Description" hint="What the nodes are for (markdown)" wide={!narrow}>
            <TextArea value={p.description} onChange={v => update({ description: v })} placeholder="Glows, falloffs and waves for 2D scenes." rows={3} label="Description" />
          </Labeled>
          <Labeled label="Licence" hint="How others may use the nodes (e.g. CC BY 4.0, MIT, or your own terms)" wide={!narrow}>
            <TextArea value={p.licence} onChange={v => update({ licence: v })} placeholder="CC BY 4.0: use them anywhere, credit the author." rows={2} label="Licence" mono />
          </Labeled>
          <div style={{ gridColumn: narrow ? undefined : '1 / -1', display: 'flex', alignItems: 'flex-start', gap: 12, padding: '10px 12px', borderRadius: radius.md, background: tk.bg.subtle }}>
            <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12, color: tk.text.muted, lineHeight: 1.45 }}>
              <span style={{ font: `600 12.5px ${fontFamily.ui}`, color: tk.text.primary, display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="lock" size={13} />Sealed</span>
              The nodes’ GLSL is encrypted in the file and hidden in the app: people can use them but not read or edit them. It stops casual copying, not a determined person: a shader reaches the GPU as text.
              <span>Signed: always, with your key{signer ? <> <code style={{ font: `500 11px ${fontFamily.mono}` }}>{signer}</code></> : signer === '' ? ' (made on this device at the first export)' : ''}.</span>
            </span>
            <Toggle checked={p.sealed} onChange={v => update({ sealed: v })} />
          </div>
        </div>
      </Section>

      {/* Nodes */}
      <Section title={`Nodes · ${p.packNodes.length}`} summary={`listed under “${packCategory(p)}”`}
        action={<Button size="sm" icon="plus" onClick={addMenu}>Add node</Button>}>
        {!p.packNodes.length && (
          <div style={{ padding: '18px 14px', borderRadius: radius.md, background: tk.bg.subtle, fontSize: 12.5, color: tk.text.muted, lineHeight: 1.5 }}>
            No nodes yet. <b style={{ color: tk.text.secondary }}>Add node</b> writes one from scratch, or turns a saved graph, a group, a Custom Function or an Expression Block into one.
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: narrow ? '1fr' : 'repeat(auto-fill, minmax(300px, 1fr))', gap: 10 }}>
          {resolved.map((r, i) => (
            <NodeCard key={r.node.nodeId} r={r} finalLabel={labels.get(r.node.nodeId) ?? r.node.label} check={checks.get(r.node.nodeId)} issues={validation.nodes.get(r.node.nodeId) ?? []}
              first={i === 0} last={i === resolved.length - 1}
              onRename={label => update(x => renameNode(x, r.node.nodeId, label))}
              onMove={by => update(x => moveNode(x, r.node.nodeId, by))}
              onRemove={() => update(x => removeNode(x, r.node.nodeId))}
              onEdit={r.def?.source && !r.def.sealed ? () => editNode(r) : undefined} />
          ))}
        </div>
      </Section>

      {/* Extras */}
      <Section title={`Extras · ${p.extras.length}`} summary="graphs, presentations, GLSL, images and notes that travel with it"
        action={<Button size="sm" icon="plus" onClick={extrasMenu}>Add</Button>}>
        {deps.suggestions.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 12px', borderRadius: radius.md, background: alpha(tk.accent.base, 0.07), boxShadow: `inset 0 0 0 1px ${alpha(tk.accent.base, 0.18)}` }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12.5, color: tk.text.primary }}>
              <Icon name="link" size={14} style={{ color: tk.accent.text }} />
              <b style={{ fontWeight: 600 }}>Suggested</b>
              <span style={{ flex: 1 }} />
              {graphSuggestions.length > 0 && <Button size="sm" onClick={() => update(x => ({ ...x, extras: [...x.extras, ...graphSuggestions.map(s => s.extra).filter(e => !x.extras.some(y => extraKey(y) === extraKey(e)))] }))}>Include the graphs these nodes came from</Button>}
            </span>
            {deps.suggestions.map(s => (
              <span key={extraKey(s.extra)} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: tk.text.secondary }}>
                <Icon name={s.extra.kind === 'graph' ? 'graphs' : 'slides'} size={13} style={{ color: tk.text.muted }} />
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{'name' in s.extra ? s.extra.name : ''} <span style={{ color: tk.text.faint }}>· {s.why}</span></span>
                <Button size="sm" variant="ghost" icon="plus" onClick={() => addExtra(s.extra)}>Add</Button>
              </span>
            ))}
          </div>
        )}
        {!p.extras.length && !deps.suggestions.length && <div style={{ fontSize: 12, color: tk.text.faint, padding: '2px 2px' }}>Nothing yet. A graph that uses the nodes is the best way to show what they’re for.</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {p.extras.map(e => (
            <ExtraRow key={extraKey(e)} extra={e} issues={validation.extras.get(extraKey(e)) ?? []}
              onChange={next => update(x => ({ ...x, extras: x.extras.map(y => (extraKey(y) === extraKey(e) ? next : y)) }))}
              onRemove={() => update(x => ({ ...x, extras: x.extras.filter(y => extraKey(y) !== extraKey(e)) }))}
              onFixUnresolved={deps.unresolved.some(u => e.kind === 'graph' && u.graph === e.name && u.here) ? () => {
                for (const u of deps.unresolved.filter(u => e.kind === 'graph' && u.graph === e.name && u.here)) addPublished(u.nodeType, { kind: 'published' });
              } : undefined} />
          ))}
        </div>
      </Section>

      {menu && <Menu x={menu.x} y={menu.y} items={menu.items} minWidth={250} onClose={() => setMenu(null)} />}
      {picking && pickerFor(picking)}
      {publishing && <PublishNodeModal source={publishing.source} existingId={publishing.existingId} detached={publishing.detached} onClose={() => setPublishing(null)} onPublished={afterPublish} />}
      {exporting && <PackExportDialog project={p} validation={validation} onClose={() => setExporting(false)} onExported={next => setP(next)} />}
    </div>
  );
}

function localStorageKeys(): string[] {
  try { return Object.keys(localStorage); } catch { return []; }
}

// ── Pieces ──────────────────────────────────────────────────────────────────

function Section({ title, summary, action, open = true, onToggle, children }: { title: string; summary?: string; action?: ReactNode; open?: boolean; onToggle?: () => void; children: ReactNode }) {
  const tk = useTokens();
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 30 }}>
        <button type="button" onClick={onToggle} disabled={!onToggle} aria-expanded={open}
          style={{ display: 'flex', alignItems: 'baseline', gap: 8, border: 0, background: 'none', padding: 0, cursor: onToggle ? 'pointer' : 'default', minWidth: 0, flex: 1, textAlign: 'left' }}>
          {onToggle && <Icon name={open ? 'chevD' : 'chevR'} size={13} style={{ color: tk.text.faint, alignSelf: 'center' }} />}
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: tk.text.muted, whiteSpace: 'nowrap' }}>{title}</span>
          {summary && <span style={{ fontSize: 11.5, color: tk.text.faint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{summary}</span>}
        </button>
        {action}
      </div>
      {open && children}
    </section>
  );
}

function Labeled({ label, hint, wide, children }: { label: string; hint?: string; wide?: boolean; children: ReactNode }) {
  const tk = useTokens();
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5, gridColumn: wide ? '1 / -1' : undefined, font: `600 12px ${fontFamily.ui}`, color: tk.text.primary }}>
      <span>{label}{hint && <span style={{ fontWeight: 400, color: tk.text.faint }}> · {hint}</span>}</span>
      {children}
    </label>
  );
}

function TextArea({ value, onChange, placeholder, rows = 3, label, mono }: { value: string; onChange: (v: string) => void; placeholder?: string; rows?: number; label: string; mono?: boolean }) {
  const tk = useTokens();
  return (
    <textarea aria-label={label} value={value} rows={rows} placeholder={placeholder} onChange={e => onChange(e.target.value)}
      style={{ resize: 'vertical', padding: '8px 10px', border: 0, outline: 'none', borderRadius: radius.control, background: tk.bg.field, color: tk.text.primary, font: `500 12.5px/1.45 ${mono ? fontFamily.mono : fontFamily.ui}`, minWidth: 0 }} />
  );
}

function IssueLine({ issue }: { issue: Issue }) {
  const tk = useTokens();
  const c = issue.level === 'error' ? tk.status.danger : issue.level === 'warn' ? tk.status.warningText : tk.text.muted;
  return (
    <span style={{ display: 'flex', gap: 6, alignItems: 'flex-start', fontSize: 11.5, lineHeight: 1.45, color: c }}>
      <Icon name={issue.level === 'info' ? 'info' : 'alert'} size={12} style={{ flexShrink: 0, marginTop: 2 }} />
      <span style={{ overflowWrap: 'anywhere' }}>{issue.text}</span>
    </span>
  );
}

const ORIGIN_WORDS: Record<PackNodeOrigin['kind'], string> = {
  scratch: 'Written in the node builder', graph: 'From the graph', graphGroup: 'A group in', groupPreset: 'From the group preset', customFn: 'From the Custom Function', expr: 'From the Expression Block', published: 'A published node',
};
function originText(o: PackNodeOrigin): string {
  switch (o.kind) {
    case 'graph': return `${ORIGIN_WORDS.graph} “${o.graph}”`;
    case 'graphGroup': return `“${o.groupLabel}”, a group in “${o.graph}”`;
    case 'groupPreset': case 'customFn': case 'expr': return `${ORIGIN_WORDS[o.kind]} “${o.label}”`;
    default: return ORIGIN_WORDS[o.kind];
  }
}

function NodeCard({ r, finalLabel, check, issues, first, last, onRename, onMove, onRemove, onEdit }: {
  r: ResolvedNode; finalLabel: string; check?: Check; issues: Issue[]; first: boolean; last: boolean;
  onRename: (label: string) => void; onMove: (by: -1 | 1) => void; onRemove: () => void; onEdit?: () => void;
}) {
  const tk = useTokens();
  const d = r.def;
  const status = !d ? 'missing' : check?.busy || !check ? 'checking' : check.ok ? 'ok' : 'error';
  const sockets = (list: Array<{ key: string; label: string; type: string }>, dir: 'in' | 'out') => (
    <span style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {list.map(s => (
        <span key={`${dir}:${s.key}`} title={`${dir === 'in' ? 'Input' : 'Output'} ${s.label}: ${s.type}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 6px 1px 5px', borderRadius: 6, background: tk.bg.field, font: `500 11px ${fontFamily.ui}`, color: tk.text.secondary }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: TYPE_COLORS[s.type] ?? tk.text.faint }} />{s.label}
        </span>
      ))}
    </span>
  );
  return (
    <div data-testid="pack-node-card" style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 10, borderRadius: radius.md, background: tk.bg.subtle, boxShadow: `inset 0 0 0 1px ${status === 'error' || status === 'missing' ? alpha(tk.status.danger, 0.4) : tk.border.subtle}` }}>
      <div style={{ display: 'flex', gap: 10 }}>
        <div title={check?.error ?? 'Thumbnail with the default values'} style={{ width: 64, height: 64, flexShrink: 0, borderRadius: 8, overflow: 'hidden', background: '#0b0c10', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6c7086', font: `10.5px ${fontFamily.ui}` }}>
          {check?.thumb ? <img src={check.thumb} alt="" style={{ width: '100%', height: '100%', display: 'block' }} /> : status === 'checking' ? '…' : status === 'ok' ? <Icon name="spark" size={18} /> : <Icon name="alert" size={18} style={{ color: '#f38ba8' }} />}
        </div>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Field aria-label="Name in the pack" value={r.node.label} height={28} onChange={e => onRename(e.target.value)} style={{ flex: 1, minWidth: 0, padding: '0 8px' }} />
            {d?.sealed && <span title="Sealed" style={{ display: 'inline-flex', color: tk.accent.text }}><Icon name="lock" size={13} /></span>}
          </span>
          <span style={{ fontSize: 11, color: tk.text.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={originText(r.node.origin)}>
            {originText(r.node.origin)}{finalLabel !== r.node.label.trim() ? ` · goes in as “${finalLabel}”` : ''}
          </span>
          <span style={{ fontSize: 11, fontWeight: 600, color: status === 'ok' ? tk.status.success : status === 'checking' ? tk.text.faint : tk.status.danger }}>
            {status === 'ok' ? 'Compiles' : status === 'checking' ? 'Checking…' : status === 'missing' ? 'Missing' : 'Doesn’t compile'}
          </span>
        </div>
      </div>
      {d && <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {(d.inputs.length > 0 || d.params.length > 0) && <span style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}><span style={{ fontSize: 10.5, color: tk.text.faint, width: 24, paddingTop: 2 }}>in</span>{sockets([...d.inputs, ...d.params.map(p => ({ ...p, type: 'float' }))], 'in')}</span>}
        <span style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}><span style={{ fontSize: 10.5, color: tk.text.faint, width: 24, paddingTop: 2 }}>out</span>{sockets(d.outputs, 'out')}</span>
        {d.description && <DocText text={d.description} style={{ fontSize: 11.5, color: tk.text.muted }} />}
      </div>}
      {issues.map(i => <IssueLine key={i.text} issue={i} />)}
      <div style={{ display: 'flex', alignItems: 'center', gap: 2, marginTop: -2 }}>
        {onEdit ? <Button size="sm" variant="ghost" icon="edit" onClick={onEdit} style={{ height: 26 }}>Edit</Button>
          : <span style={{ fontSize: 11, color: tk.text.faint, paddingLeft: 4 }}>{d?.sealed ? 'Sealed: its code can’t be opened' : d?.sourceHidden ? 'Published without its source' : ''}</span>}
        <span style={{ flex: 1 }} />
        <IconButton icon="chevU" size="sm" label="Move up" disabled={first} onClick={() => onMove(-1)} />
        <IconButton icon="chevD" size="sm" label="Move down" disabled={last} onClick={() => onMove(1)} />
        <IconButton icon="trash" size="sm" tone="danger" label="Remove from the pack (the node type stays)" onClick={onRemove} />
      </div>
    </div>
  );
}

const EXTRA_ICON: Record<PackExtra['kind'], IconName> = { graph: 'graphs', presentation: 'slides', glsl: 'code', background: 'overlay', note: 'text', finishEffect: 'sliders' };
const EXTRA_WORD: Record<PackExtra['kind'], string> = { graph: 'Example graph', presentation: 'Presentation', glsl: 'GLSL shader', background: 'Background image', note: 'Notes', finishEffect: 'Finish effect' };

function ExtraRow({ extra, issues, onChange, onRemove, onFixUnresolved }: { extra: PackExtra; issues: Issue[]; onChange: (e: PackExtra) => void; onRemove: () => void; onFixUnresolved?: () => void }) {
  const tk = useTokens();
  const [open, setOpen] = useState(extra.kind === 'note' && extra.text.trim().split('\n').length <= 2);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 10px', borderRadius: radius.md, background: tk.bg.subtle }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <Icon name={EXTRA_ICON[extra.kind]} size={15} style={{ color: tk.text.muted, flexShrink: 0 }} />
        {extra.kind === 'note'
          ? <Field aria-label="Notes title" value={extra.name} height={28} onChange={e => onChange({ ...extra, name: e.target.value })} style={{ flex: 1, minWidth: 0 }} />
          : <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12.5, color: tk.text.primary }}>{extra.name}</span>}
        <span style={{ fontSize: 11, color: tk.text.muted, whiteSpace: 'nowrap' }}>{EXTRA_WORD[extra.kind]}{'auto' in extra && extra.auto ? ' · suggested' : ''}</span>
        {extra.kind === 'note' && <IconButton icon="edit" size="sm" label={open ? 'Hide the text' : 'Edit the text'} active={open} onClick={() => setOpen(o => !o)} />}
        {onFixUnresolved && <Button size="sm" variant="ghost" onClick={onFixUnresolved} style={{ height: 26 }}>Add the nodes it uses</Button>}
        <IconButton icon="close" size="sm" label="Leave it out" onClick={onRemove} />
      </div>
      {extra.kind === 'note' && open && <TextArea label="Notes" value={extra.text} rows={6} onChange={v => onChange({ ...extra, text: v })} placeholder={'# How to use it\n\nWire **Glow** into a Mix…'} />}
      {issues.map(i => <IssueLine key={i.text} issue={i} />)}
    </div>
  );
}
