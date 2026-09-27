/**
 * What the app's audio file pickers accept, in a form each platform handles.
 *
 * iOS and iPadOS treat an `accept` with the `audio/*` wildcard as a request
 * for the media library: the picker shows Photos (videos only) instead of the
 * Files browser, so a .wav in Files can't be chosen at all. A list of plain
 * extensions opens Files. Desktop browsers get the wildcard as well, which
 * keeps every audio type selectable in their dialogs.
 */

export const AUDIO_EXTENSIONS = ['wav', 'mp3', 'ogg', 'oga', 'm4a', 'aac', 'flac', 'aif', 'aiff', 'weba'] as const;

const EXT_LIST = AUDIO_EXTENSIONS.map(e => `.${e}`).join(',');
const EXT_RE = new RegExp(`\\.(${AUDIO_EXTENSIONS.join('|')})$`, 'i');

type NavLike = { userAgent?: string; maxTouchPoints?: number };

/** An iPhone, iPod or iPad, including iPadOS, which reports itself as a Mac. */
export function isAppleTouch(nav: NavLike | undefined = typeof navigator === 'undefined' ? undefined : navigator): boolean {
  if (!nav) return false;
  const ua = nav.userAgent ?? '';
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1);
}

/** The `accept` for an audio file input on this device. */
export function audioAccept(nav?: NavLike): string {
  return isAppleTouch(nav) ? EXT_LIST : `audio/*,${EXT_LIST}`;
}

/** A picked file that is audio: by type, or by extension when the OS gives no type (iOS Files often doesn't). */
export function isAudioFile(f: { name: string; type: string }): boolean {
  return /^audio\//.test(f.type) || EXT_RE.test(f.name);
}

/** Why a picked file was refused, in the user's words. */
export function notAudioMessage(f: { name: string; type: string }): string {
  const kind = /^video\//.test(f.type) ? 'a video' : /^image\//.test(f.type) ? 'a picture' : 'not an audio file';
  return `"${f.name}" is ${kind}. Pick a sound file (${AUDIO_EXTENSIONS.slice(0, 5).map(e => e.toUpperCase()).join(', ')}…) from Files.`;
}
