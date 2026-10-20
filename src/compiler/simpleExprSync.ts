/**
 * simpleExprSync.ts — a Simple Expression's inputs take the type of the wire into them
 * (docs/simple-expression.md), the way a Send does (sendReceive.ts syncSendReceiveTypes).
 *
 * Run before every store compile and by compileGraph, so a graph that was just loaded, or a wire that
 * was just made, replaced or removed, retypes at once. Its sockets are also rebuilt from its params
 * (`vars`, `outputType`): an input added, removed or renamed on the card appears here, its wire kept
 * (socket keys never change on a rename). An unwired input is a float. A wire of a type the node can't
 * read (a texture) keeps that type, so the card can say what's wrong.
 *
 * Returns `nodes` itself when nothing changed. A chain (one Simple Expression into another, or into
 * a Send) settles in a few rounds.
 */
import type { DataType, GraphNode, SubgraphData } from '../types/nodeGraph';
import { mapTree, wireType } from './sendReceive';
import { SIMPLE_EXPR_TYPE, retypeSimpleExpr } from '../nodes/definitions/simpleExpr';

export function hasSimpleExpr(nodes: GraphNode[]): boolean {
  for (const n of nodes) {
    if (n.type === SIMPLE_EXPR_TYPE) return true;
    const sg = n.params?.subgraph as SubgraphData | undefined;
    if (sg && Array.isArray(sg.nodes) && hasSimpleExpr(sg.nodes)) return true;
  }
  return false;
}

export function syncSimpleExprTypes(nodes: GraphNode[]): GraphNode[] {
  if (!hasSimpleExpr(nodes)) return nodes;
  let cur = nodes;
  for (let round = 0; round < 6; round++) {
    const next = mapTree(cur, (n, scope, container) => {
      if (n.type !== SIMPLE_EXPR_TYPE) return n;
      const shaped = retypeSimpleExpr(n);
      let inputs = shaped.inputs;
      for (const [key, s] of Object.entries(shaped.inputs)) {
        const t = s.connection ? wireType(s.connection, scope, container) : 'float';
        if (t && t !== s.type) {
          if (inputs === shaped.inputs) inputs = { ...inputs };
          inputs[key] = { ...s, type: t as DataType };
        }
      }
      return inputs === shaped.inputs ? shaped : { ...shaped, inputs };
    });
    if (next === cur) break;
    cur = next;
  }
  return cur;
}
