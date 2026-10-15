# Value at point

Some values are different at every pixel: an SDF's distance, a noise, a mask, a gradient. Wired into something that
wants **one** number (a Text's Value, a memory node, a slider), each pixel gets its own, so a Text readout shows
every pixel's digit at once and glitches. **Value at point** (Utility) reads the value once, exactly, at **Point**
(picture coordinates), and gives that one number everywhere.

**Text does this by itself:** a wired Value is read at the text's Position (the middle of its first line). Its
**Value at** setting switches to *Each pixel* for the glitchy look on purpose.

## How it works

`compiler/probeExpand.ts` draws every Value at point into one shared tiny Pass (`__probe`, a full-float texel
each, one of the graph's 8 Pass slots for all of them). That Pass's program sets `g_uv` to texel *i*'s point before
the graph runs (`pinUvGlsl`), and reads `u_resolution` as the picture's size (`#define u_resolution
u_pictureRes`, set by the pass runners), so everything upstream is worked out as if the pixel were at the point.
Each node is replaced by a read of its texel.

Limits: Point is compile-time (moving it recompiles); nodes that read the pixel's own coordinates (Pixel
Coordinates, `gl_FragCoord`) aren't pinned; inside a group it passes the value through.

Code: `src/nodes/definitions/probe.ts`, `src/compiler/probeExpand.ts`. Tests:
`src/compiler/__tests__/valueAtPoint.test.ts`.
