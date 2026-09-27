/**
 * examples.ts — the shaders the Convert page offers under Examples…, the
 * first of which (Soft circle) is what the page starts with. Plain strings,
 * so the Convert examples graphs (store/convertExamples.ts) and the
 * presentations that teach the page can quote them without the converter.
 */
export const CONVERT_EXAMPLES: Record<string, { label: string; code: string }> = {
  circle: { label: 'Soft circle', code: `void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  float d = length(uv - 0.5);
  float m = smoothstep(0.31, 0.3, d);
  gl_FragColor = vec4(vec3(m) * vec3(1.0, 0.7, 0.3), 1.0);
}` },
  palette: { label: 'Cosine palette', code: `void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  vec3 col = 0.5 + 0.5 * cos(u_time + uv.xyx + vec3(0.0, 2.0, 4.0));
  gl_FragColor = vec4(col, 1.0);
}` },
  rings: { label: 'Rings with glow', code: `void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution.xy) / u_resolution.y;
  float r = length(uv);
  float rings = sin(r * 40.0 - u_time * 3.0);
  float glow = 0.02 / abs(rings);
  gl_FragColor = vec4(vec3(glow) * vec3(0.9, 0.4, 0.2), 1.0);
}` },
  loop: { label: 'For loop: layered waves', code: `void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  float v = 0.0;
  float a = 0.5;
  vec2 p = uv * 4.0;
  for (int i = 0; i < 5; i++) {
    v += a * sin(p.x + p.y + u_time + float(i));
    p *= 2.0;
    a *= 0.5;
  }
  gl_FragColor = vec4(vec3(0.5 + v) * vec3(0.4, 0.8, 1.0), 1.0);
}` },
  shadertoy: { label: 'Shadertoy: fbm', code: `float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0; float a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.0; a *= 0.5; }
  return v;
}
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  float n = fbm(uv * 4.0 + iTime * 0.2);
  vec3 col = mix(vec3(0.05, 0.1, 0.2), vec3(0.9, 0.7, 0.4), n);
  fragColor = vec4(col, 1.0);
}` },
};
