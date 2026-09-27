/**
 * Solo — the S button on a layer or a mapping row, and the strip that says
 * something is soloed. Soloed layers are the only ones drawn and soloed
 * mappings the only ones running (see applySolo in playUi.ts); nothing is
 * saved, and leaving Play clears it.
 */
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Tooltip } from '../ui/Tooltip';
import { usePlayUi } from './playUi';

export function SoloButton({ kind, id }: { kind: 'layer' | 'mapping'; id: string }) {
  const on = usePlayUi(s => (kind === 'layer' ? s.soloLayers : s.soloMappings).has(id));
  const toggle = usePlayUi(s => s.toggleSolo);
  return <SoloKey on={on} onClick={() => toggle(kind, id)} description={kind === 'layer' ? 'Show only soloed layers (nulls stay). Just for looking: nothing is saved.' : 'Run only soloed mappings. Just for looking: nothing is saved.'} />;
}

/** A group's S: solos every layer in it (on when they all are). */
export function GroupSoloButton({ ids }: { ids: readonly string[] }) {
  const on = usePlayUi(s => ids.length > 0 && ids.every(id => s.soloLayers.has(id)));
  const set = usePlayUi(s => s.soloLayersSet);
  return <SoloKey on={on} onClick={() => set(ids, !on)} description="Show only this group’s layers (and anything else soloed). Just for looking: nothing is saved." />;
}

function SoloKey({ on, onClick, description }: { on: boolean; onClick: () => void; description: string }) {
  const tk = useTokens();
  return (
    <Tooltip label={on ? 'Unsolo' : 'Solo'} description={description}>
      <button
        type="button"
        aria-pressed={on}
        aria-label={on ? 'Unsolo' : 'Solo'}
        onClick={onClick}
        style={{
          width: 22, height: 22, flexShrink: 0, border: 0, borderRadius: 5, cursor: 'pointer', padding: 0,
          background: on ? tk.status.warning : tk.bg.field, color: on ? '#1b1b1b' : tk.text.muted, font: `700 10.5px ${fontFamily.ui}`,
        }}
      >S</button>
    </Tooltip>
  );
}

/** "Solo: 2 of 5 layers · Clear", shown above a list while anything in it is soloed. */
export function SoloStrip({ kind, total }: { kind: 'layer' | 'mapping'; total: number }) {
  const tk = useTokens();
  const n = usePlayUi(s => (kind === 'layer' ? s.soloLayers : s.soloMappings).size);
  const clear = usePlayUi(s => s.clearSolo);
  if (!n) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '6px 0 0', padding: '5px 6px 5px 10px', borderRadius: radius.md, background: alpha(tk.status.warning, 0.16), color: tk.text.secondary, font: `600 11.5px ${fontFamily.ui}` }}>
      <span style={{ flex: 1 }}>Solo: {n} of {total} {kind}{total === 1 ? '' : 's'}</span>
      <button type="button" onClick={clear} style={{ border: 0, background: 'none', cursor: 'pointer', color: tk.accent.text, font: `600 11.5px ${fontFamily.ui}`, padding: '2px 4px' }}>Clear</button>
    </div>
  );
}
