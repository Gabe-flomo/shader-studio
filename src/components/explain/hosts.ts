/**
 * What each place that explains code knows (types, roles, globals), and how "Use it here too"
 * puts a made node back where the expression was.
 *
 *  - Expression Block: blocks can't call functions, so the made node is added next to the
 *    block, wired from the same sources as the block's inputs it reads, and its result comes
 *    back in as a new input that replaces the sub-expression.
 *  - Custom Function and the GLSL page: the function goes into the code and the sub-expression
 *    becomes a call (saveFlows.callInCustomFn / insertFunction).
 */
import type { DataType, GraphNode } from '../../types/nodeGraph';
import type { ExprPreset } from '../../types/exprPreset';
import { getActiveNodes, useNodeGraphStore } from '../../store/useNodeGraphStore';
import { getUserNode } from '../../nodes/userNodes/userNodeRegistry';
import { customFnEnv, exprBlockEnv, exprPresetParams, roleOfSourceNode, callInCustomFn, type BuiltFunction, type GeneraliseContext, type GlslType, type RoleEnv } from '../../lib/glslPatterns';

/** What was made: a saved Expression Block preset, or a published node type. */
export type Made = { kind: 'preset'; preset: Omit<ExprPreset, 'id' | 'savedAt'> } | { kind: 'userNode'; id: string };

export interface UseHere {
  /** The button's words. */
  label: string;
  /** Why it can't be used here, or null when it can. */
  blocked: (built: BuiltFunction) => string | null;
  apply: (built: BuiltFunction, made: Made) => void;
}

/** The nodes of the graph level being edited (the neighbours of a node are in it). */
export function scopeNodes(): GraphNode[] {
  const st = useNodeGraphStore.getState();
  return getActiveNodes(st.nodes, st.activeGroupPath) ?? st.nodes;
}

/** Roles of an Expression Block's inputs, from what feeds them (a UV node is space, Time is time…). */
export function exprBlockRoles(node: GraphNode, nodes: GraphNode[] = scopeNodes()): RoleEnv {
  const out: RoleEnv = {};
  for (const [name, sock] of Object.entries(node.inputs ?? {})) {
    const c = sock.connection;
    if (!c) continue;
    const src = nodes.find(n => n.id === c.nodeId);
    if (!src) continue;
    const role = roleOfSourceNode(src.type, src.outputs?.[c.outputKey]?.type as GlslType | undefined);
    if (role) out[name] = role;
  }
  return out;
}

/** An Expression Block's code as it compiles: its lines, then Return (what "Explain more" is told about the surroundings). */
export function exprBlockCode(node: GraphNode): string {
  const lines = (node.params.lines as Array<{ lhs?: string; op?: string; rhs?: string; off?: boolean }> | undefined) ?? [];
  const out = lines.filter(l => l.rhs?.trim() && !l.off).map(l => `${l.lhs ?? ''} ${l.op || '='} ${l.rhs}`.trim());
  const ret = typeof node.params.result === 'string' ? node.params.result.trim() : '';
  if (ret) out.push(`return ${ret}`);
  return out.join('\n');
}

/** The explain / generalise context of an Expression Block. */
export function exprBlockContext(node: GraphNode): GeneraliseContext {
  const types = exprBlockEnv(node);
  const declared = new Set(((node.params.inputs as Array<{ name: string }> | undefined) ?? []).map(i => i.name));
  // `t` (the clock) is there in every block unless an input takes the name; the scratch `p` is a line's variable
  const globals = ['t'].filter(n => !declared.has(n));
  return { types, roles: exprBlockRoles(node), globals };
}

/** The explain / generalise context of a Custom Function: its parameters, locals and wiring. */
export function customFnContext(node: GraphNode): GeneraliseContext {
  return { types: customFnEnv(node), roles: exprBlockRoles(node) };
}

/** "Use it here too" in a Custom Function: the function joins the helpers, the span becomes a call. */
export function customFnUseHere(nodeId: string, span: { start: number; end: number }): UseHere {
  return {
    label: 'Use it here too: the function goes into Helper functions and this part becomes a call to it',
    blocked: () => null,
    apply: built => {
      const st = useNodeGraphStore.getState();
      const n = scopeNodes().find(x => x.id === nodeId);
      if (!n) return;
      const body = typeof n.params.body === 'string' ? n.params.body : '';
      const helpers = typeof n.params.glslFunctions === 'string' ? n.params.glslFunctions : '';
      const r = callInCustomFn(body, helpers, built.code, span, built.call);
      st.updateNodeParams(nodeId, { body: r.body, glslFunctions: r.helpers });
    },
  };
}

type InputDef = { name: string; type: DataType; slider: { min: number; max: number } | null; carry?: boolean };
type Line = { lhs: string; op: string; rhs: string; off?: boolean };

/**
 * "Use it here too" in an Expression Block. `where` is a line index or 'return'; the span is
 * in that line's expression (rhs / result) text.
 */
export function exprBlockUseHere(nodeId: string, where: number | 'return', span: { start: number; end: number }): UseHere {
  const block = () => scopeNodes().find(n => n.id === nodeId);
  return {
    label: 'Use it here too: add the node, wire it in, and read its result here',
    blocked: built => {
      const n = block();
      if (!n) return 'The block isn’t in this view.';
      const inputs = (n.params.inputs as InputDef[] | undefined) ?? [];
      for (const p of built.params) {
        if (p.kind === 'literal') continue;
        const name = p.source.trim();
        const inp = inputs.find(i => i.name === name);
        if (!inp) return p.kind === 'free'
          ? `“${name}” is computed inside the block (a line’s variable or the clock), so the new node can’t be wired to it. Save it, and wire it by hand.`
          : `“${name}” is computed inside the block, so the new node can’t be wired to it. Save it, and wire it by hand.`;
        if (inp.slider) return `“${name}” is a slider on this block; a separate node can’t read it. Wire “${name}” from a node first, or wire the new node by hand.`;
      }
      return null;
    },
    apply: (built, made) => {
      const st = useNodeGraphStore.getState();
      const n = block();
      if (!n) return;
      const pos = { x: n.position.x - 420, y: n.position.y + 40 };
      let newId: string | undefined;
      let keys: string[] = built.params.map(p => p.name);
      let outKey = 'result';
      if (made.kind === 'preset') newId = st.addNode('exprNode', pos, exprPresetParams(made.preset));
      else {
        const def = getUserNode(made.id);
        if (!def) return;
        newId = st.addNode(made.id, pos);
        keys = def.inputs.map(i => i.key);
        outKey = def.outputs[0]?.key ?? 'result';
      }
      if (!newId) return;
      const inputs = (n.params.inputs as InputDef[] | undefined) ?? [];
      built.params.forEach((p, i) => {
        const key = keys[i];
        if (!key) return;
        if (p.kind === 'literal') {
          if (p.default !== undefined) st.updateNodeParams(newId!, { [key]: p.default });
          return;
        }
        const conn = n.inputs[p.source.trim()]?.connection;
        if (conn) st.connectNodes(conn.nodeId, conn.outputKey, newId!, key);
      });
      // A new input on the block, fed by the new node
      let name = built.fnName;
      for (let k = 2; inputs.some(i => i.name === name); k++) name = `${built.fnName}${k}`;
      const outType = (built.outputType === 'vec2' || built.outputType === 'vec3' || built.outputType === 'vec4' ? built.outputType : 'float') as DataType;
      const nextInputs: InputDef[] = [...inputs, { name, type: outType, slider: null }];
      const lines = (n.params.lines as Line[] | undefined) ?? [];
      const blockOut = ((n.params.outputType as DataType | undefined) ?? 'float');
      const exposed = ((n.params.outputs as string[] | undefined) ?? []).map(nm => {
        const inp = nextInputs.find(i => i.name === nm);
        if (inp) return { name: nm, type: inp.type };
        for (const l of lines) { const m = /^\s*(float|vec[234])\s+([A-Za-z_]\w*)/.exec(l.lhs); if (m && m[2] === nm) return { name: nm, type: m[1] as DataType }; }
        return null;
      }).filter((x): x is { name: string; type: DataType } => !!x);
      st.updateNodeParams(nodeId, { inputs: nextInputs });
      st.updateNodeSockets(nodeId, nextInputs, blockOut, exposed);
      st.connectNodes(newId, outKey, nodeId, name);
      if (where === 'return') {
        const r = (n.params.result as string | undefined) ?? '';
        st.updateNodeParams(nodeId, { result: r.slice(0, span.start) + name + r.slice(span.end) });
      } else {
        st.updateNodeParams(nodeId, { lines: lines.map((l, i) => (i === where ? { ...l, rhs: l.rhs.slice(0, span.start) + name + l.rhs.slice(span.end) } : l)) });
      }
    },
  };
}
