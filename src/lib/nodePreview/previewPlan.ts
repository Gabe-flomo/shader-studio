/**
 * What a node's card and its eye button offer as a preview (docs/node-previews.md, "Every node"):
 * decided once here, per node type, so no card ends up with an empty box or "no preview".
 *
 *  - field:   the node's real value or colour, read back from the eye preview (ValuePreview), with
 *             the Show as row. Any float / vec2 / vec3 / vec4 output.
 *  - diagram: the node's hand-drawn diagram (NodeInlineViz), for nodes with no output a picture
 *             can show (3D primitives…).
 *  - stats:   a small live readout or diagram, always on the card (Sense's sensors, Emit's births).
 *  - mirror:  a live mini picture of a texture another host already draws (Deposit → its trail).
 *  - none:    no preview area. The card's own always-on picture (Agents group, Pass, Texture
 *             Input…) is the preview, or nothing meaningful can be shown.
 *
 * `eye` says whether the eye button is offered: only where isolating the node shows something.
 * Pure: the React side passes in which types have a real diagram.
 */
import type { GraphNode } from '../../types/nodeGraph';
import { pickPreviewOutput } from './showAs';

export type PreviewBody = 'field' | 'diagram' | 'stats' | 'mirror' | 'none';
export interface PreviewPlan {
  /** The card's eye button. */
  eye: boolean;
  body: PreviewBody;
  /** A field preview also offers the node's diagram (the Diagram toggle). */
  diagram: boolean;
  /** One line on why (the audit table, tests). */
  why: string;
}

/** Previewable output types: the eye compiles them to the picture, the card reads them back. */
export const FIELD_TYPES: ReadonlySet<string> = new Set(['float', 'vec2', 'vec3', 'vec4']);

/** Sinks and markers: nothing of their own to show, so no eye and no area. */
export const SINK_TYPES: ReadonlySet<string> = new Set([
  'output', 'vec4Output', 'agentOutput', 'agentStepOut', 'trailStepOut', 'agentProbeOut', 'agentGridOut',
  'marchLoopOutput', 'passOutput', 'groupOutput', 'groupInput',
]);

/** The card has no eye button (the node is a plain source the card already shows). Kept from before. */
export const NO_EYE_TYPES: ReadonlySet<string> = new Set(['uv', 'time', 'mouse', 'constant']);

/**
 * Nodes whose card already shows their live picture or panel all the time, so the eye area would
 * repeat it: the eye stays (isolating them is useful) but adds no box.
 */
export const SELF_VIZ_TYPES: ReadonlySet<string> = new Set([
  'textureInput', 'videoInput', 'baked', 'midiInput', 'data', 'timeCube', 'audioInput', 'scope', 'lfo',
  // A Pass's card shows its texture live (lib/passRunner.ts draws it): the texture the next nodes read
  'pass',
]);

/** Always-on readouts (AgentPreviewPanels.tsx). */
export const STATS_TYPES: ReadonlySet<string> = new Set(['agentSense', 'agentSteer', 'agentMove', 'agentEmit']);
/** Always-on mini pictures of a texture another host draws. */
export const MIRROR_TYPES: ReadonlySet<string> = new Set(['agentDeposit']);
/** Their own card is the picture and their outputs aren't pictures: no eye (it would show the whole graph). */
export const OWN_CARD_TYPES: ReadonlySet<string> = new Set(['agentsGroup']);

/**
 * Groups whose inside runs as a 3D distance function at every ray step: a node in there has no
 * per-pixel value of its own to read back, so it shows its diagram (if it has one) or nothing.
 */
export const THREE_D_GROUP_TYPES: ReadonlySet<string> = new Set(['sceneGroup', 'spaceWarpGroup', 'marchLoopGroup', 'giLitMarchGroup', 'volumetricScene', 'sceneBuilder']);

/**
 * The plan for a node. `hasDiagram(type)` says whether NodeInlineViz draws a real diagram for it
 * (not just its parameters listed, which the sliders already show). `insideGroup` is the type of
 * the group being edited, when the node is inside one.
 */
export function previewPlan(node: Pick<GraphNode, 'type' | 'outputs'>, hasDiagram: (type: string) => boolean, insideGroup?: string | null): PreviewPlan {
  const t = node.type;
  if (SINK_TYPES.has(t)) return { eye: false, body: 'none', diagram: false, why: 'a sink: nothing of its own to show' };
  if (insideGroup && THREE_D_GROUP_TYPES.has(insideGroup)) {
    return hasDiagram(t)
      ? { eye: true, body: 'diagram', diagram: true, why: 'inside a 3D group it runs per ray step: its diagram' }
      : { eye: false, body: 'none', diagram: false, why: 'inside a 3D group it runs per ray step, with no picture of its own' };
  }
  if (STATS_TYPES.has(t)) {
    // Sense, Steer and Move run per walker: their eye shows what a walker at each pixel would do.
    return { eye: t !== 'agentEmit', body: 'stats', diagram: false, why: 'a readout of its settings and live numbers' };
  }
  if (MIRROR_TYPES.has(t)) return { eye: false, body: 'mirror', diagram: false, why: 'its trail, drawn live by the agents host' };
  if (OWN_CARD_TYPES.has(t)) return { eye: false, body: 'none', diagram: false, why: 'its card already shows the walkers live and its numbers' };
  if (NO_EYE_TYPES.has(t)) return { eye: false, body: 'none', diagram: false, why: 'a source the card already describes' };
  if (SELF_VIZ_TYPES.has(t)) return { eye: true, body: 'none', diagram: false, why: 'its card already shows it live' };
  const out = pickPreviewOutput({ id: '', ...node });
  if (out && FIELD_TYPES.has(out[1])) {
    return { eye: true, body: 'field', diagram: hasDiagram(t), why: `its ${out[1]} output, read back from the eye preview` };
  }
  if (hasDiagram(t)) return { eye: true, body: 'diagram', diagram: true, why: 'no picture output: its diagram' };
  return { eye: false, body: 'none', diagram: false, why: 'no output a picture can show, and no diagram' };
}

/**
 * NodeInlineViz entries that only list the node's parameters (SDF3DParamViz): not a diagram, the
 * sliders already show the same numbers. Types also drawn by the table-driven GenericViz (which
 * NodeInlineViz checks first) keep their real diagram.
 */
export const PARAM_LIST_TYPES: ReadonlySet<string> = new Set([
  'sphereSDF3D', 'boxSDF3D', 'torusSDF3D', 'capsuleSDF3D', 'cylinderSDF3D', 'coneSDF3D', 'octahedronSDF3D', 'planeSDF3D',
  'translate3D', 'rotate3D', 'repeat3D', 'twist3D', 'fold3D',
  'roundedBoxSDF3D', 'boxFrameSDF3D', 'ellipsoidSDF3D', 'cappedTorusSDF3D', 'linkSDF3D', 'pyramidSDF3D', 'hexPrismSDF3D',
  'triPrismSDF3D', 'cappedConeSDF3D', 'roundedCylinderSDF3D', 'solidAngleSDF3D', 'verticalCapsuleSDF3D',
  'scale3d', 'rotateAxis3D', 'sinWarp3D', 'bend3D', 'limitedRepeat3D', 'polarRepeat3D', 'displace3D', 'sdfOnion',
  'vignette', 'scanlines', 'sobel', 'chromaticAberrationAuto', 'gaussianBlur', 'radialBlur', 'tiltShiftBlur', 'lensBlur',
  'depthOfField', 'motionBlur', 'chromaShift', 'gravitationalLens', 'floatWarp', 'constant', 'weightedAverage',
  'fract', 'rotate2d', 'uvWarp', 'smoothWarp', 'curlWarp', 'swirlWarp', 'displace', 'domainWarp', 'flowField',
  'polarSpace', 'logPolarSpace', 'hyperbolicSpace', 'inversionSpace', 'mobiusSpace', 'swirlSpace', 'kaleidoSpace',
  'sphericalSpace', 'rippleSpace', 'infiniteRepeatSpace', 'shear', 'perspective2d', 'mirroredRepeat2D', 'limitedRepeat2D', 'angularRepeat2D',
  'hsv', 'invert', 'blendModes', 'lumaKey', 'sdfColorize', 'sdfFill', 'mask', 'glowLayer', 'alphaBlend', 'chromaticAberration',
  'luminance', 'compare', 'select', 'reflect', 'crossProduct', 'complexMul', 'complexPow', 'sdSegment', 'simpleSDF',
  'sdCross3D', 'mandelbulb', 'mirroredRepeat3D', 'voxelize', 'spiralWarp3D',
  'light', 'light2d', 'multiLight', 'fresnel3d', 'sdfAo', 'softShadow',
  'mandelbrot', 'ifs', 'newtonFractal', 'lyapunov', 'apollonian', 'truchet', 'metaballs', 'lissajous', 'chladni',
  'fractalLoop', 'rotatingLinesLoop', 'accumulateLoop', 'forLoop', 'loopCarry', 'loopDomainFold',
  'fakeSSS', 'volumeClouds', 'volumetricFog', 'radianceCascadesApprox', 'vectorField', 'gravityField', 'spiralField',
  'scenePos', 'rayMarch', 'marchOutput', 'marchCamera', 'forwardCamera', 'marchLoopInputs', 'marchLoopOutput',
]);

/**
 * The eye's banner over the graph: only what is being previewed and Exit. Every preview control
 * (output, Show as, Detail, Diagram) and every note (clipping, black, flat) is on the node's card,
 * so there is one place to look (docs/node-previews.md).
 */
export function previewBanner(label: string): { lead: string; name: string; controls: false; notes: false } {
  return { lead: 'Previewing', name: label, controls: false, notes: false };
}
