# Glass Scene

**Glass Scene** is a 3D rendering node for glass-over-geometry effects — a foreground glass shape composited against a background scene with true per-channel chromatic aberration and Fresnel blending. It lives in the **3D Scene** category and produces outputs compatible with `glass3d` for easy integration into existing compositing chains.

---

## Overview

Drop two Scene Groups — one for the glass geometry, one for the background — and wire them in:

```
March Camera  → ro / rd
Scene Group A → foreground   (glass geometry)
Scene Group B → background   (optional; sky gradient used if unconnected)
Glass Scene   → color → Output
```

The node self-contains its own ray march for both the foreground and the background, so no separate March Loop Group is needed.

---

## How it works

1. **Primary march** — marches the foreground scene SDF to find the glass surface.
2. **Normal** — computed via finite differences at the hit point.
3. **Fresnel** — `pow(1 - dot(rd, n), fresnelPow)` determines the reflection/refraction blend.
4. **Refracted rays** — three separate rays are bent by Snell's law, each with a slightly shifted IOR to produce per-channel dispersion (R bent one way, B the other). Each ray marches the background SDF independently so the dispersion shows in geometry, not just sky color.
5. **Background composite** — each channel reads the R/G/B channel of the background color from its own march result, then blends with sky based on whether that channel's ray hit something.
6. **Specular highlight** — Blinn-Phong from the light direction, added on top of the Fresnel blend.

---

## Inputs

| Input | Type | Description |
|---|---|---|
| `ro` | vec3 | Ray origin from March Camera |
| `rd` | vec3 | Ray direction from March Camera |
| `foreground` | scene3d | The glass geometry scene SDF |
| `background` | scene3d | The scene seen through and around the glass. Optional — sky gradient used if unconnected |
| `bgAlbedo` | vec3 | Surface albedo for the background geometry's diffuse shading |
| `tintColor` | vec3 | Color tint applied to the background (multiply). Leave at white for neutral |
| `lightDir` | vec3 | Light direction for specular highlight |

---

## Outputs

| Output | Type | Description |
|---|---|---|
| `color` | vec3 | Final composite |
| `fresnel` | float | Raw Fresnel term [0..1]; 1 at silhouettes |
| `refractedColor` | vec3 | Background color as seen through refraction |
| `reflectedColor` | vec3 | Sky/reflected color as seen from the glass surface |

`fresnel`, `refractedColor`, and `reflectedColor` match the output names of `glass3d` for compatibility.

---

## Parameters

| Param | Default | Range | Description |
|---|---|---|---|
| IOR | 1.5 | 1.0–3.0 | Index of refraction. Water ≈ 1.33, glass ≈ 1.5, diamond ≈ 2.4 |
| Fresnel | 3.5 | 1–10 | Fresnel rim exponent. Higher concentrates reflection at the silhouette |
| Dispersion | 0.06 | 0–0.20 | Per-channel IOR shift. Each R/G/B channel marches a slightly different refracted ray |
| Shininess | 80 | 2–256 | Blinn-Phong specular exponent |
| Diffuse | 0.5 | 0–1 | Diffuse weight for background geometry shading |
| Saturation | 1.6 | 0–3 | Color saturation boost on the background |

---

## Chromatic aberration

Setting **Dispersion > 0** fires three independent background marches (one per color channel) with slightly offset refracted ray directions. This produces real geometric aberration — background objects shift laterally per channel, not just in flat color. The effect scales from center to rim: `(1 - cosI)` weighting means the center stays clean while edges show color splitting.

At `Dispersion = 0`, all three channels share one refracted ray — no aberration, cheaper to compute.

---

## Optional background

When nothing is connected to the `background` input, the node falls back to a blue-to-dark sky gradient for each channel's refracted ray. This is the cheapest option and still shows chromatic shift in the sky sampling. Connecting a background scene adds geometry detail behind the glass at the cost of three extra ray marches.

---

## Example graphs

Three built-in examples are in the **3D Lighting** folder:

| Example | What it shows |
|---|---|
| `glassIridescentRim` | Fresnel + dispersion at grazing angles, iridescent rim effect |
| `glassTintedReflection` | Tinted glass tint with a colored background scene |
| `glassFlatBlend` | Flat diffuse background behind a glass disc, minimal parameters |

The older examples (`glassSceneOrbPillars`, `glassSceneTorusBlobs`, `glassSceneLensVoid`) show the full two-scene setup — foreground glass geometry composited over a background SDF scene.
