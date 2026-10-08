# Experiments retired 2026-10-08: generation and taste

Between 2026.10.71 and 2026.10.75 we tried letting the app generate for you and learn what you like.
They were tried and mostly removed. What went, what stayed and why.

## Removed

- **Whole-graph "inspired by" Surprise** (#613): built a graph from 2-3 sources' fragments, with a GPU
  check and a toast naming the sources. The Do bar's Surprise is a random line of the language again.
- **Deep mode and its scoring** (#614): drew up to 16 candidates small and ranked them on cheap image
  metrics. Nothing kept needs it.
- **Evolve** (#616): picking between surprises round after round.
- **The taste engine** (`src/taste`, #616 and #618): a local model of what you like, rating buttons
  (saved graphs, examples, GLSL shaders, the Palette node, Patterns technique cards), taste nudging of
  Surprise, type-ahead and node search, implicit signal recording, the Do bar's taste panel, and the
  Taste page in Files (steering, signal log, portable profiles).
- **Taste wiring of the image model** (#621): looks in the taste features, steering words by look, the
  examples' look gallery.

Stored data is not read any more. At start-up the app removes `shader-studio:taste`,
`shader-studio:taste-page:open`, `surprise:deep` and the looks gallery (IndexedDB `shader-studio-looks`).

## Kept

- **The Do bar's restyle** (#614): one input row, help behind the info button.
- **‹ ›** for stepping through a few random lines (now cheap: just seeds, nothing drawn or scored).
- **Pattern discovery** (`src/patterns`, the Patterns tab), Show as commands, the language.
- **The image model** (`src/imageModel`, docs/image-model.md): runtime, worker, bundled desktop files,
  download and status. Its status and on/off toggle moved to Settings, App settings, Image model.
- **Surprise "a little inspired by"** your graphs: word counts from the examples and saved graphs
  nudge the random line's word choices (docs/surprise.md).

## Why

Generated results and learned taste added a lot of machinery, and the results did not feel better than
a good random line you can read and edit. Local models will be used for explanations and suggestions
instead, which is what the kept image model is ready for.
