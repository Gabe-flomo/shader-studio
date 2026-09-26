float ripple(float dist, float shift)
{
	return cos(64.0 * dist + shift) / (1.0 + 1.0 * dist);
}


#define POLES 21

#define REFLECTIONS 10.0

void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
	float larger = max(iResolution.x, iResolution.y);
	vec2 uv = (fragCoord.xy - .5*iResolution.xy) / larger;
	vec2 uvflip = vec2(uv.x, -uv.y);
	vec2 cursor = (iMouse.xy - .5*iResolution.xy) / larger;
	vec2 blessr = vec2(-cursor.x, cursor.y);
	
	//float on = float(abs(uv.x)<.25 && abs(uv.y)<.25);
	
	float lum = .5 +
		/*.1 * ripple(length(cursor - uv), -iTime) +
		.1 * ripple(length(blessr - uv), -iTime) +
		.1 * ripple(length(cursor - uvflip), -iTime) +
		.1 * ripple(length(blessr - uvflip), -iTime) +*/
		.1 * ripple(length(uv), 0.0) +
		//.1 * cos(64.0*uv.y - iTime) +
		//.1 * cos(64.0*(uv.x*uv.x) - iTime) +
		0.0;
	
	const float twopi = 2.0*3.141592654;
	const int count = POLES;
	float fcount = float(count);
	vec2 rot = vec2(cos(twopi*.618), sin(twopi*.618));
	vec2 tor = vec2(-sin(twopi*.618), cos(twopi*.618));
	for (int i = 0; i < count; ++i)
	{
		lum += .2 * ripple(length(cursor - uv), -iTime);
		cursor = cursor.x*rot + cursor.y*tor;
	}
	
	/*float lum = .5, dist;
	vec2 part, flip = vec2(1.0, 1.0);
	
	//float freq = 64.0, phase = -iTime;
	float freq = 32.0, phase  = 0.0; // * pow(4.0, cos(iTime/8.0)), phase = 0.0;
	
	for (float ox = -REFLECTIONS; ox <= REFLECTIONS; ox += 1.0)
	{
		for (float oy = -REFLECTIONS; oy <= REFLECTIONS; oy += 1.0)
		{
			dist = length((cursor*flip-uv)+vec2(ox, oy));
			lum += cos(freq * dist - phase) / (5.0 + 10.0*dist);
			
			flip.y *= -1.0;
		}
		flip.x *= -1.0;
	}*/
	
	lum = 3.0*lum*lum - 2.0*lum*lum*lum;
	fragColor = vec4(lum, lum, lum, 1.0);
	
	
	/*fragColor = vec4(.5+.5*sin(3000.0*iTime),
		.5+.5*sin(4997.0*iTime+iResolution.x*3910.0),
		.5+.5*cos(2872.0*iTime+iResolution.y*8721.0), 1.0);*/
}