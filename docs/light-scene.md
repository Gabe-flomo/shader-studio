# Light the scene

You can light a March Loop Group scene (3D, and 4D, which marches the same way) in one click.

- **Sun button** on the March Loop Group's card, or **right-click → Light the scene…**.
- Adding a March Loop Group offers the same choice. "Don't offer when I add one" turns that off; the button and menu still work.

Pick a look. It adds a lighting rig after the loop, wires it, and puts it on the Output. Every node it adds has a note explaining it. **Picking another look replaces the rig** (its nodes are tagged with the loop's id). Undo takes you back.

| Look | What it is |
|---|---|
| Daylight | Warm sun with soft shadows, blue sky, a little bounce. The all-rounder. |
| Studio | Neutral key light, grey fill, white rim. Product-shot look. |
| Golden hour | Low orange sun, long shadows, violet sky, warm haze. |
| Moonlight | Cool dim moon, crisp shadows, cold rim, blue fog. |
| Clay | Matt white, very soft shadows, deep AO. Its own colour. |
| Neon rim | Near-black surface lit at its edges by a magenta rim. Its own colour. |
| Wax / skin | Daylight plus fake subsurface scattering: thin parts glow warm. |
| Quick (no shadows) | Sun, sky and bounce only. Fast on big or heavily warped scenes. |

## What it builds

1. **Sun direction** (Make Vec3), shared by the shadow, the light and the highlight.
2. **Soft Shadow** and **SDF AO** from the loop's Scene, Hit Pos, Normal and Hit. Both also take the loop's **Stretch**, so they step safely when Warp safety is on (docs/warp-safety.md).
3. **Multi-Light**: sun, sky and bounce. The surface colour is the loop's Albedo (its wire, or its colour), except for Clay and Neon.
4. Optional extras, each an Expression Block you can read and edit:
   - a highlight (Blinn-Phong);
   - a rim light (Fresnel, faded on floors);
   - subsurface (Fake SSS);
   - fog (Volumetric Fog).
5. **On the background**: `mix(loop Color, lit, hit)`. The loop's own Background still sets what misses show.
6. **Tone Map (ACES)** → Output.

With no Scene wired into the loop, there is nothing to shadow, so the shadow, AO and subsurface steps are left out.

Code: `src/nodes/recipes/lightRecipes.ts`. It uses the starter-recipe machinery (`docs/starter-recipes.md`), plus `remove` in a recipe build for replacing.

## Switch to GI Lit (and back)

The Light the scene card also has **Global illumination (GI Lit)**, and the right-click menu has **Switch to GI Lit March Group** / **Switch to March Loop Group**. The loop keeps its id, its inside, the settings both share (steps, distance, warp safety, jitter, colours…) and every wire whose socket exists on both.

- Going to GI Lit removes the loop's Light the scene rig, since GI lights the scene itself. If the Output showed the rig, it shows GI's Color instead.
- Going back cuts wires from the GI-only outputs (AO, Shadow, GI, Diffuse, Reflection).

Code: `src/nodes/convertMarchLoop.ts`.
