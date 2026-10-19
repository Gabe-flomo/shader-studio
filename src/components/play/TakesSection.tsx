/**
 * TakesSection — the takes' persistent home (Play audit P8): a section under
 * Sound → Arrangement listing the setup's takes (TakesList: watch it back,
 * rename, delete, export a video), folded to one line until opened (the open
 * state is remembered, playUi's `folded`). It also makes a take of the tape
 * ("From the tape", which used to be a ● in the transport beside Record).
 *
 * The three kinds of recording each have one name (docs/glossary.md):
 *   Record video                 the top bar's Record → the picture to a file
 *   Record performance (take)    the top bar's Record (and Stage) → your moves, kept here
 *   Arm track                    the ● on a track → the transport's Record records it
 *
 * The takes are the record's `takes` as before (lib/takes.ts); nothing about
 * their format changes.
 */
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { addTake, useTakes } from '../../lib/takes';
import { arrangementTake } from '../../lib/tapeTake';
import { formatDuration } from '../../lib/midiFile';
import { useCan } from '../../lib/plan';
import { useTokens } from '../../theme/themeStore';
import { fontFamily } from '../../theme/tokens';
import type { PlayRecord, PlayTake } from '../../types/play';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { toast } from '../ui/toastStore';
import { ProBadge } from '../account/ProSheet';
import { TakesList } from './TakesList';
import { usePlayUi } from './playUi';

/** The section's fold key (playUi's `folded`): folded unless opened by hand. */
export const TAKES_FOLD = 'sound:takes';

const NO_TAKES: PlayTake[] = [];

/** The folded section's line: "3 takes · newest Take 3 · 0:12". */
export function takesSummary(takes: readonly Pick<PlayTake, 'name' | 'length'>[]): string {
  if (!takes.length) return 'None yet';
  const last = takes[takes.length - 1];
  return `${takes.length} take${takes.length === 1 ? '' : 's'} · newest ${last.name} · ${formatDuration(last.length)}`;
}

/** Keep the tape as a take (its notes and rack controls), to export like any take. Null when the tape is empty. */
export function makeTapeTake(play: Pick<PlayRecord, 'controls' | 'arrangement' | 'takes'>): PlayTake | null {
  const take = arrangementTake(play, `Tape ${(play.takes ?? []).filter(t => t.tape?.made).length + 1}`);
  if (!take) { toast.info('Nothing on the tape to make a take of'); return null; }
  addTake(take);
  toast.success(`${take.name} is a take`, { message: 'Export it like any take: the racks play the tape offline, sample by sample.', action: { label: 'Export video…', onClick: () => useTakes.getState().renderTake(take.id) } });
  return take;
}

export function TakesSection({ touch = false }: { touch?: boolean }) {
  const tk = useTokens();
  const takes = useNodeGraphStore(s => s.play.takes) ?? NO_TAKES;
  const tapeLength = useNodeGraphStore(s => s.play.arrangement?.length ?? 0);
  const engineOk = useCan('audio.engine');
  const takesOk = useCan('play.takes');
  const open = usePlayUi(s => s.folded[TAKES_FOLD] === false);
  const toggle = () => usePlayUi.getState().toggleFold(TAKES_FOLD, open);
  return (
    <section data-takes-section="" data-folded={open ? undefined : ''} aria-label="Takes"
      style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', maxHeight: open ? '45%' : undefined, borderTop: `1px solid ${tk.border.default}`, background: tk.bg.panel }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: touch ? 44 : 36, padding: '0 10px 0 8px' }}>
        <button type="button" onClick={toggle} aria-expanded={open}
          style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0', border: 0, background: 'none', cursor: 'pointer', textAlign: 'left', color: tk.text.primary }}>
          <Icon name={open ? 'chevD' : 'chevR'} size={12} style={{ color: tk.text.faint, flexShrink: 0 }} />
          <Icon name="record" size={13} style={{ color: tk.status.danger, flexShrink: 0 }} />
          <span style={{ font: `650 12.5px ${fontFamily.ui}`, flexShrink: 0 }}>Takes</span>
          {!takesOk && <ProBadge />}
          {open
            ? takes.length > 0 && <span style={{ color: tk.text.faint, font: `500 11px ${fontFamily.mono}` }}>{takes.length}</span>
            : <span style={{ color: tk.text.muted, font: `500 11.5px ${fontFamily.ui}`, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{takesSummary(takes)}</span>}
        </button>
        {/* Only once the tape has something: a disabled button would crowd the folded line. */}
        {engineOk && takesOk && tapeLength > 0 && (
          <Button size="sm" variant="ghost" icon="plus" data-tape-take=""
            title="Make a take of the tape (its notes and rack controls), to export like any take"
            onClick={() => { const t = makeTapeTake(useNodeGraphStore.getState().play); if (t && !open) toggle(); }}>
            From the tape
          </Button>
        )}
      </div>
      {open && (
        <div style={{ minHeight: 0, overflowY: 'auto', padding: '0 10px 10px' }}>
          <TakesList empty="None yet. Record performance (take) from Record in the top bar, or from Stage: what you play is kept as keyframes, to watch back and export as a video. Takes are saved with the graph and in play files." />
        </div>
      )}
    </section>
  );
}
