/* =============================================================================
   Shore waves: analytic surf, breaking and swash for every coast of every island
   -----------------------------------------------------------------------------
   The old shoreline was a shallow-water simulation confined to a ~300 m box that
   followed the camera. It ran slower than real time, crept up the sand like a
   diffusion front, left the rest of the coast without surf and seamed at the rim.

   This replaces it with a deterministic wave model that holds on every beach and
   rock at any distance:

   * Per island, on the CPU (once):
       - shapeBeaches(): fills the 2-3 m step + flat shelf the terrain generator
         leaves at the waterline with a Dean equilibrium profile (h = A x^2/3)
         and a soft longshore bar, so swell shoals, breaks and rolls in.
       - shoreFieldGen(): an eikonal travel-time field (fast sweeping, c=sqrt(gd))
         from the shoreline. Wave crests are its isochrones, so swell refracts
         toward every shore, wraps around headlands and slows/crowds in shallow
         water. Small rocks and islets let the swell pass by instead of
         radiating rings. Also: the minimum depth seaward of each point (bars,
         reefs), the beach-face slope and the exposure to open water.
   * In the shaders (GLSL below), per vertex and per pixel:
       - Green's-law shoaling, depth-limited breaking (gamma by Iribarren number:
         spilling, plunging, surging), saturated bores, setup, crest throw.
       - Swash: each bore launches a ballistic run-up (Stockdon 2006 height,
         decelerating uprush, accelerating backwash); later bores overrun earlier
         backwash; sets of bigger waves run further.
       - Foam: rollers, plunging bursts, trailing whitewater, residual patches,
         the bright uprush lip, bubbles stranded at the run-up limit, rock bursts.
       - Sand moisture with a memory of the last four swashes.
============================================================================= */
import * as THREE from "three";

export const SHORE_G = 9.81;
export const SHORE_DFLOOR = 0.6;
export const SHORE_DCAP = 30;
const MINOR_LAND_CELLS = 260;
const BIG = 1e9;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const fract = (v) => v - Math.floor(v);

function ihash(x, y, s) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, y, s) {
  const i = Math.floor(x), j = Math.floor(y);
  let fx = x - i, fy = y - j;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const a = ihash(i, j, s), b = ihash(i + 1, j, s), c = ihash(i, j + 1, s), d = ihash(i + 1, j + 1, s);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

// Open sea: below datum and not part of a river, lake or swamp.
function seaMask(w) {
  const { N, h } = w, NN = N * N, m = new Uint8Array(NN);
  for (let k = 0; k < NN; k++)
    m[k] = h[k] < 0 && !(w.wet && w.wet[k]) && !(w.inl && w.inl[k] > 0.6) ? 1 : 0;
  return m;
}

// Two-pass chamfer propagation of a value from source cells to every passable cell.
function nearestCarry(N, cell, src, vals, passable) {
  const NN = N * N, dist = new Float32Array(NN).fill(BIG), out = new Float32Array(NN);
  for (let k = 0; k < NN; k++) if (src[k]) { dist[k] = 0; out[k] = vals[k]; }
  const a = cell, b = cell * Math.SQRT2;
  const relax = (k, q, c) => {
    const v = dist[q] + c;
    if (v < dist[k]) { dist[k] = v; out[k] = out[q]; }
  };
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const k = j * N + i;
      if (src[k] || (passable && !passable[k])) continue;
      if (i > 0) relax(k, k - 1, a);
      if (j > 0) {
        relax(k, k - N, a);
        if (i > 0) relax(k, k - N - 1, b);
        if (i < N - 1) relax(k, k - N + 1, b);
      }
    }
  for (let j = N - 1; j >= 0; j--)
    for (let i = N - 1; i >= 0; i--) {
      const k = j * N + i;
      if (src[k] || (passable && !passable[k])) continue;
      if (i < N - 1) relax(k, k + 1, a);
      if (j < N - 1) {
        relax(k, k + N, a);
        if (i < N - 1) relax(k, k + N + 1, b);
        if (i > 0) relax(k, k + N - 1, b);
      }
    }
  return { dist, out };
}

function blur3(N, a, passes, mask) {
  let src = a, tmp = new Float32Array(a.length);
  for (let p = 0; p < passes; p++) {
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const k = j * N + i;
        if (mask && !mask[k]) { tmp[k] = src[k]; continue; }
        let s = src[k] * 2, n = 2;
        for (let dj = -1; dj <= 1; dj++) {
          const jj = j + dj;
          if (jj < 0 || jj >= N) continue;
          for (let di = -1; di <= 1; di++) {
            const ii = i + di;
            if ((di === 0 && dj === 0) || ii < 0 || ii >= N) continue;
            const q = jj * N + ii;
            if (mask && !mask[q]) continue;
            s += src[q]; n++;
          }
        }
        tmp[k] = s / n;
      }
    const t = src; src = tmp; tmp = t === a ? new Float32Array(a.length) : t;
  }
  if (src !== a) a.set(src);
  return a;
}

/* ---------------------------------------------------------------------------
   Beach profile: replace the waterline step and flat shelf with a concave
   equilibrium profile on gentle (sandy) coasts. Cliffs, river mouths and boat
   passages are left alone; depths only ever get shallower and stay below datum,
   so every land/water classification and distance field stays valid.
---------------------------------------------------------------------------- */
export function shapeBeaches(w) {
  if (!w || !w.h || w.__beachShaped) return;
  w.__beachShaped = true;
  const { N, cell, h } = w, NN = N * N;
  const sea = seaMask(w);
  const beach = new Float32Array(NN), src = new Uint8Array(NN);
  for (let j = 2; j < N - 2; j++)
    for (let i = 2; i < N - 2; i++) {
      const k = j * N + i;
      if (h[k] < 0 || !(sea[k - 1] | sea[k + 1] | sea[k - N] | sea[k + N])) continue;
      let hi = h[k];
      for (let dj = -2; dj <= 2; dj++)
        for (let di = -2; di <= 2; di++) hi = Math.max(hi, h[k + dj * N + di]);
      const slope = (hi - Math.max(h[k], 0)) / (2 * cell);
      let b = 1 - smooth(0.08, 0.3, slope);
      if (w.fresh && w.fresh[k] > 0.35) b *= 0.25;
      if (w.navMask && w.navMask[k]) b = 0;
      beach[k] = b;
      src[k] = 1;
    }
  const { dist, out } = nearestCarry(N, cell, src, beach, sea);
  const nav = w.navMask;
  for (let j = 1; j < N - 1; j++)
    for (let i = 1; i < N - 1; i++) {
      const k = j * N + i;
      if (!sea[k] || dist[k] > 720) continue;
      if (nav && (nav[k] || nav[k - 1] || nav[k + 1] || nav[k - N] || nav[k + N])) continue;
      const b = out[k] * (1 - smooth(380, 720, dist[k]));
      if (b < 0.01) continue;
      const s = Math.max(dist[k] - 0.5 * cell, 2);
      const n1 = vnoise(i * 0.045, j * 0.045, 11), n2 = vnoise(i * 0.08 + 3.1, j * 0.08 + 7.7, 23);
      const A = 0.105 + 0.06 * n1;
      let target = A * Math.pow(s, 2 / 3);
      const sb = 70 + 60 * n2;
      const bar = (0.25 + 0.55 * n1) * Math.exp(-(((s - sb) / 24) ** 2));
      target = Math.max(target - bar * Math.min(1, target / 2), 0.1);
      const d0 = -h[k];
      if (d0 > target) h[k] = -(d0 + (target - d0) * b);
    }

  // Beach face and berm above the waterline: a reflective 1:10–1:16 face up to a
  // 1.5–2.2 m berm (then easing back into the land), so each swash climbs, stalls
  // and drains back before the next bore arrives. Land is only ever raised.
  const land = new Uint8Array(NN), wet = w.wet, swamp = w.swamp, fresh = w.fresh;
  for (let k = 0; k < NN; k++) land[k] = h[k] >= 0 && !(wet && wet[k]) ? 1 : 0;
  const lc = nearestCarry(N, cell, src, beach, land);
  for (let j = 1; j < N - 1; j++)
    for (let i = 1; i < N - 1; i++) {
      const k = j * N + i;
      if (!land[k] || lc.dist[k] > 70) continue;
      if ((swamp && swamp[k] > 0.3) || (fresh && fresh[k] > 0.3)) continue;
      if (wet && (wet[k - 1] || wet[k + 1] || wet[k - N] || wet[k + N])) continue;
      const b = lc.out[k] * (1 - smooth(40, 70, lc.dist[k]));
      if (b < 0.01) continue;
      const n1 = vnoise(i * 0.05 + 5.3, j * 0.05 + 1.9, 31), n2 = vnoise(i * 0.03 + 8.1, j * 0.03 + 4.4, 37);
      const tanF = 0.062 + 0.04 * n1, berm = 1.5 + 0.7 * n2;
      const s = lc.dist[k] + 0.5 * cell, sb = berm / tanF;
      const target = s < sb ? tanF * s : berm * (1 - 0.45 * smooth(sb + 8, sb + 42, s));
      if (target > h[k]) h[k] += (target - h[k]) * b;
    }
}

/* ---------------------------------------------------------------------------
   Shore field: travel time, seaward minimum depth, beach slope and exposure,
   packed into an N x N RGBA half-float texture that matches the island texture.
---------------------------------------------------------------------------- */
export function* shoreFieldGen(w) {
  const { N, cell, h } = w, NN = N * N;
  const sea = seaMask(w);
  const landish = new Uint8Array(NN);
  for (let k = 0; k < NN; k++) landish[k] = sea[k] ? 0 : 1;

  // 1. land masses: large ones are shorelines, small rocks let the swell pass
  const major = new Uint8Array(NN), seen = new Uint8Array(NN), queue = new Int32Array(NN);
  for (let s = 0; s < NN; s++) {
    if (!landish[s] || seen[s]) continue;
    let qh = 0, qt = 0;
    queue[qt++] = s;
    seen[s] = 1;
    while (qh < qt) {
      const k = queue[qh++], i = k % N;
      const nb = [i > 0 ? k - 1 : -1, i < N - 1 ? k + 1 : -1, k - N, k + N];
      for (const q of nb)
        if (q >= 0 && q < NN && landish[q] && !seen[q]) { seen[q] = 1; queue[qt++] = q; }
    }
    if (qt >= MINOR_LAND_CELLS) for (let q = 0; q < qt; q++) major[queue[q]] = 1;
  }
  yield;

  // 2. eikonal travel time from the shoreline, c = sqrt(g d)
  const tau = new Float32Array(NN).fill(BIG), slow = new Float32Array(NN), fixed = new Uint8Array(NN);
  for (let k = 0; k < NN; k++) {
    if (major[k]) { tau[k] = 0; fixed[k] = 1; continue; }
    const d = sea[k] ? -h[k] : SHORE_DFLOOR;
    slow[k] = 1 / Math.sqrt(SHORE_G * clamp(d, SHORE_DFLOOR, SHORE_DCAP));
  }
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const k = j * N + i;
      if (fixed[k] || !sea[k]) continue;
      const dk = Math.max(-h[k], 0.02);
      for (const q of [i > 0 ? k - 1 : -1, i < N - 1 ? k + 1 : -1, j > 0 ? k - N : -1, j < N - 1 ? k + N : -1]) {
        if (q < 0 || !major[q]) continue;
        const x = dk / (dk + Math.max(h[q], 0.02));
        tau[k] = Math.min(tau[k], x * cell * slow[k]);
      }
    }
  for (let it = 0; it < 3; it++)
    for (let sw = 0; sw < 4; sw++) {
      const rev = sw & 1, up = sw & 2;
      for (let jj = 0; jj < N; jj++) {
        const j = up ? N - 1 - jj : jj;
        for (let ii = 0; ii < N; ii++) {
          const i = rev ? N - 1 - ii : ii;
          const k = j * N + i;
          if (fixed[k]) continue;
          const a = Math.min(i > 0 ? tau[k - 1] : BIG, i < N - 1 ? tau[k + 1] : BIG);
          const b = Math.min(j > 0 ? tau[k - N] : BIG, j < N - 1 ? tau[k + N] : BIG);
          const f = slow[k] * cell;
          let t;
          if (Math.abs(a - b) >= f) t = Math.min(a, b) + f;
          else t = 0.5 * (a + b + Math.sqrt(2 * f * f - (a - b) * (a - b)));
          if (t < tau[k]) tau[k] = t;
        }
      }
      yield;
    }
  for (let k = 0; k < NN; k++) if (tau[k] >= BIG * 0.5) tau[k] = 0; else if (tau[k] > 2000) tau[k] = 2000;

  // 3. shoreward direction: down the travel-time gradient at sea, uphill on land
  const dX = new Float32Array(NN), dZ = new Float32Array(NN);
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const k = j * N + i;
      let x = w.dirX[k], z = w.dirZ[k];
      if (!major[k] && i > 0 && j > 0 && i < N - 1 && j < N - 1) {
        const gx = tau[k + 1] - tau[k - 1], gz = tau[k + N] - tau[k - N], g = Math.hypot(gx, gz);
        if (g > 1e-6) { x = -gx / g; z = -gz / g; }
      }
      dX[k] = x; dZ[k] = z;
    }
  blur3(N, dX, 2);
  blur3(N, dZ, 2);
  for (let k = 0; k < NN; k++) {
    const l = Math.hypot(dX[k], dZ[k]);
    if (l > 1e-6) { dX[k] /= l; dZ[k] /= l; }
  }
  yield;

  // 4. beach-face slope around the waterline, carried to every cell
  const bSrc = new Uint8Array(NN), bVal = new Float32Array(NN);
  for (let j = 1; j < N - 1; j++)
    for (let i = 1; i < N - 1; i++) {
      const k = j * N + i;
      if (h[k] < -3 || h[k] > 3 || (!sea[k] && h[k] < 0)) continue;
      const nb = [k - 1, k + 1, k - N, k + N];
      const edge = sea[k] ? nb.some((q) => landish[q]) : nb.some((q) => sea[q]);
      if (!edge) continue;
      bVal[k] = clamp(Math.hypot(h[k + 1] - h[k - 1], h[k + N] - h[k - N]) / (2 * cell), 0.012, 1.5);
      bSrc[k] = 1;
    }
  const beta = nearestCarry(N, cell, bSrc, bVal, null).out;
  blur3(N, beta, 3);
  yield;

  // 5. exposure: how much open water each stretch of coast looks out on
  const eSrc = new Uint8Array(NN), eVal = new Float32Array(NN);
  const RAYS = 24, STEP = 2, MAXS = 70;
  for (let j = 1; j < N - 1; j++) {
    for (let i = 1; i < N - 1; i++) {
      const k = j * N + i;
      if (!sea[k] || !(landish[k - 1] | landish[k + 1] | landish[k - N] | landish[k + N])) continue;
      let sum = 0;
      for (let r = 0; r < RAYS; r++) {
        const an = (r / RAYS) * Math.PI * 2, cx = Math.cos(an) * STEP, cz = Math.sin(an) * STEP;
        let x = i + 0.5, z = j + 0.5, open = 1;
        for (let s = 1; s <= MAXS; s++) {
          x += cx; z += cz;
          const xi = x | 0, zi = z | 0;
          if (xi < 0 || zi < 0 || xi >= N || zi >= N) break;
          const q = zi * N + xi;
          if (h[q] >= 0.3 || (landish[q] && h[q] >= 0)) { open = s / MAXS; break; }
        }
        sum += open;
      }
      eVal[k] = smooth(0.06, 0.46, sum / RAYS);
      eSrc[k] = 1;
    }
    if ((j & 127) === 0) yield;
  }
  const expo = nearestCarry(N, cell, eSrc, eVal, null).out;
  blur3(N, expo, 3);
  yield;

  // 6. shallowest depth seaward along the ray: bars and reefs break waves early
  const dmin = new Float32Array(NN);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const k = j * N + i;
      if (!sea[k]) continue;
      let m = -h[k];
      if (tau[k] < 600) {
        let x = i + 0.5, z = j + 0.5;
        for (let s = 0; s < 28; s++) {
          x -= dX[k]; z -= dZ[k];
          const xi = x | 0, zi = z | 0;
          if (xi < 0 || zi < 0 || xi >= N || zi >= N) break;
          const q = zi * N + xi;
          if (!sea[q]) break;
          m = Math.min(m, -h[q]);
        }
      }
      dmin[k] = Math.max(m, 0.02);
    }
    if ((j & 127) === 0) yield;
  }
  blur3(N, dmin, 1, sea);

  // 7. pack
  const toHalf = THREE.DataUtils.toHalfFloat, data = new Uint16Array(NN * 4);
  for (let k = 0; k < NN; k++) {
    data[k * 4] = toHalf(tau[k]);
    data[k * 4 + 1] = toHalf(dmin[k]);
    data[k * 4 + 2] = toHalf(clamp(beta[k], 0.012, 1.5));
    data[k * 4 + 3] = toHalf(clamp(expo[k], 0, 1));
  }
  const texture = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.HalfFloatType);
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  w.shoreDirX = dX;
  w.shoreDirZ = dZ;
  return { texture, tau, dmin, beta, expo };
}

/* ---------------------------------------------------------------------------
   GLSL. The core needs uTime, uStorm (scene chunk) and uShT, uShH, uSwDir
   (surf chunk) to be declared before it.
---------------------------------------------------------------------------- */
export const SHORE_CORE_GLSL = /* glsl */ `
#define SHZ_G 9.81
#define SHZ_DFLOOR 0.6
#define SHZ_DCAP 30.
uniform float uFoamGain,uWetDry;
float shzHash(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
float shzHash1(float n){return shzHash(vec2(n,n*.7548+13.7));}
float shzNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
 return mix(mix(shzHash(i),shzHash(i+vec2(1.,0.)),f.x),mix(shzHash(i+vec2(0.,1.)),shzHash(i+vec2(1.,1.)),f.x),f.y);}
// per-wave height: sets of bigger waves (beating trains) and wave-to-wave scatter;
// a varies along the coast so a set never arrives evenly along a whole beach
float shzAmp(float n,float a){
 float g=.84+.17*sin(n*.79+a*4.3)+.09*sin(n*2.03+1.7+a*2.6);
 return clamp(g*(.8+.4*shzHash1(n)),.5,1.4);
}
// Stockdon et al. (2006) 2% run-up, vertical metres
float shzRunup(float H,float L0,float beta){
 float s=sqrt(max(H,.02)*L0);float b=min(beta,.35);
 return clamp(1.1*(.35*b*s+.5*s*sqrt(.563*b*b+.004)),.05,2.6);
}
// swash tip elevation tp seconds after a bore reaches the waterline:
// decelerating uprush, a brief stall, then an accelerating backwash
float shzTip(float tp,float R,float zr,float Tu,float Tb){
 if(tp<Tu){float s=tp/Tu;return zr+(R-zr)*(1.-(1.-s)*(1.-s));}
 float s=min((tp-Tu)/Tb,1.);return zr+(R-zr)*(1.-s*s);
}
struct ShoreWave{
 float eta;vec2 grad;vec2 disp;vec2 vel;
 float foam;float roller;float face;
 float swash;float tip;float front;float strand;float sheet;float sx;
 float wet;float film;float w;float dry;vec2 dir;
};
// p world xz, bed elevation, sdist signed coast distance (+ sea), dirIn landward,
// F = (travel time, seaward min depth, beach slope, exposure), fw = filter width (m)
ShoreWave shoreWave(vec2 p,float bed,float sdist,vec2 dirIn,vec4 F,float ok,float calm,float fw){
 ShoreWave o;
 o.eta=0.;o.grad=vec2(0.);o.disp=vec2(0.);o.vel=vec2(0.);o.foam=0.;o.roller=0.;o.face=0.;
 o.swash=0.;o.tip=-9.;o.front=0.;o.strand=0.;o.sheet=0.;o.sx=0.;o.wet=0.;o.film=0.;o.w=0.;o.dry=0.;
 vec2 dir=dirIn/max(length(dirIn),1e-4);o.dir=dir;
 float d=max(-bed,0.);
 o.w=clamp(ok*calm*max(1.-smoothstep(12.,26.,d),1.-smoothstep(40.,110.,sdist)),0.,1.);
 if(o.w<=.001)return o;
 float t=uTime,T=max(uShT,4.),L0=1.56*T*T,storm=clamp(uStorm,0.,1.);
 float tau=F.r,dmin=max(F.g,.03),beta=clamp(F.b,.012,1.5),expo=clamp(F.a,0.,1.);
 // the stretch of coast this ray lands on: peaks, shoulders and peeling sections
 vec2 ps=p+dir*clamp(sdist,-60.,500.);
 float a1=shzNoise(ps*.0062+vec2(7.1,2.3)),a2=shzNoise(ps*.019+vec2(3.3,9.7));
 float phA=(a1-.5)*.9+(a2-.5)*.3*(1.+storm);
 // open coasts facing the swell take its full height; lee and sheltered shores less
 float facing=smoothstep(-.35,.75,dot(dir,uSwDir));
 float H0=uShH*.8*mix(.16,1.,expo)*mix(.48,1.,facing)*(.84+.32*a2);

 // ---- surf zone: shoaling, breaking, the travelling bore
 float theta=(t+tau)/T+phA;
 float n=floor(theta),ph=theta-n;
 float Hn=H0*mix(shzAmp(n,a1),shzAmp(n+1.,a1),smoothstep(.3,.8,ph));
 float dd=max(d,.03);
 float Hs=Hn*pow(10./clamp(dd,.05,10.),.25);
 float xi=min(beta,.6)/sqrt(max(Hn,.05)/L0);
 float plunge=smoothstep(.35,1.1,xi)*(1.-smoothstep(2.3,3.8,xi));
 float gB=mix(.72,1.,smoothstep(.2,1.4,xi)),gS=mix(.42,.6,smoothstep(.2,1.4,xi));
 float dB=pow(Hn*1.778/gB,.8);
 float brk=smoothstep(dB*1.04,dB*.8,dd);
 float Hl=min(Hs,mix(gB,gS,smoothstep(dB,dB*.55,dd))*dd);
 float barB=smoothstep(dB*1.04,dB*.8,dmin)*(1.-brk);
 Hl=min(Hl,mix(Hl,gS*dmin*1.3,barB));
 float bi=Hs/(gB*dd);
 float steep=smoothstep(.4,1.,bi)*(1.-brk);
 float L=sqrt(SHZ_G*clamp(dd,.3,25.))*T;
 float fr=mix(.5,.2,steep);fr=mix(fr,mix(.1,.055,plunge),brk);
 float np=1.+2.2*steep+.5*brk;
 float bl=fw/L;
 fr=max(fr,min(.5,bl*1.8));np=mix(np,1.,smoothstep(.06,.25,bl));
 float back1=1.-fr;
 bool onBack=ph<back1;
 float u=onBack?.5*ph/back1:.5+.5*(ph-back1)/fr;
 float du=onBack?.5/back1:.5/fr;
 float cu=.5+.5*cos(6.2831853*u);
 float P=pow(max(cu,0.),np);
 float mean=inversesqrt(3.14159*(np+.25));
 float dP=-np*pow(max(cu,1e-4),np-1.)*3.14159*sin(6.2831853*u)*du;
 float setup=.15*min(Hn*1.3,gB*dB)*(1.-clamp(dd/dB,0.,1.));
 float onset=smoothstep(dB*1.3,dB*.97,dd)*smoothstep(dB*.4,dB*.8,dd);
 float crest=pow(max(cu,0.),4.);
 float lean=Hl*mix(.16,.5,plunge)*onset*crest;
 float etaS=Hl*(P-mean)+setup+.12*lean;
 float cE=sqrt(SHZ_G*clamp(dd,SHZ_DFLOOR,SHZ_DCAP));
 vec2 gradS=-dir*(Hl*dP/(cE*T));
 vec2 velS=dir*clamp(etaS*sqrt(SHZ_G/max(dd,.25)),-2.5,3.5);
 float tS=ph*T;
 float life=mix(3.,8.,storm)*clamp(uFoamGain,.4,2.);
 float frontF=smoothstep(back1-.07,1.,ph);
 float roller=brk*max(frontF,exp(-tS/(.1*T)))*smoothstep(.02,.14,Hl);
 float trail=brk*exp(-tS/life)*smoothstep(.02,.1,Hl);
 float burst=onset*(.4+.8*plunge)*exp(-tS/1.7)*smoothstep(.12,.4,Hl);
 float spill=smoothstep(.78,1.04,bi)*(1.-brk)*smoothstep(.75,1.,cu)*(.35+.65*storm);
 float resid=max(brk,barB*exp(-max(dd-dmin,0.)*.7))*(.16+.34*storm)*smoothstep(.04,.25,Hl);
 float foamS=max(max(roller*1.1,trail*.9),max(burst,max(spill,resid)));
 float faceS=steep*(onBack?0.:smoothstep(.5,.85,u));

 // ---- swash: the bore collapses at the waterline and runs up the beach face
 float bS=clamp(beta,.015,.6);
 float thS=(t+tau*smoothstep(2.,8.,tau))/T+phA+.08;
 float nS=floor(thS);
 float zf=-9.,tpL=0.,RL=.1,zrL=-.1,TuL=1.,TbL=1.,HL=Hn;
 float wetM=0.,filmM=0.;
 for(int k=0;k<4;k++){
  float nk=nS-float(k);
  float tp=(thS-nk)*T;
  float Hk=H0*shzAmp(nk,a1);
  float Rk=shzRunup(Hk,L0,bS)*(1.+.15*storm)+.06*Hk*storm;
  float zrk=-.05-.12*Hk;
  float U0=sqrt(2.*SHZ_G*max(Rk-zrk,.01));
  float Tsw=clamp(1.15*U0/(SHZ_G*bS),.45*T,2.*T);
  float Tu=.38*Tsw,Tb=.62*Tsw;
  float z=tp<Tsw?shzTip(tp,Rk,zrk,Tu,Tb):zrk;
  if(z>zf){zf=z;tpL=tp;RL=Rk;zrL=zrk;TuL=Tu;TbL=Tb;HL=Hk;}
  if(Rk>bed){
   float q=clamp((bed-zrk)/(Rk-zrk),0.,1.);
   if(tp>Tu*(1.-sqrt(1.-q))){
    float since=max(tp-(Tu+Tb*sqrt(1.-q)),0.);
    wetM=max(wetM,exp(-since/(14.*max(uWetDry,.2))));
    filmM=max(filmM,exp(-since/2.4));
   }
  }
 }
 float Rm=shzRunup(H0,L0,bS)*(1.+.15*storm);
 float reach=shzRunup(H0*1.4,L0,bS)*(1.+.15*storm)/bS*1.15+10.;
 float gate=1.-smoothstep(reach,reach+12.,max(-sdist,0.));
 float hTip=zf-bed;
 float covered=step(0.,hTip)*gate;
 float kap=mix(.42,.18,smoothstep(TuL*.8,TuL*1.5,tpL));
 float hSw=min(max(hTip,0.)*kap,.04+.2*HL+.08*RL)*gate;
 float wsw=1.-smoothstep(0.,max(.14+.22*Hn,-zrL*1.2),d);
 float etaSw=covered>.5?bed+max(hSw,.006):min(bed,max(zf,bed-.6))-.03;
 float R0=RL-zrL;
 float dz=tpL<TuL?2.*R0*(1.-tpL/TuL)/TuL:(tpL<TuL+TbL?-2.*R0*(tpL-TuL)/(TbL*TbL):0.);
 vec2 velSw=dir*clamp(dz/bS,-4.,5.)*covered;
 float upr=1.-smoothstep(TuL*.6,TuL*1.1,tpL);
 float wF=bS*mix(.5,1.3,upr)+.004;
 float front=smoothstep(0.,wF*.12,hTip)*(1.-smoothstep(wF*.3,wF,hTip))*(.3+.7*upr)*gate*smoothstep(.04,.2,HL);
 float sheet=covered*(.15+.6*(1.-smoothstep(0.,TuL+TbL*.7,tpL)))*smoothstep(.003,.02,hSw);
 float strand=step(TuL,tpL)*exp(-(tpL-TuL)/2.6)*(1.-smoothstep(0.,wF*.7,abs(bed-(RL-wF*.35))))*step(zf,bed)*gate;
 float rock=smoothstep(.22,.65,beta)*(1.-smoothstep(0.,14.,max(sdist,0.)))*smoothstep(.1,.5,Hn);
 float impact=rock*(.3+.9*exp(-fract(thS)*T/1.5));
 float wetBase=(1.-smoothstep(Rm*.35,Rm*1.05+.1,bed))*.6*gate;

 o.wet=max(max(wetM*gate,wetBase),1.-smoothstep(-.15,.02,bed));
 o.film=filmM*gate;
 o.swash=wsw;o.tip=zf;
 o.eta=mix(etaS,etaSw,wsw);
 o.grad=mix(gradS,dir*bS*(1.-kap),wsw);
 o.vel=mix(velS,velSw,wsw);
 o.disp=dir*lean*(1.-wsw);
 o.roller=roller*(1.-wsw);
 o.face=faceS*(1.-wsw);
 o.front=front;o.strand=strand;o.sheet=sheet;
 o.sx=(zf-zrL)/bS*.7*covered;
 o.dry=wsw*(1.-covered);
 o.foam=max(mix(foamS,max(sheet*.8,front),wsw),max(impact,strand*.8));
 return o;
}
`;

// Water shaders: the four island shore textures, sampled like the island maps.
// Needs the island chunk (uIslB) and the surf chunk (texCubic) before it.
export const SHORE_SEA_GLSL =
  SHORE_CORE_GLSL +
  /* glsl */ `
// Shore field lives in the third third of the island atlas (uIslN): x in [2N,3N), height N.
vec4 texCubicShore(sampler2D t,vec2 uv,float R){
 vec2 c=uv*R-.5;vec2 f=fract(c);c-=f;
 vec4 xc=cubicW(f.x),yc=cubicW(f.y);
 vec4 cc=c.xxyy+vec2(-.5,1.5).xyxy;
 vec4 ss=vec4(xc.xz+xc.yw,yc.xz+yc.yw);
 vec4 off=(cc+vec4(xc.yw,yc.yw)/ss)/R;
 vec2 ax=(2.*R+clamp(off.xy*R,.5,R-.5))/(3.*R);
 vec2 ay=clamp(off.zw,.5/R,1.-.5/R);
 vec4 s0=texture2D(t,vec2(ax.x,ay.x)),s1=texture2D(t,vec2(ax.y,ay.x)),s2=texture2D(t,vec2(ax.x,ay.y)),s3=texture2D(t,vec2(ax.y,ay.y));
 float sx=ss.x/(ss.x+ss.y),sy=ss.z/(ss.z+ss.w);
 return mix(mix(s3,s2,sx),mix(s1,s0,sx),sy);}
float shzInIsl(vec4 b,vec2 p,out vec2 uv,out float edge){
 uv=vec2(0.);edge=0.;
 if(b.w<.5)return 0.;
 vec2 q=(p-b.xy)/b.z;float m=max(abs(q.x),abs(q.y));
 uv=q*.5+.5;edge=1.-smoothstep(.95,.985,m);
 return m<.985?1.:0.;
}
vec4 shoreFieldAt(vec2 p,out float ok){
 vec2 u0,u1,u2,u3;float e0,e1,e2,e3;
 float i0=shzInIsl(uIslB[0],p,u0,e0),i1=shzInIsl(uIslB[1],p,u1,e1);
 float i2=shzInIsl(uIslB[2],p,u2,e2),i3=shzInIsl(uIslB[3],p,u3,e3);
 ok=0.;
 if(i3>.5){ok=e3;return texCubicShore(uIsl3,u3,float(textureSize(uIsl3,0).y));}
 if(i2>.5){ok=e2;return texCubicShore(uIsl2,u2,float(textureSize(uIsl2,0).y));}
 if(i1>.5){ok=e1;return texCubicShore(uIsl1,u1,float(textureSize(uIsl1,0).y));}
 if(i0>.5){ok=e0;return texCubicShore(uIsl0,u0,float(textureSize(uIsl0,0).y));}
 return vec4(0.);
}
`;

/* ---------------------------------------------------------------------------
   CPU twin of the surface height (swimmers and waders float on the same waves
   the shader draws). Returns the probe shape the movement code expects.
---------------------------------------------------------------------------- */
function shash(x, y) {
  const fx = fract(x * 0.1031), fy = fract(y * 0.1031);
  let qx = fx, qy = fy, qz = fx;
  const d = qx * (qy + 33.33) + qy * (qz + 33.33) + qz * (qx + 33.33);
  qx += d; qy += d; qz += d;
  return fract((qx + qy) * qz);
}
function snoise(x, y) {
  const i = Math.floor(x), j = Math.floor(y);
  let fx = x - i, fy = y - j;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const a = shash(i, j), b = shash(i + 1, j), c = shash(i, j + 1), e = shash(i + 1, j + 1);
  return (a + (b - a) * fx) * (1 - fy) + (c + (e - c) * fx) * fy;
}
const samp = (n) => clamp((0.84 + 0.17 * Math.sin(n * 0.79) + 0.09 * Math.sin(n * 2.03 + 1.7)) * (0.8 + 0.4 * shash(n, n * 0.7548 + 13.7)), 0.5, 1.4);
function runup(H, L0, beta) {
  const s = Math.sqrt(Math.max(H, 0.02) * L0), b = Math.min(beta, 0.35);
  return clamp(1.1 * (0.35 * b * s + 0.5 * s * Math.sqrt(0.563 * b * b + 0.004)), 0.05, 2.6);
}

export function shoreProbe(island, x, z, U) {
  const none = { eta: 0, h: 0, u: 0, v: 0, ok: true };
  const w = island && island.world, f = island && island.shoreField;
  if (!w || !f || !w.shoreDirX) return none;
  const gx = (x - island.spec.cx + w.half) / w.cell - 0.5, gz = (z - island.spec.cz + w.half) / w.cell - 0.5;
  if (gx < 1 || gz < 1 || gx > w.N - 3 || gz > w.N - 3) return none;
  const i = gx | 0, j = gz | 0, fx = gx - i, fz = gz - j, N = w.N, k = j * N + i;
  const bil = (get) => (get(k) * (1 - fx) + get(k + 1) * fx) * (1 - fz) + (get(k + N) * (1 - fx) + get(k + N + 1) * fx) * fz;
  const bed = bil((q) => w.h[q]);
  const inl = w.inl ? bil((q) => w.inl[q]) : 0;
  const calm = 1 - smooth(0.28, 0.9, inl);
  const d = Math.max(-bed, 0);
  const sdist = bil((q) => (w.h[q] < 0 ? w.tau[q] : -w.cdist[q]));
  if (calm < 0.01 || (d > 26 && sdist > 110)) return { ...none, eta: 0, h: Math.max(-Math.max(bed, -12), 0) };
  let dx = bil((q) => w.shoreDirX[q]), dz = bil((q) => w.shoreDirZ[q]);
  const dl = Math.hypot(dx, dz) || 1;
  dx /= dl; dz /= dl;
  const tau = bil((q) => f.tau[q]), beta = clamp(bil((q) => f.beta[q]), 0.012, 1.5), expo = bil((q) => f.expo[q]);
  const t = U.uTime.value, T = Math.max(U.uShT.value, 4), L0 = 1.56 * T * T, storm = clamp(U.uStorm.value, 0, 1);
  const sw = U.uSwDir.value, sc = clamp(sdist, -60, 500), px = x + dx * sc, pz = z + dz * sc;
  const a1 = snoise(px * 0.0062 + 7.1, pz * 0.0062 + 2.3), a2 = snoise(px * 0.019 + 3.3, pz * 0.019 + 9.7);
  const phA = (a1 - 0.5) * 0.9 + (a2 - 0.5) * 0.3 * (1 + storm);
  const facing = smooth(-0.35, 0.75, dx * sw.x + dz * sw.y);
  const H0 = U.uShH.value * 0.8 * (0.16 + 0.84 * expo) * (0.48 + 0.52 * facing) * (0.84 + 0.32 * a2);
  const theta = (t + tau) / T + phA, n = Math.floor(theta), ph = theta - n;
  const Hn = H0 * (samp(n) + (samp(n + 1) - samp(n)) * smooth(0.3, 0.8, ph));
  const dd = Math.max(d, 0.03), xi = Math.min(beta, 0.6) / Math.sqrt(Math.max(Hn, 0.05) / L0);
  const gB = 0.72 + 0.28 * smooth(0.2, 1.4, xi), gS = 0.42 + 0.18 * smooth(0.2, 1.4, xi);
  const dB = Math.pow((Hn * 1.778) / gB, 0.8);
