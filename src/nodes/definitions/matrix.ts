import type { NodeDefinition, GraphNode } from '../../types/nodeGraph';
import { p } from './helpers';

// ─── Vec2 Const ───────────────────────────────────────────────────────────────

export const Vec2ConstNode: NodeDefinition = {
  type: 'vec2Const',
  label: 'Vec2 Const',
  category: 'Math',
  description: 'A constant vec2 — type in X and Y directly, no inputs.',
  inputs: {},
  outputs: { val: { type: 'vec2', label: 'Vec2' } },
  defaultParams: { x: 0, y: 0 },
  paramDefs: {
    x: { label: 'X', type: 'float', step: 0.01 },
    y: { label: 'Y', type: 'float', step: 0.01 },
  },
  generateGLSL: (node: GraphNode) => {
    const id = node.id;
    return {
      code: `    vec2 ${id}_val = vec2(${p(node.params.x, 0)}, ${p(node.params.y, 0)});\n`,
      outputVars: { val: `${id}_val` },
    };
  },
};

// ─── Vec3 Const ───────────────────────────────────────────────────────────────

export const Vec3ConstNode: NodeDefinition = {
  type: 'vec3Const',
  label: 'Vec3 Const',
  category: 'Math',
  description: 'A constant vec3 — type in X, Y, Z directly, no inputs.',
  inputs: {},
  outputs: { val: { type: 'vec3', label: 'Vec3' } },
  defaultParams: { x: 0, y: 0, z: 0 },
  paramDefs: {
    x: { label: 'X', type: 'float', step: 0.01 },
    y: { label: 'Y', type: 'float', step: 0.01 },
    z: { label: 'Z', type: 'float', step: 0.01 },
  },
  generateGLSL: (node: GraphNode) => {
    const id = node.id;
    return {
      code: `    vec3 ${id}_val = vec3(${p(node.params.x, 0)}, ${p(node.params.y, 0)}, ${p(node.params.z, 0)});\n`,
      outputVars: { val: `${id}_val` },
    };
  },
};

// ─── Matrix Const ─────────────────────────────────────────────────────────────

export const MatConstNode: NodeDefinition = {
  type: 'matConst',
  label: 'Matrix Const',
  category: 'Matrix',
  description: 'A constant matrix with typed-in values. Switch between 2×2 and 3×3 — grid updates accordingly.',
  inputs: {},
  outputs: { mat: { type: 'mat3', label: 'Matrix' } },
  defaultParams: {
    size: 'mat3',
    m00: 1, m01: 0, m02: 0,
    m10: 0, m11: 1, m12: 0,
    m20: 0, m21: 0, m22: 1,
  },
  paramDefs: {
    size: {
      label: 'Size',
      type: 'select',
      options: [
        { value: 'mat2', label: '2 × 2' },
        { value: 'mat3', label: '3 × 3' },
      ],
    },
    // individual matrix cell params — m[row][col]
    // m02/m12/m20/m21/m22 only visible for mat3
    m00: { label: 'm00', type: 'float', step: 0.01 },
    m01: { label: 'm01', type: 'float', step: 0.01 },
    m02: { label: 'm02', type: 'float', step: 0.01, showWhen: { param: 'size', value: 'mat3' } },
    m10: { label: 'm10', type: 'float', step: 0.01 },
    m11: { label: 'm11', type: 'float', step: 0.01 },
    m12: { label: 'm12', type: 'float', step: 0.01, showWhen: { param: 'size', value: 'mat3' } },
    m20: { label: 'm20', type: 'float', step: 0.01, showWhen: { param: 'size', value: 'mat3' } },
    m21: { label: 'm21', type: 'float', step: 0.01, showWhen: { param: 'size', value: 'mat3' } },
    m22: { label: 'm22', type: 'float', step: 0.01, showWhen: { param: 'size', value: 'mat3' } },
  },
  generateGLSL: (node: GraphNode) => {
    const id   = node.id;
    const size = (node.params.size as string) ?? 'mat3';
    const f    = (k: string) => p(node.params[k] as number ?? 0, 0);
    if (size === 'mat2') {
      // GLSL mat2 is column-major: mat2(col0.x, col0.y, col1.x, col1.y)
      return {
        code: `    mat2 ${id}_mat = mat2(${f('m00')}, ${f('m10')}, ${f('m01')}, ${f('m11')});\n`,
        outputVars: { mat: `${id}_mat` },
      };
    }
    // mat3 column-major
    return {
      code: `    mat3 ${id}_mat = mat3(${f('m00')}, ${f('m10')}, ${f('m20')}, ${f('m01')}, ${f('m11')}, ${f('m21')}, ${f('m02')}, ${f('m12')}, ${f('m22')});\n`,
      outputVars: { mat: `${id}_mat` },
    };
  },
};

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
