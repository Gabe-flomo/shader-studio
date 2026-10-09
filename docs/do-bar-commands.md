# Do… bar commands

<!-- Generated from src/lang/commands.ts, src/lang/vocabulary.ts and src/lang/registry.ts (src/lang/reference.ts) by `npm run docs:do-bar`. Don't edit by hand: a test fails when it is out of date. -->

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

Adds a shape (with its UV) or any node by name. Modifiers after it set its values; a value only a move has (falloff → Glow) adds that move. Leaves as "it": the new node (or the last move it made). Canonical: create <maker>.

Words: `create`, `new`, `draw`, `make a`, `make an`, `add a`, `add an`, `place`

```
create <maker>
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

Wires an output into an input. Without an input name it takes the first free input that fits; the type check runs first. Leaves as "it": the node that reads it. Canonical: connect <ref> → <ref>[.<socket>].

Words: `connect`, `wire`, `plug`, `link`, `feed`, `hook up`, `attach`

```
connect <ref> → <ref>[.<socket>]
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

Removes wires. "Disconnect X" removes the wires out of X (from the Output only, when X is the current output); "from Y" only those into Y; "the <input> of Y" clears one input. Leaves as "it": the node that was unplugged. Canonical: disconnect <ref> [from <ref>] · disconnect <ref>.<socket>.

Words: `disconnect`, `unplug`, `unwire`, `unlink`, `detach`, `cut the wire from`

```
disconnect <ref> [from <ref>]
disconnect <ref>.<socket>
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

Moves a node's outgoing wires: unplugs everything it feeds, then connects it to the new node. Leaves as "it": the node that reads it. Canonical: reconnect <ref> → <ref>[.<socket>].

Words: `reconnect`, `rewire`, `move the wire from`, `reroute`

```
reconnect <ref> → <ref>[.<socket>]
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

Puts a new node on a wire: between two wired nodes, after a node (on every wire out of it) or before one (on its first wired input). Leaves as "it": the inserted node. Canonical: insert <maker> between <ref> and <ref> · insert <maker> after <ref> · insert <maker> before <ref>.

Words: `insert`, `put`, `slot`, `splice`

```
insert <maker> between <ref> and <ref>
insert <maker> after <ref>
insert <maker> before <ref>
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

Combines two values with a new node and puts the result where the first one (the base) went. "Add A to B" and "subtract A from B" use B as the base. Numbers work too ("multiply it by 2"). Leaves as "it": the new combining node. Canonical: <ref> * <ref|number> · <ref> + <ref> · <ref> - <ref> · mix(<ref>, <ref>) by=<n> · screen(<ref>, <ref>) · union(<ref>, <ref>).

Words: `multiply`, `times`, `add`, `subtract`, `divide`, `mix`, `blend`, `screen`, `overlay`, `union`, `merge`, `intersect`, `cut`

```
<ref> * <ref|number>
<ref> + <ref>
<ref> - <ref>
mix(<ref>, <ref>) by=<n>
screen(<ref>, <ref>)
union(<ref>, <ref>)
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

Wires a node to the Output (adding an Output on the top level when there is none). Leaves as "it": the node shown. Canonical: output [<ref>].

Words: `output`, `show`, `display`, `send to the output`, `preview`

```
output [<ref>]
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

Switches a node to another type in place, keeping its wires and settings (the card's Switch to). Refused when a wire would have nowhere to go, with the types that would work. Leaves as "it": the switched node. Canonical: switch <ref> to <type> (the verb is switch).

Words: `replace`, `switch`, `swap`, `turn`, `change`

```
switch <ref> to <type>
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

Removes nodes and the wires into and out of them. Leaves as "it": nothing (the next "it" is the last thing before). Canonical: delete <ref>.

Words: `delete`, `remove`, `erase`, `get rid of`, `drop`

```
delete <ref>
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

Gives a node a name of its own (its card label). Quote names with spaces. Leaves as "it": the renamed node. Canonical: rename <ref> "<name>".

Words: `rename`, `call`, `name`, `label`

```
rename <ref> "<name>"
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

Copies a node next to it, with the same settings and the same wires in (nothing reads the copy yet). Leaves as "it": the copy. Canonical: duplicate <ref>.

Words: `duplicate`, `copy`, `clone`

```
duplicate <ref>
duplicate <ref>
```

| Slot | What |
|---|---|
| ref | the node to copy |

Examples:

- `duplicate the circle` — on UV → Circle SDF → SDF Fill → Output
- `copy the glow, then set its falloff to 3` — on UV → Circle SDF → SDF Glow → Output

### set

Sets a setting to a value: a number, a colour word, a choice by name, on or off. The setting is found by its name, its label or a vocabulary word (falloff, size, speed…). Leaves as "it": the node changed. Canonical: set <ref> <key>=<value>….

Words: `set`, `change`

```
set <ref> <key>=<value>…
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

Relative changes: bigger / smaller (its size), brighter / dimmer, faster / slower, softer / sharper; "increase X by 0.1"; double, halve. Leaves as "it": the node changed. Canonical: set <ref> <key>*=<factor> · set <ref> <key>+=<amount> (the verb is set).

Words: `make`, `increase`, `raise`, `decrease`, `lower`, `reduce`, `double`, `halve`, `triple`

```
set <ref> <key>*=<factor>
set <ref> <key>+=<amount>
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

Puts nodes into a group (as Group selection does). Goes last in a sentence. Leaves as "it": the group. Canonical: group(<ref>, …) [name="<name>"].

Words: `group`, `bundle`, `wrap up`

```
group(<ref>, …) [name="<name>"]
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

Selects nodes (no change to the graph), so the next command, or the next "this", works on them. Leaves as "it": the selection. Canonical: select <ref>.

Words: `select`, `pick`, `find`, `highlight`

```
select <ref>
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

Colours a value with a palette. "By <driver>" picks what runs along the palette (the length of the space, the angle, time, noise, any node) and multiplies it by the value; without "by" the value itself drives it. Leaves as "it": the palette (or what multiplies it). Canonical: colour by <driver> [palette=<name>].

Words: `colour`, `color`, `paint`, `shade`

```
colour by <driver> [palette=<name>]
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

### new 2d scene

Opens the 2D Scene Builder on a new scene: shapes, space, a grid with ripples, functions and a look. Build adds it to the graph.

Words: `new 2d scene`, `open the 2d scene builder`, `2d scene builder`, `make a 2d scene`, `build a 2d scene`, `create a 2d scene`, `start a 2d scene`, `new 2d grid`

Examples:

- `new 2d scene`
- `2d scene builder`

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

### new 3d agents

Adds 3D agents (Emit in a Ball → Agents in Space 3D, rules mode → Deposit → a volume Trail, Draw agents through an orbiting camera, on the Output) and opens their rules: Space 2D / 3D, 3D templates, the camera on the Look tab.

Words: `new 3d agents`, `new 3d agent rules`, `add 3d agents`, `make 3d agents`, `new agents in 3d`, `3d agent builder`, `open the 3d agent builder`, `new 3d swarm`, `new 3d slime`

Examples:

- `new 3d agents`
- `3d agent builder`

### new 3d agents round a shape

Adds 3D agents round a ray-marched torus (the 3D slime with Collide (3D scene), drawn through the March Camera and hidden behind the torus, on the Output) and opens their rules; Look → Around a shape picks a Sphere or a Box.

Words: `new 3d agents round a shape`, `new 3d agents around a shape`, `3d agents round a shape`, `3d agents around a shape`, `new 3d agents round a torus`, `agents round a torus`, `agents around a shape`

Examples:

- `new 3d agents round a shape`
- `agents round a torus`

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

## The language: every head word (canonical)

### circle

2D picture · maker. A circle (a distance, with a UV in front). Also: disc, disk, dot, blob.

Words: `circle`, `disc`, `disk`, `dot`, `blob`

```
circle [r] color= at=
```

| Slot | What |
|---|---|
| r (bare) | Size · default 0.25 · random: 0.1–0.35 |
| color | Colour · random: a harmonious colour |
| at | Where · middle, top, bottom, left, right, top-left, top-right, bottom-left, bottom-right · default middle · random: middle \| middle \| top-left \| top-right \| bottom-left \| bottom-right \| left \| right |

Examples:

- `circle · glow` — on an empty graph (just an Output)

### sphere

2D picture · maker. A sphere (a distance, with a UV in front). Also: ball, orb.

Words: `sphere`, `ball`, `orb`

```
sphere [r] color= at=
```

| Slot | What |
|---|---|
| r (bare) | Size · default 0.25 · random: 0.1–0.35 |
| color | Colour · random: a harmonious colour |
| at | Where · middle, top, bottom, left, right, top-left, top-right, bottom-left, bottom-right · default middle · random: middle \| middle \| top-left \| top-right \| bottom-left \| bottom-right \| left \| right |

Examples:

- `sphere · glow` — on an empty graph (just an Output)

### box

2D picture · maker. A box (a distance, with a UV in front). Also: square, rectangle, rect, block, roundbox.

Words: `box`, `square`, `rectangle`, `rect`, `block`, `roundbox`

```
box [r] color= at=
```

| Slot | What |
|---|---|
| r (bare) | Size · default 0.25 · random: 0.1–0.35 |
| color | Colour · random: a harmonious colour |
| at | Where · middle, top, bottom, left, right, top-left, top-right, bottom-left, bottom-right · default middle · random: middle \| middle \| top-left \| top-right \| bottom-left \| bottom-right \| left \| right |

Examples:

- `box · glow` — on an empty graph (just an Output)

### cube

2D picture · maker. A cube (a distance, with a UV in front).

Words: `cube`

```
cube [r] color= at=
```

| Slot | What |
|---|---|
| r (bare) | Size · default 0.25 · random: 0.1–0.35 |
| color | Colour · random: a harmonious colour |
| at | Where · middle, top, bottom, left, right, top-left, top-right, bottom-left, bottom-right · default middle · random: middle \| middle \| top-left \| top-right \| bottom-left \| bottom-right \| left \| right |

Examples:

- `cube · glow` — on an empty graph (just an Output)

### ring

2D picture · maker. A ring (a distance, with a UV in front). Also: hoop, annulus.

Words: `ring`, `hoop`, `annulus`

```
ring [r] color= at=
```

| Slot | What |
|---|---|
| r (bare) | Size · default 0.25 · random: 0.1–0.35 |
| color | Colour · random: a harmonious colour |
| at | Where · middle, top, bottom, left, right, top-left, top-right, bottom-left, bottom-right · default middle · random: middle \| middle \| top-left \| top-right \| bottom-left \| bottom-right \| left \| right |

Examples:

- `ring · glow` — on an empty graph (just an Output)

### torus

2D picture · maker. A torus (a distance, with a UV in front). Also: donut, doughnut.

Words: `torus`, `donut`, `doughnut`

```
torus [r] color= at=
```

| Slot | What |
|---|---|
| r (bare) | Size · default 0.25 · random: 0.1–0.35 |
| color | Colour · random: a harmonious colour |
| at | Where · middle, top, bottom, left, right, top-left, top-right, bottom-left, bottom-right · default middle · random: middle \| middle \| top-left \| top-right \| bottom-left \| bottom-right \| left \| right |

Examples:

- `torus · glow` — on an empty graph (just an Output)

### heart

2D picture · maker. A heart (a distance, with a UV in front).

Words: `heart`

```
heart [r] color= at=
```

| Slot | What |
|---|---|
| r (bare) | Size · default 0.25 · random: 0.1–0.35 |
| color | Colour · random: a harmonious colour |
| at | Where · middle, top, bottom, left, right, top-left, top-right, bottom-left, bottom-right · default middle · random: middle \| middle \| top-left \| top-right \| bottom-left \| bottom-right \| left \| right |

Examples:

- `heart · glow` — on an empty graph (just an Output)

### triangle

2D picture · maker. A triangle (a distance, with a UV in front). Also: tri, tri-prism.

Words: `triangle`, `tri`, `tri-prism`

```
triangle [r] color= at=
```

| Slot | What |
|---|---|
| r (bare) | Size · default 0.25 · random: 0.1–0.35 |
| color | Colour · random: a harmonious colour |
| at | Where · middle, top, bottom, left, right, top-left, top-right, bottom-left, bottom-right · default middle · random: middle \| middle \| top-left \| top-right \| bottom-left \| bottom-right \| left \| right |

Examples:

- `triangle · glow` — on an empty graph (just an Output)

### hexagon

2D picture · maker. A hexagon (a distance, with a UV in front). Also: hex, hex-prism.

Words: `hexagon`, `hex`, `hex-prism`

```
hexagon [r] color= at=
```

| Slot | What |
|---|---|
| r (bare) | Size · default 0.25 · random: 0.1–0.35 |
| color | Colour · random: a harmonious colour |
| at | Where · middle, top, bottom, left, right, top-left, top-right, bottom-left, bottom-right · default middle · random: middle \| middle \| top-left \| top-right \| bottom-left \| bottom-right \| left \| right |

Examples:

- `hexagon · glow` — on an empty graph (just an Output)

### pentagon

2D picture · maker. A pentagon (a distance, with a UV in front).

Words: `pentagon`

```
pentagon [r] color= at=
```

| Slot | What |
|---|---|
| r (bare) | Size · default 0.25 · random: 0.1–0.35 |
| color | Colour · random: a harmonious colour |
| at | Where · middle, top, bottom, left, right, top-left, top-right, bottom-left, bottom-right · default middle · random: middle \| middle \| top-left \| top-right \| bottom-left \| bottom-right \| left \| right |

Examples:

- `pentagon · glow` — on an empty graph (just an Output)

### octagon

2D picture · maker. A octagon (a distance, with a UV in front).

Words: `octagon`

```
octagon [r] color= at=
```

| Slot | What |
|---|---|
| r (bare) | Size · default 0.25 · random: 0.1–0.35 |
| color | Colour · random: a harmonious colour |
| at | Where · middle, top, bottom, left, right, top-left, top-right, bottom-left, bottom-right · default middle · random: middle \| middle \| top-left \| top-right \| bottom-left \| bottom-right \| left \| right |

Examples:

- `octagon · glow` — on an empty graph (just an Output)

### star

2D picture · maker. A star (a distance, with a UV in front). Also: pentagram.

Words: `star`, `pentagram`

```
star [r] color= at=
```

| Slot | What |
|---|---|
| r (bare) | Size · default 0.25 · random: 0.1–0.35 |
| color | Colour · random: a harmonious colour |
| at | Where · middle, top, bottom, left, right, top-left, top-right, bottom-left, bottom-right · default middle · random: middle \| middle \| top-left \| top-right \| bottom-left \| bottom-right \| left \| right |

Examples:

- `star · glow` — on an empty graph (just an Output)

### cross

2D picture · maker. A cross (a distance, with a UV in front). Also: plus.

Words: `cross`, `plus`

```
cross [r] color= at=
```

| Slot | What |
|---|---|
| r (bare) | Size · default 0.25 · random: 0.1–0.35 |
| color | Colour · random: a harmonious colour |
| at | Where · middle, top, bottom, left, right, top-left, top-right, bottom-left, bottom-right · default middle · random: middle \| middle \| top-left \| top-right \| bottom-left \| bottom-right \| left \| right |

Examples:

- `cross · glow` — on an empty graph (just an Output)

### moon

2D picture · maker. A moon (a distance, with a UV in front). Also: crescent.

Words: `moon`, `crescent`

```
moon [r] color= at=
```

| Slot | What |
|---|---|
| r (bare) | Size · default 0.25 · random: 0.1–0.35 |
| color | Colour · random: a harmonious colour |
| at | Where · middle, top, bottom, left, right, top-left, top-right, bottom-left, bottom-right · default middle · random: middle \| middle \| top-left \| top-right \| bottom-left \| bottom-right \| left \| right |

Examples:

- `moon · glow` — on an empty graph (just an Output)

### diamond

2D picture · maker. A diamond (a distance, with a UV in front). Also: rhombus.

Words: `diamond`, `rhombus`

```
diamond [r] color= at=
```

| Slot | What |
|---|---|
| r (bare) | Size · default 0.25 · random: 0.1–0.35 |
| color | Colour · random: a harmonious colour |
| at | Where · middle, top, bottom, left, right, top-left, top-right, bottom-left, bottom-right · default middle · random: middle \| middle \| top-left \| top-right \| bottom-left \| bottom-right \| left \| right |

Examples:

- `diamond · glow` — on an empty graph (just an Output)

### ellipse

2D picture · maker. A ellipse (a distance, with a UV in front). Also: oval, egg, ellipsoid.

Words: `ellipse`, `oval`, `egg`, `ellipsoid`

```
ellipse [r] color= at=
```

| Slot | What |
|---|---|
| r (bare) | Size · default 0.25 · random: 0.1–0.35 |
| color | Colour · random: a harmonious colour |
| at | Where · middle, top, bottom, left, right, top-left, top-right, bottom-left, bottom-right · default middle · random: middle \| middle \| top-left \| top-right \| bottom-left \| bottom-right \| left \| right |

Examples:

- `ellipse · glow` — on an empty graph (just an Output)

### line

2D picture · maker. A line (a distance, with a UV in front). Also: segment, stroke.

Words: `line`, `segment`, `stroke`

```
line color= at=
```

| Slot | What |
|---|---|
| color | Colour · random: a harmonious colour |
| at | Where · middle, top, bottom, left, right, top-left, top-right, bottom-left, bottom-right · default middle · random: middle \| middle \| top-left \| top-right \| bottom-left \| bottom-right \| left \| right |

Examples:

- `line · glow` — on an empty graph (just an Output)

### colour

2D picture · output. Colours it through a palette, by a driver: the length of the space, the angle, x, y, time, noise or a node. Also: color.

Words: `colour`, `color`

```
colour [by] palette=
```

| Slot | What |
|---|---|
| by (bare) | length, angle, x, y, time, noise · random: length \| length \| angle \| x \| y \| time |
| palette | sunset, rainbow, fire, forest, teal, warm, haze, psychedelic, mono, heat, ice, terrain · random: sunset \| rainbow \| fire \| forest \| teal \| warm \| haze \| psychedelic \| mono \| heat \| ice \| terrain |

Examples:

- `circle · glow · colour by length` — on an empty graph (just an Output)
- `noise · colour by it` — on an empty graph (just an Output)

### polar-repeat

2D picture · step. Repeat around: copies round the centre, like a flower (Angular Repeat). Also: repeat-around, petals, kaleidoscope.

Words: `polar-repeat`, `repeat-around`, `petals`, `kaleidoscope`

```
polar-repeat [count]
```

| Slot | What |
|---|---|
| count (bare) | Copies · default 6 · random: 3–12, whole |

Examples:

- `star · glow · polar-repeat 6` — on an empty graph (just an Output)

### pass

2D picture · step. Draws it into a texture (a Pass) so the steps after it can read around: fade (trails), blur, glow, edges, flow. Also: buffer.

Words: `pass`, `buffer`

```
pass scale= repeat= format= filter= edges=
```

| Slot | What |
|---|---|
| scale | texture size: 1/2 and 1/4 make wide blurs cheap · 1, 1/2, 1/4, 1/8, 1/16, 1/32 |
| repeat | draws a step several times a frame |
| format | half, byte |
| filter | linear, nearest |
| edges | clamp, repeat, mirror |

Examples:

- `circle · glow · pass "trails" · fade 0.5s` — on an empty graph (just an Output)
- `noise · colour by it · pass scale=1/2 · blur 4` — on an empty graph (just an Output)

### noise

2D picture · maker. Fractal noise (a number field). Also: fbm, clouds.

Words: `noise`, `fbm`, `clouds`

```
noise scale=
```

| Slot | What |
|---|---|
| scale | random: 1.5–6 |

Examples:

- `noise · colour by it` — on an empty graph (just an Output)

### voronoi

2D picture · maker. Voronoi cells (a number field). Also: cells.

Words: `voronoi`, `cells`

```
voronoi
```

Examples:

- `voronoi · colour by it` — on an empty graph (just an Output)

### glow

2D picture · step. Glow Also: glowing, halo, neon, shine, bloom.

Words: `glow`, `glowing`, `halo`, `neon`, `shine`, `bloom`

```
glow [falloff] color= amount=
```

| Slot | What |
|---|---|
| falloff (bare) | Falloff · default 10 · random: 4–20 (log) |
| color | Colour · random: a harmonious colour |
| amount | Intensity · default 1.2 · random: 0.6–2 |

### rings

2D picture · step. Rings Also: ripples, contours, isolines, concentric.

Words: `rings`, `ripples`, `contours`, `isolines`, `concentric`

```
rings [count] speed= color=
```

| Slot | What |
|---|---|
| count (bare) | Rings · default 10 · random: 4–18, whole |
| speed | Speed · default 0.4 · random: 0–0.8 |
| color | Colour · random: a harmonious colour |

### outline

2D picture · step. Outline Also: outlined, border, edges.

Words: `outline`, `outlined`, `border`, `edges`

```
outline [width] color=
```

| Slot | What |
|---|---|
| width (bare) | Width · default 0.02 · random: 0.004–0.03 (log) |
| color | Colour · random: a harmonious colour |

### onion

2D picture · step. Onion Also: hollow, shell.

Words: `onion`, `hollow`, `shell`

```
onion [thickness]
```

| Slot | What |
|---|---|
| thickness (bare) | Thickness · default 0.02 · random: 0.006–0.05 (log) |

### round

2D picture · step. Grow / round Also: rounded, grow, bigger, fatten, inflate, thicken.

Words: `round`, `rounded`, `grow`, `bigger`, `fatten`, `inflate`, `thicken`

```
round [amount]
```

| Slot | What |
|---|---|
| amount (bare) | Amount · default 0.03 · random: 0.01–0.08 |

### smooth-union

2D picture · step. Smooth blend Also: blend, melt, merge, smin, combine, join.

Words: `smooth-union`, `blend`, `melt`, `merge`, `smin`, `combine`, `join`

```
smooth-union [k] shape=
```

| Slot | What |
|---|---|
| k (bare) | Smoothness · default 0.15 · random: 0.05–0.3 |
| shape | Other shape · default circle · random: circle \| box |

### mask

2D picture · step. Mask from it Also: cutout, stencil.

Words: `mask`, `cutout`, `stencil`

```
mask [softness]
```

| Slot | What |
|---|---|
| softness (bare) | Softness · default 0.01 · random: 0.004–0.06 (log) |

### warp

2D picture · step. Warp (noise) Also: distort, wobble, noisy, organic, marble.

Words: `warp`, `distort`, `wobble`, `noisy`, `organic`, `marble`

```
warp [amount]
```

| Slot | What |
|---|---|
| amount (bare) | Strength · default 0.4 · random: 0.2–1.2 |

### swirl

2D picture · step. Swirl Also: vortex, whirl, spin.

Words: `swirl`, `vortex`, `whirl`, `spin`

```
swirl [amount]
```

| Slot | What |
|---|---|
| amount (bare) | Strength · default 2 · random: 0.8–4 |

### twist

2D picture · step. Twist Also: twisted, spiral.

Words: `twist`, `twisted`, `spiral`

```
twist [amount]
```

| Slot | What |
|---|---|
| amount (bare) | Amount · default 3 · random: 0.5–5 |

### polar

2D picture · step. Polar Also: radial.

Words: `polar`, `radial`

```
polar [twist]
```

| Slot | What |
|---|---|
| twist (bare) | Twist · default 0 · random: 0–2 |

### mirror

2D picture · step. Mirror Also: mirrored, symmetric, symmetry, reflect, flip.

Words: `mirror`, `mirrored`, `symmetric`, `symmetry`, `reflect`, `flip`

```
mirror axis=
```

| Slot | What |
|---|---|
| axis | Axis · default x · random: x \| y \| both |

### repeat

2D picture · step. Repeat Also: tile, tiles, tiled, copies, pattern.

Words: `repeat`, `tile`, `tiles`, `tiled`, `copies`, `pattern`

```
repeat [count]
```

| Slot | What |
|---|---|
| count (bare) | Tiles across · default 4 · random: 2–7, whole |

### zoom-rotate

2D picture · step. Zoom / rotate Also: zoom, scale, rotate, turn, tilt, magnify.

Words: `zoom-rotate`, `zoom`, `scale`, `rotate`, `turn`, `tilt`, `magnify`

```
zoom-rotate [zoom] angle=
```

| Slot | What |
|---|---|
| zoom (bare) | Zoom · default 1.5 · random: 0.6–2.5 (log) |
| angle | Angle (rad) · default 0.4 · random: -1.2–1.2 |

### custom

2D picture · step. Custom code here Also: code, expression.

Words: `custom`, `code`, `expression`

```
custom
```

### mix

2D picture · step. Mix with… Also: mixed, tint, crossfade.

Words: `mix`, `mixed`, `tint`, `crossfade`

```
mix color= [amount]
```

| Slot | What |
|---|---|
| color | Colour · random: a harmonious colour |
| amount (bare) | Amount · default 0.5 · random: 0.2–0.7 |

### palette

2D picture · step. Palette Also: colorize, colourise, colourize, rainbow, recolour, recolor.

Words: `palette`, `colorize`, `colourise`, `colourize`, `rainbow`, `recolour`, `recolor`

```
palette
```

### tone-map

2D picture · step. Tone map Also: tonemap, aces, unclip.

Words: `tone-map`, `tonemap`, `aces`, `unclip`

```
tone-map
```

### grade

2D picture · step. Grade Also: look.

Words: `grade`, `look`

```
grade
```

### brighten

2D picture · step. Brighter Also: brighter, lighten, lift, exposure.

Words: `brighten`, `brighter`, `lighten`, `lift`, `exposure`

```
brighten [amount]
```

| Slot | What |
|---|---|
| amount (bare) | Brightness · default 0.15 · random: 0.05–0.35 |

### grain

2D picture · step. Grain Also: dither, grainy.

Words: `grain`, `dither`, `grainy`

```
grain [amount]
```

| Slot | What |
|---|---|
| amount (bare) | Amount · default 0.05 · random: 0.02–0.12 |

### blend-mode

2D picture · step. Blend Also: screen, overlay, layer.

Words: `blend-mode`, `screen`, `overlay`, `layer`

```
blend-mode mode=
```

| Slot | What |
|---|---|
| mode | Mode · default screen · random: screen \| overlay \| multiply \| add \| softlight |

### soft-edge

2D picture · step. Soft edge Also: soften, soft, feather, antialias.

Words: `soft-edge`, `soften`, `soft`, `feather`, `antialias`

```
soft-edge [amount]
```

| Slot | What |
|---|---|
| amount (bare) | Softness · default 0.2 · random: 0.05–0.4 |

### invert

2D picture · step. Invert Also: inverse, negate.

Words: `invert`, `inverse`, `negate`

```
invert
```

### grow-mask

2D picture · step. Grow / shrink Also: shrink, erode, dilate.

Words: `grow-mask`, `shrink`, `erode`, `dilate`

```
grow-mask [amount]
```

| Slot | What |
|---|---|
| amount (bare) | Grow by · default 0.2 · random: -0.3–0.3 |

### mix-two

2D picture · step. Mix two pictures

Words: `mix-two`

```
mix-two
```

### blur

2D picture · step. Blur Also: blurry, defocus.

Words: `blur`, `blurry`, `defocus`

```
blur [amount]
```

| Slot | What |
|---|---|
| amount (bare) | Radius (px) · default 8 · random: 2–16 (log) |

### fade

2D picture · step. Trails Also: trails, trail, feedback, echo, smear.

Words: `fade`, `trails`, `trail`, `feedback`, `echo`, `smear`

```
fade [tail] clean=
```

| Slot | What |
|---|---|
| tail (bare) | Tail (s) · seconds for a pixel left alone to fade to 1% · default 1.5 · random: 0.3–4 (log) |
| clean | Clean · default 0.2 · random: 0–0.5 |

### flow

2D picture · step. Flow Also: stream, smudge.

Words: `flow`, `stream`, `smudge`

```
flow
```

### remap

2D picture · step. Remap Also: normalize, normalise, rescale.

Words: `remap`, `normalize`, `normalise`, `rescale`

```
remap [inMin] inMax=
```

| Slot | What |
|---|---|
| inMin (bare) | From min · default 0 · random: -1–1 |
| inMax | From max · default 1 · random: -1–1 |

### surface

3D scene · header. Render mode: lit surfaces with shadows. Also: lit, solid.

Words: `surface`, `lit`, `solid`

```
surface
```

Examples:

- `surface · sphere · plane y=-1` — on an empty graph (just an Output)

### volumetric

3D scene · header. Render mode: see-through glowing gas. Also: volume, glowing. Old words (still read, with a hint): glow.

Words: `volumetric`, `volume`, `glowing`

```
volumetric density= falloff= shell= exposure= tint=
```

| Slot | What |
|---|---|
| density | number |
| falloff | number |
| shell | number |
| exposure | number |
| tint | colour |

Examples:

- `volumetric · torus` — on an empty graph (just an Output)

### glass

3D scene · header. Render mode: refracting glass. Also: glassy.

Words: `glass`, `glassy`

```
glass ior= dispersion= tint=
```

| Slot | What |
|---|---|
| ior | random: 1.2–1.7 |
| dispersion | number |
| tint | colour |

Examples:

- `glass · sphere glass` — on an empty graph (just an Output)

### gi

3D scene · header. Render mode: one bounce of light. Also: gi-lit, global.

Words: `gi`, `gi-lit`, `global`

```
gi bounce= metal= rough= spec=
```

| Slot | What |
|---|---|
| bounce | number |
| metal | number |
| rough | number |
| spec | number |

Examples:

- `gi · torus` — on an empty graph (just an Output)

### sphere

3D scene · maker. Sphere: A ball. Also: ball, orb.

Words: `sphere`, `ball`, `orb`

```
sphere [r] at= rot= color= shine= name= [glass]
```

| Slot | What |
|---|---|
| r (bare) | Radius · default 0.5 · random: 0.25–0.8 |
| at | random: (-0.6…0.6)×3 |
| rot | random: (-45…45)×3 |
| color | random: a harmonious colour |
| shine | random: 0–0.8 |
| name | name |

Examples:

- `sphere` — on an empty graph (just an Output)

### box

3D scene · maker. Box: A box; Round softens its edges. Also: cube, rounded-box, roundbox.

Words: `box`, `cube`, `rounded-box`, `roundbox`

```
box [size] round= at= rot= color= shine= name= [glass]
```

| Slot | What |
|---|---|
| size (bare) | Size (half) · Half its width, height and depth. · random: (0.25…0.8)×3 |
| round | Round · Above 0 it becomes a Rounded Box with edges this round. · default 0 · random: 0–0.16666666666666666 |
| at | random: (-0.6…0.6)×3 |
| rot | random: (-45…45)×3 |
| color | random: a harmonious colour |
| shine | random: 0–0.8 |
| name | name |

Examples:

- `box` — on an empty graph (just an Output)

### torus

3D scene · maker. Torus: A ring lying flat. Also: donut, ring.

Words: `torus`, `donut`, `ring`

```
torus [R] r= at= rot= color= shine= name= [glass]
```

| Slot | What |
|---|---|
| R (bare) | Ring radius · default 0.5 · random: 0.25–0.8 |
| r | Tube radius · default 0.2 · random: 0.1–0.32000000000000006 |
| at | random: (-0.6…0.6)×3 |
| rot | random: (-45…45)×3 |
| color | random: a harmonious colour |
| shine | random: 0–0.8 |
| name | name |

Examples:

- `torus` — on an empty graph (just an Output)

### cone

3D scene · maker. Cone: A pointed cone, tip at the top.

Words: `cone`

```
cone [angle] h= at= rot= color= shine= name= [glass]
```

| Slot | What |
|---|---|
| angle (bare) | Angle · default 22.92 · random: 11.46–36.672000000000004 |
| h | Height · default 1 · random: 0.5–1.6 |
| at | random: (-0.6…0.6)×3 |
| rot | random: (-45…45)×3 |
| color | random: a harmonious colour |
| shine | random: 0–0.8 |
| name | name |

Examples:

- `cone` — on an empty graph (just an Output)

### capped-cone

3D scene · maker. Capped cone: A cone with its tip cut off. Also: frustum.

Words: `capped-cone`, `frustum`

```
capped-cone [h] r1= r2= at= rot= color= shine= name= [glass]
```

| Slot | What |
|---|---|
| h (bare) | Height · default 0.5 · random: 0.25–0.8 |
| r1 | Bottom radius · default 0.4 · random: 0.2–0.6400000000000001 |
| r2 | Top radius · default 0.1 · random: 0.05–0.16000000000000003 |
| at | random: (-0.6…0.6)×3 |
| rot | random: (-45…45)×3 |
| color | random: a harmonious colour |
| shine | random: 0–0.8 |
| name | name |

Examples:

- `capped-cone` — on an empty graph (just an Output)

### cylinder

3D scene · maker. Cylinder: An upright cylinder; Round softens its rims. Also: pillar, column, rounded-cylinder.

Words: `cylinder`, `pillar`, `column`, `rounded-cylinder`

```
cylinder [r] h= round= at= rot= color= shine= name= [glass]
```

| Slot | What |
|---|---|
| r (bare) | Radius · default 0.3 · random: 0.15–0.48 |
| h | Height (half) · default 0.5 · random: 0.25–0.8 |
| round | Round · default 0 · random: 0–0.08333333333333333 |
| at | random: (-0.6…0.6)×3 |
| rot | random: (-45…45)×3 |
| color | random: a harmonious colour |
| shine | random: 0–0.8 |
| name | name |

Examples:

- `cylinder` — on an empty graph (just an Output)

### capsule

3D scene · maker. Capsule: An upright pill. Also: pill.

Words: `capsule`, `pill`

```
capsule [h] r= at= rot= color= shine= name= [glass]
```

| Slot | What |
|---|---|
| h (bare) | Height · default 0.6 · random: 0.3–0.96 |
| r | Radius · default 0.2 · random: 0.1–0.32000000000000006 |
| at | random: (-0.6…0.6)×3 |
| rot | random: (-45…45)×3 |
| color | random: a harmonious colour |
| shine | random: 0–0.8 |
| name | name |

Examples:

- `capsule` — on an empty graph (just an Output)

### plane

3D scene · maker. Plane: An endless floor. Also: floor, ground.

Words: `plane`, `floor`, `ground`

```
plane [y] at= rot= color= shine= name= [glass]
```

| Slot | What |
|---|---|
| y (bare) | Height · default -0.75 · random: -2.416666666666667–0.9166666666666667 |
| at | random: (-0.6…0.6)×3 |
| rot | random: (-45…45)×3 |
| color | random: a harmonious colour |
| shine | random: 0–0.8 |
| name | name |

Examples:

- `plane` — on an empty graph (just an Output)

### octahedron

3D scene · maker. Octahedron: Two pyramids base to base. Also: diamond.

Words: `octahedron`, `diamond`

```
octahedron [s] at= rot= color= shine= name= [glass]
```

| Slot | What |
|---|---|
| s (bare) | Size · default 0.5 · random: 0.25–0.8 |
| at | random: (-0.6…0.6)×3 |
| rot | random: (-45…45)×3 |
| color | random: a harmonious colour |
| shine | random: 0–0.8 |
| name | name |

Examples:

- `octahedron` — on an empty graph (just an Output)

### pyramid

3D scene · maker. Pyramid: A square pyramid.

Words: `pyramid`

```
pyramid [h] at= rot= color= shine= name= [glass]
```

| Slot | What |
|---|---|
| h (bare) | Height · default 0.8 · random: 0.4–1.2800000000000002 |
| at | random: (-0.6…0.6)×3 |
| rot | random: (-45…45)×3 |
| color | random: a harmonious colour |
| shine | random: 0–0.8 |
| name | name |

Examples:

- `pyramid` — on an empty graph (just an Output)

### ellipsoid

3D scene · maker. Ellipsoid: A squashed ball. Also: egg.

Words: `ellipsoid`, `egg`

```
ellipsoid [size] at= rot= color= shine= name= [glass]
```

| Slot | What |
|---|---|
| size (bare) | Radii · random: (0.3…0.96)×3 |
| at | random: (-0.6…0.6)×3 |
| rot | random: (-45…45)×3 |
| color | random: a harmonious colour |
| shine | random: 0–0.8 |
| name | name |

Examples:

- `ellipsoid` — on an empty graph (just an Output)

### hex-prism

3D scene · maker. Hex prism: A six-sided column. Also: hexagon.

Words: `hex-prism`, `hexagon`

```
hex-prism [r] h= at= rot= color= shine= name= [glass]
```

| Slot | What |
|---|---|
| r (bare) | Radius · default 0.4 · random: 0.2–0.6400000000000001 |
| h | Height · default 0.2 · random: 0.1–0.32000000000000006 |
| at | random: (-0.6…0.6)×3 |
| rot | random: (-45…45)×3 |
| color | random: a harmonious colour |
| shine | random: 0–0.8 |
| name | name |

Examples:

- `hex-prism` — on an empty graph (just an Output)

### tri-prism

3D scene · maker. Tri prism: A three-sided column. Also: triangle.

Words: `tri-prism`, `triangle`

```
tri-prism [r] h= at= rot= color= shine= name= [glass]
```

| Slot | What |
|---|---|
| r (bare) | Radius · default 0.4 · random: 0.2–0.6400000000000001 |
| h | Height · default 0.2 · random: 0.1–0.32000000000000006 |
| at | random: (-0.6…0.6)×3 |
| rot | random: (-45…45)×3 |
| color | random: a harmonious colour |
| shine | random: 0–0.8 |
| name | name |

Examples:

- `tri-prism` — on an empty graph (just an Output)

### link

3D scene · maker. Chain link: One link of a chain. Also: chain.

Words: `link`, `chain`

```
link [len] R= r= at= rot= color= shine= name= [glass]
```

| Slot | What |
|---|---|
| len (bare) | Length · default 0.3 · random: 0.15–0.48 |
| R | Loop radius · default 0.25 · random: 0.125–0.4 |
| r | Wire radius · default 0.08 · random: 0.04–0.128 |
| at | random: (-0.6…0.6)×3 |
| rot | random: (-45…45)×3 |
| color | random: a harmonious colour |
| shine | random: 0–0.8 |
| name | name |

Examples:

- `link` — on an empty graph (just an Output)

### box-frame

3D scene · maker. Box frame: The twelve edges of a box. Also: frame, wireframe.

Words: `box-frame`, `frame`, `wireframe`

```
box-frame [size] t= at= rot= color= shine= name= [glass]
```

| Slot | What |
|---|---|
| size (bare) | Size (half) · random: (0.2…0.6400000000000001)×3 |
| t | Thickness · default 0.05 · random: 0.025–0.08000000000000002 |
| at | random: (-0.6…0.6)×3 |
| rot | random: (-45…45)×3 |
| color | random: a harmonious colour |
| shine | random: 0–0.8 |
| name | name |

Examples:

- `box-frame` — on an empty graph (just an Output)

### capped-torus

3D scene · maker. Capped torus: Part of a ring. Also: arc.

Words: `capped-torus`, `arc`

```
capped-torus [R] r= angle= at= rot= color= shine= name= [glass]
```

| Slot | What |
|---|---|
| R (bare) | Ring radius · default 0.5 · random: 0.25–0.8 |
| r | Tube radius · default 0.1 · random: 0.05–0.16000000000000003 |
| angle | Opening · default 68.75 · random: 34.375–110 |
| at | random: (-0.6…0.6)×3 |
| rot | random: (-45…45)×3 |
| color | random: a harmonious colour |
| shine | random: 0–0.8 |
| name | name |

Examples:

- `capped-torus` — on an empty graph (just an Output)

### solid-angle

3D scene · maker. Solid angle: A ball cut to a cone: an ice-cream scoop. Also: wedge.

Words: `solid-angle`, `wedge`

```
solid-angle [r] angle= at= rot= color= shine= name= [glass]
```

| Slot | What |
|---|---|
| r (bare) | Radius · default 0.6 · random: 0.3–0.96 |
| angle | Angle · default 57.3 · random: 28.65–91.68 |
| at | random: (-0.6…0.6)×3 |
| rot | random: (-45…45)×3 |
| color | random: a harmonious colour |
| shine | random: 0–0.8 |
| name | name |

Examples:

- `solid-angle` — on an empty graph (just an Output)

### cross

3D scene · maker. Cross: Three endless bars crossing: the Menger cutter. Also: plus.

Words: `cross`, `plus`

```
cross [s] at= rot= color= shine= name= [glass]
```

| Slot | What |
|---|---|
| s (bare) | Bar size · default 0.3 · random: 0.15–0.48 |
| at | random: (-0.6…0.6)×3 |
| rot | random: (-45…45)×3 |
| color | random: a harmonious colour |
| shine | random: 0–0.8 |
| name | name |

Examples:

- `cross` — on an empty graph (just an Output)

### gyroid

3D scene · maker. Gyroid: A curving lattice that fills space, cut to a ball.

Words: `gyroid`

```
gyroid [freq] t= ball= at= rot= color= shine= name= [glass]
```

| Slot | What |
|---|---|
| freq (bare) | Frequency · default 3.5 · random: 1.75–5.6000000000000005 |
| t | Thickness · default 0.3 · random: 0.15–0.48 |
| ball | Ball radius · The ball the lattice is cut to. 0 fills all of space. · default 1.1 · random: 0.55–1.7600000000000002 |
| at | random: (-0.6…0.6)×3 |
| rot | random: (-45…45)×3 |
| color | random: a harmonious colour |
| shine | random: 0–0.8 |
| name | name |

Examples:

- `gyroid` — on an empty graph (just an Output)

### schwarz-p

3D scene · maker. Schwarz-P: A lattice of round chambers, cut to a ball. Also: schwarz.

Words: `schwarz-p`, `schwarz`

```
schwarz-p [freq] t= ball= at= rot= color= shine= name= [glass]
```

| Slot | What |
|---|---|
| freq (bare) | Frequency · default 3.5 · random: 1.75–5.6000000000000005 |
| t | Thickness · default 0.3 · random: 0.15–0.48 |
| ball | Ball radius · default 1.1 · random: 0.55–1.7600000000000002 |
| at | random: (-0.6…0.6)×3 |
| rot | random: (-45…45)×3 |
| color | random: a harmonious colour |
| shine | random: 0–0.8 |
| name | name |

Examples:

- `schwarz-p` — on an empty graph (just an Output)

### hypersphere

3D scene · maker. Hypersphere: A 4D ball: its slice is a ball that grows and shrinks as W moves. Also: 4d-ball, 4d-sphere.

Words: `hypersphere`, `4d-ball`, `4d-sphere`

```
hypersphere [r] w= spin= at= rot= color= shine= name= [glass]
```

| Slot | What |
|---|---|
| r (bare) | Radius · default 0.6 · random: 0.3–0.96 |
| w | Slice (w) · Where the 3D slice cuts the 4D shape. · default 0 · random: -0.6666666666666666–0.6666666666666666 |
| spin | Spin · Degrees a second it turns in the xw plane. · default 0 · random: -30–30 |
| at | random: (-0.6…0.6)×3 |
| rot | random: (-45…45)×3 |
| color | random: a harmonious colour |
| shine | random: 0–0.8 |
| name | name |

Examples:

- `hypersphere` — on an empty graph (just an Output)

### tesseract

3D scene · maker. Tesseract: A 4D cube, cut corner-first: as W moves it goes from a point to a tetrahedron, an octahedron and back. Also: hypercube, 4d-cube.

Words: `tesseract`, `hypercube`, `4d-cube`

```
tesseract [size] round= w= spin= at= rot= color= shine= name= [glass]
```

| Slot | What |
|---|---|
| size (bare) | Size (half) · default 0.5 · random: 0.25–0.8 |
| round | Round · default 0.02 · random: 0.01–0.032 |
| w | Slice (w) · Where the 3D slice cuts the 4D shape. · default 0 · random: -0.6666666666666666–0.6666666666666666 |
| spin | Spin · Degrees a second it turns in the xw plane. · default 12 · random: 6–19.200000000000003 |
| at | random: (-0.6…0.6)×3 |
| rot | random: (-45…45)×3 |
| color | random: a harmonious colour |
| shine | random: 0–0.8 |
| name | name |

Examples:

- `tesseract` — on an empty graph (just an Output)

### duocylinder

3D scene · maker. Duocylinder: Two discs at right angles in 4D; turning, it rolls between a cylinder and a pill. Also: 4d-cylinder.

Words: `duocylinder`, `4d-cylinder`

```
duocylinder [r1] r2= w= spin= at= rot= color= shine= name= [glass]
```

| Slot | What |
|---|---|
| r1 (bare) | Radius xy · default 0.6 · random: 0.3–0.96 |
| r2 | Radius zw · default 0.45 · random: 0.225–0.7200000000000001 |
| w | Slice (w) · default 0 · random: -0.6666666666666666–0.6666666666666666 |
| spin | Spin · default 15 · random: 7.5–24 |
| at | random: (-0.6…0.6)×3 |
| rot | random: (-45…45)×3 |
| color | random: a harmonious colour |
| shine | random: 0–0.8 |
| name | name |

Examples:

- `duocylinder` — on an empty graph (just an Output)

### clifford-torus

3D scene · maker. Clifford torus: A torus on the 4D sphere: its slice is a pair of linked rings or a fat torus. Also: clifford, 4d-torus.

Words: `clifford-torus`, `clifford`, `4d-torus`

```
clifford-torus [r] t= w= spin= at= rot= color= shine= name= [glass]
```

| Slot | What |
|---|---|
| r (bare) | Radius · default 0.8 · random: 0.4–1.2800000000000002 |
| t | Thickness · default 0.15 · random: 0.075–0.24 |
| w | Slice (w) · default 0 · random: -0.6666666666666666–0.6666666666666666 |
| spin | Spin · default 9 · random: 4.5–14.4 |
| at | random: (-0.6…0.6)×3 |
| rot | random: (-45…45)×3 |
| color | random: a harmonious colour |
| shine | random: 0–0.8 |
| name | name |

Examples:

- `clifford-torus` — on an empty graph (just an Output)

### cell24

3D scene · maker. 24-cell: A regular 4D solid with no 3D relative; its slices are octahedra and their cousins. Also: icositetrachoron, twenty-four-cell.

Words: `cell24`, `icositetrachoron`, `twenty-four-cell`

```
cell24 [r] w= spin= at= rot= color= shine= name= [glass]
```

| Slot | What |
|---|---|
| r (bare) | Radius · default 0.7 · random: 0.35–1.1199999999999999 |
| w | Slice (w) · default 0 · random: -0.6666666666666666–0.6666666666666666 |
| spin | Spin · default 10 · random: 5–16 |
| at | random: (-0.6…0.6)×3 |
| rot | random: (-45…45)×3 |
| color | random: a harmonious colour |
| shine | random: 0–0.8 |
| name | name |

Examples:

- `cell24` — on an empty graph (just an Output)

### julia4d

3D scene · maker. Quaternion Julia: A 4D fractal, sliced: lumpy bulbs that curl into each other. Also: julia, quaternion-julia.

Words: `julia4d`, `julia`, `quaternion-julia`

```
julia4d [cx] cy= scale= w= spin= at= rot= color= shine= name= [glass]
```

| Slot | What |
|---|---|
| cx (bare) | c x · default -0.2 · random: -0.7–0.3 |
| cy | c y · default 0.6 · random: 0.3–0.96 |
| scale | Size · default 0.75 · random: 0.375–1.2000000000000002 |
| w | Slice (w) · default 0 · random: -0.6666666666666666–0.6666666666666666 |
| spin | Spin · default 6 · random: 3–9.600000000000001 |
| at | random: (-0.6…0.6)×3 |
| rot | random: (-45…45)×3 |
| color | random: a harmonious colour |
| shine | random: 0–0.8 |
| name | name |

Examples:

- `julia4d` — on an empty graph (just an Output)

### mandel4d

3D scene · maker. Quaternion Mandelbrot: The 4D Mandelbrot set, sliced: the familiar outline spun round and folded. Also: mandelbrot4d, quaternion-mandelbrot.

Words: `mandel4d`, `mandelbrot4d`, `quaternion-mandelbrot`

```
mandel4d [scale] w= spin= at= rot= color= shine= name= [glass]
```

| Slot | What |
|---|---|
| scale (bare) | Size · default 0.6 · random: 0.3–0.96 |
| w | Slice (w) · default 0 · random: -0.6666666666666666–0.6666666666666666 |
| spin | Spin · default 6 · random: 3–9.600000000000001 |
| at | random: (-0.6…0.6)×3 |
| rot | random: (-45…45)×3 |
| color | random: a harmonious colour |
| shine | random: 0–0.8 |
| name | name |

Examples:

- `mandel4d` — on an empty graph (just an Output)

### union( )

2D picture · combine. join: the nearer surface wins Also: add, combine. Old words (still read, with a hint): group.

Words: `union`, `add`, `combine`

```
union(a, b) name=
```

| Slot | What |
|---|---|
| name | name |

Examples:

- `union(sphere, box)` — on an empty graph (just an Output)

### smooth-union( )

2D picture · combine. melt together over k Also: blend, merge, smooth.

Words: `smooth-union`, `blend`, `merge`, `smooth`

```
smooth-union(a, b) [k] name=
```

| Slot | What |
|---|---|
| k (bare) | default 0.3 · random: 0.1–0.5 |
| name | name |

Examples:

- `smooth-union(sphere, box)` — on an empty graph (just an Output)

### subtract( )

2D picture · combine. cut the rest out of the first Also: cut, difference, minus.

Words: `subtract`, `cut`, `difference`, `minus`

```
subtract(a, b) name=
```

| Slot | What |
|---|---|
| name | name |

Examples:

- `subtract(sphere, box)` — on an empty graph (just an Output)

### smooth-subtract( )

2D picture · combine. a softened cut Also: smooth-cut.

Words: `smooth-subtract`, `smooth-cut`

```
smooth-subtract(a, b) [k] name=
```

| Slot | What |
|---|---|
| k (bare) | default 0.3 · random: 0.1–0.5 |
| name | name |

Examples:

- `smooth-subtract(sphere, box)` — on an empty graph (just an Output)

### intersect( )

2D picture · combine. only where all overlap Also: intersection, both.

Words: `intersect`, `intersection`, `both`

```
intersect(a, b) name=
```

| Slot | What |
|---|---|
| name | name |

Examples:

- `intersect(sphere, box)` — on an empty graph (just an Output)

### smooth-intersect( )

2D picture · combine. a rounded overlap

Words: `smooth-intersect`

```
smooth-intersect(a, b) [k] name=
```

| Slot | What |
|---|---|
| k (bare) | default 0.3 · random: 0.1–0.5 |
| name | name |

Examples:

- `smooth-intersect(sphere, box)` — on an empty graph (just an Output)

### move

3D scene · step. Move: Shifts what follows. Also: translate, offset.

Words: `move`, `translate`, `offset`

```
move [by]
```

| Slot | What |
|---|---|
| by (bare) | By · random: (-3.3333333333333335…3.3333333333333335)×3 |

Examples:

- `sphere · move` — on an empty graph (just an Output)

### turn

3D scene · step. Turn: Turns what follows about one axis.

Words: `turn`

```
turn axis= [angle]
```

| Slot | What |
|---|---|
| axis | x, y, z |
| angle (bare) | Angle · default 0 · random: -120–120 |

Examples:

- `sphere · turn` — on an empty graph (just an Output)

### rotate

3D scene · step. Rotate: Turns what follows about X, then Y, then Z (degrees), like a shape's own Rotation. Also: rotation.

Words: `rotate`, `rotation`

```
rotate [by]
```

| Slot | What |
|---|---|
| by (bare) | Degrees · About X, then Y, then Z. · random: (-60…60)×3 |

Examples:

- `sphere · rotate` — on an empty graph (just an Output)

### scale

3D scene · step. Scale: Makes what follows bigger (above 1) or smaller, keeping distances exact. Also: resize, grow.

Words: `scale`, `resize`, `grow`

```
scale [s]
```

| Slot | What |
|---|---|
| s (bare) | Factor · default 1.5 · random: 0.75–2.4000000000000004 |

Examples:

- `sphere · scale` — on an empty graph (just an Output)

### repeat

3D scene · step. Repeat: Endless copies, one per cell. Keep each copy inside its cell. Also: tile, grid.

Words: `repeat`, `tile`, `grid`

```
repeat [cell]
```

| Slot | What |
|---|---|
| cell (bare) | Cell size · random: (1…3.2)×3 |

Examples:

- `sphere · repeat` — on an empty graph (just an Output)

### mirror-repeat

3D scene · step. Mirrored repeat: Endless copies, every other one flipped, so neighbours meet seamlessly. Also: mirrored-repeat, flip-repeat.

Words: `mirror-repeat`, `mirrored-repeat`, `flip-repeat`

```
mirror-repeat [cell]
```

| Slot | What |
|---|---|
| cell (bare) | Cell size · random: (1…3.2)×3 |

Examples:

- `sphere · mirror-repeat` — on an empty graph (just an Output)

### limited-repeat

3D scene · step. Limited repeat: A few copies each way. Also: repeat-n, array.

Words: `limited-repeat`, `repeat-n`, `array`

```
limited-repeat [cell] count=
```

| Slot | What |
|---|---|
| cell (bare) | Cell size · random: (0.5…1.6)×3 |
| count | Copies each way · random: (1…3.2)×3 |

Examples:

- `sphere · limited-repeat` — on an empty graph (just an Output)

### mirror

3D scene · step. Mirror: One half of space mirrored onto the other, on the chosen axes. Also: symmetry, abs.

Words: `mirror`, `symmetry`, `abs`

```
mirror axes=
```

| Slot | What |
|---|---|
| axes | x, y, z, xy, xz, yz, xyz |

Examples:

- `sphere · mirror` — on an empty graph (just an Output)

### fold

3D scene · step. Fold: Mirror with an offset: folds space along planes, the move fractals repeat. Also: mirror-fold.

Words: `fold`, `mirror-fold`

```
fold axes= [offset]
```

| Slot | What |
|---|---|
| axes | x, y, z, xy, xz, yz, xyz |
| offset (bare) | Offset · random: (-0.6666666666666666…0.6666666666666666)×3 |

Examples:

- `sphere · fold` — on an empty graph (just an Output)

### polar-repeat

3D scene · step. Polar repeat: Copies round an axis, like slices of a cake. Also: radial, around, polar.

Words: `polar-repeat`, `radial`, `around`, `polar`

```
polar-repeat axis= [count]
```

| Slot | What |
|---|---|
| axis | y, x, z |
| count (bare) | Copies · default 6 · random: 3–9.600000000000001 |

Examples:

- `sphere · polar-repeat` — on an empty graph (just an Output)

### kaleido

3D scene · step. Kaleidoscope: Repeated mirror folds with the symmetry of a solid. Also: kaleidoscope.

Words: `kaleido`, `kaleidoscope`

```
kaleido [n] sym=
```

| Slot | What |
|---|---|
| n (bare) | Folds · default 3 · random: 1.5–4.800000000000001 |
| sym | oct, tet, icos |

Examples:

- `sphere · kaleido` — on an empty graph (just an Output)

### twist

3D scene · step. Twist: Turns space round the up axis more the higher it goes.

Words: `twist`

```
twist [k]
```

| Slot | What |
|---|---|
| k (bare) | Amount · default 2 · random: 1–3.2 |

Examples:

- `sphere · twist` — on an empty graph (just an Output)

### bend

3D scene · step. Bend: Curves space along X. Also: curve.

Words: `bend`, `curve`

```
bend [k]
```

| Slot | What |
|---|---|
| k (bare) | Amount · default 0.5 · random: 0.25–0.8 |

Examples:

- `sphere · bend` — on an empty graph (just an Output)

### sine

3D scene · step. Sine warp: Shifts one axis by a sine of another. Also: wave, sin, sine-warp.

Words: `sine`, `wave`, `sin`, `sine-warp`

```
sine axis= [amp] freq= from=
```

| Slot | What |
|---|---|
| axis | x, y, z |
| amp (bare) | Amplitude · default 0.1 · random: 0.05–0.16000000000000003 |
| freq | Frequency · default 2 · random: 1–3.2 |
| from | x, y, z |

Examples:

- `sphere · sine` — on an empty graph (just an Output)

### warp

3D scene · step. Noise warp: Pushes space about with smooth noise: lumpy, organic shapes. Also: domain-warp. Old words (still read, with a hint): noise.

Words: `warp`, `domain-warp`

```
warp [amt] scale= octaves=
```

| Slot | What |
|---|---|
| amt (bare) | Strength · default 0.3 · random: 0.15–0.48 |
| scale | Scale · default 1 · random: 0.5–1.6 |
| octaves | Octaves · default 3 · random: 1.5–4.800000000000001 |

Examples:

- `sphere · warp` — on an empty graph (just an Output)

### displace

3D scene · step. Displace: Bumps on the surface: adds a 3D sine pattern to the distance. Also: bumps, ripple.

Words: `displace`, `bumps`, `ripple`

```
displace [amp] freq=
```

| Slot | What |
|---|---|
| amp (bare) | Amplitude · default 0.05 · random: 0.025–0.08000000000000002 |
| freq | Frequency · default 8 · random: 4–12.8 |

Examples:

- `sphere · displace` — on an empty graph (just an Output)

### round

3D scene · step. Round: Rounds every edge and corner by growing the surface outward this much. Also: inflate, soften.

Words: `round`, `inflate`, `soften`

```
round [r]
```

| Slot | What |
|---|---|
| r (bare) | Radius · default 0.05 · random: 0.025–0.08000000000000002 |

Examples:

- `sphere · round` — on an empty graph (just an Output)

### onion

3D scene · step. Onion: Hollows it into a thin shell of this thickness (cut it open to see inside). Also: shell, hollow.

Words: `onion`, `shell`, `hollow`

```
onion [t]
```

| Slot | What |
|---|---|
| t (bare) | Thickness · default 0.03 · random: 0.015–0.048 |

Examples:

- `sphere · onion` — on an empty graph (just an Output)

### sun

3D scene · setting. the sun's direction and colour

Words: `sun`

```
sun [dir] color=
```

| Slot | What |
|---|---|
| dir (bare) | vec3 |
| color | colour |

Examples:

- `sphere · sun dir=(1,2,1)` — on an empty graph (just an Output)

### sky

3D scene · setting. light from above

Words: `sky`

```
sky [color]
```

| Slot | What |
|---|---|
| color (bare) | random: a harmonious colour |

Examples:

- `sphere · sky (0.5,0.6,0.9)` — on an empty graph (just an Output)

### bounce

3D scene · setting. light from below

Words: `bounce`

```
bounce [color]
```

| Slot | What |
|---|---|
| color (bare) | colour |

Examples:

- `sphere · bounce (0.3,0.2,0.1)` — on an empty graph (just an Output)

### shadows

3D scene · setting. soft shadows: hardness (8 soft … 32 hard) or off Also: shadow.

Words: `shadows`, `shadow`

```
shadows [hardness]
```

| Slot | What |
|---|---|
| hardness (bare) | random: 6–32 |

Examples:

- `sphere · shadows 16` — on an empty graph (just an Output)

### ao

3D scene · setting. ambient occlusion: step or off Also: occlusion.

Words: `ao`, `occlusion`

```
ao [step]
```

| Slot | What |
|---|---|
| step (bare) | number |

Examples:

- `sphere · ao 0.06` — on an empty graph (just an Output)

### fog

3D scene · setting. distance fades into fog

Words: `fog`

```
fog [density] color=
```

| Slot | What |
|---|---|
| density (bare) | random: 0.05–0.5 |
| color | colour |

Examples:

- `sphere · fog 0.3` — on an empty graph (just an Output)

### background

3D scene · setting. the background colour or gradient Also: bg.

Words: `background`, `bg`

```
background [top] bottom=
```

| Slot | What |
|---|---|
| top (bare) | colour |
| bottom | colour |

Examples:

- `sphere · background navy` — on an empty graph (just an Output)

### tone

3D scene · setting. tone map

Words: `tone`

```
tone [mode]
```

| Slot | What |
|---|---|
| mode (bare) | aces, agx, hable, reinhard2, tanh, oklab, none |

Examples:

- `sphere · tone agx` — on an empty graph (just an Output)

### camera

3D scene · setting. the orbit camera Also: cam.

Words: `camera`, `cam`

```
camera [dist] angle= elev= orbit= zoom= flatten= x= y= z=
```

| Slot | What |
|---|---|
| dist (bare) | random: 3–6 |
| angle | number |
| elev | random: 5–35 |
| orbit | random: 0–15 |
| zoom | number |
| flatten | number |
| x | number |
| y | number |
| z | number |

Examples:

- `sphere · camera dist=5 orbit=10` — on an empty graph (just an Output)

### quality

3D scene · setting. the march's steps and limits

Words: `quality`

```
quality steps= dist= step= jitter= warp=
```

| Slot | What |
|---|---|
| steps | number |
| dist | number |
| step | number |
| jitter | number |
| warp | off, auto, careful, high |

Examples:

- `sphere · quality steps=128` — on an empty graph (just an Output)

### output

Edits · output. What a 3D scene shows (depth, normal, hit…), or (in an edit) wires a node to the Output. Old words (still read, with a hint): show.

Words: `output`

```
output [show] palette=
```

| Slot | What |
|---|---|
| show (bare) | picture, depth, distance, height, normal, hit, position, steps, ao, shadow |
| palette | sunset, rainbow, fire, forest, teal, warm, haze, psychedelic, mono, heat, ice, terrain |

Examples:

- `sphere · output depth` — on an empty graph (just an Output)
- `output glow` — on an empty graph (just an Output)

### mix( )

2D picture · combine. Mixes two colours (OkLab Mix). Also: blend-colours.

Words: `mix`, `blend-colours`

```
mix(a, b) [by]
```

| Slot | What |
|---|---|
| by (bare) | default 0.5 · random: 0.2–0.8 |

Examples:

- `mix(palette, glow) by=0.3` — on an empty graph (just an Output)

### screen( )

2D picture · combine. Screen blend: the second over the first, only brightening.

Words: `screen`

```
screen(a, b)
```

Examples:

- `screen(palette, glow)` — on an empty graph (just an Output)

### overlay( )

2D picture · combine. Overlay blend.

Words: `overlay`

```
overlay(a, b)
```

Examples:

- `overlay(palette, glow)` — on an empty graph (just an Output)

### group( )

Edits · combine. Puts nodes into a group (as Group selection does). Goes last. Also: bundle.

Words: `group`, `bundle`

```
group(a, b) [name]
```

| Slot | What |
|---|---|
| name (bare) | name |

Examples:

- `group(circle, glow) name="Neon"` — on an empty graph (just an Output)

### create

Edits · verb. Adds a shape (with its UV) or any node by name. Modifiers after it set its values; a value only a move has (falloff → Glow) adds that move.

Words: `create`

```
create
```

### connect

Edits · verb. Wires an output into an input. Without an input name it takes the first free input that fits; the type check runs first. Also: wire.

Words: `connect`, `wire`

```
connect
```

### disconnect

Edits · verb. Removes wires. "Disconnect X" removes the wires out of X (from the Output only, when X is the current output); "from Y" only those into Y; "the <input> of Y" clears one input. Also: unplug, unwire, unlink, detach.

Words: `disconnect`, `unplug`, `unwire`, `unlink`, `detach`

```
disconnect
```

### reconnect

Edits · verb. Moves a node's outgoing wires: unplugs everything it feeds, then connects it to the new node. Also: rewire, reroute.

Words: `reconnect`, `rewire`, `reroute`

```
reconnect
```

### insert

Edits · verb. Puts a new node on a wire: between two wired nodes, after a node (on every wire out of it) or before one (on its first wired input). Also: slot, splice.

Words: `insert`, `slot`, `splice`

```
insert
```

### switch

Edits · verb. Switches a node to another type in place, keeping its wires and settings (the card's Switch to). Refused when a wire would have nowhere to go, with the types that would work.

Words: `switch`

```
switch
```

### delete

Edits · verb. Removes nodes and the wires into and out of them. Also: remove, erase.

Words: `delete`, `remove`, `erase`

```
delete
```

### rename

Edits · verb. Gives a node a name of its own (its card label). Quote names with spaces.

Words: `rename`

```
rename
```

### duplicate

Edits · verb. Copies a node next to it, with the same settings and the same wires in (nothing reads the copy yet). Also: clone.

Words: `duplicate`, `clone`

```
duplicate
```

### set

Edits · verb. Sets a setting to a value: a number, a colour word, a choice by name, on or off. The setting is found by its name, its label or a vocabulary word (falloff, size, speed…).

Words: `set`

```
set
```

### select

Edits · verb. Selects nodes (no change to the graph), so the next command, or the next "this", works on them. Also: highlight.

Words: `select`, `highlight`

```
select
```

### count

Grid Rules · header. A count rule (the rule type), starting from its first preset.

Words: `count`

```
count
```

Examples:

- `grid count` — on an empty graph (just an Output)

### stages

Grid Rules · header. A stages rule (the rule type), starting from its first preset.

Words: `stages`

```
stages
```

Examples:

- `grid stages` — on an empty graph (just an Output)

### smooth

Grid Rules · header. A smooth rule (the rule type), starting from its first preset.

Words: `smooth`

```
smooth
```

Examples:

- `grid smooth` — on an empty graph (just an Output)

### patterns

Grid Rules · header. A patterns rule (the rule type), starting from its first preset.

Words: `patterns`

```
patterns
```

Examples:

- `grid patterns` — on an empty graph (just an Output)

### blocks

Grid Rules · header. A blocks rule (the rule type), starting from its first preset.

Words: `blocks`

```
blocks
```

Examples:

- `grid blocks` — on an empty graph (just an Output)

### life

Grid Rules · header. Life (count): B3/S23, Conway's Game of Life: gliders, blinkers, still lifes. Also: conway, game-of-life.

Words: `life`, `conway`, `game-of-life`

```
life
```

Examples:

- `grid life` — on an empty graph (just an Output)

### highlife

Grid Rules · header. HighLife (count): B36/S23: Life plus a replicator. Also: high-life.

Words: `highlife`, `high-life`

```
highlife
```

Examples:

- `grid highlife` — on an empty graph (just an Output)

### seeds

Grid Rules · header. Seeds (count): B2/S: every live cell dies at once; explodes into sparks.

Words: `seeds`

```
seeds
```

Examples:

- `grid seeds` — on an empty graph (just an Output)

### day-and-night

Grid Rules · header. Day & Night (count): B3678/S34678: live and dead behave the same way round.

Words: `day-and-night`

```
day-and-night
```

Examples:

- `grid day-and-night` — on an empty graph (just an Output)

### maze

Grid Rules · header. Maze (count): B3/S12345: grows corridors.

Words: `maze`

```
maze
```

Examples:

- `grid maze` — on an empty graph (just an Output)

### coral

Grid Rules · header. Coral (count): B3/S45678: slow coral growth.

Words: `coral`

```
coral
```

Examples:

- `grid coral` — on an empty graph (just an Output)

### anneal

Grid Rules · header. Anneal (count): B4678/S35678: blobs that smooth their edges (the "twisted majority").

Words: `anneal`

```
anneal
```

Examples:

- `grid anneal` — on an empty graph (just an Output)

### diamoeba

Grid Rules · header. Diamoeba (count): B35678/S5678: diamond-shaped amoebas.

Words: `diamoeba`

```
diamoeba
```

Examples:

- `grid diamoeba` — on an empty graph (just an Output)

### replicator

Grid Rules · header. Replicator (count): B1357/S1357: every pattern copies itself.

Words: `replicator`

```
replicator
```

Examples:

- `grid replicator` — on an empty graph (just an Output)

### life-without-death

Grid Rules · header. Life without Death (count): B3/S012345678: cells are born as in Life and never die: ladders and crystals.

Words: `life-without-death`

```
life-without-death
```

Examples:

- `grid life-without-death` — on an empty graph (just an Output)

### diamonds

Grid Rules · header. Diamonds (von Neumann) (count): B1/S1234 on the 4 neighbours: grows diamond rings.

Words: `diamonds`

```
diamonds
```

Examples:

- `grid diamonds` — on an empty graph (just an Output)

### caves

Grid Rules · header. Caves (count): B5678/S45678 from a 45% fill: noise settles into smooth cave walls in a few steps (the roguelike cave generator).

Words: `caves`

```
caves
```

Examples:

- `grid caves` — on an empty graph (just an Output)

### bosco

Grid Rules · header. Bosco (radius 5) (count): Larger than Life, radius 5: born on 34–45, survive on 33–57 (Evans's Bosco's rule): moving blobs.

Words: `bosco`

```
bosco
```

Examples:

- `grid bosco` — on an empty graph (just an Output)

### majority

Grid Rules · header. Majority (radius 4) (count): Larger than Life, radius 4: a cell takes the side most of its 9×9 block is on. Noise melts into smooth islands.

Words: `majority`

```
majority
```

Examples:

- `grid majority` — on an empty graph (just an Output)

### brians-brain

Grid Rules · header. Brian's Brain (stages): /2/3: off → on with exactly 2 on neighbours, on → dying, dying → off. Endless gliding sparks. Also: brian.

Words: `brians-brain`, `brian`

```
brians-brain
```

Examples:

- `grid brians-brain` — on an empty graph (just an Output)

### star-wars

Grid Rules · header. Star Wars (stages): 345/2/4: sparks that build stable walls.

Words: `star-wars`

```
star-wars
```

Examples:

- `grid star-wars` — on an empty graph (just an Output)

### frogs

Grid Rules · header. Frogs (stages): 12/34/3: hopping blobs.

Words: `frogs`

```
frogs
```

Examples:

- `grid frogs` — on an empty graph (just an Output)

### sticks

Grid Rules · header. Sticks (stages): 3456/2/6: crawling sticks.

Words: `sticks`

```
sticks
```

Examples:

- `grid sticks` — on an empty graph (just an Output)

### spirals

Grid Rules · header. Spirals (stages): 2/234/5: spiral waves.

Words: `spirals`

```
spirals
```

Examples:

- `grid spirals` — on an empty graph (just an Output)

### swirl

Grid Rules · header. Swirl (stages): 23/34/8: swirling fronts with long tails.

Words: `swirl`

```
swirl
```

Examples:

- `grid swirl` — on an empty graph (just an Output)

### lava

Grid Rules · header. Lava (stages): 12345/45678/8: flowing lava.

Words: `lava`

```
lava
```

Examples:

- `grid lava` — on an empty graph (just an Output)

### bloomerang

Grid Rules · header. Bloomerang (stages): 234/34678/24: blooms with very long tails.

Words: `bloomerang`

```
bloomerang
```

Examples:

- `grid bloomerang` — on an empty graph (just an Output)

### heat

Grid Rules · header. Heat (smooth): Diffusion: every cell drifts towards its neighbours' average and cools a little. Also: diffusion.

Words: `heat`, `diffusion`

```
heat
```

Examples:

- `grid heat` — on an empty graph (just an Output)

### ripples

Grid Rules · header. Ripples (smooth): The two-buffer wave: height and last height; the mouse drops ripples. Also: water, waves-preset.

Words: `ripples`, `water`, `waves-preset`

```
ripples
```

Examples:

- `grid ripples` — on an empty graph (just an Output)

### mitosis

Grid Rules · header. Mitosis (smooth): Gray–Scott reaction–diffusion, feed 0.0367 kill 0.0649: dividing cells. Also: reaction-diffusion, gray-scott.

Words: `mitosis`, `reaction-diffusion`, `gray-scott`

```
mitosis
```

Examples:

- `grid mitosis` — on an empty graph (just an Output)

### coral-growth

Grid Rules · header. Coral growth (smooth): Gray–Scott, feed 0.0545 kill 0.062: branching coral.

Words: `coral-growth`

```
coral-growth
```

Examples:

- `grid coral-growth` — on an empty graph (just an Output)

### worms

Grid Rules · header. Worms (smooth): Gray–Scott, feed 0.078 kill 0.061: wriggling worms.

Words: `worms`

```
worms
```

Examples:

- `grid worms` — on an empty graph (just an Output)

### spots

Grid Rules · header. Spots (smooth): Gray–Scott, feed 0.035 kill 0.065: spots that split.

Words: `spots`

```
spots
```

Examples:

- `grid spots` — on an empty graph (just an Output)

### labyrinth

Grid Rules · header. Labyrinth (smooth): Gray–Scott, feed 0.029 kill 0.057: a maze of stripes.

Words: `labyrinth`

```
labyrinth
```

Examples:

- `grid labyrinth` — on an empty graph (just an Output)

### wireworld

Grid Rules · header. Wireworld (patterns): Silverman's Wireworld: 1 head → 2 tail → 3 copper; copper → head with 1 or 2 heads round it. Also: wire-world.

Words: `wireworld`, `wire-world`

```
wireworld
```

Examples:

- `grid wireworld` — on an empty graph (just an Output)

### falling-dots

Grid Rules · header. Falling dots (patterns): An on cell with nothing below it moves down one cell: the empty cell below takes it, the cell itself empties.

Words: `falling-dots`

```
falling-dots
```

Examples:

- `grid falling-dots` — on an empty graph (just an Output)

### crystal

Grid Rules · header. Crystal (patterns): An empty cell with exactly one on cell round it turns on: arms that branch like frost.

Words: `crystal`

```
crystal
```

Examples:

- `grid crystal` — on an empty graph (just an Output)

### falling-sand

Grid Rules · header. Falling sand (blocks): Grains (1) fall into empty cells (0), slide off each other down to the side, and rest on walls (2) and the floor. Jitter 1 keeps a falling cloud from showing in bands. Nothing is lost or made. Also: sand.

Words: `falling-sand`, `sand`

```
falling-sand
```

Examples:

- `grid falling-sand` — on an empty graph (just an Output)

### gas

Grid Rules · header. Gas (HPP) (blocks): Particles move diagonally, one cell a step; two meeting head-on bounce off at right angles (Toffoli and Margolus's HPP gas). Every particle is kept. Also: hpp.

Words: `gas`, `hpp`

```
gas
```

Examples:

- `grid gas` — on an empty graph (just an Output)

### stencil

Grid Rules · action. A Patterns rule: 3×3 cells (. any, * not empty, a state) → the state the middle becomes. @turns / @turns-mirrors for every orientation.

Words: `stencil`

```
stencil count=
```

| Slot | What |
|---|---|
| count | state:min..max neighbours, like count=1:1..2 |

Examples:

- `stencil .../.1./... → 2` — on an empty graph (just an Output)
- `stencil .../.3./... → 1 count=1:1..2` — on an empty graph (just an Output)

### block

Grid Rules · action. A Blocks rule: 2×2 before → after (= unchanged). @mirror / @turns; chance= per block.

Words: `block`

```
block chance=
```

| Slot | What |
|---|---|
| chance | random: 0.3–1 |

Examples:

- `block 11/00 → 00/11` — on an empty graph (just an Output)
- `block 10/*0 → 00/=1 @mirror chance=0.8` — on an empty graph (just an Output)

### colours

Grid Rules · setting. Colours of the states (empty=, on=, dying=, c0= … c7=), the afterglow (glow=) and old cells (old=). Also: colors.

Words: `colours`, `colors`

```
colours empty= on= dying= glow= old= c0= c1= c2= c3= c4= c5= c6= c7=
```

| Slot | What |
|---|---|
| empty | random: a harmonious colour |
| on | random: a harmonious colour |
| dying | random: a harmonious colour |
| glow | random: a harmonious colour |
| old | random: a harmonious colour |
| c0 | random: a harmonious colour |
| c1 | random: a harmonious colour |
| c2 | random: a harmonious colour |
| c3 | random: a harmonious colour |
| c4 | random: a harmonious colour |
| c5 | random: a harmonious colour |
| c6 | random: a harmonious colour |
| c7 | random: a harmonious colour |

Examples:

- `grid life · colours on=green empty=black` — on an empty graph (just an Output)

### brush

Grid Rules · setting. The mouse brush: its size, the state it paints and how thickly.

Words: `brush`

```
brush [size] state= fill=
```

| Slot | What |
|---|---|
| size (bare) | number |
| state | count |
| fill | number |

Examples:

- `grid life · brush size=5 fill=0.3` — on an empty graph (just an Output)

### agents

Agent Rules · header. The rule set: what kind of walkers, what the edges do, how far they see each other.

Words: `agents`

```
agents kind= edges= view= view-max=
```

| Slot | What |
|---|---|
| kind | trail, particles, flock, ants, swarm, crowd |
| edges | wrap, bounce, slide |
| view | random: 0.02–0.08 |
| view-max | count |

Examples:

- `agents kind=flock edges=bounce view=0.05` — on an empty graph (just an Output)

### sensors

Agent Rules · setting. The trail sensors: how far ahead and how wide.

Words: `sensors`

```
sensors ahead= angle=
```

| Slot | What |
|---|---|
| ahead | random: 0.015–0.06 (log) |
| angle | random: 15–60, whole |

Examples:

- `sensors ahead=0.035 angle=22.5deg` — on an empty graph (just an Output)

### flow

Agent Rules · setting. The flow field (curl noise) follow flow reads.

Words: `flow`

```
flow size= evolve=
```

| Slot | What |
|---|---|
| size | random: 0.6–2 |
| evolve | random: 0.05–0.4 |

Examples:

- `flow size=1.2 evolve=0.2` — on an empty graph (just an Output)

### channels

Agent Rules · setting. Names for the four trail channels (_ for a blank one).

Words: `channels`

```
channels
```

Examples:

- `channels home, food` — on an empty graph (just an Output)

### masks

Agent Rules · setting. Up to two masks (inputs on the group card); Name:texture for a texture.

Words: `masks`

```
masks
```

Examples:

- `masks Food, Nest` — on an empty graph (just an Output)

### species

Agent Rules · header. A species: its name, speed and states, then its rules (indented, or after a colon on one line).

Words: `species`

```
species speed= states=
```

| Slot | What |
|---|---|
| speed | random: 0.1–1.2 (log) |
| states | list |

Examples:

- `species Ants speed=0.3 states=searching,carrying` — on an empty graph (just an Output)
- `species Slime: always do wander 7deg` — on an empty graph (just an Output)

### state

Agent Rules · setting. A state's colour, under its species.

Words: `state`

```
state color=
```

| Slot | What |
|---|---|
| color | random: a harmonious colour |

Examples:

- `state carrying color=gold` — on an empty graph (just an Output)

### when

Agent Rules · header. A rule: when <condition> and … do <action>, …  (or always do …); @last stops after it, @off switches it off. Also: always.

Words: `when`, `always`

```
when
```

Examples:

- `when searching and food anywhere > 0.05 do turn toward food 20deg` — on an empty graph (just an Output)
- `always do wander 7deg` — on an empty graph (just an Output)

### near

Agent Rules · condition. Condition: near another species' trail.

Words: `near`

```
near
```

### chance

Agent Rules · condition. Condition: random chance.

Words: `chance`

```
chance
```

### age

Agent Rules · condition. Condition: age.

Words: `age`

```
age
```

### memory

Agent Rules · condition. Condition: Memory number.

Words: `memory`

```
memory
```

### mask

Agent Rules · condition. Condition: inside a mask.

Words: `mask`

```
mask
```

### neighbours

Agent Rules · condition. Condition: neighbours within reach.

Words: `neighbours`

```
neighbours
```

### shape

Agent Rules · condition. Condition: inside a shape.

Words: `shape`

```
shape
```

### turn

Agent Rules · action. Action: turn toward / away.

Words: `turn`

```
turn
```

Examples:

- `turn toward food 20deg` — on an empty graph (just an Output)
- `turn away mouse 30deg` — on an empty graph (just an Output)
- `turn around` — on an empty graph (just an Output)

### wander

Agent Rules · action. Action: wander.

Words: `wander`

```
wander
```

Examples:

- `wander 7deg` — on an empty graph (just an Output)

### speed

Agent Rules · action. Action: set speed / accelerate.

Words: `speed`

```
speed
```

Examples:

- `speed 0.4` — on an empty graph (just an Output)

### accelerate

Agent Rules · action. Action: set speed / accelerate.

Words: `accelerate`

```
accelerate
```

Examples:

- `accelerate 0.1/s` — on an empty graph (just an Output)

### leave

Agent Rules · action. Action: leave trail.

Words: `leave`

```
leave
```

Examples:

- `leave food 1 fade=0.15` — on an empty graph (just an Output)

### become

Agent Rules · action. Action: change state.

Words: `become`

```
become
```

Examples:

- `become carrying` — on an empty graph (just an Output)

### stop

Agent Rules · action. Action: stop.

Words: `stop`

```
stop
```

Examples:

- `stop` — on an empty graph (just an Output)

### stick

Agent Rules · action. Action: stick.

Words: `stick`

```
stick
```

Examples:

- `stick` — on an empty graph (just an Output)

### die

Agent Rules · action. Action: die.

Words: `die`

```
die
```

Examples:

- `die` — on an empty graph (just an Output)

### spawn

Agent Rules · action. Action: spawn a child.

Words: `spawn`

```
spawn
```

Examples:

- `spawn 1` — on an empty graph (just an Output)

### follow

Agent Rules · action. Action: follow a flow field.

Words: `follow`

```
follow
```

Examples:

- `follow flow 10deg` — on an empty graph (just an Output)

### against

Agent Rules · action. Action: follow a flow field.

Words: `against`

```
against
```

Examples:

- `against flow 10deg` — on an empty graph (just an Output)

### align

Agent Rules · action. Action: align with the crowd (via trail).

Words: `align`

```
align
```

Examples:

- `align 10deg` — on an empty graph (just an Output)

### separate

Agent Rules · action. Action: steer away from neighbours.

Words: `separate`

```
separate
```

Examples:

- `separate 12deg who=others radius=0.045` — on an empty graph (just an Output)

### match

Agent Rules · action. Action: match neighbours' heading.

Words: `match`

```
match
```

Examples:

- `match 6deg` — on an empty graph (just an Output)

### cohere

Agent Rules · action. Action: move to their centre.

Words: `cohere`

```
cohere
```

Examples:

- `cohere 3deg` — on an empty graph (just an Output)

### slow

Agent Rules · action. Action: slow down in a crowd.

Words: `slow`

```
slow
```

Examples:

- `slow jam=20` — on an empty graph (just an Output)

### avoid-edges

Agent Rules · action. Action: avoid edges.

Words: `avoid-edges`

```
avoid-edges
```

Examples:

- `avoid-edges 12deg margin=0.1` — on an empty graph (just an Output)

### orbit

Agent Rules · action. Action: orbit a point.

Words: `orbit`

```
orbit
```

Examples:

- `orbit centre 8deg distance=0.5 cw` — on an empty graph (just an Output)

### force

Agent Rules · action. Action: apply a force.

Words: `force`

```
force
```

Examples:

- `force gravity 0.75 angle=-90deg` — on an empty graph (just an Output)
- `force toward mouse 1` — on an empty graph (just an Output)

### drag

Agent Rules · action. Action: drag (slow down).

Words: `drag`

```
drag
```

Examples:

- `drag 0.35` — on an empty graph (just an Output)

### fade

Agent Rules · action. Action: fade with age.

Words: `fade`

```
fade
```

Examples:

- `fade 3s` — on an empty graph (just an Output)

## Limits

- One level at a time: commands work on the graph level being edited (inside a group, its nodes); "output" needs the top level.
- Group goes last in a sentence, and the Output can't be grouped.
- References name nodes by type, label, role or position; a node's id is not a word.
- Build actions on a node named in the clause ("glow the circle") work on one node; two-node moves use "these".
- Relative changes move one setting (the first that fits its role); name the setting for another ("increase the speed of the noise").
- Unknown words in a build clause are listed and skipped; an edit clause with an unknown reference is refused with suggestions.
