#!/usr/bin/env node
// npm run schedule -- [--days 60] [--start YYYY-MM-DD] [--allow verified|checked|draft] [--dry]
//
// Extends schedule/*.json with one puzzle per day (3 scales × 5 items), up to --days ahead of today.
// It never changes dates that are already scheduled. Picks are seeded by date, so reruns are reproducible.
//
// Rules: scales rotate least-recently-used first (so the gap grows with the pool: 18 scales → ~6 days,
// 200 scales → ~65 days), an item avoids repeating within ITEM_GAP days, the 3 scales of a day come from
// different fields, and each set of 5 items spreads out across the scale with clear gaps between them.
import { loadScales, statusAtLeast, scaleSnapshot } from "../lib/content.js";
import { loadSchedule, saveSchedule } from "../lib/schedule.js";
import { toT, addDays, daysBetween, isoDate, ITEMS_PER_SCALE } from "../public/js/core.js";

export const SCALES_PER_DAY = 3;
export const ITEM_GAP = 90, MIN_GAP_T = 0.05, MIN_SPAN_T = 0.45;

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : def;
}

export function rng(seedStr) {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) { h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const sample = (arr, n, r) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a.slice(0, n); };

/** Best set of 5 items for one appearance of a scale. */
export function pickItems(scale, allItems, date, lastItemUse, r) {
  // Hard rule when possible: only items not used in the last ITEM_GAP days. Otherwise the least recently used.
  const fresh = allItems.filter(it => !lastItemUse.has(it.id) || daysBetween(lastItemUse.get(it.id), date) >= ITEM_GAP);
  const items = fresh.length >= ITEMS_PER_SCALE ? fresh
    : allItems.slice().sort((a, b) => (lastItemUse.get(a.id) || "").localeCompare(lastItemUse.get(b.id) || "")).slice(0, Math.max(ITEMS_PER_SCALE + 3, fresh.length));
  let best = null;
  for (let attempt = 0; attempt < 600; attempt++) {
    const set = sample(items, ITEMS_PER_SCALE, r);
    const ts = set.map(it => toT(scale, it.value)).sort((a, b) => a - b);
    let minGap = Infinity;
    for (let i = 1; i < ts.length; i++) minGap = Math.min(minGap, ts[i] - ts[i - 1]);
    const span = ts[ts.length - 1] - ts[0];
    let q = 0;
    if (minGap < MIN_GAP_T) q -= 100 + (MIN_GAP_T - minGap) * 1000;   // too close to tell apart
    if (span < MIN_SPAN_T) q -= 100 + (MIN_SPAN_T - span) * 300;     // bunched up
    const fam = set.filter(it => it.familiar).length;
    q += fam === 0 ? -40 : fam <= 3 ? 10 : 0;                         // one anchor, but not all easy
    for (const it of set) {
      const last = lastItemUse.get(it.id);
      if (last) { const gap = daysBetween(last, date); q -= gap < ITEM_GAP ? 30 + (ITEM_GAP - gap) : 0; }
    }
    q += minGap * 40 + r();                                            // prefer wider gaps; jitter breaks ties
    if (!best || q > best.q) best = { q, set };
  }
  // Present the items in a random (but reproducible) order.
  return sample(best.set, best.set.length, r);
}

export function planDays({ scales, existing, from, to, minStatus }) {
  const usable = scales
    .map(s => ({ s, items: s.items.filter(it => statusAtLeast(it.status || "draft", minStatus)) }))
    .filter(x => x.items.length >= 8);
  if (usable.length < SCALES_PER_DAY) throw new Error(`only ${usable.length} scales have 8+ items at status "${minStatus}" or better`);

  const lastScaleUse = new Map(), lastItemUse = new Map();
  for (const p of existing) for (const s of p.scales) {
    lastScaleUse.set(s.id, p.date);
    for (const it of s.items) lastItemUse.set(it.id, p.date);
  }
  const launch = existing[0]?.date || from;
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const r = rng("sense-of-scale:" + d);
    const ranked = usable
      .map(x => ({ ...x, idle: lastScaleUse.has(x.s.id) ? daysBetween(lastScaleUse.get(x.s.id), d) : 10000 }))
      .map(x => ({ ...x, rank: Math.min(x.idle, 400) + r() * 1.5 }))  // least recently used first; jitter only breaks near-ties
      .sort((a, b) => b.rank - a.rank);
    const chosen = [];
    for (const x of ranked) {                     // different fields on the same day
      if (chosen.length === SCALES_PER_DAY) break;
      if (!chosen.some(c => c.s.field === x.s.field)) chosen.push(x);
    }
    for (const x of ranked) if (chosen.length < SCALES_PER_DAY && !chosen.includes(x)) chosen.push(x);

    const puzzle = { date: d, number: daysBetween(launch, d) + 1, scales: [] };
    for (const x of chosen) {
      const items = pickItems(x.s, x.items, d, lastItemUse, r);
      puzzle.scales.push(scaleSnapshot(x.s, items));
      lastScaleUse.set(x.s.id, d);
      items.forEach(it => lastItemUse.set(it.id, d));
    }
    out.push(puzzle);
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const existing = loadSchedule();
  const minStatus = arg("allow", "verified");
  const today = isoDate(new Date());
  const to = addDays(today, +arg("days", 60));
  const from = existing.length ? addDays(existing[existing.length - 1].date, 1) : arg("start", today);
  if (from > to) { console.log(`Already scheduled through ${existing[existing.length - 1].date}. Nothing to do.`); process.exit(0); }

  const planned = planDays({ scales: loadScales(), existing, from, to, minStatus });
  for (const p of planned) console.log(`#${String(p.number).padStart(3)} ${p.date}  ${p.scales.map(s => s.id).join(", ")}`);
  if (process.argv.includes("--dry")) { console.log("\n(dry run, nothing written)"); process.exit(0); }
  saveSchedule([...existing, ...planned]);
  console.log(`\nScheduled ${planned.length} new days (${from} → ${to}) using items with status "${minStatus}" or better.`);
}
