# Channel tools

Three Texture tools for the four channels of data that trails, Data textures and Passes carry, with no code needed. Source: `src/nodes/definitions/channelTools.ts`.

A **channel** is one of the four numbers stored at each pixel. In a picture they are red, green, blue and alpha. In a Trail field they are whatever the walkers laid: one per species, grass and scent, flow and crowd. A Trail field's **Channel names** say which is which.

## Channel

One channel as a number you can use. It reads **Channels** (a Trail field's Channels, a Data texture read, any vec4) or a **Texture** at this pixel.

- **Channel**: 1–4, Brightness (of 1–3), All four added, or The largest.
- **Compare**: set A against another channel, B, first: **A − B** (prey scent minus predator scent), **A ÷ B**, **the larger**, **the smaller**. B comes from **Compare with** when it is wired, else from the same input.
- **Shape**:
  - **Raw**: the number as it is.
  - **0–1 (soft)**: 1 − e^(−value × Exposure), as Trail field's Amount.
  - **Remap**: From low/high onto To low/high.
  - **Threshold**: a soft step at Threshold.
- **Invert**: flips it.

Outputs **Value** and **Mask** (the same, kept between 0 and 1).

## Shuffle

Builds four new channels from one or two inputs, A and B: **Red from**, **Green from**, **Blue from**, **Alpha from** each pick a channel of A or B, or 0 or 1. "Put channel 3 in red, channel 1 in green" is two choices. It is After Effects' Shift Channels, Nuke's Shuffle and TouchDesigner's Reorder. Outputs **Color**, **Channels** and **Alpha**.

## Channel Colours

Gives each channel its own **Colour** (with its own **Exposure**, on or off) over a **Background**.

- **Glow** adds the colours like light, bright where channels overlap.
- **Paint** lays each over what's below, like ink.
- **Average** treats channels 1–3 as a colour summed over every layer and channel 4 as how many layers, so it shows the mean colour. Paint mixed by count, as the Painters example lays it. **Cover** sets how fast it covers the background.

Outputs **Color** and **Coverage** (how much of any channel is here, 0–1).

**Example**: Multi-species slime colours its three species with one Channel Colours (coral, teal, violet), where it used to have an Expression Block.
