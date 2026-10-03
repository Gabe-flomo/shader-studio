/**
 * sourceDrag.ts — dragging a source onto a control on the Inputs board: the
 * other way to Map. A source card's (or an old mapping card's) grip carries
 * the source's id under its own MIME type, so a control card only lights up
 * for a source (not for a control dragged to the notes, or a file), and the
 * drop makes the route exactly as a Map-mode click does (routeOps.ts
 * routeToControl, so connectDefaults applies). Unlike a Map click, a drop
 * never takes a route off: dropping onto a control it already drives says
 * so instead. Pure, except for reading a DataTransfer.
 */
import { ROUTES_PER_SOURCE_MAX, type PlayRecord } from '../../../types/play';
import { ownSource } from '../../../play/routeOps';

/** Our own type: a drag from anywhere else never matches it. */
export const SOURCE_DRAG_TYPE = 'application/x-playfield-source';

/** Is a source being dragged? (Over a target only the types can be read, not the data.) */
export function isSourceDrag(types: Iterable<string> | ArrayLike<string> | null | undefined): boolean {
  return !!types && Array.from(types).includes(SOURCE_DRAG_TYPE);
}

/** The dragged source's id, from what the drop carries; null when it isn't one of ours. */
export function sourceIdOfDrop(data: string | null | undefined): string | null {
  const id = (data ?? '').trim();
  return /^[\w:-]+$/.test(id) ? id : null;
}

export type DropOutcome = 'route' | 'already' | 'full' | 'missing';

/**
 * What dropping this source onto this control does: makes a route, or not
 * (it already drives it, it has as many routes as a source may, or either
 * is gone), so the board can say why nothing happened.
 */
export function dropOutcome(play: PlayRecord, sourceId: string, controlId: string): DropOutcome {
  if (!play.controls.some(c => c.id === controlId)) return 'missing';
  const own = ownSource(play, sourceId);
  if (!own) return 'missing';
  const routes = own.source.outputs.flatMap(o => o.routes);
  if (routes.some(r => r.to === controlId)) return 'already';
  if (routes.length >= ROUTES_PER_SOURCE_MAX) return 'full';
  return 'route';
}
