# Data Texture and Read channels

Store data in a texture and read it back as typed values: positions, velocities, colours, any
numbers you want to keep from one frame to the next or read somewhere else.

## Data Texture

One node, three parts on its card:

- **In: what is stored.** Up to four inputs. Each has a name, a type (float, vec2, vec3, vec4) and
  the channels it writes (r, g, b, a). There are four channels in all, so the inputs share them:
  two vec2s, a float and a vec3, four floats, one vec4. A channel another input holds is greyed
  out; **+ Input** offers the channels still free. The strip at the top shows what each channel holds
  (`r position.x`, `g position.y`, `b free`…).
- **Out: what is read back.** Up to four outputs. Pick the channels each returns, in order: the
  output is as wide as its channels, whichever they are. `b` is a float, `rb` a vec2, `agr` a vec3,
  `rgba` a vec4, and `gr` swaps x and y. Outputs read at this pixel, or wherever **Read at** says.
- **Storage.**
  - **Precision:** Full float (32-bit) keeps values exact, as positions need. Half float keeps
    about 3 digits, enough for colours. 8-bit keeps 256 steps of 0…1 and uses the least memory.
  - **Read:** Exact texel reads one texel with no blending, which data needs (a blend of two
    positions is no position). Smooth blends between texels, for pictures.
  - **Values:** Raw stores numbers as they are. Range squeezes Min…Max into 0…1 to store it and
    stretches it back when read; 8-bit needs this.
  - **Size** and **Edges**, as on a Pass.

**Texture** and **Previous** are the texture itself and the texture a frame ago, for any texture node
(Read channels, Sample, Levels…). The card shows the texture's raw values as a picture.

### Simulations: a read that feeds the node sees last frame

When an output's read feeds the node's own inputs (directly or through other nodes), that read is
last frame's value. Wiring it is not a loop. So a node can keep state:

```
Data Texture.position ──▶ Step (position + speed × flow) ──▶ Data Texture.position
                                                          └─▶ Look ──▶ Output
```

Step reads last frame's position; Look reads this frame's. The texture starts at 0 and ↺ clears it,
so a step can tell an empty texel (0) from a stored one and write a starting value. The example
**Texture tools 11 · Data Texture: positions that drift** is this graph.

## Read channels (texture)

The same read for any texture: a Pass, a picture, a video, a Data Texture's Texture. Channels is a
pattern of one to four of r g b a; the output is a float, vec2, vec3 or vec4 to match. Read and
Values work as on the Data Texture.

## How it compiles

`compiler/dataTextureExpand.ts` opens each Data Texture before the pass compile:

```
dataTexturePack (<id>__pack) ──▶ Pass (the node's own id) ──▶ Texture / Previous wires
                                         └──▶ Read channels (<id>__out<i> / <id>__prev<i>) ──▶ each output's wires
```

- The Pass keeps the node's id, so its buffer is an ordinary Pass target: kept, cleared by ↺,
  drawn on the card, exported. It counts toward the 8-Pass limit.
- The pack is the Pass's program: every wired input written into its channels, remapped for Range.
  An unused alpha is stored as 1, so the card's picture shows.
- Each output's wires read a Read channels node. Readers in front of the node (feeding it) read the
  Pass's Previous (`__prev<i>`); the rest read its Texture (`__out<i>`).
- Exact reads use `texelFetch`, clamped to the texture. The Pass is Nearest.

**Full float** is a new Pass format (`format: 'float'`): RGBA32F where the GPU can draw into it
(`EXT_color_buffer_float`), half float where it can't. Smooth reads of it need
`OES_texture_float_linear`; without that it reads exact texels. The builders' small previews store it
as half float.

## Not built yet

- **Several targets in one node** (multiple render targets): one draw writing several textures, each
  with its own four channels and precision, each its own Texture output, counting as one Pass.
- **A bigger editor**, opened from the card like an Expression Block's.
- **Preview modes:** per channel, false colour, vectors as arrows. The card shows raw values now.
