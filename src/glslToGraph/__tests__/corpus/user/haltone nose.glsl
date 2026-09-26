#define BLUE vec3(0.447,0.392,0.650)
#define RED  vec3(0.918,0.259,0.329)
#define DARK vec3(0.122,0.153,0.196)
#define COUNT 30.
///////// Noise credits: https://www.shadertoy.com/view/XsX3zB
vec3 random3(vec3 c) {
	float j = 4096.0*sin(dot(c,vec3(17.0, 59.4, 15.0)));
	vec3 r;
	r.z = fract(512.0*j);j *= .125;
	r.x = fract(512.0*j);j *= .125;
	r.y = fract(512.0*j);
	return r-0.5;
}
const float F3 =  0.3333333;
const float G3 =  0.1666667;
float simplex3d(vec3 p) {
	 vec3 s = floor(p + dot(p, vec3(F3)));
	 vec3 x = p - s + dot(s, vec3(G3));
	 vec3 e = step(vec3(0.0), x - x.yzx);
	 vec3 i1 = e*(1.0 - e.zxy);
	 vec3 i2 = 1.0 - e.zxy*(1.0 - e);
	 vec3 x1 = x - i1 + G3;
	 vec3 x2 = x - i2 + 2.0*G3;
	 vec3 x3 = x - 1.0 + 3.0*G3;
	 vec4 w, d;
	 w.x = dot(x, x);
	 w.y = dot(x1, x1);
	 w.z = dot(x2, x2);
	 w.w = dot(x3, x3);
	 w = max(0.6 - w, 0.0);
	 d.x = dot(random3(s), x);
	 d.y = dot(random3(s + i1), x1);
	 d.z = dot(random3(s + i2), x2);
	 d.w = dot(random3(s + 1.0), x3);
	 w *= w;w *= w;d *= w;
	 return dot(d, vec4(52.0));
}
const mat3 rot1 = mat3(-0.37, 0.36, 0.85,-0.14,-0.93, 0.34,0.92, 0.01,0.4);
const mat3 rot2 = mat3(-0.55,-0.39, 0.74, 0.33,-0.91,-0.24,0.77, 0.12,0.63);
float noise3d(vec3 m) {
    return 0.5+0.5*(0.5333333*simplex3d(m*rot1)+0.2666667*simplex3d(2.0*m*rot2));
}
//////////////////

vec3 prepalette(in float t) {
    t = mod(t, 1.);
    float pt = smoothstep(0.,1.,mod(t,.25)*4.);
    if (t<.25) return mix(DARK,BLUE,pt);
    if (t<.5) return mix(BLUE,DARK,pt);
    if (t<.75) return mix(DARK,RED,pt);
    return mix(RED,DARK,pt);
}
void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
    vec2 uv=(fragCoord.xy-.5*iResolution.xy)/iResolution.y;

    float height = noise3d(vec3((floor(uv*COUNT)/COUNT)*1.,iTime/15.));
    height = floor(height*20.)/20.;

    vec3 col = prepalette(height*3.+iTime/15.);
    
    col *= 1.-step(.4, length(mod(uv*COUNT,1.)-vec2(.5,.5)));

    fragColor = vec4(vec3(col),1.0);
}