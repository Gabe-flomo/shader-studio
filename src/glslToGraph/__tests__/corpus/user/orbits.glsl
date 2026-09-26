float circle(float radius, vec2 center, vec2 uv) {
	float d = distance(center, uv);
    //return 1.0 - step(radius, d);
    //return 1.0 - smoothstep(radius-0.002, radius+0.002, d); //no magic number
    return 1.0 - smoothstep(radius-1./iResolution.y, radius+1./iResolution.y, d);
}

void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
    vec2 uv = (fragCoord - 0.5 * iResolution.xy)/iResolution.y;
    
	float radius = 0.05;
    float speed = 2.0;
    
    //vec2 center = vec2(.0, .0);
    vec2 center = vec2(sin(iTime * speed) / 4.0, cos(iTime * speed) / 8.0);
    vec2 center2 = vec2(sin(iTime * 0.7 * speed + 0.1) / 2.0, cos(iTime * 0.7 * speed + 0.1) / 4.0);    
    vec2 center3 = vec2(sin(iTime * 0.4 * speed + 0.35) / 1.5, cos(iTime * 0.4 * speed + 0.35) / 3.0);
        
    float c = circle(radius, center, uv);
    c += circle(0.075, vec2(0.0), uv);
    c += circle(0.06, center2, uv);
    c += circle(0.07, center3, uv);
    
    vec3 col = vec3(c);
    fragColor = vec4(col,1.0);
}