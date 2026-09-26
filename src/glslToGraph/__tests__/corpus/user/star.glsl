void mainImage( out vec4 fragColor, in vec2 fragCoord ) 
{vec2 R = iResolution.xy; 
vec2 u = fragCoord - R/2.; 
float a = 0.32; 
float b = 0.2; 
float d = 1.0125 / 32.; 
float c = 159. * d; 
const float pi = 3.14159265; 
float fi=atan(u.x,u.y); 
vec3 col = vec3(0.,0.,1.); 
for (float i=0.; i<pi; i+=pi/16.) 
{float temp1 = i + c*fi - iTime; 
float temp2 = i + d*fi + iTime; 
col += 0.0005 / abs(a + b*sin(temp1)*sin(temp2) - length(u)/(R.y/1.15));} 
fragColor = vec4(col, 1.0);}