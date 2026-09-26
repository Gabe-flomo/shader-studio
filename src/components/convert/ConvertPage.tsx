/**
 * ConvertPage — paste GLSL, see the graph it would become, make it real.
 *
 *   left     the shader (paste, open a file, or start from an example)
 *   middle   the outline: the nodes-to-be in the converter's columns, with
 *            code it kept as code (EXPR / FN) and nodes that aren't quite
 *            GLSL (≈) marked; click one for details
 *   right    the original and the converted graph rendered on one clock with
 *            a Same / Differs badge, then the report: what can't convert, the
 *            warned nodes (each switchable to a block), blocks, regions
 *
 * Materialize replaces the current graph with the converted one (undoable)
 * and opens the Studio. "Keep as one node" is the older import: the whole
 * shader as a single code node.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { glslToGraph, normaliseHostShader, type ConversionResult } from '../../glslToGraph';
import { compileGraph } from '../../compiler/graphCompiler';
import { convertFragmentShader } from '../../nodes/userNodes/glslImport';
import { getNodeDefinition } from '../../nodes/definitions';
import type { GraphNode } from '../../types/nodeGraph';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Button } from '../ui/Button';
import { Callout } from '../ui/Callout';
import { Segmented } from '../ui/Choice';
import { Icon } from '../ui/Icon';
import { Select } from '../ui/Select';
import { toast } from '../ui/toastStore';
import { lazyWithSuspense, type PropsOf } from '../lazyWithSuspense';
import type { PublishNodeModal as PublishNodeModalT } from '../NodeGraph/PublishNodeModal';
import { OutlineCanvas } from './OutlineCanvas';
import { kindOf, labelOf } from './outlineKinds';
import { RenderPair, type PairDiff } from './RenderPair';

const PublishNodeModal = lazyWithSuspense<PropsOf<typeof PublishNodeModalT>>(() => import('../NodeGraph/PublishNodeModal').then(m => ({ default: m.PublishNodeModal })));

const CODE_KEY = 'shader-studio:convert:code';

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

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => { const id = setTimeout(() => setV(value), ms); return () => clearTimeout(id); }, [value, ms]);
  return v;
}

/** The pasted shader the way the render pair needs it: our uniforms declared once. */
function wrapOriginal(source: string): string {
  const body = normaliseHostShader(source);
  const declared = (n: string) => new RegExp(`uniform\\s+\\w+\\s+${n}\\b`).test(body);
  const head = ['precision highp float;', 'varying vec2 vUv;', ...(declared('u_resolution') ? [] : ['uniform vec2 u_resolution;']), ...(declared('u_time') ? [] : ['uniform float u_time;']), ...(declared('u_mouse') ? [] : ['uniform vec2 u_mouse;'])];
  return `${head.join('\n')}\n${body}`;
}

export function ConvertPage({ onMaterialized, compact = false }: { onMaterialized: () => void; compact?: boolean }) {
  const tk = useTokens();
  const replaceGraph = useNodeGraphStore(s => s.replaceGraph);
  const [code, setCode] = useState(() => { try { return localStorage.getItem(CODE_KEY) || EXAMPLES.circle.code; } catch { return EXAMPLES.circle.code; } });
  const [asBlock, setAsBlock] = useState<Set<string>>(() => new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [diff, setDiff] = useState<PairDiff | null>(null);
  const [oneNode, setOneNode] = useState<{ code: string; entry: string; label: string } | null>(null);
  const debounced = useDebounced(code, 250);
  useEffect(() => { try { localStorage.setItem(CODE_KEY, code); } catch { /* preference only */ } }, [code]);

  const conv: ConversionResult = useMemo(() => glslToGraph(debounced, { asBlock }), [debounced, asBlock]);
  const compiled = useMemo(() => (conv.nodes.length ? compileGraph({ nodes: conv.nodes }) : null), [conv]);
  const original = useMemo(() => wrapOriginal(debounced), [debounced]);
  const uniforms = useMemo(() => compiled?.paramUniforms ?? {}, [compiled]);
  const graphFrag = compiled?.success ? compiled.fragmentShader : null;
  const onDiff = useCallback((d: PairDiff | null) => setDiff(d), []);

  const { report } = conv;
  const blocked = report.unsupported.length > 0 || !compiled?.success;
  const sel = conv.nodes.find(n => n.id === selected) ?? null;
  const toggleBlock = (id: string) => setAsBlock(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const materialize = () => {
    if (blocked) return;
    replaceGraph(conv.nodes);
    toast.success(`${conv.nodes.length} nodes placed`, { message: report.blocks.length + report.regions.length ? 'Code the converter kept is marked FROM CODE on its cards.' : 'Every part became a node.' });
    onMaterialized();
  };
  const keepAsOne = () => {
    const r = convertFragmentShader(code, { label: 'Imported shader' });
    if (!r.ok) { toast.error('Couldn’t read the shader', { message: r.error }); return; }
    setOneNode({ code: r.code, entry: r.entry, label: 'Imported shader' });
  };
  const loadFile = () => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.glsl,.frag,.fs,.txt' });
    input.onchange = async () => { const f = input.files?.[0]; if (f) setCode(await f.text()); };
    input.click();
  };

  const heading = (text: string, count?: number) => (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, color: tk.text.faint, font: `600 10.5px ${fontFamily.ui}`, letterSpacing: '0.06em', textTransform: 'uppercase', margin: '14px 0 6px' }}>
      {text}{count !== undefined && <span style={{ color: tk.text.muted, fontFamily: fontFamily.mono, letterSpacing: 0 }}>{count}</span>}
    </div>
  );
  const mono = { font: `500 11.5px/1.45 ${fontFamily.mono}`, color: tk.text.primary, wordBreak: 'break-all' as const };
  const same = diff && !('error' in diff) ? diff.max <= 2 && diff.badPct < 0.1 : null;

  const stat = (n: number | string, label: string, colour?: string) => (
    <div style={{ padding: '6px 10px', borderRadius: radius.md, background: tk.bg.field, minWidth: 64 }}>
      <div style={{ font: `700 16px ${fontFamily.ui}`, color: colour ?? tk.text.primary }}>{n}</div>
      <div style={{ color: tk.text.faint, font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{label}</div>
    </div>
  );

  const detail = sel ? <Detail node={sel} nodes={conv.nodes} report={report} asBlock={asBlock} onToggleBlock={toggleBlock} /> : null;

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: compact ? 'column' : 'row', background: tk.bg.app, color: tk.text.primary, font: `12.5px ${fontFamily.ui}`, overflow: compact ? 'auto' : 'hidden' }}>
      {/* Left: the shader */}
      <div style={{ width: compact ? undefined : 340, flexShrink: 0, display: 'flex', flexDirection: 'column', borderRight: compact ? undefined : `1px solid ${tk.border.default}`, minHeight: compact ? 320 : undefined }}>
        <div style={{ padding: '12px 14px 8px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <b style={{ fontSize: 14, fontWeight: 650, marginRight: 'auto' }}>Convert GLSL to nodes</b>
          <Select ariaLabel="Example shader" value="" height={28} onChange={k => { if (EXAMPLES[k]) { setCode(EXAMPLES[k].code); setAsBlock(new Set()); setSelected(null); } }}
            options={[{ value: '', label: 'Examples…' }, ...Object.entries(EXAMPLES).map(([k, e]) => ({ value: k, label: e.label }))]} />
          <Button size="sm" icon="import" onClick={loadFile}>Open…</Button>
        </div>
        <textarea
          aria-label="GLSL source"
          value={code}
          onChange={e => { setCode(e.target.value); setAsBlock(new Set()); setSelected(null); }}
          spellCheck={false}
          placeholder={'Paste a fragment shader here: a plain void main() with gl_FragColor, or a Shadertoy mainImage().'}
          style={{ flex: 1, minHeight: compact ? 220 : 0, margin: '0 14px 12px', padding: 10, resize: 'none', border: 0, outline: 'none', borderRadius: radius.md, background: tk.bg.field, color: tk.text.primary, font: `12px/1.5 ${fontFamily.mono}`, tabSize: 2 }}
        />
      </div>

      {/* Middle: the outline */}
      <div style={{ flex: 1, minWidth: 0, minHeight: compact ? 360 : 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderBottom: `1px solid ${tk.border.subtle}`, flexWrap: 'wrap' }}>
          {stat(conv.nodes.length, 'nodes')}
          {stat(report.stats.sliders, 'sliders')}
          {stat(report.blocks.length, 'blocks', report.blocks.length ? tk.kind.expr : undefined)}
          {stat(report.regions.length, 'functions', report.regions.length ? tk.kind.fn : undefined)}
          {stat(report.warnings.filter(w => w.nodeId).length, 'warned', report.warnings.some(w => w.nodeId) ? tk.status.warningText : undefined)}
          <span style={{ flex: 1 }} />
          <Button size="sm" variant="ghost" onClick={keepAsOne} title="The older import: the whole shader as one code node">Keep as one node…</Button>
          <Button variant="primary" icon="nodes" disabled={blocked} onClick={materialize} title={blocked ? 'Fix what the report lists first' : 'Replace the current graph with these nodes and open the Studio (undoable)'}>Materialize</Button>
        </div>
        <div style={{ flex: 1, minHeight: 0, position: 'relative', padding: 12 }}>
          {conv.nodes.length ? <OutlineCanvas nodes={conv.nodes} selected={selected} onSelect={setSelected} /> : (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: tk.text.faint, textAlign: 'center', padding: 24, lineHeight: 1.5 }}>
              {report.unsupported.length ? 'This shader can’t become a graph yet; the report says why. You can still keep it as one node.' : 'Paste a shader to see the nodes it would become.'}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 14, padding: '6px 14px 10px', color: tk.text.faint, fontSize: 11, flexWrap: 'wrap' }}>
          <Legend colour={tk.accent.base} text="source" /><Legend colour={tk.text.muted} text="node" /><Legend colour={tk.kind.expr} text="EXPR: kept as an expression" dashed /><Legend colour={tk.kind.fn} text="FN: kept as a function" dashed /><Legend colour={tk.status.warningText} text="≈ not quite GLSL (click to choose)" /><Legend colour={tk.status.success} text="output" />
        </div>
      </div>

      {/* Right: renders, detail, report */}
      <div style={{ width: compact ? undefined : 380, flexShrink: 0, overflowY: 'auto', borderLeft: compact ? undefined : `1px solid ${tk.border.default}`, padding: '12px 14px 20px' }}>
        <RenderPair original={original} graph={graphFrag} uniforms={uniforms} onDiff={onDiff} />
        <div style={{ marginTop: 8 }}>
          {diff && 'error' in diff ? (
            <Callout tone="warning" title={diff.side === 'original' ? 'The original doesn’t compile here' : 'The converted graph doesn’t compile'} details={diff.error}>WebGL rejected the shader; the details show its message.</Callout>
          ) : diff ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: radius.md, background: alpha(same ? tk.status.success : tk.status.warning, 0.14), color: same ? tk.status.success : tk.status.warningText, font: `600 12px ${fontFamily.ui}` }}>
              <Icon name={same ? 'check' : 'warning'} size={14} />
              {same ? 'Same picture' : 'Differs'}
              <span style={{ marginLeft: 'auto', color: tk.text.muted, font: `500 11px ${fontFamily.mono}` }}>max {diff.max}/255 · {diff.badPct.toFixed(2)}% off</span>
            </div>
          ) : graphFrag ? <div style={{ color: tk.text.faint }}>Comparing…</div> : null}
        </div>

        {detail && <>{heading('Selected')}{detail}</>}

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
            <div style={{ color: tk.text.muted, lineHeight: 1.45, marginBottom: 6 }}>These nodes guard their inputs where GLSL doesn’t. Keep the node (usually fine) or keep the code exactly.</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {report.warnings.map(w => (
                <div key={w.id} style={{ padding: '6px 8px', borderRadius: radius.md, background: tk.bg.field, cursor: w.nodeId ? 'pointer' : undefined }} onClick={() => w.nodeId && setSelected(w.nodeId)}>
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
              {report.blocks.map((b, i) => <div key={i} style={{ padding: '6px 8px', borderRadius: radius.md, background: tk.bg.field }}><div style={mono}>{b.code}</div><div style={{ color: tk.text.muted, fontSize: 11.5, marginTop: 3 }}>{b.why}</div></div>)}
            </div>
          </>
        )}
        {report.regions.length > 0 && (
          <>
            {heading('Kept as functions', report.regions.length)}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {report.regions.map((g, i) => <div key={i} style={{ padding: '6px 8px', borderRadius: radius.md, background: tk.bg.field }}><div style={{ ...mono, whiteSpace: 'pre-wrap', maxHeight: 96, overflow: 'hidden' }}>{g.code}</div><div style={{ color: tk.text.muted, fontSize: 11.5, marginTop: 3 }}>{g.why}</div></div>)}
            </div>
          </>
        )}
        {report.notes.length > 0 && <>{heading('Notes')}<div style={{ color: tk.text.muted, lineHeight: 1.5 }}>{report.notes.join(' · ')}</div></>}
      </div>

      {oneNode && <PublishNodeModal source={{ kind: 'code', code: oneNode.code, entry: oneNode.entry, label: oneNode.label }} onClose={() => setOneNode(null)} />}
    </div>
  );
}

function Legend({ colour, text, dashed }: { colour: string; text: string; dashed?: boolean }) {
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 14, height: 9, borderRadius: 3, border: `${dashed ? '1.5px dashed' : '1.5px solid'} ${colour}`, background: alpha(colour, 0.15) }} />{text}</span>;
}

/** The selected node: what it is, what it holds, and, when warned, the choice. */
function Detail({ node, nodes, report, asBlock, onToggleBlock }: { node: GraphNode; nodes: GraphNode[]; report: ConversionResult['report']; asBlock: Set<string>; onToggleBlock: (id: string) => void }) {
  const tk = useTokens();
  const kind = kindOf(node);
  const def = getNodeDefinition(node.type);
  const warning = report.warnings.find(w => w.nodeId === node.id);
  const code = node.type === 'exprNode' ? String(node.params.expr ?? '') : node.type === 'customFn' ? String(node.params.body ?? '') : null;
  const why = warning?.why ?? report.blocks.find(b => b.code === code)?.why ?? report.regions.find(g => node.type === 'customFn' && String(node.params.label ?? '').includes(g.why.replace(/^call to /, '').replace(/\(\)$/, '')))?.why;
  const byId = new Map(nodes.map(n => [n.id, n]));
  const wired = Object.entries(node.inputs).filter(([, s]) => s.connection);
  const sliders = Object.entries(node.params).filter(([k, v]) => typeof v === 'number' && def?.paramDefs?.[k] && !node.inputs[k]?.connection);
  const label = kind === 'block' ? 'Expression Block' : kind === 'region' ? 'Custom Function' : def?.label ?? node.type;
  return (
    <div style={{ padding: '8px 10px', borderRadius: radius.md, background: tk.bg.field, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><b>{label}</b><span style={{ color: tk.text.faint, fontSize: 11 }}>{kind === 'warned' ? 'node, not quite GLSL' : kind}</span></div>
      {code && <div style={{ font: `500 11.5px/1.45 ${fontFamily.mono}`, whiteSpace: 'pre-wrap', maxHeight: 140, overflow: 'auto' }}>{code}</div>}
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
