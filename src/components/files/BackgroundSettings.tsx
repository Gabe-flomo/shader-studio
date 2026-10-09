/**
 * BackgroundSettings — App settings → Background (lib/backgroundPolicy.ts): what Playfield does
 * with the GPU while another window is in front, and whether a long-hidden tab gives its GPU
 * memory back.
 */
import { useState } from 'react';
import { useTokens } from '../../theme/themeStore';
import { fontFamily } from '../../theme/tokens';
import { Segmented, Toggle } from '../ui/Choice';
import { backgroundMode, releaseGpuWhenHidden, setBackgroundMode, setReleaseGpuWhenHidden, SLOW_FPS, type BackgroundMode, BACKGROUND_MODE_KEY, RELEASE_GPU_KEY } from '../../lib/backgroundPolicy';
import { cardStyle } from './fileUiShared';

export function BackgroundSettings({ compact = false }: { compact?: boolean }) {
  const tk = useTokens();
  const [mode, setMode] = useState<BackgroundMode>(backgroundMode());
  const [release, setRelease] = useState(releaseGpuWhenHidden());
  const row = { display: 'flex', alignItems: 'center', gap: 10, padding: compact ? '9px 6px 9px 12px' : '8px 10px 8px 14px' } as const;
  return (
    <section aria-label="Background" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 4px', minHeight: 28 }}>
        <span style={{ font: `650 13px ${fontFamily.ui}`, color: tk.text.primary }}>Background</span>
        <span style={{ fontSize: 12, color: tk.text.faint, flex: 1 }}>The GPU while you're elsewhere</span>
      </div>
      <div style={{ ...cardStyle(tk), overflow: 'hidden' }}>
        <div data-setting={BACKGROUND_MODE_KEY} style={{ ...row, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200, display: 'flex', flexDirection: 'column', gap: 1 }}>
            <span style={{ font: `600 12.5px ${fontFamily.ui}`, color: tk.text.primary }}>When another window is in front</span>
            <span style={{ fontSize: 11.5, color: tk.text.muted }}>
              A hidden tab never draws. While the tab still shows but you're in another app or window, Slow down draws about {SLOW_FPS} frames a second, Pause stops until you come back. An open output window or a recording always keeps full speed.
            </span>
          </div>
          <Segmented size="sm" ariaLabel="When another window is in front" value={mode}
            options={[{ value: 'slow', label: 'Slow down' }, { value: 'pause', label: 'Pause' }, { value: 'keep', label: 'Keep drawing' }]}
            onChange={v => { setBackgroundMode(v as BackgroundMode); setMode(v as BackgroundMode); }} />
        </div>
        <div data-setting={RELEASE_GPU_KEY} style={{ ...row, borderTop: `1px solid ${tk.border.subtle}` }}>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
            <span style={{ font: `600 12.5px ${fontFamily.ui}`, color: tk.text.primary }}>Free GPU memory when hidden</span>
            <span style={{ fontSize: 11.5, color: tk.text.muted }}>
              After 3 minutes in a hidden tab, Playfield gives its GPU memory back so other tabs and apps (Shadertoy, games) don't run short, and rebuilds when you return. Simulations and feedback start over then. Not while an output window or a recording is running.
            </span>
          </div>
          <Toggle checked={release} label={release ? 'On' : 'Off'} onChange={v => { setReleaseGpuWhenHidden(v); setRelease(v); }} />
        </div>
      </div>
    </section>
  );
}
