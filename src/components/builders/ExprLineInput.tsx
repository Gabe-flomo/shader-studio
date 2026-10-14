/**
 * ExprLineInput — one expression line in a builder (a space block's line, Modify's f(d), the Grid
 * builder's math-path x and y), with the Expression Block's own line editor (code/CodeField's
 * CodeInput): the shared GLSL highlighter and colours, the same autocomplete (its variables, the
 * GLSL reference), bracket marks, and hover help naming the functions the line calls. The caller
 * runs the checker and shows its message; `invalid` draws the field's edge in the error colour.
 * `onCaret` gets the element whenever the caret moves (Make a slider reads the number under it).
 */
import { useMemo } from 'react';
import { CodeInput } from '../code/CodeField';
import { GLSL_REFERENCE, buildCompletions } from '../code/glslReference';

export interface ExprVar { name: string; type: string }

/** The functions a line calls, as hover help: name(signature): what it does. */
export function functionHelp(text: string): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of text.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)) {
    const r = GLSL_REFERENCE.find(x => x.name === m[1] && x.sig);
    if (!r || seen.has(r.name)) continue;
    seen.add(r.name);
    out.push(`${r.sig}: ${r.doc}`);
  }
  return out.join('\n');
}

export function ExprLineInput({ value, onChange, vars, ariaLabel, placeholder, invalid, onCaret, onBlur, attrs, height = 28 }: {
  value: string;
  onChange: (v: string) => void;
  /** The names the line can use (completions): x, y, uv, t, d, its sliders… */
  vars: readonly ExprVar[];
  ariaLabel: string;
  placeholder?: string;
  invalid?: boolean;
  onCaret?: (el: HTMLInputElement) => void;
  onBlur?: () => void;
  attrs?: Record<string, string | number>;
  height?: number;
}) {
  const completions = useMemo(() => buildCompletions(vars), [vars]);
  return (
    // No title here: hovering a function name opens its function card, which a native tooltip would cover.
    <span style={{ flex: 1, minWidth: 0, display: 'flex' }}>
      <CodeInput value={value} onChange={v => onChange(v.replace(/\n/g, ' '))} completions={completions} ariaLabel={ariaLabel} placeholder={placeholder}
        height={height} invalid={invalid} inputAttrs={attrs} onSelect={onCaret} onBlur={onBlur} style={{ flex: 1 }} />
    </span>
  );
}
