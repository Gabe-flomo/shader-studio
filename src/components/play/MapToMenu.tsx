/**
 * MapToMenu and LayerReadings — "Add mapping" from where a signal lives.
 *
 * A layer that measures something (an audio layer's bass… treble, a shape's
 * fill, particles' speed) lists its readings with live meters; "Map…" on one
 * opens the same kind of list as Add control (your controls, sliders from
 * the graph, layer properties) and picking a target makes the mapping, and
 * the control first when it isn't on the panel yet. The mapping then shows
 * in Mappings like any other, to tune its range and curve.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { candidateLabel, collectPlayCandidates } from '../../play/playControls';
import { SENSOR_HINTS, SENSOR_LABELS } from '../../play/playSources';
import { playEngine } from '../../lib/playEngine';
import { LAYER_NUMERIC_PROPS, SENSOR_READS_FOR, layerTarget, type PlayLayer, type PlaySource, type SensorRead } from '../../types/play';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Button } from '../ui/Button';
import { Field } from '../ui/Field';
import { Icon } from '../ui/Icon';
import { Popover } from '../ui/Popover';
import { Tooltip } from '../ui/Tooltip';
import { toast } from '../ui/toastStore';
import { mapSourceTo } from './layerOps';
import { usePlayUi } from './playUi';

export function MapToMenu({ source, label }: { source: PlaySource; label: string }) {
  const tk = useTokens();
  const anchor = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [unfolded, setUnfolded] = useState<Set<string>>(() => new Set(['controls', 'graph']));
  const play = useNodeGraphStore(s => s.play);
  const nodes = useNodeGraphStore(s => s.nodes);
  const bindings = useNodeGraphStore(s => s.paramBindings);
  const setPlay = useNodeGraphStore(s => s.setPlay);
  const taken = useMemo(() => new Set(play.controls.map(c => c.target)), [play.controls]);
  const query = q.trim().toLowerCase();
  const match = (s: string) => !query || s.toLowerCase().includes(query);
  const controls = play.controls.filter(c => c.kind !== 'color' && match(c.label));
  const graph = open ? collectPlayCandidates(nodes, bindings).filter(c => c.kind === 'float' && !taken.has(c.target) && match(candidateLabel(c))) : [];
  const layers = play.layers.map(l => ({ l, props: LAYER_NUMERIC_PROPS[l.kind].filter(d => !taken.has(layerTarget(l.id, d.key)) && match(`${l.label} ${d.label}`)) })).filter(x => x.props.length);
  const isOpen = (k: string) => !!query || unfolded.has(k);
  const flip = (k: string) => setUnfolded(p => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  const pick = (target: Parameters<typeof mapSourceTo>[2]) => {
    let made: string | undefined;
    setPlay(p => { const r = mapSourceTo(p, source, target); made = r.control?.label; return r.play; });
    setOpen(false); setQ('');
    if (made) toast.success(`${label} → ${made}`, { message: 'Tune its range and curve in Mappings.', action: { label: 'Show', onClick: () => usePlayUi.getState().setTab('mappings') } });
  };
  const item = { width: '100%', display: 'flex', alignItems: 'center', gap: 8, minHeight: 30, padding: '0 8px', border: 0, borderRadius: radius.md, background: 'none', cursor: 'pointer', color: tk.text.primary, font: `12.5px ${fontFamily.ui}`, textAlign: 'left' as const };
  const hover = {
    onMouseEnter: (e: React.MouseEvent) => ((e.currentTarget as HTMLElement).style.background = tk.bg.hover),
    onMouseLeave: (e: React.MouseEvent) => ((e.currentTarget as HTMLElement).style.background = 'none'),
  };
  const folder = (k: string, title: string, n: number, indent = 0) => (
    <button key={`f:${k}`} type="button" onClick={() => flip(k)} {...hover} style={{ ...item, height: 28, paddingLeft: 6 + indent, color: tk.text.secondary, font: `650 11.5px ${fontFamily.ui}` }}>
      <Icon name={isOpen(k) ? 'chevD' : 'chevR'} size={12} style={{ color: tk.text.faint }} />
      <span style={{ flex: 1 }}>{title}</span>
      <span style={{ color: tk.text.faint, font: `500 11px ${fontFamily.mono}` }}>{n}</span>
    </button>
  );
  const row = (key: string, text: string, onClick: () => void, indent: number, hint?: string) => (
    <button key={key} type="button" title={hint} onClick={onClick} {...hover} style={{ ...item, paddingLeft: indent }}>
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{text}</span>
    </button>
  );
  const empty = controls.length + graph.length + layers.length === 0;
  return (
    <span ref={anchor} style={{ display: 'inline-flex' }}>
      <Button size="sm" variant="ghost" icon="plus" onClick={() => setOpen(o => !o)} title={`Map ${label} onto a control`}>Map…</Button>
      {open && (
        <Popover anchorRef={anchor} onClose={() => { setOpen(false); setQ(''); }} align="end" width={300} padding={8}>
          <div style={{ padding: '2px 4px 6px', color: tk.text.faint, fontSize: 11.5 }}>Map <b style={{ color: tk.text.secondary }}>{label}</b> onto…</div>
          <Field autoFocus placeholder="Search controls, sliders and layers" value={q} onChange={e => setQ(e.target.value)} height={30} leading={<Icon name="search" size={14} style={{ color: tk.text.faint }} />} />
          <div style={{ maxHeight: 360, overflowY: 'auto', marginTop: 6 }}>
            {empty && <div style={{ padding: '10px 8px', color: tk.text.faint }}>{q ? 'No match.' : 'Nothing to map onto yet: add a node with a slider in the Studio.'}</div>}
            {controls.length > 0 && folder('controls', 'Your controls', controls.length)}
            {controls.length > 0 && isOpen('controls') && controls.map(c => row(c.id, c.label, () => pick({ control: c.id }), 24))}
            {graph.length > 0 && folder('graph', 'From the graph', graph.length)}
            {graph.length > 0 && isOpen('graph') && graph.map(c => row(c.target, candidateLabel(c), () => pick({ candidate: c }), 24, c.hint))}
            {layers.length > 0 && folder('layers', 'From layers', layers.reduce((n, x) => n + x.props.length, 0))}
            {layers.length > 0 && isOpen('layers') && layers.map(({ l, props }) => (
              <div key={l.id}>
                {folder(`layer:${l.id}`, l.label, props.length, 14)}
                {isOpen(`layer:${l.id}`) && props.map(d => row(d.key, d.label, () => pick({ layerId: l.id, key: d.key }), 40, d.hint))}
              </div>
            ))}
          </div>
        </Popover>
      )}
    </span>
  );
}

/** A layer's readings (audio bands, a shape's fill…) with meters and Map…, in its editor. */
export function LayerReadings({ layer }: { layer: PlayLayer }) {
  const tk = useTokens();
  const reads = (SENSOR_READS_FOR[layer.kind] ?? []).filter(r => r !== 'distance') as SensorRead[];
  const [vals, setVals] = useState<Record<string, number | null>>({});
  useEffect(() => {
    if (!reads.length) return;
    const id = window.setInterval(() => {
      const next: Record<string, number | null> = {};
      for (const r of reads) next[r] = playEngine.readSource({ kind: 'sensor', layerId: layer.id, read: r, otherId: '' });
      setVals(next);
    }, 100);
    return () => window.clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layer.id, layer.kind]);
  if (!reads.length) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
      {reads.map(r => {
        const v = vals[r];
        return (
          <div key={r} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Tooltip label={SENSOR_LABELS[r]} description={SENSOR_HINTS[r]} placement="top">
              <span style={{ width: 62, flexShrink: 0, color: tk.text.faint, font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.04em', textTransform: 'uppercase', cursor: 'help' }}>{SENSOR_LABELS[r]}</span>
            </Tooltip>
            <div style={{ flex: 1, height: 6, borderRadius: 3, background: tk.bg.field, overflow: 'hidden' }} title={v == null ? 'Nothing to measure yet' : `${Math.round(v * 100)}%`}>
              <div style={{ width: `${Math.round((v ?? 0) * 100)}%`, height: '100%', background: v == null ? 'transparent' : alpha(tk.accent.base, 0.85), transition: 'width 90ms linear' }} />
            </div>
            <MapToMenu source={{ kind: 'sensor', layerId: layer.id, read: r, otherId: '' }} label={`${layer.label} ${SENSOR_LABELS[r].toLowerCase()}`} />
          </div>
        );
      })}
    </div>
  );
}
