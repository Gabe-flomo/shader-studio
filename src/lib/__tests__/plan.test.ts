/** The entitlement matrix: every feature on Free, Pro and signed out, and requireFeature's Pro sheet. */
import { afterEach, describe, expect, it } from 'vitest';
import { ALL_FEATURES, FEATURES, can, canOn, closeProSheet, requireFeature, usePlan, useProSheet, type Feature } from '../plan';

const FREE: Feature[] = ['studio', 'present', 'glsl', 'builder', 'learn', 'nodes.import', 'play.controls'];
const PRO_ONLY: Feature[] = ['play.layers', 'play.sources', 'play.backgrounds', 'play.finish', 'play.audioFx', 'play.takes', 'play.midiFile', 'audio.engine', 'audio.plugins', 'play.output', 'play.projection', 'convert', 'export.hires', 'export.website', 'files.everything', 'files.install', 'nodes.publish', 'nodes.pack'];

afterEach(() => {
  usePlan.getState().setSession({ status: 'signed-in', user: '', plan: 'pro', source: 'open' });
  closeProSheet();
});

describe('can()', () => {
  it('lists each feature once, as Free or Pro', () => {
    expect([...FREE, ...PRO_ONLY].sort()).toEqual([...ALL_FEATURES].sort());
    for (const f of FREE) expect(FEATURES[f].plan).toBe('free');
    for (const f of PRO_ONLY) expect(FEATURES[f].plan).toBe('pro');
  });

  it('Pro can do everything', () => {
    for (const f of ALL_FEATURES) expect(canOn('pro', f)).toBe(true);
  });

  it('Free can do the Free list and nothing else', () => {
    for (const f of FREE) expect(canOn('free', f)).toBe(true);
    for (const f of PRO_ONLY) expect(canOn('free', f)).toBe(false);
  });

  it('signed out can do nothing', () => {
    for (const f of ALL_FEATURES) expect(canOn(null, f)).toBe(false);
  });

  it('follows the session', () => {
    expect(can('convert')).toBe(true); // open (no gate) by default
    usePlan.getState().setSession({ status: 'signed-in', user: 't', plan: 'free', source: 'gate' });
    expect(can('convert')).toBe(false);
    expect(can('studio')).toBe(true);
    usePlan.getState().setSession({ status: 'signed-out' });
    expect(can('studio')).toBe(false);
  });
});

describe('requireFeature', () => {
  it('opens the Pro sheet about the feature on Free, and passes on Pro', () => {
    usePlan.getState().setSession({ status: 'signed-in', user: 't', plan: 'free', source: 'gate' });
    expect(requireFeature('export.hires')).toBe(false);
    expect(useProSheet.getState()).toEqual({ open: true, feature: 'export.hires' });
    closeProSheet();
    expect(requireFeature('glsl')).toBe(true);
    expect(useProSheet.getState().open).toBe(false);
    usePlan.getState().setSession({ status: 'signed-in', user: 't', plan: 'pro', source: 'gate' });
    expect(requireFeature('export.hires')).toBe(true);
    expect(useProSheet.getState().open).toBe(false);
  });
});
