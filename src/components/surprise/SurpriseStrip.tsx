/**
 * SurpriseStrip.tsx — ‹ 2 / 3 › above the Do bar's input while a random line made there is in the bar:
 * step back and forward through the lines made in this session, › past the end makes another.
 * Cheap on purpose: each line is just text from a seed (lang/surprise.ts); nothing is drawn or scored.
 */
import { useTokens } from '../../theme/themeStore';
import { fontFamily } from '../../theme/tokens';
import { IconButton } from '../ui/Button';
import type { SurpriseDialect, SurpriseSize } from '../../lang/surprise';

export interface Roll { line: string; seed: number; size: SurpriseSize; dialect: SurpriseDialect }

export function SurpriseStrip({ rolls, index, text, onStep }: { rolls: Roll[]; index: number; text: string; onStep: (dir: -1 | 1) => void }) {
  const tk = useTokens();
  const r = rolls[index];
  // Only while the line in the bar is still the one that was made (editing it ends the walk).
  if (!r || r.line !== text) return null;
  return (
    <div data-do-carousel style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', borderBottom: `1px solid ${tk.border.subtle}`, background: tk.bg.subtle }}>
      <IconButton icon="chevL" size="sm" label="The line before" disabled={index === 0} onClick={() => onStep(-1)} data-do-carousel-prev />
      <span data-do-carousel-count style={{ font: `600 12px ${fontFamily.mono}`, minWidth: 44, textAlign: 'center', color: tk.text.primary }}>{index + 1} / {rolls.length}</span>
      <IconButton icon="chevR" size="sm" label={index === rolls.length - 1 ? 'Make another line' : 'The next line'} onClick={() => onStep(1)} data-do-carousel-next />
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, color: tk.text.muted }} data-do-carousel-info>
        A random {r.size} {r.dialect === '3d' ? '3D scene' : '2D picture'}. Enter runs it; edit it first if you like.
      </span>
      <span style={{ font: `11px ${fontFamily.mono}`, color: tk.text.faint }}>seed {r.seed}</span>
    </div>
  );
}
