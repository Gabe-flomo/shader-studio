/**
 * GranulatorPanel — a Granulator rack's instrument on its card
 * (docs/granulator.md): the sample (generated, a Library sound, a drum pad's,
 * or an upload), its waveform with the live grains drawn on it (click or drag
 * to set Position), the mode, and every setting in folding sections. Each
 * setting has a + that makes it a control (`au:<rack>:inst::<address>`, as
 * an Audio Unit parameter's), and the grains' readouts can become controls
 * or nulls (play/grainControls.ts).
 */
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { useTokens } from '../../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../../theme/tokens';
import { Button, IconButton } from '../../ui/Button';
import { Segmented, Toggle } from '../../ui/Choice';
import { Select } from '../../ui/Select';
import { RulerSlider } from '../../ui/RulerSlider';
import { toast } from '../../ui/toastStore';
import { GR_FROM_LINKS_MAX, GR_FROM_PROPS, GR_FROM_PROP_NAMES, GR_FROM_TARGETS, GR_MODES, GR_SYNTHS, GR_SYNTH_NAMES, grFromDefaults, grNewStats, grParam, grSpectrumImage, grSummary, type GrParam } from '../../../play/kit/granulator.js';
import { AE_INST, aeRack, aeSlot, auPropId, auTarget, patchSlot, type AeGrainFrom, type AeGrainLink, type AeGrainSample, type AeRack, type AeSlot } from '../../../types/playAudioEngine';
import type { PlayRecord } from '../../../types/play';
import type { DrumPadLayer } from '../../../types/playLayers';
import { formatParam } from '../../../lib/audioEngineProtocol';
import { audioEngineHost } from '../../../lib/audioEngineHost';
import { useGrainUi } from '../../../lib/webGranulator';
import { playEngine } from '../../../lib/playEngine';
import { addVideoFile, isAudioType } from '../../../lib/backgroundLibrary';
import { audioAccept, isAudioFile, notAudioMessage } from '../../../lib/audioAccept';
import { useLibraryVideos } from '../../backgrounds/useBackgrounds';
import { playId } from '../../../play/playControls';
import { addGrainNulls, addGrainReadouts } from '../../../play/grainControls';
import { usePlayUi } from '../playUi';
import { withEngine } from './engineOps';

type Change = (fn: (p: PlayRecord) => PlayRecord) => void;

const SECTIONS: ReadonlyArray<{ title: string; keys: string[]; open?: boolean; mode?: number }> = [
  { title: 'Emit', keys: ['emitDir', 'emitSpeed', 'emitSpread', 'emitEdge'], open: true, mode: 3 },
  { title: 'Spectral', keys: ['band', 'bandWidth', 'bandSpread', 'bandSpeed', 'bandDir', 'bandEdge', 'shift', 'partials', 'fftSize'], open: true, mode: 4 },
  { title: 'Grains', keys: ['position', 'spray', 'size', 'sizeRand', 'density', 'window', 'skew'], open: true },
  { title: 'Pitch', keys: ['pitch', 'spread', 'pitchRand', 'fmRate', 'fmAmount'], open: true },
  { title: 'Scan and freeze', keys: ['scan', 'lfoRate', 'lfoDepth', 'freeze'] },
  { title: 'Random', keys: ['panRand', 'levelRand', 'reverse', 'seed'] },
  { title: 'Filter', keys: ['filter', 'cutoff', 'resonance'] },
  { title: 'Amp envelope', keys: ['attack', 'decay', 'sustain', 'release'] },
  { title: 'Playing', keys: ['hold', 'drone', 'voices', 'cap', 'root', 'velocity', 'level'] },
];

const labelStyle = (tk: ReturnType<typeof useTokens>): CSSProperties => ({ color: tk.text.faint, font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.05em', textTransform: 'uppercase' });

export function GranulatorPanel({ rack, slot, play, onChange, touch }: { rack: AeRack; slot: AeSlot; play: PlayRecord; onChange: Change; touch: boolean }) {
  const tk = useTokens();
  const exposed = useMemo(() => new Set(play.controls.map(c => c.target)), [play.controls]);
  const valueOf = (key: string) => { const p = grParam(key)!; return slot.params?.[String(p.addr)] ?? p.value; };
  const setMany = (o: Record<string, number>) => onChange(pr => {
    const cur = aeSlot(aeRack(pr.audioEngine, rack.id), AE_INST);
    const params = { ...cur?.params };
    for (const [k, v] of Object.entries(o)) { const p = grParam(k); if (p) params[String(p.addr)] = Math.max(p.min, Math.min(p.max, v)); }
    return withEngine(pr, patchSlot(pr.audioEngine, rack.id, AE_INST, { params }));
  });
  const set = (key: string, v: number) => setMany({ [key]: v });
  const expose = (p: GrParam) => {
    const target = auTarget(rack.id, AE_INST, String(p.addr));
    const label = `${rack.name} · Granulator · ${p.name}`;
    onChange(pr => {
      if (pr.controls.some(c => c.target === target)) return pr;
      toast.success(`${label} is a control`, { message: 'Map a source onto it in Mappings (the mouse, audio readers, MIDI, an LFO…).', action: { label: 'Show', onClick: () => usePlayUi.getState().setTab('controls') } });
      return { ...pr, controls: [...pr.controls, { id: playId('ctl'), target, kind: 'float', label, min: p.min, max: p.max, ...(p.step ? { step: p.step } : {}) }] };
    });
  };
  const [open, setOpen] = useState<Record<string, boolean>>(() => Object.fromEntries(SECTIONS.map(s => [s.title, !!s.open])));
  const mode = Math.round(valueOf('mode'));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <SampleRow rack={rack} slot={slot} play={play} onChange={onChange} />
      <GrainWave rack={rack} mode={mode} position={valueOf('position')} spray={valueOf('spray')} band={valueOf('band')} bandWidth={valueOf('bandWidth')} fftSize={valueOf('fftSize')}
        onPosition={v => set('position', v)} onBand={v => set('band', v)} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ ...labelStyle(tk), width: 44 }}>Mode</span>
        <Segmented size="sm" ariaLabel="Grain mode" value={String(mode)} onChange={v => set('mode', Number(v))}
          options={GR_MODES.map((m, i) => ({ value: String(i), label: m, title: MODE_NOTES[i] }))} />
        <IconButton icon={exposed.has(auTarget(rack.id, AE_INST, '0')) ? 'check' : 'plus'} size="sm" disabled={exposed.has(auTarget(rack.id, AE_INST, '0'))} label="Make Mode a control" onClick={() => expose(grParam('mode')!)} />
      </div>
      <span style={{ color: tk.text.muted, font: `11px/1.45 ${fontFamily.ui}` }}>{MODE_NOTES[mode] ?? ''}</span>
      {SECTIONS.filter(sec => sec.mode === undefined || sec.mode === mode).map(sec => (
        <div key={sec.title} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <button type="button" onClick={() => setOpen(o => ({ ...o, [sec.title]: !o[sec.title] }))} aria-expanded={!!open[sec.title]}
            style={{ ...labelStyle(tk), border: 0, background: 'none', padding: '2px 0', cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ display: 'inline-block', width: 10 }}>{open[sec.title] ? '▾' : '▸'}</span>{sec.title}
          </button>
          {open[sec.title] && sec.keys.map(k => {
            const p = grParam(k)!;
            const target = auTarget(rack.id, AE_INST, String(p.addr));
            return <ParamRow key={k} p={p} value={valueOf(k)} touch={touch} exposed={exposed.has(target)} onSet={v => set(k, v)} onExpose={() => expose(p)} />;
          })}
        </div>
      ))}
      <GrainsFrom rack={rack} slot={slot} play={play} onChange={onChange} touch={touch} exposed={exposed.has(auTarget(rack.id, AE_INST, String(grParam('fromRate')!.addr)))}
        rate={valueOf('fromRate')} onRate={v => set('fromRate', v)} onExposeRate={() => expose(grParam('fromRate')!)} />
      <Readouts rack={rack} onChange={onChange} />
    </div>
  );
}

// ── Grains from a layer ──────────────────────────────────────────────────────

const FROM_KINDS: Record<string, string> = { particles: 'particles', bodies: 'bodies', agents: 'agents', null: 'a null', relationship: 'members' };

/**
 * "Grains from": a layer's things (particles, bodies, a null, a Relationship's members) play
 * grains while they're inside a boundary shape, each thing's numbers setting its grains' through
 * a few links (lib/grainFrom.ts). Folded until used.
 */
function GrainsFrom({ rack, slot, play, onChange, touch, exposed, rate, onRate, onExposeRate }: {
  rack: AeRack; slot: AeSlot; play: PlayRecord; onChange: Change; touch: boolean; exposed: boolean; rate: number; onRate: (v: number) => void; onExposeRate: () => void;
}) {
  const tk = useTokens();
  const from = slot.from;
  const [open, setOpen] = useState(!!from);
  const inside = useGrainUi(s => s.inside[rack.id]);
  const setFrom = (f: AeGrainFrom | undefined) => onChange(p => withEngine(p, patchSlot(p.audioEngine, rack.id, AE_INST, { from: f })));
  const sources = play.layers.filter(l => FROM_KINDS[l.kind]);
  const shapes = play.layers.filter(l => l.kind === 'shape');
  const src = from ? play.layers.find(l => l.id === from.source) : undefined;
  const cur = from ?? { ...grFromDefaults(), source: '' };
  const patch = (o: Partial<AeGrainFrom>) => { const next = { ...cur, ...o }; setFrom(next.source ? next : undefined); };
  const patchLink = (i: number, o: Partial<AeGrainLink>) => patch({ links: cur.links.map((l, j) => (j === i ? { ...l, ...o } : l)) });
  const num = (v: number) => (Math.abs(v) >= 100 ? String(Math.round(v)) : String(Math.round(v * 100) / 100));
  const cell: CSSProperties = { height: 24, minWidth: 0, padding: '0 4px', borderRadius: radius.sm, border: `1px solid ${tk.border.default}`, background: tk.bg.panel, color: tk.text.primary, font: `11.5px ${fontFamily.mono}` };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
        style={{ ...labelStyle(tk), border: 0, background: 'none', padding: '2px 0', cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 4 }}>
        <span style={{ display: 'inline-block', width: 10 }}>{open ? '▾' : '▸'}</span>Grains from a layer{from ? ` · ${src?.label ?? 'gone'}` : ''}
      </button>
      {open && (<>
        <span style={{ color: tk.text.muted, font: `11px/1.45 ${fontFamily.ui}` }}>Each thing inside the boundary plays grains while it stays there, its own numbers setting its grains.</span>
        <div style={{ display: 'grid', gridTemplateColumns: '64px 1fr', alignItems: 'center', gap: 6 }}>
          <span style={labelStyle(tk)}>Source</span>
          <Select ariaLabel="The layer whose things play grains" value={cur.source} height={28} onChange={v => patch({ source: v })}
            options={[{ value: '', label: sources.length ? 'None' : 'No particles, bodies, agents, nulls or relationships yet' }, ...sources.map(l => ({ value: l.id, label: `${l.label} · ${FROM_KINDS[l.kind]}` }))]} />
          <span style={labelStyle(tk)}>Inside</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <Select ariaLabel="The boundary: only things inside it play" value={cur.boundary} height={28} style={{ flex: 1, minWidth: 0 }} onChange={v => patch({ boundary: v })}
              options={[{ value: '', label: 'The whole picture' }, ...shapes.map(l => ({ value: l.id, label: l.label }))]} />
            {from && <span title="Things inside the boundary now" style={{ color: tk.text.secondary, font: `600 11px ${fontFamily.mono}`, whiteSpace: 'nowrap' }}>{inside ?? 0} in</span>}
          </div>
        </div>
        {from && (<>
          <ParamRow p={grParam('fromRate')!} value={rate} touch={touch} exposed={exposed} onSet={onRate} onExpose={onExposeRate} />
          {src?.kind === 'particles' && <Toggle checked={cur.births} onChange={on => patch({ births: on })} label="A particle just born plays a grain at once (a burst is a burst of grains)" />}
          <div role="table" aria-label="Links: a thing’s number sets a grain setting" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {cur.links.map((l, i) => (
              <div role="row" key={i} style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr) minmax(0, 1fr) 46px 46px 22px', alignItems: 'center', gap: 4, opacity: l.on ? 1 : 0.55 }}>
                <input type="checkbox" checked={l.on} aria-label="Link on" onChange={e => patchLink(i, { on: e.target.checked })} style={{ accentColor: tk.accent.base }} />
                <select aria-label="Its number" value={l.prop} onChange={e => patchLink(i, { prop: e.target.value })} style={cell}>
                  {GR_FROM_PROPS.map(k => <option key={k} value={k}>{GR_FROM_PROP_NAMES[k]}</option>)}
                </select>
                <select aria-label="Sets" value={l.target} onChange={e => { const t = GR_FROM_TARGETS[e.target.value]; patchLink(i, { target: e.target.value, min: t.min, max: t.max }); }} style={cell}>
                  {Object.entries(GR_FROM_TARGETS).map(([k, t]) => <option key={k} value={k}>→ {t.name}</option>)}
                </select>
                <input aria-label="At 0" title={`At 0 (${GR_FROM_TARGETS[l.target]?.unit || 'value'})`} defaultValue={num(l.min)} key={`a${i}${l.target}${l.min}`} onBlur={e => { const v = Number(e.target.value); if (Number.isFinite(v)) patchLink(i, { min: v }); }} style={cell} />
                <input aria-label="At 1" title={`At 1 (${GR_FROM_TARGETS[l.target]?.unit || 'value'})`} defaultValue={num(l.max)} key={`b${i}${l.target}${l.max}`} onBlur={e => { const v = Number(e.target.value); if (Number.isFinite(v)) patchLink(i, { max: v }); }} style={cell} />
                <IconButton icon="close" size="sm" label="Remove this link" onClick={() => patch({ links: cur.links.filter((_, j) => j !== i) })} />
              </div>
            ))}
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <Button size="sm" variant="ghost" icon="plus" disabled={cur.links.length >= GR_FROM_LINKS_MAX} onClick={() => patch({ links: [...cur.links, { prop: 'bright', target: 'cutoff', on: true, min: GR_FROM_TARGETS.cutoff.min, max: GR_FROM_TARGETS.cutoff.max }] })}>Link</Button>
              <span style={{ color: tk.text.faint, font: `11px ${fontFamily.ui}` }}>Each: a number of the thing (0 to 1) → a grain setting, from the first value to the second.</span>
            </div>
          </div>
        </>)}
      </>)}
    </div>
  );
}

const MODE_NOTES = [
  'Classic: two overlapping grains per note, a new one every half grain (Density isn’t used). Smooth, steady, pitch holds as you scan.',
  'Flux: a steady stream at Density grains a second, whatever their size; Level random makes grains flicker and drop out, Reverse flips some.',
  'Cloud: grains at random moments, Density a second on average, each at its own pitch inside Spread and its own place: a thick, chorused cloud.',
  'Emit: grains leave from eight spawn points that travel through the sample from Position (Travel speed, Direction); Emit spread scatters the spawn points, and at the ends they wrap, bounce or jump.',
  'Spectral: grains play frequency bands of the sample instead of time slices: each resynthesises the strongest peaks of its band (Band, Band width) at the moment Position reads. Drag up and down on the spectrogram to move the band.',
];

/** One setting: a ruler (log ones on a log scale), a list, or a toggle, with its + for a control. */
/** One setting: its name, a slider (a list, a switch), and + to make it a control. `soft`: typing past the slider's end is kept. Shared with the sample player's Sample index. */
export function ParamRow({ p, value, touch, exposed, onSet, onExpose, soft }: { p: GrParam; value: number; touch: boolean; exposed: boolean; onSet: (v: number) => void; onExpose: () => void; soft?: boolean }) {
  const tk = useTokens();
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(78px, 32%) 1fr 26px', alignItems: 'center', gap: 6 }}>
      <span title={p.hint} style={{ color: tk.text.secondary, font: `11.5px ${fontFamily.ui}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
      {p.kind === 'toggle' ? (
        <Toggle checked={value >= 0.5} onChange={on => onSet(on ? 1 : 0)} label={<span title={p.hint}>{value >= 0.5 ? 'On' : 'Off'}</span>} />
      ) : p.kind === 'list' ? (
        <Select ariaLabel={p.name} value={String(Math.round(value))} height={26} onChange={x => onSet(Number(x))}
          options={(p.values ?? []).map((label, i) => ({ value: String(i), label }))} />
      ) : p.log ? (
        <LogSlider p={p} value={value} onSet={onSet} />
      ) : (
        <RulerSlider value={value} min={p.min} max={p.max} step={p.step || (p.max - p.min) / 1000} defaultValue={p.value} hard={!soft} onChange={onSet} ariaLabel={p.name} touch={touch} integer={p.step === 1} />
      )}
      <IconButton icon={exposed ? 'check' : 'plus'} size="sm" active={exposed} disabled={exposed} label={exposed ? 'Already a control' : `Make ${p.name} a control, to map the mouse, audio, MIDI or an LFO onto it`} onClick={onExpose} />
    </div>
  );
}

/** A setting on a log scale (Hz, ms, grains a second): a plain range input and its value. */
function LogSlider({ p, value, onSet }: { p: GrParam; value: number; onSet: (v: number) => void }) {
  const tk = useTokens();
  const lo = Math.max(p.min, p.min > 0 ? p.min : 0.1), span = Math.log(p.max / lo);
  const toT = (v: number) => (v <= lo ? 0 : Math.log(v / lo) / span);
  const fromT = (t: number) => (t <= 0 ? p.min : lo * Math.exp(t * span));
  const round = (v: number) => (p.step >= 1 ? Math.round(v) : v >= 100 ? Math.round(v) : Math.round(v * 100) / 100);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
      <input type="range" min={0} max={1000} step={1} value={Math.round(toT(value) * 1000)} aria-label={p.name} title={p.hint}
        onChange={e => onSet(round(fromT(Number(e.target.value) / 1000)))} onDoubleClick={() => onSet(p.value)}
        style={{ flex: 1, minWidth: 0, accentColor: tk.accent.base, height: 18 }} />
      <span style={{ color: tk.text.secondary, font: `500 11px ${fontFamily.mono}`, minWidth: 58, textAlign: 'right' }}>{formatParam({ unit: p.unit, kind: 'number', min: p.min }, value)}</span>
    </div>
  );
}

// ── The sample ───────────────────────────────────────────────────────────────

function SampleRow({ rack, slot, play, onChange }: { rack: AeRack; slot: AeSlot; play: PlayRecord; onChange: Change }) {
  const tk = useTokens();
  const { videos } = useLibraryVideos();
  const sounds = useMemo(() => (videos ?? []).filter(v => isAudioType(v.type)), [videos]);
  const ui = useGrainUi(s => s.samples[rack.id]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const setSample = (sample: AeGrainSample | undefined) => onChange(p => withEngine(p, patchSlot(p.audioEngine, rack.id, AE_INST, { sample })));
  // Drum pads' sounds: a Library sample, or a generated drum.
  const padOptions = useMemo(() => {
    const out: { value: string; label: string }[] = [];
    for (const l of play.layers) {
      if (l.kind !== 'drumpad') continue;
      (l as DrumPadLayer).pads.forEach((p, i) => {
        const name = p.name || p.fileName || (p.synth ? GR_SYNTH_NAMES[p.synth] : '');
        if (p.sampleId) out.push({ value: `lib:${p.sampleId}:${name}`, label: `${l.label} · pad ${i + 1} · ${name}` });
        else if (p.synth) out.push({ value: `synth:${p.synth}`, label: `${l.label} · pad ${i + 1} · ${name}` });
      });
    }
    return out;
  }, [play.layers]);
  const current = slot.sample?.synth ? `synth:${slot.sample.synth}` : slot.sample?.sampleId ? `lib:${slot.sample.sampleId}:${slot.sample.name}` : '';
  const options = [
    ...(current ? [] : [{ value: '', label: 'Choose a sample…' }]),
    ...GR_SYNTHS.map(k => ({ value: `synth:${k}`, label: `Generated · ${GR_SYNTH_NAMES[k] ?? k}` })),
    ...sounds.map(s => ({ value: `lib:${s.id}:${s.name}`, label: `Library · ${s.name}` })),
    ...padOptions,
  ];
  if (current && !options.some(o => o.value === current)) options.push({ value: current, label: slot.sample?.name ?? 'Sample' });
  const pick = (v: string) => {
    if (v.startsWith('synth:')) { const k = v.slice(6); setSample({ synth: k, name: GR_SYNTH_NAMES[k] ?? k }); return; }
    if (v.startsWith('lib:')) { const rest = v.slice(4), i = rest.indexOf(':'); setSample({ sampleId: rest.slice(0, i), name: rest.slice(i + 1) || 'Sound' }); }
  };
  const upload = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!isAudioFile(f)) { toast.error('That isn’t a sound', { message: notAudioMessage(f) }); return; }
    setBusy(true);
    try {
      const meta = await addVideoFile(f, { name: f.name });
      setSample({ sampleId: meta.id, name: meta.name });
    } catch (err) {
      toast.error('The sound didn’t save', { message: err instanceof Error ? err.message : String(err) });
    } finally { setBusy(false); }
  };
  const status = ui?.status;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={{ ...labelStyle(tk), width: 44 }}>Sample</span>
        <Select ariaLabel="The granulator’s sample" value={current} options={options} height={28} style={{ flex: '1 1 170px', minWidth: 0 }} onChange={pick} />
        <Button size="sm" variant="ghost" icon="import" disabled={busy} onClick={() => fileRef.current?.click()} title="Upload a sound: it goes into the Library’s Sounds">{busy ? 'Saving…' : 'Upload…'}</Button>
        <input ref={fileRef} type="file" accept={audioAccept()} style={{ display: 'none' }} onChange={e => void upload(e)} />
      </div>
      {status === 'missing' && <span style={{ color: tk.status.danger, font: `11.5px ${fontFamily.ui}` }}>This sound isn’t in this browser’s Library. Upload it again, or pick another.</span>}
      {status === 'error' && <span style={{ color: tk.status.danger, font: `11.5px ${fontFamily.ui}` }}>{ui?.name || 'This browser couldn’t decode that sound.'}</span>}
    </div>
  );
}

// ── The waveform with the grains on it ───────────────────────────────────────

function GrainWave({ rack, mode, position, spray, band, bandWidth, fftSize, onPosition, onBand }: {
  rack: AeRack; mode: number; position: number; spray: number; band: number; bandWidth: number; fftSize: number; onPosition: (v: number) => void; onBand: (v: number) => void;
}) {
  const tk = useTokens();
  const ref = useRef<HTMLCanvasElement>(null);
  const ui = useGrainUi(s => s.samples[rack.id]);
  const drag = useRef(false);
  const [count, setCount] = useState(0);
  const spectral = mode === 4;
  // Spectral: the sample's spectrogram (time across, frequency up on the Band axis), drawn once into a small canvas.
  const specImg = useMemo(() => {
    if (!spectral || ui?.status !== 'ready' || typeof document === 'undefined') return null;
    const sp = audioEngineHost.granulator(rack.id)?.spectrum();
    if (!sp || !ui.duration) return null;
    const cols = 240, rows = 64, img = grSpectrumImage(sp, cols, rows, sp.len / ui.duration);
    const c = document.createElement('canvas');
    c.width = cols; c.height = rows;
    const g = c.getContext('2d');
    if (!g) return null;
    const data = g.createImageData(cols, rows);
    const [r, gg, b] = hexRgb(tk.accent.base);
    for (let x = 0; x < cols; x++) for (let y = 0; y < rows; y++) {
      const v = img[x * rows + y], k = ((rows - 1 - y) * cols + x) * 4;
      data.data[k] = r; data.data[k + 1] = gg; data.data[k + 2] = b; data.data[k + 3] = Math.round(255 * Math.min(1, v * 0.9));
    }
    g.putImageData(data, 0, 0);
    return c;
    // fftSize: a new window is a new analysis.
  }, [spectral, ui, rack.id, tk.accent.base, fftSize]);
  useEffect(() => {
    let raf = 0, lastCount = -1;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const c = ref.current;
      if (!c) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1), w = c.clientWidth, h = c.clientHeight;
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
      const g = c.getContext('2d');
      if (!g) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      // Where the grains read: Position (as mappings drive it) ± Spray.
      const pos = playEngine.layerValue(auPropId(rack.id, AE_INST), '1', position);
      const dur = ui?.duration || 0, half = dur > 0 ? Math.min(0.5, spray / dur) : 0;
      g.fillStyle = alpha(tk.accent.base, 0.12);
      g.fillRect((pos - half) * w, 0, half * 2 * w, h);
      const peaks = ui?.peaks;
      if (spectral && specImg) {
        g.imageSmoothingEnabled = true;
        g.drawImage(specImg, 0, 0, w, h);
        // The band: its centre (as mappings drive it) and width.
        const bnd = playEngine.layerValue(auPropId(rack.id, AE_INST), String(grParam('band')!.addr), band);
        const y0 = h - Math.min(1, bnd + bandWidth / 2) * h, y1 = h - Math.max(0, bnd - bandWidth / 2) * h;
        g.fillStyle = alpha(tk.text.primary, 0.08);
        g.fillRect(0, y0, w, y1 - y0);
        g.fillStyle = alpha(tk.text.primary, 0.5);
        g.fillRect(0, Math.round(h - bnd * h) - 0.5, w, 1);
      } else if (peaks) {
        const n = peaks.length;
        g.fillStyle = alpha(tk.text.faint, 0.9);
        for (let i = 0; i < n; i++) { const a = peaks[i] * (h / 2 - 3); g.fillRect((i / n) * w, h / 2 - a, Math.max(1, w / n - 0.4), Math.max(1, a * 2)); }
      }
      g.fillStyle = tk.text.primary;
      g.fillRect(Math.round(pos * w) - 1, 0, 2, h);
      const st = audioEngineHost.granulator(rack.id)?.stats();
      if (st) {
        // The travelling spawn points: Emit's along the top (places in the sample), Spectral's down the left edge (bands).
        g.fillStyle = tk.status.warning;
        if (st.headCount && st.headAxis === 1) {
          for (let i = 0; i < st.headCount; i++) { const x = st.heads[i] * w; g.beginPath(); g.moveTo(x - 4, 0); g.lineTo(x + 4, 0); g.lineTo(x, 7); g.closePath(); g.fill(); }
        } else if (st.headCount && st.headAxis === 2) {
          for (let i = 0; i < st.headCount; i++) { const y = h - st.heads[i] * h; g.beginPath(); g.moveTo(0, y - 4); g.lineTo(0, y + 4); g.lineTo(7, y); g.closePath(); g.fill(); }
        }
        // The live grains: a dot where each reads, higher and bigger when louder (Spectral: at its band, bigger with its energy).
        for (let i = 0; i < st.count; i++) {
          const a = Math.min(1, spectral ? st.energy[i] * 4 : st.amp[i]), x = st.pos[i] * w;
          const y = spectral ? h - st.band[i] * h : h - 6 - a * (h - 12);
          g.fillStyle = alpha(spectral ? tk.text.primary : tk.accent.base, 0.35 + 0.65 * a);
          g.beginPath(); g.arc(x, y, 2 + 3 * a, 0, Math.PI * 2); g.fill();
        }
        if (st.count !== lastCount) { lastCount = st.count; setCount(st.count); }
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [rack.id, position, spray, ui, tk, spectral, specImg, band, bandWidth]);
  const at = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, r.width))), y: Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / Math.max(1, r.height))) };
  };
  const put = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const p = at(e);
    onPosition(Math.round(p.x * 1000) / 1000);
    if (spectral) onBand(Math.round(p.y * 1000) / 1000);
  };
  const sum = grSummary(audioEngineHost.granulator(rack.id)?.stats() ?? grNewStats());
  return (
    <div>
      <canvas ref={ref} aria-label={spectral ? 'Spectrogram: click or drag to set Position (across) and Band (up and down); dots are the grains sounding now, triangles the travelling bands' : 'Waveform: click or drag to set Position; dots are the grains sounding now, triangles the travelling spawn points'}
        onPointerDown={e => { drag.current = true; e.currentTarget.setPointerCapture(e.pointerId); put(e); }}
        onPointerMove={e => { if (drag.current) put(e); }}
        onPointerUp={() => { drag.current = false; }} onPointerCancel={() => { drag.current = false; }}
        style={{ display: 'block', width: '100%', height: spectral ? 96 : 72, borderRadius: radius.md, background: tk.bg.field, cursor: spectral ? 'crosshair' : 'ew-resize', touchAction: 'none' }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', color: tk.text.faint, font: `500 10px ${fontFamily.mono}`, marginTop: 3, gap: 8 }}>
        <span>{ui?.status === 'loading' ? 'loading…' : ui?.duration ? `${ui.duration.toFixed(2)} s` : 'no sample'}</span>
        <span>{count} grain{count === 1 ? '' : 's'}{count ? (spectral ? ` · band ${(sum.band * 100).toFixed(0)}%` : ` · mean ${(sum.mean * 100).toFixed(0)}%`) : ''}</span>
        <span>pos {(position * 100).toFixed(1)}%{spectral ? ` · band ${(band * 100).toFixed(1)}%` : ''}</span>
      </div>
    </div>
  );
}

/** A #rrggbb colour's channels (a soft blue for anything else). */
function hexRgb(c: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(c.trim());
  if (!m) return [120, 160, 255];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}


// ── Readouts ─────────────────────────────────────────────────────────────────

function Readouts({ rack, onChange }: { rack: AeRack; onChange: Change }) {
  const tk = useTokens();
  const show = () => usePlayUi.getState().setTab('controls');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 2 }}>
      <span style={labelStyle(tk)}>Grains for the picture</span>
      <span style={{ color: tk.text.muted, font: `11px/1.45 ${fontFamily.ui}` }}>
        The grains read as sensors on this rack (a mapping’s Layer sensor → {rack.name} · grains): count, mean position, spread, level, pitch, and each grain’s place and level.
      </span>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <Button size="sm" icon="sliders" onClick={() => { onChange(p => addGrainReadouts(p, rack.id)); toast.success('Grain count, position and spread are controls', { message: `In “Grains · ${rack.name}”.`, action: { label: 'Show', onClick: show } }); }}>Readouts → controls</Button>
        <Button size="sm" icon="target" onClick={() => { onChange(p => addGrainNulls(p, rack.id, 8)); toast.success('Eight nulls ride the grains', { message: 'x: where each grain reads, y: how loud. Point particles, paths or anything that follows a null at them.' }); }}>Grains → nulls</Button>
      </div>
    </div>
  );
}
