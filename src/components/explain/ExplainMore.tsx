/**
 * ExplainMore — the "✨ Explain more" action (docs/explain-model.md): under a deterministic explanation, ask the
 * optional on-device language model why the line is there and what it does to the picture. The answer streams
 * in under a label ("explained by a local model"), with the facts it was given folded below. If the model
 * isn't downloaded yet, the action offers the one-time download (size, progress) first.
 *
 * `mode="line"` explains one statement; `mode="block"` a whole Expression Block / function (a paragraph and a
 * line-by-line list). Nothing is loaded until the button is pressed: the prompt builder and the model are
 * imported on demand.
 */
import { useEffect, useMemo, useRef } from 'react';
import type { ExplainContext } from '../../lib/glslPatterns';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Icon } from '../ui/Icon';
import { EXPLAIN_MODEL, downloadBytes, formatBytes } from '../../explainModel/config';
import { useExplainModel } from '../../explainModel/client';
import { useModelAnswer, type AskSpec } from '../../explainModel/useAnswer';
import { useExplainScope } from './ExplainScope';

export interface ExplainMoreProps {
  /** The line (mode 'line') or the whole code (mode 'block'). */
  text: string;
  ctx?: ExplainContext;
  mode?: 'line' | 'block' | 'node';
  /** Words for where the line is: "line 3 of this block". */
  where?: string;
  /** The button's words. */
  label?: string;
  /** Builds the prompt itself (a whole node); `text` then only keys the cache. */
  build?: AskSpec['build'];
  /** Ask as soon as it appears (opened from the node's Explain button). */
  auto?: boolean;
}

/** An answer as paragraphs and list items ("- …" or the block format's "3: …"). */
export function AnswerText({ text }: { text: string }) {
  const tk = useTokens();
  const parts = useMemo(() => {
    const out: Array<{ list: boolean; items: Array<{ n?: string; text: string }> }> = [];
    for (const raw of text.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      const summary = /^summary\s*:\s*(.*)$/i.exec(line);
      if (summary) { out.push({ list: false, items: [{ text: summary[1] }] }); continue; }
      const item = /^(?:([-*•])|(\d+)\s*[.):])\s*(.*)$/.exec(line);
      if (!item) { out.push({ list: false, items: [{ text: line }] }); continue; }
      const last = out[out.length - 1];
      const it = { n: item[2], text: item[3] };
      if (last?.list) last.items.push(it); else out.push({ list: true, items: [it] });
    }
    return out;
  }, [text]);
  return (
    <div data-explain-answer="" style={{ display: 'flex', flexDirection: 'column', gap: 6, font: `500 12.5px/1.55 ${fontFamily.ui}`, color: tk.text.primary }}>
      {parts.map((p, i) => p.list
        ? (
          <ul key={i} style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 3 }}>
            {p.items.map((it, j) => (
              <li key={j} style={{ display: 'flex', gap: 8 }}>
                <span style={{ flexShrink: 0, minWidth: 16, color: tk.text.faint, font: `600 11px/1.9 ${fontFamily.mono}` }}>{it.n ?? '•'}</span>
                <span style={{ minWidth: 0 }}><Code text={it.text} /></span>
              </li>
            ))}
          </ul>
        )
        : <p key={i} style={{ margin: 0 }}><Code text={p.items.map(x => x.text).join(' ')} /></p>)}
    </div>
  );
}

/** `backticked` words as code. */
function Code({ text }: { text: string }) {
  return <>{text.split(/(`[^`]+`)/).map((s, i) => (s.startsWith('`') && s.endsWith('`') && s.length > 2 ? <code key={i} style={{ font: `500 0.92em ${fontFamily.mono}` }}>{s.slice(1, -1)}</code> : s))}</>;
}

export function ExplainMore({ text, ctx, mode = 'line', where, label, build, auto }: ExplainMoreProps) {
  const tk = useTokens();
  const scope = useExplainScope();
  const model = useExplainModel();
  const { state, ask, confirmDownload, stop, dismiss } = useModelAnswer();

  const spec: AskSpec = {
    kind: mode,
    code: text,
    build: build ?? (async () => {
      const [prompt, { getNodeDefinition }] = await Promise.all([import('../../explainModel/prompt'), import('../../nodes/definitions')]);
      const s = {
        nodeId: scope.nodeId, kind: scope.kind, nodes: scope.getNodes?.(), enclosing: scope.enclosing?.(), where,
        namer: (t: string) => getNodeDefinition(t)?.label, ctx,
      };
      return mode === 'block' ? prompt.promptForBlock(text, s) : prompt.promptForLine(text, s);
    }),
  };
  const autoDone = useRef(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when opened to explain
  useEffect(() => { if (auto && !autoDone.current) { autoDone.current = true; void ask(spec); } }, [auto]);

  const small: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 5, height: 26, padding: '0 9px', border: 0, borderRadius: radius.sm,
    background: tk.bg.field, color: tk.text.secondary, cursor: 'pointer', font: `600 11.5px ${fontFamily.ui}`, flexShrink: 0,
  };
  const quiet: React.CSSProperties = { ...small, background: 'none', color: tk.accent.text };
  const pct = model.progress ? Math.round((100 * model.progress.loaded) / Math.max(1, model.progress.total)) : null;
  const downloading = model.status === 'loading' && !!model.progress;
  const busy = state.phase === 'working';

  return (
    <div data-explain-more="" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {state.phase === 'idle' && (
        <button type="button" data-explain-action="explain-more" style={{ ...small, alignSelf: 'flex-start' }} onClick={() => { void ask(spec); }}
          title="Ask the small language model on this device why this is here and what it does to the picture">
          <Icon name="spark" size={12} />{label ?? (mode === 'block' ? 'Explain this block' : mode === 'node' ? 'Explain this node' : 'Explain more')}
        </button>
      )}

      {state.phase === 'offer' && !downloading && (
        <div data-explain-offer="" style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 10px', borderRadius: radius.md, background: alpha(tk.accent.base, 0.07) }}>
          <span style={{ font: `600 12px ${fontFamily.ui}`, color: tk.text.primary }}>
            {model.downloaded ? 'The explanation model is off.' : 'Explain more needs a small language model on this device.'}
          </span>
          <span style={{ font: `500 11.5px/1.5 ${fontFamily.ui}`, color: tk.text.muted }}>
            {model.downloaded
              ? 'Turn it on to use the copy this browser already keeps.'
              : `A one-time download of ${formatBytes(downloadBytes())} (${EXPLAIN_MODEL.name}, ${EXPLAIN_MODEL.licence}). After that it runs here, offline: your code never leaves this device.`}
          </span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" data-explain-action="download-model" style={{ ...small, background: tk.ink.base, color: tk.ink.text }} onClick={() => { void confirmDownload(); }}>
              <Icon name="import" size={12} />{model.downloaded ? 'Turn it on' : `Download ${formatBytes(downloadBytes())} and explain`}
            </button>
            <button type="button" style={quiet} onClick={dismiss}>Not now</button>
          </div>
        </div>
      )}

      {(downloading || (state.phase === 'offer' && model.status === 'loading')) && (
        <div data-explain-download-progress="" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ flex: 1, maxWidth: 260, height: 6, borderRadius: 3, background: tk.bg.field, overflow: 'hidden' }}>
            <span style={{ display: 'block', height: '100%', width: `${pct ?? 100}%`, background: tk.accent.base, transition: 'width 120ms' }} />
          </span>
          <span style={{ font: `500 11.5px ${fontFamily.ui}`, color: tk.text.muted }}>
            {model.progress ? `Downloading ${formatBytes(model.progress.loaded)} of ${formatBytes(model.progress.total)}` : 'Loading the model…'}
          </span>
        </div>
      )}

      {(busy || state.phase === 'done' || (state.phase === 'failed' && state.text)) && (
        <div data-explain-model="" style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 10px', borderRadius: radius.md, background: alpha(tk.accent.base, 0.06), border: `1px solid ${alpha(tk.accent.base, 0.18)}` }}>
          <span data-explain-model-label="" style={{ display: 'flex', alignItems: 'center', gap: 5, font: `650 10px ${fontFamily.ui}`, letterSpacing: '0.06em', textTransform: 'uppercase', color: tk.text.faint }}>
            <Icon name="spark" size={10} />Explained by a local model
            <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}>· {EXPLAIN_MODEL.name}{model.backend ? ` on ${model.backend === 'webgpu' ? 'WebGPU' : 'WebAssembly'}` : ''}{state.cached ? ' · from this session' : ''} · can be wrong</span>
          </span>
          {state.text
            ? <AnswerText text={state.text} />
            : <span style={{ font: `500 12px ${fontFamily.ui}`, color: tk.text.muted }}>{model.status === 'loading' ? 'Loading the model…' : 'Thinking…'}</span>}
          {busy && <span aria-hidden style={{ alignSelf: 'flex-start', width: 6, height: 12, background: tk.accent.base, opacity: 0.6 }} />}
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {busy
              ? <button type="button" style={quiet} onClick={stop}>Stop</button>
              : <button type="button" style={quiet} onClick={() => { void ask(spec); }}>Ask again</button>}
            {!busy && <button type="button" style={quiet} onClick={dismiss}>Hide</button>}
          </div>
          {state.used.length > 0 && (
            <details data-explain-facts="" style={{ font: `500 11.5px/1.5 ${fontFamily.ui}`, color: tk.text.muted }}>
              <summary style={{ cursor: 'pointer', color: tk.text.faint, fontWeight: 600 }}>Facts it was given ({state.used.length})</summary>
              <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{state.used.map((u, i) => <li key={i}>{u}</li>)}</ul>
            </details>
          )}
        </div>
      )}

      {state.phase === 'failed' && (
        <div role="alert" data-explain-failed="" style={{ display: 'flex', alignItems: 'center', gap: 8, font: `500 11.5px ${fontFamily.ui}`, color: tk.status.danger }}>
          <span style={{ flex: 1 }}>{state.error ?? 'The model failed.'}</span>
          <button type="button" style={quiet} onClick={() => { void ask(spec); }}>Try again</button>
          <button type="button" style={quiet} onClick={dismiss}>Hide</button>
        </div>
      )}
    </div>
  );
}
