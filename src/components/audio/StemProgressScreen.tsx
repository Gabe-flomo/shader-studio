/**
 * The screen that covers the app while a song is being separated (docs/stems.md): the picture is paused
 * (stemModel/job.ts holds the preview), and this says what is happening — the song, the step (download, segment n of
 * m, encoding a stem), a progress bar, the time so far and an estimate, where the model runs (WebGPU, or WebAssembly
 * and how many threads) — with Cancel. It mounts itself on the page the first time a run starts (mountStemProgress),
 * so it doesn't depend on which page or card started it.
 */
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { cancelStemJob, fmtDuration, jobFraction, jobRemaining, useStemJob, type StemJob } from '../../stemModel/job';
import { STEM_LABELS, formatStemBytes, stemModelById } from '../../stemModel/config';
import { useStemModels } from '../../stemModel/client';
import { Button } from '../ui/Button';

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** What the run is doing, in a line. */
export function stepLine(j: StemJob, download: { loaded: number; total: number } | null): string {
  const spec = stemModelById(j.model);
  switch (j.phase) {
    case 'decode': return 'Reading the song…';
    case 'load': {
      const p = download ?? (j.total ? { loaded: j.loaded, total: j.total } : null);
      return p && p.total ? `Downloading the model: ${formatStemBytes(p.loaded)} of ${formatStemBytes(p.total)} (once; the browser keeps it)` : 'Opening the model…';
    }
    case 'separate': {
      const n = Math.min(j.chunks, Math.floor(j.chunk) + 1);
      return `Separating: segment ${n} of ${j.chunks} (7.8 s each)`;
    }
    case 'encode': return `Making the stems small: ${STEM_LABELS[spec.stems[j.stem] ?? 'drums']} (${j.stem + 1} of ${j.stems})`;
    case 'save': return 'Keeping the stems in the library…';
  }
}

/** Where it runs, in words. */
export function backendLine(j: Pick<StemJob, 'backend' | 'threads'>): string {
  if (j.backend === 'webgpu') return 'Running on the GPU (WebGPU)';
  if (j.backend === 'wasm') return j.threads > 1 ? `Running on the CPU (WebAssembly, ${j.threads} threads)` : 'Running on the CPU (WebAssembly, one thread: slow; the desktop app uses more)';
  return 'Choosing the GPU or the CPU…';
}

export function StemProgressScreen() {
  const tk = useTokens();
  const job = useStemJob(s => s.job);
  const download = useStemModels(s => (job ? s.models[job.model]?.progress ?? null : null));
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (!job) return;
    const t = setInterval(() => setNow(performance.now()), 500);
    return () => clearInterval(t);
  }, [job]);
  if (!job) return null;
  const spec = stemModelById(job.model);
  const frac = job.phase === 'load' && download?.total ? 0.02 + 0.03 * (download.loaded / download.total) : jobFraction(job);
  const elapsed = Math.max(0, (now - job.startedAt) / 1000);
  const left = jobRemaining(job, now);
  return (
    <div data-stem-progress role="dialog" aria-modal="true" aria-label="Separating stems"
      style={{ position: 'fixed', inset: 0, zIndex: 10000, background: tk.bg.scrim, backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, boxSizing: 'border-box', font: `500 13px ${fontFamily.ui}` }}
      onKeyDown={e => { if (e.key === 'Escape') cancelStemJob(); e.stopPropagation(); }}>
      <div style={{ width: 'min(520px, 100%)', background: tk.bg.panel, color: tk.text.primary, borderRadius: radius.modal, border: `1px solid ${tk.border.default}`, boxShadow: '0 24px 60px rgba(0,0,0,0.35)', padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.06em', textTransform: 'uppercase', color: tk.text.faint }}>Separating stems · {spec.name}</span>
          <span data-stem-song style={{ font: `600 17px ${fontFamily.ui}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={job.song}>{job.song}</span>
          {job.seconds > 0 && <span style={{ color: tk.text.muted, fontSize: 12 }}>{clock(job.seconds)} long · {spec.stems.map(s => STEM_LABELS[s]).join(', ')}</span>}
        </div>
        <span data-stem-step style={{ color: tk.text.secondary }}>{stepLine(job, download)}</span>
        <div style={{ height: 8, borderRadius: 4, background: tk.bg.field, overflow: 'hidden' }} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(frac * 100)}>
          <div style={{ width: `${Math.round(frac * 1000) / 10}%`, height: '100%', background: tk.accent.base, transition: 'width 0.3s' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, color: tk.text.muted, fontSize: 12, flexWrap: 'wrap' }}>
          <span data-stem-time>{clock(elapsed)} so far{left !== null ? ` · about ${fmtDuration(left)} left` : ''}</span>
          <span data-stem-backend>{backendLine(job)}</span>
        </div>
        <span style={{ color: tk.text.faint, fontSize: 12, lineHeight: 1.45 }}>
          The picture is paused so the model has the GPU to itself; it plays again when the stems are ready. Everything runs on this device: nothing is sent anywhere.
        </span>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button onClick={cancelStemJob} data-stem-cancel autoFocus>Cancel</Button>
        </div>
      </div>
    </div>
  );
}

let mounted = false;
/** Put the screen on the page (once): it shows itself while a run goes. */
export function mountStemProgress(): void {
  if (mounted || typeof document === 'undefined') return;
  mounted = true;
  const el = document.createElement('div');
  el.setAttribute('data-stem-progress-root', '');
  document.body.appendChild(el);
  createRoot(el).render(<StemProgressScreen />);
}
