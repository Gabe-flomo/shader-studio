#define PI 3.14159265359

// --- Salt Grain Sparkle Generator ---
#define GRAIN_SIZE 1.0
#define FLUENCY 0.65

float rand(vec2 co) { 
    return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
}

// Evaluates flickering salt particle highlights
float getSaltSparkle(vec2 fragCoord) {
    vec2 id = floor(fragCoord / GRAIN_SIZE);    
    vec2 rid = vec2(rand(id), rand(id + vec2(100.0, iResolution.y)));    
    float sparkle = -0.1 / (fract(rid.x + rid.y - iTime * FLUENCY) - 1.001) - 0.1;
    return clamp(sparkle * 2.0, 0.0, 1.0);
}

// --- Analytical Bessel Approximations ---
float besselJ0(float x) {
    float ax = abs(x);
    if (ax < 3.75) {
        float y = x / 3.75;
        float y2 = y * y;
        return 1.0 + y2 * (-2.2499997 + y2 * (1.2656208 + y2 * (-0.3163866 + y2 * (0.0444479 + y2 * (-0.0039444 + y2 * 0.0002100)))));
    } else {
        float y = 3.75 / ax;
        float f0 = 0.79788456 + y * (-0.00000077 + y * (-0.00552740 + y * (0.00009512 + y * (0.00137237 + y * -0.00072805))));
        float theta0 = ax - 0.78539816 + y * (-0.04166397 + y * (-0.00003954 + y * (0.00262573 + y * (-0.00054125 + y * -0.00029333))));
        return (1.0 / sqrt(ax)) * f0 * cos(theta0);
    }
}

float besselJ1(float x) {
    float ax = abs(x);
    if (ax < 3.75) {
        float y = x / 3.75;
        float y2 = y * y;
        return x * (0.5 + y2 * (-0.56249985 + y2 * (0.21093573 + y2 * (-0.03954289 + y2 * (0.00443319 + y2 * -0.00031761)))));
    } else {
        float y = 3.75 / ax;
        float f1 = 0.79788456 + y * (0.00000156 + y * (0.01659667 + y * (0.00017105 + y * (-0.00249511 + y * 0.00113653))));
        float theta1 = ax - 2.35619449 + y * (0.04166397 + y * (-0.00003954 + y * (-0.00262573 + y * (-0.00054125 + y * 0.00029333))));
        return (sign(x) / sqrt(ax)) * f1 * cos(theta1);
    }
}

float besselJn(int n, float x) {
    if (n == 0) return besselJ0(x);
    if (n == 1) return besselJ1(x);
    if (x > 15.0) {
        return sqrt(2.0 / (PI * x)) * cos(x - (float(n) * PI * 0.5) - (PI * 0.25));
    }
    float jPrev = besselJ0(x);
    float jCurr = besselJ1(x);
    float jNext = 0.0;
    for (int i = 1; i < n; i++) {
        jNext = (2.0 * float(i) / x) * jCurr - jPrev;
        jPrev = jCurr;
        jCurr = jNext;
    }
    return jCurr;
}

// --- Multi-Source Wave Emitter Array ---
float evaluateMultiSourceField(vec2 st, float d2) {
    float zoom = 48.0;
    float field = 2.0;
    
    // Central emitter
    field += sin(length(st) * zoom - iTime * 2.0);
    
    // 4 Orthogonal emitters
    field += sin(length(st + vec2(0.0, d2)) * zoom - iTime * 2.0);
    field += sin(length(st - vec2(0.0, d2)) * zoom - iTime * 2.0);
    field += sin(length(st + vec2(d2, 0.0)) * zoom - iTime * 2.0);
    field += sin(length(st - vec2(d2, 0.0)) * zoom - iTime * 2.0);
    
    // 4 Diagonal emitters
    field += sin(length(st + vec2(d2, d2)) * zoom - iTime * 2.0);
    field += sin(length(st - vec2(d2, d2)) * zoom - iTime * 2.0);
    field += sin(length(st + vec2(d2, -d2)) * zoom - iTime * 2.0);
    field += sin(length(st - vec2(d2, -d2)) * zoom - iTime * 2.0);
    
    // Normalized for 9 emitters
    return field / 9.0; 
}

void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
    // Normalized centered screen coordinates [-1.0, 1.0]
    vec2 st = (fragCoord - 0.5 * iResolution.xy) / min(iResolution.x, iResolution.y);
    
    // Original radius for the physical plate mask
    float r = length(st);
    float theta = atan(st.y, st.x);

    // Boundary mask for circular metal plate with a glowing edge
    if (r > 1.0) {
        float edgeGlow = exp(-(r - 1.0) * 15.0);
        vec3 voidColor = 0.5 + 0.5 * cos(iTime + vec3(0.0, 2.0, 4.0));
        fragColor = vec4(voidColor * edgeGlow * 0.2, 1.0);
        return;
    }

    // Dynamic wave settings driven by Mouse/Time
    float d2 = 0.25 - 0.08 * sin(iTime * 0.3) + (iMouse.y / iResolution.y) * 0.15;
    float waveNumber = 16.0;

    // Apply spatial compression to shrink the central Bessel roots
    float rScaled = r * 64.0;

    // --- Fluid Eigenmode Interpolation ---
    // Extract a continuous floating-point state for n
    float n_float = 3.0 + mod(iTime * 0.4, 4.0);
    int n1 = int(floor(n_float));
    int n2 = n1 + 1;
    
    // Smooth the fractional remainder to create an ease-in/ease-out blend curve
    float blend = smoothstep(0.0, 1.0, fract(n_float));

    // Calculate displacement fields for both adjacent integer states
    float besselField1 = besselJn(n1, rScaled * waveNumber) * cos(float(n1) * theta) * cos(iTime * 2.0);
    float besselField2 = besselJn(n2, rScaled * waveNumber) * cos(float(n2) * theta) * cos(iTime * 2.0);
    
    // Linearly interpolate the amplitudes
    float besselField = mix(besselField1, besselField2, blend);

    // 2. Multi-Point Wave Emitter Interference Field
    float multiPointField = evaluateMultiSourceField(st, d2);

    // Combined displacement field (30% multi-point perturbation, 70% eigenmode)
    float waveField = mix(besselField, multiPointField, 0.30);

    // Nodal line extraction (|waveField| ~ 0)
    float nodalDist = abs(waveField);
    float derivative = fwidth(waveField) + 0.001;
    float nodalMask = smoothstep(derivative * 2.0, 0.0, nodalDist);

    // Granular Salt Particle Sparkle
    float sparkle = getSaltSparkle(fragCoord);

    // --- Psychedelic Chromatic Modulation ---
    vec3 chromaticSalt = 0.5 + 0.5 * cos(iTime * 1.5 + theta * 4.0 + vec3(0.0, 2.0, 4.0));
    vec3 saltColor = chromaticSalt * (0.6 + 1.4 * sparkle) * 1.0;
    
    vec3 chromaticPlate = 0.5 + 0.5 * cos(iTime * 0.8 - r * 15.0 + waveField * 8.0 + vec3(4.0, 2.0, 0.0));
    vec3 plateColor = chromaticPlate * 0.1;
    
    vec3 chromaticGlow = 0.5 + 0.5 * cos(iTime * 3.0 + r * 20.0 - theta * 2.0 + vec3(1.0, 3.0, 5.0));
    vec3 glowColor = chromaticGlow * (0.006 / (nodalDist + 0.004));

    // Final composition
    vec3 finalColor = mix(plateColor, saltColor, nodalMask) + glowColor;

    fragColor = vec4(finalColor, 1.0);
}