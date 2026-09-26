void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution.xy) / u_resolution.y;
  float a = 0.0;
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    a += sin(uv.x * (3.0 + fi) + u_time + fi) * 0.25;
  }
  vec3 col = vec3(0.5 + 0.5 * a, uv.y + 0.5, 0.6);
  gl_FragColor = vec4(col, 1.0);
}
