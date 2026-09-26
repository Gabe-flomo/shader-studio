const float PI = 3.1415926535897932384626433832795;
const float GOLDEN_RATIO = (sqrt(5.) - 1.) / 2.;
const float SILVER_RATIO = (3. - sqrt(5.)) / 2.;
const float GOLDEN_ANGLE = 2. * PI * SILVER_RATIO;

const int MAX_N = 512;
const float HALF_PERIOD = 20.;
const float DOT_SPACING = .03;
const float DOT_SIZE = DOT_SPACING * SILVER_RATIO;
const mat2 ROT = mat2(
    cos(GOLDEN_ANGLE), -sin(GOLDEN_ANGLE),
    sin(GOLDEN_ANGLE),  cos(GOLDEN_ANGLE)
);

float resolution;

// Per FabriceNeyret2's comment, no more hard-coded magic number.
float circle(vec2 p, vec2 center, float radius)
{
    return smoothstep(3. / resolution, 0., length(p - center) - radius);
}


// smoothed triangle wave
float breathing(float x)
{
    float c = cos(PI * x);
    return -c * c * c / 14. - c * (3. / 7.) + .5;
}


void mainImage(out vec4 fragColor, in vec2 fragCoord)
{
    resolution = min(iResolution.x, iResolution.y);
    vec2 uv = (fragCoord * 2. - iResolution.xy) / resolution;
    vec3 col = vec3(0.015, 0.018, 0.025);

    // --------------------------------------------------------
    // Breathing cycle
    // --------------------------------------------------------

    float b = breathing(iTime / HALF_PERIOD);


    // Number of points
    float count = b * float(MAX_N);


    // --------------------------------------------------------
    // Generate points
    // --------------------------------------------------------
        
    // reducing the range of dot_distance to radial +- DOT_SPACING
    // this reduces complexity from O(count) to O(sqrt(count))
    float radial = length(uv) / DOT_SPACING;

    int lo = int(floor(
        max(0., count - (radial + 1.) * (radial + 1.))
    ));

    int hi = int(ceil(
        min(count, count - (radial - 1.) * (radial - 1.))
    ));


    vec2 dir = vec2(
        cos(float(lo) * GOLDEN_ANGLE),
        sin(float(lo) * GOLDEN_ANGLE)
    );

    for (int n = lo; n <= hi; ++n)
    {
        // for n that's reasonably large(and thus worth optimizing), say, 20
        // we can skip the dot if dir and the direction of uv don't agree
        // but I'm drowsy now zzZ
    
        // ----------------------------------------------------
        // Age of this point
        // // Newest point:
        // age = 0 //
        // Older points:
        // age = 1, 2, 3...
        // ----------------------------------------------------
        
        float age = count - float(n);

        
        // ----------------------------------------------------
        // Radial position
        //
        // sqrt gives approximately uniform density.
        // (age/(1.+age)) is used to correct the derivative near 0(velocity of the newly-born dot at center)
        // and this term fades away to 1 as age grows
        // ----------------------------------------------------
        float age1 = age + 1.;
        float r =
            sqrt(age) * age / age1 * DOT_SPACING;

        
        // ----------------------------------------------------
        // Draw dot
        // ----------------------------------------------------
        // how did we get here?
        // uniform density mean the area of all dots stays proportional to area of the whole pattern
        // that is: integral(pi*radius^2*dx) proportional to pi*r^2
        float x = age / age1;
        float r_dot =
            x * x * (age + 3.) / age1
            * sqrt(2.) * DOT_SIZE;

        vec2 pos = r * dir;

        float mask = circle(uv, pos, r_dot);

        col += mask * vec3(.95, .72, .25);
        
        // The pattern has no overlap, exit when we hit the first dot
        if (mask > .00000001)
            break;
            
        // convert sin/cos to several mult add for every iteration
        dir = dir * ROT;
    }

    fragColor = vec4(col, 1.);
}