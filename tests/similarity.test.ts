import assert from "node:assert/strict";
import { test } from "node:test";
import { similarPairs, tokenize } from "../src/similarity.ts";
import { isPeriodic } from "../src/core.ts";

test("tokenize: header, links syntax, attributes and numbers do not count; endings are cut", () => {
  const t = tokenize("---\ndate: 2026-10-01\n---\n# Родители\n[[Темы/Анкета|анкете]] [who: Иван] [due: 2026-10-02] 2026 и http://x.y/z\n```\ncode word\n```\nРодителей");
  assert.deepEqual(t, ["родите", "анкете", "родите"]);
});

test("similarPairs: pages about one thing pair up, pages about another do not", () => {
  const docs = [
    { id: "a", title: "Принтер", text: "принтер картридж печать бумага кабинет принтер заправка" },
    { id: "b", title: "Картридж", text: "картридж заправка принтер печать замена" },
    { id: "c", title: "Фестиваль", text: "фестиваль сцена гости выступление программа афиша" },
    { id: "d", title: "Афиша", text: "афиша фестиваль программа выступление печать" },
  ];
  const pairs = similarPairs(docs, { min: 0.05 });
  const has = (x: string, y: string) => pairs.some((p) => (p.a === x && p.b === y) || (p.a === y && p.b === x));
  assert.ok(has("a", "b"));
  assert.ok(has("c", "d"));
  assert.ok(!has("a", "c"));
  assert.ok(pairs.every((p) => p.w > 0 && p.w <= 1));
});

test("similarPairs: nothing to compare — nothing", () => {
  assert.deepEqual(similarPairs([]), []);
  assert.deepEqual(similarPairs([{ id: "a", title: "x", text: "слово слово" }]), []);
});

test("isPeriodic: a day and a week are, a topic is not", () => {
  assert.ok(isPeriodic("Итоги дня/2026-09-29"));
  assert.ok(isPeriodic("Итоги недели/2026-W39"));
  assert.ok(!isPeriodic("Темы/Фестиваль"));
});
