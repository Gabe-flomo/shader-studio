/**
 * Explanation models in App settings (docs/explain-model.md): the optional on-device language models behind
 * "Explain more". A list: each model with its size, licence, whether it thinks first, a download / remove button,
 * its status, and a radio for "use this one". Several can be downloaded; the active one is remembered; only one is
 * in memory at a time. Nothing downloads until a button is pressed; nothing is sent anywhere once it has.
 */
import type { ReactNode } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily } from '../../theme/tokens';
import { Button } from '../ui/Button';
import { Toggle } from '../ui/Choice';
import { askConfirm } from '../ui/dialogStore';
import { EXPLAIN_MODELS, LARGE_MODEL_BYTES, downloadBytes, formatBytes, type ExplainModelSpec } from '../../explainModel/config';
import { downloadExplainModel, ensureExplainModel, removeExplainModel, selectExplainModel, setExplainModelEnabled, useExplainModel } from '../../explainModel/client';
import { cardStyle } from './fileUiShared';

function Pill({ children, tone = 'muted', title }: { children: ReactNode; tone?: 'muted' | 'good' | 'bad' | 'accent' | 'warn'; title?: string }) {
  const tk = useTokens();
  const c = tone === 'good' ? tk.status.success : tone === 'bad' ? tk.status.danger : tone === 'warn' ? tk.status.warningText : tone === 'accent' ? tk.accent.base : tk.text.muted;
  return <span title={title} style={{ display: 'inline-flex', alignItems: 'center', font: `500 11px ${fontFamily.ui}`, padding: '2px 8px', borderRadius: 999, background: alpha(c, 0.1), color: c, whiteSpace: 'nowrap' }}>{children}</span>;
}

function ModelRow({ m, last }: { m: ExplainModelSpec; last: boolean }) {
  const tk = useTokens();
  const s = useExplainModel();
  const muted = { fontSize: 11.5, color: tk.text.muted, lineHeight: 1.45 } as const;
  const has = s.downloadedIds.includes(m.id);
  const active = s.activeId === m.id;
  const busy = s.busyId === m.id && s.status === 'loading';
  const size = formatBytes(downloadBytes(s.backend ?? 'webgpu', m));
  const pct = s.progress && busy ? Math.round((100 * s.progress.loaded) / Math.max(1, s.progress.total)) : null;
  const loaded = s.loadedId === m.id && s.status === 'ready';
  const big = m.large || downloadBytes('webgpu', m) > LARGE_MODEL_BYTES;
  const needsGpu = !m.weights.wasm;

  const remove = async () => {
    const ok = await askConfirm(`Remove ${m.name}?`, { message: `Deletes the ${size} this browser keeps. It can be downloaded again later.`, confirmLabel: 'Remove', danger: true });
    if (ok) await removeExplainModel(m.id);
  };
  const download = async () => {
    if (big) {
      const ok = await askConfirm(`Download ${m.name} (${size})?`, { message: 'This is a large model for a browser. It needs a lot of memory while it runs, and a computer with a good graphics card (WebGPU). If the page slows down or the model fails to load, remove it and use a smaller one.', confirmLabel: `Download ${size}` });
      if (!ok) return;
    }
    void downloadExplainModel(m.id);
  };

  return (
    <div data-explain-model-row={m.id} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 14px', borderBottom: last ? 'none' : `1px solid ${tk.border.subtle}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: has ? 'pointer' : 'default', opacity: has ? 1 : 0.6 }}>
          <input type="radio" name="explain-model" checked={active} disabled={!has} onChange={() => selectExplainModel(m.id)} aria-label={`Use ${m.name}`} data-explain-model-use={m.id} />
          <span style={{ font: `650 13px ${fontFamily.ui}`, color: tk.text.primary }}>{m.name}</span>
        </label>
        <Pill title={m.repo}>{size}</Pill>
        <Pill>{m.licence}</Pill>
        <Pill tone={m.thinks ? 'accent' : 'muted'} title={m.thinks ? 'Reasons in a hidden “thinking” pass before it answers: slower, better at maths' : 'Answers straight away'}>{m.thinks ? 'thinks first: yes' : 'thinks first: no'}</Pill>
        {needsGpu && <Pill tone="warn" title="This model has no WebAssembly build">needs WebGPU</Pill>}
        <span style={{ flex: 1 }} />
        <Pill tone={loaded ? 'good' : s.status === 'error' && has && active ? 'bad' : has ? 'accent' : 'muted'}>
          {busy ? (s.progress ? 'downloading' : 'loading') : loaded ? 'loaded' : s.status === 'error' && active ? 'failed' : has ? (active ? 'downloaded · in use' : 'downloaded') : 'not downloaded'}
        </Pill>
        {!has && !busy && <Button size="sm" variant="primary" icon="import" onClick={() => { void download(); }} data-explain-model-download={m.id}>Download</Button>}
        {has && !busy && <Button size="sm" variant="ghost" icon="trash" onClick={() => { void remove(); }}>Remove</Button>}
      </div>
      <span style={muted}>{m.note}{big ? ' Large for a browser: it needs a lot of memory.' : ''}</span>
      {busy && (
        <div data-explain-model-progress style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ flex: 1, maxWidth: 320, height: 6, borderRadius: 3, background: tk.bg.field, overflow: 'hidden' }}>
            <span style={{ display: 'block', height: '100%', width: `${pct ?? 100}%`, background: tk.accent.base, transition: 'width 120ms' }} />
          </span>
          <span style={muted}>{s.progress ? `${formatBytes(s.progress.loaded)} of ${formatBytes(s.progress.total)}` : 'Loading…'}</span>
        </div>
      )}
      {active && s.status === 'error' && s.error && <span style={{ ...muted, color: tk.status.danger }}>{s.error}</span>}
      {active && loaded && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {s.backend && <Pill tone="accent">{s.backend === 'webgpu' ? 'WebGPU' : 'WebAssembly'}</Pill>}
          {s.loadMs != null && <Pill>loaded in {(s.loadMs / 1000).toFixed(1)} s</Pill>}
          {s.tokensPerSec != null && <Pill>{s.tokensPerSec} tokens a second</Pill>}
        </div>
      )}
    </div>
  );
}

export function ExplanationModelSettings() {
  const tk = useTokens();
  const s = useExplainModel();
  const muted = { fontSize: 11.5, color: tk.text.muted, lineHeight: 1.45 } as const;
  const any = s.downloadedIds.length > 0;

  return (
    <section aria-label="Explanation model" data-setting="shader-studio:settings:useExplainModel" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 4px', minHeight: 28 }}>
        <span style={{ font: `650 13px ${fontFamily.ui}`, color: tk.text.primary }}>Explanation model</span>
        <span style={{ fontSize: 12, color: tk.text.faint, flex: 1 }}>Optional · “Explain more” (docs/explain-model.md)</span>
      </div>
      <div style={{ ...cardStyle(tk), overflow: 'hidden' }}>
        <div data-explain-model-setting style={{ display: 'flex', flexDirection: 'column' }}>
          {any && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '10px 14px', borderBottom: `1px solid ${tk.border.subtle}` }}>
              <Toggle checked={s.enabled} onChange={setExplainModelEnabled} label="Use the explanation model" />
              {s.enabled && s.downloaded && s.status === 'idle' && <Button size="sm" variant="ghost" onClick={() => { void ensureExplainModel(); }}>Load it now</Button>}
              {s.status === 'error' && <Button size="sm" variant="ghost" icon="reset" onClick={() => { void ensureExplainModel(true); }}>Try again</Button>}
            </div>
          )}
          <div data-explain-model-status>
            {EXPLAIN_MODELS.map((m, i) => <ModelRow key={m.id} m={m} last={i === EXPLAIN_MODELS.length - 1} />)}
          </div>
          <div style={{ padding: '8px 14px 10px', borderTop: `1px solid ${tk.border.subtle}` }}>
            <span style={muted}>
              Pick the one “Explain more” uses; download as many as you like to try them (a <strong>Compare models</strong> button then shows their answers side by side). Each is a one-time download from Hugging Face, only when you press its button; none is part of the app, and only one is held in memory at a time. They add an <strong>Explain more</strong> button under the explanations in Expression Blocks, Custom Functions, the GLSL page and the function cards: why a line is there and what it does to the picture, written by a small language model that runs on this device, told what the rule-based explainer already knows. Every answer carries a confidence dot, and a “not sure” tag when it should not be trusted. It can be wrong. Your code is never sent anywhere.
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
