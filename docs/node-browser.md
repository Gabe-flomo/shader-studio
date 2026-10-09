# Node Browser

The node browser (opened via the **+** button or by double-clicking empty canvas) organizes all nodes into categories and, for larger categories, sub-groups. Clicking a category opens it; clicking a sub-group label filters to just those nodes.

---

## Builders

The first section of the browser (the desktop palette, its drawer, and the phone's Nodes tab) is
**Builders**: windows that write a graph for you from a form or a few lines of text.

| Builder | Makes | A click |
|---|---|---|
| **3D Scene Builder** | shapes, combine, bend space, look, outputs | opens the builder on a new scene ([scene-builder.md](scene-builder.md)) |
| **Grid Rules** | Life, sand, heat, waves, Wireworld… | adds a Grid Rules node and opens its editor ([grid-rules.md](grid-rules.md)) |
| **Agent Rules** | slime, ants, flocks, infection… | adds an Agents group in rules mode and opens its rules ([agent-rules.md](agent-rules.md)) |
| **3D Agent Builder** | 3D slime, 3D flocks, orbiting swarms, curl smoke… | adds 3D agents (Ball Emit, a volume Trail, Draw agents through an orbiting camera) and opens their rules ([agent-rules.md](agent-rules.md) "The 3D Agent Builder") |

The section folds (the header's chevron) and stays folded in this browser. Searching "builder",
"scene", "rules" (or what they make: "sand", "slime") shows the builders found above the node
results. The empty canvas's right-click menu has the same builders under **Builders**, and the Do…
bar opens them by name: "new 3d scene", "new grid rules", "new agent rules", "edit the rules"
([do-bar-commands.md](do-bar-commands.md), Builders). Code: `src/builders/` (registry, open,
recipe, Do… bar phrases) and `src/components/builders/BuildersSection.tsx`.

A node a builder made carries a **Recipe chip** on its card: a built scene's recipe, a Grid Rules
node's rule, a rules group's rules, with Copy and Open.

---

## Categories

```
2D Primitives       3D Boolean Ops      3D Lighting         3D Primitives
3D Scene            3D Transforms       Animation           Color
Color Grading       Combiners           Conditionals        Effects
Fractals            Halftone            Math                Matrix
Noise               Particles           Particles & Fields  Post Processing
Science             Shapers             Sources             Spaces
Transforms          Utility             Output
```

---

## Post Processing category

A dedicated **Post Processing** category was added for full-screen compositing effects. It contains:

- **Vignette** — radial edge darkening
- **Scanlines** — CRT-style horizontal lines
- **Sobel Edges** — edge detection from luminance
- **Motion Blur** — accumulation-style motion blur

Previously these lived in Effects. **Grain** and **Tone Map** moved to **Color Grading** (Film sub-group and Tone sub-group respectively).

---

## Sub-groups

These categories show sub-group chips inside the browser. Clicking a chip filters to just those nodes; clicking again clears the filter.

### 2D Primitives
| Sub-group | Contents |
|---|---|
| SDF | circleSDF, boxSDF, ringSDF, simpleSDF, shapeSDF, sdBox, sdSegment, sdEllipse |
| Patterns | truchet, metaballs, lissajous |

### 3D Primitives
| Sub-group | Contents |
|---|---|
| Basic | sphere, box, torus, capsule, cylinder, cone, plane, octahedron |
| Curved | ellipsoid, capped torus, capped cone, rounded box, rounded cylinder, vertical capsule |
| Complex | box frame, link, pyramid, hex prism, tri prism, solid angle, sdCross |
| Fields | gyroid, schwarzP |

### 3D Transforms
| Sub-group | Contents |
|---|---|
| Move | translate, rotate, rotateAxis, scale |
| Repeat | repeat, limitedRepeat, polarRepeat, mirroredRepeat |
| Warp | twist, bend, sinWarp, displace, spiralWarp, domainWarp, shear |
| Fold | fold, mirrorFold, kaleidoscope, sphereInvert, mobiusWarp, logPolarWarp, helixWarp |

### 3D Lighting
| Sub-group | Contents |
|---|---|
| Shadow | sdfAo, softShadow |
| Surface | blinnPhong, fresnel3d, fakeSSS, materialSelect, multiLight |
| Glass | glass3d, fresnelSchlick, spectralDispersion |
| Volume | volumetricFog, phaseHG |

### Effects
| Sub-group | Contents |
|---|---|
| Blur | gaussianBlur, radialBlur, tiltShiftBlur, lensBlur, depthOfField |
| Chroma | chromaShift, chromaticAberrationAuto, chromaticAberration |
| Lighting | makeLight, light, light2d, radianceCascadesApprox |
| Warp | gravitationalLens, floatWarp |

### Color Grading
| Sub-group | Contents |
|---|---|
| Tone | liftGammaGain, toneCurve, shadowsHighlights, toneMap |
| Color | hueRotate, colorSaturation |
| Film | grain |

### Color
| Sub-group | Contents |
|---|---|
| Palette | palette, gradient, palettePreset, colorRamp, blackbody |
| Adjust | invert, desaturate, posterize, hueRange, brightnessContrast |
| Convert | hsv |
| Blend | blendModes |

### Combiners
| Sub-group | Contents |
|---|---|
| SDF Ops | smoothMin, min, sdfMax, sdfSubtract, smoothMax, smoothSubtract, sdfOutline, sdfColorize |
| Blend | blend, mask, addColor, screenBlend, alphaBlend |
| Layer | glowLayer |

### Spaces
| Sub-group | Contents |
|---|---|
| Warp | displace, uvWarp, smoothWarp, curlWarp, swirlWarp |
| Repeat | fract, infiniteRepeat, mirroredRepeat2D, limitedRepeat2D, angularRepeat2D |
| Distort | polarSpace, logPolarSpace, hyperbolicSpace, inversionSpace, mobiusSpace, swirlSpace, kaleidoSpace, sphericalSpace, rippleSpace, perspective2d, shear |
| Texture | waveTexture, magicTexture, grid |

### Math
| Sub-group | Contents |
|---|---|
| Arithmetic | add, subtract, multiply, divide |
| Trig | sin, cos, **tan**, atan2 |
| Rounding | abs, negate, ceil, floor, round, fract |
| Algebra | pow, sqrt, exp, tanh |
| Interp | clamp, mix, mixVec3, smoothstep, mod |
| Compare | min, max, step, sign |
| Geometry | length, dot, crossProduct, reflect, luminance |
| Vec2 | vec2Const, makeVec2, splitVec2, and more |
| Vec3 | vec3Const, makeVec3, splitVec3, and more |
| Complex | complexMul, complexPow |
| Remap | remap |

---

## Tan node

**Tan** — `amp * tan(input * freq)` — was added to Math › Trig. It has the same signature as Sin and Cos:

| Input | Type | Description |
|---|---|---|
| `input` | float/vec2/vec3 | Angle value |

| Param | Description |
|---|---|
| Freq | Multiplied onto the input before tan |
| Amp | Scales the output |

The inline viz shows S-curves with dashed asymptote guides at ±π/2. The waveform pen lifts at discontinuities so the vertical jumps at each asymptote are not drawn as false lines.

---

## Searching

Type in the search bar to filter across all categories. Results show the node name and category tag. The search also matches the node's GLSL function name and description.
