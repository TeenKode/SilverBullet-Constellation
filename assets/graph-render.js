// Constellation — the graph renderer, runs inside a SilverBullet panel (iframe).
// Based on Atlas (MIT, © 2026 Selçuk Öztürk). Expects:
//   window.__CN_DATA__ = { nodes: [{id, group, label, isCurrent, isOrphan, date, overdue, soon, soonVia}],
//                          edges: [{source, target}], groups: [...], today, dueAttributes, linkAttributes }
//   window.__CN_DARK__, window.__CN_OPTIONS__ — settings (see DEFAULTS), window.__CN_LANG__ — "en" | "ru"
//   window.__CN_VIEW__ = "full" (full screen, click — card) | "side" (right panel, click — navigate)
//
// Nodes are alive, like in Obsidian: they gently drift, neighbours follow a dragged node,
// the rest push away. Yet the layout never “jumps”: positions of all nodes are kept
// in localStorage, and every open and navigation continues from the same place.
(function () {
  "use strict";

  // Panel refreshes do not recreate the iframe, they re-run the script:
  // the previous run saves node positions and removes its listeners
  for (const off of window.__CN_CLEANUP__ || []) {
    try { off(); } catch (_e) { /* already removed */ }
  }
  const cleanup = (window.__CN_CLEANUP__ = []);
  const listen = (target, type, fn) => {
    target.addEventListener(type, fn);
    cleanup.push(() => target.removeEventListener(type, fn));
  };

  const DEFAULTS = {
    mode: "all", hidden: [], showOrphans: false, startWithGraph: false,
    motion: "float",          // float — drift; calm — physics only while dragging; still — no motion
    repel: 50,                // repulsion, 0–100
    linkDistance: 70,         // link length, px
    nodeSize: 100,            // node size, %
    linkWidth: 100,           // link width, %
    labels: "smart",          // smart — important ones; all — every node; hover — on hover only
    labelOpacity: 55,         // label brightness at rest, %
    labelSize: 100,           // label size, %
    colors: {},               // custom group colors
    period: 0,                // timeline: show pages from the last N days (0 — all time)
    freshBright: true,        // recent pages brighter, older ones fade
    marks: true,              // a ring on pages with overdue tasks, “in N days” on upcoming events
  };
  const SETTING_KEYS = ["motion", "repel", "linkDistance", "nodeSize", "linkWidth", "labels", "labelOpacity", "labelSize",
    "colors", "freshBright", "marks"];

  const LANG = window.__CN_LANG__ === "ru" ? "ru" : "en";
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const I18N = {
    en: {
      title: "Graph", all: ["All", "Show all pages and links"], near: ["Nearby", "Only pages within two steps of the selected one"],
      orphans: ["Orphans", "Show pages without links"], search: "Search…", fit: "Fit the graph to the window",
      settings: "Graph settings", closeGraph: "Close the graph (Esc)", timeline: "Timeline: which pages to show",
      since: (d) => `since ${d}`, allTime: "All time", allTimeHint: "Click to show all time", show: "Show", hide: "Hide",
      empty: "No linked pages yet", close: "Close (Esc)", closeShort: "Close", linked: "Linked", openPage: "Open page",
      missing: "This page does not exist yet — it is only linked to.", emptyPage: "Empty page",
      imageMissing: "[image unavailable]", tick: "Mark as done", untick: "Mark as not done",
      tickFailed: "Could not update the task", today: "today", tomorrow: "tomorrow", inDays: (n) => `in ${n} days`,
      eventSoon: (s) => `event ${s}`, overdue: (n) => `overdue tasks: ${n}`, due: (d) => `due ${d}`, dueTitle: "Due",
      week: (w, y) => `Week ${w}, ${y}`,
      motion: "Motion", nodes: "Nodes",
      float: ["Float", "Nodes gently drift and push each other apart, like in Obsidian"],
      calm: ["Calm", "Physics runs while you drag a node, then the graph freezes"],
      still: ["Still", "Nodes stay where they are; dragging moves only the node itself"],
      repel: "Repulsion", linkDistance: "Link length", look: "Look", nodeSize: "Node size", linkWidth: "Link width",
      labels: "Labels", showLabels: "Show",
      smart: ["Important", "The most linked pages and neighbours of the selected one"],
      allLabels: ["All", "Labels on every node"], hover: ["On hover", "Only the hovered node and its neighbours"],
      labelOpacity: "Brightness at rest", labelSize: "Size", colors: "Group colors", other: "Other",
      fresh: ["Recent pages brighter", "Pages from the last week are bright, older ones fade"],
      marks: ["Marks: overdue tasks and upcoming events", "A red ring on pages with overdue tasks, “in N days” on upcoming events"],
      start: ["Open the graph when the space opens", "Show the full-screen graph instead of the start page when the space opens"],
      relayout: ["↻ Re-layout", "Lay out all nodes from scratch"], reset: ["Reset settings", "Restore the default settings"],
    },
    ru: {
      title: "Граф связей", all: ["Вся база", "Показать все страницы и связи"], near: ["Рядом", "Только страницы в двух шагах от выбранной"],
      orphans: ["Без связей", "Показать страницы без ссылок"], search: "Поиск…", fit: "Вписать граф в окно",
      settings: "Настройки графа", closeGraph: "Закрыть граф (Esc)", timeline: "Лента времени: какие страницы показывать",
      since: (d) => `с ${d}`, allTime: "Всё время", allTimeHint: "Нажмите — показать всё время", show: "Показать", hide: "Скрыть",
      empty: "В базе пока нет страниц со ссылками", close: "Закрыть (Esc)", closeShort: "Закрыть", linked: "Связано",
      openPage: "Открыть заметку", missing: "Страница ещё не создана — на неё только ссылаются.", emptyPage: "Пустая страница",
      imageMissing: "[изображение недоступно]", tick: "Отметить выполненной", untick: "Снять отметку",
      tickFailed: "Не удалось отметить задачу", today: "сегодня", tomorrow: "завтра", inDays: (n) => `через ${n} дн.`,
      eventSoon: (s) => `мероприятие ${s}`, overdue: (n) => `просрочено задач: ${n}`, due: (d) => `до ${d}`, dueTitle: "Срок",
      week: (w, y) => `Неделя ${w}, ${y}`,
      motion: "Движение", nodes: "Узлы",
      float: ["Плавают", "Узлы плавно покачиваются и расталкивают друг друга, как в Obsidian"],
      calm: ["Спокойно", "Физика работает, пока тянете узел, потом граф замирает"],
      still: ["Неподвижно", "Узлы стоят, где лежат; перетаскивание двигает только сам узел"],
      repel: "Отталкивание", linkDistance: "Длина связей", look: "Вид", nodeSize: "Размер узлов", linkWidth: "Толщина связей",
      labels: "Подписи", showLabels: "Показывать",
      smart: ["Важные", "Самые связанные страницы и соседи выбранной"],
      allLabels: ["Все", "Подписи у всех узлов"], hover: ["При наведении", "Только у наведённого узла и его соседей"],
      labelOpacity: "Яркость в покое", labelSize: "Размер", colors: "Цвета разделов", other: "Прочее",
      fresh: ["Свежие страницы ярче", "Страницы за последнюю неделю — ярко, давние — бледнее"],
      marks: ["Отметки: просроченные задачи и ближайшие мероприятия", "Красное кольцо у страниц с просроченными задачами, «через N дн.» у ближайших мероприятий"],
      start: ["Открывать граф при запуске базы", "Показывать граф на весь экран вместо главной страницы при открытии базы"],
      relayout: ["↻ Разложить заново", "Разложить все узлы заново"], reset: ["Сбросить настройки", "Вернуть настройки по умолчанию"],
    },
  };
  const T = I18N[LANG];

  const all = window.__CN_DATA__ || { nodes: [], edges: [] };
  const VIEW = window.__CN_VIEW__ === "full" ? "full" : "side";
  const options = Object.assign({}, DEFAULTS, window.__CN_OPTIONS__ || {});
  options.colors = Object.assign({}, options.colors || {});
  document.body.classList.toggle("cn-full", VIEW === "full");

  const sbTheme = document.documentElement.getAttribute("data-theme");
  if (!sbTheme) document.documentElement.setAttribute("data-theme", window.__CN_DARK__ ? "dark" : "light");
  let isDark = document.documentElement.getAttribute("data-theme") === "dark";
  const v = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  // Groups and their colors (light / dark theme) — resolved by the plug from the configuration
  const GROUPS = (all.groups && all.groups.length ? all.groups : [])
    .map((g) => ({ id: g.id, name: g.name, one: g.one, light: g.light, dark: g.dark }));
  if (!GROUPS.some((g) => g.id === "other")) GROUPS.push({ id: "other", name: "Other", one: "Page", light: "#8b5cf6", dark: "#a78bfa" });
  const DUE_KEYS = new Set(all.dueAttributes || ["due", "deadline"]);
  const ATTR_KEYS = Array.from(new Set([...DUE_KEYS, ...(all.linkAttributes || [])]));
  const groupById = {};
  for (const g of GROUPS) groupById[g.id] = g;
  const defaultColor = (id) => (isDark ? groupById[id].dark : groupById[id].light);
  const groupColor = {};
  function updateColors() {
    for (const g of GROUPS) groupColor[g.id] = options.colors[g.id] || defaultColor(g.id);
  }
  updateColors();
  const colorOf = (n) => groupColor[n.group] || groupColor.other;

  const palette = {};
  function readPalette() {
    Object.assign(palette, {
      bg: v("--cn-bg"), edge: v("--cn-edge"), edgeHi: v("--cn-edge-hi"), label: v("--cn-label"), ring: v("--cn-ring"),
    });
  }
  readPalette();

  // SilverBullet switches the theme without restarting the panel (data-theme attribute) — recolor ourselves
  const themeWatch = new MutationObserver(() => {
    const dark = document.documentElement.getAttribute("data-theme") === "dark";
    if (dark === isDark) return;
    isDark = dark;
    readPalette();
    updateColors();
    drawLegend();
    if (nodeSel) nodeSel.selectAll("text").attr("stroke", palette.bg);
    restyle();
    if (settingsPanel.classList.contains("open")) renderSettings();
  });
  themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  cleanup.push(() => themeWatch.disconnect());

  const store = {
    get(key, fallback) {
      try {
        let raw = localStorage.getItem(key);
        if (raw === null && LEGACY[key]) raw = localStorage.getItem(LEGACY[key]);
        return raw ? JSON.parse(raw) : fallback;
      } catch (_e) {
        return fallback;
      }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch (_e) { /* not remembered */ }
    },
  };
  // Several spaces (multi-user SilverBullet) share one origin and one localStorage — each keeps its own layout.
  // The space is taken from the SilverBullet address (<base> of the panel): "/team-a/"; a single space — "/".
  const SPACE = (() => {
    try {
      return new URL(document.baseURI).pathname.replace(/\/+$/, "");
    } catch (_e) {
      return "";
    }
  })();
  const spaceKey = (key) => (SPACE ? `${key}:${SPACE}` : key);
  // v2 — связи разной длины и простор для подписей (1.1): прежняя раскладка v1 не берётся, граф раскладывается заново
const LAYOUT_KEY = spaceKey("constellation.layout.v3");
  const VIEW_KEY = spaceKey("constellation.view." + VIEW);
  // saved by the plug's previous name (observergraph) — picked up once, then saved under the new keys
  const LEGACY = {
    [VIEW_KEY]: spaceKey("observerGraph.view." + VIEW),
  };

  const call = (fn, ...args) => {
    try {
      return Promise.resolve(syscall("system.invokeFunction", "constellation." + fn, ...args));
    } catch (e) {
      return Promise.reject(e);
    }
  };
  const saveOption = (key, value) => call("setOption", key, value).catch(() => { /* not remembered */ });

  // ---------------------------------------------------------------- links of the whole space
  // Full screen the graph is the main view and the page below is not highlighted; in the side panel it is
  if (VIEW === "full") for (const n of all.nodes) n.isCurrent = false;
  const nodeById = new Map(all.nodes.map((n) => [n.id, n]));
  const adjacency = new Map(all.nodes.map((n) => [n.id, new Set()]));
  for (const e of all.edges) {
    if (!adjacency.has(e.source) || !adjacency.has(e.target)) continue;
    adjacency.get(e.source).add(e.target);
    adjacency.get(e.target).add(e.source);
  }
  const degree = (id) => (adjacency.get(id) ? adjacency.get(id).size : 0);
  const current = all.nodes.find((n) => n.isCurrent) || null;
  const degs = all.nodes.filter((n) => !n.isOrphan).map((n) => degree(n.id)).sort((a, b) => b - a);
  const labelLimit = Math.max(3, degs[Math.floor(degs.length * 0.2)] || 0);
  // Node rank by link count (0 — the most linked): when zoomed out only the first ones get labels
  const rankOf = new Map(all.nodes.slice()
    .sort((a, b) => degree(b.id) - degree(a.id) || (a.id < b.id ? -1 : 1))
    .map((n, i) => [n.id, i]));

  // Radius — by links in the whole space, not in the visible part: filters do not resize nodes
  const baseRadius = (n) => Math.min(14, 4 + Math.sqrt(degree(n.id)) * 1.8) * options.nodeSize / 100;
  const radius = (d) => baseRadius(d) + (d.isCurrent || d.id === selected ? 3 : 0);

  // Forces get weaker as the graph grows, so a big graph does not fly apart
  function forceScale(count) {
    return count > 300 ? 0.35 : count > 150 ? 0.5 : count > 60 ? 0.75 : 1;
  }
  const chargeOf = (count) => -(20 + options.repel * 5) * forceScale(count);
  const distanceOf = (count) => options.linkDistance * (0.6 + 0.4 * forceScale(count));

  // Links of different length: a link to a “hub” (a page with many links — a day summary, a person) is longer,
  // so its neighbours spread around it in a wide ring instead of a tight clump where labels overlap.
  // Leaf-to-leaf links stay short, and closely related pages stay close.
  const endId = (e) => (typeof e === "object" ? e.id : e);
  // The ring around a hub must hold its neighbours' labels: its circumference grows with the number of neighbours
  // (~one label width, 90 px, per neighbour), so the link length grows almost linearly with the hub's degree.
  function linkSpread(l) {
    const hub = Math.max(degree(endId(l.source)), degree(endId(l.target)));
    return Math.min(4.5, Math.max(0.75 + 0.3 * Math.sqrt(hub), hub * 90 / (2 * Math.PI) / 100));
  }
  // Room for the label: it hangs below the node, so the node needs space around it — half the label width,
  // not the whole of it (neighbouring labels are also moved apart by hiding overlaps, see cullLabels)
  const labelHalf = new Map(all.nodes.map((n) => [n.id,
    Math.max(...wrapLabel(truncate(n.label || n.id, 60)).map((l) => l.length)) * 6.5 * options.labelSize / 100 / 2]));
  const labelRoom = (id) => Math.min(34, (labelHalf.get(id) || 0) * 0.55);

  // The same forces for the initial layout and the live physics: otherwise the graph would
  // “drift” to another equilibrium after opening
  function applyForceSet(simulation, links, count, cx, cy, radiusOf) {
    return simulation
      .force("link", d3.forceLink(links).id((d) => d.id).distance((l) => distanceOf(count) * linkSpread(l)))
      .force("charge", d3.forceManyBody().strength(chargeOf(count)).distanceMax(600))
      .force("x", d3.forceX(cx).strength(0.03))
      .force("y", d3.forceY(cy).strength(0.03))
      .force("collide", d3.forceCollide().radius((d) => radiusOf(d) + 6 + labelRoom(d.id)).strength(0.9).iterations(2));
  }

  // ---------------------------------------------------------------- layout (one for the whole space)
  function hash01(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return ((h >>> 0) % 100000) / 100000;
  }

  // Nodes with a saved position stay put; new ones are placed next to their neighbours
  function computeLayout(reset) {
    const saved = reset ? {} : store.get(LAYOUT_KEY, {});
    const nodes = all.nodes.map((n) => ({ id: n.id, r: baseRadius(n) }));
    const byId = new Map(nodes.map((n) => [n.id, n]));
    let known = 0, cx = 0, cy = 0;
    for (const n of nodes) {
      const p = saved[n.id];
      if (p) {
        n.x = n.fx = p[0];
        n.y = n.fy = p[1];
        cx += p[0]; cy += p[1]; known++;
      }
    }
    const fresh = nodes.filter((n) => n.fx === undefined);
    if (fresh.length) {
      if (known) { cx /= known; cy /= known; }
      let extent = 0;
      for (const n of nodes) if (n.fx !== undefined) extent = Math.max(extent, Math.hypot(n.x - cx, n.y - cy));
      for (const n of fresh) {
        const angle = hash01(n.id) * Math.PI * 2;
        const placed = Array.from(adjacency.get(n.id) || []).map((id) => byId.get(id)).filter((m) => m && m.fx !== undefined);
        if (placed.length) {
          n.x = placed.reduce((s, m) => s + m.x, 0) / placed.length + Math.cos(angle) * 40;
          n.y = placed.reduce((s, m) => s + m.y, 0) / placed.length + Math.sin(angle) * 40;
        } else if (known) {
          n.x = cx + Math.cos(angle) * (extent + 60);
          n.y = cy + Math.sin(angle) * (extent + 60);
        }
      }
      const count = nodes.length;
      const edges = all.edges.filter((e) => byId.has(e.source) && byId.has(e.target)).map((e) => ({ source: e.source, target: e.target }));
      const sim = applyForceSet(d3.forceSimulation(nodes).stop(), edges, count, known ? cx : 0, known ? cy : 0, (d) => d.r);
      if (known) sim.alpha(0.5);
      const steps = known ? 160 : 320;
      for (let i = 0; i < steps; i++) sim.tick();
    }
    const out = {};
    for (const n of nodes) out[n.id] = [Math.round(n.x * 10) / 10, Math.round(n.y * 10) / 10];
    store.set(LAYOUT_KEY, out);   // deleted pages drop out of the saved layout by themselves
    return out;
  }

  let positions = computeLayout(false);

  // Timeline: pages without a date (undated groups) are always shown
  const TODAY = all.today || new Date().toISOString().slice(0, 10);
  const dayMs = 86400000;
  const ageDays = (date) => Math.round((Date.parse(TODAY + "T12:00:00") - Date.parse(date + "T12:00:00")) / dayMs);
  const shiftDate = (days) => new Date(Date.parse(TODAY + "T12:00:00") - days * dayMs).toISOString().slice(0, 10);
  const inPeriod = (n) => !options.period || !n.date || ageDays(n.date) <= options.period;
  // recent ones brighter: full brightness up to a week, fading towards four months
  const freshness = (d) => {
    if (!options.freshBright || !d.date) return 1;
    const age = ageDays(d.date);
    return age <= 7 ? 1 : Math.max(0.42, 1 - (age - 7) / 113 * 0.58);
  };

  // ---------------------------------------------------------------- skeleton
  const toolbar = document.getElementById("cn-toolbar");
  const legend = document.getElementById("cn-legend");
  const container = document.getElementById("cn-container");
  const card = document.getElementById("cn-card");
  const stage = document.getElementById("cn-stage");
  let settingsPanel = document.getElementById("cn-settings");
  if (!settingsPanel) {
    settingsPanel = document.createElement("div");
    settingsPanel.id = "cn-settings";
    stage.appendChild(settingsPanel);
  }
  let search = "";
  let selected = null;       // the page open in the card (full screen)
  let hovered = null;        // node under the pointer — in the graph or in the card
  let cardHover = false;     // highlight comes from the card — a pulsing ring around the node

  function button(text, title, onClick, cls) {
    const b = document.createElement("button");
    b.className = "cn-btn" + (cls ? " " + cls : "");
    b.textContent = text;
    b.title = title;
    b.addEventListener("click", onClick);
    toolbar.appendChild(b);
    return b;
  }
  if (VIEW === "full") {
    const title = document.createElement("span");
    title.className = "cn-title";
    title.textContent = T.title;
    toolbar.appendChild(title);
  }
  const allBtn = button(T.all[0], T.all[1], () => setMode("all"));
  const nearBtn = button(T.near[0], T.near[1], () => setMode("near"));
  const orphanBtn = button(T.orphans[0], T.orphans[1], () => {
    options.showOrphans = !options.showOrphans;
    saveOption("showOrphans", options.showOrphans);
    refresh(false);
  });
  const searchBox = document.createElement("input");
  searchBox.className = "cn-search";
  searchBox.placeholder = T.search;
  searchBox.addEventListener("input", () => { search = searchBox.value.trim().toLowerCase(); applyHighlight(); });
  searchBox.addEventListener("keydown", (e) => { if (e.key === "Enter") focusFirstMatch(); });
  toolbar.appendChild(searchBox);
  button("⤢", T.fit, () => fit(450, true));
  const settingsBtn = button("⚙", T.settings, () => toggleSettings());
  if (VIEW === "full") button("✕", T.closeGraph, () => call("closeGraph"), "cn-close");

  function setMode(mode) {
    options.mode = mode;
    saveOption("mode", mode);
    refresh(true);
  }

  // Legend: group chips (redrawn) and the timeline (built once — the slider is not reset under the pointer)
  legend.innerHTML = "";
  const chipsBox = document.createElement("span");
  chipsBox.className = "cn-chips";
  legend.appendChild(chipsBox);
  const timeBox = document.createElement("span");
  timeBox.className = "cn-time";
  legend.appendChild(timeBox);
  buildTimeline();

  // Timeline: the slider picks the first date to show (left — all time, right — the last days)
  function buildTimeline() {
    const ages = all.nodes.filter((n) => n.date).map((n) => ageDays(n.date)).filter((a) => a >= 0);
    const span = ages.length ? Math.max(...ages) : 0;
    if (span < 2) { timeBox.style.display = "none"; return; }
    timeBox.innerHTML = '<span class="cn-time-label"></span><input type="range" class="cn-time-range" min="0" step="1">';
    const range = timeBox.querySelector("input");
    const label = timeBox.querySelector(".cn-time-label");
    range.max = String(span);
    range.title = T.timeline;
    const fromValue = () => (Number(range.value) === 0 ? 0 : Math.max(1, span - Number(range.value)));
    const show = () => {
      const period = fromValue();
      label.textContent = period ? T.since(formatDate(shiftDate(period))) : T.allTime;
      timeBox.classList.toggle("active", !!period);
    };
    range.value = String(options.period ? Math.max(0, span - Math.min(options.period, span)) : 0);
    show();
    let frame = 0;
    range.addEventListener("input", () => {
      options.period = fromValue();
      show();
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; refresh(false); });
    });
    range.addEventListener("change", () => saveOption("period", options.period));
    label.addEventListener("click", () => {
      range.value = "0";
      options.period = 0;
      show();
      saveOption("period", 0);
      refresh(false);
    });
    label.title = T.allTimeHint;
  }

  function drawLegend() {
    const counts = {};
    for (const n of all.nodes) if (!n.isOrphan || options.showOrphans) counts[n.group] = (counts[n.group] || 0) + 1;
    chipsBox.innerHTML = "";
    for (const g of GROUPS) {
      if (!counts[g.id]) continue;
      const chip = document.createElement("span");
      const off = options.hidden.includes(g.id);
      chip.className = "cn-chip" + (off ? " off" : "");
      chip.title = off ? T.show : T.hide;
      chip.innerHTML = `<i style="background:${groupColor[g.id]}"></i>${esc(g.name)} <b>${counts[g.id]}</b>`;
      chip.addEventListener("click", () => {
        options.hidden = off ? options.hidden.filter((x) => x !== g.id) : options.hidden.concat([g.id]);
        saveOption("hidden", options.hidden);
        refresh(false);
      });
      chipsBox.appendChild(chip);
    }
  }

  // ---------------------------------------------------------------- what to show
  const focusId = () => selected || (current && current.id);

  // The node passes the filters (and is not shown only because it is open or selected)
  const passesFilters = (n) => !options.hidden.includes(n.group) && (options.showOrphans || !n.isOrphan);

  function visibleIds() {
    const keepAlways = new Set([current && current.id, selected].filter(Boolean));
    let ids = new Set(all.nodes.filter((n) => keepAlways.has(n.id) || (passesFilters(n) && inPeriod(n))).map((n) => n.id));
    const focus = focusId();
    if (options.mode === "near" && focus && ids.has(focus)) {
      const keep = new Set([focus]);
      let frontier = [focus];
      for (let step = 0; step < 2; step++) {
        const next = [];
        for (const id of frontier) for (const nb of adjacency.get(id) || []) if (ids.has(nb) && !keep.has(nb)) { keep.add(nb); next.push(nb); }
        frontier = next;
      }
      ids = keep;
    }
    return ids;
  }

  // ---------------------------------------------------------------- drawing and physics
  let svg, g, zoom, nodeSel, linkSel, pulse, sim = null, shown = [], shownLinks = [], currentScale = 1;
  let dragging = false;

  function size() {
    const r = container.getBoundingClientRect();
    const top = toolbar.offsetHeight + legend.offsetHeight;
    return {
      w: r.width > 10 ? r.width : window.innerWidth || 300,
      h: r.height > 10 ? r.height : Math.max(200, (window.innerHeight || 500) - top),
    };
  }

  // Current positions of the shown nodes → the shared layout (and localStorage)
  function syncPositions() {
    for (const d of shown) {
      if (Number.isFinite(d.x) && Number.isFinite(d.y)) positions[d.id] = [Math.round(d.x * 10) / 10, Math.round(d.y * 10) / 10];
    }
  }
  function savePositions() {
    syncPositions();
    store.set(LAYOUT_KEY, positions);
  }
  // restart — postpone again (after dragging); otherwise — at most once per ms (while nodes drift)
  let saveTimer = null;
  const scheduleSave = (ms, restart) => {
    if (saveTimer) {
      if (!restart) return;
      clearTimeout(saveTimer);
    }
    saveTimer = setTimeout(() => {
      saveTimer = null;
      savePositions();
    }, ms || 1500);
  };
  cleanup.push(() => {
    if (sim) sim.stop();
    clearTimeout(saveTimer);
    savePositions();
  });
  listen(window, "pagehide", savePositions);
  listen(document, "visibilitychange", () => {
    if (document.hidden) {
      savePositions();
      if (sim) sim.stop();
    } else startMotion(0);
  });

  // Drift: every node sways around its place (±3.5 px, its own phase and frequency).
  // It is an offset applied only when drawing — physics and the saved layout never see it,
  // so the graph cannot “float away” and does not accumulate drift.
  const FLOAT_AMP = 3.5;
  let floatT = 0;
  // on very large graphs drifting is off: it loads slow computers
  const floating = () => options.motion === "float" && shown.length <= 500;
  const offX = (d) => (floating() ? FLOAT_AMP * Math.sin(floatT * (0.55 + d.freq) + d.phase) : 0);
  const offY = (d) => (floating() ? FLOAT_AMP * Math.cos(floatT * (0.45 + d.freq * 0.8) + d.phase * 1.7) : 0);
  let rafId = 0, lastFrame = 0;
  function floatLoop(now) {
    rafId = 0;
    if (!floating() || document.hidden) return;
    if (now - lastFrame > 33) {          // ~30 frames per second is enough
      lastFrame = now;
      floatT = now / 1000;
      if (!dragging) place();
    }
    rafId = requestAnimationFrame(floatLoop);
  }
  function startFloat() {
    if (!rafId && floating() && !document.hidden) rafId = requestAnimationFrame(floatLoop);
  }
  cleanup.push(() => { if (rafId) cancelAnimationFrame(rafId); rafId = 0; });

  function buildSimulation() {
    if (sim) sim.stop();
    const count = shown.length;
    let cx = 0, cy = 0;
    for (const d of shown) { cx += d.x; cy += d.y; }
    if (count) { cx /= count; cy /= count; }
    // alpha 0: the new simulation continues from the saved positions instead of laying out from scratch
    sim = d3.forceSimulation(shown).stop()
      .alpha(0)
      .velocityDecay(0.35)
      .alphaDecay(0.02);
    applyForceSet(sim, shownLinks, count, cx, cy, baseRadius)
      // the center of mass stays put: drifting and dragging do not move the whole graph
      .force("center", d3.forceCenter(cx, cy).strength(0.2))
      .on("tick", () => place())
      .on("end", () => {
        restyle();                              // nodes moved — which labels overlap has changed
        savePositions();
        store.set(SETTLED_KEY, signature());   // physics has settled — that is the equilibrium
      });
  }

  // Settle the graph before showing it — only if the set of shown nodes differs from last time
  // (filters, new pages). On a normal open and on navigation physics does not run at all:
  // nodes stay where they are and only drift.
  const SETTLED_KEY = spaceKey("constellation.settled.v1");
  LEGACY[SETTLED_KEY] = spaceKey("observerGraph.settled.v1");
  function signature() {
    let h = 0;
    // the open or selected page from a hidden group is added temporarily — it does not count
    // the timeline does not change the layout: pages outside the period fade in place, nothing is re-laid out
    const base = options.mode === "all" ? all.nodes : shown.map((n) => nodeById.get(n.id));
    const ids = base.filter((n) => n && passesFilters(n)).map((n) => n.id).sort();
    for (const d of ids) h = (Math.imul(h, 31) + Math.floor(hash01(d) * 1e9)) | 0;
    return `f3:${ids.length}:${h}:${options.repel}:${options.linkDistance}:${options.nodeSize}:${options.labelSize}`;
  }
  // animate — when filters change, nodes glide to their new places instead of jumping
  let tween = null;
  function stopTween() {
    if (tween) tween.stop();
    tween = null;
  }
  function settle(animate) {
    if (options.motion === "still" || !shown.length) return;
    const sig = signature();
    if (store.get(SETTLED_KEY, null) === sig) return;
    store.set(SETTLED_KEY, sig);
    const from = shown.map((d) => [d.x, d.y]);
    // on filter changes the graph is only nudged (nodes stay recognizably in place, and when the group
    // comes back everything returns almost as it was); from scratch — settled fully
    sim.alpha(animate ? 0.1 : 0.3);
    const ticks = animate ? 90 : shown.length > 300 ? 150 : 300;
    for (let i = 0; i < ticks; i++) sim.tick();
    sim.alpha(0);
    for (const d of shown) { d.vx = 0; d.vy = 0; }
    if (!animate) {
      place();
      savePositions();
      return;
    }
    const to = shown.map((d) => [d.x, d.y]);
    const nodes = shown.slice();
    nodes.forEach((d, i) => { d.x = from[i][0]; d.y = from[i][1]; });
    stopTween();
    tween = d3.timer((elapsed) => {
      const t = d3.easeCubicInOut(Math.min(1, elapsed / 700));
      nodes.forEach((d, i) => {
        d.x = from[i][0] + (to[i][0] - from[i][0]) * t;
        d.y = from[i][1] + (to[i][1] - from[i][1]) * t;
      });
      place();
      if (t >= 1) {
        stopTween();
        savePositions();
      }
    });
  }

  // Start motion: alpha — how much to “shake” (0 — continue calmly from the same place)
  function startMotion(alpha) {
    if (!sim || document.hidden) return;
    if (options.motion === "still") {
      sim.stop();
      place();
      return;
    }
    sim.alphaTarget(0);
    if (alpha > sim.alpha()) sim.alpha(alpha);
    if (sim.alpha() > sim.alphaMin()) sim.restart();
    startFloat();
  }

  function refresh(refit) {
    const ids = visibleIds();
    const same = shown.length === ids.size && shown.every((d) => ids.has(d.id));
    if (same && svg) {
      restyle();
      if (refit && options.mode === "near") fit(450, false);
    } else draw(refit);
  }

  // A label below the node in several lines (up to three, word-wrapped), like in Obsidian
  function wrapLabel(text, width = 16, maxLines = 3) {
    const words = text.split(/\s+/).filter(Boolean);
    const lines = [];
    let line = "";
    for (let word of words) {
      while (word.length > width) {                 // a word that is too long — split it
        if (line) { lines.push(line); line = ""; }
        lines.push(word.slice(0, width - 1) + "-");
        word = word.slice(width - 1);
      }
      if (!line) line = word;
      else if ((line + " " + word).length <= width) line += " " + word;
      else { lines.push(line); line = word; }
    }
    if (line) lines.push(line);
    if (lines.length > maxLines) {
      const last = lines.slice(maxLines - 1).join(" ");
      lines.length = maxLines - 1;
      lines.push(last.length > width ? last.slice(0, width - 1) + "…" : last);
    }
    return lines.length ? lines : [text];
  }

  let linkLayer, nodeLayer;
  function ensureSvg() {
    if (svg) return false;
    container.innerHTML = "";
    svg = d3.select(container).append("svg").attr("width", "100%").attr("height", "100%");
    g = svg.append("g");
    zoom = d3.zoom().scaleExtent([0.1, 6])
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
        if (Math.abs(event.transform.k - currentScale) > 0.05) {
          currentScale = event.transform.k;
          restyle();
        }
      })
      .on("end", () => saveView());
    svg.call(zoom).on("dblclick.zoom", null);
    svg.on("click", (event) => { if (event.target === svg.node()) closeCard(); });
    linkLayer = g.append("g").attr("class", "cn-links");
    pulse = g.append("circle").attr("class", "cn-pulse").attr("r", 10);
    nodeLayer = g.append("g").attr("class", "cn-nodes");
    return true;
  }

  // Leaving nodes and links fade out; if they are needed again meanwhile — they stay
  function leave(selection) {
    selection.classed("cn-leaving", true).classed("cn-entering", false)
      .each(function () {
        const el = this;
        setTimeout(() => { if (el.classList.contains("cn-leaving")) el.remove(); }, 380);
      });
  }
  function enter(selection) {
    selection.classed("cn-entering", true);
    requestAnimationFrame(() => requestAnimationFrame(() => selection.classed("cn-entering", false)));
  }

  function draw(refit) {
    allBtn.classList.toggle("active", options.mode === "all");
    nearBtn.classList.toggle("active", options.mode === "near");
    orphanBtn.classList.toggle("active", options.showOrphans);
    drawLegend();

    syncPositions();
    if (sim) sim.stop();
    stopTween();
    if (!all.nodes.length) {
      container.innerHTML = `<div class="cn-empty">${esc(T.empty)}</div>`;
      return;
    }
    const first = ensureSvg();
    const ids = visibleIds();
    const old = new Map(shown.map((d) => [d.id, d]));
    shown = all.nodes.filter((n) => ids.has(n.id)).map((n) => {
      const was = old.get(n.id);
      if (was) {
        was.isCurrent = n.isCurrent;
        was.date = n.date; was.overdue = n.overdue; was.soon = n.soon; was.soonVia = n.soonVia || "";
        was.fx = was.fy = null;
        return was;
      }
      return {
        id: n.id, group: n.group, label: n.label, isCurrent: n.isCurrent, isOrphan: n.isOrphan,
        date: n.date || "", overdue: n.overdue || 0, soon: n.soon == null ? null : n.soon, soonVia: n.soonVia || "",
        x: positions[n.id][0], y: positions[n.id][1], lines: wrapLabel(truncate(n.label, 60)),
        phase: hash01(n.id) * Math.PI * 2, freq: hash01(n.id + "~") * 0.35,
      };
    });
    // the selected and the current page — on top of the others
    const rank = (d) => (d.id === selected ? 2 : d.isCurrent ? 1 : 0);
    shown.sort((a, b) => rank(a) - rank(b));
    const byId = new Map(shown.map((n) => [n.id, n]));
    shownLinks = all.edges.filter((e) => byId.has(e.source) && byId.has(e.target))
      .map((e) => ({ id: e.source + "\u0000" + e.target, source: byId.get(e.source), target: byId.get(e.target) }));

    linkSel = linkLayer.selectAll("line").data(shownLinks, (l) => l.id)
      .join(
        (en) => en.append("line").call(enter),
        (up) => up.classed("cn-leaving", false),
        (ex) => ex.call(leave));
    nodeSel = nodeLayer.selectAll("g.cn-node").data(shown, (d) => d.id)
      .join(
        (en) => {
          const ng = en.append("g").attr("class", "cn-node");
          ng.append("circle").attr("class", "cn-dot");
          ng.append("circle").attr("class", "cn-alert");        // overdue ring — no fill, around the node
          ng.append("title").text((d) => d.id);
          const text = ng.append("text").attr("class", "cn-label")
            .attr("text-anchor", "middle")
            .attr("paint-order", "stroke").attr("stroke", palette.bg).attr("stroke-width", 3);
          text.selectAll("tspan").data((d) => d.lines).join("tspan")
            .attr("x", 0).attr("dy", (_l, i) => (i ? "1.15em" : "0.95em")).text((l) => l);
          ng.append("text").attr("class", "cn-soon").attr("text-anchor", "middle")
            .attr("paint-order", "stroke").attr("stroke", palette.bg).attr("stroke-width", 3);
          return ng.call(enter);
        },
        (up) => up.classed("cn-leaving", false),
        (ex) => ex.call(leave))
      .order();
    place();

    nodeSel.call(d3.drag()
      .on("start", (event, d) => {
        stopTween();
        dragging = true;
        setHover(d.id, false);      // while dragging — the node itself and its links are highlighted
        d.fx = d.x;
        d.fy = d.y;
        if (options.motion !== "still" && !event.active) sim.alphaTarget(0.18).restart();
      })
      .on("drag", (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
        if (options.motion === "still") {
          d.x = event.x;
          d.y = event.y;
          place();
        }
      })
      .on("end", (event, d) => {
        dragging = false;
        setHover(null, false);
        if (options.motion === "still") {
          d.x = d.fx;
          d.y = d.fy;
        }
        d.fx = null;
        d.fy = null;
        if (options.motion !== "still" && !event.active) startMotion(0);
        scheduleSave(1200, true);
      }));
    nodeSel.on("click", (event, d) => {
      event.stopPropagation();
      if (VIEW === "full") openCard(d.id);
      else if (!d.isCurrent) call("handleNavigate", d.id);
    });
    // touch screens have no hover: a tap opens the card and the highlight does not stick
    nodeSel.on("pointerenter", (e, d) => { if (!dragging && e.pointerType !== "touch") setHover(d.id, false); })
      .on("pointerleave", (e) => { if (!dragging && e.pointerType !== "touch") setHover(null, false); });

    buildSimulation();
    settle(!first);
    restyle();

    // zoom: on the first show — as last time; in “Nearby” — fit what is shown
    const savedView = store.get(VIEW_KEY, null);
    const { w, h } = size();
    const savedTransform = savedView && savedView.k
      // the window may have been resized — keep the center
      ? d3.zoomIdentity.translate(savedView.x + (w - (savedView.w || w)) / 2, savedView.y + (h - (savedView.h || h)) / 2)
        .scale(savedView.k)
      : null;
    if (options.mode === "near") {
      fit(first ? 0 : 450, false);
    } else if (first) {
      if (savedTransform) {
        svg.call(zoom.transform, savedTransform);
        if (VIEW === "side") revealCurrent();
      } else fit(0, true);
    } else if (refit) {
      // from “Nearby” back to the whole space — to the previous view
      if (savedTransform) svg.transition().duration(450).call(zoom.transform, savedTransform);
      else fit(450, true);
    }
    startMotion(0);
  }

  // A node is drawn with the drift offset (the dragged one — without it)
  const px = (d) => d.x + (d.fx != null ? 0 : offX(d));
  const py = (d) => d.y + (d.fy != null ? 0 : offY(d));
  function place() {
    if (!linkSel) return;
    linkSel.attr("x1", (d) => px(d.source)).attr("y1", (d) => py(d.source))
      .attr("x2", (d) => px(d.target)).attr("y2", (d) => py(d.target));
    nodeSel.attr("transform", (d) => `translate(${px(d)},${py(d)})`);
    if (hovered && cardHover) {
      const d = shown.find((n) => n.id === hovered);
      if (d) pulse.attr("cx", px(d)).attr("cy", py(d));
    }
  }

  function saveView() {
    if (!svg || options.mode !== "all") return;
    const t = d3.zoomTransform(svg.node());
    const { w, h } = size();
    store.set(VIEW_KEY, { k: t.k, x: t.x, y: t.y, w, h });
  }

  // ---------------------------------------------------------------- highlight and labels
  const matches = (d) => search && (d.label.toLowerCase().includes(search) || d.id.toLowerCase().includes(search));
  const neighbour = (a, b) => a === b || (adjacency.get(a) && adjacency.get(a).has(b));

  // The node has a label (visible at least dimmed)
  let culled = new Set();
  function labelVisible(d) {
    if (culled.has(d.id)) return false;
    return wantsLabel(d);
  }
  function wantsLabel(d) {
    const f = hovered || selected;
    if (d.isCurrent || d.id === selected || matches(d)) return true;
    if (f && neighbour(f, d.id)) return true;
    if (options.labels === "all") return true;
    if (options.labels === "hover") return false;
    if (shown.length <= 15 || currentScale >= 1.6) return true;
    if (current && neighbour(current.id, d.id)) return true;
    return degree(d.id) >= labelLimit && rankOf.get(d.id) < budget;
  }

  // How many “important” labels fit: grows with zoom and window size.
  // Computed once per redraw — asking for the window size per node is expensive
  let budget = 6, viewArea = 0;
  function updateBudget() {
    if (!viewArea) {
      const { w, h } = size();
      viewArea = w * h;
    }
    budget = Math.max(6, Math.round(20 * currentScale * currentScale * viewArea / (1000 * 700)));
  }

  function setHover(id, fromCard) {
    hovered = id;
    cardHover = !!(id && fromCard);
    restyle();
    if (cardHover) place();
  }

  // Labels must not overlap: going from the most important (open, selected, hovered and its neighbours, search
  // hits, then by link count), a label whose box overlaps an already placed one is hidden. Boxes are in graph
  // coordinates with the current font size, so zooming in frees room and brings hidden labels back.
  function cullLabels(fontSize) {
    culled = new Set();
    const f = hovered || selected;
    const must = (d) => d.isCurrent || d.id === selected || d.id === hovered || matches(d);
    const cands = shown.filter(wantsLabel);
    if (cands.length > 600) return;
    const prio = (d) => (must(d) ? 0 : f && neighbour(f, d.id) ? 1 : 2);
    cands.sort((a, b) => prio(a) - prio(b) || (rankOf.get(a.id) || 0) - (rankOf.get(b.id) || 0));
    // other nodes are obstacles too: a label drawn over someone else's circle is unreadable and hides the node
    // margin: nodes drift ±3.5 px while floating, and a letter touching a circle already reads badly
    const m = 5;
    const dots = shown.map((d) => ({ id: d.id, x0: d.x - radius(d) - m, x1: d.x + radius(d) + m,
      y0: d.y - radius(d) - m, y1: d.y + radius(d) + m }));
    const placed = [];
    for (const d of cands) {
      const size = must(d) ? fontSize * 1.15 : fontSize;
      const w = Math.max(...d.lines.map((l) => l.length)) * size * 0.62;
      const top = d.y + radius(d) + 2;
      const box = { x0: d.x - w / 2, x1: d.x + w / 2, y0: top, y1: top + d.lines.length * size * 1.18 };
      const over = (b) => box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0;
      const hit = placed.some(over) || dots.some((b) => b.id !== d.id && over(b));
      if (hit && !must(d)) culled.add(d.id);
      else placed.push(box);
    }
  }

  function restyle() {
    if (!nodeSel) return;
    updateBudget();
    const f = hovered || selected;
    const focus = f ? new Set([f, ...(adjacency.get(f) || [])]) : null;
    const touches = (l) => f && (l.source.id === f || l.target.id === f);
    const base = options.labelOpacity / 100;
    // when zoomed out, labels shrink less — so they stay readable
    const fontSize = 10.5 * options.labelSize / 100 * Math.min(1.6, Math.max(1, 0.85 / currentScale));
    cullLabels(fontSize);

    nodeSel.select("circle.cn-alert")
      .attr("r", (d) => radius(d) + (d.id === hovered ? 2 : 0) + 3.5)
      .style("display", (d) => (options.marks && d.overdue ? null : "none"))
      .style("opacity", (d) => (search ? (matches(d) ? 1 : 0.2) : focus ? (focus.has(d.id) ? 1 : 0.2) : 1));
    // “in N days” on a page marked through its event — only if the event page itself is not shown (no double label)
    const shownIds = new Set(shown.map((n) => n.id));
    const soonShown = (d) => d.soon != null && !(d.soonVia && shownIds.has(d.soonVia));
    nodeSel.select("text.cn-soon")
      .attr("y", (d) => -radius(d) - 5)
      .style("display", (d) => (options.marks && soonShown(d) ? null : "none"))
      .style("font-size", fontSize * 0.92 + "px")
      .style("opacity", (d) => (search ? (matches(d) ? 1 : 0.2) : focus ? (focus.has(d.id) ? 1 : 0.2) : 1))
      .text((d) => (d.soon == null ? "" : soonText(d.soon)));
    nodeSel.select("circle.cn-dot")
      .attr("r", (d) => radius(d) + (d.id === hovered ? 2 : 0))
      .style("fill", (d) => colorOf(d))
      .style("opacity", (d) => {
        if (search) return matches(d) || d.isCurrent ? 1 : 0.18;
        if (focus) return focus.has(d.id) ? 1 : 0.18;
        return (d.isOrphan ? 0.5 : 1) * freshness(d);
      })
      .style("stroke", (d) => (d.isCurrent || d.id === selected || matches(d) || (d.id === hovered && cardHover) ? palette.ring : palette.bg))
      .style("stroke-width", (d) => (d.isCurrent || d.id === selected || (d.id === hovered && cardHover) ? 3 : 1.5));
    nodeSel.select("text.cn-label")
      .attr("y", (d) => radius(d) + (d.id === hovered ? 2 : 0) + 1)
      .style("font-size", (d) => (d.isCurrent || d.id === selected || d.id === hovered ? fontSize * 1.15 : fontSize) + "px")
      .style("font-weight", (d) => (d.isCurrent || d.id === selected || d.id === hovered ? "700" : "500"))
      .style("fill", palette.label)
      .style("opacity", (d) => {
        if (!labelVisible(d)) return 0;
        if (d.id === hovered || d.id === selected || matches(d)) return 1;
        if (focus) return focus.has(d.id) ? Math.max(0.85, base) : Math.min(base, 0.12);
        return d.isCurrent ? Math.max(base, 0.9) : base;
      })
      // an invisible label must not catch the pointer
      .style("pointer-events", (d) => (labelVisible(d) ? "auto" : "none"));
    linkSel
      .style("stroke", (l) => (touches(l) ? palette.edgeHi : palette.edge))
      .style("stroke-width", (l) => (touches(l) ? 2.2 : 1.2) * options.linkWidth / 100)
      .style("opacity", (l) => ((focus && !touches(l)) || search ? 0.12 : touches(l) ? 0.95 : 0.6));
    pulse.classed("on", !!(hovered && cardHover && shown.some((n) => n.id === hovered)))
      .style("stroke", hovered ? colorOf(nodeById.get(hovered) || { group: "other" }) : null);
  }

  // Bounds of what is shown — by circles and visible labels (label below the node, ~6.5 px per letter)
  function bounds(nodes) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const scale = options.labelSize / 100;
    for (const d of nodes) {
      const r = radius(d);
      let half = r, below = r + 6;
      if (labelVisible(d)) {
        half = Math.max(r, Math.max(...d.lines.map((l) => l.length)) * 6.5 * scale / 2);
        below = r + 4 + d.lines.length * 12.5 * scale;
      }
      minX = Math.min(minX, d.x - half); maxX = Math.max(maxX, d.x + half);
      minY = Math.min(minY, d.y - r - 6); maxY = Math.max(maxY, d.y + below);
    }
    return { minX, maxX, minY, maxY };
  }

  // The part of the window not covered by the card and the settings
  function freeArea() {
    const { w, h } = size();
    const box = container.getBoundingClientRect();
    let x0 = 0, x1 = w, y1 = h;
    if (card.classList.contains("open")) {
      const c = card.getBoundingClientRect();
      if (c.width > w * 0.8) y1 = Math.max(h * 0.35, c.top - box.top);
      else x1 = Math.max(w * 0.35, c.left - box.left);
    }
    if (settingsPanel.classList.contains("open")) {
      const s = settingsPanel.getBoundingClientRect();
      if (s.width < w * 0.8) x0 = Math.min(x1 - w * 0.3, s.right - box.left);
    }
    return { x0, y0: 0, x1, y1 };
  }

  function fit(duration, save, from) {
    if (!shown.length) return;
    const b = bounds(shown);
    const a = freeArea();
    const w = a.x1 - a.x0, h = a.y1 - a.y0, pad = 20;
    const k = Math.max(0.1, Math.min(1.4, Math.min((w - 2 * pad) / (b.maxX - b.minX || 1), (h - 2 * pad) / (b.maxY - b.minY || 1))));
    const t = d3.zoomIdentity
      .translate(a.x0 + w / 2 - k * (b.minX + b.maxX) / 2, a.y0 + h / 2 - k * (b.minY + b.maxY) / 2).scale(k);
    if (from) svg.call(zoom.transform, from);
    if (duration) svg.transition().duration(duration).call(zoom.transform, t).on("end", () => { if (save) saveView(); });
    else {
      svg.call(zoom.transform, t);
      if (save) saveView();
    }
  }

  // Node not visible (off-screen or under the card) — pan smoothly without changing the zoom
  function reveal(id, duration, onlyIfHidden) {
    const d = shown.find((n) => n.id === id);
    if (!d || !svg) return;
    const t = d3.zoomTransform(svg.node());
    const [x, y] = t.apply([d.x, d.y]);
    const a = freeArea(), m = onlyIfHidden ? 12 : 60, label = onlyIfHidden ? 0 : 120;
    if (x > a.x0 + m + label / 2 && x < a.x1 - m - label / 2 && y > a.y0 + m && y < a.y1 - m - label / 3) return;
    const nx = t.x + ((a.x0 + a.x1) / 2 - x), ny = t.y + ((a.y0 + a.y1) / 2 - y);
    const target = d3.zoomIdentity.translate(nx, ny).scale(t.k);
    if (duration) svg.transition().duration(duration).call(zoom.transform, target);
    else svg.call(zoom.transform, target);
  }

  function revealCurrent() {
    if (current) reveal(current.id, 400, true);
  }

  function focusFirstMatch() {
    const d = shown.find(matches);
    if (!d) return;
    if (VIEW === "full") {
      openCard(d.id);
      return;
    }
    const { w, h } = size();
    const k = Math.max(currentScale, 1.6);
    svg.transition().duration(500).call(zoom.transform, d3.zoomIdentity.translate(w / 2 - k * d.x, h / 2 - k * d.y).scale(k));
  }

  // ---------------------------------------------------------------- page card
  function fullTitle(n) {
    const leaf = n.id.slice(n.id.lastIndexOf("/") + 1);
    const day = leaf.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (day) return `${day[3]}.${day[2]}.${day[1]}`;
    const week = leaf.match(/^(\d{4})-W(\d{2})$/);
    if (week) return T.week(Number(week[2]), week[1]);
    return n.label || leaf;
  }

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function formatDate(value) {
    const m = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return value;
    return LANG === "ru" ? `${m[3]}.${m[2]}.${m[1]}` : `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
  }

  async function openCard(id) {
    const n = nodeById.get(id);
    if (!n) return;
    const wasOpen = card.classList.contains("open");
    selected = id;
    setHover(null, false);
    const kind = groupById[n.group] || groupById.other;
    const neighbours = Array.from(adjacency.get(id) || []).map((x) => nodeById.get(x)).filter(Boolean)
      .sort((a, b) => GROUPS.indexOf(groupById[a.group]) - GROUPS.indexOf(groupById[b.group]) || a.label.localeCompare(b.label, LANG));
    card.style.setProperty("--cn-accent", colorOf(n));
    card.classList.remove("cn-wide");
    card.innerHTML = `
      <div class="cn-card-head">
        <span class="cn-kind"><i></i>${esc(kind.one)}</span>
        <button class="cn-icon" data-act="close" title="${esc(T.close)}">✕</button>
      </div>
      <h2 class="cn-card-title">${esc(fullTitle(n))}</h2>
      <div class="cn-card-meta"></div>
      <div class="cn-card-body"><div class="cn-loading"><span></span><span></span><span></span></div></div>
      ${neighbours.length ? `<div class="cn-card-links">
        <div class="cn-sub">${esc(T.linked)} · ${neighbours.length}</div>
        <div class="cn-link-chips">${neighbours.map((m) =>
          `<button class="cn-link" data-id="${esc(m.id)}" title="${esc(m.id)}"><i style="background:${colorOf(m)}"></i>${esc(truncate(m.label, 30))}</button>`).join("")}</div>
      </div>` : ""}
      <div class="cn-card-actions">
        <button class="cn-btn cn-primary" data-act="open">${esc(T.openPage)}</button>
      </div>`;
    card.classList.add("open");
    refresh(options.mode === "near");
    if (nodeSel) nodeSel.filter((d) => d.id === id).raise();
    if (options.mode !== "near") reveal(id, wasOpen ? 350 : 450);

    let res = null;
    try {
      res = await call("preview", id);
    } catch (_e) {
      res = null;
    }
    if (selected !== id) return;   // another node was selected while loading
    fillCard(id, res);
    if (res && res.wide && options.mode !== "near") reveal(id, 300);
  }

  function fillCard(id, res) {
    const body = card.querySelector(".cn-card-body");
    const meta = card.querySelector(".cn-card-meta");
    if (!body || !meta) return;
    if (!res || res.missing) {
      body.innerHTML = `<p class="cn-muted">${esc(T.missing)}</p>`;
      return;
    }
    const bits = [];
    const node = nodeById.get(id);
    if (res.date) bits.push(`<span>📅 ${esc(formatDate(res.date))}</span>`);
    if (res.place) bits.push(`<span>📍 ${esc(res.place)}</span>`);
    if (node && node.soon != null && !res.date) bits.push(`<span class="cn-meta-soon">⏰ ${esc(T.eventSoon(soonText(node.soon)))}</span>`);
    else if (node && node.soon != null) bits.push(`<span class="cn-meta-soon">⏰ ${esc(soonText(node.soon))}</span>`);
    if (node && node.overdue) bits.push(`<span class="cn-meta-overdue">⚠ ${esc(T.overdue(node.overdue))}</span>`);
    meta.innerHTML = bits.join("");
    body.innerHTML = res.html && res.html.trim() ? res.html : `<p class="cn-muted">${esc(T.emptyPage)}</p>`;
    for (const input of body.querySelectorAll("input")) input.disabled = true;
    enableTasks(body, id, res.tasks || []);
    // wide tables scroll inside the card instead of overflowing it
    for (const table of body.querySelectorAll("table")) {
      if (table.closest(".cn-widget")) continue;
      const wrap = document.createElement("div");
      wrap.className = "cn-table";
      table.replaceWith(wrap);
      wrap.appendChild(table);
    }
    for (const img of body.querySelectorAll("img")) {
      img.loading = "lazy";
      img.addEventListener("error", () => {
        const note = document.createElement("span");
        note.className = "cn-muted";
        note.textContent = T.imageMissing;
        img.replaceWith(note);
      });
    }
    card.classList.toggle("cn-wide", !!res.wide || !!body.querySelector(".cn-table table"));
    prettifyAttributes(body);
  }

  // Task checkboxes in the card write [x] / [ ] straight into the page. SilverBullet marks tasks shown by queries
  // itself (data-external-task-ref="Page@pos"), the page's own tasks — by positions from preview, in order.
  function enableTasks(body, id, offsets) {
    let own = 0;
    for (const task of body.querySelectorAll(".sb-task")) {
      const input = task.querySelector('input[type="checkbox"]');
      const external = task.getAttribute("data-external-task-ref");
      const ref = external || (own < offsets.length ? `${id}@${offsets[own]}` : "");
      if (!external) own++;
      if (!input || !ref) continue;
      input.disabled = false;
      input.title = input.checked ? T.untick : T.tick;
      input.addEventListener("click", (e) => e.stopPropagation());
      input.addEventListener("change", async () => {
        const done = input.checked;
        input.disabled = true;
        let res = null;
        try {
          res = await call("toggleTask", ref, done);
        } catch (e) {
          res = { ok: false, error: String((e && e.message) || e) };
        }
        input.disabled = false;
        if (!res || !res.ok) {
          input.checked = !done;
          flashNote(task, (res && res.error) || T.tickFailed);
          return;
        }
        input.title = done ? T.untick : T.tick;
        scheduleCardRefresh(id);
      });
    }
  }

  function flashNote(anchor, text) {
    const note = document.createElement("div");
    note.className = "cn-task-error";
    note.textContent = text;
    anchor.after(note);
    setTimeout(() => note.remove(), 4000);
  }

  // After a checkbox — reload the card (open/done lists from queries) once SilverBullet has re-indexed
  let refreshTimer = null;
  function scheduleCardRefresh(id) {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(async () => {
      if (selected !== id) return;
      let res = null;
      try {
        res = await call("preview", id);
      } catch (_e) {
        return;
      }
      if (selected !== id || !res || res.missing) return;
      const body = card.querySelector(".cn-card-body");
      const scroll = body ? body.scrollTop : 0;
      fillCard(id, res);
      if (body) body.scrollTop = scroll;
    }, 900);
  }

  const soonText = (days) => (days === 0 ? T.today : days === 1 ? T.tomorrow : T.inDays(days));

  // Task attributes [who: Ann] [due: YYYY-MM-DD] — as chips instead of bracketed text
  function attrChip(key, value) {
    const chip = document.createElement("span");
    const due = DUE_KEYS.has(key);
    chip.className = "cn-attr" + (due ? " cn-due" : "");
    chip.textContent = due ? T.due(formatDate(value)) : value;
    if (due && /^\d{4}-\d{2}-\d{2}/.test(value) && value.slice(0, 10) < TODAY) chip.classList.add("cn-late");
    chip.title = due ? T.dueTitle : key;
    return chip;
  }

  function prettifyAttributes(root) {
    // links to tasks point at a position in the page: "Projects/X@233" → label without "@233"
    // links to pages named by a date: "2026-09-28" → a formatted date, "2026-W39" → "Week 39, 2026"
    for (const a of root.querySelectorAll("a")) {
      if (a.closest(".cn-widget")) continue;
      let text = a.textContent.replace(/@\d+$/, "");
      const day = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      const week = text.match(/^(\d{4})-W(\d{2})$/);
      if (day) text = formatDate(text);
      else if (week) text = T.week(Number(week[2]), week[1]);
      if (text !== a.textContent) a.textContent = text;
    }
    // that is how SilverBullet marks them up: <span class="sb-attribute"> with a name and a value inside
    for (const el of root.querySelectorAll(".sb-attribute")) {
      const name = el.querySelector(".sb-attribute-name");
      const value = el.querySelector(".sb-attribute-value");
      if (name && value) el.replaceWith(attrChip(name.textContent.trim(), value.textContent.trim()));
    }
    // fallback — attributes as plain text (widgets are left alone)
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const texts = [];
    const keys = ATTR_KEYS.map((k) => k.replace(/[^\w$]/g, "")).filter(Boolean).join("|");
    if (!keys) return;
    const probe = new RegExp(`\\[(${keys}):`);
    while (walker.nextNode()) if (probe.test(walker.currentNode.nodeValue)) texts.push(walker.currentNode);
    for (const t of texts) {
      const parts = [];
      let last = 0;
      const re = new RegExp(`\\s*\\[(${keys}):\\s*([^\\]]*)\\]`, "g");
      let m;
      while ((m = re.exec(t.nodeValue))) {
        parts.push(document.createTextNode(t.nodeValue.slice(last, m.index) + " "), attrChip(m[1], m[2].trim()));
        last = re.lastIndex;
      }
      parts.push(document.createTextNode(t.nodeValue.slice(last)));
      t.replaceWith(...parts);
    }
  }

  function closeCard() {
    if (!selected) return;
    selected = null;
    card.classList.remove("open");
    setHover(null, false);
    refresh(options.mode === "near");
  }

  // A link in the card → a page (task links also carry a position: "Projects/X@123")
  function pageFromLink(el) {
    const ref = el.getAttribute("data-ref") || el.getAttribute("data-id");
    let path = ref;
    if (!path) {
      const href = el.getAttribute("href");
      if (!href || /^[a-z]+:/i.test(href) || href.startsWith("#")) return null;
      path = href.replace(/^\//, "");
      try { path = decodeURIComponent(path); } catch (_e) { /* as is */ }
    }
    return path.split(/[#?]/)[0].replace(/@\d+$/, "");
  }

  card.addEventListener("click", (event) => {
    const el = event.target.closest("[data-act], .cn-link, a");
    if (!el) return;
    if (el.dataset.act === "close") return closeCard();
    if (el.dataset.act === "open") return call("openPage", selected);
    if (el.classList.contains("cn-link")) return openCard(el.dataset.id);
    if (el.tagName === "A") {
      event.preventDefault();
      const page = pageFromLink(el);
      if (page && nodeById.has(page)) openCard(page);
      else if (page) call("openPage", page);
      else window.open(el.href, "_blank", "noopener");
    }
  });
  // Hovering a link or a linked chip in the card highlights the node in the graph
  card.addEventListener("mouseover", (event) => {
    const el = event.target.closest(".cn-link, a");
    const page = el ? pageFromLink(el) : null;
    const id = page && nodeById.has(page) ? page : null;
    if (id !== (cardHover ? hovered : null)) setHover(id, true);
  });
  card.addEventListener("mouseleave", () => { if (cardHover) setHover(null, false); });

  // ---------------------------------------------------------------- settings
  function toggleSettings(force) {
    const open = force !== undefined ? force : !settingsPanel.classList.contains("open");
    settingsPanel.classList.toggle("open", open);
    settingsBtn.classList.toggle("active", open);
    if (open) renderSettings();
  }

  function setSetting(key, value, apply) {
    options[key] = value;
    saveOption(key, value);
    apply();
  }

  const applyForces = () => {
    if (!sim) return;
    const count = shown.length;
    sim.force("link").distance(distanceOf(count));
    sim.force("charge").strength(chargeOf(count));
    sim.force("collide").radius((d) => baseRadius(d) + 6);
    if (options.motion === "still") {
      // a still graph: recompute the layout at once, without animation
      sim.alpha(0.3);
      for (let i = 0; i < 120; i++) sim.tick();
      place();
      savePositions();
    } else startMotion(0.35);
  };
  const applyLook = () => restyle();
  const applyMotion = () => {
    if (options.motion === "still") {
      if (sim) sim.stop();
    } else startMotion(0.05);
  };

  function segmented(label, key, choices, apply) {
    const row = document.createElement("div");
    row.className = "cn-set-row";
    row.innerHTML = `<div class="cn-set-label">${label}</div><div class="cn-seg"></div>`;
    const seg = row.querySelector(".cn-seg");
    for (const [value, text, hint] of choices) {
      const b = document.createElement("button");
      b.textContent = text;
      b.title = hint || "";
      b.className = options[key] === value ? "on" : "";
      b.addEventListener("click", () => {
        setSetting(key, value, apply);
        for (const x of seg.children) x.classList.toggle("on", x === b);
      });
      seg.appendChild(b);
    }
    return row;
  }

  function slider(label, key, min, max, step, unit, apply) {
    const row = document.createElement("div");
    row.className = "cn-set-row";
    row.innerHTML = `<div class="cn-set-label">${label}<span class="cn-set-value"></span></div>
      <input type="range" min="${min}" max="${max}" step="${step}" value="${options[key]}">`;
    const input = row.querySelector("input");
    const out = row.querySelector(".cn-set-value");
    const show = () => { out.textContent = input.value + unit; };
    show();
    let timer = null;
    input.addEventListener("input", () => {
      show();
      options[key] = Number(input.value);
      apply();
      clearTimeout(timer);
      timer = setTimeout(() => saveOption(key, options[key]), 400);
    });
    return row;
  }

  function checkbox(label, key, hint, apply) {
    const row = document.createElement("label");
    row.className = "cn-set-check";
    row.title = hint || "";
    row.innerHTML = `<input type="checkbox"${options[key] ? " checked" : ""}> ${label}`;
    row.querySelector("input").addEventListener("change", (e) => setSetting(key, e.target.checked, apply || (() => {})));
    return row;
  }

  function section(title) {
    const s = document.createElement("div");
    s.className = "cn-set-section";
    s.innerHTML = `<div class="cn-sub">${title}</div>`;
    return s;
  }

  function renderSettings() {
    settingsPanel.innerHTML = `<div class="cn-card-head"><span class="cn-set-title">${esc(T.settings)}</span>
      <button class="cn-icon" data-act="close" title="${esc(T.closeShort)}">✕</button></div><div class="cn-set-body"></div>`;
    settingsPanel.querySelector("[data-act=close]").addEventListener("click", () => toggleSettings(false));
    const body = settingsPanel.querySelector(".cn-set-body");

    const motion = section(T.motion);
    motion.appendChild(segmented(T.nodes, "motion", [
      ["float", ...T.float], ["calm", ...T.calm], ["still", ...T.still],
    ], applyMotion));
    motion.appendChild(slider(T.repel, "repel", 0, 100, 1, "", applyForces));
    motion.appendChild(slider(T.linkDistance, "linkDistance", 20, 200, 5, " px", applyForces));
    body.appendChild(motion);

    const look = section(T.look);
    look.appendChild(slider(T.nodeSize, "nodeSize", 50, 200, 5, " %", () => { applyLook(); applyForces(); }));
    look.appendChild(slider(T.linkWidth, "linkWidth", 50, 300, 10, " %", applyLook));
    body.appendChild(look);

    const labels = section(T.labels);
    labels.appendChild(segmented(T.showLabels, "labels", [
      ["smart", ...T.smart], ["all", ...T.allLabels], ["hover", ...T.hover],
    ], applyLook));
    labels.appendChild(slider(T.labelOpacity, "labelOpacity", 10, 100, 5, " %", applyLook));
    labels.appendChild(slider(T.labelSize, "labelSize", 70, 160, 5, " %", applyLook));
    body.appendChild(labels);

    const colors = section(T.colors);
    const grid = document.createElement("div");
    grid.className = "cn-colors";
    for (const gr of GROUPS) {
      const item = document.createElement("label");
      item.className = "cn-color";
      item.innerHTML = `<input type="color" value="${groupColor[gr.id]}"><span>${esc(gr.name)}</span>`;
      item.querySelector("input").addEventListener("input", (e) => {
        options.colors = Object.assign({}, options.colors, { [gr.id]: e.target.value });
        updateColors();
        drawLegend();
        restyle();
      });
      item.querySelector("input").addEventListener("change", () => saveOption("colors", options.colors));
      grid.appendChild(item);
    }
    colors.appendChild(grid);
    body.appendChild(colors);

    const other = section(T.other);
    other.appendChild(checkbox(T.fresh[0], "freshBright", T.fresh[1], () => restyle()));
    other.appendChild(checkbox(T.marks[0], "marks", T.marks[1], () => restyle()));
    other.appendChild(checkbox(T.start[0], "startWithGraph", T.start[1]));
    const actions = document.createElement("div");
    actions.className = "cn-set-actions";
    actions.innerHTML = `<button class="cn-btn" data-act="relayout" title="${esc(T.relayout[1])}">${esc(T.relayout[0])}</button>
      <button class="cn-btn" data-act="reset" title="${esc(T.reset[1])}">${esc(T.reset[0])}</button>`;
    actions.querySelector("[data-act=relayout]").addEventListener("click", () => {
      positions = computeLayout(true);
      for (const d of shown) { d.x = positions[d.id][0]; d.y = positions[d.id][1]; }
      store.set(SETTLED_KEY, null);
      draw(false);
      fit(450, true);
    });
    actions.querySelector("[data-act=reset]").addEventListener("click", () => {
      for (const key of SETTING_KEYS) {
        options[key] = key === "colors" ? {} : DEFAULTS[key];
        saveOption(key, options[key]);
      }
      updateColors();
      drawLegend();
      applyForces();
      applyMotion();
      restyle();
      renderSettings();
    });
    other.appendChild(actions);
    body.appendChild(other);
  }

  // ---------------------------------------------------------------- keys and window size
  listen(document, "keydown", (event) => {
    if (event.key !== "Escape") return;
    if (document.activeElement === searchBox && searchBox.value) {
      searchBox.value = "";
      search = "";
      applyHighlight();
    } else if (settingsPanel.classList.contains("open")) toggleSettings(false);
    else if (selected) closeCard();
    else if (VIEW === "full") call("closeGraph");
  });

  let resizeTimer = null;
  listen(window, "resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      viewArea = 0;
      if (options.mode === "near") fit(300, false);
      else restyle();
    }, 150);
  });

  function applyHighlight() {
    restyle();
  }

  function truncate(str, max) {
    return str.length <= max ? str : str.slice(0, max - 1) + "…";
  }

  draw(false);
  if (VIEW === "full" && window.__CN_SELECT__ && nodeById.has(window.__CN_SELECT__)) openCard(window.__CN_SELECT__);
})();
