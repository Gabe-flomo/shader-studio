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
import { CHANNELS, COLOUR_CHANNELS, CURVES, LFO_SHAPES, LIVE_BAND_OPTIONS, NOISE_TYPES, SOURCE_TYPES, TILT_AXES, TRIGGER_KINDS, TRIGGER_MODES, keyName, sourceFromType, sourceLabel, sourceType, triggerFromKind, triggerLabel, type SourceType } from '../../play/playSources';
import { liveAudio, type LiveStatus } from '../../lib/liveAudio';
import { ConnectGuide } from './ConnectGuide';
import type { LfoShape, LiveAudioBand, TriggerSpec } from '../../types/play';
import { oscClient, type OscStatus } from '../../lib/oscClient';
import { playEngine, sampleCurve, type ControlValue } from '../../lib/playEngine';
import { PREVIEW_ASPECTS } from '../../utils/graphImportPlan';
import { midiEngine, midiNoteName } from '../../lib/midiEngine';
import {
  candidateLabel, collectPlayCandidates, controlExists, controlHelp, playId, readControlValue, targetParts, type PlayCandidate,
} from '../../play/playControls';
import { Button, IconButton } from '../ui/Button';
import { Segmented, Toggle } from '../ui/Choice';
import { Field } from '../ui/Field';
import { Icon } from '../ui/Icon';
import { Popover } from '../ui/Popover';
import { Tooltip } from '../ui/Tooltip';
import { RulerSlider } from '../ui/RulerSlider';
import { Select } from '../ui/Select';
import { NumberInput } from '../NodeGraph/NumberInput';
import { reportFileResult } from '../shell/reportFileResult';
import { toast } from '../ui/toastStore';
import { LayersPanel } from './LayersPanel';
import { EmbedDialog } from './EmbedDialog';
import { DEFAULT_DISPLAY, parseLayerTarget, type PlayDisplay } from '../../types/play';

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
          const v = Math.round((playEngine.readMapping(m) ?? 0) * 100) / 100;
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
  const [embedOpen, setEmbedOpen] = useState(false);
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
    const lt = parseLayerTarget(control.target);
    if (lt) {
      if (typeof value === 'number') setPlay(p => ({ ...p, layers: p.layers.map(l => l.id === lt.layerId ? { ...l, [lt.key]: value } as typeof l : l) }));
      return;
    }
    const { nodeId, paramKey } = targetParts(control.target);
    updateNodeParams(nodeId, { [paramKey]: value }, { immediate: true });
  }, [updateNodeParams, setPlay]);

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
  // Phones: Controls and Mappings are tabs instead of stacked panes.
  const [tab, setTab] = useState<'controls' | 'layers' | 'mappings'>('controls');
  const nullLayers = useMemo(() => play.layers.filter(l => l.kind === 'null').map(l => ({ id: l.id, label: l.label })), [play.layers]);
  // Desktop: the drawer's height, dragged from its top edge and remembered.
  const rootRef = useRef<HTMLDivElement>(null);
  const [drawerH, setDrawerH] = useState<number>(() => {
    try { const v = parseInt(localStorage.getItem(DRAWER_HEIGHT_KEY) ?? '', 10); return Number.isFinite(v) && v > 0 ? v : 340; } catch { return 340; }
  });
  const startDrawerResize = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = drawerH;
    const rootH = rootRef.current?.clientHeight ?? 800;
    let next = startH;
    const onMove = (ev: PointerEvent) => {
      next = Math.max(120, Math.min(rootH - 180, startH + (startY - ev.clientY)));
      setDrawerH(next);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      try { localStorage.setItem(DRAWER_HEIGHT_KEY, String(Math.round(next))); } catch { /* preference only */ }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [drawerH]);
  // Audio Input nodes a mapping can read a band from.
  const audioNodes = useMemo<AudioNodeOption[]>(() => nodes.filter(n => n.type === 'audioInput').map(n => ({
    id: n.id,
    label: (typeof n.params.label === 'string' && n.params.label.trim()) || 'Audio Input',
    bands: Array.isArray(n.params._bands) ? Math.max(1, n.params._bands.length) : 1,
  })), [nodes]);

  return (
    <div ref={rootRef} style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: tk.bg.subtle, color: tk.text.primary, font: `12.5px ${fontFamily.ui}` }}>
      {/* Sections. Desktop keeps Mappings as a drawer underneath; phones make it a third tab. */}
      <div style={{ flexShrink: 0, padding: '8px 12px 2px', background: tk.bg.panel }}>
        <Segmented
          fill
          ariaLabel="Play section"
          value={compact || tab !== 'mappings' ? tab : 'controls'}
          onChange={setTab}
          options={[
            { value: 'controls', label: `Controls${play.controls.length ? ` · ${play.controls.length}` : ''}` },
            { value: 'layers', label: `Layers${play.layers.length ? ` · ${play.layers.length}` : ''}` },
            ...(compact ? [{ value: 'mappings' as const, label: `Mappings${play.mappings.length ? ` · ${play.mappings.length}` : ''}` }] : []),
          ]}
        />
      </div>
      {tab === 'layers' && (
        <LayersPanel
          play={play}
          touch={compact}
          exposedTargets={new Set(play.controls.map(c => c.target))}
          onChange={update}
          onExpose={control => update(p => (p.controls.some(c => c.target === control.target) ? p : { ...p, controls: [...p.controls, control] }))}
        />
      )}
      {tab === 'controls' && <PanelHeader
        title="Controls"
        hint={play.controls.length === 0 ? undefined : `${play.controls.length}`}
        extra={(
          <>
            <IconButton icon="import" label="Import a play file (a graph with its Play panel and mappings)" onClick={async () => { reportFileResult(await importGraphFromFile(), { failTitle: 'Couldn’t import that file' }); }} />
            <IconButton icon="export" label="Export a play file: the graph, the panel and the mappings, exactly as they are now" disabled={play.controls.length === 0} onClick={async () => { reportFileResult(await exportPlayFile(), { failTitle: 'Couldn’t export the play file', success: 'Play file exported' }); }} />
            <IconButton icon="code" label="Put it on a website: a player with controls, or the picture as a background, as a snippet or a page" onClick={() => setEmbedOpen(true)} />
            <AddControlButton candidates={candidates} taken={new Set(play.controls.map(c => c.target))} onAdd={addControl} />
          </>
        )}
      />}
      {/* The picture's shape: the same setting the export dialog uses, so what you see is what you export. */}
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderBottom: `1px solid ${tk.border.subtle}`, background: tk.bg.panel }}>
        <span style={{ color: tk.text.faint, font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Canvas</span>
        <Select ariaLabel="Canvas shape" value={previewAspect} options={PREVIEW_ASPECTS.map(a => ({ value: a.id, label: a.id === 'free' ? 'Free (fill the panel)' : `${a.label} · ${a.hint}` }))} onChange={v => setPreviewAspect(v as typeof previewAspect)} height={26} style={{ flex: 1, minWidth: 0 }} />
      </div>
      <PictureRow play={play} onChange={update} />
      {tab === 'controls' && <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '6px 12px 12px' }}>
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
            exists={controlExists(nodes, c, play)}
            help={controlHelp(nodes, c.target, play)}
            value={readControlValue(nodes, c.target, play)}
            live={liveValues.get(c.id)}
            drivenBy={play.mappings.filter(m => m.enabled && m.controlId === c.id).map(m => sourceLabel(m.source, play.controls, play.layers))}
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
      </div>}

      {(!compact || tab === 'mappings') && <MappingsDrawer
        play={play}
        mode={compact ? 'tab' : 'drawer'}
        height={drawerH}
        onResizeStart={startDrawerResize}
        open={compact || drawerOpen}
        onToggle={() => setDrawerOpen(o => !o)}
        onAdd={addMapping}
        onUpdate={(id, patch) => update(p => ({ ...p, mappings: p.mappings.map(m => m.id === id ? { ...m, ...patch } : m) }))}
        onRemove={id => update(p => ({ ...p, mappings: p.mappings.filter(m => m.id !== id) }))}
        audioNodes={audioNodes}
        nullLayers={nullLayers}
      />}
      {embedOpen && <EmbedDialog onClose={() => setEmbedOpen(false)} />}
    </div>
  );
}

const DRAWER_HEIGHT_KEY = 'shader-studio:play:drawerHeight';

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
                title={c.hint}
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

/**
 * Show the shader, or only the layers on a backdrop colour. The shader keeps
 * rendering underneath, so reveal mattes, masks and particles still read it:
 * text with a Reveal matte then shows the picture inside the letters only.
 */
function PictureRow({ play, onChange }: { play: PlayRecord; onChange: (fn: (p: PlayRecord) => PlayRecord) => void }) {
  const tk = useTokens();
  const d = play.display ?? DEFAULT_DISPLAY;
  const hex = `#${d.backdrop.map(v => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('')}`;
  const setDisplay = (patch: Partial<PlayDisplay>) => onChange(p => {
    const next = { ...(p.display ?? DEFAULT_DISPLAY), ...patch };
    const isDefault = next.picture && next.backdrop.every((v, i) => v === DEFAULT_DISPLAY.backdrop[i]);
    if (isDefault) { const rest = { ...p }; delete rest.display; return rest; }
    return { ...p, display: next };
  });
  return (
    <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderBottom: `1px solid ${tk.border.subtle}`, background: tk.bg.panel }}>
      <Tooltip label="Picture" description="Layers only hides the shader and shows the layers on a backdrop. The shader still runs underneath: text or images with a Reveal matte, and particles with Mask on, show it only inside themselves.">
        <span style={{ color: tk.text.faint, font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.04em', textTransform: 'uppercase', cursor: 'help' }}>Picture</span>
      </Tooltip>
      <Segmented size="sm" ariaLabel="Picture" value={d.picture ? 'shown' : 'hidden'} options={[
        { value: 'shown', label: 'Shown', title: 'The shader, with the layers on top' },
        { value: 'hidden', label: 'Layers only', title: 'Hide the shader; layers can still reveal it' },
      ]} onChange={v => setDisplay({ picture: v === 'shown' })} />
      {!d.picture && (
        <label title="Backdrop colour" style={{ position: 'relative', width: 36, height: 22, borderRadius: radius.md, background: hex, boxShadow: `inset 0 0 0 1px ${alpha('#888', 0.5)}`, cursor: 'pointer' }}>
          <input type="color" aria-label="Backdrop colour" value={hex} onChange={e => { const h = e.target.value; setDisplay({ backdrop: [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255] }); }} style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer' }} />
        </label>
      )}
    </div>
  );
}

function ControlRow({ control, index, count, exists, help, value, live, drivenBy, touch, onChange, onRename, onRange, onMove, onRemove }: {
  control: PlayControl;
  index: number;
  count: number;
  exists: boolean;
  /** The param's hint and the node's comment from the graph, shown on the ⓘ. */
  help: { hint?: string; comment?: string };
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
        {(help.hint || help.comment) && (
          <Tooltip
            label={help.hint ?? 'Note on the node'}
            description={help.comment ? (help.hint ? <><b>Node note:</b> {help.comment}</> : help.comment) : undefined}
          >
            <span aria-label={[help.hint, help.comment].filter(Boolean).join(' — ')} style={{ display: 'inline-flex', color: help.comment ? tk.accent.text : tk.text.faint, cursor: 'help' }}>
              <Icon name="info" size={13} />
            </span>
          </Tooltip>
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

function MappingsDrawer({ play, mode, height, onResizeStart, open, onToggle, onAdd, onUpdate, onRemove, audioNodes, nullLayers }: {
  play: PlayRecord;
  /** `drawer`: folds under the controls with a draggable top edge. `tab`: fills the page (phones). */
  mode: 'drawer' | 'tab';
  height: number;
  onResizeStart: (e: React.PointerEvent) => void;
  open: boolean;
  onToggle: () => void;
  onAdd: (source: PlaySource, controlId?: string) => void;
  onUpdate: (id: string, patch: Partial<PlayMapping>) => void;
  onRemove: (id: string) => void;
  audioNodes: AudioNodeOption[];
  nullLayers: { id: string; label: string }[];
}) {
  const tk = useTokens();
  const meters = useSourceMeter(open ? play.mappings : EMPTY_MAPPINGS);
  // Learn: the next knob, key or MIDI note becomes a source. `learnFor` is a
  // mapping id (replace its source) or 'new' (add a mapping).
  const [learnFor, setLearnFor] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  useEffect(() => {
    if (!learnFor) return;
    void midiEngine.connectWebMidi();
    // A trigger row's Learn picks what fires it (key, note, click, OSC); every other Learn picks a source.
    const row = learnFor === 'new' ? undefined : play.mappings.find(m => m.id === learnFor);
    if (row?.source.kind === 'trigger') {
      const src = row.source;
      return playEngine.startLearnTrigger(trigger => {
        onUpdate(row.id, { source: { ...src, trigger } });
        setLearnFor(null);
      });
    }
    const stop = playEngine.startLearn(source => {
      if (learnFor === 'new') onAdd(source);
      else onUpdate(learnFor, { source });
      setLearnFor(null);
    });
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    <div style={mode === 'tab'
      ? { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }
      : { position: 'relative', flexShrink: 0, display: 'flex', flexDirection: 'column', height: open ? height : undefined, maxHeight: '85%', borderTop: `1px solid ${tk.border.default}` }}>
      {mode === 'drawer' && open && (
        <div
          onPointerDown={onResizeStart}
          title="Drag to resize the mappings"
          style={{ position: 'absolute', left: 0, right: 0, top: -4, height: 9, cursor: 'row-resize', zIndex: 2 }}
          onMouseEnter={e => ((e.currentTarget as HTMLDivElement).style.background = alpha(tk.accent.base, 0.25))}
          onMouseLeave={e => ((e.currentTarget as HTMLDivElement).style.background = 'transparent')}
        />
      )}
      <PanelHeader
        title="Mappings"
        hint={play.mappings.length ? `${play.mappings.length}` : undefined}
        chevron={mode === 'drawer' ? (open ? 'down' : 'up') : undefined}
        onClick={mode === 'drawer' ? onToggle : undefined}
        extra={open && (
          <>
            {play.mappings.length > 1 && (
              <IconButton
                icon={allCollapsed ? 'chevD' : 'chevU'}
                label={allCollapsed ? 'Expand all mappings' : 'Collapse all mappings'}
                onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(play.mappings.map(m => m.id)))}
              />
            )}
            <IconButton icon="info" label="Connect Ableton, a MIDI controller, OSC or live audio: step-by-step" onClick={() => setGuideOpen(true)} />
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
                : `Press Learn and move a knob or a key, or add a row by hand. ${midi.status === 'unsupported' ? 'This browser has no Web MIDI; the keyboard stand-in on a MIDI Input node still works.' : midi.status === 'ready' && midi.inputs.length ? `Listening to ${midi.inputs.join(', ')}.` : ''} Connecting Ableton, a controller, OSC or live audio for the first time? The ⓘ button above walks you through it.`}
            />
          ) : play.mappings.map(m => (
            <MappingRow
              key={m.id}
              mapping={m}
              control={play.controls.find(c => c.id === m.controlId)}
              controls={play.controls}
              audioNodes={audioNodes}
              nullLayers={nullLayers}
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
      {guideOpen && <ConnectGuide onClose={() => setGuideOpen(false)} />}
    </div>
  );
}

const EMPTY_MAPPINGS: PlayMapping[] = [];

function MappingRow({ mapping: m, control, controls, audioNodes, nullLayers, meter, learning, collapsed, onToggle, onLearn, onUpdate, onRemove }: {
  mapping: PlayMapping;
  control: PlayControl | undefined;
  controls: PlayControl[];
  audioNodes: AudioNodeOption[];
  nullLayers: { id: string; label: string }[];
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
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 600 }}>{sourceLabel(m.source, controls, nullLayers)}</span>
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
        <Select ariaLabel="Source" value={type} options={SOURCE_TYPES} onChange={v => onUpdate({ source: sourceFromType(v as SourceType, m.source, otherControls[0]?.id ?? '', nullLayers[0]?.id ?? '') })} height={26} style={{ flex: 1, minWidth: 0 }} />
        {m.source.kind === 'null' && (
          nullLayers.length === 0
            ? <span style={{ color: tk.text.faint, font: `11px ${fontFamily.ui}` }}>Add a Null layer first</span>
            : <>
                <Select ariaLabel="Null layer" value={m.source.layerId} options={nullLayers.map(l => ({ value: l.id, label: l.label }))} onChange={v => onUpdate({ source: { kind: 'null', layerId: v, axis: m.source.kind === 'null' ? m.source.axis : 'x' } })} height={26} style={{ flex: 1, minWidth: 0 }} />
                <Segmented size="sm" ariaLabel="Null axis" value={m.source.axis} options={[{ value: 'x', label: 'X' }, { value: 'y', label: 'Y' }]} onChange={v => onUpdate({ source: { kind: 'null', layerId: m.source.kind === 'null' ? m.source.layerId : '', axis: v } })} />
              </>
        )}
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
    case 'noise':
      return row(<>
        <Segmented size="sm" ariaLabel="Noise type" value={source.type} options={NOISE_TYPES} onChange={v => onChange({ ...source, type: v })} />
        {source.type !== 'random' && <>
          <NumberInput value={source.rate} min={0.01} max={60} step={0.1} title={source.type === 'stepped' ? 'Jumps per second' : 'Changes per second'} onCommit={n => onChange({ ...source, rate: Math.max(0.01, n) })} style={{ ...numStyle, width: 48 }} />
          {hint('/ s')}
        </>}
        {source.type === 'stepped' && <>
          <NumberInput value={source.steps} min={0} max={64} step={1} title="Snap to this many levels (0 = any value)" onCommit={n => onChange({ ...source, steps: Math.max(0, Math.min(64, Math.round(n))) })} style={{ ...numStyle, width: 40 }} />
          {hint('levels')}
        </>}
        <IconButton icon="dice" label="New seed: a different random path" size="sm" onClick={() => onChange({ ...source, seed: Math.floor(Math.random() * 100000) })} />
      </>);
    case 'osc':
      return (
        <>
          {row(<>
            <Field value={source.address} onChange={e => onChange({ ...source, address: e.target.value.startsWith('/') ? e.target.value : `/${e.target.value}` })} height={26} mono style={{ flex: 1, minWidth: 120 }} placeholder="/1/fader1" />
            <NumberInput value={source.arg} min={0} max={15} step={1} title="Which argument (0 = the first)" onCommit={n => onChange({ ...source, arg: Math.max(0, Math.round(n)) })} style={{ ...numStyle, width: 36 }} />
            {hint('arg')}
          </>)}
          {row(<>
            <NumberInput value={source.min} title="OSC value that means 0" onCommit={n => onChange({ ...source, min: n })} style={{ ...numStyle, width: 48 }} />
            {hint('→')}
            <NumberInput value={source.max} title="OSC value that means 1" onCommit={n => onChange({ ...source, max: n === source.min ? n + 1 : n })} style={{ ...numStyle, width: 48 }} />
            <OscStatusChip />
          </>)}
        </>
      );
    case 'live':
      return row(<>
        <Select ariaLabel="Band" value={source.band} options={LIVE_BAND_OPTIONS} onChange={v => onChange({ ...source, band: v as LiveAudioBand })} height={26} />
        <NumberInput value={source.gain} min={0.1} max={10} step={0.1} title="Gain: turn up for quiet inputs" onCommit={n => onChange({ ...source, gain: Math.max(0.1, Math.min(10, n)) })} style={{ ...numStyle, width: 44 }} />
        {hint('×')}
        <LiveAudioChip />
      </>);
    case 'trigger':
      return <TriggerOptions source={source} numStyle={numStyle} labelStyle={labelStyle} onChange={onChange} />;
    default:
      return null;
  }
}

/** Where a trigger fires from and what it does. */
function TriggerOptions({ source, numStyle, labelStyle, onChange }: {
  source: Extract<PlaySource, { kind: 'trigger' }>;
  numStyle: React.CSSProperties;
  labelStyle: React.CSSProperties;
  onChange: (source: PlaySource) => void;
}) {
  const tk = useTokens();
  const hint = (text: string) => <span style={{ color: tk.text.faint, font: `11px ${fontFamily.ui}` }}>{text}</span>;
  const row = (label: string, children: ReactNode) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
      <span style={labelStyle}>{label}</span>
      {children}
    </div>
  );
  const t = source.trigger;
  const setT = (trigger: TriggerSpec) => onChange({ ...source, trigger });
  return (
    <>
      {row('On', <>
        <Select ariaLabel="Trigger" value={t.on} options={TRIGGER_KINDS} onChange={v => setT(triggerFromKind(v as TriggerSpec['on'], t))} height={26} />
        {t.on === 'key' && <span style={{ height: 26, padding: '0 8px', borderRadius: 6, display: 'inline-flex', alignItems: 'center', background: tk.bg.field, font: `600 11.5px ${fontFamily.mono}`, color: tk.text.primary }}>{keyName(t.code)}</span>}
        {t.on === 'note' && <>
          <NumberInput value={t.note} min={-1} max={127} step={1} title="Note number, -1 for any note" onCommit={n => setT({ ...t, note: Math.max(-1, Math.min(127, Math.round(n))) })} style={{ ...numStyle, width: 44 }} />
          <Select ariaLabel="Trigger channel" value={`${t.channel}`} options={CHANNELS} onChange={v => setT({ ...t, channel: parseInt(v, 10) || 0 })} height={26} />
        </>}
        {t.on === 'osc' && <>
          <Field value={t.address} onChange={e => setT({ ...t, address: e.target.value.startsWith('/') ? e.target.value : `/${e.target.value}` })} height={26} mono style={{ flex: 1, minWidth: 110 }} placeholder="/1/push1" />
          <OscStatusChip />
        </>}
        {t.on === 'audio' && <>
          <Select ariaLabel="Hit band" value={t.band} options={LIVE_BAND_OPTIONS} onChange={v => setT({ ...t, band: v as LiveAudioBand })} height={26} />
          <NumberInput value={t.threshold} min={0.01} max={0.99} step={0.05} title="Fires when the band goes above this (0–1)" onCommit={n => setT({ ...t, threshold: Math.max(0.01, Math.min(0.99, n)) })} style={{ ...numStyle, width: 44 }} />
          {hint('threshold')}
          <LiveAudioChip />
        </>}
        {t.on === 'beat' && <>
          <NumberInput value={t.bpm} min={1} max={999} step={1} title="Beats per minute" onCommit={n => setT({ ...t, bpm: Math.max(1, n) })} style={{ ...numStyle, width: 48 }} />
          {hint('bpm, every')}
          <NumberInput value={t.beats} min={0.0625} max={64} step={1} title="Fire every this many beats" onCommit={n => setT({ ...t, beats: Math.max(0.0625, n) })} style={{ ...numStyle, width: 40 }} />
          {hint('beats')}
        </>}
        {(t.on === 'key' || t.on === 'note' || t.on === 'osc' || t.on === 'mouse') && hint(`${triggerLabel(t)} · Learn to change`)}
      </>)}
      {row('Does', <Segmented size="sm" ariaLabel="Trigger mode" value={source.mode} options={TRIGGER_MODES} onChange={v => onChange({ ...source, mode: v })} />)}
      {source.mode === 'envelope' && (
        <>
          {row('ADSR', <>
            <NumberInput value={source.attack} min={0} max={10000} step={10} title="Attack, ms" onCommit={n => onChange({ ...source, attack: Math.max(0, n) })} style={{ ...numStyle, width: 44 }} />
            <NumberInput value={source.decay} min={0} max={10000} step={10} title="Decay, ms" onCommit={n => onChange({ ...source, decay: Math.max(0, n) })} style={{ ...numStyle, width: 44 }} />
            <NumberInput value={source.sustain} min={0} max={1} step={0.05} title="Sustain level while held, 0–1" onCommit={n => onChange({ ...source, sustain: Math.max(0, Math.min(1, n)) })} style={{ ...numStyle, width: 40 }} />
            <NumberInput value={source.release} min={0} max={20000} step={10} title="Release, ms" onCommit={n => onChange({ ...source, release: Math.max(0, n) })} style={{ ...numStyle, width: 44 }} />
            <EnvelopeGlyph a={source.attack} d={source.decay} s={source.sustain} r={source.release} />
          </>)}
          {t.on === 'note' && row('Velocity', <Toggle checked={source.velocity} onChange={velocity => onChange({ ...source, velocity })} label="Harder hits peak higher" />)}
        </>
      )}
      {source.mode === 'step' && row('Steps', <NumberInput value={source.steps} min={2} max={64} step={1} title="How many steps before it wraps" onCommit={n => onChange({ ...source, steps: Math.max(2, Math.min(64, Math.round(n))) })} style={{ ...numStyle, width: 44 }} />)}
    </>
  );
}

/** A small picture of the ADSR shape, with a fixed hold between decay and release. */
function EnvelopeGlyph({ a, d, s, r }: { a: number; d: number; s: number; r: number }) {
  const tk = useTokens();
  const hold = Math.max(150, (a + d + r) * 0.3);
  const total = Math.max(1, a + d + hold + r);
  const W = 64, H = 22;
  const x = (ms: number) => (ms / total) * W;
  const pts = [[0, H], [x(a), 2], [x(a + d), H - s * (H - 2)], [x(a + d + hold), H - s * (H - 2)], [W, H]];
  return (
    <svg width={W} height={H} aria-hidden style={{ flexShrink: 0 }}>
      <polyline points={pts.map(p => p.join(',')).join(' ')} fill="none" stroke={tk.accent.base} strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}

/**
 * OSC in. Desktop app: the app listens on UDP itself (Start / Stop, the UDP
 * port, and whether phones on the network may send). Browser: a small bridge
 * has to run on the computer; the chip offers it as a download and shows the
 * one command to start it.
 */
function OscStatusChip() {
  const tk = useTokens();
  const native = oscClient.getMode() === 'native';
  const [status, setStatus] = useState<OscStatus>(() => oscClient.getStatus());
  const [port, setPort] = useState(() => oscClient.getPort());
  const [lan, setLan] = useState(() => oscClient.getLan());
  useEffect(() => oscClient.onStatus(setStatus), []);
  const colour = status === 'connected' ? tk.status.success : status === 'connecting' ? tk.status.warning : status === 'error' ? tk.status.danger : tk.text.disabled;
  const text = native
    ? (status === 'connected' ? `Listening on UDP ${port}` : status === 'connecting' ? 'Starting…' : status === 'error' ? (oscClient.getError() || 'Couldn’t listen') : 'Not listening')
    : (status === 'connected' ? 'Bridge connected' : status === 'connecting' ? 'Connecting…' : status === 'error' ? 'No bridge running' : 'Not connected');
  const portInput = (
    <NumberInput value={port} min={1} max={65535} step={1} title={native ? 'UDP port to listen on (send OSC here)' : 'The bridge’s WebSocket port'} onCommit={n => { const p = Math.round(n); setPort(p); oscClient.setPort(p); }} style={{ width: 52, height: 22, borderRadius: 5, border: 0, background: tk.bg.field, color: tk.text.primary, font: `500 10.5px ${fontFamily.mono}`, textAlign: 'center' }} />
  );
  const downloadBridge = async () => {
    const { buildStandaloneBridge, BRIDGE_FILE_NAME } = await import('../../play/bridgeDownload');
    const { saveTextFile } = await import('../../utils/fileIO');
    reportFileResult(await saveTextFile(buildStandaloneBridge(), BRIDGE_FILE_NAME, 'text/javascript'), { failTitle: 'Couldn’t save the bridge', success: `Saved ${BRIDGE_FILE_NAME}` });
  };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', minWidth: 0 }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: colour, flexShrink: 0 }} />
      <span title={text} style={{ color: status === 'error' ? tk.status.danger : tk.text.muted, font: `11px ${fontFamily.ui}`, maxWidth: 190, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{text}</span>
      {portInput}
      {native ? (
        <>
          <Toggle checked={lan} onChange={on => { setLan(on); oscClient.setLan(on); }} label="Phones too" />
          {status === 'connected'
            ? <Button size="sm" variant="ghost" onClick={() => oscClient.setWanted(false)}>Stop</Button>
            : <Button size="sm" onClick={() => oscClient.setWanted(true)}>Start listening</Button>}
        </>
      ) : (
        <>
          {status !== 'connected' && <Button size="sm" onClick={() => oscClient.setWanted(true)}>Connect</Button>}
          {status === 'error' && (
            <>
              <Button size="sm" icon="export" onClick={() => void downloadBridge()} title="A small program that passes OSC to this tab. Needs Node.js (nodejs.org).">Download bridge</Button>
              <Button size="sm" variant="ghost" icon="copy" title="Copy the command that starts it (run it in Terminal where the file downloaded)" onClick={() => { void navigator.clipboard?.writeText('node shader-studio-osc-bridge.mjs').then(() => toast.success('Command copied', { message: 'Paste it in Terminal, in the folder the bridge downloaded to.' })); }}>Command</Button>
            </>
          )}
        </>
      )}
    </span>
  );
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

/** Live audio input: status, which device, start/stop. Browsers ask for microphone permission for any input. */
function LiveAudioChip() {
  const tk = useTokens();
  const [status, setStatus] = useState<LiveStatus>(() => liveAudio.getStatus());
  const [devices, setDevices] = useState<Array<{ id: string; label: string }>>([]);
  const [deviceId, setDeviceId] = useState(() => liveAudio.getDeviceId());
  useEffect(() => liveAudio.onStatus(st => { setStatus(st); setDeviceId(liveAudio.getDeviceId()); if (st === 'on') void liveAudio.devices().then(setDevices); }), []);
  useEffect(() => { if (liveAudio.isOn()) void liveAudio.devices().then(setDevices); }, []);
  const colour = status === 'on' ? tk.status.success : status === 'requesting' ? tk.status.warning : status === 'denied' ? tk.status.danger : tk.text.disabled;
  const text = status === 'on' ? (liveAudio.getLabel() || 'Listening') : status === 'requesting' ? 'Asking…' : status === 'denied' ? 'Blocked or no input' : status === 'unsupported' ? 'Not available here' : 'Not listening';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', minWidth: 0 }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: colour, flexShrink: 0 }} />
      <span style={{ color: tk.text.muted, font: `11px ${fontFamily.ui}`, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={text}>{text}</span>
      {status === 'on' && devices.length > 1 && (
        <Select ariaLabel="Audio input" value={deviceId} options={devices.map(d => ({ value: d.id, label: d.label }))} onChange={id => { setDeviceId(id); void liveAudio.start(id); }} height={24} style={{ maxWidth: 160 }} />
      )}
      {status !== 'on' && status !== 'unsupported' && <Button size="sm" onClick={() => void liveAudio.start(deviceId)}>Listen</Button>}
      {status === 'on' && <Button size="sm" variant="ghost" onClick={() => liveAudio.stop()}>Stop</Button>}
    </span>
  );
}
