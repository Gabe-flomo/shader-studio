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
import { can, openProSheet, requireFeature, useCan, usePlanName } from '../../lib/plan';
import { sourceNeedsPro, proOnlyParts } from '../../play/planGates';
import { ProBadge } from '../account/ProSheet';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { agentReadLayer } from '../../lib/agentReadings';
import { getNodeDefinitionFor } from '../../nodes/definitions';
import type { GraphNode } from '../../types/nodeGraph';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import type { PlayControl, PlayRecord } from '../../types/play';
import { removeRoute, routeToControl, routesInto } from '../../play/routeOps';
import { useMapMode } from './inputs/mapMode';
import { LearnModeBar, MapModeBar, MapTarget } from './inputs/MapTarget';
import { InputsBoard, useInputsBoard } from './inputs/InputsBoard';
import { learnOnto, useLearnMode } from './inputs/learnMode';
import { driverCardFor, driverCardOf, driverFoldKeys, type DriverCard } from './mappingGroups';
import { dropOutcome } from './inputs/sourceDrag';
import { controlSwing } from '../../play/controlSwing';
import { DetailWindow } from './detail/DetailWindow';
import { startPlayNotes } from '../../lib/playNotes';
import { openDetail } from './detail/detailStore';
import { sourceLabel } from '../../play/playSources';
import { grainSensorLayer, isGranulatorRack, parseGrainsTarget } from '../../types/playAudioEngine';
import { playEngine } from '../../lib/playEngine';
import { midiEngine } from '../../lib/midiEngine';
import { claimMidiListen } from '../../lib/midiAutoLearn';
import { candidateLabel, collectPlayCandidates, controlExists, controlHelp, findTargetNode, locateTarget, playId, readControlValue, targetParts, type PlayCandidate } from '../../play/playControls';
import { Button, IconButton } from '../ui/Button';
import { Segmented } from '../ui/Choice';
import { LayersPanel } from './LayersPanel';
import { FinishPanel } from './finish/FinishPanel';
import { NOTES_FOLD_KEY, NotesCard } from './NotesCard';
import { AspectPicker, CanvasFullscreenButton, PreviewQualityPicker, FrameRatePicker } from '../shell/PreviewChrome';
import type { NoteRefKind } from './noteRefs';
import { LayerContextMenu } from './LayerContextMenu';
import { driveWithNull, pairedKey, type NullDrive } from './layerOps';
import { toast } from '../ui/toastStore';
import { usePlayUi, type PanelSize, type PlayTab } from './playUi';
import { applyControlLink, LinkableControl, useControlLinkEscape } from './ControlLink';
import { setLayerDropHandler } from '../../play/layerDrop';
import { addDroppedLayers, dropLabel } from './dropLayers';
import { appDropMakers } from './dropMakers';
import { sidebarView, startRule, useBigPage, useBigTab, usePlaySplit } from './playSplit';
import { PlayRailBar } from './PlayRail';
import { phonePageShown, type RailPage } from './railPages';
import { BackgroundPage } from './FullPages';
import { ControlsBoard, type BoardSlot } from './ControlsBoard';
import { AudioEnginePanel } from './engine/AudioEnginePanel';
import { aeRack, aeSlot, aeSlotLabel, parseAuTarget, parseMacroTarget, patchSlot, rackMacros } from '../../types/playAudioEngine';
import { setMacroValue } from '../../play/rackMacros';
import { SplitButton } from './PlaySplitArea';
import { PlaySetupDialogs, playSetupItems } from './playSetupMenu';
import { wireRuleWhen } from './miniMapperCore';
import { rackKeyboard } from '../../lib/rackKeyboard';
import { keyboardClaimed } from '../../lib/keyboardClaim';
import { anyLiveMapped } from './useLiveValues';
import { useStage } from './stageStore';
import { GuidesToggle } from './GuidesToggle';
import { SuggestControlsButton } from './SuggestControlsButton';
import { actionsForLayer, layerNumericProps, actionTarget, defaultActionAmount, parseActionTarget, parseLayerTarget, parsePropTarget, type ActionKind } from '../../types/play';
import { AUDIO_FX_EFFECTS, audioFxControlFor, audioFxEffect, audioFxHosts, audioFxParam, parseAudioFxTarget, patchAudioFxEffect, readAudioFxValue } from '../../types/playAudioFx';
import { finishHost, finishHostLabel, finishHosts, finishNumericProps, finishParamOf, finishTarget, parseFinishTarget, patchFinishEffect, readFinishValue } from '../../types/playFinish';
import { playBackground } from '../../play/background';
import { BackgroundRow } from './BackgroundRow';
import { actionLabel } from './layers/help';
import { AudioReadersHost } from './AudioReadersPanel';
import { useReadersPanel } from './readersPanelUi';
import { formatHz, formatWidth } from '../../play/audioReaders';
import { addMissingReaderControls, readerSourceName, readersWithoutControls, removeReader, renameReader } from '../../play/readerControls';
import { isControlAction, parseReaderTarget } from '../../types/play';
import { controlActionValue, settableControls, withoutControlReactions } from '../../play/controlActions';
import { BehavioursButton } from './rules/BehavioursLink';
import { ContextMenuArea } from '../ui/ContextMenuArea';
import { Menu, type MenuItem } from '../ui/Menu';
import { SpreadsSection } from './SpreadsSection';
import { parseSpreadTarget } from '../../types/play';
import { addToSpread, canSpread, makeSpread, removeFromSpread, spreadOf } from '../../play/spreads';
import { wireSpreadResets } from '../../play/spreadReset';
import { pairMappingLabel } from './PairControls';
import { makePair, newPairMapping, pairOf, partnerTarget, positionPair, unpair } from '../../play/pairs';
import { pairDrives } from '../../lib/playEngine';
import { mappingLabel } from '../../play/incrementUi';
import { EmptyState, NO_LAYER_CANDIDATES, PANEL_GRID, PanelHeader, joinParts, usesMidi } from './pages/shared';
import { AddControlButton, ControlGroup, ControlRow, type ControlSource, type LayerCandidates, LivePairCard } from './pages/ControlCards';
import { type AudioNodeOption, DetailSource, MappingsDrawer } from './pages/SourcesColumn';
import { LayersRailPage, LockedBackground, LockedLayers } from './pages/LayersPage';
import { FinishRailPage, LockedFinish } from './pages/FinishPage';
import { MidiFilePage, PadGridPage } from './pages/ControlsPage';
import { RulesRailPage } from './pages/RulesPage';
import { SoundArrangementPage, SoundEffectsPage } from './pages/SoundPage';

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

  // A rule's Set a control and Nudge a control (play/controlActions.ts): the control moves as if its slider were dragged.
  useEffect(() => playEngine.onAction(a => {
    if (!isControlAction(a.do) || !a.enabled) return;
    const st = useNodeGraphStore.getState();
    const c = settableControls(st.play).find(x => x.id === a.control);
    if (!c) return;
    const now = readControlValue(st.nodes, c.target, st.play);
    writeControl(c, controlActionValue(a, c, typeof now === 'number' ? now : c.min));
  }), [writeControl]);

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
  // The split panel is out (desktop): its header's ⋯ has the setup's actions (playSetupMenu.tsx).
  const setupInPanel = usePlaySplit(s => s.on && s.available && !!s.host) && !compact;
  const splitWide = usePlaySplit(s => s.wide);
  const sidebarGone = usePlaySplit(s => s.sidebar !== 'full') && big !== null;
  // Phones: the page picked from the bottom row (a Layers or Mappings page of its own, or the tab's).
  const phonePicked = usePlayUi(s => s.phonePage), finishView = usePlayUi(s => s.finishView);
  const phonePage: RailPage | null = compact ? phonePageShown(tab, finishView, phonePicked) : null;
  const sideView = sidebarView(tab, big);
  // A phone page that isn't a whole section (Actions, Signals, Background, MIDI file, Pad grid) shows on its own.
  const phoneOwn = !!phonePage && OWN_PAGES.has(phonePage);
  const shown: PlayTab | null = compact ? (phoneOwn ? null : tab) : sideView.tab;
  const phoneSourceCount = play.mappings.length + (play.sources?.length ?? 0) + (play.pairMappings?.length ?? 0);
  const nullLayers = useMemo(() => play.layers.filter(l => l.kind === 'null').map(l => ({ id: l.id, label: l.label })), [play.layers]);
  const [notesEditing, setNotesEditing] = useState(false);
  // Phones: Suggest controls opens from the Controls ⋯ (there's no button for it in the header).
  const [suggestOpen, setSuggestOpen] = useState(false);
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
  // The graph's Agents groups (id and label, as a string so it only changes when they do).
  const agentGroupsKey = useNodeGraphStore(s => s.nodes.filter(nd => nd.type === 'agentsGroup').map(nd => `${nd.id}\t${typeof nd.params.label === 'string' ? nd.params.label : ''}`).join('\n'));
  const layerRefs = useMemo(() => [
    ...play.layers.map(l => ({ id: l.id, label: l.label, kind: l.kind, ...(l.kind === 'shape' ? { shape: l.shape } : {}) })),
    ...(play.audioEngine?.racks ?? []).filter(isGranulatorRack).map(r => ({ id: grainSensorLayer(r.id), label: `${r.name} · grains`, kind: 'granulator' })),
    // The graph's Agents groups read like layers too (alive, centre, spread…), as `ag:<node id>` (lib/agentReadings.ts).
    ...(agentGroupsKey ? agentGroupsKey.split('\n').map(line => { const [id, label] = line.split('\t'); return { id: agentReadLayer(id), label: `${label || 'Agents'} · walkers`, kind: 'agentsGroup' }; }) : []),
  ], [play.layers, play.audioEngine, agentGroupsKey]);
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

  // The notes fold into the Controls header's ⓘ (folded unless opened, remembered on this device).
  const hasNotes = !!(play.notes || play.source);
  const notesOpen = usePlayUi(s => s.folded[NOTES_FOLD_KEY] === false);
  const foldNotes = useCallback((open: boolean) => usePlayUi.getState().toggleFold(NOTES_FOLD_KEY, !open), []);
  const notesCard = ((hasNotes && notesOpen) || notesEditing) ? (
    <NotesCard
      open={notesOpen || notesEditing}
      onFold={foldNotes}
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
  // The setup's actions (Open, Import, Export, website, Clear) sit in the panel's ⋯ when the panel is out; else here.
  const controlsMoreItems = (close: () => void): MenuItem[] => [
    { label: play.notes || play.source ? 'Edit notes…' : 'Add notes…', icon: 'comment', disabled: notesEditing, hint: 'What this setup shows, how to play it, and where it comes from', onSelect: () => { close(); setNotesEditing(true); } },
    // Phones: the header keeps only Add control and ⋯, so Suggest is here (Play audit P20).
    ...(compact ? [{ label: 'Suggest controls…', icon: 'spark' as const, hint: 'The settings that change the picture most, to add as controls', onSelect: () => { close(); setSuggestOpen(true); } }] : []),
    // Phones have no preview bar, so Stage is here.
    ...(compact ? [{ label: 'Stage', icon: 'play' as const, hint: 'The picture and its controls on their own, as people will play with it', onSelect: () => { close(); useStage.getState().open('full'); } }] : []),
    ...(setupInPanel ? [] : [{ heading: 'Play setup' } as MenuItem, ...playSetupItems({ close, anchor: pageMoreRef.current, sheet: compact })]),
  ];
  const controlsHeader = <PanelHeader
    // Phones: the Controls / Sources switch above already says it, with the count.
    title={compact ? '' : 'Controls'}
    hint={play.controls.length === 0 || compact ? undefined : `${play.controls.length}`}
    after={hasNotes && !notesEditing ? <IconButton icon="info" size="sm" data-notes-toggle="" active={notesOpen} label={notesOpen ? 'Fold the notes away' : 'Notes: what this setup shows and how to play it'} onClick={() => foldNotes(!notesOpen)} /> : undefined}
    extra={(
      <>
        {/* Load, Import, Export, Record and Stage live in the top bar and the preview bar; the setup's own
            actions in the panel's ⋯ (playSetupMenu.tsx). Here: Suggest and Add control, then ⋯ (Notes…).
            A phone keeps only "+ Control" and ⋯, both 44px, with Suggest in the ⋯ (Play audit P20). */}
        {!compact && <SuggestControlsButton compact={compact} />}
        {addControlButtonEl}
        <span ref={pageMoreRef} style={{ display: 'inline-flex' }}>
          <IconButton icon="more" label="More: notes, and the setup" style={compact ? PHONE_TARGET : undefined} onClick={() => { const r = pageMoreRef.current?.getBoundingClientRect(); setPageMore(r ? { x: r.right - 220, y: r.bottom + 4 } : null); }} />
        </span>
        {compact && <SuggestControlsButton open={suggestOpen} onOpenChange={setSuggestOpen} anchorRef={pageMoreRef} />}
        {pageMore && <Menu x={pageMore.x} y={pageMore.y} minWidth={220} title="Controls" onClose={() => setPageMore(null)} items={controlsMoreItems(() => setPageMore(null))} />}
      </>
    )}
  />;
  // Phones: the canvas shape and the background sit at the top of the Layers page (Play audit P20).
  // The canvas row wraps instead of running off the edge (Full screen and the guides were past 390px).
  const phoneLayersTop = compact ? (
    <>
      {notesCard}
      <div data-phone-canvas-row="" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px 8px', padding: '6px 12px' }}>
        <span style={{ color: tk.text.faint, font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Canvas</span>
        <AspectPicker onPanel />
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <PreviewQualityPicker onPanel /><FrameRatePicker onPanel />
          <CanvasFullscreenButton onPanel plainF />
          <GuidesToggle onPanel />
        </span>
      </div>
      {backgroundsOk ? <BackgroundRow play={play} onChange={update} /> : <LockedBackground />}
    </>
  ) : null;
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
  // Learn mode's state (inputs/learnMode.ts): on, the picked control, what it mapped there.
  const learnOn = useLearnMode(s => s.on), learnControl = useLearnMode(s => s.controlId), learnMapping = useLearnMode(s => s.mappingId), learnHeard = useLearnMode(s => s.heard);
  /** What drives a control, one entry per driver (its id, to open it): the card's "Mapped by" list. */
  const drivers = (id: string) => routesInto(play, id).map(x => ({ id: x.sourceId, label: x.mapping ? mappingLabel(play.mappings.find(m => m.id === x.sourceId)!, play) : `${x.label}${x.mode === 'add' ? ' (add)' : ''}` }));
  /** Learn: what it mapped onto the picked control, for the card's overlay. */
  const learnedMapping = learnMapping ? play.mappings.find(m => m.id === learnMapping) : undefined;
  const learnedLabel = learnedMapping ? sourceLabel(learnedMapping.source, play.controls, layerRefs) : undefined;
  /** What drives a control, in words: its mappings, and the record's sources routed onto it. */
  const drivenLabels = (id: string) => [...play.mappings.filter(m => m.enabled && m.controlId === id).map(m => mappingLabel(m, play)), ...routesInto(play, id).filter(x => !x.mapping).map(x => `${x.label}${x.mode === 'add' ? ' (add)' : ''}`)];
  /**
   * A control's "driven by" chip (and its card's "Mapped by" list) opens what drives it in Sources
   * (Play audit P20 on phones, P7 on desktop): Sources shown (the phone's switch, the narrow board's
   * tab, the drawer), its group and card unfolded, scrolled to and flashed. `driverId` picks one
   * driver; else its first.
   */
  const openDriver = (controlId: string, driverId?: string) => {
    const d: DriverCard | null = driverId ? driverCardOf(play, driverId) : driverCardFor(play, controlId);
    if (!d) { openDetail('control', controlId); return; }
    usePlayUi.getState().toggleFoldMany(driverFoldKeys(d), false);
    useMapMode.getState().stop();
    useLearnMode.getState().stop();
    if (compact) setTab('mappings');
    else { useInputsBoard.getState().setTab('sources'); setDrawerOpen(true); }
    const sel = d.kind === 'mapping' ? `[data-mapping-id="${CSS.escape(d.id)}"]` : `[data-source-card="${CSS.escape(d.id)}"]`;
    // After the Sources side renders (in the page, or the split view's panel).
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const el = rootRef.current?.querySelector<HTMLElement>(sel) ?? usePlaySplit.getState().host?.querySelector<HTMLElement>(sel);
      if (!el) return;
      el.scrollIntoView({ block: 'start', behavior: 'smooth' });
      const was = el.style.outline;
      el.style.outline = `2px solid ${tk.accent.base}`;
      window.setTimeout(() => { el.style.outline = was; }, 1200);
    }));
  };
  // Mapping or learning on a phone: the controls are what to tap, so a Map or Learn started in Sources goes back to them.
  useEffect(() => { if (compact && (mapSrc || learnOn) && usePlayUi.getState().tab === 'mappings') setTab('controls'); }, [compact, mapSrc, learnOn, setTab]);
  // Learn mode (inputs/learnMode.ts, Play audit P6): MIDI connects when it starts (the user asked for
  // it), Esc stops it, and once a control is picked the next input becomes a mapping onto it.
  useEffect(() => {
    if (!learnOn) return;
    void midiEngine.connectWebMidi({ retry: true });
    const release = claimMidiListen();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') useLearnMode.getState().stop(); };
    window.addEventListener('keydown', onKey);
    return () => { release(); window.removeEventListener('keydown', onKey); };
  }, [learnOn]);
  useEffect(() => {
    if (!learnOn || !learnControl) return;
    return playEngine.startLearn(source => {
      if (sourceNeedsPro(source) && !can('play.sources')) { useLearnMode.getState().stop(); openProSheet('play.sources'); return; }
      const st = useLearnMode.getState();
      if (!st.on || st.controlId !== learnControl) return;
      const cur = useNodeGraphStore.getState().play;
      const r = learnOnto(cur, learnControl, st.mappingId, source, playId('map'));
      if (r.play !== cur) update(() => r.play);
      // Listening again (startLearn stops after each input): another knob replaces this one.
      st.learned(r.mappingId);
    });
  }, [learnOn, learnControl, learnHeard, update]);
  // Leaving the page ends Learn.
  useEffect(() => () => useLearnMode.getState().stop(), []);
  /** The swing ring: where its sources can move it, from its own slider value (Add routes swing around it). */
  const controlName = (id: string) => play.controls.find(c => c.id === id)?.label ?? 'That control';
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
      const drivenA = pms.some(m => pairDrives(m, pair, c.id)) || play.mappings.some(m => m.enabled && m.controlId === c.id);
      const drivenB = pms.some(m => pairDrives(m, pair, cb.id)) || play.mappings.some(m => m.enabled && m.controlId === cb.id);
      return (
        <ContextMenuArea key={c.id} items={() => pairMenu(pair.id)}>
          <LivePairCard
            liveOn={liveOn}
            pair={pair} a={c} b={cb} touch={compact}
            values={[num(readControlValue(nodes, c.target, play)), num(readControlValue(nodes, cb.target, play))]}
            drivenA={drivenA}
            drivenB={drivenB}
            drivenBy={[...pms.map(m => pairMappingLabel(m, play)), ...play.mappings.filter(m => m.enabled && (m.controlId === c.id || m.controlId === cb.id)).map(m => mappingLabel(m, play))]}
            onChange={(ctl, v) => writeControl(ctl, v)}
            onRename={label => update(p => ({ ...p, pairs: (p.pairs ?? []).map(x => (x.id === pair.id ? { ...x, label } : x)) }))}
            onPosition={position => update(p => ({ ...p, pairs: (p.pairs ?? []).map(x => (x.id === pair.id ? { ...x, position } : x)) }))}
            onUnpair={() => update(p => unpair(p, pair.id))}
            onMap={() => addPairMapping(pair.id)}
            trace={drivenA || drivenB ? board?.trace : undefined}
            onName={board?.onIsolate}
            isolated={board?.isolated}
          />
        </ContextMenuArea>
      );
    }
    return (
    <MapTarget key={c.id} id={c.id} label={c.label} learned={learnControl === c.id ? learnedLabel : undefined} driven={!!mapSrc && routesInto(play, c.id).some(x => x.sourceId === mapSrc)} onPick={() => mapPick(c.id)} onDropSource={id => dropSource(id, c.id)}>
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
      onLearn={() => useLearnMode.getState().start(c.id)}
      onNull={c.kind === 'float' ? () => {
        const v = readControlValue(nodes, c.target, play);
        const key = parsePropTarget(c.target)?.key ?? targetParts(c.target).paramKey;
        addWithNull([{ target: c.target, label: c.label, min: c.min, max: c.max, value: typeof v === 'number' ? v : c.min, axis: pairedKey(key)?.axis ?? 'x' }], `${c.label} null`);
      } : undefined}
      onAmount={amount => update(p => ({ ...p, controls: p.controls.map(x => x.id === c.id ? { ...x, amount } : x) }))}
      value={readControlValue(nodes, c.target, play)}
      liveOn={liveOn}
      drivenBy={drivenLabels(c.id)}
      drivers={drivers(c.id)}
      onDriver={id => openDriver(c.id, id)}
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
      onRemove={() => update(p => { const rt = parseReaderTarget(c.target); return rt ? removeReader(p, rt.readerId) : withoutControlReactions({ ...p, controls: p.controls.filter(x => x.id !== c.id), mappings: p.mappings.filter(m => m.controlId !== c.id) }, c.id); })}
      trace={board?.trace}
      onName={board?.onIsolate}
      isolated={board?.isolated}
      onChip={() => openDriver(c.id)}
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
      {/* Phones: the notes scroll with the controls. The canvas shape and the background are on the Layers page (Play audit P20). */}
      {compact && notesCard && <div style={{ margin: '0 -12px 6px' }}>{notesCard}</div>}
      {lockedParts.length > 0 && (
        <button type="button" onClick={() => openProSheet('play.layers')} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', margin: '4px 0 8px', padding: '8px 10px', border: 0, borderRadius: radius.md, cursor: 'pointer', background: alpha(tk.accent.base, 0.08), color: tk.text.secondary, font: `11.5px/1.45 ${fontFamily.ui}`, textAlign: 'left' }}>
          <ProBadge />
          <span style={{ flex: 1, minWidth: 0 }}>This setup has {joinParts(lockedParts)} that need Pro. They’re kept as they are, and the rest plays on Free.</span>
        </button>
      )}
      {missingReaderControls.length > 0 && readerChipDismissed !== missingReaderKey && (
        <div data-reader-chip style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', margin: '4px 0 8px', padding: '6px 8px', borderRadius: radius.md, background: alpha(tk.accent.base, 0.1), color: tk.text.secondary, font: `11.5px/1.4 ${fontFamily.ui}` }}>
          {/* One short line (Play audit P22); what Add does is its tooltip. */}
          <span data-reader-nudge="" style={{ flex: '1 1 160px', minWidth: 0 }}>{missingReaderControls.length === 1 ? `The audio reader ${missingReaderControls[0].name} isn’t a control yet` : `${missingReaderControls.length} audio readers aren’t controls yet`}</span>
          <Button size="sm" variant="primary" onClick={() => update(p => addMissingReaderControls(p, songLabel))} title="A 0–1 control per reader (its live level), in a group named after what they listen to: map it onto other controls or use it in rules">Add</Button>
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
        >
          {/* Behaviours: ready-made motion and rules once there's a slider or a layer (Play audit P11). */}
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <BehavioursButton play={play} onChange={update} />
            <span style={{ font: `11.5px ${fontFamily.ui}`, color: tk.text.faint }}>Pulse to the beat, bass shakes it, pinch to burst…</span>
          </div>
        </EmptyState>
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
  /**
   * One of the rail's pages (railPages.ts), full width in the big panel, or a
   * page of its own on a phone (`touch`). `wide`: room for two columns.
   */
  const renderPage = (page: RailPage, wide: boolean, touch: boolean): ReactNode => {
    switch (page) {
      case 'controls': return (
        <InputsBoard wide={wide} counts={{ controls: play.controls.length, sources: play.mappings.length + (play.sources?.length ?? 0) + (play.pairMappings?.length ?? 0) }}
          controls={<>{controlsHeader}{notesCard}<div style={{ padding: '0 16px', flexShrink: 0 }}><MapModeBar /><LearnModeBar label={controlName} /></div>{renderControls(true)}</>}
          sources={renderMappings(true, true)} />
      );
      case 'layers': return <LayersRailPage play={play} onChange={update} touch={touch} wide={wide} />;
      case 'signals': return <RulesRailPage play={play} onChange={update} wide={wide} />;
      case 'background': return <BackgroundPage play={play} onChange={update} locked={!backgroundsOk} />;
      case 'finish-picture': return <FinishRailPage play={play} onChange={update} touch={touch} wide={wide} />;
      case 'finish-sound': return <SoundEffectsPage play={play} onChange={update} touch={touch} wide={wide} />;
      case 'engine-performance': return <SoundArrangementPage play={play} onChange={update} touch={touch} wide={wide} />;
      case 'midi-file': return <MidiFilePage />;
      case 'pad-grid': return <PadGridPage />;
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
        <PlaySetupDialogs />
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
            ...(compact || sideView.tabs.includes('engine') ? [{ value: 'engine' as const, label: `Sound${play.audioEngine?.racks.length ? ` · ${play.audioEngine.racks.length}` : ''}${engineOk ? '' : ' · Pro'}`, title: 'The Audio engine: racks of synths (Audio Units on a Mac, or the sample player) and effects, played from MIDI and the keyboard' }] : []),
            ...(compact ? [{ value: 'mappings' as const, label: `Sources${play.mappings.length + (play.pairMappings?.length ?? 0) ? ` · ${play.mappings.length + (play.pairMappings?.length ?? 0)}` : ''}` }] : []),
          ]}
        />
        </div>
        <Segmented size="sm" ariaLabel="Panel width" value={panel} onChange={v => setPanel(v as PanelSize)} options={[{ value: 's', label: 'S', title: 'Narrow panel' }, { value: 'm', label: 'M', title: 'Medium panel' }, { value: 'l', label: 'L', title: 'Wide panel' }]} />
      </div>}
      {/* Phones: a page of its own, picked from the bottom row's sheet. */}
      {phoneOwn && <div data-phone-page={phonePage} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>{renderPage(phonePage!, false, true)}</div>}
      {!compact && notesCard}
      {shown === 'layers' && !layersOk && compact && <div style={{ flexShrink: 0 }}>{phoneLayersTop}</div>}
      {shown === 'layers' && !layersOk && <LockedLayers play={play} />}
      {shown === 'layers' && layersOk && (
        <LayersPanel
          top={compact ? phoneLayersTop : undefined}
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
      {/* Phones: Controls and Sources (the mappings) on one page, a switch between them (Play audit P20). */}
      {compact && !phoneOwn && (tab === 'controls' || tab === 'mappings') && (
        <div data-phone-inputs="" style={{ flexShrink: 0, padding: '8px 12px 6px', background: tk.bg.panel }}>
          <Segmented fill ariaLabel="Controls or sources" value={tab} onChange={v => setTab(v)} options={[
            { value: 'controls' as const, label: `Controls${play.controls.length ? ` · ${play.controls.length}` : ''}` },
            { value: 'mappings' as const, label: `Sources${phoneSourceCount ? ` · ${phoneSourceCount}` : ''}`, title: 'What drives the controls: MIDI, keys, the mouse, audio, hands, a MIDI file, a pad grid' },
          ]} />
        </div>
      )}
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
      {shown === 'controls' && <div style={{ padding: '0 12px', flexShrink: 0 }}><MapModeBar /><LearnModeBar label={controlName} /></div>}
      {shown === 'controls' && renderControls(false)}

      {/* Phones keep the MIDI file and the pad grid in Sources (no pages of their own in the bottom row). */}
      {(compact ? tab === 'mappings' && !phoneOwn : sideView.drawer) && renderMappings(false)}
      {compact && <PlayRailBar />}
      {bigPanel}
      <DetailWindow play={play} onChange={update} renderSource={id => <DetailSource id={id} play={play} update={update} audioNodes={audioNodes} nullLayers={nullLayers} layerRefs={layerRefs} />} />
      <PlaySetupDialogs />
      <AudioReadersHost compact={compact} />
      <LayerContextMenu play={play} onChange={update} />
    </div>
  );
}

const DRAWER_HEIGHT_KEY = 'shader-studio:play:drawerHeight';
/** A phone's touch target in the Controls header: 44px each way (Play audit P20). */
export const PHONE_TARGET = { width: 44, height: 44 } as const;
/** Pages that aren't a whole sidebar section: a phone shows them in place of its tab's section. */
const OWN_PAGES: ReadonlySet<RailPage> = new Set<RailPage>(['signals', 'background', 'midi-file', 'pad-grid']);
