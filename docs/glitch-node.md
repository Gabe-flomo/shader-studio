# Glitch

Two pictures in, two damaged pictures out: A and B damage each other. Source: `src/nodes/definitions/glitch.ts`. In the library under **Effects → Glitch**.

## How it works

The picture is cut into blocks: **Blocks** is how many rows fit the picture's height, **Block width** how wide each one is (1 square, 8 long bars). Each block gets a random number (the same hash as Random (from ID)); **Amount** is the share of blocks that are hit. **Rate** deals the blocks again that many times a second (0 holds them still); **Seed** gives another deal.

Amount 0 leaves both pictures exactly as they came in.

## Modes

- **Swap blocks**: in a hit block, A′ is B and B′ is A, exactly.
- **Channel cross**: each colour channel crosses on its own, so some of A's channels come from B and back.
- **Displace by the other**: in a hit block each one is read pushed a random way, by the other's brightness. **Reach** is how far.
- **Bit flips**: both are cut to **Bits** bits per channel and random bits flip. With the other wired, only the bits the other has set too can flip, so the two damage each other.
- **Slice shift**: rows of A slide sideways by B's brightness, rows of B by A's (the other way). **Reach** is how far.

## A and B: texture or colour

**A is** and **B is** on the card switch each input between a **Texture** (a photo, a video, a Pass: Glitch reads it where it needs to) and a **Colour** (any colour chain, this pixel only). A colour can be swapped, crossed and bit-flipped, but it has nowhere to be pushed, so Displace and Slice shift turn its hue by the other's brightness instead.

## Outputs

**A′** and **B′** (colours) and **Hit**, 1 where a block, row or channel was hit: a mask of the damage, for Mix or a highlight.

Not done yet: damage that builds up frame after frame (it would need a feedback Pass round the node; wire A′ into a Pass and back into A to try it by hand).

## Example

**Pictures 10 · Glitch: two photos trade blocks** (Pictures folder): the Room and cat photo (A, a texture) and Walkway cat (B, a colour) trade long bars, side by side: A′ on the left, B′ on the right.
