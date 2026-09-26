/**
 * GlslEditor — the code editor the GLSL page has always had, on its own so
 * other pages (Convert) get the same one: line numbers, syntax colouring
 * under a transparent textarea, Tab, Enter auto-indent, bracket wrapping and
 * its own undo history. Controlled by `value`/`onChange`; the `ref` handle
 * inserts at the caret or replaces the whole file with history kept.
 */
import { BRACKET_PAIRS, selectTokenOnDoubleClick } from './editKeys';
import { BracketMarks } from './BracketMarks';
import { monoCharWidth } from './brackets';
import { useCallback, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from 'react';
import { tokenizeLine, C, C_LIGHT } from '../glslSyntax';
import { useThemeMode, useTokens } from '../../theme/themeStore';
import { alpha, fontFamily } from '../../theme/tokens';

export interface GlslEditorHandle {
  insertAtCursor: (text: string) => void;
  /** Replace the whole file, as loading a shader does: a new history entry, caret at the start. */
  replaceAll: (code: string) => void;
  focus: () => void;
  /** Select a span of the file and scroll it into view (Show in file). */
  selectRange: (start: number, end: number) => void;
}

// Shared font/padding so the overlay lines up with the textarea exactly.
export const EDITOR_FONT = "'Fira Code', 'JetBrains Mono', 'Cascadia Code', 'Consolas', monospace";
const EDITOR_FONT_SIZE = '12px';
const EDITOR_LINE_HEIGHT = '1.6';
const EDITOR_PADDING = '10px 12px';

export function GlslEditor({ value, onChange, ref, ariaLabel = 'GLSL source', placeholder, autoFocus, errorLines }: {
  value: string;
  onChange: (code: string) => void;
  ref?: Ref<GlslEditorHandle>;
  ariaLabel?: string;
  placeholder?: string;
  autoFocus?: boolean;
  /** Lines (1-based) with a problem, and what it is: tinted in the editor, the message on hover and in the gutter. */
  errorLines?: Map<number, string>;
}) {
  const tk = useTokens();
  const mode = useThemeMode();
  const pal = mode === 'dark' ? C : C_LIGHT;

  const textareaRef  = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const lineNumRef   = useRef<HTMLDivElement>(null);
  const messageRef   = useRef<HTMLDivElement>(null);

  // ── Undo / redo stack ──────────────────────────────────────────────────────
  const undoStack = useRef<string[]>([value]);
  const undoIdx   = useRef<number>(0);
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pushHistory = useCallback((next: string) => {
    if (pushTimer.current) clearTimeout(pushTimer.current);
    pushTimer.current = setTimeout(() => {
      const stack = undoStack.current.slice(0, undoIdx.current + 1);
      if (stack[stack.length - 1] === next) return;
      stack.push(next);
      if (stack.length > 100) stack.shift();
      undoStack.current = stack;
      undoIdx.current   = stack.length - 1;
    }, 400);
  }, []);
  const pushNow = (next: string) => {
    if (pushTimer.current) { clearTimeout(pushTimer.current); pushTimer.current = null; }
    const stack = undoStack.current.slice(0, undoIdx.current + 1);
    if (stack[stack.length - 1] !== next) stack.push(next);
    undoStack.current = stack;
    undoIdx.current   = stack.length - 1;
  };

  // ── Sync overlay scroll ────────────────────────────────────────────────────
  const syncScroll = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    if (highlightRef.current) {
      highlightRef.current.scrollTop  = ta.scrollTop;
      highlightRef.current.scrollLeft = ta.scrollLeft;
    }
    if (messageRef.current) messageRef.current.scrollTop = ta.scrollTop;
    if (lineNumRef.current) lineNumRef.current.scrollTop = ta.scrollTop;
  }, []);

  // Where the caret should land after a programmatic edit (Tab, Enter, undo, insert).
  // Applied in a layout effect, straight after React writes the new value: a
  // controlled textarea jumps its caret to the end on every value change, and
  // restoring it a frame later let fast typing land at the end of the file.
  const pendingSel = useRef<{ start: number; end: number } | null>(null);
  const setSel = (start: number, end = start) => { pendingSel.current = { start, end }; };
  useLayoutEffect(() => {
    const ta = textareaRef.current;
    const sel = pendingSel.current;
    if (ta && sel) {
      pendingSel.current = null;
      ta.selectionStart = sel.start;
      ta.selectionEnd = sel.end;
    }
    syncScroll();
  }, [value, syncScroll]);

  const insertAtCursor = useCallback((text: string) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const code = ta.value;
    const start = ta.selectionStart;
    const end   = ta.selectionEnd;
    const selected = code.slice(start, end);
    let newCode: string;
    let cursorPos: number;
    // If text ends with an empty arg slot '()' and there's a selection, wrap it
    if (selected && text.endsWith('()')) {
      newCode   = code.slice(0, start) + text.slice(0, -1) + selected + ')' + code.slice(end);
      cursorPos = start + text.length - 1 + selected.length + 1;
    } else {
      newCode   = code.slice(0, start) + text + code.slice(end);
      // Place cursor at first empty comma slot or after the insertion
      const innerOffset = text.indexOf('()') !== -1 ? text.indexOf('()') + 1 :
                          text.indexOf(', )') !== -1 ? text.indexOf(', )') + 2 :
                          text.length;
      cursorPos = start + innerOffset;
    }
    setSel(cursorPos);
    onChange(newCode);
    pushHistory(newCode);
    requestAnimationFrame(() => ta.focus());
  }, [onChange, pushHistory]);

  useImperativeHandle(ref, () => ({
    insertAtCursor,
    replaceAll: (code: string) => { setSel(0); onChange(code); pushNow(code); },
    focus: () => textareaRef.current?.focus(),
    selectRange: (start: number, end: number) => {
      const ta = textareaRef.current; if (!ta) return;
      ta.focus();
      ta.setSelectionRange(start, end);
      const line = ta.value.slice(0, start).split('\n').length;
      const lh = parseFloat(getComputedStyle(ta).lineHeight) || 19.2;
      ta.scrollTop = Math.max(0, (line - 3) * lh);
      ta.dispatchEvent(new Event('scroll')); // keeps the highlight and line-number layers in step
    },
  }), [insertAtCursor, onChange]);

  // ── Keyboard handler ──────────────────────────────────────────────────────
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const ta = e.currentTarget;
    const code = ta.value;
    const start = ta.selectionStart;
    const end   = ta.selectionEnd;

    if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      if (pushTimer.current) { clearTimeout(pushTimer.current); pushTimer.current = null; }
      if (undoIdx.current > 0) {
        undoIdx.current--;
        const restored = undoStack.current[undoIdx.current];
        setSel(Math.min(start, restored.length));
        onChange(restored);
      }
      return;
    }
    if ((e.metaKey || e.ctrlKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
      e.preventDefault();
      if (undoIdx.current < undoStack.current.length - 1) {
        undoIdx.current++;
        const restored = undoStack.current[undoIdx.current];
        setSel(Math.min(start, restored.length));
        onChange(restored);
      }
      return;
    }
    // Tab → 4 spaces
    if (e.key === 'Tab') {
      e.preventDefault();
      const newCode = code.slice(0, start) + '    ' + code.slice(end);
      setSel(start + 4);
      onChange(newCode);
      pushHistory(newCode);
      return;
    }
    // Enter → auto-indent, one level deeper after an opening brace
    if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) { // ⌘↵ / Ctrl+Enter is the page's (Convert): let it through
      e.preventDefault();
      const lineStart = code.lastIndexOf('\n', start - 1) + 1;
      const line      = code.slice(lineStart, start);
      const indent    = line.match(/^(\s*)/)?.[1] ?? '';
      const extra     = line.trimEnd().endsWith('{') ? '    ' : '';
      const insertion = '\n' + indent + extra;
      const newCode   = code.slice(0, start) + insertion + code.slice(end);
      setSel(start + insertion.length);
      onChange(newCode);
      pushHistory(newCode);
      return;
    }
    // Bracket / quote wrap around a selection
    if (e.key in BRACKET_PAIRS && start !== end) {
      e.preventDefault();
      const [open, close] = BRACKET_PAIRS[e.key];
      const selected = code.slice(start, end);
      const newCode  = code.slice(0, start) + open + selected + close + code.slice(end);
      setSel(start + 1, end + 1);
      onChange(newCode);
      pushHistory(newCode);
      return;
    }
  }, [onChange, pushHistory]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    onChange(val);
    pushHistory(val);
  }, [onChange, pushHistory]);

  const lines = value.split('\n');
  // Bracket marks: the pair at the caret, and every unmatched bracket.
  const [caret, setCaret] = useState<number | null>(null);
  const trackCaret = (e: React.SyntheticEvent<HTMLTextAreaElement>) => { const el = e.currentTarget; setCaret(el.selectionStart === el.selectionEnd ? el.selectionStart : null); };
  const editorCharW = monoCharWidth(`${EDITOR_FONT_SIZE} ${EDITOR_FONT}`, parseFloat(EDITOR_FONT_SIZE) * 0.6);
  const editorLineH = parseFloat(EDITOR_FONT_SIZE) * parseFloat(EDITOR_LINE_HEIGHT);

  return (
    <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
      {/* Line numbers — scroll-synced */}
      <div
        ref={lineNumRef}
        style={{
          width: 44, flexShrink: 0, background: tk.bg.subtle, borderRight: `1px solid ${tk.border.subtle}`,
          overflowY: 'hidden', paddingTop: EDITOR_PADDING.split(' ')[0], paddingRight: 10, textAlign: 'right',
          color: tk.text.disabled, fontSize: EDITOR_FONT_SIZE, lineHeight: EDITOR_LINE_HEIGHT, fontFamily: EDITOR_FONT,
          userSelect: 'none', pointerEvents: 'none',
        }}
      >
        {lines.map((_, i) => <div key={i} style={errorLines?.has(i + 1) ? { color: tk.status.danger, fontWeight: 700 } : undefined}>{i + 1}</div>)}
      </div>
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {/* Syntax-highlighted background */}
        <div
          ref={highlightRef}
          aria-hidden="true"
          style={{
            position: 'absolute', inset: 0, padding: EDITOR_PADDING,
            fontSize: EDITOR_FONT_SIZE, lineHeight: EDITOR_LINE_HEIGHT, fontFamily: EDITOR_FONT,
            whiteSpace: 'pre', overflowY: 'hidden', overflowX: 'hidden', pointerEvents: 'none', tabSize: 4,
            fontVariantLigatures: 'none', letterSpacing: 0,
          }}
        >
          {lines.map((line, i) => (
            <div key={i} style={{ minHeight: `calc(${EDITOR_LINE_HEIGHT} * ${EDITOR_FONT_SIZE})`, ...(errorLines?.has(i + 1) ? { background: alpha(tk.status.danger, 0.16), boxShadow: `inset 3px 0 0 ${tk.status.danger}`, margin: '0 -12px', padding: '0 12px' } : {}) }}>
              {tokenizeLine(line || ' ', pal).map((tok, j) => (
                <span key={j} style={{ color: tok.color }}>{tok.text}</span>
              ))}
            </div>
          ))}
          <BracketMarks text={value} caret={caret} charW={editorCharW} lineH={editorLineH} padX={12} padY={10} fontSize={parseFloat(EDITOR_FONT_SIZE)} />
        </div>
        {/* The messages, over the failing lines (the textarea is transparent, so these sit on it). */}
        <div aria-hidden="true" style={{ position: 'absolute', inset: 0, padding: EDITOR_PADDING, fontSize: EDITOR_FONT_SIZE, lineHeight: EDITOR_LINE_HEIGHT, fontFamily: EDITOR_FONT, pointerEvents: 'none', overflow: 'hidden', zIndex: 2 }} ref={messageRef}>
          {errorLines && lines.map((_, i) => {
            const msg = errorLines.get(i + 1);
            return (
              <div key={i} style={{ minHeight: `calc(${EDITOR_LINE_HEIGHT} * ${EDITOR_FONT_SIZE})`, display: 'flex', justifyContent: 'flex-end' }}>
                {msg && <span style={{ alignSelf: 'center', maxWidth: '60%', padding: '0 8px', borderRadius: 6, background: tk.status.danger, color: '#fff', font: `600 10.5px ${fontFamily.ui}`, lineHeight: '16px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', pointerEvents: 'auto' }} title={msg}>{msg}</span>}
              </div>
            );
          })}
        </div>
        {/* Transparent textarea on top */}
        <textarea
          ref={textareaRef}
          aria-label={ariaLabel}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onDoubleClick={selectTokenOnDoubleClick}
          onSelect={trackCaret}
          onKeyUp={trackCaret}
          onClick={trackCaret}
          onBlur={() => setCaret(null)}
          onScroll={syncScroll}
          placeholder={placeholder}
          autoFocus={autoFocus}
          // The overlay never wraps, so the textarea must not either: a soft-wrapped long
          // line pushed every later line down and the caret no longer matched the text.
          wrap="off"
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
          style={{
            position: 'absolute', inset: 0, background: 'transparent', color: 'transparent', caretColor: tk.text.primary,
            border: 'none', outline: 'none', resize: 'none', padding: EDITOR_PADDING,
            fontSize: EDITOR_FONT_SIZE, lineHeight: EDITOR_LINE_HEIGHT, fontFamily: EDITOR_FONT,
            tabSize: 4, overflowY: 'auto', overflowX: 'auto', zIndex: 1,
            whiteSpace: 'pre', fontVariantLigatures: 'none', letterSpacing: 0,
          }}
        />
      </div>
    </div>
  );
}
