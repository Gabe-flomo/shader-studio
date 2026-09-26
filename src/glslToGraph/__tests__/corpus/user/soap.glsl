void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
    
    vec2 uv = (fragCoord-.5*iResolution.xy)/iResolution.y;
    float d = length(uv)*5.5;
    
    float c = cos(d)*cos(iTime);
    float s = sin(d)*sin(iTime*1.);
    
    mat2 rot = mat2(c,s,s,c);
    
    uv *= rot;
    
    vec2 gv = fract(uv * 5.0)-0.5;
    
    float r = length(gv);

    r = smoothstep(0.5,0.29,r);
    
    vec3 col;
    col.rb = gv;
    //col.rb += uv;
    col += vec3(r);

    // Output to screen
    fragColor = vec4(col,1.0);
}