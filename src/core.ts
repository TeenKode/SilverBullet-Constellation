// Constellation — the pure part: configuration, labels, task positions and graph data.
// No SilverBullet syscalls here, so it runs under `node --test` (tests/*.test.ts).

// ---------------------------------------------------------------- configuration
export interface GroupDef {
  id: string;
  name?: string;               // legend label (plural)
  one?: string;                // card label (singular)
  prefix?: string | string[];  // page name prefixes, e.g. "Projects/"
  pages?: string[];            // exact page names, e.g. ["index"]
  color?: string;              // light theme color
  darkColor?: string;          // dark theme color
  hidden?: boolean;            // hidden by default (the legend chip turns it on)
  undated?: boolean;           // not affected by the timeline (people, service pages)
}

export interface Config {
  language: string;                       // "auto" | "en" | "ru"
  groups: GroupDef[] | null;              // null — one group per top-level folder
  taskLinks: Record<string, string>;      // task attribute → page prefix: [who: Ann] links the page to "People/Ann"
  dueAttributes: string[];                // task attributes holding a due date (overdue ring)
  upcoming: { attribute: string; days: number; prefix: string; mirror: string } | null;
  exclude: string[];                      // pages never shown: "Folder/" prefixes or exact names
  dateAttributes: string[];               // page attributes holding the date the page was made (timeline); then the modified time
  noConstellations: string[];             // pages shown, but kept out of constellations (hubs): "Folder/" prefixes or exact names
  openOnStart: boolean;                   // default for "open the graph when the space opens on the start page"
  startPage: string;
  homeLabel: string;
  extraCss: string;                       // extra CSS for the panel, e.g. styles of your widgets shown in the card
  similarity: boolean;                    // read page texts to find pages about the same thing (nebulae); false — links only
  similarityMaxPages: number;             // more pages than this — texts are not read
}

export const DEFAULT_EXCLUDE = ["Library/", "Repositories/", "_", "PLUGS", "SETTINGS", "CONFIG", "SECRETS"];

export function normalizeConfig(raw: unknown): Config {
  const c = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;
  const list = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x) => typeof x === "string") : typeof v === "string" ? [v] : [];
  const up = c.upcoming === false ? null : { attribute: "date", days: 14, prefix: "", mirror: "", ...(c.upcoming || {}) };
  const groups = Array.isArray(c.groups)
    ? c.groups.filter((g: any) => g && typeof g.id === "string" && g.id).map((g: any) => ({ ...g }))
    : null;
  return {
    language: typeof c.language === "string" ? c.language : "auto",
    groups,
    taskLinks: c.taskLinks && typeof c.taskLinks === "object" ? { ...c.taskLinks } : {},
    dueAttributes: c.dueAttributes ? list(c.dueAttributes) : ["due", "deadline"],
    upcoming: up && up.attribute ? { ...up, days: Number(up.days) || 14 } : null,
    exclude: DEFAULT_EXCLUDE.concat(list(c.exclude)),
    noConstellations: list(c.noConstellations),
    dateAttributes: [...list(c.dateAttribute), "created", "создано"],
    openOnStart: !!c.openOnStart,
    startPage: typeof c.startPage === "string" ? c.startPage : "index",
    homeLabel: typeof c.homeLabel === "string" ? c.homeLabel : "",
    extraCss: typeof c.extraCss === "string" ? c.extraCss : "",
    similarity: c.similarity !== false,
    similarityMaxPages: Number(c.similarityMaxPages) > 0 ? Number(c.similarityMaxPages) : 1500,
  };
}


// ---------------------------------------------------------------- language
export type Lang = "en" | "ru";
export function resolveLang(setting: string, browser = typeof navigator !== "undefined" ? navigator.language : "en"): Lang {
  const v = (setting && setting !== "auto" ? setting : browser || "en").toLowerCase();
  return v.startsWith("ru") ? "ru" : "en";
}

export const TEXT = {
  en: {
    empty: "_none_",
    directiveFailed: "Could not render this block",
    noPosition: "this task has no position — tick it in the page itself",
    notFound: "page not found",
    moved: "the task has moved — reopen the card",
    home: "Home",
    week: (w: number) => `W${w}`,
    weekLong: (w: number, y: string) => `Week ${w}, ${y}`,
  },
  ru: {
    empty: "_нет_",
    directiveFailed: "Не удалось показать вставку",
    noPosition: "у задачи нет места в заметке — отметьте её в самой заметке",
    notFound: "страница не найдена",
    moved: "задача сдвинулась — откройте карточку заново",
    home: "Главная",
    week: (w: number) => `нед. ${w}`,
    weekLong: (w: number, y: string) => `Неделя ${w}, ${y}`,
  },
};
const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// ---------------------------------------------------------------- groups and labels
const PALETTE: [string, string][] = [
  ["#3b82f6", "#60a5fa"], ["#f59e0b", "#fbbf24"], ["#ec4899", "#f472b6"], ["#22c55e", "#4ade80"],
  ["#14b8a6", "#2dd4bf"], ["#ef4444", "#f87171"], ["#6366f1", "#818cf8"], ["#84cc16", "#a3e635"],
  ["#06b6d4", "#22d3ee"], ["#d946ef", "#e879f9"],
];
const OTHER_COLOR: [string, string] = ["#8b5cf6", "#a78bfa"];

const prefixesOf = (g: GroupDef) => (Array.isArray(g.prefix) ? g.prefix : g.prefix ? [g.prefix] : []);

export function groupOf(name: string, groups: GroupDef[] | null): string {
  if (!groups) return name.includes("/") ? name.slice(0, name.indexOf("/")) : "other";
  for (const g of groups) {
    if (g.pages?.includes(name) || prefixesOf(g).some((p) => name.startsWith(p))) return g.id;
  }
  return "other";
}

export type ResolvedGroup = {
  id: string; name: string; one: string; light: string; dark: string; hidden: boolean; undated: boolean;
};

// Groups for the renderer: configured ones (with "other" where the config puts it, else last),
// or one per top-level folder, alphabetically
export function resolveGroups(cfg: Config, names: string[], lang: Lang): ResolvedGroup[] {
  const otherName = lang === "ru" ? ["Другое", "Страница"] : ["Other", "Page"];
  let defs: GroupDef[];
  if (cfg.groups) {
    defs = cfg.groups.slice();
  } else {
    const folders = Array.from(new Set(names.filter((n) => n.includes("/")).map((n) => n.slice(0, n.indexOf("/"))))).sort();
    defs = folders.map((f) => ({ id: f, name: f, prefix: f + "/" }));
  }
  if (!defs.some((g) => g.id === "other")) defs.push({ id: "other" });
  let colorIndex = 0;
  return defs.map((g) => {
    const [light, dark] = g.id === "other" && !g.color ? OTHER_COLOR : PALETTE[colorIndex++ % PALETTE.length];
    return {
      id: g.id,
      name: g.name || (g.id === "other" ? otherName[0] : g.id),
      one: g.one || g.name || (g.id === "other" ? otherName[1] : g.id),
      light: g.color || light,
      dark: g.darkColor || g.color || dark,
      hidden: !!g.hidden,
      undated: !!g.undated,
    };
  });
}

// Short node label: without folder; ISO dates and weeks — compact
export function labelOf(name: string, lang: Lang = "en", cfg?: Pick<Config, "startPage" | "homeLabel">): string {
  const leaf = name.includes("/") ? name.slice(name.lastIndexOf("/") + 1) : name;
  const day = leaf.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (day) return lang === "ru" ? `${day[3]}.${day[2]}` : `${MONTHS_EN[Number(day[2]) - 1]} ${Number(day[3])}`;
  const week = leaf.match(/^\d{4}-W(\d{2})$/);
  if (week) return TEXT[lang].week(Number(week[1]));
  if (name === (cfg?.startPage ?? "index")) return cfg?.homeLabel || TEXT[lang].home;
  return leaf;
}

// Page title in lists: "Journal/2026-09-28" → "28.09.2026" / "Sep 28, 2026"
export function pageTitle(name: string, lang: Lang = "en"): string {
  const leaf = name.includes("/") ? name.slice(name.lastIndexOf("/") + 1) : name;
  const day = leaf.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (day) return lang === "ru" ? `${day[3]}.${day[2]}.${day[1]}` : `${MONTHS_EN[Number(day[2]) - 1]} ${Number(day[3])}, ${day[1]}`;
  const week = leaf.match(/^(\d{4})-W(\d{2})$/);
  if (week) return TEXT[lang].weekLong(Number(week[2]), week[1]);
  return leaf.replace(/[\[\]|]/g, "");
}

export function inList(name: string, list: string[]): boolean {
  return list.some((p) => (p.endsWith("/") || p === "_" ? name.startsWith(p) : name === p));
}

export function isExcluded(name: string, cfg: Pick<Config, "exclude">): boolean {
  return inList(name, cfg.exclude);
}

// Task attribute values: "Ann, Bob" / "Мария и Олег" → ["Ann", "Bob"]
export function splitNames(value: unknown): string[] {
  const list = Array.isArray(value) ? value : [value];
  return list.flatMap((w) => (typeof w === "string" ? w.split(/\s*(?:[,;]|\s(?:и|and)\s)\s*/) : []))
    .map((w) => w.trim()).filter(Boolean);
}

export function isPageLink(name: string): boolean {
  if (name.startsWith("http://") || name.startsWith("https://")) return false;
  return !/\.(png|jpg|jpeg|gif|svg|webp|pdf|mp3|wav|ogg|mp4|ics|txt)$/i.test(name);
}


// ---------------------------------------------------------------- page preview helpers
// markdownToHtml does not evaluate ${…} expressions (queries, widgets) — we evaluate them ourselves.
// Returns the expression spans; fenced code blocks are skipped.
export function findDirectives(text: string): { start: number; end: number; expr: string }[] {
  const out: { start: number; end: number; expr: string }[] = [];
  let i = 0;
  while (i < text.length) {
    if (text.startsWith("```", i) && (i === 0 || text[i - 1] === "\n")) {
      const close = text.indexOf("\n```", i + 3);
      if (close < 0) break;
      i = close + 4;
      continue;
    }
    if (text.startsWith("${", i)) {
      let depth = 1, j = i + 2;
      while (j < text.length && depth > 0) {
        if (text[j] === "{") depth++;
        else if (text[j] === "}") depth--;
        j++;
      }
      if (depth === 0) {
        out.push({ start: i, end: j, expr: text.slice(i + 2, j - 1).trim() });
        i = j;
        continue;
      }
    }
    i++;
  }
  return out;
}

// Expression result → Markdown; widget HTML goes into CNWIDGET<n>END markers, substituted after rendering
export function valueToMarkdown(value: unknown, widgets: string[], lang: Lang = "en"): string {
  if (value === null || value === undefined) return "";
  if (typeof value !== "object") return String(value);
  if (Array.isArray(value)) {
    if (!value.length) return TEXT[lang].empty;
    const parts = value.map((v) => valueToMarkdown(refOrValue(v, lang), widgets, lang));
    return parts.every((p) => p.endsWith("\n")) ? parts.join("") : parts.join("\n");
  }
  const obj = value as Record<string, unknown>;
  if (typeof obj.html === "string") {
    widgets.push(obj.html);
    return `\n\nCNWIDGET${widgets.length - 1}END\n\n`;
  }
  if (typeof obj.markdown === "string") return obj.markdown;
  const ref = refOrValue(obj, lang);
  return typeof ref === "string" ? ref : "";
}

function refOrValue(v: unknown, lang: Lang): unknown {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    if (typeof o.html === "string" || typeof o.markdown === "string") return v;
    const target = o.ref ?? o.name;
    if (typeof target === "string") return `* [[${target}|${pageTitle(target, lang)}]]`;
  }
  return v;
}


// A task line: "- [ ] …", "* [x] …", "1. [ ] …" (indented — nested)
export const TASK_LINE = /^([ \t]*)((?:[-*+]|\d+[.)]) \[)( |x|X)\]/;

// Where the page's own tasks start (like SilverBullet: "Page@pos" — the start of "- [ ]").
// Tasks inside code blocks and ${…} expressions do not count: markdownToHtml does not render them as tasks.
export function taskOffsets(text: string, from = 0): number[] {
  const skip = findDirectives(text).filter((d) => d.start >= from);
  const out: number[] = [];
  let pos = 0, fence = false;
  for (const line of text.split("\n")) {
    if (/^\s*```/.test(line)) fence = !fence;
    else if (!fence && pos >= from) {
      const m = line.match(TASK_LINE);
      if (m && !skip.some((d) => pos >= d.start && pos < d.end)) out.push(pos + m[1].length);
    }
    pos += line.length + 1;
  }
  return out;
}

// Where in the file the task referenced by "@pos" or "@L<line>C<column>" starts.
// SilverBullet (and preview below) counts positions in text with LF line breaks, while the file may use CRLF
// (pages written on Windows) — the position is mapped back to the file.
export function findTaskStart(text: string, spec: string): number {
  const lc = spec.match(/^L(\d+)(?:C(\d+))?$/);
  if (!/^\d+$/.test(spec) && !lc) return -1;
  let pos = Number(spec);
  if (lc) {
    const lines = text.replace(/\r\n/g, "\n").split("\n").slice(0, Number(lc[1]) - 1);
    pos = lines.reduce((n, l) => n + l.length + 1, 0) + Math.max(0, Number(lc[2] ?? 1) - 1);
  }
  let raw = 0;
  for (let seen = 0; raw < text.length && seen < pos; raw++) {
    if (!(text[raw] === "\r" && text[raw + 1] === "\n")) seen++;
  }
  if (raw > text.length) return -1;
  const start = text.lastIndexOf("\n", raw - 1) + 1;
  const end = text.indexOf("\n", start);
  const m = text.slice(start, end < 0 ? text.length : end).match(TASK_LINE);
  // the position must be at the start of a task (from the line start up to "["), not somewhere in its text
  return m && raw <= start + m[1].length + m[2].length ? start : -1;
}

// The new text of a page after ticking (done) or unticking the task at `spec`; null if there is no task there
export function setTaskState(text: string, spec: string, done: boolean): string | null {
  const start = findTaskStart(text, spec);
  if (start < 0) return null;
  const end = text.indexOf("\n", start);
  const m = text.slice(start, end < 0 ? text.length : end).match(TASK_LINE)!;
  if ((m[3] !== " ") === done) return text;
  const at = start + m[1].length + m[2].length;
  return text.slice(0, at) + (done ? "x" : " ") + text.slice(at + 1);
}


// ---------------------------------------------------------------- graph data
export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function weekMonday(year: number, week: number): string {
  const jan4 = new Date(year, 0, 4);
  const monday = new Date(year, 0, 4 - ((jan4.getDay() + 6) % 7) + (week - 1) * 7);
  return isoDate(monday);
}
// Node date for the timeline: a page named by a date — that day, by an ISO week — its Monday,
// otherwise — the date written in the page (`created:`, see `dateAttribute`), otherwise when it was last modified; undated groups — none
export function nodeDate(name: string, lastModified: unknown, undated = false, created: unknown = ""): string {
  const leaf = name.slice(name.lastIndexOf("/") + 1);
  const day = leaf.match(/^\d{4}-\d{2}-\d{2}$/);
  if (day) return day[0];
  const w = leaf.match(/^(\d{4})-W(\d{2})$/);
  if (w) return weekMonday(Number(w[1]), Number(w[2]));
  if (undated) return "";
  const own = String(created ?? "").match(/^\d{4}-\d{2}-\d{2}/);
  if (own) return own[0];
  const s = String(lastModified ?? "");
  const d = s.match(/^\d{4}-\d{2}-\d{2}/) ? new Date(s) : typeof lastModified === "number" ? new Date(lastModified) : null;
  return d && !isNaN(d.getTime()) ? isoDate(d) : "";
}
// A day (2026-09-28) or a week (2026-W39) page
export const isPeriodic = (name: string) => /^\d{4}-(\d{2}-\d{2}|W\d{2})$/.test(name.slice(name.lastIndexOf("/") + 1));
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + "T12:00:00") - Date.parse(a + "T12:00:00")) / 86400000);

export type GraphNode = {
  id: string; group: string; label: string; isCurrent: boolean; isOrphan: boolean;
  date: string; overdue: number; soon: number | null; soonVia: string;
  periodic: boolean;             // a day or a week summary: not clustered, not compared by text
  noCluster: boolean;            // listed in `noConstellations`: shown, but never in a constellation
};

export type IndexObjects = { links: any[]; pages: any[]; tasks: any[] };

// Pure part (unit-tested): index objects → nodes, edges and groups for the renderer
export function buildGraphData(currentPage: string, objects: IndexObjects, cfg: Config, lang: Lang,
  today = isoDate(new Date())) {
  const pageNames = objects.pages.map((p) => p.name ?? p.ref).filter((n: unknown): n is string => typeof n === "string");
  const groups = resolveGroups(cfg, pageNames.filter((n) => !isExcluded(n, cfg)), lang);
  const undated = new Set(groups.filter((g) => g.undated).map((g) => g.id));
  const nodes = new Map<string, GraphNode>();
  const edges: { source: string; target: string }[] = [];
  const seen = new Set<string>();
  const info = new Map<string, { date: string; soon: number | null; soonVia: string }>();
  const overdue = new Map<string, number>();
  const addNode = (id: string) => {
    if (!nodes.has(id)) {
      const extra = info.get(id);
      nodes.set(id, {
        id, group: groupOf(id, cfg.groups), label: labelOf(id, lang, cfg), isCurrent: id === currentPage, isOrphan: false,
        date: extra?.date ?? "", overdue: overdue.get(id) ?? 0, soon: extra?.soon ?? null, soonVia: extra?.soonVia ?? "",
        periodic: isPeriodic(id), noCluster: inList(id, cfg.noConstellations),
      });
    }
  };
  const addEdge = (source: string, target: string) => {
    if (!source || !target || source === target) return;
    if (!isPageLink(source) || !isPageLink(target) || isExcluded(source, cfg) || isExcluded(target, cfg)) return;
    addNode(source);
    addNode(target);
    const key = source < target ? `${source}\u0000${target}` : `${target}\u0000${source}`;
    if (!seen.has(key)) {
      seen.add(key);
      edges.push({ source, target });
    }
  };
  const names = new Set<string>();
  const up = cfg.upcoming;
  for (const page of objects.pages) {
    const name = page.name ?? page.ref;
    if (!name) continue;
    names.add(name);
    let soon: number | null = null;
    // a page dated within the next N days (an event) gets "in N days"
    const when = up ? String(page[up.attribute] ?? "").match(/^\d{4}-\d{2}-\d{2}/) : null;
    if (up && when && (!up.prefix || name.startsWith(up.prefix))) {
      const days = daysBetween(today, when[0]);
      if (days >= 0 && days <= up.days) soon = days;
    }
    // a plain date only: SilverBullet's own `created` is a time stamp of the file
    const written = cfg.dateAttributes.map((k) => page[k]).find((v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v));
    info.set(name, { date: nodeDate(name, page.lastModified, undated.has(groupOf(name, cfg.groups)), written), soon, soonVia: "" });
  }
  // "mirror": the page with the same name under another prefix (an event's topic) gets the mark too
  if (up && up.prefix && up.mirror) {
    for (const [name, x] of info) {
      if (x.soon === null || !name.startsWith(up.prefix) || x.soonVia) continue;
      const twin = info.get(up.mirror + name.slice(up.prefix.length));
      if (twin && (twin.soon === null || x.soon < twin.soon)) {
        twin.soon = x.soon;
        twin.soonVia = name;
      }
    }
  }
  // overdue tasks: not done, due date before today
  for (const task of objects.tasks) {
    if (task.done || !task.page) continue;
    for (const key of cfg.dueAttributes) {
      const due = String(task[key] ?? "").match(/^\d{4}-\d{2}-\d{2}/);
      if (due && due[0] < today) {
        overdue.set(task.page, (overdue.get(task.page) ?? 0) + 1);
        break;
      }
    }
  }
  for (const link of objects.links) addEdge(link.page, link.toPage);
  // task attributes as links: [who: Ann] + taskLinks {who = "People/"} → the task's page — "People/Ann"
  for (const task of objects.tasks) {
    for (const [attr, prefix] of Object.entries(cfg.taskLinks)) {
      for (const value of splitNames(task[attr])) {
        if (names.has(prefix + value)) addEdge(task.page, prefix + value);
      }
    }
  }
  const linked = new Set(Array.from(nodes.keys()));
  for (const name of names) {
    if (isPageLink(name) && !isExcluded(name, cfg)) addNode(name);
  }
  if (currentPage) addNode(currentPage);
  for (const node of nodes.values()) node.isOrphan = !linked.has(node.id);
  return {
    nodes: Array.from(nodes.values()), edges, today, groups,
    dueAttributes: cfg.dueAttributes, linkAttributes: Object.keys(cfg.taskLinks),
  };
}
