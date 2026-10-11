# Frame rate

The canvas can run at a chosen frame rate instead of the screen's: 12 fps gives the blocky,
stop-motion movement of After Effects' "Posterize Time", and a lower rate also saves GPU.

## The control

The **fps** button in the preview header (next to the resolution button, on the Studio, Play and
page canvases) opens it:

- **Auto (screen's max)**: the default. Draws at the screen's own refresh rate; time is smooth.
- **6 / 8 / 12 / 15 / 24 / 30 / 60**, or a typed rate (decimals work: 23.98). Rates above the
  screen's are greyed out, and a typed one is capped at it.
- **Screen: 120 Hz** in the corner: the display's refresh rate, measured from
  `requestAnimationFrame` intervals (`lib/refreshRate.ts`) and measured again when the window
  moves to another screen. "~60 Hz" means it hasn't been measured yet.
- What the rate does (one setting, three choices):
  - **Both** (the default): draws N times a second *and* steps the time the shader sees by 1/N.
    The stop-motion look; also saves GPU.
  - **Draw less**: only draws N times a second. Time is whatever the clock says at each drawn frame.
  - **Step time**: time moves in steps of 1/N, but the canvas still draws at the screen's rate,
    so feedback, particles, knobs and the mouse stay smooth while time-driven motion is choppy.
- **Default for graphs without their own**: remembers the rate (a preference) for graphs that
  don't set one.

The rate is **saved with the graph** (`play.frameRate` in the graph file: `{ "fps": 12 }`, with
`"mode": "draw"` or `"posterize"` when not Both), so a stop-motion graph keeps its look when opened
again, exported or shared. Changing it is one undo step ("Frame rate: 12 fps"). The button shows
the rate in accent colour when one is set.

The time readout under the preview (and the Time node's readout, keyframe playheads) shows the
stepped time: at 12 fps it reads 0.00s, 0.08s, 0.17s…

The Performance panel's **FPS** shows the frames actually drawn, with "capped at 12 · screen 120 Hz"
under it (or "time steps at 12" for Step time). Auto resolution reads the rate against the cap,
so a 12 fps graph isn't mistaken for a slow one.

## How simulations behave

The rule: **the time the picture sees is stepped; anything driven by the clock keeps its real
speed; anything stepped per drawn frame steps once per drawn frame.**

- **Agents** (Agents groups, Grid steps that follow the clock): they run as many steps as the
  clock asks for, so at 12 fps they move just as fast, in 12 bursts a second.
- **Particles** step by the time since the last drawn frame (1/12 s at 12 fps): same speed, choppier.
- **Feedback** (Previous Frame, a Pass node's history, Echo) and **Grid Rules** step once per
  drawn frame. At Both or Draw less, a 12 fps trail fades over the same number of frames as at
  60, i.e. 5× longer in seconds, exactly as a 12 fps export of it would. With **Step time** they
  keep the screen's rate (the canvas draws every frame), and only the time is stepped.
- **Sound, video layers, the inputs** (MIDI, mappings, LFOs) keep the smooth clock; mappings and
  knobs are read on the frames that draw.

## Recording and export

- **Recording** (the browser's recorder at 30/60 fps): the canvas only repaints at the chosen rate,
  so the video holds each picture until the next (12 fps in a 60 fps file: each picture for 5
  frames, 3-2-3-2 at 30 fps).
- **Frame-by-frame exports** (FFmpeg, PNG sequence) and **Bake** render through
  `OfflineRenderHandle.renderAtTime`, which asks `offlineFrame` (`lib/frameRate.ts`): a frame in the
  same 1/fps step as the last is held (not rendered; its picture is read again), and a rendered one
  is at the step's time with 1/fps as its step, so feedback and particles step once per picture, as
  live. With Step time every frame renders, at its stepped time, with the export's own step.
  Exports use the graph's rate as saved, whatever the screen.
- **Web export**: the small snippet and the full player carry the rate (docs/web-export.md) and
  throttle and step the same way.

Not stepped yet: Play layers drawn over the picture in a frame-by-frame export are composited at the
export's rate (live they draw with the throttled frames).

## Code

- `src/lib/frameRate.ts`: the setting, `estimateRefreshHz`, `clampFps`, `resolveFrameRate`,
  `posterizeTime`, `gateFrame` (which screen frames draw), `offlineFrame` (held export frames),
  and the `useFrameRate` store (screen rate, default).
- `src/lib/refreshRate.ts`: the measurement.
- `src/components/ShaderCanvas.tsx`: the live gate (skipped frames keep `lastRafTime`, so the clock
  catches up on the next), `shaderTime`, and the hold in `renderAtTime`.
- `src/components/shell/PreviewChrome.tsx`: `FrameRatePicker`.
- `src/play/embedLite.ts`, `src/play/runtime/play-runtime.js`: web export.
- Tests: `src/lib/__tests__/frameRate.test.ts`, `src/play/__tests__/embedLite.test.ts`.

## Follow-ups

- Frame rate as a Play control / mapping target (a knob from 6 to 60 fps).
- Step Play layers in frame-by-frame exports too.
