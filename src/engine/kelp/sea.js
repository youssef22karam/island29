/* =============================================================================
   kelp/sea.js — the sea everything under water shares.
   -----------------------------------------------------------------------------
   A direct port of kelp3's water.ts / shade.ts from TSL (WebGPU node graphs) to
   plain GLSL for the island's WebGL2 renderer: the light coming down through
   the surface, the colour and clarity of the water, the way the water moves,
   Dave Hoskins' thread caustics traced up toward the sun, the direction-
   dependent haze, per-channel Beer-Lambert absorption, and the standard
   (sun + hemisphere) lighting kelp3's MeshStandardNodeMaterials receive.
   Adapted to the island: the surface is the fresh-water level (y = 0), the
   sun follows the island's clock, and the look glides between three waters —
   lake (kelp3's forest, untouched), river and swamp.
============================================================================= */
import * as THREE from "three";
// The height of the surface; beds lie below it.
export const SURFACE = 0;
// The swell is drawn out to a short wavelength, a few metres, so it is seen to travel through the forest.
const SHORTER = 18;
// The way the swell travels across the floor.
export const SWELL = new THREE.Vector2(1, 0.35).normalize();
// One set of uniform objects, shared by reference with every kelp material *and* spread into the island's own
// shared uniforms, so the terrain and the trees are finished by the same water.
export const KU = {
  kShallow: { value: new THREE.Color("#5fb3a4") },
  kDeep: { value: new THREE.Color("#0a2730") },
  kSun: { value: new THREE.Color("#fff3d6") },
  kPower: { value: 3.2 },
  kToSun: { value: new THREE.Vector3(0.41, 0.56, -0.72).normalize() },
  kToSunAir: { value: new THREE.Vector3(0.49, 0.24, -0.84).normalize() },
  kMurk: { value: 0.05 },
  kAbsorb: { value: new THREE.Vector3(2.4, 1, 0.85) },
  kCaustics: { value: 1.1 },
  kCell: { value: 1.7 },
  kFlicker: { value: 1 },
  kShafts: { value: 1.5 },
  kClock: { value: 0 },
  kSwell: { value: 0.5 },
  kSurge: { value: 0 },
  kWaveK: { value: 0.7 },
  kDrift: { value: new THREE.Vector2() },
  kCarried: { value: new THREE.Vector2() },
  // 1 while the eye is under the surface.
  kUnder: { value: 0 },
  // The bed's height under the eye, eased: shafts and specks scale themselves to the water they are in.
  kBedY: { value: -6 },
  kEye: { value: new THREE.Vector3() },
  // lake, river, swamp round the eye.
  kBiome: { value: new THREE.Vector3(1, 0, 0) },
  // The floor's generated "scans": sand, pebbled sand, rock, and their normals, as layers of one texture.
  kTex: { value: null },
  kFocus: { value: 4 }, // How far round the eye the bed is planted, in metres. The water closes over everything before that distance,
// and whatever is rooted on the bed stands up from nothing as it comes inside it, so nothing is seen arriving.
kHorizon: { value: 40 }, };
export const K_GLSL = /* glsl */ `
uniform vec3 kShallow, kDeep, kSun, kToSun, kToSunAir, kAbsorb, kEye, kBiome;
uniform float kPower, kMurk, kCaustics, kCell, kFlicker, kShafts, kClock, kSwell, kSurge, kWaveK, kUnder, kBedY, kFocus, kHorizon;
uniform vec2 kDrift, kCarried;
uniform highp sampler2DArray kTex;
const vec2 K_SWELL = vec2(0.943858, 0.330350);
const float K_SHORTER = 18.0;
// sand tint #a8a090, linear
const vec3 K_SAND = vec3(0.3916, 0.3515, 0.2789);
vec3 kH3(vec3 p){
  p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)));
  return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
}
// Gradient noise in about [-1, 1], standing in for MaterialX's mx_noise_float.
float kNoise3(vec3 p){
  vec3 i = floor(p), f = fract(p);
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = dot(kH3(i), f), b = dot(kH3(i + vec3(1., 0., 0.)), f - vec3(1., 0., 0.));
  float c = dot(kH3(i + vec3(0., 1., 0.)), f - vec3(0., 1., 0.)), d = dot(kH3(i + vec3(1., 1., 0.)), f - vec3(1., 1., 0.));
  float e = dot(kH3(i + vec3(0., 0., 1.)), f - vec3(0., 0., 1.)), g = dot(kH3(i + vec3(1., 0., 1.)), f - vec3(1., 0., 1.));
  float h = dot(kH3(i + vec3(0., 1., 1.)), f - vec3(0., 1., 1.)), k = dot(kH3(i + vec3(1., 1., 1.)), f - vec3(1.));
  return 1.5 * mix(mix(mix(a, b, u.x), mix(c, d, u.x), u.y), mix(mix(e, g, u.x), mix(h, k, u.x), u.y), u.z);
}
// One of the floor's scans, as colour.
vec3 kTexC(vec2 uv, float layer){
  return pow(texture(kTex, vec3(uv, layer)).rgb, vec3(2.2));
}
// Dave Hoskins' tileable water caustic (MIT, Shadertoy MdlXz8), unrolled: bright threads where the light gathers.
float kThreads(vec2 uv, float t){
  const float TAU = 6.28318530718;
  vec2 p = mod(uv * TAU, TAU) - 250.0;
  vec2 i = p;
  float c = 1.0;
  const float inten = 0.005;
  for(int n = 0; n < 3; n++){
    float tt = t * (1.0 - 3.5 / float(n + 1));
    i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten)));
  }
  c = 1.15 - pow(c / 3.0, 1.35);
  return pow(abs(c), 7.0);
}
// Light wavering over a surface at P facing N, as it comes down through the moving surface: traced up toward the
// sun to the surface, split slightly into colours the deeper it has come, softer near the surface where it has
// not yet gathered, and strongest on whatever faces the sun.
vec3 kCausticsAt(vec3 P, vec3 N){
  float below = max(-P.y, 0.0);
  vec3 s = kToSun;
  vec2 q = P.xz + s.xz / max(s.y, 0.2) * below;
  vec2 uv = q / (kCell * 4.0);
  float t = kClock * 0.42 * kFlicker + 23.0;
  float split = min(below * 0.15, 0.35);
  float c = kThreads(uv, t);
  float r = c * (1.0 + split);
  float b = c * (1.0 - split);
  float patchy = kNoise3(vec3(q.x * 0.07, kClock * 0.05, q.y * 0.07)) * 0.45 + 0.75;
  float formed = smoothstep(0.2, 2.5, below) * 1.8;
  float facing = smoothstep(-0.1, 0.6, dot(N, s));
  return vec3(r, (r + b) * 0.5, b) * (formed * facing * patchy * kCaustics * kPower) * kSun;
}
// The water itself in a direction: bright toward the surface, deep below, lit from the sun's side, and the glow
// of the sun through it.
vec3 kHaze(vec3 dir){
  vec3 d = normalize(dir);
  float up = d.y;
  vec3 rgb = mix(kDeep, kShallow, smoothstep(-0.55, 0.9, up));
  // The bright disc of sky overhead (Snell's window), soft-edged by the waves.
  rgb += kShallow * (smoothstep(0.6, 0.8, up) * 0.9);
  rgb *= mix(0.42, 1.0, smoothstep(-0.35, 0.85, dot(d, kToSun)));
  float toward = max(dot(d, kToSun), 0.0);
  return rgb + kSun * ((pow(toward, 5.0) * 0.22 + pow(toward, 48.0) * 0.7) * kPower * 0.35);
}
// How much light is left after a path through the water, colour by colour.
vec3 kThrough(float dist){
  return exp(-kAbsorb * (kMurk * dist));
}
// What anything under water looks like from the eye: its own colour dimmed by the water the light came down
// through, then by the water between it and the eye, giving way to the colour of the water behind it. Seen from
// the air the water between is left to the surface's own shading.
vec3 kSeen(vec3 rgb, vec3 P){
  vec3 down = kThrough(max(-P.y, 0.0) * 0.55);
  if(kUnder < 0.5) return rgb * down;
  vec3 toP = P - cameraPosition; float away = length(toP); // Past the planting horizon there is only water: the bed and all on it are lost in it well before they end.
float hz = kHorizon > 1.0 ? kHorizon : 1.0e6; vec3 kept = kThrough(away * 1.6) * (1.0 - smoothstep(hz * 0.6, hz * 0.93, away)); return rgb * down * kept + kHaze(toP) * (vec3(1.0) - kept); } // How fully a thing rooted at p stands: nothing at the planting horizon, whole a little way inside it.
float kStands(vec3 p){ float hz = kHorizon > 1.0 ? kHorizon : 1.0e6; return 1.0 - smoothstep(hz * 0.8, hz * 0.97, distance(p.xz, kEye.xz)); }
// How far the water has carried a point at p, for things rooted on the floor to bend with: each bit of water
// swings to and fro with the swell, less the deeper it is, and the steady current leans everything one way.
vec3 kSwayAt(vec3 p, vec2 drift){
  float phase = (p.x * K_SWELL.x + p.z * K_SWELL.y) * kWaveK - kSurge;
  float decay = exp(-(kWaveK / K_SHORTER) * max(-p.y, 0.0));
  float along = -sin(phase) * kSwell * decay;
  float eddy = sin(kClock * 0.9 + p.x * 1.3 + p.z * 0.7) * 0.04;
  vec2 lean = drift * 2.2;
  return vec3(along * K_SWELL.x + eddy + lean.x, 0.0, along * K_SWELL.y - eddy * 0.6 + lean.y);
}
`;
// Fragment-only: the lighting three's standard material gives under kelp3's sun and hemisphere fill, and the
// finish every solid thing under water gets (shade.ts).
export const K_FRAG = /* glsl */ `
vec3 kLit(vec3 albedo, vec3 N, vec3 V, float rough){
  vec3 L = kToSun;
  float nl = max(dot(N, L), 0.0);
  vec3 sunI = kSun * (kPower * 0.9);
  vec3 hemi = mix(kDeep, kShallow, 0.5 + 0.5 * N.y) * 1.6;
  vec3 diff = albedo * 0.31831 * (sunI * nl + hemi);
  vec3 H = normalize(L + V);
  float nh = max(dot(N, H), 0.0), nv = max(dot(N, V), 1e-3), vh = max(dot(V, H), 0.0);
  float a = max(rough * rough, 0.01), a2 = a * a;
  float dd = nh * nh * (a2 - 1.0) + 1.0;
  float D = a2 / (3.14159265 * dd * dd);
  float vis = 0.5 / max(nl * sqrt(nv * nv * (1.0 - a2) + a2) + nv * sqrt(nl * nl * (1.0 - a2) + a2), 1e-4);
  float F = 0.04 + 0.96 * pow(1.0 - vh, 5.0);
  return diff + sunI * min(D * vis * F * nl, 4.0);
}
// Caustics laid over its own colour, light through it if it is thin, then the water between it and the eye.
vec3 kFinish(vec3 albedo, vec3 N, vec3 P, float rough, vec3 caust, vec3 thru){
  vec3 V = normalize(cameraPosition - P);
  vec3 col = kLit(albedo, N, V, rough);
  vec3 glow = albedo * caust * 2.2;
  float into = pow(max(dot(-V, kToSun), 0.0), 2.5);
  glow += thru * kSun * kPower * (into * 0.85 + 0.06);
  return kSeen(col + glow, P);
}
`;
// ---------------------------------------------------------------------------------------------------------------------
// The looks: kelp3's forest for lakes, and the same sea retuned for running rivers and still, tea-stained swamps.
// ---------------------------------------------------------------------------------------------------------------------
const col = (hex) => new THREE.Color(hex);
const LOOKS = {
  lake: { shallow: col("#5fb3a4"), deep: col("#0a2730"), sun: col("#fff3d6"), power: 3.2, murk: 0.05, absorb: [2.4, 1, 0.85], caustics: 1.1, cell: 1.7, shafts: 1.5, swell: 0.55, period: 9 },
  river: { shallow: col("#6ab592"), deep: col("#0b2924"), sun: col("#fff2d2"), power: 3.2, murk: 0.057, absorb: [2.3, 1, 1.05], caustics: 1.25, cell: 1.45, shafts: 1.4, swell: 0.3, period: 7 },
  swamp: { shallow: col("#93a562"), deep: col("#161c0c"), sun: col("#ffe4ac"), power: 2.8, murk: 0.085, absorb: [1.6, 1, 1.9], caustics: 0.85, cell: 1.9, shafts: 2.0, swell: 0.14, period: 11 },
};
const wanted = {
  shallow: new THREE.Color().copy(LOOKS.lake.shallow),
  deep: new THREE.Color().copy(LOOKS.lake.deep),
  sun: new THREE.Color().copy(LOOKS.lake.sun),
  power: 3.2,
  toSun: new THREE.Vector3().copy(KU.kToSun.value),
  toSunAir: new THREE.Vector3().copy(KU.kToSunAir.value),
  murk: 0.05,
  absorb: new THREE.Vector3(2.4, 1, 0.85),
  caustics: 1.1,
  cell: 1.7,
  shafts: 1.5,
  swell: 0.55,
  period: 9,
  flowX: 0,
  flowZ: 0,
};
// The parts of a look the water's motion reads on the processor, eased like the rest. strength is kelp3's Current
// setting (0.3 there); a river's own current is added per plant.
export const motion = { swell: 0.55, period: 9, phase: 0, calm: 1, flowX: 0, flowZ: 0, strength: 0.3 };
// Toward the sun under water and above it, from its bearing and how high it is drawn under water, in degrees.
// Under water the sun is drawn lower than the surface would let it be, nearer the eye's line, so it shows shining
// through without having to look straight up; the sun in the air stands lower still, as the surface bends.
function sunWays(bearing, seenDegrees, under, air) {
  const e = THREE.MathUtils.degToRad(Math.max(4, 90 - (90 - seenDegrees) * 1.36));
  const seen = THREE.MathUtils.degToRad(seenDegrees);
  under.set(Math.cos(seen) * Math.cos(bearing), Math.sin(seen), Math.cos(seen) * Math.sin(bearing)).normalize();
  air.set(Math.cos(e) * Math.cos(bearing), Math.sin(e), Math.cos(e) * Math.sin(bearing)).normalize();
}
const scratch = new THREE.Color();
let bearing = -Math.PI / 3;
// Aims the sea at the water round the eye and the island's sky. w: lake, river, swamp weights; env: the island's
// sun and moon directions, sun colour, daylight, storm, and the current round the eye in metres a second.
export function aimSea(w, env) {
  const sum = Math.max(1e-4, w.lake + w.river + w.swamp);
  const a = w.lake / sum, b = w.river / sum, c = w.swamp / sum;
  const num = (key) => LOOKS.lake[key] * a + LOOKS.river[key] * b + LOOKS.swamp[key] * c;
  const tone = (key, out) =>
    out.setRGB(
      LOOKS.lake[key].r * a + LOOKS.river[key].r * b + LOOKS.swamp[key].r * c,
      LOOKS.lake[key].g * a + LOOKS.river[key].g * b + LOOKS.swamp[key].g * c,
      LOOKS.lake[key].b * a + LOOKS.river[key].b * b + LOOKS.swamp[key].b * c,
    );
  const storm = env.storm || 0;
  const sunY = env.sun ? env.sun.y : 1;
  const up = THREE.MathUtils.smoothstep(sunY, -0.04, 0.22);
  // Daylight on the water: the island's own light, never quite black so a moonlit dive still reads.
  const day = Math.max(0.045, (env.light ?? 1) * (1 - 0.4 * storm));
  tone("shallow", wanted.shallow).multiplyScalar(0.06 + 0.94 * day);
  tone("deep", wanted.deep).multiplyScalar(0.12 + 0.88 * day);
  tone("sun", wanted.sun);
  if (env.sunCol) {
    // The island's sun colour, warm at dawn and dusk, tints kelp3's.
    const m = Math.max(env.sunCol.r, env.sunCol.g, env.sunCol.b, 1e-3);
    scratch.setRGB(env.sunCol.r / m, env.sunCol.g / m, env.sunCol.b / m);
    wanted.sun.lerp(scratch.multiply(wanted.sun), 0.65);
  }
  wanted.power = num("power") * Math.max(0.05, (0.07 + 0.93 * up) * (1 - 0.6 * storm));
  const from = sunY > -0.04 || !env.moon ? env.sun : env.moon;
  if (from && Math.hypot(from.x, from.z) > 1e-3) bearing = Math.atan2(from.z, from.x);
  sunWays(bearing, 34 + 22 * Math.pow(Math.max(0, Math.min(1, Math.abs(from ? from.y : 1))), 1.3), wanted.toSun, wanted.toSunAir);
  wanted.murk = num("murk") * (1 + 0.5 * storm);
  wanted.absorb.set(
    LOOKS.lake.absorb[0] * a + LOOKS.river.absorb[0] * b + LOOKS.swamp.absorb[0] * c,
    LOOKS.lake.absorb[1] * a + LOOKS.river.absorb[1] * b + LOOKS.swamp.absorb[1] * c,
    LOOKS.lake.absorb[2] * a + LOOKS.river.absorb[2] * b + LOOKS.swamp.absorb[2] * c,
  );
  wanted.caustics = num("caustics") * (1 - 0.7 * storm);
  wanted.cell = num("cell");
  wanted.shafts = num("shafts") * (1 - 0.6 * storm);
  wanted.swell = num("swell") * (1 + 0.8 * storm);
  wanted.period = num("period");
  wanted.flowX = env.flowX || 0;
  wanted.flowZ = env.flowZ || 0;
  KU.kBiome.value.set(a, b, c);
}
export function easeSea(k) {
  KU.kShallow.value.lerp(wanted.shallow, k);
  KU.kDeep.value.lerp(wanted.deep, k);
  KU.kSun.value.lerp(wanted.sun, k);
  KU.kPower.value += (wanted.power - KU.kPower.value) * k;
  KU.kToSun.value.lerp(wanted.toSun, k).normalize();
  KU.kToSunAir.value.lerp(wanted.toSunAir, k).normalize();
  KU.kMurk.value += (wanted.murk - KU.kMurk.value) * k;
  KU.kAbsorb.value.lerp(wanted.absorb, k);
  KU.kCaustics.value += (wanted.caustics - KU.kCaustics.value) * k;
  KU.kCell.value += (wanted.cell - KU.kCell.value) * k;
  KU.kShafts.value += (wanted.shafts - KU.kShafts.value) * k;
  motion.swell += (wanted.swell - motion.swell) * k;
  motion.period += (wanted.period - motion.period) * k;
  motion.flowX += (wanted.flowX - motion.flowX) * k;
  motion.flowZ += (wanted.flowZ - motion.flowZ) * k;
}
// Moves the swell on, keeping its phase whole while its period eases.
export function advance(delta) {
  const w = (Math.PI * 2) / motion.period;
  motion.phase += w * delta;
  KU.kClock.value += delta;
  KU.kSurge.value = motion.phase % (Math.PI * 2);
  KU.kWaveK.value = ((w * w) / 9.81) * SHORTER;
  motion.calm = Math.min(1, 0.3 + 0.7 * motion.strength);
  KU.kSwell.value = motion.swell * motion.calm;
  KU.kDrift.value.set(motion.flowX, motion.flowZ);
  KU.kCarried.value.x = (KU.kCarried.value.x + motion.flowX * delta) % 4096;
  KU.kCarried.value.y = (KU.kCarried.value.y + motion.flowZ * delta) % 4096;
}
// How the water moves at a point: the to and fro of the swell passing overhead (each bit of water swings round an
// ellipse that shrinks with depth) and small eddies. lag and pace: for one plant, how far behind the swell it
// rides and how much faster or slower it swings, so plants a few metres apart never sway in step. The steady
// current is each plant's own (a river's runs along its bed).
export function flow(x, y, z, t, out, at = 0, lag = 0, pace = 1) {
  const w = (Math.PI * 2) / motion.period;
  const k = (w * w) / 9.81;
  const phase = k * (SWELL.x * x + SWELL.y * z) * SHORTER - motion.phase * pace + lag;
  t = t * pace + lag * 3;
  const decay = Math.exp(-k * Math.max(0, SURFACE - y));
  const swell = motion.swell * motion.calm * w * decay;
  const along = swell * Math.cos(phase);
  const lift = swell * Math.sin(phase) * 0.5;
  const eddy = (0.035 + motion.swell * 0.02) * motion.calm;
  out[at] = SWELL.x * along + eddy * Math.sin(0.61 * z + 0.9 * y + t * 0.73) * Math.cos(0.37 * x - t * 0.41);
  out[at + 1] = lift + eddy * 0.5 * Math.sin(0.5 * x + 0.43 * z + t * 0.57);
  out[at + 2] = SWELL.y * along + eddy * Math.cos(0.53 * x + 0.7 * y - t * 0.66) * Math.sin(0.41 * z + t * 0.38);
}
// Stirrings of the water, shared by everything that moves in it: a burst out from a point (a tap, or the swimmer's
// own passing). Each fades over a couple of seconds.
export const stirs = [];
export function stir(x, y, z, burst) {
  stirs.push({ x, y, z, burst, age: 0 });
  if (stirs.length > 16) stirs.shift();
}
export function ageStirs(delta) {
  for (const s of stirs) s.age += delta;
  for (let i = stirs.length - 1; i >= 0; i--) if (stirs[i].age > 2.5) stirs.splice(i, 1);
}
// The water's speed at a point: the swell and eddies, plus whatever the stirrings add, capped so that however
// hard the stirring, the water it moves goes no faster than a strong surge.
export function waterAt(x, y, z, t, out, cap = 0.9, lag = 0, pace = 1) {
  flow(x, y, z, t, out, 0, lag, pace);
  if (!stirs.length) return;
  let sx = 0, sy = 0, sz = 0;
  for (let i = 0; i < stirs.length; i++) {
    const s = stirs[i];
    const dx = x - s.x, dy = y - s.y, dz = z - s.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > 30) continue;
    const d = Math.sqrt(d2) + 1e-4;
    const push = (s.burst * Math.exp(-s.age * 1.6) * Math.exp(-d2 / 2.2)) / d;
    sx += dx * push;
    sy += dy * push;
    sz += dz * push;
  }
  const stirred = Math.hypot(sx, sy, sz);
  const k = stirred > cap ? cap / stirred : 1;
  out[0] += sx * k;
  out[1] += sy * k;
  out[2] += sz * k;
}
// A material finished by the sea: the shared uniforms, the shared GLSL, and the caller's shaders.
export function kMaterial(o) {
  return new THREE.ShaderMaterial({
    uniforms: { ...KU, ...(o.uniforms || {}) },
    vertexShader: K_GLSL + o.vertex,
    fragmentShader: K_GLSL + K_FRAG + o.fragment,
    side: o.side ?? THREE.FrontSide,
    transparent: !!o.transparent,
    depthWrite: o.depthWrite ?? true,
    depthTest: o.depthTest ?? true,
    blending: o.blending ?? THREE.NormalBlending,
  });
}
// Every fragment shader ends the same way.
export const K_OUT = /* glsl */ `
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
`;
 // The floor as kelp3's Sand lays it: a scan of sand with stones bedded in it, giving way in drifts to clean sand
// rippled across the swell, bedrock breaking through in patches. For the island's terrain shader. Returns its
// colour; bump is the floor's own normal as if it lay flat. Texture places are taken relative to a point near the
// eye (a whole number of tiles off), so they stay sharp kilometres out.
export const K_BED = /* glsl */ ` vec2 kLocal(vec2 p, float T){ return (p - floor(kEye.xz / T) * T) / T; } vec3 kBed(vec3 P, float pixel, float run, float sw, out vec3 bump){ vec2 p = P.xz; float stones = smoothstep(-0.28, 0.22, kNoise3(vec3(p.x * 0.13, 2.1, p.y * 0.13))); float rock = smoothstep(0.18, 0.42, kNoise3(vec3(p.x * 0.11 + 4.0, 9.3, p.y * 0.11))); // A river's bed is cobble where it runs; a swamp's is silt, with little stone showing.
stones = clamp(stones + run * 0.55 - sw * 0.5, 0.0, 1.0); rock *= 1.0 - sw * 0.8; float wander = kNoise3(vec3(p.x * 0.25, 0.0, p.y * 0.25)) * 1.4; float fineK = 1.0 - smoothstep(0.05, 0.22, pixel); float phase = (p.x * K_SWELL.x + p.y * K_SWELL.y) * 11.0 + wander; float rh = sin(phase) * fineK; float rdh = cos(phase) * 0.154 * fineK; vec2 coastUv = kLocal(p, 2.6), sandUv = kLocal(p, 1.612903), rockUv = kLocal(p, 3.2); vec3 coast = kTexC(coastUv, 1.0); vec3 plain = kTexC(sandUv, 0.0) * (rh * 0.07 + 1.0); vec3 bedrock = kTexC(rockUv, 2.0); vec3 tone = mix(mix(plain, coast, stones) * K_SAND * 1.35, bedrock * 1.15, rock); // Silt and fallen leaves darken a swamp's floor.
float litter = smoothstep(0.1, 0.5, kNoise3(vec3(p.x * 0.8, 4.4, p.y * 0.8))); tone = mix(tone, tone * mix(vec3(0.34, 0.31, 0.2), vec3(0.52, 0.36, 0.19), litter), sw * 0.85); vec3 ns = texture(kTex, vec3(sandUv, 3.0)).rgb * 2.0 - 1.0; vec3 nc = texture(kTex, vec3(coastUv, 4.0)).rgb * 2.0 - 1.0; vec3 b = mix(vec3(ns.x, ns.z, ns.y), vec3(nc.x * 1.4, nc.z, nc.y * 1.4), max(stones, rock)); bump = normalize(b - vec3(K_SWELL.x, 0.0, K_SWELL.y) * (rdh * (1.0 - stones) * (1.0 - rock))); return tone; } `;
