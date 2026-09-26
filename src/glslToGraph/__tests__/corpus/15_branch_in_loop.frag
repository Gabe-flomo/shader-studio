void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  vec3 col = vec3(0.0);
  float w = 1.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    if (uv.x > 0.3 * fi) { col += vec3(0.2, 0.1 * fi, 0.05) * w; }
    w *= 0.7;
  }
  gl_FragColor = vec4(col, 1.0);
}
