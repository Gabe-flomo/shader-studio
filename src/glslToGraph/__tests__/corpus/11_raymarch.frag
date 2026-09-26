float map(vec3 p) { return length(p) - 1.0; }
void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution.xy) / u_resolution.y;
  vec3 ro = vec3(0.0, 0.0, -3.0);
  vec3 rd = normalize(vec3(uv, 1.5));
  float t = 0.0;
  for (int i = 0; i < 64; i++) {
    float d = map(ro + rd * t);
    if (d < 0.001) break;
    t += d;
    if (t > 10.0) break;
  }
  vec3 col = vec3(1.0 - t * 0.1);
  gl_FragColor = vec4(col, 1.0);
}
