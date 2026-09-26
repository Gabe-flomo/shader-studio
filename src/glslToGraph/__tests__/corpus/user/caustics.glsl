// #define-less version of David Hoskins' two-tweet caustics effect,
// suitable for use as a custom HLSL expression within Unreal Engine's
// material editor.
//
// cleaner golf'd version by FabriceNeyret2
//
// ORIGINAL: https://www.shadertoy.com/view/MdKXDm
//
// A simple, if a little square, water caustic effect.
// David Hoskins.
// License Creative Commons Attribution-NonCommercial-ShareAlike 3.0 Unported License.
//
// Inspired by akohdr's "Fluid Fields"
// https://www.shadertoy.com/view/XsVSDm

void mainImage(out vec4 k, vec2 p)
{
    mat3 m = mat3(-2,-1,2, 3,-2,1, 1,2,2);
    vec3 a = vec3( p / 4e2, iTime / 4. ) * m,
         b = a * m * .4,
         c = b * m * .3;
    k = vec4(pow(
          min(min(   length(.5 - fract(a)), 
                     length(.5 - fract(b))
                  ), length(.5 - fract(c)
             )), 7.) * 25.);
}


/* UE4 Custom HLSL Material Expression: 

Input: k, where k.xy is texcoord, k.z is time

float3x3 m = float3x3(-2,-1,2, 3,-2,1, 1,2,2);
float3 a = mul(k, m) * 0.5;
float3 b = mul(a, m) * 0.4;
float3 c = mul(b, m) * 0.3;
return pow(min(min(length(0.5 - frac(a)), length(0.5 - frac(b))), length(0.5 - frac(c))), 7) * 25.;

*/