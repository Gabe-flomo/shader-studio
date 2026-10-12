/**
 * slotMenu.ts — what right-clicking an empty slot offers (docs/warp-builder.md, "Filling a slot
 * from a menu"). The same tiles as the palette, in this order: Number, the variables (the builder's
 * own order; the loop ones only in a looped block), the operators, the functions, If, then the
 * conditions. Only what the slot can take is listed (a condition slot lists only conditions).
 * Picking one is a drop: `applyTile`, the one code path a drag also uses.
 */
import { CMP_TILES, FN_TILES, LOGIC_TILES, OP_TILES, VAR_TILES } from './tiles';
import { dropAllowed, dropTile, type TileDrag, type TileTarget, type WarpSel } from './spec';
import { useWarpBuilder } from './store';

export interface SlotOption { label: string; hint: string; drag: TileDrag }
export interface SlotGroup { heading: string | null; options: SlotOption[] }

type PaletteDrag = Extract<TileDrag, { from: 'palette' }>;
const pal = (d: DistributiveOmit<PaletteDrag, 'from'>): TileDrag => ({ from: 'palette', ...d }) as TileDrag;
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

/** The options for the slot `to`, grouped, in menu order. Empty groups are left out. */
export function slotMenuGroups(to: TileTarget): SlotGroup[] {
  const spec = useWarpBuilder.getState().spec;
  const loop = !!spec.blocks[to.block]?.block.loop;
  const groups: SlotGroup[] = [
    { heading: null, options: [{ label: 'Number', hint: 'A slider named from where it lands; type its value', drag: pal({ kind: 'num' }) }] },
    { heading: 'Variables', options: VAR_TILES.filter(v => !v.loop || loop).map(v => ({ label: v.name === 't' ? 'time' : v.label, hint: v.blurb, drag: pal({ kind: 'var', name: v.name }) })) },
    { heading: 'Operators', options: OP_TILES.map(o => ({ label: o.label, hint: o.blurb, drag: pal({ kind: 'op', op: o.op }) })) },
    { heading: 'Functions', options: FN_TILES.map(f => ({ label: f.label, hint: f.blurb, drag: pal({ kind: 'fn', fn: f.fn }) })) },
    { heading: 'If', options: [{ label: 'if … then … else', hint: 'Split space by a condition', drag: pal({ kind: 'if' }) }] },
    {
      heading: 'Conditions',
      options: [
        ...CMP_TILES.map(c => ({ label: c.label, hint: c.blurb, drag: pal({ kind: 'cmp', op: c.op }) })),
        ...LOGIC_TILES.map(c => ({ label: c.label, hint: c.blurb, drag: c.op === '!' ? pal({ kind: 'not' }) : pal({ kind: 'logic', op: c.op }) })),
      ],
    },
  ];
  return groups
    .map(g => ({ ...g, options: g.options.filter(o => dropAllowed(spec, to, o.drag)) }))
    .filter(g => g.options.length > 0);
}

/** Drop (or menu-apply) a tile: one undo step, then pick what the drop says to pick next. */
export function applyTile(to: TileTarget, drag: TileDrag): WarpSel | null {
  let sel: WarpSel | null = null;
  useWarpBuilder.getState().edit(d => { sel = dropTile(d, to, drag); });
  if (sel) useWarpBuilder.getState().select(sel);
  return sel;
}
