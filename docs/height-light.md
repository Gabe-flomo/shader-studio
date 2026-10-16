# Height Light

**Height Light** (Texture tools) lights any height map like terrain under a sun. It is hillshade in a map tool, Bump → Diffuse in Blender, Bevel & Emboss in After Effects, Normal Map + Phong in TouchDesigner. Source: `src/nodes/definitions/heightLight.ts`.

## What it reads

- **Texture**: a Trail field's Texture (sand, termites' chips), a Depth map, a Pass, a picture. **Channel** picks which channel is the height (a Trail field's channels are 1–4), or its brightness.
- **Height ƒ**: any float instead (noise, an SDF's Distance, a Grid Rules wave). It's a field socket, so the node reads the height a little to each side of the pixel. It wins over Texture.

**Range low / high** say which heights count as lowest and highest. A Trail of sand reaches about 9, noise about 1. **Relief** is how tall the highest point stands, in picture units: more is steeper slopes and deeper shade. **Spacing** is how far to each side the slope is read, in pixels: wider is smoother.

## The sun and the colour

- **Sun from**: the direction in degrees (0 from the right, 90 from the top, 180 from the left).
- **Sun height**: low sun (10–30°) rakes across and shows every ripple; 90 is overhead.
- **Ambient**: light that reaches the shadows too.
- **Low / High colour**: the surface from Range low to Range high, unless **Colour** is wired (a palette, a picture).

## Outputs

**Color** is the lit surface. **Shade** is the light alone, 0–1, to multiply your own colours by. **Height** is 0–1 through Range. **Normal** is which way the surface faces. **Slope** is which way it rises and how fast.

## How it works

It reads the height at this pixel and on four sides of it, Spacing apart. Slope = the differences × Relief. Normal = normalize(−slope, 1). Shade = dot(normal, sun), clamped to 0–1. Color = surface × (Ambient + (1 − Ambient) × Shade).

## Example

**Sand drift** (Simulation: agents): the dunes are the Trail field (how deep the sand is) lit by Height Light. That goes into Draw agents' Background as the background, and Draw agents only adds the blowing grains on top.
