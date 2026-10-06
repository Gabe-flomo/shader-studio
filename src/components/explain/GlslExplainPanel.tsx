/**
 * The GLSL page's Explain panel: the selection (or the statement at the caret) explained under
 * the editor. A part can become a node; "Use it here too" puts the function into the file and a
 * call where the part was.
 */
import { useEffect, useMemo, useRef } from 'react';
import { explainLine, insertFunction, typesFromCode, type GeneraliseContext } from '../../lib/glslPatterns';
import { useTokens } from '../../theme/themeStore';
import { fontFamily } from '../../theme/tokens';
import { IconButton } from '../ui/Button';
import { ExplainView } from './ExplainView';
import { useExplainDialogs } from './useExplainDialogs';

export function GlslExplainPanel({ code, span, setCode, onClose }: {
  code: string;
  /** What was picked, and its text then (the panel notices when the file changed under it). */
  span: { start: number; end: number; text: string };
  setCode: (code: string) => void;
  onClose: () => void;
}) {
  const tk = useTokens();
  const dialogs = useExplainDialogs();
  const codeRef = useRef(code);
  useEffect(() => { codeRef.current = code; });
  const ctx: GeneraliseContext = useMemo(() => ({ types: typesFromCode(code) }), [code]);
  const ex = useMemo(() => explainLine(span.text, ctx), [span.text, ctx]);
  const stale = code.slice(span.start, span.end) !== span.text;
  return (
    <div data-glsl-explain="" style={{ borderTop: `1px solid ${tk.border.subtle}`, padding: '10px 12px', maxHeight: 340, overflowY: 'auto', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ font: `650 10.5px ${fontFamily.ui}`, letterSpacing: '0.08em', textTransform: 'uppercase', color: tk.text.faint, flex: 1 }}>
          Explain{stale ? ' · the code changed since: select it again to refresh' : ''}
        </span>
        <IconButton icon="close" label="Close the explanation" size="sm" onClick={onClose} />
      </div>
      {ex.ok ? (
        <ExplainView ex={ex} sentence={ex.lineSentence} editable={stale ? { start: 0, end: 0 } : { start: ex.line.exprStart, end: span.text.length }}
          onFindUses={dialogs.findUses}
          onMakeNode={rel => {
            const abs = { start: span.start + rel.start, end: span.start + rel.end };
            dialogs.makeNode({
              source: code, span: abs, ctx,
              useHere: {
                label: 'Use it here too: the function goes above this one in the file, and the selection becomes a call to it',
                blocked: () => (codeRef.current.slice(span.start, span.end) !== span.text ? 'The code changed since; select the part again.' : null),
                apply: built => setCode(insertFunction(codeRef.current, built.code, abs, built.call).code),
              },
            });
          }} />
      ) : (
        <span style={{ fontSize: 12.5, color: tk.text.muted }}>
          {ex.error === 'Nothing to explain' ? 'Select an expression, or put the caret in a statement, then press Explain.' : `This doesn’t read as one expression: ${ex.error}. Select a single expression or statement.`}
        </span>
      )}
      {dialogs.dialogs}
    </div>
  );
}
