void mainImage(out vec4 O, vec2 u) {
    vec2 R = iResolution.xy,
         U = 1.2 * ( u+u - R ) / R.y;

    O = sin( vec4(.2,.87, 1.4,-1.2) * iTime );
    O -= .4*O.zwxy;

    for( int i=0; i++<5; )
        U =  ( 1. + ( abs(U) - 1. ) /(.4+O.x/12.) )
            * mat2(cos( O.y + vec4(0,33,55,0)));

    O += 1./dot(U,U) -O; }