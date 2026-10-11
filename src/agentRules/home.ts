/**
 * home.ts — Return home (a rule action, docs/agent-rules.md "Return home"), its maths in plain JS: the spring the
 * generated rule block runs (generate.ts `case 'home'`), for the tests and anything drawing it on the CPU. Pure.
 *
 * Each step, from `delay` seconds after birth (eased in over half a second):
 *   v ← v · mix(1, e^(−damping·dt), on) + on · strength · (home − p) · dt
 * then Move steps p ← p + v · dt (semi-implicit Euler: steady for strength·dt² well under 4).
 * Damping 2√strength settles without overshoot; less swings round home first.
 */
const smoothstep = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export interface HomeSpring { strength: number; damping?: number; delay?: number }

/** How much the spring pulls at this age (0 before the delay, 1 half a second after). */
export const homeOn = (o: HomeSpring, age: number) => ((o.delay ?? 0) > 0 ? smoothstep(o.delay!, o.delay! + 0.5, age) : 1);

/** One step: the new velocity and position. */
export function homeStep(pos: readonly number[], vel: readonly number[], home: readonly number[], o: HomeSpring, age: number, dt: number): { pos: number[]; vel: number[] } {
  const on = homeOn(o, age);
  const keep = 1 + (Math.exp(-Math.max(o.damping ?? 0, 0) * dt) - 1) * on;
  const v = vel.map((x, i) => x * keep + on * o.strength * (home[i] - pos[i]) * dt);
  return { vel: v, pos: pos.map((x, i) => x + v[i] * dt) };
}

/** Damping that settles a spring of this strength without overshoot (critical damping). */
export const criticalDamping = (strength: number) => 2 * Math.sqrt(Math.max(strength, 0));
