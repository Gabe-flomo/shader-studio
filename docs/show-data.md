# Show data

**Show data** (Texture tools) is a viewer: it shows what a number, a direction or four channels hold, so you can look at data before you decide what to do with it. It's Blender's viewer node with false colour, or TouchDesigner's Analyze / Info view. Wire it to Output while you look. Source: `src/nodes/definitions/showData.ts`.

| Show | Wire | You see |
|---|---|---|
| **Heat** | **Number**: a density, a distance, a channel, noise | The Turbo colour map: dark blue at **Low**, through cyan, green and yellow, to red at **High**. With **Flag out of range**, numbers above High are white and numbers below Low are darker blue, so clipped values stand out. |
| **Direction** | **Direction**: a velocity, a slope, Flow's direction | Hue is which way it points (right red, up yellow-green, left cyan, down violet). Brightness is how long it is × **Scale**. |
| **Channels** | **Channels** or a **Texture** | The four channels side by side in a 2 × 2 grid, each as Heat: 1 top left, 2 top right, 3 bottom left, 4 bottom right. A Texture is shown whole in every quarter; Channels, read at this pixel, shows the quarter of the picture it falls in. |

**Auto** (the default) picks by what is wired: a vector shows Direction, Channels or a Texture shows Channels, and a number shows Heat.

**Tips.** If everything is red, raise High. A Trail of sand reaches about 9, a Trail field's raw channels can reach hundreds, and a soft 0–1 output stays below 1. Show a Trail field's Image as Channels to see what each species or each deposit lays.
