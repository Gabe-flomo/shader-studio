# Explanation model (on this device)

**Status:** built. Explain is the model, always; the model is a one-time, opt-in download. No cloud AI: the weights download once, then run locally; your code and graph never leave the device.

## In plain words

**Explain** asks a small language model, running on this device, what a line does and what that does to the picture. There is no rule-based wording any more: the rule-based readings mostly restated the line, and when the model was fed them it just repackaged them. Instead the model is given **facts**: the code, where each input really comes from, what each earlier line is built from, the numbers each line takes across the picture, and what the block feeds (see "Fact-only context").

Each answer is one small JSON object per line (`what`, `effect`, how `sure`, what it is `unsure_about`), shown as plain sentences. Every answer carries a **confidence dot** (green, amber, red; the tooltip says why) and, whenever it should not be trusted, a **not sure** tag with the reason (the layout, not a recorded answer):

> `float sky = 0.5 + 0.5 * n.y`
> 🟢 **1 where the surface faces straight up, 0 where it faces straight down, 0.5 on the sides. A sky-light mask: upward-facing parts get more sky.**
> ✨ *Explained by a local model · Qwen3 4B on WebGPU · can be wrong*
> ▸ Facts it was given (6)

Where it appears:

- a line of an **Expression Block**: **Explain with the model** in the line's explain view (Open explain view under the line; docs/expression-explainer.md, "The explain view"); the editor itself has no per-line model button;
- every statement of a **Custom Function**: one **Explain** button beside the statement, and its folded build-up;
- **Explain the block** (Expression Block) / **Explain this function** (Custom Function, a user function's function card): each line in plain words, then **Altogether**: a two-sentence summary of what the whole block is for, last;
- the **GLSL page**'s Explain panel and the **function card** (click a function name): the statement the call is in, or the whole function for your own functions;
- the **✨ button on a node card's bottom toolbar**: **Explain this node**: its role in this graph, what feeds it, what it feeds, and what its current settings do.

With no model downloaded (or the model turned off), pressing **Explain** offers the download instead: what it is ("a language model that runs on this device"), what it reads, its size, its licence, that nothing downloads until you press, and that bigger models are in Settings. Turned off, it offers to turn it back on. Nothing is explained by rules in its place.

**App settings → Explanation model** is a list of models. Each row has the name, size, licence, **thinks first** yes/no, a Download / Remove button, its status and a radio for **use this one**. Several can be downloaded at once; the one in use is remembered; only one is held in memory at a time (the previous one is freed before the next loads). A model that is big for a browser says how much memory it needs and asks before downloading. The on/off switch, the backend (WebGPU or WebAssembly), load time and speed are shown for the loaded model.

Under each answer, **Double-check** (slower, off by default) and, with two or more models downloaded, **Compare models**.

## The models

| | Qwen2.5-Coder 1.5B (default) | Qwen3 4B | Olmo 3 7B Instruct |
|---|---|---|---|
| Repo | `onnx-community/Qwen2.5-Coder-1.5B-Instruct` | `onnx-community/Qwen3-4B-ONNX` | `onnx-community/Olmo-3-7B-Instruct-ONNX` |
| Licence | Apache-2.0 | Apache-2.0 | Apache-2.0 |
| Thinks first | no | yes (a `<think>` pass, then the answer) | no |
| Weights | q4f16 on WebGPU (1.34 GB), q4 on WebAssembly (1.92 GB) | q4f16 on WebGPU only (2.8 GB, in external-data files) | q4f16 on WebGPU only (3.8 GB: a 0.4 MB graph and two external-data files of 2.08 GB and 1.73 GB) |
| Memory warning | | yes (large) | yes: about 5 GB of graphics memory (weights plus the conversation's cache); 16 GB machines and up |
| Budget | 130 tokens a line | 1154 a line (1024 of them for thinking) | 130 a line |

All are pinned to a revision in `src/explainModel/config.ts`, run in their own Web Worker through Transformers.js (WebGPU first, WebAssembly if there is no WebGPU with `shader-f16` and the model has a WebAssembly build), and are kept in the browser's Cache Storage (also in the desktop webview). Never bundled with the app.

### A bigger model (researched 2026-10-09)

The aim was a 7-8B **coder** model. File lists and sizes come from the Hugging Face API (`/api/models/<id>/tree/<revision>/onnx`); no weights were downloaded.

- **Qwen2.5-Coder-7B-Instruct**: no ONNX export exists (not under onnx-community or elsewhere with a Transformers.js layout).
- **Qwen3-8B** (`onnx-community/Qwen3-8B-ONNX`): an **onnxruntime-genai** build, not Transformers.js: `onnxruntime/webgpu/webgpu-int4-kld-block-32/model.onnx.data` is one 6.4 GB file (over the browser's 2 GiB single-buffer limit and the 4 GB WebAssembly heap), with a `genai_config.json` instead of the Transformers.js layout. The same holds for Qwen3.5-9B, Granite 4.1 8B and Mistral 7B there.
- **Olmo 3 7B Instruct** (`onnx-community/Olmo-3-7B-Instruct-ONNX`, Allen AI, Apache-2.0): a Transformers.js build. Its `config.json` declares `use_external_data_format: { model_q4f16.onnx: 2 }`, so q4f16 loads as a graph plus two data files, each under 2.1 GB (the same split that lets Qwen3 4B load); the `olmo3` architecture is in Transformers.js from 4.0 (this app uses ^4.3.1). It is a general instruct model, not a coder. Its plain q4 build (3.94 GB) would not fit the WebAssembly heap, so it is **WebGPU only**. Its KV cache is large (32 key/value heads, no grouping: about 0.5 MB a token), hence the ~5 GB note. **Added** as the optional biggest model; not yet tried in a browser.
- Also there, not added: **Apertus 8B** (4.7 GB q4f16 in three files, multilingual general model), **Bonsai 8B** (a Qwen3-8B-shaped model trained to 1-bit weights; 4.75 GB q4f16) and **LFM2 8B-A1B** (a mixture of experts, licence "other").

Tried earlier and **dropped** (each in the browser, see docs/reports/explain-model-trial.md):

- **Qwen3-1.7B**: its q4f16 is one 1.43 GB file; ONNX Runtime's WebAssembly heap runs out creating the session (`std::bad_alloc`) and the WebAssembly fallback (one 2.1 GB file) is over the array-buffer limit. (The 1.34 GB coder just fits; the 4B loads because its weights are split into external-data files.)
- **Phi-4-mini-reasoning** (3.8B, MIT): no ONNX build for the web exists (only Phi-4-mini-instruct has one).
- The 3B Qwen2.5-Coder: its licence is research-only.

**Thinking models.** The `<think>…</think>` reasoning is split off (`thinking.ts`): it is not part of the answer, it is behind a collapsed **Show reasoning**, and while it runs the card says "Thinking… 12 s". The JSON is read, and the confidence signals measured, on the text after `</think>` only. If the budget runs out while still thinking, the card says so.

**Compare models** runs the same prompt on every downloaded model one after another (the worker frees one before loading the next), and shows the answers side by side, each with its dot, tag and timing.

## Privacy

Local only. The model files come from Hugging Face once, when you press download; after that nothing is fetched. Prompts are built and answered in the page and its worker. Answers are cached in memory for the session, never saved, never sent. The desktop app's Tauri config has `csp: null`, so the download and the worker need no config change.

## Fact-only context

A small model guesses when it is left alone, so it is never asked to work things out. It is never told anything a person typed: with the node's label in the prompt, a skyline formula was explained as "a subtle moonlight effect". And it is no longer told the rule-based explainer's readings, idioms or step readings: the answers just repackaged them. A code explanation (a line, a block) carries **only facts** (`prompt.ts`, `inputs.ts`):

1. the **code**: the lines up to and including the one asked about, numbered (later lines invited guessing); for a block, all its lines;
2. its **inputs, each traced to its real source by type**, never by label:
   - `n: vec3, from the Normal output of a March Loop node (vec3, unit length): the direction the surface faces …` (the upstream node's registry name, the output's registry label and type, and what that output means: a small table of the common sources, else the output's registry hint, else the node's description);
   - `warm: vec3, from a Color node: the fixed value (0.8, 0.45, 0.25), the colour a mid warm orange` (Constant, Constants and Color nodes give their value);
   - `s: float, a slider on the node, range 0..5, now 2.5`; `t: float, built in: time in seconds since start`; `x: float, from the group's input`; `not connected; 0 when nothing is wired`;
3. what each name the line reads is **built from, through earlier lines of the block**: `sky: made on line 1 (float sky = 0.5 + 0.5 * n.y), from the input n (the Normal output of a March Loop node)`;
4. **measured numbers** (`workedBlock` in `src/lib/glslPatterns/worked.ts`): every line run on the CPU, each line's result carried into the next, once at a **sample pixel** and 400 times with the inputs drawn over their ranges: `line 2, halo: 0.823 at the sample pixel; across the picture 0.068..0.981` (per component for a vector). How each input was drawn is listed (`uv = (0.3, 0.2) at the sample pixel, drawn over -1..1 per component`). Positions, time, noise and audio use their documented ranges, a normal is drawn as random unit-length directions, a constant or a slider is fixed at its value, and an input nothing describes is **assumed** 0..1 and every number built from it says it is a guess. A line that reads time says "across the picture and over time". "The same everywhere" is only said when nothing varying feeds the line; otherwise "the same at every one of 400 sampled points (a small area could still differ)". Code with loops or branches, texture reads and user functions are not measured;
5. what the block's result **feeds**, by node type and input: `The block's result feeds: the Color input of an Output node`;
6. what each **built-in function** it calls gives (the function registry; constructors such as `vec3(…)` are left out), what the shader-wide names mean (`u_time`, `u_resolution`, … but not for a name an input or a line already gives), and **colours** in `vec3(r, g, b)` literals named in words ("a light warm orange").

Not in it: the node's label or title, the graph's name, the neighbours' labels, the user's labels on a Constants entry, technique names from the pattern catalogue (they can come from labels), and anything from the rule-based explainer's wording. "Explain this node" (the sparkle on the node card) keeps its broader context (help text, stage, neighbours, changed settings, code) but names nodes by their **type** and drops user labels too.

The system prompt asks for the JSON and tells the model not to read the code out symbol by symbol; three worked examples sit in the chat as earlier turns (a small model copies their shape), one of them tracing a normal through a line; the facts used are shown folded under every answer ("Facts it was given", the inputs included).

### Comparing the context

`src/explainModel/__tests__/promptReport.test.ts` builds the prompt for 20 real Expression Block lines from the bundled examples (one per example, spread across them) and checks that none carries a user label or a rule-based reading. With `WRITE_REPORT=1` it writes `docs/reports/explain-prompt-context.md`, each line's prompt; with `EXPLAIN_BEFORE_JSON=<file>` (prompts saved by an earlier build with `EXPLAIN_CAPTURE_JSON=<file>`) it shows the earlier prompt beside each one. The checked-in report compares main before this change with after. No model runs to make it.

## Structured answers

`structured.ts` reads the model's JSON tolerantly: complete objects and the one still being written (field by field as it streams), code fences, an array wrapper, escaped quotes and braces inside strings. Text with no readable object falls back to plain prose, and plain prose is **always** shown with a "not sure" tag. A block asks for one object per line first and the `{"summary"}` object **last** (JSON lines), so the summary is written after the lines and reads as the whole block's purpose; it is shown under the lines, headed **Altogether**.

## Confidence

The model's own `sure` means little (it says "high" about wrong answers), so the level shown is the **lowest of several signals** (`confidence.ts`), and the tooltip lists why:

1. **What it said**: `sure: low` is low; `medium`, or a non-empty `unsure_about`, is at most medium and shows the tag.
2. **Token probabilities**, measured from the model's logits (a logits processor in the worker records, for each token it generated, the log-probability the model gave it; Transformers.js does not return scores itself). The mean over the answer's own words (the `what` and `effect` text, not the JSON scaffolding) and the weakest word. Below an average of about 55% per word is at most medium; below about 37% is low; one word under about 3% caps at medium.
3. **Grounding**: names (`backticked` or code-shaped) and numbers in the answer that the code, the inputs and the facts do not have; a function said as a word ("sine") that the code does not have (a contradiction if it is nowhere in the code, a mild issue if only on another line); a colour that contradicts the colour facts or that nothing in the code has; an answer about the wrong line. A number is backed when the code, an input's description, or the facts (the measured numbers included) have it, or when it lies inside the range that line was measured to take ("about 0.5" for a line that runs 0..1). One unbacked name or number is at most medium; a contradiction or two problems is low.
4. **Double-check** (on demand, off by default, it is slower): two more answers sampled at temperature 0.7 are compared with the first by the overlap of their content words; if they disagree a lot the level is low.

A **low** level, `sure: low`, a non-empty `unsure_about` or an answer that was not JSON always shows the **not sure** tag with the reason. A thinking model's answer is assessed on the text after its reasoning. The thresholds are constants in `confidence.ts`, set from the ten-line trial (a small sample: treat them as a starting point). How well the dots lined up with the wrong answers is in docs/reports/explain-model-trial.md.

Answers are cached by (model + code hash + context hash) for the session.

## Limits

It can be wrong. In the first trial (docs/reports/explain-model-trial.md, with labels in the prompt) the 1.5B coder explained 2 lines in 10 well, 4 partly, 4 wrongly. With the narrowed context (no labels) it was 0 / 6 / 4, and Qwen3 4B, which thinks first, was 5 good, 5 partly right, 0 wrong, at 20-45 s a line. Those trials used the old context (with rule-based readings); the fact-only context has not been trialled with the models yet. The measured confidence caught 3 of the coder's 4 wrong answers with a red dot and no right one, but it cannot see a fluent, plausible, partly wrong answer from the stronger model. Treat it as experimental: every answer is labelled, carries a dot and a "not sure" tag when it should, and shows its facts. The measured numbers are only as good as the input ranges: an input nothing describes is a guess, and the prompt says so.

## Code

- `src/explainModel/config.ts`: the models, sizes, memory notes, token budgets (a thinking model's larger one)
- `src/explainModel/worker.ts`, `client.ts`: the worker (one model at a time, token log-probabilities, sampling), the store (enabled / active / downloaded models / status / progress), streaming, double-check samples, Compare, cache, remove
- `src/explainModel/prompt.ts`, `inputs.ts`, `nodePrompt.ts`, `fnSource.ts`: prompt building (the trace through earlier lines, the measured numbers, what the block feeds) and input tracing (pure; no user labels, no rule-based readings)
- `src/lib/glslPatterns/worked.ts`: `workedBlock`, a whole block measured on the CPU
- `src/explainModel/structured.ts`, `thinking.ts`, `confidence.ts`, `assess.ts`: the tolerant JSON reader, the `<think>` split, the confidence signals and how they combine, and the view the UI shows (all pure)
- `src/explainModel/cache.ts`, `useAnswer.ts`: answer cache, the button's state machine (with Double-check and Compare)
- `src/components/explain/ExplainMore.tsx`, `ExplainAnswer.tsx`, `ExplainRow.tsx`, `ExplainScope.tsx`: the Explain action and its download offer, the answer with its dot and tag (the summary last), Compare, the line row, and what a host tells it about its surroundings
- `src/components/files/ExplanationModelSettings.tsx`: the models list
- Tests: `src/explainModel/__tests__` (fixture graphs, prompts without labels or rule-based readings, traced inputs, measured numbers, what the block feeds, JSON parsing, grounding, confidence, several models and Compare with a fake transport, the prompts on 20 example lines), `src/components/explain/__tests__/explainAction.test.tsx` (the action without a model, the summary last); no model is ever downloaded in tests
