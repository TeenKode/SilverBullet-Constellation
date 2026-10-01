import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildGraphData, findDirectives, findTaskStart, groupOf, labelOf, nodeDate, normalizeConfig, pageTitle,
  resolveGroups, resolveLang, setTaskState, splitNames, taskOffsets, valueToMarkdown, weekMonday,
} from "../src/core.ts";

test("language: config wins, otherwise the browser", () => {
  assert.equal(resolveLang("auto", "ru-RU"), "ru");
  assert.equal(resolveLang("auto", "de-DE"), "en");
  assert.equal(resolveLang("en", "ru-RU"), "en");
  assert.equal(resolveLang("ru", "en-US"), "ru");
});

test("groups: by top-level folder without configuration", () => {
  const cfg = normalizeConfig({});
  assert.equal(groupOf("Projects/Alpha", cfg.groups), "Projects");
  assert.equal(groupOf("index", cfg.groups), "other");
  const groups = resolveGroups(cfg, ["Projects/Alpha", "Journal/2026-09-28", "index"], "en");
  assert.deepEqual(groups.map((g) => g.id), ["Journal", "Projects", "other"]);
  assert.equal(groups[2].name, "Other");
  assert.notEqual(groups[0].light, groups[1].light);
});

test("groups: configured prefixes, exact pages and the place of “other”", () => {
  const cfg = normalizeConfig({
    groups: [
      { id: "topic", name: "Topics", prefix: "Topics/" },
      { id: "other", name: "Misc" },
      { id: "service", name: "Service", prefix: ["System/", "Questions/"], pages: ["index"], hidden: true, undated: true },
    ],
  });
  assert.equal(groupOf("Topics/A", cfg.groups), "topic");
  assert.equal(groupOf("Questions/Q", cfg.groups), "service");
  assert.equal(groupOf("index", cfg.groups), "service");
  assert.equal(groupOf("Random", cfg.groups), "other");
  const groups = resolveGroups(cfg, [], "en");
  assert.deepEqual(groups.map((g) => g.id), ["topic", "other", "service"]);
  assert.equal(groups[2].hidden, true);
  assert.equal(groups[1].name, "Misc");
});

test("labels and titles of date pages", () => {
  assert.equal(labelOf("Journal/2026-09-28", "ru"), "28.09");
  assert.equal(labelOf("Journal/2026-09-28", "en"), "Sep 28");
  assert.equal(labelOf("Weekly/2026-W40", "ru"), "нед. 40");
  assert.equal(labelOf("Weekly/2026-W40", "en"), "W40");
  assert.equal(labelOf("index", "ru"), "Главная");
  assert.equal(labelOf("index", "en", { startPage: "index", homeLabel: "Start" }), "Start");
  assert.equal(pageTitle("Journal/2026-09-28", "ru"), "28.09.2026");
  assert.equal(pageTitle("Journal/2026-09-28", "en"), "Sep 28, 2026");
  assert.equal(pageTitle("Weekly/2026-W39", "ru"), "Неделя 39, 2026");
});

test("dates for the timeline", () => {
  assert.equal(weekMonday(2026, 40), "2026-09-28");
  assert.equal(nodeDate("Journal/2026-09-28", "2026-10-02T10:00:00"), "2026-09-28");
  assert.equal(nodeDate("Weekly/2026-W40", undefined), "2026-09-28");
  assert.equal(nodeDate("Topics/A", "2026-10-02T10:00:00"), "2026-10-02");
  assert.equal(nodeDate("People/Ann", "2026-10-02T10:00:00", true), "");
});

test("names from task attributes", () => {
  assert.deepEqual(splitNames("Ann, Bob; Carol and Dave"), ["Ann", "Bob", "Carol", "Dave"]);
  assert.deepEqual(splitNames("Мария Петровна и Олег"), ["Мария Петровна", "Олег"]);
  assert.deepEqual(splitNames(["Ann", "Bob"]), ["Ann", "Bob"]);
  assert.deepEqual(splitNames(undefined), []);
});

test("${…} expressions are found outside code blocks", () => {
  const text = "a ${query[[from t = index.tag 'task']]} b\n```\n${not this}\n```\n${widget {x = 1}}";
  assert.deepEqual(findDirectives(text).map((d) => d.expr), ["query[[from t = index.tag 'task']]", "widget {x = 1}"]);
});

test("expression values → markdown and widgets", () => {
  const widgets: string[] = [];
  assert.equal(valueToMarkdown([{ ref: "Journal/2026-09-28" }], widgets, "ru"), "* [[Journal/2026-09-28|28.09.2026]]");
  assert.equal(valueToMarkdown([], widgets, "en"), "_none_");
  assert.match(valueToMarkdown({ html: "<table></table>" }, widgets), /CNWIDGET0END/);
  assert.equal(widgets[0], "<table></table>");
});

test("task positions like SilverBullet, code blocks and expressions skipped", () => {
  const text = "# T\n\n- [ ] one\n  - [x] nested\n```\n- [ ] code\n```\n${q}\n1. [ ] numbered\n";
  const offsets = taskOffsets(text, 0);
  assert.deepEqual(offsets.map((o) => text.slice(o, o + 5)), ["- [ ]", "- [x]", "1. [ "]);
});

test("ticking a task by position, also in a CRLF file and by line/column", () => {
  const lf = "# T\n\n- [ ] one\n- [ ] two\n";
  const pos = lf.indexOf("- [ ] two");
  assert.equal(setTaskState(lf, String(pos), true), "# T\n\n- [ ] one\n- [x] two\n");
  // SilverBullet counts positions without \r — the same position must hit the same task in a CRLF file
  const crlf = lf.replace(/\n/g, "\r\n");
  assert.equal(setTaskState(crlf, String(pos), true), "# T\r\n\r\n- [ ] one\r\n- [x] two\r\n");
  assert.equal(setTaskState(crlf, "L4", true), "# T\r\n\r\n- [ ] one\r\n- [x] two\r\n");
  // a position inside the task text or outside tasks — no task there
  assert.equal(findTaskStart(lf, String(pos + 7)), -1);
  assert.equal(setTaskState(lf, "0", true), null);
  assert.equal(setTaskState(lf, "junk", true), null);
  // unticking; already in that state — unchanged
  assert.equal(setTaskState("- [x] a", "0", false), "- [ ] a");
  assert.equal(setTaskState("- [x] a", "0", true), "- [x] a");
});

test("graph data: links, task-attribute links, overdue and upcoming marks, exclusions", () => {
  const cfg = normalizeConfig({
    groups: [
      { id: "topic", prefix: "Topics/" }, { id: "event", prefix: "Events/" },
      { id: "person", prefix: "People/", undated: true },
    ],
    taskLinks: { who: "People/" },
    upcoming: { prefix: "Events/", mirror: "Topics/", days: 14 },
  });
  const data = buildGraphData("Topics/Fair", {
    pages: [
      { name: "Topics/Fair", lastModified: "2026-09-20T10:00:00" },
      { name: "Events/Fair", date: "2026-10-03", lastModified: "2026-09-20T10:00:00" },
      { name: "People/Ann", lastModified: "2026-09-01T10:00:00" },
      { name: "Topics/Lonely", lastModified: "2026-09-01T10:00:00" },
      { name: "Library/Std/Thing" },
    ],
    links: [
      { page: "Events/Fair", toPage: "Topics/Fair" },
      { page: "Topics/Fair", toPage: "Library/Std/Thing" },
      { page: "Topics/Fair", toPage: "image.png" },
    ],
    tasks: [
      { page: "Topics/Fair", who: "Ann", due: "2026-09-25", done: false },
      { page: "Topics/Fair", who: "Nobody", deadline: "2026-09-26", done: false },
      { page: "Topics/Fair", due: "2026-09-01", done: true },
    ],
  }, cfg, "en", "2026-09-28");
  const byId = new Map(data.nodes.map((n) => [n.id, n]));
  assert.deepEqual(Array.from(byId.keys()).sort(), ["Events/Fair", "People/Ann", "Topics/Fair", "Topics/Lonely"]);
  assert.deepEqual(data.edges.map((e) => `${e.source}→${e.target}`).sort(), ["Events/Fair→Topics/Fair", "Topics/Fair→People/Ann"]);
  assert.equal(byId.get("Topics/Fair")!.overdue, 2);
  assert.equal(byId.get("Events/Fair")!.soon, 5);
  assert.equal(byId.get("Topics/Fair")!.soon, 5);
  assert.equal(byId.get("Topics/Fair")!.soonVia, "Events/Fair");
  assert.equal(byId.get("Topics/Lonely")!.isOrphan, true);
  assert.equal(byId.get("People/Ann")!.date, "");
  assert.equal(byId.get("Topics/Fair")!.isCurrent, true);
  assert.deepEqual(data.groups.map((g) => g.id), ["topic", "event", "person", "other"]);
  assert.deepEqual(data.linkAttributes, ["who"]);
});

test("upcoming marks can be switched off", () => {
  const data = buildGraphData("", { pages: [{ name: "A", date: "2026-09-29" }], links: [], tasks: [] },
    normalizeConfig({ upcoming: false }), "en", "2026-09-28");
  assert.equal(data.nodes[0].soon, null);
});

test("noConstellations: the page stays in the graph and is marked", () => {
  const cfg = normalizeConfig({ noConstellations: ["Similar topics", "Index/"] });
  const data = buildGraphData("A", {
    pages: [{ name: "A" }, { name: "Similar topics" }, { name: "Index/All" }],
    links: [{ page: "Similar topics", toPage: "A" }, { page: "Index/All", toPage: "A" }],
    tasks: [],
  }, cfg, "en", "2026-09-28");
  const byId = new Map(data.nodes.map((n) => [n.id, n]));
  assert.equal(byId.get("Similar topics")?.noCluster, true);
  assert.equal(byId.get("Index/All")?.noCluster, true);
  assert.equal(byId.get("A")?.noCluster, false);
});

test("timeline date: the date written in the page wins over the file time; a file stamp in `created` does not", () => {
  const cfg = normalizeConfig({});
  const data = buildGraphData("A", {
    pages: [
      { name: "A", lastModified: "2026-10-01T04:10:59", created: "2026-10-01T04:10:59", "создано": "2026-09-29" },
      { name: "B", lastModified: "2026-10-01T04:10:59", created: "2026-10-01T04:10:59" },
      { name: "C", lastModified: "2026-10-01T04:10:59", created: "2026-09-12" },
    ],
    links: [{ page: "A", toPage: "B" }, { page: "B", toPage: "C" }],
    tasks: [],
  }, cfg, "en", "2026-10-02");
  const by = new Map(data.nodes.map((n) => [n.id, n.date]));
  assert.equal(by.get("A"), "2026-09-29");
  assert.equal(by.get("B"), "2026-10-01");
  assert.equal(by.get("C"), "2026-09-12");
});
