// variant of https://shadertoy.com/view/WltBzM
// adapted from https://shadertoy.com/view/ttd3D7

#define D   length( mod( U += T/2. , T ) - R )               //
#define P   clamp( 1.- ( min( D, D ) -.8*R.y )/5. ,0.,1.)    // draw an hexa tiling of disks

void mainImage(out vec4 O, vec2 U) {
    U *= 3.;
    vec2 R = iResolution.yy/8., T = vec2( 2, 3.5 )*R;
    O += P -O;

    U = 1.1*U.yx + 10.*iTime;
    O *= P;
}