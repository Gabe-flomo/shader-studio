import { describe, it, expect, afterEach } from 'vitest';
import { midiEngine, midiNoteName } from '../midiEngine';
import type { InputWriter } from '../inputBus';

function collect(dt = 1 / 60): Map<string, number> {
  const out = new Map<string, number>();
  const write: InputWriter = (k, v) => { if (typeof v === 'number') out.set(k, v); };
  midiEngine.tickInputs(dt, 0, write);
  return out;
}

afterEach(() => {
  midiEngine.removeNode('n');
  midiEngine.removeNode('m');
  // Release anything held so tests don't leak gate state into each other.
  for (let note = 0; note < 128; note++) for (let ch = 0; ch < 16; ch++) midiEngine.handleBytes(0x80 | ch, note, 0);
});

describe('midiEngine', () => {
  it('parses note on/off, running note-on with velocity 0 as off', () => {
    midiEngine.updateNode('n', { channel: 'all', smooth_ms: 0, _ccs: [1] });
    midiEngine.handleBytes(0x90, 64, 100);
    let v = collect();
    expect(v.get('n::gate')).toBe(1);
    expect(v.get('n::note')).toBeCloseTo(64 / 127);
    expect(v.get('n::velocity')).toBeCloseTo(100 / 127);
    midiEngine.handleBytes(0x90, 64, 0); // note-on vel 0 == note-off
    v = collect();
    expect(v.get('n::gate')).toBe(0);
    // last note/velocity hold after release (that's the "last note" output)
    expect(v.get('n::note')).toBeCloseTo(64 / 127);
    expect(v.get('n::velocity')).toBeCloseTo(100 / 127);
  });

  it('keeps the gate high while any key is held', () => {
    midiEngine.updateNode('n', { channel: 'all', smooth_ms: 0, _ccs: [1] });
    midiEngine.handleBytes(0x90, 60, 90);
    midiEngine.handleBytes(0x90, 67, 90);
    midiEngine.handleBytes(0x80, 60, 0);
    expect(collect().get('n::gate')).toBe(1);
    midiEngine.handleBytes(0x80, 67, 0);
    expect(collect().get('n::gate')).toBe(0);
  });

  it('separates channels: a channel-3 node ignores channel-1 messages, omni sees both', () => {
    midiEngine.updateNode('n', { channel: '3', smooth_ms: 0, _ccs: [7] });
    midiEngine.updateNode('m', { channel: 'all', smooth_ms: 0, _ccs: [7] });
    midiEngine.handleBytes(0xb0 | 0, 7, 127); // CC7 on ch 1
    let v = collect();
    expect(v.get('n::cc_7')).toBe(0);
    expect(v.get('m::cc_7')).toBeCloseTo(1);
    midiEngine.handleBytes(0xb0 | 2, 7, 64);  // CC7 on ch 3
    v = collect();
    expect(v.get('n::cc_7')).toBeCloseTo(64 / 127);
    expect(v.get('m::cc_7')).toBeCloseTo(64 / 127);
  });

  it('maps pitch bend to -1..1 with centre at 0', () => {
    midiEngine.updateNode('n', { channel: 'all', smooth_ms: 0, _ccs: [1] });
    midiEngine.handleBytes(0xe0, 0x00, 0x40); // 8192 = centre
    expect(collect().get('n::bend')).toBeCloseTo(0);
    midiEngine.handleBytes(0xe0, 0x7f, 0x7f);
    expect(collect().get('n::bend')).toBeCloseTo(1, 2);
    midiEngine.handleBytes(0xe0, 0x00, 0x00);
    expect(collect().get('n::bend')).toBeCloseTo(-1);
  });

  it('smooths toward the target and settles exactly', () => {
    midiEngine.updateNode('n', { channel: 'all', smooth_ms: 100, _ccs: [1] });
    midiEngine.handleBytes(0xb0, 1, 0);
    collect(1); // long frame: settle at 0
    midiEngine.handleBytes(0xb0, 1, 127);
    const first = collect(1 / 60).get('n::cc_1')!;
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(1);
    const second = collect(1 / 60).get('n::cc_1')!;
    expect(second).toBeGreaterThan(first);
    for (let i = 0; i < 200; i++) collect(1 / 60);
    expect(collect(1 / 60).get('n::cc_1')).toBe(1);
  });

  it('names notes', () => {
    expect(midiNoteName(60)).toBe('C4');
    expect(midiNoteName(61)).toBe('C#4');
    expect(midiNoteName(21)).toBe('A0');
  });
});
