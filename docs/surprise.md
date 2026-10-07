# Surprise me: seeded randomness

Randomness is a good way to find ideas. Playfield's random buttons all use one seeded generator.
That makes every result repeatable: each surprise shows its **seed**, typing the seed back makes
the same result again, and a seed can be shared. Every surprise is **one undo step**. Its toast
offers **Reroll** (undo it and try a new seed) and **Undo**.

| Where | Control | What it makes |
| --- | --- | --- |
| 3D Scene Builder header | **Surprise me** · seed · Reroll | A whole scene: 2–6 shapes from the gallery, nested combines (smooth union, subtract, intersect with a good blend), modifiers now and then, a random look (surface, volumetric, glass, GI) with sky, fog and tone, harmonious colours, sometimes a coloured output, and a camera that frames it. |
| Scene Builder, Shapes → Add a shape | **Random shape** | One random shape with a random size, place, turn and colour, beside the selection. |
| Scene Builder inspector | 🎲 **Randomise this** | New settings for the selected shape (size, turn, colour, shine, its modifiers) or group (its blend). On the whole scene, a new look and camera. |
| Grid Rules header | **Surprise me** · seed · Reroll, **Keep the type** | A rule that stays alive, with a random start and colours (see below). |
| Agent Rules header | **Surprise me** · seed · Reroll | A rule set, its trail's decay and its colours (see below). |
| Node card | 🎲 Randomise | The card's free sliders, now inside their *interesting* ranges. |
| Canvas toolbar | 🎲 **Randomise all settings in this graph** (right-click: type a seed) | Every free slider on the level on screen, from one seed. |

## How a surprise stays interesting

- **Curated ranges.** A slider's legal range is what the shader accepts, and most of it looks bad.
  `lib/surprise/ranges.ts` lists, by parameter name, the part worth landing in. For example,
  Frequency 1–12 (log), Octaves 3–6, Radius 0.12–0.7, Falloff 2–20 (log), Density 0.15–0.6.
  It is always cut to the slider's range. A name with no entry gets a band round its default.
  A range you typed on a slider (a typed max, or both ways) is yours, so all of it is used. Bit
  masks and counters (Born on, Survive on, Reset) are never randomised.
- **The degenerate check.** The Scene Builder draws each surprise once at 96 × 64 and reads back
  the frame stats the node preview uses: the share of black pixels, the share clipped to white,
  and whether the frame is flat. A blank, blown-out or flat picture is rejected and the next seed
  is tried, up to four times. The seed shown is the one that made the result, so it reproduces
  without a retry.
- **Grid Rules** runs each candidate on a 48 × 48 CPU test board (`gridRules/cpu.ts`) for 60
  steps. It rejects a candidate that dies (under 0.3% of cells on), fills (over 85%) or, for
  Count and Stages, freezes. Count is biased toward the alive Life-like families: B3/S23 and its
  mutations, B36/S23-like rules, B3 with high survival (coral, maze), blobby B5678 annealers,
  sparks, von Neumann diamonds, and Larger-than-Life bands round Bosco's rule. Stages nudges a
  Generations preset. Smooth jitters Gray–Scott feed and kill round known spots, or picks
  diffusion or waves. Patterns and Blocks vary a preset's start, density and chances. After 40
  rejected candidates it falls back to Life.
- **Agent Rules** first picks a *walker kind* (the rule set's Kind, docs/agent-rules.md) and a
  template family of that kind:
  - **Trail followers** (Slime mold) come in three styles:
    - trackers;
    - flow drifters;
    - crowd-shy gatherers, which follow the trail and turn away where it is thick.
  - **Carriers** pulse between two states (Fireflies).
  - **Flocks, swarms, crowds and particles** start from their kind's template (Flock, Swarm,
    Crowd, Particles), with every strength, reach and timing scaled by 0.65–1.5 within its bounds.

  For trail followers it then sets the sensor angle (15–60°) and distance (0.015–0.06), turn,
  wander and speed. For every kind it sets the deposit (each rule's trail amount), the decay (the
  Trail field's Half-life, 0.03–0.3) and the colours (state colours and the trail's Stops
  Palette). About a third of the time, trail followers get a second species that follows or
  avoids the first one's trail. Every walker leaves trail, so a plain trail setup shows any kind.
  A 3D group gets 3D bands (sensors 0.1–0.2, speed 1–1.5).

## The API (`src/lib/surprise`)

Other features import from `src/lib/surprise` (the index re-exports everything). That includes the
shared language's `random`, `random(a..b)`, `seed=42` and "surprise me" lines.

```ts
import { makeRng, newSeed, seedFrom, interestingRange, sampleRange, randomValue,
  harmoniousPalette, withRetries, degenerateReason, frameStats } from '../lib/surprise';
```

### Seeds and the generator: `rng.ts`

- `newSeed(): number`: a fresh seed, 1 … 999 999. This is the only call that uses `Math.random`.
- `seedFrom(text | number): number | null`: a seed from what someone typed. A whole number is
  itself; a word hashes to a seed, so `seed=mossy` works. Empty text gives null.
- `deriveSeed(seed, attempt)`: the seed for retry `attempt` (0 is the seed itself).
- `makeRng(seed): Rng`, which has these methods:
  - `next()`: 0 ≤ x < 1.
  - `float(lo, hi)`.
  - `logFloat(lo, hi)`: spread evenly on a log scale.
  - `int(lo, hi)`: both ends included.
  - `chance(p)`.
  - `sign()`.
  - `pick(items)`.
  - `weighted([[item, weight], …])`.
  - `sample(items, n)`.
  - `shuffle(items)`.
  - `fork(label)`: an independent stream. Adding draws to one part of a generator doesn't
    reshuffle another; each node of a graph randomise has its own fork.
- `weightedChoice(items, r)`: weighted choice with your own 0–1 number.

### Ranges: `ranges.ts`

- `interestingRange(key, { min, max, step, def, int }, nodeType?)` returns
  `{ lo, hi, log, int, source }`, or `null` for a key that is never randomised. Lookup goes from
  most to least specific:
  1. `nodeType.key`;
  2. the key itself;
  3. the key without an axis or number suffix (`offsetX` → `offset`);
  4. its last word (`glowFalloff` → `falloff`);
  5. a band of ±35% of the range round the default;
  6. the middle 15–75% of the range.
- `sampleRange(range, rng)`: a value from it (log-spread or whole, as it says).
- `randomValue(key, legal, rng, nodeType?)`: both in one call.
- `registerInterestingRanges({ word: { lo, hi, log?, int?, full? } })`: add vocabulary. Use
  `full: true` for things where every value is as good as another (angles, hues, seeds).
- `INTERESTING_RANGES`, `NEVER_RANDOMISE`, `neverRandomise(key)`.

For `random(a..b)` written by the user, sample the user's range directly
(`rng.float(a, b)`). The curated table is for a bare `random`.

### Colours: `colour.ts`

- `harmoniousPalette(rng, n, { scheme?, sat?, light?, hue? })`: `n` colours from one scheme
  (analogous, complementary, triadic, split or mono).
- `randomColour(rng)`, `darkBackground(rng, hue?)`, `lightBackground(rng, hue?)`.
- `rampPalette(rng, n)`: dark to light, for palettes that colour a number.
- `hslToRgb(h, s, l)`.

### Is it worth showing: `degenerate.ts`

- `frameStats(rgba, w, h, every?)`: `{ clipped, black, flat, mean, spread }` from RGBA bytes,
  with the node preview's thresholds.
- `degenerateReason(stats, limits?)` returns `'blank'`, `'blown out'`, `'flat'` or `null`. The
  default limits are 97% black, 90% clipped, and a brightness spread under 0.012.
- `withRetries({ seed, tries = 4, make(rng, seed), judge?(value, seed) })` returns
  `{ value, seed, tries, rejected, ok }`. It tries `seed`, then `deriveSeed(seed, 1)`, and so on,
  while the judge returns a reason. `withRetriesAsync` does the same with a judge that awaits
  (a GPU read-back).
- `statsJudge(statsOf, limits?)`: a judge built from a function that returns frame stats (or
  null when it can't tell).

## Where the code lives

- `src/lib/surprise/`: the shared module, with its tests in `__tests__/surprise.test.ts`.
- `src/sceneBuilder/surprise.ts`: `surpriseScene`, `addRandomShape`, `randomiseItem`,
  `randomLook`, `randomCamera`.
- `src/components/sceneBuilder/surpriseActions.ts`: the GPU frame check (`sceneFrameStats`),
  undo and toasts.
- `src/gridRules/surprise.ts`: `surpriseGrid`, `gridCandidate`, `gridFate` (the CPU test board).
- `src/agentRules/surprise.ts`: `surpriseAgents`, `SURPRISE_KINDS`.
- `agentRules/storeActions.ts` `surpriseGroupRules`: rules, Trail field and palette in one undo step.
- `src/nodes/randomizeParams.ts`: the card's Randomize, using the interesting ranges, and
  `randomizedGraph` for the whole graph level.
- `src/components/surprise/`: `SurpriseBar` (the button, seed field and Reroll),
  `announceSurprise` (the toast), and the Grid, Agent and graph actions.
