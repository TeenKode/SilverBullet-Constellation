// Install check: a fresh SilverBullet installs Constellation the way users do — Library: Install with
//   ghr:TeenKode/silverbullet-constellation/PLUG.md
// (the latest GitHub release), then the graph opens. Needs internet access from the SilverBullet server.
//
//   node scripts/check-install.mjs              — SB_BIN / SB_VERSION / CHROME_BIN as in check.mjs
//   URI=github:TeenKode/silverbullet-constellation/PLUG.md node scripts/check-install.mjs   — from main
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { silverbullet, startServer } from "./check.mjs";

const URI = process.env.URI || "ghr:TeenKode/silverbullet-constellation/PLUG.md";
const failed = [];
function check(what, ok, details = "") {
  console.log(`${ok ? "✓" : "✗"} ${what}${details ? ` — ${details}` : ""}`);
  if (!ok) failed.push(what);
}

const tmp = mkdtempSync(join(tmpdir(), "constellation-install-"));
const space = join(tmp, "space");
mkdirSync(join(space, "Projects"), { recursive: true });
writeFileSync(join(space, "index.md"), "# Home\n\n[[Projects/Alpha]], [[Projects/Beta]]\n");
writeFileSync(join(space, "Projects", "Alpha.md"), "# Alpha\n\nSee [[Projects/Beta]].\n");
writeFileSync(join(space, "Projects", "Beta.md"), "# Beta\n");
const { server, base } = await startServer(await silverbullet(tmp), space);
const launch = { args: ["--no-sandbox"] };
if (process.env.CHROME_BIN) launch.executablePath = process.env.CHROME_BIN;
const browser = await chromium.launch(launch);
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(base + "index");
  await page.waitForTimeout(8000);
  // what the Library Manager's “Install” button does
  const result = await page.evaluate((uri) => client.clientSystem.localSyscall("system.invokeFunction",
    ["configuration-manager.librariesAction", "install", { uri }]), URI);
  check(`Library: Install ${URI}`, !!result?.ok, JSON.stringify(result).slice(0, 200));
  const lib = join(space, "Library", "TeenKode");
  for (let i = 0; i < 20 && !existsSync(join(lib, "constellation.plug.js")); i++) await page.waitForTimeout(500);
  check("library page and plug in the space", existsSync(join(lib, "Constellation.md")) && existsSync(join(lib, "constellation.plug.js")));
  const pageText = existsSync(join(lib, "Constellation.md")) ? readFileSync(join(lib, "Constellation.md"), "utf8") : "";
  check("the page remembers where it came from (for Library: Update)", pageText.includes(URI), pageText.split("\n").slice(0, 12).join(" | "));
  await page.waitForTimeout(3000);
  await page.evaluate(() => client.runCommandByName("Constellation: Open Graph"));
  await page.waitForTimeout(3000);
  let data = null;
  for (const f of page.frames()) {
    try {
      data = (await f.evaluate(() => window.__CN_DATA__)) || data;
    } catch { /* detached */ }
  }
  check("the installed graph opens", !!data && data.nodes.some((n) => n.id === "Projects/Alpha"), data ? `${data.nodes.length} nodes` : "no graph");
  check("no JavaScript errors", errors.length === 0, errors.slice(0, 3).join("; "));
} finally {
  await browser.close();
  server.kill();
  rmSync(tmp, { recursive: true, force: true });
}
if (failed.length) {
  console.log(`Install check: ${failed.length} failed`);
  process.exit(1);
}
console.log("Install check: all passed");
