// "Cosmic Streams Two" — flowing particle trails through volumetric space
// Inspired by "star new" - combines trail rendering with cosmic dust

precision highp float;

#define iterations 15
#define volsteps 18
#define stepsize 0.15
#define brightness 0.002
#define distfading 0.78
#define saturation 0.92

mat2 rot(float a){ float c=cos(a), s=sin(a); return mat2(c,-s,s,c); }

float hash21(vec2 p){
    p = fract(p*vec2(127.1, 311.7));
    p += dot(p, p+34.45);
    return fract(p.x*p.y);
}

vec3 hash33(vec3 p){
    p = fract(p * vec3(443.897, 441.423, 437.195));
    p += dot(p, p.yzx + 19.19);
    return fract((p.xxy + p.yxx) * p.zyx);
}

// cosmic palette
vec3 cosmicPal(float t){
    vec3 a = vec3(0.5, 0.3, 0.6);
    vec3 b = vec3(0.5, 0.7, 0.4);  
    vec3 c = vec3(1.0, 0.8, 0.6);
    vec3 d = vec3(0.1, 0.6, 0.9) + 0.1*sin(iTime*vec3(0.3,0.2,0.4));
    return a + b*cos(6.28318*(c*t + d));
}

// flowing trail function
float streamTrail(vec2 uv, vec2 p1, vec2 p2, float width){
    vec2 pa = uv - p1;
    vec2 ba = p2 - p1;
    float h = clamp(dot(pa,ba)/dot(ba,ba), 0.0, 1.0);
    float d = length(pa - ba*h);
    return exp(-d * width);
}

// volumetric fractal (simplified from your example)
vec4 volumetricRender(vec3 ro, vec3 rd){
    float s = 0.1;
    float fade = 1.0;
    vec3 v = vec3(0.0);
    
    for(int r = 0; r < volsteps; r++){
        vec3 p = ro + s * rd * 0.5;
        
        // tiling fold for infinite repetition
        p = abs(vec3(0.8) - mod(p, vec3(1.6)));
        
        float pa = 0.0;
        float a = 0.0;
        
        for(int i = 0; i < iterations; i++){
            p = abs(p) / dot(p,p) - 0.52; // fractal formula
            
            // gentle rotation for flow
            p.xy *= rot(iTime * 0.03);
            p.xz *= rot(iTime * 0.02);
            
            a += abs(length(p) - pa);
            pa = length(p);
        }
        
        float dm = max(0.0, 0.25 - a*a*0.001);
        a *= a * a;
        
        if(r > 6) fade *= 1.0 - dm;
        
        v += fade;
        v += vec3(s, s*s, s*s*s) * a * brightness * fade;
        
        fade *= distfading;
        s += stepsize;
    }
    
    v = mix(vec3(length(v)), v, saturation);
    return vec4(v * 0.015, 1.0);
}

// main rendering
void mainImage(out vec4 fragColor, in vec2 fragCoord){
    vec2 uv = (fragCoord - 0.5*iResolution.xy) / min(iResolution.x, iResolution.y);
    
    // animated UV distortion
    uv *= 1.8 + 0.001 * cos(uv.y - 0.4 * iTime);
    uv.y += 0.03 * cos(iTime * 0.8);
    
    // volumetric background
    vec3 ro = vec3(0.5, 0.3, 0.2);
    vec3 rd = normalize(vec3(uv * 0.7, 1.0));
    
    vec4 volCol = volumetricRender(ro, rd);
    
    // flowing stream trails
    vec3 streamCol = vec3(0.0);
    float time = iTime * 0.6;
    
    // multiple trail layers
    for(float layer = 0.0; layer < 8.0; layer++){
        float t = time + layer * 0.5;
        
        // animated trail points
        vec2 p1 = vec2(
            0.3 * sin(t * 0.8 + layer),
            0.2 * cos(t * 0.6 + layer * 0.3)
        );
        
        vec2 p2 = vec2(
            0.4 * sin(t * 0.9 + layer + 1.0),
            0.3 * cos(t * 0.7 + layer * 0.4 + 2.0)
        );
        
        // trail width varies per layer
        float width = 25.0 + 15.0 * sin(layer + iTime * 0.4);
        
        float trail = streamTrail(uv, p1, p2, width);
        
        // color based on layer and position
        vec3 trailColor = cosmicPal(layer * 0.15 + length(uv) * 0.2);
        streamCol += trailColor * trail * (0.3 + 0.2 * sin(layer + iTime));
    }
    
    // particle sparkles along trails
    vec3 sparkles = vec3(0.0);
    for(int i = 0; i < 25; i++){
        float fi = float(i);
        vec3 seed = vec3(fi * 0.1, fi * 0.07, iTime * 0.1);
        vec3 sparklePos = hash33(seed) - 0.5;
        sparklePos.xy *= 0.8;
        
        float sparkleLife = fract(fi * 0.1 + iTime * 0.3);
        float size = (1.0 - sparkleLife) * sparkleLife * 4.0;
        
        float dist = length(uv - sparklePos.xy);
        float sparkle = exp(-dist * (50.0 + size * 20.0));
        
        vec3 sparkleColor = cosmicPal(fi * 0.1 + sparkleLife);
        sparkles += sparkleColor * sparkle * size;
    }
    
    // central glow
    float centerGlow = 0.4 * exp(-3.0 * length(uv));
    vec3 glowColor = cosmicPal(iTime * 0.1);
    
    // combine all layers
    vec3 finalCol = volCol.rgb;
    finalCol += streamCol * 0.8;
    finalCol += sparkles * 0.6;
    finalCol += glowColor * centerGlow;
    
    // subtle color enhancement
    finalCol += 0.09 * cosmicPal(length(uv) * 0.5 + iTime * 0.2);
    
    // tone mapping
    finalCol = 0.71 - exp(-finalCol * 0.727);
    finalCol = pow(finalCol, vec3(0.727));
    
    fragColor = vec4(finalCol, 1.0);
}

/** SHADERDATA
{
  "title": "Cosmic Streams",
  "description": "Flowing particle trails through volumetric fractal space with animated sparkles",
}
*/