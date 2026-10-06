/**
 * "Edit clip…" for a background video (the header's, or one in a Background
 * layer's queue): the shared clip editor with timing capabilities (trim,
 * segments, reverse, speed, loop; Placement already crops and turns it). The
 * video is read from the element that plays it (a data URL, a session copy or
 * a linked file), so it opens whatever the video's source.
 */
import { useState } from 'react';
import { Button } from '../ui/Button';
import { parseSavedClip, type SavedClip } from '../../lib/media/clip';
import { LazyClipEditorModal } from '../media/lazyClipEditor';

/** The file behind a playing <video> (its data: or blob: URL), or null. */
export async function blobOfElement(el: HTMLVideoElement | null): Promise<Blob | null> {
  const url = el?.currentSrc || el?.src || '';
  if (!url) return null;
  try { return await (await fetch(url)).blob(); } catch { return null; }
}

const RATE_MIN = 0.1, RATE_MAX = 4;

export function BackgroundClipButton({ name, element, clip, rate, loop, onApply }: {
  name: string;
  element: () => HTMLVideoElement | null;
  clip: SavedClip | undefined;
  rate: number;
  loop: boolean;
  onApply: (patch: { clip: SavedClip | undefined; rate: number; loop: boolean }) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="ghost" icon="play" onClick={() => setOpen(true)} title="Trim, segments, speed and loop (the clip editor)">{clip ? 'Edit clip… (trimmed)' : 'Edit clip…'}</Button>
      {open && (
        <LazyClipEditorModal
          host="background"
          subtitle={`Background · ${name}`}
          load={() => blobOfElement(element())}
          saved={parseSavedClip(clip)}
          speed={rate}
          loop={loop}
          note="Apply sets how the background plays on the clock: the kept segments in order. Renders and web pages show the same frames."
          onApply={a => onApply({ clip: a.clip ?? undefined, rate: Math.max(RATE_MIN, Math.min(RATE_MAX, a.speed)), loop: a.loop })}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
