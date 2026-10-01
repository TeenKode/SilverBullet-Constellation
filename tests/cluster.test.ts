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

test("a page that glues two topics is found, left out and does not give the name", () => {
  const hubIds = [...ids.filter((x) => x !== "day" && x !== "lone"), "similar"];
  const hubSims = sims.map((x) => x.slice());
  for (const id of hubIds) if (id !== "similar") hubSims.push(["similar", id, 0.5]);
  const hubLinks = hubIds.filter((x) => x !== "similar").map((x) => ["similar", x]);
  const rank = (id: string) => (id === "similar" ? 8 : 1);
  const input = { ids: hubIds, links: hubLinks, sims: hubSims, textWeight: 0.6, similarity: 0.3, minSize: 3, rank };
  const r = detect(input);
  assert.deepEqual(r.hubs, ["similar"]);
  assert.equal(r.clusters.length, 2);
  assert.ok(!r.of.has("similar"));
  assert.ok(r.clusters.every((c: any) => c.id !== "similar"));
  assert.deepEqual(detect({ ...input, hubs: false }).hubs, []);
});

test("a real center of one topic is not a hub", () => {
  const star = ["c", "x1", "x2", "x3", "x4", "x5", "x6"];
  const r = detect({ ids: star, links: star.slice(1).map((x) => ["c", x]), sims: [], textWeight: 0, minSize: 3, rank: (id: string) => (id === "c" ? 6 : 1) });
  assert.deepEqual(r.hubs, []);
});
