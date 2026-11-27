// Developer tool: runs the island generator headlessly and paints what it made, so that changes to the
// terrain and its water can be looked at without a browser.
// node tools/terrain-map.mjs out.png [--seed 504] [--ix 0 --iz 0] [--copy worker|main] [--crop cx,cz,size] [--scale 2]
// [--mode map|fresh|swamp] [--rivers] [--mesh]
// --copy main|worker runs the main thread's or the worker's copy of the generator: their checksums must agree.
// --mesh builds the fresh-water surface and reports how much of its shallows the estuary mask fades.
// Colours: lakes blue, rivers jade, estuary cells violet, swamp water tan to black with depth.
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import zlib from "node:zlib";
const args = process.argv.slice(2);
const out = args.find((a) => !a.startsWith("--")) || ".debug/map.png";
const opt = (name, fallback) => {
  const i = args.indexOf("--" + name);
  return i >= 0 ? args[i + 1] : fallback;
};
const worldSeed = Number(opt("seed", 504));
const copy = opt("copy", "worker");
const mode = opt("mode", "map");
const scale = Number(opt("scale", 1));
const crop = opt("crop", "");
const ix = Number(opt("ix", 0));
const iz = Number(opt("iz", 0));
// The engine's own island spec (island/part13.js), restated so this tool needs none of the renderer.
function ra(o, e, t, r) {
  let s = (Math.imul(o | 0, 374761393) + Math.imul(e | 0, 668265263) + Math.imul(t | 0, 2246822519) + Math.imul(r | 0, 1597334677)) | 0;
  s = Math.imul(s ^ (s >>> 13), 1274126177);
  s ^= s >>> 16;
  return (s >>> 0) / 4294967296;
}
function specFor(o, e, t) {
  const home = o === 0 && e === 0;
  const sizes = [3200, 4000, 4800, 5400];
  const span = home ? 7200 : sizes[Math.floor(ra(o, e, 2, t) * sizes.length)];
  return { seed: Math.floor(ra(o, e, 9, t) * 1e9) ^ t, N: Math.round(span / 10), cell: 10, isHome: home };
}
const spec = specFor(ix, iz, worldSeed);
const mod = copy === "main" ? await import("../src/engine/island/part05.js") : await import("../src/engine/terrain/part05.js");
const generate = copy === "main" ? mod.Ma : mod.kn;
const t0 = Date.now();
const gen = generate(spec);
let step = gen.next();
while (!step.done) step = gen.next();
const w = step.value;
const { N, cell, half, h, wet, inl, body, swamp, lakeId, cdist, flowX, flowZ } = w;
const NN = N * N;
// ---- What was made, in numbers ----
const names = ["land", "sea", "lake", "river", "creek", "swamp", "estuary"];
const counts = new Array(7).fill(0);
let freshOverSea = 0;
let sum = 0;
for (let k = 0; k < NN; k++) {
  counts[h[k] > 0 ? 0 : body[k]]++;
  if (h[k] < 0 && !wet[k] && inl[k] > 0.285) freshOverSea++;
  sum = (sum + Math.round(h[k] * 64) * ((k % 8191) + 1)) | 0;
}
console.log(`seed ${worldSeed} island ${ix},${iz} copy=${copy} N=${N} in ${((Date.now() - t0) / 1000).toFixed(1)}s  checksum=${sum >>> 0}`);
console.log("cells:", names.map((n, i) => `${n}=${counts[i]}`).join(" "), `freshOverSea=${freshOverSea}`);
const at = (x, z) => {
  const i = Math.round((x + half) / cell - 0.5);
  const j = Math.round((z + half) / cell - 0.5);
  return i < 0 || j < 0 || i >= N || j >= N ? -1 : j * N + i;
};
for (const lake of w.lakes || []) {
  const k = at(lake.x, lake.z);
  console.log(`lake ${lake.name}: r=${lake.r.toFixed(0)} coast=${k >= 0 ? cdist[k].toFixed(0) : "?"}m area=${(lake.area / 1e4).toFixed(1)}ha maxDepth=${lake.maxDepth.toFixed(1)} outlet=${lake.outlet}`);
}
for (const m of w.marshes || []) console.log(`marsh ${m.name}: r=${m.r.toFixed(0)} area=${(m.area / 1e4).toFixed(1)}ha`);
const kinds = {};
for (const r of w.rivers || []) {
  const key = `${r.kind}${r.outlet === "Sea" ? ">sea" : ""}`;
  const e = (kinds[key] ||= { n: 0, len: 0, hwMin: 1e9, hwMax: 0 });
  e.n++;
  e.len += r.length;
  for (const v of r.hw) {
    e.hwMin = Math.min(e.hwMin, v);
    e.hwMax = Math.max(e.hwMax, v);
  }
}
for (const [k, e] of Object.entries(kinds)) console.log(`rivers ${k}: n=${e.n} total=${(e.len / 1000).toFixed(1)}km halfWidth ${e.hwMin.toFixed(1)}..${e.hwMax.toFixed(1)}m`);
if (w.netStats?.design) console.log("design:", JSON.stringify(w.netStats.design)); if (w.marshes?.report) console.log("wetlands:", JSON.stringify(w.marshes.report)); for (const r of w.rivers || []) if (process.argv.includes("--rivers")) console.log(" river", r.kind, r.outlet === "Sea" ? "->sea" : "->" + r.outlet, Math.round(r.length) + "m", "q", Math.round(r.q[r.q.length - 1]), "hw", r.hw[0].toFixed(0) + ".." + r.hw[r.hw.length - 1].toFixed(0));
let bad = 0; for (let k = 0; k < NN; k++) if (!Number.isFinite(h[k]) || !Number.isFinite(inl[k]) || !Number.isFinite(swamp[k]) || !Number.isFinite(w.fresh[k])) bad++; let strayLow = 0, wetDry = 0; for (let k = 0; k < NN; k++) { if (body[k] !== 1 && !wet[k] && h[k] <= 0) strayLow++; if (wet[k] && h[k] >= 0) wetDry++; } console.log(`checks: nonFinite=${bad} dryCellsBelowDatum=${strayLow} wetCellsAboveDatum=${wetDry}`); // ---- Painting ----
let x0 = 0, z0 = 0, size = N;
if (crop) {
  const [cx, cz, s] = crop.split(",").map(Number);
  size = Math.min(N, s);
  x0 = Math.max(0, Math.min(N - size, Math.round(cx - size / 2)));
  z0 = Math.max(0, Math.min(N - size, Math.round(cz - size / 2)));
}
const W = size * scale;
const img = Buffer.alloc(W * W * 4);
const mix = (a, b, t) => a + (b - a) * t;
const lerp3 = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
const sat = (v) => Math.min(1, Math.max(0, v));
const sm = (a, b, v) => {
  const t = sat((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const bil = (arr, fx, fz) => {
  const i = Math.min(N - 2, Math.max(0, Math.floor(fx)));
  const j = Math.min(N - 2, Math.max(0, Math.floor(fz)));
  const u = sat(fx - i), v = sat(fz - j), k = j * N + i;
  return mix(mix(arr[k], arr[k + 1], u), mix(arr[k + N], arr[k + N + 1], u), v);
};
if (args.includes("--mesh")) { const { buildFreshwaterGeometry } = await import("../src/engine/hydrology.js"); const g = buildFreshwaterGeometry(w); const mask = g.getAttribute("aMask").array, water = g.getAttribute("aWater").array; let faded = 0, shallowFaded = 0, shallow = 0; for (let i = 0; i < mask.length; i++) { if (mask[i] < 0.95) faded++; if (water[i * 4 + 2] < 0.6) { shallow++; if (mask[i] < 0.95) shallowFaded++; } } // What the surface's mask was before it was made safe at the banks: inl sampled bilinearly, 0 on dry ground.
const pos = g.getAttribute("position").array; let oldFaded = 0; for (let i = 0; i < mask.length; i++) { if (water[i * 4 + 2] >= 0.6) continue; const m = bil(inl, (pos[i * 3] + half) / cell - 0.5, (pos[i * 3 + 2] + half) / cell - 0.5); const t = sat((m - 0.28) / 0.62); if (t * t * (3 - 2 * t) < 0.95) oldFaded++; } console.log(`mesh: with the old mask ${(100 * oldFaded / Math.max(1, shallow)).toFixed(1)}% of shallow vertices were faded`);  console.log(`mesh: triangles=${mask.length / 3} verticesFadedByMask=${(100 * faded / mask.length).toFixed(2)}% shallowVertices=${shallow} ofWhichFaded=${(100 * shallowFaded / Math.max(1, shallow)).toFixed(2)}%`); } for (let py = 0; py < W; py++)
  for (let px = 0; px < W; px++) {
    const fx = x0 + (px + 0.5) / scale - 0.5;
    const fz = z0 + (py + 0.5) / scale - 0.5;
    const i = Math.min(N - 1, Math.max(0, Math.round(fx)));
    const j = Math.min(N - 1, Math.max(0, Math.round(fz)));
    const k = j * N + i;
    const hh = bil(h, fx, fz);
    const e = 0.75;
    const gx = (bil(h, fx + e, fz) - bil(h, fx - e, fz)) / (2 * e * cell);
    const gz = (bil(h, fx, fz + e) - bil(h, fx, fz - e)) / (2 * e * cell);
    const shade = sat(0.78 - (gx * -0.62 + gz * -0.62) * 1.5);
    let c;
    if (mode === "fresh") {
      c = hh > 0 ? [40, 40, 40] : lerp3([10, 20, 90], [255, 60, 200], sat(bil(inl, fx, fz)));
      if (wet[k] && hh <= 0) c = [255, 255, 80];
    } else if (mode === "swamp") {
      const s = bil(swamp, fx, fz);
      c = hh > 0 ? lerp3([60, 60, 60], [120, 200, 60], s) : wet[k] ? lerp3([40, 90, 200], [200, 160, 20], s) : [10, 20, 60];
    } else if (hh > 0) {
      const sw = bil(swamp, fx, fz);
      let land = hh < 2.2 && cdist[k] < 90 ? [226, 208, 160] : lerp3([96, 150, 66], [58, 108, 48], sm(4, 60, hh));
      land = lerp3(land, [128, 112, 88], sm(120, 300, hh));
      land = lerp3(land, [236, 236, 232], sm(520, 760, hh));
      land = lerp3(land, [70, 92, 40], sw * 0.75 * (1 - sm(3, 9, hh)));
      c = land.map((v) => v * (0.45 + 0.75 * shade));
    } else {
      const d = -hh;
      const sea = lerp3([120, 220, 214], [18, 62, 128], sm(0.3, 16, d));
      const f = sm(0.28, 0.9, bil(inl, fx, fz));
      const b = body[k];
      // lake: deep blue; river: jade; creek: light jade; swamp: near black olive; estuary: violet (so it stands out)
      const fresh = b === 2 ? lerp3([40, 130, 150], [6, 40, 84], sm(1, 14, d)) : b === 5 ? lerp3([150, 132, 62], [8, 12, 6], sm(0.15, 2.4, d)) : b === 6 ? [150, 70, 190] : b === 4 ? [70, 150, 120] : lerp3([40, 120, 96], [10, 60, 62], sm(1, 9, d));
      // fresh-water surface drawn over sea cells shows as the river colour bleeding seaward
      c = wet[k] ? fresh : lerp3(sea, [10, 60, 62], f * 0.85);
    }
    const o = (py * W + px) * 4;
    img[o] = Math.round(sat(c[0] / 255) * 255);
    img[o + 1] = Math.round(sat(c[1] / 255) * 255);
    img[o + 2] = Math.round(sat(c[2] / 255) * 255);
    img[o + 3] = 255;
  }
// ---- PNG ----
const table = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let crc = ~0;
  for (let n = 0; n < buf.length; n++) crc = table[(crc ^ buf[n]) & 0xff] ^ (crc >>> 8);
  return ~crc >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
const raw = Buffer.alloc((W * 4 + 1) * W);
for (let y = 0; y < W; y++) img.copy(raw, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4);
const head = Buffer.alloc(13);
head.writeUInt32BE(W, 0);
head.writeUInt32BE(W, 4);
head[8] = 8;
head[9] = 6;
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", head), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
console.log(`wrote ${out} (${W}x${W})`);
