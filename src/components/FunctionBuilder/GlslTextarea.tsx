import React, { useRef, useCallback } from 'react';

// ── Token colour palette (Catppuccin Mocha) ───────────────────────────────────
const C = {
  keyword:    '#cba6f7',  // mauve  — return, if, for, …
  typeFloat:  '#f38ba8',  // red    — float
  typeVec2:   '#89b4fa',  // blue   — vec2
  typeVec3:   '#a6e3a1',  // green  — vec3
  typeVec4:   '#b4befe',  // lavender — vec4
  typeInt:    '#fab387',  // peach  — int, bool
  typeMat:    '#94e2d5',  // teal   — mat2/3/4
  builtin:    '#f9e2af',  // yellow — sin, cos, mix, …
  number:     '#fab387',  // peach  — 1.0, 3.14
  comment:    '#45475a',  // dimmed
  swizzle:    '#89b4fa',  // blue   — .xyz, .rgb
  operator:   '#89dceb',  // sky    — + - * / = …
  ident:      '#cdd6f4',  // text   — identifiers
  punct:      '#6c7086',  // overlay0 — ( ) { } , ;
};

const KEYWORDS = new Set([
  'if','else','for','while','do','switch','case','default','break','continue',
  'return','discard','void','uniform','varying','attribute','const',
  'in','out','inout','layout','precision','mediump','highp','lowp',
  'struct','true','false',
]);

const TYPE_COLORS: Record<string, string> = {
  float: C.typeFloat, double: C.typeFloat,
  vec2:  C.typeVec2,  dvec2: C.typeVec2,  ivec2: C.typeInt, bvec2: C.typeInt,
  vec3:  C.typeVec3,  dvec3: C.typeVec3,  ivec3: C.typeInt, bvec3: C.typeInt,
  vec4:  C.typeVec4,  dvec4: C.typeVec4,  ivec4: C.typeInt, bvec4: C.typeInt,
  int: C.typeInt, uint: C.typeInt, bool: C.typeInt,
  mat2: C.typeMat, mat3: C.typeMat, mat4: C.typeMat,
};

const BUILTINS = new Set([
  'radians','degrees','sin','cos','tan','asin','acos','atan',
  'sinh','cosh','tanh','asinh','acosh','atanh',
  'pow','exp','log','exp2','log2','sqrt','inversesqrt',
  'abs','sign','floor','trunc','round','ceil','fract',
  'mod','modf','min','max','clamp','mix','step','smoothstep',
  'length','distance','dot','cross','normalize','faceforward','reflect','refract',
  'matrixCompMult','outerProduct','transpose','determinant','inverse',
  'lessThan','lessThanEqual','greaterThan','greaterThanEqual','equal','notEqual','any','all','not',
  'texture','texture2D','textureCube','textureProj',
  'dFdx','dFdy','fwidth',
]);

interface Token { text: string; color: string; }

function tokenizeLine(line: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  // Preprocessor
  const trimmed = line.trimStart();
  if (trimmed.startsWith('#')) {
    const leading = line.length - trimmed.length;
    if (leading) tokens.push({ text: line.slice(0, leading), color: C.ident });
    tokens.push({ text: line.slice(leading), color: C.comment });
    return tokens;
  }

  while (i < line.length) {
    const ch = line[i];

    // Whitespace
    if (ch === ' ' || ch === '\t') {
      let ws = '';
      while (i < line.length && (line[i] === ' ' || line[i] === '\t')) ws += line[i++];
      tokens.push({ text: ws, color: C.ident });
      continue;
    }

    // Line comment
    if (line[i] === '/' && line[i + 1] === '/') {
      tokens.push({ text: line.slice(i), color: C.comment });
      break;
    }

    // Block comment
    if (line[i] === '/' && line[i + 1] === '*') {
      const end = line.indexOf('*/', i + 2);
      const commentText = end === -1 ? line.slice(i) : line.slice(i, end + 2);
      tokens.push({ text: commentText, color: C.comment });
      i += commentText.length;
      continue;
    }

    // Number literal  (int/float, optional exponent)
    const prevCh = i > 0 ? line[i - 1] : null;
    const prevIsIdent = prevCh !== null && /[a-zA-Z0-9_]/.test(prevCh);
    if (!prevIsIdent && /\d/.test(ch)) {
      const m = line.slice(i).match(/^\d+(\.\d*)?(e[+-]?\d+)?[uUfF]?/);
      if (m) { tokens.push({ text: m[0], color: C.number }); i += m[0].length; continue; }
    }
    // .5 style literals
    if (ch === '.' && /\d/.test(line[i + 1] ?? '')) {
      const m = line.slice(i).match(/^\.\d+(e[+-]?\d+)?[fF]?/);
      if (m) { tokens.push({ text: m[0], color: C.number }); i += m[0].length; continue; }
    }

    // Dot — swizzle or standalone
    if (ch === '.') {
      const swizzleMatch = line.slice(i + 1).match(/^[xyzwrgbastpq]+/);
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
      const m = line.slice(i).match(/^[a-zA-Z_][a-zA-Z0-9_]*/);
      if (m) {
        const word = m[0];
        let color = C.ident;
        if (KEYWORDS.has(word))     color = C.keyword;
        else if (TYPE_COLORS[word]) color = TYPE_COLORS[word];
        else if (BUILTINS.has(word)) color = C.builtin;
        tokens.push({ text: word, color });
        i += word.length;
        continue;
      }
    }

    // Operators
    if (/[+\-*/%=<>!&|^~?]/.test(ch)) {
      const two = line.slice(i, i + 2);
      if (['++','--','<=','>=','==','!=','&&','||','+=','-=','*=','/=','<<','>>'].includes(two)) {
        tokens.push({ text: two, color: C.operator }); i += 2;
      } else {
        tokens.push({ text: ch, color: C.operator }); i++;
      }
      continue;
    }

    // Punctuation
    if (/[(){}\[\],;:]/.test(ch)) {
      tokens.push({ text: ch, color: C.punct }); i++; continue;
    }

    // Fallback
    tokens.push({ text: ch, color: C.ident }); i++;
  }

  return tokens;
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function buildHighlightedHtml(code: string): string {
  const lines = code.split('\n');
  const result = lines.map(line => {
    const tokens = tokenizeLine(line);
    return tokens.map(t => `<span style="color:${t.color}">${escHtml(t.text)}</span>`).join('');
  });
  // trailing newline keeps <pre> the same height as <textarea>
  return result.join('\n') + '\n';
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  value: string;
  onChange: (val: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onFocus?: (el: HTMLTextAreaElement) => void;
  hasError?: boolean;
}

const SHARED: React.CSSProperties = {
  fontFamily:   'monospace',
  fontSize:     '12px',
  lineHeight:   '1.6',
  padding:      '6px 10px',
  whiteSpace:   'pre',
  overflowWrap: 'normal' as const,
  wordBreak:    'normal' as const,
  tabSize:      2,
  boxSizing:    'border-box' as const,
  width:        '100%',
  minHeight:    '48px',
  margin:       0,
  border:       'none',
  outline:      'none',
};

export function GlslTextarea({ value, onChange, onKeyDown, onFocus, hasError }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const preRef      = useRef<HTMLPreElement>(null);

  const syncScroll = useCallback(() => {
    if (!textareaRef.current || !preRef.current) return;
    preRef.current.scrollTop  = textareaRef.current.scrollTop;
    preRef.current.scrollLeft = textareaRef.current.scrollLeft;
  }, []);

  const rows = Math.max(2, value.split('\n').length);
  const html = buildHighlightedHtml(value);

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      {/* Highlight layer — sits behind the textarea */}
      <pre
        ref={preRef}
        aria-hidden
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: html }}
        style={{
          ...SHARED,
          position:       'absolute',
          inset:          0,
          background:     'transparent',
          pointerEvents:  'none',
          overflow:       'hidden',
          color:          'transparent', // per-span colours come from HTML
          zIndex:         1,
        }}
      />
      {/* Editable layer — transparent text, coloured caret */}
      <textarea
        ref={textareaRef}
        value={value}
        rows={rows}
        spellCheck={false}
        onChange={e => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={e => onFocus?.(e.currentTarget)}
        onScroll={syncScroll}
        style={{
          ...SHARED,
          position:    'relative',
          zIndex:      2,
          background:  'transparent',
          color:       'transparent',
          caretColor:  hasError ? '#f38ba8' : '#cdd6f4',
          resize:      'none',
          display:     'block',
        }}
      />
    </div>
  );
}
