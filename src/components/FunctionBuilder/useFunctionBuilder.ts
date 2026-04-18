import { create } from 'zustand';

export interface FnDef {
  id: string;
  name: string;
  returnType: 'float' | 'vec2' | 'vec3';
  body: string;
}

export interface FnTab {
  id: string;
  label: string;
  functions: FnDef[];
  activeId: string;
  xRange: [number, number];
  yRange: [number, number];
}

export interface SavedGroup {
  id: string;
  name: string;
  savedAt: number;
  tabs: FnTab[];
}

// ── Persistence ───────────────────────────────────────────────────────────────

const STORAGE_KEY = 'fn_builder_groups_v1';

function loadGroups(): SavedGroup[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]'); }
  catch { return []; }
}

function persistGroups(groups: SavedGroup[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(groups)); } catch { /* quota */ }
}

// ── ID helpers ────────────────────────────────────────────────────────────────

let counter = 1;
function nextId(prefix = 'fn') { return `${prefix}_${Date.now()}_${counter++}`; }

function nextName(existing: FnDef[]) {
  const names = new Set(existing.map(f => f.name));
  for (let i = 1; i <= 20; i++) { if (!names.has(`f${i}`)) return `f${i}`; }
  return `f${Date.now()}`;
}

// ── Defaults ──────────────────────────────────────────────────────────────────

function makeDefaultFn(): FnDef {
  return { id: nextId(), name: 'f1', returnType: 'float', body: 'sin(x + t)' };
}

function makeTab(label: string, fn?: FnDef): FnTab {
  const f = fn ?? makeDefaultFn();
  return { id: nextId('tab'), label, functions: [f], activeId: f.id, xRange: [-2, 2], yRange: [-2, 2] };
}

const DEFAULT_TAB = makeTab('Tab 1');

// ── Store ─────────────────────────────────────────────────────────────────────

/** Sync top-level live fields into the active tab entry. */
function syncTab(s: FunctionBuilderState): FnTab[] {
  return s.tabs.map(t =>
    t.id === s.activeTabId
      ? { ...t, functions: s.functions, activeId: s.activeId, xRange: s.xRange, yRange: s.yRange }
      : t
  );
}

interface FunctionBuilderState {
  // Live editing state (mirrors active tab)
  functions: FnDef[];
  activeId: string;
  xRange: [number, number];
  yRange: [number, number];

  // Tabs
  tabs: FnTab[];
  activeTabId: string;

  // Other
  linkedBlockId: string | null;
  requestNavToBuilder: boolean;
  savedGroups: SavedGroup[];

  // ── Function actions (operate on live state + sync to active tab) ──
  addFunction: () => void;
  removeFunction: (id: string) => void;
  updateFunction: (id: string, patch: Partial<FnDef>) => void;
  setActiveId: (id: string) => void;
  setXRange: (range: [number, number]) => void;
  setYRange: (range: [number, number]) => void;

  // ── Tab actions ──
  addTab: () => void;
  closeTab: (id: string) => void;
  switchTab: (id: string) => void;
  renameTab: (id: string, label: string) => void;

  // ── Group save / load ──
  saveGroup: (name: string) => void;
  loadGroup: (group: SavedGroup) => void;
  deleteGroup: (id: string) => void;

  // ── Misc ──
  setLinkedBlockId: (id: string | null) => void;
  loadFromBodies: (fns: FnDef[]) => void;
  openNodeInBuilder: (nodeId: string, fns: FnDef[]) => void;
  clearNavRequest: () => void;
}

export const useFunctionBuilder = create<FunctionBuilderState>((set, get) => ({
  functions:   DEFAULT_TAB.functions,
  activeId:    DEFAULT_TAB.activeId,
  xRange:      DEFAULT_TAB.xRange,
  yRange:      DEFAULT_TAB.yRange,
  tabs:        [DEFAULT_TAB],
  activeTabId: DEFAULT_TAB.id,
  linkedBlockId: null,
  requestNavToBuilder: false,
  savedGroups: loadGroups(),

  // ── Function mutations ───────────────────────────────────────────────────────

  addFunction: () => set(s => {
    const fn: FnDef = { id: nextId(), name: nextName(s.functions), returnType: 'float', body: 'x' };
    const functions = [...s.functions, fn];
    return { functions, activeId: fn.id, tabs: s.tabs.map(t => t.id === s.activeTabId ? { ...t, functions, activeId: fn.id } : t) };
  }),

  removeFunction: (id) => set(s => {
    let functions = s.functions.filter(f => f.id !== id);
    let activeId  = s.activeId;
    if (functions.length === 0) {
      const fn: FnDef = { id: nextId(), name: 'f1', returnType: 'float', body: 'x' };
      functions = [fn]; activeId = fn.id;
    } else if (activeId === id) {
      activeId = functions[functions.length - 1].id;
    }
    return { functions, activeId, tabs: s.tabs.map(t => t.id === s.activeTabId ? { ...t, functions, activeId } : t) };
  }),

  updateFunction: (id, patch) => set(s => {
    const functions = s.functions.map(f => f.id === id ? { ...f, ...patch } : f);
    return { functions, tabs: s.tabs.map(t => t.id === s.activeTabId ? { ...t, functions } : t) };
  }),

  setActiveId: (activeId) => set(s => ({
    activeId, tabs: s.tabs.map(t => t.id === s.activeTabId ? { ...t, activeId } : t),
  })),

  setXRange: (xRange) => set(s => ({
    xRange, tabs: s.tabs.map(t => t.id === s.activeTabId ? { ...t, xRange } : t),
  })),

  setYRange: (yRange) => set(s => ({
    yRange, tabs: s.tabs.map(t => t.id === s.activeTabId ? { ...t, yRange } : t),
  })),

  // ── Tab actions ──────────────────────────────────────────────────────────────

  addTab: () => set(s => {
    const synced = syncTab(s);
    const label  = `Tab ${synced.length + 1}`;
    const tab    = makeTab(label);
    return {
      tabs:        [...synced, tab],
      activeTabId: tab.id,
      functions:   tab.functions,
      activeId:    tab.activeId,
      xRange:      tab.xRange,
      yRange:      tab.yRange,
    };
  }),

  closeTab: (id) => set(s => {
    if (s.tabs.length === 1) return s; // can't close last tab
    const synced   = syncTab(s);
    const next     = synced.filter(t => t.id !== id);
    const switchTo = s.activeTabId === id ? next[Math.max(0, synced.findIndex(t => t.id === id) - 1)] : next.find(t => t.id === s.activeTabId)!;
    return {
      tabs:        next,
      activeTabId: switchTo.id,
      functions:   switchTo.functions,
      activeId:    switchTo.activeId,
      xRange:      switchTo.xRange,
      yRange:      switchTo.yRange,
    };
  }),

  switchTab: (id) => set(s => {
    if (id === s.activeTabId) return s;
    const synced = syncTab(s);
    const tab    = synced.find(t => t.id === id);
    if (!tab) return s;
    return {
      tabs:        synced,
      activeTabId: id,
      functions:   tab.functions,
      activeId:    tab.activeId,
      xRange:      tab.xRange,
      yRange:      tab.yRange,
    };
  }),

  renameTab: (id, label) => set(s => ({
    tabs: s.tabs.map(t => t.id === id ? { ...t, label } : t),
  })),

  // ── Group save / load ────────────────────────────────────────────────────────

  saveGroup: (name) => set(s => {
    const tabs    = syncTab(s);
    const group: SavedGroup = { id: nextId('grp'), name: name.trim() || 'Untitled', savedAt: Date.now(), tabs };
    // Replace if same name exists, otherwise prepend
    const updated = [group, ...s.savedGroups.filter(g => g.name !== group.name)];
    persistGroups(updated);
    return { tabs, savedGroups: updated };
  }),

  loadGroup: (group) => set(() => {
    if (!group.tabs.length) return {};
    // Re-hydrate tab IDs so they're fresh
    const tabs = group.tabs.map(t => ({ ...t, id: nextId('tab'), functions: t.functions.map(f => ({ ...f, id: nextId() })) }));
    // Repoint activeIds after re-hydrating
    const hydratedTabs = tabs.map((t, i) => {
      const orig = group.tabs[i];
      const origActiveIdx = orig.functions.findIndex(f => f.id === orig.activeId);
      const activeId = t.functions[Math.max(0, origActiveIdx)]?.id ?? t.functions[0].id;
      return { ...t, activeId };
    });
    const first = hydratedTabs[0];
    return {
      tabs: hydratedTabs,
      activeTabId: first.id,
      functions: first.functions,
      activeId: first.activeId,
      xRange: first.xRange,
      yRange: first.yRange,
    };
  }),

  deleteGroup: (id) => set(s => {
    const updated = s.savedGroups.filter(g => g.id !== id);
    persistGroups(updated);
    return { savedGroups: updated };
  }),

  // ── Misc ─────────────────────────────────────────────────────────────────────

  setLinkedBlockId: (linkedBlockId) => set({ linkedBlockId }),

  loadFromBodies: (fns) => {
    const activeId = fns[fns.length - 1]?.id ?? '';
    set(s => {
      const functions = fns;
      return { functions, activeId, tabs: s.tabs.map(t => t.id === s.activeTabId ? { ...t, functions, activeId } : t) };
    });
  },

  openNodeInBuilder: (nodeId, fns) => {
    const rehydrated = fns.map(f => ({ ...f, id: nextId() }));
    const activeId   = rehydrated[rehydrated.length - 1]?.id ?? '';
    set(s => ({
      functions: rehydrated,
      activeId,
      tabs: s.tabs.map(t => t.id === s.activeTabId ? { ...t, functions: rehydrated, activeId } : t),
      linkedBlockId: nodeId,
      requestNavToBuilder: true,
    }));
  },

  clearNavRequest: () => set({ requestNavToBuilder: false }),
}));
