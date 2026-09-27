/**
 * Pack projects on this device: one localStorage key each
 * (`shader-studio-nodepack:<id>`), so they travel in library ZIPs and profiles
 * like the rest of the library. A project keeps references to the node types,
 * graphs and files it packs (and a copy of each node), not the files
 * themselves: reopening it picks up whatever changed since.
 */
import type { UserNodeDefinition } from '../types/userNode';
import { storedForm } from '../playfile/sealing';
import { PACK_PROJECT_KIND, type PackExport, type PackNode, type PackProject } from './types';

export const PACK_PROJECT_PREFIX = 'shader-studio-nodepack:';
export const PACK_PROJECTS_CHANGED = 'nodepack-projects-changed';

export interface ProjectKV { keys(): string[]; get(k: string): string | null; set(k: string, v: string): void; remove(k: string): void }

export const localProjectKV: ProjectKV = {
  keys: () => { try { return Object.keys(localStorage); } catch { return []; } },
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { localStorage.setItem(k, v); },
  remove: k => { try { localStorage.removeItem(k); } catch { /* gone */ } },
};

const PACK_COLORS = ['#7c5cff', '#e0663a', '#1f9d8a', '#d4467d', '#3b82f6', '#c28a12'];

export function newProject(name: string, o: { author?: string; now?: number; id?: string } = {}): PackProject {
  const now = o.now ?? Date.now();
  const id = o.id ?? `pack_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  return {
    kind: PACK_PROJECT_KIND, id, name: name.trim() || 'My node pack', author: o.author ?? '', version: '1.0.0',
    description: '', color: PACK_COLORS[now % PACK_COLORS.length], icon: '', licence: '', sealed: false,
    packNodes: [], extras: [], createdAt: now, updatedAt: now, exports: [],
  };
}

function isProject(v: unknown): v is PackProject {
  const p = v as Partial<PackProject> | null;
  return !!p && p.kind === PACK_PROJECT_KIND && typeof p.id === 'string' && typeof p.name === 'string' && Array.isArray(p.packNodes) && Array.isArray(p.extras);
}

/** Fill fields an older project may lack. */
function normalise(p: PackProject): PackProject {
  return { ...newProject(p.name, { id: p.id, now: p.createdAt }), ...p, exports: Array.isArray(p.exports) ? p.exports : [] };
}

export function listProjects(kv: ProjectKV = localProjectKV): PackProject[] {
  const out: PackProject[] = [];
  for (const k of kv.keys()) {
    if (!k.startsWith(PACK_PROJECT_PREFIX)) continue;
    try { const v = JSON.parse(kv.get(k) ?? 'null') as unknown; if (isProject(v)) out.push(normalise(v)); } catch { /* not a project */ }
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function loadProject(id: string, kv: ProjectKV = localProjectKV): PackProject | null {
  try { const v = JSON.parse(kv.get(PACK_PROJECT_PREFIX + id) ?? 'null') as unknown; return isProject(v) ? normalise(v) : null; } catch { return null; }
}

export function saveProject(p: PackProject, kv: ProjectKV = localProjectKV, now = Date.now()): PackProject {
  const next = { ...p, updatedAt: now };
  kv.set(PACK_PROJECT_PREFIX + p.id, JSON.stringify(next));
  try { window.dispatchEvent(new Event(PACK_PROJECTS_CHANGED)); } catch { /* no window in tests */ }
  return next;
}

export function deleteProject(id: string, kv: ProjectKV = localProjectKV): void {
  kv.remove(PACK_PROJECT_PREFIX + id);
  try { window.dispatchEvent(new Event(PACK_PROJECTS_CHANGED)); } catch { /* no window in tests */ }
}

// ── Edits (pure) ────────────────────────────────────────────────────────────

/** Add a node type (its copy kept in stored form, so a sealed one stays sealed). Adding one that's there refreshes it. */
export function addNode(p: PackProject, def: UserNodeDefinition, origin: PackNode['origin']): PackProject {
  const node: PackNode = { nodeId: def.id, label: def.label, origin, snapshot: storedForm(def) };
  const i = p.packNodes.findIndex(n => n.nodeId === def.id);
  if (i >= 0) return { ...p, packNodes: p.packNodes.map((n, j) => (j === i ? { ...node, label: n.label, origin: n.origin.kind === 'published' ? origin : n.origin } : n)) };
  return { ...p, packNodes: [...p.packNodes, node] };
}

export function renameNode(p: PackProject, nodeId: string, label: string): PackProject {
  return { ...p, packNodes: p.packNodes.map(n => (n.nodeId === nodeId ? { ...n, label } : n)) };
}

export function removeNode(p: PackProject, nodeId: string): PackProject {
  return { ...p, packNodes: p.packNodes.filter(n => n.nodeId !== nodeId) };
}

/** Move a node up (-1) or down (+1). */
export function moveNode(p: PackProject, nodeId: string, by: -1 | 1): PackProject {
  const i = p.packNodes.findIndex(n => n.nodeId === nodeId);
  const j = i + by;
  if (i < 0 || j < 0 || j >= p.packNodes.length) return p;
  const list = [...p.packNodes];
  [list[i], list[j]] = [list[j], list[i]];
  return { ...p, packNodes: list };
}

/** Refresh every node's kept copy from the node types here (before saving an export). */
export function refreshSnapshots(p: PackProject, userNode: (id: string) => UserNodeDefinition | undefined): PackProject {
  return { ...p, packNodes: p.packNodes.map(n => { const d = userNode(n.nodeId); return d ? { ...n, snapshot: storedForm(d) } : n; }) };
}

/** An export went out: remember it and move the project to that version. */
export function recordExport(p: PackProject, e: PackExport): PackProject {
  return { ...p, version: e.version, exports: [...p.exports, e] };
}
