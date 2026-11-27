  // When submerged in a lake/river/swamp (Dive mode), seamlessly apply kelp3
  // red-first Beer-Lambert water absorption + sunward directional scattering haze!
  if(kUnder>.5){ // Under the surface the bed is lit as kelp3 lights its floor, caustics over it, and everything is finished
// by the water between it and the eye (kelp/sea.js).
vec3 kc=color; if(kBedW>.001){ vec3 kl=kLit(kAlb,N,V,.92)*mix(.5,1.,shadow)+kAlb*kCausticsAt(vW,N)*(2.2*mix(.15,1.,shadow)); kc=mix(color,kl,kBedW); } color=kSeen(kc,vW); }else{ if(kBedW>.001){ // Seen from the air: the same floor under the island's own light, the caustics playing over it.
color+=kAlb*kCausticsAt(vW,N)*(1.3*kBedW*shadow*(1.-smoothstep(.25,1.4,pixel))); color*=mix(vec3(1.),kThrough(max(-vW.y,0.)*.55),kBedW); }
  float dawnMist=uTwi*(1.-uNight)*marsh*exp(-max(h,0.)*.65)*exp(-max(cameraPosition.y,0.)*.07)*.0028;
  float fog=1.-exp(-dist*(uFog*1.12+dawnMist));
  vec3 aerialHz=mix(horizon(),mix(horizon(),vec3(.45,.61,.63)*uLight,.32),uDay*(1.-uStorm));
  color=mix(color,aerialHz,fog);
 }
 color=mix(horizon(),color,uFade);
 #ifdef FAR0
 color=mix(color,farCol,farMix);
 #endif
 gl_FragColor=vec4(color,1.);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
}`;
var na = 8;
function Br(o = 256) {
  let e = 2654435769,
    t = () => (
      (e ^= e << 13),
      (e ^= e >>> 17),
      (e ^= e << 5),
      (e >>> 0) / 4294967296
    ),
    r = (l) => {
      let u = new Float32Array(l * l);
      for (let x = 0; x < u.length; x++) u[x] = t();
      let d = new Float32Array(o * o),
        p = (x) => x * x * x * (x * (x * 6 - 15) + 10);
      for (let x = 0; x < o; x++)
        for (let f = 0; f < o; f++) {
          let v = (f / o) * l,
            b = (x / o) * l,
            g = Math.floor(v),
            M = Math.floor(b),
            w = p(v - g),
            E = p(b - M),
            k = g % l,
            R = (g + 1) % l,
            H = M % l,
            C = (M + 1) % l,
            W = u[H * l + k],
            T = u[H * l + R],
            P = u[C * l + k],
            L = u[C * l + R];
          d[x * o + f] = (W + (T - W) * w) * (1 - E) + (P + (L - P) * w) * E;
        }
      return d;
    },
    s = (l) => {
      let u = new Float32Array(o * o),
        d = 1,
        p = 0;
      for (let v = 0; v < 4; v++) {
        let b = r(l << v);
        for (let g = 0; g < u.length; g++) u[g] += b[g] * d;
        ((p += d), (d *= 0.5));
      }
      let x = 1e9,
        f = -1e9;
      for (let v = 0; v < u.length; v++)
        ((u[v] /= p), (x = Math.min(x, u[v])), (f = Math.max(f, u[v])));
      for (let v = 0; v < u.length; v++) u[v] = (u[v] - x) / (f - x);
      return u;
    },
    c = s(4),
    a = s(6),
    n = new Uint8Array(o * o * 4),
    i = (l, u) => c[((u + o) % o) * o + ((l + o) % o)],
    m = (l) =>
      Math.max(0, Math.min(255, Math.round(((l / na) * 0.5 + 0.5) * 255)));
  for (let l = 0; l < o; l++)
    for (let u = 0; u < o; u++) {
      let d = (l * o + u) * 4,
        p = (i(u + 1, l) - i(u - 1, l)) * 0.5 * o,
        x = (i(u, l + 1) - i(u, l - 1)) * 0.5 * o;
      ((n[d] = m(p * 0.045)),
        (n[d + 1] = m(x * 0.045)),
        (n[d + 2] = Math.round(c[l * o + u] * 255)),
        (n[d + 3] = Math.round(a[l * o + u] * 255)));
    }
  let h = new St.DataTexture(n, o, o, St.RGBAFormat, St.UnsignedByteType);
  return (
    (h.wrapS = h.wrapT = St.RepeatWrapping),
    (h.magFilter = St.LinearFilter),
    (h.minFilter = St.LinearMipmapLinearFilter),
    (h.generateMipmaps = !0),
    (h.colorSpace = St.NoColorSpace),
    (h.needsUpdate = !0),
    h
  );
}
var ui = 0.02;
export { Br, Nr, Wr, na, ui };
