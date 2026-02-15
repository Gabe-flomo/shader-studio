# Shader Studio

A node-based visual GLSL shader editor. Build fragment shaders by connecting nodes in a graph — no code required. Every connection compiles to optimized WebGL in real time.

**[Live Demo →](https://gflomo.github.io/shader-studio)**

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

The **Learn** page is a full interactive guide covering the math behind every node category, with copyable code blocks, step-by-step build instructions, and "Open in Studio" buttons that load pre-built example graphs.

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

## License

MIT
