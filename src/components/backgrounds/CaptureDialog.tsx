/**
 * CaptureDialog — make an image background from a graph: choose a saved
 * graph or an example, pick the moment (drag through time, or play and
 * pause), set the controls its Play setup surfaces (none without one),
 * render the shader alone (Graph) or with its layers (Play), at the size
 * asked for (the presentation's shape, 1920 × 1080, up to 4K), and Capture.
 * The picture goes to the library's Image backgrounds, named after the graph
 * and the time, and its id goes back to whoever opened the window.
 *
 * The picture is the web player (present/runtimeHost.ts) mounted at the
 * capture's own size and scaled down to fit the preview, so what you see is
 * what's kept. Every still frame is drawn with mount.renderAt: the same time
 * gives the same picture, and layers that simulate (particles, sketches,
 * feedback) are stepped from 0 to that time first at a fixed step
 * (captureSteps). While you drag, the warm-up is coarse; it settles exactly
 * a moment after you let go, and always before a capture.
 */
import { openProSheet, requireFeature, useCan } from '../../lib/plan';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Button, IconButton } from '../ui/Button';
import { Segmented } from '../ui/Choice';
import { Field } from '../ui/Field';
import { Icon } from '../ui/Icon';
import { Modal } from '../ui/Modal';
import { Popover } from '../ui/Popover';
import { RulerSlider } from '../ui/RulerSlider';
import { Select } from '../ui/Select';
import { Sheet } from '../ui/Sheet';
import { toast } from '../ui/toastStore';
import { ColourPad } from '../play/ColourPad';
import { PlayableList, type PlayableRow } from '../play/OpenPlayable';
import { mountPlay, type PlayMount } from '../../present/runtimeHost';
import { snapshotExample, snapshotSaved } from '../../present/snapshot';
import { baseValue } from '../../present/controls';
import { EXAMPLE_INDEX } from '../../store/exampleIndex';
import type { PlayHtmlInput } from '../../play/exportHtml';
import { addImage, captureName, captureSteps, clampCaptureSize, sizeForAspect, CAPTURE_MAX_SIDE, type CaptureSource } from '../../lib/backgroundLibrary';
import { captureControls, captureInput, hasPlayPicture, needsWarmup, type CaptureMode } from '../../lib/backgroundCapture';

type Value = number | number[];
interface Loaded { row: PlayableRow; input: PlayHtmlInput }

const narrow = () => typeof window !== 'undefined' && window.innerWidth < 720;
const SIZES: Array<{ id: string; w: number; h: number; label: string }> = [
  { id: '1920x1080', w: 1920, h: 1080, label: '1920 × 1080 (HD, 16:9)' },
  { id: '2560x1440', w: 2560, h: 1440, label: '2560 × 1440 (16:9)' },
  { id: '3840x2160', w: 3840, h: 2160, label: '3840 × 2160 (4K, 16:9)' },
  { id: '1440x1080', w: 1440, h: 1080, label: '1440 × 1080 (4:3)' },
  { id: '1080x1080', w: 1080, h: 1080, label: '1080 × 1080 (square)' },
  { id: '1080x1350', w: 1080, h: 1350, label: '1080 × 1350 (4:5)' },
  { id: '1080x1920', w: 1080, h: 1920, label: '1080 × 1920 (9:16, phone)' },
];
const fmtTime = (t: number) => (t < 100 ? t.toFixed(2) : t.toFixed(1));

/** Seconds of full warm-up at most (at 60 steps a second): beyond it the step grows. */
const FULL_STEPS = 1800;
/** While dragging: a quick, coarse warm-up. */
const DRAG_STEPS = 120;

export function CaptureDialog({ aspect, size: askedSize, from, onDone }: {
  aspect?: number;
  size?: { w: number; h: number };
  from?: Pick<CaptureSource, 'graph' | 'kind'>;
  onDone: (id: string | null) => void;
}) {
  const tk = useTokens();
  const compact = narrow();
  const presSize = useMemo(() => (aspect ? sizeForAspect(aspect) : null), [aspect]);
  const [size, setSize] = useState(() => (askedSize ? clampCaptureSize(askedSize.w, askedSize.h) : presSize ?? { w: 1920, h: 1080 }));
  const hiresOk = useCan('export.hires');
  const [custom, setCustom] = useState(false);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<CaptureMode>('play');
  const [time, setTime] = useState(0);
  const [range, setRange] = useState(20);
  const [playing, setPlaying] = useState(false);
  const [values, setValues] = useState<Record<string, Value>>({});
  const [name, setName] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [settling, setSettling] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pickRef = useRef<HTMLButtonElement>(null);

  // ── Choosing a graph ──────────────────────────────────────────────────────
  const choose = useCallback(async (row: PlayableRow) => {
    setPicking(false); setLoading(true); setError(null);
    const r = row.kind === 'saved' ? snapshotSaved(row.id) : await snapshotExample(row.id);
    setLoading(false);
    if (!r.ok) { setError(r.error); toast.error(`Couldn’t render “${row.label}”`, { message: r.error }); return; }
    const input = r.source.bundle;
    setLoaded({ row, input });
    setMode(hasPlayPicture(input) ? 'play' : 'graph');
    setValues({}); setName(null); setTime(0); setPlaying(false);
  }, []);
  useEffect(() => {
    if (!from) return;
    const label = from.kind === 'example' ? EXAMPLE_INDEX[from.graph]?.label ?? from.graph : from.graph;
    void choose({ kind: from.kind, id: from.graph, label, folder: '' });
  }, [from, choose]);

  const input = useMemo(() => (loaded ? captureInput(loaded.input, mode) : null), [loaded, mode]);
  const controls = useMemo(() => (loaded ? captureControls(loaded.input, mode) : []), [loaded, mode]);
  const warm = useMemo(() => (loaded ? needsWarmup(loaded.input, mode) : false), [loaded, mode]);
  const canPlay = !!loaded && hasPlayPicture(loaded.input);

  // ── The preview: the player at the capture's size, scaled to fit ─────────
  const boxRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [loaded]);
  const k = box.w && box.h ? Math.min(box.w / size.w, box.h / size.h) : 0;

  const mount = useRef<PlayMount | null>(null);
  const timeRef = useRef(time);
  const valuesRef = useRef(values);
  const warmRef = useRef(warm);
  useEffect(() => { timeRef.current = time; valuesRef.current = values; warmRef.current = warm; });
  const settleTimer = useRef(0);
  const frameReq = useRef(0);

  /** Draw the frame at the current time: coarse warm-up (dragging) or exact. */
  const draw = useCallback((exact: boolean, capture = false): HTMLCanvasElement | null => {
    const m = mount.current;
    if (!m?.renderAt) return null;
    const plan = warmRef.current ? captureSteps(timeRef.current, { maxSteps: exact ? FULL_STEPS : DRAG_STEPS }) : { dt: 1 / 60, steps: [] as number[] };
    return m.renderAt(timeRef.current, { steps: plan.steps, dt: plan.dt, seed: 1, capture }) ?? null;
  }, []);
  const redraw = useCallback(() => {
    cancelAnimationFrame(frameReq.current);
    frameReq.current = requestAnimationFrame(() => draw(false));
    window.clearTimeout(settleTimer.current);
    if (warmRef.current) setSettling(true);
    settleTimer.current = window.setTimeout(() => { draw(true); setSettling(false); }, 260);
  }, [draw]);

  useEffect(() => {
    const el = hostRef.current;
    if (!el || !input) return;
    let m: PlayMount | null = null;
    try {
      m = mountPlay(el, input, { panel: false, pointer: false, markers: false, maxDpr: 1, fit: 'cover', paused: true, startTime: timeRef.current, pixelSize: { w: size.w, h: size.h } });
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); return; }
    mount.current = m;
    for (const [id, v] of Object.entries(valuesRef.current)) m.set?.(id, v);
    // Give images and fonts a moment to arrive, then draw the moment exactly.
    const t = window.setTimeout(() => { draw(true); }, 350);
    return () => { window.clearTimeout(t); mount.current = null; m?.destroy(); };
  }, [input, size.w, size.h, draw]);

  // Scrubbing and control changes redraw the still (while paused).
  useEffect(() => { if (!playing) redraw(); }, [time, values, playing, redraw]);

  // Playing: the player's own clock runs; the scrubber follows it.
  useEffect(() => {
    if (!playing) return;
    const m = mount.current;
    m?.play?.();
    const t0 = timeRef.current, start = performance.now();
    let raf = 0;
    const step = () => { const t = t0 + (performance.now() - start) / 1000; setTime(t); if (t > range) setRange(Math.ceil(t * 1.5)); raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); m?.pause?.(); };
  }, [playing, range]);

  useEffect(() => () => { window.clearTimeout(settleTimer.current); cancelAnimationFrame(frameReq.current); }, []);

  const setValue = (id: string, v: Value) => { setValues(s => ({ ...s, [id]: v })); mount.current?.set?.(id, v); };
  const valueOf = (id: string): Value | undefined => {
    if (id in values) return values[id];
    const c = controls.find(x => x.id === id);
    return loaded && c ? baseValue(loaded.input, c) : undefined;
  };

  const title = loaded?.row.label ?? '';
  const shownName = name ?? (loaded ? captureName(title, time) : '');

  // ── Capture ───────────────────────────────────────────────────────────────
  const capture = async () => {
    // Free captures up to 1080 on the short side; bigger is Pro (lib/plan.ts).
    if (Math.min(size.w, size.h) > 1080 && !requireFeature('export.hires')) return;
    if (!loaded) return;
    setPlaying(false);
    setSaving(true);
    try {
      await new Promise(r => requestAnimationFrame(r));
      let canvas = draw(true, true);
      if (!canvas) throw new Error('The picture isn’t ready yet. Try again in a moment.');
      if (canvas.width !== size.w || canvas.height !== size.h) {
        // A browser zoomed out (fewer device pixels than CSS pixels) draws smaller: bring it to the size asked for.
        const c = document.createElement('canvas');
        c.width = size.w; c.height = size.h;
        c.getContext('2d')?.drawImage(canvas, 0, 0, size.w, size.h);
        canvas = c;
      }
      const blob = await new Promise<Blob | null>(r => canvas!.toBlob(r, 'image/png'));
      if (!blob) throw new Error('This browser couldn’t make a PNG of the picture.');
      const meta = await addImage(blob, {
        name: shownName, width: canvas.width, height: canvas.height,
        source: { graph: loaded.row.id, kind: loaded.row.kind, time: Number(time.toFixed(3)), mode },
      });
      toast.success(`Captured “${meta.name}”`, { message: `${meta.width} × ${meta.height}, in the Library’s Image backgrounds.` });
      onDone(meta.id);
    } catch (e) {
      toast.error('Couldn’t capture it', { message: e instanceof Error ? e.message : String(e) });
    } finally { setSaving(false); }
  };

  // ── Pieces ────────────────────────────────────────────────────────────────
  const label = (text: string) => <span style={{ color: tk.text.secondary, font: `600 11.5px ${fontFamily.ui}` }}>{text}</span>;
  const note = (text: React.ReactNode) => <div style={{ color: tk.text.faint, font: `500 11.5px/1.45 ${fontFamily.ui}` }}>{text}</div>;
  const sizeId = SIZES.find(s => s.w === size.w && s.h === size.h)?.id;
  const presId = presSize ? `pres:${presSize.w}x${presSize.h}` : null;
  const selectValue = custom ? 'custom' : presSize && presSize.w === size.w && presSize.h === size.h ? presId! : sizeId ?? 'custom';

  const list = (
    <PlayableList all current={null} onDone={() => {}} onPick={row => { void choose(row); }} />
  );

  const graphButton = (
    <button ref={pickRef} type="button" onClick={() => setPicking(p => !p)} aria-expanded={picking}
      style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', minWidth: 0, height: 36, padding: '0 10px', border: 0, borderRadius: radius.md, cursor: 'pointer', background: tk.bg.field, color: tk.text.primary, textAlign: 'left' }}>
      <Icon name="graphs" size={15} style={{ color: tk.accent.base, flexShrink: 0 }} />
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', font: `600 12.5px ${fontFamily.ui}` }}>{loading ? 'Loading…' : title || 'Choose a graph'}</span>
      <span style={{ color: tk.text.faint, font: `500 11px ${fontFamily.ui}`, flexShrink: 0 }}>{loaded?.row.kind === 'example' ? 'Example' : loaded ? 'Saved' : ''}</span>
      <Icon name="chevD" size={14} style={{ color: tk.text.faint, flexShrink: 0 }} />
    </button>
  );

  const preview = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0, minHeight: 0, flex: 1 }}>
      <div ref={boxRef} style={{
        position: 'relative', flex: compact && loaded ? 'none' : 1, minHeight: compact ? 0 : 280, height: compact ? `min(46dvh, ${Math.round((window.innerWidth - 32) * size.h / size.w)}px)` : undefined,
        borderRadius: radius.lg, overflow: 'hidden',
        background: `repeating-conic-gradient(${alpha(tk.text.primary, 0.05)} 0 25%, transparent 0 50%) 0 0 / 16px 16px, ${tk.bg.field}`,
      }}>
        {loaded ? (
          <div style={{ position: 'absolute', left: (box.w - size.w * k) / 2, top: (box.h - size.h * k) / 2, width: size.w * k, height: size.h * k, boxShadow: `0 1px 8px ${alpha('#000000', 0.25)}`, overflow: 'hidden', background: '#000' }}>
            <div ref={hostRef} style={{ width: size.w, height: size.h, transform: `scale(${k})`, transformOrigin: '0 0' }} />
          </div>
        ) : (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: tk.bg.panel, borderRadius: radius.lg, boxShadow: `inset 0 0 0 1px ${tk.border.subtle}` }}>
            <div style={{ padding: '12px 14px 0', display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ font: `650 13.5px ${fontFamily.ui}`, color: tk.text.primary }}>Which graph?</span>
              <span style={{ font: `500 12px ${fontFamily.ui}`, color: tk.text.muted }}>{loading ? 'Loading it…' : 'One of your saved graphs, or an example. Any graph works; a Play setup adds its controls and layers.'}</span>
            </div>
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', opacity: loading ? 0.5 : 1 }}>{list}</div>
          </div>
        )}
        {loaded && (settling || saving) && (
          <span style={{ position: 'absolute', right: 10, top: 10, padding: '3px 8px', borderRadius: 10, background: alpha('#000000', 0.55), color: '#fff', font: `600 11px ${fontFamily.ui}` }}>{saving ? 'Capturing…' : 'Settling the layers…'}</span>
        )}
        {error && loaded && <span style={{ position: 'absolute', left: 10, right: 10, bottom: 10, padding: '8px 10px', borderRadius: radius.md, background: alpha(tk.status.danger, 0.92), color: '#fff', font: `500 12px ${fontFamily.ui}` }}>{error}</span>}
      </div>
      {loaded && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <IconButton icon={playing ? 'pause' : 'play'} label={playing ? 'Pause' : 'Play from here'} onClick={() => setPlaying(p => !p)} style={compact ? { width: 40, height: 40 } : undefined} />
          <input type="range" aria-label="Time" min={0} max={range} step={0.01} value={Math.min(time, range)}
            onChange={e => { setPlaying(false); setTime(Number(e.target.value)); }}
            style={{ flex: 1, minWidth: 0, accentColor: tk.accent.base, height: compact ? 32 : 22 }} />
          <Field aria-label="Time in seconds" height={30} style={{ width: 92 }} suffix="s" inputMode="decimal" mono
            value={fmtTime(time)}
            onChange={e => { const v = Number(e.target.value); if (!Number.isFinite(v) || v < 0) return; setPlaying(false); setTime(v); if (v > range) setRange(Math.ceil(v * 1.25)); }} />
          <IconButton icon="reset" label="Back to 0 s" onClick={() => { setPlaying(false); setTime(0); }} />
        </div>
      )}
    </div>
  );

  const graphSection = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {label('Graph')}
      {graphButton}
      {picking && !compact && (
        <Popover anchorRef={pickRef} onClose={() => setPicking(false)} align="end" width={360} padding={0}>
          <div style={{ maxHeight: 'min(64vh, 520px)', display: 'flex', flexDirection: 'column' }}>{list}</div>
        </Popover>
      )}
      {picking && compact && <div style={{ height: '50dvh', display: 'flex', flexDirection: 'column', borderRadius: radius.md, boxShadow: `inset 0 0 0 1px ${tk.border.subtle}` }}>{list}</div>}
    </div>
  );
  const rest = loaded && (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {label('Render')}
            <Segmented<CaptureMode> fill ariaLabel="Render" value={mode} onChange={setMode} options={[
              { value: 'graph', label: 'Graph', title: 'The shader alone' },
              { value: 'play', label: 'Play', title: canPlay ? 'The shader with its Play layers and background' : 'This graph has no layers or background on Play', disabled: !canPlay },
            ]} />
            {note(mode === 'play' ? 'The shader with its layers, as Play shows it.' : canPlay ? 'The shader alone: no layers, no Play background.' : 'The shader. This graph draws nothing over it on Play.')}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {label('Size')}
            <Select ariaLabel="Size" height={32} value={selectValue} style={{ width: '100%' }}
              options={[
                ...(presSize ? [{ value: presId!, label: `The presentation’s shape (${presSize.w} × ${presSize.h})` }] : []),
                ...SIZES.map(s => ({ value: s.id, label: !hiresOk && Math.min(s.w, s.h) > 1080 ? `${s.label} · Pro` : s.label })),
                { value: 'custom', label: 'Another size…' },
              ]}
              onChange={v => {
                if (v === 'custom') { setCustom(true); return; }
                setCustom(false);
                if (presSize && v === presId) { setSize(presSize); return; }
                const s = SIZES.find(x => x.id === v);
                if (s && !hiresOk && Math.min(s.w, s.h) > 1080) { openProSheet('export.hires'); return; }
                if (s) setSize({ w: s.w, h: s.h });
              }} />
            {(custom || selectValue === 'custom') && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Field aria-label="Width in pixels" height={30} mono inputMode="numeric" suffix="px" defaultValue={String(size.w)}
                  onBlur={e => setSize(s => clampCaptureSize(Number(e.target.value), s.h))} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
                <span style={{ color: tk.text.faint }}>×</span>
                <Field aria-label="Height in pixels" height={30} mono inputMode="numeric" suffix="px" defaultValue={String(size.h)}
                  onBlur={e => setSize(s => clampCaptureSize(s.w, Number(e.target.value)))} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
              </div>
            )}
            {note(`${size.w} × ${size.h} pixels${size.w * size.h > 2560 * 1440 ? ' · large: capturing takes a moment' : ''}. Up to ${CAPTURE_MAX_SIDE} on a side.`)}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {label('Controls')}
            {controls.length === 0 && note(loaded.input.play.controls.length ? 'Its Play controls all move layers, which Graph leaves out.' : 'This graph has no Play setup, so nothing to set here: it renders as saved.')}
            {controls.map(c => {
              const v = valueOf(c.id);
              return (
                <div key={c.id} style={{ display: 'flex', flexDirection: 'column', gap: 5, padding: '8px 10px 10px', borderRadius: radius.md, background: tk.bg.field }}>
                  <span style={{ color: tk.text.primary, font: `600 12px ${fontFamily.ui}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.label}</span>
                  {c.kind === 'color'
                    ? <ColourPad value={Array.isArray(v) ? v : [0, 0, 0]} disabled={false} onChange={nv => setValue(c.id, nv)} />
                    : <RulerSlider value={typeof v === 'number' ? v : c.min} min={c.min} max={c.max} step={c.step ?? 0.01} ariaLabel={c.label} touch={compact} onChange={nv => setValue(c.id, nv)} />}
                </div>
              );
            })}
            {controls.length > 0 && Object.keys(values).length > 0 && (
              <Button size="sm" variant="ghost" icon="reset" style={{ alignSelf: 'flex-start' }} onClick={() => {
                for (const c of controls) { const b = loaded ? baseValue(loaded.input, c) : undefined; if (b !== undefined) mount.current?.set?.(c.id, b); }
                setValues({});
              }}>Back to the saved values</Button>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {label('Name')}
            <Field aria-label="Name" height={32} value={shownName} onChange={e => setName(e.target.value)} />
            {warm && note('Its layers or feedback build up over time: they are run from 0 s to this moment before each still, so the same time always gives the same picture.')}
          </div>
        </>
  );

  const actions = (
    <>
      <span style={{ flex: 1, color: tk.text.faint, font: `500 11.5px ${fontFamily.ui}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {loaded && !compact ? `Saves a ${size.w} × ${size.h} PNG to Image backgrounds` : ''}
      </span>
      <Button variant="ghost" onClick={() => onDone(null)}>Cancel</Button>
      <Button variant="primary" icon="camera" disabled={!loaded || saving} onClick={() => void capture()}>{saving ? 'Capturing…' : 'Capture'}</Button>
    </>
  );

  if (compact) {
    return (
      <Sheet title="Capture a background" onClose={() => onDone(null)} maxHeight="94dvh">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingBottom: 8 }}>
          {loaded && graphSection}
          <div style={{ height: loaded ? undefined : '62dvh', display: 'flex', flexDirection: 'column' }}>{preview}</div>
          {loaded && <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>{rest}</div>}
          <div style={{ position: 'sticky', bottom: 0, display: 'flex', gap: 8, alignItems: 'center', padding: '10px 0 4px', background: tk.bg.panel }}>{actions}</div>
        </div>
      </Sheet>
    );
  }

  return (
    <Modal title="Capture a background" subtitle="A still from a graph, at the moment you choose" icon="camera" onClose={() => onDone(null)} width={1080} height={Math.min(760, typeof window !== 'undefined' ? window.innerHeight - 32 : 760)} footer={actions}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 300px', height: '100%', minHeight: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', padding: 16, minHeight: 0, minWidth: 0 }}>{preview}</div>
        <div style={{ borderLeft: `1px solid ${tk.border.subtle}`, padding: 16, overflowY: 'auto', minHeight: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>{graphSection}{rest}</div>
      </div>
    </Modal>
  );
}
