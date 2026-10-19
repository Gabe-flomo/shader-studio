/**
 * Voxels (docs/march-voxels.md): a ray that walks a cube grid cell by cell (Amanatides & Woo), with a
 * sphere-trace jump through empty space. A cell is solid where the scene is inside at its centre.
 *
 * One walk, shared by every loop that offers Voxels: the March Loop's camera ray, and the GI Lit March
 * Group's camera ray plus its shadow, bounce and reflection rays (so its shadows and reflections are cubes too).
 */

export interface VoxelWalk {
  /** Variable prefix: `${prefix}_t`, `${prefix}_hit`, `${prefix}_si`, `${prefix}_vc` (the cell), `${prefix}_vn` (the face normal). */
  prefix: string;
  /** Ray origin and direction (GLSL expressions). */
  ro: string;
  rd: string;
  /** Loop length (a whole number). */
  steps: number;
  /** Where the walk gives up (a GLSL float). */
  maxDist: string;
  /** The voxel size variable to declare (`${prefix}_vs`) from this expression. */
  size: string;
  /** The scene's distance at a point (the cell centre, after `warp`). */
  sample: (pos: string) => string;
  /** Optional: where a raw cell centre is measured, for the ray's distance so far (the March Loop body's warps). */
  warp?: (centre: string, t: string) => string;
  /** Extra lines for the loop's start (accumulators, …). */
  prelude?: string;
}

/** The walk's lines: after them, `${prefix}_hit` is 1 on a solid cell, `${prefix}_t` the distance to its face. */
export function voxelWalkLines(w: VoxelWalk): string[] {
  const P = w.prefix;
  return [
    w.prelude ?? '',
    `    float ${P}_t   = 0.0;\n`,
    `    float ${P}_hit = 0.0;\n`,
    `    int   ${P}_si  = ${w.steps};\n`,
    `    float ${P}_vs  = max(${w.size}, 0.002);\n`,
    `    vec3  ${P}_vd  = ${w.rd} + vec3(equal(${w.rd}, vec3(0.0))) * 1e-6;\n`,
    `    vec3  ${P}_vst = sign(${P}_vd);\n`,
    `    vec3  ${P}_vdt = ${P}_vs / abs(${P}_vd);\n`,
    `    vec3  ${P}_vn  = vec3(0.0, 1.0, 0.0);\n`,
    `    vec3  ${P}_vc  = floor(${w.ro} / ${P}_vs);\n`,
    `    vec3  ${P}_vtm = ((${P}_vc + max(${P}_vst, 0.0)) * ${P}_vs - ${w.ro}) / ${P}_vd;\n`,
    `    for (int ${P}_i = 0; ${P}_i < ${w.steps}; ${P}_i++) {\n`,
    // The scene at this cell's centre: inside, the cell is solid.
    `        vec3  ${P}_rp_raw = (${P}_vc + 0.5) * ${P}_vs;\n`,
    ...(w.warp ? [`        vec3  ${P}_rp = ${w.warp(`${P}_rp_raw`, `${P}_t`)};\n`] : []),
    `        float ${P}_d  = ${w.sample(w.warp ? `${P}_rp` : `${P}_rp_raw`)};\n`,
    `        if (${P}_d < 0.0) { ${P}_hit = 1.0; ${P}_si = ${P}_i; break; }\n`,
    // Far from anything: every cell within d − 1.74 voxels of this centre is empty, so jump ahead.
    `        if (${P}_d > 2.5 * ${P}_vs) {\n`,
    `            ${P}_t += ${P}_d - 1.75 * ${P}_vs;\n`,
    `            ${P}_vc = floor((${w.ro} + ${w.rd} * ${P}_t) / ${P}_vs);\n`,
    `            ${P}_vtm = ((${P}_vc + max(${P}_vst, 0.0)) * ${P}_vs - ${w.ro}) / ${P}_vd;\n`,
    `        } else if (${P}_vtm.x < ${P}_vtm.y && ${P}_vtm.x < ${P}_vtm.z) {\n`,
    `            ${P}_t = ${P}_vtm.x; ${P}_vc.x += ${P}_vst.x; ${P}_vtm.x += ${P}_vdt.x; ${P}_vn = vec3(-${P}_vst.x, 0.0, 0.0);\n`,
    `        } else if (${P}_vtm.y < ${P}_vtm.z) {\n`,
    `            ${P}_t = ${P}_vtm.y; ${P}_vc.y += ${P}_vst.y; ${P}_vtm.y += ${P}_vdt.y; ${P}_vn = vec3(0.0, -${P}_vst.y, 0.0);\n`,
    `        } else {\n`,
    `            ${P}_t = ${P}_vtm.z; ${P}_vc.z += ${P}_vst.z; ${P}_vtm.z += ${P}_vdt.z; ${P}_vn = vec3(0.0, 0.0, -${P}_vst.z);\n`,
    `        }\n`,
    `        if (${P}_t > ${w.maxDist}) { ${P}_si = ${P}_i; break; }\n`,
    `    }\n`,
  ];
}

/**
 * Voxel ambient occlusion for the face a walk stopped on (`${S}_vc` solid, `${S}_vn` its face): how many of the
 * eight cells round the empty cell in front of the face are solid, weighted by how near the hit point is to each
 * (the classic block-game corner shading). Declares `${S}_ao` (1 = open, lower = tucked into a corner).
 */
export function voxelAoLines(S: string, hp: string, solid: (cell: string) => string): string[] {
  return [
    `    vec3  ${S}_aoN  = ${S}_vn;\n`,
    `    vec3  ${S}_aoE  = ${S}_vc + ${S}_aoN;\n`,
    `    vec3  ${S}_aoU  = abs(${S}_aoN.x) > 0.5 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);\n`,
    `    vec3  ${S}_aoV  = abs(cross(abs(${S}_aoN), ${S}_aoU));\n`,
    `    vec3  ${S}_aoF  = fract(${hp} / ${S}_vs);\n`,
    `    vec2  ${S}_aoUV = vec2(dot(${S}_aoF, ${S}_aoU), dot(${S}_aoF, ${S}_aoV));\n`,
    `    vec4  ${S}_aoS  = vec4(${solid(`${S}_aoE + ${S}_aoU`)}, ${solid(`${S}_aoE - ${S}_aoU`)}, ${solid(`${S}_aoE + ${S}_aoV`)}, ${solid(`${S}_aoE - ${S}_aoV`)});\n`,
    `    vec4  ${S}_aoC  = vec4(${solid(`${S}_aoE + ${S}_aoU + ${S}_aoV`)}, ${solid(`${S}_aoE - ${S}_aoU + ${S}_aoV`)}, ${solid(`${S}_aoE - ${S}_aoU - ${S}_aoV`)}, ${solid(`${S}_aoE + ${S}_aoU - ${S}_aoV`)});\n`,
    `    vec2  ${S}_aoST = 1.0 - ${S}_aoUV;\n`,
    `    vec4  ${S}_aoWa = vec4(${S}_aoUV.x, ${S}_aoST.x, ${S}_aoUV.y, ${S}_aoST.y) * ${S}_aoS;\n`,
    `    vec4  ${S}_aoWb = vec4(${S}_aoUV.x * ${S}_aoUV.y, ${S}_aoST.x * ${S}_aoUV.y, ${S}_aoST.x * ${S}_aoST.y, ${S}_aoUV.x * ${S}_aoST.y) * ${S}_aoC * (1.0 - ${S}_aoS.xzyw) * (1.0 - ${S}_aoS.zywx);\n`,
    `    float ${S}_ao   = 1.0 - clamp((${S}_aoWa.x + ${S}_aoWa.y + ${S}_aoWa.z + ${S}_aoWa.w + ${S}_aoWb.x + ${S}_aoWb.y + ${S}_aoWb.z + ${S}_aoWb.w) * 0.3, 0.0, 0.75);\n`,
  ];
}
