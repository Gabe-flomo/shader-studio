#define PI 3.1415926538
#define TAU 6.2831853072
uniform vec2 u_resolution;
uniform float u_time;
varying vec2 vUv;
vec2 hash2(vec2 p) { p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(dot(hash2(i), f), dot(hash2(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0)), u.x),
             mix(dot(hash2(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0)), dot(hash2(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0)), u.x), u.y);
}
void main() {
  vec2 uv = (vUv - 0.5) * 2.0;
  uv.x *= u_resolution.x / u_resolution.y;
  float n = vnoise(uv * 3.0 + u_time * 0.4);
  float ring = sin(length(uv) * TAU * 2.0 - u_time) * 0.5 + 0.5;
  vec3 col = mix(vec3(0.1, 0.05, 0.2), vec3(1.0, 0.6, 0.2), n * 0.5 + 0.5) * ring;
  gl_FragColor = vec4(col, 1.0);
}
