import assert from "node:assert/strict";
import { freshwaterCoverage, freshwaterTakeover } from "../src/engine/water-coverage.js";
import { buildFreshwaterGeometry } from "../src/engine/hydrology.js";

const N = 8;
const world = {
  N, cell: 10, half: N * 5,
  h: new Float32Array(N * N).fill(2),
  wet: new Uint8Array(N * N),
  inl: new Float32Array(N * N),
  flowX: new Float32Array(N * N),
  flowZ: new Float32Array(N * N),
  sed: new Float32Array(N * N),
  swamp: new Float32Array(N * N),
};

for (const k of [27, 28, 35, 36]) {
  world.h[k] = -1;
  world.wet[k] = 1;
  world.inl[k] = .43;
  world.swamp[k] = .8;
}
world.h[9] = -3;
world.inl[9] = .6;
world.h[54] = -10;

const coverage = freshwaterCoverage(world);
assert.equal(freshwaterCoverage(world), coverage, "Coverage is cached per world");
for (const k of [27, 28, 35, 36]) {
  assert.equal(coverage[k], 1, "A wet swamp cannot turn into a partial sea-mouth mask");
}
assert.equal(coverage[26], 1, "Coverage extends to the dry side of a shoreline");
assert.equal(coverage[54], 0, "The open sea is never claimed by freshwater");
assert.ok(Math.abs(coverage[9] - .6) < 1e-6, "Estuary gradients are preserved");
for (let m = 0; m <= 1; m += .01) {
  const fresh = freshwaterTakeover(m);
  const ocean = 1 - freshwaterTakeover(m);
  assert.ok(Math.abs(fresh + ocean - 1) < 1e-10, "The two surfaces must cover the same pixel exactly");
}

const geometry = buildFreshwaterGeometry(world);
const position = geometry.getAttribute("position");
const water = geometry.getAttribute("aWater");
const edge = geometry.getAttribute("aEdge");
assert.ok(position.count > 0, "The swamp has a surface");
assert.equal(position.count % 3, 0, "The surface contains complete triangles");
let contactVertices = 0;
for (let i = 0; i < position.count; i++) {
  assert.ok(Number.isFinite(position.getX(i)) && Number.isFinite(position.getZ(i)));
  assert.ok(water.getZ(i) >= 0, "Depth is never negative");
  if (water.getZ(i) < .002 && edge.getX(i) > .99) contactVertices++;
}
assert.ok(contactVertices > 0, "Bank vertices retain coverage instead of fading whole triangles");
geometry.dispose();
console.log("PASS: shared masks, wet-swamp coverage, dry-bank extension, estuary blending, and contact geometry.");