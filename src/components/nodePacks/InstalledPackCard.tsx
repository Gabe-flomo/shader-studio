/**
 * A node pack's entry in the node list: shown at the top of the category its
 * nodes are listed under (the pack's name), with who made it, what it's for,
 * its example graphs and presentations a click away, and its notes and licence.
 */
import { useMemo, useState, useSyncExternalStore } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { DocText } from '../ui/DocText';
import { reportFileResult } from '../shell/reportFileResult';
import { requestPage } from '../page';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { INSTALLED_PACKS_CHANGED, INSTALLED_PACKS_KEY, packForCategory } from '../../nodePacks/installed';
import type { InstalledPack } from '../../nodePacks/types';

const subscribe = (cb: () => void) => { window.addEventListener(INSTALLED_PACKS_CHANGED, cb); return () => window.removeEventListener(INSTALLED_PACKS_CHANGED, cb); };
const snapshot = () => { try { return localStorage.getItem(INSTALLED_PACKS_KEY) ?? ''; } catch { return ''; } };

function useInstalledPack(category: string): InstalledPack | null {
  const raw = useSyncExternalStore(subscribe, snapshot, snapshot);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- raw is the change signal
  return useMemo(() => packForCategory(category), [category, raw]);
}

export function PackGlyphSmall({ pack, size = 14 }: { pack: Pick<InstalledPack, 'color' | 'icon' | 'name'>; size?: number }) {
  return (
    <span style={{ width: size, height: size, borderRadius: size * 0.3, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: pack.color || '#7c5cff', color: '#fff', font: `700 ${Math.round(size * 0.6)}px ${fontFamily.ui}`, flexShrink: 0 }}>
      {(pack.icon || pack.name.slice(0, 1)).toUpperCase().slice(0, 2)}
    </span>
  );
}

export function InstalledPackCard({ category, onOpened }: { category: string; onOpened?: () => void }) {
  const tk = useTokens();
  const pack = useInstalledPack(category);
  const [more, setMore] = useState(false);
  if (!pack) return null;
  const c = pack.color || tk.kind.fn;
  const openGraph = (name: string) => {
    if (reportFileResult(useNodeGraphStore.getState().loadSavedGraph(name), { failTitle: `Couldn’t open “${name}”` })) { requestPage('studio'); onOpened?.(); }
  };
  const openPresentation = async (name: string) => {
    const { rememberLast } = await import('../../present/storage');
    rememberLast(name);
    requestPage('present');
  };
  return (
    <div data-testid="installed-pack" style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '9px 10px', marginBottom: 6, borderRadius: radius.md, background: alpha(c, 0.08), boxShadow: `inset 0 0 0 1px ${alpha(c, 0.22)}` }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <PackGlyphSmall pack={pack} size={22} />
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <b style={{ font: `650 12.5px ${fontFamily.ui}`, color: tk.text.primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pack.name} <span style={{ fontWeight: 500, color: tk.text.muted }}>v{pack.version}</span></b>
          <span style={{ fontSize: 11, color: tk.text.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            Node pack{pack.author ? ` by ${pack.author}` : ''}{pack.signedBy ? ` · signed ${pack.signedBy.fingerprint.slice(0, 9)}` : ' · unsigned'}
          </span>
        </span>
      </span>
      {pack.description && <DocText text={pack.description} style={{ fontSize: 11.5, color: tk.text.secondary }} />}
      {(pack.examples?.length || pack.presentations?.length) ? (
        <span style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {pack.examples?.map(g => <Button key={g} size="sm" icon="graphs" title={`Open the example graph “${g}” in the Studio`} onClick={() => openGraph(g)} style={{ height: 26, maxWidth: '100%' }}>{g}</Button>)}
          {pack.presentations?.map(n => <Button key={n} size="sm" icon="slides" title={`Open “${n}” on Present`} onClick={() => { void openPresentation(n); }} style={{ height: 26, maxWidth: '100%' }}>{n}</Button>)}
        </span>
      ) : null}
      {(pack.notes?.length || pack.licence) ? (
        <button type="button" onClick={() => setMore(m => !m)} style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 4, border: 0, padding: 0, background: 'none', cursor: 'pointer', color: tk.accent.text, font: `500 11.5px ${fontFamily.ui}` }}>
          <Icon name={more ? 'chevD' : 'chevR'} size={11} />{[pack.notes?.length ? 'Notes' : '', pack.licence ? 'Licence' : ''].filter(Boolean).join(' and ')}
        </button>
      ) : null}
      {more && pack.notes?.map(n => <div key={n.name} style={{ padding: '6px 8px', borderRadius: 6, background: tk.bg.panel }}><DocText text={n.text} style={{ fontSize: 11.5, color: tk.text.secondary }} /></div>)}
      {more && pack.licence && <pre style={{ margin: 0, padding: '6px 8px', borderRadius: 6, background: tk.bg.panel, whiteSpace: 'pre-wrap', font: `11px/1.45 ${fontFamily.mono}`, color: tk.text.secondary }}>{pack.licence}</pre>}
    </div>
  );
}
