import { useState, useEffect, useRef, useCallback, type ReactNode } from 'react';
import { scoreNodeDef } from '../../nodes/searchNodes';
import { createPortal } from 'react-dom';
import { InstalledPackCard, PackGlyphSmall } from '../nodePacks/InstalledPackCard';
import { packForCategory } from '../../nodePacks/installed';
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
import { nodeDragProps, nodeDragStyle, type DropPayload } from './nodeDrop';
import { BuildersSection } from '../builders/BuildersSection';
import { matchBuilders } from '../../builders/registry';
import { useStructureHints } from '../../structure/hintsStore';
import { typesForStage } from '../../structure/browse';
import { FLOWS, STAGES } from '../../structure/stages';
import { misfitBadge, splitCategories } from '../../structure/relevance';
import { useLibraryPrefs } from '../../structure/libraryPrefs';
import { useFitsHere, useLibraryContext } from './useLibraryRelevance';

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
  // Made by the compiler at the end of a Pass's program (compiler/passGraph.ts).
  'passOutput',
  // A hidden pass of Blur / Glow (texture) (compiler/hiddenBlurs.ts).
  'blurStage',
  // One step of a Grid Rules board (compiler/gridRulesExpand.ts).
  'gridRulesStep',
  // Made by Bake… (lib/bake): a node's frozen render, never added by hand.
  'baked',
  // An Agents group's anchors (made with the group) and its update shader's end (compiler/agentGraph.ts).
  'agentInputs', 'agentOutput', 'agentStepOut', 'trailStepOut', 'agentProbeOut', 'agentGridOut',
]);

const CATEGORY_SECTIONS: Array<{ label: string; categories: string[] }> = [
  { label: '2D tools',      categories: ['2D Primitives', '2D Space', 'Grid', 'Field', 'Halftone'] },
  { label: '3D tools',      categories: ['3D Primitives', '3D Transforms', '3D Boolean Ops', '3D Scene', '3D Lighting', 'Loops'] },
  { label: '4D tools',      categories: ['4D'] },
  { label: 'SDF',           categories: ['SDF'] },
  { label: 'Colour',        categories: ['Color', 'Color Grading', 'Combiners'] },
  { label: 'Effects',       categories: ['Effects'] },
  { label: 'Simulation',    categories: ['Simulation', 'Particles', 'Particles & Fields', 'Passes', 'Texture tools'] },
  { label: 'Generators',    categories: ['Noise', 'Fractals', 'Science'] },
  { label: 'Math & Logic',  categories: ['Sources', 'Animation', 'Math', 'Matrix', 'Shapers', 'Conditionals'] },
  { label: 'Functions',     categories: ['My Nodes', 'Functions'] },
  { label: 'Utility',       categories: ['Utility', 'Output'] },
];

/** Rows that show several node categories as one (the definitions keep their own category). */
const MERGED_CATEGORIES: Record<string, string[]> = {
  Effects: ['Effects', 'Post Processing'],
};

/** What a library row is for, shown under its title when it's open and as the row's tooltip. */
export const CATEGORY_INFO: Record<string, string> = {
  '2D Primitives': 'Flat shapes as distance fields (SDFs): for every pixel, how far it is from the shape. Negative inside, 0 on the edge, positive outside. Wire the distance into SDF Fill, SDF Glow or a palette. Patterns fill the whole picture.',
  '2D Space': 'Change where every pixel looks before a shape or texture measures it: move, rotate, tile, mirror, warp or remap the UV. A space node bends everything after it.',
  Grid: 'Cut the picture into cells and give each cell its own position, id and motion: grids of shapes, ripples through cells, per-cell variation.',
  Field: 'Smooth fields made by adding up many sources (metaballs, Gaussian blobs), then thresholded or coloured.',
  Halftone: 'Print looks: dots, lines and patterns whose size follows a brightness.',
  '3D Primitives': '3D shapes as distance fields, measured from Scene Pos inside a Scene Group. Adding one at the top level builds the Scene Group, camera and march loop for you.',
  '3D Transforms': 'Change 3D space before the shapes measure it: move, rotate, repeat, twist, bend or fold. Put them between Scene Pos and the shapes.',
  '3D Boolean Ops': 'Join, cut or overlap 3D distances.',
  '3D Scene': 'The 3D pipeline: a March Camera makes the rays, a Scene Group holds the shapes, a March Loop finds where each ray hits.',
  '3D Lighting': 'Light what the march loop hit: shading, shadows, ambient occlusion, glass and fog. Wire them from the loop\'s outputs.',
  Loops: 'Repeat a chain of nodes several times inside one shader.',
  '4D': 'Shapes and transforms in four dimensions. Lift to 4D turns a 3D point into a 4D one and the shape is sliced back to 3D; projection nodes show the whole 4D shape at once; 4D Wireframe 2D and Plane Slice 4D go straight to the flat picture.',
  SDF: 'Work on distances from any shape, 2D or 3D. Combine joins, cuts or overlaps two shapes; Modify grows, hollows or sharpens one; Style turns a distance into colour.',
  Color: 'Make and change colour: pick colours, palettes and gradients, adjust, convert and blend.',
  'Color Grading': 'Film-style adjustments on a finished colour: tone, curves, saturation, tone mapping and grain.',
  Combiners: 'Put two pictures or colours together: mix, blend modes, masks, add, and glow layers.',
  Effects: 'Finishing touches on the picture: blur, bloom, chromatic shifts, glows and post-processing like vignette, scanlines and pixelation.',
  Simulation: 'Things that remember the last frame: agents (walkers with rules), particles, passes that read their own previous frame, and tools for the textures they make.',
  Particles: 'GPU particles: emit, move and draw thousands of points.',
  Passes: 'Render part of the graph to a texture, read it back later or in the next frame: feedback, trails, multi-step simulations.',
  'Texture tools': 'Shape a texture\'s raw values: masks, levels, flow directions, outlines, fades.',
  Noise: 'Smooth random patterns (value, Perlin, simplex, fBm, Voronoi) for textures, warps and motion.',
  Fractals: 'Shapes that repeat at every scale: Mandelbrot, Julia, kaleidoscopic folds.',
  Science: 'Physics-inspired patterns: waves, interference, reaction-diffusion and more.',
  Sources: 'Inputs from outside the graph: UV, time, mouse, resolution, audio, video, constants.',
  Animation: 'Values that move over time: LFOs, envelopes and keyframes.',
  Math: 'Arithmetic, trigonometry, rounding, interpolation, vectors and comparison, one operation per node.',
  Matrix: '2×2, 3×3 and 4×4 matrices: build, combine and apply transforms.',
  Shapers: 'Curves that reshape a 0 to 1 value: easing, seats, sigmoids and Béziers.',
  Conditionals: 'Pick between values with a condition.',
  Functions: 'Custom GLSL functions and Expression Blocks: write your own maths.',
  'My Nodes': 'Nodes you published from your own graphs.',
  Utility: 'Helpers: comments, reroutes and tools for the graph itself.',
  Output: 'Where the picture leaves the graph.',
};

const nodesOfRow = (row: string) => (MERGED_CATEGORIES[row] ?? [row]).flatMap(c => getNodesByCategory(c));

const CATEGORY_ORDER = CATEGORY_SECTIONS.flatMap(s => s.categories.flatMap(c => MERGED_CATEGORIES[c] ?? [c]));

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
  '4D': [
    { label: 'Point',  types: ['lift4D', 'rotate4D', 'translate4D', 'scale4D'] },
    { label: 'Repeat', types: ['repeat4D', 'fold4D', 'twist4D'] },
    { label: 'Shapes', types: ['hypersphereSDF', 'tesseractSDF', 'duocylinderSDF', 'spherinderSDF', 'cubinderSDF', 'cylPrismSDF', 'ditorusSDF', 'cliffordTorusSDF'] },
    { label: 'Polytopes', types: ['cell5SDF', 'cell16SDF', 'cell24SDF'] },
    { label: 'Fractals', types: ['quatJuliaSDF', 'quatMandelSDF'] },
    { label: 'Noise',  types: ['noise4D'] },
    { label: 'Project', types: ['wireframe4D', 'project4D', 'stereo4D', 'stereoDist4D', 'hopfCirclesSDF'] },
  ],
  '3D Lighting': [
    { label: 'Shadow',  types: ['sdfAo', 'softShadow'] },
    { label: 'Surface', types: ['blinnPhong', 'fresnel3d', 'fakeSSS', 'materialSelect', 'multiLight'] },
    { label: 'Glass',   types: ['glass3d', 'fresnelSchlick', 'spectralDispersion'] },
    { label: 'Volume',  types: ['volumetricFog', 'phaseHG'] },
  ],
  Color: [
    { label: 'Build',   types: ['colorPicker', 'colorize', 'makeVec3'] },
    { label: 'Palette', types: ['palette', 'stopPalette', 'gradient', 'colorRamp', 'blackbody'] },
    { label: 'Adjust',  types: ['invert', 'colorSaturation', 'posterize', 'hueRange', 'brightnessContrast', 'colorMatrix'] },
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
    { label: 'Vec4',       types: ['makeVec4', 'splitVec4'] },
    { label: 'Swizzle',    types: ['swizzle', 'vec2Swizzle', 'vec3Swizzle'] },
    { label: 'Complex',    types: ['complexMul', 'complexPow'] },
    { label: 'Remap',      types: ['remap'] },
  ],
  Shapers: [
    { label: 'Ease',    types: ['expEase', 'circularEaseIn', 'circularEaseOut'] },
    { label: 'Seat',    types: ['doubleExpSeat', 'doubleCircleSeat'] },
    { label: 'Sigmoid', types: ['doubleExpSigmoid', 'logisticSigmoid', 'doubleCircleSigmoid', 'doubleEllipticSigmoid'] },
    { label: 'Bezier',  types: ['quadBezierShaper', 'cubicBezierShaper'] },
  ],
  // The Agents family (docs/agents-plan.md): the inside nodes only go into an open Agents group.
  Simulation: [
    { label: 'Start here', types: ['slimeMoldPreset', 'multiSlimePreset', 'antsPreset', 'boidsPreset', 'strandsPreset', 'growPicturePreset', 'myceliumPreset', 'particlesPreset', 'curlSmokePreset', 'soundBurstPreset', 'galaxyPreset', 'sandPlatePreset', 'agentsGroup'] },
    { label: 'Outside the group', types: ['agentEmit', 'agentDeposit', 'trailField', 'drawAgents'] },
    { label: 'Inside: walkers', types: ['agentSense', 'agentNeighbours', 'agentSteer', 'agentMove', 'agentBySpecies'] },
    { label: 'Inside: forces', types: ['agentGravity', 'agentWind', 'agentCurl', 'agentAttract', 'agentVortex', 'agentFlow', 'agentSoundKick'] },
    { label: 'Inside: moving', types: ['agentIntegrate', 'agentAge', 'agentCollide', 'agentChladni'] },
  ],
  Effects: [
    { label: 'Blur',     types: ['gaussianBlur', 'bloom', 'radialBlur', 'tiltShiftBlur', 'lensBlur', 'depthOfField'] },
    { label: 'Chroma',   types: ['chromaShift', 'chromaticAberrationAuto', 'chromaticAberration'] },
    { label: 'Lighting', types: ['light', 'glowToColor', 'light2d', 'radianceCascadesApprox'] },
    { label: 'Warp',     types: ['gravitationalLens', 'floatWarp'] },
  ],
  // Effects also shows the Post Processing nodes (MERGED_CATEGORIES); anything not listed here goes under More.
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
    { label: 'Map',     types: ['polarSpace', 'logPolarSpace', 'hyperbolicSpace', 'inversionSpace', 'mobiusSpace', 'cornerPin'] },
    { label: 'Pattern', types: ['waveTexture', 'magicTexture', 'chaosLayers'] },
  ],
  Combiners: [
    { label: 'Blend',   types: ['mix', 'blendModes', 'mask', 'addColor', 'alphaBlend'] },
    { label: 'Layer',   types: ['glowLayer', 'deepGlow'] },
  ],
  Grid: [
    { label: 'Layout',   types: ['gridPattern', 'gridPaint', 'arrayField', 'gridLayout'] },
    { label: 'Motion',   types: ['waveRadius', 'animatedCellCenter'] },
    { label: 'Displace', types: ['neighborDist', 'cellDisplace', 'neighborAttractCircles'] },
    { label: 'Filter',   types: ['cellFilter', 'neighborOffset2d'] },
    { label: 'Warp',     types: ['gridDensityWarp'] },
  ],
  Field: [
    { label: 'Gaussian',  types: ['gaussianField', 'fieldAccumulate'] },
    { label: 'Noisy SDF', types: ['noisyGridSDF'] },
    { label: 'Threshold', types: ['metaballThreshold'] },
    { label: 'Falloff',   types: ['distanceFalloff'] },
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
        <div style={{ display: 'flex', gap: 6, paddingTop: 6, borderTop: `1px solid ${tk.border.subtle}`, flexWrap: 'wrap' }}>
          {userNode.sealed ? (
            <span title="From a sealed node pack: its GLSL is encrypted and never shown" style={{ flexBasis: '100%', color: tk.text.faint, fontSize: 11.5 }}>
              Sealed node pack{userNode.signedBy ? `, signed by ${userNode.signedBy.name} (${userNode.signedBy.fingerprint})` : ''}: it can be used, not opened or shared unsealed.
            </span>
          ) : userNode.sourceHidden && (
            <span title="Published without its source graph: it can be used, not opened" style={{ flexBasis: '100%', color: tk.text.faint, fontSize: 11.5 }}>
              Source not included: this node can be used but not opened.
            </span>
          )}
          {userNode.source && (
            <Button size="sm" icon="layoutGraph" style={{ flex: 1 }} title="Place the node's source graph as a group; publish it again to update this node type"
              onClick={() => openUserNodeSource(userNode.id, { x: 200 + Math.random() * 120, y: 120 + Math.random() * 200 })}>
              Open source graph
            </Button>
          )}
          <Button size="sm" icon="export" title="Save this node type as a signed node pack (.playfile), optionally sealed, to share or import into another project"
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
  label, description, badge,
  isSelected, isHighlighted,
  onSingleClick, onDoubleClick,
  swapMode, btnRef, drag, onDragEnd,
}: {
  type: string; label: string; description?: string; badge?: string;
  isSelected: boolean; isHighlighted: boolean;
  onSingleClick: () => void; onDoubleClick: () => void;
  swapMode: boolean;
  btnRef?: (el: HTMLButtonElement | null) => void;
  /** Pressing and moving carries the node to the graph (nodeDrop.ts); none when it can't be added by hand. */
  drag: DropPayload | null;
  onDragEnd?: () => void;
}) {
  const tk = useTokens();
  const [hovered, setHovered] = useState(false);
  const on = isSelected || isHighlighted;
  return (
    <button
      ref={btnRef}
      title={description ?? `Click to preview · Double-click to ${swapMode ? 'replace' : 'add'}${drag && !swapMode ? ' · or drag it onto the graph' : ''}`}
      {...nodeDragProps(swapMode ? null : drag, onDragEnd)}
      onClick={onSingleClick}
      onDoubleClick={onDoubleClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        height: 28, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0 10px', border: 0, borderRadius: radius.md,
        background: on ? tk.bg.selected : hovered ? tk.bg.hover : tk.bg.field,
        boxShadow: on ? `inset 0 0 0 1.5px ${tk.accent.base}` : 'none',
        color: on ? tk.accent.text : tk.text.secondary, font: `${on ? 600 : 500} 12.5px ${fontFamily.ui}`,
        cursor: swapMode ? 'pointer' : 'grab', ...nodeDragStyle, whiteSpace: 'nowrap',
        transition: 'background 0.12s, box-shadow 0.12s',
      }}
    >
      {label}
      {badge && <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: tk.text.faint, background: tk.bg.hover, borderRadius: radius.sm, padding: '1px 5px' }}>{badge}</span>}
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
  /** Add `type` at a graph position (a pill dragged onto the graph). Left out: pills don't drag. */
  onDragAdd?: (type: string, position: { x: number; y: number }) => string | undefined;
  /** After a drop, e.g. to close a drawer. */
  onDragDone?: () => void;
  swapTargetNodeId: string | null;
  favorites: string[];
  onToggleFavorite: (type: string) => void;
  nodeButtonRefs: React.MutableRefObject<Map<string, HTMLButtonElement>>;
  searchQuery: string;
  context?: 'studio' | 'glsl';
  onGlslInsert?: (code: string) => void;
  /** After a builder in the Builders section opened, e.g. to close a drawer. */
  onBuilderOpened?: () => void;
}

// ── Main component ────────────────────────────────────────────────────────────
export function NodeBrowser({
  onAdd, onDragAdd, onDragDone, swapTargetNodeId, favorites, onToggleFavorite, nodeButtonRefs, searchQuery,
  context, onGlslInsert, onBuilderOpened,
}: NodeBrowserProps) {
  const tk = useTokens();
  const [path, setPath] = useState<string[]>([]);
  const [previewType, setPreviewType] = useState<string | null>(null);
  const [highlightType, setHighlightType] = useState<string | null>(null);
  const [glslPopupType, setGlslPopupType] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isGlsl = context === 'glsl';
  // The Builders section (docs/node-browser.md): not in the GLSL page's browser, nor while picking a node to switch to.
  const showBuilders = !isGlsl && !swapTargetNodeId;

  const isSearching = searchQuery.trim().length > 0;
  // What is relevant to this graph (structure/relevance.ts); not for the GLSL page's browser or a node switch.
  const relevanceOn = !isGlsl && !swapTargetNodeId;
  const relevantOnly = useLibraryPrefs(s => s.relevantOnly);
  const setRelevantOnly = useLibraryPrefs(s => s.setRelevantOnly);
  const libCtx = useLibraryContext(relevanceOn);
  const fits = useFitsHere(relevanceOn && relevantOnly, HIDDEN_NODES);
  const [showOther, setShowOther] = useState(false);
  // A stage picked on the flow strip (structure/hintsStore.ts); Back clears it.
  const stageBrowse = useStructureHints(st => st.browse);
  const setStageBrowse = useStructureHints(st => st.setBrowse);

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
  const renderPills = (nodes: Array<{ type: string; label: string; description?: string; badge?: string }>) => (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {nodes.map(def => (
          <NodePill
            key={def.type}
            type={def.type} label={def.label} description={def.description} badge={def.badge}
            isSelected={previewType === def.type}
            isHighlighted={highlightType === def.type}
            onSingleClick={() => handleNodeClick(def.type)}
            onDoubleClick={() => handleNodeDblClick(def.type)}
            swapMode={!!swapTargetNodeId}
            drag={onDragAdd && !isGlsl ? { label: def.label, type: def.type, place: pos => onDragAdd(def.type, pos) } : null}
            onDragEnd={() => { setPreviewType(null); onDragDone?.(); }}
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

  if (stageBrowse && !isSearching && !isGlsl) {
    // A stage clicked on the flow strip (docs/structure-hints.md): its nodes, by category.
    const list = typesForStage(stageBrowse.flow, stageBrowse.stage, HIDDEN_NODES);
    const cats = [...new Set(list.map(x => x.category))];
    innerContent = (
      <div data-stage-browse={stageBrowse.stage} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
          <IconButton icon="chevL" label="Back to categories" size="sm" onClick={() => { setStageBrowse(null); setPreviewType(null); }}
            style={{ background: tk.bg.hover, color: tk.text.secondary }} />
          <span style={{ flex: 1, minWidth: 0, fontWeight: 600, fontSize: 12.5, color: tk.text.primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            Stage: {STAGES[stageBrowse.stage].label} <span style={{ color: tk.text.faint, fontWeight: 500 }}>· {FLOWS[stageBrowse.flow].label}</span>
          </span>
          <Count n={list.length} />
        </div>
        <span style={{ fontSize: 12, color: tk.text.muted, lineHeight: 1.45 }}>{STAGES[stageBrowse.stage].line}</span>
        {cats.map(cat => (
          <div key={cat}>
            <CapsLabel>{cat}</CapsLabel>
            {renderPills(list.filter(x => x.category === cat).map(x => ({ type: x.type, label: x.label, description: getNodeDefinition(x.type)?.description })))}
          </div>
        ))}
      </div>
    );

  } else if (isSearching) {
    const trimmed = searchQuery.trim().toLowerCase();
    const results = getOfferedDefinitions()
      .filter(def => !HIDDEN_NODES.has(def.type))
      .map(def => ({ def, score: scoreNodeDef(def, trimmed) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score || a.def.label.localeCompare(b.def.label))
      .map(({ def }) => ({ type: def.type, label: def.label, description: def.description, badge: relevanceOn ? misfitBadge(def.category, libCtx.flow) ?? undefined : undefined }));
    const builderHits = showBuilders ? matchBuilders(trimmed).length : 0;
    innerContent = (
      <>
        {builderHits > 0 && <BuildersSection query={trimmed} onOpened={onBuilderOpened} />}
        {results.length === 0
          ? (builderHits ? null : <div style={{ color: tk.text.faint, fontSize: 12, padding: '4px 2px' }}>No matches</div>)
          : <div>{renderPills(results)}</div>}
      </>
    );

  } else if (path.length === 0) {
    const filtering = relevanceOn && relevantOnly;
    const countOf = (cat: string) => nodesOfRow(cat).filter(d => !HIDDEN_NODES.has(d.type)).length;
    const live = (cat: string) => countOf(cat) > 0;
    const fitsOn = filtering;
    const otherCats: string[] = [];
    const sections = (libCtx.flow === '3d' && filtering
      ? [...CATEGORY_SECTIONS.filter(x => x.label === '3D tools'), ...CATEGORY_SECTIONS.filter(x => x.label !== '3D tools')]
      : CATEGORY_SECTIONS
    ).map(section => {
      const have = section.categories.filter(live);
      if (!filtering) return { label: section.label, cats: have };
      const { fit, other } = splitCategories(have, libCtx.flow);
      otherCats.push(...other);
      return { label: section.label, cats: fit };
    }).filter(s => s.cats.length > 0);
    const favCount = favorites.filter(t => getNodeDefinition(t) && !HIDDEN_NODES.has(t)).length;
    innerContent = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {libCtx && relevanceOn && (
          <RelevanceBar relevantOnly={relevantOnly} onChange={setRelevantOnly} flowLabel={FLOWS[libCtx.flow].label} flowTitle={libCtx.inside ? `Inside ${getNodeDefinition(libCtx.inside)?.label ?? libCtx.inside}` : `This graph is ${FLOWS[libCtx.flow].label}`} />
        )}
        {fitsOn && fits.defs.length > 0 && (
          <div data-fits-here>
            <CapsLabel rule>Fits here{fits.from ? ` · after ${fits.from}` : ''}</CapsLabel>
            {renderPills(fits.defs)}
          </div>
        )}
        {showBuilders && <BuildersSection onOpened={onBuilderOpened} />}
        {favCount > 0 && (
          <CategoryRow
            key="__favorites__"
            cat="Favorites"
            icon={<Icon name="starF" size={14} style={{ color: tk.status.warning }} />}
            count={favCount}
            onClick={() => { setPath(['__favorites__']); setPreviewType(null); }}
          />
        )}
        {sections.map(section => (
          <div key={section.label}>
            <CapsLabel rule>{section.label}</CapsLabel>
            {section.cats.map(cat => (
              <CategoryRow key={cat} cat={cat} count={countOf(cat)} onClick={() => { setPath([cat]); setPreviewType(null); }} />
            ))}
          </div>
        ))}
        {/* Any categories not covered by sections (My Nodes, node packs by name) */}
        {categories.filter(cat => !CATEGORY_ORDER.includes(cat)).map(cat => {
          const n = getNodesByCategory(cat).filter(d => !HIDDEN_NODES.has(d.type)).length;
          if (n === 0) return null;
          const pack = packForCategory(cat);
          return (
            <CategoryRow
              key={cat}
              cat={cat}
              icon={pack ? <PackGlyphSmall pack={pack} /> : undefined}
              count={n}
              onClick={() => { setPath([cat]); setPreviewType(null); }}
            />
          );
        })}
        {otherCats.length > 0 && (
          <div data-not-for-graph>
            <button onClick={() => setShowOther(v => !v)} aria-expanded={showOther}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 6, padding: '12px 2px 4px', border: 0, background: 'transparent', cursor: 'pointer', color: tk.text.faint, font: `700 10px ${fontFamily.ui}`, letterSpacing: '0.08em', textTransform: 'uppercase', textAlign: 'left' }}>
              <Icon name={showOther ? 'chevD' : 'chevR'} size={12} />
              <span>Not for this graph ({otherCats.reduce((n, c) => n + countOf(c), 0)})</span>
              <span style={{ flex: 1, height: 1, background: tk.border.subtle }} />
            </button>
            {showOther && otherCats.map(cat => (
              <CategoryRow key={cat} cat={cat} count={countOf(cat)} onClick={() => { setPath([cat]); setPreviewType(null); }} />
            ))}
          </div>
        )}
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
    const rawNodes = nodesOfRow(cat).filter(d => !HIDDEN_NODES.has(d.type));
    // Nodes no group lists still show, under More (and a merged row's other categories by name).
    const listed = CATEGORY_GROUPS[cat];
    const groups = listed ? [...listed, ...((MERGED_CATEGORIES[cat] ?? [cat]).map(c => ({
      label: c === cat ? 'More' : c,
      types: getNodesByCategory(c).map(d => d.type).filter(t => !listed.some(g => g.types.includes(t))),
    })))] : undefined;
    const info = CATEGORY_INFO[cat];
    innerContent = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {crumb(cat, rawNodes.length)}
        {info && <div data-category-info style={{ color: tk.text.muted, font: `12px/1.5 ${fontFamily.ui}`, padding: '0 2px 4px' }}>{info}</div>}
        {!isGlsl && <InstalledPackCard category={cat} />}
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
      title={CATEGORY_INFO[cat]}
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

// ── Relevant only / Show all ──────────────────────────────────────────────────
function RelevanceBar({ relevantOnly, onChange, flowLabel, flowTitle }: { relevantOnly: boolean; onChange: (v: boolean) => void; flowLabel: string; flowTitle: string }) {
  const tk = useTokens();
  const seg = (on: boolean, label: string, value: boolean) => (
    <button key={label} onClick={() => onChange(value)} aria-pressed={on}
      style={{ flex: 1, height: 24, border: 0, borderRadius: radius.sm, cursor: 'pointer', whiteSpace: 'nowrap', font: `${on ? 600 : 500} 11.5px ${fontFamily.ui}`,
        background: on ? tk.bg.selected : 'transparent', color: on ? tk.accent.text : tk.text.muted }}>{label}</button>
  );
  return (
    <div data-library-relevance style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
      <div style={{ flex: 1, display: 'flex', gap: 2, padding: 2, borderRadius: radius.md, background: tk.bg.field }}>
        {seg(relevantOnly, 'Relevant only', true)}
        {seg(!relevantOnly, 'Show all', false)}
      </div>
      <span title={flowTitle} style={{ fontSize: 10.5, color: tk.text.faint, whiteSpace: 'nowrap' }}>{flowLabel}</span>
    </div>
  );
}
