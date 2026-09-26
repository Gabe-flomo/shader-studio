#define CIRCLE_RADIUS 0.5
#define CIRCLE_SMOOTHNESS 0.4

vec3 palette( float t ) {  
    vec3 a = vec3(0.5, 0.5, 0.5);
    vec3 b = vec3(0.5, 0.5, 0.5);
    vec3 c = vec3(1.0, 1.0, 1.0);
    vec3 d = vec3(0.263,0.416,0.557);

    return a + b*cos( 6.28318*(c*t+d) );
}

// 3D Noise - from https://www.shadertoy.com/view/XsGyzR
vec3 random3(vec3 st)
{
    st = vec3( dot(st,vec3(127.1,311.7,211.2)),
            	dot(st,vec3(269.5,183.3, 157.1)), dot(st,vec3(269.5,183.3, 17.1))  );
   	return -1.0 + 2.0*fract(sin(st)*43758.5453123);
}

float noise(vec3 st) 
{
	vec3 i = floor(st) ;
  	vec3 f = fract(st);
		
    vec3 u = smoothstep(0.,1.,f);
    
	float valueNowxy01 =mix( mix( dot( random3(i + vec3(0.0,0.0,0.0) ), f - vec3(0.0,0.0,0.0) ),
                    		 	 dot( random3(i + vec3(1.0,0.0,0.0) ), f - vec3(1.0,0.0,0.0) ), u.x),
                		mix( dot( random3(i + vec3(0.0,1.0,0.0) ), f - vec3(0.0,1.0,0.0) ),
                     		 	 dot( random3(i + vec3(1.0,1.0,0.0) ), f - vec3(1.0,1.0,0.0) ), u.x), u.y);
	float valueNowxy02 =mix( mix( dot( random3(i + vec3(0.0,0.0,1.0) ), f - vec3(0.0,0.0,1.0) ),
                    		 	 dot( random3(i + vec3(1.0,0.0,1.0) ), f - vec3(1.0,0.0,1.0) ), u.x),
                		mix( dot( random3(i + vec3(0.0,1.0,1.0) ), f - vec3(0.0,1.0,1.0) ),
                     		 	 dot( random3(i + vec3(1.0,1.0,1.0) ), f - vec3(1.0,1.0,1.0) ), u.x), u.y);

    return abs(mix(valueNowxy01, valueNowxy02, u.z));

}


float sdCircle( vec2 p, float r, float s)
{
    float c = length(p);
    c = smoothstep(r-s,r,c);
    c = abs(1.-c);
    return c;
}

vec2 normalizeLength(in vec2 noiseUV, in vec2 uv, in float scale)
{
    float currLength = length(noiseUV);
    vec2 uvOutput = vec2(noiseUV.x *2./ currLength, noiseUV.y*2. / currLength);
    
    uv*=scale;
    float mixVal = clamp(0.,1.,sdCircle(uv, CIRCLE_RADIUS*scale, CIRCLE_SMOOTHNESS*scale));
    return mix(uvOutput, uv, mixVal);
}


// Main
void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
    // Normalized pixel coordinates (from 0 to 1)
    vec2 uv = (fragCoord * 2.0 - iResolution.xy) / iResolution.y;    

    //Circle
    float c = sdCircle(uv, CIRCLE_RADIUS, CIRCLE_SMOOTHNESS);
    
    //Noise
    float timeFlow = iTime*0.3;
    float noiseScale = 2.0;
    vec2 noiseUV = uv;
    noiseUV = normalizeLength(noiseUV,uv, noiseScale);
    float noiseTex = noise(vec3(noiseUV,timeFlow));
    noiseTex = smoothstep(0.1,0.8,noiseTex);
    
    float stepsBloom = 10.;  
    c*=noiseTex;
    
    for(float i = 1.; i<stepsBloom; i++)
    {
        float stepCircle = sdCircle(uv, CIRCLE_RADIUS+(1.9*(i/stepsBloom)),CIRCLE_SMOOTHNESS);
        
        stepCircle*= abs(1.-(i/stepsBloom));
        stepCircle*=noiseTex;
        c+=stepCircle;
    }
    

    vec3 col =palette(length(noiseUV)) * c;
    
    // Output to screen
    fragColor = vec4(col,1.0);    
    //fragColor = vec4(vec3(noiseUV),1.0); 
}