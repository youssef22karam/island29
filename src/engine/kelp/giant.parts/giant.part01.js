/* =============================================================================
   kelp/giant.js — giant kelp, as kelp3 grows and draws it.
   -----------------------------------------------------------------------------
   chains.ts  -> Chains: stipes as point chains carried by the water (dragged
                 toward its speed), lifted by their floats, held to length by
                 following the chain out from the root so they never stretch;
                 stepped at a fixed rate and drawn between the last two steps.
   kelp.ts    -> growPlant: a holdfast, several stipes (some reaching the top to
                 lie along the surface as canopy, the rest young), side branches.
   plants.tsx -> KelpPool: stipes as smooth Catmull-Rom tubes through the
                 simulated points, a ruffled, pocked, twisting blade on a gas
                 float at every node, bending on the GPU to stream with the
                 water past it, and a forking tangle of haptera at each root.
   The island streams plants in and out round the eye, so every plant owns its
   chains and all of them are drawn from one pool: four draws in all.
============================================================================= */
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { lehmer } from "./random";
import { K_OUT, SURFACE, kMaterial, waterAt } from "./sea.js";
export const NODES = 16;
const STEP = 1 / 90;
// How fast any point of a plant may move through the water, m/s: a little over the swell's own top speed.
const MOST_SPEED = 0.55;
export class Chains {
  constructor(specs, nodes, options) {
    this.specs = specs;
    this.nodes = nodes;
    // Each plant its own lag behind the swell and pace through it; a branch rides with the plant it grows from.
    this.lag = new Float32Array(specs.length);
    this.pace = new Float32Array(specs.length);
    specs.forEach((spec, i) => {
      if (spec.parent !== undefined) {
        const from = Math.floor(spec.parent / nodes);
        this.lag[i] = this.lag[from];
        this.pace[i] = this.pace[from];
        return;
      }
      const h = Math.sin(spec.root.x * 12.9898 + spec.root.z * 78.233) * 43758.5453;
      const r = h - Math.floor(h);
      this.lag[i] = r * Math.PI * 2;
      this.pace[i] = 0.85 + ((r * 7.31) % 1) * 0.3;
    });
    this.ceiling = options.ceiling ?? SURFACE - 0.04;
    this.ground = options.ground;
    // How firmly the water drags the chain along, at the root and at the tip.
    this.drag = options.drag ?? [1.6, 3];
    this.rate = options.rate ?? STEP;
    // The steady current where this plant stands, m/s.
    this.current = options.current ?? [0, 0];
    this.time = 0;
    this.carry = 0;
    this.ticks = 0;
    this.water = new Float32Array(3);
    const n = specs.length * nodes;
    this.segment = new Float32Array(specs.map((s) => s.length / (nodes - 1)));
    // Float64: world coordinates run to kilometres, and speed is the difference of two positions.
    this.position = new Float64Array(n * 3);
    this.previous = new Float64Array(n * 3);
    this.last = new Float64Array(n * 3);
    this.shown = new Float32Array(n * 3);
    this.stream = new Float32Array(n * 3);
    this.sampled = new Float32Array(n * 3);
    const lean = new THREE.Vector3();
    specs.forEach((s, i) => {
      lean.copy(s.lean ?? lean.set(0, 1, 0)).normalize();
      for (let k = 0; k < nodes; k++) {
        const o = (i * nodes + k) * 3;
        this.position[o] = s.root.x + lean.x * this.segment[i] * k;
        this.position[o + 1] = Math.min(this.ceiling, s.root.y + lean.y * this.segment[i] * k);
        this.position[o + 2] = s.root.z + lean.z * this.segment[i] * k;
      }
    });
    this.previous.set(this.position);
    // Left to settle under its real load before it is shown.
    const settle = (options.settle ?? 120) * (STEP / this.rate);
    for (let k = 0; k < settle; k++) this.step(this.rate);
    this.last.set(this.position);
    this.shown.set(this.position);
  }
  // Moves on by a frame's time, in whole fixed steps, and works out what to draw.
  update(delta) {
    const rate = this.rate;
    this.carry = Math.min(this.carry + Math.max(0, delta), rate * 8);
    while (this.carry >= rate) {
      this.last.set(this.position);
      this.step(rate);
      this.carry -= rate;
    }
    const a = this.carry / rate;
    const p = this.position;
    const l = this.last;
    const s = this.shown;
    for (let i = 0; i < s.length; i++) s[i] = l[i] + (p[i] - l[i]) * a;
  }
  step(dt) {
    this.time += dt;
    const t = this.time;
    const p = this.position;
    const q = this.previous;
    const water = this.water;
    // The water round each point, sampled every other step: it changes over seconds, so half as often never shows.
    const fresh = this.ticks++ % 2 === 0;
    const sampled = this.sampled;
    const smooth = 1 - Math.exp(-dt * 1.4);
    const N = this.nodes;
    const dragRoot = this.drag[0];
    const dragTip = this.drag[1];
    const cx = this.current[0];
    const cz = this.current[1];
    for (let i = 0; i < this.specs.length; i++) {
      const spec = this.specs[i];
      const base = i * N;
      if (spec.parent !== undefined) {
        const r = base * 3;
        const f = spec.parent * 3;
        for (let c = 0; c < 3; c++) {
          p[r + c] = p[f + c];
          q[r + c] = q[f + c];
        }
      }
      for (let k = 1; k < N; k++) {
        const o = (base + k) * 3;
        const x = p[o];
        const y = p[o + 1];
        const z = p[o + 2];
        if (fresh) {
          waterAt(x, y, z, t, water, 0.9, this.lag[i], this.pace[i]);
          // A river's current slackens toward its bed.
          const shear = 0.35 + 0.65 * Math.min(1, k / 5);
          water[0] += cx * shear;
          water[2] += cz * shear;
          sampled[o] = water[0];
          sampled[o + 1] = water[1];
          sampled[o + 2] = water[2];
        } else {
          water[0] = sampled[o];
          water[1] = sampled[o + 1];
          water[2] = sampled[o + 2];
        }
        let vx = (x - q[o]) / dt;
        let vy = (y - q[o + 1]) / dt;
        let vz = (z - q[o + 2]) / dt;
        // Never faster than a strong swell carries it: a plant may swing far but never whip.
        const fast = Math.hypot(vx, vy, vz);
        if (fast > MOST_SPEED) {
          const f = MOST_SPEED / fast;
          vx *= f;
          vy *= f;
          vz *= f;
        }
        this.stream[o] += (water[0] - vx - this.stream[o]) * smooth;
        this.stream[o + 1] += (water[1] - vy - this.stream[o + 1]) * smooth;
        this.stream[o + 2] += (water[2] - vz - this.stream[o + 2]) * smooth;
        const along = k / N;
        const drag = dragRoot + (dragTip - dragRoot) * along;
        const lift = spec.lift * (0.9 + along * 1.2);
        q[o] = x;
        q[o + 1] = y;
        q[o + 2] = z;
        p[o] = x + vx * dt + (water[0] - vx) * drag * dt * dt;
        p[o + 1] = y + vy * dt + ((water[1] - vy) * drag + lift) * dt * dt;
        p[o + 2] = z + vz * dt + (water[2] - vz) * drag * dt * dt;
      }
      const length = this.segment[i];
      for (let k = 1; k < N; k++) {
        const o = (base + k) * 3;
        const a = o - 3;
        const dx = p[o] - p[a];
        const dy = p[o + 1] - p[a + 1];
        const dz = p[o + 2] - p[a + 2];
        const f = length / (Math.hypot(dx, dy, dz) || 1);
        const nx = p[a] + dx * f;
        const ny = p[a + 1] + dy * f;
        const nz = p[a + 2] + dz * f;
        // The correction moves the previous point with it, so following does not turn into speed.
        q[o] += (nx - p[o]) * 0.9;
        q[o + 1] += (ny - p[o + 1]) * 0.9;
        q[o + 2] += (nz - p[o + 2]) * 0.9;
        p[o] = nx;
        p[o + 1] = ny;
        p[o + 2] = nz;
        if (p[o + 1] > this.ceiling) {
          q[o + 1] += this.ceiling - p[o + 1];
          p[o + 1] = this.ceiling;
        }
        const ground = this.ground(p[o], p[o + 2]) + 0.03;
        if (p[o + 1] < ground) {
          q[o + 1] += ground - p[o + 1];
          p[o + 1] = ground;
        }
      }
    }
  }
}
// One plant at a site on the bed: { x, y, z, size, tint, flowX, flowZ, seed, far, gx, gz } (gx, gz the bed's
// slope there, so the chains know the ground without asking the world for every point).
export function growPlant(site) {
  const random = lehmer(site.seed);
  const specs = [];
  const stipes = [];
  const stems = Math.min(site.far ? 4 : 7, 4 + Math.floor(random() * 3 * site.size));
  for (let s = 0; s < stems; s++) {
    const a = random() * Math.PI * 2;
    const root = new THREE.Vector3(site.x + Math.cos(a) * 0.12, site.y + 0.12, site.z + Math.sin(a) * 0.12);
    const reach = SURFACE - root.y;
    // Some reach the top and lie along it; the rest are young, stopping anywhere on their way up. In the deep
    // middle of a lake none reach it: the forest stands under the surface there.
    const grown = random() < 0.55 && reach < 12.5;
    const length = grown ? reach * (1.15 + random() * 0.55) : Math.min(10.5, reach * (0.2 + random() * 0.6));
    stipes.push({ length, thick: 1 });
    specs.push({ root, length, lift: 0.6 + random() * 0.6, lean: new THREE.Vector3(random() - 0.5, 1.6, random() - 0.5) });
  }
  // Side branches off the stems partway up, short, ending well below the surface.
  for (let i = 0; i < stems && !site.far; i++) {
    if (random() >= 0.45 || specs.length >= 11) continue;
    const node = 2 + Math.floor(random() * Math.max(1, NODES - 6));
    const from = specs[i];
    const reach = SURFACE - from.root.y;
    const up = Math.min(1, (node / (NODES - 1)) * (from.length / reach));
    const root = from.root.clone().setY(from.root.y + up * reach * 0.8);
    const length = Math.min(SURFACE - root.y - 0.5, 0.9 + random() * 2.6);
    if (length < 0.6) continue;
    stipes.push({ length, thick: 0.6 });
    specs.push({ root, length, lift: 0.5 + random() * 0.5, lean: new THREE.Vector3(random() - 0.5, 1, random() - 0.5), parent: i * NODES + node });
  }
  const gx = site.gx || 0;
  const gz = site.gz || 0;
  const ground = (x, z) => site.y + (x - site.x) * gx + (z - site.z) * gz;
  const chains = new Chains(specs, NODES, {
    ground,
    current: [(site.flowX || 0) + 0.075 * (1 - site.tint), (site.flowZ || 0) + 0.03 * (1 - site.tint)],
    rate: site.rate ?? STEP,
    settle: 80,
  });
  // Blades: one at each node above the first few. Short stipes carry small blades, as the young do.
  const sites = [];
  const every = site.far ? 2 : 1;
  stipes.forEach((s, i) => {
    const grownUp = Math.min(1.35, Math.max(0.5, s.length / (NODES - 1) / 0.6));
    for (let k = 2; k < NODES; k += every) {
      const tip = k / (NODES - 1);
      const size = (s.length < 6 ? 0.55 + 0.45 * (1 - tip) : 1) * grownUp * site.size;
      // Round the stipe from node to node, by the golden angle.
      const turn = k * 2.39996 + (random() - 0.5) * 0.8;
      sites.push({
        chain: i,
        node: k,
        length: (0.45 + random() * 0.45) * size,
        width: (0.045 + random() * 0.035) * size,
        phase: random() * 100,
        cx: Math.cos(turn),
        cz: Math.sin(turn),
      });
    }
  });
  return { site, chains, stipes, sites, turn: random() * Math.PI * 2, variant: random() < 0.5 ? 0 : 1 };
}
// A tube along a curve, its radius running from r0 at the start to r1 at the end.
function taperedTube(curve, segments, r0, r1, radial) {
  const frames = curve.computeFrenetFrames(segments, false);
  const points = [];
  const index = [];
  const p = new THREE.Vector3();
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    curve.getPointAt(t, p);
    const r = r0 + (r1 - r0) * Math.pow(t, 0.8);
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const n = frames.normals[i].clone().multiplyScalar(Math.cos(a)).addScaledVector(frames.binormals[i], Math.sin(a));
      points.push(p.x + n.x * r, p.y + n.y * r, p.z + n.z * r);
    }
  }
  for (let i = 0; i < segments; i++)
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j;
      const b = a + radial + 1;
      index.push(a, b, a + 1, a + 1, b, b + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}
// Holdfasts, as giant kelp's grow: a cone of root-like haptera climbing the stipes' bases, each one thick where it
// leaves the bundle and tapering as it arches out and down into the sand, forking twice on the way, so the plant
// stands on a tangled mound rather than a few sticks. Built once at the origin for a plant of size one.
function holdfast(seed, fine) {
  const random = lehmer(seed);
  const pieces = [];
  const ring = fine > 0.8 ? 5 : 4;
  const lengthwise = fine > 0.8 ? 8 : 6;
  const grow = (from, a, reach, rise, r0, r1, depth) => {
    const out = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const end = from.clone().addScaledVector(out, reach);
    end.y = -0.02 - random() * 0.02;
    // A low bulge on the way out and down, hugging the mound rather than standing off it.
    const mid = from.clone().lerp(end, 0.45);
    mid.y += rise;
    const curve = new THREE.CatmullRomCurve3([from, mid, end]);
    pieces.push(taperedTube(curve, Math.max(3, Math.round(lengthwise * (depth === 0 ? 1 : 0.6))), r0, r1, depth === 0 ? ring : Math.max(3, ring - 1)));
    if (depth >= 2) return;
    // Forks partway along, thinner, splaying further out.
    const forks = depth === 0 ? 2 : 1;
    for (let f = 0; f < forks; f++) {
      const t = 0.4 + random() * 0.3;
      const at = curve.getPoint(t);
      const r = r0 + (r1 - r0) * t;
      grow(at, a + (random() - 0.5) * 1.3, reach * (0.4 + random() * 0.3), rise * 0.4, r * 0.75, Math.max(0.0012, r * 0.25), depth + 1);
    }
  };
  const count = Math.round((fine > 0.8 ? 16 : 11) + random() * 4);
  for (let r = 0; r < count; r++) {
    const a = random() * Math.PI * 2;
    // Higher up the bundle, the haptera start closer in and reach further, so the whole makes a cone.
    const up = Math.pow(random(), 1.6);
    const from = new THREE.Vector3(Math.cos(a) * (0.05 - up * 0.03), 0.01 + up * 0.15, Math.sin(a) * (0.05 - up * 0.03));
    const reach = 0.1 + random() * 0.12 + up * 0.12;
    grow(from, a + (random() - 0.5) * 0.4, reach, 0.01 + random() * 0.025, 0.006 + random() * 0.005, 0.0018, 0);
  }
  const merged = mergeGeometries(pieces.map((p) => p.toNonIndexed()));
  pieces.forEach((p) => p.dispose());
  return merged;
}
const STIPE_VERT = /* glsl */ `
attribute vec4 aP0, aP1, aP2, aP3;
varying vec3 vW, vN, vCa;
varying float vTint;
void main(){
  // Along a Catmull-Rom curve through the four points round each length, round in section.
  float t = position.x;
  vec3 a = aP1.xyz * 2.0;
  vec3 b = aP2.xyz - aP0.xyz;
  vec3 c = aP0.xyz * 2.0 - aP1.xyz * 5.0 + aP2.xyz * 4.0 - aP3.xyz;
  vec3 d = aP1.xyz * 3.0 - aP0.xyz - aP2.xyz * 3.0 + aP3.xyz;
  vec3 centre = (a + b * t + c * (t * t) + d * (t * t * t)) * 0.5;
  vec3 T = normalize(b + c * (t * 2.0) + d * (t * t * 3.0) + vec3(0.0, 1e-5, 0.0));
  vec3 ref = abs(T.y) > 0.95 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
  vec3 side = normalize(cross(T, ref));
  vec3 bi = cross(side, T);
  vec3 n = side * cos(position.y) + bi * sin(position.y);
  float radius = mix(aP1.w, aP2.w, t);
  vec3 P = centre + n * radius;
  vW = P;
  vN = n;
  vTint = aP0.w;
  vCa = kCausticsAt(P, n);
  gl_Position = projectionMatrix * viewMatrix * vec4(P, 1.0);
}`;
const STIPE_FRAG = /* glsl */ `
uniform vec3 uStipe, uStipeB;
varying vec3 vW, vN, vCa;
varying float vTint;
void main(){
  vec3 tone = mix(uStipe, uStipeB, vTint);
  gl_FragColor = vec4(kFinish(tone, normalize(vN), vW, 0.6, vCa, tone * 0.3), 1.0);
  ${K_OUT}
}`;
// A blade: a long tapering strip from its float, curving out from the stipe then streaming the way the water goes
// past it, fluttering, twisted a little, its edges ruffled and its face pocked in rows, as giant kelp's are.
const BLADE_VERT = /* glsl */ `
attribute vec4 aBase, aAxis, aFlow, aOut;
varying vec2 vUv;
varying vec3 vW, vN, vAcross, vCa;
varying float vTint;
void main(){
  float u = position.x;
  float w = position.y;
  float L = aBase.w;
  vec3 axis = normalize(aAxis.xyz + vec3(0.0, 1e-4, 0.0));
  vec3 outward = normalize(aOut.xyz);
  vec3 start = normalize(axis * 0.55 + outward * 0.85);
  vec3 carried = normalize(axis * 0.45 + outward * 0.3 + aFlow.xyz * 2.2 + vec3(0.0, 0.12, 0.0));
  float phase = aAxis.w;
  vec3 P1 = start * (L * 0.35);
  vec3 P2 = carried * L;
  float one = 1.0 - u;
  vec3 centre = P1 * (one * u * 2.0) + P2 * (u * u);
  vec3 T = normalize(P1 * (one * 2.0) + (P2 - P1) * (u * 2.0));
  vec3 level = normalize(cross(axis, outward) + vec3(1e-4, 0.0, 0.0));
  vec3 N = normalize(cross(T, level));
  // A slow twist down the blade and a flutter that runs from base to tip.
  float twist = sin(u * 2.6 + phase) * 0.7;
  vec3 across = normalize(cross(N, T));
  vec3 turned = across * cos(twist) + N * sin(twist);
  N = N * cos(twist) - across * sin(twist);
  across = turned;
  float flutter = sin(kClock * 1.7 + phase - u * 6.0) * (L * 0.04) * u;
  centre += N * flutter;
  // Lance-shaped, on a short stalk.
  float W = aFlow.w * smoothstep(0.0, 0.09, u) * pow(max(sin((u * 0.92 + 0.06) * 3.14159265), 0.0), 0.7);
  // Ruffled edges, and pocks in rows across the face.
  float freq = L * 38.0;
  float ruffle = W * 0.42 * (w * w) * sin(u * freq + phase * 3.0);
  float pock = W * 0.05 * (sin(u * freq * 2.7) * cos(w * 9.0));
  vec3 placed = aBase.xyz + centre + across * (w * W) + N * (ruffle + pock);
  // Never up through the surface: the canopy lies flat along it.
  vec3 P = vec3(placed.x, min(placed.y, -0.015), placed.z);
  // The slope of the ruffle tips the normal.
  float dW = W * 0.84 * w * sin(u * freq + phase * 3.0) - W * 0.45 * (sin(u * freq * 2.7) * sin(w * 9.0));
  float dU = W * 0.42 * (w * w) * freq * cos(u * freq + phase * 3.0);
  vec3 normal = normalize(N - across * (dW / max(W, 0.004)) - T * (dU / max(L, 0.1)) * 0.3);
  vUv = position.xy;
  vW = P;
  vN = normal;
  vAcross = across;
  vTint = aOut.w;
  vCa = kCausticsAt(P, normal);
  gl_Position = projectionMatrix * viewMatrix * vec4(P, 1.0);
}`;
const BLADE_FRAG = /* glsl */ `
uniform vec3 uBlade, uBladeB;
varying vec2 vUv;
varying vec3 vW, vN, vAcross, vCa;
varying float vTint;
void main(){
  float u = vUv.x;
  float w = vUv.y;
  // Close up, the blade's veins: fine ridges running from the stalk to the tip, drawing together toward each end,
  // with a crinkle across them. They tip the normal and darken a little, so they show in light through the blade.
  float close = 1.0 - smoothstep(0.9, 2.6, length(vW - cameraPosition));
  float veinPhase = w * (30.0 - u * 8.0) + sin(u * 9.0) * 0.5;
  float vein = smoothstep(0.55, 0.95, cos(veinPhase));
  float crinkle = sin(u * 170.0 + w * 6.0) * 0.5;
  vec3 A = normalize(vAcross);
  vec3 N = normalize(normalize(vN) - A * (sin(veinPhase) * 0.28 * close) + A * (crinkle * 0.08 * close));
  // The blade's own colour: darker toward the stalk and down the middle, finely streaked along its length, paler
  // and thinner at the ruffled edges, with a little blotching.
  float streak = sin(w * 37.0 + sin(u * 11.0) * 2.0) * 0.06 + 0.97;
  float blotch = sin(u * 23.0 + w * 3.0) * sin(u * 7.3) * 0.08 + 1.0;
  float middle = 1.0 - pow(max(1.0 - abs(w), 0.0), 6.0) * 0.18;
  float edge = smoothstep(0.7, 1.0, abs(w)) * 0.25 + 1.0;
  float toTip = mix(0.6, 1.12, smoothstep(0.0, 0.5, u));
  vec3 tone = mix(uBlade, uBladeB, vTint) * (streak * blotch * middle * edge * toTip) * (1.0 - vein * close * 0.16);
  gl_FragColor = vec4(kFinish(tone, N, vW, 0.45, vCa, tone * vec3(1.25, 1.05, 0.55) * 0.9), 1.0);
  ${K_OUT}
}`;
// The floats: small glossy bladders where each blade meets the stipe.
const FLOAT_VERT = /* glsl */ `
attribute vec4 aBase, aAxis, aOut;
varying vec3 vW, vN, vCa;
varying float vTint;
void main(){
  vec3 axis = normalize(aAxis.xyz + vec3(0.0, 1e-4, 0.0));
  vec3 along = normalize(axis * 0.55 + normalize(aOut.xyz) * 0.85);
  vec3 level = normalize(cross(axis, aOut.xyz) + vec3(1e-4, 0.0, 0.0));
  vec3 third = cross(along, level);
  float s = aBase.w * 0.05 + 0.012;
  vec3 p = position;
  vec3 P = aBase.xyz + along * (p.y * (s * 1.5) + s) + level * (p.x * s) + third * (p.z * s);
  P.y = min(P.y, -0.01);
  vec3 n = normalize(along * p.y + level * p.x + third * p.z);
  vW = P;
  vN = n;
  vTint = aOut.w;
  vCa = kCausticsAt(P, n);
  gl_Position = projectionMatrix * viewMatrix * vec4(P, 1.0);
}`;
const FLOAT_FRAG = /* glsl */ `
uniform vec3 uBlade, uBladeB;
varying vec3 vW, vN, vCa;
varying float vTint;
void main(){
  vec3 tone = mix(uBlade, uBladeB, vTint) * vec3(1.15, 1.05, 0.7);
  gl_FragColor = vec4(kFinish(tone, normalize(vN), vW, 0.3, vCa, tone * 0.6), 1.0);
  ${K_OUT}
}`;
const ROOT_VERT = /* glsl */ `
attribute vec4 aPlant;
attribute vec4 aSpin;
varying vec3 vW, vN, vL, vCa;
varying float vTint;
void main(){
  float c = cos(aSpin.x), s = sin(aSpin.x);
  vec3 q = vec3(position.x * c - position.z * s, position.y, position.x * s + position.z * c);
  vec3 n = vec3(normal.x * c - normal.z * s, normal.y, normal.x * s + normal.z * c);
  vec3 P = aPlant.xyz + q * aPlant.w;
  vW = P;
  vN = n;
  vL = position;
  vTint = aSpin.y;
  vCa = kCausticsAt(P, n);
  gl_Position = projectionMatrix * viewMatrix * vec4(P, 1.0);
}`;
const ROOT_FRAG = /* glsl */ `
uniform vec3 uStipe, uStipeB;
varying vec3 vW, vN, vL, vCa;
varying float vTint;
void main(){
  // Older haptera darker, younger ones paler, mottled over a few centimetres.
  vec3 tone = mix(uStipe, uStipeB, vTint) * (kNoise3(vL * 28.0) * 0.25 + 0.85) * vec3(1.0, 0.97, 0.9);
  gl_FragColor = vec4(kFinish(tone, normalize(vN), vW, 0.8, vCa, vec3(0.0)), 1.0);
  ${K_OUT}
}`;
const tangent = new THREE.Vector3(); const outward = new THREE.Vector3(); // A plant's points drawn in toward its root: how a plant at the edge of sight stands small.
let scratch = new Float32Array(0); function shrunk(shown, site, grow) { if (scratch.length < shown.length) scratch = new Float32Array(shown.length); for (let i = 0; i < shown.length; i += 3) { scratch[i] = site.x + (shown[i] - site.x) * grow; scratch[i + 1] = site.y + (shown[i + 1] - site.y) * grow; scratch[i + 2] = site.z + (shown[i + 2] - site.z) * grow; } return scratch; } export class KelpPool {
  constructor(maxPlants, fine) {
    this.maxPlants = maxPlants;
    this.group = new THREE.Group();
    this.group.name = "kelp3-giant";
    const maxSegs = maxPlants * 11 * (NODES - 1);
    const maxBlades = maxPlants * 11 * (NODES - 2);
    this.maxSegs = maxSegs;
    this.maxBlades = maxBlades;
    const dynamic = (count) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
      a.setUsage(THREE.DynamicDrawUsage);
      return a;
    };
    // The stipe: a tube of rings along each length between nodes, x the way along and y the way round.
    const rings = fine > 0.8 ? 3 : 2;
    const sides = fine > 0.6 ? 5 : 4;
    const tubePoints = [];
    const tubeIndex = [];
    for (let r = 0; r <= rings; r++) for (let s = 0; s <= sides; s++) tubePoints.push(r / rings, (s / sides) * Math.PI * 2, 0);
    for (let r = 0; r < rings; r++)
      for (let s = 0; s < sides; s++) {
        const a = r * (sides + 1) + s;
        const b = a + sides + 1;
        tubeIndex.push(a, b, a + 1, a + 1, b, b + 1);
      }
    this.tube = new THREE.InstancedBufferGeometry();
    this.tube.setAttribute("position", new THREE.Float32BufferAttribute(tubePoints, 3));
    this.tube.setIndex(tubeIndex);
    this.ends = ["aP0", "aP1", "aP2", "aP3"].map((name) => {
      const a = dynamic(maxSegs);
      this.tube.setAttribute(name, a);
      return a;
    });
    this.tube.instanceCount = 0;
    // Blades: each a strip, x along and y across.
    const along = fine > 0.7 ? 6 : 4;
    const across = 2;
    const leafPoints = [];
    const leafIndex = [];
    for (let a = 0; a <= along; a++) for (let c = 0; c <= across; c++) leafPoints.push(a / along, (c / across) * 2 - 1, 0);
    for (let a = 0; a < along; a++)
      for (let c = 0; c < across; c++) {
        const i = a * (across + 1) + c;
        const j = i + across + 1;
        leafIndex.push(i, j, i + 1, i + 1, j, j + 1);
      }
    this.leaf = new THREE.InstancedBufferGeometry();
    this.leaf.setAttribute("position", new THREE.Float32BufferAttribute(leafPoints, 3));
    this.leaf.setIndex(leafIndex);
    this.base = dynamic(maxBlades);
    this.axis = dynamic(maxBlades);
    this.stream = dynamic(maxBlades);
    this.out = dynamic(maxBlades);
    this.leaf.setAttribute("aBase", this.base);
    this.leaf.setAttribute("aAxis", this.axis);
    this.leaf.setAttribute("aFlow", this.stream);
    this.leaf.setAttribute("aOut", this.out);
    this.leaf.instanceCount = 0;
    // The floats share the blades' placing.
    const sphere = fine > 0.6 ? new THREE.SphereGeometry(1, 5, 4) : new THREE.SphereGeometry(1, 4, 3);
    this.bladder = new THREE.InstancedBufferGeometry();
    this.bladder.setAttribute("position", sphere.getAttribute("position"));
    this.bladder.setIndex(sphere.getIndex());
    this.bladder.setAttribute("aBase", this.base);
    this.bladder.setAttribute("aAxis", this.axis);
    this.bladder.setAttribute("aOut", this.out);
    this.bladder.instanceCount = 0;
    // Holdfasts: two shapes, each plant one of them, placed and turned by its own attributes.
    this.roots = [0, 1].map((v) => {
      const shape = holdfast(7001 + v * 13, fine);
      const g = new THREE.InstancedBufferGeometry();
      g.setAttribute("position", shape.getAttribute("position"));
      g.setAttribute("normal", shape.getAttribute("normal"));
      const plant = dynamic(maxPlants);
      const spin = dynamic(maxPlants);
      g.setAttribute("aPlant", plant);
      g.setAttribute("aSpin", spin);
      g.instanceCount = 0;
      return { geometry: g, plant, spin };
    });
    const tones = {
      uBlade: { value: new THREE.Color("#8a6a22") },
      // Fresh-water weed runs greener than the sea's kelp: rivers and swamps lean toward it.
      uBladeB: { value: new THREE.Color("#6e7226") },
      uStipe: { value: new THREE.Color("#5a4518") },
      uStipeB: { value: new THREE.Color("#4b4a1a") },
    };
    this.materials = {
      stipe: kMaterial({ uniforms: tones, vertex: STIPE_VERT, fragment: STIPE_FRAG }),
      blade: kMaterial({ uniforms: tones, vertex: BLADE_VERT, fragment: BLADE_FRAG, side: THREE.DoubleSide }),
      float: kMaterial({ uniforms: tones, vertex: FLOAT_VERT, fragment: FLOAT_FRAG }),
      root: kMaterial({ uniforms: tones, vertex: ROOT_VERT, fragment: ROOT_FRAG }),
    };
    this.meshes = [
      new THREE.Mesh(this.tube, this.materials.stipe),
      new THREE.Mesh(this.leaf, this.materials.blade),
      new THREE.Mesh(this.bladder, this.materials.float),
      ...this.roots.map((r) => new THREE.Mesh(r.geometry, this.materials.root)),
    ];
    for (const m of this.meshes) {
      m.frustumCulled = false;
      this.group.add(m);
    }
    this.counts = { segments: 0, blades: 0 };
  }
  // The holdfasts stand still: placed whenever the set of plants changes.
  place(plants) {
    const n = [0, 0];
    for (const plant of plants) {
      const r = this.roots[plant.variant];
      const i = n[plant.variant]++ * 4;
      const s = plant.site;
      r.plant.array[i] = s.x;
      r.plant.array[i + 1] = s.y;
      r.plant.array[i + 2] = s.z;
      r.plant.array[i + 3] = s.size * 1.25;
      r.spin.array[i] = plant.turn;
      r.spin.array[i + 1] = s.tint;
    }
    this.roots.forEach((r, v) => {
      r.geometry.instanceCount = n[v];
      r.plant.needsUpdate = true;
      r.spin.needsUpdate = true;
    });
  }
  // Every instanced piece's per-frame data, filled from the plants' chains once a frame. Plain loops with nothing
  // made along the way: this runs for every length of stipe and every blade, every frame.
  fill(plants) {
    const e0 = this.ends[0].array;
    const e1 = this.ends[1].array;
    const e2 = this.ends[2].array;
    const e3 = this.ends[3].array;
    const b = this.base.array;
    const a = this.axis.array;
    const f = this.stream.array;
    const out = this.out.array;
    const last = NODES - 1;
    let o = 0;
    let j = 0;
    for (let n = 0; n < plants.length; n++) {
