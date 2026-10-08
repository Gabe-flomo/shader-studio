# Worked examples in step-by-steps

When a line's **Step by step** is open, every step shows real numbers next to its words:

- **"= 1.8"**: the step's value, worked out on the CPU with sample values for the names the line reads (`src/lib/glslPatterns/worked.ts`, using the explainer's evaluator).
- **A small range bar**: the step's spread across the picture, from many samples of each input over its typical range, with a dot where the sample sits. `log(home)` with home from 1 to 10000 runs 0 to 9.2, and the bar shows it.

The **With** row above the steps holds the sample values: `angle = 0.5`, `home = 420`, `iTime = 2`. Click one and type a new value (a vector as `0.3, 0.2`); every step updates. Reset puts the defaults back.

Defaults come from the name and type: `t` / `time` / `iTime` is 2 seconds (range 0–10), `uv` / `p` / `pos` a position (−1–1), `col` / `color` a colour (0–1), `d` / `dist` a distance, a name whose range the explainer knows uses that range, and anything else 0.5 (0–1). Hover a field for its range and why.

Steps the evaluator can't compute (a texture read, your own function) show no number.
