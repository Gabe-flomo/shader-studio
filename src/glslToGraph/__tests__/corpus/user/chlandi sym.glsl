

// Noise pixel size
#define SIZE 1.0
// Lower - more flowing
#define FLUENCY 0.85
float rand(vec2 co) { 
    return fract(sin(dot(co.xy , vec2(12.9898, 78.233))) * 43758.5453);
} 

void mainImage(out vec4 color, vec2 UVcoords)
{
    
          vec2 id = ceil(UVcoords/SIZE);    
    vec2 rid = vec2(rand(id), rand(id+iResolution.y));    
    color = -vec4( 0.1/fract(rid.x + rid.y - iTime * FLUENCY)-0.1)*15.0;//sparke effect
    
   float d3 = iResolution.y*.5 ,//number to move pic upwards
         d4 =  iResolution.x*.5 ,//number to move pic sideways
         d2 = 8.0 - 2.0 * sin( 5.0+iTime*.07 ) + iMouse.y*0.021, //number to move 5 wave machines outwards
    	d1 = .5; ;// wave width
   UVcoords = .5*(UVcoords - vec2(d4,d3)); //move pic around
    float zoom = 0.27;
    
	//function to make color concentric sinewaves like water drop waves radiating from a pt:   
#define S(X, Y,period)   color += sin(length(UVcoords + vec2(X,Y)*d2)*zoom)-.2;
    
         
    
    
    //if (color.x<0.0)
  
    
    
    
    // color += sin(UVcoords.x*100.0*iTime)/6.0;
    //  color += sin(UVcoords.y*150.0*iTime)/6.0;  
    // sin(length()*p2)+v2
	//see end for full formula including angular coordinates as well as concentric
	//Tip: to remix the code, you can try mixing 3/4/8 
    //wave machines in different symmetries and vary their distance and amplitudes
  

   
//make 5 wave machines where the color is added t*d2ogether on coordinates of pentagon:
    
    //these dots are arranged in a + arrangement, one origin for on xy axes. 
    //central wave machine on origin
    S(0.0,0.0,iMouse.x*0.002)
        
    //4 other wave machines on axes
    S(0,1.0*d2,d1)  S(0,-1.0*d2,d1)  S(-1.0*d2,-0.0,d1)  S(1.0*d2,0.0,d1)  
        
    S(2.0*d2,2.0*d2,d1)  S(-2.0*d2,-2.0*d2,d1)  S(2.0*d2,-2.0*d2,d1)  S(-2.0*d2,2.0*d2,d1)      
}
    

//NOTE: original version had concentric wave forms in this fasion:

//float2 xy2 = IN.uv_MainTex + float2(-0.5, -0.5*d3 ) + float2(k1,j1)*d2; 
//position of the point

//float c2 = length(xy2);//polar coordinates (x axis becomes radial)

//ht+=  (sin(c2 * p2)  *v2) ;//angular coordinates (y becomes angle)
    
    