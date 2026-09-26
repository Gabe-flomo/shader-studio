/**
 * help.ts — the words behind the Layers tab's choices: what each particle
 * field, zone action and action kind does. Shown under the choices and in
 * tooltips.
 */
import { scriptActionKey, type ActionKind, type BuiltinActionKind, type ParticleField, type PlayLayer, type ZoneAction } from '../../../types/play';

export const FIELD_HELP: Record<ParticleField, { label: string; title: string; body: string }> = {
  flow: { label: 'Flow', title: 'Brightness is a direction', body: 'Each particle reads the brightness under it and turns it into a heading: black points right, and the heading rotates as the picture gets brighter (Turns = full rotations from black to white). At Turns 1, black and white point the same way and mid grey the opposite, so particles skate along bright shapes\' edges and never get inside them.' },
  climb: { label: 'Climb', title: 'Uphill, toward light', body: 'Particles move toward brighter parts of the picture and collect on highlights and bright edges. On flat areas there is no uphill: see “On flat areas”.' },
  descend: { label: 'Descend', title: 'Downhill, toward dark', body: 'Particles move toward darker parts and pool in shadows and dark lines. On flat areas there is no downhill: see “On flat areas”.' },
  noise: { label: 'Noise', title: 'A drifting noise field', body: 'An evolving flow field that ignores the picture: smooth swirling lanes. Swirl size sets how busy it is; Evolve how fast it changes.' },
  none: { label: 'None', title: 'Only forces', body: 'No field. Particles coast unless an attractor, a zone, a null\'s role or flocking moves them.' },
};

export const ZONE_HELP: Record<ZoneAction, { label: string; body: string }> = {
  none: { label: 'Nothing', body: 'Just a shape to see. It still counts particles and the pointer, for sensors and shape triggers.' },
  wall: { label: 'Wall', body: 'Particles and bodies bump into it and slide along (Bounce 1 = straight back).' },
  container: { label: 'Container', body: 'The opposite of a wall: particles are kept inside.' },
  attract: { label: 'Attract', body: 'Pulls particles toward it from within Reach; they gather inside.' },
  repel: { label: 'Repel', body: 'Pushes particles away from within Reach.' },
  sink: { label: 'Sink', body: 'Particles that enter vanish and are reborn where particles are born.' },
  portal: { label: 'Portal', body: 'Particles that enter come out of the target shape, keeping their motion.' },
  emitter: { label: 'Emitter', body: 'New particles are born inside and launched out, pushed away within Reach. Particles leaving the picture come back out of it.' },
  absorber: { label: 'Absorber', body: 'Pulls particles straight in from within Reach and swallows them; they are reborn at an emitter. Pair it with an emitter for field lines.' },
  wind: { label: 'Wind', body: 'A steady push in one direction while particles are inside.' },
  vortex: { label: 'Vortex', body: 'Swirls particles around it, within Reach.' },
  drag: { label: 'Drag', body: 'Particles slow down inside, like moving through honey.' },
  tint: { label: 'Tint', body: 'Particles take its tint colour while inside.' },
  resize: { label: 'Resize', body: 'Particles grow or shrink by Resize × while inside.' },
  sensor: { label: 'Sensor', body: 'Nothing moves. Map its Fill (how crowded it is) or Hover onto anything, or fire an action when it fills up.' },
};

export const ACTION_LABELS: Record<BuiltinActionKind, string> = {
  burst: 'Burst particles', scatter: 'Scatter', reset: 'Reset', freeze: 'Freeze / unfreeze',
  next: 'Next line', prev: 'Previous line', shuffle: 'Random line',
  toggle: 'Show / hide', show: 'Show', hide: 'Hide', drop: 'Drop again', clear: 'Clear strokes',
};

/** The label of an action: a built-in's, or a script button's label (its param label, or the key). */
export function actionLabel(kind: ActionKind, l?: PlayLayer): string {
  const key = scriptActionKey(kind);
  if (key === null) return ACTION_LABELS[kind as BuiltinActionKind] ?? kind;
  const def = l?.kind === 'script' ? l.paramDefs.find(d => d.key === key) : undefined;
  return def?.label ?? key;
}
