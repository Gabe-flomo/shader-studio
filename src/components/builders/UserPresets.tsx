/**
 * UserPresets — your own presets in a builder's presets strip (docs/scene-builder.md, "Your presets"):
 * after the builder's built-ins, a card per preset you saved (its picture, its name; click to load,
 * the pencil renames, × deletes), "+ Save this scene", which asks for a name and keeps the scene
 * with a picture of the viewport as it is now, and "All…" for the whole list (search, export,
 * import, the Library). Presets are the builder's own (builders/userPresets.ts, one list per
 * builder): they load only in the builder they were saved from, and never make a graph by
 * themselves.
 *
 * The strip is the shared <PresetMenu> (components/presets/PresetMenu.tsx) over the builder's
 * preset kind (`builder:<kind>` in presets/presetKinds.ts), so the same presets also show in the
 * Library's Presets filter. It draws its cards inline (display: contents), so a builder puts it in
 * its strip's row after its own.
 */
import { useRef } from 'react';
import { PresetMenu } from '../presets/PresetMenu';
import type { PresetBuilderKind } from '../../builders/userPresets';
import { builderPresetKind } from '../../presets/presetKinds';
import { captureViewportThumb } from './viewportThumb';

export interface UserPresetsProps {
  kind: PresetBuilderKind;
  /** The scene now, as preset text. */
  getRecipe: () => string;
  /** Load a preset's text into the builder (one undo step). */
  onLoad: (recipe: string) => void;
  /** The builder's own picture of its scene, when the viewport can't be read. */
  fallbackThumb?: () => string | null;
  /** "scene", "rule", "warp": the word on the save tile and in default names. */
  noun?: string;
  /** The viewport's canvas, when it isn't in the studio's viewport (captureViewportThumb). */
  canvasSelector?: string;
}

export function UserPresets({ kind, getRecipe, onLoad, fallbackThumb, noun = 'scene', canvasSelector }: UserPresetsProps) {
  const root = useRef<HTMLSpanElement>(null);
  return (
    <span ref={root} style={{ display: 'contents' }}>
      <PresetMenu variant="strip" kind={builderPresetKind(kind)} stripId={kind} noun={noun} hideBuiltIns
        getData={() => ({ recipe: getRecipe() })}
        getThumb={() => captureViewportThumb(root.current, fallbackThumb, canvasSelector)}
        onApply={p => { if (typeof p.record.recipe === 'string') onLoad(p.record.recipe); }} />
    </span>
  );
}
