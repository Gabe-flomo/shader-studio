// ─── Node Definitions — thin aggregator ──────────────────────────────────────
// Each category lives in its own file. This module re-exports everything and
// builds the unified NODE_REGISTRY consumed by the rest of the app.

import type { NodeDefinition } from '../../types/nodeGraph';

// Sources
export { UVNode, TimeNode, PixelUVNode, ConstantNode, MouseNode, TextureInputNode, PrevFrameNode, LoopIndexNode, AudioInputNode } from './sources';

// Transforms
export { FractNode, Rotate2DNode, UVWarpNode, SmoothWarpNode, CurlWarpNode, SwirlWarpNode, DisplaceNode } from './transforms';

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
export { SdBoxNode, SdSegmentNode, SdEllipseNode, OpRepeatNode, OpRepeatPolarNode } from './sdf';

// Combiners
export {
  SmoothMinNode, MinNode, MaxNode2, SubtractNode2,
  SmoothMaxNode, SmoothSubtractNode,
  BlendNode, MaskNode, AddColorNode, ScreenBlendNode,
  GlowLayerNode, SDFOutlineNode, SDFColorizeNode,
  AlphaBlendNode, Light2DNode,
} from './combiners';

// Effects / Loops
export {
  MakeLightNode, AbsNode, ToneMapNode, GrainNode, LumaGrainNode, TemporalGrainNode, LightNode,
  FractalLoopNode, RotatingLinesLoopNode, AccumulateLoopNode, ForLoopNode,
  ExprBlockNode, CustomFnNode, GravitationalLensNode, FloatWarpNode,
  VignetteNode, ScanlinesNode, SobelNode,
  RadianceCascadesApproxNode,
  GaussianBlurNode, RadialBlurNode, TiltShiftBlurNode, LensBlurNode, MotionBlurNode, DepthOfFieldNode,
  ChromaShiftNode,
} from './effects';
export { LoopStartNode, LoopEndNode, LoopRippleStepNode, LoopRotateStepNode, LoopDomainFoldNode, LoopFloatAccumulateNode, LoopRingStepNode, LoopColorRingStepNode } from './loopPair';
export { LoopCarryNode } from './loop';

// Noise
export { FBMNode, VoronoiNode, DomainWarpNode, FlowFieldNode, CirclePackNode, NoiseFloatNode } from './noise';

// Fractals
export { MandelbrotNode, IFSNode, NewtonFractalNode, LyapunovNode, ApollonianNode, SphericalFoldFractalNode } from './fractals';

// Physics
export { ChladniNode, ElectronOrbitalNode, Chladni3DNode, Chladni3DParticlesNode } from './physics';

// Particles & Fields
export { ParticleEmitterNode, VectorFieldNode, GravityFieldNode, SpiralFieldNode } from './particles';

// 3D / Volumetric
export { RaymarchNode, VolumeCloudsNode, ChromaticAberrationNode, CombineRGBNode, OrbitalVolume3DNode, MandelbulbNode } from './threed';

// 3D Lighting
export { SdfAoNode, SoftShadowNode, MultiLightNode, Fresnel3DNode, FakeSSSNode, VolumetricFogNode, MaterialSelectNode, GlassNode, PhaseHGNode, FresnelSchlickNode } from './threed';

// 3D Fractals (additional)
export { MandelboxDENode, KIFSTetrahedronDENode } from './threed';

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
  SDFSmoothUnionNode, SDFSmoothSubtractNode, SDFSmoothIntersectNode,
  SDFRoundNode, SDFOnionNode,
  Bend3DNode, LimitedRepeat3DNode, PolarRepeat3DNode, Displace3DNode,
  MirroredRepeat3DNode, SdCrossNode, MengerSpongeNode,
  SphereInvert3DNode, Shear3DNode, Kaleidoscope3DNode,
  MobiusWarp3DNode, LogPolarWarp3DNode, HelixWarp3DNode,
  GyroidFieldNode, SchwarzPFieldNode,
  MirrorFold3DNode, DomainWarp3DNode,
} from './sdf3d';

// 3D Scene (composable)
export { ScenePosNode, SceneGroupNode, SceneOutputNode, SpaceWarpGroupNode, RayRenderNode, RayMarchNode, MarchCameraNode, ForwardCameraNode, MarchPosNode, MarchDistNode, MarchWarpOutputNode, MarchLoopGroupNode, MarchLoopInputsNode, MarchLoopOutputNode, MarchSceneDistNode } from './scene3d';

// Color
export { PALETTE_GLSL_FN, PaletteNode, PalettePresetNode, PALETTE_PRESET_OPTIONS, GradientNode, HSVNode, PosterizeNode, InvertNode, DesaturateNode, HueRangeNode,
  ColorRampNode, BlendModesNode, BrightnessContrastNode, BlackbodyNode } from './color';

// Output
export { OutputNode, Vec4OutputNode } from './output';

// Utility
export { ScopeNode } from './utility';

// Animation
export { SineLFONode, SquareLFONode, SawtoothLFONode, TriangleLFONode, BPMSyncNode } from './animations';

// Math
export {
  AddNode, SubtractNode, MultiplyNode, DivideNode,
  SinNode, CosNode, ExpNode, PowNode, NegateNode, LengthNode,
  MultiplyVec3Node, AddVec3Node,
  TanhNode, MinMathNode, MaxNode, ClampNode, MixNode, MixVec3Node, ModNode,
  Atan2Node, CeilNode, FloorNode, SqrtNode, RoundNode, DotNode,
  MakeVec2Node, ExtractXNode, ExtractYNode, MakeVec3Node, FloatToVec3Node,
  FractRawNode, SmoothstepNode,
  AddVec2Node, MultiplyVec2Node, NormalizeVec2Node,
  RemapNode,
  CrossProductNode, ReflectNode, ComplexMulNode, ComplexPowNode,
  AngleToVec2Node, Vec2AngleNode, LuminanceNode, SignNode, StepNode,
  WeightedAverageNode,
  CompareNode, SelectNode,
  Vec2SwizzleNode, Vec3SwizzleNode,
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

import { UVNode, TimeNode, PixelUVNode, ConstantNode, MouseNode, TextureInputNode, PrevFrameNode, LoopIndexNode, AudioInputNode } from './sources';
import { FractNode, Rotate2DNode, UVWarpNode, SmoothWarpNode, CurlWarpNode, SwirlWarpNode, DisplaceNode } from './transforms';
import {
  PolarSpaceNode, LogPolarSpaceNode, HyperbolicSpaceNode, InversionSpaceNode,
  MobiusSpaceNode, SwirlSpaceNode, KaleidoSpaceNode, SphericalSpaceNode,
  RippleSpaceNode, InfiniteRepeatSpaceNode,
  WaveTextureNode, MagicTextureNode, GridNode, ShearNode,
  Perspective2DNode,
  MirroredRepeat2DNode, LimitedRepeat2DNode, AngularRepeat2DNode,
} from './spaces';
import { CircleSDFNode, BoxSDFNode, RingSDFNode, ShapeSDFNode, SimpleSDFNode } from './primitives';
import { SdBoxNode, SdSegmentNode, SdEllipseNode, OpRepeatNode, OpRepeatPolarNode } from './sdf';
import {
  SmoothMinNode, MinNode, MaxNode2,
  SmoothMaxNode, SmoothSubtractNode,
  BlendNode, MaskNode, AddColorNode, ScreenBlendNode,
  GlowLayerNode, SDFOutlineNode, SDFColorizeNode,
  AlphaBlendNode, Light2DNode,
} from './combiners';
import {
  MakeLightNode, AbsNode, ToneMapNode, GrainNode, LumaGrainNode, TemporalGrainNode, LightNode,
  FractalLoopNode, RotatingLinesLoopNode, AccumulateLoopNode, ForLoopNode,
  ExprBlockNode, CustomFnNode, GravitationalLensNode, FloatWarpNode,
  VignetteNode, ScanlinesNode, SobelNode,
  RadianceCascadesApproxNode,
  GaussianBlurNode, RadialBlurNode, TiltShiftBlurNode, LensBlurNode, MotionBlurNode, DepthOfFieldNode,
  ChromaShiftNode,
} from './effects';
import { LoopStartNode, LoopEndNode, LoopRippleStepNode, LoopRotateStepNode, LoopDomainFoldNode, LoopFloatAccumulateNode, LoopRingStepNode, LoopColorRingStepNode } from './loopPair';
import { LoopCarryNode } from './loop';
import { FBMNode, VoronoiNode, DomainWarpNode, FlowFieldNode, CirclePackNode, NoiseFloatNode } from './noise';
import { MandelbrotNode, IFSNode, NewtonFractalNode, LyapunovNode, ApollonianNode, SphericalFoldFractalNode } from './fractals';
import { ChladniNode, ElectronOrbitalNode, Chladni3DNode, Chladni3DParticlesNode } from './physics';
import { ParticleEmitterNode, VectorFieldNode, GravityFieldNode, SpiralFieldNode } from './particles';
import { RaymarchNode, VolumeCloudsNode, ChromaticAberrationNode, CombineRGBNode, OrbitalVolume3DNode, MandelbulbNode,
  SdfAoNode, SoftShadowNode, MultiLightNode, Fresnel3DNode, FakeSSSNode, VolumetricFogNode, MaterialSelectNode, GlassNode,
  MandelboxDENode, KIFSTetrahedronDENode, PhaseHGNode, FresnelSchlickNode,
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
  SDFSmoothUnionNode, SDFSmoothSubtractNode, SDFSmoothIntersectNode,
  SDFRoundNode, SDFOnionNode,
  Bend3DNode, LimitedRepeat3DNode, PolarRepeat3DNode, Displace3DNode,
  MirroredRepeat3DNode, SdCrossNode, MengerSpongeNode,
  SphereInvert3DNode, Shear3DNode, Kaleidoscope3DNode,
  MobiusWarp3DNode, LogPolarWarp3DNode, HelixWarp3DNode,
  GyroidFieldNode, SchwarzPFieldNode,
  MirrorFold3DNode, DomainWarp3DNode,
} from './sdf3d';
import { ScenePosNode, SceneGroupNode, SceneOutputNode, SpaceWarpGroupNode, RayRenderNode, RayMarchNode, MarchCameraNode, ForwardCameraNode, MarchPosNode, MarchDistNode, MarchWarpOutputNode, MarchLoopGroupNode, MarchLoopInputsNode, MarchLoopOutputNode, MarchSceneDistNode } from './scene3d';
import { PaletteNode, PalettePresetNode, GradientNode, HSVNode, PosterizeNode, InvertNode, DesaturateNode, HueRangeNode,
  ColorRampNode, BlendModesNode, BrightnessContrastNode, BlackbodyNode } from './color';
import { OutputNode, Vec4OutputNode } from './output';
import { GroupNode } from './group';
import { ScopeNode } from './utility';
import { SineLFONode, SquareLFONode, SawtoothLFONode, TriangleLFONode, BPMSyncNode } from './animations';
import {
  AddNode, SubtractNode, MultiplyNode, DivideNode,
  SinNode, CosNode, ExpNode, PowNode, NegateNode, LengthNode,
  MultiplyVec3Node, AddVec3Node,
  TanhNode, MinMathNode, MaxNode, ClampNode, MixNode, MixVec3Node, ModNode,
  Atan2Node, CeilNode, FloorNode, SqrtNode, RoundNode, DotNode,
  MakeVec2Node, ExtractXNode, ExtractYNode, MakeVec3Node, FloatToVec3Node,
  FractRawNode, SmoothstepNode,
  AddVec2Node, MultiplyVec2Node, NormalizeVec2Node,
  RemapNode,
  CrossProductNode, ReflectNode, RefractDirNode, ComplexMulNode, ComplexPowNode,
  AngleToVec2Node, Vec2AngleNode, LuminanceNode, SignNode, StepNode,
  WeightedAverageNode,
  CompareNode, SelectNode,
  Vec2SwizzleNode, Vec3SwizzleNode,
  SplitVec2Node, SplitVec3Node, SplitVec4Node,
  TransformVecNode,
} from './math';
import {
  ExpEaseNode, DoubleExpSeatNode, DoubleExpSigmoidNode, LogisticSigmoidNode,
  CircularEaseInNode, CircularEaseOutNode,
  DoubleCircleSeatNode, DoubleCircleSigmoidNode, DoubleEllipticSigmoidNode,
  QuadBezierShaperNode, CubicBezierShaperNode,
} from './shapers';

export const NODE_REGISTRY: Record<string, NodeDefinition> = {
  // Sources
  uv: UVNode,
  pixelUV: PixelUVNode,
  time: TimeNode,
  constant: ConstantNode,
  mouse: MouseNode,
  textureInput: TextureInputNode,
  prevFrame: PrevFrameNode,
  loopIndex: LoopIndexNode,
  audioInput: AudioInputNode,
  // Transforms
  fract: FractNode,
  rotate2d: Rotate2DNode,
  uvWarp: UVWarpNode,
  smoothWarp: SmoothWarpNode,
  curlWarp: CurlWarpNode,
  swirlWarp: SwirlWarpNode,
  displace: DisplaceNode,
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
  sdBox: SdBoxNode,
  sdSegment: SdSegmentNode,
  sdEllipse: SdEllipseNode,
  opRepeat: OpRepeatNode,
  opRepeatPolar: OpRepeatPolarNode,
  // Combiners
  smoothMin: SmoothMinNode,
  min: MinNode,
  sdfMax: MaxNode2,
  smoothMax: SmoothMaxNode,
  smoothSubtract: SmoothSubtractNode,
  blend: BlendNode,
  mask: MaskNode,
  addColor: AddColorNode,
  screenBlend: ScreenBlendNode,
  glowLayer: GlowLayerNode,
  sdfOutline: SDFOutlineNode,
  sdfColorize: SDFColorizeNode,
  alphaBlend: AlphaBlendNode,
  light2d: Light2DNode,
  // Effects
  makeLight: MakeLightNode,
  abs: AbsNode,
  toneMap: ToneMapNode,
  grain: GrainNode,
  lumaGrain: LumaGrainNode,
  temporalGrain: TemporalGrainNode,
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
  radialBlur: RadialBlurNode,
  tiltShiftBlur: TiltShiftBlurNode,
  lensBlur: LensBlurNode,
  motionBlur: MotionBlurNode,
  depthOfField: DepthOfFieldNode,
  chromaShift: ChromaShiftNode,
  // Loops (wired pair system)
  loopCarry:             LoopCarryNode,
  loopStart:             LoopStartNode,
  loopEnd:               LoopEndNode,
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
  // Fractals
  mandelbrot: MandelbrotNode,
  ifs: IFSNode,
  newtonFractal: NewtonFractalNode,
  lyapunov: LyapunovNode,
  apollonian: ApollonianNode,
  sphericalFoldFractal: SphericalFoldFractalNode,
  // Physics
  chladni: ChladniNode,
  chladni3d: Chladni3DNode,
  chladni3dParticles: Chladni3DParticlesNode,
  electronOrbital: ElectronOrbitalNode,
  // Particles & Fields
  particleEmitter: ParticleEmitterNode,
  vectorField:     VectorFieldNode,
  gravityField:    GravityFieldNode,
  spiralField:     SpiralFieldNode,
  // 3D / Volumetric
  raymarch3d: RaymarchNode,
  volumeClouds: VolumeCloudsNode,
  chromaticAberration: ChromaticAberrationNode,
  combineRGB: CombineRGBNode,
  orbitalVolume3d: OrbitalVolume3DNode,
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
  sdfSmoothUnion: SDFSmoothUnionNode,
  sdfSmoothSubtract: SDFSmoothSubtractNode,
  sdfSmoothIntersect: SDFSmoothIntersectNode,
  sdfRound: SDFRoundNode,
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
  sdCross3D: SdCrossNode,
  mengerSponge: MengerSpongeNode,
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
  // 3D Fractals (DE nodes)
  mandelboxDE: MandelboxDENode,
  kifsTetra: KIFSTetrahedronDENode,
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
  // Color
  palette: PaletteNode,
  palettePreset: PalettePresetNode,
  gradient: GradientNode,
  hsv: HSVNode,
  posterize: PosterizeNode,
  invert: InvertNode,
  desaturate: DesaturateNode,
  hueRange: HueRangeNode,
  colorRamp: ColorRampNode,
  blendModes: BlendModesNode,
  brightnessContrast: BrightnessContrastNode,
  blackbody: BlackbodyNode,
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
  exp: ExpNode,
  pow: PowNode,
  negate: NegateNode,
  length: LengthNode,
  multiplyVec3: MultiplyVec3Node,
  addVec3: AddVec3Node,
  tanh: TanhNode,
  minMath: MinMathNode,
  max: MaxNode,
  clamp: ClampNode,
  mix: MixNode,
  mixVec3: MixVec3Node,
  mod: ModNode,
  atan2: Atan2Node,
  ceil: CeilNode,
  floor: FloorNode,
  sqrt: SqrtNode,
  round: RoundNode,
  dot: DotNode,
  makeVec2: MakeVec2Node,
  extractX: ExtractXNode,
  extractY: ExtractYNode,
  splitVec2: SplitVec2Node,
  splitVec3: SplitVec3Node,
  splitVec4: SplitVec4Node,
  transformVec: TransformVecNode,
  makeVec3: MakeVec3Node,
  floatToVec3: FloatToVec3Node,
  fractRaw: FractRawNode,
  smoothstep: SmoothstepNode,
  addVec2: AddVec2Node,
  multiplyVec2: MultiplyVec2Node,
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
  // Animation
  sineLFO: SineLFONode,
  squareLFO: SquareLFONode,
  sawtoothLFO: SawtoothLFONode,
  triangleLFO: TriangleLFONode,
  bpmSync: BPMSyncNode,
};

export function getNodeDefinition(type: string): NodeDefinition | undefined {
  return NODE_REGISTRY[type];
}

export function getNodesByCategory(category: string): NodeDefinition[] {
  return Object.values(NODE_REGISTRY).filter(n => n.category === category);
}

export function getAllCategories(): string[] {
  return [...new Set(Object.values(NODE_REGISTRY).map(n => n.category))];
}
