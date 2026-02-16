import { useState, useEffect } from 'react';
import { useNodeGraphStore, loadCustomFns } from '../../store/useNodeGraphStore';
import { getAllCategories, getNodesByCategory, NODE_REGISTRY } from '../../nodes/definitions';
import { ImportGlslModal } from './ImportGlslModal';
import type { NodeDefinition } from '../../types/nodeGraph';
import type { CustomFnPreset } from '../../types/customFnPreset';

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
  'Effects', '2D Primitives', 'SDF', 'Combiners',
  'Science', 'Presets', 'Output',
];

// ─── CustomFn presets ─────────────────────────────────────────────────────────

const FBM_GLSL = `float hash21(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

float fbm(vec2 p) {
  float v = 0.0; float a = 0.5;
  vec2 shift = vec2(100.0);
  mat2 rot = mat2(cos(0.5), sin(0.5), -sin(0.5), cos(0.5));
  for(int i = 0; i < 5; i++){
    v += a * (hash21(p) * 2.0 - 1.0);
    p = rot * p * 2.0 + shift;
    a *= 0.5;
  }
  return v;
}`;

const VALUE_NOISE_GLSL = `float hash21(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i+vec2(0,0)), hash21(i+vec2(1,0)), u.x),
    mix(hash21(i+vec2(0,1)), hash21(i+vec2(1,1)), u.x),
    u.y
  );
}`;

const VORONOI_GLSL = `vec2 voronoi(vec2 x) {
  vec2 n = floor(x);
  vec2 f = fract(x);
  float md = 8.0; vec2 mr = vec2(0.0);
  for(int j=-1; j<=1; j++)
  for(int i=-1; i<=1; i++){
    vec2 g = vec2(float(i), float(j));
    vec2 o = fract(sin(vec2(dot(n+g,vec2(127.1,311.7)), dot(n+g,vec2(269.5,183.3))))*43758.5453);
    vec2 r = g + o - f;
    float d = dot(r,r);
    if(d < md){ md = d; mr = r; }
  }
  return vec2(sqrt(md), dot(mr, mr));
}`;

// Local type for the hardcoded presets (no id/savedAt needed)
interface BuiltinPreset {
  label: string;
  inputs: Array<{ name: string; type: string }>;
  outputType: string;
  body: string;
  glslFunctions: string;
}

const CUSTOMFN_PRESETS: BuiltinPreset[] = [
  {
    label: 'FBM Noise',
    inputs: [{ name: 'p', type: 'vec2' }],
    outputType: 'float',
    body: 'fbm(p)',
    glslFunctions: FBM_GLSL,
  },
  {
    label: 'Value Noise',
    inputs: [{ name: 'p', type: 'vec2' }],
    outputType: 'float',
    body: 'noise(p)',
    glslFunctions: VALUE_NOISE_GLSL,
  },
  {
    label: 'Voronoi',
    inputs: [{ name: 'p', type: 'vec2' }],
    outputType: 'float',
    body: 'voronoi(p).x',
    glslFunctions: VORONOI_GLSL,
  },
  {
    label: 'SDF Box',
    inputs: [{ name: 'p', type: 'vec2' }, { name: 'b', type: 'vec2' }],
    outputType: 'float',
    body: 'sdBox(p, b)',
    glslFunctions: `float sdBox(vec2 p, vec2 b) {
  vec2 d = abs(p) - b;
  return length(max(d,0.0)) + min(max(d.x,d.y),0.0);
}`,
  },
];


interface NodePaletteProps {
  /** 'full' = normal left sidebar; 'drawer' = fills container (used in mobile bottom sheet) */
  mode?: 'full' | 'drawer';
  /** Called when a node is added (e.g. to close the drawer on mobile) */
  onNodeAdded?: () => void;
}

export function NodePalette({ mode = 'full', onNodeAdded }: NodePaletteProps) {
  const { addNode, deleteCustomFn, exportCustomFns, importCustomFnsFromFile } = useNodeGraphStore();
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
  // Refresh presets from localStorage
  const refreshPresets = () => setUserPresets(loadCustomFns());

  // Refresh on window focus (in case another tab saved a preset)
  useEffect(() => {
    window.addEventListener('focus', refreshPresets);
    return () => window.removeEventListener('focus', refreshPresets);
  }, []);

  const toggleCategory = (cat: string) => {
    setOpen(prev => {
      const next = new Set(prev);
      if (next.has(cat)) { next.delete(cat); } else { next.add(cat); }
      return next;
    });
  };

  const handleAdd = (type: string) => {
    const x = 200 + Math.random() * 120;
    const y = 120 + Math.random() * 200;
    addNode(type, { x, y });
    onNodeAdded?.();
  };

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
      title={description}
      style={{
        display: 'block',
        width: '100%',
        padding: isDrawer ? '9px 12px' : '5px 10px',
        marginBottom: '3px',
        background: '#313244',
        border: '1px solid #45475a',
        color: '#cdd6f4',
        cursor: 'pointer',
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
        Add Node
      </div>

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
                </div>
              )}
            </div>
          );
        })
      )}

      {/* ── CustomFn Presets ── */}
      {!isSearching && (
        <div style={{ marginTop: '8px', borderTop: '1px solid #313244', paddingTop: '8px' }}>
          <div style={{
            fontSize: '10px', fontWeight: 700, letterSpacing: '0.08em',
            textTransform: 'uppercase', color: '#cba6f7',
            paddingLeft: '4px', marginBottom: '4px',
          }}>
            Presets
          </div>
          {CUSTOMFN_PRESETS.map(preset => (
            <button
              key={preset.label}
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
              }}
              title={`Add "${preset.label}" CustomFn node`}
              style={{
                display: 'block', width: '100%',
                padding: '5px 10px', marginBottom: '2px',
                background: '#2a1f3d',
                border: '1px solid #cba6f733',
                color: '#cba6f7', cursor: 'pointer',
                textAlign: 'left', borderRadius: '5px', fontSize: '12px',
                transition: 'background 0.1s',
              }}
              onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.background = '#3a2550')}
              onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.background = '#2a1f3d')}
            >
              ƒ {preset.label}
            </button>
          ))}
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
              onClick={async () => { await importCustomFnsFromFile(); refreshPresets(); }}
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
