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
- **Annihilate**: once the colony first fills, each grown-up particle (older than one split interval) pairs with a random unpaired one within **Pair radius**. The two close in at **Seek speed** and, when they touch, both die on the spot — no burst. Paired particles don't split.

### When full

- **Loop**: splitting stops at the count. The colony starts again from one particle when it is (almost) gone, or **Loop hold** seconds after filling (0 = only when gone). With Annihilate, everyone pairs at once, so the colony clears and regrows: grow, annihilate, regrow.
- **Respawn**: the dead come back at the spawn point, one per split interval, and everyone keeps splitting to refill.
- **Hold**: survivors keep splitting to stay at the full count. With Annihilate, pairs form a few at a time (each particle about every four split intervals), so the colony churns near full.

If every particle dies under Hold or Respawn, a new colony starts from one. **Start over from one** (or a Reset action) restarts it by hand; a Burst action adds particles from the free slots.

### Determinism

Every random choice (split times, bud directions, partners) draws on the layer's random source in a fixed order. With **Seed** set, or inside a take (which seeds unseeded layers from the session), two runs at the same frame rate give the same result, so offline renders match what was played.

## Fullness

**Grow** chooses how the colony gets to **Count**:

| Setting | What it does |
|---|---|
| **By itself** | Today's behaviour: split timers grow the colony (Split rate, Split jitter, Buds, Bud push; **When full** applies). |
| **By Fullness** | The population follows **Fullness** (0–100%, default 100) directly. Split timers are off, and **When full** doesn't apply. |

Raising Fullness buds new particles from random living parents — the same bud placement as a split — a few a frame, so a sweep of the slider looks like growth, not a pop. Lowering it removes the youngest first. **Full** is reached when the number alive is at least `round(Fullness × Count)`. Annihilate and the other life modes still apply to whoever is alive; a Fullness sweep with Annihilate on keeps pairing up survivors as it goes.

Fullness is a normal control: map an LFO, a knob, an audio band or the Increment mapping onto it, from the panel, a take or a website. It is deterministic in takes and in website exports, the same as everything else in Multiply.

## Actions

Two actions join Burst and Reset on a Multiply particles layer, in the Actions list (a key, a beat, a MIDI note, a signal…):

| Action | What it does |
|---|---|
| **Multiply** | Buds `amount` particles now, from random living parents (or from Born, if nobody is alive yet). |
| **Cull** | Removes `amount` particles, youngest first. |

Both work regardless of **Grow**: they bud or cull immediately, on top of whatever Grow and the life modes are doing that frame.

## Signals

A Multiply layer can send a named signal (pick one, or make a new one, under **Signals out**) whenever:

| Signal | Fires when |
|---|---|
| **Split** | A particle buds — by itself, by Fullness, or the Multiply action. |
| **Full** | The colony reaches its target (Count, or Fullness × Count). |
| **Annihilate** | A pair dies (Annihilate mode only). |
| **Cleared** | The colony empties out, or a Loop restarts. |

Other actions and mappings react to these the same way they react to any signal: "When: a signal fires" on a trigger, or a Send a signal action chained onto it.

## Signals: Born and Died (every Emit mode)

Every particles layer — Stream, Bursts or Multiply — has two more signals under **Signals out**, in **Birth and death**: **Born** and **Died**. They fire once a step, however many particles were involved (a burst of 200 fires Born once, not two hundred times):

| Signal | Fires when |
|---|---|
| **Born** | One or more particles are born this step: a Burst action, a stream particle respawning (end of life, or leaving the picture under **At the edges: Respawn** or **Random**), or a Multiply bud (by itself, by Fullness, or the Multiply action). |
| **Died** | One or more particles die this step: age (a burst particle's Life running out), leaving the picture at a kill boundary (a burst particle under **At the edges: Respawn**), a Multiply annihilation, or the Cull action. |

A Stream particle is "always alive, reborn when it leaves" (see Emit above): leaving or ageing out never counts as a death for it, only a birth (it reappears). Wrap and Bounce are neither — the particle never left. Multiply's own Split/Full/Annihilate/Cleared signals above still fire alongside Born/Died; Born mirrors Split's buds one-for-one, and Died mirrors Annihilate's pair deaths (two deaths per pair) plus any age or edge deaths under Stay/Flow/Return.

The **Agents** layer has the same two signals, under its own **Signals out** section: **Born** fires when a group's Respawn revives an agent, and **Died** fires when a Catch rule, an energy drain, or a kill boundary (Boundary: Die) removes one.

### Readings

Every particles layer (and Agents) also gets two readings for mappings and triggers, alongside **Speed** and **Spread** (Agents: alongside **Alive** and the rest): **Born** and **Died** — how many were born or died this step (0 most steps), and **Alive** — the share of the layer's particles alive right now, 0 none, 1 all of Count. A "When a value…" trigger can watch these directly (for example, above 0) instead of picking a signal.

### Determinism

Born and Died are counted from the same seeded random source as everything else in the layer, so a take and an offline render fire them on the same frame as the app did, and the website export fires them identically too (the layer kit and the counting are the same code, shared, not reimplemented for the browser).

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
