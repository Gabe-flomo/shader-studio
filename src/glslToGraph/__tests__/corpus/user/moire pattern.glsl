// reverse pattern of https://shadertoy.com/view/wt3fWr

#define D   length( mod( U += T/2. , T ) - k )               //
#define P   clamp(  ( min( D, D ) -.6*k.y )/5. ,0.,1.)    // draw an hexa tiling of disks

void mainImage(out vec4 O, vec2 u) {
   vec2 R = iResolution.xy,
        U = 4.*(u-R/2.),
        V = U * mat2( cos( .05*iTime + vec4(0,11,33,0) ) ),

        k = R.yy/8., T = vec2( 2, 3.5 )*k;
    O += P -O;

    U = 1.0*V; // try 1.1
    O *= P;
}