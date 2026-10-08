# Your taste: a small local model of what you like

Playfield learns which looks you like from what you pick, keep and rate. It uses that to lean Surprise,
Deep and Evolve toward your style. It's small: a sparse linear score over hand-made features. It runs on
your device, with no cloud AI and no network calls. The code is in `src/taste/`; the app side is in
`src/components/taste/` and `src/components/surprise/evolveAction.ts`.

## What it sees: the features (`features.ts`)

A graph becomes a sparse feature vector:

| Feature | Example | From |
| --- | --- | --- |
| Technique families and techniques | `fam:lightFalloff`, `tech:falloff-exp` | pattern discovery (`src/patterns`, `analyseGraph`) |
| What fills each stage | `st:light=Exp falloff`, `st:space=Expression Block` | the inspired plan's stages, or every fragment of a graph (`lang/inspired/fragments.ts`, `stageChoice`) |
| Node types | `nh:17` | node-type counts, hashed into 64 buckets, log-scaled |
| Where common settings sit | `set:falloff=hi`, `set:frequency=lo` | thirds of the setting's *interesting* range (`lib/surprise/ranges.ts`) |
| Code or not | `code:yes` / `code:no` | an Expression Block or Custom Function is present |
| Palettes | `pal:dark`, `pal:vivid` | Palette and Stops Palette colours |
| Sources | `src:example:neonGrid` | what a surprise was inspired by, or the rated item itself |
| Image metrics | `img:colourful`, `look:dark` | Deep's cheap metrics (colourfulness, contrast, detail, motion, symmetry, novelty) and brightness, when the candidate was drawn |

Long vectors are scaled down, so a big graph doesn't learn faster than a small one.

**The seam for an image network.** `registerImageEmbedder({ id, dims, embed(frame) })` lets a later step
add a small local image embedding, for example MobileNetV3-small via onnxruntime-web. Its vector would go
in as `emb:<i>` features (`graphFeatures(nodes, { embedding })`). Nothing is registered and no dependency
is added yet. The model stores the embedder's id, so a change of network can reset those weights.

## How it learns (`model.ts`)

- **Picks** (Evolve, and a kept surprise over the others you looked at) use an online pairwise logistic
  (Bradley–Terry) model: P(a ≻ b) = σ(w·(a − b)). Each pick is one gradient step, with learning rate 0.2
  and L2 0.01 on the weights it touches.
- **Ratings**: like/dislike, or 1–5 stars mapped to −1…1 (`starsToValue`). Each is a logistic step toward
  the rating. Rating again replaces the old lesson, and clearing a rating unlearns it approximately.
- **Implicit signals** count less:

  | Signal | Weight |
  | --- | --- |
  | kept surprise | +0.5 |
  | undone surprise (Escape, Undo, or ⌘Z back to the old graph) | −0.5 |
  | node starred | +0.6 |
  | edited within 10 minutes of keeping | +0.3 |
  | saved graph opened 3+ times | +0.15 |

- **Per-stage table**: P(choice | stage), add-one smoothed. Picks and likes add evidence for the winner's
  choices. The loser's choices lose a little. This gives lines like "You usually put an Expression Block
  in the space stage".
- **Exploration**: ranking keeps about 25% for exploration. `rankWithExploration` fills each slot at random
  with ε = 0.25, otherwise with the best Thompson-sampled score (noise shrinks as a feature gets evidence).
  The generator's lean is mixed with a flat 0.25 and clamped, so no choice becomes impossible. One fresh
  seed in four ignores taste.

**Convergence** (`__tests__/taste.test.ts`): on synthetic graphs where you always pick family X over Y,
P(X ≻ Y) on held-out pairs is 0.74 after 3 picks, 0.81 after 5, 0.88 after 10 and 0.93 after 20. The held-out
pairs are ranked right after 3 picks. With noisy picks (80% X), it still learns X. The exploration share
measures 0.246, and the disliked style still comes first in about 13% of rankings.

## Where it's used

- **Surprise** (the Do bar's 🎲): the inspired generator leans on the model through `PlanBias`
  (`lang/inspired/compose.ts`, `src/taste/bias.ts`):
  - a stage's techniques are weighted by K·P(choice | stage) and their learned weight;
  - a family is weighted by the mean of its techniques;
  - sources are weighted by your ratings: a liked graph or shader 3×, a disliked one 0.3×, adjusted by
    what picks taught about it.

  A liked graph pulls its techniques in. Fresh seeds are steered by the plan's taste as well as by how
  little it repeats recent rolls. An empty model gives no lean at all, so the plans are the same as before.
- **Deep**: candidates are ranked by Deep's score plus taste, with the taste part growing with confidence
  (at most ~0.3), and with ~25% exploration. Chips say why: "your: exp falloff", or "exploring".
- **Evolve** (below).
- **The Do bar**: type-ahead and node search lean on node types you like. An item moves up at most about
  1.5 places, or 3 points within a match tier. Exact matches never move.
- The builders' Surprise me is not touched yet.

## Evolve (`evolve.ts`, the Do bar's **Evolve** button next to Deep)

Two candidates side by side. Each card shows:

- a small picture;
- its seed and its "Inspired by" sources;
- what changed;
- why-chips: Deep's metrics and taste.

Hover a card (or press ← →) to see that candidate on the canvas. Click a card to pick it. The model learns
the pair, and the next round shows:

- **Refine**: your pick mutated. A few settings are nudged within a quarter of their interesting range.
  Half the time a technique is swapped for another of the same family (settings carried over), or a post
  step is added.
- **Branch**: a new inspired graph that uses your pick as one of its sources (it brings the first piece),
  biased by the per-stage table.

The strip shows the round and a "learned: …" line ("you prefer exp falloff, dark palettes and high
falloff"). **Keep** (or Enter) commits the candidate on the canvas as one undo step. It replaces the graph
the way Surprise does. **Escape**, Undo or ⌘Z restores the original graph exactly. The state machine is
pure (`startEvolve`, `pickEvolve`, `keepEvolve`, `escapeEvolve`): the same seed and the same model make the
same rounds.

## Rating anything

A small 👍 / 👎 sits on:

- saved graphs and examples (the Nodes sidebar's lists);
- GLSL-page shaders (their cards);
- palettes (the Palette node's tools);
- technique cards (Code Explorer → Patterns).

Click the lit one again to clear it.

**Your taste** (the 👍 button in the Do bar) lists:

- what the model has learned: its clearest likes and dislikes, and the top choices per stage;
- the stage suggestions;
- how many signals it has learned from.

It also has **Open full page**, **Export**, **Import** (merges) and **Reset my taste**.

## The Taste page (`src/components/taste/TastePage.tsx`)

The Taste page is a view of the Files page. It loads the first time it opens. You can reach it from:

- Files → **Your taste** (in the sidebar and on Home);
- Files → App settings → **Your taste** → Open Your taste;
- the Do bar's taste panel → **Open full page**.

Its sections fold, and each one remembers whether it is open. Only **Profile** starts open; folded
sections show a one-line summary.

- **Profile.** A plain-language summary (`src/taste/summary.ts`), made from the model with templates, not
  AI. The same model always gives the same words. Two people get different words, because the text comes
  from their own weights, evidence and stage table. For example: "You like glowing, high-contrast
  pictures with exponential falloff and dark, vivid palettes. In the space stage you usually reach for an
  Expression Block. You rarely keep layered noise (fBm)."
  - Each sentence carries a confidence word from the evidence behind it: *still learning* (under 3),
    *fairly sure* (under 8) or *sure*.
  - Your steering gets its own sentence ("You asked for more dark pictures and palettes and less Layered
    noise (fBm)").
  - Pills show the layers: this install, the imported profile, your steering, and any items not on this
    install.
  - With an imported profile, a second line says what this install learned alone.
- **What it learned.**
  - Likes and dislikes grouped by kind: techniques and families, stages, palettes, settings ranges,
    sources, image look. Each row has:
    - a bar split into imported, this install and steering;
    - its total, its evidence and a confidence word;
    - boost / avoid / ban pins.
  - Open a row to see its **trace** (below).
  - The per-stage table as bars.
  - Favourite sources: liked graphs, examples and shaders, by their weight as a Surprise source. Click
    one to open it.
  - Imported learning about items that aren't on this install.
  - The page header has a "how sure" meter: confidence is n / (n + 10) over all signals.
- **Signal log.** Every lesson, newest first, filterable by kind (plus "Imported" for a profile's log).
  Each entry shows what it was about and the three features it moved most. Click an entry to open its
  graph, example or shader, or to make its seed again (a Surprise seed, or an Evolve session's seed).
- **Your steering** (below).
- **Model internals** (developer view):
  - the raw weight table: imported, here, steering, total and evidence. Sort by any column; search by
    key or name;
  - weight and layer counts, the stored version (2), and the embedder (none);
  - signal counts from the model and from the log;
  - the constants: learning rate 0.2, L2 0.01, ε 0.25 (and your own setting), and the signal weights;
  - **Score this graph**: the canvas graph's feature vector and its score, split into imported, this
    install and steering, with the top contributing features;
  - **Export profile** and **Export everything**;
  - **Import…**, then Merge or Replace;
  - **Reset learned**, **Reset steering** or **Reset both**.

## The log and tracing (`src/taste/log.ts`)

Every lesson goes through `updateTaste(fn, { kind, ref })` (`store.ts`). That appends an entry to an
append-only log, which keeps the newest 1,000 entries. Each entry holds:

- the signal kind;
- a ref to what it was about:
  - the item (`saved:…`, `example:…`, `shader:…`, `node:…`) and its name;
  - the seed;
  - where it came from (evolve, surprise, deep, rate, nodes, files);
  - for an Evolve pick, the round and the pair (what was chosen over what);
  - for a rating, its value;
- the change it made to each weight (`d`);
- its change to the stage table.

**Why a trace adds up exactly.** An entry's `d[k]` is the weight's change across the whole update
(after − before), not only the gradient. So it includes the L2 decay that step applied to the weight. L2
only decays the weights a step touches, so no decay goes unrecorded. Therefore, always:

    w_local[k] = carried[k] + Σ entries d[k]

`carried` holds what isn't listed:

- entries that fell off the cap (folded in as they drop);
- weights learned before the log existed (a version-1 model migrates with all its weights carried);
- the rounding of each listed change to 1e-4 (the remainder goes to `carried` at once).

So a trace sums to its weight to floating-point precision. The tests check this after 60+ mixed
lessons. On the page, a trace shows:

- this install's part, the imported part and the steering part;
- totals by signal kind;
- each entry: its change, kind, ref and time (click to open);
- the "older than the log, or too small to list" remainder.

## Steering (`src/taste/steering.ts`, `src/taste/context.ts`)

"Your steering" sits on top of what was learned and is never mixed into it, so traces stay clean:

    score(graph) = imported · x + local · x + steering · x

- **The context box.** Free text such as "I like dark minimal pieces with lots of motion, no fBm, more
  code" is parsed on this device. The parser uses the Playfield language's own word matching
  (`src/lang/vocabulary.ts`: tokens, longest phrase first, a small edit distance for long words) over:
  - a synonym table: dark / bright, minimal / busy, moving / still, vivid / muted, contrast / soft,
    symmetric / asymmetric, new / familiar, code-heavy / node-based, 3D, particles, noise, organic,
    glow, tiles, waves, trails, blobs;
  - every technique and family in the patterns catalogue (`src/patterns/catalogue.ts`), by name and by
    id;
  - the Do bar's action words, as the families they make;
  - settings words with high / low ("high falloff", "speed slow");
  - shape words, as their node types.

  "no", "not", "less", "without", "avoid"… turn the next phrase round. Filler words ("I like", "pieces",
  "lots of") are skipped.

  Each phrase becomes a chip under the box. The chip shows the words it read and what they mean: green
  for "more of this", red for "less". Flip a chip or remove it; your edits survive changes to the text.
  Words it didn't understand are listed. A chip adds ±0.6 to each of its features.
- **Pins.** Boost (+1), avoid (−1) or ban (−3). Pin any feature from a learned row, or a family,
  technique or look feature from the picker. **A ban means the generator never picks it.**
  - In the inspired plan (`compose.ts` `planFor`), a lean of exactly 0 removes a banned stage choice,
    technique (by name), family, code (`code:yes`) or source.
  - Evolve's Refine never swaps one in.
  - Deep drops candidates with a banned feature when anything else is left.
- **Dials.**
  - **Exploration**: the share of ranked slots and fresh seeds that explore (default 25%).
  - **How strongly taste leans** Surprise, Deep and Evolve: 0–200%, where 0 is no lean at all. The
    generators use (learned + steering) × lean.
  - **Do bar suggestions**: the type-ahead and node-search nudge, on or off.

Steering applies through the existing bias path:

- `steeredBias(model, steering)` (`bias.ts`) for Surprise, Deep and Evolve (`EvolveOptions.steering`);
- `steeredModel()` (`store.ts`) for Deep's ranking, the why-chips and the Do bar.

Steering counts toward confidence as a few signals per feature, so it leans from the start.

## Portable profiles (`src/taste/portable.ts`)

A profile can move to another install, where the graphs, examples and shaders differ. It keeps what it
learned and keeps learning there.

**Two kinds of feature.**

- *Portable* features mean the same on every install:
  - technique and family ids;
  - stage choices named by technique, or Expression Block / Custom Function;
  - palette traits, and settings-range buckets by setting name;
  - code yes/no;
  - image look (`img:`, `look:`) and the image embedding (`emb:`);
  - node-type buckets (`nh:`: a fixed FNV hash of the node type's name, the same in every version);
  - example sources (`src:example:<key>`: an example's key is its stable id).
- *Local* features are install-specific:
  - sources that are your own graphs, shaders and presets (`src:saved:…`, `src:shader:…`);
  - stage choices named after your own GLSL functions;
  - ratings of your own items by id.

**Layers.** The learned model is the imported **profile** layer plus this install's **local** layer
(`combine`). A lesson is taken on the sum, so predictions use both. Its change is written to the local
layer only (`localAfter`). So:

- the imported prior is never changed by learning here;
- the log and its traces describe the local layer exactly;
- the page shows each preference's imported, local and steering parts.

**Dormant.** Imported local learning about an item that isn't here is kept dormant: it's shown "not on
this install" and counts for nothing. When the item appears, it wakes and joins the profile layer. The
item matches by id, or by content hash (`contentHash`: a graph's node types and settings, or GLSL text),
so a renamed copy matches too. Building Surprise's pool checks for this.

**The file** (`.playfield-taste`, JSON: `{ format: 'playfield-taste', version: 3, kind, … }`) holds:

- `profile`: the imported layer plus this install's portable learning, folded together additively
  (they're additive layers);
- `steering`: the context text, chips, pins and dials;
- `summary`: the summary at export, for reading the file;
- `log`: the signal log.

**Profile only** strips install-specific refs and deltas from the log. **Everything** keeps them, and adds
`local`: this install's own items' learning, with each item's content hash. On import, refs to items that
aren't here are marked foreign.

**Import** offers two modes:

- **Merge**, by evidence, per feature: w = (w₁·n₁ + w₂·n₂) / (n₁ + n₂), n = n₁ + n₂. Stage evidence and
  signal counts add. This install's own learning and log stay.
- **Replace**: the file's profile becomes the prior, and this install starts learning afresh on top.

Either way:

- the file's local learning goes dormant, or wakes at once if its items are here;
- its steering comes too.

Older files (the model alone) import as "everything".

**Sync later.** Accounts are licence-only today, so a file is the transport. `TasteFileV2` (`makeExport`,
`applyImport`) is the seam: an account sync would send the same object.

## Privacy

Everything stays on this device. The taste is one local-storage key, `shader-studio:taste`, versioned
together: `{ format: 'playfield-taste', version: 2, model, prior, dormant, log, steering }`. Here `model`
is the local layer. Version 1 (the model alone) migrates on read; a newer version is refused.

Like your other Playfield data, it travels only in profile ZIPs, backups and the `.playfield-taste` files
you export. Nothing is sent anywhere, and no cloud model is asked anything: the summary is templates, and
the context box is a word matcher. Reset forgets what was learned, your steering, or both.
