/**
 * ShowHowWindow — "Show me how" as a window (docs/do-bar-commands.md, "Show me how"), in the
 * manner of an Expression Block's build-up view: the command at the top, the picture it makes,
 * then each step of it with what it does, its nodes and values, and a small picture of the graph
 * after that step. Click a step (or ← / →) to show its picture big; click it again for the end.
 *
 * The steps come from suggestions/showHow.ts; the pictures are drawn the way the build-up's are,
 * through the shared preview renderer (lib/nodePreviewRenderer.ts) from the preview compile of
 * the node the Output shows (lib/compileNodePreviewShader.ts), one at a time, cached.
 */
import { useEffect, useMemo, useState } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { RecipeCode } from '../sceneBuilder/RecipeCode';
import { closeShowHow, useShowHow, type ShowHowOpen } from '../../suggestions/showHowStore';
import { openDoBar } from '../../suggestions/doBarStore';
import { showHowPlan, shownNode, type HowStep } from '../../suggestions/showHow';
import { compileNodePreviewGraph } from '../../lib/compileNodePreviewShader';
import { nodePreviewRenderer } from '../../lib/nodePreviewRenderer';
import { uniformsOf } from '../explain/buildUpHost';
import { wordKindFor } from '../../lang/highlight';
import type { GraphNode } from '../../types/nodeGraph';

const BIG = 240;
const SMALL = 88;

function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return (h >>> 0).toString(36);
}

/** A picture of what the Output shows in `nodes` (a data URL), '' when there is nothing to draw. */
async function graphPicture(nodes: GraphNode[], size: number): Promise<string> {
  const id = shownNode(nodes);
  if (!id) return '';
  let compiled: ReturnType<typeof compileNodePreviewGraph> = null;
  try { compiled = compileNodePreviewGraph(id, nodes); } catch { return ''; }
  if (!compiled) return '';
  const fs = compiled.fragmentShader;
  return nodePreviewRenderer.renderNodePreview(`showhow:${djb2(fs)}`, fs, uniformsOf(compiled.paramUniforms), size, { quiet: true });
}

/** A graph's picture, drawn once it is on screen (null while drawing). */
function usePicture(nodes: GraphNode[] | null, size: number): string | null {
  const [got, setGot] = useState<{ nodes: GraphNode[]; url: string } | null>(null);
  useEffect(() => {
    let live = true;
    if (!nodes) return;
    void graphPicture(nodes, size).then(u => { if (live) setGot({ nodes, url: u }); }).catch(() => { if (live) setGot({ nodes, url: '' }); });
    return () => { live = false; };
  }, [nodes, size]);
  if (!nodes) return '';
  return got && got.nodes === nodes ? got.url : null;
}

function Picture({ nodes, size, label }: { nodes: GraphNode[] | null; size: number; label: string }) {
  const tk = useTokens();
  const url = usePicture(nodes, size);
  const box = { width: size, height: size, borderRadius: radius.md, flexShrink: 0, background: tk.bg.subtle, boxShadow: `inset 0 0 0 1px ${tk.border.subtle}` } as const;
  if (url) return <img src={url} alt={label} width={size} height={size} data-show-how-picture style={{ ...box, objectFit: 'cover', display: 'block' }} />;
  return <span aria-label={label} style={{ ...box, display: 'flex', alignItems: 'center', justifyContent: 'center', font: `11px ${fontFamily.ui}`, color: tk.text.faint, textAlign: 'center', padding: 6, boxSizing: 'border-box' }}>{url === null ? 'Drawing…' : 'No picture yet'}</span>;
}

function StepRow({ s, i, active, onSelect, wordKind }: { s: HowStep; i: number; active: boolean; onSelect: () => void; wordKind?: ReturnType<typeof wordKindFor> }) {
  const tk = useTokens();
  return (
    <button type="button" data-show-how-step={i} aria-pressed={active} onClick={onSelect}
      style={{
        display: 'grid', gridTemplateColumns: '22px minmax(0, 1fr) auto', gap: 10, alignItems: 'start', textAlign: 'left', width: '100%', border: 0, cursor: 'pointer',
        padding: '8px 10px', borderRadius: radius.md, background: active ? alpha(tk.accent.base, 0.1) : tk.bg.subtle, color: tk.text.primary,
        boxShadow: active ? `inset 0 0 0 1.5px ${tk.accent.base}` : 'none',
      }}>
      <span style={{ width: 20, height: 20, borderRadius: 10, background: alpha(tk.accent.base, 0.16), color: tk.accent.base, font: `700 11px ${fontFamily.ui}`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{i + 1}</span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
        {s.code && <code style={{ font: `12px/1.5 ${fontFamily.mono}`, overflowWrap: 'anywhere' }}><RecipeCode text={s.code} errors={[]} wordKind={wordKind} /></code>}
        <span style={{ font: `12.5px/1.45 ${fontFamily.ui}`, color: s.code ? tk.text.secondary : tk.text.primary }}>{s.what}</span>
        {s.details.map((d, k) => <span key={k} style={{ font: `11px ${fontFamily.mono}`, color: d.startsWith('−') ? tk.text.faint : tk.text.muted, overflowWrap: 'anywhere' }}>{d}</span>)}
        {s.added.map(a => <span key={a.type} style={{ font: `11.5px ${fontFamily.ui}`, color: tk.text.muted }}>adds <b style={{ color: tk.text.secondary }}>{a.label}</b>{a.does ? ` — ${a.does}` : ''}</span>)}
      </span>
      <Picture nodes={s.nodes.length ? s.nodes : null} size={SMALL} label={`After step ${i + 1}`} />
    </button>
  );
}

function ShowHowBody({ open }: { open: ShowHowOpen }) {
  const tk = useTokens();
  const plan = useMemo(() => { try { return showHowPlan(open); } catch (e) { return { text: open.text, kind: 'none' as const, on: '', steps: [], final: [], problems: [(e as Error).message] }; } }, [open]);
  const [sel, setSel] = useState<number | null>(null);
  const wordKind = useMemo(() => (plan.kind === 'scene' ? undefined : wordKindFor('picture', 'edit')), [plan.kind]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!plan.steps.length) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); setSel(s => Math.min(plan.steps.length - 1, (s ?? -1) + 1)); }
      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); setSel(s => (s === null ? plan.steps.length - 1 : Math.max(0, s - 1))); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [plan.steps.length]);
  const shown = sel === null ? plan.final : plan.steps[sel]?.nodes ?? plan.final;
  return (
    <div data-show-how-window style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '14px 18px 18px' }}>
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <Picture nodes={shown.length ? shown : null} size={BIG} label={sel === null ? 'What it makes' : `After step ${sel + 1}`} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: '1 1 260px', minWidth: 0 }}>
          <span style={{ font: `600 10.5px ${fontFamily.ui}`, letterSpacing: '0.06em', textTransform: 'uppercase', color: tk.text.faint }}>The command</span>
          <code data-show-how-command style={{ padding: '8px 10px', borderRadius: radius.md, background: tk.bg.subtle, font: `14px/1.5 ${fontFamily.mono}`, overflowWrap: 'anywhere' }}>
            <RecipeCode text={open.label ?? plan.text} errors={[]} wordKind={wordKind} help={{ dialect: plan.kind === 'scene' ? 'scene' : 'picture' }} />
          </code>
          <span style={{ font: `12.5px/1.5 ${fontFamily.ui}`, color: tk.text.secondary }}>
            {plan.steps.length ? `${plan.steps.length} step${plan.steps.length === 1 ? '' : 's'}, on ${plan.on}.` : 'Nothing to build.'}
            {' '}{sel === null ? 'The picture is the end result; click a step to see the picture after it.' : `Showing the picture after step ${sel + 1}.`}
          </span>
          {plan.problems.map((p, i) => <span key={i} style={{ font: `12px ${fontFamily.ui}`, color: tk.status.warningText }}>{p}</span>)}
          <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {sel !== null && <Button size="sm" variant="ghost" onClick={() => setSel(null)}>Show the end result</Button>}
            {!open.nodes && <Button size="sm" variant="secondary" icon="edit" onClick={() => { closeShowHow(); openDoBar({ text: open.label ?? plan.text }); }}>Try it in the Do… bar</Button>}
          </span>
        </div>
      </div>
      {plan.steps.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ font: `600 10.5px ${fontFamily.ui}`, letterSpacing: '0.06em', textTransform: 'uppercase', color: tk.text.faint }}>Step by step</span>
          {plan.steps.map((s, i) => <StepRow key={i} s={s} i={i} active={sel === i} onSelect={() => setSel(x => (x === i ? null : i))} wordKind={wordKind} />)}
        </div>
      )}
    </div>
  );
}

/** The window (mounted with the canvas and the Commands reference). */
export function ShowHowWindow() {
  const open = useShowHow(s => s.open);
  const seq = useShowHow(s => s.seq);
  if (!open) return null;
  return (
    <Modal title="Show me how" subtitle="What the line makes, one step at a time" icon="play" width={780} height={760} onClose={closeShowHow}>
      <ShowHowBody key={seq} open={open} />
    </Modal>
  );
}
