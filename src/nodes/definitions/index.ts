// ─── Node Definitions — thin aggregator ──────────────────────────────────────
// Each category lives in its own file. This module re-exports everything and
// builds the unified NODE_REGISTRY consumed by the rest of the app.

import type { NodeDefinition } from '../../types/nodeGraph';

// Sources
export { UVNode, TimeNode, PixelUVNode, ConstantNode, MouseNode } from './sources';

// Transforms
export { FractNode, Rotate2DNode } from './transforms';

// 2D Primitives
export { CircleSDFNode, BoxSDFNode, RingSDFNode, ShapeSDFNode, SimpleSDFNode } from './primitives';

// SDF (IQ)
export { SdBoxNode, SdSegmentNode, SdEllipseNode, OpRepeatNode, OpRepeatPolarNode } from './sdf';

// Combiners
export { SmoothMinNode, MinNode } from './combiners';

// Effects / Loops
export {
  MakeLightNode, AbsNode, ToneMapNode, GrainNode, LightNode,
  FractalLoopNode, RotatingLinesLoopNode, AccumulateLoopNode, ForLoopNode,
  ExprNode, CustomFnNode, GravitationalLensNode,
} from './effects';

// Noise
export { FBMNode, VoronoiNode, DomainWarpNode, FlowFieldNode, CirclePackNode } from './noise';

// Fractals
export { MandelbrotNode, IFSNode } from './fractals';

// Physics
export { ChladniNode, ElectronOrbitalNode } from './physics';

// 3D / Volumetric
export { RaymarchNode, VolumeCloudsNode, ChromaticAberrationNode, CombineRGBNode, OrbitalVolume3DNode } from './threed';

// Color
export { PALETTE_GLSL_FN, PaletteNode, PalettePresetNode, PALETTE_PRESET_OPTIONS, GradientNode } from './color';

// Output
export { OutputNode, Vec4OutputNode } from './output';

// Math
export {
  AddNode, SubtractNode, MultiplyNode, DivideNode,
  SinNode, CosNode, ExpNode, PowNode, NegateNode, LengthNode,
  MultiplyVec3Node, AddVec3Node,
  TanhNode, MaxNode, ClampNode, MixNode, ModNode,
  Atan2Node, CeilNode, FloorNode, SqrtNode, RoundNode, DotNode,
  MakeVec2Node, ExtractXNode, ExtractYNode, MakeVec3Node, FloatToVec3Node,
  FractRawNode, SmoothstepNode,
  AddVec2Node, MultiplyVec2Node, NormalizeVec2Node,
} from './math';

// ─── Registry ─────────────────────────────────────────────────────────────────

import { UVNode, TimeNode, PixelUVNode, ConstantNode, MouseNode } from './sources';
import { FractNode, Rotate2DNode } from './transforms';
import { CircleSDFNode, BoxSDFNode, RingSDFNode, ShapeSDFNode, SimpleSDFNode } from './primitives';
import { SdBoxNode, SdSegmentNode, SdEllipseNode, OpRepeatNode, OpRepeatPolarNode } from './sdf';
import { SmoothMinNode, MinNode } from './combiners';
import {
  MakeLightNode, AbsNode, ToneMapNode, GrainNode, LightNode,
  FractalLoopNode, RotatingLinesLoopNode, AccumulateLoopNode, ForLoopNode,
  ExprNode, CustomFnNode, GravitationalLensNode,
} from './effects';
import { FBMNode, VoronoiNode, DomainWarpNode, FlowFieldNode, CirclePackNode } from './noise';
import { MandelbrotNode, IFSNode } from './fractals';
import { ChladniNode, ElectronOrbitalNode } from './physics';
import { RaymarchNode, VolumeCloudsNode, ChromaticAberrationNode, CombineRGBNode, OrbitalVolume3DNode } from './threed';
import { PaletteNode, PalettePresetNode, GradientNode } from './color';
import { OutputNode, Vec4OutputNode } from './output';
import {
  AddNode, SubtractNode, MultiplyNode, DivideNode,
  SinNode, CosNode, ExpNode, PowNode, NegateNode, LengthNode,
  MultiplyVec3Node, AddVec3Node,
  TanhNode, MaxNode, ClampNode, MixNode, ModNode,
  Atan2Node, CeilNode, FloorNode, SqrtNode, RoundNode, DotNode,
  MakeVec2Node, ExtractXNode, ExtractYNode, MakeVec3Node, FloatToVec3Node,
  FractRawNode, SmoothstepNode,
  AddVec2Node, MultiplyVec2Node, NormalizeVec2Node,
} from './math';

export const NODE_REGISTRY: Record<string, NodeDefinition> = {
  // Sources
  uv: UVNode,
  pixelUV: PixelUVNode,
  time: TimeNode,
  constant: ConstantNode,
  mouse: MouseNode,
  // Transforms
  fract: FractNode,
  rotate2d: Rotate2DNode,
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
  // Effects
  makeLight: MakeLightNode,
  abs: AbsNode,
  toneMap: ToneMapNode,
  grain: GrainNode,
  light: LightNode,
  fractalLoop: FractalLoopNode,
  rotatingLinesLoop: RotatingLinesLoopNode,
  accumulateLoop: AccumulateLoopNode,
  forLoop: ForLoopNode,
  expr: ExprNode,
  customFn: CustomFnNode,
  gravitationalLens: GravitationalLensNode,
  // Noise
  fbm: FBMNode,
  voronoi: VoronoiNode,
  domainWarp: DomainWarpNode,
  flowField: FlowFieldNode,
  circlePack: CirclePackNode,
  // Fractals
  mandelbrot: MandelbrotNode,
  ifs: IFSNode,
  // Physics
  chladni: ChladniNode,
  electronOrbital: ElectronOrbitalNode,
  // 3D / Volumetric
  raymarch3d: RaymarchNode,
  volumeClouds: VolumeCloudsNode,
  chromaticAberration: ChromaticAberrationNode,
  combineRGB: CombineRGBNode,
  orbitalVolume3d: OrbitalVolume3DNode,
  // Color
  palette: PaletteNode,
  palettePreset: PalettePresetNode,
  gradient: GradientNode,
  // Output
  output: OutputNode,
  vec4Output: Vec4OutputNode,
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
  max: MaxNode,
  clamp: ClampNode,
  mix: MixNode,
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
  makeVec3: MakeVec3Node,
  floatToVec3: FloatToVec3Node,
  fractRaw: FractRawNode,
  smoothstep: SmoothstepNode,
  addVec2: AddVec2Node,
  multiplyVec2: MultiplyVec2Node,
  normalizeVec2: NormalizeVec2Node,
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
