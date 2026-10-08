# Explanation model trial (2026-10-08)

Question: can a small local language model give better line-by-line explanations of shader code than the rule-based explainer, which mostly restates the line?

## Setup

- Model: `onnx-community/Qwen2.5-Coder-1.5B-Instruct` (Apache-2.0), pinned revision `774cc908…`, q4f16 on WebGPU via Transformers.js 4.3.1, in its own worker (`src/explainModel/worker.ts`). The 0.5B fallback was not needed: the 1.5B loaded and ran.
- Machine: Apple-silicon Mac (12 cores, 32 GB), the desktop app's embedded Chromium with WebGPU + `shader-f16`, dev server on a private port, greedy decoding (no sampling), repetition penalty 1.1.
- Prompt: the final grounded prompt (`src/explainModel/prompt.ts`): the line, the earlier lines of its block, the node and its neighbours, the facts from our deterministic explainer (reading, idioms, function meanings, names, colours, techniques found in that very line), two worked examples, at most 2 short sentences.

## Numbers

| | |
|---|---|
| Download | 1.36 GB on WebGPU (1.34 GB weights `model_q4f16.onnx` + 11 MB tokenizer); 1.93 GB on WebAssembly (`model_q4.onnx`). About 70 s at 20 MB/s. |
| Load from cache | about 1.9 s |
| First token | 0.75 – 1.9 s (prompt of 1 – 2 KB) |
| Speed | 15 – 24 tokens/s (35 tokens/s on a quiet machine) |
| A line explanation | 1.6 – 5.8 s end to end |

Fast enough to stream comfortably. Size is the cost: 1.4 GB, one time.

## Ten real lines

Lines from the bundled examples (Expression Blocks and a Custom Function): the rule-based explanation ("DET") next to the model's. My verdict on each is my own reading of what the line does.

| # | Line (example) | DET | Model | Verdict |
|---|---|---|---|---|
| 1 | `return pow(0.01 / abs(sin(d * 8.0 + time) / 8.0), 1.2)` (groupCarryRings) | Returns 0.01 divided by the scaled wave without its sign to the power 1.2. | A soft glow around objects from their distance and time; the sine wave "scaled and shifted to 0..1" … | Partly: the glow is right, the detail invented, cut off |
| 2 | `float x = t2.x + sin(t2.y * 5.0 + sp) / 30.0` (fcGrainGradient) | `x` is `t2.x` plus a sine wave of `t2.y` × 5 plus `sp` × 0.03333. | Adds a sine wave to the horizontal position of each pixel, scaled down; the wave moves with time. | Partly: the sideways wobble is right |
| 3 | `vec3 young = mix(vec3(0.55,0.72,1.0), vec3(1.0,0.45,0.7), step(0.95,h)) * (0.55 + 0.9*h)` (agentGalaxy) | `young` is the blend times `h` × 0.9 plus 0.55. | Blends cool blue and pink on whether the height h is above 0.95 … "55% of the way between white and blue" | Wrong in the details |
| 4 | `vec3 core = vec3(1.0,0.8,0.55) * (0.08 + 1.4 * exp(-r*r*40.0))` (agent3dGalaxy) | `core` is `vec3(1.0, 0.8, 0.55)` times a glow around the product × 1.4 plus 0.08. | Combines the base colour with a glowing effect: bright orange at the centre, fading outwards; exponential, starts bright and fades towards black. | **Good** |
| 5 | `float travel = d - t * speed` (agentShaderSoundRings) | `travel` is `d` minus `t` times `speed`. | How far the dust particles move: `d` minus the clock times the speed … | Partly: right maths, invented "dust particles" |
| 6 | `float solid = step(id.y, h)` (voxelTerrain) | `solid` is 1 while `id.y` stays under `h` and 0 otherwise: a switch … | Compares the height of the voxel to the threshold; if `id.y` is less than `h`, `solid` is 1; a hard on/off mask. | **Good** (restates, but correctly) |
| 7 | `float ridge = -0.42 + 0.22*sin(uv.x*2.1+0.6) + 0.08*sin(uv.x*6.3+1.7) + 0.03*sin(uv.x*17.0)` (passSlimeEdges) | `ridge` is the wave × 0.22 minus 0.42 plus the wave × 0.08 plus … | A subtle moonlight effect: sine waves give a gentle glow around the edges. | Wrong: it is a hill line (a skyline) across the picture |
| 8 | `float edge = 1.0 - 0.18 * dot(uv*vec2(0.45,0.8), uv*vec2(0.45,0.8))` (agentShaderNoiseFlow) | `edge` is 1 in the middle of the product, getting darker toward the edges. | A darkened area around the centre … "a big circle with a smaller circle inside" … | Partly: the darkening is right, then confused |
| 9 | `vec3 col = 0.5 + tanh(0.1 / max(l*10.0,-l) - sin(l + p.y*max(1.0,-l*10.0) + time + vec3(0,1,2))) / 2.0` (ringGlow, Custom Function) | `col` is the result of tanh(…), darkened to 50% lifted by 0.5. | A glowing circle around the shape; a dark circle, then a warm glow that gets brighter away from the centre. | Wrong in the details |
| 10 | `v = (v + sin(ceil(v.yx + n*0.1) * 9.0 + t) / float(f)).yx` (fcMainFrame, Custom Function) | `v` is `v` plus the ratio with x and y swapped. | A subtle wave added to each pixel's position from its height and a random factor … | Wrong in the details |

Score: 2 good, 4 partly right, 4 wrong in the details. Earlier prompt versions did worse (a bare prompt invented colours and inverted comparisons; the facts, the "earlier lines only" rule and the colour naming each fixed one kind of error).

## What the model is good and bad at

- **Good** where the rule-based explainer already knows the idiom: a glow, a mask, a comparison. Its job there is to say *what it looks like* ("bright orange at the centre, fading outwards"), which the deterministic text never does. Naming colour literals in the facts removed the "bright red" mistake.
- **Bad** at free-form maths with several unnamed parts (ridge sums, tanh/sin mixes, swizzled folds): it writes a confident paragraph that reads plausibly and is wrong. A 1.5B model cannot be trusted to derive what a formula looks like; it pattern-matches the node's label (the "moonlight" in #7 came from the node's name).
- **Whole-block** answers follow the format (a summary and `1: …` sentences, one per line) but line sentences are generic and sometimes wrong (a line `float r = home.x` was explained as a sine function).
- **Whole-node** answers are coherent and use the neighbours well, but run past three sentences and invent specifics (colour names, which input does what).

## Verdict

**Mixed, not yet good enough to present as the explanation.** Speed and footprint are fine. Quality is clearly better than the rule-based text at *what it looks like* where an idiom is known, and unreliable otherwise (4 of 10 wrong). So it is built as an optional, off-until-downloaded, clearly labelled addition (**Explained by a local model · can be wrong**) with its facts shown, always under the rule-based explanation and never replacing it. It should stay "experimental" until it is either given more to go on (for example, evaluated values at sample points from `evaluate.ts`, so it can see what the line produces) or run on a larger model whose licence allows redistribution.

Possible next steps, in order of likely payoff: feed the model sampled outputs of the line (the CPU evaluator already plots float functions) so it describes a curve it was shown; per-line few-shot examples chosen by idiom; a larger Apache-2.0 model when one exists in a size worth downloading.
