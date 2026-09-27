import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { describeReset } from '../../lib/rebuild';
import { toast } from '../ui/toastStore';

/** The Rebuild button's tooltip, everywhere it appears. */
export const REBUILD_TOOLTIP = 'Rebuild: recompile the shader and reset the GPU';

let running: Promise<void> | null = null;

/**
 * Rebuild (see the store's `rebuild`), then say what happened: what was reset, or the compile
 * errors. A second press while one is running joins it instead of starting another.
 */
export function rebuildWithToast(): Promise<void> {
  running ??= (async () => {
    try {
      const { reset, errors } = await useNodeGraphStore.getState().rebuild();
      if (errors.length > 0) {
        toast.error('Rebuilt, but the shader doesn’t compile', {
          message: errors[0].replace(/^ERROR:\s*/, ''),
          details: errors.join('\n'),
        });
      } else {
        toast.success('Rebuilt: shader recompiled, GPU state reset', {
          message: `Reset ${describeReset(reset)}. Kept the graph, the time, the Play setup and layers.`,
        });
      }
    } catch (e) {
      toast.error('Couldn’t rebuild', { details: String(e) });
    } finally {
      running = null;
    }
  })();
  return running;
}
