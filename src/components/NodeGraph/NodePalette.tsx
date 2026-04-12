import { useState, useEffect, useRef } from 'react';
import { useNodeGraphStore, loadCustomFns, getCustomFnDir } from '../../store/useNodeGraphStore';
import { getAllCategories, getNodesByCategory, NODE_REGISTRY, getNodeDefinition } from '../../nodes/definitions';
import { ImportGlslModal } from './ImportGlslModal';
import { pickDirectory } from '../../utils/fileIO';
import type { NodeDefinition } from '../../types/nodeGraph';
import type { CustomFnPreset } from '../../types/customFnPreset';
import type { GroupPreset } from '../../types/groupPreset';

// ── Math node ordering: simple → complex ──────────────────────────────────────
const MATH_ORDER: string[] = [
  // Arithmetic
  'add', 'subtract', 'multiply', 'divide',
  // Trig
  'sin', 'cos',
  // Rounding / stepping
  'abs', 'negate', 'ceil', 'floor', 'round', 'fract',
  // Algebra
  'pow', 'sqrt', 'exp',
  // Interpolation / clamping
  'clamp', 'mix', 'smoothstep', 'mod',
  // Comparison
  'min', 'max',
  // Hyperbolic
  'tanh',
  // Angle
  'atan2',
  // Length / dot
  'length', 'dot',
  // Vec2 ops
  'makeVec2', 'extractX', 'extractY', 'addVec2', 'multiplyVec2', 'normalizeVec2',
  // Vec3 ops
  'makeVec3', 'floatToVec3', 'multiplyVec3', 'addVec3',
];

function sortMathNodes(nodes: NodeDefinition[]): NodeDefinition[] {
  const indexMap = new Map(MATH_ORDER.map((id, i) => [id, i]));
  return [...nodes].sort((a, b) => {
    const ia = indexMap.get(a.type) ?? 999;
    const ib = indexMap.get(b.type) ?? 999;
    return ia - ib;
  });
}

// Category accent colors
const CATEGORY_COLORS: Record<string, string> = {
  Sources:         '#89b4fa',  // blue
  Transforms:      '#a6e3a1',  // green
  Math:            '#b4befe',  // lavender
  Color:           '#fab387',  // orange
  Noise:           '#74c7ec',  // sky blue
  Effects:         '#f38ba8',  // pink
  Loops:           '#89dceb',  // cyan
  '2D Primitives': '#f9e2af',  // yellow
  SDF:             '#f5c2e7',  // light pink
  Combiners:       '#cba6f7',  // purple
  Spaces:          '#f2cdcd',  // rose — UV space warp nodes
  Science:         '#94e2d5',  // teal
  Presets:         '#f9e2af',  // warm gold — these are the complex self-contained nodes
  Output:          '#94e2d5',  // teal
};

// Preferred display order for categories (unlisted categories fall at the end alphabetically)
const CATEGORY_ORDER = [
  'Sources', 'Spaces', 'Transforms', 'Math', 'Color', 'Noise',
  'Effects', 'Loops', '2D Primitives', 'SDF', 'Combiners',
  'Science', 'Presets', 'Output',
];


// ─── Loop Example graphs ───────────────────────────────────────────────────────
// Each example is a pre-wired subgraph (Loop Start + body nodes + Loop End).
// nodes[] → relative positions; edges[] → connections by local index.
// Indices: 0 = UV, 1 = Loop Start, 2..N-2 = body, N-1 = Loop End

interface LoopExample {
  label: string;
  description: string;
  /** nodes in spawn order; index 0 is always a uv node, last is always loopEnd */
  nodes: Array<{ type: string; relPos: { x: number; y: number }; params?: Record<string, unknown> }>;
  edges: Array<{ from: number; fromKey: string; to: number; toKey: string }>;
}

const LOOP_EXAMPLES: LoopExample[] = [
  {
    label: 'Ripple Warp',
    description: 'UV → Loop Start → Ripple Step (×6) → Loop End → (connect to color). Classic sin/cos UV feedback warp.',
    nodes: [
      { type: 'uv',             relPos: { x: 0,   y: 0   } },
      { type: 'loopStart',      relPos: { x: 260, y: 0   } },
      { type: 'loopRippleStep', relPos: { x: 520, y: 0   }, params: { scale: 3.5, speed: 0.8, strength: 0.1 } },
      { type: 'loopEnd',        relPos: { x: 780, y: 0   }, params: { iterations: 6 } },
    ],
    edges: [
      { from: 0, fromKey: 'uv',    to: 1, toKey: 'carry' },
      { from: 1, fromKey: 'carry', to: 2, toKey: 'uv'    },
      { from: 2, fromKey: 'uv',    to: 3, toKey: 'carry' },
    ],
  },
  {
    label: 'Spiral Zoom',
    description: 'UV → Loop Start → Rotate Step (×8) → Loop End. Each iteration rotates + scales UV, producing a fractal spiral.',
    nodes: [
      { type: 'uv',             relPos: { x: 0,   y: 0   } },
      { type: 'loopStart',      relPos: { x: 260, y: 0   } },
      { type: 'loopRotateStep', relPos: { x: 520, y: 0   }, params: { angle: 0.4, scale: 1.05 } },
      { type: 'loopEnd',        relPos: { x: 780, y: 0   }, params: { iterations: 8 } },
    ],
    edges: [
      { from: 0, fromKey: 'uv',    to: 1, toKey: 'carry' },
      { from: 1, fromKey: 'carry', to: 2, toKey: 'uv'    },
      { from: 2, fromKey: 'uv',    to: 3, toKey: 'carry' },
    ],
  },
  {
    label: 'IFS Fractal',
    description: 'UV → Loop Start → Domain Fold (×8) → Loop End. Iterated abs()-fold creates Menger-sponge-like fractal domain.',
    nodes: [
      { type: 'uv',              relPos: { x: 0,   y: 0   } },
      { type: 'loopStart',       relPos: { x: 260, y: 0   } },
      { type: 'loopDomainFold',  relPos: { x: 520, y: 0   }, params: { scale: 1.8, offsetX: 0.5, offsetY: 0.3 } },
      { type: 'loopEnd',         relPos: { x: 780, y: 0   }, params: { iterations: 8 } },
    ],
    edges: [
      { from: 0, fromKey: 'uv',    to: 1, toKey: 'carry' },
      { from: 1, fromKey: 'carry', to: 2, toKey: 'uv'    },
      { from: 2, fromKey: 'uv',    to: 3, toKey: 'carry' },
    ],
  },
  {
    label: 'Ripple + Fold',
    description: 'UV → Loop Start → Ripple → Domain Fold (×6) → Loop End. Combines warp + fold for complex turbulent patterns.',
    nodes: [
      { type: 'uv',              relPos: { x: 0,   y: 0   } },
      { type: 'loopStart',       relPos: { x: 260, y: 0   } },
      { type: 'loopRippleStep',  relPos: { x: 520, y: 0   }, params: { scale: 2.5, speed: 0.6, strength: 0.08 } },
      { type: 'loopDomainFold',  relPos: { x: 780, y: 0   }, params: { scale: 1.6, offsetX: 0.4, offsetY: 0.2 } },
      { type: 'loopEnd',         relPos: { x: 1040, y: 0  }, params: { iterations: 6 } },
    ],
    edges: [
      { from: 0, fromKey: 'uv',    to: 1, toKey: 'carry' },
      { from: 1, fromKey: 'carry', to: 2, toKey: 'uv'    },
      { from: 2, fromKey: 'uv',    to: 3, toKey: 'uv'    },
      { from: 3, fromKey: 'uv',    to: 4, toKey: 'carry' },
    ],
  },
  {
    label: 'Rotate + Ripple',
    description: 'UV → Loop Start → Rotate Step → Ripple Step (×8) → Loop End. Rotation + warp per iteration makes a hypnotic vortex.',
    nodes: [
      { type: 'uv',              relPos: { x: 0,    y: 0   } },
      { type: 'loopStart',       relPos: { x: 260,  y: 0   } },
      { type: 'loopRotateStep',  relPos: { x: 520,  y: 0   }, params: { angle: 0.25, scale: 1.0 } },
      { type: 'loopRippleStep',  relPos: { x: 780,  y: 0   }, params: { scale: 4.0, speed: 1.2, strength: 0.07 } },
      { type: 'loopEnd',         relPos: { x: 1040, y: 0   }, params: { iterations: 8 } },
    ],
    edges: [
      { from: 0, fromKey: 'uv',    to: 1, toKey: 'carry' },
      { from: 1, fromKey: 'carry', to: 2, toKey: 'uv'    },
      { from: 2, fromKey: 'uv',    to: 3, toKey: 'uv'    },
      { from: 3, fromKey: 'uv',    to: 4, toKey: 'carry' },
    ],
  },
];

interface NodePaletteProps {
  /** 'full' = normal left sidebar; 'drawer' = fills container (used in mobile bottom sheet) */
  mode?: 'full' | 'drawer';
  /** Called when a node is added (e.g. to close the drawer on mobile) */
  onNodeAdded?: () => void;
}

export function NodePalette({ mode = 'full', onNodeAdded }: NodePaletteProps) {
  const { addNode, spawnGraph, deleteCustomFn, exportCustomFns, importCustomFnsFromFile, setCustomFnPresetsDir, loadCustomFnsFromDisk,
    swapTargetNodeId, setSwapTargetNodeId, swapNode, nodes: graphNodes } = useNodeGraphStore();
  const groupPresets         = useNodeGraphStore(s => s.groupPresets);
  const instantiateGroupPreset = useNodeGraphStore(s => s.instantiateGroupPreset);
  const deleteGroupPreset    = useNodeGraphStore(s => s.deleteGroupPreset);
  const [hoverGroupPresetId, setHoverGroupPresetId] = useState<string | null>(null);
  const [hoveredExampleIdx, setHoveredExampleIdx] = useState<number | null>(null);
  const exampleTooltipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Sort categories by preferred order; unknown categories appended alphabetically
  const rawCategories = getAllCategories();
  const categories = [
    ...CATEGORY_ORDER.filter(c => rawCategories.includes(c)),
    ...rawCategories.filter(c => !CATEGORY_ORDER.includes(c)).sort(),
  ];

  // Search query
  const [query, setQuery] = useState('');

  // Which categories are expanded (accordion). Default: Sources + Math open.
  const [open, setOpen] = useState<Set<string>>(new Set(['Sources', 'Math']));

  // Import GLSL modal
  const [showImport, setShowImport] = useState(false);

  // User-saved custom function presets
  const [userPresets, setUserPresets] = useState<CustomFnPreset[]>(() => loadCustomFns());
  // ID of preset being hovered (for showing delete button)
  const [hoverPresetId, setHoverPresetId] = useState<string | null>(null);
  // Current presets folder path (for display)
  const [presetsDir, setPresetsDir] = useState<string>(() => getCustomFnDir());

  // Merge localStorage presets with disk presets (dedup by id)
  const refreshPresets = async () => {
    const local = loadCustomFns();
    const disk = await loadCustomFnsFromDisk();
    // Merge: disk takes precedence, then fill in from local
    const seen = new Set<string>();
    const merged: CustomFnPreset[] = [];
    for (const p of [...disk, ...local]) {
      if (!seen.has(p.id)) { seen.add(p.id); merged.push(p); }
    }
    merged.sort((a, b) => a.savedAt - b.savedAt);
    setUserPresets(merged);
  };

  // Load from disk on mount + refresh on window focus
  useEffect(() => {
    refreshPresets();
    window.addEventListener('focus', refreshPresets);
    return () => window.removeEventListener('focus', refreshPresets);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePickFolder = async () => {
    const dir = await pickDirectory();
    if (!dir) return;
    setCustomFnPresetsDir(dir);
    setPresetsDir(dir);
    await refreshPresets();
  };

  const toggleCategory = (cat: string) => {
    setOpen(prev => {
      const next = new Set(prev);
      if (next.has(cat)) { next.delete(cat); } else { next.add(cat); }
      return next;
    });
  };

  const handleAdd = (type: string) => {
    if (swapTargetNodeId) {
      swapNode(swapTargetNodeId, type);
      onNodeAdded?.();
      return;
    }
    const x = 200 + Math.random() * 120;
    const y = 120 + Math.random() * 200;
    addNode(type, { x, y });
    onNodeAdded?.();
  };

  // Label of the node currently targeted for swap
  const swapTargetLabel = swapTargetNodeId
    ? (() => {
        const n = graphNodes.find(nd => nd.id === swapTargetNodeId);
        if (!n) return null;
        return getNodeDefinition(n.type)?.label ?? n.type;
      })()
    : null;

  // Search mode: show all matching nodes across categories, ungrouped
  const trimmed = query.trim().toLowerCase();
  const isSearching = trimmed.length > 0;

  const searchResults = isSearching
    ? Object.values(NODE_REGISTRY).filter(def =>
        def.label.toLowerCase().includes(trimmed) ||
        def.type.toLowerCase().includes(trimmed) ||
        (def.description ?? '').toLowerCase().includes(trimmed)
      )
    : [];

  const nodeBtn = (type: string, label: string, description?: string) => (
    <button
      key={type}
      onClick={() => handleAdd(type)}
      title={description ?? `Drag to canvas or click to ${swapTargetNodeId ? 'replace' : 'add'}`}
      draggable={!swapTargetNodeId}
      onDragStart={e => {
        e.dataTransfer.setData('application/shader-studio-node', type);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      style={{
        display: 'block',
        width: '100%',
        padding: isDrawer ? '9px 12px' : '5px 10px',
        marginBottom: '3px',
        background: '#313244',
        border: '1px solid #45475a',
        color: '#cdd6f4',
        cursor: swapTargetNodeId ? 'pointer' : 'grab',
        textAlign: 'left',
        borderRadius: '6px',
        fontSize: isDrawer ? '13px' : '12px',
        transition: 'background 0.1s',
        touchAction: 'manipulation',
      }}
      onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.background = '#45475a')}
      onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.background = '#313244')}
    >
      {label}
    </button>
  );

  const isDrawer = mode === 'drawer';

  return (
    <div
      style={{
        // In full mode: fixed sidebar. In drawer mode: fill the parent container.
        width:    isDrawer ? '100%'    : '210px',
        minWidth: isDrawer ? undefined : '210px',
        height:   isDrawer ? undefined : '100%',
        background: '#1e1e2e',
        color: '#cdd6f4',
        padding: isDrawer ? '4px 12px 20px' : '10px 8px',
        overflowY: 'auto',
        borderRight: isDrawer ? 'none' : '1px solid #313244',
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        flex: isDrawer ? 1 : undefined,
        minHeight: 0,
        boxSizing: 'border-box',
      }}
    >
      {/* Title */}
      <div style={{ fontWeight: 700, fontSize: '13px', paddingLeft: '4px', color: '#89b4fa', marginBottom: '6px' }}>
        {swapTargetNodeId ? 'Replace Node' : 'Add Node'}
      </div>

      {/* Swap mode banner */}
      {swapTargetNodeId && (
        <div style={{
          background: '#f9e2af22',
          border: '1px solid #f9e2af55',
          borderRadius: '6px',
          padding: '6px 10px',
          fontSize: '11px',
          color: '#f9e2af',
          marginBottom: '4px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '6px',
        }}>
          <span>↔ Replace <strong>{swapTargetLabel}</strong></span>
          <button
            onClick={() => setSwapTargetNodeId(null)}
            style={{
              background: 'none',
              border: 'none',
              color: '#f9e2af',
              cursor: 'pointer',
              fontSize: '11px',
              padding: '0 2px',
              opacity: 0.7,
            }}
            title="Cancel swap"
          >✕</button>
        </div>
      )}

      {/* Search */}
      <input
        type="text"
        placeholder="Search nodes…"
        value={query}
        onChange={e => setQuery(e.target.value)}
        style={{
          background: '#181825',
          border: '1px solid #45475a',
          color: '#cdd6f4',
          borderRadius: '5px',
          padding: '5px 8px',
          fontSize: '11px',
          outline: 'none',
          marginBottom: '6px',
          width: '100%',
          boxSizing: 'border-box',
        }}
      />

      {/* Search results */}
      {isSearching ? (
        <div>
          {searchResults.length === 0 ? (
            <div style={{ color: '#585b70', fontSize: '11px', paddingLeft: '4px' }}>No matches</div>
          ) : (
            searchResults.map(def => nodeBtn(def.type, def.label, def.description))
          )}
        </div>
      ) : (
        /* Accordion categories */
        categories.map(category => {
          const isOpen  = open.has(category);
          const color   = CATEGORY_COLORS[category] ?? '#888';
          const rawNodes = getNodesByCategory(category);
          const nodes   = category === 'Math' ? sortMathNodes(rawNodes) : rawNodes;
          return (
            <div key={category} style={{ marginBottom: '2px' }}>
              {/* Category header toggle */}
              <button
                onClick={() => toggleCategory(category)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  width: '100%',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '4px 4px',
                  borderRadius: '4px',
                  color,
                  fontSize: '10px',
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  textAlign: 'left',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.background = '#313244')}
                onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.background = 'none')}
              >
                <span style={{ fontSize: '9px', opacity: 0.7 }}>{isOpen ? '▼' : '▶'}</span>
                {category}
                <span style={{ marginLeft: 'auto', opacity: 0.4, fontSize: '9px' }}>{nodes.length}</span>
              </button>

              {/* Node buttons — only shown when open */}
              {isOpen && (
                <div style={{ marginTop: '2px', paddingLeft: '4px' }}>
                  {nodes.map(def => nodeBtn(def.type, def.label, def.description))}

                  {/* ── Loop Examples sub-section (only in Loops category) ── */}
                  {category === 'Loops' && (
                    <div style={{ marginTop: '8px', borderTop: '1px solid #89dceb22', paddingTop: '6px' }}>
                      <div style={{
                        fontSize: '9px', fontWeight: 700, letterSpacing: '0.08em',
                        textTransform: 'uppercase', color: '#89dceb88',
                        paddingLeft: '2px', marginBottom: '5px',
                        display: 'flex', alignItems: 'center', gap: '5px',
                      }}>
                        <span>⚡</span> Examples
                        <span style={{ color: '#585b70', fontSize: '8px', fontWeight: 400, letterSpacing: 0, textTransform: 'none' }}>
                          — click to spawn pre-wired graph
                        </span>
                      </div>
                      {LOOP_EXAMPLES.map((ex, i) => (
                        <div
                          key={ex.label}
                          style={{ position: 'relative', marginBottom: '3px' }}
                          onMouseEnter={() => {
                            if (exampleTooltipTimer.current) clearTimeout(exampleTooltipTimer.current);
                            exampleTooltipTimer.current = setTimeout(() => setHoveredExampleIdx(i), 400);
                          }}
                          onMouseLeave={() => {
                            if (exampleTooltipTimer.current) clearTimeout(exampleTooltipTimer.current);
                            setHoveredExampleIdx(null);
                          }}
                        >
                          <button
                            onClick={() => {
                              const ox = 200 + Math.random() * 80;
                              const oy = 120 + Math.random() * 160;
                              spawnGraph({ x: ox, y: oy }, ex.nodes, ex.edges);
                              onNodeAdded?.();
                            }}
                            style={{
                              display: 'block',
                              width: '100%',
                              padding: '5px 8px 5px 10px',
                              background: '#0d2020',
                              border: '1px solid #89dceb33',
                              color: '#89dceb',
                              cursor: 'pointer',
                              textAlign: 'left',
                              borderRadius: '5px',
                              fontSize: '11px',
                              transition: 'background 0.1s',
                            }}
                            onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.background = '#0d3030')}
                            onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.background = '#0d2020')}
                          >
                            <span style={{ fontSize: '10px', marginRight: '5px', opacity: 0.6 }}>⟳</span>
                            {ex.label}
                            <span style={{ fontSize: '9px', color: '#89dceb55', marginLeft: '5px' }}>
                              ×{(ex.nodes.find(n => n.type === 'loopEnd')?.params?.iterations as number) ?? 4}
                            </span>
                          </button>
                          {/* Tooltip on hover delay */}
                          {hoveredExampleIdx === i && (
                            <div style={{
                              position: 'absolute',
                              left: '100%',
                              top: 0,
                              marginLeft: '6px',
                              zIndex: 200,
                              background: '#1e1e2e',
                              border: '1px solid #89dceb44',
                              borderRadius: '6px',
                              padding: '8px 10px',
                              width: '220px',
                              fontSize: '10px',
                              color: '#cdd6f4',
                              pointerEvents: 'none',
                              boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
                              lineHeight: 1.5,
                            }}>
                              <div style={{ fontWeight: 700, color: '#89dceb', marginBottom: '4px', fontSize: '11px' }}>
                                {ex.label}
                              </div>
                              <div style={{ color: '#a6adc8', marginBottom: '6px' }}>{ex.description}</div>
                              <div style={{ color: '#585b70', fontSize: '9px' }}>
                                Spawns {ex.nodes.length} nodes pre-wired. Connect the Loop End → result to your color/output nodes.
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })
      )}

      {/* ── Group Presets ── */}
      {!isSearching && (
        <div style={{ marginTop: '8px', borderTop: '1px solid #313244', paddingTop: '8px' }}>
          <div style={{
            fontSize: '10px', fontWeight: 700, letterSpacing: '0.08em',
            textTransform: 'uppercase', color: '#f9e2af',
            paddingLeft: '4px', marginBottom: '4px',
          }}>
            Group Presets
          </div>
          {groupPresets.length === 0 ? (
            <div style={{ fontSize: '10px', color: '#45475a', paddingLeft: '4px', fontStyle: 'italic', lineHeight: 1.6 }}>
              Select a group node and click<br />⬇ Save to create a preset.
            </div>
          ) : (
            groupPresets.map((preset: GroupPreset) => (
              <div
                key={preset.id}
                style={{ position: 'relative', marginBottom: '2px' }}
                onMouseEnter={() => setHoverGroupPresetId(preset.id)}
                onMouseLeave={() => setHoverGroupPresetId(null)}
              >
                <button
                  onClick={() => {
                    const x = 200 + Math.random() * 120;
                    const y = 120 + Math.random() * 200;
                    instantiateGroupPreset(preset.id, { x, y });
                    onNodeAdded?.();
                  }}
                  title={preset.description ?? `Add "${preset.label}" group`}
                  style={{
                    display: 'block', width: '100%',
                    padding: '5px 28px 5px 10px', marginBottom: '0',
                    background: '#1e1a0e',
                    border: '1px solid #f9e2af33',
                    color: '#f9e2af', cursor: 'pointer',
                    textAlign: 'left', borderRadius: '5px', fontSize: '12px',
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.background = '#2a2412')}
                  onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.background = '#1e1a0e')}
                >
                  <div>⬡ {preset.label}</div>
                  {preset.description && (
                    <div style={{ fontSize: '10px', color: '#a89060', marginTop: '1px', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                      {preset.description}
                    </div>
                  )}
                </button>
                {hoverGroupPresetId === preset.id && (
                  <button
                    onClick={e => { e.stopPropagation(); deleteGroupPreset(preset.id); }}
                    title="Delete preset"
                    style={{
                      position: 'absolute', right: '4px', top: '50%', transform: 'translateY(-50%)',
                      background: 'none', border: 'none',
                      color: '#585b70', cursor: 'pointer',
                      fontSize: '11px', padding: '2px 4px', lineHeight: 1,
                    }}
                    onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.color = '#f38ba8')}
                    onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.color = '#585b70')}
                  >✕</button>
                )}
              </div>
            ))
          )}
        </div>
      )}


      {/* ── My Functions ── */}
      {!isSearching && (
        <div style={{ marginTop: '8px', borderTop: '1px solid #313244', paddingTop: '8px' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            marginBottom: '4px',
          }}>
            <div style={{
              fontSize: '10px', fontWeight: 700, letterSpacing: '0.08em',
              textTransform: 'uppercase', color: '#89dceb',
              paddingLeft: '4px', flex: 1,
            }}>
              My Functions
            </div>
            {/* Folder picker */}
            <button
              onClick={handlePickFolder}
              title={presetsDir ? `Saving to: ${presetsDir}` : 'Pick a folder to save presets on disk'}
              style={{
                background: presetsDir ? '#89dceb18' : 'none',
                border: `1px solid ${presetsDir ? '#89dceb55' : '#313244'}`,
                color: presetsDir ? '#89dceb' : '#6c7086',
                borderRadius: '3px', fontSize: '10px', padding: '1px 5px', cursor: 'pointer',
              }}
              onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.color = '#89dceb')}
              onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.color = presetsDir ? '#89dceb' : '#6c7086')}
            >
              📁
            </button>
            {/* Export / Import buttons — only show when presets exist or always for import */}
            {userPresets.length > 0 && (
              <button
                onClick={() => exportCustomFns()}
                title="Export saved functions to a JSON file"
                style={{
                  background: 'none', border: '1px solid #313244', color: '#6c7086',
                  borderRadius: '3px', fontSize: '10px', padding: '1px 5px', cursor: 'pointer',
                }}
                onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.color = '#89dceb')}
                onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.color = '#6c7086')}
              >
                ↑
              </button>
            )}
            <button
              onClick={async () => { await importCustomFnsFromFile(); await refreshPresets(); }}
              title="Import saved functions from a JSON file"
              style={{
                background: 'none', border: '1px solid #313244', color: '#6c7086',
                borderRadius: '3px', fontSize: '10px', padding: '1px 5px', cursor: 'pointer',
              }}
              onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.color = '#89dceb')}
              onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.color = '#6c7086')}
            >
              ↓
            </button>
          </div>

          {/* Folder path display */}
          {presetsDir && (
            <div style={{
              fontSize: '9px', color: '#45475a', paddingLeft: '4px', marginBottom: '4px',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              fontFamily: 'monospace',
            }}
              title={presetsDir}
            >
              {presetsDir.split('/').pop() ?? presetsDir}
            </div>
          )}

          {userPresets.length === 0 ? (
            <div style={{ color: '#45475a', fontSize: '10px', paddingLeft: '4px', paddingBottom: '4px', fontStyle: 'italic' }}>
              Open a Custom Fn node and click "↑ Save Preset"
            </div>
          ) : (
            userPresets.map(preset => (
              <div
                key={preset.id}
                style={{ position: 'relative', marginBottom: '2px' }}
                onMouseEnter={() => setHoverPresetId(preset.id)}
                onMouseLeave={() => setHoverPresetId(null)}
              >
                <button
                  onClick={() => {
                    const x = 200 + Math.random() * 120;
                    const y = 120 + Math.random() * 200;
                    addNode('customFn', { x, y }, {
                      label: preset.label,
                      inputs: preset.inputs,
                      outputType: preset.outputType,
                      body: preset.body,
                      glslFunctions: preset.glslFunctions,
                    });
                    onNodeAdded?.();
                  }}
                  title={`Add "${preset.label}" as a Custom Fn node`}
                  style={{
                    display: 'block', width: '100%',
                    padding: '5px 28px 5px 10px',
                    background: '#1a2535',
                    border: '1px solid #89dceb33',
                    color: '#89dceb', cursor: 'pointer',
                    textAlign: 'left', borderRadius: '5px', fontSize: '12px',
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.background = '#1e3040')}
                  onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.background = '#1a2535')}
                >
                  ƒ {preset.label}
                </button>
                {/* Delete button — shown on hover */}
                {hoverPresetId === preset.id && (
                  <button
                    onClick={e => {
                      e.stopPropagation();
                      deleteCustomFn(preset.id);
                      refreshPresets();
                    }}
                    title="Remove this preset"
                    style={{
                      position: 'absolute', right: '4px', top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'none', border: 'none',
                      color: '#f38ba8', cursor: 'pointer',
                      fontSize: '13px', padding: '0 4px', lineHeight: 1,
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* ── Import GLSL button ── */}
      <div style={{ marginTop: '8px', borderTop: '1px solid #313244', paddingTop: '8px' }}>
        <button
          onClick={() => setShowImport(true)}
          style={{
            display: 'block', width: '100%',
            padding: '6px 10px',
            background: '#1e2a1e',
            border: '1px solid #a6e3a133',
            color: '#a6e3a1', cursor: 'pointer',
            textAlign: 'left', borderRadius: '5px', fontSize: '12px',
            transition: 'background 0.1s',
          }}
          onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.background = '#2a3a2a')}
          onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.background = '#1e2a1e')}
        >
          ↓ Import GLSL
        </button>
      </div>

      {/* Import GLSL modal */}
      {showImport && <ImportGlslModal onClose={() => setShowImport(false)} />}
    </div>
  );
}
