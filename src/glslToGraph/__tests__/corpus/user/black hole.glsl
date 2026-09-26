#define PI 3.1415926538

float checkerAA(vec2 p) {
	vec2 q = sin(PI*p*vec2(20,10)); 
    float m = q.x*q.y; 
    return .5 - m/fwidth(m);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord)
{

    vec2 uv = (2.*fragCoord - iResolution.xy ) / iResolution.x;
    float hfov = 2.3;
    float dist = 5.;  

    vec3 vel = normalize(vec3( 1, -uv*tan(hfov/2.) ));

    vec3 pos = vec3(-dist,0.,0.);
    float r = length(pos);
    float dtau = 0.2;

    while(r < dist*2. && r > 1.){
    	float ddtau = dtau*r;
        pos += vel*ddtau;
        r = length(pos);
        vec3 er = pos/r;
        vec3 c = cross(vel,er);
        vel -= ddtau*dot(c,c)*er/r/r;
    }

    float phi1 = 1.-atan(vel.y,vel.x)/(2.*PI);
    float theta1 = 1.-atan(length(vel.xy),vel.z)/PI;
    vec2 UV = vec2(phi1,theta1)+vec2(iTime*0.01,0.);
    vec3 rgb = vec3(checkerAA(UV*180./PI/30.));
    rgb *= float(r>1.);

    fragColor = vec4(rgb,1.0);
}