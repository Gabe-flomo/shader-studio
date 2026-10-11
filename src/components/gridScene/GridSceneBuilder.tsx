/**
 * GridSceneBuilder — the Grid builder window (docs/grid-builder.md), the Scene builder's Grid scene
 * kind, on the shared StudioShell:
 *
 *   ┌ Scene builder › Grid scene ── Surprise · undo · Make it a simulation · Build · Done ┐
 *   │ mini grid (draw)   │        live preview (what Build makes)       │ the section's     │
 *   │ brush · size       │                                              │ settings          │
 *   │ sections           │                                              │                   │
 *   ├────────────────────┴──────────────────────────────────────────────┴───────────────────┤
 *   │ starting points                                                                         │
 *   └─────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Sections: Shapes, Motion, Patterns & warps, Rules, Look. Every number is a BuilderSlider; the
 * ones that end up on the Shape and Grid scene nodes are uniforms there, so the built graph's
 * sliders never recompile either.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useBuilderPreview, useThrottled } from '../builders/useBuilderPreview';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { StudioShell, StudioLabel, StudioNavItem, PresetCard } from '../builders/studio/StudioShell';
import { SceneCrumb } from '../builders/SceneCrumb';
import { BuilderSlider } from '../builders/BuilderSlider';
import { BuilderNote } from '../builders/BuilderWindow';
import { Card, ColourRow, NumRow, Row } from '../sceneBuilder/controls';
import { Button, IconButton } from '../ui/Button';
import { Select } from '../ui/Select';
import { Toggle } from '../ui/Choice';
import type { IconName } from '../ui/iconPaths';
import { SurpriseBar } from '../surprise/SurpriseBar';
import { announceSurprise } from '../surprise/announce';
import { newSeed } from '../../lib/surprise';
import { BlockLibrary } from '../sceneBuilder2d/SpaceBlocks';
import { backToSceneKinds } from '../../builders/sceneKinds';
import { useBuilderRecipeRequest } from '../../builders/windows';
import { pickingKey, useGridBuilder, type GridSection } from '../../gridScene/store';
import { SIM_RULES, buildFromGridBuilder, finishGridBuilder, makeSimulation, simulationOf } from '../../gridScene/actions';
import { Popover } from '../ui/Popover';
import { MAX_SEARCH, gridProgram, searchCapped } from '../../gridScene/glsl';
import { GRID_TEMPLATES } from '../../gridScene/templates';
import {
  DO_KINDS, DO_LABELS, DRAW_MODES, DRAW_MODE_LABELS, MAX_CELLS, MAX_PLACED, PIC_MODES, PIC_MODE_LABELS, defaultDraw, drawOf, picModeOf, MAX_RULES, MAX_SHAPES, MAX_WARPS, MIN_CELLS, MOTION_LABELS, MOTION_PATHS, PATTERN_KINDS, PATTERN_LABELS,
  PATTERN_TARGETS, SHAPE_KINDS, SHAPE_LABELS, TARGET_LABELS, WHEN_KINDS, WHEN_LABELS, defaultLook, defaultPattern, newRule, newShape, nextShapeId,
  removeShape, resizeGrid, ruleProblem, ruleText, shapeOf, shapeSummary, shownCells, warpOf, JOINS, MAX_ALSO, clauseNeedsB, ruleClauses, MAX_SIM_STATE, simStateOf,
  type DoKind, type DrawMode, type GridClause, type GridDo, type GridRule, type Join, type GShape, type PicMode, type GridSceneSpec, type MotionPath, type PatternKind, type PatternTarget, type ShapeKind, type Vec2, type WhenKind,
} from '../../gridScene/spec';
import { MiniGrid } from './MiniGrid';
import { Field } from '../ui/Field';
import { DEFAULT_TEXT_MASK, MAX_MASK_SIZE, MIN_MASK_SIZE, readTextMask, type TextMask } from '../../gridScene/textMask';
import { cleanStartText, MAX_TEXT_CHARS } from '../../gridRules/textCells';
import { compileGridScene, drawGlyph, gridPicture, rgb } from './glyphs';
import { TexturePicker } from '../builders/TexturePicker';
import { withSource, type TexSource } from '../../builders/textures';

const edit = (fn: (d: GridSceneSpec) => void, key?: string) => useGridBuilder.getState().edit(fn, key);
/** Adds a picture to the scene's list (the shared picker's onAdd, docs/grid-builder.md "Textures"). */
const addSource = (src: TexSource) => edit(d => { d.textures = withSource(d.textures, src); });
const DEFAULT_SHAPE = newShape('A');
const DEFAULT_PATTERN = defaultPattern();
const DEFAULT_LOOK = defaultLook();

// ── Small pieces ──────────────────────────────────────────────────────────────

function Glyph({ kind, color, size = 22, outline = 0 }: { kind: ShapeKind; color: [number, number, number]; size?: number; outline?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    const ctx = cv?.getContext('2d');
    if (!cv || !ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = size * dpr; cv.height = size * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    drawGlyph(ctx, kind, size / 2, size / 2, size * 0.38, rgb(color), outline);
  }, [kind, color, size, outline]);
  return <canvas ref={ref} aria-hidden style={{ width: size, height: size, display: 'block', flexShrink: 0 }} />;
}

function Tiles<T extends string>({ items, value, onPick, label, render, cols = 5 }: { items: readonly T[]; value: T; onPick: (v: T) => void; label: (v: T) => string; render?: (v: T) => ReactNode; cols?: number }) {
  const tk = useTokens();
  return (
    <div role="radiogroup" style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: 4 }}>
      {items.map(v => {
        const on = v === value;
        return (
          <button key={v} type="button" role="radio" aria-checked={on} data-tile={v} title={label(v)} onClick={() => onPick(v)}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: '6px 2px', border: 0, borderRadius: radius.sm, cursor: 'pointer',
              background: on ? tk.bg.selected : tk.bg.field, color: on ? tk.accent.text : tk.text.secondary, font: `500 10.5px ${fontFamily.ui}`,
              boxShadow: on ? `inset 0 0 0 1px ${alpha(tk.accent.base, 0.5)}` : 'none', minWidth: 0,
            }}>
            {render?.(v)}
            <span style={{ maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label(v)}</span>
          </button>
        );
      })}
    </div>
  );
}

/** The XY control: drag the point to set how far the shape moves (cells, y up), its path drawn round it. */
function XYPad({ value, onChange, shape, range = 2 }: { value: Vec2; onChange: (v: Vec2) => void; shape: GShape; range?: number }) {
  const tk = useTokens();
  const ref = useRef<HTMLCanvasElement>(null);
  const size = 132;
  useEffect(() => {
    const cv = ref.current;
    const ctx = cv?.getContext('2d');
    if (!cv || !ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = size * dpr; cv.height = size * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = tk.bg.field; ctx.fillRect(0, 0, size, size);
    const px = (v: number) => size / 2 + (v / range) * (size / 2 - 8);
    ctx.strokeStyle = tk.border.default; ctx.lineWidth = 1;
    for (let i = -range; i <= range; i++) { ctx.beginPath(); ctx.moveTo(px(i), 0); ctx.lineTo(px(i), size); ctx.moveTo(0, px(i)); ctx.lineTo(size, px(i)); ctx.stroke(); }
    // The path over one cycle, from the centre (cell units, y up on screen).
    const m = { ...shape.motion, xy: value, lag: 0 };
    ctx.strokeStyle = rgb(shape.color, 0.9); ctx.lineWidth = 1.5; ctx.beginPath();
    for (let i = 0; i <= 64; i++) {
      // One cycle (forwards or back), without wrapping travel and hop round a grid.
      const p = motionAtRel(m.path, value, (i / 64) * Math.sign(m.speed || 1));
      const X = px(p[0]), Y = size - px(p[1]);
      if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y);
    }
    ctx.stroke();
    ctx.fillStyle = tk.accent.base;
    ctx.beginPath(); ctx.arc(px(value[0]), size - px(value[1]), 5, 0, Math.PI * 2); ctx.fill();
  }, [value, shape, range, tk]);
  const set = (e: React.PointerEvent) => {
    const r = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
    const fx = ((e.clientX - r.left) - size / 2) / (size / 2 - 8) * range;
    const fy = -((e.clientY - r.top) - size / 2) / (size / 2 - 8) * range;
    const q = (v: number) => Math.round(Math.max(-range, Math.min(range, v)) * 20) / 20;
    onChange([q(fx), q(fy)]);
  };
  return (
    <canvas ref={ref} data-xy-pad aria-label="Motion reach: drag to set X and Y" style={{ width: size, height: size, borderRadius: radius.md, cursor: 'crosshair', touchAction: 'none', flexShrink: 0 }}
      onPointerDown={e => { (e.currentTarget as HTMLCanvasElement).setPointerCapture?.(e.pointerId); set(e); }}
      onPointerMove={e => { if (e.buttons) set(e); }} />
  );
}

/** A path's offset from the home (cells, y up) at phase `ph` cycles: the XY pad's drawing. */
function motionAtRel(path: MotionPath, xy: Vec2, ph: number): Vec2 {
  const a = ph * Math.PI * 2;
  const [x, y] = xy;
  switch (path) {
    case 'updown': return [0, y * Math.sin(a)];
    case 'sideways': return [x * Math.sin(a), 0];
    case 'both': return [x * Math.sin(a), y * Math.sin(a)];
    case 'circle': return [x * Math.cos(a), y * Math.sin(a)];
    case 'eight': return [x * Math.sin(a), y * Math.sin(2 * a)];
    case 'bounce': return [0, y * Math.abs(Math.sin(a * 0.5))];
    case 'travel': return [x * ph, y * ph];
    case 'hop': return [x * Math.floor(ph * 3) / 3, y * Math.floor(ph * 3) / 3];
    default: return [0, 0];
  }
}

// ── Left: the mini grid, the brush, the sections ──────────────────────────────

const SECTIONS: Array<{ id: GridSection; label: string; icon: IconName; hint: string }> = [
  { id: 'shapes', label: 'Shapes', icon: 'mask', hint: 'The shapes you draw with: kind, colour, size, turn, spin, pulse, outline.' },
  { id: 'motion', label: 'Motion', icon: 'curve', hint: 'How the brush shape moves: up and down, side to side, both with the XY control, round, travelling.' },
  { id: 'patterns', label: 'Patterns & warps', icon: 'wave', hint: 'A wave over the cells (ripple, diagonal, checker, rings, spiral…) and warps that bend the grid.' },
  { id: 'rules', label: 'Rules', icon: 'bolt', hint: 'When … Do … between shapes, checked in the shader: become another shape, swap colours…' },
  { id: 'look', label: 'Look', icon: 'sun', hint: 'Background, grid lines, glow, tone.' },
];

function Brush() {
  const tk = useTokens();
  const shapes = useGridBuilder(s => s.spec.shapes);
  const brush = useGridBuilder(s => s.brush);
  const setBrush = useGridBuilder(s => s.setBrush);
  const chip = (on: boolean): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: 5, height: 30, padding: '0 8px 0 5px', border: 0, borderRadius: radius.md, cursor: 'pointer',
    background: on ? tk.bg.selected : tk.bg.field, color: on ? tk.accent.text : tk.text.secondary, font: `600 12px ${fontFamily.ui}`,
    boxShadow: on ? `inset 0 0 0 1.5px ${tk.accent.base}` : 'none',
  });
  return (
    <div role="radiogroup" aria-label="Brush" style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {shapes.map(s => (
        <button key={s.id} type="button" role="radio" aria-checked={brush === s.id} data-brush={s.id} style={chip(brush === s.id)} onClick={() => setBrush(s.id)}
          title={`Paint shape ${s.id} (${SHAPE_LABELS[s.kind].toLowerCase()})`}>
          <Glyph kind={s.kind} color={s.color} size={20} outline={s.outline} />{s.id}
        </button>
      ))}
      <button type="button" role="radio" aria-checked={brush === 'erase'} data-brush="erase" style={chip(brush === 'erase')} onClick={() => setBrush('erase')} title="Eraser: click or drag to clear cells (right-click clears with any brush)">
        <span style={{ width: 20, textAlign: 'center' }}>⌫</span>Erase
      </button>
    </div>
  );
}

/** The text stamp (docs/grid-builder.md "Text"): words in the stroke font, stamped onto the mini grid in the brush's shape. */
function TextStampRow() {
  const tk = useTokens();
  const stamp = useGridBuilder(s => s.textStamp);
  const setStamp = useGridBuilder(s => s.setTextStamp);
  return (
    <div data-text-stamp style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <Button size="sm" variant={stamp.on ? 'primary' : 'ghost'} icon="text" aria-pressed={stamp.on} data-text-stamp-toggle onClick={() => setStamp({ on: !stamp.on })}
        title="Text stamp: click the grid to fill the cells some words cover with the brush's shape">Text</Button>
      <span style={{ flex: 1, minWidth: 0 }}>
        <Field aria-label="Words to stamp" height={28} value={stamp.text} maxLength={MAX_TEXT_CHARS} data-text-stamp-words
          onChange={e => setStamp({ text: cleanStartText(e.target.value), on: true })} />
      </span>
      <span title="How many cells tall the letters are" style={{ fontSize: 11.5, color: tk.text.muted }}>tall</span>
      <span style={{ width: 56 }}>
        <Select ariaLabel="Letter height (cells)" height={28} value={String(stamp.size)} onChange={v => setStamp({ size: Number(v) })}
          options={[3, 4, 5, 6, 7, 8, 10, 12].map(n => ({ value: String(n), label: String(n) }))} />
      </span>
    </div>
  );
}

/** How the drawing covers the grid (docs/grid-builder.md "Draw modes"): only here, repeat, mirror, rotate. */
function DrawModeRow() {
  const tk = useTokens();
  const stored = useGridBuilder(s => s.spec.draw);
  const draw = drawOf({ draw: stored });
  const cols = useGridBuilder(s => s.spec.cols);
  const rows = useGridBuilder(s => s.spec.rows);
  const set = (fn: (d: NonNullable<GridSceneSpec['draw']>) => void, key?: string) => edit(d => { const x = { ...defaultDraw(), ...(d.draw ?? {}) }; fn(x); d.draw = x.mode === 'here' ? null : x; }, key);
  const lbl: React.CSSProperties = { fontSize: 12, color: tk.text.secondary };
  return (
    <div data-draw-mode style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={lbl} title={DRAW_MODES.map(m => `${DRAW_MODE_LABELS[m].label}: ${DRAW_MODE_LABELS[m].blurb}`).join('\n')}>Draw mode</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <Select ariaLabel="Draw mode" height={28} value={draw.mode} options={DRAW_MODES.map(m => ({ value: m, label: DRAW_MODE_LABELS[m].label }))} onChange={v => set(d => { d.mode = v as DrawMode; })} />
        </span>
      </div>
      {draw.mode !== 'here' && <span style={{ fontSize: 11.5, color: tk.text.muted, lineHeight: 1.4 }}>{DRAW_MODE_LABELS[draw.mode].blurb} Copies show faintly; the outlined cells are the ones you draw in.</span>}
      {draw.mode !== 'here' && (
        <div data-draw-copies style={{ display: 'flex', alignItems: 'center', gap: 8 }}
          title="Off: each copy runs as the cell it is in, so the lag ripples across the copies and rules and pictures see where it is. On: every copy runs as the cell you drew, so they all move and look alike.">
          <Toggle checked={draw.copies === 'source'} onChange={v => set(d => { d.copies = v ? 'source' : 'shown'; })} label="Copies match the drawn cell" />
        </div>
      )}
      {draw.mode === 'repeat' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr)', alignItems: 'center', gap: '6px 10px' }}>
          <span style={lbl} title="The tile's size: it repeats every this many cells across">Period X</span>
          <BuilderSlider value={draw.period[0]} min={1} max={cols} integer ariaLabel="Repeat period X" defaultValue={2} onChange={v => set(d => { d.period = [v, d.period[1]]; }, 'rpx')} />
          <span style={lbl} title="…and down">Period Y</span>
          <BuilderSlider value={draw.period[1]} min={1} max={rows} integer ariaLabel="Repeat period Y" defaultValue={2} onChange={v => set(d => { d.period = [d.period[0], v]; }, 'rpy')} />
          <span style={lbl} title="Where the tile starts, in cells">Offset X</span>
          <BuilderSlider value={draw.offset[0]} min={0} max={cols - 1} integer ariaLabel="Repeat offset X" defaultValue={0} onChange={v => set(d => { d.offset = [v, d.offset[1]]; }, 'rox')} />
          <span style={lbl} title="Where the tile starts, in cells">Offset Y</span>
          <BuilderSlider value={draw.offset[1]} min={0} max={rows - 1} integer ariaLabel="Repeat offset Y" defaultValue={0} onChange={v => set(d => { d.offset = [d.offset[0], v]; }, 'roy')} />
          <span style={lbl} title="Each row of tiles slides this many cells across: bricks and staggers">Row shift</span>
          <BuilderSlider value={draw.shift} min={-4} max={4} integer ariaLabel="Repeat row shift" defaultValue={0} onChange={v => set(d => { d.shift = v; }, 'rsh')} />
        </div>
      )}
    </div>
  );
}

function LeftPanel() {
  const tk = useTokens();
  const section = useGridBuilder(s => s.section);
  const setSection = useGridBuilder(s => s.setSection);
  const cols = useGridBuilder(s => s.spec.cols);
  const rows = useGridBuilder(s => s.spec.rows);
  const placed = useGridBuilder(s => s.spec.cells.length);
  const picking = useGridBuilder(s => s.picking);
  const stampOn = useGridBuilder(s => s.textStamp.on);
  const summaryKey = useGridBuilder(s => {
    const sp = s.spec;
    return JSON.stringify({
      shapes: `${sp.shapes.length} shape${sp.shapes.length === 1 ? '' : 's'}: ${sp.shapes.map(x => `${x.id} ${SHAPE_LABELS[x.kind].toLowerCase()}`).join(', ')}`,
      motion: sp.shapes.filter(x => x.motion.path !== 'still').map(x => `${x.id} ${MOTION_LABELS[x.motion.path].label.toLowerCase()}`).join(', ') || 'all still',
      patterns: `${sp.pattern.kind === 'none' ? 'no pattern' : PATTERN_LABELS[sp.pattern.kind].label.toLowerCase()}${sp.warps.length ? ` · ${sp.warps.length} warp${sp.warps.length === 1 ? '' : 's'}` : ''}`,
      rules: sp.rules.length ? `${sp.rules.filter(r => r.on).length} of ${sp.rules.length} on` : 'none',
      look: `${sp.look.lines ? 'lines' : 'no lines'}${sp.look.glow ? ' · glow' : ''}`,
    });
  });
  const summaries = useMemo(() => JSON.parse(summaryKey) as Record<GridSection, string>, [summaryKey]);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '14px 14px 18px' }}>
      <StudioLabel meta={`${placed} / ${MAX_PLACED} cells`}>Draw</StudioLabel>
      <Brush />
      <DrawModeRow />
      <TextStampRow />
      <MiniGrid size={288} />
      <span data-grid-hint style={{ fontSize: 11.5, color: picking || stampOn ? tk.status.warningText : tk.text.muted, lineHeight: 1.4 }}>
        {picking ? 'Click a cell for the rule (Esc to stop picking).' : stampOn ? 'Click the grid to stamp the words there in the brush\'s shape (right-click or Alt clears them). Turn Text off to draw cells again.' : 'Click or drag to place the brush; right-click or the eraser clears. The faint lines are the brush shape\'s motion.'}
      </span>
      <div style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr)', alignItems: 'center', gap: '6px 10px' }}>
        <span style={{ fontSize: 12, color: tk.text.secondary }}>Columns</span>
        <BuilderSlider value={cols} min={MIN_CELLS} max={MAX_CELLS} integer ariaLabel="Columns" defaultValue={10} onChange={v => edit(d => resizeGrid(d, v, d.rows), 'cols')} />
        <span style={{ fontSize: 12, color: tk.text.secondary }}>Rows</span>
        <BuilderSlider value={rows} min={MIN_CELLS} max={MAX_CELLS} integer ariaLabel="Rows" defaultValue={10} onChange={v => edit(d => resizeGrid(d, d.cols, v), 'rows')} />
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <Button size="sm" variant="ghost" icon="trash" disabled={!placed} onClick={() => edit(d => { d.cells = []; })} title="Clear every cell (undo brings them back)">Clear cells</Button>
      </div>
      <StudioLabel>Sections</StudioLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {SECTIONS.map(s => <StudioNavItem key={s.id} id={s.id} icon={s.icon} label={s.label} summary={summaries[s.id]} hint={s.hint} selected={section === s.id} onClick={() => setSection(s.id)} />)}
      </div>
    </div>
  );
}

// ── Right: the sections ───────────────────────────────────────────────────────

/** The brush's shape (what Shapes and Motion edit); the first shape while erasing. */
function useEditedShape(): GShape | undefined {
  return useGridBuilder(s => shapeOf(s.spec, s.brush) ?? s.spec.shapes[0]);
}
const editShape = (id: string, fn: (s: GShape) => void, key?: string) => edit(d => { const s = d.shapes.find(x => x.id === id); if (s) fn(s); }, key);

function ShapesSection() {
  const tk = useTokens();
  const shapes = useGridBuilder(s => s.spec.shapes);
  const spec = useGridBuilder(s => s.spec);
  const sh = useEditedShape();
  const setBrush = useGridBuilder(s => s.setBrush);
  const add = () => {
    const id = nextShapeId(useGridBuilder.getState().spec);
    if (!id) return;
    edit(d => { d.shapes.push(newShape(id)); });
    setBrush(id);
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <BuilderNote>The shapes you draw with. Pick one to paint with it and edit it here; its sliders become the Shape node's, live.</BuilderNote>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {shapes.map(s => (
          <button key={s.id} type="button" data-shape-row={s.id} aria-pressed={sh?.id === s.id} onClick={() => setBrush(s.id)}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', border: 0, borderRadius: radius.sm, cursor: 'pointer', textAlign: 'left',
              background: sh?.id === s.id ? tk.bg.selected : tk.bg.field, color: tk.text.primary, font: `500 12.5px ${fontFamily.ui}` }}>
            <Glyph kind={s.kind} color={s.color} outline={s.outline} />
            <b style={{ width: 14 }}>{s.id}</b>
            <span style={{ flex: 1, minWidth: 0, color: tk.text.muted, fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{shapeSummary(spec, s)}</span>
          </button>
        ))}
        <Button size="sm" variant="ghost" icon="plus" data-add-shape disabled={shapes.length >= MAX_SHAPES} onClick={add} style={{ alignSelf: 'flex-start' }}>Add a shape</Button>
      </div>
      {sh && (
        <Card id="gs-shape" defaultOpen title={`Shape ${sh.id}`} summary={SHAPE_LABELS[sh.kind]}
          actions={shapes.length > 1 ? <IconButton icon="trash" size="sm" label={`Remove shape ${sh.id} (its cells and rules go too)`} onClick={() => { edit(d => removeShape(d, sh.id)); setBrush(useGridBuilder.getState().spec.shapes[0]?.id ?? 'erase'); }} /> : undefined}>
          <Tiles items={SHAPE_KINDS} value={sh.kind} label={k => SHAPE_LABELS[k]} onPick={k => editShape(sh.id, s => { s.kind = k; })}
            render={k => <Glyph kind={k} color={sh.color} size={20} />} />
          {sh.kind === 'picture' && !sh.tex && <BuilderNote>A square that shows a picture: pick it below.</BuilderNote>}
          <ColourRow label="Colour" value={sh.color} onChange={v => editShape(sh.id, s => { s.color = v; }, `col${sh.id}`)} />
          <NumRow label="Size" hint="The radius as a share of half a cell: 1 touches the neighbours." value={sh.size} min={0.05} max={1.5} defaultValue={DEFAULT_SHAPE.size} onChange={v => editShape(sh.id, s => { s.size = v; }, `size${sh.id}`)} />
          <NumRow label="Turn" unit="°" value={sh.turn} min={-180} max={180} step={1} defaultValue={0} onChange={v => editShape(sh.id, s => { s.turn = v; }, `turn${sh.id}`)} />
          <NumRow label="Spin" hint="Turns a second." value={sh.spin} min={-2} max={2} defaultValue={0} onChange={v => editShape(sh.id, s => { s.spin = v; }, `spin${sh.id}`)} />
          <NumRow label="Pulse" hint="How much the size breathes, once a cycle of its motion." value={sh.pulse} min={0} max={1} defaultValue={0} onChange={v => editShape(sh.id, s => { s.pulse = v; }, `pulse${sh.id}`)} />
          <NumRow label="Outline" hint="0 is filled; above 0 only the edge, this wide." value={sh.outline} min={0} max={0.5} defaultValue={0} onChange={v => editShape(sh.id, s => { s.outline = v; }, `out${sh.id}`)} />
        </Card>
      )}
      {sh && (
        <Card id="gs-shape-picture" defaultOpen={!!sh.tex || sh.kind === 'picture'} title="Picture" summary={sh.tex ? `${sh.tex} · ${PIC_MODE_LABELS[picModeOf(sh)].label.toLowerCase()}` : 'none'}>
          <BuilderNote>Cut a picture up into the grid: the shapes carry it, so you see the shapes made of the picture, not the picture itself.</BuilderNote>
          <TexturePicker id={`cell-${sh.id}`} sources={spec.textures ?? []} value={sh.tex} onAdd={addSource} startOpen={sh.kind === 'picture' && !sh.tex} none={sh.kind === 'picture' ? 'Pick its picture' : 'No picture'}
            onChange={name => editShape(sh.id, s => { s.tex = name ?? undefined; if (name && !s.picMode) s.picMode = s.kind === 'picture' ? 'cell' : 'piece'; })} />
          {sh.tex && (
            <>
              <Row label="Mode" hint={PIC_MODES.map(m => `${PIC_MODE_LABELS[m].label}: ${PIC_MODE_LABELS[m].blurb}`).join('\n')}>
                <Select ariaLabel="Picture mode" value={picModeOf(sh)} options={PIC_MODES.map(m => ({ value: m, label: PIC_MODE_LABELS[m].label }))}
                  onChange={v => editShape(sh.id, s => { s.picMode = v as PicMode; })} />
              </Row>
              <BuilderNote>{PIC_MODE_LABELS[picModeOf(sh)].blurb}</BuilderNote>
            </>
          )}
        </Card>
      )}
    </div>
  );
}

function MotionSection() {
  const tk = useTokens();
  const sh = useEditedShape();
  const shapes = useGridBuilder(s => s.spec.shapes);
  const setBrush = useGridBuilder(s => s.setBrush);
  // Would this shape's search be cut by its cap (MAX_SEARCH)? Big reach with a lot of lag, or a huge shape.
  const capped = useGridBuilder(s => { const x = shapeOf(s.spec, s.brush) ?? s.spec.shapes[0]; return !!x && searchCapped(s.spec, x); });
  if (!sh) return <BuilderNote>Add a shape first.</BuilderNote>;
  const m = sh.motion;
  const usesX = m.path !== 'updown' && m.path !== 'bounce' && m.path !== 'still';
  const usesY = m.path !== 'sideways' && m.path !== 'still';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Row label="Shape">
        <Select ariaLabel="Shape to move" value={sh.id} options={shapes.map(s => ({ value: s.id, label: `${s.id} · ${SHAPE_LABELS[s.kind]}` }))} onChange={setBrush} />
      </Row>
      <Tiles items={MOTION_PATHS} value={m.path} cols={3} label={p => MOTION_LABELS[p].label} onPick={p => editShape(sh.id, s => {
        s.motion.path = p;
        // Travel and hop step a whole cell by default; the others sway a little.
        if ((p === 'travel' || p === 'hop') && Math.abs(s.motion.xy[0]) + Math.abs(s.motion.xy[1]) < 0.5) s.motion.xy = [1, 0];
        if (p !== 'travel' && p !== 'hop' && Math.abs(s.motion.xy[0]) + Math.abs(s.motion.xy[1]) < 0.01) s.motion.xy = [0.3, 0.3];
      })} />
      <BuilderNote>{MOTION_LABELS[m.path].blurb}{m.path === 'still' ? '' : ' Drag the point (or the sliders) to set the reach in cells; the path is drawn round it and on the mini grid.'}</BuilderNote>
      {m.path !== 'still' && (
        <>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <XYPad value={m.xy} shape={sh} range={m.path === 'travel' || m.path === 'hop' ? 3 : 2} onChange={v => editShape(sh.id, s => { s.motion.xy = v; }, `xy${sh.id}`)} />
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 11.5, color: usesX ? undefined : 'GrayText' }}>X (cells)</span>
              <BuilderSlider value={m.xy[0]} min={-3} max={3} disabled={!usesX} ariaLabel="Move X" defaultValue={0} onChange={v => editShape(sh.id, s => { s.motion.xy = [v, s.motion.xy[1]]; }, `mx${sh.id}`)} />
              <span style={{ fontSize: 11.5, color: usesY ? undefined : 'GrayText' }}>Y (cells, up)</span>
              <BuilderSlider value={m.xy[1]} min={-3} max={3} disabled={!usesY} ariaLabel="Move Y" defaultValue={0} onChange={v => editShape(sh.id, s => { s.motion.xy = [s.motion.xy[0], v]; }, `my${sh.id}`)} />
            </div>
          </div>
          <NumRow label="Speed" hint="Cycles a second (negative runs backwards)." value={m.speed} min={-2} max={2} defaultValue={0.5} onChange={v => editShape(sh.id, s => { s.motion.speed = v; }, `sp${sh.id}`)} />
          <NumRow label="Lag" hint="Each cell starts this much of a cycle after its neighbour (x + y): the motion runs through the drawing as a wave." value={m.lag} min={-0.5} max={0.5} defaultValue={0} onChange={v => editShape(sh.id, s => { s.motion.lag = v; }, `lag${sh.id}`)} />
        </>
      )}
      {capped && (
        <span data-search-capped style={{ fontSize: 11.5, color: tk.status.warningText, lineHeight: 1.4 }}>
          This much reach with this much lag makes the shapes overtake each other, beyond the {2 * MAX_SEARCH + 1} × {2 * MAX_SEARCH + 1} cells each pixel looks through: some shapes may be cut. Lower the lag or the reach (or the size).
        </span>
      )}
    </div>
  );
}

/** The pattern's text mask: the wave (and the fill) only in the cells the words cover, drawn in the shader. */
function MaskRows({ mask, onChange }: { mask: TextMask | null; onChange: (m: TextMask | null, key?: string) => void }) {
  const m = mask ?? DEFAULT_TEXT_MASK;
  const put = (patch: Partial<TextMask>, key?: string) => onChange({ ...m, ...patch }, key);
  return (
    <>
      <Row label="Only in words" hint="Limit the pattern to the cells some words cover: the wave changes only those cells, and Fill puts its shape only there, so the fill spells the words.">
        <Toggle checked={!!mask} onChange={on => onChange(on ? { ...DEFAULT_TEXT_MASK } : null)} label={mask ? 'On' : 'Off'} />
      </Row>
      {mask && (
        <>
          <Row label="Words" hint="A–Z, 0–9 and a few signs, in the stroke font.">
            <Field aria-label="Mask words" value={m.text} maxLength={MAX_TEXT_CHARS} data-mask-words onChange={e => put({ text: cleanStartText(e.target.value) }, 'mt')} />
          </Row>
          <NumRow label="Size" hint="How many cells tall the letters are." value={m.size} min={MIN_MASK_SIZE} max={MAX_MASK_SIZE} defaultValue={DEFAULT_TEXT_MASK.size} onChange={v => put({ size: v }, 'ms')} />
          <NumRow label="Weight" hint="How thick the strokes are." value={m.weight} min={0.02} max={0.8} defaultValue={DEFAULT_TEXT_MASK.weight} onChange={v => put({ weight: v }, 'mw')} />
          <NumRow label="Across" hint="Cells right of the grid's middle." value={m.x} min={-12} max={12} defaultValue={0} onChange={v => put({ x: v }, 'mx')} />
          <NumRow label="Up" hint="Cells above the grid's middle." value={m.y} min={-12} max={12} defaultValue={0} onChange={v => put({ y: v }, 'my')} />
        </>
      )}
    </>
  );
}

function PatternsSection() {
  const p = useGridBuilder(s => s.spec.pattern);
  const shapes = useGridBuilder(s => s.spec.shapes);
  const warps = useGridBuilder(s => s.spec.warps);
  const sources = useGridBuilder(s => s.spec.textures) ?? [];
  const picMask = useGridBuilder(s => s.spec.picMask);
  const [adding, setAdding] = useState(false);
  const setP = (fn: (x: typeof p) => void, key?: string) => edit(d => fn(d.pattern), key);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Card id="gs-pattern" defaultOpen title="Pattern" summary={PATTERN_LABELS[p.kind].label}>
        <Tiles items={PATTERN_KINDS} value={p.kind} cols={4} label={k => PATTERN_LABELS[k].label} onPick={(k: PatternKind) => setP(x => { x.kind = k; })} />
        <BuilderNote>{PATTERN_LABELS[p.kind].blurb}</BuilderNote>
        {p.kind === 'picture' && <TexturePicker id="pattern" sources={sources} value={p.tex} onAdd={addSource} startOpen={!p.tex} none="Pick a picture" onChange={name => setP(x => { x.tex = name ?? undefined; })} />}
        {p.kind !== 'none' && (
          <>
            <Row label="Changes"><Select ariaLabel="What the pattern changes" value={p.target} options={PATTERN_TARGETS.map(t => ({ value: t, label: TARGET_LABELS[t] }))} onChange={v => setP(x => { x.target = v as PatternTarget; })} /></Row>
            <NumRow label="Amount" value={p.amount} min={0} max={1.5} defaultValue={DEFAULT_PATTERN.amount} onChange={v => setP(x => { x.amount = v; }, 'pa')} />
            {p.kind !== 'checker' && p.kind !== 'random' && p.kind !== 'picture' && <NumRow label="Waves" hint="Waves across the grid (rings: how wide a ring is)." value={p.freq} min={0} max={16} defaultValue={DEFAULT_PATTERN.freq} onChange={v => setP(x => { x.freq = v; }, 'pf')} />}
            <NumRow label="Speed" hint="Cycles a second." value={p.speed} min={-2} max={2} defaultValue={DEFAULT_PATTERN.speed} onChange={v => setP(x => { x.speed = v; }, 'ps')} />
            {p.kind === 'spiral' && <NumRow label="Arms" value={p.arms} min={1} max={8} integer defaultValue={3} onChange={v => setP(x => { x.arms = v; }, 'pr')} />}
            <Row label="Fill empty cells" hint="Put a shape in every cell you haven't drawn on; its size follows the wave.">
              <Select ariaLabel="Fill empty cells with" value={p.fill ?? ''} options={[{ value: '', label: 'No' }, ...shapes.map(s => ({ value: s.id, label: `With ${s.id} · ${SHAPE_LABELS[s.kind]}` }))]} onChange={v => setP(x => { x.fill = v || null; })} />
            </Row>
            <MaskRows mask={readTextMask(p.mask)} onChange={(m, key) => setP(x => { x.mask = m; }, key)} />
          </>
        )}
      </Card>
      <Card id="gs-picmask" defaultOpen={!!picMask} title="Picture mask" summary={picMask ? `${picMask.tex}${picMask.invert ? ' · dark cells' : ''}` : 'none'}>
        <BuilderNote>Shapes only in the cells where a picture (over the whole grid) is bright, read at each cell's centre.</BuilderNote>
        <TexturePicker id="picmask" sources={sources} value={picMask?.tex} onAdd={addSource} none="No mask"
          onChange={name => edit(d => { d.picMask = name ? { tex: name, cut: d.picMask?.cut ?? 0.5, invert: d.picMask?.invert ?? false } : null; })} />
        {picMask && <>
          <NumRow label="Cut" hint="How bright a cell's picture must be for its shape to show." value={picMask.cut} min={0} max={1} defaultValue={0.5} onChange={v => edit(d => { if (d.picMask) d.picMask.cut = v; }, 'pmc')} />
          <Row label="Invert"><Toggle checked={picMask.invert} onChange={v => edit(d => { if (d.picMask) d.picMask.invert = v; })} label="Shapes in the dark cells" /></Row>
        </>}
      </Card>
      <Card id="gs-warps" defaultOpen title="Grid warps" summary={warps.length ? warps.map(w => w.name).join(', ') : 'none'}
        actions={<Button size="sm" variant="ghost" icon="plus" data-add-warp disabled={warps.length >= MAX_WARPS} onClick={() => setAdding(a => !a)}>{adding ? 'Close' : 'Add'}</Button>}>
        <BuilderNote>Space blocks from the 2D Scene Builder's library: they bend the space the whole grid lives in, lines and all. Top to bottom.</BuilderNote>
        {warps.map((w, i) => (
          <div key={`${w.lib ?? 'w'}-${i}`} data-warp={i} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <b style={{ flex: 1, fontSize: 12.5 }}>{w.name ?? `Warp ${i + 1}`}</b>
              <IconButton icon="trash" size="sm" label={`Remove ${w.name ?? 'the warp'}`} onClick={() => edit(d => { d.warps.splice(i, 1); })} />
            </div>
            {w.params.map((pp, j) => (
              <NumRow key={pp.name} label={pp.name} value={pp.value} min={pp.min} max={pp.max} onChange={v => edit(d => { d.warps[i].params[j].value = v; }, `w${i}${pp.name}`)} />
            ))}
          </div>
        ))}
        {adding && <BlockLibrary compact onPick={b => { edit(d => { if (d.warps.length < MAX_WARPS) d.warps.push(warpOf(b)); }); setAdding(false); }} />}
      </Card>
    </div>
  );
}

/** The fields of one condition: its kind, then the column / row / cell (with Pick on the grid) or the other shape (and how near). */
function ClauseFields({ ruleId, k, w, a, setW }: { ruleId: string; k: number; w: GridClause; a: string; setW: (fn: (w: GridClause) => void, key?: string) => void }) {
  const tk = useTokens();
  const spec = useGridBuilder(s => s.spec);
  const picking = useGridBuilder(s => s.picking);
  const setPicking = useGridBuilder(s => s.setPicking);
  const shapeOpts = spec.shapes.map(s => ({ value: s.id, label: `${s.id} · ${SHAPE_LABELS[s.kind]}` }));
  const pickKey = pickingKey(ruleId, k);
  return (
    <>
      {(w.kind === 'cell' || w.kind === 'column') && (
        <NumRow label="Column" value={w.x ?? 0} min={0} max={spec.cols - 1} integer onChange={v => setW(x => { x.x = v; }, `rx${ruleId}${k}`)} />
      )}
      {(w.kind === 'cell' || w.kind === 'row') && (
        <NumRow label="Row" value={w.y ?? 0} min={0} max={spec.rows - 1} integer onChange={v => setW(x => { x.y = v; }, `ry${ruleId}${k}`)} />
      )}
      {!clauseNeedsB(w) && (
        <Button size="sm" variant="ghost" icon="target" data-pick-cell={pickKey} onClick={() => setPicking(picking === pickKey ? null : pickKey)}
          style={{ alignSelf: 'flex-start', color: picking === pickKey ? tk.status.warningText : undefined }}>{picking === pickKey ? 'Click a cell on the grid…' : 'Pick on the grid'}</Button>
      )}
      {clauseNeedsB(w) && (
        <Row label="Other shape"><Select ariaLabel="Other shape" value={w.b ?? ''} options={shapeOpts} onChange={v => setW(x => { x.b = v; })} /></Row>
      )}
      {w.kind === 'near' && <NumRow label="Within" unit="cells" value={w.dist ?? 1} min={0.1} max={4} defaultValue={1} onChange={v => setW(x => { x.dist = v; }, `rd${ruleId}${k}`)} />}
      {clauseNeedsB(w) && w.b === a && <BuilderNote>Another {a}: a different cell of the same shape.</BuilderNote>}
    </>
  );
}

/** The fields of a Do (or an Else): its kind, then what it becomes, its colour, how much. */
function DoFields({ label, d, needsB, onKind, setD, keyPrefix, allowNone }: {
  label: string; d: GridDo | null; needsB: boolean; onKind: (k: DoKind | null) => void; setD: (fn: (d: GridDo) => void, key?: string) => void; keyPrefix: string; allowNone?: boolean;
}) {
  const spec = useGridBuilder(s => s.spec);
  const shapeOpts = spec.shapes.map(s => ({ value: s.id, label: `${s.id} · ${SHAPE_LABELS[s.kind]}` }));
  const kinds = DO_KINDS.filter(k => k !== 'swap' || (needsB && !allowNone));
  return (
    <>
      <Row label={label}>
        <Select ariaLabel={label} value={d?.kind ?? ''} options={[...(allowNone ? [{ value: '', label: 'Nothing' }] : []), ...kinds.map(k => ({ value: k, label: DO_LABELS[k] }))]}
          onChange={v => onKind(v ? v as DoKind : null)} />
      </Row>
      {d?.kind === 'become' && <Row label="Into"><Select ariaLabel={`${label}: become shape`} value={d.shape ?? ''} options={shapeOpts} onChange={v => setD(x => { x.shape = v; })} /></Row>}
      {d?.kind === 'colour' && <ColourRow label="Colour" value={d.color ?? [1, 1, 1]} onChange={v => setD(x => { x.color = v; }, `${keyPrefix}c`)} />}
      {d?.kind === 'grow' && <NumRow label="By" value={d.amount ?? 1.5} min={0} max={3} defaultValue={1.5} onChange={v => setD(x => { x.amount = v; }, `${keyPrefix}a`)} />}
      {d?.kind === 'spin' && <NumRow label="Turns a second" value={d.amount ?? 1} min={-3} max={3} defaultValue={1} onChange={v => setD(x => { x.amount = v; }, `${keyPrefix}a`)} />}
    </>
  );
}

/** A Do of kind `k` for shape `a`, its settings filled in (from `was` when it had them). */
function doOfKind(spec: GridSceneSpec, k: DoKind, a: string, was?: GridDo | null): GridDo {
  const d: GridDo = { ...(was ?? {}), kind: k };
  if (k === 'become' && !d.shape) d.shape = spec.shapes.find(s => s.id !== a)?.id ?? a;
  if (k === 'colour' && !d.color) d.color = [1, 1, 1];
  if ((k === 'grow' || k === 'spin') && d.amount === undefined) d.amount = k === 'grow' ? 1.5 : 1;
  return d;
}

function RulesSection() {
  const tk = useTokens();
  const spec = useGridBuilder(s => s.spec);
  const shapeOpts = spec.shapes.map(s => ({ value: s.id, label: `${s.id} · ${SHAPE_LABELS[s.kind]}` }));
  const whenOpts = WHEN_KINDS.map(k => ({ value: k, label: WHEN_LABELS[k] }));
  const setR = (id: string, fn: (r: GridRule) => void, key?: string) => edit(d => { const r = d.rules.find(x => x.id === id); if (r) fn(r); }, key);
  /** A condition's kind changed: a partner when it needs one (and swap only on the first). */
  const kindOf = (x: GridRule, w: GridClause, v: WhenKind, first: boolean) => {
    w.kind = v;
    if (clauseNeedsB(w) && !w.b) w.b = spec.shapes.find(s => s.id !== x.when.a)?.id ?? x.when.a;
    if (first && x.do.kind === 'swap' && !clauseNeedsB(w)) x.do.kind = 'colour';
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <BuilderNote>When … Do … for every drawn cell, checked in the shader each frame, top to bottom: a shape reaching a cell, a column or a row, or meeting another shape, changes. Join conditions with and / or, add an Else, or make the change stay.</BuilderNote>
      {spec.rules.map(r => {
        const problem = ruleProblem(spec, r);
        const clauses = ruleClauses(r);
        return (
          <Card key={r.id} id={`gs-rule-${r.id}`} defaultOpen title={<span data-rule={r.id}>{ruleText(r)}</span>} summary={problem ?? undefined}
            actions={<>
              <Toggle checked={r.on} onChange={v => setR(r.id, x => { x.on = v; })} label="" />
              <IconButton icon="trash" size="sm" label="Remove the rule" onClick={() => edit(d => { d.rules = d.rules.filter(x => x.id !== r.id); })} />
            </>}>
            <Row label="When">
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.4fr)', gap: 6 }}>
                <Select ariaLabel="When shape" value={r.when.a} options={shapeOpts} onChange={v => setR(r.id, x => { x.when.a = v; })} />
                <Select ariaLabel="Condition" value={r.when.kind} options={whenOpts} onChange={v => setR(r.id, x => kindOf(x, x.when, v as WhenKind, true))} />
              </div>
            </Row>
            <ClauseFields ruleId={r.id} k={0} w={r.when} a={r.when.a} setW={(fn, key) => setR(r.id, x => fn(x.when), key)} />
            {clauses.slice(1).map((c, i) => (
              <div key={i} data-rule-clause={i + 1} style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingLeft: 8, borderLeft: `2px solid ${tk.border.default}` }}>
                <Row label={
                  <Select ariaLabel={`Join ${i + 1}`} value={c.join ?? 'and'} options={JOINS.map(j => ({ value: j, label: j }))} onChange={v => setR(r.id, x => { x.also![i].join = v as Join; })} />
                }>
                  <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 6, alignItems: 'center' }}>
                    <Select ariaLabel={`Condition ${i + 2}`} value={c.when.kind} options={whenOpts} onChange={v => setR(r.id, x => kindOf(x, x.also![i].when, v as WhenKind, false))} />
                    <IconButton icon="close" size="sm" label="Remove this condition" onClick={() => setR(r.id, x => { x.also = (x.also ?? []).filter((_, j) => j !== i); if (!x.also.length) delete x.also; })} />
                  </div>
                </Row>
                <ClauseFields ruleId={r.id} k={i + 1} w={c.when} a={r.when.a} setW={(fn, key) => setR(r.id, x => fn(x.also![i].when), key)} />
              </div>
            ))}
            {clauses.length - 1 < MAX_ALSO && (
              <div style={{ display: 'flex', gap: 6 }}>
                {JOINS.map(j => (
                  <Button key={j} size="sm" variant="ghost" icon="plus" data-add-clause={`${r.id}:${j}`} title={`Another condition, joined with “${j}” (checked left to right)`}
                    onClick={() => setR(r.id, x => { x.also = [...(x.also ?? []), { join: j, when: { kind: 'column', x: Math.floor(spec.cols / 2) } }]; })}>{j}</Button>
                ))}
              </div>
            )}
            <DoFields label="Do" d={r.do} needsB={clauseNeedsB(r.when)} keyPrefix={`rd${r.id}`}
              onKind={k => setR(r.id, x => { if (k) x.do = doOfKind(spec, k, x.when.a, x.do); })} setD={(fn, key) => setR(r.id, x => fn(x.do), key)} />
            <Row label="Stays changed" hint="Once the conditions have held for a drawn cell, that cell keeps the change after they end (a small memory pass remembers it, one texel a cell). The preview's Restart, the clock going back, or the Rule memory node's Reset forgets.">
              <Toggle checked={!!r.sticky} onChange={v => setR(r.id, x => { if (v) x.sticky = true; else delete x.sticky; })} label={r.sticky ? 'On' : 'Off'} />
            </Row>
            <DoFields label="Else" d={r.else ?? null} needsB={false} allowNone keyPrefix={`re${r.id}`}
              onKind={k => setR(r.id, x => { if (k) x.else = doOfKind(spec, k, x.when.a, x.else); else delete x.else; })} setD={(fn, key) => setR(r.id, x => { if (x.else) fn(x.else); }, key)} />
            {problem && <BuilderNote style={{ color: tk.status.warningText }}>Off: {problem}.</BuilderNote>}
          </Card>
        );
      })}
      <Button size="sm" icon="plus" data-add-rule disabled={spec.rules.length >= MAX_RULES || !spec.shapes.length} onClick={() => edit(d => { d.rules.push(newRule(d)); })} style={{ alignSelf: 'flex-start' }}>Add a rule</Button>
      {spec.shapes.length < 2 && <BuilderNote>Rules between shapes need a second shape (Shapes → Add a shape).</BuilderNote>}
    </div>
  );
}

function LookSection() {
  const look = useGridBuilder(s => s.spec.look);
  const span = useGridBuilder(s => s.spec.span);
  const setL = (fn: (l: typeof look) => void, key?: string) => edit(d => fn(d.look), key);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Card id="gs-ground" defaultOpen title="Ground" summary={look.lines ? 'lines' : 'no lines'}>
        <ColourRow label="Background" value={look.bg} onChange={v => setL(l => { l.bg = v; }, 'bg')} />
        <Row label="Grid lines"><Toggle checked={look.lines} onChange={v => setL(l => { l.lines = v; })} label={look.lines ? 'On' : 'Off'} /></Row>
        {look.lines && (
          <>
            <ColourRow label="Line colour" value={look.lineColor} onChange={v => setL(l => { l.lineColor = v; }, 'lc')} />
            <NumRow label="Line width" hint="In cells." value={look.lineWidth} min={0.005} max={0.2} step={0.005} defaultValue={DEFAULT_LOOK.lineWidth} onChange={v => setL(l => { l.lineWidth = v; }, 'lw')} />
          </>
        )}
        <NumRow label="Grid size" hint="From the centre to the grid's taller edge (1 reaches the top of the picture)." value={span} min={0.3} max={1.6} defaultValue={0.9} onChange={v => edit(d => { d.span = v; }, 'span')} />
      </Card>
      <Card id="gs-glow" defaultOpen title="Glow" summary={look.glow ? 'on' : 'off'}>
        <Row label="Glow"><Toggle checked={look.glow} onChange={v => setL(l => { l.glow = v; })} label={look.glow ? 'On' : 'Off'} /></Row>
        {look.glow && (
          <>
            <NumRow label="Amount" value={look.glowAmount} min={0.0005} max={0.05} step={0.0005} defaultValue={DEFAULT_LOOK.glowAmount} onChange={v => setL(l => { l.glowAmount = v; }, 'ga')} />
            <NumRow label="Falloff" value={look.glowFalloff} min={0.5} max={3} defaultValue={DEFAULT_LOOK.glowFalloff} onChange={v => setL(l => { l.glowFalloff = v; }, 'gf')} />
          </>
        )}
        <Row label="Tone map"><Select ariaLabel="Tone map" value={look.tone} options={[{ value: 'aces', label: 'ACES' }, { value: 'none', label: 'None' }]} onChange={v => setL(l => { l.tone = v as 'aces' | 'none'; })} /></Row>
      </Card>
    </div>
  );
}

function Inspector() {
  const section = useGridBuilder(s => s.section);
  const info = SECTIONS.find(s => s.id === section)!;
  const body = { shapes: <ShapesSection />, motion: <MotionSection />, patterns: <PatternsSection />, rules: <RulesSection />, look: <LookSection /> }[section];
  return (
    <div data-grid-section={section} style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 14px 24px' }}>
      <StudioLabel>{info.label}</StudioLabel>
      {body}
    </div>
  );
}

// ── Centre: the live preview ──────────────────────────────────────────────────

function Viewport() {
  const tk = useTokens();
  const live = useGridBuilder(s => s.spec);
  const spec = useThrottled(live);
  const compiled = useMemo(() => compileGridScene(spec), [spec]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [paused, setPaused] = useState(false);
  const error = useBuilderPreview(canvasRef, compiled, paused);
  const placed = useMemo(() => gridProgram(spec).placed, [spec]);
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: 14, gap: 8 }}>
      <div style={{ position: 'relative', flex: 1, minHeight: 0, borderRadius: radius.md, overflow: 'hidden', background: tk.bg.render }}>
        <canvas ref={canvasRef} data-grid-preview aria-label="Live preview of the grid scene" style={{ width: '100%', height: '100%', display: 'block' }} />
        {error && <div role="alert" style={{ position: 'absolute', inset: 0, padding: 12, overflow: 'auto', color: '#f38ba8', font: `500 11px ${fontFamily.mono}`, background: 'rgba(13,13,18,0.86)' }}>{error}</div>}
        <button type="button" onClick={() => setPaused(p => !p)} title={paused ? 'Play the preview' : 'Pause the preview'}
          style={{ position: 'absolute', right: 8, bottom: 8, height: 26, padding: '0 10px', border: 0, borderRadius: 6, background: 'rgba(0,0,0,0.45)', color: '#fff', font: `600 11.5px ${fontFamily.ui}`, cursor: 'pointer' }}>
          {paused ? 'Play' : 'Pause'}
        </button>
      </div>
      <span data-grid-stats style={{ fontSize: 11.5, color: tk.text.muted }}>
        {error ? 'The preview could not draw this grid.' : `Live: the graph Build makes (${compiled.nodes} nodes, ${placed} drawn cells), compiled in ${Math.round(compiled.ms)} ms. Sliders are uniforms on the built nodes.`}
      </span>
    </div>
  );
}

function Presets() {
  const pics = useMemo(() => Object.fromEntries(GRID_TEMPLATES.map(t => [t.key, gridPicture(t.make())])), []);
  return (
    <div style={{ display: 'flex', gap: 12 }}>
      {GRID_TEMPLATES.map(t => <PresetCard key={t.key} id={t.key} label={t.label} hint={t.blurb} src={pics[t.key]} onClick={() => useGridBuilder.getState().replace(t.make())} />)}
    </div>
  );
}

// ── Make it a simulation ──────────────────────────────────────────────────────

/**
 * "Make it a simulation → Grid Rules": a small panel first, listing the drawing's shapes with the
 * state each starts the simulation as (0 leaves it out; remembered on the scene for the next jump)
 * and the rule to start with, then the jump (actions.ts makeSimulation).
 */
function SimulationButton({ hasSim }: { hasSim: boolean }) {
  const tk = useTokens();
  const anchor = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const spec = useGridBuilder(s => s.spec);
  const [rule, setRule] = useState<string>('');
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const id of shownCells(spec)) if (id) m.set(id, (m.get(id) ?? 0) + 1);
    return m;
  }, [spec]);
  const drawn = spec.shapes.filter(s => counts.get(s.id));
  const states = Array.from({ length: MAX_SIM_STATE + 1 }, (_, i) => ({ value: String(i), label: i === 0 ? '0 · left out' : i === 1 ? '1 · alive' : String(i) }));
  const ruleOpts = [
    { value: '', label: hasSim ? 'Keep its rule' : 'Life' },
    ...SIM_RULES.filter(r => hasSim || r.key !== 'count:life').map(r => ({ value: r.key, label: `${r.group} · ${r.label}` })),
  ];
  const hint = SIM_RULES.find(r => r.key === rule)?.hint;
  const left = drawn.every(s => simStateOf(spec, s.id) === 0);
  return (
    <div ref={anchor} style={{ display: 'flex' }}>
      <Button size="sm" icon="grid" data-make-simulation onClick={() => setOpen(o => !o)}
        title={`Make it a simulation: Grid Rules starts from your drawing, each shape as the state you pick${hasSim ? '; the one made before is reused' : ''}. Its editor has “‹ Pattern grid” to come back.`}>
        Make it a simulation → Grid Rules
      </Button>
      {open && (
        <Popover anchorRef={anchor} onClose={() => setOpen(false)} align="end" width={320} padding={12}>
          <div data-sim-panel style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <StudioLabel>Each shape starts as</StudioLabel>
            {!drawn.length && <BuilderNote>Nothing is drawn yet: the simulation starts empty.</BuilderNote>}
            {drawn.map(s => (
              <div key={s.id} data-sim-shape={s.id} style={{ display: 'grid', gridTemplateColumns: '22px minmax(0, 1fr) 118px', alignItems: 'center', gap: 8 }}>
                <Glyph kind={s.kind} color={s.color} size={20} outline={s.outline} />
                <span style={{ fontSize: 12.5, color: tk.text.secondary, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {s.id} · {SHAPE_LABELS[s.kind].toLowerCase()} · {counts.get(s.id)} cell{counts.get(s.id) === 1 ? '' : 's'}
                </span>
                <Select ariaLabel={`State for shape ${s.id}`} value={String(simStateOf(spec, s.id))} options={states}
                  onChange={v => edit(d => { d.simStates = { ...(d.simStates ?? {}), [s.id]: Number(v) }; })} />
              </div>
            ))}
            <BuilderNote>State 1 is alive. Count rules (Life…) see only alive or not; Stages rules read 2 and up as dying stages, so walls of a higher state don't come alive. Kept with the drawing for the next jump.</BuilderNote>
            <Row label="Rule">
              <Select ariaLabel="Simulation rule" value={rule} options={ruleOpts} onChange={setRule} />
            </Row>
            {hint && <BuilderNote>{hint}</BuilderNote>}
            {left && drawn.length > 0 && <BuilderNote style={{ color: tk.status.warningText }}>Every shape is left out: the simulation starts empty.</BuilderNote>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
              <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button size="sm" variant="primary" data-sim-go onClick={() => { setOpen(false); makeSimulation({ rule: rule || null }); }}>Make it a simulation</Button>
            </div>
          </div>
        </Popover>
      )}
    </div>
  );
}

// ── The window ────────────────────────────────────────────────────────────────

export function GridSceneBuilder() {
  const undo = useGridBuilder(s => s.undo);
  const redo = useGridBuilder(s => s.redo);
  const canUndo = useGridBuilder(s => s.past.length > 0);
  const canRedo = useGridBuilder(s => s.future.length > 0);
  const dirty = useGridBuilder(s => s.dirty);
  const seed = useGridBuilder(s => s.surpriseSeed);
  const size = useGridBuilder(s => `${s.spec.cols} × ${s.spec.rows}`);
  const target = useGridBuilder(s => s.targetSceneId);
  const editing = useNodeGraphStore(s => !!target && s.nodes.some(n => n.id === target));
  const hasSim = useNodeGraphStore(s => !!target && !!simulationOf(s.nodes, target));
  // ⌘⇧D: a Grid scene has no recipe text; its When … Do … rules are the nearest thing.
  useBuilderRecipeRequest(() => useGridBuilder.getState().setSection('rules'));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && useGridBuilder.getState().picking) { e.stopPropagation(); useGridBuilder.getState().setPicking(null); return; }
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && (t as HTMLInputElement).type === 'text'))) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) redo(); else undo();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [undo, redo]);

  // Back to the kinds: what you drew is kept in the graph (built first when you changed it).
  const back = () => {
    const gb = useGridBuilder.getState();
    if (gb.dirty && gb.past.length) buildFromGridBuilder(false, { quiet: true });
    backToSceneKinds();
  };
  return (
    <StudioShell prefsKey="grid-builder" icon="grid" title="Grid builder" crumb={<SceneCrumb kind="grid" onBack={back} />}
      kind={`${size} · ${editing ? 'editing a built grid' : 'a new grid'}${dirty ? ' · not built yet' : ''}`}
      onClose={() => useGridBuilder.getState().close()}
      onEscape={() => { if (useGridBuilder.getState().picking) { useGridBuilder.getState().setPicking(null); return true; } return false; }}
      actions={<>
        <SurpriseBar seed={seed} title="A random grid from a new seed: cells, shapes, motion, a pattern, maybe a warp and a rule (one undo step)" onSurprise={s => {
          useGridBuilder.getState().surprise(s);
          const made = useGridBuilder.getState().spec;
          announceSurprise({
            title: 'Grid surprise', seed: s,
            message: `${made.cols} × ${made.rows} · ${made.shapes.length} shape${made.shapes.length === 1 ? '' : 's'} · ${made.cells.length} cells${made.pattern.kind !== 'none' ? ` · ${made.pattern.kind}` : ''}. Done puts it on the canvas.`,
            reroll: () => { undo(); useGridBuilder.getState().surprise(newSeed()); },
            undo: () => undo(),
            stillCurrent: () => useGridBuilder.getState().spec === made,
          });
        }} />
        <IconButton icon="undo" label="Undo" shortcut="cmd+z" size="sm" disabled={!canUndo} onClick={undo} />
        <IconButton icon="redo" label="Redo" shortcut="cmd+shift+z" size="sm" disabled={!canRedo} onClick={redo} />
        <SimulationButton hasSim={hasSim} />
        <Button size="sm" icon="rebuild" data-grid-build onClick={() => buildFromGridBuilder(false)} title={editing ? 'Rebuild the grid in the graph (keeps settings you changed on its nodes)' : 'Build the grid into the graph now'}>{editing ? 'Rebuild' : 'Build'}</Button>
      </>}
      primary={{ label: 'Done', onClick: finishGridBuilder, title: 'Build what changed, close, and show it on the graph' }}
      nav={<LeftPanel />} navWidth={318}
      inspector={<Inspector />} inspectorWidth={360}
      presets={<Presets />}>
      <Viewport />
    </StudioShell>
  );
}

/** Mounted by BuilderWindowsHost: the window while it is open. */
export function GridSceneBuilderHost() {
  const open = useGridBuilder(s => s.open);
  return open ? <GridSceneBuilder /> : null;
}
