# Code Explorer — plan

*Status: **phase 1 (v1, written code) shipped** on `claude/code-explorer-p1`; see “Phase 1 shipped” at the end. Phases 2–3 are still plans. User doc: [code-explorer.md](code-explorer.md).*

## In one paragraph

The Code Explorer searches deeply through all the GLSL the app knows about: the examples, your saved graphs, imported shaders, linked folders and Present code blocks. Ask it about a function, say `smoothstep`, and it does not just list matching lines. It groups every use into **patterns**, the same code shape with the details blanked out, and ranks them by how often they appear. It shows what usually surrounds a pattern (what feeds it, what it feeds into, what it is used alongside) and the real instances behind each one, each labelled with where it came from: *this example, this node, line 4*. One click opens the graph, selects the node and scrolls to the line. A curated phrase library says in plain words what a pattern does ("soft circle edge", "flip so inside = 1"), with no AI involved. Any pattern can then be turned into a node or an Expression preset you can reuse everywhere. Everything runs on your machine.

Everything below is plain language first, then the technical detail. The numbers in the mock results (§9) come from a real scan of the bundled examples, not guesses.

---

## 1. What it is for

| Who | Question | What the Explorer gives |
|---|---|---|
| Someone learning | "How do people actually use `smoothstep`?" | The 5–10 shapes that cover most uses, each with a name and real examples to open |
| Someone taking a shader apart | "What is this `fract(sin(dot(…)) * 43758.5)` line?" | Its pattern ("hash: a random number per cell"), how often it appears and where else |
| Someone building | "I keep writing this luminance `dot`; is it a node yet?" | All its uses, and "Make a node from this" (§8) |
| An expert | "Every `mix(a, b, smoothstep(_, _, x))` where the edges are literals" | Structural search with holes, plus regex |

The Explorer is **not** a code generator and does not call a model. Every result is a count, a grouping or a curated sentence.

---

## 2. Research summary (what we borrow, and why)

| Idea | Source | What we take |
|---|---|---|
| **Structural search with holes** | Comby's `:[hole]` templates match balanced code instead of characters ([comby.dev basics](https://comby.dev/docs/basic-usage), [Sourcegraph on structural search](https://sourcegraph.com/blog/going-beyond-regular-expressions-with-structural-code-search)). Semgrep adds metavariables `$X` and `...` ellipses that match sequences of arguments or statements, and a repeated `$X` must bind the same code each time ([Semgrep pattern syntax](https://semgrep.dev/docs/writing-rules/pattern-syntax)). | The expert query syntax (§5.5): `smoothstep($E0, $E0 + $W, length(...))`. Binding the same name twice means "the same code". |
| **Query captures and predicates** | Tree-sitter queries are S-expressions with `@captures` and `#eq?` / `#match?` predicates ([Tree-sitter predicates](https://tree-sitter.github.io/tree-sitter/using-parsers/queries/3-predicates-and-directives.html)). | Our matcher has the same shape: a pattern tree, captures and simple predicates (literal, swizzle, type). We don't need tree-sitter itself; see the parser decision below. |
| **Patterns with holes from many examples** | Anti-unification gives the *most specific generalisation* of two terms: it keeps what they share and puts holes where they differ (Plotkin/Reynolds). Bulychev and Minea apply it to clone detection over ASTs ([Clone Digger paper](https://clonedigger.sourceforge.net/duplicate_code_detection_bulychev_minea.pdf)). Overwatch learns edit patterns the same way ([arXiv 2207.12456](https://arxiv.org/pdf/2207.12456)). A survey: [Anti-unification and Generalization](https://www.researchgate.net/publication/373087140_Anti-unification_and_Generalization_A_Survey). | Level 3 of the normalisation ladder (§4.3): merge near-identical shapes into one pattern with typed holes, e.g. `smoothstep(#, #, length(_ - vec2(#, #)))` and `smoothstep(#, #, length(_ - _))` become `smoothstep(#, #, length(_ - ?))`. |
| **Scalable clone detection** | DECKARD turns each subtree into a *characteristic vector* (counts of node kinds) and clusters the vectors with locality-sensitive hashing, which scales to millions of lines ([ICSE'07 paper](https://www.cs.ucdavis.edu/~su/publications/icse07.pdf)). | v2 "similar code" (near misses that differ in structure, not just names): characteristic vectors of statement windows, bucketed by MinHash or LSH. |
| **Fast text and regex search** | Google Code Search ran regexes over a trigram index: it pulled the trigrams any match must contain, intersected the posting lists, then ran the real regex only on the candidates ([Russ Cox](https://swtch.com/~rsc/regexp/regexp4.html)). GitHub's Blackbird uses variable-length grams ([GitHub blog](https://github.blog/engineering/architecture-optimization/the-technology-behind-githubs-new-code-search/)). | Regex mode (§5.5). With our corpus size (≈1.2 MB, §6) a plain scan is fast enough for v1. The trigram filter is a v2 option if user corpora grow. |
| **Ranking free text over code** | BM25 works on code only with code-aware tokens: split camelCase/snake_case and keep the whole identifier too ([arXiv 2605.18561](https://arxiv.org/pdf/2605.18561); [Lucene similarities](https://lucene.apache.org/core/9_5_0/core/org/apache/lucene/search/similarities/package-summary.html)). | Free-text search (§5.4): BM25 over pattern names, phrase-library text, identifiers split into words, node labels and comments, with a synonym table. |
| **Topics from code** | LDA over identifiers and comments is an established software-engineering method, though it is sensitive to setup ([Panichella et al., ICSE'13](https://www.cs.wm.edu/~denys/pubs/ICSE'13-LDA-CRC.pdf); [Chen et al. survey](https://petertsehsun.github.io/papers/peter_emse_survey2015.pdf); [topic modelling at GitHub scale from names](https://arxiv.org/html/1704.00135v1)). BERTopic clusters documents first, then labels each cluster with *class-based TF-IDF* (c-TF-IDF): all documents in a cluster are treated as one, and terms are weighted by how distinctive they are to that cluster ([BERTopic paper](https://arxiv.org/pdf/2203.05794)). | Topics (§7): TF-IDF vectors over function calls, split identifiers and pattern ids, then k-means or agglomerative clustering, then c-TF-IDF labels. This is BERTopic's labelling step without its neural embeddings. It is deterministic and needs no model. |
| **On-device embeddings (later)** | Transformers.js runs ONNX models in the browser. `all-MiniLM-L6-v2` is about 23 MB, gives 384-dimensional vectors and handles 128–256 tokens ([Observable demo](https://observablehq.com/@huggingface/sentence-embeddings-and-dimension-reduction-in-the-browse); [philna.sh](https://philna.sh/blog/2024/09/25/how-to-create-vector-embeddings-in-node-js/)). | v3 option only: embed pattern names and phrase text (not code) for "describe what you want" search. It would be off by default and downloaded on request. |
| **GLSL grammars** | `@shaderfrog/glsl-parser` is a PEG (Peggy) parser for GLSL ES 1.0/3.0 with a preprocessor, Babel-style visitors, and whitespace and comment preservation ([npm](https://www.npmjs.com/package/@shaderfrog/glsl-parser), [GitHub](https://github.com/ShaderFrog/glsl-parser)). `tree-sitter-glsl` extends tree-sitter-c and is error-tolerant and incremental, but needs a WASM runtime ([tree-sitter-grammars/tree-sitter-glsl](https://github.com/tree-sitter-grammars/tree-sitter-glsl)). | **Decision:** two tiers (§4.1). A fast, tolerant tokenizer plus an expression (Pratt) parser does the bulk indexing, and shaderfrog is used where we need real scopes and types. We add no tree-sitter dependency in v1. |

---

## 3. Corpus: what gets indexed

### 3.1 Sources

| Source | Where it lives today | Kind tag | Authored or generated |
|---|---|---|---|
| Bundled examples: Expression Blocks | `EXAMPLE_GRAPHS` (`src/store/exampleGraphs.ts` plus the `build*Examples()` modules), nodes `type: 'exprNode'` (`params.lines`, `params.result`) | `expr` | authored |
| Bundled examples: Custom Functions | nodes `type: 'customFn'` (`params.body`, `params.glslFunctions`) | `customFn` | authored |
| Input expressions | node params `__inExpr_<input>` (`src/glsl/inputExpr.ts`) | `inputExpr` | authored |
| Generated shader per graph | `compileGraph({ nodes }).fragmentShader` plus `nodeSlugMap` (`src/compiler/graphCompiler.ts`) | `generated` | generated |
| Node library helpers | each definition's `glslFunction(s)`; these show up as helper functions in generated shaders | `nodeLib` | generated (written by us) |
| Saved graphs | the Files inventory (`src/files/inventory.ts`), the same graph JSON `mostUsed.ts` walks | same tags as the examples, with `origin: 'saved'` | both |
| Saved shaders (GLSL page) | `shader` items (`itemCode.ts`: `v.code`) | `shader` | authored |
| Function and Expression presets | `CustomFnPreset` (`body` + `glslFunctions`), `ExprPreset` (`lines` + `result`) | `preset` | authored |
| Imported and converted GLSL | Convert page sources (`src/glslToGraph/examples.ts` `CONVERT_EXAMPLES`), plus the original source kept on import | `import` | authored |
| `.glsl` / `.frag` files in linked folders and the workspace | `src/files/linkedFolders.ts`, workspace store | `file` | authored |
| Present code blocks | presentations' code blocks (`src/present/code.ts`, `codePick.ts`, `shaderRegions.ts`) | `present` | authored, or a quote of generated code |
| Converter test corpus (dev builds only) | `src/glslToGraph/__tests__/corpus/*.frag` | `corpus` | authored |

### 3.2 Provenance: every hit knows where it came from

```ts
interface Provenance {
  sourceKind: 'expr' | 'customFn' | 'inputExpr' | 'generated' | 'nodeLib' | 'shader' | 'preset' | 'import' | 'file' | 'present' | 'corpus';
  origin: 'example' | 'saved' | 'linked' | 'workspace' | 'presentation';
  docId: string;          // example key, saved-graph key, file path, presentation id
  docLabel: string;       // "Neon sign", "Soft circle"
  nodeId?: string;        // graph node id (inside a group: the path, e.g. "grp_1/fill_0")
  nodeLabel?: string;     // the node's label or comment title, else its definition label
  nodeType?: string;      // 'exprNode', 'sdfFill', ...
  field?: string;         // 'lines[2].rhs', 'body', 'glslFunctions', '__inExpr_scale'
  line: number; column: number;   // 1-based, inside that field's text (or the file)
  generatedLine?: number; // for generated hits: the line in the compiled shader
}
```

### 3.3 Authored, generated, or both? Both, kept apart

The scan in §9 shows why both are needed and why they must not be mixed:

- **Authored code** (what a person wrote) is where learning happens. In the bundled examples it is small: **244 sources, 1,057 lines, 944 call sites**.
- **Generated code** (what the compiler emits) shows how the *nodes* do things, which is also worth learning. It is about 10× larger (**18,210 lines, 9,679 call sites** across 370 examples, after removing the always-present helpers and de-duplicating helper functions). It is also very repetitive: the same `sdfFill` template appears in every graph that uses that node. For example, `smoothstep` has **287 generated calls but only 70 distinct (node type, shape) templates**.

So the UI has a **Written / Generated / Both** switch, defaulting to *Written*. Generated hits are de-duplicated per (node type, shape): "used by the *SDF Fill* node, in 41 graphs" is one row, not 41.

Authored code inside an Expression Block also appears in the generated shader. To avoid counting it twice, generated lines whose slug maps to an `exprNode` or `customFn` node are dropped from *Generated*, because the authored copy already counts.

### 3.4 Mapping generated code back to nodes

The compiler already provides what we need:

- `compileGraph(...).nodeSlugMap: Map<nodeId, slug>`, and the convention that every variable a node writes is named `<slug>_…` (`src/components/code/nodeSlice.ts`, `nodeSliceLines`). A line in `main()` belongs to the node whose slug prefix it contains. The code panel and Present's "main() by node" already use this rule.
- Helper functions come from node definitions (`glslFunction` / `glslFunctions`). Index each helper once, keyed by its text hash. Attribute it to the node type(s) whose definition contributes it, using a one-time map built by compiling each definition alone (`src/present/nodeCode.ts` already does this for Present).
- Always-available helpers (`BUILTIN_HELPERS_GLSL`, the block after `// ── Always-available helpers`) are indexed once as `nodeLib`, not per graph.
- Groups: `flattenSubgraph` prefixes slugs. Store the node *path* so jump-to-source can open the group.

Known gap: a line that names two slugs (e.g. `mix(a_0_x, b_1_y, …)`) belongs to the node that *writes* the left-hand side. The rule is "first slug in the assignment target", not "first slug on the line". The throwaway scan used "first match", which is good enough for counting but not for jumping.

---

## 4. Indexing

### 4.1 Parsing: two tiers

**Measured on this repo** (vite-node, M-series Mac):

| Step | Input | Time |
|---|---|---|
| Compile all 370 bundled examples (`compileGraph`) | the graphs | **≈190–240 ms total** |
| `@shaderfrog/glsl-parser` full parse of every generated shader | 370 shaders, 2.12 MB (including always-helpers) | **22.8 s total, ≈62 ms per shader** |
| shaderfrog parse of each top-level Expression Block, wrapped in a function | 128 blocks | 350 ms (≈2.7 ms each), 0 failures |
| Tokenize and shape **every** call site (custom tokenizer) | generated corpus 1.2 MB, 9,679 calls | **36 ms** |
| The same for authored code | 46 KB, 944 calls | 3 ms |

So a full PEG parse of everything is too slow to do eagerly (≈23 s), while a tokenizer pass is effectively free. The plan:

- **Tier A, always:** a tolerant tokenizer (comments blanked to keep offsets; the same approach as `blankComments` in `src/glsl/discover.ts`). Then a small **Pratt expression parser** that builds an expression tree for each statement, plus statement and brace structure. This gives call sites, argument trees, enclosing chains, statement kinds and simple dataflow (who assigns a variable, who reads it next). It tolerates fragments (an Expression Block's `rhs`, an input expression) and broken code.
- **Tier B, when needed:** `@shaderfrog/glsl-parser` (already a dependency, used by `src/glslToGraph`) for authored functions when we want real scopes and declared types. These are small and cheap, so they get typed holes (`_:vec2` instead of `_`). Never run it on whole generated shaders; parse the de-duplicated helper functions (228 unique across the examples) once each.

Reuse: `discoverInSource` (`src/glsl/discover.ts`) already finds function definitions, call sites with argument splits, `#define`s and consts. It becomes the definition layer of Tier A. `dialects.ts` `translateToStudio` normalises Shadertoy names (`iTime` → `u_time`) so imported shaders shape like native ones. `stripComments`, `resolveConditionals` and `normaliseHostShader` from the converter cover the preprocessor.

### 4.2 What gets extracted

For each source:

1. **Call sites**: every `name(…)`, with the callee, argument subtrees, position, enclosing function, and enclosing call chain (`mix › smoothstep › length`).
2. **Expressions**: every subtree with at least 2 operators or 1 call, up to depth 6. This is what finds patterns that are not "about" one function, like the luminance dot.
3. **Statement windows**: sliding windows of 2–4 consecutive statements in one block, shaped (§4.3). These are the "long structures".
4. **Dataflow edges**: for `T x = f(…)`, record `x` → the next statement(s) that read `x` and the innermost call that reads it. This produces chains like `length → smoothstep → mix` (producer → target → consumer).
5. **Words**: identifiers split on camelCase and snake_case (`fbmNoise` → `fbm`, `noise`), comments, node labels and the node's `__comment`, kept for free-text search and topics.

### 4.3 Normalisation ladder (shapes)

Each extracted tree is shaped at three levels. All three are hashed (FNV-1a or xxhash32 over the shape string) and stored.

| Level | Rule | `smoothstep(0.22, 0.28, length(cuv))` becomes |
|---|---|---|
| **L1 exact shape** | literals → `#`; local names renamed `_a, _b, …` in order of first use (repeats keep their letter, so a shared variable is visible); keep calls, swizzles, types, `u_time`/`u_resolution`/`gl_FragCoord` | `smoothstep(#, #, length(_a))` |
| **L2 argument shape** | as L1, but every name → `_` and the inside of nested calls → `…` | `smoothstep(#, #, length(…))` |
| **L3 generalised pattern** | anti-unification of L1 shapes that share an L2 shape and differ in at most k=2 places: differences become `?` holes, typed when Tier B knows the types | `smoothstep(#, #, length(_ - ?:vec2))` |

L2 is the ranking level ("which ways is it used?"), L1 is the detail level ("exactly how?"), and L3 is the teaching level ("the pattern"). L1 keeps the *relation* between holes, as in Semgrep's repeated metavariable: `smoothstep(_a, _a + _b, x)` (edge plus width) is a different idea from `smoothstep(_a, _b, x)`. Literal values are not thrown away. Each instance keeps its literals, so a pattern card can show their spread ("edge width: median 0.02").

**Literal canonicalisation**: `1.`, `1.0` and `1.000` are the same; `-#` is kept as `-#` (sign matters: `vec2(-#, #)`), and constant arithmetic (`6.2831853 / 4.0`) folds to `#`.

**Commutativity**: `a * b` and `b * a` are not merged in v1 (the scan shows authors are fairly consistent). v2 could sort operands of `+` and `*` by shape hash.

### 4.4 Storage: a Web Worker plus IndexedDB

- **Worker**: `src/codeExplorer/indexer.worker.ts`, started the way `src/data/datasetRun.ts` and `src/lib/trackerPump.ts` start theirs: `new Worker(new URL(...), { type: 'module' })`. The main thread posts sources (`{docId, version, texts[]}`). The worker returns progress and, at the end, a compact summary.
- **IndexedDB database `code-explorer`**, with object stores:
  - `docs`: `docId → { version (content hash), sourceKind, label, indexedAt }`
  - `sites`: auto key → `{ docId, field, nodeId, line, col, callee, l1, l2, l3?, chain, stmtKind, litVals, prodCallee?, consCallee? }`, with indexes on `callee`, `l2`, `l1` and `docId`
  - `shapes`: `hash → { text, level, count, docCount }` (counts maintained incrementally)
  - `windows`: `hash → postings` for statement windows
  - `words`: inverted index term → `[siteId…]` with term frequencies for BM25
  - `meta`: schema version, topic model, phrase-library version
- **Incremental**: a doc is re-indexed only when its content hash changes. Saved graphs hook into the existing autosave and the Files inventory change events. Linked folders already track mtimes. Deleting a doc deletes its postings and decrements shape counts. Topics are recomputed lazily, at most once per session, after more than 5% of docs change.
- **Bundled examples** ship an index built at build time (a JSON blob produced by a `tools/` script), so first open is instant. Only user content is indexed on device.

### 4.5 Size and performance estimates

Grounded in the scan (§9):

| | Bundled examples | Heavy user (≈10× examples) |
|---|---|---|
| Authored call sites | 944 | ~10k |
| Generated call sites (after de-dup) | 9,679 | ~100k |
| Distinct L1 shapes | 395 authored / 1,535 generated | ~3k / ~10k |
| Index size (≈70 B per site + shapes + words) | ≈0.8 MB | ≈8–10 MB in IndexedDB |
| Cold build (Tier A, in worker) | ≈0.2 s compile + <0.1 s shape | ≈3–5 s, off the main thread, with progress |
| Incremental (one saved graph) | — | <50 ms |
| Query "smoothstep" (index lookup and group by L2) | <10 ms | <50 ms |
| Tier B (shaderfrog) on authored functions | ≈3 ms each | on demand and cached |

---

## 5. Queries

### 5.1 Function → patterns (the core)

Type `smoothstep`, or click "How is this used?" on it. You get:

- a header: **55 calls in 30 examples** (Written) · 287 in 111 (Generated, 70 templates)
- pattern cards ranked by L2 count, each expandable into L1 variants, and each L1 into real instances with provenance
- for each pattern: a phrase (§8.1), the literal spread ("edges 0.70 → 0.706: a crisp edge"), and links to open the instances

### 5.2 Long structures

"What does `smoothstep` usually sit inside, come after and feed into?"

- **Enclosing chains**: the counted `a › b › fn` paths (§9: `mix › smoothstep` in 9 of 55 authored uses).
- **Dataflow chains**: producer → fn → consumer (`length → smoothstep → mix`).
- **Statement windows**: the most common 2–4-statement shapes that contain the function, shown as a code skeleton:

  ```glsl
  float _a = length(_b - vec2(#, #));
  float _c = 1.0 - smoothstep(#, #, _a);
  vec3  _d = mix(_e, _f, _c);
  ```

### 5.3 Co-occurring functions

Functions called in the same statement, and separately in the same function or node, ranked by count. Lift is an option (`P(a,b) / P(a)P(b)`), so `step` doesn't dominate everything. Shown as chips; clicking a chip narrows to instances that use both.

### 5.4 Free text with synonyms ("soft circle edge")

BM25 over a per-pattern document: the phrase-library name and description, split identifiers from its instances, node labels and comments, and the functions in its shape. A hand-made synonym table (`src/codeExplorer/synonyms.ts`) bridges how people talk to how code is written:

| Query words | Expand to |
|---|---|
| soft, smooth, feather, blur edge | `smoothstep`, `fwidth`, "anti-alias" |
| circle, disc, dot, round | `length`, `distance`, `sdCircle` |
| outline, ring, stroke, border | `abs(d) - w`, "ring", "stroke" |
| random, hash, noise, grain | `fract(sin(dot…))`, `hash*`, `noise`, `fbm` |
| repeat, tile, grid, cells | `fract`, `mod`, `floor` |
| blend, fade, lerp, mix | `mix`, `smoothstep` |
| brightness, luma, grey, luminance | `dot(_, vec3(0.299, 0.587, 0.114))`, `luminance` |
| pulse, beat, flash | `exp(-fract(t))`, `pow(1 - fract(…), n)` |

"soft circle edge" → `smoothstep` + `length` + "edge" → top hit: pattern `smoothstep(#, #, length(…))` ("soft disc edge", 12 written uses).

### 5.5 Expert: structural and regex search

- **Structural**: a Semgrep/Comby-style syntax, parsed by the same Pratt parser:
  - `$X` matches any expression, and a repeated `$X` must match the same code
  - `#` matches any literal, `#{0..0.1}` a literal in a range
  - `...` matches any remaining arguments, `$X:vec2` a typed hole (Tier B)
  - `mix($A, $B, smoothstep(#, #, $D))`, or `fract(sin(dot($P, vec2(#, #))) * #)`

  Matching is a tree walk over the candidate sites from the `callee` index, so it is fast.
- **Regex**: over raw source text, scanned in the worker. A trigram prefilter (Russ Cox) is only added if user corpora pass about 20 MB.

---

## 6. Corpus numbers at a glance (bundled examples, real)

- 370 example graphs, all compile.
- **Written:** 211 Expression Blocks, 10 input expressions, 2 Custom Function bodies, 5 Convert examples and 16 converter-corpus files, for 244 sources, 1,057 lines and 944 call sites (395 distinct L1 shapes).
- **Generated:** 45,467 lines in total, or 18,210 after removing the always-helpers and de-duplicating the 228 unique helper functions. That is 9,679 call sites (1,535 distinct L1 shapes).
- **Most-called built-ins in written code:** `step` 125, `sin` 98, `mix` 89, `max` 83, `abs` 66, `length` 65, `exp` 59, `smoothstep` 55, `fract` 52, `cos` 43, `dot` 40, `floor` 25.

---

## 7. Clustering and topics (no model)

The goal is a browsable map: **SDF shapes, palettes and colour, noise and hashes, ray marching, repetition and tiling, timing and pulses, particles and agents, image processing**.

1. **Documents** = one per node or function (an Expression Block, a Custom Function, a helper function, a node's generated slice, a file's function).
2. **Features**: called functions (weighted by IDF), split identifiers, L2 shape ids, and literal "signatures" (`43758.5453` → hash, `0.299/0.587/0.114` → luma, `6.2831` → tau). TF-IDF with sublinear tf.
3. **Cluster**: spherical k-means (cosine) with k chosen by silhouette in 8–20, seeded deterministically so results are the same on every run. Agglomerative clustering is an alternative for small user corpora.
4. **Label**: c-TF-IDF per cluster (BERTopic's step, no embeddings), giving the top terms. These are mapped to a human label through a small curated table (e.g. {`length`, `smoothstep`, `abs`, `sd*`} → "SDF shapes"; {`fract`, `sin`, `dot`, hash} → "Hashes and noise"; {`cos`, `palette`, `vec3(#)` + `t`} → "Palettes"). Clusters with no curated match show their top 3 terms ("`march`, `normal`, `dist`").
5. **Show** topic chips at the top of the Explorer. Each opens its top patterns and docs, and each doc shows its topic mix.

**Embeddings later (v3, optional, off by default):** a 23 MB MiniLM via Transformers.js, embedding *pattern names, phrases and comments* (not raw GLSL; it is not trained for that), for "describe it in words" search. It would be downloaded only when switched on and cached locally. Nothing is uploaded.

---

## 8. Learning: explain, then reuse (the full loop)

### 8.1 "Explain this pattern" (deterministic)

The parallel agent on `claude/expr-explainer` is building a **shared pattern library** in `src/lib/glslPatterns/` and an explainer that matches an expression against it. The Explorer does **not** build its own. It uses that library:

- **Library entry** (owned by `glslPatterns`): `{ id, name, phrase, matcher (structural pattern with typed holes), holeRoles (edge, width, position, colour…), literalHints, tags, topic, related (suggestion move ids, snippet ids, existing node types) }`.
- **The Explorer's use of it**: each L3 pattern card runs the library's matcher. On a hit, the card shows the library's name and phrase instead of the raw shape. A card with no library match shows the raw shape and a **"Name this pattern"** action (§8.2, step 4).
- **Idioms from data** the library can describe with conditions on literals and context. These are real counts from the written examples (53 `smoothstep` calls with literal edges):
  - **flipped** (inside = 1): 32 of 53. 16 use `1.0 - smoothstep(…)` and 16 put the edges in reverse order. *Phrase: "flip so the inside is 1; `smoothstep(b, a, x)` does the same as `1.0 - smoothstep(a, b, x)`".*
  - **crisp edge** (window ≤ 0.05): 30 of 53; the median width is 0.02. *Phrase: "a sharp but anti-aliased edge".*
  - `smoothstep(#, #, length(…))`: "soft disc edge". `smoothstep(-w, w, d)`: "anti-aliased SDF fill" (this one is generated, from SDF Fill). `smoothstep(-w, w, abs(d) - t)`: "thin outline".
  - `fract(sin(dot(_, vec2(12.9898, 78.233))) * 43758.5453)`: "classic hash: a random number per cell".
  - `fract(_ * #)`: "repeat, or a sawtooth over time"; `pow(1.0 - fract(t * k), n)` / `exp(-fract(t) * k)`: "beat pulse".
  - `mix(vec3(#), vec3(#), t)`: "two-colour gradient"; `mix(_, _, smoothstep(…))`: "soft blend between two looks".

### 8.2 The loop: find → see → understand → make → use

```
 ┌─────────────┐   ┌──────────────┐   ┌────────────────┐   ┌───────────────────┐   ┌─────────────────┐
 │ 1 Find      │ → │ 2 See uses   │ → │ 3 Understand   │ → │ 4 Make a node     │ → │ 5 Use anywhere  │
 │ ranked L3   │   │ every        │   │ explainer +    │   │ holes → typed     │   │ node search,    │
 │ patterns    │   │ instance,    │   │ glslPatterns   │   │ inputs, literals  │   │ Do… bar,        │
 │ (explorer)  │   │ provenance,  │   │ phrase         │   │ → sliders; name   │   │ suggestions;    │
 │             │   │ jump to node │   │ (shared lib)   │   │ approved by user  │   │ explorer counts │
 └─────────────┘   └──────────────┘   └────────────────┘   └───────────────────┘   └─────────────────┘
        ▲                                                                                   │
        └──────────── new uses of the node are indexed and counted again ───────────────────┘
```

1. **Find.** The Explorer ranks L3 patterns, by function or across the whole corpus ("Common patterns you haven't named yet").
2. **See uses.** Every instance, with provenance. The jump-to-source path is in §10.3.
3. **Understand.** The `glslPatterns` explainer gives the name, the phrase, and the role of each hole.
4. **Make a node from this.** This reuses the explainer branch's "Make a node from this" module. The Explorer hands it the L3 pattern and the instances.
   - **Holes become typed inputs.** Types come from Tier B (`length(_ - ?:vec2)` → `p: vec2`), or from the shapes the holes held across instances. Names come from `holeRoles` when the library knows them, otherwise from the most common identifier in that slot across instances (e.g. `uv`, `c`).
   - **Literals become sliders.** The default is the **median** across instances, and the range comes from the observed min and max, widened with `rangeForValue` (`src/lib/rangeMath.ts`, which the converter already uses). Following the slider conventions, typing past the max extends the range. Literals that never vary across instances (like `0.299`) stay constants unless the user ticks them.
   - **Output type** comes from the pattern's root.
   - **Target**: an **Expression preset** (`ExprPreset`: one `result` line, or `lines` for a statement window) by default. A **Custom Function preset** (`CustomFnPreset`) is used when the pattern spans a helper function or needs loops. A published user node (`src/nodes/userNodes/publishUserNode.ts`) is optional.
   - **User-approved name**: the dialog suggests the library name (or the c-TF-IDF terms) and the user edits it. Saving also **promotes** the pattern into `glslPatterns` as a *user* entry `{ origin: 'user', approvedName, matcher, presetId }`, so from then on the explainer and the Explorer both recognise it by name.
   - **Already a node?** Before offering to make one, check the library's `related.nodeTypes` and do a shape lookup against node-library slices. If a built-in node already computes the pattern, offer **"Use the X node"** first and "Make my own anyway" second. This avoids duplicate nodes.
5. **Use anywhere.** The new preset appears in node search (palette), the **Do…** bar and the **suggestions** system being built on `claude/suggestions-*`. The library entry's `related.moves` links a pattern to suggestion moves, e.g. "turn this soft edge into an outline". When the user places the node, its uses are indexed, and the Explorer shows "N uses as a node, M still written by hand", with a **"Replace with node"** action for each hand-written instance. (That action is v3; it rewrites an Expression Block's line into a wire.)

### 8.3 Worked example: the luminance dot → a "Brightness" node

**1 · Find.** On the Explorer home, under "Common expressions", the scan finds `dot(_, vec3(#, #, #))` with the literal signature `0.299 / 0.587 / 0.114`. Real numbers: **36 hits across 25 example graphs**. 6 are written by hand, all in Expression Blocks; the other 30 are generated, from nodes like Time Cube View, Texture Levels, Chroma Shift and Blend Screen. Two coefficient sets appear. Rec. 601 (`0.299, 0.587, 0.114`) is the most common in hand-written code. Rec. 709 (`0.2126, 0.7152, 0.0722`) is used by several node definitions.

**2 · See uses.** These are the written instances:

| Example | Node | Line |
|---|---|---|
| passGlowBright | "Keep the bright parts" | `float … = dot(…, vec3(0.299, 0.587, 0.114))` |
| passParticleEdges | "Blobs over the sparks" | the same line |
| passSlimeEdges | "Food" and "Veins in the picture's colours" | the same line, in each block |
| agentGrowPicture | "Food" and "Veins in the picture's colours" | the same two blocks |

All six use Rec. 601 weights, and the variable is named `luma` or `bright`.

**3 · Understand.** The library match is `luma.rec601`: *"Brightness of a colour as the eye sees it: green counts most, blue least."* The variant `luma.rec709` has its own phrase: *"the same idea with HDTV weights"*.

**4 · Make a node, but first check for one.** The duplicate check finds that the built-in **Luminance** node (`type: 'luminance'`, `src/nodes/definitions/math.ts`) already computes the Rec. 709 version. The dialog offers:

- **Use the Luminance node** (recommended)
- **Make "Brightness" anyway**, with the weights exposed

If the user makes it:

```
Expression preset "Brightness"
  inputs:  colour: vec3                         ← the hole (most common names: picture, c)
           red   : float  slider 0.299 [0, 1]   ← literals, ticked to be editable
           green : float  slider 0.587 [0, 1]
           blue  : float  slider 0.114 [0, 1]
  result:  dot(colour, vec3(red, green, blue))
  output:  float
```

The pattern is promoted into `glslPatterns` as a user entry named "Brightness" and linked to the preset.

**5 · Use anywhere.** "Brightness" now appears in node search, the Do… bar ("brightness", "luma" and "grey" all match through the synonyms) and suggestions (on a vec3 → float wire: "Get its brightness"). In the Explorer, the pattern card says **"6 written by hand · 0 as a node"**, with "Replace with node" on each instance (v3).

---

## 9. Mock results, computed for real

The numbers come from a throwaway scan (`vite-node`, kept out of the repo) over the bundled examples. It used the Tier A tokenizer, the L1/L2 shapes from §4.3 and provenance as in §3.2. *Written* means Expression Blocks, Custom Functions, input expressions, Convert GLSL and the converter corpus. *Generated* means the compiled `main()` lines (attributed to nodes by slug) plus de-duplicated helper functions.

### `smoothstep`: 55 written calls in 30 examples (generated: 287 in 111, 70 templates)

| # | Pattern (L2) | Phrase | Written uses | e.g. |
|---|---|---|---|---|
| 1 | `smoothstep(#, #, _)` | edge on a value | **36** | particleChladniSand · plate · L2 `float onPlate = 1.0 - smoothstep(0.70, 0.706, edge);` |
| 2 | `smoothstep(#, #, length(…))` | soft disc edge | **12** | gridDensityWave · "dot" · L2 `return 1.0 - smoothstep(0.22, 0.28, length(cuv));` |
| 3 | `smoothstep(#, #, min(…))` | soft edge of the nearer of two | 2 | passGlowBright · "Neon sign" · L2 (mortar lines) |
| 4 | `smoothstep(_, _ + #, _)` | threshold plus width | 1 | passGlowBright · "Keep the bright parts" · `smoothstep(threshold, threshold + 0.25, luma)` |
| 5 | `smoothstep(#, #, _.x)` / `_.y` | edge on one channel | 2 | agentAnts · "Ground" · L4–5 |

- **Exact shapes (L1):** `smoothstep(#, #, _a)` 35 · `smoothstep(#, #, length(_a - _b))` 4 · `length(_a)` 2 · `length(fract(_a * #) - #)` 2 (a grid of dots)
- **Inside:** standalone 45 · `mix › smoothstep` 9 · `mix › mix › smoothstep` 1
- **Statement:** `float x =` 33 · `vec3 x =` 14 · `return` 8
- **Flow:** `· → smoothstep → mix` 11 · `abs → smoothstep → return` 5 · `length → smoothstep → gl_FragColor` 4 · `length → smoothstep → mix` 3
- **Same line as:** `length` 16 · `mix` 13 · `fract` 12 · `step` 6 · `abs` 5
- **Idioms:** flipped 32/53 (half via `1.0 −`, half via reversed edges), crisp (≤0.05) 30/53, median width 0.02
- **Generated (top templates):** `smoothstep(-_a, _a, _b)` 41 (SDF Fill's anti-aliased fill) · `smoothstep(#, #, _a)` 35 · `smoothstep(#, max(_a, #), abs(_b - _c))` 19 (plot/compare line) · `smoothstep(-_a, _a, abs(_b) - _c * #)` 15 (SDF Fill's stroke)

### `mix`: 89 written calls in 37 examples (generated: 546 in 166, 156 templates)

| # | Pattern (L2) | Phrase | Written | e.g. |
|---|---|---|---|---|
| 1 | `mix(vec3(…), vec3(…), _)` | two-colour gradient | **16** | agentAnts · "Ant rule" · L9 `mix(vec3(0.62, 0.42, 0.3), vec3(1.0, 0.86, 0.25), carry)` |
| 2 | `mix(_, _, _)` | blend two values | **12** | voxelTerrain · "Solid cells / step to exit" · L5 |
| 3 | `mix(vec3(…), vec3(…), smoothstep(…))` | soft two-colour blend | **6** | passReactionDiffusion · "Colour the coral" · L4 |
| 4 | `mix(mix(…), vec3(…), _)` | layered colour (paint over) | 5 | agentAnts · "Ground" · L7 |
| 5 | `mix(vec4(…), vec4(…), _)` | choose between two vec4 | 4 | agentAnts · "Which smell" · L2 |
| 6 | `mix(hash21(…), hash21(…), _.x)` | value noise: blend corner randoms | 4 | Convert · shadertoy · L5 |
| 7 | `mix(vec3(…), vec3(…), _.y * # + #)` | vertical sky gradient | 3 | particleRain · sky · L2 |

- **Inside:** standalone 74 · `mix › mix` 11 · `mix › mix › mix` 2
- **Statement:** `return` 50 · `vec3 x =` 31 · `float x =` 6
- **Same line as:** `hash21` 24 · `smoothstep` 13 · `dot` 12 · `hash2` 12 · `max` 9
- **Generated:** `mix(_a, _b, _c)` 163 · `mix(_a, _b, _c * _d)` 69 · `mix(_a, _b, _c * _c * (# - # * _c))` 37 (a hand-rolled smoothstep in Stop Palette) · `mix(_a, _b, clamp(…))` 24 (Remap)

### `fract`: 52 written calls in 27 examples (generated: 267 in 131, 63 templates)

| # | Pattern (L2) | Phrase | Written | e.g. |
|---|---|---|---|---|
| 1 | `fract(_ * #)` | repeat, or sawtooth over time | **20** | particleSoundField · beat · L1 `pow(1.0 - fract(t * 2.0), 6.0)` (beat pulse) |
| 2 | `fract(sin(…) * #)` | classic hash | **13** | fcTheScreen · "window lights" · L2 `fract(sin(dot(ceil(p - sin(p)), vec2(12.9898, 78.233))) * 43758.5453)` |
| 3 | `fract(_ / #)` | slow sawtooth | 3 | particleChladniSand · beat · L1 |
| 4 | `fract(_.y)` / `fract(_.x)` | position inside a cell, one axis | 5 | passGlowBright · "Neon sign" (brick mortar) |
| 5 | `fract(_)` | position inside a cell | 3 | Convert · shadertoy (value noise) |

- **Inside:** standalone 30 · `step › fract` 10 · `smoothstep › min › fract` 4 · `pow › fract` 3
- **Same line as:** `sin` 19 · `step` 16 · `smoothstep` 12 · `dot` 11 · `min` 8
- **Generated:** `fract(sin(dot(_a, vec2(#, #))) * #)` **85**, the hash, everywhere in node helpers · `fract(_a)` 59 · `fract(# * fract(dot(gl_FragCoord.xy, vec2(#, #))))` 9 (interleaved-gradient-noise dither)

### `length`: 65 written calls in 40 examples (generated: 238 in 124, 52 templates)

| # | Pattern (L2) | Phrase | Written | e.g. |
|---|---|---|---|---|
| 1 | `length(_)` | distance from the origin (circle SDF) | **35** | ringGlow · "Ring Glow" · L2 `float l = length(p) - 1.0;` |
| 2 | `length(_ - vec2(…))` | distance from a fixed point | **15** | passReactionDiffusion · "Seed" · L3 |
| 3 | `length(_ - _)` | distance between two points | 6 | passReactionDiffusion · "Seed" · L2 `length(uv - at)` |
| 4 | `length(fract(…) - #)` | distance inside each tile (grid of dots) | 2 | passSlimeEdges · "Moonlit picture" · L8 |
| 5 | `length(max(…))` | box SDF outside part | 2 | corpus · 04_helper.frag · L3 |

- **Inside:** standalone 37 · `smoothstep › length` 12 · `max › length` 5 · `abs › length` 3
- **Statement:** `float x =` 49
- **Flow:** `length → (arith)` 13 · `→ min` 8 · `→ max` 7 · `→ smoothstep` 7 (union, intersection, soft edge)
- **Same line as:** `smoothstep` 16 · `max` 11 · `sin` 5
- **Generated:** `length(_a)` 144 · `length(max(_a, #))` 21 (box SDFs) · `length(_a - _b)` 18

**What the real data teaches:**

1. Written and generated code tell different stories: hand-written `smoothstep` is mostly literal edges on a value; node code is mostly `smoothstep(-aa, aa, d)`.
2. Generated counts must be de-duplicated by template (287 → 70).
3. A handful of L2 shapes cover most uses: the top 2 cover 87% of written `smoothstep` (48 of 55) and 77% of written `length` (50 of 65).
4. The flip idiom (`1.0 - smoothstep` or reversed edges) is in 60% of literal-edge calls. That makes it the single most useful thing to explain.

---

## 10. UI

### 10.1 Where it lives

- **Code Explorer panel** on the **GLSL page** (`src/components/GLSLPage.tsx`), next to "Discover functions". It is also a **Files** home section, "Explore code", next to Most used (`mostUsed.ts`).
- **"How is this used?"**:
  - right-click, or a hover action, on any function name in the **Expression Block** and **Custom Function** editors (`ExprBlockModal`, `CustomFnModal`, `GlslEditor`)
  - in the GLSL **Reference panel** (`src/components/code/ReferencePanel.tsx`)
  - on snippet-library and Functions-library cards

  It opens the panel pre-filtered to that function, scoped to the current graph first and then everything.
- Following the collapsed-by-default rule: only the pattern list is open, while chains, flow and co-occurrence start folded with one-line summaries.

### 10.2 Pattern cards

```
┌──────────────────────────────────────────────────────────────┐
│ soft disc edge                               12  ▁▂▅▇▃▂ 9 ex │
│ smoothstep(#, #, length(…))                                  │
│ edges: median 0.22 → 0.28 · usually flipped (1.0 − …)        │
│ ▸ 4 variants   ▸ 12 instances   [Make a node] [Search similar]│
└──────────────────────────────────────────────────────────────┘
```

- The **sparkline** shows the count per topic, or per example folder, so you can see *where* the pattern lives. (For saved graphs it could show the count over time, when the activity log allows.)
- **Instances**: the code line, syntax-highlighted using the editor's highlighter, with the matched span marked and holes tinted by role. Below it: *example · node label · line*, and the source kind as a small tag (Written / Generated / File / Present).

### 10.3 Jump to source

Example or saved graph → load it (asking first if the open graph has unsaved changes, using the existing load path) → select `nodeId` (open the group along the path) → open that node's editor (`ExprBlockModal` / `CustomFnModal`) → scroll to `line`/`column` and flash the span.

For generated hits: select the node and open the Code panel with `nodeSliceLines` highlighted at `generatedLine`. For files: open on the GLSL page at the line. For Present: open the presentation at the block.

---

## 11. Phases, effort and risks

### v1: Explore what is written (M–L)

- `src/codeExplorer/`:
  - tokenizer and Pratt parser (S)
  - extractors: sites, chains, statement kinds, flow (M)
  - L1/L2 shaping and hashing (S)
  - worker and IndexedDB store with incremental updates (M)
  - build-time index for the bundled examples (S)
- Corpus: example and saved-graph Expression Blocks, Custom Functions, input expressions, presets, saved shaders, Convert sources.
- Queries: function → patterns, chains, co-occurrence, simple free text (BM25 plus the synonym table).
- UI: GLSL-page panel, "How is this used?" in the editors and the Reference panel, pattern cards, instances, jump to source.
- Explain via `glslPatterns` (consume only; the library is owned by `claude/expr-explainer`).
- **Tests (vitest):**
  - tokenizer and shaper golden tests (the shapes in §9 become fixtures)
  - provenance round-trip: a site → `nodeId`/`line` matches the source text
  - incremental: edit one doc, and the counts change by exactly its delta
  - worker protocol, run in-process
  - the §9 counts as a snapshot test over `EXAMPLE_GRAPHS`, so example changes show up as diffs

### v2: Generated code, long structures and topics (M)

- Generated corpus via `compileGraph` + `nodeSlugMap`, de-duplicated by template, with the Written/Generated/Both switch.
- Statement windows, L3 anti-unification, DECKARD-style near-miss "Search similar".
- Topics: TF-IDF + k-means + c-TF-IDF + a curated label table.
- Structural search (`$X`, `#`, `...`) and regex mode.
- Linked folders, workspace `.glsl` and Present code blocks.
- **Make a node from this** (using the explainer branch's module), with promotion to user `glslPatterns` entries and the duplicate-node check.

### v3: Closing the loop (M)

- "Replace with node" for hand-written instances.
- Suggestions integration (`related.moves`) and Do… bar entries.
- Typed holes everywhere via Tier B (cached).
- Optional on-device embeddings for phrase search (off by default, downloaded on request).
- Trigram prefilter, if corpora get large.

### Risks

| Risk | Mitigation |
|---|---|
| Expression fragments without declarations (an Expression Block's `rhs`) can't be typed | Types come from the node's `inputs` declarations; Tier A is untyped by design |
| The slug-on-line rule mis-attributes lines that name two slugs | Attribute by assignment target; add a compiler-side line → node map later (a small `graphCompiler` change) |
| Generated code drowns written code | Separate modes, template de-dup, Written by default |
| A full shaderfrog parse is slow (≈62 ms per shader) | Tier A for bulk, Tier B only on small authored functions, cached by hash |
| Phrases that sound right but are wrong | The phrase library is curated and tested (each phrase has positive and negative fixtures); no free generation |
| Index grows unbounded in IndexedDB | Per-doc postings with a version hash, garbage-collected on delete; a size line in Settings → Storage (the existing storage-limit UI) |
| Duplicate nodes from "Make a node" | The duplicate-node check against `related.nodeTypes` and node-library shapes, offered first |
| Overlap with the explainer branch | The Explorer only *reads* `glslPatterns` and calls its "make node" module; it writes only user entries through that module's API |

### Privacy

Everything is local. Indexing runs in a worker on the device, and the index lives in the app's own IndexedDB (the desktop app uses the WebView's). There are no network calls; the optional v3 embedding model is the only download, and only when switched on. Nothing about your code leaves the machine. Clearing the index is one button, and a profile export (`profileZip.ts`) does **not** include it: it is rebuilt from content.

---

## 12. Sources

- Comby: [basic usage](https://comby.dev/docs/basic-usage) · [Sourcegraph: Going beyond regular expressions with structural code search](https://sourcegraph.com/blog/going-beyond-regular-expressions-with-structural-code-search)
- Semgrep: [Rule pattern syntax](https://semgrep.dev/docs/writing-rules/pattern-syntax)
- Tree-sitter: [Query predicates and directives](https://tree-sitter.github.io/tree-sitter/using-parsers/queries/3-predicates-and-directives.html) · [tree-sitter-glsl](https://github.com/tree-sitter-grammars/tree-sitter-glsl)
- `@shaderfrog/glsl-parser`: [npm](https://www.npmjs.com/package/@shaderfrog/glsl-parser) · [GitHub](https://github.com/ShaderFrog/glsl-parser)
- Jiang et al., *DECKARD: Scalable and Accurate Tree-based Detection of Code Clones*, ICSE 2007: [PDF](https://www.cs.ucdavis.edu/~su/publications/icse07.pdf)
- Bulychev & Minea, *Duplicate code detection using anti-unification*: [PDF](https://clonedigger.sourceforge.net/duplicate_code_detection_bulychev_minea.pdf) · *Anti-unification and Generalization: A Survey*: [ResearchGate](https://www.researchgate.net/publication/373087140_Anti-unification_and_Generalization_A_Survey) · *Overwatch: Learning Patterns in Code Edit Sequences*: [arXiv](https://arxiv.org/pdf/2207.12456)
- Russ Cox, *Regular Expression Matching with a Trigram Index*: [swtch.com](https://swtch.com/~rsc/regexp/regexp4.html) · GitHub, *The technology behind GitHub's new code search*: [blog](https://github.blog/engineering/architecture-optimization/the-technology-behind-githubs-new-code-search/)
- BM25 for code: [Improving BM25 Code Retrieval Under Fixed Generic Tokenization](https://arxiv.org/pdf/2605.18561) · [Lucene similarities](https://lucene.apache.org/core/9_5_0/core/org/apache/lucene/search/similarities/package-summary.html)
- Topic models on code: Panichella et al., *How to Effectively Use Topic Models for Software Engineering Tasks?* (ICSE'13): [PDF](https://www.cs.wm.edu/~denys/pubs/ICSE'13-LDA-CRC.pdf) · Chen et al. survey: [PDF](https://petertsehsun.github.io/papers/peter_emse_survey2015.pdf) · *Topic modeling of public repositories at scale using names in source code*: [arXiv](https://arxiv.org/html/1704.00135v1)
- Grootendorst, *BERTopic: Neural topic modeling with a class-based TF-IDF procedure*: [arXiv](https://arxiv.org/pdf/2203.05794)
- In-browser embeddings: [Hugging Face: sentence embeddings in the browser](https://observablehq.com/@huggingface/sentence-embeddings-and-dimension-reduction-in-the-browse) · [philna.sh: vector embeddings in Node.js](https://philna.sh/blog/2024/09/25/how-to-create-vector-embeddings-in-node-js/)

---

## Phase 1 shipped

What landed on `claude/code-explorer-p1`, against §11's v1 list. The code is in `src/codeExplorer/` (core) and `src/components/codeExplorer/` (UI).

### Built as planned

- **Tier A parsing.** `tokenizer.ts` blanks comments with discover.ts's `blankComments`, so offsets don't move, and skips directives. `parser.ts` is a Pratt expression parser plus a tolerant statement walker: declarations, assignments, return, the headers of if/for/while, functions and structs. Junk is skipped up to the next `;`. Function definitions come from `discoverInSource` (`extract.ts`). Shadertoy names are read through dialects.ts's `SHADERTOY_RENAMES`, so `iTime` shapes as `u_time` without rewriting the text (provenance offsets stay true). Tier B (shaderfrog) isn't needed in phase 1 and isn't loaded.
- **Shapes.** `shape.ts` produces L1 (literals → `#`, signs kept as `-#`, constant arithmetic folded, locals → `_a, _b…` with repeats sharing a letter, built-ins kept) and L2 (names → `_`, nested calls → `name(…)`). `antiUnify.ts` produces L3: anti-unification of the L1 variants of one L2 group, with at most 2 holes. A merge must keep at least 70% of each variant's tree, so a hole can't swallow a whole call.
- **Extraction.** Each call site records: callee, L1, L2, field, line, column, the statement line with the call's span, enclosing chain (constructors skipped), statement kind, producer → call → consumer, the other callees in the same statement, its literal arguments, whether it is flipped (`1.0 - f(…)`), and split identifier words. Constructors are indexed but flagged, and kept out of chains, co-occurrence and the top-functions list.
- **Provenance** follows §3.2. An Expression Block line is its own field (`lines[i].rhs`, `result`), with `line` = the block's line number and `column` inside the rhs. Bare Custom Function bodies are read as `return …;`, with the column corrected back. A node inside a group carries its `nodePath`.
- **Corpus (written).** Covers bundled examples (`example:`), Convert examples (`example-convert:`), saved graphs (`saved:`), the open graph as edited (`open:`; left out when it is an unchanged saved graph or example), Custom Function, Expression and group presets and Function Builder functions (`preset:`, `builder:`), saved shaders (`shader:`), the Convert page's current shader (`convert:current`), GLSL typed into Present code blocks (`present:`), and linked-folder `.glsl/.frag/.vert…` files (`file:`; bounded to 300 folders, 400 files and 256 KB a file).
- **Worker + IndexedDB.** `indexer.worker.ts` runs `host.ts`. The protocol is `init`, `sync {prefixes, docs}`, `rebuild` and `query`. The IndexedDB database `code-explorer` has stores `docs` and `meta` (schema version, the prebuilt hash applied). Sync is incremental: a doc is re-extracted only when its content hash changes, and docs under the synced prefixes that disappeared are removed. The in-memory postings and the L1/L2 counts change by exactly the doc's delta (this is tested). Where module workers are unavailable, the client runs the same host in place.
- **Triggers.** Sync runs on first use, on `saved-graphs-changed`, on activity events (shader and preset saves), on `customfn-changed`, `presentations-changed` and `storage`, when a graph is opened, and on edits to the open graph (debounced 2 s). Rebuild is a button in the panel.
- **Prebuilt examples index.** `src/codeExplorer/prebuilt/examples.json` (≈0.5 MB, ≈77 KB gzipped) is fetched by the worker as a separate asset. At runtime the app re-checks the examples' content hashes and re-indexes only the ones that changed since the file was built. Regenerate it with `CODE_EXPLORER_WRITE=1 npx vitest run src/codeExplorer/__tests__/prebuilt.test.ts`. The test warns when the file is stale and fails only when more than 25% of examples are stale or the schema is old.
- **Queries** (`queries.ts`):
  - **Function report:** L2 cards with L1 variants, L3 merges, instances (up to 60 per variant), a sparkline per doc group (example folder, Saved graphs, Presets…), literal spread and the flipped count, plus chains, flow, producers, consumers, statement kinds, same-statement co-occurrence (click to narrow) and same-node/function co-occurrence with lift.
  - **Free-text search:** BM25 over one document per (function, L2), built from the pattern name and phrase, the functions in the shape, and the words around its instances. Uses the §5.4 synonym table (`synonyms.ts`) at half weight, with a gentle log-count prior.
  - **Summary and suggestions.**
- **UI.**
  - The **Code Explorer panel**: a column on the GLSL page (the `</>` button next to Discover functions), and a dialog opened from anywhere.
  - An **Explore code** card on the Files home.
  - **How is this used?** in the Expression Block and Custom Function editor headers. It reads the identifier at the caret, and the button doesn't take focus.
  - **Right-click → How is this used?** on function chips in the Functions panel (`ReferencePanel`).
  - Chains, flow and co-occurrence start folded, with one-line summaries, and remember their state.
- **Jump to source** (`jump.ts` plans the jump, which is pure and tested; `jumpRun.ts` carries it out):
  - **Graph:** load it, asking first when the open graph has unsaved changes. Enter the groups (two deep, not sealed). Focus or reveal the node. A small `jumpStore` request makes the node card open its editor. The Expression Block editor focuses `Line N expression` / `Return expression` and selects and flashes the call. The Custom Function editor uses `CodeField`'s existing `flash`, opening Helper functions if needed. Input expressions open the input's expression popover.
  - **Shaders and linked files:** open on the GLSL page with the range selected.
  - **Convert, Present, presets, Builder:** go to their page.
- **Explainer integration.** At merge time the shared library (`src/lib/glslPatterns/`, branch `claude/expr-explainer`) wasn't on main. `explain.ts` defines the adapter (`PatternExplainer`: `explain(query) → {id, name, phrase}`, optional `makeNode`) with `registerPatternExplainer()`. Until the library registers, a small built-in label table (≈30 rows, from §9's phrases) names the commonest shapes. To wire the library in, register it from a module imported by both `indexer.worker.ts` (search ranks on names) and the app (cards). Nothing in the Explorer duplicates the idiom library.

### Measured (vitest on an M-series Mac; examples as of 2026.10.48)

| | |
|---|---|
| Collect the examples' written code | ≈7 ms |
| Extract (Tier A + shapes + flow) for every example doc | ≈25–35 ms for ≈1,200 call sites |
| Function report (`smoothstep`) | ≈1–3 ms |
| Free-text search (first call builds the pattern documents) | ≈5–15 ms, then ≈1–2 ms |

Counts against §9 (with the converter corpus included, as the plan's scan did) are tested with tolerances: `smoothstep` ≈55 calls in ≈30 examples, top L2 `smoothstep(#, #, _)` then `smoothstep(#, #, length(…))`, `mix › smoothstep` among the chains, `length` first on the same line, and `step` the most-called function.

### Left for later, or different from the plan

- **Generated code**, the Written/Generated switch, statement windows, DECKARD near misses, topics, structural `$X` search and regex mode are phase 2, as planned. Present quotes of generated code aren't indexed in phase 1.
- **Storage layout.** Postings aren't stored as their own object stores with IndexedDB indexes. Each doc is stored whole (with its sites) and the postings are rebuilt in memory when the worker starts (≈1k–10k sites, a few ms). This is simpler, and incremental per doc.
- **Hashes.** Shapes are keyed by their text rather than by a hash; at this corpus size it makes no difference.
- **Holes are untyped** (Tier B is phase 2–3).
- **Make a node from this** waits for the explainer's module (`patternMaker()` is the hook).
- **Jump to source limits.** It can't open an editor for nodes deeper than two groups or inside sealed groups (the group is shown). Presets jump to the Files page rather than the preset's own page. Convert examples open on the Convert page without a line selected.
- **Workspace `.glsl` files** (the shared workspace folder) aren't read yet; linked folders are.
- The open graph is told apart from an unchanged example by a fingerprint of its code. An example opened before the Explorer first starts may count twice until the examples sync has run (a second or so).
