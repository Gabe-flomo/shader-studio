import { useState, useEffect, useRef, useCallback, type ReactNode } from 'react';
import { scoreNodeDef } from '../../nodes/searchNodes';
import { createPortal } from 'react-dom';
import { getAllCategories, getNodesByCategory, getOfferedDefinitions, getNodeDefinition } from '../../nodes/definitions';
import { useUserNodesVersion } from '../../nodes/userNodes/useUserNodes';
import { getUserNode } from '../../nodes/userNodes/userNodeRegistry';
import { DocText } from '../ui/DocText';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { NodeInlineViz, INLINE_VIZ_TYPES } from './NodeInlineViz';
import type { GraphNode } from '../../types/nodeGraph';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { Button, IconButton } from '../ui/Button';
import { Icon } from '../ui/Icon';

// ── Nodes hidden from browser ─────────────────────────────────────────────────
const HIDDEN_NODES = new Set([
  'output', 'vec4Output', 'loopIndex',
  'groupOutput', 'groupInput', 'marchLoopInputs', 'marchLoopOutput', 'scope',
  'forLoop', 'loopRippleStep', 'loopRotateStep', 'loopDomainFold',
  'loopFloatAccumulate', 'loopColorRingStep', 'loopRingStep',
  'forwardCamera',
  'marchPos', 'marchDist', 'marchOutput',
  'scenePos', 'sceneOutput', 'spaceWarpGroup',
  'rotatingLinesLoop', 'accumulateLoop', 'flowField', 'circlePack',
  'raymarch3d', 'volumeClouds', 'rayMarch', 'loopCarry', 'loop',
  'grid',
]);

const CATEGORY_SECTIONS: Array<{ label: string; categories: string[] }> = [
  { label: 'Shapes',       categories: ['2D Primitives', 'SDF', '2D Space', '3D Primitives', '3D Boolean Ops', '3D Transforms', 'Combiners'] },
  { label: '3D',           categories: ['3D Scene', '3D Lighting', '3D Fractals', 'Loops'] },
  { label: 'Color & Post', categories: ['Color', 'Color Grading', 'Post Processing', 'Effects'] },
  { label: 'Generators',   categories: ['Noise', 'Halftone', 'Fractals', 'Science', 'Particles', 'Particles & Fields', 'Grid', 'Field'] },
  { label: 'Math & Logic', categories: ['Sources', 'Animation', 'Math', 'Matrix', 'Shapers', 'Conditionals'] },
  { label: 'Functions',    categories: ['My Nodes', 'Functions'] },
  { label: 'Utility',      categories: ['Utility', 'Output'] },
];

const CATEGORY_ORDER = CATEGORY_SECTIONS.flatMap(s => s.categories);

// ── Sub-group definitions for categories that need them ───────────────────────
const CATEGORY_GROUPS: Record<string, Array<{ label: string; types: string[] }>> = {
  '2D Primitives': [
    { label: 'SDF',      types: ['circleSDF', 'boxSDF', 'ringSDF', 'simpleSDF', 'shapeSDF', 'sdSegment', 'sdEllipse'] },
    { label: 'Patterns', types: ['truchet', 'metaballs', 'lissajous'] },
  ],
  '3D Primitives': [
    { label: 'Basic',   types: ['sphereSDF3D', 'boxSDF3D', 'torusSDF3D', 'capsuleSDF3D', 'cylinderSDF3D', 'coneSDF3D', 'planeSDF3D', 'octahedronSDF3D'] },
    { label: 'Curved',  types: ['ellipsoidSDF3D', 'cappedTorusSDF3D', 'cappedConeSDF3D', 'roundedBoxSDF3D', 'roundedCylinderSDF3D', 'verticalCapsuleSDF3D'] },
    { label: 'Complex', types: ['boxFrameSDF3D', 'linkSDF3D', 'pyramidSDF3D', 'hexPrismSDF3D', 'triPrismSDF3D', 'solidAngleSDF3D', 'sdCross3D'] },
    { label: 'Fields',  types: ['gyroidField', 'schwarzPField'] },
  ],
  '3D Transforms': [
    { label: 'Move',   types: ['translate3D', 'rotate3D', 'rotateAxis3D', 'scale3d'] },
    { label: 'Repeat', types: ['repeat3D', 'limitedRepeat3D', 'polarRepeat3D', 'mirroredRepeat3D', 'voxelize'] },
    { label: 'Warp',   types: ['twist3D', 'bend3D', 'sinWarp3D', 'displace3D', 'spiralWarp3D', 'domainWarp3D', 'turbulence3D', 'shear3D'] },
    { label: 'Fold',   types: ['fold3D', 'mirrorFold3D', 'kaleidoscope3D', 'sphereInvert3D', 'mobiusWarp3D', 'logPolarWarp3D', 'helixWarp3D'] },
  ],
  '3D Lighting': [
    { label: 'Shadow',  types: ['sdfAo', 'softShadow'] },
    { label: 'Surface', types: ['blinnPhong', 'fresnel3d', 'fakeSSS', 'materialSelect', 'multiLight'] },
    { label: 'Glass',   types: ['glass3d', 'fresnelSchlick', 'spectralDispersion'] },
    { label: 'Volume',  types: ['volumetricFog', 'phaseHG'] },
  ],
  Color: [
    { label: 'Build',   types: ['colorPicker', 'makeVec3'] },
    { label: 'Palette', types: ['palette', 'gradient', 'colorRamp', 'blackbody'] },
    { label: 'Adjust',  types: ['invert', 'colorSaturation', 'posterize', 'hueRange', 'brightnessContrast'] },
    { label: 'Convert', types: ['hsv', 'normalToColor'] },
    { label: 'Blend',   types: ['blendModes', 'oklabMix'] },
  ],
  Math: [
    { label: 'Arithmetic', types: ['add', 'subtract', 'multiply', 'divide'] },
    { label: 'Trig',       types: ['sin', 'cos', 'tan', 'atan2'] },
    { label: 'Rounding',   types: ['abs', 'negate', 'ceil', 'floor', 'round', 'fract', 'fractRaw'] },
    { label: 'Algebra',    types: ['pow', 'sqrt', 'exp', 'tanh'] },
    { label: 'Interp',     types: ['clamp', 'mix', 'smoothstep', 'mod', 'modSelect'] },
    { label: 'Compare',    types: ['minMath', 'max', 'step', 'sign'] },
    { label: 'Geometry',   types: ['length', 'dot', 'crossProduct', 'reflect', 'refractDir', 'luminance'] },
    { label: 'Vec2',       types: ['vec2Const', 'makeVec2', 'splitVec2', 'transformVec', 'normalizeVec2', 'angleToVec2', 'vec2Angle'] },
    { label: 'Vec3',       types: ['makeVec3', 'splitVec3', 'floatToVec3'] },
    { label: 'Vec4',       types: ['splitVec4'] },
    { label: 'Complex',    types: ['complexMul', 'complexPow'] },
    { label: 'Remap',      types: ['remap'] },
  ],
  Shapers: [
    { label: 'Ease',    types: ['expEase', 'circularEaseIn', 'circularEaseOut'] },
    { label: 'Seat',    types: ['doubleExpSeat', 'doubleCircleSeat'] },
    { label: 'Sigmoid', types: ['doubleExpSigmoid', 'logisticSigmoid', 'doubleCircleSigmoid', 'doubleEllipticSigmoid'] },
    { label: 'Bezier',  types: ['quadBezierShaper', 'cubicBezierShaper'] },
  ],
  Effects: [
    { label: 'Blur',     types: ['gaussianBlur', 'bloom', 'radialBlur', 'tiltShiftBlur', 'lensBlur', 'depthOfField'] },
    { label: 'Chroma',   types: ['chromaShift', 'chromaticAberrationAuto', 'chromaticAberration'] },
    { label: 'Lighting', types: ['light', 'glowToColor', 'light2d', 'radianceCascadesApprox'] },
    { label: 'Warp',     types: ['gravitationalLens', 'floatWarp'] },
    { label: 'Other',    types: ['particleEmitter'] },
  ],
  'Color Grading': [
    { label: 'Tone',  types: ['liftGammaGain', 'toneCurve', 'shadowsHighlights', 'toneMap'] },
    { label: 'Color', types: ['hueRotate', 'colorSaturation'] },
    { label: 'Film',  types: ['grain'] },
  ],
  SDF: [
    { label: 'Combine', types: ['sdfUnion', 'sdfIntersect', 'sdfSubtract'] },
    { label: 'Modify',  types: ['sdfOffset', 'sdfOnion', 'sdfSharpen'] },
    { label: 'Style',   types: ['sdfFill', 'sdfColorize'] },
  ],
  '2D Space': [
    { label: 'Basic',   types: ['uvTransform2d', 'rotate2d', 'shear', 'perspective2d', 'fract', 'displace'] },
    { label: 'Repeat',  types: ['infiniteRepeatSpace', 'limitedRepeat2D', 'mirroredRepeat2D', 'angularRepeat2D', 'kaleidoSpace', 'grid'] },
    { label: 'Warp',    types: ['uvWarp', 'smoothWarp', 'curlWarp', 'swirlWarp', 'swirlSpace', 'rippleSpace', 'sphericalSpace', 'lensDistortion', 'crtScreen', 'turbulence', 'uvReciprocal', 'gravityField', 'spiralField', 'vectorField'] },
    { label: 'Map',     types: ['polarSpace', 'logPolarSpace', 'hyperbolicSpace', 'inversionSpace', 'mobiusSpace'] },
    { label: 'Pattern', types: ['waveTexture', 'magicTexture', 'chaosLayers'] },
  ],
  Combiners: [
    { label: 'Blend',   types: ['mix', 'blendModes', 'mask', 'addColor', 'alphaBlend'] },
    { label: 'Layer',   types: ['glowLayer', 'deepGlow'] },
  ],
  Grid: [
    { label: 'Layout',   types: ['gridLayout'] },
    { label: 'Motion',   types: ['waveRadius', 'animatedCellCenter'] },
    { label: 'Displace', types: ['neighborDist', 'cellDisplace', 'neighborAttractCircles'] },
    { label: 'Filter',   types: ['cellFilter', 'neighborOffset2d'] },
    { label: 'Warp',     types: ['gridDensityWarp'] },
  ],
  Field: [
    { label: 'Gaussian',  types: ['gaussianField', 'fieldAccumulate'] },
    { label: 'Noisy SDF', types: ['noisyGridSDF'] },
    { label: 'Threshold', types: ['metaballThreshold'] },
    { label: 'Falloff',   types: ['distanceFalloff', 'glowFalloff'] },
  ],
};

// ── GLSL source extractor ─────────────────────────────────────────────────────
function getNodeGLSLSource(type: string): string {
  const def = getNodeDefinition(type);
  if (!def) return '// No definition found';
  const dummyNode: GraphNode = {
    id: 'preview',
    type,
    position: { x: 0, y: 0 },
    params: { ...(def.defaultParams ?? {}) },
    inputs: def.inputs ? Object.fromEntries(Object.entries(def.inputs).map(([k, v]) => [k, { ...v }])) : {},
    outputs: def.outputs ? Object.fromEntries(Object.entries(def.outputs).map(([k, v]) => [k, { ...v }])) : {},
  };
  const inputVars: Record<string, string> = {};
  for (const key of Object.keys(def.inputs ?? {})) inputVars[key] = key;
  const parts: string[] = [];
  const fns = def.glslFunctions ?? (def.glslFunction ? [def.glslFunction] : []);
  if (fns.length) parts.push(fns.join('\n\n').trim());
  try {
    const { code } = def.generateGLSL(dummyNode, inputVars);
    if (code.trim()) parts.push(code.trim());
  } catch { parts.push('// Error generating code'); }
  return parts.join('\n\n') || '// No GLSL source';
}

// ── Synthetic node for preview ────────────────────────────────────────────────
function makeSyntheticNode(type: string): GraphNode {
  const def = getNodeDefinition(type);
  return {
    id: '__palette_preview__',
    type,
    position: { x: 0, y: 0 },
    inputs: def
      ? Object.fromEntries(Object.entries(def.inputs).map(([k, v]) => [k, { ...v, connection: undefined }]))
      : {},
    outputs: def
      ? Object.fromEntries(Object.entries(def.outputs).map(([k, v]) => [k, { ...v }]))
      : {},
    params: {},
  };
}

// ── GLSL source popup (GLSL page) ─────────────────────────────────────────────
function GlslSourcePopup({ type, anchorRef, onInsert, onClose }: {
  type: string;
  anchorRef: React.RefObject<HTMLElement | null>;
  onInsert?: (code: string) => void;
  onClose: () => void;
}) {
  const tk = useTokens();
  const def = getNodeDefinition(type);
  const source = getNodeGLSLSource(type);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const copyToClipboard = () => {
    navigator.clipboard.writeText(source).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }, () => { /* clipboard blocked; the source is still selectable */ });
  };

  // Anchored to the right edge of the palette.
  const anchor = anchorRef.current?.getBoundingClientRect();
  const left = anchor ? anchor.right + 8 : 220;
  const top = anchor ? Math.max(48, anchor.top) : 48;

  return createPortal(
    <div
      style={{
        position: 'fixed', left, top, width: 380, maxHeight: 'calc(100vh - 64px)', zIndex: 500, overflow: 'hidden',
        display: 'flex', flexDirection: 'column', background: tk.bg.panel, borderRadius: radius.lg, boxShadow: tk.shadow.popover,
        font: `12.5px ${fontFamily.ui}`, color: tk.text.primary,
      }}
      onMouseDown={e => e.stopPropagation()}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 10px 10px 14px', borderBottom: `1px solid ${tk.border.subtle}`, flexShrink: 0 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{def?.label ?? type}</div>
          {def?.description && <div style={{ fontSize: 12, color: tk.text.muted, marginTop: 2, lineHeight: 1.45 }}>{def.description}</div>}
        </div>
        <CategoryChip>{def?.category}</CategoryChip>
        <IconButton icon="close" label="Close" size="sm" onClick={onClose} />
      </div>
      <pre style={{
        flex: 1, minHeight: 0, margin: 0, padding: '12px 14px', overflow: 'auto', whiteSpace: 'pre',
        background: tk.bg.subtle, color: tk.text.secondary, font: `11.5px/1.6 ${fontFamily.mono}`,
      }}>{source}</pre>
      <div style={{ display: 'flex', gap: 6, padding: '10px 14px', borderTop: `1px solid ${tk.border.subtle}`, flexShrink: 0 }}>
        <Button size="sm" variant="primary" icon="code" style={{ flex: 1 }} onClick={() => { onInsert?.(source); onClose(); }}>Insert at cursor</Button>
        <Button size="sm" icon={copied ? 'check' : 'copy'} onClick={copyToClipboard}>{copied ? 'Copied' : 'Copy'}</Button>
      </div>
    </div>,
    document.body
  );
}

function CategoryChip({ children }: { children: ReactNode }) {
  const tk = useTokens();
  return (
    <span style={{ font: `500 10.5px ${fontFamily.mono}`, color: tk.text.muted, background: tk.bg.hover, borderRadius: radius.sm, padding: '2px 6px', flexShrink: 0, whiteSpace: 'nowrap' }}>
      {children}
    </span>
  );
}

// ── Preview card ──────────────────────────────────────────────────────────────
function NodePreviewCard({ type, onAdd, isFavorite, onToggleFavorite, context, onGlslInsert, swapMode, onDismiss }: {
  type: string; onAdd: () => void;
  isFavorite: boolean; onToggleFavorite: () => void;
  context?: 'studio' | 'glsl';
  onGlslInsert?: (code: string) => void;
  swapMode: boolean;
  /** Close the preview (after the previewed type was deleted). */
  onDismiss?: () => void;
}) {
  const tk = useTokens();
  const def = getNodeDefinition(type);
  // User-published node types can be re-opened for editing or deleted from here.
  const userNode = getUserNode(type);
  const deleteUserNode = useNodeGraphStore(s => s.deleteUserNode);
  const openUserNodeSource = useNodeGraphStore(s => s.openUserNodeSource);
  const exportUserNodes = useNodeGraphStore(s => s.exportUserNodes);
  const node = makeSyntheticNode(type);
  const hasViz = INLINE_VIZ_TYPES.has(type);
  const isGlsl = context === 'glsl';
  const glslSource = isGlsl ? getNodeGLSLSource(type) : null;

  return (
    <div style={{ marginTop: 8, padding: 10, display: 'flex', flexDirection: 'column', gap: 8, border: `1px solid ${tk.border.default}`, borderRadius: radius.lg, background: tk.bg.panel }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ flex: 1, minWidth: 0, fontWeight: 600, fontSize: 13, color: tk.text.primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{def?.label ?? type}</span>
        <IconButton
          icon={isFavorite ? 'starF' : 'star'}
          label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
          size="sm"
          style={isFavorite ? { color: tk.status.warning } : undefined}
          onMouseDown={e => { e.preventDefault(); e.stopPropagation(); onToggleFavorite(); }}
        />
        <CategoryChip>{def?.category}</CategoryChip>
      </div>

      {isGlsl ? (
        <pre style={{
          margin: 0, padding: '6px 8px', maxHeight: 110, overflow: 'auto', whiteSpace: 'pre-wrap', borderRadius: radius.md - 1,
          background: tk.bg.field, color: tk.text.secondary, font: `11.5px/1.55 ${fontFamily.mono}`,
        }}>{glslSource}</pre>
      ) : hasViz ? (
        // The thumbnail is a render surface, so it keeps its own dark look in both themes.
        <div style={{ borderRadius: radius.md, overflow: 'hidden' }}><NodeInlineViz node={node} /></div>
      ) : null}
      {!isGlsl && def?.description && (
        <DocText text={Array.isArray(def.description) ? (def.description as string[]).join('\n') : def.description} style={{ fontSize: 12, color: tk.text.muted }} />
      )}
      {!isGlsl && userNode && (() => {
        const rows = [
          ...userNode.inputs.map(i => ({ kind: 'in', label: i.label, type: i.type, hint: i.hint })),
          ...userNode.params.map(p => ({ kind: 'param', label: p.label, type: `${p.min} – ${p.max}`, hint: p.hint })),
          ...(userNode.iterations ? [{ kind: 'param', label: userNode.iterations.label, type: `${userNode.iterations.min} – ${userNode.iterations.max} passes`, hint: undefined as string | undefined }] : []),
          ...userNode.outputs.map(o => ({ kind: 'out', label: o.label, type: o.type, hint: o.hint })),
        ];
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '6px 8px', borderRadius: radius.md, background: tk.bg.subtle, fontSize: 11.5 }}>
            {rows.map((r, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <span style={{ color: tk.text.faint, fontSize: 10, width: 34, flexShrink: 0, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{r.kind}</span>
                <span style={{ fontFamily: fontFamily.mono, color: tk.text.primary }}>{r.label}</span>
                <span style={{ fontFamily: fontFamily.mono, color: tk.text.faint }}>{r.type}</span>
                {r.hint && <DocText text={r.hint} style={{ color: tk.text.muted, flexBasis: '100%', paddingLeft: 40, fontSize: 11.5 }} />}
              </div>
            ))}
          </div>
        );
      })()}

      {isGlsl ? (
        <Button size="sm" variant="primary" icon="code" onClick={() => { if (glslSource) onGlslInsert?.(glslSource); }}>Insert at cursor</Button>
      ) : (
        <Button size="sm" variant="primary" icon="plus" onClick={onAdd}>{swapMode ? 'Replace with this' : 'Add to graph'}</Button>
      )}
      {userNode && !isGlsl && (
        <div style={{ display: 'flex', gap: 6, paddingTop: 6, borderTop: `1px solid ${tk.border.subtle}` }}>
          {userNode.source && (
            <Button size="sm" icon="layoutGraph" style={{ flex: 1 }} title="Place the node's source graph as a group; publish it again to update this node type"
              onClick={() => openUserNodeSource(userNode.id, { x: 200 + Math.random() * 120, y: 120 + Math.random() * 200 })}>
              Open source graph
            </Button>
          )}
          <Button size="sm" icon="export" title="Save this node type as a .json file you can share or import into another project"
            onClick={() => exportUserNodes([userNode.id])}>
            Export
          </Button>
          <Button size="sm" variant="danger" icon="trash" title="Delete this node type. Placed instances stop compiling."
            onClick={() => {
              if (window.confirm(`Delete node type “${userNode.label}”?\n\nAny placed instances will stop compiling until they're removed.`)) {
                deleteUserNode(userNode.id);
                onDismiss?.();
              }
            }}>
            Delete node type
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Node pill ─────────────────────────────────────────────────────────────────
function NodePill({
  type, label, description,
  isSelected, isHighlighted,
  onSingleClick, onDoubleClick,
  swapMode, btnRef,
}: {
  type: string; label: string; description?: string;
  isSelected: boolean; isHighlighted: boolean;
  onSingleClick: () => void; onDoubleClick: () => void;
  swapMode: boolean;
  btnRef?: (el: HTMLButtonElement | null) => void;
}) {
  const tk = useTokens();
  const [hovered, setHovered] = useState(false);
  const on = isSelected || isHighlighted;
  return (
    <button
      ref={btnRef}
      title={description ?? `Click to preview · Double-click to ${swapMode ? 'replace' : 'add'}`}
      draggable={!swapMode}
      onDragStart={e => {
        e.dataTransfer.setData('application/shader-studio-node', type);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      onClick={onSingleClick}
      onDoubleClick={onDoubleClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        height: 28, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0 10px', border: 0, borderRadius: radius.md,
        background: on ? tk.bg.selected : hovered ? tk.bg.hover : tk.bg.field,
        boxShadow: on ? `inset 0 0 0 1.5px ${tk.accent.base}` : 'none',
        color: on ? tk.accent.text : tk.text.secondary, font: `${on ? 600 : 500} 12.5px ${fontFamily.ui}`,
        cursor: swapMode ? 'pointer' : 'grab', userSelect: 'none', whiteSpace: 'nowrap',
        transition: 'background 0.12s, box-shadow 0.12s',
      }}
    >
      {label}
    </button>
  );
}

// ── Caps labels ───────────────────────────────────────────────────────────────
function CapsLabel({ children, rule = false }: { children: ReactNode; rule?: boolean }) {
  const tk = useTokens();
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 2px 4px' }}>
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: tk.text.faint }}>{children}</span>
      {rule && <span style={{ flex: 1, height: 1, background: tk.border.subtle }} />}
    </div>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────
interface NodeBrowserProps {
  onAdd: (type: string) => void;
  swapTargetNodeId: string | null;
  favorites: string[];
  onToggleFavorite: (type: string) => void;
  nodeButtonRefs: React.MutableRefObject<Map<string, HTMLButtonElement>>;
  searchQuery: string;
  context?: 'studio' | 'glsl';
  onGlslInsert?: (code: string) => void;
}

// ── Main component ────────────────────────────────────────────────────────────
export function NodeBrowser({
  onAdd, swapTargetNodeId, favorites, onToggleFavorite, nodeButtonRefs, searchQuery,
  context, onGlslInsert,
}: NodeBrowserProps) {
  const tk = useTokens();
  const [path, setPath] = useState<string[]>([]);
  const [previewType, setPreviewType] = useState<string | null>(null);
  const [highlightType, setHighlightType] = useState<string | null>(null);
  const [glslPopupType, setGlslPopupType] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isGlsl = context === 'glsl';

  const isSearching = searchQuery.trim().length > 0;

  useUserNodesVersion(); // re-render when a node type is published or deleted
  const allCats = getAllCategories();
  const categories = [
    ...CATEGORY_ORDER.filter(c => allCats.includes(c)),
    ...allCats.filter(c => !CATEGORY_ORDER.includes(c)).sort(),
  ];

  useEffect(() => {
    const handler = (e: Event) => {
      const { nodeType } = (e as CustomEvent<{ nodeType: string }>).detail;
      const def = getNodeDefinition(nodeType);
      if (!def) return;
      setPath([def.category]);
      setPreviewType(nodeType);
      setHighlightType(nodeType);
      setTimeout(() => {
        const btn = nodeButtonRefs.current.get(nodeType);
        btn?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        setTimeout(() => setHighlightType(null), 2000);
      }, 80);
    };
    window.addEventListener('palette-navigate', handler);
    return () => window.removeEventListener('palette-navigate', handler);
  }, [nodeButtonRefs]);

  const handleNodeClick = useCallback((type: string) => {
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
    if (isGlsl) {
      setGlslPopupType(prev => prev === type ? null : type);
      return;
    }
    clickTimerRef.current = setTimeout(() => {
      setPreviewType(prev => prev === type ? null : type);
      clickTimerRef.current = null;
    }, 220);
  }, [isGlsl]);

  const handleNodeDblClick = useCallback((type: string) => {
    if (clickTimerRef.current) { clearTimeout(clickTimerRef.current); clickTimerRef.current = null; }
    if (isGlsl) {
      const src = getNodeGLSLSource(type);
      onGlslInsert?.(src);
      setGlslPopupType(null);
      return;
    }
    onAdd(type);
    setPreviewType(null);
  }, [isGlsl, onAdd, onGlslInsert]);

  // A wrap of node pills, with the preview card for the selected one underneath.
  const renderPills = (nodes: Array<{ type: string; label: string; description?: string }>) => (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {nodes.map(def => (
          <NodePill
            key={def.type}
            type={def.type} label={def.label} description={def.description}
            isSelected={previewType === def.type}
            isHighlighted={highlightType === def.type}
            onSingleClick={() => handleNodeClick(def.type)}
            onDoubleClick={() => handleNodeDblClick(def.type)}
            swapMode={!!swapTargetNodeId}
            btnRef={el => { if (el) nodeButtonRefs.current.set(def.type, el); else nodeButtonRefs.current.delete(def.type); }}
          />
        ))}
      </div>
      {previewType && nodes.some(d => d.type === previewType) && (
        <NodePreviewCard
          type={previewType}
          onAdd={() => handleNodeDblClick(previewType)}
          isFavorite={favorites.includes(previewType)}
          onToggleFavorite={() => onToggleFavorite(previewType)}
          context={context}
          onGlslInsert={onGlslInsert}
          swapMode={!!swapTargetNodeId}
          onDismiss={() => setPreviewType(null)}
        />
      )}
    </>
  );

  const crumb = (label: ReactNode, count: number) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
      <IconButton icon="chevL" label="Back to categories" size="sm" onClick={() => { setPath([]); setPreviewType(null); }}
        style={{ background: tk.bg.hover, color: tk.text.secondary }} />
      <span style={{ flex: 1, minWidth: 0, fontWeight: 600, fontSize: 12.5, color: tk.text.primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      <Count n={count} />
    </div>
  );

  // ── Compute content ────────────────────────────────────────────────────────
  let innerContent: React.ReactNode;

  if (isSearching) {
    const trimmed = searchQuery.trim().toLowerCase();
    const results = getOfferedDefinitions()
      .filter(def => !HIDDEN_NODES.has(def.type))
      .map(def => ({ def, score: scoreNodeDef(def, trimmed) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score || a.def.label.localeCompare(b.def.label))
      .map(({ def }) => def);
    innerContent = results.length === 0
      ? <div style={{ color: tk.text.faint, fontSize: 12, padding: '4px 2px' }}>No matches</div>
      : <div>{renderPills(results)}</div>;

  } else if (path.length === 0) {
    const favCount = favorites.filter(t => getNodeDefinition(t) && !HIDDEN_NODES.has(t)).length;
    innerContent = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {favCount > 0 && (
          <CategoryRow
            key="__favorites__"
            cat="Favorites"
            icon={<Icon name="starF" size={14} style={{ color: tk.status.warning }} />}
            count={favCount}
            onClick={() => { setPath(['__favorites__']); setPreviewType(null); }}
          />
        )}
        {CATEGORY_SECTIONS.map(section => {
          const sectionCats = section.categories.filter(cat => getNodesByCategory(cat).some(d => !HIDDEN_NODES.has(d.type)));
          if (sectionCats.length === 0) return null;
          return (
            <div key={section.label}>
              <CapsLabel rule>{section.label}</CapsLabel>
              {sectionCats.map(cat => (
                <CategoryRow
                  key={cat}
                  cat={cat}
                  count={getNodesByCategory(cat).filter(d => !HIDDEN_NODES.has(d.type)).length}
                  onClick={() => { setPath([cat]); setPreviewType(null); }}
                />
              ))}
            </div>
          );
        })}
        {/* Any categories not covered by sections */}
        {categories.filter(cat => !CATEGORY_ORDER.includes(cat)).map(cat => {
          const n = getNodesByCategory(cat).filter(d => !HIDDEN_NODES.has(d.type)).length;
          if (n === 0) return null;
          return (
            <CategoryRow
              key={cat}
              cat={cat}
              count={n}
              onClick={() => { setPath([cat]); setPreviewType(null); }}
            />
          );
        })}
      </div>
    );

  } else if (path[0] === '__favorites__') {
    const favDefs = favorites
      .map(t => getNodeDefinition(t))
      .filter((d): d is NonNullable<typeof d> => !!d && !HIDDEN_NODES.has(d.type));
    innerContent = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {crumb('Favorites', favDefs.length)}
        {favDefs.length === 0
          ? <div style={{ color: tk.text.faint, fontSize: 12 }}>No favorites yet</div>
          : renderPills(favDefs)}
      </div>
    );

  } else {
    const cat = path[0];
    const rawNodes = getNodesByCategory(cat).filter(d => !HIDDEN_NODES.has(d.type));
    const groups = CATEGORY_GROUPS[cat];
    innerContent = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {crumb(cat, rawNodes.length)}
        {groups ? (
          groups.map(group => {
            const groupNodes = rawNodes.filter(d => group.types.includes(d.type));
            if (groupNodes.length === 0) return null;
            return (
              <div key={group.label}>
                <CapsLabel>{group.label}</CapsLabel>
                {renderPills(groupNodes)}
              </div>
            );
          })
        ) : (
          <div style={{ marginTop: 4 }}>{renderPills([...rawNodes].sort((a, b) => a.label.localeCompare(b.label)))}</div>
        )}
      </div>
    );
  }

  return (
    <>
      <div ref={containerRef}>{innerContent}</div>
      {isGlsl && glslPopupType && (
        <GlslSourcePopup
          type={glslPopupType}
          anchorRef={containerRef}
          onInsert={onGlslInsert}
          onClose={() => setGlslPopupType(null)}
        />
      )}
    </>
  );
}

function Count({ n }: { n: number }) {
  const tk = useTokens();
  return <span style={{ fontSize: 11, color: tk.text.faint, background: tk.bg.hover, borderRadius: radius.sm, padding: '1px 6px', fontVariantNumeric: 'tabular-nums' }}>{n}</span>;
}

// ── Category row ──────────────────────────────────────────────────────────────
function CategoryRow({ cat, icon, count, onClick }: {
  cat: string; icon?: ReactNode; count: number; onClick: () => void;
}) {
  const tk = useTokens();
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: '100%', height: 30, display: 'flex', alignItems: 'center', gap: 8, padding: '0 6px 0 8px', border: 0,
        borderRadius: radius.md, background: hovered ? tk.bg.hover : 'transparent', cursor: 'pointer', textAlign: 'left',
        color: tk.text.secondary, font: `12.5px ${fontFamily.ui}`,
      }}
    >
      {icon && <span style={{ width: 14, display: 'flex', justifyContent: 'center', flexShrink: 0 }}>{icon}</span>}
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cat}</span>
      <Count n={count} />
      <Icon name="chevR" size={14} style={{ color: tk.text.disabled }} />
    </button>
  );
}
