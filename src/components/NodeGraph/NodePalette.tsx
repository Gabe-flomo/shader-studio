import { useState, useEffect } from 'react';
import { useNodeGraphStore, loadCustomFns, getCustomFnDir, EXAMPLE_GRAPHS } from '../../store/useNodeGraphStore';
import { getAllCategories, getNodesByCategory, NODE_REGISTRY, getNodeDefinition } from '../../nodes/definitions';
import { ImportGlslModal } from './ImportGlslModal';
import { pickDirectory } from '../../utils/fileIO';
import type { NodeDefinition } from '../../types/nodeGraph';
import type { CustomFnPreset } from '../../types/customFnPreset';
import type { GroupPreset } from '../../types/groupPreset';

// ── Nodes hidden from the palette (still functional in existing graphs) ───────
const HIDDEN_NODES = new Set([
  'forLoop',           // legacy — use iterated groups instead
  'loopRippleStep',
  'loopRotateStep',
  'loopDomainFold',
  'loopFloatAccumulate',
  'loopColorRingStep',
  'loopRingStep',
]);

// ── Math node ordering & sub-groups ──────────────────────────────────────────
const MATH_GROUPS: Array<{ label: string; types: string[] }> = [
  { label: 'Arithmetic', types: ['add', 'subtract', 'multiply', 'divide'] },
  { label: 'Trig',       types: ['sin', 'cos', 'atan2'] },
  { label: 'Rounding',   types: ['abs', 'negate', 'ceil', 'floor', 'round', 'fract'] },
  { label: 'Algebra',    types: ['pow', 'sqrt', 'exp', 'tanh'] },
  { label: 'Interp',     types: ['clamp', 'mix', 'smoothstep', 'mod'] },
  { label: 'Compare',    types: ['min', 'max'] },
  { label: 'Geometry',   types: ['length', 'dot'] },
  { label: 'Vec2',       types: ['makeVec2', 'extractX', 'extractY', 'addVec2', 'multiplyVec2', 'normalizeVec2'] },
  { label: 'Vec3',       types: ['makeVec3', 'floatToVec3', 'multiplyVec3', 'addVec3'] },
];

const MATH_ORDER: string[] = MATH_GROUPS.flatMap(g => g.types);

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

// ── Example folders ───────────────────────────────────────────────────────────
type ExKey = keyof typeof EXAMPLE_GRAPHS;

const EXAMPLE_FOLDERS: Array<{ label: string; color: string; keys: ExKey[] }> = [
  { label: 'Rings',           color: '#f38ba8', keys: ['fractalRings','forLoopRings','exprRings','fractalRingsGroup','fractalRingsWired','fractalRingsNewWired','exprOrbit'] as ExKey[] },
  { label: 'Iterated Groups', color: '#a6e3a1', keys: ['groupCarryRings','groupCarryZoom','groupAdditiveRings','groupProductRings','groupCarryRotate','groupCarryFBM','groupCarryDomainWarp','groupCarryPowerFold'] as ExKey[] },
  { label: 'Loops',           color: '#89dceb', keys: ['loopRippleWarp','loopRotateSpiral','loopFloatDemo','loopChainedBody','loopZoomTunnel','loopAnimatedSpin','loopTwoStage','loopSpatialFloat','loopDenseRings','loopIterScale'] as ExKey[] },
  { label: 'Fractals',        color: '#cba6f7', keys: ['mandelbrotSet','juliaExplorer','mandelbrotExplorer','domainWarpFractal'] as ExKey[] },
  { label: 'Physics',         color: '#94e2d5', keys: ['orbitals','chladniDemo','chladni3dDemo','chladni3dParticlesDemo','electronOrbitalDemo','orbitalVolume3dDemo','gravitationalLens'] as ExKey[] },
  { label: 'Warping Space',   color: '#f2cdcd', keys: ['swirlVoronoi','mobiusWarp','infiniteMirror','uvWarpDemo','curlWarpDemo','swirlWarpDemo','displaceDemo','smoothWarpDemo','polarRings','hyperbolicCircles'] as ExKey[] },
  { label: 'Color & Lighting',color: '#fab387', keys: ['animatedPalette','fbmLandscape','kaleidoscopeNoise','hsvDemo','posterizeDemo','invertDemo','desaturateDemo','glowCircle','glowShape','toneMapDemo','angularGradient','shapeShowcase'] as ExKey[] },
  { label: 'Animation',       color: '#b4befe', keys: ['animationShowcase','sineLFODemo','breathingGlow','warpDance','squarePulse','prevFrameTrails'] as ExKey[] },
  { label: 'SDF & 3D',        color: '#f5c2e7', keys: ['raymarchSpheres','noiseFloatDemo','remapDemo'] as ExKey[] },
];


interface NodePaletteProps {
  /** 'full' = normal left sidebar; 'drawer' = fills container (used in mobile bottom sheet) */
  mode?: 'full' | 'drawer';
  /** Called when a node is added (e.g. to close the drawer on mobile) */
  onNodeAdded?: () => void;
}

export function NodePalette({ mode = 'full', onNodeAdded }: NodePaletteProps) {
  const { addNode, deleteCustomFn, exportCustomFns, importCustomFnsFromFile, setCustomFnPresetsDir, loadCustomFnsFromDisk,
    swapTargetNodeId, setSwapTargetNodeId, swapNode, nodes: graphNodes } = useNodeGraphStore();
  const saveGraph           = useNodeGraphStore(s => s.saveGraph);
  const getSavedGraphNames  = useNodeGraphStore(s => s.getSavedGraphNames);
  const loadSavedGraph      = useNodeGraphStore(s => s.loadSavedGraph);
  const deleteSavedGraph    = useNodeGraphStore(s => s.deleteSavedGraph);
  const [savedNames, setSavedNames] = useState<string[]>(() => getSavedGraphNames());
  const [graphSaveInput, setGraphSaveInput] = useState('');
  const [showGraphSaveInput, setShowGraphSaveInput] = useState(false);
  const [hoverSavedName, setHoverSavedName] = useState<string | null>(null);

  const refreshSavedNames = () => setSavedNames(getSavedGraphNames());
  const groupPresets         = useNodeGraphStore(s => s.groupPresets);
  const instantiateGroupPreset = useNodeGraphStore(s => s.instantiateGroupPreset);
  const deleteGroupPreset    = useNodeGraphStore(s => s.deleteGroupPreset);
  const [hoverGroupPresetId, setHoverGroupPresetId] = useState<string | null>(null);
  // Sort categories by preferred order; unknown categories appended alphabetically
  const rawCategories = getAllCategories();
  const categories = [
    ...CATEGORY_ORDER.filter(c => rawCategories.includes(c)),
    ...rawCategories.filter(c => !CATEGORY_ORDER.includes(c)).sort(),
  ];

  const loadExampleGraph = useNodeGraphStore(s => s.loadExampleGraph);
  const [examplesExpanded, setExamplesExpanded] = useState(true);
  const [openFolders, setOpenFolders] = useState<Set<string>>(new Set());
  const toggleFolder = (label: string) =>
    setOpenFolders(prev => { const n = new Set(prev); n.has(label) ? n.delete(label) : n.add(label); return n; });

  // Search query
  const [query, setQuery] = useState('');

  // Favorites — persisted to localStorage
  const [favorites, setFavorites] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('nodepalette_favorites') ?? '[]'); } catch { return []; }
  });
  const [favoritesExpanded, setFavoritesExpanded] = useState(true);
  const toggleFavorite = (type: string) => {
    setFavorites(prev => {
      const next = prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type];
      localStorage.setItem('nodepalette_favorites', JSON.stringify(next));
      return next;
    });
  };

  // Which categories are expanded (accordion). Default: all collapsed.
  const [open, setOpen] = useState<Set<string>>(new Set());

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
        !HIDDEN_NODES.has(def.type) && (
          def.label.toLowerCase().includes(trimmed) ||
          def.type.toLowerCase().includes(trimmed) ||
          (def.description ?? '').toLowerCase().includes(trimmed)
        )
      )
    : [];

  const nodeBtn = (type: string, label: string, description?: string) => {
    const isFav = favorites.includes(type);
    return (
      <div key={type} style={{ position: 'relative', marginBottom: '3px' }}>
        <button
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
            padding: isDrawer ? '9px 28px 9px 12px' : '5px 24px 5px 10px',
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
        <button
          onClick={e => { e.stopPropagation(); toggleFavorite(type); }}
          title={isFav ? 'Remove from favorites' : 'Add to favorites'}
          style={{
            position: 'absolute',
            right: '5px',
            top: '50%',
            transform: 'translateY(-50%)',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '2px 3px',
            lineHeight: 1,
            fontSize: '11px',
            color: isFav ? '#f9e2af' : '#45475a',
            transition: 'color 0.1s',
          }}
          onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.color = isFav ? '#fab387' : '#a6adc8')}
          onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.color = isFav ? '#f9e2af' : '#45475a')}
        >★</button>
      </div>
    );
  };

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

      {/* ── Favorites ── */}
      {favorites.length > 0 && (
        <div style={{ marginBottom: '6px' }}>
          <button
            onClick={() => setFavoritesExpanded(v => !v)}
            style={{
              display: 'flex', alignItems: 'center', gap: '5px',
              width: '100%', background: 'none', border: 'none',
              cursor: 'pointer', padding: '2px 4px', marginBottom: '3px',
              textAlign: 'left',
            }}
          >
            <span style={{ fontSize: '7px', opacity: 0.5, color: '#f9e2af', width: '7px', flexShrink: 0 }}>
              {favoritesExpanded ? '▼' : '▶'}
            </span>
            <span style={{ fontSize: '11px' }}>★</span>
            <span style={{
              fontSize: '10px', fontWeight: 700, letterSpacing: '0.08em',
              textTransform: 'uppercase', color: '#f9e2af',
            }}>
              Favorites
            </span>
            <span style={{ marginLeft: 'auto', opacity: 0.4, fontSize: '9px', color: '#f9e2af' }}>
              {favorites.length}
            </span>
          </button>
          {favoritesExpanded && (
            <div style={{ paddingLeft: '4px' }}>
              {favorites
                .map(t => NODE_REGISTRY[t])
                .filter(Boolean)
                .map(def => nodeBtn(def.type, def.label, def.description))}
            </div>
          )}
        </div>
      )}

      {/* ── Examples browser ── */}
      {!isSearching && (
        <div style={{ marginBottom: '6px' }}>
          <button
            onClick={() => setExamplesExpanded(v => !v)}
            style={{
              display: 'flex', alignItems: 'center', gap: '5px',
              width: '100%', background: 'none', border: 'none',
              cursor: 'pointer', padding: '2px 4px', marginBottom: '3px',
              textAlign: 'left',
            }}
          >
            <span style={{ fontSize: '7px', opacity: 0.5, color: '#585b70', width: '7px', flexShrink: 0 }}>
              {examplesExpanded ? '▼' : '▶'}
            </span>
            <span style={{
              fontSize: '10px', fontWeight: 700, letterSpacing: '0.08em',
              textTransform: 'uppercase', color: '#585b70',
            }}>
              Examples
            </span>
          </button>
          {examplesExpanded && EXAMPLE_FOLDERS.map(folder => {
            const isOpen = openFolders.has(folder.label);
            return (
              <div key={folder.label} style={{ marginBottom: '1px' }}>
                {/* Folder row */}
                <button
                  onClick={() => toggleFolder(folder.label)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '5px',
                    width: '100%', background: 'none', border: 'none',
                    cursor: 'pointer', padding: '3px 4px', borderRadius: '4px',
                    color: folder.color, fontSize: '11px', fontWeight: 600,
                    textAlign: 'left', transition: 'background 0.1s',
                  }}
                  onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.background = '#313244')}
                  onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.background = 'none')}
                >
                  <span style={{ fontSize: '8px', opacity: 0.6, width: '8px', flexShrink: 0 }}>
                    {isOpen ? '▼' : '▶'}
                  </span>
                  <span style={{ fontSize: '12px', marginRight: '2px' }}>📁</span>
                  {folder.label}
                  <span style={{ marginLeft: 'auto', fontSize: '9px', opacity: 0.4 }}>
                    {folder.keys.filter(k => EXAMPLE_GRAPHS[k]).length}
                  </span>
                </button>

                {/* Example items inside folder */}
                {isOpen && (
                  <div style={{ paddingLeft: '18px', paddingBottom: '2px' }}>
                    {folder.keys
                      .filter(k => EXAMPLE_GRAPHS[k])
                      .map(k => {
                        const ex = EXAMPLE_GRAPHS[k];
                        return (
                          <button
                            key={k}
                            onClick={() => { loadExampleGraph(k); onNodeAdded?.(); }}
                            style={{
                              display: 'block', width: '100%',
                              padding: '3px 8px', marginBottom: '1px',
                              background: '#181825',
                              border: `1px solid ${folder.color}22`,
                              color: '#a6adc8', cursor: 'pointer',
                              textAlign: 'left', borderRadius: '4px',
                              fontSize: '11px', transition: 'background 0.1s',
                              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                            }}
                            onMouseEnter={e => {
                              (e.currentTarget as HTMLButtonElement).style.background = '#313244';
                              (e.currentTarget as HTMLButtonElement).style.color = folder.color;
                            }}
                            onMouseLeave={e => {
                              (e.currentTarget as HTMLButtonElement).style.background = '#181825';
                              (e.currentTarget as HTMLButtonElement).style.color = '#a6adc8';
                            }}
                            title={ex.label}
                          >
                            {ex.label}
                          </button>
                        );
                      })
                    }
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

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
          const isOpen   = open.has(category);
          const color    = CATEGORY_COLORS[category] ?? '#888';
          const rawNodes = getNodesByCategory(category).filter(d => !HIDDEN_NODES.has(d.type));
          const nodes    = category === 'Math' ? sortMathNodes(rawNodes) : rawNodes;
          if (nodes.length === 0) return null;
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
                  {category === 'Math' ? (
                    MATH_GROUPS.map(group => {
                      const groupNodes = nodes.filter(d => group.types.includes(d.type));
                      if (groupNodes.length === 0) return null;
                      return (
                        <div key={group.label}>
                          <div style={{
                            fontSize: '8px', color: '#45475a', letterSpacing: '0.08em',
                            textTransform: 'uppercase', padding: '4px 2px 2px',
                            fontWeight: 600,
                          }}>
                            {group.label}
                          </div>
                          {groupNodes.map(def => nodeBtn(def.type, def.label, def.description))}
                        </div>
                      );
                    })
                  ) : (
                    nodes.map(def => nodeBtn(def.type, def.label, def.description))
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


      {/* ── Saved Graphs ── */}
      {!isSearching && (
        <div style={{ marginTop: '8px', borderTop: '1px solid #313244', paddingTop: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
            <div style={{
              fontSize: '10px', fontWeight: 700, letterSpacing: '0.08em',
              textTransform: 'uppercase', color: '#89b4fa',
              paddingLeft: '4px', flex: 1,
            }}>
              Saved Graphs
            </div>
            <button
              onClick={() => { setShowGraphSaveInput(v => !v); setGraphSaveInput(''); }}
              title="Save current graph"
              style={{
                background: 'none', border: '1px solid #313244', color: '#6c7086',
                borderRadius: '3px', fontSize: '10px', padding: '1px 5px', cursor: 'pointer',
              }}
              onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.color = '#89b4fa')}
              onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.color = '#6c7086')}
            >
              +
            </button>
          </div>

          {/* Inline save input */}
          {showGraphSaveInput && (
            <div style={{ display: 'flex', gap: '4px', marginBottom: '4px' }}>
              <input
                autoFocus
                value={graphSaveInput}
                onChange={e => setGraphSaveInput(e.target.value)}
                placeholder="Graph name…"
                onKeyDown={e => {
                  if (e.key === 'Enter' && graphSaveInput.trim()) {
                    saveGraph(graphSaveInput.trim());
                    refreshSavedNames();
                    setShowGraphSaveInput(false);
                    setGraphSaveInput('');
                  }
                  if (e.key === 'Escape') setShowGraphSaveInput(false);
                }}
                style={{
                  flex: 1, background: '#181825', border: '1px solid #89b4fa',
                  color: '#cdd6f4', borderRadius: '4px', padding: '3px 7px',
                  fontSize: '11px', outline: 'none',
                }}
              />
              <button
                onClick={() => {
                  if (graphSaveInput.trim()) {
                    saveGraph(graphSaveInput.trim());
                    refreshSavedNames();
                    setShowGraphSaveInput(false);
                    setGraphSaveInput('');
                  }
                }}
                disabled={!graphSaveInput.trim()}
                style={{
                  background: graphSaveInput.trim() ? '#89b4fa22' : 'none',
                  border: `1px solid ${graphSaveInput.trim() ? '#89b4fa55' : '#313244'}`,
                  color: graphSaveInput.trim() ? '#89b4fa' : '#45475a',
                  borderRadius: '3px', fontSize: '10px', padding: '2px 6px', cursor: 'pointer',
                }}
              >✓</button>
            </div>
          )}

          {savedNames.length === 0 && !showGraphSaveInput ? (
            <div style={{ fontSize: '10px', color: '#45475a', paddingLeft: '4px', fontStyle: 'italic' }}>
              Click + to save the current graph
            </div>
          ) : (
            savedNames.map(name => (
              <div
                key={name}
                style={{ position: 'relative', marginBottom: '2px' }}
                onMouseEnter={() => setHoverSavedName(name)}
                onMouseLeave={() => setHoverSavedName(null)}
              >
                <button
                  onClick={() => { loadSavedGraph(name); onNodeAdded?.(); }}
                  title={`Load "${name}"`}
                  style={{
                    display: 'block', width: '100%',
                    padding: '5px 28px 5px 10px',
                    background: '#181825',
                    border: '1px solid #89b4fa22',
                    color: '#89b4fa', cursor: 'pointer',
                    textAlign: 'left', borderRadius: '5px', fontSize: '12px',
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.background = '#1a2535')}
                  onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.background = '#181825')}
                >
                  {name}
                </button>
                {hoverSavedName === name && (
                  <button
                    onClick={e => { e.stopPropagation(); deleteSavedGraph(name); refreshSavedNames(); }}
                    title="Delete saved graph"
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

      {/* Import GLSL modal */}
      {showImport && <ImportGlslModal onClose={() => setShowImport(false)} />}
    </div>
  );
}
