# Node Browser

The node browser (opened via the **+** button or by double-clicking empty canvas) organizes all nodes into categories and, for larger categories, sub-groups. Clicking a category opens it; clicking a sub-group label filters to just those nodes.

---

## Builders

The first section of the browser (the desktop palette, its drawer, and the phone's Nodes tab) is
**Builders**: windows that write a graph for you from a form or a few lines of text.

| Builder | Makes | A click |
|---|---|---|
| **Scene builder** | 2D shapes and kaleidoscopes, slime and flocks, Life and sand, raymarched 3D | opens on "What kind of scene?" (2D, agent, grid, 3D), or on the scene a builder already made here ([scene-builder.md](scene-builder.md)) |

The four kinds (2D Scene Builder, Agent Builder, Grid Rules, 3D Scene Builder), the 3D Agent
Builder and the Expression Builder are not listed; they open from the Scene builder, the Do… bar
or a card. The section folds (the header's chevron) and stays folded in this browser. Searching
"builder", "scene", "rules" (or what they make: "sand", "slime") shows the Scene builder above the
node results. The empty canvas's right-click menu has the same builders under **Builders**, and the Do…
bar opens them by name: "new 3d scene", "new grid rules", "new agent rules", "edit the rules",
"new expression"
([do-bar-commands.md](do-bar-commands.md), Builders). Code: `src/builders/` (registry, open,
recipe, Do… bar phrases) and `src/components/builders/BuildersSection.tsx`.

A node a builder made carries a **Recipe chip** on its card: a built scene's recipe, a Grid Rules
node's rule, a rules group's rules, with Copy and Open.

---

## Where new nodes land

Whatever adds nodes puts them **in the part of the canvas you're looking at** (`src/store/placement.ts`, `src/store/freeSpace.ts`).

- **One node** (the browser, search, the Do… bar's node picks, a saved node's source, a group preset): centred in the view. If a card is already there, it goes to the free spot nearest the centre (`spawnPoint`).
- **A setup** (Agents starters and presets, the Agent Builder, the 3D and 2D Scene Builders, the Expression Builder, the Do… bar's scene and agents lines): its own layout is kept and it moves as one block, centred in the view. If cards are in the way, it takes the free spot nearest the view's centre, never "right of the whole graph". A setup bigger than the view starts at the view's top-left corner.
- **Things placed beside a card** (starter recipes, Light the scene, Add a picture with depth, Do… bar plans and commands, card suggestions, Grid Rules): they stay beside that card. If all of it would end up off screen (its middle is off screen and less than a quarter shows), it is brought into view.
- **Left where they are:**
  - Generate depth already lands beside its card, inside the view.
  - Bake and Unbake replace a node in place.
  - Duplicate offsets the copy a little from the original.
  - A drag from the browser lands where you drop it.
  - Rebuilds and rewrites that remove nodes keep their positions.

---

## Categories

```
2D Primitives       3D Boolean Ops      3D Lighting         3D Primitives
3D Scene            3D Transforms       Animation           Color
Color Grading       Combiners           Conditionals        Effects
Fractals            Halftone            Math                Matrix
Noise               Particles           Particles & Fields  Post Processing
Science             Shapers             Sources             Spaces
Transforms          Utility             Output
```

---

## Post Processing category

A dedicated **Post Processing** category was added for full-screen compositing effects. It contains:

- **Vignette** — radial edge darkening
- **Scanlines** — CRT-style horizontal lines
- **Sobel Edges** — edge detection from luminance
- **Motion Blur** — accumulation-style motion blur

Previously these lived in Effects. **Grain** and **Tone Map** moved to **Color Grading** (Film sub-group and Tone sub-group respectively).

---

## Sub-groups

These categories show sub-group chips inside the browser. Clicking a chip filters to just those nodes; clicking again clears the filter.

### 2D Primitives
| Sub-group | Contents |
|---|---|
| SDF | circleSDF, boxSDF, ringSDF, simpleSDF, shapeSDF, sdBox, sdSegment, sdEllipse |
| Patterns | truchet, metaballs, lissajous |

### 3D Primitives
| Sub-group | Contents |
|---|---|
| Basic | sphere, box, torus, capsule, cylinder, cone, plane, octahedron |
| Curved | ellipsoid, capped torus, capped cone, rounded box, rounded cylinder, vertical capsule |
| Complex | box frame, link, pyramid, hex prism, tri prism, solid angle, sdCross |
| Fields | gyroid, schwarzP |

### 3D Transforms
| Sub-group | Contents |
|---|---|
| Move | translate, rotate, rotateAxis, scale |
| Repeat | repeat, limitedRepeat, polarRepeat, mirroredRepeat |
| Warp | twist, bend, sinWarp, displace, spiralWarp, domainWarp, shear |
| Fold | fold, mirrorFold, kaleidoscope, sphereInvert, mobiusWarp, logPolarWarp, helixWarp |

### 3D Lighting
| Sub-group | Contents |
|---|---|
| Shadow | sdfAo, softShadow |
| Surface | blinnPhong, fresnel3d, fakeSSS, materialSelect, multiLight |
| Glass | glass3d, fresnelSchlick, spectralDispersion |
| Volume | volumetricFog, phaseHG |

### Effects
| Sub-group | Contents |
|---|---|
| Blur | gaussianBlur, radialBlur, tiltShiftBlur, lensBlur, depthOfField |
| Chroma | chromaShift, chromaticAberrationAuto, chromaticAberration |
| Lighting | makeLight, light, light2d, radianceCascadesApprox |
| Warp | gravitationalLens, floatWarp |

### Color Grading
| Sub-group | Contents |
|---|---|
| Tone | liftGammaGain, toneCurve, shadowsHighlights, toneMap |
| Color | hueRotate, colorSaturation |
| Film | grain |

### Color
| Sub-group | Contents |
|---|---|
| Palette | palette, gradient, palettePreset, colorRamp, blackbody |
| Adjust | invert, desaturate, posterize, hueRange, brightnessContrast |
| Convert | hsv |
| Blend | blendModes |

### Combiners
| Sub-group | Contents |
|---|---|
| SDF Ops | smoothMin, min, sdfMax, sdfSubtract, smoothMax, smoothSubtract, sdfOutline, sdfColorize |
| Blend | blend, mask, addColor, screenBlend, alphaBlend |
| Layer | glowLayer |

### Spaces
| Sub-group | Contents |
|---|---|
| Warp | displace, uvWarp (Kind: Smooth, Jitter, Curl, Swirl) |
| Repeat | fract, infiniteRepeat, mirroredRepeat2D, limitedRepeat2D, angularRepeat2D |
| Distort | polarSpace, logPolarSpace, hyperbolicSpace, inversionSpace, mobiusSpace, kaleidoSpace, sphericalSpace, rippleSpace, perspective2d, shear |
| Texture | waveTexture, magicTexture, grid |

### Math
| Sub-group | Contents |
|---|---|
| Arithmetic | add, subtract, multiply, divide |
| Trig | sin, cos, **tan**, atan2 |
| Rounding | abs, negate, ceil, floor, round, fract |
| Algebra | pow, sqrt, exp, tanh |
| Interp | clamp, mix, mixVec3, smoothstep, mod |
| Compare | min, max, step, sign |
| Geometry | length, dot, crossProduct, reflect, luminance |
| Vec2 | vec2Const, makeVec2, splitVec2, and more |
| Vec3 | vec3Const, makeVec3, splitVec3, and more |
| Complex | complexMul, complexPow |
| Remap | remap |

---

## Tan node

**Tan** — `amp * tan(input * freq)` — was added to Math › Trig. It has the same signature as Sin and Cos:

| Input | Type | Description |
|---|---|---|
| `input` | float/vec2/vec3 | Angle value |

| Param | Description |
|---|---|
| Freq | Multiplied onto the input before tan |
| Amp | Scales the output |

The inline viz shows S-curves with dashed asymptote guides at ±π/2. The waveform pen lifts at discontinuities so the vertical jumps at each asymptote are not drawn as false lines.

## Nodes offered only inside a group

Scene Pos and Scene Output appear only inside a Scene Group, and Scene Distance only inside a March Loop. This applies to the browser, search and the Do bar (`src/nodes/addScope.ts`, docs/groups.md).

---

## Searching

Type in the search bar to filter across all categories. Results show the node name and category tag. The search also matches the node's GLSL function name and description.

---

## Node search (Shift+Space)

**Shift+Space** on the canvas (or **A**, a wire's **+**, a socket's **Add node…**, the phone's Add node)
opens the node search: a wide panel (about 16:9, centred; full screen on a phone) in the app's
light or dark theme. Code: `src/components/NodeGraph/NodeSearchPalette.tsx` (the panel) and
`nodeSearchModel.ts` (matching, ranking, tiles, keyboard), with the library's rows in
`libraryRows.ts`, shared with this browser.

**Opening.** With nothing typed it shows tiles, not nodes:

- Shortcuts first: **Builders** (opens the Scene builder), **Usually next** (what usually goes with
  the selected node, or the node a wire came from), **Recent** (nodes you added lately, here or in
  the browser), **Favourites** (the browser's starred nodes; star one from the search's preview too)
  and **Group presets**. Each shows only when it has something in it.
- Then every category, by section, with its colour, icon, count and a few node names.

A tile opens with a click or Enter: its nodes as a grid, by sub-group, with a breadcrumb. **Esc**,
**Backspace** in the empty field or the back arrow return to the tiles, with the tile you came from
highlighted.

**Typing** replaces the tiles with results, in two lightly labelled groups:

1. **Matches**, by tier: the exact name, then names that start with what you typed, then a word of
   the name starting with it (each word typed may start a different word: "blur gau" finds Gaussian
   Blur), then fuzzy (inside the name, the type id, or the letters in order from a word start), then
   keywords (the words a node leads for, like Transform's "move" and "translate", old names, the
   category, a whole word of the description). Within a tier, closer matches come first, then what
   fits where you are (below), then the name. The **top 8** are tiles; the rest are a list.
2. **Related**: nodes the text didn't find that fit where you are: what usually goes with the
   selected node or the wire's node (your graphs and the examples' prior, suggestions/rank
   `affinity`, and the examples' follow counts, structure/relevance) and your recent nodes, each
   with why ("Usually goes with Circle SDF", "Used recently"). Opened from a selected node (not a
   wire), Related and Usually next only list nodes that can take one of that node's outputs, by the
   wire-insert rule below (`wireFit.canFollow`).

Nodes only offered in a scope (Scene Pos inside a Scene Group…) follow the add scope. **Relevant
only / Show all** works as in the browser: with Relevant only, categories for another kind of graph
(3D in a 2D graph) move under "Show what's not for this graph", 3D-only matches carry a badge and
sink to the end of their tier, and Related leaves them out. Opened from a wire, only nodes that fit
it are listed (a chip in the header says which type) and the added node is wired.

**What fits a wire** (`wireFit.ts`; the same for the wire's **+**, dropping a node from the browser on
a wire, and the phone's Insert into a connection). A node fits when it can take the wire's source and
feed the wire's end:

- the same type fits;
- a **float fits any vector**: a node that outputs a float can go on a vec2 / vec3 / vec4 wire, its
  value broadcast into every channel (`vec3(x)`), and a float wire can feed a vector input;
- a **genType** node (the ones with float / vec2 / vec3 / vec4 pills: Exp, Sin, Add, Pow, Length…)
  is set to the wire's vector type when it goes in, so Exp on a vec3 wire is `exp()` per channel.
  Length and Dot keep their float output, which broadcasts.

The picker doesn't offer nodes that would only fit by padding or truncating (vec2 ↔ vec3); those wires
still connect by hand as before. After the add, the node is wired by its first exactly matching
input and output, else the first the graph can promote (`nodeDrop.insertIntoWire`); if it no longer
fits (the wire went away), the wire is left alone.

**Keys.** Arrows move across tile grids and lists (while typing, up and down go through the
results in order and left and right move the text cursor); **Tab** / **Shift+Tab** jump to the
next or previous group; **Enter** adds the node or opens the tile; **Esc** clears the field, then
goes back, then closes. The highlighted node's preview, description, sockets and a favourite star
are in the side panel (on a phone, its one line is in the footer). A node is added where the search
was opened for (the view's free centre, or beside the socket), as before.

The popups that were still dark in light mode now follow the theme too: the Settings / keyboard
shortcuts window (`KeyboardShortcutsModal.tsx`), the asset right-click menu
(`AssetContextMenu.tsx`) and a group's parameter picker (`GroupParamPicker.tsx`).
