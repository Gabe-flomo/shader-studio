/**
 * ClipEditorModal — the clip editor (ClipEditor.tsx) in a large window, for
 * every host but the Time Cube (which has its own, TimeCubeClipModal, for
 * its frame budget): a Video Input node, a Video layer, a Baked node, the
 * Background, and as a viewer for the Library and Files.
 *
 * It opens the video (`load`), reads its size and length, and edits a draft
 * of the host's clip. Apply hands back the saved clip (null when it changes
 * nothing, so the host plays exactly as without one) and the speed and loop;
 * Cancel or Esc changes nothing. Without `onApply` it is a viewer: Close, and
 * any `actions` the host offers ("Use in…").
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { useTokens } from '../../theme/themeStore';
import { CLIP_CAPS, HOST_OWN_SPEED, savedFromSettings, settingsFromSaved, type ClipHost, type ClipSettings, type SavedClip } from '../../lib/media/clip';
import { probeVideo } from '../../lib/timeCube/frames';
import { ClipEditor, type ClipFrameSource, type ClipMeta } from './ClipEditor';

export interface ClipApply {
  /** Null: the clip changes nothing (the host drops it). */
  clip: SavedClip | null;
  speed: number;
  loop: boolean;
}

export function ClipEditorModal({ host, title = "Edit clip", subtitle, load, saved, speed = 1, loop = true, defaults, onApply, onClose, actions, note }: {
  host: ClipHost;
  title?: string;
  subtitle?: ReactNode;
  /** The video file; null when it is not here (another browser, a cleared library). */
  load: () => Promise<Blob | null>;
  saved?: SavedClip | null;
  /** The host's speed and loop now (its own fields, or what plays without a clip). */
  speed?: number;
  loop?: boolean;
  /** What the host plays without a clip (a Baked node: 1× and its bake loop): speed and loop kept in the clip only when they differ. */
  defaults?: { speed: number; loop: boolean };
  /** Absent: a viewer. */
  onApply?: (a: ClipApply) => void;
  onClose: () => void;
  /** Extra footer buttons (a viewer's "Use in…"). */
  actions?: ReactNode;
  /** A line in the footer about what Apply does for this host. */
  note?: ReactNode;
}) {
  const tk = useTokens();
  const [state, setState] = useState<'loading' | 'missing' | 'error' | { source: ClipFrameSource; meta: ClipMeta }>('loading');
  const [draft, setDraft] = useState<ClipSettings | null>(null);
  // Opened once: the file, its size and length, and the draft from the host's clip.
  useEffect(() => {
    let live = true;
    (async () => {
      const blob = await load().catch(() => null);
      if (!live) return;
      if (!blob) { setState('missing'); return; }
      const meta = await probeVideo(blob).catch(() => null);
      if (!live) return;
      if (!meta || !(meta.duration > 0)) { setState('error'); return; }
      setDraft(settingsFromSaved(saved ?? null, meta.duration, speed, loop));
      setState({ source: { kind: 'video', blob }, meta });
    })();
    return () => { live = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const ready = typeof state === 'object' ? state : null;
  const source = ready?.source ?? null;

  const editable = !!onApply && CLIP_CAPS[host].edit;
  const apply = () => {
    if (!ready || !draft || !onApply) return;
    const s = draft.speed ?? speed, l = draft.loop ?? loop;
    // Hosts that keep speed and loop in the clip compare with what they play without one.
    const clip = savedFromSettings(draft, ready.meta.duration, host, HOST_OWN_SPEED[host] ? undefined : defaults ?? { speed: 1, loop });
    onApply({ clip, speed: s, loop: l });
    onClose();
  };

  const small = { fontSize: 11.5, color: tk.text.muted } as const;
  const footer = editable ? (
    <>
      <span style={{ ...small, flex: 1, minWidth: 200 }}>{note}</span>
      {actions}
      <Button variant="ghost" onClick={onClose}>Cancel</Button>
      <Button variant="primary" onClick={apply} disabled={!ready || !draft}>Apply</Button>
    </>
  ) : (
    <>
      <span style={{ ...small, flex: 1, minWidth: 200 }}>{note}</span>
      {actions}
      <Button variant={actions ? 'ghost' : 'primary'} onClick={onClose}>Close</Button>
    </>
  );

  return (
    <Modal title={title} subtitle={subtitle} icon="play" width={editable ? 1080 : 960} height={editable ? 820 : 700} onClose={onClose} footer={footer} closeOnScrim={!editable}>
      {state === 'loading' ? <p style={{ ...small, padding: 20 }}>Opening the video…</p>
        : state === 'missing' ? <p style={{ ...small, padding: 20, color: tk.status.danger }}>This video is not in this browser's Library. Pick it again first.</p>
        : state === 'error' || !ready || !source ? <p style={{ ...small, padding: 20, color: tk.status.danger }}>This browser couldn’t read that video’s length or size.</p>
        : !draft ? null
        : <ClipEditor source={source} meta={ready.meta} value={draft} onChange={setDraft} host={editable ? host : 'viewer'} />}
    </Modal>
  );
}
