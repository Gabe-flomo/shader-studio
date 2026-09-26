
void mainImage( out vec4 o, in vec2 u )
{
	vec4 v = vec4(0.);
    for (int i = 1; i < 11; i++) {
        float fi = float(i)*.04;
        v += sin(length(mod(u/300.,fi)-fi*.5)*(40./(1.+fi))-mod(iDate.w*(1.+vec4(fi*.01,fi*.03+sin(iDate.w*1e-7),fi*.013,0.)),2e3));
    }
    o = abs(v)*.1;
}