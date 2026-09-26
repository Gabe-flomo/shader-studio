void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  float v = 0.0; float a = 0.5; vec2 p = uv * 4.0;
  for (int i = 0; i < 5; i++) { v += a * sin(p.x + p.y + u_time); p *= 2.0; a *= 0.5; }
  gl_FragColor = vec4(vec3(v), 1.0);
}
