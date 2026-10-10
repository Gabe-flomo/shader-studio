/**
 * The sidebar's Saved Graphs: recent work first under Today / This week / Earlier, folders as
 * their own section after, everything newest first, and the list scrolling inside itself.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const folders = { graphs: { folders: [{ id: 'f1', label: 'Client work', collapsed: false, createdAt: 1 }], membership: { inFolderOld: 'f1', inFolderNew: 'f1' } } };
  vi.stubGlobal('localStorage', { getItem: (k: string) => (k === 'assetbrowser_folders' ? JSON.stringify(folders) : null), setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});
import { renderToStaticMarkup } from 'react-dom/server';
import { FolderableList } from '../FolderableList';
import { DAY_MS, groupByTime, sortByRecent } from '../../../store/graphRecency';

const NOW = Date.now();
const when: Record<string, number> = { today: NOW - 1000, week: NOW - 3 * DAY_MS, earlier: NOW - 30 * DAY_MS, inFolderOld: NOW - 40 * DAY_MS, inFolderNew: NOW - 60_000 };
const items = Object.keys(when).map(id => ({ id, label: id }));

const render = (maxHeight?: string) => renderToStaticMarkup(
  <FolderableList scopeKey="graphs" color="#0a0" items={items}
    renderItem={i => <span data-row={i.id}>{i.label}</span>}
    groupLoose={list => groupByTime(list, i => when[i.id], i => i.label)}
    sortItems={list => sortByRecent(list, i => when[i.id], i => i.label)}
    foldersLast maxHeight={maxHeight} />,
);

describe('Saved Graphs by time', () => {
  it('shows Today, This week, Earlier, then Folders, newest first inside each', () => {
    const html = render('320px');
    const order = [...html.matchAll(/data-row="([^"]+)"|>(Today|This week|Earlier|Folders|Client work)</g)].map(m => m[1] ?? m[2]);
    expect(order).toEqual(['Today', 'today', 'This week', 'week', 'Earlier', 'earlier', 'Folders', 'Client work', 'inFolderNew', 'inFolderOld']);
  });

  it('scrolls inside itself past its max height', () => {
    const html = render('320px');
    expect(html).toMatch(/data-folderable-scroll="" style="[^"]*max-height:320px;overflow-y:auto/);
    // Without one (the other lists), nothing changes.
    expect(render()).not.toContain('data-folderable-scroll');
    expect(render()).not.toContain('overflow-y:auto');
  });
});
