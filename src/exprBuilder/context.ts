/**
 * context.ts — where a piece of code sits in its graph, for the move catalogue
 * (docs/expression-builder-plan.md §2).
 *
 *  - what fed a variable: follow the code node's input wire back (through group ports, conversion
 *    and pass-through nodes, other code nodes) to a UV node, a March Loop's position, a Normal, Time…;
 *  - what its result went into: the nodes wired from the code node's output (a distance, a colour,
 *    a palette, a mask…);
 *  - whether it sits inside a 3D container (Scene Group, March Loop), or after one (on a surface);
 *  - the pattern-index techniques (src/patterns) the node takes part in.
 *
 * Code outside graphs (imported or saved shaders, linked files) is read by names instead (`nameFeed`).
 */
import { GROUP_PORT_SENTINEL, type GraphNode } from '../types/nodeGraph';
import { roleFromName, roleOfSourceNode, type GlslType, type Role } from '../lib/glslPatterns';
import { analyseGraph, techniquesAtNode, type GraphOrigin, type GraphPatterns } from '../patterns/patternIndex';
import type { Dimension, Feed, Into } from './moves';

type Conn = { nodeId: string; outputKey: string } | undefined;

/** A node found by its group path, with the levels around it. */
export interface NodeSite {
  node: GraphNode;
  /** The node lists from the top level down to the node's own level. */
  levels: GraphNode[][];
  /** The group / container nodes it sits in, outermost first (levels[i + 1] is ancestors[i]'s subgraph). */
  ancestors: GraphNode[];
}

export interface FeedInfo { feed: Feed; /** Came out of a 3D container (a March Loop's hit position, normal, colour…). */ via3d: boolean }

const THREE_D = /^(sceneGroup|marchLoopGroup|giLitMarchGroup)$|scene|march/i;
export const isThreeDContainer = (n: GraphNode) => THREE_D.test(n.type) && n.type !== 'group';

const CODE = new Set(['exprNode', 'customFn']);
const PALETTES = /^(palette|palettePreset|cosinePalette|stopPalette|gradient|colorize)$/;

const subOf = (n: GraphNode): GraphNode[] | undefined => {
  const sg = n.params?.subgraph as { nodes?: GraphNode[] } | undefined;
  return Array.isArray(sg?.nodes) ? sg!.nodes : undefined;
};

/** Feeds by source node type and output key. */
function tableFeed(n: GraphNode, key: string): FeedInfo | null {
  const t = n.type;
  const plain = (feed: Feed): FeedInfo => ({ feed, via3d: false });
  switch (t) {
    case 'uv': case 'uvCoords': case 'screenUv': case 'centeredUv': return plain('uv');
    case 'fragCoord': return plain('fragCoord');
    case 'time': case 'clock': return plain('time');
    case 'mouse': return plain('mouse');
    case 'loopIndex': return plain('loopIndex');
    case 'fieldCell': return plain('cell');
    case 'agentInputs': return plain('agent');
    case 'scenePos': return plain('position');
    case 'marchLoopInputs':
      return key === 'marchPos' ? plain('position') : key === 'marchDist' ? plain('distance') : key === 'rd' ? plain('rayDir') : key === 'ro' ? plain('rayOrigin') : null;
    case 'marchCamera':
      return key === 'rd' ? plain('rayDir') : key === 'ro' ? plain('rayOrigin') : null;
  }
  if (isThreeDContainer(n)) {
    const f: Feed = key === 'pos' ? 'hitPos' : key === 'normal' ? 'normal' : /^(dist|depth)$/.test(key) ? 'distance' : key === 'color' ? 'colour' : /^(hit|iter|iterCount)$/.test(key) ? 'mask' : 'value';
    return { feed: f, via3d: true };
  }
  return null;
}

const PRIORITY: Partial<Record<Feed, number>> = {
  uv: 6, fragCoord: 6, position: 6, hitPos: 6, normal: 6, rayDir: 5, rayOrigin: 5, mouse: 4,
  distance: 3, colour: 3, cell: 3, agent: 3, time: 2, loopIndex: 2, mask: 1, value: 1, constant: 0, unknown: 0,
};
const better = (a: FeedInfo, b: FeedInfo) => ((PRIORITY[b.feed] ?? 0) > (PRIORITY[a.feed] ?? 0) ? b : a);

function roleFeed(role: Role | null, type?: string): Feed | null {
  switch (role) {
    case 'space': return type === 'vec3' ? 'position' : 'uv';
    case 'colour': return 'colour';
    case 'distance': return 'distance';
    case 'time': return 'time';
    case 'mask': return 'mask';
    case 'direction': return 'normal';
    case 'cell': return 'cell';
    case 'value': return 'value';
    default: return null;
  }
}

/** What a name stands for when there is no graph to ask (imported code, a shader file). */
export function nameFeed(name: string, type: GlslType): Feed {
  if (/^(u_resolution|iResolution|resolution)$/.test(name)) return 'value';
  if (/^(gl_FragCoord|fragCoord)$/.test(name)) return 'fragCoord';
  if (/^(vUv|uv|st|uv0|suv)$/i.test(name)) return 'uv';
  if (/^(u_time|iTime|time|t|tt)$/.test(name) && (type === 'float' || type === 'unknown')) return 'time';
  if (/^(u_mouse|iMouse|mouse|m)$/.test(name) && type !== 'float') return 'mouse';
  if (/^(rd|raydir|dir)$/i.test(name) && type === 'vec3') return 'rayDir';
  if (/^(ro|rayorigin|eye|cam|campos)$/i.test(name) && type === 'vec3') return 'rayOrigin';
  if (/^(n|nor|nrm|normal|norm)$/i.test(name) && type === 'vec3') return 'normal';
  if (/^(hp|hit|hitpos|pos)$/i.test(name) && type === 'vec3') return 'position';
  return roleFeed(roleFromName(name, type), type) ?? (type === 'vec2' ? 'uv' : type === 'float' ? 'value' : 'unknown');
}

export interface GraphContext {
  find(path: readonly string[] | undefined): NodeSite | undefined;
  /** What feeds a code node's input (by name). */
  feedOfInput(site: NodeSite, input: string): FeedInfo;
  /** What a code node's output goes into, or null when nothing is wired. */
  intoOfNode(site: NodeSite): Into | null;
  /** Inside a Scene Group / March Loop. */
  in3D(site: NodeSite): boolean;
  /** Pattern-index techniques at a node, sorted. */
  techniquesAt(nodeId: string): string[];
  patterns: GraphPatterns | null;
}

export function graphContext(id: string, label: string, origin: GraphOrigin, nodes: readonly GraphNode[]): GraphContext {
  let patterns: GraphPatterns | null = null;
  try { patterns = analyseGraph({ id, label, origin, nodes }); } catch { patterns = null; }
  const techCache = new Map<string, string[]>();
  const siteCache = new Map<string, NodeSite | undefined>();

  function find(path: readonly string[] | undefined): NodeSite | undefined {
    if (!path?.length) return undefined;
    const k = path.join('/');
    if (siteCache.has(k)) return siteCache.get(k);
    let level = nodes as GraphNode[];
    const levels: GraphNode[][] = [level];
    const ancestors: GraphNode[] = [];
    let site: NodeSite | undefined;
    for (let i = 0; i < path.length; i++) {
      const n = level.find(x => x.id === path[i]);
      if (!n) break;
      if (i === path.length - 1) { site = { node: n, levels, ancestors }; break; }
      const sub = subOf(n);
      if (!sub) break;
      ancestors.push(n);
      level = sub;
      levels.push(level);
    }
    siteCache.set(k, site);
    return site;
  }

  /** Follow a connection at `depthIdx` (index into levels) back to what it carries. */
  function feedOfConn(conn: Conn, levels: GraphNode[][], ancestors: GraphNode[], depth: number): FeedInfo {
    if (!conn) return { feed: 'constant', via3d: false };
    if (depth > 8) return { feed: 'unknown', via3d: false };
    if (conn.nodeId === GROUP_PORT_SENTINEL) {
      const parent = ancestors[ancestors.length - 1];
      if (!parent) return { feed: 'unknown', via3d: false };
      return feedOfConn(parent.inputs?.[conn.outputKey]?.connection, levels.slice(0, -1), ancestors.slice(0, -1), depth + 1);
    }
    const level = levels[levels.length - 1];
    const src = level.find(n => n.id === conn.nodeId);
    if (!src) return { feed: 'unknown', via3d: false };
    return feedOfNode(src, conn.outputKey, levels, ancestors, depth + 1);
  }

  function feedOfNode(n: GraphNode, key: string, levels: GraphNode[][], ancestors: GraphNode[], depth: number): FeedInfo {
    const t = tableFeed(n, key);
    if (t) return t;
    const outType = n.outputs?.[key]?.type;
    // A group: what its output port carries, from inside.
    const sub = subOf(n);
    if (sub && n.type === 'group') {
      const port = (n.params?.subgraph as { outputPorts?: Array<{ key: string; fromNodeId: string; fromOutputKey: string }> }).outputPorts?.find(p => p.key === key);
      const inner = port && sub.find(x => x.id === port.fromNodeId);
      if (inner && port) return feedOfNode(inner, port.fromOutputKey, [...levels, sub], [...ancestors, n], depth + 1);
    }
    // Code and pass-through nodes: the best of what feeds them.
    const conns = Object.entries(n.inputs ?? {}).filter(([, s]) => s.connection);
    if (conns.length && depth <= 8) {
      const sameType = CODE.has(n.type) ? conns : conns.filter(([, s]) => s.type === outType);
      let best: FeedInfo | null = null;
      for (const [, s] of (sameType.length ? sameType : conns)) {
        const f = feedOfConn(s.connection, levels, ancestors, depth + 1);
        best = best ? better(best, f) : f;
      }
      if (best && best.feed !== 'unknown' && best.feed !== 'constant') return best;
    }
    const role = roleOfSourceNode(n.type, outType as GlslType | undefined, key);
    return { feed: roleFeed(role, outType) ?? 'value', via3d: false };
  }

  function feedOfInput(site: NodeSite, input: string): FeedInfo {
    const sock = site.node.inputs?.[input];
    if (!sock) return { feed: 'unknown', via3d: false };
    return feedOfConn(sock.connection, site.levels, site.ancestors, 0);
  }

  /** What a consumer's input makes of a value. */
  function consumerInto(c: GraphNode, key: string, levels: GraphNode[][], ancestors: GraphNode[], depth: number): Into | null {
    if (CODE.has(c.type)) {
      if (depth > 4) return 'value';
      return intoAt({ node: c, levels, ancestors }, depth + 1) ?? 'value';
    }
    const t = c.type;
    const sockType = c.inputs?.[key]?.type;
    if (PALETTES.test(t) && sockType === 'float') return 'palette';
    if (/sdf|SDF|union|smin|subtract|intersect|marchSceneDist|sceneOutput|sdfFill|glow/i.test(t) && sockType === 'float') return /fill|glow/i.test(t) ? 'mask' : 'distance';
    if (/^(d|dist|distance|sdf)$/.test(key) && sockType === 'float') return 'distance';
    if (t === 'output' || t === 'toneMap' || t === 'addColor' || t === 'vignette' || sockType === 'vec3' && /col|color|colour|rgb|albedo|bg|tint|^a$|^b$/i.test(key)) return 'colour';
    if (/^sampleTexture|texture/i.test(t) && sockType === 'vec2') return 'sample';
    if (/^(mask|alpha|t|amount|hit|factor|mix)$/i.test(key) && sockType === 'float') return 'mask';
    if (/^(compare|smoothstep|step|select)$/.test(t)) return 'mask';
    if (sockType === 'vec2') return 'space';
    if (sockType === 'vec3' && /^(p|pos|position|uv|point)$/i.test(key)) return 'space';
    if (sockType === 'vec3' || sockType === 'vec4') return 'colour';
    if (sockType === 'float') return 'value';
    return null;
  }

  const INTO_PRIORITY: Partial<Record<Into, number>> = { distance: 6, palette: 5, colour: 4, mask: 3, sample: 3, space: 2, value: 1 };

  function intoAt(site: NodeSite, depth = 0): Into | null {
    const level = site.levels[site.levels.length - 1];
    let best: Into | null = null;
    const take = (x: Into | null) => { if (x && (!best || (INTO_PRIORITY[x] ?? 0) > (INTO_PRIORITY[best] ?? 0))) best = x; };
    for (const c of level) {
      for (const [k, s] of Object.entries(c.inputs ?? {})) {
        if (s.connection?.nodeId === site.node.id) take(consumerInto(c, k, site.levels, site.ancestors, depth));
      }
    }
    // Out of a group, through its output ports.
    const parent = site.ancestors[site.ancestors.length - 1];
    if (!best && parent) {
      const ports = (parent.params?.subgraph as { outputPorts?: Array<{ key: string; fromNodeId: string }> } | undefined)?.outputPorts ?? [];
      if (ports.some(p => p.fromNodeId === site.node.id) && depth <= 4) {
        if (isThreeDContainer(parent)) take('distance');
        else take(intoAt({ node: parent, levels: site.levels.slice(0, -1), ancestors: site.ancestors.slice(0, -1) }, depth + 1));
      }
      // Inside a Scene Group / March Loop: what its output node takes.
      if (!best) for (const c of level) for (const [k, s] of Object.entries(c.inputs ?? {})) {
        if (s.connection?.nodeId === site.node.id && /Output$/.test(c.type)) take(/pos/i.test(k) ? 'space' : 'distance');
      }
    }
    return best;
  }

  return {
    find,
    feedOfInput,
    intoOfNode: s => intoAt(s),
    in3D: s => s.ancestors.some(isThreeDContainer),
    techniquesAt: nodeId => {
      if (!patterns) return [];
      let hit = techCache.get(nodeId);
      if (!hit) { hit = techniquesAtNode(patterns, nodeId).map(t => t.technique.id).sort(); techCache.set(nodeId, hit); }
      return hit;
    },
    patterns,
  };
}

/**
 * The dimension a move was used in, from what fed its variable and where the code sits.
 * `fnName` / `file3D` are for code outside graphs: a shader's `map` / `sdf` functions are world
 * space, its normal / lighting functions surface.
 */
export function dimensionOf(o: {
  type: GlslType; feed: Feed; role: Role; in3D: boolean; via3d: boolean; fnName?: string; file3D?: boolean; graph3D?: boolean;
}): Dimension {
  const { type, feed } = o;
  if ((type === 'float' || type === 'int') && (feed === 'time' || (o.role === 'time' && feed !== 'distance'))) return '1d-time';
  if (feed === 'position' || feed === 'rayDir' || feed === 'rayOrigin' || (feed === 'agent' && type === 'vec3')) return '3d-world';
  if (o.in3D) return '3d-world';
  if (feed === 'hitPos' || feed === 'normal' || o.via3d) return '3d-surface';
  if (feed === 'uv' || feed === 'fragCoord' || feed === 'mouse') return '2d';
  const fn = o.fnName ?? '';
  if (fn && /^(map|scene|sdf?|de|df|field|world|sd[A-Z0-9_]\w*|op[A-Z]\w*|fold\w*|kifs\w*)$/i.test(fn)) return '3d-world';
  if (fn && o.file3D && /normal|light|shade|shadow|ao|occlusion|material|render|lighting/i.test(fn)) return '3d-surface';
  if (o.file3D && type === 'vec3' && (o.role === 'space' || feed === 'unknown')) return '3d-world';
  return '2d';
}

/** A role for a feed, for inferRoles (graph-known roles). */
export function feedRole(feed: Feed, type: GlslType): Role | undefined {
  switch (feed) {
    case 'uv': case 'fragCoord': case 'mouse': case 'position': case 'hitPos': case 'rayOrigin': return type === 'float' || type === 'int' ? undefined : 'space';
    case 'normal': case 'rayDir': return type === 'float' || type === 'int' ? undefined : 'direction';
    case 'time': return type === 'float' ? 'time' : undefined;
    case 'distance': return type === 'float' ? 'distance' : undefined;
    case 'colour': return type === 'vec3' || type === 'vec4' ? 'colour' : undefined;
    case 'cell': return 'cell';
    case 'agent': return type === 'float' || type === 'int' ? undefined : 'space';
    case 'mask': return type === 'float' ? 'mask' : undefined;
    default: return undefined;
  }
}
