/**
 * Plans and entitlements: who is signed in, on which plan, and the one check
 * every gate goes through, `can(feature)`. See docs/accounts-and-plans.md
 * (sections 4 and 7) and docs/sign-in-gate.md.
 *
 * Where the plan comes from is not this module's business: today the
 * sign-in gate (src/auth/gate.ts) calls `setSession`; later the licence
 * service's token check does the same (see `PlanSource`). The gates only ever
 * ask `can()`, so swapping the source touches nothing else.
 *
 * Nothing here is protection: it all runs in the browser. It decides what the
 * app offers, not what a determined person can reach.
 */
import { create } from 'zustand';

export type Plan = 'free' | 'pro';

/**
 * Where the current plan was decided:
 *   gate     the local sign-in gate (a username + password from gateUsers.json)
 *   open     no gate (no users configured, or VITE_GATE=off): everyone is Pro
 *   licence  the licence service's signed token (not built yet: milestone 1)
 */
export type PlanSource = 'gate' | 'open' | 'licence';

export type Session =
  | { status: 'signed-out' }
  | { status: 'signed-in'; user: string; plan: Plan; source: PlanSource };

/**
 * Everything that differs between Free and Pro, with the plan it needs.
 * Free features are listed too, so a call site can ask about them the same way
 * (and moving one across is a one-line change here).
 */
export const FEATURES = {
  // ── Free ──
  studio: { plan: 'free', label: 'The Studio' },
  present: { plan: 'free', label: 'Present' },
  glsl: { plan: 'free', label: 'The GLSL page' },
  builder: { plan: 'free', label: 'The Function Builder' },
  learn: { plan: 'free', label: 'Learn and the examples' },
  'nodes.import': { plan: 'free', label: 'Importing node packs' },
  'play.controls': { plan: 'free', label: 'Play controls and mappings from the mouse, keys and audio' },
  // ── Pro ──
  'play.layers': { plan: 'pro', label: 'Play layers (shapes, particles, text, camera…), their actions and groups' },
  'play.sources': { plan: 'pro', label: 'Every Play source: MIDI, OSC, hands, LFOs, noise, clocks, sensors, data, gamepads, tilt' },
  'play.backgrounds': { plan: 'pro', label: 'Play backgrounds (images, video, gradients) and the background queue' },
  'play.finish': { plan: 'pro', label: 'The Finish stack: colour grading, lens, CRT and film effects, camera shake and time displacement over the whole picture' },
  'play.takes': { plan: 'pro', label: 'Recording performances as takes and rendering them frame by frame' },
  'play.midiFile': { plan: 'pro', label: 'Playing a MIDI file into Play' },
  convert: { plan: 'pro', label: 'Convert: GLSL into nodes' },
  'export.hires': { plan: 'pro', label: '2K and 4K video and image export' },
  'export.website': { plan: 'pro', label: 'Putting it on a website' },
  'files.everything': { plan: 'pro', label: 'Download everything, and downloading chosen items as a ZIP' },
  'files.install': { plan: 'pro', label: 'Installing a profile' },
  'nodes.publish': { plan: 'pro', label: 'Publishing Custom Functions, Expression Blocks and groups as nodes' },
  'nodes.pack': { plan: 'pro', label: 'Making node packs' },
} as const satisfies Record<string, { plan: Plan; label: string }>;

export type Feature = keyof typeof FEATURES;

export const ALL_FEATURES = Object.keys(FEATURES) as Feature[];

/** The one entitlement rule. Signed out can do nothing (the gate keeps the app from mounting anyway). */
export function canOn(plan: Plan | null, feature: Feature): boolean {
  if (!plan) return false;
  return plan === 'pro' || FEATURES[feature].plan === 'free';
}

/** Pricing shown on the Pro sheet. One place to change it. */
export const PRO_PRICE = '$128 once or $8/month';
/** Where "Get Pro" goes. A placeholder until the store site exists (decision 7). */
export const PRO_STORE_URL = 'https://playfield.example/pro';

interface PlanState {
  session: Session;
  setSession: (s: Session) => void;
}

export const usePlan = create<PlanState>(set => ({
  // Open until something says otherwise: tests and tools that never mount the gate see Pro.
  session: { status: 'signed-in', user: '', plan: 'pro', source: 'open' },
  setSession: session => set({ session }),
}));

export function currentPlan(): Plan | null {
  const s = usePlan.getState().session;
  return s.status === 'signed-in' ? s.plan : null;
}

/** Does the current plan include this? Every gate asks this, and only this. */
export function can(feature: Feature): boolean {
  return canOn(currentPlan(), feature);
}

/** `can` for components: re-renders when the plan changes. */
export function useCan(feature: Feature): boolean {
  return usePlan(s => canOn(s.session.status === 'signed-in' ? s.session.plan : null, feature));
}

/** The current plan for components (null when signed out). */
export function usePlanName(): Plan | null {
  return usePlan(s => (s.session.status === 'signed-in' ? s.session.plan : null));
}

// ── The Pro sheet ───────────────────────────────────────────────────────────

/** Whether the Pro sheet is open, and which locked feature it is explaining (null = Pro in general). Rendered by ProSheetHost. */
export const useProSheet = create<{ open: boolean; feature: Feature | null }>(() => ({ open: false, feature: null }));

export function openProSheet(feature: Feature | null = null): void { useProSheet.setState({ open: true, feature }); }
export function closeProSheet(): void { useProSheet.setState({ open: false, feature: null }); }

/**
 * For click handlers: true when the plan includes `feature`; otherwise opens
 * the Pro sheet about it and returns false. `if (!requireFeature('convert')) return;`
 */
export function requireFeature(feature: Feature): boolean {
  if (can(feature)) return true;
  openProSheet(feature);
  return false;
}
