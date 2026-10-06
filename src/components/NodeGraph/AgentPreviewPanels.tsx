/**
 * Always-on previews for the Agents nodes whose output isn't a picture (docs/node-previews.md,
 * "Every node"): a small diagram of their settings and the live numbers, or a live mini picture of
 * the trail a Deposit feeds. Nothing here renders on the GPU: the diagrams are SVG from the
 * params, the numbers come from the agents runner (agentStatsFor), and the trail is the picture
 * the runner already draws for the Trail field card (trailThumbRegistry, mirrored here).
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { GraphNode } from '../../types/nodeGraph';
import { useTokens } from '../../theme/themeStore';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { agentStatsFor, trailThumbRegistry, type AgentStats } from '../../lib/agentRunner';

const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';
const num = (node: GraphNode, key: string, fallback: number) => (typeof node.params[key] === 'number' ? (node.params[key] as number) : fallback);
const wired = (node: GraphNode, key: string) => !!node.inputs[key]?.connection;
const fmt = (v: number, d = 2) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(d));

/** The types this file draws a panel for (previewPlan's stats and mirror bodies; tested to match). */
export const AGENT_PANEL_TYPES: ReadonlySet<string> = new Set(['agentSense', 'agentSteer', 'agentMove', 'agentEmit', 'agentDeposit']);

export function AgentPreviewPanel({ node }: { node: GraphNode }) {
  switch (node.type) {
    case 'agentSense': return <SensePanel node={node} />;
    case 'agentSteer': return <SteerPanel node={node} />;
    case 'agentMove': return <MovePanel node={node} />;
    case 'agentEmit': return <EmitPanel node={node} />;
    case 'agentDeposit': return <DepositPanel node={node} />;
    default: return null;
  }
}

function Panel({ kind, children, lines }: { kind: string; children?: ReactNode; lines: Array<string | null> }) {
  const tk = useTokens();
  return (
    <div data-preview-kind={kind} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 12px', borderBottom: `1px solid ${tk.border.subtle}` }}
      onMouseDown={e => e.stopPropagation()}>
      {children}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, fontFamily: MONO, fontSize: 10.5, lineHeight: 1.35, color: tk.text.secondary }}>
        {lines.filter(Boolean).map(l => <span key={l!}>{l}</span>)}
      </div>
    </div>
  );
}

/** A walker (dot), its heading (arrow to the right) and three sensors at ±Angle, Distance ahead. */
function SensePanel({ node }: { node: GraphNode }) {
  const tk = useTokens();
  const angle = num(node, 'angle', 45), dist = num(node, 'distance', 0.03);
  // Distance on a log scale across the slider's range (0.002 … 0.2), so every setting reads
  const r = 14 + 34 * Math.max(0, Math.min(1, Math.log(dist / 0.002) / Math.log(100)));
  const a = (angle * Math.PI) / 180;
  const cx = 10, cy = 34;
  const at = (t: number): [number, number] => [cx + r * Math.cos(t), cy - r * Math.sin(t)];
  const sensors = [at(a), at(0), at(-a)];
  return (
    <Panel kind="stats" lines={[
      `sensors ${wired(node, 'angle') ? 'wired' : `${fmt(angle, 1)}°`} apart`,
      `${wired(node, 'distance') ? 'wired' : fmt(dist, 3)} ahead`,
      `weight ${fmt(num(node, 'weight', 1))} · ${String(node.params.width ?? '1') === '5' ? '5-tap' : '1 tap'}`,
    ]}>
      <svg width={64} height={68} viewBox="0 0 64 68" aria-label="Sensor layout" style={{ flexShrink: 0 }}>
        <path d={`M ${cx} ${cy} L ${at(a)[0]} ${at(a)[1]} M ${cx} ${cy} L ${at(-a)[0]} ${at(-a)[1]}`} stroke={tk.border.strong} strokeWidth={1} fill="none" />
        <path d={`M ${cx} ${cy} L ${cx + r} ${cy}`} stroke={tk.text.faint} strokeWidth={1.5} strokeDasharray="2 2" />
        {sensors.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={4} fill={tk.accent.base} opacity={i === 1 ? 1 : 0.75} />)}
        <circle cx={cx} cy={cy} r={4.5} fill={tk.text.primary} />
      </svg>
    </Panel>
  );
}

/** How far it may turn in one step: a fan of ±Turn, with the wobble as a lighter band. */
function SteerPanel({ node }: { node: GraphNode }) {
  const tk = useTokens();
  const turn = num(node, 'turn', 45), jitter = num(node, 'jitter', 0.1);
  const a = (Math.min(180, turn) * Math.PI) / 180, j = (Math.min(180, turn * jitter) * Math.PI) / 180;
  const cx = 10, cy = 34, r = 40;
  const arc = (t: number, rr: number) => {
    const [x0, y0] = [cx + rr * Math.cos(t), cy - rr * Math.sin(t)];
    const [x1, y1] = [cx + rr * Math.cos(-t), cy - rr * Math.sin(-t)];
    return `M ${cx} ${cy} L ${x0} ${y0} A ${rr} ${rr} 0 ${t > Math.PI / 2 ? 1 : 0} 1 ${x1} ${y1} Z`;
  };
  const mode = String(node.params.mode ?? 'jones');
  return (
    <Panel kind="stats" lines={[
      `turns up to ${wired(node, 'turn') ? 'a wired angle' : `${fmt(turn, 1)}°`} a step`,
      `wobble ${wired(node, 'jitter') ? 'wired' : `${Math.round(jitter * 100)}% of that`}`,
      `rule ${mode}`,
    ]}>
      <svg width={64} height={68} viewBox="0 0 64 68" aria-label="Turn range" style={{ flexShrink: 0 }}>
        <path d={arc(a, r)} fill={tk.accent.base} opacity={0.22} />
        {j > 0.001 && <path d={arc(j, r * 0.6)} fill={tk.accent.base} opacity={0.35} />}
        <path d={`M ${cx} ${cy} L ${cx + r} ${cy}`} stroke={tk.text.faint} strokeWidth={1.5} strokeDasharray="2 2" />
        <circle cx={cx} cy={cy} r={4.5} fill={tk.text.primary} />
      </svg>
    </Panel>
  );
}

/** How far it goes in a second (an arrow against the picture's height) and what the edges do. */
function MovePanel({ node }: { node: GraphNode }) {
  const tk = useTokens();
  const speed = num(node, 'speed', 0.25);
  const len = 6 + 44 * Math.max(0, Math.min(1, speed / 2));
  const edges = String(node.params.edges ?? 'wrap');
  return (
    <Panel kind="stats" lines={[
      `speed ${wired(node, 'speed') ? 'wired' : `${fmt(speed, 3)} a second`}`,
      `(the picture is 2 tall: ${wired(node, 'speed') || speed <= 0 ? '—' : `${fmt(2 / speed, 1)} s to cross`})`,
      `edges ${edges}`,
    ]}>
      <svg width={64} height={40} viewBox="0 0 64 40" aria-label="Speed" style={{ flexShrink: 0 }}>
        <path d={`M 6 20 L ${6 + len} 20 M ${len} 14 L ${6 + len} 20 L ${len} 26`} stroke={tk.accent.base} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={6} cy={20} r={4} fill={tk.text.primary} />
      </svg>
    </Panel>
  );
}

/** The group a node's output is wired into (Emit → the group's Emit input). */
function useFedGroup(nodeId: string): string | null {
  return useNodeGraphStore(s => s.nodes.find(n => n.type === 'agentsGroup' && Object.values(n.inputs).some(i => i.connection?.nodeId === nodeId))?.id ?? null);
}

/** Births a second (or all at once) and how many are alive now, from the runner. */
function EmitPanel({ node }: { node: GraphNode }) {
  const group = useFedGroup(node.id);
  const [st, setSt] = useState<AgentStats | undefined>(() => (group ? agentStatsFor(group) : undefined));
  useEffect(() => {
    if (!group) return;
    const t = setInterval(() => setSt(agentStatsFor(group)), 1000);
    return () => clearInterval(t);
  }, [group]);
  const mode = String(node.params.mode ?? 'fill');
  const rate = num(node, 'rate', 20000), life = num(node, 'life', 0);
  const births = mode === 'rate' ? `${Math.round(rate).toLocaleString('en-US')} born a second`
    : mode === 'respawn' ? 'kept full: reborn when they die' : 'all born at once at the start';
  return (
    <Panel kind="stats" lines={[
      births,
      life > 0 ? `each lives ${fmt(life, 1)} s` : 'they live forever',
      group ? (st ? `${st.count.toLocaleString('en-US')} walkers in the group` : 'starting…') : 'not wired into an Agents group yet',
    ]} />
  );
}

/** The trail this Deposit writes into, live: the Trail field's own picture, mirrored. */
function DepositPanel({ node }: { node: GraphNode }) {
  const tk = useTokens();
  const trail = useNodeGraphStore(s => s.nodes.find(n => n.type === 'trailField' && Object.values(n.inputs).some(i => i.connection?.nodeId === node.id))?.id ?? null);
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c || !trail) return;
    // With the Trail field's card on screen the runner draws there and this copies it (4 times a
    // second); with that card off screen the runner draws straight into this one.
    const off = trailThumbRegistry.registerMirror(trail, c);
    const t = setInterval(() => {
      const main = trailThumbRegistry.main(trail);
      if (!main || !main.width) return;
      if (c.width !== main.width || c.height !== main.height) { c.width = main.width; c.height = main.height; }
      c.getContext('2d')?.drawImage(main, 0, 0);
    }, 250);
    return () => { off(); clearInterval(t); };
  }, [trail]);
  const what = String(node.params.what ?? 'trail');
  if (!trail) {
    return <Panel kind="stats" lines={['not wired into a Trail field yet', `drops ${fmt(num(node, 'amount', 1))} of ${what} a step`]} />;
  }
  return (
    <div data-preview-kind="mirror" style={{ padding: 4, borderBottom: `1px solid ${tk.border.subtle}` }}>
      <canvas ref={ref} width={128} height={72} title="The trail this Deposit writes into (its Trail field's picture, live)"
        style={{ display: 'block', width: '100%', maxHeight: 120, objectFit: 'contain', background: '#000', borderRadius: 3 }} />
      <div style={{ fontSize: 10, color: tk.text.faint, fontFamily: MONO, marginTop: 3 }}>
        the trail it feeds · {fmt(num(node, 'amount', 1))} of {what} a step · size {fmt(num(node, 'size', 1))}
      </div>
    </div>
  );
}
