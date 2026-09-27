/**
 * StepView — one step: its title and its blocks, in one column or two (an
 * interactive block always spans both; phones always use one). In Edit it
 * also has the bar that adds blocks.
 */
import { useMemo, useState } from 'react';
import { newBlock, newId, type BlockType, type PresentSource, type Step } from '../../types/presentation';
import { AddCodeDialog, type CodePick, type CodeRoute } from './AddCodeDialog';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Icon } from '../ui/Icon';
import { BlockView, type BlockContext } from './Blocks';
import { BLOCK_META } from './blockMeta';
import { SourcePicker } from './Sources';
import { usePresentation } from './presentationStore';
import { usePresentTheme } from './presentLook';

export function StepView({ step, index, ctx, total }: { step: Step; index: number; total: number; ctx: BlockContext }) {
  const patchStep = usePresentation(s => s.patchStep);
  const cols = ctx.compact ? 1 : step.columns;
  const stepCtx = useMemo(() => ({ ...ctx, step }), [ctx, step]);
  const numbers = usePresentTheme().spec.number;
  const pad = (n: number) => String(n).padStart(2, '0');
  // The theme's step number: "02 / 07", an eyebrow pill, or a byline ("Step 2 of 7").
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: `calc(${ctx.large ? 26 : 22}px * var(--pp-space, 1))` }}>
      <header className="pp-head">
        <span className="pp-num" style={ctx.large && numbers === 'plain' ? { fontSize: 13 } : undefined}>{numbers === 'meta' ? <>Step {index + 1}<i> of {total}</i></> : <>{pad(index + 1)}<i> / {pad(total)}</i></>}</span>
        {ctx.editing ? (
          <input
            value={step.title ?? ''}
            placeholder="Step title"
            onChange={e => patchStep(index, { title: e.target.value || undefined })}
            onKeyDown={e => e.stopPropagation()}
            className="pp-title"
            style={{ flex: 1, minWidth: 0, border: 0, outline: 'none', background: 'transparent', padding: 0, fontSize: `calc(${ctx.compact ? 22 : 26}px * var(--pp-scale, 1) * var(--pp-title, 1))` }}
          />
        ) : step.title ? (
          <h2 className="pp-title" style={{ margin: 0, fontSize: `calc(${ctx.compact ? 22 : ctx.large ? 32 : 26}px * var(--pp-scale, 1) * var(--pp-title, 1))` }}>{step.title}</h2>
        ) : null}
      </header>
      {step.blocks.length > 0 && (
        // Side by side on a slide, text sits level with the picture beside it.
        <div className="pp-step-grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, alignItems: cols === 2 && ctx.large ? 'center' : 'start' }}>
          {step.blocks.map(b => (
            <div key={b.id} style={{ gridColumn: b.type === 'interactive' || cols === 1 ? '1 / -1' : undefined, minWidth: 0 }}>
              <BlockView block={b} ctx={stepCtx} />
            </div>
          ))}
        </div>
      )}
      {ctx.editing && <AddBlockBar compact={ctx.compact} empty={step.blocks.length === 0} />}
    </div>
  );
}

/** What each button in the add bar says it makes. */
const ADD_HINTS: Record<BlockType, string> = {
  text: 'Words and maths',
  render: 'A Play’s picture',
  interactive: 'Picture, text and sliders',
  code: 'GLSL with a live preview',
};

const CODE_ROUTES: Array<{ route: CodeRoute; label: string }> = [
  { route: 'write', label: 'write your own' },
  { route: 'functions', label: 'a function' },
  { route: 'nodes', label: 'a node’s code' },
  { route: 'shader', label: 'part of a shader' },
];

/** Text, Render, Interactive, Code. The canvas kinds ask which Play first; Code opens the Add code chooser. */
function AddBlockBar({ compact, empty }: { compact: boolean; empty: boolean }) {
  const tk = useTokens();
  const addBlock = usePresentation(s => s.addBlock);
  const [picking, setPicking] = useState<BlockType | null>(null);
  const [coding, setCoding] = useState<CodeRoute | null>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const add = (type: BlockType, s?: PresentSource) => addBlock(newBlock(type, s));
  const addCode = (p: CodePick) => addBlock({ type: 'code', id: newId('b'), ...p });
  const types: BlockType[] = ['text', 'render', 'interactive', 'code'];
  const big = empty && !compact;
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: empty ? '32px 16px' : '14px 12px', borderRadius: radius.lg,
      border: `1.5px dashed var(--pp-rule, ${tk.border.strong})`, background: empty ? alpha(tk.accent.base, 0.03) : 'transparent',
    }}>
      {empty && <div style={{ color: `var(--pp-muted, ${tk.text.muted})`, font: `500 13px ${fontFamily.ui}` }}>An empty step. Add a block:</div>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
        {types.map(t => (
          <button
            key={t} type="button" title={BLOCK_META[t].hint}
            onClick={e => {
              if (t === 'text') add('text');
              else if (t === 'code') setCoding('write');
              else { setAnchor(e.currentTarget); setPicking(t); }
            }}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 7, height: big ? 48 : 34, padding: big ? '0 16px 0 12px' : '0 13px 0 10px', borderRadius: radius.control, cursor: 'pointer',
              border: `1px solid ${tk.border.default}`, background: tk.bg.panel, color: tk.text.secondary, font: `600 12.5px ${fontFamily.ui}`, textAlign: 'left',
            }}
          >
            <Icon name="plus" size={13} style={{ color: tk.text.faint }} />
            <Icon name={BLOCK_META[t].icon} size={14} style={{ color: tk.accent.base }} />
            <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {BLOCK_META[t].label}
              {big && <span style={{ color: tk.text.faint, font: `500 11px ${fontFamily.ui}` }}>{ADD_HINTS[t]}</span>}
            </span>
          </button>
        ))}
      </div>
      {empty && (
        <div style={{ color: `var(--pp-muted, ${tk.text.faint})`, font: `500 12px ${fontFamily.ui}`, textAlign: 'center' }}>
          Or start with code:{' '}
          {CODE_ROUTES.map((r, i) => (
            <span key={r.route}>
              {i > 0 && ' · '}
              <button type="button" onClick={() => setCoding(r.route)} style={{ border: 0, padding: 0, background: 'none', cursor: 'pointer', color: `var(--pp-link, ${tk.accent.text})`, font: 'inherit', textDecoration: 'underline', textUnderlineOffset: 2 }}>{r.label}</button>
            </span>
          ))}
        </div>
      )}
      {picking && (
        <SourcePicker
          anchorRef={{ current: anchor }}
          compact={compact}
          onPick={s => { add(picking, s); setPicking(null); }}
          onClose={() => setPicking(null)}
        />
      )}
      {/* Clicks in the dialog (a portal) still bubble through here: keep them from the page, which would deselect the new block. */}
      {coding && <span onClick={e => e.stopPropagation()}><AddCodeDialog compact={compact} initial={coding} onPick={addCode} onClose={() => setCoding(null)} /></span>}
    </div>
  );
}

