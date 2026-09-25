/**
 * PlayParamActions — make a graph param a Play control (or a control with a
 * null that drives it) from where the param is edited. The phone Studio puts
 * these in a slider's settings; the desktop graph has them on right-click.
 */
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { candidateFor, candidateLabel, collectPlayCandidates } from '../../play/playControls';
import { addCandidateControl, driveWithNull, graphNullDrives } from './layerOps';
import { toast } from '../ui/toastStore';
import { Button } from '../ui/Button';
import { useTokens } from '../../theme/themeStore';

const openPlay = { label: 'Open Play', onClick: () => useNodeGraphStore.setState(s => ({ playOpenRequest: s.playOpenRequest + 1 })) };

export function PlayParamActions({ nodeId, paramKey }: { nodeId: string; paramKey: string }) {
  const tk = useTokens();
  const nodes = useNodeGraphStore(s => s.nodes);
  const bindings = useNodeGraphStore(s => s.paramBindings);
  const setPlay = useNodeGraphStore(s => s.setPlay);
  const candidates = collectPlayCandidates(nodes, bindings);
  const c = candidateFor(candidates, nodeId, paramKey);
  const taken = useNodeGraphStore(s => !!c && s.play.controls.some(x => x.target === c.target));
  if (!c) return <span style={{ fontSize: 12, color: tk.text.faint }}>Baked into the shader: can’t be a Play control.</span>;
  return (
    <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
      <Button size="sm" icon={taken ? 'check' : 'plus'} disabled={taken} onClick={() => { setPlay(p => addCandidateControl(p, c)); toast.success(`“${candidateLabel(c)}” is a Play control`, { action: openPlay }); }}>
        {taken ? 'A control' : 'Add to controls'}
      </Button>
      {c.kind === 'float' && (
        <Button size="sm" icon="target" onClick={() => {
          const { drives, label } = graphNullDrives(candidates, c);
          setPlay(p => driveWithNull(p, drives, label).play);
          toast.success(`Added “${label}”`, { message: 'In Play, drag the dot on the picture to change the value.', action: openPlay });
        }}>Drive with a null</Button>
      )}
    </span>
  );
}
