import { useCallback, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useThemeMode, useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { C, C_LIGHT, tokenizeLine } from '../glslSyntax';
import { CompletionPopup } from './CompletionPopup';
import type { Completion } from './glslReference';
import { useCompletion } from './useCompletion';

const FONT_SIZE = 12.5;
const LINE_H = 20;
const PAD_Y = 8;
const PAD_X = 12;
const GUTTER = 36;

let charWidthCache = 0;
function charWidth(): number {
  if (!charWidthCache) {
    const ctx = document.createElement('canvas').getContext('2d');
    if (ctx) { ctx.font = `${FONT_SIZE}px ${fontFamily.mono}`; charWidthCache = ctx.measureText('M').width; }
  }
  return charWidthCache || FONT_SIZE * 0.6;
}

function esc(s: string) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

/**
 * GLSL editor for the modals: header (title + actions such as undo/redo), line numbers, syntax
 * highlighting in the app theme, and autocomplete from `completions` (the node's variables plus
 * the GLSL reference). Tab inserts two spaces when no suggestion is open. `grow` fills the
 * parent's height; otherwise it sizes to `minHeight`–`maxHeight` and scrolls.
 */
export function CodeField({
  value, onChange, completions, title = 'GLSL', actions, textareaRef, onKeyDown, onBlur, onFocus, placeholder,
  ariaLabel, grow = false, minHeight = 120, maxHeight, invalid = false, style,
}: {
  value: string;
  onChange: (value: string) => void;
  completions: readonly Completion[];
  title?: ReactNode;
  actions?: ReactNode;
  /** Callback ref to the textarea (for inserting at the caret from outside). */
  textareaRef?: (el: HTMLTextAreaElement | null) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onBlur?: () => void;
  onFocus?: (el: HTMLTextAreaElement) => void;
  placeholder?: string;
  ariaLabel: string;
  grow?: boolean;
  minHeight?: number;
  maxHeight?: number;
  invalid?: boolean;
  style?: CSSProperties;
}) {
  const tk = useTokens();
  const pal = useThemeMode() === 'dark' ? C : C_LIGHT;
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);

  const setRefs = useCallback((el: HTMLTextAreaElement | null) => {
    taRef.current = el;
    textareaRef?.(el);
  }, [textareaRef]);

  const onApply = useCallback((next: string, caret: number) => {
    onChange(next);
    requestAnimationFrame(() => { taRef.current?.focus(); taRef.current?.setSelectionRange(caret, caret); });
  }, [onChange]);
  const ac = useCompletion(completions, onApply);

  const lines = value.split('\n');
  const html = lines.map(l => tokenizeLine(l, pal).map(t => `<span style="color:${t.color}">${esc(t.text)}</span>`).join('')).join('\n') + '\n';

  // Popup position: under the start of the word being completed (set when the text changes)
  const [anchorXY, setAnchorXY] = useState<{ x: number; y: number } | null>(null);
  const placePopup = (text: string, anchor: number | null) => {
    const sc = scrollRef.current;
    if (anchor === null || !sc) { setAnchorXY(null); return; }
    const before = text.slice(0, anchor);
    const line = before.split('\n').length - 1;
    const col = before.length - before.lastIndexOf('\n') - 1;
    const r = sc.getBoundingClientRect();
    setAnchorXY({
      x: r.left + GUTTER + PAD_X + col * charWidth() - sc.scrollLeft - 8,
      y: r.top + PAD_Y + (line + 1) * LINE_H - sc.scrollTop + 4,
    });
  };

  const text: CSSProperties = {
    margin: 0, padding: `${PAD_Y}px ${PAD_X}px`, border: 0, font: `${FONT_SIZE}px/${LINE_H}px ${fontFamily.mono}`,
    whiteSpace: 'pre', tabSize: 2, letterSpacing: 0, boxSizing: 'border-box',
  };

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', minHeight: 0, borderRadius: radius.lg, overflow: 'hidden', background: tk.bg.panel,
      boxShadow: `inset 0 0 0 ${invalid || focused ? 1.5 : 1}px ${invalid ? tk.status.danger : focused ? tk.accent.base : tk.border.default}`,
      flex: grow ? 1 : undefined, ...style,
    }}>
      <div style={{
        height: 38, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 2, padding: '0 6px 0 12px',
        background: tk.bg.subtle, borderBottom: `1px solid ${tk.border.subtle}`,
      }}>
        <span style={{ marginRight: 'auto', fontWeight: 600, fontSize: 12, color: tk.text.secondary }}>{title}</span>
        {actions}
      </div>
      <div
        ref={scrollRef}
        onScroll={ac.close}
        style={{ flex: grow ? 1 : undefined, minHeight, maxHeight, overflow: 'auto', display: 'flex', cursor: 'text' }}
        onMouseDown={e => { if (e.target === e.currentTarget) { e.preventDefault(); taRef.current?.focus(); } }}
      >
        <div aria-hidden style={{
          width: GUTTER, flexShrink: 0, padding: `${PAD_Y}px 8px ${PAD_Y}px 0`, boxSizing: 'border-box', textAlign: 'right',
          font: `${FONT_SIZE - 1.5}px/${LINE_H}px ${fontFamily.mono}`, color: tk.text.disabled, userSelect: 'none',
          position: 'sticky', left: 0, background: tk.bg.panel,
        }}>
          {lines.map((_, i) => <div key={i}>{i + 1}</div>)}
        </div>
        {/* As wide as the longest line, so the textarea never scrolls on its own */}
        <div style={{ position: 'relative', flex: '1 0 auto' }}>
          <pre aria-hidden dangerouslySetInnerHTML={{ __html: html }} style={{ ...text, color: tk.text.primary, minWidth: '100%', width: 'max-content', pointerEvents: 'none' }} />
          {!value && placeholder && (
            <pre aria-hidden style={{ ...text, position: 'absolute', inset: 0, color: tk.text.faint, pointerEvents: 'none' }}>{placeholder}</pre>
          )}
          <textarea
            ref={setRefs}
            aria-label={ariaLabel}
            aria-autocomplete="list"
            aria-expanded={ac.state.open}
            data-captures-escape={ac.state.open || undefined}
            value={value}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            onChange={e => { onChange(e.target.value); placePopup(e.target.value, ac.update(e.target)); }}
            onKeyDown={e => {
              if (ac.handleKey(e)) return;
              if (e.key === 'Tab' && !e.metaKey && !e.ctrlKey) {
                e.preventDefault();
                const ta = e.currentTarget;
                const s = ta.selectionStart, end = ta.selectionEnd;
                onApply(value.slice(0, s) + '  ' + value.slice(end), s + 2);
                return;
              }
              onKeyDown?.(e);
            }}
            onClick={ac.close}
            onFocus={e => { setFocused(true); onFocus?.(e.currentTarget); }}
            onBlur={() => { setFocused(false); ac.close(); onBlur?.(); }}
            style={{
              ...text, position: 'absolute', inset: 0, width: '100%', height: '100%', resize: 'none', outline: 'none', overflow: 'hidden',
              background: 'transparent', color: 'transparent', caretColor: tk.accent.base,
            }}
          />
        </div>
      </div>
      {ac.state.open && anchorXY && (
        <CompletionPopup
          items={ac.state.items}
          index={ac.state.index}
          word={ac.state.word}
          x={anchorXY.x}
          y={anchorXY.y}
          onHover={ac.select}
          onPick={item => { if (taRef.current) ac.apply(taRef.current, item); }}
        />
      )}
    </div>
  );
}

/**
 * One-line GLSL expression field (Expr Block lines, return expression) with the same
 * autocomplete as CodeField. Styled like the app's Field.
 */
export function CodeInput({
  value, onChange, completions, ariaLabel, placeholder, height = 34, style, inputRef, onFocus, onBlur, onKeyDown,
}: {
  value: string;
  onChange: (value: string) => void;
  completions: readonly Completion[];
  ariaLabel: string;
  placeholder?: string;
  height?: number;
  style?: CSSProperties;
  inputRef?: (el: HTMLInputElement | null) => void;
  onFocus?: (el: HTMLInputElement) => void;
  onBlur?: () => void;
  /** Called for keys the suggestion popup doesn't consume. */
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}) {
  const tk = useTokens();
  const pal = useThemeMode() === 'dark' ? C : C_LIGHT;
  const elRef = useRef<HTMLInputElement | null>(null);
  const [focused, setFocused] = useState(false);
  const [scrollX, setScrollX] = useState(0);
  const setRefs = useCallback((el: HTMLInputElement | null) => {
    elRef.current = el;
    inputRef?.(el);
  }, [inputRef]);
  const onApply = useCallback((next: string, caret: number) => {
    onChange(next);
    requestAnimationFrame(() => { elRef.current?.focus(); elRef.current?.setSelectionRange(caret, caret); });
  }, [onChange]);
  const ac = useCompletion(completions, onApply);
  const [anchorXY, setAnchorXY] = useState<{ x: number; y: number } | null>(null);
  const placePopup = (el: HTMLInputElement, anchor: number | null) => {
    if (anchor === null) { setAnchorXY(null); return; }
    const r = el.getBoundingClientRect();
    setAnchorXY({ x: r.left + anchor * charWidth() - el.scrollLeft - 8, y: r.bottom + 6 });
  };

  const text: CSSProperties = { font: `500 ${FONT_SIZE}px ${fontFamily.mono}`, whiteSpace: 'pre', letterSpacing: 0 };
  return (
    <span style={{
      position: 'relative', height, minWidth: 0, display: 'flex', alignItems: 'center', padding: '0 10px', borderRadius: radius.control,
      background: focused ? tk.bg.panel : tk.bg.field, boxShadow: focused ? `inset 0 0 0 1.5px ${tk.accent.base}` : 'none', overflow: 'hidden',
      ...style,
    }}>
      {/* Highlight layer under a transparent input */}
      <span aria-hidden style={{ ...text, position: 'absolute', left: 10, right: 10, overflow: 'hidden', pointerEvents: 'none' }}>
        <span style={{ display: 'inline-block', transform: `translateX(${-scrollX}px)` }}>{value
          ? tokenizeLine(value, pal).map((t, i) => <span key={i} style={{ color: t.color }}>{t.text}</span>)
          : <span style={{ color: tk.text.faint }}>{placeholder}</span>}</span>
      </span>
      <input
        ref={setRefs}
        aria-label={ariaLabel}
        aria-autocomplete="list"
        aria-expanded={ac.state.open}
        data-captures-escape={ac.state.open || undefined}
        value={value}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        onChange={e => { onChange(e.target.value); placePopup(e.target, ac.update(e.target)); }}
        onKeyDown={e => { if (!ac.handleKey(e)) onKeyDown?.(e); }}
        onScroll={e => setScrollX(e.currentTarget.scrollLeft)}
        onKeyUp={e => setScrollX(e.currentTarget.scrollLeft)}
        onSelect={e => setScrollX(e.currentTarget.scrollLeft)}
        onFocus={e => { setFocused(true); onFocus?.(e.currentTarget); }}
        onBlur={() => { setFocused(false); ac.close(); onBlur?.(); }}
        onClick={ac.close}
        style={{ ...text, position: 'relative', flex: 1, minWidth: 0, padding: 0, border: 0, outline: 'none', background: 'transparent', color: 'transparent', caretColor: tk.accent.base }}
      />
      {ac.state.open && anchorXY && (
        <CompletionPopup
          items={ac.state.items}
          index={ac.state.index}
          word={ac.state.word}
          x={anchorXY.x}
          y={anchorXY.y}
          onHover={ac.select}
          onPick={item => { if (elRef.current) ac.apply(elRef.current, item); }}
        />
      )}
    </span>
  );
}
