mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution.xy) / u_resolution.y;
  uv *= rot(u_time * 0.2);
  vec2 g = floor(uv * 8.0);
  float h = hash(g);
  vec2 f = fract(uv * 8.0) - 0.5;
  float d = length(f);
  vec3 col = vec3(h, 1.0 - h, 0.5) * smoothstep(0.4, 0.38, d);
  if (h > 0.8) discard;
  gl_FragColor = vec4(col, 1.0);
}
