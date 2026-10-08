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

It also has **Export**, **Import** and **Reset my taste**.

## Privacy

Everything stays on this device. The model is one local-storage key, `shader-studio:taste`. It is
versioned (`{ format: 'playfield-taste', version: 1, model }`), and a file from a newer version is
refused. Like your other Playfield data, it travels only in profile ZIPs and backups you make. Nothing
is sent anywhere, and no cloud model is asked anything. Reset my taste removes the key.
