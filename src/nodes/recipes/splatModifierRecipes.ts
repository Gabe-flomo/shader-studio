/**
 * splatModifierRecipes.ts — "Add a modifier" on a Splat Scene card (docs/splat-scene.md "Per-splat modifiers").
 *
 * Each pick adds one recipe node (Dissolve, Explode, Wave, Colour, Crop, Size & Opacity, Points) at the end of the
 * scene's Modifier chain: it takes what fed the Modifier (or the splat as loaded) and feeds the Modifier itself, so
 * modifiers stack in the order they were added. "Your own" adds Splat Attributes → Set Splat, for a chain of ordinary
 * nodes between them. Pure functions: the card runs them through rewriteTopLevel (one undo step). A Splat builder can
 * call the same functions to lay down its stack.
 */
import type { GraphNode } from '../../types/nodeGraph';
import { n, note } from './kit';
import { SPLAT_SCENE_TYPE } from '../definitions/splatScene';
import { SPLAT_RECIPE_TYPES } from '../definitions/splatModifiers';

export type SplatModifierPick = typeof SPLAT_RECIPE_TYPES[number] | 'custom';

/** The card's menu: what each pick adds, in plain words. */
export const SPLAT_MODIFIER_MENU: Array<{ pick: SplatModifierPick; label: string; hint: string }> = [
  { pick: 'splatDissolve', label: 'Dissolve by noise', hint: 'A threshold sweeps through noise: splats fade or shrink away with a glowing edge (Amount 0 → 1).' },
  { pick: 'splatExplode', label: 'Explode / scatter', hint: 'Blows the splats out from a point; Return home brings them back.' },
  { pick: 'splatWave', label: 'Wave / wobble', hint: 'A travelling wave, a noisy wobble or a twist moves the splats.' },
  { pick: 'splatColor', label: 'Colour grade', hint: 'Hue, saturation, brightness, contrast and a tint.' },
  { pick: 'splatCrop', label: 'Crop / clip plane', hint: 'Keeps what is inside a box or sphere, or below a plane: sweep it to reveal the scan.' },
  { pick: 'splatLook', label: 'Size & opacity', hint: 'Bigger or smaller splats, an opacity floor, or only a share of them (sparse or dense looks).' },
  { pick: 'splatPoints', label: 'Points', hint: 'Every splat as a crisp dot: a point cloud.' },
  { pick: 'custom', label: 'Your own nodes', hint: 'Splat Attributes → (your Noise, maths, Expression Blocks…) → Set Splat.' },
];

const NOTES: Record<string, string[]> = {
  splatDissolve: ['Splat Dissolve: as Amount goes from 0 to 1, a threshold sweeps through noise and the splats below it fade and shrink away, with a glowing edge.', 'Map Amount in Play (an LFO, a key, the mouse) or keyframe it.'],
  splatExplode: ['Splat Explode: Amount blows the splats out from Center, each a little after the last (Stagger); Return home brings them back.'],
  splatWave: ['Splat Wave: a wave travelling through the scan (or a wobble, or a twist) moves every splat. Amplitude 0 is still.'],
  splatColor: ['Splat Colour: grades the scan: hue, saturation, brightness, contrast and a tint.'],
  splatCrop: ['Splat Crop: keeps the splats below a plane (or inside a box or sphere). Sweep Offset to reveal the scan.'],
  splatLook: ['Splat Size & Opacity: scales the splats, lifts faint ones to an opacity floor, or keeps only a share of them.'],
  splatPoints: ['Splat Points: every splat as a crisp dot, Dot size pixels across.'],
};

/**
 * Add a modifier to a Splat Scene's chain: `pick` goes between what fed its Modifier and the Modifier. Null when the
 * node isn't a Splat Scene.
 */
export function addSplatModifier(nodes: GraphNode[], splatId: string, pick: SplatModifierPick, nextId: () => string): GraphNode[] | null {
  const scan = nodes.find(x => x.id === splatId && x.type === SPLAT_SCENE_TYPE);
  if (!scan) return null;
  const prev = scan.inputs.modifier?.connection;
  // Left of the scan, a step further left for each modifier already in the chain.
  let depth = 0;
  for (let at = prev?.nodeId; at && depth < 32; depth++) at = nodes.find(x => x.id === at)?.inputs.splat?.connection?.nodeId;
  const x = scan.position.x - 420 * (depth + 1), y = scan.position.y + 420;
  const from: Record<string, [string, string]> = prev ? { splat: [prev.nodeId, prev.outputKey] } : {};
  const added: GraphNode[] = [];
  let last: string;
  if (pick === 'custom') {
    const attrs = n('splatAttributes', nextId(), x - 420, y, note('Splat Attributes: this splat as numbers (where it is, its colour, opacity, size, its place in the scan, a random number).', 'Wire them through any nodes into Set Splat: the chain runs once for every splat.'), from);
    const set = n('splatSet', nextId(), x, y, note('Set Splat: what you wire here changes the splat (Offset moves it, Color recolours it…); unwired sockets keep it as it was.'), from);
    added.push(attrs, set);
    last = set.id;
  } else {
    const m = n(pick, nextId(), x, y, note(...(NOTES[pick] ?? [])), from);
    added.push(m);
    last = m.id;
  }
  return [
    ...nodes.map(x2 => (x2.id === splatId ? { ...x2, inputs: { ...x2.inputs, modifier: { ...x2.inputs.modifier, type: 'splat' as const, label: 'Modifier', connection: { nodeId: last, outputKey: 'splat' } } } } : x2)),
    ...added,
  ];
}

/** The chain feeding a Splat Scene's Modifier, from the scan back (recipe and Set Splat nodes along the Splat wires). */
export function splatModifierChain(nodes: readonly GraphNode[], splatId: string): GraphNode[] {
  const out: GraphNode[] = [];
  let at = nodes.find(x => x.id === splatId)?.inputs.modifier?.connection?.nodeId;
  while (at && out.length < 64) {
    const node = nodes.find(x => x.id === at);
    if (!node || out.includes(node)) break;
    out.push(node);
    at = node.inputs.splat?.connection?.nodeId;
  }
  return out;
}
