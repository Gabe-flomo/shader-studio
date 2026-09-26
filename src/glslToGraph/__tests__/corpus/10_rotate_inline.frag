void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution.xy) / u_resolution.y;
  float a = u_time * 0.5;
  uv = mat2(cos(a), -sin(a), sin(a), cos(a)) * uv;
  vec2 q = abs(uv) - vec2(0.25, 0.15);
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
  vec3 col = mix(vec3(0.02), vec3(0.3, 0.8, 1.0), smoothstep(0.02, 0.0, d));
  gl_FragColor = vec4(col, 1.0);
}
