# Starter recipes

When you add certain nodes, a small card appears beside the new node: **"Set up Grid?"**, with
2–3 one-click setups for common goals, **Just the node**, and **Don't ask for this node again**.
Nothing happens unless you pick a recipe. Esc, a click anywhere else, or adding another node
closes the card and leaves just the node. Picking one adds a handful of helper nodes in free space
beside the new node, wires them in, gives every added node a note (what it does and why it is
there), and puts the result on the Output. It is one undo step: undo goes back to just the node.

Recipes are meant to get you started, not to finish the job: a few nodes and a clear, simple
picture you can then change.

## How it works

| Piece | Where |
|---|---|
| Recipe shape: `{ id, label, description, build(ctx) }`; `build` returns helper nodes (positions relative to the new node), wires into the new node, params for it, and what goes on the Output | `src/nodes/recipes/types.ts` |
| The registry, keyed by node type (`recipesFor(type)`) | `src/nodes/recipes/index.ts` |
| Applying one: fresh ids, free-space placement (cards slide down past any card in the way, columns kept), wires (an input the node already has wired keeps its wire), a note on the new node only when it has none, an Output added when the graph has none | `src/nodes/recipes/apply.ts` |
| The offer: which node has one open, the node types turned off (localStorage `shader-studio:settings:starterRecipesOff`, listed under App settings → Studio as "Starter recipes turned off" and resettable there) | `src/store/recipeOfferStore.ts` |
| Opening it: `addNode` after a plain add on the top level (node browser, search, drag from the palette, wire-drop and Smart connect quick-adds). Not for adds made by code with params, nor inside a group | `src/store/useNodeGraphStore.ts` |
| Running one: `applyStarterRecipe(nodeId, recipeId)`: one undo step, compile, a toast saying what was added | `src/store/useNodeGraphStore.ts` |
| The card | `src/components/NodeGraph/RecipeOffer.tsx` |

The card follows the node as the view pans and zooms (right of it, else left, kept on screen). It
takes no focus and has no scrim, so typing and dragging carry on. A node added from search with
recipes shows the recipe card instead of the Smart connect suggestions (one popover at a time).

### The existing setup offers

- **Agents group** asks Particles / Slime (with a Trail) / Empty group in a modal before anything
  is added (`askChoice` in `addNode`, `store/agentSetup.ts`). Moving it to this card would change
  behaviour (the group would be added first, and the question would no longer be in the way), so
  it stays as it is. The recipe card uses the same look at popover size: the accent-tinted icon
  tile, title, a muted line, ghost dismissal.
- **3D shapes and scenes** are wrapped in a Scene Group with a camera and march loop
  automatically (`nodes/smart3d.ts`); that work is being reworked separately, so 3D and
  volumetric nodes have no recipes here. The mechanism is generic, so the 3D offer can move onto
  it later (register recipes for the 3D types and drop the automatic wrap).

## Survey

For each node family: what it is usually combined with, the recipe graph, why it helps. **Built**
means it ships in this change.

### Grid (`gridLayout`): Built

The Grid node only cuts the picture into cells; on its own it shows nothing, and the first shape
drawn in Cell UV is clipped at the cell edge as soon as it is displaced or grows.

| Recipe | Graph | Why |
|---|---|---|
| Shapes don't clip | Grid (Cell UV, Cell ID) → Neighbour Dist (Disp Scale 0.45) → Offset (−0.42: the radius) → SDF Fill (Color) → Output | Neighbour Dist looks at the 8 surrounding cells too, so scattered dots stay round across cell borders. The Offset is the shape size to change later |
| Per-cell variation | Cell ID → Noise Float (Hash, 0.12…0.44) → Circle SDF radius (in Cell UV) and → Palette → SDF Fill | One random number per cell varies every cell |
| A wave across the cells | Dist to Center → Wave Radius (Time inside) → Circle SDF radius and Palette → SDF Fill | Per-cell numbers make a pattern bigger than a cell |

### Grid Pattern (`gridPattern`): Built

The all-in-one grid. Its field sockets (Shape, Picture) are powerful but not discoverable.

| Recipe | Graph | Why |
|---|---|---|
| The mouse grows the shapes | Mouse → Affect Pos; Affect Grow, Overflow Neighbours | Shows the affect point and why Overflow exists |
| Per-cell colours | Cell → Noise Float (Hash) → Palette → Picture | Shows the Cell node inside a field chain |
| A wave across the cells | Cell → Length → Wave Radius → Circle SDF → Shape; wave → Palette → Picture | A wired shape, sized per cell (the Grid 4 example, shorter) |

### Noise: Fractal Noise, Noise Float, Wave Texture (`fbm`, `noiseFloat`, `waveTexture`): Built

Greyscale and frozen until Time is wired, which is the first surprise.

| Recipe | Graph | Why |
|---|---|---|
| Coloured and drifting | Time → noise Time (Speed set) → Palette → Output | The two things noise almost always needs |
| Marbled (domain warp) | Time → Domain Warp → noise UV → Palette | The classic organic look |

### Voronoi (`voronoi`): Built

| Recipe | Graph | Why |
|---|---|---|
| Coloured and drifting | as noise | |
| Glowing seeds | Time → Voronoi; Distance → SDF Glow (Tinted) | Distance is 0 at the seeds: a quick, striking use of the distance output |

### Palette (`palette`): Built

A Palette with nothing in Angle is one flat colour.

| Recipe | Graph | Why |
|---|---|---|
| Radial rainbow | UV → Length → Angle; Time → Angle offset | The canonical palette demo |
| Colour some noise | Time → Fractal Noise → Angle | Noise is what palettes most often colour |

### 2D shapes: Circle, Box, Ring, Shape, Simple SDF: Built

A distance field is invisible (or a grey gradient) until something paints it.

| Recipe | Graph | Why |
|---|---|---|
| Filled, with an outline | Color ×2 → SDF Fill (Stroke 0.02) | Fill / stroke / background |
| Neon outline | Abs → SDF Glow (Tinted) | The other common output; Abs keeps the light on the edge instead of filling the inside |
| Repeated in a grid | UV → Tile (4) → shape position; Color → SDF Fill | Domain repetition in one step |

### SDF combiners: Union, Subtract, Intersect: Built

One recipe each, worded for what the combiner does: Union "Two shapes, melted together",
Subtract "Cut a box out of a circle", Intersect "Where two shapes overlap".

| Recipe | Graph | Why |
|---|---|---|
| (per combiner, above) | Circle SDF → A, Box SDF → B (overlapping), K 0.12; Color → SDF Fill | A combiner needs two shapes to show anything |

### Tile and Repeat (`fract`, `infiniteRepeatSpace`, `mirroredRepeat2D`, `limitedRepeat2D`): Built

| Recipe | Graph | Why |
|---|---|---|
| A shape in every tile | UV → repeat → Circle SDF → SDF Fill | Repetition only shows with a shape after it |
| Per-tile variation (the Repeat nodes, which have Cell ID) | Cell ID → Noise Float (Hash) → radius and Palette | Same idea as the Grid's |

### Kaleidoscope (`kaleidoSpace`): Built

Its input is (0, 0) when unwired, so on its own it does nothing visible.

| Recipe | Graph | Why |
|---|---|---|
| Kaleidoscope of noise | UV → Kaleidoscope (Time × 0.1 → Rotate) → Fractal Noise → Palette | A turning mandala |
| Mandala of dots | UV → Kaleidoscope → off-centre Circle SDF → SDF Glow | Shows what folding does to one shape |

### Polar Space (`polarSpace`): Built

| Recipe | Graph | Why |
|---|---|---|
| Spiral stripes | UV → Polar (Twist 2) → Wave Texture (X stripes, Scale 2π × 3, Time) → Palette | Straight stripes become rays, Twist makes a spiral; a Scale that is a multiple of 2π leaves no seam |

### Previous Frame (feedback) (`prevFrame`): Built

Feedback needs a decay and something new each frame, or it is black / frozen.

| Recipe | Graph | Why |
|---|---|---|
| Trails behind the mouse | Mouse → Circle SDF → SDF Glow; Expression `max(last × 0.96, now)` | Decay + new content, the minimum loop |
| Drifting smear | UV → UV Transform (×0.985, 0.02 rad) → Previous Frame UV; Time → Noise → Palette; Mix 8% | Drift + decay, the classic swirl |

### Pass (`pass`): Built

A Pass does nothing visible by itself; it exists for the texture nodes after it. Its picture is
what the Output showed (or a stand-in noise picture when nothing).

| Recipe | Graph | Why |
|---|---|---|
| Glow | picture → Pass → Glow (texture) → Add Colors (picture + glow) | The most common chain |
| Soft blur | Pass → Blur (texture) | |
| Outlines | picture → Posterize → Pass → Edges (texture) | Flat bands give clean edges |

### Particles (`gpuParticles`): Built

| Recipe | Graph | Why |
|---|---|---|
| Over the picture | what the Output showed (or stand-in) → Over | Particles usually sit on something |
| Follow the mouse | Mouse → Emitter | The first interactive thing people try |

(The Particles card also has its own presets; the recipes only wire it in.)

### Audio Input (`audioInput`): Built

| Recipe | Graph | Why |
|---|---|---|
| Pulse a shape to the sound | Band → Remap (0…1 → 0.18…0.5) → Circle SDF radius → SDF Glow | Level → mapping → visual, the basic audio-reactive chain. The circle is visible in silence |

### LFO (`lfo`): Built

| Recipe | Graph | Why |
|---|---|---|
| Breathe a shape | LFO → Remap (−1…1 → 0.15…0.45) → Circle SDF → SDF Fill | An LFO only shows once it drives something |

### Print Text (`printText`): Built

| Recipe | Graph | Why |
|---|---|---|
| Coloured title | Mask → Colorize | The node only gives a mask |

### Picture effects: Bloom, Vignette, Grain, Tone Map, Chroma Shift, Saturation, Hue Rotate, Posterize, Scanlines, Brightness / Contrast, Tone Curve, Invert, CMYK Halftone: Built

| Recipe | Graph | Why |
|---|---|---|
| Apply to the picture | what the Output showed → effect → Output (stand-in noise when nothing) | These always go at the end of a chain; wiring them in is the whole job |

### Agents group: existing (kept)

Particles / Slime (with a Trail) / Empty group, asked before the add (see above).

### 3D shapes, scenes, volumetrics: existing (kept, being reworked separately)

### Not built yet: next candidates

| Node | Recipe idea | Why it waits |
|---|---|---|
| Texture Input / Video Input | Fit (cover / contain) via the node's Fit, Pixelate, Halftone, Edges via a Pass | Needs a picture loaded to look like anything; best with a sample image |
| Time | "Speed" (× k), "Loop every N s" (mod), "Ping-pong 0…1" (sin → remap) | Time on its own drives nothing visible; better offered on a slider's right-click |
| Audio Input, smoothing | Envelope / smoothing node before the mapping | No dedicated smoothing node yet (Play mappings smooth) |
| Mandelbrot / Julia, Newton, IFS | Mouse → Julia C; Time → zoom | Already full pictures; recipes would be "make it interactive" |
| Truchet, Chladni, Electron Orbital | Palette on the field output; Time on a parameter | Complete generators; small gain |
| Field Accumulate / Metaball Threshold | Grid → Field Accumulate → Threshold → palette (a metaball grid) | Good teaching recipe; a few more params to tune |
| Domain Warp | → Fractal Noise → Palette (the reverse of Noise's Marbled) | Easy to add |
| Swirl / Ripple / UV Warp nodes | UV → warp → a stripe or checker picture, so the warp is visible | Easy to add |
| Ellipse SDF | the 2D shape recipes | Its size is socket-only (no sliders), so the defaults overflow a tile |
| Gradient, Color Ramp, Stops Palette | the Palette recipes (Angle from Length / noise) | Easy to add |
| Sobel Edges, Gaussian Blur, Motion Blur | Apply to the picture | Need a moving or detailed picture to read well |
| Agents group | Move its starter question onto this card | Behaviour change (see above) |
| 3D shapes | Move the Scene Group wrap onto this card | Being reworked separately |
