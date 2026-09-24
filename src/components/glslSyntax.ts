import { ctp } from '../theme/palette';

// ── GLSL syntax-highlight palette ────────────────────────────────────────────
// Types use the same hues as the node-socket colours so the shader output
// feels visually connected to the graph.
const C = {
  // Control-flow / storage qualifiers
  keyword:    ctp.mauve, // mauve   — void, if, for, return, uniform, …
  // Data types (match socket colours)
  typeFloat:  ctp.red, // red     — float
  typeVec2:   ctp.blue, // blue    — vec2
  typeVec3:   ctp.green, // green   — vec3
  typeVec4:   ctp.lavender, // lavender — vec4
  typeInt:    ctp.peach, // peach   — int, uint, bool
  typeMat:    ctp.teal, // teal    — mat2/3/4
  typeSampler:ctp.sky, // sky     — sampler2D/Cube
  // Built-in GLSL functions
  builtin:    ctp.yellow, // yellow  — sin, cos, mix, …
  // Numeric literals
  number:     ctp.peach, // peach   — 1.0, 0, 3.14
  // Comments
  comment:    ctp.surface1, // dimmed
  // Preprocessor (#version, #define, precision mediump)
  preproc:    ctp.red, // same as float — stands out
  // Swizzle members / dot access (.x, .rgb, …)
  swizzle:    ctp.blue, // blue (accessed as vec component)
  // Operators  + - * / = < > ! & | …
  operator:   ctp.sky, // sky
  // Default identifier / variable name
  ident:      ctp.text, // text
  // Punctuation  ( ) { } [ ] , ; :
  punct:      ctp.overlay0, // overlay0
};

// The same roles in Catppuccin Latte, for the light theme's white code panel.
export const C_LIGHT: typeof C = {
  keyword: '#8839ef', typeFloat: '#d20f39', typeVec2: '#1e66f5', typeVec3: '#40a02b', typeVec4: '#7287fd',
  typeInt: '#fe640b', typeMat: '#179299', typeSampler: '#04a5e5', builtin: '#c26a0a', number: '#fe640b',
  comment: '#9ca0b0', preproc: '#d20f39', swizzle: '#1e66f5', operator: '#04a5e5', ident: '#1a1b23', punct: '#7c7f93',
};

const KEYWORDS = new Set([
  'if','else','for','while','do','switch','case','default','break','continue',
  'return','discard','void',
  'uniform','varying','attribute','const','in','out','inout',
  'layout','precision','mediump','highp','lowp',
  'struct','true','false',
]);

type TypeRole = 'typeFloat' | 'typeVec2' | 'typeVec3' | 'typeVec4' | 'typeInt' | 'typeMat' | 'typeSampler';
const TYPE_ROLES: Record<string, TypeRole> = {
  float: 'typeFloat', double: 'typeFloat',
  vec2: 'typeVec2',  dvec2: 'typeVec2',  ivec2: 'typeInt', uvec2: 'typeInt', bvec2: 'typeInt',
  vec3: 'typeVec3',  dvec3: 'typeVec3',  ivec3: 'typeInt', uvec3: 'typeInt', bvec3: 'typeInt',
  vec4: 'typeVec4',  dvec4: 'typeVec4',  ivec4: 'typeInt', uvec4: 'typeInt', bvec4: 'typeInt',
  int: 'typeInt', uint: 'typeInt', bool: 'typeInt',
  mat2: 'typeMat', mat3: 'typeMat', mat4: 'typeMat',
  mat2x2: 'typeMat', mat2x3: 'typeMat', mat2x4: 'typeMat',
  mat3x2: 'typeMat', mat3x3: 'typeMat', mat3x4: 'typeMat',
  mat4x2: 'typeMat', mat4x3: 'typeMat', mat4x4: 'typeMat',
  sampler2D: 'typeSampler', samplerCube: 'typeSampler', sampler3D: 'typeSampler',
};

const BUILTINS = new Set([
  // Trig
  'radians','degrees','sin','cos','tan','asin','acos','atan',
  'sinh','cosh','tanh','asinh','acosh','atanh',
  // Exp/log
  'pow','exp','log','exp2','log2','sqrt','inversesqrt',
  // Common
  'abs','sign','floor','trunc','round','roundEven','ceil','fract',
  'mod','modf','min','max','clamp','mix','step','smoothstep',
  'isnan','isinf','floatBitsToInt','floatBitsToUint','intBitsToFloat','uintBitsToFloat',
  'packSnorm2x16','unpackSnorm2x16','packUnorm2x16','unpackUnorm2x16',
  'packHalf2x16','unpackHalf2x16',
  // Geometric
  'length','distance','dot','cross','normalize','faceforward','reflect','refract',
  // Matrix
  'matrixCompMult','outerProduct','transpose','determinant','inverse',
  // Vector relational
  'lessThan','lessThanEqual','greaterThan','greaterThanEqual','equal','notEqual','any','all','not',
  // Texture
  'texture','texture2D','textureCube','textureProj','textureLod','textureProjLod',
  'textureOffset','texelFetch','textureSize','textureProjOffset',
  // Derivative
  'dFdx','dFdy','fwidth',
  // Geometry shader
  'emit','endPrimitive',
  // GLSL ES 3.0
  'bitfieldExtract','bitfieldInsert','bitfieldReverse','bitCount',
  'findLSB','findMSB','umulExtended','imulExtended',
]);


export interface Token { text: string; color: string; }
export { C, BUILTINS };

/** Split a GLSL line into coloured tokens. `pal` defaults to the dark (Mocha) colours. */
export function tokenizeLine(line: string, pal: typeof C = C): Token[] {
  const C = pal;
  const tokens: Token[] = [];
  const raw = line;
  let i = 0;

  // Full-line preprocessor (#version, #define, #include, precision …)
  const trimmed = raw.trimStart();
  if (trimmed.startsWith('#')) {
    const leading = raw.length - trimmed.length;
    if (leading) tokens.push({ text: raw.slice(0, leading), color: C.ident });
    tokens.push({ text: raw.slice(leading), color: C.preproc });
    return tokens;
  }

  while (i < raw.length) {
    const ch = raw[i];

    // Whitespace — preserve verbatim
    if (ch === ' ' || ch === '\t') {
      let ws = '';
      while (i < raw.length && (raw[i] === ' ' || raw[i] === '\t')) ws += raw[i++];
      tokens.push({ text: ws, color: C.ident });
      continue;
    }

    // Line comment
    if (raw[i] === '/' && raw[i + 1] === '/') {
      tokens.push({ text: raw.slice(i), color: C.comment });
      break;
    }

    // Block comment
    if (raw[i] === '/' && raw[i + 1] === '*') {
      const end = raw.indexOf('*/', i + 2);
      const commentText = end === -1 ? raw.slice(i) : raw.slice(i, end + 2);
      tokens.push({ text: commentText, color: C.comment });
      i += commentText.length;
      continue;
    }

    // Number  (int or float, optional exponent)
    // Only match at start or after a non-identifier char to avoid matching 1 in abc1
    const prevCh = i > 0 ? raw[i - 1] : null;
    const prevIsIdent = prevCh !== null && /[a-zA-Z0-9_]/.test(prevCh);
    if (!prevIsIdent && /\d/.test(ch)) {
      const numMatch = raw.slice(i).match(/^\d+(\.\d*)?(e[+-]?\d+)?[uUfF]?/);
      if (numMatch) {
        tokens.push({ text: numMatch[0], color: C.number });
        i += numMatch[0].length;
        continue;
      }
    }
    // Also catch .5  style literals
    if (ch === '.' && /\d/.test(raw[i + 1] ?? '')) {
      const numMatch = raw.slice(i).match(/^\.\d+(e[+-]?\d+)?[fF]?/);
      if (numMatch) {
        tokens.push({ text: numMatch[0], color: C.number });
        i += numMatch[0].length;
        continue;
      }
    }

    // Dot — could be swizzle access (.xyz) or decimal point handled above
    if (ch === '.') {
      // Check if the next chars look like a swizzle (purely letters from the set)
      const swizzleMatch = raw.slice(i + 1).match(/^[xyzwrgbastpq]+/);
      if (swizzleMatch) {
        tokens.push({ text: '.', color: C.punct });
        tokens.push({ text: swizzleMatch[0], color: C.swizzle });
        i += 1 + swizzleMatch[0].length;
        continue;
      }
      tokens.push({ text: '.', color: C.punct });
      i++;
      continue;
    }

    // Identifier / keyword / type / builtin
    if (/[a-zA-Z_]/.test(ch)) {
      const identMatch = raw.slice(i).match(/^[a-zA-Z_][a-zA-Z0-9_]*/);
      if (identMatch) {
        const word = identMatch[0];
        let color = C.ident;
        if (KEYWORDS.has(word))           color = C.keyword;
        else if (TYPE_ROLES[word])         color = C[TYPE_ROLES[word]];
        else if (BUILTINS.has(word))       color = C.builtin;
        tokens.push({ text: word, color });
        i += word.length;
        continue;
      }
    }

    // Operators
    if (/[+\-*/%=<>!&|^~?]/.test(ch)) {
      // Grab multi-char operators (++, --, <=, >=, ==, !=, &&, ||, +=, -=, *=, /=)
      const two = raw.slice(i, i + 2);
      if (['++','--','<=','>=','==','!=','&&','||','+=','-=','*=','/=','<<','>>'].includes(two)) {
        tokens.push({ text: two, color: C.operator });
        i += 2;
      } else {
        tokens.push({ text: ch, color: C.operator });
        i++;
      }
      continue;
    }

    // Punctuation
    if (/[(){}\[\],;:]/.test(ch)) {
      tokens.push({ text: ch, color: C.punct });
      i++;
      continue;
    }

    // Fallback
    tokens.push({ text: ch, color: C.ident });
    i++;
  }

  return tokens;
}
