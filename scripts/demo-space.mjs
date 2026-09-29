// A small demo space for the checks and screenshots: projects, events, people, a journal and tasks,
// with dates relative to today (so "overdue" and "in N days" always show up).
//
//   node scripts/demo-space.mjs <folder>     — write the space (and install the built plug into it)
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const iso = (d) => d.toISOString().slice(0, 10);
const shift = (days) => {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return iso(d);
};

export const CONFIG = `
\`\`\`space-lua
config.set("constellation", {
  language = LANGUAGE,
  openOnStart = true,
  groups = {
    { id = "project", name = "Projects", one = "Project", prefix = "Projects/" },
    { id = "event", name = "Events", one = "Event", prefix = "Events/" },
    { id = "person", name = "People", one = "Person", prefix = "People/", undated = true },
    { id = "journal", name = "Journal", one = "Journal entry", prefix = "Journal/" },
    { id = "other", name = "Notes", one = "Note" },
    { id = "meta", name = "Meta", one = "Meta page", pages = { "index" }, hidden = true, undated = true },
  },
  taskLinks = { who = "People/" },
  upcoming = { prefix = "Events/", mirror = "Projects/" },
})
\`\`\`
`;

export function demoSpace(folder, { language = "en", crlf = [] } = {}) {
  const pages = {
    CONFIG: `# Configuration\n${CONFIG.replace("LANGUAGE", JSON.stringify(language))}`,
    index: `# Welcome\n\nOpen the graph with the **Constellation: Open Graph** command.\n\n` +
      `## Open tasks\n\${query[[from t = index.tasks() where not t.done select templates.taskItem(t)]]}\n`,
    "Projects/Autumn Fair":
      `# Autumn Fair\n\nA fair for the whole neighbourhood. See [[Events/Autumn Fair]] and [[Ideas/Stalls]].\n\n` +
      `## Tasks\n- [ ] Print the posters [who: Ann] [due: ${shift(-3)}]\n` +
      `- [ ] Book the hall [who: Bob] [due: ${shift(4)}]\n- [x] Pick a date [who: Ann]\n`,
    "Projects/Website": `# Website\n\nNew site for the club, notes in [[Ideas/Blog]].\n\n` +
      `- [ ] Draft the home page [who: Carol] [due: ${shift(10)}]\n- [ ] Choose a theme [who: Bob]\n`,
    "Projects/Garden": `# Garden\n\nPlanting plan with [[People/Dan]].\n\n- [ ] Order seeds [who: Dan] [due: ${shift(-1)}]\n`,
    "Events/Autumn Fair": `---\ndate: ${shift(5)}\nplace: Town hall\n---\n# Autumn Fair\n\nThe fair itself. Project: [[Projects/Autumn Fair]].\n`,
    "Events/Club Meeting": `---\ndate: ${shift(20)}\n---\n# Club Meeting\n\nAgenda: [[Projects/Website]], [[Projects/Garden]].\n`,
    "Ideas/Stalls": "# Stalls\n\nFood, crafts, a book swap. Ask [[People/Carol]].\n",
    "Ideas/Blog": "# Blog\n\nWeekly posts from [[Journal/" + shift(-1) + "]].\n",
    "Ideas/Old idea": "# Old idea\n\nNot linked from anywhere.\n",
    "People/Ann": `# Ann\n\n\${query[[from t = index.tasks() where not t.done and t.who == "Ann" select templates.taskItem(t)]]}\n`,
    "People/Bob": "# Bob\n",
    "People/Carol": "# Carol\n",
    "People/Dan": "# Dan\n",
    [`Journal/${shift(-1)}`]: "# Yesterday\n\nTalked about [[Projects/Autumn Fair]] and [[Projects/Website]].\n",
    [`Journal/${shift(-30)}`]: "# A month ago\n\nFirst ideas for [[Projects/Garden]].\n",
    [`Journal/${shift(-60)}`]: "# Two months ago\n\nThe club started. [[Ideas/Blog]]\n",
  };
  for (const [name, text] of Object.entries(pages)) {
    const path = join(folder, name + ".md");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, crlf.includes(name) ? text.replace(/\n/g, "\r\n") : text);
  }
  // the plug, as "Library: Install" would put it
  mkdirSync(join(folder, "Library", "TeenKode"), { recursive: true });
  copyFileSync(join(ROOT, "constellation.plug.js"), join(folder, "Library", "TeenKode", "constellation.plug.js"));
  copyFileSync(join(ROOT, "PLUG.md"), join(folder, "Library", "TeenKode", "Constellation.md"));
  return { shift };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const folder = process.argv[2];
  if (!folder) {
    console.error("usage: node scripts/demo-space.mjs <folder>");
    process.exit(1);
  }
  demoSpace(folder);
  console.log(`Demo space written to ${folder}`);
}
