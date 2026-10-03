/**
 * InputNamesModal — name a node's inputs in your own words, and say what each
 * is for: the card shows the name, the socket's tooltip the description. Its
 * code is untouched (a Custom Function keeps its parameter names). Publishing
 * the node as a node type starts from these names.
 */
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import type { GraphNode } from '../../types/nodeGraph';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { inputHintOf, inputLabelOf, inputTextPatch } from '../../lib/inputNames';
import { Modal } from '../ui/Modal';
import { Field } from '../ui/Field';
import { TYPE_COLORS } from './typeColors';

export function InputNamesModal({ node, keys, onClose }: { node: GraphNode; keys: string[]; onClose: () => void }) {
  const tk = useTokens();
  // Live: the node as it is now, so each keystroke builds on the last.
  const live = useNodeGraphStore(s => s.nodes.find(n => n.id === node.id)) ?? node;
  const update = useNodeGraphStore(s => s.updateNodeParams);
  const set = (kind: 'label' | 'hint', key: string, text: string) => {
    const now = useNodeGraphStore.getState().nodes.find(n => n.id === node.id) ?? live;
    update(node.id, inputTextPatch(now, kind, key, text));
  };
  return (
    <Modal title="Input names" subtitle="Your own name for each input, and what it's for" icon="edit" onClose={onClose} width={520}>
      <div style={{ padding: '12px 16px 16px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ color: tk.text.muted, font: `12px/1.5 ${fontFamily.ui}` }}>
          The card shows the name; the description shows when you point at the socket. The node works the same. Publishing it as a node type starts from these names.
        </div>
        {keys.map(key => {
          const input = live.inputs[key];
          if (!input) return null;
          const name = inputLabelOf(live, key, '');
          return (
            <div key={key} data-input-names={key} style={{ padding: '10px 12px', borderRadius: radius.card, background: tk.bg.panel, boxShadow: `inset 0 0 0 1px ${tk.border.default}`, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span aria-hidden style={{ width: 9, height: 9, borderRadius: 5, background: TYPE_COLORS[input.type] || '#888', flexShrink: 0 }} />
                <span style={{ font: `500 11px ${fontFamily.mono}`, color: tk.text.muted, flexShrink: 0 }}>{input.type}</span>
                <Field aria-label={`Name for ${input.label}`} value={name} placeholder={input.label} height={28} style={{ flex: 1 }} onChange={e => set('label', key, e.target.value)} />
              </div>
              <Field aria-label={`What ${input.label} is for`} value={inputHintOf(live, key)} placeholder="What it's for (optional): e.g. how far the ripples spread" height={28} onChange={e => set('hint', key, e.target.value)} />
              {name && <span style={{ color: tk.text.faint, font: `11px ${fontFamily.ui}` }}>Was “{input.label}”. Clear the name to go back to it.</span>}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
