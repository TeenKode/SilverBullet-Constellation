import assert from "node:assert/strict";
import { test } from "node:test";

// the module is a plain browser script: it registers itself as globalThis.CNCluster
await import("../assets/graph-cluster.js");
const { detect } = (globalThis as any).CNCluster;

const ids = ["a1", "a2", "a3", "a4", "b1", "b2", "b3", "b4", "day", "lone"];
const links = [["day", "a1"], ["day", "a2"], ["day", "a3"], ["day", "a4"], ["day", "b1"], ["day", "b2"], ["day", "b3"], ["day", "b4"]];
const sims = [];
for (const g of ["a", "b"]) for (let i = 1; i <= 4; i++) for (let j = i + 1; j <= 4; j++) sims.push([g + i, g + j, 0.6]);

test("a day hub does not glue everything: two constellations by text, the hub is left out", () => {
  const r = detect({ ids, links, sims, skip: new Set(["day"]), textWeight: 0.6, similarity: 0.3, minSize: 3 });
  assert.equal(r.clusters.length, 2);
  assert.deepEqual(r.clusters.map((c: any) => c.size), [4, 4]);
  assert.equal(r.of.get("a1"), r.of.get("a4"));
  assert.notEqual(r.of.get("a1"), r.of.get("b1"));
  assert.ok(!r.of.has("day") && !r.of.has("lone"));
});

test("without text only links: with a skipped hub nothing forms", () => {
  const r = detect({ ids, links, sims: [], skip: new Set(["day"]), textWeight: 0, minSize: 3 });
  assert.equal(r.clusters.length, 0);
});

test("strictness: weak similarities stop counting", () => {
  const weak = sims.map(([a, b]) => [a, b, 0.2]);
  const soft = detect({ ids, links: [], sims: weak, textWeight: 1, similarity: 0, minSize: 3 });
  const strict = detect({ ids, links: [], sims: weak, textWeight: 1, similarity: 1, minSize: 3 });
  assert.equal(soft.clusters.length, 2);
  assert.equal(strict.clusters.length, 0);
});

test("minimum size and stable result", () => {
  const input = { ids, links: [], sims, textWeight: 1, similarity: 0.2, minSize: 5 };
  assert.equal(detect(input).clusters.length, 0);
  const a = detect({ ...input, minSize: 3 }), b = detect({ ...input, minSize: 3, ids: ids.slice().reverse() });
  assert.deepEqual(a.clusters.map((c: any) => c.id), b.clusters.map((c: any) => c.id));
});
