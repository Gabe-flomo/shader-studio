import { useState, useEffect, useRef, useCallback } from 'react';

// ── GLSL syntax-highlight palette ────────────────────────────────────────────
// Types use the same hues as the node-socket colours so the shader output
// feels visually connected to the graph.
const C = {
  // Control-flow / storage qualifiers
  keyword:    '#cba6f7', // mauve   — void, if, for, return, uniform, …
  // Data types (match socket colours)
  typeFloat:  '#f38ba8', // red     — float
  typeVec2:   '#89b4fa', // blue    — vec2
  typeVec3:   '#a6e3a1', // green   — vec3
  typeVec4:   '#b4befe', // lavender — vec4
  typeInt:    '#fab387', // peach   — int, uint, bool
  typeMat:    '#94e2d5', // teal    — mat2/3/4
  typeSampler:'#89dceb', // sky     — sampler2D/Cube
  // Built-in GLSL functions
  builtin:    '#f9e2af', // yellow  — sin, cos, mix, …
  // Numeric literals
  number:     '#fab387', // peach   — 1.0, 0, 3.14
  // Comments
  comment:    '#45475a', // dimmed
  // Preprocessor (#version, #define, precision mediump)
  preproc:    '#f38ba8', // same as float — stands out
  // Swizzle members / dot access (.x, .rgb, …)
  swizzle:    '#89b4fa', // blue (accessed as vec component)
  // Operators  + - * / = < > ! & | …
  operator:   '#89dceb', // sky
  // Default identifier / variable name
  ident:      '#cdd6f4', // text
  // Punctuation  ( ) { } [ ] , ; :
  punct:      '#6c7086', // overlay0
};

const KEYWORDS = new Set([
  'if','else','for','while','do','switch','case','default','break','continue',
  'return','discard','void',
  'uniform','varying','attribute','const','in','out','inout',
  'layout','precision','mediump','highp','lowp',
  'struct','true','false',
]);

const TYPE_COLORS: Record<string, string> = {
  float: C.typeFloat, double: C.typeFloat,
  vec2: C.typeVec2,  dvec2: C.typeVec2,  ivec2: C.typeInt, uvec2: C.typeInt, bvec2: C.typeInt,
  vec3: C.typeVec3,  dvec3: C.typeVec3,  ivec3: C.typeInt, uvec3: C.typeInt, bvec3: C.typeInt,
  vec4: C.typeVec4,  dvec4: C.typeVec4,  ivec4: C.typeInt, uvec4: C.typeInt, bvec4: C.typeInt,
  int: C.typeInt, uint: C.typeInt, bool: C.typeInt,
  mat2: C.typeMat, mat3: C.typeMat, mat4: C.typeMat,
  mat2x2: C.typeMat, mat2x3: C.typeMat, mat2x4: C.typeMat,
  mat3x2: C.typeMat, mat3x3: C.typeMat, mat3x4: C.typeMat,
  mat4x2: C.typeMat, mat4x3: C.typeMat, mat4x4: C.typeMat,
  sampler2D: C.typeSampler, samplerCube: C.typeSampler, sampler3D: C.typeSampler,
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

// Swizzle component characters (only valid after a dot on a vec)
const SWIZZLE_CHARS = /^[xyzwrgbastpq]+$/;

interface Token { text: string; color: string; }

function tokenizeLine(line: string): Token[] {
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
        else if (TYPE_COLORS[word])        color = TYPE_COLORS[word];
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

// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  code: string;
  onClose: () => void;
  highlightNodeId?: string | null;
  nodeSlugMap?: Map<string, string>;
}

export function CodePanel({ code, onClose, highlightNodeId, nodeSlugMap }: Props) {
  const [copied, setCopied] = useState(false);
  const firstMatchRef = useRef<HTMLDivElement | null>(null);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* silent */ }
  };

  // Resolve node ID → GLSL slug for highlighting
  const highlightSlug = highlightNodeId
    ? (nodeSlugMap?.get(highlightNodeId) ?? highlightNodeId)
    : null;
  const prefix = highlightSlug ? `${highlightSlug}_` : null;

  const lines = code ? code.split('\n') : ['// No shader compiled yet'];

  // Pre-compute scroll target: prefer first match inside void main
  const scrollToLineIdx = (() => {
    if (!prefix) return -1;
    let firstAny = -1;
    let inMain = false;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trimStart().startsWith('void main')) inMain = true;
      if (lines[i].includes(prefix)) {
        if (firstAny === -1) firstAny = i;
        if (inMain) return i;
      }
    }
    return firstAny;
  })();

  useEffect(() => {
    if (!highlightNodeId) return;
    const t = setTimeout(() => {
      firstMatchRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 40);
    return () => clearTimeout(t);
  }, [highlightNodeId]);

  const setFirstMatch = useCallback((el: HTMLDivElement | null) => {
    firstMatchRef.current = el;
  }, []);

  return (
    <div style={{
      position: 'absolute', bottom: 0, left: 0, right: 0, height: '240px',
      background: '#181825', borderTop: '1px solid #313244',
      display: 'flex', flexDirection: 'column', zIndex: 20,
      boxShadow: '0 -4px 16px rgba(0,0,0,0.4)',
    }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '5px 12px', background: '#1e1e2e', borderBottom: '1px solid #313244',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '11px', fontWeight: 600, color: '#89b4fa', letterSpacing: '0.04em' }}>
            Fragment Shader
          </span>
          {highlightSlug && (
            <span style={{ fontSize: '10px', color: '#f9e2af', fontFamily: 'monospace', opacity: 0.8 }}>
              ↳ {highlightSlug}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <button
            onClick={handleCopy}
            title="Copy shader code to clipboard"
            style={{
              background: copied ? '#a6e3a122' : '#313244',
              border: `1px solid ${copied ? '#a6e3a155' : '#45475a'}`,
              color: copied ? '#a6e3a1' : '#cdd6f4',
              borderRadius: '4px', padding: '3px 8px', fontSize: '11px', cursor: 'pointer',
            }}
          >
            {copied ? '✓ Copied' : '⧉ Copy'}
          </button>
          <button
            onClick={onClose}
            title="Close code panel"
            style={{
              background: 'none', border: 'none', color: '#585b70',
              cursor: 'pointer', fontSize: '14px', lineHeight: 1, padding: '0 2px',
            }}
          >
            ✕
          </button>
        </div>
      </div>

      {/* Code content */}
      <div style={{
        flex: 1, overflowY: 'auto', overflowX: 'auto', padding: '6px 0',
        fontFamily: 'monospace', fontSize: '11px', lineHeight: 1.55,
      }}>
        {lines.map((line, i) => {
          const isMatch = !!(prefix && line.includes(prefix));
          const tokens = tokenizeLine(line || ' ');
          return (
            <div
              key={i}
              ref={i === scrollToLineIdx ? setFirstMatch : undefined}
              style={{
                padding: '0 14px',
                background: isMatch ? '#89b4fa18' : 'transparent',
                borderLeft: isMatch ? '2px solid #89b4fa88' : '2px solid transparent',
                whiteSpace: 'pre',
                transition: 'background 0.15s',
              }}
            >
              {tokens.map((tok, j) => (
                <span
                  key={j}
                  style={{
                    color: isMatch ? (tok.color === C.comment ? C.comment : tok.color) : tok.color,
                    // Dim non-matched lines a bit (like an inactive editor)
                    opacity: isMatch || !prefix ? 1 : 0.55,
                  }}
                >
                  {tok.text}
                </span>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
