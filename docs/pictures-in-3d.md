# Pictures in 3D scenes

Two nodes put a picture or a video into a ray-marched scene (March Loop / Scene Group): **Picture Card**,
the picture as a card you place in the scene, and **Texture Material**, the picture wrapped onto any shape.
Both read a Texture node's **Texture** output (a picture, a video, the webcam) or any texture (a Pass, a
Shader Texture). Unwired, they show a grey checker. Code: `src/nodes/definitions/pictures3d.ts`.

Other ways pictures meet 3D, for comparison: Depth Composite / Depth Light / Picture Environment (a photo
the scene stands in, [depth-node.md](depth-node.md)), Time Cube / Frame Stack (a video as a volume,
[time-cube.md](time-cube.md)), agent sprites, the Play 3D Script layer, and the Scene Builder's pictures on
shapes ([scene-builder-3d.md](scene-builder-3d.md#textures)).

## Picture Card (3D Shapes, "Pictures")

A thin box whose shape comes from the picture. It is a shape like any other, so it is lit, casts and takes
shadows, shows in reflections (a second March Loop) and in the lens's depth of field.

Use it twice, as with Balls:

1. **In the Scene Group:** Scene Pos → Picture Card → Scene Output (or a union). Bring the picture in
   through a group port to its Picture. Only its **Distance** is used here.
2. **After the March Loop:** a second Picture Card with the same settings, Hit Pos into Position, the same
   picture. **Color** goes into the lights as the surface colour; **Glow** is added after them. Wire
   anything that changes (Position, Rotation, Threshold, Camera) into both from one source, so the shape
   and its colour agree (the examples do this through the group's ports).

| Setting | What it does |
|---|---|
| Position, Rotation (deg) | Where the card's middle is; turned about X, then Y, then Z (the Transform node's order). At 0 it faces +Z, so a March Camera at Angle 0 sees it straight on and the right way round. Both have sockets (right-click → Control from outside). |
| Size | The card's longer side, in scene units; the other side follows the aspect. |
| Facing | As turned; **Billboard: faces the camera**; **Billboard: turns round, stays upright** (like a sign). Wire March Camera → Ray Origin into Camera. Rotation Z still tilts a billboard. |
| Aspect | **From the picture** (`textureSize`, so a video or a picture you swap in keeps its shape) or **Custom** (Width ÷ height, the picture stretched to it). |
| Thickness | Thin reads as a print, thicker as a panel (its edges take the picture's edge colour). |
| Cutout, Threshold | **Alpha** (a PNG's transparent parts are cut away), **Bright** (a luminance key: dark parts cut away, for glowing things on black), **Dark** (a white background cut away). Parts below Threshold are not there: rays and shadow rays pass through them. |
| Back | The picture as seen through (mirrored, matching the cutout), the picture the right way round (text reads from behind), or a plain Back colour. |
| Emissive, Glow brightness | 0: a print that needs light (Color only). 1: a screen that shines in the dark (Glow only). In between, some of each. |

Outputs: Distance, Color (picture × (1 − Emissive)), Glow (picture × Emissive × Glow brightness), Alpha (the
key where the ray hit), Picture UV (0–1, as seen from the front), Front (1 on the front, 0 on the back).

### How the cutout works

Inside the march the card is a box. Only when the ray is within the card's thickness plus one texel of it
does the card read the picture (one `textureLod` at level 0) and, where the key is below Threshold, push its
distance out past the card (at least twice the half-thickness, or a texel), so the ray steps on through. A
cutout is a hard edge (no partial coverage). On a ray grazing the card the steps through a cut-away area are
short; very large transparent areas seen edge-on can run out of Max Steps.

## Texture Material (3D Lighting, "Surface")

Colours any shape with a picture at the hit point, after the March Loop.

- **Position**: the hit point in the shape's own space: Hit Pos through the same Transform the shape's point
  goes through in the Scene Group, so the picture moves and turns with the shape.
- **Normal**: which way the surface faces, in the same space. Unwired, it is worked out from Position's
  screen derivatives (`−normalize(cross(dFdx(p), dFdy(p)))`), which is automatically in the shape's own
  space: use that for a turned shape. A little blocky at silhouettes.
- **Base**: the shape's own colour (or the colour so far, to chain several). **Mask**: where it applies
  (Material Select's Blend, a "which shape" test).

| Mapping | What it does | Reads |
|---|---|---|
| Triplanar (seamless) | Three projections blended by which way the surface faces, to the power Blend sharpness. No stretching or seams on any shape. | 3 |
| Box | Each side the one projection it faces most; crisp edges. | 1 |
| Planar X / Y / Z | One projection through the shape, like a slide projector (streaks on the sides). | 1 |
| Sphere | Round the centre like a globe; Repeat round whole numbers meet without a seam. | 1 |
| Cylinder | Round the Y axis like a label, Planar Y on the caps (where the surface faces up or down by more than 45°). | 1 |

Each side reads the right way round from outside (a camera at Angle 0 on +Z sees +X to its left). Size is
how tall one picture is in scene units (planar, box, triplanar, the cylinder's height); Repeat round is for
Sphere and Cylinder. Offset slides it (in pictures), Turn turns it about its middle, Edges: Repeat tiles it,
Once shows one picture and the Base round it.

**Combine:** Replace (the picture is the surface colour, lit by the scene), Multiply (Base tinted by the
picture), Emissive (Base stays; the picture glows: Glow, added after the lights). Amount fades it.

## Cost and filtering

- **The colour is read once, at the hit.** The march only calls the scene function, where the card computes
  a box distance; nothing there reads the picture for colour. The card's Color / Glow / Alpha are
  expressions, so the read happens where a node after the loop uses them (the CPU-side test checks that the
  scene function has no texture read without a cutout). The only read in the march is the cutout's, near
  the card.
- **Mipmaps.** Reads at the hit are `textureGrad` with gradients from the hit point's screen derivatives
  pushed through the mapping: exact for planar, box and triplanar (the projection of `dFdx(p)`), and for the
  sphere and cylinder `dFdx` of the angle with the wrap taken out. So the mip level is right on every face,
  there is no seam line where a face or the wrap changes, and far surfaces go smoothly grey instead of
  shimmering. Gradients are capped at a quarter of the picture per pixel, so a silhouette (where the
  neighbouring pixel hit something far away) doesn't pull in the smallest mip. Pictures from the Texture node
  have mipmaps and 8× anisotropic filtering; videos have no mipmaps (they are read at full size: small
  videos can sparkle a little).
- **The cutout** reads level 0 inside the march (no derivatives there), so a cutout card far away can show
  its edge flickering slightly.
- **Reflections** cost a second march (the room example: 96 steps against the first's 160).
- Triplanar costs three reads per pixel, everything else one; each Texture Material and each colour card adds
  its reads only for its own pixels' work, not per march step.

## Scene Builder

- **Picture card** is a shape kind (gallery, recipe `picture-card size=1.5 t=0.02 cut=0.5 texture=name`):
  the picture comes in through the Scene Group's port as for Picture balls, Cutout is Alpha (a picture with no
  transparency stays a rectangle), and the colour comes from the same card in the Materials step (lit, Surface
  mode). Its own Position / Rotation are the builder's `at=` / `rot=`.
- **Box** and **Cylinder** join Triplanar, Planar, Spherical and Face as wraps for a shape's picture
  (`map=box`, `map=cylinder`). The builder builds them as Expression Blocks and Sample (texture) nodes like
  the others (Box as the triplanar block with one-hot weights, so three reads).

## Examples (folder "3D: Pictures")

- **Picture card: a video in a lit room**: the Ball action clip on a floating card in a ceiling-less room;
  its shadow on the floor, its reflection in the floor and a chrome ball (a second March Loop). Emissive 0.7.
- **Picture card: lit print and glowing cutout**: the Room and cat photo as a lit print, and the Ball action
  clip keyed by brightness so only the balls are left, glowing, an upright billboard following the camera.
- **Texture Material: a photo on a sphere, a box and a cylinder**: Walkway cat with Triplanar (sphere, turned
  box: its picture turns with it), Cylinder, and Planar Y on the floor (Multiply).

Tests: `src/nodes/__tests__/pictures3d.test.ts` (every mapping and card variant compiles in a march and
parses; the mapping maths on the CPU for known points; no picture read in the scene function without a
cutout; registration, library rows, aliases; the examples), `src/sceneBuilder/__tests__/textures.test.ts`
(Box and Cylinder wraps, the Picture card shape).
