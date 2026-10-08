/**
 * Explanation model in App settings (docs/explain-model.md): the optional on-device language model behind
 * "Explain more": whether it is on, downloaded, loaded, its size, backend and speed, a one-time download
 * with progress, and a way to remove it. Nothing downloads until the button is pressed; nothing is sent
 * anywhere once it has.
 */
import type { ReactNode } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily } from '../../theme/tokens';
import { Button } from '../ui/Button';
import { Toggle } from '../ui/Choice';
import { askConfirm } from '../ui/dialogStore';
import { EXPLAIN_MODEL, downloadBytes, formatBytes } from '../../explainModel/config';
import { downloadExplainModel, ensureExplainModel, explainModelUsable, removeExplainModel, setExplainModelEnabled, useExplainModel } from '../../explainModel/client';
import { cardStyle } from './fileUiShared';

function Pill({ children, tone = 'muted', title }: { children: ReactNode; tone?: 'muted' | 'good' | 'bad' | 'accent'; title?: string }) {
  const tk = useTokens();
  const c = tone === 'good' ? tk.status.success : tone === 'bad' ? tk.status.danger : tone === 'accent' ? tk.accent.base : tk.text.muted;
  return <span title={title} style={{ display: 'inline-flex', alignItems: 'center', font: `500 11px ${fontFamily.ui}`, padding: '2px 8px', borderRadius: 999, background: alpha(c, 0.1), color: c, whiteSpace: 'nowrap' }}>{children}</span>;
}

export function ExplanationModelSettings() {
  const tk = useTokens();
  const s = useExplainModel();
  const usable = explainModelUsable(s);
  const muted = { fontSize: 11.5, color: tk.text.muted, lineHeight: 1.45 } as const;
  const size = formatBytes(downloadBytes(s.backend ?? 'webgpu'));
  const loading = s.status === 'loading';
  const pct = s.progress ? Math.round((100 * s.progress.loaded) / Math.max(1, s.progress.total)) : null;

  const remove = async () => {
    const ok = await askConfirm('Remove the explanation model?', { message: `Deletes the ${size} this browser keeps. “Explain more” asks to download it again the next time.`, confirmLabel: 'Remove', danger: true });
    if (ok) await removeExplainModel();
  };

  return (
    <section aria-label="Explanation model" data-setting="shader-studio:settings:useExplainModel" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 4px', minHeight: 28 }}>
        <span style={{ font: `650 13px ${fontFamily.ui}`, color: tk.text.primary }}>Explanation model</span>
        <span style={{ fontSize: 12, color: tk.text.faint, flex: 1 }}>Optional · “Explain more” (docs/explain-model.md)</span>
      </div>
      <div style={{ ...cardStyle(tk), overflow: 'hidden' }}>
        <div data-explain-model-setting style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {!s.downloaded && !loading
              ? <Button size="sm" variant="primary" icon="import" onClick={() => { void downloadExplainModel(); }} data-explain-model-download>Download the explanation model ({size})</Button>
              : <Toggle checked={s.enabled} onChange={setExplainModelEnabled} label="Use the explanation model" />}
            {usable && s.status === 'idle' && <Button size="sm" variant="ghost" onClick={() => { void ensureExplainModel(); }}>Load it now</Button>}
            {s.status === 'error' && <Button size="sm" variant="ghost" icon="reset" onClick={() => { void ensureExplainModel(true); }}>Try again</Button>}
            {s.downloaded && !loading && <Button size="sm" variant="ghost" icon="trash" onClick={() => { void remove(); }}>Remove ({size})</Button>}
          </div>
          {loading && (
            <div data-explain-model-progress style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ flex: 1, maxWidth: 320, height: 6, borderRadius: 3, background: tk.bg.field, overflow: 'hidden' }}>
                <span style={{ display: 'block', height: '100%', width: `${pct ?? 100}%`, background: tk.accent.base, transition: 'width 120ms' }} />
              </span>
              <span style={muted}>{s.progress ? `${formatBytes(s.progress.loaded)} of ${formatBytes(s.progress.total)}` : 'Loading…'}</span>
            </div>
          )}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} data-explain-model-status>
            <Pill tone={s.status === 'ready' ? 'good' : s.status === 'error' ? 'bad' : 'muted'}>
              {s.status === 'ready' ? 'loaded' : loading ? (s.downloaded && !s.progress ? 'loading' : 'downloading') : s.status === 'error' ? 'failed' : usable ? 'loads when needed' : s.downloaded ? 'off' : 'not downloaded'}
            </Pill>
            <Pill title={EXPLAIN_MODEL.repo}>{EXPLAIN_MODEL.name} · {size}</Pill>
            <Pill>{EXPLAIN_MODEL.licence}</Pill>
            {s.backend && <Pill tone="accent">{s.backend === 'webgpu' ? 'WebGPU' : 'WebAssembly'}</Pill>}
            {s.loadMs != null && <Pill>loaded in {(s.loadMs / 1000).toFixed(1)} s</Pill>}
            {s.tokensPerSec != null && <Pill>{s.tokensPerSec} tokens a second</Pill>}
          </div>
          <span style={muted}>
            {s.downloaded
              ? 'Downloaded once; this browser keeps it.'
              : `A one-time download of ${size} from Hugging Face, only if you press the button; it isn’t part of the app.`}
            {' '}It adds an <strong>Explain more</strong> button under the explanations in Expression Blocks, Custom Functions, the GLSL page and the function cards: why a line is there and what it does to the picture, written by a small language model that runs on this device, told what the rule-based explainer already knows. It can be wrong. Your code is never sent anywhere.
          </span>
          {s.error && <span style={{ ...muted, color: tk.status.danger }}>{s.error}</span>}
        </div>
      </div>
    </section>
  );
}
