import React, { useEffect, useState } from 'react';
import type { GraphNode } from '../../types/nodeGraph';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { useCtp } from '../../theme/nodePalette';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { TYPE_COLORS } from './typeColors';
import { registerSocket, getView } from './socketRegistry';
import { startNodeMouseDrag } from './nodeDrag';
import { midiEngine, midiNoteName, type MidiEvent } from '../../lib/midiEngine';
import { midiCcList, midiOutputSockets } from '../../lib/midiOutputs';
import { toneSynth } from '../../lib/toneSynth';

const getZoom = () => getView().zoom;

interface Props {
  node: GraphNode;
  isSelected: boolean;
  isMultiSelected: boolean;
  dimmed: boolean;
  onStartConnection: (nodeId: string, outputKey: string, event: React.MouseEvent) => void;
}

/**
 * The MIDI Input node card. Keeps the engine in sync with the node's params,
 * shows which backend is feeding it, and lets you add CC outputs.
 *
 * The activity readout comes straight from the engine's event stream (sparse,
 * not per frame), so it never touches the store.
 */
export function MidiInputCard({ node, isSelected, isMultiSelected, dimmed, onStartConnection }: Props) {
  const tc = useCtp();
  const tk = useTokens();
  const updateNodeParams   = useNodeGraphStore(s => s.updateNodeParams);
  const updateNodeOutputs  = useNodeGraphStore(s => s.updateNodeOutputs);
  const updateNodePosition = useNodeGraphStore(s => s.updateNodePosition);
  const removeNode         = useNodeGraphStore(s => s.removeNode);
  const setSelectedNodeId  = useNodeGraphStore(s => s.setSelectedNodeId);

  const channel  = typeof node.params.channel === 'string' ? node.params.channel : 'all';
  const smoothMs = typeof node.params.smooth_ms === 'number' ? node.params.smooth_ms : 20;
  const ccs      = midiCcList(node.params);

  // ── Engine sync ────────────────────────────────────────────────────────────
  useEffect(() => {
    midiEngine.updateNode(node.id, node.params);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id, node.params.channel, node.params.smooth_ms, node.params._ccs]);
  useEffect(() => () => { midiEngine.removeNode(node.id); }, [node.id]);

  // ── Backend status + activity (event driven) ──────────────────────────────
  const [webMidi, setWebMidi] = useState(() => midiEngine.webMidi());
  const [keyboard, setKeyboard] = useState(() => midiEngine.keyboard().enabled);
  const [sound, setSound] = useState(() => toneSynth.isEnabled());
  const [last, setLast] = useState<string>('');
  // The piano keys only listen while this node is selected, so typing and
  // shortcuts keep working the rest of the time.
  useEffect(() => {
    if (!isSelected) return;
    midiEngine.armKeyboard(node.id);
    return () => midiEngine.disarmKeyboard(node.id);
  }, [isSelected, node.id]);
  useEffect(() => {
    // Ask for MIDI access the first time a MIDI node is on the canvas.
    void midiEngine.connectWebMidi().then(() => setWebMidi(midiEngine.webMidi()));
    const offSound = toneSynth.subscribe(setSound);
    const offMidi = midiEngine.subscribe((e: MidiEvent) => {
      switch (e.kind) {
        case 'devices': setWebMidi(midiEngine.webMidi()); break;
        case 'noteOn':  setLast(`${midiNoteName(e.note)} · vel ${e.velocity}`); break;
        case 'cc':      setLast(`CC ${e.cc} · ${e.value}`); break;
        case 'bend':    setLast(`bend ${e.value.toFixed(2)}`); break;
        default: break;
      }
    });
    return () => { offSound(); offMidi(); };
  }, []);

  const toggleKeyboard = () => {
    const next = !keyboard;
    midiEngine.setKeyboardEnabled(next);
    setKeyboard(next);
  };

  const setCcs = (next: number[]) => {
    updateNodeParams(node.id, { _ccs: next }, { immediate: true });
    updateNodeOutputs(node.id, midiOutputSockets({ _ccs: next }));
  };
  const addCc = () => {
    let cc = 1;
    while (ccs.includes(cc) && cc < 127) cc++;
    setCcs([...ccs, cc]);
  };

  const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6 };
  const labelStyle: React.CSSProperties = { fontSize: 10, color: tc.surface2, width: 64, flexShrink: 0 };
  const fieldStyle: React.CSSProperties = { flex: 1, background: tc.surface0, border: `1px solid ${tc.surface1}`, color: tc.text, fontSize: 10, borderRadius: 4, padding: '2px 4px' };

  const sourceLabel =
    webMidi.status === 'ready' && webMidi.inputs.length > 0 ? `${webMidi.inputs.length} device${webMidi.inputs.length === 1 ? '' : 's'}`
    : webMidi.status === 'ready' ? 'no devices'
    : webMidi.status === 'requesting' ? 'connecting…'
    : webMidi.status === 'denied' ? 'access denied'
    : 'no Web MIDI here';

  return (
    <div
      data-node-id={node.id}
      style={{
        position: 'absolute', left: node.position.x, top: node.position.y, width: 360, boxSizing: 'border-box',
        background: tk.bg.panel, borderRadius: radius.card, color: tk.text.primary, fontSize: 12.5, fontFamily: fontFamily.ui,
        userSelect: 'none', opacity: dimmed ? 0.2 : 1, transition: 'opacity 0.15s, box-shadow 0.15s',
        boxShadow: isMultiSelected ? `0 0 0 2px ${tk.accent.base}, ${tk.shadow.card}`
          : isSelected ? `0 0 0 1.5px ${tk.accent.base}, ${tk.shadow.card}` : tk.shadow.card,
      }}
    >
      {/* Header */}
      <div
        onMouseDown={(e) => {
          if (e.button === 2) return;
          e.stopPropagation();
          startNodeMouseDrag({
            nodeId: node.id,
            cardEl: (e.currentTarget as HTMLElement).closest<HTMLElement>('[data-node-id]'),
            startClient: { x: e.clientX, y: e.clientY },
            startPosition: node.position,
            getZoom,
            threshold: 0,
            commit: pos => updateNodePosition(node.id, pos),
            onSettle: () => setSelectedNodeId(isSelected ? null : node.id),
          });
        }}
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, padding: '8px 8px 8px 14px', borderBottom: `1px solid ${tk.border.subtle}`, cursor: 'grab' }}
      >
        <span style={{ fontWeight: 600, fontSize: 11, color: tc.sky }}>MIDI Input</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, color: last ? tc.green : tc.surface2, fontFamily: 'monospace', minWidth: 90, textAlign: 'right' }} title="Last MIDI message">
            {last || '—'}
          </span>
          <button onMouseDown={e => e.stopPropagation()} onClick={() => removeNode(node.id)} style={{ background: 'none', border: 'none', color: tc.red, cursor: 'pointer', fontSize: 13 }}>✕</button>
        </div>
      </div>

      {/* Source */}
      <div style={{ padding: '6px 10px 4px', display: 'flex', flexDirection: 'column', gap: 5 }} onMouseDown={e => e.stopPropagation()}>
        <div style={rowStyle}>
          <span style={labelStyle}>Devices</span>
          <span style={{ flex: 1, fontSize: 10, color: webMidi.status === 'ready' && webMidi.inputs.length ? tc.text : tc.overlay0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={webMidi.inputs.join(', ')}>
            {webMidi.inputs.length ? webMidi.inputs.join(', ') : sourceLabel}
          </span>
          <button
            onClick={toggleKeyboard}
            title={`Play notes from the computer keyboard while this node is selected: A–L rows = two octaves, Z/X octave, C/V velocity${isSelected ? '' : ' (select the node first)'}`}
            style={{ background: keyboard ? tc.surface1 : 'none', border: `1px solid ${keyboard ? tc.sky : tc.surface1}`, color: keyboard ? (isSelected ? tc.sky : tc.overlay0) : tc.surface2, fontSize: 10, borderRadius: 4, padding: '2px 6px', cursor: 'pointer' }}
          >⌨ Keys</button>
          <button
            onClick={() => toneSynth.setEnabled(!sound)}
            title="Hear the notes: a built-in tone so you get sound without a synth"
            style={{ background: sound ? tc.surface1 : 'none', border: `1px solid ${sound ? tc.sky : tc.surface1}`, color: sound ? tc.sky : tc.surface2, fontSize: 10, borderRadius: 4, padding: '2px 6px', cursor: 'pointer' }}
          >🔊</button>
        </div>
        <div style={rowStyle}>
          <span style={labelStyle}>Channel</span>
          <select value={channel} onChange={e => updateNodeParams(node.id, { channel: e.target.value }, { immediate: true })} style={{ ...fieldStyle, cursor: 'pointer' }}>
            <option value="all">All</option>
            {Array.from({ length: 16 }, (_, i) => <option key={i + 1} value={`${i + 1}`}>{i + 1}</option>)}
          </select>
        </div>
        <div style={rowStyle}>
          <span style={labelStyle}>Smoothing</span>
          <input type="range" min={0} max={500} step={1} value={smoothMs}
            onChange={e => updateNodeParams(node.id, { smooth_ms: parseFloat(e.target.value) }, { immediate: true })}
            style={{ flex: 1, accentColor: tc.sky, cursor: 'pointer' }} />
          <span style={{ fontSize: 10, color: tc.overlay0, fontFamily: 'monospace', width: 42, textAlign: 'right' }}>{smoothMs} ms</span>
        </div>
        {/* CC list */}
        {ccs.map((cc, i) => (
          <div key={i} style={rowStyle}>
            <span style={labelStyle}>{`CC ${i + 1}`}</span>
            <input type="number" min={0} max={127} step={1} value={cc}
              onChange={e => {
                const n = Math.max(0, Math.min(127, Math.round(parseFloat(e.target.value) || 0)));
                setCcs(ccs.map((c, idx) => idx === i ? n : c));
              }}
              style={{ ...fieldStyle, width: 56, flex: 'none', fontFamily: 'monospace' }} />
            <span style={{ flex: 1 }} />
            <button onClick={() => setCcs(ccs.filter((_, idx) => idx !== i))} disabled={ccs.length <= 1} title="Remove CC output"
              style={{ background: 'none', border: 'none', color: ccs.length <= 1 ? tc.surface1 : tc.surface2, cursor: ccs.length <= 1 ? 'default' : 'pointer', fontSize: 11, padding: 0, lineHeight: 1 }}>×</button>
          </div>
        ))}
        <button onClick={addCc} disabled={ccs.length >= 16}
          style={{ background: tc.surface0, border: `1px dashed ${tc.surface1}`, color: tc.surface2, fontSize: 10, borderRadius: 4, padding: 3, cursor: 'pointer', width: '100%', marginTop: 2 }}>
          + Add CC output
        </button>
      </div>

      {/* Output sockets */}
      <div style={{ padding: '3px 0 5px', display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-end' }}>
        {Object.entries(node.outputs).map(([key, out]) => (
          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, paddingRight: 4 }}>
            <span style={{ fontSize: 10, color: tc.subtext0 }}>{out.label}</span>
            <div
              data-socket="out"
              ref={el => { registerSocket(node.id, 'out', key, el); }}
              onMouseDown={e => { e.stopPropagation(); onStartConnection(node.id, key, e); }}
              style={{ width: 12, height: 12, borderRadius: '50%', background: TYPE_COLORS['float'] ?? '#f0a', border: `2px solid ${TYPE_COLORS['float'] ?? '#f0a'}`, cursor: 'crosshair', marginRight: -6 }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
