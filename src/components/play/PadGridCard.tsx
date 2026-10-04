/**
 * PadGridCard — the Play record's pad grid, under the mappings: which
 * controller (Push, Launchpad, or a grid learned by tapping two corners),
 * where its pads land on the shader's cells (offset, scale, flips), how a
 * cell answers a hit (hold, latch, decay), and a live picture of the cells
 * that can be clicked like pads when no controller is attached.
 *
 * The graph reads the cells with the Pad Grid node; mappings read the last
 * pad with the Pad grid source.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { padGrid } from '../../lib/padGrid';
import { midiEngine } from '../../lib/midiEngine';
import { claimMidiListen } from '../../lib/midiAutoLearn';
import { DEFAULT_PAD_GRID, PAD_GRID_LAYOUTS, PAD_GRID_MAX, PAD_GRID_MODES, type PadGridLayout, type PlayPadGrid } from '../../types/playMidi';
import { kmLayoutOf, kmLearnGrid, kmNoteName } from '../../play/kit/midi.js';
import { padsForCells } from './midiUi';
import { CHANNELS } from '../../play/playSources';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Button, IconButton } from '../ui/Button';
import { Segmented, Toggle } from '../ui/Choice';
import { Icon } from '../ui/Icon';
import { Select } from '../ui/Select';
import { NumberInput } from '../NodeGraph/NumberInput';
import { toast } from '../ui/toastStore';

export function PadGridCard() {
  const tk = useTokens();
  const pg = useNodeGraphStore(s => s.play.padGrid);
  const setPlay = useNodeGraphStore(s => s.setPlay);
  if (!pg) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
        <Button size="sm" variant="ghost" icon="grid" onClick={() => setPlay(p => ({ ...p, padGrid: { ...DEFAULT_PAD_GRID } }))}
          title="A Push or Launchpad's pads (or pads on screen) as a grid shader's cells: the Pad Grid node reads them">
          Set up a pad grid
        </Button>
        <span style={{ color: tk.text.faint, font: `11px ${fontFamily.ui}` }}>Push, Launchpad or on-screen pads as grid cells</span>
      </div>
    );
  }
  return <PadGridEditor pg={pg} />;
}

function PadGridEditor({ pg }: { pg: PlayPadGrid }) {
  const tk = useTokens();
  const setPlay = useNodeGraphStore(s => s.setPlay);
  const patch = (p: Partial<PlayPadGrid>) => setPlay(r => (r.padGrid ? { ...r, padGrid: { ...r.padGrid, ...p } } : r));
  const geo = kmLayoutOf(pg);
  const [devices, setDevices] = useState(() => midiEngine.webMidi().inputs);
  useEffect(() => midiEngine.subscribe(e => { if (e.kind === 'devices') setDevices(midiEngine.webMidi().inputs); }), []);

  // Learn the grid: the bottom-left pad, then the top-right one.
  const [learn, setLearn] = useState<null | { step: 'bl' | 'tr'; bl?: number; device?: string }>(null);
  const [padCols, setPadCols] = useState(geo.cols);
  const [padRows, setPadRows] = useState(geo.rows);
  useEffect(() => {
    if (!learn) return;
    // Waiting for pads: an unassigned CC row doesn't take a knob meanwhile (lib/midiAutoLearn.ts).
    const release = claimMidiListen();
    const off = midiEngine.subscribe(e => {
      if (e.kind !== 'noteOn') return;
      if (learn.step === 'bl') { setLearn({ step: 'tr', bl: e.note, device: e.device ?? '' }); return; }
      const g = kmLearnGrid(learn.bl ?? e.note, e.note, padCols, padRows);
      setLearn(null);
      if (!g) {
        toast.error('Couldn’t work out the pads', { message: `From ${kmNoteName(learn.bl ?? 0)} (${learn.bl}) to ${kmNoteName(e.note)} (${e.note}) no ${padCols} × ${padRows} layout fits. Check the pad count, then tap the bottom-left pad first.` });
        return;
      }
      patch({ layout: 'learned', learned: g, device: learn.device || pg.device });
      toast.success('Pads learned', { message: `${g.cols} × ${g.rows} pads, ${g.origin} bottom-left, ${g.rowStep} notes a row.` });
    });
    return () => { off(); release(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [learn, padCols, padRows, pg]);

  const label = { color: tk.text.faint, font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.04em', textTransform: 'uppercase' as const, width: 54, flexShrink: 0 };
  const num = { width: 44, height: 24, borderRadius: 6, border: 0, background: tk.bg.panel, color: tk.text.primary, font: `500 11px ${fontFamily.mono}`, textAlign: 'center' as const };
  const row = { display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, flexWrap: 'wrap' as const };
  const hint = (t: string) => <span style={{ color: tk.text.faint, font: `11px ${fontFamily.ui}` }}>{t}</span>;
  const deviceOptions = [{ value: '', label: 'Any device' }, ...[...new Set([...devices, ...(pg.device ? [pg.device] : [])])].map(d => ({ value: d, label: d }))];
  const fit = () => {
    const s = Math.min(pg.cols / geo.cols, pg.rows / geo.rows);
    patch({ scale: Math.max(0.25, Math.min(8, Math.round(s * 4) / 4)), offsetX: 0, offsetY: 0 });
  };

  return (
    <div data-testid="pad-grid-card" style={{ margin: '8px 0 4px', padding: '8px 10px', borderRadius: radius.md, background: tk.bg.field }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icon name="grid" size={14} style={{ color: tk.accent.base, flexShrink: 0 }} />
        <span style={{ font: `600 12px ${fontFamily.ui}` }}>Pad grid</span>
        <span style={{ color: tk.text.faint, font: `500 10.5px ${fontFamily.mono}` }}>{geo.cols}×{geo.rows} pads → {pg.cols}×{pg.rows} cells</span>
        <span style={{ flex: 1 }} />
        <IconButton icon="reset" label="Clear every cell (latched ones too)" size="sm" onClick={() => padGrid.clear()} />
        <IconButton icon="trash" label="Remove the pad grid" size="sm" tone="danger" onClick={() => setPlay(r => { const next = { ...r }; delete next.padGrid; return next; })} />
      </div>

      <div style={row}>
        <span style={label}>Pads</span>
        <Select ariaLabel="Pad layout" value={pg.layout} options={PAD_GRID_LAYOUTS.filter(l => l.value !== 'learned' || pg.learned).map(l => ({ value: l.value, label: l.label }))} onChange={v => patch({ layout: v as PadGridLayout })} height={26} style={{ flex: 1, minWidth: 120 }} />
        <Button size="sm" variant={learn ? 'primary' : 'secondary'} onClick={() => setLearn(l => (l ? null : { step: 'bl' }))} title="Tap the bottom-left pad, then the top-right one">
          {learn ? 'Cancel' : 'Learn the grid'}
        </Button>
      </div>
      {learn && (
        <div style={{ margin: '6px 0 0 60px', padding: '6px 10px', borderRadius: radius.md, background: alpha(tk.accent.base, 0.1), color: tk.accent.text, font: `600 11.5px ${fontFamily.ui}`, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {learn.step === 'bl' ? 'Tap the bottom-left pad…' : `Bottom-left is ${learn.bl}. Now tap the top-right pad…`}
          <span style={{ fontWeight: 500 }}>Pads:</span>
          <NumberInput value={padCols} min={1} max={PAD_GRID_MAX} step={1} title="Pads across" onCommit={n => setPadCols(Math.max(1, Math.min(PAD_GRID_MAX, Math.round(n))))} style={{ ...num, width: 36 }} />
          ×
          <NumberInput value={padRows} min={1} max={PAD_GRID_MAX} step={1} title="Pads up" onCommit={n => setPadRows(Math.max(1, Math.min(PAD_GRID_MAX, Math.round(n))))} style={{ ...num, width: 36 }} />
        </div>
      )}
      <div style={row}>
        <span style={label}>From</span>
        <Select ariaLabel="Pad grid device" value={pg.device} options={deviceOptions} onChange={device => patch({ device })} height={26} style={{ flex: 1, minWidth: 110 }} />
        <Select ariaLabel="Pad grid channel" value={`${pg.channel}`} options={CHANNELS} onChange={v => patch({ channel: parseInt(v, 10) || 0 })} height={26} />
      </div>

      <div style={row}>
        <span style={label}>Cells</span>
        <NumberInput value={pg.cols} min={1} max={PAD_GRID_MAX} step={1} title="The shader grid's columns" onCommit={n => patch({ cols: Math.max(1, Math.min(PAD_GRID_MAX, Math.round(n))) })} style={num} />
        ×
        <NumberInput value={pg.rows} min={1} max={PAD_GRID_MAX} step={1} title="The shader grid's rows" onCommit={n => patch({ rows: Math.max(1, Math.min(PAD_GRID_MAX, Math.round(n))) })} style={num} />
        {hint('the shader’s grid')}
      </div>
      <div style={row}>
        <span style={label}>Align</span>
        <NumberInput value={pg.offsetX} min={-PAD_GRID_MAX} max={PAD_GRID_MAX} step={1} title="Move the pads right by this many cells" onCommit={n => patch({ offsetX: Math.round(n) })} style={num} />
        <NumberInput value={pg.offsetY} min={-PAD_GRID_MAX} max={PAD_GRID_MAX} step={1} title="Move the pads up by this many cells" onCommit={n => patch({ offsetY: Math.round(n) })} style={num} />
        {hint('offset')}
        <NumberInput value={pg.scale} min={0.25} max={8} step={0.25} title="Cells per pad (2: each pad lights 2 × 2 cells)" onCommit={n => patch({ scale: Math.max(0.25, Math.min(8, n)) })} style={num} />
        {hint('scale')}
      </div>
      <div style={row}>
        <span style={label} />
        <Toggle checked={pg.flipX} onChange={flipX => patch({ flipX })} label="Flip X" />
        <Toggle checked={pg.flipY} onChange={flipY => patch({ flipY })} label="Flip Y" />
        <Button size="sm" variant="ghost" onClick={fit} title="Scale the pads to cover the cells">Fit</Button>
      </div>
      <div style={row}>
        <span style={label}>A hit</span>
        <Segmented size="sm" ariaLabel="Cell mode" value={pg.mode} options={PAD_GRID_MODES} onChange={mode => patch({ mode })} />
        <NumberInput value={pg.release} min={0} max={10} step={0.05} title="Seconds a cell takes to fade out" onCommit={n => patch({ release: Math.max(0, Math.min(10, n)) })} style={num} />
        {hint('s release')}
      </div>
      <div style={row}>
        <span style={label} />
        <Toggle checked={pg.velocity} onChange={velocity => patch({ velocity })} label="Velocity" />
        <Toggle checked={pg.light} onChange={light => patch({ light })} label="Light the pads" />
        {pg.light && !pg.device && hint('Pick the device to light its pads')}
        {pg.light && pg.device && !midiEngine.outputsNamed(pg.device).length && hint('No MIDI out with that name here (Chrome, Edge or the desktop app)')}
      </div>
      <CellPicture pg={pg} />
      <div style={{ marginTop: 6, color: tk.text.faint, font: `11px/1.4 ${fontFamily.ui}` }}>
        Click the cells to play them without a controller. In the graph, the <b>Pad Grid</b> node reads each cell; mappings read the last pad with the <b>Pad grid</b> source.
      </div>
    </div>
  );
}

/** The cells as the shader sees them (row 0 at the bottom), lit by their level; a click presses the pad over a cell. */
function CellPicture({ pg }: { pg: PlayPadGrid }) {
  const tk = useTokens();
  const canvas = useRef<HTMLCanvasElement>(null);
  const held = useRef<number | null>(null);
  const pads = useMemo(() => padsForCells(pg), [pg]);
  const size = Math.max(6, Math.min(26, Math.floor(260 / Math.max(pg.cols, pg.rows))));
  const w = pg.cols * size, h = pg.rows * size;
  // A cell a pad covers is a tile; one no pad reaches is only faintly there.
  const accent = tk.accent.base, empty = alpha(tk.text.faint, 0.22), off = alpha(tk.text.faint, 0.06);
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = 0;
      const ctx = canvas.current?.getContext('2d');
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      for (let r = 0; r < pg.rows; r++) for (let c = 0; c < pg.cols; c++) {
        const i = r * pg.cols + c, x = c * size, y = (pg.rows - 1 - r) * size;
        ctx.fillStyle = pads[i] < 0 ? off : empty;
        ctx.fillRect(x + 1, y + 1, size - 2, size - 2);
        const v = padGrid.level(i);
        if (v > 0) { ctx.globalAlpha = Math.min(1, v); ctx.fillStyle = accent; ctx.fillRect(x + 1, y + 1, size - 2, size - 2); ctx.globalAlpha = 1; }
      }
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(draw); };
    schedule();
    const off2 = padGrid.subscribe(schedule);
    return () => { off2(); if (raf) cancelAnimationFrame(raf); };
  }, [pg, pads, size, w, h, accent, empty, off]);

  const padAt = (e: React.PointerEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const c = Math.floor(((e.clientX - rect.left) / rect.width) * pg.cols);
    const r = pg.rows - 1 - Math.floor(((e.clientY - rect.top) / rect.height) * pg.rows);
    if (c < 0 || r < 0 || c >= pg.cols || r >= pg.rows) return -1;
    return pads[r * pg.cols + c];
  };
  const geoCols = kmLayoutOf(pg).cols;
  const up = () => {
    if (held.current === null) return;
    padGrid.release(held.current % geoCols, Math.floor(held.current / geoCols));
    held.current = null;
  };
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  return (
    <canvas
      ref={canvas}
      data-testid="pad-grid-cells"
      width={w * dpr}
      height={h * dpr}
      aria-label="The pad grid's cells: click to play a pad"
      onPointerDown={e => {
        const p = padAt(e);
        if (p < 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        held.current = p;
        padGrid.press(p % geoCols, Math.floor(p / geoCols), e.shiftKey ? 1 : 0.8);
      }}
      onPointerUp={up}
      onPointerCancel={up}
      style={{ display: 'block', width: w, maxWidth: '100%', height: 'auto', aspectRatio: `${w} / ${h}`, marginTop: 8, borderRadius: 6, cursor: 'pointer', touchAction: 'none', background: tk.bg.panel }}
    />
  );
}
