# Random (from ID)

**Random (from ID)** (Noise) gives a steady random number for each cell, copy or walker, from its ID. The same ID always gives the same number, and neighbouring IDs give unrelated ones, so each cell can get its own size, colour or height. Source: `src/nodes/definitions/randomFromId.ts`.

- **Inputs:** **Cell ID (3D)** (Voxelize, Repeat 3D), **Cell ID (2D)** (Grid Layout, a tile's floor(UV)) or **Number** (Loop Index, an agent's Index). The first one wired wins; a 2D ID or a number is padded with zeros.
- **Seed:** another whole set of numbers for the same IDs.
- **From / To:** the range of **Value**.
- **Outputs:** **Value** (From → To), **Random colour** (three unrelated numbers 0–1) and **Signed** (−1 to 1, for a nudge either way).

It's the classic `fract(sin(dot(id, k)) × 43758.5453)` hash that examples used to write by hand. **Combo: Voxelize + Sphere 3D + Random** uses it twice: once for each sphere's radius, once for its palette colour.

## Jump flood: Step, Steps and Start

**Jump flood (texture)** reads its repeated Pass's **Step** and **Steps** itself. Its reach is 2^(Steps − Step) picture pixels, halving every repeat, and its **Start** input (the seeds, from Mask's Seed output) is what it gives on step 0. So a jump flood needs no helper Expression Blocks: Mask → Jump flood → the Pass, with the Pass's Previous, Step and Steps wired back into the node.
