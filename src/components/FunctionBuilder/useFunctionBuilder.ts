import { create } from 'zustand';

export interface FnDef {
  id: string;
  name: string;
  returnType: 'float' | 'vec2' | 'vec3';
  body: string;
}

interface FunctionBuilderState {
  functions: FnDef[];
  activeId: string;
  xRange: [number, number];
  yRange: [number, number];
  linkedBlockId: string | null;
  requestNavToBuilder: boolean;

  addFunction: () => void;
  removeFunction: (id: string) => void;
  updateFunction: (id: string, patch: Partial<FnDef>) => void;
  setActiveId: (id: string) => void;
  setXRange: (range: [number, number]) => void;
  setYRange: (range: [number, number]) => void;
  setLinkedBlockId: (id: string | null) => void;
  loadFromBodies: (fns: FnDef[]) => void;
  openNodeInBuilder: (nodeId: string, fns: FnDef[]) => void;
  clearNavRequest: () => void;
}

let counter = 1;
function nextId() { return `fn_${Date.now()}_${counter++}`; }
function nextName(existing: FnDef[]) {
  const names = new Set(existing.map(f => f.name));
  for (let i = 1; i <= 20; i++) {
    const n = `f${i}`;
    if (!names.has(n)) return n;
  }
  return `f${Date.now()}`;
}

const DEFAULT_FN: FnDef = {
  id: nextId(),
  name: 'f1',
  returnType: 'float',
  body: 'sin(x + t)',
};

export const useFunctionBuilder = create<FunctionBuilderState>((set, get) => ({
  functions: [DEFAULT_FN],
  activeId: DEFAULT_FN.id,
  xRange: [-2, 2],
  yRange: [-2, 2],
  linkedBlockId: null,
  requestNavToBuilder: false,

  addFunction: () => set(s => {
    const fn: FnDef = {
      id: nextId(),
      name: nextName(s.functions),
      returnType: 'float',
      body: 'x',
    };
    return { functions: [...s.functions, fn], activeId: fn.id };
  }),

  removeFunction: (id) => set(s => {
    const next = s.functions.filter(f => f.id !== id);
    if (next.length === 0) {
      const fn: FnDef = { id: nextId(), name: 'f1', returnType: 'float', body: 'x' };
      return { functions: [fn], activeId: fn.id };
    }
    const activeId = s.activeId === id ? next[next.length - 1].id : s.activeId;
    return { functions: next, activeId };
  }),

  updateFunction: (id, patch) => set(s => ({
    functions: s.functions.map(f => f.id === id ? { ...f, ...patch } : f),
  })),

  setActiveId: (id) => set({ activeId: id }),
  setXRange: (xRange) => set({ xRange }),
  setYRange: (yRange) => set({ yRange }),
  setLinkedBlockId: (linkedBlockId) => set({ linkedBlockId }),

  loadFromBodies: (fns) => {
    const active = fns[fns.length - 1]?.id ?? '';
    set({ functions: fns, activeId: active, linkedBlockId: get().linkedBlockId });
  },

  openNodeInBuilder: (nodeId, fns) => {
    // Re-hydrate each fn with a stable id so they work as React keys
    const rehydrated = fns.map(f => ({ ...f, id: nextId() }));
    const activeId = rehydrated[rehydrated.length - 1]?.id ?? '';
    set({ functions: rehydrated, activeId, linkedBlockId: nodeId, requestNavToBuilder: true });
  },

  clearNavRequest: () => set({ requestNavToBuilder: false }),
}));
