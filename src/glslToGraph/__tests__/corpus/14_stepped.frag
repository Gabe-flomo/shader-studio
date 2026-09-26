void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  float s = 0.0;
  for (float k = 1.0; k <= 7.0; k += 2.0) { s += sin(uv.x * k * 3.0 + u_time) / k; }
  gl_FragColor = vec4(vec3(0.5 + 0.5 * s), 1.0);
}
