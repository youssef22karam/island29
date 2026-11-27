/* =============================================================================
   kelp-underwater.js
   -----------------------------------------------------------------------------
   kelp3, whole, under every lake, river and swamp of the island.
   This is a port of the kelp3 project itself rather than a likeness of it: its
   water optics, caustics, haze and lighting (kelp/sea.js), its chain-simulated
   giant kelp with ruffled blades, floats and holdfasts (kelp/giant.js), its
   generated sand, pebble and rock scans and sculpted stones, its growers,
   sugar kelp, fish and bubbles (kelp/life.js, kelp/procedural.ts), and its
   surface, light shafts, marine snow and plankton (kelp/atmos.js), translated
   from WebGPU node materials to the island's WebGL2 shaders.
   kelp3 is one small scene round one start; the island is kilometres of water.
   So the bed is planted tile by tile from the world's own fields as the eye
   comes near, the nearest giant kelp are grown and simulated, and the sea's
   look glides between lake (kelp3's forest as it is), river (clearer, greener,
   everything streaming with the current) and swamp (tea-stained, weedy, shot
   with light) according to the water round the eye.
============================================================================= */
import * as THREE from "three";
import { Atmosphere, Presenter } from "./kelp/atmos.js";
import { KelpPool, growPlant } from "./kelp/giant.js";
import { LifePool, TILE, makeAssets, plantTile } from "./kelp/life.js";
import { KU, advance, ageStirs, aimSea, easeSea, stir } from "./kelp/sea.js";
import { findUnderwaterSpot, sampleWaterProps } from "./kelp/world.js";
export { findUnderwaterSpot, KU };
// fine and dens as kelp3's tiers thin the scene.
// radius how far the bed is planted. It is also the water's horizon (KU.kHorizon): under water everything is
// lost in the haze before this distance, and stones, weed and fish stand up from nothing as they come
// inside it, so the planting is never seen happening.
// reach how far off the tall weed stands; stand: how many are alive at once; plants: how many of those, the
// nearest, are simulated every frame (the rest hold their settled pose, off in the haze).
// keep the share of rooting sites that grow a plant. It used to be every site, with only the nearest handful
// alive, so on a phone the weed sprang up ten metres ahead of the walker. Thinning the sites themselves,
// the same ones for good, lets every plant within reach be there at once.
// stand is sized well above the number of kept sites a full forest puts within reach (the mean and
// some two and a half deviations more), so a plant hardly ever has to wait for room.
const TIERS = { lowest: { fine: 0.5, dens: 0.4, radius: 30, plants: 6, stand: 22, reach: 25, keep: 0.28, rate: 1 / 60 }, lower: { fine: 0.5, dens: 0.5, radius: 32, plants: 8, stand: 30, reach: 27, keep: 0.34, rate: 1 / 60 }, low: { fine: 0.6, dens: 0.6, radius: 36, plants: 12, stand: 36, reach: 31, keep: 0.36, rate: 1 / 60 }, medium: { fine: 0.75, dens: 0.8, radius: 42, plants: 18, stand: 50, reach: 36, keep: 0.4, rate: 1 / 90 }, high: { fine: 1, dens: 1, radius: 46, plants: 26, stand: 62, reach: 40, keep: 0.42, rate: 1 / 90 }, }; // Whether a rooting site grows a plant at this tier: from the site alone, so it never changes as the eye moves.
const keeps = (site, share) => (site.seed * 0.6180339887) % 1 < share;
// The generated floor is made once for each size of texture and kept.
const assetCache = new Map();
function assetsFor(big) {
  if (!assetCache.has(big)) assetCache.set(big, makeAssets(big));
  return assetCache.get(big);
}
export class KelpUnderwaterSystem {
  constructor(sharedU, getField, quality = "medium") {
    this.U = sharedU;
    this.getField = getField;
    this.group = new THREE.Group();
    this.group.name = "kelp3-underwater";
    this.tiles = new Map();
    this.pending = [];
    this.wanted = [];
    this.plants = new Map();
    this.list = [];
    this.lastKey = "";
    this.frame = 0;
    this.isSubmerged = false;
    this.biome = { lake: 1, river: 0, swamp: 0 };
    this.current = [0.075, 0.03];
    this.snap = true;
    this.steady = 1 / 60;
    this.lastEye = new THREE.Vector3(1e9, 0, 0);
    this.chooseAt = new THREE.Vector3(1e9, 0, 0); this.wantedAt = new THREE.Vector3(1e9, 0, 0); this.wantedSet = ""; this.wake = 0;
    this.presenter = new Presenter();
    this._build(quality);
  }
  _build(quality) {
    this.quality = quality;
    this.tier = TIERS[quality] || TIERS.medium;
    const assets = assetsFor(this.tier.fine > 0.7);
    KU.kTex.value = assets.tex;
    this.life = new LifePool(assets, this.tier.fine);
    this.kelp = new KelpPool(this.tier.stand, this.tier.fine); KU.kHorizon.value = this.tier.radius;
    this.water = new Atmosphere(this.tier.fine);
    // The submerged-only part, which the island leaves out of what it draws through the surface from above.
    this.subGroup = this.water.group;
    this.group.add(this.life.group, this.kelp.group, this.water.group);
  }
  setQuality(quality) {
    if (this.quality === quality) return;
    this.clear();
    this.life.dispose();
    this.kelp.dispose();
    this.water.dispose();
    this._build(quality);
  }
  // A surge out from a point: a tap in the water.
  stirAt(x, y, z, strength = 1.4) {
    stir(x, y, z, Math.min(2, strength));
  }
  // The frame's share of the work while the eye is ABOVE the surface. Nothing is planted and nothing is
  // simulated, but the sea's own state is kept true. update() used to be the only place that state was
  // written, and the island only calls it while submerged, so on surfacing kUnder stayed at 1 for good: the
  // terrain went on being drawn through water (dark haze over all the land), the water's look stayed that of
  // wherever the last dive was, and the caustics on the beds seen from the air stood still.
  ambient(camera, dt = 0.016) {
    const field = this.getField();
    const eye = camera.position;
    KU.kEye.value.copy(eye);
    KU.kUnder.value = 0;
    this.isSubmerged = false;
    this.water.group.visible = false;
    if (!field) return;
    const isl = field.islandAt(eye.x, eye.z);
    const world = isl?.world ?? null;
    const here = world ? sampleWaterProps(world, eye.x - isl.spec.cx, eye.z - isl.spec.cz) : null;
    if (here) {
      this.biome.lake = here.lake;
      this.biome.river = here.river;
      this.biome.swamp = here.swamp;
      const speed = Math.min(0.42, here.flowSpd * 0.5) * (0.35 + 0.65 * here.river);
      const s = here.flowSpd > 1e-3 ? speed / here.flowSpd : 0;
      this.current[0] = here.flowX * s + 0.075 * here.lake;
      this.current[1] = here.flowZ * s + 0.03 * here.lake;
    }
    const U = this.U;
    aimSea(this.biome, {
      sun: U.uSun?.value,
      moon: U.uMoon?.value,
      sunCol: U.uSunCol?.value,
      light: U.uLight?.value ?? 1,
      storm: U.uStorm?.value ?? 0,
      flowX: this.current[0],
      flowZ: this.current[1],
    });
    const raw = Math.min(Math.max(dt, 0), 1 / 15);
    this.steady += (raw - this.steady) * 0.2;
    const delta = dt > 0 ? this.steady : 0;
    const jumped = this.lastEye.distanceToSquared(eye) > 400;
    easeSea(this.snap || jumped ? 1 : 1 - Math.exp(-delta * 2));
    this.snap = false;
    advance(delta);
    ageStirs(delta);
    this.lastEye.copy(eye);
  }
  update(camera, dt = 0.016, buildBudget = 2) {
    this.frame++;
    const field = this.getField();
    if (!field) return;
    const eye = camera.position;
    KU.kEye.value.copy(eye);
    const isl = field.islandAt(eye.x, eye.z);
    const world = isl?.world ?? null;
    const here = world ? sampleWaterProps(world, eye.x - isl.spec.cx, eye.z - isl.spec.cz) : null;
    const under = eye.y < -0.04;
    this.isSubmerged = under;
    KU.kUnder.value = under ? 1 : 0;
    this.water.group.visible = under;
    // The sea is aimed at the water round the eye and the island's sky, and eased toward it.
    let bed = KU.kBedY.value;
    if (here) {
      this.biome.lake = here.lake;
      this.biome.river = here.river;
      this.biome.swamp = here.swamp;
      bed = here.h;
      // The current the specks ride: kelp3's own slow drift in still water, a river's where it runs.
      const speed = Math.min(0.42, here.flowSpd * 0.5) * (0.35 + 0.65 * here.river);
      const s = here.flowSpd > 1e-3 ? speed / here.flowSpd : 0;
      this.current[0] = here.flowX * s + 0.075 * here.lake;
      this.current[1] = here.flowZ * s + 0.03 * here.lake;
    } else if (under) {
      const h = field.heightAt(eye.x, eye.z);
      if (h < 0) bed = h;
    }
    const U = this.U;
    aimSea(this.biome, {
      sun: U.uSun?.value,
      moon: U.uMoon?.value,
      sunCol: U.uSunCol?.value,
      light: U.uLight?.value ?? 1,
      storm: U.uStorm?.value ?? 0,
      flowX: this.current[0],
      flowZ: this.current[1],
    });
    // Smoothed frame time, so one slow frame does not jerk everything forward.
    const raw = Math.min(Math.max(dt, 0), 1 / 15);
    this.steady += (raw - this.steady) * 0.2;
    const delta = dt > 0 ? this.steady : 0;
    // A jump to another water arrives already there; otherwise the sea glides.
    const jumped = this.lastEye.distanceToSquared(eye) > 400;
    easeSea(this.snap || jumped ? 1 : 1 - Math.exp(-delta * 2));
    KU.kBedY.value += (bed - KU.kBedY.value) * (this.snap || jumped ? 1 : 1 - Math.exp(-delta * 3));
    this.snap = false;
    advance(delta);
    ageStirs(delta);
    this.water.update(camera);
    // The swimmer moves the water too: kelp parts a little round whoever passes through it.
    if (under && delta > 0 && !jumped) {
      const speed = this.lastEye.distanceTo(eye) / Math.max(delta, 1e-3);
      this.wake -= delta;
      if (speed > 0.9 && this.wake <= 0) {
        this.wake = 0.3;
        stir(eye.x, eye.y - 0.25, eye.z, Math.min(0.8, speed * 0.11));
      }
    }
    this.lastEye.copy(eye);
    // From high in the air none of it shows.
    const active = !!world && eye.y < 70;
    this.group.visible = active;
    if (!active) return;
    // The bed is planted in tiles round the eye, nearest first, a few a frame.
    const R = this.tier.radius;
    const ctx = Math.floor(eye.x / TILE);
    const ctz = Math.floor(eye.z / TILE);
    const key = ctx + "," + ctz;
    let dirty = false; // Looked at again every few metres, not only on crossing into another tile, and a whole tile beyond the
// horizon: a tile is planted while all of it is still out of sight. (It used to be looked at once a tile,
// so a tile could be sixteen metres inside the radius before it was planted, in plain view.)
if (key !== this.lastKey || Math.hypot(eye.x - this.wantedAt.x, eye.z - this.wantedAt.z) > 3) { this.lastKey = key; this.wantedAt.set(eye.x, 0, eye.z); const span = Math.ceil(R / TILE) + 1; this.wanted.length = 0; for (let dz = -span; dz <= span; dz++) for (let dx = -span; dx <= span; dx++) { const d = Math.hypot((ctx + dx + 0.5) * TILE - eye.x, (ctz + dz + 0.5) * TILE - eye.z); if (d > R + TILE) continue; this.wanted.push({ tx: ctx + dx, tz: ctz + dz, k: ctx + dx + "," + (ctz + dz), d }); } this.wanted.sort((a, b) => a.d - b.d); this.pending = this.wanted.filter((w) => !this.tiles.has(w.k)); // The pools are gathered again only when the tiles in view are different ones.
const set = this.wanted .map((w) => w.k) .sort() .join(";"); if (set !== this.wantedSet) { this.wantedSet = set; dirty = true; }
      // Tiles left far behind are let go.
      if (this.tiles.size > 220)
        for (const [k, t] of this.tiles) if (Math.hypot((t.tx + 0.5) * TILE - eye.x, (t.tz + 0.5) * TILE - eye.z) > R + TILE * 4) this.tiles.delete(k);
    }
    let built = 0;
    while (this.pending.length && built < buildBudget) {
      const next = this.pending.shift();
      if (this.tiles.has(next.k)) continue;
      const home = field.islandAt((next.tx + 0.5) * TILE, (next.tz + 0.5) * TILE);
      const tile = home?.world ? plantTile(home.world, home.spec.cx, home.spec.cz, next.tx, next.tz, this.tier.dens) : null;
      this.tiles.set(next.k, { tile, tx: next.tx, tz: next.tz });
      built++;
      dirty = true;
    }
    if (dirty) {
      this.visible = [];
      for (const w of this.wanted) {
        const t = this.tiles.get(w.k);
        if (t?.tile) this.visible.push(t.tile);
      }
      this.life.compose(this.visible);
    }
    // The nearest giant kelp are grown and kept; those left behind are let go.
    if (dirty || this.chooseAt.distanceToSquared(eye) > 4) {
      this.chooseAt.copy(eye);
      this._choose(eye, buildBudget > 8 ? 999 : 2, buildBudget > 8 || jumped); } // How fully each plant stands: whole near by, nothing at the edge of its reach, and eased, so that even one
// that had to wait for room comes up gently rather than all at once.
const reach = this.tier.reach; const ease = 1 - Math.exp(-raw * 2.4); for (let i = 0; i < this.list.length; i++) { const plant = this.list[i]; const d = Math.hypot(plant.site.x - eye.x, plant.site.z - eye.z); const whole = 1 - THREE.MathUtils.smoothstep(d, reach * 0.78, reach * 0.97); plant.grow = plant.grow === undefined ? whole : plant.grow + (whole - plant.grow) * ease; } // The nearest are simulated; those further off keep the pose they settled into.
const live = Math.min(this.list.length, this.tier.plants); for (let i = 0; i < live; i++) this.list[i].chains.update(delta); this.kelp.fill(this.list);
  }
  // Every kept site within reach has its plant. instant: on arriving somewhere, plants are simply there; while
// walking, a new one starts from nothing at the edge of its reach.
_choose(eye, most, instant) { const reach = this.tier.reach; const share = this.tier.keep; let changed = false; for (const site of this.plants.keys()) if (Math.hypot(site.x - eye.x, site.z - eye.z) > reach + 3) { this.plants.delete(site); changed = true; } if (this.plants.size < this.tier.stand) { const near = []; for (const tile of this.visible || []) for (const site of tile.plants) { if (this.plants.has(site) || !keeps(site, share)) continue; const d = Math.hypot(site.x - eye.x, site.z - eye.z); if (d < reach) near.push({ site, d }); } near.sort((a, b) => a.d - b.d); for (let i = 0; i < near.length && this.plants.size < this.tier.stand && i < most; i++) { const site = near[i].site; site.rate = this.tier.rate; const plant = growPlant(site); if (!instant) plant.grow = 0; this.plants.set(site, plant); changed = true; } // More waiting to be grown: look again next frame.
if (near.length > most) this.chooseAt.set(1e9, 0, 0); } if (changed) { this.list = [...this.plants.values()]; this.kelp.place(this.list); } // Nearest first: the head of the list is what gets simulated.
for (const plant of this.list) plant.near = Math.hypot(plant.site.x - eye.x, plant.site.z - eye.z); this.list.sort((a, b) => a.near - b.near); }
  // Everything round the eye at once, for a still or an arrival.
  warmAll(camera, budget = 120) {
    this.lastKey = "";
    this.snap = true;
    this.update(camera, 0, Math.max(budget, 9));
  }
  // The finished frame while the eye is under water, composed as kelp3 composes it.
  render(renderer, scene, camera) {
    this.presenter.render(renderer, scene, camera);
  }
  clear() {
    this.tiles.clear();
    this.pending.length = 0;
    this.wanted.length = 0;
    this.visible = [];
    this.plants.clear();
    this.list = [];
    this.lastKey = ""; this.wantedSet = ""; this.snap = true; this.kelp?.place(this.list);
    this.kelp?.fill(this.list);
    this.life?.compose([]);
  }
  get stats() {
    return {
      tiles: this.tiles.size,
      visibleTiles: this.visible?.length ?? 0,
      meshes: this.life.instances,
      plants: this.list.length,
      segments: this.kelp.counts.segments,
      blades: this.kelp.counts.blades,
      submerged: this.isSubmerged,
    };
  }
  dispose() {
    this.clear();
    this.group.removeFromParent();
    this.life.dispose();
    this.kelp.dispose();
    this.water.dispose();
    this.presenter.dispose();
  }
}
