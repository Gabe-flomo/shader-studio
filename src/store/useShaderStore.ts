import { create } from 'zustand';
import type { Node, Modifier } from '../types/nodes';

interface ShaderStore {
  nodes: Node[];
  selectedNodeId: string | null;
  time: number;
  mouse: [number, number];

  // Actions
  addNode: (node: Node) => void;
  removeNode: (id: string) => void;
  updateNode: (id: string, params: Partial<Node['params']>) => void;
  selectNode: (id: string | null) => void;
  addModifier: (nodeId: string, modifier: Modifier) => void;
  removeModifier: (nodeId: string, modifierId: string) => void;
  setTime: (time: number) => void;
  setMouse: (mouse: [number, number]) => void;
}

export const useShaderStore = create<ShaderStore>((set) => ({
  // Initial state with a simple example
  nodes: [
    {
      id: 'node-1',
      type: 'circleSDF',
      params: { size: 0.5, position: [0, 0] },
      modifiers: [],
    },
    {
      id: 'node-2',
      type: 'makeLight',
      params: { brightness: 5.0 },
      modifiers: [],
    },
    {
      id: 'node-3',
      type: 'palette',
      params: {
        a: [0.5, 0.5, 0.5],
        b: [0.5, 0.5, 0.5],
        c: [1.0, 1.0, 1.0],
        d: [0.0, 0.33, 0.67],
      },
      modifiers: [],
    },
  ],
  selectedNodeId: 'node-1',
  time: 0,
  mouse: [0, 0],

  // Actions
  addNode: (node) =>
    set((state) => ({
      nodes: [...state.nodes, node],
    })),

  removeNode: (id) =>
    set((state) => ({
      nodes: state.nodes.filter((n) => n.id !== id),
    })),

  updateNode: (id, params) =>
    set((state) => ({
      nodes: state.nodes.map((node) =>
        node.id === id ? { ...node, params: { ...node.params, ...params } } : node
      ),
    })),

  selectNode: (id) =>
    set(() => ({
      selectedNodeId: id,
    })),

  addModifier: (nodeId, modifier) =>
    set((state) => ({
      nodes: state.nodes.map((node) =>
        node.id === nodeId
          ? { ...node, modifiers: [...node.modifiers, modifier] }
          : node
      ),
    })),

  removeModifier: (nodeId, modifierId) =>
    set((state) => ({
      nodes: state.nodes.map((node) =>
        node.id === nodeId
          ? {
              ...node,
              modifiers: node.modifiers.filter((m) => m.id !== modifierId),
            }
          : node
      ),
    })),

  setTime: (time) => set({ time }),
  setMouse: (mouse) => set({ mouse }),
}));
