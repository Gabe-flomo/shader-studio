/**
 * How much Shader Studio keeps on this device against its storage limit
 * (files/storageLimit.ts): saved work (localStorage), the media library's
 * images, videos and sounds (IndexedDB) and, in the desktop app, the
 * workspace folder on disk. The limit is set right here. Below it, the two
 * older readings that still matter: localStorage's own ~5 MB (the part that
 * stops saving when full) and the browser's estimate for its other storage.
 */
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { formatSize, STORAGE_LIMIT } from '../../utils/library';
import type { Inventory } from '../../files/inventory';
import { limitLabel, nearLimit, usedLabel, type StorageUsage } from '../../files/storageLimit';
import type { StorageEstimate } from './useFilesInventory';
import { capsLabel } from './fileUiShared';
import { StorageLimitControl } from './StorageLimitControl';
import { useStorageLimit } from './useStorageLimit';

const SHADES = [1, 0.78, 0.58, 0.42, 0.3];
/** A quota: "12 GB" rather than "12288 MB". */
const big = (n: number) => (n >= 1024 ** 3 ? `${Math.round(n / 1024 ** 3)} GB` : formatSize(n));

export function SpaceMeter({ inv, estimate, usage, compact = false, onCleanUp }: { inv: Inventory; estimate: StorageEstimate | null; usage: StorageUsage | null; compact?: boolean; onCleanUp?: () => void }) {
  const tk = useTokens();
  const limit = useStorageLimit();
  // Before the stores are measured, saved work alone (what the inventory knows).
  const parts = usage ?? { local: inv.total, images: 0, videos: 0, sounds: 0, workspace: 0, total: inv.total };
  const used = parts.total;
  const frac = limit ? used / limit : 0;
  const near = nearLimit(used, limit);
  const atLimit = !!limit && used >= limit;
  const barColour = near ? tk.status.warning : tk.accent.base;
  const segs = [
    { label: 'Saved work', size: parts.local }, { label: 'Images', size: parts.images }, { label: 'Videos', size: parts.videos }, { label: 'Sounds', size: parts.sounds }, { label: 'Workspace folder', size: parts.workspace },
  ].filter(s => s.size > 0).map((s, i) => ({ ...s, colour: alpha(barColour, SHADES[i] ?? 0.3) }));
  const scale = limit || Math.max(used, 1);

  // localStorage's own budget: what each section keeps there (images in IndexedDB don't count against it).
  const localUsed = inv.total + inv.other;
  const localFrac = localUsed / STORAGE_LIMIT;
  const localFull = localFrac > 0.8;

  const cleanUp = onCleanUp && <button type="button" onClick={onCleanUp} style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer', color: 'inherit', font: 'inherit', fontWeight: 650, textDecoration: 'underline' }}>Clean up</button>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? 7 : 9 }}>
      {!compact && <span style={capsLabel(tk)}>Storage on this device</span>}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
        <span data-storage-used style={{ font: `650 ${compact ? 17 : 20}px ${fontFamily.ui}`, color: near ? tk.status.warningText : tk.text.primary, letterSpacing: '-0.01em' }}>{usedLabel(used)}</span>
        <span style={{ fontSize: 12, color: tk.text.muted }}>{limit ? `of ${limitLabel(limit)} · ${frac < 0.01 && used ? '<1' : Math.round(frac * 100)}%` : 'no limit'}</span>
      </div>
      <div role="meter" aria-valuemin={0} aria-valuemax={scale} aria-valuenow={used} aria-label="Storage used on this device"
        style={{ display: 'flex', gap: 1.5, height: 7, borderRadius: 4, overflow: 'hidden', background: tk.bg.field }}>
        {segs.map(s => <span key={s.label} title={`${s.label}: ${formatSize(s.size)}`} style={{ width: `${Math.min(100, (s.size / scale) * 100)}%`, minWidth: s.size ? 2 : 0, background: s.colour }} />)}
      </div>
      {!compact && segs.length > 0 && (
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
      <div data-storage-limit style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, color: tk.text.muted }}>
        <span style={{ flex: 1 }} title="Saving, uploads and imports that would take this device past the limit are refused; removing things never is. The same setting is in App settings.">Limit</span>
        <StorageLimitControl height={24} />
      </div>
      {near && (
        <div role="status" style={{ padding: '8px 10px', borderRadius: radius.md, background: alpha(tk.status.warning, 0.12), color: tk.status.warningText, font: `12px/1.45 ${fontFamily.ui}` }}>
          {atLimit ? 'At the limit: saving, uploads and imports are refused until there is room.' : 'Nearly at the limit.'}{' '}
          {cleanUp}{cleanUp ? ' or raise the limit.' : 'Free space or raise the limit.'}
        </div>
      )}
      <span style={{ fontSize: 11.5, color: tk.text.faint, lineHeight: 1.4 }} title="The browser gives a site about 5 MB of this storage; saved graphs, presentations and presets live there">
        Saved work: {formatSize(localUsed)} of about {formatSize(STORAGE_LIMIT)} in the browser’s own space{estimate && estimate.quota > 0 ? ` · Browser’s estimate: ${formatSize(estimate.usage)} of ${big(estimate.quota)}` : ''}
      </span>
      {localFull && !near && (
        <div style={{ padding: '8px 10px', borderRadius: radius.md, background: alpha(tk.status.warning, 0.12), color: tk.status.warningText, font: `12px/1.45 ${fontFamily.ui}` }}>
          {localFrac >= 0.97 ? 'The browser’s space for saved work is full: saving can fail now.' : 'The browser’s space for saved work is nearly full.'}{' '}{cleanUp}
        </div>
      )}
    </div>
  );
}
