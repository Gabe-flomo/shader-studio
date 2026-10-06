/**
 * The Grid family's per-cell hashes: Dave Hoskins' "Hash without Sine"
 * (https://www.shadertoy.com/view/4djSRW), MIT licence.
 *
 * The usual fract(sin(dot(c, k)) * 43758.5453) relies on sin of a large
 * argument, which loses precision as the cell index grows (and differs from
 * GPU to GPU): far from the origin, or on a fine grid, neighbouring cells
 * start getting the same "random" number and patterns show stripes. These
 * use only multiplies and fract, so they stay even across the whole grid.
 *
 * Grid Pattern (gpHash, gpHash2) and Neighbor Dist share them; the dedupe in
 * the assembler keeps one copy when both are in a graph.
 */
export const GRID_HASH_GLSL = `float gridHash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}
vec2 gridHash22(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.xx + p3.yz) * p3.zy);
}`;
