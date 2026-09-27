/**
 * AddCodeDialog — where a Code block's code comes from. Four ways in, one
 * kind of block out (code, where it came from, and a live preview when it
 * can draw):
 *
 *   Write your own     an editor with GLSL highlighting and completion,
 *                      a few starting points, and the preview as you type
 *   Functions          your Functions library (with its thumbnails) and the
 *                      functions found in your saved GLSL shaders (Function
 *                      Discovery), searchable, by return type; the code
 *                      comes with its helpers and where it was found
 *   A node’s code      any node type, searched or by category: its helper
 *                      functions, its lines in main() with its default
 *                      settings, its inputs and outputs with their types and
 *                      hints, and how it works; insert all of it or parts
 *   From a shader      a Play in this presentation (or the graph open in the
 *                      Studio): the whole shader, its declarations, main(),
 *                      one node's lines, or one function (with the functions
 *                      it calls); a Play's Script layers too
 *
 * Nothing is inserted until Insert: the old "From a source's shader" menu
 * item put the whole shader in without asking.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { contextFromShader, type SnippetContext } from '../../present/snippetHarness';
import { initialPreview, nextPreview, presetFunctionCode } from '../../present/codePick';
import { listNodeTypes, nodeCode, nodeCodeText, type NodeCodeParts } from '../../present/nodeCode';
import { shaderRegions, type ShaderRegion } from '../../present/shaderRegions';
import { resolveCode } from '../../present/code';
import { bundleText, discoverFunctions, toCustomFnPreset, type DiscoveredFn } from '../../glsl/discover';
import { defaultComment } from '../code/useDiscoverPicks';
import { loadCustomFns, useNodeGraphStore } from '../../store/useNodeGraphStore';
import { getNodeDefinition } from '../../nodes/definitions';
import type { CodeBlock, CodeOrigin, CodePreview, PresentSource } from '../../types/presentation';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Button } from '../ui/Button';
import { Chip } from '../ui/Chip';
import { Segmented, Toggle } from '../ui/Choice';
import { Field } from '../ui/Field';
import { Icon } from '../ui/Icon';
import type { IconName } from '../ui/iconPaths';
import { Modal } from '../ui/Modal';
import { Select } from '../ui/Select';
import { CodeField } from '../code/CodeField';
import { buildCompletions } from '../code/glslReference';
import { tokenizeJsLine } from '../code/jsSyntax';
import { FnThumbnail } from '../code/FnThumbnail';
import { CodeView } from './CodeView';
import { CodePreviewPane } from './CodePreview';
import { SourcePicker } from './Sources';
import { usePresentation } from './presentationStore';

export type CodeRoute = 'write' | 'functions' | 'nodes' | 'shader';

/** What the chooser hands back: the block's code fields. */
export type CodePick = Pick<CodeBlock, 'language' | 'code' | 'origin' | 'preview' | 'caption' | 'from'>;

const ROUTES: Array<{ id: CodeRoute; label: string; icon: IconName; hint: string }> = [
  { id: 'write', label: 'Write your own', icon: 'edit', hint: 'GLSL with highlighting and a live preview' },
  { id: 'functions', label: 'Functions', icon: 'fn', hint: 'Your Functions library and the saved shaders' },
  { id: 'nodes', label: 'A node’s code', icon: 'nodes', hint: 'The GLSL behind any node' },
  { id: 'shader', label: 'From a shader', icon: 'code', hint: 'Part of a Play’s generated shader' },
];

const GLSL_COMPLETIONS = buildCompletions([]);
const NO_CONTEXT: SnippetContext = {};

// ── Pieces ──────────────────────────────────────────────────────────────────

function Caps({ children, extra }: { children: ReactNode; extra?: ReactNode }) {
  const tk = useTokens();
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 12px 4px', color: tk.text.faint, font: `700 10px ${fontFamily.ui}`, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
      <span style={{ flex: 1 }}>{children}</span>{extra}
    </div>
  );
}

function PickRow({ on, onPick, lead, title, detail, badge }: { on: boolean; onPick: () => void; lead?: ReactNode; title: ReactNode; detail?: ReactNode; badge?: ReactNode }) {
  const tk = useTokens();
  return (
    <button
      type="button" onClick={onPick} aria-pressed={on}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', border: 0, cursor: 'pointer', padding: '6px 12px', minHeight: 40,
        background: on ? alpha(tk.accent.base, 0.12) : 'transparent', color: tk.text.primary, font: `500 12.5px ${fontFamily.ui}`,
        boxShadow: on ? `inset 3px 0 0 ${tk.accent.base}` : 'none',
      }}
      onMouseEnter={e => { if (!on) e.currentTarget.style.background = alpha(tk.accent.base, 0.06); }}
      onMouseLeave={e => { if (!on) e.currentTarget.style.background = 'transparent'; }}
    >
      {lead}
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
        {detail && <span style={{ fontSize: 11, color: tk.text.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{detail}</span>}
      </span>
      {badge}
    </button>
  );
}

function TypeBadge({ type }: { type: string }) {
  const tk = useTokens();
  return <span style={{ flexShrink: 0, padding: '1px 6px', borderRadius: 6, background: tk.bg.field, color: tk.text.muted, font: `600 10.5px ${fontFamily.mono}` }}>{type}</span>;
}

function Empty({ children }: { children: ReactNode }) {
  const tk = useTokens();
  return <div style={{ padding: '18px 14px', color: tk.text.muted, font: `500 12.5px/1.5 ${fontFamily.ui}` }}>{children}</div>;
}

/** Code as read, with its preview under it and the switch that keeps the preview with the block. */
function PickedCode({ code, from, context, preview, setPreview, withPreview, setWithPreview, compact, maxHeight = 260 }: {
  code: string; from: string; context: SnippetContext; preview: CodePreview | undefined; setPreview: (p: CodePreview) => void;
  withPreview: boolean; setWithPreview: (v: boolean) => void; compact: boolean; maxHeight?: number;
}) {
  const resolved = useMemo(() => resolveCode({ type: 'code', id: 'pick', language: 'glsl', code }, new Map()), [code]);
  const shown = useMemo(() => ({ ...resolved, from }), [resolved, from]);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
      <CodeView code={shown} maxHeight={maxHeight} />
      <PreviewSwitch preview={preview} withPreview={withPreview} setWithPreview={setWithPreview} />
      {withPreview && preview && <CodePreviewPane code={code} settings={preview} context={context} onSettings={setPreview} compact={compact} />}
    </div>
  );
}

function PreviewSwitch({ preview, withPreview, setWithPreview }: { preview: CodePreview | undefined; withPreview: boolean; setWithPreview: (v: boolean) => void }) {
  const tk = useTokens();
  if (!preview) return <div style={{ color: tk.text.faint, font: `500 11.5px ${fontFamily.ui}` }}>No preview: nothing here returns a float or a vector.</div>;
  return <Toggle checked={withPreview} onChange={setWithPreview} label="Live preview beside the code" />;
}

/** The preview settings for a piece of code, starting from its best guess and following the code as it changes. */
function usePickPreview(code: string, ctx: SnippetContext) {
  const [state, setState] = useState(() => ({ code, ctx, preview: initialPreview(code, ctx) }));
  // New code (or context): work out its preview now, while rendering, rather than a frame later.
  let current = state;
  if (state.code !== code || state.ctx !== ctx) {
    current = { code, ctx, preview: nextPreview(state.preview, code, ctx) };
    setState(current);
  }
  const setPreview = (preview: CodePreview) => setState(s => ({ ...s, preview }));
  const [withPreview, setWithPreview] = useState(true);
  const preview = current.preview;
  return { preview, setPreview, withPreview, setWithPreview, keep: withPreview ? preview : undefined };
}

// ── a. Write your own ───────────────────────────────────────────────────────

const STARTERS: Array<{ label: string; code: string }> = [
  { label: 'A curve to plot', code: '// y = f(x): try pow, sin, smoothstep…\nfloat f(float x) {\n  return smoothstep(0.2, 0.8, x);\n}' },
  { label: 'A shape', code: '// A signed distance: negative inside the circle\nfloat circle(vec2 p, float r) {\n  return length(p) - r;\n}' },
  { label: 'Colour from position', code: '// uv runs from -1 to 1 across the canvas\nvec3 col = vec3(uv * 0.5 + 0.5, 0.5 + 0.5 * sin(u_time));' },
  { label: 'Book of Shaders style', code: '// st runs from 0 to 1; x is st.x\nfloat y = pow(x, 5.0);\nvec3 col = vec3(y);' },
];

function WriteRoute({ compact, onPick }: { compact: boolean; onPick: (p: CodePick) => void }) {
  const tk = useTokens();
  const [language, setLanguage] = useState<'glsl' | 'js'>('glsl');
  const [code, setCode] = useState(STARTERS[0].code);
  const [debounced, setDebounced] = useState(code);
  useEffect(() => { const t = window.setTimeout(() => setDebounced(code), 250); return () => window.clearTimeout(t); }, [code]);
  const { preview, setPreview, withPreview, setWithPreview, keep } = usePickPreview(debounced, NO_CONTEXT);
  const glsl = language === 'glsl';
  return (
    <RouteBody
      footer={<Button variant="primary" icon="plus" disabled={!code.trim()} onClick={() => onPick({ language, code, ...(glsl && keep ? { preview: keep } : {}) })}>Insert</Button>}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 14, minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <Segmented size="sm" ariaLabel="Language" value={language} onChange={setLanguage} options={[{ value: 'glsl', label: 'GLSL' }, { value: 'js', label: 'JavaScript', title: 'Shown as code, without a preview' }]} />
          {glsl && <span style={{ color: tk.text.faint, font: `500 11.5px ${fontFamily.ui}` }}>Start from:</span>}
          {glsl && STARTERS.map(s => <Chip key={s.label} mono={false} active={code === s.code} onClick={() => setCode(s.code)}>{s.label}</Chip>)}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: compact ? 'minmax(0, 1fr)' : 'minmax(0, 1.1fr) minmax(0, 1fr)', gap: 14, alignItems: 'start' }}>
          <CodeField
            ariaLabel={glsl ? 'Your GLSL' : 'Your JavaScript'}
            title={glsl ? 'GLSL' : 'JavaScript'}
            value={code}
            onChange={setCode}
            completions={glsl ? GLSL_COMPLETIONS : []}
            tokenize={glsl ? undefined : tokenizeJsLine}
            autoIndent
            minHeight={compact ? 160 : 260}
            maxHeight={compact ? 280 : 420}
            placeholder={glsl ? '// A function, a few lines from main(), or a whole shader' : '// JavaScript'}
          />
          {glsl ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
              <PreviewSwitch preview={preview} withPreview={withPreview} setWithPreview={setWithPreview} />
              {preview && withPreview && <CodePreviewPane code={debounced} settings={preview} context={NO_CONTEXT} onSettings={setPreview} compact={compact} />}
              <div style={{ color: tk.text.faint, font: `500 11.5px/1.5 ${fontFamily.ui}` }}>
                Names you can use without declaring them: <code>uv</code>, <code>st</code>, <code>x</code>, <code>t</code>, <code>u_time</code>, <code>u_mouse</code>. A number nothing declares becomes a slider.
              </div>
            </div>
          ) : <div style={{ color: tk.text.muted, font: `500 12px/1.5 ${fontFamily.ui}` }}>JavaScript is shown as code. For code that runs on a picture, quote a Play’s Script layer under <b>From a shader</b>.</div>}
        </div>
      </div>
    </RouteBody>
  );
}

// ── b. Functions ────────────────────────────────────────────────────────────

interface FnEntry {
  id: string;
  name: string;
  signature: string;
  returnType: string;
  where: string;
  group: 'library' | 'shaders';
  code: string;
  note: string;
  thumb?: Parameters<typeof FnThumbnail>[0]['preset'];
}

const SHADERS_KEY = 'shader-studio:glsl-shaders';
function savedShaders(): Array<{ id: string; name: string; code: string }> {
  try {
    const list = JSON.parse(localStorage.getItem(SHADERS_KEY) ?? '[]') as Array<{ id: string; name: string; code: string }>;
    return Array.isArray(list) ? list.filter(s => s && typeof s.code === 'string') : [];
  } catch { return []; }
}

function useFunctionEntries(): FnEntry[] {
  return useMemo(() => {
    const out: FnEntry[] = [];
    for (const p of loadCustomFns()) {
      const f = presetFunctionCode(p);
      out.push({ id: `p:${p.id}`, name: p.label, signature: f.signature, returnType: p.outputType, where: 'Functions library', group: 'library', code: f.code, note: p.comment?.trim() || `From your Functions library: “${p.label}”`, thumb: p });
    }
    const shaders = savedShaders();
    if (shaders.length) {
      const found: DiscoveredFn[] = discoverFunctions(shaders, { allowGlobals: false }).matches;
      for (const f of found) {
        const preset = toCustomFnPreset(f);
        out.push({
          id: `d:${f.id}`, name: f.name, signature: f.signature, returnType: f.returnType, where: f.sourceName, group: 'shaders', code: bundleText(f),
          note: defaultComment(f), ...(preset.ok ? { thumb: { ...preset.data, preview: undefined } } : {}),
        });
      }
    }
    return out;
  }, []);
}

function FunctionsRoute({ compact, onPick }: { compact: boolean; onPick: (p: CodePick) => void }) {
  const tk = useTokens();
  const all = useFunctionEntries();
  const [q, setQ] = useState('');
  const [group, setGroup] = useState<'all' | 'library' | 'shaders'>('all');
  const [returns, setReturns] = useState<string | null>(null);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return all.filter(e => (group === 'all' || e.group === group) && (!returns || e.returnType === returns) && (!s || e.name.toLowerCase().includes(s) || e.signature.toLowerCase().includes(s) || e.where.toLowerCase().includes(s)));
  }, [all, q, group, returns]);
  const [picked, setPicked] = useState<string | null>(null);
  const entry = list.find(e => e.id === picked) ?? list[0];
  const { preview, setPreview, withPreview, setWithPreview, keep } = usePickPreview(entry?.code ?? '', NO_CONTEXT);
  const insert = () => entry && onPick({
    language: 'glsl', code: entry.code,
    origin: { kind: 'discovery', label: `${entry.name}${entry.group === 'shaders' ? '()' : ''} · ${entry.where}`, note: entry.note },
    ...(keep ? { preview: keep } : {}),
  });
  const counts = { library: all.filter(e => e.group === 'library').length, shaders: all.filter(e => e.group === 'shaders').length };
  return (
    <RouteBody footer={<Button variant="primary" icon="plus" disabled={!entry} onClick={insert}>Insert</Button>}>
      <Split compact={compact}
        left={(
          <>
            <div style={{ padding: '12px 12px 6px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Field height={32} leading={<Icon name="search" size={13} />} value={q} placeholder="Search functions" onChange={e => setQ(e.target.value)} aria-label="Search functions" />
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                <Chip mono={false} active={group === 'all'} onClick={() => setGroup('all')}>All</Chip>
                <Chip mono={false} active={group === 'library'} onClick={() => setGroup('library')} title="Functions you kept (Custom Function presets)">Library · {counts.library}</Chip>
                <Chip mono={false} active={group === 'shaders'} onClick={() => setGroup('shaders')} title="Found in your saved GLSL shaders by Function Discovery">Saved shaders · {counts.shaders}</Chip>
              </div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {['float', 'vec2', 'vec3', 'vec4'].map(t => <Chip key={t} active={returns === t} onClick={() => setReturns(r => (r === t ? null : t))} title={`Returns ${t}`}>{t}</Chip>)}
              </div>
            </div>
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingBottom: 8 }}>
              {!all.length && <Empty>No functions yet. Keep some from the GLSL page’s <b>Discover functions</b>, or save a Custom Function node as a preset, and they appear here.</Empty>}
              {all.length > 0 && !list.length && <Empty>Nothing matches.</Empty>}
              {list.map(e => (
                <PickRow key={e.id} on={entry?.id === e.id} onPick={() => setPicked(e.id)}
                  lead={e.thumb ? <FnThumbnail preset={e.thumb} size={30} /> : <span style={{ width: 30, height: 30, flexShrink: 0, borderRadius: radius.xs, background: tk.bg.field, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="fn" size={16} style={{ color: tk.kind.fn }} /></span>}
                  title={<span style={{ fontFamily: fontFamily.mono, fontSize: 12 }}>{e.signature}</span>} detail={e.where} />
              ))}
            </div>
          </>
        )}
        right={entry ? (
          <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ color: tk.text.muted, font: `500 12px/1.45 ${fontFamily.ui}` }}>{entry.note}</div>
            <PickedCode code={entry.code} from={entry.where} context={NO_CONTEXT} preview={preview} setPreview={setPreview} withPreview={withPreview} setWithPreview={setWithPreview} compact={compact} />
          </div>
        ) : null}
      />
    </RouteBody>
  );
}

// ── c. A node's code ────────────────────────────────────────────────────────

function NodesRoute({ compact, onPick }: { compact: boolean; onPick: (p: CodePick) => void }) {
  const tk = useTokens();
  const [q, setQ] = useState('');
  const all = useMemo(() => listNodeTypes(''), []);
  const categories = useMemo(() => [...new Set(all.map(n => n.category))], [all]);
  const [category, setCategory] = useState<string>('');
  const list = useMemo(() => (q.trim() ? listNodeTypes(q) : all.filter(n => !category || n.category === category)), [q, all, category]);
  const [picked, setPicked] = useState<string | null>(null);
  const type = list.find(n => n.type === picked)?.type ?? list[0]?.type;
  const info = useMemo(() => (type ? nodeCode(type) : null), [type]);
  const [parts, setParts] = useState<NodeCodeParts>({ functions: true, body: true, sockets: false });
  const [asCaption, setAsCaption] = useState(true);
  const code = info ? nodeCodeText(info, parts) : '';
  const { preview, setPreview, withPreview, setWithPreview, keep } = usePickPreview(code, NO_CONTEXT);
  const insert = () => info && code.trim() && onPick({
    language: 'glsl', code,
    origin: { kind: 'node', label: `${info.label} · node`, note: `The ${info.label} node’s code (${info.category})${parts.body ? ', with its default settings' : ''}`, nodeType: info.type },
    ...(asCaption && info.howItWorks ? { caption: info.howItWorks } : {}),
    ...(keep ? { preview: keep } : {}),
  });
  const cell: React.CSSProperties = { padding: '3px 8px 3px 0', verticalAlign: 'top' };
  const sockets = (title: string, rows: Array<{ key: string; label: string; type: string; hint?: string; value?: string }>) => rows.length > 0 && (
    <div>
      <div style={{ color: tk.text.faint, font: `700 10px ${fontFamily.ui}`, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>{title}</div>
      <table style={{ borderCollapse: 'collapse', width: '100%', font: `500 12px/1.4 ${fontFamily.ui}`, color: tk.text.secondary }}>
        <tbody>
          {rows.map(r => (
            <tr key={r.key}>
              <td style={{ ...cell, width: 44 }}><TypeBadge type={r.type} /></td>
              <td style={{ ...cell, color: tk.text.primary, fontWeight: 600, whiteSpace: 'nowrap' }}>{r.label}</td>
              <td style={{ ...cell, color: tk.text.muted }}>{[r.value && `= ${r.value}`, r.hint].filter(Boolean).join(' · ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  return (
    <RouteBody footer={<Button variant="primary" icon="plus" disabled={!info || !code.trim()} onClick={insert}>Insert</Button>}>
      <Split compact={compact}
        left={(
          <>
            <div style={{ padding: '12px 12px 6px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Field height={32} leading={<Icon name="search" size={13} />} value={q} placeholder="Search nodes by name" onChange={e => setQ(e.target.value)} aria-label="Search nodes" />
              {!q.trim() && <Select ariaLabel="Category" value={category} onChange={setCategory} options={[{ value: '', label: `Every category (${all.length})` }, ...categories.map(c => ({ value: c, label: c }))]} />}
            </div>
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingBottom: 8 }}>
              {!list.length && <Empty>No node matches.</Empty>}
              {list.map(n => <PickRow key={n.type} on={type === n.type} onPick={() => setPicked(n.type)} title={n.label} detail={n.category} />)}
            </div>
          </>
        )}
        right={info ? (
          <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ color: tk.text.primary, font: `650 15px ${fontFamily.ui}` }}>{info.label}</span>
                <span style={{ color: tk.text.faint, font: `500 12px ${fontFamily.ui}` }}>{info.category}{info.subcategory ? ` · ${info.subcategory}` : ''}</span>
              </div>
              <div style={{ marginTop: 4, color: tk.text.secondary, font: `500 12.5px/1.5 ${fontFamily.ui}` }}><b style={{ color: tk.text.primary }}>How it works.</b> {info.howItWorks}</div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: compact ? '1fr' : '1fr 1fr', gap: 12 }}>
              {sockets('Inputs', info.inputs)}
              {sockets('Outputs', info.outputs)}
            </div>
            {info.params.length > 0 && sockets('Settings', info.params.map(p => ({ key: p.key, label: p.label, type: 'set', value: p.value, hint: [p.range, p.hint].filter(Boolean).join(' · ') })))}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px' }}>
              <Toggle checked={parts.functions} disabled={!info.functions} onChange={v => setParts(p => ({ ...p, functions: v }))} label="Helper functions" />
              <Toggle checked={parts.body} disabled={!info.body} onChange={v => setParts(p => ({ ...p, body: v }))} label="Its lines in main()" />
              <Toggle checked={parts.sockets} onChange={v => setParts(p => ({ ...p, sockets: v }))} label="Inputs and outputs, as a comment" />
              <Toggle checked={asCaption} onChange={setAsCaption} label="“How it works” as the caption" />
            </div>
            {code.trim()
              ? <PickedCode code={code} from={`${info.label} · node`} context={NO_CONTEXT} preview={preview} setPreview={setPreview} withPreview={withPreview} setWithPreview={setWithPreview} compact={compact} />
              : <Empty>Choose at least one part.</Empty>}
          </div>
        ) : <Empty>Pick a node.</Empty>}
      />
    </RouteBody>
  );
}

// ── d. From a shader ────────────────────────────────────────────────────────

const STUDIO = '__studio';

/** The shader to quote (a source's, or the Studio graph's), its parts, and what its snippets can lean on. */
function useShaderParts(studio: boolean, source: PresentSource | undefined) {
  const studioShader = useNodeGraphStore(s => s.fragmentShader);
  const studioNodes = useNodeGraphStore(s => s.nodes);
  const studioSlugs = useNodeGraphStore(s => s.nodeSlugMap);
  const studioUniforms = useNodeGraphStore(s => s.paramUniforms);
  const shader = studio ? studioShader : source?.bundle.fragmentShader ?? '';
  const nodes = useMemo(() => (studio
    ? studioNodes.flatMap(n => { const slug = studioSlugs.get(n.id); return slug ? [{ id: n.id, label: String((n.params as { label?: string }).label ?? getNodeDefinition(n.type)?.label ?? n.type), slug }] : []; })
    : source?.shader.nodes ?? []), [studio, studioNodes, studioSlugs, source]);
  const regions = useMemo(() => (shader ? shaderRegions(shader, nodes) : []), [shader, nodes]);
  const context = useMemo(() => (shader ? contextFromShader(shader, studio ? studioUniforms : source?.bundle.uniforms) : NO_CONTEXT), [shader, studio, studioUniforms, source]);
  return { shader, regions, context };
}

function ShaderRoute({ compact, onPick }: { compact: boolean; onPick: (p: CodePick) => void }) {
  const tk = useTokens();
  const sources = usePresentation(s => s.doc?.sources) ?? [];
  const studioShader = useNodeGraphStore(s => s.fragmentShader);
  const [sourceId, setSourceId] = useState<string>(() => sources[sources.length - 1]?.id ?? (studioShader ? STUDIO : ''));
  const [adding, setAdding] = useState(false);
  const addAnchor = useRef<HTMLSpanElement>(null);
  const source: PresentSource | undefined = sources.find(s => s.id === sourceId);
  const studio = sourceId === STUDIO;
  const { shader, regions, context } = useShaderParts(studio, source);
  const [showBuiltins, setShowBuiltins] = useState(false);
  const [picked, setPicked] = useState<string>('main');
  const region: ShaderRegion | undefined = regions.find(r => r.id === picked) ?? regions.find(r => r.kind === 'main') ?? regions[0];
  const [withCalls, setWithCalls] = useState(true);
  const scripts = source?.bundle.play.layers.filter(l => l.kind === 'script') ?? [];
  // A function comes with the functions it calls from the same shader (not the app's helpers: the preview brings those itself).
  const code = useMemo(() => {
    if (!region) return '';
    if (region.kind !== 'fn' || !withCalls) return region.text;
    const fns = regions.filter(r => r.kind === 'fn' && !r.builtin);
    const need: ShaderRegion[] = [];
    const visit = (r: ShaderRegion) => {
      for (const other of fns) {
        if (other === r || need.includes(other)) continue;
        const name = other.label.replace(/\(\)$/, '');
        if (new RegExp(`\\b${name}\\s*\\(`).test(r.text.replace(/^[^{]*\{/, ''))) { need.push(other); visit(other); }
      }
    };
    visit(region);
    return [...need.sort((a, b) => a.lines[0] - b.lines[0]).map(r => r.text), region.text].join('\n\n');
  }, [region, regions, withCalls]);
  const { preview, setPreview, withPreview, setWithPreview, keep } = usePickPreview(code, context);
  const title = studio ? 'the graph open in the Studio' : source?.title ?? '';
  const insert = () => {
    if (!region || !code.trim()) return;
    const first = region.lines[0] + 1, last = region.lines[region.lines.length - 1] + 1;
    const origin: CodeOrigin = {
      kind: 'shader', label: `${region.kind === 'whole' ? 'Generated shader' : region.label} · ${studio ? 'Studio graph' : source?.title ?? ''}`,
      note: `From the generated shader of ${studio ? title : `“${title}”`}, ${region.kind === 'whole' ? 'all of it' : first === last ? `line ${first}` : `lines ${first}–${last}`}`,
      ...(source ? { source: source.id } : {}),
      ...(source?.bundle.play.source ? { credit: source.bundle.play.source } : {}),
    };
    onPick({ language: 'glsl', code, origin, ...(keep ? { preview: keep } : {}) });
  };
  const insertScript = (layerId: string) => source && onPick({ language: 'js', from: { source: source.id, layerId } });
  const groups: Array<{ title: string; items: ShaderRegion[]; extra?: ReactNode }> = [
    { title: 'The shader', items: regions.filter(r => r.kind === 'whole' || r.kind === 'header' || r.kind === 'main') },
    { title: 'main(), by node', items: regions.filter(r => r.kind === 'node') },
    { title: 'Functions', items: regions.filter(r => r.kind === 'fn' && !r.builtin) },
    {
      title: 'The app’s helpers', items: showBuiltins ? regions.filter(r => r.kind === 'fn' && r.builtin) : [],
      extra: regions.some(r => r.builtin) ? <button type="button" onClick={() => setShowBuiltins(v => !v)} style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer', color: tk.accent.text, font: `600 11px ${fontFamily.ui}`, textTransform: 'none', letterSpacing: 0 }}>{showBuiltins ? 'Hide' : 'Show'}</button> : undefined,
    },
  ];
  const sourceOptions = [
    ...sources.map(s => ({ value: s.id, label: s.title })),
    ...(studioShader ? [{ value: STUDIO, label: 'The graph open in the Studio' }] : []),
  ];
  return (
    <RouteBody footer={<Button variant="primary" icon="plus" disabled={!region || !code.trim()} onClick={insert}>Insert</Button>}>
      <Split compact={compact}
        left={(
          <>
            <div style={{ padding: '12px 12px 6px', display: 'flex', gap: 6, alignItems: 'center' }}>
              {sourceOptions.length > 0
                ? <Select ariaLabel="Which shader" value={sourceId} onChange={v => { setSourceId(v); setPicked('main'); }} options={sourceOptions} style={{ flex: 1 }} />
                : <span style={{ flex: 1, color: tk.text.muted, font: `500 12px ${fontFamily.ui}` }}>No Plays in this presentation yet.</span>}
              <span ref={addAnchor} style={{ display: 'inline-flex' }}><Button size="sm" icon="plus" onClick={() => setAdding(true)} title="Take a snapshot of another Play into this presentation">Play</Button></span>
              {adding && <SourcePicker anchorRef={addAnchor} compact={compact} onPick={s => { setSourceId(s.id); setPicked('main'); setAdding(false); }} onClose={() => setAdding(false)} />}
            </div>
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingBottom: 8 }}>
              {!shader && <Empty>Add a Play (the button above) to quote its shader.</Empty>}
              {groups.map(g => (g.items.length > 0 || g.extra) && (
                <div key={g.title}>
                  <Caps extra={g.extra}>{g.title}</Caps>
                  {g.items.map(r => <PickRow key={r.id} on={region?.id === r.id} onPick={() => setPicked(r.id)} title={<span style={{ fontFamily: r.kind === 'fn' ? fontFamily.mono : undefined }}>{r.label}</span>} detail={r.detail} />)}
                </div>
              ))}
              {scripts.length > 0 && (
                <div>
                  <Caps>Script layers (JavaScript)</Caps>
                  {scripts.map(l => <PickRow key={l.id} on={false} onPick={() => insertScript(l.id)} title={l.label} detail="Insert its code; make it Live in the block settings" badge={<Icon name="plus" size={13} style={{ color: tk.text.faint }} />} />)}
                </div>
              )}
            </div>
          </>
        )}
        right={region ? (
          <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ color: tk.text.muted, font: `500 12px/1.45 ${fontFamily.ui}` }}>{region.detail}</div>
            {region.kind === 'fn' && <Toggle checked={withCalls} onChange={setWithCalls} label="With the functions it calls" />}
            <PickedCode code={code} from={`${region.label} · ${studio ? 'Studio graph' : source?.title ?? ''}`} context={context} preview={preview} setPreview={setPreview} withPreview={withPreview} setWithPreview={setWithPreview} compact={compact} />
          </div>
        ) : null}
      />
    </RouteBody>
  );
}

// ── Layout ──────────────────────────────────────────────────────────────────

function Split({ left, right, compact }: { left: ReactNode; right: ReactNode; compact: boolean }) {
  const tk = useTokens();
  if (compact) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1, overflowY: 'auto' }}>
        {/* The list keeps its height (a column that scrolls would squash it); the details scroll with the dialog. */}
        <div style={{ display: 'flex', flexDirection: 'column', height: '38dvh', flexShrink: 0, borderBottom: `1px solid ${tk.border.subtle}` }}>{left}</div>
        <div style={{ flexShrink: 0 }}>{right}</div>
      </div>
    );
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '300px minmax(0, 1fr)', flex: 1, minHeight: 0 }}>
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, borderRight: `1px solid ${tk.border.subtle}` }}>{left}</div>
      <div style={{ minHeight: 0, overflowY: 'auto' }}>{right}</div>
    </div>
  );
}

/** The route's content with its own Insert at the bottom. */
function RouteBody({ children, footer }: { children: ReactNode; footer: ReactNode }) {
  const tk = useTokens();
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>{children}</div>
      <div style={{ flexShrink: 0, display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '10px 14px', borderTop: `1px solid ${tk.border.subtle}` }}>{footer}</div>
    </div>
  );
}

export function AddCodeDialog({ compact, initial = 'write', replacing = false, onPick, onClose }: {
  compact: boolean;
  initial?: CodeRoute;
  /** Changing an existing block's code (the settings panel), not adding one. */
  replacing?: boolean;
  onPick: (p: CodePick) => void;
  onClose: () => void;
}) {
  const tk = useTokens();
  const [route, setRoute] = useState<CodeRoute>(initial);
  const pick = (p: CodePick) => { onPick(p); onClose(); };
  const body = route === 'write' ? <WriteRoute compact={compact} onPick={pick} />
    : route === 'functions' ? <FunctionsRoute compact={compact} onPick={pick} />
    : route === 'nodes' ? <NodesRoute compact={compact} onPick={pick} />
    : <ShaderRoute compact={compact} onPick={pick} />;
  return (
    <Modal title={replacing ? 'Replace the code' : 'Add code'} subtitle="Write it, or take it from a function, a node or a shader" icon="code" onClose={onClose} width={compact ? 760 : 1040} height={compact ? undefined : 680} closeOnScrim={false}>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: compact ? 'column' : 'row', height: compact ? 'calc(100dvh - 110px)' : '100%' }}>
        <div role="tablist" aria-label="Where the code comes from" style={{
          flexShrink: 0, display: 'flex', flexDirection: compact ? 'row' : 'column', gap: 2, padding: compact ? '8px 10px' : 10,
          overflowX: compact ? 'auto' : undefined, width: compact ? undefined : 190, borderRight: compact ? undefined : `1px solid ${tk.border.subtle}`, borderBottom: compact ? `1px solid ${tk.border.subtle}` : undefined,
        }}>
          {ROUTES.map(r => {
            const on = r.id === route;
            return (
              <button key={r.id} type="button" role="tab" aria-selected={on} onClick={() => setRoute(r.id)} title={r.hint}
                style={{
                  display: 'flex', alignItems: compact ? 'center' : 'flex-start', gap: 9, padding: compact ? '6px 10px' : '9px 10px', border: 0, borderRadius: radius.md, cursor: 'pointer', textAlign: 'left', flexShrink: 0,
                  background: on ? alpha(tk.accent.base, 0.12) : 'transparent', color: on ? tk.accent.text : tk.text.secondary,
                }}>
                <Icon name={r.icon} size={15} style={{ flexShrink: 0, marginTop: compact ? 0 : 1 }} />
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ font: `600 12.5px ${fontFamily.ui}`, whiteSpace: 'nowrap' }}>{r.label}</span>
                  {!compact && <span style={{ font: `500 11px/1.35 ${fontFamily.ui}`, color: tk.text.faint }}>{r.hint}</span>}
                </span>
              </button>
            );
          })}
        </div>
        <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>{body}</div>
      </div>
    </Modal>
  );
}
