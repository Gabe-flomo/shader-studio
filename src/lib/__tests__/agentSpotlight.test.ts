import { describe, expect, it } from 'vitest';
import { CanvasProbeRegistry } from '../canvasProbeRegistry';
import { agentSpotRegistry, parseSpotColour, parseSpotSpecies } from '../agentRunner';
import { AG_SPOT_FRAG, AG_SPOT_VERT } from '../../play/kit/agentShaders.js';

const canvas = () => ({}) as HTMLCanvasElement;

describe('CanvasProbeRegistry size / keys', () => {
  it('counts main canvases and mirrors once per key', () => {
    const r = new CanvasProbeRegistry();
    expect(r.size()).toBe(0);
    expect(r.keys()).toEqual([]);
    r.register('a', canvas());
    const off = r.registerMirror('a', canvas());
    const offB = r.registerMirror('b', canvas());
    expect(r.size()).toBe(2);
    expect(r.keys().sort()).toEqual(['a', 'b']);
    offB();
    expect(r.size()).toBe(1);
    r.unregister('a');
    expect(r.size()).toBe(1); // a's mirror still shows it
    off();
    expect(r.size()).toBe(0);
    expect(r.keys()).toEqual([]);
  });

  it('the spotlight registry starts empty', () => {
    expect(agentSpotRegistry.size()).toBe(0);
  });
});

describe('spotlight dataset parsing', () => {
  it('reads the colour as 0–1 floats, white when it does not read', () => {
    expect(parseSpotColour('0.2, 0.5,1')).toEqual([0.2, 0.5, 1]);
    expect(parseSpotColour('2,-1,0.5')).toEqual([1, 0, 0.5]);
    expect(parseSpotColour(undefined)).toEqual([1, 1, 1]);
    expect(parseSpotColour('1,x,0')).toEqual([1, 1, 1]);
    expect(parseSpotColour('1,,0')).toEqual([1, 1, 1]);
  });

  it('reads the species index, -1 for all', () => {
    expect(parseSpotSpecies('0')).toBe(0);
    expect(parseSpotSpecies('3')).toBe(3);
    expect(parseSpotSpecies(undefined)).toBe(-1);
    expect(parseSpotSpecies('')).toBe(-1);
    expect(parseSpotSpecies('-1')).toBe(-1);
    expect(parseSpotSpecies('nope')).toBe(-1);
  });
});

describe('spotlight shaders', () => {
  it('declare the uniforms the runner sets', () => {
    for (const u of ['u_a', 'u_b', 'u_c', 'u_cam', 'u_side', 'u_stride', 'u_species', 'u_stateC', 'u_only', 'u_deep', 'u_camSrc', 'u_aspect', 'u_px', 'u_eye', 'u_fwd', 'u_right', 'u_up', 'u_lens', 'u_ortho', 'u_camDist']) {
      expect(AG_SPOT_VERT).toMatch(new RegExp(`\\b${u}\\b`));
    }
    expect(AG_SPOT_FRAG).toContain('u_col');
    expect(AG_SPOT_FRAG).toContain('u_gain');
  });
});
