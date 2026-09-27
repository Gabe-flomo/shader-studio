/**
 * How full the browser's storage is: saved work against localStorage's
 * ~5 MB (the part that stops saving when full), split by section, and the
 * browser's estimate for its other storage (IndexedDB, caches).
 */
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { formatSize, STORAGE_LIMIT } from '../../utils/library';
import type { Inventory } from '../../files/inventory';
import type { StorageEstimate } from './useFilesInventory';
import { capsLabel } from './fileUiShared';

const SHADES = [1, 0.72, 0.5, 0.34];
/** A quota: "12 GB" rather than "12288 MB". */
const big = (n: number) => (n >= 1024 ** 3 ? `${Math.round(n / 1024 ** 3)} GB` : formatSize(n));

export function SpaceMeter({ inv, estimate, compact = false, onCleanUp }: { inv: Inventory; estimate: StorageEstimate | null; compact?: boolean; onCleanUp?: () => void }) {
  const tk = useTokens();
  const used = inv.total + inv.other;
  const frac = used / STORAGE_LIMIT;
  const full = frac > 0.8;
  const barColour = full ? tk.status.warning : tk.accent.base;
  // The four biggest sections get their own shade; the rest (and other sites' keys) share one.
  // What each section keeps in localStorage: images in IndexedDB don't count against its budget.
  const sections = inv.sections.map(s => ({ label: s.label, size: s.size - (inv.externalBySection[s.section] ?? 0) })).filter(s => s.size > 0).sort((a, b) => b.size - a.size);
  const top = sections.slice(0, SHADES.length);
  const rest = sections.slice(SHADES.length).reduce((n, s) => n + s.size, 0) + inv.other + Math.max(0, inv.total - sections.reduce((n, s) => n + s.size, 0));
  const segs = [...top.map((s, i) => ({ label: s.label, size: s.size, colour: alpha(barColour, SHADES[i]) })), ...(rest > 0 ? [{ label: 'Other', size: rest, colour: tk.border.strong }] : [])];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? 7 : 9 }}>
      {!compact && <span style={capsLabel(tk)}>Browser storage</span>}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
        <span style={{ font: `650 ${compact ? 17 : 20}px ${fontFamily.ui}`, color: full ? tk.status.warningText : tk.text.primary, letterSpacing: '-0.01em' }}>{formatSize(used)}</span>
        <span style={{ fontSize: 12, color: tk.text.muted }}>of about {formatSize(STORAGE_LIMIT)} · {Math.round(frac * 100)}%</span>
      </div>
      <div role="meter" aria-valuemin={0} aria-valuemax={STORAGE_LIMIT} aria-valuenow={used} aria-label="Saved work in this browser"
        style={{ display: 'flex', gap: 1.5, height: 7, borderRadius: 4, overflow: 'hidden', background: tk.bg.field }}>
        {segs.map(s => <span key={s.label} title={`${s.label}: ${formatSize(s.size)}`} style={{ width: `${Math.min(100, (s.size / STORAGE_LIMIT) * 100)}%`, minWidth: s.size ? 2 : 0, background: s.colour }} />)}
      </div>
      {!compact && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', rowGap: 3, columnGap: 8, fontSize: 11.5 }}>
          {segs.map(s => (
            <span key={s.label} style={{ display: 'contents' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: tk.text.secondary, minWidth: 0 }}>
                <span style={{ width: 7, height: 7, borderRadius: 2, background: s.colour, flexShrink: 0 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.label}</span>
              </span>
              <span style={{ font: `500 11px ${fontFamily.mono}`, color: tk.text.faint, textAlign: 'right' }}>{formatSize(s.size)}</span>
            </span>
          ))}
        </div>
      )}
      {estimate && estimate.quota > 0 && (
        <span style={{ fontSize: 11.5, color: tk.text.faint, lineHeight: 1.4 }} title="IndexedDB and caches: the browser's own estimate for this site">
          {inv.external ? `Images and videos ${formatSize(inv.external)} · ` : ''}IndexedDB and caches: {formatSize(estimate.usage)} of {big(estimate.quota)}
        </span>
      )}
      {full && (
        <div style={{ padding: '8px 10px', borderRadius: radius.md, background: alpha(tk.status.warning, 0.12), color: tk.status.warningText, font: `12px/1.45 ${fontFamily.ui}` }}>
          {frac >= 0.97 ? 'Full: saving can fail now.' : 'Nearly full: saving will start to fail.'}{' '}
          {onCleanUp && <button type="button" onClick={onCleanUp} style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer', color: 'inherit', font: 'inherit', fontWeight: 650, textDecoration: 'underline' }}>Clean up</button>}
        </div>
      )}
    </div>
  );
}
