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
import { downloadBytes, formatBytes, modelById } from '../../explainModel/config';
import { useExplainModel } from '../../explainModel/client';
import { useModelAnswer, type AskSpec } from '../../explainModel/useAnswer';
import { viewAnswer } from '../../explainModel/assess';
import { useExplainScope } from './ExplainScope';
import { AnswerBody, ComparePanel } from './ExplainAnswer';
import { useElapsed } from './useElapsed';

export { AnswerText } from './ExplainAnswer';

export interface ExplainMoreProps {
  /** The line (mode 'line') or the whole code (mode 'block'). */
  text: string;
  ctx?: ExplainContext;
  mode?: 'line' | 'block' | 'node' | 'steps';
  /** mode 'steps': the line's rule-based steps, explained one by one. */
  steps?: Array<{ label: string; code: string; reading: string }>;
  /** Words for where the line is: "line 3 of this block". */
  where?: string;
  /** The button's words. */
  label?: string;
  /** Builds the prompt itself (a whole node); `text` then only keys the cache. */
  build?: AskSpec['build'];
  /** Ask as soon as it appears (opened from the node's Explain button). */
  auto?: boolean;
}

export function ExplainMore({ text, ctx, mode = 'line', where, label, build, auto, steps }: ExplainMoreProps) {
  // Steps are a numbered list, read and checked like a block's lines.
  const kind: 'line' | 'block' | 'node' = mode === 'steps' ? 'block' : mode;
  const tk = useTokens();
  const scope = useExplainScope();
  const model = useExplainModel();
  const { state, ask, confirmDownload, stop, dismiss, doubleCheck, compare, closeCompare } = useModelAnswer();
  const active = modelById(model.activeId);
  const elapsed = useElapsed(state.phase === 'working' ? state.startedAt : undefined);
  const view = useMemo(() => viewAnswer({
    kind, raw: state.meta?.raw ?? state.text, tokens: state.meta?.tokens, check: state.check, lineNo: state.lineNo, samples: state.samples, done: state.phase === 'done',
  }), [kind, state.text, state.meta, state.check, state.lineNo, state.samples, state.phase]);

  const spec: AskSpec = {
    kind,
    code: mode === 'steps' ? `steps:${text}` : text,
    build: build ?? (async () => {
      const [prompt, { getNodeDefinition }] = await Promise.all([import('../../explainModel/prompt'), import('../../nodes/definitions')]);
      const s = {
        nodeId: scope.nodeId, kind: scope.kind, nodes: scope.getNodes?.(), enclosing: scope.enclosing?.(), where,
        namer: (t: string) => getNodeDefinition(t)?.label, ctx,
        describe: (t: string) => {
          const d = getNodeDefinition(t);
          return d ? { label: d.label, description: d.description, outputs: Object.fromEntries(Object.entries(d.outputs ?? {}).map(([k, v]) => [k, v.label])) } : undefined;
        },
      };
      if (mode === 'steps') return prompt.promptForSteps(text, steps ?? [], s);
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
          <Icon name="spark" size={12} />{label ?? (mode === 'block' ? 'Explain this block' : mode === 'node' ? 'Explain this node' : mode === 'steps' ? 'Explain these steps' : 'Explain more')}
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
              : `A one-time download of ${formatBytes(downloadBytes('webgpu', active))} (${active.name}, ${active.licence}). After that it runs here, offline: your code never leaves this device.`}
          </span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" data-explain-action="download-model" style={{ ...small, background: tk.ink.base, color: tk.ink.text }} onClick={() => { void confirmDownload(); }}>
              <Icon name="import" size={12} />{model.downloaded ? 'Turn it on' : `Download ${formatBytes(downloadBytes('webgpu', active))} and explain`}
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
            <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}>· {active.name}{model.backend ? ` on ${model.backend === 'webgpu' ? 'WebGPU' : 'WebAssembly'}` : ''}{state.cached ? ' · from this session' : ''} · can be wrong</span>
          </span>
          {view.split.thinkingNow && busy
            ? <span data-explain-thinking="" style={{ font: `500 12px ${fontFamily.ui}`, color: tk.text.muted }}>Thinking… {elapsed} s</span>
            : view.empty
              ? <span style={{ font: `500 12px ${fontFamily.ui}`, color: tk.text.muted }}>{view.ranOut ? 'It used up its thinking budget before answering. Try again, or pick a faster model.' : model.status === 'loading' ? 'Loading the model…' : `Thinking…${busy && active.thinks ? ` ${elapsed} s` : ''}`}</span>
              : <AnswerBody view={view} mode={kind} labels={mode === 'steps' ? steps?.map(x => x.label) : undefined} />}
          {view.split.thinking && (
            <details data-explain-reasoning="" style={{ font: `500 11.5px/1.5 ${fontFamily.ui}`, color: tk.text.muted }}>
              <summary style={{ cursor: 'pointer', color: tk.text.faint, fontWeight: 600 }}>Show reasoning</summary>
              <div style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap', maxHeight: 220, overflow: 'auto', fontFamily: fontFamily.mono, fontSize: 11 }}>{view.split.thinking}</div>
            </details>
          )}
          {busy && !view.split.thinkingNow && <span aria-hidden style={{ alignSelf: 'flex-start', width: 6, height: 12, background: tk.accent.base, opacity: 0.6 }} />}
          {state.phase === 'done' && state.meta && (
            <span data-explain-timing="" style={{ font: `500 10.5px ${fontFamily.ui}`, color: tk.text.faint }}>
              {(state.meta.ms / 1000).toFixed(1)} s{state.meta.tokensPerSec ? ` · ${state.meta.tokensPerSec} tokens a second` : ''}{state.samples ? ' · double-checked' : ''}
            </span>
          )}
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {busy
              ? <button type="button" style={quiet} onClick={stop}>Stop</button>
              : <button type="button" style={quiet} onClick={() => { void ask(spec); }}>Ask again</button>}
            {!busy && mode !== 'node' && !state.samples && (
              <button type="button" data-explain-action="double-check" style={quiet} disabled={state.checking} onClick={() => { void doubleCheck(); }}
                title="Ask twice more at a looser setting and see whether the answers agree. Slower.">
                {state.checking ? 'Double-checking…' : 'Double-check'}
              </button>
            )}
            {!busy && model.downloadedIds.length > 1 && (
              <button type="button" data-explain-action="compare-models" style={quiet} onClick={() => { void compare(); }}
                title="Ask every downloaded model the same question, one after another, and show the answers side by side">
                Compare models
              </button>
            )}
            {!busy && <button type="button" style={quiet} onClick={dismiss}>Hide</button>}
          </div>
          {state.compare && <ComparePanel entries={state.compare} mode={kind} state={state} onClose={closeCompare} />}
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
