// Node types for the shader graph
export type ModifierType = 'sin' | 'cos' | 'abs' | 'pow' | 'smoothstep' | 'fract';

export interface Modifier {
  id: string;
  type: ModifierType;
  params: Record<string, number>;
}

export type NodeType =
  | 'circleSDF'
  | 'ringSDF'
  | 'boxSDF'
  | 'smoothMin'
  | 'makeLight'
  | 'palette';

export interface NodeParams {
  // SDF params
  size?: number;
  position?: [number, number];
  dimensions?: [number, number];

  // Blend params
  smoothness?: number;

  // Light params
  brightness?: number;

  // Palette params
  a?: [number, number, number];
  b?: [number, number, number];
  c?: [number, number, number];
  d?: [number, number, number];
}

export interface Node {
  id: string;
  type: NodeType;
  params: NodeParams;
  modifiers: Modifier[];
}

export interface ShaderState {
  nodes: Node[];
  selectedNodeId: string | null;
  time: number;
  mouse: [number, number];
}
