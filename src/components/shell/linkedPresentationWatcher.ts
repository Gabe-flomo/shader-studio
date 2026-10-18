/**
 * linkedPresentationWatcher — when a graph with a linked presentation is
 * opened (a saved graph's `linkedPresentations`, or an example's declared
 * sample, present/links.ts), follow the "Linked presentations" setting:
 *
 *   Ask     a small notice, "Has a presentation · Open"
 *   Always  open it on the Present page too, without leaving this page
 *   Never   nothing
 *
 * Nothing happens when that presentation is already the open one. The
 * Present page's code loads only when a presentation is actually opened.
 * The Ask notice shows once per graph (an example by its key, a saved graph
 * by its name), remembered on this device: opening it again doesn't cover
 * the controls with the same notice every time.
 */
import { useEffect } from 'react';
import { GRAPH_OPENED, type GraphOpened } from '../../store/useNodeGraphStore';
import { decideOnGraphLoad, exampleLinks, linkedOpenSetting, linkedPresentationsOf, openPresentationName } from '../../present/links';
import { toast } from '../ui/toastStore';
import { requestPage } from '../page';

export const LINKED_PRESENTATION_TOAST = 'Has a presentation';

const ASKED_KEY = 'shader-studio:linkedPresentationAsked';
/** How many graphs' "asked" marks to keep (the oldest go first). */
const ASKED_KEEP = 200;

const graphKey = (ev: GraphOpened) => (ev.kind === 'example' ? `example:${ev.key}` : `saved:${ev.name}`);

function askedList(): string[] {
  try { const v = JSON.parse(localStorage.getItem(ASKED_KEY) ?? '[]'); return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []; } catch { return []; }
}

/** True the first time a graph's notice is asked for (and marks it), false after. */
export function firstAskFor(ev: GraphOpened): boolean {
  const key = graphKey(ev);
  const list = askedList();
  if (list.includes(key)) return false;
  try { localStorage.setItem(ASKED_KEY, JSON.stringify([...list, key].slice(-ASKED_KEEP))); } catch { /* preference only: it may ask again */ }
  return true;
}

const more = (n: number) => (n > 0 ? ` (and ${n} more)` : '');

async function openIt(ev: GraphOpened, name: string): Promise<boolean> {
  const m = await import('../present/linkActions');
  return ev.kind === 'example' ? m.openSampleByTitle(name) : m.openPresentation(name);
}

export function handleGraphOpened(ev: GraphOpened): void {
  const linked = ev.kind === 'saved' ? linkedPresentationsOf(ev.name) : [...exampleLinks(ev.key)];
  const d = decideOnGraphLoad({ setting: linkedOpenSetting(), linked, openPresentation: openPresentationName() });
  if (d.kind === 'none') return;
  if (d.kind === 'open') {
    void openIt(ev, d.name).then(ok => {
      if (ok) toast.info(`“${d.name}” is open on Present`, { message: `Linked to this graph${more(d.others)}.`, action: { label: 'Go to Present', onClick: () => requestPage('present') } });
    }, () => {});
    return;
  }
  if (!firstAskFor(ev)) return;
  toast.info(LINKED_PRESENTATION_TOAST, {
    message: `${ev.kind === 'example' ? 'Sample: ' : ''}“${d.name}”${more(d.others)}`,
    action: { label: 'Open', onClick: () => { void openIt(ev, d.name).then(ok => { if (ok) requestPage('present'); }, () => {}); } },
  });
}

/** Mounted once (App). */
export function useLinkedPresentationWatcher(): void {
  useEffect(() => {
    const on = (e: Event) => { const d = (e as CustomEvent<GraphOpened>).detail; if (d) handleGraphOpened(d); };
    window.addEventListener(GRAPH_OPENED, on);
    return () => window.removeEventListener(GRAPH_OPENED, on);
  }, []);
}
