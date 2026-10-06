/**
 * Explanation text with its tokens as chips (lib/glslPatterns/segments.ts): a variable in its
 * type's colour, a number in the number colour, a function name in the function colour, code
 * highlighted like the GLSL page. The colours are the GLSL highlighter's, so a chip looks like
 * the same word in the code above it, in both themes.
 *
 * Hovering a variable chip reports its name (the code above lights where it is read); a chip
 * whose name is `activeVar` lights up (the code's variable is hovered). Screen readers hear
 * "variable a", "function foo", "code …".
 */
import { memo, type CSSProperties } from 'react';
import { spokenToken, type Seg } from '../../lib/glslPatterns/segments';
import type { GlslType } from '../../lib/glslPatterns/ast';
import { C, C_LIGHT } from '../glslSyntax';
import { useThemeMode, useTokens } from '../../theme/themeStore';
import { alpha, fontFamily } from '../../theme/tokens';
import { GlslCode } from './GlslCode';

type Pal = typeof C;

/** A variable's colour: its type's (the code's type colours, which follow the socket hues). */
export function typeColor(type: GlslType | undefined, pal: Pal): string {
  switch (type) {
    case 'float': return pal.typeFloat;
    case 'int': case 'bool': return pal.typeInt;
    case 'vec2': return pal.typeVec2;
    case 'vec3': return pal.typeVec3;
    case 'vec4': return pal.typeVec4;
    case 'mat2': case 'mat3': case 'mat4': return pal.typeMat;
    case 'sampler2D': return pal.typeSampler;
    default: return pal.ident;
  }
}

export function segColor(s: Seg, pal: Pal): string {
  switch (s.kind) {
    case 'var': return typeColor(s.type, pal);
    case 'num': return pal.number;
    case 'fn': return pal.builtin;
    default: return pal.ident;
  }
}

export interface ExplainTextProps {
  segs: Seg[];
  /** The variable lit from elsewhere (hovered in the code). */
  activeVar?: string | null;
  onVarHover?: (name: string | null) => void;
  style?: CSSProperties;
}

export const ExplainText = memo(function ExplainText({ segs, activeVar, onVarHover, style }: ExplainTextProps) {
  const tk = useTokens();
  const dark = useThemeMode() === 'dark';
  const pal = dark ? C : C_LIGHT;
  return (
    <span data-explain-text="" style={style}>
      {segs.map((s, i) => {
        if (s.kind === 'text') return <span key={i}>{s.text}</span>;
        const color = segColor(s, pal);
        const on = s.kind === 'var' && !!activeVar && activeVar === s.name;
        const chip: CSSProperties = {
          font: `500 0.92em ${fontFamily.mono}`, padding: '0 4px', margin: '0 1px', borderRadius: 4, whiteSpace: 'nowrap',
          color, background: on ? alpha(tk.accent.base, 0.28) : alpha(color, dark ? 0.14 : 0.1),
          boxShadow: on ? `0 0 0 1px ${alpha(tk.accent.base, 0.7)}` : `inset 0 0 0 1px ${alpha(color, dark ? 0.22 : 0.18)}`,
        };
        const label = spokenToken(s);
        if (s.kind === 'code') {
          return (
            <span key={i} data-explain-chip="code" role="text" aria-label={label} style={{ ...chip, background: tk.bg.field, boxShadow: `inset 0 0 0 1px ${tk.border.subtle}`, whiteSpace: 'normal' }}>
              <GlslCode code={s.text} />
            </span>
          );
        }
        return (
          <span key={i} data-explain-chip={s.kind} {...(s.kind === 'var' ? { 'data-var': s.name, title: s.type ? `${s.name} · ${s.type}` : s.name } : {})}
            role="text" aria-label={label} style={chip}
            onMouseEnter={s.kind === 'var' && onVarHover ? () => onVarHover(s.name) : undefined}
            onMouseLeave={s.kind === 'var' && onVarHover ? () => onVarHover(null) : undefined}>
            {s.text}
          </span>
        );
      })}
    </span>
  );
});
