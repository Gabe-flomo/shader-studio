// Gravitation lensing simulation using DF-tracing
// by Tomkh '20.01.2015
// http:/moonedit.com/tom

#define ptcnt 12
vec3 pt[ptcnt];
float ptrad = 0.1;
float tim;

void setup_scene()
{
    float t0 = tim*.5;
    for(int i=0; i<ptcnt; ++i) 
    {
        float t = t0 + float(i)*1.7;
        
        // Simple animation of spheres:
        pt[i].x = cos(t)*.5;
        pt[i].y = sin(t*1.1)*.5;
        
        // Put 6 sphere in front (lens) and 6 in the back:
        pt[i].z = ((i*2<ptcnt)?4.0:16.0) + cos(t*2.1);
    }
}

vec4 df(vec3 p)
{
    float dmin = 1e32;
    vec3 n = vec3(0,0,0);
    for(int i=0; i<ptcnt; ++i) 
    {
        vec3 dp = pt[i] - p;
        float d = dot(dp,dp);
        
        // Here is the key to lensing effect, approx. gravity field:
        n += dp/d;
        
        dmin = min(d, dmin);
    }
    return vec4(n,sqrt(dmin));
}

vec4 tex(vec3 p)
{
    float dmin = 1e32;
    vec3 dpmin;
    for(int i=0; i<ptcnt; ++i) 
    {
        vec3 dp = pt[i] - p;
        float d = dot(dp,dp);
        if (d < dmin) 
        {
            dmin = d;
            dpmin = dp;
        }
    }
    float d = sqrt(dmin);
    return vec4(dpmin/d,d);
}

vec4 trace(vec3 p, vec3 n)
{
    float falloff = 1.0 - (1.0 - n.z)*16.0;
    
    // Lensing animation:
    float sc = sin(tim*.1);
    sc *= sc;
    sc *= .008;
    
    // DF tracing with lens-effect here:
    vec4 dn;
    float lit = 0.0;
    for(int k=0; k<64; ++k)
    {
        dn = df(p);
        float d = dn.w;
        float surf_dist = d - ptrad;
        lit += 0.003/(d + 0.1);
        
        // Move half the distance only:
        float f = surf_dist*.5;
        p += n*f;
        
        // Modify ray direction by gravity field:
        n = normalize(n + dn.xyz*f*sc);
    }
    
    // Shading:
    vec4 norm = tex(p);
    float shade = max(0.0, 1.0 - (norm.w - ptrad)*256.0);
    vec4 col = texture(iChannel1, norm.xy*0.1);
    vec4 bkg = texture(iChannel1, n.xy*2.0)*falloff;
    return vec4(vec3(lit,lit,lit*0.6) - vec3(0.0,col.x*col.x*0.5,col.x)*shade,1.0)
         + vec4(bkg.xy,bkg.z*2.0,0.0)*0.2*(1.0-shade);
}

void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
    // Hold mouse button to stop motion / review time:
    tim = (iMouse.z > .5) ? iMouse.x * 20.0 / iResolution.x : iTime;
    
    setup_scene();
	vec2 uv = (fragCoord.xy - iResolution.xy*0.5) / iResolution.x;
    fragColor = trace(vec3(0,0,0), normalize(vec3(uv,1)));
}