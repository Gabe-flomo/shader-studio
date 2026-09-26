#define pi 3.14159265359
#define tau (pi * 2.)

void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
    // Normalized pixel coordinates (from 0 to 1)
    vec2 uv = fragCoord/iResolution.xy;
    vec2 cuv = (fragCoord/iResolution.xy - vec2(0.5)) * 2.;

    // Time varying pixel color
    float spiral = atan(cuv.x, cuv.y) / tau * 6. - iTime + length(cuv) * 3.;
    float falloff = (1. - length(cuv));
    vec3 col = (vec3((1. - abs(0.5 - mod(spiral, 1.))) + falloff) * falloff);

    // Output to screen
    fragColor = vec4(col,1.0);
}