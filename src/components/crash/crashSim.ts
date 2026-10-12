import { create } from 'zustand';

/** The dev helper's "js-fatal" (dev/simulateCrash.ts): the next render throws inside CrashBoundary. */
export const useCrashSim = create<{ bomb: boolean }>(() => ({ bomb: false }));
