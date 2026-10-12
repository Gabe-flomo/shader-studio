# The builders' Look and Effects

The 2D Scene Builder's **Look** page has a palette with slots and a colour grade. Its **Effects**
page has shader effects on the finished picture. Both are shared code (`src/builders/look/`), so
another scene builder can take them up with its own spec, recipe and form.

## Palette

- **Pick** one of the app's palettes, shown as swatch strips. These are the Palette node's cosine
  presets and the Color Ramp stop sets, the same list *colour by* and *output … palette=* use.
  Palettes saved in the palette library (`lib/palette.ts`) are shown too.
- **Make your own**: *Make your own from this one* copies the swatches into a bar of colour stops
  (`GradientStopsEditor`, evenly spaced). Click the bar to add a colour, drag one to reorder it,
  click one to change it, and press Backspace to remove it. A palette holds 2 to 8 colours.
  *Save to library* stores it as a Stops palette, and the node cards' palette menus offer it too.
- **Slots**: the palette's colours are numbered slots. A ramp gives its stops; a cosine palette is
  sampled at five points. The background (Look → Colour) and each layer (Shapes → Colour) take
  either a slot (a numbered swatch) or a free colour. Picking another palette recolours everything
  that uses its slots. Build makes one Color node per slot in use (`palette:slotN`) and wires it to
  every part that takes the slot, so changing that node on the canvas recolours them all too.
- **Colour by** and the grid read the same palette. A palette of your own builds as a Color Ramp.

## Grade

The grade is a stack of the app's own colour-grading nodes. It is built after the tone map, in the
order shown. Each card can be switched off, dragged (or moved with the arrows) or removed.

| Card | Nodes |
|---|---|
| Brightness / contrast | Brightness / Contrast |
| Levels | Tone Curve (black point, white point, S-curve) |
| Saturation | Saturation |
| Hue shift | Hue Rotate (degrees here, radians on the node) |
| Shadows / highlights | Shadows / Highlights |
| Lift / gamma / gain | Lift / Gamma / Gain |
| Temperature | Blackbody × Blend Modes (Multiply, Amount as Opacity) |
| Posterize | Posterize |
| Invert | Invert, mixed back by Amount |
| Duotone | Luminance → Color Ramp (two colours) → Mix |
| Gradient map | Luminance → Color Ramp (the scene's palette) → Mix |

Every number is a node param, so it becomes a live uniform. After Build, right-click a slider to
add its param to Play (the BuilderSlider Play menu).

## Effects

Effects work on the finished picture, top to bottom: each one works on what the ones above made.
They are built after the grade.

- **Moves**: Displace by noise (Domain Warp), Swirl, Ripple, Lens, Pixelate, Kaleidoscope and CRT
  curvature (CRT Screen). Each one changes *where* the picture is read. The picture so far goes
  into a Pass, and the next read of it is at the bent point. A run of moves shares one Pass and
  one read.
- **Reads round a pixel**: Blur (Blur (texture)), Glow (Glow (texture), Bloom chain, then Add),
  Light rays / Radial blur (Radial Fast Blur: see [radial-fast-blur.md](radial-fast-blur.md)),
  Chromatic aberration (Chromatic Aberration (lens): see [chromatic-aberration.md](chromatic-aberration.md))
  and Displace by a picture (Displace
  (texture), with the picture chosen in the shared texture picker or a Shader Texture). Each reads
  the Pass with its own node, at the bent point if moves came before it.
- **Light rays / Radial blur** is CC Radial Fast Blur: Mode (Brightest: light rays; Average: a
  zoom blur; Add: glowing rays), Length, Threshold, Intensity, Opacity, Decay, Falloff, Zoom (out from or
  into the centre), Centre X / Y and Tint, the node's own controls. Its four streak passes are
  hidden passes, so they don't count towards the six Passes; long streaks cost the same.
- **Chromatic aberration** has Look (Spectral: smooth rainbow fringes from many taps across the
  spectrum; Channel split: red and blue copies), Amount (pixels), Direction (Radial, Axial: a halo
  round highlights, Directional), Angle, Falloff, Blur, Samples, Distortion and Centre X / Y. Old
  recipes (`chroma 6 mode=directional angle=30`) build the new node with the same Amount.
- **On the colour**: CRT mask (CRT Mask) has slot mask, aperture grille or shadow mask (dots), plus
  cell size, strength, scanlines, curvature and vignette.

The effects use at most six Pass nodes; past that, an effect is left out with a warning. The
builder preview draws the Pass programs itself (`components/builders/previewPasses.ts`).

**Bloom and Scanlines** are no longer finish options. The older Bloom read the frame before, so
moving things smeared; Glow is the same-frame kind. CRT mask has scanlines with the tube's mask.
A scene made with them keeps them: they still build as before, and the Finish card shows them
under *older effects* until they are set to 0. The recipe still reads `bloom 0.5` and
`scanlines 0.3`, and prints them back while they are set.

## Recipe

Palette and grade clauses come after the look; effect clauses come in the stack's order. A setting
is printed only when it differs from its default, with the primary setting bare. `off` keeps a card
that is switched off.

```
circle r=0.3 slot=2 · background slot=1 · palette fire
palette #1b1f3b #e94f37 #f6c90e name=Dusk
grade saturation 1.3 · grade levels blacks=0.05 · grade lgg gain=(1.1,1,0.9) · grade hue 40 off
crt mask=aperture size=4 strength=0.7 curve=0.05 vignette=0.35 scanlines=0.3
chroma 6 mode=directional angle=30 · chroma 4 look=split blur=0
fx displace 0.12 scale=2 speed=0.2 · fx displace picture=clouds pixels=40
fx swirl 2 · fx ripple 0.02 freq=12 · fx lens 0.2 · fx pixelate 0.03 · fx kaleido 8 rotate=15
fx blur 4 · fx glow 1.2 threshold=0.5 radius=16
fx rays 1.2 mode=average threshold=0 · fx rays 0.8 threshold=0.5 cx=0.3 tint=#ffcc88
```

## Surprise me

Now and then, Surprise me colours the shapes from a library palette's slots, adds a same-frame Glow
and a touch of grade (saturation, levels). Rarely, it adds one effect that suits a glowing scene: a
little chromatic aberration or a CRT mask. It never sets Bloom or Scanlines.

## Other builders

Only the 2D Scene Builder had a finish with Bloom and Scanlines. The 3D Scene Builder's Look is
lighting, fog and tone. The Grid scene's Look is ground, lines, glow and tone. The Splat builder's
"Bloom" is already the same-frame Glow (texture) chain (#824), so it stays. The shared modules
(`palette.ts`, `grade.ts`, `effects.ts`, `recipe.ts`, `StackCards`, `PaletteCard`) take a
`sceneBuilder/build` context, so those builders can take up the grade and Effects page next.

## Code and tests

- `src/builders/look/`: `palette.ts`, `stack.ts`, `grade.ts`, `effects.ts` and `recipe.ts`
- `src/components/builders/look/`: `StackCards.tsx` and `PaletteCard.tsx`
- Tests: `src/builders/look/__tests__/look.test.ts`
  - slots and custom palettes
  - each grade and effect builds and compiles
  - moves share a Pass
  - Bloom and Scanlines are not offered but still load
  - recipe round trip
  - the new and changed nodes compile wired and unwired
