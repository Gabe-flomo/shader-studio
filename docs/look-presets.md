# Looks: standard finishing touches as Expression Blocks

The examples kept ending in a hand-written Expression Block called **Look**: lay one thing over another, a glowing line, a palette, a vignette. **Looks** are those common finishes made standard, as built-in Expression Block presets (`src/nodes/lookPresets.ts`). Each places as an ordinary Expression Block, so its code is there to read and change, and every line is explained in its note.

**Where to find them.** The node library's **Expressions** tab lists them under **Looks**, above your saved expressions (drag one onto the graph, or double-click). The node search finds them by name ("vignette", "grain") or all of them by typing "look".

**They're starting points.** Built in, so they can't be renamed or deleted. Change a placed one freely; to keep your version, save it from the block as your own preset.

| Look | Wire | What it does |
|---|---|---|
| Lay over | Back, Front, Amount (a mask) | One picture over another by a mask: `mix(back, front, a)`, alpha over with the mask as alpha. |
| Glowing line | d (any distance), Colour | A shape's outline as a bright line with a soft exponential glow. |
| Glow ring | (nothing; Radius to pulse) | A thin ring with a halo round the middle. |
| Cosine palette | T (any number) | Inigo Quilez's `a + b·cos(2π(c·t + d))`: a number into a rainbow, with Shift and Cycles. |
| Colour pop | Picture, Mask | Keeps colour inside the mask, greys the rest, rim glow on the mask's edge. |
| Vignette | Colour | Darkens towards the corners. |
| Tone map (filmic) | Colour (last, before Output) | The ACES filmic curve (Narkowicz's fit) and Gamma: bright glows roll off instead of clipping. |
| Film grain | Colour | Per-pixel noise, new 24 times a second. |
| Posterize | Colour | A few flat bands per channel. |
| Duotone | Colour | Shadows in one colour, highlights in another, by brightness. |
| Colour grade | Colour | Brightness, contrast, saturation, warmth. |
| Scanlines | Colour | Dark lines across the picture, optionally rolling. |

Picture coordinates inside a Look are `g_uv` (0 in the middle, 1 at the top), the time is `u_time`, and `gl_FragCoord` is the pixel. Input names never take an Expression Block setting's name (`lines`, `result`, …); the tests check that, that every named line is explained, and that each Look compiles alone and wired (`src/nodes/__tests__/lookPresets.test.ts`).
