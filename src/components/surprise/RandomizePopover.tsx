import { useMemo, useRef, useState, type RefObject } from 'react';
import { useTokens } from '../../theme/themeStore';
import { fontFamily } from '../../theme/tokens';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Popover } from '../ui/Popover';
import { newSeed, seedFrom } from '../../lib/surprise';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { lockedItems, withoutLock, withoutLocks, type LockedItem } from '../../nodes/randomizeParams';
import { useRandomizeOptions, optionsSummary } from '../../nodes/randomizeOptions';
import { RandomizeOptionsPanel } from './RandomizeOptionsPanel';
import { randomizeGraphAction, useSurpriseSeeds } from './surpriseActions';

/**
 * The canvas dice's options (opened by its chevron or a right-click): strength, what to include,
 * the seed, and the locked settings with a clear-all. Options are saved at once; "Randomise" uses them.
 */
export function RandomizePopover({ anchorRef, onClose }: { anchorRef: RefObject<HTMLElement | null>; onClose: () => void }) {
  const tk = useTokens();
  const opts = useRandomizeOptions();
  const nodes = useNodeGraphStore(s => s.nodes);
  const setNodesRewritten = useNodeGraphStore(s => s.setNodesRewritten);
  const last = useSurpriseSeeds(s => s.graph);
  const locked = useMemo(() => lockedItems(nodes), [nodes]);
  const [seedText, setSeedText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const go = (typed: boolean) => {
    const seed = (typed && seedText.trim() ? seedFrom(seedText) : null) ?? newSeed();
    onClose();
    void randomizeGraphAction(seed);
  };
  const unlock = (item: LockedItem) => setNodesRewritten(withoutLock(nodes, item), `Unlocked ${item.label}`);

  return (
    <Popover anchorRef={anchorRef} onClose={onClose} align="end" width={300} padding={4}>
      <div role="dialog" aria-label="Randomise options" style={{ color: tk.text.primary, font: `12.5px ${fontFamily.ui}` }}>
        <div style={{ padding: '7px 8px 6px', color: tk.text.faint, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em' }}>RANDOMISE</div>
        <RandomizeOptionsPanel scope="graph" />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 8px 4px', borderTop: `1px solid ${tk.border.subtle}`, marginTop: 4 }}>
          <span style={{ width: 58, flexShrink: 0, color: tk.text.secondary }}>Seed</span>
          <input
            ref={inputRef}
            value={seedText}
            placeholder={last === null ? 'a number or a word' : `empty = new · last ${last}`}
            aria-label="Seed"
            onChange={e => setSeedText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') go(true); }}
            style={{ flex: 1, minWidth: 0, height: 26, padding: '0 8px', boxSizing: 'border-box', borderRadius: 6, border: `1px solid ${tk.border.default}`, background: tk.bg.field, color: tk.text.primary, font: `12.5px ${fontFamily.ui}` }}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', padding: '8px 8px 2px', borderTop: `1px solid ${tk.border.subtle}`, marginTop: 6 }}>
          <span style={{ flex: 1, color: tk.text.faint, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em' }}>LOCKED ({locked.length})</span>
          {locked.length > 0 && (
            <button type="button" onClick={() => setNodesRewritten(withoutLocks(nodes), 'Cleared Randomise locks')}
              style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer', color: tk.accent.text, font: `600 11.5px ${fontFamily.ui}` }}>Clear all</button>
          )}
        </div>
        <div style={{ maxHeight: 140, overflowY: 'auto', padding: '2px 0 4px' }}>
          {locked.length === 0 && <div style={{ padding: '4px 8px', color: tk.text.muted }}>Nothing locked. Hover a slider and click its lock, or use a node's dice menu.</div>}
          {locked.map((item, i) => (
            <div key={`${item.path.join('/')}|${item.nodeId}|${item.key ?? ''}|${i}`} style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 26, padding: '0 8px' }}>
              <Icon name="lock" size={12} style={{ color: tk.text.faint }} />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: tk.text.secondary }}>{item.label}</span>
              <button type="button" aria-label={`Unlock ${item.label}`} title="Unlock" onClick={() => unlock(item)}
                style={{ border: 0, background: 'none', padding: 2, cursor: 'pointer', color: tk.text.muted, display: 'inline-flex' }}><Icon name="close" size={12} /></button>
            </div>
          ))}
        </div>
        <div style={{ padding: '6px 4px 4px', borderTop: `1px solid ${tk.border.subtle}` }}>
          <Button size="sm" variant="primary" icon="dice" onClick={() => go(true)} style={{ width: '100%', justifyContent: 'center' }}>Randomise</Button>
          <div style={{ padding: '6px 4px 0', color: tk.text.muted, fontSize: 11 }}>{optionsSummary(opts, locked.length)}</div>
        </div>
      </div>
    </Popover>
  );
}
