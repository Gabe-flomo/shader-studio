# GI Lit March Group

The **GI Lit March Group** is a ray march container that replaces the basic Lambert diffuse of a standard March Loop Group with a single-pass GI approximation — ambient occlusion, soft shadows, a two-color sky dome, one diffuse GI bounce, and one specular reflection bounce. All in a single WebGL fragment shader pass.

---

## Overview

Wire it exactly like a March Loop Group:

```
March Camera → ro/rd
Scene Group  → scene
GI Lit March Group → color → Output
```

Double-click the node to enter its body subgraph, then place SDF primitives connected through a Scene Group (same workflow as MarchLoopGroup). The lighting is handled automatically; you only build the geometry.

---

## Lighting passes

Each pixel runs the following sequence after the primary ray hits:

| Pass | What it does | Controlled by |
|---|---|---|
| **Normal** | Finite-difference surface normal at the hit point | (automatic) |
| **AO** | March a short ray along the normal; occlusion darkens the result | `AO Steps` |
| **Soft Shadow** | March toward the light, accumulate penumbra from near-misses | `Shadow Steps` |
| **Diffuse** | Lambert from the directional light, tinted by sky dome at the normal | `Light Dir`, `Light Color`, `Light Strength`, `Sky Top`, `Ground` |
| **GI Bounce** | March one ray in a randomised hemisphere direction; color from that hit shades the primary | `GI Steps`, `GI Strength` |
| **Specular** | Reflect the camera ray and march it; Blinn-Phong falloff controlled by roughness | `Spec Steps`, `Spec Strength`, `Roughness` |
| **Metallic** | Tints the specular highlight toward the albedo color | `Metallic` |

All passes hit the same scene function, so they automatically pick up geometry built inside the subgraph.

---

## Inputs

| Input | Type | Description |
|---|---|---|
| `ro` | vec3 | Ray origin — connect from March Camera |
| `rd` | vec3 | Ray direction — connect from March Camera |
| `scene` | scene3d | Scene SDF function — connect from Scene Group |
| `albedo` | vec3 | Base surface color. Overrides the parameter sliders when wired |
| `lightDir` | vec3 | Directional light direction. Overrides the X/Y/Z sliders |
| `lightColor` | vec3 | Directional light color. Overrides the R/G/B sliders |
| `skyTop` | vec3 | Sky horizon/zenith color for IBL dome |
| `skyBot` | vec3 | Ground/nadir color for IBL dome |
| `bg` | vec3 | Background color shown for rays that miss the scene |

All vec3 inputs are optional — each falls back to its corresponding parameter sliders when unconnected.

---

## Outputs

| Output | Type | Description |
|---|---|---|
| `color` | vec3 | Final composite — plug into Output or a tone mapper |
| `dist` | float | Ray march distance to first hit |
| `depth` | float | Normalised depth [0..1] |
| `normal` | vec3 | World-space surface normal at the hit |
| `iter` | float | Normalised iteration count [0..1] |
| `iterCount` | float | Raw iteration count |
| `hit` | float | 1.0 if a surface was hit, 0.0 for background |
| `pos` | vec3 | World-space hit position |
| `ao` | float | Ambient occlusion value [0..1] |
| `shadow` | float | Soft shadow term [0..1] |
| `gi` | vec3 | Diffuse GI bounce color |
| `diffuse` | vec3 | Direct diffuse lighting (before GI blend) |
| `refl` | vec3 | Specular reflection color |

Use the individual outputs to build custom compositing: e.g. multiply `ao` onto your own diffuse, or drive an emissive glow from `hit`.

---

## Parameters

### March

| Param | Default | Range | Description |
|---|---|---|---|
| Max Steps | 80 | 8–256 | Ray march iterations. Raise for deeper geometry. |
| Max Dist | 20 | 5–100 | Far clip. Rays past this are background. |
| Step Scale | 1.0 | 0.3–1.0 | Safety factor per step. Lower for thin features. |
| Jitter | 0.0 | 0–1 | Per-pixel step offset. Removes banding; works well with GI noise. |

### Material

| Param | Default | Range | Description |
|---|---|---|---|
| Albedo R/G/B | 0.7 | 0–1 | Base surface color |
| Metallic | 0.0 | 0–1 | 0 = dielectric, 1 = metallic (specular tinted by albedo) |
| Roughness | 0.5 | 0–1 | 0 = mirror-sharp specular, 1 = fully diffuse |

### Light

| Param | Default | Description |
|---|---|---|
| Light X/Y/Z | 1.5 / 3.0 / 1.0 | Directional light direction vector |
| Light R/G/B | 1.0 / 0.95 / 0.85 | Directional light color |
| Light Strength | 1.0 | Multiplier on direct light contribution |

### Sky dome

| Param | Default | Description |
|---|---|---|
| Sky Top R/G/B | 0.2 / 0.45 / 0.8 | Zenith sky color for IBL |
| Ground R/G/B | 0.55 / 0.5 / 0.4 | Nadir ground color for IBL |

### Quality

| Param | Default | Range | Description |
|---|---|---|---|
| AO Steps | 5 | 3–12 | Steps for AO ray. 5 is usually enough. |
| Shadow Steps | 24 | 4–48 | Steps for soft shadow. 16 = fast, 32 = clean. |
| GI Steps | 16 | 4–48 | Steps for one-bounce GI hemisphere ray. |
| GI Strength | 0.4 | 0–1 | How much the GI bounce contributes to diffuse. |
| Spec Steps | 24 | 4–48 | Steps for specular reflection ray. |
| Spec Strength | 0.5 | 0–1 | Weight of specular in the final composite. |

---

## Body subgraph

The body subgraph works identically to a March Loop Group. After entering the node:

- **March Loop Inputs** — pre-placed anchor: outputs `ro`, `rd`, `marchPos`, `marchDist`.
- **Group Output** — pre-placed anchor: connect your final warped position here.
- Connect `marchPos` → [SDF / warp nodes] → Scene Group → `Group Output`.

The GI Lit March Group evaluates the warp function and calls the scene function for every GI, AO, shadow, and specular ray automatically.

---

## Example graphs

Four built-in examples are in the **GI Lighting** folder in the Graphs panel:

| Example | What it demonstrates |
|---|---|
| **GI: Sphere & Ground** | Minimal setup — sphere on a ground plane with AO, soft shadow, one GI bounce |
| **GI: Gold Torus** | Metallic material (metallic=0.9, roughness=0.15) with strong specular |
| **GI: Blob Cluster** | Smooth-min metaballs showing inter-object color bleeding via GI |
| **GI: Box Frame** | Hard-edged geometry, shadow detail from angled directional light |

---

## Performance

Each GI pixel runs: 1 primary march + 1 AO march + 1 shadow march + 1 GI bounce march + 1 specular march = **5× the march cost** of a plain MLG at equivalent step counts. Keep steps lean and use Jitter to hide the noise instead of raising step counts.

Typical budget: Max Steps 64–96, Shadow Steps 16–24, GI Steps 12–16, Spec Steps 16–24.
