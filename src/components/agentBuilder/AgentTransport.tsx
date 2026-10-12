/**
 * AgentTransport — the Agent Builder's step-through bar under the live viewport (docs/agent-builder.md,
 * "Stepping"), as the Grid Rules try board has: ↺ start over, ◀ one step back,
 * ▶ play / pause (the preview's clock), ▶| one step forward (Shift: a whole frame's steps). ← → and
 * Space when the bar has focus. The step counter is the group's own step.
 *
 * ↺ is the app's true reset (lib/runtimeReset.ts), not a step back: step 0, every walker born again,
 * the trails, the kept snapshots and the clock started over, as a fresh open has them. (It used to go
 * back to the oldest snapshot kept, which after a while of playing was not the start.)
 *
 * A step is one fixed tick of the simulation (1/60 s simulated), run by the live runner at its next
 * frame (lib/agentSnapshots.ts). Back restores a GPU snapshot (kept before every frame that steps)
 * and runs the steps after it again, so it is always one step; only the last few snapshots are kept
 * (the memory each takes), so the bar says how far back you can go.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useTokens } from '../../theme/themeStore';
import { fontFamily } from '../../theme/tokens';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { IconButton } from '../ui/Button';
import { agentStatsFor, type AgentStats } from '../../lib/agentRunner';
import { agentStepInfo, armAgentStepping, onAgentStepInfo, stepAgents, stepAgentsBack } from '../../lib/agentSnapshots';
import { BACK_MAX } from '../../agentBuilder/stepRun';
import { resetRuntime } from '../../lib/runtimeReset';

export function AgentTransport({ groupId }: { groupId: string }) {
  const tk = useTokens();
  const playing = useNodeGraphStore(s => s.timePlaying);
  const setPlaying = useNodeGraphStore(s => s.setTimePlaying);
  const info = useSyncExternalStore(onAgentStepInfo, agentStepInfo);
  const [stats, setStats] = useState<AgentStats | undefined>(() => agentStatsFor(groupId));

  // Open: the live runner keeps snapshots to go back to (and lets them go when the builder closes).
  useEffect(() => armAgentStepping(), []);
  // The group's step, a few times a second (the runner writes it every frame).
  useEffect(() => {
    const tick = () => setStats(prev => {
      const next = agentStatsFor(groupId);
      return prev && next && prev.step === next.step && prev.stepsPerFrame === next.stepsPerFrame && prev.count === next.count ? prev : next;
    });
    tick();
    const id = setInterval(tick, 100);
    return () => clearInterval(id);
  }, [groupId]);

  const now = stats?.step ?? 0;
  const canBack = info.first !== null && now > info.first;
  const spf = stats?.stepsPerFrame ?? 1;
  const forward = (frame = false) => { if (playing) setPlaying(false); stepAgents(frame ? spf : 1); };
  const back = () => { if (playing) setPlaying(false); stepAgentsBack(); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    // Handled here only: the app's time hotkeys (hooks/useTimeHotkeys.ts) would also seek the clock (←/→) or toggle it again (Space).
    if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); forward(e.shiftKey); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); if (canBack) back(); }
    else if (e.key === ' ') { e.preventDefault(); e.stopPropagation(); setPlaying(!playing); }
  };

  const reach = info.reach || BACK_MAX;
  const backNote = canBack
    ? `Back as far as step ${info.first}`
    : playing ? 'Pause to step' : 'Step forward or play to keep steps to go back to';
  return (
    <div data-agent-transport role="toolbar" aria-label="Step through the walkers (← → Space)" tabIndex={0} onKeyDown={onKey}
      style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderTop: `1px solid ${tk.border.subtle}`, background: tk.bg.subtle, flexWrap: 'wrap', rowGap: 6, outline: 'none' }}>
      <IconButton icon="reset" size="sm" label="Start over: back to step 0, every walker born again, the trails and kept steps cleared" onClick={() => resetRuntime()} data-agent-rewind data-agent-reset />
      <IconButton icon="chevL" size="sm" label="One step back (←)" onClick={back} disabled={!canBack} data-agent-back />
      <IconButton icon={playing ? 'pause' : 'play'} size="sm" label={playing ? 'Pause (Space)' : 'Play (Space)'} active={playing} onClick={() => setPlaying(!playing)} data-agent-play />
      <IconButton icon="chevR" size="sm" label={`One step forward (→; Shift: a whole frame, ${spf} steps)`} onClick={e => forward(e.shiftKey)} data-agent-forward />
      <span data-agent-step style={{ font: `600 12px ${fontFamily.mono}`, color: tk.text.primary, minWidth: 84 }}>
        {stats ? `Step ${stats.step}` : 'Step –'}
      </span>
      <span data-agent-back-note style={{ fontSize: 11.5, color: tk.text.muted }}>{backNote}</span>
      <span style={{ flex: 1 }} />
      <span style={{ fontSize: 11, color: tk.text.faint }} title="Before every frame that steps, a copy of the walkers' and trails' textures is kept to go back to; older ones are let go to keep the memory down.">
        Keeps the last {reach} frames
      </span>
    </div>
  );
}
