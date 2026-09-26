#define pi acos(-1.)
#define eps 9./iResolution.y


#define maxPoints 16.
#define screenSize 2.9
float rnd(vec2 id){
    return sin(fract(dot(id,vec2(14.27,74.97)))*54329.34);
}
mat2 rot(float a){
    float s = sin(a), c = cos(a);
    return mat2(c,-s,s,c);
}

float point(vec2 uv, float r){
    return smoothstep(r+eps,r-eps,length(uv));
}

float ring(vec2 uv, float r){
    return smoothstep(eps+0.01, 0., abs(length(uv)-r+0.01));
}

float line(vec2 P, vec2 A, vec2 B, float r){
    vec2 PA = P-A;
    vec2 AB = B-A;
    //dot(AB,P-P3) = 0
    //dot(AB,P-AB*t)
    float t = clamp(dot(PA,AB)/dot(AB,AB),0.,1.);
    return smoothstep(r+eps,r-eps,length(PA-AB*t));
   
}

void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
    // Normalized pixel coordinates (from 0 to 1)
    vec2 uv = (2.*fragCoord-iResolution.xy)/iResolution.y;
    uv.x+=iTime*0.5;
    vec2 id = floor(uv*screenSize);
    
    uv = fract(uv*screenSize)*2.-1.;
    
    vec2 ringPos = vec2(0.,0.);
    float radius = 0.5;
    float ring1 = ring(uv-ringPos, radius);
    vec3 col = vec3(0.);
    col += ring1;
    
    float mx = 1.+floor(abs(mod(iTime*2.+rnd(id*89.)*831.,
                        maxPoints)-maxPoints/2.))+1.;
    vec2 now,last=vec2(0.,radius)*rot(iTime);
    vec2 first = last;
    col += ring(uv-last, 0.1);
    col += point(uv-last, 0.04);
    
    for(float i = 1.; i < mx; i++){
    
        
        now = vec2(0.,radius)*rot(iTime+i*pi*2./mx);
        col += ring(uv-now, 0.1);
        col += point(uv-now, 0.04);
        col += line(uv,now,last,0.005);
        
        
        
        last = now;
    }
    col += line(uv,now,first,0.005);
    // Output to screen
    fragColor = vec4(col,1.0);
}