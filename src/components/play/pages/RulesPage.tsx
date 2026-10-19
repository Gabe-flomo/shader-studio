/**
 * The Rules rail page: when something happens, what to do (rules/RulesPage.tsx),
 * or what Free shows in its place (rules act on layers, which are Pro).
 */
import { useCan } from '../../../lib/plan';
import { RulesPage } from '../rules/RulesPage';
import { LockedLayers } from './LayersPage';
import type { RailPageProps } from './shared';

export function RulesRailPage({ play, onChange, wide }: Omit<RailPageProps, 'touch'>) {
  const layersOk = useCan('play.layers');
  return layersOk ? <RulesPage play={play} onChange={onChange} wide={wide} /> : <LockedLayers play={play} />;
}
