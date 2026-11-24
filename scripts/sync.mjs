#!/usr/bin/env node
// npm run sync — push content and the schedule to Supabase.
// Needs SUPABASE_URL and SUPABASE_SECRET_KEY (in .env locally, or in CI secrets).
// Puzzles that are already live somewhere on Earth are never overwritten unless you pass --force.
import { loadScales } from "../lib/content.js";
import { loadSchedule } from "../lib/schedule.js";
import { mode, sb } from "../lib/store.js";
import { latestLiveDate } from "../public/js/core.js";

if (mode !== "supabase") { console.error("Set SUPABASE_URL and SUPABASE_SECRET_KEY first (see .env.example)."); process.exit(1); }
const force = process.argv.includes("--force");
const upsert = (table, rows) => rows.length && sb(`${table}?on_conflict=${table === "puzzles" ? "date" : "id"}`, {
  method: "POST", body: rows, prefer: "resolution=merge-duplicates,return=minimal",
});
const chunks = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

const scales = loadScales();
await upsert("scales", scales.map(s => ({
  id: s.id, field: s.field, name: s.name, question: s.question, unit: s.unit || "", type: s.type, min: s.min, max: s.max,
  spec: Object.fromEntries(["measure", "step", "tickStart", "ticks", "display"].filter(k => s[k] !== undefined).map(k => [k, s[k]])),
  updated_at: new Date().toISOString(),
})));
const items = scales.flatMap(s => s.items.map(it => ({
  id: it.id, scale_id: s.id, name: it.name, value: it.value, source: it.source, quote: it.quote || null, fact: it.fact || null,
  familiar: !!it.familiar, disputed: !!it.disputed, status: it.status || "draft", updated_at: new Date().toISOString(),
})));
for (const c of chunks(items, 500)) await upsert("items", c);
console.log(`Synced ${scales.length} scales and ${items.length} items.`);

const live = latestLiveDate();
const existing = new Set((await sb(`puzzles?select=date&date=lte.${live}`)).map(r => r.date));
const puzzles = loadSchedule().filter(p => force || !existing.has(p.date));
const skipped = loadSchedule().length - puzzles.length;
for (const c of chunks(puzzles, 100)) await upsert("puzzles", c);
console.log(`Synced ${puzzles.length} puzzles${skipped ? ` (left ${skipped} live or past puzzles untouched)` : ""}.`);
