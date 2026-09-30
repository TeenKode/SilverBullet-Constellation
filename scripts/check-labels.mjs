import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { demoSpace } from "./demo-space.mjs";
import { silverbullet, startServer } from "./check.mjs";

// Labels of a dense graph do not overlap (a day summary linked to dozens of topics — the case that looked
// like a pile of text): a space of ~80 pages, the full-screen graph, overlapping visible labels are counted.
//   node scripts/check-labels.mjs [plug.js] [screenshot.png]
const plug = process.argv[2] || new URL("../constellation.plug.js", import.meta.url).pathname;
const shot = process.argv[3];
const tmp = mkdtempSync(join(tmpdir(), "cn-dense-"));
const space = join(tmp, "space");
mkdirSync(space);
demoSpace(space);
copyFileSync(plug, join(space, "Library", "TeenKode", "constellation.plug.js"));
const words = ["Технические вопросы по оборудованию", "Турнир «Что Где Когда» для школьников", "Проблема с подключением родителей к чатам",
  "Закупка оборудования для системы лояльности", "Расписание занятий и работа с химиком", "Смена «Созвездие» для победителей",
  "Анкета для родителей по проверке питания", "Поиск приложения для общих заметок", "Работа с группой 9 класса по истории"];
const people = ["Сергей Валерьевич", "Михаил Александрович", "Мария Петровна", "Олег Иванов"];
const topics = [];
for (let i = 0; i < 60; i++) topics.push(`${words[i % words.length]} ${i}`);
for (const p of people) writeFileSync(join(space, "People", p + ".md"), `# ${p}\n`);
const days = ["2026-09-28", "2026-09-29", "2026-09-30"];
days.forEach((d, k) => writeFileSync(join(space, "Journal", d + ".md"),
  `# ${d}\n\n` + topics.filter((_, i) => i % 3 === k || i % 7 === 0).map((t) => `- [[Projects/${t}]]`).join("\n") + "\n"));
topics.forEach((t, i) => writeFileSync(join(space, "Projects", t + ".md"),
  `# ${t}\n\nСм. [[Journal/${days[i % 3]}]]\n- [ ] дело [who: ${people[i % 4].split(" ")[0]}]\n` + (i % 5 === 0 ? `[[People/${people[i % 4]}]]\n` : "")));
const bin = await silverbullet(tmp);
const { server, base } = await startServer(bin, space);
const launch = { args: ["--no-sandbox"] };
if (process.env.CHROME_BIN) launch.executablePath = process.env.CHROME_BIN;
const browser = await chromium.launch(launch);
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
  page.on("console", (m) => { if (m.text().startsWith("over")) console.log(m.text()); });
  await page.goto(base + "index"); await page.waitForTimeout(9000); await page.reload(); await page.waitForTimeout(7000);
  const find = async () => { let fr = null; for (const f of page.frames()) { try { if (await f.evaluate(() => !!window.__CN_DATA__ && document.body.classList.contains("cn-full"))) fr = f; } catch {} } return fr; };
  let fr = await find();
  if (!fr) { await page.evaluate(() => client.runCommandByName("Constellation: Open Graph")); await page.waitForTimeout(4000); fr = await find(); }
  await page.waitForTimeout(2000);
  const r = await fr.evaluate(() => {
    const nodes = [...document.querySelectorAll(".cn-node:not(.cn-leaving)")];
    const labels = nodes.map((n) => [n, n.querySelector("text.cn-label")])
      .filter(([, t]) => t && parseFloat(getComputedStyle(t).opacity) > 0.05)
      .map(([n, t]) => [n, t.getBoundingClientRect()]);
    const dots = nodes.map((n) => [n, n.querySelector("circle.cn-dot").getBoundingClientRect()]);
    const cross = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    let overlaps = 0, overDots = 0;
    for (let i = 0; i < labels.length; i++) {
      for (let j = i + 1; j < labels.length; j++) if (cross(labels[i][1], labels[j][1])) overlaps++;
      for (const [n, dot] of dots) if (n !== labels[i][0] && cross(labels[i][1], dot)) {
        overDots++;
        const L = labels[i][1];
        console.log("over", labels[i][0].querySelector("title").textContent, "→", n.querySelector("title").textContent,
          Math.round(L.left), Math.round(L.right), Math.round(L.top), Math.round(L.bottom), "|",
          Math.round(dot.left), Math.round(dot.right), Math.round(dot.top), Math.round(dot.bottom));
      }
    }
    return { nodes: nodes.length, labels: labels.length, overlaps, overDots };
  });
  if (shot) await page.screenshot({ path: shot });
  const ok = r.labels >= 8 && r.overlaps === 0 && r.overDots === 0;
  console.log(`${ok ? "✓" : "✗"} labels do not overlap — ${r.nodes} nodes, ${r.labels} labels, ` +
    `${r.overlaps} overlapping pairs, ${r.overDots} over other nodes`);
  if (!ok) process.exitCode = 1;
} finally { await browser.close(); server.kill(); }
