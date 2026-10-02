/**
 * Setups for the golden outputs that cover what the examples may not: each
 * source kind, curves and smoothing, colour channels, trigger modes,
 * increments, actions and signal chains, pairs and swaps, spreads, level
 * signals, capture and Set, timing and chance, links and loops, the newer
 * conditions. Each is small; together they pin the engine's behaviour down.
 */
import { defaultIncrement, emptyPlayRecord, type PlayAction, type PlayControl, type PlayIncrement, type PlayMapping, type PlayRecord, type PlaySource, type TriggerSpec, type ValueCondition } from '../../../types/play';

const ctl = (id: string, over: Partial<PlayControl> = {}): PlayControl => ({ id, target: `n::${id}`, kind: 'float', label: id, min: 0, max: 10, ...over });
let n = 0;
const map = (controlId: string, source: PlaySource, over: Partial<PlayMapping> = {}): PlayMapping => ({ id: `m${++n}`, controlId, source, outMin: 0, outMax: 10, curve: 'linear', smoothMs: 0, enabled: true, ...over });
const trig = (trigger: TriggerSpec, mode: 'envelope' | 'toggle' | 'step' | 'random', over: Record<string, unknown> = {}): PlaySource => ({ kind: 'trigger', trigger, mode, attack: 50, decay: 100, sustain: 0.5, release: 150, steps: 4, velocity: false, ...over } as PlaySource);
const cond = (value: string, cmp: ValueCondition['cmp'], threshold: number, over: Partial<ValueCondition> = {}): ValueCondition => ({ value, cmp, threshold, hysteresis: 0.05, tolerance: 0.01, ...over });
const key = (code = 'Space'): TriggerSpec => ({ on: 'key', code });
const inc = (over: Partial<PlayIncrement>): PlayIncrement => ({ ...defaultIncrement(1, 120), ...over });
const rec = (over: Partial<PlayRecord>): PlayRecord => ({ ...emptyPlayRecord(), ...over });
const act = (id: string, trigger: TriggerSpec, over: Partial<PlayAction> = {}): PlayAction => ({ id, trigger, do: 'signal', layerId: '', amount: 1, enabled: true, ...over });
const sigTrig = (signal: string, fire?: 'held' | 'release'): TriggerSpec => ({ on: 'signal', signal, ...(fire ? { fire: { mode: fire, every: 1, unit: 'frames' as const } } : {}) });

export const GOLDEN_FIXTURES: Record<string, PlayRecord> = {
  generators: rec({
    controls: ['sine', 'tri', 'saw', 'sq', 'clk', 'smooth', 'drift', 'stepped', 'fn'].map(id => ctl(id)),
    mappings: [
      map('sine', { kind: 'lfo', shape: 'sine', rate: 0.7, phase: 0 }),
      map('tri', { kind: 'lfo', shape: 'triangle', rate: 1.3, phase: 0.25 }, { curve: 'exp' }),
      map('saw', { kind: 'lfo', shape: 'saw', rate: 0.5, phase: 0 }, { curve: 'log', outMin: 10, outMax: 2 }),
      map('sq', { kind: 'lfo', shape: 'square', rate: 2, phase: 0 }, { smoothMs: 80 }),
      map('clk', { kind: 'clock', shape: 'saw', bpm: 90, beats: 2 }),
      map('smooth', { kind: 'noise', type: 'smooth', rate: 2, seed: 3, steps: 0 }),
      map('drift', { kind: 'noise', type: 'drift', rate: 1, seed: 4, steps: 0 }),
      map('stepped', { kind: 'noise', type: 'stepped', rate: 3, seed: 5, steps: 4 }),
      map('fn', { kind: 'fn', expr: 'sin(t * 3) * 0.5 + 0.5', min: 0, max: 1 }),
    ],
  }),
  inputs: rec({
    controls: ['cc', 'note', 'vel', 'gate', 'bend', 'key', 'mx', 'my', 'md', 'chain'].map(id => ctl(id)),
    mappings: [
      map('cc', { kind: 'midi', signal: 'cc', channel: 0, cc: 21 }, { smoothMs: 40 }),
      map('note', { kind: 'midi', signal: 'note', channel: 0 }),
      map('vel', { kind: 'midi', signal: 'velocity', channel: 0 }),
      map('gate', { kind: 'midi', signal: 'gate', channel: 0 }),
      map('bend', { kind: 'midi', signal: 'bend', channel: 0 }),
      map('key', { kind: 'key', code: 'KeyA' }, { smoothMs: 100 }),
      map('mx', { kind: 'mouse', axis: 'x' }),
      map('my', { kind: 'mouse', axis: 'y' }, { curve: 'custom', curveY: Array.from({ length: 25 }, (_, i) => Math.abs(Math.sin(i / 4))) }),
      map('md', { kind: 'mouse', axis: 'down' }),
      map('chain', { kind: 'control', controlId: 'mx' }, { outMin: 5, outMax: 0 }),
    ],
  }),
  colour: rec({
    controls: [ctl('tint', { kind: 'color', min: 0, max: 1 }), ctl('tint2', { kind: 'color', min: 0, max: 1 })],
    mappings: [
      map('tint', { kind: 'mouse', axis: 'x' }, { channel: 0, outMax: 1 }),
      map('tint', { kind: 'lfo', shape: 'sine', rate: 1, phase: 0 }, { channel: 2, outMax: 1 }),
      map('tint2', { kind: 'mouse', axis: 'y' }, { outMax: 1 }),
    ],
  }),
  triggers: rec({
    controls: ['env', 'tog', 'step', 'rnd', 'beat', 'cond', 'click'].map(id => ctl(id)),
    mappings: [
      map('env', trig(key(), 'envelope')),
      map('tog', trig(key(), 'toggle')),
      map('step', trig({ on: 'beat', bpm: 120, beats: 1 }, 'step', { steps: 5 })),
      map('rnd', trig({ on: 'beat', bpm: 90, beats: 1 }, 'random')),
      map('beat', trig({ on: 'beat', bpm: 140, beats: 0.5 }, 'envelope', { attack: 0, decay: 60, sustain: 0, release: 0 })),
      map('cond', trig({ on: 'value', ...cond('mouse:x', 'crossUp', 0.6) }, 'toggle')),
      map('click', trig({ on: 'mouse' }, 'envelope', { velocity: true })),
    ],
  }),
  increments: rec({
    controls: ['a', 'b', 'c', 'd', 'e'].map(id => ctl(id)),
    signals: [{ id: 'stepped', name: 'Stepped' }, { id: 'wrapped', name: 'Wrapped' }],
    mappings: [
      map('a', trig(key(), 'envelope'), { increment: inc({ on: 'trigger', trigger: key(), step: 1.5, limit: 'wrap', stepSignal: 'stepped', resetSignal: 'wrapped' }) }),
      map('b', { kind: 'mouse', axis: 'x' }, { increment: inc({ on: 'threshold', threshold: 0.7, hysteresis: 0.1, step: 2, limit: 'bounce', glideMs: 120 }) }),
      map('c', { kind: 'clock', shape: 'saw', bpm: 120, beats: 4 }, { increment: inc({ on: 'repeat', every: 0.5, unit: 'seconds', step: 1, growth: 'compound', factor: 1.5, limit: 'clamp' }) }),
      map('d', { kind: 'clock', shape: 'saw', bpm: 120, beats: 4 }, { increment: inc({ on: 'trigger', trigger: sigTrig('stepped'), step: 0.5, start: 'value', startValue: 3, resetOn: 'wrapped' }) }),
      map('e', { kind: 'clock', shape: 'saw', bpm: 120, beats: 4 }, { increment: inc({ on: 'repeat', every: 1, unit: 'beats', bpm: 180, step: 1, wrapAfter: 3, wrapBack: 'glide', when: cond('mouse:y', 'above', 0.4) }) }),
    ],
  }),
  actionsAndChains: rec({
    controls: ['hits', 'relayed', 'btn'].map(id => ctl(id)),
    signals: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }],
    actions: [
      act('send', { ...key(), fire: { mode: 'every', every: 4, unit: 'frames' } }, { signal: 'a' }),
      act('relay', sigTrig('a'), { signal: 'b' }),
      act('relay2', sigTrig('b'), { signal: 'c' }),
      act('nth', { on: 'beat', bpm: 240, beats: 1, fire: { mode: 'nth', every: 3, unit: 'frames' } }, { signal: 'c' }),
    ],
    mappings: [
      map('hits', trig(sigTrig('c'), 'step', { steps: 8 })),
      map('relayed', trig(sigTrig('b', 'held'), 'toggle')),
      map('btn', trig({ on: 'mouse', fire: { mode: 'within', every: 2, unit: 'seconds', window: 0.5 } }, 'toggle')),
    ],
  }),
  pairsAndSpreads: rec({
    controls: [ctl('px', { min: 0, max: 1 }), ctl('py', { min: 0, max: 1 }), ctl('qa'), ctl('qb'), ctl('s1'), ctl('s2'), ctl('s3'), ctl('amt', { target: 'spread:sp::amount', min: -1, max: 1 })],
    pairs: [{ id: 'p', label: 'Pos', a: 'px', b: 'py', position: true }, { id: 'q', label: 'Q', a: 'qa', b: 'qb', position: false }],
    pairMappings: [
      { id: 'pm1', pairId: 'p', source: { kind: 'position', anchor: 'mouse' }, affect: 'both', a: { outMin: 0, outMax: 1, curve: 'linear', smoothMs: 50 }, b: { outMin: 0, outMax: 1, curve: 'linear', smoothMs: 50 }, enabled: true },
      { id: 'pm2', pairId: 'q', source: { kind: 'value', source: { kind: 'lfo', shape: 'triangle', rate: 0.8, phase: 0 } }, affect: 'a', a: { outMin: 0, outMax: 10, curve: 'linear', smoothMs: 0 }, b: { outMin: 0, outMax: 10, curve: 'linear', smoothMs: 0, when: cond('mouse:x', 'above', 0.5) }, swap: { at: 8, dir: 'up', backAt: 2, backDir: 'down' }, enabled: true },
    ],
    spreads: [{ id: 'sp', label: 'Spread', members: ['s1', 's2', 's3'], amount: 0.5, shift: 0, curve: 'linear', mode: 'offset' }],
    mappings: [map('amt', { kind: 'lfo', shape: 'sine', rate: 0.5, phase: 0 }, { outMin: -1, outMax: 1 })],
  }),
  levelSignals: rec({
    controls: ['both', 'none', 'held', 'fell'].map(id => ctl(id)),
    signals: [
      { id: 'hi', name: 'Right', when: { kind: 'trigger', trigger: { on: 'value', ...cond('mouse:x', 'above', 0.5) } } },
      { id: 'click', name: 'Click', when: { kind: 'trigger', trigger: { on: 'mouse' } } },
      { id: 'and', name: 'And', when: { kind: 'logic', op: 'and', inputs: ['hi', 'click'] } },
      { id: 'not', name: 'Not', when: { kind: 'logic', op: 'not', inputs: ['hi'] } },
    ],
    mappings: [
      map('both', trig(sigTrig('and'), 'toggle')),
      map('none', trig(sigTrig('not', 'held'), 'envelope')),
      map('held', trig(sigTrig('hi', 'held'), 'step', { steps: 30 })),
      map('fell', trig(sigTrig('hi', 'release'), 'step')),
    ],
  }),
  captureSet: rec({
    controls: [ctl('v'), ctl('set'), ctl('back'), ctl('rest'), ctl('dx', { min: 0, max: 1 }), ctl('dy', { min: 0, max: 1 })],
    signals: [
      { id: 'grab', name: 'Grab', when: { kind: 'trigger', trigger: { on: 'mouse' } }, capture: { what: 'ctl:v', at: 'rise' } },
      { id: 'track', name: 'Track', when: { kind: 'trigger', trigger: { on: 'value', ...cond('mouse:y', 'above', 0.5) } }, capture: { what: 'pos:mouse', at: 'held' } },
    ],
    pairs: [{ id: 'dot', label: 'Dot', a: 'dx', b: 'dy', position: true }],
    pairMappings: [{ id: 'pmd', pairId: 'dot', source: { kind: 'position', anchor: 'sig:track:held' }, affect: 'both', a: { outMin: 0, outMax: 1, curve: 'linear', smoothMs: 0 }, b: { outMin: 0, outMax: 1, curve: 'linear', smoothMs: 0 }, enabled: true }],
    mappings: [
      map('v', { kind: 'lfo', shape: 'saw', rate: 0.5, phase: 0 }),
      map('set', { kind: 'captured', signal: 'grab', release: 'stay' }),
      map('back', { kind: 'captured', signal: 'grab', release: 'back' }, { smoothMs: 60 }),
      map('rest', { kind: 'captured', signal: 'grab', release: 'value', rest: 2 }),
    ],
  }),
  timingAndLoops: rec({
    controls: ['late', 'chance', 'held', 'lap', 'trail'].map(id => ctl(id)),
    signals: [
      { id: 'k', name: 'Key', when: { kind: 'trigger', trigger: key() }, delay: 0.2 },
      { id: 'beat', name: 'Beat', when: { kind: 'trigger', trigger: { on: 'beat', bpm: 300, beats: 1 } }, chance: 0.5, seed: 9 },
      { id: 'hold', name: 'Hold', when: { kind: 'trigger', trigger: { on: 'value', ...cond('mouse:x', 'above', 0.5) } }, hold: 0.2, linger: 0.3 },
      { id: 'r1', name: 'R1', when: { kind: 'trigger', trigger: { on: 'mouse' } }, links: [{ to: 'r2', delay: 0.1 }] },
      { id: 'r2', name: 'R2', links: [{ to: 'r3', delay: 0.1 }] },
      { id: 'r3', name: 'R3', links: [{ to: 'r1', delay: 0.1 }] },
    ],
    loops: [{ key: 'r1|r2|r3', laps: 3 }],
    mappings: [
      map('late', trig(sigTrig('k', 'held'), 'envelope', { attack: 0, release: 0 })),
      map('chance', trig(sigTrig('beat'), 'step', { steps: 20 })),
      map('held', trig(sigTrig('hold', 'held'), 'envelope', { attack: 0, release: 0 })),
      map('lap', trig(sigTrig('r3'), 'step', { steps: 10 })),
      map('trail', { kind: 'mouse', axis: 'x' }, { delayMs: 150, smoothMs: 30 }),
    ],
  }),
  newerConditions: rec({
    controls: ['band', 'out', 'not', 'never', 'rise', 'fall', 'steady', 'pct'].map(id => ctl(id)).concat([ctl('src', { min: 0, max: 20 })]),
    mappings: [
      map('src', { kind: 'mouse', axis: 'x' }, { outMin: 0, outMax: 20 }),
      map('band', trig({ on: 'value', ...cond('mouse:x', 'between', 0.3, { hi: 0.6 }) }, 'toggle')),
      map('out', trig({ on: 'value', ...cond('mouse:x', 'outside', 0.3, { hi: 0.6 }) }, 'toggle')),
      map('not', trig({ on: 'value', ...cond('mouse:y', 'not', 0.5, { tolerance: 0.1 }) }, 'toggle')),
      map('never', trig({ on: 'value', ...cond('mouse:x', 'neverAbove', 0.85) }, 'envelope', { attack: 0, release: 0 })),
      map('rise', trig({ on: 'value', ...cond('mouse:x', 'rising', 0.01, { hysteresis: 0.005, window: 0.3, noise: 0.2 }) }, 'toggle')),
      map('fall', trig({ on: 'value', ...cond('mouse:x', 'falling', 0.01, { hysteresis: 0.005 }) }, 'toggle')),
      map('steady', trig({ on: 'value', ...cond('mouse:y', 'steady', 0.02) }, 'toggle')),
      map('pct', trig({ on: 'value', ...cond('ctl:src', 'above', 0.5, { unit: 'pct' }) }, 'toggle')),
    ],
  }),
};
