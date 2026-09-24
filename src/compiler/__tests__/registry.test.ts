/**
 * Registry-wide compile checks. Every node type is compiled on its own
 * (with defaults, wired to an Output) and the emitted shader is inspected:
 *
 *  - D2: every float param the uniform patcher turned into a `u_p_*` uniform
 *    must actually be read in the shader body. A node that reads the param
 *    as a JS number *after* the patcher replaced it with the uniform name
 *    silently falls back to its default — a slider that does nothing.
 *  - D3: two nodes that each carry a GLSL helper with the same name but a
 *    different body must not both be emitted (a redefinition is a GLSL error
 *    and a black canvas).
 */
import { describe, it, expect } from 'vitest';
import { NODE_REGISTRY } from '../../nodes/definitions';
import { compileGraph } from '../graphCompiler';
import type { GraphNode, NodeDefinition, InputSocket, DataType } from '../../types/nodeGraph';

const SKIP = new Set(['output', 'vec4Output']);

/**
 * Params whose GLSL is only emitted when a particular *socket* is connected.
 * With that socket unwired (as in these single-node compiles) the uniform is
 * declared but legitimately unread; a `showWhen` can't express a connection.
 */
const CONNECTION_GATED = new Set([
  'neighborDist.dispScale',   // only in the hash-displacement path (cellID wired, displacement not)
  'glassScene.diffuseness',   // the node emits no code at all until its scene inputs are wired
]);

function makeNode(id: string, type: string, def: NodeDefinition, x = 0): GraphNode {
  const inputs: Record<string, InputSocket> = {};
  for (const [k, sock] of Object.entries(def.inputs ?? {})) inputs[k] = { type: sock.type, label: sock.label };
  return {
    id, type, position: { x, y: 0 }, inputs,
    outputs: { ...(def.outputs ?? {}) },
    params: { ...(def.defaultParams ?? {}) },
  } as GraphNode;
}

/** Pick the output socket most likely to wire cleanly into Output.color. */
function pickOutput(def: NodeDefinition): string | null {
  const outs = Object.entries(def.outputs ?? {});
  if (outs.length === 0) return null;
  const pref: DataType[] = ['vec3', 'float', 'vec4', 'vec2'];
  for (const t of pref) { const hit = outs.find(([, s]) => s.type === t); if (hit) return hit[0]; }
  return outs[0][0];
}

function outputNode(fromId: string, outKey: string): GraphNode {
  return {
    id: 'out', type: 'output', position: { x: 600, y: 0 },
    inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: fromId, outputKey: outKey } } },
    outputs: {}, params: {},
  } as GraphNode;
}

function stripDeclarations(fs: string): string {
  return fs.replace(/^\s*uniform\s+\w+\s+\w+\s*;\s*$/gm, '');
}

const compilable: Array<{ type: string; def: NodeDefinition }> = [];
const notAlone: string[] = [];
for (const [type, def] of Object.entries(NODE_REGISTRY)) {
  if (SKIP.has(type)) continue;
  const outKey = pickOutput(def);
  if (!outKey) { notAlone.push(type); continue; }
  const r = compileGraph({ nodes: [makeNode('n1', type, def), outputNode('n1', outKey)] });
  if (r.success) compilable.push({ type, def }); else notAlone.push(type);
}

describe('node registry', () => {
  it('compiles most node types on their own', () => {
    // Informational: a few types need a specific context (groups, loop carry…).
    console.log(`compiled ${compilable.length} types alone; ${notAlone.length} need context: ${notAlone.join(', ')}`);
    expect(compilable.length).toBeGreaterThan(250);
  });

  it('D2: every param uniform is read by the shader body (no dead sliders)', () => {
    const dead: string[] = [];
    for (const { type, def } of compilable) {
      const outKey = pickOutput(def)!;
      const r = compileGraph({ nodes: [makeNode('n1', type, def), outputNode('n1', outKey)] });
      const body = stripDeclarations(r.fragmentShader);
      for (const uniform of Object.keys(r.paramUniforms)) {
        if (!new RegExp(`\\b${uniform}\\b`).test(body)) {
          const param = uniform.split('_').slice(3).join('_');
          if (CONNECTION_GATED.has(`${type}.${param}`)) continue;
          dead.push(`${type}.${param}`);
        }
      }
    }
    expect(dead, `dead sliders (uniform declared, never read):\n  ${dead.join('\n  ')}`).toEqual([]);
  });

  it('D3: nodes that share a GLSL helper name compile together with one definition each', () => {
    // Function names each node's shader defines (from the single-node compiles).
    const defRe = /^\s*(?:float|vec[234]|mat[234]|int|ivec[234]|bool|bvec[234]|void)\s+([A-Za-z_]\w*)\s*\([^)]*\)\s*\{/gm;
    const preamble = new Set<string>();
    {
      // Functions every shader carries regardless of nodes (the preamble): compile a bare UV → Output.
      const uvDef = NODE_REGISTRY['uv'];
      const r = compileGraph({ nodes: [makeNode('n1', 'uv', uvDef), outputNode('n1', pickOutput(uvDef)!)] });
      for (const m of r.fragmentShader.matchAll(defRe)) preamble.add(m[1]);
    }
    const byName = new Map<string, string[]>();
    const compilableSet = new Map(compilable.map(c => [c.type, c.def]));
    for (const { type, def } of compilable) {
      const r = compileGraph({ nodes: [makeNode('n1', type, def), outputNode('n1', pickOutput(def)!)] });
      for (const m of r.fragmentShader.matchAll(defRe)) {
        if (preamble.has(m[1])) continue;
        const types = byName.get(m[1]) ?? [];
        if (!types.includes(type)) types.push(type);
        byName.set(m[1], types);
      }
    }
    const shared = [...byName.entries()].filter(([, types]) => types.length > 1);
    console.log(`${shared.length} helper names are defined by more than one node type`);

    // Compile the first two carriers of each shared name together; the shader
    // must define the function exactly once.
    const duplicated: string[] = [];
    const tested = new Set<string>();
    for (const [name, types] of shared) {
      const key = `${types[0]}+${types[1]}`;
      if (tested.has(key)) continue;
      tested.add(key);
      const [a, b] = types;
      const defA = compilableSet.get(a)!, defB = compilableSet.get(b)!;
      const r = compileGraph({ nodes: [makeNode('a', a, defA), makeNode('b', b, defB, 300), outputNode('a', pickOutput(defA)!)] });
      if (!r.success) continue;
      const counts = new Map<string, number>();
      for (const m of r.fragmentShader.matchAll(defRe)) counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
      const dups = [...counts.entries()].filter(([, n]) => n > 1).map(([n, c]) => `${n}×${c}`);
      if (dups.length) duplicated.push(`${key}: ${dups.join(', ')}`);
      void name;
    }
    expect(duplicated, `duplicate GLSL definitions:\n  ${duplicated.join('\n  ')}`).toEqual([]);
  });
});
