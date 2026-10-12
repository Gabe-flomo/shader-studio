import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { redactSealedCode } from '../nodes/userNodes/userNodeRegistry';
import { useUserNodesVersion } from '../nodes/userNodes/useUserNodes';
import { C, C_LIGHT, tokenizeLine } from './glslSyntax';
import { nodeSlicePrefix } from './code/nodeSlice';
import { useThemeMode, useTokens } from '../theme/themeStore';
import { alpha, fontFamily, radius } from '../theme/tokens';
import { Button, IconButton } from './ui/Button';
import { Icon } from './ui/Icon';
import { loadShortcutMap } from '../hooks/useShortcuts';
import { useNodeGraphStore } from '../store/useNodeGraphStore';
import { glslErrorLines } from '../compiler/nodeErrors';
import { useFnCardScope } from './explain/functionCard/fnCardStore';
import { Segmented } from './ui/Choice';
import { readableGlsl, shaderLineNodes, type ReadableMeta } from '../compiler/readableGlsl';
import { fragmentCompiles, loadCodeView, saveCodeView, type CodeView } from './code/readableView';

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

export function CodePanel({ code: compiled, onClose, highlightNodeId, nodeSlugMap, docked = false }: Props) {
  const tk = useTokens();
  // Sealed node packs' code is shown as a comment (line for line, so error marks still line up).
  const userNodesVersion = useUserNodesVersion();
  const exactCode = useMemo(() => (compiled ? redactSealedCode(compiled) : compiled), [compiled, userNodesVersion]);
  // Readable / Exact (docs/readable-code.md): Exact is the compiled code; Readable renames, groups and
  // tidies it. The choice lasts for the session.
  const [view, setViewState] = useState<CodeView>(loadCodeView);
  const setView = (v: CodeView) => { setViewState(v); saveCodeView(v); };
  const paramBindings = useNodeGraphStore(s => s.paramBindings);
  const nodeOutputVars = useNodeGraphStore(s => s.nodeOutputVarMap);
  const shown = useMemo(() => {
    const meta: ReadableMeta | null = nodeSlugMap ? { nodes: useNodeGraphStore.getState().nodes, nodeSlugMap, paramBindings, nodeOutputVars } : null;
    const exact = { code: exactCode, lineNodes: exactCode && meta ? shaderLineNodes(exactCode, meta) : [], sourceLines: null as string[] | null, note: null as string | null };
    if (view !== 'readable' || !exactCode || !meta) return exact;
    // Sealed node packs stay hidden: their code is never renamed into view.
    if (exactCode !== compiled) return { ...exact, note: 'Readable isn’t available while a sealed node pack is in the graph — showing Exact.' };
    try {
      const r = readableGlsl(exactCode, meta);
      // If the GPU rejects Readable while Exact compiles, show Exact (never a broken copy).
      if (fragmentCompiles(r.code) === false && fragmentCompiles(exactCode) !== false) {
        return { ...exact, note: 'Readable didn’t compile here — showing Exact.' };
      }
      return { code: r.code, lineNodes: r.lineNodes, sourceLines: r.sourceLines, note: null };
    } catch {
      return { ...exact, note: 'Readable couldn’t be made for this graph — showing Exact.' };
    }
  }, [exactCode, compiled, view, nodeSlugMap, paramBindings, nodeOutputVars]);
  const code = shown.code;
  const focusNode = useNodeGraphStore(s => s.focusNode);
  const clickedSelect = useRef(false);
  const mode = useThemeMode();
  const pal = mode === 'dark' ? C : C_LIGHT;
  const [copied, setCopied] = useState(false);
  const [shortcuts] = useState(loadShortcutMap);
  const firstMatchRef = useRef<HTMLDivElement | null>(null);
  // Function cards: a click on a function name explains it; the shader's own functions come from the whole code
  const fnScope = useFnCardScope({ source: code ?? '' });

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
  const prefix = highlightSlug ? nodeSlicePrefix(highlightSlug) : null;

  const lines = code ? code.replace(/\n$/, '').split('\n') : ['// No shader compiled yet'];
  // A line is the selected node's when the compiler's map says so, or (as before) it names the node's slug.
  const isNodeLine = (i: number) => !!highlightNodeId && (shown.lineNodes[i] === highlightNodeId || (!!prefix && (shown.sourceLines?.[i] ?? lines[i]).includes(prefix)));

  // GLSL compile errors marked on their lines, with ↑/↓ to step through them
  const glslErrors = useNodeGraphStore(s => s.glslErrors);
  const glslErrorSource = useNodeGraphStore(s => s.glslErrorSource);
  // Errors are marked on Exact's lines (the code that runs); Readable's lines don't line up with them.
  const errorLines = code && shown.sourceLines === null ? glslErrorLines(code, glslErrorSource, glslErrors) : new Map<number, string[]>();
  const errorIdxs = [...errorLines.keys()].sort((a, b) => a - b);
  const lineEls = useRef(new Map<number, HTMLDivElement>());
  const [errorCursor, setErrorCursor] = useState(0);
  const jumpToError = (dir: 1 | -1) => {
    if (errorIdxs.length === 0) return;
    const next = (errorCursor + dir + errorIdxs.length) % errorIdxs.length;
    setErrorCursor(next);
    lineEls.current.get(errorIdxs[next])?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  const firstErrorIdx = errorIdxs[0];
  useEffect(() => {
    if (firstErrorIdx === undefined) return;
    const t = setTimeout(() => lineEls.current.get(firstErrorIdx)?.scrollIntoView({ block: 'center' }), 40);
    return () => clearTimeout(t);
  }, [firstErrorIdx, glslErrors]);

  // Pre-compute scroll target: prefer first match inside void main
  const scrollToLineIdx = (() => {
    if (!highlightNodeId) return -1;
    let firstAny = -1;
    let inMain = false;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trimStart().startsWith('void main')) inMain = true;
      if (isNodeLine(i)) {
        if (firstAny === -1) firstAny = i;
        if (inMain) return i;
      }
    }
    return firstAny;
  })();

  useEffect(() => {
    if (!highlightNodeId) return;
    // A click on a line selected this node: the line is already in view.
    if (clickedSelect.current) { clickedSelect.current = false; return; }
    const t = setTimeout(() => {
      firstMatchRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 40);
    return () => clearTimeout(t);
  }, [highlightNodeId, view]);

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
        {errorIdxs.length > 0 && (
          <>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, height: 24, padding: '0 9px', borderRadius: 7, background: alpha(tk.status.danger, 0.1), color: tk.status.danger, font: `600 11.5px ${fontFamily.ui}` }}>
              <i style={{ width: 7, height: 7, borderRadius: '50%', background: tk.status.danger }} />
              {errorIdxs.length} error{errorIdxs.length === 1 ? '' : 's'}
            </span>
            <IconButton icon="chevU" label="Previous error" size="sm" onClick={() => jumpToError(-1)} />
            <IconButton icon="chevD" label="Next error" size="sm" onClick={() => jumpToError(1)} />
            <span style={{ width: 1, height: 18, background: tk.border.default, margin: '0 2px' }} />
          </>
        )}
        {shown.note && <span style={{ color: tk.text.muted, font: `11.5px ${fontFamily.ui}` }}>{shown.note}</span>}
        <Segmented<CodeView>
          size="sm"
          ariaLabel="Code view"
          value={view}
          onChange={setView}
          options={[{ value: 'readable', label: 'Readable' }, { value: 'exact', label: 'Exact' }]}
        />
        <Button size="sm" variant="ghost" icon={copied ? 'check' : 'copy'} onClick={handleCopy} style={{ height: 28 }}>{copied ? 'Copied' : 'Copy'}</Button>
        <IconButton icon="chevD" label="Hide generated code" shortcut={shortcuts.toggleCode} size="sm" onClick={onClose} />
      </CodeBarRow>

      {/* Code content */}
      <div {...fnScope} style={{ flex: 1, overflow: 'auto', padding: '6px 0', font: `11.5px/1.62 ${fontFamily.mono}` }}>
        {lines.map((line, i) => {
          const isMatch = isNodeLine(i);
          const lineNode = shown.lineNodes[i] ?? null;
          const lineErrors = errorLines.get(i);
          const tokens = tokenizeLine(line || ' ', pal);
          const row = (
            <div
              key={i}
              ref={el => {
                if (i === scrollToLineIdx) setFirstMatch(el);
                if (lineErrors && el) lineEls.current.set(i, el); else lineEls.current.delete(i);
              }}
              onClick={lineNode ? () => {
                // A click (not a drag-select) on a line selects its node in the graph.
                if (window.getSelection()?.toString()) return;
                if (lineNode === highlightNodeId) return;
                clickedSelect.current = true;
                focusNode(lineNode);
              } : undefined}
              style={{ display: 'flex', whiteSpace: 'pre', cursor: lineNode ? 'pointer' : undefined, background: lineErrors ? alpha(tk.status.danger, 0.08) : isMatch ? tk.bg.selected : 'transparent', transition: 'background 0.15s' }}
            >
              <span style={{ width: gutter, flexShrink: 0, textAlign: 'right', paddingRight: 14, color: lineErrors ? tk.status.danger : isMatch ? tk.accent.base : tk.text.disabled, userSelect: 'none', fontWeight: lineErrors ? 700 : undefined }}>{i + 1}</span>
              <span data-fn-code="" style={{ paddingRight: 16 }}>
                {tokens.map((tok, j) => (
                  // Dim lines outside the selected node, like an inactive editor.
                  <span key={j} style={{ color: tok.color, opacity: isMatch || !prefix || lineErrors ? 1 : 0.55 }}>{tok.text}</span>
                ))}
              </span>
            </div>
          );
          if (!lineErrors) return row;
          return [row, ...lineErrors.map((msg, k) => (
            <div key={`${i}-err-${k}`} style={{ display: 'flex', margin: '2px 0 4px' }}>
              <span style={{ width: gutter, flexShrink: 0 }} />
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 8px', borderRadius: 6,
                background: alpha(tk.status.danger, 0.1), color: tk.status.danger, font: `500 11.5px ${fontFamily.ui}`, whiteSpace: 'normal',
              }}>
                <Icon name="alert" size={13} />{msg}
              </span>
            </div>
          ))];
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
