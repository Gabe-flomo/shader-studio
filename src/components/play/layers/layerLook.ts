/**
 * layerLook — the icon, colour and name a layer shows with in the list: its
 * kind's from the Add layer menu, or a saved kind's own (a Script layer
 * underneath).
 */
import { accentColor } from '../../../theme/categories';
import type { ThemeMode } from '../../../theme/tokens';
import { kindOf, type LayerKindDef } from '../../../types/layerKinds';
import { kindHint } from '../../../play/layerKinds';
import type { PlayLayer } from '../../../types/play';
import type { IconName } from '../../ui/iconPaths';
import { BUILTIN_LAYER, BUILTIN_LAYERS } from './addLayerCatalog';

export interface LayerLook { label: string; hint: string; icon: IconName; color: string }

/** `plain` is the colour of a built-in kind's icon (the theme's faint text). */
export function layerLook(l: PlayLayer, kinds: readonly LayerKindDef[] | undefined, mode: ThemeMode, plain: string): LayerLook {
  const kind = kindOf(l, kinds);
  if (kind) return { label: kind.name, hint: `${kindHint(kind.hint, kind.paramDefs.length)}. A Script layer underneath.`, icon: kind.icon as IconName, color: accentColor(kind.colour, mode) };
  const b = l.kind === 'script' && l.mode === '3d' ? (BUILTIN_LAYERS.find(x => x.variant === 'script3d') ?? BUILTIN_LAYER.script) : BUILTIN_LAYER[l.kind];
  return { label: b?.label ?? l.kind, hint: b?.hint ?? '', icon: b?.icon ?? 'layoutCanvas', color: plain };
}
