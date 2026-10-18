/**
 * Audio Source's transport (docs/audio-tools.md "Transport"), on its card (also when the card is folded) and in its
 * window, the same row in both:
 *
 *   Play / Pause  plays the file or the video's sound, or listens to the Mic; paused, nothing is played or analysed.
 *   Restart       back to the trim's In (a File) or the video's start.
 *   Mute          silent, but still analysed: its bands, triggers and every listening node keep going.
 *   Volume        how loud you hear it (after the analysis, so moving it doesn't move a trigger).
 *
 * The Mic is never played to the speakers, so it has Play / Pause only.
 */
import type { CSSProperties } from 'react';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { useTokens } from '../../theme/themeStore';
import { fontFamily } from '../../theme/tokens';
import type { GraphNode } from '../../types/nodeGraph';
import { audioSourceKind } from '../../nodes/definitions/audioTools';
import { audioToolsEngine } from '../../lib/audioTools/engine';
import { Button, IconButton } from '../ui/Button';

export function AudioTransport({ node, compact = false }: { node: GraphNode; compact?: boolean }) {
  const tk = useTokens();
  const kind = audioSourceKind(node);
  const P = node.params;
  const playing = P.playing !== false, muted = P.muted === true;
  const volume = Number.isFinite(Number(P.volume)) ? Math.max(0, Math.min(1, Number(P.volume ?? 1))) : 1;
  const set = (p: Record<string, unknown>, live = false) => useNodeGraphStore.getState().updateNodeParams(node.id, p, live ? { immediate: true, live: true } : { immediate: true });
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const heard = kind !== 'mic';
  const row: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, padding: compact ? '4px 10px 6px' : 0 };
  return (
    <div style={row} data-audio-transport={compact ? 'compact' : 'full'} onPointerDown={stop} onMouseDown={stop} onDoubleClick={stop}>
      <IconButton size="sm" icon={playing ? 'pause' : 'play'} label={playing ? 'Pause (stops playing and listening)' : 'Play'} active={playing}
        data-audio-play onClick={() => set({ playing: !playing })} />
      {heard && <IconButton size="sm" icon="reset" label={kind === 'file' ? 'Restart from the trim\'s In' : 'Restart the video'} data-audio-restart
        onClick={() => { if (!playing) set({ playing: true }); audioToolsEngine.restart(node.id); }} />}
      {heard && (
        <Button size="sm" variant={muted ? 'primary' : 'secondary'} data-audio-mute aria-pressed={muted} onClick={() => set({ muted: !muted }, true)}
          title={muted ? 'Unmute: hear it again' : 'Mute: silent, but still listened to (its triggers keep firing)'}>{muted ? 'Muted' : 'Mute'}</Button>
      )}
      {heard && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, flex: 1, minWidth: 60, font: `500 11px ${fontFamily.ui}`, color: tk.text.faint }}
          title="Volume: how loud you hear it (the analysis hears it the same whatever)">
          {!compact && 'Volume'}
          <input type="range" aria-label="Volume" min={0} max={1} step={0.01} value={volume} data-audio-volume disabled={muted}
            onChange={e => set({ volume: Number(e.target.value) }, true)}
            style={{ flex: 1, minWidth: 40, accentColor: tk.accent.base, opacity: muted ? 0.45 : 1 }} />
        </label>
      )}
      {!heard && <span style={{ font: `500 11px ${fontFamily.ui}`, color: tk.text.faint }}>{playing ? 'Listening' : 'Paused'}</span>}
    </div>
  );
}
