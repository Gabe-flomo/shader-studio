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
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { DataSourceOptions } from './DataSourceOptions';
import { getNodeDefinitionFor } from '../../nodes/definitions';
import type { GraphNode } from '../../types/nodeGraph';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import type { PlayControl, PlayLayer, PlayMapping, PlayRecord, PlayRoute, PlaySource, PlaySourceDef, SourceOutput } from '../../types/play';
import { RANDOM_SOURCES, addFreeSource, patchRoute, patchSource, removeRoute, removeSource, routeToControl, routesInto } from '../../play/routeOps';
import { rtAddSwing } from '../../play/kit/routes.js';
import { useMapMode } from './inputs/mapMode';
import { MapModeBar, MapTarget } from './inputs/MapTarget';
import { InputsBoard } from './inputs/InputsBoard';
import { SwingStrip } from './inputs/SwingStrip';
import { SourceDragHandle } from './inputs/SourceDragHandle';
import { SourceGroups } from './inputs/SourceGroups';
import type { SourceItem } from './mappingGroups';
import { dropOutcome } from './inputs/sourceDrag';
import { controlSwing, type Swing } from '../../play/controlSwing';
import { DetailWindow } from './detail/DetailWindow';
import { startPlayNotes } from '../../lib/playNotes';
import { openDetail } from './detail/detailStore';
import { CHANNELS, COLOUR_CHANNELS, CURVES, HAND_GESTURE_OPTIONS, HAND_READ_HINTS, HAND_SIDES, LFO_SHAPES, LIVE_BAND_OPTIONS, NOISE_TYPES, PINCH_FINGERS, SENSOR_HINTS, SENSOR_LABELS, OPEN_READERS, TILT_AXES, TRIGGER_MODES, keyName, sourceFromType, withFire, sourceLabel, sourceType, type SourceType } from '../../play/playSources';
import { CAPTURE_POS, PER_GRAIN_READS, sensorReadsFor, type SensorRead } from '../../types/play';
import { GRAIN_EACH, grainSensorLayer, isGranulatorRack, parseGrainsTarget } from '../../types/playAudioEngine';
import { ConnectGuide } from './ConnectGuide';
import type { LfoShape, LiveAudioBand, TriggerSpec } from '../../types/play';
import { applyCurve, FN_BEAT_HZ, playEngine, sampleCurve } from '../../lib/playEngine';
import { fnEval } from '../../play/kit/fn.js';
import { subscribeTimeTick } from '../../lib/timeTick';
import { midiEngine, midiNoteName } from '../../lib/midiEngine';
import { ASSIGN_FLASH_MS, claimMidiListen, isUnassignedCc, startMidiAutoLearn } from '../../lib/midiAutoLearn';
import { MidiWaitChip } from './MidiSourceOptions';
import {
  candidateLabel, collectPlayCandidates, controlExists, controlHelp, findTargetNode, locateTarget, playId, readControlValue, targetParts, type PlayCandidate, type TargetFate,
} from '../../play/playControls';
import { Button, IconButton } from '../ui/Button';
import { rowField, rowGroup } from '../ui/rowLayout';
import { useNarrow } from '../../hooks/useNarrow';
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
import { AspectPicker, CanvasFullscreenButton, PreviewQualityPicker } from '../shell/PreviewChrome';
import { NOTE_REF_TYPE, noteRef, type NoteRefKind } from './noteRefs';
import { LayerContextMenu } from './LayerContextMenu';
import { driveWithNull, graphNullDrives, layerNullDrives, pairedKey, type NullDrive } from './layerOps';
import { toast } from '../ui/toastStore';
import { usePlayUi, type PanelSize, type PlayTab } from './playUi';
import { applyControlLink, LinkableControl, useControlLinkEscape } from './ControlLink';
import { setLayerDropHandler } from '../../play/layerDrop';
import { addDroppedLayers, dropLabel } from './dropLayers';
import { appDropMakers } from './dropMakers';
import { sidebarView, startRule, useBigPage, useBigTab, usePlaySplit } from './playSplit';
import { PlayRailBar } from './PlayRail';
import { phonePageShown, type RailPage } from './railPages';
import { BackgroundPage, CardPage } from './FullPages';
import { RulesPage } from './rules/RulesPage';
import { ControlsBoard, type BoardSlot } from './ControlsBoard';
import { AudioEnginePanel } from './engine/AudioEnginePanel';
import { aeRack, aeSlot, aeSlotLabel, parseAuTarget, parseMacroTarget, patchSlot, rackMacros } from '../../types/playAudioEngine';
import { setMacroValue } from '../../play/rackMacros';
import { SplitButton } from './PlaySplitArea';
import { EmbedDialog } from './EmbedDialog';
import { MiniMapper } from './MiniMapper';
import { wireRuleWhen, type MiniMapperTarget } from './miniMapperCore';
import { LiveAudioChip, MidiStatusChip, OscStatusChip } from './chips';
import { rackKeyboard } from '../../lib/rackKeyboard';
import { keyboardClaimed } from '../../lib/keyboardClaim';
import { HandsButton, HandsChip } from './HandsChip';
import { TrackPointPicker, TrackerChip } from './TrackingChips';
import { BLEND_OPTIONS, FACE_GESTURE_OPTIONS, FACE_READ_HINTS, POSE_GESTURE_OPTIONS, POSE_READ_HINTS } from '../../play/trackSources';
import type { FaceGesture, PoseGesture } from '../../types/playTracking';
import { handFeed } from '../../lib/handFeed';
import { usesHands, type HandGesture } from '../../types/play';
import { ColourPad } from './ColourPad';
import { anyLiveMapped } from './useLiveValues';
import { useLiveValue, usePolledNumber } from './liveValueStore';
import { useStage } from './stageStore';
import { useTakes } from '../../lib/takes';
import { startOverMenuItem } from '../../play/startOver';
import { SoloButton, SoloStrip } from './Solo';
import { GuidesToggle } from './GuidesToggle';
import { OpenPlayableButton } from './OpenPlayable';
import { MidiFileCard } from './MidiFileCard';
import { MidiSourceOptions, PadSourceOptions } from './MidiSourceOptions';
import { PadGridCard } from './PadGridCard';
import { AnchorPicker, FirePicker, TriggerPicker, type TriggerLayerRef } from './TriggerPicker';
import { actionsForLayer, layerNumericProps, actionTarget, defaultActionAmount, layerTarget, parseActionTarget, parseLayerTarget, parsePropTarget, type ActionKind } from '../../types/play';
import { AUDIO_FX_EFFECTS, audioFxControlFor, audioFxEffect, audioFxHosts, audioFxParam, parseAudioFxTarget, patchAudioFxEffect, readAudioFxValue } from '../../types/playAudioFx';
import { finishHost, finishHostLabel, finishHosts, finishNumericProps, finishParamOf, finishTarget, parseFinishTarget, patchFinishEffect, readFinishValue } from '../../types/playFinish';
import { playBackground } from '../../play/background';
import { BackgroundRow } from './BackgroundRow';
import { actionLabel } from './layers/help';
import { AudioReadersHost } from './AudioReadersPanel';
import { useReadersPanel } from './readersPanelUi';
import { formatHz, formatWidth } from '../../play/audioReaders';
import { addMissingReaderControls, readerSourceName, readersWithoutControls, removeReader, renameReader } from '../../play/readerControls';
import { parseReaderTarget } from '../../types/play';
import type { AudioReader } from '../../types/play';
import type { PlayPairMapping } from '../../types/play';
import { ContextMenuArea } from '../ui/ContextMenuArea';
import { Menu, type MenuItem } from '../ui/Menu';
import type { IconName } from '../ui/iconPaths';
import { SpreadsSection } from './SpreadsSection';
import { parseSpreadTarget } from '../../types/play';
import { addToSpread, canSpread, makeSpread, removeFromSpread, spreadOf } from '../../play/spreads';
import { wireSpreadResets } from '../../play/spreadReset';
import { PairCard, PairMappingRow, pairMappingLabel } from './PairControls';
import { makePair, newPairMapping, pairOf, partnerTarget, positionPair, unpair } from '../../play/pairs';
import { pairDrives, signalSource } from '../../lib/playEngine';
import { SIGNAL_SOURCE } from './sourcePickerSections';
import { IncrementEditor } from './IncrementEditor';
import { incrementSummary, mappingLabel } from '../../play/incrementUi';
import { defaultIncrement, type PlayIncrement } from '../../types/play';
import { recordBpm } from '../../types/playArrangement';

// Live values and meters are read where they show (liveValueStore.ts): a control's slider, a
// mapping's meter. The page and the drawer don't hold them, so they don't render on every poll.

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
  // A group's Iterations on the panel is live (a uniform, compiled to the cap); off the panel it's a literal again.
  const playControls = useNodeGraphStore(s => s.play.controls);
  useEffect(() => {
    const driven = new Set(playControls.filter(c => c.target.endsWith('::iterations')).map(c => c.target.slice(0, -'::iterations'.length)));
    for (const n of nodes) {
      if (n.type !== 'group') continue;
      const want = driven.has(n.id);
      if (want !== (n.params.liveIterations === true)) useNodeGraphStore.getState().updateNodeParams(n.id, { liveIterations: want || undefined });
    }
  }, [nodes, playControls]);
  const paramBindings = useNodeGraphStore(s => s.paramBindings);
  const updateNodeParams = useNodeGraphStore(s => s.updateNodeParams);
  const [embedOpen, setEmbedOpen] = useState(false);
  const importGraphFromFile = useNodeGraphStore(s => s.importGraphFromFile);
  const pageMoreRef = useRef<HTMLSpanElement>(null);
  const [pageMore, setPageMore] = useState<{ x: number; y: number } | null>(null);

  // Mouse and keyboard sources listen only while this page shows. Solo is for this page only.
  useEffect(() => {
    playEngine.setPerforming(true);
    // Play notes reactions sound on their racks while Play is open; leaving lets every note go.
    const stopNotes = startPlayNotes();
    usePlayUi.getState().setPerforming(true);
    rackKeyboard.setPage(true);
    return () => { stopNotes(); rackKeyboard.setPage(false); playEngine.setPerforming(false); usePlayUi.getState().setPerforming(false); usePlayUi.getState().clearSolo(); };
  }, []);
  // An image, video or colour background replaces the shader while this page shows (the Studio keeps the graph).
  useEffect(() => playBackground.claim(), []);
  // H shows or hides the picture's guides, unless a mapping listens to H.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'KeyH' || e.repeat || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || keyboardClaimed(e)) return;
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

  // Live values are read per row (liveValueStore): the page itself doesn't render on every poll.
  const liveOn = anyLiveMapped(play);
  const candidates = useMemo(() => collectPlayCandidates(nodes, paramBindings), [nodes, paramBindings]);

  const writeControl = useCallback((control: PlayControl, value: number | number[]) => {
    // A reader's level control: its reader drives it; there is nothing to set by hand.
    if (parseReaderTarget(control.target) || parseGrainsTarget(control.target)) return;
    const ft = parseFinishTarget(control.target);
    if (ft) {
      if (typeof value === 'number') setPlay(p => ({ ...p, finish: patchFinishEffect(p.finish, ft.effectId, { [ft.key]: value }) }));
      return;
    }
    const at = parseAudioFxTarget(control.target);
    if (at) {
      if (typeof value === 'number') setPlay(p => ({ ...p, audioFx: patchAudioFxEffect(p.audioFx, at.chainId, at.effectId, { [at.key]: value }) }));
      return;
    }
    const au = parseAuTarget(control.target);
    if (au) {
      if (typeof value === 'number') setPlay(p => ({ ...p, audioEngine: patchSlot(p.audioEngine, au.rackId, au.slotId, { params: { ...aeSlot(aeRack(p.audioEngine, au.rackId), au.slotId)?.params, [au.address]: value } }) }));
      return;
    }
    const mt = parseMacroTarget(control.target);
    if (mt) {
      if (typeof value === 'number') setPlay(p => setMacroValue(p, mt.rackId, mt.n, value));
      return;
    }
    // A Spread's Amount or Shift: the Spread keeps it (docs/spread-control.md).
    const st = parseSpreadTarget(control.target);
    if (st) {
      if (typeof value === 'number') setPlay(p => ({ ...p, spreads: (p.spreads ?? []).map(x => (x.id === st.spreadId ? { ...x, [st.key]: value } : x)) }));
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
  // ⌘-click a control, then a second one, to quick-link them (ControlLink.tsx); Esc cancels.
  useControlLinkEscape();
  const linkControl = useCallback((sourceId: string, targetId: string) => applyControlLink(play, update, sourceId, targetId), [play, update]);
  // Images and videos dropped on the picture become layers where they land (play/layerDrop.ts).
  useEffect(() => setLayerDropHandler({
    label: n => dropLabel(n),
    drop: (files, at) => { void addDroppedLayers(files, at, update, appDropMakers); },
  }), [update]);
  // What this plan runs (play/planGates.ts). Locked parts stay visible, and nothing in the record is removed.
  const layersOk = useCan('play.layers');
  const finishOk = useCan('play.finish');
  const audioFxOk = useCan('play.audioFx');
  const engineOk = useCan('audio.engine');
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
  const songLabel = useCallback((id: string) => { const n = nodes.find(x => x.id === id && x.type === 'audioInput'); return n ? ((typeof n.params.label === 'string' && n.params.label.trim()) || 'Audio Input') : undefined; }, [nodes]);
  const sourceOf = (c: PlayControl): ControlSource => {
    const rt = parseReaderTarget(c.target);
    if (rt) {
      const r = play.audioReaders?.readers.find(x => x.id === rt.readerId);
      return { kind: 'reader', title: r ? `Audio readers · ${readerSourceName(play, songLabel)}` : 'a deleted reader', param: r ? `${r.name} · ${formatHz(r.hz)} · ${formatWidth(r.width)}` : 'level', missing: !r, go: () => useReadersPanel.getState().show({ focus: rt.readerId }) };
    }
    const at = parseActionTarget(c.target);
    if (at) {
      const l = play.layers.find(x => x.id === at.layerId);
      return { kind: 'layer', title: l?.label ?? 'a deleted layer', param: actionLabel(at.do, l), missing: !l, go: () => { if (l) revealLayerFor(l.id); } };
    }
    const af = parseAudioFxTarget(c.target);
    if (af) {
      const e = audioFxEffect(play.audioFx, af.chainId, af.effectId);
      return { kind: 'layer', title: e ? `Sound · ${AUDIO_FX_EFFECTS[e.kind].label}` : 'a removed audio effect', param: (e && audioFxParam(e.kind, af.key)?.label) ?? af.key, missing: !e, go: () => { if (e) usePlayUi.getState().revealAudioFx(e.id); } };
    }
    const aut = parseAuTarget(c.target);
    if (aut) {
      const r = aeRack(play.audioEngine, aut.rackId), sl = aeSlot(r, aut.slotId);
      return { kind: 'layer', title: r && sl ? aeSlotLabel(r, sl) : 'a removed Audio Unit', param: c.label.split(' · ').pop() ?? aut.address, missing: !sl, go: () => usePlayUi.getState().setTab('engine') };
    }
    const mct = parseMacroTarget(c.target);
    if (mct) {
      const r = aeRack(play.audioEngine, mct.rackId);
      return { kind: 'layer', title: r ? `${r.name} · Macros` : 'a removed rack', param: r ? rackMacros(r)[mct.n - 1].name : `Macro ${mct.n}`, missing: !r, go: () => usePlayUi.getState().setTab('engine') };
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
  // The audio effects' numbers (types/playAudioFx.ts): targets `audiofx:<chain>:<effect>::<key>`; a host's id is the part before `::`.
  const soundCandidates = useMemo<LayerCandidates[]>(() => audioFxHosts(play.audioFx, play.layers).map(h => ({
    id: h.id, label: `Sound · ${h.label}`,
    props: h.params.map(d => ({ key: d.key, label: d.label, hint: d.hint || undefined, min: d.min, max: d.max, ...(d.step ? { step: d.step } : {}) })),
    actions: [],
  })), [play.audioFx, play.layers]);
  const addSoundControl = useCallback((hostId: string, key: string, withNull: boolean) => {
    const target = `${hostId}::${key}`;
    const c = audioFxControlFor(play.audioFx, play.layers, target);
    if (!c) return;
    if (withNull) { addWithNull([{ target, label: c.label, min: c.min, max: c.max, ...(c.step ? { step: c.step } : {}), value: readAudioFxValue(play.audioFx, target) ?? c.min, axis: 'x' }], `${c.label} null`); return; }
    update(p => (p.controls.some(x => x.target === target) ? p : { ...p, controls: [...p.controls, { id: playId('ctl'), ...c }] }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [play.audioFx, play.layers, update]);
  // A layer's actions (Drop again, Burst…) as buttons on the panel, which mappings can press.
  const addActionControl = useCallback((layerId: string, kind: ActionKind) => {
    update(p => {
      const l = p.layers.find(x => x.id === layerId);
      const target = actionTarget(layerId, kind);
      if (!l || p.controls.some(c => c.target === target)) return p;
      return { ...p, controls: [...p.controls, { id: playId('ctl'), target, kind: 'action', label: `${l.label} · ${actionLabel(kind, l)}`, min: 0, max: 1, amount: defaultActionAmount(kind) }] };
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
  // The sidebar folded into the rail: the panel shows one page full width (railPages.ts).
  const railPage = useBigPage();
  const bigPage = compact ? null : railPage;
  const splitHost = usePlaySplit(s => s.host);
  const splitWide = usePlaySplit(s => s.wide);
  const sidebarGone = usePlaySplit(s => s.sidebar !== 'full') && big !== null;
  // Phones: the page picked from the bottom row (a Layers or Mappings page of its own, or the tab's).
  const phonePicked = usePlayUi(s => s.phonePage), finishView = usePlayUi(s => s.finishView);
  const phonePage: RailPage | null = compact ? phonePageShown(tab, finishView, phonePicked) : null;
  const sideView = sidebarView(tab, big);
  // A phone page that isn't a whole section (Actions, Signals, Background, MIDI file, Pad grid) shows on its own.
  const phoneOwn = !!phonePage && OWN_PAGES.has(phonePage);
  const shown: PlayTab | null = compact ? (phoneOwn ? null : tab) : sideView.tab;
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
  // Readers with no control (an older setup): offered once, until dismissed for this set of readers.
  const missingReaderControls = useMemo(() => readersWithoutControls(play), [play]);
  const missingReaderKey = missingReaderControls.map(r => r.id).join(',');
  const [readerChipDismissed, setReaderChipDismissed] = useState('');
  // "Controls →" on a source card: scroll to the control group and flash it.
  const groupFocus = usePlayUi(s => s.controlGroupFocus), groupTick = usePlayUi(s => s.controlGroupTick);
  useEffect(() => {
    if (!groupTick || !groupFocus) return;
    const ui = usePlayUi.getState();
    if (ui.folded[`ctlgroup:${groupFocus}`]) ui.toggleFold(`ctlgroup:${groupFocus}`, false);
    const raf = requestAnimationFrame(() => {
      const sel = `[data-control-group="${CSS.escape(groupFocus)}"]`;
      const el = rootRef.current?.querySelector<HTMLElement>(sel) ?? usePlaySplit.getState().host?.querySelector<HTMLElement>(sel);
      if (!el) return;
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      const was = el.style.boxShadow;
      el.style.boxShadow = `inset 0 0 0 2px ${tk.accent.base}`;
      window.setTimeout(() => { el.style.boxShadow = was; }, 1200);
    });
    return () => cancelAnimationFrame(raf);
  }, [groupTick, groupFocus, tk.accent.base]);
  // Layers a source or trigger can read: shapes (click, fill, hover), particles (speed, spread), cameras (motion), nulls (distance).
  // Granulator racks read like layers in the sensor pickers (their grains: docs/granulator.md), as `ae:<rackId>`.
  const layerRefs = useMemo(() => [
    ...play.layers.map(l => ({ id: l.id, label: l.label, kind: l.kind, ...(l.kind === 'shape' ? { shape: l.shape } : {}) })),
    ...(play.audioEngine?.racks ?? []).filter(isGranulatorRack).map(r => ({ id: grainSensorLayer(r.id), label: `${r.name} · grains`, kind: 'granulator' })),
  ], [play.layers, play.audioEngine]);
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

  // Shared with the Mappings empty state (rendered there too, when there's no control yet to map onto).
  const addControlButtonEl = (
    <AddControlButton compact={compact} candidates={candidates} layers={layersOk ? layerCandidates : NO_LAYER_CANDIDATES} finish={finishOk ? finishCandidates : NO_LAYER_CANDIDATES} layerById={id => play.layers.find(l => l.id === id)} taken={new Set(play.controls.map(c => c.target))} onAdd={addControl} onAddFinish={addFinishControl} sound={audioFxOk ? soundCandidates : NO_LAYER_CANDIDATES} onAddSound={addSoundControl} onAddAction={addActionControl} onAddNull={addWithNull} />
  );
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
        {addControlButtonEl}
        <span ref={pageMoreRef} style={{ display: 'inline-flex' }}>
          <IconButton icon="more" label="More" onClick={() => { const r = pageMoreRef.current?.getBoundingClientRect(); setPageMore(r ? { x: r.right - 200, y: r.bottom + 4 } : null); }} />
        </span>
        {pageMore && <Menu x={pageMore.x} y={pageMore.y} minWidth={200} onClose={() => setPageMore(null)} items={[startOverMenuItem(() => setPageMore(null))]} />}
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
  useEffect(() => { wireSpreadResets(); }, []);
  /** Spread items for a slider's menu (docs/spread-control.md): join one, leave one, or start one with it. */
  const spreadMenu = (id: string): MenuItem[] => {
    const c = play.controls.find(x => x.id === id);
    if (!canSpread(c)) return [];
    const inSpread = spreadOf(play, id);
    const items: MenuItem[] = [{ heading: 'Spread' }];
    if (inSpread) items.push({ label: `Remove from ${inSpread.label}`, icon: 'close', onSelect: () => update(p => removeFromSpread(p, inSpread.id, id)) });
    for (const sp of (play.spreads ?? []).filter(x => x.id !== inSpread?.id)) items.push({ label: `Add to ${sp.label}`, icon: 'sliders', hint: 'At the end of its order', onSelect: () => update(p => addToSpread(p, sp.id, id)) });
    items.push({ label: 'New Spread with this', icon: 'plus', hint: 'A group of sliders offset together along a curve', onSelect: () => { update(p => makeSpread(p, [id]).play); toast.info('Spread made: its card is at the top of Controls'); } });
    return items;
  };
  /** Rule from this: Quick rule, with this control going above its middle as the When. */
  const signalItems = (c: PlayControl | undefined): MenuItem[] => (c && c.kind !== 'color' ? [{
    label: 'Rule from this', icon: 'bolt', hint: 'When it goes above the middle of its range: pick what happens',
    onSelect: () => {
      const r = wireRuleWhen(play, { control: c.id });
      if (!r) return;
      update(() => r.play);
      startRule({ when: r.when });
    },
  }, 'separator'] : []);
  const controlMenu = (id: string): MenuItem[] => {
    const c = play.controls.find(x => x.id === id);
    if (!c || c.kind !== 'float') return [...signalItems(c), { label: 'Only sliders pair', disabled: true, onSelect: () => {} }];
    const partner = partnerTarget(c.target);
    const others = play.controls.filter(x => x.id !== id && x.kind === 'float' && !pairOf(play, x.id));
    const items: MenuItem[] = [{
      label: c.toggle ? 'Show as a slider' : 'Show as a switch', icon: c.toggle ? 'sliders' : 'check',
      hint: c.toggle ? undefined : 'On and off: its high end and its low end',
      onSelect: () => update(p => ({ ...p, controls: p.controls.map(x => { if (x.id !== id) return x; const n = { ...x }; if (x.toggle) delete n.toggle; else n.toggle = true; return n; }) })),
    }, 'separator'];
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
    return [...signalItems(c), ...items, ...spreadMenu(id)];
  };
  const pairMenu = (pairId: string): MenuItem[] => [
    { label: 'Map onto the pair', icon: 'plus', onSelect: () => addPairMapping(pairId) },
    { label: 'Unpair', icon: 'close', hint: 'Two separate sliders again; its pair mappings go', onSelect: () => update(p => unpair(p, pairId)) },
  ];
  // Map mode (inputs/mapMode.ts): a click on a control routes the picked source there, or takes it off again.
  const mapSrc = useMapMode(m => m.sourceId);
  useEffect(() => {
    if (!mapSrc) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') useMapMode.getState().stop(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mapSrc]);
  /** A route from this source onto this control, with the likely defaults (routeOps.ts), said in words. */
  const routeSource = (sourceId: string, controlId: string) => {
    let said = '';
    update(p => { const r = routeToControl(p, sourceId, controlId); said = r.said; return r.play; });
    if (said) toast.info(said);
  };
  const mapPick = (controlId: string) => {
    if (!mapSrc) return;
    const on = routesInto(play, controlId).find(x => x.sourceId === mapSrc);
    if (on) { update(p => (on.mapping ? { ...p, mappings: p.mappings.filter(m => m.id !== on.sourceId) } : removeRoute(p, on.sourceId, on.routeId))); return; }
    routeSource(mapSrc, controlId);
  };
  // A source dropped on a control card (inputs/sourceDrag.ts): the same route a Map click makes, never taken off.
  const dropSource = (sourceId: string, controlId: string) => {
    const c = play.controls.find(x => x.id === controlId);
    const out = dropOutcome(play, sourceId, controlId);
    if (out === 'route') routeSource(sourceId, controlId);
    else if (out === 'already') toast.info(`It already drives ${c?.label ?? 'that control'}`);
    else if (out === 'full') toast.info('That source drives as many controls as it can');
  };
  /** What drives a control, in words: its mappings, and the record's sources routed onto it. */
  const drivenLabels = (id: string) => [...play.mappings.filter(m => m.enabled && m.controlId === id).map(m => mappingLabel(m, play)), ...routesInto(play, id).filter(x => !x.mapping).map(x => `${x.label}${x.mode === 'add' ? ' (add)' : ''}`)];
  /** The swing ring: where its sources can move it, from its own slider value (Add routes swing around it). */
  const swingOf = (c: PlayControl) => { const v = readControlValue(nodes, c.target, play); return controlSwing(play, c.id, typeof v === 'number' ? v : c.min); };
  // A control's card (a pair's shows once, where its A is). `board`: the Controls board's trace slot and isolate.
  const renderOne = (c: PlayControl, i: number, board?: BoardSlot): ReactNode => {
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
          <LivePairCard
            liveOn={liveOn}
            pair={pair} a={c} b={cb} touch={compact}
            values={[num(readControlValue(nodes, c.target, play)), num(readControlValue(nodes, cb.target, play))]}
            drivenA={pms.some(m => pairDrives(m, pair, c.id)) || play.mappings.some(m => m.enabled && m.controlId === c.id)}
            drivenB={pms.some(m => pairDrives(m, pair, cb.id)) || play.mappings.some(m => m.enabled && m.controlId === cb.id)}
            drivenBy={[...pms.map(m => pairMappingLabel(m, play)), ...play.mappings.filter(m => m.enabled && (m.controlId === c.id || m.controlId === cb.id)).map(m => mappingLabel(m, play))]}
            onChange={(ctl, v) => writeControl(ctl, v)}
            onRename={label => update(p => ({ ...p, pairs: (p.pairs ?? []).map(x => (x.id === pair.id ? { ...x, label } : x)) }))}
            onPosition={position => update(p => ({ ...p, pairs: (p.pairs ?? []).map(x => (x.id === pair.id ? { ...x, position } : x)) }))}
            onUnpair={() => update(p => unpair(p, pair.id))}
            onMap={() => addPairMapping(pair.id)}
            trace={board?.trace}
            onName={board?.onIsolate}
            isolated={board?.isolated}
          />
        </ContextMenuArea>
      );
    }
    return (
    <MapTarget key={c.id} label={c.label} driven={!!mapSrc && routesInto(play, c.id).some(x => x.sourceId === mapSrc)} onPick={() => mapPick(c.id)} onDropSource={id => dropSource(id, c.id)}>
    <LinkableControl id={c.id} play={play} onLink={linkControl}>
    <ContextMenuArea items={() => controlMenu(c.id)}>
    <ControlRow
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
      liveOn={liveOn}
      drivenBy={drivenLabels(c.id)}
      swing={c.kind === 'float' && !c.toggle ? swingOf(c) : null}
      touch={compact}
      onChange={v => writeControl(c, v)}
      onRename={label => update(p => { const rt = parseReaderTarget(c.target); return rt ? renameReader(p, rt.readerId, label) : { ...p, controls: p.controls.map(x => x.id === c.id ? { ...x, label } : x) }; })}
      onRange={(min, max) => update(p => ({ ...p, controls: p.controls.map(x => x.id === c.id ? { ...x, min, max } : x) }))}
      onMove={dir => update(p => {
        const j = i + dir;
        if (j < 0 || j >= p.controls.length) return p;
        const controls = [...p.controls];
        [controls[i], controls[j]] = [controls[j], controls[i]];
        return { ...p, controls };
      })}
      removeLabel={parseReaderTarget(c.target) ? 'Delete the reader (and this control)' : undefined}
      onRemove={() => update(p => { const rt = parseReaderTarget(c.target); return rt ? removeReader(p, rt.readerId) : { ...p, controls: p.controls.filter(x => x.id !== c.id), mappings: p.mappings.filter(m => m.controlId !== c.id) }; })}
      trace={board?.trace}
      onName={board?.onIsolate}
      isolated={board?.isolated}
    />
    </ContextMenuArea>
    </LinkableControl>
    </MapTarget>
    );
  };
  // What drives a trace on the Controls board (a control id, or `pair:<id>`), for its isolated strip.
  const traceDrivenBy = (key: string): string[] => {
    if (key.startsWith('pair:')) {
      const pair = play.pairs?.find(p => `pair:${p.id}` === key);
      if (!pair) return [];
      return [...(play.pairMappings ?? []).filter(m => m.enabled && m.pairId === pair.id).map(m => pairMappingLabel(m, play)), ...play.mappings.filter(m => m.enabled && (m.controlId === pair.a || m.controlId === pair.b)).map(m => mappingLabel(m, play))];
    }
    return drivenLabels(key);
  };
  const renderControls = (inPanel: boolean) => (
    <div style={{ flex: 1, minHeight: play.notes && !compact && !inPanel ? 110 : 0, overflowY: 'auto', padding: inPanel ? '8px 16px 16px' : '6px 12px 12px' }}>
      {compact && (
        // Phones: everything scrolls together under the picture, notes first.
        <div style={{ margin: '0 -12px 6px' }}>
          {notesCard}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 12px', overflowX: 'auto' }}>
            <span style={{ color: tk.text.faint, font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Canvas</span>
            <AspectPicker onPanel />
            <PreviewQualityPicker onPanel />
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
      {missingReaderControls.length > 0 && readerChipDismissed !== missingReaderKey && (
        <div data-reader-chip style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', margin: '4px 0 8px', padding: '6px 8px', borderRadius: radius.md, background: alpha(tk.accent.base, 0.1), color: tk.text.secondary, font: `11.5px/1.4 ${fontFamily.ui}` }}>
          <span style={{ flex: '1 1 160px', minWidth: 0 }}>{missingReaderControls.length === 1 ? `The reader ${missingReaderControls[0].name} has no control yet.` : `${missingReaderControls.length} audio readers have no controls yet.`} Each reader can be a control here: its live level, to map as Another control or use in conditions.</span>
          <Button size="sm" variant="primary" onClick={() => update(p => addMissingReaderControls(p, songLabel))} title="A 0–1 control per reader, in a group named after what they listen to">Add controls for {missingReaderControls.length} reader{missingReaderControls.length === 1 ? '' : 's'}</Button>
          <IconButton icon="close" label="Not now" size="sm" onClick={() => setReaderChipDismissed(missingReaderKey)} />
        </div>
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
      ) : inPanel ? (
        <>
          <SpreadsSection play={play} nodes={nodes} update={update} />
          <ControlsBoard play={play} renderCard={renderOne} drivenBy={traceDrivenBy} flatView={renderFlatControls(true)} />
        </>
      ) : renderFlatControls(false)}
    </div>
  );
  // Every card in one grid (the sidebar; the board's Flat grid), with the author's groups under their headings.
  const renderFlatControls = (inPanel: boolean) => (
    <div style={inPanel ? PANEL_GRID : undefined}>{(() => {
      // Controls with a group sit together under its heading, where the first of them is.
      const items: ReactNode[] = [];
      const shownGroups = new Set<string>();
      play.controls.forEach((c, i) => {
        if (!c.group) { items.push(renderOne(c, i)); return; }
        if (shownGroups.has(c.group)) return;
        shownGroups.add(c.group);
        const members = play.controls.map((x, j) => [x, j] as const).filter(([x]) => x.group === c.group);
        items.push(
          <ControlGroup key={`group:${c.group}`} name={c.group} count={members.length} grid={inPanel}>
            {members.map(([x, j]) => renderOne(x, j))}
          </ControlGroup>,
        );
      });
      return items;
      })()}</div>
  );
  // `pages`: the MIDI file and the pad grid have pages of their own (the rail's, the phone's row).
  const renderMappings = (inPanel: boolean, pages = false) => (
    <MappingsDrawer
      play={play}
      mode={compact || inPanel ? 'tab' : 'drawer'}
      grid={inPanel}
      pages={pages}
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
      onRecord={update}
      audioNodes={audioNodes}
      nullLayers={nullLayers}
      layerRefs={layerRefs}
      addControlButton={addControlButtonEl}
    />
  );
  const exposeControl = (control: PlayControl) => update(p => (p.controls.some(c => c.target === control.target) ? p : { ...p, controls: [...p.controls, control] }));
  /**
   * One of the rail's pages (railPages.ts), full width in the big panel, or a
   * page of its own on a phone (`touch`). `wide`: room for two columns.
   */
  const renderPage = (page: RailPage, wide: boolean, touch: boolean): ReactNode => {
    switch (page) {
      case 'controls': return (
        <InputsBoard wide={wide} counts={{ controls: play.controls.length, sources: play.mappings.length + (play.sources?.length ?? 0) + (play.pairMappings?.length ?? 0) }}
          controls={<>{controlsHeader}{notesCard}<div style={{ padding: '0 16px', flexShrink: 0 }}><MapModeBar /></div>{renderControls(true)}</>}
          sources={renderMappings(true, true)} />
      );
      case 'layers': return layersOk
        ? <LayersPanel play={play} touch={touch} split={wide} big extras={false} exposedTargets={new Set(play.controls.map(c => c.target))} onChange={update} onExpose={exposeControl} />
        : <LockedLayers play={play} />;
      case 'signals': return layersOk ? <RulesPage play={play} onChange={update} wide={wide} /> : <LockedLayers play={play} />;
      case 'background': return <BackgroundPage play={play} onChange={update} locked={!backgroundsOk} />;
      case 'finish-picture':
      case 'finish-sound': return finishOk ? <FinishPanel play={play} onChange={update} touch={touch} wide={wide} only={page === 'finish-sound' ? 'sound' : 'picture'} /> : <LockedFinish play={play} />;
      case 'engine-performance': return <AudioEnginePanel play={play} onChange={update} touch={touch} wide={wide} />;
      case 'midi-file': return (
        <CardPage title="MIDI file" intro="A MIDI file plays into the setup as if from a controller: its notes and CCs drive mappings, triggers and racks, in time with the picture.">
          <MidiFileSlot />
        </CardPage>
      );
      case 'pad-grid': return (
        <CardPage title="Pad grid" intro="A grid of pads from a controller (a Launchpad, an MPC), read as sources: each pad’s press, pressure or toggle can drive a control.">
          <ProLock feature="play.sources" style={{ display: 'block', width: '100%' }}><PadGridCard /></ProLock>
        </CardPage>
      );
    }
  };
  // The big panel's section, rendered into the split view's panel (PlaySplitArea.tsx).
  const bigPanel = big && splitHost ? createPortal(
    <div data-big-page={bigPage ?? undefined} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {bigPage ? renderPage(bigPage, splitWide, false) : <>
      {big === 'controls' && <>{controlsHeader}{renderControls(true)}</>}
      {big === 'layers' && (layersOk
        ? <LayersPanel play={play} touch={false} split={splitWide} big exposedTargets={new Set(play.controls.map(c => c.target))} onChange={update} onExpose={control => update(p => (p.controls.some(c => c.target === control.target) ? p : { ...p, controls: [...p.controls, control] }))} />
        : <LockedLayers play={play} />)}
      {big === 'finish' && (finishOk ? <FinishPanel play={play} onChange={update} touch={false} wide={splitWide} /> : <LockedFinish play={play} />)}
      {big === 'engine' && <AudioEnginePanel play={play} onChange={update} touch={false} wide={splitWide} />}
      {big === 'mappings' && renderMappings(true)}
      </>}
    </div>,
    splitHost,
  ) : null;

  // The sidebar hidden beside the big panel: only the panel's section and what floats (dialogs, menus) stay.
  if (sidebarGone) {
    return (
      <div ref={rootRef} style={{ position: 'absolute', inset: 0 }}>
        {bigPanel}
        <DetailWindow play={play} onChange={update} renderSource={id => <DetailSource id={id} play={play} update={update} audioNodes={audioNodes} nullLayers={nullLayers} layerRefs={layerRefs} />} />
        {embedOpen && <EmbedDialog onClose={() => setEmbedOpen(false)} />}
        <AudioReadersHost compact={compact} />
        <LayerContextMenu play={play} onChange={update} />
      </div>
    );
  }

  return (
    <div ref={rootRef} style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: tk.bg.subtle, color: tk.text.primary, font: `12.5px ${fontFamily.ui}` }}>
      {/* Sections. Desktop keeps Mappings as a drawer underneath; phones pick sections from the row along the bottom (PlayRailBar). */}
      {!compact && <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px 2px', background: tk.bg.panel }}>
        <div style={{ flex: 1, minWidth: 0 }}>
        <Segmented
          fill
          ariaLabel="Play section"
          value={sideView.tab}
          onChange={setTab}
          options={[
            ...(compact || sideView.tabs.includes('controls') ? [{ value: 'controls' as const, label: `Controls${play.controls.length ? ` · ${play.controls.length}` : ''}` }] : []),
            ...(compact || sideView.tabs.includes('layers') ? [{ value: 'layers' as const, label: `Layers${play.layers.length ? ` · ${play.layers.length}` : ''}${layersOk ? '' : ' · Pro'}` }] : []),
            ...(compact || sideView.tabs.includes('finish') ? [{ value: 'finish' as const, label: `Finish${play.finish?.effects.length ? ` · ${play.finish.effects.length}` : ''}${finishOk ? '' : ' · Pro'}`, title: 'Grade, lens, film and time effects over the whole picture, and effects on the sound' }] : []),
            ...(compact || sideView.tabs.includes('engine') ? [{ value: 'engine' as const, label: `Engine${play.audioEngine?.racks.length ? ` · ${play.audioEngine.racks.length}` : ''}${engineOk ? '' : ' · Pro'}`, title: 'The Audio engine: racks of synths (Audio Units on a Mac, or the sample player) and effects, played from MIDI and the keyboard' }] : []),
            ...(compact ? [{ value: 'mappings' as const, label: `Mappings${play.mappings.length + (play.pairMappings?.length ?? 0) ? ` · ${play.mappings.length + (play.pairMappings?.length ?? 0)}` : ''}` }] : []),
          ]}
        />
        </div>
        <Segmented size="sm" ariaLabel="Panel width" value={panel} onChange={v => setPanel(v as PanelSize)} options={[{ value: 's', label: 'S', title: 'Narrow panel' }, { value: 'm', label: 'M', title: 'Medium panel' }, { value: 'l', label: 'L', title: 'Wide panel' }]} />
      </div>}
      {/* Phones: a page of its own, picked from the bottom row's sheet. */}
      {phoneOwn && <div data-phone-page={phonePage} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>{renderPage(phonePage!, false, true)}</div>}
      {!compact && notesCard}
      {shown === 'layers' && !layersOk && <LockedLayers play={play} />}
      {shown === 'layers' && layersOk && (
        <LayersPanel
          top={compact ? notesCard : undefined}
          play={play}
          touch={compact}
          extras={!compact}
          exposedTargets={new Set(play.controls.map(c => c.target))}
          onChange={update}
          onExpose={control => update(p => (p.controls.some(c => c.target === control.target) ? p : { ...p, controls: [...p.controls, control] }))}
        />
      )}
      {shown === 'engine' && <AudioEnginePanel play={play} onChange={update} touch={compact} />}
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
      {shown === 'controls' && <div style={{ padding: '0 12px', flexShrink: 0 }}><MapModeBar /></div>}
      {shown === 'controls' && renderControls(false)}

      {(compact ? tab === 'mappings' && !phoneOwn : sideView.drawer) && renderMappings(false, compact)}
      {compact && <PlayRailBar />}
      {bigPanel}
      <DetailWindow play={play} onChange={update} renderSource={id => <DetailSource id={id} play={play} update={update} audioNodes={audioNodes} nullLayers={nullLayers} layerRefs={layerRefs} />} />
      {embedOpen && <EmbedDialog onClose={() => setEmbedOpen(false)} />}
      <AudioReadersHost compact={compact} />
      <LayerContextMenu play={play} onChange={update} />
    </div>
  );
}

const DRAWER_HEIGHT_KEY = 'shader-studio:play:drawerHeight';
/** Pages that aren't a whole sidebar section: a phone shows them in place of its tab's section. */
const OWN_PAGES: ReadonlySet<RailPage> = new Set<RailPage>(['signals', 'background', 'midi-file', 'pad-grid']);
/** The split view's big panel lays cards out in as many columns as fit. */
const PANEL_GRID: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(300px, 100%), 1fr))', columnGap: 10, alignItems: 'start' };
const PANEL_GRID_WIDE: React.CSSProperties = { ...PANEL_GRID, gridTemplateColumns: 'repeat(auto-fill, minmax(min(380px, 100%), 1fr))' };

// ── A control group ──────────────────────────────────────────────────────────

/** Controls under one heading (PlayControl.group), folded per group on this device; spans the split view's grid. */
function ControlGroup({ name, count, grid, children }: { name: string; count: number; grid: boolean; children: ReactNode }) {
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
  return !!play.padGrid || play.mappings.some(m => m.source.kind === 'midi' || m.source.kind === 'pad' || (m.source.kind === 'trigger' && m.source.trigger.on === 'note'))
    || (play.actions ?? []).some(a => a.trigger.on === 'note')
    || !!play.audioEngine?.racks.some(r => r.midi !== 'off');
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

function AddControlButton({ candidates, layers, finish, sound, layerById, taken, onAdd, onAddFinish, onAddSound, onAddAction, onAddNull, compact = false }: {
  /** Phones: the button is an icon, so the header's row of tools fits. */
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
  // The target picked (search parameters first); its own popover then picks the source (miniMapper.ts).
  const [pending, setPending] = useState<{ target: MiniMapperTarget; label: string } | null>(null);
  const pickGraph = (c: PlayCandidate) => {
    if (withNull && c.kind === 'float') { const { drives, label } = graphNullDrives(candidates, c); onAddNull(drives, label); return; }
    if (withNull) { onAdd(c); return; }
    setPending({ target: { candidate: c }, label: candidateLabel(c) });
  };
  const pickLayer = (l: LayerCandidates, key: string) => {
    if (withNull) {
      const layer = layerById(l.id);
      const r = layer && layerNullDrives(layer, key);
      if (r) onAddNull(r.drives, r.label);
      return;
    }
    setPending({ target: { layerId: l.id, key }, label: `${l.label} · ${l.props.find(p => p.key === key)?.label ?? key}` });
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
                  <button key={pr.key} type="button" title={pr.hint} onClick={() => { if (withNull) { onAddFinish(f.id, pr.key, withNull); close(); } else { setPending({ target: { effectId: f.id, key: pr.key }, label: `${f.label} · ${pr.label}` }); close(); } }} {...hover} style={{ ...itemStyle, paddingLeft: 40 }}>
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
                  <button key={pr.key} type="button" title={pr.hint} onClick={() => { if (withNull) { onAddSound(f.id, pr.key, withNull); close(); } else { setPending({ target: { audioFx: `${f.id}::${pr.key}` }, label: `${f.label} · ${pr.label}` }); close(); } }} {...hover} style={{ ...itemStyle, paddingLeft: 40 }}>
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
interface ControlSource { kind: 'layer' | 'node' | 'reader'; title: string; param: string; within?: string; missing: boolean; go: () => void }

/** A pair's card with its two live values, read here so only this card renders when they move. */
function LivePairCard({ liveOn, ...props }: Omit<ComponentProps<typeof PairCard>, 'live'> & { liveOn: boolean }) {
  const la = useLiveValue(props.a.id, liveOn), lb = useLiveValue(props.b.id, liveOn);
  return <PairCard {...props} live={[la, lb]} />;
}

function ControlRow({ control, index, count, exists, fate, onRelink, help, source, value, liveOn, drivenBy, touch, onChange, onRename, onRange, onMove, onRemove, removeLabel = 'Remove from panel', onMap, onNull, onAmount, trace, onName, isolated = false, swing }: {
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
  touch: boolean;
  onChange: (v: number | number[]) => void;
  onRename: (label: string) => void;
  onRange: (min: number, max: number) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  /** What the trash does (a reader's control goes with its reader). */
  removeLabel?: string;
  /** Add a mapping onto this control. */
  onMap: () => void;
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
}) {
  const tk = useTokens();
  const [hover, setHover] = useState(false);
  // A narrow card folds the hover tools into ⋯.
  const headRef = useRef<HTMLDivElement>(null);
  const tight = useNarrow(headRef, 260);
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
          style={{ display: 'inline-flex', color: tk.text.faint, cursor: 'grab', marginLeft: -4, visibility: hover || touch ? 'visible' : 'hidden' }}
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
            style={{ flex: 1, minWidth: 0, textAlign: 'left', border: 0, background: 'none', padding: 0, cursor: onName ? 'pointer' : 'text', color: isolated ? tk.accent.text : tk.text.primary, font: `600 12.5px ${fontFamily.ui}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
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
          <button type="button" data-driven-chip="" title={`${drivenBy.join(', ')}: open its details`} onClick={() => openDetail('control', control.id)} style={{ height: 20, padding: '0 7px', border: 0, borderRadius: 6, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, background: alpha(tk.accent.base, 0.12), color: tk.accent.text, font: `600 10.5px ${fontFamily.ui}`, whiteSpace: 'nowrap', minWidth: 0, flexShrink: 1, maxWidth: '50%' }}>
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
      {trace}
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

function MappingsDrawer({ play, mode, grid = false, pages = false, height, onResizeStart, open, onToggle, onAdd, onUpdate, onRemove, onAddPair, onUpdatePair, onRemovePair, onRecord, audioNodes, nullLayers, layerRefs, addControlButton }: {
  play: PlayRecord;
  /** Edits to the record's own sources (their cards, Learn, + Source). */
  onRecord: (fn: (p: PlayRecord) => PlayRecord) => void;
  /**
   * `drawer`: folds under the controls with a draggable top edge. `tab`: fills the page (phones, the split view's panel).
   */
  mode: 'drawer' | 'tab';
  /** The rows as cards in columns (the split view's panel). */
  grid?: boolean;
  /** The MIDI file and the pad grid have pages of their own: leave them out. */
  pages?: boolean;
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
  /** The Controls page's "Add control" button (its target picker, then the mini mapper for a source):
   * offered in the empty state when there's no control yet to map onto. */
  addControlButton: ReactNode;
}) {
  const tk = useTokens();
  const ownSources = play.sources ?? NO_SOURCES;
  // Learn: the next knob, key or MIDI note becomes a source. `learnFor` is a
  // mapping id (replace its source) or 'new' (add a mapping).
  const [learnFor, setLearnFor] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [addMenu, setAddMenu] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!learnFor) return;
    void midiEngine.connectWebMidi({ retry: true });
    // A trigger row's Learn picks what fires it (key, note, click, OSC); every other Learn picks a source.
    const row = learnFor === 'new' ? undefined : play.mappings.find(m => m.id === learnFor);
    // A source of the record: Learn replaces what it reads (a trigger source, what fires it).
    const own = play.sources?.find(x => x.id === learnFor);
    if (own) {
      const src = own.source;
      const done = (source: PlaySource) => {
        if (sourceNeedsPro(source) && !can('play.sources')) { setLearnFor(null); openProSheet('play.sources'); return; }
        onRecord(p => patchSource(p, own.id, { source }));
        setLearnFor(null);
      };
      return src.kind === 'trigger'
        ? playEngine.startLearnTrigger(trigger => done({ ...src, trigger: withFire(trigger, src.trigger.fire) }))
        : playEngine.startLearn(done);
    }
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
  // While a Learn runs, an unassigned CC row doesn't take the knob (lib/midiAutoLearn.ts).
  useEffect(() => (learnFor ? claimMidiListen() : undefined), [learnFor]);
  // A CC row without a knob takes the first CC that moves; the row flashes to say so.
  const [assigned, setAssigned] = useState<{ id: string; at: number } | null>(null);
  const mappingsRef = useRef(play.mappings);
  mappingsRef.current = play.mappings;
  useEffect(() => {
    if (!play.mappings.some(m => isUnassignedCc(m.source))) return;
    void midiEngine.connectWebMidi();
    return startMidiAutoLearn({
      mappings: () => mappingsRef.current,
      assign: (id, source) => { onUpdate(id, { source }); setAssigned({ id, at: Date.now() }); },
    });
  }, [play.mappings, onUpdate]);
  useEffect(() => {
    if (!assigned) return;
    const t = window.setTimeout(() => setAssigned(null), ASSIGN_FLASH_MS);
    return () => window.clearTimeout(t);
  }, [assigned]);
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
  const rowFor = (m: PlayMapping, opts: { collapsed: boolean; fixed?: boolean }) => (
    <MappingRow
      key={m.id}
      mapping={m}
      control={play.controls.find(c => c.id === m.controlId)}
      controls={play.controls}
      audioNodes={audioNodes}
      nullLayers={nullLayers}
      layerRefs={layerRefs}
      liveMeter={open}
      learning={learnFor === m.id}
      assigned={assigned?.id === m.id}
      collapsed={opts.collapsed}
      fixed={opts.fixed}
      onToggle={() => toggleRow(m.id)}
      onLearn={() => setLearnFor(l => (l === m.id ? null : m.id))}
      onUpdate={patch => onUpdate(m.id, patch)}
      onRemove={() => onRemove(m.id)}
      onMap={() => useMapMode.getState().start(m.id, sourceLabel(m.source, play.controls, layerRefs))}
    />
  );
  // The header's count: the drawer lists mappings; the sources column, its own sources too.
  const headCount = play.mappings.length + (mode === 'drawer' ? 0 : ownSources.length);
  const sourceCard = (d: PlaySourceDef) => (
    <SourceCard key={d.id} def={d} play={play} liveMeter={open} audioNodes={audioNodes} nullLayers={nullLayers} layerRefs={layerRefs}
      learning={learnFor === d.id} onLearn={() => setLearnFor(l => (l === d.id ? null : d.id))} onChange={onRecord} />
  );
  // What the sources column's search looks in: the card's name, what it reads, the controls it drives.
  const controlLabel = (id: string) => play.controls.find(c => c.id === id)?.label;
  const sourceWords = (x: SourceItem) => (x.kind === 'source'
    ? [x.def.label, sourceLabel(x.def.source, play.controls, layerRefs), ...x.def.outputs.flatMap(o => o.routes.map(r => controlLabel(r.to)))]
    : [sourceLabel(x.mapping.source, play.controls, layerRefs), controlLabel(x.mapping.controlId)]);
  const status = (
    <>
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
    </>
  );
  const emptyBody = noControls
    ? 'Add a control first, then map an input onto it.'
    : `Press Learn and move a knob or a key, or add a row by hand. ${midiEngine.blockReason() ?? (midi.status === 'ready' && midi.inputs.length ? `Listening to ${midi.inputs.join(', ')}.` : '')} Connecting Ableton, a controller, OSC or live audio for the first time? The ⓘ button above walks you through it.`;
  // Header's "+ Add": a mapping onto the default source (Learn instead picks it from the next input).
  const addDefaultMapping = () => onAdd(allSources ? { kind: 'midi', signal: 'cc', channel: 0 } : { kind: 'mouse', axis: 'x' });
  const emptyState = (
    <div style={{ margin: '18px 4px', padding: '16px 14px', borderRadius: radius.lg, border: `1px dashed ${tk.border.strong}`, color: tk.text.muted, lineHeight: 1.5 }}>
      <div style={{ font: `600 12.5px ${fontFamily.ui}`, color: tk.text.secondary, marginBottom: 4 }}>Nothing mapped</div>
      {emptyBody}
      <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
        {noControls ? addControlButton : <Button size="sm" icon="plus" onClick={addDefaultMapping}>Add mapping</Button>}
      </div>
    </div>
  );

  return (
    <div data-mappings={mode} style={mode !== 'drawer'
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
        title={mode === 'drawer' ? 'Mappings' : 'Sources'}
        hint={headCount ? `${headCount}` : undefined}
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
            <Button size="sm" icon="plus" disabled={noControls} onClick={addDefaultMapping}>Add</Button>
            {mode !== 'drawer' && <Button size="sm" icon="plus" variant="ghost" title="A source that drives nothing yet: random, or pick what it reads; then Map it onto controls" onClick={e => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setAddMenu({ x: r.left, y: r.bottom + 4 }); }}>Source</Button>}
            {addMenu && <Menu x={addMenu.x} y={addMenu.y} onClose={() => setAddMenu(null)} title="Add a source" items={[
              { heading: 'Random' },
              ...RANDOM_SOURCES.map(r => ({ label: r.label, hint: r.hint, icon: 'dice' as const, onSelect: () => {
                let id = '';
                onRecord(p => { const x = addFreeSource(p, { ...r.source, seed: r.source.kind === 'noise' ? Math.floor(Math.random() * 100000) : 0 } as PlaySource); id = x.id; return x.play; });
                if (id) useMapMode.getState().start(id, r.label);
              } })),
              'separator',
              { label: 'Another input…', hint: 'A knob, a key, the mouse: pick it on the card, or press Learn', icon: 'plus' as const, onSelect: () => onRecord(p => addFreeSource(p, allSources ? { kind: 'midi', signal: 'cc', channel: 0 } : { kind: 'mouse', axis: 'x' }).play) },
            ]} />}
          </>
        )}
      />
      {open && (
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: grid ? '8px 16px 16px' : '6px 12px 12px' }}>
          {status}
          <SoloStrip kind="mapping" total={play.mappings.length} />
          {play.midiFile && !pages && <MidiFileSlot />}
          {!ownSources.length && !play.mappings.length ? emptyState : mode === 'drawer' ? <>
            {ownSources.length > 0 && <div style={grid ? PANEL_GRID_WIDE : undefined}>{ownSources.map(sourceCard)}</div>}
            {play.mappings.length > 0 && <div style={grid ? PANEL_GRID_WIDE : undefined}>{play.mappings.map(m => rowFor(m, { collapsed: collapsed.has(m.id) }))}</div>}
          </> : (
            // The sources column: own sources and old mappings together, by kind, with a search.
            <SourceGroups sources={ownSources} mappings={play.mappings} words={sourceWords} gridStyle={grid ? PANEL_GRID_WIDE : undefined}
              renderItem={x => (x.kind === 'source' ? sourceCard(x.def) : rowFor(x.mapping, { collapsed: collapsed.has(x.mapping.id) }))} />
          )}
          {!!play.pairs?.length && (
            <PairMappingsSection play={play} grid={grid} audioNodes={audioNodes} layerRefs={layerRefs} onAdd={onAddPair} onUpdate={onUpdatePair} onRemove={onRemovePair} />
          )}
          {!play.midiFile && !pages && <MidiFileSlot />}
          {!pages && <ProLock feature="play.sources" style={{ display: 'block', width: '100%' }}><PadGridCard /></ProLock>}
        </div>
      )}
      {guideOpen && <ConnectGuide onClose={() => setGuideOpen(false)} />}
    </div>
  );
}

const NO_SOURCES: PlaySourceDef[] = [];
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

function MappingRow({ mapping: m, control, controls, audioNodes, nullLayers, layerRefs, meter: meterGiven = 0, liveMeter = false, learning, assigned = false, collapsed, fixed = false, onToggle, onLearn, onUpdate, onRemove, onMap }: {
  mapping: PlayMapping;
  /** Map: drive more controls from this source (it becomes a source of the record on the first pick). */
  onMap?: () => void;
  control: PlayControl | undefined;
  controls: PlayControl[];
  audioNodes: AudioNodeOption[];
  nullLayers: { id: string; label: string }[];
  layerRefs: LayerRef[];
  /** A fixed reading (0 for a mapping being made); `liveMeter` reads the source itself instead. */
  meter?: number;
  /** Read the source here, for the meter (the drawer is open): only this row renders as it moves. */
  liveMeter?: boolean;
  learning: boolean;
  /** The row was just given its knob (lib/midiAutoLearn.ts): a brief highlight. */
  assigned?: boolean;
  collapsed: boolean;
  /** Always open, with no fold chevron (the workspace's editor). */
  fixed?: boolean;
  onToggle: () => void;
  onLearn: () => void;
  onUpdate: (patch: Partial<PlayMapping>) => void;
  onRemove: () => void;
}) {
  const tk = useTokens();
  // The meters read the source themselves (FedMeter): the row doesn't render as it moves.
  const feed: MeterFeed = { read: () => Math.round((playEngine.readMapping(m) ?? 0) * 100) / 100, live: liveMeter, given: meterGiven };
  // Free maps from the mouse, keys and audio (play/planGates.ts). A Pro source made on Pro stays as it is, marked, and doesn't run.
  const allSources = useCan('play.sources');
  const locked = !allSources && sourceNeedsPro(m.source);
  const signals = useNodeGraphStore(s => s.play.signals);

  const numStyle = { width: 58, height: 26, borderRadius: 6, border: 0, background: tk.bg.field, color: tk.text.primary, font: `500 11.5px ${fontFamily.mono}`, textAlign: 'center' as const };
  const labelStyle = { color: tk.text.faint, font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.04em', textTransform: 'uppercase' as const, width: 54, flexShrink: 0 };
  const retarget = (id: string) => {
    const c = controls.find(x => x.id === id);
    // A control can't drive itself: drop a control source that now points at the target.
    const source = m.source.kind === 'control' && m.source.controlId === id ? { kind: 'control' as const, controlId: controls.find(x => x.id !== id)?.id ?? '' } : m.source;
    onUpdate(c ? { controlId: id, outMin: c.min, outMax: c.max, channel: undefined, source } : { controlId: id, source });
  };

  // Where the source lands after the curve (0..1 of the range): what the control actually gets.
  const waiting = isUnassignedCc(m.source);
  const frame = {
    marginTop: 6, borderRadius: radius.card, background: assigned ? alpha(tk.accent.base, 0.12) : tk.bg.panel,
    boxShadow: `inset 0 0 0 1px ${learning || assigned ? tk.accent.base : tk.border.default}`, opacity: m.enabled ? 1 : 0.55,
    transition: assigned ? 'none' : 'background 0.9s ease-out, box-shadow 0.9s ease-out',
  };
  // The fold chevron (not in the detail window's editor), and the grip that drags the source onto a control.
  const chevron = <>
    {!fixed && <IconButton icon={collapsed ? 'chevR' : 'chevD'} label={collapsed ? 'Expand mapping' : 'Collapse mapping'} size="sm" tooltip={false} onClick={onToggle} style={{ marginLeft: -6 }} />}
    {onMap && <SourceDragHandle id={m.id} label={sourceLabel(m.source, controls, layerRefs)} />}
  </>;
  // Follow (the control moves with the source) or Increment (it moves in steps: docs/increment-mapping.md).
  const setKind = (k: 'follow' | 'increment') => {
    if (k === 'follow') { onUpdate({ increment: undefined }); return; }
    if (!allSources) { openProSheet('play.sources'); return; }
    const span = Math.abs(m.outMax - m.outMin);
    const step = span > 0 ? Math.round((span / 8) * 1000) / 1000 : 0.1;
    onUpdate({ increment: defaultIncrement(step, recordBpm(useNodeGraphStore.getState().play.mappings)) });
  };
  const kindPicker = (
    <Segmented size="sm" ariaLabel="Kind" value={m.increment ? 'increment' : 'follow'} onChange={setKind} options={[
      { value: 'follow', label: 'Follow', title: 'The control follows the source smoothly' },
      { value: 'increment', label: 'Increment', title: 'The control moves in steps: on a trigger, a threshold or a repeat' },
    ]} />
  );
  const summary = m.increment ? incrementSummary(m.increment, signals, layerRefs) : '';

  if (collapsed) {
    return (
      <div style={{ ...frame, padding: '4px 10px 6px 8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 26 }}>
          {chevron}
          <button type="button" onClick={onToggle} title="Expand" style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6, border: 0, background: 'none', padding: 0, cursor: 'pointer', color: tk.text.primary, font: `500 12px ${fontFamily.ui}`, textAlign: 'left' }}>
            {waiting
              ? <MidiWaitChip title="This row has no knob yet: the first CC that moves on any device becomes its CC" />
              : <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 600 }} title={m.increment ? 'Increment' : undefined}>{m.increment ? summary : sourceLabel(m.source, controls, layerRefs)}</span>}
            <Icon name="chevR" size={12} style={{ color: tk.text.faint, flexShrink: 0 }} />
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: tk.text.secondary }}>{control?.label ?? 'missing control'}</span>
          </button>
          {locked && <ProBadge title="This source needs Pro: kept, but it doesn't run on Free" />}
          <SoloButton kind="mapping" id={m.id} />
          <Toggle checked={m.enabled} onChange={enabled => onUpdate({ enabled })} />
        </div>
        <FedMeter feed={feed} curved curve={m.curve} curveY={m.curveY} on={m.enabled} margin="2px 0 0 22px" />
      </div>
    );
  }

  if (m.increment) {
    const inc = m.increment as PlayIncrement;
    return (
      <div style={{ ...frame, padding: '8px 10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {chevron}
          <span style={{ ...labelStyle, width: 40 }}>Kind</span>
          {kindPicker}
          <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: tk.text.muted, font: `500 11.5px ${fontFamily.ui}` }} title={summary}>{summary}</span>
          <SoloButton kind="mapping" id={m.id} />
          <IconButton icon="trash" label="Remove mapping" size="sm" tone="danger" onClick={onRemove} />
        </div>
        {!allSources && (
          <button type="button" onClick={() => openProSheet('play.sources')} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', margin: '6px 0 0', padding: '6px 8px', border: 0, borderRadius: radius.md, cursor: 'pointer', background: alpha(tk.accent.base, 0.08), color: tk.text.secondary, font: `11.5px/1.4 ${fontFamily.ui}`, textAlign: 'left' }}>
            <ProBadge />
            <span style={{ flex: 1, minWidth: 0 }}>Increments need Pro. It’s kept as it is but doesn’t run on Free.</span>
          </button>
        )}
        <FedMeter feed={feed} on={m.enabled} margin="6px 0 2px 60px" />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
          <span style={labelStyle}>Control</span>
          <Select ariaLabel="Control" value={m.controlId} options={controls.map(c => ({ value: c.id, label: c.label }))} onChange={retarget} height={26} style={{ flex: 1, minWidth: 0 }} />
          {control?.kind === 'color' && (
            <Select ariaLabel="Colour channel" value={m.channel === undefined ? 'all' : `${m.channel}`} options={COLOUR_CHANNELS} onChange={v => onUpdate({ channel: v === 'all' ? undefined : (parseInt(v, 10) as 0 | 1 | 2) })} height={26} />
          )}
          <Toggle checked={m.enabled} onChange={enabled => onUpdate({ enabled })} label={m.enabled ? 'On' : 'Off'} />
        </div>
        <IncrementEditor
          mapping={{ ...m, increment: inc }}
          control={control}
          layers={layerRefs}
          numStyle={numStyle}
          labelStyle={labelStyle}
          onUpdate={onUpdate}
          sourceEditor={<>
            <SourceFields source={m.source} controls={controls} excludeControlId={m.controlId} nullLayers={nullLayers} layerRefs={layerRefs} numStyle={numStyle} onChange={source => onUpdate({ source })} onCaptured={source => onUpdate({ source, smoothMs: 0 })} mappingId={m.id} pickerOnly
              style={{ marginBottom: 6 }}
              lead={<span style={labelStyle}>Source</span>}
              actions={<IconButton icon="spark" label={learning ? 'Listening… (Esc to cancel)' : 'Learn: replace this source with the next input'} size="sm" active={learning} onClick={onLearn} />} />
            <SourceOptions source={m.source} audioNodes={audioNodes} layerRefs={layerRefs} numStyle={numStyle} labelStyle={labelStyle} onChange={source => onUpdate({ source })} />
          </>}
        />
      </div>
    );
  }

  return (
    <div style={{ ...frame, padding: '8px 10px' }}>
      {/* Source row: Solo and Learn stay; Map, details and Remove fold into ⋯ when the card is narrow */}
      <SourceFields source={m.source} controls={controls} excludeControlId={m.controlId} nullLayers={nullLayers} layerRefs={layerRefs} numStyle={numStyle} onChange={source => onUpdate({ source })} onCaptured={source => onUpdate({ source, smoothMs: 0 })} mappingId={m.id}
        lead={narrow => <>{chevron}{!narrow && <span style={{ ...labelStyle, width: 40 }}>Source</span>}</>}
        actions={<>
          <SoloButton kind="mapping" id={m.id} />
          <IconButton icon="spark" label={learning ? 'Listening… (Esc to cancel)' : 'Learn: replace this source with the next input'} size="sm" active={learning} onClick={onLearn} />
        </>}
        secondary={[
          ...(onMap ? [{ icon: 'plus' as const, label: 'Map: drive more controls from this source', onSelect: onMap }] : []),
          ...(!fixed ? [{ icon: 'popout' as const, label: 'Open its details', onSelect: () => openDetail('source', m.id) }] : []),
          { icon: 'trash', label: 'Remove mapping', danger: true, onSelect: onRemove },
        ]} />
      {locked && (
        <button type="button" onClick={() => openProSheet('play.sources')} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', margin: '6px 0 0', padding: '6px 8px', border: 0, borderRadius: radius.md, cursor: 'pointer', background: alpha(tk.accent.base, 0.08), color: tk.text.secondary, font: `11.5px/1.4 ${fontFamily.ui}`, textAlign: 'left' }}>
          <ProBadge />
          <span style={{ flex: 1, minWidth: 0 }}>This source needs Pro. It’s kept as it is but doesn’t run on Free.</span>
        </button>
      )}
      {/* Meter */}
      <FedMeter feed={feed} curved curve={m.curve} curveY={m.curveY} on={m.enabled} margin="6px 0 8px 60px" />
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
        <FedCurvePad feed={feed} value={m.curveY ?? sampleCurve('linear')} range={[m.outMin, m.outMax]} onChange={curveY => onUpdate({ curveY })} onReset={() => onUpdate({ curveY: sampleCurve('linear') })} />
      )}
      {/* Smooth, Delay, then Follow/Increment and On: each group wraps onto its own line when narrow */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 6 }}>
        <span style={labelStyle}>Smooth</span>
        <div style={{ ...rowField, rowGap: 6 }}>
          <span style={rowGroup}>
            <NumberInput value={m.smoothMs} min={0} max={5000} step={10} title="Smoothing time in milliseconds" onCommit={n => onUpdate({ smoothMs: Math.max(0, n) })} style={numStyle} />
            <span style={{ color: tk.text.faint, font: `500 11px ${fontFamily.ui}` }}>ms</span>
          </span>
          {!m.increment && <span style={rowGroup}>
            <span style={{ ...labelStyle, width: 'auto', marginLeft: 6 }} title="The value arrives this much later (before the smoothing): several mappings from one source with growing delays follow one another">Delay</span>
            <NumberInput value={m.delayMs ?? 0} min={0} max={10000} step={10} title="Delay in milliseconds (0 = none, at most 10 s)" onCommit={n => onUpdate({ delayMs: n > 0 ? Math.min(10000, n) : undefined })} style={numStyle} />
            <span style={{ color: tk.text.faint, font: `500 11px ${fontFamily.ui}` }}>ms</span>
          </span>}
          <span style={{ display: 'inline-flex', minWidth: 0, maxWidth: '100%', marginLeft: 'auto' }}>{kindPicker}</span>
          <Toggle checked={m.enabled} onChange={enabled => onUpdate({ enabled })} label={m.enabled ? 'On' : 'Off'} />
        </div>
      </div>
      {m.source.kind === 'midi' && m.source.signal === 'note' && !m.source.range && (
        <div style={{ marginTop: 6, color: tk.text.faint, font: `11px ${fontFamily.ui}` }}>Note number scaled 0–1 (last note: {midiNoteName(midiEngine.channelState(m.source.channel).lastNote)}).</div>
      )}
    </div>
  );
}

/** A source in the detail window: a mapping's row, or a record source's card, with its own Learn. */
function DetailSource({ id, play, update, audioNodes, nullLayers, layerRefs }: {
  id: string;
  play: PlayRecord;
  update: (fn: (p: PlayRecord) => PlayRecord) => void;
  audioNodes: AudioNodeOption[];
  nullLayers: { id: string; label: string }[];
  layerRefs: LayerRef[];
}) {
  const [learning, setLearning] = useState(false);
  useEffect(() => {
    if (!learning) return;
    void midiEngine.connectWebMidi({ retry: true });
    const set = (source: PlaySource) => {
      update(p => (p.mappings.some(m => m.id === id) ? { ...p, mappings: p.mappings.map(m => (m.id === id ? { ...m, source } : m)) } : patchSource(p, id, { source })));
      setLearning(false);
    };
    return playEngine.startLearn(set);
  }, [learning, id, update]);
  const m = play.mappings.find(x => x.id === id);
  if (m) {
    return <MappingRow mapping={m} control={play.controls.find(c => c.id === m.controlId)} controls={play.controls} audioNodes={audioNodes} nullLayers={nullLayers} layerRefs={layerRefs}
      meter={0} learning={learning} collapsed={false} fixed onToggle={() => {}} onLearn={() => setLearning(l => !l)}
      onUpdate={patch => update(p => ({ ...p, mappings: p.mappings.map(x => (x.id === id ? { ...x, ...patch } : x)) }))}
      onRemove={() => update(p => ({ ...p, mappings: p.mappings.filter(x => x.id !== id) }))}
      onMap={() => useMapMode.getState().start(id, sourceLabel(m.source, play.controls, layerRefs))} />;
  }
  const d = play.sources?.find(x => x.id === id);
  if (!d) return null;
  return <SourceCard def={d} play={play} meter={0} audioNodes={audioNodes} nullLayers={nullLayers} layerRefs={layerRefs} learning={learning} onLearn={() => setLearning(l => !l)} onChange={update} />;
}

/**
 * A source of the record on the Inputs board (implementation guide 7.1): its
 * source and settings, read once, then each route onto a control (Replace
 * sets it, Add moves it from its slider, with range, curve, smoothing and
 * delay), or a Step output counting through its own range. Map adds a route:
 * pick it, then click a control.
 */
function SourceCard({ def: s, play, meter: meterGiven = 0, liveMeter = false, audioNodes, nullLayers, layerRefs, learning, onLearn, onChange }: {
  def: PlaySourceDef;
  play: PlayRecord;
  meter?: number;
  /** Read the source here, for its meter: only this card renders as it moves. */
  liveMeter?: boolean;
  audioNodes: AudioNodeOption[];
  nullLayers: { id: string; label: string }[];
  layerRefs: LayerRef[];
  learning: boolean;
  onLearn: () => void;
  onChange: (fn: (p: PlayRecord) => PlayRecord) => void;
}) {
  const tk = useTokens();
  const feed: MeterFeed = { read: () => Math.round((playEngine.sourceValue(s.id) ?? 0) * 100) / 100, live: liveMeter, given: meterGiven };
  const mapping = useMapMode(m => m.sourceId === s.id);
  const numStyle = { width: 58, height: 26, borderRadius: 6, border: 0, background: tk.bg.field, color: tk.text.primary, font: `500 11.5px ${fontFamily.mono}`, textAlign: 'center' as const };
  const labelStyle = { color: tk.text.faint, font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.04em', textTransform: 'uppercase' as const, width: 54, flexShrink: 0 };
  const set = (patch: Partial<PlaySourceDef>) => onChange(p => patchSource(p, s.id, patch));
  const name = s.label || sourceLabel(s.source, play.controls, layerRefs);
  const routes = s.outputs.flatMap(o => o.routes);
  const step = s.outputs.find((o): o is Extract<SourceOutput, { kind: 'step' }> => o.kind === 'step');
  const sourceRow = (
    <SourceFields source={s.source} controls={play.controls} nullLayers={nullLayers} layerRefs={layerRefs} numStyle={numStyle} onChange={source => set({ source })} onCaptured={source => set({ source })}
      lead={<span style={{ ...labelStyle, width: 40 }}>Source</span>}
      actions={<IconButton icon="spark" label={learning ? 'Listening… (Esc to cancel)' : 'Learn: replace this source with the next input'} size="sm" active={learning} onClick={onLearn} />}
      secondary={[{ icon: 'trash', label: 'Remove the source and its routes', danger: true, onSelect: () => onChange(p => removeSource(p, s.id)) }]} />
  );
  return (
    <div data-source-card={s.id} style={{ marginTop: 6, padding: '8px 10px', borderRadius: radius.card, background: tk.bg.panel, boxShadow: `inset 0 0 0 1px ${mapping || learning ? tk.accent.base : tk.border.default}`, opacity: s.enabled ? 1 : 0.55 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <SourceDragHandle id={s.id} label={name} />
        <Field value={s.label ?? ''} placeholder={name} aria-label="Source name" onChange={e => set({ label: e.target.value || undefined })} height={24} style={{ flex: 1, minWidth: 0, font: `600 12px ${fontFamily.ui}` }} />
        <Button size="sm" icon="plus" variant={mapping ? 'primary' : 'secondary'} title="Map: then click each control it should drive" onClick={() => (mapping ? useMapMode.getState().stop() : useMapMode.getState().start(s.id, name))}>{mapping ? 'Done' : 'Map'}</Button>
        <Toggle checked={s.enabled} onChange={enabled => set({ enabled })} />
        <IconButton icon="popout" label="Open its details" size="sm" onClick={() => openDetail('source', s.id)} />
      </div>
      {step ? (
        <IncrementEditor
          mapping={{ id: s.id, controlId: step.routes[0]?.to ?? '', source: s.source, outMin: step.lo, outMax: step.hi, curve: 'linear', smoothMs: 0, enabled: s.enabled, increment: step.step }}
          control={play.controls.find(c => c.id === step.routes[0]?.to)}
          layers={layerRefs}
          numStyle={numStyle}
          labelStyle={labelStyle}
          onUpdate={patch => set({
            ...(patch.source ? { source: patch.source } : {}),
            ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
            outputs: s.outputs.map(o => (o !== step ? o : { ...step, ...(patch.increment ? { step: patch.increment } : {}), ...(patch.outMin !== undefined ? { lo: patch.outMin } : {}), ...(patch.outMax !== undefined ? { hi: patch.outMax } : {}) })),
          })}
          sourceEditor={<>{sourceRow}<SourceOptions source={s.source} audioNodes={audioNodes} layerRefs={layerRefs} numStyle={numStyle} labelStyle={labelStyle} onChange={source => set({ source })} /></>}
        />
      ) : <>
        {sourceRow}
        <FedMeter feed={feed} on={s.enabled} margin="6px 0 8px 60px" />
        <SourceOptions source={s.source} audioNodes={audioNodes} layerRefs={layerRefs} numStyle={numStyle} labelStyle={labelStyle} onChange={source => set({ source })} />
      </>}
      <div style={{ marginTop: 6 }}>
        {routes.map(r => <RouteRow key={r.id} route={r} play={play} feed={feed} numStyle={numStyle} labelStyle={labelStyle}
          onPatch={patch => onChange(p => patchRoute(p, s.id, r.id, patch))} onRemove={() => onChange(p => removeRoute(p, s.id, r.id))} />)}
        {!routes.length && <div style={{ color: tk.text.faint, font: `11.5px ${fontFamily.ui}`, padding: '4px 0' }}>Drives nothing yet: press Map, then click a control. Rules can still watch it.</div>}
      </div>
    </div>
  );
}

/** One route of a source: the control, Replace or Add, range, curve, smoothing and delay, on or off. */
function RouteRow({ route: r, play, feed, numStyle, labelStyle, onPatch, onRemove }: {
  route: PlayRoute;
  play: PlayRecord;
  feed: MeterFeed;
  numStyle: React.CSSProperties;
  labelStyle: React.CSSProperties;
  onPatch: (patch: Partial<PlayRoute>) => void;
  onRemove: () => void;
}) {
  const tk = useTokens();
  const [open, setOpen] = useState(false);
  const c = play.controls.find(x => x.id === r.to);
  const range = r.mode === 'add' ? `${r.outMin >= 0 ? '+' : ''}${round3(r.outMin)} … ${r.outMax >= 0 ? '+' : ''}${round3(r.outMax)}` : `${round3(r.outMin)} → ${round3(r.outMax)}`;
  return (
    <div data-route={r.id} style={{ padding: '5px 0', borderTop: `1px solid ${tk.border.subtle}`, opacity: r.enabled ? 1 : 0.55 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <IconButton icon={open ? 'chevD' : 'chevR'} label={open ? 'Fold' : 'Range, curve, smoothing'} size="sm" tooltip={false} onClick={() => setOpen(o => !o)} style={{ marginLeft: -6 }} />
        <Select ariaLabel="Control" value={r.to} options={[...(c ? [] : [{ value: r.to, label: 'A missing control' }]), ...play.controls.map(x => ({ value: x.id, label: x.label }))]} height={26} style={{ flex: 1, minWidth: 0 }}
          onChange={to => { const n = play.controls.find(x => x.id === to); onPatch(n && n.kind === 'float' && r.mode === 'replace' ? { to, outMin: n.min, outMax: n.max, channel: undefined } : { to, channel: undefined }); }} />
        <Toggle checked={r.enabled} onChange={enabled => onPatch({ enabled })} />
        <IconButton icon="close" label="Remove this route" size="sm" onClick={onRemove} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, paddingLeft: 22 }}>
        <Segmented size="sm" ariaLabel="How it drives" value={r.mode} onChange={mode => {
          if (mode === r.mode) return;
          const min = c?.kind === 'float' ? c.min : 0, max = c?.kind === 'float' ? c.max : 1;
          onPatch(mode === 'add' ? { mode, ...rtAddSwing(min, max) } : { mode, outMin: min, outMax: max });
        }} options={[{ value: 'replace', label: 'Set', title: 'Replace: the control follows the source over the range' }, { value: 'add', label: 'Add', title: 'Moves the control from its own slider: a swing around where it is' }]} />
        {!open && <span style={{ color: tk.text.muted, font: `500 11px ${fontFamily.mono}`, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{range}</span>}
      </div>
      {open && <div style={{ padding: '6px 0 2px 22px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={labelStyle}>{r.mode === 'add' ? 'Swing' : 'Range'}</span>
          <NumberInput value={r.outMin} title="At the source's minimum" onCommit={n => onPatch({ outMin: n })} style={numStyle} />
          <span style={{ color: tk.text.faint }}>→</span>
          <NumberInput value={r.outMax} title="At the source's maximum" onCommit={n => onPatch({ outMax: n })} style={numStyle} />
          <IconButton icon="bidir" label="Invert" size="sm" onClick={() => onPatch({ outMin: r.outMax, outMax: r.outMin })} />
          {c?.kind === 'color' && <Select ariaLabel="Colour channel" value={r.channel === undefined ? 'all' : `${r.channel}`} options={COLOUR_CHANNELS} onChange={v => onPatch({ channel: v === 'all' ? undefined : (parseInt(v, 10) as 0 | 1 | 2) })} height={26} />}
          <span style={{ flex: 1 }} />
          <Segmented size="sm" ariaLabel="Curve" value={r.curve} options={CURVES} onChange={v => onPatch(v === 'custom' ? { curve: 'custom', curveY: r.curveY ?? sampleCurve(r.curve) } : { curve: v })} />
        </div>
        {r.curve === 'custom' && <FedCurvePad feed={feed} value={r.curveY ?? sampleCurve('linear')} range={[r.outMin, r.outMax]} onChange={curveY => onPatch({ curveY })} onReset={() => onPatch({ curveY: sampleCurve('linear') })} />}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 6 }}>
          <span style={labelStyle}>Smooth</span>
          <div style={{ ...rowField, rowGap: 6 }}>
            <span style={rowGroup}>
              <NumberInput value={r.smoothMs ?? 0} min={0} max={5000} step={10} title="Smoothing in milliseconds" onCommit={n => onPatch({ smoothMs: Math.max(0, n) || undefined })} style={numStyle} />
              <span style={{ color: tk.text.faint, font: `500 11px ${fontFamily.ui}` }}>ms</span>
            </span>
            <span style={rowGroup}>
              <span style={{ ...labelStyle, width: 'auto', marginLeft: 6 }}>Delay</span>
              <NumberInput value={r.delayMs ?? 0} min={0} max={10000} step={10} title="Delay in milliseconds (at most 10 s)" onCommit={n => onPatch({ delayMs: n > 0 ? Math.min(10000, n) : undefined })} style={numStyle} />
              <span style={{ color: tk.text.faint, font: `500 11px ${fontFamily.ui}` }}>ms</span>
            </span>
          </div>
        </div>
      </div>}
    </div>
  );
}
const round3 = (x: number) => Math.round(x * 1000) / 1000;

/**
 * A source's picker and the fields its kind needs (a Null layer and axis, a
 * captured signal, another control, a MIDI CC and channel, a key): the source
 * row of a mapping and of a source card on the Inputs board.
 */
/** A button of a source row that folds into its ⋯ menu when the card is narrow. */
interface RowAction { icon: IconName; label: string; danger?: boolean; onSelect: () => void }

/** Below this a source row puts its fields on a second line and its secondary buttons in a ⋯ menu. */
const SOURCE_ROW_NARROW = 360;

function SourceFields({ source, controls, excludeControlId, nullLayers, layerRefs, numStyle, onChange, onCaptured, mappingId, pickerOnly = false, lead, actions, secondary = [], style }: {
  source: PlaySource;
  controls: PlayControl[];
  /** The control it drives (a control source can't be it). */
  excludeControlId?: string;
  nullLayers: { id: string; label: string }[];
  layerRefs: LayerRef[];
  numStyle: React.CSSProperties;
  onChange: (source: PlaySource) => void;
  /** Set picked: the source, with no glide (a mapping drops its smoothing). */
  onCaptured: (source: PlaySource) => void;
  /** The readers panel opens on this mapping. */
  mappingId?: string;
  pickerOnly?: boolean;
  /** Before the picker: the fold chevron, the drag grip, the "Source" label. */
  lead?: ReactNode | ((narrow: boolean) => ReactNode);
  /** After the fields, always shown (Solo, Learn). */
  actions?: ReactNode;
  /** After those: buttons when there's room, a ⋯ menu when the card is narrow. */
  secondary?: readonly RowAction[];
  style?: React.CSSProperties;
}) {
  const tk = useTokens();
  const rowRef = useRef<HTMLDivElement>(null);
  const narrow = useNarrow(rowRef, SOURCE_ROW_NARROW);
  const [more, setMore] = useState<{ x: number; y: number } | null>(null);
  const type = sourceType(source);
  const readers = useNodeGraphStore(s => s.play.audioReaders?.readers) ?? NO_READERS;
  const allSources = useCan('play.sources');
  const signals = useNodeGraphStore(s => s.play.signals);
  const sourceSections = useMemo(() => sourcePickerSections(readers, !allSources, signals), [readers, allSources, signals]);
  const otherControls = controls.filter(c => c.id !== excludeControlId);
  const pickSource = (v: string) => {
    if (!allSources && sourceTypeNeedsPro(v)) { openProSheet('play.sources'); return; }
    if (v.startsWith(SIGNAL_SOURCE)) { onChange(signalSource(v.slice(SIGNAL_SOURCE.length))); return; }
    if (v === OPEN_READERS) { useReadersPanel.getState().show({ mappingId: mappingId ?? '', focus: source.kind === 'reader' ? source.readerId : '' }); return; }
    // Set: the first signal that captures a number, and no glide (it jumps).
    if (v === 'captured' && source.kind !== 'captured') { onCaptured({ kind: 'captured', signal: (signals ?? []).find(s => s.capture && !s.capture.what.startsWith(CAPTURE_POS))?.id ?? signals?.[0]?.id ?? '', release: 'stay' }); return; }
    onChange(sourceFromType(v as SourceType, source, otherControls[0]?.id ?? '', nullLayers[0]?.id ?? '', firstSensor(layerRefs), firstDataset()));
  };
  const picker = <GroupedPicker ariaLabel="Source" value={type} sections={sourceSections} onChange={pickSource} height={26} style={{ flex: 1, minWidth: 0 }} width={300} searchPlaceholder="Search sources" />;
  const extras = pickerOnly ? null : sourceExtras();
  const buttons = <>
    {actions}
    {narrow && secondary.length > 0
      ? <IconButton icon="more" label="More: map, details, remove" size="sm" onClick={e => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setMore({ x: r.left, y: r.bottom + 4 }); }} />
      : secondary.map(a => <IconButton key={a.label} icon={a.icon} label={a.label} size="sm" tone={a.danger ? 'danger' : 'default'} onClick={a.onSelect} />)}
  </>;
  // Wide: one line that still wraps rather than clips. Narrow: the picker and the buttons on the
  // first line (the picker's name ellipsised), the source's own fields on the next.
  return (
    <div ref={rowRef} style={{ display: 'flex', alignItems: 'center', gap: 6, rowGap: 6, flexWrap: 'wrap', ...style }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: narrow ? '1 1 0' : '1 1 140px', minWidth: 0 }}>
        {typeof lead === 'function' ? lead(narrow) : lead}
        {picker}
      </div>
      {!narrow && extras && <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: '1 1 auto', minWidth: 0, flexWrap: 'wrap' }}>{extras}</div>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, marginLeft: 'auto' }}>{buttons}</div>
      {narrow && extras && <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: '1 1 100%', minWidth: 0, flexWrap: 'wrap' }}>{extras}</div>}
      {more && <Menu x={more.x} y={more.y} onClose={() => setMore(null)} items={secondary.map(a => ({ label: a.label, icon: a.icon, danger: a.danger, onSelect: a.onSelect }))} />}
    </div>
  );

  // The fields a source kind needs beyond the picker (null when it needs none).
  function sourceExtras(): ReactNode {
    const parts = <>
        {source.kind === 'null' && (
          nullLayers.length === 0
            ? <span style={{ color: tk.text.faint, font: `11px ${fontFamily.ui}` }}>Add a Null layer first</span>
            : <>
                <Select ariaLabel="Null layer" value={source.layerId} options={nullLayers.map(l => ({ value: l.id, label: l.label }))} onChange={v => onChange({ kind: 'null', layerId: v, axis: source.kind === 'null' ? source.axis : 'x' })} height={26} style={{ flex: 1, minWidth: 0 }} />
                <Segmented size="sm" ariaLabel="Null axis" value={source.axis} options={[{ value: 'x', label: 'X' }, { value: 'y', label: 'Y' }]} onChange={v => onChange({ kind: 'null', layerId: source.kind === 'null' ? source.layerId : '', axis: v })} />
              </>
        )}
        {source.kind === 'captured' && (() => {
          const src = source;
          return <>
            <Select ariaLabel="Signal it takes the value from" value={src.signal} options={[...(signals ?? []).some(s => s.id === src.signal) ? [] : [{ value: src.signal, label: 'Pick a signal' }], ...(signals ?? []).map(s => ({ value: s.id, label: s.capture ? s.name : `${s.name} (captures nothing yet)` }))]} onChange={v => onChange({ ...src, signal: v })} height={26} style={{ flex: 1, minWidth: 0 }} />
            <Segmented size="sm" ariaLabel="When the signal lets go" value={src.release} options={[
              { value: 'stay', label: 'Stay', title: 'Keeps the value it was set to until the next capture' },
              { value: 'back', label: 'Go back', title: 'The control goes back to its own slider when the signal is false' },
              { value: 'value', label: 'Go to', title: 'Goes to a resting value when the signal is false' },
            ]} onChange={release => onChange(release === 'value' ? { ...src, release, rest: src.rest ?? 0 } : { kind: 'captured', signal: src.signal, release })} />
            {src.release === 'value' && <NumberInput value={src.rest ?? 0} step={0.01} title="Where it rests while the signal is false" onCommit={n => onChange({ ...src, rest: n })} style={{ ...numStyle, width: 52 }} />}
          </>;
        })()}
        {source.kind === 'control' && (
          otherControls.length === 0
            ? <span style={{ color: tk.text.faint, font: `11px ${fontFamily.ui}` }}>Add a second control</span>
            : <Select ariaLabel="Source control" value={source.controlId} options={otherControls.map(c => ({ value: c.id, label: c.label }))} onChange={v => onChange({ kind: 'control', controlId: v })} height={26} style={{ flex: 1, minWidth: 0 }} />
        )}
        {source.kind === 'midi' && source.signal === 'cc' && (isUnassignedCc(source)
          ? <MidiWaitChip title="This row has no knob yet: the first CC that moves on any device becomes its CC (or type one in the Knob row below)" />
          : <NumberInput value={source.cc ?? 0} min={0} max={127} step={1} title="CC number" onCommit={n => onChange({ ...source, kind: 'midi', signal: 'cc', channel: source.kind === 'midi' ? source.channel : 0, cc: Math.max(0, Math.min(127, Math.round(n))) })} style={{ ...numStyle, width: 44 }} />
        )}
        {source.kind === 'midi' && (
          <Select ariaLabel="MIDI channel" value={`${source.channel}`} options={CHANNELS} onChange={v => onChange({ ...(source as Extract<PlaySource, { kind: 'midi' }>), channel: parseInt(v, 10) || 0 })} height={26} style={{ flexShrink: 0 }} />
        )}
        {source.kind === 'key' && (
          <span style={{ height: 26, padding: '0 8px', borderRadius: 6, display: 'inline-flex', alignItems: 'center', background: tk.bg.field, font: `600 11.5px ${fontFamily.mono}`, color: tk.text.primary }}>{keyName(source.code)}</span>
        )}
    </>;
    return source.kind === 'null' || source.kind === 'captured' || source.kind === 'control' || source.kind === 'midi' || source.kind === 'key' ? parts : null;
  }
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
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 6 }}>
      <span style={labelStyle}>Options</span>
      <div style={rowField}>{children}</div>
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
    case 'fn': {
      const { error } = fnEval(source.expr, { t: 0, b: 0 });
      return (
        <>
          {row(<>
            <Field value={source.expr} onChange={e => onChange({ ...source, expr: e.target.value })} height={26} mono style={{ flex: 1, minWidth: 140 }} placeholder="sin(t * 2) * 0.5 + 0.5" />
            <FnPreview expr={source.expr} />
          </>)}
          <div style={{ margin: '-2px 0 6px 60px', color: error ? tk.status.danger : tk.text.faint, font: `11px/1.4 ${fontFamily.ui}` }}>
            {error || 't = seconds, b = beats · sin cos tan abs floor ceil round fract sqrt pow exp log sign min max mix clamp step smoothstep mod noise rand'}
          </div>
          {row(<>
            <NumberInput value={source.min} title="Raw value that reads as 0" onCommit={n => onChange({ ...source, min: n })} style={{ ...numStyle, width: 48 }} />
            {hint('→')}
            <NumberInput value={source.max} title="Raw value that reads as 1" onCommit={n => onChange({ ...source, max: n === source.min ? n + 1 : n })} style={{ ...numStyle, width: 48 }} />
            {hint('range: normalises the formula into 0–1')}
          </>)}
        </>
      );
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
        {source.type === 'biased' && <>
          <NumberInput value={Math.round((source.bias ?? 0.5) * 100)} min={0} max={100} step={5} title="Lean: 0 low, 50 even, 100 high" onCommit={n => onChange({ ...source, bias: Math.max(0, Math.min(100, n)) / 100 })} style={{ ...numStyle, width: 40 }} />
          {hint('lean %')}
        </>}
        <IconButton icon="dice" label="New seed: a different random path" size="sm" onClick={() => onChange({ ...source, seed: Math.floor(Math.random() * 100000) })} />
        <Toggle checked={!!source.reseed} onChange={reseed => { if (reseed) { onChange({ ...source, reseed }); return; } const rest = { ...source }; delete rest.reseed; onChange(rest); }} label="New each play" />
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
    case 'face':
    case 'pose': {
      const reads = source.kind === 'face' ? FACE_READ_HINTS : POSE_READ_HINTS;
      return (
        <>
          {row(<>
            {(source.read === 'point' || source.read === 'visibility') && <TrackPointPicker kind={source.kind} value={source.point} onChange={point => onChange({ ...source, point })} />}
            {source.read === 'point' && <Segmented size="sm" ariaLabel="Axis" value={source.axis} options={[{ value: 'x', label: 'X' }, { value: 'y', label: 'Y' }, { value: 'z', label: 'Z', title: 'Toward the camera' }]} onChange={axis => onChange({ ...source, axis })} />}
            {source.kind === 'face' && source.read === 'blend' && <Select ariaLabel="Blendshape" value={`${source.point}`} options={BLEND_OPTIONS} onChange={v => onChange({ ...source, point: parseInt(v, 10) || 0 })} height={26} style={{ flex: 1, minWidth: 0 }} />}
            {source.kind === 'face' && source.read === 'gesture' && <Select ariaLabel="Face gesture" value={source.gesture} options={FACE_GESTURE_OPTIONS} onChange={v => onChange({ ...source, gesture: v as FaceGesture })} height={26} />}
            {source.kind === 'pose' && source.read === 'gesture' && <Select ariaLabel="Pose gesture" value={source.gesture} options={POSE_GESTURE_OPTIONS} onChange={v => onChange({ ...source, gesture: v as PoseGesture })} height={26} />}
            <TrackerChip kind={source.kind} />
          </>)}
          <div style={{ margin: '-2px 0 6px 60px', color: tk.text.faint, font: `11px/1.4 ${fontFamily.ui}` }}>{(reads as Record<string, string>)[source.read]}</div>
        </>
      );
    }
    case 'data':
      return <DataSourceOptions source={source} labelStyle={labelStyle} onChange={onChange} />;
    case 'midi':
      return <MidiSourceOptions source={source} labelStyle={labelStyle} numStyle={numStyle} onChange={onChange} />;
    case 'pad':
      return <PadSourceOptions source={source} labelStyle={labelStyle} numStyle={numStyle} onChange={onChange} />;
    case 'sensor': {
      const sensing = layerRefs.filter(l => sensorReadsFor(l).length);
      if (!sensing.length) return row(hint('Add a layer first: a shape, particles, a null…'));
      const layer = layerRefs.find(l => l.id === source.layerId);
      const reads = sensorReadsFor(layer);
      return (
        <>
          {row(<>
            <Select ariaLabel="Sensor layer" value={source.layerId} options={sensing.map(l => ({ value: l.id, label: l.label }))} onChange={v => { const r = sensorReadsFor(layerRefs.find(l => l.id === v)); onChange({ ...source, layerId: v, read: r.includes(source.read) ? source.read : r[0] ?? 'fill' }); }} height={26} />
            {reads.length > 1 && reads.length <= 4 && <Segmented size="sm" ariaLabel="Reads" value={source.read} options={reads.map(r => ({ value: r, label: SENSOR_LABELS[r], title: SENSOR_HINTS[r] }))} onChange={v => onChange({ ...source, read: v })} />}
            {reads.length > 4 && <Select ariaLabel="Reads" value={source.read} options={reads.map(r => ({ value: r, label: SENSOR_LABELS[r] }))} onChange={v => onChange({ ...source, read: v as SensorRead })} height={26} />}
            {PER_GRAIN_READS.includes(source.read) && <Select ariaLabel="Which grain" value={source.otherId || '1'} options={Array.from({ length: GRAIN_EACH }, (_, i) => ({ value: String(i + 1), label: `Grain ${i + 1}` }))} onChange={v => onChange({ ...source, otherId: v })} height={26} />}
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
    <div style={{ display: 'flex', alignItems: top ? 'flex-start' : 'baseline', gap: 6, marginBottom: 6 }}>
      <span style={top ? { ...labelStyle, lineHeight: '26px' } : labelStyle}>{label}</span>
      {top ? <div style={{ flex: '1 1 0', minWidth: 0 }}>{children}</div> : <div style={rowField}>{children}</div>}
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
/**
 * A Function source's live raw value, next to its expression field. Follows
 * the preview clock directly (lib/timeTick, the same one ShaderCanvas emits
 * every frame) and writes the span's text on each tick instead of setting
 * React state, so typing a formula never fights a per-frame re-render.
 */
function FnPreview({ expr }: { expr: string }) {
  const tk = useTokens();
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => subscribeTimeTick(t => {
    const el = ref.current;
    if (!el) return;
    const { value, error } = fnEval(expr, { t, b: t * FN_BEAT_HZ });
    el.textContent = error ? '—' : value.toFixed(3);
  }), [expr]);
  return <span ref={ref} style={{ minWidth: 52, textAlign: 'right', flexShrink: 0, font: `11px ${fontFamily.mono}`, color: tk.text.faint }}>0.000</span>;
}

/** Where a meter's reading comes from: polled from the source while `live` (only the meter renders as it moves), else `given`. */
type MeterFeed = { read: () => number; live: boolean; given: number };

/** A mapping meter that reads its own source; with a curve, the bar is the curved value. */
function FedMeter({ feed, curved = false, curve, curveY, on, margin }: { feed: MeterFeed; curved?: boolean; curve?: PlayMapping['curve']; curveY?: number[]; on: boolean; margin: string }) {
  const meter = usePolledNumber(feed.read, feed.live, 50, feed.given);
  return <MappingMeter input={meter} output={curved ? applyCurve(meter, curve as PlayMapping['curve'], curveY) : meter} on={on} margin={margin} />;
}

/** The curve editor with its live dot, read here. */
function FedCurvePad({ feed, ...rest }: { feed: MeterFeed } & Omit<ComponentProps<typeof CurvePad>, 'meter'>) {
  const meter = usePolledNumber(feed.read, feed.live, 50, feed.given);
  return <CurvePad {...rest} meter={meter} />;
}

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
