#define W 2. // frequency of wiggles
#define Q 20. // how many wigglers
#define I 2   // how many bones in each wiggler

precision highp float;
uniform vec2 u_resolution;
uniform float u_time;
uniform vec2 u_mouse;
vec2 mouse;
vec2 hash(vec2 p) // Dave H
{
    vec3 p3 = fract(vec3(p.xyx) * vec3(443.897, 441.423, 437.195));
    p3 += dot(p3, p3.yzx+19.19);
    return fract((p3.xx+p3.yz)*p3.zy);

}
float L (vec2 p, vec2 a, vec2 b, float c) {
    vec2 ab = b-a;
    float l = dot(p-a,ab)/dot(ab,ab);
    p += 0.005*normalize(vec2(-1,1)*ab.yx)*sin(c+W*l);
    return length(p-a-ab*clamp(l,0.,1.));
}
vec2 Z (vec2 U) {
    vec2
    A = U-0.2*vec2(sin(.5*u_time),cos(.5*u_time)),
    B = U-0.3*vec2(cos(.321*u_time),sin(.321*u_time)),
    C = U-mouse;
    vec2 F = vec2(0);
    F -= A/dot(A,A)/length(A);
    F += B/dot(B,B)/length(B);
    if (vec4(u_mouse, 0.0, 0.0).z > 0.) F += C/dot(C,C)/length(C);
    return F;
}

float S (vec2 U, vec2 V) {
    float d = 1e3;
    V = floor(V*Q+0.5)/Q;
    vec2 h = hash(V);
    V += 0.5*(h*2.-1.)/Q;
    V += 0.5*vec2(sin(u_time+10.*h.y),cos(u_time+10.*h.x))/Q;
    vec2 z,v = V;
    for (int i = 0; i < I; i++) {
        z = Z (V);
        v += 2.*normalize(z)/Q/float(I);
        d = min(d, 1.5*float(3+i)/float(I+1)*L(U,V,v,-25.*u_time+W*float(i)+100.*h.x));
        V = v;
    }
    return smoothstep(0.02,0.,d);
}
float E (vec2 U) {
    vec2 V = U;
    float d = 0.;
    for (int x = -2; x<= 2; x++)
    for (int y = -2; y<= 2; y++)
    d += S(U,V + vec2(x,y)/Q);
    return d;
}
void main() {
    vec2 U = gl_FragCoord.xy;
    vec2 R = u_resolution;
    mouse = u_mouse;
    U = 2.*(U-0.5*R)/R.y;
    mouse = 2.*(mouse-0.5*R)/R.y;

    gl_FragColor = vec4(vec3(sin(0.3*vec3(1,2,3)*E(U))),1);

}
