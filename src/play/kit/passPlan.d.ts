export interface PlanPass {
  slug: string;
  scale: number;
  live: boolean;
  previous: boolean;
  format: string;
  filter: string;
  wrap: string;
}
export function ppSize(w: number, h: number, scale: number): [number, number];
export function ppDrawn<T extends Pick<PlanPass, 'live'>>(passes: readonly T[]): T[];
export function ppPixel(w: number, h: number): [number, number];
export function ppTargetKey(p: Pick<PlanPass, 'scale' | 'format' | 'filter' | 'wrap' | 'previous'>, w: number, h: number): string;
