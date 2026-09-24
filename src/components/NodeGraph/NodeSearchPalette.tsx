/**
 * NodeSearchPalette — floating fuzzy-search popup for adding nodes.
 *
 * Opens on the 'a' shortcut (or via setSearchPaletteOpen from store).
 * Type to fuzzy-filter node types, arrow keys to navigate, Enter/click to place.
 * Escape closes without placing.
 */

import { scoreNodeDef } from '../../nodes/searchNodes';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { NODE_REGISTRY, getNodeDefinition } from '../../nodes/definitions';
import type { NodeDefinition } from '../../types/nodeGraph';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { CATEGORY_COLORS, HIDDEN_TYPES } from './nodeCategoryMeta';
import { ctp } from '../../theme/palette';

// ── Build searchable list once ─────────────────────────────────────────────────
interface SearchEntry {
  type: string;
  def: NodeDefinition;
  searchKey: string; // label + type + category + description, lowercased
}

const ALL_ENTRIES: SearchEntry[] = Object.entries(NODE_REGISTRY)
  // Deprecated nodes stay loadable from saved graphs but aren't offered for new ones.
  .filter(([type, def]) => !HIDDEN_TYPES.has(type) && !def.deprecated)
  .map(([type, def]) => ({
    type,
    def,
    searchKey: [def.label, ...(def.aliases ?? []), type, def.category, def.description ?? ''].join(' ').toLowerCase(),
  }));

// ── Scorer — substring/prefix only, no fuzzy char-scatter ────────────────────
function scoreEntry(entry: SearchEntry, query: string): number {
  return scoreNodeDef(entry.def, query);
}

// ── Component ─────────────────────────────────────────────────────────────────

// ── Type compatibility helpers ─────────────────────────────────────────────────
// float can feed into any type; anything can feed into float (promotion)
function outputMatchesFilter(nodeType: string, filterOutputType: string): boolean {
  const def = getNodeDefinition(nodeType);
  if (!def) return false;
  return Object.values(def.outputs).some(o => {
    if (o.type === filterOutputType) return true;
    // float is universally compatible as a source
    if (o.type === 'float') return true;
    return false;
  });
}

// Expr Block / Custom Fn declare their real sockets dynamically (from
// params.inputs, rebuilt by updateNodeSockets) — the static NodeDefinition
// always shows `inputs: {}`. A fresh instance already ships with default
// inputs of assorted types (and the user can add any type afterward), so
// treat them as always able to consume whatever's being wired in, rather
// than filtering them out for having no *static* input to match against.
const DYNAMIC_INPUT_NODE_TYPES = new Set(['exprNode', 'customFn']);

function inputMatchesFilter(nodeType: string, filterInputType: string): boolean {
  if (DYNAMIC_INPUT_NODE_TYPES.has(nodeType)) return true;
  const def = getNodeDefinition(nodeType);
  if (!def) return false;
  return Object.values(def.inputs).some(i => {
    if (i.type === filterInputType) return true;
    // float output can feed into any type
    if (filterInputType === 'float') return true;
    return false;
  });
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Where to place the node — centre of the current viewport if not provided */
  spawnPosition?: { x: number; y: number };
  /** If set, only show nodes that have at least one output compatible with this type */
  filterOutputType?: string;
  /** If set, only show nodes that have at least one input compatible with this type */
  filterInputType?: string;
  /** Called after addNode with the new node's ID */
  onNodePlaced?: (nodeId: string) => void;
}

export function NodeSearchPalette({ open, onClose, spawnPosition, filterOutputType, filterInputType, onNodePlaced }: Props) {
  const addNode = useNodeGraphStore(s => s.addNode);
  const groupPresets = useNodeGraphStore(s => s.groupPresets);
  const instantiateGroupPreset = useNodeGraphStore(s => s.instantiateGroupPreset);
  const deleteGroupPreset = useNodeGraphStore(s => s.deleteGroupPreset);

  const [query, setQuery]       = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef  = useRef<HTMLInputElement>(null);
  const listRef   = useRef<HTMLUListElement>(null);

  // Filtered + ranked results
  const results = useMemo<SearchEntry[]>(() => {
    const base = (filterOutputType || filterInputType)
      ? ALL_ENTRIES.filter(e => {
          if (filterOutputType && !outputMatchesFilter(e.type, filterOutputType)) return false;
          if (filterInputType  && !inputMatchesFilter(e.type,  filterInputType))  return false;
          return true;
        })
      : ALL_ENTRIES;
    if (!query) return base.slice(0, 80);
    return base
      .map(e => ({ entry: e, score: scoreEntry(e, query) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score || a.entry.def.label.localeCompare(b.entry.def.label))
      .map(({ entry }) => entry);
  }, [query, filterOutputType, filterInputType]);

  // Group results by category
  const grouped = useMemo(() => {
    const map = new Map<string, SearchEntry[]>();
    for (const e of results) {
      const arr = map.get(e.def.category) ?? [];
      arr.push(e);
      map.set(e.def.category, arr);
    }
    return map;
  }, [results]);

  // Flat list for keyboard navigation (same order as rendered)
  const flatList = useMemo(() => results, [results]);

  // Reset on open
  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIdx(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  // Clamp activeIdx when results change
  useEffect(() => {
    setActiveIdx(i => Math.min(i, Math.max(0, flatList.length - 1)));
  }, [flatList]);

  // Scroll active item into view
  useEffect(() => {
    const item = listRef.current?.querySelector<HTMLLIElement>('[data-active="true"]');
    item?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  const place = useCallback((type: string) => {
    const pos = spawnPosition ?? { x: 300 + Math.random() * 120, y: 200 + Math.random() * 120 };
    const newId = addNode(type, pos);
    if (newId && onNodePlaced) onNodePlaced(newId);
    onClose();
  }, [addNode, spawnPosition, onClose, onNodePlaced]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { onClose(); return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx(i => Math.min(i + 1, flatList.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const entry = flatList[activeIdx];
      if (entry) place(entry.type);
    }
  }, [flatList, activeIdx, onClose, place]);

  if (!open) return null;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 900,
        }}
      />

      {/* Palette panel */}
      <div
        onWheel={e => e.stopPropagation()}
        style={{
          position: 'fixed',
          top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 901,
          width: '420px',
          maxWidth: 'calc(100vw - 32px)',
          background: ctp.base,
          border: `1px solid ${ctp.surface1}`,
          borderRadius: '12px',
          boxShadow: '0 24px 64px rgba(0,0,0,0.7)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          maxHeight: 'min(600px, 80vh)',
        }}
      >
        {/* Search input */}
        <div style={{
          padding: '12px 14px',
          borderBottom: `1px solid ${ctp.surface0}`,
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
        }}>
          <span style={{ color: ctp.surface2, fontSize: '15px' }}>🔍</span>
          <input
            ref={inputRef}
            value={query}
            onChange={e => { setQuery(e.target.value); setActiveIdx(0); }}
            onKeyDown={handleKeyDown}
            placeholder="Search nodes…"
            spellCheck={false}
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: ctp.text,
              fontSize: '14px',
              fontFamily: 'inherit',
            }}
          />
          <span style={{ fontSize: '11px', color: ctp.surface1, whiteSpace: 'nowrap' }}>
            {flatList.length} node{flatList.length !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Results list */}
        <ul
          ref={listRef}
          style={{
            margin: 0,
            padding: '6px 0',
            listStyle: 'none',
            overflowY: 'auto',
            flex: 1,
          }}
        >
          {/* Group Presets (always shown at top when not searching, or when query matches) */}
          {groupPresets.length > 0 && (!query || groupPresets.some(p =>
            p.label.toLowerCase().includes(query.toLowerCase()) ||
            p.description?.toLowerCase().includes(query.toLowerCase())
          )) && (
            <li>
              <div style={{
                padding: '6px 14px 2px',
                fontSize: '10px',
                fontWeight: 700,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: ctp.yellow,
              }}>
                Group Presets
              </div>
              <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                {groupPresets
                  .filter(p => !query ||
                    p.label.toLowerCase().includes(query.toLowerCase()) ||
                    p.description?.toLowerCase().includes(query.toLowerCase())
                  )
                  .map(preset => (
                    <li
                      key={preset.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        padding: '5px 14px',
                        cursor: 'pointer',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = ctp.surface0)}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                      onClick={() => {
                        const pos = spawnPosition ?? { x: 300 + Math.random() * 120, y: 200 + Math.random() * 120 };
                        instantiateGroupPreset(preset.id, pos);
                        onClose();
                      }}
                    >
                      <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: ctp.yellow, flexShrink: 0 }} />
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ fontSize: '13px', color: ctp.text }}>{preset.label}</span>
                        {preset.description && (
                          <span style={{
                            display: 'block',
                            fontSize: '10px',
                            color: ctp.surface2,
                            marginTop: '1px',
                            overflow: 'hidden',
                            whiteSpace: 'nowrap',
                            textOverflow: 'ellipsis',
                          }}>
                            {preset.description}
                          </span>
                        )}
                      </span>
                      <span style={{ fontSize: '10px', color: ctp.surface1, flexShrink: 0 }}>
                        {preset.subgraph.nodes.length}n
                      </span>
                      <button
                        title="Delete preset"
                        onMouseDown={e => e.stopPropagation()}
                        onClick={e => {
                          e.stopPropagation();
                          deleteGroupPreset(preset.id);
                        }}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: ctp.surface2,
                          cursor: 'pointer',
                          fontSize: '12px',
                          padding: '0 2px',
                          lineHeight: 1,
                        }}
                      >
                        ✕
                      </button>
                    </li>
                  ))}
              </ul>
            </li>
          )}

          {flatList.length === 0 && (
            <li style={{ padding: '24px 16px', textAlign: 'center', color: ctp.surface2, fontSize: '13px' }}>
              No nodes match "{query}"
            </li>
          )}
          {query
            // Flat list when searching
            ? flatList.map((entry, idx) => (
                <NodeRow
                  key={entry.type}
                  entry={entry}
                  active={idx === activeIdx}
                  onHover={() => setActiveIdx(idx)}
                  onSelect={() => place(entry.type)}
                />
              ))
            // Grouped list when browsing
            : Array.from(grouped.entries()).map(([category, entries]) => (
                <li key={category}>
                  <div style={{
                    padding: '6px 14px 2px',
                    fontSize: '10px',
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    color: CATEGORY_COLORS[category] ?? ctp.surface2,
                  }}>
                    {category}
                  </div>
                  <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                    {entries.map(entry => {
                      const idx = flatList.indexOf(entry);
                      return (
                        <NodeRow
                          key={entry.type}
                          entry={entry}
                          active={idx === activeIdx}
                          onHover={() => setActiveIdx(idx)}
                          onSelect={() => place(entry.type)}
                        />
                      );
                    })}
                  </ul>
                </li>
              ))
          }
        </ul>

        {/* Footer hint */}
        <div style={{
          padding: '7px 14px',
          borderTop: `1px solid ${ctp.surface0}`,
          display: 'flex',
          gap: '14px',
          fontSize: '10px',
          color: ctp.surface1,
        }}>
          <span><kbd style={kbdStyle}>↑↓</kbd> navigate</span>
          <span><kbd style={kbdStyle}>↵</kbd> place</span>
          <span><kbd style={kbdStyle}>Esc</kbd> close</span>
        </div>
      </div>
    </>
  );
}

// ── Row subcomponent ───────────────────────────────────────────────────────────

interface RowProps {
  entry: SearchEntry;
  active: boolean;
  onHover: () => void;
  onSelect: () => void;
}

function NodeRow({ entry, active, onHover, onSelect }: RowProps) {
  const accent = CATEGORY_COLORS[entry.def.category] ?? ctp.surface2;
  return (
    <li
      data-active={active ? 'true' : undefined}
      onMouseEnter={onHover}
      onClick={onSelect}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '5px 14px',
        cursor: 'pointer',
        background: active ? ctp.surface0 : 'transparent',
        transition: 'background 0.08s',
      }}
    >
      {/* Colour dot */}
      <span style={{
        width: '8px', height: '8px',
        borderRadius: '50%',
        background: accent,
        flexShrink: 0,
        boxShadow: active ? `0 0 6px ${accent}88` : 'none',
      }} />

      {/* Label + description */}
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: '13px', color: ctp.text }}>{entry.def.label}</span>
        {entry.def.description && (
          <span style={{
            fontSize: '11px',
            color: ctp.surface2,
            marginLeft: '8px',
            overflow: 'hidden',
            whiteSpace: 'nowrap',
            textOverflow: 'ellipsis',
          }}>
            {entry.def.description}
          </span>
        )}
      </span>

      {/* Category tag */}
      <span style={{
        fontSize: '10px',
        color: accent,
        opacity: 0.7,
        whiteSpace: 'nowrap',
        flexShrink: 0,
      }}>
        {entry.def.category}
      </span>
    </li>
  );
}

// ── Keyboard hint style ────────────────────────────────────────────────────────

const kbdStyle: React.CSSProperties = {
  display: 'inline-block',
  background: ctp.surface0,
  border: `1px solid ${ctp.surface1}`,
  borderRadius: '4px',
  padding: '1px 5px',
  fontSize: '10px',
  fontFamily: 'inherit',
  color: ctp.text,
  marginRight: '3px',
};
