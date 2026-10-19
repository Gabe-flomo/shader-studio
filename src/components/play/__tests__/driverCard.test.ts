/**
 * A control's "driven by" chip on a phone opens what drives it in Sources (Play audit P20):
 * mappingGroups.ts driverCardFor / driverFoldKeys.
 */
import { describe, expect, it } from 'vitest';
import { driverCardFor, driverFoldKeys, mappingFoldKey, sourceFoldKey, sourceGroupFoldKey } from '../mappingGroups';
import type { PlayMapping, PlaySourceDef } from '../../../types/play';

const mapping = (id: string, controlId: string, enabled = true): PlayMapping => ({ id, controlId, source: { kind: 'key', code: 'Space' }, outMin: 0, outMax: 1, curve: 'linear', smoothMs: 30, enabled });
const source = (id: string, to: string, enabled = true, routeOn = true): PlaySourceDef => ({
  id, enabled, source: { kind: 'midi', signal: 'cc', channel: 0 },
  outputs: [{ kind: 'value', routes: [{ id: `${id}r`, to, enabled: routeOn, mode: 'replace' }] }],
} as unknown as PlaySourceDef);

describe('driverCardFor', () => {
  it('a mapping onto the control first, skipping switched-off ones', () => {
    const d = driverCardFor({ mappings: [mapping('m0', 'c1', false), mapping('m1', 'c1')], sources: [source('s1', 'c1')] }, 'c1');
    expect(d).toMatchObject({ kind: 'mapping', id: 'm1' });
    expect(driverFoldKeys(d!)).toEqual([sourceGroupFoldKey(d!.group), mappingFoldKey('m1')]);
  });
  it('else a source with a route onto it', () => {
    const d = driverCardFor({ mappings: [], sources: [source('s0', 'c1', true, false), source('s1', 'c1')] }, 'c1');
    expect(d).toMatchObject({ kind: 'source', id: 's1', group: 'midi' });
    expect(driverFoldKeys(d!)).toEqual([sourceGroupFoldKey('midi'), sourceFoldKey('s1')]);
  });
  it('null when nothing drives it', () => {
    expect(driverCardFor({ mappings: [mapping('m1', 'c2')] }, 'c1')).toBeNull();
    expect(driverCardFor({ mappings: [], sources: [source('s1', 'c1', false)] }, 'c1')).toBeNull();
  });
});
