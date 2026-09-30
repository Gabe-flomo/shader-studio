# The layer contract

Every Play layer is described the same way (`src/play/layerPorts.ts`,
`layerPorts(layer)`), built from the tables that already say what each kind
does, so nothing new is stored:

| Part | What it is | From |
| --- | --- | --- |
| **props** | Its numbers. Each is an input (a mapping can drive it) and an output (a condition can watch it: `layer:<id>::<key>`). | `LAYER_NUMERIC_PROPS` (`layerNumericProps`) |
| **buttons** | What can press it: Burst, Next, Show… and a script's own buttons. | `ACTIONS_FOR` (`actionsForLayer`) |
| **readings** | What it measures right now: hover, fill, speed, alive, picture… A condition watches one as `read:<id>::<read>`. | `SENSOR_READS_FOR` (`sensorReadsFor`), without Distance (a condition reaches that as `dist:A|B`) |
| **events** | The signals it can send, each with the layer field naming the signal: particles' Born and Died (and Split, Full, Annihilate, Cleared in Multiply), agents' Born and Died, a relationship's Catch. | `layerEvents` |
| **position** | Whether its centre is an anchor (distances, proximity, position mappings). | `ANCHOR_KINDS` |

Readings are 0 to 1 except the counts (Born this step, Died this step): a
percent condition on those uses the range seen so far (`readingRange`).

**Where it shows.** Each layer's editor has an **Accepts and emits** section
(`LayerPortsView.tsx`): its numbers and buttons; what it measures, each with
a live meter, **Map…** and **Signal** (a signal when it crosses the middle);
each event with the signal it sends (or **New**); and its position. The
condition value picker lists every layer's readings under **Layer readings**,
the + menu's Layers section reads them from here, and the Signals page's
When lists a layer's events (Born and Died were missing before).

**Website exports** read `read:` paths from the page's own sensors, the same
way the app does.
