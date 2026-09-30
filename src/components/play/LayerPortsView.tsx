/**
 * LayerPortsView — a layer's contract (play/layerPorts.ts) in its editor:
 * what it accepts (its numbers, which any mapping can drive, and the buttons
 * that press it) and what it emits (what it measures, with a live meter, Map…
 * and Signal; the events it can send, each wired to a signal; its position).
 * One view for every kind, so a layer reads the same way whatever it is.
 */
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { addSignal } from '../../play/pairs';
import { eventSignal, layerPorts } from '../../play/layerPorts';
import { CAPTURE_POS, EVENT_ANCHOR, type PlayLayer } from '../../types/play';
import { Button } from '../ui/Button';
import { Select } from '../ui/Select';
import { Tooltip } from '../ui/Tooltip';
import { LayerReadings } from './MapToMenu';
import { actionLabel } from './layers/help';

export function LayerPortsView({ layer: l }: { layer: PlayLayer }) {
  const tk = useTokens();
  const signals = useNodeGraphStore(s => s.play.signals) ?? [];
  const setPlay = useNodeGraphStore(s => s.setPlay);
  const ports = layerPorts(l);
  const cap: React.CSSProperties = { color: tk.text.faint, font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.05em', textTransform: 'uppercase', margin: '8px 0 4px' };
  const note: React.CSSProperties = { color: tk.text.muted, font: `11.5px/1.45 ${fontFamily.ui}` };
  const chip: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', height: 22, padding: '0 8px', borderRadius: radius.md, background: alpha(tk.text.primary, 0.05), color: tk.text.secondary, font: `500 11.5px ${fontFamily.ui}` };
  const setEvent = (field: string, id: string) => setPlay(p => ({ ...p, layers: p.layers.map(x => (x.id === l.id ? { ...x, [field]: id } : x)) }));
  return (
    <div data-layer-ports={l.id}>
      <div style={{ ...cap, marginTop: 2 }}>Accepts</div>
      <div style={note}>
        {ports.props.length
          ? <>Any of its <b style={{ color: tk.text.secondary }}>{ports.props.length}</b> numbers: the + beside each maps a source onto it, or makes a signal from it.</>
          : 'No numbers to drive.'}
      </div>
      {ports.buttons.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }} aria-label="Buttons">
          {ports.buttons.map(b => <span key={b} style={chip}>{actionLabel(b, l)}</span>)}
        </div>
      )}
      <div style={cap}>Emits</div>
      {ports.readings.length > 0 ? <LayerReadings layer={l} /> : <div style={note}>It measures nothing of its own; its numbers can still be watched.</div>}
      {ports.events.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
          {ports.events.map(e => (
            <div key={e.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Tooltip label={e.label} description={e.hint} placement="top">
                <span style={{ width: 62, flexShrink: 0, color: tk.text.faint, font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.04em', textTransform: 'uppercase', cursor: 'help' }}>{e.label}</span>
              </Tooltip>
              <Select ariaLabel={`Signal on ${e.label.toLowerCase()}`} value={eventSignal(l, e)} height={26} style={{ flex: 1, minWidth: 0 }}
                options={[{ value: '', label: 'Sends nothing' }, ...signals.map(s => ({ value: s.id, label: `Sends ${s.name}` }))]}
                onChange={v => setEvent(e.field, v)} />
              <Button size="sm" variant="ghost" onClick={() => setPlay(p => {
                const r = addSignal(p, `${l.label} ${e.label.toLowerCase()}`);
                if (!r.id) return p;
                // A particle event's new signal takes where it happened, ready for Move a layer here… on the Signals page.
                const where = l.kind === 'particles' && (e.key === 'born' || e.key === 'died' || e.key === 'annihilate') ? `${CAPTURE_POS}${EVENT_ANCHOR}${l.id}:${e.key}` : '';
                const signals = where ? (r.play.signals ?? []).map(s => (s.id === r.id ? { ...s, capture: { what: where, at: 'rise' as const } } : s)) : r.play.signals;
                return { ...r.play, signals, layers: r.play.layers.map(x => (x.id === l.id ? { ...x, [e.field]: r.id } : x)) };
              })}>New</Button>
            </div>
          ))}
        </div>
      )}
      {ports.position && <div style={{ ...note, marginTop: 8 }}>Its centre is a position: distances, proximity and position mappings can use it.</div>}
    </div>
  );
}
