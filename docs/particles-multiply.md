# Particles: Multiply and Goo

A particles layer can **grow** instead of appearing all at once, and can be drawn as **goo** (metaballs). Both live in the layer kit (`src/play/particle-sim.js`), so they behave the same in the app, in takes and offline renders, and in website exports.

The Play example **Multiply** (Particles group) shows both: one cell buds into two hundred as goo, the cells pair up and annihilate, and the colony grows again from one.

## Emit: Multiply

Birth and death → **Emit: Multiply**. The layer starts with one particle where **Born** says (centre, a null, an emitter shape…). Each particle splits after its own interval and the population grows until it reaches **Count**.

| Setting | What it does |
|---|---|
| **Split rate** | Splits per second for each particle. The population doubles about every 1 ÷ rate seconds (rate 1: ~200 particles in ~8 s). |
| **Split jitter** | 0..1: how uneven the time between splits is (up to ±80%), so the colony doesn't divide in lockstep. |
| **Buds** | 1..4 new particles per split. |
| **Bud push** | How hard a bud and its parent push apart (picture heights / s). A bud starts on top of its parent, so it looks like budding. |
| **Spread** | Stay, Return, Annihilate: neighbours closer than this drift apart, so the colony grows outward like cells. |

### Once born

- **Stay**: drift apart gently (bud push + Spread) and stop.
- **Flow**: the layer's field, attractor and zones move them like normal particles. Ones that leave the picture (Edges: Respawn) or reach the end of their Life die, and their slots are free for new buds.
- **Return**: a spring (**Return spring**) pulls each particle back to where it was born.
- **Annihilate**: once the colony first fills, each grown-up particle (older than one split interval) pairs with a random unpaired one within **Pair radius**. The two close in at **Seek speed** and, when they touch, both die with a small burst (a ring and six sparks). Paired particles don't split.

### When full

- **Loop**: splitting stops at the count. The colony starts again from one particle when it is (almost) gone, or **Loop hold** seconds after filling (0 = only when gone). With Annihilate, everyone pairs at once, so the colony clears and regrows: grow, annihilate, regrow.
- **Respawn**: the dead come back at the spawn point, one per split interval, and everyone keeps splitting to refill.
- **Hold**: survivors keep splitting to stay at the full count. With Annihilate, pairs form a few at a time (each particle about every four split intervals), so the colony churns near full.

If every particle dies under Hold or Respawn, a new colony starts from one. **Start over from one** (or a Reset action) restarts it by hand; a Burst action adds particles from the free slots.

### Determinism

Every random choice (split times, bud directions, partners, burst angles) draws on the layer's random source in a fixed order. With **Seed** set, or inside a take (which seeds unseeded layers from the session), two runs at the same frame rate give the same result, so offline renders match what was played.

## Goo (metaballs)

Look → **Goo**. Each particle adds a smooth bump `k(d) = (1 − d²/R²)²` to one field, with `R` = its size × **Goo blend**. Where the sum passes **Goo threshold** is goo. Particles close enough that their bumps add past the threshold between them merge into one blob; as they part, a neck stretches and snaps. A lone particle's blob has radius `R·√(1 − √threshold)`.

| Setting | What it does |
|---|---|
| **Goo blend** | How far each field reaches, as a multiple of the particle size (the smooth-min radius). Higher = merge from further apart, longer necks. |
| **Goo threshold** | Lower = fatter blobs that merge sooner; higher = thinner ones that part sooner. |
| **Goo edge** | 0 = a hard edge; higher = a soft band around the threshold (a smoothstep from `t·(1 − s)` to `t + (1 − t)·s`). |

Colour comes from the layer's Tint, Picture or Palette (and tint zones): each cell of the goo is the field-weighted blend of the colours of the particles there. Opacity, Blend, Trail and Mask apply as usual; size and opacity modulators and Fade scale each particle's bump. Links are not drawn in goo mode.

### Cost

The field is summed on the CPU on a grid of about 160k cells (a 1080p picture gets ~3.6 px cells; small blobs get finer cells, up to ~400k). Each particle touches `(2R / cell)²` cells, so a few hundred particles are 30–60k adds; then one pass over the grid fills an ImageData on a small canvas, which is drawn scaled up with smoothing (antialiasing the edge over about one cell). That is roughly 1–3 ms a frame at 1080p for 200 particles. The grid pass dominates, so the cost barely grows with the particle count; thousands of large particles cost more.
