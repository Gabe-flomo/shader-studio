/**
 * The Storage limit setting (files/storageLimit.ts): a list of presets, "No
 * limit", and "Other…" for a number of GB. Shown in the Files page's Space
 * area and in App settings; both read the same key.
 */
import { Select } from '../ui/Select';
import { askText } from '../ui/dialogStore';
import { GB, limitLabel, setStorageLimit, STORAGE_LIMIT_PRESETS } from '../../files/storageLimit';
import { useStorageLimit } from './useStorageLimit';

export function StorageLimitControl({ height = 26 }: { height?: number }) {
  const limit = useStorageLimit();
  const preset = STORAGE_LIMIT_PRESETS.some(p => p.bytes === limit);
  const options = [
    ...STORAGE_LIMIT_PRESETS.map(p => ({ value: String(p.bytes), label: p.label })),
    ...(preset ? [] : [{ value: String(limit), label: limitLabel(limit) }]),
    { value: 'other', label: 'Other…' },
  ];
  const pick = async (v: string) => {
    if (v !== 'other') { setStorageLimit(Number(v)); return; }
    const typed = await askText('Storage limit', { label: 'Gigabytes (0 for no limit)', initial: limit ? String(Math.round((limit / GB) * 10) / 10) : '0', confirmLabel: 'Set' });
    if (typed === null) return;
    const n = Number(typed.replace(',', '.'));
    if (!Number.isFinite(n) || n < 0) return;
    setStorageLimit(Math.round(n * GB));
  };
  return <Select ariaLabel="Storage limit" value={String(limit)} options={options} height={height} onChange={v => { void pick(v); }} />;
}
