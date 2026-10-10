/**
 * AutosaveControls — autosave as versions in the top bar and the save menu
 * (files/versionAutosave.ts; docs/graph-series-plan.md, "Autosave").
 *
 * AutosaveIndicator sits by the name chip: "Autosave on · next in 3 min", flashing "Saved 2.4
 * automatically" after each autosave, or "Autosave paused" when a save failed.
 * AutosaveSection is the save menu's part: the switch, how often, and for how long.
 */
import { useEffect, useState } from 'react';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { useVersionAutosave } from '../../files/versionAutosaveApp';
import { AUTOSAVE_MINUTES, AUTOSAVE_SPANS, nextInLabel, type AutosaveSpan } from '../../files/versionAutosave';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Icon } from '../ui/Icon';
import { Select } from '../ui/Select';
import { Toggle } from '../ui/Choice';
import { Button } from '../ui/Button';

/** How long "Saved 2.4 automatically" shows. */
export const AUTOSAVE_FLASH_MS = 4000;

/** Re-render on a clock while `active`: every second near the end of a countdown, else every 15 s. */
function useNow(active: boolean, fast: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), fast ? 1000 : 15_000);
    return () => window.clearInterval(id);
  }, [active, fast]);
  return now;
}

/** The open graph's autosave status, when it is running (or paused) for that graph. */
function useOpenGraphAutosave() {
  const current = useNodeGraphStore(s => s.currentGraph);
  const status = useVersionAutosave(s => s.status);
  const mine = !!current && status.graph === current.name;
  return { current, status, mine };
}

export function AutosaveIndicator({ compact = false, onClick }: { compact?: boolean; onClick?: () => void }) {
  const tk = useTokens();
  const { status, mine } = useOpenGraphAutosave();
  const flashing = mine && !!status.last && Date.now() - status.last.at < AUTOSAVE_FLASH_MS;
  const soon = status.nextAt !== null && status.nextAt - Date.now() < 90_000;
  const now = useNow(mine && (status.on || flashing), soon || flashing);
  if (!mine || (!status.on && !status.paused && !flashing)) return null;
  const flash = !!status.last && now - status.last.at < AUTOSAVE_FLASH_MS;
  const next = nextInLabel(status.nextAt, now);
  const text = status.paused ? 'Autosave paused'
    : flash ? `Saved ${status.last!.label}${compact ? '' : ' automatically'}`
    : compact ? next.replace('next in ', '') : `Autosave on · ${next}`;
  const title = status.paused ? `Autosave paused: ${status.paused}` : `Autosave on: a new minor version ${next.replace('next ', '')} if the graph changed${status.until ? ` (until ${new Date(status.until).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })})` : ''}. Change it in the Save menu.`;
  const color = status.paused ? tk.status.warningText : flash ? tk.text.primary : tk.text.faint;
  return (
    <button
      type="button"
      title={title}
      aria-live="polite"
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5, height: 22, padding: '0 7px', marginLeft: 2, flexShrink: 0, whiteSpace: 'nowrap',
        border: 0, borderRadius: radius.sm, cursor: 'pointer', color, font: `500 11px ${fontFamily.ui}`,
        background: flash ? alpha(tk.status.success, 0.14) : status.paused ? alpha(tk.status.warning, 0.14) : 'transparent',
        transition: 'background 0.3s ease, color 0.3s ease',
      }}
    >
      <Icon name={status.paused ? 'pause' : flash ? 'check' : 'clock'} size={12} />
      {text}
    </button>
  );
}

export function AutosaveSection() {
  const tk = useTokens();
  const { current, status, mine } = useOpenGraphAutosave();
  const minutes = useVersionAutosave(s => s.minutes);
  const defaultOn = useVersionAutosave(s => s.defaultOn);
  const { setOn, setSpan, setMinutes, setDefaultOn, resume } = useVersionAutosave.getState();
  const now = useNow(mine && status.on, false);
  if (!current) {
    return <span style={{ color: tk.text.faint, fontSize: 11.5 }}>Autosave starts once the graph has a name.</span>;
  }
  const on = mine && status.on;
  const minuteOptions = [...new Set([...AUTOSAVE_MINUTES, minutes])].map(m => ({ value: String(m), label: m < 1 ? `${Math.round(m * 60)} s (dev)` : `Every ${m} min` }));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 8, borderTop: `1px solid ${tk.border.subtle}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Toggle checked={on} onChange={v => setOn(v)} label={<b style={{ fontSize: 12.5 }}>Autosave</b>} />
        <span style={{ flex: 1 }} />
        <span style={{ color: status.paused && mine ? tk.status.warningText : tk.text.faint, fontSize: 11 }}>
          {mine && status.paused ? 'Paused' : on ? nextInLabel(status.nextAt, now) : 'Off'}
        </span>
      </div>
      {mine && status.paused && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', color: tk.status.warningText, fontSize: 11.5, lineHeight: 1.45 }}>
          <span style={{ flex: 1 }}>Paused: the last autosave failed. {status.paused}</span>
          <Button size="sm" onClick={resume}>Resume</Button>
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <Select ariaLabel="How often autosave saves" height={28} value={String(minutes)} options={minuteOptions} onChange={v => setMinutes(Number(v))} />
        <Select ariaLabel="How long autosave runs" height={28} value={status.span} options={AUTOSAVE_SPANS.map(s => ({ value: s.id, label: s.label }))} onChange={v => setSpan(v as AutosaveSpan)} />
      </div>
      <span style={{ color: tk.text.faint, fontSize: 11.5, lineHeight: 1.45 }}>
        When “{current.name}” changed, it’s saved as the next minor version, noted “Autosave”. Older autosaves are the first to go when the series’ history is full.
      </span>
      <Toggle checked={defaultOn} onChange={setDefaultOn} label={<span style={{ fontSize: 11.5, color: tk.text.secondary }}>On for every saved graph I open</span>} />
    </div>
  );
}
