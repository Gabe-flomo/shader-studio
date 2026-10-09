/**
 * ExpressionBuilderModal — the Expression Builder window (docs/expression-builder.md, plan phase 2).
 *
 * Left: the chain, one row per step with its picture (click a row to go back to it; the rows
 * after it stay, dimmed, until something else is picked; each row's sliders stay tunable). Middle:
 * tabs — Next moves (the grid: same-type moves open, type-changing moves and recipes folded with
 * a summary), Seed, Code. Right: the big preview of the hovered tile or of the chain.
 *
 * Pictures are small real renders of the block Add to graph makes (exprPictures.ts), only for
 * tiles on screen, debounced and cached; a time seed is plotted on the CPU. Store reads are
 * selectors; the window is lazy (BuilderWindowsHost) and the catalogue loads when it opens.
 *
 * Phase 3: the grid is ranked by what usually comes next (rank.ts, inside `nextMoves`); the dull-move
 * filter (dull.ts) runs on the CPU in slices of a few milliseconds after each step, then hides what
 * wouldn't show ("Show hidden (n)") and lifts what changes the picture; each step row names what the
 * chain has become (naming.ts); "used in" sources open where they are written, "Where else?" opens
 * Find uses; Surprise me grows a random chain (surprise.ts), undoably.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { chainNames } from '../../exprBuilder/naming';
import { applyVerdicts, chainSamples, DULL_WORDS, judgeSteps, type DullReason, type Verdict } from '../../exprBuilder/dull';
import { surpriseSteps } from '../../exprBuilder/surprise';
import { sourceProvenance, templatePattern } from '../../exprBuilder/provenance';
import type { SourceRef } from '../../exprBuilder/moves';
import { lazyWithSuspense, type PropsOf } from '../lazyWithSuspense';
import type { FindUsesDialog as FindUsesDialogT } from '../explain/FindUsesDialog';
import { useExprBuilder, type ExprTab } from '../../exprBuilder/store';
import { addBuilderChainToGraph } from '../../exprBuilder/actions';
import { builderCatalogue } from '../../exprBuilder/catalogueSource';
import {
  SEEDS, TIME_SEED, UV_SEED, WORLD_SEED, chainEnd, inlineSteps, localName, nextMoves, tileSteps, variableSeed,
  type Chain, type ChainStep, type ExprSeed, type NextMoves, type SeedType, type StepHole, type Tile,
} from '../../exprBuilder/chain';
import { chainBlockParams, chainTitle } from '../../exprBuilder/block';
import { resolveTemplateSteps } from '../../exprBuilder/examples';
import type { Catalogue } from '../../exprBuilder/moves';
import { fieldPixels, fieldSummary } from '../explain/rowPicture';
import { TransferPlotView } from '../explain/TransferPlotView';
import { showValue, type GlslType } from '../../lib/glslPatterns';
import { BuilderHelp, BuilderLabel, BuilderNote, BuilderWindow, EmptyHelp } from '../builders/BuilderWindow';
import type { HelpExample } from '../builders/helpContent';
import type { BuilderSectionTab } from '../builders/builderLayout';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Select } from '../ui/Select';
import { RulerSlider } from '../ui/RulerSlider';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { renderChainRows, timePicture, type CpuPicture, type RowField } from './exprPictures';

const DEBOUNCE_MS = 250;
/** CSS pixels of a tile's picture. */
const TILE_PX = 112;
/** Tiles shown per section before "Show more". */
const PAGE = 12;
const DRAWABLE = new Set(['float', 'vec2', 'vec3', 'vec4']);
/** The dull-move filter works in slices of about this long, so a step never holds a frame. */
const SLICE_MS = 6;
/** Tiles judged first (the ones on screen): this many per section, then the rest. */
const FIRST = 2 * PAGE;

const FindUsesDialog = lazyWithSuspense<PropsOf<typeof FindUsesDialogT>>(() => import('../explain/FindUsesDialog').then(m => ({ default: m.FindUsesDialog })));

/** Timings for the last step (dev builds: `window.__xbPerf`), for checking the per-step cost. */
interface XbPerf { nextMovesMs: number; tiles: number; judgeMs: number; slices: number; maxSliceMs: number; wallMs: number; firstMs: number }
const perf = (patch: Partial<XbPerf>) => {
  if (!import.meta.env.DEV || typeof window === 'undefined') return;
  const w = window as unknown as { __xbPerf?: Partial<XbPerf> };
  w.__xbPerf = { ...w.__xbPerf, ...patch };
};

/** The grid for (catalogue, chain, cursor): worked out once, read by the grid and the preview. */
let lastGroups: { cat: Catalogue; chain: Chain; at: number; groups: NextMoves } | null = null;
function groupsFor(cat: Catalogue, chain: Chain, at: number): NextMoves {
  if (lastGroups && lastGroups.cat === cat && lastGroups.chain === chain && lastGroups.at === at) return lastGroups.groups;
  const t0 = performance.now();
  const groups = nextMoves(chain, cat, at);
  perf({ nextMovesMs: performance.now() - t0 });
  lastGroups = { cat, chain, at, groups };
  return groups;
}

// ── The dull-move filter, a few milliseconds at a time ────────────────────────

/** A chain position's identity for the verdicts: the seed and the steps' moves and values. */
const positionKey = (chain: Chain, at: number) => `${chain.seed.kind}:${chain.seed.type}|${chain.steps.slice(0, at).map(s => `${s.template}:${s.holes.map(h => (h.kind === 'number' ? h.value : h.code)).join(',')}`).join(';')}`;
const verdictCache = new Map<string, Map<string, Verdict>>();

/**
 * The dull filter's verdicts for the grid at (chain, at): null until the first pages are in (they
 * go first, and are shown as soon as they're done), then all of them. The work is cut into slices
 * of SLICE_MS and cached per position.
 */
function useVerdicts(cat: Catalogue | null, chain: Chain, at: number, groups: NextMoves | null): Map<string, Verdict> | null {
  const key = useMemo(() => positionKey(chain, at), [chain, at]);
  const [state, setState] = useState<{ key: string; v: Map<string, Verdict> } | null>(() => (verdictCache.has(key) ? { key, v: verdictCache.get(key)! } : null));
  useEffect(() => {
    if (!cat || !groups) return;
    const have = verdictCache.get(key);
    if (have) { setState({ key, v: have }); return; }
    const all = [groups.same, groups.changing, groups.recipes];
    const firstN = all.reduce((n, t) => n + Math.min(FIRST, t.length), 0);
    const order = [...all.flatMap(t => t.slice(0, FIRST)), ...all.flatMap(t => t.slice(FIRST))];
    let published = false;
    const v = new Map<string, Verdict>();
    let i = 0, slices = 0, maxSlice = 0, work = 0;
    const start = performance.now();
    let samples: ReturnType<typeof chainSamples> | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const run = () => {
      const t0 = performance.now();
      samples ??= chainSamples(chain, at);
      while (i < order.length && performance.now() - t0 < SLICE_MS) {
        const t = order[i++];
        v.set(t.key, judgeSteps(samples, tileSteps(t, cat)));
      }
      const dt = performance.now() - t0;
      slices++; work += dt; maxSlice = Math.max(maxSlice, dt);
      // The first pages are in (well before the pictures' debounce): show them sorted now.
      if (!published && i >= firstN && i < order.length) {
        published = true;
        perf({ firstMs: performance.now() - start });
        setState({ key, v: new Map(v) });
      }
      if (i < order.length) { timer = setTimeout(run, 0); return; }
      if (verdictCache.size > 40) verdictCache.delete(verdictCache.keys().next().value!);
      verdictCache.set(key, v);
      perf({ tiles: order.length, judgeMs: work, slices, maxSliceMs: maxSlice, wallMs: performance.now() - start });
      setState({ key, v });
    };
    timer = setTimeout(run, 0);
    return () => { if (timer) clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` and `groups` cover the chain position
  }, [key, groups, cat]);
  return state && state.key === key ? state.v : null;
}

/** Open where a move was found (the graph at its node and line, or the file): the Code explorer's jump. */
function openSource(ref: SourceRef) {
  void import('../../codeExplorer/jumpRun').then(m => m.jumpToSource(sourceProvenance(ref)));
  useExprBuilder.getState().close();
}

const TABS: BuilderSectionTab[] = [
  { id: 'moves', label: 'Next moves', icon: 'grid', how: 'Each tile is your expression with that move applied. Hover to see it big, open its sliders to tune it, click to make it the next step.' },
  { id: 'seed', label: 'Seed', icon: 'spark', how: 'What the expression starts from: UV, a world position, time, or a variable of a type. Changing it starts a new chain.' },
  { id: 'code', label: 'Code', icon: 'code', how: 'The Expression Block Add to graph makes: a line per step with a note, and a slider per number.' },
];

// ── Pictures ──────────────────────────────────────────────────────────────────

/** A rendered field painted into a canvas: grey over its range (float), RG (vec2), colour (vec3). */
function FieldPicture({ field, type, size, label }: { field: RowField; type: string; size: number; label: string }) {
  const tk = useTokens();
  const ref = useRef<HTMLCanvasElement>(null);
  const sum = useMemo(() => fieldSummary(field, type), [field, type]);
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext?.('2d');
    if (!c || !ctx) return;
    c.width = field.w; c.height = field.h;
    const img = ctx.createImageData(field.w, field.h);
    img.data.set(fieldPixels(field, type, sum.range));
    ctx.putImageData(img, 0, 0);
  }, [field, type, sum.range]);
  const range = sum.range && !sum.flat ? `${showValue(sum.range[0])} … ${showValue(sum.range[1])}` : sum.value !== null ? `= ${showValue(sum.value)}` : '';
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
      <canvas ref={ref} data-xb-canvas="" aria-label={`${label}${range ? `: ${range}` : ''}`} title={range ? `${type === 'float' ? 'Grey over ' : type === 'vec2' ? 'x red, y green over ' : ''}${range}` : undefined}
        style={{ width: size, height: field.h === 1 ? Math.max(10, size / 6) : size, borderRadius: 5, imageRendering: field.h === 1 ? 'pixelated' : 'auto', border: `1px solid ${tk.border.subtle}`, display: 'block' }} />
      {size >= 120 && range && <span data-xb-range="" style={{ font: `500 10.5px ${fontFamily.mono}`, color: tk.text.faint }}>{range}</span>}
    </span>
  );
}

function CpuPictureView({ pic, size }: { pic: CpuPicture; size: number }) {
  if (pic.kind === 'plot') return <span data-xb-plot="" style={{ display: 'inline-flex' }}><TransferPlotView plot={pic.plot} resultName="The value" /></span>;
  return <FieldPicture field={pic.field} type={pic.type} size={size} label="Along time" />;
}

function PicturePlaceholder({ size, text }: { size: number; text?: string }) {
  const tk = useTokens();
  return (
    <span data-xb-picture="pending" title={text} style={{ width: size, height: size, borderRadius: 5, background: tk.bg.field, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: tk.text.faint, font: `500 10px ${fontFamily.ui}`, textAlign: 'center', padding: 4, boxSizing: 'border-box' }}>
      {text}
    </span>
  );
}

/** Whether the element is on screen and the page shows (true where IntersectionObserver isn't there). */
function useOnScreen(ref: React.RefObject<HTMLElement | null>): boolean {
  const [inView, setInView] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(es => setInView(es.some(e => e.isIntersecting)));
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  return inView;
}

interface Want { key: string; expr: string; type: GlslType }

/**
 * Renders of `rows` (expressions after the chain's first `upTo` steps): debounced, only while
 * `enabled`; a batch that fails is retried row by row, so one move that doesn't compile here
 * doesn't blank its neighbours (it is reported in `broken`).
 */
function useRenders(chain: Chain, upTo: number, rows: Want[], enabled: boolean, size?: number): { fields: Map<string, RowField>; broken: Set<string>; done: boolean } {
  const [state, setState] = useState<{ key: string; fields: Map<string, RowField>; broken: Set<string> } | null>(null);
  const drawable = useMemo(() => rows.filter(r => DRAWABLE.has(r.type)), [rows]);
  const key = useMemo(() => `${size ?? ''}|${JSON.stringify(chainBlockParams(chain, upTo))}|${JSON.stringify(chain.seed)}|${drawable.map(r => `${r.key}=${r.type}:${r.expr}`).join(';')}`, [chain, upTo, drawable, size]);
  useEffect(() => {
    if (!enabled || !drawable.length || chain.seed.kind === 'time') return;
    let live = true;
    const t = setTimeout(async () => {
      let fields = await renderChainRows(chain, upTo, drawable, size);
      const broken = new Set<string>();
      if (!fields && drawable.length > 1) {
        fields = new Map();
        for (const r of drawable) {
          if (!live) return;
          const one = await renderChainRows(chain, upTo, [r], size);
          const f = one?.get(r.key);
          if (f) fields.set(r.key, f); else broken.add(r.key);
        }
      } else if (!fields) drawable.forEach(r => broken.add(r.key));
      if (live) setState({ key, fields: fields ?? new Map(), broken });
    }, DEBOUNCE_MS);
    return () => { live = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` covers the chain, the rows and the size
  }, [key, enabled]);
  const current = state && state.key === key ? state : null;
  return { fields: current?.fields ?? new Map(), broken: current?.broken ?? new Set(), done: !!current };
}

// ── Sliders ───────────────────────────────────────────────────────────────────

/** A move's number holes as sliders (typing past the end widens the range; no min/max fields). */
function HoleSliders({ holes, onChange, prefix }: { holes: StepHole[]; onChange: (name: string, v: number) => void; prefix: string }) {
  const tk = useTokens();
  const nums = holes.filter((h): h is Extract<StepHole, { kind: 'number' }> => h.kind === 'number');
  if (!nums.length) return <BuilderNote>No numbers to tune in this move.</BuilderNote>;
  return (
    <div data-xb-sliders={prefix} style={{ display: 'flex', flexDirection: 'column', gap: 6 }} onClick={e => e.stopPropagation()}>
      {nums.map(h => (
        <label key={h.name} style={{ display: 'grid', gridTemplateColumns: '34px minmax(0, 1fr)', alignItems: 'center', gap: 6 }}>
          <code title={h.label ? `In the code it came from: ${h.label}` : undefined} style={{ font: `600 11px ${fontFamily.mono}`, color: tk.text.muted }}>{h.name.replace(/^[#$]/, '')}</code>
          <RulerSlider value={h.value} min={h.min} max={h.max} step={h.int ? 1 : 0.01} integer={h.int} ariaLabel={`${prefix} ${h.name}`} onChange={v => onChange(h.name, v)} />
        </label>
      ))}
    </div>
  );
}

// ── The chain (left) ──────────────────────────────────────────────────────────

function ChainPanel({ cat, onExample }: { cat: Catalogue | null; onExample: (ex: HelpExample) => void }) {
  const tk = useTokens();
  const chain = useExprBuilder(s => s.chain);
  const at = useExprBuilder(s => s.at);
  const openStep = useExprBuilder(s => s.openStep);
  const listRef = useRef<HTMLOListElement>(null);
  const onScreen = useOnScreen(listRef);
  const rows = useMemo<Want[]>(() => [
    { key: 'seed', expr: chain.seed.name, type: chain.seed.type },
    ...chain.steps.map((s, i) => ({ key: `s${i}`, expr: localName(i), type: s.sig.out })),
  ], [chain]);
  const r = useRenders(chain, chain.steps.length, rows, onScreen && !!cat);
  const names = useMemo(() => chainNames(chain), [chain]);
  const time = chain.seed.kind === 'time';
  const pic = (key: string, i: number, type: string) => {
    if (time) { const p = timePicture(chain, i); return p ? (p.kind === 'plot' ? <MiniPlot pic={p} /> : <CpuPictureView pic={p} size={40} />) : <PicturePlaceholder size={40} />; }
    const f = r.fields.get(key);
    return f ? <FieldPicture field={f} type={type} size={40} label={key} /> : <PicturePlaceholder size={40} text={r.broken.has(key) ? '!' : undefined} />;
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 12 }}>
      <BuilderLabel meta={`${at} of ${chain.steps.length} step${chain.steps.length === 1 ? '' : 's'}`} hint="Click a row to go back to it. The rows after it stay until you pick a different move.">Chain</BuilderLabel>
      <BuilderHelp id="chain" onExample={onExample} />
      <ol ref={listRef} data-xb-chain="" style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 2 }}>
        <li>
          <ChainRow index={0} on={at === 0} ahead={false} badge="in" title={chain.seed.label} code={`${chain.seed.name}`} type={chain.seed.type} picture={pic('seed', 0, chain.seed.type)} />
        </li>
        {chain.steps.map((s, i) => (
          <li key={i}>
            <ChainRow index={i + 1} on={at === i + 1} ahead={i >= at} badge={String(i + 1)} title={s.label} step={s} name={names[i]?.name}
              code={`${localName(i)} = ${inlineSteps([s], i ? localName(i - 1) : chain.seed.name).expr}`} type={s.sig.out} picture={pic(`s${i}`, i + 1, s.sig.out)}
              tuning={openStep === i} />
            {openStep === i && (
              <div style={{ padding: '4px 8px 8px 36px' }}>
                <HoleSliders prefix={`Step ${i + 1}`} holes={s.holes} onChange={(name, v) => useExprBuilder.getState().setHole(i, name, v)} />
              </div>
            )}
          </li>
        ))}
      </ol>
      {at < chain.steps.length && <BuilderNote>Dimmed rows are kept: pick the same move to walk forward onto them, or another to replace them.</BuilderNote>}
      <span style={{ color: tk.text.faint, fontSize: 11 }}>{chainTitle(chain, at)}</span>
    </div>
  );
}

function MiniPlot({ pic, size = 40 }: { pic: Extract<CpuPicture, { kind: 'plot' }>; size?: number }) {
  const tk = useTokens();
  const { plot } = pic;
  const W = size, H = size;
  const d = plot.points.map(([x, y], i) => `${i ? 'L' : 'M'}${((x - plot.from) / (plot.to - plot.from) * W).toFixed(1)},${((1 - (y - plot.yMin) / (plot.yMax - plot.yMin)) * H).toFixed(1)}`).join('');
  return <svg data-xb-plot="mini" width={W} height={H} style={{ background: tk.bg.field, borderRadius: 5, flexShrink: 0 }}><path d={d} fill="none" stroke={tk.accent.base} strokeWidth={1.5} /></svg>;
}

function ChainRow({ index, on, ahead, badge, title, code, type, picture, step, tuning, name }: {
  index: number; on: boolean; ahead: boolean; badge: string; title: string; code: string; type: string; picture: ReactNode; step?: ChainStep; tuning?: boolean; name?: string;
}) {
  const tk = useTokens();
  const tunable = !!step?.holes.some(h => h.kind === 'number');
  return (
    <div role="button" tabIndex={0} data-xb-step={index} data-ahead={ahead ? '' : undefined} aria-current={on ? 'step' : undefined}
      onClick={() => useExprBuilder.getState().goTo(index)}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); useExprBuilder.getState().goTo(index); } }}
      title={ahead ? 'Kept: click to walk forward to here' : on ? 'Where the chain is now' : 'Go back to here (the steps after it are kept)'}
      style={{
        display: 'grid', gridTemplateColumns: '24px minmax(0, 1fr) auto', gap: 8, alignItems: 'center', padding: '5px 6px', borderRadius: radius.sm, cursor: 'pointer',
        background: on ? alpha(tk.accent.base, 0.14) : 'none', boxShadow: on ? `inset 2px 0 0 ${tk.accent.base}` : 'none', opacity: ahead ? 0.45 : 1,
      }}>
      <span style={{
        justifySelf: 'start', minWidth: 18, height: 18, padding: '0 4px', boxSizing: 'border-box', borderRadius: 5, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: on ? tk.accent.base : tk.bg.field, color: on ? '#fff' : tk.text.muted, font: `650 10.5px ${fontFamily.mono}`,
      }}>{badge}</span>
      <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <b style={{ font: `600 12px ${fontFamily.ui}`, color: tk.text.primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: name ? 0 : 1 }}>{title}</b>
          <span style={{ font: `500 10px ${fontFamily.mono}`, color: tk.text.faint }}>{type}</span>
          {name && (
            <span data-xb-name="" title={`With this step the chain is a ${name}`}
              style={{ font: `600 10px ${fontFamily.ui}`, color: tk.accent.text, background: alpha(tk.accent.base, 0.14), borderRadius: 5, padding: '1px 6px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{name}</span>
          )}
          {tunable && (
            <button type="button" data-xb-tune-step={index - 1} aria-pressed={!!tuning} title={tuning ? 'Hide its sliders' : 'Tune its numbers'}
              onClick={e => { e.stopPropagation(); useExprBuilder.getState().setOpenStep(tuning ? null : index - 1); }}
              style={{ marginLeft: 'auto', border: 0, background: 'none', cursor: 'pointer', color: tuning ? tk.accent.text : tk.text.faint, padding: 2, display: 'inline-flex' }}>
              <Icon name="sliders" size={13} />
            </button>
          )}
        </span>
        <code style={{ font: `500 11px ${fontFamily.mono}`, color: tk.text.secondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{code}</code>
      </span>
      {picture}
    </div>
  );
}

// ── The grid (middle) ─────────────────────────────────────────────────────────

function readFold(id: string, fallback: boolean): boolean {
  try { const v = localStorage.getItem(`xb:fold:${id}`); return v === null ? fallback : v === '1'; } catch { return fallback; }
}
function writeFold(id: string, open: boolean) {
  try { localStorage.setItem(`xb:fold:${id}`, open ? '1' : '0'); } catch { /* kept for this session */ }
}

/** A group of tiles: open by default only for the primary one; folded ones show a summary. */
function MoveSection({ id, title, tiles: ranked, defaultOpen, cat, chain, at, hint, verdicts, onWhere }: {
  id: 'same' | 'changing' | 'recipes'; title: string; tiles: Tile[]; defaultOpen: boolean; cat: Catalogue; chain: Chain; at: number; hint: string;
  verdicts: Map<string, Verdict> | null; onWhere: (tile: Tile) => void;
}) {
  const tk = useTokens();
  const [open, setOpen] = useState(() => readFold(id, defaultOpen));
  const { shown: tiles, hidden } = useMemo(() => applyVerdicts(ranked, verdicts), [ranked, verdicts]);
  const showHidden = useExprBuilder(s => !!s.showHidden[id]);
  // How many tiles show: a page more per click, back to one page when the list changes.
  const [more, setMore] = useState<{ of: Tile[]; n: number }>({ of: tiles, n: PAGE });
  const limit = more.of === tiles ? more.n : PAGE;
  const shown = tiles.slice(0, limit);
  const summary = tiles.length ? `${tiles.length} move${tiles.length === 1 ? '' : 's'}: ${[...new Set(tiles.slice(0, 8).map(t => (id === 'recipes' ? t.template : t.label)))].slice(0, 4).join(', ')}${tiles.length > 4 ? '…' : ''}` : 'none for this type';
  const toggle = () => setOpen(o => { writeFold(id, !o); return !o; });
  return (
    <section data-xb-section={id} data-open={open ? '' : undefined} style={{ borderTop: `1px solid ${tk.border.subtle}`, paddingTop: 8 }}>
      <button type="button" aria-expanded={open} onClick={toggle} title={hint}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, border: 0, background: 'transparent', padding: '4px 0', cursor: 'pointer', color: tk.text.primary, textAlign: 'left' }}>
        <Icon name={open ? 'chevD' : 'chevR'} size={14} style={{ color: tk.text.faint }} />
        <b style={{ font: `600 13px ${fontFamily.ui}` }}>{title}</b>
        <span style={{ font: `500 11.5px ${fontFamily.ui}`, color: tk.text.faint }}>{tiles.length}</span>
        {!open && <span data-xb-summary="" style={{ marginLeft: 'auto', color: tk.text.muted, fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 420 }}>{summary}</span>}
      </button>
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 0 6px' }}>
          {id !== 'same' && <BuilderHelp id={id} />}
          <TileGrid tiles={shown} cat={cat} chain={chain} at={at} onWhere={onWhere} />
          {(tiles.length > limit || hidden.length > 0) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {tiles.length > limit && (
                <Button size="sm" icon="plus" onClick={() => setMore({ of: tiles, n: limit + PAGE })}>Show {Math.min(PAGE, tiles.length - limit)} more</Button>
              )}
              {hidden.length > 0 && (
                <Button size="sm" variant="ghost" icon={showHidden ? 'eyeOff' : 'eye'} data-xb-show-hidden={id} aria-pressed={showHidden}
                  title="Moves that wouldn't show here: constant, not a number, no change, or too fine to see"
                  onClick={() => useExprBuilder.getState().setShowHidden(id, !showHidden)}>
                  {showHidden ? 'Hide' : 'Show hidden'} ({hidden.length})
                </Button>
              )}
            </div>
          )}
          {showHidden && hidden.length > 0 && <TileGrid tiles={hidden.map(h => h.tile)} reasons={new Map(hidden.map(h => [h.tile.key, h.reason]))} cat={cat} chain={chain} at={at} onWhere={onWhere} />}
        </div>
      )}
    </section>
  );
}

function TileGrid({ tiles, cat, chain, at, onWhere, reasons }: { tiles: Tile[]; cat: Catalogue; chain: Chain; at: number; onWhere: (tile: Tile) => void; reasons?: Map<string, DullReason> }) {
  const ref = useRef<HTMLDivElement>(null);
  const onScreen = useOnScreen(ref);
  const drafts = useExprBuilder(s => s.drafts);
  const end = chainEnd(chain, at);
  const built = useMemo(() => tiles.map(t => {
    const steps = tileSteps(t, cat, drafts[t.key]);
    return { tile: t, steps, ...inlineSteps(steps, end.name) };
  }), [tiles, cat, drafts, end.name]);
  const rows = useMemo<Want[]>(() => built.map(b => ({ key: b.tile.key, expr: b.expr, type: b.type })), [built]);
  const r = useRenders(chain, at, rows, onScreen);
  const time = chain.seed.kind === 'time';
  return (
    <div ref={ref} data-xb-grid={reasons ? 'hidden' : ''} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(156px, 1fr))', gap: 8 }}>
      {built.map(b => {
        const pic = time ? timePicture(chain, at, b.steps) : null;
        const f = r.fields.get(b.tile.key);
        const broken = r.broken.has(b.tile.key);
        const picture = time
          ? (pic ? (pic.kind === 'plot' ? <MiniPlot pic={pic} size={TILE_PX} /> : <CpuPictureView pic={pic} size={TILE_PX} />) : <PicturePlaceholder size={TILE_PX} text="Can't plot this" />)
          : f ? <FieldPicture field={f} type={b.type} size={TILE_PX} label={b.tile.label} />
            : <PicturePlaceholder size={TILE_PX} text={broken ? 'Doesn\'t compile here' : DRAWABLE.has(b.type) ? undefined : b.type} />;
        return <TileView key={b.tile.key} tile={b.tile} steps={b.steps} picture={picture} broken={broken} reason={reasons?.get(b.tile.key)} onWhere={onWhere} />;
      })}
    </div>
  );
}

function TileView({ tile, steps, picture, broken, reason, onWhere }: { tile: Tile; steps: ChainStep[]; picture: ReactNode; broken: boolean; reason?: DullReason; onWhere: (tile: Tile) => void }) {
  const tk = useTokens();
  const expanded = useExprBuilder(s => s.expanded === tile.key);
  const hovered = useExprBuilder(s => s.hover === tile.key);
  const tunable = steps.some(s => s.holes.some(h => h.kind === 'number'));
  const st = () => useExprBuilder.getState();
  const pick = () => { if (!broken) st().pick(steps); };
  return (
    <div data-xb-tile={tile.key} data-kind={tile.kind} data-broken={broken ? '' : undefined} data-dull={reason}
      onMouseEnter={() => st().setHover(tile.key)} onMouseLeave={() => { if (st().hover === tile.key) st().setHover(null); }}
      style={{
        display: 'flex', flexDirection: 'column', gap: 6, padding: 8, borderRadius: radius.md, minWidth: 0, gridColumn: expanded ? 'span 2' : undefined,
        background: hovered ? tk.bg.selected : tk.bg.field, boxShadow: `inset 0 0 0 1px ${hovered ? tk.border.default : 'transparent'}`, opacity: broken ? 0.55 : 1,
      }}>
      <button type="button" data-xb-pick={tile.key} disabled={broken} onClick={pick} onFocus={() => st().setHover(tile.key)}
        title={broken ? 'This move doesn\'t compile on this expression' : `Make this the next step: ${tile.template}`}
        style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'stretch', border: 0, padding: 0, background: 'none', cursor: broken ? 'not-allowed' : 'pointer', textAlign: 'left', color: tk.text.primary, minWidth: 0 }}>
        <span style={{ display: 'flex', justifyContent: 'center' }}>{picture}</span>
        <span style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
          <b style={{ font: `600 12px ${fontFamily.ui}`, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {tile.kind === 'recipe' && <Icon name="presets" size={11} style={{ color: tk.text.faint }} />}
            {tile.kind === 'recipe' ? `${tile.moves.length} steps` : tile.label}
          </b>
          <span style={{ marginLeft: 'auto', font: `500 10px ${fontFamily.mono}`, color: tk.text.faint, whiteSpace: 'nowrap' }}>→ {tile.outType}{tile.count ? ` · ${tile.count}×` : ''}</span>
        </span>
        <code style={{ font: `500 11px ${fontFamily.mono}`, color: tk.text.secondary, wordBreak: 'break-word' }}>{tile.template}</code>
      </button>
      {reason && <span data-xb-reason={reason} style={{ fontSize: 10.5, color: tk.text.faint, fontStyle: 'italic' }}>Hidden: {DULL_WORDS[reason]}</span>}
      <SourceLinks tile={tile} onWhere={onWhere} />
      {tunable && (
        <button type="button" data-xb-tune={tile.key} aria-expanded={expanded} onClick={() => st().setExpanded(expanded ? null : tile.key)}
          style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 4, border: 0, background: 'none', padding: 0, cursor: 'pointer', color: tk.accent.text, font: `500 11px ${fontFamily.ui}` }}>
          <Icon name="sliders" size={11} />{expanded ? 'Hide sliders' : 'Tune'}
        </button>
      )}
      {expanded && steps.map((s, i) => (
        <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {steps.length > 1 && <span style={{ font: `500 10.5px ${fontFamily.mono}`, color: tk.text.faint }}>{s.template}</span>}
          <HoleSliders prefix={`${tile.label} ${i + 1}`} holes={s.holes} onChange={(name, v) => st().setDraft(tile.key, `${i}:${name}`, v)} />
        </div>
      ))}
    </div>
  );
}

/** "used in: A, B, C": each opens where it is written; "Where else?" finds every use of the move's shape. */
function SourceLinks({ tile, onWhere, size = 10.5 }: { tile: Tile; onWhere: (tile: Tile) => void; size?: number }) {
  const tk = useTokens();
  const link = { border: 0, background: 'none', padding: 0, cursor: 'pointer', color: tk.accent.text, font: `500 ${size}px ${fontFamily.ui}`, textDecoration: 'underline', textDecorationColor: alpha(tk.accent.base, 0.35), textUnderlineOffset: 2 } as const;
  return (
    <span data-xb-sources="" style={{ fontSize: size, color: tk.text.muted, lineHeight: 1.45 }}>
      {tile.sourceRefs.length ? (
        <>used in:{' '}
          {tile.sourceRefs.map((r, i) => (
            <span key={i}>
              <button type="button" data-xb-source={r.docId} title={`Open where it is written: ${r.label}${r.line ? `, line ${r.line}` : ''}`} style={link}
                onClick={e => { e.stopPropagation(); openSource(r); }}>{r.label}</button>{i < tile.sourceRefs.length - 1 ? ', ' : ' · '}
            </span>
          ))}
        </>
      ) : <>made by type · </>}
      <button type="button" data-xb-where={tile.key} title={`Where else is ${tile.template} used?`} style={link} onClick={e => { e.stopPropagation(); onWhere(tile); }}>Where else?</button>
    </span>
  );
}

function MovesTab({ cat, onExample }: { cat: Catalogue | null; onExample: (ex: HelpExample) => void }) {
  const chain = useExprBuilder(s => s.chain);
  const at = useExprBuilder(s => s.at);
  const groups: NextMoves | null = useMemo(() => (cat ? groupsFor(cat, chain, at) : null), [cat, chain, at]);
  const verdicts = useVerdicts(cat, chain, at, groups);
  const [where, setWhere] = useState<Tile | null>(null);
  const end = chainEnd(chain, at);
  if (!cat || !groups) return <BuilderNote style={{ padding: 6 }}>Reading the moves from the examples and your code…</BuilderNote>;
  const sections = { cat, chain, at, verdicts, onWhere: setWhere };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {at === 0 && !chain.steps.length ? <EmptyHelp id="empty-chain" onExample={onExample} /> : <BuilderHelp id="moves" />}
      <BuilderLabel meta={<span>for a <code>{end.type}</code>{end.role !== 'unknown' ? ` (${end.role})` : ''}{groups.name ? <> · now a <b data-xb-current-name="">{groups.name.name}</b></> : null}</span>}
        hint="Ranked by what usually comes next in the examples and your code, in a context like this one. Moves that wouldn't show here are hidden (Show hidden).">Next moves</BuilderLabel>
      <MoveSection id="same" title="Same type" tiles={groups.same} defaultOpen hint={`Moves that keep it a ${end.type}`} {...sections} />
      <MoveSection id="changing" title="Changes the type" tiles={groups.changing} defaultOpen={false} hint="x.x, length(x), a colour from space…" {...sections} />
      <MoveSection id="recipes" title="Recipes" tiles={groups.recipes} defaultOpen={false} hint="Moves seen together, replayed as steps" {...sections} />
      {where && <FindUsesDialog query={{ pattern: templatePattern(where.template) }} title={where.template} onClose={() => setWhere(null)} onJumped={() => useExprBuilder.getState().close()} />}
    </div>
  );
}

// ── Seed and Code tabs ────────────────────────────────────────────────────────

function SeedTab({ onExample }: { onExample: (ex: HelpExample) => void }) {
  const tk = useTokens();
  const seed = useExprBuilder(s => s.chain.seed);
  const steps = useExprBuilder(s => s.chain.steps.length);
  const [varType, setVarType] = useState<SeedType>(seed.kind === 'variable' ? seed.type : 'float');
  const choose = (s: ExprSeed) => useExprBuilder.getState().setSeed(s);
  const what: Record<string, string> = {
    uv: 'The picture\'s coordinates (vec2, 2D). Wired from a UV node.',
    world: 'A point in a 3D scene (vec3). Drawn here on the z = 0 slice; stays an input to wire (a March Loop\'s position).',
    time: 'Seconds (float, 1D). Drawn as a plot. Wired from a Time node.',
  };
  const card = (s: ExprSeed, on: boolean, extra?: ReactNode) => (
    <div key={s.kind} data-xb-seed={s.kind} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 10, borderRadius: radius.md, background: on ? alpha(tk.accent.base, 0.12) : tk.bg.field, boxShadow: on ? `inset 0 0 0 1px ${tk.accent.base}` : 'none' }}>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
        <b style={{ font: `600 12.5px ${fontFamily.ui}`, color: tk.text.primary }}>{s.kind === 'variable' ? 'A variable' : s.label} <code style={{ font: `500 11px ${fontFamily.mono}`, color: tk.text.faint }}>{s.name} · {s.type}</code></b>
        <span style={{ fontSize: 12, color: tk.text.muted }}>{s.kind === 'variable' ? 'A value of a type you pick, left as an input of the block to wire anything into.' : what[s.kind]}</span>
      </span>
      {extra}
      <Button size="sm" variant={on ? 'secondary' : 'primary'} onClick={() => choose(s)} title={steps ? 'Starts a new chain from this seed' : undefined}>{on ? (steps ? 'Start over' : 'Chosen') : 'Start here'}</Button>
    </div>
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <BuilderHelp id="seed" onExample={onExample} />
      {SEEDS.map(s => card(s, seed.kind === s.kind))}
      {card(variableSeed(varType), seed.kind === 'variable' && seed.type === varType,
        <Select ariaLabel="The variable's type" value={varType} options={(['float', 'vec2', 'vec3'] as const).map(t => ({ value: t, label: t }))} onChange={v => setVarType(v as SeedType)} mono style={{ width: 90 }} />)}
      <BuilderNote>Seeding from a socket (right-click a wire → Build an expression from here) comes later; it will carry the socket's context.</BuilderNote>
    </div>
  );
}

function CodeTab() {
  const tk = useTokens();
  const chain = useExprBuilder(s => s.chain);
  const at = useExprBuilder(s => s.at);
  const p = useMemo(() => chainBlockParams(chain, at), [chain, at]);
  const text = [
    `// inputs: ${p.inputs.map(i => `${i.type} ${i.name}${i.slider ? ` (slider ${showValue(p.values[i.name])})` : ''}`).join(', ')}`,
    ...p.lines.map(l => `${l.lhs} ${l.op} ${l.rhs};`),
    `return ${p.result}; // ${p.outputType}`,
  ].join('\n');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <BuilderHelp id="code" />
      <BuilderHelp id="output" />
      <pre data-xb-code="" style={{ margin: 0, padding: 12, borderRadius: radius.md, background: tk.bg.field, color: tk.text.secondary, font: `500 12px/1.55 ${fontFamily.mono}`, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{text}</pre>
    </div>
  );
}

// ── The preview (right) ───────────────────────────────────────────────────────

function PreviewPanel({ cat }: { cat: Catalogue | null }) {
  const tk = useTokens();
  const chain = useExprBuilder(s => s.chain);
  const at = useExprBuilder(s => s.at);
  const hover = useExprBuilder(s => s.hover);
  const drafts = useExprBuilder(s => s.drafts);
  const groups = useMemo(() => (cat ? groupsFor(cat, chain, at) : null), [cat, chain, at]);
  const tile = hover && groups ? [...groups.same, ...groups.changing, ...groups.recipes].find(t => t.key === hover) ?? null : null;
  const hoverReason = tile ? verdictCache.get(positionKey(chain, at))?.get(tile.key)?.dull ?? null : null;
  const end = chainEnd(chain, at);
  const steps = useMemo(() => (tile && cat ? tileSteps(tile, cat, drafts[tile.key]) : []), [tile, cat, drafts]);
  const shown = tile ? inlineSteps(steps, end.name) : { expr: end.name, type: end.type };
  const rows = useMemo<Want[]>(() => [{ key: 'big', expr: shown.expr, type: shown.type }], [shown.expr, shown.type]);
  const r = useRenders(chain, at, rows, !!cat, 192);
  const time = chain.seed.kind === 'time';
  const f = r.fields.get('big');
  const SIZE = 236;
  const pic = time ? timePicture(chain, at, steps) : null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 12 }}>
      <BuilderLabel meta={tile ? 'hovered move' : 'the chain'}>Preview</BuilderLabel>
      <div data-xb-preview={tile ? tile.key : 'chain'} style={{ display: 'flex', justifyContent: 'center', minHeight: SIZE }}>
        {time ? (pic ? (pic.kind === 'plot' ? <TransferPlotView plot={pic.plot} resultName="The value" /> : <CpuPictureView pic={pic} size={SIZE} />) : <PicturePlaceholder size={SIZE} text="Can't plot this" />)
          : f ? <FieldPicture field={f} type={shown.type} size={SIZE} label="Preview" />
            : <PicturePlaceholder size={SIZE} text={r.broken.has('big') ? 'Doesn\'t compile here' : r.done ? 'No picture' : 'Drawing…'} />}
      </div>
      <code style={{ font: `500 11.5px ${fontFamily.mono}`, color: tk.text.secondary, wordBreak: 'break-word' }}>{tile ? `${tile.template}  → ${shown.type}` : `${end.name} : ${end.type}`}</code>
      {tile && <span style={{ fontSize: 11.5, color: tk.text.muted }}>{tile.sources.length ? `Used in: ${tile.sources.join(', ')}` : 'Made by type, not mined.'}</span>}
      {tile && hoverReason && <span data-xb-preview-reason="" style={{ fontSize: 11.5, color: tk.text.faint, fontStyle: 'italic' }}>Hidden from the grid: {DULL_WORDS[hoverReason]}.</span>}
      <BuilderHelp id="preview" />
      <BuilderHelp id="holes" />
    </div>
  );
}

// ── The window ────────────────────────────────────────────────────────────────

export function ExpressionBuilderModal() {
  const tk = useTokens();
  const tab = useExprBuilder(s => s.tab);
  const at = useExprBuilder(s => s.at);
  const chain = useExprBuilder(s => s.chain);
  const [cat, setCat] = useState<Catalogue | null>(null);
  useEffect(() => {
    let live = true;
    void builderCatalogue().then(c => { if (live) setCat(c); });
    return () => { live = false; };
  }, []);
  const close = () => useExprBuilder.getState().close();
  const onExample = (ex: HelpExample) => {
    if (!cat || !('chain' in ex.insert)) return;
    const seed = ex.insert.chain.seed === 'world' ? WORLD_SEED : ex.insert.chain.seed === 'time' ? TIME_SEED : UV_SEED;
    useExprBuilder.getState().load({ seed, steps: resolveTemplateSteps(ex.insert.chain.steps, seed, cat) });
    useExprBuilder.getState().setTab('moves');
  };
  const end = chainEnd(chain, at);
  const canUndo = useExprBuilder(s => s.undoStack.length > 0);
  const surprise = () => {
    if (!cat) return;
    const st = useExprBuilder.getState();
    const steps = surpriseSteps(st.chain, cat, { seed: st.surpriseSeed, at: st.at });
    if (steps.length) { st.surprise(steps); st.setTab('moves'); }
  };
  return (
    <BuilderWindow
      prefsKey="expr-builder"
      title="Expression Builder"
      subtitle={`${chainTitle(chain, at)} · ${end.type}`}
      icon="expr"
      iconColor={tk.kind.expr}
      onClose={close}
      width={1280}
      tabs={{ items: TABS, value: tab, onChange: id => useExprBuilder.getState().setTab(id as ExprTab), ariaLabel: 'Expression Builder sections' }}
      left={{ label: 'Chain', icon: 'layers', width: 320, content: <ChainPanel cat={cat} onExample={onExample} /> }}
      right={{ label: 'Preview', icon: 'eye', width: 300, content: <PreviewPanel cat={cat} /> }}
      footer={<>
        <Button icon="reset" disabled={!chain.steps.length} onClick={() => useExprBuilder.getState().setSeed(chain.seed)} title="Clear the steps and start again from the seed">Start over</Button>
        <Button icon="undo" data-xb-undo="" disabled={!canUndo} onClick={() => useExprBuilder.getState().undo()} title="Put the chain back as it was before the last pick, Surprise me or new seed">Undo</Button>
        <Button icon="dice" data-xb-surprise="" disabled={!cat} onClick={surprise} title="Add 2–5 random moves, drawn from what usually comes next (and never dull ones). Undo takes them back; each step stays editable.">Surprise me</Button>
        <BuilderNote>Add to graph makes an Expression Block: a line per step with a note, a slider per number.</BuilderNote>
        <span style={{ flex: 1 }} />
        <Button onClick={close}>Done</Button>
        <Button variant="primary" icon="plus" data-xb-add="" disabled={!at} onClick={() => { if (addBuilderChainToGraph()) close(); }}>Add to graph</Button>
      </>}
    >
      <div style={{ padding: '14px 16px' }}>
        {tab === 'moves' && <MovesTab cat={cat} onExample={onExample} />}
        {tab === 'seed' && <SeedTab onExample={onExample} />}
        {tab === 'code' && <CodeTab />}
      </div>
    </BuilderWindow>
  );
}
