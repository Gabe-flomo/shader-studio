/**
 * The function card (docs/expression-explainer.md, "Function cards"): a compact popover for the
 * function name that was clicked, hovered or pointed at with the caret: its signature(s) with
 * types, the plain meaning, a mini plot for functions of one number (with the call's own
 * numbers), what this call does, and links: How is this used?, Insert snippet, Docs. The same
 * card, for a canvas node's ⓘ, shows the node's description and its main idiom's meaning.
 *
 * Opening and closing live in triggers.ts; this only draws the card for the store's request.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { functionCard, type FunctionCardModel } from '../../../lib/glslPatterns/fnCard';
import { signatureText } from '../../../lib/glslPatterns/functions';
import { useThemeMode, useTokens } from '../../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../../theme/tokens';
import { C, C_LIGHT } from '../../glslSyntax';
import { Icon } from '../../ui/Icon';
import { GlslCode } from '../GlslCode';
import { ExplainText } from '../ExplainText';
import { TransferPlotView } from '../TransferPlotView';
import { openCodeExplorer } from '../../codeExplorer/explorerStore';
import { openExternal } from '../../../utils/openExternal';
import { useNodeGraphStore, getActiveNodes } from '../../../store/useNodeGraphStore';
import { getNodeDefinition } from '../../../nodes/definitions';
import { ExplainMore } from '../ExplainMore';
import { promptForNode } from '../../../explainModel/nodePrompt';
import { ExplainScopeProvider } from '../ExplainScope';
import { functionSource, statementAt } from '../../../explainModel/fnSource';
import { closeFunctionCard, pinFunctionCard, type AnchorRect, type CardRequest, type FunctionCardRequest, type NodeCardRequest } from './fnCardStore';
import { nodeCardModel } from './nodeCard';

const GUTTER = 16;
const GAP = 6;

/** Where the card goes: under its anchor, or over it when there is no room below; inside the window. */
export function placeCard(anchor: AnchorRect, size: { width: number; height: number }, view: { width: number; height: number }): { left: number; top: number; above: boolean } {
  const left = Math.max(GUTTER, Math.min(anchor.left, view.width - size.width - GUTTER));
  const below = anchor.top + anchor.height + GAP;
  const roomBelow = view.height - below - GUTTER;
  const roomAbove = anchor.top - GAP - GUTTER;
  const above = size.height > roomBelow && roomAbove > roomBelow;
  const top = above ? Math.max(GUTTER, anchor.top - GAP - size.height) : Math.max(GUTTER, Math.min(below, view.height - size.height - GUTTER));
  return { left, top, above };
}

export function FunctionCard({ req }: { req: CardRequest }) {
  return req.kind === 'node' ? <NodeCard req={req} /> : <FnCard req={req} />;
}

function FnCard({ req }: { req: FunctionCardRequest }) {
  const model = useMemo(() => functionCard(req.code, req.pos, req.scope, { enclosing: req.enclosing }), [req.code, req.pos, req.scope, req.enclosing]);
  useEffect(() => { if (!model) closeFunctionCard(); }, [model]);
  if (!model) return null;
  return (
    <Shell req={req} label={`${model.name}: function card`} title={<FnTitle model={model} />} sub={model.kindLabel}>
      <FnBody model={model} req={req} />
    </Shell>
  );
}

function NodeCard({ req }: { req: NodeCardRequest }) {
  const node = useNodeGraphStore(s => {
    const nodes = getActiveNodes(s.nodes, s.activeGroupPath) ?? s.nodes;
    return nodes.find(n => n.id === req.nodeId) ?? s.nodes.find(n => n.id === req.nodeId);
  });
  const def = node ? getNodeDefinition(node.type) : undefined;
  const model = useMemo(() => (node && def ? nodeCardModel(node, def) : null), [node, def]);
  const tk = useTokens();
  useEffect(() => { if (!model) closeFunctionCard(); }, [model]);
  if (!model) return null;
  return (
    <Shell req={req} label={`${model.title}: node card`} title={<span style={{ font: `600 14px ${fontFamily.ui}`, color: tk.text.primary }}>{model.title}</span>} sub={model.kindLabel}>
      {model.description && <p data-fn-card-description="" style={{ margin: 0, color: tk.text.secondary, display: '-webkit-box', WebkitLineClamp: 6, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{model.description}</p>}
      {model.meaning && (
        <div data-fn-card-meaning="" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {model.meaningOf && <span style={{ font: `500 11.5px ${fontFamily.mono}` }}><GlslCode code={model.meaningOf} /></span>}
          <span style={{ color: tk.text.primary, fontWeight: 500 }}>{plainWithTicks(model.meaning)}</span>
          {model.use && <UseTag use={model.use} />}
        </div>
      )}
      {node && def && (
        <ExplainMore mode="node" text={`${node.id}:${JSON.stringify(node.params).length}`} label="Explain this node" auto={req.explain}
          build={async () => {
            const st = useNodeGraphStore.getState();
            const nodes = getActiveNodes(st.nodes, st.activeGroupPath) ?? st.nodes;
            const cur = nodes.find(n => n.id === node.id) ?? node;
            const help = def.brief?.summary ?? (Array.isArray(def.description) ? (def.description as string[]).join(' ') : def.description);
            return promptForNode(cur, nodes, { label: def.label, category: def.category, help, defaultParams: def.defaultParams as Record<string, unknown> | undefined }, t => getNodeDefinition(t)?.label);
          }} />
      )}
      <Links>
        {model.fnName && <LinkButton icon="search" onClick={() => { closeFunctionCard(); openCodeExplorer(model.fnName); }}>How is this used?</LinkButton>}
        {req.onMore && <LinkButton icon="info" onClick={() => { closeFunctionCard(); req.onMore?.(); }}>Sockets and wiring</LinkButton>}
      </Links>
    </Shell>
  );
}

/** Backticked names in plain text as code. */
function plainWithTicks(s: string): ReactNode {
  return s.split(/(`[^`]+`)/).map((p, i) => (p.startsWith('`') ? <code key={i} style={{ font: `500 0.92em ${fontFamily.mono}` }}>{p.slice(1, -1)}</code> : p));
}

function FnTitle({ model }: { model: FunctionCardModel }) {
  const pal = useThemeMode() === 'dark' ? C : C_LIGHT;
  return <span style={{ font: `600 14px ${fontFamily.mono}`, color: model.kind === 'user' || model.kind === 'unknown' ? pal.ident : pal.builtin }}>{model.name}</span>;
}

function FnBody({ model, req }: { model: FunctionCardModel; req: FunctionCardRequest }) {
  const tk = useTokens();
  const [copied, setCopied] = useState(false);
  const insert = model.snippet && req.editable && req.scope.onSnippet;
  return (
    <>
      <Signatures model={model} />
      {model.kind === 'unknown' && (
        <p style={{ margin: 0, color: tk.text.muted }}>Not a GLSL built-in or a Playfield helper, and not declared in this code.</p>
      )}
      {(model.meaning || model.plot) && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
            {model.meaning && <span data-fn-card-meaning="" style={{ color: tk.text.primary, fontWeight: 500 }}>{capFirst(model.meaning)}.</span>}
            {model.use && <UseTag use={model.use} />}
          </div>
          {model.plot && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
              <TransferPlotView plot={model.plot} resultName={model.plotExpr} />
              <span style={{ font: `500 10px ${fontFamily.ui}`, color: tk.text.faint }}>{model.plotFromCall ? 'with this call’s numbers' : 'typical values'}</span>
            </div>
          )}
        </div>
      )}
      {model.doc && <p data-fn-card-doc="" style={{ margin: 0, color: tk.text.secondary, fontStyle: 'italic' }}>{model.doc}</p>}
      {model.notInWebGL && <p style={{ margin: 0, color: tk.status.warningText, fontSize: 11.5 }}>Not available in WebGL 2 shaders, so not in Playfield’s.</p>}
      {model.here && (
        <div data-fn-card-here="" style={{ padding: '7px 9px', borderRadius: radius.md, background: tk.bg.subtle, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ font: `700 10px ${fontFamily.ui}`, letterSpacing: '0.08em', textTransform: 'uppercase', color: tk.text.faint }}>Here</span>
          <span style={{ color: tk.text.secondary }}><ExplainText segs={model.here} /></span>
        </div>
      )}
      <CardExplainMore model={model} req={req} />
      <Links>
        <LinkButton icon="search" onClick={() => { closeFunctionCard(); openCodeExplorer(model.name); }}>How is this used?</LinkButton>
        {model.snippet && (insert
          ? <LinkButton icon="plus" title={`${model.snippet.label}: ${model.snippet.doc}`} onClick={() => { const s = model.snippet!; closeFunctionCard(true); req.scope.onSnippet?.(s); }}>Insert snippet</LinkButton>
          : <LinkButton icon={copied ? 'check' : 'copy'} title={`Copy the ${model.snippet.label} snippet’s function`} onClick={() => { void navigator.clipboard?.writeText(model.snippet!.helper).then(() => setCopied(true), () => {}); }}>{copied ? 'Copied' : 'Copy snippet'}</LinkButton>)}
        {model.docs && (
          <a href={model.docs} target="_blank" rel="noopener noreferrer" onClick={e => openExternal(model.docs!, e)} style={linkStyle(tk)}>
            <Icon name="link" size={13} />Docs
          </a>
        )}
      </Links>
    </>
  );
}

/** "Explain more" in a card: a user's function as a whole, else the statement the clicked call is in. */
function CardExplainMore({ model, req }: { model: FunctionCardModel; req: FunctionCardRequest }) {
  const all = [req.code, req.scope.source].filter(Boolean).join('\n');
  const scope = useMemo(() => ({ kind: 'GLSL code', enclosing: () => req.code }), [req.code]);
  const fn = model.kind === 'user' ? functionSource(all, model.name) : null;
  const stmt = fn ? null : statementAt(req.code, req.pos);
  if (!fn && !stmt) return null;
  return (
    <ExplainScopeProvider value={scope}>
      {fn
        ? <ExplainMore mode="block" text={fn} ctx={req.scope} label="Explain this function" />
        : <ExplainMore text={stmt!} ctx={req.scope} where={`the statement calling ${model.name}`} />}
    </ExplainScopeProvider>
  );
}

const capFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function Signatures({ model }: { model: FunctionCardModel }) {
  const tk = useTokens();
  if (!model.overloads.length) return null;
  if (model.overloads.length === 1) {
    return (
      <div data-fn-card-signature="" style={{ font: `500 12px ${fontFamily.mono}`, padding: '6px 8px', borderRadius: radius.md, background: tk.bg.field }}>
        <GlslCode code={signatureText(model.name, model.overloads[0])} />
        {model.legend.length > 0 && <Legend model={model} />}
      </div>
    );
  }
  return (
    <div data-fn-card-signature="" style={{ padding: '4px 8px 6px', borderRadius: radius.md, background: tk.bg.field }}>
      <table aria-label={`${model.name} overloads`} style={{ borderCollapse: 'collapse', font: `500 11.5px ${fontFamily.mono}`, width: '100%' }}>
        <thead>
          <tr>
            <th scope="col" style={th(tk)}>returns</th>
            <th scope="col" style={th(tk)}>parameters</th>
          </tr>
        </thead>
        <tbody>
          {model.overloads.map((ov, i) => (
            <tr key={i}>
              <td style={{ padding: '2px 10px 2px 0', verticalAlign: 'top', whiteSpace: 'nowrap' }}><GlslCode code={ov.returns} /></td>
              <td style={{ padding: '2px 0', verticalAlign: 'top' }}><GlslCode code={`${model.name}(${ov.params.map(p => `${p.q ? `${p.q} ` : ''}${p.type} ${p.name}`).join(', ')})`} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      {model.legend.length > 0 && <Legend model={model} />}
    </div>
  );
}

function Legend({ model }: { model: FunctionCardModel }) {
  const tk = useTokens();
  return (
    <div style={{ marginTop: 4, font: `500 10.5px ${fontFamily.ui}`, color: tk.text.faint }}>
      {model.legend.map(l => <div key={l.type}><code style={{ font: `500 10.5px ${fontFamily.mono}` }}>{l.type}</code>: {l.means}</div>)}
    </div>
  );
}

const th = (tk: ReturnType<typeof useTokens>): CSSProperties => ({ textAlign: 'left', padding: '2px 10px 3px 0', font: `600 9.5px ${fontFamily.ui}`, letterSpacing: '0.08em', textTransform: 'uppercase', color: tk.text.faint });

function UseTag({ use }: { use: string }) {
  const tk = useTokens();
  return (
    <span data-fn-card-use="" title="What this is usually for" style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 8px', borderRadius: 9, background: alpha(tk.status.success, 0.12), color: tk.text.secondary, font: `600 11px ${fontFamily.ui}` }}>
      <Icon name="star" size={10} />{use}
    </span>
  );
}

function Links({ children }: { children: ReactNode }) {
  const tk = useTokens();
  return <div data-fn-card-links="" style={{ display: 'flex', flexWrap: 'wrap', gap: 4, paddingTop: 6, borderTop: `1px solid ${tk.border.subtle}` }}>{children}</div>;
}

const linkStyle = (tk: ReturnType<typeof useTokens>): CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', gap: 5, height: 28, padding: '0 9px', border: 0, borderRadius: radius.md, background: 'none',
  color: tk.accent.text, font: `600 12px ${fontFamily.ui}`, cursor: 'pointer', textDecoration: 'none',
});

function LinkButton({ icon, children, onClick, title }: { icon: React.ComponentProps<typeof Icon>['name']; children: ReactNode; onClick: () => void; title?: string }) {
  const tk = useTokens();
  return (
    <button type="button" onClick={onClick} title={title} style={linkStyle(tk)}
      onMouseEnter={e => { e.currentTarget.style.background = tk.bg.hover; }} onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}>
      <Icon name={icon} size={13} />{children}
    </button>
  );
}

/** The popover itself: placement, focus, and the parts every card shares. */
function Shell({ req, label, title, sub, children }: { req: CardRequest; label: string; title: ReactNode; sub: string; children: ReactNode }) {
  const tk = useTokens();
  const ref = useRef<HTMLDivElement>(null);
  const [view, setView] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const width = Math.min(380, view.width - 2 * GUTTER);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const v = { width: window.innerWidth, height: window.innerHeight };
    setView(o => (o.width === v.width && o.height === v.height ? o : v));
    const p = placeCard(req.anchor, { width, height: el.offsetHeight }, v);
    setPos(o => (o && o.left === p.left && o.top === p.top ? o : { left: p.left, top: p.top }));
  });
  useEffect(() => {
    if (req.focus) ref.current?.focus({ preventScroll: true });
  }, [req]);
  return createPortal(
    <div
      ref={ref}
      data-function-card={req.kind}
      data-card-mode={req.mode}
      data-captures-escape=""
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      onPointerDown={e => { e.stopPropagation(); pinFunctionCard(); }}
      onMouseDown={e => e.stopPropagation()}
      onWheel={e => e.stopPropagation()}
      onFocus={pinFunctionCard}
      style={{
        position: 'fixed', zIndex: 2600, left: pos?.left ?? -9999, top: pos?.top ?? -9999, width, maxHeight: view.height - 2 * GUTTER, overflowY: 'auto',
        boxSizing: 'border-box', padding: '10px 12px 8px', borderRadius: radius.lg, background: tk.bg.panel, color: tk.text.primary,
        boxShadow: `${tk.shadow.popover}, 0 0 0 1px ${tk.border.default}`, font: `12.5px/1.45 ${fontFamily.ui}`, outline: 'none',
        display: 'flex', flexDirection: 'column', gap: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          {title}
          <span style={{ font: `500 11px ${fontFamily.ui}`, color: tk.text.faint }}>{sub}</span>
        </div>
        <button type="button" aria-label="Close (Esc)" title="Close (Esc)" onClick={() => closeFunctionCard(true)}
          style={{ width: 24, height: 24, padding: 0, border: 0, borderRadius: radius.sm, background: 'none', color: tk.text.faint, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="close" size={14} />
        </button>
      </div>
      {children}
    </div>,
    document.body,
  );
}
