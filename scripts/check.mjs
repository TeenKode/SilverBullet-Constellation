// End-to-end check in a real SilverBullet (Playwright): the plug is installed as a library into a demo space,
// configured through space-lua, opens on start, cards, checkboxes (own tasks, tasks from queries, a CRLF page),
// marks, the timeline, dark theme, Russian UI.
//
//   node scripts/check.mjs                       — downloads SilverBullet (SB_VERSION, default 2.11.1)
//   SB_BIN=/path/to/silverbullet node scripts/check.mjs
//   CHROME_BIN=/path/to/chrome                   — your own Chromium (otherwise Playwright's)
//   SCREENSHOTS=docs node scripts/check.mjs      — also save screenshots for the README
import { execFileSync, spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { demoSpace } from "./demo-space.mjs";

const failed = [];
function check(what, ok, details = "") {
  console.log(`${ok ? "✓" : "✗"} ${what}${details ? ` — ${details}` : ""}`);
  if (!ok) failed.push(what);
}

const freePort = () => new Promise((resolve) => {
  const srv = createServer();
  srv.listen(0, "127.0.0.1", () => {
    const { port } = srv.address();
    srv.close(() => resolve(port));
  });
});

function findFile(dir, test) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      const found = findFile(p, test);
      if (found) return found;
    } else if (test(name)) return p;
  }
  return null;
}

export async function silverbullet(tmp) {
  if (process.env.SB_BIN) return process.env.SB_BIN;
  const ver = process.env.SB_VERSION || "2.11.1";
  const url = `https://github.com/silverbulletmd/silverbullet/releases/download/${ver}/silverbullet-server-linux-x86_64.zip`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${url}: ${res.status}`);
  const zip = join(tmp, "sb.zip");
  writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
  execFileSync("unzip", ["-q", zip, "-d", join(tmp, "sb")]);
  const bin = findFile(join(tmp, "sb"), (n) => n.startsWith("silverbullet"));
  chmodSync(bin, 0o755);
  return bin;
}

export async function startServer(bin, folder) {
  const port = await freePort();
  const server = spawn(bin, [folder], { env: { ...process.env, SB_PORT: String(port), SB_HOSTNAME: "127.0.0.1" }, stdio: "ignore" });
  const base = `http://127.0.0.1:${port}/`;
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(base + ".config")).ok) break;
    } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return { server, base };
}

const graphFrame = async (page) => {
  for (const f of page.frames().reverse()) {
    if (f === page.mainFrame()) continue;
    try {
      if (await f.evaluate(() => !!window.__CN_DATA__)) return f;
    } catch { /* detached */ }
  }
  return null;
};

async function openGraph(page) {
  let fr = await graphFrame(page);
  if (fr && await fr.evaluate(() => document.body.classList.contains("cn-full"))) return fr;
  await page.evaluate(() => client.runCommandByName("Constellation: Open Graph"));
  await page.waitForTimeout(2500);
  return graphFrame(page);
}

const layout = (fr) => fr.evaluate(() => Object.fromEntries([...document.querySelectorAll(".cn-node:not(.cn-leaving)")].map((n) => {
  const m = (n.getAttribute("transform") || "").match(/translate\(([-\d.e]+),\s*([-\d.e]+)\)/);
  return [n.querySelector("title").textContent, m ? [+m[1], +m[2]] : null];
}).filter((x) => x[1])));

const maxShift = (a, b) => Math.max(0, ...Object.keys(a).filter((k) => b[k]).map((k) => Math.hypot(a[k][0] - b[k][0], a[k][1] - b[k][1])));

async function openCard(page, fr, id) {
  await fr.evaluate((id) => {
    const node = [...document.querySelectorAll(".cn-node")].find((n) => n.querySelector("title").textContent === id);
    node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }, id);
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(250);
    if (await fr.evaluate(() => !document.querySelector(".cn-card-body .cn-loading"))) break;
  }
  return fr.evaluate(() => document.querySelector("#cn-card.open .cn-card-body")?.innerText || "");
}

const escape = (fr) => fr.evaluate(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));

async function main() {
  const tmp = mkdtempSync(join(tmpdir(), "constellation-check-"));
  const space = join(tmp, "space");
  mkdirSync(space);
  const { shift } = demoSpace(space, { crlf: ["Projects/Autumn Fair"] });
  const bin = await silverbullet(tmp);
  const { server, base } = await startServer(bin, space);
  const launch = { args: ["--no-sandbox"] };
  if (process.env.CHROME_BIN) launch.executablePath = process.env.CHROME_BIN;
  const browser = await chromium.launch(launch);
  const shots = process.env.SCREENSHOTS;
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(base + "index");
    await page.waitForTimeout(9000);
    // first start in this browser: the index is being built and the graph waits; on the next start it opens by itself
    await page.reload();
    await page.waitForTimeout(7000);
    let fr = await graphFrame(page);
    check("opens on start (openOnStart from the config)", !!fr && await fr.evaluate(() => document.body.classList.contains("cn-full")));
    fr = await openGraph(page);
    check("graph is open", !!fr);
    if (!fr) return;

    const data = await fr.evaluate(() => window.__CN_DATA__);
    const ids = new Set(data.nodes.map((n) => n.id));
    check("nodes and links from the index", ids.has("Projects/Autumn Fair") && ids.has("People/Ann") && data.edges.length >= 10,
      `${ids.size} nodes, ${data.edges.length} links`);
    check("groups from the config", data.groups.map((g) => g.id).join(",") === "project,event,person,journal,other,meta",
      data.groups.map((g) => g.id).join(","));
    check("task attribute links: [who: Ann] → People/Ann",
      data.edges.some((e) => new Set([e.source, e.target]).has("People/Ann") && new Set([e.source, e.target]).has("Projects/Autumn Fair")));
    check("library pages are not in the graph", ![...ids].some((i) => i.startsWith("Library/")));
    const chips = await fr.evaluate(() => [...document.querySelectorAll(".cn-chip")].map((c) => c.textContent.trim()));
    check("legend: configured names", chips.some((c) => c.startsWith("Projects")) && chips.some((c) => c.startsWith("Notes")), chips.join(" | "));
    check("a group hidden by the config is hidden by default", (await fr.evaluate(() => window.__CN_OPTIONS__.hidden)).includes("meta"));

    // stillness: close and open again — nodes stay in place
    const before = await layout(fr);
    await escape(fr);
    await page.waitForTimeout(800);
    fr = await openGraph(page);
    await page.waitForTimeout(1500);
    const shiftReopen = maxShift(before, await layout(fr));
    check("the graph does not jump when reopened", shiftReopen < 10.5, `shift ${shiftReopen.toFixed(1)} (drift up to ~5)`);

    // marks
    const ring = await fr.evaluate(() => [...document.querySelectorAll(".cn-node")].filter((n) =>
      getComputedStyle(n.querySelector("circle.cn-alert")).display !== "none").map((n) => n.querySelector("title").textContent).sort());
    check("overdue ring", JSON.stringify(ring) === JSON.stringify(["Projects/Autumn Fair", "Projects/Garden"]), ring.join(", "));
    const soon = await fr.evaluate(() => [...document.querySelectorAll(".cn-soon")].filter((t) => getComputedStyle(t).display !== "none").map((t) => t.textContent));
    check("“in 5 days” on the upcoming event (once, not on its project)", JSON.stringify(soon) === JSON.stringify(["in 5 days"]), soon.join(", "));

    // constellations: nebulae by links and by the text of the pages
    await page.waitForTimeout(3000);
    const neb = await fr.evaluate(() => [...document.querySelectorAll(".cn-neb")].map((g) => g.querySelectorAll("circle").length));
    check("nebulae are drawn", neb.length >= 1 && neb.every((n) => n >= 3), `constellations: ${neb.join(", ")}`);
    const labels = await fr.evaluate(() => [...document.querySelectorAll(".cn-neb-label")].map((t) => t.textContent));
    check("constellation names", labels.length === neb.length && labels.every(Boolean), labels.join(" | "));
    const garden = ["Ideas/Compost", "Ideas/Seeds", "Ideas/Greenhouse"];
    const clusters = await fr.evaluate(() => window.__CN_CLUSTERS__());
    check("the text of the pages gathers unlinked pages into one constellation",
      clusters.some((c) => garden.every((id) => c.members.includes(id))), clusters.map((c) => `${c.name}(${c.members.length})`).join(", "));
    check("day summaries are not in constellations", !clusters.some((c) => c.members.some((id) => /\d{4}-\d{2}-\d{2}$/.test(id))));
    check("starry background and twinkling", await fr.evaluate(() => document.querySelector("#cn-container").classList.contains("cn-starfield")
      && document.querySelector("svg").classList.contains("cn-twinkle")));
    // settings: nebulae off and on again
    await fr.evaluate(() => document.querySelector("#cn-toolbar button[title*='settings' i], #cn-toolbar button[title*='астройки' i]").click());
    await page.waitForTimeout(500);
    const toggleNebulae = () => fr.evaluate(() => [...document.querySelectorAll(".cn-set-check")]
      .find((l) => /Nebulae|Туманности/.test(l.textContent)).querySelector("input").click());
    await toggleNebulae();
    await page.waitForTimeout(600);
    check("nebulae can be turned off", await fr.evaluate(() => document.querySelectorAll(".cn-neb").length === 0));
    await toggleNebulae();
    await page.waitForTimeout(800);
    check("… and on again", await fr.evaluate(() => document.querySelectorAll(".cn-neb").length >= 1));
    await fr.evaluate(() => document.querySelector(".cn-set-actions [data-act=reset]").click());
    await page.waitForTimeout(800);
    await fr.evaluate(() => document.querySelector(".cn-icon[data-act=close]").click());
    if (shots) await page.screenshot({ path: join(shots, "nebulae.png") });

    // card, own checkboxes in a CRLF page
    const fair = join(space, "Projects", "Autumn Fair.md");
    let text = await openCard(page, fr, "Projects/Autumn Fair");
    check("card with the page content", text.includes("Print the posters") && text.includes("fair for the whole neighbourhood"));
    const meta = await fr.evaluate(() => document.querySelector(".cn-card-meta").innerText);
    check("card meta: event and overdue", meta.includes("in 5 days") && meta.includes("overdue tasks: 1"), meta.replace(/\n/g, " | "));
    check("attribute chips", await fr.evaluate(() => [...document.querySelectorAll(".cn-card-body .cn-attr")].map((c) => c.textContent).includes("Ann")));
    if (shots) {
      mkdirSync(shots, { recursive: true });
      await page.screenshot({ path: join(shots, "card-light.png") });
    }
    await fr.locator(".cn-card-body .sb-task input").first().click();
    await page.waitForTimeout(2500);
    let raw = readFileSync(fair, "utf8");
    check("checkbox in the card writes the page (CRLF file)", raw.includes("- [x] Print the posters") && raw.includes("\r\n"));
    await fr.locator(".cn-card-body .sb-task input").first().click();
    await page.waitForTimeout(2500);
    check("unticked again", readFileSync(fair, "utf8").includes("- [ ] Print the posters"));

    // checkbox of a task shown by a query (another page)
    text = await openCard(page, fr, "People/Ann");
    check("query results in the card", text.includes("Print the posters"));
    const external = fr.locator(".cn-card-body .sb-task[data-external-task-ref]").first();
    await external.locator("input").click();
    await page.waitForTimeout(2500);
    raw = readFileSync(fair, "utf8");
    check("checkbox of a query result writes its own page", raw.includes("- [x] Print the posters"), raw.split("\n").find((l) => l.includes("posters")));
    writeFileSync(fair, raw.replace("- [x] Print the posters", "- [ ] Print the posters"));
    await escape(fr);
    await page.waitForTimeout(800);

    // timeline: the last 7 days — old journal pages fade out, the rest stays in place
    const beforeTime = await layout(fr);
    await fr.evaluate(() => {
      const r = document.querySelector(".cn-time-range");
      r.value = String(Number(r.max) - 7);
      r.dispatchEvent(new Event("input"));
      r.dispatchEvent(new Event("change"));
    });
    await page.waitForTimeout(1500);
    const afterTime = await layout(fr);
    const gone = Object.keys(beforeTime).filter((k) => !afterTime[k]);
    check("timeline hides old pages", gone.includes(`Journal/${shift(-60)}`) && !!afterTime[`Journal/${shift(-1)}`], gone.join(", "));
    check("timeline does not re-lay out the graph", maxShift(beforeTime, afterTime) < 10.5);
    await fr.locator(".cn-time-label").click();
    await page.waitForTimeout(1200);
    check("“All time” brings them back", Object.keys(await layout(fr)).length === Object.keys(beforeTime).length);
    if (shots) {
      await page.evaluate(() => client.runCommandByName("Editor: Toggle Dark Mode"));
      await page.waitForTimeout(1500);
      fr = await graphFrame(page);
      await page.screenshot({ path: join(shots, "graph-dark.png") });
      await page.evaluate(() => client.runCommandByName("Editor: Toggle Dark Mode"));
      await page.waitForTimeout(1000);
      fr = await graphFrame(page);
    }

    // dark theme on the fly (the graph has focus, so the command is run directly)
    await page.evaluate(() => client.runCommandByName("Editor: Toggle Dark Mode"));
    await page.waitForTimeout(1500);
    fr = await graphFrame(page);
    check("dark theme on the fly", !!fr && await fr.evaluate(() => document.documentElement.getAttribute("data-theme")) === "dark");
    await page.evaluate(() => client.runCommandByName("Editor: Toggle Dark Mode"));
    await page.waitForTimeout(1500);

    // side panel
    fr = await graphFrame(page);
    if (fr) await escape(fr);
    await page.waitForTimeout(600);
    await page.evaluate(() => client.runCommandByName("Constellation: Toggle Side Graph"));
    await page.waitForTimeout(2500);
    fr = await graphFrame(page);
    check("side panel", !!fr && !(await fr.evaluate(() => document.body.classList.contains("cn-full"))));
    await page.evaluate(() => client.runCommandByName("Constellation: Toggle Side Graph"));
    await page.waitForTimeout(800);

    // Russian UI from the config
    writeFileSync(join(space, "CONFIG.md"), readFileSync(join(space, "CONFIG.md"), "utf8").replace('language = "en"', 'language = "ru"'));
    await page.waitForTimeout(3000);
    await page.reload();
    await page.waitForTimeout(6000);
    fr = await openGraph(page);
    const title = fr ? await fr.evaluate(() => document.querySelector(".cn-title")?.textContent) : "";
    check("Russian UI from the config", title === "Граф связей", title);
    check("no JavaScript errors", errors.length === 0, errors.slice(0, 3).join("; "));
  } finally {
    await browser.close();
    server.kill();
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
  if (failed.length) {
    console.log(`Constellation: ${failed.length} check(s) failed`);
    process.exit(1);
  }
  console.log("Constellation: all checks passed");
}
