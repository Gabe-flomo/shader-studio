/**
 * nouns.ts — the words for what a value is, one table for the language's type checks, the
 * suggestions' kinds and the explainer's roles (docs/playfield-language-plan.md D16): "a distance",
 * "a colour", "a space (UV)", "an angle"… A Do… bar refusal, a builder's type check and the
 * explainer all say the same noun for the same thing.
 */
export const VALUE_NOUNS = {
  distance: 'a distance', mask: 'a mask', colour: 'a colour', space: 'a space (UV)', texture: 'a texture', scene3d: '3D', scalar: 'a number',
  value: 'a number', angle: 'an angle', time: 'a time', direction: 'a direction', cell: 'a cell', unknown: 'a value',
} as const;

export type ValueNoun = keyof typeof VALUE_NOUNS;

/** The noun for a kind or role. */
export const nounOf = (k: string): string => (VALUE_NOUNS as Record<string, string>)[k] ?? `a ${k}`;
