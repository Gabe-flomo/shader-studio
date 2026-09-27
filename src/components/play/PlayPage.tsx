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
import { offerPlayExport } from '../playfile/exportMenus';
import { can, openProSheet, requireFeature, useCan, usePlanName } from '../../lib/plan';
import { sourceNeedsPro, sourceTypeNeedsPro, triggerNeedsPro, proOnlyParts } from '../../play/planGates';
import { ProBadge, ProLock } from '../account/ProSheet';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { DataSourceOptions } from './DataSourceOptions';
import { getNodeDefinitionFor } from '../../nodes/definitions';
import type { GraphNode } from '../../types/nodeGraph';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import type { PlayControl, PlayLayer, PlayMapping, PlayRecord, PlaySource } from '../../types/play';
import { CHANNELS, COLOUR_CHANNELS, CURVES, HAND_GESTURE_OPTIONS, HAND_READ_HINTS, HAND_SIDES, LFO_SHAPES, LIVE_BAND_OPTIONS, NOISE_TYPES, PINCH_FINGERS, SENSOR_HINTS, SENSOR_LABELS, OPEN_READERS, TILT_AXES, TRIGGER_MODES, keyName, sourceFromType, withFire, sourceLabel, sourceType, type SourceType } from '../../play/playSources';
import { sensorReadsFor, type SensorRead } from '../../types/play';
import { ConnectGuide } from './ConnectGuide';
import type { LfoShape, LiveAudioBand, TriggerSpec } from '../../types/play';
import { applyCurve, playEngine, sampleCurve, type ControlValue } from '../../lib/playEngine';
import { midiEngine, midiNoteName } from '../../lib/midiEngine';
import {
  candidateLabel, collectPlayCandidates, controlExists, controlHelp, findTargetNode, locateTarget, playId, readControlValue, targetParts, type PlayCandidate, type TargetFate,
} from '../../play/playControls';
import { Button, IconButton } from '../ui/Button';
import { Segmented, Toggle } from '../ui/Choice';
import { Field } from '../ui/Field';
import { Icon } from '../ui/Icon';
import { Popover } from '../ui/Popover';
import { Tooltip } from '../ui/Tooltip';
import { RulerSlider } from '../ui/RulerSlider';
import { Select } from '../ui/Select';
import { GroupedPicker } from '../ui/GroupedPicker';
import { HAND_POINT_SECTIONS, sourcePickerSections } from './sourcePickerSections';
import { NumberInput } from '../NodeGraph/NumberInput';
import { reportFileResult } from '../shell/reportFileResult';
import { LayersPanel } from './LayersPanel';
import { FinishPanel } from './finish/FinishPanel';
import { NotesCard } from './NotesCard';
import { AspectPicker, CanvasFullscreenButton } from '../shell/PreviewChrome';
import { NOTE_REF_TYPE, noteRef, type NoteRefKind } from './noteRefs';
import { LayerContextMenu } from './LayerContextMenu';
import { driveWithNull, graphNullDrives, layerNullDrives, pairedKey, type NullDrive } from './layerOps';
import { toast } from '../ui/toastStore';
import { usePlayUi, type PanelSize } from './playUi';
import { setLayerDropHandler } from '../../play/layerDrop';
import { addDroppedLayers, dropLabel } from './dropLayers';
import { appDropMakers } from './dropMakers';
import { sidebarView, useBigTab, usePlaySplit } from './playSplit';
import { SplitButton } from './PlaySplitArea';
import { EmbedDialog } from './EmbedDialog';
import { LiveAudioChip, MidiStatusChip, OscStatusChip } from './chips';
import { HandsButton, HandsChip } from './HandsChip';
import { handFeed } from '../../lib/handFeed';
import { usesHands, type HandGesture } from '../../types/play';
import { ColourPad } from './ColourPad';
import { useLiveValues } from './useLiveValues';
import { useStage } from './stageStore';
import { useTakes } from '../../lib/takes';
import { SoloButton, SoloStrip } from './Solo';
import { GuidesToggle } from './GuidesToggle';
import { OpenPlayableButton } from './OpenPlayable';
import { MidiFileCard } from './MidiFileCard';
import { AnchorPicker, FirePicker, TriggerPicker, type TriggerLayerRef } from './TriggerPicker';
import { actionsForLayer, layerNumericProps, actionTarget, defaultActionAmount, layerTarget, parseActionTarget, parseLayerTarget, parsePropTarget, type ActionKind } from '../../types/play';
import { finishHost, finishHostLabel, finishHosts, finishNumericProps, finishParamOf, finishTarget, parseFinishTarget, patchFinishEffect, readFinishValue } from '../../types/playFinish';
import { playBackground } from '../../play/background';
import { BackgroundRow } from './BackgroundRow';
import { actionLabel } from './layers/help';
import { AudioReadersHost } from './AudioReadersPanel';
import { useReadersPanel } from './readersPanelUi';
import { formatHz, formatWidth } from '../../play/audioReaders';
import type { AudioReader } from '../../types/play';
import type { PlayPairMapping } from '../../types/play';
import { ContextMenuArea } from '../ui/ContextMenuArea';
import type { MenuItem } from '../ui/Menu';
import { PairCard, PairMappingRow, pairMappingLabel } from './PairControls';
import { makePair, newPairMapping, pairOf, partnerTarget, positionPair, unpair } from '../../play/pairs';
import { pairDrives, signalSource } from '../../lib/playEngine';
import { SIGNAL_SOURCE } from './sourcePickerSections';

// ── Live values (polled, not per store write) ───────────────────────────────

/**
 * The engine's last written value per driven control, refreshed ~30 times a
 * second while anything is mapped. State only changes when a value does, so
 * an idle panel re-renders nothing.
 */
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

/**
 * `compact`: phones (tabs for everything, one scroll under the picture).
 * `canvasRow`: the picture's shape picker in the panel, for layouts whose preview has no header (tablets).
 */
export function PlayPage({ compact = false, canvasRow = false }: { compact?: boolean; canvasRow?: boolean }) {
  const tk = useTokens();
  const play = useNodeGraphStore(s => s.play);
  const setPlay = useNodeGraphStore(s => s.setPlay);
  const nodes = useNodeGraphStore(s => s.nodes);
  const paramBindings = useNodeGraphStore(s => s.paramBindings);
  const updateNodeParams = useNodeGraphStore(s => s.updateNodeParams);
  const [embedOpen, setEmbedOpen] = useState(false);
  const importGraphFromFile = useNodeGraphStore(s => s.importGraphFromFile);

  // Mouse and keyboard sources listen only while this page shows. Solo is for this page only.
  useEffect(() => {
    playEngine.setPerforming(true);
    usePlayUi.getState().setPerforming(true);
    return () => { playEngine.setPerforming(false); usePlayUi.getState().setPerforming(false); usePlayUi.getState().clearSolo(); };
  }, []);
  // An image, video or colour background replaces the shader while this page shows (the Studio keeps the graph).
  useEffect(() => playBackground.claim(), []);
  // H shows or hides the picture's guides, unless a mapping listens to H.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'KeyH' || e.repeat || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (playEngine.keyIsBound('KeyH')) return;
      usePlayUi.getState().toggleGuides();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // A MIDI mapping, note trigger or note action needs the browser's MIDI access; ask once the page is open.
  const wantsMidi = usesMidi(play);
  useEffect(() => {
    if (wantsMidi) void midiEngine.connectWebMidi();
  }, [wantsMidi]);

  const liveValues = useLiveValues(play);
  const candidates = useMemo(() => collectPlayCandidates(nodes, paramBindings), [nodes, paramBindings]);

  const writeControl = useCallback((control: PlayControl, value: number | number[]) => {
    const ft = parseFinishTarget(control.target);
    if (ft) {
      if (typeof value === 'number') setPlay(p => ({ ...p, finish: patchFinishEffect(p.finish, ft.effectId, { [ft.key]: value }) }));
      return;
    }
    const lt = parseLayerTarget(control.target);
    if (lt) {
      if (typeof value === 'number') setPlay(p => ({ ...p, layers: p.layers.map(l => l.id === lt.layerId ? { ...l, [lt.key]: value } as typeof l : l) }));
      return;
    }
    const { nodeId, paramKey } = targetParts(control.target);
    updateNodeParams(nodeId, { [paramKey]: value }, { immediate: true });
  }, [updateNodeParams, setPlay]);

  const update = useCallback((fn: (p: PlayRecord) => PlayRecord) => setPlay(fn), [setPlay]);
  // Images and videos dropped on the picture become layers where they land (play/layerDrop.ts).
  useEffect(() => setLayerDropHandler({
    label: n => dropLabel(n),
    drop: (files, at) => { void addDroppedLayers(files, at, update, appDropMakers); },
  }), [update]);
  // What this plan runs (play/planGates.ts). Locked parts stay visible, and nothing in the record is removed.
  const layersOk = useCan('play.layers');
  const finishOk = useCan('play.finish');
  const backgroundsOk = useCan('play.backgrounds');
  const websiteOk = useCan('export.website');
  const takesOk = useCan('play.takes');
  const plan = usePlanName();
  const lockedParts = useMemo(() => proOnlyParts(play, plan), [play, plan]);

  const addControl = useCallback((c: PlayCandidate) => {
    update(p => ({
      ...p,
      controls: [...p.controls, {
        id: playId('ctl'), target: c.target, kind: c.kind, label: candidateLabel(c),
        min: c.min, max: c.max, ...(c.step ? { step: c.step } : {}),
      }],
    }));
  }, [update]);

  // Where a control comes from, and how to get there.
  const revealLayerFor = usePlayUi(s => s.reveal);
  const focusNode = useNodeGraphStore(s => s.focusNode);
  const sourceOf = (c: PlayControl): ControlSource => {
    const at = parseActionTarget(c.target);
    if (at) {
      const l = play.layers.find(x => x.id === at.layerId);
      return { kind: 'layer', title: l?.label ?? 'a deleted layer', param: actionLabel(at.do, l), missing: !l, go: () => { if (l) revealLayerFor(l.id); } };
    }
    const ft = parseFinishTarget(c.target);
    if (ft) {
      const e = finishHost(play.finish, ft.effectId);
      return { kind: 'layer', title: e ? `Finish · ${finishHostLabel(e)}` : 'a removed Finish effect', param: (e && finishParamOf(e, ft.key)?.label) ?? ft.key, missing: !e, go: () => { if (e) usePlayUi.getState().revealFinish(e.id); } };
    }
    const lt = parseLayerTarget(c.target);
    if (lt) {
      const l = play.layers.find(x => x.id === lt.layerId);
      const d = l ? layerNumericProps(l).find(x => x.key === lt.key) : undefined;
      return { kind: 'layer', title: l?.label ?? 'a deleted layer', param: d?.label ?? lt.key, missing: !l, go: () => { if (l) revealLayerFor(l.id); } };
    }
    const { nodeId } = targetParts(c.target);
    const top = nodes.find(n => n.id === nodeId), node = findTargetNode(nodes, c.target);
    const key = c.target.split('::').pop() ?? '';
    const nameOf = (n: GraphNode) => (typeof n.params.label === 'string' && n.params.label.trim()) || getNodeDefinitionFor(n)?.label || n.type;
    const param = (node && getNodeDefinitionFor(node)?.paramDefs?.[key]?.label) || key;
    return {
      kind: 'node', title: node ? nameOf(node) : 'a deleted node', param, missing: !node,
      within: top && node && top !== node ? nameOf(top) : undefined,
      go: () => { if (top) focusNode(top.id); },
    };
  };

  // Every layer's numbers can be controls too (the + beside them in the Layers tab does the same).
  const layerCandidates = useMemo<LayerCandidates[]>(() => play.layers.map(l => ({
    id: l.id, label: l.label,
    props: layerNumericProps(l).map(d => ({ key: d.key, label: d.label, hint: d.hint, min: d.min, max: d.max, ...(d.step ? { step: d.step } : {}) })),
    actions: actionsForLayer(l),
  })), [play.layers]);
  // The Finish stack's numbers (types/playFinish.ts): targets `finish:<effect>::<key>`.
  const finishCandidates = useMemo<LayerCandidates[]>(() => finishHosts(play.finish).map(e => ({
    id: e.id, label: `Finish · ${finishHostLabel(e)}`,
    props: finishNumericProps(e).map(d => ({ key: d.key, label: d.label, hint: d.hint || undefined, min: d.min, max: d.max, ...(d.step ? { step: d.step } : {}) })),
    actions: [],
  })), [play.finish]);
  const addFinishControl = useCallback((effectId: string, key: string, withNull: boolean) => {
    const e = finishHost(play.finish, effectId);
    const d = e && finishParamOf(e, key);
    if (!e || !d) return;
    const target = finishTarget(effectId, key), label = `${finishHostLabel(e)} · ${d.label}`;
    if (withNull) { addWithNull([{ target, label, min: d.min, max: d.max, ...(d.step ? { step: d.step } : {}), value: readFinishValue(play.finish, target) ?? d.value, axis: 'x' }], `${label} null`); return; }
    update(p => (p.controls.some(c => c.target === target) ? p : { ...p, controls: [...p.controls, { id: playId('ctl'), target, kind: 'float', label, min: d.min, max: d.max, ...(d.step ? { step: d.step } : {}) }] }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [play.finish, update]);
  // A layer's actions (Drop again, Burst…) as buttons on the panel, which mappings can press.
  const addActionControl = useCallback((layerId: string, kind: ActionKind) => {
    update(p => {
      const l = p.layers.find(x => x.id === layerId);
      const target = actionTarget(layerId, kind);
      if (!l || p.controls.some(c => c.target === target)) return p;
      return { ...p, controls: [...p.controls, { id: playId('ctl'), target, kind: 'action', label: `${l.label} · ${actionLabel(kind, l)}`, min: 0, max: 1, amount: defaultActionAmount(kind) }] };
    });
  }, [update]);
  const addLayerControl = useCallback((layerId: string, key: string) => {
    update(p => {
      const l = p.layers.find(x => x.id === layerId);
      const d = l && layerNumericProps(l).find(x => x.key === key);
      if (!l || !d || p.controls.some(c => c.target === layerTarget(layerId, key))) return p;
      return { ...p, controls: [...p.controls, { id: playId('ctl'), target: layerTarget(layerId, key), kind: 'float', label: `${l.label} · ${d.label}`, min: d.min, max: d.max, ...(d.step ? { step: d.step } : {}) }] };
    });
  }, [update]);

  // A slider (or an X/Y pair) with a Null on the picture that drives it.
  const addWithNull = useCallback((drives: NullDrive[], label: string) => {
    // A null is a layer: Pro.
    if (!requireFeature('play.layers')) return;
    let made = '';
    update(p => { const r = driveWithNull(p, drives, label); made = r.nullId; return r.play; });
    if (made) toast.success(`Added “${label}”`, { message: 'Drag the dot on the picture to change the value.' });
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
  const tab = usePlayUi(s => s.tab), setTab = usePlayUi(s => s.setTab);
  const panel = usePlayUi(s => s.panel), setPanel = usePlayUi(s => s.setPanel);
  // Split view (playSplit.ts): a big panel beside the picture shows one section, which the sidebar then leaves out.
  const bigTab = useBigTab();
  const big = compact ? null : bigTab;
  const splitHost = usePlaySplit(s => s.host);
  const splitWide = usePlaySplit(s => s.wide);
  const sidebarGone = usePlaySplit(s => s.sidebarHidden) && big !== null;
  const sideView = sidebarView(tab, big);
  const shown = compact ? tab : sideView.tab;
  const nullLayers = useMemo(() => play.layers.filter(l => l.kind === 'null').map(l => ({ id: l.id, label: l.label })), [play.layers]);
  const [notesEditing, setNotesEditing] = useState(false);
  // Links in the notes: what they can point at, and going there.
  const noteTargets = useMemo(() => ({ layers: play.layers.map(l => ({ id: l.id, label: l.label })), controls: play.controls.map(c => ({ id: c.id, label: c.label })) }), [play.layers, play.controls]);
  const revealLayer = usePlayUi(s => s.reveal);
  const openRef = useCallback((kind: NoteRefKind, id: string) => {
    if (kind === 'layer') { revealLayer(id); return; }
    setTab('controls');
    // After the tab renders: scroll to the control and flash it.
    requestAnimationFrame(() => {
      const sel = `[data-control-id="${CSS.escape(id)}"]`;
      const el = rootRef.current?.querySelector<HTMLElement>(sel) ?? usePlaySplit.getState().host?.querySelector<HTMLElement>(sel);
      if (!el) return;
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      const was = el.style.boxShadow;
      el.style.boxShadow = `inset 0 0 0 2px ${tk.accent.base}`;
      window.setTimeout(() => { el.style.boxShadow = was; }, 900);
    });
  }, [revealLayer, setTab, tk.accent.base]);
  // Layers a source or trigger can read: shapes (click, fill, hover), particles (speed, spread), cameras (motion), nulls (distance).
  const layerRefs = useMemo(() => play.layers.map(l => ({ id: l.id, label: l.label, kind: l.kind, ...(l.kind === 'shape' ? { shape: l.shape } : {}) })), [play.layers]);
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

  const notesCard = (play.notes || play.source || notesEditing) ? (
    <NotesCard
      notes={play.notes ?? ''}
      source={play.source}
      editing={notesEditing}
      targets={noteTargets}
      onOpen={openRef}
      onEdit={setNotesEditing}
      onChange={notes => update(p => { const next: PlayRecord = { ...p, notes }; if (!notes) delete next.notes; return next; })}
      onSourceChange={source => update(p => { const next: PlayRecord = { ...p, source }; if (!source) delete next.source; return next; })}
    />
  ) : null;

  const controlsHeader = <PanelHeader
    title="Controls"
    hint={play.controls.length === 0 ? undefined : `${play.controls.length}`}
    extra={(
      <>
        <OpenPlayableButton compact={compact} />
        <IconButton icon="import" label="Import a play file (a graph with its Play panel and mappings)" onClick={async () => { reportFileResult(await importGraphFromFile(), { failTitle: 'Couldn’t import that file' }); }} />
        <IconButton icon="export" label="Export a play file: the graph, the panel and the mappings, exactly as they are now (.playfile, or readable JSON)" disabled={play.controls.length === 0} onClick={e => offerPlayExport(e.currentTarget)} />
        {!play.notes && !play.source && !notesEditing && <IconButton icon="comment" label="Add notes: what this setup shows, how to play it, and where it comes from (saved with the graph and in play files)" onClick={() => setNotesEditing(true)} />}
        <IconButton icon="code" label={`Put it on a website: a player with controls, or the picture as a background, as a snippet or a page${websiteOk ? '' : ' (Pro)'}`} style={websiteOk ? undefined : { opacity: 0.5 }} onClick={() => { if (requireFeature('export.website')) setEmbedOpen(true); }} />
        <IconButton icon="record" label={`Record a performance: play for up to a minute, watch it back, render it frame by frame${takesOk ? '' : ' (Pro)'}`} style={takesOk ? undefined : { opacity: 0.5 }} onClick={() => useTakes.getState().openPerformance()} />
        <IconButton icon="play" label="Stage: the picture and its controls on their own, as people will play with it" onClick={() => useStage.getState().open('full')} />
        <AddControlButton compact={compact} candidates={candidates} layers={layersOk ? layerCandidates : NO_LAYER_CANDIDATES} finish={finishOk ? finishCandidates : NO_LAYER_CANDIDATES} layerById={id => play.layers.find(l => l.id === id)} taken={new Set(play.controls.map(c => c.target))} onAdd={addControl} onAddLayer={addLayerControl} onAddFinish={addFinishControl} onAddAction={addActionControl} onAddNull={addWithNull} />
      </>
    )}
  />;
  // Pairs: right-click a slider (or its ⋯) to pair it with another, or with its X/Y partner as a position.
  const resolveGraphTarget = (target: string) => {
    const c = candidates.find(x => x.target === target && x.kind === 'float');
    return c ? { label: candidateLabel(c), min: c.min, max: c.max, ...(c.step ? { step: c.step } : {}) } : null;
  };
  const addPairMapping = (pairId: string) => {
    if (!requireFeature('play.sources')) return;
    update(p => { const m = newPairMapping(p, pairId); return m ? { ...p, pairMappings: [...(p.pairMappings ?? []), m] } : p; });
    setDrawerOpen(true);
    if (compact) setTab('mappings');
  };
  const controlMenu = (id: string): MenuItem[] => {
    const c = play.controls.find(x => x.id === id);
    if (!c || c.kind !== 'float') return [{ label: 'Only sliders pair', disabled: true, onSelect: () => {} }];
    const partner = partnerTarget(c.target);
    const others = play.controls.filter(x => x.id !== id && x.kind === 'float' && !pairOf(play, x.id));
    const items: MenuItem[] = [];
    if (partner) items.push({
      label: `Add as position with ${partner.axis === 'y' ? 'Y' : 'X'}`, icon: 'target', hint: 'Its X/Y partner too, as one control with an XY pad',
      onSelect: () => { let ok = ''; update(p => { const r = positionPair(p, id, resolveGraphTarget); ok = r.pairId; return r.play; }); if (!ok) toast.info('No partner slider found for it'); },
    });
    items.push({ heading: 'Pair with…' });
    if (!others.length) items.push({ label: 'Add another slider first', disabled: true, onSelect: () => {} });
    for (const o of others) {
      items.push({ label: o.label, icon: 'sliders', hint: 'Two sliders played together; map both at once, or one then the other', onSelect: () => update(p => makePair(p, id, o.id, false).play) });
      if (items.length > 14) break;
    }
    return items;
  };
  const pairMenu = (pairId: string): MenuItem[] => [
    { label: 'Map onto the pair', icon: 'plus', onSelect: () => addPairMapping(pairId) },
    { label: 'Unpair', icon: 'close', hint: 'Two separate sliders again; its pair mappings go', onSelect: () => update(p => unpair(p, pairId)) },
  ];
  const renderControls = (inPanel: boolean) => (
    <div style={{ flex: 1, minHeight: play.notes && !compact && !inPanel ? 110 : 0, overflowY: 'auto', padding: inPanel ? '8px 16px 16px' : '6px 12px 12px' }}>
      {compact && (
        // Phones: everything scrolls together under the picture, notes first.
        <div style={{ margin: '0 -12px 6px' }}>
          {notesCard}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 12px', overflowX: 'auto' }}>
            <span style={{ color: tk.text.faint, font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Canvas</span>
            <AspectPicker onPanel />
            <CanvasFullscreenButton onPanel plainF />
            <GuidesToggle onPanel />
          </div>
          {backgroundsOk ? <BackgroundRow play={play} onChange={update} /> : <LockedBackground />}
        </div>
      )}
      {lockedParts.length > 0 && (
        <button type="button" onClick={() => openProSheet('play.layers')} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', margin: '4px 0 8px', padding: '8px 10px', border: 0, borderRadius: radius.md, cursor: 'pointer', background: alpha(tk.accent.base, 0.08), color: tk.text.secondary, font: `11.5px/1.45 ${fontFamily.ui}`, textAlign: 'left' }}>
          <ProBadge />
          <span style={{ flex: 1, minWidth: 0 }}>This setup has {joinParts(lockedParts)} that need Pro. They’re kept as they are, and the rest plays on Free.</span>
        </button>
      )}
      {(() => {
        // Several controls whose nodes were grouped together: relink them in one go.
        const moved = play.controls.flatMap(c => {
          if (controlExists(nodes, c, play) || parsePropTarget(c.target) || parseActionTarget(c.target)) return [];
          const f = locateTarget(nodes, c.target);
          return f.status === 'moved' ? [{ id: c.id, target: f.target }] : [];
        });
        if (moved.length < 2) return null;
        const to = new Map(moved.map(m => [m.id, m.target]));
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '4px 0 8px', padding: '6px 8px', borderRadius: radius.md, background: alpha(tk.status.warning, 0.12), color: tk.text.secondary, font: `11.5px/1.4 ${fontFamily.ui}` }}>
            <span style={{ flex: 1, minWidth: 0 }}>{moved.length} controls lost their sliders when their nodes were grouped.</span>
            <Button size="sm" variant="primary" onClick={() => update(p => ({ ...p, controls: p.controls.map(x => (to.has(x.id) ? { ...x, target: to.get(x.id)! } : x)) }))} title="Point each control at its slider inside the group">Relink all</Button>
          </div>
        );
      })()}
      {play.controls.length === 0 ? (
        <EmptyState
          title="No controls yet"
          body={candidates.length === 0
            ? 'Add a node with a slider or a colour in the Studio first. Any live slider can be a control.'
            : 'Pick sliders and colours from the graph to build your panel. Then map MIDI, the mouse or keys onto them below.'}
        />
      ) : <div style={inPanel ? PANEL_GRID : undefined}>{play.controls.map((c, i) => {
        const pair = pairOf(play, c.id);
        if (pair) {
          // A pair shows once, where its A is; B's own row is inside it.
          if (c.id !== pair.a) return null;
          const cb = play.controls.find(x => x.id === pair.b);
          if (!cb) return null;
          const num = (v: unknown) => (typeof v === 'number' ? v : undefined);
          const pms = (play.pairMappings ?? []).filter(m => m.enabled && m.pairId === pair.id);
          return (
            <ContextMenuArea key={c.id} items={() => pairMenu(pair.id)}>
              <PairCard
                pair={pair} a={c} b={cb} touch={compact}
                values={[num(readControlValue(nodes, c.target, play)), num(readControlValue(nodes, cb.target, play))]}
                live={[liveValues.get(c.id), liveValues.get(cb.id)]}
                drivenA={pms.some(m => pairDrives(m, pair, c.id)) || play.mappings.some(m => m.enabled && m.controlId === c.id)}
                drivenB={pms.some(m => pairDrives(m, pair, cb.id)) || play.mappings.some(m => m.enabled && m.controlId === cb.id)}
                drivenBy={[...pms.map(m => pairMappingLabel(m, play)), ...play.mappings.filter(m => m.enabled && (m.controlId === c.id || m.controlId === cb.id)).map(m => sourceLabel(m.source, play.controls, play.layers))]}
                onChange={(ctl, v) => writeControl(ctl, v)}
                onRename={label => update(p => ({ ...p, pairs: (p.pairs ?? []).map(x => (x.id === pair.id ? { ...x, label } : x)) }))}
                onPosition={position => update(p => ({ ...p, pairs: (p.pairs ?? []).map(x => (x.id === pair.id ? { ...x, position } : x)) }))}
                onUnpair={() => update(p => unpair(p, pair.id))}
                onMap={() => addPairMapping(pair.id)}
              />
            </ContextMenuArea>
          );
        }
        return (
        <ContextMenuArea key={c.id} items={() => controlMenu(c.id)}>
        <ControlRow
          key={c.id}
          control={c}
          index={i}
          count={play.controls.length}
          exists={controlExists(nodes, c, play)}
          fate={controlExists(nodes, c, play) ? undefined : parsePropTarget(c.target) || parseActionTarget(c.target) ? { status: 'deleted' } : locateTarget(nodes, c.target)}
          onRelink={target => update(p => ({ ...p, controls: p.controls.map(x => (x.id === c.id ? { ...x, target } : x)) }))}
          help={controlHelp(nodes, c.target, play)}
          source={sourceOf(c)}
          onMap={() => addMapping(c.kind === 'action' ? { kind: 'mouse', axis: 'down' } : { kind: 'mouse', axis: 'x' }, c.id)}
          onNull={c.kind === 'float' ? () => {
            const v = readControlValue(nodes, c.target, play);
            const key = parsePropTarget(c.target)?.key ?? targetParts(c.target).paramKey;
            addWithNull([{ target: c.target, label: c.label, min: c.min, max: c.max, value: typeof v === 'number' ? v : c.min, axis: pairedKey(key)?.axis ?? 'x' }], `${c.label} null`);
          } : undefined}
          onAmount={amount => update(p => ({ ...p, controls: p.controls.map(x => x.id === c.id ? { ...x, amount } : x) }))}
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
        </ContextMenuArea>
        );
      })}</div>}
    </div>
  );
  const renderMappings = (inPanel: boolean) => (
    <MappingsDrawer
      play={play}
      mode={compact || inPanel ? 'tab' : 'drawer'}
      grid={inPanel}
      height={drawerH}
      onResizeStart={startDrawerResize}
      open={compact || inPanel || drawerOpen}
      onToggle={() => setDrawerOpen(o => !o)}
      onAdd={addMapping}
      onUpdate={(id, patch) => update(p => ({ ...p, mappings: p.mappings.map(m => m.id === id ? { ...m, ...patch } : m) }))}
      onRemove={id => update(p => ({ ...p, mappings: p.mappings.filter(m => m.id !== id) }))}
      onAddPair={addPairMapping}
      onUpdatePair={(id, patch) => update(p => ({ ...p, pairMappings: (p.pairMappings ?? []).map(m => (m.id === id ? { ...m, ...patch } : m)) }))}
      onRemovePair={id => update(p => { const rest = (p.pairMappings ?? []).filter(m => m.id !== id); const out: PlayRecord = { ...p, pairMappings: rest }; if (!rest.length) delete out.pairMappings; return out; })}
      audioNodes={audioNodes}
      nullLayers={nullLayers}
      layerRefs={layerRefs}
    />
  );
  // The big panel's section, rendered into the split view's panel (PlaySplitArea.tsx).
  const bigPanel = big && splitHost ? createPortal(
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {big === 'controls' && <>{controlsHeader}{renderControls(true)}</>}
      {big === 'layers' && (layersOk
        ? <LayersPanel play={play} touch={false} split={splitWide} exposedTargets={new Set(play.controls.map(c => c.target))} onChange={update} onExpose={control => update(p => (p.controls.some(c => c.target === control.target) ? p : { ...p, controls: [...p.controls, control] }))} />
        : <LockedLayers play={play} />)}
      {big === 'finish' && (finishOk ? <FinishPanel play={play} onChange={update} touch={false} wide={splitWide} /> : <LockedFinish play={play} />)}
      {big === 'mappings' && renderMappings(true)}
    </div>,
    splitHost,
  ) : null;

  // The sidebar hidden beside the big panel: only the panel's section and what floats (dialogs, menus) stay.
  if (sidebarGone) {
    return (
      <div ref={rootRef} style={{ position: 'absolute', inset: 0 }}>
        {bigPanel}
        {embedOpen && <EmbedDialog onClose={() => setEmbedOpen(false)} />}
        <AudioReadersHost compact={compact} />
        <LayerContextMenu play={play} onChange={update} />
      </div>
    );
  }

  return (
    <div ref={rootRef} style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: tk.bg.subtle, color: tk.text.primary, font: `12.5px ${fontFamily.ui}` }}>
      {/* Sections. Desktop keeps Mappings as a drawer underneath; phones make it a third tab. */}
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px 2px', background: tk.bg.panel }}>
        <div style={{ flex: 1, minWidth: 0 }}>
        <Segmented
          fill
          ariaLabel="Play section"
          value={shown}
          onChange={setTab}
          options={[
            ...(compact || sideView.tabs.includes('controls') ? [{ value: 'controls' as const, label: `Controls${play.controls.length ? ` · ${play.controls.length}` : ''}` }] : []),
            ...(compact || sideView.tabs.includes('layers') ? [{ value: 'layers' as const, label: `Layers${play.layers.length ? ` · ${play.layers.length}` : ''}${layersOk ? '' : ' · Pro'}` }] : []),
            ...(compact || sideView.tabs.includes('finish') ? [{ value: 'finish' as const, label: `Finish${play.finish?.effects.length ? ` · ${play.finish.effects.length}` : ''}${finishOk ? '' : ' · Pro'}`, title: 'Grade, lens, film and time effects over the whole picture' }] : []),
            ...(compact ? [{ value: 'mappings' as const, label: `Mappings${play.mappings.length + (play.pairMappings?.length ?? 0) ? ` · ${play.mappings.length + (play.pairMappings?.length ?? 0)}` : ''}` }] : []),
          ]}
        />
        </div>
        {!compact && <Segmented size="sm" ariaLabel="Panel width" value={panel} onChange={v => setPanel(v as PanelSize)} options={[{ value: 's', label: 'S', title: 'Narrow panel' }, { value: 'm', label: 'M', title: 'Medium panel' }, { value: 'l', label: 'L', title: 'Wide panel' }]} />}
      </div>
      {!compact && notesCard}
      {shown === 'layers' && !layersOk && <LockedLayers play={play} />}
      {shown === 'layers' && layersOk && (
        <LayersPanel
          top={compact ? notesCard : undefined}
          play={play}
          touch={compact}
          exposedTargets={new Set(play.controls.map(c => c.target))}
          onChange={update}
          onExpose={control => update(p => (p.controls.some(c => c.target === control.target) ? p : { ...p, controls: [...p.controls, control] }))}
        />
      )}
      {shown === 'finish' && (finishOk ? <FinishPanel play={play} onChange={update} touch={compact} /> : <LockedFinish play={play} />)}
      {shown === 'controls' && controlsHeader}
      {canvasRow && !compact && (
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '4px 12px', borderBottom: `1px solid ${tk.border.subtle}`, background: tk.bg.panel, overflowX: 'auto' }}>
          <span style={{ color: tk.text.faint, font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Canvas</span>
          <AspectPicker onPanel />
          <CanvasFullscreenButton onPanel plainF />
          <GuidesToggle onPanel />
          <SplitButton />
        </div>
      )}
      {!compact && (backgroundsOk ? <BackgroundRow play={play} onChange={update} /> : <LockedBackground />)}
      {shown === 'controls' && renderControls(false)}

      {(compact ? tab === 'mappings' : sideView.drawer) && renderMappings(false)}
      {bigPanel}
      {embedOpen && <EmbedDialog onClose={() => setEmbedOpen(false)} />}
      <AudioReadersHost compact={compact} />
      <LayerContextMenu play={play} onChange={update} />
    </div>
  );
}

const DRAWER_HEIGHT_KEY = 'shader-studio:play:drawerHeight';
/** The split view's big panel lays cards out in as many columns as fit. */
const PANEL_GRID: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(300px, 100%), 1fr))', columnGap: 10, alignItems: 'start' };
const PANEL_GRID_WIDE: React.CSSProperties = { ...PANEL_GRID, gridTemplateColumns: 'repeat(auto-fill, minmax(min(380px, 100%), 1fr))' };

// ── Header + empty state ─────────────────────────────────────────────────────

function PanelHeader({ title, hint, extra, onClick, chevron }: { title: string; hint?: string; extra?: ReactNode; onClick?: () => void; chevron?: 'up' | 'down' }) {
  const tk = useTokens();
  return (
    <div
      onClick={onClick}
      style={{
        minHeight: 44, flexShrink: 0, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '2px 8px', padding: '0 8px 0 14px',
        borderBottom: `1px solid ${tk.border.default}`, background: tk.bg.panel, cursor: onClick ? 'pointer' : 'default', userSelect: 'none',
      }}
    >
      {chevron && <Icon name={chevron === 'up' ? 'chevU' : 'chevD'} size={14} style={{ color: tk.text.faint }} />}
      <span style={{ font: `650 13px ${fontFamily.ui}` }}>{title}</span>
      {hint && <span style={{ color: tk.text.faint, font: `500 11.5px ${fontFamily.mono}` }}>{hint}</span>}
      <span style={{ flex: 1 }} />
      {/* Wraps onto a second line on narrow screens rather than running off the edge. */}
      <span onClick={e => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end', minHeight: 44, maxWidth: '100%' }}>{extra}</span>
    </div>
  );
}

/** Does anything in the setup listen to MIDI (a MIDI source, a note trigger or an action fired by a note)? */
function usesMidi(play: PlayRecord): boolean {
  return play.mappings.some(m => m.source.kind === 'midi' || (m.source.kind === 'trigger' && m.source.trigger.on === 'note'))
    || (play.actions ?? []).some(a => a.trigger.on === 'note');
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

/** A layer's numbers, for the Add control menu. */
interface LayerCandidates { id: string; label: string; props: Array<{ key: string; label: string; hint?: string; min: number; max: number; step?: number }>; actions: ActionKind[] }

function AddControlButton({ candidates, layers, finish, layerById, taken, onAdd, onAddLayer, onAddFinish, onAddAction, onAddNull, compact = false }: {
  /** Phones: the button is an icon, so the header's row of tools fits. */
  compact?: boolean;
  candidates: PlayCandidate[];
  layers: LayerCandidates[];
  layerById: (id: string) => PlayLayer | undefined;
  taken: Set<string>;
  onAdd: (c: PlayCandidate) => void;
  onAddLayer: (layerId: string, key: string) => void;
  /** The Finish stack's effects and their numbers. */
  finish: LayerCandidates[];
  onAddFinish: (effectId: string, key: string, withNull: boolean) => void;
  onAddAction: (layerId: string, kind: ActionKind) => void;
  /** Add the slider (and its X/Y partner) with a Null layer that drives it. */
  onAddNull: (drives: NullDrive[], label: string) => void;
}) {
  const tk = useTokens();
  const anchor = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [withNull, setWithNull] = useState(false);
  const pickGraph = (c: PlayCandidate) => {
    if (!withNull || c.kind !== 'float') { onAdd(c); return; }
    const { drives, label } = graphNullDrives(candidates, c);
    onAddNull(drives, label);
  };
  const pickLayer = (l: LayerCandidates, key: string) => {
    if (!withNull) { onAddLayer(l.id, key); return; }
    const layer = layerById(l.id);
    const r = layer && layerNullDrives(layer, key);
    if (r) onAddNull(r.drives, r.label);
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
  const nothing = candidates.length === 0 && layers.every(l => l.props.length + l.actions.length === 0) && finish.every(f => f.props.length === 0);
  return (
    <span ref={anchor} style={{ display: 'inline-flex' }}>
      {compact
        ? <IconButton icon="plus" label="Add control" active={open} onClick={() => setOpen(o => !o)} disabled={nothing} />
        : <Button size="sm" icon="plus" onClick={() => setOpen(o => !o)} disabled={nothing}>Add control</Button>}
      {open && (
        <Popover anchorRef={anchor} onClose={close} align="end" width={320} padding={8}>
          <Field autoFocus placeholder="Search sliders, colours and layers" value={query} onChange={e => setQuery(e.target.value)} height={30} leading={<Icon name="search" size={14} style={{ color: tk.text.faint }} />} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 4px 2px' }}>
            <Toggle checked={withNull} onChange={v => { if (!v || requireFeature('play.layers')) setWithNull(v); }} label={can('play.layers') ? 'Drive with a null' : 'Drive with a null · Pro'} />
            <Tooltip label="Drive with a null" description="Adds the slider and a Null on the picture that drives it: drag the dot to change the value. The dot's left-to-right is the slider's range. An X/Y pair (Position X and Y) shares one null that starts where the thing is.">
              <span style={{ display: 'inline-flex', color: tk.text.faint, cursor: 'help' }}><Icon name="info" size={13} /></span>
            </Tooltip>
          </div>
          <div style={{ maxHeight: 400, overflowY: 'auto', marginTop: 6 }}>
            {graphShown.length === 0 && layerCount === 0 && finishCount === 0 && (
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
                  <button key={pr.key} type="button" title={pr.hint} onClick={() => { onAddFinish(f.id, pr.key, withNull); close(); }} {...hover} style={{ ...itemStyle, paddingLeft: 40 }}>
                    <Icon name="curve" size={13} style={{ color: tk.text.faint }} />
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pr.label}</span>
                    {withNull && taken.has(finishTarget(f.id, pr.key)) && <span style={{ color: tk.text.faint, fontSize: 10.5 }}>on panel</span>}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </Popover>
      )}
    </span>
  );
}

// ── Control row ──────────────────────────────────────────────────────────────

/** Where a control's value lives: a layer's property or a node's param. */
interface ControlSource { kind: 'layer' | 'node'; title: string; param: string; within?: string; missing: boolean; go: () => void }

function ControlRow({ control, index, count, exists, fate, onRelink, help, source, value, live, drivenBy, touch, onChange, onRename, onRange, onMove, onRemove, onMap, onNull, onAmount }: {
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
  live: ControlValue | undefined;
  drivenBy: string[];
  touch: boolean;
  onChange: (v: number | number[]) => void;
  onRename: (label: string) => void;
  onRange: (min: number, max: number) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  /** Add a mapping onto this control. */
  onMap: () => void;
  /** Add a Null on the picture that drives this control (sliders only). */
  onNull?: () => void;
  /** Action controls: how much (particles for a burst, strength for a scatter). */
  onAmount: (amount: number) => void;
}) {
  const tk = useTokens();
  const [hover, setHover] = useState(false);
  const [details, setDetails] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(control.label);
  const driven = drivenBy.length > 0;
  const commitLabel = () => { setEditing(false); const t = draft.trim(); if (t && t !== control.label) onRename(t); else setDraft(control.label); };

  const shown = driven && live !== undefined ? live : value;
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
      <div data-card-bg="1" style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 26, marginBottom: 6 }}>
        <IconButton icon={details ? 'chevD' : 'chevR'} label={details ? 'Hide details' : 'Details: where it comes from'} size="sm" tooltip={false} onClick={() => setDetails(d => !d)} style={{ marginLeft: -6 }} />
        <span
          draggable
          onDragStart={e => { e.dataTransfer.setData(NOTE_REF_TYPE, noteRef('control', control.id)); e.dataTransfer.setData('text/plain', noteRef('control', control.id)); e.dataTransfer.effectAllowed = 'copy'; }}
          title="Drag onto the notes to link this control"
          style={{ display: 'inline-flex', color: tk.text.faint, cursor: 'grab', marginLeft: -4, visibility: hover || touch ? 'visible' : 'hidden' }}
        ><Icon name="grip" size={12} /></span>
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
        {!exists && <span style={{ color: tk.status.warningText, font: `600 10.5px ${fontFamily.ui}` }}>{fate?.status === 'moved' ? 'moved' : 'missing'}</span>}
        <span style={{ display: 'flex', gap: 0, visibility: hover || touch ? 'visible' : 'hidden' }}>
          <IconButton icon="chevU" label="Move up" size="sm" disabled={index === 0} tooltip={false} onClick={() => onMove(-1)} />
          <IconButton icon="chevD" label="Move down" size="sm" disabled={index === count - 1} tooltip={false} onClick={() => onMove(1)} />
          <IconButton icon="trash" label="Remove from panel" size="sm" tone="danger" tooltip={false} onClick={onRemove} />
        </span>
      </div>
      {control.kind === 'action' ? (
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
              // The range's ends show at the track's ends: double-click one (long-press on a phone) to change it.
              onRange={onRange}
              ariaLabel={control.label}
              touch={touch}
            />
          </div>
        </div>
      )}
      {!exists && fate && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 6px', padding: '6px 8px', borderRadius: radius.md, background: alpha(tk.status.warning, 0.12), color: tk.text.secondary, font: `11.5px/1.4 ${fontFamily.ui}` }}>
          <span style={{ flex: 1, minWidth: 0 }}>
            {fate.status === 'moved' ? <>Its node was grouped: it’s now inside <b>{fate.groups.join(' › ')}</b>.</>
              : fate.status === 'param' ? 'Its node is still there, but not this slider (the node changed, or the slider is wired or hidden).'
              : source.kind === 'layer' ? 'Its layer was deleted.' : 'Its node was deleted.'}
          </span>
          {fate.status === 'moved' && <Button size="sm" variant="primary" onClick={() => onRelink(fate.target)} title="Point this control at the slider in its new place">Relink</Button>}
        </div>
      )}
      {details && (
        <div style={{ marginTop: 10, paddingTop: 8, borderTop: `1px solid ${tk.border.subtle}`, display: 'flex', flexDirection: 'column', gap: 6, font: `12px/1.45 ${fontFamily.ui}`, color: tk.text.secondary }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name={source.kind === 'layer' ? 'layoutCanvas' : 'nodes'} size={14} style={{ color: tk.text.faint, flexShrink: 0 }} />
            <span style={{ flex: 1, minWidth: 0 }}>
              {source.kind === 'layer' ? 'Layer' : 'Node'} <b style={{ color: source.missing ? tk.status.warningText : tk.text.primary }}>{source.title}</b>
              {source.within && <> in group <b>{source.within}</b></>} · {source.param}
            </span>
            <Button size="sm" variant="ghost" disabled={source.missing} onClick={source.go}>{source.kind === 'layer' ? 'Go to layer' : 'Show in graph'}</Button>
          </div>
          {help.hint && <div style={{ color: tk.text.muted }}>{help.hint}</div>}
          {help.comment && <div style={{ color: tk.text.muted }}><b>Note on the node:</b> {help.comment}</div>}
          {control.kind === 'float' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: tk.text.faint, font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.04em', textTransform: 'uppercase', width: 62 }}>Range</span>
              <RangeEditor min={control.min} max={control.max} onRange={onRange} />
            </div>
          )}
          {control.kind === 'action' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: tk.text.faint, font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.04em', textTransform: 'uppercase', width: 62 }}>Amount</span>
              <NumberInput value={control.amount ?? 1} min={0} max={1000} step={source.param === actionLabel('burst') ? 10 : 0.1} title="Burst: how many particles. Scatter: how hard. Go to: which background, from 1. Others ignore it." onCommit={n => onAmount(Math.max(0, n))} style={{ width: 64, height: 24, borderRadius: 6, border: 0, background: tk.bg.field, color: tk.text.primary, font: `500 11.5px ${fontFamily.mono}`, textAlign: 'center' }} />
              <span style={{ color: tk.text.faint, fontSize: 11 }}>A mapping presses it each time it rises past the middle of its range.</span>
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ color: tk.text.faint, font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.04em', textTransform: 'uppercase', width: 62 }}>Driven by</span>
            <span style={{ flex: 1, minWidth: 0 }}>{driven ? drivenBy.join(', ') : 'Nothing yet: drag the slider, or map an input onto it.'}</span>
            <Button size="sm" variant="ghost" icon="plus" onClick={onMap}>Map</Button>
            {onNull && <Button size="sm" variant="ghost" icon="plus" title="Add a Null on the picture that drives this slider: drag the dot to change it" onClick={onNull}>Null</Button>}
          </div>
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

// ── Mappings drawer ──────────────────────────────────────────────────────────

interface AudioNodeOption { id: string; label: string; bands: number }

function MappingsDrawer({ play, mode, grid = false, height, onResizeStart, open, onToggle, onAdd, onUpdate, onRemove, onAddPair, onUpdatePair, onRemovePair, audioNodes, nullLayers, layerRefs }: {
  play: PlayRecord;
  /** `drawer`: folds under the controls with a draggable top edge. `tab`: fills the page (phones, the split view's panel). */
  mode: 'drawer' | 'tab';
  /** The rows as cards in columns (the split view's panel). */
  grid?: boolean;
  height: number;
  onResizeStart: (e: React.PointerEvent) => void;
  open: boolean;
  onToggle: () => void;
  onAdd: (source: PlaySource, controlId?: string) => void;
  onUpdate: (id: string, patch: Partial<PlayMapping>) => void;
  onRemove: (id: string) => void;
  onAddPair: (pairId: string) => void;
  onUpdatePair: (id: string, patch: Partial<PlayPairMapping>) => void;
  onRemovePair: (id: string) => void;
  audioNodes: AudioNodeOption[];
  nullLayers: { id: string; label: string }[];
  layerRefs: LayerRef[];
}) {
  const tk = useTokens();
  const meters = useSourceMeter(open ? play.mappings : EMPTY_MAPPINGS);
  // Learn: the next knob, key or MIDI note becomes a source. `learnFor` is a
  // mapping id (replace its source) or 'new' (add a mapping).
  const [learnFor, setLearnFor] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  useEffect(() => {
    if (!learnFor) return;
    void midiEngine.connectWebMidi({ retry: true });
    // A trigger row's Learn picks what fires it (key, note, click, OSC); every other Learn picks a source.
    const row = learnFor === 'new' ? undefined : play.mappings.find(m => m.id === learnFor);
    if (row?.source.kind === 'trigger') {
      const src = row.source;
      return playEngine.startLearnTrigger(trigger => {
        if (triggerNeedsPro(trigger) && !can('play.sources')) { setLearnFor(null); openProSheet('play.sources'); return; }
        // Learn picks what fires it; how it fires (once, every frame…) stays.
        onUpdate(row.id, { source: { ...src, trigger: withFire(trigger, src.trigger.fire) } });
        setLearnFor(null);
      });
    }
    const stop = playEngine.startLearn(source => {
      // Free learns the mouse, keys and audio; a knob or a note says what Pro adds instead.
      if (sourceNeedsPro(source) && !can('play.sources')) { setLearnFor(null); openProSheet('play.sources'); return; }
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
  const allSources = useCan('play.sources');
  const learnTrigger = !!learnFor && learnFor !== 'new' && play.mappings.find(m => m.id === learnFor)?.source.kind === 'trigger';
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
            <ProLock feature="play.sources" badge={false}><HandsButton /></ProLock>
            <Button size="sm" icon="spark" variant={learnFor === 'new' ? 'primary' : 'secondary'} disabled={noControls} onClick={() => setLearnFor(l => (l === 'new' ? null : 'new'))}>
              {learnFor === 'new' ? 'Listening…' : 'Learn'}
            </Button>
            <Button size="sm" icon="plus" disabled={noControls} onClick={() => onAdd(allSources ? { kind: 'midi', signal: 'cc', channel: 0, cc: 1 } : { kind: 'mouse', axis: 'x' })}>Add</Button>
          </>
        )}
      />
      {open && (
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: grid ? '8px 16px 16px' : '6px 12px 12px' }}>
          {(learnFor || usesMidi(play)) && (
            <div style={{ margin: '4px 0 6px', padding: '6px 10px', borderRadius: radius.md, background: tk.bg.field }}>
              <MidiStatusChip />
            </div>
          )}
          {(usesHands(play) || (learnFor && handFeed.getStatus() !== 'unsupported')) && (
            <div style={{ margin: '4px 0 6px', padding: '6px 10px', borderRadius: radius.md, background: tk.bg.field }}>
              <HandsChip />
            </div>
          )}
          {learnFor && (
            <div style={{ margin: '6px 0 2px', padding: '8px 12px', borderRadius: radius.md, background: alpha(tk.accent.base, 0.1), color: tk.accent.text, font: `600 12px ${fontFamily.ui}` }}>
              {learnTrigger
                ? <>Press a key, hit a note{handFeed.isOn() ? ', make a hand gesture' : ''}{play.signals?.length ? ' or fire a signal' : ''}… </>
                : <>Move a knob, hit a note, press a key{handFeed.isOn() ? ', move a finger' : ''}{play.signals?.length ? ' or fire a signal' : ''}… </>}
              <span style={{ fontWeight: 500, opacity: 0.8 }}>Esc to cancel</span>
            </div>
          )}
          <SoloStrip kind="mapping" total={play.mappings.length} />
          {play.midiFile && <MidiFileSlot />}
          {play.mappings.length === 0 ? (
            <EmptyState
              title="Nothing mapped"
              body={noControls
                ? 'Add a control first, then map an input onto it.'
                : `Press Learn and move a knob or a key, or add a row by hand. ${midiEngine.blockReason() ?? (midi.status === 'ready' && midi.inputs.length ? `Listening to ${midi.inputs.join(', ')}.` : '')} Connecting Ableton, a controller, OSC or live audio for the first time? The ⓘ button above walks you through it.`}
            />
          ) : <div style={grid ? PANEL_GRID_WIDE : undefined}>{play.mappings.map(m => (
            <MappingRow
              key={m.id}
              mapping={m}
              control={play.controls.find(c => c.id === m.controlId)}
              controls={play.controls}
              audioNodes={audioNodes}
              nullLayers={nullLayers}
              layerRefs={layerRefs}
              meter={meters.get(m.id) ?? 0}
              learning={learnFor === m.id}
              collapsed={collapsed.has(m.id)}
              onToggle={() => toggleRow(m.id)}
              onLearn={() => setLearnFor(l => (l === m.id ? null : m.id))}
              onUpdate={patch => onUpdate(m.id, patch)}
              onRemove={() => onRemove(m.id)}
            />
          ))}</div>}
          {!!play.pairs?.length && (
            <PairMappingsSection play={play} grid={grid} audioNodes={audioNodes} layerRefs={layerRefs} onAdd={onAddPair} onUpdate={onUpdatePair} onRemove={onRemovePair} />
          )}
          {!play.midiFile && <MidiFileSlot />}
        </div>
      )}
      {guideOpen && <ConnectGuide onClose={() => setGuideOpen(false)} />}
    </div>
  );
}

const EMPTY_MAPPINGS: PlayMapping[] = [];
const NO_LAYER_CANDIDATES: LayerCandidates[] = [];

function joinParts(parts: string[]): string {
  return parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** Free's Layers tab: what layers do, the setup's own layers listed dimmed (kept, not run), and the way to Pro. */
function LockedFinish({ play }: { play: PlayRecord }) {
  const tk = useTokens();
  const n = play.finish?.effects.length ?? 0;
  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '14px 12px' }}>
      <div style={{ padding: '14px 14px 12px', borderRadius: radius.card, background: tk.bg.panel, boxShadow: `inset 0 0 0 1px ${tk.border.default}`, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="lock" size={15} style={{ color: tk.text.faint }} />
          <b style={{ font: `650 13px ${fontFamily.ui}`, color: tk.text.primary }}>The Finish stack is part of Pro</b>
          <ProBadge />
        </div>
        <span style={{ color: tk.text.muted, font: `12px/1.5 ${fontFamily.ui}` }}>
          Colour grading with curves and wheels, lens distortion, CRT, bloom, halation, film grain, camera shake and time displacement over the whole picture.
          {n > 0 ? ` This setup’s ${n === 1 ? 'effect is' : `${n} effects are`} kept as they are, and play again with Pro.` : ''}
        </span>
        <div><Button size="sm" variant="primary" icon="spark" onClick={() => openProSheet('play.finish')}>See what Pro adds</Button></div>
      </div>
    </div>
  );
}

function LockedLayers({ play }: { play: PlayRecord }) {
  const tk = useTokens();
  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '14px 12px' }}>
      <div style={{ padding: '14px 14px 12px', borderRadius: radius.card, background: tk.bg.panel, boxShadow: `inset 0 0 0 1px ${tk.border.default}`, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="lock" size={15} style={{ color: tk.text.faint }} />
          <b style={{ font: `650 13px ${fontFamily.ui}`, color: tk.text.primary }}>Layers are part of Pro</b>
          <ProBadge />
        </div>
        <span style={{ color: tk.text.muted, font: `12px/1.5 ${fontFamily.ui}` }}>
          Shapes, particles, text, images, the camera, scripts and nulls on top of the picture, with their actions and groups.
          {play.layers.length > 0 ? ' This setup’s layers are kept as they are: they show here, and play again with Pro.' : ''}
        </span>
        <div><Button size="sm" variant="primary" icon="spark" onClick={() => openProSheet('play.layers')}>See what Pro adds</Button></div>
      </div>
      {play.layers.length > 0 && (
        <div style={{ marginTop: 10, borderRadius: radius.card, background: tk.bg.panel, boxShadow: `inset 0 0 0 1px ${tk.border.default}`, overflow: 'hidden' }}>
          {play.layers.map((l, i) => (
            <div key={l.id} title="Needs Pro" style={{ display: 'flex', alignItems: 'center', gap: 8, height: 34, padding: '0 12px', borderTop: i ? `1px solid ${tk.border.subtle}` : undefined, opacity: 0.55 }}>
              <Icon name="layoutCanvas" size={14} style={{ color: tk.text.faint }} />
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: tk.text.primary }}>{l.label}</span>
              <span style={{ color: tk.text.faint, font: `11px ${fontFamily.ui}` }}>{l.kind} · needs Pro</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Free's Background row: the shader, with backgrounds shown as Pro. */
function LockedBackground() {
  const tk = useTokens();
  return (
    <button type="button" onClick={() => openProSheet('play.backgrounds')} style={{
      flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '6px 12px', border: 0, borderBottom: `1px solid ${tk.border.subtle}`,
      background: tk.bg.panel, cursor: 'pointer', color: tk.text.muted, font: `12px ${fontFamily.ui}`, textAlign: 'left',
    }}>
      <span style={{ color: tk.text.faint, font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Background</span>
      <span style={{ flex: 1 }}>The shader</span>
      <span style={{ color: tk.text.faint }}>Images, video, gradients</span>
      <ProBadge />
    </button>
  );
}

/** The MIDI file card, locked on Free (a file made on Pro stays, shown dimmed). */
function MidiFileSlot() {
  return <ProLock feature="play.midiFile" style={{ display: 'flex', width: '100%', alignItems: 'flex-start' }}><MidiFileCard /></ProLock>;
}
const NO_READERS: AudioReader[] = [];

/** Mappings onto pairs: a position (the pointer, a null, a fingertip) or one source onto two values, with axis swap. */
function PairMappingsSection({ play, grid, audioNodes, layerRefs, onAdd, onUpdate, onRemove }: {
  play: PlayRecord;
  grid: boolean;
  audioNodes: AudioNodeOption[];
  layerRefs: LayerRef[];
  onAdd: (pairId: string) => void;
  onUpdate: (id: string, patch: Partial<PlayPairMapping>) => void;
  onRemove: (id: string) => void;
}) {
  const tk = useTokens();
  const readers = useNodeGraphStore(s => s.play.audioReaders?.readers) ?? NO_READERS;
  const allSources = useCan('play.sources');
  const sections = useMemo(() => sourcePickerSections(readers, !allSources, play.signals), [readers, allSources, play.signals]);
  const pms = play.pairMappings ?? [];
  const numStyle = { width: 58, height: 26, borderRadius: 6, border: 0, background: tk.bg.field, color: tk.text.primary, font: `500 11.5px ${fontFamily.mono}`, textAlign: 'center' as const };
  const labelStyle = { color: tk.text.faint, font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.04em', textTransform: 'uppercase' as const, width: 54, flexShrink: 0 };
  const firstPair = play.pairs?.[0]?.id ?? '';
  const pick = (v: string, prev: PlaySource): PlaySource | null => {
    if (!allSources && sourceTypeNeedsPro(v)) { openProSheet('play.sources'); return null; }
    if (v === OPEN_READERS) { useReadersPanel.getState().show({ focus: '' }); return null; }
    if (v.startsWith(SIGNAL_SOURCE)) return signalSource(v.slice(SIGNAL_SOURCE.length));
    return sourceFromType(v as SourceType, prev, play.controls[0]?.id ?? '', play.layers.find(l => l.kind === 'null')?.id ?? '', firstSensor(layerRefs), firstDataset());
  };
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 2px' }}>
        <span style={{ font: `650 12px ${fontFamily.ui}`, color: tk.text.secondary }}>Pairs</span>
        {pms.length > 0 && <span style={{ color: tk.text.faint, font: `500 11px ${fontFamily.mono}` }}>{pms.length}</span>}
        <span style={{ flex: 1 }} />
        <Button size="sm" icon="plus" onClick={() => firstPair && onAdd(firstPair)}>Map a pair</Button>
      </div>
      {pms.length === 0 && <div style={{ color: tk.text.muted, font: `12px/1.5 ${fontFamily.ui}` }}>Drive both values of a pair at once from a position (the pointer, a null, a fingertip), or one source onto A, B or both, with an axis swap.</div>}
      <div style={grid ? PANEL_GRID_WIDE : undefined}>
        {pms.map(m => (
          <PairMappingRow key={m.id} mapping={m} play={play} sourceSections={sections} onPickSource={pick}
            renderSourceOptions={(source, onChange) => <SourceOptions source={source} audioNodes={audioNodes} layerRefs={layerRefs} numStyle={numStyle} labelStyle={labelStyle} onChange={onChange} />}
            onUpdate={patch => onUpdate(m.id, patch)} onRemove={() => onRemove(m.id)} />
        ))}
      </div>
    </div>
  );
}

function MappingRow({ mapping: m, control, controls, audioNodes, nullLayers, layerRefs, meter, learning, collapsed, onToggle, onLearn, onUpdate, onRemove }: {
  mapping: PlayMapping;
  control: PlayControl | undefined;
  controls: PlayControl[];
  audioNodes: AudioNodeOption[];
  nullLayers: { id: string; label: string }[];
  layerRefs: LayerRef[];
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
  const readers = useNodeGraphStore(s => s.play.audioReaders?.readers) ?? NO_READERS;
  // Free maps from the mouse, keys and audio (play/planGates.ts). A Pro source made on Pro stays as it is, marked, and doesn't run.
  const allSources = useCan('play.sources');
  const locked = !allSources && sourceNeedsPro(m.source);
  const signals = useNodeGraphStore(s => s.play.signals);
  const sourceSections = useMemo(() => sourcePickerSections(readers, !allSources, signals), [readers, allSources, signals]);
  const pickSource = (v: string) => {
    if (!allSources && sourceTypeNeedsPro(v)) { openProSheet('play.sources'); return; }
    if (v.startsWith(SIGNAL_SOURCE)) { onUpdate({ source: signalSource(v.slice(SIGNAL_SOURCE.length)) }); return; }
    if (v === OPEN_READERS) { useReadersPanel.getState().show({ mappingId: m.id, focus: m.source.kind === 'reader' ? m.source.readerId : '' }); return; }
    onUpdate({ source: sourceFromType(v as SourceType, m.source, otherControls[0]?.id ?? '', nullLayers[0]?.id ?? '', firstSensor(layerRefs), firstDataset()) });
  };
  const numStyle = { width: 58, height: 26, borderRadius: 6, border: 0, background: tk.bg.field, color: tk.text.primary, font: `500 11.5px ${fontFamily.mono}`, textAlign: 'center' as const };
  const labelStyle = { color: tk.text.faint, font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.04em', textTransform: 'uppercase' as const, width: 54, flexShrink: 0 };
  const otherControls = controls.filter(c => c.id !== m.controlId);
  const retarget = (id: string) => {
    const c = controls.find(x => x.id === id);
    // A control can't drive itself: drop a control source that now points at the target.
    const source = m.source.kind === 'control' && m.source.controlId === id ? { kind: 'control' as const, controlId: controls.find(x => x.id !== id)?.id ?? '' } : m.source;
    onUpdate(c ? { controlId: id, outMin: c.min, outMax: c.max, channel: undefined, source } : { controlId: id, source });
  };

  // Where the source lands after the curve (0..1 of the range): what the control actually gets.
  const shaped = applyCurve(meter, m.curve, m.curveY);
  const frame = { marginTop: 6, borderRadius: radius.card, background: tk.bg.panel, boxShadow: `inset 0 0 0 1px ${learning ? tk.accent.base : tk.border.default}`, opacity: m.enabled ? 1 : 0.55 };
  const chevron = <IconButton icon={collapsed ? 'chevR' : 'chevD'} label={collapsed ? 'Expand mapping' : 'Collapse mapping'} size="sm" tooltip={false} onClick={onToggle} style={{ marginLeft: -6 }} />;

  if (collapsed) {
    return (
      <div style={{ ...frame, padding: '4px 10px 6px 8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 26 }}>
          {chevron}
          <button type="button" onClick={onToggle} title="Expand" style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6, border: 0, background: 'none', padding: 0, cursor: 'pointer', color: tk.text.primary, font: `500 12px ${fontFamily.ui}`, textAlign: 'left' }}>
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 600 }}>{sourceLabel(m.source, controls, layerRefs)}</span>
            <Icon name="chevR" size={12} style={{ color: tk.text.faint, flexShrink: 0 }} />
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: tk.text.secondary }}>{control?.label ?? 'missing control'}</span>
          </button>
          {locked && <ProBadge title="This source needs Pro: kept, but it doesn't run on Free" />}
          <SoloButton kind="mapping" id={m.id} />
          <Toggle checked={m.enabled} onChange={enabled => onUpdate({ enabled })} />
        </div>
        <MappingMeter input={meter} output={shaped} on={m.enabled} margin="2px 0 0 22px" />
      </div>
    );
  }

  return (
    <div style={{ ...frame, padding: '8px 10px' }}>
      {/* Source row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {chevron}
        <span style={{ ...labelStyle, width: 40 }}>Source</span>
        <GroupedPicker ariaLabel="Source" value={type} sections={sourceSections} onChange={pickSource} height={26} style={{ flex: 1, minWidth: 0 }} width={300} searchPlaceholder="Search sources" />
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
        <SoloButton kind="mapping" id={m.id} />
        <IconButton icon="spark" label={learning ? 'Listening… (Esc to cancel)' : 'Learn: replace this source with the next input'} size="sm" active={learning} onClick={onLearn} />
        <IconButton icon="trash" label="Remove mapping" size="sm" tone="danger" onClick={onRemove} />
      </div>
      {locked && (
        <button type="button" onClick={() => openProSheet('play.sources')} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', margin: '6px 0 0', padding: '6px 8px', border: 0, borderRadius: radius.md, cursor: 'pointer', background: alpha(tk.accent.base, 0.08), color: tk.text.secondary, font: `11.5px/1.4 ${fontFamily.ui}`, textAlign: 'left' }}>
          <ProBadge />
          <span style={{ flex: 1, minWidth: 0 }}>This source needs Pro. It’s kept as it is but doesn’t run on Free.</span>
        </button>
      )}
      {/* Meter */}
      <MappingMeter input={meter} output={shaped} on={m.enabled} margin="6px 0 8px 60px" />
      <SourceOptions source={m.source} audioNodes={audioNodes} layerRefs={layerRefs} numStyle={numStyle} labelStyle={labelStyle} onChange={source => onUpdate({ source })} />
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
        <CurvePad value={m.curveY ?? sampleCurve('linear')} meter={meter} range={[m.outMin, m.outMax]} onChange={curveY => onUpdate({ curveY })} onReset={() => onUpdate({ curveY: sampleCurve('linear') })} />
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

interface LayerRef { id: string; label: string; kind: string; shape?: string }

/** The first layer that measures something, and what it reads (a new sensor source starts there). */
function firstSensor(layers: LayerRef[]): { layerId: string; read: SensorRead } | null {
  const l = layers.find(x => sensorReadsFor(x).length);
  return l ? { layerId: l.id, read: sensorReadsFor(l)[0] } : null;
}

/** The dataset a new Data source starts on: the first Data layer's, else the first in the graph. */
function firstDataset(): string {
  const st = useNodeGraphStore.getState();
  const l = st.play.layers.find(x => x.kind === 'data' && x.dataset);
  return (l?.kind === 'data' ? l.dataset : '') || Object.keys(st.datasets)[0] || '';
}

/** The second row of a mapping: the fields a source kind needs beyond its name. */
function SourceOptions({ source, audioNodes, layerRefs, numStyle, labelStyle, onChange }: {
  source: PlaySource;
  audioNodes: AudioNodeOption[];
  layerRefs: LayerRef[];
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
    case 'reader':
      return <ReaderSourceOptions source={source} row={row} hint={hint} onChange={onChange} />;
    case 'trigger':
      return <TriggerOptions source={source} layers={layerRefs} numStyle={numStyle} labelStyle={labelStyle} onChange={onChange} />;
    case 'hand':
      return (
        <>
          {row(<>
            {source.read !== 'spread' && <Segmented size="sm" ariaLabel="Which hand" value={source.side} options={HAND_SIDES} onChange={side => onChange({ ...source, side })} />}
            {source.read === 'point' && <>
              <GroupedPicker ariaLabel="Point on the hand" value={`${source.point}`} sections={HAND_POINT_SECTIONS} onChange={v => onChange({ ...source, point: parseInt(v, 10) || 0 })} height={26} style={{ flex: 1, minWidth: 110 }} width={220} searchPlaceholder="Search points" />
              <Segmented size="sm" ariaLabel="Axis" value={source.axis} options={[{ value: 'x', label: 'X' }, { value: 'y', label: 'Y' }, { value: 'z', label: 'Z', title: 'Toward the camera (from the wrist)' }]} onChange={axis => onChange({ ...source, axis })} />
            </>}
            {source.read === 'palm' && <Segmented size="sm" ariaLabel="Axis" value={source.axis === 'y' ? 'y' : 'x'} options={[{ value: 'x', label: 'X' }, { value: 'y', label: 'Y' }]} onChange={axis => onChange({ ...source, axis })} />}
            {source.read === 'pinch' && <Select ariaLabel="Finger the thumb pinches" value={`${source.point}`} options={PINCH_FINGERS} onChange={v => onChange({ ...source, point: parseInt(v, 10) || 8 })} height={26} />}
            {source.read === 'gesture' && <Select ariaLabel="Gesture" value={source.gesture} options={HAND_GESTURE_OPTIONS} onChange={v => onChange({ ...source, gesture: v as HandGesture })} height={26} />}
          </>)}
          <div style={{ margin: '-2px 0 6px 60px', color: tk.text.faint, font: `11px/1.4 ${fontFamily.ui}` }}>{HAND_READ_HINTS[source.read]}</div>
        </>
      );
    case 'data':
      return <DataSourceOptions source={source} labelStyle={labelStyle} onChange={onChange} />;
    case 'sensor': {
      const sensing = layerRefs.filter(l => sensorReadsFor(l).length);
      if (!sensing.length) return row(hint('Add a layer first: a shape, particles, a null…'));
      const layer = layerRefs.find(l => l.id === source.layerId);
      const reads = sensorReadsFor(layer);
      return (
        <>
          {row(<>
            <Select ariaLabel="Sensor layer" value={source.layerId} options={sensing.map(l => ({ value: l.id, label: l.label }))} onChange={v => { const r = sensorReadsFor(layerRefs.find(l => l.id === v)); onChange({ ...source, layerId: v, read: r.includes(source.read) ? source.read : r[0] ?? 'fill' }); }} height={26} />
            {reads.length > 1 && <Segmented size="sm" ariaLabel="Reads" value={source.read} options={reads.map(r => ({ value: r, label: SENSOR_LABELS[r], title: SENSOR_HINTS[r] }))} onChange={v => onChange({ ...source, read: v })} />}
            {reads.length === 1 && hint(SENSOR_LABELS[reads[0]])}
            {source.read === 'distance' && <>{hint('to')}<AnchorPicker value={source.otherId} layers={layerRefs} exclude={source.layerId} ariaLabel="Distance to" onChange={otherId => onChange({ ...source, otherId })} /></>}
          </>)}
          <div style={{ margin: '-2px 0 6px 60px', color: tk.text.faint, font: `11px/1.4 ${fontFamily.ui}` }}>{SENSOR_HINTS[source.read]}</div>
        </>
      );
    }
    default:
      return null;
  }
}

/** A reader source: which reader, what it reads, and the way to the spectrum. */
function ReaderSourceOptions({ source, row, hint, onChange }: {
  source: Extract<PlaySource, { kind: 'reader' }>;
  row: (children: ReactNode) => ReactNode;
  hint: (text: string) => ReactNode;
  onChange: (source: PlaySource) => void;
}) {
  const readers = useNodeGraphStore(s => s.play.audioReaders?.readers) ?? NO_READERS;
  const input = useNodeGraphStore(s => s.play.audioReaders?.input ?? '');
  const r = readers.find(x => x.id === source.readerId);
  const open = () => useReadersPanel.getState().show({ focus: source.readerId });
  return row(<>
    {readers.length > 1 && <Select ariaLabel="Reader" value={r ? r.id : ''} options={[...(r ? [] : [{ value: '', label: 'Missing reader' }]), ...readers.map(x => ({ value: x.id, label: x.name }))]} onChange={v => onChange({ kind: 'reader', readerId: v })} height={26} style={{ maxWidth: 150 }} />}
    {r ? hint(`${formatHz(r.hz)} · ${formatWidth(r.width)} · ${r.gain > 0 ? '+' : ''}${Math.round(r.gain)} dB`) : hint('This reader was deleted')}
    <Button size="sm" icon="wave" onClick={open}>Spectrum</Button>
    {!input && <LiveAudioChip readers={false} />}
  </>);
}

/** Where a trigger fires from and what it does. */
function TriggerOptions({ source, layers, numStyle, labelStyle, onChange }: {
  source: Extract<PlaySource, { kind: 'trigger' }>;
  layers: ReadonlyArray<TriggerLayerRef>;
  numStyle: React.CSSProperties;
  labelStyle: React.CSSProperties;
  onChange: (source: PlaySource) => void;
}) {
  const row = (label: string, children: ReactNode, top = false) => (
    <div style={{ display: 'flex', alignItems: top ? 'flex-start' : 'center', gap: 6, marginBottom: 6, flexWrap: top ? 'nowrap' : 'wrap' }}>
      <span style={top ? { ...labelStyle, lineHeight: '26px' } : labelStyle}>{label}</span>
      {children}
    </div>
  );
  const t = source.trigger;
  const setT = (trigger: TriggerSpec) => onChange({ ...source, trigger });
  return (
    <>
      {row('On', <TriggerPicker trigger={t} layers={layers} numStyle={numStyle} onChange={setT} />)}
      {row('Fires', <FirePicker trigger={t} what={`mode:${source.mode}`} numStyle={numStyle} onChange={setT} />, true)}
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
/**
 * The drawn remap curve: x is the source (0..1), y what the mapping sees.
 * Drag across the pad to draw; the faint diagonal is the untouched 1:1 line and
 * the dot is the source's reading right now, so you can see where you are on
 * the curve while you turn the knob.
 */
/**
 * A mapping's meter: the bar is what the control gets (after the curve), the
 * tick is the source's raw reading. With a straight curve they sit together;
 * a drawn or Exp/Log curve pulls them apart, so its effect is visible.
 */
function MappingMeter({ input, output, on, margin }: { input: number; output: number; on: boolean; margin: string }) {
  const tk = useTokens();
  const i = Math.max(0, Math.min(1, input)), o = Math.max(0, Math.min(1, output));
  return (
    <div title={`Bar: what the control gets (${Math.round(o * 100)}% of its range). Tick: the source (${Math.round(i * 100)}%).`} style={{ position: 'relative', height: 5, margin, borderRadius: 2, background: tk.bg.field, overflow: 'hidden' }}>
      <div style={{ width: `${o * 100}%`, height: '100%', background: on ? tk.accent.base : tk.text.disabled, transition: 'width 60ms linear' }} />
      <div style={{ position: 'absolute', top: 0, bottom: 0, left: `calc(${i * 100}% - 1px)`, width: 2, background: on ? tk.text.secondary : tk.text.disabled, opacity: 0.7, transition: 'left 60ms linear' }} />
    </div>
  );
}

function CurvePad({ value, meter, range, onChange, onReset }: { value: number[]; meter: number; range: [number, number]; onChange: (ys: number[]) => void; onReset: () => void }) {
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
  const fmtOut = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2));
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
          {/* Up from the source, across to what the control gets. */}
          <line x1={mx * W} y1={H} x2={mx * W} y2={(1 - my) * H} stroke={tk.text.faint} strokeWidth={1} vectorEffect="non-scaling-stroke" />
          <line x1={0} y1={(1 - my) * H} x2={mx * W} y2={(1 - my) * H} stroke={tk.accent.base} strokeWidth={1} strokeDasharray="3 2" vectorEffect="non-scaling-stroke" />
        </svg>
        <span style={{ position: 'absolute', right: 6, top: 4, color: tk.text.faint, font: `500 10px ${fontFamily.mono}`, pointerEvents: 'none' }}>
          in {mx.toFixed(2)} → {fmtOut(range[0] + (range[1] - range[0]) * my)}
        </span>
        <span style={{ position: 'absolute', left: `calc(${mx * 100}% - 4px)`, top: `calc(${(1 - my) * 100}% - 4px)`, width: 8, height: 8, borderRadius: '50%', background: tk.accent.base, boxShadow: `0 0 0 2px ${tk.bg.panel}`, pointerEvents: 'none' }} />
      </div>
      <IconButton icon="reset" label="Back to a straight line" size="sm" onClick={onReset} style={{ alignSelf: 'flex-start' }} />
    </div>
  );
}
