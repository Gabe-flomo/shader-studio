/**
 * stageUi.tsx — a stage's colour, for the builders' flow strip (BuilderFlowStrip.tsx). Stages live
 * in the builders only: the Studio graph has no flow strip, stage tags or arrange-by-stage.
 */
import { useThemeMode } from '../../theme/themeStore';
import { accentColor } from '../../theme/categories';
import { STAGES, type StageId } from '../../structure/stages';

/** A stage's colour in the current theme. */
export function useStageColour(): (s: StageId) => string {
  const mode = useThemeMode();
  return s => accentColor(STAGES[s].accent, mode);
}
