const TAGS_KEY = 'assetbrowser_tags';

export function loadTagMap(): Record<string, string[]> {
  try { return JSON.parse(localStorage.getItem(TAGS_KEY) ?? '{}'); } catch { return {}; }
}

export function getAssetTags(tabId: string, assetId: string): string[] {
  return loadTagMap()[`${tabId}:${assetId}`] ?? [];
}

export function saveAssetTags(tabId: string, assetId: string, tags: string[]) {
  const map = loadTagMap();
  const key = `${tabId}:${assetId}`;
  if (tags.length === 0) delete map[key]; else map[key] = tags;
  localStorage.setItem(TAGS_KEY, JSON.stringify(map));
  window.dispatchEvent(new Event('assetbrowser-tags-changed'));
}

export function getTagSuggestions(tabId: string, currentFilters: string[]): string[] {
  const map = loadTagMap();
  const tags = new Set<string>();
  for (const [k, v] of Object.entries(map)) {
    if (k.startsWith(`${tabId}:`)) v.forEach((t: string) => tags.add(t));
  }
  return [...tags].filter(t => !currentFilters.includes(t)).sort();
}
