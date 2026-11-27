  float microF=1.-smoothstep(.08,.45,pixel);
  float texG=mix(.5,sn(vUV*2.6)*.6+sn(vUV*7.8)*.4,microF);
  // Warm sunlit yellow-green duckweed base, ribbed lime water-lettuce rosettes, and deep-green lily pads
  vec3 duckCol=mix(vec3(.20,.34,.065),vec3(.34,.47,.115),texG);
  vec3 letCol=mix(vec3(.26,.42,.10),vec3(.39,.52,.15),texG);
  vec3 padCol=mix(vec3(.11,.24,.048),vec3(.21,.34,.082),texG);
  vec3 matAlbedo=mix(duckCol,letCol,lettuce);
  matAlbedo=mix(matAlbedo,padCol,lilyClump);
  // Subtle normal relief on plant clusters so low sunlight catches clump edges
  vec3 pN=normalize(vec3((texG-.5)*.28,1.,(sn(vUV*2.6+4.1)-.5)*.28));
  float pSun=max(dot(pN,uSun),0.);
  vec3 matLit=matAlbedo*(hzSoft()*(.36+.14*pN.y)*uLight+uSunCol*pSun*.64+vec3(.01,.015,.02)*uNight);
  // Contact shadow rim at the edge of each clump
  matLit*=.76+.24*smoothstep(.05,.45,floatMat);
  color=mix(color,matLit,clamp(floatMat*.92,0.,1.));
  alpha=mix(alpha,1.,clamp(floatMat*.95,0.,1.));
 }

 float edgeAA=max(fwidth(column)*.7,.0008);
 // Soft shoreline transparency grading smoothly over the shallowest 4 cm
 float shoreline=smoothstep(.005,.028+edgeAA,column);
 color*=shoreline;alpha*=shoreline;
  // Subtle atmospheric wetland mist at dawn/twilight and in low swamp basins
  float mistWisp=.65+.35*sn(vUV*.014+vec2(uTime*.012,-uTime*.008));
  float dawnMist=(uTwi*.0032+uDay*.00045)*(1.-uNight)*swampish*mistWisp*exp(-max(cameraPosition.y,0.)*.065);
  float fog=1.-exp(-distanceToEye*(uFog+dawnMist));
 color=mix(color,horizon(),fog);alpha=mix(alpha,1.,fog);
 alpha*=1.-freshTakeover;
 gl_FragColor=vec4(color/max(alpha,.0001),alpha);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
 gl_FragColor.rgb*=gl_FragColor.a;
}`;
export { En, Rn };
