/**
 * The library never has a row or a labelled sub-group holding a single node (docs/node-browser.md,
 * "No one-node rows or groups"): a lone node goes into its most fitting neighbour. The desktop Nodes
 * list, the phone's Browse and the node search all lay rows out from libraryRows.ts, so checking its
 * layout checks all three. The Pass lives in Texture tools.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const mem = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); }, key: () => null, length: 0, clear: () => mem.clear() };
});

import { getNodeDefinition, getOfferedDefinitions } from '../../../nodes/definitions';
import { scoreNodeDef } from '../../../nodes/searchNodes';
import { CATEGORY_GROUPS, CATEGORY_SECTIONS, libraryLayout, nodesOfRow, rowOfType } from '../libraryRows';

describe('no one-node rows or sub-groups', () => {
  const layout = libraryLayout(new Set());

  it('every row lists at least two nodes', () => {
    const lone = layout.flatMap(s => s.rows.filter(r => r.groups.reduce((n, g) => n + g.types.length, 0) < 2).map(r => `${s.label} / ${r.label}`));
    expect(lone).toEqual([]);
  });

  it('every labelled sub-group lists at least two nodes', () => {
    const lone = layout.flatMap(s => s.rows.flatMap(r => r.groups.filter(g => g.label !== null && g.types.length < 2).map(g => `${r.label} / ${g.label}: ${g.types.join(', ')}`)));
    expect(lone).toEqual([]);
  });

  it('every declared sub-group (CATEGORY_GROUPS) names at least two nodes of its row', () => {
    const lone = Object.entries(CATEGORY_GROUPS).flatMap(([row, groups]) => {
      const inRow = new Set(nodesOfRow(row).map(d => d.type));
      return groups.filter(g => g.types.filter(t => inRow.has(t)).length < 2).map(g => `${row} / ${g.label}`);
    });
    expect(lone).toEqual([]);
  });
});

describe('the Pass is a Texture tool', () => {
  it('is listed in Texture tools (Pass and time), and there is no Passes row', () => {
    const tex = libraryLayout(new Set()).flatMap(s => s.rows).find(r => r.row === 'Texture tools')!;
    expect(tex.groups.find(g => g.label === 'Pass and time')?.types).toContain('pass');
    expect(CATEGORY_SECTIONS.flatMap(s => s.categories)).not.toContain('Passes');
    const d = getNodeDefinition('pass')!;
    expect(rowOfType(d.type, d.category)).toBe('Texture tools');
  });

  it('search still finds it by name and alias', () => {
    const top = (q: string, n: number) => getOfferedDefinitions().map(d => ({ t: d.type, s: scoreNodeDef(d, q) })).filter(x => x.s > 0)
      .sort((a, b) => b.s - a.s || a.t.localeCompare(b.t)).slice(0, n).map(x => x.t);
    expect(top('pass', 3)).toContain('pass');
    expect(top('render to texture', 5)).toContain('pass');
  });
});
