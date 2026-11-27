      const plant = plants[n]; // grow: 0 at the edge of the plant's reach, 1 near by (set by the underwater system from the eye's distance).
const grow = plant.grow ?? 1; const p = grow < 0.999 ? shrunk(plant.chains.shown, plant.site, grow) : plant.chains.shown; const rel = plant.chains.stream; const tint = plant.site.tint; const girth = plant.site.size * grow;
      const stipes = plant.stipes;
      for (let i = 0; i < stipes.length; i++) {
        const first = i * NODES;
        const thick = stipes[i].thick * girth;
        for (let k = 0; k < last; k++) {
          const q0 = (first + Math.max(0, k - 1)) * 3;
          const q1 = (first + k) * 3;
          const q2 = (first + k + 1) * 3;
          const q3 = (first + Math.min(last, k + 2)) * 3;
          e0[o] = p[q0];
          e0[o + 1] = p[q0 + 1];
          e0[o + 2] = p[q0 + 2];
          e0[o + 3] = tint;
          e1[o] = p[q1];
          e1[o + 1] = p[q1 + 1];
          e1[o + 2] = p[q1 + 2];
          e2[o] = p[q2];
          e2[o + 1] = p[q2 + 1];
          e2[o + 2] = p[q2 + 2];
          e3[o] = p[q3];
          e3[o + 1] = p[q3 + 1];
          e3[o + 2] = p[q3 + 2];
          // Radius in the fourth place of the two middle points: thicker at the root, thinner up the stipe.
          e1[o + 3] = (0.016 - 0.007 * Math.min(1, k / 6)) * thick;
          e2[o + 3] = (0.016 - 0.007 * Math.min(1, (k + 1) / 6)) * thick;
          o += 4;
        }
      }
      const sites = plant.sites;
      for (let i = 0; i < sites.length; i++) {
        const site = sites[i];
        const first = site.chain * NODES;
        const q = (first + site.node) * 3;
        const before = (first + site.node - 1) * 3;
        const after = (first + Math.min(last, site.node + 1)) * 3;
        tangent.set(p[after] - p[before], p[after + 1] - p[before + 1], p[after + 2] - p[before + 2]).normalize();
        // Out to one side of the stipe, the site's own level direction squared to it. A little of the level way
        // across the stipe is added so it never runs out when the stipe lies along that direction: the side then
        // turns smoothly instead of flipping, which would make the blades twitch.
        const tx = tangent.x;
        const ty = tangent.y;
        const tz = tangent.z;
        const d = site.cx * tx + site.cz * tz;
        outward.set(site.cx - tx * d - 0.3 * tz, -ty * d, site.cz - tz * d + 0.3 * tx).normalize();
        b[j] = p[q];
        b[j + 1] = p[q + 1];
        b[j + 2] = p[q + 2];
        b[j + 3] = site.length * grow;
        a[j] = tx;
        a[j + 1] = ty;
        a[j + 2] = tz;
        a[j + 3] = site.phase;
        f[j] = rel[q];
        f[j + 1] = rel[q + 1];
        f[j + 2] = rel[q + 2];
        f[j + 3] = site.width * grow;
        out[j] = outward.x;
        out[j + 1] = outward.y;
        out[j + 2] = outward.z;
        out[j + 3] = tint;
        j += 4;
      }
    }
    const segments = o / 4;
    const blades = j / 4;
    this.tube.instanceCount = segments;
    this.leaf.instanceCount = blades;
    this.bladder.instanceCount = blades;
    for (const attribute of this.ends) send(attribute, o);
    send(this.base, j);
    send(this.axis, j);
    send(this.stream, j);
    send(this.out, j);
    this.counts.segments = segments;
    this.counts.blades = blades;
  }
  dispose() {
    this.group.removeFromParent();
    this.tube.dispose();
    this.leaf.dispose();
    this.bladder.dispose();
    for (const r of this.roots) r.geometry.dispose();
    for (const m of Object.values(this.materials)) m.dispose();
  }
}
// Only the part in use is sent.
function send(attribute, floats) {
  if (attribute.clearUpdateRanges) {
    attribute.clearUpdateRanges();
    if (floats > 0) attribute.addUpdateRange(0, floats);
  }
  attribute.needsUpdate = true;
}
