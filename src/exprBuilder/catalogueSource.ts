/**
 * catalogueSource.ts — the catalogue the builder window reads: the live one (the prebuilt
 * examples plus the user's own code, liveMoves.ts), else the prebuilt one alone when the Code
 * explorer can't start here, else the generated moves. Tests set their own.
 */
import { liveCatalogue } from './liveMoves';
import { loadPrebuiltCatalogue } from './exampleMoves';
import { activeCatalogue, type Catalogue } from './moves';

let override: Catalogue | null = null;

/** Use this catalogue instead (tests); null goes back to the live one. */
export function setBuilderCatalogue(cat: Catalogue | null): void { override = cat; }

export async function builderCatalogue(): Promise<Catalogue> {
  if (override) return override;
  try {
    return await liveCatalogue();
  } catch {
    return (await loadPrebuiltCatalogue()) ?? activeCatalogue();
  }
}
