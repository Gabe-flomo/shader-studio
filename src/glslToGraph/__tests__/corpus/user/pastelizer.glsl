//---------------------------------------------------------------------------------

vec3 pastelizer(float h) {
    h = fract(h + 0.92620819117478) * 6.2831853071796;
    vec2 cocg = 0.25 * vec2(cos(h), sin(h));
    vec2 br = vec2(-cocg.x,cocg.x) - cocg.y;
    vec3 c = 0.729 + vec3(br.y, cocg.y, br.x);
    return c * c;
}

//---------------------------------------------------------------------------------

///////////////////////////////////////////////

// ACES fitted
// from https://github.com/TheRealMJP/BakingLab/blob/master/BakingLab/ACES.hlsl

const mat3 ACESInputMat = mat3(
    0.59719, 0.35458, 0.04823,
    0.07600, 0.90834, 0.01566,
    0.02840, 0.13383, 0.83777
);

// ODT_SAT => XYZ => D60_2_D65 => sRGB
const mat3 ACESOutputMat = mat3(
     1.60475, -0.53108, -0.07367,
    -0.10208,  1.10813, -0.00605,
    -0.00327, -0.07276,  1.07602
);

vec3 RRTAndODTFit(vec3 v)
{
    vec3 a = v * (v + 0.0245786) - 0.000090537;
    vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
    return a / b;
}

vec3 ACESFitted(vec3 color)
{
    color = color * ACESInputMat;

    // Apply RRT and ODT
    color = RRTAndODTFit(color);

    color = color * ACESOutputMat;

    // Clamp to [0, 1]
    color = clamp(color, 0.0, 1.0);

    return color;
}

//---------------------------------------------------------------------------------

float linear_srgb(float x) {
    return mix(1.055*pow(x, 1./2.4) - 0.055, 12.92*x, step(x,0.0031308));
}
vec3 linear_srgb(vec3 x) {
    return mix(1.055*pow(x, vec3(1./2.4)) - 0.055, 12.92*x, step(x,vec3(0.0031308)));
}

float srgb_linear(float x) {
    return mix(pow((x + 0.055)/1.055,2.4), x / 12.92, step(x,0.04045));
}
vec3 srgb_linear(vec3 x) {
    return mix(pow((x + 0.055)/1.055,vec3(2.4)), x / 12.92, step(x,vec3(0.04045)));
}

//---------------------------------------------------------------------------------

vec2 uvcoords(vec2 p) {
	vec2 uv = p / iResolution.xy;
    uv = uv * 2.0 - 1.0;
    uv.x *= iResolution.x / iResolution.y;
    return uv;
}
void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
	vec2 uv = uvcoords(fragCoord);
    
    float h = (fragCoord.x / iResolution.x) + iTime * 0.5; 
    vec3 color1 = pastelizer(h);    
    color1 *= exp2(((fragCoord.y / iResolution.y)*2.0-1.0)*4.0);
    
    vec2 n = normalize(uv);
    vec3 color2 = pastelizer(atan(n.y,n.x) / 6.2831853071796);
    color2 *= 1.0 / (0.01 + dot(uv,uv) * 10.0);
    
    float s = clamp(-atan(sin(iTime*0.49)*100.0)*0.5/1.5 + 0.5,0.0,1.0);
    vec3 color = pow(color1, vec3(1.0-s)) * pow(color2, vec3(s));

    color = ACESFitted(color);
	fragColor = vec4(linear_srgb(color),1.0);
}