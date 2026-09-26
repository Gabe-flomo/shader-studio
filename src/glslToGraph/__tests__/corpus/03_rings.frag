void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution.xy) / u_resolution.y;
  float r = length(uv);
  float rings = sin(r * 40.0 - u_time * 3.0);
  float glow = 0.02 / abs(rings);
  vec3 col = vec3(glow) * vec3(0.9, 0.4, 0.2);
  gl_FragColor = vec4(col, 1.0);
}
