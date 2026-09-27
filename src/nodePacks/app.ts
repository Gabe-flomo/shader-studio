/**
 * The pack workspace's side of the app: storage, the node registry, the
 * compiler (does each node compile? its thumbnail), and the export (signed
 * with this author's key, sealed when asked) through the one .playfile writer.
 */
import type { GraphNode } from '../types/nodeGraph';
import type { UserNodeDefinition } from '../types/userNode';
import { getOfferedDefinitions } from '../nodes/definitions';
import { getUserNode, setTransientUserNode } from '../nodes/userNodes/userNodeRegistry';
import { unsealDefinition } from '../playfile/sealing';
import { localMutableKV } from '../files/mutate';
import { getImage } from '../lib/backgroundLibrary';
import { requireFeature } from '../lib/plan';
import { appBundleEnv, currentAuthorName, signerFor, videosFor } from '../playfile/app';
import { playfileName, writePlayfile, type WriteItem } from '../playfile/writer';
import { PLAYFILE_MIME } from '../playfile/format';
import { existingAuthorKey, setAuthorName } from '../playfile/signing';
import { errorMessage, saveBinaryFile, type FileResult } from '../utils/fileIO';
import { assemblePack, itemBytes, nextExportVersion, type AssembledPack, type PackEnv } from './assemble';
import { recordExport, refreshSnapshots, saveProject } from './projects';
import type { PackProject } from './types';

export function appPackEnv(): PackEnv {
  return {
    kv: localMutableKV,
    userNode: getUserNode,
    presentationFile: appBundleEnv.presentationFile,
    backgroundFile: async id => {
      const img = await getImage(id);
      return img ? { bytes: new Uint8Array(await img.blob.arrayBuffer()), type: img.type, name: img.name } : null;
    },
    builtinLabels: () => getOfferedDefinitions().filter(d => !d.type.startsWith('un_')).map(d => d.label),
  };
}

export { currentAuthorName };

// ── Checking a node ─────────────────────────────────────────────────────────

export interface NodeCheck { ok: boolean; error?: string; fragmentShader?: string; uniforms?: Record<string, { value: number | number[] }> }

/**
 * Compile one node type the way the node builder's preview does: an instance
 * wired to an Output. A node that's only in the pack (its type was deleted
 * here) is looked up as a transient definition for the check.
 */
export async function checkPackNode(def: UserNodeDefinition): Promise<NodeCheck> {
  const { compileGraph } = await import('../compiler/graphCompiler');
  const registered = getUserNode(def.id);
  let transient = false;
  if (!registered) {
    try { setTransientUserNode(def.sealed && !def.functionCode ? unsealDefinition(def) : def); transient = true; } catch (e) { return { ok: false, error: `The sealed node couldn’t be opened: ${errorMessage(e)}` }; }
  }
  try {
    const primary = def.outputs[0];
    if (!primary) return { ok: false, error: 'It has no outputs.' };
    const inst: GraphNode = {
      id: 'p', type: def.id, position: { x: 0, y: 0 },
      inputs: Object.fromEntries([...def.inputs.map(i => [i.key, { type: i.type, label: i.label }] as const), ...def.params.map(p => [p.key, { type: 'float' as const, label: p.label }] as const)]),
      outputs: Object.fromEntries(def.outputs.map(o => [o.key, { type: o.type, label: o.label }])),
      params: {
        ...Object.fromEntries(def.inputs.filter(i => i.slider).map(i => [i.key, i.slider!.default])),
        ...Object.fromEntries(def.params.map(p => [p.key, p.default])),
        ...(def.iterations ? { [def.iterations.key]: def.iterations.default } : {}),
      },
    };
    const drawable = ['float', 'vec2', 'vec3', 'vec4'].includes(primary.type);
    const nodes: GraphNode[] = [inst];
    if (drawable) {
      nodes.push({
        id: 'o', type: primary.type === 'vec4' ? 'vec4Output' : 'output', position: { x: 0, y: 0 },
        inputs: { color: { type: primary.type === 'vec4' ? 'vec4' : 'vec3', label: 'Color', connection: { nodeId: 'p', outputKey: primary.key } } },
        outputs: {}, params: {},
      });
    }
    const r = compileGraph({ nodes });
    if (!r.success) return { ok: false, error: (r.errors ?? ['It didn’t compile']).join('\n') };
    if (!drawable) return { ok: true };
    const uniforms: Record<string, { value: number | number[] }> = { u_time: { value: 1.0 } };
    for (const [k, v] of Object.entries(r.paramUniforms)) uniforms[k] = { value: v as number | number[] };
    return { ok: true, fragmentShader: r.fragmentShader, uniforms };
  } finally {
    if (transient) setTransientUserNode(null);
  }
}

/** A node's thumbnail (a data URL), '' when it can't be drawn. Rendering on the GPU is the last check: a shader it rejects is an error. */
export async function packNodeThumb(def: UserNodeDefinition, check: NodeCheck, size = 96): Promise<{ url: string; error?: string }> {
  if (!check.ok || !check.fragmentShader) return { url: '' };
  const { nodePreviewRenderer } = await import('../lib/nodePreviewRenderer');
  try {
    const url = await nodePreviewRenderer.renderNodePreview(`pack_${def.id}`, check.fragmentShader, check.uniforms ?? {}, size);
    return { url };
  } catch (e) { return { url: '', error: errorMessage(e) }; }
}

// ── Export ──────────────────────────────────────────────────────────────────

export interface PreparedExport {
  project: PackProject;
  version: string;
  assembled: AssembledPack;
  items: WriteItem[];
  rows: Array<{ kind: WriteItem['kind']; name: string; bytes: number; sealed?: boolean; note?: string }>;
  totalBytes: number;
  /** This device's signing key's fingerprint, or '' when one will be made on export. */
  signer: string;
  notes: string[];
}

/** Everything the summary shows before the download: items and sizes, what's sealed, who signs. Null when the videos question was called off. */
export async function preparePackExport(p: PackProject, version = nextExportVersion(p)): Promise<PreparedExport | null> {
  const env = appPackEnv();
  const assembled = await assemblePack(p, env, { version });
  const videos = await videosFor(assembled.items);
  if (videos === null) return null;
  const items = [...assembled.items, ...videos.items];
  const rows = items.map(it => ({
    kind: it.kind, name: it.name, bytes: itemBytes(it),
    ...(it.kind === 'nodes' ? { sealed: assembled.sealed, note: `${assembled.defs.length} node${assembled.defs.length === 1 ? '' : 's'}` } : {}),
    ...(it.meta?.example ? { note: 'Example' } : {}),
  }));
  const key = await existingAuthorKey().catch(() => null);
  return {
    project: p, version, assembled, items, rows,
    totalBytes: rows.reduce((n, r) => n + r.bytes, 0),
    signer: key?.fingerprint ?? '',
    notes: [...assembled.notes, ...(videos.note ? [videos.note] : [])],
  };
}

/** Write the pack (signed, Pro), save it, and remember the export in the project (it moves to that version). */
export async function exportPreparedPack(prep: PreparedExport): Promise<FileResult & { project?: PackProject; fingerprint?: string }> {
  if (!requireFeature('nodes.pack')) return { ok: false, error: 'Making node packs is part of Pro', cancelled: true };
  try {
    const p = prep.project;
    if (p.author.trim()) setAuthorName(p.author.trim());
    const signer = await signerFor(true);
    const { bytes } = await writePlayfile(prep.items, { author: p.author.trim() || currentAuthorName(), signer });
    const file = playfileName(`${p.name} ${prep.version}`);
    const res = await saveBinaryFile(bytes, file, PLAYFILE_MIME);
    if (!res.ok) return res;
    const next = saveProject(recordExport(refreshSnapshots(p, getUserNode), { version: prep.version, at: Date.now(), signer: signer?.fingerprint, sealed: prep.assembled.sealed, bytes: bytes.length }));
    return { ok: true, project: next, fingerprint: signer?.fingerprint };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}
