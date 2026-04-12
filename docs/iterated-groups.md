# Iterated Groups: carryMode and assignOp

Iterated groups let you run a subgraph multiple times in a single fragment shader pass. Two node-level properties — **carryMode** and **assignOp** — control how data flows between those iterations.

---

## carryMode

When `carryMode` is enabled on a node inside an iterated group, the node's first output is fed back as its own first type-matching input at the start of each iteration. The output of iteration N becomes the input of iteration N+1 — no extra loop/carry node needed.

### What it compiles to

```glsl
vec2 d;           // forward-declared once, outside the loop
d = g_uv;         // initialized to the initial input before the loop opens
for (float i = 0.0; i < 4.0; i++) {
    d = fract(d * 1.5) - 0.5;  // plain assignment — no type re-declaration
    // ... other nodes downstream can read d ...
}
```

Key details:
- The variable is **declared outside** the loop so the previous value is visible at the top of every iteration.
- The first iteration uses whatever is connected to that socket (typically the incoming UV).
- Subsequent iterations use the output from the previous pass.

### UI

When a node is inside an iterated group, a small circular-arrow button (⟳) appears on its card. Click it to toggle carry mode on or off. The button highlights in the accent color when active.

### When to use it

| Use case | What happens each iteration |
|---|---|
| UV folding | `uv = fract(uv * scale) - 0.5` — domain folds tighter each pass (fractal rings, Mandelbox-style) |
| Rotation accumulation | Rotate the same UV by a fixed angle each step (spiral / pinwheel patterns) |
| Domain warping | Push UV through multiple noise passes, each one building on the last |
| IFS-style transforms | Apply a linear transform repeatedly to converge toward an attractor |

---

## assignOp

`assignOp` controls how a node's output is **written** across iterations. The default is `=`, meaning each iteration overwrites the previous value and only the final iteration's result leaves the loop. Accumulation modes let you sum, subtract, multiply, or divide results across all iterations.

### What it compiles to (with `+=`)

```glsl
vec3 accum = vec3(0.0);  // neutral initializer declared outside loop
for (float i = 0.0; i < 4.0; i++) {
    vec3 fresh = palette(d);
    accum += fresh;       // each iteration adds to the running total
}
// downstream nodes receive `accum`
```

The neutral initializer (`vec3(0.0)`, `float(1.0)`, etc.) is chosen automatically based on the operator and output type so the loop starts from a mathematically sensible baseline.

### UI

When a node is inside an iterated group, a small dropdown appears in the node header. It shows the current operator (`=`, `+=`, `-=`, `*=`, `/=`). Changing it updates the generated GLSL immediately.

### Quick reference

| Operator | Neutral init | Effect |
|---|---|---|
| `=` | — | Last iteration wins (default, no accumulation) |
| `+=` | `0.0` / `vec*(0.0)` | Sum all iterations (glow, color accumulation) |
| `-=` | `0.0` / `vec*(0.0)` | Subtract each iteration from zero |
| `*=` | `1.0` / `vec*(1.0)` | Multiply iterations together (product filters) |
| `/=` | `1.0` / `vec*(1.0)` | Divide by each iteration (rarely used directly) |

---

## Worked example: Fractal Rings

This example builds a fractal ring pattern by combining `carryMode` (to fold UV space each iteration) with `assignOp += ` (to accumulate color from each fold).

### Graph setup

| Node | Setting | Purpose |
|---|---|---|
| **FractNode** | `carryMode = true` | UV folds on itself each iteration |
| **ScaleColor** (or Palette) | `assignOp = '+='` | Color from each fold accumulates |
| Iterated group | `iterations = 4` | Run the subgraph 4 times |

### Step by step

1. Add an iterated group and set iterations to 4.
2. Drop a **FractNode** inside the group. Connect the group's incoming UV to it. Enable ⟳ (carry mode) on it.
3. Drop a **Palette** node inside the group. Feed `length(d)` (from the FractNode output) into it.
4. Set `assignOp` on the Palette node to `+=`.
5. Connect the Palette's accumulated output to the group's color output.

### Generated GLSL

```glsl
vec2 d;
d = g_uv;
vec3 col = vec3(0.0);    // += neutral init

for (float i = 0.0; i < 4.0; i++) {
    d = fract(d * 1.5) - 0.5;     // FractNode, carryMode — folds UV each pass
    vec3 fresh = palette(length(d));
    col += fresh;                  // ScaleColor, assignOp='+=' — accumulates
}

// col is the final output color
```

Each iteration folds the UV domain into a smaller, more distorted version of itself, then samples a color from the current UV magnitude and adds it to the running total. The result is concentric rings that repeat at multiple scales — a simple approximation of fractal geometry in a flat 2D pass.

### Tuning tips

- Increase **iterations** (6–8) for more ring layers; shader cost scales linearly.
- Vary the fold scale (`1.5` above) — values closer to `1.0` produce tight, dense rings; larger values produce sparse, widely-spaced ones.
- Offset the UV before the loop (`uv - 0.5`) to center the pattern on the canvas.
- Mix a `*=` accumulator on a separate brightness node to darken outer folds.
