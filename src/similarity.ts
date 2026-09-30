// Constellation — text similarity of pages (TF-IDF + cosine). The pure part: no SilverBullet syscalls,
// runs under `node --test`. The plug reads the pages, this turns their texts into “these two are about the same thing”.

const STOP = new Set((
  // ru
  "это как так что для или его них она они оно были было была быть будет можно нужно надо еще уже только тоже " +
  "если чтобы когда потому есть нет при над под без про все всё вот там тут где мне нас вас них ним кто чем " +
  "который которая которые которого очень более менее также после перед между через ещё "
  // en
  + "the and for are was were with this that from have has had not but you your they them then than there here what "
  + "when which will would can could should about into over under also just only more most some such very"
).split(/\s+/).filter(Boolean));

const PREFIX = 6;   // a crude “stem”: the first letters (родителей / родители / родителям → «родите»)

// Text of a page → words: without the header, code, links syntax, attributes and numbers
export function tokenize(text: string): string[] {
  const clean = text
    .replace(/^---\r?\n[\s\S]*?\r?\n---/, " ")            // header
    .replace(/```[\s\S]*?```/g, " ")                       // code
    .replace(/\$\{[^}]*\}/g, " ")                          // ${…} directives
    .replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, " $2 ")      // [[Page|title]] → title
    .replace(/\[[\w$]+:[^\]]*\]/g, " ")                    // [who: Ann] [due: 2026-10-01]
    .replace(/https?:\/\/\S+/g, " ");
  const out: string[] = [];
  for (const raw of clean.toLowerCase().replace(/ё/g, "е").split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length < 3 || /^\d+$/.test(raw) || STOP.has(raw)) continue;
    out.push(raw.length > PREFIX ? raw.slice(0, PREFIX) : raw);
  }
  return out;
}

export interface Doc { id: string; title: string; text: string }
export interface Pair { a: string; b: string; w: number }

// The title counts as three mentions: it is what the page is about
const TITLE_WEIGHT = 3;

// For every page — its most similar ones (up to `perNode`), similarity (cosine) at least `min`
export function similarPairs(docs: Doc[], opts: { perNode?: number; min?: number } = {}): Pair[] {
  const perNode = opts.perNode ?? 5;
  const min = opts.min ?? 0.1;
  const n = docs.length;
  if (n < 2) return [];
  const counts = docs.map((d) => {
    const m = new Map<string, number>();
    for (const t of tokenize(d.text)) m.set(t, (m.get(t) || 0) + 1);
    for (const t of tokenize(d.title)) m.set(t, (m.get(t) || 0) + TITLE_WEIGHT);
    return m;
  });
  const df = new Map<string, number>();
  for (const m of counts) for (const t of m.keys()) df.set(t, (df.get(t) || 0) + 1);
  // a word met everywhere separates nothing, a word met once connects nothing
  const maxDf = Math.max(8, Math.floor(n * 0.15));
  const vectors = counts.map((m) => {
    const v: [string, number][] = [];
    let norm = 0;
    for (const [t, c] of m) {
      const d = df.get(t) || 0;
      if (d < 2 || d > maxDf) continue;
      const w = (1 + Math.log(c)) * Math.log(n / d);
      v.push([t, w]);
      norm += w * w;
    }
    norm = Math.sqrt(norm) || 1;
    return v.map(([t, w]) => [t, w / norm] as [string, number]);
  });
  const postings = new Map<string, [number, number][]>();
  vectors.forEach((v, i) => {
    for (const [t, w] of v) {
      let p = postings.get(t);
      if (!p) postings.set(t, (p = []));
      p.push([i, w]);
    }
  });
  const dots = new Map<number, number>();
  for (const p of postings.values()) {
    for (let x = 0; x < p.length; x++) {
      for (let y = x + 1; y < p.length; y++) {
        const key = p[x][0] * n + p[y][0];         // p is in ascending page order: x < y
        dots.set(key, (dots.get(key) || 0) + p[x][1] * p[y][1]);
      }
    }
  }
  const best: Pair[][] = docs.map(() => []);
  for (const [key, w] of dots) {
    if (w < min) continue;
    const i = Math.floor(key / n), j = key % n;
    best[i].push({ a: docs[i].id, b: docs[j].id, w });
    best[j].push({ a: docs[i].id, b: docs[j].id, w });
  }
  const keep = new Map<string, Pair>();
  for (const list of best) {
    list.sort((p, q) => q.w - p.w || (p.a + p.b < q.a + q.b ? -1 : 1));
    for (const p of list.slice(0, perNode)) keep.set(p.a + "\u0000" + p.b, p);
  }
  return Array.from(keep.values()).map((p) => ({ ...p, w: Math.round(p.w * 1000) / 1000 }));
}
