import type { SubgraphData } from './nodeGraph';

export interface GroupPreset {
  id: string;       // 'gp_<timestamp>'
  label: string;
  subgraph: SubgraphData;
  savedAt: number;
}
