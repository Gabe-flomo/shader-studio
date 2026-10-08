# Warp safety (March Loop)

Ray marching steps each ray forward by the distance the scene reports. This is safe only while that number is a true distance: the ray can never overshoot a surface.

A warp breaks this promise. Twist, bend, displacement, folds and non-uniform scales all stretch space. After the warp, the reported distance can be *larger* than the real distance. The ray then jumps into or through a surface, and the picture tears: slices go missing, edges speckle, and holes open up.

The usual fix is a Step Scale below 1, but that slows every ray everywhere. **Warp safety** on the March Loop Group fixes tearing only where it happens.

| Setting | What it does | Cost |
|---|---|---|
| **Off** | As before. The shader is byte-for-byte the same. | — |
| **Auto** | Learns the stretch as the ray goes (when the distance shrank faster than the ray moved, later steps are divided by that). Never steps further than **Max step**. A step that lands inside a surface backs up with a 6-step halving search. The stretch relaxes as the ray moves on, so a ray that grazed a twist still reaches the floor. | about the same |
| **Careful** | Auto, plus it measures the stretch at every step from the distance's gradient (4 extra scene reads per step). | about 2–5× per step |
| **High** | Careful, with steps 30% shorter, twice the step budget, a 10-step back-up and a tighter hit test. Only a little cleaner than Careful; use it for extreme warps. | slowest |

The hit test also widens with distance (0.0005 × distance), so far-away surfaces stop costing extra steps.

**Show → Steps heatmap** replaces the final picture with how hard each ray worked. Dark means a ray found its way quickly; orange to white means it struggled or ran out of steps. Use it to see where the warp is causing trouble, and whether Max step or Max steps needs raising.

## Volumetric and GI Lit

**Volumetric loops**: the stretch keeps rays from skipping over the medium (each step is `max(min(d / stretch, Max step), Passthrough)`). The extra probes (Careful's gradient) run the loop body on scratch copies of its accumulators, so they add no glow. Shorter steps sample the far field more often, so the background haze can lift a little. Turn on a glow's **Per distance** to make brightness follow ray length instead of step count.

**GI Lit March Group**: it has the same Warp safety, Max step and Show settings. Its shadow, bounce and reflection rays also divide their steps by the stretch where the primary ray hit.

## Stretch output → Soft Shadow and AO

With Warp safety on, the March Loop and GI Lit groups output **Stretch**: how stretched space is where the ray stopped (1 = not at all). Wire it into **Soft Shadow** or **SDF AO** and their rays step safely through the warped scene too. The 3D Scene Builder does this for you when Quality → Warp safety is on (recipe: `quality warp=careful`).

## A trick that works by hand

Scaling space by a matrix, then multiplying the distance back down, works for the same reason. A scale by *s* stretches distances by *s*, so you divide by *s* (or multiply by 1/*s*) to make the distance safe again. That's the "Lipschitz" correction Auto and Careful find automatically. For a non-uniform scale, divide by the **largest** axis scale.

## Camera target

The March Camera's target is one **vec3 Target** input, no longer three float inputs. The Target X/Y/Z sliders still set it when nothing is wired. An older graph that wired a float into Target X, Y or Z keeps that socket and its wire.
