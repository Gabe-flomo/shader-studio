# Text

**Text** (2D Primitives) draws words in the picture, TouchDesigner's Text TOP. It reads the preview's font atlas
(a bold monospace, ASCII), the same one Blob Track's labels use; web pages carry it too.

## Live numbers

Type `{}` in the text where a number should go: it shows the **Value** input (a slider and a socket). Wire an
Analyze reading, a Blob Track's Count, a Timer, a Counter, an LFO. **Decimals** sets the places after the point;
**Number width** keeps that many characters for it, right-aligned, so the line doesn't shift as it changes.

## Settings

| Setting | What it does |
|---|---|
| Text | The words. `\n` starts a new line. Letters, digits and ASCII symbols (others show as `?`). |
| Size | A line's height in picture units (the picture is 2 high). |
| Spacing, Line height | Letter spacing (1 is the font's own), distance between lines (in lines). |
| Align | Which edge of each line sits at Position: left, centre or right. |
| Position (X, Y) | Where the text sits: the top of the first line. Or wire a vec2 into Position. |
| Colour | The Color output's colour. |

Outputs: **Mask** (1 on the letters, soft edges) and **Color** (the letters in Colour). Wire a warp into **UV** to
bend the text.

## How it works

The text is compile-time: each line becomes a constant array of character codes (`{}` is a run of placeholders),
so changing the words recompiles; Value, Size, Spacing and Position are live. Each pixel finds its line and
character, reads that glyph's cell of the atlas with four taps (a quarter of a screen pixel apart, from `fwidth`) and
`tx_numChar` formats the number one character at a time.

Example: Memory 3 · A timer and a beat counter, as text. Code: `src/nodes/definitions/text.ts`.
Tests: `src/nodes/definitions/__tests__/textNode.test.ts`.
