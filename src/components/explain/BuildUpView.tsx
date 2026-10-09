/**
 * The build-up view (docs/expression-explainer.md, "Build-up"): a line as GLSL builds it, one row
 * per input it reads, one per step, then the result. Each row has its label, its code (earlier
 * steps as letters), a small picture and its range:
 *
 *  - the same everywhere: a swatch (vec3 / vec4) or a number;
 *  - varies across the screen: a small render (grey for a float over its range, RG for a vec2,
 *    the colour for a vec3), or a 1D strip along the screen's middle when a render per row would
 *    cost too much (lib/glslPatterns/buildUp.pictureBudget).
 *
 * Step-through: click a row, or ←/→ while the list has focus, to show it on the big ▶ preview
 * and light its span in the code; Escape (or clicking it again) goes back to the whole line.
 *
 * Pictures are rendered once per change of the block (debounced, cached by shader + inputs in
 * buildUpHost.ts), only while the view is open and on screen. No store subscriptions here.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { cpuStrip, cpuValue, pictureBudget, pictureKind, showValue, STRIP_SAMPLES, type BuildUpRow, type PictureKind, type UseQuery, type Value, type WorkedVar } from '../../lib/glslPatterns';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Icon } from '../ui/Icon';
import { GlslCode } from './GlslCode';
import type { BuildUpHost, PictureShape, RowField } from './buildUpHost';
import { fieldPixels, fieldSummary, stripField, swatchCss } from './rowPicture';

/** Wait this long after a change before rendering (typing a line re-renders once it settles). */
const DEBOUNCE_MS = 250;

export interface BuildUpViewProps {
  rows: BuildUpRow[];
  /** The sample inputs (worked.ts) the CPU pictures and numbers use. */
  vars: WorkedVar[];
  /** Each row's usual range from the sample inputs (worked.ts), by row key; shown until a render measures it. */
  ranges: Map<string, [number, number] | null>;
  host?: BuildUpHost;
  /** The row whose span is lit (hovered); the selected one is lit while nothing is hovered. */
  onHoverSpan: (span: { start: number; end: number } | null) => void;
  onHoverVar: (name: string | null) => void;
  activeVar: string | null;
  selected: string | null;
  onSelect: (key: string | null) => void;
  /** Make a node from a step (only steps inside the editable part). */
  canMake: (span: { start: number; end: number }) => boolean;
  onMakeNode?: (span: { start: number; end: number }) => void;
  onFindUses?: (query: UseQuery, title: string) => void;
  idioms: Map<string, { id: string; name: string }>;
  /** Changes when the view should take focus (▶ on the line opened it). */
  focusSignal?: number;
}

// The last focus request (a counter) the view acted on
let focusTaken = 0;

/** A focus request no view has acted on yet (a view opened on its own, like the explain view). */
export const newFocusSignal = () => focusTaken + 1;

/**
 * Whether the element is on screen and the page is showing (true where IntersectionObserver
 * isn't available). A hidden tab or a scrolled-away panel renders nothing until it shows again.
 */
function useOnScreen(ref: React.RefObject<HTMLElement | null>): boolean {
  const [inView, setInView] = useState(true);
  const [pageShown, setPageShown] = useState(() => typeof document === 'undefined' || document.visibilityState !== 'hidden');
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(es => setInView(es.some(e => e.isIntersecting)));
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const on = () => setPageShown(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  return inView && pageShown;
}

export function BuildUpView({ rows, vars, ranges, host, onHoverSpan, onHoverVar, activeVar, selected, onSelect, canMake, onMakeNode, onFindUses, idioms, focusSignal }: BuildUpViewProps) {
  const tk = useTokens();
  const listRef = useRef<HTMLOListElement>(null);
  const onScreen = useOnScreen(listRef);
  const varies = useMemo(() => new Set(rows.flatMap(r => (r.kind === 'input' && r.varies ? [r.label] : []))), [rows]);

  // CPU strips (and constants' sample values): cheap, worked out here for every row
  const cpu = useMemo(() => new Map(rows.map(r => [r.key, {
    strip: r.varies ? cpuStrip(r, vars, n => varies.has(n), STRIP_SAMPLES) : null,
    value: cpuValue(r, vars),
  }])), [rows, vars, varies]);

  // What the host can render, and how: a square per row, or strips when that costs too much
  const plan = useMemo(() => {
    const cost = host?.pictures?.cost() ?? null;
    const budget = pictureBudget(cost);
    const canRender = !!cost;
    const kinds = new Map<string, PictureKind>(rows.map(r => [r.key, pictureKind(r, budget, !!cpu.get(r.key)?.strip, canRender)]));
    return { budget, canRender, kinds };
  }, [host, rows, cpu]);

  // The renders: once per change, debounced, only while on screen
  const [fields, setFields] = useState<{ key: string; map: Map<string, RowField>; shape: PictureShape } | null>(null);
  const want = useMemo(() => {
    if (!plan.canRender) return null;
    // A square per row when it's affordable (constants too: their real value, a slider's or the clock's);
    // otherwise one rendered row for the strips the CPU can't do
    const shape: PictureShape = plan.budget.render ? 'square' : 'strip';
    const list = rows.filter(r => {
      const k = plan.kinds.get(r.key);
      return shape === 'square' ? (k === 'render' || (k === 'constant' && r.type !== 'unknown')) : k === 'strip-render';
    });
    return list.length ? { shape, list, key: `${shape}|${list.map(r => `${r.key}=${r.type}:${r.expr}`).join(';')}` } : null;
  }, [plan, rows]);
  useEffect(() => {
    if (!want || !host?.pictures || !onScreen) return;
    let live = true;
    const t = setTimeout(() => {
      host.pictures!.render(want.list, want.shape).then(map => {
        if (live) setFields(map ? { key: want.key, map, shape: want.shape } : null);
      }, () => { if (live) setFields(null); });
    }, DEBOUNCE_MS);
    return () => { live = false; clearTimeout(t); };
  }, [want, host, onScreen]);

  // ←/→ walk the rows, Escape goes back to the whole line
  const move = (dir: 1 | -1) => {
    const i = rows.findIndex(r => r.key === selected);
    const next = i < 0 ? (dir > 0 ? 0 : rows.length - 1) : Math.max(0, Math.min(rows.length - 1, i + dir));
    onSelect(rows[next].key);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); move(e.key === 'ArrowRight' ? 1 : -1); }
    else if (e.key === 'Escape' && selected) { e.preventDefault(); e.stopPropagation(); onSelect(null); }
  };

  // ▶ on the line opened the view: take focus, ready to step
  useEffect(() => {
    // Once per press: folding and opening the row again later doesn't take focus again
    if (!focusSignal || focusSignal <= focusTaken) return;
    focusTaken = focusSignal;
    const el = listRef.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.scrollIntoView?.({ block: 'nearest' });
  }, [focusSignal]);

  const small: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 3, height: 22, padding: '0 6px', border: 0, borderRadius: radius.sm,
    background: 'none', color: tk.accent.text, cursor: 'pointer', font: `500 11px ${fontFamily.ui}`, flexShrink: 0,
  };
  const liveFields = fields && want && fields.key === want.key ? fields.map : null;

  return (
    <ol ref={listRef} data-buildup="" role="listbox" aria-label="Build-up: the line, step by step. ← → to step, Escape for the whole line" tabIndex={0}
      aria-activedescendant={selected ? `buildup-${selected}` : undefined}
      // While a row is selected, Escape is ours (back to the whole line), not the modal's close
      data-captures-escape={selected ? '' : undefined}
      onKeyDown={onKeyDown} onMouseLeave={() => { onHoverSpan(null); onHoverVar(null); }}
      style={{ margin: 0, padding: 2, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 2, outline: 'none', borderRadius: radius.md }}>
      {rows.map(r => {
        const on = selected === r.key;
        const lit = on || (r.kind === 'input' && activeVar === r.label);
        const idiom = r.kind === 'step' ? idioms.get(r.label) : undefined;
        const kind = plan.kinds.get(r.key) ?? 'none';
        return (
          <li key={r.key} id={`buildup-${r.key}`} role="option" aria-selected={on} data-buildup-row={r.key} data-buildup-kind={r.kind} data-picture={kind}
            onClick={() => onSelect(on ? null : r.key)}
            onMouseEnter={() => { onHoverSpan({ start: r.start, end: r.end }); onHoverVar(r.kind === 'input' ? r.label : null); }}
            style={{
              display: 'grid', gridTemplateColumns: '28px minmax(0, 1fr) auto', gap: 8, alignItems: 'center', padding: '4px 6px', borderRadius: radius.sm, cursor: 'pointer',
              background: on ? alpha(tk.accent.base, 0.14) : lit ? alpha(tk.accent.base, 0.06) : 'none',
              boxShadow: on ? `inset 2px 0 0 ${tk.accent.base}` : 'none',
            }}>
            <span title={r.kind === 'input' ? 'An input the line reads' : r.kind === 'result' ? 'The result: what the line sets' : `Step ${r.label}`}
              style={{
                justifySelf: 'start', minWidth: 18, maxWidth: 28, height: 18, padding: '0 4px', boxSizing: 'border-box', overflow: 'hidden', textOverflow: 'ellipsis', borderRadius: 5,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', whiteSpace: 'nowrap',
                background: on ? tk.accent.base : r.kind === 'result' ? alpha(tk.status.success, 0.16) : tk.bg.field,
                color: on ? '#fff' : r.kind === 'input' ? tk.text.secondary : tk.text.muted, font: `650 10.5px ${fontFamily.mono}`,
              }}>{r.kind === 'step' ? r.label : r.kind === 'input' ? 'in' : '='}</span>
            <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span data-buildup-code="" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', font: `500 11.5px ${fontFamily.mono}` }}>
                {r.kind === 'result' && <span style={{ color: tk.text.secondary }}>{r.label} = </span>}
                {r.kind === 'step' && <span style={{ color: tk.text.faint }}>{r.label} = </span>}
                <GlslCode code={r.code} />
                {r.type !== 'unknown' && <span style={{ marginLeft: 6, color: tk.text.faint, font: `500 10px ${fontFamily.mono}` }}>{r.type}</span>}
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', minHeight: 0 }}>
                {idiom && (
                  <span title="A well-known shader idiom" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '0 6px', borderRadius: 9, background: alpha(tk.status.success, 0.12), color: tk.text.secondary, font: `600 10px ${fontFamily.ui}` }}>
                    <Icon name="star" size={9} />{idiom.name}
                  </span>
                )}
                {idiom && onFindUses && (
                  <button type="button" data-explain-action="find-uses" title={`Where else is “${idiom.name}” used?`} style={small}
                    onClick={e => { e.stopPropagation(); onFindUses({ idiomId: idiom.id }, idiom.name); }}>
                    <Icon name="search" size={11} />Where else?
                  </button>
                )}
                {r.kind === 'step' && onMakeNode && canMake(r) && (
                  <button type="button" data-explain-action="make-node" title={`Make a node from ${r.expr}`} style={small}
                    onClick={e => { e.stopPropagation(); onMakeNode({ start: r.start, end: r.end }); }}>
                    <Icon name="plus" size={11} />Node
                  </button>
                )}
              </span>
            </span>
            <RowPicture row={r} kind={kind} field={liveFields?.get(r.key) ?? null} cpu={cpu.get(r.key)!} fallbackRange={ranges.get(r.key) ?? null} />
          </li>
        );
      })}
    </ol>
  );
}

const PIC = 40; // CSS px of a square picture
const STRIP_W = 72, STRIP_H = 12;

/** A row's picture: a render, a strip, a swatch or a number; and its range. */
function RowPicture({ row, kind, field, cpu, fallbackRange }: {
  row: BuildUpRow; kind: PictureKind; field: RowField | null;
  cpu: { strip: Value[] | null; value: Value | null }; fallbackRange: [number, number] | null;
}) {
  const tk = useTokens();
  // The field to draw: the render when there is one, else the CPU strip (also while a render is on its way)
  const shown = useMemo(() => field ?? (cpu.strip ? stripField(cpu.strip) : null), [field, cpu.strip]);
  const sum = useMemo(() => (shown ? fieldSummary(shown, row.type) : null), [shown, row.type]);
  // A render (or strip) that came out flat is a constant after all; one that didn't isn't
  const constant = sum ? sum.flat : kind === 'constant';
  const value = sum?.flat ? sum.value : cpu.value;
  const range = sum && !sum.flat ? sum.range : fallbackRange;
  const isColour = row.type === 'vec3' || row.type === 'vec4';
  const box: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end', minWidth: 0 };
  const rangeText = range && !constant ? `${showValue(range[0])} … ${showValue(range[1])}` : null;
  const measured = !!field;
  const tip = (what: string) => `${what}${rangeText ? `. ${measured ? 'Across the picture' : 'Usually'} it runs ${rangeText}${row.type === 'float' ? ' (black … white)' : row.type === 'vec2' ? ' (x red, y green)' : ''}.` : '.'}`;

  if (constant) {
    if (value === null) return <span style={box} data-buildup-picture="none" />;
    const fromCpu = !field;
    return (
      <span style={box} data-buildup-picture="constant" title={tip(fromCpu ? 'The same everywhere (worked out with the sample values)' : 'The same everywhere on the picture')}>
        {isColour && <span data-buildup-swatch="" style={{ width: 18, height: 18, borderRadius: 4, background: swatchCss(value), border: `1px solid ${tk.border.subtle}` }} />}
        <span style={{ padding: '0 5px', borderRadius: 4, background: alpha(tk.accent.base, 0.1), color: tk.accent.text, font: `600 10.5px ${fontFamily.mono}`, whiteSpace: 'nowrap' }}>{showValue(value)}</span>
      </span>
    );
  }
  if (!shown) {
    // Waiting for a render, or nothing to draw: keep the place, show the range when known
    return (
      <span style={box} data-buildup-picture={kind === 'none' ? 'none' : 'pending'} title={kind === 'none' ? 'No picture for this one' : tip('Drawing…')}>
        {rangeText && <RangeText text={rangeText} />}
        {kind !== 'none' && <span style={{ width: kind === 'render' ? PIC : STRIP_W, height: kind === 'render' ? PIC : STRIP_H, borderRadius: 4, background: tk.bg.field }} />}
      </span>
    );
  }
  const strip = shown.h === 1;
  return (
    <span style={box} data-buildup-picture={strip ? 'strip' : 'render'}
      title={tip(strip ? 'Along the middle of the screen, left to right' : 'A small render of the whole picture')}>
      {rangeText && <RangeText text={rangeText} />}
      <FieldCanvas field={shown} type={row.type} range={sum?.range ?? null} w={strip ? STRIP_W : PIC} h={strip ? STRIP_H : PIC} />
    </span>
  );
}

function RangeText({ text }: { text: string }) {
  const tk = useTokens();
  return <span data-buildup-range="" style={{ color: tk.text.faint, font: `500 10px ${fontFamily.mono}`, whiteSpace: 'nowrap' }}>{text}</span>;
}

/** A field painted into a small canvas (pixelated: these are a few dozen texels). */
function FieldCanvas({ field, type, range, w, h }: { field: RowField; type: string; range: [number, number] | null; w: number; h: number }) {
  const tk = useTokens();
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext?.('2d');
    if (!c || !ctx) return;
    c.width = field.w; c.height = field.h;
    const img = ctx.createImageData(field.w, field.h);
    img.data.set(fieldPixels(field, type, range));
    ctx.putImageData(img, 0, 0);
  }, [field, type, range]);
  return <canvas ref={ref} data-buildup-canvas="" style={{ width: w, height: h, borderRadius: 4, imageRendering: field.h === 1 ? 'pixelated' : 'auto', border: `1px solid ${tk.border.subtle}`, display: 'block' }} />;
}
