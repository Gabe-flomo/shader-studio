# The Playfield language

<!-- Generated from src/lang/registry.ts and src/lang/reference.ts by `npm run docs:language`. Don't edit by hand: a test fails when it is out of date. -->

One language for the Do… bar, the 3D Scene Builder's recipe, Grid Rules and Agent Rules (the plan and its decisions: [playfield-language-plan.md](playfield-language-plan.md)).
A line is **clauses** separated by `·` (or `•`, `|`, `;`, a new line). A clause is a **head word** and its settings: `key=value`, the primary value bare (`twist 0.5`), flags (`glass`, `walls`), `(…)` for items, `@modifier(…)` for one item.
Plain English in the Do… bar is sugar: the bar shows each sentence's canonical line under the box.

```
circle r=0.3 · glow falloff=8 · colour by length                          2D picture
surface · sphere r=1 @move(0,1,0) · smooth-union(box, torus) k=0.5        3D scene
grid life walls board=480                                                  Grid Rules
species Ants: when searching and food ahead > 0.5 do become carrying       Agent Rules
noise · colour by it · pass "Soft" scale=1/2 · blur 4                      passes
connect noise → glow.tint · set glow falloff=8                             edits
```

## Values

| Value | Written |
|---|---|
| number | `1`, `-0.5`, `.25`, `1e-3`; angles `30deg` `30°` `0.5rad`; time `0.5s` `200ms`; rate `1/s`; percent `60%`; count `6x` |
| vector | `(x,y)`, `(x,y,z)`; one number fills every part |
| colour | `#rgb`, `#rrggbb`, `(r,g,b)` in 0–1, or a name: white black grey gray silver red orange yellow gold green lime teal cyan blue navy purple violet pink magenta brown cream sky night warm cool neon fire ice |
| list, range | `survive=2,3`, `born=34..45` |
| name | `Body`, `"My shape"` |
| code | `{u + 0.2 * lap_u}` (one line of GLSL) |
| random | `random`, `random(0.2..2)`, `random(red, teal)`; a leading `random` draws every unset setting; `seed=42` (or a word) repeats it |
| palette | sunset, rainbow, fire, forest, teal, warm, haze, psychedelic, mono, heat, ice, terrain |

## References (edits)

Edit verbs leave "the" out: `set glow falloff=8`. A clause that is only a reference keeps it: `the hexagon · glow`.

| Form | Means |
|---|---|
| `it` | what the clause before made (first: the selection, else what the Output shows) |
| `this`, `these` | the selected node, the selected nodes |
| `picture` | what the Output shows |
| `"Halo"` | the node labelled Halo |
| `circle`, `circle#2`, `circle#last` | a node by its type or shape word, by canvas order |
| `glow.tint` | an input of a node |
| `before output`, `after circle` | along the chain |
| `all circles`, `circle and glow` | several |

## Choosing the dialect

- A header decides: `grid`, `agents` / `species`, a render mode (`surface`, `volumetric`, `glass`, `gi`).
- Otherwise a line with a 3D-only word (a 3D shape, a scene setting, an `@` warp) is a 3D scene, and anything else a 2D picture or an edit.
- A line that mixes 3D-only and 2D-only words is refused: one line is one or the other.
- `grid` is needed only where a preset's name is also another word (`grid swirl`, `grid ripples`).
- Agent rules on one line follow their species after a colon: `species Slime: always do wander 7deg`.

## 2D picture

| Head | Also | Settings | Example |
|---|---|---|---|
| `circle [r] color= at=` | disc, disk, dot, blob | r (bare): Size · default 0.25 · random: 0.1–0.35; color: Colour · random: a harmonious colour; at: Where · middle, top, bottom, left, right, top-left, top-right, bottom-left, bottom-right · default middle · random: middle \| middle \| top-left \| top-right \| bottom-left \| bottom-right \| left \| right | `circle · glow` |
| `sphere [r] color= at=` | ball, orb | r (bare): Size · default 0.25 · random: 0.1–0.35; color: Colour · random: a harmonious colour; at: Where · middle, top, bottom, left, right, top-left, top-right, bottom-left, bottom-right · default middle · random: middle \| middle \| top-left \| top-right \| bottom-left \| bottom-right \| left \| right | `sphere · glow` |
| `box [r] color= at=` | square, rectangle, rect, block, roundbox | r (bare): Size · default 0.25 · random: 0.1–0.35; color: Colour · random: a harmonious colour; at: Where · middle, top, bottom, left, right, top-left, top-right, bottom-left, bottom-right · default middle · random: middle \| middle \| top-left \| top-right \| bottom-left \| bottom-right \| left \| right | `box · glow` |
| `cube [r] color= at=` |  | r (bare): Size · default 0.25 · random: 0.1–0.35; color: Colour · random: a harmonious colour; at: Where · middle, top, bottom, left, right, top-left, top-right, bottom-left, bottom-right · default middle · random: middle \| middle \| top-left \| top-right \| bottom-left \| bottom-right \| left \| right | `cube · glow` |
| `ring [r] color= at=` | hoop, annulus | r (bare): Size · default 0.25 · random: 0.1–0.35; color: Colour · random: a harmonious colour; at: Where · middle, top, bottom, left, right, top-left, top-right, bottom-left, bottom-right · default middle · random: middle \| middle \| top-left \| top-right \| bottom-left \| bottom-right \| left \| right | `ring · glow` |
| `torus [r] color= at=` | donut, doughnut | r (bare): Size · default 0.25 · random: 0.1–0.35; color: Colour · random: a harmonious colour; at: Where · middle, top, bottom, left, right, top-left, top-right, bottom-left, bottom-right · default middle · random: middle \| middle \| top-left \| top-right \| bottom-left \| bottom-right \| left \| right | `torus · glow` |
| `heart [r] color= at=` |  | r (bare): Size · default 0.25 · random: 0.1–0.35; color: Colour · random: a harmonious colour; at: Where · middle, top, bottom, left, right, top-left, top-right, bottom-left, bottom-right · default middle · random: middle \| middle \| top-left \| top-right \| bottom-left \| bottom-right \| left \| right | `heart · glow` |
| `triangle [r] color= at=` | tri, tri-prism | r (bare): Size · default 0.25 · random: 0.1–0.35; color: Colour · random: a harmonious colour; at: Where · middle, top, bottom, left, right, top-left, top-right, bottom-left, bottom-right · default middle · random: middle \| middle \| top-left \| top-right \| bottom-left \| bottom-right \| left \| right | `triangle · glow` |
| `hexagon [r] color= at=` | hex, hex-prism | r (bare): Size · default 0.25 · random: 0.1–0.35; color: Colour · random: a harmonious colour; at: Where · middle, top, bottom, left, right, top-left, top-right, bottom-left, bottom-right · default middle · random: middle \| middle \| top-left \| top-right \| bottom-left \| bottom-right \| left \| right | `hexagon · glow` |
| `pentagon [r] color= at=` |  | r (bare): Size · default 0.25 · random: 0.1–0.35; color: Colour · random: a harmonious colour; at: Where · middle, top, bottom, left, right, top-left, top-right, bottom-left, bottom-right · default middle · random: middle \| middle \| top-left \| top-right \| bottom-left \| bottom-right \| left \| right | `pentagon · glow` |
| `octagon [r] color= at=` |  | r (bare): Size · default 0.25 · random: 0.1–0.35; color: Colour · random: a harmonious colour; at: Where · middle, top, bottom, left, right, top-left, top-right, bottom-left, bottom-right · default middle · random: middle \| middle \| top-left \| top-right \| bottom-left \| bottom-right \| left \| right | `octagon · glow` |
| `star [r] color= at=` | pentagram | r (bare): Size · default 0.25 · random: 0.1–0.35; color: Colour · random: a harmonious colour; at: Where · middle, top, bottom, left, right, top-left, top-right, bottom-left, bottom-right · default middle · random: middle \| middle \| top-left \| top-right \| bottom-left \| bottom-right \| left \| right | `star · glow` |
| `cross [r] color= at=` | plus | r (bare): Size · default 0.25 · random: 0.1–0.35; color: Colour · random: a harmonious colour; at: Where · middle, top, bottom, left, right, top-left, top-right, bottom-left, bottom-right · default middle · random: middle \| middle \| top-left \| top-right \| bottom-left \| bottom-right \| left \| right | `cross · glow` |
| `moon [r] color= at=` | crescent | r (bare): Size · default 0.25 · random: 0.1–0.35; color: Colour · random: a harmonious colour; at: Where · middle, top, bottom, left, right, top-left, top-right, bottom-left, bottom-right · default middle · random: middle \| middle \| top-left \| top-right \| bottom-left \| bottom-right \| left \| right | `moon · glow` |
| `diamond [r] color= at=` | rhombus | r (bare): Size · default 0.25 · random: 0.1–0.35; color: Colour · random: a harmonious colour; at: Where · middle, top, bottom, left, right, top-left, top-right, bottom-left, bottom-right · default middle · random: middle \| middle \| top-left \| top-right \| bottom-left \| bottom-right \| left \| right | `diamond · glow` |
| `ellipse [r] color= at=` | oval, egg, ellipsoid | r (bare): Size · default 0.25 · random: 0.1–0.35; color: Colour · random: a harmonious colour; at: Where · middle, top, bottom, left, right, top-left, top-right, bottom-left, bottom-right · default middle · random: middle \| middle \| top-left \| top-right \| bottom-left \| bottom-right \| left \| right | `ellipse · glow` |
| `line color= at=` | segment, stroke | color: Colour · random: a harmonious colour; at: Where · middle, top, bottom, left, right, top-left, top-right, bottom-left, bottom-right · default middle · random: middle \| middle \| top-left \| top-right \| bottom-left \| bottom-right \| left \| right | `line · glow` |
| `colour [by] palette=` | color | by (bare): length, angle, x, y, time, noise · random: length \| length \| angle \| x \| y \| time; palette: sunset, rainbow, fire, forest, teal, warm, haze, psychedelic, mono, heat, ice, terrain · random: sunset \| rainbow \| fire \| forest \| teal \| warm \| haze \| psychedelic \| mono \| heat \| ice \| terrain | `circle · glow · colour by length` |
| `polar-repeat [count]` | repeat-around, petals, kaleidoscope | count (bare): Copies · default 6 · random: 3–12, whole | `star · glow · polar-repeat 6` |
| `pass scale= repeat= format= filter= edges=` | buffer | scale: texture size: 1/2 and 1/4 make wide blurs cheap · 1, 1/2, 1/4, 1/8, 1/16, 1/32; repeat: draws a step several times a frame; format: half, byte; filter: linear, nearest; edges: clamp, repeat, mirror | `circle · glow · pass "trails" · fade 0.5s` |
| `noise scale=` | fbm, clouds | scale: random: 1.5–6 | `noise · colour by it` |
| `voronoi` | cells |  | `voronoi · colour by it` |
| `glow [falloff] color= amount=` | glowing, halo, neon, shine, bloom | falloff (bare): Falloff · default 10 · random: 4–20 (log); color: Colour · random: a harmonious colour; amount: Intensity · default 1.2 · random: 0.6–2 |  |
| `rings [count] speed= color=` | ripples, contours, isolines, concentric | count (bare): Rings · default 10 · random: 4–18, whole; speed: Speed · default 0.4 · random: 0–0.8; color: Colour · random: a harmonious colour |  |
| `outline [width] color=` | outlined, border, edges | width (bare): Width · default 0.02 · random: 0.004–0.03 (log); color: Colour · random: a harmonious colour |  |
| `onion [thickness]` | hollow, shell | thickness (bare): Thickness · default 0.02 · random: 0.006–0.05 (log) |  |
| `round [amount]` | rounded, grow, bigger, fatten, inflate, thicken | amount (bare): Amount · default 0.03 · random: 0.01–0.08 |  |
| `smooth-union [k] shape=` | blend, melt, merge, smin, combine, join | k (bare): Smoothness · default 0.15 · random: 0.05–0.3; shape: Other shape · default circle · random: circle \| box |  |
| `mask [softness]` | cutout, stencil | softness (bare): Softness · default 0.01 · random: 0.004–0.06 (log) |  |
| `warp [amount]` | distort, wobble, noisy, organic, marble | amount (bare): Strength · default 0.4 · random: 0.2–1.2 |  |
| `swirl [amount]` | vortex, whirl, spin | amount (bare): Strength · default 2 · random: 0.8–4 |  |
| `twist [amount]` | twisted, spiral | amount (bare): Amount · default 3 · random: 0.5–5 |  |
| `polar [twist]` | radial | twist (bare): Twist · default 0 · random: 0–2 |  |
| `mirror axis=` | mirrored, symmetric, symmetry, reflect, flip | axis: Axis · default x · random: x \| y \| both |  |
| `repeat [count]` | tile, tiles, tiled, copies, pattern | count (bare): Tiles across · default 4 · random: 2–7, whole |  |
| `zoom-rotate [zoom] angle=` | zoom, scale, rotate, turn, tilt, magnify | zoom (bare): Zoom · default 1.5 · random: 0.6–2.5 (log); angle: Angle (rad) · default 0.4 · random: -1.2–1.2 |  |
| `custom` | code, expression |  |  |
| `mix color= [amount]` | mixed, tint, crossfade | color: Colour · random: a harmonious colour; amount (bare): Amount · default 0.5 · random: 0.2–0.7 |  |
| `palette` | colorize, colourise, colourize, rainbow, recolour, recolor |  |  |
| `tone-map` | tonemap, aces, unclip |  |  |
| `grade` | look |  |  |
| `brighten [amount]` | brighter, lighten, lift, exposure | amount (bare): Brightness · default 0.15 · random: 0.05–0.35 |  |
| `grain [amount]` | dither, grainy | amount (bare): Amount · default 0.05 · random: 0.02–0.12 |  |
| `blend-mode mode=` | screen, overlay, layer | mode: Mode · default screen · random: screen \| overlay \| multiply \| add \| softlight |  |
| `soft-edge [amount]` | soften, soft, feather, antialias | amount (bare): Softness · default 0.2 · random: 0.05–0.4 |  |
| `invert` | inverse, negate |  |  |
| `grow-mask [amount]` | shrink, erode, dilate | amount (bare): Grow by · default 0.2 · random: -0.3–0.3 |  |
| `mix-two` |  |  |  |
| `blur [amount]` | blurry, defocus | amount (bare): Radius (px) · default 8 · random: 2–16 (log) |  |
| `fade [tail] clean=` | trails, trail, feedback, echo, smear | tail (bare): Tail (s) · seconds for a pixel left alone to fade to 1% · default 1.5 · random: 0.3–4 (log); clean: Clean · default 0.2 · random: 0–0.5 |  |
| `flow` | stream, smudge |  |  |
| `remap [inMin] inMax=` | normalize, normalise, rescale | inMin (bare): From min · default 0 · random: -1–1; inMax: From max · default 1 · random: -1–1 |  |
| `union(a, b) name=` | add, combine | name: name | `union(sphere, box)` |
| `smooth-union(a, b) [k] name=` | blend, merge, smooth | k (bare): default 0.3 · random: 0.1–0.5; name: name | `smooth-union(sphere, box)` |
| `subtract(a, b) name=` | cut, difference, minus | name: name | `subtract(sphere, box)` |
| `smooth-subtract(a, b) [k] name=` | smooth-cut | k (bare): default 0.3 · random: 0.1–0.5; name: name | `smooth-subtract(sphere, box)` |
| `intersect(a, b) name=` | intersection, both | name: name | `intersect(sphere, box)` |
| `smooth-intersect(a, b) [k] name=` |  | k (bare): default 0.3 · random: 0.1–0.5; name: name | `smooth-intersect(sphere, box)` |
| `mix(a, b) [by]` | blend-colours | by (bare): default 0.5 · random: 0.2–0.8 | `mix(palette, glow) by=0.3` |
| `screen(a, b)` |  |  | `screen(palette, glow)` |
| `overlay(a, b)` |  |  | `overlay(palette, glow)` |

## Edits

| Head | Also | Settings | Example |
|---|---|---|---|
| `output [show] palette=` |  | show (bare): picture, depth, distance, height, normal, hit, position, steps, ao, shadow; palette: sunset, rainbow, fire, forest, teal, warm, haze, psychedelic, mono, heat, ice, terrain | `sphere · output depth` |
| `group(a, b) [name]` | bundle | name (bare): name | `group(circle, glow) name="Neon"` |
| `create` |  |  |  |
| `connect` | wire |  |  |
| `disconnect` | unplug, unwire, unlink, detach |  |  |
| `reconnect` | rewire, reroute |  |  |
| `insert` | slot, splice |  |  |
| `switch` |  |  |  |
| `delete` | remove, erase |  |  |
| `rename` |  |  |  |
| `duplicate` | clone |  |  |
| `set` |  |  |  |
| `select` | highlight |  |  |

## 3D scene

| Head | Also | Settings | Example |
|---|---|---|---|
| `surface` | lit, solid |  | `surface · sphere · plane y=-1` |
| `volumetric density= falloff= shell= exposure= tint=` | volume, glowing | density: number; falloff: number; shell: number; exposure: number; tint: colour | `volumetric · torus` |
| `glass ior= dispersion= tint=` | glassy | ior: random: 1.2–1.7; dispersion: number; tint: colour | `glass · sphere glass` |
| `gi bounce= metal= rough= spec=` | gi-lit, global | bounce: number; metal: number; rough: number; spec: number | `gi · torus` |
| `sphere [r] at= rot= color= shine= name= [glass]` | ball, orb | r (bare): Radius · default 0.5 · random: 0.25–0.8; at: random: (-0.6…0.6)×3; rot: random: (-45…45)×3; color: random: a harmonious colour; shine: random: 0–0.8; name: name | `sphere` |
| `box [size] round= at= rot= color= shine= name= [glass]` | cube, rounded-box, roundbox | size (bare): Size (half) · Half its width, height and depth. · random: (0.25…0.8)×3; round: Round · Above 0 it becomes a Rounded Box with edges this round. · default 0 · random: 0–0.16666666666666666; at: random: (-0.6…0.6)×3; rot: random: (-45…45)×3; color: random: a harmonious colour; shine: random: 0–0.8; name: name | `box` |
| `torus [R] r= at= rot= color= shine= name= [glass]` | donut, ring | R (bare): Ring radius · default 0.5 · random: 0.25–0.8; r: Tube radius · default 0.2 · random: 0.1–0.32000000000000006; at: random: (-0.6…0.6)×3; rot: random: (-45…45)×3; color: random: a harmonious colour; shine: random: 0–0.8; name: name | `torus` |
| `cone [angle] h= at= rot= color= shine= name= [glass]` |  | angle (bare): Angle · default 22.92 · random: 11.46–36.672000000000004; h: Height · default 1 · random: 0.5–1.6; at: random: (-0.6…0.6)×3; rot: random: (-45…45)×3; color: random: a harmonious colour; shine: random: 0–0.8; name: name | `cone` |
| `capped-cone [h] r1= r2= at= rot= color= shine= name= [glass]` | frustum | h (bare): Height · default 0.5 · random: 0.25–0.8; r1: Bottom radius · default 0.4 · random: 0.2–0.6400000000000001; r2: Top radius · default 0.1 · random: 0.05–0.16000000000000003; at: random: (-0.6…0.6)×3; rot: random: (-45…45)×3; color: random: a harmonious colour; shine: random: 0–0.8; name: name | `capped-cone` |
| `cylinder [r] h= round= at= rot= color= shine= name= [glass]` | pillar, column, rounded-cylinder | r (bare): Radius · default 0.3 · random: 0.15–0.48; h: Height (half) · default 0.5 · random: 0.25–0.8; round: Round · default 0 · random: 0–0.08333333333333333; at: random: (-0.6…0.6)×3; rot: random: (-45…45)×3; color: random: a harmonious colour; shine: random: 0–0.8; name: name | `cylinder` |
| `capsule [h] r= at= rot= color= shine= name= [glass]` | pill | h (bare): Height · default 0.6 · random: 0.3–0.96; r: Radius · default 0.2 · random: 0.1–0.32000000000000006; at: random: (-0.6…0.6)×3; rot: random: (-45…45)×3; color: random: a harmonious colour; shine: random: 0–0.8; name: name | `capsule` |
| `plane [y] at= rot= color= shine= name= [glass]` | floor, ground | y (bare): Height · default -0.75 · random: -2.416666666666667–0.9166666666666667; at: random: (-0.6…0.6)×3; rot: random: (-45…45)×3; color: random: a harmonious colour; shine: random: 0–0.8; name: name | `plane` |
| `octahedron [s] at= rot= color= shine= name= [glass]` | diamond | s (bare): Size · default 0.5 · random: 0.25–0.8; at: random: (-0.6…0.6)×3; rot: random: (-45…45)×3; color: random: a harmonious colour; shine: random: 0–0.8; name: name | `octahedron` |
| `pyramid [h] at= rot= color= shine= name= [glass]` |  | h (bare): Height · default 0.8 · random: 0.4–1.2800000000000002; at: random: (-0.6…0.6)×3; rot: random: (-45…45)×3; color: random: a harmonious colour; shine: random: 0–0.8; name: name | `pyramid` |
| `ellipsoid [size] at= rot= color= shine= name= [glass]` | egg | size (bare): Radii · random: (0.3…0.96)×3; at: random: (-0.6…0.6)×3; rot: random: (-45…45)×3; color: random: a harmonious colour; shine: random: 0–0.8; name: name | `ellipsoid` |
| `hex-prism [r] h= at= rot= color= shine= name= [glass]` | hexagon | r (bare): Radius · default 0.4 · random: 0.2–0.6400000000000001; h: Height · default 0.2 · random: 0.1–0.32000000000000006; at: random: (-0.6…0.6)×3; rot: random: (-45…45)×3; color: random: a harmonious colour; shine: random: 0–0.8; name: name | `hex-prism` |
| `tri-prism [r] h= at= rot= color= shine= name= [glass]` | triangle | r (bare): Radius · default 0.4 · random: 0.2–0.6400000000000001; h: Height · default 0.2 · random: 0.1–0.32000000000000006; at: random: (-0.6…0.6)×3; rot: random: (-45…45)×3; color: random: a harmonious colour; shine: random: 0–0.8; name: name | `tri-prism` |
| `link [len] R= r= at= rot= color= shine= name= [glass]` | chain | len (bare): Length · default 0.3 · random: 0.15–0.48; R: Loop radius · default 0.25 · random: 0.125–0.4; r: Wire radius · default 0.08 · random: 0.04–0.128; at: random: (-0.6…0.6)×3; rot: random: (-45…45)×3; color: random: a harmonious colour; shine: random: 0–0.8; name: name | `link` |
| `box-frame [size] t= at= rot= color= shine= name= [glass]` | frame, wireframe | size (bare): Size (half) · random: (0.2…0.6400000000000001)×3; t: Thickness · default 0.05 · random: 0.025–0.08000000000000002; at: random: (-0.6…0.6)×3; rot: random: (-45…45)×3; color: random: a harmonious colour; shine: random: 0–0.8; name: name | `box-frame` |
| `capped-torus [R] r= angle= at= rot= color= shine= name= [glass]` | arc | R (bare): Ring radius · default 0.5 · random: 0.25–0.8; r: Tube radius · default 0.1 · random: 0.05–0.16000000000000003; angle: Opening · default 68.75 · random: 34.375–110; at: random: (-0.6…0.6)×3; rot: random: (-45…45)×3; color: random: a harmonious colour; shine: random: 0–0.8; name: name | `capped-torus` |
| `solid-angle [r] angle= at= rot= color= shine= name= [glass]` | wedge | r (bare): Radius · default 0.6 · random: 0.3–0.96; angle: Angle · default 57.3 · random: 28.65–91.68; at: random: (-0.6…0.6)×3; rot: random: (-45…45)×3; color: random: a harmonious colour; shine: random: 0–0.8; name: name | `solid-angle` |
| `cross [s] at= rot= color= shine= name= [glass]` | plus | s (bare): Bar size · default 0.3 · random: 0.15–0.48; at: random: (-0.6…0.6)×3; rot: random: (-45…45)×3; color: random: a harmonious colour; shine: random: 0–0.8; name: name | `cross` |
| `gyroid [freq] t= ball= at= rot= color= shine= name= [glass]` |  | freq (bare): Frequency · default 3.5 · random: 1.75–5.6000000000000005; t: Thickness · default 0.3 · random: 0.15–0.48; ball: Ball radius · The ball the lattice is cut to. 0 fills all of space. · default 1.1 · random: 0.55–1.7600000000000002; at: random: (-0.6…0.6)×3; rot: random: (-45…45)×3; color: random: a harmonious colour; shine: random: 0–0.8; name: name | `gyroid` |
| `schwarz-p [freq] t= ball= at= rot= color= shine= name= [glass]` | schwarz | freq (bare): Frequency · default 3.5 · random: 1.75–5.6000000000000005; t: Thickness · default 0.3 · random: 0.15–0.48; ball: Ball radius · default 1.1 · random: 0.55–1.7600000000000002; at: random: (-0.6…0.6)×3; rot: random: (-45…45)×3; color: random: a harmonious colour; shine: random: 0–0.8; name: name | `schwarz-p` |
| `hypersphere [r] w= spin= at= rot= color= shine= name= [glass]` | 4d-ball, 4d-sphere | r (bare): Radius · default 0.6 · random: 0.3–0.96; w: Slice (w) · Where the 3D slice cuts the 4D shape. · default 0 · random: -0.6666666666666666–0.6666666666666666; spin: Spin · Degrees a second it turns in the xw plane. · default 0 · random: -30–30; at: random: (-0.6…0.6)×3; rot: random: (-45…45)×3; color: random: a harmonious colour; shine: random: 0–0.8; name: name | `hypersphere` |
| `tesseract [size] round= w= spin= at= rot= color= shine= name= [glass]` | hypercube, 4d-cube | size (bare): Size (half) · default 0.5 · random: 0.25–0.8; round: Round · default 0.02 · random: 0.01–0.032; w: Slice (w) · Where the 3D slice cuts the 4D shape. · default 0 · random: -0.6666666666666666–0.6666666666666666; spin: Spin · Degrees a second it turns in the xw plane. · default 12 · random: 6–19.200000000000003; at: random: (-0.6…0.6)×3; rot: random: (-45…45)×3; color: random: a harmonious colour; shine: random: 0–0.8; name: name | `tesseract` |
| `duocylinder [r1] r2= w= spin= at= rot= color= shine= name= [glass]` | 4d-cylinder | r1 (bare): Radius xy · default 0.6 · random: 0.3–0.96; r2: Radius zw · default 0.45 · random: 0.225–0.7200000000000001; w: Slice (w) · default 0 · random: -0.6666666666666666–0.6666666666666666; spin: Spin · default 15 · random: 7.5–24; at: random: (-0.6…0.6)×3; rot: random: (-45…45)×3; color: random: a harmonious colour; shine: random: 0–0.8; name: name | `duocylinder` |
| `clifford-torus [r] t= w= spin= at= rot= color= shine= name= [glass]` | clifford, 4d-torus | r (bare): Radius · default 0.8 · random: 0.4–1.2800000000000002; t: Thickness · default 0.15 · random: 0.075–0.24; w: Slice (w) · default 0 · random: -0.6666666666666666–0.6666666666666666; spin: Spin · default 9 · random: 4.5–14.4; at: random: (-0.6…0.6)×3; rot: random: (-45…45)×3; color: random: a harmonious colour; shine: random: 0–0.8; name: name | `clifford-torus` |
| `cell24 [r] w= spin= at= rot= color= shine= name= [glass]` | icositetrachoron, twenty-four-cell | r (bare): Radius · default 0.7 · random: 0.35–1.1199999999999999; w: Slice (w) · default 0 · random: -0.6666666666666666–0.6666666666666666; spin: Spin · default 10 · random: 5–16; at: random: (-0.6…0.6)×3; rot: random: (-45…45)×3; color: random: a harmonious colour; shine: random: 0–0.8; name: name | `cell24` |
| `julia4d [cx] cy= scale= w= spin= at= rot= color= shine= name= [glass]` | julia, quaternion-julia | cx (bare): c x · default -0.2 · random: -0.7–0.3; cy: c y · default 0.6 · random: 0.3–0.96; scale: Size · default 0.75 · random: 0.375–1.2000000000000002; w: Slice (w) · default 0 · random: -0.6666666666666666–0.6666666666666666; spin: Spin · default 6 · random: 3–9.600000000000001; at: random: (-0.6…0.6)×3; rot: random: (-45…45)×3; color: random: a harmonious colour; shine: random: 0–0.8; name: name | `julia4d` |
| `mandel4d [scale] w= spin= at= rot= color= shine= name= [glass]` | mandelbrot4d, quaternion-mandelbrot | scale (bare): Size · default 0.6 · random: 0.3–0.96; w: Slice (w) · default 0 · random: -0.6666666666666666–0.6666666666666666; spin: Spin · default 6 · random: 3–9.600000000000001; at: random: (-0.6…0.6)×3; rot: random: (-45…45)×3; color: random: a harmonious colour; shine: random: 0–0.8; name: name | `mandel4d` |
| `move [by]` | translate, offset | by (bare): By · random: (-3.3333333333333335…3.3333333333333335)×3 | `sphere · move` |
| `turn axis= [angle]` |  | axis: x, y, z; angle (bare): Angle · default 0 · random: -120–120 | `sphere · turn` |
| `rotate [by]` | rotation | by (bare): Degrees · About X, then Y, then Z. · random: (-60…60)×3 | `sphere · rotate` |
| `scale [s]` | resize, grow | s (bare): Factor · default 1.5 · random: 0.75–2.4000000000000004 | `sphere · scale` |
| `repeat [cell]` | tile, grid | cell (bare): Cell size · random: (1…3.2)×3 | `sphere · repeat` |
| `mirror-repeat [cell]` | mirrored-repeat, flip-repeat | cell (bare): Cell size · random: (1…3.2)×3 | `sphere · mirror-repeat` |
| `limited-repeat [cell] count=` | repeat-n, array | cell (bare): Cell size · random: (0.5…1.6)×3; count: Copies each way · random: (1…3.2)×3 | `sphere · limited-repeat` |
| `mirror axes=` | symmetry, abs | axes: x, y, z, xy, xz, yz, xyz | `sphere · mirror` |
| `fold axes= [offset]` | mirror-fold | axes: x, y, z, xy, xz, yz, xyz; offset (bare): Offset · random: (-0.6666666666666666…0.6666666666666666)×3 | `sphere · fold` |
| `polar-repeat axis= [count]` | radial, around, polar | axis: y, x, z; count (bare): Copies · default 6 · random: 3–9.600000000000001 | `sphere · polar-repeat` |
| `kaleido [n] sym=` | kaleidoscope | n (bare): Folds · default 3 · random: 1.5–4.800000000000001; sym: oct, tet, icos | `sphere · kaleido` |
| `twist [k]` |  | k (bare): Amount · default 2 · random: 1–3.2 | `sphere · twist` |
| `bend [k]` | curve | k (bare): Amount · default 0.5 · random: 0.25–0.8 | `sphere · bend` |
| `sine axis= [amp] freq= from=` | wave, sin, sine-warp | axis: x, y, z; amp (bare): Amplitude · default 0.1 · random: 0.05–0.16000000000000003; freq: Frequency · default 2 · random: 1–3.2; from: x, y, z | `sphere · sine` |
| `warp [amt] scale= octaves=` | domain-warp | amt (bare): Strength · default 0.3 · random: 0.15–0.48; scale: Scale · default 1 · random: 0.5–1.6; octaves: Octaves · default 3 · random: 1.5–4.800000000000001 | `sphere · warp` |
| `displace [amp] freq=` | bumps, ripple | amp (bare): Amplitude · default 0.05 · random: 0.025–0.08000000000000002; freq: Frequency · default 8 · random: 4–12.8 | `sphere · displace` |
| `round [r]` | inflate, soften | r (bare): Radius · default 0.05 · random: 0.025–0.08000000000000002 | `sphere · round` |
| `onion [t]` | shell, hollow | t (bare): Thickness · default 0.03 · random: 0.015–0.048 | `sphere · onion` |
| `sun [dir] color=` |  | dir (bare): vec3; color: colour | `sphere · sun dir=(1,2,1)` |
| `sky [color]` |  | color (bare): random: a harmonious colour | `sphere · sky (0.5,0.6,0.9)` |
| `bounce [color]` |  | color (bare): colour | `sphere · bounce (0.3,0.2,0.1)` |
| `shadows [hardness]` | shadow | hardness (bare): random: 6–32 | `sphere · shadows 16` |
| `ao [step]` | occlusion | step (bare): number | `sphere · ao 0.06` |
| `fog [density] color=` |  | density (bare): random: 0.05–0.5; color: colour | `sphere · fog 0.3` |
| `background [top] bottom=` | bg | top (bare): colour; bottom: colour | `sphere · background navy` |
| `tone [mode]` |  | mode (bare): aces, agx, hable, reinhard2, tanh, oklab, none | `sphere · tone agx` |
| `camera [dist] angle= elev= orbit= zoom= flatten= x= y= z=` | cam | dist (bare): random: 3–6; angle: number; elev: random: 5–35; orbit: random: 0–15; zoom: number; flatten: number; x: number; y: number; z: number | `sphere · camera dist=5 orbit=10` |
| `quality steps= dist= step= jitter= warp=` |  | steps: number; dist: number; step: number; jitter: number; warp: off, auto, careful, high | `sphere · quality steps=128` |

## Grid Rules

| Head | Also | Settings | Example |
|---|---|---|---|
| `count` |  |  | `grid count` |
| `stages` |  |  | `grid stages` |
| `smooth` |  |  | `grid smooth` |
| `patterns` |  |  | `grid patterns` |
| `blocks` |  |  | `grid blocks` |
| `life` | conway, game-of-life |  | `grid life` |
| `highlife` | high-life |  | `grid highlife` |
| `seeds` |  |  | `grid seeds` |
| `day-and-night` |  |  | `grid day-and-night` |
| `maze` |  |  | `grid maze` |
| `coral` |  |  | `grid coral` |
| `anneal` |  |  | `grid anneal` |
| `diamoeba` |  |  | `grid diamoeba` |
| `replicator` |  |  | `grid replicator` |
| `life-without-death` |  |  | `grid life-without-death` |
| `diamonds` |  |  | `grid diamonds` |
| `caves` |  |  | `grid caves` |
| `bosco` |  |  | `grid bosco` |
| `majority` |  |  | `grid majority` |
| `brians-brain` | brian |  | `grid brians-brain` |
| `star-wars` |  |  | `grid star-wars` |
| `frogs` |  |  | `grid frogs` |
| `sticks` |  |  | `grid sticks` |
| `spirals` |  |  | `grid spirals` |
| `swirl` |  |  | `grid swirl` |
| `lava` |  |  | `grid lava` |
| `bloomerang` |  |  | `grid bloomerang` |
| `heat` | diffusion |  | `grid heat` |
| `ripples` | water, waves-preset |  | `grid ripples` |
| `mitosis` | reaction-diffusion, gray-scott |  | `grid mitosis` |
| `coral-growth` |  |  | `grid coral-growth` |
| `worms` |  |  | `grid worms` |
| `spots` |  |  | `grid spots` |
| `labyrinth` |  |  | `grid labyrinth` |
| `wireworld` | wire-world |  | `grid wireworld` |
| `falling-dots` |  |  | `grid falling-dots` |
| `crystal` |  |  | `grid crystal` |
| `falling-sand` | sand |  | `grid falling-sand` |
| `gas` | hpp |  | `grid gas` |
| `stencil count=` |  | count: state:min..max neighbours, like count=1:1..2 | `stencil .../.1./... → 2` |
| `block chance=` |  | chance: random: 0.3–1 | `block 11/00 → 00/11` |
| `colours empty= on= dying= glow= old= c0= c1= c2= c3= c4= c5= c6= c7=` | colors | empty: random: a harmonious colour; on: random: a harmonious colour; dying: random: a harmonious colour; glow: random: a harmonious colour; old: random: a harmonious colour; c0: random: a harmonious colour; c1: random: a harmonious colour; c2: random: a harmonious colour; c3: random: a harmonious colour; c4: random: a harmonious colour; c5: random: a harmonious colour; c6: random: a harmonious colour; c7: random: a harmonious colour | `grid life · colours on=green empty=black` |
| `brush [size] state= fill=` |  | size (bare): number; state: count; fill: number | `grid life · brush size=5 fill=0.3` |

## Agent Rules

| Head | Also | Settings | Example |
|---|---|---|---|
| `agents kind= edges= view= view-max=` |  | kind: trail, particles, flock, ants, swarm, crowd; edges: wrap, bounce, slide; view: random: 0.02–0.08; view-max: count | `agents kind=flock edges=bounce view=0.05` |
| `sensors ahead= angle=` |  | ahead: random: 0.015–0.06 (log); angle: random: 15–60, whole | `sensors ahead=0.035 angle=22.5deg` |
| `flow size= evolve=` |  | size: random: 0.6–2; evolve: random: 0.05–0.4 | `flow size=1.2 evolve=0.2` |
| `channels` |  |  | `channels home, food` |
| `masks` |  |  | `masks Food, Nest` |
| `species speed= states=` |  | speed: random: 0.1–1.2 (log); states: list | `species Ants speed=0.3 states=searching,carrying` |
| `state color=` |  | color: random: a harmonious colour | `state carrying color=gold` |
| `when` | always |  | `when searching and food anywhere > 0.05 do turn toward food 20deg` |
| `near` |  |  |  |
| `chance` |  |  |  |
| `age` |  |  |  |
| `memory` |  |  |  |
| `mask` |  |  |  |
| `neighbours` |  |  |  |
| `shape` |  |  |  |
| `turn` |  |  | `turn toward food 20deg` |
| `wander` |  |  | `wander 7deg` |
| `speed` |  |  | `speed 0.4` |
| `accelerate` |  |  | `accelerate 0.1/s` |
| `leave` |  |  | `leave food 1 fade=0.15` |
| `become` |  |  | `become carrying` |
| `stop` |  |  | `stop` |
| `stick` |  |  | `stick` |
| `die` |  |  | `die` |
| `spawn` |  |  | `spawn 1` |
| `follow` |  |  | `follow flow 10deg` |
| `against` |  |  | `against flow 10deg` |
| `align` |  |  | `align 10deg` |
| `separate` |  |  | `separate 12deg who=others radius=0.045` |
| `match` |  |  | `match 6deg` |
| `cohere` |  |  | `cohere 3deg` |
| `slow` |  |  | `slow jam=20` |
| `avoid-edges` |  |  | `avoid-edges 12deg margin=0.1` |
| `orbit` |  |  | `orbit centre 8deg distance=0.5 cw` |
| `force` |  |  | `force gravity 0.75 angle=-90deg` |
| `drag` |  |  | `drag 0.35` |
| `fade` |  |  | `fade 3s` |
