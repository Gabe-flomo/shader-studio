/**
 * MotionShared — the Motion section's scene-wide motion (docs/grid-builder.md "Shared motion",
 * "Vary per cell"):
 *
 *  - All shapes: Shared (one motion for every shape: editing it edits them all), Copy motion to all
 *    (once), and the per-shape Offset (phase, angle, reach, times each shape's place: A 0, B 1…);
 *  - Vary per cell: a Random strength per number (reach, angle, speed, phase, modifiers, size, spin,
 *    pulse), each ± or up only and smooth or independent, and the scene's Seed with Reroll.
 *
 * Every number is live (sliders on the built Motion and Shape nodes, with the Play menu). Turning
 * either on for the first time adds its code; at strength or offset 0 the shapes move as before.
 */
import { Button } from '../ui/Button';
import { Select } from '../ui/Select';
import { Toggle } from '../ui/Choice';
import { Card, NumRow, Row } from '../sceneBuilder/controls';
import { BuilderNote } from '../builders/BuilderWindow';
import { newSeed } from '../../lib/surprise';
import { useGridBuilder } from '../../gridScene/store';
import type { GridSceneSpec, GShape } from '../../gridScene/spec';
import { PATH_VARY, VARY_KEYS, VARY_LABELS, defaultMix, type MotionMix, type Vary, type VaryKey } from '../../gridScene/pathMods';
import { gridPlay } from './playParam';

const edit = (fn: (d: GridSceneSpec) => void, key?: string) => useGridBuilder.getState().edit(fn, key);
const setMix = (fn: (x: MotionMix) => void, key?: string) => edit(d => { d.motionMix ??= defaultMix(); fn(d.motionMix); }, key);

/** All shapes: Shared, Copy motion to all, the per-shape Offset. */
export function AllShapesCard({ shape }: { shape: GShape }) {
  const mix = useGridBuilder(s => s.spec.motionMix);
  const n = useGridBuilder(s => s.spec.shapes.length);
  const x = mix ?? defaultMix();
  return (
    <Card id="gs-motion-all" title="All shapes" summary={mix ? `${x.shared ? 'shared' : 'each its own'}${x.offPhase || x.offAngle || x.offReach ? ' · offset' : ''}` : 'each its own'}>
      <Row label="Shared" hint="One motion for every shape: editing it here edits them all. Off: each keeps a copy to change on its own.">
        <Toggle checked={x.shared} onChange={on => edit(d => {
          d.motionMix ??= defaultMix();
          d.motionMix.shared = on;
          // Turning it on: every shape takes this shape's motion, so they start the same.
          if (on) { const src = d.shapes.find(s => s.id === shape.id)?.motion; if (src) for (const s of d.shapes) s.motion = structuredClone(src); }
        })} label={x.shared ? 'Shared' : 'Each its own'} />
      </Row>
      <Row label="Copy to all" hint="Gives every shape this shape's motion now (once; they can change apart afterwards).">
        <Button size="sm" variant="ghost" icon="copy" disabled={n < 2} data-copy-motion
          onClick={() => edit(d => { const src = d.shapes.find(s => s.id === shape.id)?.motion; if (src) for (const s of d.shapes) s.motion = structuredClone(src); })}>Copy motion to all</Button>
      </Row>
      <BuilderNote>Offset spreads the shapes out of step: shape A by nothing, B by one step, C by two…</BuilderNote>
      <NumRow label="Phase" unit="cycles" hint="Each shape this much of a cycle after the one before it." value={x.offPhase} min={-1} max={1} defaultValue={0}
        lazyParam={gridPlay('motion', 'offPhase')} onChange={v => setMix(m => { m.offPhase = v; }, 'mixph')} />
      <NumRow label="Angle" unit="°" hint="Each shape's path turned this much more than the one before it." value={x.offAngle} min={-180} max={180} step={1} defaultValue={0}
        lazyParam={gridPlay('motion', 'offAngle')} onChange={v => setMix(m => { m.offAngle = v; }, 'mixang')} />
      <NumRow label="Reach" hint="Each shape's reach times 1 + this more than the one before it." value={x.offReach} min={-1} max={1} defaultValue={0}
        lazyParam={gridPlay('motion', 'offReach')} onChange={v => setMix(m => { m.offReach = v; }, 'mixr')} />
    </Card>
  );
}

const MODES = [
  { value: 'pm', label: '± each cell' },
  { value: 'pms', label: '± smooth' },
  { value: 'up', label: 'Up, each cell' },
  { value: 'ups', label: 'Up, smooth' },
] as const;
const modeOf = (v: Vary[VaryKey]) => `${v?.up ? 'up' : 'pm'}${v?.smooth ? 's' : ''}`;

/** Vary per cell: a strength per number, its kind of randomness, and the Seed. */
export function VaryCard({ shape, onEdit, wrap }: { shape: GShape; onEdit: (fn: (v: Vary) => void, key?: string) => void; wrap: boolean }) {
  const seed = useGridBuilder(s => s.spec.motionMix?.seed ?? 0);
  const vary = shape.motion.vary;
  const on = VARY_KEYS.filter(k => (vary?.[k]?.amt ?? 0) > 0);
  const keys = wrap ? VARY_KEYS.filter(k => !PATH_VARY.includes(k)) : VARY_KEYS;
  return (
    <Card id="gs-motion-vary" title="Vary per cell" summary={on.length ? on.map(k => VARY_LABELS[k].label.toLowerCase()).join(', ') : 'all cells alike'}>
      <BuilderNote>Each drawn cell gets its own random offset (the same every time for the same Seed), scaled by the strength: 0 keeps every cell alike. Smooth: neighbouring cells get similar numbers, so it flows in regions.{wrap ? ' This path varies only the look (size, spin, pulse).' : ''}</BuilderNote>
      {keys.map(k => (
        <div key={k} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 118px', gap: 6, alignItems: 'center' }}>
          <NumRow label={VARY_LABELS[k].label} hint={VARY_LABELS[k].hint} value={vary?.[k]?.amt ?? 0} min={0} max={VARY_LABELS[k].max} defaultValue={0}
            lazyParam={gridPlay(shape.id, `v_${k}`)} onChange={v => onEdit(x => { x[k] = { ...x[k], amt: v }; }, `vary${shape.id}${k}`)} />
          <Select ariaLabel={`${VARY_LABELS[k].label} randomness`} value={modeOf(vary?.[k])} options={MODES.map(o => ({ ...o }))}
            onChange={v => onEdit(x => { x[k] = { amt: x[k]?.amt ?? 0, up: v.startsWith('up'), smooth: v.endsWith('s') }; })} />
        </div>
      ))}
      <Row label="Seed" hint="Another random pattern for every shape's Vary per cell (live: on the built Motion node).">
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <NumRow label="" value={seed} min={0} max={999} integer defaultValue={0} lazyParam={gridPlay('motion', 'seed')} onChange={v => setMix(m => { m.seed = v; }, 'mixseed')} />
          </div>
          <Button size="sm" variant="ghost" icon="dice" data-reroll-vary onClick={() => setMix(m => { m.seed = newSeed() % 1000; })}>Reroll</Button>
        </div>
      </Row>
    </Card>
  );
}
