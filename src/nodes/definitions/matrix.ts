import type { NodeDefinition, GraphNode } from '../../types/nodeGraph';

// ─── Mat2 Construct ───────────────────────────────────────────────────────────

export const Mat2ConstructNode: NodeDefinition = {
  type: 'mat2Construct',
  label: 'Mat2 Construct',
  category: 'Matrix',
  description: 'Assemble a mat2 from two vec2 inputs. Mode selects whether the inputs are treated as rows or columns (GLSL is column-major, so "rows" transposes internally).',
  inputs: {
    v0: { type: 'vec2', label: 'Vec 0' },
    v1: { type: 'vec2', label: 'Vec 1' },
  },
  outputs: {
    mat: { type: 'mat2', label: 'Mat2' },
  },
  defaultParams: { mode: 'cols' },
  paramDefs: {
    mode: { label: 'Input as', type: 'select', options: [
      { value: 'cols', label: 'Columns' },
      { value: 'rows', label: 'Rows' },
    ]},
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id   = node.id;
    const v0   = inputVars.v0 || 'vec2(1.0, 0.0)';
    const v1   = inputVars.v1 || 'vec2(0.0, 1.0)';
    const mode = (node.params.mode as string) ?? 'cols';
    const expr = mode === 'rows'
      ? `transpose(mat2(${v0}, ${v1}))`
      : `mat2(${v0}, ${v1})`;
    return {
      code: `    mat2 ${id}_mat = ${expr};\n`,
      outputVars: { mat: `${id}_mat` },
    };
  },
};

// ─── Mat3 Construct ───────────────────────────────────────────────────────────

export const Mat3ConstructNode: NodeDefinition = {
  type: 'mat3Construct',
  label: 'Mat3 Construct',
  category: 'Matrix',
  description: 'Assemble a mat3 from three vec3 inputs. Mode selects whether the inputs are treated as rows or columns.',
  inputs: {
    v0: { type: 'vec3', label: 'Vec 0' },
    v1: { type: 'vec3', label: 'Vec 1' },
    v2: { type: 'vec3', label: 'Vec 2' },
  },
  outputs: {
    mat: { type: 'mat3', label: 'Mat3' },
  },
  defaultParams: { mode: 'cols' },
  paramDefs: {
    mode: { label: 'Input as', type: 'select', options: [
      { value: 'cols', label: 'Columns' },
      { value: 'rows', label: 'Rows' },
    ]},
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id   = node.id;
    const v0   = inputVars.v0 || 'vec3(1.0, 0.0, 0.0)';
    const v1   = inputVars.v1 || 'vec3(0.0, 1.0, 0.0)';
    const v2   = inputVars.v2 || 'vec3(0.0, 0.0, 1.0)';
    const mode = (node.params.mode as string) ?? 'cols';
    const expr = mode === 'rows'
      ? `transpose(mat3(${v0}, ${v1}, ${v2}))`
      : `mat3(${v0}, ${v1}, ${v2})`;
    return {
      code: `    mat3 ${id}_mat = ${expr};\n`,
      outputVars: { mat: `${id}_mat` },
    };
  },
};

// ─── Mat2 Inspect ─────────────────────────────────────────────────────────────

export const Mat2InspectNode: NodeDefinition = {
  type: 'mat2Inspect',
  label: 'Mat2 Inspect',
  category: 'Matrix',
  description: 'Break a mat2 into its two vec2 components. Mode selects whether outputs are rows or columns. Also passes the matrix through unchanged.',
  inputs: {
    mat: { type: 'mat2', label: 'Mat2' },
  },
  outputs: {
    mat:  { type: 'mat2', label: 'Mat2' },
    vec0: { type: 'vec2', label: 'Vec 0' },
    vec1: { type: 'vec2', label: 'Vec 1' },
  },
  defaultParams: { mode: 'cols' },
  paramDefs: {
    mode: { label: 'Output as', type: 'select', options: [
      { value: 'cols', label: 'Columns' },
      { value: 'rows', label: 'Rows' },
    ]},
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id   = node.id;
    const mat  = inputVars.mat || 'mat2(1.0)';
    const mode = (node.params.mode as string) ?? 'cols';
    let code: string;
    if (mode === 'rows') {
      code =
        `    mat2 ${id}_mat = ${mat};\n` +
        `    vec2 ${id}_vec0 = vec2(${id}_mat[0].x, ${id}_mat[1].x);\n` +
        `    vec2 ${id}_vec1 = vec2(${id}_mat[0].y, ${id}_mat[1].y);\n`;
    } else {
      code =
        `    mat2 ${id}_mat = ${mat};\n` +
        `    vec2 ${id}_vec0 = ${id}_mat[0];\n` +
        `    vec2 ${id}_vec1 = ${id}_mat[1];\n`;
    }
    return {
      code,
      outputVars: { mat: `${id}_mat`, vec0: `${id}_vec0`, vec1: `${id}_vec1` },
    };
  },
};

// ─── Mat3 Inspect ─────────────────────────────────────────────────────────────

export const Mat3InspectNode: NodeDefinition = {
  type: 'mat3Inspect',
  label: 'Mat3 Inspect',
  category: 'Matrix',
  description: 'Break a mat3 into its three vec3 components. Mode selects whether outputs are rows or columns. Also passes the matrix through unchanged.',
  inputs: {
    mat: { type: 'mat3', label: 'Mat3' },
  },
  outputs: {
    mat:  { type: 'mat3', label: 'Mat3' },
    vec0: { type: 'vec3', label: 'Vec 0' },
    vec1: { type: 'vec3', label: 'Vec 1' },
    vec2: { type: 'vec3', label: 'Vec 2' },
  },
  defaultParams: { mode: 'cols' },
  paramDefs: {
    mode: { label: 'Output as', type: 'select', options: [
      { value: 'cols', label: 'Columns' },
      { value: 'rows', label: 'Rows' },
    ]},
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id   = node.id;
    const mat  = inputVars.mat || 'mat3(1.0)';
    const mode = (node.params.mode as string) ?? 'cols';
    let code: string;
    if (mode === 'rows') {
      code =
        `    mat3 ${id}_mat = ${mat};\n` +
        `    vec3 ${id}_vec0 = vec3(${id}_mat[0].x, ${id}_mat[1].x, ${id}_mat[2].x);\n` +
        `    vec3 ${id}_vec1 = vec3(${id}_mat[0].y, ${id}_mat[1].y, ${id}_mat[2].y);\n` +
        `    vec3 ${id}_vec2 = vec3(${id}_mat[0].z, ${id}_mat[1].z, ${id}_mat[2].z);\n`;
    } else {
      code =
        `    mat3 ${id}_mat = ${mat};\n` +
        `    vec3 ${id}_vec0 = ${id}_mat[0];\n` +
        `    vec3 ${id}_vec1 = ${id}_mat[1];\n` +
        `    vec3 ${id}_vec2 = ${id}_mat[2];\n`;
    }
    return {
      code,
      outputVars: { mat: `${id}_mat`, vec0: `${id}_vec0`, vec1: `${id}_vec1`, vec2: `${id}_vec2` },
    };
  },
};

// ─── Mat2 × Vec2 ─────────────────────────────────────────────────────────────

export const Mat2MulVecNode: NodeDefinition = {
  type: 'mat2MulVec',
  label: 'Mat2 × Vec2',
  category: 'Matrix',
  description: 'Multiply a mat2 by a vec2 — applies the matrix transform to the vector.',
  inputs: {
    mat: { type: 'mat2', label: 'Mat2' },
    vec: { type: 'vec2', label: 'Vec2' },
  },
  outputs: {
    output: { type: 'vec2', label: 'Vec2 out' },
  },
  defaultParams: {},
  generateGLSL: (node: GraphNode, inputVars) => {
    const id  = node.id;
    const mat = inputVars.mat || 'mat2(1.0)';
    const vec = inputVars.vec || 'vec2(0.0)';
    return {
      code: `    vec2 ${id}_output = ${mat} * ${vec};\n`,
      outputVars: { output: `${id}_output` },
    };
  },
};

// ─── Mat3 × Vec3 ─────────────────────────────────────────────────────────────

export const Mat3MulVecNode: NodeDefinition = {
  type: 'mat3MulVec',
  label: 'Mat3 × Vec3',
  category: 'Matrix',
  description: 'Multiply a mat3 by a vec3 — applies the matrix transform to the vector.',
  inputs: {
    mat: { type: 'mat3', label: 'Mat3' },
    vec: { type: 'vec3', label: 'Vec3' },
  },
  outputs: {
    output: { type: 'vec3', label: 'Vec3 out' },
  },
  defaultParams: {},
  generateGLSL: (node: GraphNode, inputVars) => {
    const id  = node.id;
    const mat = inputVars.mat || 'mat3(1.0)';
    const vec = inputVars.vec || 'vec3(0.0)';
    return {
      code: `    vec3 ${id}_output = ${mat} * ${vec};\n`,
      outputVars: { output: `${id}_output` },
    };
  },
};
