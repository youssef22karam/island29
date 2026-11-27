/* =============================================================================
   kelp/atmos.js — the water round everything (kelp3's sea.tsx + atmosphere.tsx).
   -----------------------------------------------------------------------------
   The far haze behind, the underside of the surface overhead with the sky in
   Snell's window and the sun glittering in it, shafts of light down from it,
   and the specks drifting in the water: plankton, silt, torn weed, bokeh.
   Drawn only while the eye is under. Specks and shafts keep their own places
   in the world and wrap round the eye, worked out relative to it so they stay
   steady kilometres from the island's origin.
============================================================================= */
import * as THREE from "three";
import { lehmer } from "./random";
import { KU, K_OUT, kMaterial } from "./sea.js";
// The surface's waves: the swell that sways the forest, crossing chop on it, and fine ripples that fade with
// distance before they could shimmer. Height for the mesh, slope for the shading. Drawn at twice kelp3's base
// size: twice as long, as much taller, and slower as longer waves are.
const WAVES = /* glsl */ `
void kChop(vec2 xz, vec2 d, float k, float w, float a, float off, float keep, inout float h, inout vec2 g){
  float p = dot(xz, d) * k - kClock * w + off;
  float amp = (kSwell * 0.5 + 0.6) * a * keep;
  h += sin(p) * amp;
  g += d * (cos(p) * amp * k);
}
void kWaves(vec2 xz, float fine, out float h, out vec2 g){
  float phase = (xz.x * K_SWELL.x + xz.y * K_SWELL.y) * kWaveK - kSurge;
  float tall = kSwell * 0.12;
  h = cos(phase) * tall;
  g = K_SWELL * (-sin(phase) * tall * kWaveK);
  kChop(xz, vec2(0.6, -0.8), 0.45, 0.7778, 0.14, 0.0, 1.0, h, g);
  kChop(xz, vec2(-0.2873, 0.9578), 0.85, 1.1314, 0.09, 1.7, 1.0, h, g);
  kChop(xz, vec2(0.8944, 0.4472), 1.65, 1.6263, 0.048, 3.4, 1.0, h, g);
  kChop(xz, vec2(-0.7809, 0.6247), 3.1, 2.3335, 0.026, 5.1, fine, h, g);
}
`;
const BACKDROP_VERT = /* glsl */ `
varying vec3 vDir;
void main(){
  vDir = position;
  gl_Position = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
}`;
const BACKDROP_FRAG = /* glsl */ `
varying vec3 vDir;
void main(){
  gl_FragColor = vec4(kHaze(vDir), 1.0);
  ${K_OUT}
}`;
const SURFACE_VERT = /* glsl */ `
${WAVES}
uniform vec3 uEyeAt;
varying vec3 vW;
void main(){
  // The mesh follows the eye across; heights are worked out where each point is in the world.
  vec3 world = position + vec3(uEyeAt.x, 0.0, uEyeAt.z);
  // Out where the rings are metres apart they cannot follow the waves; there the surface lies flat and only its
  // shading has waves.
  float reach = 1.0 - smoothstep(14.0, 40.0, length(position.xz));
  float h; vec2 g;
  kWaves(world.xz, 0.0, h, g);
  vW = vec3(world.x, h * reach, world.z);
  gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0);
}`;
// The underside of the surface: the sky shows through a bright window overhead, the sun glittering in it, and
// everywhere else the surface is a mirror of the lit water below, the line between them broken by the waves.
const SURFACE_FRAG = /* glsl */ `
${WAVES}
varying vec3 vW;
// Lily pads and mats of weed afloat on a swamp's still water, seen from below as dark discs against the sky.
float kPads(vec2 p){
  vec2 c = floor(p), f = fract(p) - 0.5;
  float hsh = fract(sin(dot(c, vec2(127.1, 311.7))) * 43758.5453);
  vec2 o = (vec2(fract(hsh * 7.3), fract(hsh * 13.7)) - 0.5) * 0.4;
  float r = 0.18 + 0.22 * fract(hsh * 3.1);
  return step(0.42, hsh) * (1.0 - smoothstep(r - 0.035, r, length(f - o)));
}
void main(){
  vec3 P = vW;
  vec3 toP = P - cameraPosition;
  float d = length(toP);
  float fineDetail = 1.0 - smoothstep(5.0, 30.0, d);
  // The waves' slopes, steepened for the shading: seen from below every ripple bends the sky about, and that is
  // how the waves show. Less so further off, where steep slopes would flip whole patches between window and mirror.
  float h; vec2 g;
  kWaves(P.xz, fineDetail, h, g);
  g *= mix(0.8, 1.7, fineDetail);
  vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
  vec3 V = toP / d;
  float cosI = max(dot(V, N), 0.0);
  // Light from the air bends in only within about 48.6 degrees of straight up; beyond that the surface reflects.
  float sinT2 = 1.333 * 1.333 * (1.0 - cosI * cosI);
  // A wide blend between the window and the mirror, so a wave's trough never cuts a dark shape out of the light.
  float window = 1.0 - smoothstep(0.5, 1.0, sinT2);
  // The way out through the surface into the air, bent at it: the sky seen that way is pale low down and deeper
  // blue overhead, so each wave's slope shows as a patch lighter or darker, and the sun as a broken glitter.
  float cosT = sqrt(max(1.0 - sinT2, 0.0));
  vec3 outDir = normalize(V * 1.333 + N * (cosT - cosI * 1.333));
  float high = max(outDir.y, 0.0);
  vec3 air = mix(vec3(1.25, 1.3, 1.3), vec3(0.55, 0.8, 1.05), pow(high, 0.6));
  float outward = max(dot(outDir, kToSunAir), 0.0);
  float sunAbove = pow(outward, 900.0) * 40.0 + pow(outward, 140.0) * 5.0 + pow(outward, 10.0) * 0.5;
  // Less gets through toward the window's edge, where the surface turns to a mirror.
  float passes = 1.0 - pow(1.0 - cosT, 5.0);
  // Through the window the light is also gathered and spread by the waves into a moving net.
  float net = kThreads(P.xz / 6.4 + g * 0.4, kClock * 0.29698 * kFlicker + 23.0);
  vec3 sky = kShallow * air * (net * 0.45 + 0.85) * passes + kSun * kPower * (sunAbove + net * 0.08 + 0.05);
  // What floats on a swamp shades its own patch of sky.
  if(kBiome.z > 0.05){
    float gathered = smoothstep(0.0, 0.45, kNoise3(vec3(P.x * 0.07, 3.3, P.z * 0.07)) + kBiome.z * 0.35 - 0.2);
    float pad = max(kPads(P.xz * 1.6), kPads(P.xz * 0.9 + 7.7)) * gathered * kBiome.z * fineDetail;
    float weed = smoothstep(0.25, 0.6, kNoise3(vec3(P.x * 0.9, 1.1, P.z * 0.9)) * 0.5 + kNoise3(vec3(P.x * 0.16, 6.1, P.z * 0.16))) * kBiome.z * 0.6;
    sky = mix(sky, kShallow * vec3(0.2, 0.34, 0.08) * (0.3 + 0.6 * passes), clamp(max(pad, weed * gathered), 0.0, 0.92));
  }
  // Outside the window the surface is a rippling mirror of the lit water below, not a dark lid: the water's own
  // colour, lighter on the faces of the waves that catch the light from below and darker in their troughs.
  vec3 mirrored = kHaze(reflect(V, -N));
  float facing = clamp(dot(N, kToSun) * 2.0 + 0.2, 0.4, 1.4);
  vec3 below = mix(mirrored, kShallow * 0.85, 0.5) * (net * 0.3 + 0.8) * (facing * 0.5 + 0.5);
  float rim = smoothstep(0.75, 0.98, sinT2) * window * 0.6;
  // The sun seen through the water, a glow round it wherever the eye turns toward it.
  float toward = max(dot(V, kToSun), 0.0);
  vec3 glow = kSun * kPower * (pow(toward, 12.0) * 0.08 + pow(toward, 80.0) * 0.35 + pow(toward, 900.0) * 5.0);
  vec3 rgb = mix(below, sky, window) + kShallow * rim + glow;
  // Far off, seen nearly edge-on, the surface gives way to the water itself, so there is no line where it ends.
  vec3 kept = kThrough(d) * smoothstep(0.03, 0.22, V.y);
  gl_FragColor = vec4(rgb * kept + kHaze(toP) * (vec3(1.0) - kept), 1.0);
  ${K_OUT}
}`;
// Shafts of sunlight down from the surface into the deep: long, all running the way the sun comes in, so that seen
// from below they draw together toward one point far down. Each is one strip turned about its own line to face
// the eye, so it reads as a soft column from any side, and fades in at the surface and out toward its far end so
// no end shows. Each brightens and fades as the waves overhead gather the light and let it go.
const SHAFT_VERT = /* glsl */ `
attribute vec4 aTop, aShaft;
uniform float uLong, uSpread;
uniform vec3 uEyeMod;
varying vec4 vS;
varying vec3 vFace, vRel;
varying float vGathered, vEdge, vScale;
void main(){
  // The water here against kelp3's eight and a half metres: shafts shorten in a shallow river.
  float sc = clamp(-kBedY / 8.5, 0.3, 1.25);
  float LONG = uLong * sc;
  // Each keeps its own place in the world, wrapping round the eye.
  vec2 home = mod(aTop.xy - uEyeMod.xz + uSpread, 2.0 * uSpread) - uSpread;
  float edge = 1.0 - smoothstep(uSpread * 0.7, uSpread * 0.98, length(home));
  float along = aShaft.y * sc;
  vec3 downward = -kToSun;
  float width = aTop.z * (aShaft.y / uLong * 1.5 + 1.0) * mix(0.7, 1.0, sc);
  // Each drifts a little as the waves overhead move.
  vec3 sway = vec3(sin(kClock * 0.23 + aShaft.z), 0.0, cos(kClock * 0.17 + aShaft.z * 1.3)) * (0.45 - aShaft.y / uLong * 0.3);
  // Starting under the deepest trough, so the waves never cut across a lit part of the shaft. Relative to the eye.
  vec3 top0 = vec3(home.x, -1.0 * sc - kEye.y, home.y) + sway;
  vec3 onLine = top0 + downward * along;
  vec3 middle = top0 + downward * (LONG * 0.5);
  // Turned about its own line to face the eye, as one flat piece aimed from its middle.
  vec3 side = normalize(cross(downward, -middle));
  vec3 rel = onLine + side * (aShaft.x * width);
  vS = vec4(aShaft.x, along, aShaft.z, LONG);
  vFace = normalize(cross(side, downward));
  // Its light comes and goes with the same moving net of threads that lays the caustics on the floor.
  float net = kThreads((kEye.xz + top0.xz) / (kCell * 4.0), kClock * 0.42 * kFlicker + 23.0);
  vGathered = sin(kClock * 0.31 + aShaft.z) * sin(kClock * 0.19 + aShaft.z * 1.7) * 0.3 + 0.4 + smoothstep(0.02, 0.3, net) * 0.9;
  vEdge = edge;
  vScale = sc;
  vRel = rel;
  gl_Position = projectionMatrix * vec4(mat3(viewMatrix) * rel, 1.0);
}`;
const SHAFT_FRAG = /* glsl */ `
varying vec4 vS;
varying vec3 vFace, vRel;
varying float vGathered, vEdge, vScale;
void main(){
  float across = vS.x;
  float depth = vS.y;
  float LONG = vS.w;
  float y = vRel.y + kEye.y;
  // Soft right across, no edge to it: a bell that has fallen to nothing well before the plane ends.
  float soft = max(exp(-across * across * 4.5) - 0.011, 0.0);
  // Strong near the top, fading slowly down into the blue, and coming in softly from the surface.
  float fall = 1.0 / (depth * 0.09 + 1.0) * smoothstep(0.0, 2.5 * vScale, depth) * (1.0 - smoothstep(LONG * 0.55, LONG, depth));
  float ripple = sin(depth * 0.31 - kClock * 0.23 + vS.z * 2.3) * 0.15 + 0.85;
  float d = length(vRel);
  vec3 dir = vRel / d;
  float near = smoothstep(1.5, 6.0, d);
  // Nearly edge-on its soft falloff across would squeeze into a hard line, so it fades out as it turns away.
  float facing = smoothstep(0.15, 0.6, abs(dot(normalize(vFace), dir)));
  // Faded out before they reach the floor, so no plane is seen cutting into the sand.
  float above = smoothstep(kBedY + 0.3, kBedY + 0.3 + 2.3 * vScale, y);
  // And by how far under the surface they are: a strip leans with the sun, so its upper corners reach up into
  // the waves, which would cut them off along a hard line.
  float under = 1.0 - smoothstep(-3.8 * vScale, -1.2 * vScale, y);
  // Looked at along their length, shafts melt into one glow rather than show their sides.
  float along = 1.0 - smoothstep(0.85, 0.995, abs(dot(dir, -kToSun)));
  float bright = soft * fall * (vGathered * vGathered * 0.8 + 0.2) * ripple * near * facing * above * under * along * kShafts * kPower * 0.065 * vEdge;
  // Lit water seen through the water between it and the eye, which turns it blue the further it is.
  gl_FragColor = vec4(max(kSun * vec3(0.7, 0.92, 1.0) * bright * kThrough(d * 1.4), 0.0), 1.0);
  ${K_OUT}
}`;
// What drifts in the water, so it is never quite clear: specks everywhere round the eye in a box that wraps, of
// three kinds. Most are tiny bright motes of plankton and silt, shining brighter where the eye looks through them
// toward the sun; some are flecks of torn weed, long and thin, tumbling as they go; a few are soft clumps of
// detritus. All sink slowly, wander and are carried by the current. A second, finer layer through a box twice the
// size is all pale grey silt, so specks at every distance thicken into the haze and give the water depth.
const SNOW_VERT = /* glsl */ `
attribute vec4 aSeed;
uniform float uBox, uSilt;
uniform vec3 uEyeMod;
varying vec3 vKinds, vRel;
varying vec2 vQ;
varying float vSeen, vOnward, vTint, vCover;
void main(){
  vec4 s = aSeed;
  float t = kClock;
  // Which kind each is, from its seed: a mote, a fleck of weed, or a clump.
  float pick = uSilt > 0.5 ? 0.0 : fract(s.w * 7.31);
  float fleck = smoothstep(0.6, 0.61, pick) * (1.0 - smoothstep(0.88, 0.89, pick));
  float clump = smoothstep(0.89, 0.9, pick);
  float mote = 1.0 - fleck - clump;
  // Wandering, sinking slowly (the weed slower), and carried along by the current.
  float sink = mix(0.025, 0.012, fleck);
  vec3 drift = vec3(sin(t * 0.13 + s.w * 40.0) * 0.4 + kCarried.x, mod(-t * sink, uBox) + sin(t * 0.2 + s.w * 9.0) * 0.2, cos(t * 0.11 + s.w * 30.0) * 0.4 + kCarried.y);
  vec3 centre = mod(s.xyz + drift - uEyeMod, uBox) - uBox * 0.5;
  float d = length(centre);
  // Real sizes: motes a millimetre or three, flecks up to a couple of centimetres, clumps between.
  float k = fract(s.w * 13.7);
  float real = mote * (k * k * (uSilt > 0.5 ? 0.0045 : 0.0022) + (uSilt > 0.5 ? 0.0016 : 0.0009)) + fleck * (k * 0.008 + 0.004) + clump * (k * 0.004 + 0.003);
  // Never drawn under about a pixel, so far ones do not flicker; they fade instead, as much as they are smaller.
  float size = max(real, d * 0.0011);
  vCover = pow(real / size, 2.0);
  vec3 toEye = normalize(-centre);
  vec3 right = normalize(vec3(toEye.z, 0.0, -toEye.x) + vec3(1e-5, 0.0, 0.0));
  vec3 up = normalize(cross(toEye, right));
  // Flecks long and thin, turning over as they go.
  float spin = t * (s.w * 1.4 + 0.3) + s.w * 60.0;
  vec2 local = position.xy * vec2(mix(1.0, 2.6, fleck), mix(1.0, 0.4, fleck));
  vec2 turned = vec2(local.x * cos(spin) - local.y * sin(spin), local.x * sin(spin) + local.y * cos(spin)) * fleck + local * (1.0 - fleck);
  vec3 rel = centre + right * (turned.x * size) + up * (turned.y * size);
  vKinds = vec3(mote, fleck, clump);
  vSeen = d;
  vOnward = pow(max(dot(-toEye, kToSun), 0.0), 6.0);
  vTint = fract(s.w * 91.7);
  vRel = centre;
  vQ = position.xy;
  gl_Position = projectionMatrix * vec4(mat3(viewMatrix) * rel, 1.0);
}`;
const SNOW_FRAG = /* glsl */ `
uniform float uBox, uSilt;
varying vec3 vKinds, vRel;
varying vec2 vQ;
varying float vSeen, vOnward, vTint, vCover;
void main(){
  float r = length(vQ);
  float a = atan(vQ.y, vQ.x);
  // A clump is ragged at its edge.
  float ragged = r * (1.0 + sin(a * 3.0 + vTint * 20.0) * 0.25 * vKinds.z);
  float shape = 1.0 - smoothstep(0.55, 1.0, ragged);
  float fade = smoothstep(0.15, 0.4, vSeen) * (1.0 - smoothstep(uBox * 0.5 - 1.5, uBox * 0.5, vSeen));
  // Motes shine; weed and detritus are lit like anything else and seen dark against the bright water above.
  vec3 shine = kShallow * 0.7 + kSun * kPower * (vOnward * 0.5 + 0.12);
  vec3 weed = mix(vec3(0.102, 0.145, 0.023), vec3(0.195, 0.102, 0.023), vTint);
  vec3 lit = kShallow * 0.35 + kSun * kPower * 0.08;
  // Silt: pale grey, lit from above like the rest, a little brighter toward the sun.
  vec3 motes = uSilt > 0.5 ? vec3(0.624, 0.651, 0.624) * (lit * 2.0) + kSun * kPower * (vOnward * 0.12) : shine;
  vec3 body = mix(motes, weed * lit, vKinds.y) * (vKinds.x + vKinds.y) + vec3(0.254, 0.195, 0.122) * lit * vKinds.z;
  vec3 kept = kThrough(vSeen);
  vec3 rgb = body * kept + kHaze(vRel) * (vec3(1.0) - kept) * (1.0 - vKinds.x);
  float alpha = shape * fade * vCover * (uSilt > 0.5 ? 0.65 : mix(0.8, 0.9, 1.0 - vKinds.x));
  gl_FragColor = vec4(rgb, alpha);
  ${K_OUT}
}`;
// Plankton bokeh and rising marine snow: points of light that swell into soft discs out of focus.
const MOTE_VERT = /* glsl */ `
attribute vec4 aSeed;
uniform float uNear, uRising;
uniform vec3 uEyeMod;
varying vec2 vQ;
varying vec3 vGlow;
varying float vSoft, vGain;
void main(){
  vec4 s = aSeed;
  float t = kClock;
  bool rising = uRising > 0.5;
  float climb = rising ? t * 0.035 * (s.w + 0.5) : t * -0.02 * (s.w + 0.5);
  vec3 drift = vec3(sin(t * 0.11 + s.w * 40.0) * 0.25 + kCarried.x, climb, sin(t * 0.09 + s.x * 31.0) * 0.25 + kCarried.y);
  vec3 centre = (fract(s.xyz + (drift - uEyeMod) / uNear) - 0.5) * uNear;
  vec3 toEye = normalize(-centre);
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toEye) + vec3(1e-5, 0.0, 0.0));
  vec3 up = cross(toEye, right);
  float away = length(centre);
  float sharp = max(rising ? 0.001 : 0.0016, away * (rising ? 0.0009 : 0.0014)) * (s.w * 1.4 + 0.6);
  float blur = min(abs(away - kFocus) / away * (rising ? 0.01 : 0.026), away * (s.y * s.y * (rising ? 0.005 : 0.014) + (rising ? 0.002 : 0.004)));
  float radius = sharp + blur;
  float spread = max(pow(sharp / radius, 1.15), 0.24);
  vSoft = smoothstep(0.002, 0.012, blur);
  float fade = smoothstep(0.15, 0.4, away) * (1.0 - smoothstep(uNear * 0.36, uNear * 0.5, away));
  float twinkle = sin(t * (s.y * 1.2 + 0.3) + s.z * 50.0) * 0.25 + 0.75;
  float onward = pow(max(dot(-toEye, kToSun), 0.0), 3.0);
  vec3 lit = kThrough(max(-(centre.y + kEye.y), 0.0) * 0.55);
  vec3 glow = kSun * kPower * (onward * 0.9 + 0.1) + kShallow * 0.7;
  if(rising) glow *= kThrough(away * 1.5);
  // Nothing drifts above the surface.
  float wet = 1.0 - smoothstep(-0.25, -0.02, centre.y + kEye.y);
  vGlow = glow * lit;
  vGain = spread * (s.z * s.z * 0.65 + 0.35) * fade * twinkle * 1.35 * wet;
  vQ = position.xy;
  vec3 rel = centre + right * (position.x * radius) + up * (position.y * radius);
  gl_Position = projectionMatrix * vec4(mat3(viewMatrix) * rel, 1.0);
}`;
const MOTE_FRAG = /* glsl */ `
varying vec2 vQ;
varying vec3 vGlow;
varying float vSoft, vGain;
void main(){
  float r = length(vQ) * 0.5;
  float point = 1.0 - smoothstep(0.1, 0.5, r);
  float disc = (1.0 - smoothstep(0.36, 0.5, r)) * 0.8 + smoothstep(0.3, 0.44, r) * (1.0 - smoothstep(0.44, 0.5, r)) * 0.1;
  gl_FragColor = vec4(vGlow * (mix(point, disc, vSoft) * vGain), 1.0);
  ${K_OUT}
}`;
function quad() {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}
export class Atmosphere {
  // fine: 0.5 on phones, 0.75 at medium, 1 at high, as kelp3's tiers.
  constructor(fine) {
    this.group = new THREE.Group();
    this.group.name = "kelp3-water";
    this.group.visible = false;
    this.parts = [];
    this.boxes = [];
    const tier = fine < 0.6 ? 0 : fine < 0.9 ? 1 : 2;
    const add = (mesh, order) => {
      mesh.frustumCulled = false;
      mesh.renderOrder = order;
      this.group.add(mesh);
      this.parts.push(mesh);
      return mesh;
    };
    // The far haze: a ball round the eye that writes depth, so nothing beyond the water's reach is ever seen.
    this.dome = add(new THREE.Mesh(new THREE.SphereGeometry(80, 24, 14), kMaterial({ vertex: BACKDROP_VERT, fragment: BACKDROP_FRAG, side: THREE.BackSide })), -2);
    // The surface: rings round the eye, fine near it and coarse far off.
    {
      const rings = Math.max(24, Math.round(36 * fine));
      const spokes = Math.max(40, Math.round(64 * fine));
      const points = [0, 0, 0];
      const index = [];
      for (let r = 1; r <= rings; r++) {
        const radius = 110 * Math.pow(r / rings, 2.4);
        for (let s = 0; s < spokes; s++) {
          const a = (s / spokes) * Math.PI * 2;
          points.push(Math.cos(a) * radius, 0, Math.sin(a) * radius);
        }
      }
      for (let s = 0; s < spokes; s++) index.push(0, 1 + s, 1 + ((s + 1) % spokes));
      for (let r = 1; r < rings; r++)
        for (let s = 0; s < spokes; s++) {
          const a = 1 + (r - 1) * spokes + s;
          const b = 1 + (r - 1) * spokes + ((s + 1) % spokes);
          index.push(a, a + spokes, b, b, a + spokes, b + spokes);
        }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
      geometry.setIndex(index);
      this.eyeAt = { value: new THREE.Vector3() };
      this.surface = add(new THREE.Mesh(geometry, kMaterial({ vertex: SURFACE_VERT, fragment: SURFACE_FRAG, side: THREE.DoubleSide, uniforms: { uEyeAt: this.eyeAt } })), 0);
    }
    // Shafts.
    {
      const random = lehmer(5521);
      const count = Math.round(34 * fine);
      const LONG = 18;
      const SPREAD = 18;
      const top = [];
      const shaft = [];
      const index = [];
      for (let i = 0; i < count; i++) {
        const x = random() * SPREAD * 2;
        const z = random() * SPREAD * 2;
        const wide = 0.3 + random() ** 2 * 1.3;
        const seed = random() * 100;
        const base = top.length / 4;
        // Down the shaft in steps, so it can widen as it goes.
        const steps = 6;
        for (let k = 0; k <= steps; k++) {
          const u = k / steps;
          for (const across of [-1, 1]) {
            top.push(x, z, wide, 0);
            shaft.push(across, u * LONG, seed, 0);
          }
          if (k < steps) {
            const q = base + k * 2;
            index.push(q, q + 1, q + 2, q + 1, q + 3, q + 2);
          }
        }
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array((top.length / 4) * 3), 3));
      geometry.setAttribute("aTop", new THREE.Float32BufferAttribute(top, 4));
      geometry.setAttribute("aShaft", new THREE.Float32BufferAttribute(shaft, 4));
      geometry.setIndex(index);
      const eyeMod = { value: new THREE.Vector3() };
      this.boxes.push({ size: SPREAD * 2, eyeMod });
      // Light added to what is behind: its colour only.
      add(
        new THREE.Mesh(
          geometry,
          kMaterial({ vertex: SHAFT_VERT, fragment: SHAFT_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, uniforms: { uLong: { value: LONG }, uSpread: { value: SPREAD }, uEyeMod: eyeMod } }),
        ),
        5,
      );
    }
    // Snow and silt.
    const snow = (count, silt) => {
      const random = lehmer(8803);
      const BOX = silt ? 24 : 12;
      const geometry = quad();
      const seed = new Float32Array(count * 4);
      for (let i = 0; i < count; i++) seed.set([random() * BOX, random() * BOX, random() * BOX, random()], i * 4);
      geometry.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seed, 4));
      geometry.instanceCount = count;
      const eyeMod = { value: new THREE.Vector3() };
      this.boxes.push({ size: BOX, eyeMod });
      add(new THREE.Mesh(geometry, kMaterial({ vertex: SNOW_VERT, fragment: SNOW_FRAG, transparent: true, depthWrite: false, uniforms: { uBox: { value: BOX }, uSilt: { value: silt ? 1 : 0 }, uEyeMod: eyeMod } })), 4);
    };
    snow([240, 420, 650][tier], false);
    snow([280, 480, 750][tier], true);
    // Plankton bokeh, and marine snow rising.
    const motes = (count, rising) => {
      const NEAR = rising ? 7 : 4;
      const random = lehmer(rising ? 6113 : 4471);
      const geometry = quad();
      const seed = new Float32Array(count * 4);
      for (let i = 0; i < count; i++) seed.set([random(), random(), random(), random()], i * 4);
      geometry.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seed, 4));
      geometry.instanceCount = count;
      const eyeMod = { value: new THREE.Vector3() };
      this.boxes.push({ size: NEAR, eyeMod });
      add(
        new THREE.Mesh(
          geometry,
          kMaterial({ vertex: MOTE_VERT, fragment: MOTE_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uNear: { value: NEAR }, uRising: { value: rising ? 1 : 0 }, uEyeMod: eyeMod } }),
        ),
        6,
      );
    };
    motes([70, 120, 180][tier], false);
    motes([160, 280, 440][tier], true);
  }
  // Always round the eye.
  update(camera) {
    const p = camera.position;
    this.eyeAt.value.set(Math.round(p.x * 2) / 2, 0, Math.round(p.z * 2) / 2);
    const wrap = (v, size) => ((v % size) + size) % size;
    for (const box of this.boxes) box.eyeMod.value.set(wrap(p.x, box.size), wrap(p.y, box.size), wrap(p.z, box.size));
  }
  dispose() {
    this.group.removeFromParent();
    for (const mesh of this.parts) {
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
  }
}
// The finished frame, as kelp3 presents it: the scene drawn in linear light, so that shafts, specks and bubbles
// add to what is behind them as light does, and only then mapped (ACES) and encoded for the screen.
export class Presenter {
  constructor() {
    this.target = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true, generateMipmaps: false });
    this.material = new THREE.ShaderMaterial({
      uniforms: { uFrame: { value: this.target.texture } },
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */ `uniform sampler2D uFrame; varying vec2 vUv; void main(){ gl_FragColor = vec4(texture2D(uFrame, vUv).rgb, 1.0); ${K_OUT} }`,
      depthTest: false,
      depthWrite: false,
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.mesh);
    this.camera = new THREE.Camera();
    this.size = new THREE.Vector2();
  }
  render(renderer, scene, camera) {
    renderer.getDrawingBufferSize(this.size);
    if (this.target.width !== this.size.x || this.target.height !== this.size.y) this.target.setSize(this.size.x, this.size.y);
    const before = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(before);
    renderer.render(this.scene, this.camera);
  }
  dispose() {
    this.target.dispose();
    this.material.dispose();
    this.mesh.geometry.dispose();
  }
}
export { KU };
