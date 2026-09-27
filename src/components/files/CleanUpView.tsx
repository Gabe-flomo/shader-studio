/**
 * Clean up: what could go, grouped by why (biggest, old versions, not used,
 * duplicates, empty folders), each with its reason, what it frees, and
 * Remove (with Undo). "Show" opens the thing in the Files list.
 */
import { useMemo, useState } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Button, IconButton } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Segmented } from '../ui/Choice';
import { formatSize } from '../../utils/library';
import { cleanupSuggestions, type CleanupKind, type Suggestion } from '../../files/cleanup';
import type { Inventory } from '../../files/inventory';
import type { IconName } from '../ui/iconPaths';
import { Size } from './fileUi';
import { capsLabel } from './fileUiShared';

const GROUP_ICONS: Record<CleanupKind, IconName> = { big: 'target', versions: 'history', unused: 'eyeOff', duplicate: 'copy', emptyFolder: 'folder' };
const KEEP_KEY = 'shader-studio:settings:filesKeepVersions';

export function CleanUpView({ inv, compact, onShow, onRemove }: {
  inv: Inventory;
  compact: boolean;
  onShow: (id: string) => void;
  onRemove: (ids: string[], confirmAlways?: boolean) => Promise<boolean>;
}) {
  const tk = useTokens();
  const [keep, setKeep] = useState<'3' | '5' | '10'>(() => { try { const v = localStorage.getItem(KEEP_KEY); return v === '3' || v === '10' ? v : '5'; } catch { return '5'; } });
  const groups = useMemo(() => cleanupSuggestions(inv, { keepVersions: Number(keep) }), [inv, keep]);
  // "Biggest" is about looking, not a reason to remove: it doesn't count towards what clean-up frees.
  const could = groups.filter(g => g.kind !== 'big').reduce((n, g) => n + g.items.reduce((m, s) => m + s.size, 0), 0);
  const count = groups.filter(g => g.kind !== 'big').reduce((n, g) => n + g.items.length, 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? 14 : 18, padding: compact ? '14px 12px 40px' : '22px 28px 60px', maxWidth: 980, width: '100%', boxSizing: 'border-box', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ width: compact ? 36 : 42, height: compact ? 36 : 42, borderRadius: 11, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: alpha(tk.status.success, 0.12), color: tk.status.success }}>
          <Icon name="spark" size={19} />
        </span>
        <div style={{ flex: 1, minWidth: 180, display: 'flex', flexDirection: 'column', gap: 3 }}>
          <h1 style={{ margin: 0, font: `650 ${compact ? 17 : 20}px ${fontFamily.ui}`, letterSpacing: '-0.015em', color: tk.text.primary }}>Clean up</h1>
          <span style={{ fontSize: 12, color: tk.text.muted, lineHeight: 1.45 }}>
            {count ? `${count} suggestion${count === 1 ? '' : 's'} · could free ${formatSize(could)}. Everything you remove can be undone right after.` : 'Nothing to clean up: no old versions, unused files, duplicates or empty folders.'}
          </span>
        </div>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: tk.text.muted }}>
          Keep versions
          <Segmented size="sm" ariaLabel="Earlier versions to keep" value={keep} onChange={v => { setKeep(v); try { localStorage.setItem(KEEP_KEY, v); } catch { /* preference only */ } }}
            options={[{ value: '3', label: '3' }, { value: '5', label: '5' }, { value: '10', label: '10' }]} />
        </span>
      </div>

      {groups.map(g => (
        <section key={g.kind} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 4px', minHeight: 30 }}>
            <Icon name={GROUP_ICONS[g.kind]} size={14} style={{ color: tk.text.muted }} />
            <span style={{ font: `650 13px ${fontFamily.ui}`, color: tk.text.primary }}>{g.title}</span>
            <span style={{ ...capsLabel(tk), letterSpacing: 0, textTransform: 'none', font: `12px ${fontFamily.ui}`, color: tk.text.faint, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{compact ? '' : g.hint}</span>
            {g.kind !== 'big' && g.items.length > 1 && (
              <Button size="sm" variant="ghost" icon="trash" onClick={() => { void onRemove(g.items.flatMap(s => s.removeIds)); }}>
                Remove all · {formatSize(g.items.reduce((n, s) => n + s.size, 0))}
              </Button>
            )}
          </div>
          <div style={{ borderRadius: radius.lg, boxShadow: `inset 0 0 0 1px ${tk.border.default}`, background: tk.bg.panel, overflow: 'hidden' }}>
            {g.items.map((s, i) => <SuggestionRow key={s.id} s={s} first={i === 0} compact={compact} onShow={() => onShow(s.nodeId)} onRemove={() => { void onRemove(s.removeIds, s.kind === 'big'); }} />)}
          </div>
        </section>
      ))}
    </div>
  );
}

function SuggestionRow({ s, first, compact, onShow, onRemove }: { s: Suggestion; first: boolean; compact: boolean; onShow: () => void; onRemove: () => void }) {
  const tk = useTokens();
  const [hover, setHover] = useState(false);
  // The row opens the thing; Remove is the one button.
  return (
    <div role="button" tabIndex={0} onClick={onShow} onKeyDown={e => { if (e.key === 'Enter') onShow(); }} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      title="Show it in Files"
      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: compact ? '9px 6px 9px 12px' : '9px 10px 9px 14px', borderTop: first ? 0 : `1px solid ${tk.border.subtle}`, cursor: 'pointer', background: hover ? tk.bg.hover : 'transparent', outline: 'none' }}>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ font: `600 13px ${fontFamily.ui}`, color: tk.text.primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.label}</span>
        <span style={{ fontSize: 11.5, color: tk.text.muted, lineHeight: 1.4 }}>{s.reason}</span>
      </div>
      {s.size > 0 && <Size n={s.size} style={{ width: compact ? undefined : 64, textAlign: 'right', flexShrink: 0 }} />}
      <span onClick={e => e.stopPropagation()} style={{ display: 'flex', flexShrink: 0 }}>
        {compact
          ? <IconButton icon="trash" tone="danger" label={`Remove ${s.label}`} tooltip={false} onClick={onRemove} />
          : <Button size="sm" icon="trash" onClick={onRemove}>{s.kind === 'big' ? 'Remove…' : 'Remove'}</Button>}
      </span>
    </div>
  );
}
