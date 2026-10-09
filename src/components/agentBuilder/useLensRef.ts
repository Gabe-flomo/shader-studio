/**
 * The lens's reference distance (agentBuilder/diagram.ts lensFor): the feelers' length when the
 * section was picked, kept while a slider moves within reach (keepRef), so the diagram's feelers
 * grow and shrink as you drag instead of being re-fitted every step.
 */
import { useState } from 'react';
import { keepRef } from '../../agentBuilder/diagram';

export function useLensRef(distance: number, section: string, lo?: number, hi?: number): number {
  const [s, setS] = useState({ ref: distance, section });
  let next = s;
  if (s.section !== section) next = { ref: distance, section };
  else {
    const r = keepRef(s.ref, distance, lo, hi);
    if (r !== s.ref) next = { ref: r, section };
  }
  // Adjusting state while rendering (React's "storing information from previous renders").
  if (next !== s) setS(next);
  return next.ref;
}
