
vec3 palette( float t0, float t1 , float t2, float t3, float t4, float t5, float t6, vec2 uv) {
    vec3 a = vec3(0.5, 0.5, 0.5);
    vec3 b = vec3(0.8, 0.7, 0.7);
    vec3 c = vec3(1.0, 1.0, 1.0);
    vec3 d = vec3(0.263,0.416,0.557);
   
    return cos( 3.28318*(c+t0+t1+t2+t3+t4+t5+t6+d));
    //return  b*sin( 43.28318*(c*t0*t1*t2*t3*t4*t5*t6+d) );
}

float createCircleDing(vec2 uv, float xOffset, float yOffset, float radius) {

    uv.x -= xOffset;
    uv.y -= yOffset;
    
    float dAkt = length(uv)/1.;
   
    float factor = 2.5;
    
    dAkt = sin(dAkt*factor - iTime)/factor;
    
   
    dAkt -= sin(radius);
    dAkt = abs(dAkt);
    
    dAkt = smoothstep(0.001, 0.05, dAkt);
   
    
    return dAkt;
}

void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
    vec2 uv = fragCoord / iResolution.xy;
    uv = uv - 0.5; // Verschiebe Mittelpunkt zu 0,0
    // Ecken (-0.5,0.5), (0.5,0.5)...
    
    uv = uv * 2.0;  // Ecken zu (-1,1), (1,1)...
    
    uv.x *= iResolution.x / iResolution.y; // mit aspectratio neutralisieren.  -> 1x1 Quadrat in der mitte
    
    
    
    vec2 uv2 = uv;
      
   
    //uv.x -= 0.5; // 1. Offset verschieben
    
  
  
    // 2. Länge berechnen
    float d = length(uv); // länge vom Vektor
    // "signed distance of the edges of the shape"
    
    
    d -= 0.5; // Radius um 0.5 erweitern. davor war es mehr oder weniger ein punkt
    
    d = abs(d); // Werte innerhalb des Kreises, die negativ sind positiv machen
               
    d  = step(0.01, d); // schwellen wert um outline zu erzeugen
    
    
    float d2 = length(uv2);
    d2 -= 0.5;
    d2 = abs(d2);
   
    d2  = smoothstep(0.0,0.01, d2);
    
    
    float end = 1.;
    
    /*
          Flower of Life

          1. x = center -2; y = center +3.5
          2. x = center +2; y = center +3.5
          3. x = center +4; y = center +0
          4. x = center +2; y = center -3.5
          5. x = center -2; y = center -3.5
          6. x = center -4; y = center +0
    */
    
    float radius = 0.3;
   
    
    float senkrechte = sqrt(pow(radius,2.) + pow((radius/2.), 2.));
    
    
    float c0 = createCircleDing(uv, 0., 0., radius);
    float c1 = createCircleDing(uv, -radius/2., senkrechte-(radius/4.), radius);
    float c2 = createCircleDing(uv, radius/2., senkrechte-(radius/4.), radius);
    float c3 = createCircleDing(uv, radius, 0.0, radius);
    float c4 = createCircleDing(uv, radius/2., -senkrechte+(radius/4.), radius);
    float c5 = createCircleDing(uv, -radius/2., -senkrechte+(radius/4.), radius);
    float c6 = createCircleDing(uv, -radius, 0.0, radius);
      
    if(c1 != 0. && c2 != 0. && c3 != 0. && c4 != 0. && c5 != 0. && c6 != 0. && c0 != 0.) {
        //end = sin(d*10. + iTime)/10.;
       //  end += smoothstep(0.0,1., c1);
       end = 0.0;
           //end -= c0;
          // end -= c3;
           //end -= c4;
        // end += smoothstep(0.0,1., c4);
        // end += smoothstep(0.0,1., c5);
        // end += smoothstep(0.0,1., c6);
        // end += smoothstep(0.0,1., c0);
    }
    vec3 col = palette(c0,c1, c2, c3, c4, c5, c6, uv);
    
    
   /* if(d2 != 0. && d != 0. && d3 != 0.) {
          end =0.;
    } */
   
    //fragColor = vec4(end,0.0,0.0,1.0);
    fragColor = vec4(col, 1.0);
}