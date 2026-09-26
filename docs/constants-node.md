# The Constants card

One card for a graph's named values, each an output. An entry is a number, a
pair (`vec2`), a triple (`vec3`) or a colour, with a name.

**Fixed or live.** An entry starts *fixed*: a true constant, baked into the
shader as a literal, with no slider, not offered to keyframes or Play, and
changed only in the card's editor (the `#` button, or double-click the fixed
rows). Turn its *live* switch on and it becomes a value you can slide on the
card, keyframe, and hand to Play as a control; the shader then reads it as a
uniform, so dragging never recompiles. Turn it off again and it's a constant
once more.

**No inputs.** Nothing upstream can rewrite an entry; that's the point. To
compute a value, use a node.

**Where it comes from.** Add one from Sources, or paste a shader on the
Convert page: the shader's `const`s and any variable initialised with a number
(`float ang = 5.0;`) arrive as fixed entries under their own names, wired to
where the shader read them. Anonymous numbers inside expressions become the
using node's own slider instead.

**In the file.** `params.items` holds the entries; each live entry's value is a
param under its key (`speed`, or `size_x`/`size_y` for a pair, an `[r, g, b]`
array for a colour), the way any slider is stored, so saved graphs, Play files
and keyframes treat them as ordinary params. Fixed entries live only in
`items`.
