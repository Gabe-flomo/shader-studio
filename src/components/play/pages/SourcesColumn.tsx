/**
 * The Controls page's sources column (pages/ControlsPage.tsx): the mappings
 * and the record's sources that drive the controls (MappingsDrawer), each
 * mapping's row, each source's card and its routes.
 */
import { can, openProSheet, useCan } from '../../../lib/plan';
import { sourceNeedsPro, sourceTypeNeedsPro, triggerNeedsPro } from '../../../play/planGates';
import { ProBadge, ProLock } from '../../account/ProSheet';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useNodeGraphStore } from '../../../store/useNodeGraphStore';
import { useTokens } from '../../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../../theme/tokens';
import type { PlayControl, PlayMapping, PlayRecord, PlayRoute, PlaySource, PlaySourceDef, SourceOutput } from '../../../types/play';
import { RANDOM_SOURCES, addFreeSource, patchRoute, patchSource, removeRoute, removeSource } from '../../../play/routeOps';
import { rtAddSwing } from '../../../play/kit/routes.js';
import { useMapMode } from '../inputs/mapMode';
import { LearnModeBar } from '../inputs/MapTarget';
import { useLearnMode } from '../inputs/learnMode';
import { mapPickAsksMidi, mapPickerSections, parseMapPick } from '../mapPicker';
import { BehavioursDialog } from '../rules/BehavioursDialog';
import { SourceDragHandle } from '../inputs/SourceDragHandle';
import { SourceGroups } from '../inputs/SourceGroups';
import { mappingFoldKey, mappingGroupOf, mappingRangeText, sourceFoldKey, sourceGroupFoldKey, type SourceItem } from '../mappingGroups';
import { openDetail } from '../detail/detailStore';
import { COLOUR_CHANNELS, CURVES, OPEN_READERS, sourceFromType, withFire, sourceLabel, type SourceType } from '../../../play/playSources';
import { ConnectGuide } from '../ConnectGuide';
import { playEngine, sampleCurve } from '../../../lib/playEngine';
import { midiEngine, midiNoteName } from '../../../lib/midiEngine';
import { ASSIGN_FLASH_MS, claimMidiListen, isUnassignedCc, startMidiAutoLearn } from '../../../lib/midiAutoLearn';
import { MidiWaitChip } from '../MidiSourceOptions';
import { Button, IconButton } from '../../ui/Button';
import { rowField, rowGroup } from '../../ui/rowLayout';
import { Segmented, Toggle } from '../../ui/Choice';
import { Field } from '../../ui/Field';
import { Icon } from '../../ui/Icon';
import { Select } from '../../ui/Select';
import { PickerPanel } from '../../ui/GroupedPicker';
import { menuAsSheet } from '../../ui/menuSheet';
import { sourcePickerSections } from '../sourcePickerSections';
import { NumberInput } from '../../NodeGraph/NumberInput';
import { toast } from '../../ui/toastStore';
import { usePlayUi } from '../playUi';
import { MidiStatusChip } from '../chips';
import { HandsButton, HandsChip } from '../HandsChip';
import { handFeed } from '../../../lib/handFeed';
import { usesHands } from '../../../types/play';
import { SoloButton, SoloStrip } from '../Solo';
import { BuiltInSignalsSection } from '../BuiltInSignals';
import { NoteClassMapDialog } from '../NoteClassMapDialog';
import { PadGridCard } from '../PadGridCard';
import { useReadersPanel } from '../readersPanelUi';
import { BehavioursButton } from '../rules/BehavioursLink';
import type { AudioReader } from '../../../types/play';
import type { PlayPairMapping } from '../../../types/play';
import { Menu } from '../../ui/Menu';
import type { IconName } from '../../ui/iconPaths';
import { PairMappingRow } from '../PairControls';
import { signalSource } from '../../../lib/playEngine';
import { SIGNAL_SOURCE } from '../sourcePickerSections';
import { IncrementEditor } from '../IncrementEditor';
import { incrementSummary } from '../../../play/incrementUi';
import { defaultIncrement, type PlayIncrement } from '../../../types/play';
import { recordBpm } from '../../../types/playArrangement';
import { NO_SOURCES, PANEL_GRID_WIDE, PanelHeader, usesMidi } from './shared';
import { FedCurvePad, FedMeter, type LayerRef, type MeterFeed, SourceFields, SourceOptions, firstDataset, firstSensor, round3 } from './SourceFields';
import { MidiFileSlot } from './ControlsPage';

// ── Mappings drawer ──────────────────────────────────────────────────────────

export interface AudioNodeOption { id: string; label: string; bands: number }

export function MappingsDrawer({ play, mode, grid = false, pages = false, height, onResizeStart, open, onToggle, onUpdate, onRemove, onAddPair, onUpdatePair, onRemovePair, onRecord, audioNodes, nullLayers, layerRefs, addControlButton }: {
  play: PlayRecord;
  /** Edits to the record's own sources (their cards, Learn, + Map). */
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
  const [srcMore, setSrcMore] = useState<{ x: number; y: number } | null>(null);
  const [noteMap, setNoteMap] = useState(false);
  const [behavioursOpen, setBehavioursOpen] = useState(false);
  // "+ Map" (Play audit P6): one picker of every kind; the header's button or the empty state's.
  const [mapPicker, setMapPicker] = useState<{ asSheet: boolean; anchor: 'head' | 'empty' } | null>(null);
  const mapHeadRef = useRef<HTMLSpanElement>(null), mapEmptyRef = useRef<HTMLSpanElement>(null);
  const mapListId = useId();
  const learnOn = useLearnMode(s => s.on);
  const readers = useNodeGraphStore(s => s.play.audioReaders?.readers) ?? NO_READERS;
  useEffect(() => {
    if (!learnFor) return;
    void midiEngine.connectWebMidi({ retry: true });
    // A trigger row's Learn picks what fires it (key, note, click, OSC); every other Learn picks a source.
    const row = play.mappings.find(m => m.id === learnFor);
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
      onUpdate(learnFor, { source });
      setLearnFor(null);
    });
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [learnFor, onUpdate]);
  // A row's own Learn and the board's Learn mode don't listen at once.
  useEffect(() => { if (learnOn) setLearnFor(null); }, [learnOn]);
  useEffect(() => { if (learnFor) useLearnMode.getState().stop(); }, [learnFor]);
  // While a Learn runs, an unassigned CC row doesn't take the knob (lib/midiAutoLearn.ts).
  useEffect(() => (learnFor ? claimMidiListen() : undefined), [learnFor]);
  // A CC row without a knob takes the first CC that moves; the row flashes to say so.
  const [assigned, setAssigned] = useState<{ id: string; at: number } | null>(null);
  // The record's own sources too: a "Knob or fader (CC)" from "+ Map" takes the first knob that moves.
  const ccRows = useMemo(() => [...play.mappings, ...ownSources.map(d => ({ id: d.id, source: d.source }) as PlayMapping)], [play.mappings, ownSources]);
  const mappingsRef = useRef(ccRows);
  mappingsRef.current = ccRows;
  const waitingCc = ccRows.some(m => isUnassignedCc(m.source));
  useEffect(() => {
    if (!waitingCc) return;
    void midiEngine.connectWebMidi();
    return startMidiAutoLearn({
      mappings: () => mappingsRef.current,
      assign: (id, source) => {
        if (useNodeGraphStore.getState().play.mappings.some(m => m.id === id)) { onUpdate(id, { source }); setAssigned({ id, at: Date.now() }); }
        else onRecord(p => patchSource(p, id, { source }));
      },
    });
  }, [waitingCc, onUpdate, onRecord]);
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
  const learnTrigger = !!learnFor && play.mappings.find(m => m.id === learnFor)?.source.kind === 'trigger';
  const midi = midiEngine.webMidi();
  // Rows start folded to one line (source → control · range · curve, the meter and the switch);
  // one opened by hand stays open, remembered on this device (playUi's folded, mappingFoldKey).
  const folds = usePlayUi(s => s.folded);
  const isCollapsed = (id: string) => folds[mappingFoldKey(id)] !== false;
  const toggleRow = (id: string) => usePlayUi.getState().toggleFold(mappingFoldKey(id), !isCollapsed(id));
  const allCollapsed = play.mappings.length > 0 && play.mappings.every(m => isCollapsed(m.id));
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
      {(learnFor || learnOn || usesMidi(play)) && (
        <div style={{ margin: '4px 0 6px', padding: '6px 10px', borderRadius: radius.md, background: tk.bg.field }}>
          <MidiStatusChip />
        </div>
      )}
      {(usesHands(play) || ((learnFor || learnOn) && handFeed.getStatus() !== 'unsupported')) && (
        <div style={{ margin: '4px 0 6px', padding: '6px 10px', borderRadius: radius.md, background: tk.bg.field }}>
          {/* A setup that reads hands has Enable on the picture (HandsPill): one place for it. */}
          <HandsChip enable={!usesHands(play)} />
        </div>
      )}
      {/* The board's Learn mode says what it waits for over the controls (LearnModeBar), and here too. */}
      <LearnModeBar label={id => controlLabel(id) ?? 'That control'} />
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
  // The empty state names MIDI only once it's connected: nothing here asks for access (Play audit P6).
  const emptyBody = noControls
    ? 'Add a control first, then map an input onto it.'
    : `Map a knob, a key, the mouse, the sound or your hands onto the controls: pick one, or Learn and move it. ${midi.status === 'ready' && midi.inputs.length ? `Listening to ${midi.inputs.join(', ')}. ` : ''}Connecting Ableton, a controller, OSC or live audio for the first time? “Connect gear…” in the ⋯ walks you through it.`;
  const openMapPicker = (anchor: 'head' | 'empty') => setMapPicker(m => (m ? null : { asSheet: menuAsSheet(window.innerWidth, 'auto'), anchor }));
  const mapSections = useMemo(() => mapPickerSections(readers, !allSources, play.signals), [readers, allSources, play.signals]);
  /** A "+ Map" pick: Learn, a dialog, or a new source of the record and Map mode (click the controls it drives). */
  const pickMap = (v: string) => {
    setMapPicker(null);
    const p = parseMapPick(v);
    if (!p) return;
    const pro = () => { openProSheet('play.sources'); };
    // Only MIDI kinds and Learn ask for the browser's MIDI access (a MIDI kind on Free opens the Pro sheet instead).
    if (mapPickAsksMidi(v) && (p.kind === 'learn' || allSources)) void midiEngine.connectWebMidi({ retry: true });
    let source: PlaySource;
    let label = '';
    switch (p.kind) {
      case 'learn': useLearnMode.getState().start(); return;
      case 'behaviours': setBehavioursOpen(true); return;
      case 'readers': useReadersPanel.getState().show({ focus: '' }); return;
      case 'notes12': if (!allSources) { pro(); return; } setNoteMap(true); return;
      case 'random': {
        if (!allSources && sourceTypeNeedsPro('noise')) { pro(); return; }
        const r = RANDOM_SOURCES[p.index];
        source = { ...r.source, seed: r.source.kind === 'noise' ? Math.floor(Math.random() * 100000) : 0 } as PlaySource;
        label = r.label;
        break;
      }
      case 'signal':
        if (!allSources) { pro(); return; }
        source = signalSource(p.id);
        break;
      case 'type':
        if (!allSources && sourceTypeNeedsPro(p.type)) { pro(); return; }
        // From a blank start: a CC has no knob yet (the first one turned becomes it).
        source = sourceFromType(p.type, { kind: 'mouse', axis: 'x' }, play.controls[0]?.id ?? '', nullLayers[0]?.id ?? '', firstSensor(layerRefs), firstDataset());
        break;
    }
    let id = '';
    onRecord(rec => { const x = addFreeSource(rec, source); id = x.id; return x.play; });
    if (!id) return;
    // Its card opens (and its group), then Map mode: click each control it should drive.
    usePlayUi.getState().toggleFoldMany([sourceFoldKey(id), sourceGroupFoldKey(mappingGroupOf(source))], false);
    useMapMode.getState().start(id, label || sourceLabel(source, play.controls, layerRefs));
  };
  const mapAnchor = mapPicker?.anchor === 'empty' ? mapEmptyRef : mapHeadRef;
  const emptyState = (
    <div style={{ margin: '18px 4px', padding: '16px 14px', borderRadius: radius.lg, border: `1px dashed ${tk.border.strong}`, color: tk.text.muted, lineHeight: 1.5 }}>
      <div style={{ font: `600 12.5px ${fontFamily.ui}`, color: tk.text.secondary, marginBottom: 4 }}>Nothing mapped</div>
      {emptyBody}
      <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {noControls ? addControlButton : <span ref={mapEmptyRef} style={{ display: 'inline-flex' }}><Button size="sm" icon="plus" aria-haspopup="listbox" aria-expanded={mapPicker?.anchor === 'empty'} onClick={() => openMapPicker('empty')}>Map an input</Button></span>}
        {/* Or a ready-made one: pulse to the beat, mouse moves it, wander (Play audit P11). */}
        <BehavioursButton play={play} onChange={onRecord} />
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
          title="Drag to resize Sources"
          style={{ position: 'absolute', left: 0, right: 0, top: -4, height: 9, cursor: 'row-resize', zIndex: 2 }}
          onMouseEnter={e => ((e.currentTarget as HTMLDivElement).style.background = alpha(tk.accent.base, 0.25))}
          onMouseLeave={e => ((e.currentTarget as HTMLDivElement).style.background = 'transparent')}
        />
      )}
      <PanelHeader
        title="Sources"
        hint={headCount ? `${headCount}` : undefined}
        chevron={mode === 'drawer' ? (open ? 'down' : 'up') : undefined}
        onClick={mode === 'drawer' ? onToggle : undefined}
        extra={open && (
          <>
            {/* One row: the hands toggle, one "+ Map" (Play audit P6: Learn, MIDI, keys, mouse, audio, hands,
                LFO and beat, random, behaviours), and the ⋯ (Connect gear…, expand or collapse all). While
                Learn is on the button says so, and a click stops it. */}
            <ProLock feature="play.sources" badge={false}><HandsButton /></ProLock>
            <span ref={mapHeadRef} style={{ display: 'inline-flex' }}>
              {learnOn
                ? <Button size="sm" icon="spark" variant="primary" aria-pressed data-map-button="" title="Learning: click a control, then move a knob or press a key (Esc or click to stop)" onClick={() => useLearnMode.getState().stop()}>Learning</Button>
                : <Button size="sm" icon="plus" data-map-button="" disabled={noControls} aria-haspopup="listbox" aria-expanded={mapPicker?.anchor === 'head'}
                    title={noControls ? 'Add a control first' : 'Map an input onto the controls: Learn, MIDI, keys, the mouse, audio, hands, an LFO, random…'}
                    onClick={() => openMapPicker('head')}>Map</Button>}
            </span>
            {noteMap && <NoteClassMapDialog play={play} onRecord={onRecord} onClose={() => setNoteMap(false)} />}
            {behavioursOpen && <BehavioursDialog play={play} onChange={onRecord} onClose={() => setBehavioursOpen(false)}
              onAdded={ruleId => { setBehavioursOpen(false); toast.success('Behaviour added', { message: ruleId ? 'Its rule is on the Rules page; its sources are here.' : 'Its sources are here.' }); }} />}
            <IconButton icon="more" label="More: connect gear, expand or collapse all" onClick={e => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setSrcMore({ x: r.right - 240, y: r.bottom + 4 }); }} />
            {srcMore && <Menu x={srcMore.x} y={srcMore.y} minWidth={240} title="Sources" onClose={() => setSrcMore(null)} items={[
              { label: 'Connect gear…', icon: 'info', hint: 'Ableton, a MIDI controller, OSC or live audio, step by step', onSelect: () => setGuideOpen(true) },
              ...(play.mappings.length > 1 ? [{
                label: allCollapsed ? 'Expand all mappings' : 'Collapse all mappings', icon: allCollapsed ? 'chevD' as const : 'chevU' as const,
                onSelect: () => usePlayUi.getState().toggleFoldMany(play.mappings.map(m => mappingFoldKey(m.id)), !allCollapsed),
              }] : []),
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
            {play.mappings.length > 0 && <div style={grid ? PANEL_GRID_WIDE : undefined}>{play.mappings.map(m => rowFor(m, { collapsed: isCollapsed(m.id) }))}</div>}
          </> : (
            // The sources column: own sources and old mappings together, by kind, with a search.
            <SourceGroups sources={ownSources} mappings={play.mappings} words={sourceWords} gridStyle={grid ? PANEL_GRID_WIDE : undefined}
              renderItem={x => (x.kind === 'source' ? sourceCard(x.def) : rowFor(x.mapping, { collapsed: isCollapsed(x.mapping.id) }))} />
          )}
          {!!play.pairs?.length && (
            <PairMappingsSection play={play} grid={grid} audioNodes={audioNodes} layerRefs={layerRefs} onAdd={onAddPair} onUpdate={onUpdatePair} onRemove={onRemovePair} />
          )}
          {!play.midiFile && !pages && <MidiFileSlot />}
          {!pages && <ProLock feature="play.sources" style={{ display: 'block', width: '100%' }}><PadGridCard /></ProLock>}
          {/* The built-in signals (Signals: count, active, share), folded at the bottom: once the setup has a signal to count. */}
          {mode !== 'drawer' && !!play.signals?.length && <ProLock feature="play.sources" style={{ display: 'block', width: '100%' }}><BuiltInSignalsSection onRecord={onRecord} /></ProLock>}
        </div>
      )}
      {guideOpen && <ConnectGuide onClose={() => setGuideOpen(false)} />}
      {mapPicker && (
        <PickerPanel listId={mapListId} sections={mapSections} value="" ariaLabel="Map an input" title="Map an input" asSheet={mapPicker.asSheet} width={300}
          withSearch initialQuery="" searchPlaceholder="Search inputs" anchorRef={mapAnchor as unknown as RefObject<HTMLButtonElement | null>}
          onPick={pickMap} onClose={() => setMapPicker(null)} />
      )}
    </div>
  );
}

export const NO_READERS: AudioReader[] = [];

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
  // The control it drives, as a chip (the repeated CONTROL drop-down is gone, Play audit P7): click to drive another.
  const targetChip = <TargetChip control={control} controls={controls} onPick={retarget} />;
  const colourChannel = control?.kind === 'color' ? (
    <Select ariaLabel="Colour channel" value={m.channel === undefined ? 'all' : `${m.channel}`} options={COLOUR_CHANNELS} onChange={v => onUpdate({ channel: v === 'all' ? undefined : (parseInt(v, 10) as 0 | 1 | 2) })} height={26} />
  ) : null;

  if (collapsed) {
    return (
      <div data-mapping-id={m.id} style={{ ...frame, padding: '4px 10px 6px 8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 26 }}>
          {chevron}
          <button type="button" onClick={onToggle} title="Expand" style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6, border: 0, background: 'none', padding: 0, cursor: 'pointer', color: tk.text.primary, font: `500 12px ${fontFamily.ui}`, textAlign: 'left' }}>
            {waiting
              ? <MidiWaitChip title="This row has no knob yet: the first CC that moves on any device becomes its CC" />
              : <span style={{ flex: '0 1 auto', minWidth: 24, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 600 }} title={m.increment ? 'Increment' : undefined}>{m.increment ? summary : sourceLabel(m.source, controls, layerRefs)}</span>}
            <Icon name="chevR" size={12} style={{ color: tk.text.faint, flexShrink: 0 }} />
            <span style={{ flex: '1 1 0', minWidth: 24, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: tk.text.secondary }}>{control?.label ?? 'missing control'}</span>
          </button>
          {locked && <ProBadge title="This source needs Pro: kept, but it doesn't run on Free" />}
          <SoloButton kind="mapping" id={m.id} />
          <Toggle checked={m.enabled} onChange={enabled => onUpdate({ enabled })} />
        </div>
        {/* The second line: its range and curve ("0.05–0.7 · linear"), then the meter. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '2px 0 0 22px', minWidth: 0 }}>
          {!m.increment && control?.kind !== 'action' && (
            <span data-mapping-range="" style={{ flexShrink: 0, whiteSpace: 'nowrap', color: tk.text.faint, font: `500 10.5px ${fontFamily.mono}` }}>{mappingRangeText(m)}</span>
          )}
          <div style={{ flex: 1, minWidth: 0 }}><FedMeter feed={feed} curved curve={m.curve} curveY={m.curveY} on={m.enabled} margin="0" /></div>
        </div>
      </div>
    );
  }

  if (m.increment) {
    const inc = m.increment as PlayIncrement;
    return (
      <div data-mapping-id={m.id} style={{ ...frame, padding: '8px 10px' }}>
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
          {targetChip}
          {colourChannel}
          <span style={{ flex: 1 }} />
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
    <div data-mapping-id={m.id} style={{ ...frame, padding: '8px 10px' }}>
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
      {/* What it drives (a chip: click to retarget, Play audit P7), then the meter. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '6px 0 8px' }}>
        {targetChip}
        {colourChannel}
        <div style={{ flex: 1, minWidth: 40 }}><FedMeter feed={feed} curved curve={m.curve} curveY={m.curveY} on={m.enabled} margin="0" /></div>
      </div>
      <SourceOptions source={m.source} audioNodes={audioNodes} layerRefs={layerRefs} numStyle={numStyle} labelStyle={labelStyle} onChange={source => onUpdate({ source })} />
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

/**
 * What an open mapping drives, as a compact chip ("→ Radius ▾"): a click lists the
 * controls to drive instead (retarget). Replaces each mapping's CONTROL drop-down (Play audit P7).
 */
function TargetChip({ control, controls, onPick }: { control: PlayControl | undefined; controls: PlayControl[]; onPick: (id: string) => void }) {
  const tk = useTokens();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  return (
    <>
      <button type="button" data-target-chip="" aria-haspopup="menu" title="What it drives: click to drive another control"
        onClick={e => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setMenu({ x: r.left, y: r.bottom + 4 }); }}
        style={{ height: 24, padding: '0 6px 0 8px', border: 0, borderRadius: 6, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, minWidth: 0, maxWidth: '60%', flexShrink: 1,
          background: control ? alpha(tk.accent.base, 0.1) : alpha(tk.status.warning, 0.14), color: control ? tk.accent.text : tk.status.warningText, font: `600 11.5px ${fontFamily.ui}` }}>
        <span aria-hidden style={{ flexShrink: 0 }}>→</span>
        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{control?.label ?? 'missing control'}</span>
        <Icon name="chevD" size={12} style={{ flexShrink: 0, opacity: 0.7 }} />
      </button>
      {menu && <Menu x={menu.x} y={menu.y} minWidth={200} title="Drive another control" onClose={() => setMenu(null)} items={[
        { heading: 'Drive another control' },
        ...controls.map(c => ({ label: c.label, icon: (c.id === control?.id ? 'check' : 'sliders') as IconName, disabled: c.id === control?.id, onSelect: () => onPick(c.id) })),
      ]} />}
    </>
  );
}

/** A source in the detail window: a mapping's row, or a record source's card, with its own Learn. */
export function DetailSource({ id, play, update, audioNodes, nullLayers, layerRefs }: {
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
  // Folded by default to its header and one line (what it reads → what it drives); remembered when opened.
  const open = usePlayUi(st => st.folded[sourceFoldKey(s.id)] === false) || learning;
  const toggleOpen = () => usePlayUi.getState().toggleFold(sourceFoldKey(s.id), open);
  const drives = routes.map(r => play.controls.find(c => c.id === r.to)?.label ?? 'a missing control');
  return (
    <div data-source-card={s.id} data-folded={open ? undefined : ''} style={{ marginTop: 6, padding: open ? '8px 10px' : '6px 10px', borderRadius: radius.card, background: tk.bg.panel, boxShadow: `inset 0 0 0 1px ${mapping || learning ? tk.accent.base : tk.border.default}`, opacity: s.enabled ? 1 : 0.55 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: open ? 6 : 0 }}>
        <IconButton icon={open ? 'chevD' : 'chevR'} label={open ? 'Collapse source' : 'Expand source'} size="sm" tooltip={false} onClick={toggleOpen} style={{ marginLeft: -6 }} />
        <SourceDragHandle id={s.id} label={name} />
        <Field value={s.label ?? ''} placeholder={name} aria-label="Source name" onChange={e => set({ label: e.target.value || undefined })} height={24} style={{ flex: 1, minWidth: 0, font: `600 12px ${fontFamily.ui}` }} />
        <Button size="sm" icon="plus" variant={mapping ? 'primary' : 'secondary'} title="Map: then click each control it should drive" onClick={() => (mapping ? useMapMode.getState().stop() : useMapMode.getState().start(s.id, name))}>{mapping ? 'Done' : 'Map'}</Button>
        <Toggle checked={s.enabled} onChange={enabled => set({ enabled })} />
        <IconButton icon="popout" label="Open its details" size="sm" onClick={() => openDetail('source', s.id)} />
      </div>
      {!open && (
        <>
          <button type="button" onClick={toggleOpen} title="Expand" style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', minWidth: 0, margin: '2px 0 0', padding: '0 0 0 22px', border: 0, background: 'none', cursor: 'pointer', textAlign: 'left', font: `500 11.5px ${fontFamily.ui}`, color: tk.text.secondary }}>
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
              {sourceLabel(s.source, play.controls, layerRefs)} → {drives.length ? drives.join(', ') : 'nothing yet'}
            </span>
          </button>
          <FedMeter feed={feed} on={s.enabled} margin="4px 0 0 22px" />
        </>
      )}
      {open && <>
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
      </>}
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
