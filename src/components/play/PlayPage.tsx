/**
 * PlayPage — where a graph gets performed (docs/play-v1-plan.md, step 3).
 *
 * The node canvas is gone. What's left is the picture (the shared preview
 * canvas, kept mounted by App), the control panel (the params the author
 * exposed, in their order) and the mappings drawer (source → range, curve,
 * smoothing → control). Nothing here edits the graph: dragging a panel slider
 * is the same store write a Studio slider makes, and a mapping is a per-frame
 * uniform write on the input bus (lib/playEngine.ts).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import type { PlayControl, PlayMapping, PlayRecord, PlaySource } from '../../types/play';
import { CHANNELS, COLOUR_CHANNELS, CURVES, LFO_SHAPES, SOURCE_TYPES, TILT_AXES, keyName, sourceFromType, sourceLabel, sourceType, type SourceType } from '../../play/playSources';
import type { LfoShape } from '../../types/play';
import { playEngine, sampleCurve, type ControlValue } from '../../lib/playEngine';
import { PREVIEW_ASPECTS } from '../../utils/graphImportPlan';
import { midiEngine, midiNoteName } from '../../lib/midiEngine';
import {
  candidateLabel, collectPlayCandidates, controlExists, playId, readControlValue, targetParts, type PlayCandidate,
} from '../../play/playControls';
import { Button, IconButton } from '../ui/Button';
import { Segmented, Toggle } from '../ui/Choice';
import { Field } from '../ui/Field';
import { Icon } from '../ui/Icon';
import { Popover } from '../ui/Popover';
import { RulerSlider } from '../ui/RulerSlider';
import { Select } from '../ui/Select';
import { NumberInput } from '../NodeGraph/NumberInput';
import { reportFileResult } from '../shell/reportFileResult';

// ── Live values (polled, not per store write) ───────────────────────────────

/**
 * The engine's last written value per driven control, refreshed ~30 times a
 * second while anything is mapped. State only changes when a value does, so
 * an idle panel re-renders nothing.
 */
function useLiveValues(play: PlayRecord): Map<string, ControlValue> {
  const [values, setValues] = useState<Map<string, ControlValue>>(() => new Map());
  const anyMapped = play.mappings.some(m => m.enabled);
  useEffect(() => {
    if (!anyMapped) return;
    let raf = 0;
    let last = 0;
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (t - last < 33) return;
      last = t;
      setValues(prev => {
        let changed = false;
        const next = new Map<string, ControlValue>();
        for (const c of play.controls) {
          const v = playEngine.liveValue(c.id);
          if (v === undefined) continue;
          const copy = Array.isArray(v) ? [v[0], v[1], v[2]] : v;
          next.set(c.id, copy);
          const p = prev.get(c.id);
          if (p === undefined || (Array.isArray(copy) ? !Array.isArray(p) || p.some((x, i) => x !== copy[i]) : p !== copy)) changed = true;
        }
        if (next.size !== prev.size) changed = true;
        return changed ? next : prev;
      });
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [anyMapped, play.controls]);
  return anyMapped ? values : EMPTY_VALUES;
}

const EMPTY_VALUES: Map<string, ControlValue> = new Map();
const EMPTY_METERS: Map<string, number> = new Map();

/** A source's raw unit reading, polled for the drawer's meters. */
function useSourceMeter(mappings: PlayMapping[]): Map<string, number> {
  const [values, setValues] = useState<Map<string, number>>(() => new Map());
  useEffect(() => {
    if (mappings.length === 0) return;
    let raf = 0;
    let last = 0;
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (t - last < 50) return;
      last = t;
      setValues(prev => {
        let changed = prev.size !== mappings.length;
        const next = new Map<string, number>();
        for (const m of mappings) {
          const v = Math.round((playEngine.readSource(m.source) ?? 0) * 100) / 100;
          next.set(m.id, v);
          if (prev.get(m.id) !== v) changed = true;
        }
        return changed ? next : prev;
      });
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [mappings]);
  return mappings.length === 0 ? EMPTY_METERS : values;
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function PlayPage({ compact = false }: { compact?: boolean }) {
  const tk = useTokens();
  const play = useNodeGraphStore(s => s.play);
  const setPlay = useNodeGraphStore(s => s.setPlay);
  const nodes = useNodeGraphStore(s => s.nodes);
  const paramBindings = useNodeGraphStore(s => s.paramBindings);
  const updateNodeParams = useNodeGraphStore(s => s.updateNodeParams);
  const exportPlayFile = useNodeGraphStore(s => s.exportPlayFile);
  const previewAspect = useNodeGraphStore(s => s.previewAspect);
  const setPreviewAspect = useNodeGraphStore(s => s.setPreviewAspect);
  const importGraphFromFile = useNodeGraphStore(s => s.importGraphFromFile);

  // Mouse and keyboard sources listen only while this page shows.
  useEffect(() => {
    playEngine.setPerforming(true);
    return () => playEngine.setPerforming(false);
  }, []);
  // A MIDI mapping needs the browser's MIDI access; ask once the page is open.
  useEffect(() => {
    if (play.mappings.some(m => m.source.kind === 'midi')) void midiEngine.connectWebMidi();
  }, [play.mappings]);

  const liveValues = useLiveValues(play);
  const candidates = useMemo(() => collectPlayCandidates(nodes, paramBindings), [nodes, paramBindings]);

  const writeControl = useCallback((control: PlayControl, value: number | number[]) => {
    const { nodeId, paramKey } = targetParts(control.target);
    updateNodeParams(nodeId, { [paramKey]: value }, { immediate: true });
  }, [updateNodeParams]);

  const update = useCallback((fn: (p: PlayRecord) => PlayRecord) => setPlay(fn), [setPlay]);

  const addControl = useCallback((c: PlayCandidate) => {
    update(p => ({
      ...p,
      controls: [...p.controls, {
        id: playId('ctl'), target: c.target, kind: c.kind, label: candidateLabel(c),
        min: c.min, max: c.max, ...(c.step ? { step: c.step } : {}),
      }],
    }));
  }, [update]);

  const addMapping = useCallback((source: PlaySource, controlId?: string) => {
    update(p => {
      const control = p.controls.find(c => c.id === controlId) ?? p.controls[0];
      if (!control) return p;
      return {
        ...p,
        mappings: [...p.mappings, {
          id: playId('map'), controlId: control.id, source,
          outMin: control.min, outMax: control.max, curve: 'linear', smoothMs: 30, enabled: true,
        }],
      };
    });
  }, [update]);

  const [drawerOpen, setDrawerOpen] = useState(true);
  // Audio Input nodes a mapping can read a band from.
  const audioNodes = useMemo<AudioNodeOption[]>(() => nodes.filter(n => n.type === 'audioInput').map(n => ({
    id: n.id,
    label: (typeof n.params.label === 'string' && n.params.label.trim()) || 'Audio Input',
    bands: Array.isArray(n.params._bands) ? Math.max(1, n.params._bands.length) : 1,
  })), [nodes]);

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: tk.bg.subtle, color: tk.text.primary, font: `12.5px ${fontFamily.ui}` }}>
      <PanelHeader
        title="Controls"
        hint={play.controls.length === 0 ? undefined : `${play.controls.length}`}
        extra={(
          <>
            <IconButton icon="import" label="Import a play file (a graph with its Play panel and mappings)" onClick={async () => { reportFileResult(await importGraphFromFile(), { failTitle: 'Couldn’t import that file' }); }} />
            <IconButton icon="export" label="Export a play file: the graph, the panel and the mappings, exactly as they are now" disabled={play.controls.length === 0} onClick={async () => { reportFileResult(await exportPlayFile(), { failTitle: 'Couldn’t export the play file', success: 'Play file exported' }); }} />
            <AddControlButton candidates={candidates} taken={new Set(play.controls.map(c => c.target))} onAdd={addControl} />
          </>
        )}
      />
      {/* The picture's shape: the same setting the export dialog uses, so what you see is what you export. */}
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderBottom: `1px solid ${tk.border.subtle}`, background: tk.bg.panel }}>
        <span style={{ color: tk.text.faint, font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Canvas</span>
        <Select ariaLabel="Canvas shape" value={previewAspect} options={PREVIEW_ASPECTS.map(a => ({ value: a.id, label: a.id === 'free' ? 'Free (fill the panel)' : `${a.label} · ${a.hint}` }))} onChange={v => setPreviewAspect(v as typeof previewAspect)} height={26} style={{ flex: 1, minWidth: 0 }} />
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '6px 12px 12px' }}>
        {play.controls.length === 0 ? (
          <EmptyState
            title="No controls yet"
            body={candidates.length === 0
              ? 'Add a node with a slider or a colour in the Studio first. Any live slider can be a control.'
              : 'Pick sliders and colours from the graph to build your panel. Then map MIDI, the mouse or keys onto them below.'}
          />
        ) : play.controls.map((c, i) => (
          <ControlRow
            key={c.id}
            control={c}
            index={i}
            count={play.controls.length}
            exists={controlExists(nodes, c)}
            value={readControlValue(nodes, c.target)}
            live={liveValues.get(c.id)}
            drivenBy={play.mappings.filter(m => m.enabled && m.controlId === c.id).map(m => sourceLabel(m.source, play.controls))}
            touch={compact}
            onChange={v => writeControl(c, v)}
            onRename={label => update(p => ({ ...p, controls: p.controls.map(x => x.id === c.id ? { ...x, label } : x) }))}
            onRange={(min, max) => update(p => ({ ...p, controls: p.controls.map(x => x.id === c.id ? { ...x, min, max } : x) }))}
            onMove={dir => update(p => {
              const j = i + dir;
              if (j < 0 || j >= p.controls.length) return p;
              const controls = [...p.controls];
              [controls[i], controls[j]] = [controls[j], controls[i]];
              return { ...p, controls };
            })}
            onRemove={() => update(p => ({ ...p, controls: p.controls.filter(x => x.id !== c.id), mappings: p.mappings.filter(m => m.controlId !== c.id) }))}
          />
        ))}
      </div>

      <MappingsDrawer
        play={play}
        open={drawerOpen}
        onToggle={() => setDrawerOpen(o => !o)}
        onAdd={addMapping}
        onUpdate={(id, patch) => update(p => ({ ...p, mappings: p.mappings.map(m => m.id === id ? { ...m, ...patch } : m) }))}
        onRemove={id => update(p => ({ ...p, mappings: p.mappings.filter(m => m.id !== id) }))}
        compact={compact}
        audioNodes={audioNodes}
      />
    </div>
  );
}

// ── Header + empty state ─────────────────────────────────────────────────────

function PanelHeader({ title, hint, extra, onClick, chevron }: { title: string; hint?: string; extra?: ReactNode; onClick?: () => void; chevron?: 'up' | 'down' }) {
  const tk = useTokens();
  return (
    <div
      onClick={onClick}
      style={{
        height: 44, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '0 8px 0 14px',
        borderBottom: `1px solid ${tk.border.default}`, background: tk.bg.panel, cursor: onClick ? 'pointer' : 'default', userSelect: 'none',
      }}
    >
      {chevron && <Icon name={chevron === 'up' ? 'chevU' : 'chevD'} size={14} style={{ color: tk.text.faint }} />}
      <span style={{ font: `650 13px ${fontFamily.ui}` }}>{title}</span>
      {hint && <span style={{ color: tk.text.faint, font: `500 11.5px ${fontFamily.mono}` }}>{hint}</span>}
      <span style={{ flex: 1 }} />
      <span onClick={e => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>{extra}</span>
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  const tk = useTokens();
  return (
    <div style={{ margin: '18px 4px', padding: '16px 14px', borderRadius: radius.lg, border: `1px dashed ${tk.border.strong}`, color: tk.text.muted, lineHeight: 1.5 }}>
      <div style={{ font: `600 12.5px ${fontFamily.ui}`, color: tk.text.secondary, marginBottom: 4 }}>{title}</div>
      {body}
    </div>
  );
}

// ── Add control ──────────────────────────────────────────────────────────────

function AddControlButton({ candidates, taken, onAdd }: { candidates: PlayCandidate[]; taken: Set<string>; onAdd: (c: PlayCandidate) => void }) {
  const tk = useTokens();
  const anchor = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const shown = candidates.filter(c => !taken.has(c.target) && (!q || candidateLabel(c).toLowerCase().includes(q)));
  return (
    <span ref={anchor} style={{ display: 'inline-flex' }}>
      <Button size="sm" icon="plus" onClick={() => setOpen(o => !o)} disabled={candidates.length === 0}>Add control</Button>
      {open && (
        <Popover anchorRef={anchor} onClose={() => { setOpen(false); setQuery(''); }} align="end" width={300} padding={8}>
          <Field autoFocus placeholder="Search sliders and colours" value={query} onChange={e => setQuery(e.target.value)} height={30} leading={<Icon name="search" size={14} style={{ color: tk.text.faint }} />} />
          <div style={{ maxHeight: 360, overflowY: 'auto', marginTop: 6 }}>
            {shown.length === 0 ? (
              <div style={{ padding: '10px 8px', color: tk.text.faint }}>{candidates.length === 0 ? 'Nothing in the graph can be a control.' : taken.size === candidates.length ? 'Every slider is already on the panel.' : 'No match.'}</div>
            ) : shown.map(c => (
              <button
                key={c.target}
                type="button"
                onClick={() => { onAdd(c); setOpen(false); setQuery(''); }}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 8, height: 32, padding: '0 8px', border: 0, borderRadius: radius.md,
                  background: 'none', cursor: 'pointer', color: tk.text.primary, font: `12.5px ${fontFamily.ui}`, textAlign: 'left',
                }}
                onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.background = tk.bg.hover)}
                onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.background = 'none')}
              >
                {c.kind === 'color'
                  ? <span style={{ width: 12, height: 12, borderRadius: 3, background: `rgb(${(c.value as number[]).map(v => Math.round(v * 255)).join(',')})`, boxShadow: `inset 0 0 0 1px ${alpha('#000', 0.12)}`, flexShrink: 0 }} />
                  : <Icon name="curve" size={13} style={{ color: tk.text.faint }} />}
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{candidateLabel(c)}</span>
              </button>
            ))}
          </div>
        </Popover>
      )}
    </span>
  );
}

// ── Control row ──────────────────────────────────────────────────────────────

function ControlRow({ control, index, count, exists, value, live, drivenBy, touch, onChange, onRename, onRange, onMove, onRemove }: {
  control: PlayControl;
  index: number;
  count: number;
  exists: boolean;
  value: number | number[] | undefined;
  live: ControlValue | undefined;
  drivenBy: string[];
  touch: boolean;
  onChange: (v: number | number[]) => void;
  onRename: (label: string) => void;
  onRange: (min: number, max: number) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  const tk = useTokens();
  const [hover, setHover] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(control.label);
  const driven = drivenBy.length > 0;
  const commitLabel = () => { setEditing(false); const t = draft.trim(); if (t && t !== control.label) onRename(t); else setDraft(control.label); };

  const shown = driven && live !== undefined ? live : value;
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        padding: '10px 10px 10px 12px', marginTop: 6, borderRadius: radius.card, background: tk.bg.panel,
        boxShadow: `inset 0 0 0 1px ${driven ? alpha(tk.accent.base, 0.45) : tk.border.default}`, opacity: exists ? 1 : 0.6,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 26, marginBottom: 6 }}>
        {editing ? (
          <Field autoFocus value={draft} onChange={e => setDraft(e.target.value)} onBlur={commitLabel} onKeyDown={e => { if (e.key === 'Enter') commitLabel(); if (e.key === 'Escape') { setDraft(control.label); setEditing(false); } }} height={26} style={{ flex: 1 }} />
        ) : (
          <button
            type="button"
            title="Rename"
            onClick={() => { setDraft(control.label); setEditing(true); }}
            style={{ flex: 1, minWidth: 0, textAlign: 'left', border: 0, background: 'none', padding: 0, cursor: 'text', color: tk.text.primary, font: `600 12.5px ${fontFamily.ui}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >{control.label}</button>
        )}
        {driven && (
          <span title={drivenBy.join(', ')} style={{ height: 20, padding: '0 7px', borderRadius: 6, display: 'inline-flex', alignItems: 'center', gap: 4, background: alpha(tk.accent.base, 0.12), color: tk.accent.text, font: `600 10.5px ${fontFamily.ui}`, whiteSpace: 'nowrap' }}>
            <Icon name="bidir" size={11} />{drivenBy[0]}{drivenBy.length > 1 ? ` +${drivenBy.length - 1}` : ''}
          </span>
        )}
        {!exists && <span style={{ color: tk.status.warningText, font: `600 10.5px ${fontFamily.ui}` }}>node missing</span>}
        <span style={{ display: 'flex', gap: 0, visibility: hover || touch ? 'visible' : 'hidden' }}>
          <IconButton icon="chevU" label="Move up" size="sm" disabled={index === 0} tooltip={false} onClick={() => onMove(-1)} />
          <IconButton icon="chevD" label="Move down" size="sm" disabled={index === count - 1} tooltip={false} onClick={() => onMove(1)} />
          <IconButton icon="trash" label="Remove from panel" size="sm" tone="danger" tooltip={false} onClick={onRemove} />
        </span>
      </div>
      {control.kind === 'color' ? (
        <ColourPad value={Array.isArray(shown) ? shown : [0, 0, 0]} disabled={!exists || driven} onChange={onChange} />
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <RulerSlider
              value={typeof shown === 'number' ? shown : control.min}
              min={control.min}
              max={control.max}
              step={control.step ?? 0.01}
              defaultValue={typeof value === 'number' ? value : (control.min + control.max) / 2}
              disabled={!exists || driven}
              onChange={onChange}
              onType={onChange}
              ariaLabel={control.label}
              touch={touch}
            />
          </div>
          {hover && !touch && <RangeEditor min={control.min} max={control.max} onRange={onRange} />}
        </div>
      )}
    </div>
  );
}

function RangeEditor({ min, max, onRange }: { min: number; max: number; onRange: (min: number, max: number) => void }) {
  const tk = useTokens();
  const numStyle = { width: 46, height: 22, borderRadius: 5, border: 0, background: tk.bg.field, color: tk.text.muted, font: `500 10.5px ${fontFamily.mono}`, textAlign: 'center' as const };
  return (
    <span title="Slider range" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
      <NumberInput value={min} onCommit={n => { if (n < max) onRange(n, max); }} style={numStyle} title="Minimum" />
      <span style={{ color: tk.text.faint, fontSize: 10 }}>–</span>
      <NumberInput value={max} onCommit={n => { if (n > min) onRange(min, n); }} style={numStyle} title="Maximum" />
    </span>
  );
}

function ColourPad({ value, disabled, onChange }: { value: number[]; disabled: boolean; onChange: (v: number[]) => void }) {
  const tk = useTokens();
  const toHex = (v: number) => Math.round(Math.max(0, Math.min(1, v ?? 0)) * 255).toString(16).padStart(2, '0');
  const hex = `#${toHex(value[0])}${toHex(value[1])}${toHex(value[2])}`;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <label style={{
        position: 'relative', flex: 1, height: 34, borderRadius: radius.md, cursor: disabled ? 'default' : 'pointer',
        background: hex, boxShadow: `inset 0 0 0 1px ${alpha('#000000', 0.12)}`, opacity: disabled ? 0.8 : 1,
      }}>
        <input
          type="color"
          aria-label="Colour"
          value={hex}
          disabled={disabled}
          onChange={e => {
            const h = e.target.value;
            onChange([parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255]);
          }}
          style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'inherit' }}
        />
      </label>
      <span style={{ font: `500 12px ${fontFamily.mono}`, color: tk.text.muted, width: 64 }}>{hex}</span>
    </div>
  );
}

// ── Mappings drawer ──────────────────────────────────────────────────────────

interface AudioNodeOption { id: string; label: string; bands: number }

function MappingsDrawer({ play, open, onToggle, onAdd, onUpdate, onRemove, compact, audioNodes }: {
  play: PlayRecord;
  open: boolean;
  onToggle: () => void;
  onAdd: (source: PlaySource, controlId?: string) => void;
  onUpdate: (id: string, patch: Partial<PlayMapping>) => void;
  onRemove: (id: string) => void;
  compact: boolean;
  audioNodes: AudioNodeOption[];
}) {
  const tk = useTokens();
  const meters = useSourceMeter(open ? play.mappings : EMPTY_MAPPINGS);
  // Learn: the next knob, key or MIDI note becomes a source. `learnFor` is a
  // mapping id (replace its source) or 'new' (add a mapping).
  const [learnFor, setLearnFor] = useState<string | null>(null);
  useEffect(() => {
    if (!learnFor) return;
    void midiEngine.connectWebMidi();
    const stop = playEngine.startLearn(source => {
      if (learnFor === 'new') onAdd(source);
      else onUpdate(learnFor, { source });
      setLearnFor(null);
    });
    return stop;
  }, [learnFor, onAdd, onUpdate]);
  useEffect(() => {
    if (!learnFor) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setLearnFor(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [learnFor]);

  const noControls = play.controls.length === 0;
  const midi = midiEngine.webMidi();
  // Collapsed rows show one line: source → control, the meter and the switch. UI state only.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const toggleRow = (id: string) => setCollapsed(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const allCollapsed = play.mappings.length > 0 && play.mappings.every(m => collapsed.has(m.id));

  return (
    <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', maxHeight: open ? (compact ? '55%' : '50%') : undefined, borderTop: `1px solid ${tk.border.default}` }}>
      <PanelHeader
        title="Mappings"
        hint={play.mappings.length ? `${play.mappings.length}` : undefined}
        chevron={open ? 'down' : 'up'}
        onClick={onToggle}
        extra={open && (
          <>
            {play.mappings.length > 1 && (
              <IconButton
                icon={allCollapsed ? 'chevD' : 'chevU'}
                label={allCollapsed ? 'Expand all mappings' : 'Collapse all mappings'}
                onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(play.mappings.map(m => m.id)))}
              />
            )}
            <Button size="sm" icon="spark" variant={learnFor === 'new' ? 'primary' : 'secondary'} disabled={noControls} onClick={() => setLearnFor(l => (l === 'new' ? null : 'new'))}>
              {learnFor === 'new' ? 'Listening…' : 'Learn'}
            </Button>
            <Button size="sm" icon="plus" disabled={noControls} onClick={() => onAdd({ kind: 'midi', signal: 'cc', channel: 0, cc: 1 })}>Add</Button>
          </>
        )}
      />
      {open && (
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '6px 12px 12px' }}>
          {learnFor && (
            <div style={{ margin: '6px 0 2px', padding: '8px 12px', borderRadius: radius.md, background: alpha(tk.accent.base, 0.1), color: tk.accent.text, font: `600 12px ${fontFamily.ui}` }}>
              Move a knob, hit a note or press a key… <span style={{ fontWeight: 500, opacity: 0.8 }}>Esc to cancel</span>
            </div>
          )}
          {play.mappings.length === 0 ? (
            <EmptyState
              title="Nothing mapped"
              body={noControls
                ? 'Add a control first, then map an input onto it.'
                : `Press Learn and move a knob or a key, or add a row by hand. ${midi.status === 'unsupported' ? 'This browser has no Web MIDI; the keyboard stand-in on a MIDI Input node still works.' : midi.status === 'ready' && midi.inputs.length ? `Listening to ${midi.inputs.join(', ')}.` : ''} Ableton and other DAWs: send MIDI to a virtual port (IAC Driver on macOS, loopMIDI on Windows) and it shows up here as MIDI.`}
            />
          ) : play.mappings.map(m => (
            <MappingRow
              key={m.id}
              mapping={m}
              control={play.controls.find(c => c.id === m.controlId)}
              controls={play.controls}
              audioNodes={audioNodes}
              meter={meters.get(m.id) ?? 0}
              learning={learnFor === m.id}
              collapsed={collapsed.has(m.id)}
              onToggle={() => toggleRow(m.id)}
              onLearn={() => setLearnFor(l => (l === m.id ? null : m.id))}
              onUpdate={patch => onUpdate(m.id, patch)}
              onRemove={() => onRemove(m.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const EMPTY_MAPPINGS: PlayMapping[] = [];

function MappingRow({ mapping: m, control, controls, audioNodes, meter, learning, collapsed, onToggle, onLearn, onUpdate, onRemove }: {
  mapping: PlayMapping;
  control: PlayControl | undefined;
  controls: PlayControl[];
  audioNodes: AudioNodeOption[];
  meter: number;
  learning: boolean;
  collapsed: boolean;
  onToggle: () => void;
  onLearn: () => void;
  onUpdate: (patch: Partial<PlayMapping>) => void;
  onRemove: () => void;
}) {
  const tk = useTokens();
  const type = sourceType(m.source);
  const numStyle = { width: 58, height: 26, borderRadius: 6, border: 0, background: tk.bg.field, color: tk.text.primary, font: `500 11.5px ${fontFamily.mono}`, textAlign: 'center' as const };
  const labelStyle = { color: tk.text.faint, font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.04em', textTransform: 'uppercase' as const, width: 54, flexShrink: 0 };
  const otherControls = controls.filter(c => c.id !== m.controlId);
  const retarget = (id: string) => {
    const c = controls.find(x => x.id === id);
    // A control can't drive itself: drop a control source that now points at the target.
    const source = m.source.kind === 'control' && m.source.controlId === id ? { kind: 'control' as const, controlId: controls.find(x => x.id !== id)?.id ?? '' } : m.source;
    onUpdate(c ? { controlId: id, outMin: c.min, outMax: c.max, channel: undefined, source } : { controlId: id, source });
  };

  const frame = { marginTop: 6, borderRadius: radius.card, background: tk.bg.panel, boxShadow: `inset 0 0 0 1px ${learning ? tk.accent.base : tk.border.default}`, opacity: m.enabled ? 1 : 0.55 };
  const chevron = <IconButton icon={collapsed ? 'chevR' : 'chevD'} label={collapsed ? 'Expand mapping' : 'Collapse mapping'} size="sm" tooltip={false} onClick={onToggle} style={{ marginLeft: -6 }} />;

  if (collapsed) {
    return (
      <div style={{ ...frame, padding: '4px 10px 6px 8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 26 }}>
          {chevron}
          <button type="button" onClick={onToggle} title="Expand" style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6, border: 0, background: 'none', padding: 0, cursor: 'pointer', color: tk.text.primary, font: `500 12px ${fontFamily.ui}`, textAlign: 'left' }}>
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 600 }}>{sourceLabel(m.source, controls)}</span>
            <Icon name="chevR" size={12} style={{ color: tk.text.faint, flexShrink: 0 }} />
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: tk.text.secondary }}>{control?.label ?? 'missing control'}</span>
          </button>
          <Toggle checked={m.enabled} onChange={enabled => onUpdate({ enabled })} />
        </div>
        <div style={{ height: 3, margin: '2px 0 0 22px', borderRadius: 2, background: tk.bg.field, overflow: 'hidden' }}>
          <div style={{ width: `${Math.round(meter * 100)}%`, height: '100%', background: m.enabled ? tk.accent.base : tk.text.disabled, transition: 'width 60ms linear' }} />
        </div>
      </div>
    );
  }

  return (
    <div style={{ ...frame, padding: '8px 10px' }}>
      {/* Source row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {chevron}
        <span style={{ ...labelStyle, width: 40 }}>Source</span>
        <Select ariaLabel="Source" value={type} options={SOURCE_TYPES} onChange={v => onUpdate({ source: sourceFromType(v as SourceType, m.source, otherControls[0]?.id ?? '') })} height={26} style={{ flex: 1, minWidth: 0 }} />
        {m.source.kind === 'control' && (
          otherControls.length === 0
            ? <span style={{ color: tk.text.faint, font: `11px ${fontFamily.ui}` }}>Add a second control</span>
            : <Select ariaLabel="Source control" value={m.source.controlId} options={otherControls.map(c => ({ value: c.id, label: c.label }))} onChange={v => onUpdate({ source: { kind: 'control', controlId: v } })} height={26} style={{ flex: 1, minWidth: 0 }} />
        )}
        {m.source.kind === 'midi' && m.source.signal === 'cc' && (
          <NumberInput value={m.source.cc ?? 1} min={0} max={127} step={1} title="CC number" onCommit={n => onUpdate({ source: { ...m.source, kind: 'midi', signal: 'cc', channel: m.source.kind === 'midi' ? m.source.channel : 0, cc: Math.max(0, Math.min(127, Math.round(n))) } })} style={{ ...numStyle, width: 44 }} />
        )}
        {m.source.kind === 'midi' && (
          <Select ariaLabel="MIDI channel" value={`${m.source.channel}`} options={CHANNELS} onChange={v => onUpdate({ source: { ...(m.source as Extract<PlaySource, { kind: 'midi' }>), channel: parseInt(v, 10) || 0 } })} height={26} style={{ flexShrink: 0 }} />
        )}
        {m.source.kind === 'key' && (
          <span style={{ height: 26, padding: '0 8px', borderRadius: 6, display: 'inline-flex', alignItems: 'center', background: tk.bg.field, font: `600 11.5px ${fontFamily.mono}`, color: tk.text.primary }}>{keyName(m.source.code)}</span>
        )}
        <IconButton icon="spark" label={learning ? 'Listening… (Esc to cancel)' : 'Learn: replace this source with the next input'} size="sm" active={learning} onClick={onLearn} />
        <IconButton icon="trash" label="Remove mapping" size="sm" tone="danger" onClick={onRemove} />
      </div>
      {/* Meter */}
      <div style={{ height: 3, margin: '6px 0 8px 60px', borderRadius: 2, background: tk.bg.field, overflow: 'hidden' }}>
        <div style={{ width: `${Math.round(meter * 100)}%`, height: '100%', background: m.enabled ? tk.accent.base : tk.text.disabled, transition: 'width 60ms linear' }} />
      </div>
      <SourceOptions source={m.source} audioNodes={audioNodes} numStyle={numStyle} labelStyle={labelStyle} onChange={source => onUpdate({ source })} />
      {/* Target row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={labelStyle}>Control</span>
        <Select ariaLabel="Control" value={m.controlId} options={controls.map(c => ({ value: c.id, label: c.label }))} onChange={retarget} height={26} style={{ flex: 1, minWidth: 0 }} />
        {control?.kind === 'color' && (
          <Select ariaLabel="Colour channel" value={m.channel === undefined ? 'all' : `${m.channel}`} options={COLOUR_CHANNELS} onChange={v => onUpdate({ channel: v === 'all' ? undefined : (parseInt(v, 10) as 0 | 1 | 2) })} height={26} />
        )}
      </div>
      {/* Processing row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
        <span style={labelStyle}>Range</span>
        <NumberInput value={m.outMin} title="Value at the source's minimum" onCommit={n => onUpdate({ outMin: n })} style={numStyle} />
        <span style={{ color: tk.text.faint }}>→</span>
        <NumberInput value={m.outMax} title="Value at the source's maximum" onCommit={n => onUpdate({ outMax: n })} style={numStyle} />
        <IconButton icon="bidir" label="Invert the range" size="sm" onClick={() => onUpdate({ outMin: m.outMax, outMax: m.outMin })} />
        <span style={{ flex: 1 }} />
        <Segmented size="sm" ariaLabel="Curve" value={m.curve} options={CURVES} onChange={v => onUpdate(v === 'custom' ? { curve: 'custom', curveY: m.curveY ?? sampleCurve(m.curve) } : { curve: v })} />
      </div>
      {m.curve === 'custom' && (
        <CurvePad value={m.curveY ?? sampleCurve('linear')} meter={meter} onChange={curveY => onUpdate({ curveY })} onReset={() => onUpdate({ curveY: sampleCurve('linear') })} />
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
        <span style={labelStyle}>Smooth</span>
        <NumberInput value={m.smoothMs} min={0} max={5000} step={10} title="Smoothing time in milliseconds" onCommit={n => onUpdate({ smoothMs: Math.max(0, n) })} style={numStyle} />
        <span style={{ color: tk.text.faint, font: `500 11px ${fontFamily.ui}` }}>ms</span>
        <span style={{ flex: 1 }} />
        <Toggle checked={m.enabled} onChange={enabled => onUpdate({ enabled })} label={m.enabled ? 'On' : 'Off'} />
      </div>
      {m.source.kind === 'midi' && m.source.signal === 'note' && (
        <div style={{ marginTop: 6, color: tk.text.faint, font: `11px ${fontFamily.ui}` }}>Note number scaled 0–1 (last note: {midiNoteName(midiEngine.channelState(m.source.channel).lastNote)}).</div>
      )}
    </div>
  );
}

/** The second row of a mapping: the fields a source kind needs beyond its name. */
function SourceOptions({ source, audioNodes, numStyle, labelStyle, onChange }: {
  source: PlaySource;
  audioNodes: AudioNodeOption[];
  numStyle: React.CSSProperties;
  labelStyle: React.CSSProperties;
  onChange: (source: PlaySource) => void;
}) {
  const tk = useTokens();
  const taps = useRef<number[]>([]);
  const [tiltAsk, setTiltAsk] = useState(() => playEngine.tiltNeedsPermission());
  const hint = (text: string) => <span style={{ color: tk.text.faint, font: `11px ${fontFamily.ui}` }}>{text}</span>;
  const row = (children: ReactNode) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
      <span style={labelStyle}>Options</span>
      {children}
    </div>
  );
  switch (source.kind) {
    case 'lfo':
      return row(<>
        <Select ariaLabel="LFO shape" value={source.shape} options={LFO_SHAPES} onChange={v => onChange({ ...source, shape: v as LfoShape })} height={26} />
        <NumberInput value={source.rate} min={0.01} max={50} step={0.1} title="Cycles per second" onCommit={n => onChange({ ...source, rate: Math.max(0.001, n) })} style={numStyle} />
        {hint('Hz')}
        <NumberInput value={source.phase} min={0} max={1} step={0.05} title="Phase offset, 0–1" onCommit={n => onChange({ ...source, phase: n })} style={{ ...numStyle, width: 48 }} />
        {hint('phase')}
      </>);
    case 'clock': {
      const tap = () => {
        const now = performance.now();
        const t = taps.current.filter(x => now - x < 2500);
        t.push(now);
        taps.current = t;
        if (t.length >= 2) {
          const avg = (t[t.length - 1] - t[0]) / (t.length - 1);
          onChange({ ...source, bpm: Math.round(60000 / avg) });
        }
      };
      return row(<>
        <NumberInput value={source.bpm} min={1} max={999} step={1} title="Beats per minute" onCommit={n => onChange({ ...source, bpm: Math.max(1, n) })} style={numStyle} />
        {hint('bpm')}
        <Button size="sm" onClick={tap} title="Tap the tempo">Tap</Button>
        <NumberInput value={source.beats} min={0.0625} max={64} step={1} title="Beats per cycle" onCommit={n => onChange({ ...source, beats: Math.max(0.0625, n) })} style={{ ...numStyle, width: 48 }} />
        {hint('beats')}
        <Select ariaLabel="Clock shape" value={source.shape} options={LFO_SHAPES} onChange={v => onChange({ ...source, shape: v as LfoShape })} height={26} />
      </>);
    }
    case 'audio': {
      if (audioNodes.length === 0) return row(hint('Add an Audio Input node in the Studio and load a file or the mic.'));
      const node = audioNodes.find(n => n.id === source.nodeId) ?? audioNodes[0];
      const bands = Array.from({ length: node.bands }, (_, i) => ({ value: `${i}`, label: `Band ${i + 1}` }));
      return row(<>
        <Select ariaLabel="Audio node" value={node.id} options={audioNodes.map(n => ({ value: n.id, label: n.label }))} onChange={v => onChange({ ...source, nodeId: v, band: 0 })} height={26} style={{ flex: 1, minWidth: 0 }} />
        <Select ariaLabel="Band" value={`${Math.min(source.band, node.bands - 1)}`} options={bands} onChange={v => onChange({ ...source, nodeId: node.id, band: parseInt(v, 10) || 0 })} height={26} />
      </>);
    }
    case 'tilt':
      return row(<>
        <Select ariaLabel="Tilt axis" value={source.axis} options={TILT_AXES} onChange={v => onChange({ ...source, axis: v as 'beta' | 'gamma' | 'alpha' })} height={26} />
        {tiltAsk
          ? <Button size="sm" onClick={async () => { if (await playEngine.requestTiltPermission()) setTiltAsk(false); }}>Enable motion</Button>
          : hint('Phones and tablets only')}
      </>);
    case 'gamepad':
      return row(<>
        <NumberInput value={source.pad + 1} min={1} max={4} step={1} title="Which controller" onCommit={n => onChange({ ...source, pad: Math.max(0, Math.round(n) - 1) })} style={{ ...numStyle, width: 40 }} />
        {hint('pad')}
        <Select ariaLabel="Axis or button" value={source.control} options={[{ value: 'axis', label: 'Stick axis' }, { value: 'button', label: 'Button' }]} onChange={v => onChange({ ...source, control: v as 'axis' | 'button' })} height={26} />
        <NumberInput value={source.index} min={0} max={31} step={1} title="Axis or button number" onCommit={n => onChange({ ...source, index: Math.max(0, Math.round(n)) })} style={{ ...numStyle, width: 40 }} />
        {hint('or press Learn and move it')}
      </>);
    default:
      return null;
  }
}

/**
 * The drawn remap curve: x is the source (0..1), y what the mapping sees.
 * Drag across the pad to draw; the faint diagonal is the untouched 1:1 line and
 * the dot is the source's reading right now, so you can see where you are on
 * the curve while you turn the knob.
 */
function CurvePad({ value, meter, onChange, onReset }: { value: number[]; meter: number; onChange: (ys: number[]) => void; onReset: () => void }) {
  const tk = useTokens();
  const ref = useRef<HTMLDivElement>(null);
  const draw = useRef<{ ys: number[]; lastI: number; lastY: number } | null>(null);
  const n = value.length;
  const W = 100, H = 60;
  const pointAt = (e: React.PointerEvent): { i: number; y: number } | null => {
    const r = ref.current?.getBoundingClientRect();
    if (!r || r.width === 0 || r.height === 0) return null;
    const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const y = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height));
    return { i: Math.round(x * (n - 1)), y };
  };
  const onDown = (e: React.PointerEvent) => {
    const pt = pointAt(e);
    if (!pt) return;
    e.preventDefault();
    const ys = [...value];
    ys[pt.i] = pt.y;
    draw.current = { ys, lastI: pt.i, lastY: pt.y };
    onChange([...ys]);
    // Keep the stroke even when the pointer leaves the pad. Some inputs have no capturable pointer; drawing still works without it.
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* fall back to window-level tracking below */ }
  };
  useEffect(() => {
    const up = () => { draw.current = null; };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => { window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
  }, []);
  const onMove = (e: React.PointerEvent) => {
    const d = draw.current;
    const pt = pointAt(e);
    if (!d || !pt) return;
    // Fill every grid column the pointer crossed since the last event, so a fast stroke has no gaps.
    const from = d.lastI, to = pt.i;
    const step = to >= from ? 1 : -1;
    for (let i = from; ; i += step) {
      const t = to === from ? 1 : (i - from) / (to - from);
      d.ys[i] = d.lastY + (pt.y - d.lastY) * t;
      if (i === to) break;
    }
    d.lastI = to; d.lastY = pt.y;
    onChange([...d.ys]);
  };
  const onUp = () => { draw.current = null; };
  const path = value.map((y, i) => `${i === 0 ? 'M' : 'L'}${(i / (n - 1)) * W},${(1 - y) * H}`).join(' ');
  const mx = Math.max(0, Math.min(1, meter));
  const pos = mx * (n - 1);
  const mi = Math.min(n - 2, Math.floor(pos));
  const my = value[mi] + (value[mi + 1] - value[mi]) * (pos - mi);
  return (
    <div style={{ display: 'flex', alignItems: 'stretch', gap: 6, marginTop: 6, marginLeft: 60 }}>
      <div
        ref={ref}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        title="Drag to draw the remap: left to right is the source, bottom to top is what the control gets"
        style={{ flex: 1, height: 96, borderRadius: radius.md, background: tk.bg.field, cursor: 'crosshair', touchAction: 'none', position: 'relative', overflow: 'hidden' }}
      >
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}>
          <line x1={0} y1={H} x2={W} y2={0} stroke={tk.text.disabled} strokeWidth={0.6} strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
          <path d={path} fill="none" stroke={tk.accent.base} strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        </svg>
        <span style={{ position: 'absolute', left: `calc(${mx * 100}% - 4px)`, top: `calc(${(1 - my) * 100}% - 4px)`, width: 8, height: 8, borderRadius: '50%', background: tk.accent.base, boxShadow: `0 0 0 2px ${tk.bg.panel}`, pointerEvents: 'none' }} />
      </div>
      <IconButton icon="reset" label="Back to a straight line" size="sm" onClick={onReset} style={{ alignSelf: 'flex-start' }} />
    </div>
  );
}
