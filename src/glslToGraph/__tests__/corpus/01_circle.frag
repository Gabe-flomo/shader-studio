void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  float d = length(uv - 0.5);
  float m = smoothstep(0.31, 0.3, d);
  gl_FragColor = vec4(vec3(m), 1.0);
}
