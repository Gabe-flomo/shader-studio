# Explanation model (optional, on this device)

**Status:** built. Optional and off until you download it. No cloud AI: the weights download once, then run locally; your code and graph never leave the device.

## In plain words

The rule-based explainer (docs/expression-explainer.md) says exactly what a line computes, but mostly restates it. **Explain more** asks a small language model *why* the line is there and what it does to the picture, in one to three plain sentences, streamed in under the rule-based explanation:

> `vec3 core = vec3(1.0, 0.8, 0.55) * (0.08 + 1.4 * exp(-r * r * 40.0))`
> **Combines the base colour with a glowing effect: bright orange at the centre, fading out …**
> ✨ *Explained by a local model · Qwen2.5-Coder 1.5B Instruct on WebGPU · can be wrong*
> ▸ Facts it was given (7)

Where it appears:

- under each line's Explain row in the **Expression Block** and **Custom Function** editors, and under the **GLSL page**'s Explain panel: **Explain more**;
- **Explain this block** (Expression Block) / **Explain this function** (Custom Function, a user function's function card): a two-sentence summary and one short sentence per line;
- the **function card** (click a function name): the statement the call is in, or the whole function for your own functions;
- the **✨ button on a node card's bottom toolbar**: **Explain this node**: its role in this graph, what feeds it, what it feeds, and what its current settings do (it opens the node's info card, which has the rule-based summary, then streams the model's paragraph under it).

**App settings → Explanation model** shows the state (not downloaded / loaded / off), size, backend (WebGPU or WebAssembly), load time and speed, and has the download, the on/off switch and Remove.

If the model isn't downloaded, the action offers the one-time download with its size and a progress bar. Nothing downloads without that press.

## The model

| | |
|---|---|
| Model | `onnx-community/Qwen2.5-Coder-1.5B-Instruct` (pinned revision in `src/explainModel/config.ts`) |
| Licence | Apache-2.0. The 3B coder is **not** used: its licence is research-only. |
| Weights | q4f16 on WebGPU (1.34 GB), q4 on WebAssembly (1.92 GB), plus about 11 MB of tokenizer and config |
| Runs in | its own Web Worker (`src/explainModel/worker.ts`) through Transformers.js; WebGPU first, WebAssembly if there is no WebGPU with `shader-f16` |
| Kept in | the browser's Cache Storage (also in the desktop webview). Never bundled with the app. |

The measured speed and the trial are in `docs/reports/explain-model-trial.md`.

## Privacy

Local only. The model files come from Hugging Face once, when you press download; after that nothing is fetched. Prompts are built and answered in the page and its worker. Answers are cached in memory for the session, never saved, never sent. The desktop app's Tauri config has `csp: null`, so the download and the worker need no config change.

## How the grounding works

A 1.5B model guesses when it is left alone, so it is never asked to work things out. `src/explainModel/prompt.ts` builds each prompt from:

1. the **line** (or block), and only the **lines before it** in the same block (what the names are; later lines invited guessing);
2. the **node** it belongs to and its **neighbours** from the graph: what feeds it, what it feeds, by name;
3. **facts our deterministic explainer already knows**:
   - the rule-based reading of the line and the idioms found in it (`glslPatterns`);
   - what each function it calls gives (the function registry behind the function cards);
   - **techniques** from the pattern catalogue (`src/patterns`, e.g. "Exponential falloff"), **only those found in this very line**;
   - what the global names mean (`u_time`, `u_resolution`, `uv`, …) and the types of the names it reads;
   - **colours** in `vec3(r, g, b)` literals, named in words ("a light warm orange");
4. instructions: say what the line does to the picture and why, at most 2 short sentences, do not repeat the code, trust the facts, and say "Not sure why, but" when the purpose isn't clear. Two worked examples sit in the chat as earlier turns, because a small model copies their length and tone.

A **block** prompt asks for an exact format: `Summary: …` and then `1: …`, `2: …` one per line, which a 1.5B model follows reliably. A **node** prompt (`nodePrompt.ts`) retrieves only what that question needs: the node's own help text, its stage (`src/structure`), techniques found on it, neighbours, the settings that differ from a fresh node's, and its code for code nodes.

The facts used are shown folded under every answer ("Facts it was given"), so you can see what it was told.

Answers are cached by (code hash + context hash) for the session; token budgets are small (90 for a line, 140 for a node, up to 480 for a block).

## Limits

It can be wrong. In the trial (docs/reports/explain-model-trial.md) 2 lines in 10 were explained well, 4 partly, 4 wrongly in the details: it is good where the rule-based explainer already knows the idiom (a glow, a mask) and unreliable on free-form maths. Treat it as experimental. That is why every answer is labelled, shows its facts, and sits *under* the rule-based explanation, never instead of it. Turning the model off, or never downloading it, changes nothing else in the app.

## Code

- `src/explainModel/config.ts`: model, sizes, token budgets
- `src/explainModel/worker.ts`, `client.ts`: the worker, the store (enabled / downloaded / status / progress), streaming, cache, remove
- `src/explainModel/prompt.ts`, `nodePrompt.ts`, `fnSource.ts`: prompt building (pure)
- `src/explainModel/cache.ts`, `useAnswer.ts`: answer cache, the button's state machine
- `src/components/explain/ExplainMore.tsx`, `ExplainScope.tsx`: the action and what a host tells it about its surroundings
- `src/components/files/ExplanationModelSettings.tsx`: the settings section
- Tests: `src/explainModel/__tests__` (fixture graphs, cache, not-downloaded path, a mocked model stream; no model is ever downloaded in tests)
