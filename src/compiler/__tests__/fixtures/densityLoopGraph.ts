/**
 * The graph from a user's report (saved as "crashed"), rebuilt in code: a spark fountain whose Draw
 * agents' Density runs a Stops Palette that is wired back into the same Draw agents' Over, to colour
 * the background by where the walkers are. That is a loop within one frame (no Pass in it).
 *
 *   Emit → Agents group → Deposit → Trail (unused)
 *   Agents group → Draw agents · Agents
 *   Draw agents · Density → Stops Palette · Value → Draw agents · Over   ← the loop
 *   Draw agents · Color → Output
 */
import type { GraphNode } from '../../../types/nodeGraph';
import { n } from '../../../store/graphBuilder';
import { agentsGroup } from '../../../store/agentExampleKit';

export function densityLoopGraph(opts: { loop?: boolean } = {}): GraphNode[] {
  const loop = opts.loop !== false;
  const inputs = n('agentInputs', 'node_1_in', 0, 0, { _groupOriginal: true });
  const move = n('agentMove', 'node_1_move', 400, 0, { speed: 0.09, edges: 'bounce' }, { heading: ['node_1_in', 'heading'] });
  const output = n('agentOutput', 'node_1_out', 800, 0, { _groupOriginal: true }, { position: ['node_1_move', 'position'], heading: ['node_1_move', 'heading'] });
  return [
    n('output', 'n2', 2000, 0, {}, { color: ['node_13', 'color'] }),
    n('agentEmit', 'node_0', 0, 0, { mode: 'respawn', shape: 'disc', heading: 'up', size: 0.18, speed: 1.1 }),
    agentsGroup('node_1', 400, 0, 'node_0', [inputs, move, output], { tier: '64k', label: 'Spark fountain (rules)', stepsPerFrame: 1, preroll: 4 }),
    n('agentDeposit', 'node_10', 800, 300, { amount: 0.35 }, { agents: ['node_1', 'agents'] }),
    n('trailField', 'node_11', 1200, 300, { resolution: '512' }, { deposit: ['node_10', 'deposit'] }),
    n('stopPalette', 'node_12', 1200, -300, { stops: '5', wrap: 'clamp' }, { value: ['node_13', 'density'] }),
    n('drawAgents', 'node_13', 1600, 0, { style: 'glow', palette: 'ember', size: 0.5, brightness: 0.22 },
      loop ? { agents: ['node_1', 'agents'], over: ['node_12', 'color'] } : { agents: ['node_1', 'agents'] }),
  ];
}
