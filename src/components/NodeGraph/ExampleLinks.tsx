/**
 * ExampleLinks — "Examples using …" in the node browsers (docs/node-browser.md, "Examples using a
 * node"): a compact strip of example cards under a search's results, at the top of a category, and
 * "Used in" on a node's preview. The examples come from the prebuilt index (store/exampleNodeIndex.ts),
 * so nothing loads until one is opened.
 *
 * Pictures: an example's poster when the poster cache already has one (drawn by a node page in
 * Files, files/posters.ts); otherwise a text card in the example's folder colour. Nothing is drawn
 * here: the strip changes with every keystroke.
 */
import { useEffect, useState } from 'react';
import type { ExampleHit } from '../../store/exampleNodeIndex';
import { getNodeDefinition } from '../../nodes/definitions';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius, type Tokens } from '../../theme/tokens';
import { Icon } from '../ui/Icon';
import { openExampleAsking } from './exampleLinksModel';

const SESSION_STILL = 'shader-studio:present:sampleStill:';

/** Posters already made (the poster cache, this session's Start sheet stills; never drawn here), by example key. */
function useCachedPosters(keys: string[]): Record<string, string | null> {
  // This session's Start sheet stills first (present/useSampleStills.ts keeps them in sessionStorage under this key).
  const [posters, setPosters] = useState<Record<string, string | null>>(() => {
    const out: Record<string, string | null> = {};
    try { for (const key of keys) { const s = sessionStorage.getItem(SESSION_STILL + key); if (s) out[key] = s; } } catch { /* storage blocked */ }
    return out;
  });
  const k = keys.join('|');
  useEffect(() => {
    const fromSession: Record<string, string> = {};
    try { for (const key of keys) { const s = sessionStorage.getItem(SESSION_STILL + key); if (s) fromSession[key] = s; } } catch { /* storage blocked */ }
    if (Object.keys(fromSession).length) setPosters(p => ({ ...fromSession, ...p }));
    if (typeof indexedDB === 'undefined' || !keys.length) return;
    let live = true;
    (async () => {
      try {
        const [{ posterCache, posterId }, { APP_VERSION }] = await Promise.all([import('../../files/posterCache'), import('../../files/appVersion')]);
        const cache = posterCache();
        for (const key of keys) {
          cache.get(posterId('example', key), `@${APP_VERSION}`).then(url => { if (live && url) setPosters(p => ({ ...p, [key]: url })); }, () => {});
        }
      } catch { /* no cache: text cards */ }
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [k]);
  return posters;
}

const nodeNames = (types: string[], max = 3) => {
  const names = types.slice(0, max).map(t => getNodeDefinition(t)?.label ?? t);
  return names.join(', ') + (types.length > max ? ` +${types.length - max}` : '');
};

export interface ExamplesStripProps {
  /** Ranked; the first `show` are cards, the rest wait behind More. */
  hits: ExampleHit[];
  title: string;
  /** How many show before More (default 4). */
  show?: number;
  /** cards: a row of small cards (the search, a category); list: compact rows (a narrow preview). */
  layout?: 'cards' | 'list';
  /** Columns for cards (default: as many as fit, up to `show`). */
  columns?: number;
  /** Bigger touch targets (a phone). */
  touch?: boolean;
  /** Hide the matched node names (a node's own preview: they're all that node). */
  hideTypes?: boolean;
  /** After an example opened (close the search, the sheet…). */
  onOpened?: () => void;
  /** For tests and styling. */
  id?: string;
}

export function ExamplesStrip({ hits, title, show = 4, layout = 'cards', columns, touch = false, hideTypes = false, onOpened, id }: ExamplesStripProps) {
  const tk = useTokens();
  const [more, setMore] = useState(false);
  const shown = more ? hits : hits.slice(0, show);
  const posters = useCachedPosters(shown.map(h => h.key));
  if (!hits.length) return null;
  const open = (h: ExampleHit) => { void openExampleAsking(h.key, h.label).then(ok => { if (ok) onOpened?.(); }); };
  return (
    <div data-example-strip={id ?? ''} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: layout === 'cards' ? '10px 0 4px' : '4px 0 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 2px' }}>
        <Icon name="graphs" size={13} style={{ color: tk.status.success, flexShrink: 0 }} />
        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: tk.text.faint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{title}</span>
        <span style={{ flex: 1, height: 1, background: tk.border.subtle, minWidth: 12 }} />
        {hits.length > show && (
          <button type="button" data-example-more onClick={() => setMore(m => !m)}
            style={{ border: 0, background: 'none', padding: touch ? '6px 4px' : '0 2px', cursor: 'pointer', color: tk.accent.text, font: `600 11.5px ${fontFamily.ui}`, whiteSpace: 'nowrap' }}>
            {more ? 'Fewer' : `More (${hits.length - show})`}
          </button>
        )}
      </div>
      {layout === 'cards' ? (
        <div style={{ display: 'grid', gridTemplateColumns: columns ? `repeat(${columns}, minmax(0, 1fr))` : `repeat(auto-fill, minmax(${touch ? 140 : 132}px, 1fr))`, gap: 8 }}>
          {shown.map(h => <ExampleCard key={h.key} hit={h} poster={posters[h.key]} tk={tk} touch={touch} hideTypes={hideTypes} onOpen={() => open(h)} />)}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {shown.map(h => <ExampleRow key={h.key} hit={h} poster={posters[h.key]} tk={tk} touch={touch} hideTypes={hideTypes} onOpen={() => open(h)} />)}
        </div>
      )}
    </div>
  );
}

/** The picture: the cached poster, else the folder's colour with its name. */
function Swatch({ hit, poster, tk, small }: { hit: ExampleHit; poster?: string | null; tk: Tokens; small?: boolean }) {
  const c = hit.color ?? tk.accent.base;
  if (poster) return <img src={poster} alt="" draggable={false} style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }} />;
  return (
    <span style={{
      display: 'flex', alignItems: 'flex-end', width: '100%', height: '100%', boxSizing: 'border-box', padding: small ? 0 : '0 7px 5px',
      background: `linear-gradient(135deg, ${alpha(c, 0.42)}, ${alpha(c, 0.12)})`, color: tk.text.secondary,
    }}>
      {!small && <span style={{ font: `600 9.5px ${fontFamily.ui}`, letterSpacing: '0.04em', textTransform: 'uppercase', opacity: 0.85, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{hit.folder ?? 'Example'}</span>}
    </span>
  );
}

function ExampleCard({ hit, poster, tk, touch, hideTypes, onOpen }: { hit: ExampleHit; poster?: string | null; tk: Tokens; touch: boolean; hideTypes: boolean; onOpen: () => void }) {
  return (
    <button type="button" data-example-card={hit.key} onClick={onOpen} title={`Open the example “${hit.label}”`}
      style={{
        display: 'flex', flexDirection: 'column', minWidth: 0, padding: 0, border: 0, cursor: 'pointer', textAlign: 'left', overflow: 'hidden',
        borderRadius: radius.lg, background: tk.bg.field, boxShadow: `inset 0 0 0 1px ${tk.border.subtle}`, color: tk.text.primary, touchAction: 'manipulation',
      }}>
      <span style={{ display: 'block', width: '100%', aspectRatio: '16 / 7', overflow: 'hidden', borderRadius: `${radius.lg}px ${radius.lg}px 0 0` }}>
        <Swatch hit={hit} poster={poster} tk={tk} />
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 1, padding: touch ? '7px 9px 9px' : '6px 9px 8px', minWidth: 0 }}>
        <b style={{ font: `600 12px ${fontFamily.ui}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{hit.label}</b>
        {!hideTypes && hit.types.length > 0 && (
          <span style={{ fontSize: 11, color: tk.text.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nodeNames(hit.types)}</span>
        )}
      </span>
    </button>
  );
}

function ExampleRow({ hit, poster, tk, touch, hideTypes, onOpen }: { hit: ExampleHit; poster?: string | null; tk: Tokens; touch: boolean; hideTypes: boolean; onOpen: () => void }) {
  return (
    <button type="button" data-example-card={hit.key} onClick={onOpen} title={`Open the example “${hit.label}”`}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, width: '100%', minHeight: touch ? 44 : 32, padding: '3px 6px', border: 0, borderRadius: radius.md,
        background: 'none', cursor: 'pointer', textAlign: 'left', color: tk.text.primary, touchAction: 'manipulation',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = tk.bg.hover; }} onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}>
      <span style={{ width: 36, height: 22, borderRadius: radius.xs, overflow: 'hidden', flexShrink: 0 }}><Swatch hit={hit} poster={poster} tk={tk} small /></span>
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <span style={{ font: `500 12px ${fontFamily.ui}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{hit.label}</span>
        {!hideTypes && hit.types.length > 0 && <span style={{ fontSize: 10.5, color: tk.text.faint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nodeNames(hit.types)}</span>}
        {hideTypes && hit.folder && <span style={{ fontSize: 10.5, color: tk.text.faint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{hit.folder}</span>}
      </span>
      <Icon name="chevR" size={12} style={{ color: tk.text.disabled, flexShrink: 0 }} />
    </button>
  );
}
