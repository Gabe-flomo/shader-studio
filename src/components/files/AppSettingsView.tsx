/**
 * App settings: the app's own preferences (files/appSettings.ts) by category,
 * with readable names and sizes instead of storage keys. Reset one to its
 * default, or all of them (things you made or installed, such as saved looks
 * or a sign-in, stay unless reset one by one). Every reset can be undone.
 * They still travel in profile ZIPs and backups as before.
 */
import { useState } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily } from '../../theme/tokens';
import { Button, IconButton } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { askConfirm } from '../ui/dialogStore';
import { formatSize } from '../../utils/library';
import { countLeaves, type FileNode, type Inventory } from '../../files/inventory';
import { describeSetting, resetAllKeys } from '../../files/appSettings';
import { resetSettings } from './filesActions';
import { Size } from './fileUi';
import { cardStyle } from './fileUiShared';
import { requestPage } from '../page';
import { BackgroundSettings } from './BackgroundSettings';
import { StorageLimitControl } from './StorageLimitControl';
import { AutosaveSettings } from './AutosaveSettings';
import { ImageModelSetting } from './ImageModelSetting';
import { ExplanationModelSettings } from './ExplanationModelSettings';
import { TrackerModelsSettings } from './TrackerModelsSettings';
import { useStorageLimit } from './useStorageLimit';
import { DEFAULT_STORAGE_LIMIT, limitLabel } from '../../files/storageLimit';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
const keyOf = (n: FileNode) => (n.ref?.t === 'key' ? n.ref.key : '');

export function AppSettingsView({ inv, node, compact }: { inv: Inventory; node: FileNode; compact: boolean }) {
  const tk = useTokens();
  const cats = node.children ?? [];
  const items = cats.flatMap(c => c.children ?? []);
  const resettable = items.filter(n => resetAllKeys([keyOf(n)]).length);
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  const limit = useStorageLimit();

  const resetOne = async (n: FileNode) => {
    const info = describeSetting(keyOf(n));
    if (info.data && !(await askConfirm(`Reset “${n.label}”?`, { message: `${info.hint ? `${info.hint}. ` : ''}This holds things you made or installed; they go too. You can undo it right after.`, confirmLabel: 'Reset', danger: true }))) return;
    resetSettings(inv, [n.id], `“${n.label}”`);
  };
  const resetAll = async () => {
    const kept = items.length - resettable.length;
    const ok = await askConfirm('Reset all app settings?', {
      message: `${plural(resettable.length, 'setting')} go back to their defaults (theme, shortcuts, panel sizes, camera, folders…).${kept ? ` ${plural(kept, 'thing')} you made or installed (${items.filter(n => !resettable.includes(n)).map(n => n.label).join(', ')}) stay.` : ''} Your graphs, presentations and presets aren’t touched. You can undo it right after.`,
      confirmLabel: 'Reset all', danger: true,
    });
    if (ok) resetSettings(inv, resettable.map(n => n.id), plural(resettable.length, 'app setting'));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? 14 : 18, padding: compact ? '14px 12px 40px' : '22px 28px 60px', maxWidth: 980, width: '100%', boxSizing: 'border-box', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ width: compact ? 36 : 42, height: compact ? 36 : 42, borderRadius: 11, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: alpha(tk.text.muted, 0.12), color: tk.text.muted }}>
          <Icon name="sliders" size={19} />
        </span>
        <div style={{ flex: 1, minWidth: 180, display: 'flex', flexDirection: 'column', gap: 3 }}>
          <h1 style={{ margin: 0, font: `650 ${compact ? 17 : 20}px ${fontFamily.ui}`, letterSpacing: '-0.015em', color: tk.text.primary }}>App settings</h1>
          <span style={{ fontSize: 12, color: tk.text.muted, lineHeight: 1.45 }}>
            {plural(countLeaves(cats), 'preference')} · {formatSize(node.size)}. Reset one to go back to its default. They travel in profile ZIPs and backups.
          </span>
        </div>
        <Button size="sm" icon="keyboard" onClick={() => requestPage('shortcuts')}>Keyboard shortcuts</Button>
        <Button size="sm" icon="reset" disabled={!resettable.length} onClick={() => { void resetAll(); }}>Reset all app settings…</Button>
      </div>

      <section aria-label="Storage" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 4px', minHeight: 28 }}>
          <span style={{ font: `650 13px ${fontFamily.ui}`, color: tk.text.primary }}>Storage</span>
          <span style={{ fontSize: 12, color: tk.text.faint, flex: 1 }}>This device</span>
        </div>
        <div style={{ ...cardStyle(tk), overflow: 'hidden' }}>
          <div data-setting="shader-studio:settings:storageLimit" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: compact ? '9px 6px 9px 12px' : '8px 10px 8px 14px' }}>
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
              <span style={{ font: `600 12.5px ${fontFamily.ui}`, color: tk.text.primary }}>Storage limit</span>
              <span style={{ fontSize: 11.5, color: tk.text.muted }}>Saving, uploads and imports that would take this device past {limitLabel(limit)} are refused; removing things never is. Saved work, images, videos, sounds{isTauri() ? ' and the workspace folder' : ''} count.{limit !== DEFAULT_STORAGE_LIMIT ? ` The default is ${limitLabel(DEFAULT_STORAGE_LIMIT)}.` : ''}</span>
            </div>
            <StorageLimitControl />
          </div>
        </div>
      </section>

      <AutosaveSettings />
      <BackgroundSettings compact={compact} />
      <TrackerModelsSettings />
      <ExplanationModelSettings />

      <section aria-label="Image model" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 4px', minHeight: 28 }}>
          <span style={{ font: `650 13px ${fontFamily.ui}`, color: tk.text.primary }}>Image model</span>
          <span style={{ fontSize: 12, color: tk.text.faint, flex: 1 }}>This device</span>
        </div>
        <div style={{ ...cardStyle(tk), overflow: 'hidden' }}>
          <div data-setting="shader-studio:settings:useImageModel" style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: compact ? '9px 6px 9px 12px' : '8px 10px 8px 14px' }}>
            <ImageModelSetting compact />
          </div>
        </div>
      </section>

      {cats.map(c => {
        const open = !closed.has(c.id);
        return (
          <section key={c.id} aria-label={c.label} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <button type="button" aria-expanded={open} onClick={() => setClosed(s => { const n = new Set(s); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; })}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 4px', minHeight: 28, border: 0, background: 'none', cursor: 'pointer', textAlign: 'left' }}>
              <Icon name={open ? 'chevD' : 'chevR'} size={12} style={{ color: tk.text.faint }} />
              <span style={{ font: `650 13px ${fontFamily.ui}`, color: tk.text.primary }}>{c.label}</span>
              <span style={{ fontSize: 12, color: tk.text.faint, flex: 1 }}>{plural(c.children?.length ?? 0, 'setting')}</span>
              <Size n={c.size} />
            </button>
            {open && (
              <div style={{ ...cardStyle(tk), overflow: 'hidden' }}>
                {(c.children ?? []).map((n, i) => (
                  <div key={n.id} data-setting={keyOf(n)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: compact ? '9px 6px 9px 12px' : '8px 10px 8px 14px', borderTop: i ? `1px solid ${tk.border.subtle}` : 0 }}>
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                      <span style={{ font: `600 12.5px ${fontFamily.ui}`, color: tk.text.primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.label}</span>
                      {n.detail && <span style={{ fontSize: 11.5, color: tk.text.muted }}>{n.detail}</span>}
                    </div>
                    <Size n={n.size} style={{ width: compact ? undefined : 64, textAlign: 'right' }} />
                    {compact
                      ? <IconButton icon="reset" size="sm" label={`Reset ${n.label} to default`} tooltip={false} onClick={() => { void resetOne(n); }} />
                      : <Button size="sm" variant="ghost" icon="reset" onClick={() => { void resetOne(n); }} title="Back to the default (you can undo it)">Reset to default</Button>}
                  </div>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
