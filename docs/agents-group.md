# The Agents group: slime mold and particles built from nodes

Hundreds of thousands of tiny walkers on the GPU (up to four million). Each one sniffs the trail ahead of it, turns toward the strongest smell, takes a step and leaves a little more trail. The trail spreads and fades. Veins, networks and rivers grow by themselves. In 2D on the picture, or in 3D in a box seen through a camera (see **3D** below).

Or as many particles: forces push them (gravity, wind, curl noise, the mouse, a vortex, a field, the sound), Integrate moves them, and they live, fade and are born again. The Particles node's look, built from nodes you can open and rewire.

For a few thousand agents with flocking rules and predators on the Play page, use the **Agents layer** instead (docs/agents-layer.md). This is the Studio's node-built version, for hundreds of thousands to millions.

## Start here

1. In the node browser, open **Generators → Simulation** and add a preset. It builds the whole setup in free space beside your graph (never on top of it) and wires it into your Output.
   - Or add a bare **Agents** group: it asks what to start with. **Particles** (Emit → Agents with Curl noise → Integrate inside → Draw agents) or **Slime (with a Trail)** (Emit → Agents with Sense → Steer → Move inside → Deposit → Trail field → a palette) build a small working setup round it, drawn over what the Output showed; **Empty group** is the group alone, for building it yourself.
   - Every preset, example and new group starts at **256k** walkers (262,144), so nothing overloads a laptop the moment it opens; raise Count on the group card for more. Graphs you saved keep their own counts.
   - **Slime mold**: walkers burst out of the middle as a fan of branching veins, then join up into a network that keeps reorganising.
   - **Particles**: the Particles node's embers, built from nodes: a ring streaming into curl currents, lit by four orbiting lights. The mouse pulls and stirs them.
   - **Curl smoke**: ink-like smoke rising from a small source and breaking into wisps.
   - **Sound burst**: a disc of glowing streaks that a shockwave blasts out on every beat (a silent stand-in beat until you give it real sound).
   - **Multi-species slime**: three colonies (coral, teal, violet) grow toward each other; each follows its own kind's trail and avoids the others', so they carve the picture into territories.
   - **Ants**: ants leave a nest, find three food piles, carry food home and lay a smell as they go; roads form from the nest to the food and bend round the rocks. Each ant remembers whether it carries food.
   - **Boids**: flocking through a field: every bird leaves its velocity in a blurred trail and steers to match the flow around it; flocks gather, wheel and stream past each other.
   - **Strands**: slime combed into long flowing filaments, drawn as ink on paper.
   - **Grow toward a picture**: slime feeds on a picture's bright parts and draws it in veins. A built-in moonlit picture; load your own into its Texture Input node and set Yours to 1.
   - **Galaxy**: stars circle a bright core and crowd into two spiral arms that turn slowly; the arms light up blue as stars pass through them. Each star remembers its own orbit.
   - **Mycelium**: a fungus colony creeps out of a spore: growing tips shy away from threads already there and new ones sprout on the young threads at the edge, so it branches outward into a fuzzy mould.
   - **Sand on a plate**: grains on a ringing square plate gather on its still lines (a Chladni figure) and stay there. Its stand-in Beat is off: set the group's Beat to 20 (or give it real sound) and every beat jolts the sand off and steps the plate to the next figure.
2. Press play. Double-click the Agents group to see the rule inside.
3. Every node a preset adds has a note (the speech-bubble tab on the card) saying what it does and what to try.
4. **Next steps.** While a group lacks something it needs to show anything, its card lists it with a one-click button that adds and wires it: **+ Emit** (no Emit: they are born anywhere, all at once), **+ Draw agents** or **+ Deposit + Trail** (nothing shows the walkers), **+ Deposit + Trail** (the rule's Sense smells a trail nothing lays), **Show on the Output** (they are drawn but the Output shows something else). The × hides it on that group; presets never show it. Inside, an empty rule offers **+ Slime: Sense → Steer → Move**, **+ Particles: Curl noise → Integrate** and **+ Just walk: Move**.

## Using Agents with your shaders

The walkers don't need a preset's picture: anything you have built from ordinary nodes, or written as your own shader, can steer them, feed them, give birth to them, colour them, or use what they leave behind. Four doors, and every one takes any chain of nodes:

| Door | What goes in | What it does |
|---|---|---|
| **Field ƒ** (Sense, Flow), **Obstacle ƒ** (Move), **Shape ƒ** (Collide), **Where ƒ** (Emit) | Any float chain: an SDF, noise, a UV trick, a picture's brightness | The chain is read **at the walker's own position** (Sense: at each of its three sensors; Flow: either side of it, for the slope). Wire the chain into a port on the group (+ Add Input on Agent Inputs, type number), then the port into the socket (Emit, outside the group, takes the chain directly). UV inside that chain is the walker's position. |
| **Picture** (Emit) | Any texture: a Pass, a Trail, Motion (texture) | Walkers are born where it is bright. Draw your shader into a **Pass** and wire its Texture here. Wire the same Texture into a texture port on the group, and **Sample (texture)** inside reads its colour where the walker is (an unwired UV is the walker's position). |
| **Add** and **Block** (Trail field) | Any chain (Add: a vec4, one amount per channel; Block: a float) | Add paints the chain into the trail every step at each trail pixel: **food**. Block wipes the trail where it is 1: **walls** nothing smells through. Put food in a channel the walkers smell but the picture doesn't show (Sense's Channels), and you see the veins, not the food. |
| **Texture** (Trail field) | — | The trail as a texture any shader can use, exactly as it uses a Pass: **Sample**, **Blur**, **Glow** or **Edges (texture)**. A blurred trail is a mask; Edges' Direction bends UVs round the veins. |

One chain can go to several places at once: the same SDF can be food (Trail Add), a wall (Obstacle ƒ) and part of the picture, so the drawing and the rule always agree.

**Examples** (Examples → *Agents with shaders*), each one pattern, every node explained in its note:

- **Slime on SDF rings**: a Circle SDF repeated into rings → Trail field **Add** (food). The slime settles on the rings and bridges them.
- **Shapes as walls**: Shape SDFs (heart, star) and a Circle SDF joined with min() → Move's **Obstacle ƒ**, the Trail's **Block**, and a second Sense whose **Gradient** bends a slow wind round them.
- **Ink along a noise field**: Fractal Noise (FBM) → Flow's **Field ƒ** in Around mode (the noise's curl): ink strands that follow its contours.
- **Spirals from polar UV**: UV → Polar Space → a spiral → Sense's **Field ƒ**, added to the trail: the slime grows into turning spiral arms.
- **Born from your shader**: your shader → **Pass** → Emit **Picture** (born on its bright parts) and, inside, **Sample (texture)** for each spark's colour (kept in Memory), drawn over a dimmed copy of the shader.
- **Trails reshape a shader**: Trail **Texture** → Edges (texture) bends an ordinary shader's UV, Blur (texture) masks in a hot second version of it.
- **Slime traces outlines**: a picture → Pass → **Edges (texture)** → a second Pass → a second **Sense** (through Also) and Emit Picture: the slime draws the picture's outlines. Load your own picture into its Texture Input.
- **Rings that pulse to sound**: one ring SDF, swelling with a beat (Audio Input or a silent stand-in), both drawn and pulling particles down onto it through **Flow** (Slope, negative Strength).

What can't be read inside: a chain that reads the previous frame (Echo, Bloom, the old blurs) or screen derivatives. A Pass can: draw that chain into a Pass first and wire its Texture in.

## The nodes

**Outside** (the top level of the graph):

| Node | What it does |
|---|---|
| **Agents** | The group. Its inside is the rule one walker follows every step. Count (64k to 4M; 256k for a new group), Species, Steps per frame, Seed, Pre-roll. Double-click it or press **Open rule ↗** to edit the rule. **↺ Start over** starts the simulation again. The live view of where the walkers are can be hidden (**Hide view**, remembered on the node); it costs about 0.1 ms a frame on an M3 Pro and pauses by itself while the card is off screen. |
| **Emit** | Where walkers are born. **Fill** gives everyone a place at once (slime); **Rate** gives birth to a stream of them a second, each living for Life; **Keep full** gives everyone a place at once, at a random age, and each a new life the moment it dies (particles). Shapes: point, **line** (across, Size each way), ring, disc, box, whole picture, **Picture** (where a texture wired into Picture is bright) and **Field** (where a chain wired into Where ƒ is above Threshold). With Picture or Field, **No place found** says what happens when none of its 8 tries lands somewhere bright enough: born at the best try anyway, or **not born this time** (it tries again later: walkers then only ever appear on the picture or the field, however sparse). Facing: random, inward, outward, up. **Speed ±** and **Spread** vary how they set off; **Burst** (a trigger) gives everyone a new life at once. **Species** says which kind they are (chain one Emit per species to give each colony its own place: wire the next Emit into **+ Another Emit**). |
| **Deposit** | Every walker leaves Amount of trail on the pixel it stands on, every step, into the Trail field it's wired to: in its own species' channel, or what Agent Output's Deposit says. **What: Velocity** leaves its velocity and a count instead, so the trail becomes a field of how the crowd moves (flocking). |
| **Trail field** | The trail. Each step it spreads (Diffuse) and fades (Half-life). **Amount** (0–1) goes into a palette or the Output; **Image** (the whole trail as a texture) goes back into the group for Sense, or into Glow, Blur or Sample (texture). Resolution: ½, ¼ or the full picture, or a fixed 512 / 1024 / 2048 rows for a look that doesn't change with the window. **Spread** 3×3 (the slime paper's) or a softer 5×5 blur. **Add** paints anything into the trail every step (food from a picture, a shape, noise); **Block** wipes it where it is 1 (walls nothing can smell through). |
| **Draw agents** | Draws the walkers themselves over the picture wired into Over, with the Particles node's looks: soft dots (**Points**), dots with its glow (**Glow**), short lines along their motion (**Streaks**), or dark ink on paper (**Ink**). Colour by species, speed, heading, age or **Agent** (the Colour its rule set), or the Particles node's own orders (**Speed, fast first**; **Heading, once round**), between Colour A and B or along one of the Particles palettes; **Lights** (up to four, orbiting or still) brighten the walkers near them and add halos. **Brightness of The crowd** keeps the cloud as bright at any count, as the Particles node does. |

**Inside the group** (only here):

| Node | What it does |
|---|---|
| **Agent Inputs** / **Agent Output** | This walker at the start and the end of the step. They're always there, and they are the group's only ends (an Agents group has no generic Group inputs / Group output cards). Agent Inputs has two parts: **This walker** (its own Position, Velocity, Heading, Speed, Age, Life, Species, Index, Random, Memory, Colour: you rarely wire these, since any unwired socket inside reads them by itself) and **From outside the group** (each input added with **+ Add an input from outside** is also a socket on the Agents card, where you wire a Trail's Image, a number or a picture). Anything left unwired on Agent Output keeps the walker's value ("unchanged"), so an empty group stands still. **Memory** (two numbers it keeps from step to step: an ant's "carrying food"), **Deposit** (how much trail it leaves in each channel) and **Colour** (its own colour, for Draw's Colour by Agent) give every walker state of its own. |
| **Sense** | Reads the trail (**Trail image**) and/or any chain of nodes (Field ƒ) at three points: Distance ahead, Angle to the left, straight on and Angle to the right. **+ Other readings** adds another Sense's. |
| **Steer** | Turns by the readings. **Jones** is the slime-mold paper's rule; **Smooth** turns in proportion; **Away** runs from the strongest. Turn and Jitter. |
| **Move** | One step along the heading at Speed (**+ Drift** adds a velocity). At the edges: Wrap, Bounce or Slide. **Obstacle ƒ** takes a shape's distance: walkers turn back (or slide along it) instead of stepping in. |
| **By species** | One of four numbers by the walker's species. |

**Particles inside the group.** Forces each have a **+ Another force** input: wire one force's Force into the next one's **+ Another force** and they add up (Curl → Vortex → Attract), then the last into **Integrate**'s Force. (Saved graphs keep their wires: only the name changed, from Also.)

| Node | What it does |
|---|---|
| **Gravity** | A constant pull, down by default; point it up for smoke. |
| **Wind** | A steady wind along Angle, with gusts (the Particles node's). |
| **Curl noise** | Swirling currents that never bunch up (the Particles node's Turbulence): streams, threads and eddies. Size, Evolve. |
| **Attract / Repel** | Pulls toward the mouse, a point, or anything wired into Target (a hand, a null); negative Strength pushes away. Within Reach (like a hand) or Everywhere; Swirl stirs round it. |
| **Vortex** | Swirls round a centre, strongest at Reach (the Particles node's Swirl). |
| **Flow** | Pushes up a field wired into Field ƒ (any chain: noise, a shape's distance, a picture), or round its contours. |
| **Sound kick** | Sound as a force: **Shockwave** (a ring of pressure on every beat), **Wave** (rings as loud as the sound was), **Vibrate**, **Shake**. |
| **Integrate** | The total force becomes motion: velocity, Drag, Max speed, Mass, then the position. Edges: Free, Wrap, Bounce, Slide or Die. |
| **Age / Life** | Alive (0 when its life is up: Emit's Keep full brings it back), Age, Age 0–1 and Fade. |
| **Collide** | After Integrate: keeps walkers out of a shape (its distance into Shape ƒ); they slide round it. Bounce, Friction. |
| **Collide (3D scene)** | In a 3D group, after Integrate: keeps walkers out of a ray-marched scene (a Scene through a port on the group), read on a coarse 48-cell grid; they bounce off or slide along its surfaces. Scene size, X / Y / Z, Margin, Cushion, Bounce, Friction. |
| **Chladni** | After Integrate (or alone): sand on a vibrating plate gathers on its still lines. Square or round; N and M, or the sound, pick the figure. |

**Sound.** Sound kick and Chladni listen to **Sound from**: the **Level** slider (map Live audio or a track to it in Play), the **Mic**, or the Play page's **Audio engine** (its master or a track). **Beat** is a silent stand-in kick at a tempo while you build: it only moves numbers, and it is part of the simulation, so a recording matches the preview. Set it to 0 when real sound drives Level.

On a plate (Chladni) every beat does two things: it shakes the sand much harder for a moment (Shake rises with each hit), and, with Mode from Sound, it steps the plate to the next figure, which takes the sand a second or two to find. With a slow Beat that reads as a pulse every few seconds; that is the beat, not a glitch. Sand on a plate ships with Beat 0 (a still figure) for that reason.

The group has a **Sound from** of its own (its Sound section): **Each node's own** (the default) leaves every listening node to its own card; any other choice (Level and Beat, Mic, Audio engine, Engine track 1–8) is shared by every Sound kick and Chladni inside, with the group's **Level** and **Beat**. One switch on the group card makes the whole rule hear the engine's kick track.

## 3D

Set the group's **Space** (its Agents section) to **3D** and the walkers live in a box: the picture across and up (x ±aspect, y ±1) and 2 deep (z from −1 to 1). Changing Space starts the simulation over.

- **Inside**, every position, velocity, force and heading has a z. The wires turn teal (vec3) by themselves; a heading is a direction (a vec3), not an angle. Unwired sockets still read "this walker".
- **Sense** reads a cone round the heading. **Sensors (3D)**: *Turning plane* (the default, 3 reads) puts the left and right sensors in a plane through the heading that turns at random every step, so over a few steps they sweep the whole cone and **Steer** turns in that plane; *Ring of 4* (5 reads) senses four directions round the cone every step and Steer turns toward the stronger pair. Its new **Channels here** output is the trail's four channels where the walker stands (for flocking on a velocity trail).
- **Move** and **Integrate** keep the walkers in the box (Wrap, Bounce, Slide and Die work on z too). **Emit** gains **Z** and two 3D shapes, **Sphere** (its shell) and **Ball**; Box is a cube, Whole picture the whole box, Picture and Field are born where bright at any depth.
- **Forces in 3D**: Gravity (Angle in the picture's plane, or any Direction wired), Wind (its gusts drift through the box), **Curl noise** (the Particles node's 3D curl: streams fold into sheets and threads), **Attract / Repel** (toward a point in space: **Z**), **Vortex** (**Axis**: Depth swirls in the picture's plane as in 2D, **Up** round the vertical like a whirlpool or a galaxy, Across round the horizontal), **Sound kick** (its rings are spheres), **Chladni** (the plate lies flat, across and in depth, at height Y, as the Particles node's does in 3D; **Z** moves it), Integrate and Age / Life as they are.
- **Flat in 3D** (each card says so): shapes and fields wired into **Field ƒ**, **Obstacle ƒ**, **Shape ƒ** (Collide), **Flow** and **Where ƒ** are read at the walker's x and y, so a shape is the same all through the depth (a prism) and Flow pushes in the picture's plane. Sense's 5-tap cross and Deposit's Size are 2D only (one cell in 3D). For 3D shapes, use **Collide (3D scene)**.
- **Collide (3D scene)** keeps walkers out of a ray-marched scene's shapes: on Agent Inputs, **+ Add an input from outside** of kind **Scene**, wire a Scene Group's Scene into that socket on the group card (the same Scene the March Loop draws), and the port into Collide (3D scene)'s Scene, after Integrate. The scene's distance is sampled on a coarse 48-cell grid round X, Y, Z reaching **Scene size** (the Particles node's grid, filled every step from the scene, so a moving scene moves the same live and in a recording), and a walker that touches a surface goes back onto it with its inward speed gone (**Bounce** keeps some), with a **Cushion** that parts a stream just before it touches. The scene itself is never ray-marched per walker (a Scene can't go inside the group; its grid program runs beside it). Keep Scene size just big enough to hold the shapes: a cell is Scene size ÷ 24 across.
- **The trail is a volume.** A Trail field filled by a 3D group keeps a volume over the box: **Volume** rows and as many slices deep (64, 96 (the default), 128 or 160; columns follow the picture's shape, so 96 at 16:9 is 171 × 96 × 96, about 1.6 million cells, 25 MB with its copy). Each step it spreads to each cell's 6 neighbours (Spread 3×3) or the softer 27-cell blur (5×5) and fades. Sense inside the group reads it in 3D. **Amount**, **Channels** and **Image** are the volume seen from the front, summed through its depth (the card's thumbnail too): a 3D trail's picture is a front view; Draw agents is how you see 3D walkers through a camera. A Trail's **Add** and **Block** don't work on a volume yet (the card says so).
- **Distances are in picture units in 3D too**, but a volume's cells are coarser than a 2D trail's pixels (96 rows: a cell is 0.02 across, against 0.002 for a 1024-row trail), so a 3D slime wants its sensors and its speed about ten times further than a 2D one: Sense Distance 0.1–0.2, Move Speed 1–1.5. With 2D settings the walkers can't escape their own trail and gather into balls.

**Draw agents in 3D** sees the walkers through a camera, the same camera as Time Cube View and Frame Stack: **Distance**, **Angle** (degrees here), **Elevation** (degrees), **Orbit speed** (degrees a second), **Zoom**, **Flatten** (perspective to isometric), **Translate X / Y / Z** (move the camera and the point it looks at together). It turns the March Camera's way round, so the same numbers give the same view. On top, the Particles node's **Drift** (a slow turn, a bob and breathing) and depth of field: **Focus** (where it is sharp, as a share of Distance), **Blur** and **Max blur** (out of focus a walker spreads into a soft disc that keeps its light; wider than Max blur, walkers are thinned at random and each survivor is heavier, so blur costs no fill rate). Streaks draw their sharp share as lines and the blurred share as discs. Lights orbit in 3D and their halos land where the camera sees them.

**Examples** (Examples → *Agents in 3D*), every node explained in its note:

- **3D slime mold**: the slime rule in a 96-row volume, a foam of tubes through the whole box, an orbiting camera.
- **3D flock**: boids reading a velocity volume (Deposit What Velocity fills x, y, z and a count), Sense's Gradient and Channels here into a Flock block; flocks gather and wheel while the camera circles.
- **Swarm round a torus**: a ray-marched torus and a swarm that circulates round its tube like a smoke ring (an Expression Block), kept off its surface by Collide (3D scene), drawn through the March Camera and hidden behind the torus (Depth).
- **Galaxy in 3D**: the 2D Galaxy's orbits laid in a thin disc (Memory keeps each star's radius and height), seen from above by a circling camera.
- **Fireflies in the dark**: depth of field: a camera among slowly drifting fireflies, a shallow Focus and a strong Blur, out-of-focus ones as soft discs of light.

**Inside a ray-marched scene.** In 3D, Draw agents has three more sockets: wire a March Camera's **Ray Origin** into **Camera from** and its **Ray Dir** into **Camera ray**, and the walkers are seen through that camera, so they stand in the scene (the camera is rebuilt on the GPU from four of its rays each frame: no lag). Wire the March Loop's **Distance** into **Depth** and walkers behind the scene's surfaces are hidden. Focus is then a share of the distance to the world's centre; the lights' halos aren't drawn with a scene's camera.

## From the Particles node: Open as nodes

Every Particles node has **Open as nodes ↗** under its presets. It builds the same particles as an Agents group under the node, with every setting it can carry: the emitter as Emit, Gravity, Wind, Turbulence, Swirl, Attract, the hands, Flow and the sound's Wave, Vibrate, Shockwave and Crunch as force nodes chained through their "+ Another force" inputs, Drag in Integrate, Obstacle as Collide, Pattern as Chladni, the look and the lights in Draw agents. What was wired into the node comes along (Over, the Emitter position, a wired Turbulence or hand, the Obstacle and Flow shapes, through ports on the group). The copy is wired where the Particles node was; the node itself is left as it was, so compare them and delete it when you like. Undo takes it all back.

Every node it adds has a note saying which of the Particles node's settings it carries. **In 3D** the copy is 3D too: the group's Space is 3D (its forces are the Particles engine's 3D ones), Sphere and Ball are born as such, and Draw agents carries the camera (Camera angle as Angle, Camera tilt as Elevation, Camera distance as Distance, its lens as Zoom, its Drift, Focus and Blur, and its way round, so the copy's picture matches the node's), or the scene's camera and Depth when they are wired, and a wired Scene as Collide (3D scene) with its Scene size. Anything it can't carry yet is listed (in the message, and at the end of the group's note): the Image emitter holding its picture (the copy is born on the picture's bright parts but doesn't hold it), Gust and Jet, the Burst emit mode, UV.

## Play: controls, pins, hands, the Motion layer

- **Every slider inside is a Play control.** Right-click any slider inside the group (or on the group card) → Add to Play controls, Drive with a null, MIDI learn, LFOs: they are uniforms of the update shader, so nothing recompiles. Play's Add control lists them as *Group › Node · Slider*.
- **Pinned sliders.** Right-click a slider inside → **Pin to the group card**: it shows on the card under the dots, so Turn, Speed or a force's Strength can be changed without opening the group. It is the inner slider itself (the same value, uniform and Play control); right-click it on the card for Play, or **Unpin**. The presets don't pin anything; the Play example pins four.
- **The live dots.** The group card shows where the walkers are now (a sample of at most 65,536, drawn every tenth frame while the card is on screen, read back without waiting for the GPU: about 0.1 ms a frame). **Hide view** turns it off for that group.
- **Hands, nulls, the pose and the mouse.** Attract / Repel's Target, Vortex's Centre at and Emit's At have **A hand or null (Hand X / Y)**: a place 0–1 across and up the picture, the Particles node's hand units, so a position mapping lands on it at any picture shape. Right-click Hand X → **Follow a hand in Play**: both sliders become Play controls paired as one position, mapped to the pointer over the picture and then a tracked hand's index fingertip (the hand wins once it has been seen). Or **Add as position with Y** in Play and map the pair to a null, the pose, a face or a layer.
- **Start over and Burst as triggers.** The group's **Start over** slider and Emit's **Burst** rise past 0.5 to fire: route a key, a beat, a pad, a gesture or a rule to them.
- **Readings: what the walkers are doing.** An Agents group reads like a layer: in a mapping's source pick *Layer sensor* and *<group> · walkers*, or in a rule's condition the *Agents groups* section. **Alive** (the share alive), **Speed** (their mean speed, 1 at a picture height a second), **Spread** (0 all in one place, 1 spread evenly over the picture), **Centre X / Y** (where their centre is, 0–1) and **Group 1–4** (each species' share of the live walkers). Map Centre X to a pan, Spread to a filter, or fire a rule when Alive drops below a half. They are summed on the GPU only while something reads them, and arrive a frame or two late (a take records what its mappings made of them).
- **A Pass as food or a birthplace.** Emit's **Picture** takes a Pass's Texture (born where the pass is bright), and Where ƒ, a Trail's **Add** or a group port can read a chain through Sample / Edges (texture) of a Pass. The passes the agents read draw before their step. **Passes 6 · Slime along edges** feeds the slime on the outlines Edges (texture) finds in a Pass.
- **The Motion layer as a texture.** Sources → **Motion (texture)**: the Play page's first Motion layer's grid (docs/motion-layer.md). **Amount** is how much moved at a point (0–1); **Texture** goes into Emit's **Picture** (born where it moves), an Agents group's added port (Sense smells it, Sample (texture) reads it), a Trail's **Add** (food where people move: wire Amount, it is read at each trail pixel), Glow or Blur. It is a frame late, like the Layers node, and live input: a render reads what the layer saw then.

**Example**: Play → *Agents in Play* → **Agents: a hand and a beat**: 262,144 particles (256k) your hand (or the pointer) pulls and stirs, a fist pushes them away, B bursts them and R starts over, while the Audio engine's kick track (the group's Sound from: Engine track 1) blasts shockwaves through them.

Any ordinary node can join the rule: noise to wobble the turn, a shape's distance into Sense's Field ƒ to avoid it, an Expression Block to reshape the readings (the preset's **Crowding** does this), Time, Audio Input, MIDI. Every unwired socket on the Agents nodes means "this walker", and every node that would read the pixel's position reads the walker's position instead.

What can't go inside, and why (the card says so):

- Nodes that read the previous frame (Echo, Previous Frame, the blurs, Bloom): a walker is not a pixel of the picture.
- Pass, another Agents group, Trail, Deposit, Emit, Draw agents, the Particles node, the Output: they are programs of their own.
- Scene Group, March Loop, GI March, Space Warp: a ray march per walker is too costly for now.
- Any node whose code reads screen derivatives or gl_FragCoord (found by reading the code, so new nodes are covered).

## Seeing inside: the eye and Show passes

- **Unwired means "this walker".** Inside the group a socket left unwired that reads the walker by itself says so in faint type on the card ("← this walker's position", "← this walker's heading", "← a fresh random number"); on Agent Output it says "unchanged".
- **The eye on a node inside the group** shows what an agent standing at each pixel would see: the node, and the inside nodes it depends on, with the agent at that pixel, facing right, species 1, remembering nothing. On Sense it shows the three sensors' readings (left, centre, right as red, green, blue) on this frame's trail; on Flow or Collide, their field. The simulation keeps running underneath.
- **Show passes** (the layers button on the canvas toolbar, when the graph has Pass nodes or an Agents group) rings every card in the colour of the program it runs in: a Pass (blue, purple…), the Agents group (amber: its inside, what is wired into its ports, Deposit, Trail and Draw) or the picture (green). A card compiled into two programs, such as a shape both the walkers and the picture read, is striped.

## The loop, and the "↺ last step" chip

The Trail's Image goes back into the group it is filled by. That loop is the whole point: walkers follow the trail other walkers left. Inside the group the trail is always **as it was one step before**, and the wire carries a small **↺ last step** chip to say so. On the top level that wire runs back over the top of the cards between the Trail and the group, so it and its chip sit in clear space. Anywhere else (a palette, a Pass) it is the trail as of this frame.

## Speed, steps and the clock

- One step is 1/60 s of simulated time. **Steps per frame** (default 2) is how many run each frame at 60 fps: the simulation's speed.
- When the GPU can't keep up, fewer steps run and the simulation falls behind the clock (the card says "running at ×0.6"); the number of walkers never changes by itself.
- The simulation depends only on the step number and the Seed. A recording or a rendered video runs exactly the steps up to each frame on its own copy, so it is the same every time on the same machine (and the preview's simulation is left alone). Across different GPUs it can differ by float rounding, which a chaotic system grows over time.
- Rewinding the clock (or ↺ on the Time node) starts the simulation over.

Measured on an M3 Pro (Chrome, ANGLE Metal), one million walkers, 2 steps a frame, after the network has formed: about **5.8 ms a frame** with the trail at half of a 1080p picture, **9.5 ms** with the preset's 1024-row trail at 1080p. Drawing the deposits (one point per walker per step) is most of it.

The presets now ship at 256k (above); these are the measurements at one million, for when you raise Count. The P3 presets at one million walkers, 1080p: Multi-species slime 11.8 ms a frame, Grow toward a picture 10.3 ms, Strands 18 ms (ink streaks), Boids 15.7 ms and Ants 14 ms (both ship at 256k: 3.9 and 3.5 ms).

The P6 presets at their first sizes, 1080p: Galaxy (1M) 6.9 ms a frame, Mycelium (64k) 1.8 ms, Sand on a plate (1M) 5.6 ms. Readings cost nothing measurable.

One million particles (the Particles preset), 2 steps a frame at 1080p: about **7 ms a frame**, of which the steps are 1.6 ms and the glowing draw the rest; Streaks (two vertices a particle) about 10 ms.

**In 3D** (M3 Pro, headless Chrome on ANGLE Metal, 1920 × 1080, each frame finished on the GPU; update = the steps, draw = Draw agents):

| | 64k | 256k | 1M |
|---|---|---|---|
| 3D slime in a 96-row volume, 2 steps a frame (glow through the camera, Blur 0.3) | 1.8 + 0.8 ms | 3.5 + 1.2 ms | 12.5 + 3.9 ms |
| Ink in water opened as nodes (3D curl, 1 step a frame, ink streaks with depth of field) | 0.5 + 1.3 ms | 0.7 + 2.3 ms | 1.0 + 9.2 ms |
| Swarm round a torus (Collide (3D scene)'s grid filled every step; the scene camera and depth probes in the draw) | 0.6 + 1.2 ms | 0.8 + 1.5 ms | 3.0 + 4.7 ms |
| Galaxy in 3D | 0.5 + 1.0 ms | 0.9 + 1.3 ms | 2.3 + 3.9 ms |
| 3D flock (velocity volume, streaks) | 1.8 + 0.9 ms | 3.5 + 2.4 ms | 11.4 + 10.6 ms |

The examples ship at 256k (the flock and the fireflies at 64k). Filling a Collide (3D scene)'s grid (110,592 cells of a torus) costs about 0.1 ms a step.

A 3D slime step costs about a third more than a 2D one at the same count: Deposit into the volume and its spread (6 neighbours) are most of it, and both grow with Volume (64 rows: the 1M slime's steps take 8 ms, not 12.5). Depth of field costs no fill rate (wide discs are thinned), but streaks at a million, half lines and half discs, are the heaviest draw.

Steps per frame also sets the pace: one step is 1/60 s of simulated time, so 2 steps a frame runs the particles twice as fast as the Particles node does. Set it to 1 for the Particles node's own pace. Lifetimes, Drag and forces are in simulated seconds; Beat, Evolve and the lights follow the clock.

## Limits for now

- Up to 4 Agents groups and 4 Trail fields per graph; 4 species; 16 textures per program (each group counts its two state textures).
- 3D: fields and shapes wired in are flat (read at x and y; Collide (3D scene) is the 3D one); a volume Trail has no Add / Block yet; Deposit's Size and Sense's 5-tap cross are 2D only; the eye preview of a node in a 3D group shows it as 2D (an agent standing on the picture's plane); a volume is at most 4096 cells across in its texture (160 rows at up to 25:9); Collide (3D scene)'s grid is coarse (48 cells across), so thin shapes thinner than a cell are missed: make Scene size smaller round them.

## On web pages

Exported pages (Export → web page or embed, and Present) run Agents groups as the app does: every group's rule, Deposit, Trail fields (with Add / Block), Draw agents (points, glow, streaks, ink, lights), species and per-walker state, steps per frame and falling behind under load, Seed and Pre-roll. The page runs the app's own schedule and shaders, so on the same machine a page's render of a moment is the app's render of it, bit for bit (the simulation state; the picture differs only by the app's dithering).

- **Sound kick and Chladni**: Level and Beat work everywhere. Mic works once the visitor clicks Listen to audio on the page. Audio engine and Engine track: only the page's Granulator racks are heard, and only while they play (notes from MIDI or pads); the page doesn't play the tape (clips), and other instruments don't play on pages, so those tracks are silent there.
- **Hands**: Follow a hand works through the page's own mappings: the pointer moves the place, and a tracked hand takes over once one is seen, when the page carries hand tracking (Include hand tracking, or a Video layer's analysed hands). Without it the pointer keeps it.
- **Motion (texture)** reads the page's first Motion layer (a frame late, as in the app). A page without a Motion layer reads 0.
- **Start over** and **Burst** work from the page's keys and rules as in Play.
- **Readings** (Alive, Centre, Spread…) work on the page as in the app: the page sums only the groups its Play reads.
- Pages with agents draw at one device pixel per CSS pixel (as the app does), and need WebGL2 with float render targets; without them the page draws the picture without the agents and says so in the browser console.
- A million walkers run at 60 fps on an M3 Pro in Chrome (the engine about 10–13 ms a frame at 1080p, as in the app).
- **3D** runs on pages as in the app: volume Trails, the camera, depth of field, a ray-marched scene's camera and Depth (the page draws the same small probe programs) and Collide (3D scene)'s grid (the same grid program, every step). Checked for all five 3D examples: the page's simulation state is the app's bit for bit (to 2 s with their pre-rolls), its picture within 2 levels of 255. Readings work in 3D (Speed counts the depth; Centre and Spread are across and up).
