/**
 * The explain view of one Expression Block line (or Return): it replaces the editor's lines in the
 * same modal (Open explain view, under a line), with Back to the lines and ‹ › to the line above or
 * below. Loaded on demand (ExprBlockModal lazy-imports it).
 *
 *  - The line at the top, the selected step's part lit.
 *  - Step by step: the build-up (BuildUpView.tsx): inputs, steps A, B, … and the result. Click a row,
 *    or ← / → on the list, to pick one; Escape goes back to the whole line, and again to the lines.
 *  - The picture beside it: a live render of the selected row (ExplainLiveCanvas.tsx, liveRender.ts),
 *    at a good size and frame rate, the clock running. The main canvas is held meanwhile
 *    (lib/previewHold.ts), so this one gets the GPU; Back or closing gives it back.
 *  - Try values: a control for each name the line reads (an input, a slider, an earlier line's
 *    variable, the clock). Live (the default) keeps the real value; off, the control's value
 *    replaces it in this picture only, and in the CPU numbers of the steps (worked.ts), so they agree.
 *  - Explain with the model: the on-device model's line explanation (ExplainMore, docs/explain-model.md).
 *
 * The saved graph is never touched: the picture is a copy of the block (liveRender.ts).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { GraphNode } from '../../types/nodeGraph';
import { buildUpRows, explainLine, workedSteps, workedVars, showValue, type ExplainContext, type UseQuery, type Value, type WorkedVar } from '../../lib/glslPatterns';
import { holdPreview } from '../../lib/previewHold';
import { nowParamValue } from '../../lib/nowValue';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Icon } from '../ui/Icon';
import { Toggle } from '../ui/Choice';
import { RulerSlider } from '../ui/RulerSlider';
import { ColorSwatch } from '../ui/ColorPicker';
import { NumberInput } from '../NodeGraph/NumberInput';
import { GlslCode, type CodeSpan } from './GlslCode';
import { ExplainText } from './ExplainText';
import { ExplainMore } from './ExplainMore';
import { BuildUpView, newFocusSignal } from './BuildUpView';
import { varSpans } from './ExplainView';
import { ExplainLiveCanvas } from './ExplainLiveCanvas';
import { exprBlockBuildUp, exprBlockVarying, type BuildUpHost } from './buildUpHost';
import { liveProgram, liveUniformValues, type LiveType } from './liveRender';
import { lineIdiom } from './LineFold';
import { scopeNodes } from './hosts';

type Line = { lhs: string; op?: string; rhs: string; off?: boolean };
type InputDef = { name: string; type: string; slider?: { min: number; max: number } | null };

export interface LineExplainViewProps {
  node: GraphNode;
  /** The line shown: its index, or 'return'. */
  at: number | 'return';
  /** Where ‹ › go: the lines that can be explained, then Return. */
  stops: ReadonlyArray<number | 'return'>;
  ctx: ExplainContext;
  onGo: (at: number | 'return') => void;
  onBack: () => void;
  onFindUses?: (q: UseQuery, title: string) => void;
  /** Make a node from a span of the line's text (only inside its expression). */
  onMakeNode?: (span: { start: number; end: number }) => void;
}

// Try values is folded by default (the steps and the picture are the primary part); remembered for the session
let tryOpenPref = false;

const DRAWABLE = /^(float|vec[234])$/;

/** The whole line as it compiles, and where its expression starts. */
export function lineText(node: GraphNode, at: number | 'return'): { text: string; head: string } {
  if (at === 'return') { const head = 'return '; return { head, text: head + ((node.params.result as string | undefined) ?? '') }; }
  const l = ((node.params.lines as Line[] | undefined) ?? [])[at];
  if (!l) return { head: '', text: '' };
  const head = `${l.lhs} ${l.op || '='} `;
  return { head, text: head + l.rhs };
}

/**
 * The names a line can have overridden: the block's own locals as this line sees them (its inputs,
 * the variables lines above declare, the clock `t` and the scratch `p`). Globals (`vUv`, uniforms)
 * can't be assigned, so they stay live.
 */
export function overridable(node: GraphNode, at: number | 'return'): Set<string> {
  const out = new Set<string>(['t', 'p']);
  for (const i of (node.params.inputs as InputDef[] | undefined) ?? []) if (i?.name) out.add(i.name);
  const lines = (node.params.lines as Line[] | undefined) ?? [];
  for (const l of at === 'return' ? lines : lines.slice(0, at)) {
    const m = !l?.off && l?.lhs ? /^\s*(?:float|vec[234]|int)\s+([A-Za-z_]\w*)/.exec(l.lhs) : null;
    if (m) out.add(m[1]);
  }
  return out;
}

export function LineExplainView({ node, at, stops, ctx, onGo, onBack, onFindUses, onMakeNode }: LineExplainViewProps) {
  const tk = useTokens();
  // The main canvas pauses while this is open: this view's picture gets the GPU
  useEffect(() => holdPreview(), []);

  const { text, head } = lineText(node, at);
  const ex = useMemo(() => explainLine(text, ctx), [text, ctx]);
  // Wiring-aware: which names vary across the picture, and the small row pictures (no ▶ preview: the big picture is here)
  const host: BuildUpHost = useMemo(() => {
    const h = exprBlockBuildUp(node, at);
    return { varies: h.varies, pictures: h.pictures };
  }, [node, at]);
  const varies = host.varies;
  const rows = useMemo(() => (ex.ok ? buildUpRows(ex, varies) : []), [ex, varies]);
  const [selected, setSelected] = useState<string | null>(null);
  const selRow = rows.find(r => r.key === selected) ?? null;
  const [focusSignal] = useState(newFocusSignal);
  const [hover, setHover] = useState<{ start: number; end: number } | null>(null);
  const [hoverVar, setHoverVar] = useState<string | null>(null);

  // The names the line reads: their sample values (worked.ts), and the ones set by hand
  const defaults: WorkedVar[] = useMemo(() => (ex.ok ? workedVars(ex) : []), [ex]);
  const [overrides, setOverrides] = useState<Record<string, Value>>({});
  const canOverride = useMemo(() => overridable(node, at), [node, at]);
  const typeOf = (v: WorkedVar): LiveType | null => {
    const t = (ctx.types?.[v.name] as string | undefined) ?? v.type;
    return DRAWABLE.test(t) ? (t as LiveType) : null;
  };
  // The CPU numbers use the same values as the picture: an override where there is one, else the sample
  const vars: WorkedVar[] = useMemo(() => defaults.map(v => (v.name in overrides ? { ...v, value: overrides[v.name] } : v)), [defaults, overrides]);
  const ranges = useMemo(() => {
    const out = new Map<string, [number, number] | null>();
    if (!ex.ok) return out;
    for (const v of vars) out.set(`in:${v.name}`, v.range);
    for (const w of ex.steps.length ? workedSteps(ex, vars) : []) out.set(`step:${w.label}`, w.range);
    const last = ex.steps[ex.steps.length - 1];
    if (last && last.node === ex.root) out.set('result', out.get(`step:${last.label}`) ?? null);
    return out;
  }, [ex, vars]);
  const idioms = useMemo(() => new Map(ex.ok ? ex.steps.flatMap(s => (s.idiom ? [[s.label, s.idiom] as const] : [])) : []), [ex]);

  // The live picture: one program for every row; overriding a name (not its value) makes a new one
  const overriddenKey = Object.keys(overrides).sort().join(',');
  const topLevel = useNodeGraphStore.getState().activeGroupPath.length === 0;
  const program = useMemo(() => {
    if (!topLevel || !rows.length) return null;
    const list = overriddenKey ? overriddenKey.split(',').flatMap(name => {
      const v = defaults.find(d => d.name === name);
      const t = v ? typeOf(v) : null;
      return t ? [{ name, type: t }] : [];
    }) : [];
    return liveProgram(node, scopeNodes(), at, rows, list);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the overridden names, not their values
  }, [topLevel, node, at, rows, overriddenKey, defaults]);
  const values = useMemo(() => (program ? liveUniformValues(program, overrides) : {}), [program, overrides]);
  const shownKey = selRow && program?.slots.has(selRow.key) ? selRow.key : 'result';
  const sel = program?.slots.get(shownKey) ?? 0;
  const shownRow = rows.find(r => r.key === shownKey) ?? null;

  // Where the line's parts are, for lighting the selected (or hovered) one
  const reads = useMemo(() => (ex.ok ? varSpans(ex) : []), [ex]);
  const varMap = useMemo(() => new Map(reads.map(r => [r.start, r.name])), [reads]);
  const spans: CodeSpan[] = [
    ...(hoverVar ? reads.filter(r => r.name === hoverVar).map(r => ({ start: r.start, end: r.end, kind: 'var' as const })) : []),
    ...(hover ? [{ start: hover.start, end: hover.end, kind: 'step' as const }] : selRow && selRow.kind !== 'input' ? [{ start: selRow.start, end: selRow.end, kind: 'step' as const }] : []),
    ...(!hoverVar && selRow?.kind === 'input' ? reads.filter(r => r.name === selRow.label).map(r => ({ start: r.start, end: r.end, kind: 'var' as const })) : []),
  ];
  const canMake = (s: { start: number; end: number }) => !!onMakeNode && s.start >= head.length && s.end <= text.length;

  // ‹ › to the line above or below; "Line 2 of 3"
  const lines = (node.params.lines as Line[] | undefined) ?? [];
  const idx = stops.findIndex(s => s === at);
  const prev = idx > 0 ? stops[idx - 1] : null;
  const next = idx >= 0 && idx < stops.length - 1 ? stops[idx + 1] : null;
  const where = at === 'return' ? 'Return' : `Line ${at + 1} of ${lines.length}`;
  const whereWords = at === 'return' ? 'the Return line (the block’s result)' : `line ${at + 1} of ${lines.length}`;

  // Try values: what a name is when live, and what it starts at when set by hand
  const inputs = (node.params.inputs as InputDef[] | undefined) ?? [];
  const varyingNow = useMemo(() => exprBlockVarying(node, at, scopeNodes()), [node, at]);
  const liveNote = (name: string): string => {
    const inp = inputs.find(i => i.name === name);
    if (name === 't' && !inp) return 'the clock';
    if (inp?.slider) return `slider, ${showValue(nowParamValue(node, name))}`;
    if (inp && node.inputs?.[name]?.connection) return varyingNow.has(name) ? 'wired, varies' : 'wired';
    if (inp) return 'input';
    return varyingNow.has(name) ? 'from a line above, varies' : 'from a line above';
  };
  const startValue = (v: WorkedVar): Value => {
    const inp = inputs.find(i => i.name === v.name);
    if (inp?.slider) return nowParamValue(node, v.name, typeof v.value === 'number' ? v.value : 0);
    return v.value;
  };
  const setOverride = (name: string, value: Value | null) => setOverrides(o => {
    const n = { ...o };
    if (value === null) delete n[name]; else n[name] = value;
    return n;
  });
  const [tryOpen, setTryOpenState] = useState(tryOpenPref);
  // Opening it brings the controls into view (they sit under the picture)
  const tryJustOpened = useRef(false);
  const setTryOpen = (v: boolean) => { tryOpenPref = v; tryJustOpened.current = v; setTryOpenState(v); };
  const set = Object.keys(overrides).length;
  const trySummary = defaults.length === 0 ? 'nothing to set' : set === 0 ? `${defaults.length} name${defaults.length === 1 ? '' : 's'}, all live` : `${set} set by hand, ${defaults.length - set} live`;

  const pane: React.CSSProperties = { minWidth: 0, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14, boxSizing: 'border-box' };
  const navBtn: React.CSSProperties = { width: 28, height: 28, border: 0, borderRadius: radius.sm, background: 'none', color: tk.text.muted, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' };

  return (
    <div data-explain-view-page="" data-captures-escape=""
      onKeyDown={e => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); e.stopPropagation(); onBack(); } }}
      style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, width: '100%' }}>
      {/* Back to the lines, and which line this is */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderBottom: `1px solid ${tk.border.subtle}`, flexShrink: 0 }}>
        <button type="button" data-explain-action="back" onClick={onBack} title="Back to the lines (Escape)"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 28, padding: '0 10px 0 6px', border: 0, borderRadius: radius.sm, background: tk.bg.field, color: tk.text.secondary, cursor: 'pointer', font: `600 12px ${fontFamily.ui}` }}>
          <Icon name="chevL" size={13} />Lines
        </button>
        <span style={{ flex: 1 }} />
        <button type="button" data-explain-nav="prev" aria-label="The line above" title="The line above" disabled={prev === null} onClick={() => prev !== null && onGo(prev)} style={{ ...navBtn, opacity: prev === null ? 0.35 : 1 }}>
          <Icon name="chevL" size={14} />
        </button>
        <span data-explain-where="" style={{ font: `600 12px ${fontFamily.ui}`, color: tk.text.muted, minWidth: 86, textAlign: 'center' }}>{where}</span>
        <button type="button" data-explain-nav="next" aria-label="The line below" title="The line below" disabled={next === null} onClick={() => next !== null && onGo(next)} style={{ ...navBtn, opacity: next === null ? 0.35 : 1 }}>
          <Icon name="chevR" size={14} />
        </button>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexWrap: 'wrap', overflowY: 'auto' }}>
        {/* The line, its steps, and the model's explanation */}
        <div style={{ ...pane, flex: '1 1 420px' }}>
          <div data-explain-code="" style={{ font: `500 14px/1.6 ${fontFamily.mono}`, padding: '10px 12px', borderRadius: radius.lg, background: tk.bg.subtle, border: `1px solid ${tk.border.subtle}`, overflowX: 'auto' }}>
            <GlslCode code={text} spans={spans} vars={varMap} onVarHover={setHoverVar} />
          </div>
          {ex.ok ? (
            <>
              <span style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap', font: `500 12.5px/1.55 ${fontFamily.ui}`, color: tk.text.secondary }}>
                <ExplainText segs={ex.leadSegs} activeVar={hoverVar} onVarHover={setHoverVar} />
                {lineIdiom(ex) && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 8px', borderRadius: 9, background: alpha(tk.status.success, 0.12), font: `600 11px ${fontFamily.ui}` }}>
                    <Icon name="star" size={10} />{lineIdiom(ex)}
                  </span>
                )}
              </span>
              <SectionHead meta={`${rows.filter(r => r.kind === 'input').length} in · ${ex.steps.length} step${ex.steps.length === 1 ? '' : 's'} · click a row or ← → to show it`}>Step by step</SectionHead>
              <BuildUpView rows={rows} vars={vars} ranges={ranges} host={host} activeVar={hoverVar}
                onHoverSpan={setHover} onHoverVar={setHoverVar} selected={selRow?.key ?? null} onSelect={setSelected}
                canMake={canMake} onMakeNode={onMakeNode} onFindUses={onFindUses} idioms={idioms} focusSignal={focusSignal} />
              <SectionHead>The model</SectionHead>
              <ExplainMore key={text} text={text} ctx={ctx} where={whereWords} label="Explain with the model" />
            </>
          ) : (
            <span style={{ font: `500 12.5px ${fontFamily.ui}`, color: tk.text.muted }}>{text.trim() ? `Can’t read this line yet (${ex.error}).` : 'This line is gone or empty.'}</span>
          )}
        </div>

        {/* The picture, and the values to try */}
        <div style={{ ...pane, flex: '0 1 380px', borderLeft: `1px solid ${tk.border.subtle}` }}>
          <SectionHead meta={shownRow ? (shownRow.kind === 'result' ? `${shownRow.label}, the whole line` : shownRow.kind === 'input' ? `the input ${shownRow.label}` : `step ${shownRow.label}`) : undefined}>Picture</SectionHead>
          {topLevel
            ? <ExplainLiveCanvas program={program} values={values} sel={sel} size={340} rowKey={shownKey} />
            : <span style={{ font: `500 12px/1.5 ${fontFamily.ui}`, color: tk.text.muted }}>The live picture needs the block at the top level of the graph (inside a group its inputs come from the group). The steps’ small pictures still work.</span>}
          {selRow && !program?.slots.has(selRow.key) && <span style={{ font: `500 11.5px ${fontFamily.ui}`, color: tk.text.faint }}>That row can’t be drawn on its own, so this is the whole line.</span>}

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button type="button" aria-expanded={tryOpen} data-explain-try-toggle="" onClick={() => setTryOpen(!tryOpen)}
              style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6, padding: 0, border: 0, background: 'none', cursor: 'pointer', color: tk.text.muted, font: `600 11.5px ${fontFamily.ui}`, textAlign: 'left' }}>
              <Icon name={tryOpen ? 'chevD' : 'chevR'} size={11} />
              Try values
              <span data-explain-try-summary="" style={{ fontWeight: 400, color: tk.text.faint }}>{trySummary}</span>
            </button>
            {set > 0 && (
              <button type="button" data-explain-action="reset-overrides" onClick={() => setOverrides({})} title="Every name live again"
                style={{ border: 0, background: 'none', padding: 0, color: tk.accent.text, cursor: 'pointer', font: `600 11.5px ${fontFamily.ui}` }}>Reset</button>
            )}
          </div>
          {tryOpen && (
            <div data-explain-try="" ref={el => { if (el && tryJustOpened.current) { tryJustOpened.current = false; el.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }); } }} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <span style={{ font: `500 11.5px/1.5 ${fontFamily.ui}`, color: tk.text.muted }}>
                Live keeps the real value. Switch it off to set one by hand: it changes this picture and the steps’ numbers only, not the block.
              </span>
              {defaults.map(v => {
                const type = typeOf(v);
                const ok = !!type && canOverride.has(v.name);
                return (
                  <OverrideRow key={v.name} v={v} type={type} note={liveNote(v.name)} disabled={!ok}
                    colour={type === 'vec3' || type === 'vec4' ? (v.why === 'a colour' || ctx.roles?.[v.name] === 'colour') : false}
                    value={v.name in overrides ? overrides[v.name] : null}
                    onLive={live => setOverride(v.name, live ? null : startValue(v))}
                    onChange={val => setOverride(v.name, val)} />
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SectionHead({ children, meta }: { children: React.ReactNode; meta?: string }) {
  const tk = useTokens();
  return (
    <span style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', color: tk.text.faint, textTransform: 'uppercase' }}>
      <span>{children}</span>
      {meta && <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500, fontSize: 11.5, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{meta}</span>}
    </span>
  );
}

/** One name the line reads: Live (the real value), or a value set by hand. */
function OverrideRow({ v, type, note, disabled, colour, value, onLive, onChange }: {
  v: WorkedVar; type: LiveType | null; note: string; disabled: boolean; colour: boolean;
  /** The value set by hand; null while live. */
  value: Value | null;
  onLive: (live: boolean) => void;
  onChange: (v: Value) => void;
}) {
  const tk = useTokens();
  const live = value === null;
  // The slider's range: the name's usual one, widened by typing past it (the slider conventions)
  const [range, setRange] = useState<[number, number]>(v.range);
  useEffect(() => setRange(v.range), [v.range]);
  const comps = Array.isArray(value) ? value : null;
  return (
    <div data-override={v.name} data-override-live={live ? '' : undefined} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ font: `600 12px ${fontFamily.mono}`, color: tk.text.primary }}>{v.name}</span>
        <span style={{ font: `500 10.5px ${fontFamily.mono}`, color: tk.text.faint }}>{type ?? v.type}</span>
        <span style={{ flex: 1, minWidth: 0, font: `500 11px ${fontFamily.ui}`, color: tk.text.faint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{live ? note : ''}</span>
        <span title={disabled ? 'This name can’t be set here (a built-in, or a type the picture can’t take)' : live ? 'Live: the real value. Switch off to set one by hand.' : 'Set by hand. Switch on for the real value again.'}>
          <Toggle checked={live} disabled={disabled} onChange={on => onLive(on)} label="Live" />
        </span>
      </div>
      {!live && type === 'float' && typeof value === 'number' && (
        <RulerSlider value={value} min={range[0]} max={range[1]} step={0.001} onChange={onChange} onRange={(lo, hi) => setRange([lo, hi])} ariaLabel={`Value of ${v.name}`} />
      )}
      {!live && comps && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {colour && <ColorSwatch value={[comps[0], comps[1], comps[2]]} label={`Colour of ${v.name}`} size="sm" showHex={false}
            onChange={rgb => onChange(comps.length === 4 ? [rgb[0], rgb[1], rgb[2], comps[3]] : [rgb[0], rgb[1], rgb[2]])} />}
          {comps.map((c, i) => (
            <label key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, font: `500 11px ${fontFamily.mono}`, color: tk.text.faint }}>
              {'xyzw'[i]}
              <NumberInput value={c} step={0.01} title={`${v.name}.${'xyzw'[i]}`}
                onCommit={n => onChange(comps.map((x, j) => (j === i ? n : x)))}
                style={{ width: 60, height: 24, boxSizing: 'border-box', padding: '0 6px', border: 0, outline: 'none', borderRadius: radius.md, background: tk.bg.field, color: tk.text.primary, font: `500 11.5px ${fontFamily.mono}`, textAlign: 'center' }} />
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
