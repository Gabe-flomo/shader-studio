/**
 * The Controls page's controls column (pages/ControlsPage.tsx): a control's
 * card (ControlRow, its live ControlBody, a pair's card), a control group,
 * and the Add control menu.
 */
import { can, requireFeature } from '../../../lib/plan';
import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { useNodeGraphStore } from '../../../store/useNodeGraphStore';
import { useTokens } from '../../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../../theme/tokens';
import type { PlayControl, PlayLayer } from '../../../types/play';
import { SwingStrip } from '../inputs/SwingStrip';
import type { Swing } from '../../../play/controlSwing';
import { openDetail } from '../detail/detailStore';
import { playEngine } from '../../../lib/playEngine';
import { candidateLabel, type PlayCandidate, type TargetFate } from '../../../play/playControls';
import { Button, IconButton } from '../../ui/Button';
import { useNarrow } from '../../../hooks/useNarrow';
import { Toggle } from '../../ui/Choice';
import { Field } from '../../ui/Field';
import { Icon } from '../../ui/Icon';
import { Popover } from '../../ui/Popover';
import { Tooltip } from '../../ui/Tooltip';
import { RulerSlider } from '../../ui/RulerSlider';
import { NumberInput } from '../../NodeGraph/NumberInput';
import { NOTE_REF_TYPE, noteRef } from '../noteRefs';
import { graphNullDrives, layerNullDrives, type NullDrive } from '../layerOps';
import { toast } from '../../ui/toastStore';
import { usePlayUi } from '../playUi';
import { MiniMapper } from '../MiniMapper';
import { wireControlOnly, type MiniMapperTarget } from '../miniMapperCore';
import { ColourPad } from '../ColourPad';
import { useLiveValue } from '../liveValueStore';
import { actionTarget, layerTarget, type ActionKind } from '../../../types/play';
import { finishTarget } from '../../../types/playFinish';
import { actionLabel } from '../layers/help';
import { Menu } from '../../ui/Menu';
import { PairCard } from '../PairControls';
import { PHONE_TARGET } from '../PlayPage';
import { PANEL_GRID } from './shared';
import { round3 } from './SourceFields';

// ── A control group ──────────────────────────────────────────────────────────

/** Controls under one heading (PlayControl.group), folded per group on this device; spans the split view's grid. */
export function ControlGroup({ name, count, grid, children }: { name: string; count: number; grid: boolean; children: ReactNode }) {
  const tk = useTokens();
  const key = `ctlgroup:${name}`;
  const folded = usePlayUi(s => !!s.folded[key]);
  const toggleFold = usePlayUi(s => s.toggleFold);
  return (
    <div data-control-group={name} style={{ marginTop: 8, padding: '4px 6px 6px', borderRadius: radius.card, background: alpha(tk.accent.base, 0.05), boxShadow: `inset 0 0 0 1px ${tk.border.subtle}`, transition: 'box-shadow 0.3s', ...(grid ? { gridColumn: '1 / -1' } : {}) }}>
      <button type="button" onClick={() => toggleFold(key, !folded)} aria-expanded={!folded} title={folded ? 'Show the group' : 'Fold the group'}
        style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', border: 0, background: 'none', padding: '4px 2px', cursor: 'pointer', color: tk.text.secondary, font: `600 11px ${fontFamily.ui}`, letterSpacing: '0.02em', textAlign: 'left' }}>
        <Icon name={folded ? 'chevR' : 'chevD'} size={12} style={{ color: tk.text.faint }} />
        <Icon name="wave" size={12} style={{ color: tk.text.faint }} />
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
        <span style={{ color: tk.text.faint, font: `500 10.5px ${fontFamily.mono}` }}>{count}</span>
      </button>
      {!folded && <div style={grid ? PANEL_GRID : undefined}>{children}</div>}
    </div>
  );
}

// ── Add control ──────────────────────────────────────────────────────────────

/** A layer's numbers, for the Add control menu. */
export interface LayerCandidates { id: string; label: string; props: Array<{ key: string; label: string; hint?: string; min: number; max: number; step?: number }>; actions: ActionKind[] }

export function AddControlButton({ candidates, layers, finish, sound, layerById, taken, onAdd, onAddFinish, onAddSound, onAddAction, onAddNull, compact = false }: {
  /** Phones: a 44px "+ Control" (the header holds only it and ⋯). */
  compact?: boolean;
  candidates: PlayCandidate[];
  layers: LayerCandidates[];
  layerById: (id: string) => PlayLayer | undefined;
  taken: Set<string>;
  onAdd: (c: PlayCandidate) => void;
  /** The Finish stack's effects and their numbers. */
  finish: LayerCandidates[];
  onAddFinish: (effectId: string, key: string, withNull: boolean) => void;
  /** The audio effects and their numbers (a host's id is its target before `::`). */
  sound: LayerCandidates[];
  onAddSound: (hostId: string, key: string, withNull: boolean) => void;
  onAddAction: (layerId: string, kind: ActionKind) => void;
  /** Add the slider (and its X/Y partner) with a Null layer that drives it. */
  onAddNull: (drives: NullDrive[], label: string) => void;
}) {
  const tk = useTokens();
  const anchor = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [withNull, setWithNull] = useState(false);
  // A source for the control just added, when asked for from its toast (miniMapper.ts).
  const [pending, setPending] = useState<{ target: MiniMapperTarget; label: string } | null>(null);
  // One step: picking a setting adds its control. Mapping a source onto it is an offer after, not a step on the way.
  const setPlay = useNodeGraphStore(s => s.setPlay);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  const addNow = (target: MiniMapperTarget, label: string) => {
    setPlay(p => wireControlOnly(p, target).play);
    toast.success(`Added “${label}”`, {
      message: 'It’s on the panel. Map MIDI, the mouse, audio or an LFO onto it, or leave it as a knob.',
      action: { label: 'Map a source…', onClick: () => setPending({ target, label }), stillValid: () => mounted.current },
    });
  };
  const pickGraph = (c: PlayCandidate) => {
    if (withNull && c.kind === 'float') { const { drives, label } = graphNullDrives(candidates, c); onAddNull(drives, label); return; }
    if (withNull) { onAdd(c); return; }
    addNow({ candidate: c }, candidateLabel(c));
  };
  const pickLayer = (l: LayerCandidates, key: string) => {
    if (withNull) {
      const layer = layerById(l.id);
      const r = layer && layerNullDrives(layer, key);
      if (r) onAddNull(r.drives, r.label);
      return;
    }
    addNow({ layerId: l.id, key }, `${l.label} · ${l.props.find(p => p.key === key)?.label ?? key}`);
  };
  // Folders: 'graph', 'layers', and one per layer id. The graph starts open; layers start folded.
  const [unfolded, setUnfolded] = useState<Set<string>>(() => new Set(['graph', 'layers']));
  const flip = (k: string) => setUnfolded(prev => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const q = query.trim().toLowerCase();
  const close = () => { setOpen(false); setQuery(''); };
  // With a null, a slider already on the panel can still get one (the null drives the existing control); colours and buttons can't.
  const graphShown = candidates.filter(c => (withNull ? c.kind === 'float' : !taken.has(c.target)) && (!q || candidateLabel(c).toLowerCase().includes(q)));
  const layerShown = layers.map(l => ({
    ...l,
    props: l.props.filter(pr => (withNull || !taken.has(layerTarget(l.id, pr.key))) && (!q || `${l.label} ${pr.label}`.toLowerCase().includes(q))),
    actions: withNull ? [] : l.actions.filter(a => !taken.has(actionTarget(l.id, a)) && (!q || `${l.label} ${actionLabel(a, layerById(l.id))}`.toLowerCase().includes(q))),
  })).filter(l => l.props.length + l.actions.length > 0);
  const layerCount = layerShown.reduce((n, l) => n + l.props.length + l.actions.length, 0);
  const finishShown = finish.map(f => ({ ...f, props: f.props.filter(pr => (withNull || !taken.has(finishTarget(f.id, pr.key))) && (!q || `${f.label} ${pr.label}`.toLowerCase().includes(q))) })).filter(f => f.props.length > 0);
  const finishCount = finishShown.reduce((n, f) => n + f.props.length, 0);
  const soundShown = sound.map(f => ({ ...f, props: f.props.filter(pr => (withNull || !taken.has(`${f.id}::${pr.key}`)) && (!q || `${f.label} ${pr.label}`.toLowerCase().includes(q))) })).filter(f => f.props.length > 0);
  const soundCount = soundShown.reduce((n, f) => n + f.props.length, 0);
  // While searching every folder with a match is open.
  const isOpen = (k: string) => !!q || unfolded.has(k);
  const itemStyle: React.CSSProperties = {
    width: '100%', display: 'flex', alignItems: 'center', gap: 8, height: 30, padding: '0 8px', border: 0, borderRadius: radius.md,
    background: 'none', cursor: 'pointer', color: tk.text.primary, font: `12.5px ${fontFamily.ui}`, textAlign: 'left',
  };
  const hover = {
    onMouseEnter: (e: React.MouseEvent) => ((e.currentTarget as HTMLElement).style.background = tk.bg.hover),
    onMouseLeave: (e: React.MouseEvent) => ((e.currentTarget as HTMLElement).style.background = 'none'),
  };
  const folder = (k: string, title: string, count: number, indent = 0) => (
    <button key={`f:${k}`} type="button" onClick={() => flip(k)} {...hover} style={{ ...itemStyle, height: 28, paddingLeft: 6 + indent, color: tk.text.secondary, font: `650 11.5px ${fontFamily.ui}` }}>
      <Icon name={isOpen(k) ? 'chevD' : 'chevR'} size={12} style={{ color: tk.text.faint }} />
      <Icon name="folder" size={13} style={{ color: tk.text.faint }} />
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
      <span style={{ color: tk.text.faint, font: `500 11px ${fontFamily.mono}` }}>{count}</span>
    </button>
  );
  const nothing = candidates.length === 0 && layers.every(l => l.props.length + l.actions.length === 0) && finish.every(f => f.props.length === 0) && sound.every(f => f.props.length === 0);
  return (
    <span ref={anchor} style={{ display: 'inline-flex' }}>
      {compact
        ? <Button icon="plus" title="Add control" aria-label="Add control" aria-expanded={open} onClick={() => setOpen(o => !o)} disabled={nothing} style={{ height: PHONE_TARGET.height, padding: '0 14px' }}>Control</Button>
        : <Button size="sm" icon="plus" onClick={() => setOpen(o => !o)} disabled={nothing}>Add control</Button>}
      {open && (
        <Popover anchorRef={anchor} onClose={close} align="end" width={320} padding={8}>
          <Field autoFocus placeholder="Search sliders, colours and layers" value={query} onChange={e => setQuery(e.target.value)} height={30} leading={<Icon name="search" size={14} style={{ color: tk.text.faint }} />} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 4px 2px' }}>
            <Toggle checked={withNull} onChange={v => { if (!v || requireFeature('play.layers')) setWithNull(v); }} label={can('play.layers') ? 'With a dot to drag on the picture' : 'With a dot to drag on the picture · Pro'} />
            <Tooltip label="With a dot to drag on the picture" description="Adds the slider and a Null on the picture that drives it: drag the dot to change the value. The dot's left-to-right is the slider's range. An X/Y pair (Position X and Y) shares one null that starts where the thing is.">
              <span style={{ display: 'inline-flex', color: tk.text.faint, cursor: 'help' }}><Icon name="info" size={13} /></span>
            </Tooltip>
          </div>
          <div style={{ maxHeight: 400, overflowY: 'auto', marginTop: 6 }}>
            {graphShown.length === 0 && layerCount === 0 && finishCount === 0 && soundCount === 0 && (
              <div style={{ padding: '10px 8px', color: tk.text.faint }}>{q ? 'No match.' : 'Everything is already on the panel.'}</div>
            )}
            {graphShown.length > 0 && folder('graph', 'From the graph', graphShown.length)}
            {graphShown.length > 0 && isOpen('graph') && graphShown.map(c => (
              <button key={c.target} type="button" title={c.hint} onClick={() => { pickGraph(c); close(); }} {...hover} style={{ ...itemStyle, paddingLeft: 24 }}>
                {c.kind === 'color'
                  ? <span style={{ width: 12, height: 12, borderRadius: 3, background: `rgb(${(c.value as number[]).map(v => Math.round(v * 255)).join(',')})`, boxShadow: `inset 0 0 0 1px ${alpha('#000', 0.12)}`, flexShrink: 0 }} />
                  : <Icon name="curve" size={13} style={{ color: tk.text.faint }} />}
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{candidateLabel(c)}</span>
                {withNull && taken.has(c.target) && <span style={{ color: tk.text.faint, fontSize: 10.5 }}>on panel</span>}
              </button>
            ))}
            {layerCount > 0 && folder('layers', 'From layers', layerCount)}
            {layerCount > 0 && isOpen('layers') && layerShown.map(l => (
              <div key={l.id}>
                {folder(`layer:${l.id}`, l.label, l.props.length + l.actions.length, 14)}
                {isOpen(`layer:${l.id}`) && l.actions.map(a => (
                  <button key={`a:${a}`} type="button" title="A button on the panel. Map a key, a click, a beat or a note onto it to press it." onClick={() => { onAddAction(l.id, a); close(); }} {...hover} style={{ ...itemStyle, paddingLeft: 40 }}>
                    <Icon name="play" size={12} style={{ color: tk.accent.text }} />
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{actionLabel(a, layerById(l.id))}</span>
                    <span style={{ color: tk.text.faint, fontSize: 10.5 }}>button</span>
                  </button>
                ))}
                {isOpen(`layer:${l.id}`) && l.props.map(pr => (
                  <button key={pr.key} type="button" title={pr.hint} onClick={() => { pickLayer(l, pr.key); close(); }} {...hover} style={{ ...itemStyle, paddingLeft: 40 }}>
                    <Icon name="curve" size={13} style={{ color: tk.text.faint }} />
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pr.label}</span>
                    {withNull && taken.has(layerTarget(l.id, pr.key)) && <span style={{ color: tk.text.faint, fontSize: 10.5 }}>on panel</span>}
                  </button>
                ))}
              </div>
            ))}
            {finishCount > 0 && folder('finish', 'From the Finish stack', finishCount)}
            {finishCount > 0 && isOpen('finish') && finishShown.map(f => (
              <div key={f.id}>
                {folder(`finish:${f.id}`, f.label, f.props.length, 14)}
                {isOpen(`finish:${f.id}`) && f.props.map(pr => (
                  <button key={pr.key} type="button" title={pr.hint} onClick={() => { if (withNull) { onAddFinish(f.id, pr.key, withNull); close(); } else { addNow({ effectId: f.id, key: pr.key }, `${f.label} · ${pr.label}`); close(); } }} {...hover} style={{ ...itemStyle, paddingLeft: 40 }}>
                    <Icon name="curve" size={13} style={{ color: tk.text.faint }} />
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pr.label}</span>
                    {withNull && taken.has(finishTarget(f.id, pr.key)) && <span style={{ color: tk.text.faint, fontSize: 10.5 }}>on panel</span>}
                  </button>
                ))}
              </div>
            ))}
            {soundCount > 0 && folder('sound', 'From the sound effects', soundCount)}
            {soundCount > 0 && isOpen('sound') && soundShown.map(f => (
              <div key={f.id}>
                {folder(f.id, f.label, f.props.length, 14)}
                {isOpen(f.id) && f.props.map(pr => (
                  <button key={pr.key} type="button" title={pr.hint} onClick={() => { if (withNull) { onAddSound(f.id, pr.key, withNull); close(); } else { addNow({ audioFx: `${f.id}::${pr.key}` }, `${f.label} · ${pr.label}`); close(); } }} {...hover} style={{ ...itemStyle, paddingLeft: 40 }}>
                    <Icon name="wave" size={13} style={{ color: tk.text.faint }} />
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pr.label}</span>
                    {withNull && taken.has(`${f.id}::${pr.key}`) && <span style={{ color: tk.text.faint, fontSize: 10.5 }}>on panel</span>}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </Popover>
      )}
      {pending && <MiniMapper anchorRef={anchor} target={pending.target} label={pending.label} onClose={() => setPending(null)} />}
    </span>
  );
}

// ── Control row ──────────────────────────────────────────────────────────────

/** Where a control's value lives: a layer's property or a node's param. */
export interface ControlSource { kind: 'layer' | 'node' | 'reader'; title: string; param: string; within?: string; missing: boolean; go: () => void }

/** A pair's card with its two live values, read here so only this card renders when they move. */
export function LivePairCard({ liveOn, ...props }: Omit<ComponentProps<typeof PairCard>, 'live'> & { liveOn: boolean }) {
  const la = useLiveValue(props.a.id, liveOn), lb = useLiveValue(props.b.id, liveOn);
  return <PairCard {...props} live={[la, lb]} />;
}

export function ControlRow({ control, index, count, exists, fate, onRelink, help, source, value, liveOn, drivenBy, drivers = [], onDriver, touch, onChange, onRename, onRange, onMove, onRemove, removeLabel = 'Remove from panel', onLearn, onNull, onAmount, trace, onName, isolated = false, swing, onChip }: {
  control: PlayControl;
  index: number;
  count: number;
  exists: boolean;
  /** Why it's missing, when it is (moved into a group, deleted…). */
  fate?: TargetFate;
  /** Point the control at where its slider is now. */
  onRelink: (target: string) => void;
  /** The param's hint and the node's comment from the graph, shown on the ⓘ. */
  help: { hint?: string; comment?: string };
  source: ControlSource;
  value: number | number[] | undefined;
  /** Something is mapped: the row reads its own live value (liveValueStore). */
  liveOn: boolean;
  drivenBy: string[];
  /** Each driver with its id: the details' "Mapped by" list opens it in Sources (Play audit P7). */
  drivers?: Array<{ id: string; label: string }>;
  onDriver?: (id: string) => void;
  touch: boolean;
  onChange: (v: number | number[]) => void;
  onRename: (label: string) => void;
  onRange: (min: number, max: number) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  /** What the trash does (a reader's control goes with its reader). */
  removeLabel?: string;
  /** Learn onto this control (Learn mode with it picked). */
  onLearn: () => void;
  /** Add a Null on the picture that drives this control (sliders only). */
  onNull?: () => void;
  /** Action controls: how much (particles for a burst, strength for a scatter). */
  onAmount: (amount: number) => void;
  /** The Controls board's live graph, under the slider. */
  trace?: ReactNode;
  /** The board: clicking the name isolates the graph (a double-click renames). */
  onName?: () => void;
  isolated?: boolean;
  /** The part of its range its sources can move it across (play/controlSwing.ts), shaded under the slider. */
  swing?: Swing | null;
  /** What the "driven by" chip does instead of opening the details window: open the mapping in Sources. */
  onChip?: () => void;
}) {
  const tk = useTokens();
  const [hover, setHover] = useState(false);
  // A narrow card folds the hover tools into ⋯; so does a phone's, so the name has the room (Play audit P20).
  const headRef = useRef<HTMLDivElement>(null);
  const tight = useNarrow(headRef, 260) || touch;
  const [toolsMenu, setToolsMenu] = useState<{ x: number; y: number } | null>(null);
  const [details, setDetails] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(control.label);
  const driven = drivenBy.length > 0;
  const commitLabel = () => { setEditing(false); const t = draft.trim(); if (t && t !== control.label) onRename(t); else setDraft(control.label); };

  return (
    <div
      data-control-id={control.id}
      // A tap on the card itself (not a slider or a button) opens its details.
      onClick={e => { if (e.target === e.currentTarget || (e.target as HTMLElement).dataset.cardBg) setDetails(d => !d); }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        padding: '10px 10px 10px 12px', marginTop: 6, borderRadius: radius.card, background: tk.bg.panel, transition: 'box-shadow 0.3s',
        boxShadow: `inset 0 0 0 1px ${driven ? alpha(tk.accent.base, 0.45) : tk.border.default}`, opacity: exists || fate?.status === 'moved' ? 1 : 0.6,
      }}
    >
      <div ref={headRef} data-card-bg="1" style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 26, marginBottom: 6 }}>
        <IconButton icon={details ? 'chevD' : 'chevR'} label={details ? 'Hide details' : 'Details: where it comes from'} size="sm" tooltip={false} onClick={() => setDetails(d => !d)} style={{ marginLeft: -6 }} />
        <span
          draggable
          onDragStart={e => { e.dataTransfer.setData(NOTE_REF_TYPE, noteRef('control', control.id)); e.dataTransfer.setData('text/plain', noteRef('control', control.id)); e.dataTransfer.effectAllowed = 'copy'; }}
          title="Drag onto the notes to link this control"
          style={{ display: touch ? 'none' : 'inline-flex', color: tk.text.faint, cursor: 'grab', marginLeft: -4, visibility: hover ? 'visible' : 'hidden' }}
        ><Icon name="grip" size={12} /></span>
        {editing ? (
          <Field autoFocus value={draft} onChange={e => setDraft(e.target.value)} onBlur={commitLabel} onKeyDown={e => { if (e.key === 'Enter') commitLabel(); if (e.key === 'Escape') { setDraft(control.label); setEditing(false); } }} height={26} style={{ flex: 1 }} />
        ) : (
          <button
            type="button"
            title={onName ? (isolated ? 'Isolated at the top: click to unpin (double-click to rename)' : 'Isolate its graph at the top (double-click to rename)') : 'Rename'}
            aria-pressed={onName ? isolated : undefined}
            onClick={() => { if (onName) { onName(); return; } setDraft(control.label); setEditing(true); }}
            onDoubleClick={onName ? () => { setDraft(control.label); setEditing(true); } : undefined}
            data-control-name=""
            style={{
              flex: 1, minWidth: 0, textAlign: 'left', border: 0, background: 'none', padding: 0, cursor: onName ? 'pointer' : 'text', color: isolated ? tk.accent.text : tk.text.primary, font: `600 12.5px ${fontFamily.ui}`, overflow: 'hidden',
              // A phone wraps a long name onto a second line rather than cutting it to "Radiu…".
              ...(touch ? { whiteSpace: 'normal', overflowWrap: 'anywhere', lineHeight: 1.25, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' } : { textOverflow: 'ellipsis', whiteSpace: 'nowrap' }),
            }}
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
          <button type="button" data-driven-chip="" title={`${drivenBy.join(', ')}: ${onChip ? 'open the mapping' : 'open its details'}`} onClick={onChip ?? (() => openDetail('control', control.id))} style={{ height: 20, padding: '0 7px', border: 0, borderRadius: 6, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, background: alpha(tk.accent.base, 0.12), color: tk.accent.text, font: `600 10.5px ${fontFamily.ui}`, whiteSpace: 'nowrap', minWidth: 0, flexShrink: 1, maxWidth: touch ? '40%' : '50%', ...(touch ? { height: 28 } : null) }}>
            <Icon name="bidir" size={11} /><span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{drivenBy[0]}{drivenBy.length > 1 ? ` +${drivenBy.length - 1}` : ''}</span>
          </button>
        )}
        {!exists && <span style={{ color: tk.status.warningText, font: `600 10.5px ${fontFamily.ui}` }}>{fate?.status === 'moved' ? 'moved' : 'missing'}</span>}
        {/* On a narrow card the hover tools are one ⋯ button, so they never run past the edge. */}
        {tight ? (
          <span style={{ display: 'flex', flexShrink: 0, visibility: hover || touch || toolsMenu ? 'visible' : 'hidden' }}>
            <IconButton icon="more" label="More: details, move, remove" size="sm" tooltip={false} onClick={e => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setToolsMenu({ x: r.right - 200, y: r.bottom + 4 }); }} />
            {toolsMenu && <Menu x={toolsMenu.x} y={toolsMenu.y} minWidth={200} onClose={() => setToolsMenu(null)} items={[
              { label: 'Open its details', icon: 'popout', onSelect: () => openDetail('control', control.id) },
              { label: 'Move up', icon: 'chevU', disabled: index === 0, onSelect: () => onMove(-1) },
              { label: 'Move down', icon: 'chevD', disabled: index === count - 1, onSelect: () => onMove(1) },
              'separator',
              { label: removeLabel, icon: 'trash', danger: true, onSelect: onRemove },
            ]} />}
          </span>
        ) : (
          <span style={{ display: 'flex', gap: 0, flexShrink: 0, visibility: hover || touch ? 'visible' : 'hidden' }}>
            <IconButton icon="popout" label="Open its details: what drives it, the rules on it, where it goes" size="sm" tooltip={false} onClick={() => openDetail('control', control.id)} />
            <IconButton icon="chevU" label="Move up" size="sm" disabled={index === 0} tooltip={false} onClick={() => onMove(-1)} />
            <IconButton icon="chevD" label="Move down" size="sm" disabled={index === count - 1} tooltip={false} onClick={() => onMove(1)} />
            <IconButton icon="trash" label={removeLabel} size="sm" tone="danger" tooltip={false} onClick={onRemove} />
          </span>
        )}
      </div>
      <ControlBody control={control} value={value} liveOn={liveOn} driven={driven} exists={exists} source={source} onChange={onChange} onRange={onRange} touch={touch} swing={swing} />
      {/* The live graph only while something drives it: a hand-moved control's line is flat news. */}
      {driven && trace}
      {!exists && fate && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 6px', padding: '6px 8px', borderRadius: radius.md, background: alpha(tk.status.warning, 0.12), color: tk.text.secondary, font: `11.5px/1.4 ${fontFamily.ui}` }}>
          <span style={{ flex: 1, minWidth: 0 }}>
            {fate.status === 'moved' ? <>Its node was grouped: it’s now inside <b>{fate.groups.join(' › ')}</b>.</>
              : fate.status === 'param' ? 'Its node is still there, but not this slider (the node changed, or the slider is wired or hidden).'
              : source.kind === 'layer' ? 'Its layer was deleted.' : source.kind === 'reader' ? 'Its reader was deleted.' : 'Its node was deleted.'}
          </span>
          {fate.status === 'moved' && <Button size="sm" variant="primary" onClick={() => onRelink(fate.target)} title="Point this control at the slider in its new place">Relink</Button>}
        </div>
      )}
      {details && (
        <div style={{ marginTop: 10, paddingTop: 8, borderTop: `1px solid ${tk.border.subtle}`, display: 'flex', flexDirection: 'column', gap: 6, font: `12px/1.45 ${fontFamily.ui}`, color: tk.text.secondary }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name={source.kind === 'layer' ? 'layoutCanvas' : source.kind === 'reader' ? 'wave' : 'nodes'} size={14} style={{ color: tk.text.faint, flexShrink: 0 }} />
            <span style={{ flex: 1, minWidth: 0 }}>
              {source.kind === 'layer' ? 'Layer' : source.kind === 'reader' ? 'Reader in' : 'Node'} <b style={{ color: source.missing ? tk.status.warningText : tk.text.primary }}>{source.title}</b>
              {source.within && <> in group <b>{source.within}</b></>} · {source.param}
            </span>
            <Button size="sm" variant="ghost" disabled={source.missing} onClick={source.go}>{source.kind === 'layer' ? 'Go to layer' : source.kind === 'reader' ? 'Open readers' : 'Show in graph'}</Button>
          </div>
          {help.hint && <div style={{ color: tk.text.muted }}>{help.hint}</div>}
          {help.comment && <div style={{ color: tk.text.muted }}><b>Note on the node:</b> {help.comment}</div>}
          {control.kind === 'float' && (
            // No min/max editor (the slider rule): typing a value past either end on the slider widens it.
            <div data-control-range="" style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ color: tk.text.faint, font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.04em', textTransform: 'uppercase', width: 62, flexShrink: 0 }}>Range</span>
              <span style={{ color: tk.text.secondary, font: `500 11.5px ${fontFamily.mono}` }}>{round3(control.min)} – {round3(control.max)}</span>
              <span style={{ color: tk.text.faint, font: `11px ${fontFamily.ui}` }}>Type a value past either end to widen it.</span>
            </div>
          )}
          {control.kind === 'action' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: tk.text.faint, font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.04em', textTransform: 'uppercase', width: 62 }}>Amount</span>
              <NumberInput value={control.amount ?? 1} min={0} max={1000} step={source.param === actionLabel('burst') ? 10 : 0.1} title="Burst: how many particles. Scatter: how hard. Go to: which background, from 1. Others ignore it." onCommit={n => onAmount(Math.max(0, n))} style={{ width: 64, height: 24, borderRadius: 6, border: 0, background: tk.bg.field, color: tk.text.primary, font: `500 11.5px ${fontFamily.mono}`, textAlign: 'center' }} />
              <span style={{ color: tk.text.faint, fontSize: 11 }}>A mapping presses it each time it rises past the middle of its range.</span>
            </div>
          )}
          {/* The label over the text, the buttons under it: never a one-word-per-line column beside them. */}
          {/* "Mapped by" (Play audit P7): each driver opens its card in Sources; Learn maps the next knob or key here. */}
          <div data-driven-by="" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ color: tk.text.faint, font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Mapped by</span>
            {drivers.length > 0 && onDriver ? (
              <span style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {drivers.map(d => (
                  <button key={d.id} type="button" data-mapped-by={d.id} title="Open it in Sources" onClick={() => onDriver(d.id)}
                    style={{ height: 22, padding: '0 8px', border: 0, borderRadius: 6, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, maxWidth: '100%', background: alpha(tk.accent.base, 0.1), color: tk.accent.text, font: `600 11px ${fontFamily.ui}` }}>
                    <Icon name="bidir" size={11} /><span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.label}</span>
                  </button>
                ))}
              </span>
            ) : <span style={{ minWidth: 0 }}>{driven ? drivenBy.join(', ') : 'Nothing yet: drag the slider, or map an input onto it.'}</span>}
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', marginLeft: -6 }}>
              <Button size="sm" variant="ghost" icon="spark" title="Learn: the next knob, note or key you move drives this control" onClick={onLearn}>Learn</Button>
              {onNull && <Button size="sm" variant="ghost" icon="plus" title="Add a Null on the picture that drives this slider: drag the dot to change it" onClick={onNull}>Null</Button>}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

/** A control's slider, switch, colour or button: the part that shows its live value, so only it renders as that moves. */
function ControlBody({ control, value, liveOn, driven, exists, source, onChange, onRange, touch, swing }: {
  control: PlayControl;
  value: number | number[] | undefined;
  liveOn: boolean;
  driven: boolean;
  exists: boolean;
  source: ControlSource;
  onChange: (v: number | number[]) => void;
  onRange: (min: number, max: number) => void;
  touch: boolean;
  swing?: Swing | null;
}) {
  const tk = useTokens();
  const live = useLiveValue(control.id, liveOn);
  const shown = driven && live !== undefined ? live : value;
  return (
    control.kind === 'action' ? (
      // A button: press it here, or map a key, a click, a beat or a note onto it.
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Button size="sm" variant="primary" icon="play" disabled={!exists} onClick={() => playEngine.fireControl(control.id)} style={{ flex: 1, justifyContent: 'center', boxShadow: typeof live === 'number' && live >= 0.5 ? `0 0 0 2px ${alpha(tk.accent.base, 0.5)}` : undefined }}>
          {source.param}
        </Button>
        {!driven && <span style={{ color: tk.text.faint, fontSize: 11 }}>Map a key or click to press it</span>}
      </div>
    ) : control.kind === 'color' ? (
      // A mapping on a colour scales it or sets one channel; the rest comes from
      // this colour, so it stays editable while driven. The live result shows beside it.
      <ColourPad value={Array.isArray(value) ? value : [0, 0, 0]} live={driven && Array.isArray(live) ? live : undefined} disabled={!exists} onChange={onChange} />
    ) : control.toggle ? (
      // A switch: off is the low end, on the high end (a boolean control, a number underneath).
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Toggle
          checked={typeof shown === 'number' && shown >= (control.min + control.max) / 2}
          disabled={!exists || driven}
          onChange={on => onChange(on ? control.max : control.min)}
          label={typeof shown === 'number' && shown >= (control.min + control.max) / 2 ? 'On' : 'Off'}
        />
      </div>
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
            // Typing a value past the range widens it: the control keeps the new range.
            onRange={onRange}
            ariaLabel={control.label}
            touch={touch}
          />
          {swing && <SwingStrip swing={swing} min={control.min} max={control.max} step={control.step ?? 0.01} live={typeof live === 'number' ? live : undefined} />}
        </div>
      </div>
    )
  );
}

