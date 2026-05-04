import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { getAllCategories, getNodesByCategory, NODE_REGISTRY, getNodeDefinition } from '../../nodes/definitions';
import { NodeInlineViz, INLINE_VIZ_TYPES } from './NodeInlineViz';
import { getAssetTags, saveAssetTags } from '../../utils/assetTags';
import type { GraphNode } from '../../types/nodeGraph';

// ── Nodes hidden from browser ─────────────────────────────────────────────────
const HIDDEN_NODES = new Set([
  'output', 'vec4Output', 'loopIndex', 'loopStart', 'loopEnd',
  'groupOutput', 'groupInput', 'marchLoopInputs', 'marchLoopOutput', 'scope',
  'forLoop', 'loopRippleStep', 'loopRotateStep', 'loopDomainFold',
  'loopFloatAccumulate', 'loopColorRingStep', 'loopRingStep',
  'lumaGrain', 'temporalGrain', 'forwardCamera',
  'marchPos', 'marchDist', 'marchOutput',
  'scenePos', 'sceneOutput', 'spaceWarpGroup',
  'rotatingLinesLoop', 'accumulateLoop', 'flowField', 'circlePack',
  'raymarch3d', 'volumeClouds', 'rayMarch', 'loopCarry', 'loop',
]);

// ── Category colors ───────────────────────────────────────────────────────────
const CATEGORY_COLORS: Record<string, string> = {
  Sources:          '#89b4fa',
  Transforms:       '#a6e3a1',
  Math:             '#b4befe',
  Color:            '#fab387',
  'Color Grading':  '#f9a86b',
  Noise:            '#74c7ec',
  Effects:          '#f38ba8',
  'Post Processing': '#f38ba8',
  Loops:            '#89dceb',
  '2D Primitives':  '#f9e2af',
  Combiners:        '#cba6f7',
  Spaces:           '#f2cdcd',
  Shapers:          '#f9e2af',
  Science:          '#94e2d5',
  Fractals:         '#cba6f7',
  Output:           '#6c7086',
  '3D Primitives':  '#f5c2e7',
  '3D Transforms':  '#f5c2e7',
  '3D Scene':       '#cc88aa',
  '3D Boolean Ops': '#89dceb',
  '3D Fractals':    '#f5c2e7',
  '3D Lighting':    '#f9c468',
  Animation:        '#b4befe',
  Conditionals:     '#f2cdcd',
  Utility:          '#6c7086',
  Matrix:           '#f5c842',
  Halftone:         '#a6e3d5',
  Particles:        '#f9e2af',
  'Particles & Fields': '#f9e2af',
};

const CATEGORY_SECTIONS: Array<{ label: string; categories: string[] }> = [
  { label: 'Shapes',       categories: ['2D Primitives', '3D Primitives', '3D Boolean Ops', '3D Transforms', 'Combiners'] },
  { label: '3D',           categories: ['3D Scene', '3D Lighting', '3D Fractals', 'Loops'] },
  { label: 'Color & Post', categories: ['Color', 'Color Grading', 'Post Processing', 'Effects'] },
  { label: 'Generators',   categories: ['Noise', 'Halftone', 'Fractals', 'Science', 'Particles', 'Particles & Fields', 'Spaces'] },
  { label: 'Math & Logic', categories: ['Sources', 'Animation', 'Math', 'Matrix', 'Shapers', 'Transforms', 'Conditionals'] },
  { label: 'Utility',      categories: ['Utility', 'Output'] },
];

const CATEGORY_ORDER = CATEGORY_SECTIONS.flatMap(s => s.categories);

// ── Sub-group definitions for categories that need them ───────────────────────
const CATEGORY_GROUPS: Record<string, Array<{ label: string; types: string[] }>> = {
  '2D Primitives': [
    { label: 'SDF',      types: ['circleSDF', 'boxSDF', 'ringSDF', 'simpleSDF', 'shapeSDF', 'sdBox', 'sdSegment', 'sdEllipse'] },
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
    { label: 'Repeat', types: ['repeat3D', 'limitedRepeat3D', 'polarRepeat3D', 'mirroredRepeat3D'] },
    { label: 'Warp',   types: ['twist3D', 'bend3D', 'sinWarp3D', 'displace3D', 'spiralWarp3D', 'domainWarp3D', 'shear3D'] },
    { label: 'Fold',   types: ['fold3D', 'mirrorFold3D', 'kaleidoscope3D', 'sphereInvert3D', 'mobiusWarp3D', 'logPolarWarp3D', 'helixWarp3D'] },
  ],
  '3D Lighting': [
    { label: 'Shadow',  types: ['sdfAo', 'softShadow'] },
    { label: 'Surface', types: ['blinnPhong', 'fresnel3d', 'fakeSSS', 'materialSelect', 'multiLight'] },
    { label: 'Glass',   types: ['glass3d', 'fresnelSchlick', 'spectralDispersion'] },
    { label: 'Volume',  types: ['volumetricFog', 'phaseHG'] },
  ],
  Color: [
    { label: 'Palette', types: ['palette', 'gradient', 'palettePreset', 'colorRamp', 'blackbody'] },
    { label: 'Adjust',  types: ['invert', 'desaturate', 'posterize', 'hueRange', 'brightnessContrast'] },
    { label: 'Convert', types: ['hsv'] },
    { label: 'Blend',   types: ['blendModes'] },
  ],
  Math: [
    { label: 'Arithmetic', types: ['add', 'subtract', 'multiply', 'divide'] },
    { label: 'Trig',       types: ['sin', 'cos', 'tan', 'atan2'] },
    { label: 'Rounding',   types: ['abs', 'negate', 'ceil', 'floor', 'round', 'fract'] },
    { label: 'Algebra',    types: ['pow', 'sqrt', 'exp', 'tanh'] },
    { label: 'Interp',     types: ['clamp', 'mix', 'mixVec3', 'smoothstep', 'mod'] },
    { label: 'Compare',    types: ['minMath', 'max', 'step', 'sign'] },
    { label: 'Geometry',   types: ['length', 'dot', 'crossProduct', 'reflect', 'luminance'] },
    { label: 'Vec2',       types: ['vec2Const', 'makeVec2', 'splitVec2', 'transformVec', 'extractX', 'extractY', 'addVec2', 'multiplyVec2', 'normalizeVec2', 'angleToVec2', 'vec2Angle'] },
    { label: 'Vec3',       types: ['vec3Const', 'makeVec3', 'splitVec3', 'floatToVec3', 'multiplyVec3', 'addVec3'] },
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
    { label: 'Blur',     types: ['gaussianBlur', 'radialBlur', 'tiltShiftBlur', 'lensBlur', 'depthOfField'] },
    { label: 'Chroma',   types: ['chromaShift', 'chromaticAberrationAuto', 'chromaticAberration'] },
    { label: 'Lighting', types: ['makeLight', 'light', 'light2d', 'radianceCascadesApprox'] },
    { label: 'Warp',     types: ['gravitationalLens', 'floatWarp'] },
    { label: 'Other',    types: ['particleEmitter'] },
  ],
  'Color Grading': [
    { label: 'Tone',  types: ['liftGammaGain', 'toneCurve', 'shadowsHighlights', 'toneMap'] },
    { label: 'Color', types: ['hueRotate', 'colorSaturation'] },
    { label: 'Film',  types: ['grain'] },
  ],
  Combiners: [
    { label: 'SDF Ops', types: ['smoothMin', 'min', 'sdfMax', 'sdfSubtract', 'smoothMax', 'smoothSubtract', 'sdfOutline', 'sdfColorize'] },
    { label: 'Blend',   types: ['blend', 'mask', 'addColor', 'screenBlend', 'alphaBlend'] },
    { label: 'Layer',   types: ['glowLayer'] },
  ],
  Spaces: [
    { label: 'Warp',       types: ['displace', 'uvWarp', 'smoothWarp', 'curlWarp', 'swirlWarp'] },
    { label: 'Repeat',     types: ['fract', 'infiniteRepeatSpace', 'mirroredRepeat2D', 'limitedRepeat2D', 'angularRepeat2D'] },
    { label: 'Distort',    types: ['polarSpace', 'logPolarSpace', 'hyperbolicSpace', 'inversionSpace', 'mobiusSpace', 'swirlSpace', 'kaleidoSpace', 'sphericalSpace', 'rippleSpace', 'perspective2d', 'shear'] },
    { label: 'Texture',    types: ['waveTexture', 'magicTexture', 'grid'] },
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

// ── GLSL source popup ─────────────────────────────────────────────────────────
function GlslSourcePopup({ type, anchorRef, onInsert, onClose }: {
  type: string;
  anchorRef: React.RefObject<HTMLElement | null>;
  onInsert?: (code: string) => void;
  onClose: () => void;
}) {
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
    });
  };

  // Position: anchored to right edge of the anchor element (the palette)
  const anchor = anchorRef.current?.getBoundingClientRect();
  const left = anchor ? anchor.right + 8 : 220;
  const top = anchor ? Math.max(48, anchor.top) : 48;

  return createPortal(
    <div
      style={{
        position: 'fixed', left, top,
        width: '380px', maxHeight: 'calc(100vh - 64px)',
        background: '#1e1e2e', border: '1px solid #45475a',
        borderRadius: '10px', boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
        display: 'flex', flexDirection: 'column',
        zIndex: 500, overflow: 'hidden',
      }}
      onMouseDown={e => e.stopPropagation()}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 14px', borderBottom: '1px solid #313244', flexShrink: 0 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: '#cdd6f4', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {def?.label ?? type}
          </div>
          {def?.description && (
            <div style={{ fontSize: '10px', color: '#6c7086', marginTop: '2px', lineHeight: 1.4 }}>{def.description}</div>
          )}
        </div>
        <span style={{ fontSize: '9px', padding: '2px 6px', borderRadius: '10px', background: '#313244', color: '#6c7086', fontFamily: 'monospace', flexShrink: 0 }}>
          {def?.category}
        </span>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', color: '#585b70', cursor: 'pointer', fontSize: '14px', lineHeight: 1, padding: '0 2px', flexShrink: 0 }}
          onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.color = '#cdd6f4')}
          onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.color = '#585b70')}
        >✕</button>
      </div>

      {/* GLSL source */}
      <pre style={{
        flex: 1, margin: 0, padding: '12px 14px',
        background: '#11111b', overflowY: 'auto', overflowX: 'auto',
        fontSize: '11px', lineHeight: 1.6,
        color: '#a6adc8', fontFamily: "'Fira Code', 'JetBrains Mono', monospace",
        whiteSpace: 'pre', minHeight: 0,
      }}>
        {source}
      </pre>

      {/* Footer actions */}
      <div style={{ display: 'flex', gap: '6px', padding: '10px 14px', borderTop: '1px solid #313244', flexShrink: 0 }}>
        <button
          onClick={() => { onInsert?.(source); onClose(); }}
          title="Insert GLSL at cursor position"
          style={{
            flex: 1, padding: '5px 10px',
            background: '#89b4fa18', border: '1px solid #89b4fa44',
            borderRadius: '6px', color: '#89b4fa', fontSize: '11px',
            cursor: 'pointer', fontFamily: 'monospace', fontWeight: 500,
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#89b4fa28'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = '#89b4fa18'; }}
        >
          ⌥ Insert at cursor
        </button>
        <button
          onClick={copyToClipboard}
          style={{
            padding: '5px 12px',
            background: copied ? '#a6e3a118' : '#313244',
            border: `1px solid ${copied ? '#a6e3a144' : '#45475a'}`,
            borderRadius: '6px',
            color: copied ? '#a6e3a1' : '#cdd6f4',
            fontSize: '11px', cursor: 'pointer',
            transition: 'background 0.15s, color 0.15s, border-color 0.15s',
          }}
        >
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>
    </div>,
    document.body
  );
}

// ── Preview card ──────────────────────────────────────────────────────────────
function NodePreviewCard({ type, onAdd, isFavorite, onToggleFavorite, context, onGlslInsert }: {
  type: string; onAdd: () => void;
  isFavorite: boolean; onToggleFavorite: () => void;
  context?: 'studio' | 'glsl';
  onGlslInsert?: (code: string) => void;
}) {
  const def = getNodeDefinition(type);
  const node = makeSyntheticNode(type);
  const hasViz = INLINE_VIZ_TYPES.has(type);
  const [editingTags, setEditingTags] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [copied, setCopied] = useState(false);
  const currentTags = getAssetTags('nodes', type);
  const isGlsl = context === 'glsl';
  const glslSource = isGlsl ? getNodeGLSLSource(type) : null;

  const handleSaveTags = () => {
    const tags = tagInput.split(',').map(t => t.trim()).filter(Boolean);
    saveAssetTags('nodes', type, tags);
    setEditingTags(false);
  };

  return (
    <div style={{
      background: '#181825',
      border: '1px solid #313244',
      borderRadius: '8px',
      padding: '8px',
      marginTop: '6px',
      marginBottom: '2px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: hasViz ? '6px' : '4px' }}>
        <span style={{ fontSize: '12px', fontWeight: 600, color: '#cdd6f4', flex: 1 }}>{def?.label ?? type}</span>
        <button
          onMouseDown={e => { e.preventDefault(); e.stopPropagation(); onToggleFavorite(); }}
          title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            padding: '1px 4px', lineHeight: 1, fontSize: '13px',
            color: isFavorite ? '#f9e2af' : '#45475a',
            transition: 'color 0.1s',
          }}
          onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.color = isFavorite ? '#fab387' : '#cdd6f4')}
          onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.color = isFavorite ? '#f9e2af' : '#45475a')}
        >★</button>
        <span style={{
          fontSize: '9px', padding: '1px 5px', borderRadius: '10px',
          background: '#313244', color: '#6c7086', fontFamily: 'monospace',
        }}>{def?.category}</span>
      </div>

      {isGlsl ? (
        <pre
          onDoubleClick={() => {
            if (glslSource) {
              navigator.clipboard.writeText(glslSource).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); });
            }
          }}
          title="Double-click to copy"
          style={{
            margin: '0 0 6px', padding: '6px 8px',
            background: '#11111b', border: '1px solid #252535',
            borderRadius: '5px', fontSize: '9px', lineHeight: 1.6,
            color: '#a6adc8', fontFamily: "'Fira Code', monospace",
            overflowX: 'auto', overflowY: 'auto', maxHeight: '90px',
            whiteSpace: 'pre', cursor: 'text',
          }}
        >{glslSource}</pre>
      ) : hasViz ? (
        <NodeInlineViz node={node} />
      ) : def?.description ? (
        <p style={{ fontSize: '10px', color: '#6c7086', margin: '0 0 6px', lineHeight: 1.5 }}>
          {def.description}
        </p>
      ) : null}

      {/* Existing tags */}
      {currentTags.length > 0 && !editingTags && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', marginTop: '5px', marginBottom: '2px' }}>
          {currentTags.map(t => (
            <span key={t} style={{ fontSize: '9px', padding: '1px 6px', background: '#89b4fa22', color: '#89b4fa', borderRadius: '10px' }}>#{t}</span>
          ))}
        </div>
      )}

      {/* Inline tag editor */}
      {editingTags && (
        <div style={{ marginTop: '5px', marginBottom: '2px' }}>
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
            placeholder="tag1, tag2, tag3…"
            style={{ width: '100%', background: '#11111b', border: '1px solid #45475a', color: '#cdd6f4', borderRadius: '4px', padding: '3px 7px', fontSize: '11px', outline: 'none', boxSizing: 'border-box' }}
          />
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: '4px', marginTop: '6px' }}>
        {isGlsl ? (
          <button
            onClick={() => { if (glslSource) onGlslInsert?.(glslSource); }}
            title="Insert GLSL at cursor"
            style={{
              flex: 1, padding: '3px 6px',
              background: copied ? '#a6e3a118' : '#89b4fa18',
              border: `1px solid ${copied ? '#a6e3a144' : '#89b4fa44'}`,
              borderRadius: '5px',
              color: copied ? '#a6e3a1' : '#89b4fa',
              fontSize: '10px', cursor: 'pointer',
              transition: 'background 0.1s, border-color 0.1s, color 0.1s',
              lineHeight: 1, fontFamily: 'monospace',
            }}
          >
            {copied ? '✓ copied' : '⌥ insert'}
          </button>
        ) : (
          <button
            onClick={onAdd}
            title="Add to Graph"
            style={{
              flex: 1, padding: '3px 6px',
              background: '#89b4fa18', border: '1px solid #89b4fa44',
              borderRadius: '5px', color: '#89b4fa', fontSize: '13px',
              cursor: 'pointer', transition: 'background 0.1s, border-color 0.1s',
              lineHeight: 1,
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#89b4fa28'; (e.currentTarget as HTMLButtonElement).style.borderColor = '#89b4fa77'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = '#89b4fa18'; (e.currentTarget as HTMLButtonElement).style.borderColor = '#89b4fa44'; }}
          >
            +
          </button>
        )}
        <button
          onClick={() => { setTagInput(currentTags.join(', ')); setEditingTags(v => !v); }}
          title="Add or edit tags"
          style={{
            padding: '3px 8px',
            background: editingTags ? '#a6e3a128' : '#a6e3a110',
            border: `1px solid ${editingTags ? '#a6e3a166' : '#a6e3a133'}`,
            borderRadius: '5px',
            color: '#a6e3a1',
            fontSize: '11px', fontFamily: 'monospace', fontWeight: 600,
            cursor: 'pointer', transition: 'background 0.1s, border-color 0.1s',
            lineHeight: 1,
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#a6e3a128'; (e.currentTarget as HTMLButtonElement).style.borderColor = '#a6e3a166'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = editingTags ? '#a6e3a128' : '#a6e3a110'; (e.currentTarget as HTMLButtonElement).style.borderColor = editingTags ? '#a6e3a166' : '#a6e3a133'; }}
        >
          #
        </button>
      </div>
    </div>
  );
}

// ── Node pill ─────────────────────────────────────────────────────────────────
function NodePill({
  type, label, description, color,
  isSelected, isHighlighted,
  onSingleClick, onDoubleClick,
  swapMode, btnRef,
}: {
  type: string; label: string; description?: string; color: string;
  isSelected: boolean; isHighlighted: boolean;
  onSingleClick: () => void; onDoubleClick: () => void;
  swapMode: boolean;
  btnRef?: (el: HTMLButtonElement | null) => void;
}) {
  const [hovered, setHovered] = useState(false);

  const activeColor = isHighlighted ? '#89b4fa' : (isSelected || hovered) ? color : undefined;
  const borderColor = isHighlighted ? '#89b4fa' : isSelected ? color + '88' : hovered ? color + '55' : '#3a3a4e';
  const bg = isHighlighted ? '#1a2a3a' : isSelected ? '#252545' : hovered ? '#2a2a3e' : '#252535';

  return (
    <div
      style={{ position: 'relative', display: 'inline-flex' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
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
        style={{
          display: 'inline-flex', alignItems: 'center',
          padding: '4px 10px 4px 8px',
          background: bg,
          border: `1px solid ${borderColor}`,
          borderRadius: '20px',
          color: activeColor ?? '#a6adc8',
          fontSize: '11px', fontWeight: 500,
          cursor: swapMode ? 'pointer' : 'grab',
          userSelect: 'none',
          transition: 'background 0.12s, border-color 0.12s, color 0.12s',
          boxShadow: isHighlighted ? '0 0 0 2px #89b4fa33' : 'none',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </button>
    </div>
  );
}

// ── Sub-group label ───────────────────────────────────────────────────────────
function GroupHeader({ label }: { label: string }) {
  return (
    <div style={{
      width: '100%',
      fontSize: '8px', fontWeight: 700, letterSpacing: '0.1em',
      textTransform: 'uppercase', color: '#45475a',
      padding: '6px 2px 3px',
      marginTop: '2px',
    }}>
      {label}
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
  const [path, setPath] = useState<string[]>([]);
  const [previewType, setPreviewType] = useState<string | null>(null);
  const [highlightType, setHighlightType] = useState<string | null>(null);
  const [glslPopupType, setGlslPopupType] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isGlsl = context === 'glsl';

  const isSearching = searchQuery.trim().length > 0;

  const allCats = getAllCategories();
  const categories = [
    ...CATEGORY_ORDER.filter(c => allCats.includes(c)),
    ...allCats.filter(c => !CATEGORY_ORDER.includes(c)).sort(),
  ];

  useEffect(() => {
    const handler = (e: Event) => {
      const { nodeType } = (e as CustomEvent<{ nodeType: string }>).detail;
      const def = NODE_REGISTRY[nodeType];
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

  // Helper to render a flat list of node pills + preview below
  const renderPills = (nodes: Array<{ type: string; label: string; description?: string }>, color: string) => (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
        {nodes.map(def => (
          <NodePill
            key={def.type}
            type={def.type} label={def.label} description={def.description}
            color={color} isSelected={previewType === def.type}
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
        />
      )}
    </>
  );

  // ── Compute content ────────────────────────────────────────────────────────
  let innerContent: React.ReactNode;

  if (isSearching) {
    const trimmed = searchQuery.trim().toLowerCase();
    const scoreNodeDef = (def: import('../../types/nodeGraph').NodeDefinition): number => {
      const label = def.label.toLowerCase();
      if (label === trimmed) return 120;
      if (label.startsWith(trimmed)) return 100;
      if (label.includes(trimmed)) return 80;
      if (def.type.toLowerCase().includes(trimmed)) return 60;
      const cat = (def.category ?? '').toLowerCase();
      if (cat.split(/[\s\/,]+/).some((w: string) => w.startsWith(trimmed))) return 40;
      const rawDesc = def.description;
      const desc = (Array.isArray(rawDesc) ? rawDesc.join(' ') : (rawDesc ?? '')).toLowerCase();
      if (desc.split(/\W+/).some((w: string) => w === trimmed)) return 20;
      return 0;
    };
    const results = Object.values(NODE_REGISTRY)
      .filter(def => !HIDDEN_NODES.has(def.type))
      .map(def => ({ def, score: scoreNodeDef(def) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score || a.def.label.localeCompare(b.def.label))
      .map(({ def }) => def);
    innerContent = results.length === 0
      ? <div style={{ color: '#585b70', fontSize: '11px', paddingLeft: '4px' }}>No matches</div>
      : <div>{renderPills(results, '#89b4fa')}</div>;

  } else if (path.length === 0) {
    const favCount = favorites.filter(t => NODE_REGISTRY[t] && !HIDDEN_NODES.has(t)).length;
    innerContent = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
        {favCount > 0 && (
          <CategoryRow
            key="__favorites__"
            cat="★ Favorites"
            color="#f9e2af"
            count={favCount}
            onClick={() => { setPath(['__favorites__']); setPreviewType(null); }}
          />
        )}
        {CATEGORY_SECTIONS.map(section => {
          const sectionCats = section.categories.filter(cat => {
            const nodes = getNodesByCategory(cat).filter(d => !HIDDEN_NODES.has(d.type));
            return nodes.length > 0;
          });
          if (sectionCats.length === 0) return null;
          return (
            <div key={section.label}>
              <div style={{
                fontSize: '8px', fontWeight: 700, letterSpacing: '0.12em',
                textTransform: 'uppercase', color: '#45475a',
                padding: '8px 4px 4px',
              }}>
                {section.label}
              </div>
              {sectionCats.map(cat => {
                const color = CATEGORY_COLORS[cat] ?? '#888';
                const nodes = getNodesByCategory(cat).filter(d => !HIDDEN_NODES.has(d.type));
                return (
                  <CategoryRow
                    key={cat}
                    cat={cat}
                    color={color}
                    count={nodes.length}
                    onClick={() => { setPath([cat]); setPreviewType(null); }}
                  />
                );
              })}
            </div>
          );
        })}
        {/* Any categories not covered by sections */}
        {categories.filter(cat => !CATEGORY_ORDER.includes(cat)).map(cat => {
          const color = CATEGORY_COLORS[cat] ?? '#888';
          const nodes = getNodesByCategory(cat).filter(d => !HIDDEN_NODES.has(d.type));
          if (nodes.length === 0) return null;
          return (
            <CategoryRow
              key={cat}
              cat={cat}
              color={color}
              count={nodes.length}
              onClick={() => { setPath([cat]); setPreviewType(null); }}
            />
          );
        })}
      </div>
    );

  } else if (path[0] === '__favorites__') {
    const favDefs = favorites
      .map(t => NODE_REGISTRY[t])
      .filter((d): d is NonNullable<typeof d> => !!d && !HIDDEN_NODES.has(d.type));
    innerContent = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <button
          onClick={() => { setPath([]); setPreviewType(null); }}
          style={{ display: 'flex', alignItems: 'center', gap: '5px', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0', marginBottom: '4px', color: '#6c7086', fontSize: '11px', textAlign: 'left' }}
          onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.color = '#cdd6f4')}
          onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.color = '#6c7086')}
        >
          <span style={{ fontSize: '13px' }}>‹</span>
          <span style={{ color: '#f9e2af', fontWeight: 600, fontSize: '11px', letterSpacing: '0.04em' }}>★ FAVORITES</span>
          <span style={{ color: '#45475a', marginLeft: 'auto', fontSize: '10px' }}>{favDefs.length}</span>
        </button>
        {favDefs.length === 0
          ? <div style={{ color: '#45475a', fontSize: '11px', paddingLeft: '4px' }}>No favorites yet</div>
          : renderPills(favDefs, '#f9e2af')
        }
      </div>
    );

  } else {
    const cat = path[0];
    const color = CATEGORY_COLORS[cat] ?? '#888';
    const rawNodes = getNodesByCategory(cat).filter(d => !HIDDEN_NODES.has(d.type));
    const groups = CATEGORY_GROUPS[cat];
    innerContent = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <button
          onClick={() => { setPath([]); setPreviewType(null); }}
          style={{ display: 'flex', alignItems: 'center', gap: '5px', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0', marginBottom: '4px', color: '#6c7086', fontSize: '11px', textAlign: 'left' }}
          onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.color = '#cdd6f4')}
          onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.color = '#6c7086')}
        >
          <span style={{ fontSize: '13px' }}>‹</span>
          <span style={{ color, fontWeight: 600, fontSize: '11px', letterSpacing: '0.04em' }}>{cat.toUpperCase()}</span>
          <span style={{ color: '#45475a', marginLeft: 'auto', fontSize: '10px' }}>{rawNodes.length}</span>
        </button>
        {groups ? (
          groups.map(group => {
            const groupNodes = rawNodes.filter(d => group.types.includes(d.type));
            if (groupNodes.length === 0) return null;
            return (
              <div key={group.label}>
                <GroupHeader label={group.label} />
                {renderPills(groupNodes, color)}
              </div>
            );
          })
        ) : (
          renderPills([...rawNodes].sort((a, b) => a.label.localeCompare(b.label)), color)
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

// ── Category row button (extracted to avoid re-renders on hover state) ────────
function CategoryRow({ cat, color, count, onClick }: {
  cat: string; color: string; count: number; onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: '8px',
        width: '100%', padding: '7px 10px',
        background: hovered ? '#252535' : '#1e1e2e',
        border: '1px solid #313244',
        borderLeft: `3px solid ${hovered ? color : 'transparent'}`,
        borderRadius: '6px',
        color: hovered ? color : '#cdd6f4',
        fontSize: '12px', fontWeight: 500,
        cursor: 'pointer', textAlign: 'left',
        transition: 'background 0.1s, border-color 0.1s, color 0.1s',
      }}
    >
      <span style={{ flex: 1 }}>{cat}</span>
      <span style={{ fontSize: '10px', color: hovered ? color + '88' : '#45475a', fontVariantNumeric: 'tabular-nums' }}>
        {count}
      </span>
      <span style={{ fontSize: '9px', color: hovered ? color + '88' : '#45475a', flexShrink: 0 }}>›</span>
    </button>
  );
}
