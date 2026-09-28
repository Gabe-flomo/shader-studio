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
import { GR_SYNTHS, GR_SYNTH_NAMES, grParam, grSummary, type GrParam } from '../../../play/kit/granulator.js';
import { AE_INST, aeRack, aeSlot, auPropId, auTarget, patchSlot, type AeGrainSample, type AeRack, type AeSlot } from '../../../types/playAudioEngine';
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

const SECTIONS: ReadonlyArray<{ title: string; keys: string[]; open?: boolean }> = [
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
      <GrainWave rack={rack} position={valueOf('position')} spray={valueOf('spray')} onPosition={v => set('position', v)} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ ...labelStyle(tk), width: 44 }}>Mode</span>
        <Segmented size="sm" ariaLabel="Grain mode" value={String(mode)} onChange={v => set('mode', Number(v))}
          options={['Classic', 'Flux', 'Cloud'].map((m, i) => ({ value: String(i), label: m, title: MODE_NOTES[i] }))} />
        <IconButton icon={exposed.has(auTarget(rack.id, AE_INST, '0')) ? 'check' : 'plus'} size="sm" disabled={exposed.has(auTarget(rack.id, AE_INST, '0'))} label="Make Mode a control" onClick={() => expose(grParam('mode')!)} />
      </div>
      <span style={{ color: tk.text.muted, font: `11px/1.45 ${fontFamily.ui}` }}>{MODE_NOTES[mode] ?? ''}</span>
      {SECTIONS.map(sec => (
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
      <Readouts rack={rack} onChange={onChange} />
    </div>
  );
}

const MODE_NOTES = [
  'Classic: two overlapping grains per note, a new one every half grain (Density isn’t used). Smooth, steady, pitch holds as you scan.',
  'Flux: a steady stream at Density grains a second, whatever their size; Level random makes grains flicker and drop out, Reverse flips some.',
  'Cloud: grains at random moments, Density a second on average, each at its own pitch inside Spread and its own place: a thick, chorused cloud.',
];

/** One setting: a ruler (log ones on a log scale), a list, or a toggle, with its + for a control. */
function ParamRow({ p, value, touch, exposed, onSet, onExpose }: { p: GrParam; value: number; touch: boolean; exposed: boolean; onSet: (v: number) => void; onExpose: () => void }) {
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
        <RulerSlider value={value} min={p.min} max={p.max} step={p.step || (p.max - p.min) / 1000} defaultValue={p.value} hard onChange={onSet} ariaLabel={p.name} touch={touch} integer={p.step === 1} />
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

function GrainWave({ rack, position, spray, onPosition }: { rack: AeRack; position: number; spray: number; onPosition: (v: number) => void }) {
  const tk = useTokens();
  const ref = useRef<HTMLCanvasElement>(null);
  const ui = useGrainUi(s => s.samples[rack.id]);
  const drag = useRef(false);
  const [count, setCount] = useState(0);
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
      if (peaks) {
        const n = peaks.length;
        g.fillStyle = alpha(tk.text.faint, 0.9);
        for (let i = 0; i < n; i++) { const a = peaks[i] * (h / 2 - 3); g.fillRect((i / n) * w, h / 2 - a, Math.max(1, w / n - 0.4), Math.max(1, a * 2)); }
      }
      g.fillStyle = tk.text.primary;
      g.fillRect(Math.round(pos * w) - 1, 0, 2, h);
      // The live grains: a dot where each reads, higher and bigger when louder.
      const st = audioEngineHost.granulator(rack.id)?.stats();
      if (st) {
        for (let i = 0; i < st.count; i++) {
          const a = Math.min(1, st.amp[i]), x = st.pos[i] * w, y = h - 6 - a * (h - 12);
          g.fillStyle = alpha(tk.accent.base, 0.35 + 0.65 * a);
          g.beginPath(); g.arc(x, y, 2 + 3 * a, 0, Math.PI * 2); g.fill();
        }
        if (st.count !== lastCount) { lastCount = st.count; setCount(st.count); }
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [rack.id, position, spray, ui, tk]);
  const at = (e: ReactPointerEvent<HTMLCanvasElement>) => { const r = e.currentTarget.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, r.width))); };
  const sum = grSummary(audioEngineHost.granulator(rack.id)?.stats() ?? { count: 0, maxCount: 0, pos: new Float32Array(0), amp: new Float32Array(0), pitch: new Float32Array(0) });
  return (
    <div>
      <canvas ref={ref} aria-label="Waveform: click or drag to set Position; dots are the grains sounding now"
        onPointerDown={e => { drag.current = true; e.currentTarget.setPointerCapture(e.pointerId); onPosition(Math.round(at(e) * 1000) / 1000); }}
        onPointerMove={e => { if (drag.current) onPosition(Math.round(at(e) * 1000) / 1000); }}
        onPointerUp={() => { drag.current = false; }} onPointerCancel={() => { drag.current = false; }}
        style={{ display: 'block', width: '100%', height: 72, borderRadius: radius.md, background: tk.bg.field, cursor: 'ew-resize', touchAction: 'none' }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', color: tk.text.faint, font: `500 10px ${fontFamily.mono}`, marginTop: 3, gap: 8 }}>
        <span>{ui?.status === 'loading' ? 'loading…' : ui?.duration ? `${ui.duration.toFixed(2)} s` : 'no sample'}</span>
        <span>{count} grain{count === 1 ? '' : 's'}{count ? ` · mean ${(sum.mean * 100).toFixed(0)}%` : ''}</span>
        <span>pos {(position * 100).toFixed(1)}%</span>
      </div>
    </div>
  );
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
