#!/usr/bin/env node
// npm run capacity -- [--allow verified|checked|draft]
// How many daily puzzles the current content supports: simulates the scheduler for a year and reports
// when items first repeat and how often each scale comes back.
import { loadScales, statusAtLeast } from "../lib/content.js";
import { planDays, ITEM_GAP } from "./schedule.mjs";
import { daysBetween } from "../public/js/core.js";

const i = process.argv.indexOf("--allow");
const minStatus = i > -1 ? process.argv[i + 1] : "verified";
const scales = loadScales();
const usable = scales.map(s => ({ ...s, items: s.items.filter(it => statusAtLeast(it.status || "draft", minStatus)) })).filter(s => s.items.length >= 8);
const items = usable.reduce((a, s) => a + s.items.length, 0);
if (usable.length < 3) { console.log(`Only ${usable.length} scales have 8+ items at status "${minStatus}" or better; need at least 3.`); process.exit(0); }

const days = planDays({ scales, existing: [], from: "2030-01-01", to: "2030-12-31", minStatus });
const seen = new Map(), lastScale = new Map();
let firstRepeat = null, firstCloseRepeat = null;
const scaleGaps = [];
for (const p of days) {
  for (const s of p.scales) {
    if (lastScale.has(s.id)) scaleGaps.push(daysBetween(lastScale.get(s.id), p.date));
    lastScale.set(s.id, p.date);
    for (const it of s.items) {
      if (seen.has(it.id)) {
        firstRepeat ??= p.number - 1;
        if (daysBetween(seen.get(it.id), p.date) < ITEM_GAP) firstCloseRepeat ??= p.number - 1;
      }
      seen.set(it.id, p.date);
    }
  }
}
const avgGap = scaleGaps.length ? Math.round(scaleGaps.reduce((a, b) => a + b, 0) / scaleGaps.length) : "–";
console.log(`Content at status "${minStatus}" or better: ${usable.length} scales, ${items} items.`);
console.log(`Days of puzzles before any item repeats:            ${firstRepeat ?? "365+"}`);
console.log(`Days before an item repeats within ${ITEM_GAP} days:        ${firstCloseRepeat ?? "365+"}`);
console.log(`A scale comes back on average every:                 ${avgGap} days`);
console.log(`Items needed for a full year with no repeats:        ${365 * 15} (about ${Math.ceil(365 * 15 / 20)} scales of 20)`);
