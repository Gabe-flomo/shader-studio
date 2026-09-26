void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  vec3 col = vec3(uv, 0.5);
  if (uv.x > 0.5) {
    col = 1.0 - col;
  }
  float s = step(0.5, uv.y);
  col *= mix(0.6, 1.0, s);
  gl_FragColor = vec4(col, 1.0);
}
