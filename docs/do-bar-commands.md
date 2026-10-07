# Do… bar commands

<!-- Generated from src/lang/commands.ts and src/lang/vocabulary.ts by `npm run docs:do-bar`. Don't edit by hand: a test fails when it is out of date. -->

The Do… bar (⌘K) reads a small command language: no AI, the same sentence always does the same thing.
A sentence is one or more **clauses**; each starts with a **verb**, names **objects** and **references**, and takes **modifiers**.
Clauses are joined by **connectors** ("then", ",", "and" before a verb) and each builds on what the last one made ("it").
Before Enter the preview lists every step with the nodes, wires and values it will make; a clause it can't read is marked, with "did you mean", and the rest still previews.
A whole sentence is one undo step, and wires are type-checked before anything changes.

```
sentence  := clause ( connector clause )*
connector := "," | ";" | "then" | "and then" | "and" (before a verb) | "after that" | "next" | "finally"
clause    := verb object? reference* modifier*      (edit verbs: connect, insert, multiply…)
           | shape-or-action-phrase                 (build phrases: "circle with a glow, falloff 8")
reference := pronoun | "quoted label" | [ordinal] type-name [number] | role | "the node before|after" reference
modifier  := param number | number param | colour | place | "by" number | "much" | "a bit"
```

In the app: the **?** in the Do… bar, or Keys → Do… bar commands. Every example can be tried in the bar or shown step by step.

The **builders** (the 3D Scene Builder, Grid Rules, Agent Rules) open from whole phrases: "new 3d scene", "new grid rules", "edit the rules", "show the recipe" (see Builders below). They are also the first section of the node browser and the empty-canvas right-click menu's Builders.

## Verbs: editing what is there

### create

Adds a shape (with its UV) or any node by name. Modifiers after it set its values; a value only a move has (falloff → Glow) adds that move. Leaves as "it": the new node (or the last move it made).

Words: `create`, `new`, `draw`, `make a`, `make an`, `add a`, `add an`, `place`

```
create <node> [with <param> <value>…] [at <place>]
```

| Slot | What |
|---|---|
| node | a shape word (circle, ring, star…) or a node name (noise, palette, Length…) |
| param value | radius 0.3, falloff 8, red… |

Examples:

- `create a ring with falloff 0.3` — on an empty graph (just an Output). A ring and an SDF Glow with Brightness 0.3
- `create a noise` — on an empty graph (just an Output)
- `add a star at the top left` — on UV → Circle SDF → SDF Fill → Output

### connect

Wires an output into an input. Without an input name it takes the first free input that fits; the type check runs first. Leaves as "it": the node that reads it.

Words: `connect`, `wire`, `plug`, `link`, `feed`, `hook up`, `attach`

```
connect <ref> to <ref> [<input>]
connect <ref> to the <input> of <ref>
plug <ref> into <ref>
```

| Slot | What |
|---|---|
| from | the node whose output goes |
| to | the node that reads it |
| input | an input by name (tint, distance, value…) |

Examples:

- `connect the glow to the output` — on Noise → Palette on the Output, plus an unwired Circle SDF, SDF Glow and a Smoothstep mask
- `connect the noise to the tint of the glow` — on Noise → Palette on the Output, plus an unwired Circle SDF, SDF Glow and a Smoothstep mask
- `plug the box into the fill` — on a Circle SDF and a Box SDF, the circle painted on the Output

### disconnect

Removes wires. "Disconnect X" removes the wires out of X (from the Output only, when X is the current output); "from Y" only those into Y; "the <input> of Y" clears one input. Leaves as "it": the node that was unplugged.

Words: `disconnect`, `unplug`, `unwire`, `unlink`, `detach`, `cut the wire from`

```
disconnect <ref> [from <ref>]
disconnect the <input> of <ref>
```

| Slot | What |
|---|---|
| ref | what to unplug |
| from | only the wires into this node |

Examples:

- `disconnect the current output` — on UV → Fractal Noise → Palette → Output
- `disconnect the noise from the palette` — on UV → Fractal Noise → Palette → Output
- `disconnect the position of the circle` — on UV → Circle SDF → SDF Fill → Output

### reconnect

Moves a node's outgoing wires: unplugs everything it feeds, then connects it to the new node. Leaves as "it": the node that reads it.

Words: `reconnect`, `rewire`, `move the wire from`, `reroute`

```
reconnect <ref> to <ref> [<input>]
```

| Slot | What |
|---|---|
| from | the node whose wires move |
| to | where they go |

Examples:

- `reconnect the circle to the output` — on UV → Circle SDF → SDF Glow → Output
- `rewire the noise to the output` — on UV → Fractal Noise → Palette → Output

### insert

Puts a new node on a wire: between two wired nodes, after a node (on every wire out of it) or before one (on its first wired input). Leaves as "it": the inserted node.

Words: `insert`, `put`, `slot`, `splice`

```
insert <node> between <ref> and <ref>
insert <node> after <ref>
insert <node> before <ref>
```

| Slot | What |
|---|---|
| node | the node to add (tone map, luminance, abs…) |
| between | two wired nodes |

Examples:

- `insert a tone map between the palette and the output` — on UV → Fractal Noise → Palette → Output
- `insert an abs after the circle` — on UV → Circle SDF → SDF Fill → Output
- `put a smoothstep before the palette` — on UV → Fractal Noise → Palette → Output

### multiply

Combines two values with a new node and puts the result where the first one (the base) went. "Add A to B" and "subtract A from B" use B as the base. Numbers work too ("multiply it by 2"). Leaves as "it": the new combining node.

Words: `multiply`, `times`, `add`, `subtract`, `divide`, `mix`, `blend`, `screen`, `overlay`, `union`, `merge`, `intersect`, `cut`

```
multiply <ref> by <ref|number>
add <ref> to <ref>
subtract <ref> from <ref>
mix <ref> with <ref> [by <number>]
screen <ref> over <ref>
union <ref> with <ref>
```

| Slot | What |
|---|---|
| a | the first value (the base) |
| b | the second value, or a number |
| by | mix amount |

Examples:

- `multiply the output with the noise` — on Noise → Palette on the Output, plus an unwired Circle SDF, SDF Glow and a Smoothstep mask. Palette × noise, on the Output
- `add the glow to the palette` — on Noise → Palette on the Output, plus an unwired Circle SDF, SDF Glow and a Smoothstep mask
- `mix the palette with the glow by 0.3` — on Noise → Palette on the Output, plus an unwired Circle SDF, SDF Glow and a Smoothstep mask

### output

Wires a node to the Output (adding an Output on the top level when there is none). Leaves as "it": the node shown.

Words: `output`, `show`, `display`, `send to the output`, `preview`

```
output <ref>
show <ref>
```

| Slot | What |
|---|---|
| ref | what to show |

Examples:

- `output the glow` — on Noise → Palette on the Output, plus an unwired Circle SDF, SDF Glow and a Smoothstep mask
- `show the noise` — on UV → Fractal Noise → Palette → Output

### replace

Switches a node to another type in place, keeping its wires and settings (the card's Switch to). Refused when a wire would have nowhere to go, with the types that would work. Leaves as "it": the switched node.

Words: `replace`, `switch`, `swap`, `turn`, `change`

```
replace <ref> with <node>
switch <ref> to <node>
turn <ref> into <node>
swap <ref> for <node>
```

| Slot | What |
|---|---|
| ref | the node to switch |
| node | the new type |

Examples:

- `switch the noise to voronoi` — on UV → Fractal Noise → Palette → Output
- `turn the circle into a box` — on UV → Circle SDF → SDF Fill → Output
- `replace the palette with a stops palette` — on UV → Fractal Noise → Palette → Output

### delete

Removes nodes and the wires into and out of them. Leaves as "it": nothing (the next "it" is the last thing before).

Words: `delete`, `remove`, `erase`, `get rid of`, `drop`

```
delete <ref>
delete all <node>s
```

| Slot | What |
|---|---|
| ref | one node, several ("these", "all circles") |

Examples:

- `delete the glow` — on Noise → Palette on the Output, plus an unwired Circle SDF, SDF Glow and a Smoothstep mask
- `remove all circles` — on a Circle SDF and a Box SDF, the circle painted on the Output

### rename

Gives a node a name of its own (its card label). Quote names with spaces. Leaves as "it": the renamed node.

Words: `rename`, `call`, `name`, `label`

```
rename <ref> to "<name>"
call <ref> "<name>"
```

| Slot | What |
|---|---|
| ref | the node |
| name | the new name |

Examples:

- `rename the glow to "Halo"` — on UV → Circle SDF → SDF Glow → Output
- `call the noise "Clouds"` — on UV → Fractal Noise → Palette → Output

### duplicate

Copies a node next to it, with the same settings and the same wires in (nothing reads the copy yet). Leaves as "it": the copy.

Words: `duplicate`, `copy`, `clone`

```
duplicate <ref>
```

| Slot | What |
|---|---|
| ref | the node to copy |

Examples:

- `duplicate the circle` — on UV → Circle SDF → SDF Fill → Output
- `copy the glow, then set its falloff to 3` — on UV → Circle SDF → SDF Glow → Output

### set

Sets a setting to a value: a number, a colour word, a choice by name, on or off. The setting is found by its name, its label or a vocabulary word (falloff, size, speed…). Leaves as "it": the node changed.

Words: `set`, `change`

```
set the <ref> <param> to <value>
set <param> of <ref> to <value>
set <ref>'s <param> to <value>
set the <param> to <value>
```

| Slot | What |
|---|---|
| ref | the node (else "it" or the selection) |
| param | a setting |
| value | number, colour, choice, on/off |

Examples:

- `set the glow falloff to 8` — on UV → Circle SDF → SDF Glow → Output
- `set the radius of the circle to 0.4` — on UV → Circle SDF → SDF Fill → Output
- `set the glow tint to cyan` — on UV → Circle SDF → SDF Glow → Output

### make

Relative changes: bigger / smaller (its size), brighter / dimmer, faster / slower, softer / sharper; "increase X by 0.1"; double, halve. Leaves as "it": the node changed.

Words: `make`, `increase`, `raise`, `decrease`, `lower`, `reduce`, `double`, `halve`, `triple`

```
make <ref> bigger|smaller|brighter|dimmer|faster|slower|softer|sharper
increase <ref>'s <param> [by <number>]
double the <param> of <ref>
```

| Slot | What |
|---|---|
| ref | the node |
| how | a direction word, or a setting and an amount |

Examples:

- `make the circle bigger` — on UV → Circle SDF → SDF Fill → Output. Radius × 1.25
- `make the glow much wider` — on UV → Circle SDF → SDF Glow → Output
- `increase the radius of the circle by 0.1` — on UV → Circle SDF → SDF Fill → Output

### group

Puts nodes into a group (as Group selection does). Goes last in a sentence. Leaves as "it": the group.

Words: `group`, `bundle`, `wrap up`

```
group <ref> [and <ref>…] [as "<name>"]
```

| Slot | What |
|---|---|
| refs | the nodes |
| as | the group's name |

Examples:

- `group the circle and the glow as "Neon"` — on UV → Circle SDF → SDF Glow → Output
- `group these` — on a Circle SDF and a Box SDF, the circle painted on the Output (two nodes selected)

### select

Selects nodes (no change to the graph), so the next command, or the next "this", works on them. Leaves as "it": the selection.

Words: `select`, `pick`, `find`, `highlight`

```
select <ref> [and <ref>…]
select all <node>s
```

| Slot | What |
|---|---|
| refs | the nodes |

Examples:

- `select all circles` — on a Circle SDF and a Box SDF, the circle painted on the Output
- `select the node before the output` — on UV → Fractal Noise → Palette → Output

### colour

Colours a value with a palette. "By <driver>" picks what runs along the palette (the length of the space, the angle, time, noise, any node) and multiplies it by the value; without "by" the value itself drives it. Leaves as "it": the palette (or what multiplies it).

Words: `colour`, `color`, `paint`, `shade`

```
colour <ref> with a palette [by <driver>]
colour <ref> by <driver>
```

| Slot | What |
|---|---|
| ref | the value to colour |
| driver | the length of the space · the angle · the x / y of the space · time · noise · <ref> |

Examples:

- `colour it with a palette by the length of the space` — on UV → Circle SDF → SDF Glow → Output (one node selected)
- `colour the noise with a palette` — on Noise → Palette on the Output, plus an unwired Circle SDF, SDF Glow and a Smoothstep mask
- `colour the glow by time` — on UV → Circle SDF → SDF Glow → Output

## Verbs: build actions

### glow

Light round a shape (SDF Glow); on a colour, Bloom; on a texture, Glow (texture).

Words: `glow`, `glowing`, `halo`, `neon`, `light up`, `shine`, `bloom`

```
glow [it | the space | the picture | <ref>] [<param> <value>] [<colour>]
```

Examples:

- `circle with a glow, falloff 8` — on an empty graph (just an Output)
- `glow it red` — on UV → Circle SDF → SDF Fill → Output (one node selected)

### rings

Lines at every step away from a shape.

Words: `rings`, `ripples`, `contours`, `iso lines`, `isolines`, `concentric`

```
rings [it | the space | the picture | <ref>] [<param> <value>] [<colour>]
```

Examples:

- `add 8 rings` — on UV → Circle SDF → SDF Fill → Output (one node selected)
- `ring with 12 rings` — on an empty graph (just an Output)

### outline

A line along a shape's edge (on a texture: Edges).

Words: `outline`, `outlined`, `border`, `edge line`, `stroke it`, `edges`

```
outline [it | the space | the picture | <ref>] [<param> <value>] [<colour>]
```

Examples:

- `outline it width 0.02` — on UV → Circle SDF → SDF Fill → Output (one node selected)
- `hexagon with an outline` — on an empty graph (just an Output)

### onion

Makes a shape a hollow shell.

Words: `onion`, `hollow`, `shell`

```
onion [it | the space | the picture | <ref>] [<param> <value>] [<colour>]
```

Examples:

- `make it hollow` — on UV → Circle SDF → SDF Fill → Output (one node selected)
- `a square with an onion 0.03` — on an empty graph (just an Output)

### round

Grows a shape (Offset).

Words: `round`, `rounded`, `grow`, `bigger`, `fatten`, `inflate`, `thicken`

```
round [it | the space | the picture | <ref>] [<param> <value>] [<colour>]
```

Examples:

- `rounder by 0.05` — on UV → Circle SDF → SDF Fill → Output (one node selected)
- `box, then round it 0.04` — on an empty graph (just an Output)

### blend

Smooth union with another shape.

Words: `blend`, `melt`, `merge`, `smooth union`, `smoothly blend`, `smooth min`, `smin`, `combine`, `join`

```
blend [it | the space | the picture | <ref>] [<param> <value>] [<colour>]
```

Examples:

- `blend it with a box` — on UV → Circle SDF → SDF Fill → Output (one node selected)
- `smoothly blend these` — on a Circle SDF and a Box SDF, the circle painted on the Output (two nodes selected)

### mask

A 0…1 mask from a shape (SDF Mask).

Words: `mask`, `cutout`, `stencil`

```
mask [it | the space | the picture | <ref>] [<param> <value>] [<colour>]
```

Examples:

- `mask` — on UV → Circle SDF → SDF Fill → Output (one node selected)
- `heart, then mask it` — on an empty graph (just an Output)

### warp

Noise warp in front of the space (Domain Warp).

Words: `warp`, `distort`, `wobble`, `noise`, `noisy`, `organic`, `marble`, `domain warp`

```
warp [it | the space | the picture | <ref>] [<param> <value>] [<colour>]
```

Examples:

- `warp it` — on UV → Circle SDF → SDF Fill → Output (one node selected)
- `warp the space 0.6` — on UV → Fractal Noise → Palette → Output (one node selected)

### swirl

Swirls the space.

Words: `swirl`, `vortex`, `whirl`, `spin`

```
swirl [it | the space | the picture | <ref>] [<param> <value>] [<colour>]
```

Examples:

- `swirl the space 3` — on UV → Circle SDF → SDF Fill → Output (one node selected)
- `star with a swirl` — on an empty graph (just an Output)

### twist

Twists the space (an Expression Block).

Words: `twist`, `twisted`, `spiral`

```
twist [it | the space | the picture | <ref>] [<param> <value>] [<colour>]
```

Examples:

- `twist the space 0.5` — on UV → Circle SDF → SDF Fill → Output (one node selected)
- `box, then twist it 2` — on an empty graph (just an Output)

### polar

Polar coordinates.

Words: `polar`, `radial`, `wrap around`

```
polar [it | the space | the picture | <ref>] [<param> <value>] [<colour>]
```

Examples:

- `polar` — on UV → Circle SDF → SDF Fill → Output (one node selected)
- `polar the noise` — on UV → Fractal Noise → Palette → Output

### mirror

Mirrors the space (x, y or both).

Words: `mirror`, `mirrored`, `symmetric`, `symmetry`, `reflect`, `flip`

```
mirror [it | the space | the picture | <ref>] [<param> <value>] [<colour>]
```

Examples:

- `mirror both ways` — on UV → Circle SDF → SDF Fill → Output (one node selected)
- `mirror it` — on UV → Fractal Noise → Palette → Output (one node selected)

### repeat

Tiles the space; "around" repeats round the centre.

Words: `repeat`, `tile`, `tiles`, `tiled`, `grid of`, `copies`, `duplicate`, `pattern`

```
repeat [it | the space | the picture | <ref>] [<param> <value>] [<colour>]
repeat … around (repeat-around)
```

Examples:

- `repeat 5 times` — on UV → Circle SDF → SDF Fill → Output (one node selected)
- `make it repeat 6 times around` — on UV → Circle SDF → SDF Fill → Output (one node selected)

### zoom

Zoom / rotate the space (UV Transform).

Words: `zoom`, `scale`, `rotate`, `turn`, `tilt`, `magnify`

```
zoom [it | the space | the picture | <ref>] [<param> <value>] [<colour>]
```

Examples:

- `rotate 45 degrees` — on UV → Circle SDF → SDF Fill → Output (one node selected)
- `zoom 2` — on UV → Fractal Noise → Palette → Output (one node selected)

### custom code

An Expression Block on the wire, for code of your own.

Words: `custom code`, `code`, `expression`, `my own`

```
custom code [it | the space | the picture | <ref>] [<param> <value>] [<colour>]
```

Examples:

- `custom code` — on UV → Circle SDF → SDF Fill → Output (one node selected)
- `custom code on the noise` — on UV → Fractal Noise → Palette → Output

### mix

Mixes a colour with another (OkLab Mix); "these" mixes two selected.

Words: `mix`, `mixed`, `tint`, `mix with`, `crossfade`

```
mix [it | the space | the picture | <ref>] [<param> <value>] [<colour>]
```

Examples:

- `mix with blue` — on UV → Fractal Noise → Palette → Output (one node selected)
- `mix these colours` — on Noise → Palette on the Output, plus an unwired Circle SDF, SDF Glow and a Smoothstep mask (two nodes selected)

### palette

Recolours by brightness; on a number, the number through a palette.

Words: `palette`, `colour it`, `color it`, `colorize`, `colourise`, `colourize`, `rainbow`, `recolour`, `recolor`, `gradient map`

```
palette [it | the space | the picture | <ref>] [<param> <value>] [<colour>]
```

Examples:

- `palette` — on UV → Fractal Noise → Palette → Output (one node selected)
- `colour it` — on UV → Fractal Noise → Palette → Output (one node selected)

### tone map

Brings bright values back into range (ACES).

Words: `tone map`, `tonemap`, `tone-map`, `tone mapping`, `aces`, `unclip`, `stop clipping`, `compress highlights`

```
tone map [it | the space | the picture | <ref>] [<param> <value>] [<colour>]
```

Examples:

- `tone map it` — on UV → Fractal Noise → Palette → Output (one node selected)
- `tone map the picture` — on UV → Circle SDF → SDF Glow → Output

### grade

Lift / Gamma / Gain.

Words: `grade`, `colour grade`, `color grade`, `lift gamma gain`, `look`

```
grade [it | the space | the picture | <ref>] [<param> <value>] [<colour>]
```

Examples:

- `grade it` — on UV → Fractal Noise → Palette → Output (one node selected)
- `colour grade the picture` — on UV → Circle SDF → SDF Glow → Output

### brighter

Raises brightness.

Words: `brighter`, `brighten`, `lighten`, `lift`, `exposure`

```
brighter [it | the space | the picture | <ref>] [<param> <value>] [<colour>]
```

Examples:

- `brighter by 0.3` — on UV → Fractal Noise → Palette → Output (one node selected)
- `brighten the picture` — on UV → Circle SDF → SDF Glow → Output

### grain

Film grain.

Words: `grain`, `film grain`, `dither`, `noise grain`, `grainy`

```
grain [it | the space | the picture | <ref>] [<param> <value>] [<colour>]
```

Examples:

- `add grain 0.1` — on UV → Fractal Noise → Palette → Output (one node selected)
- `grain the picture` — on UV → Circle SDF → SDF Glow → Output

### blend mode

Blend Modes (screen, overlay, multiply…).

Words: `blend mode`, `screen`, `overlay`, `layer`

```
blend mode [it | the space | the picture | <ref>] [<param> <value>] [<colour>]
```

Examples:

- `screen blend` — on UV → Fractal Noise → Palette → Output (one node selected)
- `overlay it` — on UV → Fractal Noise → Palette → Output (one node selected)

### soften

Softens a mask's edge.

Words: `soften`, `soft edge`, `soft`, `feather`, `smooth edge`, `antialias`, `anti alias`, `blur the edge`

```
soften [it | the space | the picture | <ref>] [<param> <value>] [<colour>]
```

Examples:

- `soften` — on Noise → Palette on the Output, plus an unwired Circle SDF, SDF Glow and a Smoothstep mask (one node selected)
- `feather it 0.3` — on Noise → Palette on the Output, plus an unwired Circle SDF, SDF Glow and a Smoothstep mask (one node selected)

### invert

Inverts a mask.

Words: `invert`, `inverse`, `negate`, `flip inside`

```
invert [it | the space | the picture | <ref>] [<param> <value>] [<colour>]
```

Examples:

- `invert` — on Noise → Palette on the Output, plus an unwired Circle SDF, SDF Glow and a Smoothstep mask (one node selected)
- `invert it` — on Noise → Palette on the Output, plus an unwired Circle SDF, SDF Glow and a Smoothstep mask (one node selected)

### grow the mask

Grows or shrinks a mask.

Words: `grow the mask`, `shrink`, `erode`, `dilate`

```
grow the mask [it | the space | the picture | <ref>] [<param> <value>] [<colour>]
```

Examples:

- `shrink` — on Noise → Palette on the Output, plus an unwired Circle SDF, SDF Glow and a Smoothstep mask (one node selected)
- `erode it 0.1` — on Noise → Palette on the Output, plus an unwired Circle SDF, SDF Glow and a Smoothstep mask (one node selected)

### mix two pictures

A mask picks between two pictures.

Words: `mix two pictures`, `two pictures`, `cut between`

```
mix two pictures [it | the space | the picture | <ref>] [<param> <value>] [<colour>]
```

Examples:

- `mix two pictures` — on Noise → Palette on the Output, plus an unwired Circle SDF, SDF Glow and a Smoothstep mask (one node selected)
- `cut between two pictures` — on Noise → Palette on the Output, plus an unwired Circle SDF, SDF Glow and a Smoothstep mask (one node selected)

### blur

Blurs a texture (a Pass).

Words: `blur`, `blurry`, `soft focus`, `defocus`

```
blur [it | the space | the picture | <ref>] [<param> <value>] [<colour>]
```

Examples:

- `blur it` — on Noise → Palette drawn into a Pass, the Pass on the Output (one node selected)
- `blur it by 4` — on Noise → Palette drawn into a Pass, the Pass on the Output (one node selected)

### trails

Feedback trails (Fade).

Words: `trails`, `trail`, `feedback`, `echo`, `smear`, `motion trails`

```
trails [it | the space | the picture | <ref>] [<param> <value>] [<colour>]
```

Examples:

- `trails` — on UV → Circle SDF → SDF Glow → Output (one node selected)
- `circle with a glow, then trails on the picture` — on an empty graph (just an Output)

### flow

Flows a texture along a field.

Words: `flow`, `stream`, `smudge`

```
flow [it | the space | the picture | <ref>] [<param> <value>] [<colour>]
```

Examples:

- `flow` — on Noise → Palette drawn into a Pass, the Pass on the Output (one node selected)
- `stream it` — on Noise → Palette drawn into a Pass, the Pass on the Output (one node selected)

### remap

Remaps a number into 0…1.

Words: `remap`, `normalize`, `normalise`, `rescale`, `fit range`

```
remap [it | the space | the picture | <ref>] [<param> <value>] [<colour>]
```

Examples:

- `remap` — on UV → Fractal Noise → Palette → Output (one node selected)
- `normalize it` — on UV → Fractal Noise → Palette → Output (one node selected)

## Builders: opening a builder

### open the scene builder

Opens the 3D Scene Builder on a new scene (its Templates tab). Build adds the scene to the graph.

Words: `open the scene builder`, `open the 3d scene builder`, `scene builder`, `3d scene builder`, `open the builder`

Examples:

- `open the scene builder`
- `scene builder`

### new 3d scene

The same: the 3D Scene Builder on a new scene.

Words: `new 3d scene`, `new scene`, `make a 3d scene`, `build a 3d scene`, `create a 3d scene`, `start a 3d scene`

Examples:

- `new 3d scene`
- `build a 3d scene`

### edit this scene

Opens the 3D Scene Builder on a scene it built (as the Scene Group's right-click Edit in Scene Builder does). Works on the selected node's built scene, else the only built scene in the graph.

Words: `edit this scene`, `edit the scene`, `edit it in the scene builder`, `edit in the scene builder`, `open this scene`, `open it in the scene builder`, `rebuild this scene`

Examples:

- `edit this scene` — With a built Scene Group (or any node of it) selected
- `edit it in the scene builder` — With a built Scene Group selected

### open grid rules

Opens the Grid Rules editor of the selected Grid Rules node (else the only one); with none in the graph, adds one first. Works on the selected Grid Rules node, else the only one.

Words: `open grid rules`, `open the grid rules editor`, `grid rules editor`, `open the grid editor`

Examples:

- `open grid rules`
- `open the grid rules editor`

### new grid rules

Adds a Grid Rules node (on the Output when the graph is empty) and opens its editor.

Words: `new grid rules`, `add grid rules`, `new grid rules node`, `add a grid rules node`, `new cellular automaton`, `new automaton`

Examples:

- `new grid rules`
- `new cellular automaton`

### edit the rules

Opens the rules of the selected Grid Rules node (its editor) or rules Agents group (its rules editor); else of the only one in the graph. Works on the selected Grid Rules node or rules Agents group, else the only one.

Words: `edit the rules`, `edit rules`, `edit its rules`, `edit the rule`, `open the rules`, `open its rules`

Examples:

- `edit the rules` — With a Grid Rules node or a rules Agents group selected
- `edit its rules` — With a rules Agents group selected

### open agent rules

Opens the rules editor of the selected rules Agents group (else the only one); with none in the graph, adds one first. Works on the selected rules Agents group, else the only one.

Words: `open agent rules`, `open the agent rules editor`, `agent rules editor`, `open the agents rules`

Examples:

- `open agent rules`
- `open the agent rules editor`

### new agent rules

Adds an Agents group in rules mode (Emit → Agents → Deposit → Trail field → palette, on the Output) and opens its rules.

Words: `new agent rules`, `add agent rules`, `new agents with rules`, `new rules agents`, `add an agents group with rules`

Examples:

- `new agent rules`
- `new agents with rules`

### show the recipe

Shows the recipe chip of a builder-made node expanded: a built scene's recipe, a Grid Rules node's rule, a rules group's rules. Works on the selected builder-made node, else the only one.

Words: `show the recipe`, `show recipe`, `show its recipe`, `what is the recipe`, `show the rule`, `show me the recipe`

Examples:

- `show the recipe` — With a built Scene Group selected
- `show the rule` — With a Grid Rules node selected

### copy the recipe

Copies the recipe (or the rule, or the rules as sentences) of a builder-made node to the clipboard. Works on the selected builder-made node, else the only one.

Words: `copy the recipe`, `copy recipe`, `copy its recipe`, `copy the rule`

Examples:

- `copy the recipe` — With a built Scene Group selected
- `copy the rule` — With a Grid Rules node selected

## Objects

### Shapes

A shape word makes the shape (with a UV in front): "circle", "ring radius 0.3", "heart at the top left". With "the" it names one already there. 3D shapes go to the 3D Scene Builder.

Words: `circle`, `sphere`, `box`, `cube`, `ring`, `torus`, `heart`, `triangle`, `hexagon`, `pentagon`, `octagon`, `star`, `cross`, `moon`, `diamond`, `ellipse`, `line`

```
<shape> [radius <number>] [at <place>] [with <action>…]
```

| Slot | What |
|---|---|
| circle | disc, disk, dot, blob |
| sphere | ball, orb |
| box | square, rectangle, rect, block |
| cube | cube |
| ring | hoop, annulus |
| torus | donut, doughnut |
| heart | heart |
| triangle | tri, tri-prism, tri prism |
| hexagon | hex, hex-prism, hex prism |
| pentagon | pentagon |
| octagon | octagon |
| star | pentagram |
| cross | plus sign, plus |
| moon | crescent |
| diamond | rhombus |
| ellipse | oval, egg, ellipsoid |
| line | segment, stroke |

Examples:

- `heart at the top left with rings` — on an empty graph (just an Output)
- `a box at the top right` — on an empty graph (just an Output)

### Nodes by name

Any node by its name ("Fractal Noise", "Stops Palette", "Smoothstep") or a short word for it: noise, palette, glow, fill, uv, time, length.

Words: `noise`, `palette`, `glow`, `uv`, `time`, `length`, `luminance`, `tone map`, `fill`, `mix`

```
create <node>
insert <node> after <ref>
switch <ref> to <node>
```

Examples:

- `create a voronoi` — on an empty graph (just an Output)
- `insert a luminance between the palette and the output` — on UV → Fractal Noise → Palette → Output

## Modifiers

### Values

A setting word and a number fill a slot: "falloff 8", "6 times", "by 0.5", "45 degrees". A bare number fills the first number slot.

Words: `falloff`, `count`, `amount`, `thickness`, `smoothness`, `radius`, `speed`, `angle`, `zoom`

```
<param> <number>
<number> <param>
```

| Slot | What |
|---|---|
| falloff | falloff, fall off, fall-off, tightness |
| count | times, count, copies, tiles, rings, petals, repeats, x |
| amount | amount, strength, by, intensity, power |
| thickness | thickness, thick, width, wide |
| smoothness | smoothness, smooth, k, softness |
| radius | radius, size, big, r |
| speed | speed, fast |
| angle | angle, degrees, deg, rad, radians |
| zoom | zoom |

Examples:

- `glow falloff 4` — on UV → Circle SDF → SDF Fill → Output (one node selected)
- `repeat 5 times` — on UV → Circle SDF → SDF Fill → Output (one node selected)

### Colours

A colour word or #rrggbb fills a colour slot (a glow's tint, a mix colour) or sets a colour setting.

Words: `white`, `black`, `grey`, `gray`, `silver`, `red`, `orange`, `yellow`, `gold`, `green`, `lime`, `teal`, `cyan`, `blue`, `navy`, `purple`, `violet`, `pink`, `magenta`, `brown`, `cream`, `sky`, `night`, `warm`, `cool`, `neon`, `fire`, `ice`

```
<colour>
#rrggbb
```

Examples:

- `glow it red` — on UV → Circle SDF → SDF Fill → Output (one node selected)
- `set the glow tint to #ff8800` — on UV → Circle SDF → SDF Glow → Output

### Places

Where a new shape sits.

Words: `middle`, `center`, `centre`, `the middle`, `the center`, `the centre`, `top`, `bottom`, `left`, `right`, `top left`, `top right`, `bottom left`, `bottom right`

```
at <place>
in the <place>
```

Examples:

- `circle in the middle` — on an empty graph (just an Output)
- `star at the bottom right` — on an empty graph (just an Output)

### Numbers

Digits, number words (six, half, a dozen) and "6x".

Words: `zero`, `one`, `two`, `three`, `four`, `five`, `six`, `seven`, `eight`, `nine`, `ten`, `eleven`, `twelve`, `sixteen`, `twenty`, `half`, `quarter`, `twice`, `double`, `once`, `thrice`, `dozen`

```
<number>
```

Examples:

- `repeat it six times` — on UV → Circle SDF → SDF Fill → Output (one node selected)
- `tile it 3x` — on UV → Circle SDF → SDF Fill → Output (one node selected)

### Relative words

With "make": × 1.25 (× 1.6 with "much", × 1.1 with "a bit"), or the opposite. Size, intensity, speed, softness or count, by the node's own settings.

Words: `bigger`, `larger`, `wider`, `thicker`, `taller`, `smaller`, `thinner`, `narrower`, `tighter`, `shorter`, `brighter`, `stronger`, `louder`, `dimmer`, `darker`, `weaker`, `fainter`, `faster`, `quicker`, `slower`, `softer`, `smoother`, `blurrier`, `sharper`, `harder`, `crisper`, `busier`, `denser`, `sparser`

```
make <ref> [much | a bit] <word>
```

Examples:

- `make the circle a bit smaller` — on UV → Circle SDF → SDF Fill → Output
- `make the noise faster` — on UV → Fractal Noise → Palette → Output

## References

### The last result

What the clause before made; in the first clause, the selection, else what the Output shows.

Words: `it`, `that`, `the result`, `the last one`, `the new one`, `the previous one`

Examples:

- `create a noise, then output it` — on UV → Fractal Noise → Palette → Output

### The selection

The selected node ("this") or nodes ("these").

Words: `this`, `these`, `them`, `those`, `both`, `the selection`, `the selected nodes`

Examples:

- `group these` — on a Circle SDF and a Box SDF, the circle painted on the Output (two nodes selected)

### By name or label

A quoted name is a node's own label; unquoted, a node type's name ("Circle SDF", "fractal noise").

Words: `"Glow"`, `the 'Halo' node`, `Circle SDF`, `the glow node`

Examples:

- `rename "Halo" to "Rim"` — on UV → Circle SDF → SDF Glow → Output

### By type

A shape word or node kind. When several match, the selected one (or the last result) wins; else the preview asks which, pointing at them on the canvas.

Words: `the circle`, `the noise`, `the palette`, `the output`, `the glow`, `the uv`

Examples:

- `make the circle bigger` — on UV → Circle SDF → SDF Fill → Output

### By role

The node wired into the Output.

Words: `the current output`, `what the output shows`, `what feeds the output`, `the picture`

Examples:

- `disconnect the current output` — on UV → Fractal Noise → Palette → Output

### By position

Along the chain (before: what feeds its first wired input; after: the first thing it feeds), or by order on the canvas (left to right).

Words: `the node before <ref>`, `the node after <ref>`, `the first <type>`, `the second <type>`, `the last <type>`, `<type> 2`

Examples:

- `select the node before the output` — on UV → Fractal Noise → Palette → Output

### Several

For delete, group and select.

Words: `all <type>s`, `every <type>`, `<ref> and <ref>`

Examples:

- `delete all circles` — on a Circle SDF and a Box SDF, the circle painted on the Output

### Build targets

Words a build action works on: the selection ("it"), two selected ("these"), a node's space (UV) input ("the space"), what the Output shows ("the picture").

Words: `it`, `this`, `that`, `the selection`, `selected`, `the shape`, `the node`, `these`, `them`, `both`, `the two`, `these colours`, `these colors`, `these shapes`, `the edges`, `the space`, `space`, `the uv`, `uv`, `uvs`, `coordinates`, `the coordinates`, `the domain`, `the picture`, `the image`, `everything`, `the output`, `the whole thing`, `the result`

```
<action> it
<action> the space
<action> the picture
```

Examples:

- `twist the space 0.5` — on UV → Circle SDF → SDF Fill → Output (one node selected)
- `tone map the picture` — on UV → Circle SDF → SDF Glow → Output

## Connectors

### , · ; · then · and then · after that · next · finally

Starts a new clause. Each clause builds on what the last one made ("it").

Words: `,`, `;`, `then`, `and then`, `after that`, `next`, `finally`

Examples:

- `create a circle, then output it` — on Noise → Palette on the Output, plus an unwired Circle SDF, SDF Glow and a Smoothstep mask

### and

Starts a new clause when a verb follows; else lists references ("the circle and the glow").

Words: `and`

Examples:

- `disconnect the current output and output the noise` — on Noise → Palette on the Output, plus an unwired Circle SDF, SDF Glow and a Smoothstep mask

### with

A modifier ("with falloff 8"), a palette ("with a palette") or the second value ("multiply it with the noise").

Words: `with`

Examples:

- `mix the palette with the glow` — on Noise → Palette on the Output, plus an unwired Circle SDF, SDF Glow and a Smoothstep mask

### by

An amount ("by 0.5"), the second value ("multiply it by the circle") or a palette's driver ("by the length of the space").

Words: `by`

Examples:

- `multiply it by 2` — on Noise → Palette on the Output, plus an unwired Circle SDF, SDF Glow and a Smoothstep mask

### to · into · onto

Where something goes ("connect A to B", "plug A into B", "rename X to …", "set X to 8").

Words: `to`, `into`, `onto`

Examples:

- `connect the glow to the output` — on Noise → Palette on the Output, plus an unwired Circle SDF, SDF Glow and a Smoothstep mask

### between · after · before

Where an inserted node goes.

Words: `between`, `after`, `before`

Examples:

- `insert a tone map between the palette and the output` — on Noise → Palette on the Output, plus an unwired Circle SDF, SDF Glow and a Smoothstep mask

### from

Which wires ("disconnect A from B"), the base of a subtraction.

Words: `from`

Examples:

- `subtract the circle from the noise` — on Noise → Palette on the Output, plus an unwired Circle SDF, SDF Glow and a Smoothstep mask

### of · 's

A setting or input of a node ("the radius of the circle", "the circle's radius").

Words: `of`, `'s`

Examples:

- `set the circle's radius to 0.2` — on Noise → Palette on the Output, plus an unwired Circle SDF, SDF Glow and a Smoothstep mask

### as

A name ("group these as 'Neon'").

Words: `as`

Examples:

- `group these as "Neon"` — on a Circle SDF and a Box SDF, the circle painted on the Output (two nodes selected)

## Recipes

### Glowing ring

A ring's distance lit by SDF Glow, tone mapped so the core doesn't clip.

```
create a ring radius 0.3 with a glow falloff 6 cyan, then tone map the picture
```

### Palette by distance

Colour that changes with the distance from the centre, lit by the ring's glow and cut by the circle.

```
create a ring with falloff 0.3, colour it with a palette by the length of the space, multiply it by the circle, then output it
```

### Warped noise

Domain warp on the noise's UV, then the value through a cosine palette.

```
create a noise, warp it 0.6, then colour it with a palette and output it
```

### Neon outline

A thin outline for the tube, a glow on the same shape for the halo, tone mapped.

```
create a hexagon with an outline width 0.01 pink, glow the hexagon falloff 12 pink, then tone map the picture
```

### Feedback trails

Fade keeps the last frames: anything that moves leaves a trail.

```
circle at the top left with a glow, then trails on the picture
```

### Kaleidoscope star

Angular Repeat folds the space into wedges round the centre.

```
star with a glow falloff 4, then repeat it 6 times around
```

### Swirled rings

Rings round the shape, the space swirled in front of it.

```
circle with 12 rings, then swirl the space 2
```

### Noise on a shape

Edits an existing graph: the picture added to the noise, then shown.

```
disconnect the current output, add it to the noise, and output the result
```

## Limits

- One level at a time: commands work on the graph level being edited (inside a group, its nodes); "output" needs the top level.
- Group goes last in a sentence, and the Output can't be grouped.
- References name nodes by type, label, role or position; a node's id is not a word.
- Build actions on a node named in the clause ("glow the circle") work on one node; two-node moves use "these".
- Relative changes move one setting (the first that fits its role); name the setting for another ("increase the speed of the noise").
- Unknown words in a build clause are listed and skipped; an edit clause with an unknown reference is refused with suggestions.
