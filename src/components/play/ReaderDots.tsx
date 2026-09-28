/**
 * ReaderDots — the readers on a source card (a rack card, the Video card, the
 * Live audio chip): each dot's colour, name and live level, with a link to
 * the control group they show on (Controls → opens the Controls section and
 * highlights the group). Editing stays on the Audio readers panel.
 *
 * Also the reader meter and the levels hook the panel's rows use.
 */
import { useEffect, useState } from 'react';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import type { AudioReader, PlayRecord } from '../../types/play';
import { audioReaderBank } from '../../lib/audioReaderBank';
import { readerControlOf, readerGroupName } from '../../play/readerControls';
import { Button } from '../ui/Button';
import { usePlayUi } from './playUi';
import { useReadersPanel } from './readersPanelUi';

/** Readers' levels for meters, about 30 times a second (null while their input is off). */
export function useReaderLevels(readers: readonly AudioReader[]): Map<string, number | null> {
  const [v, setV] = useState<Map<string, number | null>>(() => new Map());
  useEffect(() => {
    if (!readers.length) { setV(prev => (prev.size ? new Map() : prev)); return; }
    let raf = 0, last = 0;
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (t - last < 33) return;
      last = t;
      audioReaderBank.update();
      setV(prev => {
        let changed = prev.size !== readers.length;
        const next = new Map<string, number | null>();
        for (const r of readers) {
          const x = audioReaderBank.value(r.id);
          const q = x === null ? null : Math.round(x * 100) / 100;
          next.set(r.id, q);
          if (prev.get(r.id) !== q) changed = true;
        }
        return changed ? next : prev;
      });
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [readers]);
  return v;
}

export const readerHex = (c: readonly number[]) => `#${c.slice(0, 3).map(v => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('')}`;

/** A reader's level now, with a tick at each threshold a trigger listens for. */
export function ReaderMeter({ level, thresholds, colour, height = 8 }: { level: number | null; thresholds: number[]; colour: string; height?: number }) {
  const tk = useTokens();
  const v = level ?? 0;
  const over = thresholds.some(t => v >= t);
  return (
    <div
      role="meter" aria-label="Level" aria-valuemin={0} aria-valuemax={1} aria-valuenow={level ?? undefined}
      title={thresholds.length ? `Level now; ticks: the thresholds triggers fire at (${thresholds.map(t => `${Math.round(t * 100)}%`).join(', ')})` : 'Level now'}
      style={{ position: 'relative', flex: 1, minWidth: 48, height, borderRadius: height / 2, background: tk.bg.field, overflow: 'hidden' }}
    >
      <div style={{ width: `${v * 100}%`, height: '100%', background: level === null ? tk.text.disabled : colour, opacity: over ? 1 : 0.8, transition: 'width 50ms linear' }} />
      {thresholds.map((t, i) => (
        <span key={i} style={{ position: 'absolute', top: 0, bottom: 0, left: `calc(${t * 100}% - 1px)`, width: 2, background: tk.text.primary, opacity: 0.55 }} />
      ))}
    </div>
  );
}

const NO_READERS: readonly AudioReader[] = [];

/**
 * The readers listening to `input` (the readers' input string: '' for live,
 * `engine:<rack>`, `video:<layer>`…), each with its live level. Nothing when
 * the readers listen elsewhere or there are none.
 */
export function ReaderDots({ play, input, compact = false }: { play: PlayRecord; input: string; compact?: boolean }) {
  const tk = useTokens();
  const cfg = play.audioReaders;
  const readers = cfg && cfg.input === input ? cfg.readers : NO_READERS;
  const levels = useReaderLevels(readers);
  if (!readers.length) return null;
  const fallback = readerGroupName(play);
  return (
    <div data-reader-dots={input || 'live'} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {readers.map(r => {
        const level = levels.get(r.id) ?? null;
        const pct = level === null ? null : Math.round(level * 100);
        const colour = readerHex(r.colour);
        const ctl = readerControlOf(play, r.id);
        const group = ctl?.group ?? fallback;
        return (
          <div key={r.id} role="listitem" style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, padding: '2px 4px', borderRadius: radius.sm }}>
            <button type="button" title="Edit on the Audio readers panel" onClick={() => useReadersPanel.getState().show({ focus: r.id })}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: 0, background: 'none', padding: 0, cursor: 'pointer', color: tk.text.primary, font: `500 11.5px ${fontFamily.ui}`, width: compact ? 96 : 120, minWidth: 0, flexShrink: 0 }}>
              <span aria-hidden style={{ width: 9, height: 9, borderRadius: 5, background: colour, flexShrink: 0 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
            </button>
            <ReaderMeter level={level} thresholds={[]} colour={colour} height={6} />
            <span style={{ width: 32, textAlign: 'right', font: `600 10.5px ${fontFamily.mono}`, color: pct === null ? tk.text.faint : tk.text.primary, flexShrink: 0 }}>{pct === null ? '–' : `${pct}%`}</span>
            {ctl && <Button size="sm" variant="ghost" onClick={() => usePlayUi.getState().revealControlGroup(group)} title={`Show its control in ${group}`} aria-label={`${r.name}: Controls`}>Controls →</Button>}
          </div>
        );
      })}
    </div>
  );
}
