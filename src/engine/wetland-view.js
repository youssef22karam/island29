// Start over an open pool, not inside a reed bed or a mangrove's root flare.
export function wetlandView(world, name) {
  if (!world?.marshes?.length) return null;
  const marsh = world.marshes.find((m) => m.name === name)
    || [...world.marshes].sort((a, b) => b.area - a.area)[0];
  const { N, cell, half, h, wet, swamp } = world;
  const at = (field, x, z) => {
    const fx = (x + half) / cell - .5, fz = (z + half) / cell - .5;
    const ix = Math.max(0, Math.min(N - 2, Math.floor(fx)));
    const iz = Math.max(0, Math.min(N - 2, Math.floor(fz)));
    const u = Math.max(0, Math.min(1, fx - ix)), v = Math.max(0, Math.min(1, fz - iz));
    const k = iz * N + ix;
    return (field[k] * (1 - u) + field[k + 1] * u) * (1 - v)
      + (field[k + N] * (1 - u) + field[k + N + 1] * u) * v;
  };
  let best = null;
  for (let iz = 2; iz < N - 2; iz += 2) {
    for (let ix = 2; ix < N - 2; ix += 2) {
      const k = iz * N + ix;
      if (!wet[k] || swamp[k] < .56 || h[k] > -1.2 || h[k] < -4.8) continue;
      const x = (ix + .5) * cell - half, z = (iz + .5) * cell - half;
      const away = Math.hypot(x - marsh.x, z - marsh.z);
      if (away > marsh.r * 1.45) continue;
      let openness = 0;
      for (let a = 0; a < 8; a++) {
        const angle = a * Math.PI / 4;
        for (const radius of [12, 24]) {
          if (at(h, x + Math.cos(angle) * radius, z + Math.sin(angle) * radius) < -.35) openness++;
        }
      }
      if (openness < 12) continue;
      for (let a = 0; a < 16; a++) {
        const angle = a * Math.PI / 8, dx = Math.cos(angle), dz = Math.sin(angle);
        let score = openness * 1.3 - Math.abs(-h[k] - 1.9) * 2 - away * .007;
        let clear = true;
        for (const distance of [10, 22, 38, 60, 90]) {
          const bed = at(h, x + dx * distance, z + dz * distance);
          if (distance < 40 && bed > -.22) { clear = false; break; }
          score += bed < -.2 ? 5 : bed < 5 ? 1 : -5;
          score += at(swamp, x + dx * distance, z + dz * distance) * 2;
        }
        if (!clear) continue;
        for (const side of [-1, 1]) {
          const bank = at(h, x - dz * 38 * side, z + dx * 38 * side);
          if (bank > -.1 && bank < 5) score += 4;
        }
        if (!best || score > best.score) best = { x, z, lx: x + dx * 80, lz: z + dz * 80, name: marsh.name, score };
      }
    }
  }
  return best;
}