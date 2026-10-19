/**
 * BandRow.tsx — one band in the Audio Source window (docs/audio-tools.md "Bands"): what a performer touches on one
 * line, everything else folded under Fine-tune (its summary says what is set; open or folded is remembered per band on
 * this device), and the scope that shows why each hit fired.
 *
 *   colour · name · its range ("40–130 Hz": move it on the spectrum above) · What to catch (Kick, Snare, Hats, Notes,
 *   Custom band) · Sensitivity · Send a value (with its meter) · Send hits (with a blink on each) · remove
 *
 * Fine-tune: Band edges (Hz), Shortest gap between hits, Ignore quieter than (dBFS, with Learn noise), Track room noise,
 * Only (noisy / tonal), and what the Value sends with its smoothing and gain. Every number is a ruler slider whose chip
 * takes a typed value (typing past the end widens it); double-click puts back the preset's.
 *
 * The scope (drawBandScope): the onset function as a filled area with the line it must rise above (the recent mean +
 * δ), the band's loudness in dBFS with the silence gate and the room's noise floor, and a tick on the top edge for each
 * hit. Its caption counts hits per pass of the file (or per second, live) and says whether the band is quiet.
 */
import { useState, type CSSProperties } from 'react';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { AT_SCOPE_DB_FLOOR } from '../../play/kit/audioTools.js';
import {
  BAND_CATCHES, BAND_CHARACTERS, BAND_MAX_HZ, BAND_MIN_HZ, BAND_VALUE_FROM, presetDefaults,
  type AudioBandCharacter, type AudioBandPreset, type AudioBandSpec, type AudioBandValueFrom,
} from '../../lib/audioTools/bands';
import type { BandView } from '../../lib/audioTools/engine';
import type { AudioSourceKind } from '../../nodes/definitions/audioTools';
import { Select } from '../ui/Select';
import { Button } from '../ui/Button';
import { Segmented, Toggle } from '../ui/Choice';
import { RulerSlider } from '../ui/RulerSlider';
import { NumberInput } from '../NodeGraph/NumberInput';

const HIT_TICK = 'rgba(249,226,175,0.95)';
const SCOPE_BG = '#11111b';
const fmtHz = (hz: number) => (hz >= 1000 ? `${+(hz / 1000).toFixed(hz >= 10000 ? 0 : 1)}k` : `${Math.round(hz)}`);
/** "40–130 Hz", "6k–16k Hz". */
export const rangeLabel = (b: { lo: number; hi: number }) => `${fmtHz(b.lo)}–${fmtHz(b.hi)} Hz`;

// ── The scope ────────────────────────────────────────────────────────────────────────────────────────────────

const PAD = 4;
const yOf = (v: number, h: number) => PAD + (1 - Math.max(0, Math.min(1, v))) * (h - PAD * 2);

/** What the scope's caption says: hits per pass (a File) or per second (live), and whether the band is quiet. */
export function scopeCaption(b: AudioBandSpec, bv: BandView | null): string {
  if (!bv) return 'not running';
  const hits = !b.trigger ? '' : bv.perPass !== null
    ? `${bv.perPass} hit${bv.perPass === 1 ? '' : 's'} / pass`
    : `${(bv.recent / Math.max(0.5, bv.recentSeconds)).toFixed(1)} hits / s`;
  const state = bv.gateOpen ? 'listening' : 'quiet — gate closed';
  return hits ? `${hits} · ${state}` : state;
}

/**
 * One band's scope, oldest left: the onset function (filled, the band's colour) and the line it has to rise above
 * (white, dashed); the loudness in dBFS (grey) with the silence gate (dotted) and the noise floor (faint); a tick on
 * the top edge for each hit.
 */
export function drawBandScope(g: CanvasRenderingContext2D, w: number, h: number, b: AudioBandSpec, bv: BandView | null): void {
  g.fillStyle = SCOPE_BG; g.fillRect(0, 0, w, h);
  if (!bv) return;
  const sc = bv.scope, n = sc.vals.length, dx = w / (n - 1);
  const at = (arr: Float32Array | Uint8Array, k: number) => arr[(sc.at + k) % n];
  const path = (arr: Float32Array, close: boolean) => {
    g.beginPath();
    if (close) g.moveTo(0, h - PAD);
    for (let k = 0; k < n; k++) { const x = k * dx, y = yOf(at(arr, k), h); if (k || close) g.lineTo(x, y); else g.moveTo(x, y); }
    if (close) { g.lineTo(w, h - PAD); g.closePath(); }
  };
  // Loudness (dBFS), the gate and the noise floor: underneath.
  path(sc.noise, false); g.strokeStyle = 'rgba(205,214,244,0.16)'; g.lineWidth = 1; g.stroke();
  g.setLineDash([2, 3]); path(sc.gate, false); g.strokeStyle = 'rgba(205,214,244,0.5)'; g.stroke(); g.setLineDash([]);
  path(sc.db, false); g.strokeStyle = 'rgba(205,214,244,0.45)'; g.lineWidth = 1; g.stroke();
  if (b.trigger) {
    // The onset function, and the line it must clear.
    path(sc.vals, true); g.fillStyle = `${b.color}55`; g.fill();
    path(sc.vals, false); g.strokeStyle = b.color; g.lineWidth = 1.25; g.stroke();
    g.setLineDash([4, 3]); path(sc.line, false); g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 1; g.stroke(); g.setLineDash([]);
    g.fillStyle = HIT_TICK;
    for (let k = 0; k < n; k++) if (at(sc.hits, k)) g.fillRect(k * dx - 1, 0, 2, 9);
  }
}

/** The scope's legend, under it. */
function ScopeLegend({ b }: { b: AudioBandSpec }) {
  const tk = useTokens();
  const item: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 4 };
  const sw = (style: CSSProperties) => <span style={{ display: 'inline-block', width: 14, height: 0, ...style }} />;
  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', font: `500 10.5px ${fontFamily.ui}`, color: tk.text.faint }}>
      {b.trigger && <span style={item} title="How suddenly new sound arrives in the band (its onset strength)"><span style={{ display: 'inline-block', width: 12, height: 8, background: `${b.color}88`, borderTop: `1.5px solid ${b.color}` }} />new sound</span>}
      {b.trigger && <span style={item} title="A hit needs the new sound to rise above this line: the recent average, plus what Sensitivity asks for">{sw({ borderTop: '1.5px dashed rgba(255,255,255,0.75)' })}must rise above</span>}
      <span style={item} title={`How loud the band is, ${AT_SCOPE_DB_FLOOR} dBFS at the bottom to 0 dBFS at the top`}>{sw({ borderTop: '1.5px solid rgba(205,214,244,0.6)' })}loudness</span>
      <span style={item} title="Quieter than this, the band counts as silence: no hits, Value 0">{sw({ borderTop: '1.5px dotted rgba(205,214,244,0.7)' })}silence gate</span>
      {b.trigger && <span style={item} title="A hit"><span style={{ display: 'inline-block', width: 2, height: 9, background: HIT_TICK }} />hit</span>}
    </div>
  );
}

// ── Fine-tune: folded, remembered per band ───────────────────────────────────────────────────────────────────

const FOLD_KEY = 'pf.audioBand.fineTune';
function readOpen(id: string): boolean {
  try { return (JSON.parse(localStorage.getItem(FOLD_KEY) ?? '{}') as Record<string, boolean>)[id] === true; } catch { return false; }
}
function writeOpen(id: string, open: boolean): void {
  try {
    const m = JSON.parse(localStorage.getItem(FOLD_KEY) ?? '{}') as Record<string, boolean>;
    if (open) m[id] = true; else delete m[id];
    localStorage.setItem(FOLD_KEY, JSON.stringify(m));
  } catch { /* storage off: it just doesn't remember */ }
}

/** Fine-tune's one-line summary: only what differs from the preset, else "as the preset". */
export function fineTuneSummary(b: AudioBandSpec): string {
  const d = presetDefaults(b.preset), out: string[] = [];
  if (b.minInterval !== null) out.push(`gap ≥ ${Math.round(b.minInterval)} ms`);
  if (b.gateDb !== null) out.push(`quiet under ${Math.round(b.gateDb)} dBFS`);
  if (b.trackNoise !== null) out.push(`room noise ${b.trackNoise ? 'on' : 'off'}`);
  if (b.character !== 'auto') out.push(BAND_CHARACTERS.find(c => c.key === b.character)?.label.toLowerCase() ?? b.character);
  if (b.valueFrom !== 'level') out.push(`value: ${BAND_VALUE_FROM.find(v => v.key === b.valueFrom)?.label.toLowerCase()}`);
  if (b.preset !== 'custom' && (Math.round(b.lo) !== d.lo || Math.round(b.hi) !== d.hi)) out.push(`edges ${rangeLabel(b)}`);
  return out.length ? out.join(' · ') : 'as the preset';
}

// ── The row ──────────────────────────────────────────────────────────────────────────────────────────────────

export interface BandRowProps {
  b: AudioBandSpec;
  kind: AudioSourceKind;
  selected: boolean;
  onSelect: () => void;
  patch: (p: Partial<AudioBandSpec>, structural?: boolean) => void;
  remove: () => void;
  learnNoise: () => void;
  /** The canvases the window's draw loop fills: the Value meter, the hit blink, the scope. */
  meterRef: (c: HTMLCanvasElement | null) => void;
  blinkRef: (c: HTMLCanvasElement | null) => void;
  scopeRef: (c: HTMLCanvasElement | null) => void;
  /** The scope's caption (the draw loop writes it: scopeCaption). */
  captionRef: (e: HTMLSpanElement | null) => void;
}

export function BandRow({ b, kind, selected, onSelect, patch, remove, learnNoise, meterRef, blinkRef, scopeRef, captionRef }: BandRowProps) {
  const tk = useTokens();
  const [open, setOpen] = useState(() => readOpen(b.id));
  const d = presetDefaults(b.preset);
  const small: CSSProperties = { font: `500 11.5px ${fontFamily.ui}`, color: tk.text.muted };
  const hint: CSSProperties = { font: `400 10.5px ${fontFamily.ui}`, color: tk.text.faint };
  const sep = <span style={{ width: 1, alignSelf: 'stretch', background: tk.border.default }} />;
  const stop = (e: { stopPropagation(): void }) => e.stopPropagation();
  /** A Fine-tune setting: its plain label, a hint, and the control. */
  const setting = (label: string, help: string, control: React.ReactNode, key?: string) => (
    <div key={key ?? label} style={{ display: 'grid', gridTemplateColumns: '170px minmax(160px, 260px) 1fr', alignItems: 'center', gap: 10 }}>
      <span style={small} title={help}>{label}</span>
      <div onClick={stop}>{control}</div>
      <span style={hint}>{help}</span>
    </div>
  );
  const toggleOpen = () => { setOpen(o => { writeOpen(b.id, !o); return !o; }); };

  return (
    <div data-band-row={b.id} onClick={onSelect}
      style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 10px', borderRadius: radius.md, border: `1px solid ${selected ? b.color : tk.border.default}`, background: selected ? `${b.color}1f` : tk.bg.field }}>
      {/* The primary line: what to catch, how eagerly, what it sends. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <input type="color" value={b.color} onChange={e => patch({ color: e.target.value })} title="The band's colour" style={{ width: 22, height: 22, border: 0, padding: 0, background: 'none', cursor: 'pointer' }} />
        <input defaultValue={b.name} key={`${b.id}:${b.name}`} aria-label="Band name" title="The band's name: its outputs take it"
          onBlur={e => { const v = e.target.value.trim(); if (v && v !== b.name) patch({ name: v }, true); }}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          style={{ width: 92, font: `600 12px ${fontFamily.ui}`, color: tk.text.primary, background: 'transparent', border: `1px solid ${tk.border.default}`, borderRadius: radius.sm, padding: '2px 5px' }} />
        <button type="button" data-band-range={b.id} onClick={e => { stop(e); onSelect(); if (!open) toggleOpen(); }}
          title="The frequencies it listens to: drag its handle on the spectrum above, or set its edges under Fine-tune"
          style={{ font: `600 11.5px ${fontFamily.mono}`, color: tk.text.primary, background: `${b.color}26`, border: `1px solid ${b.color}88`, borderRadius: 999, padding: '2px 9px', cursor: 'pointer' }}>
          {rangeLabel(b)}
        </button>
        {sep}
        <label data-band-catch={b.id} style={{ display: 'flex', alignItems: 'center', gap: 6, ...small }} onClick={stop}
          title={BAND_CATCHES.find(c => c.key === b.preset)?.title}>
          What to catch
          <Select value={b.preset} ariaLabel="What to catch" height={24} style={{ minWidth: 120 }}
            options={BAND_CATCHES.map(c => ({ value: c.key, label: c.label, hint: c.title }))}
            onChange={v => {
              const p = v as AudioBandPreset, pd = presetDefaults(p);
              // A preset brings its own band (a Custom band keeps the one drawn).
              patch(p === 'custom' ? { preset: p } : { preset: p, lo: pd.lo, hi: pd.hi });
            }} />
        </label>
        <div data-band-sensitivity={b.id} style={{ display: 'flex', alignItems: 'center', gap: 6, ...small, opacity: b.trigger ? 1 : 0.45 }} onClick={stop}
          title="How eager it is: higher catches quieter hits too, lower only the clearest. 0.5 is the preset as tuned.">
          Sensitivity
          <div style={{ width: 150 }}>
            <RulerSlider ariaLabel="Sensitivity" value={b.sensitivity} min={0} max={1} step={0.01} hard defaultValue={0.5} disabled={!b.trigger}
              onChange={v => patch({ sensitivity: Math.max(0, Math.min(1, +v.toFixed(2))) })} />
          </div>
        </div>
        {sep}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }} onClick={stop}>
          <Toggle checked={b.value} onChange={c => patch(c || b.trigger ? { value: c } : { value: false, trigger: true }, true)} label="Send a value" />
          <canvas ref={meterRef} title="Its Value now: how loud the band is (0–1)" style={{ width: 54, height: 10, display: 'block', opacity: b.value ? 1 : 0.35 }} />
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }} onClick={stop}>
          <Toggle checked={b.trigger} onChange={c => patch(c || b.value ? { trigger: c } : { trigger: false, value: true }, true)} label="Send hits" />
          <canvas ref={blinkRef} title="Blinks on each hit" style={{ width: 12, height: 12, display: 'block', opacity: b.trigger ? 1 : 0.35 }} />
        </span>
        <span style={{ marginLeft: 'auto' }} />
        <Button size="sm" variant="ghost" onClick={e => { stop(e); remove(); }} title="Remove the band (and its outputs' wires)">✕</Button>
      </div>

      {/* The scope, its caption and legend. */}
      <canvas ref={scopeRef} data-trigger-scope={b.id}
        title={b.trigger ? 'Why it fires: new sound (filled) rising above its line (dashed) while the band is louder than its silence gate (dotted). A tick on top for each hit.' : 'How loud the band is, against its silence gate.'}
        style={{ width: '100%', height: 64, display: 'block', borderRadius: radius.sm }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <span ref={captionRef} data-scope-caption={b.id} style={{ font: `600 11px ${fontFamily.ui}`, color: tk.text.secondary }} />
        <ScopeLegend b={b} />
      </div>

      {/* Fine-tune, folded. */}
      <div>
        <button type="button" data-band-finetune={b.id} onClick={e => { stop(e); toggleOpen(); }} aria-expanded={open}
          style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 0, padding: 0, cursor: 'pointer', ...small }}>
          <span style={{ display: 'inline-block', width: 10, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 120ms' }}>▸</span>
          <span style={{ font: `600 11.5px ${fontFamily.ui}`, color: tk.text.secondary }}>Fine-tune</span>
          <span style={hint}>{fineTuneSummary(b)}</span>
        </button>
        {open && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 0 2px 16px' }} onClick={stop}>
            {setting('Band edges', 'The frequencies it listens to. Moving them makes it a band of your own within its preset.', (
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, ...small }}>
                <NumberInput value={Math.round(b.lo)} step={1} min={BAND_MIN_HZ} max={BAND_MAX_HZ} style={numStyle(tk)} onCommit={v => patch({ lo: Math.max(BAND_MIN_HZ, Math.min(v, b.hi - 1)) })} />
                to
                <NumberInput value={Math.round(b.hi)} step={1} min={BAND_MIN_HZ} max={BAND_MAX_HZ} style={numStyle(tk)} onCommit={v => patch({ hi: Math.min(BAND_MAX_HZ, Math.max(v, b.lo + 1)) })} />
                Hz
              </span>
            ))}
            {b.trigger && setting('Shortest gap between hits', `Milliseconds; ${d.minInterval} for this preset (double-click to put it back). Raise it if one drum fires twice, lower it for rolls.`, (
              <RulerSlider ariaLabel="Shortest gap between hits" value={b.minInterval ?? d.minInterval} min={10} max={300} step={1} defaultValue={d.minInterval}
                onChange={v => patch({ minInterval: Math.round(v) === d.minInterval ? null : Math.max(10, Math.round(v)) })} />
            ))}
            {setting('Ignore quieter than', `dBFS: under this the band is silence, no hits and Value 0 (${d.gateDb} for this preset). Learn noise sets it just over a quiet stretch.`, (
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ flex: 1 }}>
                  <RulerSlider ariaLabel="Ignore quieter than" value={b.gateDb ?? d.gateDb} min={-100} max={0} step={1} defaultValue={d.gateDb}
                    onChange={v => patch({ gateDb: Math.round(v) === d.gateDb ? null : Math.min(0, Math.round(v)) })} />
                </span>
                <Button size="sm" data-learn-noise onClick={learnNoise}
                  title={kind === 'file' ? 'Set it just over the band\'s noise in the selection (Drag: Select a quiet stretch)' : 'Set it just over the band\'s noise in the last two seconds: keep it quiet first'}>Learn noise</Button>
              </span>
            ))}
            {setting('Track room noise', 'Lifts the silence line to 10 dB over the noise it hears (a room, a hissy line). Auto: on for the Mic and Live tracks.', (
              <Segmented<'auto' | 'on' | 'off'> size="sm" fill ariaLabel="Track room noise" value={b.trackNoise === null ? 'auto' : b.trackNoise ? 'on' : 'off'}
                onChange={v => patch({ trackNoise: v === 'auto' ? null : v === 'on' })}
                options={[{ value: 'auto', label: 'Auto' }, { value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]} />
            ))}
            {b.trigger && setting('Only', BAND_CHARACTERS.find(c => c.key === b.character)?.title ?? '', (
              <Select value={b.character} ariaLabel="Only" height={24} options={BAND_CHARACTERS.map(c => ({ value: c.key, label: c.label, hint: c.title }))}
                onChange={v => patch({ character: v as AudioBandCharacter })} />
            ))}
            {b.trigger && (b.character === 'noisy' || b.character === 'tonal') && setting('Noisy at', 'Where noisy starts on the noisiness of what arrives just after a hit (0 a pure tone … 1 noise).', (
              <RulerSlider ariaLabel="Noisy at" value={b.charAt} min={0} max={1} step={0.01} hard defaultValue={0.3} onChange={v => patch({ charAt: Math.max(0, Math.min(1, +v.toFixed(2))) })} />
            ))}
            {b.value && setting('The value sends', BAND_VALUE_FROM.find(v => v.key === b.valueFrom)?.title ?? '', (
              <Select value={b.valueFrom} ariaLabel="The value sends" height={24} options={BAND_VALUE_FROM.map(v => ({ value: v.key, label: v.label, hint: v.title }))}
                onChange={v => patch({ valueFrom: v as AudioBandValueFrom })} />
            ))}
            {b.value && setting('Smoothing in', 'Milliseconds the Value takes to rise: 0 jumps at once, more makes it swell.', (
              <RulerSlider ariaLabel="Smoothing in" value={Math.round(b.attack * 1000)} min={0} max={500} step={1} defaultValue={5} onChange={v => patch({ attack: Math.max(0, v) / 1000 })} />
            ))}
            {b.value && setting('Smoothing out', 'Milliseconds the Value takes to fall back: longer leaves a tail after each hit.', (
              <RulerSlider ariaLabel="Smoothing out" value={Math.round(b.release * 1000)} min={0} max={2000} step={1} defaultValue={120} onChange={v => patch({ release: Math.max(0, v) / 1000 })} />
            ))}
            {b.value && setting('Value gain', 'Scales the Value (it stops at 1).', (
              <RulerSlider ariaLabel="Value gain" value={b.gain} min={0} max={4} step={0.05} defaultValue={1} onChange={v => patch({ gain: Math.max(0, v) })} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function numStyle(tk: ReturnType<typeof useTokens>): CSSProperties {
  return {
    width: 64, font: `500 11.5px ${fontFamily.mono}`, color: tk.text.primary, background: tk.bg.panel,
    border: `1px solid ${tk.border.default}`, borderRadius: radius.sm, padding: '2px 5px', boxSizing: 'border-box',
  };
}
