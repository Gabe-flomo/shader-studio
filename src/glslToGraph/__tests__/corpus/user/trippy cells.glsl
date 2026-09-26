uint pcg_hash(uint x)
{
    x = x * 747796405u + 2891336453u;
    x = ((x >> ((x >> 28u) + 4u)) ^ x) * 277803737u;
    x = (x >> 22u) ^ x;
    return x;
}
float hash21(vec2 p)
{
    uvec2 q = uvec2(ivec2(floor(p)));
    uint n = q.x * 1664525u + q.y * 1013904223u;
    return float(pcg_hash(n)) * (1.0 / 4294967295.0);
}
float valueNoise(vec2 p){
    vec2 pos = p;
    vec2 point = floor(p);
    vec2 f = fract(p);
    
    f = f * f * (3.0 - 2.0 * f);
    
    float a = hash21(point);
    float b = hash21(point + vec2(1.0, 0.0));
    float c = hash21(point + vec2(0.0, 1.0));
    float d = hash21(point + vec2(1.0, 1.0));
    
    float x = mix(a, b, f.x);
    float y = mix(c, d, f.x);
    return mix(x, y, f.y);
    return a;
}

float valueNoiseT(vec2 pos) {
    float n = 0.0;
    float amp = 1.0;
    float freq = 1.0;

    for (int i = 0; i < 4; i++) {
        n += valueNoise(pos * freq) * amp;
        vec2 pol = vec2(atan(pos.y, pos.x), length(pos));
        pol.x += (iTime/100.0) / (freq);
        pos.x = cos(pol.x)*pol.y;
        pos.y = sin(pol.x)*pol.y;
        freq *= 1.9;
        amp *= 0.5;
    }

    return n;
}

vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
    vec2 uv = fragCoord/1000.0 - vec2(0.5);

    float col = 0.0;
    float b = valueNoiseT(uv*7.0);
    float x = valueNoiseT(uv*7.0 + vec2(1.0 / 1000.0, 0.0));
    float y = valueNoiseT(uv*7.0 + vec2(0.0, 1.0 / 1000.0));
    vec2 dir = vec2(b - x, b - y);

    float i;
    for(i = 1.0; i < 10.0; i++){
        uv += dir*5.0;
        b = valueNoiseT(uv*7.0);
        x = valueNoiseT(uv*7.0 + vec2(1.0 / 1000.0, 0.0));
        y = valueNoiseT(uv*7.0 + vec2(0.0, 1.0 / 1000.0));
        
        dir = vec2(b - x, b - y) / (i/2.0);
        col += b;
    }
    fragColor = tanh((vec4(pow(length(dir), 2.0)) * 30000000.0) * (hsv2rgb(vec3(col/3.0, 1.0,1.0)).xyzz) + vec4(col/10.0));
    fragColor += vec4(hsv2rgb(vec3(b, 1.0, 0.15)), 1.0);
    fragColor = fragColor * fragColor * fragColor;
}