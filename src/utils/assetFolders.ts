// ── Asset folder storage ──────────────────────────────────────────────────────
// Folders are a lightweight organizational layer stored separately from the
// assets themselves.  A "scope key" identifies which panel owns which folders.
// Scope keys: 'graphs' | 'functions' | 'presets:group' | 'presets:transform' | 'expressions'

const STORAGE_KEY = 'assetbrowser_folders';

export interface FolderEntry {
  id: string;         // 'folder_<timestamp>'
  label: string;
  collapsed: boolean;
  createdAt: number;
}

// Per-scope data
interface ScopeData {
  folders: FolderEntry[];
  membership: Record<string, string>; // assetId → folderId
}

// Full store: scopeKey → ScopeData
type FolderStore = Record<string, ScopeData>;

// ── Raw load / save ───────────────────────────────────────────────────────────

function loadStore(): FolderStore {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
  } catch {
    return {};
  }
}

function saveStore(store: FolderStore): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  window.dispatchEvent(new Event('assetbrowser-folders-changed'));
}

function getScope(store: FolderStore, scopeKey: string): ScopeData {
  if (!store[scopeKey]) store[scopeKey] = { folders: [], membership: {} };
  return store[scopeKey];
}

// ── Public API ────────────────────────────────────────────────────────────────

export function loadFolders(scopeKey: string): FolderEntry[] {
  return getScope(loadStore(), scopeKey).folders;
}

export function getMembership(scopeKey: string): Record<string, string> {
  return getScope(loadStore(), scopeKey).membership;
}

export function getFolderForItem(scopeKey: string, itemId: string): string | null {
  return getMembership(scopeKey)[itemId] ?? null;
}

export function createFolder(scopeKey: string, label: string): FolderEntry {
  const store = loadStore();
  const scope = getScope(store, scopeKey);
  const folder: FolderEntry = {
    id: `folder_${Date.now()}`,
    label,
    collapsed: false,
    createdAt: Date.now(),
  };
  scope.folders.push(folder);
  saveStore(store);
  return folder;
}

export function renameFolder(scopeKey: string, folderId: string, label: string): void {
  const store = loadStore();
  const scope = getScope(store, scopeKey);
  const f = scope.folders.find(x => x.id === folderId);
  if (f) { f.label = label; saveStore(store); }
}

export function deleteFolder(scopeKey: string, folderId: string): void {
  const store = loadStore();
  const scope = getScope(store, scopeKey);
  scope.folders = scope.folders.filter(f => f.id !== folderId);
  // Remove memberships pointing to this folder
  for (const [k, v] of Object.entries(scope.membership)) {
    if (v === folderId) delete scope.membership[k];
  }
  saveStore(store);
}

export function toggleFolderCollapsed(scopeKey: string, folderId: string): void {
  const store = loadStore();
  const scope = getScope(store, scopeKey);
  const f = scope.folders.find(x => x.id === folderId);
  if (f) { f.collapsed = !f.collapsed; saveStore(store); }
}

export function moveItemsToFolder(scopeKey: string, itemIds: string[], folderId: string): void {
  const store = loadStore();
  const scope = getScope(store, scopeKey);
  for (const id of itemIds) scope.membership[id] = folderId;
  saveStore(store);
}

export function removeItemsFromFolders(scopeKey: string, itemIds: string[]): void {
  const store = loadStore();
  const scope = getScope(store, scopeKey);
  for (const id of itemIds) delete scope.membership[id];
  saveStore(store);
}

/** Returns the folder label given a folder ID (or null if not found). */
export function getFolderLabel(scopeKey: string, folderId: string): string | null {
  return loadFolders(scopeKey).find(f => f.id === folderId)?.label ?? null;
}
