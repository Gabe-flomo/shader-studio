/**
 * DeviceChain — the selected track's devices, left to right, at the bottom of
 * the Arrangement view (docs/audio-engine.md, "The device chain"): its input
 * (MIDI, the computer keyboard, a send, keys to try it), its instrument (an
 * Audio Unit synth, the sample player, the Granulator), a Granulator's Sound
 * chain, its effects and the Listener (the audio readers' tap), then "+" to
 * add a device. Each device is a compact panel: its title, on/off (bypass),
 * its rack controls with their live values, the plug-in's window, Configure.
 * Effects and the Listener reorder by dragging (or the ‹ › buttons). On a
 * phone the chain scrolls sideways.
 *
 * MasterChain: the master's devices: the Listener on every track together,
 * the engine's output (desktop), and the page's Sound master chain (Finish →
 * Sound), which the browser's racks play through.
 */
import { useState, type DragEvent, type ReactNode } from 'react';
import { useTokens } from '../../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../../theme/tokens';
import { Button, IconButton } from '../../ui/Button';
import { Select } from '../../ui/Select';
import { Icon } from '../../ui/Icon';
import type { IconName } from '../../ui/iconPaths';
import { Menu, type MenuItem } from '../../ui/Menu';
import type { PlayRecord } from '../../../types/play';
import { AE_EFFECTS_MAX, AE_INST, patchSlot, setRackKeyboard, patchRack, readAuValue, type AeRack, type AeSlot, type PlayAudioEngine } from '../../../types/playAudioEngine';
import { AUDIO_FX_EFFECTS, MASTER_CHAIN, patchChain } from '../../../types/playAudioFx';
import { audioEngineHost, useEnginePrefs, useEngineUi } from '../../../lib/audioEngineHost';
import { ENGINE_MASTER, engineReaderInput } from '../../../lib/engineSound';
import { isTauri } from '../../../lib/midiTransport';
import { useCan } from '../../../lib/plan';
import { setReaderInput } from '../../../play/readerControls';
import { LISTENER, applyChainOrder, chainOrder, deviceChain, deviceControlSummary, reorderChain, type Device, type TrackRow } from '../../../play/engineView';
import { rackControlsOf } from '../../../play/rackControls';
import { usePlayUi, deviceFoldKey } from '../playUi';
import { withEngine } from './engineOps';
import { GrainChainRow, InputRow, Keys, Note, RackSpectrum, SendView, SlotView, SourceRow, useRackEdits } from './RackParts';
import { RackControlsStrip } from './RackControls';

type Change = (fn: (p: PlayRecord) => PlayRecord) => void;

const DRAG_TYPE = 'application/x-engine-device';

/**
 * One device: a titled panel in the chain. `folded`/`onToggleFold` (Task:
 * collapsible devices in a rack): folds it to the header alone, with
 * `summary` (a one-line readout of its rack controls) in place of `actions`.
 * Only for devices with their own header here (input, send, soundfx,
 * Listener); the instrument and effects fold through SlotView instead, since
 * they draw their own header inside `children`.
 */
function DevicePanel({ title, icon, color, width, children, grip, actions, dim = false, narrow, folded, onToggleFold, summary }: {
  title?: ReactNode; icon?: IconName; color?: string; width: number; children: ReactNode; grip?: ReactNode; actions?: ReactNode; dim?: boolean; narrow: boolean;
  folded?: boolean; onToggleFold?: () => void; summary?: string;
}) {
  const tk = useTokens();
  return (
    <section style={{ flex: `0 0 ${width}px`, width, maxWidth: narrow ? 'calc(100vw - 48px)' : undefined, minHeight: 0, maxHeight: '100%', display: 'flex', flexDirection: 'column', borderRadius: radius.md, background: tk.bg.panel,
      boxShadow: `inset 0 0 0 1px ${tk.border.default}`, overflow: 'hidden', opacity: dim ? 0.72 : 1 }}>
      {color && <span aria-hidden style={{ height: 3, flexShrink: 0, background: color }} />}
      {title !== undefined && (
        <header style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 6px 6px 8px', borderBottom: folded ? undefined : `1px solid ${tk.border.subtle}`, minWidth: 0 }}>
          {onToggleFold && <IconButton icon={folded ? 'chevR' : 'chevD'} size="sm" label={folded ? 'Expand' : 'Collapse to its name, on/off and a summary'} onClick={onToggleFold} />}
          {grip}
          {icon && <Icon name={icon} size={13} style={{ color: tk.text.faint, flexShrink: 0 }} />}
          <b onDoubleClick={onToggleFold} style={{ flex: folded ? '0 1 auto' : 1, minWidth: 0, font: `650 12px ${fontFamily.ui}`, color: tk.text.primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: onToggleFold ? 'pointer' : undefined }}>{title}</b>
          {folded && summary && <span title={summary} style={{ flex: 1, minWidth: 0, color: tk.text.faint, font: `10.5px ${fontFamily.ui}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{summary}</span>}
          {!folded && actions}
        </header>
      )}
      {!folded && <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '8px 9px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>{children}</div>}
    </section>
  );
}

function Grip({ label }: { label: string }) {
  const tk = useTokens();
  return <span title={label} aria-hidden style={{ cursor: 'grab', color: tk.text.faint, display: 'inline-flex', flexShrink: 0 }}><Icon name="grip" size={13} /></span>;
}

/** Where a dragged device lands: a thin gap between devices that lights up. */
function DropGap({ active, onDrop, onOver, narrow }: { active: boolean; onDrop: () => void; onOver: () => void; narrow: boolean }) {
  const tk = useTokens();
  return (
    <div aria-hidden onDragOver={(e: DragEvent) => { if (!e.dataTransfer.types.includes(DRAG_TYPE)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; onOver(); }}
      onDrop={(e: DragEvent) => { e.preventDefault(); onDrop(); }}
      style={{ flex: '0 0 auto', width: active ? 14 : narrow ? 6 : 8, alignSelf: 'stretch', borderRadius: 3, background: active ? alpha(tk.accent.base, 0.55) : 'transparent', transition: 'width 80ms, background 80ms' }} />
  );
}

export function DeviceChain({ rack, row, play, onChange, touch, narrow, onPick }: {
  rack: AeRack; row: TrackRow; play: PlayRecord; onChange: Change; touch: boolean; narrow: boolean; onPick: (want: 'instrument' | 'effect') => void;
}) {
  const tk = useTokens();
  const desktop = isTauri();
  const pluginsOk = useCan('audio.plugins');
  const native = desktop && pluginsOk;
  const edits = useRackEdits(rack, onChange);
  const errors = useEngineUi(s => s.errors);
  const rackError = errors[`${rack.id}/rack`];
  const listening = (play.audioReaders?.input ?? '') === engineReaderInput(rack.id);
  const devices = deviceChain(rack, { listening, listenAt: play.audioEngine?.listenAt, native });
  const order = chainOrder(devices);
  // Collapsible devices (Task: collapsible devices in a rack): remembered per device, "Collapse all / Expand all" in the rack header.
  const folded = usePlayUi(s => s.folded);
  const toggleFold = usePlayUi(s => s.toggleFold);
  const toggleFoldMany = usePlayUi(s => s.toggleFoldMany);
  const isFolded = (key: string) => !!folded[deviceFoldKey(rack.id, key)];
  const foldToggle = (key: string) => toggleFold(deviceFoldKey(rack.id, key), !isFolded(key));
  const deviceKeys = devices.map(d => d.key);
  const anyFolded = deviceKeys.some(isFolded);
  const summaryFor = (slot: AeSlot): string => deviceControlSummary(rackControlsOf(play, rack, slot).map(({ control }) => ({ label: control.label, value: readAuValue(play.audioEngine, control.target) ?? 0 })));
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const move = (key: string, to: number) => onChange(p => (p.audioEngine ? withEngine(p, applyChainOrder(p.audioEngine, rack.id, reorderChain(chainOrder(deviceChain(rack, { listening, listenAt: p.audioEngine.listenAt, native })), key, to))) : p));
  const drop = (to: number) => { const k = dragging; setDragging(null); setOver(null); if (k) move(k, to); };
  const stepBy = (key: string, by: -1 | 1) => { const i = order.indexOf(key); if (i >= 0) move(key, by < 0 ? i - 1 : i + 2); };
  const addListener = () => onChange(p => {
    const next = setReaderInput(p, engineReaderInput(rack.id));
    const ae: PlayAudioEngine | undefined = next.audioEngine ? { ...next.audioEngine } : undefined;
    if (ae) delete ae.listenAt;
    return ae ? { ...next, audioEngine: ae } : next;
  });
  const readersElsewhere = (() => {
    const input = play.audioReaders?.input ?? '';
    if (!input || listening) return '';
    if (input === engineReaderInput(ENGINE_MASTER)) return 'the master';
    const other = play.audioEngine?.racks.find(r => engineReaderInput(r.id) === input);
    return other ? other.name : 'another sound';
  })();
  const addMenu = (x: number, y: number) => setMenu({
    x, y, items: [
      ...(!rack.instrument && !rack.source ? [{ label: 'Instrument…', icon: 'piano' as IconName, hint: 'An Audio Unit synth, the sample player or the Granulator', onSelect: () => onPick('instrument') }] : []),
      { label: 'Audio Unit effect…', icon: 'wave', disabled: rack.effects.length >= AE_EFFECTS_MAX, hint: desktop ? 'After the instrument: delay, reverb, filter…' : 'Kept here; heard in the desktop app on a Mac', onSelect: () => onPick('effect') },
      { label: 'Listener (audio readers)', icon: 'target', disabled: listening, hint: listening ? 'Already on this track' : readersElsewhere ? `Moves the readers here from ${readersElsewhere}` : 'Readers here drive controls from this track’s sound', onSelect: addListener },
      ...(rack.instrument?.kind === 'granulator' ? [{ label: 'Sound effects (Finish → Sound)…', icon: 'sliders' as IconName, onSelect: () => { usePlayUi.getState().setFinishView('sound'); usePlayUi.getState().setTab('finish'); } }] : []),
    ],
  });

  const draggable = (key: string) => ({
    draggable: !touch,
    onDragStart: (e: DragEvent) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData(DRAG_TYPE, key); setDragging(key); },
    onDragEnd: () => { setDragging(null); setOver(null); },
  });

  const renderDevice = (d: Device): ReactNode => {
    switch (d.kind) {
      case 'input':
        return (
          <DevicePanel key="input" narrow={narrow} width={narrow ? 300 : 300} title={rack.source ? 'Sound in' : 'MIDI in'} icon="keyboard" color={row.color}
            folded={isFolded('input')} onToggleFold={() => foldToggle('input')}>
            {rackError && <Note tone="bad">{rackError}</Note>}
            {!rack.source && <InputRow rack={rack} onPatch={o => edits.patch(o)} onKeyboard={on => { audioEngineHost.releaseHeld(rack.id); edits.edit(ae => setRackKeyboard(ae, rack.id, on)); }} touch={touch} />}
            {desktop && <SourceRow rack={rack} play={play} onPatch={o => { audioEngineHost.releaseHeld(rack.id); edits.edit(ae => patchRack(ae, rack.id, r => ({ ...r, ...o, ...(o.source ? { keyboard: false } : {}) }))); }} />}
            {!rack.source && <Keys rackId={rack.id} touch={touch} />}
          </DevicePanel>
        );
      case 'send':
        return (
          <DevicePanel key="send" narrow={narrow} width={280} title="Send" icon="import" folded={isFolded('send')} onToggleFold={() => foldToggle('send')}>
            <SendView rack={rack} play={play} />
          </DevicePanel>
        );
      case 'instrument': {
        if (!d.slot) {
          return (
            <DevicePanel key="inst" narrow={narrow} width={220} title="Instrument" icon="piano">
              <Note>No instrument yet. {desktop ? 'An Audio Unit synth, the sample player or the Granulator.' : 'The sample player or the Granulator (Audio Unit synths play in the desktop app).'}</Note>
              <div><Button size="sm" variant="primary" icon="plus" onClick={() => onPick('instrument')}>Choose an instrument…</Button></div>
            </DevicePanel>
          );
        }
        const w = d.slot.kind === 'granulator' ? 380 : d.slot.kind === 'sampler' ? 340 : 290;
        return (
          <DevicePanel key="inst" narrow={narrow} width={w}>
            <SlotView rack={rack} slot={d.slot} play={play} onChange={onChange} touch={touch} desktop={desktop} pluginsOk={pluginsOk}
              onReplace={() => onPick('instrument')} onRemove={() => edits.removeSlot(AE_INST)}
              folded={isFolded(AE_INST)} onToggleFold={() => foldToggle(AE_INST)} summary={summaryFor(d.slot)}>
              <RackControlsStrip rack={rack} play={play} onChange={onChange} touch={touch} only={AE_INST} />
            </SlotView>
          </DevicePanel>
        );
      }
      case 'soundfx':
        return (
          <DevicePanel key="soundfx" narrow={narrow} width={240} title="Sound effects" icon="sliders" folded={isFolded('soundfx')} onToggleFold={() => foldToggle('soundfx')}>
            <GrainChainRow rack={rack} play={play} />
            <Note>A Granulator plays in the page’s own audio: this chain (Finish → Sound) shapes it.</Note>
          </DevicePanel>
        );
      case 'effect': {
        const i = order.indexOf(d.key);
        return (
          <div key={d.key} {...draggable(d.key)} style={{ display: 'flex', maxHeight: '100%', minHeight: 0 }}>
            <DevicePanel narrow={narrow} width={280} dim={!d.heard}>
              <SlotView rack={rack} slot={d.slot} play={play} onChange={onChange} touch={touch} desktop={desktop} pluginsOk={pluginsOk}
                grip={!touch ? <Grip label="Drag to move it in the chain" /> : undefined}
                first={i === 0} last={i === order.length - 1} onMove={by => stepBy(d.key, by)}
                onBypass={() => edits.edit(ae => patchSlot(ae, rack.id, d.slot.id, { bypass: !d.slot.bypass }))}
                onRemove={() => edits.removeSlot(d.slot.id)}
                folded={isFolded(d.key)} onToggleFold={() => foldToggle(d.key)} summary={summaryFor(d.slot)}>
                <RackControlsStrip rack={rack} play={play} onChange={onChange} touch={touch} only={d.slot.id} />
                {!d.heard && !d.slot.bypass && <Note>{rack.instrument?.kind === 'granulator' && !rack.source ? 'Not heard after a Granulator: its Sound effects shape it.' : 'Heard in the desktop app on a Mac; kept here.'}</Note>}
              </SlotView>
            </DevicePanel>
          </div>
        );
      }
      case 'listener': {
        const i = order.indexOf(LISTENER);
        const listenerFolded = isFolded(LISTENER);
        return (
          <div key="listener" {...draggable(LISTENER)} style={{ display: 'flex', maxHeight: '100%', minHeight: 0 }}>
            <DevicePanel narrow={narrow} width={300} title="Listener" icon="target"
              grip={!touch ? <Grip label="Drag to move the Listener between effects" /> : undefined}
              folded={listenerFolded} onToggleFold={() => foldToggle(LISTENER)}
              actions={<>
                <IconButton icon="chevL" size="sm" label="Earlier in the chain" disabled={i <= 0} onClick={() => stepBy(LISTENER, -1)} />
                <IconButton icon="chevR" size="sm" label="Later in the chain" disabled={i >= order.length - 1} onClick={() => stepBy(LISTENER, 1)} />
                <IconButton icon="close" size="sm" label="Remove the Listener (the readers go back to the live input)" onClick={() => onChange(p => setReaderInput(p, ''))} />
              </>}>
              <RackSpectrum id={rack.id} name={rack.name} play={play} onChange={onChange} />
              <Note>{d.exact
                ? d.at >= rack.effects.length ? 'Reads the track after its whole chain.' : 'Reads here: nothing heard comes after it.'
                : 'Reads after the whole chain for now: the desktop engine taps a track at its end (a tap between effects is to come).'}</Note>
            </DevicePanel>
          </div>
        );
      }
    }
  };

  // Drop gaps sit before each movable device and after the last (indices into `order`).
  const items: ReactNode[] = [];
  let k = 0;
  for (const d of devices) {
    if (d.kind === 'effect' || d.kind === 'listener') {
      const at = k++;
      if (dragging) items.push(<DropGap key={`gap${at}`} narrow={narrow} active={over === at} onOver={() => setOver(at)} onDrop={() => drop(at)} />);
      else items.push(<span key={`sp${at}`} style={{ flex: '0 0 8px' }} />);
    } else if (items.length) items.push(<span key={`sp-${d.key}`} style={{ flex: '0 0 8px' }} />);
    items.push(renderDevice(d));
  }
  if (dragging) items.push(<DropGap key="gapEnd" narrow={narrow} active={over === order.length} onOver={() => setOver(order.length)} onDrop={() => drop(order.length)} />);
  else items.push(<span key="spEnd" style={{ flex: '0 0 8px' }} />);

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: tk.bg.subtle }}>
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px' }}>
        <span aria-hidden style={{ width: 10, height: 10, borderRadius: 2, background: row.color }} />
        <b style={{ font: `650 12px ${fontFamily.ui}`, color: tk.text.primary }}>{rack.name}</b>
        <span style={{ color: tk.text.faint, font: `11px ${fontFamily.ui}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
          {devices.length - 1} device{devices.length === 2 ? '' : 's'}{!touch ? ' · drag effects and the Listener to reorder' : ''}
        </span>
        <span style={{ flex: 1 }} />
        <Button size="sm" variant="ghost" icon={anyFolded ? 'chevD' : 'chevR'}
          onClick={() => toggleFoldMany(deviceKeys.map(k => deviceFoldKey(rack.id, k)), !anyFolded)}>
          {anyFolded ? 'Expand all' : 'Collapse all'}
        </Button>
      </div>
      <div role="list" aria-label={`${rack.name}’s devices`}
        style={{ flex: 1, minHeight: narrow ? undefined : 0, display: 'flex', alignItems: narrow ? 'flex-start' : 'stretch', overflowX: 'auto', overflowY: 'hidden', padding: '0 12px 10px', height: narrow ? 460 : undefined, scrollSnapType: narrow ? 'x proximity' : undefined }}>
        {items}
        <button type="button" onClick={e => { const r = e.currentTarget.getBoundingClientRect(); addMenu(r.left, r.top); }} title="Add a device: an instrument, an Audio Unit effect or a Listener"
          style={{ flex: '0 0 56px', alignSelf: 'stretch', minHeight: 80, borderRadius: radius.md, border: `1.5px dashed ${tk.border.strong}`, background: 'transparent', color: tk.text.muted, cursor: 'pointer', display: 'grid', placeItems: 'center' }}>
          <span style={{ display: 'grid', justifyItems: 'center', gap: 4, font: `600 10.5px ${fontFamily.ui}` }}><Icon name="plus" size={16} />Add</span>
        </button>
        <span style={{ flex: '0 0 12px' }} />
      </div>
      {menu && <Menu x={menu.x} y={menu.y} items={menu.items} title="Add a device" onClose={() => setMenu(null)} />}
    </div>
  );
}

// ── The master ──────────────────────────────────────────────────────────────

export function MasterChain({ play, onChange, narrow }: { play: PlayRecord; onChange: Change; touch: boolean; narrow: boolean }) {
  const tk = useTokens();
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const desktop = isTauri();
  const prefs = useEnginePrefs();
  const outputs = useEngineUi(s => s.outputs);
  const input = engineReaderInput(ENGINE_MASTER);
  const listening = (play.audioReaders?.input ?? '') === input;
  const chain = play.audioFx?.chains[MASTER_CHAIN];
  const effects = chain?.effects ?? [];
  const openSound = (id?: string) => {
    if (id) usePlayUi.getState().revealAudioFx(id);
    else { usePlayUi.getState().setFinishView('sound'); usePlayUi.getState().setTab('finish'); }
  };
  const toggleFx = (id: string) => onChange(p => ({ ...p, audioFx: patchChain(p.audioFx, MASTER_CHAIN, c => ({ ...c, effects: c.effects.map(e => (e.id === id ? { ...e, enabled: !e.enabled } : e)) })) }));
  const items: ReactNode[] = [];
  if (listening) {
    items.push(
      <DevicePanel key="listener" narrow={narrow} width={300} title="Listener" icon="target"
        actions={<IconButton icon="close" size="sm" label="Remove the Listener (the readers go back to the live input)" onClick={() => onChange(p => setReaderInput(p, ''))} />}>
        <RackSpectrum id={ENGINE_MASTER} name="Master" play={play} onChange={onChange} />
        <Note>Every track together (their sounds summed). {desktop ? 'Before the engine’s volume.' : ''}</Note>
      </DevicePanel>,
    );
  }
  if (desktop) {
    items.push(
      <DevicePanel key="out" narrow={narrow} width={260} title="Output" icon="wave">
        <Select ariaLabel="Output device" value={String(prefs.output)} height={28} onChange={v => prefs.set({ output: Number(v) })}
          options={[{ value: '0', label: 'System output' }, ...outputs.map(o => ({ value: String(o.id), label: `${o.name}${o.default ? ' (default)' : ''}` })), ...(prefs.output && !outputs.some(o => o.id === prefs.output) ? [{ value: String(prefs.output), label: 'A device not connected now' }] : [])]} />
        <Note>The engine’s volume and mute are on the Master track’s header. This device’s settings, not the setup’s.</Note>
        <div><Button size="sm" variant="ghost" icon="rebuild" onClick={() => void audioEngineHost.refreshOutputs()}>Refresh devices</Button></div>
      </DevicePanel>,
    );
  }
  for (const e of effects) {
    const def = AUDIO_FX_EFFECTS[e.kind];
    items.push(
      <DevicePanel key={e.id} narrow={narrow} width={220} title={def?.label ?? e.kind} icon="sliders" dim={!e.enabled || chain?.on === false}
        actions={<IconButton icon="bypass" size="sm" active={e.enabled} label={e.enabled ? 'On: turn it off' : 'Off: turn it on'} onClick={() => toggleFx(e.id)} />}>
        <Note>{def?.summary}</Note>
        <div><Button size="sm" variant="ghost" icon="sliders" onClick={() => openSound(e.id)}>Edit in Finish → Sound</Button></div>
      </DevicePanel>,
    );
  }
  const addMenu = (x: number, y: number) => setMenu({
    x, y, items: [
      { label: 'Listener (audio readers)', icon: 'target', disabled: listening, hint: 'Readers on every track together', onSelect: () => onChange(p => setReaderInput(p, input)) },
      { label: 'A Sound effect (Finish → Sound)…', icon: 'sliders', hint: desktop ? 'Shapes the page’s sound and the browser racks (Audio Units go straight to the output)' : 'Shapes the page’s sound, the racks with it', onSelect: () => openSound() },
    ],
  });
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: tk.bg.subtle }}>
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px' }}>
        <Icon name="wave" size={12} style={{ color: tk.text.muted }} />
        <b style={{ font: `650 12px ${fontFamily.ui}`, color: tk.text.primary }}>Master</b>
        <span style={{ color: tk.text.faint, font: `11px ${fontFamily.ui}` }}>
          {desktop ? 'Audio Unit tracks play straight to the output; the Sound master chain shapes the page and the browser racks.' : 'The tracks play through the page’s sound: its master chain (Finish → Sound) is here.'}
        </span>
      </div>
      <div role="list" aria-label="The master’s devices" style={{ flex: 1, minHeight: narrow ? undefined : 0, display: 'flex', alignItems: 'stretch', gap: 8, overflowX: 'auto', padding: '0 12px 10px', maxHeight: narrow ? 420 : undefined }}>
        {items}
        {!items.length && <span style={{ alignSelf: 'center', color: tk.text.faint, font: `11.5px ${fontFamily.ui}` }}>No devices on the master yet.</span>}
        <button type="button" onClick={e => { const r = e.currentTarget.getBoundingClientRect(); addMenu(r.left, r.top); }} title="Add a Listener or a Sound effect"
          style={{ flex: '0 0 56px', alignSelf: 'stretch', minHeight: 80, borderRadius: radius.md, border: `1.5px dashed ${tk.border.strong}`, background: 'transparent', color: tk.text.muted, cursor: 'pointer', display: 'grid', placeItems: 'center' }}>
          <span style={{ display: 'grid', justifyItems: 'center', gap: 4, font: `600 10.5px ${fontFamily.ui}` }}><Icon name="plus" size={16} />Add</span>
        </button>
      </div>
      {menu && <Menu x={menu.x} y={menu.y} items={menu.items} title="Add to the master" onClose={() => setMenu(null)} />}
    </div>
  );
}
