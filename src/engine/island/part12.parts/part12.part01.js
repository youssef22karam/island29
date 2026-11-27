// island.js - part 12/21 (statements 146-151 of the original module).
import { K_GLSL, K_FRAG, K_BED } from "../kelp/sea.js";
import * as St from "three";
import { or } from "./part05.js";
import { ft } from "./part06.js";
import { Wo } from "./part10.js";
import { aa } from "./part11.js";
import { SHORE_CORE_GLSL } from "../shore-waves.js";

var Wr = `
varying vec3 vW,vN;varying float vH;varying vec2 vL;
void main(){vec4 w=modelMatrix*vec4(position,1.);vW=w.xyz;vL=position.xz;vN=normalize(mat3(modelMatrix)*normal);vH=position.y;gl_Position=projectionMatrix*viewMatrix*w;}`,
  Nr =
    ft +
    aa +
    or +
    Wo +
    K_GLSL +
    K_FRAG +
    K_BED +
    SHORE_CORE_GLSL +
    `
uniform sampler2D uHM,uHydro,uShoreTex;
uniform sampler2D uForestMap,uForestNormal,uGravelMap,uGravelNormal,uRockMap,uRockNormal;
uniform vec4 uHB;
uniform float uHs,uFog,uPeak,uFade;
varying vec3 vW,vN;
varying float vH;
varying vec2 vL;
#define WIND vec2(.8253,.5646)
vec2 islandUV(vec2 p){return (p-uHB.xy)/uHB.z*.5+.5;}
// the island texture holds the terrain (left half) and the fresh-water fields (right half)
vec4 HM(vec2 uv){return texture2D(uHM,vec2(uv.x*.5,uv.y));}
vec4 WM(vec2 uv){return texture2D(uHM,vec2(uv.x*.5+.5,uv.y));}
#ifdef SHCHEAP
#define SH_N 6
#define SH_A 3.
#define SH_B 8.
#elif defined(LOWQ)
#define SH_N 8
#define SH_A 2.1
#define SH_B 6.
#else
#define SH_N 14
#define SH_A 1.52
#define SH_B 4.
#endif
float sunShadow(vec3 p){
 if(uSun.y<.02)return 0.;
 float sh=1.,t=4.5;
 for(int i=0;i<SH_N;i++){
  vec3 q=p+uSun*t;
  vec2 uv=islandUV(q.xz);
  if(max(abs(uv.x-.5),abs(uv.y-.5))>.495)break;
  float d=q.y-HM(uv).r;
  // Crisp relief shadow edge so ridges cast sharp silhouettes across valleys and lakes
  sh=min(sh,smoothstep(-.35,2.4+t*.016,d));
  if(sh<.01)break;
  t=t*SH_A+SH_B;
  if(t>2400.)break;
 }
 return clamp(sh,0.,1.);
}
vec3 sampleRock(vec3 p,vec3 n,float pixel){
 vec3 tb=pow(abs(n),vec3(4.5));tb/=dot(tb,vec3(1.));
 float broad=fbm(p.yz*.014)*tb.x+fbm(p.xz*.014)*tb.y+fbm(p.xy*.014)*tb.z;
 float dA=1.-smoothstep(1.8,6.5,pixel);
 #ifdef LOWQ
 dA=0.;
 #endif
 float detail=.5;
 if(dA>.01)detail=mix(.5,fbm(p.yz*.095)*tb.x+fbm(p.xz*.095)*tb.y+fbm(p.xy*.095)*tb.z,dA);
 // Vertical karst water-fluting & erosion fissures + horizontal limestone strata
 float flute=fbm(vec2((p.x-p.z)*.085,p.y*.018))*tb.z+fbm(vec2((p.z+p.x)*.085,p.y*.018))*tb.x+.5*tb.y;
 float fissure=1.-smoothstep(.02,.16,abs(flute-.5));
 float rockNoise=clamp(broad*.58+detail*.28+flute*.14,0.,1.);
 float strata=mix(.5,sin(p.y*.52+broad*6.2+detail*2.2)*.5+.5,1.-smoothstep(2.2,8.,pixel));
 // Weathered warm-grey tropical limestone & coastal granite with sunlit buff facets
 float sunFace=.42+.58*max(dot(n,uSun),0.);
 float coastalBand=(1.-smoothstep(2.5,24.,p.y))*smoothstep(.5,2.2,p.y);
 vec3 warmAsh=mix(vec3(.21,.205,.192),vec3(.37,.355,.325),rockNoise);
 vec3 paleLimestone=mix(vec3(.38,.37,.34),vec3(.54,.515,.465),rockNoise);
 vec3 baseRock=mix(warmAsh,paleLimestone,clamp(smoothstep(28.,165.,p.y)*.48*sunFace+coastalBand*.52,0.,1.));
 baseRock=mix(baseRock,baseRock*vec3(1.12,1.06,.95),strata*.22);
 baseRock*=1.-.28*fissure*(1.-tb.y);
 // Wave-wetted dark mineral notch right at sea level
 float waveNotch=1.-smoothstep(.15,1.65,p.y);
 baseRock*=1.-.32*waveNotch;
 vec3 scan=texture2D(uRockMap,p.yz*.095).rgb*tb.x
   +texture2D(uRockMap,p.xz*.095+vec2(.31,.73)).rgb*tb.y
   +texture2D(uRockMap,p.xy*.095+vec2(.57,.19)).rgb*tb.z;
 baseRock*=mix(vec3(1.),scan*2.15,.38*dA);
 // Lush tropical moss, clinging vines & emerald shelf greenery on rock ledges & damp flutes
 float ledgeMoss=smoothstep(.42,.76,n.y+broad*.26-.08)*smoothstep(.30,.72,detail*.65+broad*.35);
 float chuteVines=fissure*smoothstep(.18,.55,n.y+broad*.2)*smoothstep(2.5,8.,p.y)*(1.-smoothstep(140.,260.,p.y));
 float greenPatch=clamp(max(ledgeMoss,chuteVines*.78)*(1.-waveNotch),0.,1.);
 vec3 rockGreen=mix(vec3(.095,.215,.046),vec3(.205,.325,.082),detail);
 return mix(baseRock,rockGreen,greenPatch*.76);
}
// fade a [0,1] pattern of the given period to its mean once a pixel covers ~half a period
float bandLimit(float v,float mean,float period,float pixel){return mix(mean,v,1.-smoothstep(period*.25,period*.6,pixel));}

// sparse round grains on a jittered grid, exact integer hash (no float-hash lattice):
// x = coverage of a grain here, y = that grain's random id. aa = pixel size in cells.
vec2 grains(vec2 q,float density,float radius,float aa,uint seed){
 vec2 i=floor(q),f=q-i;ivec2 c=ivec2(i);
 float id=bHash2(c,seed);
 vec2 o=vec2(bHash2(c,seed^0x9e3779b9u),bHash2(c,seed^0x7f4a7c15u))*.56+.22;
 float r=radius*(.55+.9*fract(id*13.17));
 float d=length(f-o);
 return vec2((1.-smoothstep(r-aa,r+aa,d))*step(id,density),fract(id*7.31));
}
// aeolian ripples across the constant trade wind; warped so crests bend, fork and fade.
// returns (height, dh/dx, dh/dz) in metres
vec3 ripple(vec2 l,float lambda,float amp,float warp){
 vec2 wq=l*(.11/lambda);
 float w=(vn(wq)-.5+(vn(wq*2.3+19.3)-.5)*.5)*warp;
 float ph=fract(dot(l,WIND)/lambda+w)*6.2831853;
 float a=ph+.55*sin(ph);
 float s=sin(a),ds=cos(a)*(1.+.55*cos(ph))*6.2831853/lambda;
 return vec3(s,WIND*ds)*amp;
}
// wave-formed ripples on the lagoon floor, crests parallel to the local shore
// (three fixed orientations blended by the shore direction: no large-coordinate drift)
vec3 waveRipple(vec2 l,vec2 dir,float lambda,float amp){
 vec3 r=vec3(0.);float ws=0.;
 for(int k=0;k<3;k++){
  float a=float(k)*1.0471976;
  vec2 D=vec2(cos(a),sin(a));
  float wgt=pow(abs(dot(D,dir)),8.)+1e-4;
  float wv=(vn(l*.27+float(k)*7.1)-.5)*1.1;
  float ph=fract(dot(l,D)/lambda+wv)*6.2831853;
  float b=ph+.35*sin(ph);
  r+=vec3(sin(b),D*cos(b)*(1.+.35*cos(ph))*6.2831853/lambda)*wgt;ws+=wgt;
 }
 return r/ws*amp;
}
// animated caustic network: distance to the borders of drifting Voronoi cells
float causticCell(vec2 q,float t){
 vec2 i=floor(q),f=q-i;float d1=8.,d2=8.;
 for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
  vec2 g=vec2(float(x),float(y));
  vec2 hh=vec2(h12(i+g),h12(i+g+17.3));
  vec2 o=.5+.38*sin(t*(.7+.6*hh)+6.2831*hh.yx);
  vec2 r=g+o-f;float d=dot(r,r);
  if(d<d1){d2=d1;d1=d;}else if(d<d2)d2=d;
 }
 return sqrt(d2)-sqrt(d1);
}
float causticNet(vec2 l,float t){
 vec2 w=l+(vec2(vn(l*.37+t*.11),vn(l*.37-t*.09+5.2))-.5)*.9;
 float a=causticCell(w*1.15,t*1.1);
 float b=causticCell(w*1.6+9.7,-t*.9+3.);
 float la=1.-smoothstep(0.,.16,a),lb=1.-smoothstep(0.,.16,b);
 return la*.65+lb*.45+la*lb*.9;
}

void main(){
 vec3 kAlb=vec3(0.);float kBedW=0.;
 vec2 p=vW.xz,uv=islandUV(p);
 vec2 l=vL+uBiome.xy;
 float h=vH;
 float pixel=length(fwidth(p));
 vec3 V=cameraPosition-vW;float dist=length(V);V/=max(dist,.001);
 vec3 Ng=normalize(vN);
 float slope=1.-Ng.y;
 float grad=sqrt(max(1.-Ng.y*Ng.y,0.))/max(Ng.y,.08);
 #ifdef FAR0
 // Far-field path: matched albedo, rock exposure, and lightweight relief shadow so there is zero darkening seam.
 vec3 farCol=vec3(0.);float farMix=smoothstep(FAR0,FAR1,dist);
 if(farMix>0.){
  vec4 fh=texture2D(uHydro,uv);
  float sl=1.-Ng.y;
  vec3 sandF=mix(vec3(.46,.39,.275),vec3(.29,.245,.175),1.-smoothstep(-.2,.9,h));
  float lowMeadow=(1.-smoothstep(28.,95.,h))*(1.-smoothstep(.09,.26,sl));
  vec3 grassF=mix(vec3(.10,.205,.044),vec3(.20,.315,.075),lowMeadow*.7);
  float vegF=smoothstep(2.2,6.8,h)*(1.-smoothstep(.24,.46,sl));
  vec3 colF=mix(sandF,grassF,vegF);
  colF=mix(colF,vec3(.18,.23,.10),smoothstep(.46,.82,h/max(uPeak,80.))*vegF);
  float rockF=clamp(smoothstep(.16,.36,sl)*smoothstep(3.2,12.,h),0.,1.);
  float ledgeF=(1.-smoothstep(.15,.26,sl))*smoothstep(4.5,10.,h);
  rockF*=1.-ledgeF*.78;
  colF=mix(colF,mix(vec3(.29,.28,.25),vec3(.46,.44,.39),smoothstep(18.,160.,h)*.6+.3),rockF);
  colF=mix(colF,vec3(.7,.74,.72),smoothstep(480.,650.,h)*(1.-smoothstep(.26,.62,sl))*.86);
  colF=mix(colF,vec3(.62,.57,.45),1.-smoothstep(-1.1,0.,h));
  float nlF=max(dot(Ng,uSun),0.);
  float shF=1.;
  if(nlF>.01&&uSun.y>.03){
   float tf=18.;
   for(int i=0;i<4;i++){
    vec3 qf=vW+Ng*1.2+uSun*tf;
    vec2 uvf=islandUV(qf.xz);
    if(max(abs(uvf.x-.5),abs(uvf.y-.5))>.495)break;
    shF=min(shF,smoothstep(-.5,3.5+tf*.02,qf.y-HM(uvf).r));
    tf=tf*2.6+24.;
   }
  }
  shF=mix(.42,1.,shF);
  vec3 ambF=hzSoft()*(.27+.21*Ng.y)*uLight*mix(.82,1.,fh.b)+vec3(.14,.22,.21)*(1.-Ng.y)*.2*uLight*uDay+vec3(.016,.024,.039)*uNight;
  colF*=ambF+uSunCol*nlF*.66*shF+vec3(.08,.11,.17)*uNight*max(dot(Ng,uMoon),0.);
  float fogF=1.-exp(-dist*uFog*1.12);
  vec3 aerF=mix(horizon(),mix(horizon(),vec3(.45,.61,.63)*uLight,.32),uDay*(1.-uStorm));
  colF=mix(colF,aerF,fogF);
  farCol=mix(horizon(),colF,uFade);
  if(farMix>.999){
   gl_FragColor=vec4(farCol,1.);
   #include <tonemapping_fragment>
   #include <colorspace_fragment>
   return;
  }
 }
 #endif
 float macro=fbm(p*.009);
 float meso=fbm(p*.038)*.5+.5;
 float fine=1.-smoothstep(.3,.9,pixel);
 vec4 coast=HM(uv);
  vec4 hydro=texture2D(uHydro,uv);
  float wetCell=hydro.g;
  float bankH=h-hydro.r;
 float cd=max(-coast.g,0.);
 vec4 wm=WM(uv);
  float fresh=max(hydro.a,mix(wm.g,wm.r,1.-smoothstep(-.12,.1,h)));
  float marsh=wetCell>.4?wm.g:h>0.?wm.r:wm.g;
  // Open coastal beaches & river-mouth sandbars stay sunlit coral sand; dark soil stays inland.
  float freshSoil=max(fresh*smoothstep(65.,175.,cd),marsh*.88);
 vec2 bumpG=vec2(0.);

 // ---- shoreline (shore-waves.js): moisture left by the last swashes, the glossy
 //      backwash film, the dark contact line and shadow of the uprush lip, and the
 //      bubbles stranded at the top of the run-up. Same waves as the water shader.
 float wet=0.,contact=0.,film=0.,lipShadow=0.,sFoam=0.;
 {
  float wetFar=1.-smoothstep(-.08,mix(.16+.035*min(uShH,6.),.1,freshSoil),h);
  wet=wetFar;
  float sok=1.-smoothstep(.485,.495,max(abs(uv.x-.5),abs(uv.y-.5)));
  if(h<5.&&h>-4.&&sok>0.){
   vec4 SF=texCubic(uShoreTex,uv,float(textureSize(uShoreTex,0).x));
   float seaCoast=1.-smoothstep(.25,.6,max(fresh,marsh));
   ShoreWave sw=shoreWave(p,h,coast.g,coast.zw,SF,sok,seaCoast,pixel);
   if(sw.w>.001){
    wet=mix(wetFar,sw.wet,sw.w);
    film=sw.film*sw.w;
    float nearS=1.-smoothstep(.08,.5,pixel);
    contact=sw.front*.55*sw.w*nearS;
    lipShadow=sw.front*.6*smoothstep(0.,.15,uSun.y)*sw.w*nearS;
    vec2 fp=p-sw.dir*sw.sx;
    float lace=shzNoise(fp*1.9)*.6+shzNoise(fp*5.1+vec2(2.,7.))*.4;
    sFoam=(sw.strand*smoothstep(.42,.68,lace)+sw.front*.3*smoothstep(.5,.78,lace))*sw.w*(1.-.5*smoothstep(.05,.4,pixel));
   }
  }
 }
 wet=max(wet,1.-smoothstep(-.2,.04,h));
  // capillary-wet darkened bank band along every river, lake, and swamp waterline
  float dampZone=freshSoil*(1.-smoothstep(.04,.58+.45*marsh,bankH));
  wet=max(wet,dampZone*.92);
 float wetDark=smoothstep(.02,.88,wet);
 float gloss=wet*wet*(.42+.58*max(film,dampZone*(1.-smoothstep(.0,.36,bankH))*.72));

 // ---- plant cover: the shared field, band-limited to its mean far away
 vec2 vc=h>.12?vegCover(l,h,cd,grad,fresh):vec2(0.);
 float cov=vc.x;
 float veg=mix(vc.y,smoothstep(.12,.72,cov),smoothstep(.5,2.4,pixel));
  // Open sculpted sandy/shingle riverbanks and sunny littoral lake beaches breathe naturally before grass rises
  float openShore=freshSoil*(1.-marsh*.75)*(1.-smoothstep(.35,1.65+.55*vn(l*.028+4.1),bankH))*(1.-smoothstep(.28,.55,grad)*.5);
  veg*=(1.-openShore*.86);
  cov*=(1.-openShore*.8);
  if(wetCell>.35&&bankH<.14){cov=0.;veg=0.;}
 float outcropN=fbm(p*.025+5.1)*.10-.045;
 float coastalCliff=smoothstep(.135,.30,slope+outcropN*.75)*smoothstep(2.4,5.4,h)*(1.-smoothstep(145.,250.,cd));
 float mountainCliff=smoothstep(.175,.37,slope+outcropN)*max(smoothstep(11.,32.,h),fresh*smoothstep(2.2,8.5,bankH));
 float cliffMask=clamp(max(coastalCliff,mountainCliff),0.,1.);
 // Lush green cover crowning tops, shoulders, and benches of rocky coastal hills & mountains!
 float hillCrown=smoothstep(4.2,9.2,h)*(1.-smoothstep(.14,.25,slope))*(1.-openShore*.75);
 veg=max(veg,hillCrown*.92);
 cov=max(cov,hillCrown*.85);
 float margin=smoothstep(0.,.18,cov)*(1.-smoothstep(.5,.92,cov));
 float sandW=(1.-veg)*(1.-cliffMask);

 // =============================== SAND ===============================
 vec3 sand=vec3(.46,.385,.265);float sparkle=0.;
 if(sandW>.002||h<.6){
  // Luminous tropical white-cream coral & shell beaches with gentle golden warmth
  float zone=vn(l*.0085+3.1)*.65+vn(l*.031+7.7)*.35;
  vec3 dry=mix(vec3(.42,.35,.245),vec3(.50,.425,.305),smoothstep(.24,.78,zone));
  dry=mix(dry,vec3(.35,.31,.245),smoothstep(.68,.94,vn(l*.011+11.))*.32);
  // wind streaks elongated along the trade wind, compaction mottling
  vec2 lw=vec2(dot(l,WIND),dot(l,vec2(-WIND.y,WIND.x)));
  float streak=bandLimit(vn(lw*vec2(.07,.75)),.5,1.3,pixel)*.55+vn(lw*vec2(.025,.2))*.45;
  float mott=bandLimit(vn(l*.43),.5,2.3,pixel)*.55+bandLimit(vn(l*1.7),.5,.6,pixel)*.45;
  dry*=(.9+.2*streak)*(.94+.12*mott);
  // loose dry sand up the beach is paler, the firm berm below it darker
  dry*=mix(.93,1.04,smoothstep(1.8,4.5,h));
  // ---- wind ripples: in drifting fields, never on the wet face or under plants
  float ripField=smoothstep(.3,.62,vn(l*.06+5.3))*(1.-smoothstep(.15,.6,wet))*(1.-smoothstep(.04,.3,cov))*smoothstep(1.6,2.6,h);
  float rA=(1.-smoothstep(.05,.17,pixel))*ripField;
  if(rA>.01){
   vec3 r=ripple(l,.46,.02,1.3);
   bumpG+=r.yz*rA;
   dry*=1.+r.x*2.2*rA;
  }
  float rB=(1.-smoothstep(.012,.04,pixel))*ripField;
  if(rB>.01){vec3 r=ripple(l+3.7,.13,.0045,1.6);bumpG+=r.yz*rB;}
  // ---- shell hash, coral rubble and dark grains (resolved near; their mean tint beyond)
  float gA=1.-smoothstep(.008,.024,pixel);
  dry*=mix(1.025,1.,gA);
  if(gA>.01){
   vec2 sh=grains(l*13.,.07,.16,pixel*13.,0x51ed270bu);
   vec3 shellC=mix(vec3(.60,.56,.48),vec3(.55,.40,.34),step(.72,sh.y));
   shellC=mix(shellC,vec3(.42,.38,.34),step(.9,sh.y));
   dry=mix(dry,shellC,sh.x*gA*smoothstep(1.2,2.4,h));
   vec2 dk=grains(l*29.+5.,.14,.2,pixel*29.,0x2545f491u);
   dry=mix(dry,vec3(.13,.12,.105),dk.x*gA*.75);
  }
  // ---- wrack line: stranded weed and bleached debris at the spring-tide limit
  float wd=wrackDist(l);
  float wrW=.7+.9*vn(l*.13+2.);
  float wrB=(1.-smoothstep(wrW*.35,wrW,abs(cd-wd+(vn(l*.19)-.5)*2.6)))*smoothstep(.35,.62,vn(l*.045+8.));
  float wr2=(1.-smoothstep(.15,.5,abs(cd-wd+6.5+(vn(l*.23+4.)-.5)*2.)))*smoothstep(.45,.7,vn(l*.05+1.))*.6;
  float wrack=max(wrB,wr2)*(1.-smoothstep(.5,.9,wet))*(1.-smoothstep(.1,.4,cov));
  if(wrack>.01){
   float wrF=1.-smoothstep(.02,.07,pixel);
   float bits=.34;
   vec3 weedC=vec3(.11,.095,.055);
   if(wrF>.01){
    vec2 wg=grains(l*9.,.62,.3,pixel*9.,0x68e31da4u);
    vec2 wg2=grains(l*21.+2.,.55,.28,pixel*21.,0xb5297a4du);
    bits=mix(bits,max(wg.x,wg2.x),wrF);
    weedC=mix(weedC,mix(vec3(.16,.13,.07),vec3(.07,.07,.045),wg.y),wrF);
    weedC=mix(weedC,vec3(.62,.58,.5),step(.86,wg2.y)*wg2.x*wrF);
   }
   dry*=1.-.14*wrack;
   dry=mix(dry,weedC,wrack*bits*.65);
  }
  // ---- swash marks: faint arcs of fine dark grains left at old run-up limits
  float swL=(1.-smoothstep(1.2,2.6,h))*(1.-smoothstep(.5,.85,wet))*(1.-smoothstep(.06,.25,pixel));
  if(swL>.01){
   float sl=abs(fract(cd*.29+vn(l*.07)*1.6)-.5);
   dry*=1.-.12*(1.-smoothstep(.02,.05,sl))*swL;
  }
  // ---- wet sand: warm golden-tan swash sheen (never muddy charcoal)
  vec3 wetS=mix(vec3(.29,.235,.158),vec3(.36,.295,.205),meso)*(.92+.12*mott);
  sand=mix(dry,wetS,wetDark*.82);
  // bubbles left on the sand by the last uprush drain away in a few seconds
  sand=mix(sand,vec3(.72,.74,.74),clamp(sFoam,0.,1.)*.7);
  bumpG*=1.-.85*wetDark;
  // ---- glints: single quartz and shell facets catching the sun (very near only)
  float spA=(1.-smoothstep(.0035,.011,pixel))*(1.-wetDark*.6);
  if(spA>.01&&uSun.y>.04){
   ivec2 c=ivec2(floor(l*70.));
   vec3 fn=normalize(vec3(bHash2(c,0xa54ff53au)-.5,.55,bHash2(c,0x510e527fu)-.5));
   sparkle=pow(max(dot(fn,normalize(V+uSun)),0.),90.)*step(.9,bHash2(c,0x3c6ef372u))*spA*smoothstep(.04,.2,uSun.y);
  }
 }

 // ---- enhanced river, lake & swamp shores and banks: sunlit alluvial sand,
 //      graded river-shingle pebble point bars, mossy rock shelves, damp earthy
 //      stratified cutbanks, glossy dark wet waterlines, and rich swamp peat/moss
 if(freshSoil>.01){
  float mn=vn(l*.19)*.58+bandLimit(vn(l*1.25),.5,.75,pixel)*.42;
  float patchN=fbm(l*.026+3.7)*.5+.5;
  float drySandBand=smoothstep(.28,.92,patchN)*(1.-marsh*.88)*(1.-smoothstep(.28,.6,grad));
  // Sun-warmed golden river sand & variegated shingle bars
  vec3 warmSand=mix(vec3(.42,.365,.27),vec3(.55,.485,.365),mn);
  vec3 silt=mix(vec3(.30,.26,.19),vec3(.41,.355,.265),mn);
  vec3 dryBank=mix(silt,warmSand,drySandBand*.82);
  // Natural damp golden-ochre waterline band
  vec3 wetBand=mix(vec3(.24,.205,.15),vec3(.33,.285,.21),mn);
  // Deep fertile glistening swamp peat, root-mottled humus & vibrant sphagnum moss cushions framing blackwater shores
  vec3 peat=mix(vec3(.048,.044,.026),vec3(.105,.092,.048),mn);
  float sphagnum=smoothstep(.34,.72,vn(l*.11+4.8)*.62+vn(l*.42-2.3)*.38)*marsh;
  float mossEdge=smoothstep(.88,.08,bankH)*(1.-drySandBand*.38)*smoothstep(.26,.68,vn(l*.14+9.4));
  vec3 bank=mix(dryBank,wetBand,wetDark*.86);
  bank=mix(bank,mix(vec3(.085,.155,.042),vec3(.175,.255,.072),mn),mossEdge*(.46+.44*marsh));
  bank=mix(bank,peat,marsh*.86);
  bank=mix(bank,mix(vec3(.078,.168,.038),vec3(.165,.265,.068),mn),sphagnum*smoothstep(.04,.55,bankH)*(1.-smoothstep(.9,2.8,bankH))*.72);
  // Delicate warm alluvial sand ripples on wide sunny inner-bend bars & lake shores
  float barRip=(1.-smoothstep(.04,.18,pixel))*drySandBand*(1.-wetDark*.55)*(1.-smoothstep(.8,2.2,bankH));
  if(barRip>.01){vec3 sr=ripple(l+5.1,.52,.015,1.2);bumpG+=sr.yz*barRip;bank*=1.+sr.x*1.5*barRip;}
  // Rich sculpted gravel & flat shingle cobblestone point bars fading smoothly cleanly into water
  float textureFade=1.-smoothstep(.35,2.0,pixel);
  vec2 uvBank=l*.22;
  vec3 gravel=texture2D(uGravelMap,uvBank).rgb;
  float barMask=(1.-smoothstep(.6,2.8,bankH))*(1.-marsh*.88)*smoothstep(.18,.58,vn(l*.030+12.));
  vec3 cobbleTint=mix(vec3(.68,.63,.55),vec3(.52,.54,.52),vn(l*.08+2.1));
  bank=mix(bank,gravel*cobbleTint*mix(.56,.96,1.-wetDark*.82),barMask*textureFade*.80);
  vec3 gravelN=texture2D(uGravelNormal,uvBank).rgb*2.-1.;
  bumpG+=gravelN.xy*barMask*textureFade*.28;
  // Stratified earthen warm-brown outer cutbanks (smooth slope transition, no harsh black seams!)
  float cutSlope=smoothstep(.16,.48,grad)*(1.-marsh*.65);
  float strata=smoothstep(.25,.75,vn(vec2(dot(l,vec2(.04,.04)),bankH*2.8)));
  vec3 cutEarth=mix(vec3(.155,.120,.082),vec3(.265,.202,.135),strata);
  float cutBand=freshSoil*smoothstep(.02,.22,bankH)*(1.-smoothstep(.45,2.8,bankH))*cutSlope;
  bank=mix(bank,cutEarth,cutBand*.58);
  // Subtle damp capillary rim smoothly kissing water edge (dark natural wet-sand tone, zero soot line)
  float waterMark=smoothstep(-.05,.04,bankH)*(1.-smoothstep(.06,.34,bankH))*freshSoil;
  bank*=1.-.18*waterMark;
  // Multi-scale crisp rounded pebbles & variegated mineral cobbles along river & lake edges
  float gvC=1.-smoothstep(.03,.11,pixel);
  if(gvC>.01&&marsh<.72){
   vec2 cBig=grains(l*2.6,.48,.34,pixel*2.6,0x51a7e31du);
   vec3 cCol=mix(vec3(.24,.23,.21),vec3(.56,.51,.43),cBig.y);
   cCol=mix(cCol,vec3(.36,.40,.41),step(.64,cBig.y)*step(cBig.y,.80));
   cCol=mix(cCol,vec3(.48,.38,.29),step(.80,cBig.y));
   float cobW=cBig.x*gvC*(1.-smoothstep(.45,1.85,bankH))*(1.-marsh*.85)*(0.45+0.55*barMask);
   bank=mix(bank,cCol*mix(1.,.58,wetDark),cobW*.82);
  }
  float gv=1.-smoothstep(.014,.052,pixel);
  if(gv>.01&&marsh<.8){
   vec2 gr=grains(l*6.8,.36,.32,pixel*6.8,0x7b8f1d3fu);
   vec3 pCol=mix(vec3(.26,.24,.21),vec3(.58,.53,.45),gr.y);
   bank=mix(bank,pCol*mix(1.,.64,wetDark),gr.x*gv*(1.-smoothstep(.35,1.35,bankH))*(1.-marsh*.85));
  }
  sand=mix(sand,bank,freshSoil);
 }
 // ========================= PLANT-COVERED GROUND =========================
 float ce=8./(2.*uHB.z);
 float hc=coast.r;
 float hn=(HM(uv+vec2(ce,0.)).r+HM(uv-vec2(ce,0.)).r+HM(uv+vec2(0.,ce)).r+HM(uv-vec2(0.,ce)).r)*.25;
 float curv=clamp((hn-hc)/8.,-.65,.65);
 // Bare sculpted rock shows on steep coastal/lake/river bluffs & sharp mountain crags,
 // while flatter ledges & hilltops keep lush green cover!
 float crestRock=smoothstep(-.045,-.19,curv)*smoothstep(22.,85.,h);
 float rockExposure=clamp(max(cliffMask,crestRock*.92+smoothstep(.20,.42,slope)*smoothstep(28.,95.,h)*.85),0.,1.);
 rockExposure*=1.-hillCrown*.76;

 float gTint=vn(p*.021)*.65+.35*vn(p*.13);
 float gDry=smoothstep(.60,.84,vn(p*.013+9.));
 float meadowPatch=smoothstep(.38,.74,fbm(p*.014+7.3));
 vec3 forestGreen=mix(vec3(.082,.182,.038),vec3(.165,.278,.066),gTint);
 // Bright, vivid tropical jungle, valley-floor and hilltop greens
 vec3 meadowGreen=mix(vec3(.145,.268,.058),vec3(.255,.365,.092),gTint);
 float isLowMeadow=(1.-smoothstep(28.,95.,h))*(1.-smoothstep(.09,.26,slope));
 float floodBasin=freshSoil*(1.-smoothstep(0.,14.,h))*(1.-smoothstep(.08,.22,slope));
 vec3 grass=mix(forestGreen,meadowGreen,clamp(meadowPatch*.55+isLowMeadow*.68+floodBasin*.45,0.,1.))*(.86+.25*macro);
 grass=mix(grass,vec3(.30,.28,.10),gDry*.36*(1.-floodBasin));
 // the seaward fringe: salt-burnt, yellower turf
 grass=mix(grass,mix(vec3(.19,.21,.075),vec3(.31,.29,.13),gTint),margin*.8*(1.-freshSoil));
 // lush riparian floodplain and marsh greens
 grass=mix(grass,mix(vec3(.09,.20,.038),vec3(.20,.29,.068),gTint),freshSoil*.65);
 grass=mix(grass,mix(vec3(.08,.125,.035),vec3(.15,.185,.058),gTint),marsh*.68);
 vec3 highland=mix(vec3(.13,.165,.078),vec3(.22,.23,.13),macro)*(.88+.22*meso);
 float highlandMask=smoothstep(.46,.82,h/max(uPeak,80.)+macro*.12);
 // sandy soil, straw litter and creepers where the cover thins out onto the sand
 vec3 soil=mix(vec3(.29,.24,.165),vec3(.22,.185,.12),meso);
 sand=mix(sand,soil,margin*.6*(1.-wetDark)*(1.-freshSoil));
 float vineN=vn(l*.19+(vec2(vn(l*.8),vn(l*.8+4.))-.5)*1.4);
 float vine=smoothstep(.6,.7,vineN)*margin*(1.-smoothstep(.3,.7,wet));
 vec3 vineC=mix(vec3(.07,.13,.04),vec3(.14,.21,.06),bandLimit(vn(l*3.1),.5,.32,pixel));
 float straw=smoothstep(.55,.82,vn(l*.33+13.))*margin;

 vec3 color=mix(sand,grass,veg);
 if(freshSoil>.1&&h>.1){
  float nearGround=(1.-smoothstep(.3,1.3,pixel))*freshSoil;
  float litter=veg*(.32+.44*smoothstep(.34,.7,vn(l*.05)));
  vec2 forestUV=l*.21;
  vec3 floorColor=texture2D(uForestMap,forestUV).rgb;
  color=mix(color,floorColor*mix(.68,1.03,smoothstep(.3,3.,h)),litter*nearGround);
  bumpG+=(texture2D(uForestNormal,forestUV).xy*2.-1.)*litter*nearGround*.17;
 }
 color=mix(color,vec3(.33,.29,.15),straw*.4*(1.-veg));
 color=mix(color,vineC,vine*(1.-veg)*.72);
 color=mix(color,highland,highlandMask*veg);
 if(rockExposure>.002)color=mix(color,sampleRock(vW,Ng,pixel),rockExposure);
  float snow=smoothstep(480.,650.,h+35.*(macro-.5))*(1.-smoothstep(.26,.62,slope));
  color=mix(color,mix(vec3(.57,.63,.64),vec3(.83,.86,.82),meso),snow*.86*(1.-wetCell));

 // =============================== LAGOON & FRESHWATER BED ===============================
  float bedH=wetCell>.35?bankH:h;
  if(bedH<.3){
   float depthB=max(-bedH,0.);
  vec2 sdir=normalize(coast.zw+vec2(1e-4));
  float cw=.12+min(pixel*.02,.2);
  float coral=smoothstep(.62-cw,.62+cw,fbm(p*.035+3.))*smoothstep(.4,2.6,depthB)*(1.-smoothstep(9.,22.,depthB));
  vec3 reef=mix(vec3(.38,.25,.16),vec3(.20,.31,.17),meso);
   vec3 lag=mix(vec3(.64,.59,.47),vec3(.76,.71,.58),meso)*(.94+.14*bandLimit(vn(l*.35),.5,2.9,pixel));
  // seagrass meadows
  float sg=smoothstep(.55,.66,fbm(l*.026+21.))*smoothstep(.7,1.8,depthB)*(1.-smoothstep(8.,15.,depthB));
  vec3 sgC=mix(vec3(.09,.15,.06),vec3(.17,.23,.09),bandLimit(vn(l*2.1),.5,.48,pixel));
  vec3 seabed=mix(lag,sgC,sg);
  seabed=mix(seabed,reef,coral);
  float heads=.1;
  float hd=1.-smoothstep(.35,1.2,pixel);
  if(hd>.01)heads=mix(.1,smoothstep(.7,.92,fbm(p*.13+9.)),hd);
  seabed=mix(seabed,vec3(.33,.19,.24),heads*coral*.7);
  // wave ripples on bare lagoon sand, crests along the beach
  float uwA=(1.-smoothstep(.06,.2,pixel))*(1.-sg)*(1.-coral)*smoothstep(.15,.8,depthB)*(1.-smoothstep(6.,12.,depthB));
  if(uwA>.01){vec3 r=waveRipple(l,sdir,.75,.035);bumpG+=r.yz*uwA;seabed*=1.+r.x*1.5*uwA;}
  // coral rubble and shells
  float rbA=1.-smoothstep(.01,.03,pixel);
  if(rbA>.01){vec2 rb=grains(l*8.,.08,.22,pixel*8.,0x1f83d9abu);seabed=mix(seabed,mix(vec3(.28,.26,.22),vec3(.7,.66,.58),rb.y),rb.x*rbA*(1.-sg));}
  // caustics: drawn where resolved, their mean brightness beyond (no lattice, no flicker)
  float cDetail=1.-smoothstep(.035,.14,pixel);
 #ifdef LOWQ
 cDetail=0.;
 #endif
  float caus=.2;
  if(cDetail>.01)caus=mix(.2,causticNet(l,uTime),cDetail);
  caus*=smoothstep(.04,.7,depthB)*(1.-smoothstep(4.,13.,depthB))*smoothstep(.02,.15,uSun.y);
  seabed*=1.+uSunCol*caus*.28;
  // ---- kelp3-inspired underwater floor beneath lakes, rivers, and swamps ----
  // Pale sculpted rippled kelp-forest sand (#a8a090), rocky coralline/mossy reef
  // mats (#c88a8a & #8a9a5a), flowing variegated river cobbles & sunlit gravel bars,
  // golden-olive kelp meadow shadows, dark velvety swamp peat/moss pockets, and
  // luminous chromatic Voronoi caustics adapted faithfully from kelp3.
   float inlB=max(smoothstep(.25,.9,wm.r)*(1.-step(.3,h)),wetCell*(1.-step(.3,bankH)));
  if(inlB>.001){ // kelp3's own floor (kelp/sea.js): sand scans and pebbles, rippled sand between, bedrock breaking through.
vec2 fl=wm.ba;float fsp=length(fl); float run=smoothstep(.08,.40,fsp); float swBed=clamp(wm.g,0.,1.)*(1.-run*.55); vec3 kBump; vec3 freshBed=kBed(vW,pixel,run,swBed,kBump); kAlb=freshBed; kBedW=inlB*(1.-smoothstep(-1.1,0.,bedH)); bumpG-=kBump.xz/max(kBump.y,.25)*kBedW; seabed=mix(seabed,freshBed,inlB); }
   color=mix(color,seabed,1.-smoothstep(-1.1,0.,bedH));
 }

 // fine sand grain right under the viewer (keeps the beach crisp instead of smeared)
 float g9=1.-smoothstep(.03,.1,pixel),g23=1.-smoothstep(.012,.04,pixel);
 float micro=bandLimit(vn(p*.75),.5,1.33,pixel);
 float grain=0.;
 if(g9>.01)grain=(vn(l*9.)-.5)*.10*g9+(g23>.01?(vn(l*23.)-.5)*.06*g23:0.);
 color*=1.+(micro-.5)*.12*fine+grain*sandW;

 // micro relief -> shading normal (ripples light up under a low sun)
 vec3 N=Ng;
 if(fine>.01)N+=vec3(vn(p*.8)-.5,0.,vn(p*.8+11.)-.5)*.1*fine;
 float grainFade=1.-smoothstep(.03,.1,pixel);
 if(grainFade>.01)N+=vec3(vn(l*6.3)-.5,0.,vn(l*6.3+5.)-.5)*.07*grainFade;
 N=normalize(N+vec3(-bumpG.x,0.,-bumpG.y));
  if(rockExposure>.15&&pixel<1.4){
   vec3 tb=pow(abs(Ng),vec3(4.));tb/=dot(tb,vec3(1.));
   vec3 nx=texture2D(uRockNormal,vW.yz*.10).rgb*2.-1.;
   vec3 ny=texture2D(uRockNormal,vW.xz*.10+vec2(.31,.73)).rgb*2.-1.;
   vec3 nz=texture2D(uRockNormal,vW.xy*.10+vec2(.57,.19)).rgb*2.-1.;
   vec3 rn=normalize(vec3(nx.z*tb.x+ny.x*tb.y+nz.x*tb.z,
     nx.x*tb.x+ny.z*tb.y+nz.y*tb.z,nx.y*tb.x+ny.y*tb.y+nz.z*tb.z));
   N=normalize(mix(N,rn,rockExposure*.37*(1.-smoothstep(.5,1.4,pixel))));
  }

 float nl=max(dot(N,uSun),0.);
 float reliefSh=1.;
 if(dot(Ng,uSun)>-.05)reliefSh=sunShadow(vW+Ng*.6);
 float propSh=1.;
 #ifdef PROP_SHADOWS
 propSh=mix(.74,1.,propShadow(vW+Ng*.04));
 #endif
 float shadow=mix(.38,1.,reliefSh)*propSh*(1.-.28*lipShadow);
 // Balanced tropical ambient + turquoise lagoon & warm sand bounce light on cliff walls (zero crushed black shadows!)
 float cavity=1.-.28*clamp(curv*2.2,0.,1.)+.18*clamp(-curv*2.2,0.,1.);
 float canopyShade=1.-.08*veg*(1.-isLowMeadow*.8)*(1.-rockExposure);
 float ambientOcclusion=(.82+.18*N.y)*mix(1.,cavity,smoothstep(-.3,.6,h))*canopyShade*mix(.82,1.,hydro.b);
 vec3 cliffBounce=mix(vec3(.13,.24,.23),vec3(.24,.21,.15),smoothstep(0.,90.,cd))*clamp(.68-.48*N.y,0.,1.)*.26*uLight*uDay;
 vec3 ambient=(hzSoft()*(.27+.21*N.y)*uLight+cliffBounce)*ambientOcclusion+vec3(.018,.027,.044)*uNight;
 color*=ambient+uSunCol*nl*.66*shadow+vec3(.08,.11,.17)*uNight*max(dot(N,uMoon),0.);
 color*=1.-.3*contact;
 color+=uSunCol*sparkle*shadow*.9;

 float mistBand=exp(-pow((h-46.)/34.,2.))*(1.-smoothstep(.05,.3,slope));
 if(mistBand>.01){
  float mistConcave=max(0.,-curv)*1.4;
  vec2 mistP=p*vec2(.006,.009)+vec2(uTime*.0045,uTime*.0022);
  float mistTex=smoothstep(.48,.82,fbm(mistP)*.75+vn(mistP*3.1)*.35);
  float mist=mistBand*mistTex*(.34+.66*mistConcave)*uLight*(1.-uStorm*.7)*(1.-uNight);
  color=mix(color,hzSoft()*.86+vec3(.02)*uLight,mist*.2);
 }

 if(gloss>.002){
  float nv=clamp(dot(N,V),.02,1.);
  float sheen=(.02+.26*pow(1.-nv,5.))*gloss*.5;
  vec3 R=reflect(-V,N);R.y=abs(R.y);
  color=mix(color,sky(R)*.85,sheen);
  color+=uSunCol*pow(max(dot(R,uSun),0.),220.)*gloss*.05*shadow;
 }

