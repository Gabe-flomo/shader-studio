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
import { NODE_REGISTRY, NODE_ALIASES, getNodeDefinition, resolveNodeAliases, aliasParams } from '../../nodes/definitions';
import { migrateNodeParams } from '../../types/nodeGraph';
import { loadExampleGraphs } from '../../store/exampleIndex';
import { compileGraph } from '../graphCompiler';
import type { GraphNode, NodeDefinition, InputSocket, DataType } from '../../types/nodeGraph';
import { coerce, coerceLossy, typesCompatible } from '../../lib/typesCompatible';
import { validateGraph } from '../validate';
import { pruneUnusedGlslFunctions } from '../shaderAssembler';

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

// ── D12: one promotion table for every site ──────────────────────────────────
describe('type promotion (D12)', () => {
  it('coerce() expresses exactly the wire-compatible promotions', () => {
    const types = ['float', 'vec2', 'vec3', 'vec4'];
    for (const a of types) for (const b of types) {
      expect(typesCompatible(a, b), `${a}→${b}`).toBe(coerce('x', a, b) !== null);
    }
    expect(coerce('c', 'vec3', 'vec4')).toBe('vec4(c, 1.0)');
    expect(coerce('f', 'float', 'vec4')).toBe('vec4(f)');
    expect(coerce('v', 'vec3', 'vec2')).toBe('(v).xy');
    expect(coerce('v', 'vec4', 'vec3')).toBeNull();
    expect(coerceLossy('v', 'vec4', 'float')).toBe('v.x');
  });

  it('a vec3 wire into vec4Output.color validates and assembles as vec4(c, 1.0)', () => {
    const grad = makeNode('g', 'gradient', NODE_REGISTRY['gradient']);
    const out: GraphNode = {
      id: 'out', type: 'vec4Output', position: { x: 600, y: 0 },
      inputs: { color: { type: 'vec4', label: 'Color (RGBA)', connection: { nodeId: 'g', outputKey: 'color' } } },
      outputs: {}, params: {},
    } as GraphNode;
    expect(validateGraph([grad, out])).toEqual({ valid: true });
    const res = compileGraph({ nodes: [grad, out] });
    expect(res.errors ?? []).toEqual([]);
    expect(res.fragmentShader).toMatch(/gl_FragColor = vec4\([A-Za-z0-9_]+, 1\.0\);/);
  });
});

// ── D10: only the helpers a graph reaches are emitted ────────────────────────
describe('helper pruning (D10)', () => {
  it('shapeSDF set to circle emits sdCircle2 but not the other 34 shapes', () => {
    const def = NODE_REGISTRY['shapeSDF'];
    const n = makeNode('s', 'shapeSDF', def);
    n.params.shape = 'circle';
    const res = compileGraph({ nodes: [n, outputNode('s', 'distance')] });
    expect(res.errors ?? []).toEqual([]);
    expect(res.fragmentShader).toMatch(/float sdCircle2\(/);
    for (const fn of ['sdHeart', 'sdStar5', 'sdHyperbola', 'sdStairs', 'sdMoon']) {
      expect(res.fragmentShader, `${fn} should be pruned`).not.toMatch(new RegExp(`float ${fn}\\(`));
    }
    n.params.shape = 'heart';
    const res2 = compileGraph({ nodes: [n, outputNode('s', 'distance')] });
    expect(res2.fragmentShader).toMatch(/float sdHeart\(/);
    expect(res2.fragmentShader).toMatch(/float dot2\(/); // reached through sdHeart
    expect(res2.fragmentShader).not.toMatch(/float sdCircle2\(/);
  });

  it('keeps helpers reached only through another helper', () => {
    const kept = pruneUnusedGlslFunctions(
      ['float inner(float x) { return x; }\nfloat outer(float x) { return inner(x); }\nfloat unused(float x) { return x; }'],
      '    float v = outer(1.0);\n',
    );
    expect(kept.join('\n')).toMatch(/float inner\(/);
    expect(kept.join('\n')).toMatch(/float outer\(/);
    expect(kept.join('\n')).not.toMatch(/float unused\(/);
  });
});

// ── D4–D6: merged node types load through aliases ────────────────────────────
describe('node aliases (D4–D6)', () => {
  it('every alias points at a registered type with the sockets and params it names', () => {
    for (const [old, alias] of Object.entries(NODE_ALIASES)) {
      expect(NODE_REGISTRY[old], `${old} is aliased and must not also be registered`).toBeUndefined();
      const def = NODE_REGISTRY[alias.to];
      expect(def, `${old} → ${alias.to}`).toBeTruthy();
      for (const nk of Object.values(alias.inputs ?? {}))  expect(def.inputs[nk],  `${old}: input ${nk}`).toBeTruthy();
      for (const nk of Object.values(alias.outputs ?? {})) expect(def.outputs[nk], `${old}: output ${nk}`).toBeTruthy();
      for (const [k, v] of Object.entries(aliasParams(alias, {}))) {
        if (v === undefined || k === 'outputType') continue;
        expect(k in (def.defaultParams ?? {}) || !!def.paramDefs?.[k], `${old}: param ${k}`).toBe(true);
      }
    }
  });

  it('a smoothMin graph loads as sdfUnion with k, and the downstream wire follows the renamed output', () => {
    const uv = makeNode('u', 'uv', NODE_REGISTRY['uv']);
    const c1 = makeNode('c1', 'circleSDF', NODE_REGISTRY['circleSDF']);
    const c2 = makeNode('c2', 'circleSDF', NODE_REGISTRY['circleSDF']);
    c1.inputs.position.connection = { nodeId: 'u', outputKey: 'uv' };
    c2.inputs.position.connection = { nodeId: 'u', outputKey: 'uv' };
    const legacy: GraphNode = {
      id: 's', type: 'smoothMin', position: { x: 0, y: 0 },
      inputs: {
        a: { type: 'float', label: 'A', connection: { nodeId: 'c1', outputKey: 'distance' } },
        b: { type: 'float', label: 'B', connection: { nodeId: 'c2', outputKey: 'distance' } },
        smoothness: { type: 'float', label: 'Blend radius' },
      },
      outputs: { result: { type: 'float', label: 'Result' } },
      params: { smoothness: 0.25 },
    } as GraphNode;
    const out = outputNode('s', 'result');
    const nodes = resolveNodeAliases([uv, c1, c2, legacy, out], getNodeDefinition).map(n => migrateNodeParams(n, getNodeDefinition));
    const s = nodes.find(n => n.id === 's')!;
    expect(s.type).toBe('sdfUnion');
    expect(s.params.k).toBe(0.25);
    expect('smoothness' in s.params).toBe(false);
    expect(Object.keys(s.inputs).sort()).toEqual(['a', 'b', 'k']);
    expect(s.outputs.dist).toBeTruthy();
    expect(nodes.find(n => n.id === 'out')!.inputs.color.connection?.outputKey).toBe('dist');
    const res = compileGraph({ nodes });
    expect(res.errors ?? []).toEqual([]);
    expect(res.fragmentShader).toMatch(/float sdfunion_\d+_dist/);
  });

  it('every bundled example loads (aliases resolved) with only registered types and compiles', async () => {
    const graphs = await loadExampleGraphs();
    const bad: string[] = [];
    const walk = (nodes: GraphNode[], key: string) => {
      for (const n of nodes) {
        if (!NODE_REGISTRY[n.type]) bad.push(`${key}: unregistered type ${n.type}`);
        const sg = n.params?.subgraph as { nodes?: GraphNode[] } | undefined;
        if (sg?.nodes) walk(sg.nodes, key);
      }
    };
    for (const [key, g] of Object.entries(graphs)) {
      const nodes = resolveNodeAliases(g.nodes, getNodeDefinition).map(n => migrateNodeParams(n, getNodeDefinition));
      walk(nodes, key);
      const res = compileGraph({ nodes });
      if (res.errors?.length) bad.push(`${key}: ${res.errors[0]}`);
    }
    expect(bad).toEqual([]);
  });

  it('a vectorised multiply inside a loop-carry group is pre-declared with its live type', async () => {
    const graphs = await loadExampleGraphs();
    const g = graphs['groupCarryFBM'];   // multiplyVec2 → multiply (vec2) inside an accumulating group
    const nodes = resolveNodeAliases(g.nodes, getNodeDefinition).map(n => migrateNodeParams(n, getNodeDefinition));
    const res = compileGraph({ nodes });
    expect(res.errors ?? []).toEqual([]);
    const decl = res.fragmentShader.match(/^\s*(\w+) (\w+_mul_\d+_result);$/m);
    expect(decl, 'carry pre-declaration').toBeTruthy();
    expect(decl![1]).toBe('vec2');
  });
});
