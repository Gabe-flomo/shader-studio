# Folder Organization

All five saved-asset panels — **Saved Graphs**, **Functions**, **Group Presets**, **Transform Vecs**, and **Expr Blocks** — share the same folder system. Tags have been removed; folders are the only organization tool.

---

## Creating a folder

Click **`+ Folder`** at the top of any panel. An inline text input appears in place — type a name and press Enter (or click the checkmark) to create it. Press Escape to cancel.

---

## Moving items into a folder

### Drag and drop

Drag any item card onto a folder header and release. The folder highlights while the card is held over it.

### Multi-select with Cmd+click

Hold **Cmd** (⌘) and click multiple item cards to select them. A **`Move N →`** button appears at the top of the panel. Click it, then pick a folder from the dropdown to move all selected items at once. Click anywhere outside to deselect.

---

## Collapsing and expanding

Click a folder header to collapse or expand its contents. Collapsed state is remembered per panel for the current session.

---

## Renaming and deleting a folder

**Right-click** a folder header to open a context menu with two options:

- **Rename** — replaces the header with an inline text input. Press Enter to confirm, Escape to cancel.
- **Delete** — removes the folder. Items inside are moved back to the top-level (unfoldered) list.

---

## Items without a folder

Items not assigned to any folder appear in an implicit top-level section above all folders. There is no "Uncategorized" header — they simply sit at the top.

---

## Tags removed

The `#` tag button that previously appeared on each card and the filter bar that showed active tags have been removed. Folders replace tags entirely. Existing saved assets retain any tag metadata in storage but it is no longer used or displayed.

## Saved graphs are projects with versions

A saved graph is one entry, however often it is saved. With a saved graph open (loaded from the list, or just saved), the top bar shows its name, its version and a dot for unsaved changes; **Save** writes the next version of that graph, with an optional note on what changed, instead of asking for a name. *Save as a new graph instead…* starts a separate one. With an example, an import or a new graph open, Save asks for a name, and a name that already exists adds a version to that graph rather than replacing it.

The version badge (v3) on a row, in the sidebar and in the Load menu, lists every version with its time and note. Open any of them to look at it or carry on from it; saving it makes it the newest version, and the versions after it stay in the list.

Storage: the newest version stays at `shader-studio:<name>` (with `version` and `note` fields), so everything that reads saved graphs is unchanged; earlier versions live under `shader-studio-versions:<name>` (`src/store/graphVersions.ts`). Each graph keeps its last 30 earlier versions, and if the browser's storage fills up the oldest are dropped first. The desktop app's disk copy (one file per graph) holds the newest version.

