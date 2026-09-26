// A modification of David Hoskins's caustics shader
// https://www.shadertoy.com/view/MdKXDm
// License Creative Commons Attribution-NonCommercial-ShareAlike 3.0 Unported License.

float h12(vec2 p)
{
    return fract(sin(dot(p,vec2(32.52554,45.5634)))*12432.2355);
}

float n12(vec2 p)
{
    vec2 i = floor(p);
    vec2 f = fract(p);
    f *= f * (3.-2.*f);
    return mix(
        mix(h12(i+vec2(0.,0.)),h12(i+vec2(1.,0.)),f.x),
        mix(h12(i+vec2(0.,1.)),h12(i+vec2(1.,1.)),f.x),
        f.y
    );
}

float caustics(vec2 p, float t)
{
    vec3 k = vec3(p,t);
    float l;
    mat3 m = mat3(-2,-1,2,3,-2,1,1,2,2);
    float n = n12(p);
    k = k*m*.5;
    l = length(.5 - fract(k+n));
    k = k*m*.4;
    l = min(l, length(.5-fract(k+n)));
    k = k*m*.3;
    l = min(l, length(.5-fract(k+n)));
    return pow(l,7.)*25.;
}

void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
    vec2 p = (2.*fragCoord-iResolution.xy)/min(iResolution.x,iResolution.y);
    vec3 col = vec3(0.);
    col = vec3(caustics(4.*p,iTime*.5));
    fragColor = vec4(col,1.0);
}