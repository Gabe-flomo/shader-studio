/**
 * CodeView — a Present code block as read: highlighted GLSL (the code
 * panel's tokenizer) or JavaScript (the Script editor's), line numbers as in
 * the full text, marked lines, gaps where a node's slice skips lines, and a
 * Copy button.
 */
import { useState } from 'react';
import { C, C_LIGHT, tokenizeLine } from '../glslSyntax';
import { tokenizeJsLine } from '../code/jsSyntax';
import type { ResolvedCode } from '../../present/code';
import { useThemeMode, useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';

export function CodeView({ code, caption, maxHeight = 460 }: { code: ResolvedCode; caption?: string; maxHeight?: number }) {
  const tk = useTokens();
  const pal = useThemeMode() === 'light' ? C_LIGHT : C;
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(code.text); setCopied(true); setTimeout(() => setCopied(false), 1400); } catch { /* the text is still selectable */ }
  };
  const width = String(code.rows.reduce((m, r) => ('n' in r ? Math.max(m, r.n) : m), 1)).length;
  const tokenize = code.language === 'js' ? tokenizeJsLine : tokenizeLine;
  return (
    <figure style={{ margin: 0, borderRadius: radius.lg, border: `1px solid ${tk.border.default}`, background: tk.bg.subtle, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 6px 6px 12px', borderBottom: `1px solid ${tk.border.subtle}`, background: tk.bg.panel }}>
        <span style={{ font: `650 10.5px ${fontFamily.mono}`, letterSpacing: '0.04em', color: tk.text.faint, textTransform: 'uppercase' }}>{code.language === 'js' ? 'JS' : 'GLSL'}</span>
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: tk.text.muted, font: `500 12px ${fontFamily.ui}` }}>{code.from}</span>
        {!code.problem && <Button size="sm" variant="ghost" icon={copied ? 'check' : 'copy'} onClick={copy} style={{ height: 26 }}>{copied ? 'Copied' : 'Copy'}</Button>}
      </div>
      {code.problem ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '14px 14px', color: tk.status.warningText, font: `500 12.5px ${fontFamily.ui}` }}>
          <Icon name="warning" size={14} />{code.problem}
        </div>
      ) : (
        <div style={{ maxHeight, overflow: 'auto', padding: '8px 0', font: `12.5px/1.62 ${fontFamily.mono}` }}>
          {code.rows.map((r, i) => 'gap' in r ? (
            <div key={`g${i}`} style={{ display: 'flex', color: tk.text.faint, font: `500 11px ${fontFamily.ui}`, padding: '2px 0' }}>
              <span style={{ width: width * 8 + 26, flexShrink: 0, textAlign: 'right', paddingRight: 14 }}>⋯</span>
              <span>{r.gap} line{r.gap === 1 ? '' : 's'} of other nodes</span>
            </div>
          ) : (
            <div key={r.n} style={{ display: 'flex', whiteSpace: 'pre', background: r.marked ? alpha(tk.accent.base, 0.12) : 'transparent', boxShadow: r.marked ? `inset 3px 0 0 ${tk.accent.base}` : 'none' }}>
              <span style={{ width: width * 8 + 26, flexShrink: 0, textAlign: 'right', paddingRight: 14, color: r.marked ? tk.accent.base : tk.text.disabled, userSelect: 'none' }}>{r.n}</span>
              <span style={{ paddingRight: 16 }}>{tokenize(r.text || ' ', pal).map((t, j) => <span key={j} style={{ color: t.color }}>{t.text}</span>)}</span>
            </div>
          ))}
        </div>
      )}
      {caption && <figcaption style={{ padding: '7px 12px 8px', borderTop: `1px solid ${tk.border.subtle}`, color: tk.text.muted, font: `500 12.5px/1.4 ${fontFamily.ui}` }}>{caption}</figcaption>}
    </figure>
  );
}
