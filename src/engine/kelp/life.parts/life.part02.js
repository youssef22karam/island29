          pool.buffers[key].array.set(list.length > more * size ? list.slice(0, more * size) : list, count * size);
        }
        count += more;
      }
      pool.count = count;
      pool.geometry.instanceCount = count;
      for (const key of Object.keys(pool.attrs)) pool.buffers[key].needsUpdate = true;
    }
  }
  get instances() {
    let n = 0;
    for (const pool of Object.values(this.pools)) n += pool.count;
    return n;
  }
  dispose() {
    this.group.removeFromParent();
    for (const pool of Object.values(this.pools)) pool.geometry.dispose();
    for (const shape of this.shapes) shape.dispose();
    for (const material of this.materials) material.dispose();
  }
}
// Plants one tile of bed. world: the island's fields; (cx, cz): the island's middle; dens: the tier's thinning.
// Returns null where there is no fresh water at all.
export function plantTile(world, cx, cz, tx, tz, dens) {
  const ox = tx * TILE;
  const oz = tz * TILE;
  const at = (x, z) => sampleWaterProps(world, x - cx, z - cz);
  let wet = 0;
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) if (at(ox + (i + 0.5) * (TILE / 4), oz + (j + 0.5) * (TILE / 4))) wet++;
  if (!wet) return null;
  const rng = makeRng((world.seed ^ Math.imul(tx, 73856093) ^ Math.imul(tz, 19349663) ^ 0x4b454c50) >>> 0);
  const tile = { bins: {}, plants: [], stones: [] };
  for (let k = 0; k < 10; k++) tile.bins["rock" + k] = bins(STONE_ATTRS);
  tile.bins.pebble = bins(STONE_ATTRS);
  for (const spec of GROWERS) tile.bins[spec.name] = bins(GROW_ATTRS);
  tile.bins.fish = bins(FISH_ATTRS);
  tile.bins.bubble = bins(BUBBLE_ATTRS);
  const stones = tile.stones;
  const drift = (p) => {
    // The current a thing rooted here leans with: a river's own, slackened near the bed.
    const speed = Math.min(0.42, p.flowSpd * 0.5) * (0.35 + 0.65 * p.river);
    const s = p.flowSpd > 1e-3 ? speed / p.flowSpd : 0;
    return [p.flowX * s, p.flowZ * s];
  };
  const rock = (x, z, p, size, kind) => {
    // Never taller than the water over it.
    size = Math.min(size, p.depth * 0.6 + 0.12);
    if (size < 0.1) return;
    stones.push({ x, z, y: p.h, size, depth: p.depth, swamp: p.swamp });
    const b = tile.bins["rock" + kind];
    b.aAt.push(x, p.h - size * 0.18, z, rng() * Math.PI * 2);
    b.aSize.push(size * 1.3, size, size * 1.2, p.swamp);
    // The mossy scan for the seven round stones, low-tide rock for the two blocks, granite for the boulder.
    b.aRock.push(kind < 7 ? 5 : kind < 9 ? 2 : 6, (kind >= 7 ? 1.6 : 2.4) / size, rng(), 0);
  };
  // Rocks heaped in outcrops, and loose ones scattered between.
  const outcrops = Math.round((2.5 + rng() * 4) * dens);
  for (let o = 0; o < outcrops; o++) {
    const x0 = ox + rng() * TILE;
    const z0 = oz + rng() * TILE;
    const spread = 0.9 + rng() * 1.9;
    const n = Math.round((4 + rng() * 4) * (0.5 + dens * 0.5));
    const p0 = at(x0, z0);
    if (!p0 || p0.depth < 0.5 || rng() < p0.swamp * 0.75) continue;
    for (let i = 0; i < n; i++) {
      const a = rng() * Math.PI * 2;
      const r = Math.sqrt(rng()) * spread;
      const x = x0 + Math.cos(a) * r;
      const z = z0 + Math.sin(a) * r;
      const p = at(x, z);
      if (!p || p.depth < 0.4) continue;
      const size = (0.35 + Math.pow(rng(), 1.5) * 1.7) * (1 - (r / spread) * 0.5);
      rock(x, z, p, size, size > 1 ? Math.floor(rng() * 10) : Math.floor(rng() * 9));
    }
  }
  for (let i = 0; i < 26 * dens; i++) {
    const x = ox + rng() * TILE;
    const z = oz + rng() * TILE;
    const p = at(x, z);
    if (!p || rng() < p.swamp * 0.7) continue;
    rock(x, z, p, 0.12 + rng() * rng() * 0.35, Math.floor(rng() * 7));
  }
  // Pebbles and cobbles, thick on a river's bed, and grit the colour of the sand.
  for (let i = 0; i < 84 * dens; i++) {
    const x = ox + rng() * TILE;
    const z = oz + rng() * TILE;
    const p = at(x, z);
    if (!p) continue;
    const grit = rng() < 0.4;
    if (!grit && rng() > 0.45 + 0.55 * p.river - 0.3 * p.swamp) continue;
    const s = grit ? 0.009 + Math.pow(rng(), 2.5) * 0.041 : 0.025 + Math.pow(rng(), 2.5) * (0.13 + 0.1 * p.river);
    const b = tile.bins.pebble;
    b.aAt.push(x, p.h - s * 0.25, z, rng() * Math.PI * 2);
    b.aSize.push(s * (0.8 + rng() * 0.6), s, s * (0.8 + rng() * 0.6), p.swamp);
    b.aRock.push(grit ? 1 : 0, 0, rng(), 0);
  }
  // What grows: round the outcrops and over the sand, on top of a rock where it lies on one.
  const big = stones.filter((s) => s.size > 0.5);
  const meadow = { x: ox + rng() * TILE, z: oz + rng() * TILE, wide: 0.8 + rng() * 1.6, on: rng() < 0.7 };
  for (const spec of GROWERS) {
    const b = tile.bins[spec.name];
    const count = Math.round(spec.n * dens * (0.7 + rng() * 0.6));
    for (let i = 0; i < count; i++) {
      let x, z;
      if (spec.meadow) {
        // Meadows: tufts gathered thick round a middle on the sand, thinning toward their edges.
        if (!meadow.on) break;
        const a = rng() * Math.PI * 2;
        const r = (rng() + rng()) * 0.5 * meadow.wide * 2.2;
        x = meadow.x + Math.cos(a) * r;
        z = meadow.z + Math.sin(a) * r;
      } else if (rng() < (spec.onRock ?? 0) && big.length) {
        const s = big[Math.floor(rng() * big.length)];
        const a = rng() * Math.PI * 2;
        const r = s.size * (0.55 + rng() * 0.7);
        x = s.x + Math.cos(a) * r;
        z = s.z + Math.sin(a) * r;
      } else {
        x = ox + rng() * TILE;
        z = oz + rng() * TILE;
      }
      const p = at(x, z);
      if (!p) continue;
      // The sea's animals keep to lakes; a swamp is all weed.
      if (spec.sea && rng() > p.lake * (1 - p.swamp)) continue;
      if (spec.only && rng() > spec.only(p)) continue;
      if (!spec.sea && spec.bend > 0 && rng() < p.swamp * -0.4 + p.river * 0.25 * (spec.name === "meadow" ? 1 : 0)) continue;
      let y = p.h;
      let top = p.depth;
      for (const s of stones) {
        const d = Math.hypot(s.x - x, s.z - z) / (s.size * 0.6);
        if (d < 1) {
          const lifted = s.y + s.size * 0.75 * Math.sqrt(1 - d * d) - s.size * 0.15;
          if (lifted > y) {
            y = lifted;
            top = -y;
          }
        }
      }
      let size = spec.sizes[0] + rng() * rng() * (spec.sizes[1] - spec.sizes[0]);
      // Nothing stands taller than the water it is in; weed grows rank in a swamp.
      size = Math.min(size * (1 + 0.35 * p.swamp * (spec.bend > 0 ? 1 : 0)), top * (spec.lying ? 2.6 : 0.82));
      // A lily's stalk is as long as the water is deep.
      if (spec.toSurface) size = top - 0.02;
      if (size < spec.sizes[0] * 0.5) continue;
      const [dx, dz] = drift(p);
      b.aAt.push(x, y - 0.01, z, size);
      b.aTurn.push(rng() * Math.PI * 2, rng(), rng() * 100, p.swamp);
      b.aDrift.push(dx, dz);
    }
  }
  // Bubbles rising from the bigger rocks.
  for (const s of big) {
    if (rng() > 0.3 || s.depth < 1.2) continue;
    const seed = rng();
    const many = 5 + Math.floor(rng() * 6);
    const b = tile.bins.bubble;
    for (let i = 0; i < many; i++) {
      b.aSrc.push(s.x + (rng() - 0.5) * s.size * 0.5, s.y + s.size * 0.5, s.z + (rng() - 0.5) * s.size * 0.5, -(s.y + s.size * 0.5) - 0.05);
      b.aSeed.push(rng(), rng(), rng(), seed);
    }
  }
  // Fish: silver shiners in schools, a few bass, golden sunfish, trout where the water runs.
  const school = (kind, many, sizes, speed) => {
    const x = ox + rng() * TILE;
    const z = oz + rng() * TILE;
    const p = at(x, z);
    if (!p || p.depth < 1.5) return;
    // The widest round it can wander without leaving deep water.
    let R = 2.2 + rng() * 4.2;
    for (let tries = 0; tries < 4; tries++) {
      let ok = true;
      for (let k = 0; k < 6 && ok; k++) {
        const q = at(x + Math.cos(k * 1.047) * R * 1.4, z + Math.sin(k * 1.047) * R * 1.4);
        if (!q || q.depth < Math.min(1.3, p.depth * 0.7)) ok = false;
      }
      if (ok) break;
      R *= 0.6;
    }
    if (R < 0.9) return;
    const amp = Math.min(0.7, p.depth * 0.14);
    const cy = Math.min(-0.5 - amp, Math.max(p.h + 0.55 + amp, p.h + p.depth * (0.3 + rng() * 0.45)));
    const phase = rng() * 100;
    const pace = (speed[0] + rng() * (speed[1] - speed[0])) / R;
    const way = rng() < 0.5 ? -1 : 1;
    const b = tile.bins.fish;
    for (let i = 0; i < many; i++) {
      b.aSchool.push(x, cy, z, R);
      b.aFish.push(rng(), rng(), rng(), phase + rng() * 0.55);
      b.aLook.push(sizes[0] + rng() * (sizes[1] - sizes[0]), kind, pace * way, amp);
    }
  };
  const depthHere = at(ox + TILE / 2, oz + TILE / 2);
  const swampy = depthHere ? depthHere.swamp : 0;
  const running = depthHere ? depthHere.river : 0;
  if (rng() < 0.5 * dens) school(0, Math.round((26 + rng() * 34) * (0.5 + 0.5 * dens)), [0.1, 0.16], [0.55, 0.95]);
  if (rng() < 0.3 + 0.2 * swampy) school(1, 3 + Math.floor(rng() * 5), [0.28, 0.44], [0.22, 0.4]);
  if (rng() < 0.2 * (1 - running)) school(2, 3 + Math.floor(rng() * 4), [0.18, 0.27], [0.2, 0.35]);
  if (rng() < 0.16 + 0.3 * running) school(3, 6 + Math.floor(rng() * 9), [0.26, 0.4], [0.5, 0.8]);
  // Where giant kelp may root: a jittered lattice, so plants keep their distance, thinner where the water runs
  // fast or lies shallow, sparse and stunted in a swamp.
  const STEPS = 3;
  const cell = TILE / STEPS;
  for (let j = 0; j < STEPS; j++)
    for (let i = 0; i < STEPS; i++) {
      const x = ox + (i + 0.15 + rng() * 0.7) * cell;
      const z = oz + (j + 0.15 + rng() * 0.7) * cell;
      const roll = rng();
      const seed = Math.floor(rng() * 2147483000) + 1;
      const sizeRoll = rng();
      const p = at(x, z);
      if (!p || p.depth < 1.5) continue;
      const chance = (0.62 - 0.22 * p.river - 0.3 * p.swamp) * Math.min(1, (p.depth - 1.2) / 1.6) * (p.nav && p.river > 0.5 ? 0.55 : 1);
      if (roll > chance) continue;
      // Clear of the rocks.
      if (stones.some((s) => s.size > 0.4 && Math.hypot(s.x - x, s.z - z) < s.size * 0.7 + 0.2)) continue;
      const e = 0.6;
      const px = at(x + e, z);
      const pz = at(x, z + e);
      const [dx, dz] = drift(p);
      tile.plants.push({
        x,
        y: p.h,
        z,
        size: (0.9 + sizeRoll * 0.3) * (1 - 0.25 * p.swamp),
        tint: Math.min(1, p.river * 0.55 + p.swamp * 0.95),
        flowX: dx,
        flowZ: dz,
        seed,
        gx: px ? Math.max(-0.6, Math.min(0.6, (px.h - p.h) / e)) : 0,
        gz: pz ? Math.max(-0.6, Math.min(0.6, (pz.h - p.h) / e)) : 0,
      });
    }
  return tile;
}
