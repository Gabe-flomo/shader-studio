/**
 * TakesList — the setup's recorded performances (lib/takes.ts): watch one
 * back, render it, rename or delete it. The Record dialog's Performance tab
 * and the Stage's side panel show the same list.
 */
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { useTakes } from '../../lib/takes';
import { takeSize } from '../../lib/takePlayback';
import { formatDuration } from '../../lib/midiFile';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { Button, IconButton } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { askText } from '../ui/dialogStore';
import { toast } from '../ui/toastStore';
import type { PlayTake } from '../../types/play';

const NO_TAKES: PlayTake[] = [];

export function TakesList({ onRender, empty }: {
  /** Render… was pressed (the take is already set for the Record dialog). */
  onRender?: (id: string) => void;
  /** Shown when there are no takes; nothing when left out. */
  empty?: string;
}) {
  const tk = useTokens();
  const takes = useNodeGraphStore(s => s.play.takes) ?? NO_TAKES;
  const replayId = useTakes(s => s.replayId);
  if (takes.length === 0) return empty ? <p style={{ margin: 0, fontSize: 12, lineHeight: 1.45, color: tk.text.muted }}>{empty}</p> : null;

  const remove = (t: PlayTake) => {
    const at = takes.indexOf(t);
    useTakes.getState().remove(t.id);
    toast.info(`Deleted ${t.name}`, {
      action: {
        label: 'Undo',
        onClick: () => useNodeGraphStore.getState().setPlay(p => {
          const list = [...(p.takes ?? [])];
          if (list.some(x => x.id === t.id)) return p;
          list.splice(Math.min(at, list.length), 0, t);
          return { ...p, takes: list };
        }),
      },
    });
  };
  const rename = async (t: PlayTake) => {
    const name = await askText('Rename take', { label: 'Name', initial: t.name, confirmLabel: 'Rename' });
    if (name !== null) useTakes.getState().rename(t.id, name);
  };

  return (
    <div role="list" aria-label="Takes" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {[...takes].reverse().map(t => {
        const on = t.id === replayId;
        return (
          <div
            key={t.id}
            role="listitem"
            style={{
              display: 'flex', alignItems: 'center', gap: 4, padding: '2px 2px 2px 8px', borderRadius: radius.md,
              background: on ? tk.bg.selected : 'transparent',
            }}
          >
            <Icon name="record" size={12} style={{ color: tk.status.danger, flexShrink: 0 }} />
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12.5, color: tk.text.primary, marginLeft: 4 }}>{t.name}</span>
            <span
              title={`${t.tracks.length} tracks, ${t.events.length} actions, about ${Math.max(1, Math.round(takeSize(t) / 1024))} KB saved`}
              style={{ color: tk.text.muted, font: `500 11px ${fontFamily.mono}`, fontVariantNumeric: 'tabular-nums', marginRight: 2 }}
            >
              {formatDuration(t.length)}
            </span>
            <IconButton size="sm" icon={on ? 'pause' : 'play'} label={on ? 'Stop watching' : 'Watch it back'} onClick={() => (on ? useTakes.getState().endReplay() : useTakes.getState().replay(t.id))} />
            <IconButton size="sm" icon="edit" label="Rename" onClick={() => void rename(t)} />
            <IconButton size="sm" icon="trash" tone="danger" label="Delete this take" onClick={() => remove(t)} />
            <Button size="sm" variant="ghost" onClick={() => { useTakes.getState().renderTake(t.id); onRender?.(t.id); }} title="Render it frame by frame: open Record with this take">Render…</Button>
          </div>
        );
      })}
    </div>
  );
}
