// ============================================================
//  Plasma RGB Lens
// ============================================================

// Confirable pixel size for pixelated effect.
// 1.0 -> Native pixel size.
// e.g. 6.0 -> 6 times pixel size and more pixelated.
const float pixelSize = 1.0; // sweet spot: 6.0

void mainImage(out vec4 fragColor, in vec2 fragCoord)
{
    vec2 cell = (floor(fragCoord/pixelSize) + 0.5)*pixelSize;
    vec2 p = (2.0*cell - iResolution.xy)/iResolution.y*(4.0/3.0);
    float falloff = 1.0 - dot(p, p);
    vec3 color = clamp(falloff*1.5*exp(-2.0/abs(tan(iTime + p.x + p.y*falloff*6.0 + vec3(0.0, 0.4, 1.0)))), 0.0, 1.0);
    fragColor = vec4(color*max(color.r, max(color.g, color.b)), 1.0);
}