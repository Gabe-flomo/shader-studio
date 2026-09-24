import { useState, useEffect, useRef, useCallback } from 'react';
import { C, C_LIGHT, tokenizeLine } from './glslSyntax';
import { useThemeMode, useTokens } from '../theme/themeStore';
import { alpha, fontFamily, radius } from '../theme/tokens';
import { Button, IconButton } from './ui/Button';
import { Icon } from './ui/Icon';
import { loadShortcutMap } from '../hooks/useShortcuts';

// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  code: string;
  onClose: () => void;
  highlightNodeId?: string | null;
  nodeSlugMap?: Map<string, string>;
  /** Desktop: sits in the layout under the canvas instead of floating over it. */
  docked?: boolean;
}

const MIN_HEIGHT = 120;
const MAX_HEIGHT = 0.85; // fraction of window height
const LS_KEY = 'codePanel_height';

export function CodePanel({ code, onClose, highlightNodeId, nodeSlugMap, docked = false }: Props) {
  const tk = useTokens();
  const mode = useThemeMode();
  const pal = mode === 'dark' ? C : C_LIGHT;
  const [copied, setCopied] = useState(false);
  const [shortcuts] = useState(loadShortcutMap);
  const firstMatchRef = useRef<HTMLDivElement | null>(null);

  // Resizable height — persisted to localStorage
  const [height, setHeight] = useState<number>(() => {
    const stored = localStorage.getItem(LS_KEY);
    return stored ? Math.max(MIN_HEIGHT, Number(stored)) : 240;
  });

  const onResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = height;
    const onMove = (mv: MouseEvent) => {
      const next = Math.min(
        Math.floor(window.innerHeight * MAX_HEIGHT),
        Math.max(MIN_HEIGHT, startH + (startY - mv.clientY)),
      );
      setHeight(next);
    };
    const onUp = (mv: MouseEvent) => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      const final = Math.min(
        Math.floor(window.innerHeight * MAX_HEIGHT),
        Math.max(MIN_HEIGHT, startH + (startY - mv.clientY)),
      );
      localStorage.setItem(LS_KEY, String(final));
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [height]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked: the code is still selectable */ }
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

  const gutter = String(lines.length).length * 8 + 22;

  return (
    <div style={{
      ...(docked
        ? { position: 'relative', flexShrink: 0 }
        : { position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 20, boxShadow: tk.shadow.popover }),
      height, background: tk.bg.panel, borderTop: `1px solid ${tk.border.default}`,
      display: 'flex', flexDirection: 'column', font: `12.5px ${fontFamily.ui}`, color: tk.text.primary,
    }}>
      {/* Drag-to-resize handle */}
      <div
        onMouseDown={onResizeMouseDown}
        style={{ position: 'absolute', top: -3, left: 0, right: 0, height: 6, cursor: 'ns-resize', zIndex: 1, background: 'transparent' }}
        onMouseEnter={e => (e.currentTarget.style.background = alpha(tk.accent.base, 0.25))}
        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
      />
      <CodeBarRow slug={highlightSlug}>
        <Button size="sm" variant="ghost" icon={copied ? 'check' : 'copy'} onClick={handleCopy} style={{ height: 28 }}>{copied ? 'Copied' : 'Copy'}</Button>
        <IconButton icon="chevD" label="Hide generated code" shortcut={shortcuts.toggleCode} size="sm" onClick={onClose} />
      </CodeBarRow>

      {/* Code content */}
      <div style={{ flex: 1, overflow: 'auto', padding: '6px 0', font: `11.5px/1.62 ${fontFamily.mono}` }}>
        {lines.map((line, i) => {
          const isMatch = !!(prefix && line.includes(prefix));
          const tokens = tokenizeLine(line || ' ', pal);
          return (
            <div
              key={i}
              ref={i === scrollToLineIdx ? setFirstMatch : undefined}
              style={{ display: 'flex', whiteSpace: 'pre', background: isMatch ? tk.bg.selected : 'transparent', transition: 'background 0.15s' }}
            >
              <span style={{ width: gutter, flexShrink: 0, textAlign: 'right', paddingRight: 14, color: isMatch ? tk.accent.base : tk.text.disabled, userSelect: 'none' }}>{i + 1}</span>
              <span style={{ paddingRight: 16 }}>
                {tokens.map((tok, j) => (
                  // Dim lines outside the selected node, like an inactive editor.
                  <span key={j} style={{ color: tok.color, opacity: isMatch || !prefix ? 1 : 0.55 }}>{tok.text}</span>
                ))}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** The 40px bar shared by the collapsed dock and the open panel's header. */
export function CodeBarRow({ slug, onClick, children }: { slug: string | null; onClick?: () => void; children?: React.ReactNode }) {
  const tk = useTokens();
  return (
    <div
      onClick={onClick}
      style={{
        height: 40, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '0 8px 0 16px',
        background: tk.bg.panel, color: tk.text.primary, font: `12.5px ${fontFamily.ui}`,
        borderBottom: onClick ? 'none' : `1px solid ${tk.border.subtle}`, cursor: onClick ? 'pointer' : 'default',
      }}
    >
      <Icon name="code" size={15} style={{ color: tk.text.muted }} />
      <span style={{ fontWeight: 600, fontSize: 12.5 }}>Generated code</span>
      {slug && (
        <span style={{ font: `500 11px ${fontFamily.mono}`, color: tk.accent.text, background: tk.bg.selected, borderRadius: radius.sm, padding: '2px 7px' }}>
          {slug}
        </span>
      )}
      <span style={{ flex: 1 }} />
      {children}
    </div>
  );
}
