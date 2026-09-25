/**
 * noteRefs.ts — links inside Play notes. A link is written `[[layer:<id>]]`
 * or `[[control:<id>]]`: dragging a layer (or a control) onto the notes
 * inserts one, and the notes show it as a chip with the thing's current
 * name. Clicking the chip opens it (the Layers tab at that layer, or the
 * control in the panel).
 */
export type NoteRefKind = 'layer' | 'control';

/** The drag-and-drop type layer and control rows put on the data transfer. */
export const NOTE_REF_TYPE = 'application/x-shader-studio-ref';

export const noteRef = (kind: NoteRefKind, id: string) => `[[${kind}:${id}]]`;

/** Matches one link; group 1 is the kind, group 2 the id. */
export const NOTE_REF_RE = /\[\[(layer|control):([A-Za-z0-9_-]+)\]\]/g;
