// ─── GLSL Function Signature Parser ──────────────────────────────────────────
// Parses GLSL source code and extracts function signatures.
// Used by the "Import GLSL" feature to auto-create CustomFn nodes.

export interface ParsedParam {
  type: string;   // 'float', 'vec2', 'vec3', 'vec4', etc.
  name: string;   // parameter name
}

export interface ParsedGlslFn {
  returnType: string;
  name: string;
  params: ParsedParam[];
}

// GLSL types that can be used as CustomFn inputs/outputs
const VALID_TYPES = new Set(['float', 'vec2', 'vec3', 'vec4', 'int', 'bool', 'mat2', 'mat3', 'mat4']);
const VALID_OUTPUT_TYPES = new Set(['float', 'vec2', 'vec3', 'vec4']);

// Parameter qualifiers to strip
const QUALIFIERS = new Set(['in', 'out', 'inout', 'const', 'highp', 'mediump', 'lowp']);

/**
 * Parse all GLSL function definitions from source code.
 * Returns an array of parsed function signatures.
 */
export function parseGlslFunctions(code: string): ParsedGlslFn[] {
  const results: ParsedGlslFn[] = [];

  // Match: returnType funcName ( params ) {
  // Supports multi-line parameter lists via [^)]* (greedy within parens)
  const SIG_RE = /\b(float|vec[234]|int|bool|mat[234])\s+(\w+)\s*\(([^)]*)\)\s*\{/g;

  let match: RegExpExecArray | null;
  while ((match = SIG_RE.exec(code)) !== null) {
    const returnType = match[1];
    const name = match[2];

    // Skip if name looks like a built-in keyword
    if (['if', 'for', 'while', 'do', 'switch'].includes(name)) continue;

    const paramStr = match[3].trim();
    const params: ParsedParam[] = [];

    if (paramStr) {
      for (const part of paramStr.split(',')) {
        const tokens = part.trim().split(/\s+/).filter(Boolean);

        // Remove qualifiers
        const cleaned = tokens.filter(t => !QUALIFIERS.has(t));

        if (cleaned.length === 0) continue;

        const type = cleaned[0] ?? 'float';
        // Name may be absent (e.g., just "float" with no name)
        const pname = cleaned[1] ?? `p${params.length}`;

        params.push({ type, name: pname });
      }
    }

    results.push({ returnType, name, params });
  }

  return results;
}

/**
 * Build the params object for addNode('customFn', pos, params)
 * given the first parsed function and the full source code.
 */
export function buildCustomFnParams(fn: ParsedGlslFn, fullCode: string): Record<string, unknown> {
  const inputs = fn.params.map(p => ({
    name: p.name,
    // Fall back to float for unsupported types (structs, etc.)
    type: VALID_TYPES.has(p.type) ? p.type : 'float',
  }));

  const outputType = VALID_OUTPUT_TYPES.has(fn.returnType) ? fn.returnType : 'float';

  return {
    label: fn.name,
    inputs,
    outputType,
    body: `${fn.name}(${inputs.map(i => i.name).join(', ')})`,
    glslFunctions: fullCode.trim(),
  };
}
