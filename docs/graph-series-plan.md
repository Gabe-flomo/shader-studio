# Graph series: versions as major.minor (plan)

**Status:** plan only, nothing built. Asked for 2026-10-08.

## The idea

It works like the user's perfume app. A saved graph is a **series** (an idea), not a pile of separately named copies. Each save is an iteration numbered **major.minor**:

- **Curves 2.3** is the second family (major 2) of the Curves idea, third tweak in that family (minor 3).
- **Minor**: a small tweak on the current family (2.3 → 2.4).
- **Major**: a new direction growing out of the idea (2.3 → 3.0).
- **New graph**: a different idea, so a new series (Name 1.0).

Saving asks exactly that: **Minor** (default, Enter), **Major**, or **New graph**. One line in the save form explains it: "Minor for a tweak, Major for a new direction, New graph for a different idea."

## What exists today

- `src/store/graphVersions.ts` already makes every saved graph a project. The newest version lives at `shader-studio:<name>` with an integer `version`; up to 30 earlier ones live in `shader-studio-versions:<name>`.
- `GraphVersions.tsx`: `SaveGraphForm` (save the next version, or "Save as a new graph") and `VersionsButton` (open any version; saving an older one makes it the newest).
- The top bar's name chip (#689) opens `SaveGraphForm`.

## Plan

1. **Data.** Add `major` and `minor` next to `version` on each stored version. Old graphs map as `version n` → `1.(n−1)`, so v1 is 1.0 and v4 is 1.3. `version` stays as a running count, so nothing that reads it breaks.
2. **Save form.**
   - Three buttons: **Minor** (primary), **Major** and **New graph**.
   - A preview of the number each one gives ("→ 2.4", "→ 3.0", "→ new series").
   - The note field stays.
   - An untitled graph asks for a name, and starts at 1.0.
3. **Saving from an older version.** You open 2.1 while 2.4 exists, tweak it, and save:
   - Minor gives 2.5, the newest in family 2.
   - Major gives the next free major.
   - The history keeps everything, so no branch is lost.
4. **Versions list.** Grouped by major (Family 1, Family 2…), newest first inside each. Rename a family ("2: warmer palette") with an optional label per major.
5. **Name chip.** Shows "Curves 2.3" with the dirty dot.
6. **Export.**
   - `.playfile` carries the series: all versions, or the current one (a choice in Export).
   - "Load a version" works from Files.
   - A `.playfile` with a series imports as a series.
7. **Cap.** 30 versions is too few for a series. Make it per series (say 200), still dropping the oldest *minor* versions first and never a family's first or latest.
8. **Later (Play):** a layer that cycles through a series' versions (majors, or one family's minors) as backgrounds: "pattern stacking" over iterations of one idea.

## Questions for the user

1. **Major numbering:** should a new major start at x.0 (3.0) or x.1?
2. **Saving over a version:** should it ever replace a version in place, or is every save a new number? The plan says always a new number; "Revert to 2.1" makes 2.5 a copy of 2.1.
3. **History cap:** keep everything (storage permitting), or cap?
4. **Example graphs:** should opening an example and saving start a new series named after it ("Curves (from example) 1.0")?
5. **Where the series lives in Files:** a "Series" view with the families folded, or the current graphs list with a version column?
