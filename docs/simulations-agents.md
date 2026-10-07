# Simulations: agents

Eight classic agent-based models, each written as a **custom rule** inside an Agents group from nodes that already exist: Agent Inputs and Agent Output, Sense used only as a reader, Compare, Constants and Expression Blocks, and Move where a walker simply walks. None of them uses a prebuilt Steer, a force or a preset inside its group: the rule is the point, and every node carries a note saying what it does and why. They live in **Examples → Simulations: agents** (store/agentExamplesSim.ts) and each loads with a Play setup whose controls are the rule's own numbers.

For the Agents group itself (Emit, Deposit, Trail field, Draw agents, Sense, Move…) see docs/agents-group.md. For cellular automata built from a Pass, see docs/simulations-grids.md.

## Writing your own rule

Every example is built from the same handful of moves. Learn these and you can write your own.

**1. Memory is the walker's state.** Agent Output's Memory (two numbers) comes back next step as Agent Inputs' Memory. Use `x` as a *job* or *state* (0, 1, 2, 3…) and `y` as a timer, an energy or a colour. A rule is then a little state machine: `nextJob = job < 0.5 ? … : job < 1.5 ? … : …`. Memory is 0 when a walker is born, so make 0 mean "just born" and set things up on the first step (`age < 0.02`).

**2. Sense is a reader, not just a steerer.** Wire a Trail's Image in through a port on the group. Then Sense gives you the trail *here* (`Here`, weighed by Channels; `Channels here`, all four raw), *ahead and to either side* (`Readings`, the three sensors), and *which way it rises* (`Gradient`). Its Heading and Position inputs move the sensors: point its Heading backwards to look upwind, or wire a snapped Position to read one exact pixel. A Sense with only a Field ƒ (no trail) reads a distance field: Here is the distance, Gradient points away from the shape.

**3. Deposit is how walkers change the world.** Agent Output's Deposit (a vec4) is added into the Trail where the walker stands, every step. It can be negative (take something away) and it can be in any channel, so one Trail can hold several fields at once (prey scent and predator scent; chips and "reaching" marks).

**4. Alive and Emit make populations.** Alive below 0.5 kills a walker; Emit's **Keep full** gives its slot back at once, with Memory 0. With Life 0 (for ever), slots only come back when the rule kills them. To let a population *grow and shrink*, treat Memory.x as "alive or unborn": unborn slots are invisible (Colour black, no Deposit) and come alive near parents.

**5. Knobs are Constants.** A number you want to tune (a rate, a threshold) is a Constant wired into the Expression Block: it shows on the card, is a uniform (changing it never recompiles) and can be a Play control, a MIDI knob or an LFO target.

### Gotchas we hit (and how the examples get round them)

- **Every walker lays one unit of its species' channel on the step it is born.** That is Deposit's start (`agOneHot(species)`). A rule that reads "is there anything here?" on its first steps sees everyone's birth mark. Either ignore the first fraction of a second (`step(0.2, age)`: DLA, Fireflies), or keep your signal in another channel (Infection's second channel, Predators and prey's third and fourth).
- **Chance tests: write `1.0 - step(p, roll)`, not `step(roll, p)`.** `step(roll, p)` is 1 when both are 0, so a chance of 0 still fires whenever the roll is exactly 0.
- **Random numbers have 24 bits.** `Random` (a_random) is a fresh 0–1 number each step, with 24 bits. `fract(rnd * 4096.0)` makes a second, independent-ish number but keeps only 12 bits: its smallest step is 1/4096, so a chance below that fires 1/4096 of the time, not less. The Infection rule's per-step chances are one in a million, so it rolls with `rnd` itself.
- **A deposit lands where the walker is *after* its move.** To change the pixel it just read (pick a chip up, lift sand), a walker must not move on that step. The termites and the sand gusts set their speed (or step) to 0 when they act.
- **Read one pixel exactly by standing in its middle.** Sense reads trails with bilinear filtering. *On the grid* (Termites, Sand drift) snaps the walker to the middle of its trail pixel using the picture size (the Resolution node) and the Trail's fixed row count, so `Channels here` is exactly that pixel.
- **Two walkers can't share one thing in the same step.** A Trail only adds up what everyone deposits, so two termites lifting the same chip in the same step would both get it (and the trail, clamped at 0, would make a chip out of nothing). The termites use a one-step handshake: reach (+1 in a "reaching" channel), then next step take the chip only if exactly one termite reached for it there. Chips stay exactly conserved (measured: 94,663 chips at 1 s, 15 s and 60 s). The sand gusts instead only lift where at least two (lifting) or three (slumping) slabs lie, and slump one time in ten, which keeps sand conserved to 0.03% over 45 s.
- **A Trail that must never fade needs a Half-life past about 400,000 s, and no spread.** The trail keeps `2^(−dt / half-life)` each step; above about 400,000 s that rounds to exactly 1 as a 32-bit uniform. Trails are half floats and the GPU rounds each step's result toward zero, so a share kept that is just under 1 (a Half-life of 100,000 s, say) loses one half-float step every step: the termites' chips faded to a fifth in 2,400 steps (5 s at 8 steps a frame). The termites and the sand use 10,000,000 s and Diffuse 0 (any spreading makes fractions, and the rounding eats them).

## The examples

### Predators and prey (Lotka–Volterra)
Two species in one group, 262,144 slots. Memory.x: alive (1) or an unborn slot (0); Memory.y: energy. Two Senses read the Scent trail (prey in channel 3, predators in channel 4, weighted by species: predators follow prey, prey flee predators) and the Grass trail (prey lean toward grass); **Choose a way** turns smoothly toward the better side. **Life and death**: unborn prey slots hatch at `preyBirth × prey × (1 − prey) × food`, unborn predators at `predatorBirth × predators × prey` (they breed where they feed); prey are caught at `kill × predators`; energy changes by `0.8 × food − 0.3` (prey) or `1.5 × prey − 3 × hunger` (predators), and the starved and the eaten die (Alive 0) and come back unborn through Emit Keep full. The grass is a second Trail: Regrowth (Trail Add) grows it back, grazing prey take 0.005 a step (negative Deposit). Herds and hunting packs settle into large travelling waves: predator fronts sweeping through the prey, bare ground behind them, grass and prey returning.

### Diffusion-limited aggregation
65,536 walkers take a brand-new random direction every step (Brownian motion). Sense reads the cluster's smell here, a Compare node asks "above Stick at?", and **Stick or wander** keeps the answer in Memory.x for good (speed 0, and it lays the smell from then on). A Seed dot painted into the Trail's Add starts it. A faint pull toward the middle keeps walkers arriving. The cluster grows branching fingers because tips catch walkers before the hollows can. Few walkers (one to every 28 trail pixels) matter: a dense crowd fills the hollows into a blob.

### Sand drift: dunes from wind (after Werner)
The sand's depth is a Trail that never fades. 262,144 gusts blow downwind; each reads the sand in its own pixel and a little way upwind (Sense with its Heading turned into the wind). **Lift, drop and slump**: an empty gust lifts a slab (−0.5) where there is sand and it is not in the wind shadow (upwind higher by Shadow drop); a carried slab comes down more readily on sand than on bare ground and always in a shadow; on slopes steeper than Repose a gust slides a slab one pixel downhill (avalanches, which also pass sand sideways). A flat bed grows ripples across the wind, which merge into crescent dunes marching over bare ground.

### Crowd: lanes in two-way traffic
65,536 pedestrians, half walking right and half left in a corridor with pillars. Two **Neighbours** nodes look round a point just ahead of each walker (Just ahead: Look ahead along its heading) and find the walkers themselves (docs/agents-group.md "Neighbours"): one the oncoming walkers (their Push and Count), one its own kind (their Centre and Count); a Sense reads the walls' distance field. **Way to go** heads for the goal, bends away from walls and pillars, swerves away from the oncoming (Avoid) and toward its own kind (Follow), and slows as the walkers ahead add up (Greenshields: speed = pace × (1 − count / jam)). Within seconds the crowd sorts itself into lanes, sharper than before: it used to sense the crowd through its blurred trail (a Sense weighted against oncoming channels), which the Trail now only draws on the floor.

### Painter bots
65,536 turtles, one in 250 with its pen down. **Brush** keeps a turning rhythm in Memory.x (the curvature swings like a pendulum: waves, loops, petals; each of five families at its own pace and lean, a whole family starting in step) and a hue in Memory.y. The canvas is the Trail: each painting bot deposits its colour into channels 1–3 and one layer into channel 4. When a bot heads into paint (Sense's middle reading of channel 4, ahead so it never trips on its own stroke) it may answer: flip its curl and shift its colour. Paint on paper divides colour by layers.

### Termites and wood chips (Resnick)
Chips are a Trail of whole numbers, one per pixel, that never fades or spreads. 65,536 termites walk the trail's pixels like a chess board (On the grid, eight directions). **Termite rule**: empty-handed on a chip, reach for it; take it next step if alone (the handshake); carrying, when it bumps into a chip, walk on to a free cell and put the chip down; rest a moment after each act. Scattered chips gather into fewer, bigger piles, exactly conserved.

### Fireflies flashing in time (Mirollo & Strogatz)
65,536 fireflies, each with a clock in Memory.x running at its own pace. At 1 it flashes (deposits one unit of light) and starts again. A firefly that sees light jumps its clock by `coupling × light × phase` (more the later in its cycle), and is deaf for a moment after its own flash. Random twinkling becomes patches flashing together, then waves of light sweeping the meadow, then near-unison (the order parameter R = |mean e^(2πi·phase)| rises from 0.01 to 0.74 in a minute).

### Infection spread (SIR, with waning immunity)
262,144 people. Memory.x: susceptible, infected or recovered; Memory.y: time in that state. The infected breathe one unit of infection into the Trail's second channel every step; a susceptible person catches it with chance `1 − e^(−(infectivity × exposure + imported) × dt)`; the infected recover after Sick for, the recovered lose their immunity after Immune for (0: for good, plain SIR). Rings of infection travel out from the first cases with immune green centres; as immunity wears off new rings start and meet.

## Speed (M3 Pro, headless Chrome on ANGLE Metal, 1920 × 1080)

The agents engine alone, each frame finished on the GPU (median of 120 frames after 10 s of running):

| Example | Walkers | Steps a frame | ms a frame |
|---|---|---|---|
| Predators and prey | 256k (2 trails) | 2 | 5.0 |
| Diffusion-limited aggregation | 64k | 4 | 3.8 |
| Sand drift | 256k | 8 | 8.8 |
| Crowd | 64k | 2 | 1.6 |
| Painter bots | 64k | 2 | 2.5 |
| Termites | 64k | 8 | 3.5 |
| Fireflies | 64k | 1 | 1.6 |
| Infection | 256k | 2 | 3.6 |

Every example is deterministic: offline twice, and live at 30, 60 and 120 Hz and with a stall, give the same state, bit for bit. Exported pages run the same simulation as the app: Predators and prey, Termites, Sand drift and Fireflies were checked at 960 × 540 to 6 s (pictures within 2 levels of 255).

## Sources

- T. A. Witten and L. M. Sander, "Diffusion-limited aggregation, a kinetic critical phenomenon", *Physical Review Letters* 47 (1981).
- M. Resnick, *Turtles, Termites, and Traffic Jams: Explorations in Massively Parallel Microworlds*, MIT Press (1994): the termites and the traffic jams.
- A. J. Lotka, *Elements of Physical Biology* (1925); V. Volterra, "Fluctuations in the abundance of a species considered mathematically", *Nature* 118 (1926).
- W. O. Kermack and A. G. McKendrick, "A contribution to the mathematical theory of epidemics", *Proceedings of the Royal Society A* 115 (1927).
- R. E. Mirollo and S. H. Strogatz, "Synchronization of pulse-coupled biological oscillators", *SIAM Journal on Applied Mathematics* 50 (1990); J. Buck, "Synchronous rhythmic flashing of fireflies II", *Quarterly Review of Biology* 63 (1988).
- B. T. Werner, "Eolian dunes: computer simulations and attractor interpretation", *Geology* 23 (1995): the slab model of the sand drift.
- D. Helbing and P. Molnár, "Social force model for pedestrian dynamics", *Physical Review E* 51 (1995), and D. Helbing et al., "Self-organized pedestrian crowd dynamics" (2005): lane formation; B. D. Greenshields, "A study of traffic capacity" (1935): speed falling with density.
- J. Jones, "Characteristics of pattern formation and evolution in approximations of Physarum transport networks", *Artificial Life* 16 (2010): the sense, steer, move and deposit loop the Agents group is built on.
- S. Papert, *Mindstorms* (1980), and H. Abelson and A. diSessa, *Turtle Geometry* (1980): the painter bots' turtles; C. Langton, "Studying artificial life with cellular automata", *Physica D* 22 (1986): the ant that turns by what it finds.
