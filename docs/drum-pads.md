# Drum pads → Sampler

*18 Oct 2026.* The Drum pads layer is now the **Sampler** layer's **Drum view**: see [sampler.md](sampler.md) (and [sampler-plan.md](sampler-plan.md) for the Ableton research behind it).

Setups with a Drum pads layer (`kind: 'drumpad'`) open as a Sampler in its Drum view with every pad, number and setting as it was, and sound the same. Pad numbers keep their names (`pad3_pitch`), so controls, mappings, conditions and takes on them keep working. Kits (Presets → Drum kits) are the Drum view's kits.

## Sample index

*Added 28 Sep 2026; unchanged in the Sampler's Drum view.* A kit has a **Sample index** (a layer number, so it maps,
increments and records): a hit on a pad plays the sound of the pad *Index*
places further on among the pads that have sounds, wrapping round. Press the
same pad while Index rises and it walks through every sound; different pads
start at different places. **Index mode** picks how: *Index* (its place plus
Index), *Random* (any pad with a sound, seeded so a take repeats it), or
*Index ± spread* (its place plus Index plus a random step of up to **Index
spread** pads either way). Step Index from a beat, a signal (a particle's
`born`), or an Increment to shuffle a kit live. The pad you hit still lights;
takes record which pad's sound played (`slot`), so a render matches the take.
`play/kit/drumPads.js` (`dpSlots`, `dpPickPad`, `dpHash01`), picked through
`play/kit/sampler.js` `smHits`, the same in website exports. The Audio
engine's **Sample player** has the same Sample index over its zones
(docs/audio-engine.md, "Sample index (the sample player)").
