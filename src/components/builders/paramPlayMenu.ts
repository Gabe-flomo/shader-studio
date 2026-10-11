/**
 * paramPlayMenu.ts — the Play menu a builder slider opens on right-click when it sets a real
 * node param (BuilderSlider `param`): the same "Add to Play controls" / "Remove from Play
 * controls" a node card's slider offers (NodeGraph's context menu), read when the menu opens.
 */
import type { MenuItem } from '../ui/Menu';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { candidateFor, candidateLabel, collectPlayCandidates } from '../../play/playControls';
import { addCandidateControl } from '../play/layerOps';
import { removeFromPlay } from '../../play/playDriven';
import { toast } from '../ui/toastStore';

const openPlay = { label: 'Open Play', onClick: () => useNodeGraphStore.setState(s => ({ playOpenRequest: s.playOpenRequest + 1 })) };

/** The menu for `nodeId`'s param `key`, as the graph is now. */
export function paramPlayItems(nodeId: string, key: string): MenuItem[] {
  const st = useNodeGraphStore.getState();
  const c = candidateFor(collectPlayCandidates(st.nodes, st.paramBindings), nodeId, key);
  const head: MenuItem = { heading: 'Play' };
  if (!c) return [head, { label: 'This setting is baked into the shader, so it can’t be a Play control', disabled: true, onSelect: () => {} }];
  const control = st.play.controls.find(x => x.target === c.target);
  if (control) {
    return [head, {
      label: 'Remove from Play controls', icon: 'trash', hint: control.label,
      onSelect: () => {
        useNodeGraphStore.getState().setPlay(p => removeFromPlay(p, control.id));
        toast.success(`“${control.label}” is off the Play panel`, { message: 'Its mappings went with it.' });
      },
    }];
  }
  return [head, {
    label: 'Add to Play controls', icon: 'plus', hint: candidateLabel(c),
    onSelect: () => {
      useNodeGraphStore.getState().setPlay(p => addCandidateControl(p, c));
      toast.success(`“${candidateLabel(c)}” is a Play control`, { message: 'MIDI, keys, the mouse and more can drive it in Play.', action: openPlay });
    },
  }];
}
