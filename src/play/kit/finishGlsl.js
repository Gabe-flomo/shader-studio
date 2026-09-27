/**
 * finishGlsl.js — GLSL shared by the Studio's effect nodes and the Finish
 * stack (finish.js), so a Tone Map node and the Finish stack's tone mapping,
 * or a CRT Mask node and the Finish CRT, are the same code. Plain strings,
 * valid in GLSL ES 1.00 (the graph) and 3.00 (the Finish pass).
 *
 * Part of the layer kit: exportHtml.ts inlines it into web exports, so every
 * top-level name keeps the `FN_` prefix to stay distinct in that scope.
 */

/** The Tone Map node's functions (nodes/definitions/effects.ts ToneMapNode). */
export const FN_TONE_GLSL = `vec3 toneACES(vec3 c) {
  return clamp((c*(2.51*c+0.03))/(c*(2.43*c+0.59)+0.14), 0.0, 1.0);
}
vec3 toneHable(vec3 x) {
  x *= 16.0;
  float A=0.15,B=0.5,C=0.1,D=0.2,E=0.02,F=0.3;
  return ((x*(A*x+C*B)+D*E)/(x*(A*x+B)+D*F))-E/F;
}
vec3 toneUnreal(vec3 c) { return c/(c+0.155)*1.019; }
vec3 toneTanh(vec3 c) {
  c = clamp(c, -40.0, 40.0);
  vec3 e = exp(c); vec3 em = exp(-c);
  return (e-em)/(e+em);
}
vec3 toneTanhSq(vec3 c) {
  return toneTanh(c * c);
}
vec3 toneReinhard2(vec3 c) {
  float Lw = 4.0;
  return (c * (1.0 + c / (Lw * Lw))) / (1.0 + c);
}
float _lottesF(float x) {
  float a=1.6, d=0.977, hdrMax=8.0, midIn=0.18, midOut=0.267;
  float b = (-pow(midIn,a) + pow(hdrMax,a)*midOut) / ((pow(hdrMax,a)-pow(midIn,a))*midOut);
  float c2 = (pow(hdrMax,a*d)*(-pow(midIn,a)) + pow(hdrMax,a)*pow(midIn,a*d)*midOut) /
             ((pow(hdrMax,a*d)-pow(midIn,a*d))*midOut);
  return pow(x,a) / (pow(x,a*d)*b + c2);
}
vec3 toneLottes(vec3 c) {
  return clamp(vec3(_lottesF(c.r),_lottesF(c.g),_lottesF(c.b)), 0.0, 1.0);
}
float _uchi(float x) {
  float P=1.0,a=1.0,m=0.22,l=0.4,c2=1.33,b=0.0;
  float l0=(P-m)*l/a, S0=m+l0, S1=m+a*l0;
  float C2=a*P/(P-S1), CP=-C2/P;
  float w0=1.0-smoothstep(0.0,m,x);
  float w2=step(S0,x);
  float w1=1.0-w0-w2;
  float T=m*pow(max(x/m,0.0001),c2)+b;
  float S=P-(P-S1)*exp(CP*(x-S0));
  float L=m+a*(x-m);
  return T*w0+L*w1+S*w2;
}
vec3 toneUchimura(vec3 c) {
  return clamp(vec3(_uchi(c.r),_uchi(c.g),_uchi(c.b)), 0.0, 1.0);
}
vec3 toneAgX(vec3 c) {
  c = mat3(0.84248,0.04233,0.04238, 0.07843,0.87847,0.07843, 0.07922,0.07917,0.87914) * c;
  c = clamp(c, 0.000061, 256.0);
  c = (log2(c) - log2(0.000061)) / (log2(256.0) - log2(0.000061));
  c = clamp(c, 0.0, 1.0);
  return clamp(c*(c*(c*(1.67*c - 4.0)+4.33)), 0.0, 1.0);
}
// OkLab: compress perceptual lightness L with a soft shoulder above the knee, scale chroma with it so the hue
// and its saturation ratio hold, then ease chroma out near white so the result stays inside the gamut.
vec3 toneOkLab(vec3 c, float knee, float hl) {
  const mat3 kCONEtoLMS = mat3(0.4121656120, 0.2118591070, 0.0883097947,
                               0.5362752080, 0.6807189584, 0.2818474174,
                               0.0514575653, 0.1074065790, 0.6302613616);
  const mat3 kLMStoCONE = mat3(4.0767245293, -1.2681437731, -0.0041119885,
                               -3.3072168827, 2.6093323231, -0.7034763098,
                               0.2307590544, -0.3411344290, 1.7068625689);
  const mat3 kLMStoLab = mat3(0.2104542553, 1.9779984951, 0.0259040371,
                              0.7936177850, -2.4285922050, 0.7827717662,
                              -0.0040720468, 0.4505937099, -0.8086757660);
  const mat3 kLabToLMS = mat3(1.0, 1.0, 1.0,
                              0.3963377774, -0.1055613458, -0.0894841775,
                              0.2158037573, -0.0638541728, -1.2914855480);
  vec3 lms = pow(max(kCONEtoLMS * max(c, 0.0), 0.0), vec3(1.0 / 3.0));
  vec3 lab = kLMStoLab * lms;
  float L = lab.x;
  float k = clamp(knee, 0.05, 0.98);
  float x = max(L - k, 0.0) / (1.0 - k);
  float e2 = exp(-2.0 * min(x, 20.0));
  float Lc = L <= k ? L : k + (1.0 - k) * (1.0 - e2) / (1.0 + e2); // tanh, spelled out for GLSL ES 1.00
  float ratio = L > 1e-4 ? Lc / L : 1.0;
  vec2 ab = lab.yz * ratio * (1.0 - hl * smoothstep(0.7, 1.0, Lc));
  vec3 lms2 = kLabToLMS * vec3(Lc, ab);
  return clamp(kLMStoCONE * (lms2 * lms2 * lms2), 0.0, 1.0);
}`;

/** Tone Map node modes → their function (oklab takes knee and highlights). */
export const FN_TONE_FUNCTIONS = {
  aces: 'toneACES', hable: 'toneHable', unreal: 'toneUnreal', tanh: 'toneTanh', tanh2: 'toneTanhSq',
  reinhard2: 'toneReinhard2', lottes: 'toneLottes', uchimura: 'toneUchimura', agx: 'toneAgX',
};

/** The CRT Mask node's shadow mask (nodes/definitions/effects.ts CrtMaskNode). */
export const FN_CRT_MASK_GLSL = `vec3 crtMaskFn(vec2 pixel, float cellSize, float border, float stagger, float scan) {
  vec2 coord = pixel / cellSize;
  vec2 subcoord = coord * vec2(3.0, 1.0);
  vec2 cellOffset = vec2(0.0, fract(floor(coord.x) * 0.5)) * stagger;
  float ind = mod(floor(subcoord.x), 3.0);
  vec3 mask = vec3(ind == 0.0 ? 1.0 : 0.0, ind == 1.0 ? 1.0 : 0.0, ind == 2.0 ? 1.0 : 0.0) * 3.0;
  vec2 cellUv = fract(subcoord + cellOffset) * 2.0 - 1.0;
  vec2 b = 1.0 - cellUv * cellUv * border;
  mask *= b.x * b.y;
  float row = mod(floor(coord.y + cellOffset.y), 2.0);
  mask *= 1.0 - scan * row * 0.6;
  return mask;
}`;
