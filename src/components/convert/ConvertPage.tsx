/**
 * ConvertPage — paste GLSL, see the graph it would become on the real canvas,
 * make it real.
 *
 *   left     the shader in the GLSL page's editor (paste, open a file, or start
 *            from an example), and under it the check: the original and the
 *            converted graph rendered on one clock with a Same / Differs
 *            badge, then what the converter kept as code or only approximated
 *   centre   the Studio canvas, read-only, showing the nodes-to-be exactly as
 *            they'll look (cards, wires, previews); the app's preview on the
 *            right renders them live. Click a card for its details.
 *
 * The canvas shows the graph through the store's scratch mode: the user's
 * graph is kept aside while this page is open and comes back when it closes.
 * Materialize keeps the scratch graph as the real one (undoable) and opens the
 * Studio. "Keep as one node" is the older import: the whole shader as a single
 * code node.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { glslToGraph, normaliseHostShader, type ConversionResult } from '../../glslToGraph';
import { tidyGlsl } from '../../glsl/format';
import { optimizeGraph, type OptimizeReport } from '../../optimize/optimizeGraph';
import { onHandoff, takeHandoff } from './convertHandoff';
import { dialectLabel } from '../../glsl/dialects';
import { parseGlslError, friendlyGlsl } from '../../compiler/nodeErrors';
import { compileGraph } from '../../compiler/graphCompiler';
import { convertFragmentShader } from '../../nodes/userNodes/glslImport';
import { getNodeDefinitionFor } from '../../nodes/definitions';
import { estimateNodeHeight } from '../../store/graphLayout';
import type { GraphNode } from '../../types/nodeGraph';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Button, IconButton } from '../ui/Button';
import { Callout } from '../ui/Callout';
import { Segmented } from '../ui/Choice';
import { Icon } from '../ui/Icon';
import { Select } from '../ui/Select';
import { toast } from '../ui/toastStore';
import { lazyWithSuspense, type PropsOf } from '../lazyWithSuspense';
import type { PublishNodeModal as PublishNodeModalT } from '../NodeGraph/PublishNodeModal';
import { NodeGraph } from '../NodeGraph/NodeGraph';
import { getCardSize, getView } from '../NodeGraph/socketRegistry';
import { GlslEditor } from '../code/GlslEditor';
import { kindOf, labelOf } from './outlineKinds';
import { RenderPair, type PairDiff } from './RenderPair';

const PublishNodeModal = lazyWithSuspense<PropsOf<typeof PublishNodeModalT>>(() => import('../NodeGraph/PublishNodeModal').then(m => ({ default: m.PublishNodeModal })));

const CODE_KEY = 'shader-studio:convert:code';
const CARD_W = 360; // NodeComponent's card width

const EXAMPLES: Record<string, { label: string; code: string }> = {
  circle: { label: 'Soft circle', code: `void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  float d = length(uv - 0.5);
  float m = smoothstep(0.31, 0.3, d);
  gl_FragColor = vec4(vec3(m) * vec3(1.0, 0.7, 0.3), 1.0);
}` },
  palette: { label: 'Cosine palette', code: `void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  vec3 col = 0.5 + 0.5 * cos(u_time + uv.xyx + vec3(0.0, 2.0, 4.0));
  gl_FragColor = vec4(col, 1.0);
}` },
  rings: { label: 'Rings with glow', code: `void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution.xy) / u_resolution.y;
  float r = length(uv);
  float rings = sin(r * 40.0 - u_time * 3.0);
  float glow = 0.02 / abs(rings);
  gl_FragColor = vec4(vec3(glow) * vec3(0.9, 0.4, 0.2), 1.0);
}` },
  loop: { label: 'For loop: layered waves', code: `void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  float v = 0.0;
  float a = 0.5;
  vec2 p = uv * 4.0;
  for (int i = 0; i < 5; i++) {
    v += a * sin(p.x + p.y + u_time + float(i));
    p *= 2.0;
    a *= 0.5;
  }
  gl_FragColor = vec4(vec3(0.5 + v) * vec3(0.4, 0.8, 1.0), 1.0);
}` },
  shadertoy: { label: 'Shadertoy: fbm', code: `float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0; float a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.0; a *= 0.5; }
  return v;
}
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  float n = fbm(uv * 4.0 + iTime * 0.2);
  vec3 col = mix(vec3(0.05, 0.1, 0.2), vec3(0.9, 0.7, 0.4), n);
  fragColor = vec4(col, 1.0);
}` },
};

/** Nothing pasted yet: no nodes, and nothing to complain about. */
const EMPTY: ConversionResult = { nodes: [], report: { notes: [], warnings: [], blocks: [], regions: [], unsupported: [], stats: { nodes: 0, blocks: 0, regions: 0, sliders: 0, loops: 0 } } };

/**
 * Where the canvas starts: the whole graph when it fits at a readable zoom,
 * otherwise its top-left corner (the sources, where reading starts) at a zoom
 * where cards can be read, and the rest is a pan away. A converted shader is
 * usually a long chain, and squeezing all of it in left every card a sliver.
 */
function showStart(nodes: GraphNode[], canvas: HTMLElement | null): void {
  const { _fitViewCallback, _setViewCallback } = useNodeGraphStore.getState();
  if (!nodes.length || !canvas) return;
  _fitViewCallback?.();
  const MIN_READABLE = 0.45;
  if (getView().zoom >= MIN_READABLE || !_setViewCallback) return;
  const z = 0.6, padX = 40, padY = 120; // below the toolbar and the read-only banner
  const minX = Math.min(...nodes.map(n => n.position.x)), minY = Math.min(...nodes.map(n => n.position.y));
  _setViewCallback({ x: padX - minX * z, y: padY - minY * z }, z);
}

/** The pasted shader the way the render pair needs it: our uniforms declared once. `toSourceLine` maps a compile error's line back to the paste. */
function wrapOriginal(source: string): { code: string; toSourceLine: (line: number) => number } {
  const { code: body, toSourceLine } = normaliseHostShader(source);
  const declared = (n: string) => new RegExp(`uniform\\s+\\w+\\s+${n}\\b`).test(body);
  const head = ['precision highp float;', 'varying vec2 vUv;', ...(declared('u_resolution') ? [] : ['uniform vec2 u_resolution;']), ...(declared('u_time') ? [] : ['uniform float u_time;']), ...(declared('u_mouse') ? [] : ['uniform vec2 u_mouse;'])];
  return { code: `${head.join('\n')}\n${body}`, toSourceLine: (line: number) => toSourceLine(Math.max(1, line - head.length)) };
}

const PANE_KEY = 'shader-studio:convert:pane';
/** One note for the report: what the optimiser did, in its two kinds. */
function optimisedNote(r: OptimizeReport): string {
  const blocks = r.folds.filter(f => f.kind === 'block').length, exprs = r.folds.filter(f => f.kind === 'expr').length;
  const parts = [
    blocks ? `${blocks} ${blocks === 1 ? 'run' : 'runs'} of math cards folded into ${blocks === 1 ? 'a block' : 'blocks'}` : '',
    exprs ? `${exprs} short ${exprs === 1 ? 'run' : 'runs'} absorbed into input expressions` : '',
  ].filter(Boolean);
  return `Optimised: ${parts.join(', ')} (${r.before} → ${r.after} nodes)`;
}
const OPT_KEY = 'shader-studio:convert:optimised';

export function ConvertPage({ onMaterialized, compact = false }: { onMaterialized: () => void; compact?: boolean }) {
  const tk = useTokens();
  const setScratchNodes = useNodeGraphStore(s => s.setScratchNodes);
  const endScratch = useNodeGraphStore(s => s.endScratch);
  // `code` is the editor's text; `source` is what was last converted. Convert runs on the button
  // (or ⌘↵), not on every keystroke, so a half-typed edit never flashes errors or a broken graph.
  const [code, setCode] = useState(() => { const h = takeHandoff(); if (h !== null) return h; try { return localStorage.getItem(CODE_KEY) || EXAMPLES.circle.code; } catch { return EXAMPLES.circle.code; } });
  const [source, setSource] = useState(code);
  const stale = code !== source;
  const [asBlock, setAsBlock] = useState<Set<string>>(() => new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [diff, setDiff] = useState<PairDiff | null>(null);
  const [oneNode, setOneNode] = useState<{ code: string; entry: string; label: string } | null>(null);
  // On a phone the page is one pane at a time: the code, the graph, or the check.
  const [pane, setPane] = useState<'code' | 'graph' | 'check'>('code');
  useEffect(() => { try { localStorage.setItem(CODE_KEY, code); } catch { /* preference only */ } }, [code]);
  useEffect(() => onHandoff(c => { setCode(c); setSource(c); setAsBlock(new Set()); setSelected(null); setPane('graph'); }), []);
  const empty = !source.trim();

  const raw: ConversionResult = useMemo(() => (source.trim() ? glslToGraph(source, { asBlock }) : EMPTY), [source, asBlock]);
  // Optimised: the converted graph with runs of math cards folded into blocks and short float runs absorbed into
  // input expressions (the picture is the same; the check proves it).
  const [optimised, setOptimised] = useState(() => { try { return localStorage.getItem(OPT_KEY) !== 'off'; } catch { return true; } });
  useEffect(() => { try { localStorage.setItem(OPT_KEY, optimised ? 'on' : 'off'); } catch { /* preference only */ } }, [optimised]);
  const opt = useMemo(() => (optimised && raw.nodes.length ? optimizeGraph(raw.nodes, { minChain: 3, keepSliders: true }) : null), [raw, optimised]);
  const conv: ConversionResult = useMemo(() => (opt ? { nodes: opt.nodes, report: { ...raw.report, notes: [...raw.report.notes, ...(opt.report.folds.length ? [optimisedNote(opt.report)] : [])] } } : raw), [raw, opt]);
  const compiled = useMemo(() => (conv.nodes.length ? compileGraph({ nodes: conv.nodes }) : null), [conv]);
  const wrapped = useMemo(() => wrapOriginal(source), [source]);
  const original = wrapped.code;
  const uniforms = useMemo(() => compiled?.paramUniforms ?? {}, [compiled]);
  const graphFrag = compiled?.success ? compiled.fragmentShader : null;
  const onDiff = useCallback((d: PairDiff | null) => setDiff(d), []);

  // The converted graph goes on the real canvas (scratch mode); the user's graph comes back on leave.
  const canvasWrap = useRef<HTMLDivElement>(null);
  const shapeRef = useRef('');
  useEffect(() => {
    setScratchNodes(conv.nodes);
    // Re-place the view when the graph's shape changed (new or different nodes), not on every slider edit.
    const shape = conv.nodes.map(n => n.id).join('|');
    if (shape !== shapeRef.current) {
      shapeRef.current = shape;
      const t = setTimeout(() => showStart(conv.nodes, canvasWrap.current), 80);
      return () => clearTimeout(t);
    }
  }, [conv, setScratchNodes]);
  useEffect(() => () => endScratch(false), [endScratch]);
  // On a phone the canvas mounts when its pane opens: place the view then.
  useEffect(() => {
    if (!compact || pane !== 'graph') return;
    const t = setTimeout(() => showStart(conv.nodes, canvasWrap.current), 120);
    return () => clearTimeout(t);
  }, [compact, pane, conv]);

  const { report } = conv;
  const blocked = report.unsupported.length > 0 || !compiled?.success;
  // Where the paste went wrong, on its own lines: the parser's stop, or the original's compile errors.
  const errorLines = useMemo(() => {
    const m = new Map<number, string>();
    if (report.errorLine) m.set(report.errorLine, report.unsupported.find(u => u.startsWith('Doesn’t parse') || u.startsWith("Doesn't parse"))?.replace(/^Doesn.t parse[^:]*: /, '') ?? 'Doesn’t parse here');
    if (diff && 'error' in diff && diff.side === 'original') {
      for (const raw of diff.error.split('\n')) { const p = parseGlslError(raw); if (p) { const l = wrapped.toSourceLine(p.line); m.set(l, m.has(l) ? `${m.get(l)} · ${friendlyGlsl(p.text)}` : friendlyGlsl(p.text)); } }
    }
    return m;
  }, [report, diff, wrapped]);
  const [paneW, setPaneW] = useState(() => { try { return Math.max(280, Math.min(900, Number(localStorage.getItem(PANE_KEY)) || 360)); } catch { return 360; } });
  const startPaneResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX, startW = paneW;
    const onMove = (ev: MouseEvent) => setPaneW(Math.max(280, Math.min(900, startW + ev.clientX - startX)));
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); setPaneW(w => { try { localStorage.setItem(PANE_KEY, String(w)); } catch { /* preference only */ } return w; }); };
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
  };
  const tidy = () => {
    const t = tidyGlsl(code);
    if (!t.changed) { toast.info('Already tidy'); return; }
    load(t.code);
    toast.success(t.dialect === 'studio' ? 'Tidied' : `Tidied, read as ${dialectLabel(t.dialect)}`, { message: [...t.notes, ...t.unsupported].join(' · ') || 'Indentation and spacing made regular.' });
  };
  const sel = conv.nodes.find(n => n.id === selected) ?? null;
  const toggleBlock = (id: string) => setAsBlock(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const changeCode = (next: string) => { setCode(next); setAsBlock(new Set()); setSelected(null); };
  /** Convert what the editor holds now. */
  const run = () => { setSource(code); setAsBlock(new Set()); setSelected(null); if (compact) setPane('graph'); };
  /** A whole new shader (an example, a file, Tidy, Clear): converted straight away. */
  const load = (next: string) => { changeCode(next); setSource(next); };
  const onPaneKey = (e: React.KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); run(); } };

  const materialize = () => {
    if (blocked) return;
    const count = useNodeGraphStore.getState().nodes.length;
    endScratch(true);
    toast.success(`${count} nodes placed`, { message: report.blocks.length + report.regions.length ? 'Code the converter kept is marked FROM CODE on its cards.' : 'Every part became a node.' });
    onMaterialized();
  };
  const keepAsOne = () => {
    const r = convertFragmentShader(code, { label: 'Imported shader' });
    if (!r.ok) { toast.error('Couldn’t read the shader', { message: r.error }); return; }
    setOneNode({ code: r.code, entry: r.entry, label: 'Imported shader' });
  };
  const loadFile = () => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.glsl,.frag,.fs,.txt' });
    input.onchange = async () => { const f = input.files?.[0]; if (f) load(await f.text()); };
    input.click();
  };

  // Cards are inert on the locked canvas, so a click picks the card under the pointer by geometry.
  const press = useRef<{ x: number; y: number } | null>(null);
  const pickAt = (clientX: number, clientY: number): string | null => {
    const rect = canvasWrap.current?.getBoundingClientRect(); if (!rect) return null;
    const { pan, zoom } = getView();
    const wx = (clientX - rect.left - pan.x) / zoom, wy = (clientY - rect.top - pan.y) / zoom;
    for (let i = conv.nodes.length - 1; i >= 0; i--) {
      const n = conv.nodes[i]; const size = getCardSize(n.id);
      const w = size?.w ?? CARD_W, h = size?.h ?? estimateNodeHeight(n);
      if (wx >= n.position.x && wx <= n.position.x + w && wy >= n.position.y && wy <= n.position.y + h) return n.id;
    }
    return null;
  };
  const onCanvasClick = (e: React.MouseEvent) => {
    if (press.current && Math.hypot(e.clientX - press.current.x, e.clientY - press.current.y) > 4) return; // a pan or box-select, not a click
    const id = pickAt(e.clientX, e.clientY);
    setSelected(id);
    useNodeGraphStore.getState().setSelectedNodeId(id);
  };

  const same = diff && !('error' in diff) ? diff.max <= 2 && diff.badPct < 0.1 : null;
  const warnedCount = report.warnings.filter(w => w.nodeId).length;
  const panelHead = { height: 52, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6, padding: '0 8px 0 16px', borderBottom: `1px solid ${tk.border.subtle}` } as const;
  const caps = { color: tk.text.faint, font: `600 10.5px ${fontFamily.ui}`, letterSpacing: '0.06em', textTransform: 'uppercase' as const, margin: '12px 0 6px', display: 'flex', alignItems: 'baseline', gap: 6 };
  const mono = { font: `500 11.5px/1.45 ${fontFamily.mono}`, color: tk.text.primary, wordBreak: 'break-all' as const };
  const heading = (text: string, count?: number) => <div style={caps}>{text}{count !== undefined && <span style={{ color: tk.text.muted, fontFamily: fontFamily.mono, letterSpacing: 0 }}>{count}</span>}</div>;
  const summary = [
    `${conv.nodes.length} ${conv.nodes.length === 1 ? 'node' : 'nodes'}`,
    report.stats.sliders ? `${report.stats.sliders} ${report.stats.sliders === 1 ? 'slider' : 'sliders'}` : null,
    report.stats.loops ? `${report.stats.loops} ${report.stats.loops === 1 ? 'loop' : 'loops'}` : null,
    report.blocks.length ? `${report.blocks.length} kept as ${report.blocks.length === 1 ? 'an expression' : 'expressions'}` : null,
    report.regions.length ? `${report.regions.length} kept as ${report.regions.length === 1 ? 'a function' : 'functions'}` : null,
    warnedCount ? `${warnedCount} ≈` : null,
  ].filter(Boolean).join(' · ');

  const formSwitch = <Segmented size="sm" ariaLabel="Graph form" value={optimised ? 'opt' : 'raw'} onChange={v => setOptimised(v === 'opt')} options={[{ value: 'raw', label: 'As written' }, { value: 'opt', label: 'Optimised' }]} />;
  const convertButton = (
    <Button size="sm" variant={stale ? 'primary' : 'secondary'} icon="spark" onClick={run} disabled={!stale && (empty || !code.trim())} title={stale ? 'Convert the shader as it is now (⌘↵ / Ctrl+Enter)' : 'Converted. Edit the shader and press again to run it'}>Convert</Button>
  );
  const check = (
    <div style={compact
      ? { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: tk.bg.subtle }
      : { borderTop: `1px solid ${tk.border.subtle}`, background: tk.bg.subtle, flexShrink: 0, maxHeight: '46%', display: 'flex', flexDirection: 'column' }}>
      {compact && <div style={{ padding: '10px 14px 0', display: 'flex', gap: 8, alignItems: 'center' }}>{formSwitch}</div>}
      {empty ? (
        <div style={{ padding: '14px', color: tk.text.faint, lineHeight: 1.5 }}>Paste a fragment shader, or pick an example, and press Convert. The check compares the original with the graph here.</div>
      ) : (
      <div style={{ padding: '10px 14px 0', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <RenderPair original={original} graph={graphFrag} uniforms={uniforms} onDiff={onDiff} size={84} />
        <div style={{ flex: 1, minWidth: 0, paddingTop: 2 }}>
          {diff && 'error' in diff ? (
            <span style={{ color: tk.status.warningText, font: `600 12px ${fontFamily.ui}` }}>{diff.side === 'original' ? 'The original doesn’t compile here' : 'The converted graph doesn’t compile'}</span>
          ) : diff ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: same ? tk.status.success : tk.status.warningText, font: `600 12.5px ${fontFamily.ui}` }}>
              <Icon name={same ? 'check' : 'warning'} size={14} />{same ? 'Same picture' : 'Differs'}
            </div>
          ) : <span style={{ color: tk.text.faint }}>{graphFrag ? 'Comparing…' : 'Nothing to compare yet'}</span>}
          {diff && !('error' in diff) && <div style={{ color: tk.text.muted, font: `500 11px ${fontFamily.mono}`, marginTop: 3 }}>max {diff.max}/255 · {diff.badPct.toFixed(2)}% off</div>}
          <div style={{ color: tk.text.muted, fontSize: 11.5, lineHeight: 1.45, marginTop: 6 }}>{summary}{stale && <span style={{ color: tk.status.warningText }}> · edited since: press Convert</span>}</div>
        </div>
      </div>
      )}
      <div style={{ overflowY: 'auto', padding: '0 14px 14px', minHeight: 0 }}>
        {diff && 'error' in diff && <div style={{ marginTop: 10 }}><Callout tone="warning" title="WebGL rejected the shader" details={diff.error}>The details show its message.</Callout></div>}
        {report.unsupported.length > 0 && (
          <>
            {heading('Can’t convert', report.unsupported.length)}
            <Callout tone="warning" title="Not a graph yet">
              <ul style={{ margin: '4px 0 0', paddingLeft: 18, lineHeight: 1.5 }}>{report.unsupported.map(u => <li key={u}>{u}</li>)}</ul>
              <div style={{ marginTop: 6 }}>Change the shader, or keep it as one node.</div>
            </Callout>
          </>
        )}
        {compiled && !compiled.success && (
          <>{heading('Compiler')}<Callout title="The converted graph doesn’t compile" details={(compiled.errors ?? []).join('\n')}>A converter bug most likely; the details show what the compiler said.</Callout></>
        )}
        {report.warnings.length > 0 && (
          <>
            {heading('Not quite GLSL', report.warnings.length)}
            <div style={{ color: tk.text.muted, lineHeight: 1.45, marginBottom: 6, fontSize: 11.5 }}>These nodes guard their inputs where GLSL doesn’t. Keep the node (usually fine) or keep the code exactly.</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {report.warnings.map(w => (
                <div key={w.id} style={{ padding: '6px 8px', borderRadius: radius.md, background: tk.bg.panel, boxShadow: `inset 0 0 0 1px ${w.nodeId === selected ? tk.accent.base : tk.border.default}`, cursor: w.nodeId ? 'pointer' : undefined }} onClick={() => { if (w.nodeId) { setSelected(w.nodeId); useNodeGraphStore.getState().setSelectedNodeId(w.nodeId); } }}>
                  <div style={mono}>{w.code}</div>
                  <div style={{ color: tk.text.muted, fontSize: 11.5, margin: '3px 0 6px', lineHeight: 1.4 }}>{w.why}</div>
                  <Segmented size="sm" ariaLabel="Node or code" value={asBlock.has(w.id) ? 'block' : 'node'} onChange={() => toggleBlock(w.id)} options={[{ value: 'node', label: 'Node ≈' }, { value: 'block', label: 'Expression Block' }]} />
                </div>
              ))}
            </div>
          </>
        )}
        {report.blocks.length > 0 && (
          <>
            {heading('Kept as expressions', report.blocks.length)}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {report.blocks.map((b, i) => <div key={i} style={{ padding: '6px 8px', borderRadius: radius.md, background: tk.bg.panel, boxShadow: `inset 0 0 0 1px ${tk.border.default}` }}><div style={mono}>{b.code}</div><div style={{ color: tk.text.muted, fontSize: 11.5, marginTop: 3 }}>{b.why}</div></div>)}
            </div>
          </>
        )}
        {report.regions.length > 0 && (
          <>
            {heading('Kept as functions', report.regions.length)}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {report.regions.map((g, i) => <div key={i} style={{ padding: '6px 8px', borderRadius: radius.md, background: tk.bg.panel, boxShadow: `inset 0 0 0 1px ${tk.border.default}` }}><div style={{ ...mono, whiteSpace: 'pre-wrap', maxHeight: 96, overflow: 'hidden' }}>{g.code}</div><div style={{ color: tk.text.muted, fontSize: 11.5, marginTop: 3 }}>{g.why}</div></div>)}
            </div>
          </>
        )}
        {report.notes.length > 0 && <>{heading('Notes')}<div style={{ color: tk.text.muted, lineHeight: 1.5, fontSize: 11.5 }}>{report.notes.join(' · ')}</div></>}
      </div>
    </div>
  );

  const editorHead = (
    <div style={panelHead}>
      <span style={{ fontWeight: 650, fontSize: 13.5, marginRight: 'auto', whiteSpace: 'nowrap' }}>{compact ? 'Shader' : 'Fragment shader'}</span>
      <Select ariaLabel="Example shader" value="" height={30} onChange={k => { if (EXAMPLES[k]) load(EXAMPLES[k].code); }}
        options={[{ value: '', label: 'Examples…' }, ...Object.entries(EXAMPLES).map(([k, e]) => ({ value: k, label: e.label }))]} />
      <IconButton icon="import" label="Open a .glsl / .frag file" size="sm" onClick={loadFile} />
      <IconButton icon="copy" label="Copy the whole shader" size="sm" disabled={!code.trim()} onClick={() => { navigator.clipboard?.writeText(code).then(() => toast.success('Copied'), () => toast.error('Couldn’t copy')); }} />
      <Button size="sm" variant="ghost" onClick={tidy} disabled={!code.trim()} title="Rewrite the paste as Playfield GLSL: our names for time, resolution, mouse and the entry point, regular indentation">Tidy</Button>
      <Button size="sm" variant="ghost" onClick={() => load('')} disabled={!code.trim()} title="Empty the editor">Clear</Button>
      {!compact && convertButton}
    </div>
  );
  const editor = <GlslEditor value={code} onChange={changeCode} errorLines={errorLines} placeholder={'Paste a fragment shader: a plain void main() with gl_FragColor, or a Shadertoy mainImage().'} />;
  const canvas = (
    <div ref={canvasWrap} style={{ flex: 1, minWidth: 0, minHeight: 0, position: 'relative' }}
      onMouseDownCapture={e => { press.current = { x: e.clientX, y: e.clientY }; }} onClick={onCanvasClick}>
      <NodeGraph redesignToolbar locked />
      <div style={{ position: 'absolute', top: 66, left: '50%', transform: 'translateX(-50%)', zIndex: 20, display: 'flex', alignItems: 'center', gap: 8, padding: compact ? '6px 12px' : '4px 4px 4px 12px', borderRadius: 10, maxWidth: 'calc(100% - 32px)', background: tk.bg.panel, boxShadow: `${tk.shadow.float}, inset 0 0 0 1px ${alpha(tk.accent.base, 0.35)}`, color: tk.text.secondary, whiteSpace: 'nowrap' }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: stale ? tk.status.warning : tk.accent.base, flexShrink: 0 }} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>Read-only preview <span style={{ color: tk.text.muted }}>· {summary}</span>{stale && <span style={{ color: tk.status.warningText }}> · edited: press Convert</span>}</span>
        {!compact && formSwitch}
        {!compact && <Button size="sm" variant="ghost" onClick={keepAsOne} title="The older import: the whole shader as one code node">Keep as one node…</Button>}
        {!compact && <Button size="sm" variant="primary" icon="nodes" disabled={blocked} onClick={materialize} title={blocked ? 'Fix what the check lists first' : 'Keep these nodes as the graph and open the Studio (undoable)'}>Materialize</Button>}
      </div>
      {conv.nodes.length === 0 && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <div style={{ maxWidth: 380, padding: '14px 18px', borderRadius: radius.lg, background: tk.bg.panel, boxShadow: tk.shadow.float, color: tk.text.muted, textAlign: 'center', lineHeight: 1.5 }}>
            {report.unsupported.length ? 'This shader can’t become a graph yet; the check says why. You can still keep it as one node.' : empty ? 'Paste a shader and press Convert to see the nodes it would become.' : 'Nothing to show for this shader.'}
          </div>
        </div>
      )}
      {sel && (
        <div style={{ position: 'absolute', left: 16, bottom: 16, zIndex: 20, width: 340, maxWidth: 'calc(100% - 32px)', maxHeight: '55%', overflowY: 'auto', padding: '10px 12px', borderRadius: radius.lg, background: tk.bg.panel, boxShadow: tk.shadow.float }} onClick={e => e.stopPropagation()} onMouseDownCapture={e => e.stopPropagation()}>
          <Detail node={sel} nodes={conv.nodes} report={report} asBlock={asBlock} onToggleBlock={toggleBlock} onClose={() => { setSelected(null); useNodeGraphStore.getState().setSelectedNodeId(null); }} />
        </div>
      )}
    </div>
  );

  if (compact) {
    return (
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: tk.bg.panel, color: tk.text.primary, font: `12.5px ${fontFamily.ui}`, overflow: 'hidden' }} onKeyDownCapture={onPaneKey}>
        <div style={{ height: 48, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px', borderBottom: `1px solid ${tk.border.subtle}` }}>
          <Segmented size="sm" ariaLabel="Convert view" value={pane} onChange={setPane} options={[{ value: 'code', label: 'Code' }, { value: 'graph', label: conv.nodes.length ? `Graph · ${conv.nodes.length}` : 'Graph' }, { value: 'check', label: blocked && !empty ? 'Check !' : 'Check' }]} />
          <span style={{ flex: 1 }} />
          {convertButton}
        </div>
        {/* The code pane stays mounted (its undo history and scroll survive a look at the graph). */}
        <div style={{ flex: 1, minHeight: 0, display: pane === 'code' ? 'flex' : 'none', flexDirection: 'column', position: 'relative' }}>
          {editorHead}
          {editor}
        </div>
        {pane === 'graph' && canvas}
        {pane === 'check' && check}
        <div style={{ height: 52, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px', borderTop: `1px solid ${tk.border.subtle}` }}>
          <Button size="sm" variant="ghost" onClick={keepAsOne} disabled={!code.trim()} title="The older import: the whole shader as one code node">Keep as one node…</Button>
          <span style={{ flex: 1 }} />
          <Button size="sm" variant="primary" icon="nodes" disabled={blocked || empty} onClick={materialize} title={blocked ? 'Fix what the check lists first' : 'Keep these nodes as the graph and open the Studio (undoable)'}>Materialize</Button>
        </div>
        {oneNode && <PublishNodeModal source={{ kind: 'code', code: oneNode.code, entry: oneNode.entry, label: oneNode.label }} onClose={() => setOneNode(null)} />}
      </div>
    );
  }

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'row', background: tk.bg.panel, color: tk.text.primary, font: `12.5px ${fontFamily.ui}`, overflow: 'hidden' }}>
      {/* Left: the shader, as the GLSL page shows it */}
      <div style={{ width: paneW, flexShrink: 0, display: 'flex', flexDirection: 'column', borderRight: `1px solid ${tk.border.default}`, minWidth: 0, position: 'relative' }} onKeyDownCapture={onPaneKey}>
        {editorHead}
        {editor}
        {check}
        <div onMouseDown={startPaneResize} title="Drag to resize" style={{ position: 'absolute', top: 0, bottom: 0, right: -3, width: 6, cursor: 'col-resize', zIndex: 5 }} />
      </div>

      {/* Centre: the Studio canvas, read-only */}
      {canvas}

      {oneNode && <PublishNodeModal source={{ kind: 'code', code: oneNode.code, entry: oneNode.entry, label: oneNode.label }} onClose={() => setOneNode(null)} />}
    </div>
  );
}

/** The selected node: what it is, what it holds, and, when warned, the choice. */
function Detail({ node, nodes, report, asBlock, onToggleBlock, onClose }: { node: GraphNode; nodes: GraphNode[]; report: ConversionResult['report']; asBlock: Set<string>; onToggleBlock: (id: string) => void; onClose: () => void }) {
  const tk = useTokens();
  const kind = kindOf(node);
  const def = getNodeDefinitionFor(node);
  const warning = report.warnings.find(w => w.nodeId === node.id);
  const code = node.type === 'exprNode' ? String(node.params.expr ?? '') : node.type === 'customFn' ? String(node.params.body ?? '') : null;
  const why = warning?.why ?? report.blocks.find(b => b.code === code)?.why ?? report.regions.find(g => node.type === 'customFn' && String(node.params.label ?? '').includes(g.why.replace(/^call to /, '').replace(/\(\)$/, '')))?.why;
  const byId = new Map(nodes.map(n => [n.id, n]));
  const wired = Object.entries(node.inputs).filter(([, s]) => s.connection);
  const sliders = Object.entries(node.params).filter(([k, v]) => typeof v === 'number' && def?.paramDefs?.[k] && !node.inputs[k]?.connection);
  const label = kind === 'block' ? 'Expression Block' : kind === 'region' ? 'Custom Function' : def?.label ?? node.type;
  const kindText = kind === 'warned' ? 'node, not quite GLSL' : kind === 'block' ? 'code kept as an expression' : kind === 'region' ? 'code kept as a function' : kind === 'source' ? 'source' : kind === 'output' ? 'output' : kind === 'loop' ? 'a for loop: an iterated group (open it in the Studio)' : 'node';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <b style={{ fontSize: 13 }}>{label}</b>
        <span style={{ color: tk.text.faint, fontSize: 11 }}>{kindText}</span>
        <span style={{ marginLeft: 'auto' }}><IconButton icon="close" label="Close" size="sm" onClick={onClose} /></span>
      </div>
      {code && <div style={{ font: `500 11.5px/1.45 ${fontFamily.mono}`, whiteSpace: 'pre-wrap', maxHeight: 140, overflow: 'auto', padding: '6px 8px', borderRadius: radius.md, background: tk.bg.field }}>{code}</div>}
      {!code && <div style={{ color: tk.text.secondary }}>{labelOf(node)}</div>}
      {why && <div style={{ color: tk.text.muted, fontSize: 11.5, lineHeight: 1.4 }}>{why}</div>}
      {wired.length > 0 && <div style={{ color: tk.text.muted, fontSize: 11.5 }}>Inputs: {wired.map(([k, s]) => `${k} ← ${byId.get(s.connection!.nodeId) ? labelOf(byId.get(s.connection!.nodeId)!) : '?'}`).join(' · ')}</div>}
      {sliders.length > 0 && <div style={{ color: tk.text.muted, fontSize: 11.5 }}>Sliders: {sliders.map(([k, v]) => `${def?.paramDefs?.[k]?.label ?? k} = ${v as number}`).join(' · ')}</div>}
      {warning && (
        <Segmented size="sm" ariaLabel="Node or code" value={asBlock.has(warning.id) ? 'block' : 'node'} onChange={() => onToggleBlock(warning.id)} options={[{ value: 'node', label: 'Keep the node ≈' }, { value: 'block', label: 'Expression Block instead' }]} />
      )}
    </div>
  );
}
