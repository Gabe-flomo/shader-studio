// references:
// https://thelig.ht/chladni/

const float PI = 3.14159265;

void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
    vec2 p = (2.0 * fragCoord - iResolution.xy) / iResolution.y;

    vec4 s1 = vec4(1.0, 1.0, 7.0, 2.0);
    vec4 s2 = vec4(-2.0, 1.0, 4.0, 4.6);
    
    float t = 0.5 * sin(iTime) + 0.5;
    
	float a = mix(s1.x, s2.x, t);
    float b = mix(s1.y, s2.y, t);
    float n = mix(s1.z, s2.z, t);
    float m = mix(s1.w, s2.w, t);
        
    float max_amp = abs(a) + abs(b);
    float amp = a * sin(PI*n*p.x) * sin(PI*m*p.y) + b * sin(PI*m*p.x) * sin(PI*n*p.y);
	
    float col = step(abs(amp), 0.1);
    
    fragColor = vec4(vec3(col),1.0);
}