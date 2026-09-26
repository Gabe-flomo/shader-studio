void mainImage(out vec4 fragColor, in vec2 fragCoord)
{
    vec2 p = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;
    vec2 uv = p;

    float d = length(p) + 0.001;

    uv += p / d * sin(d * 8.0 - iTime * 3.0);

    vec2 grid = abs(mod(uv * 5.0, 1.0) - 0.5);

    float line = max(step(grid.x, 0.03), step(grid.y, 0.03));

    vec3 col = vec3(0.2, 0.6, 1.0) * line;
    col += vec3(1.0, 0.2, 0.9) * exp(-d * 3.0);

    fragColor = vec4(col, 1.0);
}