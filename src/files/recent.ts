/** The recent things worth a poster on the Files home: graphs (Plays among them), presentations and GLSL shaders, newest first. */
import { walk, type FileNode, type Inventory } from './inventory';

export function recentItems(inv: Inventory, limit = 14): FileNode[] {
  const out: FileNode[] = [];
  for (const n of walk(inv.sections)) if ((n.kind === 'graph' || n.kind === 'presentation' || n.kind === 'shader') && !n.part) out.push(n);
  return out.sort((a, b) => (b.modified ?? 0) - (a.modified ?? 0)).slice(0, limit);
}
