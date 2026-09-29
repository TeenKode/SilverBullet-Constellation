// Constellation — a living graph view for SilverBullet.
// Based on Atlas (MIT, © 2026 Selçuk Öztürk, https://github.com/selcux/silverbullet-atlas).
//
// Two views share one renderer (assets/graph-render.js, d3 inside a panel iframe):
//   * full screen (modal panel) — clicking a node opens a floating card with the page content,
//     task checkboxes work right in the card;
//   * side panel (rhs) — clicking a node navigates to the page.
// Everything space-specific (groups, colors, task links, marks) comes from `config.set("constellation", …)`;
// without configuration pages are grouped by their top-level folder.
import { asset, clientStore, editor, space } from "@silverbulletmd/silverbullet/syscalls";
import { syscall } from "@silverbulletmd/silverbullet/syscall";
import {
  buildGraphData, type Config, findDirectives, type Lang, normalizeConfig, type ResolvedGroup, resolveLang,
  setTaskState, TEXT, taskOffsets, valueToMarkdown,
} from "./core.ts";

const PLUG_NAME = "constellation";
const STORE_KEY = "constellationSideOpen";
const OPTIONS_KEY = "constellationOptions";
// the plug was first published inside the «Observer» project as `observergraph` — keep its saved settings
const LEGACY_STORE_KEY = "observerGraphEnabled";
const LEGACY_OPTIONS_KEY = "observerGraphOptions";

async function loadConfig(): Promise<Config> {
  let raw: unknown = {};
  try {
    raw = await syscall("config.get", "constellation", {});
  } catch {
    /* older SilverBullet: defaults */
  }
  return normalizeConfig(raw);
}


// ---------------------------------------------------------------- saved options (per browser)
export interface GraphOptions {
  mode: "all" | "near";          // whole space or pages within two steps of the selected one
  hidden: string[];              // hidden groups
  showOrphans: boolean;          // pages without links
  startWithGraph: boolean;       // open the full-screen graph when the space opens on the start page
}

async function storedOptions(): Promise<Record<string, unknown>> {
  return (await clientStore.get(OPTIONS_KEY)) || (await clientStore.get(LEGACY_OPTIONS_KEY)) || {};
}

async function getOptions(cfg: Config, groups: ResolvedGroup[]): Promise<GraphOptions> {
  return {
    mode: "all", hidden: groups.filter((g) => g.hidden).map((g) => g.id), showOrphans: false,
    startWithGraph: cfg.openOnStart, ...(await storedOptions()),
  };
}

export async function setOption(key: string, value: unknown) {
  const stored = await storedOptions();
  stored[key] = value;
  await clientStore.set(OPTIONS_KEY, stored);
}

// ---------------------------------------------------------------- commands
// Whether the side panel is shown right now. Separate from the saved "enabled" flag: after a reload
// the flag stays but the panel is not drawn yet — the command must open it, not "hide" it.
let shown = false;
let fullShown = false;
let started = false;

export async function toggleGraph() {
  if (shown) {
    shown = false;
    await clientStore.set(STORE_KEY, false);
    await editor.hidePanel("rhs");
  } else {
    await clientStore.set(STORE_KEY, true);
    await renderGraph("side");
  }
}

export async function openGraph() {
  if (fullShown) await closeGraph();
  else await renderGraph("full");
}

export async function closeGraph() {
  fullShown = false;
  await editor.hidePanel("modal");
}

export async function updateGraph() {
  if (!started) {
    started = true;
    const cfg = await loadConfig();
    const startWith = (await storedOptions()).startWithGraph ?? cfg.openOnStart;
    if (startWith && (await editor.getCurrentPage()) === cfg.startPage) await renderGraph("full", true);
  }
  let side = await clientStore.get(STORE_KEY);
  if (side === undefined || side === null) side = await clientStore.get(LEGACY_STORE_KEY);
  if (side) await renderGraph("side");
}

// From the card: close the graph and open the page
export async function openPage(pageName: string) {
  if (!pageName) return;
  await closeGraph();
  await editor.navigate({ page: pageName });
}

export async function handleNavigate(pageName: string) {
  if (pageName) await editor.navigate({ page: pageName });
}

// ---------------------------------------------------------------- page preview for the card
// ${…} expressions (queries, widgets) are evaluated here: markdownToHtml leaves them as text
async function expandDirectives(text: string, widgets: string[], lang: Lang): Promise<string> {
  let out = "", last = 0;
  for (const d of findDirectives(text)) {
    out += text.slice(last, d.start);
    try {
      out += valueToMarkdown(await syscall("lua.evalExpression", d.expr), widgets, lang);
    } catch (e) {
      out += `_${TEXT[lang].directiveFailed}: ${String((e as Error)?.message ?? e).slice(0, 120)}_`;
    }
    last = d.end;
  }
  return out + text.slice(last);
}

// A checkbox in the card: ref is "Page@pos" (that is how SilverBullet names tasks in queries)
export async function toggleTask(ref: string, done: boolean) {
  const lang = resolveLang((await loadConfig()).language);
  const at = ref.lastIndexOf("@");
  if (at < 0) return { ok: false, error: TEXT[lang].noPosition };
  const page = ref.slice(0, at);
  let text: string;
  try {
    text = await space.readPage(page);
  } catch {
    return { ok: false, error: TEXT[lang].notFound };
  }
  // the page may have changed while the card was open
  const next = setTaskState(text, ref.slice(at + 1), done);
  if (next === null) return { ok: false, error: TEXT[lang].moved };
  if (next !== text) await space.writePage(page, next);
  return { ok: true };
}

// Page content for the card: HTML without frontmatter and the first heading (date and place go separately);
// tasks — positions of the page's own tasks in order (for the checkboxes)
export async function preview(pageName: string) {
  const cfg = await loadConfig();
  const lang = resolveLang(cfg.language);
  let text: string;
  try {
    text = await space.readPage(pageName);
  } catch {
    return { missing: true };
  }
  // task positions — in LF text, like SilverBullet (findTaskStart maps them back to a CRLF file)
  const full = text.replace(/\r\n/g, "\n");
  const front: Record<string, string> = {};
  const m = full.match(/^---\n([\s\S]*?)\n---\n?/);
  if (m) {
    for (const line of m[1].split("\n")) {
      const kv = line.match(/^([\w-]+):\s*(.*)$/);
      if (kv) front[kv[1]] = kv[2].replace(/^["']|["']$/g, "");
    }
  }
  const title = full.slice(m ? m[0].length : 0).match(/^\s*#\s+[^\n]*\n?/);
  const bodyStart = (m ? m[0].length : 0) + (title ? title[0].length : 0);
  const tasks = taskOffsets(full, bodyStart);
  const widgets: string[] = [];
  text = await expandDirectives(full.slice(bodyStart), widgets, lang);
  let html = "";
  try {
    html = await syscall("markdown.markdownToHtml", text, { shortWikiLinks: true });
  } catch {
    html = `<pre>${text.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!))}</pre>`;
  }
  html = html.replace(/(?:<p[^>]*>|<span class="p">)?\s*CNWIDGET(\d+)END\s*(?:<\/p>|<\/span>)?/g,
    (_m, n) => `<div class="cn-widget">${widgets[Number(n)] ?? ""}</div>`);
  const dateKey = cfg.upcoming?.attribute || "date";
  return {
    html, date: front[dateKey] || "", place: front.place || front.location || "",
    wide: widgets.some((w) => /<table/i.test(w)), tasks,
  };
}

// ---------------------------------------------------------------- graph
async function buildGraph(currentPage: string, cfg: Config, lang: Lang) {
  const [links, pages, tasks] = await Promise.all([
    syscall("index.queryLuaObjects", "link", { objectVariable: "l" }, {}),
    syscall("index.queryLuaObjects", "page", { objectVariable: "p" }, {}),
    syscall("index.queryLuaObjects", "task", { objectVariable: "t" }, {}).catch(() => []),
  ]);
  return buildGraphData(currentPage, { links, pages, tasks }, cfg, lang);
}

async function renderGraph(view: "full" | "side", atStart = false) {
  const cfg = await loadConfig();
  const lang = resolveLang(cfg.language);
  const currentPage = await editor.getCurrentPage();
  const [data, isDark] = await Promise.all([buildGraph(currentPage, cfg, lang), editor.getUiOption("darkMode")]);
  // first start in this browser: the index is still being built — do not greet with an empty graph
  if (atStart && data.edges.length === 0) return;
  const options = await getOptions(cfg, data.groups);
  const [d3Js, rendererJs, css] = await Promise.all([
    asset.readAsset(PLUG_NAME, "assets/d3.min.js"),
    asset.readAsset(PLUG_NAME, "assets/graph-render.js"),
    asset.readAsset(PLUG_NAME, "assets/graph-style.css"),
  ]);
  const style = css + "\n" + cfg.extraCss.replace(/<\/style/gi, "");
  const html = `<style>${style}</style><div id="cn-toolbar"></div><div id="cn-legend"></div>` +
    `<div id="cn-stage"><div id="cn-container"></div><div id="cn-card"></div></div>`;
  const script = `
    ${d3Js}
    window.__CN_DATA__ = ${JSON.stringify(data)};
    window.__CN_DARK__ = ${JSON.stringify(!!isDark)};
    window.__CN_OPTIONS__ = ${JSON.stringify(options)};
    window.__CN_VIEW__ = ${JSON.stringify(view)};
    window.__CN_LANG__ = ${JSON.stringify(lang)};
    ${rendererJs}
  `;
  if (view === "full") {
    await editor.showPanel("modal", 0, html, script);
    fullShown = true;
  } else {
    await editor.showPanel("rhs", 1, html, script);
    shown = true;
  }
}
