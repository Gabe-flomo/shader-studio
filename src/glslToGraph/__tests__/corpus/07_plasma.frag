void main() {
  vec2 p = gl_FragCoord.xy / u_resolution.xy * 6.0;
  float v = sin(p.x + u_time);
  v += sin((p.y + u_time) * 0.5);
  v += sin((p.x + p.y + u_time) * 0.5);
  p += vec2(sin(u_time * 0.3), cos(u_time * 0.5)) * 3.0;
  v += sin(sqrt(p.x * p.x + p.y * p.y + 1.0) + u_time);
  v *= 0.5;
  vec3 col = vec3(sin(v * 3.14159), sin(v * 3.14159 + 2.0), sin(v * 3.14159 + 4.0)) * 0.5 + 0.5;
  gl_FragColor = vec4(col, 1.0);
}
