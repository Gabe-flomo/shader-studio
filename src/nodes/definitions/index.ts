// ─── Node Definitions — thin aggregator ──────────────────────────────────────
import { NODE_ALIASES } from './aliases';
export { NODE_ALIASES, resolveNodeAliases, resolveSubgraphAliases, aliasParams } from './aliases';
export type { NodeAlias } from './aliases';
// Each category lives in its own file. This module re-exports everything and
// builds the unified NODE_REGISTRY consumed by the rest of the app.

import type { NodeDefinition, GraphNode } from '../../types/nodeGraph';
import { getUserNodeDefinition, getAllUserNodeDefinitions } from '../userNodes/userNodeRegistry';
import { knobParamDefs, withInputExpressions } from '../../glsl/inputExpr';
import { VideoInputNode } from './sources';
export { VideoInputNode };
import { BakedNode } from './baked';
import { DepthNode } from './depth';
import { TimeCubeNode, TimeCubeViewNode, TimeSliceNode } from './timeCube';
import { FrameStackNode } from './frameStack';
export { BakedNode };
import { MidiInputNode } from './midi';
export { MidiInputNode };
import { DataNode } from './data';
export { DataNode };
import { Lift4DNode, Rotate4DNode, Translate4DNode, HypersphereSDFNode, TesseractSDFNode, FOURD_P2_NODES, FOURD_P4_NODES } from './fourD';
import { SCENE2D_NODES } from './scene2d';
export { Lift4DNode, Rotate4DNode, Translate4DNode, HypersphereSDFNode, TesseractSDFNode };
import { FOURD_P3_NODES } from './fourDProject';

// Sources
export { UVNode, TimeNode, PixelUVNode, ConstantNode, MouseNode, TextureInputNode, PrevFrameNode, LoopIndexNode, AudioInputNode, FragCoordNode, ResolutionNode } from './sources';
export { ConstantsNode } from './constants';
export { PlayLayersNode } from './playLayers';
export { MotionMapNode } from './motionMap';
export { PadGridNode } from './padGrid';

// Grid
export { GridPatternNode } from './gridPattern';
export { GridPaintNode } from './gridPaint';
export { ArrayFieldNode } from './arrayField';
export { FieldCellNode } from './fieldCell';
export { GridLayoutNode, WaveRadiusNode, NeighborDistNode, CellFilterNode, CellDisplaceNode, GridDensityWarpNode, NeighborOffset2dNode, AnimatedCellCenterNode, NeighborAttractCirclesNode } from './grid';

// Grid Field
export { GaussianFieldNode, FieldAccumulateNode, MetaballThresholdNode, FieldToLinesNode, DistanceFalloffNode, NoisyGridSDFNode } from './gridField';

// Transforms
export { FractNode, Rotate2DNode, UVWarpNode, SmoothWarpNode, CurlWarpNode, SwirlWarpNode, DisplaceNode, UvTransform2dNode, UvReciprocalNode } from './transforms';

// Matrix
export { Vec2ConstNode, MatConstNode, Mat2ConstructNode, Mat3ConstructNode, Mat2InspectNode, Mat3InspectNode, Mat2MulVecNode, Mat3MulVecNode } from './matrix';

// Spaces
export {
  PolarSpaceNode, LogPolarSpaceNode, HyperbolicSpaceNode, InversionSpaceNode,
  MobiusSpaceNode, SwirlSpaceNode, KaleidoSpaceNode, SphericalSpaceNode,
  RippleSpaceNode, InfiniteRepeatSpaceNode,
  WaveTextureNode, MagicTextureNode, GridNode, ShearNode,
  Perspective2DNode,
} from './spaces';

// 2D Primitives
export { CircleSDFNode, BoxSDFNode, RingSDFNode, ShapeSDFNode, SimpleSDFNode } from './primitives';

// SDF (IQ)
export { SdSegmentNode, SdEllipseNode, SdfOffsetNode, SdfSharpenNode } from './sdf';

// Combiners
export {
  MaskNode, AddColorNode, GlowLayerNode, DeepGlowNode, SDFFillNode, SDFColorizeNode,
  AlphaBlendNode, Light2DNode,
} from './combiners';

// Effects / Loops
export {
  AbsNode, ToneMapNode, GrainNode, LightNode,
  FractalLoopNode, RotatingLinesLoopNode, AccumulateLoopNode, ForLoopNode,
  ExprBlockNode, CustomFnNode, GravitationalLensNode, FloatWarpNode,
  VignetteNode, ScanlinesNode, SobelNode,
  RadianceCascadesApproxNode,
  GaussianBlurNode, BloomNode, RadialBlurNode, TiltShiftBlurNode, LensBlurNode, MotionBlurNode, DepthOfFieldNode,
  ChromaShiftNode,
} from './effects';
export { LoopRippleStepNode, LoopRotateStepNode, LoopDomainFoldNode, LoopFloatAccumulateNode, LoopRingStepNode, LoopColorRingStepNode } from './loopPair';
export { LoopCarryNode } from './loop';

// Noise
export { FBMNode, VoronoiNode, DomainWarpNode, FlowFieldNode, CirclePackNode, NoiseFloatNode, ScatterNode } from './noise';

// Fractals
export { MandelbrotNode, IFSNode, NewtonFractalNode, LyapunovNode, ApollonianNode, SphericalFoldFractalNode } from './fractals';

// Physics
export { ChladniNode, WaveTermNode, ChladniFieldNode, ChladniSuperpositionNode, ChladniModeFreqNode } from './physics';

// Vector fields
export { VectorFieldNode, GravityFieldNode, SpiralFieldNode } from './vectorFields';

// 3D / Volumetric
export { RaymarchNode, VolumeCloudsNode, ChromaticAberrationNode, CombineRGBNode, MandelbulbNode } from './threed';

// 3D Lighting
export { SdfAoNode, SoftShadowNode, MultiLightNode, Fresnel3DNode, FakeSSSNode, VolumetricFogNode, MaterialSelectNode, GlassNode, PhaseHGNode, FresnelSchlickNode, SpectralDispersionNode, BlinnPhongNode, GlassSceneNode } from './threed';


// Patterns
export { TruchetNode, MetaballsNode, LissajousNode } from './patterns';

// 3D SDF Primitives + Transforms
export {
  SphereSDF3DNode, BoxSDF3DNode, TorusSDF3DNode, CapsuleSDF3DNode,
  CylinderSDF3DNode, ConeSDF3DNode, OctahedronSDF3DNode,
  Translate3DNode, Rotate3DNode, Repeat3DNode, Twist3DNode, Fold3DNode,
  PlaneSDF3DNode, Scale3DNode, RotateAxis3DNode, SinWarp3DNode, SpiralWarp3DNode,
  RoundedBoxSDF3DNode, BoxFrameSDF3DNode, EllipsoidSDF3DNode, CappedTorusSDF3DNode,
  LinkSDF3DNode, PyramidSDF3DNode, HexPrismSDF3DNode, TriPrismSDF3DNode,
  CappedConeSDF3DNode, RoundedCylinderSDF3DNode, SolidAngleSDF3DNode, VerticalCapsuleSDF3DNode,
  SDFUnionNode, SDFSubtractNode, SDFIntersectNode,
  SDFOnionNode,
  Bend3DNode, LimitedRepeat3DNode, PolarRepeat3DNode, Displace3DNode,
  MirroredRepeat3DNode, VoxelizeNode, SdCrossNode,
  SphereInvert3DNode, Shear3DNode, Kaleidoscope3DNode,
  MobiusWarp3DNode, LogPolarWarp3DNode, HelixWarp3DNode,
  GyroidFieldNode, SchwarzPFieldNode,
  MirrorFold3DNode, DomainWarp3DNode, Turbulence3DNode,
} from './sdf3d';

// 3D Scene (composable)
export { ScenePosNode, SceneGroupNode, SceneOutputNode, SpaceWarpGroupNode, RayRenderNode, RayMarchNode, MarchCameraNode, ForwardCameraNode, MarchPosNode, MarchDistNode, MarchWarpOutputNode, MarchLoopGroupNode, MarchLoopInputsNode, MarchLoopOutputNode, MarchSceneDistNode, GILitMarchGroupNode } from './scene3d';

// Color
export { PALETTE_GLSL_FN, PaletteNode, PALETTE_PRESET_OPTIONS, GradientNode, HSVNode, PosterizeNode, InvertNode, HueRangeNode,
  ColorRampNode, BlendModesNode, BrightnessContrastNode, BlackbodyNode,
  LiftGammaGainNode, HueRotateNode, SaturationNode, ShadowsHighlightsNode, ToneCurveNode } from './color';

// Output
export { OutputNode, Vec4OutputNode } from './output';

// Utility
export { ScopeNode } from './utility';

// Animation
export { LFONode, BPMSyncNode } from './animations';

// Halftone
export { GridUVNode, PixelateNode, DotMaskNode, SdfMaskNode, LumaRadiusNode, RGBToCMYKNode, CMYKHalftoneNode } from './halftone';

// GPU Particles (the engine in play/kit/gpuParticles.js)
export { GpuParticlesNode } from './gpuParticles';
export { PassNode, PassOutputNode, SampleTextureNode, EdgesTextureNode, BlurTextureNode, GlowTextureNode, DisplaceTextureNode, DisplacementMapNode, JumpFloodTextureNode } from './passes';
export { TextureMaskNode, TextureLevelsNode, TextureFlowNode, TextureNeighboursNode, TextureChangeNode, DistanceShapeNode, TextureFadeNode, ReadTextureNode } from './textureTools';
export { AgentsGroupNode, AgentInputsNode, AgentOutputNode, AgentStepOutNode, AgentSenseNode, AgentSteerNode, AgentMoveNode, AgentBySpeciesNode, AgentEmitNode, AgentDepositNode, TrailFieldNode, TrailStepOutNode, AgentProbeOutNode, DrawAgentsNode, SlimeMoldPresetNode, ParticlesPresetNode, CurlSmokePresetNode, SoundBurstPresetNode, MultiSlimePresetNode, AntsPresetNode, BoidsPresetNode, StrandsPresetNode, GrowPicturePresetNode, GalaxyPresetNode, MyceliumPresetNode, SandPlatePresetNode } from './agents';
export { AgentGravityNode, AgentWindNode, AgentCurlNode, AgentAttractNode, AgentVortexNode, AgentFlowNode, AgentSoundKickNode, AgentIntegrateNode, AgentAgeNode, AgentCollideNode, AgentChladniNode } from './agentForces';
export { AgentNeighboursNode } from './agentNeighbours';
export { AgentRideCurveNode } from './agentRideCurve';

// Math
export {
  AddNode, SubtractNode, MultiplyNode, DivideNode,
  SinNode, CosNode, TanNode, ExpNode, PowNode, NegateNode, LengthNode,
  TanhNode, MinMathNode, MaxNode, ClampNode, MixNode, ModNode, ModSelectNode,
  Atan2Node, CeilNode, FloorNode, SqrtNode, RoundNode, DotNode, QuantizeNode,
  MakeVec2Node, MakeVec3Node, FloatToVec3Node,
  FractRawNode, SmoothstepNode,
  NormalizeVec2Node,
  RemapNode,
  CrossProductNode, ReflectNode, ComplexMulNode, ComplexPowNode,
  AngleToVec2Node, Vec2AngleNode, LuminanceNode, SignNode, StepNode,
  WeightedAverageNode,
  CompareNode, SelectNode,
  Vec2SwizzleNode, Vec3SwizzleNode, SwizzleNode, MakeVec4Node,
  SplitVec2Node, SplitVec3Node, SplitVec4Node,
} from './math';


// Shapers
export {
  ExpEaseNode, DoubleExpSeatNode, DoubleExpSigmoidNode, LogisticSigmoidNode,
  CircularEaseInNode, CircularEaseOutNode,
  DoubleCircleSeatNode, DoubleCircleSigmoidNode, DoubleEllipticSigmoidNode,
  QuadBezierShaperNode, CubicBezierShaperNode,
} from './shapers';

// ─── Registry ─────────────────────────────────────────────────────────────────

import { UVNode, TimeNode, PixelUVNode, ConstantNode, MouseNode, TextureInputNode, PrevFrameNode, LoopIndexNode, AudioInputNode, FragCoordNode, ResolutionNode } from './sources';
import { ConstantsNode } from './constants';
import { PlayLayersNode } from './playLayers';
import { MotionMapNode } from './motionMap';
import { PadGridNode } from './padGrid';
import { EchoNode } from './echo';
import { GridPatternNode } from './gridPattern';
import { GridPaintNode } from './gridPaint';
import { ArrayFieldNode } from './arrayField';
import { FieldCellNode } from './fieldCell';
import { GridLayoutNode, WaveRadiusNode, NeighborDistNode, CellFilterNode, CellDisplaceNode, GridDensityWarpNode, NeighborOffset2dNode, AnimatedCellCenterNode, NeighborAttractCirclesNode } from './grid';
import { GaussianFieldNode, FieldAccumulateNode, MetaballThresholdNode, FieldToLinesNode, DistanceFalloffNode, NoisyGridSDFNode } from './gridField';
import { FractNode, Rotate2DNode, UVWarpNode, SmoothWarpNode, CurlWarpNode, SwirlWarpNode, DisplaceNode, UvTransform2dNode, UvReciprocalNode } from './transforms';
import {
  PolarSpaceNode, LogPolarSpaceNode, HyperbolicSpaceNode, InversionSpaceNode,
  MobiusSpaceNode, SwirlSpaceNode, KaleidoSpaceNode, SphericalSpaceNode,
  RippleSpaceNode, InfiniteRepeatSpaceNode,
  WaveTextureNode, MagicTextureNode, GridNode, ShearNode,
  Perspective2DNode,
  MirroredRepeat2DNode, LimitedRepeat2DNode, AngularRepeat2DNode, CrtScreenNode, LensDistortionNode, TurbulenceNode, ChaosLayersNode } from './spaces';
import { CircleSDFNode, BoxSDFNode, RingSDFNode, ShapeSDFNode, SimpleSDFNode } from './primitives';
import { SdSegmentNode, SdEllipseNode, SdfOffsetNode, SdfSharpenNode } from './sdf';
import {
  MaskNode, AddColorNode, GlowLayerNode, DeepGlowNode, SDFFillNode, SDFColorizeNode,
  AlphaBlendNode, Light2DNode,
} from './combiners';
import {
  AbsNode, ToneMapNode, GrainNode, LightNode,
  FractalLoopNode, RotatingLinesLoopNode, AccumulateLoopNode, ForLoopNode,
  ExprBlockNode, CustomFnNode, GravitationalLensNode, FloatWarpNode,
  VignetteNode, ScanlinesNode, SobelNode,
  RadianceCascadesApproxNode,
  GaussianBlurNode, BloomNode, RadialBlurNode, TiltShiftBlurNode, LensBlurNode, MotionBlurNode, DepthOfFieldNode,
  ChromaShiftNode, GlowToColorNode, NormalToColorNode, CrtMaskNode } from './effects';
import { LoopRippleStepNode, LoopRotateStepNode, LoopDomainFoldNode, LoopFloatAccumulateNode, LoopRingStepNode, LoopColorRingStepNode } from './loopPair';
import { LoopCarryNode } from './loop';
import { FBMNode, VoronoiNode, DomainWarpNode, FlowFieldNode, CirclePackNode, NoiseFloatNode, ScatterNode } from './noise';
import { MandelbrotNode, IFSNode, NewtonFractalNode, LyapunovNode, ApollonianNode, SphericalFoldFractalNode } from './fractals';
import { ChladniNode, WaveTermNode, ChladniFieldNode, ChladniSuperpositionNode, ChladniModeFreqNode } from './physics';
import { VectorFieldNode, GravityFieldNode, SpiralFieldNode } from './vectorFields';
import { RaymarchNode, VolumeCloudsNode, ChromaticAberrationNode, CombineRGBNode, MandelbulbNode,
  SdfAoNode, SoftShadowNode, MultiLightNode, Fresnel3DNode, FakeSSSNode, VolumetricFogNode, MaterialSelectNode, GlassNode,
  PhaseHGNode, FresnelSchlickNode, SpectralDispersionNode, BlinnPhongNode, GlassSceneNode,
} from './threed';
import { TruchetNode, MetaballsNode, LissajousNode } from './patterns';
import {
  SphereSDF3DNode, BoxSDF3DNode, TorusSDF3DNode, CapsuleSDF3DNode,
  CylinderSDF3DNode, ConeSDF3DNode, OctahedronSDF3DNode,
  Translate3DNode, Rotate3DNode, Repeat3DNode, Twist3DNode, Fold3DNode,
  PlaneSDF3DNode, Scale3DNode, RotateAxis3DNode, SinWarp3DNode, SpiralWarp3DNode,
  RoundedBoxSDF3DNode, BoxFrameSDF3DNode, EllipsoidSDF3DNode, CappedTorusSDF3DNode,
  LinkSDF3DNode, PyramidSDF3DNode, HexPrismSDF3DNode, TriPrismSDF3DNode,
  CappedConeSDF3DNode, RoundedCylinderSDF3DNode, SolidAngleSDF3DNode, VerticalCapsuleSDF3DNode,
  SDFUnionNode, SDFSubtractNode, SDFIntersectNode,
  SDFOnionNode,
  Bend3DNode, LimitedRepeat3DNode, PolarRepeat3DNode, Displace3DNode,
  MirroredRepeat3DNode, VoxelizeNode, SdCrossNode,
  SphereInvert3DNode, Shear3DNode, Kaleidoscope3DNode,
  MobiusWarp3DNode, LogPolarWarp3DNode, HelixWarp3DNode,
  GyroidFieldNode, SchwarzPFieldNode,
  MirrorFold3DNode, DomainWarp3DNode, Turbulence3DNode,
} from './sdf3d';
import { ScenePosNode, SceneGroupNode, SceneOutputNode, SpaceWarpGroupNode, RayRenderNode, RayMarchNode, MarchCameraNode, ForwardCameraNode, MarchPosNode, MarchDistNode, MarchWarpOutputNode, MarchLoopGroupNode, MarchLoopInputsNode, MarchLoopOutputNode, MarchSceneDistNode, GILitMarchGroupNode, VolumeGlowNode, VolumetricSceneNode, SceneBuilderNode } from './scene3d';
import { RepeatSceneNode, RepeatCellNode } from './repeatScene';
import { CurveTraceNode, CurveTrace3DNode, CurveBeamStepNode } from './curveTrace';
import { PaletteNode, GradientNode, HSVNode, PosterizeNode, InvertNode, HueRangeNode,
  ColorRampNode, BlendModesNode, BrightnessContrastNode, BlackbodyNode,
  LiftGammaGainNode, HueRotateNode, SaturationNode, ShadowsHighlightsNode, ToneCurveNode, OklabMixNode, ColorPickerNode, ColorizeNode, StopPaletteNode } from './color';
import { OutputNode, Vec4OutputNode } from './output';
import { GroupNode } from './group';
import { ScopeNode } from './utility';
import { Vec2ConstNode, MatConstNode, Mat2ConstructNode, Mat3ConstructNode, Mat2InspectNode, Mat3InspectNode, Mat2MulVecNode, Mat3MulVecNode, RotationMatrixNode } from './matrix';
import { Mat2MulNode, Mat3MulNode, Mat2InverseNode, Mat3InverseNode, Mat2MixNode, Mat3MixNode, ScaleMatrixNode, ShearMatrixNode, StretchMatrixNode, Mat3MulPointNode, CornerPinNode, ColorMatrixNode } from './matrixOps';
import { LFONode, BPMSyncNode } from './animations';
import {
  AddNode, SubtractNode, MultiplyNode, DivideNode,
  SinNode, CosNode, TanNode, ExpNode, PowNode, NegateNode, LengthNode,
  TanhNode, MinMathNode, MaxNode, ClampNode, MixNode, ModNode, ModSelectNode,
  Atan2Node, CeilNode, FloorNode, SqrtNode, RoundNode, DotNode, QuantizeNode,
  MakeVec2Node, MakeVec3Node, FloatToVec3Node,
  FractRawNode, SmoothstepNode,
  NormalizeVec2Node,
  RemapNode,
  CrossProductNode, ReflectNode, RefractDirNode, ComplexMulNode, ComplexPowNode,
  AngleToVec2Node, Vec2AngleNode, LuminanceNode, SignNode, StepNode,
  WeightedAverageNode,
  CompareNode, SelectNode,
  Vec2SwizzleNode, Vec3SwizzleNode, SwizzleNode, MakeVec4Node,
  SplitVec2Node, SplitVec3Node, SplitVec4Node,
  TransformVecNode,
} from './math';
import {
  ExpEaseNode, DoubleExpSeatNode, DoubleExpSigmoidNode, LogisticSigmoidNode,
  CircularEaseInNode, CircularEaseOutNode,
  DoubleCircleSeatNode, DoubleCircleSigmoidNode, DoubleEllipticSigmoidNode,
  QuadBezierShaperNode, CubicBezierShaperNode,
} from './shapers';
import { GridUVNode, PixelateNode, DotMaskNode, SdfMaskNode, LumaRadiusNode, RGBToCMYKNode, CMYKHalftoneNode } from './halftone';
import { GpuParticlesNode } from './gpuParticles';
import { BlurStageNode } from './blurStage';
import { GridRulesNode, GridRulesStepNode, MouseButtonNode } from './gridRules';
import { PassNode, PassOutputNode, SampleTextureNode, EdgesTextureNode, BlurTextureNode, GlowTextureNode, DisplaceTextureNode, DisplacementMapNode, JumpFloodTextureNode } from './passes';
import { TextureMaskNode, TextureLevelsNode, TextureFlowNode, TextureNeighboursNode, TextureChangeNode, DistanceShapeNode, TextureFadeNode, ReadTextureNode } from './textureTools';
import { AgentsGroupNode, AgentInputsNode, AgentOutputNode, AgentStepOutNode, AgentSenseNode, AgentSteerNode, AgentMoveNode, AgentBySpeciesNode, AgentEmitNode, AgentDepositNode, TrailFieldNode, TrailStepOutNode, AgentProbeOutNode, DrawAgentsNode, SlimeMoldPresetNode, ParticlesPresetNode, CurlSmokePresetNode, SoundBurstPresetNode, MultiSlimePresetNode, AntsPresetNode, BoidsPresetNode, StrandsPresetNode, GrowPicturePresetNode, GalaxyPresetNode, MyceliumPresetNode, SandPlatePresetNode } from './agents';
import { AgentNeighboursNode } from './agentNeighbours';
import { AgentRideCurveNode } from './agentRideCurve';
import { AgentGravityNode, AgentWindNode, AgentCurlNode, AgentAttractNode, AgentVortexNode, AgentFlowNode, AgentSoundKickNode, AgentIntegrateNode, AgentAgeNode, AgentCollideNode, AgentChladniNode, AgentCollideSceneNode, AgentGridOutNode } from './agentForces';

// Every setting of the Agents family has a "?" on its card: its hint, unless it has a fuller help of its own.
for (const d of [AgentsGroupNode, AgentSenseNode, AgentSteerNode, AgentMoveNode, AgentBySpeciesNode, AgentEmitNode, AgentDepositNode, TrailFieldNode, DrawAgentsNode,
  AgentGravityNode, AgentWindNode, AgentCurlNode, AgentAttractNode, AgentVortexNode, AgentFlowNode, AgentSoundKickNode, AgentIntegrateNode, AgentAgeNode, AgentCollideNode, AgentChladniNode, AgentCollideSceneNode, AgentNeighboursNode, AgentRideCurveNode]) {
  for (const pd of Object.values(d.paramDefs ?? {})) if (pd.hint && !pd.help) pd.help = pd.hint;
}

export const NODE_REGISTRY: Record<string, NodeDefinition> = {
  // Sources
  uv: UVNode,
  pixelUV: PixelUVNode,
  fragCoord: FragCoordNode,
  resolution: ResolutionNode,
  time: TimeNode,
  constant: ConstantNode,
  constants: ConstantsNode,
  mouse: MouseNode,
  textureInput: TextureInputNode,
  prevFrame: PrevFrameNode,
  echo: EchoNode,
  loopIndex: LoopIndexNode,
  audioInput: AudioInputNode,
  videoInput: VideoInputNode,
  baked: BakedNode,
  // Depth (docs/depth-node.md): a picture's depth from an on-device model
  depth: DepthNode,
  // Time cube (docs/time-cube.md): a video as a box of time
  lift4D: Lift4DNode,
  rotate4D: Rotate4DNode,
  translate4D: Translate4DNode,
  hypersphereSDF: HypersphereSDFNode,
  tesseractSDF: TesseractSDFNode,
  ...FOURD_P2_NODES,
  ...FOURD_P3_NODES,
  ...FOURD_P4_NODES,
  // The 2D Scene Builder's small nodes (docs/scene-builder-2d-plan.md)
  ...SCENE2D_NODES,
  timeCube: TimeCubeNode,
  timeSlice: TimeSliceNode,
  timeCubeView: TimeCubeViewNode,
  // Frame Stack (docs/frame-stack.md): a Time Cube's frames as cards to arrange
  frameStack: FrameStackNode,
  midiInput: MidiInputNode,
  data: DataNode,
  playLayers: PlayLayersNode,
  motionMap: MotionMapNode,
  padGrid: PadGridNode,
  // Transforms
  fract: FractNode,
  rotate2d: Rotate2DNode,
  uvWarp: UVWarpNode,
  smoothWarp: SmoothWarpNode,
  curlWarp: CurlWarpNode,
  swirlWarp: SwirlWarpNode,
  displace: DisplaceNode,
  uvTransform2d: UvTransform2dNode,
  uvReciprocal: UvReciprocalNode,
  // Matrix
  vec2Const: Vec2ConstNode,
  matConst: MatConstNode,
  mat2Construct: Mat2ConstructNode,
  mat3Construct: Mat3ConstructNode,
  mat2Inspect: Mat2InspectNode,
  mat3Inspect: Mat3InspectNode,
  mat2MulVec: Mat2MulVecNode,
  mat3MulVec: Mat3MulVecNode,
  // Spaces
  polarSpace: PolarSpaceNode,
  logPolarSpace: LogPolarSpaceNode,
  hyperbolicSpace: HyperbolicSpaceNode,
  inversionSpace: InversionSpaceNode,
  mobiusSpace: MobiusSpaceNode,
  swirlSpace: SwirlSpaceNode,
  kaleidoSpace: KaleidoSpaceNode,
  sphericalSpace: SphericalSpaceNode,
  rippleSpace: RippleSpaceNode,
  infiniteRepeatSpace: InfiniteRepeatSpaceNode,
  waveTexture: WaveTextureNode,
  magicTexture: MagicTextureNode,
  grid: GridNode,
  gridLayout: GridLayoutNode,
  waveRadius: WaveRadiusNode,
  neighborDist: NeighborDistNode,
  cellFilter: CellFilterNode,
  cellDisplace: CellDisplaceNode,
  gridDensityWarp: GridDensityWarpNode,
  gridPattern: GridPatternNode,
  gridPaint: GridPaintNode,
  arrayField: ArrayFieldNode,
  fieldCell: FieldCellNode,
  neighborOffset2d: NeighborOffset2dNode,
  animatedCellCenter: AnimatedCellCenterNode,
  neighborAttractCircles: NeighborAttractCirclesNode,
  // Field / Metaball
  gaussianField: GaussianFieldNode,
  fieldAccumulate: FieldAccumulateNode,
  metaballThreshold: MetaballThresholdNode,
  fieldToLines: FieldToLinesNode,
  distanceFalloff: DistanceFalloffNode,
  noisyGridSDF: NoisyGridSDFNode,
  shear: ShearNode,
  perspective2d: Perspective2DNode,
  mirroredRepeat2D: MirroredRepeat2DNode,
  limitedRepeat2D: LimitedRepeat2DNode,
  angularRepeat2D: AngularRepeat2DNode,
  // 2D Primitives
  circleSDF: CircleSDFNode,
  boxSDF: BoxSDFNode,
  ringSDF: RingSDFNode,
  shapeSDF: ShapeSDFNode,
  simpleSDF: SimpleSDFNode,
  // SDF (IQ)
  sdSegment: SdSegmentNode,
  sdEllipse: SdEllipseNode,
  // SDF 2D Ops
  sdfOffset: SdfOffsetNode,
  sdfSharpen: SdfSharpenNode,
  // Combiners
  mask: MaskNode,
  addColor: AddColorNode,
  glowLayer: GlowLayerNode,
  deepGlow: DeepGlowNode,
  sdfFill: SDFFillNode,
  sdfColorize: SDFColorizeNode,
  alphaBlend: AlphaBlendNode,
  light2d: Light2DNode,
  // Effects
  abs: AbsNode,
  glowToColor: GlowToColorNode,
  crtMask: CrtMaskNode,
  oklabMix: OklabMixNode,
  colorPicker: ColorPickerNode,
  colorize: ColorizeNode,
  stopPalette: StopPaletteNode,
  crtScreen: CrtScreenNode,
  lensDistortion: LensDistortionNode,
  turbulence: TurbulenceNode,
  chaosLayers: ChaosLayersNode,
  normalToColor: NormalToColorNode,
  rotationMatrix: RotationMatrixNode,
  mat2Mul: Mat2MulNode,
  mat3Mul: Mat3MulNode,
  mat2Inverse: Mat2InverseNode,
  mat3Inverse: Mat3InverseNode,
  mat2Mix: Mat2MixNode,
  mat3Mix: Mat3MixNode,
  scaleMatrix: ScaleMatrixNode,
  shearMatrix: ShearMatrixNode,
  stretchMatrix: StretchMatrixNode,
  mat3MulPoint: Mat3MulPointNode,
  cornerPin: CornerPinNode,
  colorMatrix: ColorMatrixNode,
  volumeGlow: VolumeGlowNode,
  toneMap: ToneMapNode,
  grain: GrainNode,
  light: LightNode,
  fractalLoop: FractalLoopNode,
  rotatingLinesLoop: RotatingLinesLoopNode,
  accumulateLoop: AccumulateLoopNode,
  forLoop: ForLoopNode,
  exprNode: ExprBlockNode,
  customFn: CustomFnNode,
  gravitationalLens: GravitationalLensNode,
  floatWarp: FloatWarpNode,
  vignette: VignetteNode,
  scanlines: ScanlinesNode,
  sobel: SobelNode,
  radianceCascadesApprox: RadianceCascadesApproxNode,
  gaussianBlur: GaussianBlurNode,
  bloom: BloomNode,
  radialBlur: RadialBlurNode,
  tiltShiftBlur: TiltShiftBlurNode,
  lensBlur: LensBlurNode,
  motionBlur: MotionBlurNode,
  depthOfField: DepthOfFieldNode,
  chromaShift: ChromaShiftNode,
  // Loops
  loopCarry:             LoopCarryNode,
  loopRippleStep:        LoopRippleStepNode,
  loopRotateStep:        LoopRotateStepNode,
  loopDomainFold:        LoopDomainFoldNode,
  loopFloatAccumulate:   LoopFloatAccumulateNode,
  loopRingStep:          LoopRingStepNode,
  loopColorRingStep:     LoopColorRingStepNode,
  // Noise
  fbm: FBMNode,
  voronoi: VoronoiNode,
  domainWarp: DomainWarpNode,
  flowField: FlowFieldNode,
  circlePack: CirclePackNode,
  noiseFloat: NoiseFloatNode,
  scatter: ScatterNode,
  // Fractals
  mandelbrot: MandelbrotNode,
  ifs: IFSNode,
  newtonFractal: NewtonFractalNode,
  lyapunov: LyapunovNode,
  apollonian: ApollonianNode,
  sphericalFoldFractal: SphericalFoldFractalNode,
  // Physics
  chladni: ChladniNode,
  waveTerm: WaveTermNode,
  chladniField: ChladniFieldNode,
  chladniSuperposition: ChladniSuperpositionNode,
  chladniModeFreq: ChladniModeFreqNode,
  // Vector fields
  vectorField:     VectorFieldNode,
  gravityField:    GravityFieldNode,
  spiralField:     SpiralFieldNode,
  // GPU Particles
  gpuParticles: GpuParticlesNode,
  // Passes (render to texture): docs/pass-node-plan.md
  pass: PassNode,
  passOutput: PassOutputNode,
  blurStage: BlurStageNode,
  // Grid Rules (docs/grid-rules.md): a cellular simulation in one node, and the step the compiler makes of it
  gridRules: GridRulesNode,
  gridRulesStep: GridRulesStepNode,
  mouseButton: MouseButtonNode,
  sampleTexture: SampleTextureNode,
  edgesTexture: EdgesTextureNode,
  blurTexture: BlurTextureNode,
  glowTexture: GlowTextureNode,
  displaceTexture: DisplaceTextureNode,
  displacementMap: DisplacementMapNode,
  jumpFloodTexture: JumpFloodTextureNode,
  // Texture tools (docs/texture-tools.md): shaping what a texture read gives
  textureMask: TextureMaskNode,
  textureLevels: TextureLevelsNode,
  textureFlow: TextureFlowNode,
  textureNeighbours: TextureNeighboursNode,
  textureChange: TextureChangeNode,
  distanceShape: DistanceShapeNode,
  textureFade: TextureFadeNode,
  readTexture: ReadTextureNode,
  // Agents (slime mold and walkers built from nodes): docs/agents-plan.md
  agentsGroup: AgentsGroupNode,
  agentInputs: AgentInputsNode,
  agentOutput: AgentOutputNode,
  agentStepOut: AgentStepOutNode,
  agentSense: AgentSenseNode,
  agentSteer: AgentSteerNode,
  agentMove: AgentMoveNode,
  agentBySpecies: AgentBySpeciesNode,
  agentEmit: AgentEmitNode,
  agentDeposit: AgentDepositNode,
  trailField: TrailFieldNode,
  drawAgents: DrawAgentsNode,
  trailStepOut: TrailStepOutNode,
  agentProbeOut: AgentProbeOutNode,
  agentCollideScene: AgentCollideSceneNode,
  agentNeighbours: AgentNeighboursNode,
  agentRideCurve: AgentRideCurveNode,
  agentGridOut: AgentGridOutNode,
  multiSlimePreset: MultiSlimePresetNode,
  antsPreset: AntsPresetNode,
  boidsPreset: BoidsPresetNode,
  strandsPreset: StrandsPresetNode,
  growPicturePreset: GrowPicturePresetNode,
  galaxyPreset: GalaxyPresetNode,
  myceliumPreset: MyceliumPresetNode,
  sandPlatePreset: SandPlatePresetNode,
  slimeMoldPreset: SlimeMoldPresetNode,
  particlesPreset: ParticlesPresetNode,
  curlSmokePreset: CurlSmokePresetNode,
  soundBurstPreset: SoundBurstPresetNode,
  // Particles inside an Agents group (P2): forces, Integrate, Age / Life, Collide, Chladni.
  agentGravity: AgentGravityNode,
  agentWind: AgentWindNode,
  agentCurl: AgentCurlNode,
  agentAttract: AgentAttractNode,
  agentVortex: AgentVortexNode,
  agentFlow: AgentFlowNode,
  agentSoundKick: AgentSoundKickNode,
  agentIntegrate: AgentIntegrateNode,
  agentAge: AgentAgeNode,
  agentCollide: AgentCollideNode,
  agentChladni: AgentChladniNode,
  // 3D / Volumetric
  raymarch3d: RaymarchNode,
  volumeClouds: VolumeCloudsNode,
  chromaticAberration: ChromaticAberrationNode,
  combineRGB: CombineRGBNode,
  mandelbulb: MandelbulbNode,
  // 3D Lighting
  sdfAo: SdfAoNode,
  softShadow: SoftShadowNode,
  multiLight: MultiLightNode,
  fresnel3d: Fresnel3DNode,
  fakeSSS: FakeSSSNode,
  volumetricFog: VolumetricFogNode,
  materialSelect: MaterialSelectNode,
  glass3d: GlassNode,
  phaseHG: PhaseHGNode,
  fresnelSchlick: FresnelSchlickNode,
  spectralDispersion: SpectralDispersionNode,
  blinnPhong: BlinnPhongNode,
  glassScene: GlassSceneNode,
  // Patterns
  truchet: TruchetNode,
  metaballs: MetaballsNode,
  lissajous: LissajousNode,
  // 3D SDF Primitives
  sphereSDF3D: SphereSDF3DNode,
  boxSDF3D: BoxSDF3DNode,
  torusSDF3D: TorusSDF3DNode,
  capsuleSDF3D: CapsuleSDF3DNode,
  cylinderSDF3D: CylinderSDF3DNode,
  coneSDF3D: ConeSDF3DNode,
  octahedronSDF3D: OctahedronSDF3DNode,
  planeSDF3D: PlaneSDF3DNode,
  // 3D Primitives (new)
  roundedBoxSDF3D: RoundedBoxSDF3DNode,
  boxFrameSDF3D: BoxFrameSDF3DNode,
  ellipsoidSDF3D: EllipsoidSDF3DNode,
  cappedTorusSDF3D: CappedTorusSDF3DNode,
  linkSDF3D: LinkSDF3DNode,
  pyramidSDF3D: PyramidSDF3DNode,
  hexPrismSDF3D: HexPrismSDF3DNode,
  triPrismSDF3D: TriPrismSDF3DNode,
  cappedConeSDF3D: CappedConeSDF3DNode,
  roundedCylinderSDF3D: RoundedCylinderSDF3DNode,
  solidAngleSDF3D: SolidAngleSDF3DNode,
  verticalCapsuleSDF3D: VerticalCapsuleSDF3DNode,
  // 3D Boolean Ops (new)
  sdfUnion: SDFUnionNode,
  sdfSubtract: SDFSubtractNode,
  sdfIntersect: SDFIntersectNode,
  sdfOnion: SDFOnionNode,
  // 3D Transforms
  translate3D: Translate3DNode,
  rotate3D: Rotate3DNode,
  repeat3D: Repeat3DNode,
  twist3D: Twist3DNode,
  fold3D: Fold3DNode,
  scale3d: Scale3DNode,
  rotateAxis3D: RotateAxis3DNode,
  sinWarp3D: SinWarp3DNode,
  spiralWarp3D: SpiralWarp3DNode,
  // 3D Transforms (new)
  bend3D: Bend3DNode,
  limitedRepeat3D: LimitedRepeat3DNode,
  polarRepeat3D: PolarRepeat3DNode,
  displace3D: Displace3DNode,
  mirroredRepeat3D: MirroredRepeat3DNode,
  voxelize: VoxelizeNode,
  sdCross3D: SdCrossNode,
  sphereInvert3D: SphereInvert3DNode,
  shear3D: Shear3DNode,
  kaleidoscope3D: Kaleidoscope3DNode,
  mobiusWarp3D: MobiusWarp3DNode,
  logPolarWarp3D: LogPolarWarp3DNode,
  helixWarp3D: HelixWarp3DNode,
  // 3D TPMS / Field Nodes
  gyroidField:   GyroidFieldNode,
  schwarzPField: SchwarzPFieldNode,
  mirrorFold3D:  MirrorFold3DNode,
  domainWarp3D:  DomainWarp3DNode,
  turbulence3D:  Turbulence3DNode,
  // 3D Scene (composable)
  scenePos: ScenePosNode,
  sceneOutput: SceneOutputNode,
  sceneGroup: SceneGroupNode,
  spaceWarpGroup: SpaceWarpGroupNode,
  rayRender: RayRenderNode,
  rayMarch: RayMarchNode,
  marchCamera: MarchCameraNode,
  forwardCamera: ForwardCameraNode,  // kept for backward compat — not shown in palette
  marchPos: MarchPosNode,
  marchDist: MarchDistNode,
  marchOutput: MarchWarpOutputNode,
  marchLoopGroup: MarchLoopGroupNode,
  marchLoopInputs: MarchLoopInputsNode,
  marchLoopOutput: MarchLoopOutputNode,
  marchSceneDist: MarchSceneDistNode,
  giLitMarchGroup: GILitMarchGroupNode,
  volumetricScene: VolumetricSceneNode,
  sceneBuilder: SceneBuilderNode,
  repeatScene: RepeatSceneNode,
  repeatCell: RepeatCellNode,
  curveTrace: CurveTraceNode,
  curveTrace3D: CurveTrace3DNode,
  curveTraceBeamStep: CurveBeamStepNode,
  // Color
  palette: PaletteNode,
  gradient: GradientNode,
  hsv: HSVNode,
  posterize: PosterizeNode,
  invert: InvertNode,
  hueRange: HueRangeNode,
  colorRamp: ColorRampNode,
  blendModes: BlendModesNode,
  brightnessContrast: BrightnessContrastNode,
  blackbody: BlackbodyNode,
  liftGammaGain: LiftGammaGainNode,
  hueRotate: HueRotateNode,
  colorSaturation: SaturationNode,
  shadowsHighlights: ShadowsHighlightsNode,
  toneCurve: ToneCurveNode,
  // Output
  output: OutputNode,
  vec4Output: Vec4OutputNode,
  // Utility
  group: GroupNode,
  scope: ScopeNode,
  // Math
  add: AddNode,
  subtract: SubtractNode,
  multiply: MultiplyNode,
  divide: DivideNode,
  sin: SinNode,
  cos: CosNode,
  tan: TanNode,
  exp: ExpNode,
  pow: PowNode,
  negate: NegateNode,
  length: LengthNode,
  tanh: TanhNode,
  minMath: MinMathNode,
  max: MaxNode,
  clamp: ClampNode,
  mix: MixNode,
  mod: ModNode,
  modSelect: ModSelectNode,
  atan2: Atan2Node,
  ceil: CeilNode,
  floor: FloorNode,
  sqrt: SqrtNode,
  round: RoundNode,
  dot: DotNode,
  quantize: QuantizeNode,
  makeVec2: MakeVec2Node,
  splitVec2: SplitVec2Node,
  splitVec3: SplitVec3Node,
  splitVec4: SplitVec4Node,
  transformVec: TransformVecNode,
  makeVec3: MakeVec3Node,
  floatToVec3: FloatToVec3Node,
  fractRaw: FractRawNode,
  smoothstep: SmoothstepNode,
  normalizeVec2: NormalizeVec2Node,
  remap: RemapNode,
  // Shapers
  expEase: ExpEaseNode,
  doubleExpSeat: DoubleExpSeatNode,
  doubleExpSigmoid: DoubleExpSigmoidNode,
  logisticSigmoid: LogisticSigmoidNode,
  circularEaseIn: CircularEaseInNode,
  circularEaseOut: CircularEaseOutNode,
  doubleCircleSeat: DoubleCircleSeatNode,
  doubleCircleSigmoid: DoubleCircleSigmoidNode,
  doubleEllipticSigmoid: DoubleEllipticSigmoidNode,
  quadBezierShaper: QuadBezierShaperNode,
  cubicBezierShaper: CubicBezierShaperNode,
  crossProduct: CrossProductNode,
  reflect: ReflectNode,
  refractDir: RefractDirNode,
  complexMul: ComplexMulNode,
  complexPow: ComplexPowNode,
  angleToVec2: AngleToVec2Node,
  vec2Angle: Vec2AngleNode,
  luminance: LuminanceNode,
  sign: SignNode,
  step: StepNode,
  weightedAverage: WeightedAverageNode,
  compare: CompareNode,
  select: SelectNode,
  vec2Swizzle: Vec2SwizzleNode,
  vec3Swizzle: Vec3SwizzleNode,
  swizzle: SwizzleNode,
  makeVec4: MakeVec4Node,
  // Halftone
  gridUV:       GridUVNode,
  pixelate:     PixelateNode,
  dotMask:      DotMaskNode,
  sdfMask:      SdfMaskNode,
  lumaRadius:   LumaRadiusNode,
  rgbToCMYK:    RGBToCMYKNode,
  cmykHalftone: CMYKHalftoneNode,
  // Animation
  lfo: LFONode,
  bpmSync: BPMSyncNode,
};

/** Built-ins first, then user-published node types (see nodes/userNodes/userNodeRegistry.ts). */
export function getNodeDefinition(type: string): NodeDefinition | undefined {
  // Built-ins, then user-published nodes, then merged (aliased) types — see ./aliases.ts.
  const def = NODE_REGISTRY[type] ?? getUserNodeDefinition(type) ?? (NODE_ALIASES[type] ? NODE_REGISTRY[NODE_ALIASES[type].to] : undefined);
  // Every definition applies input expressions (glsl/inputExpr) before its own
  // GLSL, so every compile path (top level, groups, iterated groups) gets them.
  return def ? withInputExpressions(def) : undefined;
}

/**
 * The definition as it applies to one node: the same as getNodeDefinition
 * unless the type declares `paramDefsFor`, in which case the instance's own
 * param definitions (and its sockets) are merged in. Cached per node object;
 * the store replaces the object on every change, so the cache follows.
 */
let perNodeDefs = new WeakMap<GraphNode, NodeDefinition>();
/** Forget every per-node definition (Rebuild: the next compile works them all out again). */
export function clearNodeDefinitionCache(): void {
  perNodeDefs = new WeakMap();
}
export function getNodeDefinitionFor(node: GraphNode): NodeDefinition | undefined {
  const def = getNodeDefinition(node.type);
  if (!def) return def;
  let d = perNodeDefs.get(node);
  if (!d) {
    // An input expression's knobs (glsl/inputExpr) are float params of this instance.
    const knobs = knobParamDefs(node);
    d = !def.paramDefsFor && !knobs ? def : def.paramDefsFor
      ? { ...def, paramDefs: { ...(def.paramDefs ?? {}), ...def.paramDefsFor(node), ...knobs }, outputs: Object.keys(node.outputs).length ? node.outputs : def.outputs }
      : { ...def, paramDefs: { ...(def.paramDefs ?? {}), ...knobs } };
    perNodeDefs.set(node, d);
  }
  return d;
}

/** Every definition that can be offered for adding: built-ins plus user nodes.
 *  Deprecated ones stay in the registry (saved graphs still load) but aren't listed. */
export function getOfferedDefinitions(): NodeDefinition[] {
  return [...Object.values(NODE_REGISTRY), ...getAllUserNodeDefinitions()].filter(n => !n.deprecated);
}

export function getNodesByCategory(category: string): NodeDefinition[] {
  return getOfferedDefinitions().filter(n => n.category === category);
}

export function getAllCategories(): string[] {
  return [...new Set(getOfferedDefinitions().map(n => n.category))];
}
