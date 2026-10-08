# Explanation model (optional, on this device)

**Status:** built. Optional and off until you download it. No cloud AI: the weights download once, then run locally; your code and graph never leave the device.

## In plain words

The rule-based explainer (docs/expression-explainer.md) says exactly what a line computes, but mostly restates it. **Explain more** asks a small language model what the line does and what that does to the picture, as one small JSON object (`what`, `effect`, how `sure`, what it is `unsure_about`), streamed in under the rule-based explanation and shown as plain sentences. Every answer carries a **confidence dot** (green, amber, red; the tooltip says why) and, whenever it should not be trusted, a **not sure** tag with the reason:

> `float edge = 1.0 - 0.18 * dot(uv * vec2(0.45, 0.8), uv * vec2(0.45, 0.8))`
> 🟢 **Calculates a value that is highest in the centre of the image and gets darker toward the edges. A circular vignette effect …**
> ✨ *Explained by a local model · Qwen3 4B on WebGPU · can be wrong*
> ▸ Show reasoning · ▸ Facts it was given (9)

Where it appears:

- under each line's Explain row in the **Expression Block** and **Custom Function** editors, and under the **GLSL page**'s Explain panel: **Explain more**;
- **Explain this block** (Expression Block) / **Explain this function** (Custom Function, a user function's function card): a two-sentence summary and one short sentence per line;
- the **function card** (click a function name): the statement the call is in, or the whole function for your own functions;
- the **✨ button on a node card's bottom toolbar**: **Explain this node**: its role in this graph, what feeds it, what it feeds, and what its current settings do (it opens the node's info card, which has the rule-based summary, then streams the model's paragraph under it).

**App settings → Explanation model** is a list of models. Each row has the name, size, licence, **thinks first** yes/no, a Download / Remove button, its status and a radio for **use this one**. Several can be downloaded at once; the one in use is remembered; only one is held in memory at a time (the previous one is freed before the next loads). A model that is big for a browser says so and asks before downloading. The on/off switch, the backend (WebGPU or WebAssembly), load time and speed are shown for the loaded model.

If no model is downloaded, the action offers the one-time download with its size and a progress bar. Nothing downloads without that press.

Under each answer, **Double-check** (slower, off by default) and, with two or more models downloaded, **Compare models**.

## The models

| | Qwen2.5-Coder 1.5B (default) | Qwen3 4B |
|---|---|---|
| Repo | `onnx-community/Qwen2.5-Coder-1.5B-Instruct` | `onnx-community/Qwen3-4B-ONNX` |
| Licence | Apache-2.0 | Apache-2.0 |
| Thinks first | no | yes (a `<think>` pass, then the answer) |
| Weights | q4f16 on WebGPU (1.34 GB), q4 on WebAssembly (1.92 GB) | q4f16 on WebGPU only (2.8 GB, in external-data files) |
| Budget | 130 tokens a line | 1154 a line (1024 of them for thinking) |

All are pinned to a revision in `src/explainModel/config.ts`, run in their own Web Worker through Transformers.js (WebGPU first, WebAssembly if there is no WebGPU with `shader-f16` and the model has a WebAssembly build), and are kept in the browser's Cache Storage (also in the desktop webview). Never bundled with the app.

Tried and **dropped** (each in the browser, see docs/reports/explain-model-trial.md):

- **Qwen3-1.7B**: its q4f16 is one 1.43 GB file; ONNX Runtime's WebAssembly heap runs out creating the session (`std::bad_alloc`) and the WebAssembly fallback (one 2.1 GB file) is over the array-buffer limit. (The 1.34 GB coder just fits; the 4B loads because its weights are split into external-data files.)
- **Phi-4-mini-reasoning** (3.8B, MIT): no ONNX build for the web exists (only Phi-4-mini-instruct has one).
- The 3B Qwen2.5-Coder: its licence is research-only.

**Thinking models.** The `<think>…</think>` reasoning is split off (`thinking.ts`): it is not part of the answer, it is behind a collapsed **Show reasoning**, and while it runs the card says "Thinking… 12 s". The JSON is read, and the confidence signals measured, on the text after `</think>` only. If the budget runs out while still thinking, the card says so.

**Compare models** runs the same prompt on every downloaded model one after another (the worker frees one before loading the next), and shows the answers side by side, each with its dot, tag and timing.

## Privacy

Local only. The model files come from Hugging Face once, when you press download; after that nothing is fetched. Prompts are built and answered in the page and its worker. Answers are cached in memory for the session, never saved, never sent. The desktop app's Tauri config has `csp: null`, so the download and the worker need no config change.

## How the grounding works

A 1.5B model guesses when it is left alone, so it is never asked to work things out. And it is never told anything a person typed: with the node's label in the prompt, a skyline formula was explained as "a subtle moonlight effect". So a code explanation (a line, "Explain this block") carries **only**:

1. the **code**: the lines up to and including the one asked about, numbered (later lines invited guessing);
2. its **inputs**, by type, never by label (`inputs.ts`): `uv: vec2, from UV: pixel position, centred: (0,0) is the middle of the picture, x and y run about -1..1`, `t: float, built in: time in seconds since start`, `h: float, from Fractal Noise (FBM): smooth noise value, range 0..1`, `s: float, a slider on the node, range 0..5`, `k: float, a constant, value 0.25`. The upstream node's **type** and what its output means come from the registry and a small table of the common sources; the range is only given when it is known for certain (a documented output, a slider's own min and max, a Constant's value). Nothing is sampled: there is no value probe for it yet, and no range is better than a wrong one;
3. **facts our deterministic explainer derives from the code itself**: the rule-based reading of the line and its idioms (`glslPatterns`), what each function it calls gives (the function registry), what the global names mean (`u_time`, `u_resolution`, … and not a guess for a name the node's inputs already describe), and **colours** in `vec3(r, g, b)` literals named in words ("a light warm orange");
4. the **line and its number**.

Not in it: the node's label or title, the graph's name, the neighbours' labels, technique names from the pattern catalogue (they can come from labels). "Explain this node" (the sparkle on the node card) keeps its broader context (help text, stage, neighbours, changed settings, code) but names nodes by their **type** and drops user labels too.

The system prompt asks for the JSON, three worked examples sit in the chat as earlier turns (a small model copies their shape), and the facts used are shown folded under every answer ("Facts it was given", the inputs included).

## Structured answers

`structured.ts` reads the model's JSON tolerantly: complete objects and the one still being written (field by field as it streams), code fences, an array wrapper, escaped quotes and braces inside strings. Text with no readable object falls back to plain prose, and plain prose is **always** shown with a "not sure" tag. A block asks for a `{"summary"}` object and then one object per line (JSON lines).

## Confidence

The model's own `sure` means little (it says "high" about wrong answers), so the level shown is the **lowest of several signals** (`confidence.ts`), and the tooltip lists why:

1. **What it said**: `sure: low` is low; `medium`, or a non-empty `unsure_about`, is at most medium and shows the tag.
2. **Token probabilities**, measured from the model's logits (a logits processor in the worker records, for each token it generated, the log-probability the model gave it; Transformers.js does not return scores itself). The mean over the answer's own words (the `what` and `effect` text, not the JSON scaffolding) and the weakest word. Below an average of about 55% per word is at most medium; below about 37% is low; one word under about 3% caps at medium.
3. **Grounding**: names (`backticked` or code-shaped) and numbers in the answer that the code, the inputs and the facts do not have; a function said as a word ("sine") that the code does not have (a contradiction if it is nowhere in the code, a mild issue if only on another line); a colour that contradicts the colour facts or that nothing in the code has; an answer about the wrong line. One unbacked name or number is at most medium; a contradiction or two problems is low.
4. **Double-check** (on demand, off by default, it is slower): two more answers sampled at temperature 0.7 are compared with the first by the overlap of their content words; if they disagree a lot the level is low.

A **low** level, `sure: low`, a non-empty `unsure_about` or an answer that was not JSON always shows the **not sure** tag with the reason. A thinking model's answer is assessed on the text after its reasoning. The thresholds are constants in `confidence.ts`, set from the ten-line trial (a small sample: treat them as a starting point). How well the dots lined up with the wrong answers is in docs/reports/explain-model-trial.md.

Answers are cached by (model + code hash + context hash) for the session.

## Limits

It can be wrong. In the first trial (docs/reports/explain-model-trial.md, with labels in the prompt) the 1.5B coder explained 2 lines in 10 well, 4 partly, 4 wrongly. With the narrowed context (no labels) it was 0 / 6 / 4, and Qwen3 4B, which thinks first, was 5 good, 5 partly right, 0 wrong, at 20-45 s a line. The measured confidence caught 3 of the coder's 4 wrong answers with a red dot and no right one, but it cannot see a fluent, plausible, partly wrong answer from the stronger model (2 of its 5 partial answers were green). Treat it as experimental. That is why every answer is labelled, carries a dot and a "not sure" tag when it should, shows its facts, and sits *under* the rule-based explanation, never instead of it. Turning the model off, or never downloading it, changes nothing else in the app.

## Code

- `src/explainModel/config.ts`: the models, sizes, token budgets (a thinking model's larger one)
- `src/explainModel/worker.ts`, `client.ts`: the worker (one model at a time, token log-probabilities, sampling), the store (enabled / active / downloaded models / status / progress), streaming, double-check samples, Compare, cache, remove
- `src/explainModel/prompt.ts`, `inputs.ts`, `nodePrompt.ts`, `fnSource.ts`: prompt building and input descriptions (pure; no user labels)
- `src/explainModel/structured.ts`, `thinking.ts`, `confidence.ts`, `assess.ts`: the tolerant JSON reader, the `<think>` split, the confidence signals and how they combine, and the view the UI shows (all pure)
- `src/explainModel/cache.ts`, `useAnswer.ts`: answer cache, the button's state machine (with Double-check and Compare)
- `src/components/explain/ExplainMore.tsx`, `ExplainAnswer.tsx`, `ExplainScope.tsx`: the action, the answer with its dot and tag, Compare, and what a host tells it about its surroundings
- `src/components/files/ExplanationModelSettings.tsx`: the models list
- Tests: `src/explainModel/__tests__` (fixture graphs, prompts without labels, input descriptions, JSON parsing, grounding, confidence, several models and Compare with a fake transport; no model is ever downloaded in tests)
