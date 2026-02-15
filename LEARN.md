# Shader Studio: A Technical Exploration of Visual Shader Programming

*Understanding the mathematics, rendering techniques, and compositional patterns behind generative shader art*

---

## Introduction

Shader programming operates on a fundamentally different paradigm than traditional graphics. Rather than issuing drawing commands, we define mathematical functions that execute in parallel across millions of pixels. Each pixel independently evaluates: "Given my coordinate, what color should I be?"

Shader Studio provides a node-based interface for composing these mathematical operations. Instead of writing GLSL directly, you construct data flow graphs where each node represents a transformation, computation, or rendering technique. The system compiles your graph into optimized GLSL that runs on the GPU.

This document explores the technical foundations underlying each node type, the mathematical principles that govern their behavior, and practical techniques for composing them into complete shader effects.

---

## Table of Contents

1. [Coordinate Systems and Data Flow](#coordinate-systems-and-data-flow)
2. [Signed Distance Functions](#signed-distance-functions)
3. [Boolean Operations and Smooth Blending](#boolean-operations-and-smooth-blending)
4. [Distance Field Rendering](#distance-field-rendering)
5. [Parametric Color Spaces](#parametric-color-spaces)
6. [Iterative Accumulation Patterns](#iterative-accumulation-patterns)
7. [Procedural Noise Techniques](#procedural-noise-techniques)
8. [Domain Transformation Operations](#domain-transformation-operations)
9. [Advanced Composition Techniques](#advanced-composition-techniques)
10. [Complete Effect Architectures](#complete-effect-architectures)

---

## Coordinate Systems and Data Flow

### UV Space: The Foundation

Every fragment shader receives a coordinate identifying its pixel location. In Shader Studio, the **UV** node provides normalized coordinates centered at the viewport origin.

```glsl
// Conceptual UV coordinate calculation
vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / u_resolution.y;
```

**Spatial model:**
```
     y
     ↑
     |
(-1, 1) ──────────── (1, 1)
     |        |        |
     |    (0, 0)       |  ← centered origin
     |        |        |
(-1,-1) ────────────  (1,-1)
     |
     └──────────────→ x
```

The coordinate system centers at `(0, 0)` and scales uniformly based on viewport height. This ensures circular SDFs remain circular regardless of aspect ratio.

**Building in Shader Studio:**
1. Add a **UV** node - this outputs `vec2` coordinates
2. Connect to any node requiring position input
3. The canvas preview shows these coordinates mapped to color (x→red, y→green)

---

### Aspect Ratio Correction

The standard UV node applies aspect correction by dividing the x-coordinate by the aspect ratio:

```glsl
uv.x *= u_resolution.x / u_resolution.y;
```

This transforms the square `[-1, 1]` space into a rectangle matching the viewport's proportions. Without correction, a circle defined as `length(uv) < 0.3` would render as an ellipse on non-square displays.

**PixelUV vs UV:**
- **UV**: Aspect-corrected, suitable for geometric shapes
- **PixelUV**: Raw pixel coordinates, useful for screen-space effects

---

### Time and Animation

The **Time** node outputs `u_time`, a continuously increasing value in seconds. This drives temporal animation.

```glsl
// Time as phase offset
float phase = sin(u_time);

// Time as angular rotation
float angle = u_time * 0.5;  // Rotate at half-speed

// Time as sawtooth wave
float cycle = fract(u_time);  // Repeats every second
```

**Common temporal patterns:**
- `sin(time)`: Oscillates -1 to 1
- `cos(time)`: Phase-shifted oscillation
- `fract(time)`: Sawtooth (resets to 0 every second)
- `time * speed`: Linear progression

**Building animated effects:**
1. Add **Time** node
2. Connect to any parameter socket (position, color, scale, etc.)
3. Optionally multiply by speed factor using **Multiply** node
4. Apply trigonometric function using **Sin** or **Cos** node for oscillation

---

### Mouse Interaction

The **Mouse** node provides cursor position in UV space. Wire this into position parameters for interactive displacement.

```glsl
// Offset shape by mouse position
vec2 offset = uv - u_mouse;
float d = circleSDF(offset, 0.3);
```

**Building interactive shaders:**
1. Add **Mouse** node (outputs `vec2`)
2. Use **Subtract** (Vec2) to compute `uv - mouse`
3. Feed result into SDF position input
4. Shape now follows cursor position

---

## Signed Distance Functions

### Mathematical Shape Representation

Consider how a circle exists in coordinate space. Rather than storing pixels, we define it as a relationship: every point has a measurable distance to the circle's boundary.

```glsl
float circleSDF(vec2 p, float r) {
    return length(p) - r;
}
```

**Spatial interpretation:**

Query point `p = (0.1, 0.0)` with `r = 0.3`:
```
length(p) = 0.1
0.1 - 0.3 = -0.2  ← negative = inside
```

Query point `p = (0.5, 0.0)` with `r = 0.3`:
```
length(p) = 0.5
0.5 - 0.3 = 0.2   ← positive = outside
```

The zero-contour (`d = 0`) defines the visible boundary. The function creates a **continuous distance field** - every coordinate maps to its signed distance from the surface.

**Visualizing the field:**
```glsl
#ifdef GL_ES
precision mediump float;
#endif

uniform vec2 u_resolution;

float circleSDF(vec2 p, float r) {
    return length(p) - r;
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / u_resolution.y;
    float d = circleSDF(uv, 0.3);

    // Map distance to grayscale
    vec3 color = vec3(d + 0.5);
    gl_FragColor = vec4(color, 1.0);
}
```

Negative values (inside) appear dark, zero (boundary) is mid-gray, positive (outside) brightens with distance.

**Building in Shader Studio:**
1. Add **UV** node
2. Add **Circle SDF** node
3. Connect UV output to Circle SDF position input
4. Set radius parameter (default 0.3)
5. Wire Circle SDF distance output to **Make Light** node to visualize
6. Connect light output to **Float to Vec3** node
7. Connect Vec3 to **Output** node

You should see a glowing circle centered at origin.

---

### Box SDF: Axis-Aligned Rectangles

Rectangular distance fields require handling corner regions separately from edge regions.

```glsl
float boxSDF(vec2 p, vec2 b) {
    vec2 d = abs(p) - b;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}
```

**Decomposition:**

1. `abs(p)` - Exploit symmetry, fold to positive quadrant
2. `abs(p) - b` - Distance to each edge
3. `max(d, 0.0)` - Outside distance (positive components only)
4. `min(max(d.x, d.y), 0.0)` - Inside distance (most negative component)

**Spatial regions:**
```
Corner region:     Edge region:      Interior:
  d.x > 0 && d.y > 0   d.x > 0, d.y < 0    d.x < 0 && d.y < 0
  Use length(d)        Use d.x             Use max(d.x, d.y)
```

**Building in Shader Studio:**
1. Add **UV** node
2. Add **Box SDF** node
3. Connect UV to position input
4. Adjust width/height parameters (or wire dynamic values)
5. Wire distance output to visualization chain (Make Light → Output)

---

### Ring SDF: Absolute Distance

A ring is a circle where we only care about proximity to the radius, not interiority.

```glsl
float ringSDF(vec2 p, float r) {
    return abs(length(p) - r);
}
```

The `abs()` folds negative (inside) values to positive, creating symmetric distance on both sides of the boundary.

**Distance profile:**
```
         outside
           │
    ───────┼───────  radius
           │
         inside

After abs(): both sides measure distance to radius
```

**Building in Shader Studio:**
1. **UV** → **Ring SDF** → **Make Light** → **Output**
2. Adjust radius to see ring thickness change
3. Lower brightness in Make Light for wider glow

---

### Advanced SDFs: IQ's Primitives

Inigo Quilez developed exact SDFs for complex shapes. These involve analytical geometry:

**Ellipse SDF:**
```glsl
float sdEllipse(vec2 p, vec2 ab) {
    // Exploit symmetry
    p = abs(p);
    if(p.x > p.y) { p = p.yx; ab = ab.yx; }

    // Solve cubic equation for nearest point
    float l = ab.y*ab.y - ab.x*ab.x;
    // ... (full implementation in nodes/definitions/sdf.ts)

    return length(r - p) * sign(p.y - r.y);
}
```

This solves a cubic polynomial to find the nearest point on the ellipse boundary - mathematically exact but computationally expensive.

**Segment SDF:**
```glsl
float sdSegment(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a;
    vec2 ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h);
}
```

Uses projection: `h` represents the closest point along the line segment (clamped to [0,1] to stay within endpoints).

**Building complex SDFs:**
1. Add **sdSegment**, **sdEllipse**, **sdBox** nodes from the SDF category
2. Wire UV input
3. Adjust geometric parameters (segment endpoints, ellipse radii, etc.)
4. Combine multiple SDFs using **Smooth Min** (covered next section)

---

## Boolean Operations and Smooth Blending

### Hard Union: The Minimum Operator

The simplest way to combine two SDFs is taking their minimum:

```glsl
float d1 = circleSDF(p - vec2(-0.3, 0.0), 0.2);
float d2 = circleSDF(p - vec2(0.3, 0.0), 0.2);
float combined = min(d1, d2);
```

At any point, `combined` equals whichever shape is closer. This creates a **union** - you're inside the combined shape if you're inside either original shape.

**Distance field visualization:**
```
d1 alone:  ⚫····················
d2 alone:  ··················⚫··
min(d1,d2): ⚫··················⚫  (both shapes visible)
```

However, the transition is **discontinuous** - a sharp crease forms where the distance fields meet.

---

### Smooth Minimum: Polynomial Blending

The smooth minimum creates organic blending between shapes:

```glsl
float smin(float a, float b, float k) {
    float h = max(k - abs(a - b), 0.0) / k;
    return min(a, b) - h * h * h * k * (1.0 / 6.0);
}
```

**Mathematical breakdown:**

1. `abs(a - b)` - Distance between the two SDF values
2. `k - abs(a - b)` - Blend region (positive only when SDFs are within `k` of each other)
3. `h = clamp(...) / k` - Normalized blend factor [0, 1]
4. `h³` - Cubic polynomial (creates C² continuity)
5. Subtract `h³ * k / 6` from `min(a, b)` - Smooth blend

**Blend region behavior:**
```
When |a - b| > k:  h = 0,  returns min(a, b)  (hard edge)
When |a - b| < k:  h > 0,  smooth interpolation
When a ≈ b:        h ≈ 1,  maximum blend
```

The cubic polynomial `h³` ensures:
- Smooth first derivative (C¹)
- Smooth second derivative (C²)
- Natural, organic appearance

**Building metaballs in Shader Studio:**
1. Add two **Circle SDF** nodes at different positions
   - Circle 1: position X = -0.3
   - Circle 2: position X = 0.3
2. Add **Smooth Min** node
3. Connect both circle distances to Smooth Min inputs
4. Adjust smoothness parameter (0.1 = subtle, 1.0 = very rounded)
5. Wire output to **Make Light** → **Palette** → **Output**

You should see two circles that smoothly merge in the middle.

---

### Smooth Parameter Effects

**k = 0.1:** Minimal smoothing, shapes nearly separate
**k = 0.5:** Natural organic blend (default)
**k = 1.0:** Very rounded, bubbly merging
**k = 2.0:** Extreme blending, nearly spherical union

**Animating blend:**
Wire **Time** → **Sin** → **Multiply** (scale to 0-1 range) → Smooth Min `k` parameter
Shapes will breathe between separated and merged states.

---

## Distance Field Rendering

### From Distance to Intensity

Distance fields encode geometric information. To render them, we transform distance into visual intensity.

The fundamental transform: **inverse relationship** - objects further from the surface are dimmer.

---

### Exponential Falloff

```glsl
float makeLight(float d, float brightness) {
    return exp(-brightness * d);
}
```

**Why exponential?**

The function `exp(-bx)` has these properties:
- Always positive (never negative colors)
- Smooth, continuous falloff
- Approaches zero at infinity
- Derivative exists everywhere (smooth gradients)

**Parameter control:**
- `brightness = 1.0`: Very soft, wide glow
- `brightness = 10.0`: Medium, focused glow (default)
- `brightness = 50.0`: Sharp, tight edge

**Mathematical behavior:**
```
d = 0.0  (on surface):  exp(0) = 1.0    (maximum brightness)
d = 0.1  (near surface): exp(-1.0) ≈ 0.37
d = 0.2:                exp(-2.0) ≈ 0.14
d = 0.5:                exp(-5.0) ≈ 0.007
```

The exponential decays rapidly - most energy concentrates near the surface.

**Visualizing falloff:**
```glsl
#ifdef GL_ES
precision mediump float;
#endif

uniform vec2 u_resolution;
uniform float u_time;

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / u_resolution.y;
    float d = length(uv) - 0.3;

    // Exponential falloff
    float intensity = exp(-10.0 * d);

    gl_FragColor = vec4(vec3(intensity), 1.0);
}
```

**Building in Shader Studio:**
1. **UV** → **Circle SDF** → **Make Light**
2. Adjust brightness parameter on Make Light node
3. Connect output to **Float to Vec3** → **Output**
4. Observe how brightness changes the glow profile

---

### Ring Light: Oscillating Intensity

```glsl
float ringLight(float d, float brightness, float freq) {
    float ring = abs(sin(d * freq));
    return exp(-brightness * ring * d);
}
```

**Decomposition:**

1. `sin(d * freq)` - Oscillates as distance increases
2. `abs(...)` - Rectify to always positive (creates concentric bands)
3. `ring * d` - Modulate by distance (outer rings dimmer)
4. `exp(-brightness * ...)` - Convert to intensity

**Frequency effects:**
- `freq = 5.0`: Wide, sparse rings
- `freq = 15.0`: Tight, dense concentric patterns
- Animate: `freq = 8.0 + 4.0 * sin(time)`

**Building ring effect:**
1. **Circle SDF** → **Light** node (not Make Light)
2. Set mode to "Ring Light"
3. Adjust Ring Freq parameter
4. Brightness controls falloff
5. Wire to color pipeline

---

### Simple Light: Inverse Distance

```glsl
float simpleLight(float d, float brightness) {
    return brightness * 0.01 / max(abs(d), 0.0001);
}
```

This is the raw `1/d` relationship:
- Creates very sharp highlights near surface
- Harsher falloff than exponential
- Requires `max(..., epsilon)` to prevent division by zero
- Useful for intense, focused energy

**Comparison:**
```
Exponential: Smooth, natural, film-like
Ring:        Periodic, interference patterns
Simple:      Sharp, intense, laser-like
```

---

## Parametric Color Spaces

### The Cosine Palette Function

Inigo Quilez's parametric palette generates infinite color variations from twelve numbers:

```glsl
vec3 palette(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
    return a + b * cos(6.28318 * (c * t + d));
}
```

**Parameter roles:**

- **a**: Offset (base color, shifts entire palette)
- **b**: Amplitude (how far colors swing from base)
- **c**: Frequency (how quickly colors cycle)
- **d**: Phase (where each RGB channel starts)

**Mathematical model:**

Each color channel follows: `a[i] + b[i] * cos(2π * (c[i] * t + d[i]))`

The cosine oscillates [-1, 1], scaled by `b` and offset by `a`:
```
Output range: [a - b, a + b]

Example: a = 0.5, b = 0.5
  Range: [0.0, 1.0]  (valid RGB)
```

**Standard rainbow palette:**
```glsl
a = vec3(0.5, 0.5, 0.5)     // Mid-gray base
b = vec3(0.5, 0.5, 0.5)     // Full range [0, 1]
c = vec3(1.0, 1.0, 1.0)     // Equal frequency
d = vec3(0.0, 0.33, 0.67)   // Phase-shift RGB
```

**Why this creates rainbow:**

At `t = 0.0`:
- Red: `0.5 + 0.5 * cos(0.0) = 1.0`
- Green: `0.5 + 0.5 * cos(2.094) ≈ 0.25`
- Blue: `0.5 + 0.5 * cos(4.189) ≈ 0.25`
- Result: Red dominant

At `t = 0.33`:
- Red: `0.5 + 0.5 * cos(2.094) ≈ 0.25`
- Green: `0.5 + 0.5 * cos(4.189) ≈ 0.25`
- Blue: `0.5 + 0.5 * cos(0.0) = 1.0`
- Result: Blue dominant

The phase offsets create a rotation through color space.

**Building animated palette:**
1. Add **Time** node
2. Add **Palette** node
3. Connect Time to `t` input
4. Leave a/b/c/d at defaults for rainbow
5. Multiply a color value (from **Make Light**) by palette output
6. Connect to **Output**

Watch colors cycle through the spectrum.

---

### Palette Presets

Shader Studio includes pre-defined palettes:

**IQ Blue-Teal:**
```glsl
a = [0.5, 0.5, 0.5]
b = [0.5, 0.5, 0.5]
c = [1.0, 1.0, 1.0]
d = [0.0, 0.1, 0.2]
```
Narrow phase range keeps colors in blue-cyan region.

**Fire:**
```glsl
a = [0.5, 0.5, 0.5]
b = [0.443, 0.424, 0.424]
c = [2.0, 1.0, 0.0]
d = [0.5, 0.2, 0.25]
```
High red frequency, suppressed blue creates warm palette.

**Using presets:**
1. Add **Palette Preset** node (simpler than full Palette)
2. Select from dropdown
3. Wire `t` input from glow, time, or other scalar
4. Multiply with intensity values

---

### Custom Palette Design

**To create specific moods:**

Warm/Fire tones:
```glsl
c = [2.0, 1.0, 0.0]  // Red cycles faster
d = [0.5, 0.2, 0.0]  // Blue suppressed
```

Cool/Water tones:
```glsl
c = [0.0, 1.0, 2.0]  // Blue cycles faster
d = [0.0, 0.3, 0.5]  // Red suppressed
```

Monochrome (single hue cycling brightness):
```glsl
c = [1.0, 1.0, 1.0]  // Equal frequency
d = [0.0, 0.0, 0.0]  // No phase shift
a = [0.8, 0.2, 0.3]  // Set specific hue
```

**Building custom palettes:**
1. Add **Palette** node
2. Expand parameter panel
3. Adjust vec3 sliders for a/b/c/d
4. Wire **Time** or **Length** (of UV) to `t`
5. Observe color changes in real-time

---

## Iterative Accumulation Patterns

### The Accumulation Paradigm

Complex visual phenomena emerge from iteratively accumulating simple operations.

```glsl
vec3 color = vec3(0.0);  // Initialize accumulator

for (float i = 0.0; i < N; i++) {
    // Compute contribution at this iteration
    vec3 contribution = computeLayer(i);

    // Accumulate
    color += contribution;
}
```

Each iteration adds one "layer" to the final image. Complexity emerges from the interaction of all layers.

---

### Fractal Loop: IQ's Signature Technique

```glsl
vec2 uv = original_uv;
vec3 color = vec3(0.0);

for (float i = 0.0; i < iterations; i++) {
    // Recursive tiling (fractal subdivision)
    uv = fract(uv * scale) - 0.5;

    // Distance at this scale
    float d = length(uv) * exp(-length(original_uv));

    // Create rings via oscillation
    d = sin(d * freq + time) / freq;
    d = abs(d);

    // Convert to glow
    float glow = glowAmount / d;

    // Sample palette
    float t = length(original_uv) + i * layerOffset + time * timeScale;
    vec3 col = palette(t, a, b, c, d);

    // Accumulate this layer
    color += col * glow;
}
```

**Step-by-step analysis:**

**1. Tiling:** `fract(uv * scale) - 0.5`
- `* scale`: Zoom in
- `fract()`: Wrap to [0, 1], creating infinite tiling
- `- 0.5`: Center each tile

Each iteration looks at a finer scale, creating self-similarity (fractal property).

**2. Distance with attenuation:** `length(uv) * exp(-length(original_uv))`
- `length(uv)`: Distance at current scale
- `exp(-length(original_uv))`: Fade toward viewport edges
- Creates vignette effect

**3. Oscillation:** `sin(d * freq) / freq` then `abs()`
- Creates concentric rings
- `abs()` makes them symmetric
- `freq` controls ring density

**4. Glow conversion:** `1 / d`
- Brightest at ring centers
- Falls off with distance

**5. Palette sampling:**
- `t` varies with viewport position and iteration
- Each layer gets a different color
- Animated by `time * timeScale`

**Building fractal rings:**
1. Add **UV** and **Time** nodes
2. Add **Fractal Loop** node
3. Connect UV → uv input
4. Connect Time → time input
5. Adjust parameters:
   - Iterations: 4-6 (more = denser)
   - Tile Scale: 1.5 (controls zoom factor)
   - Ring Freq: 8-12 (ring density)
   - Glow: 0.01 (overall brightness)
6. Wire color output to **Output** node

You should see recursive, rainbow-colored rings that animate.

**Parameter exploration:**
- **Scale Growth** > 1.0: Non-uniform zooming (exponential scaling)
- **Layer Offset**: Color shift between iterations
- **Glow Power** ≠ 1.0: Non-linear intensity (sharper/softer glow)

---

### Rotating Lines Loop

```glsl
for (float i = 1.0; i < iterations; i++) {
    // Pseudo-random rotation matrix
    mat2 R = mat2(
        cos(i), cos(i + offset1),
        cos(i + offset2), cos(i)
    );

    // Tile and rotate
    vec2 uv = fract((pixelUV * i * scale + time * scroll) * R) - 0.5;
    vec2 p = uv * R;

    // Distance to horizontal line
    float d = length(clamp(p, -boxHeight, boxHeight) - p);

    // Accumulate with cosine color
    color += glow / d * (cos(p.y / colorFreq + phaseShift) + 1.0);
}
```

**Key insight:** `mat2(cos(i), cos(i+a), cos(i+b), cos(i))`

This isn't a proper rotation matrix, but creates **pseudo-random** transformations. Each iteration has different geometric distortion.

The `offset1` and `offset2` values (like 33.0, 11.0) are chosen empirically to create visually pleasing variation.

**Building rotating lines:**
1. Add **Pixel UV** node (for screen-space coordinates)
2. Add **Time** node
3. Add **Rotating Lines Loop** node
4. Connect inputs
5. Parameters to adjust:
   - Iterations: 20 (default, try 10-40)
   - UV Scale: 0.1 (smaller = denser pattern)
   - Scroll Y: 0.2 (vertical motion speed)
6. Wire output to **Output**

Creates abstract, geometric animations with layered lines.

---

### Accumulate Loop: Configurable Modes

The most flexible loop node - every aspect is parameterized:

**Position modes:**

*Sinusoidal:*
```glsl
pos = sin(uv * freq / i + time * timeScale + cos(i * vec2(9.0, 7.0)))
```
Creates organic, flowing orb positions.

*Radial:*
```glsl
pos = uv + posScale * cos(i * posFreq + vec2(0.0, posPhase)) * sqrt(i)
```
Star-burst pattern, expands with iteration.

*Direct:*
```glsl
pos = uv
```
Simple, uses UV coordinates directly.

**Distance modes:**

*Circle:*
```glsl
d = length(pos)
```
Radial distance.

*Polar:*
```glsl
d = abs(length(pos) * freq * 0.02 - i)
```
Creates concentric arcs at different radii.

**Attenuation modes:**

*Inverse:*
```glsl
a = glow / max(d, epsilon)
```
Standard `1/d`.

*Inverse Square:*
```glsl
a = glow / max(d * d, epsilon)
```
Physical falloff, very sharp.

*Exponential:*
```glsl
a = exp(-d / glow)
```
Smooth, natural falloff.

**Building with Accumulate Loop:**
1. Add **Accumulate Loop** node
2. Set mode dropdowns:
   - Position: Sinusoidal (for orbs)
   - Distance: Circle
   - Attenuation: Inverse
   - Color: cos_vec3
   - Tonemap: tanh_sq
3. Wire **UV** and **Time**
4. Adjust iterations (50-100 for dense effects)
5. Tune `glow` (0.0003 - 0.001) for brightness

Experiment with different mode combinations - each creates distinct aesthetics.

---

### For Loop: Custom GLSL Body

Write your own iteration logic using template tokens:

```glsl
@uv = fract(@uv * 3.0) - 0.5;
float d = length(@uv) * exp(-length(@uv0));
float t2 = length(@uv0) + @i * 0.4 + @t * 0.4;
vec3 col = palette(t2, vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.0, 0.33, 0.67));
float g = sin(d * 8.0 + @t) / 8.0;
g = 0.01 / abs(g);
@color += col * g;
```

**Token reference:**
- `@uv`: Current UV (modified each iteration)
- `@uv0`: Original UV (constant)
- `@color`: Accumulator (output)
- `@i`: Loop index (0 to N-1)
- `@t`: Time value

**Building custom loops:**
1. Add **For Loop** node
2. Wire **UV** and **Time**
3. Set iterations
4. Edit body parameter (multiline GLSL)
5. Use tokens in your code
6. Output: `@color` contains accumulated result

This is the escape hatch for completely custom iteration logic.

---

## Procedural Noise Techniques

### Continuous Random Fields

Noise functions generate "random-looking" values with these properties:

1. **Deterministic**: Same input always yields same output
2. **Continuous**: Nearby inputs produce nearby outputs
3. **Uniform**: No obvious patterns or periodicity
4. **Multi-dimensional**: Works in 2D, 3D, 4D space

This creates a landscape of smooth, random variation.

---

### Fractal Brownian Motion (FBM)

Single octave noise is bland. FBM combines multiple frequencies:

```glsl
float fbm(vec2 p, int octaves) {
    float value = 0.0;
    float amplitude = 0.5;
    float frequency = 1.0;

    for (int i = 0; i < octaves; i++) {
        value += amplitude * noise(p * frequency);

        frequency *= 2.0;   // Each octave doubles frequency
        amplitude *= 0.5;   // Each octave halves amplitude
    }

    return value;
}
```

**Fractal interpretation:**

Each octave adds detail at a specific scale:
- Octave 0: Large features (frequency = 1.0)
- Octave 1: Medium details (frequency = 2.0)
- Octave 2: Fine details (frequency = 4.0)
- ...

Higher frequency means smaller features, lower amplitude means less influence.

**Lacunarity and Gain:**

```glsl
frequency *= lacunarity;  // Default: 2.0
amplitude *= gain;        // Default: 0.5
```

- **Lacunarity** > 2.0: Emphasizes high frequencies (rougher)
- **Lacunarity** < 2.0: Softer transitions
- **Gain** > 0.5: Higher octaves have more influence (noisier)
- **Gain** < 0.5: Lower octaves dominate (smoother)

**Building FBM:**
1. Add **FBM** node
2. Wire **UV** input
3. Set octaves (4-6 typical, 8 for high detail)
4. Adjust lacunarity and gain
5. Wire output to **Palette** (using noise as color parameter)
6. Or multiply with other effects

Creates organic, cloud-like patterns.

---

### Domain Warping: Feedback Noise

Instead of sampling noise at coordinates, displace the coordinates using noise:

```glsl
vec2 q = p + fbm(p + time * 0.1);
vec2 r = p + fbm(q + time * 0.15);
float n = fbm(r);
```

**Why this works:**

- First `fbm(p)` creates displacement field
- Adding this to `p` creates warped coordinates `q`
- Second `fbm(q)` warps again → `r`
- Final `fbm(r)` samples triple-warped space

The result: flowing, turbulent patterns that look organic and alive.

**Multi-level warping visualization:**
```glsl
#ifdef GL_ES
precision mediump float;
#endif

uniform vec2 u_resolution;
uniform float u_time;

// Simplified 2D noise (replace with real implementation)
float noise(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution.xy;

    // First warp
    vec2 q = uv + 0.3 * vec2(
        noise(uv + u_time * 0.1),
        noise(uv + 1000.0 + u_time * 0.1)
    );

    // Second warp
    vec2 r = uv + 0.3 * vec2(
        noise(q + u_time * 0.15),
        noise(q + 1000.0 + u_time * 0.15)
    );

    // Final noise sample
    float n = noise(r);

    gl_FragColor = vec4(vec3(n), 1.0);
}
```

**Building domain warp:**
1. Add **Domain Warp** node
2. Wire **UV** and **Time**
3. Set octaves (4-6)
4. Adjust warp strength (0.3-1.0)
5. Wire output (warped UV) to **FBM** or other effect
6. Creates flowing, turbulent motion

---

### Voronoi Noise: Cellular Patterns

Voronoi divides space into cells, each centered on a random point. The noise value is distance to nearest point.

```glsl
float voronoi(vec2 p) {
    vec2 cell = floor(p);
    vec2 frac = fract(p);

    float minDist = 1.0;

    // Check 3x3 neighboring cells
    for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
            vec2 neighbor = vec2(x, y);
            vec2 point = random2(cell + neighbor);  // Random point in cell

            float dist = length(frac - neighbor - point);
            minDist = min(minDist, dist);
        }
    }

    return minDist;
}
```

**Cell search:**
- Current cell + 8 neighbors (3x3 grid)
- Each cell has random point
- Find minimum distance across all points

**Variations:**

*F1 (first nearest):*
```glsl
return minDist;
```
Creates cells (bright near points, dark between).

*F2 - F1 (edge detection):*
```glsl
return secondMinDist - minDist;
```
Highlights cell boundaries.

**Building Voronoi:**
1. Add **Voronoi** node
2. Wire **UV** input
3. Adjust scale (smaller = larger cells)
4. Set mode (F1, F2-F1, Edge)
5. Wire to color pipeline

Creates cellular, cracked, or network patterns.

---

### Flow Fields: Noise as Direction

Use noise to define vector field - direction at every point:

```glsl
vec2 flowDirection(vec2 p, float scale) {
    return vec2(
        noise(p * scale),
        noise(p * scale + vec2(1000.0, 0.0))
    );
}

// Move particles
particlePos += flowDirection(particlePos, 0.1) * speed * dt;
```

Different noise calls (offset by large constant) ensure independent x/y directions.

**Building flow field:**
1. Add **Flow Field** node
2. Wire **UV** and **Time**
3. Output is warped UV coordinates
4. Wire to any downstream effect
5. Creates flowing, organic motion

---

## Domain Transformation Operations

### Infinite Repetition

```glsl
vec2 opRepeat(vec2 p, float spacing) {
    return mod(p + spacing * 0.5, spacing) - spacing * 0.5;
}
```

**Spatial wrapping:**

```
Before:  ───────────────────────▶ x

After:   ╭─╮ ╭─╮ ╭─╮ ╭─╮ ╭─╮
         │ │ │ │ │ │ │ │ │ │
         0 s 0 s 0 s 0 s 0 s
```

`mod(p, spacing)` wraps space every `spacing` units. The offsets center each tile.

**Building tiled pattern:**
1. **UV** → **opRepeat** (set spacing = 0.5)
2. **opRepeat** output → **Circle SDF** (radius = 0.1)
3. **Circle SDF** → **Make Light** → **Output**

Result: Infinite grid of glowing circles.

---

### Polar Repetition: Radial Symmetry

```glsl
vec2 opRepeatPolar(vec2 p, float n) {
    float angle = TAU / n;
    float a = atan(p.y, p.x) + angle * 0.5;
    a = mod(a, angle) - angle * 0.5;
    return vec2(cos(a), sin(a)) * length(p);
}
```

**Process:**
1. Convert to polar: `r = length(p)`, `theta = atan(p.y, p.x)`
2. Wrap angle: `mod(theta, angle)`
3. Convert back to Cartesian

Creates `n`-fold rotational symmetry.

**Building kaleidoscope:**
1. **UV** → **opRepeatPolar** (segments = 6)
2. **opRepeatPolar** → **Circle SDF**
3. Wire to rendering chain

Single circle becomes hexagonal mandala.

**Combining repetitions:**
1. **UV** → **opRepeatPolar** → **opRepeat** → **SDF**

Creates radially symmetric grid.

---

### 2D Rotation

```glsl
mat2 rotate2D(float angle) {
    float s = sin(angle);
    float c = cos(angle);
    return mat2(c, -s, s, c);
}

vec2 rotated = rotate2D(angle) * uv;
```

**Matrix representation:**
```
[ cos(θ)  -sin(θ) ]
[ sin(θ)   cos(θ) ]
```

Multiplying vector by this matrix rotates it counterclockwise by θ.

**Building rotation:**
1. **Time** → **Multiply** (by speed) → rotation angle
2. **UV** → **Rotate2D** node
3. Connect angle to Rotate2D
4. Wire output to any effect

**Spiral rotation:**
```glsl
angle = time + length(uv)
```

Rotation increases with distance from origin → spiral.

---

### Tiling with Fract

```glsl
vec2 tiled = fract(uv * scale);
```

`fract(x)` returns fractional part: `fract(2.7) = 0.7`

Applied to vectors: `fract([2.3, -1.8]) = [0.3, 0.2]`

This tiles space into 0-1 squares.

**Centering:**
```glsl
vec2 tiled = fract(uv * scale) - 0.5;
```

Shifts range to [-0.5, 0.5], centering each tile.

**Building tile effect:**
1. **UV** → **Fract** node (set scale = 5.0)
2. **Fract** → **Circle SDF**
3. Creates 5×5 grid of circles

---

## Advanced Composition Techniques

### Expression Node: Inline Mathematics

The **Expr** node allows arbitrary GLSL expressions:

```glsl
// Example: Smoothstep blend between two values
smoothstep(0.2, 0.8, in0) * in1 + (1.0 - smoothstep(0.2, 0.8, in0)) * in2
```

**Inputs:**
- Rename `in0`, `in1`, `in2`, `in3` to meaningful names
- Wire upstream outputs
- Reference by name in expression

**Output type:**
- Set to `float`, `vec2`, or `vec3`
- Expression must match type

**Use cases:**
- Custom blending functions
- Quick math without adding nodes
- Testing formulas before creating custom nodes

**Building with Expr:**
1. Add **Expr** node
2. Set output type
3. Name inputs (e.g., `value`, `threshold`, `scale`)
4. Write expression using those names
5. Wire inputs and connect output

---

### Custom Function Node: User GLSL

Define complete custom logic with arbitrary inputs:

**Single-line example:**
```glsl
Inputs: uv (vec2), freq (float)
Body:   pow(abs(sin(uv.x * freq) * cos(uv.y * freq)), 2.0)
Output: float
```

Creates interference pattern.

**Multi-line example:**
```glsl
Inputs: p (vec2), iterations (float)
Body:
    vec2 z = p;
    float iter = 0.0;
    for (float i = 0.0; i < iterations; i++) {
        z = vec2(z.x*z.x - z.y*z.y, 2.0*z.x*z.y) + p;
        if (length(z) > 2.0) break;
        iter = i;
    }
    result = iter / iterations;
Output: float
```

Computes Mandelbrot set iteration count.

**Helper functions:**

In **GLSL Functions** field:
```glsl
float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
```

Then use in body: `result = hash(uv)`

**Building custom nodes:**
1. Add **Custom Fn** node
2. Define input sockets (click to add)
3. Set output type
4. Write body (use input names as variables)
5. Optionally add helper functions
6. Wire and test

---

### Tone Mapping: Dynamic Range Compression

Accumulation loops often produce values > 1.0 (over-exposed). Tone mapping compresses to [0, 1].

**ACES (Academy Color Encoding System):**
```glsl
vec3 toneACES(vec3 c) {
    return clamp((c*(2.51*c+0.03)) / (c*(2.43*c+0.59)+0.14), 0.0, 1.0);
}
```

Film industry standard. Smooth roll-off at high values, preserves color relationships.

**Hable (Uncharted 2):**
```glsl
vec3 toneHable(vec3 x) {
    x *= 16.0;
    const float A=0.15, B=0.5, C=0.1, D=0.2, E=0.02, F=0.3;
    return ((x*(A*x+C*B)+D*E) / (x*(A*x+B)+D*F)) - E/F;
}
```

More contrast in midtones. Designed for games.

**Tanh:**
```glsl
vec3 toneTanh(vec3 c) {
    return tanh(c);
}
```

Simple S-curve. Good for psychedelic over-saturation effects.

**Response curves:**
```
Input:     0.0  0.5  1.0  2.0  5.0  10.0
ACES:      0.0  0.5  0.9  1.0  1.0   1.0   (smooth)
Unreal:    0.0  0.5  0.8  0.95 0.99  1.0   (gentle)
Tanh:      0.0  0.46 0.76 0.96 1.0   1.0   (S-curve)
```

**Building with tone map:**
1. After accumulation loop or bright effect
2. Add **Tone Map** node
3. Select mode (ACES for natural, Tanh for stylized)
4. Wire to output
5. Compare before/after - should see reduced blowout

---

### Grain: Film Texture

```glsl
float grainRand(vec2 n) {
    return fract(sin(dot(n, vec2(12.9898, 4.1414))) * 43758.5453);
}

vec3 applyGrain(vec3 color, vec2 uv, float amount, float seed) {
    return clamp(color + vec3(
        mix(-amount, amount, fract(seed + grainRand(uv * 1234.5678))),
        mix(-amount, amount, fract(seed + grainRand(uv * 876.5432))),
        mix(-amount, amount, fract(seed + grainRand(uv * 3214.5678)))
    ), 0.0, 1.0);
}
```

**Per-pixel randomness:**
- Different constants for RGB ensure independent noise
- `seed` parameter (often wired to time) animates grain
- `amount` controls intensity

**Building grain effect:**
1. Before **Output** node, add **Grain**
2. Wire color input
3. Wire **UV** (for spatial variation)
4. Wire **Time** to seed (for animation)
5. Adjust amount (0.03 = subtle, 0.1 = strong)

Adds film-like texture, hides banding artifacts.

---

## Complete Effect Architectures

### Example 1: Metaballs with Animated Color

**Goal:** Two organic blobs that smoothly merge, colored by rainbow palette.

**Node graph:**

```
UV ────────┬─────→ Circle SDF 1 ──┐
           │       (pos X = -0.3)  │
           │                       ├──→ Smooth Min ──→ Make Light ──┐
           └─────→ Circle SDF 2 ──┘    (k = 0.5)      (bright=10)   │
                   (pos X = 0.3)                                     │
                                                                     ├──→ Multiply Vec3 ──→ Output
Time ──────────────────────────────────────→ Palette ───────────────┘
                                             (IQ Rainbow)
```

**Step-by-step build:**

1. Add **UV** node
2. Add **Circle SDF** nodes:
   - Circle 1: X = -0.3, radius = 0.2
   - Circle 2: X = 0.3, radius = 0.2
3. Connect both UV outputs to each Circle SDF position
4. Add **Smooth Min** node, wire both distances in
5. Set smoothness = 0.5
6. Add **Make Light**, wire Smooth Min output
7. Set brightness = 10
8. Add **Time** node
9. Add **Palette** node, wire Time to t
10. Add **Float to Vec3** node, wire Make Light output
11. Add **Multiply Vec3** node
    - Input A: light (as vec3)
    - Input B: palette
12. Wire result to **Output** node

**Result:** Two circles that smoothly merge, colors cycling through rainbow.

**Enhancements:**

Animate position:
```
Time → Sin → Multiply (0.3) → Circle SDF X offset
```

Animate merge:
```
Time → Sin → Multiply (0.5) → Add (0.5) → Smooth Min k parameter
```

---

### Example 2: Fractal Rings

**Goal:** IQ-style recursive rings with palette coloring.

**Minimal graph:**

```
UV ─────┐
        ├──→ Fractal Loop ──→ Output
Time ───┘
```

**Build:**
1. Add **UV** and **Time** nodes
2. Add **Fractal Loop** node
3. Wire UV → uv input
4. Wire Time → time input
5. Leave palette at rainbow defaults
6. Wire color output directly to **Output**

**Parameter tuning:**
- Iterations: 4 (clean), 6 (dense)
- Tile Scale: 1.5 (wide rings), 2.5 (tight rings)
- Ring Freq: 8 (sparse), 15 (dense)
- Glow: 0.01 (bright), 0.005 (subtle)

**Optional enhancements:**

Add tone mapping:
```
Fractal Loop → Tone Map (Tanh) → Output
```

Add grain:
```
Fractal Loop → Grain (amount=0.05) → Output
```

---

### Example 3: Kaleidoscopic Geometry

**Goal:** Radially symmetric pattern with tiled shapes.

**Graph:**

```
UV ──→ opRepeatPolar ──→ opRepeat ──→ Circle SDF ──→ Make Light ──┐
       (segments=6)       (spacing=0.3)  (r=0.08)     (bright=20)  │
                                                                    ├──→ Multiply ──→ Output
Time ──→ Palette ──────────────────────────────────────────────────┘
```

**Build:**
1. **UV** → **opRepeatPolar** (segments = 6)
2. **opRepeatPolar** → **opRepeat** (spacing = 0.3)
3. **opRepeat** → **Circle SDF** (radius = 0.08)
4. **Circle SDF** → **Make Light** (brightness = 20)
5. **Time** → **Palette** (rainbow)
6. **Make Light** + **Palette** → **Multiply Vec3**
7. **Multiply** → **Output**

**Result:** Hexagonal mandala of circles.

**Variations:**

Different symmetries:
- segments = 3: Triangular
- segments = 5: Pentagonal
- segments = 8: Octagonal

Rotate the space:
```
UV → Rotate2D (angle = Time * 0.5) → opRepeatPolar
```

Mix shapes:
```
Circle SDF + Box SDF → Smooth Min → Make Light
```

---

### Example 4: Domain-Warped Noise

**Goal:** Flowing, turbulent organic patterns.

**Graph:**

```
UV ─────┬──→ Domain Warp ──→ FBM ──→ Palette ──→ Output
        │    (strength=0.5)   (oct=6)  (fire)
Time ───┘
```

**Build:**
1. Add **UV** and **Time**
2. Add **Domain Warp**
   - Wire UV and Time
   - Set warp strength = 0.5
   - Octaves = 4
3. Add **FBM**
   - Wire Domain Warp output to position
   - Octaves = 6
4. Add **Palette Preset**
   - Set to "Fire"
   - Wire FBM output to t parameter
5. Wire Palette to **Output**

**Result:** Flowing, flame-like turbulence.

**Multi-level warp:**

```
UV + Time → Domain Warp 1 ──→ Domain Warp 2 ──→ FBM
            (strength=0.3)     (strength=0.5)
```

Creates extremely complex, organic flow.

---

### Example 5: Gravitational Lens Effect

**Goal:** Interactive black hole that warps background pattern.

**Graph:**

```
UV ──────┬──→ Fractal Loop ──→ Output
         │
Mouse ───┤
         │
         └──→ Gravitational Lens ──┘
              (wire lensed_uv to Fractal Loop uv input)
```

**Build:**
1. Add **UV**, **Time**, **Mouse** nodes
2. Add **Gravitational Lens**
   - Wire UV to uv input
   - Wire Mouse to lens_center input
   - Set strength = 0.005
   - Mode = gravity
3. Add **Fractal Loop**
   - Wire Lens `uv_lensed` output to Fractal Loop `uv` input (not regular UV!)
   - Wire Time to time input
4. Wire Fractal Loop color to **Output**

**Result:** Move mouse to warp the fractal pattern. Creates black hole lensing effect.

**Enhancements:**

Animate lens position:
```
Time → Sin → Circle motion → Lens center (instead of Mouse)
```

Add horizon mask:
```
Fractal color * Lens horizon_mask → Output
```

Creates dark region at lens center.

---

## Mathematical Reference

### Vector Operations

**Dot product:**
```glsl
float d = dot(a, b);  // a.x*b.x + a.y*b.y
```

Measures alignment:
- `d > 0`: Vectors point same direction
- `d = 0`: Perpendicular
- `d < 0`: Opposite directions

Used in: Projections, reflections, angle calculations.

**Length:**
```glsl
float len = length(v);  // sqrt(v.x² + v.y²)
```

Euclidean distance from origin. Core of circular SDFs.

**Normalize:**
```glsl
vec2 dir = normalize(v);  // v / length(v)
```

Creates unit vector (length = 1) preserving direction.

**Distance:**
```glsl
float d = distance(a, b);  // length(b - a)
```

Distance between two points.

---

### Interpolation Functions

**Mix (linear interpolation):**
```glsl
float lerp = mix(a, b, t);  // a + (b - a) * t
```

At `t = 0`: returns `a`
At `t = 1`: returns `b`
At `t = 0.5`: returns midpoint

**Smoothstep:**
```glsl
float s = smoothstep(edge0, edge1, x);
```

Hermite interpolation (cubic):
```glsl
t = clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
return t * t * (3.0 - 2.0 * t);
```

Smooth S-curve from 0 to 1 between edges.

**Clamp:**
```glsl
float c = clamp(x, minVal, maxVal);
```

Constrains `x` to range [minVal, maxVal].

---

### Trigonometric Patterns

**Basic oscillation:**
```glsl
sin(x)     // -1 to 1
cos(x)     // -1 to 1 (phase shifted)
```

**Normalized to [0, 1]:**
```glsl
0.5 + 0.5 * sin(x)
```

**Frequency and phase:**
```glsl
sin(x * freq + phase)
```

- `freq > 1`: Faster oscillation
- `phase`: Horizontal shift

**Rectification:**
```glsl
abs(sin(x))  // Full-wave (always positive)
```

Creates symmetric wave.

**Interference:**
```glsl
sin(x) * cos(y)
```

Creates grid pattern.

---

### Power and Exponential

**Exponential:**
```glsl
exp(x)      // e^x
exp(-x)     // Decay function
```

**Power:**
```glsl
pow(x, n)   // x^n
```

- `n < 1`: Emphasize low values
- `n > 1`: Emphasize high values

**Sqrt:**
```glsl
sqrt(x)     // x^0.5
```

**Inverse:**
```glsl
1.0 / x     // Requires max(x, epsilon) to prevent division by zero
```

---

### Modulo and Fractional

**Mod:**
```glsl
mod(x, m)   // x - m * floor(x / m)
```

Wraps `x` to range [0, m).

**Fract:**
```glsl
fract(x)    // x - floor(x)
```

Returns fractional part [0, 1).

**Floor/Ceil:**
```glsl
floor(x)    // Largest integer ≤ x
ceil(x)     // Smallest integer ≥ x
```

---

## Conclusion

Shader programming transforms visual creation from pixel manipulation to mathematical composition. Each node in Shader Studio represents a precise mathematical operation - a distance function, a color transform, an iterative accumulation.

Complexity emerges not from algorithmic complication, but from the interaction of simple, well-defined transformations. A smooth minimum creates organic merging. A fractal loop builds recursive detail. A cosine palette generates harmonic color relationships. These primitives compose into systems far more intricate than their individual definitions suggest.

The node graph paradigm makes this composition explicit: data flows through transformations, each step visible and adjustable. The same mathematical principles that govern the compiled GLSL govern the visual graph - UV coordinates transform through domain operations, distances convert to intensities, scalars map to colors.

Master the fundamentals - understand what each node computes and why. Experiment with parameters - observe how small changes propagate through the graph. Combine operations - discover emergent patterns from simple interactions.

The mathematics is the medium. The compositions you build are the art.

---

*Technical documentation for Shader Studio - a node-based visual shader composition environment*
