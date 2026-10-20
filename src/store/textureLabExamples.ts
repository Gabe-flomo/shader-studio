/**
 * textureLabExamples.ts — Texture Lab's examples (docs/texture-lab.md): two stacks built by Texture Lab itself
 * (textureLab/apply.ts), so every node is a plain Texture tools node (or a Pass, or a Mix for its Amount) with the note
 * Texture Lab gives it, and Scene builder → Edit this one reopens them in Texture Lab.
 *
 *  - Thermal: the Room and cat photo as a heat camera (Blur → Channel → Curves as a gradient map → Glow);
 *  - Motion trails: the Ball action clip's movement leaving drifting trails (Change → Feedback → Levels).
 *
 * The Texture tools folder keeps its curated five, so these open by key (and from the What's new link).
 */
import type { ExampleGraph } from './exampleIndex';
import type { GraphNode } from '../types/nodeGraph';
import { n } from './graphBuilder';
import { applyTextureLab } from '../textureLab/apply';
import { withPreset } from '../textureLab/presets';
import { blankSpec, type TxSource } from '../textureLab/spec';

export const TEXTURE_LAB_EXAMPLE_INDEX: Record<string, { label: string; description: string }> = {
  texLabThermal: {
    label: 'Texture Lab · Thermal camera',
    description: 'Made in Texture Lab: the Room and cat photo softened (Blur), turned to its brightness (Channel), coloured like a heat camera by three tone curves (Curves as a gradient map) and the hottest parts glowing (Glow, after a Pass). Open the Scene builder and press Edit this one to change it in Texture Lab.',
  },
  texLabTrails: {
    label: 'Texture Lab · Motion trails',
    description: 'Made in Texture Lab: Change finds what moved in the Ball action clip (a Pass gives it the frame before), Feedback keeps a fading trail of it that drifts outwards, and Levels rolls off the brightest overlaps. Each tool has a Mix after it: its Amount.',
  },
};

function labGraph(source: TxSource, preset: string): GraphNode[] {
  let i = 0;
  const out = n('output', 'out', 0, 0, { __comment: 'Output: the end of the Texture Lab stack.' });
  return applyTextureLab([out], withPreset(blankSpec(source), preset), { nextId: () => `lab${++i}` }).nodes;
}

export function buildTextureLabExamples(): Record<string, ExampleGraph> {
  return {
    texLabThermal: { ...TEXTURE_LAB_EXAMPLE_INDEX.texLabThermal, counter: 60, nodes: labGraph({ kind: 'room' }, 'thermal') },
    texLabTrails: { ...TEXTURE_LAB_EXAMPLE_INDEX.texLabTrails, counter: 60, nodes: labGraph({ kind: 'ball' }, 'trails') },
  };
}
