/**
 * stageUi.tsx — small shared pieces of the structure hints (docs/structure-hints.md): a stage's
 * colour, the stage tag on a card, the canvas toolbar's flow-strip switch, Auto layout's "by
 * stage" option and the legend.
 */
import { useRef, useState } from 'react';
import { useThemeMode, useTokens } from '../../theme/themeStore';
import { accentColor } from '../../theme/categories';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { IconButton } from '../ui/Button';
import { Popover } from '../ui/Popover';
import { toast } from '../ui/toastStore';
import { FLOWS, STAGES, stageOfType, type FlowId, type StageId } from '../../structure/stages';
import { useStructureHints } from '../../structure/hintsStore';

/** A stage's colour in the current theme. */
export function useStageColour(): (s: StageId) => string {
  const mode = useThemeMode();
  return s => accentColor(STAGES[s].accent, mode);
}

/**
 * The faint stage colour along the top edge of a card (View: Stage tags). Nothing for nodes that
 * go anywhere (maths, time, functions), nor when tags are off.
 */
export function StageTag({ type }: { type: string }) {
  const on = useStructureHints(s => s.tagsOn);
  const colour = useStageColour();
  if (!on) return null;
  const s = stageOfType(type);
  if (s === 'any') return null;
  return (
    <span aria-hidden data-stage-tag={s} title={`Stage: ${STAGES[s].label}`}
      style={{
        position: 'absolute', top: 0, left: 18, right: 18, height: 3, borderRadius: '0 0 3px 3px', zIndex: 2,
        background: alpha(colour(s), 0.55), pointerEvents: 'none',
      }} />
  );
}

/** The canvas toolbar's switch for the flow strip (it brings it back after its ×). */
export function FlowStripToggle() {
  const on = useStructureHints(s => s.stripOn);
  const set = useStructureHints(s => s.setStrip);
  return <IconButton icon="rail" size="sm" active={on} label={on ? 'Hide the flow strip' : 'Flow strip: the usual order of steps (Space → Shape → Colour → Post) and what usually comes next'} onClick={() => set(!on)} />;
}

/** Auto layout's options: by data flow (the button) or by stage (this menu). */
export function ArrangeMenu({ onFlow, onStage }: { onFlow: () => void; onStage: () => void }) {
  const tk = useTokens();
  const ref = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const row = (label: string, line: string, run: () => void) => (
    <button type="button" onClick={() => { setOpen(false); run(); }}
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1, width: '100%', padding: '7px 10px', border: 0, borderRadius: radius.md, background: 'none', cursor: 'pointer', textAlign: 'left', font: `600 12.5px ${fontFamily.ui}`, color: tk.text.primary }}
      onMouseEnter={e => { e.currentTarget.style.background = tk.bg.hover; }} onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}>
      {label}<span style={{ fontWeight: 400, fontSize: 11.5, color: tk.text.muted }}>{line}</span>
    </button>
  );
  return (
    <span ref={ref} style={{ display: 'inline-flex' }}>
      <IconButton icon="chevD" size="sm" label="Auto layout options" active={open} onClick={() => setOpen(o => !o)} style={{ width: 18 }} />
      {open && (
        <Popover anchorRef={ref} onClose={() => setOpen(false)} align="center" width={260}>
          {row('By data flow', 'Columns by how deep each node is.', onFlow)}
          <div data-arrange-by-stage>{row('By stage', 'Columns by stage: Space, Shape, Colour, Post… Groups stay together.', onStage)}</div>
        </Popover>
      )}
    </span>
  );
}

/** The stage colours of a flow, with what each stage holds. */
export function StageLegend({ flow }: { flow: FlowId }) {
  const tk = useTokens();
  const colour = useStageColour();
  return (
    <div data-stage-legend style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {FLOWS[flow].stages.map(s => (
        <div key={s} style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 12 }}>
          <span style={{ width: 14, height: 4, borderRadius: 2, background: colour(s), flexShrink: 0, transform: 'translateY(-2px)' }} />
          <b style={{ fontWeight: 600, color: tk.text.primary, minWidth: 74 }}>{STAGES[s].label}</b>
          <span style={{ color: tk.text.muted, minWidth: 0 }}>{STAGES[s].examples}</span>
        </div>
      ))}
    </div>
  );
}

/** Hide the strip, with a word on how to bring it back. */
export function hideStrip() {
  useStructureHints.getState().setStrip(false);
  toast.info('Flow strip hidden', { message: 'The flow button in the canvas toolbar brings it back.' });
}
