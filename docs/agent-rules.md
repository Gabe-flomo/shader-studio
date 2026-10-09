# Agent Rules: walker behaviour as When … Do … lines

An Agents group's rule is usually a little graph of nodes (Sense → Steer → Move, or a hand-written Expression Block). **Agent Rules** writes the same thing as a short list of readable lines:

> When food trail anywhere ahead > 0.05 → turn toward food trail (20°)
> When searching and Food > 0.5 → become carrying, bounce, set Memory number to 0; stop after this rule

The rules generate the inside of the group as ordinary nodes, so they run exactly as the node version would: the same per-agent GLSL, the same determinism, in 2D and 3D, in Play, on exported web pages and in recordings. **Open as nodes** shows (and hands you) those nodes, each with a note.

For the Agents group itself (Emit, Deposit, Trail field, Draw agents) see docs/agents-group.md; for rules written by hand from raw nodes, docs/simulations-agents.md.

## Start here

- **Builders** (the node browser's first section, on the desktop and on a phone) → **Agent Rules**, the empty canvas's right-click → **Builders** → **Agent Rules…**, or the Do… bar's "new agent rules": the setup below, with its rules editor already open. "open agent rules" or "edit the rules" opens the selected (or only) rules group's editor.
- **Builders → 3D Agent Builder** (or the right-click menu's **Builders**, or the Do… bar's "new 3d agents" / "3d agent builder"): the same in a volume, seen through a camera (below, "The 3D Agent Builder").
- **Add an Agents group** (node browser → Simulation → Agents) and pick **Rules (When … Do …)**. You get Emit → Agents → Deposit → Trail field → palette, wired to the Output, with one rule that already moves: *always → turn toward its own trail, wander, leave trail* (slime mold). **Rules in 3D**, beside it, adds the 3D Agent Builder's setup instead.
- Or open an example: **Examples → Agents: rules** (eleven templates, below).
- Or, on any Agents group in node mode, **Write as rules…** under its buttons (it replaces the inside; undo brings it back).

A rules group's card shows **Edit rules ↗** and **Open as nodes** instead of Open rule. Double-clicking its title opens the editor. Its **Rules** chip sums the rules up ("4 rules · 2 states"); a click shows every rule as a sentence, with **Copy** and **Open rules**.

## The editor

A big window in the Expression Block editor's style, in four tabs (**Species · Rules · Trails ·
Look**), one section at a time, each with its one-line "How this works" at the top. It opens on
Rules the first time, then on the tab last used. Rarely used settings are folded with a summary.

- **Species**: up to 4 species (each lays its own trail channel by default, and the group's Species follows), each with a **Speed** (picture units a second: every walker starts at it) and up to 8 **states** with a name and a colour; **Edges** (wrap, bounce, slide) for every species.
- **Rules**: the rules of the selected species (pick another above them), top to bottom. Each rule is a card: its sentence, **When** (conditions joined by *and*), **Do** (actions, in order), **Stop after this rule**, On/off, move up/down, duplicate, remove. **+ and…** adds a condition, **+ do…** an action. **Masks** (folded): up to two inputs on the group card, a texture or any number chain read where the walker stands.
- **Trails**: names for the four **trail channels** (so the sentences read "food trail"); folded, the **Sensors** (how far ahead, how wide) every trail reading uses, and the **Flow field** when a rule follows one.
- **Look**: what the picture shows (below); in 3D first the **Camera**.
- **Space 2D / 3D** (the header): where the walkers live. Switching turns the whole setup (below, "2D and 3D"); one undo step.
- **Templates…** (top right) replaces the rule set with a template's. In 3D the **3D setups** come first (they set the Emit, Trail and camera too); a flat template picked in 3D is rescaled for the volume. In 2D the 3D setups are at the end (picking one switches Space).
- **Show the lines** shows, under each rule, the Expression Block lines it compiles to.
- **Open as nodes** (bottom left) closes the editor and enters the group.

Every change applies live (a quarter of a second after you stop typing, one undo step per burst of edits).

## Kinds

The **Species** tab starts with **Kind**: what kind of walkers these are. It picks which settings show, which conditions the **+ and…** picker offers and which actions **+ do…** offers, and which templates the Templates menu lists first. It changes nothing the rules do, and a saved rule that uses something its kind doesn't offer keeps working and keeps its settings in view (a set saved before kinds is Trail followers).

| Kind | Settings | Conditions | Actions | Templates |
|---|---|---|---|---|
| **Trail followers** (slime, the default) | states, trail channels, masks, sensors, flow | trail sensed, near another species' trail, chance, age, state, Memory, mask | turn, wander, leave trail, speed, flow, bounce, state, Memory, stop, stick, die, spawn, align (via trail) | Slime mold, DLA growth, Predator & prey |
| **Particles** | masks, flow (no sensing) | chance, age, mask, Memory | apply a force, drag, fade with age, bounce, speed, wander, die, leave trail, Memory | Particles: spark fountain |
| **Flock (boids)** | Neighbours (view radius, max), masks | neighbours within reach, chance, age, mask | steer away from neighbours, match neighbours' heading, move to their centre, avoid edges, wander, speed, turn, bounce, leave trail | Flock (boids) |
| **Ants / carriers** | states, trail channels, masks, sensors, flow | state, Memory, trail sensed, near, mask, chance, age, neighbours | state, Memory, turn, leave trail, wander, speed, bounce, stop, stick, die, spawn, flow | Ants with food, Termites, Infection (SIR), Fireflies |
| **Swarm / orbiters** | Neighbours, states, flow | neighbours, chance, age, state | orbit a point, steer away, move to their centre, match heading, apply a force, drag, wander, speed, state, leave trail | Swarm: orbiters |
| **Crowd** | Neighbours, states, masks, flow | neighbours, mask, chance, age, state | turn (toward a goal), flow, slow down in a crowd, steer away, match heading, avoid edges, wander, speed, state, stop, leave trail | Crowd: two-way walkers |

**Neighbours** (Flock, Swarm, Crowd): the **View radius** (how far a walker looks; each neighbour condition or action can set its own) and **Max neighbours** (how many a reading reads at most: the cost). The rules make one Neighbours node (docs/agents-group.md "Neighbours") for each pair of *which walkers* (everyone, its own kind, other kinds) and *radius* they use; every condition and action with that pair reads the same node.

## Built-in guidance

Every builder window (`components/builders/BuilderWindow.tsx`) carries the same help, with its
words in `components/builders/helpContent.ts`:

- **How this works.** Each section opens with a short card: what it is, what it does, "you can do
  X to get Y", and one or more **worked examples** (click to insert). **Got it** hides a card;
  **Tips** in the header turns them all off, and turning it back on brings back every card you
  dismissed. Both are remembered per builder.
- **Empty states** (no shapes, no rules) always show their guidance; with tips off it folds to one
  line and its examples.
- **Field hints.** Every control has a plain-language hint on a **?** beside its label (hover or
  focus shows it).
- **Type-ahead.** Text fields complete as you type: ↑ ↓ to choose, Tab (or Enter, outside the Do…
  bar) to take one, Esc to close (`lang/complete.ts`).

A new builder adds its block to `BUILDER_HELP` and gets all of this by using `BuilderWindow`
(`<BuilderHelp id>`, `<EmptyHelp id>`, `<HintMark text>`, `<HintLabel hint>`). A test checks
that every registered section has help.

The editor uses the builders' window (`BuilderWindow`): its tabs (the same tab row as the other
builders; on a phone, the same row full screen), Tips in the header. The rules list opens with:

> **When** is the condition checked every step for each walker, e.g. *Food trail ahead > 0.3*.
> **Do** is what it does if the condition is true, e.g. *turn toward it*.
> Rules run top to bottom; "Stop after this rule" skips the rest.

with an example rule to add; an empty list shows the slime-mold rule to start from. **+ and…** and
**+ do…** are type-ahead pickers: type a few letters ("chan" → random chance) and each choice
shows its plain-language hint and an example. Every condition and action in a rule has its **?**.

### What the picture shows

**What the picture shows** (the Look tab) rewires whatever reads the group's Trail field (usually
its Palette): *Trail* (Amount, the usual), *Channel 1–4* (one trail channel alone: food only,
home only) or *Walker density* (Draw agents' Density, when the group has a Draw agents). The
Trail field has a **Channel 1–4** output each (scaled by Gain like Amount); they cost nothing
unless wired. One undo step (`agentRules/outputs.ts`).

## Conditions (When)

| Condition | Meaning | GLSL (in the rule's block) |
|---|---|---|
| always | every step | `go = 1.0` |
| trail sensed | a channel (its own, or 1–4) read **ahead / to the left / to the right / anywhere ahead / here**, `>` or `<` a value | `float(smell2.y > 0.3)` |
| near another species' trail | that species' channel, at any sensor or here, above a value | `float(max(max(smell2.x, smell2.y), max(smell2.z, here2)) > 0.2)` |
| random chance | a chance **within one second**, 0–100% | `float(dice1 < odds1)`, `odds1 = 1.0 - pow(1.0 - p, a_dt)` |
| age | seconds since it was born, `>` or `<` | `float(age > 2.0)` |
| in state | in (or not in) one of its species' states | `float(floor(mem.x + 0.01) == 1.0)` |
| Memory number | its one number, `>`, `<` or `=` | `float(mem.y > 1.0)` |
| inside a mask | a mask where it stands (a texture's brightness, or the number), `>` or `<` | `float(mask1 > 0.5)` |
| neighbours within reach | more (or fewer) than N walkers (everyone, its own kind or other kinds) within the radius: a Neighbours node's Count | `float(nb1Count > 8.0)` |

**Frame-rate independent chance.** A step is 1/60 s of simulated time whatever the frame rate (docs/agents-group.md), and a chance *p* a second is `1 − (1 − p)^dt` a step, so the chance over a second is *p* at any step length (tested at 30, 60, 120 and 240 steps a second, and by running the generated GLSL at 60 and 120). Each rule draws its own random number from the walker's seed (the step, its index and the group's Seed) hashed with a number of the rule's own: repeatable, independent of the other rules.

## Actions (Do)

| Action | What it does | 3D |
|---|---|---|
| turn toward / away from **a trail** | the slime-mold rule on that channel: straight on when it smells strongest ahead, a random side when both sides beat ahead, else toward the stronger side, by the degrees | in this step's turning plane |
| turn toward / away from **a point**, **the centre**, **the mouse** | toward it the short way round, at most the degrees a step | the point is on the picture's plane (z 0) |
| wander | a random turn of up to ± the degrees | in a random plane |
| set speed / accelerate | set it, or add the value a second (it is kept from step to step) | same |
| leave trail | add the amount (times Deposit's Amount) to a channel; **fade** weakens it with the Memory number, × e^(−fade × number) | into the volume |
| change state | Memory x becomes the state (a stuck walker stays stuck) | same |
| Memory number | set it, add to it, count it up (a second), or set it to a random 0 to the value | same |
| stop | speed 0 (another rule can set it moving) | same |
| stick | speed 0 for good: it never moves again; its rules still run (it can leave trail) | same |
| die | Alive 0 (Emit's Keep full or Rate gives the slot a new walker) | same |
| spawn a child | lays a birth mark in trail channel 4; a **Births Emit** gives birth where there are marks (below) | flat (the Emit's Field is read at x and y) |
| bounce | turns round | turns round |
| follow a flow field | turns toward (or against) a curl-noise field (Size, Evolve) | the 3D curl |
| align with the crowd (via trail) | turns toward the way the crowd round it flies: a velocity trail's flow where it stands (set Deposit's What to Velocity) | a volume of (x, y, z, count) |
| steer away from neighbours | separation: turns toward the walkers' Push (away from them, the closest counting most), at most the degrees | in 3D |
| match neighbours' heading | alignment: turns toward their average velocity | in 3D |
| move to their centre | cohesion: turns toward their Centre | in 3D |
| slow down in a crowd | speed = the species' Speed × (1 − count ÷ Jam), at least 5% of it | same |
| avoid edges | within the margin of an edge, turns back inward | the box's depth too |
| orbit a point | turns along a circle of the distance round the point, the centre or the mouse (and in or out toward it), counter-clockwise or clockwise | round an axis square to the picture |
| apply a force | gravity (along an angle), a gusty wind, curl noise, or a pull toward a point or the mouse (negative pushes away), units a second²: the velocity (heading × speed) changes by force × dt, and the heading and speed follow it. Exact for a constant force at any step length | the point is on the picture's plane |
| drag | loses that share of its speed a second: × e^(−amount·dt) a step | same |
| fade with age | its colour dims from full at birth to black at the seconds given (the rules carry a brightness; Finish multiplies the colour) | same |

Particles keep the speed their Emit shot them out at (Speed ±) on their first step; other kinds start at their species' Speed.

Rules run **top to bottom, every step**; a rule that applies with **Stop after this rule** skips the rest for that walker that step. A rule that doesn't apply changes nothing.

**Spawn a child (via the Emit mechanics).** A walker can't create another one directly: every walker is a fixed slot in the GPU's state texture, and a step only writes its own slot. So "spawn" lays a mark in trail channel 4, and the first time a rule set spawns, the editor adds a **Births Emit** in front of the group's Emit: Rate 2000 a second, Shape Field, born where the Trail's channel 4 is above 0.5 and nowhere else. Children are born near marks, a little later; each Rate birth takes the slot whose turn it is in the birth window (as every Rate birth does), and births are shared with the group's own Emit by Share. Spawning needs the group to fill a Trail (Deposit → Trail field). Use channel 4 for nothing else.

## As text: the Recipe tab

The **Recipe** tab shows the whole rule set in the shared Playfield language
(`src/lang/dialects/agents.ts`; the plan is `docs/playfield-language-plan.md` §4.4). You can
read it, change it or paste one in.

```
agents kind=ants edges=bounce
sensors ahead=0.04 angle=35deg
channels home, food
masks Food, Nest
species Ants speed=0.3 states=searching,carrying
  state carrying color=gold
  always do memory += 1/s, wander 5deg
  when searching and mask Food > 0.5 do become carrying, turn around, memory = 0 @last
  when searching and food anywhere > 0.05 do turn toward food 20deg
  when carrying do leave food 1 fade=0.15, turn toward home 20deg, turn toward (-0.15,-0.1) 2deg
```

- **Settings come first.**
  - `agents kind= edges= view= view-max=` sets the rule set's kind and edges, and how far and how
    many neighbours a walker reads.
  - `sensors ahead= angle=` and `flow size= evolve=` set the sensors and the flow field.
  - `channels a, b` names the trail channels; `_` leaves one blank.
  - `masks Food, Nest:texture` names the masks.
- **Each species follows** with `speed=` and `states=`, then its `state <name> color=…` lines and
  its rules. The rules go on indented lines under the species. On one line, put a colon after the
  species: `species Slime: always do turn toward trail 45deg, wander 7deg, leave trail 1`.
- **A rule** is `when <condition> and … do <action>, …`, or `always do …`. `@last` stops after the
  rule; `@off` switches it off.
- **Conditions:**
  - a state, or `not <state>`;
  - `<channel> ahead|left|right|anywhere|here > v`;
  - `near <Species> > v`;
  - `chance 60%` (a second);
  - `age > 2s`;
  - `memory > v`, `memory < v` or `memory = v`;
  - `mask <Name> > v`;
  - `neighbours > 8 who=own radius=0.08`.
- **Actions:**
  - `turn toward|away <channel>|centre|mouse|(x,y) 20deg`, and `turn around`;
  - `wander 7deg`;
  - `speed 0.4`, `accelerate 0.1/s`;
  - `leave <channel> 1 fade=0.15`;
  - `become <state>`;
  - `memory = 0`, `memory += 1`, `memory += 1/s`, `memory = random 2`;
  - `stop`, `stick`, `die`, `spawn 1`;
  - `follow flow 10deg`, `against flow 10deg`;
  - `align 10deg`;
  - `separate`, `match` or `cohere 12deg who=others radius=0.045`;
  - `slow jam=20`;
  - `avoid-edges 12deg margin=0.1`;
  - `orbit centre 8deg distance=0.5 cw`;
  - `force gravity 0.75 angle=-90deg`, `force curl 0.6`, `force toward mouse 1`, `force away (x,y) 1`;
  - `drag 0.35`;
  - `fade 3s`.
- **Names.**
  - A bare word in a condition is a state.
  - A channel is always followed by where it is read.
  - A mask follows `mask`, and a species follows `near`.
  - `trail` is the walker's own species' channel; `trail1` to `trail4` name a channel by number.
  - A name with a space, or one that is a keyword, is quoted: `"wood chips"`.
- **Randomness.** `wander random`, `turn toward trail random(20..40)` and a leading `random`
  draw from the interesting ranges of `src/lib/surprise`. A leading `random` sets the sensors, each
  species' speed and harmonious state colours. `seed=42` repeats a result.

Typing reads the text as you go: mistakes are shown at their line and column, with "did you mean".
**Apply** (or ⌘Enter, or leaving the box) writes the text into the editor as one undo step. The
Rules chip on the group's card shows the same text. Every template reads back from its text to a
rule set that makes exactly the same nodes (tested).

## States and the Memory limit

A walker's state is kept in **Agent Output's Memory**, which is **two floats** — so a walker remembers exactly **a state and one number**:

- **Memory x**: the state index (0, 1, 2… per species; every walker is born in the first state, Memory 0), plus 0.5 once it has **stuck**;
- **Memory y**: the **Memory number**: a timer (count up a second), a counter, a phase, an energy.

Anything more (a second timer, a remembered place) doesn't fit: use the trail to remember things about places, or a second species.

**Colour by state.** Each state has a colour; the rules write it as the walker's own Colour, and **Draw agents → Colour by → State** shows it (the same as Colour by Agent). Up to 8 states a species.

## What the rules make (Open as nodes)

| Node | What it is |
|---|---|
| Agent Inputs | the walker as the step begins, with the ports the rules read (Trail, the masks) |
| Channel weights → Sense | one Sense per trail channel the rules read, with the rule set's Sensors |
| Neighbours | one per (which walkers, radius) the neighbour conditions and actions read, with the rule set's Max neighbours, wrapping across edges when Edges is Wrap |
| Curl noise | when a rule follows a flow field |
| Sample (texture) | a texture mask, read where the walker stands |
| **Start** | an Expression Block: the values the rules carry: `spd` (its speed, or the species' Speed on its first step), `dep` (its deposit, 0), `alive` (1), `done` (0) |
| **Rule 1, 2, …** | an Expression Block per rule: `go` from its When, then each action scaled by `go`; its result is `go`, and the values it changed go on to the next block as exposed outputs |
| **Finish** | the state's colour, and the speed (0 while stuck) |
| Move | one step along the heading the rules left, with the rule set's Edges |
| Agent Output | Position, Heading (and Velocity in 2D) from Move; Speed and Colour from Finish; Memory, Deposit and Alive from the last rule that changed them |

Every node has a note; each Expression Block's note explains each named line (`go: …`, `turn1: …`). Wires show what each rule reads and changes. **Open as nodes** keeps exactly these nodes, so the picture is the same frame for frame (checked on the GPU: the same pixels after 180 steps from the rules and from the opened nodes, Infection, Ants and Predator & prey). The rule set is kept on the group: **Back to rules** on the card makes the inside from it again (replacing node edits; undo brings them back).

A rules group's walkers lay no trail on the step they are born (Agent Output's `quietBirth`): the rules decide every deposit. (A node-built group lays one unit of its species' channel at birth; see the gotchas in docs/simulations-agents.md.)

## 2D and 3D

Set the group's Space to 3D and the inside is generated again for 3D (the heading is a direction there, not an angle). Turns happen in this step's turning plane (the same plane Sense reads in); toward a point, the centre or the mouse, the point is on the picture's plane; masks are read at x and y. A 3D trail is a coarse volume (96 rows): Sensors ahead 0.1–0.2 and Speed 1–1.5, or walkers can't escape their own trail (the editor says so). Open as nodes in 3D gives 3D nodes; switching Space after opening as nodes needs Back to rules.

**The editor's Space switch** (header, Space 2D / 3D) turns the setup, not only the group (`agentRules/space3d.ts` `convertGroupSpace`), in one undo step:

| | 2D → 3D | 3D → 2D |
|---|---|---|
| Rules | a set that smells a trail: Sensors ahead and every speed (each species' Speed, set speed, accelerate) × 5 (0.03 → 0.15, 0.22 → 1.1). Flocks, swarms and particles (Neighbours, forces) are left alone: their distances are picture units either way | ÷ 5, so 2D → 3D → 2D is where it started |
| Emit | Disc → Ball, Ring → Sphere, twice the size | Ball → Disc, Sphere → Ring, half the size |
| Trail field | a volume by itself (a 3D group fills it); Volume 96 when unset, Half-life doubled | flat again, Half-life halved |
| The view | Draw agents gets the camera's settings where it has none; when the Output doesn't show the group's Draw agents it is wired to one (a new Draw agents over a Night backdrop when there is none, marked as added), and what it showed is remembered on the group | the camera view added for 3D goes (the switch's, or the 3D Agent Builder's own Draw agents and backdrop) and the Output shows what it showed before; a setup born in 3D gets the 2D starter's view instead: a Stops Palette on the Trail's Amount, on the Output |
| A shape (Around a shape) | | taken away first: it works in 3D only |

So 2D → 3D → 2D lands back on the graph it started from, and the 3D Agent Builder's setup switched to 2D is the 2D rules starter's shape: Emit (Disc) → Agents → Deposit → Trail field → palette → Output, no Draw agents. Nodes the switch, the builder or a shape add are marked with the group's id (`__spaceAdded`, `__shapeAdded`; the builder's view `true`), so only they are taken away.

**The camera** (Look tab, in 3D): Draw agents' **Distance**, **Angle**, **Elevation**, **Orbit speed** and **Zoom** as ruler sliders (typing past the end widens the range, kept on the card), with **Depth of field** (Focus, Blur, Max blur) folded and its summary showing. Round a shape they are the shape's **March Camera**'s instead (angles in radians), since the walkers are seen through it. **Around a shape** (folded, "none" until one is picked) and What the picture shows are folded under it in 3D (a 3D Trail's picture is the volume seen flat from the front).

### Around a shape

Look → **Around a shape**: **Torus**, **Sphere** or **Box** (or **None**), one undo step (`agentRules/space3d.ts` `addShapeAround` / `stripShape`), wired as the *Swarm round a torus* example is:

- **The shape**: Time → **March Camera** (3.6 away, 24° up, circling at 0.12 rad/s) → **March Loop** ← a **Scene Group** (Scene Pos → Torus / Sphere / Box SDF 3D → Scene Output); a Color Picker, **Multi-Light** and **Tone Map** light it. Every node has a note.
- **Collision**: the rules get `collide` (Scene size 1.6, Margin 0.03, Cushion 0.18, Bounce 0.2): the group gains a **Scene** socket wired to the Scene Group, and the generated inside a **Collide (3D scene)** after Move (Position and Velocity from Move, the Scene through Agent Inputs) and *Heading after the shape* (an Expression Block: the heading follows the velocity Collide leaves). In 2D Collide isn't generated (it works in 3D only); the Scene socket stays.
- **The view**: Draw agents' **Camera from** / **Camera ray** are the March Camera's Ray Origin / Ray Dir, its **Depth** the March Loop's Distance (walkers behind the shape are hidden), and it draws over the lit shape (Tone Map). What it drew over before is remembered.
- **Emit**: a Ball or Disc becomes a **Sphere** shell 1.0 round the middle (outside the shape), remembered.
- Another kind changes only the SDF; **None** takes away every node it added and puts Draw agents, Emit and the rules back as they were. A template picked round a shape keeps the shape (and its Collide); the Recipe tab's Apply keeps it too.

## The 3D Agent Builder

**Builders → 3D Agent Builder**, the empty canvas's right-click → **Builders**, or the Do… bar's "new 3d agents" (also "3d agent builder", "new agents in 3d", "add 3d agents"). It adds, on the Output:

> Emit (a **Ball** 0.5 round the middle, facing outward) → **Agents** (Space 3D, rules mode: the 3D slime, 256k walkers, Pre-roll 3) → Deposit → **Trail field** (a 96-row volume) and its Image back into the group; **Draw agents** through an orbiting camera (3.8 away, 15° up, 6° a second, a little blur) over a Night backdrop → Output

and opens the rules editor. Every node has a note saying what it does here and why.

| 3D setup (Templates… → 3D setups) | Rules | Setup |
|---|---|---|
| **3D slime mold** | always → turn toward its own trail (30°), wander ±6°, leave trail; sensors 0.15 ahead, Speed 1.2 | 256k; Ball, outward; Volume 96, Half-life 0.1; glowing dots coloured by heading |
| **3D flock (boids)** | always → steer away from neighbours within 0.08 (12°), match their heading (10°), move to their centre (3°), wobble; Speed 0.7 | 64k; the whole box, any way; streaks by heading, camera 20° up circling at 10° a second |
| **Swarm: orbiters in 3D** | always → orbit the centre at 0.6 (5°), steer away, move to their centre, wobble; more than 60 neighbours → packed (orange), faster; fewer → circling | 64k; Ball 0.8; Colour by Agent; camera 38° up (a galaxy-like ring) |
| **Particles: 3D curl smoke** | always → curl noise 1.2 (3D curl), drag 0.4, fade over 6 s; older than 6 s → die | 64k; Keep full from a small Ball; Edges Bounce |
| **Around a shape: slime round a torus** | the 3D slime, with Collide (3D scene) | 256k; a Sphere shell 1.0; the torus (Around a shape), drawn through its March Camera and hidden behind it. The Do… bar's "new 3d agents round a shape" (also "agents round a torus") adds this one |

A 3D setup picked on a flat group switches it to 3D first.

## Templates (Examples → Agents: rules)

| Template | Rules | Node version |
|---|---|---|
| **Slime mold** | always → turn toward its own trail (45°), wander ±7°, leave trail | Simulation → Slime mold |
| **Ants with food** | states searching / carrying, masks Food and Nest; count Memory up; at the food become carrying and turn round; at the nest the reverse; searching: lay home smell fading with Memory, follow the food smell; carrying: lay food smell, follow the home smell, lean toward the nest | Simulation → Ants |
| **Flock (boids)** | always → steer away from neighbours within 0.05 (12°), match their heading (10°), move to their centre (2.5°), wobble. 64k birds. It used to read a velocity trail (align with the crowd's blurred flow, turn away where the count was high): flocks drifted through each other as soft smears; now they keep their spacing and wheel as separate flocks | Simulation → Boids |
| **Particles: spark fountain** | Keep full at a fountain, shot up; always → gravity 0.75, curl noise 0.6, drag 0.35, fade over 3.2 s; age > 3.2 s → die; (off) a push away from the mouse | Simulation → Particles |
| **Swarm: orbiters** | always → orbit the centre at 0.55, steer away from neighbours, move to their centre, wobble; more than 250 neighbours → packed (orange), faster; fewer → circling | |
| **Crowd: two-way walkers** | two species; always → turn toward the goal (far right / far left), steer away from the other kind within 0.045 and anyone within 0.015, slow down as neighbours within 0.045 reach 30, wobble | Simulations: agents → Crowd: lanes in two-way traffic |
| **Predator & prey** | two species; prey in thick predator smell die; prey near predators flee (yellow) and speed up; else graze along their trail; predators follow the prey's smell | Simulations: agents → Predators and prey |
| **Infection (SIR)** | healthy / sick / recovered; a few start sick; healthy in germs fall sick (60% a second); sick leave germs and recover after 5 s; immunity wanes after 20 s | Simulations: agents → Infection spread (SIR) |
| **Termites** | new / empty / carrying; one in eight lives and lays 8 chips on empty spots; empty termites steer to chips, slow near them, wait on one and pick it up on a dice roll (only where *here* > 0.76: their own pixel surely holds a chip); carrying ones wait beside a pile on bare ground (*here* < 0.24) and drop on a dice roll; 0.3 s rest between. Piles within about 20 s; chips kept to about 1% over 30 s | Simulations: agents → Termites and wood chips |
| **Fireflies** | dark / flash; a sparse swarm (nine in ten die at birth); a 1.5 s clock in Memory; one past 60% of its cycle that sees light (sensors 0.5 ahead, ±90°) flashes at once: the swarm flashes together within a few seconds (synchrony χ ≈ 0.85–0.9) | Simulations: agents → Fireflies flashing in time |
| **DLA growth** | free / stuck, mask Seed; touching the seed or the crystal → stick; stuck walkers lay crystal; free ones wander ±60° | Simulations: agents → Diffusion-limited aggregation |

The node versions in *Simulations: agents* go further where rules can't (births near parents with energy, exactly conserved chips through a handshake, sand on a grid); each rules example's group note points to its node version.

## Limits

- **Memory: a state and one number** (two floats).
- 4 species, 8 states a species, 2 masks, 4 trail channels (spawn uses channel 4).
- Rule numbers are compiled into the shader: changing one recompiles the update shader (fast, but not a Play control). For a number to drive from Play, MIDI or an LFO, Open as nodes and wire a Constant (or the group's sliders: Count, Steps per frame, Seed, Pre-roll, Start over stay live).
- Spawn a child is births at marks, not a parent creating a child directly (see above).
- Sensing is the trail, masks and Neighbours (the walkers of the same group within a radius; see docs/agents-group.md "Neighbours" for its grid, its cost and its limits: at most 8 walkers read a cell, estimates past that, one grid sized by the largest radius).
- Two walkers changing the same trail pixel in the same step both act (taking one chip, both get one); the node-built termites show the handshake that avoids it.
- A trail never goes below 0 (only a velocity Deposit's trail is signed), so leaving −1 on a pixel that holds nothing is lost, and whoever "took" it got something from nothing. Sensing reads the trail blended over the 4 nearest pixels (the walker's own pixel weighs at least a quarter), so a rule that takes something should test *here* > 0.76 (the pixel surely holds one) and one that lays something on bare ground *here* < 0.24. Exact conservation needs an engine feature the rules don't have: a signed trail option, or reads and moves snapped to the trail's cells (what the node-built termites do).

## Code

`src/agentRules/`: `spec.ts` (the rule set's types, defaults and sentences), `generate.ts` (rule set → inside nodes), `apply.ts` (rules mode on a group, Open as nodes, Back to rules, the Births Emit), `templates.ts` (the eleven templates and their setups), `space3d.ts` (the 3D templates, the 3D Agent Builder's setup, the Space switch's conversion), `starter.ts`, `storeActions.ts` (undo, compile, Space changes). The editor is `components/NodeGraph/AgentRulesModal.tsx`; the card buttons `AgentRulesCard.tsx`. Tests: `src/agentRules/__tests__/agentRules.test.ts` runs the generated GLSL on the CPU (`cpuSim.ts`, through `compiler/__tests__/glslEval.ts`) for every condition and action, state machines, the chance, determinism and Open as nodes; `agents3d.test.ts` the 3D setup, the 3D templates and the Space switch both ways; `agentKinds.test.ts` the kinds' filters, the neighbour conditions and actions (a brute force standing in for the Neighbours node), forces, drag, fade, orbit and Open as nodes with Neighbours.
