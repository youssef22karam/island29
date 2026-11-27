/* =============================================================================
   kelp/life.js — the floor and what lives on it (kelp3's floor.tsx and friends).
   -----------------------------------------------------------------------------
   Rocks sculpted from noise and crusted with pink coralline and green weed,
   pebbles and grit, tufts of weed and grass that bend with the swell, urchins,
   stars and anemones, sugar-kelp ribbons, schools of fish and threads of
   bubbles. kelp3 lays these out once round its one start; here each tile of
   bed is planted from its own seed as the eye comes near, and everything of
   one kind is drawn from one pool, so the whole floor is a couple of dozen
   draws however far the water runs.
   Adapted to the island's waters: rivers carry more cobble and their weed
   streams with the current; swamps go dark, weedy and silted, with few stones
   and none of the sea's animals.
============================================================================= */
import * as THREE from "three";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { floorAssets } from "./procedural";
import { lehmer } from "./random";
import { K_OUT, kMaterial } from "./sea.js";
import { makeRng, sampleWaterProps } from "./world.js";
export const TILE = 16;
// The floor's generated scans, laid into one layered texture: 0 sand, 1 pebbled sand, 2 low-tide rock,
// 3 sand normals, 4 pebbled-sand normals, 5 mossy rock, 6 granite. And the ten sculpted rocks.
export function makeAssets(fine) {
  const a = floorAssets(fine);
  const maps = [a.sandDiffuse, a.coastDiffuse, a.rockDiffuse, a.sandNormal, a.coastNormal, a.rocks[0].diffuse, a.rocks[9].diffuse];
  const size = a.sandDiffuse.image.width;
  const data = new Uint8Array(size * size * 4 * maps.length);
  maps.forEach((map, i) => data.set(map.image.data, i * size * size * 4));
  const tex = new THREE.DataArrayTexture(data, size, size, maps.length);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return { tex, rocks: a.rocks.map((r) => r.geometry) };
}
// Merged from position and normal only, whatever else each part carries.
function merge(parts) {
  const bare = parts.map((p) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", p.getAttribute("position"));
    if (!p.getAttribute("normal")) p.computeVertexNormals();
    g.setAttribute("normal", p.getAttribute("normal"));
    if (p.getIndex()) g.setIndex(p.getIndex());
    return g.getIndex() ? g.toNonIndexed() : g;
  });
  return mergeGeometries(bare);
}
// --- Shapes, each one unit tall, standing on y = 0. ---
// Pebbles and grit: lumpy low balls, welded so the normals are smooth across the faces.
function lump(detail) {
  const shape = mergeVertices(new THREE.IcosahedronGeometry(1, detail).deleteAttribute("normal").deleteAttribute("uv"));
  const p = shape.getAttribute("position");
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const bump = 1 + 0.12 * Math.sin(v.x * 3.1 + 1) * Math.sin(v.y * 2.7) + 0.08 * Math.sin(v.z * 5.3 + v.x * 2);
    v.multiplyScalar(bump);
    v.y = v.y * 0.75;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  shape.computeVertexNormals();
  return shape;
}
// A sea urchin: a ball of long spines.
function urchinShape() {
  const random = lehmer(311);
  const parts = [new THREE.SphereGeometry(0.42, 7, 5)];
  for (let i = 0; i < 20; i++) {
    const d = new THREE.Vector3(random() - 0.5, random() * 0.9 - 0.25, random() - 0.5).normalize();
    const spine = new THREE.ConeGeometry(0.03, 0.6 + random() * 0.3, 3, 1);
    spine.translate(0, 0.42 + 0.3, 0);
    spine.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d));
    parts.push(spine);
  }
  const g = merge(parts);
  g.translate(0, 0.3, 0);
  return g;
}
// A sea star: five plump arms tapering from a raised middle.
function starShape() {
  const shape = new THREE.Shape();
  for (let i = 0; i <= 25; i++) {
    const a = (i / 25) * Math.PI * 2;
    const arm = Math.pow(Math.abs(Math.cos((a * 5) / 2)), 3);
    const r = 0.16 + 0.34 * arm;
    if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.04, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.06, bevelSegments: 1, curveSegments: 2 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0.05, 0);
  return merge([g]);
}
// A tuft of weed: blades from one point, curving over.
function tuftShape(blades, salt, wide) {
  const random = lehmer(salt);
  const parts = [];
  for (let b = 0; b < blades; b++) {
    const a = random() * Math.PI * 2;
    const tall = 0.5 + random() * 0.5;
    const lean = 0.15 + random() * 0.35;
    const pts = [];
    const idx = [];
    const segs = 3;
    for (let i = 0; i <= segs; i++) {
      const u = i / segs;
      const w = wide * (1 - u * 0.8);
      const x = Math.cos(a) * lean * u * u;
      const z = Math.sin(a) * lean * u * u;
      pts.push(x - Math.sin(a) * w, tall * u, z + Math.cos(a) * w, x + Math.sin(a) * w, tall * u, z - Math.cos(a) * w);
      if (i < segs) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    parts.push(g);
  }
  return merge(parts);
}
// An anemone: a short column and a crown of tentacles, swaying.
function anemoneShape() {
  const random = lehmer(707);
  const parts = [new THREE.CylinderGeometry(0.22, 0.28, 0.35, 8, 1).translate(0, 0.17, 0)];
  for (let i = 0; i < 14; i++) {
    const a = random() * Math.PI * 2;
    const r = 0.06 + random() * 0.17;
    const out = new THREE.Vector3(Math.cos(a), 1.6 + random(), Math.sin(a)).normalize();
    const from = new THREE.Vector3(Math.cos(a) * r, 0.34, Math.sin(a) * r);
    const curve = new THREE.QuadraticBezierCurve3(from, from.clone().addScaledVector(out, 0.3), new THREE.Vector3(Math.cos(a) * (r + 0.25), 0.75 + random() * 0.2, Math.sin(a) * (r + 0.25)));
    parts.push(new THREE.TubeGeometry(curve, 3, 0.022, 3, false));
  }
  return merge(parts);
}
// Sugar kelp: a few long lance blades from one stalk, their edges ruffled, streaming low over the rocks.
function ribbonShape() {
  const random = lehmer(919);
  const parts = [];
  for (let b = 0; b < 4; b++) {
    const a = random() * Math.PI * 2;
    const tall = 0.62 + random() * 0.38;
    const lean = 0.1 + random() * 0.25;
    const wide = 0.05 + random() * 0.03;
    const phase = random() * 6;
    const pts = [];
    const idx = [];
    const segs = 8;
    for (let i = 0; i <= segs; i++) {
      const u = i / segs;
      const w = wide * Math.min(1, u / 0.09) * Math.pow(Math.max(Math.sin((u * 0.92 + 0.06) * Math.PI), 0), 0.7) + 0.003;
      const x = Math.cos(a) * lean * u * u;
      const z = Math.sin(a) * lean * u * u;
      const ruffle = Math.sin(u * 21 + phase) * w * 0.45;
      const sx = -Math.sin(a);
      const sz = Math.cos(a);
      // Edges lifted and dropped in turn, the middle left on the blade's line.
      pts.push(x + sx * w + Math.cos(a) * ruffle, tall * u, z + sz * w + Math.sin(a) * ruffle);
      pts.push(x, tall * u, z);
      pts.push(x - sx * w - Math.cos(a) * ruffle, tall * u, z - sz * w - Math.sin(a) * ruffle);
      if (i < segs) {
        const q = i * 3;
        idx.push(q, q + 1, q + 3, q + 1, q + 4, q + 3, q + 1, q + 2, q + 4, q + 2, q + 5, q + 4);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    parts.push(g);
  }
  return merge(parts);
}
// A water lily: a slender stalk from the bed up to a notched pad lying on the surface, a second pad beside it.
function lilyShape() { const parts = []; const pad = (cx, cz, r, turn) => { const pts = [cx, 1, cz]; const idx = []; const n = 12; // A wedge left out, as a lily's leaf has.
for (let i = 0; i <= n; i++) { const a = turn + 0.22 + (i / n) * (Math.PI * 2 - 0.44); pts.push(cx + Math.cos(a) * r, 1 + 0.012 * Math.sin(i * 1.7), cz + Math.sin(a) * r); if (i < n) idx.push(0, i + 2, i + 1); } const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3)); g.setIndex(idx); g.computeVertexNormals(); return g; }; const stalk = (cx, cz, from) => { const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, from, 0), new THREE.Vector3(cx * 0.3 + 0.03, from + (1 - from) * 0.45, cz * 0.3 - 0.02), new THREE.Vector3(cx * 0.8, 0.9, cz * 0.8), new THREE.Vector3(cx, 1, cz)]); return new THREE.TubeGeometry(curve, 7, 0.0045, 3, false); }; parts.push(stalk(0.02, 0.01, 0), pad(0.02, 0.01, 0.13, 0.4)); parts.push(stalk(0.24, -0.12, 0.25), pad(0.24, -0.12, 0.095, 2.6)); parts.push(stalk(-0.16, 0.2, 0.4), pad(-0.16, 0.2, 0.075, 4.4)); return merge(parts); } // Sunken wood: a fallen limb lying on the bed, forked, its twigs standing up into the water.
function snagShape() { const random = lehmer(1213); const parts = []; const limb = (from, to, r0, r1, sag, depth) => { const mid = from.clone().lerp(to, 0.5); mid.y += sag; const curve = new THREE.CatmullRomCurve3([from, mid, to]); parts.push(new THREE.TubeGeometry(curve, depth === 0 ? 8 : 4, 1, depth === 0 ? 6 : 4, false).scale(1, 1, 1)); const g = parts[parts.length - 1]; // Tapered: each ring drawn in toward the limb's line by how far along it is.
const p = g.getAttribute("position"); const rings = (depth === 0 ? 8 : 4) + 1; const round = (depth === 0 ? 6 : 4) + 1; const c = new THREE.Vector3(); const v = new THREE.Vector3(); for (let i = 0; i < rings; i++) { curve.getPointAt(i / (rings - 1), c); const r = r0 + (r1 - r0) * (i / (rings - 1)); for (let j = 0; j < round; j++) { const k = i * round + j; v.fromBufferAttribute(p, k).sub(c).multiplyScalar(r).add(c); p.setXYZ(k, v.x, v.y, v.z); } } g.computeVertexNormals(); if (depth >= 2) return; const forks = depth === 0 ? 4 : 2; for (let f = 0; f < forks; f++) { const t = 0.25 + random() * 0.65; const at = curve.getPointAt(t); const a = random() * Math.PI * 2; const len = (depth === 0 ? 0.22 + random() * 0.3 : 0.1 + random() * 0.14); const end = at.clone().add(new THREE.Vector3(Math.cos(a) * len * 0.7, len * (0.35 + random() * 0.75), Math.sin(a) * len * 0.7)); const r = (r0 + (r1 - r0) * t) * 0.6; limb(at, end, r, r * 0.3, (random() - 0.5) * 0.05, depth + 1); } }; limb(new THREE.Vector3(-0.5, 0.035, 0), new THREE.Vector3(0.5, 0.1, 0.08), 0.05, 0.018, 0.03, 0); return merge(parts); }
// A fish: a spindle of rings from tail to nose, x the way it swims, with a forked tail and a low dorsal fin.
function fishShape() {
  const rings = 7;
  const sides = 6;
  const pts = [];
  const idx = [];
  for (let r = 0; r <= rings; r++) {
    const u = r / rings;
    const x = u - 0.5;
    const girth = Math.pow(Math.sin(Math.PI * Math.pow(u, 0.72)), 0.85) * 0.5 + 0.012;
    for (let s = 0; s < sides; s++) {
      const a = (s / sides) * Math.PI * 2;
      pts.push(x * 0.84 + 0.06, Math.cos(a) * girth * 0.27, Math.sin(a) * girth * 0.13);
    }
  }
  for (let r = 0; r < rings; r++)
    for (let s = 0; s < sides; s++) {
      const a = r * sides + s;
      const b = r * sides + ((s + 1) % sides);
      idx.push(a, b, a + sides, b, b + sides, a + sides);
    }
  const body = new THREE.BufferGeometry();
  body.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  body.setIndex(idx);
  body.computeVertexNormals();
  const flatFin = (points) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
    g.computeVertexNormals();
    return g;
  };
  const tail = flatFin([-0.36, 0, 0, -0.56, 0.16, 0, -0.47, 0, 0, -0.36, 0, 0, -0.47, 0, 0, -0.56, -0.16, 0]);
  const dorsal = flatFin([0.12, 0.125, 0, -0.16, 0.115, 0, -0.06, 0.2, 0]);
  return merge([body, tail, dorsal]);
}
// --- Shaders ---
// Rocks and pebbles: placed, turned and scaled by their own attributes.
const STONE_VERT = /* glsl */ `
attribute vec4 aAt, aSize, aRock;
varying vec3 vW, vN, vL, vLN, vCa, vCrust;
varying vec4 vRock;
void main(){
  float c = cos(aAt.w), s = sin(aAt.w);
  vec3 q = position * aSize.xyz * kStands(aAt.xyz); vec3 P = aAt.xyz + vec3(q.x * c - q.z * s, q.y, q.x * s + q.z * c);
  vec3 n = normal / aSize.xyz;
  n = normalize(vec3(n.x * c - n.z * s, n.y, n.x * s + n.z * c));
  vW = P;
  vN = n;
  vL = q;
  vLN = normal;
  vRock = aRock;
  // Where the crust grows, and which kind, change over tens of centimetres: worked out at the rock's points.
  vCrust = vec3(smoothstep(-0.15, 0.25, kNoise3(P * 1.7)), smoothstep(-0.2, 0.2, kNoise3(P * 0.6 + 9.0)), aSize.w);
  vCa = kCausticsAt(P, n);
  gl_Position = projectionMatrix * viewMatrix * vec4(P, 1.0);
}`;
// No UVs on a generated rock: its texture is laid on from three sides in its own space, so it is seamless and
// stays on the stone; crusted on top with pink coralline and green weed in patches.
const ROCK_FRAG = /* glsl */ `
varying vec3 vW, vN, vL, vLN, vCa, vCrust;
varying vec4 vRock;
void main(){
  vec3 Nl = normalize(vLN);
  vec3 wt = pow(abs(Nl), vec3(4.0));
  wt /= wt.x + wt.y + wt.z;
  vec3 m = vL * vRock.y + vRock.z * 7.0;
  vec3 scan = kTexC(m.zy, vRock.x) * wt.x + kTexC(m.xz, vRock.x) * wt.y + kTexC(m.xy, vRock.x) * wt.z;
  float top = smoothstep(0.2, 0.75, Nl.y);
  // #c88a8a and #8a9a5a
  vec3 growth = mix(vec3(0.578, 0.254, 0.254), vec3(0.254, 0.323, 0.102), max(vCrust.y, vCrust.z));
  float fuzz = pow(scan.g, 0.4545) * 0.6 + 0.75;
  vec3 tone = mix(scan * 0.9, scan * growth * fuzz * 2.2, top * vCrust.x * 0.7);
  // Still, stained water leaves a dark film of silt and algae on everything.
  tone = mix(tone, tone * vec3(0.5, 0.58, 0.36), vCrust.z * 0.65);
  gl_FragColor = vec4(kFinish(tone, normalize(vN), vW, 0.9, vCa, vec3(0.0)), 1.0);
  ${K_OUT}
}`;
// Pebbles wear the shore's rock laid on from three sides; grit takes the sand's own tint, each stone a little
// lighter or darker, warmer or greyer.
const PEBBLE_FRAG = /* glsl */ `
varying vec3 vW, vN, vL, vLN, vCa, vCrust;
varying vec4 vRock;
void main(){
  vec3 N = normalize(vN);
  vec3 wt = pow(abs(normalize(vLN)), vec3(4.0));
  wt /= wt.x + wt.y + wt.z;
  vec3 m = vL * 1.4 + vRock.z * 9.0;
  vec3 tone;
  if(vRock.x < 0.5){
    tone = (kTexC(m.zy, 2.0) * wt.x + kTexC(m.xz, 2.0) * wt.y + kTexC(m.xy, 2.0) * wt.z) * 1.15 * mix(vec3(0.8, 0.78, 0.74), vec3(1.22, 1.14, 1.0), vRock.z);
  }else{
    tone = kTexC(m.xz * 1.8, 0.0) * K_SAND * 1.3 * (vRock.z * 0.44 + 0.78);
  }
  tone = mix(tone, tone * vec3(0.5, 0.58, 0.36), vCrust.z * 0.65);
  gl_FragColor = vec4(kFinish(tone, N, vW, 0.87, vCa, vec3(0.0)), 1.0);
  ${K_OUT}
}`;
// Things that grow on the floor, many of one shape: each placed and turned by its own attributes rather than a
// matrix, so the swell can bend it by how high each point is.
const GROW_VERT = /* glsl */ `
attribute vec4 aAt, aTurn;
attribute vec2 aDrift;
uniform float uBend, uHeight;
varying vec3 vW, vN, vL, vCa;
varying vec2 vHue;
vec3 spin(vec3 v){
  float c = cos(aTurn.x), s = sin(aTurn.x);
  return vec3(v.x * c - v.z * s, v.y, v.x * s + v.z * c);
}
void main(){
  vec3 local = position; float size = aAt.w * kStands(aAt.xyz); vec3 rest = aAt.xyz + spin(local) * size;
  float high = clamp(local.y / uHeight, 0.0, 1.0);
  float flutter = sin(kClock * 1.7 + aTurn.z + local.y * 9.0) * 0.15;
  vec3 off = kSwayAt(aAt.xyz, aDrift) * (high * high * uBend * size * (flutter + 1.0));
  // Bent over rather than stretched: the further a point is carried aside, the lower it comes, keeping its length.
  float h = max(local.y * size, 0.0);
  // However hard the current, a blade lies down along it and never folds back over itself.
  float carriedBy = length(off.xz);
  off.xz *= min(1.0, 0.9 * h / max(carriedBy, 1e-4));
  float aside = off.x * off.x + off.z * off.z;
  float drop = h - sqrt(max(h * h - aside, h * h * 0.08));
  vec3 P = rest + off - vec3(0.0, drop, 0.0);
  P.y = min(P.y, -0.02);
  vec3 n = normalize(spin(normal));
  vW = P;
  vN = n;
  vL = local;
  vHue = vec2(aTurn.y, aTurn.w);
  vCa = kCausticsAt(P, n);
  gl_Position = projectionMatrix * viewMatrix * vec4(P, 1.0);
}`;
const GROW_FRAG = /* glsl */ `
uniform vec3 uPal[4];
uniform float uPalN, uRough, uThru, uToneMode;
varying vec3 vW, vN, vL, vCa;
varying vec2 vHue;
void main(){
  float pick = min(floor(vHue.x * uPalN), uPalN - 1.0);
  vec3 base = pick < 0.5 ? uPal[0] : pick < 1.5 ? uPal[1] : pick < 2.5 ? uPal[2] : uPal[3];
  if(uToneMode > 0.5) base = mix(base * 0.6, base * 1.3, smoothstep(0.3, 0.9, vL.y));
  // Darker and greener in a swamp's stained water.
  base = mix(base, base * vec3(0.6, 0.76, 0.46), vHue.y * 0.7);
  gl_FragColor = vec4(kFinish(base, normalize(vN), vW, uRough, vCa, base * uThru), 1.0);
  ${K_OUT}
}`;
// Fish: each school wanders a closed path round its home, strung out along it, every fish turned the way it goes
// and beating its tail.
const FISH_VERT = /* glsl */ `
attribute vec4 aSchool, aFish, aLook;
varying vec3 vW, vN, vL, vCa;
varying float vKind;
vec3 pathAt(float t){
  float R = aSchool.w;
  return aSchool.xyz + vec3(
    cos(t) * R + cos(t * 2.3 + 1.7) * R * 0.3,
    sin(t * 0.7 + 2.0) * aLook.w,
    sin(t) * R * 0.8 + sin(t * 1.9 + 0.4) * R * 0.28);
}
void main(){
  float t = kClock * aLook.z + aFish.w;
  vec3 C = pathAt(t);
  vec3 D = normalize(pathAt(t + 0.06) - C + vec3(1e-5, 0.0, 0.0));
  float spread = aSchool.w * 0.42;
  vec3 off = (aFish.xyz - 0.5) * vec3(spread, spread * 0.45, spread);
  off += vec3(sin(kClock * 0.6 + aFish.x * 40.0), sin(kClock * 0.47 + aFish.y * 31.0) * 0.5, cos(kClock * 0.53 + aFish.z * 37.0)) * 0.12;
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), D));
  vec3 up = cross(D, right);
  vec3 p = position;
  // The beat runs down the body, widest at the tail.
  float beat = sin(p.x * 6.5 + kClock * (7.0 + aLook.z * 40.0) + aFish.x * 30.0) * 0.085 * (0.55 - p.x);
  p.z += beat;
  float size = aLook.x * kStands(aSchool.xyz);
  vec3 P = C + off + (D * p.x + up * p.y + right * p.z) * size;
  P.y = min(P.y, -0.12);
  vec3 n = normalize(D * normal.x + up * normal.y + right * normal.z);
  vW = P;
  vN = n;
  vL = position;
  vKind = aLook.y;
  vCa = kCausticsAt(P, n);
  gl_Position = projectionMatrix * viewMatrix * vec4(P, 1.0);
}`;
const FISH_FRAG = /* glsl */ `
varying vec3 vW, vN, vL, vCa;
varying float vKind;
void main(){
  // Dark above, pale below, as fish are; each kind its own colours.
  float back = smoothstep(-0.04, 0.09, vL.y);
  vec3 belly, top;
  float rough = 0.34;
  if(vKind < 0.5){ belly = vec3(0.62, 0.66, 0.66); top = vec3(0.10, 0.15, 0.17); rough = 0.26; }       // shiners: silver
  else if(vKind < 1.5){ belly = vec3(0.36, 0.34, 0.2); top = vec3(0.07, 0.1, 0.045); }                 // bass: olive
  else if(vKind < 2.5){ belly = vec3(0.86, 0.44, 0.1); top = vec3(0.6, 0.2, 0.035); }                  // sunfish: garibaldi's gold
  else { belly = vec3(0.5, 0.52, 0.5); top = vec3(0.09, 0.17, 0.2); rough = 0.3; }                     // trout: blue-grey
  vec3 tone = mix(belly, top, back);
  // A darker line along the side, and bars on the bass.
  tone *= 1.0 - 0.25 * smoothstep(0.03, 0.0, abs(vL.y - 0.015));
  if(vKind > 0.5 && vKind < 1.5) tone *= 0.82 + 0.18 * sin(vL.x * 38.0);
  // Fins thin enough to pass the light.
  float fin = step(0.36, -vL.x) + step(0.13, vL.y);
  gl_FragColor = vec4(kFinish(tone, normalize(vN), vW, rough, vCa, tone * min(fin, 1.0) * 0.5), 1.0);
  ${K_OUT}
}`;
// Bubbles: threads of them rising from the rocks, wobbling, flattening and growing as they climb.
const BUBBLE_VERT = /* glsl */ `
attribute vec4 aSrc, aSeed;
varying vec2 vUv;
varying vec3 vW;
varying float vFade;
void main(){
  float pace = 0.22 + aSeed.x * 0.16;
  float tt = kClock * pace / max(aSrc.w, 0.5) + aSeed.y;
  float u = fract(tt);
  // A thread comes and goes.
  float on = smoothstep(0.1, 0.45, sin(kClock * 0.31 + aSeed.w * 43.0) * 0.5 + 0.5);
  vec3 centre = aSrc.xyz + vec3(
    sin(u * 17.0 + aSeed.z * 20.0) * 0.035 * (0.3 + u * 2.0) + kDrift.x * u * 2.0,
    u * aSrc.w,
    cos(u * 13.0 + aSeed.x * 30.0) * 0.035 * (0.3 + u * 2.0) + kDrift.y * u * 2.0);
  float size = (0.0035 + aSeed.z * aSeed.z * 0.011) * (1.0 + u * 0.9) * on;
  vec3 toEye = normalize(cameraPosition - centre);
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toEye) + vec3(1e-5, 0.0, 0.0));
  vec3 up = cross(toEye, right);
  float wob = sin(kClock * 9.0 + aSeed.y * 50.0) * 0.22 * smoothstep(0.004, 0.012, size);
  vec3 P = centre + right * (position.x * size * (1.15 + wob)) + up * (position.y * size * (0.85 - wob));
  vUv = position.xy;
  vW = P;
  vFade = smoothstep(0.0, 0.05, u) * (1.0 - smoothstep(0.93, 1.0, u));
  gl_Position = projectionMatrix * viewMatrix * vec4(P, 1.0);
}`;
const BUBBLE_FRAG = /* glsl */ `
varying vec2 vUv;
varying vec3 vW;
varying float vFade;
void main(){
  float r = length(vUv);
  if(r > 1.0) discard;
  // A bright rim round a clear middle, the sky caught in its top.
  float rim = smoothstep(0.5, 0.96, r);
  float glint = smoothstep(0.34, 0.0, length(vUv - vec2(-0.32, 0.42)));
  vec3 rgb = kShallow * (0.5 + 1.5 * rim) + kSun * kPower * (0.04 + 0.3 * glint + 0.06 * rim);
  float alpha = (0.1 + 0.75 * rim + 0.7 * glint) * (1.0 - smoothstep(0.92, 1.0, r)) * vFade;
  gl_FragColor = vec4(kSeen(rgb, vW), clamp(alpha, 0.0, 1.0));
  ${K_OUT}
}`;
// What grows, in kelp3's order: its shape, colours, how far it bends, how many to a tile of open lake floor, its
// sizes, and how much of it keeps to the rocks.
const hexes = (list) => {
  const out = list.map((h) => new THREE.Color(h));
  while (out.length < 4) out.push(out[out.length - 1].clone());
  return out;
};
const GROWERS = [
  { name: "urchin", shape: urchinShape, pal: ["#3b1a4a", "#5b1f5c", "#24162e"], bend: 0, height: 1, rough: 0.5, n: 3, sizes: [0.08, 0.13], onRock: 0.8, sea: true },
  { name: "star", shape: starShape, pal: ["#d45a1c", "#7a2a6a", "#c8402a", "#e09a3a"], bend: 0, height: 1, rough: 0.8, n: 2, sizes: [0.15, 0.25], onRock: 0.6, sea: true },
  { name: "weed", shape: () => tuftShape(6, 41, 0.045), pal: ["#7a2a24", "#a2462a", "#5a6a26", "#3f5a22"], bend: 0.5, height: 1, n: 24, sizes: [0.28, 0.6], onRock: 0.5 },
  // Surfgrass: long bright ribbons scattered over the sand, and gathered into meadows, streaming with the water.
  { name: "surfgrass", shape: () => tuftShape(6, 47, 0.018), pal: ["#3a6a2a", "#4a742e", "#567e34"], bend: 0.9, height: 1, n: 18, sizes: [0.65, 1.25], onRock: 0.15 },
  { name: "meadow", shape: () => tuftShape(7, 53, 0.024), pal: ["#36602a", "#44702c", "#527a34", "#5e823c"], bend: 0.9, height: 1, n: 34, sizes: [0.5, 1.05], meadow: true },
  { name: "tiny", shape: () => tuftShape(5, 67, 0.013), pal: ["#4e6a2a", "#5a7430", "#6a7a34", "#3e5a24"], bend: 0.7, height: 1, n: 26, sizes: [0.07, 0.16], onRock: 0.1 },
  { name: "turf", shape: () => tuftShape(5, 59, 0.02), pal: ["#4a6426", "#5e6e2c", "#3e5a26"], bend: 0.6, height: 1, n: 20, sizes: [0.16, 0.34], onRock: 0.4 },
  { name: "anemone", shape: anemoneShape, pal: ["#4fa86a", "#d06a8a", "#e8c070"], bend: 0.3, height: 0.9, n: 2, sizes: [0.15, 0.25], onRock: 0.85, tone: 1, sea: true },
  // Sugar kelp low on the rocks and cobbles between the giants.
  { name: "sugar", shape: ribbonShape, pal: ["#7a6424", "#6a5a22", "#7a6e2a"], bend: 1.25, height: 1, rough: 0.5, thru: 0.6, n: 12, sizes: [0.7, 1.7], onRock: 0.75 },
  // Still water's own: lilies standing from the bed to their pads on the surface, wherever a swamp or a quiet
  // shallow lies, and sunken limbs on the silt.
  { name: "lily", shape: lilyShape, pal: ["#3f6a24", "#4d7a2a", "#5a8430"], bend: 0.2, height: 1, rough: 0.55, thru: 0.55, n: 26, sizes: [0.5, 4.2], toSurface: true, only: (p) => (p.depth < 4.2 ? Math.max(p.swamp, p.lake * (p.depth < 2.4 ? 0.45 : 0)) * (1 - p.river) : 0) },
  { name: "snag", shape: snagShape, pal: ["#3a2c1c", "#2c2418", "#4a3a26"], bend: 0, height: 1, rough: 0.85, thru: 0, n: 7, sizes: [1.2, 3.4], lying: true, only: (p) => Math.max(p.swamp * 0.9, p.river * 0.22, 0.07) },
];
// One pooled draw: a shape drawn many times over from per-instance attributes gathered from the tiles in view.
function pooled(shape, attrs, capacity, material) {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute("position", shape.getAttribute("position"));
  if (shape.getAttribute("normal")) g.setAttribute("normal", shape.getAttribute("normal"));
  if (shape.getIndex()) g.setIndex(shape.getIndex());
  const buffers = {};
  for (const name of Object.keys(attrs)) {
    buffers[name] = new THREE.InstancedBufferAttribute(new Float32Array(capacity * attrs[name]), attrs[name]);
    g.setAttribute(name, buffers[name]);
  }
  g.instanceCount = 0;
  const mesh = new THREE.Mesh(g, material);
  mesh.frustumCulled = false;
  return { mesh, geometry: g, buffers, attrs, capacity, count: 0 };
}
const STONE_ATTRS = { aAt: 4, aSize: 4, aRock: 4 };
const GROW_ATTRS = { aAt: 4, aTurn: 4, aDrift: 2 };
const FISH_ATTRS = { aSchool: 4, aFish: 4, aLook: 4 };
const BUBBLE_ATTRS = { aSrc: 4, aSeed: 4 };
const bins = (attrs) => Object.fromEntries(Object.keys(attrs).map((k) => [k, []]));
export class LifePool {
  constructor(assets, fine) {
    this.group = new THREE.Group();
    this.group.name = "kelp3-floor";
    const cap = (n) => Math.max(16, Math.round(n * (0.45 + 0.55 * fine)));
    const rockMaterial = kMaterial({ vertex: STONE_VERT, fragment: ROCK_FRAG });
    const pebbleMaterial = kMaterial({ vertex: STONE_VERT, fragment: PEBBLE_FRAG });
    this.materials = [rockMaterial, pebbleMaterial];
    this.pools = {};
    assets.rocks.forEach((geometry, kind) => {
      this.pools["rock" + kind] = pooled(geometry, STONE_ATTRS, cap(260), rockMaterial);
    });
    this.shapes = [lump(fine > 0.6 ? 1 : 0)];
    this.pools.pebble = pooled(this.shapes[0], STONE_ATTRS, cap(3400), pebbleMaterial);
    GROWERS.forEach((spec) => {
      const shape = spec.shape();
      this.shapes.push(shape);
      const material = kMaterial({
        vertex: GROW_VERT,
        fragment: GROW_FRAG,
        side: THREE.DoubleSide,
        uniforms: {
          uPal: { value: hexes(spec.pal) },
          uPalN: { value: spec.pal.length },
          uBend: { value: spec.bend },
          uHeight: { value: spec.height },
          uRough: { value: spec.rough ?? 0.7 },
          uThru: { value: spec.thru ?? 0.25 },
          uToneMode: { value: spec.tone ?? 0 },
        },
      });
      this.materials.push(material);
      this.pools[spec.name] = pooled(shape, GROW_ATTRS, cap(spec.n * 60), material);
    });
    const fish = fishShape();
    this.shapes.push(fish);
    const fishMaterial = kMaterial({ vertex: FISH_VERT, fragment: FISH_FRAG, side: THREE.DoubleSide });
    this.pools.fish = pooled(fish, FISH_ATTRS, cap(1400), fishMaterial);
    const quad = new THREE.BufferGeometry();
    quad.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    quad.setIndex([0, 1, 2, 0, 2, 3]);
    this.shapes.push(quad);
    const bubbleMaterial = kMaterial({ vertex: BUBBLE_VERT, fragment: BUBBLE_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    this.pools.bubble = pooled(quad, BUBBLE_ATTRS, cap(900), bubbleMaterial);
    this.pools.bubble.mesh.renderOrder = 3;
    this.materials.push(fishMaterial, bubbleMaterial);
    for (const pool of Object.values(this.pools)) this.group.add(pool.mesh);
  }
  // Gathers the tiles in view into the pools. Called only when the set of tiles changes.
  compose(tiles) {
    for (const [name, pool] of Object.entries(this.pools)) {
      let count = 0;
      for (const tile of tiles) {
        const bin = tile.bins[name];
        if (!bin) continue;
        const first = Object.keys(pool.attrs)[0];
        const more = Math.min(bin[first].length / pool.attrs[first], pool.capacity - count);
        if (more <= 0) continue;
        for (const key of Object.keys(pool.attrs)) {
          const size = pool.attrs[key];
          const list = bin[key];
