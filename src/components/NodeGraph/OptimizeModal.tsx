/**
 * OptimizeModal — "Optimise graph": choose the strategy's settings, see what
 * would fold (how many cards into how many blocks, each run named), see the
 * picture before and after side by side with a Same / Differs verdict, then
 * apply as one undo step. Cards a Play control targets, keyframed cards,
 * sources, constants and colours are never folded.
 */
import { useCallback, useMemo, useState } from 'react';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { optimizeGraph, playProtectedIds } from '../../optimize/optimizeGraph';
import { compileGraph } from '../../compiler/graphCompiler';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Button } from '../ui/Button';
import { Callout } from '../ui/Callout';
import { Segmented, Toggle } from '../ui/Choice';
import { Icon } from '../ui/Icon';
import { Modal } from '../ui/Modal';
import { toast } from '../ui/toastStore';
import { RenderPair, type PairDiff } from '../convert/RenderPair';

export function OptimizeModal({ onClose }: { onClose: () => void }) {
  const tk = useTokens();
  const nodes = useNodeGraphStore(s => s.nodes);
  const play = useNodeGraphStore(s => s.play);
  const selectedIds = useNodeGraphStore(s => s.selectedNodeIds);
  const setNodesRewritten = useNodeGraphStore(s => s.setNodesRewritten);
  const [minChain, setMinChain] = useState<'2' | '3' | '4'>('3');
  const [keepSliders, setKeepSliders] = useState(true);
  const [onlySelected, setOnlySelected] = useState(false);
  const [diff, setDiff] = useState<PairDiff | null>(null);
  const onDiff = useCallback((d: PairDiff | null) => setDiff(d), []);

  const protect = useMemo(() => {
    const p = playProtectedIds(play);
    return p;
  }, [play]);
  const result = useMemo(() => optimizeGraph(nodes, { minChain: Number(minChain), keepSliders, protect, only: onlySelected && selectedIds.length ? new Set(selectedIds) : undefined }), [nodes, minChain, keepSliders, protect, onlySelected, selectedIds]);
  const before = useMemo(() => compileGraph({ nodes }), [nodes]);
  const after = useMemo(() => compileGraph({ nodes: result.nodes }), [result]);
  const same = diff && !('error' in diff) ? diff.max <= 2 && diff.badPct < 0.1 : null;
  const folds = result.report.folds;

  const apply = () => {
    if (!folds.length || !after.success) return;
    setNodesRewritten(result.nodes);
    toast.success(`${folds.length} ${folds.length === 1 ? 'run' : 'runs'} folded`, { message: `${result.report.before} nodes → ${result.report.after}. Undo brings the cards back.` });
    onClose();
  };

  const stat = (n: number | string, label: string) => (
    <div style={{ padding: '6px 10px', borderRadius: radius.md, background: tk.bg.field, minWidth: 64 }}>
      <div style={{ font: `700 16px ${fontFamily.ui}` }}>{n}</div>
      <div style={{ color: tk.text.faint, font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{label}</div>
    </div>
  );

  return (
    <Modal
      title="Optimise graph"
      subtitle="Runs of math cards become one Expression Block each; their sliders come along as inputs. The picture stays the same."
      icon="spark"
      width={720}
      onClose={onClose}
      footer={
        <div style={{ display: 'flex', gap: 8, width: '100%', alignItems: 'center' }}>
          <span style={{ color: tk.text.muted, fontSize: 12 }}>{folds.length ? `${result.report.before} → ${result.report.after} nodes` : 'Nothing to fold with these settings'}</span>
          <span style={{ flex: 1 }} />
          <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button size="sm" variant="primary" icon="spark" disabled={!folds.length || !after.success || same === false} onClick={apply} title={same === false ? 'The pictures differ: not applied' : 'Replace the runs with blocks (one undo step)'}>Apply</Button>
        </div>
      }
    >
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ color: tk.text.secondary, fontSize: 12.5 }}>Fold runs of at least</span>
            <Segmented size="sm" ariaLabel="Minimum run length" value={minChain} onChange={setMinChain} options={[{ value: '2', label: '2 cards' }, { value: '3', label: '3 cards' }, { value: '4', label: '4 cards' }]} />
          </div>
          <Toggle checked={keepSliders} onChange={setKeepSliders} label="Keep sliders as block inputs (off bakes the numbers)" />
          <Toggle checked={onlySelected} onChange={setOnlySelected} disabled={selectedIds.length === 0} label={selectedIds.length ? `Only the ${selectedIds.length} selected cards` : 'Only selected cards (select some first)'} />
          <div style={{ display: 'flex', gap: 8 }}>
            {stat(result.report.before, 'cards now')}
            {stat(result.report.after, 'after')}
            {stat(folds.length, folds.length === 1 ? 'block' : 'blocks')}
            {stat(folds.reduce((s, f) => s + f.sliders, 0), 'sliders kept')}
          </div>
          {!after.success && <Callout tone="warning" title="The folded graph doesn’t compile" details={(after.errors ?? []).join('\n')}>An optimiser bug most likely; nothing is applied.</Callout>}
          <div style={{ maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {folds.map(f => (
              <div key={f.blockId} style={{ padding: '6px 10px', borderRadius: radius.md, background: tk.bg.field, fontSize: 12 }}>
                <div style={{ font: `500 11.5px/1.4 ${fontFamily.mono}` }}>{f.label}</div>
                <div style={{ color: tk.text.muted, fontSize: 11.5, marginTop: 2 }}>{f.nodeIds.length} cards → one block{f.sliders ? ` · ${f.sliders} slider${f.sliders === 1 ? '' : 's'} kept` : ''}{f.scope !== 'graph' ? ` · inside ${f.scope}` : ''}</div>
              </div>
            ))}
            {!folds.length && <div style={{ color: tk.text.faint, fontSize: 12.5, lineHeight: 1.5 }}>No run long enough. Runs stop at sources, constants, colours, blocks and functions, groups, cards two places read, keyframed cards and cards Play controls.</div>}
          </div>
        </div>
        <div style={{ flexShrink: 0 }}>
          {before.success && after.success && folds.length > 0 ? (
            <>
              <RenderPair original={before.fragmentShader} originalUniforms={before.paramUniforms} graph={after.fragmentShader} uniforms={after.paramUniforms} onDiff={onDiff} size={132} labels={['Before', 'After']} />
              <div style={{ marginTop: 8 }}>
                {diff && 'error' in diff ? <span style={{ color: tk.status.warningText, font: `600 12px ${fontFamily.ui}` }}>WebGL rejected the {diff.side === 'original' ? 'current' : 'folded'} shader</span>
                  : diff ? <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: radius.md, background: alpha(same ? tk.status.success : tk.status.warning, 0.14), color: same ? tk.status.success : tk.status.warningText, font: `600 12px ${fontFamily.ui}` }}><Icon name={same ? 'check' : 'warning'} size={14} />{same ? 'Same picture' : 'Differs'}<span style={{ marginLeft: 'auto', color: tk.text.muted, font: `500 11px ${fontFamily.mono}` }}>max {diff.max}/255</span></div>
                  : <span style={{ color: tk.text.faint, fontSize: 12 }}>Comparing…</span>}
              </div>
            </>
          ) : <div style={{ width: 274, color: tk.text.faint, fontSize: 12, lineHeight: 1.5 }}>Before and after render here once there is something to fold.</div>}
        </div>
      </div>
    </Modal>
  );
}
