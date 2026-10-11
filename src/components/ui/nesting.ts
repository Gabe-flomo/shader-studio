/**
 * nesting.ts — how a folding sub-section sits inside its section, one rule for the app: node cards (a vec3's own fold
 * inside a card section such as Splat Scene's Place › Position) and builder panels (a group inside a section). The
 * sub-section is stepped in by NEST_INDENT and its body hangs off a thin guide line, so the nesting reads at a glance.
 */
import type { CSSProperties } from 'react';

/** How far a nested sub-section steps in from its section's header, in px. */
export const NEST_INDENT = 12;

/**
 * The nested sub-section's box: stepped in, with a guide line down its left edge. `guide` is the line's colour; `from`
 * is where the parent section's own content starts (a node card's section header sits 12px in, its chevron's middle
 * at about 18).
 */
export function nestedSectionStyle(guide: string, from = 0): CSSProperties {
  return { marginLeft: from + NEST_INDENT, paddingLeft: 8, borderLeft: `1px solid ${guide}` };
}
