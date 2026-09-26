import { selectTokenOnDoubleClick, wrapSelection } from '../code/editKeys';
import { BracketMarks } from '../code/BracketMarks';
import { monoCharWidth } from '../code/brackets';
import { useState } from 'react';
import React, { useRef, useCallback, useEffect } from 'react';
import { useThemeMode, useTokens } from '../../theme/themeStore';
import { fontFamily } from '../../theme/tokens';
import { C, C_LIGHT, tokenizeLine } from '../glslSyntax';

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function buildHighlightedHtml(code: string, pal: typeof C): string {
  const lines = code.split('\n');
  const result = lines.map(line => {
    const tokens = tokenizeLine(line, pal);
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
  fontFamily:   fontFamily.mono,
  fontSize:     '13px',
  lineHeight:   '1.6',
  padding:      '12px 14px',
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

  const marksRef = useRef<HTMLDivElement>(null);
  const [caret, setCaret] = useState<number | null>(null);
  const trackCaret = (e: React.SyntheticEvent<HTMLTextAreaElement>) => { const el = e.currentTarget; setCaret(el.selectionStart === el.selectionEnd ? el.selectionStart : null); };
  const syncScroll = useCallback(() => {
    if (!textareaRef.current || !preRef.current) return;
    preRef.current.scrollTop  = textareaRef.current.scrollTop;
    preRef.current.scrollLeft = textareaRef.current.scrollLeft;
    if (marksRef.current) { marksRef.current.scrollTop = textareaRef.current.scrollTop; marksRef.current.scrollLeft = textareaRef.current.scrollLeft; }
  }, []);

  // Auto-resize: set textarea height to its exact scroll height so the
  // highlight <pre> layer and the textarea's character positions never drift.
  // The `rows` attribute uses font-size (not line-height) for row height,
  // causing a growing pixel offset between the two layers on large pastes.
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight}px`;
  }, [value]);

  const tk = useTokens();
  const html = buildHighlightedHtml(value, useThemeMode() === 'dark' ? C : C_LIGHT);

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
      {/* Bracket marks: the pair at the caret, every unmatched bracket */}
      <div ref={marksRef} aria-hidden style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 1 }}>
        <BracketMarks text={value} caret={caret} charW={monoCharWidth(`13px ${fontFamily.mono}`, 7.8)} lineH={13 * 1.6} padX={14} padY={12} fontSize={13} />
      </div>
      {/* Editable layer — transparent text, coloured caret */}
      <textarea
        ref={textareaRef}
        value={value}
        spellCheck={false}
        onChange={e => onChange(e.target.value)}
        onDoubleClick={selectTokenOnDoubleClick}
        onKeyDown={e => {
          const w = wrapSelection(e.key, e.currentTarget.value, e.currentTarget.selectionStart, e.currentTarget.selectionEnd);
          if (w) { e.preventDefault(); const ta = e.currentTarget; onChange(w.text); requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(w.start, w.end); }); return; }
          onKeyDown?.(e);
        }}
        onFocus={e => onFocus?.(e.currentTarget)}
        onSelect={trackCaret}
        onKeyUp={trackCaret}
        onClick={trackCaret}
        onBlur={() => setCaret(null)}
        onScroll={syncScroll}
        style={{
          ...SHARED,
          position:    'relative',
          zIndex:      2,
          background:  'transparent',
          color:       'transparent',
          caretColor:  hasError ? tk.status.danger : tk.text.primary,
          resize:      'none',
          display:     'block',
          overflow:    'hidden',
        }}
      />
    </div>
  );
}
