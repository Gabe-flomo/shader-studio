/**
 * An Expression Block line switched off: kept in the block, compiled as a
 * comment (skipped); switching it back on restores it.
 */
import { describe, it, expect, vi } from 'vitest';
vi.hoisted(() => vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} }));
import { compileGraph } from '../graphCompiler';
import { n, out } from '../../store/graphBuilder';
import { toggleLineOff } from '../../lib/exprLines';

type Line = { lhs: string; op: string; rhs: string; off?: boolean };
const block = (lines: Line[]) =>
  [n('exprNode', 'e', 0, 0, { lines, result: 'v', outputType: 'float', inputs: [] }), out(['e', 'result'], 300)];

describe('expression lines on and off', () => {
  it('an off line is a comment in the shader; the others still run', () => {
    const lines: Line[] = [{ lhs: 'float v', op: '=', rhs: '0.25' }, { lhs: 'v', op: '+=', rhs: '0.5' }];
    const on = compileGraph({ nodes: block(lines) }).fragmentShader;
    expect(on).toMatch(/v \+= 0\.5;/);
    const off = compileGraph({ nodes: block(toggleLineOff(lines, 1)) });
    expect(off.errors ?? []).toEqual([]);
    expect(off.fragmentShader).toContain('// off: v += 0.5');
    expect(off.fragmentShader).not.toMatch(/^\s*v \+= 0\.5;/m);
  });

  it('toggling twice gives back the line as it was', () => {
    const lines: Line[] = [{ lhs: 'a', op: '=', rhs: '1.0' }];
    expect(toggleLineOff(lines, 0)).toEqual([{ lhs: 'a', op: '=', rhs: '1.0', off: true }]);
    expect(toggleLineOff(toggleLineOff(lines, 0), 0)).toEqual(lines);
  });
});
