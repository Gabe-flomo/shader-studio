# True reset (↺)

Every ↺ in the app is now one reset: `resetRuntime()` in `src/lib/runtimeReset.ts`. After it,
the next frame is the frame a fresh open draws. Play and pause are left alone, and a reset is not an
undo step (it changes no document state).

## Where ↺ is

- the Studio preview's footer, the phone pill, the floating time strip, the Time node's card and
  the keyframe editor;
- the builders' own preview canvases (2D Scene, 3D Scene, Grid builder), next to Pause;
- the Warp Builder's `t = …` readout;
- the Agent Builder's step bar and the Grid Rules try board (the first button);
- Export's "from the top" and loading a song into an audio layer call it too.

The old `window.dispatchEvent(new CustomEvent('reset-time'))` still works: it calls `resetRuntime()`.

## What a reset clears

Each part registers how it starts over with `onRuntimeReset(fn)`. A new viewport or simulation
registers there and gets the reset for free.

| Part | Reset |
| --- | --- |
| Studio preview (`ShaderCanvas`) | clock, frame count (dither seed), `u_frameDt` |
| Feedback (`u_prevFrame`: Previous Frame, blurs, bloom…) | ping-pong pair dropped, made again cleared |
| Echo | the ring of past pictures dropped |
| Pass Previous (Grid Rules boards, rule memory) | every pass target cleared, so the board is dealt again from the same seed |
| Agents | walkers, trails and volumes cleared; each group's whole schedule new (step, births, live clock, Burst and Start over edges, listeners); the step governor, start-over requests, card step counts and the step bar's kept snapshots and queued steps |
| Particles nodes | started over on the next frame |
| Play | mappings' smoothing, delays, increments, conditions and pair axes; Look actions; the layers' particles, bodies and strokes |
| Builder preview canvases | their clock and Pass memory |
| Grid Rules try board | step 0's board, every later step dropped |

## What was surviving before

- `reset-time` set the clock to 0 but left the **feedback ping-pong** and the **echo ring** alone,
  so a feedback picture carried its old frames into the "restart".
- The **step bars** (Agent Builder, Grid Rules try board) keep recent steps to go back to. Their
  first button went back to the *oldest kept* step (the last few frames, or 400 board steps), not
  to step 0, and kept the frames after it. That is the "tracking the steps" part: it was never
  the undo history, which a reset does not touch.
- The agents' **step governor** (it lowers the steps a frame after slow frames) and the step bar's
  snapshots of the run before outlived the reset, so the first frames after it could step
  differently from a fresh open.
- Play mappings' **smoothing** glided from the old value instead of landing on the first reading.
- The builders' own preview canvases had **no reset at all**, so a Grid builder's "stays changed"
  memory never cleared.

## Tests

`src/lib/__tests__/trueReset.test.ts` checks the first frames after a reset against a fresh run:
a Grid Rules board run through the app's `PassRunner` with its GLSL executed on the CPU (pixel for
pixel), the slime mold through `AgentRunner` with a content-hashing renderer, and a builder's
preview passes. Each has a control that fails without the reset. `runtimeReset.test.ts` covers the
shared path; `playEngine.test.ts` the smoothing; `gridRules/__tests__/builder.test.ts` and
`gridRulesBuilderUi.test.tsx` the try board.

Note: a paused preview still draws when asked (a hover, a slider), and a feedback graph steps its
feedback on each of those draws, as before. The reset gives the fresh first frame; later paused
redraws carry on from it.
