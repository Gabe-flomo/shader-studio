# Suggest controls

Finds the settings worth putting on Play, so you don't have to hunt for them. It reuses the measuring behind Randomise's **Focus on what changes the picture** (`src/nodes/randomizeFocus.ts`, drawn by `src/components/surprise/focusWeights.ts`) and extends it from "nudge a quarter either way" to a sweep across the whole interesting range.

## Where

- **Play page**: **Suggest controls** beside **Add control** in the Controls header.
- **Canvas dice popover**: **Find the controls that matter**.

Both open the same panel (`src/components/play/SuggestControlsPanel.tsx`). It starts measuring at once, with progress, and lists up to eight settings: a filmstrip of 2 to 5 tiny frames across the usable range, Impact / Smooth (and Motion) chips and the suggested range. The top four are ticked. **Add N to Play** makes the controls in one undo step and skips any already on Play. Each label is the Play default, "Node · Setting" (with the group in front inside a group), e.g. "Glow · Falloff".

## What is tried

The settings Randomise would change with the saved options: same locks (a locked setting or a skipped node is never suggested). Groups are always included, whatever Randomise's group toggles say: the settings on a group's face first, then the settings one level inside, since group controls are often the ones that change the picture most. Only free floats that are live uniforms in the last compile and not on Play yet; colours, choices, wired and baked settings are not offered. The whole graph is measured, since Play's targets are the root level's (and one group in).

## The scoring (`src/nodes/controlFinder.ts`)

Each setting is drawn at 64 × 64 at five points (0, ¼, ½, ¾, 1) across its interesting range. From the five frames:

| Term | Meaning |
|---|---|
| Impact | Mean change between neighbouring samples inside the usable run (mean absolute pixel difference; blended 50/50 with the image model's embedding distance when it is loaded), divided by the largest impact measured, then square-rooted so one outlier does not squash the rest. A setting with a raw pixel impact under 0.004 does nothing visible and is dropped. |
| Smoothness | `1 − (biggest step share − 1/n) / (1 − 1/n)` over the n steps of the run: equal steps give 1, one jump gives 0 (a knob wants gradual change). A two-sample run reads 0.5. |
| Usable range | The longest run of consecutive samples that are not blank, blown out or flat (`lib/surprise` `degenerateReason`). The suggested min/max is that run, widened to hold the current value, tidied to the setting's step. `usableFrac` = run width / full width. Fewer than two usable samples: not offered. |
| Motion | Only if the unchanged graph looks different a second later (animated). The run's end frames are compared with the same frames a second later; motion is the difference between the two changes, normalised. |
| Distinctness | The change pattern (16 × 16 luminance difference between the run's ends; plus the embedding difference when loaded) is compared with each setting already chosen. `|cos| ≥ 0.9` means the same effect: the weaker is dropped and noted as "similar" under the stronger. |

`score = impact × (0.5 + 0.5 × smoothness) × (0.5 + 0.5 × usableFrac) × (1 + 0.3 × motion)`

Ties break on the target path, so the same renders give the same list. The run is time-boxed to about 2.5 s (settings not reached are not offered, and the panel says so), draws on its own offscreen WebGL2 canvas in chunks with a pause between (the preview's frame loop is never touched), and is cached per graph version (`controlFinderRun.ts`).

## Friendlier names (seam for the explanation model)

`src/play/suggestControls.ts` exports `setControlNamer(fn)` and `nameControl(context)`. `context` is `{ nodeLabel, groupLabel?, paramLabel, paramHint?, min, max, value }`; the function returns `{ label, hint }` (for example "Softness" and "how far the glow spreads") or null. When a namer is registered the panel shows the label and hint and Add to Play uses the label. Without one the deterministic label is used. A namer that throws or takes over two seconds is ignored.

TODO: the local explanation model (PR `claude/explain-model`, not merged) should call `setControlNamer` when it finishes loading. Nothing here depends on that branch.

## Tests

`src/nodes/__tests__/controlFinder.test.ts`: impact, smoothness, usable range and distinctness against a mocked renderer; locks, skipped nodes and settings already on Play excluded; the Play controls created with the right ranges; determinism; the time box.
