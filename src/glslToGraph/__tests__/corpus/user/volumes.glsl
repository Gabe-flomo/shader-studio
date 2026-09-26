mat2 rot(float a){
    float s = sin(a), c = cos(a);
    return mat2(c,-s,s,c);
    
}

float box(vec3 p, vec3 b) {
  vec3 q = abs(p) - b;
  return length(max(q,0.0)) + min(max(q.x,max(q.y,q.z)),0.0);
}
float cyl(vec3 p){
    p.xz *= rot(iTime);
    p.xy *= rot(iTime);
    
    return smoothstep(1.,0.5,box(p, vec3(2.)));
}

vec3 pal(float a){
    return 0.5+0.5*cos(vec3(1.,2.,4.)/2. + a*30.234+iTime);
}
void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
    // Normalized pixel coordinates (from 0 to 1)
    //vec2 uv = fragCoord/iResolution.xy;
    vec2 uv = (fragCoord.xy-iResolution.xy*0.5)/iResolution.y;
    vec3 rd = normalize(vec3(uv, -1.));
    vec3 p = vec3(0.,0.,12.);
    vec4 col = vec4(0.);
    for(float i = 0.1; i < .9; i+=0.01){
        float c = cyl(p += rd*i);
        col += vec4(pal(i)*c/10.,c/10.)*(1.-col.a);
        //if (col.a>.99) break;
        
    }
    // Time varying pixel color

    // Output to screen
    fragColor = col;
}