# Background behaviour

What Playfield does with the GPU while you're somewhere else. The settings are in **App settings → Background**, and the code is in `src/lib/backgroundPolicy.ts`.

- **A hidden tab** (another tab in front, the window minimised) draws nothing. This was already the case.
- **Another window in front** (the tab still showing, but you're in another app or browser window). The setting **When another window is in front** chooses:
  - **Slow down** (default): about 8 frames a second.
  - **Pause**: stops until you click back in.
  - **Keep drawing**: full speed, as before.

  An open output (projector) window or a recording always keeps full speed.
- **Free GPU memory when hidden** (default on). After 3 minutes in a hidden tab, the main canvas and the node-preview renderer give their WebGL contexts back, so other tabs and apps don't run short of GPU memory. This matters because browsers cap how many WebGL contexts can be alive at once, and drop the oldest when they run out. When the tab shows again, the canvas rebuilds through the same path as a GPU reset. Simulations, particles and feedback start over then. It doesn't happen while an output window or a recording is running.

Even before this, the canvas stopped drawing once nothing on it was moving. What was still running at full speed was a moving graph in a visible window you weren't using, and the GPU memory of a tab left open in the background.
