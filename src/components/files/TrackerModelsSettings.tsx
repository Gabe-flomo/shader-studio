/**
 * Tracking models in App settings (docs/tracking.md "Models"): whether the
 * hand, face and body models (and MediaPipe's WebAssembly) stay in this
 * browser's Cache Storage between reloads, how much that comes to, a way to
 * clear it, and which trackers warm up (load their model, not the camera)
 * when the app opens. On the desktop the models are bundled with the app, so
 * this shows that instead of the toggle and the size.
 */
import { useEffect, useState } from 'react';
import { useTokens } from '../../theme/themeStore';
import { fontFamily } from '../../theme/tokens';
import { Button } from '../ui/Button';
import { Toggle } from '../ui/Choice';
import { askConfirm } from '../ui/dialogStore';
import { TRACKER_NAMES } from '../../types/playTracking';
import type { TrackerKind } from '../../lib/handFeed';
import { clearModelCache, modelCacheSize, modelsBundled, sizeText, useTrackerCacheSettings } from '../../lib/trackerCache';
import { cardStyle } from './fileUiShared';

const KINDS: readonly TrackerKind[] = ['hands', 'face', 'pose'];

function Row({ label, detail, children, first }: { label: string; detail?: string; children?: React.ReactNode; first?: boolean }) {
  const tk = useTokens();
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px 8px 14px', borderTop: first ? 0 : `1px solid ${tk.border.subtle}` }}>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <span style={{ font: `600 12.5px ${fontFamily.ui}`, color: tk.text.primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        {detail && <span style={{ fontSize: 11.5, color: tk.text.muted }}>{detail}</span>}
      </div>
      {children}
    </div>
  );
}

/** A toggle row: the switch carries its own label (Toggle's accessible name), a hint below it. */
function ToggleRow({ label, detail, checked, onChange, first }: { label: string; detail?: string; checked: boolean; onChange: (v: boolean) => void; first?: boolean }) {
  const tk = useTokens();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '8px 10px 8px 14px', borderTop: first ? 0 : `1px solid ${tk.border.subtle}` }}>
      <Toggle checked={checked} onChange={onChange} label={label} />
      {detail && <span style={{ fontSize: 11.5, color: tk.text.muted, marginLeft: 37 }}>{detail}</span>}
    </div>
  );
}

export function TrackerModelsSettings() {
  const tk = useTokens();
  const bundled = modelsBundled();
  const keepModels = useTrackerCacheSettings(s => s.keepModels);
  const setKeepModels = useTrackerCacheSettings(s => s.setKeepModels);
  const warmup = useTrackerCacheSettings(s => s.warmup);
  const setWarmup = useTrackerCacheSettings(s => s.setWarmup);
  const [size, setSize] = useState<number | null>(null);
  const [clearing, setClearing] = useState(false);

  const refresh = () => { if (!bundled) void modelCacheSize().then(setSize); };
  useEffect(refresh, [bundled]);

  const clear = async () => {
    const ok = await askConfirm('Clear the tracking models?', { message: 'The hand, face and body models and MediaPipe’s WebAssembly, downloaded again the next time a tracker is enabled or a video is analysed.', confirmLabel: 'Clear', danger: true });
    if (!ok) return;
    setClearing(true);
    await clearModelCache();
    setSize(0);
    setClearing(false);
  };

  return (
    <section aria-label="Tracking models" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 4px', minHeight: 28 }}>
        <span style={{ font: `650 13px ${fontFamily.ui}`, color: tk.text.primary }}>Tracking models</span>
        <span style={{ fontSize: 12, color: tk.text.faint, flex: 1 }}>Hands, face and body (docs/tracking.md)</span>
      </div>
      <div style={{ ...cardStyle(tk), overflow: 'hidden' }}>
        {bundled ? (
          <Row first label="Keep tracking models on this device" detail="Bundled with the app: the models install with Playfield, so there’s nothing to download or clear.">
            <span style={{ fontSize: 11.5, color: tk.text.faint }}>Bundled with the app</span>
          </Row>
        ) : (
          <>
            <ToggleRow first label="Keep tracking models on this device" detail="Kept in this browser (Cache Storage) so a reload never refetches them; off downloads them fresh each time." checked={keepModels} onChange={setKeepModels} />
            <Row label="Clear models" detail={size === null ? 'Checking…' : `${sizeText(size)} cached in this browser`}>
              <Button size="sm" variant="ghost" icon="trash" disabled={clearing || !size} onClick={() => { void clear(); }}>{`Clear models${size ? ` (${sizeText(size)})` : ''}`}</Button>
            </Row>
          </>
        )}
        {KINDS.map(kind => (
          <ToggleRow key={kind} label={`Warm up ${TRACKER_NAMES[kind]} when the app opens`} detail={`Loads the ${TRACKER_NAMES[kind].toLowerCase()} model as soon as Playfield opens, without turning on the camera, so Enable is instant later.`} checked={warmup[kind]} onChange={v => setWarmup(kind, v)} />
        ))}
      </div>
    </section>
  );
}
