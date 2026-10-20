/**
 * PassBudget — the pass account on the graph (docs/pass-node-plan.md, "How many passes").
 *
 * A chip ("Passes 3/8") in the canvas toolbar beside the node count, and in the phone graph's header,
 * shown once the graph uses a pass: amber with one full-quality pass (or none) left; amber with a ½ badge in
 * the grace zone (9 or 10 passes: lower quality in the preview, and at 10 adding a pass is locked); red past
 * the limit (only a graph loaded that way: the lock keeps edits from getting there). A click
 * opens the account: each node that costs passes (a row jumps to it), the Blur / Glow hidden passes
 * that don't count, and why there is a limit. The numbers come from compiler/passBudget.ts, the same
 * expansion the compile checks.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { Icon } from '../ui/Icon';
import { Popover } from '../ui/Popover';
import { Sheet } from '../ui/Sheet';
import { Tooltip } from '../ui/Tooltip';
import { GRACE_PASSES, GRACE_WHY, HARD_MAX_PASSES, PASS_LIMIT_WHY, budgetLevel, passBudget, passesLocked, type BudgetLevel, type PassBudget, type PassBudgetItem } from '../../compiler/passBudget';
import { usePassPanelRequest } from '../../store/passLock';

/** The whole graph's pass account (top level, whichever group is open). */
export function usePassBudget(): PassBudget {
  const nodes = useNodeGraphStore(s => s.nodes);
  return useMemo(() => passBudget(nodes), [nodes]);
}

/** A row's words: "Pass · Feedback blur", "Optical Flow", "Memory nodes (3)". */
export function passItemName(i: PassBudgetItem): string {
  if (i.shared) return `${i.kind} (${i.shared.count})`;
  return i.label && i.label !== i.kind ? `${i.kind} · ${i.label}` : i.kind;
}

/** A row's cost: "1", "2", "1 shared". */
export const passItemCost = (i: PassBudgetItem): string => (i.shared ? `${i.cost} shared` : String(i.cost));

function levelColour(tk: ReturnType<typeof useTokens>, level: BudgetLevel): string {
  return level === 'over' ? tk.status.danger : level === 'warn' || level === 'grace' ? tk.status.warningText : tk.text.secondary;
}

/** The grace zone in words: "lower quality (grace 1 of 2)", "… (grace 2 of 2) · passes locked". */
export function graceWords(b: Pick<PassBudget, 'used' | 'max'>): string {
  return `lower quality (grace ${b.used - b.max} of ${GRACE_PASSES})${passesLocked(b.used) ? ' · passes locked' : ''}`;
}

/** The chip's tooltip (and the start of its accessible name). */
export function budgetTip(b: Pick<PassBudget, 'used' | 'max'>): string {
  const level = budgetLevel(b.used, b.max);
  if (level === 'over') return `${b.used - HARD_MAX_PASSES} over the limit of ${HARD_MAX_PASSES} passes`;
  if (level === 'grace') return `Passes ${b.used}/${b.max} · ${graceWords(b)}`;
  const left = b.max - b.used;
  return level === 'warn' ? `${left} of ${b.max} full-quality passes left, then ${GRACE_PASSES} at lower quality` : `${left} of ${b.max} passes left`;
}

/** The chip. Renders nothing while the graph uses no pass. `touch`: the phone's (opens a sheet). */
export function PassBudgetChip({ touch = false }: { touch?: boolean }) {
  const tk = useTokens();
  const b = usePassBudget();
  const ref = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  // The lock's toast offers Show passes: open this panel.
  const asked = usePassPanelRequest(s => s.n);
  const seen = useRef(asked);
  useEffect(() => { if (asked !== seen.current) { seen.current = asked; setOpen(true); } }, [asked]);
  if (b.used === 0) return null;
  const level = budgetLevel(b.used, b.max);
  const colour = levelColour(tk, level);
  const tip = budgetTip(b);
  const panel = <PassBudgetPanel budget={b} onDone={() => setOpen(false)} titled={!touch} />;
  return (
    // Inside the toolbar a click elsewhere opens the code: keep these clicks here.
    <span ref={ref} data-pass-budget={level} onClick={e => e.stopPropagation()} style={{ display: 'inline-flex', flexShrink: 0 }}>
      <Tooltip label={tip} disabled={open || touch}>
        <button
          type="button"
          aria-label={`Passes ${b.used} of ${b.max}: ${tip}`}
          onClick={() => setOpen(o => !o)}
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          style={{
            height: touch ? 30 : 28, display: 'inline-flex', alignItems: 'center', gap: 5, padding: '0 8px', border: 0, borderRadius: touch ? 8 : radius.md,
            cursor: 'pointer', font: `500 ${touch ? 12.5 : 12}px ${fontFamily.ui}`, fontVariantNumeric: 'tabular-nums', touchAction: 'manipulation',
            background: open ? tk.bg.selected : hover || touch ? tk.bg.hover : 'transparent', color: colour,
          }}
        >
          <Icon name="layers" size={14} />
          Passes {b.used}/{b.max}
          {level === 'grace' && (
            // Lower quality: passes past 8 draw at half resolution in the preview.
            <span data-pass-grace-badge="" aria-hidden style={{
              marginLeft: 1, padding: '0 4px', borderRadius: 4, lineHeight: '15px', fontSize: touch ? 11 : 10.5, fontWeight: 650,
              color: tk.status.warningText, border: `1px solid ${tk.status.warning}`,
            }}>
              {passesLocked(b.used) ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}><Icon name="lock" size={10} />½</span> : '½'}
            </span>
          )}
        </button>
      </Tooltip>
      {open && (touch
        ? <Sheet title="Passes" onClose={() => setOpen(false)}>{panel}</Sheet>
        : <Popover anchorRef={ref} onClose={() => setOpen(false)} align="end" width={340} padding={0}>{panel}</Popover>)}
    </span>
  );
}

/** The account: the rows, the hidden passes line, and why. */
export function PassBudgetPanel({ budget: b, onDone, titled = true }: {
  budget: PassBudget;
  onDone?: () => void;
  /** Its own "Passes" heading (a sheet has one already). */
  titled?: boolean;
}) {
  const tk = useTokens();
  const level = budgetLevel(b.used, b.max);
  const jump = (path: string[], nodeId: string) => {
    const s = useNodeGraphStore.getState();
    s.exitToRoot();
    s.revealNode(path, nodeId);
    onDone?.();
  };
  const headline = level === 'over'
    ? `${b.used} passes: ${b.used - HARD_MAX_PASSES} over the limit of ${HARD_MAX_PASSES}`
    : level === 'grace'
      ? `${b.used} of ${b.max} · ${graceWords(b)}`
      : `${b.used} of ${b.max} used · ${b.max - b.used} left`;
  const muted = { fontSize: 11.5, color: tk.text.muted, lineHeight: 1.5 } as const;
  return (
    <div data-pass-budget-panel="" style={{ color: tk.text.secondary, font: `12px ${fontFamily.ui}` }}>
      <div style={{ padding: '12px 14px 8px', borderBottom: `1px solid ${tk.border.subtle}` }}>
        {titled && <div style={{ fontSize: 13.5, fontWeight: 650, color: tk.text.primary }}>Passes</div>}
        <div data-pass-budget-headline="" style={{ marginTop: 2, fontWeight: 600, color: levelColour(tk, level) }}>{headline}</div>
        {level === 'grace' && (
          <div data-pass-budget-grace="" style={{ ...muted, marginTop: 6, color: tk.text.secondary }}>
            {GRACE_WHY}{passesLocked(b.used) ? ` ${HARD_MAX_PASSES} is the most: a node that would add a pass can't be added (or turned back on) until you remove one, or bypass a node that adds passes.` : ''}
          </div>
        )}
      </div>
      <div style={{ padding: '6px 6px', display: 'flex', flexDirection: 'column' }}>
        {b.items.map(i => (
          <button key={`${i.nodeId}:${i.kind}`} type="button" data-pass-row={i.nodeId} onClick={() => jump(i.path, i.nodeId)}
            title={i.passes.length > 1 || i.shared ? i.passes.join(', ') : 'Show this node'}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', border: 0, borderRadius: radius.md, background: 'none',
              cursor: 'pointer', textAlign: 'left', color: tk.text.primary, font: `12.5px ${fontFamily.ui}`,
            }}
            onMouseEnter={e => { e.currentTarget.style.background = tk.bg.hover; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}
          >
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{passItemName(i)}</span>
            <span style={{ color: tk.text.muted, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{passItemCost(i)}</span>
          </button>
        ))}
      </div>
      <div style={{ padding: '8px 14px 12px', borderTop: `1px solid ${tk.border.subtle}`, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {b.error && <div style={{ ...muted, color: tk.status.danger }}>{b.error}</div>}
        <div data-pass-budget-hidden="" style={muted}>
          Blur and Glow use their own hidden passes: {b.hidden.used} of {b.hidden.max} (they don't count).
        </div>
        <div style={muted}>{PASS_LIMIT_WHY}</div>
      </div>
    </div>
  );
}
