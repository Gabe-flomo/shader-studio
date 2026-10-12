/**
 * WarpBuilder — the Warp Builder window (docs/warp-builder.md), the Scene builder's Warp kind, on the
 * shared StudioShell:
 *
 *   ┌ Scene builder › Warp ─────────── undo · redo · Send to 2D · Surprise me · Done ┐
 *   │ Palette: variables, #,     │   the big preview (Checkerboard · Ring ·    │ the picked │
 *   │ functions as pictures of   │   Vectors · Heat), the whole stack, or the  │ tile, the  │
 *   │ what they'd do, operators  │   space after the hovered block             │ block, its │
 *   │                            ├─────────────────────────────────────────────┤ sliders,   │
 *   │                            │   blocks: X / Y / UV rows of tiles          │ library    │
 *   └────────────────────────────┴─────────────────────────────────────────────┴────────────┘
 *
 * Drag a palette tile onto a row or into a slot (or click it: it lands on the picked tile). Every
 * edit writes the block's lines (warpBuilder/spec.ts dropTile), so the 2D builder, My blocks and
 * the library read the same text.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type ReactNode } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { StudioShell, StudioLabel } from '../builders/studio/StudioShell';
import { SceneCrumb } from '../builders/SceneCrumb';
import { BuilderNote } from '../builders/BuilderWindow';
import { MuteToggle } from '../builders/MuteToggle';
import { ExprLineInput } from '../builders/ExprLineInput';
import { NumRow } from '../sceneBuilder/controls';
import { Button, IconButton } from '../ui/Button';
import { Select } from '../ui/Select';
import { Segmented } from '../ui/Choice';
import { Icon } from '../ui/Icon';
import { SurpriseBar } from '../surprise/SurpriseBar';
import { WarpCanvas, BlockLibrary } from '../sceneBuilder2d/SpaceBlocks';
import { SaveBlockForm } from '../sceneBuilder2d/MyBlocks';
import { backToSceneKinds } from '../../builders/sceneKinds';
import {
  BLOCK_OPS, BLOCK_TARGETS, LOOP_BLOCK_NAMES, MAX_LINES, MAX_LOOP_TIMES, MAX_TIMES, TRAP_KINDS, blockMap, clampTimes, cloneBlock, rangeFor,
  type BlockOp, type BlockTarget, type SpaceBlock, type TrapKind,
} from '../../sceneBuilder2d/blocks';
import {
  CMP_TILES, FN_TILES, LOGIC_TILES, OP_TILES, VAR_TILES, canSoft, cmpLabel, duplicateAt, isBool, setSoft, fnLabel, hasCode, numText, opLabel, removeAt, replaceAt, samePath, swapAt, textToTile, tileAt, tileText, varLabel,
  type FnTile, type Tile, type TilePath,
} from '../../warpBuilder/tiles';
import {
  PREVIEW_MODES, ROW_LABEL, addRow, dragKind, dropAllowed, nameForNumber, newWarpBlock, nextItemId, rowProblems, rowTile, setRowTile,
  type PreviewMode, type TileDrag, type TileTarget,
} from '../../warpBuilder/spec';
import { useWarpBuilder } from '../../warpBuilder/store';
import { finishWarpBuilder, sendWarpTo2D } from '../../warpBuilder/actions';
import { COND_GLYPHS, FN_GLYPHS, GLYPH_SIZE, type CondGlyph } from '../../warpBuilder/glyphs';
import { applyTile } from '../../warpBuilder/slotMenu';
import { SlotMenu } from './SlotMenu';
import { WarpPreview } from './WarpPreview';
import { usePhoneDialog } from '../ui/phoneDialog';
import { toast } from '../ui/toastStore';

// ── Dragging ─────────────────────────────────────────────────────────────────

/** What is being dragged now (dragover can't read the payload in every browser). */
let dragging: TileDrag | null = null;
const startDrag = (e: DragEvent, d: TileDrag) => {
  e.stopPropagation();
  dragging = d;
  e.dataTransfer.effectAllowed = 'copyMove';
  try { e.dataTransfer.setData('text/plain', JSON.stringify(d)); } catch { /* fine */ }
};
const endDrag = () => { dragging = null; };
const readDrag = (e: DragEvent): TileDrag | null => {
  if (dragging) return dragging;
  try { return JSON.parse(e.dataTransfer.getData('text/plain')) as TileDrag; } catch { return null; }
};

/** Drop (or click-apply) a tile: one undo step, then pick what the drop says to pick next. */
function apply(to: TileTarget, drag: TileDrag): void { applyTile(to, drag); }

/** A palette tile clicked: it lands on the picked tile, or the end of the first row. */
function applyToSelection(drag: TileDrag): void {
  const { sel, spec } = useWarpBuilder.getState();
  if (!spec.blocks.length) useWarpBuilder.getState().edit(d => { d.blocks.push({ id: nextItemId(d), block: newWarpBlock() }); });
  const to: TileTarget = sel ? { block: sel.block, line: sel.line, path: sel.path } : { block: 0, line: 0, path: null };
  if (!dropAllowed(useWarpBuilder.getState().spec, to, drag)) {
    toast.info(dragKind(useWarpBuilder.getState().spec, drag) === 'bool' ? 'A condition goes in an If' : 'The condition takes a comparison', {
      message: dragKind(useWarpBuilder.getState().spec, drag) === 'bool'
        ? 'Comparisons, and, or and not go in the If tile’s condition (or inside and / or / not). Pick that slot first.'
        : 'The If tile’s condition is true or false: put a comparison there (>, <, =…), then values in its two slots.',
    });
    return;
  }
  apply(to, drag);
}

/**
 * A drop target at `to`. A drop the slot can't take (a value on the If's condition, a condition on
 * a value) isn't offered: the drag shows "no drop" there.
 */
function useDropZone(to: TileTarget) {
  const [over, setOver] = useState(false);
  const ok = (d: TileDrag | null) => !!d && dropAllowed(useWarpBuilder.getState().spec, to, d);
  return {
    over,
    props: {
      onDragOver: (e: DragEvent) => {
        e.stopPropagation();
        if (dragging && !ok(dragging)) { e.dataTransfer.dropEffect = 'none'; return; }
        e.preventDefault();
        e.dataTransfer.dropEffect = dragging?.from === 'row' ? 'move' : 'copy';
        if (!over) setOver(true);
      },
      onDragLeave: (e: DragEvent) => { e.stopPropagation(); setOver(false); },
      onDrop: (e: DragEvent) => { e.preventDefault(); e.stopPropagation(); setOver(false); const d = readDrag(e); endDrag(); if (d && ok(d)) apply(to, d); },
    },
  };
}

// ── Tiles in a row ───────────────────────────────────────────────────────────

const varColour = (name: string) => (name === 't' ? '#e0b34a' : name === 'r' || name === 'theta' ? '#58c6a8' : name === 'uv' || name === 'uv0' ? '#b48cf0' : name === 'fi' || name === 'k' || name === 'n' ? '#f08cb4' : '#6aa8ff');

function TileChip({ tile, path, block, line, params }: { tile: Tile; path: TilePath; block: number; line: number; params: SpaceBlock['params'] }) {
  const tk = useTokens();
  const sel = useWarpBuilder(s => s.sel);
  const picked = !!sel && sel.block === block && sel.line === line && samePath(sel.path, path);
  const drop = useDropZone({ block, line, path });
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const kids = (list: Tile[], from = 0) => list.map((c, i) => <TileChip key={i} tile={c} path={[...path, from + i]} block={block} line={line} params={params} />);
  const base: CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 5px', minHeight: 26, borderRadius: 7, cursor: 'grab',
    boxShadow: picked ? `0 0 0 2px ${tk.accent.base}` : drop.over ? `0 0 0 2px ${alpha(tk.accent.base, 0.6)}` : undefined,
    font: `600 12.5px ${fontFamily.mono}`, color: tk.text.primary, userSelect: 'none', whiteSpace: 'nowrap',
  };
  let body: ReactNode;
  let style: CSSProperties = base;
  switch (tile.k) {
    case 'var':
      style = { ...base, background: alpha(varColour(tile.name), 0.22), color: varColour(tile.name) };
      body = <>{tile.name === 't' && <Icon name="clock" size={12} />}{varLabel(tile.name)}</>;
      break;
    case 'num':
      style = { ...base, background: tk.bg.field };
      body = <><span style={{ color: tk.text.faint }}>#</span>{numText(tile.value)}</>;
      break;
    case 'param': {
      const p = params.find(q => q.name === tile.name);
      style = { ...base, background: alpha(tk.accent.base, 0.16), color: tk.accent.text };
      body = <><Icon name="sliders" size={11} />{tile.name}{p && <span style={{ color: tk.text.muted, fontWeight: 500 }}>{numText(Math.round(p.value * 1000) / 1000)}</span>}</>;
      break;
    }
    case 'hole':
      style = { ...base, minWidth: 30, justifyContent: 'center', background: 'transparent', boxShadow: `${base.boxShadow ? `${base.boxShadow}, ` : ''}inset 0 0 0 1.5px ${alpha(tk.text.muted, 0.5)}`, color: tk.text.faint, cursor: 'pointer' };
      body = <span style={{ fontSize: 11 }}>drop</span>;
      break;
    case 'code':
      style = { ...base, background: alpha(tk.status.warning, 0.14), color: tk.text.secondary, fontWeight: 500 };
      body = <><Icon name="code" size={11} />{tile.text.length > 32 ? `${tile.text.slice(0, 31)}…` : tile.text}</>;
      break;
    case 'call':
      style = { ...base, background: alpha('#7a8cff', 0.12), boxShadow: `${base.boxShadow ? `${base.boxShadow}, ` : ''}inset 0 0 0 1px ${alpha('#7a8cff', 0.35)}` };
      body = <><b style={{ color: '#9fb0ff' }}>{fnLabel(tile.fn)}</b><span style={{ color: tk.text.faint }}>(</span>{tile.args.map((a, i) => <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>{i > 0 && <span style={{ color: tk.text.faint }}>,</span>}{kids([a], i)}</span>)}<span style={{ color: tk.text.faint }}>)</span></>;
      break;
    case 'op':
      style = { ...base, padding: path.length ? '1px 4px' : 0, background: path.length ? alpha(tk.text.primary, 0.04) : 'transparent' };
      body = <>{kids([tile.a])}<span style={{ padding: '0 2px', color: tk.text.secondary, fontSize: 14 }}>{opLabel(tile.op)}</span>{kids([tile.b], 1)}</>;
      break;
    case 'neg':
      style = { ...base, background: 'transparent' };
      body = <><span style={{ color: tk.text.secondary }}>−</span>{kids([tile.a])}</>;
      break;
    case 'cmp': case 'logic': {
      const word = tile.k === 'cmp' ? cmpLabel(tile.op) : tile.op === '&&' ? 'and' : 'or';
      style = { ...base, padding: '1px 4px', background: alpha('#e07a5f', 0.12), boxShadow: `${base.boxShadow ? `${base.boxShadow}, ` : ''}inset 0 0 0 1px ${alpha('#e07a5f', 0.35)}` };
      body = <>{kids([tile.a])}<b style={{ padding: '0 2px', color: '#e8957f', fontSize: tile.k === 'cmp' ? 14 : 12 }}>{word}</b>{kids([tile.b], 1)}</>;
      break;
    }
    case 'not':
      style = { ...base, padding: '1px 4px', background: alpha('#e07a5f', 0.12) };
      body = <><b style={{ color: '#e8957f' }}>not</b>{kids([tile.a])}</>;
      break;
    case 'if': {
      const kw = (w: string) => <b style={{ color: '#e8957f', font: `700 11.5px ${fontFamily.ui}`, padding: '0 2px' }}>{w}</b>;
      style = { ...base, padding: '3px 6px', gap: 4, flexWrap: 'wrap', whiteSpace: 'normal', background: alpha('#e07a5f', 0.08), boxShadow: `${base.boxShadow ? `${base.boxShadow}, ` : ''}inset 0 0 0 1.5px ${alpha('#e07a5f', 0.45)}` };
      body = <>{kw('if')}{kids([tile.cond])}{kw('then')}{kids([tile.a], 1)}{kw('else')}{kids([tile.b], 2)}{tile.soft && <>{kw('smooth')}{kids([tile.soft], 3)}</>}</>;
      break;
    }
    case 'swz':
      style = { ...base, background: 'transparent' };
      body = <>{kids([tile.a])}<span style={{ color: tk.text.secondary }}>.{tile.field}</span></>;
      break;
  }
  const chip = (
    <span role="button" tabIndex={0} draggable data-tile={tile.k} data-tile-path={path.join('.')} title={tileText(tile)} style={style}
      onDragStart={e => startDrag(e, { from: 'row', block, line, path })} onDragEnd={endDrag}
      onClick={e => { e.stopPropagation(); useWarpBuilder.getState().select({ block, line, path }); }}
      {...drop.props}>
      {body}
    </span>
  );
  // An empty slot: right-click (or long-press) lists what can fill it.
  return tile.k === 'hole'
    ? (
      <span style={{ display: 'inline-flex' }} onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setMenuAt({ x: e.clientX, y: e.clientY }); }}>
        {chip}
        {menuAt && <SlotMenu x={menuAt.x} y={menuAt.y} to={{ block, line, path }} onClose={() => setMenuAt(null)} />}
      </span>
    )
    : chip;
}

function RowView({ block, line, item }: { block: number; line: number; item: SpaceBlock }) {
  const tk = useTokens();
  const l = item.lines[line];
  const root = useMemo(() => rowTile(item, line), [item, line]);
  const problem = rowProblems(item)[line];
  const [text, setText] = useState(false);
  const edit = useWarpBuilder(s => s.edit);
  const drop = useDropZone({ block, line, path: null });
  // On a phone the tiles get a line of their own, under the pickers.
  const narrowRow = usePhoneDialog();
  const vars = useMemo(() => [{ name: 'x', type: 'float' }, { name: 'y', type: 'float' }, { name: 'uv', type: 'vec2' }, { name: 't', type: 'float' }, ...(item.loop ? LOOP_BLOCK_NAMES.map(v => ({ name: v.name, type: v.type })) : []), ...item.params.map(p => ({ name: p.name, type: 'float' }))], [item.params, item.loop]);
  return (
    <div data-warp-row={`${block}:${line}`} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 62, flexShrink: 0 }}>
          <Select ariaLabel={`Row ${line + 1}: which part`} height={30} value={l.target} options={BLOCK_TARGETS.map(x => ({ value: x, label: ROW_LABEL[x] }))}
            onChange={v => edit(d => { d.blocks[block].block.lines[line].target = v as BlockTarget; })} style={{ font: `700 12px ${fontFamily.mono}` }} />
        </span>
        <span style={{ width: 54, flexShrink: 0 }}>
          <Select ariaLabel={`Row ${line + 1}: assign`} mono height={30} value={l.op} options={BLOCK_OPS.map(x => ({ value: x, label: x }))}
            onChange={v => edit(d => { d.blocks[block].block.lines[line].op = v as BlockOp; })} />
        </span>
        {narrowRow && <span style={{ flex: 1 }} />}
        {text ? (
          <ExprLineInput ariaLabel={`Row ${line + 1} as text`} value={l.rhs} vars={vars} invalid={!!problem} height={30}
            onChange={v => edit(d => { d.blocks[block].block.lines[line].rhs = v; }, `warp:${block}:${line}:text`)} />
        ) : (
          <div data-warp-row-drop {...drop.props} onClick={() => useWarpBuilder.getState().select({ block, line, path: [] })}
            style={{
              flex: '1 1 240px', order: narrowRow ? 9 : undefined, minWidth: 0, minHeight: 34, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4, padding: '3px 6px', borderRadius: radius.md, overflowX: 'auto',
              background: drop.over ? alpha(tk.accent.base, 0.1) : tk.bg.field, boxShadow: `inset 0 0 0 1px ${problem ? alpha(tk.status.danger, 0.6) : tk.border.subtle}`,
            }}>
            {root ? <TileChip tile={root} path={[]} block={block} line={line} params={item.params} />
              : <span style={{ fontSize: 12, color: tk.text.faint }}>Drop a tile here: {ROW_LABEL[l.target]} {l.op === '=' ? 'becomes' : 'changes by'} it</span>}
            {root && <span data-warp-row-end title="Drop here to add to the end of the row" style={{ flex: 1, minWidth: 24, alignSelf: 'stretch' }} />}
          </div>
        )}
        <IconButton icon={text ? 'grid' : 'code'} size="sm" label={text ? 'Back to tiles' : 'Edit this row as text'} active={text} onClick={() => setText(!text)} />
        <IconButton icon="close" size="sm" label="Remove this row" onClick={() => edit(d => { const b = d.blocks[block].block; setRowTile(b, line, null); b.lines.splice(line, 1); })} />
      </div>
      {problem && <div role="alert" data-warp-problem style={{ fontSize: 11.5, color: tk.status.danger, paddingLeft: 128 }}>{problem}</div>}
      {!problem && hasCode(root) && <BuilderNote style={{ fontSize: 11, paddingLeft: 128 }}>Part of this row is kept as code (the amber tile): click it to edit its text.</BuilderNote>}
    </div>
  );
}

function BlockCard({ index }: { index: number }) {
  const tk = useTokens();
  const item = useWarpBuilder(s => s.spec.blocks[index]);
  const count = useWarpBuilder(s => s.spec.blocks.length);
  const sel = useWarpBuilder(s => s.sel);
  const edit = useWarpBuilder(s => s.edit);
  if (!item) return null;
  const b = item.block;
  const picked = sel?.block === index;
  const move = (dir: -1 | 1) => edit(d => { const j = index + dir; [d.blocks[index], d.blocks[j]] = [d.blocks[j], d.blocks[index]]; });
  return (
    <div data-warp-block={index} onMouseEnter={() => useWarpBuilder.getState().setHover(index + 1)} onMouseLeave={() => useWarpBuilder.getState().setHover(null)}
      onClick={() => { if (sel?.block !== index) useWarpBuilder.getState().select({ block: index, line: 0, path: [] }); }}
      style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 10, borderRadius: radius.card, background: tk.bg.panel, opacity: item.muted ? 0.55 : 1,
        boxShadow: picked ? `inset 0 0 0 1.5px ${alpha(tk.accent.base, 0.7)}` : `inset 0 0 0 1px ${tk.border.default}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <WarpCanvas map={() => blockMap(b, 1)} k={JSON.stringify(b)} size={34} title="A grid through this block alone" />
        <b style={{ fontSize: 13, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{index + 1}. {b.name || 'Warp'}</b>
        <span style={{ font: `600 11px ${fontFamily.mono}`, color: tk.text.muted }}>{b.loop ? `loop ×${b.times}` : b.times > 1 ? `run ×${b.times}` : ''}</span>
        <MuteToggle muted={!!item.muted} what={b.name || 'this block'} onToggle={() => edit(d => { d.blocks[index].muted = !d.blocks[index].muted; })} />
        <IconButton icon="chevU" size="sm" label="Earlier" disabled={index === 0} onClick={() => move(-1)} />
        <IconButton icon="chevD" size="sm" label="Later" disabled={index === count - 1} onClick={() => move(1)} />
        <IconButton icon="copy" size="sm" label="Duplicate this block" onClick={() => edit(d => { d.blocks.splice(index + 1, 0, { id: nextItemId(d), block: cloneBlock(d.blocks[index].block) }); })} />
        <IconButton icon="trash" size="sm" label="Remove this block" onClick={() => { edit(d => { d.blocks.splice(index, 1); }); useWarpBuilder.getState().select(null); }} />
      </div>
      {b.lines.map((_l, i) => <RowView key={i} block={index} line={i} item={b} />)}
      {b.lines.length < MAX_LINES && (
        <div style={{ display: 'flex', gap: 6 }}>
          <Button size="sm" variant="ghost" icon="plus" onClick={() => edit(d => { addRow(d.blocks[index].block); })}>Row</Button>
          <BuilderNote style={{ fontSize: 11, alignSelf: 'center' }}>X changes uv.x, Y uv.y, UV both (two numbers).</BuilderNote>
        </div>
      )}
    </div>
  );
}

// ── The palette ──────────────────────────────────────────────────────────────

function PaletteTile({ drag, label, hint, colour, children, wide, bar }: { drag: TileDrag; label: ReactNode; hint: string; colour?: string; children?: ReactNode; wide?: boolean; /** In the tile bar: small and in a row. */ bar?: boolean }) {
  const tk = useTokens();
  const [hover, setHover] = useState(false);
  return (
    <button type="button" draggable data-palette-tile={drag.from === 'palette' ? (drag.kind === 'var' ? drag.name : drag.kind === 'fn' ? drag.fn : drag.kind === 'op' ? drag.op : drag.kind === 'cmp' ? `cmp${drag.op}` : drag.kind === 'logic' ? drag.op : drag.kind === 'not' ? 'not' : drag.kind === 'if' ? 'if' : 'num') : ''}
      title={`${hint}. Drag onto a row or a slot, or click to put it on the picked tile.`}
      onDragStart={e => startDrag(e, drag)} onDragEnd={endDrag} onClick={() => applyToSelection(drag)}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', flexDirection: wide ? 'row' : 'column', alignItems: 'center', gap: wide ? 8 : 3, padding: bar ? '0 10px' : wide ? '4px 8px' : '6px 4px', height: bar ? 32 : undefined, justifyContent: 'center', flexShrink: bar ? 0 : undefined, border: 0, borderRadius: radius.md, cursor: 'grab',
        background: hover ? tk.bg.hover : tk.bg.field, color: colour ?? tk.text.primary, font: `700 12.5px ${fontFamily.mono}`, minWidth: 0,
        boxShadow: `inset 0 0 0 1px ${tk.border.subtle}`,
      }}>
      {children}
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>{label}</span>
    </button>
  );
}

/**
 * A tile's static graph (warpBuilder/glyphs.ts): thin axes and the curve in the tile's colour. Memoised and
 * store-free, so the palette never re-renders or draws anything live.
 */
const Glyph = memo(function Glyph({ path, axisX, axisY, colour, cond }: { path: string; axisX: number; axisY: number; colour: string; cond?: boolean }) {
  const tk = useTokens();
  const size = GLYPH_SIZE;
  return (
    <svg data-warp-glyph width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ borderRadius: 6, background: tk.bg.panel, flexShrink: 0 }} aria-hidden>
      {!cond && <path d={`M4 ${axisY}H${size - 4}M${axisX} 4V${size - 4}`} stroke={alpha(tk.text.muted, 0.4)} strokeWidth={1} fill="none" />}
      <path d={path} fill="none" stroke={colour} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
});

const FnPicture = memo(function FnPicture({ f }: { f: FnTile }) {
  const tk = useTokens();
  const g = FN_GLYPHS[f.fn];
  return <Glyph path={g.path} axisX={g.axisX} axisY={g.axisY} colour={tk.accent.text} cond={g.rotate} />;
});

const IfPicture = memo(function IfPicture({ cond }: { cond?: CondGlyph }) {
  return <Glyph path={COND_GLYPHS[cond ?? 'if']} axisX={0} axisY={0} colour="#e8957f" cond />;
});

function Palette() {
  const grid = (cols: number): CSSProperties => ({ display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: 5 });
  return (
    <div data-warp-palette style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '14px 12px 24px' }}>
      <StudioLabel meta="graphs: the shape of each">Functions</StudioLabel>
      <div style={grid(3)}>
        {FN_TILES.map(f => (
          <PaletteTile key={f.fn} drag={{ from: 'palette', kind: 'fn', fn: f.fn }} label={f.label} hint={`${f.label}: ${f.blurb}`}>
            <FnPicture f={f} />
          </PaletteTile>
        ))}
      </div>
      <StudioLabel meta="split space by a condition">If</StudioLabel>
      <PaletteTile wide drag={{ from: 'palette', kind: 'if' }} hint="If a condition holds, one value, else another: cond ? a : b. Its condition takes comparisons (and, or, not)"
        label={<span style={{ font: `600 12px ${fontFamily.ui}` }}><b style={{ color: '#e8957f' }}>if</b> ▢ <b style={{ color: '#e8957f' }}>then</b> ▢ <b style={{ color: '#e8957f' }}>else</b> ▢</span>}>
        <IfPicture />
      </PaletteTile>
      <div style={grid(3)}>
        {CMP_TILES.map(c => <PaletteTile key={c.op} drag={{ from: 'palette', kind: 'cmp', op: c.op }} label={<span style={{ fontSize: 15, color: '#e8957f' }}>{c.label}</span>} hint={`${c.blurb}: a condition, _ ${c.label} _ (for the If’s condition)`}><IfPicture cond={c.op} /></PaletteTile>)}
        {LOGIC_TILES.map(c => <PaletteTile key={c.op} drag={c.op === '!' ? { from: 'palette', kind: 'not' } : { from: 'palette', kind: 'logic', op: c.op }} label={<span style={{ color: '#e8957f' }}>{c.label}</span>} hint={`${c.blurb} (conditions only)`}><IfPicture cond={c.op} /></PaletteTile>)}
      </div>
      <BuilderNote style={{ fontSize: 11 }}>Variables, the number tile and the operators are in the bar under the preview, beside the rows.</BuilderNote>
    </div>
  );
}

/**
 * The tile bar: variables, the number tile and the operators, in one compact strip between the
 * preview and the blocks. It stays put while the blocks scroll; on a narrow window it scrolls sideways.
 */
function TileBar() {
  const tk = useTokens();
  const loop = useWarpBuilder(s => { const b = s.sel ? s.spec.blocks[s.sel.block]?.block : s.spec.blocks[0]?.block; return !!b?.loop; });
  const sep = <span aria-hidden style={{ width: 1, alignSelf: 'stretch', margin: '2px 4px', background: tk.border.subtle, flexShrink: 0 }} />;
  return (
    <div data-warp-tilebar role="toolbar" aria-label="Tiles: drag onto a row, or click to put on the picked tile"
      style={{ flexShrink: 0, height: 46, boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 4, padding: '0 10px', overflowX: 'auto', overflowY: 'hidden', whiteSpace: 'nowrap', borderTop: `1px solid ${tk.border.subtle}`, background: tk.bg.panel }}>
      {VAR_TILES.filter(v => !v.loop || loop).map(v => (
        <PaletteTile key={v.name} bar drag={{ from: 'palette', kind: 'var', name: v.name }} label={<>{v.name === 't' && <Icon name="clock" size={13} />}{v.label}</>} hint={v.blurb} colour={varColour(v.name)} />
      ))}
      {sep}
      <PaletteTile bar drag={{ from: 'palette', kind: 'num' }} label={<><span>#</span><span style={{ font: `500 11px ${fontFamily.ui}`, color: tk.text.muted }}>slider</span></>} hint="A number you can drag live: a slider named from where it lands (amp, freq…). On a filled tile it multiplies it" />
      {sep}
      {OP_TILES.map(o => <PaletteTile key={o.op} bar drag={{ from: 'palette', kind: 'op', op: o.op }} label={<span style={{ fontSize: 15 }}>{o.label}</span>} hint={`${o.blurb}: tile ${o.label} an empty slot`} />)}
    </div>
  );
}

// ── The inspector ────────────────────────────────────────────────────────────

function PickedTile() {
  const tk = useTokens();
  const sel = useWarpBuilder(s => s.sel);
  const item = useWarpBuilder(s => (s.sel ? s.spec.blocks[s.sel.block]?.block : undefined));
  const edit = useWarpBuilder(s => s.edit);
  const root = item && sel ? rowTile(item, sel.line) : null;
  const tile = sel ? tileAt(root, sel.path) : null;
  const [draft, setDraft] = useState<{ key: string; text: string } | null>(null);
  if (!sel || !item || !tile) return <BuilderNote>Click a tile in a row to pick it: palette clicks land there, and Delete takes it out.</BuilderNote>;
  const key = `${sel.block}:${sel.line}:${sel.path.join('.')}:${tileText(tile)}`;
  const text = draft?.key === key ? draft.text : tileText(tile);
  const set = (fn: (r: Tile | null) => Tile | null) => edit(d => { const b = d.blocks[sel.block].block; setRowTile(b, sel.line, fn(rowTile(b, sel.line))); });
  const commit = () => {
    if (draft?.key !== key) return;
    const parsed = textToTile(draft.text, item.params.map(p => p.name));
    set(r => (parsed ? replaceAt(r, sel.path, parsed) : removeAt(r, sel.path)));
    setDraft(null);
  };
  const param = tile.k === 'param' ? item.params.find(p => p.name === tile.name) : undefined;
  return (
    <div data-warp-picked style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <input aria-label="The picked tile as text" value={text} onChange={e => setDraft({ key, text: e.target.value })} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') commit(); }}
        style={{ height: 30, padding: '0 8px', borderRadius: radius.sm, border: `1px solid ${tk.border.default}`, background: tk.bg.field, color: tk.text.primary, font: `500 12px ${fontFamily.mono}` }} />
      {tile.k === 'code' && <BuilderNote style={{ fontSize: 11 }}>Kept as code: tiles don’t cover this part. Edit its text; it turns into tiles when it can.</BuilderNote>}
      {tile.k === 'num' && (
        <>
          <NumRow label="Value" value={tile.value} {...rangeFor(tile.value)} onChange={v => set(r => replaceAt(r, sel.path, { k: 'num', value: v }))} />
          <Button size="sm" variant="ghost" icon="sliders" onClick={() => edit(d => {
            const b = d.blocks[sel.block].block;
            const r = rowTile(b, sel.line);
            const name = nameForNumber(r, sel.path, [...b.params.map(p => p.name), 'x', 'y', 'uv', 't', 'p']);
            b.params.push({ name, value: tile.value, ...rangeFor(tile.value) });
            setRowTile(b, sel.line, replaceAt(r, sel.path, { k: 'param', name }));
          })}>Make a slider</Button>
        </>
      )}
      {tile.k === 'if' && (
        <div data-warp-if-soft style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <Segmented ariaLabel="Hard or smooth edge" size="sm" value={tile.soft ? 'smooth' : 'hard'}
            onChange={v => {
              if (v === 'hard') { set(r => replaceAt(r, sel.path, setSoft(tile, null)!)); return; }
              edit(d => {
                const b = d.blocks[sel.block].block;
                const r = rowTile(b, sel.line);
                const now = tileAt(r, sel.path);
                if (!now || !canSoft(now)) return;
                let name = 'width', i = 2;
                while (b.params.some(p => p.name === name)) name = `width${i++}`;
                b.params.push({ name, value: 0.05, min: 0, max: 0.5 });
                setRowTile(b, sel.line, replaceAt(r, sel.path, setSoft(now, { k: 'param', name })!));
              });
            }}
            options={[{ value: 'hard' as const, label: 'Hard' }, { value: 'smooth' as const, label: 'Smooth' }]} />
          <BuilderNote style={{ fontSize: 11 }}>{tile.soft
            ? 'Smooth: a soft step across the edge, width wide (mix with smoothstep), so it doesn’t alias.'
            : canSoft(tile) ? 'Hard: cond ? a : b. Smooth blends across the edge instead.' : 'Smooth needs one comparison with <, >, ≤ or ≥ as the condition.'}</BuilderNote>
        </div>
      )}
      {param && <NumRow label={<span style={{ fontFamily: fontFamily.mono }}>{param.name}</span>} value={param.value} min={param.min} max={param.max} step={(param.max - param.min) > 20 ? 0.1 : 0.005}
        onChange={v => edit(d => { const q = d.blocks[sel.block].block.params.find(x => x.name === param.name); if (q) { q.value = v; q.min = Math.min(q.min, v); q.max = Math.max(q.max, v); } }, `warp:p:${param.name}`)} />}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {!isBool(tile) && <Button size="sm" variant="ghost" icon="copy" data-warp-duplicate onClick={() => set(r => duplicateAt(r, sel.path))} title="Duplicate this term: tile + tile (⌘D)">Duplicate</Button>}
        {tile.k === 'op' && <Button size="sm" variant="ghost" icon="bidir" onClick={() => set(r => swapAt(r, sel.path))} title="Swap the two sides">Swap</Button>}
        <Button size="sm" variant="ghost" icon="trash" onClick={() => { set(r => removeAt(r, sel.path)); useWarpBuilder.getState().select({ ...sel, path: sel.path.slice(0, -1) }); }} title="Take it out (Delete)">Delete</Button>
      </div>
    </div>
  );
}

function BlockSettings() {
  const tk = useTokens();
  const index = useWarpBuilder(s => (s.sel ? s.sel.block : s.spec.blocks.length ? 0 : -1));
  const item = useWarpBuilder(s => s.spec.blocks[index]);
  const edit = useWarpBuilder(s => s.edit);
  const [saving, setSaving] = useState(false);
  if (!item) return null;
  const b = item.block;
  const up = (fn: (x: SpaceBlock) => void, key?: string) => edit(d => fn(d.blocks[index].block), key);
  return (
    <div data-warp-block-settings={index} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <input aria-label="Block name" value={b.name ?? ''} placeholder="Name" onChange={e => up(x => { x.name = e.target.value; }, `warp:name:${index}`)}
        style={{ height: 30, padding: '0 8px', borderRadius: radius.sm, border: `1px solid ${tk.border.default}`, background: tk.bg.field, color: tk.text.primary, font: `600 12.5px ${fontFamily.ui}` }} />
      <Segmented ariaLabel="Repeat or loop" size="sm" value={b.loop ? 'loop' : 'run'} onChange={v => up(x => { x.loop = v === 'loop' || undefined; x.times = clampTimes(x.times, !!x.loop); if (!x.loop) delete x.trap; })}
        options={[{ value: 'run' as const, label: 'Run ×' }, { value: 'loop' as const, label: 'Loop' }]} />
      {b.loop
        ? <NumRow label="Iterations" hint="The rows run in a loop: i (the pass), k (0 → 1) and uv0 (the point before the block) are in the palette." value={b.times} min={1} max={MAX_LOOP_TIMES} integer onChange={v => up(x => { x.times = clampTimes(v, true); }, `warp:times:${index}`)} />
        : <NumRow label="Run ×" hint="Runs the rows this many times over: folds become fractals." value={b.times} min={1} max={MAX_TIMES} integer onChange={v => up(x => { x.times = clampTimes(v); }, `warp:times:${index}`)} />}
      {b.loop && (
        <Select ariaLabel="Orbit trap" height={28} value={b.trap ?? 'off'} options={[{ value: 'off', label: 'Orbit trap: off' }, ...TRAP_KINDS.map(k => ({ value: k.kind, label: `Orbit trap: ${k.label}` }))]}
          onChange={v => up(x => { x.trap = v === 'off' ? null : v as TrapKind; })} />
      )}
      {b.params.length > 0 && <StudioLabel meta="live, no recompiling">Sliders</StudioLabel>}
      {b.params.map(p => (
        <NumRow key={p.name} label={<span style={{ fontFamily: fontFamily.mono }}>{p.name}</span>} value={p.value} min={p.min} max={p.max} step={(p.max - p.min) > 20 ? 0.1 : 0.005}
          onChange={v => up(x => { const q = x.params.find(y => y.name === p.name); if (q) { q.value = v; q.min = Math.min(q.min, v); q.max = Math.max(q.max, v); } }, `warp:p:${index}:${p.name}`)} />
      ))}
      {saving
        ? <SaveBlockForm src={{ block: b }} onCancel={() => setSaving(false)} onSaved={name => { up(x => { x.my = name; x.name = name; delete x.lib; }); setSaving(false); }} />
        : <Button size="sm" variant="ghost" icon="save" data-warp-save onClick={() => setSaving(true)} title="Save this block to My blocks (with a picture), for the 2D builder and here">{b.my ? 'Save changes…' : 'Save to My blocks…'}</Button>}
    </div>
  );
}

function Inspector() {
  const [lib, setLib] = useState(false);
  const edit = useWarpBuilder(s => s.edit);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '14px 14px 24px' }}>
      <StudioLabel>Picked tile</StudioLabel>
      <PickedTile />
      <StudioLabel>Block</StudioLabel>
      <BlockSettings />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <StudioLabel meta="built-in and My blocks">Library</StudioLabel>
        <span style={{ flex: 1 }} />
        <Button size="sm" variant={lib ? 'secondary' : 'ghost'} icon="presets" data-warp-library onClick={() => setLib(!lib)}>{lib ? 'Hide' : 'Open'}</Button>
      </div>
      {lib && <BlockLibrary compact onPick={b => {
        let at = 0;
        edit(d => { at = d.blocks.length; d.blocks.push({ id: nextItemId(d), block: cloneBlock(b) }); });
        useWarpBuilder.getState().select({ block: at, line: 0, path: [] });
      }} />}
    </div>
  );
}

// ── The window ───────────────────────────────────────────────────────────────

const TimeReadout = memo(function TimeReadout({ bind }: { bind: { current: ((t: number) => void) | null } }) {
  const [t, setT] = useState(0);
  useEffect(() => { bind.current = setT; return () => { bind.current = null; }; }, [bind]);
  return <span data-warp-clock style={{ font: `600 11.5px ${fontFamily.mono}` }}>t = {t.toFixed(1)}</span>;
});

function Viewport() {
  const tk = useTokens();
  const spec = useWarpBuilder(s => s.spec);
  const mode = useWarpBuilder(s => s.mode);
  const hover = useWarpBuilder(s => s.hover);
  const [playing, setPlaying] = useState(true);
  // The clock ticks ten times a second: only its readout re-renders, not the viewport, tile bar and rows.
  const readout = useRef<((t: number) => void) | null>(null);
  const onTime = useCallback((v: number) => readout.current?.(v), []);
  const [seek, setSeek] = useState<{ t: number; n: number } | undefined>();
  const edit = useWarpBuilder(s => s.edit);
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ position: 'relative', flex: '1 1 55%', minHeight: 240 }}>
        <WarpPreview spec={spec} mode={mode} upTo={hover} playing={playing} onTime={onTime} seek={seek} />
        <div style={{ position: 'absolute', top: 10, left: 10, right: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ background: alpha('#000', 0.45), borderRadius: 10, padding: 2 }}>
            <Segmented ariaLabel="Preview" size="sm" value={mode} onChange={(m: PreviewMode) => useWarpBuilder.getState().setMode(m)}
              options={PREVIEW_MODES.map(m => ({ value: m.mode, label: <span title={m.blurb} data-warp-mode={m.mode}>{m.label}</span> }))} />
          </span>
          <span style={{ flex: 1 }} />
          {hover !== null && <span data-warp-after style={{ padding: '4px 8px', borderRadius: 8, background: alpha('#000', 0.55), color: '#fff', fontSize: 12 }}>The space after block {hover}</span>}
        </div>
        <div style={{ position: 'absolute', bottom: 10, left: 10, display: 'flex', alignItems: 'center', gap: 6, padding: '2px 8px 2px 2px', borderRadius: 10, background: alpha('#000', 0.45), color: '#fff' }}>
          <IconButton icon={playing ? 'pause' : 'play'} size="sm" label={playing ? 'Pause time' : 'Play time'} onClick={() => setPlaying(!playing)} />
          <TimeReadout bind={readout} />
          <IconButton icon="reset" size="sm" label="Back to t = 0" onClick={() => setSeek(s => ({ t: 0, n: (s?.n ?? 0) + 1 }))} />
        </div>
      </div>
      <TileBar />
      <div data-warp-stack style={{ flex: '1 1 45%', minHeight: 180, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 6, background: tk.bg.subtle }}>
        {spec.blocks.map((b, i) => (
          <div key={b.id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {i > 0 && <span aria-hidden style={{ alignSelf: 'center', font: `600 10.5px ${fontFamily.mono}`, color: tk.text.faint }}>↓ warps the result</span>}
            <BlockCard index={i} />
          </div>
        ))}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Button size="sm" variant="ghost" icon="plus" data-warp-add-block onClick={() => {
            let at = 0;
            edit(d => { at = d.blocks.length; d.blocks.push({ id: nextItemId(d), block: newWarpBlock(`Warp ${d.blocks.length + 1}`) }); });
            useWarpBuilder.getState().select({ block: at, line: 0, path: [] });
          }}>Block</Button>
          <BuilderNote style={{ fontSize: 11 }}>Each block warps the result of the one above. Hover a block to see the space after it.</BuilderNote>
        </div>
      </div>
    </div>
  );
}

export function WarpBuilder() {
  const undo = useWarpBuilder(s => s.undo);
  const redo = useWarpBuilder(s => s.redo);
  const canUndo = useWarpBuilder(s => s.past.length > 0);
  const canRedo = useWarpBuilder(s => s.future.length > 0);
  const seed = useWarpBuilder(s => s.surpriseSeed);
  const origin = useWarpBuilder(s => s.origin);
  const blocks = useWarpBuilder(s => s.spec.blocks.length);

  // ⌘Z / ⌘⇧Z undo the builder; Delete takes the picked tile out; ⌘D duplicates it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable)) return;
      const st = useWarpBuilder.getState();
      const mod = e.metaKey || e.ctrlKey;
      const onSel = (fn: (r: Tile | null, p: TilePath) => Tile | null) => {
        const s = st.sel;
        if (!s) return;
        st.edit(d => { const b = d.blocks[s.block]?.block; if (b?.lines[s.line]) setRowTile(b, s.line, fn(rowTile(b, s.line), s.path)); });
      };
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.stopPropagation(); if (e.shiftKey) st.redo(); else st.undo(); }
      else if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); e.stopPropagation(); onSel(duplicateAt); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && st.sel) { e.preventDefault(); e.stopPropagation(); onSel(removeAt); st.select({ ...st.sel, path: st.sel.path.slice(0, -1) }); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const from2d = origin.kind === '2d';
  const phone = usePhoneDialog();
  return (
    <StudioShell prefsKey="warp-builder" icon="wave" title="Warp Builder" crumb={from2d ? undefined : <SceneCrumb kind="warp" onBack={backToSceneKinds} />}
      kind={`${blocks} block${blocks === 1 ? '' : 's'}${from2d ? ' · from the 2D Scene Builder' : ''}`}
      onClose={() => useWarpBuilder.getState().close()}
      actions={<>
        <IconButton icon="undo" size="sm" label="Undo" shortcut="cmd+z" disabled={!canUndo} onClick={undo} />
        <IconButton icon="redo" size="sm" label="Redo" shortcut="cmd+shift+z" disabled={!canRedo} onClick={redo} />
        {!from2d && (phone
          ? <IconButton icon="export" size="sm" data-warp-send-2d label="Send to the 2D Scene Builder: these blocks in its Space" onClick={sendWarpTo2D} />
          : <Button size="sm" variant="ghost" icon="export" data-warp-send-2d onClick={sendWarpTo2D} title="Put these blocks in the 2D Scene Builder's Space (the open scene, or a new one)">Send to 2D Scene Builder</Button>)}
      </>}
      surprise={<SurpriseBar seed={seed} title="A random tile expression from a new seed (one undo step)" onSurprise={s => useWarpBuilder.getState().surprise(s)} />}
      primary={{ label: from2d && !phone ? 'Done: back to 2D' : 'Done', onClick: finishWarpBuilder, title: from2d ? 'Write these blocks into the 2D scene\'s Space and go back to it' : 'Build a UV → the warp → the preview look, and show it on the graph' }}
      nav={<Palette />} navWidth={280} phoneNav={{ label: 'Tiles', icon: 'fn' }}
      inspector={<Inspector />} inspectorWidth={360}>
      <Viewport />
    </StudioShell>
  );
}
