// Data types that flow between nodes
export type DataType = "float" | "vec2" | "vec3" | "vec4";

// Socket (connection point on a node)
export interface Socket {
  type: DataType;
  label: string;
}

// Input socket with connection and default value
export interface InputSocket extends Socket {
  connection?: {
    nodeId: string;
    outputKey: string;
  };
  defaultValue?: number | number[];
}

// Output socket
export interface OutputSocket extends Socket {}

// Runtime node instance
export interface GraphNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  inputs: Record<string, InputSocket>;
  outputs: Record<string, OutputSocket>;
  params: Record<string, unknown>;
  /** When true the node is skipped — inputs are passed through to outputs */
  bypassed?: boolean;
}

// Editable parameter definition (used to render inline controls on the node card)
export interface ParamDef {
  label: string;
  type: 'float' | 'vec3' | 'select' | 'string';
  min?: number;
  max?: number;
  step?: number;
  // Options for 'select' type — array of { value, label } pairs
  options?: { value: string; label: string }[];
  // Conditionally show this param only when another param matches a value
  showWhen?: { param: string; value: string | string[] };
}

// Node definition (blueprint)
export interface NodeDefinition {
  type: string;
  label: string;
  category: string;
  description?: string;

  inputs: Record<string, Socket>;
  outputs: Record<string, Socket>;

  // How to generate GLSL for this node
  generateGLSL: (
    node: GraphNode,
    inputVars: Record<string, string>
  ) => {
    code: string;
    outputVars: Record<string, string>;
  };

  // Optional GLSL function to include in shader
  glslFunction?: string;

  // Default parameter values
  defaultParams?: Record<string, unknown>;

  // Editable param metadata — drives inline UI controls on the node card
  paramDefs?: Record<string, ParamDef>;
}

// The entire graph
export interface NodeGraph {
  nodes: GraphNode[];
}
