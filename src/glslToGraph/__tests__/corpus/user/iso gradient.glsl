// All rights reserved. Copyright © 2024 Lumiey. Unauthorized copying, distribution, modification, or any other use of this file or its contents is strictly prohibited.

const float PI = 3.1419265358;

vec2 get_uv(vec2 uv) {
    float t = iTime * 0.7;
    float a = 4.0 * uv.y - sin(uv.x * 3.0 + uv.y - t);
    a = smoothstep(cos(a) * 0.7, sin(a) * 0.7 + 1.0, cos(a - 4.0 * uv.y) - sin(a - 3.0 * uv.x)); // mask
    uv = cos(a) * uv + sin(a) * vec2(-uv.y, uv.x); // rotate
    return uv;
}

const vec3 purple = vec3(0.68, 0.1, 0.9);
const vec3 blue = vec3(0.6, 0.8, 0.94);
const vec3 orange = vec3(1, 0.68, 0.4);
const vec3 red = vec3(0.98, 0.38, 0.35);

vec4 get_col(vec2 uv) {
    uv = get_uv(uv) * 0.5 + 0.5;
    vec3 col = mix(purple, orange, uv.x);
    col = mix(col, blue, uv.y);
    col *= col + 0.5 * sqrt(col);
    return vec4(col, dot(col, vec3(0.3, 0.6, 0.1)));
}

vec3 traces(vec2 uv, vec4 col) {
    vec2 e = vec2(0.001, 0);
    float dcol = length(vec2(get_col(uv + e.xy).a, get_col(uv + e.yx).a) - col.a) / e.x;  
    float LINE_WIDTH = 0.005;
    float LINES = 50.0;
    float s = abs(fract(LINES * col.a) - 0.5) / dcol / LINES - LINE_WIDTH;
    float r = smoothstep(0.3, 0.2, sin(get_uv(uv).x * 0.3 + iTime * 0.5));
    float w = smoothstep(length(fwidth(uv)), 0.0, s);
    s /= LINE_WIDTH;
    col.rgb = mix(col.rgb, col.rgb + (col.rgb - cos(s * 0.4) * s) * 0.05, max(0.0, w - r));
    return col.rgb;
}

void mainImage(out vec4 fragColor, vec2 fragCoord) {
    vec2 uv = (fragCoord * 2.0 - iResolution.xy) / (iResolution.x + iResolution.y) * 2.0;
    
    vec4 col = get_col(uv);
    col.rgb = traces(uv, col);
    
    fragColor = vec4(col.rgb, 1);
}