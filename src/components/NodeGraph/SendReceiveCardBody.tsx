/**
 * Send and Receive cards (nodes/definitions/sendReceive.ts, docs/send-receive.md).
 *
 * Send: a chip "→ N receivers" that jumps to them (each click the next one), and a warning when another Send
 * has the same Name. Receive: a picker of every Send in the graph (inside groups too) with its type and where
 * it is, a chip "← from Send" that jumps to it, and a plain message when it has no Send.
 */
import { useMemo, useRef } from 'react';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import type { GraphNode } from '../../types/nodeGraph';
import { duplicateSendIds, listSends, receiversOf, sendNameOf } from '../../compiler/sendReceive';
import { RECEIVE_TYPE } from '../../nodes/definitions/sendReceive';

/** Open the groups `path` names (from the top level), select the node and centre on it. */
function jumpTo(path: string[], id: string) {
  const st = useNodeGraphStore.getState();
  for (let i = 0; i < 16 && useNodeGraphStore.getState().activeGroupPath.length; i++) st.exitGroup();
  useNodeGraphStore.getState().revealNode(path, id);
}

export function SendReceiveCardBody({ node, touch = false }: { node: GraphNode; touch?: boolean }) {
  const tk = useTokens();
  const nodes = useNodeGraphStore(s => s.nodes);
  const update = useNodeGraphStore(s => s.updateNodeParams);
  const sends = useMemo(() => listSends(nodes), [nodes]);
  const next = useRef(0);

  const chip = {
    alignSelf: 'flex-start', padding: touch ? '6px 9px' : '2px 8px', border: `1px solid ${tk.border.default}`, borderRadius: radius.sm,
    background: tk.bg.subtle, color: tk.text.secondary, font: `600 11px ${fontFamily.ui}`, cursor: 'pointer',
  } as const;
  const msg = (color: string) => ({ fontSize: 11, lineHeight: 1.4, color } as const);
  const wrap = { padding: '2px 12px 8px 16px', display: 'flex', flexDirection: 'column', gap: 6 } as const;

  if (node.type === RECEIVE_TYPE) {
    const sendId = String(node.params.sendId ?? '');
    const from = sends.find(s => s.id === sendId);
    const remembered = typeof node.params.name === 'string' ? node.params.name : '';
    return (
      <div style={wrap} onMouseDown={e => e.stopPropagation()} data-receive-card={node.id}>
        <select aria-label="Send to receive from" value={from ? sendId : ''}
          onChange={e => { const s = sends.find(x => x.id === e.target.value); update(node.id, { sendId: s?.id ?? '', name: s?.name ?? '' }); }}
          style={{ padding: touch ? '6px 7px' : '3px 5px', border: `1px solid ${tk.border.default}`, borderRadius: radius.sm, background: tk.bg.field, color: tk.text.primary, font: `500 11.5px ${fontFamily.ui}`, minWidth: 0 }}>
          <option value="">{sends.length ? 'Pick a Send…' : 'No Send in this graph yet'}</option>
          {sends.map(s => <option key={s.id} value={s.id}>{`${s.name || 'unnamed'} · ${s.type} · ${s.where}`}</option>)}
        </select>
        {from ? (
          <button type="button" style={chip} data-jump-send={from.id} title={`Go to the Send (${from.where})`} onClick={() => jumpTo(from.path, from.id)}>
            ← from Send “{from.name || 'unnamed'}”
          </button>
        ) : (
          <span style={msg(tk.status.warning)}>
            {sendId && remembered ? `Its Send “${remembered}” is gone, so the Value is 0 (black for a texture). Pick another.`
              : sendId ? 'Its Send is gone, so the Value is 0 (black for a texture). Pick another.'
              : 'No Send picked: the Value is 0. Pick one above, by its Name.'}
          </span>
        )}
      </div>
    );
  }

  const receivers = receiversOf(nodes, node.id);
  const dup = duplicateSendIds(nodes).has(node.id);
  const name = sendNameOf(node);
  return (
    <div style={wrap} onMouseDown={e => e.stopPropagation()} data-send-card={node.id}>
      {receivers.length ? (
        <button type="button" style={chip} data-jump-receivers={receivers.length} title="Go to its Receives (each click the next one)"
          onClick={() => { const r = receivers[next.current++ % receivers.length]; jumpTo(r.path, r.id); }}>
          → {receivers.length} receiver{receivers.length === 1 ? '' : 's'}
        </button>
      ) : (
        <span style={msg(tk.text.muted)}>No Receive reads this yet. Add a Receive anywhere and pick “{name || 'unnamed'}”.</span>
      )}
      {!name && <span style={msg(tk.status.warning)}>Give it a Name, so Receives can find it in their list.</span>}
      {dup && <span style={msg(tk.status.warning)}>Another Send is also named “{name}”. Each Receive keeps the one it picked, but the list shows both: give each its own Name.</span>}
    </div>
  );
}
