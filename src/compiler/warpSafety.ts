/**
 * warpSafety.ts — the march loop that survives stretched space (docs/warp-safety.md).
 *
 * A warp (twist, bend, displacement, fold) makes the scene's distance overstate how far a ray may
 * safely go, so rays jump through surfaces and the picture tears. This loop:
 *
 *   - learns the local stretch ("lip", 1 = a true distance) from how fast the distance shrinks,
 *     and (Careful/High) from the distance's gradient, and divides each step by it;
 *   - never steps further than Max step;
 *   - backs up with a halving search when a step lands inside a surface;
 *   - lets the stretch relax as the ray moves on, so grazing a twist doesn't starve the rest of the ray.
 *
 * Shared by the March Loop Group and the GI Lit March Group, surface and volumetric. The loop
 * leaves `<S>_lip` behind: the stretch where the ray ended, which shadow, bounce and reflection
 * rays from that point divide their own steps by (the Stretch output).
 */

export type WarpSafety = 'off' | 'auto' | 'careful' | 'high';

export function warpSafetyOf(v: unknown): WarpSafety {
  return v === 'auto' || v === 'careful' || v === 'high' ? v : 'off';
}

/** High runs twice the steps (shorter ones), so rays behind a tight twist still reach what is beyond it. */
export function safeMarchSteps(safety: WarpSafety, maxSteps: number): number {
  return safety === 'high' ? Math.min(512, maxSteps * 2) : maxSteps;
}

export interface SafeMarchOptions {
  /** The node's slug: every variable is `<S>_…`. */
  S: string;
  safety: Exclude<WarpSafety, 'off'>;
  maxSteps: number;
  /** GLSL for the Step Scale (surface mode only). */
  stepScale: string;
  /** GLSL for Max step. */
  maxStep: string;
  volumetric: boolean;
  /** GLSL for the volumetric minimum step. */
  passthrough: string;
  /** The ray's position at distance t (curved space aware). */
  at: (t: string) => string;
  /** Multiplies a step (curved space), '' when flat. */
  stepFactor: (t: string) => string;
  /** GLSL for how far a ray may go. */
  end: string;
  /** The scene's distance at a raw ray position (warp body applied): `scene(warp(raw, t))`. */
  sample: (raw: string, t: string) => string;
  /** The same distance without side effects (the body's accumulators untouched), for the extra probes. */
  probe: (raw: string, t: string) => string;
  /** Declarations before the loop (accumulators, curved space, jitter). */
  prelude: string[];
}

export function safeMarchLines(o: SafeMarchOptions): string[] {
  const { S, safety, volumetric } = o;
  const high = safety === 'high';
  const steps = safeMarchSteps(safety, o.maxSteps);
  const measure = safety === 'careful' || high ? [
    // The gradient's length is how much space is stretched right here: divide it out (tetrahedron differences).
    `        {\n`,
    `            float ${S}_h = max(0.0015, 0.0005 * ${S}_t);\n`,
    `            vec2  ${S}_k = vec2(1.0, -1.0);\n`,
    `            vec3  ${S}_g = ${S}_k.xyy * ${o.probe(`${S}_rp_raw + ${S}_k.xyy * ${S}_h`, `${S}_t`)}\n`,
    `                       + ${S}_k.yyx * ${o.probe(`${S}_rp_raw + ${S}_k.yyx * ${S}_h`, `${S}_t`)}\n`,
    `                       + ${S}_k.yxy * ${o.probe(`${S}_rp_raw + ${S}_k.yxy * ${S}_h`, `${S}_t`)}\n`,
    `                       + ${S}_k.xxx * ${o.probe(`${S}_rp_raw + ${S}_k.xxx * ${S}_h`, `${S}_t`)};\n`,
    `            ${S}_lip = clamp(max(${S}_lip, length(${S}_g) / (4.0 * ${S}_h)), 1.0, 16.0);\n`,
    `        }\n`,
  ] : [];
  const learn = [
    // The distance shrank faster than the ray moved: space is stretched about that much here.
    `        if (${S}_i > 0) ${S}_lip = clamp(max(${S}_lip, (${S}_prevD - ${S}_d) / max(${S}_t - ${S}_prevT, 1e-5)), 1.0, 16.0);\n`,
    `        ${S}_prevT = ${S}_t;\n`,
    `        ${S}_prevD = ${S}_d;\n`,
  ];
  const shorter = high ? ' * 0.7' : '';
  return [
    ...o.prelude,
    `    float ${S}_hit = 0.0;\n`,
    `    int   ${S}_si  = ${volumetric ? 0 : steps};\n`,
    // Lip: how stretched space looks here (1 = a true distance); prevT/prevD: the last sample.
    `    float ${S}_lip = 1.0;\n`,
    `    float ${S}_prevT = ${S}_t;\n`,
    `    float ${S}_prevD = 1e9;\n`,
    `    for (int ${S}_i = 0; ${S}_i < ${steps}; ${S}_i++) {\n`,
    `        vec3  ${S}_rp_raw = ${o.at(`${S}_t`)};\n`,
    `        float ${S}_d  = ${o.sample(`${S}_rp_raw`, `${S}_t`)};\n`,
    // The stretch is local: let it relax as the ray moves on, so a ray that grazed a twist still reaches the floor.
    `        ${S}_lip = max(1.0, ${S}_lip * ${high ? '0.95' : '0.85'});\n`,
    ...measure,
    ...(volumetric ? [
      // Volumetric: no surface to stop at; the stretch only keeps the ray from skipping over the medium.
      ...learn,
      `        ${S}_t += max(min(${S}_d${shorter} / ${S}_lip, ${o.maxStep}), ${o.passthrough});\n`,
    ] : [
      // A step that landed inside a surface: back up between the last two samples with a halving search.
      `        if (${S}_d < 0.0 && ${S}_i > 0) {\n`,
      `            float ${S}_lo = ${S}_prevT;\n`,
      `            float ${S}_hi = ${S}_t;\n`,
      `            for (int ${S}_b = 0; ${S}_b < ${high ? 10 : 6}; ${S}_b++) {\n`,
      `                float ${S}_mid = 0.5 * (${S}_lo + ${S}_hi);\n`,
      `                if (${o.probe(o.at(`${S}_mid`), `${S}_mid`)} < 0.0) ${S}_hi = ${S}_mid; else ${S}_lo = ${S}_mid;\n`,
      `            }\n`,
      `            ${S}_t = ${S}_hi;\n`,
      `            ${S}_hit = 1.0; ${S}_si = ${S}_i; break;\n`,
      `        }\n`,
      // The hit test widens with distance, so far surfaces stop costing extra steps.
      `        if (${S}_d < ${high ? '0.0002' : '0.0005'} * max(1.0, ${S}_t)) { ${S}_hit = 1.0; ${S}_si = ${S}_i; break; }\n`,
      ...learn,
      `        ${S}_t += min(${S}_d * ${o.stepScale}${shorter} / ${S}_lip, ${o.maxStep})${o.stepFactor(`${S}_t`)};\n`,
    ]),
    `        if (${S}_t > ${o.end}) { ${S}_si = ${S}_i; break; }\n`,
    `    }\n`,
  ];
}

/** The Steps heatmap: dark where rays found their way quickly, yellow-white where they struggled. */
export function stepsHeatmap(S: string): string {
  return `    ${S}_color = clamp(vec3(1.6, 1.0, 0.35) * ${S}_iter * 1.5 - vec3(0.0, 0.25, 0.1), 0.0, 1.0) + vec3(0.04, 0.04, 0.12) * (1.0 - ${S}_iter);\n`;
}
