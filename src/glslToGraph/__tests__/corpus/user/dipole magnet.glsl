float hash(vec2 p) {
    float h = dot(p, vec2(127.1, 311.7));
    return fract(sin(h)*43758.5453123);
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(a, b, u.x) + (c - a)* u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

vec2 magneticField(vec2 pos) {
    float angle = iTime * 0.5;
    vec2 m = vec2(cos(angle), sin(angle));
    vec2 dipolePos = vec2(0.0, 0.0);
    
    vec2 r = pos - dipolePos;
    float rMag = length(r);
    vec2 rHat = r / rMag;
    
    float mu0Over4Pi = 0.01;
    float mDotR = dot(m, rHat);
    vec2 term1 = rHat * (3.0 * mDotR);
    vec2 term2 = m;
    vec2 B = mu0Over4Pi * (term1 - term2) / (rMag * rMag * rMag);
    
    return B;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = (2.0 * fragCoord - iResolution.xy) / min(iResolution.x, iResolution.y);

    const float steps = 25.0;
    const float stepSize = 0.02;
    float totalWeight = 0.0;
    float sum = 0.0;

    for (float dir = -1.0; dir <= 1.0; dir += 2.0) {
        vec2 pos = uv;
        float weight = 1.0;
        
        for (float i = 0.0; i < steps; ++i) {
            float noiseVal = noise(pos * 30.0);
            
            sum += noiseVal * weight;
            totalWeight += weight;
            
            vec2 B = magneticField(pos);
            vec2 flowDir = normalize(B);
            pos += flowDir * stepSize * dir;
            
            weight *= 0.95;
        }
    }
    
    float licValue = sum / totalWeight;
    
    vec2 B = magneticField(uv);
    float Bmag = length(B);

    vec3 color = vec3(licValue);
    color *= smoothstep(0.0, 0.1, Bmag);

    float dipoleSize = 0.05;
    if (length(uv) < dipoleSize) {
        color = vec3(0.5);
    }
    
    fragColor = vec4(color, 1.0);
}