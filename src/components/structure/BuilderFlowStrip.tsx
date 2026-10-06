/**
 * BuilderFlowStrip — the flow strip inside a builder window (docs/structure-hints.md): the
 * builder's flow (3D for the Scene Builder, passes for Grid Rules, agents for Agent Rules) with a
 * line per stage saying where it lives in the builder, or that it happens in the graph. Folds to
 * the stage names alone (remembered).
 */
import { useState } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Icon } from '../ui/Icon';
import { BUILDER_FLOWS } from '../../structure/builders';
import { FLOWS, STAGES, type StageId } from '../../structure/stages';
import { useStageColour } from './stageUi';

const FOLD_KEY = 'playfield:structure:builderStripFolded';

export function BuilderFlowStrip({ builder }: { builder: string }) {
  const tk = useTokens();
  const colour = useStageColour();
  const bf = BUILDER_FLOWS[builder];
  const [folded, setFolded] = useState(() => { try { return localStorage.getItem(FOLD_KEY) === '1'; } catch { return false; } });
  if (!bf) return null;
  const toggle = () => setFolded(f => { try { localStorage.setItem(FOLD_KEY, f ? '0' : '1'); } catch { /* session only */ } return !f; });
  const stages = FLOWS[bf.flow].stages;
  return (
    <div data-builder-flow={bf.flow} style={{ flexShrink: 0, display: 'flex', alignItems: 'stretch', gap: 6, padding: '6px 10px', borderBottom: `1px solid ${tk.border.subtle}`, background: tk.bg.subtle, minWidth: 0 }}>
      <button type="button" onClick={toggle} aria-expanded={!folded} title={folded ? 'Show what each stage does here' : 'Fold to the stage names'}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, border: 0, background: 'none', cursor: 'pointer', padding: '0 4px', color: tk.text.faint, font: `700 10.5px ${fontFamily.ui}`, letterSpacing: '0.06em', textTransform: 'uppercase', flexShrink: 0 }}>
        <Icon name={folded ? 'chevR' : 'chevD'} size={12} />Flow
      </button>
      <div style={{ display: 'flex', gap: 4, overflowX: 'auto', minWidth: 0, scrollbarWidth: 'thin' }}>
        {stages.map((s: StageId, i) => {
          const line = bf.lines[s];
          const here = !!line && !line.startsWith('In the graph');
          return (
            <div key={s} data-builder-stage={s} data-here={here ? '' : undefined} title={line ?? `${STAGES[s].line} (in the graph)`}
              style={{
                display: 'flex', flexDirection: 'column', gap: 2, flexShrink: 0, width: folded ? undefined : 168, padding: folded ? '3px 8px' : '5px 8px', borderRadius: radius.md,
                background: here ? tk.bg.panel : 'transparent', boxShadow: here ? `inset 0 0 0 1px ${tk.border.default}` : `inset 0 0 0 1px ${alpha(tk.border.default, 0.6)}`,
              }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, font: `600 11.5px ${fontFamily.ui}`, color: here ? tk.text.primary : tk.text.faint, whiteSpace: 'nowrap' }}>
                <span style={{ font: `500 10px ${fontFamily.mono}`, color: tk.text.faint }}>{i + 1}</span>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: here ? colour(s) : 'transparent', boxShadow: here ? 'none' : `inset 0 0 0 1.5px ${alpha(colour(s), 0.55)}` }} />
                {STAGES[s].label}
              </span>
              {!folded && (
                <span style={{ fontSize: 11, lineHeight: 1.35, color: tk.text.muted, whiteSpace: 'normal' }}>
                  {line ?? `${STAGES[s].line} In the graph.`}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** For an empty section: the stage to do next in this builder's flow, in one line. */
export function NextStageLine({ builder, section }: { builder: string; section: string }) {
  const tk = useTokens();
  const colour = useStageColour();
  const bf = BUILDER_FLOWS[builder];
  const s = bf?.emptyNext[section];
  if (!bf || !s) return null;
  return (
    <span data-empty-next={s} style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6, fontSize: 12, color: tk.text.muted }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: colour(s), flexShrink: 0, transform: 'translateY(-1px)' }} />
      <span><b style={{ color: tk.text.primary, fontWeight: 600 }}>Next in the flow: {STAGES[s].label}.</b> {bf.lines[s] ?? STAGES[s].line}</span>
    </span>
  );
}
