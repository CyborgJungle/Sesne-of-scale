#!/usr/bin/env node
// npm run verify -- [scale-id ...] [--all] [--write]
//
// Automatic source check for draft items whose source is an English Wikipedia page:
// fetches the page (rendered text + wikitext), and looks for the item's number close to the item's name.
//   pass → with --write the item becomes status "checked" and the evidence snippet is saved as `quote`
//   weak → the number is on the page but not near the name   (a person must look)
//   fail → number not found, or page missing                   (a person must fix the value or source)
// A person still approves every item (status "verified") in the review tool before it can be scheduled.
//
// Per-item overrides: "verify": { "number": 24, "match": "adult" } — the number as the page writes it
// (e.g. hours instead of years) and the word to look near (defaults to the item name without brackets).
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadScales, saveScale, ROOT } from "../lib/content.js";

const args = process.argv.slice(2);
const write = args.includes("--write"), all = args.includes("--all");
const only = args.filter(a => !a.startsWith("--"));
const UA = "SenseOfScale-content-check/0.1 (daily puzzle game; source verification)";

// Wikipedia asks API clients to go slowly: one request at a time, with a pause in between.
const sleep = ms => new Promise(r => setTimeout(r, ms));
let lastRequest = 0;
async function throttle() {
  const wait = lastRequest + 1500 - Date.now();
  lastRequest = Math.max(Date.now(), lastRequest + 1500);
  if (wait > 0) await sleep(wait);
}
const pageCache = new Map();
async function fetchPage(url) {
  const m = url.match(/^https?:\/\/en\.(?:m\.)?wikipedia\.org\/wiki\/([^#?]+)/);
  if (!m) return null;
  const title = decodeURIComponent(m[1]);
  if (pageCache.has(title)) return pageCache.get(title);
  const p = (async () => {
    const api = `https://en.wikipedia.org/w/api.php?action=parse&format=json&redirects=1&maxlag=5&prop=text|wikitext&page=${encodeURIComponent(title)}`;
    for (let tries = 0; tries < 5; tries++) {
      await throttle();
      const res = await fetch(api, { headers: { "User-Agent": UA, "Api-User-Agent": UA }, signal: AbortSignal.timeout(30000) }).catch(e => ({ status: 0, text: async () => String(e) }));
      const body = await res.text();
      let j;
      try { j = JSON.parse(body); } catch { j = null; }
      if (!j || res.status === 429 || j.error?.code === "maxlag") { await sleep(5000 * (tries + 1)); continue; }
      if (j.error) return { error: j.error.info };
      const html = j.parse.text["*"]
        .replace(/<sup[^>]*class="[^"]*reference[^"]*"[\s\S]*?<\/sup>/g, "")
        .replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/&#[0-9]+;|&[a-z]+;/g, " ");
      return { text: norm(html + "\n" + j.parse.wikitext["*"]) };
    }
    return { error: "rate limited" };
  })();
  pageCache.set(title, p);
  return p;
}

// Normalise: collapse whitespace, unify dashes and minus signs, drop thousands separators inside numbers.
function norm(s) {
  return s.replace(/[−–—]/g, "-").replace(/\s+/g, " ")
    .replace(/(\d)[,   ](?=\d{3}(?!\d))/g, "$1").replace(/(\d)[,   ](?=\d{3}(?!\d))/g, "$1");
}
const numbersIn = s => (s.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
const close = (a, b) => (b === 0 ? Math.abs(a) < 1e-9 : Math.abs(a - b) / Math.abs(b) <= 0.005);
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function check(text, item) {
  const target = item.verify?.number ?? item.value;
  const match = (item.verify?.match || item.name.replace(/\s*\(.*?\)\s*/g, " ").replace(/,.*$/, "")).trim();
  const words = [match, ...match.split(/\s+/).filter(w => w.length >= 5)];
  for (const w of words) {
    const re = new RegExp(escapeRe(w), "gi");
    let m;
    while ((m = re.exec(text))) {
      const a = Math.max(0, m.index - 350), b = Math.min(text.length, m.index + w.length + 350);
      const win = text.slice(a, b);
      if (numbersIn(win).some(n => close(n, target))) {
        const numAt = win.search(new RegExp(`(^|[^\\d.])${escapeRe(String(target)).replace(/\\\./, "\\.")}`));
        const center = numAt > -1 ? a + numAt : m.index;
        const quote = text.slice(Math.max(0, center - 110), center + 110).replace(/\{\{|\}\}|\[\[|\]\]|'''|''/g, "").trim();
        return { result: w === match ? "pass" : "pass-partial", quote };
      }
    }
  }
  return { result: numbersIn(text).some(n => close(n, target)) ? "weak" : "fail" };
}

const scales = loadScales().filter(s => !only.length || only.includes(s.id));
const report = [];
let n = 0;
for (const s of scales) {
  const todo = s.items.filter(it => all || (it.status || "draft") === "draft");
  // Fetch this scale's pages in parallel (a handful at a time), then check items.
  const urls = [...new Set(todo.map(it => it.source))];
  for (const u of urls) await fetchPage(u);
  let changed = false;
  for (const it of todo) {
    n++;
    const page = await fetchPage(it.source);
    let r;
    if (!page) r = { result: "skip", note: "not a Wikipedia source" };
    else if (page.error) r = { result: "fail", note: page.error };
    else r = check(page.text, it);
    report.push({ scale: s.id, item: it.name, value: it.value, source: it.source, ...r });
    if (write && r.result.startsWith("pass") && (it.status || "draft") === "draft") {
      it.status = "checked"; it.quote = r.quote; changed = true;
    }
  }
  if (changed) saveScale(s);
  const c = k => report.filter(x => x.scale === s.id && x.result.startsWith(k)).length;
  console.log(`${s.id.padEnd(28)} pass ${String(c("pass")).padStart(2)}  weak ${String(c("weak")).padStart(2)}  fail ${String(c("fail")).padStart(2)}  skip ${c("skip")}`);
}

mkdirSync(join(ROOT, "reports"), { recursive: true });
const md = ["# Source check", "", `Checked ${n} items on ${new Date().toISOString().slice(0, 10)}.`, "",
  "| result | scale | item | value | source | note |", "|---|---|---|---|---|---|",
  ...report.filter(r => !r.result.startsWith("pass")).map(r => `| ${r.result} | ${r.scale} | ${r.item} | ${r.value} | ${r.source} | ${r.note || ""} |`)];
writeFileSync(join(ROOT, "reports", "source-check.md"), md.join("\n") + "\n");
const tally = k => report.filter(r => r.result.startsWith(k)).length;
console.log(`\n${tally("pass")} pass, ${tally("weak")} weak, ${tally("fail")} fail, ${tally("skip")} skipped. Problems listed in reports/source-check.md.${write ? "" : " (Run with --write to mark passes as checked.)"}`);
