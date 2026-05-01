import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNodeGraphStore, loadCustomFns, getCustomFnDir, EXAMPLE_GRAPHS, loadExprPresets, deleteExprPreset, renameExprPreset, loadTransformPresets, deleteTransformPreset, renameTransformPreset } from '../../store/useNodeGraphStore';
import { NODE_REGISTRY, getNodeDefinition } from '../../nodes/definitions';
import { NodeBrowser } from './NodeBrowser';
import { ImportGlslModal } from './ImportGlslModal';
import { pickDirectory } from '../../utils/fileIO';
import { getAssetTags, saveAssetTags, getTagSuggestions } from '../../utils/assetTags';
import type { CustomFnPreset } from '../../types/customFnPreset';
import type { ExprPreset } from '../../types/exprPreset';
import type { GroupPreset } from '../../types/groupPreset';
import type { TransformPreset } from '../../types/transformPreset';

// ── Example folders ───────────────────────────────────────────────────────────
type ExKey = keyof typeof EXAMPLE_GRAPHS;

const EXAMPLE_FOLDERS: Array<{ label: string; color: string; keys: ExKey[] }> = [
  { label: '3D Lighting',     color: '#f9c468', keys: ['aoSphere','phaseHGForwardCloud','phaseHGBacklit','fresnelSchlickRim','fresnelSchlickTwoTone','refractDirFakeGlass','refractDirDispersion'] as ExKey[] },
  { label: '3D SDF',          color: '#89dceb', keys: ['sdfPolarRepeat','sdfSmoothMetaballs','sdfBend3D','sdfIntersectDemo','sdCrossScene3D','infinitePillars3D','spiralWorld3D','gyroidWarped','mirrorFoldSpheres','mirrorFoldBoxes','domainWarpSphere','swizzle3DNormalMap','swizzle3DPosGradient'] as ExKey[] },
  { label: 'Blur & Lens',     color: '#89b4fa', keys: ['gaussianBlurDemo','motionBlurTrails','tiltShiftScene','lensBokeh','dofOrbitOrbs','dofForwardDepth','dofDepthBlur'] as ExKey[] },
  { label: 'Color & Lighting',color: '#fab387', keys: ['glowCircle','blackbodyDemo','blendModesDemo','toneMapDemo','angularGradient','shapeShowcase','fbmLandscape','spectralLens','vec3SwizzlePalette','vec2SwizzleUV'] as ExKey[] },
  { label: 'Color Grading',   color: '#f9a86b', keys: ['cgHueRotate','cgLiftGammaGain','cgChain'] as ExKey[] },
  { label: 'Effects & Spaces',color: '#f2cdcd', keys: ['retroTunnel','barrelChroma','crtScreen','mirrorTunnel','glitchEffect'] as ExKey[] },
  { label: 'Fractals',        color: '#cba6f7', keys: ['domainWarpFractal'] as ExKey[] },
  { label: 'Iterated Groups', color: '#a6e3a1', keys: ['groupCarryRings','groupCarryZoom','groupAdditiveRings','groupProductRings','groupCarryRotate','groupCarryFBM','groupCarryDomainWarp','groupCarryPowerFold'] as ExKey[] },
  { label: 'March Loop',      color: '#88aacc', keys: ['mlgRepeatGrid','mlgWiggleTunnel','mlgTwistSpace','mlgSpiralDepth','mlgFoldMirror','mlgRepeatSpace','mlgTwistFold','mlgSpiralFold','mlgDeepTunnel','sphereInversion3D','kaleidoscopeBox3D','icoKaleidoscope3D','mobiusWarp3D','logPolarZoom3D','helixWarp3D','shearKaleidoscope3D','mobiusInversionStack3D'] as ExKey[] },
  { label: 'Matrix',          color: '#f5c842', keys: ['matrixAnisotropicScale','matrixShear','matrixXZYZ','matrixColorGrade'] as ExKey[] },
  { label: 'Particles',       color: '#cba6f7', keys: ['particleFountain','particleExplosion','particleMouseAttract'] as ExKey[] },
  { label: 'Patterns',        color: '#a6e3a1', keys: ['angularFlowerRepeat','angularGearRepeat','ringGlow','sphereFaceLight'] as ExKey[] },
  { label: 'Physics',         color: '#94e2d5', keys: ['orbitals','orbitalVolume3dDemo'] as ExKey[] },
  { label: 'Post Effects',    color: '#f38ba8', keys: ['sobelGlow'] as ExKey[] },
  { label: 'Rings',           color: '#f38ba8', keys: ['fractalRings','exprRings','fractalRingsGroup','exprOrbit'] as ExKey[] },
  { label: 'Shapers',         color: '#a6e3a1', keys: ['shaperLogisticGlow','shaperExpEasePulse','shaperSigmoidFBM','shaperCircularDome','shaperBezierRadial','transformVecPolar','transformVecMirrorFold','transformVecRotate90','vecSinWaveField'] as ExKey[] },
  { label: 'Space & Texture', color: '#f2cdcd', keys: ['waveTextureDemo','waveInterference','waveBands','magicTextureDemo','gridDemo','gridCellPattern','gridChecker','gridMagic','mirroredTileRepeat','limitedRepeatGrid'] as ExKey[] },
  { label: 'Volumetric',      color: '#f5a97f', keys: ['glowMarcher','volHollowShell','volTorus','volRepeatLattice','volOctahedron','volAnimatedRepeat','jitterFogSphere','jitterTorusCloud'] as ExKey[] },
  { label: 'Warping Space',   color: '#f2cdcd', keys: ['displaceDemo'] as ExKey[] },
];

// ── Types ─────────────────────────────────────────────────────────────────────
type TabId = 'nodes' | 'favorites' | 'graphs' | 'presets' | 'functions' | 'expressions';

interface ContentPaneState {
  id: string;
  activeTab: TabId;
  tagFilters: string[];
  flexGrow: number;
}

// ── SVG icons ─────────────────────────────────────────────────────────────────
const NodesIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <rect x="4.5" y="3.5" width="7" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
    <line x1="1" y1="6.5" x2="4.5" y2="6.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    <line x1="1" y1="9.5" x2="4.5" y2="9.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    <line x1="11.5" y1="8" x2="15" y2="8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    <circle cx="1.5" cy="6.5" r="1" fill="currentColor"/>
    <circle cx="1.5" cy="9.5" r="1" fill="currentColor"/>
    <circle cx="14.5" cy="8" r="1" fill="currentColor"/>
  </svg>
);
const FavoritesIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <polygon points="8,1.5 9.7,6 14.5,6 10.7,8.9 12.1,13.5 8,10.6 3.9,13.5 5.3,8.9 1.5,6 6.3,6"
      stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
  </svg>
);
const GraphsIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <circle cx="3" cy="4.5" r="1.8" stroke="currentColor" strokeWidth="1.3"/>
    <circle cx="3" cy="11.5" r="1.8" stroke="currentColor" strokeWidth="1.3"/>
    <circle cx="13" cy="8" r="1.8" stroke="currentColor" strokeWidth="1.3"/>
    <line x1="4.75" y1="5.1" x2="11.25" y2="7.4" stroke="currentColor" strokeWidth="1.3"/>
    <line x1="4.75" y1="10.9" x2="11.25" y2="8.6" stroke="currentColor" strokeWidth="1.3"/>
  </svg>
);
const PresetsIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <rect x="2" y="2" width="5" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.3"/>
    <rect x="9" y="2" width="5" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.3"/>
    <rect x="2" y="9" width="5" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.3"/>
    <rect x="9" y="9" width="5" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.3"/>
  </svg>
);
const FunctionsIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <text x="2" y="13" fontSize="13" fontFamily="Georgia, 'Times New Roman', serif" fontStyle="italic">ƒ</text>
  </svg>
);
const ExpressionsIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <text x="0.5" y="13" fontSize="12" fontFamily="'Courier New', Courier, monospace">{'{}'}</text>
  </svg>
);

const SIDEBAR_TABS: Array<{ id: TabId; label: string; color: string; Icon: () => React.ReactElement }> = [
  { id: 'nodes',       label: 'Nodes',        color: '#89b4fa', Icon: NodesIcon },
  { id: 'favorites',   label: 'Favorites',    color: '#f9e2af', Icon: FavoritesIcon },
  { id: 'graphs',      label: 'Saved Graphs', color: '#a6e3a1', Icon: GraphsIcon },
  { id: 'presets',     label: 'Presets',      color: '#f9e2af', Icon: PresetsIcon },
  { id: 'functions',   label: 'Functions',    color: '#89dceb', Icon: FunctionsIcon },
  { id: 'expressions', label: 'Expr Blocks',  color: '#cba6f7', Icon: ExpressionsIcon },
];

// ── TabPill (with tag editing support) ────────────────────────────────────────
function TabPill({ label, color, onClick, onDelete, onRename, prefix, tabId, assetId }: {
  label: string; color: string;
  onClick: () => void;
  onDelete?: () => void;
  onRename?: () => void;
  prefix?: string;
  tabId?: TabId;
  assetId?: string;
}) {
  const [hovered, setHovered] = useState(false);
  const [editingTags, setEditingTags] = useState(false);
  const [tagInput, setTagInput] = useState('');

  const currentTags = tabId && assetId ? getAssetTags(tabId, assetId) : [];
  const hasTags = currentTags.length > 0;
  const canTag = !!(tabId && assetId);

  // # tag button is always visible; rename/delete appear on hover only
  const hoverBtnCount  = (onDelete ? 1 : 0) + (onRename ? 1 : 0);
  const tagBtnRight    = hovered ? `${hoverBtnCount * 18 + 4}px` : '4px';
  const renameBtnRight = onDelete ? '20px' : '4px';
  // Always reserve space for # button when canTag; add hover button space when hovered
  const extraRight = canTag
    ? (hovered ? (hoverBtnCount + 1) * 18 + 4 : 22)
    : (hovered && hoverBtnCount > 0 ? hoverBtnCount * 18 + 4 : 0);

  const handleSaveTags = () => {
    if (tabId && assetId) {
      const tags = tagInput.split(',').map(t => t.trim()).filter(Boolean);
      saveAssetTags(tabId, assetId, tags);
    }
    setEditingTags(false);
  };

  return (
    <div
      style={{ position: 'relative', display: 'inline-flex', flexDirection: 'column' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        onClick={onClick}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: '4px',
          padding: '4px 8px',
          paddingRight: extraRight > 0 ? `${extraRight}px` : '10px',
          background: hovered ? '#2a2a3e' : '#252535',
          border: `1px solid ${hovered ? color + '55' : '#3a3a4e'}`,
          borderBottom: hasTags ? `2px solid ${color}66` : undefined,
          borderRadius: '20px',
          color: hovered ? color : '#a6adc8',
          fontSize: '11px', fontWeight: 500,
          cursor: 'pointer', userSelect: 'none',
          transition: 'background 0.12s, border-color 0.12s, color 0.12s',
          whiteSpace: 'nowrap',
        }}
      >
        {prefix && <span style={{ opacity: 0.65, fontSize: '10px' }}>{prefix}</span>}
        {label}
      </button>

      {/* # always visible for taggable assets */}
      {canTag && (
        <button
          onClick={e => { e.stopPropagation(); setTagInput(currentTags.join(', ')); setEditingTags(v => !v); }}
          title="Edit tags"
          style={{ position: 'absolute', right: tagBtnRight, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: hasTags ? color : '#45475a', fontSize: '10px', padding: '0 2px', lineHeight: 1, fontFamily: 'monospace', transition: 'right 0.1s, color 0.1s' }}
          onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.color = '#89b4fa')}
          onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.color = hasTags ? color : '#45475a')}
        >#</button>
      )}
      {hovered && onRename && (
        <button onClick={e => { e.stopPropagation(); onRename(); }}
          style={{ position: 'absolute', right: renameBtnRight, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#585b70', fontSize: '11px', padding: '0 2px', lineHeight: 1 }}
          onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.color = '#89b4fa')}
          onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.color = '#585b70')}
        >✎</button>
      )}
      {hovered && onDelete && (
        <button onClick={e => { e.stopPropagation(); onDelete(); }}
          style={{ position: 'absolute', right: '4px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#585b70', fontSize: '11px', padding: '0 2px', lineHeight: 1 }}
          onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.color = '#f38ba8')}
          onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.color = '#585b70')}
        >✕</button>
      )}

      {editingTags && (
        <div
          onMouseDown={e => e.stopPropagation()}
          style={{ position: 'absolute', top: '100%', left: 0, zIndex: 200, marginTop: '3px', background: '#1e1e2e', border: '1px solid #45475a', borderRadius: '6px', padding: '7px 9px', boxShadow: '0 4px 16px rgba(0,0,0,0.6)', minWidth: '190px' }}
        >
          <div style={{ fontSize: '9px', color: '#585b70', marginBottom: '5px', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Tags · comma-separated</div>
          <input
            autoFocus
            value={tagInput}
            onChange={e => setTagInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); handleSaveTags(); }
              if (e.key === 'Escape') { e.preventDefault(); setEditingTags(false); }
              e.stopPropagation();
            }}
            onBlur={handleSaveTags}
            placeholder="math, trig, favorite…"
            style={{ width: '100%', background: '#11111b', border: '1px solid #45475a', color: '#cdd6f4', borderRadius: '4px', padding: '3px 7px', fontSize: '11px', outline: 'none', boxSizing: 'border-box' }}
          />
          {currentTags.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', marginTop: '5px' }}>
              {currentTags.map(t => (
                <span key={t} style={{ fontSize: '9px', padding: '1px 6px', background: color + '22', color, borderRadius: '10px' }}>#{t}</span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── EmptyHint ─────────────────────────────────────────────────────────────────
function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: '10px', color: '#45475a', paddingLeft: '2px', fontStyle: 'italic', lineHeight: 1.6 }}>
      {children}
    </div>
  );
}

// ── TabSectionHeader ──────────────────────────────────────────────────────────
function TabSectionHeader({ label, color, action }: { label: string; color: string; action?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px', marginTop: '10px' }}>
      <span style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color }}>{label}</span>
      <div style={{ flex: 1, height: '1px', background: color + '22' }} />
      {action}
    </div>
  );
}

// ── FilterBar ─────────────────────────────────────────────────────────────────
function FilterBar({ tabId, filters, onFiltersChange }: {
  tabId: TabId; filters: string[]; onFiltersChange: (f: string[]) => void;
}) {
  const [inputVal, setInputVal] = useState('');
  const [focused, setFocused] = useState(false);

  const allSuggestions = getTagSuggestions(tabId, filters);
  const suggestions = inputVal.trim()
    ? allSuggestions.filter(t => t.includes(inputVal.toLowerCase()))
    : allSuggestions;
  const showDropdown = focused && suggestions.length > 0;

  const addFilter = (tag: string) => {
    const t = tag.trim();
    if (t && !filters.includes(t)) onFiltersChange([...filters, t]);
    setInputVal('');
  };

  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', alignItems: 'center', padding: '4px 8px', borderBottom: '1px solid #2a2a3e', background: '#181825', minHeight: '26px' }}>
        {filters.map(tag => (
          <span key={tag} style={{ display: 'inline-flex', alignItems: 'center', gap: '2px', fontSize: '9px', padding: '1px 6px', background: '#89b4fa22', border: '1px solid #89b4fa44', color: '#89b4fa', borderRadius: '10px', whiteSpace: 'nowrap' }}>
            #{tag}
            <button onClick={() => onFiltersChange(filters.filter(f => f !== tag))} style={{ background: 'none', border: 'none', color: '#89b4fa99', cursor: 'pointer', fontSize: '10px', padding: '0', lineHeight: 1, marginLeft: '1px' }}>×</button>
          </span>
        ))}
        <input
          value={inputVal}
          onChange={e => setInputVal(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          onKeyDown={e => {
            if ((e.key === 'Enter' || e.key === ',') && inputVal.trim()) { e.preventDefault(); addFilter(inputVal.replace(',', '')); }
            if (e.key === 'Escape') { setInputVal(''); setFocused(false); }
          }}
          placeholder={filters.length === 0 ? '# tag filter…' : '+ tag'}
          style={{ flex: 1, minWidth: '60px', background: 'transparent', border: 'none', color: '#6c7086', fontSize: '9px', outline: 'none', padding: '1px 0', fontFamily: 'monospace' }}
        />
        {filters.length > 0 && (
          <button
            onClick={() => onFiltersChange([])}
            style={{ background: 'none', border: 'none', color: '#45475a', cursor: 'pointer', fontSize: '9px', padding: '0 2px', whiteSpace: 'nowrap', lineHeight: 1 }}
            onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.color = '#f38ba8')}
            onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.color = '#45475a')}
          >✕</button>
        )}
      </div>

      {/* Custom pill suggestions dropdown */}
      {showDropdown && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 300,
          background: '#1e1e2e', border: '1px solid #313244', borderTop: 'none',
          padding: '6px 8px', display: 'flex', flexWrap: 'wrap', gap: '4px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
        }}>
          {suggestions.map(t => (
            <button
              key={t}
              onMouseDown={e => { e.preventDefault(); addFilter(t); }}
              style={{
                display: 'inline-flex', alignItems: 'center',
                padding: '3px 9px 3px 7px',
                background: '#252535', border: '1px solid #3a3a4e',
                borderRadius: '20px', color: '#a6adc8',
                fontSize: '10px', fontWeight: 500, fontFamily: 'monospace',
                cursor: 'pointer',
                transition: 'background 0.1s, border-color 0.1s, color 0.1s',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#2a2a3e'; (e.currentTarget as HTMLButtonElement).style.borderColor = '#89b4fa55'; (e.currentTarget as HTMLButtonElement).style.color = '#89b4fa'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = '#252535'; (e.currentTarget as HTMLButtonElement).style.borderColor = '#3a3a4e'; (e.currentTarget as HTMLButtonElement).style.color = '#a6adc8'; }}
            >
              #{t}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── ContentPane ───────────────────────────────────────────────────────────────
interface ContentPaneProps {
  state: ContentPaneState;
  onStateChange: (updates: Partial<ContentPaneState>) => void;
  isFocused: boolean;
  onFocus: () => void;
  onClose?: () => void;
  isOnly: boolean;
  favorites: string[];
  onToggleFavorite: (type: string) => void;
  nodeButtonRefs: React.MutableRefObject<Map<string, HTMLButtonElement>>;
  onNodeAdded?: () => void;
  flexGrow: number;
  context?: 'studio' | 'glsl';
  onGlslInsert?: (code: string) => void;
}

function ContentPane({ state, onStateChange, isFocused, onFocus, onClose, isOnly, favorites, onToggleFavorite, nodeButtonRefs, onNodeAdded, flexGrow, context, onGlslInsert }: ContentPaneProps) {
  const {
    addNode, saveGraph, getSavedGraphNames, loadSavedGraph, deleteSavedGraph,
    deleteCustomFn, exportCustomFns, importCustomFnsFromFile, setCustomFnPresetsDir, loadCustomFnsFromDisk,
    swapTargetNodeId, setSwapTargetNodeId, swapNode,
  } = useNodeGraphStore();
  const graphNodes        = useNodeGraphStore(s => s.nodes);
  const groupPresets      = useNodeGraphStore(s => s.groupPresets);
  const instantiateGroupPreset = useNodeGraphStore(s => s.instantiateGroupPreset);
  const deleteGroupPreset = useNodeGraphStore(s => s.deleteGroupPreset);
  const getViewportCenter = useNodeGraphStore(s => s._viewportCenterGetter);
  const loadExampleGraph  = useNodeGraphStore(s => s.loadExampleGraph);

  const [query, setQuery]                           = useState('');
  const [savedNames, setSavedNames]                 = useState<string[]>(() => getSavedGraphNames());
  const [graphSaveInput, setGraphSaveInput]         = useState('');
  const [showGraphSaveInput, setShowGraphSaveInput] = useState(false);
  const [userPresets, setUserPresets]               = useState<CustomFnPreset[]>(() => loadCustomFns());
  const [presetsDir, setPresetsDir]                 = useState<string>(() => getCustomFnDir());
  const [exprPresets, setExprPresets]               = useState<ExprPreset[]>(() => loadExprPresets());
  const [transformPresets, setTransformPresets]     = useState<TransformPreset[]>(() => loadTransformPresets());
  const [renamingExprId, setRenamingExprId]         = useState<string | null>(null);
  const [renameExprValue, setRenameExprValue]       = useState('');
  const [renamingTransformId, setRenamingTransformId] = useState<string | null>(null);
  const [renameTransformValue, setRenameTransformValue] = useState('');
  const [examplesExpanded, setExamplesExpanded]     = useState(false);
  const [openFolders, setOpenFolders]               = useState<Set<string>>(new Set());
  const [showImport, setShowImport]                 = useState(false);

  const { activeTab, tagFilters } = state;
  const hasTagFilter = tagFilters.length > 0;

  const refreshSavedNames     = () => setSavedNames(getSavedGraphNames());
  const refreshExprPresets    = () => setExprPresets(loadExprPresets());
  const refreshTransformPresets = () => setTransformPresets(loadTransformPresets());

  const refreshPresets = useCallback(async () => {
    const local = loadCustomFns();
    const disk  = await loadCustomFnsFromDisk();
    const seen  = new Set<string>();
    const merged: CustomFnPreset[] = [];
    for (const p of [...disk, ...local]) {
      if (!seen.has(p.id)) { seen.add(p.id); merged.push(p); }
    }
    merged.sort((a, b) => a.savedAt - b.savedAt);
    setUserPresets(merged);
  }, [loadCustomFnsFromDisk]);

  useEffect(() => {
    refreshPresets();
    window.addEventListener('focus', refreshPresets);
    window.addEventListener('customfn-changed', refreshPresets);
    return () => { window.removeEventListener('focus', refreshPresets); window.removeEventListener('customfn-changed', refreshPresets); };
  }, [refreshPresets]);

  useEffect(() => {
    refreshExprPresets();
    window.addEventListener('exprpreset-changed', refreshExprPresets);
    return () => window.removeEventListener('exprpreset-changed', refreshExprPresets);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    refreshTransformPresets();
    window.addEventListener('transformpreset-changed', refreshTransformPresets);
    return () => window.removeEventListener('transformpreset-changed', refreshTransformPresets);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePickFolder = async () => {
    const dir = await pickDirectory();
    if (!dir) return;
    setCustomFnPresetsDir(dir);
    setPresetsDir(dir);
    await refreshPresets();
  };

  const handleAdd = (type: string) => {
    if (swapTargetNodeId) { swapNode(swapTargetNodeId, type); onNodeAdded?.(); return; }
    const center = getViewportCenter?.() ?? { x: 300, y: 200 };
    addNode(type, { x: center.x + (Math.random() - 0.5) * 60, y: center.y + (Math.random() - 0.5) * 60 });
    onNodeAdded?.();
  };

  const swapTargetLabel = swapTargetNodeId
    ? (() => { const n = graphNodes.find(nd => nd.id === swapTargetNodeId); if (!n) return null; return getNodeDefinition(n.type)?.label ?? n.type; })()
    : null;

  const toggleFolder = (label: string) =>
    setOpenFolders(prev => { const n = new Set(prev); n.has(label) ? n.delete(label) : n.add(label); return n; });

  const tabInfo = SIDEBAR_TABS.find(t => t.id === activeTab)!;

  // ── Tag-filtered flat view ────────────────────────────────────────────────
  const renderTagFiltered = () => {
    switch (activeTab) {
      case 'nodes': {
        const matches = Object.values(NODE_REGISTRY).filter(def => {
          const tags = getAssetTags('nodes', def.type);
          return tagFilters.every(f => tags.includes(f));
        });
        if (matches.length === 0) return <EmptyHint>No nodes tagged with {tagFilters.map(t => `#${t}`).join(' + ')}.</EmptyHint>;
        return (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
            {matches.map(def => (
              <TabPill key={def.type} label={def.label} color="#89b4fa" tabId="nodes" assetId={def.type}
                onClick={() => handleAdd(def.type)}
              />
            ))}
          </div>
        );
      }
      case 'graphs': {
        const matches = savedNames.filter(name => { const tags = getAssetTags('graphs', name); return tagFilters.every(f => tags.includes(f)); });
        if (matches.length === 0) return <EmptyHint>No saved graphs tagged with {tagFilters.map(t => `#${t}`).join(' + ')}.</EmptyHint>;
        return (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
            {matches.map(name => (
              <TabPill key={name} label={name} color="#a6e3a1" tabId="graphs" assetId={name}
                onClick={() => { loadSavedGraph(name); onNodeAdded?.(); }}
                onDelete={() => { deleteSavedGraph(name); refreshSavedNames(); }}
              />
            ))}
          </div>
        );
      }
      case 'presets': {
        const gMatches = (groupPresets as GroupPreset[]).filter(p => { const tags = getAssetTags('presets', p.id); return tagFilters.every(f => tags.includes(f)); });
        const tMatches = (transformPresets as TransformPreset[]).filter(p => { const tags = getAssetTags('presets', p.id); return tagFilters.every(f => tags.includes(f)); });
        if (gMatches.length === 0 && tMatches.length === 0) return <EmptyHint>No presets tagged with {tagFilters.map(t => `#${t}`).join(' + ')}.</EmptyHint>;
        return (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
            {gMatches.map(p => <TabPill key={p.id} label={p.label} color="#f9e2af" prefix="⬡" tabId="presets" assetId={p.id} onClick={() => { const x = 200 + Math.random()*120, y = 120 + Math.random()*200; instantiateGroupPreset(p.id, {x,y}); onNodeAdded?.(); }} onDelete={() => deleteGroupPreset(p.id)} />)}
            {tMatches.map(p => <TabPill key={p.id} label={p.label} color="#89b4fa" prefix="⊞" tabId="presets" assetId={p.id} onClick={() => { const x = 200 + Math.random()*120, y = 120 + Math.random()*200; addNode('transformVec', {x,y}, { outputType: p.outputType, exprX: p.exprX, exprY: p.exprY, exprZ: p.exprZ, exprW: p.exprW }); onNodeAdded?.(); }} onDelete={() => { deleteTransformPreset(p.id); refreshTransformPresets(); }} />)}
          </div>
        );
      }
      case 'functions': {
        const matches = (userPresets as CustomFnPreset[]).filter(p => { const tags = getAssetTags('functions', p.id); return tagFilters.every(f => tags.includes(f)); });
        if (matches.length === 0) return <EmptyHint>No functions tagged with {tagFilters.map(t => `#${t}`).join(' + ')}.</EmptyHint>;
        return (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
            {matches.map(p => <TabPill key={p.id} label={p.label} color="#89dceb" prefix="ƒ" tabId="functions" assetId={p.id} onClick={() => { const x = 200+Math.random()*120, y = 120+Math.random()*200; addNode('customFn',{x,y},{label:p.label,inputs:p.inputs,outputType:p.outputType,body:p.body,glslFunctions:p.glslFunctions}); onNodeAdded?.(); }} onDelete={() => { deleteCustomFn(p.id); refreshPresets(); }} />)}
          </div>
        );
      }
      case 'expressions': {
        const matches = (exprPresets as ExprPreset[]).filter(p => { const tags = getAssetTags('expressions', p.id); return tagFilters.every(f => tags.includes(f)); });
        if (matches.length === 0) return <EmptyHint>No expression blocks tagged with {tagFilters.map(t => `#${t}`).join(' + ')}.</EmptyHint>;
        return (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
            {matches.map(p => <TabPill key={p.id} label={p.label} color="#cba6f7" prefix="⟴" tabId="expressions" assetId={p.id} onClick={() => { const x = 200+Math.random()*120, y = 120+Math.random()*200; addNode('exprNode',{x,y},{label:p.label,inputs:p.inputs,outputType:p.outputType,lines:p.lines,result:p.result}); onNodeAdded?.(); }} onDelete={() => { deleteExprPreset(p.id); refreshExprPresets(); }} />)}
          </div>
        );
      }
      default:
        return <EmptyHint>Tag filtering not available for this tab.</EmptyHint>;
    }
  };

  // ── Normal tab content ────────────────────────────────────────────────────
  const renderNormal = () => {
    switch (activeTab) {
      case 'nodes':
        return (
          <>
            <input
              type="text" placeholder="Search nodes…" value={query}
              onChange={e => setQuery(e.target.value)}
              style={{ background: '#181825', border: '1px solid #45475a', color: '#cdd6f4', borderRadius: '5px', padding: '5px 8px', fontSize: '11px', outline: 'none', marginBottom: '4px', width: '100%', boxSizing: 'border-box' }}
            />
            <NodeBrowser onAdd={handleAdd} swapTargetNodeId={swapTargetNodeId} favorites={favorites} onToggleFavorite={onToggleFavorite} nodeButtonRefs={nodeButtonRefs} searchQuery={query} context={context} onGlslInsert={onGlslInsert} />
            {query.trim().length === 0 && (
              <div style={{ marginTop: '8px', borderTop: '1px solid #313244', paddingTop: '8px' }}>
                <button onClick={() => setExamplesExpanded(v => !v)}
                  style={{ display: 'flex', alignItems: 'center', gap: '5px', width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', marginBottom: '3px', textAlign: 'left' }}
                >
                  <span style={{ fontSize: '7px', opacity: 0.5, color: '#585b70', width: '7px' }}>{examplesExpanded ? '▼' : '▶'}</span>
                  <span style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#585b70' }}>Examples</span>
                </button>
                {examplesExpanded && EXAMPLE_FOLDERS.filter(f => f.keys.some(k => EXAMPLE_GRAPHS[k])).map(folder => {
                  const isOpen = openFolders.has(folder.label);
                  return (
                    <div key={folder.label} style={{ marginBottom: '1px' }}>
                      <button onClick={() => toggleFolder(folder.label)}
                        style={{ display: 'flex', alignItems: 'center', gap: '5px', width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: '3px 4px', borderRadius: '4px', color: folder.color, fontSize: '11px', fontWeight: 600, textAlign: 'left' }}
                        onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.background = '#313244')}
                        onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.background = 'none')}
                      >
                        <span style={{ fontSize: '8px', opacity: 0.6, width: '8px' }}>{isOpen ? '▼' : '▶'}</span>
                        <span style={{ fontSize: '12px', marginRight: '2px' }}>📁</span>
                        {folder.label}
                        <span style={{ marginLeft: 'auto', fontSize: '9px', opacity: 0.4 }}>{folder.keys.filter(k => EXAMPLE_GRAPHS[k]).length}</span>
                      </button>
                      {isOpen && (
                        <div style={{ paddingLeft: '18px', paddingBottom: '2px' }}>
                          {folder.keys.filter(k => EXAMPLE_GRAPHS[k])
                            .sort((a, b) => EXAMPLE_GRAPHS[a].label.localeCompare(EXAMPLE_GRAPHS[b].label))
                            .map(k => {
                              const ex = EXAMPLE_GRAPHS[k];
                              return (
                                <button key={k} onClick={() => { loadExampleGraph(k); onNodeAdded?.(); }}
                                  style={{ display: 'block', width: '100%', padding: '3px 6px', background: '#181825', border: 'none', color: '#a6adc8', cursor: 'pointer', textAlign: 'left', borderRadius: '4px', fontSize: '11px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#313244'; (e.currentTarget as HTMLButtonElement).style.color = folder.color; }}
                                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = '#181825'; (e.currentTarget as HTMLButtonElement).style.color = '#a6adc8'; }}
                                  title={ex.label}
                                >{ex.label}</button>
                              );
                            })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        );

      case 'favorites':
        return favorites.length === 0
          ? <EmptyHint>Star a node in the Nodes tab to add it here.</EmptyHint>
          : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
              {favorites.map(t => {
                const def = NODE_REGISTRY[t];
                if (!def) return null;
                return <TabPill key={t} label={def.label} color="#f9e2af" tabId="favorites" assetId={t} onClick={() => handleAdd(t)} onDelete={() => onToggleFavorite(t)} />;
              })}
            </div>
          );

      case 'graphs':
        return (
          <>
            <div style={{ display: 'flex', gap: '4px', alignItems: 'center', marginBottom: '6px' }}>
              <button onClick={() => { setShowGraphSaveInput(v => !v); setGraphSaveInput(''); }}
                style={{ background: '#1a2535', border: '1px solid #89b4fa44', color: '#89b4fa', borderRadius: '5px', fontSize: '10px', padding: '3px 10px', cursor: 'pointer' }}
                onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.background = '#1e3040')}
                onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.background = '#1a2535')}
              >+ Save Current</button>
            </div>
            {showGraphSaveInput && (
              <div style={{ display: 'flex', gap: '4px', marginBottom: '8px' }}>
                <input autoFocus value={graphSaveInput} onChange={e => setGraphSaveInput(e.target.value)}
                  placeholder="Graph name…"
                  onKeyDown={e => {
                    if (e.key === 'Enter' && graphSaveInput.trim()) { saveGraph(graphSaveInput.trim()); refreshSavedNames(); setShowGraphSaveInput(false); setGraphSaveInput(''); }
                    if (e.key === 'Escape') setShowGraphSaveInput(false);
                  }}
                  style={{ flex: 1, background: '#181825', border: '1px solid #89b4fa', color: '#cdd6f4', borderRadius: '4px', padding: '3px 7px', fontSize: '11px', outline: 'none' }}
                />
                <button onClick={() => { if (graphSaveInput.trim()) { saveGraph(graphSaveInput.trim()); refreshSavedNames(); setShowGraphSaveInput(false); setGraphSaveInput(''); } }}
                  disabled={!graphSaveInput.trim()}
                  style={{ background: graphSaveInput.trim() ? '#89b4fa22' : 'none', border: `1px solid ${graphSaveInput.trim() ? '#89b4fa55' : '#313244'}`, color: graphSaveInput.trim() ? '#89b4fa' : '#45475a', borderRadius: '3px', fontSize: '10px', padding: '2px 6px', cursor: 'pointer' }}
                >✓</button>
              </div>
            )}
            {savedNames.length === 0 && !showGraphSaveInput
              ? <EmptyHint>Click "+ Save Current" to save the active graph.</EmptyHint>
              : <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                  {savedNames.map(name => (
                    <TabPill key={name} label={name} color="#a6e3a1" tabId="graphs" assetId={name}
                      onClick={() => { loadSavedGraph(name); onNodeAdded?.(); }}
                      onDelete={() => { deleteSavedGraph(name); refreshSavedNames(); }}
                    />
                  ))}
                </div>
            }
          </>
        );

      case 'presets':
        return (
          <>
            <TabSectionHeader label="Group Presets" color="#f9e2af" />
            {groupPresets.length === 0
              ? <EmptyHint>Select a group node and click ⬇ Save to create a preset.</EmptyHint>
              : <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                  {(groupPresets as GroupPreset[]).map(p => (
                    <TabPill key={p.id} label={p.label} color="#f9e2af" prefix="⬡" tabId="presets" assetId={p.id}
                      onClick={() => { const x = 200+Math.random()*120, y = 120+Math.random()*200; instantiateGroupPreset(p.id, {x,y}); onNodeAdded?.(); }}
                      onDelete={() => deleteGroupPreset(p.id)}
                    />
                  ))}
                </div>
            }
            <TabSectionHeader label="Transform Vec" color="#89b4fa" />
            {transformPresets.length === 0
              ? <EmptyHint>Open a Transform Vec node and click "↑ Save Preset".</EmptyHint>
              : <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                  {(transformPresets as TransformPreset[]).map(p => (
                    renamingTransformId === p.id
                      ? <input key={p.id} autoFocus value={renameTransformValue} onChange={e => setRenameTransformValue(e.target.value)}
                          onBlur={() => { renameTransformPreset(p.id, renameTransformValue); setRenamingTransformId(null); refreshTransformPresets(); }}
                          onKeyDown={e => { if (e.key === 'Enter') { renameTransformPreset(p.id, renameTransformValue); setRenamingTransformId(null); refreshTransformPresets(); } if (e.key === 'Escape') setRenamingTransformId(null); e.stopPropagation(); }}
                          style={{ background: '#11111b', border: '1px solid #89b4fa', color: '#89b4fa', borderRadius: '20px', padding: '3px 10px', fontSize: '11px', outline: 'none', width: '120px' }}
                        />
                      : <TabPill key={p.id} label={p.label} color="#89b4fa" prefix="⊞" tabId="presets" assetId={p.id}
                          onClick={() => { const x = 200+Math.random()*120, y = 120+Math.random()*200; addNode('transformVec',{x,y},{outputType:p.outputType,exprX:p.exprX,exprY:p.exprY,exprZ:p.exprZ,exprW:p.exprW}); onNodeAdded?.(); }}
                          onDelete={() => { deleteTransformPreset(p.id); refreshTransformPresets(); }}
                          onRename={() => { setRenameTransformValue(p.label); setRenamingTransformId(p.id); }}
                        />
                  ))}
                </div>
            }
          </>
        );

      case 'functions':
        return (
          <>
            <div style={{ display: 'flex', gap: '4px', alignItems: 'center', marginBottom: '6px', flexWrap: 'wrap' }}>
              <button onClick={handlePickFolder} title={presetsDir ? `Saving to: ${presetsDir}` : 'Pick a folder to save presets on disk'}
                style={{ background: presetsDir ? '#89dceb18' : 'none', border: `1px solid ${presetsDir ? '#89dceb55' : '#313244'}`, color: presetsDir ? '#89dceb' : '#6c7086', borderRadius: '5px', fontSize: '10px', padding: '3px 8px', cursor: 'pointer' }}
              >📁 {presetsDir ? presetsDir.split('/').pop() : 'Pick folder'}</button>
              {userPresets.length > 0 && (
                <button onClick={() => exportCustomFns()} title="Export functions"
                  style={{ background: 'none', border: '1px solid #313244', color: '#6c7086', borderRadius: '5px', fontSize: '10px', padding: '3px 8px', cursor: 'pointer' }}
                  onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.color = '#89dceb')}
                  onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.color = '#6c7086')}
                >↑ Export</button>
              )}
              <button onClick={async () => { await importCustomFnsFromFile(); await refreshPresets(); }} title="Import functions"
                style={{ background: 'none', border: '1px solid #313244', color: '#6c7086', borderRadius: '5px', fontSize: '10px', padding: '3px 8px', cursor: 'pointer' }}
                onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.color = '#89dceb')}
                onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.color = '#6c7086')}
              >↓ Import</button>
            </div>
            {userPresets.length === 0
              ? <EmptyHint>Open a Custom Fn node and click "↑ Save Preset".</EmptyHint>
              : <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                  {(userPresets as CustomFnPreset[]).map(p => (
                    <TabPill key={p.id} label={p.label} color="#89dceb" prefix="ƒ" tabId="functions" assetId={p.id}
                      onClick={() => { const x = 200+Math.random()*120, y = 120+Math.random()*200; addNode('customFn',{x,y},{label:p.label,inputs:p.inputs,outputType:p.outputType,body:p.body,glslFunctions:p.glslFunctions}); onNodeAdded?.(); }}
                      onDelete={() => { deleteCustomFn(p.id); refreshPresets(); }}
                    />
                  ))}
                </div>
            }
          </>
        );

      case 'expressions':
        return exprPresets.length === 0
          ? <EmptyHint>Open an Expr Block node and click "↑ Save Preset".</EmptyHint>
          : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
              {(exprPresets as ExprPreset[]).map(p => (
                renamingExprId === p.id
                  ? <input key={p.id} autoFocus value={renameExprValue} onChange={e => setRenameExprValue(e.target.value)}
                      onBlur={() => { renameExprPreset(p.id, renameExprValue); setRenamingExprId(null); refreshExprPresets(); }}
                      onKeyDown={e => { if (e.key === 'Enter') { renameExprPreset(p.id, renameExprValue); setRenamingExprId(null); refreshExprPresets(); } if (e.key === 'Escape') setRenamingExprId(null); e.stopPropagation(); }}
                      style={{ background: '#11111b', border: '1px solid #cba6f7', color: '#cba6f7', borderRadius: '20px', padding: '3px 10px', fontSize: '11px', outline: 'none', width: '120px' }}
                    />
                  : <TabPill key={p.id} label={p.label} color="#cba6f7" prefix="⟴" tabId="expressions" assetId={p.id}
                      onClick={() => { const x = 200+Math.random()*120, y = 120+Math.random()*200; addNode('exprNode',{x,y},{label:p.label,inputs:p.inputs,outputType:p.outputType,lines:p.lines,result:p.result}); onNodeAdded?.(); }}
                      onDelete={() => { deleteExprPreset(p.id); refreshExprPresets(); }}
                      onRename={() => { setRenameExprValue(p.label); setRenamingExprId(p.id); }}
                    />
              ))}
            </div>
          );

      default: return null;
    }
  };

  return (
    <div
      onMouseDown={onFocus}
      style={{ flex: `${flexGrow} ${flexGrow} 0`, minHeight: '80px', display: 'flex', flexDirection: 'column', overflow: 'hidden', borderTop: isFocused ? '1px solid #3a3a5a' : '1px solid #252535' }}
    >
      {/* Pane header: tab name + close button */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '0 6px', height: '22px', background: isFocused ? '#1e1e2e' : '#181825', borderBottom: `1px solid ${isFocused ? '#3a3a5a' : '#252535'}`, flexShrink: 0, gap: '5px' }}>
        <span style={{ color: isFocused ? tabInfo.color : '#45475a', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          <tabInfo.Icon />
        </span>
        <span style={{ fontSize: '9px', color: isFocused ? '#a6adc8' : '#45475a', fontWeight: 600, letterSpacing: '0.06em', flex: 1, textTransform: 'uppercase', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {tabInfo.label}
        </span>
        {!isOnly && (
          <button
            onMouseDown={e => e.stopPropagation()}
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: '#45475a', cursor: 'pointer', fontSize: '10px', padding: '0 1px', lineHeight: 1, flexShrink: 0 }}
            onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.color = '#f38ba8')}
            onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.color = '#45475a')}
          >✕</button>
        )}
      </div>

      {/* Filter bar */}
      <FilterBar tabId={activeTab} filters={tagFilters} onFiltersChange={f => onStateChange({ tagFilters: f })} />

      {/* Swap banner */}
      {swapTargetNodeId && (
        <div style={{ background: '#f9e2af22', borderBottom: '1px solid #f9e2af33', padding: '4px 8px', fontSize: '11px', color: '#f9e2af', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px', flexShrink: 0 }}>
          <span>↔ Replace <strong>{swapTargetLabel}</strong></span>
          <button onClick={() => setSwapTargetNodeId(null)} style={{ background: 'none', border: 'none', color: '#f9e2af', cursor: 'pointer', fontSize: '11px', padding: '0 2px', opacity: 0.7 }}>✕</button>
        </div>
      )}

      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px', display: 'flex', flexDirection: 'column', gap: '4px', minHeight: 0 }}>
        {hasTagFilter
          ? <>
              <div style={{ fontSize: '9px', color: '#585b70', marginBottom: '6px', letterSpacing: '0.06em' }}>
                Filtered by: {tagFilters.map(t => <span key={t} style={{ color: '#89b4fa', marginRight: '4px' }}>#{t}</span>)}
              </div>
              {renderTagFiltered()}
            </>
          : renderNormal()
        }
      </div>

      {showImport && <ImportGlslModal onClose={() => setShowImport(false)} />}
    </div>
  );
}

// ── NodePalette ───────────────────────────────────────────────────────────────
interface NodePaletteProps {
  mode?: 'full' | 'drawer';
  onNodeAdded?: () => void;
  onCollapse?: () => void;
  context?: 'studio' | 'glsl';
  onGlslInsert?: (code: string) => void;
}

let _paneCounter = 1;
function mkPane(activeTab: TabId = 'nodes'): ContentPaneState {
  return { id: `pane-${_paneCounter++}`, activeTab, tagFilters: [], flexGrow: 1 };
}

export function NodePalette({ mode = 'full', onNodeAdded, onCollapse, context, onGlslInsert }: NodePaletteProps) {
  // All hooks must be at the top — no hooks after conditional returns
  const { addNode, swapTargetNodeId, setSwapTargetNodeId, swapNode, nodes: graphNodes } = useNodeGraphStore();
  const getViewportCenter = useNodeGraphStore(s => s._viewportCenterGetter);

  const [favorites, setFavorites] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('nodepalette_favorites') ?? '[]'); } catch { return []; }
  });
  const [drawerQuery, setDrawerQuery] = useState('');
  const [panes, setPanes]             = useState<ContentPaneState[]>(() => [mkPane('nodes')]);
  const [focusedPaneId, setFocusedPaneId] = useState(() => panes[0].id);

  const nodeButtonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const panesContainerRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{ startY: number; idxA: number; idxB: number; heightA: number; heightB: number } | null>(null);

  const toggleFavorite = (type: string) => {
    setFavorites(prev => {
      const next = prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type];
      localStorage.setItem('nodepalette_favorites', JSON.stringify(next));
      return next;
    });
  };

  // ── Drawer mode ───────────────────────────────────────────────────────────
  if (mode === 'drawer') {
    const handleAdd = (type: string) => {
      if (swapTargetNodeId) { swapNode(swapTargetNodeId, type); onNodeAdded?.(); return; }
      const center = getViewportCenter?.() ?? { x: 300, y: 200 };
      addNode(type, { x: center.x + (Math.random()-0.5)*60, y: center.y + (Math.random()-0.5)*60 });
      onNodeAdded?.();
    };
    return (
      <div style={{ width: '100%', background: '#1e1e2e', color: '#cdd6f4', padding: '4px 12px 20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px', flex: 1, minHeight: 0, boxSizing: 'border-box' }}>
        <input type="text" placeholder="Search nodes…" value={drawerQuery} onChange={e => setDrawerQuery(e.target.value)}
          style={{ background: '#181825', border: '1px solid #45475a', color: '#cdd6f4', borderRadius: '5px', padding: '5px 8px', fontSize: '11px', outline: 'none', marginBottom: '6px', width: '100%', boxSizing: 'border-box' }}
        />
        <NodeBrowser onAdd={handleAdd} swapTargetNodeId={swapTargetNodeId} favorites={favorites} onToggleFavorite={toggleFavorite} nodeButtonRefs={nodeButtonRefs} searchQuery={drawerQuery} />
      </div>
    );
  }

  // ── Full mode: sidebar + multi-pane ───────────────────────────────────────

  const focusedPane = panes.find(p => p.id === focusedPaneId) ?? panes[0];

  const updatePane = (id: string, updates: Partial<ContentPaneState>) =>
    setPanes(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));

  const addPane = () => {
    const newPane = mkPane(focusedPane.activeTab);
    setPanes(prev => [...prev, newPane]);
    setFocusedPaneId(newPane.id);
  };

  const closePane = (id: string) => {
    const idx = panes.findIndex(p => p.id === id);
    const newPanes = panes.filter(p => p.id !== id);
    if (focusedPaneId === id) {
      setFocusedPaneId(newPanes[Math.min(idx, newPanes.length - 1)]?.id ?? '');
    }
    setPanes(newPanes);
  };

  const startPaneResize = (e: React.MouseEvent, idxA: number) => {
    e.preventDefault();
    const container = panesContainerRef.current;
    if (!container) return;
    const children = Array.from(container.children) as HTMLElement[];
    // children alternate: pane, handle, pane, handle, pane ...
    // pane at idxA is children[idxA * 2], pane at idxB is children[idxA * 2 + 2]
    const elA = children[idxA * 2];
    const elB = children[idxA * 2 + 2];
    if (!elA || !elB) return;
    dragState.current = {
      startY: e.clientY,
      idxA,
      idxB: idxA + 1,
      heightA: elA.getBoundingClientRect().height,
      heightB: elB.getBoundingClientRect().height,
    };

    const onMove = (ev: MouseEvent) => {
      const ds = dragState.current;
      if (!ds) return;
      const delta = ev.clientY - ds.startY;
      const MIN_H = 80;
      const combined = ds.heightA + ds.heightB;
      const newHeightA = Math.max(MIN_H, Math.min(combined - MIN_H, ds.heightA + delta));
      const newHeightB = combined - newHeightA;
      const totalFlex = panes.reduce((s, p) => s + p.flexGrow, 0);
      const containerH = container.getBoundingClientRect().height;
      const flexPerPx = totalFlex / containerH;
      setPanes(prev => prev.map((p, i) => {
        if (i === ds.idxA) return { ...p, flexGrow: Math.max(0.1, newHeightA * flexPerPx) };
        if (i === ds.idxB) return { ...p, flexGrow: Math.max(0.1, newHeightB * flexPerPx) };
        return p;
      }));
    };

    const onUp = () => {
      dragState.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', overflow: 'hidden', background: '#1e1e2e', color: '#cdd6f4' }}>

      {/* Main row: sidebar + panes */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>

        {/* Sidebar */}
        <div style={{ width: 36, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '8px 0', gap: '2px', borderRight: '1px solid #313244', background: '#181825' }}>
          {SIDEBAR_TABS.map(({ id, label, color, Icon }) => {
            const isActive = focusedPane.activeTab === id;
            return (
              <button
                key={id}
                onClick={() => updatePane(focusedPane.id, { activeTab: id })}
                title={label}
                style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', background: isActive ? '#313244' : 'none', border: isActive ? `1px solid ${color}33` : '1px solid transparent', borderRadius: 6, color: isActive ? color : '#585b70', cursor: 'pointer', transition: 'background 0.1s, color 0.1s, border-color 0.1s', padding: 0 }}
                onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.color = '#a6adc8'; }}
                onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.color = '#585b70'; }}
              >
                <Icon />
              </button>
            );
          })}

          {/* Collapse button pinned to bottom */}
          {onCollapse && (
            <button
              onClick={onCollapse}
              title="Collapse palette"
              style={{ marginTop: 'auto', width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: '1px solid transparent', borderRadius: 6, color: '#45475a', cursor: 'pointer', fontSize: '10px', padding: 0, transition: 'color 0.1s' }}
              onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.color = '#cdd6f4')}
              onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.color = '#45475a')}
            >◀</button>
          )}
        </div>

        {/* Content panes — stacked vertically */}
        <div ref={panesContainerRef} style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
          {panes.map((pane, idx) => (
            <React.Fragment key={pane.id}>
              {idx > 0 && (
                <div
                  onMouseDown={e => startPaneResize(e, idx - 1)}
                  style={{ height: '5px', flexShrink: 0, cursor: 'ns-resize', background: 'transparent', position: 'relative', zIndex: 10 }}
                  onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = '#3a3a5a'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
                />
              )}
              <ContentPane
                state={pane}
                onStateChange={updates => updatePane(pane.id, updates)}
                isFocused={pane.id === focusedPaneId}
                onFocus={() => setFocusedPaneId(pane.id)}
                onClose={panes.length > 1 ? () => closePane(pane.id) : undefined}
                isOnly={panes.length === 1}
                favorites={favorites}
                onToggleFavorite={toggleFavorite}
                nodeButtonRefs={nodeButtonRefs}
                onNodeAdded={onNodeAdded}
                flexGrow={pane.flexGrow}
                context={context}
                onGlslInsert={onGlslInsert}
              />
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* Add pane button — only show when fewer than 4 panes */}
      {panes.length < 4 && (
        <button
          onClick={addPane}
          title="Add pane"
          style={{ height: '22px', flexShrink: 0, background: 'none', border: 'none', borderTop: '1px solid #252535', color: '#45475a', cursor: 'pointer', fontSize: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', transition: 'background 0.1s, color 0.1s' }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#252535'; (e.currentTarget as HTMLButtonElement).style.color = '#89b4fa'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'none'; (e.currentTarget as HTMLButtonElement).style.color = '#45475a'; }}
        >
          <span style={{ fontSize: '12px', lineHeight: 1 }}>+</span>
          <span>pane</span>
        </button>
      )}
    </div>
  );
}
