#define frequency 25.0

//	Source 1
#define useSource1
#define source1pos cos(1.0 * t), sin(2.31 * t)
#define source1amp 2.0
#define source1phase 0.0

//	Source 2
#define useSource2
#define source2pos cos(1.43 * t), sin(1.17 * t)
#define source2amp 1.0
#define source2phase 0.0

//	Source 3
#define useSource3
#define source3pos cos(0.65 * t), sin(0.72 * t)
#define source3amp 1.0
#define source3phase 0.5

//	Source 4
//#define useSource4
#define source4pos cos(1.89 * t), sin(0.92 * t)
#define source4amp 1.0
#define source4phase 0.25

//	Mouse
#define mouseAmp 4.0
#define mousePhase 0.0

//	Source circles
#define circleRadius 0.015
#define circleColor 0.6, 0.0, 0.0

//	Color scheme
#define colorGamma 4.0, 1.0, 0.3


vec4 addSource(vec4 total, vec2 pos, vec2 sourcePos, float sourceAmp, float sourcePhase) {
    float dist = distance(pos, sourcePos);
    float amp = sourceAmp / (dist * dist);
    float angle = dist * frequency + 6.2831853 * sourcePhase;
    return vec4(total.xyz + vec3(amp * sin(angle), amp * cos(angle), amp), min(total.w, dist));
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    float screenHeight = iResolution.y / iResolution.x;
    float border = 1.0 / iResolution.x;
	vec2 pos = (2.0 * fragCoord.xy - iResolution.xy) / iResolution.x;
    
    vec2 window = 0.8 * vec2(1.0, screenHeight);
    
    float t = iTime;
    vec4 total = vec4(0.0, 0.0, 0.0, 2.0 * circleRadius);
    
    #ifdef useSource1
    total = addSource(total, pos, window * vec2(source1pos), source1amp, source1phase);
    #endif
    
    #ifdef useSource2
    total = addSource(total, pos, window * vec2(source2pos), source2amp, source2phase);
    #endif
    
    #ifdef useSource3
    total = addSource(total, pos, window * vec2(source3pos), source3amp, source3phase);
    #endif
    
    #ifdef useSource4
    total = addSource(total, pos, window * vec2(source4pos), source4amp, source4phase);
    #endif
    
    if (iMouse.z > 0.0) {
        vec2 mousePos = vec2((2.0 * iMouse.xy - iResolution.xy) / iResolution.x);
        total = addSource(total, pos, mousePos, mouseAmp, mousePhase);
    }
    
    vec3 color = vec3(length(total.xy) / total.z);
    color = pow(color, vec3(colorGamma));
    
    float circle = smoothstep(circleRadius + border,  circleRadius - border, total.w);
    color = mix(color, vec3(circleColor), circle);
    
    fragColor = vec4(color, 1.0);
}