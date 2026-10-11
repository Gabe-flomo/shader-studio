# Sliders you can wire

A slider is also an **input socket of the same name**: wire Time, an LFO, Noise, a Color, audio or any node into it and
the wire takes the slider's place; leave it unwired and the slider is the value. This is the card's long-standing
convention (FBM's Frequency, Voronoi's Randomness, Splat Explode's Center); as of 2026-10-11 it covers about 550 more
sliders on 157 nodes, so a graph can animate them without Play.

## On the card

- **Wired:** the slider row shows the wire's chip (the source and its value) in place of the ruler, swatch or the
  three vector rulers, greyed. Disconnect the wire and the slider is back with the value it had.
- **Showing the socket:** most of the new sockets come out on demand, so cards keep their size: right-click the slider →
  **Control from outside** (the Particles node's menu). A socket stays out while something is wired into it;
  **Back to slider** takes the wire out and hides it again. The splat modifiers show their headline sliders' sockets
  from the start ([splat-scene.md](splat-scene.md), "Wiring a slider").
- **Keyframes** on a slider now live on its socket (the same `__keyframes_<key>` data), and play the same.
- **Play** maps the slider (`nodeId::param`) while it's unwired; a wired slider leaves Play's list of controls.

## What can't be wired, and why

- Counts, iterations, octaves, seeds and loop bounds (`compileTime`, or whole numbers): they shape the code or are
  read as whole numbers, so a continuous wire means nothing.
- Sliders read in JS: the audio and MIDI engines, the scope, the Data and Depth analysers, Mandelbrot (its centre and
  zoom are split in JS for double precision), the hidden blur passes (Blur and Glow texture plan their stages from the
  radius).
- Engine-read or compiler-built nodes: Agents (draw settings, the trail, rule nodes inside a group), Time Cube View,
  Frame Stack, Grid Rules (its board step), Curve Trace (its Beam step), the loop ring steps, March Loop groups.
- Sources that are the value (Constant, Color, Vec2, Matrix, Color Ramp's and Stops Palette's stops): wire what they feed.
- Sliders a vector or colour socket already drives (a shape's Center X / Y, a box's Width / Height, March Camera's
  Target X / Y / Z, Corner Pin's corners, Light Dir, Fog colour): a second socket would fight it.
- Transform keeps its own Offset and Turn sockets (its sockets follow its Dimension); UV Transform's Translate and Scale
  sockets already back its sliders.

The PR that added them (wireable-controls) lists every slider, wireable or not, with the reason.

## For a node author

Add sockets for a list of sliders with `withParamSockets(def, keys, shown?)` (`nodes/definitions/helpers.ts`). It adds a
socket per key (labelled and hinted from the slider; float → float, vec3 / colour → vec3), puts the ones not in `shown`
on demand (`socketsOnDemand`), and hands `generateGLSL` the node with each wired slider's param replaced by the wire's
expression. That works because every live slider already reaches `generateGLSL` as an expression (its uniform's name):
a definition that reads `p(node.params.k)` or `pv3(node.params.k)` reads a wire the same way. Unwired, the node and its
code are exactly what they were. Hand-written definitions can do the same with `inputVars.k ?? p(node.params.k, d)`.

`withParamSockets` refuses a `compileTime` slider, a select or a bool, and a key the compiler fills by itself (`uv`, `p`,
`uv2`, `t`, `time`). `nodes/definitions/__tests__/paramSockets.test.ts` checks every one: unwired it reads its slider's
uniform; wired from an LFO (or a Color) it compiles, reads the source and no longer reads the slider.
