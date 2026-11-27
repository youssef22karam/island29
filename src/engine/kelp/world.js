// World sampling helpers shared by the underwater system (bed height, water body kind, dive spots).
export function makeRng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash2(ix, iz) {
  let h = (Math.imul(ix | 0, 374761393) + Math.imul(iz | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function fbm3(x, y, z) {
  const s = (a, b, c) =>
    Math.sin(a * 1.7 + Math.cos(b * 2.1 - c * 1.3)) *
    Math.cos(b * 1.9 + Math.sin(c * 1.6 + a * 1.1));
  return (
    s(x, y, z) * 0.52 +
    s(x * 2.13 + 3.1, y * 2.07 - 1.7, z * 2.19 + 0.9) * 0.28 +
    s(x * 4.31 - 2.3, y * 4.17 + 4.1, z * 4.09 - 3.2) * 0.14 +
    s(x * 8.1 + 1.2, y * 7.9 - 2.6, z * 8.3 + 5.4) * 0.06
  );
}

// Bilinear sampler for world Float32Array fields
export function sampleField(world, arr, lx, lz) {
  const N = world.N;
  const fx = (lx + world.half) / world.cell - 0.5;
  const fz = (lz + world.half) / world.cell - 0.5;
  const x0 = Math.max(0, Math.min(N - 2, Math.floor(fx)));
  const z0 = Math.max(0, Math.min(N - 2, Math.floor(fz)));
  const u = Math.max(0, Math.min(1, fx - x0));
  const v = Math.max(0, Math.min(1, fz - z0));
  const k = z0 * N + x0;
  const a = arr[k] + (arr[k + 1] - arr[k]) * u;
  const b = arr[k + N] + (arr[k + N + 1] - arr[k + N]) * u;
  return a + (b - a) * v;
}

export function sampleWaterProps(world, lx, lz) {
  const N = world.N;
  const fx = (lx + world.half) / world.cell - 0.5;
  const fz = (lz + world.half) / world.cell - 0.5;
  if (fx < 1 || fz < 1 || fx >= N - 2 || fz >= N - 2) return null;
  const h = sampleField(world, world.h, lx, lz);
  const depth = -h;
  if (depth < 0.34) return null;
  const inl = sampleField(world, world.inl, lx, lz);
  const ix = Math.max(0, Math.min(N - 1, Math.round(fx)));
  const iz = Math.max(0, Math.min(N - 1, Math.round(fz)));
  const idx = iz * N + ix;
  const wet = world.wet[idx] === 1;
  if (!wet && inl < 0.58) return null;
  if (inl < 0.48) return null;
  const flowX = sampleField(world, world.flowX, lx, lz);
  const flowZ = sampleField(world, world.flowZ, lx, lz);
  const flowSpd = Math.hypot(flowX, flowZ);
  const isLake = world.lakeId && world.lakeId[idx] >= 0 ? 1 : 0;
  const rawSwamp = world.swamp ? sampleField(world, world.swamp, lx, lz) : 0;
  const fastMain = Math.max(0, Math.min(1, (flowSpd - 0.48) / 0.36));
  const swamp = Math.max(0, Math.min(1, ((rawSwamp - 0.26) / 0.34) * (1 - isLake * 0.92) * (1 - fastMain * 0.7)));
  const river = Math.max(0, Math.min(1, (flowSpd - 0.08) / 0.30)) * (1 - isLake * 0.84) * (1 - swamp * 0.78);
  const lake = Math.max(0, 1 - Math.max(river, swamp));
  const nav = world.navMask && world.navMask[idx] === 1 ? 1 : 0;
  return { h, depth, flowX, flowZ, flowSpd, river, swamp, lake, isLake, nav };
}

// The richest natural dive spot inside a lake, river or swamp.
export function findUnderwaterSpot(world, type, name, center = { x: 0, z: 0 }) {
  if (!world) return null;
  const pickBest = (candidates) => {
    let best = null;
    for (const c of candidates) {
      const p = sampleWaterProps(world, c.x, c.z);
      if (!p) continue;
      if (type === "swamp" && p.depth < 1.8) continue;
      if (type !== "swamp" && p.depth < 3.0) continue;
      // Enforce clean wide open water corridor in sightline (keeps swamps genuinely deep amber bayou too!)
      if (type === "swamp" && (p.swamp < 0.38 || p.depth < 2.2)) continue;
      const lx = Math.cos(c.yaw), lz = Math.sin(c.yaw);
      let ok = 0, minD = p.depth, swTotal = p.swamp;
      for (const d of [4, 9, 15, 22, 32]) {
        const q = sampleWaterProps(world, c.x + lx * d, c.z + lz * d);
        if (q && q.depth > (type === "swamp" ? 2.0 : 3.2)) {
          ok++;
          swTotal += q.swamp;
          if (q.depth < minD) minD = q.depth;
        }
      }
      if (ok < (type === "swamp" ? 4 : 4)) continue;
      const targetDepth = type === "lake" ? 8.2 : type === "river" ? 6.6 : 3.2;
      const swBonus = type === "swamp" ? swTotal * 12 : 0;
      const score = ok * 12 + minD * 1.5 - Math.abs(p.depth - targetDepth) * 1.2 + swBonus + (c.bonus || 0);
      if (!best || score > best.score) {
        // Classic kelp3 low hovering perspective: sees sandy/rocky caustics floor, sugar kelp, boulders, towering spires & Snell's window overhead!
        const eyeY = -Math.max(1.4, Math.min(p.depth - 1.45, p.depth * 0.64));
        best = {
          x: c.x + center.x,
          y: eyeY,
          z: c.z + center.z,
          yaw: c.yaw,
          pitch: type === "swamp" ? 0.10 : 0.14,
          bedDepth: p.depth,
          name: c.name,
          score,
        };
      }
    }
    return best;
  };

  const cands = [];
  if (type === "lake" && world.lakes?.length) {
    const lk = world.lakes.find((l) => l.name === name) ||
      [...world.lakes].sort((a, b) => b.area - a.area)[0];
    if (lk) {
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        for (const f of [0.25, 0.48, 0.66]) {
          const x = lk.x + Math.cos(a) * lk.r * f;
          const z = lk.z + Math.sin(a) * lk.r * f;
          cands.push({ x, z, yaw: a + Math.PI, name: lk.name, bonus: f < 0.55 ? 4 : 0 });
        }
      }
    }
  } else if (type === "river" && world.rivers?.length) {
    const rv = world.rivers.find((r) => r.name === name) ||
      world.rivers.find((r) => r.kind === "main") ||
      world.rivers[0];
    if (rv) {
      const n = rv.pts.length / 2;
      for (let i = Math.max(2, Math.floor(n * 0.25)); i < n * 0.85; i += 2) {
        const x = rv.pts[i * 2], z = rv.pts[i * 2 + 1];
        const j = Math.min(n - 1, i + 2);
        const yaw = Math.atan2(rv.pts[j * 2 + 1] - z, rv.pts[j * 2] - x);
        const sw = world.swamp ? sampleField(world, world.swamp, x, z) : 0;
        cands.push({ x, z, yaw, name: rv.name, bonus: (1 - sw) * 10 + (rv.hw[i] || 10) * 0.18 });
      }
    }
  } else if (type === "swamp") {
    const ms = world.marshes?.length
      ? (world.marshes.find((m) => m.name === name) || [...world.marshes].sort((a, b) => b.area - a.area)[0])
      : null;
    if (ms) {
      for (let dz = -ms.r * 0.9; dz <= ms.r * 0.9; dz += 14) {
        for (let dx = -ms.r * 0.9; dx <= ms.r * 0.9; dx += 14) {
          const x = ms.x + dx, z = ms.z + dz;
          const sw = world.swamp ? sampleField(world, world.swamp, x, z) : 0;
          if (sw < 0.35) continue;
          for (let k = 0; k < 4; k++) {
            cands.push({ x, z, yaw: k * Math.PI * 0.5 + 0.3, name: ms.name, bonus: sw * 14 });
          }
        }
      }
    }
  }
  const hit = pickBest(cands);
  if (hit) return hit;

  // Fallback: scan any deep freshwater spot
  if (world.lakes?.length) {
    const lk = world.lakes[0];
    return { x: lk.x + center.x, y: -3.2, z: lk.z + center.z, yaw: 0.4, pitch: 0.1, bedDepth: 8, name: lk.name };
  }
  return null;
}

