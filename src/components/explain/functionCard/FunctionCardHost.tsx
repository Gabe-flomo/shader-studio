/**
 * Mounts the function card (FunctionCard.tsx, a lazy chunk) while one is open. Rendered once,
 * beside the app (main.tsx); the triggers that open it are installed there too.
 */
import { lazyWithSuspense } from '../../lazyWithSuspense';
import type { CardRequest } from './fnCardStore';
import { useFnCard } from './fnCardStore';

const FunctionCard = lazyWithSuspense<{ req: CardRequest }>(() => import('./FunctionCard').then(m => ({ default: m.FunctionCard })));

export function FunctionCardHost() {
  const req = useFnCard(s => s.req);
  const n = useFnCard(s => s.n);
  return req ? <FunctionCard key={n} req={req} /> : null;
}
