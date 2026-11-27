// island.js - part 16/21 (statements 177-177 of the original module).
import { Zo, ft } from "./part06.js";
import { aa } from "./part11.js";
import { SEA_DEPTH_LIMIT, SEA_GRID_VERTEX } from "../sea-grid.js";
import { SHORE_SEA_GLSL } from "../shore-waves.js";

var En = `
uniform sampler2D uD0,uD1,uD2;
uniform sampler2D uSeaWake; uniform vec3 uSeaWakeBox; uniform float uSeaWakeStrength;
uniform vec3 uLS;
uniform float uTime,uHs,uTexels,uStorm;
varying vec3 vP;
varying vec2 vUV;
varying float vSim,vWaveScale;
${SEA_GRID_VERTEX}
${SEA_DEPTH_LIMIT}
${Zo}
${aa}
${SHORE_SEA_GLSL}
vec3 waveLayer(sampler2D m,vec2 p,float L,float spacing){return textureLod(m,p/L,log2(max(2.*spacing/(L/uTexels),1.))).xyz;}
void main(){
 float spacing;
 vec2 p=seaGridPoint(spacing);
 WaterWorld w=waterWorld(p);
 float bed=w.land.x,depth=max(-bed,0.);
 float calm=1.-inlandOf(w);
  if(depth>35.&&calm>.985&&w.land.y>130.){
    vec3 disp=waveLayer(uD0,p,uLS.x,spacing)+waveLayer(uD1,p,uLS.y,spacing)+waveLayer(uD2,p,uLS.z,spacing);
    vWaveScale=seaDepthScale(disp.y,depth);
    vP=vec3(p.x,0.,p.y)+disp*vWaveScale;
    vec2 uv=(p-uSeaWakeBox.xy)/max(uSeaWakeBox.z,1.)+.5;
    float edge=1.-smoothstep(.4,.49,max(abs(uv.x-.5),abs(uv.y-.5)));
    vP.y+=texture2D(uSeaWake,uv).r*edge*uSeaWakeStrength;
    vUV=p;vSim=0.;gl_Position=projectionMatrix*viewMatrix*vec4(vP,1.);return;
  }
  // ---- shore waves: refracted swell, shoaling, breaking, bores and swash on every
  //      coast (shore-waves.js). The FFT sea hands over to them in shallow water.
  float fok;vec4 SF=shoreFieldAt(p,fok);
  ShoreWave sw=shoreWave(p,bed,w.land.y,w.land.zw,SF,fok,calm,spacing);
  float sW=sw.w;
  float fftWeight=offshoreGate(depth)*(1.-sW*.88)*calm;
  vec3 disp=(waveLayer(uD0,p,uLS.x,spacing)+waveLayer(uD1,p,uLS.y,spacing))*fftWeight;
  disp+=waveLayer(uD2,p,uLS.z,spacing)*fftWeight*smoothstep(.1,1.4,depth);
   // Inland is a single level plane. Only the brackish mouth receives a fading
   // share of the shore waves; open-sea swell never climbs the valley.
   vWaveScale=seaDepthScale(disp.y,depth);
   float y=disp.y*vWaveScale+sw.eta*sW;
  // plunging crests are thrown forward over their own trough
   vec2 xz=disp.xz*vWaveScale*(1.-sW)*smoothstep(1.,8.,depth)+sw.disp*sW;
   vUV=p;vSim=sW;
  vec2 wakeUV=(p-uSeaWakeBox.xy)/max(uSeaWakeBox.z,1.)+.5;
   float wakeEdge=1.-smoothstep(.38,.49,max(abs(wakeUV.x-.5),abs(wakeUV.y-.5)));
   y+=texture2D(uSeaWake,wakeUV).r*wakeEdge*calm*.5*(1.-sw.swash);
   // dry beach vertices tuck under the sand (more for coarse lattices), so the sand
   // clips the sheet exactly at the swash tip
   y-=.03*spacing*sw.dry*sW;
   vP=vec3(p.x+xz.x,y,p.y+xz.y);
 gl_Position=projectionMatrix*viewMatrix*vec4(vP,1.);
}`,
  Rn =
    ft +
    `
uniform sampler2D uD0,uD1,uD2,uF0,uF1,uF2;
uniform sampler2D uSeaWake; uniform vec3 uSeaWakeBox;
uniform sampler2D uReflection;
uniform mat4 uReflectionMatrix;
uniform float uReflectionActive,uReflectionLevel,uReflectionStrength;
#ifdef WATER_REFRACTION
uniform sampler2D uRefraction;
uniform mat4 uRefractionMatrix;
uniform float uRefractionActive;
#endif
uniform vec3 uLS,uBody,uFoam;
uniform vec2 uWD;
uniform float uClar,uRough,uFog,uHs,uWindAmt,uRain;
uniform sampler2D uFoamTex;
varying vec3 vP;
varying vec2 vUV;
varying float vSim,vWaveScale;
${Zo}
${aa}
${SHORE_SEA_GLSL}
vec3 specular(vec3 L,vec3 N,vec3 V,float roughness){
 vec3 H=normalize(L+V);
 float nv=max(dot(N,V),.02),nl=max(dot(N,L),0.),nh=max(dot(N,H),0.),vh=max(dot(V,H),0.);
 float a2=roughness*roughness,d=nh*nh*(a2-1.)+1.;
 float D=a2/(3.141593*d*d);
 float vis=.5/max(nl*sqrt(nv*nv*(1.-a2)+a2)+nv*sqrt(nl*nl*(1.-a2)+a2),.0001);
 return vec3(min(D*vis*(.0204+.9796*pow(1.-vh,5.))*nl,4.));
}
vec3 reflectedWorld(vec3 N,vec3 V,float level){
 vec3 R=reflect(-V,N);R.y=abs(R.y);
 vec3 c=sky(R);
 if(uReflectionActive>.5){
  vec4 q=uReflectionMatrix*vec4(vP.x,level,vP.z,1.);
  vec2 uv=q.xy/max(q.w,.001);
  uv+=N.xz*.025/(1.+length(cameraPosition-vP)*.008);
  float border=smoothstep(.005,.055,uv.x)*(1.-smoothstep(.945,.995,uv.x));
  border*=smoothstep(.005,.055,uv.y)*(1.-smoothstep(.945,.995,uv.y));
  float confidence=border*step(.0,q.w)*exp(-abs(level-uReflectionLevel)*1.1)*uReflectionStrength;
  c=mix(c,texture2D(uReflection,clamp(uv,.002,.998)).rgb,clamp(confidence,0.,1.));
 }
 return c;
}
vec2 rot2(vec2 p,float a){float c=cos(a),s=sin(a);return vec2(c*p.x-s*p.y,s*p.x+c*p.y);}
// Foam micro-structure that travels with the current. Two copies of the tileable
// structure map at an irrational scale ratio and different rotations (so the
// tile lattice can never line up into a visible grid of blobs), each advected
// for one cycle and cross-faded half a cycle apart (variance preserving).
float foamStructure(vec2 p,vec2 vel,out float relief){
 float T=2.4,c=uTime/T;
 float f0=fract(c),f1=fract(c+.5);
 float w0=1.-abs(2.*f0-1.),w1=1.-w0;
 float nrm=1./sqrt(w0*w0+w1*w1);
 vec2 o0=fract(vec2(.1317,.7131)*floor(c)),o1=fract(vec2(.5743,.2969)*floor(c+.5));
 vec2 pa=rot2(p,.61)/9.7,va=rot2(vel,.61)/9.7;
 vec2 pb=rot2(p,-1.07)/4.3+vec2(.37,.11),vb=rot2(vel,-1.07)/4.3;
 vec4 a=(texture2D(uFoamTex,pa-va*f0*T+o0)*w0+texture2D(uFoamTex,pa-va*f1*T+o1)*w1-.5)*nrm+.5;
 vec4 b=(texture2D(uFoamTex,pb-vb*f0*T+o1.yx)*w0+texture2D(uFoamTex,pb-vb*f1*T+o0.yx)*w1-.5)*nrm+.5;
 relief=mix(a.g,b.g,.45);
 return a.r*.58+b.r*.42;
}
// value noise with analytic gradient: (value, d/dx, d/dz)
vec3 nD(vec2 p){vec2 i=floor(p),f=p-i;vec2 u=f*f*(3.-2.*f),du=6.*f*(1.-f);
 float a=sh1(i),b=sh1(i+vec2(1.,0.)),c=sh1(i+vec2(0.,1.)),d=sh1(i+vec2(1.,1.));
 float k=a-b-c+d;
 return vec3(a+(b-a)*u.x+(c-a)*u.y+k*u.x*u.y,du*(vec2(b-a,c-a)+k*u.yx));}
// two-phase flow map: a pattern carried by the current without ever stretching
vec4 flowPhases(vec2 flow){
 float T=1.6,c=uTime/T;
 float f0=fract(c),f1=fract(c+.5);
 float w0=1.-abs(2.*f0-1.);
 return vec4(-flow*f0*T,w0,f1);
}
// flow-aligned ripples and micro turbulence of running water, carried by the current
vec2 flowSlope(vec2 p,vec2 flow,float spd,float pixel){
 vec4 ph=flowPhases(flow);
 vec2 o1=-flow*ph.w*1.6;
 float b1=1.-smoothstep(.22,.65,pixel),b2=1.-smoothstep(.07,.22,pixel);
 vec2 fd=flow/max(spd,1e-4),fn=vec2(-fd.y,fd.x);
 vec2 qa=p+ph.xy,qb=p+o1+vec2(17.3,5.1);
 // Anisotropic coordinates elongated along flow direction for V-ripples & flow streaks
 vec2 ra=vec2(dot(qa,fd)*.75,dot(qa,fn)*2.1),rb=vec2(dot(qb,fd)*.75,dot(qb,fn)*2.1);
 float A1=.0055+.015*spd,A2=.0022+.0055*spd;
 vec2 gL=(nD(ra).yz*vec2(.75,2.1)*ph.z+nD(rb).yz*vec2(.75,2.1)*(1.-ph.z))*A1*b1;
 if(b2>.01){
  vec2 ra2=vec2(dot(qa,fd)*2.2,dot(qa,fn)*4.8)+3.3,rb2=vec2(dot(qb,fd)*2.2,dot(qb,fn)*4.8)+3.3;
  gL+=(nD(ra2).yz*vec2(2.2,4.8)*ph.z+nD(rb2).yz*vec2(2.2,4.8)*(1.-ph.z))*A2*b2;
 }
 return fd*gL.x+fn*gL.y;
}
// wind ripples with travelling gusts (cat-s paws) and glassy calm between them
vec2 windSlope(vec2 p,float pixel,out float gust){
 vec2 d=uWD,n=vec2(-d.y,d.x);
 vec2 gp=p*.016-d*uTime*.11;
 gust=smoothstep(.34,.78,sn(gp)*.7+sn(gp*2.7+4.2)*.3);
 float amt=(.12+.88*gust)*(.15+1.25*uWindAmt)+.6*uRain;
 vec2 r=vec2(dot(p,d),dot(p,n));
 float b1=1.-smoothstep(.15,.45,pixel),b2=1.-smoothstep(.05,.16,pixel);
 vec2 g=vec2(0.);
 vec3 a=nD(r*vec2(1.9,.75)-vec2(uTime*1.7,0.));
 g+=a.yz*vec2(1.9,.75)*.011*b1;
 if(b2>.01){vec3 b=nD(r*vec2(5.3,2.1)+vec2(-uTime*2.9,7.7));g+=b.yz*vec2(5.3,2.1)*.004*b2;}
 return (d*g.x+n*g.y)*amt;
}
// raindrop rings on calm water
vec2 rainRings(vec2 p,float pixel){
 vec2 g=vec2(0.);
 float vis=1.-smoothstep(.02,.07,pixel);
 if(vis<.01||uRain<.01)return g;
 for(int L=0;L<3;L++){
  float fl=float(L);
  vec2 q=p*2.1+vec2(fl*7.31,fl*3.17);
  vec2 i=floor(q),f=q-i-.5;
  float hh=sh1(i+fl*19.7);
  if(hh>uRain*1.1)continue;
  vec2 c=(vec2(sh1(i+3.1+fl),sh1(i+5.7+fl))-.5)*.5;
  float t=fract(uTime*(.9+.4*hh)+hh*13.);
  vec2 dd=f-c;float r=length(dd);
  float x=(r-t*.48)*28.;
  float s=sin(x*1.6)*exp(-x*x*.35)*pow(1.-t,2.);
  g+=dd/max(r,1e-3)*s*.35;
 }
 return g*vis;
}



#define uWake uSeaWake
#define uWi uSeaWakeBox
uniform float uWN;uniform vec4 uBLp[3],uBLd[3];uniform float uBLk;
vec3 seaGlint(vec3 L,vec3 N,vec3 V,float a,float nv){
 vec3 H=normalize(L+V);float nh=max(dot(N,H),0.),nl=max(dot(N,L),0.),vh=max(dot(V,H),0.);
 float a2=a*a,d=nh*nh*(a2-1.)+1.,D=a2/(3.14159*d*d);
 float Vis=.5/(nl*sqrt(nv*nv*(1.-a2)+a2)+nv*sqrt(nl*nl*(1.-a2)+a2)+1e-4);   // GGX + Smith
 return vec3(min(D*Vis*(.02+.98*pow(1.-vh,5.))*nl,6.));}                    // clamped glint
void seaOffshore(){
 vec3 V=cameraPosition-vP;float dist=length(V);V/=dist;vec2 q=vUV;float ov=smoothstep(.25,.85,uStorm);
 float calm=1.-.55*smoothstep(300.,1600.,dist);                 // far swell slopes relax: calm horizon
 vec4 dv=texture(uF0,q/uLS.x)*calm+texture(uF1,q/uLS.y)*(.5+.5*calm)+texture(uF2,q/uLS.z);
 dv.xy*=pow(vWaveScale,5.);dv.zw*=vWaveScale;
 vec2 wu=(q-uWi.xy)/uWi.z+.5,we=abs(wu-.5);float wef=(1.-smoothstep(.4,.49,max(we.x,we.y)))*(1.-smoothstep(120.,300.,dist));
 vec4 wk=texture(uWake,wu);float wtx=1./uWN;
 vec2 wg=vec2(texture(uWake,wu+vec2(wtx,0.)).x-texture(uWake,wu-vec2(wtx,0.)).x,texture(uWake,wu+vec2(0.,wtx)).x-texture(uWake,wu-vec2(0.,wtx)).x)/(2.*uWi.z*wtx);   // wake slopes
 vec3 N=normalize(vec3(-dv.x/(1.+dv.z)-wg.x*wef,1.,-dv.y/(1.+dv.w)-wg.y*wef));       // slopes from the three derivative maps + the wake
 float nvr=dot(N,V);if(nvr<0.)N=normalize(N-V*nvr*1.02);           // no black back-facing sparkles
 float nv=clamp(dot(N,V),.02,1.);
 float rough=clamp(uRough+dist*.00006+uStorm*.04,.02,.5),ra=rough*.6+.02;   // rougher with distance: no mirror sea
 float F=.02+(max(1.-rough,.02)-.02)*pow(1.-nv,5.);
 vec3 R=reflect(-V,N);R.y=abs(R.y);
 vec3 spec=seaGlint(uSun,N,V,ra,nv)*uSunCol*smoothstep(0.,.06,uSun.y)*(1.-.92*ov)+seaGlint(uMoon,N,V,ra,nv)*vec3(.14,.17,.26)*uNight*smoothstep(0.,.06,uMoon.y);
 // see-through body: absorption grows with path length (1/cos), so it is clear looking down and murky at grazing angles
 float thk=max(vP.y+.4*uHs,0.)*smoothstep(1.5,5.,uHs);   // water depth above the trough: crests are thick, only the lower flanks stay see-through
 float aB=1.-exp(-(2.6*pow(1.-uClar,2.)+.04+.9*thk)/max(nv,.07));
 vec3 body=uBody*uLight*mix(1.,.4,uStorm);
 body+=vec3(.03,.24,.34)*pow(clamp(dot(uSun,-V),0.,1.),4.)*smoothstep(-.1*uHs,.45*uHs,vP.y)*uDay*uSunCol*.9*(1.-ov);   // crest scattering
 vec3 col=sky(R)*F+spec+body*(1.-F)*aB;                                      // premultiplied
 float al=F+(1.-F)*aB;
 if(uBLk>.01){vec3 lc=vec3(0.);   // the boat's own lights on the sea: a lit pool plus glitter on the waves
  for(int i=0;i<3;i++){vec3 d=uBLp[i].xyz-vP;float r=length(d);vec3 Lv=d/r;
   float cone=uBLd[i].w<-1.5?1.:smoothstep(uBLd[i].w-.05,uBLd[i].w,dot(-Lv,uBLd[i].xyz));
   float att=uBLp[i].w/(1.+.015*r*r),dif=max(dot(N,Lv),0.),spc=pow(max(dot(N,normalize(Lv+V)),0.),70.);
   lc+=att*cone*(vec3(.35,.65,.75)*dif*.35+vec3(1.,.95,.82)*spc*1.6);}
  col+=lc;al=max(al,clamp(dot(lc,vec3(.33))*2.,0.,1.));}
 float fp=length(fwidth(vUV))*uFoam.y,pat=0.,am=.5,fr=1.;
 vec2 qs=vec2(dot(q,uWD)*.4,dot(q,vec2(-uWD.y,uWD.x)));   // stretched along the wind: streaky foam
 for(int i=0;i<4;i++){float w=1.-smoothstep(.2,.8,fp*fr);pat+=am*mix(.5,vn(qs*uFoam.y*fr+uTime*.05*fr),w);fr*=2.1;am*=.5;}
 pat/=.9375;                                                                 // fine octaves fade to the mean
 float tb=1.+(texture(uD0,q/uLS.x).a-1.)+(texture(uD1,q/uLS.y).a-1.)*.8+(texture(uD2,q/uLS.z).a-1.)*.4;   // accumulated turbulence
 float raw=clamp((uFoam.x-tb)*3.2,0.,1.);
 float fo=clamp(smoothstep(1.-uFoam.z,1.,raw*(.55+pat))+raw*.15,0.,1.);
 fo=mix(fo,raw*.35*uFoam.z,smoothstep(250.,900.,dist));
 float tip=smoothstep(.34,.66,vP.y/uHs)*smoothstep(.12,.7,uStorm)*(1.-smoothstep(250.,800.,dist));   // storm whitecaps: foam only on the highest wave tips
 fo=max(fo,tip*smoothstep(.38,.62,pat+.2*tip));
 fo*=1.-.85*smoothstep(450.,1500.,dist);                        // no foam specks on the horizon
 fo=max(fo,smoothstep(.5,.72,wk.z*1.25+(pat-.5)*.9)*wef*.85);               // the boat's foam trail: breaks into lace as it ages, no smooth smear
 vec3 fc=vec3(.92,.95,.97)*(hzSoft()*.5+uSunCol*uDay*max(dot(N,uSun),0.)*.35*(1.-.75*ov)+(.04+1.5*uStorm)*uLight);  // lit by the smooth normal
 col+=vec3(.02,.18,.26)*uLight*smoothstep(0.,.6,raw*uFoam.z)*(1.-fo)*(1.-F)*.7;
 col+=vec3(.03,.27,.31)*uLight*smoothstep(0.,.5,wk.z)*(1.-fo)*(1.-F)*wef*.5;   // aerated, bubble-filled water under the trail   // turquoise bubble layer
 col=mix(col,fc,fo);al=mix(al,1.,fo);
 float fg=1.-exp(-dist*uFog);col=mix(col,horizon(),fg);al=mix(al,1.,fg);
 gl_FragColor=vec4(col,al);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}
#undef uWake
#undef uWi

void main(){
 WaterWorld w=waterWorld(vUV);
 float bed=w.land.x,depth=max(-bed,0.);
 // ---- fresh water: inland-ness, the plume spreading into the sea, the current
 float inl=inlandOf(w);
 if(depth>35.&&inl<.015&&w.land.y>130.){
 #ifdef DEPTH_PREPASS
 gl_FragColor=vec4(0.);
 #else
 seaOffshore();
 #endif
 return;
 }
 // ---- single-surface contract --------------------------------------------
 // Inland water is drawn by the freshwater mesh (one SDF mask covering lakes,
 // rivers, creeks, swamps and the estuary). The ocean cross-fades out over the
 // same mask with the same ramp, so the two always sum to exactly one surface
 // and the waterline, colour and foam stay continuous through every mouth.
 float rawInl=w.water.r;
 // Exact match with buildFreshwaterGeometry smooth01(0.28, 0.90, mask) -> zero seam across every mouth!
 float freshTakeover=smoothstep(.28,.90,rawInl);
 if(freshTakeover>.985)discard;
 vec2 flow=w.water.ba*step(bed,.3);float fspd=length(flow);
 // Multi-scale organic river plume strictly gated to real river mouths (never darkening open beaches!)
 vec2 plumeWarp=vec2(sn(vUV*.008+uTime*.003)-.5,sn(vUV*.008+4.7-uTime*.0025)-.5)*28.;
 float plumeGate=smoothstep(.035,.32,w.water.r*step(bed,.3));
 float plumeN=((sn((vUV+plumeWarp)*.010+vec2(uTime*.004,-uTime*.003))-.5)*.34+(sn(vUV*.042)-.5)*.14)*plumeGate;
 float freshMix=max(inl,smoothstep(.08,.62,w.water.r*step(bed,.3)+plumeN)*plumeGate);
  vec3 V=cameraPosition-vP;float distanceToEye=length(V);V/=max(distanceToEye,.001);
  // world-space footprint of this pixel
  float pixel=length(fwidth(vUV));
  float detail=1.-smoothstep(.6,3.,pixel);
  float simFar=smoothstep(.9,2.6,pixel);

  // ---- shore waves, per pixel: crisp crests and waterline at any distance
  float sok;vec4 SF=shoreFieldAt(vUV,sok);
  ShoreWave sw=shoreWave(vUV,bed,w.land.y,w.land.zw,SF,sok,1.-inl,pixel);
  float wS=sw.w,mask=wS;
  float hS=sw.eta-bed,rho=sw.roller*(1.-simFar),foamD=sw.foam;
  // breakers stir sand into the water column; the swash sheet clears quickly
  float murk=clamp(sw.roller*.8+sw.foam*.35,0.,1.2)*(1.-.6*sw.swash)*smoothstep(.1,.6,uShH);
  vec2 gradE=sw.grad,vel=sw.vel;
  vec2 gradH=-sw.dir*.1;
  float column=mix(vP.y-bed,hS,wS);
 // films thinner than 5 mm read as wet sand (terrain shader), not as water
  if(column<.005)discard;
 #ifdef DEPTH_PREPASS
  // Depth-only pass: lay down the nearest open-sea surface so the colour pass
  // draws only the front-most wave (no far crests bleeding through near ones).
  // Inland/plume water and razor-thin swash are skipped so the freshwater sheet
  // and the beach are never occluded by an invisible ocean fragment.
  if(freshTakeover>.01||column<.04)discard;
  gl_FragColor=vec4(0.);
  return;
 #endif

 // ---- surface slope: FFT offshore, simulated surface in the surf zone, fine wind ripples
 float fftWeight=offshoreGate(depth)*(1.-wS*.92)*(1.-inl);
  vec4 derivatives=vec4(0.);
  if(fftWeight>.002){
   derivatives=(texture2D(uF0,vUV/uLS.x)+texture2D(uF1,vUV/uLS.y))*fftWeight;
   derivatives+=texture2D(uF2,vUV/uLS.z)*fftWeight*smoothstep(.1,1.4,depth);
  }
 derivatives.xy*=pow(vWaveScale,5.);derivatives.zw*=vWaveScale;
 vec2 slope=vec2(derivatives.x/max(.2,1.+derivatives.z),derivatives.y/max(.2,1.+derivatives.w));
 slope+=clamp(gradE,vec2(-2.5),vec2(2.5))*wS;
 // ripples are only drawn where the pixel can resolve them; their lost slope
 // variance is handed to the roughness instead (no sparkle crawl at distance)
 float rip1=1.-smoothstep(.12,.45,pixel),rip2=1.-smoothstep(.04,.14,pixel);
 vec2 rp=vUV*vec2(2.3,1.9)+uWD*uTime*1.1;
 vec2 rp2=vUV*vec2(5.7,6.3)-uWD.yx*uTime*.7;
 float ripAmt=wS*smoothstep(.02,.25,column)*(.45+.18*min(uHs,4.))*(1.-inl);
 slope+=(vec2(sn(rp)-.5,sn(rp+7.3)-.5)*.11*rip1+vec2(sn(rp2)-.5,sn(rp2+3.1)-.5)*.05*rip2)*ripAmt;
 // ---- inland water body weights: open lake, running river, tannin swamp
 float swampish=clamp(w.water.g,0.,1.)*inl;
 float riverW=clamp(smoothstep(.065,.34,fspd)*(1.-swampish*.6),0.,1.)*inl;
 float lakeW=clamp((1.-riverW)*(1.-swampish),0.,1.)*inl;
 float still=1.-smoothstep(.06,.28,fspd);

 // ---- inland surface: glassy lakes, flow-aligned river ripples, nearly still swamps
 float gust=0.;
 if(freshMix>.002){
  vec2 fs=flowSlope(vUV,flow,fspd,pixel)*smoothstep(.02,.14,fspd+.03);
  // Calm glassy lakes (.38 wind) and nearly still swamps (.10 wind) for crisp tree reflections
  float calmWind=mix(1.,mix(.38,.10,clamp(swampish*1.3,0.,1.)),still);
  vec2 ws=windSlope(vUV,pixel,gust)*(1.-.55*smoothstep(.28,.85,fspd))*calmWind;
  slope+=(fs+ws)*freshMix*smoothstep(.01,.12,column);
 }
 slope+=rainRings(vUV,pixel)*(.35+.65*freshMix)*smoothstep(.02,.1,column);
 // thin swash film: it conforms to the sand, so its skin is broken by backwash
 // rills and grain-scale roughness instead of reading as a glassy white sheet
 float thinFilm=wS*(1.-smoothstep(.012,.09,column))*(1.-inl);
 if(thinFilm>.01){
  vec2 fdS=vel/max(length(vel),1e-3),fnS=vec2(-fdS.y,fdS.x);
  vec2 rq=vec2(dot(vUV,fdS)*.9,dot(vUV,fnS)*3.4)-vec2(uTime*.35,0.);
  float rv=1.-smoothstep(.05,.3,pixel);
  slope+=(vec2(sn(rq)-.5,sn(rq+5.2)-.5)*.16+vec2(sn(vUV*7.3)-.5,sn(vUV*7.3+2.7)-.5)*.06)*thinFilm*rv;
 }
 vec3 N=normalize(vec3(-slope.x,1.,-slope.y));
 // rounded leading edge: the meniscus curls outward and down onto the sand
 float edge=(1.-smoothstep(.006,.045,column))*wS*(1.-simFar);
 vec2 outward=-gradH/max(length(gradH),1e-4);
 N=normalize(mix(N,normalize(vec3(outward.x,.62,outward.y)),edge*.75));
 float nvr=dot(N,V);if(nvr<.01)N=normalize(N-V*min(nvr,0.));
 float nv=clamp(dot(N,V),.015,1.);
 // Fresnel reflection: slightly boosted on still glassy lakes and dark swamp mirrors
 float fBase=mix(.0204,.038,freshMix*(.65*lakeW+.85*swampish));
 float F=fBase+(1.-fBase)*pow(1.-nv,5.);
 // a film a few millimetres thick is no optical flat: its mirror breaks into patches
 F*=mix(1.,.45+.55*smoothstep(.25,.75,sn(vUV*2.3+vec2(3.7,1.9))),thinFilm*.85);
 float rough=uRough*.6+.025+distanceToEye*.000025+(.03*simFar+.035*(1.-rip1*.5-rip2*.5))*ripAmt;
 // Glassy lakes and still swamps have very low roughness so trees and peaks reflect crisply
 float roughF=.006+distanceToEye*.00001+.038*smoothstep(.35,1.,(.1+.9*gust)*uWindAmt)*(1.-swampish*.85)*smoothstep(.08,.4,pixel)+.035*uRain+.018*fspd*smoothstep(.1,.5,pixel);
 rough=mix(rough,roughF,freshMix);
 vec3 reflected=reflectedWorld(N,V,0.);
 float overcast=smoothstep(.25,.85,uStorm);
 vec3 sparkle=specular(uSun,N,V,rough)*uSunCol*(1.-.88*overcast)*smoothstep(0.,.06,uSun.y)*(1.-swampish*.55);
 sparkle+=specular(uMoon,N,V,rough)*vec3(.10,.13,.2)*uNight;

 // ---- body colour:
 //      \u2022 Open lakes: bright turquoise shallow littoral rim -> clear blue-teal -> deep dark teal
 //      \u2022 Rivers: sediment shallows -> olive green-brown -> deep river channel
 //      \u2022 Swamps: olive/tea bank shallows -> dark tannin-brown / nearly black in deep pockets (Ref C & D)
 float surfMurk=clamp(murk,0.,1.)*mask*.35;
 float path=min(column,45.)/max(nv,.24);
 // Crystal-clear tropical shallow lagoon water over coral sandbars -> rich turquoise -> deep sapphire offshore
 float shallowClear=smoothstep(.25,5.5,depth);
 float extinction=(.038+.26*pow(1.-uClar,2.))*mix(.32,1.,shallowClear);
 float absorption=0.;
 vec3 seaBody=mix(vec3(.06,.68,.74),uBody,smoothstep(2.8,26.,depth));
 seaBody=mix(seaBody,vec3(.22,.86,.82),smoothstep(3.8,.35,depth)*.52);
 seaBody=mix(seaBody,vec3(.42,.62,.56),surfMurk*.38);

 // 1) Lake colour: bright turquoise littoral rim fading into clear blue-teal then deep basin teal
 float shallowRim=1.-smoothstep(.35,3.2,depth);
 vec3 lakeCol=mix(vec3(.052,.265,.295),vec3(.014,.078,.112),smoothstep(2.4,16.,depth));
 lakeCol=mix(lakeCol,vec3(.19,.58,.56),shallowRim*.72);

 // 2) River/estuary mouth colour: crystal emerald-turquoise running water over sunlit sandy bars
 vec3 riverCol=mix(vec3(.068,.30,.265),vec3(.024,.125,.122),smoothstep(1.8,9.5,depth));
 riverCol=mix(riverCol,vec3(.20,.48,.42),(1.-smoothstep(.15,1.8,depth))*.55);

 // Swamp-colored estuary water follows the inland olive-jade scattering palette.
 vec3 swampCol=mix(vec3(.205,.258,.130),vec3(.041,.103,.083),1.-exp(-depth*.78));

 float sumW=lakeW+riverW+swampish;
 vec3 freshBody=sumW>1e-3?(lakeCol*lakeW+riverCol*riverW+swampCol*swampish)/sumW:riverCol;
 float normW=max(sumW,1.);
 // Soft sediment-coloured shoreline rim right at the water edge (0..0.45 m)
 float shoreSed=(1.-smoothstep(.04,.48,column))*inl;
 freshBody=mix(freshBody,mix(vec3(.22,.21,.13),vec3(.11,.095,.055),swampish),shoreSed*.42);

 float silt=clamp(uRain*.75+uStorm*.3,0.,.85);
 freshBody=mix(freshBody,vec3(.26,.205,.14),silt);
 // Balanced optical clarity linking the estuary seamlessly into the crystal inland water and kelp bed
 float extLake=mix(.12,.21,smoothstep(2.0,10.,depth));
 float extRiver=.21;
 float extSwamp=mix(.74,1.35,smoothstep(.28,1.5,depth));
 float extF=((extLake*lakeW+extRiver*riverW+extSwamp*swampish)/normW)*(1.+1.8*silt);

 // the plume: gradual river-to-sea brackish mixing zone with swirling jade-turquoise front
 vec3 brackishTint=mix(seaBody,freshBody*1.28+vec3(.012,.052,.042),smoothstep(.05,.72,freshMix));
 seaBody=mix(seaBody,mix(brackishTint,freshBody,smoothstep(.25,.92,inl)),freshMix);
 extinction=mix(extinction,extF,freshMix);
 absorption=max(1.-exp(-path*extinction),surfMurk*.5);
 vec3 body=seaBody*uLight*mix(1.,.5,uStorm);
 vec3 color=reflected*F+sparkle+body*(1.-F)*absorption;
 float alpha=F+(1.-F)*absorption;
  #ifdef WATER_REFRACTION
  if(uRefractionActive>.5&&freshMix>.5){
   vec2 bend=N.xz*min(column,3.)*.32*smoothstep(.05,.5,column);
   vec4 q=uRefractionMatrix*vec4(vP.x+bend.x,0.,vP.z+bend.y,1.);
   vec2 ruv=q.xy/max(q.w,.001);
   float valid=step(.005,ruv.x)*step(.005,ruv.y)*step(ruv.x,.995)*step(ruv.y,.995)*step(0.,q.w);
   vec3 through=texture2D(uRefraction,clamp(ruv,.005,.995)).rgb;
   color+=through*(1.-alpha)*valid;
   alpha=mix(alpha,1.,valid);
  }
  #endif
 // sunlight through steep, thin wave faces just before they break
 float spd=length(vel);vec2 dir=vel/max(spd,1e-3);
 float back=pow(max(dot(-V,uSun)*.5+.5,0.),3.);
  float waveFace=max(smoothstep(.1,.45,-dot(gradE,dir)),sw.face)*smoothstep(.3,1.4,column)*wS;
 color+=vec3(.03,.32,.27)*waveFace*(.25+1.2*back)*(uSunCol*.45+hzSoft()*.3*uLight)*(1.-F);
 // the sheet's own shadow line where it meets the sand
 color*=1.-.18*edge*smoothstep(.005,.02,column);

 // ---- foam: simulated density -> coverage. Near: advected lace / roller.
 //      Far: the footprint spans many bubbles, so draw the mean coverage.
  float coverage=0.,relief=.5;
  if(mask>0.){
   float dens=clamp(foamD,0.,1.3);
   float farCov=max(clamp(dens*.62,0.,.8)*smoothstep(.03,.14,dens),sw.front*.55);
   float structDetail=1.-smoothstep(.35,1.6,pixel);
   float nearCov=0.;
   if(structDetail>.001){
    float rel;
    // the lace rides the water: it rushes up and drains back with the swash sheet,
    // and drifts shoreward with the broken waves
    vec2 fp=vUV-sw.dir*sw.sx*sw.swash;
    float structure=foamStructure(fp,sw.dir*.45*(1.-sw.swash),rel)+(sn(vUV*.045+3.1)-.5)*.16;
    float aa=clamp(.085+pixel*.22,.085,.4);
    float d2=pow(clamp(dens,0.,1.),1.5)*.88;
    float residual=smoothstep(1.-d2-aa,1.-d2+aa,structure)*smoothstep(.05,.2,d2);
    float roller=smoothstep(.12,.6,rho)*smoothstep(.15,.45,structure+.4*rho);
    // the uprush lip: a bright, ragged line of bubbles riding the swash tip
    float lace=smoothstep(.38,.66,structure+(sn(vUV*1.9+vec2(5.1,2.3))-.5)*.3);
    float lip=sw.front*mix(.5,1.,lace);
    // translucent bubble veil beneath the lace: aerated water is milky, not paint
    float veil=smoothstep(.04,.5,dens)*(1.-residual)*.3;
    nearCov=max(max(residual*.95,roller*.92),max(lip*.96,veil));
    relief=rel;
   }
   coverage=mix(farCov,nearCov,structDetail)*smoothstep(.004,.02,column)*mask;
  }
  float fftFoam=0.;
  if(fftWeight>.002){
   float turbulence=1.+(texture2D(uD0,vUV/uLS.x).a-1.)+.8*(texture2D(uD1,vUV/uLS.y).a-1.)+.4*(texture2D(uD2,vUV/uLS.z).a-1.);
   fftFoam=clamp((uFoam.x-turbulence)*2.,0.,1.)*fftWeight;
  }
  // ---- running water: gentle flow streaks, riffles, and soft shoreline foam;
  //      swamp & slow-water zones: patchy floating carpet (duckweed, water lettuce,
  //      lily-pad clusters) broken into clumps and open dark channels with contact darkening.
 float freshFoam=0.,floatMat=0.,floatShadow=0.,lettuce=0.,lilyClump=0.;
 if(freshMix>.01){
  vec4 ph=flowPhases(flow);
  vec2 qa=vUV+ph.xy,qb=vUV-flow*ph.w*1.6+vec2(11.,3.);
  float fd=1.-smoothstep(.3,1.4,pixel);
  vec2 fdir=flow/max(fspd,1e-4),fnrm=vec2(-fdir.y,fdir.x);
  // Flow-aligned coordinates for subtle longitudinal river streaks
  vec2 sa=vec2(dot(qa,fdir)*.32,dot(qa,fnrm)*1.85),sb=vec2(dot(qb,fdir)*.32,dot(qb,fnrm)*1.85);
  float fa=sn(sa)*.62+sn(qa*2.1)*.38,fb=sn(sb)*.62+sn(qb*2.1)*.38;
  float fn=mix(.5,fa*ph.z+fb*(1.-ph.z),fd);
  float riff=smoothstep(.26,.9,fspd)*(1.-smoothstep(.22,.9,column));
  freshFoam=smoothstep(.68-.28*riff,.84-.18*riff,fn)*riff*.88;
  // Subtle flow streaks along river current
  float streak=smoothstep(.12,.48,fspd)*smoothstep(.64,.82,fn)*.32;
  color+=mix(vec3(.04,.07,.05),vec3(.12,.16,.14),lakeW)*streak*uLight*inl*(1.-swampish);
  float lanes=smoothstep(.22,.62,fspd)*smoothstep(.79,.87,fn)*.42;
  // Soft shoreline foam / wet-sand rim on lakes and rivers
  float shoreRim=(1.-smoothstep(.02,.24,column))*smoothstep(.006,.025,column)*(1.-swampish*.75);
  float bankLine=shoreRim*(.22+.38*smoothstep(.12,.5,fspd))*smoothstep(.48,.74,sn(vUV*.24-flow*uTime*.06));
  freshFoam=max(max(freshFoam,lanes),bankLine)*inl;

  // ---- Floating vegetation layer (Ref D & C): patchy duckweed, water lettuce & lily-pad clusters
  //      with domain-warped noise masks so the carpet breaks into clumps and open dark channels.
  float slowZone=(1.-smoothstep(.08,.26,fspd))*inl*(1.-smoothstep(.8,2.8,depth));
  float vegHab=clamp(swampish*1.18+slowZone*.42,0.,1.)*smoothstep(.02,.14,column)*(1.-silt*.65);
  if(vegHab>.01){
   vec2 wp=vUV+vec2(sn(vUV*.032+1.7)-.5,sn(vUV*.032+8.3)-.5)*16.+flow*uTime*.025;
   // Open dark channels cut through the floating mat
   float chanField=abs(sn(wp*.024+vec2(4.1,-2.3))-.5);
   float openChan=smoothstep(.045,.15,chanField)*(1.-smoothstep(.11,.24,fspd));
   // Multi-scale clump mask: large rafts + smaller detached clusters
   float macroClump=sn(wp*.052)*.58+sn(wp*.13+5.7)*.42;
   float microClump=mix(.55,sn(vUV*1.4)*.6+sn(vUV*4.2+2.1)*.4,1.-smoothstep(.15,.85,pixel));
   float carpetField=macroClump*openChan*(.72+.28*microClump);
   // Soft contact shadow / darkening halo slightly wider than the plant clumps
   floatShadow=smoothstep(.34,.52,carpetField)*vegHab;
   floatMat=smoothstep(.44,.58,carpetField)*vegHab*(.82+.18*smoothstep(.35,.7,microClump));
   lettuce=smoothstep(.54,.72,sn(wp*.29+9.1))*floatMat;
   lilyClump=smoothstep(.60,.76,sn(wp*.19-4.4))*(1.-lettuce*.7)*floatMat;
  }
 }
 vec2 boatWakeUV=(vUV-uSeaWakeBox.xy)/max(uSeaWakeBox.z,1.)+.5;
 float boatWakeEdge=1.-smoothstep(.38,.49,max(abs(boatWakeUV.x-.5),abs(boatWakeUV.y-.5)));
 float boatFoam=texture2D(uSeaWake,boatWakeUV).b*boatWakeEdge*(1.-inl);
 float foam=max(max(max(fftFoam,coverage),freshFoam),boatFoam*.8)*mix(.72,1.,detail)*.86;
 foam*=1.-smoothstep(3200.,11000.,distanceToEye);
 // foam is a rough, bright, slightly translucent layer lit by sun and sky only
 float wrap=clamp((dot(N,uSun)+.3)/1.3,0.,1.);
 vec3 foamLit=vec3(.72,.755,.77)*(hzSoft()*(.42+.16*N.y)*uLight+uSunCol*wrap*.55+vec3(.015,.02,.03)*uNight)*(.82+.18*relief);
 color=mix(color,foamLit,foam);alpha=mix(alpha,1.,foam);

 // Contact darkening under and around the floating aquatic plant clumps
 if(floatShadow>.002){
  color*=1.-.46*floatShadow*(1.-floatMat*.55);
 }
 if(floatMat>.002){
