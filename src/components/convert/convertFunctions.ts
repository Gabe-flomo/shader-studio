/**
 * The Convert page's link to the Functions library, both ways:
 *
 *   - `pastedFunctions`: the helper functions in the pasted shader, found the
 *     way the GLSL page's Discover functions finds them, for its Functions
 *     pane (every one is listed; one that reads the paste's globals says why
 *     it can't be saved).
 *   - `libraryForConversion`: the saved presets in the shape the converter
 *     takes, so a helper the person already saved becomes that saved node.
 */
import { discoverFunctions, type DiscoverResult } from '../../glsl/discover';
import type { LibraryFunction } from '../../glslToGraph';
import type { CustomFnPreset } from '../../types/customFnPreset';

/** The source id the Functions pane gives the paste. */
export const PASTE_SOURCE_ID = 'convert:paste';

export function pastedFunctions(code: string): DiscoverResult {
  if (!code.trim()) return { matches: [], total: 0, duplicates: new Map() };
  return discoverFunctions([{ id: PASTE_SOURCE_ID, name: 'the pasted shader', code }], { allowGlobals: true });
}

export function libraryForConversion(presets: readonly CustomFnPreset[]): LibraryFunction[] {
  return presets.map(p => ({ id: p.id, label: p.label, comment: p.comment, inputs: p.inputs, outputType: p.outputType, body: p.body, glslFunctions: p.glslFunctions }));
}
