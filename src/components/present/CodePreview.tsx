/**
 * CodePreview — the live picture beside a code block (the Book of Shaders
 * idea): a graph of a float function, or the result as colour, drawn by the
 * snippet harness (present/snippetHarness.ts) on the shared preview renderer
 * (present/snippetRenderer.ts).
 *
 * Under the picture: what to show (every function and body variable it can
 * draw), Plot / Field, a vec2's view (colour, grid, arrows), and a slider for
 * each number worth moving. Compile errors show in the picture's place, in
 * the snippet's line numbers; nothing a snippet does can break the page.
 *
 * The code comes in already debounced by the caller; the picture redraws
 * when anything changes, and every frame only while it reads the time or the
 * mouse and is on screen.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { analyzeSnippet, buildHarness, mapErrors, type Harness, type SnippetContext } from '../../present/snippetHarness';
import { compileLog, drawInto, onFrame } from '../../present/snippetRenderer';
import type { CodePreview as PreviewSettings } from '../../types/presentation';
import { PLOT_THEMES } from '../FunctionBuilder/glslCompiler';
import { useThemeMode, useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Segmented } from '../ui/Choice';
import { Select } from '../ui/Select';
import { Icon } from '../ui/Icon';

const fmt = (v: number) => {
  const s = Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2);
  return s.includes('.') ? s.replace(/\.?0+$/, '') || '0' : s;
};

/** Harness, errors and all, or why there's none; never throws. */
function usePreviewHarness(code: string, settings: PreviewSettings, context: SnippetContext, dpr: number): { harness: Harness | null; errors: Array<{ line: number; message: string }>; analysis: ReturnType<typeof analyzeSnippet> | null } {
  const mode = useThemeMode();
  return useMemo(() => {
    try {
      const analysis = analyzeSnippet(code, context);
      if (analysis.kind === 'empty') return { harness: null, errors: [], analysis };
      if (!analysis.options.length) return { harness: null, errors: [{ line: 0, message: 'Nothing here to draw: no function returning a float or a vector, and no variables.' }], analysis };
      const theme = PLOT_THEMES[mode];
      const harness = buildHarness(code, settings, context, { colours: { bg: theme.bg, grid: theme.grid, axis: theme.axis, curve: theme.curves[0] }, dpr });
      const log = typeof document === 'undefined' ? '' : compileLog(harness.source);
      return { harness, errors: log ? mapErrors(log, harness.lineMap) : [], analysis };
    } catch (e) {
      return { harness: null, errors: [{ line: 0, message: e instanceof Error ? e.message : String(e) }], analysis: null };
    }
  }, [code, settings, context, dpr, mode]);
}

export function CodePreviewPane({ code, settings, context, onSettings, compact = false }: {
  code: string;
  settings: PreviewSettings;
  context: SnippetContext;
  /** Change what's shown or a slider (the author's are kept with the block; a reader's aren't). */
  onSettings: (next: PreviewSettings) => void;
  compact?: boolean;
}) {
  const tk = useTokens();
  const wrap = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [visible, setVisible] = useState(true);
  const dpr = typeof window === 'undefined' ? 1 : Math.min(2, window.devicePixelRatio || 1);
  const { harness, errors, analysis } = usePreviewHarness(code, settings, context, dpr);
  const plot = harness?.mode === 'plot';
  const aspect = plot ? 16 / 10 : 16 / 10;

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => { const w = el.clientWidth; setSize({ w, h: Math.round(w / aspect) }); });
    ro.observe(el);
    const io = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(es => setVisible(es.some(e => e.isIntersecting)), { rootMargin: '80px' });
    io?.observe(el);
    return () => { ro.disconnect(); io?.disconnect(); };
  }, [aspect]);

  const values = settings.values;
  const uniforms = useMemo(() => {
    if (!harness) return {};
    const u = { ...harness.uniforms };
    for (const s of harness.sliders) if (values?.[s.uniform] !== undefined) u[s.uniform] = values[s.uniform];
    return u;
  }, [harness, values]);

  // Draw: once per change, then every frame while it moves and shows.
  const mouse = useRef<[number, number] | undefined>(undefined);
  const t0 = useRef(0);
  const failed = errors.length > 0;
  useEffect(() => {
    const canvas = cv.current;
    if (!canvas || !harness || failed || !size.w) return;
    if (!t0.current) t0.current = performance.now();
    const draw = (now: number) => {
      try { drawInto(canvas, { source: harness.source, width: size.w * dpr, height: size.h * dpr, uniforms, time: (now - t0.current) / 1000, mouse: mouse.current, dpr }); } catch { /* a lost context: the next frame tries again */ }
    };
    draw(performance.now());
    const moves = (analysis?.usesTime || analysis?.usesMouse) && visible;
    return moves ? onFrame(draw) : undefined;
  }, [harness, uniforms, size, dpr, failed, visible, analysis]);

  const options = analysis?.options ?? [];
  const show = harness?.show;
  const set = (patch: Partial<PreviewSettings>) => onSettings({ ...settings, ...patch });
  const range = harness?.range ?? { x: [0, 1] as [number, number], y: [0, 1] as [number, number] };
  const label = (s: string, style?: React.CSSProperties) => <span style={{ position: 'absolute', font: `600 10px ${fontFamily.mono}`, color: alpha(plot ? tk.text.secondary : '#ffffff', 0.75), pointerEvents: 'none', ...style }}>{s}</span>;
  const notes = [
    ...(analysis?.provided ?? []).map(p => `${p.name}: ${p.as}`),
    ...(analysis?.filled ?? []).map(f => `${f.name}: ${f.as} (it comes from lines not shown)`),
    ...((analysis?.borrowed ?? []).length ? [`with ${analysis!.borrowed.map(b => `${b}()`).join(', ')} from ${context.library ? 'its shader' : 'the app’s helpers'}`] : []),
  ];

  return (
    <div className="pp-preview" style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }} onKeyDown={e => e.stopPropagation()}>
      <div
        ref={wrap}
        onPointerMove={e => { const r = e.currentTarget.getBoundingClientRect(); mouse.current = [(e.clientX - r.left) * dpr, (r.bottom - e.clientY) * dpr]; }}
        style={{ position: 'relative', width: '100%', aspectRatio: String(aspect), borderRadius: `var(--pp-radius, ${radius.lg}px)`, overflow: 'hidden', background: plot ? 'transparent' : tk.bg.render, border: `1px solid ${tk.border.subtle}` }}
      >
        <canvas ref={cv} aria-label={show ? `Preview of ${show.label}` : 'Preview'} style={{ display: 'block', width: '100%', height: '100%', visibility: harness && !failed ? 'visible' : 'hidden' }} />
        {plot && !failed && (
          <>
            {label(fmt(range.y[1]), { top: 6, left: 8 })}
            {label(fmt(range.y[0]), { bottom: 20, left: 8 })}
            {label(fmt(range.x[0]), { bottom: 5, left: 8 })}
            {label(fmt(range.x[1]), { bottom: 5, right: 8 })}
          </>
        )}
        {(failed || !harness) && (
          <div role={failed ? 'alert' : undefined} style={{ position: 'absolute', inset: 0, padding: '12px 14px', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 4, background: failed ? alpha(tk.status.danger, 0.07) : 'transparent', font: `500 12px/1.5 ${fontFamily.mono}`, color: failed ? tk.status.danger : tk.text.faint }}>
            {failed
              ? errors.slice(0, 6).map((e, i) => <div key={i}>{e.line ? <b>Line {e.line}: </b> : null}{e.message}</div>)
              : <span style={{ font: `500 12px ${fontFamily.ui}` }}>Write some GLSL to see it here.</span>}
          </div>
        )}
      </div>
      {options.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          {options.length > 1 && (
            <Select ariaLabel="What to show" height={28} mono value={show?.id ?? ''} onChange={v => set({ show: v })}
              options={options.map(o => ({ value: o.id, label: `${o.label} · ${o.type}` }))} style={{ maxWidth: compact ? '100%' : 240 }} />
          )}
          {options.length === 1 && show && <span style={{ color: tk.text.muted, font: `600 11.5px ${fontFamily.mono}` }}>{show.label} · {show.type}</span>}
          {show?.plottable && (
            <Segmented size="sm" ariaLabel="Draw it as" value={harness?.mode ?? 'field'} onChange={mode => set({ mode })}
              options={[{ value: 'plot', label: 'Plot', title: 'A graph of y against x' }, { value: 'field', label: 'Field', title: 'The value at each point, in grey' }]} />
          )}
          {show?.type === 'vec2' && (
            <Segmented size="sm" ariaLabel="Draw the vec2 as" value={settings.view ?? 'color'} onChange={view => set({ view })}
              options={[{ value: 'color', label: 'Colour', title: 'x as red, y as green' }, { value: 'grid', label: 'Grid', title: 'A grid, moved by it' }, { value: 'arrows', label: 'Arrows', title: 'Its direction and size at points across the canvas' }]} />
          )}
          {harness && harness.mode === 'field' && (analysis?.provided.some(p => p.name === 'uv' || p.name === 'p' || p.name === 'pos')
            || (show?.kind === 'fn' && analysis?.functions.find(f => `fn:${f.name}` === show.id)?.params.some(p => /^vec[234]$/.test(p.type)))) && (
            <Segmented size="sm" ariaLabel="Coordinates" value={settings.coords ?? 'centered'} onChange={coords => set({ coords })}
              options={[{ value: 'centered', label: '−1…1', title: 'uv centred, as in the Studio' }, { value: 'unit', label: '0…1', title: 'uv from 0 to 1, as in The Book of Shaders' }]} />
          )}
        </div>
      )}
      {harness && harness.sliders.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: compact ? '1fr' : 'repeat(auto-fill, minmax(180px, 1fr))', gap: '4px 14px' }}>
          {harness.sliders.map(s => {
            const v = values?.[s.uniform] ?? s.value;
            const lo = Math.min(s.min, v), hi = Math.max(s.max, v);
            return (
              <label key={s.uniform} style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, color: tk.text.secondary, font: `600 11.5px ${fontFamily.mono}` }}>
                <span title={s.uniform} style={{ flex: '0 1 auto', minWidth: 0, maxWidth: '45%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.label}</span>
                <input type="range" aria-label={s.label} min={lo} max={hi} step={s.integer ? 1 : (hi - lo) / 200} value={v}
                  onChange={e => set({ values: { ...(values ?? {}), [s.uniform]: Number(e.target.value) } })}
                  style={{ flex: 1, minWidth: 60, accentColor: `var(--pp-accent, ${tk.accent.base})` }} />
                <span style={{ width: 38, textAlign: 'right', color: tk.text.muted, fontVariantNumeric: 'tabular-nums' }}>{fmt(v)}</span>
              </label>
            );
          })}
        </div>
      )}
      {notes.length > 0 && !failed && (
        <div style={{ display: 'flex', gap: 6, color: tk.text.faint, font: `500 11px/1.45 ${fontFamily.ui}` }}>
          <Icon name="info" size={12} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>{notes.join(' · ')}</span>
        </div>
      )}
    </div>
  );
}
