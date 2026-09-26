float getBrightness(vec2 uv);
vec2 polar(float angle, float r);
vec2 hsv2rgb(vec3 c);

float TAU = 2.0 * 3.14159;
float speed = 6.0;
float range = 100.0;
float waveFrequency = 1.5;
float waveSmoothness = 1.0;
float invScale = 80.0;
float dropletCount = 5.0;
float aberration = 0.25;

void mainImage( out vec4 fragColor, in vec2 fragCoord )
{   
    vec2 uv = (fragCoord - iResolution.xy * 0.5) / iResolution.y;
    uv *= invScale + 10.0 * sin(iTime);
    
    // This twists the domain, doing so more near the center.
    float angle = sin(iTime) * TAU / (length(uv) + 1.0);
    float ct = cos(angle);
    float st = sin(angle);
    uv = vec2(ct * uv.x + st * uv.y, st * uv.x - ct * uv.y);
    
    //float aberration = sin(iTime * 0.3247) * 0.25;

    float r = getBrightness(uv + polar(TAU * 0.0 / 3.0, aberration));
    float g = getBrightness(uv + polar(TAU * 1.0 / 3.0, aberration));
    float b = getBrightness(uv + polar(TAU * 2.0 / 3.0, aberration));
    
    fragColor = vec4(r, g, b, 1.0);
}

float getBrightness(vec2 uv) {
    float brightness = 0.0;
    for (float i = 0.0; i < dropletCount; i++) {
        float angle = TAU * i / dropletCount;
        float dist = (0.5 + 0.5 * sin(iTime * speed / range)) * range;
        vec2 pos = vec2(sin(angle), cos(angle)) * dist;
        float distFromDrop = length(uv.xy - pos);
        float height = 0.5 + 0.5 * cos(waveFrequency * distFromDrop);
        brightness += height;
    }
    brightness /= dropletCount;
    
    vec2 gradient = vec2(dFdx(brightness), dFdy(brightness));
    float slope = length(gradient);
    
    // If the wave is steep here, compensate by smoothing the step.
    float r = waveSmoothness * slope;
    
    // The larger r is, the wider the interpolation region is and the smoother the step is.
    brightness = smoothstep(0.5 - r, 0.5 + r, brightness);
    
    return brightness;
}

vec2 polar(float angle, float r) {
    return vec2(cos(angle) * r, sin(angle) * r);
}
