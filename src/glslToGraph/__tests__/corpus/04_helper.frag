float sdBox(vec2 p, vec2 b) {
  vec2 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}
void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution.xy) / u_resolution.y;
  float d = sdBox(uv, vec2(0.3, 0.2));
  vec3 col = mix(vec3(0.1, 0.2, 0.4), vec3(1.0, 0.8, 0.3), smoothstep(0.01, 0.0, d));
  gl_FragColor = vec4(col, 1.0);
}
