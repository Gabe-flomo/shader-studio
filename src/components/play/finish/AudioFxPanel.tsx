/**
 * AudioFxPanel — the Finish tab's Sound view: an effect chain per sound (the
 * master bus, the MIDI synth, audio layers' songs, Video layers' sound, Audio
 * Input nodes' songs), each an ordered stack of cards like the picture's
 * Finish stack. See docs/audio-effects.md.
 *
 * Each card: on/off, fold, drag or move to reorder, reset, remove. Every
 * number is a ruler with a + that makes it a control
 * (`audiofx:<chain>:<effect>::<key>`), so the mouse, audio, LFOs or hands
 * can drive it; the chain glides to it (no clicks). A chain can be saved as
 * a preset on this device and loaded onto any sound.
 */
import { useEffect, useMemo, useState } from 'react';
import { useTokens } from '../../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../../theme/tokens';
import { IconButton } from '../../ui/Button';
import { Toggle, Segmented } from '../../ui/Choice';
import { Select } from '../../ui/Select';
import { RulerSlider } from '../../ui/RulerSlider';
import { Tooltip } from '../../ui/Tooltip';
import { Icon } from '../../ui/Icon';
import { Menu, type MenuItem } from '../../ui/Menu';
import type { IconName } from '../../ui/iconPaths';
import { askChoice, askConfirm, askText } from '../../ui/dialogStore';
import { isTauri } from '../../../lib/midiTransport';
import { can, openProSheet } from '../../../lib/plan';
import { engineId, rackFromPads, withEngine } from '../engine/engineOps';
import type { DrumPadLayer } from '../../../types/playLayers';
import { toast } from '../../ui/toastStore';
import { moveItem } from '../../../lib/reorder';
import { playId } from '../../../play/playControls';
import { usePlayUi } from '../playUi';
import { useNodeGraphStore } from '../../../store/useNodeGraphStore';
import type { PlayControl, PlayRecord } from '../../../types/play';
import {
  AUDIO_FX_EFFECTS, AUDIO_FX_KINDS, AUDIO_FX_PRESETS_CHANGED, MASTER_CHAIN, SYNTH_CHAIN, audioFxTarget, deleteAudioFxPreset, emptyAudioFx, emptyChain,
  layerChainId, loadAudioFxPresets, newAudioFxEffect, nodeChainId, patchChain, rackChainId, presetEffects, saveAudioFxPreset, tidyAudioFx,
  type AudioFxChain, type AudioFxEffect, type AudioFxKind, type PlayAudioFx,
} from '../../../types/playAudioFx';
import { AF_SYNC, afShownParams, type AfParam } from '../../../play/kit/audioFx.js';

const OPTION_LABELS: Record<string, string> = {
  lowpass: 'Low-pass', highpass: 'High-pass', bandpass: 'Band-pass', notch: 'Notch',
  room: 'Room', hall: 'Hall', plate: 'Plate',
  soft: 'Soft (tanh)', hard: 'Hard clip', fold: 'Wavefold', tube: 'Tube (asymmetric)', bitcrush: 'Bitcrush',
  off: 'Off (ms)',
};

interface Source { id: string; label: string; icon: IconName; note: string }

export function AudioFxPanel({ play, onChange, touch, wide = false }: {
  play: PlayRecord;
  onChange: (fn: (p: PlayRecord) => PlayRecord) => void;
  touch: boolean;
  wide?: boolean;
}) {
  const tk = useTokens();
  const nodes = useNodeGraphStore(s => s.nodes);
  const fx = play.audioFx ?? emptyAudioFx();
  const exposed = useMemo(() => new Set(play.controls.map(c => c.target)), [play.controls]);
  const [presets, setPresets] = useState(loadAudioFxPresets);
  useEffect(() => {
    const on = () => setPresets(loadAudioFxPresets());
    window.addEventListener(AUDIO_FX_PRESETS_CHANGED, on);
    return () => window.removeEventListener(AUDIO_FX_PRESETS_CHANGED, on);
  }, []);

  // Every sound there is, then chains whose sound has gone (kept until removed).
  const sources: Source[] = useMemo(() => {
    const out: Source[] = [
      { id: MASTER_CHAIN, label: 'Master', icon: 'sliders', note: 'Everything the app plays, after each sound’s own chain: songs, video sound, the synth, the test loop.' },
      { id: SYNTH_CHAIN, label: 'MIDI synth', icon: 'piano', note: 'The tone synth that plays what the MIDI engine hears (turn it on in the MIDI settings).' },
    ];
    for (const l of play.layers) {
      if (l.kind === 'audio' && (l as { input?: string }).input === 'file') out.push({ id: layerChainId(l.id), label: l.label, icon: 'wave', note: 'This audio layer’s song.' });
      if (l.kind === 'video' && (l as { sound?: string }).sound !== 'off') out.push({ id: layerChainId(l.id), label: l.label, icon: 'camera', note: 'This Video layer’s sound (before its volume).' });
      if (l.kind === 'drumpad') out.push({ id: layerChainId(l.id), label: l.label, icon: 'grid', note: 'This Drum pad layer’s pads, all through one chain (before its volume).' });
    }
    for (const n of nodes) if (n.type === 'audioInput') out.push({ id: nodeChainId(n.id), label: `Audio Input · ${n.id}`, icon: 'wave', note: 'This Audio Input node’s song.' });
    for (const r of play.audioEngine?.racks ?? []) if (r.instrument?.kind === 'granulator' && !r.source) out.push({ id: rackChainId(r.id), label: `${r.name} · Granulator`, icon: 'piano', note: 'This Audio engine rack’s Granulator (before the rack’s volume).' });
    for (const id of Object.keys(fx.chains)) if (!out.some(s => s.id === id)) out.push({ id, label: `${id} (not here)`, icon: 'warning', note: 'Its sound isn’t in this setup any more: remove the chain, or bring the sound back.' });
    return out;
  }, [play.layers, play.audioEngine, nodes, fx.chains]);

  const setFx = (fn: (f: PlayAudioFx) => PlayAudioFx) => onChange(p => {
    const next = tidyAudioFx(fn(p.audioFx ?? emptyAudioFx()));
    // Controls on an effect that went go with it (and their mappings).
    const ids = new Set(Object.entries(next?.chains ?? {}).flatMap(([cid, c]) => c.effects.map(e => `audiofx:${cid}:${e.id}`)));
    const gone = p.controls.filter(c => c.target.startsWith('audiofx:') && !ids.has(c.target.slice(0, c.target.lastIndexOf('::')))).map(c => c.id);
    const out: PlayRecord = { ...p, audioFx: next };
    if (!next) delete out.audioFx;
    if (gone.length) { const g = new Set(gone); out.controls = p.controls.filter(c => !g.has(c.id)); out.mappings = p.mappings.filter(m => !g.has(m.controlId)); }
    return out;
  });
  const setChain = (chainId: string, fn: (c: AudioFxChain) => AudioFxChain) => setFx(f => patchChain(f, chainId, fn));
  const expose = (chainId: string, e: AudioFxEffect, p: AfParam, source: string) => onChange(r => {
    const target = audioFxTarget(chainId, e.id, p.key);
    if (r.controls.some(c => c.target === target)) return r;
    const control: PlayControl = { id: playId('ctl'), target, kind: 'float', label: `${source} · ${AUDIO_FX_EFFECTS[e.kind].label} · ${p.label}`, min: p.min, max: p.max, ...(p.step ? { step: p.step } : {}) };
    toast.success(`${control.label} is a control`, { message: 'Map a source onto it in Mappings (the mouse, audio, an LFO…).', action: { label: 'Show', onClick: () => usePlayUi.getState().setTab('controls') } });
    return { ...r, controls: [...r.controls, control] };
  });

  // "+ Audio Unit effect" (desktop): Audio Units run in the Audio engine, on its racks. A Drum pad layer's pads can play
  // there (a rack with its samples that follows its hits); the page's other sounds can't pass through it yet.
  const audioUnitFor = async (chainId: string) => {
    if (!can('audio.engine') || !can('audio.plugins')) { openProSheet('audio.plugins'); return; }
    const layer = chainId.startsWith('layer:') ? play.layers.find(l => l.id === chainId.slice(6)) : undefined;
    if (layer?.kind === 'drumpad') {
      const pads = layer as DrumPadLayer;
      const existing = play.audioEngine?.racks.find(r => r.pads === pads.id);
      const pick = await askChoice('Audio Unit effects play in the Audio engine', [
        { id: 'cancel', label: 'Not now', variant: 'ghost' },
        { id: 'engine', label: existing ? 'Show its rack' : 'Play the pads in the engine', variant: 'primary' },
      ], { message: existing
        ? `${pads.label} already plays in the Audio engine (${existing.name}). Add Audio Unit effects on that rack.`
        : `A rack with ${pads.label}’s samples follows its hits (pad 1 is C2), so Audio Unit effects on that rack shape them. The layer’s own sound is turned down (its Volume, which you can turn back up) so you hear the engine.` });
      if (pick !== 'engine') return;
      if (!existing) {
        onChange(p => {
          const racks = p.audioEngine?.racks ?? [];
          const next = withEngine(p, { racks: [...racks, rackFromPads(engineId('rk'), pads, racks)] });
          return { ...next, layers: next.layers.map(l => (l.id === pads.id ? { ...l, volume: 0 } as typeof l : l)) };
        });
      }
      usePlayUi.getState().setTab('engine');
      return;
    }
    const pick = await askChoice('Audio Unit effects play in the Audio engine', [
      { id: 'cancel', label: 'Not now', variant: 'ghost' },
      { id: 'engine', label: 'Open the Audio engine', variant: 'primary' },
    ], { message: 'Audio Units run in the desktop app’s Audio engine, on its racks: an instrument (a synth or the sample player) and its effects. This sound plays in the page and can’t pass through them yet. Put the sound in the Library’s Sounds and play it from a rack’s sample player, or use the built-in effects here.' });
    if (pick === 'engine') usePlayUi.getState().setTab('engine');
  };

  const [presetMenu, setPresetMenu] = useState<{ x: number; y: number; chainId: string } | null>(null);
  const presetItems = (chainId: string): MenuItem[] => {
    const chain = fx.chains[chainId];
    return [
      { label: 'Save chain as preset…', icon: 'save', disabled: !chain?.effects.length, onSelect: () => { void (async () => {
        const name = await askText('Save the chain as a preset', { label: 'Name', initial: 'My sound', confirmLabel: 'Save preset' });
        if (!name?.trim() || !chain) return;
        saveAudioFxPreset(name.trim(), chain);
        toast.success(`Saved “${name.trim()}”`, { message: 'Load it onto any sound from Presets.' });
      })(); } },
      ...presets.flatMap((pr): MenuItem[] => [
        'separator',
        { heading: `${pr.name} · ${pr.chain.effects.map(e => AUDIO_FX_EFFECTS[e.kind].label).join(', ')}`.slice(0, 90) },
        { label: 'Replace chain', icon: 'import', onSelect: () => setChain(chainId, c => ({ ...c, on: true, effects: presetEffects(pr) })) },
        { label: 'Add to chain', icon: 'plus', onSelect: () => setChain(chainId, c => ({ ...c, on: true, effects: [...c.effects, ...presetEffects(pr)] })) },
        { label: 'Delete', icon: 'trash', danger: true, onSelect: () => { void askConfirm(`Delete the preset “${pr.name}”?`, { message: 'Sounds that loaded it keep their chains.', confirmLabel: 'Delete', danger: true }).then(ok => { if (ok) deleteAudioFxPreset(pr.id); }); } },
      ]),
    ];
  };

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '8px 12px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', margin: '2px 0 8px' }}>
        <Tooltip label="What the readers hear" description="Audio readers, audio layers and Audio Input uniforms read each sound after its effects (so a filter sweep shows in them), or before." placement="bottom">
          <span style={{ color: tk.text.faint, font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.04em', textTransform: 'uppercase', cursor: 'help' }}>Readers hear</span>
        </Tooltip>
        <Segmented size="sm" ariaLabel="What the readers hear" value={fx.analyse === 'pre' ? 'pre' : 'post'} onChange={v => setFx(f => ({ ...f, analyse: v === 'pre' ? 'pre' : undefined }))}
          options={[{ value: 'post', label: 'After effects' }, { value: 'pre', label: 'Before' }]} />
      </div>
      <div style={wide ? { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(380px, 100%), 1fr))', gap: 10, alignItems: 'start' } : { display: 'flex', flexDirection: 'column', gap: 10 }}>
        {sources.map(src => (
          <ChainCard
            key={src.id}
            source={src}
            chain={fx.chains[src.id]}
            touch={touch}
            exposed={exposed}
            onChain={fn => setChain(src.id, fn)}
            onRemoveChain={() => setFx(f => { const chains = { ...f.chains }; delete chains[src.id]; return { ...f, chains }; })}
            onExpose={(e, p) => expose(src.id, e, p, src.label)}
            onPresets={ev => { const r = (ev.currentTarget as HTMLElement).getBoundingClientRect(); setPresetMenu({ x: r.left, y: r.bottom + 4, chainId: src.id }); }}
            onAudioUnit={isTauri() ? () => void audioUnitFor(src.id) : undefined}
          />
        ))}
      </div>
      <div style={{ marginTop: 10, color: tk.text.faint, font: `11px/1.45 ${fontFamily.ui}` }}>
        Effects run top to bottom, each sound’s chain before the master’s. They play live, go into recordings and rendered takes (following what the take recorded), and into websites. Nothing sounds until you press play.
      </div>
      {presetMenu && <Menu x={presetMenu.x} y={presetMenu.y} items={presetItems(presetMenu.chainId)} onClose={() => setPresetMenu(null)} title="Chain presets" minWidth={230} />}
    </div>
  );
}

function ChainCard({ source, chain, touch, exposed, onChain, onRemoveChain, onExpose, onPresets, onAudioUnit }: {
  source: Source;
  chain: AudioFxChain | undefined;
  touch: boolean;
  exposed: Set<string>;
  onChain: (fn: (c: AudioFxChain) => AudioFxChain) => void;
  onRemoveChain: () => void;
  onExpose: (e: AudioFxEffect, p: AfParam) => void;
  onPresets: (ev: React.MouseEvent) => void;
  /** The desktop app: "+ Audio Unit effect…" (the Audio engine). */
  onAudioUnit?: () => void;
}) {
  const tk = useTokens();
  const c = chain ?? emptyChain();
  const gone = source.icon === 'warning';
  const add = (kind: string) => {
    if (kind === '__au') { onAudioUnit?.(); return; }
    if (!AUDIO_FX_EFFECTS[kind as AudioFxKind]) return;
    const e = newAudioFxEffect(kind as AudioFxKind);
    onChain(x => ({ ...x, on: true, effects: [...x.effects, e] }));
    usePlayUi.getState().revealAudioFx(e.id);
  };
  return (
    <div style={{ borderRadius: radius.md, border: `1px solid ${tk.border.subtle}`, padding: 8, background: alpha(tk.bg.panel, 0.5) }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <Icon name={source.icon} size={14} style={{ color: c.effects.length && c.on ? tk.accent.base : tk.text.faint, flexShrink: 0 }} />
        <Tooltip label={source.label} description={source.note} placement="top">
          <span style={{ flex: 1, minWidth: 80, color: tk.text.primary, font: `650 12.5px ${fontFamily.ui}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'help' }}>{source.label}</span>
        </Tooltip>
        {c.effects.length > 0 && <Toggle checked={c.on} onChange={on => onChain(x => ({ ...x, on }))} label="On" />}
        <IconButton icon="presets" size="sm" label="Chain presets: save this chain, or load one" onClick={onPresets} />
        {gone
          ? <IconButton icon="trash" size="sm" label="Remove this chain" onClick={onRemoveChain} />
          : <div style={{ minWidth: 130 }}>
              <Select ariaLabel={`Add an effect to ${source.label}`} value="" height={26} onChange={add}
                options={[{ value: '', label: '+ Add effect' }, ...AUDIO_FX_KINDS.map(k => ({ value: k, label: AUDIO_FX_EFFECTS[k].label })), ...(onAudioUnit ? [{ value: '__au', label: '+ Audio Unit effect…' }] : [])]} />
            </div>}
      </div>
      {c.effects.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
          {c.effects.map((e, i) => (
            <EffectCard
              key={e.id}
              chainId={source.id}
              effect={e}
              index={i}
              count={c.effects.length}
              dimmed={!c.on}
              touch={touch}
              exposed={exposed}
              onPatch={change => onChain(x => ({ ...x, effects: x.effects.map(y => (y.id === e.id ? { ...y, ...change } as AudioFxEffect : y)) }))}
              onReset={() => onChain(x => ({ ...x, effects: x.effects.map(y => (y.id === e.id ? { ...newAudioFxEffect(e.kind, e.id), enabled: e.enabled } : y)) }))}
              onExpose={p => onExpose(e, p)}
              onReorder={(from, to) => onChain(x => ({ ...x, effects: moveItem(x.effects, from, to) }))}
              onRemove={() => onChain(x => ({ ...x, effects: x.effects.filter(y => y.id !== e.id) }))}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function EffectCard({ chainId, effect: e, index, count, dimmed, touch, exposed, onPatch, onReset, onExpose, onReorder, onRemove }: {
  chainId: string;
  effect: AudioFxEffect;
  index: number;
  count: number;
  dimmed: boolean;
  touch: boolean;
  exposed: Set<string>;
  onPatch: (change: Record<string, unknown>) => void;
  onReset: () => void;
  onExpose: (p: AfParam) => void;
  onReorder: (from: number, to: number) => void;
  onRemove: () => void;
}) {
  const tk = useTokens();
  const def = AUDIO_FX_EFFECTS[e.kind];
  const foldKey = `audiofx:${e.id}`;
  const folded = usePlayUi(s => !!s.folded[foldKey]);
  const toggleFold = usePlayUi(s => s.toggleFold);
  const focused = usePlayUi(s => s.finishFocus === e.id), focusTick = usePlayUi(s => s.finishTick);
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!focused || !el) return;
    if (usePlayUi.getState().folded[foldKey]) toggleFold(foldKey, false);
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTick, focused, el]);
  const dragType = `text/audiofx-${chainId}`;
  const items: MenuItem[] = [
    { label: 'Move up', icon: 'chevU', disabled: index === 0, onSelect: () => onReorder(index, index - 1) },
    { label: 'Move down', icon: 'chevD', disabled: index === count - 1, onSelect: () => onReorder(index, index + 1) },
    'separator',
    { label: 'Reset to defaults', icon: 'resetParams', onSelect: onReset },
    { label: 'Remove', icon: 'trash', danger: true, onSelect: onRemove },
  ];
  const opt = (key: string, label: string, hint: string) => {
    const list = def.options[key] as readonly string[];
    return (
      <Row key={key} label={label} hint={hint}>
        <div style={{ flex: 1, minWidth: 120 }}>
          <Select ariaLabel={`${def.label} ${label}`} value={String(e[key])} height={26} options={list.map(v => ({ value: v, label: OPTION_LABELS[v] ?? v }))} onChange={v => onPatch({ [key]: v })} />
        </div>
      </Row>
    );
  };
  return (
    <div ref={setEl} style={{ borderRadius: radius.md, background: tk.bg.panel, border: `1px solid ${focused ? alpha(tk.accent.base, 0.5) : tk.border.default}`, opacity: dimmed ? 0.6 : 1 }}>
      <div
        draggable={!touch}
        onDragStart={ev => { ev.dataTransfer.setData(dragType, String(index)); ev.dataTransfer.effectAllowed = 'move'; }}
        onDragOver={ev => { if (ev.dataTransfer.types.includes(dragType)) { ev.preventDefault(); ev.dataTransfer.dropEffect = 'move'; } }}
        onDrop={ev => { const from = Number(ev.dataTransfer.getData(dragType)); if (Number.isFinite(from) && from >= 0 && from < count && from !== index) { ev.preventDefault(); onReorder(from, index); } }}
        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 6px 6px 8px', cursor: touch ? 'default' : 'grab' }}
      >
        {!touch && <Icon name="grip" size={12} style={{ color: tk.text.disabled, flexShrink: 0 }} />}
        <Icon name={def.icon as IconName} size={14} style={{ color: e.enabled ? tk.accent.base : tk.text.faint, flexShrink: 0 }} />
        <button type="button" onClick={() => toggleFold(foldKey, !folded)} aria-expanded={!folded} style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6, border: 0, background: 'none', padding: 0, cursor: 'pointer', color: tk.text.primary, font: `650 12.5px ${fontFamily.ui}`, textAlign: 'left' }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{def.label}</span>
          {(e.type || e.curve) ? <span style={{ color: tk.text.faint, font: `500 11px ${fontFamily.ui}` }}>{OPTION_LABELS[String(e.type ?? e.curve)] ?? ''}</span> : null}
        </button>
        <Toggle checked={e.enabled} onChange={enabled => onPatch({ enabled })} />
        <IconButton icon={folded ? 'chevR' : 'chevD'} size="sm" label={folded ? 'Show settings' : 'Fold'} onClick={() => toggleFold(foldKey, !folded)} />
        <IconButton icon="more" size="sm" label="Move, reset or remove" onClick={ev => { const r = (ev.currentTarget as HTMLElement).getBoundingClientRect(); setMenu({ x: r.right - 190, y: r.bottom + 4 }); }} />
      </div>
      {!folded && (
        <div style={{ padding: '0 10px 10px', opacity: e.enabled ? 1 : 0.55 }}>
          {e.kind === 'filter' && opt('type', 'Type', 'Low-pass keeps the lows, high-pass the highs, band-pass a band around the cutoff, notch cuts one.')}
          {e.kind === 'reverb' && opt('type', 'Space', 'Room: close, busy early reflections. Hall: slow bloom, long tail. Plate: dense and bright from the start.')}
          {e.kind === 'distortion' && opt('curve', 'Curve', 'Soft rounds the peaks, hard clips them flat, wavefold folds them back, tube bends one side more, bitcrush steps the level.')}
          {e.kind === 'echo' && (
            <>
              <Row label="Sync" hint="Off: the time in ms. A note value: the echo follows the tempo below.">
                <div style={{ flex: 1, minWidth: 120 }}>
                  <Select ariaLabel="Echo sync" value={String(e.sync ?? 'off')} height={26} options={Object.keys(AF_SYNC).map(v => ({ value: v, label: OPTION_LABELS[v] ?? v }))} onChange={v => onPatch({ sync: v })} />
                </div>
              </Row>
              <Row label="Ping-pong" hint="Repeats bounce between left and right.">
                <Toggle checked={!!e.pingpong} onChange={pingpong => onPatch({ pingpong })} />
              </Row>
            </>
          )}
          {afShownParams(e).map(p => (
            <NumRow key={p.key} p={p} value={typeof e[p.key] === 'number' ? e[p.key] as number : p.value} touch={touch} label={def.label}
              exposed={exposed.has(audioFxTarget(chainId, e.id, p.key))} onSet={v => onPatch({ [p.key]: v })} onExpose={() => onExpose(p)} />
          ))}
          {e.kind === 'distortion' && e.curve === 'bitcrush' && <Note>Downsample needs AudioWorklet (every current browser has it); without it Bitcrush still reduces the bits.</Note>}
          {e.kind === 'reverb' && <Note>Size and decay build a new impulse response, so mapped they move in small steps, and a render keeps where they start.</Note>}
        </div>
      )}
      {menu && <Menu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} title={def.label} />}
    </div>
  );
}

function Label({ text, hint }: { text: string; hint?: string }) {
  const tk = useTokens();
  const st: React.CSSProperties = { color: tk.text.faint, font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.04em', textTransform: 'uppercase', width: 78, flexShrink: 0, display: 'inline-block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
  return hint ? <Tooltip label={text} description={hint} placement="top"><span style={{ ...st, cursor: 'help' }}>{text}</span></Tooltip> : <span style={st}>{text}</span>;
}
function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, flexWrap: 'wrap' }}><Label text={label} hint={hint} />{children}</div>;
}
function Note({ children }: { children: React.ReactNode }) {
  const tk = useTokens();
  return <div style={{ marginTop: 6, color: tk.text.faint, font: `11px/1.45 ${fontFamily.ui}` }}>{children}</div>;
}
function NumRow({ p, value, label, touch, exposed, onSet, onExpose }: { p: AfParam; value: number; label: string; touch: boolean; exposed: boolean; onSet: (v: number) => void; onExpose: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
      <Label text={p.unit ? `${p.label} ${p.unit}` : p.label} hint={p.hint || undefined} />
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* An effect's ranges are the DSP's (a filter's Hz, a 0–1 mix) and the kit clamps stored values into them, so they're hard. */}
        <RulerSlider value={value} min={p.min} max={p.max} step={p.step} defaultValue={p.value} hard onChange={onSet} ariaLabel={`${label} ${p.label}`} touch={touch} integer={p.step === 1} />
      </div>
      <IconButton icon={exposed ? 'check' : 'plus'} size="sm" active={exposed} disabled={exposed} label={exposed ? 'Already a control' : `Make ${p.label} a control, to map the mouse, audio or an LFO onto it`} onClick={onExpose} />
    </div>
  );
}
