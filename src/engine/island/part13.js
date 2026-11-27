// island.js - part 13/21 (statements 152-159 of the original module).
import * as Qe from "three";
import { buildFreshwaterGeometry } from "../hydrology.js";
import { Ie, ne, re } from "./part01.js";
import { ft } from "./part06.js";
import { ui } from "./part12.js";
import { FRESHWATER_VERTEX, freshwaterFragment } from "../freshwater-surface.js";

function hi(o) {
  let e = [],
    t = [],
    r = [],
    s = [],
    sw = [],
    c = (u) => {
      (e.push(u.x, ui, u.z),
        t.push(u.fx, u.fz, u.depth, u.sed),
        r.push(re(u.mask, 0, 1) * ne(0, 1.1, u.depth)),
        s.push(u.river),
        sw.push(u.sw, u.lk));
    },
    a = (u, d, p) => ({
      x: u.x + (d.x - u.x) * p,
      z: u.z + (d.z - u.z) * p,
      signed: 0,
      depth: u.depth + (d.depth - u.depth) * p,
      fx: u.fx + (d.fx - u.fx) * p,
      fz: u.fz + (d.fz - u.fz) * p,
      sed: u.sed + (d.sed - u.sed) * p,
      river: u.river + (d.river - u.river) * p,
      mask: u.mask + (d.mask - u.mask) * p,
      sw: u.sw + (d.sw - u.sw) * p,
      lk: u.lk + (d.lk - u.lk) * p,
    }),
    n = (u) => {
      let d = [];
      for (let p = 0; p < u.length; p++) {
        let x = u[p],
          f = u[(p + 1) % u.length];
        (x.signed >= 0 && d.push(x),
          x.signed >= 0 != f.signed >= 0 &&
            d.push(a(x, f, x.signed / (x.signed - f.signed))));
      }
      return d;
    },
    i = o.N,
    m = new Float32Array(i * i);
  for (let u = 0; u < i * i; u++)
    m[u] = o.wet[u] ? 1 : o.h[u] < 0 ? ne(0.42, 0.94, o.inl[u]) : 0;
  let h = (u) => {
    let d = -o.h[u],
      p = Math.hypot(o.flowX[u], o.flowZ[u]),
      lk = o.lakeId && o.lakeId[u] >= 0 ? 1 : 0;
    return {
      x: ((u % i) + 0.5) * o.cell - o.half,
      z: (((u / i) | 0) + 0.5) * o.cell - o.half,
      signed: d,
      depth: Math.max(0, d),
      fx: o.flowX[u],
      fz: o.flowZ[u],
      sed: o.sed[u],
      river: re(ne(0.045, 0.36, p), 0, 1),
      mask: m[u],
      sw: o.swamp ? re(o.swamp[u] * (1 - lk * 0.85), 0, 1) : 0,
      lk,
    };
  };
  for (let u = 0; u < i - 1; u++)
    for (let d = 0; d < i - 1; d++) {
      let p = u * i + d,
        x = [p, p + i, p + 1, p + i + 1],
        f = 0;
      for (let b of x) f = Math.max(f, m[b]);
      if (f <= 0.02) continue;
      let v = x.map(h);
      for (let b of [
        [0, 1, 2],
        [2, 1, 3],
      ]) {
        let g = n(b.map((M) => v[M]));
        for (let M = 1; M + 1 < g.length; M++) (c(g[0]), c(g[M]), c(g[M + 1]));
      }
    }
  let l = new Qe.BufferGeometry();
  return (
    l.setAttribute("position", new Qe.Float32BufferAttribute(e, 3)),
    l.setAttribute("aWater", new Qe.Float32BufferAttribute(t, 4)),
    l.setAttribute("aEdge", new Qe.Float32BufferAttribute(r, 1)),
    l.setAttribute("aRiver", new Qe.Float32BufferAttribute(s, 1)),
    l.setAttribute("aSwamp", new Qe.Float32BufferAttribute(sw, 2)),
    l.setAttribute("aMask", new Qe.Float32BufferAttribute(r, 1)),
    l.computeBoundingSphere(),
    l
  );
}
const mi = FRESHWATER_VERTEX;
const fi = freshwaterFragment(ft);
function Ir(o, e) {
  let t = buildFreshwaterGeometry(o),
    r = new Qe.ShaderMaterial({
      uniforms: e,
      vertexShader: mi,
      fragmentShader: fi,
      transparent: !0,
      depthWrite: !1,
      side: Qe.DoubleSide,
      blending: Qe.NormalBlending,
      forceSinglePass: true,
    }),
    s = new Qe.Mesh(t, r);
  return ((s.renderOrder = 2), (s.frustumCulled = !0), s);
}
function Pr(o, e) {
  let t = Ie(o.seed ^ 305874191),
    r = [],
    s = [],
    c = Math.max(2, Math.round(o.N / 180));
  for (let m = 1; m < o.N - 1; m += c)
    for (let h = 1; h < o.N - 1; h += c) {
      let l = m * o.N + h;
      if (!(!o.wet[l] || o.swamp[l] < 0.42) && !(t() > 0.30))
        for (let u = 0; u < 3; u++)
          (r.push(
            ((l % o.N) + t()) * o.cell - o.half,
            0.14 + t() * 1.45,
            (((l / o.N) | 0) + t()) * o.cell - o.half,
          ),
            s.push(t()));
    }
  if (!r.length) return null;
  let a = new Qe.BufferGeometry();
  (a.setAttribute("position", new Qe.Float32BufferAttribute(r, 3)),
    a.setAttribute("aSeed", new Qe.Float32BufferAttribute(s, 1)));
  let n = new Qe.ShaderMaterial({
      uniforms: e,
      transparent: !0,
      depthWrite: !1,
      blending: Qe.NormalBlending,
      vertexShader: `attribute float aSeed;uniform float uTime;varying float vFade;varying float vSeed;
      void main(){vec3 p=(modelMatrix*vec4(position,1.)).xyz;
        float phase=fract(uTime*(.024+aSeed*.024)+aSeed*13.);
        p.y+=phase*(.55+aSeed*1.25);p.xz+=vec2(sin(aSeed*49.+uTime*.06),cos(aSeed*73.+uTime*.045))*5.5;
        vec4 clip=viewMatrix*vec4(p,1.);gl_Position=projectionMatrix*clip;
        gl_PointSize=min(220.,(58.+aSeed*80.)*180./max(-clip.z,1.));
        float above=step(0.,cameraPosition.y);
        vFade=above*sin(phase*3.14159)*smoothstep(5.,22.,-clip.z)*(1.-smoothstep(240.,520.,-clip.z));
        vSeed=aSeed;}`,
      fragmentShader: `uniform vec3 uSunCol;uniform float uLight,uTwi,uNight,uStorm;
      varying float vFade;varying float vSeed;
      void main(){
      vec2 uv=gl_PointCoord-.5;
      float d=length(uv*vec2(1.0,1.45))*2.;
      float soft=exp(-d*d*2.4)*(1.-smoothstep(.45,1.,d));
      float a=soft*vFade*(.032+.038*uTwi+.018*uStorm)*(1.-.55*uNight);
      if(a<.001)discard;
      vec3 dayMist=vec3(.80,.88,.82)*max(uLight,.14);
      vec3 goldMist=mix(dayMist,uSunCol*vec3(1.05,.96,.82)*max(uLight,.22),uTwi*.68+.18);
      vec3 col=mix(goldMist,vec3(.14,.20,.26),uNight*.85);
      gl_FragColor=vec4(col,a);}`,
    }),
    i = new Qe.Points(a, n);
  return ((i.renderOrder = 2.5), i);
}
var ro = 8e3,
  Vr = 400,
  Gr = 10;
function ra(o, e, t, r) {
  let s =
    (Math.imul(o | 0, 374761393) +
      Math.imul(e | 0, 668265263) +
      Math.imul(t | 0, 2246822519) +
      Math.imul(r | 0, 1597334677)) |
    0;
  return (
    (s = Math.imul(s ^ (s >>> 13), 1274126177)),
    (s ^= s >>> 16),
    (s >>> 0) / 4294967296
  );
}
function Or(o, e, t) {
  return (o === 0 && e === 0) || ra(o, e, 1, t) < 0.72;
}
function Mn(o, e, t) {
  let r = o === 0 && e === 0,
    s = [3200, 4e3, 4800, 5400],
    c = r ? 7200 : s[Math.floor(ra(o, e, 2, t) * s.length)],
    a = c / 2,
    n = Math.max(ro / 2 - a - 150, 0),
    i = (o + 0.5) * ro + (ra(o, e, 3, t) * 2 - 1) * n - ro / 2,
    m = (e + 0.5) * ro + (ra(o, e, 4, t) * 2 - 1) * n - ro / 2;
  return {
    ix: o,
    iz: e,
    key: `${o},${e}`,
    cx: i,
    cz: m,
    seed: Math.floor(ra(o, e, 9, t) * 1e9) ^ t,
    N: Math.round(c / Gr),
    cell: Gr,
    span: c,
    half: a,
    isHome: r,
  };
}
export { Ir, Mn, Or, Pr, Vr, ro };
