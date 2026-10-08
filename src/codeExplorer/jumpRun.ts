/**
 * jumpRun.ts — carry out a jump to source (plans from jump.ts) in the app.
 * Opening another graph asks first when the open one has unsaved changes.
 */
import { planJump, type GraphRef } from './jump';
import { requestNodeJump, requestTextJump } from './jumpStore';
import { lastOpenedGraph } from './client';
import type { Provenance } from './types';
import { useNodeGraphStore } from '../store/useNodeGraphStore';
import { requestPage } from '../components/page';
import { askConfirm } from '../components/ui/dialogStore';
import { toast } from '../components/ui/toastStore';
import { requestConvert } from '../components/convert/convertHandoff';
import { CONVERT_EXAMPLES } from '../glslToGraph/examples';
import { rememberLast } from '../present/storage';
import { resolveLinked } from '../files/linkedFolders';
import { linkedRef } from '../files/linkedRefs';
import { closeCodeExplorer } from '../components/codeExplorer/explorerStore';

const frame = () => new Promise<void>(r => requestAnimationFrame(() => r()));

async function openGraph(plan: { graph: GraphRef }): Promise<boolean> {
  const st = useNodeGraphStore.getState();
  const g = plan.graph;
  const isOpen = g.kind === 'open'
    || (g.kind === 'saved' && st.currentGraph?.name === g.name)
    || (g.kind === 'example' && !st.currentGraph && lastOpenedGraph()?.kind === 'example' && (lastOpenedGraph() as { key: string }).key === g.key);
  if (isOpen) return true;
  const what = g.kind === 'saved' ? `“${g.name}”` : 'that example';
  if (st.graphDirty && !(await askConfirm(`Open ${what}?`, { message: 'The graph open now has changes that aren’t saved; opening another one drops them.', confirmLabel: 'Open', danger: true }))) return false;
  if (g.kind === 'example') { await st.loadExampleGraph(g.key); return true; }
  if (g.kind === 'saved') {
    const r = st.loadSavedGraph(g.name);
    if (!r.ok) { toast.error('Couldn’t open it', { message: r.error }); return false; }
  }
  return true;
}

export async function jumpToSource(p: Provenance & { length?: number }): Promise<void> {
  const plan = planJump(p);
  const length = p.length ?? 0;
  // The dialog steps aside so the code can be seen (the GLSL page's panel stays).
  if (plan.to !== 'none') closeCodeExplorer();
  switch (plan.to) {
    case 'graph': {
      if (!(await openGraph(plan))) return;
      requestPage('studio');
      await frame();
      const s = useNodeGraphStore.getState();
      if (s.activeGroupPath.length) s.exitToDepth(0);
      // Enter the groups it sits in, as far as the Studio goes (two deep, not sealed groups); past that, show the group.
      let scope = useNodeGraphStore.getState().nodes;
      let target = plan.nodeId;
      const path: string[] = [];
      let reachable = true;
      for (const gid of plan.groupPath) {
        const g = scope.find(x => x.id === gid);
        if (!g) { reachable = false; break; }
        if (g.sealed || path.length >= 2) { target = gid; reachable = false; break; }
        path.push(gid);
        scope = (g.params.subgraph as { nodes?: typeof scope } | undefined)?.nodes ?? [];
      }
      if (reachable && plan.editor) requestNodeJump({ nodeId: plan.nodeId, field: plan.field, line: plan.line, column: plan.column, length });
      const s2 = useNodeGraphStore.getState();
      if (!path.length) s2.focusNode(target); else s2.revealNode(path, target);
      return;
    }
    case 'shader':
      requestTextJump({ kind: 'shader', id: plan.id, line: plan.line, column: plan.column, length });
      requestPage('glsl');
      return;
    case 'file': {
      const r = await resolveLinked(linkedRef(plan.folderId, plan.path)).catch(() => null);
      if (!r || !r.ok) { toast.error('Couldn’t read that file', { message: 'Its linked folder may be disconnected.' }); return; }
      requestTextJump({ kind: 'file', text: await r.blob.text(), label: plan.path, line: plan.line, column: plan.column, length });
      requestPage('glsl');
      return;
    }
    case 'convert':
      if (plan.key && CONVERT_EXAMPLES[plan.key]) requestConvert(CONVERT_EXAMPLES[plan.key].code);
      requestPage('convert');
      return;
    case 'present':
      rememberLast(plan.name);
      requestPage('present');
      return;
    case 'files': requestPage('files'); return;
    case 'builder': requestPage('fn'); return;
    case 'none': toast.info(plan.why); return;
  }
}

/**
 * Open a graph (asking first over unsaved changes) and select some of its nodes: the Patterns view's
 * "show me where". Nodes inside groups are shown by their top-level group.
 */
export async function openGraphSelecting(graph: GraphRef, nodes: Array<{ id: string; path: string[] }>): Promise<void> {
  closeCodeExplorer();
  if (!(await openGraph({ graph }))) return;
  requestPage('studio');
  await frame();
  const s = useNodeGraphStore.getState();
  if (s.activeGroupPath.length) s.exitToDepth(0);
  const top = [...new Set(nodes.map(n => n.path[0] ?? n.id))].filter(id => s.nodes.some(x => x.id === id));
  if (!top.length) return;
  s.focusNode(top[0]);
  if (top.length > 1) useNodeGraphStore.getState().selectNodes(top);
}
