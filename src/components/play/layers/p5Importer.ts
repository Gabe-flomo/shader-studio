/**
 * The p5.js importer (src/play/p5import, with acorn), loaded on first use so
 * the app does not carry it until someone imports a sketch.
 */
import { useEffect, useState } from 'react';
import type * as P5I from '../../../play/p5import';

export type Importer = typeof P5I;
let importerPromise: Promise<Importer> | null = null;
/** The importer (and acorn with it), loaded once, on first use. */
export function loadP5Importer(): Promise<Importer> {
  if (!importerPromise) importerPromise = import('../../../play/p5import');
  return importerPromise;
}
/** The importer once it has loaded (null until then). */
export function useP5Importer(): Importer | null {
  const [mod, setMod] = useState<Importer | null>(null);
  useEffect(() => { let on = true; loadP5Importer().then(m => { if (on) setMod(m); }, () => {}); return () => { on = false; }; }, []);
  return mod;
}

