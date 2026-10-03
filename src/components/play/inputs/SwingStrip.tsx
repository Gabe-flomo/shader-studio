/**
 * SwingStrip — the swing ring under a driven slider (play/controlSwing.ts):
 * a thin bar for the control's whole range, the part its sources can move
 * it across shaded in the accent, and a tick where it is right now. The
 * ruler above scrolls under a fixed needle, so it can't show a span of the
 * range itself: this strip is the range laid flat, lined up under the track.
 */
import { useTokens } from '../../../theme/themeStore';
import { alpha } from '../../../theme/tokens';
import { swingFraction, type Swing } from '../../../play/controlSwing';
import { formatValue } from '../../ui/rulerMath';

/** The ruler's value chip (56) and its gap (8): the strip starts where the track does. */
const TRACK_LEFT = 64;

export function SwingStrip({ swing, min, max, live, step }: { swing: Swing; min: number; max: number; live?: number; step: number }) {
  const tk = useTokens();
  const a = swingFraction(swing.lo, min, max), b = swingFraction(swing.hi, min, max);
  const format = (n: number) => formatValue(n, step, false);
  const at = live === undefined ? null : swingFraction(live, min, max);
  return (
    <div
      data-swing={`${swing.lo}:${swing.hi}`}
      title={`Its sources move it between ${format(swing.lo)} and ${format(swing.hi)}`}
      style={{ position: 'relative', height: 4, margin: `4px 0 0 ${TRACK_LEFT}px`, borderRadius: 2, background: alpha(tk.text.primary, 0.07) }}
    >
      {/* At least 2px, so a swing that collapsed to a point (a Replace with one value) still shows. */}
      <span style={{ position: 'absolute', top: 0, bottom: 0, left: `${a * 100}%`, width: `max(2px, ${(b - a) * 100}%)`, borderRadius: 2, background: alpha(tk.accent.base, 0.45) }} />
      {at !== null && <span style={{ position: 'absolute', top: -2, bottom: -2, left: `${at * 100}%`, width: 2, marginLeft: -1, borderRadius: 1, background: tk.accent.base }} />}
    </div>
  );
}
