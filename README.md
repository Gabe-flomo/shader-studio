# Playfield

_Formerly Shader Studio: the name changed, the app and its files did not. Saved graphs, libraries and folders keep working._

A node-based visual GLSL shader editor. Build fragment shaders by connecting nodes in a graph — no code required. Every connection compiles to optimized WebGL in real time.

**[Live Demo →](http://gabe-flomo.github.io/shader-studio/)**

---

## What it does

You wire together nodes — math, shapes, noise, color, physics — and the graph compiles to a GLSL fragment shader running on your GPU. Change a parameter and the canvas updates instantly.

The node system covers:
- **SDFs** — circle, ring, box, ellipse, segment, and more
- **Noise** — FBM, Voronoi, Domain Warp, Flow Fields (Tyler Hobbs-style step-through-field), Circle Packing
- **Fractals** — Mandelbrot/Julia sets, IFS (Sierpinski, Barnsley fern, dragon curve, Koch)
- **Physics** — Chladni plate resonance patterns, 2D electron orbitals (hydrogen wavefunction cross-sections), 3D volumetric orbital raymarching with real spherical harmonics
- **3D** — volumetric raymarching, cloud density fields, chromatic aberration
- **Color** — parametric cosine palettes (IQ-style), gradient, palette presets
- **Math** — every GLSL operation as a node (sin, cos, mix, smoothstep, expr, custom GLSL functions)
- **Effects** — iterative accumulation loops, domain transformations, gravitational lensing
- **Output** — vec3 and vec4 color outputs

The **Learn** folder in Examples is a Book of Shaders-style course in graphs: 18 numbered examples from a single colour to a first ray march, each with notes on the Play page that say what it shows, how it is built and what to try.

---

## Tech stack

| Layer | Library |
|---|---|
| UI framework | React 19 + TypeScript |
| State | Zustand 5 |
| 3D / WebGL | Three.js 0.182 |
| Build | Vite 7 |
| Code editor | Monaco (@monaco-editor/react) |

---

## Getting started

```bash
# Install dependencies
npm install

# Start dev server (localhost:5173)
npm run dev

# Production build
npm run build

# Preview production build locally
npm run preview
```

---

## Project structure

```
src/
├── components/
│   ├── App.tsx                  # Root — Studio / Learn page router
│   ├── ShaderCanvas.tsx         # Three.js WebGL renderer
│   ├── NodeGraph/
│   │   ├── NodeGraph.tsx        # Canvas drag-connect UI
│   │   ├── NodeComponent.tsx    # Individual node card + param controls
│   │   ├── ConnectionLine.tsx   # SVG wire renderer
│   │   └── NodePalette.tsx      # Node browser / search
│   └── LearnPage.tsx            # Interactive docs (6 sections)
├── nodes/
│   └── definitions/
│       ├── index.ts             # NODE_REGISTRY — all 60+ nodes
│       ├── sdf.ts               # Signed distance functions
│       ├── noise.ts             # FBM, Voronoi, DomainWarp, FlowField, CirclePack
│       ├── effects.ts           # Loops, Expr, CustomFn, GravLens, ...
│       ├── physics.ts           # ChladniNode, ElectronOrbitalNode
│       ├── threed.ts            # Raymarching, clouds, ChromAberr, OrbitalVolume3D
│       ├── color.ts             # Palette, PalettePreset, Gradient
│       ├── fractals.ts          # Mandelbrot, IFS
│       ├── math.ts              # Sin, Cos, Add, Multiply, Mix, ...
│       └── helpers.ts           # f(), vec3Str(), zeroFor()
├── compiler/
│   └── graphCompiler.ts         # Kahn's topo sort → GLSL generation
├── store/
│   └── useNodeGraphStore.ts     # Zustand store + 20+ example graphs
└── types/
    └── nodeGraph.ts             # GraphNode, NodeDefinition, Socket types
```

---

## How the compiler works

1. **Topological sort** (Kahn's algorithm) — resolves node execution order from the graph's connections
2. **GLSL function deduplication** — each node's `glslFunction` string is added to a `Set<string>`, so shared helpers (FBM, noise hashes, Laguerre polynomials, spherical harmonics) are emitted once
3. **Per-node code generation** — each node's `generateGLSL(node, inputVars)` returns a code snippet and its output variable names
4. **Fragment shader assembly** — preamble + deduplicated functions + `main()` body stitched together and compiled via Three.js `ShaderMaterial`

---

## Adding a node

```typescript
// src/nodes/definitions/yourcategory.ts
export const MyNode: NodeDefinition = {
  type: 'myNode',
  label: 'My Node',
  category: 'Effects',
  description: 'What it does.',
  inputs:  { uv: { type: 'vec2', label: 'UV' } },
  outputs: { value: { type: 'float', label: 'Value' } },
  glslFunction: `float myFn(vec2 p) { return length(p); }`,
  defaultParams: { scale: 1.0 },
  paramDefs: {
    scale: { label: 'Scale', type: 'float', min: 0.1, max: 5.0, step: 0.1 },
  },
  generateGLSL: (node, inputVars) => {
    const id  = node.id;
    const uv  = inputVars.uv ?? 'vec2(0.0)';
    const sc  = f(node.params.scale as number ?? 1.0);
    return {
      code: `    float ${id}_val = myFn(${uv} * ${sc});\n`,
      outputVars: { value: `${id}_val` },
    };
  },
};
```

Then add to `index.ts`:
```typescript
import { MyNode } from './yourcategory';
// In NODE_REGISTRY:
myNode: MyNode,
```

---

## Hosting

This is a static Vite app — it builds to plain HTML/JS/CSS with no server required.

### GitHub Pages (recommended)
See the deploy instructions in the repo or run:
```bash
npm run build
# Then push the dist/ folder to the gh-pages branch, or use GitHub Actions
```

### Netlify / Vercel
Drop the repo in and set build command `npm run build`, publish directory `dist`.

---

## Docs

Feature documentation lives in `docs/`:

| File | Contents |
|---|---|
| [`docs/iterated-groups.md`](docs/iterated-groups.md) | `carryMode` and `assignOp` — per-node feedback and accumulation inside iterated groups |
| [`docs/glsl-to-nodes.md`](docs/glsl-to-nodes.md) | The Convert page: pasted GLSL (Shadertoy, GLSL Sandbox, twigl, ES 3.00) to a node graph, loops as iterated groups, the render-equivalence check, the optimise-graph pass |
| [`docs/input-expressions.md`](docs/input-expressions.md) | A one-line expression on a float input (`input * 2.0 + sin(t)`) that leaves the raw input keyframeable; how the optimiser writes them |
| [`docs/multi-output-nodes.md`](docs/multi-output-nodes.md) | Custom Functions with extra `out`-style outputs, Expression Blocks that expose their variables as sockets |
| [`docs/cloner-layer.md`](docs/cloner-layer.md) | The Play Cloner layer: copies of a shape, text, image or null in a grid, ring, line, path or on particles, varied by index, shaped by null and shape effectors |
| [`docs/field-sockets.md`](docs/field-sockets.md) | Field sockets: inputs that take a node's code as a function of position. A shape by wire into Grid Pattern, Overflow across cells, the Array node and the Cell node; how the compiler builds the functions |
| [`docs/field-sockets-plan.md`](docs/field-sockets-plan.md) | The original plan for field sockets (built; see field-sockets.md): sockets that take a node's code as a function of position (a shape by wire into Grid Pattern), grid overflow across cells, and the Array node |
| [`docs/function-discovery.md`](docs/function-discovery.md) | Discover functions: scan the saved GLSL shaders for self-contained functions (by dependency level, return type, parameters), preview, Show in file, save to the Functions library |
| [`docs/js-layers.md`](docs/js-layers.md) | The Script layer: JavaScript sketches (setup/draw, declared sliders, the picture, nulls) as a Play layer, and the road from it to plugins |
| [`docs/matrices.md`](docs/matrices.md) | Matrix nodes (combine, invert, determinant, mix, scale/shear/stretch builders, projective Corner Pin, Colour Matrix), Grid Pattern's lattices as basis matrices, and the Matrices example folder |
| [`docs/constants-node.md`](docs/constants-node.md) | The Constants card: named values, fixed or with sliders, outputs only, Play-controllable |
| [`docs/playfield-sdk.md`](docs/playfield-sdk.md) | The SDK / add-on idea: layers, mappings and feeds as installable extensions (a write-up, not built) |

---

## License

MIT
