/**
 * Draw agents' Sprite (docs/agent-sprites.md): a Pass's Texture drawn as each walker. The compiler names
 * the Pass on the draw and keeps it drawn; anything but a Pass's Texture asks for a Pass in between.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { compileGraph } from '../graphCompiler';
import type { CompilationResult } from '../types';
import type { GraphNode } from '../../types/nodeGraph';
import { rulesTemplateNodes } from '../../agentRules/templates';
import { n } from '../../store/graphBuilder';
import { GP_SHADERS } from '../../play/kit/gpuParticles.js';
import { DrawAgentsNode } from '../../nodes/definitions/agents';

const compile = (nodes: GraphNode[]) => compileGraph({ nodes }) as CompilationResult;

/** The particles template, with a Pass of a colour wired into its Draw agents' Sprite. */
function withSprite(from: 'pass' | 'picture'): GraphNode[] {
  const nodes = rulesTemplateNodes('particles', 'rp', 0, 0);
  const draw = nodes.find(x => x.type === 'drawAgents')!;
  const pic = n('colorPicker', 'spritePic', -400, 600, { color: [1, 0.5, 0.2] });
  const pass = n('pass', 'spritePass', -200, 600, { label: 'Sprite' }, { color: ['spritePic', 'rgb'] });
  const photo = n('textureInput', 'photo', -400, 800, {});
  draw.inputs.sprite = { type: 'texture', label: 'Sprite', connection: from === 'pass' ? { nodeId: 'spritePass', outputKey: 'texture' } : { nodeId: 'photo', outputKey: 'texture' } };
  return [...nodes, pic, pass, photo];
}

describe('Draw agents: Sprite', () => {
  it('has a Sprite input and Sprite colours (own by default)', () => {
    expect(DrawAgentsNode.inputs.sprite.type).toBe('texture');
    expect(DrawAgentsNode.defaultParams!.spriteColour).toBe('own');
  });

  it('a Pass\'s Texture: named on the draw, and the Pass is drawn though only the sprite reads it', () => {
    const r = compile(withSprite('pass'));
    expect(r.errors ?? []).toEqual([]);
    const d = r.agents!.draws[0];
    const pass = r.passes!.find(p => p.nodeId === 'spritePass')!;
    expect(d.sprite).toBe(pass.slug);
    expect(pass.live).toBe(true);
  });

  it('a texture straight from a picture asks for a Pass in between', () => {
    const r = compile(withSprite('picture'));
    expect((r.errors ?? []).join(' ')).toMatch(/Sprite takes a Pass's Texture/);
  });

  it('the point shader draws the sprite, own colours or tinted', () => {
    const fs = (GP_SHADERS as Record<string, string>).GP_DRAW_FRAG;
    expect(fs).toContain('uniform int u_useSprite, u_spriteOwn;');
    expect(fs).toContain('texture(u_sprite, vec2(gl_PointCoord.x, 1.0 - gl_PointCoord.y))');
  });
});
