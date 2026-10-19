# Examples curation — proposal (phase 1: audit only)

Branch `claude/examples-curation`. Nothing in the examples has changed; this is the audit and the proposal for review. The same proposal with thumbnails is an HTML page (see the end).

## Summary

- **Listed examples today:** 496 in 46 folders (plus `blank` and 4 hidden Pieces examples). **Proposed:** 162 listed (30 categories × 5, plus From the Internet’s 12 kept as they are), and 9 new examples to hand-build.
- **Compile:** all 496 load and compile in the browser with no compile or GLSL errors. Two Segment examples first failed because the page reloaded under them (Vite optimising a dependency); both compile on a clean retry.
- **Measured:** each example played for ~3 s in muted headless Chrome (real GPU), 16:9 preview ~450 px wide; GPU ms is the app’s own timer (isolated frames). The Mac was busy, so treat ms as rough (±30%). The Atlantis shader is not an example here (only “Web: Atlantic”, a different shader); nothing named Atlantis was loaded.
- **Scores (1–5):** *look* is my honest read of the thumbnail; *clarity* comes from node notes, description and graph size; *feature* is whether it shows a distinct feature; *dup* 5 = unique, 2 = a near-duplicate exists.

## Decisions for you

- **D1 — courses vs showcases.** Play (112), Learn (42) and Learn 3D (9) are numbered courses. Proposal: keep them whole and loadable as courses under Learn (they are already linked from the Present lessons), and show only 5 showpieces from each in the Examples list. The alternative is cutting the courses themselves to 5, which breaks the Play tutorial’s numbering and lessons.
- **D2 — merged categories.** 45 folders (excluding From the Internet) become 30 categories. Small folders are merged (e.g. Memory + Send & Receive + Inputs → Signals & Inputs; 3D Lighting + GI + Volumetric + 3D: Pictures → 3D: Light & Materials; Agents: rules + Simulations: agents → one; 3D Basics folds into Learn 3D; a new Splats category collects six splat examples from three folders).
- **D3 — runner-ups.** A few look-5 examples lose their slot to feature coverage: `finishWater`, `waterLayer`, `inkInWater`, `agentStrands`. Swap any of them in if you prefer looks over coverage.
- **D4 — features with no example left in the list** (still loadable, still in courses): Segment, Optical Flow, Analyze, Data Texture, Blob Track overlay, hands tracking, MIDI on Play, drum pads / Granulator / audio effects, water layer, mattes, Curve Trace pen, Grid Rules Stages/Blocks kinds. Say which must stay visible.

## Counts per category

| Category | From (today) | Today | Keep | New to build |
|---|---|---:|---:|---:|
| Play | Play (112) | 111 | 5 | 2 |
| Learn (Book of Shaders course) | Learn (42) | 42 | 5 | 0 |
| Learn 3D | Learn 3D (9) + 3D Basics (4 non-splat) | 13 | 5 | 0 |
| 3D: Shapes & Space | 3D SDF (12) + Curved space (3) | 14 | 5 | 0 |
| 3D: Light & Materials | 3D Lighting (5) + GI Lighting (2) + Volumetric (3) + 3D: Pictures (3) | 13 | 5 | 1 |
| 3D: Scene Builder | 3D: Scene Builder (6) | 6 | 5 | 0 |
| 2D: Scene Builder | 2D: Scene Builder (7) | 7 | 5 | 0 |
| 4D | 4D (15) | 15 | 5 | 0 |
| Particles | Particles (14) | 14 | 5 | 0 |
| Agents | Simulation (16, minus 3 ride-a-curve) | 13 | 5 | 0 |
| Agents with shaders | Agents with shaders (8) | 8 | 5 | 0 |
| Agents in 3D | Agents in 3D (9) | 9 | 5 | 0 |
| Agent rules & simulations | Agents: rules (13) + Simulations: agents (8) | 19 | 5 | 0 |
| Grid simulations | Simulations: grids (20) | 20 | 5 | 0 |
| Passes | Passes (11) | 11 | 5 | 0 |
| Effects & Lens | Effects & Lens (6) + Blur & Lens (5) + Halftone (2) | 13 | 5 | 1 |
| Texture tools | Texture tools (23) | 23 | 5 | 1 |
| Pictures | Pictures (10) | 10 | 5 | 0 |
| Grid | Grid (18) | 18 | 5 | 0 |
| Matrices | Matrices (8) | 8 | 5 | 0 |
| Node Combos | Node Combos (13) | 13 | 5 | 0 |
| Data | Data (8) | 8 | 5 | 0 |
| Audio | Audio (10) | 10 | 5 | 1 |
| Signals & Inputs | Memory (3) + Send & Receive (1) + Inputs (1) | 5 | 5 | 1 |
| Groups & Code | Iterated Groups (4) + Functions (4) + Convert (2) | 10 | 5 | 1 |
| 2D: Shapes, Space & Colour | Color & Lighting (3) + Space & Texture (5) + Rings (1) + Fractals (2) + 3 basics from Curves & Shapes | 14 | 5 | 0 |
| Curves & Shapes | Curves & Shapes (5 Curve Trace) + Physics (2) + 3 ride-a-curve + Curve Trace 3D | 11 | 5 | 0 |
| Splats | 3 splat examples from 3D Basics + 2 from Agents: rules + 1 from Play | 6 | 5 | 1 |
| Time Cube | Time Cube (13) | 13 | 5 | 0 |
| Frame Stack | Frame Stack (7) | 7 | 5 | 0 |
| From the Internet | From the Internet | 12 | 12 (kept as is, user) | 0 |
| **Total** | | **496** | **162** | **9** |

## Per category

### Play

*From:* Play (112). The numbered Play tutorial (01–112) is a course, not a showcase. Proposal: move the numbered steps into Learn as the “Play course” (still loadable, still linked from the Present lessons) and show 5 showpieces here. See decision D1.

**Keep**

| Key | Title | Feature | Look | Clarity | Nodes / notes | GPU ms | Why |
|---|---|---|---:|---:|---|---:|---|
| `bgQueue` | 76 · Background queue | Triggers: keys + a beat step a Background queue | 5 | 4 | 6 / Play notes | 0.43 | Best-looking Play example: three pictures crossfading on keys and a beat, with fireflies reading the picture. |
| `finishKaleidoscope` | 94 · Finish: presets into a mandala | Finish stack presets (Feedback, Mirror, Edges) | 5 | 4 | 6 / Play notes | 0.49 | Three presets fold plain noise into a moving neon mandala: shows what the Finish stack alone can do. |
| `displaceText` | 110 · Displace: text rippling through a map | Text layer + Displace map | 5 | 4 | 6 / Play notes | 1.02 | Big, legible, animated: a word rippling through a hidden wave layer. |
| `bgPhotoFlow` | 75 · Background: particles over a photo | Particles layer reading a picture | 5 | 4 | 5 / Play notes | 0.21 | A flow field of particles over a photo: the clearest, prettiest particles-on-Play example. |
| `p5FlowField` | 70 · p5: an imported flow field | Script layer: an imported p5 sketch | 4 | 4 | 5 / Play notes | 0.59 | A p5 project dropped in as-is; its sliders become controls. Looks good and shows Script/p5 in one go. |

**New to build**

- **Play: an instrument** — One strong shader (e.g. a 2D Scene Builder kaleidoscope) played four ways at once: mouse XY pad on two controls, an LFO on hue, a key trigger with an envelope on glow, a beat stepping a pattern. Replaces the 24 “glow dot” mapping steps as the showcase for mappings.
- **Play: Sampler beat** — The Sampler with its generated kit playing a short pattern by itself (no file needed, starts silent until Play test loop); readers on kick and hats drive the Finish stack (bloom pulse, shake). Audio examples today all look like a dot until you load a song.

**Retire from the list** (106)

| Key | Title | Look | Clarity | Feature | Dup | GPU ms | Reason |
|---|---|---:|---:|---:|---:|---:|---|
| `playControls` | 01 · Controls from the graph | 2 | 4 | 4 | 3 | 0.46 | Tutorial step on the shared glow-dot graph: teaches one mapping well, looks like every other step. Stays in the Play course. |
| `playMouse` | 02 · Mouse moves a slider | 2 | 4 | 4 | 3 | 0.48 | Tutorial step on the shared glow-dot graph: teaches one mapping well, looks like every other step. Stays in the Play course. |
| `playCurves` | 03 · Remap curves | 2 | 4 | 4 | 3 | 0.39 | Tutorial step on the shared glow-dot graph: teaches one mapping well, looks like every other step. Stays in the Play course. |
| `playLfo` | 04 · LFOs and the clock | 2 | 4 | 4 | 3 | 0.34 | Tutorial step on the shared glow-dot graph: teaches one mapping well, looks like every other step. Stays in the Play course. |
| `playNoise` | 05 · Noise: smooth, drift, random, stepped | 2 | 4 | 4 | 3 | 0.34 | Tutorial step on the shared glow-dot graph: teaches one mapping well, looks like every other step. Stays in the Play course. |
| `playCrossMod` | 06 · Controls that drive controls | 2 | 4 | 4 | 3 | 0.36 | Tutorial step on the shared glow-dot graph: teaches one mapping well, looks like every other step. Stays in the Play course. |
| `playExprKnob` | 07 · Expression knobs | 2 | 4 | 4 | 3 | 0.38 | Tutorial step on the shared glow-dot graph: teaches one mapping well, looks like every other step. Stays in the Play course. |
| `playColour` | 08 · Colour channels | 2 | 4 | 4 | 3 | 0.4 | Tutorial step on the shared glow-dot graph: teaches one mapping well, looks like every other step. Stays in the Play course. |
| `playKeys` | 09 · Keys: hold and hit | 2 | 4 | 4 | 3 | 0.38 | Tutorial step on the shared glow-dot graph: teaches one mapping well, looks like every other step. Stays in the Play course. |
| `playTriggerModes` | 10 · Triggers: toggle, step, random | 2 | 4 | 4 | 3 | 0.39 | Tutorial step on the shared glow-dot graph: teaches one mapping well, looks like every other step. Stays in the Play course. |
| `playBeat` | 11 · Beats | 2 | 4 | 4 | 3 | 0.4 | Tutorial step on the shared glow-dot graph: teaches one mapping well, looks like every other step. Stays in the Play course. |
| `playLiveAudio` | 12 · Live audio (mic or DAW) | 2 | 4 | 4 | 3 | 0.49 | Tutorial step on the shared glow-dot graph: teaches one mapping well, looks like every other step. Stays in the Play course. |
| `playAudioReaders` | 13 · Audio readers | 2 | 4 | 4 | 3 | 0.38 | Tutorial step on the shared glow-dot graph: teaches one mapping well, looks like every other step. Stays in the Play course. |
| `playMidi` | 14 · MIDI controller | 2 | 4 | 4 | 3 | 0.43 | Tutorial step on the shared glow-dot graph: teaches one mapping well, looks like every other step. Stays in the Play course. |
| `playPadGrid` | 15 · Pad grid (Push, Launchpad) | 3 | 4 | 4 | 3 | 0.41 | Tutorial step on the shared glow-dot graph: teaches one mapping well, looks like every other step. Stays in the Play course. |
| `playOsc` | 16 · OSC (Ableton, TouchOSC) | 2 | 4 | 4 | 3 | 0.49 | Tutorial step on the shared glow-dot graph: teaches one mapping well, looks like every other step. Stays in the Play course. |
| `playTilt` | 17 · Phone tilt | 2 | 4 | 4 | 3 | 0.49 | Tutorial step on the shared glow-dot graph: teaches one mapping well, looks like every other step. Stays in the Play course. |
| `playNull` | 18 · Nulls: a point you drag | 2 | 4 | 4 | 3 | 0.35 | Tutorial step on the shared glow-dot graph: teaches one mapping well, looks like every other step. Stays in the Play course. |
| `playSpringNull` | 19 · Following nulls (springs) | 2 | 4 | 4 | 3 | 0.52 | Tutorial step on the shared glow-dot graph: teaches one mapping well, looks like every other step. Stays in the Play course. |
| `playNullDistance` | 20 · Distance between nulls | 2 | 4 | 4 | 3 | 0.47 | Tutorial step on the shared glow-dot graph: teaches one mapping well, looks like every other step. Stays in the Play course. |
| `playProximity` | 21 · Proximity: fire when close | 2 | 4 | 4 | 3 | 0.47 | Tutorial step on the shared glow-dot graph: teaches one mapping well, looks like every other step. Stays in the Play course. |
| `playConditions` | 22 · Conditions and signals | 2 | 4 | 4 | 3 | 0.45 | Tutorial step on the shared glow-dot graph: teaches one mapping well, looks like every other step. Stays in the Play course. |
| `playPairs` | 23 · Pairs, XY pads and axis swap | 2 | 4 | 4 | 3 | 0.46 | Tutorial step on the shared glow-dot graph: teaches one mapping well, looks like every other step. Stays in the Play course. |
| `playIncrement` | 24 · Increments: move in steps | 2 | 4 | 4 | 3 | 0.5 | Tutorial step on the shared glow-dot graph: teaches one mapping well, looks like every other step. Stays in the Play course. |
| `playTextMattes` | 25 · Text: over, reveal, luma | 3 | 4 | 4 | 3 | 0.67 | Tutorial step (layers, particles, relationships). Stays in the Play course. |
| `playLayersOnly` | 26 · Picture: layers only | 3 | 4 | 4 | 3 | 0.64 | Tutorial step (layers, particles, relationships). Stays in the Play course. |
| `playTextSequence` | 27 · Text sequences | 3 | 4 | 4 | 3 | 0.77 | Tutorial step (layers, particles, relationships). Stays in the Play course. |
| `playImage` | 28 · Images | 3 | 4 | 4 | 3 | 0.68 | Tutorial step (layers, particles, relationships). Stays in the Play course. |
| `playCamera` | 29 · Camera | 2 | 4 | 4 | 3 | 0.55 | Tutorial step (layers, particles, relationships). Stays in the Play course. |
| `playVideoSound` | 30 · Video with sound | 2 | 4 | 4 | 3 | 0.46 | Tutorial step (layers, particles, relationships). Stays in the Play course. |
| `playBrush` | 31 · Brush | 2 | 4 | 4 | 3 | 0.45 | Tutorial step (layers, particles, relationships). Stays in the Play course. |
| `playAudioLayer` | 32 · Audio visualiser | 1 | 4 | 4 | 3 | 0.57 | Tutorial step (layers, particles, relationships). Stays in the Play course. |
| `playGlyphs` | 33 · Glyphs: ASCII and halftone | 2 | 4 | 4 | 3 | 0.72 | Tutorial step (layers, particles, relationships). Stays in the Play course. |
| `playContours` | 34 · Contours | 2 | 4 | 4 | 3 | 0.66 | Tutorial step (layers, particles, relationships). Stays in the Play course. |
| `playLens` | 35 · Lens | 3 | 4 | 4 | 3 | 0.82 | Tutorial step (layers, particles, relationships). Stays in the Play course. |
| `playFlow` | 36 · Particles: flow field | 3 | 4 | 4 | 3 | 0.34 | Tutorial step (layers, particles, relationships). Stays in the Play course. |
| `playClimb` | 37 · Particles: climb and descend | 3 | 4 | 4 | 3 | 0.45 | Tutorial step (layers, particles, relationships). Stays in the Play course. |
| `playNoiseField` | 38 · Particles: noise field | 3 | 4 | 4 | 3 | 0.35 | Tutorial step (layers, particles, relationships). Stays in the Play course. |
| `playAttractor` | 39 · Attractors | 2 | 4 | 4 | 3 | 0.33 | Tutorial step (layers, particles, relationships). Stays in the Play course. |
| `playEmitAbsorb` | 40 · Emitters and absorbers | 3 | 4 | 4 | 3 | 0.38 | Tutorial step (layers, particles, relationships). Stays in the Play course. |
| `playFlock` | 41 · Flocking | 2 | 4 | 4 | 3 | 0.38 | Tutorial step (layers, particles, relationships). Stays in the Play course. |
| `playBursts` | 42 · Bursts on the beat | 1 | 4 | 4 | 3 | 0.46 | Tutorial step (layers, particles, relationships). Stays in the Play course. |
| `playPlexus` | 43 · Collisions and links | 3 | 4 | 4 | 3 | 0.36 | Tutorial step (layers, particles, relationships). Stays in the Play course. |
| `playLooks` | 44 · Particle looks | 2 | 4 | 4 | 3 | 0.34 | Tutorial step (layers, particles, relationships). Stays in the Play course. |
| `playParticleMask` | 45 · Particles as a mask | 4 | 4 | 4 | 3 | 0.68 | Tutorial step (layers, particles, relationships). Stays in the Play course. |
| `playMultiply` | 46 · Multiply | 2 | 4 | 4 | 3 | 1.14 | Tutorial step (layers, particles, relationships). Stays in the Play course. |
| `playWalls` | 47 · Walls and containers | 3 | 4 | 4 | 3 | 0.63 | Tutorial step (layers, particles, relationships). Stays in the Play course. |
| `playPortals` | 48 · Portals | 3 | 4 | 4 | 3 | 0.75 | Tutorial step (layers, particles, relationships). Stays in the Play course. |
| `playForces` | 49 · Wind, vortex and drag | 3 | 4 | 4 | 3 | 1.0 | Tutorial step (layers, particles, relationships). Stays in the Play course. |
| `playTintZones` | 50 · Tint and resize zones | 3 | 4 | 4 | 3 | 0.64 | Tutorial step (layers, particles, relationships). Stays in the Play course. |
| `playSensors` | 51 · Sensors: how full is the box | 3 | 4 | 4 | 3 | 0.37 | Tutorial step (layers, particles, relationships). Stays in the Play course. |
| `playChase` | 52 · Relationship: a chase | 2 | 4 | 4 | 3 | 0.3 | Tutorial step (layers, particles, relationships). Stays in the Play course. |
| `playOrbit` | 53 · Relationship: orbits and the picture | 2 | 4 | 4 | 3 | 0.32 | Tutorial step (layers, particles, relationships). Stays in the Play course. |
| `playBoids` | 54 · Agents: boids | 3 | 4 | 4 | 3 | 0.49 | Tutorial step (layers, particles, relationships). Stays in the Play course. |
| `playPredatorPrey` | 55 · Agents: predators and prey | 3 | 4 | 4 | 3 | 0.33 | Tutorial step (layers, particles, relationships). Stays in the Play course. |
| `playShapeTriggers` | 56 · Shape triggers | 2 | 4 | 4 | 3 | 0.44 | Tutorial step (layers, particles, relationships). Stays in the Play course. |
| `playDrawnShapes` | 57 · Drawn shapes and trim | 3 | 4 | 4 | 3 | 0.68 | Tutorial step (layers, particles, relationships). Stays in the Play course. |
| `playPictureShape` | 58 · The picture as a shape | 3 | 4 | 4 | 3 | 0.65 | Tutorial step (layers, particles, relationships). Stays in the Play course. |
| `playGlowText` | 59 · Glowing text and strokes | 4 | 4 | 4 | 3 | 0.37 | Tutorial step (layers, particles, relationships). Stays in the Play course. |
| `scriptFirst` | 60 · Script: a first sketch | 3 | 4 | 4 | 3 | 0.33 | Script-layer tutorial step; p5FlowField is the showpiece. Stays in the Play course. |
| `script3D` | 61 · Script: 3D on a 2D canvas | 3 | 4 | 4 | 3 | 0.37 | Script-layer tutorial step; p5FlowField is the showpiece. Stays in the Play course. |
| `script3DShapes` | 62 · 3D Script: shapes over the shader | 3 | 4 | 4 | 3 | 0.45 | Script-layer tutorial step; p5FlowField is the showpiece. Stays in the Play course. |
| `script3DTexture` | 63 · 3D Script: the shader on a cube | 3 | 4 | 4 | 3 | 0.7 | Script-layer tutorial step; p5FlowField is the showpiece. Stays in the Play course. |
| `scriptMouse` | 64 · Script: the mouse | 2 | 4 | 4 | 3 | 0.33 | Script-layer tutorial step; p5FlowField is the showpiece. Stays in the Play course. |
| `scriptPicture` | 65 · Script: reading the picture | 3 | 4 | 4 | 3 | 0.63 | Script-layer tutorial step; p5FlowField is the showpiece. Stays in the Play course. |
| `scriptNulls` | 66 · Script: nulls as handles | 3 | 4 | 4 | 3 | 0.3 | Script-layer tutorial step; p5FlowField is the showpiece. Stays in the Play course. |
| `scriptButtons` | 67 · Script: buttons on keys and beats | 2 | 4 | 4 | 3 | 0.34 | Script-layer tutorial step; p5FlowField is the showpiece. Stays in the Play course. |
| `scriptParticles` | 68 · Script: particles in plain JS | 3 | 4 | 4 | 3 | 0.33 | Script-layer tutorial step; p5FlowField is the showpiece. Stays in the Play course. |
| `scriptP5` | 69 · Script: a p5 sketch, pasted in | 4 | 4 | 4 | 3 | 0.64 | Script-layer tutorial step; p5FlowField is the showpiece. Stays in the Play course. |
| `p5MultiFile` | 71 · p5: a sketch in three files | 2 | 4 | 4 | 3 | 0.53 | Script-layer tutorial step; p5FlowField is the showpiece. Stays in the Play course. |
| `p5Webgl` | 72 · p5: a WEBGL sketch in 3D | 3 | 4 | 4 | 3 | 0.47 | Script-layer tutorial step; p5FlowField is the showpiece. Stays in the Play course. |
| `scriptGlow` | 73 · Script: the shader glows around it | 4 | 4 | 4 | 3 | 0.35 | Script-layer tutorial step; p5FlowField is the showpiece. Stays in the Play course. |
| `bgColourSketch` | 74 · Background: a colour, no shader | 4 | 4 | 4 | 3 | 0.34 | Script-layer tutorial step; p5FlowField is the showpiece. Stays in the Play course. |
| `matteParticles` | 77 · Matte: a photo through particles | 4 | 4 | 4 | 3 | 0.26 | Tutorial step (mattes, motion, hands, takes). Stays in the Play course. |
| `maskReveal` | 78 · Masks: text through a moving window | 3 | 4 | 4 | 3 | 0.56 | Tutorial step (mattes, motion, hands, takes). Stays in the Play course. |
| `motionReveal` | 79 · Motion: reveal and trigger where it moves | 2 | 4 | 4 | 3 | 0.28 | Tutorial step (mattes, motion, hands, takes). Stays in the Play course. |
| `handFingertips` | 80 · Hands: fingertips move particles | 2 | 4 | 4 | 3 | 0.33 | Tutorial step (mattes, motion, hands, takes). Stays in the Play course. |
| `handPinch` | 81 · Hands: pinch, point and fist | 2 | 4 | 4 | 3 | 0.32 | Tutorial step (mattes, motion, hands, takes). Stays in the Play course. |
| `handTwoHands` | 82 · Hands: two at once | 3 | 4 | 4 | 3 | 0.3 | Tutorial step (mattes, motion, hands, takes). Stays in the Play course. |
| `handProximity` | 83 · Hands: touch a shape | 2 | 4 | 4 | 3 | 0.31 | Tutorial step (mattes, motion, hands, takes). Stays in the Play course. |
| `handPaths` | 84 · Hand paths | 3 | 4 | 4 | 3 | 0.62 | Tutorial step (mattes, motion, hands, takes). Stays in the Play course. |
| `playTake` | 85 · A recorded take | 2 | 4 | 4 | 3 | 0.29 | Tutorial step (mattes, motion, hands, takes). Stays in the Play course. |
| `finishGrade` | 86 · Finish: grade and lens | 3 | 4 | 4 | 3 | 0.56 | Finish-stack step; finishKaleidoscope is the showpiece. Stays in the Play course. |
| `finishLooks` | 87 · Finish: looks and split toning | 3 | 4 | 4 | 3 | 0.61 | Finish-stack step; finishKaleidoscope is the showpiece. Stays in the Play course. |
| `finishScreen` | 88 · Finish: CRT, bloom, grain and shake | 3 | 4 | 4 | 3 | 0.31 | Finish-stack step; finishKaleidoscope is the showpiece. Stays in the Play course. |
| `finishHalation` | 89 · Finish: halation | 2 | 4 | 4 | 3 | 0.3 | Finish-stack step; finishKaleidoscope is the showpiece. Stays in the Play course. |
| `finishTime` | 90 · Finish: time displacement | 3 | 4 | 4 | 3 | 0.7 | Finish-stack step; finishKaleidoscope is the showpiece. Stays in the Play course. |
| `finishPixelSort` | 91 · Finish: pixel sort and light leaks | 4 | 4 | 4 | 3 | 0.44 | Finish-stack step; finishKaleidoscope is the showpiece. Stays in the Play course. |
| `finishPrint` | 92 · Finish: comic print | 4 | 4 | 4 | 3 | 0.69 | Finish-stack step; finishKaleidoscope is the showpiece. Stays in the Play course. |
| `finishTerminal` | 93 · Finish: ASCII terminal | 4 | 4 | 4 | 3 | 0.33 | Finish-stack step; finishKaleidoscope is the showpiece. Stays in the Play course. |
| `finishDatamoshEcho` | 95 · Finish: datamosh and layer echo | 3 | 4 | 4 | 3 | 0.52 | Finish-stack step; finishKaleidoscope is the showpiece. Stays in the Play course. |
| `finishMotionExtract` | 96 · Finish: motion extract | 2 | 4 | 4 | 3 | 0.31 | Finish-stack step; finishKaleidoscope is the showpiece. Stays in the Play course. |
| `drumPads` | 97 · Drum pads | 2 | 4 | 4 | 3 | 0.32 | Audio-engine step: shows as a glow dot until you play; see NEW “Play: Sampler beat”. Stays in the Play course. |
| `granulator` | 98 · Granulator | 2 | 4 | 4 | 3 | 0.31 | Audio-engine step: shows as a glow dot until you play; see NEW “Play: Sampler beat”. Stays in the Play course. |
| `audioEffects` | 99 · Audio effects | 2 | 4 | 4 | 3 | 0.36 | Audio-engine step: shows as a glow dot until you play; see NEW “Play: Sampler beat”. Stays in the Play course. |
| `pianoRollScale` | 100 · Piano roll: a clip in a scale | 3 | 4 | 4 | 3 | 0.34 | Audio-engine step: shows as a glow dot until you play; see NEW “Play: Sampler beat”. Stays in the Play course. |
| `granulatorSpectral` | 101 · Granulator: Spectral, emitted grains | 2 | 4 | 4 | 3 | 0.48 | Audio-engine step: shows as a glow dot until you play; see NEW “Play: Sampler beat”. Stays in the Play course. |
| `particlesEngineTrack` | 102 · Particles: hear an engine track | 1 | 4 | 4 | 3 | 4.01 | Audio-engine step: shows as a glow dot until you play; see NEW “Play: Sampler beat”. Stays in the Play course. |
| `particleGlow` | 103 · Particle Glow | 3 | 4 | 4 | 3 | 0.33 | Good, but a sixth Play feature; stays in the Play course. |
| `flowAroundWords` | 104 · Flow Around Words | 3 | 4 | 4 | 3 | 0.46 | Good, but a sixth Play feature; stays in the Play course. |
| `letterDrop` | 105 · Letter Drop | 3 | 4 | 4 | 3 | 0.38 | Good, but a sixth Play feature; stays in the Play course. |
| `lookBuilt` | 106 · Look: effects from nodes and code | 3 | 4 | 4 | 3 | 0.42 | Finish-stack step; finishKaleidoscope is the showpiece. Stays in the Play course. |
| `finishWater` | 107 · Water: a wake, rain and splashes | 5 | 4 | 4 | 3 | 0.69 | Runner-up (look 5): beautiful water, but a sixth feature; stays in the Play course. Swap in for bgPhotoFlow if you prefer. |
| `agentsHandBeat` | 108 · Agents: a hand and a beat | 4 | 5 | 4 | 3 | 5.6 | Good, but a sixth Play feature; stays in the Play course. |
| `waterLayer` | 109 · Water layer: a boat and its wake | 5 | 4 | 4 | 3 | 5.34 | Same picture as finishWater (pool, boat, wake). Stays in the Play course. |
| `displaceParticles` | 111 · Displace: particles by the shader, the picture by a word | 3 | 4 | 4 | 3 | 0.52 | Good, but a sixth Play feature; stays in the Play course. |

### Learn (Book of Shaders course)

*From:* Learn (42). A 42-step course. Proposal: keep the course whole under Learn (numbered, loadable, as now via the Book of Shaders lesson), and list only 5 showpieces in Examples. See D1.

**Keep**

| Key | Title | Feature | Look | Clarity | Nodes / notes | GPU ms | Why |
|---|---|---|---:|---:|---|---:|---|
| `learnTruchet` | 27 · Truchet tiles | Tiling with per-cell rotation (Truchet) | 5 | 4 | 14 / 6 | 1.15 | Crisp two-colour zigzags from one triangle; a great “aha”. |
| `learnWood` | 33 · Noise at work: wood grain | Noise bending a pattern (wood grain) | 5 | 4 | 11 / 4 | 0.55 | Warm, organic, unmistakable: noise at work. |
| `learnVoronoi` | 35 · Cellular noise | Cellular (Worley) noise | 4 | 4 | 6 / 1 | 1.49 | Clean and pretty cell pattern. |
| `learnFBM` | 37 · Fractal noise (FBM) in 2D | Fractal noise (FBM) + Palette | 4 | 4 | 5 / Play notes | 0.3 | Featured on the Start sheet; clouds and terrain in 5 nodes. Needs node notes. |
| `learnFractal` | 40 · Fractals: the Mandelbrot set | Iteration: the Mandelbrot set | 5 | 4 | 6 / 3 | 0.82 | The classic; good closing image for the course. |

**Retire from the list** (37)

| Key | Title | Look | Clarity | Feature | Dup | GPU ms | Reason |
|---|---|---:|---:|---:|---:|---:|---|
| `learnColour` | 01 · Hello colour | 1 | 4 | 4 | 3 | 4.96 | Course step: stays in the Learn course, off the Examples list. |
| `learnTime` | 02 · Uniforms: time | 1 | 4 | 4 | 3 | 0.65 | Course step: stays in the Learn course, off the Examples list. |
| `learnUV` | 03 · Where am I? st | 2 | 4 | 4 | 3 | 0.96 | Course step: stays in the Learn course, off the Examples list. |
| `learnPlot` | 04 · Plot a function | 2 | 4 | 4 | 3 | 0.84 | Course step: stays in the Learn course, off the Examples list. |
| `learnPow` | 05 · Pow and friends | 2 | 4 | 4 | 3 | 0.78 | Course step: stays in the Learn course, off the Examples list. |
| `learnStep` | 06 · Step and smoothstep | 2 | 4 | 4 | 3 | 0.73 | Course step: stays in the Learn course, off the Examples list. |
| `learnSinCos` | 07 · Sin and cos | 2 | 4 | 4 | 3 | 0.49 | Course step: stays in the Learn course, off the Examples list. |
| `learnFractFloor` | 08 · Fract and floor | 2 | 4 | 4 | 3 | 0.54 | Course step: stays in the Learn course, off the Examples list. |
| `learnShapers` | 09 · Shaping functions by hand | 2 | 4 | 4 | 3 | 0.45 | Course step: stays in the Learn course, off the Examples list. |
| `learnGradient` | 10 · Mix and gradients | 3 | 4 | 4 | 3 | 0.48 | Course step: stays in the Learn course, off the Examples list. |
| `learnHSB` | 11 · HSB colour | 3 | 4 | 4 | 3 | 0.48 | Course step: stays in the Learn course, off the Examples list. |
| `learnColorWheel` | 12 · Polar colour wheel | 4 | 4 | 4 | 3 | 1.14 | Course step: stays in the Learn course, off the Examples list. |
| `learnRect` | 13 · Rectangle from step | 2 | 4 | 4 | 3 | 1.22 | Course step: stays in the Learn course, off the Examples list. |
| `learnCircle` | 14 · Circle from distance | 3 | 4 | 4 | 3 | 1.25 | Course step: stays in the Learn course, off the Examples list. |
| `learnDistanceField` | 15 · Distance fields | 4 | 4 | 4 | 3 | 1.27 | Course step: stays in the Learn course, off the Examples list. |
| `learnPolar` | 16 · Polar shapes | 3 | 4 | 4 | 3 | 1.27 | Course step: stays in the Learn course, off the Examples list. |
| `learnPolygon` | 17 · Polygons: polar + distance | 4 | 3 | 4 | 3 | 1.27 | Course step: stays in the Learn course, off the Examples list. |
| `learnCombine` | 18 · Combining shapes | 2 | 3 | 4 | 3 | 1.01 | Course step: stays in the Learn course, off the Examples list. |
| `learnTranslate` | 19 · Translate: move the space | 2 | 4 | 4 | 3 | 1.15 | Course step: stays in the Learn course, off the Examples list. |
| `learnRotate` | 20 · Rotate with a matrix | 2 | 4 | 4 | 3 | 1.04 | Course step: stays in the Learn course, off the Examples list. |
| `learnScale` | 21 · Scale with a matrix | 2 | 4 | 4 | 3 | 0.75 | Course step: stays in the Learn course, off the Examples list. |
| `learnTransform` | 22 · Move, turn, scale in one node | 2 | 4 | 4 | 3 | 0.94 | Course step: stays in the Learn course, off the Examples list. |
| `learnYUV` | 23 · YUV: a matrix on colour | 3 | 4 | 4 | 3 | 0.9 | Course step: stays in the Learn course, off the Examples list. |
| `learnTiling` | 24 · Tiling | 3 | 4 | 4 | 3 | 0.89 | Course step: stays in the Learn course, off the Examples list. |
| `learnTileRotate` | 25 · Transforms inside the tiles | 4 | 3 | 4 | 3 | 0.97 | Course step: stays in the Learn course, off the Examples list. |
| `learnBricks` | 26 · Offset patterns: bricks | 4 | 4 | 4 | 3 | 0.93 | Course step: stays in the Learn course, off the Examples list. |
| `learnRandom` | 28 · Random from a sine | 2 | 4 | 4 | 3 | 1.37 | Course step: stays in the Learn course, off the Examples list. |
| `learnRandomGrid` | 29 · Random cells | 3 | 4 | 4 | 3 | 1.19 | Course step: stays in the Learn course, off the Examples list. |
| `learnMaze` | 30 · A random maze (10 PRINT) | 4 | 3 | 4 | 3 | 0.97 | Course step: stays in the Learn course, off the Examples list. |
| `learnNoise1D` | 31 · Smooth random: 1D noise | 2 | 4 | 4 | 3 | 1.22 | Course step: stays in the Learn course, off the Examples list. |
| `learnNoise` | 32 · 2D noise | 2 | 4 | 4 | 3 | 1.08 | Course step: stays in the Learn course, off the Examples list. |
| `learnCellDistance` | 34 · Distance to the nearest point | 4 | 3 | 4 | 3 | 0.7 | Course step: stays in the Learn course, off the Examples list. |
| `learnOctaves` | 36 · Octaves: fractal noise | 2 | 4 | 4 | 3 | 0.67 | Course step: stays in the Learn course, off the Examples list. |
| `learnTurbulence` | 38 · Turbulence and ridges | 4 | 3 | 4 | 3 | 0.38 | Course step: stays in the Learn course, off the Examples list. |
| `learnWarp` | 39 · Domain warp | 3 | 4 | 4 | 3 | 0.63 | Course step: stays in the Learn course, off the Examples list. |
| `learnLoop` | 41 · A fractal by hand: Loop Carry | 2 | 3 | 4 | 3 | 0.86 | Course step: stays in the Learn course, off the Examples list. |
| `learnRaymarch` | 42 · Extra: first ray march | 2 | 3 | 4 | 3 | 1.48 | Course step: stays in the Learn course, off the Examples list. |

### Learn 3D

*From:* Learn 3D (9) + 3D Basics (4 non-splat). Ray marching one idea at a time. 3D Basics duplicates it with plainer grey scenes, so it folds in here.

**Keep**

| Key | Title | Feature | Look | Clarity | Nodes / notes | GPU ms | Why |
|---|---|---|---:|---:|---|---:|---|
| `learn3dMarch` | 3D 3 · The march: counting steps | The march: step count as colour | 4 | 3 | 10 / 2 | 1.37 | Shows the march itself; the glowing ring reads instantly. |
| `learn3dLight` | 3D 4 · Hit, normal and light | Hit, normal and light | 3 | 3 | 12 / 3 | 1.41 | Featured on the Start sheet; the first lit sphere. |
| `learn3dCombine` | 3D 5 · Combining shapes | Combining shapes (smooth Union) | 3 | 3 | 14 / 4 | 0.39 | Sphere and box melting together. |
| `learn3dVolume` | 3D 7 · Glow: through the shape | Volumetric glow vs surface | 4 | 4 | 20 / 6 | 0.35 | Split view makes the difference obvious. |
| `learn3dGI` | 3D 8 · GI lighting vs the plain loop | GI Lit March Loop vs plain loop | 4 | 3 | 19 / 4 | 0.85 | Split view: shadows, sky and bounce light. |

**Retire from the list** (8)

| Key | Title | Look | Clarity | Feature | Dup | GPU ms | Reason |
|---|---|---:|---:|---:|---:|---:|---|
| `learn3dCamera` | 3D 1 · The camera: one ray per pixel | 2 | 4 | 4 | 3 | 1.11 | Course step: stays in the Learn 3D course. |
| `learn3dDistance` | 3D 2 · A sphere is a distance | 4 | 5 | 4 | 3 | 1.09 | Course step: stays in the Learn 3D course. |
| `learn3dOrbit` | 3D 6 · Moving the camera | 2 | 3 | 4 | 3 | 0.41 | Course step: stays in the Learn 3D course. |
| `learn3dVolumeSwitch` | 3D 9 · Glow from the Volumetric switch | 4 | 4 | 4 | 3 | 1.17 | Course step: stays in the Learn 3D course. |
| `raymarchSpheres` | Raymarch Spheres | 2 | 2 | 2 | 2 | 0.39 | Plain grey test scene; Learn 3D covers the same steps with notes. |
| `shapesAndGround3D` | 3D: Shapes + Ground | 2 | 2 | 2 | 2 | 0.78 | Plain grey test scene; Learn 3D covers the same steps with notes. |
| `softMetaballs3D` | 3D: Soft Metaballs | 2 | 2 | 2 | 2 | 0.58 | Plain grey test scene; Learn 3D covers the same steps with notes. |
| `normalColorDemo` | 3D: Normal to Color | 2 | 3 | 2 | 2 | 0.33 | Plain grey test scene; Learn 3D covers the same steps with notes. |

### 3D: Shapes & Space

*From:* 3D SDF (12) + Curved space (3). Modelling with distance fields and bending space.

**Keep**

| Key | Title | Feature | Look | Clarity | Nodes / notes | GPU ms | Why |
|---|---|---|---:|---:|---|---:|---|
| `repeatSceneBubbles` | Repeat Scene: overlapping bubbles | Repeat Scene (overlapping copies) | 5 | 5 | 21 / 20 | 6.45 | Colourful field of bubbles to the horizon; Play controls; fully commented. |
| `voxelTerrain` | 3D: Voxel Terrain | Voxelize + per-cell Expression Block | 4 | 3 | 20 / 0 | 2.18 | Minecraft-like terrain; striking and teaches Voxelize. Needs node notes (0 today). |
| `mlgWiggleTunnel` | MLG: Wiggle Tunnel | Bending rays inside the March Loop | 5 | 5 | 18 / 18 | 1.68 | Hypnotic tunnel; fully commented. |
| `curvedSpherical` | Curved space: spherical world | Curved space (spherical) | 4 | 5 | 15 / 14 | 0.95 | Spheres that grow again in the distance: a genuinely new view; fully commented. |
| `bakeHeavyScene` | Bake: a heavy 3D scene, effects on top | Bake a heavy scene, effects on top | 4 | 4 | 17 / 6 | 6.19 | The gyroid look plus the Bake workflow (gyroidWarped is the same picture without the lesson). |

**Retire from the list** (9)

| Key | Title | Look | Clarity | Feature | Dup | GPU ms | Reason |
|---|---|---:|---:|---:|---:|---:|---|
| `curvedHyperbolic` | Curved space: hyperbolic tunnel | 4 | 5 | 2 | 2 | 0.46 | Same idea as curvedSpherical (curved space); keep one. |
| `curvedReverse` | Curved space: reverse perspective room | 4 | 5 | 2 | 2 | 0.45 | Same idea as curvedSpherical (curved space); keep one. |
| `repeatSceneCentrepiece` | Repeat Scene: around a centrepiece | 4 | 5 | 2 | 2 | 6.27 | Near-duplicate of repeatSceneBubbles. |
| `sdfPolarRepeat` | 3D: Polar Repeat — Radial Symmetry | 2 | 2 | 3 | 4 | 0.48 | Small untextured object on black, no notes; the deform/repeat ideas are covered by the Scene Builder examples. |
| `sdfBend3D` | 3D: Bend Deform | 2 | 2 | 3 | 4 | 0.36 | Small untextured object on black, no notes; the deform/repeat ideas are covered by the Scene Builder examples. |
| `sdCrossScene3D` | 3D: SD Cross | 2 | 2 | 3 | 4 | 0.35 | Small untextured object on black, no notes; the deform/repeat ideas are covered by the Scene Builder examples. |
| `infinitePillars3D` | 3D: Infinite Pillars | 3 | 2 | 3 | 4 | 0.77 | Small untextured object on black, no notes; the deform/repeat ideas are covered by the Scene Builder examples. |
| `spiralWorld3D` | 3D: Spiral World | 2 | 2 | 3 | 4 | 1.95 | Garish normals-as-colour, little to read. |
| `gyroidWarped` | 3D: Gyroid + Domain Warp | 4 | 2 | 2 | 2 | 6.75 | Same gyroid picture as bakeHeavyScene (kept, which also teaches Bake). |

### 3D: Light & Materials

*From:* 3D Lighting (5) + GI Lighting (2) + Volumetric (3) + 3D: Pictures (3). Small folders merged: lighting, glass, GI, volumetrics, pictures in 3D.

**Keep**

| Key | Title | Feature | Look | Clarity | Nodes / notes | GPU ms | Why |
|---|---|---|---:|---:|---|---:|---|
| `litStillLife` | Lit Still Life | The full lighting stack (AO, soft shadow, Multi Light, Tone Map) | 4 | 3 | 21 / 0 | 1.61 | Clean still life with real shadows. Needs node notes (0 today). |
| `giSphereGround` | GI: Sphere & Ground | GI Lit March Loop | 4 | 2 | 11 / 0 | 0.65 | Soft studio look with a blue sky shadow. Needs node notes. |
| `glassMetaballs` | Glass Metaballs | Glass (refraction + dispersion) | 4 | 2 | 17 / 0 | 0.71 | Best glass picture. Needs node notes. |
| `pic3dVideoRoom` | Picture card: a video in a lit room | Picture Card: a video in a lit room | 4 | 5 | 29 / 28 | 1.14 | A video on a card casting shadows; fully commented. |
| `volAnimatedRepeat` | Volumetric: Animated Repeat | Volumetric march, repeated | 4 | 2 | 29 / 5 | 0.82 | The only volumetric example that looks finished. |

**New to build**

- **3D: Materials row** — Five spheres on a floor under one light (matte, plastic, metal, rough metal, glass) with Fresnel rims, one Scene Group, notes on each material’s numbers. Covers Fresnel and refraction, whose current examples (fresnelSchlickRim, refractDirFakeGlass) look like flat test renders.

**Retire from the list** (8)

| Key | Title | Look | Clarity | Feature | Dup | GPU ms | Reason |
|---|---|---:|---:|---:|---:|---:|---|
| `fresnelSchlickRim` | Fresnel Schlick: Rim Glow | 2 | 3 | 3 | 4 | 0.3 | Reads as a flat test render; see NEW “3D: Materials row”. |
| `refractDirFakeGlass` | Refract Dir: Fake Glass | 2 | 2 | 3 | 4 | 0.3 | Reads as a flat test render; see NEW “3D: Materials row”. |
| `glassPhysical` | Glass 3D: Physical | 3 | 2 | 2 | 2 | 0.48 | Same scene as glassMetaballs. |
| `pic3dCutouts` | Picture card: lit print and glowing cutout | 3 | 5 | 2 | 2 | 1.63 | Second and third Picture-in-3D example; pic3dVideoRoom is the showpiece. |
| `pic3dTexturedShapes` | Texture Material: a photo on a sphere, a box and a cylinder | 3 | 5 | 2 | 2 | 1.88 | Second and third Picture-in-3D example; pic3dVideoRoom is the showpiece. |
| `giBoxFrame` | GI: Box Frame | 3 | 2 | 2 | 2 | 0.92 | Second GI demo; giSphereGround is clearer. |
| `glowMarcher` | 3D: Glow Marcher | 2 | 2 | 3 | 4 | 0.3 | A single blurred ball; volAnimatedRepeat and learn3dVolume cover it. |
| `volumeGlowDemo` | Volumetric: Volume Glow | 3 | 3 | 3 | 4 | 0.32 | A single blurred ball; volAnimatedRepeat and learn3dVolume cover it. |

### 3D: Scene Builder

*From:* 3D: Scene Builder (6). Graphs the 3D Scene Builder makes: keep 5 of its 6 templates.

**Keep**

| Key | Title | Feature | Look | Clarity | Nodes / notes | GPU ms | Why |
|---|---|---|---:|---:|---|---:|---|
| `sbGlowingOrb` | 3D: Scene Builder · Glowing orb | Builder recipe: volumetric | 4 | 5 | 20 / 19 | 0.45 | Glowing ball with rings. |
| `sbInfinitePillars` | 3D: Scene Builder · Infinite pillars | Builder recipe: repeat + fog | 4 | 4 | 43 / 42 | 1.59 | Endless colonnade; reads well. |
| `sbTwistedTorus` | 3D: Scene Builder · Twisted torus | Builder recipe: Twist deform | 4 | 4 | 33 / 32 | 0.92 | Simple, clear deform. |
| `sbGlassObjects` | 3D: Scene Builder · Glass objects | Builder recipe: glass mode | 3 | 5 | 22 / 21 | 0.71 | Glass shapes over a floor. |
| `sbMengerFold` | 3D: Scene Builder · Menger-like fold | Builder recipe: fold/repeat (Menger) | 4 | 4 | 40 / 39 | 0.6 | Fractal cube; distinct. |

**Retire from the list** (1)

| Key | Title | Look | Clarity | Feature | Dup | GPU ms | Reason |
|---|---|---:|---:|---:|---:|---:|---|
| `sbBlobSculpture` | 3D: Scene Builder · Smooth-blob sculpture | 2 | 3 | 3 | 4 | 1.36 | Plain grey; softest of the six builder templates. |

### 2D: Scene Builder

*From:* 2D: Scene Builder (7). Graphs the 2D Scene Builder makes.

**Keep**

| Key | Title | Feature | Look | Clarity | Nodes / notes | GPU ms | Why |
|---|---|---|---:|---:|---|---:|---|
| `sb2Kaleidoscope` | 2D: Scene Builder · Kaleidoscope of glowing rings | Builder: mirrored wedges + spin | 5 | 4 | 32 / 31 | 0.92 | Neon mandala; one of the best 2D pictures in the app. |
| `sb2RingOfRings` | 2D: Scene Builder · A ring of rings | Builder: nested duplication | 5 | 5 | 29 / 28 | 1.04 | Rainbow ring of rings. |
| `sb2RippleGrid` | 2D: Scene Builder · Morphing ripple grid | Builder: grid scene with per-cell ripples | 4 | 5 | 14 / 13 | 1.0 | Shapes morph circle→square as ripples pass. |
| `sb2DepthBeams` | 2D: Scene Builder · Glow beaming through depth | Builder: depth from a picture | 5 | 5 | 23 / 22 | 1.09 | Rings beaming through a sunset landscape. |
| `sb2Orbits` | 2D: Scene Builder · Orbiting shapes | Builder: motion (orbits, spin) | 4 | 4 | 41 / 40 | 0.95 | Sun and orbiting shapes; shows motion. |

**Retire from the list** (2)

| Key | Title | Look | Clarity | Feature | Dup | GPU ms | Reason |
|---|---|---:|---:|---:|---:|---:|---|
| `sb2MouseGrid` | 2D: Scene Builder · Ripples that follow the mouse | 4 | 5 | 2 | 2 | 0.31 | Near-duplicate of sb2RippleGrid. |
| `sb2DepthSize` | 2D: Scene Builder · Circles sized by depth | 4 | 5 | 2 | 2 | 0.29 | Same depth idea as sb2DepthBeams. |

### 4D

*From:* 4D (15). 15 → 5: one slice, one projection, one exotic map, one fractal, one straight to 2D.

**Keep**

| Key | Title | Feature | Look | Clarity | Nodes / notes | GPU ms | Why |
|---|---|---|---:|---:|---|---:|---|
| `fourDHypersphereInTesseract` | 4D: Hypersphere in a tesseract | 4D slicing (sweeping w) | 4 | 5 | 24 / 20 | 0.69 | Ball swelling inside a box: the clearest picture of slicing. |
| `fourDTesseractProjection` | 4D: Rotating tesseract (projection) | 4D projection (inside-out cube) | 4 | 5 | 17 / 13 | 4.44 | The classic tesseract picture. |
| `fourDHopfRings` | 4D: Hopf rings | Stereographic projection (Hopf fibration) | 5 | 5 | 27 / 23 | 6.47 | Most striking 4D image. |
| `fourDQuatJulia` | 4D: Quaternion Julia | 4D fractal (quaternion Julia) | 4 | 5 | 19 / 15 | 2.94 | A boiling 3D slice of a 4D fractal. |
| `fourDFlatTesseract` | 4D: Flat tesseract (4D → 2D) | 4D → 2D with no 3D scene | 4 | 5 | 7 / 7 | 0.29 | Cheap (0.3 ms) glowing lines. |

**Retire from the list** (10)

| Key | Title | Look | Clarity | Feature | Dup | GPU ms | Reason |
|---|---|---:|---:|---:|---:|---:|---|
| `fourDTesseractSlice` | 4D: Tesseract slice | 2 | 5 | 2 | 2 | 0.53 | Another slice on the same checker floor; the slicing idea is kept once. |
| `fourDThreeSlices` | 4D: Tesseract, all three slices | 2 | 5 | 2 | 2 | 0.96 | Another slice on the same checker floor; the slicing idea is kept once. |
| `fourDDuocylinderDance` | 4D: Duocylinder dance | 3 | 5 | 2 | 2 | 0.89 | Another slice on the same checker floor; the slicing idea is kept once. |
| `fourD24Cell` | 4D: The 24-cell | 3 | 5 | 2 | 2 | 0.48 | Another slice on the same checker floor; the slicing idea is kept once. |
| `fourDCliffordTorus` | 4D: Clifford torus | 4 | 5 | 2 | 2 | 4.24 | Another slice on the same checker floor; the slicing idea is kept once. |
| `fourDLattice` | 4D: Lattice of hyperspheres | 3 | 5 | 2 | 2 | 0.69 | Another slice on the same checker floor; the slicing idea is kept once. |
| `fourDShapeGallery` | 4D: Shape gallery | 4 | 3 | 3 | 4 | 7.18 | Catalogue rather than a picture (66 nodes, 7 ms). |
| `fourD24CellWireframe` | 4D: 24-cell wireframe | 4 | 5 | 2 | 2 | 8.04 | Same projection idea as fourDTesseractProjection, 8 ms. |
| `fourDDuocylinderShadow` | 4D: Duocylinder shadow | 3 | 5 | 2 | 2 | 4.5 | Another slice on the same checker floor; the slicing idea is kept once. |
| `fourDPlaneSlice` | 4D: Plane through a duocylinder (4D → 2D) | 3 | 5 | 2 | 2 | 0.24 | Another slice on the same checker floor; the slicing idea is kept once. |

### Particles

*From:* Particles (14). The Particles node: flow, shapes, obstacles, presets, sound.

**Keep**

| Key | Title | Feature | Look | Clarity | Nodes / notes | GPU ms | Why |
|---|---|---|---:|---:|---|---:|---|
| `particleFlowDrift` | Particles: Flow Field | Flow field from an FBM (Flow: Around) | 5 | 4 | 5 / 2 | 2.63 | The best-looking particles picture: luminous threads. |
| `particleStarOutline` | Particles: Star Outline | SDF as a Flow ridge | 4 | 5 | 5 / 4 | 4.28 | Particles climbing onto a star outline. |
| `particlesRoundShape` | Particles round a Shape | Obstacle from a Circle SDF | 4 | 4 | 7 / 4 | 8.53 | Breeze parting round a disc. |
| `particleGalaxy` | Particle Galaxy | Emitter ring + swirl + lights over a nebula | 4 | 4 | 6 / 3 | 3.18 | Featured on the Start sheet. |
| `particleChladniSand` | Particles: Chladni Sand | Sound-driven modes (stand-in beat) | 4 | 5 | 4 / 3 | 4.69 | Sand gathering on nodal lines; works without a song. |

**Retire from the list** (9)

| Key | Title | Look | Clarity | Feature | Dup | GPU ms | Reason |
|---|---|---:|---:|---:|---:|---:|---|
| `particlesIn3dScene` | Particles in a 3D Scene | 3 | 4 | 3 | 4 | 5.9 | Small object; the 3D-camera link is niche. |
| `particleSoundField` | Particles: Sound Field | 4 | 5 | 2 | 2 | 3.4 | Same sound idea as particleChladniSand. |
| `particleCymatics3d` | Particles: Cymatics in 3D | 4 | 5 | 2 | 2 | 11.89 | 3D twin of particleChladniSand, 11.9 ms. |
| `particleFlowIntoShape` | Particles: Currents into a Heart | 4 | 5 | 2 | 2 | 10.11 | Same flow-into-SDF idea as particleStarOutline, and 10 ms. |
| `inkInWater` | Ink in Water | 5 | 4 | 3 | 4 | 12.69 | Runner-up (look 5) but the heaviest particles example (12.7 ms). |
| `particleImageDissolve` | Particles: Image Dissolve | 3 | 5 | 3 | 4 | 4.68 | Preset on show; nice but not a distinct node feature. |
| `particleDustInAir` | Particles: Dust in Air | 3 | 4 | 3 | 4 | 0.97 | Preset on show; nice but not a distinct node feature. |
| `particleEmbers` | Particles: Embers | 4 | 5 | 3 | 4 | 1.39 | Preset on show; nice but not a distinct node feature. |
| `particleRain` | Particles: Rain | 3 | 5 | 3 | 4 | 0.95 | Preset on show; nice but not a distinct node feature. |

### Agents

*From:* Simulation (16, minus 3 ride-a-curve). Walkers built from nodes.

**Keep**

| Key | Title | Feature | Look | Clarity | Nodes / notes | GPU ms | Why |
|---|---|---|---:|---:|---|---:|---|
| `slimeMold` | Slime mold | Slime mold (Sense → Steer → Move → Deposit) | 5 | 5 | 11 / 11 | 5.02 | The canonical agent picture; fully commented. |
| `agentMultiSlime` | Multi-species slime | Several species | 5 | 5 | 14 / 14 | 4.68 | Three colonies in three colours. |
| `agentCurlSmoke` | Curl smoke | Particles as smoke (curl noise, buoyancy) | 4 | 5 | 11 / 11 | 4.6 | A different look: ink on white. |
| `agentParticles` | Particles from nodes | Particles from nodes (the Particles node opened up) | 5 | 5 | 11 / 11 | 4.31 | Start-sheet and Agents-lesson picture. |
| `agentSoundBurst` | Sound burst | Agents answering sound (stand-in beat) | 5 | 5 | 11 / 11 | 2.5 | Rings of streaks; works without a song. |

**Retire from the list** (8)

| Key | Title | Look | Clarity | Feature | Dup | GPU ms | Reason |
|---|---|---:|---:|---:|---:|---:|---|
| `agentAnts` | Ants | 4 | 5 | 2 | 2 | 2.97 | Agents built from nodes, a sixth+ variation; ants/boids also live in Agent rules, galaxy in Agents in 3D. |
| `agentBoids` | Boids | 4 | 5 | 2 | 2 | 6.66 | Agents built from nodes, a sixth+ variation; ants/boids also live in Agent rules, galaxy in Agents in 3D. |
| `agentStrands` | Strands | 5 | 5 | 2 | 2 | 5.27 | Agents built from nodes, a sixth+ variation; ants/boids also live in Agent rules, galaxy in Agents in 3D. |
| `agentGrowPicture` | Grow toward a picture | 4 | 5 | 2 | 2 | 4.23 | Agents built from nodes, a sixth+ variation; ants/boids also live in Agent rules, galaxy in Agents in 3D. |
| `agentGalaxy` | Galaxy | 4 | 5 | 2 | 2 | 2.41 | Agents built from nodes, a sixth+ variation; ants/boids also live in Agent rules, galaxy in Agents in 3D. |
| `agentMycelium` | Mycelium | 2 | 5 | 2 | 2 | 1.98 | Agents built from nodes, a sixth+ variation; ants/boids also live in Agent rules, galaxy in Agents in 3D. |
| `agentSandPlate` | Sand on a plate | 4 | 5 | 2 | 2 | 1.4 | Agents built from nodes, a sixth+ variation; ants/boids also live in Agent rules, galaxy in Agents in 3D. |
| `agentRuleSlime` | Slime rule, by hand (JS) | 5 | 4 | 3 | 4 | 1.79 | The slime rule as JavaScript; teaching companion to slimeMold (Agents lesson uses it). |

### Agents with shaders

*From:* Agents with shaders (8). 

**Keep**

| Key | Title | Feature | Look | Clarity | Nodes / notes | GPU ms | Why |
|---|---|---|---:|---:|---|---:|---|
| `agentShaderRings` | Slime on SDF rings | A shader as food | 5 | 5 | 17 / 17 | 4.11 | Slime on neon SDF rings. |
| `agentShaderWalls` | Shapes as walls | SDF shapes as walls | 5 | 5 | 21 / 21 | 5.67 | Heart, star, circle in a slime web. |
| `agentShaderPolar` | Spirals from polar UV | A UV chain steering walkers | 5 | 5 | 15 / 15 | 4.75 | Rainbow spirals. |
| `agentShaderEmitter` | Born from your shader | Born from your shader (Emit Picture) | 5 | 5 | 17 / 17 | 4.12 | Rainbow flower of particles. |
| `agentShaderNoiseFlow` | Ink along a noise field | Noise as a flow field | 4 | 5 | 13 / 13 | 4.27 | Marbled ink. |

**Retire from the list** (3)

| Key | Title | Look | Clarity | Feature | Dup | GPU ms | Reason |
|---|---|---:|---:|---:|---:|---:|---|
| `agentShaderFeedback` | Trails reshape a shader | 4 | 5 | 2 | 2 | 8.7 | Overlaps with kept examples (outlines = passSlimeEdges; sound = agentSoundBurst); feedback is 8.7 ms. |
| `agentShaderOutlines` | Slime traces outlines | 4 | 5 | 2 | 2 | 4.7 | Overlaps with kept examples (outlines = passSlimeEdges; sound = agentSoundBurst); feedback is 8.7 ms. |
| `agentShaderSoundRings` | Rings that pulse to sound | 4 | 5 | 2 | 2 | 3.05 | Overlaps with kept examples (outlines = passSlimeEdges; sound = agentSoundBurst); feedback is 8.7 ms. |

### Agents in 3D

*From:* Agents in 3D (9). 

**Keep**

| Key | Title | Feature | Look | Clarity | Nodes / notes | GPU ms | Why |
|---|---|---|---:|---:|---|---:|---|
| `agent3dSlime` | 3D slime mold | 3D slime in a volume | 4 | 5 | 11 / 11 | 6.83 | Glowing 3D network. |
| `agent3dTorus` | Swarm round a torus | Collide (3D scene) with a ray-marched torus | 4 | 5 | 23 / 23 | 5.09 | Swarm round a torus. |
| `agent3dGalaxy` | Galaxy in 3D | Orbits in 3D | 4 | 5 | 10 / 10 | 3.36 | Fly-around galaxy (keep this one, retire the 2D agentGalaxy). |
| `agent3dRodSwarm` | Rod swarm | Agents drawn as lit shapes | 4 | 5 | 14 / 14 | 6.62 | Rods pointing along their flight. |
| `agent3dFireflies` | Fireflies in the dark | Depth of field on agents | 5 | 5 | 10 / 10 | 0.87 | Warm bokeh; also the cheapest (0.9 ms). |

**Retire from the list** (4)

| Key | Title | Look | Clarity | Feature | Dup | GPU ms | Reason |
|---|---|---:|---:|---:|---:|---:|---|
| `agent3dFlock` | 3D flock | 3 | 5 | 2 | 2 | 3.33 | Variation on a kept 3D example (flock/rods, slime, storm); agent3dReverse is blown out white. |
| `agent3dVoxelSlime` | Voxel slime | 4 | 5 | 2 | 2 | 9.71 | Variation on a kept 3D example (flock/rods, slime, storm); agent3dReverse is blown out white. |
| `agent3dCubeStorm` | Cube storm | 4 | 5 | 2 | 2 | 3.19 | Variation on a kept 3D example (flock/rods, slime, storm); agent3dReverse is blown out white. |
| `agent3dReverse` | Reverse-perspective swarm | 2 | 5 | 2 | 2 | 1.43 | Variation on a kept 3D example (flock/rods, slime, storm); agent3dReverse is blown out white. |

### Agent rules & simulations

*From:* Agents: rules (13) + Simulations: agents (8). The two folders model the same systems twice (predator/prey, DLA, termites, fireflies, SIR, crowd). Merge, keep the When/Do rule versions plus one unique simulation.

**Keep**

| Key | Title | Feature | Look | Clarity | Nodes / notes | GPU ms | Why |
|---|---|---|---:|---:|---|---:|---|
| `agentRulesAnts` | Agent rules 2 · Ants with food | Rules with states and masks | 4 | 5 | 26 / 26 | 3.93 | Ants, food and nest; readable. |
| `agentRulesPredatorPrey` | Agent rules 4 · Predator & prey | Two species | 4 | 5 | 24 / 24 | 7.44 | Green/red tangle. |
| `agentRulesDla` | Agent rules 8 · DLA growth | Sticking (DLA) | 4 | 5 | 21 / 21 | 2.66 | Frost crystal. |
| `agentRulesSwarm` | Agent rules 10 · Swarm: orbiters | Swarm kind (orbiters) | 4 | 5 | 19 / 19 | 3.72 | Glowing ring. |
| `simAgentSandDrift` | Sand drift: dunes from wind | Erosion and deposition | 4 | 5 | 23 / 23 | 4.03 | Dunes from wind: a look nothing else has. |

**Retire from the list** (14)

| Key | Title | Look | Clarity | Feature | Dup | GPU ms | Reason |
|---|---|---:|---:|---:|---:|---:|---|
| `agentRulesSlime` | Agent rules 1 · Slime mold | 4 | 5 | 2 | 2 | 4.38 | Same system as a kept rule or its simulation twin. |
| `agentRulesBoids` | Agent rules 3 · Flock (boids) | 3 | 5 | 2 | 2 | 4.5 | Same system as a kept rule or its simulation twin. |
| `agentRulesSir` | Agent rules 5 · Infection (SIR) | 3 | 5 | 2 | 2 | 3.13 | Same system as a kept rule or its simulation twin. |
| `agentRulesTermites` | Agent rules 6 · Termites | 2 | 5 | 2 | 2 | 1.45 | Same system as a kept rule or its simulation twin. |
| `agentRulesFireflies` | Agent rules 7 · Fireflies | 1 | 5 | 3 | 4 | 1.53 | Renders almost black at 3 s. |
| `agentRulesParticles` | Agent rules 9 · Particles: spark fountain | 4 | 5 | 2 | 2 | 3.38 | Same system as a kept rule or its simulation twin. |
| `agentRulesCrowd` | Agent rules 11 · Crowd: two-way walkers | 3 | 5 | 2 | 2 | 3.81 | Same system as a kept rule or its simulation twin. |
| `simAgentPredatorPrey` | Predators and prey | 3 | 5 | 2 | 2 | 9.78 | Twin of an Agent-rules example (same model). |
| `simAgentDla` | Diffusion-limited aggregation | 2 | 5 | 2 | 2 | 3.72 | Twin of an Agent-rules example (same model). |
| `simAgentCrowd` | Crowd: lanes in two-way traffic | 4 | 5 | 2 | 2 | 18.84 | Twin of agentRulesCrowd and the heaviest agent example (18.8 ms). |
| `simAgentPainters` | Painter bots | 2 | 5 | 3 | 4 | 6.51 | Busy tangle; no clear read at thumbnail size. |
| `simAgentTermites` | Termites and wood chips | 2 | 5 | 2 | 2 | 2.05 | Twin of an Agent-rules example (same model). |
| `simAgentFireflies` | Fireflies flashing in time | 1 | 5 | 3 | 4 | 4.38 | Renders as a white frame at 3 s (all flashing at once?); check before re-listing. |
| `simAgentInfection` | Infection spread (SIR) | 2 | 5 | 2 | 2 | 6.96 | Twin of an Agent-rules example (same model). |

### Grid simulations

*From:* Simulations: grids (20). Each simulation is there twice (Grid Rules node and “under the hood”). Keep three rule kinds as Grid Rules nodes and two under-the-hood builds.

**Keep**

| Key | Title | Feature | Look | Clarity | Nodes / notes | GPU ms | Why |
|---|---|---|---:|---:|---|---:|---|
| `gridRulesLife` | Grid sims 1 · Game of Life (Grid Rules) | Grid Rules: Count rule (Life) | 4 | 5 | 2 / 2 | 0.3 | The classic, in one node. |
| `gridRulesWire` | Grid sims 9 · Wireworld (Grid Rules) | Grid Rules: Patterns rule (Wireworld) | 4 | 5 | 6 / 6 | 0.38 | Electrons in circuits; bright. |
| `gridRulesWater` | Grid sims 5 · Water ripples (Grid Rules) | Grid Rules: Smooth rule (waves) | 4 | 5 | 2 / 2 | 0.39 | Interference on water. |
| `simGridCave` | Grid sims 4 · Cave generator (under the hood) | Under the hood: a Pass and its Previous, Repeat 8 | 4 | 4 | 35 / 35 | 0.76 | Glowing cave map. |
| `simGridHeat` | Grid sims 6 · Heat diffusion (under the hood) | Under the hood: diffusion, painted with the mouse | 4 | 5 | 20 / 20 | 0.51 | Warm heat-map blobs. |

**Retire from the list** (15)

| Key | Title | Look | Clarity | Feature | Dup | GPU ms | Reason |
|---|---|---:|---:|---:|---:|---:|---|
| `simGridLife` | Grid sims 1 · Game of Life (under the hood) | 4 | 4 | 2 | 2 | 0.3 | The same simulation is there twice (Grid Rules node vs under the hood); kept one of each kind. |
| `gridRulesLifeLike` | Grid sims 2 · Life-like rules (Grid Rules) | 4 | 5 | 2 | 2 | 0.26 | The same simulation is there twice (Grid Rules node vs under the hood); kept one of each kind. |
| `simGridLifeLike` | Grid sims 2 · Life-like rules (under the hood) | 4 | 4 | 2 | 2 | 0.27 | The same simulation is there twice (Grid Rules node vs under the hood); kept one of each kind. |
| `gridRulesBrain` | Grid sims 3 · Brian's Brain (Grid Rules) | 2 | 5 | 2 | 2 | 0.84 | The same simulation is there twice (Grid Rules node vs under the hood); kept one of each kind. |
| `simGridBrain` | Grid sims 3 · Brian's Brain (under the hood) | 2 | 3 | 2 | 2 | 0.6 | The same simulation is there twice (Grid Rules node vs under the hood); kept one of each kind. |
| `gridRulesCave` | Grid sims 4 · Cave generator (Grid Rules) | 3 | 5 | 2 | 2 | 0.58 | The same simulation is there twice (Grid Rules node vs under the hood); kept one of each kind. |
| `simGridWater` | Grid sims 5 · Water ripples (under the hood) | 4 | 4 | 2 | 2 | 0.37 | The same simulation is there twice (Grid Rules node vs under the hood); kept one of each kind. |
| `gridRulesHeat` | Grid sims 6 · Heat diffusion (Grid Rules) | 2 | 5 | 2 | 2 | 0.47 | The same simulation is there twice (Grid Rules node vs under the hood); kept one of each kind. |
| `gridRulesFire` | Grid sims 7 · Forest fire (Grid Rules) | 2 | 5 | 2 | 2 | 0.32 | The same simulation is there twice (Grid Rules node vs under the hood); kept one of each kind. |
| `simGridFire` | Grid sims 7 · Forest fire (under the hood) | 2 | 3 | 2 | 2 | 0.77 | The same simulation is there twice (Grid Rules node vs under the hood); kept one of each kind. |
| `gridRulesSand` | Grid sims 8 · Falling sand (Grid Rules) | 2 | 5 | 2 | 2 | 0.39 | The same simulation is there twice (Grid Rules node vs under the hood); kept one of each kind. |
| `simGridSand` | Grid sims 8 · Falling sand (under the hood) | 4 | 3 | 2 | 2 | 0.33 | The same simulation is there twice (Grid Rules node vs under the hood); kept one of each kind. |
| `simGridWire` | Grid sims 9 · Wireworld (under the hood) | 4 | 3 | 2 | 2 | 0.68 | The same simulation is there twice (Grid Rules node vs under the hood); kept one of each kind. |
| `gridRulesCrystal` | Grid sims 10 · Pattern rules: frost (Grid Rules) | 3 | 5 | 2 | 2 | 0.32 | The same simulation is there twice (Grid Rules node vs under the hood); kept one of each kind. |
| `gridRulesGas` | Grid sims 11 · Block rules: gas (Grid Rules) | 3 | 5 | 2 | 2 | 0.39 | The same simulation is there twice (Grid Rules node vs under the hood); kept one of each kind. |

### Passes

*From:* Passes (11). 

**Keep**

| Key | Title | Feature | Look | Clarity | Nodes / notes | GPU ms | Why |
|---|---|---|---:|---:|---|---:|---|
| `passFeedbackTrails` | Passes 3 · Feedback trails | Feedback: a Pass reading its Previous | 5 | 5 | 10 / 10 | 0.35 | Silky light trails. |
| `passGlowBright` | Passes 5 · Glow only the bright parts | Threshold + blur + add (bloom by hand) | 4 | 5 | 14 / 14 | 0.35 | Neon sign on bricks. |
| `passJumpFlood` | Passes 7 · Jump-flood distance field | Pass Repeat: jump-flood distance field | 5 | 5 | 15 / 15 | 0.73 | Green contour rings. |
| `passEdgesFromPicture` | Passes 8 · Edges straight from a picture | A Texture Input straight into texture tools | 4 | 5 | 7 / 7 | 0.88 | Moonlit sea with glowing edges. |
| `displaceNoiseMap` | Passes 11 · Displacement Map: a picture pushed by noise | Displacement Map | 4 | 5 | 6 / 6 | 0.31 | Op-art ripples. |

**Retire from the list** (6)

| Key | Title | Look | Clarity | Feature | Dup | GPU ms | Reason |
|---|---|---:|---:|---:|---:|---:|---|
| `passEdgeGlow` | Passes 1 · Edge glow | 3 | 5 | 2 | 2 | 0.73 | Overlaps a kept example (glow, edges, slime, reaction-diffusion in Texture tools). |
| `passParticleEdges` | Passes 2 · Particles born on edges | 4 | 5 | 2 | 2 | 6.01 | Overlaps a kept example (glow, edges, slime, reaction-diffusion in Texture tools). |
| `passReactionDiffusion` | Passes 4 · Reaction-diffusion | 2 | 5 | 2 | 2 | 0.37 | Overlaps a kept example (glow, edges, slime, reaction-diffusion in Texture tools). |
| `passSlimeEdges` | Passes 6 · Slime along edges | 4 | 5 | 2 | 2 | 4.76 | Overlaps a kept example (glow, edges, slime, reaction-diffusion in Texture tools). |
| `passBlurGroup` | Passes 9 · A reusable blur group | 4 | 5 | 2 | 2 | 0.58 | Overlaps a kept example (glow, edges, slime, reaction-diffusion in Texture tools). |
| `passShaderTextureFood` | Passes 10 · A Shader Texture feeds the slime | 4 | 5 | 2 | 2 | 3.44 | Overlaps a kept example (glow, edges, slime, reaction-diffusion in Texture tools). |

### Effects & Lens

*From:* Effects & Lens (6) + Blur & Lens (5) + Halftone (2). 

**Keep**

| Key | Title | Feature | Look | Clarity | Nodes / notes | GPU ms | Why |
|---|---|---|---:|---:|---|---:|---|
| `raysLightText` | Light rays 1 · LIGHT | Radial Fast Blur (light rays) | 5 | 5 | 5 / 5 | 0.3 | Glowing LIGHT with rays; one of the best pictures. |
| `motionBlurTrails` | Motion Blur Trails | Feedback (texture) tail | 4 | 3 | 5 / 1 | 0.41 | Fractal with smooth trails. |
| `dofDepthBlur` | Depth of Field: Post-Process Blur | Depth of Field (texture) from a Pass | 3 | 3 | 17 / 2 | 0.89 | Bokeh on a lit scene. |
| `cmykNoise` | CMYK Halftone | CMYK Halftone | 4 | 2 | 6 / 0 | 0.34 | Print look. Needs a description and notes. |
| `crtTv` | CRT TV | CRT Screen + CRT Mask | 3 | 3 | 7 / 0 | 0.35 | Tube look. Needs node notes. |

**New to build**

- **Echo and smear, done right** — One bright shape (a neon star) orbiting over a dark gradient, with Echo leaving coloured ghosts and a feedback smear into the centre. echoTrails (featured on the Start sheet) and feedbackSmear show as a tiny dot and a grey wash today.

**Retire from the list** (8)

| Key | Title | Look | Clarity | Feature | Dup | GPU ms | Reason |
|---|---|---:|---:|---:|---:|---:|---|
| `echoTrails` | Echo Trails | 1 | 3 | 3 | 4 | 0.48 | Thumbnail is a tiny dot on black; featured on the Start sheet → repoint. See NEW “Echo and smear”. |
| `feedbackSmear` | Feedback Smear | 2 | 3 | 3 | 4 | 0.44 | Washes out to grey. |
| `lensBarrel` | Lens Distortion | 2 | 3 | 3 | 4 | 0.31 | Plain white grid. |
| `raysColourBurst` | Light rays 2 · Colour burst | 4 | 5 | 2 | 2 | 0.71 | Second Radial Fast Blur example. |
| `webcamCmyk` | Webcam CMYK | 3 | 3 | 2 | 2 | 0.39 | Second CMYK Halftone. |
| `tiltShiftScene` | Tilt-Shift | 2 | 3 | 3 | 4 | 0.4 | Washed-out white floor. |
| `dofOrbitOrbs` | DoF: Orbit Orbs | 2 | 2 | 2 | 2 | 0.36 | Same DoF idea as dofDepthBlur, no notes. |
| `comboBlurDirectional` | Combo: Wave Texture + Blur | 3 | 3 | 3 | 4 | 0.6 | Blur on a rainbow wave; hard to see the blur. |

### Texture tools

*From:* Texture tools (23). Most use the same Ball action clip, so they look alike; keep the five with the most distinct pictures.

**Keep**

| Key | Title | Feature | Look | Clarity | Nodes / notes | GPU ms | Why |
|---|---|---|---:|---:|---|---:|---|
| `ttRenderTargets` | Texture tools 12 · Render Targets: motion and paint in one draw | Render Targets (two outputs from one draw) | 5 | 5 | 10 / 10 | 0.4 | Psychedelic paint; nothing else looks like it. |
| `ttBlobStamp` | Texture tools 14 · Blob Track: a picture on every blob | Blob Track + Stamp | 5 | 5 | 9 / 9 | 1.96 | Glossy bubbles on every blob. |
| `ttCacheTimeMachine` | Texture tools 16 · Cache: Time Machine | Cache + Delay map (Time Machine) | 4 | 5 | 5 / 5 | 0.14 | Each pixel from its own moment. |
| `ttDistanceRings` | Texture tools 7 · Outline and rings from a jump flood | Mask seed → jump flood → Outline | 4 | 5 | 11 / 11 | 0.76 | Contour lines round a landscape. |
| `ttFeedbackTunnel` | Texture tools 8 · Zoom tunnel with Feedback | Feedback (texture) zoom tunnel | 4 | 5 | 4 / 4 | 0.39 | Classic video feedback in one node. |

**New to build**

- **Segment + Optical Flow on a person** — Needs a clip with a person in it (Segment People shows a rainbow gradient today, the Ball clip has nobody). Cut-out over a moving field, with Optical Flow smearing trails off the cut-out. Ask before bundling any footage of people.

**Retire from the list** (18)

| Key | Title | Look | Clarity | Feature | Dup | GPU ms | Reason |
|---|---|---:|---:|---:|---:|---:|---|
| `ttVideoOutline` | Texture tools 1 · Glowing outline from a video | 3 | 5 | 2 | 2 | 1.07 | Same Ball action clip treated another way; feature kept discoverable through its node’s own example link. |
| `ttMotionTrails` | Texture tools 2 · Motion trails with Feedback | 4 | 5 | 2 | 2 | 0.41 | Same Ball action clip treated another way; feature kept discoverable through its node’s own example link. |
| `ttTrailFlow` | Texture tools 3 · A slime trail bends a picture | 4 | 5 | 2 | 2 | 5.32 | Same Ball action clip treated another way; feature kept discoverable through its node’s own example link. |
| `ttColourKey` | Texture tools 4 · Colour key on a video | 4 | 5 | 2 | 2 | 0.37 | Same Ball action clip treated another way; feature kept discoverable through its node’s own example link. |
| `ttReactionLevels` | Texture tools 5 · Reaction-diffusion, shaped and coloured | 2 | 5 | 2 | 2 | 0.35 | Same Ball action clip treated another way; feature kept discoverable through its node’s own example link. |
| `ttGrowShrink` | Texture tools 6 · Grow and shrink a mask | 3 | 5 | 2 | 2 | 0.34 | Same Ball action clip treated another way; feature kept discoverable through its node’s own example link. |
| `ttFeedbackFlow` | Texture tools 9 · Trails pushed by their own flow | 3 | 5 | 2 | 2 | 0.41 | Same Ball action clip treated another way; feature kept discoverable through its node’s own example link. |
| `ttFeedbackCamera` | Texture tools 10 · Camera echo trails | 3 | 5 | 2 | 2 | 0.43 | Same Ball action clip treated another way; feature kept discoverable through its node’s own example link. |
| `ttDataAdvect` | Texture tools 11 · Data Texture: positions that drift | 4 | 5 | 2 | 2 | 0.43 | Same Ball action clip treated another way; feature kept discoverable through its node’s own example link. |
| `ttBlobTrack` | Texture tools 13 · Blob Track: a tracking overlay | 3 | 5 | 2 | 2 | 1.21 | Same Ball action clip treated another way; feature kept discoverable through its node’s own example link. |
| `ttCacheTimeRgb` | Texture tools 15 · Cache: red now, green and blue from the past | 3 | 5 | 2 | 2 | 0.12 | Same Ball action clip treated another way; feature kept discoverable through its node’s own example link. |
| `ttAnalyze` | Texture tools 17 · Analyze: a video steers a shape | 2 | 5 | 2 | 2 | 0.41 | Same Ball action clip treated another way; feature kept discoverable through its node’s own example link. |
| `ttOpticalFlow` | Texture tools 18 · Optical Flow: trails that follow the motion | 1 | 5 | 3 | 4 | 1.0 | Blows out to white at 3 s. |
| `ttBlob3d` | Texture tools 19 · Blob Track in 3D | 4 | 5 | 2 | 2 | 2.9 | Same Ball action clip treated another way; feature kept discoverable through its node’s own example link. |
| `ttSegmentPeople` | Texture tools 20 · Segment: cut yourself out | 2 | 5 | 3 | 4 | 0.27 | No person in the bundled clip, so it shows a rainbow gradient. See NEW in Texture tools. |
| `ttSegmentClick` | Texture tools 21 · Segment: click to select | 4 | 5 | 2 | 2 | 0.27 | Same Ball action clip treated another way; feature kept discoverable through its node’s own example link. |
| `ttDeepGlow` | Texture tools 22 · Deep glow on a video | 3 | 5 | 2 | 2 | 0.84 | Same Ball action clip treated another way; feature kept discoverable through its node’s own example link. |
| `ttDisplaceNoise` | Texture tools 23 · Displace a video by a noise | 4 | 5 | 2 | 2 | 0.47 | Same Ball action clip treated another way; feature kept discoverable through its node’s own example link. |

### Pictures

*From:* Pictures (10). 

**Keep**

| Key | Title | Feature | Look | Clarity | Nodes / notes | GPU ms | Why |
|---|---|---|---:|---:|---|---:|---|
| `picChannelSplash` | Pictures 1 · Channel: colour only where the lamp light is | Channel (selective colour) | 4 | 5 | 5 / 5 | 0.47 | Lamp light kept in colour. |
| `picHeightRelief` | Pictures 4 · Height Light: the photo as a relief | Height Light (photo as relief) | 4 | 5 | 5 / 5 | 0.32 | Embossed bronze look. |
| `picPixelSort` | Pictures 7 · Pixel sort with a feedback Pass | Pixel sort with a feedback Pass | 4 | 5 | 14 / 14 | 0.56 | Dripping streaks. |
| `picGlitch` | Pictures 10 · Glitch: two photos trade blocks | Glitch (two photos trade blocks) | 4 | 5 | 6 / 6 | 0.36 | Strong glitch picture. |
| `picCurves` | Pictures 8 · Curves: more contrast, then a cross-processed look | Curves (S-curve + cross-process) | 4 | 5 | 6 / 6 | 0.55 | Grading. |

**Retire from the list** (5)

| Key | Title | Look | Clarity | Feature | Dup | GPU ms | Reason |
|---|---|---:|---:|---:|---:|---:|---|
| `picShuffle` | Pictures 2 · Shuffle: swapped channels | 3 | 5 | 2 | 2 | 0.47 | Sixth+ treatment of the same two photos. |
| `picChannelColours` | Pictures 3 · Channel Colours: a three-ink print | 4 | 5 | 2 | 2 | 0.47 | Sixth+ treatment of the same two photos. |
| `picShowData` | Pictures 5 · Show data: brightness and its direction | 4 | 5 | 2 | 2 | 0.3 | Sixth+ treatment of the same two photos. |
| `picBlockSwap` | Pictures 6 · Random (from ID): block swap | 4 | 5 | 2 | 2 | 0.33 | Sixth+ treatment of the same two photos. |
| `picThreshold` | Pictures 9 · Threshold: a soft mask of the lamp light | 3 | 5 | 2 | 2 | 0.55 | Sixth+ treatment of the same two photos. |

### Grid

*From:* Grid (18). 

**Keep**

| Key | Title | Feature | Look | Clarity | Nodes / notes | GPU ms | Why |
|---|---|---|---:|---:|---|---:|---|
| `gridTourMorph` | Grid 3 · One wire: shapes that morph and spin per cell | A shape chain wired into Grid Pattern | 4 | 4 | 15 / 8 | 0.28 | Bright morphing stars and squares. |
| `gridTourRipple` | Grid 4 · Big patterns from per-cell numbers | Big patterns from per-cell numbers | 4 | 4 | 11 / 4 | 0.27 | Concentric dot ripple. |
| `gridTourOverflow` | Grid 6 · Overflow: rings that cross their cells | Overflow: shapes crossing cells | 4 | 4 | 9 / 3 | 0.39 | Overlapping rainbow rings. |
| `gridDensityWave` | Grid: Density Wave | Grid Density Warp | 4 | 5 | 7 / 7 | 0.27 | Dots bunching in a wave. |
| `boundsBouncingCopies` | Grid · Bounds: copies bouncing in their boxes | Bounds (copies in boxes) | 3 | 5 | 11 / 11 | 0.34 | Fully commented. |

**Retire from the list** (13)

| Key | Title | Look | Clarity | Feature | Dup | GPU ms | Reason |
|---|---|---:|---:|---:|---:|---:|---|
| `gridTourBuiltIn` | Grid 1 · Built-in shapes and patterns | 3 | 4 | 2 | 2 | 0.37 | Another dot grid; the feature is covered by a kept Grid example. |
| `gridTourByHand` | Grid 2 · By hand: Grid node + SDF Fill | 4 | 4 | 2 | 2 | 0.3 | Another dot grid; the feature is covered by a kept Grid example. |
| `gridTourMouseMorph` | Grid 5 · The mouse changes the shape | 2 | 4 | 2 | 2 | 0.25 | Another dot grid; the feature is covered by a kept Grid example. |
| `gridTourArrayInCells` | Grid 7 · An Array in every cell | 3 | 4 | 2 | 2 | 0.31 | Another dot grid; the feature is covered by a kept Grid example. |
| `gridTourArrayBlobs` | Grid 8 · Array as the grid: melting dots | 3 | 4 | 2 | 2 | 0.6 | Another dot grid; the feature is covered by a kept Grid example. |
| `learnGrid` | Grid: Cell ID and hash | 3 | 4 | 2 | 2 | 0.27 | Another dot grid; the feature is covered by a kept Grid example. |
| `learnGridPattern` | Grid: Grid Pattern and the mouse | 3 | 4 | 2 | 2 | 0.27 | Another dot grid; the feature is covered by a kept Grid example. |
| `learnGridSpread` | Grid: Effects across the grid | 3 | 4 | 2 | 2 | 0.27 | Another dot grid; the feature is covered by a kept Grid example. |
| `gridNeighborDisplaced` | Grid: Attract | 3 | 3 | 2 | 2 | 0.27 | Another dot grid; the feature is covered by a kept Grid example. |
| `gridMetaballs` | Grid: Metaballs | 3 | 2 | 2 | 2 | 0.58 | Another dot grid; the feature is covered by a kept Grid example. |
| `gridBreathing` | Grid: Breathing | 3 | 5 | 2 | 2 | 0.33 | Another dot grid; the feature is covered by a kept Grid example. |
| `gridLavaLamp` | Lava Lamp | 3 | 3 | 2 | 2 | 0.27 | Another dot grid; the feature is covered by a kept Grid example. |
| `beatGrid` | Beat Grid | 2 | 3 | 3 | 4 | 0.31 | Shows a flat red BEAT card in Studio; audio needs a track. |

### Matrices

*From:* Matrices (8). 

**Keep**

| Key | Title | Feature | Look | Clarity | Nodes / notes | GPU ms | Why |
|---|---|---|---:|---:|---|---:|---|
| `matrixFoldFractal` | Matrix 5 · Fold, rotate, scale: a fractal from one matrix | Fold, rotate, scale: a fractal from one matrix | 4 | 4 | 16 / 5 | 0.23 | Matrices-lesson still. |
| `matrixLattices` | Matrix 3 · Lattices: hexagons, bricks, triangles | Lattice setting (hexagons) | 4 | 4 | 8 / 2 | 0.23 | Honeycomb. |
| `matrixAnyBasis` | Matrix 4 · A grid with any basis | A matrix as the grid’s basis | 4 | 3 | 14 / 4 | 0.24 | Shearing dots. |
| `matrixCornerPin` | Matrix 6 · Corner pin: a picture on a tilted card | Corner pin (projective matrix) | 3 | 4 | 6 / 2 | 0.22 | A pattern on a tilted card. |
| `matrixNoiseOctaves` | Matrix 7 · Rotated noise octaves | Rotated noise octaves | 4 | 3 | 23 / 6 | 0.26 | Rich FBM. |

**Retire from the list** (3)

| Key | Title | Look | Clarity | Feature | Dup | GPU ms | Reason |
|---|---|---:|---:|---:|---:|---:|---|
| `matrixWhatItDoes` | Matrix 1 · What a matrix does to space | 3 | 4 | 3 | 4 | 0.33 | Teaching step (used by the Matrices lesson); the kept five look better. |
| `matrixCombineUndo` | Matrix 2 · Combine and undo: place a shape | 3 | 4 | 3 | 4 | 0.24 | Teaching step (used by the Matrices lesson); the kept five look better. |
| `matrixColor` | Matrix 8 · Colour matrices | 3 | 4 | 3 | 4 | 0.27 | Teaching step (used by the Matrices lesson); the kept five look better. |

### Node Combos

*From:* Node Combos (13). 

**Keep**

| Key | Title | Feature | Look | Clarity | Nodes / notes | GPU ms | Why |
|---|---|---|---:|---:|---|---:|---|
| `comboDomeRepeat` | Combo: Dome + Repeat + Height | Spherical (Dome) + Repeat + Height | 4 | 3 | 12 / 0 | 0.26 | Glowing tiled dome. |
| `comboVoxelSpheres` | Combo: Voxelize + Sphere 3D + Random | Voxelize + Random (3D) | 3 | 3 | 21 / 2 | 0.82 | Block of coloured spheres. |
| `comboGridGroupFlower` | Combo: Grid Pattern + grouped flower | A Group as the grid’s shape | 4 | 3 | 12 / Play notes | 0.35 | Flower wallpaper. |
| `comboArrayStars` | Combo: Array of stars | Array of a shape (field socket) | 4 | 4 | 6 / Play notes | 0.32 | Ring of stars; Field-sockets lesson still. |
| `comboRepeatCellHash` | Combo: Repeat + Cell ID + Hash | Repeat + Cell ID + Hash | 4 | 3 | 9 / 0 | 0.27 | Bold polka dots. |

**Retire from the list** (8)

| Key | Title | Look | Clarity | Feature | Dup | GPU ms | Reason |
|---|---|---:|---:|---:|---:|---:|---|
| `comboChaosStars` | Combo: Chaos Layers + Glow to Color | 2 | 3 | 2 | 2 | 0.29 | Overlaps a kept combo or a Grid example; weaker picture. |
| `comboTurbulenceGlow` | Combo: Turbulence + SDF + Glow | 2 | 3 | 2 | 2 | 0.32 | Overlaps a kept combo or a Grid example; weaker picture. |
| `comboBloomDots` | Combo: Grid + SDF Fill + Bloom | 2 | 3 | 2 | 2 | 0.64 | Overlaps a kept combo or a Grid example; weaker picture. |
| `comboGridPaintShapes` | Combo: Grid Pattern + Shapes + Grid Paint | 3 | 3 | 2 | 2 | 0.29 | Overlaps a kept combo or a Grid example; weaker picture. |
| `comboGridPaintPictures` | Combo: Grid Pattern + FBM per cell | 2 | 4 | 2 | 2 | 0.31 | Overlaps a kept combo or a Grid example; weaker picture. |
| `comboGridPaintGlow` | Combo: Grid Pattern + SDF Glow | 3 | 4 | 2 | 2 | 0.3 | Overlaps a kept combo or a Grid example; weaker picture. |
| `comboGridShapeByWire` | Combo: Grid Pattern + Shape by wire | 3 | 4 | 2 | 2 | 0.31 | Overlaps a kept combo or a Grid example; weaker picture. |
| `comboArrayGroupMoons` | Combo: Array of grouped moons | 3 | 3 | 2 | 2 | 0.35 | Overlaps a kept combo or a Grid example; weaker picture. |

### Data

*From:* Data (8). 

**Keep**

| Key | Title | Feature | Look | Clarity | Nodes / notes | GPU ms | Why |
|---|---|---|---:|---:|---|---:|---|
| `dataCityBars` | Data 3 · City temperatures, a month at a time | Data layer: bars | 4 | 4 | 4 / Play notes | 0.22 | Clear chart. |
| `dataRoutePath` | Data 4 · A route drawn on | Data layer: path with Trim | 4 | 4 | 4 / Play notes | 0.25 | Rainbow spiral drawing on. |
| `dataRouteGlow` | Data 2 · Every row a glowing point | Data node in an iterated group | 4 | 4 | 13 / 5 | 0.31 | Glowing dots along a spiral. |
| `dataPoemWords` | Data 5 · A poem, word by word | Text dataset, word by word | 3 | 4 | 4 / Play notes | 0.31 | Typography. |
| `dataLiveFeed` | Data 8 · A live feed | Live feed (rolling window) | 3 | 3 | 9 / 2 | 2.04 | Moving line. |

**Retire from the list** (3)

| Key | Title | Look | Clarity | Feature | Dup | GPU ms | Reason |
|---|---|---:|---:|---:|---:|---:|---|
| `dataWeatherYear` | Data 1 · A year of weather | 2 | 4 | 3 | 4 | 0.23 | Weaker picture; feature covered by a kept Data example. |
| `dataScriptRings` | Data 6 · A sketch reads s.data() | 3 | 4 | 3 | 4 | 0.29 | Weaker picture; feature covered by a kept Data example. |
| `dataTypedStars` | Data 7 · A constellation, typed in | 2 | 4 | 3 | 4 | 0.33 | Weaker picture; feature covered by a kept Data example. |

### Audio

*From:* Audio (10). All ten render as an empty or near-empty frame until a sound is loaded.

**Keep**

| Key | Title | Feature | Look | Clarity | Nodes / notes | GPU ms | Why |
|---|---|---|---:|---:|---|---:|---|
| `audioKickRing` | Audio 1 · A ring that jumps on the kick | Kick band → Envelope + Counter | 2 | 5 | 7 / 7 | 0.25 |  |
| `audioSpectrumBars` | Audio 2 · Spectrum bars | Spectrum | 1 | 5 | 5 / 5 | 0.37 |  |
| `audioScope` | Audio 4 · Waveform line | Waveform | 2 | 5 | 5 / 5 | 0.43 |  |
| `audioWaterfall` | Audio 3 · Spectrogram waterfall | Spectrogram | 1 | 5 | 6 / 6 | 0.34 |  |
| `audioSpectrogramField` | Audio 9 · Sound landscape | Spectrogram as a Field (landscape) | 3 | 5 | 7 / 7 | 0.32 |  |

**New to build**

- **Audio: stand-in sound** — Give the Audio Source a built-in generated loop (as the particle examples have a stand-in beat), so every Audio example moves when opened. Then one showpiece: the Spectrogram Field as a lit terrain with a sunset palette.

**Retire from the list** (5)

| Key | Title | Look | Clarity | Feature | Dup | GPU ms | Reason |
|---|---|---:|---:|---:|---:|---:|---|
| `audioLearnClap` | Audio 5 · Learn a clap | 2 | 5 | 2 | 2 | 0.23 | Empty frame until a song is loaded; a sixth+ audio node. |
| `audioFilterSweep` | Audio 6 · Filter sweep | 1 | 5 | 2 | 2 | 0.46 | Empty frame until a song is loaded; a sixth+ audio node. |
| `audioResonatorRings` | Audio 7 · Resonator rings | 2 | 5 | 2 | 2 | 0.24 | Empty frame until a song is loaded; a sixth+ audio node. |
| `audioSpectralFreeze` | Audio 8 · Spectral freeze | 1 | 5 | 2 | 2 | 0.31 | Empty frame until a song is loaded; a sixth+ audio node. |
| `audioHitBand` | Audio 10 · Hit and Band Level | 2 | 5 | 2 | 2 | 0.29 | Empty frame until a song is loaded; a sixth+ audio node. |

### Signals & Inputs

*From:* Memory (3) + Send & Receive (1) + Inputs (1). Small folders merged: nodes that carry state or bring signals in.

**Keep**

| Key | Title | Feature | Look | Clarity | Nodes / notes | GPU ms | Why |
|---|---|---|---:|---:|---|---:|---|
| `memFollow` | Memory 1 · Lag and Spring follow the mouse | Lag and Spring | 1 | 5 | 7 / 7 | 0.3 | Black until the mouse moves. |
| `memBeat` | Memory 2 · A beat with Envelope and Counter | Envelope and Counter | 3 | 5 | 7 / 7 | 0.24 | Pulsing ring. |
| `memReadout` | Memory 3 · A timer and a beat counter, as text | Text nodes with live numbers | 3 | 5 | 8 / 8 | 0.32 | Readout. |
| `sendReceiveBeat` | Send & Receive · a beat and a picture, into two groups | Send & Receive across groups | 4 | 5 | 18 / 16 | 0.32 | Rings. |
| `midiGlowKeys` | MIDI: Keys to Glow | MIDI Input (with keyboard stand-in) | 2 | 3 | 14 / 0 | 0.26 | Needs notes; plain glow. |

**New to build**

- **Lag & Spring without a mouse** — An LFO-driven point that the Lag and Spring discs chase, so it moves when opened; trails through Echo. memFollow is a black frame until you move the mouse.

**Retire from the list** (0)


### Groups & Code

*From:* Iterated Groups (4) + Functions (4) + Convert (2). 

**Keep**

| Key | Title | Feature | Look | Clarity | Nodes / notes | GPU ms | Why |
|---|---|---|---:|---:|---|---:|---|
| `groupCarryRings` | Group: Fractal Rings (Carry) | Iterated Group with Carry | 4 | 5 | 17 / 17 | 0.37 | Rings within rings; fully commented. |
| `loopKali` | Loop: Kali fold | Expression Block in Loop mode (orbit trap) | 4 | 5 | 3 / 3 | 0.33 | Purple starfield fractal. |
| `ringGlow` | Ring Glow | Custom Function (GLSL) | 4 | 5 | 4 / 4 | 0.31 | Glowing ring over a gradient. |
| `publishAndKeyframes` | Publish a Node + Keyframes | Publish a group as a node + keyframes | 3 | 3 | 10 / 0 | 0.24 | Needs node notes. |
| `convertCircleOptimised` | Convert: Soft circle, optimised | Convert page output (optimised) | 2 | 4 | 5 / Play notes | 0.28 | Interim: a flat orange ellipse. Replace with the NEW item below. |

**New to build**

- **Convert: a real shader** — Paste a short, good-looking shader (a plasma or tunnel of ~15 lines) through Convert, ship it as written + optimised, with notes. Replaces the soft-circle pair, which is used by the Convert lesson (update that too).

**Retire from the list** (5)

| Key | Title | Look | Clarity | Feature | Dup | GPU ms | Reason |
|---|---|---:|---:|---:|---:|---:|---|
| `groupCarryFBM` | Group: FBM Octaves (Carry) | 3 | 5 | 4 | 3 | 0.41 | Same FBM / warp as the Learn course. |
| `groupCarryDomainWarp` | Group: Domain Warp (Carry) | 3 | 2 | 4 | 3 | 0.45 | Same FBM / warp as the Learn course. |
| `loopJulia` | Loop: Julia set (escape time) | 4 | 5 | 2 | 2 | 0.34 | Same Expression-Loop feature as loopKali. |
| `loopFbm` | Loop: fbm, a sum of octaves | 3 | 5 | 2 | 2 | 0.32 | Same Expression-Loop feature as loopKali. |
| `convertCircle` | Convert: Soft circle, as written | 2 | 3 | 2 | 2 | 0.34 | The un-optimised twin (Convert lesson uses it). |

### 2D: Shapes, Space & Colour

*From:* Color & Lighting (3) + Space & Texture (5) + Rings (1) + Fractals (2) + 3 basics from Curves & Shapes. 

**Keep**

| Key | Title | Feature | Look | Clarity | Nodes / notes | GPU ms | Why |
|---|---|---|---:|---:|---|---:|---|
| `fractalRings` | Fractal Rings | Fractal Loop (the startup example) | 5 | 2 | 4 / 0 | 0.26 | The app’s default picture. Needs node notes (0 today). |
| `colorStopsCycle` | Color: Stops Palette + Colorize | Stops Palette + Colorize | 4 | 3 | 9 / 0 | 0.27 | Rainbow neon ring. |
| `spaceAtlas` | Space Atlas | 2D space maps (Möbius) | 4 | 3 | 7 / 0 | 0.28 | Needs node notes. |
| `neonFloorGrid` | Neon Floor Grid | Perspective floor grid | 4 | 2 | 7 / 0 | 0.27 | Synthwave look. Needs description and notes. |
| `newtonFractalZ5` | Newton z⁵−1 | Complex-number fractal (Newton) | 4 | 2 | 4 / 0 | 0.68 | Needs description and notes. |

**Retire from the list** (9)

| Key | Title | Look | Clarity | Feature | Dup | GPU ms | Reason |
|---|---|---:|---:|---:|---:|---:|---|
| `learnShaping` | Bezier shaping curve | 3 | 3 | 4 | 3 | 3.36 | Basics already in the Learn course. |
| `learnShape` | SDF: Circle SDF + SDF Fill | 2 | 4 | 4 | 3 | 3.32 | Basics already in the Learn course. |
| `learnDistance` | SDF: distance as light | 2 | 4 | 4 | 3 | 3.25 | Basics already in the Learn course. |
| `learnPalette` | Cosine palettes | 3 | 4 | 4 | 3 | 0.3 | Basics already in the Learn course. |
| `neonGlow` | Neon Tube | 2 | 3 | 3 | 4 | 0.28 | A blurred pink ball; glow covered elsewhere. |
| `waveTextureDemo` | Wave Texture | 4 | 2 | 3 | 4 | 0.23 | Flat texture demo, no notes or description. |
| `waveInterference` | Wave Interference | 3 | 2 | 3 | 4 | 0.28 | Flat texture demo, no notes or description. |
| `magicTextureDemo` | Magic Texture | 3 | 2 | 3 | 4 | 0.29 | Flat texture demo, no notes or description. |
| `gravitationalLens` | Gravity Lens | 3 | 2 | 3 | 4 | 0.65 | Shows a Mandelbrot, not a lens; misnamed, no notes. |

### Curves & Shapes

*From:* Curves & Shapes (5 Curve Trace) + Physics (2) + 3 ride-a-curve + Curve Trace 3D. 

**Keep**

| Key | Title | Feature | Look | Clarity | Nodes / notes | GPU ms | Why |
|---|---|---|---:|---:|---|---:|---|
| `curveTraceBeam` | Curve Trace: oscilloscope beam | Curve Trace: oscilloscope phosphor | 4 | 5 | 3 / 2 | 0.47 | Green scope beam. |
| `curveTraceIntervals` | Curve Trace: harmonograph intervals | Curve Trace: frequency ratios | 4 | 5 | 11 / 10 | 3.38 | Four harmonograph figures. |
| `curveTraceMorph` | Curve Trace: morph | Curve Trace: morph between figures | 3 | 5 | 7 / 6 | 1.69 | Two figures blending. |
| `chladniModeFreqDemo` | Chladni Mode Frequency | Chladni field | 3 | 2 | 7 / 0 | 0.23 | Clean line art. Needs notes. |
| `agentRideHarmonograph` | Walkers on a harmonograph | Walkers riding a curve | 4 | 5 | 11 / 11 | 7.39 | Glowing ribbon. |

**Retire from the list** (6)

| Key | Title | Look | Clarity | Feature | Dup | GPU ms | Reason |
|---|---|---:|---:|---:|---:|---:|---|
| `curveTraceLive` | Curve Trace: live harmonograph | 1 | 5 | 3 | 4 | 1.57 | Thumbnail is nearly empty (a dot / faint line). |
| `curveTracePen` | Curve Trace: pen drawing | 2 | 5 | 3 | 4 | 0.54 | Thumbnail is nearly empty (a dot / faint line). |
| `agentRidePath` | Riding outlines | 4 | 5 | 2 | 2 | 6.08 | Second/third ride-a-curve example; agentRideHarmonograph kept. |
| `agentRideMorph` | Morphing ribbon | 2 | 5 | 2 | 2 | 4.97 | Second/third ride-a-curve example; agentRideHarmonograph kept. |
| `chladniFieldQuickDemo` | Chladni (Quick) | 2 | 2 | 2 | 2 | 0.24 | Same Chladni field as chladniModeFreqDemo. |
| `curveTraceKnot` | Curve Trace 3D: Lissajous knot | 3 | 5 | 3 | 4 | 14.36 | Heaviest example measured (14 ms) for a small knot; Curve Trace is covered in 2D. |

### Splats

*From:* 3 splat examples from 3D Basics + 2 from Agents: rules + 1 from Play. New category: splats were spread over three folders.

**Keep**

| Key | Title | Feature | Look | Clarity | Nodes / notes | GPU ms | Why |
|---|---|---|---:|---:|---|---:|---|
| `splatRingsInScene` | 3D: Splat scan in a scene | Splat Scene among ray-marched shapes | 3 | 3 | 19 / 3 | 5.73 |  |
| `splatIsometric` | 3D: Splat scan, isometric | Orthographic camera on a scan | 3 | 5 | 20 / 20 | 5.67 |  |
| `splatModifiersBall` | 3D: Splat modifiers | Splat modifiers (attributes → Set Splat) | 2 | 5 | 11 / 10 | 6.86 |  |
| `agentRulesScan3d` | Agent rules 13 · Scan to walkers in 3D | A scan as walkers in 3D | 2 | 5 | 16 / 16 | 9.81 |  |
| `splatDissolvePlay` | 112 · Splats: a scan dissolving | Splat Dissolve on Play | 3 | 5 | 6 / 5 | 4.92 |  |

**New to build**

- **Splats: a real scan** — Every splat example uses the generated rings/ball scan, which reads as noise. Use one of the sample scans in shader-studio-samples (ask before bundling) for a single good-looking showpiece.

**Retire from the list** (1)

| Key | Title | Look | Clarity | Feature | Dup | GPU ms | Reason |
|---|---|---:|---:|---:|---:|---:|---|
| `agentRulesScan` | Agent rules 12 · Scan to walkers | 2 | 5 | 2 | 2 | 9.22 | Same scan as agentRulesScan3d. |

### Time Cube

*From:* Time Cube (13). Builder presets (timeCubeBuilder/presets.ts) load several of these as templates: retired ones must stay loadable.

**Keep**

| Key | Title | Feature | Look | Clarity | Nodes / notes | GPU ms | Why |
|---|---|---|---:|---:|---|---:|---|
| `timeCubeBox` | Time cube: a video as a box of time | A video as a box of time | 3 | 5 | 4 / 4 | 2.85 | The basic idea. |
| `timeCubeSlitScan` | Slit-scan from a time cube | Slit-scan from the cube (no 3D) | 4 | 5 | 4 / 4 | 0.29 | Most striking, and cheap. |
| `timeCubeHall` | Time cube: infinite hall | Repeated cubes, each a little later | 4 | 5 | 4 / 4 | 3.12 | Infinite hall. |
| `timeCubeSoftPill` | Time cube: soft pill | Styling: soft pill on white | 4 | 5 | 3 / 3 | 0.5 | Only light-background one. |
| `timeCubeHighlights` | Time cube: highlighted frames loop | Highlighted frames lifted out | 4 | 5 | 4 / 4 | 6.44 | Outlined cards. |

**Retire from the list** (8)

| Key | Title | Look | Clarity | Feature | Dup | GPU ms | Reason |
|---|---|---:|---:|---:|---:|---:|---|
| `timeCubeFlow` | Time cube: flow | 3 | 5 | 2 | 2 | 3.67 | Variation on the cube; several are Time Cube builder presets, so they must stay loadable. |
| `timeCubePulse` | Time cube: pulsing key | 2 | 5 | 2 | 2 | 3.84 | Variation on the cube; several are Time Cube builder presets, so they must stay loadable. |
| `timeCubeFlyThrough` | Time cube: fly-through | 2 | 5 | 2 | 2 | 1.45 | Variation on the cube; several are Time Cube builder presets, so they must stay loadable. |
| `timeCubeLongExposure` | Time cube: long exposure | 2 | 5 | 2 | 2 | 1.68 | Variation on the cube; several are Time Cube builder presets, so they must stay loadable. |
| `timeCubeKey` | Time cube: isolate a colour | 3 | 5 | 2 | 2 | 3.29 | Variation on the cube; several are Time Cube builder presets, so they must stay loadable. |
| `timeCubeTwisted` | Time cube: twisted time | 3 | 5 | 2 | 2 | 1.68 | Variation on the cube; several are Time Cube builder presets, so they must stay loadable. |
| `timeCubeTrain` | Time cube: time train | 4 | 5 | 2 | 2 | 2.13 | Variation on the cube; several are Time Cube builder presets, so they must stay loadable. |
| `timeCubeSceneSpace` | Time cube: Repeat Scene and 3D warps | 4 | 5 | 2 | 2 | 2.63 | Variation on the cube; several are Time Cube builder presets, so they must stay loadable. |

### Frame Stack

*From:* Frame Stack (7). Builder presets use these too.

**Keep**

| Key | Title | Feature | Look | Clarity | Nodes / notes | GPU ms | Why |
|---|---|---|---:|---:|---|---:|---|
| `frameStackRing` | Frame stack: ring of frames | Ring of frames | 4 | 5 | 4 / 4 | 0.96 |  |
| `frameStackFocus` | Frame stack: ring in shallow focus | Shallow focus | 5 | 5 | 4 / 4 | 1.3 | Best-looking. |
| `frameStackShuffle` | Frame stack: shuffle the contact sheet | Contact sheet shuffle | 4 | 5 | 4 / 4 | 0.42 |  |
| `frameStackIsometric` | Frame stack: isometric cards | Isometric cards on white | 3 | 5 | 4 / 4 | 0.57 |  |
| `frameStackMorph` | Frame stack: stack to ring | Stack to ring (Stagger) | 4 | 5 | 4 / 4 | 1.07 |  |

**Retire from the list** (2)

| Key | Title | Look | Clarity | Feature | Dup | GPU ms | Reason |
|---|---|---:|---:|---:|---:|---:|---|
| `frameStackDrift` | Frame stack: drift apart and back | 2 | 5 | 2 | 2 | 1.05 | Variation; frameStackDrift is a builder preset. |
| `frameStackHighlights` | Frame stack: highlighted frames loop | 2 | 5 | 2 | 2 | 0.69 | Variation; frameStackDrift is a builder preset. |

### From the Internet (kept as is, user)

Excluded from trimming by the user. Listed for completeness: `fcTrippyNoise` (Web: Trippy Noise, 1.08 ms), `fcSolar` (Web: Solar, 0.24 ms), `fcPillars` (Web: Pillars, 0.26 ms), `fcGradient4` (Web: Gradient 4, 0.31 ms), `fcGrainGradient` (Web: Grain Gradient, 0.32 ms), `fcTiling` (Web: Rotating Cross Tiles, 0.28 ms), `fcTheScreen` (Web: The Screen, 0.78 ms), `fcShield` (Web: Shield, 0.42 ms), `fcMainFrame` (Web: Main Frame, 1.01 ms), `fcAtlantic` (Web: Atlantic, 6.85 ms), `fcOrb` (Web: Orb, 3.33 ms), `fcBitshift` (Web: Bitshift, 0.35 ms).

## References the build phase must handle

Retired examples keep their code and stay loadable by key. These places name a retired key:

**User-facing (repoint or keep loadable):**

- **Start sheet** (`src/components/learn/StartSheet.tsx` FEATURED_EXAMPLES = learnFBM, particleGalaxy, agentParticles, learn3dLight, echoTrails, playGlowText): `echoTrails` and `playGlowText` are retired from the list → repoint to `raysLightText` and `displaceText` (or keep them loadable; the sheet opens by key).
- **Present lessons** (`src/present/samples.ts`, `teachingSamples.ts`, `sample.ts`, `agentsSample.ts`, `links.ts` EXAMPLE_PRESENTATION_LINKS): use many course steps (learn*, play*, script*, matrix*, finish*, convert*, agent*). They load by key, so they keep working if retired keys stay loadable. Stills: learnLoop, playLfo, learnPalette, playGlowText, scriptGlow, finishGrade are retired from the list but fine as stills.
- **Time Cube builder presets** (`src/timeCubeBuilder/presets.ts`) load timeCube*/frameStack* examples as templates: must stay loadable.
- **What’s new links** (`src/changelog/releases.ts`, kind `example`): 48 keys; retired ones keep working only if loadable. `docs/release-notes.md` mentions handPaths.
- **Dev harness**: `src/main.tsx` / `src/lib/contextLossCheck.ts` default to `agentRulesSlime` (retired from the list; keep loadable).

**Tests that assert folder contents (will need updating with the new taxonomy):**

- `src/store/__tests__/examples.test.ts`: every example filed in exactly one folder unless hidden → add a RETIRED list next to HIDDEN_EXAMPLE_KEYS; Play folder first and numbered (PLAY_EXAMPLE_KEYS).
- Folder-label/keys checks: `agentRules.test.ts` (“Agents: rules”), `pictures3d.test.ts` (“3D: Pictures”), `audioTools.test.ts` (“Audio”), `agentRidePath.test.ts` (“Simulation”), `fourD.test.ts` (“4D”), `gridRulesExamples.test.ts` + `simGridExamples.test.ts` (“Simulations: grids”), `pictureExamples.test.ts` (“Pictures”), `radialFastBlur.test.ts` (“Effects & Lens”), `textureTools.test.ts` (“Texture tools”), `simAgentExamples.test.ts` (“Simulations: agents”), `exprLoop.test.ts` (“Functions”), `notOffered.test.ts`.
- Tests that load retired keys directly (fine while loadable): `goldenShaders.test.ts`, `catalogueSweep.test.ts`, `gpuParticlesChladni.test.ts`, `timeCubeStyle/Space.test.ts`, `p5Examples.test.ts`, `embedLite.test.ts`, `controlsDensity.test.tsx`, `agentShapes.test.ts`, `presentation.test.ts`, `Credit.test.tsx`, and others listed per key below.
- Derived corpora `src/codeExplorer/prebuilt/examples.json` and `src/exprBuilder/prebuilt/moves.json` index 159 examples; regenerate or leave (they read code, not the list). `tools/overflow-sweep.mjs` lists 46 keys.

**Per retired key (excluding derived corpora and tools):**

- `playControls` — present/learn: `src/present/samples.ts`, `src/present/links.ts`, `src/present/teachingSamples.ts`; test: `src/components/play/__tests__/controlsDensity.test.tsx`
- `playMouse` — present/learn: `src/present/samples.ts`, `src/present/links.ts`, `src/present/teachingSamples.ts`
- `playLfo` — present/learn: `src/present/samples.ts`, `src/present/sample.ts`, `src/present/links.ts`, `src/present/teachingSamples.ts`
- `playExprKnob` — release-notes: `src/changelog/releases.ts`
- `playKeys` — present/learn: `src/present/samples.ts`, `src/present/links.ts`, `src/present/teachingSamples.ts`
- `playAudioReaders` — release-notes: `src/changelog/releases.ts`
- `playMidi` — test: `src/components/play/__tests__/controlsDensity.test.tsx`
- `playPadGrid` — release-notes: `src/changelog/releases.ts`
- `playNull` — present/learn: `src/present/samples.ts`, `src/present/links.ts`
- `playProximity` — release-notes: `src/changelog/releases.ts`
- `playConditions` — release-notes: `src/changelog/releases.ts`; doc: `docs/conditions-and-signals.md`
- `playPairs` — release-notes: `src/changelog/releases.ts`; doc: `docs/conditions-and-signals.md`
- `playIncrement` — release-notes: `src/changelog/releases.ts`; doc: `docs/increment-mapping.md`
- `playVideoSound` — release-notes: `src/changelog/releases.ts`
- `playMultiply` — release-notes: `src/changelog/releases.ts`
- `playChase` — doc: `docs/relationship-layer.md`
- `playOrbit` — doc: `docs/relationship-layer.md`
- `playBoids` — release-notes: `src/changelog/releases.ts`; doc: `docs/agents-layer.md`
- `playPredatorPrey` — doc: `docs/agents-layer.md`
- `playGlowText` — present/learn: `src/present/samples.ts`, `src/present/links.ts`, `src/present/teachingSamples.ts`; code: `src/components/learn/StartSheet.tsx`
- `scriptFirst` — present/learn: `src/present/samples.ts`, `src/present/links.ts`, `src/present/teachingSamples.ts`; release-notes: `src/changelog/releases.ts`
- `script3DShapes` — release-notes: `src/changelog/releases.ts`
- `scriptMouse` — present/learn: `src/present/samples.ts`, `src/present/links.ts`
- `scriptPicture` — present/learn: `src/present/samples.ts`, `src/present/links.ts`
- `scriptButtons` — present/learn: `src/present/samples.ts`, `src/present/links.ts`
- `scriptParticles` — present/learn: `src/present/samples.ts`, `src/present/links.ts`
- `scriptP5` — present/learn: `src/present/samples.ts`, `src/present/links.ts`
- `p5MultiFile` — release-notes: `src/changelog/releases.ts`; test: `src/play/__tests__/p5Examples.test.ts`
- `p5Webgl` — test: `src/play/__tests__/p5Examples.test.ts`
- `scriptGlow` — present/learn: `src/present/samples.ts`, `src/present/links.ts`
- `maskReveal` — release-notes: `src/changelog/releases.ts`
- `handFingertips` — release-notes: `src/changelog/releases.ts`
- `handPaths` — release-notes: `src/changelog/releases.ts`; doc: `docs/release-notes.md`
- `playTake` — present/learn: `src/present/samples.ts`, `src/present/links.ts`, `src/present/teachingSamples.ts`; release-notes: `src/changelog/releases.ts`
- `finishGrade` — present/learn: `src/present/samples.ts`; release-notes: `src/changelog/releases.ts`
- `finishLooks` — present/learn: `src/present/samples.ts`
- `finishScreen` — present/learn: `src/present/samples.ts`
- `finishHalation` — present/learn: `src/present/samples.ts`; release-notes: `src/changelog/releases.ts`; doc: `docs/finish-stack.md`
- `finishTime` — present/learn: `src/present/samples.ts`; release-notes: `src/changelog/releases.ts`
- `finishPrint` — release-notes: `src/changelog/releases.ts`
- `finishDatamoshEcho` — release-notes: `src/changelog/releases.ts`
- `drumPads` — release-notes: `src/changelog/releases.ts`; code: `src/play/exportHtml.ts`; test: `src/play/__tests__/embedLite.test.ts`
- `granulator` — release-notes: `src/changelog/releases.ts`; test: `src/lib/__tests__/tape.test.ts`, `src/play/__tests__/engineView.test.ts`, `src/play/__tests__/granulatorModes.test.ts`, `src/play/__tests__/grainGroups.test.ts`, `src/play/__tests__/granulator.test.ts`, `src/play/__tests__/rackPresets.test.ts`, `src/play/__tests__/rackMacros.test.ts`, `src/play/__tests__/embedLite.test.ts`, `src/play/__tests__/arrangement.test.ts`; doc: `docs/granulator.md`
- `audioEffects` — release-notes: `src/changelog/releases.ts`
- `pianoRollScale` — release-notes: `src/changelog/releases.ts`
- `granulatorSpectral` — release-notes: `src/changelog/releases.ts`
- `particleGlow` — release-notes: `src/changelog/releases.ts`
- `lookBuilt` — release-notes: `src/changelog/releases.ts`; doc: `docs/finish-stack.md`
- `finishWater` — release-notes: `src/changelog/releases.ts`
- `agentsHandBeat` — present/learn: `src/present/agentsSample.ts`, `src/present/links.ts`; doc: `docs/agents-plan.md`
- `waterLayer` — code: `src/play/exportHtml.ts`
- `learnColour` — present/learn: `src/present/links.ts`, `src/present/teachingSamples.ts`; release-notes: `src/changelog/releases.ts`
- `learnTime` — present/learn: `src/present/teachingSamples.ts`
- `learnUV` — present/learn: `src/present/links.ts`, `src/present/teachingSamples.ts`
- `learnStep` — present/learn: `src/present/links.ts`, `src/present/teachingSamples.ts`; test: `src/present/__tests__/exportPresentation.test.ts`
- `learnHSB` — present/learn: `src/present/links.ts`, `src/present/teachingSamples.ts`
- `learnCircle` — present/learn: `src/present/links.ts`, `src/present/teachingSamples.ts`
- `learnRotate` — present/learn: `src/present/links.ts`, `src/present/teachingSamples.ts`
- `learnTiling` — present/learn: `src/present/links.ts`, `src/present/teachingSamples.ts`
- `learnRandomGrid` — present/learn: `src/present/links.ts`, `src/present/teachingSamples.ts`
- `learnNoise` — present/learn: `src/present/links.ts`, `src/present/teachingSamples.ts`
- `learnLoop` — present/learn: `src/present/samples.ts`, `src/present/links.ts`, `src/present/teachingSamples.ts`
- `learnRaymarch` — test: `src/nodes/__tests__/catalogueSweep.test.ts`, `src/store/__tests__/learnExamples.test.ts`; code: `src/store/useNodeGraphStore.ts`
- `learn3dCamera` — present/learn: `src/present/sample.ts`, `src/present/links.ts`
- `learn3dDistance` — present/learn: `src/present/sample.ts`, `src/present/links.ts`
- `repeatSceneCentrepiece` — release-notes: `src/changelog/releases.ts`
- `sb2DepthSize` — test: `src/sceneBuilder2d/__tests__/depth.test.ts`
- `fourDTesseractSlice` — test: `src/nodes/__tests__/convertMarchLoop.test.ts`, `src/nodes/recipes/__tests__/lightRecipes.test.ts`, `src/compiler/__tests__/volumetricPorts.test.ts`, `src/compiler/__tests__/fourDSlices.test.ts`
- `fourDThreeSlices` — test: `src/compiler/__tests__/volumetricPorts.test.ts`
- `particleCymatics3d` — test: `src/nodes/__tests__/catalogueSweep.test.ts`, `src/play/__tests__/gpuParticlesChladni.test.ts`
- `particleFlowIntoShape` — test: `src/play/__tests__/gpuParticlesChladni.test.ts`
- `inkInWater` — release-notes: `src/changelog/releases.ts`
- `particleImageDissolve` — test: `src/codeExplorer/__tests__/explorer.test.ts`; release-notes: `src/changelog/releases.ts`
- `agentAnts` — present/learn: `src/present/agentsSample.ts`, `src/present/links.ts`; doc: `docs/agents-plan.md`
- `agentBoids` — present/learn: `src/present/agentsSample.ts`, `src/present/links.ts`; doc: `docs/agents-plan.md`
- `agentStrands` — present/learn: `src/present/agentsSample.ts`, `src/present/links.ts`; doc: `docs/agents-plan.md`
- `agentGrowPicture` — present/learn: `src/present/agentsSample.ts`, `src/present/links.ts`; doc: `docs/agents-plan.md`
- `agentGalaxy` — doc: `docs/agents-plan.md`
- `agentMycelium` — doc: `docs/agents-plan.md`
- `agentSandPlate` — doc: `docs/agents-plan.md`
- `agentRuleSlime` — present/learn: `src/present/agentsSample.ts`, `src/present/links.ts`; test: `src/present/__tests__/presentation.test.ts`
- `agentShaderFeedback` — test: `src/compiler/__tests__/agentShaderExamples.test.ts`
- `agentShaderOutlines` — release-notes: `src/changelog/releases.ts`; test: `src/compiler/__tests__/agentShaderExamples.test.ts`
- `agentShaderSoundRings` — test: `src/compiler/__tests__/agentShaderExamples.test.ts`
- `agent3dFlock` — test: `src/compiler/__tests__/agents3dCollide.test.ts`
- `agent3dVoxelSlime` — test: `src/lib/__tests__/agentShapes.test.ts`, `src/compiler/__tests__/agents3dCollide.test.ts`
- `agent3dCubeStorm` — test: `src/lib/__tests__/agentShapes.test.ts`, `src/compiler/__tests__/agents3dCollide.test.ts`
- `agent3dReverse` — test: `src/compiler/__tests__/agents3dCollide.test.ts`
- `agentRulesSlime` — code: `src/main.tsx`, `src/lib/contextLossCheck.ts`
- `simAgentPredatorPrey` — test: `src/compiler/__tests__/simAgentExamples.test.ts`
- `simAgentDla` — test: `src/compiler/__tests__/simAgentExamples.test.ts`
- `simAgentCrowd` — test: `src/compiler/__tests__/simAgentExamples.test.ts`
- `simAgentPainters` — test: `src/compiler/__tests__/simAgentExamples.test.ts`
- `simAgentTermites` — test: `src/compiler/__tests__/simAgentExamples.test.ts`
- `simAgentFireflies` — test: `src/compiler/__tests__/simAgentExamples.test.ts`
- `simAgentInfection` — test: `src/compiler/__tests__/simAgentExamples.test.ts`
- `passBlurGroup` — test: `src/compiler/__tests__/passP7.test.ts`
- `echoTrails` — code: `src/components/learn/StartSheet.tsx`
- `ttFeedbackFlow` — test: `src/compiler/__tests__/textureFeedback.test.ts`
- `ttFeedbackCamera` — test: `src/compiler/__tests__/textureFeedback.test.ts`
- `ttDeepGlow` — test: `src/nodes/__tests__/catalogueSweep.test.ts`
- `ttDisplaceNoise` — test: `src/nodes/__tests__/catalogueSweep.test.ts`
- `gridTourBuiltIn` — release-notes: `src/changelog/releases.ts`
- `learnGridPattern` — present/learn: `src/present/teachingSamples.ts`
- `matrixWhatItDoes` — present/learn: `src/present/samples.ts`, `src/present/links.ts`
- `matrixCombineUndo` — present/learn: `src/present/samples.ts`, `src/present/links.ts`
- `matrixColor` — present/learn: `src/present/samples.ts`, `src/present/links.ts`
- `comboChaosStars` — test: `src/components/ui/__tests__/Credit.test.tsx`
- `comboTurbulenceGlow` — test: `src/components/ui/__tests__/Credit.test.tsx`
- `comboBloomDots` — test: `src/components/ui/__tests__/Credit.test.tsx`
- `comboGridPaintShapes` — present/learn: `src/present/links.ts`, `src/present/teachingSamples.ts`
- `comboGridShapeByWire` — present/learn: `src/present/links.ts`, `src/present/teachingSamples.ts`
- `comboArrayGroupMoons` — present/learn: `src/present/links.ts`, `src/present/teachingSamples.ts`
- `dataWeatherYear` — release-notes: `src/changelog/releases.ts`
- `audioFilterSweep` — test: `src/compiler/__tests__/audioField.test.ts`
- `audioResonatorRings` — test: `src/compiler/__tests__/audioField.test.ts`
- `audioHitBand` — test: `src/nodes/__tests__/catalogueSweep.test.ts`
- `groupCarryFBM` — test: `src/compiler/__tests__/registry.test.ts`
- `convertCircle` — present/learn: `src/present/links.ts`, `src/present/teachingSamples.ts`
- `learnShape` — present/learn: `src/present/teachingSamples.ts`
- `learnPalette` — present/learn: `src/present/samples.ts`, `src/present/teachingSamples.ts`
- `gravitationalLens` — test: `src/nodes/definitions/__tests__/paramSockets.test.ts`, `src/compiler/__tests__/registry.test.ts`
- `curveTraceLive` — release-notes: `src/changelog/releases.ts`
- `curveTracePen` — release-notes: `src/changelog/releases.ts`
- `agentRidePath` — test: `src/compiler/__tests__/agentRidePath.test.ts`, `src/compiler/__tests__/audioField.test.ts`
- `agentRideMorph` — test: `src/compiler/__tests__/agentRidePath.test.ts`
- `curveTraceKnot` — release-notes: `src/changelog/releases.ts`
- `agentRulesScan` — test: `src/agentBuilder/__tests__/memory.test.ts`
- `timeCubeFlow` — code: `src/timeCubeBuilder/presets.ts`; test: `src/lib/timeCube/__tests__/timeCubeStyle.test.ts`
- `timeCubePulse` — test: `src/lib/timeCube/__tests__/timeCubeStyle.test.ts`
- `timeCubeFlyThrough` — test: `src/lib/timeCube/__tests__/timeCubeStyle.test.ts`
- `timeCubeLongExposure` — code: `src/timeCubeBuilder/presets.ts`; test: `src/lib/timeCube/__tests__/timeCubeStyle.test.ts`
- `timeCubeKey` — code: `src/timeCubeBuilder/presets.ts`
- `timeCubeTwisted` — code: `src/timeCubeBuilder/presets.ts`; test: `src/lib/timeCube/__tests__/timeCubeSpace.test.ts`
- `timeCubeTrain` — code: `src/timeCubeBuilder/presets.ts`; test: `src/lib/timeCube/__tests__/timeCubeSpace.test.ts`
- `timeCubeSceneSpace` — test: `src/lib/timeCube/__tests__/timeCubeSpace.test.ts`
- `frameStackDrift` — code: `src/timeCubeBuilder/presets.ts`

## Other findings

- **Heaviest (GPU ms):** `simAgentCrowd` 18.84, `curveTraceKnot` 14.36, `inkInWater` 12.69, `particleCymatics3d` 11.89, `particleFlowIntoShape` 10.11, `agentRulesScan3d` 9.81, `simAgentPredatorPrey` 9.78, `agent3dVoxelSlime` 9.71, `agentRulesScan` 9.22, `agentShaderFeedback` 8.7, `particlesRoundShape` 8.53, `fourD24CellWireframe` 8.04.
- **Render problems seen at 3 s:** `simAgentFireflies` is a white frame, `agentRulesFireflies` near-black, `ttOpticalFlow` and `agent3dReverse` blow out to white, `beatGrid` shows a flat red BEAT card in Studio, `memFollow` and all ten Audio examples are empty until there is mouse or sound input, `gravitationalLens` draws a Mandelbrot.
- **Uncommented keeps** (the app rule is that examples are commented): `voxelTerrain`, `litStillLife`, `giSphereGround`, `glassMetaballs`, `cmykNoise`, `crtTv`, `comboDomeRepeat`, `comboRepeatCellHash`, `midiGlowKeys`, `publishAndKeyframes`, `fractalRings`, `colorStopsCycle`, `spaceAtlas`, `neonFloorGrid`, `newtonFractalZ5`, `chladniModeFreqDemo`. The build phase should add node notes to these.
- **Visual monotony:** Play 01–24 share one glow-dot graph; 18 of 23 Texture tools use the same Ball action clip; 9 of 15 4D examples sit on the same checker floor.
- The HTML version with thumbnails (keep cards, retire lists, new ideas) and the 496 thumbnails, contact sheets and raw results were written to the session scratchpad, not the repo: `…/scratchpad/examples-curation/proposal.html` (thumbs/, sheets/, results.json, inventory.json beside it).
