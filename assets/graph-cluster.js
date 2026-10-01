// Constellation — splitting pages into “constellations” (clusters). Pure, no DOM: also runs under `node --test`.
// Louvain local moving (modularity with a resolution) over a weighted graph made of
//   * links between pages — the more links a page has, the weaker each of them (a hub does not glue everything),
//   * text similarity of pages (comes from the plug, see src/similarity.ts),
// the weight of the two kinds is set by `textWeight`.
(function (root) {
  "use strict";

  // input: { ids, links: [[a, b]], sims: [[a, b, w]], skip: Set (pages that are not clustered: day summaries…),
  //          textWeight: 0..1, similarity: 0..1 (strictness: the bigger, the fewer weak similarities count),
  //          resolution: 0.3..2 (bigger — smaller constellations), minSize, label: id → text, rank: id → number }
  // result: { of: Map id → constellation id, clusters: [{ id, members, name, size }] }
  function detectOnce(input) {
    const skip = input.skip || new Set();
    const ids = input.ids.filter((id) => !skip.has(id)).sort();
    const index = new Map(ids.map((id, i) => [id, i]));
    const n = ids.length;
    const tw = Math.min(1, Math.max(0, input.textWeight == null ? 0.5 : input.textWeight));
    const floor = 0.1 + 0.4 * Math.min(1, Math.max(0, input.similarity == null ? 0.4 : input.similarity));
    const gamma = input.resolution == null ? 1 : input.resolution;
    const minSize = input.minSize || 3;

    const deg = new Array(n).fill(0);
    const seen = new Set();
    const linkPairs = [];
    for (const [a, b] of input.links || []) {
      const i = index.get(a), j = index.get(b);
      if (i === undefined || j === undefined || i === j) continue;
      const key = i < j ? i * n + j : j * n + i;
      if (seen.has(key)) continue;
      seen.add(key);
      linkPairs.push([i, j]);
      deg[i]++; deg[j]++;
    }
    const weights = new Map();       // i * n + j (i < j) → weight
    const add = (i, j, w) => {
      if (w <= 0) return;
      const key = i < j ? i * n + j : j * n + i;
      weights.set(key, (weights.get(key) || 0) + w);
    };
    for (const [i, j] of linkPairs) add(i, j, (1 - tw) * Math.min(1, 1.5 / Math.sqrt(deg[i] * deg[j])) * 2);
    for (const [a, b, w] of input.sims || []) {
      const i = index.get(a), j = index.get(b);
      if (i === undefined || j === undefined || i === j) continue;
      add(i, j, tw * 2 * Math.max(0, (w - floor) / (1 - floor)));
    }

    const adj = Array.from({ length: n }, () => []);
    let m2 = 0;                       // 2m — twice the total weight
    for (const [key, w] of weights) {
      const i = Math.floor(key / n), j = key % n;
      adj[i].push([j, w]);
      adj[j].push([i, w]);
      m2 += 2 * w;
    }
    const k = adj.map((list) => list.reduce((s, [, w]) => s + w, 0));
    const comm = ids.map((_, i) => i);
    const tot = k.slice();
    if (m2 > 0) {
      for (let pass = 0; pass < 12; pass++) {
        let moved = false;
        for (let i = 0; i < n; i++) {
          if (!adj[i].length) continue;
          const to = new Map();
          for (const [j, w] of adj[i]) to.set(comm[j], (to.get(comm[j]) || 0) + w);
          const own = comm[i];
          tot[own] -= k[i];
          let best = own, gain = (to.get(own) || 0) - gamma * k[i] * tot[own] / m2;
          for (const [c, w] of to) {
            const g = w - gamma * k[i] * tot[c] / m2;
            if (g > gain + 1e-12 || (Math.abs(g - gain) <= 1e-12 && c < best && c !== own && g > (to.get(own) || 0) - gamma * k[i] * tot[own] / m2 - 1e-12)) {
              gain = g; best = c;
            }
          }
          tot[best] += k[i];
          if (best !== own) { comm[i] = best; moved = true; }
        }
        if (!moved) break;
      }
    }

    const groups = new Map();
    for (let i = 0; i < n; i++) {
      if (!adj[i].length) continue;
      if (!groups.has(comm[i])) groups.set(comm[i], []);
      groups.get(comm[i]).push(i);
    }
    const label = input.label || ((id) => id);
    const rank = input.rank || (() => 0);
    const of = new Map();
    const clusters = [];
    for (const members of groups.values()) {
      if (members.length < minSize) continue;
      // the name page is the member most tied inside the constellation
      const inside = new Set(members);
      let name = members[0], top = -1;
      for (const i of members) {
        const s = adj[i].reduce((sum, [j, w]) => sum + (inside.has(j) ? w : 0), 0) + rank(ids[i]) * 1e-3;
        if (s > top + 1e-12) { top = s; name = i; }
      }
      const id = ids[name];
      clusters.push({ id, members: members.map((i) => ids[i]), name: label(id), size: members.length });
      for (const i of members) of.set(ids[i], id);
    }
    clusters.sort((a, b) => b.size - a.size || (a.id < b.id ? -1 : 1));
    return { of, clusters };
  }

  // A hub is a page that glues topics: its neighbours (links and similar texts) are spread over several constellations
  // — no one of them holds most of them — and there are many of them. Such a page (“similar topics”, an index of
  // everything) must neither make a constellation nor give it a name. A real center of one topic has its
  // neighbours in its own constellation and is not touched.
  function findHubs(input, first) {
    const minSize = input.minSize || 3;
    const floor = 0.1 + 0.4 * Math.min(1, Math.max(0, input.similarity == null ? 0.4 : input.similarity));
    const skip = input.skip || new Set();
    const near = new Map();
    const tie = (a, b) => {
      if (a === b || skip.has(a) || skip.has(b)) return;
      if (!near.has(a)) near.set(a, new Set());
      if (!near.has(b)) near.set(b, new Set());
      near.get(a).add(b); near.get(b).add(a);
    };
    for (const [a, b] of input.links || []) tie(a, b);
    for (const [a, b, w] of input.sims || []) if (w >= floor) tie(a, b);
    const hubs = [];
    for (const [id, set] of near) {
      if (set.size < Math.max(6, 2 * minSize)) continue;
      const parts = new Map();
      for (const x of set) {
        const c = first.of.get(x);
        const key = c === undefined ? "-" : c;
        parts.set(key, (parts.get(key) || 0) + 1);
      }
      const counts = [...parts.entries()].filter(([key]) => key !== "-").map(([, n]) => n).sort((x, y) => y - x);
      if (counts.length >= 2 && counts[0] <= 0.65 * set.size && counts[1] >= Math.max(2, 0.2 * set.size)) hubs.push(id);
    }
    return hubs.sort();
  }

  // + input.hubs !== false: hubs are found and left out; result.hubs lists them
  function detect(input) {
    const first = detectOnce(input);
    if (input.hubs === false) return { ...first, hubs: [] };
    const hubs = findHubs(input, first);
    if (!hubs.length) return { ...first, hubs: [] };
    const r = detectOnce({ ...input, skip: new Set([...(input.skip || []), ...hubs]) });
    return { ...r, hubs };
  }

  const api = { detect };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.CNCluster = api;
})(typeof window !== "undefined" ? window : globalThis);
