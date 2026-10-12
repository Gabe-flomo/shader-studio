/**
 * SpaceBlocks — the 2D Scene Builder's space blocks (docs/scene-builder-2d.md, "Space blocks").
 *
 *  - SpaceView: the whole space stack drawn as a warped grid, big, at the top of the Space tab;
 *    hovering a block shows the space as it is after that block.
 *  - BlockEditor: up to three lines in Expression Block style (target, operator, expression), each
 *    checked as you type; its numbers as sliders; Run × for folds that repeat; Make a slider on a number.
 *  - CombineEditor: two blocks on the same uv, joined by add, subtract, multiply or blend.
 *  - BlockLibrary: the library by category, each with a thumbnail of a grid warped by it, and
 *    Random, which offers three to pick from. My blocks (your saved ones, MyBlocks.tsx) come first.
 *
 * The pure work is sceneBuilder2d/blocks.ts and blockLibrary.ts; this is the form.
 */
import { ExprLineInput } from '../builders/ExprLineInput';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BLOCK_OPS, BLOCK_TARGETS, COMBINE_MODES, LOOP_BLOCK_NAMES, MAX_LINES, MAX_LOOP_TIMES, MAX_TIMES, TRAP_KINDS, blockMap, checkBlock, clampTimes, emptyLine, paramNameProblem, rangeFor,
  type BlockOp, type BlockTarget, type CombineMode, type CombineSpec, type SpaceBlock, type TrapKind,
} from '../../sceneBuilder2d/blocks';
import { BLOCK_CATEGORIES, BLOCK_LIBRARY, blockFromEntry, isLibraryBlock, randomChoices, type BlockCategory, type BlockEntry } from '../../sceneBuilder2d/blockLibrary';
import { MY_BLOCKS, MY_BLOCKS_LABEL, sceneOpFromSaved, type SavedBlock } from '../../sceneBuilder2d/savedBlocks';
import { ImportBlock, SaveBlockForm, SavedTile, useSavedBlocks } from './MyBlocks';
import { renderWarpThumbnail, stackMap } from '../../sceneBuilder2d/thumbnails';
import type { SpaceOp } from '../../sceneBuilder2d/spec';
import { literalAt, literalToSlider, type LiteralSpan } from '../../lib/glslPatterns/literalSlider';
import { MakeSliderButton } from '../code/MakeSlider';
import { BuilderNote } from '../builders/BuilderWindow';
import { NumRow, Row } from '../sceneBuilder/controls';
import { Button, IconButton } from '../ui/Button';
import { Select } from '../ui/Select';
import { RulerSlider } from '../ui/RulerSlider';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';

type Map2 = (x: number, y: number) => [number, number];

/** A canvas of a grid warped by `map`, redrawn when `k` changes. */
export function WarpCanvas({ map, k, size, title }: { map: () => Map2; k: string; size: number; title?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    try { ctx.putImageData(new ImageData(new Uint8ClampedArray(renderWarpThumbnail(map(), size)), size, size), 0, 0); } catch { /* a picture is a nicety */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- redraw when the key changes
  }, [k, size]);
  return <canvas ref={ref} width={size} height={size} title={title} data-warp-thumb={k.slice(0, 40)} style={{ width: size, height: size, borderRadius: 6, display: 'block', flexShrink: 0 }} />;
}

// ── The space view ────────────────────────────────────────────────────────────

/** The space stack as a warped grid: what every shape below sees. `upTo` stops after that many transforms. */
export function SpaceView({ ops, upTo, hoverName }: { ops: SpaceOp[]; upTo: number | null; hoverName?: string }) {
  const tk = useTokens();
  const [t, setT] = useState(0);
  const shown = upTo === null ? ops : ops.slice(0, upTo);
  const key = useMemo(() => JSON.stringify([shown, t]), [shown, t]);
  const size = 196;
  return (
    // Sticky: the picture stays in view while the blocks scroll under it (hover one to see the space after it).
    <div data-space-view style={{ position: 'sticky', top: 0, zIndex: 2, margin: '-14px -16px 0', padding: '14px 16px 10px', background: tk.bg.panel, boxShadow: `0 1px 0 ${tk.border.subtle}` }}>
    <div style={{ display: 'flex', gap: 14, alignItems: 'stretch', padding: 12, borderRadius: radius.card, background: tk.bg.field }}>
      <WarpCanvas map={() => stackMap(shown, t)} k={key} size={size} title="The space as a grid: every shape below looks from here" />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <b style={{ fontSize: 14, fontWeight: 650 }}>Space</b>
        <BuilderNote>
          {upTo !== null
            ? <>After <b>{hoverName}</b>: the grid as the transforms up to and including it leave it.</>
            : <>A grid seen through the whole stack, top to bottom. Each block’s uv feeds the next. The orange ring is radius 0.62; lines are ¼ apart.</>}
        </BuilderNote>
        <BuilderNote>{ops.length ? `${ops.length} transform${ops.length === 1 ? '' : 's'}. Hover one to see the space after it.` : 'Nothing bends space yet: add a block from the library below.'}</BuilderNote>
        <span style={{ flex: 1 }} />
        <Row label="Time t" hint="Where time stands for this picture (seconds). The preview on the right plays.">
          <RulerSlider value={t} min={0} max={10} step={0.05} onChange={setT} ariaLabel="Time t" />
        </Row>
      </div>
    </div>
    </div>
  );
}

// ── One block ─────────────────────────────────────────────────────────────────

const TAKEN_ALWAYS = ['x', 'y', 'uv', 't', 'p', 'PI', 'TAU'];

/**
 * A block's lines, sliders and Run ×. `update` changes the block in the scene (one undo step;
 * `key` folds a run of typing or slider moves into one).
 */
export function BlockEditor({ block, update, idBase }: { block: SpaceBlock; update: (fn: (b: SpaceBlock) => void, key?: string) => void; idBase: string }) {
  const tk = useTokens();
  const chk = useMemo(() => checkBlock(block), [block]);
  const [offer, setOffer] = useState<{ line: number; lit: LiteralSpan } | null>(null);
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);
  const lib = isLibraryBlock(block);
  const taken = [...TAKEN_ALWAYS, ...block.params.map(p => p.name)];

  /** The caret (or selection) on a number offers Make a slider. */
  const caret = (i: number, el: HTMLInputElement) => {
    const lit = literalAt(el.value, el.selectionStart ?? 0, el.selectionEnd ?? 0);
    setOffer(lit ? { line: i, lit } : null);
  };
  const makeSlider = (i: number, lit: LiteralSpan) => {
    const text = block.lines[i].rhs;
    const made = literalToSlider(text, { ...lit, int: false }, taken);
    update(b => {
      b.lines[i].rhs = made.text;
      b.params.push({ name: made.name, value: made.value, min: Math.min(made.slider.min, made.value), max: Math.max(made.slider.max, made.value) });
    });
    setOffer(null);
  };
  const addSlider = () => {
    const name = newName.trim();
    if (paramNameProblem(name, taken)) return;
    update(b => { b.params.push({ name, value: 1, ...rangeFor(1) }); });
    setNewName('');
  };
  const nameProblem = newName.trim() ? paramNameProblem(newName.trim(), taken) : null;
  // What a line can name: the point, time and the block's sliders (autocomplete).
  const vars = useMemo(() => [{ name: 'x', type: 'float' }, { name: 'y', type: 'float' }, { name: 'uv', type: 'vec2' }, { name: 't', type: 'float' }, ...(block.loop ? LOOP_BLOCK_NAMES.map(v => ({ name: v.name, type: v.type })) : []), ...block.params.map(p => ({ name: p.name, type: 'float' }))], [block.params, block.loop]);

  return (
    <div data-block-editor={idBase} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {block.lines.map((l, i) => {
          const c = chk.lines[i];
          return (
            <div key={i} data-block-line={i} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4 }}>
                <span style={{ width: 82, flexShrink: 0 }}>
                  <Select ariaLabel={`Line ${i + 1} target`} mono height={28} value={l.target} options={BLOCK_TARGETS.map(x => ({ value: x, label: x }))}
                    onChange={v => update(b => { b.lines[i].target = v as BlockTarget; })} />
                </span>
                <span style={{ width: 58, flexShrink: 0 }}>
                  <Select ariaLabel={`Line ${i + 1} operator`} mono height={28} value={l.op} options={BLOCK_OPS.map(x => ({ value: x, label: x }))}
                    onChange={v => update(b => { b.lines[i].op = v as BlockOp; })} />
                </span>
                <ExprLineInput ariaLabel={`Line ${i + 1} expression`} attrs={{ 'data-block-rhs': i }} value={l.rhs} vars={vars}
                  placeholder={i === 0 ? 'e.g. amp * sin(y * 6 + t)' : 'leave empty: as it is'} invalid={!!c && !c.ok}
                  onChange={v => update(b => { b.lines[i].rhs = v; }, `${idBase}:rhs${i}`)}
                  onCaret={el => caret(i, el)}
                  onBlur={() => setTimeout(() => setOffer(o => (o?.line === i ? null : o)), 150)} />
                <IconButton icon="close" label="Remove this line" size="sm" onClick={() => update(b => { b.lines.splice(i, 1); })} />
              </div>
              {c && !c.ok && <div role="alert" data-block-error={i} style={{ fontSize: 11.5, color: tk.status.danger, paddingLeft: 146 }}>{c.error}</div>}
              {offer?.line === i && <MakeSliderButton lit={offer.lit} onMake={() => makeSlider(i, offer.lit)} indent={146} />}
            </div>
          );
        })}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {block.lines.length < MAX_LINES && (
            <Button size="sm" variant="ghost" icon="plus" onClick={() => update(b => { b.lines.push(emptyLine(b.lines.length === 0 ? 'uv.x' : b.lines.length === 1 ? 'uv.y' : 'uv')); })}>Line</Button>
          )}
          <BuilderNote style={{ fontSize: 11 }}>x, y = uv.x, uv.y as they are now · t = time{block.loop ? ' · uv0 = the point before the block · fi, k, n = the pass' : ''} · whole numbers are fine</BuilderNote>
        </div>
      </div>
      {chk.errors.map((e, i) => <div key={i} role="alert" style={{ fontSize: 11.5, color: tk.status.danger }}>{e}</div>)}
      {block.params.map((p, j) => (
        <div key={p.name} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <NumRow label={<span style={{ fontFamily: fontFamily.mono }}>{p.name}</span>} hint={chk.unused.includes(p.name) ? 'No line uses this slider yet.' : undefined}
              value={p.value} min={p.min} max={p.max} step={(p.max - p.min) > 20 ? 0.1 : 0.005}
              onChange={v => update(b => { const q = b.params[j]; q.value = v; q.min = Math.min(q.min, v); q.max = Math.max(q.max, v); }, `${idBase}:param:${p.name}`)} />
          </div>
          {!lib && <IconButton icon="close" label={`Remove slider ${p.name}`} size="sm" onClick={() => update(b => { b.params.splice(j, 1); })} />}
        </div>
      ))}
      {!lib && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input aria-label="New slider name" placeholder="New slider name (e.g. amp)" value={newName} onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addSlider(); }}
            style={{ flex: 1, minWidth: 0, height: 26, padding: '0 8px', borderRadius: radius.sm, border: `1px solid ${nameProblem ? tk.status.danger : tk.border.default}`, background: tk.bg.field, color: tk.text.primary, font: `500 12px ${fontFamily.mono}` }} />
          <Button size="sm" variant="ghost" icon="sliders" disabled={!newName.trim() || !!nameProblem} onClick={addSlider}>Add slider</Button>
        </div>
      )}
      {nameProblem && <BuilderNote style={{ color: tk.status.danger }}>{nameProblem}</BuilderNote>}
      {block.loop ? (
        <>
          <NumRow label="Iterations" hint={`The lines run in a loop on the block's node (Loop mode): Iterations is a live slider there too, up to ${MAX_LOOP_TIMES}, without recompiling.`} value={block.times} min={1} max={MAX_LOOP_TIMES} integer
            onChange={v => update(b => { b.times = clampTimes(v, true); }, `${idBase}:times`)} />
          <div data-block-trap={idBase} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 82, flexShrink: 0, fontSize: 12, color: tk.text.muted }} title="During the loop, the closest the point came to a shape: the block's trap output, a shade 1 where it came close. Look → Colour by trap reads it.">Orbit trap</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <Select ariaLabel="Orbit trap" height={28} value={block.trap ?? 'off'} options={[{ value: 'off', label: 'Off' }, ...TRAP_KINDS.map(k => ({ value: k.kind, label: `${k.label}: ${k.blurb}` }))]}
                onChange={v => update(b => { b.trap = v === 'off' ? null : v as TrapKind; })} />
            </span>
          </div>
          {block.trap && <BuilderNote style={{ fontSize: 11 }}>Shade the scene by it: Look → Colour by → trap.</BuilderNote>}
        </>
      ) : (
        <NumRow label="Run ×" hint="Runs the lines this many times over: folds and repeats become fractals." value={block.times} min={1} max={MAX_TIMES} integer
          onChange={v => update(b => { b.times = Math.max(1, Math.min(MAX_TIMES, Math.round(v))); }, `${idBase}:times`)} />
      )}
      {saving
        ? <SaveBlockForm src={{ block }} onCancel={() => setSaving(false)} onSaved={name => { update(b => { b.my = name; b.name = name; delete b.lib; }); setSaving(false); }} />
        : (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <Button size="sm" variant="ghost" icon="save" data-save-block={idBase} onClick={() => setSaving(true)}
              title="Save this block to My blocks in the library, with a picture of what it does">{block.my ? 'Save changes…' : 'Save block…'}</Button>
            {block.my && <BuilderNote style={{ fontSize: 11 }}>From your “{block.my}”</BuilderNote>}
          </div>
        )}
    </div>
  );
}

// ── A combine ─────────────────────────────────────────────────────────────────

export function CombineEditor({ spec, update, idBase }: { spec: CombineSpec; update: (fn: (c: CombineSpec) => void, key?: string) => void; idBase: string }) {
  const tk = useTokens();
  const [picking, setPicking] = useState<'a' | 'b' | null>(null);
  const [saving, setSaving] = useState(false);
  const mode = COMBINE_MODES.find(m => m.mode === spec.mode) ?? COMBINE_MODES[0];
  return (
    <div data-combine-editor={idBase} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div role="radiogroup" aria-label="How to combine" style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {COMBINE_MODES.map(m => (
          <button key={m.mode} type="button" role="radio" aria-checked={spec.mode === m.mode} title={m.blurb} onClick={() => update(c => { c.mode = m.mode as CombineMode; })}
            style={{ padding: '5px 10px', border: 0, borderRadius: radius.control, cursor: 'pointer', font: `600 12px ${fontFamily.ui}`,
              background: spec.mode === m.mode ? tk.bg.selected : tk.bg.field, color: spec.mode === m.mode ? tk.accent.text : tk.text.secondary, boxShadow: spec.mode === m.mode ? `inset 0 0 0 1px ${tk.accent.base}` : 'none' }}>
            {m.label}
          </button>
        ))}
      </div>
      <BuilderNote>{mode.blurb} <code style={{ fontFamily: fontFamily.mono }}>uv = {mode.glsl}</code></BuilderNote>
      {saving
        ? <SaveBlockForm src={{ combine: spec }} onCancel={() => setSaving(false)} onSaved={name => { update(c => { c.my = name; }); setSaving(false); }} />
        : <Button size="sm" variant="ghost" icon="save" data-save-combine={idBase} style={{ alignSelf: 'flex-start' }} onClick={() => setSaving(true)}
            title="Save the whole combine (both blocks and how they join) to My blocks">{spec.my ? `Save changes to “${spec.my}”…` : 'Save combine…'}</Button>}
      {spec.mode === 'blend' && <NumRow label="Amount" hint="0 is all A, 1 is all B." value={spec.amount} min={0} max={1} onChange={v => update(c => { c.amount = v; }, `${idBase}:amount`)} />}
      {(['a', 'b'] as const).map(side => {
        const b = spec[side];
        return (
          <div key={side} data-combine-side={side} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 10, borderRadius: radius.md, boxShadow: `inset 0 0 0 1px ${tk.border.subtle}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <WarpCanvas map={() => blockMap(b)} k={JSON.stringify(b)} size={44} />
              <b style={{ fontSize: 12.5, flex: 1 }}>{side.toUpperCase()} · {b.name || 'Block'}</b>
              <Button size="sm" variant={picking === side ? 'secondary' : 'ghost'} icon="presets" onClick={() => setPicking(picking === side ? null : side)}>From library</Button>
            </div>
            {picking === side && <BlockLibrary compact onPick={nb => { update(c => { c[side] = nb; }); setPicking(null); }} />}
            <BlockEditor block={b} idBase={`${idBase}:${side}`} update={(fn, key) => update(c => fn(c[side]), key)} />
          </div>
        );
      })}
    </div>
  );
}

// ── The library ───────────────────────────────────────────────────────────────

/** The library: categories, search, a tile per block (thumbnail, name, what it does), and Random. */
export function BlockLibrary({ onPick, onPickCombine, compact = false }: { onPick: (b: SpaceBlock) => void; /** A saved combine; without it, saved combines aren't offered. */ onPickCombine?: (c: CombineSpec) => void; compact?: boolean }) {
  const tk = useTokens();
  const [cat, setCat] = useState<BlockCategory | 'all' | typeof MY_BLOCKS>('all');
  const [q, setQ] = useState('');
  const [choices, setChoices] = useState<SpaceBlock[] | null>(null);
  const [importing, setImporting] = useState(false);
  const saved = useSavedBlocks().filter(s => s.block || onPickCombine);
  const matches = (text: string) => !q || text.toLowerCase().includes(q.toLowerCase());
  const shown = cat === MY_BLOCKS ? [] : BLOCK_LIBRARY.filter(e => (cat === 'all' || e.category === cat) && matches(`${e.name} ${e.blurb} ${e.lines.map(l => l.rhs).join(' ')}`));
  const savedText = (s: SavedBlock) => `${s.name} ${s.blurb} ${(s.block ? [s.block] : s.combine ? [s.combine.a, s.combine.b] : []).flatMap(b => b.lines.map(l => l.rhs)).join(' ')}`;
  const savedShown = saved.filter(s => (cat === 'all' || cat === MY_BLOCKS || s.category === cat) && matches(savedText(s))).sort((a, b) => a.name.localeCompare(b.name));
  // Random offers your saved blocks only when you said it may (Save block → Random may offer it).
  const randomExtra: BlockEntry[] = saved.filter(s => s.random && s.block).map(s => ({ id: `my:${s.name}`, name: s.name, category: (s.category === MY_BLOCKS ? 'mine' : s.category) as BlockCategory, blurb: s.blurb, lines: s.block!.lines, params: s.block!.params, times: s.block!.times }));
  const deal = (prev: SpaceBlock[] | null) => setChoices(randomChoices(Math.random, 3, prev?.map(c => c.lib ?? (c.my ? `my:${c.my}` : '')) ?? [], randomExtra));
  const pickSaved = (s: SavedBlock) => { const o = sceneOpFromSaved(s); if (o.combine) onPickCombine?.(o.combine); else if (o.block) onPick(o.block); };
  const thumb = compact ? 52 : 64;
  const chip = (on: boolean): React.CSSProperties => ({
    padding: '4px 9px', border: 0, borderRadius: 999, cursor: 'pointer', font: `600 11.5px ${fontFamily.ui}`,
    background: on ? alpha(tk.accent.base, 0.18) : tk.bg.field, color: on ? tk.accent.text : tk.text.secondary,
  });
  const tileStyle: React.CSSProperties = {
    display: 'flex', gap: 10, alignItems: 'flex-start', padding: 8, border: 0, borderRadius: radius.md, cursor: 'pointer', textAlign: 'left',
    background: tk.bg.field, color: tk.text.primary,
  };
  return (
    <div data-block-library style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input aria-label="Search blocks" placeholder={`Search ${BLOCK_LIBRARY.length} blocks…`} value={q} onChange={e => setQ(e.target.value)}
          style={{ flex: 1, minWidth: 0, height: 28, padding: '0 8px', borderRadius: radius.sm, border: `1px solid ${tk.border.default}`, background: tk.bg.field, color: tk.text.primary, font: `500 12px ${fontFamily.ui}` }} />
        <Button size="sm" icon="dice" data-block-random onClick={() => deal(choices)}
          title="Offers three random blocks to pick from">Random</Button>
      </div>
      {choices && (
        <div data-random-choices style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 10, borderRadius: radius.md, background: alpha(tk.accent.base, 0.08) }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <b style={{ fontSize: 12.5, flex: 1 }}>Pick one of three</b>
            <Button size="sm" variant="ghost" icon="dice" onClick={() => deal(choices)}>Three more</Button>
            <IconButton icon="close" label="Close the choices" size="sm" onClick={() => setChoices(null)} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 6 }}>
            {choices.map((b, i) => (
              <button key={`${b.lib ?? b.my}-${i}`} type="button" data-random-choice={b.lib ?? `my:${b.my}`} onClick={() => { onPick(b); setChoices(null); }}
                style={{ ...tileStyle, flexDirection: 'column', alignItems: 'center', background: tk.bg.panel }}
                title={b.lines.map(l => `${l.target} ${l.op} ${l.rhs}`).join('\n')}>
                <WarpCanvas map={() => blockMap(b, 1)} k={JSON.stringify(b)} size={84} />
                <span style={{ font: `600 12px ${fontFamily.ui}` }}>{b.name}</span>
                <span style={{ font: `500 10.5px ${fontFamily.mono}`, color: tk.text.muted, textAlign: 'center' }}>{b.params.map(p => `${p.name} ${Math.round(p.value * 100) / 100}`).join(' · ')}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <div role="tablist" aria-label="Block categories" style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        <button type="button" role="tab" aria-selected={cat === 'all'} style={chip(cat === 'all')} onClick={() => setCat('all')}>All</button>
        <button type="button" role="tab" aria-selected={cat === MY_BLOCKS} data-cat-mine title="The blocks you saved" style={chip(cat === MY_BLOCKS)} onClick={() => setCat(MY_BLOCKS)}>{MY_BLOCKS_LABEL}{saved.length ? ` ${saved.length}` : ''}</button>
        {BLOCK_CATEGORIES.map(c => (
          <button key={c.id} type="button" role="tab" aria-selected={cat === c.id} title={c.blurb} style={chip(cat === c.id)} onClick={() => setCat(c.id)}>{c.label}</button>
        ))}
      </div>
      {(cat === 'all' || cat === MY_BLOCKS || savedShown.length > 0) && (
        <div data-my-blocks style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <b style={{ fontSize: 12.5, flex: 1 }}>{MY_BLOCKS_LABEL}</b>
            {!importing && <Button size="sm" variant="ghost" icon="import" onClick={() => setImporting(true)} title="Add a block someone shared (its text or a .spaceblock.json file)">Import…</Button>}
          </div>
          {importing && <ImportBlock onDone={() => setImporting(false)} />}
          {savedShown.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${compact ? 200 : 230}px, 1fr))`, gap: 6, maxHeight: compact ? 200 : undefined, overflow: compact ? 'auto' : undefined }}>
              {savedShown.map(s => <SavedTile key={s.id} s={s} thumb={thumb} onPick={() => pickSaved(s)} />)}
            </div>
          )}
          {!savedShown.length && <BuilderNote>{saved.length ? 'None of your blocks match.' : 'Blocks you save (Save block… on any block) show here, with a picture of what they do.'}</BuilderNote>}
        </div>
      )}
      {cat !== MY_BLOCKS && (cat === 'all' || savedShown.length > 0) && <b style={{ fontSize: 12.5 }}>Library</b>}
      {cat !== MY_BLOCKS && <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${compact ? 200 : 230}px, 1fr))`, gap: 6, maxHeight: compact ? 260 : undefined, overflow: compact ? 'auto' : undefined }}>
        {shown.map(e => (
          <button key={e.id} type="button" data-block-entry={e.id} style={tileStyle} onClick={() => onPick(blockFromEntry(e))}
            title={`${e.lines.map(l => `${l.target} ${l.op} ${l.rhs}`).join('\n')}${e.loop ? `\n(a loop, ${e.times ?? 1} iterations, live${e.trap ? `; orbit trap: ${e.trap}` : ''})` : e.times && e.times > 1 ? `\n(run ×${e.times})` : ''}`}>
            <WarpCanvas map={() => blockMap(blockFromEntry(e), 1)} k={`lib:${e.id}`} size={thumb} />
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
              <span style={{ font: `600 12.5px ${fontFamily.ui}` }}>{e.name}</span>
              <span style={{ font: `500 11px/1.35 ${fontFamily.ui}`, color: tk.text.muted }}>{e.blurb}</span>
              {e.params.length > 0 && <span style={{ font: `500 10.5px ${fontFamily.mono}`, color: tk.text.faint }}>{e.params.map(p => p.name).join(' · ')}</span>}
            </span>
          </button>
        ))}
        {!shown.length && <BuilderNote>No block matches.</BuilderNote>}
      </div>}
    </div>
  );
}

