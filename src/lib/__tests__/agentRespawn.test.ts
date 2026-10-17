/**
 * Respawn (the Agent Builder's ✦, lib/agentRunner.ts respawnAgents): every walker born again from its Emit at the
 * next step while the trail, the step count and the clock carry on — unlike a start over (restartAgents).
 */
import { describe, expect, it } from 'vitest';
import { respawnAgents, respawnPending, restartAgents, restartPending, settleRestarts, takeRespawn, trailStartsOver } from '../agentRunner';
import { agGroupState, agGroupSteps, agStepWindow } from '../../play/kit/agentPlan.js';

const read = (v: unknown, d: number) => (typeof v === 'number' ? v : d);
// A group born a few at a time (a Rate emit), so a whole birth window only comes from a Burst.
const g = { emit: { mode: 'rate', rate: 4, burst: 0 }, params: { stepsPerFrame: 1, preroll: 0, restart: 0 } };
const N = 64;

describe('respawn', () => {
  it('re-seeds every walker at the next step without starting the group over', () => {
    const s = agGroupState();
    // The first live frame anchors the clock (a start over of its own), then a while runs: some born, the step count moving on.
    agGroupSteps(s, g, read, { live: true, time: 0, cap: Infinity, restart: false }, () => {});
    for (let i = 0; i < 5; i++) { agStepWindow(s, g, N, read); s.step++; }
    expect(agStepWindow(s, g, N, read).count).toBeLessThan(N);
    s.step++;
    const stepWas = s.step;

    respawnAgents('grp');
    expect(respawnPending('grp')).toBe(true);
    expect(restartPending('grp')).toBe(false);
    expect(takeRespawn(s, 'grp')).toBe(true);
    expect(respawnPending('grp')).toBe(false);
    // Taken once: the next frame doesn't respawn again.
    expect(takeRespawn(s, 'grp')).toBe(false);

    // The live schedule isn't a start over: no restart, the step count kept.
    let restartedState = false;
    const r = agGroupSteps(s, g, read, { live: true, time: 0.1, cap: Infinity, restart: false }, () => { restartedState = true; });
    expect(r.restarted).toBe(false);
    expect(restartedState).toBe(false);
    expect(s.step).toBe(stepWas);
    // Its next step's birth window is everyone (the Emit's Born positions), once.
    expect(agStepWindow(s, g, N, read)).toMatchObject({ start: 0, count: N });
    expect(agStepWindow(s, g, N, read).count).toBeLessThan(N);
  });

  it('keeps the trail: only a group that started over empties the trails it deposits into', () => {
    const deposits = [{ trail: 'trailA', group: 'g1' }, { trail: 'trailB', group: 'g2' }];
    // A respawn adds nothing to the frame's started-over groups.
    expect(trailStartsOver('trailA', deposits, new Set())).toBe(false);
    // A start over (↺) does, and its trail starts empty; another group's trail is kept.
    expect(trailStartsOver('trailA', deposits, new Set(['g1']))).toBe(true);
    expect(trailStartsOver('trailB', deposits, new Set(['g1']))).toBe(false);
  });

  it('is separate from a start over', () => {
    restartAgents('grp2');
    expect(restartPending('grp2')).toBe(true);
    expect(respawnPending('grp2')).toBe(false);
    settleRestarts(['grp2'], ['grp2']);
    expect(restartPending('grp2')).toBe(false);
  });
});
