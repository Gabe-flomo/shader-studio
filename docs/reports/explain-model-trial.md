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

---

# Round 2: narrowed context, structured answers, measured confidence, several models (2026-10-08)

Question: if the prompt carries only the code, its inputs described by type and the line (no labels, no neighbours, no technique names), is the answer better, and can we tell which answers to distrust without relying on the model's own word?

## What changed

- **Context.** The prompt for a line or a block has only the code up to the line (numbered), the inputs (`uv: vec2, from UV: pixel position, centred …`, `t: float, built in: time in seconds`, `s: float, a slider on the node, range 0.05..0.6`), the facts the deterministic explainer derives from the code (reading, idioms, called functions, named colours) and the line with its number. Dropped: the node's label and title, the graph name, the neighbours' labels, technique names. (In round one the "moonlight" in line 7 came from the node it sits in, `gpMoon`; that word can no longer reach the model.)
- **Output.** One JSON object per line: `what`, `effect`, `sure`, `unsure_about`, read tolerantly while it streams.
- **Confidence.** One dot per answer from: the model's own word, token probabilities measured from its logits, a grounding check, and (on demand) a double-check. A "not sure" tag whenever the level is low, `sure` is low, or `unsure_about` is non-empty.
- **Models.** Qwen2.5-Coder 1.5B (the round-one model) and Qwen3 4B (thinks first). Two other candidates were dropped (see "Models").

Same ten lines, same graphs (the examples bundled in the app), greedy decoding, same machine (Apple silicon, WebGPU with `shader-f16`, the dev server's Chromium), final code. Verdicts are my own reading of what each line does, as in round one.

## Before and after (Qwen2.5-Coder 1.5B, same model)

| | good | partly right | wrong |
|---|---|---|---|
| Round 1 (labels, neighbours, techniques; free text) | 2 | 4 | 4 |
| Round 2 (code, typed inputs, facts only; JSON) | 0 | 6 | 4 |
| Round 2, Qwen3 4B | **5** | 5 | **0** |

Narrowing the context cost the small model its two good answers: both leaned on the node's name and neighbours (with the labels gone, the colour fact and the glow idiom are not enough for it to say "glow"). It no longer invents purposes from names (no moonlight), but it also no longer gets the free hint, and the four wrong ones are mostly the same lines as before. The 4B model, given the same narrowed context, is clearly better: five good, none wrong, and the skyline line (#7) becomes "a textured ripple pattern along the horizontal axis" rather than moonlight.

## Per line

Dot colours: green = high, amber = medium, red = low. "tag" = the "not sure" tag was shown.

| # | Line | Coder 1.5B | | 4B (thinks first) | |
|---|---|---|---|---|---|
| 1 | `return pow(0.01 / abs(sin(d * 8.0 + time) / 8.0), 1.2)` | restates the rule-based text; effect "a curve that starts at 0.01 and ends at 0.01" | partly · amber · tag | "sharply defined wave pattern that moves over time … bright jagged lines" | partly · amber |
| 2 | `float x = t2.x + sin(t2.y * 5.0 + sp) / 30.0` | "a sine wave that shifts horizontally … based on time"; "a swirling pattern" | partly · amber · tag | "adjusts the x-coordinate by a small wave that depends on y" / "subtle horizontal movement" | **good** · amber |
| 3 | `vec3 young = mix(vec3(0.55,0.72,1.0), vec3(1.0,0.45,0.7), step(0.95,h)) * (0.55 + 0.9*h)` | "blends two colours on whether h is above 0.95" right; invents "coolest at the top" | partly · amber · tag | blue to pink at h = 0.95, scaled by a value rising with h | **good** · amber · tag |
| 4 | `vec3 core = vec3(1.0,0.8,0.55) * (0.08 + 1.4 * exp(-r*r*40.0))` | "a glowing version of the colour red, green, and blue" | wrong · **red** · tag | "a warm orange (1.0, 0.8, 0.55) times a glow that peaks at the centre and fades outward" | **good** · green |
| 5 | `float travel = d - t * speed` | "distance from the centre minus time × speed"; "moves outward" | partly · amber · tag | "moves d by time and the speed slider"; "a sliding motion" | partly · amber · tag |
| 6 | `float solid = step(id.y, h)` | "a hard on/off mask that keeps only the lowest part of the noise"; "a vertical stripe" | partly · amber · tag | "1 when id.y is below h, 0 otherwise … a sharp on/off mask" | **good** · green |
| 7 | `float ridge = -0.42 + 0.22*sin(uv.x*2.1+0.6) + …` | "a ridge effect around the centre of the image" (it is a skyline) | wrong · **red** · tag | "three sine waves … a textured ripple pattern along the horizontal axis" | partly · green |
| 8 | `float edge = 1.0 - 0.18 * dot(uv*vec2(0.45,0.8), uv*vec2(0.45,0.8))` | "a darkened border, with the darkest part near the centre" (self-contradicting) | partly · amber · tag | "highest in the centre and darker toward the edges: a circular vignette" | **good** · green |
| 9 | `vec3 col = 0.5 + tanh(0.1 / max(l*10.0,-l) - sin(…)) / 2.0` | "a glowing shape that shrinks and brightens as it moves across the screen" | wrong · **red** · tag | "a glow (tanh) with animated waves (sin) around the shape's edge … pulsating" | partly · green |
| 10 | `v = (v + sin(ceil(v.yx + n*0.1) * 9.0 + t) / float(f)).yx` | "scaled by the integer part of the y and x coordinates … divided by the integer part of f" | wrong · amber · tag | "a sine wave on the ceiling of a noisy value … then keeps the x and y parts" (it swaps them) | partly · amber · tag |

## Calibration: do the dots and tags line up with the wrong answers?

**Coder 1.5B** (4 wrong answers: #4, #7, #9, #10):

- Red dot: 3 of the 4 wrong answers, and only wrong answers (3 red, 3 wrong: no false alarm). The red came from the measured signals alone: the model said "medium" or "high" about each. #4 was also caught by the grounding check (it called the colour red/green/blue; the facts say orange).
- Amber: the fourth wrong answer (#10) and all 6 partly-right ones. No coder answer got a green dot.
- The "not sure" tag was on **10 of 10**, including all 4 wrong ones, but that is no signal: this model writes something in `unsure_about` every time, however the examples are set. The dot is the informative part.

**Qwen3 4B** (no wrong answers; 5 partly right: #1, #5, #7, #9, #10):

- The model's own word was mostly "high" or "medium" with an empty `unsure_about`; the tag appeared on 3 answers (#3 good, #5 and #10 partly right).
- Dots: green on 5 (#4, #6, #8 good; #7, #9 partly right), amber on 5 (#2, #3 good; #1, #5, #10 partly right). Of the 5 partly-right answers, 3 were not green; 2 got a green dot with steady token probabilities (81 percent a word) and nothing ungrounded, but were only partly right (#7 and #9: fluent descriptions of formulas the model did not fully follow). The measured signals cannot see that kind of fluent partial answer.

So: for the weak model the measured confidence works (every red dot was a wrong answer, 3 of 4 wrong answers were red, none was green); for the strong model it is only weakly informative at this sample size (green: 3 good of 5; amber: 2 good of 5). The thresholds (a mean of about 55 percent a word for "steady", 37 percent for "guessing", one word under 3 percent) were set after looking at the coder's first run, so the coder numbers are partly fitted to these ten lines; the 4B numbers did not influence them, and they show the limit. Treat a red dot as "avoid this one", not a green one as "trust this one".

## Measured signals

- **Token log-probabilities are available, but not from Transformers.js's `generate`**: it computes them and returns nothing (`scores` is a TODO in the 4.3.1 source). A logits processor in the worker records, per step, `logit - logsumexp`, and the streamer's token callback pairs it with the chosen token. The cost is one pass over the 151,000-entry logits per token, not measurable next to the model. For a sampled run the logits are already temperature-scaled; for greedy runs they include the 1.1 repetition penalty, so the values are slightly pessimistic.
- JSON scaffolding is near-certain, so the mean is taken over the `what`/`effect` text only: typically 30-55 percent a word for the coder and 80-94 percent for the 4B (it has already worked the answer out while thinking).
- The double-check (two more answers at temperature 0.7, compared by overlap of content words: the lower of "main vs samples" and "sample vs sample") was verified to run and to feed the dot in the app; it was not part of the ten-line numbers (off by default; it costs two more generations).

## Models (the picker)

Each candidate was checked on Hugging Face for an ONNX build with a q4 or q4f16 variant, then loaded and made to generate in the browser on the dev server.

| Model | Size (WebGPU) | Result |
|---|---|---|
| Qwen2.5-Coder 1.5B Instruct (default) | 1.36 GB | loads (about 60 s the first time including the download, 1.3-1.7 s from cache), 14-20 tokens/s, an answer in 3.3-4.9 s (first token 1.4-2.3 s) |
| Qwen3 4B (thinks first) | 2.85 GB (q4f16 split over external-data files; no WebAssembly build) | loads (120 s including the download, 4.8-5.5 s from cache), 18-21 tokens/s, an answer in **19-46 s** (366-934 tokens, 1,200-3,700 characters of reasoning first; the first reasoning token after 2.5-3.8 s) |
| Qwen3 1.7B | 1.43 GB | **dropped: does not load.** Its q4f16 is a single 1.43 GB file; creating the WebGPU session fails with `std::bad_alloc` (ONNX Runtime's WebAssembly heap) and the WebAssembly fallback is one 2.1 GB file, over the browser's array-buffer limit (`Array buffer allocation failed`). The 1.34 GB coder just fits; the 4B loads because its weights are external-data files. An fp16 external-data export would load, but is 3.5 GB: not worth it for a 1.7B model |
| Phi-4-mini-reasoning 3.8B | n/a | **dropped: no ONNX web build exists** (the `onnx-community` repos have only Phi-4-mini-instruct); not tried |

Memory: the worker holds one model; loading another frees the previous session first (checked: the coder, then the 4B, then the coder again in one session, and Compare models running both one after another). The 4B is flagged as large in the picker and asks before it downloads.

## Verdict

- The narrowed context and structured answers do what was asked: no label can steer the model, every answer is a small checkable object, and a low-confidence answer is never shown without its tag.
- The 1.5B model is not good enough on its own with this context (0 good of 10), but its measured confidence is a usable "avoid" signal. The 4B thinking model is the first that is good enough to be useful (5 good, 5 partly right, none wrong), at 20-45 s a line and 2.8 GB. Since better maths was the aim, that is the model to try; the default stays the fast coder.
- The remaining gap is fluent partial answers (the 4B's #7 and #9), which only a stronger signal can catch: evaluated sample outputs of the line (suggested in round one), or the double-check on lines that matter.
