/**
 * ExplainScope — what a place that explains code tells Explain about its surroundings (docs/explain-model.md):
 * the node the code belongs to (for its neighbours and the techniques found on it), the whole enclosing code, and
 * words for where it is. A place that provides nothing still works: the model just gets less to go on.
 */
import { createContext, useContext } from 'react';
import type { GraphNode } from '../../types/nodeGraph';

export interface ExplainScopeValue {
  /** The node the code belongs to (an Expression Block, a Custom Function). */
  nodeId?: string;
  /** "Expression Block", "Custom Function", "GLSL page": when there is no node to look up. */
  kind?: string;
  /** The graph level the node is in, read when the question is asked. */
  getNodes?: () => readonly GraphNode[];
  /** The whole code around a line (every line of the block, the function body, the file). */
  enclosing?: () => string;
}

const Ctx = createContext<ExplainScopeValue>({});
export const ExplainScopeProvider = Ctx.Provider;
export const useExplainScope = (): ExplainScopeValue => useContext(Ctx);
