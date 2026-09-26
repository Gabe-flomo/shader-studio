/**
 * Sources — the Plays a presentation reads from: picking one (from the ones
 * it already has, or any saved graph or example with a Play setup, which
 * takes a snapshot), the card that says where each came from with Refresh
 * and Open, and the stills made for them in the background.
 */
import { useState, type RefObject } from 'react';
import { missingMedia, refreshSnapshot, sourceLimits } from '../../present/snapshot';
import { blockSources, type PresentSource } from '../../types/presentation';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Button, IconButton } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Popover } from '../ui/Popover';
import { Sheet } from '../ui/Sheet';
import { toast } from '../ui/toastStore';
import { PlayableList, type PlayableRow } from '../play/OpenPlayable';
import type { Page } from '../page';
import { usePresentation } from './presentationStore';
import { addSourceFrom, openSourceGraph, originText } from './sourceActions';

const NO_SOURCES: PresentSource[] = [];

export function Poster({ source, size = 44 }: { source: PresentSource | undefined; size?: number }) {
  const tk = useTokens();
  return (
    <span style={{ width: size * 16 / 9, height: size, flexShrink: 0, borderRadius: radius.sm, overflow: 'hidden', background: tk.bg.render, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
      {source?.poster ? <img src={source.poster} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Icon name="layoutCanvas" size={14} style={{ color: alpha('#ffffff', 0.35) }} />}
    </span>
  );
}

function SourceRow({ s, onPick }: { s: PresentSource; onPick: () => void }) {
  const tk = useTokens();
  return (
    <button
      type="button" onClick={onPick}
      style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', border: 0, cursor: 'pointer', padding: '6px 12px', background: 'transparent', color: tk.text.primary, font: `500 12.5px ${fontFamily.ui}` }}
      onMouseEnter={e => { e.currentTarget.style.background = alpha(tk.accent.base, 0.08); }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
    >
      <Poster source={s} size={30} />
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title}</span>
        <span style={{ fontSize: 11, color: tk.text.muted }}>{s.bundle.play.controls.length} control{s.bundle.play.controls.length === 1 ? '' : 's'} · {originText(s)}</span>
      </span>
    </button>
  );
}

/** Pick a source: one already in the presentation, or a new snapshot of any Play. */
export function SourcePicker({ anchorRef, compact, onPick, onClose }: { anchorRef: RefObject<HTMLElement | null>; compact: boolean; onPick: (s: PresentSource) => void; onClose: () => void }) {
  const tk = useTokens();
  const sources = usePresentation(s => s.doc?.sources ?? NO_SOURCES);
  const [busy, setBusy] = useState(false);
  const pickRow = async (row: PlayableRow) => {
    setBusy(true);
    const s = await addSourceFrom(row);
    setBusy(false);
    if (s) onPick(s);
  };
  const caps: React.CSSProperties = { fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: tk.text.faint, padding: '10px 12px 4px' };
  const body = (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, maxHeight: compact ? '70dvh' : 'min(70vh, 600px)' }}>
      {sources.length > 0 && (
        <div style={{ flexShrink: 0, maxHeight: '40%', overflowY: 'auto', borderBottom: `1px solid ${tk.border.subtle}`, paddingBottom: 6 }}>
          <div style={caps}>In this presentation</div>
          {sources.map(s => <SourceRow key={s.id} s={s} onPick={() => { onPick(s); onClose(); }} />)}
        </div>
      )}
      <div style={{ ...caps, paddingBottom: 0 }}>{busy ? 'Taking a snapshot…' : 'Add a Play'}</div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', opacity: busy ? 0.5 : 1, pointerEvents: busy ? 'none' : undefined }}>
        <PlayableList current={null} onDone={() => { /* closes once the snapshot is in */ }} onPick={row => { void pickRow(row).then(onClose); }} />
      </div>
    </div>
  );
  return compact
    ? <Sheet title="Choose a Play" onClose={onClose} maxHeight="85dvh">{body}</Sheet>
    : <Popover anchorRef={anchorRef} onClose={onClose} width={380} padding={0}>{body}</Popover>;
}

/** A source in the settings panel: where it's from, what it can't run, Refresh and Open. */
export function SourceCard({ s, navigate, compact = false }: { s: PresentSource; navigate: (p: Page) => void; compact?: boolean }) {
  const tk = useTokens();
  const replaceSource = usePresentation(st => st.replaceSource);
  const removeSource = usePresentation(st => st.removeSource);
  const used = usePresentation(st => st.doc?.steps.some(step => step.blocks.some(b => blockSources(b).includes(s.id))) ?? false);
  const limits = sourceLimits(s);
  const noFiles = missingMedia(s);
  const [busy, setBusy] = useState(false);
  const refresh = async () => {
    setBusy(true);
    const r = await refreshSnapshot(s);
    setBusy(false);
    if (!r.ok) { toast.error('Couldn’t refresh it', { message: r.error }); return; }
    const lost = s.bundle.play.controls.filter(c => !r.source.bundle.play.controls.some(x => x.id === c.id)).map(c => c.label);
    replaceSource(r.source);
    toast.success(`“${s.title}” refreshed`, lost.length ? { message: `No longer there, so taken out of its blocks: ${lost.join(', ')}.` } : undefined);
  };
  return (
    <div style={{ padding: 10, borderRadius: radius.lg, border: `1px solid ${tk.border.default}`, background: tk.bg.panel, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', minWidth: 0 }}>
        <Poster source={s} size={36} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: tk.text.primary, font: `600 12.5px ${fontFamily.ui}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title}</div>
          <div style={{ color: tk.text.muted, font: `500 11.5px ${fontFamily.ui}` }}>{originText(s)}</div>
        </div>
      </div>
      {limits.length > 0 && (
        <div style={{ display: 'flex', gap: 6, color: tk.status.warningText, font: `500 11.5px/1.4 ${fontFamily.ui}` }}>
          <Icon name="warning" size={13} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>Shown as a still: the web player can’t run {limits.join(', ')} yet.</span>
        </div>
      )}
      {noFiles.length > 0 && (
        <div style={{ display: 'flex', gap: 6, color: tk.status.warningText, font: `500 11.5px/1.4 ${fontFamily.ui}` }}>
          <Icon name="warning" size={13} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>Without {noFiles.join(' and ')}: files stay with the graph open in the Studio. Open it there with its files loaded, then Refresh.</span>
        </div>
      )}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
        <Button size="sm" icon="reset" disabled={busy} onClick={refresh} title="Take a new snapshot of the graph as it is now. Blocks keep their controls where the ids still exist.">{busy ? 'Refreshing…' : 'Refresh'}</Button>
        <Button size="sm" variant="ghost" onClick={() => void openSourceGraph(s, 'studio', navigate)} title="Open its graph in the Studio to edit it (then Refresh here)">Studio</Button>
        {!compact && <Button size="sm" variant="ghost" onClick={() => void openSourceGraph(s, 'play', navigate)} title="Open it on the Play page">Play</Button>}
        <span style={{ flex: 1 }} />
        <IconButton size="sm" icon="trash" tone="danger" label={used ? 'Used by a block: remove those blocks first' : 'Remove this source'} disabled={used} onClick={() => removeSource(s.id)} />
      </div>
    </div>
  );
}
