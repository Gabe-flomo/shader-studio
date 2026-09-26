# Matrices

A matrix is a transform you can pass around: build it once, combine it with
others, undo it, measure it, apply it to any number of points. The Matrix
category has the building blocks and the Matrices example folder
(Matrix 1 … Matrix 8) walks through what they are for.

## Nodes

| Node | What it does |
|---|---|
| Matrix Const | Typed-in 2×2 or 3×3 values (existing). |
| Mat2 / Mat3 Construct, Inspect | Build from or split into vectors (existing). |
| Mat2 × Vec2, Mat3 × Vec3 | Apply a matrix to a vector (existing). |
| Rotation Matrix | mat2, and a mat3 about X, Y or Z (existing). |
| **Mat2 × Mat2, Mat3 × Mat3** | Combine two matrices. A × B does B first, then A. |
| **Mat2 Inverse, Mat3 Inverse** | The inverse (undo), the transpose and the determinant (area scale). The mat2 inverse never divides by zero. |
| **Mat2 Mix, Mat3 Mix** | Blend two matrices entry by entry. |
| **Scale Matrix, Shear Matrix, Stretch Matrix** | The common 2D builders. Stretch scales along any angle, optionally keeping the area. |
| **Mat3 × Point** | Apply a 3×3 matrix to a 2D point projectively: (x, y, 1), then divide by the third component. |
| **Corner Pin** (2D Space → Map) | The projective matrix mapping a square onto any four corners; outputs the UV inside the quad (0…1 or centred), a mask, an edge distance and the matrix. |
| **Colour Matrix** (Color → Adjust) | Hue rotation, saturation and gain as one mat3, applied with Mat3 × Vec3. |

GLSL is column-major: `mat2(a, b, c, d)` has columns (a, b) and (c, d). The
first column is where the X axis goes, the second where Y goes.

## Moving a shape vs moving space

Multiplying the UV by M moves the space the picture is read from, so the
picture moves by M⁻¹: scale the UV by 2 and the pattern gets smaller. To draw
a shape transformed by M, multiply the UV by M's inverse (Matrix 2). For a
pure rotation the inverse is the transpose.

## Lattices in Grid Pattern

Grid Pattern's **Lattice** setting picks where the cell centres sit. Every
option is a 2×2 basis matrix whose columns are the two steps from one centre
to its neighbours (in cell units, so centres stay 1 apart):

| Lattice | Basis columns | Cells |
|---|---|---|
| Square | (1, 0), (0, 1) | the original floor/fract grid, unchanged |
| Hexagons | (1, 0), (½, √3⁄2) | nearest centre: a honeycomb |
| Brick | (1, 0), (½, 1) | offset rows |
| Diamonds | (√½, √½), (−√½, √½) | the square grid turned 45° |
| Triangles | (√3, 0), (√3⁄2, 3⁄2) | each rhombus split into an up and a down triangle; the down one is turned 180° so a built-in triangle fits |
| Custom | the **Basis** input | any mat2 from matrix nodes |

Every non-square lattice finds a pixel's cell as its nearest lattice centre
(checking the 3×3 lattice points around it), then carries on exactly like the
square grid: jitter, pattern, affect, field sockets and Overflow all work.
Overflow steps over lattice neighbours (and both triangles per rhombus for
Triangles).

## The examples

1. **What a matrix does to space**: the four numbers of a 2×2 as sliders.
2. **Combine and undo**: Rotation × Stretch × Scale, inverted to place a
   star; √determinant corrects the outline width for the overall scale.
3. **Lattices**: a honeycomb with a hexagon SDF in each cell.
4. **Any basis**: Rotation × Shear × Scale into Grid Pattern's Basis, with an
   LFO sweeping the shear.
5. **Fold, rotate, scale**: the kaleidoscopic fractal loop in an iterated
   group, one Rotation Matrix shaping it.
6. **Corner pin**: a pattern printed on a card in true perspective.
7. **Rotated noise octaves**: FBM by hand through powers of one matrix; at
   angle 0 the value-noise grid shows.
8. **Colour matrices**: a Colour Matrix blended with a sepia Matrix Const.

## Also fixed

Building example 5 exposed that iterated groups declared their Loop Carry
(and Expression Block carry) variables inside the loop, so they were reset
on every pass and nothing carried. They are now declared before the loop;
this also makes the Learn folder's loop lesson fold as its notes describe.
