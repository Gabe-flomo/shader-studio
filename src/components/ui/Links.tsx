/**
 * Links in text people write (utils/links.ts): LinkedText draws a run of text
 * with its links clickable, and InsertLinkButton turns a text field's
 * selection into a Markdown link. Used by the Play notes and node comments.
 */
import { Fragment, type CSSProperties, type RefObject } from 'react';
import { parseLinks, insertLink, normaliseTypedUrl } from '../../utils/links';
import { openExternal } from '../../utils/openExternal';
import { askText } from './dialogStore';
import { toast } from './toastStore';
import { Button, IconButton } from './Button';

/** One link: a new tab on the web, the system browser in the desktop app. Never bubbles (a clickable card around it stays put). */
export function ExternalLink({ url, children, style }: { url: string; children: React.ReactNode; style?: CSSProperties }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={url}
      onClick={e => { e.stopPropagation(); openExternal(url, e); }}
      onMouseDown={e => e.stopPropagation()}
      onPointerDown={e => e.stopPropagation()}
      style={{ color: 'inherit', textDecoration: 'underline', textUnderlineOffset: 2, overflowWrap: 'anywhere', ...style }}
    >{children}</a>
  );
}

/** Text with its [words](https://…) and bare addresses as links. */
export function LinkedText({ text, linkStyle }: { text: string; linkStyle?: CSSProperties }) {
  return (
    <>
      {parseLinks(text).map((s, i) => s.url
        ? <ExternalLink key={i} url={s.url} style={linkStyle}>{s.text}</ExternalLink>
        : <Fragment key={i}>{s.text}</Fragment>)}
    </>
  );
}

/**
 * Ask for an address and put a link into the field: the selected words become
 * the link text. Keeps the selection around the words afterwards.
 */
async function promptInsertLink(field: HTMLTextAreaElement | HTMLInputElement | null, value: string, onChange: (next: string) => void): Promise<void> {
  const start = field?.selectionStart ?? value.length, end = field?.selectionEnd ?? value.length;
  const selected = value.slice(Math.min(start, end), Math.max(start, end)).trim();
  const typed = await askText(selected ? `Link “${selected.length > 40 ? `${selected.slice(0, 40)}…` : selected}”` : 'Add a link', {
    label: 'Web address (https://…)',
    initial: normaliseTypedUrl(selected) ? selected : '',
    confirmLabel: 'Add link',
  });
  if (typed === null) { field?.focus(); return; }
  const url = normaliseTypedUrl(typed);
  if (!url) {
    toast.warning('That isn’t a web address', { message: 'Links can go to http:// or https:// addresses only.' });
    field?.focus();
    return;
  }
  // Selected words become the link text; a selected address is replaced by the address itself.
  const a = Math.min(start, end), b = Math.max(start, end);
  const next = normaliseTypedUrl(selected)
    ? insertLink(value.slice(0, a) + value.slice(b), a, a, url)
    : insertLink(value, a, b, url);
  onChange(next.value);
  // After React writes the new value: focus back, selection around the words.
  requestAnimationFrame(() => {
    if (!field) return;
    field.focus();
    try { field.setSelectionRange(next.start, next.end); } catch { /* a field that went away */ }
  });
}

export function InsertLinkButton({ fieldRef, value, onChange, labelled = false }: {
  fieldRef: RefObject<HTMLTextAreaElement | HTMLInputElement | null>;
  value: string;
  onChange: (next: string) => void;
  /** A worded button ("Link") rather than an icon. */
  labelled?: boolean;
}) {
  const run = () => { void promptInsertLink(fieldRef.current, value, onChange); };
  // Pressing the button would move focus off the field and lose the selection: keep it.
  const keep = (e: React.MouseEvent) => e.preventDefault();
  return labelled
    ? <Button size="sm" variant="ghost" icon="link" onMouseDown={keep} onClick={run} title="Select words, then add a link to them">Link</Button>
    : <IconButton icon="link" size="sm" label="Add a link (select words first to link them)" onMouseDown={keep} onClick={run} />;
}
