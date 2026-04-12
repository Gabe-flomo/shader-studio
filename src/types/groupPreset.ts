import type { SubgraphData } from './nodeGraph';

export interface GroupPreset {
  id: string;       // 'gp_<timestamp>'
  label: string;
  description?: string;
  subgraph: SubgraphData;
  savedAt: number;
}
