/**
 * Every `showWhen` (and its `and`) must name a param the node really has. A condition on a
 * missing key hides its slider for good: raymarch3d's Repeat X/Z, Noise Scale/Warp, Cone Angle,
 * Twist Amount, Round Radius and Blend radius pointed at `shape` (the key is `scene`) and never
 * appeared.
 */
import { describe, it, expect } from 'vitest';
import { NODE_REGISTRY } from '..';

describe('showWhen conditions', () => {
  it('name a real param of the node', () => {
    const bad: string[] = [];
    for (const [type, def] of Object.entries(NODE_REGISTRY)) {
      const defs = def.paramDefs ?? {};
      for (const [key, pd] of Object.entries(defs)) {
        const conds = [pd.showWhen, pd.showWhen?.and].filter(Boolean) as { param: string }[];
        for (const c of conds) {
          // agentSpace is a hidden param the Agents 3D sync writes (agentRules/space3d.ts)
          if (c.param !== 'agentSpace' && !(c.param in defs) && !(c.param in (def.defaultParams ?? {}))) bad.push(`${type}.${key} → ${c.param}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('raymarch3d shape sliders show for their scene', () => {
    const d = NODE_REGISTRY.raymarch3d.paramDefs!;
    expect(d.cone_angle.showWhen).toEqual({ param: 'scene', value: 'cone' });
    const opts = (d.scene.options ?? []).map(o => o.value);
    for (const k of ['repeat_x', 'repeat_z', 'noise_scale', 'noise_strength', 'twist_k', 'round_r', 'blend_k']) {
      expect(d[k].showWhen?.param).toBe('scene');
      expect(opts).toContain(d[k].showWhen!.value as string);
    }
  });

  it('rayRender Iter Scale and palette show where they are read (Distance)', () => {
    const d = NODE_REGISTRY.rayRender.paramDefs!;
    expect(d.iter_scale.showWhen?.value).toEqual(['distance']);
    expect(d.pal_r.showWhen?.value).toEqual(['distance']);
  });
});
